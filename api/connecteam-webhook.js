// Vercel serverless: Connecteam Webhook Receiver
// Receives real-time events from Connecteam (clock in/out, shift changes, etc.)
// Set this URL in Connecteam → Settings → Webhooks

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // Webhook verification (GET)
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Connecteam webhook endpoint active' })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

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
      const action = eventType.includes('accept') ? 'accepted' : 'rejected'
      console.log(`Shift ${action}:`, data)

      await sendNotification(
        `Shift ${action} by ${data.userName || 'employee'}`,
        `Shift: ${data.shiftTitle || 'N/A'}\nDate: ${data.date || 'N/A'}\n${action === 'rejected' ? `Reason: ${data.reason || 'No reason given'}` : ''}`
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
      `To: info@maine-clean.co\r\nSubject: [Connecteam] ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\n\n— Workflow HQ Notification`
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
