// Vercel serverless: Client-facing endpoints (consolidated)
// Combines portal + quote-approve into one function to stay within Hobby plan limit
//
// Portal routes:
//   GET  /api/client?action=portal&token=xxx — token-based portal access
//   POST /api/client?action=confirm&visitId=xxx&token=xxx — confirm a visit
//   POST /api/client?action=confirm-token&confirmToken=xxx — confirm via SMS/email link
//
// Quote routes:
//   GET  /api/client?action=quote&token=xxx — fetch quote for client review
//   POST /api/client?action=quote&token=xxx — accept quote with signature
//   POST /api/client?action=decline&token=xxx — decline quote

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
  const action = req.query.action || 'portal'

  // ── QUOTE ROUTES ──
  if (action === 'quote' || action === 'decline') {
    return handleQuote(req, res, supabaseUrl, sbHeaders, action)
  }

  // ── PORTAL ROUTES ──
  return handlePortal(req, res, supabaseUrl, sbHeaders, action)
}

// ════════════════════════════════════════════════════════════
// PORTAL HANDLER
// ════════════════════════════════════════════════════════════

async function handlePortal(req, res, supabaseUrl, sbHeaders, action) {
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
        await fetch(`${supabaseUrl}/rest/v1/client_schedule_tokens?token=eq.${token}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify({ last_accessed_at: new Date().toISOString() }),
        }).catch(() => {})
      }
    } catch {}
  }

  // Method 2: Legacy base64 token (30-day expiry)
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
    const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=name,email,phone,company_name`, { headers: sbHeaders })
    const clients = await clientRes.json()
    if (!clients?.length) return res.status(404).json({ error: 'Client not found' })
    const client = clients[0]

    const propsRes = await fetch(`${supabaseUrl}/rest/v1/properties?client_id=eq.${clientId}&select=name,address_line1,city,state,type&order=is_primary.desc`, { headers: sbHeaders })
    const properties = await propsRes.json()

    const quotesRes = await fetch(`${supabaseUrl}/rest/v1/quotes?client_id=eq.${clientId}&status=in.(sent,accepted,signed,draft)&order=created_at.desc&limit=20`, { headers: sbHeaders })
    const quotes = await quotesRes.json()

    const visitsRes = await fetch(`${supabaseUrl}/rest/v1/visits?client_id=eq.${clientId}&client_visible=eq.true&order=scheduled_date.desc&limit=50&select=*,job:jobs(title,service_type,price)`, { headers: sbHeaders })
    const visits = await visitsRes.json()

    const jobsRes = await fetch(`${supabaseUrl}/rest/v1/jobs?client_id=eq.${clientId}&order=date.desc&limit=50`, { headers: sbHeaders })
    const jobs = await jobsRes.json()

    const invoicesRes = await fetch(`${supabaseUrl}/rest/v1/invoices?client_id=eq.${clientId}&order=issue_date.desc&limit=20`, { headers: sbHeaders })
    const invoices = await invoicesRes.json()

    let requests = []
    try {
      const reqRes = await fetch(`${supabaseUrl}/rest/v1/website_requests?client_id=eq.${clientId}&order=created_at.desc&limit=10`, { headers: sbHeaders })
      requests = await reqRes.json()
    } catch {}

    const today = new Date().toISOString().split('T')[0]

    return res.status(200).json({
      client: { name: client.name, companyName: client.company_name || '' },
      properties: (properties || []).map(p => ({
        name: p.name,
        address: [p.address_line1, p.city, p.state].filter(Boolean).join(', '),
        type: p.type,
      })),
      requests: (requests || []).map(r => ({
        service: r.service, status: r.status, createdAt: r.created_at,
      })),
      quotes: (quotes || []).map(q => ({
        quoteNumber: q.quote_number, serviceType: q.service_type, frequency: q.frequency,
        estimateMin: parseFloat(q.estimate_min) || 0, estimateMax: parseFloat(q.estimate_max) || 0,
        finalPrice: parseFloat(q.final_price) || 0, status: q.status,
        sentAt: q.sent_at, acceptedAt: q.accepted_at, expiresAt: q.expires_at,
      })),
      upcomingVisits: (visits || []).filter(v => v.scheduled_date >= today && !['cancelled', 'skipped'].includes(v.status)).map(v => ({
        title: v.job?.title || 'Cleaning', date: v.scheduled_date,
        startTime: v.scheduled_start_time, endTime: v.scheduled_end_time,
        status: v.status, serviceType: v.job?.service_type,
        address: v.address, confirmedAt: v.confirmed_at,
      })),
      completedVisits: (visits || []).filter(v => v.status === 'completed').map(v => ({
        title: v.job?.title || 'Cleaning', date: v.scheduled_date,
        serviceType: v.job?.service_type, clientRating: v.client_rating,
      })),
      upcomingJobs: (jobs || []).filter(j => j.date >= today && j.status !== 'cancelled').map(j => ({
        title: j.title, date: j.date, startTime: j.start_time,
        status: j.status, serviceType: j.service_type,
      })),
      completedJobs: (jobs || []).filter(j => j.status === 'completed').map(j => ({
        title: j.title, date: j.date, serviceType: j.service_type,
      })),
      invoices: (invoices || []).map(i => ({
        invoiceNumber: i.invoice_number, issueDate: i.issue_date, dueDate: i.due_date,
        total: parseFloat(i.total) || 0, status: i.status, paidAt: i.paid_at,
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

// ════════════════════════════════════════════════════════════
// QUOTE APPROVAL HANDLER
// ════════════════════════════════════════════════════════════

async function handleQuote(req, res, supabaseUrl, sbHeaders, action) {
  const token = req.query.token
  if (!token) return res.status(400).json({ error: 'Missing token' })

  let quoteId, clientId, tokenTs
  try {
    const decoded = Buffer.from(token, 'base64url').toString()
    const parts = decoded.split('|')
    quoteId = parts[0]
    clientId = parts[1]
    tokenTs = parseInt(parts[2])
    const TOKEN_SECRET = process.env.QUOTE_TOKEN_SECRET
    if (TOKEN_SECRET && parts.length >= 4) {
      const payload = `${quoteId}|${clientId}|${tokenTs}`
      const expectedHmac = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex')
      if (!crypto.timingSafeEqual(Buffer.from(parts[3]), Buffer.from(expectedHmac))) {
        return res.status(400).json({ error: 'Invalid token' })
      }
    }
    if (Date.now() - tokenTs > 90 * 86400000) {
      return res.status(410).json({ error: 'This quote link has expired. Please contact us for a new quote.' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid token' })
  }

  try {
    const quoteRes = await fetch(`${supabaseUrl}/rest/v1/quotes?id=eq.${quoteId}&client_id=eq.${clientId}&select=*`, { headers: sbHeaders })
    const quotes = await quoteRes.json()
    if (!quotes?.length) return res.status(404).json({ error: 'Quote not found' })
    const quote = quotes[0]

    const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=id,name,email,phone,address`, { headers: sbHeaders })
    const clients = await clientRes.json()
    const client = clients?.[0]

    let property = null
    if (quote.property_id) {
      const propRes = await fetch(`${supabaseUrl}/rest/v1/properties?id=eq.${quote.property_id}&select=*`, { headers: sbHeaders })
      const props = await propRes.json()
      property = props?.[0]
    }

    // ── GET: Return quote details for client review ──
    if (req.method === 'GET') {
      if (quote.status === 'sent' && !quote.viewed_at) {
        await fetch(`${supabaseUrl}/rest/v1/quotes?id=eq.${quoteId}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify({ viewed_at: new Date().toISOString() }),
        })
      }

      return res.status(200).json({
        quote: {
          id: quote.id, quoteNumber: quote.quote_number, serviceType: quote.service_type,
          frequency: quote.frequency, estimateMin: parseFloat(quote.estimate_min) || 0,
          estimateMax: parseFloat(quote.estimate_max) || 0, finalPrice: parseFloat(quote.final_price) || 0,
          items: quote.items || [], status: quote.status, expiresAt: quote.expires_at,
          notes: quote.notes, createdAt: quote.created_at,
        },
        client: { name: client?.name || '' },
        property: property ? {
          address: property.address_line1, sqft: property.sqft,
          bedrooms: property.bedrooms, bathrooms: property.bathrooms,
        } : null,
      })
    }

    // ── POST: Accept or decline ──
    if (req.method === 'POST') {
      if (quote.status === 'accepted') return res.status(400).json({ error: 'This quote has already been accepted.' })
      if (quote.status === 'declined') return res.status(400).json({ error: 'This quote has been declined.' })
      if (quote.status === 'expired') return res.status(400).json({ error: 'This quote has expired. Please contact us for a new quote.' })

      // ── DECLINE ──
      if (action === 'decline') {
        const { reason } = req.body || {}
        await fetch(`${supabaseUrl}/rest/v1/quotes?id=eq.${quoteId}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify({
            status: 'declined', declined_at: new Date().toISOString(),
            notes: reason ? `${quote.notes || ''}\nDecline reason: ${reason}`.trim() : quote.notes,
          }),
        })
        return res.status(200).json({ success: true, message: 'Quote declined.' })
      }

      // ── ACCEPT with signature ──
      const { signature, signerName, preferredDay, preferredTime } = req.body || {}
      if (!signature) return res.status(400).json({ error: 'Signature is required to approve this quote.' })

      const signatureData = {
        signature, signerName: signerName || client?.name || '',
        signedAt: new Date().toISOString(),
        ipAddress: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      }

      // 1. Update quote as accepted
      await fetch(`${supabaseUrl}/rest/v1/quotes?id=eq.${quoteId}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({
          status: 'accepted', accepted_at: new Date().toISOString(), signature_data: signatureData,
          preferred_day: preferredDay || quote.preferred_day,
          preferred_time: preferredTime || quote.preferred_time || '09:00',
        }),
      })

      // 2. Update client status to active
      await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ status: 'active' }),
      })

      // 3. Create the first scheduled job
      const jobDate = calculateFirstDate(preferredDay || quote.preferred_day || 1)
      const startTime = preferredTime || quote.preferred_time || '09:00'
      const [h, m] = startTime.split(':').map(Number)
      const endTime = `${String(Math.min(23, h + 3)).padStart(2, '0')}:${String(m).padStart(2, '0')}`

      const isDeep = quote.service_type === 'deep' || quote.service_type === 'move-in-out'
      const jobTitle = (quote.items?.[0]?.description) || `${isDeep ? 'Deep' : 'Standard'} Cleaning`

      let serviceTypeId = null
      try {
        const stName = isDeep ? 'Deep Clean' : 'Standard Clean'
        const stRes = await fetch(`${supabaseUrl}/rest/v1/service_types?name=eq.${encodeURIComponent(stName)}&select=id`, { headers: sbHeaders })
        serviceTypeId = (await stRes.json())?.[0]?.id || null
      } catch {}

      const jobPayload = {
        client_id: clientId, client_name: client?.name || 'Client', property_id: quote.property_id,
        quote_id: quoteId, title: jobTitle, date: jobDate, start_time: startTime, end_time: endTime,
        status: 'scheduled', price: quote.final_price, price_type: 'flat',
        service_type: quote.service_type, address: property?.address_line1 || client?.address || '',
        is_recurring: quote.frequency !== 'one-time',
        recurrence_rule: quote.frequency === 'one-time' ? null : quote.frequency,
        recurrence_day: preferredDay || quote.preferred_day || 1,
        service_type_id: serviceTypeId, source: quote.frequency === 'one-time' ? 'one_off' : 'quote',
        is_active: true, recurrence_start_date: jobDate,
        preferred_start_time: startTime, preferred_end_time: endTime,
      }

      const jobRes = await fetch(`${supabaseUrl}/rest/v1/jobs`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(jobPayload),
      })
      const jobs = await jobRes.json()
      const job = jobs?.[0]

      // 3b. Create the first visit
      let visitId = null
      if (job?.id) {
        try {
          const visitRes = await fetch(`${supabaseUrl}/rest/v1/visits`, {
            method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
            body: JSON.stringify({
              job_id: job.id, client_id: clientId, property_id: quote.property_id,
              scheduled_date: jobDate, scheduled_start_time: startTime, scheduled_end_time: endTime,
              status: 'scheduled', source: quote.frequency === 'one-time' ? 'one_off' : 'recurring',
              service_type_id: serviceTypeId,
              address: property?.address_line1 || client?.address || '', client_visible: true,
            }),
          })
          visitId = (await visitRes.json())?.[0]?.id
        } catch {}
      }

      // 4. Push to Google Calendar
      let calendarEventId = null
      const gcClientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID
      const gcClientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET
      const gcRefreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN

      if (gcClientId && gcClientSecret && gcRefreshToken) {
        try {
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: gcClientId, client_secret: gcClientSecret, refresh_token: gcRefreshToken, grant_type: 'refresh_token' }),
          })
          const tokenData = await tokenRes.json()
          if (tokenData.access_token) {
            const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
              method: 'POST',
              headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                summary: `${isDeep ? 'Deep Clean' : 'Cleaning'} — ${client?.name || 'Client'}`,
                description: `${client?.name}\n${property?.address_line1 || ''}\nQuote #${quote.quote_number}\nPrice: $${quote.final_price}`,
                start: { dateTime: `${jobDate}T${startTime}:00`, timeZone: 'America/New_York' },
                end: { dateTime: `${jobDate}T${endTime}:00`, timeZone: 'America/New_York' },
                location: property?.address_line1 || client?.address || '',
              }),
            })
            calendarEventId = (await calRes.json()).id

            if (visitId && calendarEventId) {
              await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}`, {
                method: 'PATCH', headers: sbHeaders,
                body: JSON.stringify({ google_event_id: calendarEventId }),
              })
              await fetch(`${supabaseUrl}/rest/v1/calendar_sync_log`, {
                method: 'POST', headers: sbHeaders,
                body: JSON.stringify({ visit_id: visitId, provider: 'google_calendar', external_id: calendarEventId, direction: 'outbound', sync_status: 'synced' }),
              }).catch(() => {})
            }
            if (job?.id && calendarEventId) {
              await fetch(`${supabaseUrl}/rest/v1/jobs?id=eq.${job.id}`, {
                method: 'PATCH', headers: sbHeaders,
                body: JSON.stringify({ google_event_id: calendarEventId }),
              })
            }
          }
        } catch {}
      }

      // 5. Send confirmation email
      if (client?.email && gcClientId) {
        try {
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: gcClientId, client_secret: gcClientSecret, refresh_token: gcRefreshToken, grant_type: 'refresh_token' }),
          })
          const tokenData = await tokenRes.json()
          if (tokenData.access_token) {
            const confirmHtml = buildConfirmationEmail(client.name, jobTitle, jobDate, startTime, property?.address_line1, quote.final_price, quote.frequency)
            const rawEmail = `To: ${client.email}\r\nSubject: Booking Confirmed — The Maine Cleaning Co.\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${confirmHtml}`
            await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
              method: 'POST',
              headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw: Buffer.from(rawEmail).toString('base64url') }),
            })
          }
        } catch {}
      }

      return res.status(200).json({
        success: true, message: 'Quote accepted! Your cleaning has been scheduled.',
        job: job ? { id: job.id, date: job.date, startTime: job.start_time } : null,
      })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('Quote approve error:', err)
    return res.status(500).json({ error: err.message })
  }
}

function calculateFirstDate(preferredDay) {
  const now = new Date()
  const target = new Date(now)
  target.setDate(target.getDate() + 3)
  while (target.getDay() !== preferredDay) {
    target.setDate(target.getDate() + 1)
  }
  return target.toISOString().split('T')[0]
}

function buildConfirmationEmail(clientName, service, date, time, address, price, frequency) {
  const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const freqLabel = frequency === 'one-time' ? 'One-Time' : frequency === 'weekly' ? 'Weekly' : frequency === 'biweekly' ? 'Every 2 Weeks' : 'Monthly'

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
  <div style="text-align:center;padding:24px 0;">
    <h1 style="font-size:20px;color:#1e40af;margin:0;">The Maine Cleaning Co.</h1>
  </div>
  <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:16px;">
    <div style="text-align:center;margin-bottom:20px;">
      <div style="display:inline-block;background:#dcfce7;color:#16a34a;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;">Booking Confirmed</div>
    </div>
    <p style="color:#334155;font-size:15px;margin:0 0 16px;">Hi ${clientName.split(' ')[0]},</p>
    <p style="color:#334155;font-size:15px;margin:0 0 20px;">Your cleaning has been scheduled! Here are the details:</p>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Service</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${service}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">First Cleaning</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${formattedDate}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Time</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${time}</td></tr>
        ${address ? `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Address</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${address}</td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Frequency</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${freqLabel}</td></tr>
        <tr style="border-top:1px solid #e2e8f0;"><td style="padding:10px 0 6px;color:#64748b;font-size:13px;">Price</td><td style="padding:10px 0 6px;color:#1e40af;font-size:16px;font-weight:700;text-align:right;">$${parseFloat(price).toFixed(2)}/clean</td></tr>
      </table>
    </div>
    <p style="color:#64748b;font-size:13px;margin:0;">We'll send a reminder before your first cleaning. If you need to reschedule, just reply to this email or call us.</p>
  </div>
  <div style="text-align:center;padding:16px 0;font-size:12px;color:#94a3b8;">
    The Maine Cleaning & Property Management Co.<br>(207) 572-0502 · office@mainecleaningco.com
  </div>
</div>
</body></html>`
}
