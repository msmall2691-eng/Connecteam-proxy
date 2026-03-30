// Vercel serverless: Automated reminders
// Called via cron or manually to send next-day cleaning reminders
// GET /api/reminders?action=send — sends reminders for tomorrow's jobs
// GET /api/reminders?action=preview — shows what would be sent

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const action = req.query.action || 'preview'

  // Get tomorrow's date
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  try {
    // Fetch tomorrow's jobs from Supabase
    let jobs = []
    if (supabaseUrl && supabaseKey) {
      const jobsRes = await fetch(
        `${supabaseUrl}/rest/v1/jobs?date=eq.${tomorrowStr}&status=eq.scheduled&select=*`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      )
      if (jobsRes.ok) jobs = await jobsRes.json()
    }

    if (jobs.length === 0) {
      return res.status(200).json({ message: 'No jobs scheduled for tomorrow', date: tomorrowStr, reminders: [] })
    }

    // Get client info for each job
    const clientIds = [...new Set(jobs.map(j => j.client_id).filter(Boolean))]
    let clients = {}
    if (clientIds.length > 0 && supabaseUrl) {
      const clientsRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?id=in.(${clientIds.join(',')})&select=*`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      )
      if (clientsRes.ok) {
        const clientList = await clientsRes.json()
        for (const c of clientList) clients[c.id] = c
      }
    }

    const reminders = jobs.map(job => {
      const client = clients[job.client_id] || {}
      return {
        jobId: job.id,
        clientName: client.name || job.client_name || 'Client',
        clientEmail: client.email,
        clientPhone: client.phone,
        jobTitle: job.title,
        date: job.date,
        startTime: job.start_time || '9:00 AM',
        address: job.address || client.address || '',
        preferredContact: client.preferred_contact || 'email',
      }
    })

    if (action === 'preview') {
      return res.status(200).json({ date: tomorrowStr, count: reminders.length, reminders })
    }

    // Send reminders
    const sent = []
    const failed = []

    for (const r of reminders) {
      const message = `Hi ${r.clientName.split(' ')[0]}! This is a reminder that your cleaning is scheduled for tomorrow (${new Date(r.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}) at ${r.startTime}. ${r.address ? `Address: ${r.address}` : ''}\n\nPlease make sure the space is accessible. See you then!\n\n— The Maine Cleaning Co.\n(207) 572-0502`

      // Send via email
      if (r.clientEmail) {
        try {
          const gmailCreds = getGmailCreds()
          if (gmailCreds) {
            const token = await getAccessToken(gmailCreds)
            if (token) {
              const raw = Buffer.from(
                `To: ${r.clientEmail}\r\nSubject: Cleaning Reminder — Tomorrow ${r.startTime}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message}`
              ).toString('base64url')
              await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ raw }),
              })
              sent.push({ ...r, channel: 'email' })
            }
          }
        } catch (e) { failed.push({ ...r, channel: 'email', error: e.message }) }
      }

      // Send via SMS if Twilio configured
      if (r.clientPhone) {
        try {
          const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env
          if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
            const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
              method: 'POST',
              headers: {
                Authorization: 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({ From: TWILIO_PHONE_NUMBER, To: r.clientPhone, Body: message }),
            })
            if (twilioRes.ok) sent.push({ ...r, channel: 'sms' })
            else failed.push({ ...r, channel: 'sms', error: 'Twilio send failed' })
          }
        } catch (e) { failed.push({ ...r, channel: 'sms', error: e.message }) }
      }
    }

    return res.status(200).json({ date: tomorrowStr, sent: sent.length, failed: failed.length, details: { sent, failed } })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

function getGmailCreds() {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null
  return { clientId, clientSecret, refreshToken }
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  const data = await res.json()
  return data.access_token || null
}
