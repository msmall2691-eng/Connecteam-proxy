// Vercel serverless: Square API (Payroll + Invoicing)
// Unified handler — use ?action= to route
// Payroll actions: team, wages, export, adjustment
// Invoice actions: location, create-customer, search-customer, create, send, list
// Requires SQUARE_ACCESS_TOKEN in env

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN
  const SQUARE_BASE = process.env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'

  if (!SQUARE_TOKEN) {
    return res.status(500).json({ error: 'Square not configured. Set SQUARE_ACCESS_TOKEN in Vercel env.' })
  }

  const headers = {
    Authorization: `Bearer ${SQUARE_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-01-18',
  }

  const action = req.query.action || req.body?.action || 'invoice'

  try {
    // ════════════════════════════════════════════════════
    // PAYROLL ACTIONS
    // ════════════════════════════════════════════════════
    if (action === 'team' || action === 'wages' || action === 'export' || action === 'adjustment') {

      // ── LIST TEAM MEMBERS ──
      if (action === 'team') {
        const teamRes = await fetch(`${SQUARE_BASE}/v2/team-members/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query: { filter: { status: { members: ['ACTIVE'] } } } }),
        })
        const teamData = await teamRes.json()
        const members = (teamData.team_members || []).map(m => ({
          id: m.id,
          name: `${m.given_name || ''} ${m.family_name || ''}`.trim(),
          email: m.email_address,
          phone: m.phone_number,
          status: m.status,
        }))
        return res.status(200).json({ members })
      }

      // ── GET PAYROLL (via Team Member Wages) ──
      if (action === 'wages') {
        const wageRes = await fetch(`${SQUARE_BASE}/v2/labor/team-member-wages`, { headers })
        const wageData = await wageRes.json()
        return res.status(200).json(wageData)
      }

      // ── EXPORT PAYROLL CSV ──
      if (action === 'export' && req.method === 'POST') {
        const { employees } = req.body
        if (!employees || !Array.isArray(employees)) {
          return res.status(400).json({ error: 'employees array required' })
        }

        const csvLines = ['Employee Name,Hours Worked,Hourly Rate,Gross Pay,Mileage Reimbursement,Total Compensation']
        for (const emp of employees) {
          csvLines.push([
            `"${emp.name}"`,
            emp.hours,
            emp.rate || '',
            emp.pay,
            emp.mileageReimbursement || 0,
            emp.totalComp || emp.pay,
          ].join(','))
        }

        const csv = csvLines.join('\n')
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', `attachment; filename="payroll-export-${new Date().toISOString().split('T')[0]}.csv"`)
        return res.status(200).send(csv)
      }

      // ── CREATE PAYROLL ADJUSTMENT (bonus/reimbursement) ──
      if (action === 'adjustment' && req.method === 'POST') {
        const { teamMemberId, amount, description } = req.body

        return res.status(200).json({
          note: 'Square Payroll API requires specific subscription for automated pay runs. Use the CSV export to import into Square Payroll, or submit adjustments manually.',
          prepared: {
            teamMemberId,
            amount,
            description,
            date: new Date().toISOString().split('T')[0],
          },
        })
      }

      return res.status(400).json({ error: 'Unknown payroll action or wrong method. Use: team, wages, export (POST), adjustment (POST)' })
    }

    // ════════════════════════════════════════════════════
    // INVOICE ACTIONS (default)
    // ════════════════════════════════════════════════════

    // ── GET LOCATION (needed for invoices) ──
    if (action === 'location') {
      const r = await fetch(`${SQUARE_BASE}/v2/locations`, { headers })
      const data = await r.json()
      const locations = (data.locations || []).map(l => ({
        id: l.id, name: l.name, address: l.address, status: l.status,
      }))
      return res.status(200).json({ locations })
    }

    // ── CREATE CUSTOMER (needed before invoice) ──
    if (action === 'create-customer' && req.method === 'POST') {
      const { name, email, phone, address } = req.body
      const nameParts = (name || '').split(' ')

      const r = await fetch(`${SQUARE_BASE}/v2/customers`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idempotency_key: `cust_${Date.now()}`,
          given_name: nameParts[0] || '',
          family_name: nameParts.slice(1).join(' ') || '',
          email_address: email || undefined,
          phone_number: phone || undefined,
          address: address ? { address_line_1: address } : undefined,
        }),
      })
      const data = await r.json()
      if (data.errors) return res.status(400).json({ error: data.errors[0]?.detail || 'Failed' })
      return res.status(200).json({ customerId: data.customer?.id, customer: data.customer })
    }

    // ── SEARCH CUSTOMER ──
    if (action === 'search-customer' && req.method === 'POST') {
      const { email, phone } = req.body
      const filters = []
      if (email) filters.push({ email_address: { exact: email } })
      if (phone) filters.push({ phone_number: { exact: phone } })

      const r = await fetch(`${SQUARE_BASE}/v2/customers/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: { filter: { or: filters } } }),
      })
      const data = await r.json()
      return res.status(200).json({ customers: data.customers || [] })
    }

    // ── CREATE INVOICE ──
    if (action === 'create' && req.method === 'POST') {
      const { locationId, customerId, items, dueDate, title, note } = req.body

      if (!locationId || !customerId) {
        return res.status(400).json({ error: 'locationId and customerId required' })
      }

      // Validate that all line item prices are positive numbers
      for (const item of (items || [])) {
        if (typeof item.unitPrice !== 'number' || !isFinite(item.unitPrice) || item.unitPrice <= 0) {
          return res.status(400).json({ error: `Invalid unitPrice for item "${item.description || 'unknown'}". Must be a positive number.` })
        }
      }

      // Build order first (Square invoices need an order)
      const orderLineItems = (items || []).map(item => ({
        name: item.description,
        quantity: String(item.quantity || 1),
        base_price_money: {
          amount: Math.round((item.unitPrice || 0) * 100), // cents
          currency: 'USD',
        },
      }))

      const orderRes = await fetch(`${SQUARE_BASE}/v2/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idempotency_key: `order_${Date.now()}`,
          order: {
            location_id: locationId,
            customer_id: customerId,
            line_items: orderLineItems,
          },
        }),
      })
      const orderData = await orderRes.json()
      if (orderData.errors) return res.status(400).json({ error: orderData.errors[0]?.detail || 'Order failed' })

      const orderId = orderData.order?.id

      // Create invoice
      const invoiceRes = await fetch(`${SQUARE_BASE}/v2/invoices`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idempotency_key: `inv_${Date.now()}`,
          invoice: {
            location_id: locationId,
            order_id: orderId,
            title: title || 'Cleaning Service Invoice',
            description: note || '',
            payment_requests: [{
              request_type: 'BALANCE',
              due_date: dueDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
              automatic_payment_source: 'NONE',
              reminders: [
                { relative_scheduled_days: -1, message: 'Your invoice is due tomorrow.' },
                { relative_scheduled_days: 0, message: 'Your invoice is due today.' },
                { relative_scheduled_days: 1, message: 'Your invoice is 1 day overdue.' },
              ],
            }],
            delivery_method: 'EMAIL',
            accepted_payment_methods: {
              card: true,
              square_gift_card: false,
              bank_account: true,
            },
            primary_recipient: { customer_id: customerId },
          },
        }),
      })
      const invoiceData = await invoiceRes.json()
      if (invoiceData.errors) return res.status(400).json({ error: invoiceData.errors[0]?.detail || 'Invoice creation failed' })

      return res.status(200).json({
        invoiceId: invoiceData.invoice?.id,
        invoiceNumber: invoiceData.invoice?.invoice_number,
        status: invoiceData.invoice?.status,
        publicUrl: invoiceData.invoice?.public_url,
        invoice: invoiceData.invoice,
      })
    }

    // ── PUBLISH (SEND) INVOICE ──
    if (action === 'send' && req.method === 'POST') {
      const { invoiceId, version } = req.body

      const r = await fetch(`${SQUARE_BASE}/v2/invoices/${invoiceId}/publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idempotency_key: `pub_${Date.now()}`,
          version: version || 0,
        }),
      })
      const data = await r.json()
      if (data.errors) return res.status(400).json({ error: data.errors[0]?.detail || 'Publish failed' })

      return res.status(200).json({
        invoiceId: data.invoice?.id,
        status: data.invoice?.status,
        publicUrl: data.invoice?.public_url,
      })
    }

    // ── LIST INVOICES ──
    if (action === 'list') {
      const locationId = req.query.locationId
      if (!locationId) {
        // Get first location
        const locRes = await fetch(`${SQUARE_BASE}/v2/locations`, { headers })
        const locData = await locRes.json()
        const loc = locData.locations?.[0]
        if (!loc) return res.status(400).json({ error: 'No Square location found' })
        return res.status(200).json({ error: 'locationId required', locations: locData.locations })
      }

      const r = await fetch(`${SQUARE_BASE}/v2/invoices?location_id=${locationId}`, { headers })
      const data = await r.json()
      return res.status(200).json({ invoices: data.invoices || [] })
    }

    // ── PAYMENT WEBHOOK — Square sends payment confirmation ──
    if (action === 'payment-webhook' && req.method === 'POST') {
      const event = req.body
      const eventType = event?.type || ''

      // Handle invoice.payment_made and payment.completed events
      if (eventType.includes('invoice') || eventType.includes('payment')) {
        const invoiceId = event?.data?.object?.invoice?.id || event?.data?.id
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

        if (supabaseUrl && supabaseKey && invoiceId) {
          const sbH = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' }
          try {
            // Find invoice by square_invoice_id
            const invRes = await fetch(`${supabaseUrl}/rest/v1/invoices?square_invoice_id=eq.${invoiceId}&select=id,status`, { headers: sbH })
            const invoices = await invRes.json()
            if (invoices?.length) {
              await fetch(`${supabaseUrl}/rest/v1/invoices?id=eq.${invoices[0].id}`, {
                method: 'PATCH', headers: sbH,
                body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString() }),
              })
              // Log payment
              await fetch(`${supabaseUrl}/rest/v1/payment_transactions`, {
                method: 'POST', headers: sbH,
                body: JSON.stringify({
                  invoice_id: invoices[0].id,
                  provider: 'square',
                  external_id: event?.data?.id || invoiceId,
                  amount: event?.data?.object?.payment?.amount_money?.amount ? event.data.object.payment.amount_money.amount / 100 : null,
                  status: 'completed',
                  paid_at: new Date().toISOString(),
                }),
              }).catch(() => {})
            }
          } catch (e) { console.error('Payment webhook processing failed:', e) }
        }
      }

      return res.status(200).json({ received: true })
    }

    // ── PAYROLL RUN — push payroll data to Square ──
    if (action === 'payroll-run' && req.method === 'POST') {
      const { employees, periodStart, periodEnd } = req.body
      if (!employees?.length) return res.status(400).json({ error: 'employees array required' })

      // Export CSV and store in Supabase for audit
      const csvLines = ['Employee Name,Hours Worked,Hourly Rate,Gross Pay,Mileage Reimbursement,Total Compensation']
      for (const emp of employees) {
        csvLines.push([`"${emp.name}"`, emp.hours, emp.rate || '', emp.pay, emp.mileageReimbursement || 0, emp.totalComp || emp.pay].join(','))
      }

      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
      if (supabaseUrl && supabaseKey) {
        try {
          await fetch(`${supabaseUrl}/rest/v1/payroll_exports`, {
            method: 'POST',
            headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              period_start: periodStart || new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
              period_end: periodEnd || new Date().toISOString().split('T')[0],
              employee_count: employees.length,
              total_hours: employees.reduce((s, e) => s + (e.hours || 0), 0),
              total_pay: employees.reduce((s, e) => s + (e.pay || 0), 0),
              total_mileage_reimbursement: employees.reduce((s, e) => s + (e.mileageReimbursement || 0), 0),
              csv_data: csvLines.join('\n'),
              status: 'exported',
            }),
          })
        } catch (e) { console.error('Payroll export failed:', e) }
      }

      return res.status(200).json({
        success: true,
        employees: employees.length,
        totalPay: employees.reduce((s, e) => s + (e.pay || 0), 0),
        totalMileage: employees.reduce((s, e) => s + (e.mileageReimbursement || 0), 0),
        csv: csvLines.join('\n'),
        note: 'Payroll exported. Import the CSV into Square Payroll, or use Square Payroll API when your plan supports it.',
      })
    }

    return res.status(400).json({ error: 'Unknown action. Payroll: team, wages, export, adjustment, payroll-run. Invoice: location, create-customer, search-customer, create, send, list. Webhook: payment-webhook' })
  } catch (err) {
    console.error('Square handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
