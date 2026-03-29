// Vercel serverless: Square Invoicing API
// Creates and sends invoices via Square for payment
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

  const action = req.query.action || req.body?.action

  try {
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

    return res.status(400).json({ error: 'Unknown action. Use: location, create-customer, create, send, list' })
  } catch (err) {
    console.error('Square invoice error:', err)
    return res.status(500).json({ error: err.message })
  }
}
