// Vercel serverless: Client Portal
// Public page — no auth required, accessed via unique client ID
// GET /api/portal?clientId=xxx — returns client's schedule + invoices

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
    const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=name,email,phone`, { headers: sbHeaders })
    const clients = await clientRes.json()
    if (!clients?.length) return res.status(404).json({ error: 'Client not found' })
    const client = clients[0]

    // Fetch upcoming jobs
    const today = new Date().toISOString().split('T')[0]
    const jobsRes = await fetch(`${supabaseUrl}/rest/v1/jobs?client_id=eq.${clientId}&date=gte.${today}&status=in.(scheduled,in-progress)&order=date.asc&limit=20`, { headers: sbHeaders })
    const jobs = await jobsRes.json()

    // Fetch recent invoices
    const invoicesRes = await fetch(`${supabaseUrl}/rest/v1/invoices?client_id=eq.${clientId}&order=issue_date.desc&limit=20`, { headers: sbHeaders })
    const invoices = await invoicesRes.json()

    // Only expose safe fields
    return res.status(200).json({
      client: { name: client.name },
      upcomingJobs: (jobs || []).map(j => ({
        title: j.title, date: j.date, startTime: j.start_time, status: j.status,
      })),
      invoices: (invoices || []).map(i => ({
        invoiceNumber: i.invoice_number, issueDate: i.issue_date, dueDate: i.due_date,
        total: parseFloat(i.total) || 0, status: i.status,
        paymentUrl: i.stripe_payment_url || i.square_public_url || null,
      })),
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
