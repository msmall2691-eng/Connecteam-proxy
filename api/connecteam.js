// Consolidated Connecteam serverless function
// Routes: default (proxy), action=webhook, action=shift

import crypto from 'crypto'

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Webhook-Secret')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = req.query.action

  // ════════════════════════════════════════════════
  // ACTION: webhook — Connecteam Webhook Receiver
  // Receives real-time events (clock in/out, shift changes, etc.)
  // Set this URL in Connecteam → Settings → Webhooks
  // ════════════════════════════════════════════════
  if (action === 'webhook') {
    // Webhook verification (GET)
    if (req.method === 'GET') {
      return res.status(200).json({ status: 'Connecteam webhook endpoint active' })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

    // Verify webhook secret if configured
    const WEBHOOK_SECRET = process.env.CONNECTEAM_WEBHOOK_SECRET
    if (WEBHOOK_SECRET) {
      const providedSecret = req.headers['x-webhook-secret']
      if (!providedSecret || !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(WEBHOOK_SECRET))) {
        return res.status(401).json({ error: 'Invalid webhook secret' })
      }
    } else {
      console.warn('CONNECTEAM_WEBHOOK_SECRET not set — webhook authentication skipped')
    }

    try {
      const event = req.body
      const eventType = event.type || event.eventType || 'unknown'

      console.log(`Connecteam webhook: ${eventType}`, JSON.stringify(event).slice(0, 500))

      // Store event in Supabase for dashboard display
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

      // ── CLOCK IN/OUT ──
      if (eventType.includes('clock') || eventType.includes('time-activity')) {
        const data = event.data || event
        // Could update job status, send notification, etc.
        console.log('Clock event:', data)

        // Send email notification if configured
        await sendNotification(
          `Employee ${data.userName || 'someone'} clocked ${eventType.includes('in') ? 'IN' : 'OUT'}`,
          `Time: ${new Date().toLocaleString()}\nLocation: ${data.location || 'N/A'}`
        )
      }

      // ── SHIFT ACCEPTED/REJECTED ──
      if (eventType.includes('shift') && (eventType.includes('accept') || eventType.includes('reject'))) {
        const data = event.data || event
        const shiftAction = eventType.includes('accept') ? 'accepted' : 'rejected'
        console.log(`Shift ${shiftAction}:`, data)

        await sendNotification(
          `Shift ${shiftAction} by ${data.userName || 'employee'}`,
          `Shift: ${data.shiftTitle || 'N/A'}\nDate: ${data.date || 'N/A'}\n${shiftAction === 'rejected' ? `Reason: ${data.reason || 'No reason given'}` : ''}`
        )
      }

      // ── TIMESHEET SUBMITTED ──
      if (eventType.includes('timesheet')) {
        const data = event.data || event
        console.log('Timesheet event:', data)

        await sendNotification(
          `Timesheet ${data.status || 'updated'} by ${data.userName || 'employee'}`,
          `Period: ${data.startDate || '?'} to ${data.endDate || '?'}\nStatus: ${data.status || 'N/A'}`
        )
      }

      // ── FORM SUBMITTED ──
      if (eventType.includes('form')) {
        const data = event.data || event
        console.log('Form submission:', data)

        await sendNotification(
          `Form submitted: ${data.formName || 'Unknown form'}`,
          `By: ${data.userName || 'employee'}\nDate: ${new Date().toLocaleString()}`
        )
      }

      return res.status(200).json({ received: true, eventType })
    } catch (err) {
      console.error('Connecteam webhook error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  // ════════════════════════════════════════════════
  // ACTION: shift — Push shifts to Connecteam Scheduler
  // POST with action=shift — creates a shift in Connecteam
  // ════════════════════════════════════════════════
  if (action === 'shift') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

    const apiKey = req.headers['x-api-key']
    if (!apiKey) return res.status(400).json({ error: 'X-API-KEY header required' })

    const SCHEDULER_ID = 15248539

    const { title, date, startTime, endTime, notes, address, clientName, clientPhone, clientEmail, price, propertyName, assignee } = req.body
    if (!title || !date) return res.status(400).json({ error: 'title and date required' })

    const start = startTime || '09:00'
    const end = endTime || '12:00'
    const startTs = Math.floor(new Date(`${date}T${start}:00`).getTime() / 1000)
    const endTs = Math.floor(new Date(`${date}T${end}:00`).getTime() / 1000)

    // Build rich description with all job details
    const descParts = []
    if (clientName) descParts.push(`Client: ${clientName}`)
    if (clientPhone) descParts.push(`Phone: ${clientPhone}`)
    if (clientEmail) descParts.push(`Email: ${clientEmail}`)
    if (propertyName) descParts.push(`Property: ${propertyName}`)
    if (address) descParts.push(`Address: ${address}`)
    if (price) descParts.push(`Price: $${price}`)
    if (assignee) descParts.push(`Assigned: ${assignee}`)
    if (notes) descParts.push(`Notes: ${notes}`)
    const description = descParts.join('\n')

    try {
      const response = await fetch(`https://api.connecteam.com/scheduler/v1/schedulers/${SCHEDULER_ID}/shifts`, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          startTime: startTs,
          endTime: endTs,
          description: description,
          location: address ? { name: address } : undefined,
        }),
      })

      if (response.status === 429) {
        return res.status(429).json({ error: 'Connecteam rate limited. Wait and try again.' })
      }

      const data = await response.text()

      if (!response.ok) {
        // If shift creation not supported, return helpful error
        return res.status(response.status).json({
          error: `Connecteam returned ${response.status}`,
          detail: data,
          note: 'If you get a 405 error, the Connecteam API may not support creating shifts via API. You may need to use webhooks instead or create shifts manually in Connecteam.',
        })
      }

      let parsed
      try { parsed = JSON.parse(data) } catch { parsed = { raw: data } }

      return res.status(200).json({ success: true, shift: parsed })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ════════════════════════════════════════════════
  // DEFAULT: Connecteam API Proxy
  // ════════════════════════════════════════════════
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { path, ...queryParams } = req.query;

  if (!path) {
    return res.status(400).json({ error: "Missing 'path' query parameter" });
  }

  const url = new URL(`https://api.connecteam.com/${path}`);
  for (const [key, value] of Object.entries(queryParams)) {
    if (key === 'action') continue; // skip our routing param
    url.searchParams.set(key, value);
  }

  const headers = {};
  if (req.headers["x-api-key"]) {
    headers["X-API-KEY"] = req.headers["x-api-key"];
  }

  try {
    const response = await fetch(url.href, { headers });
    const data = await response.text();
    res.setHeader("Content-Type", "application/json");
    return res.status(response.status).send(data);
  } catch (err) {
    return res.status(502).json({ error: "Upstream request failed", details: err.message });
  }
}

// ════════════════════════════════════════════════
// Helper: Send email notification via Gmail API
// ════════════════════════════════════════════════
async function sendNotification(subject, body) {
  try {
    const clientId = process.env.GMAIL_CLIENT_ID
    const clientSecret = process.env.GMAIL_CLIENT_SECRET
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN
    if (!clientId || !clientSecret || !refreshToken) return

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return

    const raw = Buffer.from(
      `To: office@mainecleaningco.com\r\nSubject: [Connecteam] ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\n\n— Workflow HQ Notification`
    ).toString('base64url')

    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    })
  } catch (e) {
    console.error('Notification failed:', e.message)
  }
}
