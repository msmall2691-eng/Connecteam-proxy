// Vercel serverless: Stripe payment links for invoices
// Creates a Stripe Checkout session and returns a payment URL
// Requires STRIPE_SECRET_KEY in env

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY
  if (!STRIPE_KEY) {
    return res.status(500).json({ error: 'Stripe not configured. Add STRIPE_SECRET_KEY to Vercel env.' })
  }

  const stripeBase = 'https://api.stripe.com/v1'
  const headers = {
    Authorization: `Bearer ${STRIPE_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  const action = req.query.action || req.body?.action

  try {
    // ── CREATE PAYMENT LINK ──
    if (action === 'create-payment' && req.method === 'POST') {
      const { invoiceNumber, clientName, clientEmail, amount, description } = req.body
      if (!amount) return res.status(400).json({ error: 'amount required (in dollars)' })

      const amountCents = Math.round(parseFloat(amount) * 100)

      // Create a Checkout Session
      const params = new URLSearchParams()
      params.append('mode', 'payment')
      params.append('success_url', `${req.headers.origin || 'https://connecteam-proxy.vercel.app'}/#/invoices?paid=${invoiceNumber}`)
      params.append('cancel_url', `${req.headers.origin || 'https://connecteam-proxy.vercel.app'}/#/invoices`)
      params.append('line_items[0][price_data][currency]', 'usd')
      params.append('line_items[0][price_data][product_data][name]', description || `Invoice ${invoiceNumber}`)
      params.append('line_items[0][price_data][unit_amount]', String(amountCents))
      params.append('line_items[0][quantity]', '1')
      if (clientEmail) params.append('customer_email', clientEmail)
      params.append('metadata[invoice_number]', invoiceNumber || '')
      params.append('metadata[client_name]', clientName || '')

      const sessionRes = await fetch(`${stripeBase}/checkout/sessions`, {
        method: 'POST', headers, body: params,
      })
      const session = await sessionRes.json()

      if (session.error) return res.status(400).json({ error: session.error.message })

      return res.status(200).json({
        sessionId: session.id,
        paymentUrl: session.url,
        invoiceNumber,
        amount: parseFloat(amount),
      })
    }

    // ── CHECK PAYMENT STATUS ──
    if (action === 'check' && req.query.sessionId) {
      const sessionRes = await fetch(`${stripeBase}/checkout/sessions/${req.query.sessionId}`, { headers })
      const session = await sessionRes.json()
      return res.status(200).json({
        status: session.payment_status,
        paid: session.payment_status === 'paid',
        amountTotal: session.amount_total / 100,
        customerEmail: session.customer_email,
      })
    }

    // ── WEBHOOK (Stripe sends payment confirmation) ──
    if (action === 'webhook' && req.method === 'POST') {
      const event = req.body
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object
        const invoiceNumber = session.metadata?.invoice_number
        // Update invoice in Supabase
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
        if (supabaseUrl && supabaseKey && invoiceNumber) {
          await fetch(`${supabaseUrl}/rest/v1/invoices?invoice_number=eq.${invoiceNumber}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
            body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString(), payment_method: 'stripe', stripe_payment_url: session.url }),
          })
        }
      }
      return res.status(200).json({ received: true })
    }

    return res.status(400).json({ error: 'Unknown action. Use: create-payment, check, webhook' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
