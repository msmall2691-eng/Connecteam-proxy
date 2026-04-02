// Vercel serverless: Automated reminders
// Called via cron or manually to send next-day cleaning reminders
// GET /api/reminders?action=send — sends reminders for tomorrow's visits
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
    // Fetch tomorrow's visits (not jobs) with client info
    let visits = []
    if (supabaseUrl && supabaseKey) {
      const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }

      const visitsRes = await fetch(
        `${supabaseUrl}/rest/v1/visits?scheduled_date=eq.${tomorrowStr}&status=in.(scheduled,confirmed)&select=*`,
        { headers: sbHeaders }
      )
      if (visitsRes.ok) visits = await visitsRes.json()

      if (visits.length === 0) {
        return res.status(200).json({ message: 'No visits scheduled for tomorrow', date: tomorrowStr, reminders: [] })
      }

      // Get client info for each visit
      const clientIds = [...new Set(visits.map(v => v.client_id).filter(Boolean))]
      let clients = {}
      if (clientIds.length > 0) {
        const clientsRes = await fetch(
          `${supabaseUrl}/rest/v1/clients?id=in.(${clientIds.join(',')})&select=*`,
          { headers: sbHeaders }
        )
        if (clientsRes.ok) {
          const clientList = await clientsRes.json()
          for (const c of clientList) clients[c.id] = c
        }
      }

      // Get job info for titles
      const jobIds = [...new Set(visits.map(v => v.job_id).filter(Boolean))]
      let jobs = {}
      if (jobIds.length > 0) {
        const jobsRes = await fetch(
          `${supabaseUrl}/rest/v1/jobs?id=in.(${jobIds.join(',')})&select=id,title,price`,
          { headers: sbHeaders }
        )
        if (jobsRes.ok) {
          const jobList = await jobsRes.json()
          for (const j of jobList) jobs[j.id] = j
        }
      }

      // Check which visits already had reminders sent
      const visitIds = visits.map(v => v.id)
      let alreadySent = new Set()
      if (visitIds.length > 0) {
        const remindersRes = await fetch(
          `${supabaseUrl}/rest/v1/visit_reminders?visit_id=in.(${visitIds.join(',')})&select=visit_id`,
          { headers: sbHeaders }
        )
        if (remindersRes.ok) {
          const existing = await remindersRes.json()
          alreadySent = new Set(existing.map(r => r.visit_id))
        }
      }

      // Filter out visits that already had reminders
      const pendingVisits = visits.filter(v => !alreadySent.has(v.id))

      const reminders = pendingVisits.map(visit => {
        const client = clients[visit.client_id] || {}
        const job = jobs[visit.job_id] || {}
        return {
          visitId: visit.id,
          jobId: visit.job_id,
          clientName: client.name || 'Client',
          clientEmail: client.email,
          clientPhone: client.phone,
          jobTitle: job.title || 'Cleaning',
          date: visit.scheduled_date,
          startTime: visit.scheduled_start_time || '9:00 AM',
          address: visit.address || client.address || '',
          preferredContact: client.preferred_contact || 'email',
        }
      })

      if (action === 'preview') {
        return res.status(200).json({
          date: tomorrowStr,
          totalVisits: visits.length,
          alreadySentCount: alreadySent.size,
          pendingCount: reminders.length,
          reminders,
        })
      }

      // Send reminders
      const sent = []
      const failed = []

      for (const r of reminders) {
        const message = `Hi ${r.clientName.split(' ')[0]}! This is a reminder that your cleaning is scheduled for tomorrow (${new Date(r.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}) at ${r.startTime}. ${r.address ? `Address: ${r.address}` : ''}\n\nPlease make sure the space is accessible. See you then!\n\n— The Maine Cleaning Co.\n(207) 572-0502`

        // Send via email
        if (r.clientEmail) {
          let emailMessageId = null
          try {
            const gmailCreds = getGmailCreds()
            if (gmailCreds) {
              const token = await getAccessToken(gmailCreds)
              if (token) {
                const raw = Buffer.from(
                  `To: ${r.clientEmail}\r\nSubject: Cleaning Reminder — Tomorrow ${r.startTime}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message}`
                ).toString('base64url')
                const emailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ raw }),
                })
                if (emailRes.ok) {
                  const emailData = await emailRes.json()
                  emailMessageId = emailData.id
                }
                sent.push({ ...r, channel: 'email' })

                // Log to visit_reminders
                await fetch(`${supabaseUrl}/rest/v1/visit_reminders`, {
                  method: 'POST',
                  headers: { ...sbHeaders, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    visit_id: r.visitId,
                    client_id: visits.find(v => v.id === r.visitId)?.client_id,
                    channel: 'email',
                    status: 'sent',
                    message_id: emailMessageId,
                  }),
                }).catch(() => {})
              }
            }
          } catch (e) { failed.push({ ...r, channel: 'email', error: e.message }) }
        }

        // Send via SMS if Twilio configured
        if (r.clientPhone) {
          let twilioSid = null
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
              if (twilioRes.ok) {
                const twilioData = await twilioRes.json()
                twilioSid = twilioData.sid
                sent.push({ ...r, channel: 'sms' })
              } else {
                failed.push({ ...r, channel: 'sms', error: 'Twilio send failed' })
              }

              // Log to visit_reminders
              await fetch(`${supabaseUrl}/rest/v1/visit_reminders`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  visit_id: r.visitId,
                  client_id: visits.find(v => v.id === r.visitId)?.client_id,
                  channel: 'sms',
                  status: twilioSid ? 'sent' : 'failed',
                  message_id: twilioSid,
                }),
              }).catch(() => {})
            }
          } catch (e) { failed.push({ ...r, channel: 'sms', error: e.message }) }
        }

        // Update visit reminder_sent_at
        await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${r.visitId}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
        }).catch(() => {})
      }

      return res.status(200).json({ date: tomorrowStr, sent: sent.length, failed: failed.length, details: { sent, failed } })
    }

    return res.status(200).json({ message: 'Supabase not configured', date: tomorrowStr, reminders: [] })
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
