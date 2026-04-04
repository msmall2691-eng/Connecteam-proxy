// Vercel serverless: Stripe payment links for invoices
// Creates a Stripe Checkout session and returns a payment URL
// Requires STRIPE_SECRET_KEY in env
// Requires STRIPE_WEBHOOK_SECRET for webhook signature verification

import crypto from 'crypto'
import { requireAuth, setAdminCors } from './_auth.js'

export default async function handler(req, res) {
  const action = req.query.action || req.body?.action

  // Webhook is public (Stripe posts here)
  if (action === 'webhook') {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else {
    setAdminCors(req, res)
    const user = await requireAuth(req, res)
    if (!user) return
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')

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
      if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'amount required and must be positive (in dollars)' })

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
      // Verify Stripe webhook signature
      const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
      if (WEBHOOK_SECRET) {
        const sig = req.headers['stripe-signature']
        if (!sig) return res.status(401).json({ error: 'Missing Stripe signature header' })

        // Stripe signatures use HMAC-SHA256: t=timestamp,v1=signature
        const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
        const parts = Object.fromEntries(sig.split(',').map(p => p.split('=')))
        const expectedSig = crypto.createHmac('sha256', WEBHOOK_SECRET)
          .update(`${parts.t}.${rawBody}`)
          .digest('hex')

        if (!crypto.timingSafeEqual(Buffer.from(parts.v1 || ''), Buffer.from(expectedSig))) {
          return res.status(401).json({ error: 'Invalid Stripe webhook signature' })
        }
      } else {
        console.warn('STRIPE_WEBHOOK_SECRET not set — webhook signature verification skipped')
      }

      const event = req.body
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object
        const invoiceNumber = session.metadata?.invoice_number
        // Update invoice in Supabase
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
        if (supabaseUrl && supabaseKey && invoiceNumber && session.payment_status === 'paid') {
          await fetch(`${supabaseUrl}/rest/v1/invoices?invoice_number=eq.${invoiceNumber}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
            body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString(), payment_method: 'stripe', stripe_payment_url: session.url }),
          })
        }
      }
      return res.status(200).json({ received: true })
    }

    // ── SAVE CARD (create Setup Intent for card-on-file) ──
    if (action === 'save-card' && req.method === 'POST') {
      const { clientName, clientEmail, clientId } = req.body
      if (!clientEmail) return res.status(400).json({ error: 'clientEmail required' })

      // Find or create Stripe customer
      let customerId = null
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

      if (supabaseUrl && supabaseKey && clientId) {
        const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
        const cRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=stripe_customer_id`, { headers: sbHeaders })
        const clients = await cRes.json()
        customerId = clients?.[0]?.stripe_customer_id
      }

      if (!customerId) {
        const params = new URLSearchParams()
        params.append('email', clientEmail)
        if (clientName) params.append('name', clientName)
        if (clientId) params.append('metadata[client_id]', clientId)
        const custRes = await fetch(`${stripeBase}/customers`, { method: 'POST', headers, body: params })
        const customer = await custRes.json()
        if (customer.error) return res.status(400).json({ error: customer.error.message })
        customerId = customer.id

        // Save to Supabase
        if (supabaseUrl && supabaseKey && clientId) {
          await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`, {
            method: 'PATCH',
            headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stripe_customer_id: customerId }),
          }).catch(() => {})
        }
      }

      // Create Setup Intent (for saving card without charging)
      const siParams = new URLSearchParams()
      siParams.append('customer', customerId)
      siParams.append('payment_method_types[]', 'card')
      siParams.append('usage', 'off_session')
      const siRes = await fetch(`${stripeBase}/setup_intents`, { method: 'POST', headers, body: siParams })
      const si = await siRes.json()
      if (si.error) return res.status(400).json({ error: si.error.message })

      return res.status(200).json({ clientSecret: si.client_secret, customerId, setupIntentId: si.id })
    }

    // ── CHARGE CARD ON FILE (auto-pay for completed visits) ──
    if (action === 'charge-card' && req.method === 'POST') {
      const { stripeCustomerId, amount, description, invoiceNumber, clientId } = req.body
      if (!stripeCustomerId || !amount) return res.status(400).json({ error: 'stripeCustomerId and amount required' })

      const amountCents = Math.round(parseFloat(amount) * 100)
      if (amountCents <= 0) return res.status(400).json({ error: 'amount must be positive' })

      // Get default payment method
      const custRes = await fetch(`${stripeBase}/customers/${stripeCustomerId}`, { headers })
      const customer = await custRes.json()
      if (customer.error) return res.status(400).json({ error: customer.error.message })

      const paymentMethod = customer.invoice_settings?.default_payment_method || customer.default_source
      if (!paymentMethod) {
        return res.status(400).json({ error: 'No card on file for this customer. Send a save-card link first.' })
      }

      // Create PaymentIntent and charge immediately
      const piParams = new URLSearchParams()
      piParams.append('amount', String(amountCents))
      piParams.append('currency', 'usd')
      piParams.append('customer', stripeCustomerId)
      piParams.append('payment_method', paymentMethod)
      piParams.append('off_session', 'true')
      piParams.append('confirm', 'true')
      if (description) piParams.append('description', description)
      if (invoiceNumber) piParams.append('metadata[invoice_number]', invoiceNumber)
      if (clientId) piParams.append('metadata[client_id]', clientId)

      const piRes = await fetch(`${stripeBase}/payment_intents`, { method: 'POST', headers, body: piParams })
      const pi = await piRes.json()

      if (pi.error) {
        return res.status(400).json({ error: pi.error.message, code: pi.error.code })
      }

      // Update invoice if paid
      if (pi.status === 'succeeded' && invoiceNumber) {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
        if (supabaseUrl && supabaseKey) {
          await fetch(`${supabaseUrl}/rest/v1/invoices?invoice_number=eq.${invoiceNumber}`, {
            method: 'PATCH',
            headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString(), payment_method: 'stripe_auto' }),
          }).catch(() => {})
        }
      }

      return res.status(200).json({
        paid: pi.status === 'succeeded',
        status: pi.status,
        paymentIntentId: pi.id,
        amount: parseFloat(amount),
      })
    }

    return res.status(400).json({ error: 'Unknown action. Use: create-payment, save-card, charge-card, check, webhook' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
