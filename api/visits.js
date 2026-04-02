// Vercel serverless: Visit management
// GET /api/visits?action=generate-recurring — generate visits for all active recurring jobs
// GET /api/visits?action=generate-recurring&jobId=xxx — generate for one job
// Called via daily cron (7am UTC) or manually

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const action = req.query.action || 'generate-recurring'
  const jobId = req.query.jobId || null
  const weeksAhead = parseInt(req.query.weeks) || 8

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  const sbHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  }

  // ════════════════════════════════════════════════
  // ACTION: complete — mark visit done + auto-create invoice
  // POST /api/visits?action=complete&visitId=xxx
  // ════════════════════════════════════════════════
  if (action === 'complete' && req.method === 'POST') {
    const visitId = req.query.visitId || req.body?.visitId
    if (!visitId) return res.status(400).json({ error: 'visitId required' })

    try {
      // Fetch visit with job + client info
      const vRes = await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}&select=*,job:jobs(title,price,client_name),client:clients(name,email,phone)`, { headers: sbHeaders })
      const visits = await vRes.json()
      if (!visits?.length) return res.status(404).json({ error: 'Visit not found' })
      const visit = visits[0]

      // Mark visit completed
      await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ status: 'completed', actual_end_time: visit.actual_end_time || new Date().toISOString() }),
      })

      // Auto-create invoice if job has a price
      let invoice = null
      const price = visit.job?.price
      if (price && price > 0) {
        const invNum = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`
        const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
        const invRes = await fetch(`${supabaseUrl}/rest/v1/invoices`, {
          method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
          body: JSON.stringify({
            invoice_number: invNum,
            client_id: visit.client_id,
            property_id: visit.property_id || null,
            issue_date: new Date().toISOString().split('T')[0],
            due_date: dueDate,
            total: price,
            status: 'draft',
            notes: `Auto-generated from visit on ${visit.scheduled_date}`,
            items: JSON.stringify([{ description: visit.job?.title || 'Cleaning Service', quantity: 1, unitPrice: price }]),
          }),
        })
        if (invRes.ok) {
          const invData = await invRes.json()
          invoice = invData[0]
        }
      }

      return res.status(200).json({ success: true, visitId, status: 'completed', invoice })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ════════════════════════════════════════════════
  // ACTION: follow-up — send post-completion thank-you + review request
  // GET /api/visits?action=follow-up
  // ════════════════════════════════════════════════
  if (action === 'follow-up') {
    try {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
      const vRes = await fetch(
        `${supabaseUrl}/rest/v1/visits?status=eq.completed&scheduled_date=eq.${yesterday}&follow_up_sent_at=is.null&select=*,client:clients(name,email,phone),job:jobs(title)`,
        { headers: sbHeaders }
      )
      const visits = (await vRes.json()) || []
      if (!visits.length) return res.status(200).json({ message: 'No follow-ups needed', sent: 0 })

      let sent = 0
      const gmailCreds = getGmailCreds()
      const token = gmailCreds ? await getAccessToken(gmailCreds) : null

      for (const visit of visits) {
        const client = visit.client || {}
        if (!client.email || !token) continue

        const firstName = (client.name || '').split(' ')[0] || 'there'
        const subject = `Thanks for choosing us, ${firstName}!`
        const body = `Hi ${firstName},\n\nThank you for your cleaning today! We hope everything looks great.\n\nIf you have a moment, we'd love to hear how it went. Just reply to this email with any feedback — it helps us keep improving.\n\nSee you next time!\n\n— The Maine Cleaning Co.\n(207) 572-0502`

        const raw = Buffer.from(
          `To: ${client.email}\r\nFrom: The Maine Cleaning Co. <office@mainecleaningco.com>\r\nReply-To: office@mainecleaningco.com\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ).toString('base64url')

        try {
          const emailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw }),
          })
          if (emailRes.ok) {
            await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visit.id}`, {
              method: 'PATCH', headers: sbHeaders,
              body: JSON.stringify({ follow_up_sent_at: new Date().toISOString() }),
            }).catch(() => {})
            sent++
          }
        } catch (e) { console.error('Follow-up failed:', e.message) }
      }

      return res.status(200).json({ sent, total: visits.length })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ════════════════════════════════════════════════
  // ACTION: sync-visit — push a visit to Google Calendar + Connecteam
  // POST /api/visits?action=sync-visit&visitId=xxx
  // ════════════════════════════════════════════════
  if (action === 'sync-visit' && req.method === 'POST') {
    const visitId = req.query.visitId || req.body?.visitId
    if (!visitId) return res.status(400).json({ error: 'visitId required' })

    try {
      const vRes = await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}&select=*,job:jobs(title,price,client_name),client:clients(name,email,phone,address),property:properties(address_line1)`, { headers: sbHeaders })
      const visits = await vRes.json()
      if (!visits?.length) return res.status(404).json({ error: 'Visit not found' })
      const visit = visits[0]

      const results = { google: null, connecteam: null }
      const title = visit.job?.title || 'Cleaning'
      const clientName = visit.client?.name || visit.job?.client_name || ''
      const address = visit.address || visit.property?.address_line1 || visit.client?.address || ''
      const date = visit.scheduled_date
      const startTime = visit.scheduled_start_time || '09:00'
      const endTime = visit.scheduled_end_time || '12:00'

      // Push to Google Calendar
      if (!visit.google_event_id) {
        const gcCreds = getGmailCreds()
        if (gcCreds) {
          const token = await getAccessToken(gcCreds)
          if (token) {
            try {
              const calId = process.env.GOOGLE_CALENDAR_ID || 'primary'
              const gcRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  summary: `${title}${clientName ? ' — ' + clientName : ''}`,
                  description: [clientName, address, visit.instructions].filter(Boolean).join('\n'),
                  start: { dateTime: `${date}T${startTime}:00`, timeZone: 'America/New_York' },
                  end: { dateTime: `${date}T${endTime}:00`, timeZone: 'America/New_York' },
                  location: address,
                }),
              })
              if (gcRes.ok) {
                const gcData = await gcRes.json()
                results.google = gcData.id
                await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}`, {
                  method: 'PATCH', headers: sbHeaders, body: JSON.stringify({ google_event_id: gcData.id }),
                })
                await fetch(`${supabaseUrl}/rest/v1/calendar_sync_log`, {
                  method: 'POST', headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
                  body: JSON.stringify({ visit_id: visitId, provider: 'google_calendar', external_id: gcData.id, direction: 'outbound', sync_status: 'synced', last_synced_at: new Date().toISOString() }),
                }).catch(() => {})
              }
            } catch (e) { console.error('GCal sync failed:', e.message) }
          }
        }
      }

      // Push to Connecteam
      if (!visit.connecteam_shift_id) {
        const ctKey = process.env.CONNECTEAM_API_KEY
        if (ctKey) {
          try {
            const SCHEDULER_ID = 15248539
            const startTs = Math.floor(new Date(`${date}T${startTime}:00`).getTime() / 1000)
            const endTs = Math.floor(new Date(`${date}T${endTime}:00`).getTime() / 1000)
            const ctRes = await fetch(`https://api.connecteam.com/scheduler/v1/schedulers/${SCHEDULER_ID}/shifts`, {
              method: 'POST',
              headers: { 'X-API-KEY': ctKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: `${title}${clientName ? ' — ' + clientName : ''}`,
                startTime: startTs, endTime: endTs,
                description: [clientName, address, visit.instructions].filter(Boolean).join('\n'),
                location: address ? { name: address } : undefined,
              }),
            })
            if (ctRes.ok) {
              const ctData = await ctRes.json().catch(() => ({}))
              const shiftId = ctData?.id || ctData?.shiftId || 'synced'
              results.connecteam = shiftId
              await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}`, {
                method: 'PATCH', headers: sbHeaders, body: JSON.stringify({ connecteam_shift_id: shiftId }),
              })
              await fetch(`${supabaseUrl}/rest/v1/calendar_sync_log`, {
                method: 'POST', headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
                body: JSON.stringify({ visit_id: visitId, provider: 'connecteam', external_id: String(shiftId), direction: 'outbound', sync_status: 'synced', last_synced_at: new Date().toISOString() }),
              }).catch(() => {})
            }
          } catch (e) { console.error('Connecteam sync failed:', e.message) }
        }
      }

      return res.status(200).json({ success: true, visitId, synced: results })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ════════════════════════════════════════════════
  // ACTION: sync-all — batch sync all unsynced visits
  // POST /api/visits?action=sync-all
  // ════════════════════════════════════════════════
  if (action === 'sync-all' && req.method === 'POST') {
    try {
      const today = new Date().toISOString().split('T')[0]
      const futureDate = new Date(Date.now() + 42 * 86400000).toISOString().split('T')[0]
      const vRes = await fetch(
        `${supabaseUrl}/rest/v1/visits?scheduled_date=gte.${today}&scheduled_date=lte.${futureDate}&status=in.(scheduled,confirmed)&or=(google_event_id.is.null,connecteam_shift_id.is.null)&select=id&limit=50`,
        { headers: sbHeaders }
      )
      const visits = (await vRes.json()) || []
      let synced = 0

      for (const v of visits) {
        try {
          const host = req.headers.host || 'connecteam-proxy.vercel.app'
          await fetch(`https://${host}/api/visits?action=sync-visit&visitId=${v.id}`, { method: 'POST' })
          synced++
          // Rate limit protection: pause 2s between syncs
          if (synced < visits.length) await new Promise(r => setTimeout(r, 2000))
        } catch {}
      }

      return res.status(200).json({ success: true, total: visits.length, synced })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  if (action === 'generate-recurring') {
    try {
      // Fetch active recurring jobs
      let jobsUrl = `${supabaseUrl}/rest/v1/jobs?is_recurring=eq.true&is_active=eq.true&select=*`
      if (jobId) jobsUrl = `${supabaseUrl}/rest/v1/jobs?id=eq.${jobId}&is_recurring=eq.true&select=*`

      const jobsRes = await fetch(jobsUrl, { headers: sbHeaders })
      const jobs = await jobsRes.json() || []

      if (jobs.length === 0) {
        return res.status(200).json({
          action, jobsProcessed: 0, visitsCreated: 0,
          message: jobId ? 'Job not found or not recurring' : 'No active recurring jobs found',
        })
      }

      const endDate = new Date(Date.now() + weeksAhead * 7 * 86400000).toISOString().split('T')[0]
      const today = new Date().toISOString().split('T')[0]
      let totalCreated = 0
      const details = []

      for (const job of jobs) {
        // Fetch existing visits for this job in the generation window
        const existRes = await fetch(
          `${supabaseUrl}/rest/v1/visits?job_id=eq.${job.id}&scheduled_date=gte.${today}&scheduled_date=lte.${endDate}&select=scheduled_date`,
          { headers: sbHeaders }
        )
        const existing = await existRes.json() || []
        const existingDates = new Set(existing.map(v => v.scheduled_date))

        // Fetch property for address
        let address = job.address || ''
        if (!address && job.property_id) {
          try {
            const propRes = await fetch(`${supabaseUrl}/rest/v1/properties?id=eq.${job.property_id}&select=address_line1`, { headers: sbHeaders })
            const props = await propRes.json()
            address = props?.[0]?.address_line1 || ''
          } catch {}
        }

        // Calculate visit dates
        const interval = job.recurrence_rule === 'weekly' ? 7
          : job.recurrence_rule === 'biweekly' ? 14
          : job.recurrence_rule === 'monthly' ? 'monthly'
          : 7

        const startDate = job.recurrence_start_date || job.last_visit_generated_date || job.date || today
        const startTime = job.preferred_start_time || job.start_time || '09:00'
        const endTime = job.preferred_end_time || job.end_time || '12:00'
        const recurrenceDay = job.recurrence_day // 0=Sun, 1=Mon, ...

        let current = new Date(startDate + 'T12:00:00')
        const end = new Date(endDate + 'T12:00:00')
        let created = 0

        // If monthly, step by month (recurrenceDay 0-6 = day-of-week for weekly; for monthly use start date's day-of-month)
        if (interval === 'monthly') {
          const dayOfMonth = (recurrenceDay != null && recurrenceDay > 6) ? recurrenceDay : current.getDate()
          current = new Date(current.getFullYear(), current.getMonth(), dayOfMonth)
          if (current < new Date(today + 'T00:00:00')) {
            current.setMonth(current.getMonth() + 1)
          }

          while (current <= end) {
            const dateStr = current.toISOString().split('T')[0]
            if (dateStr >= today && !existingDates.has(dateStr)) {
              await createVisit(supabaseUrl, sbHeaders, job, dateStr, startTime, endTime, address)
              created++
              existingDates.add(dateStr)
            }
            current.setMonth(current.getMonth() + 1)
          }
        } else {
          // Weekly/biweekly: find next occurrence of recurrence_day
          if (recurrenceDay !== null && recurrenceDay !== undefined) {
            while (current.getDay() !== recurrenceDay) {
              current.setDate(current.getDate() + 1)
            }
          }
          // If before today, advance
          while (current < new Date(today + 'T00:00:00')) {
            current.setDate(current.getDate() + interval)
          }

          while (current <= end) {
            const dateStr = current.toISOString().split('T')[0]
            if (!existingDates.has(dateStr)) {
              await createVisit(supabaseUrl, sbHeaders, job, dateStr, startTime, endTime, address)
              created++
              existingDates.add(dateStr)
            }
            current.setDate(current.getDate() + interval)
          }
        }

        // Update job's last_visit_generated_date
        if (created > 0) {
          await fetch(`${supabaseUrl}/rest/v1/jobs?id=eq.${job.id}`, {
            method: 'PATCH',
            headers: sbHeaders,
            body: JSON.stringify({ last_visit_generated_date: endDate }),
          }).catch(err => console.error('Failed to update last_visit_generated_date:', err.message))
        }

        totalCreated += created
        details.push({ jobId: job.id, title: job.title, visitsCreated: created })
      }

      return res.status(200).json({
        action,
        weeksAhead,
        jobsProcessed: jobs.length,
        visitsCreated: totalCreated,
        details,
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use: generate-recurring, complete, follow-up' })
}

async function createVisit(supabaseUrl, sbHeaders, job, date, startTime, endTime, address) {
  await fetch(`${supabaseUrl}/rest/v1/visits`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      job_id: job.id,
      client_id: job.client_id,
      property_id: job.property_id || null,
      scheduled_date: date,
      scheduled_start_time: startTime,
      scheduled_end_time: endTime,
      status: 'scheduled',
      source: 'recurring',
      service_type_id: job.service_type_id || null,
      address: address || null,
      instructions: job.instructions || null,
      client_visible: true,
    }),
  })
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
