// Vercel serverless: Client Portal
// Public page — no auth required, accessed via unique client ID
// GET /api/portal?clientId=xxx — returns full client journey (requests, quotes, visits, invoices)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // Support both direct ID and signed token
  let clientId = req.query.clientId || req.query.id
  const token = req.query.token

  // If token provided, decode it (simple base64 obfuscation + timestamp check)
  if (token && !clientId) {
    try {
      const decoded = Buffer.from(token, 'base64url').toString()
      const [id, ts] = decoded.split('|')
      // Token valid for 365 days
      if (Date.now() - parseInt(ts) < 365 * 86400000) clientId = id
    } catch {}
  }

  if (!clientId) return res.status(400).json({ error: 'Invalid portal link' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Database not configured' })
  }

  const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }

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

    // Fetch all jobs (upcoming + past completed)
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
        upcomingVisits: (jobs || []).filter(j => j.date >= today && j.status === 'scheduled').length,
        completedVisits: (jobs || []).filter(j => j.status === 'completed').length,
        totalInvoiced: (invoices || []).reduce((s, i) => s + (parseFloat(i.total) || 0), 0),
        totalPaid: (invoices || []).filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.total) || 0), 0),
        outstanding: (invoices || []).filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (parseFloat(i.total) || 0), 0),
      },
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
