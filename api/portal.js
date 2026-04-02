// Vercel serverless: Client Portal
// Public page — no auth required, accessed via schedule token
// GET  /api/portal?token=xxx — token-based access via client_schedule_tokens
// POST /api/portal?action=confirm&visitId=xxx&token=xxx — client confirms a visit

import crypto from 'crypto'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Database not configured' })
  }

  const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' }
  const action = req.query.action || ''

  // Resolve client ID from various token types
  let clientId = req.query.clientId || req.query.id
  const token = req.query.token

  // Method 1: client_schedule_tokens table (v6+)
  if (token && !clientId) {
    try {
      const tokenRes = await fetch(
        `${supabaseUrl}/rest/v1/client_schedule_tokens?token=eq.${token}&is_active=eq.true&select=client_id`,
        { headers: sbHeaders }
      )
      const tokens = await tokenRes.json()
      if (tokens?.length) {
        clientId = tokens[0].client_id
        // Update last_accessed_at
        await fetch(`${supabaseUrl}/rest/v1/client_schedule_tokens?token=eq.${token}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify({ last_accessed_at: new Date().toISOString() }),
        }).catch(() => {})
      }
    } catch {}
  }

  // Method 2: Legacy base64 token (30-day expiry, reduced from 365 days)
  if (token && !clientId) {
    try {
      const decoded = Buffer.from(token, 'base64url').toString()
      const [id, ts] = decoded.split('|')
      if (Date.now() - parseInt(ts) < 30 * 86400000) clientId = id
    } catch {}
  }

  if (!clientId) return res.status(400).json({ error: 'Invalid portal link' })

  // ── POST: Confirm a visit ──
  if (req.method === 'POST' && action === 'confirm') {
    const visitId = req.query.visitId || req.body?.visitId
    if (!visitId) return res.status(400).json({ error: 'visitId required' })

    try {
      // Verify visit belongs to this client
      const vRes = await fetch(
        `${supabaseUrl}/rest/v1/visits?id=eq.${visitId}&client_id=eq.${clientId}&select=id,status`,
        { headers: sbHeaders }
      )
      const visits = await vRes.json()
      if (!visits?.length) return res.status(404).json({ error: 'Visit not found' })

      await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString() }),
      })

      return res.status(200).json({ success: true, message: 'Visit confirmed!' })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ── POST: Confirm via confirm_token (from SMS/email link) ──
  if (req.method === 'POST' && action === 'confirm-token') {
    const confirmToken = req.query.confirmToken || req.body?.confirmToken
    if (!confirmToken) return res.status(400).json({ error: 'confirmToken required' })

    try {
      const vRes = await fetch(
        `${supabaseUrl}/rest/v1/visits?confirm_token=eq.${confirmToken}&select=id,status,client_id`,
        { headers: sbHeaders }
      )
      const visits = await vRes.json()
      if (!visits?.length) return res.status(404).json({ error: 'Invalid confirmation link' })

      await fetch(`${supabaseUrl}/rest/v1/visits?confirm_token=eq.${confirmToken}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString() }),
      })

      return res.status(200).json({ success: true, message: 'Your cleaning is confirmed! See you then.' })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ── GET: Return full client portal data ──
  try {
    // Fetch client
    const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=name,email,phone,company_name`, { headers: sbHeaders })
    const clients = await clientRes.json()
    if (!clients?.length) return res.status(404).json({ error: 'Client not found' })
    const client = clients[0]

    // Fetch properties
    const propsRes = await fetch(`${supabaseUrl}/rest/v1/properties?client_id=eq.${clientId}&select=name,address_line1,city,state,type&order=is_primary.desc`, { headers: sbHeaders })
    const properties = await propsRes.json()

    // Fetch quotes (sent, accepted, or signed)
    const quotesRes = await fetch(`${supabaseUrl}/rest/v1/quotes?client_id=eq.${clientId}&status=in.(sent,accepted,signed,draft)&order=created_at.desc&limit=20`, { headers: sbHeaders })
    const quotes = await quotesRes.json()

    // Fetch visits (the canonical schedule) with job titles
    const visitsRes = await fetch(`${supabaseUrl}/rest/v1/visits?client_id=eq.${clientId}&client_visible=eq.true&order=scheduled_date.desc&limit=50&select=*,job:jobs(title,service_type,price)`, { headers: sbHeaders })
    const visits = await visitsRes.json()

    // Also fetch jobs for backward compat (service agreements)
    const jobsRes = await fetch(`${supabaseUrl}/rest/v1/jobs?client_id=eq.${clientId}&order=date.desc&limit=50`, { headers: sbHeaders })
    const jobs = await jobsRes.json()

    // Fetch invoices
    const invoicesRes = await fetch(`${supabaseUrl}/rest/v1/invoices?client_id=eq.${clientId}&order=issue_date.desc&limit=20`, { headers: sbHeaders })
    const invoices = await invoicesRes.json()

    // Fetch website requests linked to this client
    let requests = []
    try {
      const reqRes = await fetch(`${supabaseUrl}/rest/v1/website_requests?client_id=eq.${clientId}&order=created_at.desc&limit=10`, { headers: sbHeaders })
      requests = await reqRes.json()
    } catch {}

    const today = new Date().toISOString().split('T')[0]

    // Only expose safe fields
    return res.status(200).json({
      client: {
        name: client.name,
        companyName: client.company_name || '',
      },
      properties: (properties || []).map(p => ({
        name: p.name,
        address: [p.address_line1, p.city, p.state].filter(Boolean).join(', '),
        type: p.type,
      })),
      requests: (requests || []).map(r => ({
        service: r.service,
        status: r.status,
        createdAt: r.created_at,
      })),
      quotes: (quotes || []).map(q => ({
        quoteNumber: q.quote_number,
        serviceType: q.service_type,
        frequency: q.frequency,
        estimateMin: parseFloat(q.estimate_min) || 0,
        estimateMax: parseFloat(q.estimate_max) || 0,
        finalPrice: parseFloat(q.final_price) || 0,
        status: q.status,
        sentAt: q.sent_at,
        acceptedAt: q.accepted_at,
        expiresAt: q.expires_at,
      })),
      upcomingVisits: (visits || []).filter(v => v.scheduled_date >= today && !['cancelled', 'skipped'].includes(v.status)).map(v => ({
        title: v.job?.title || 'Cleaning',
        date: v.scheduled_date,
        startTime: v.scheduled_start_time,
        endTime: v.scheduled_end_time,
        status: v.status,
        serviceType: v.job?.service_type,
        address: v.address,
        confirmedAt: v.confirmed_at,
      })),
      completedVisits: (visits || []).filter(v => v.status === 'completed').map(v => ({
        title: v.job?.title || 'Cleaning',
        date: v.scheduled_date,
        serviceType: v.job?.service_type,
        clientRating: v.client_rating,
      })),
      // Backward compat: keep job-based fields
      upcomingJobs: (jobs || []).filter(j => j.date >= today && j.status !== 'cancelled').map(j => ({
        title: j.title,
        date: j.date,
        startTime: j.start_time,
        status: j.status,
        serviceType: j.service_type,
      })),
      completedJobs: (jobs || []).filter(j => j.status === 'completed').map(j => ({
        title: j.title,
        date: j.date,
        serviceType: j.service_type,
      })),
      invoices: (invoices || []).map(i => ({
        invoiceNumber: i.invoice_number,
        issueDate: i.issue_date,
        dueDate: i.due_date,
        total: parseFloat(i.total) || 0,
        status: i.status,
        paidAt: i.paid_at,
        paymentUrl: i.stripe_payment_url || i.square_public_url || null,
      })),
      summary: {
        totalQuotes: (quotes || []).length,
        acceptedQuotes: (quotes || []).filter(q => q.status === 'accepted' || q.status === 'signed').length,
        upcomingVisits: (visits || []).filter(v => v.scheduled_date >= today && !['cancelled', 'skipped'].includes(v.status)).length,
        completedVisits: (visits || []).filter(v => v.status === 'completed').length,
        totalInvoiced: (invoices || []).reduce((s, i) => s + (parseFloat(i.total) || 0), 0),
        totalPaid: (invoices || []).filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.total) || 0), 0),
        outstanding: (invoices || []).filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (parseFloat(i.total) || 0), 0),
      },
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
