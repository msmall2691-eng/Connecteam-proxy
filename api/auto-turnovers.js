// Vercel serverless: Auto-generate turnover cleanings from rental iCal feeds
// GET /api/auto-turnovers?action=scan — scans all rental properties and creates jobs
// GET /api/auto-turnovers?action=preview — shows what would be created without creating

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const action = req.query.action || 'preview'
  const daysAhead = parseInt(req.query.days) || 30

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }

  // Get Google Calendar access token
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  let accessToken = null

  if (clientId && clientSecret && refreshToken) {
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
      })
      const tokenData = await tokenRes.json()
      accessToken = tokenData.access_token
    } catch {}
  }

  try {
    // Fetch all rental properties with iCal URLs
    const propsRes = await fetch(`${supabaseUrl}/rest/v1/properties?type=eq.rental&ical_url=not.is.null&select=*`, { headers: sbHeaders })
    const properties = await propsRes.json()

    if (!properties?.length) {
      return res.status(200).json({
        action,
        daysAhead,
        properties: 0,
        totalTurnovers: 0,
        alreadyScheduled: 0,
        newTurnovers: 0,
        created: 0,
        turnovers: [],
        message: 'No rental properties with iCal URLs found',
      })
    }

    // Fetch existing jobs to avoid duplicates
    const today = new Date().toISOString().split('T')[0]
    const futureDate = new Date(Date.now() + daysAhead * 86400000).toISOString().split('T')[0]
    const jobsRes = await fetch(`${supabaseUrl}/rest/v1/jobs?date=gte.${today}&date=lte.${futureDate}&service_type=eq.turnover&select=date,property_id`, { headers: sbHeaders })
    const existingJobs = await jobsRes.json() || []
    const existingSet = new Set(existingJobs.map(j => `${j.property_id}|${j.date}`))

    const turnovers = []
    const created = []

    for (const prop of properties) {
      if (!prop.ical_url) continue

      // Try to read iCal via Google Calendar (if subscribed)
      // OR fetch the iCal URL directly and parse it
      let checkoutDates = []

      // Method 1: If we have a Google Calendar ID for this iCal
      if (accessToken && prop.google_calendar_id) {
        try {
          const calRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(prop.google_calendar_id)}/events?singleEvents=true&orderBy=startTime&timeMin=${new Date().toISOString()}&timeMax=${new Date(Date.now() + daysAhead * 86400000).toISOString()}&timeZone=America/New_York`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          )
          if (calRes.ok) {
            const calData = await calRes.json()
            for (const ev of calData.items || []) {
              if (ev.start?.date && ev.end?.date) {
                // All-day event: end.date is the checkout day
                checkoutDates.push({
                  date: ev.end.date,
                  guest: ev.summary || 'Guest',
                  checkIn: ev.start.date,
                })
              }
            }
          }
        } catch {}
      }

      // Method 2: Fetch iCal directly and parse
      if (checkoutDates.length === 0) {
        try {
          const icalRes = await fetch(prop.ical_url)
          if (icalRes.ok) {
            const icalText = await icalRes.text()
            // Simple iCal parser for VEVENT blocks
            const events = icalText.split('BEGIN:VEVENT')
            for (const ev of events.slice(1)) {
              const dtstart = ev.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/)?.[0]
              const dtend = ev.match(/DTEND;VALUE=DATE:(\d{4})(\d{2})(\d{2})/)?.[0]
              const summary = ev.match(/SUMMARY:(.*)/)?.[1]?.trim()

              if (dtend) {
                const endMatch = dtend.match(/(\d{4})(\d{2})(\d{2})/)
                if (endMatch) {
                  const date = `${endMatch[1]}-${endMatch[2]}-${endMatch[3]}`
                  const startMatch = dtstart?.match(/(\d{4})(\d{2})(\d{2})/)
                  const checkIn = startMatch ? `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}` : null

                  // Only future dates
                  if (date >= today && date <= futureDate) {
                    checkoutDates.push({ date, guest: summary || 'Guest', checkIn })
                  }
                }
              }
            }
          }
        } catch {}
      }

      // Get client info for this property
      let client = null
      if (prop.client_id) {
        try {
          const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${prop.client_id}&select=id,name,email,phone`, { headers: sbHeaders })
          const clients = await clientRes.json()
          client = clients?.[0]
        } catch {}
      }

      // Process each checkout
      for (const checkout of checkoutDates) {
        const key = `${prop.id}|${checkout.date}`
        const cleaningTime = prop.cleaning_time || '11:00'
        const checkoutTime = prop.checkout_time || '10:00'

        const turnover = {
          propertyId: prop.id,
          propertyName: prop.name || prop.address_line1,
          address: prop.address_line1,
          clientId: prop.client_id,
          clientName: client?.name,
          checkoutDate: checkout.date,
          checkoutTime,
          cleaningTime,
          guest: checkout.guest,
          checkIn: checkout.checkIn,
          alreadyScheduled: existingSet.has(key),
        }

        turnovers.push(turnover)

        // Create job if action=scan and not already scheduled
        if (action === 'scan' && !existingSet.has(key)) {
          try {
            // Calculate end time (3 hours after start)
            const [h, m] = cleaningTime.split(':').map(Number)
            const endH = String(Math.min(h + 3, 23)).padStart(2, '0')
            const endTime = `${endH}:${m.toString().padStart(2, '0')}`

            const jobRes = await fetch(`${supabaseUrl}/rest/v1/jobs`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
              body: JSON.stringify({
                client_id: prop.client_id,
                client_name: client?.name || 'Rental Owner',
                property_id: prop.id,
                title: `Turnover Clean — ${prop.name || prop.address_line1?.split(',')[0]}`,
                date: checkout.date,
                start_time: cleaningTime,
                end_time: endTime,
                status: 'scheduled',
                service_type: 'turnover',
                address: prop.address_line1,
                notes: `Guest: ${checkout.guest}\nCheckout: ${checkoutTime}\nCheck-in: ${checkout.checkIn || 'same day'}`,
              }),
            })

            if (jobRes.ok) {
              const job = await jobRes.json()
              created.push({ ...turnover, jobId: job[0]?.id })

              // Also push to Google Calendar if connected
              if (accessToken) {
                try {
                  await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      summary: `🧹 Turnover — ${prop.name || prop.address_line1?.split(',')[0]}`,
                      description: `${client?.name || 'Rental'}\n${prop.address_line1}\nGuest checkout: ${checkoutTime}`,
                      start: { dateTime: `${checkout.date}T${cleaningTime}:00`, timeZone: 'America/New_York' },
                      end: { dateTime: `${checkout.date}T${endTime}:00`, timeZone: 'America/New_York' },
                      location: prop.address_line1,
                    }),
                  })
                } catch {}
              }
            }
          } catch (e) {
            console.error('Failed to create turnover job:', e)
          }
        }
      }
    }

    return res.status(200).json({
      action,
      daysAhead,
      properties: properties.length,
      totalTurnovers: turnovers.length,
      alreadyScheduled: turnovers.filter(t => t.alreadyScheduled).length,
      newTurnovers: turnovers.filter(t => !t.alreadyScheduled).length,
      created: created.length,
      turnovers,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
