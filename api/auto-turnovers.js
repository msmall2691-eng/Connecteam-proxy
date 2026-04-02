// Vercel serverless: Auto-generate turnover cleanings from rental calendars
// Primary: reads Google Calendar (fast, reliable, scales to 100+ properties)
// Fallback: direct iCal fetch (for properties not yet imported into Google Calendar)
// GET /api/auto-turnovers?action=scan — scans all rental properties and creates visits
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
    // Fetch all rental properties that have EITHER a Google Calendar ID or iCal URL
    const propsRes = await fetch(
      `${supabaseUrl}/rest/v1/properties?type=eq.rental&or=(google_calendar_id.not.is.null,ical_url.not.is.null)&select=*`,
      { headers: sbHeaders }
    )
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
        message: 'No rental properties with Google Calendar IDs or iCal URLs found. Add a Google Calendar ID to your rental properties for automatic turnover detection.',
      })
    }

    // Fetch existing visits (not jobs) to avoid duplicates
    const today = new Date().toISOString().split('T')[0]
    const futureDate = new Date(Date.now() + daysAhead * 86400000).toISOString().split('T')[0]
    const visitsRes = await fetch(
      `${supabaseUrl}/rest/v1/visits?scheduled_date=gte.${today}&scheduled_date=lte.${futureDate}&source=in.(ical_sync,turno)&select=scheduled_date,property_id,ical_event_uid`,
      { headers: sbHeaders }
    )
    const existingVisits = await visitsRes.json() || []
    const existingSet = new Set(existingVisits.map(v => `${v.property_id}|${v.scheduled_date}`))
    const existingUids = new Set(existingVisits.map(v => v.ical_event_uid).filter(Boolean))

    // Fetch turnover service_type id
    const stRes = await fetch(`${supabaseUrl}/rest/v1/service_types?name=eq.Turnover&select=id`, { headers: sbHeaders })
    const stData = await stRes.json()
    const turnoverServiceTypeId = stData?.[0]?.id || null

    const turnovers = []
    const created = []
    const errors = []

    // ── PHASE 1: Batch-read all Google Calendars (fast, one API call each) ──
    // Group properties by source: Google Calendar vs iCal fallback
    const gcalProps = properties.filter(p => p.google_calendar_id && accessToken)
    const icalFallbackProps = properties.filter(p => !p.google_calendar_id || !accessToken)

    // Pre-fetch all Google Calendar events in parallel (fast — ~100ms each)
    const gcalEvents = {}
    if (gcalProps.length > 0) {
      const timeMin = new Date().toISOString()
      const timeMax = new Date(Date.now() + daysAhead * 86400000).toISOString()

      const gcalPromises = gcalProps.map(async (prop) => {
        try {
          const calRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(prop.google_calendar_id)}/events?singleEvents=true&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}&timeZone=America/New_York`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          )
          if (calRes.ok) {
            const calData = await calRes.json()
            // Google Calendar all-day events use EXCLUSIVE end dates (RFC 5545).
            // A reservation Apr 16-18 has end.date = "2026-04-19" (the checkout day).
            // This is correct — we schedule the cleaning ON end.date (checkout day).
            gcalEvents[prop.id] = (calData.items || [])
              .filter(ev => ev.start?.date && ev.end?.date)
              .map(ev => ({
                date: ev.end.date,    // Checkout day = cleaning day
                guest: ev.summary || 'Guest',
                checkIn: ev.start.date,
                uid: ev.iCalUID || ev.id,
              }))
          } else {
            console.error(`Google Calendar fetch failed for ${prop.name || prop.id}: ${calRes.status}`)
            gcalEvents[prop.id] = []
          }
        } catch (e) {
          console.error(`Google Calendar error for ${prop.name || prop.id}:`, e.message)
          gcalEvents[prop.id] = []
        }
      })

      await Promise.all(gcalPromises)
    }

    for (const prop of properties) {
      if (!prop.ical_url && !prop.google_calendar_id) continue

      // Find or create a standing "Turnover Service" job for this property
      let turnoverJobId = null
      const jobRes = await fetch(
        `${supabaseUrl}/rest/v1/jobs?property_id=eq.${prop.id}&source=eq.ical_sync&is_active=eq.true&select=id`,
        { headers: sbHeaders }
      )
      const existingJobs = await jobRes.json()

      if (existingJobs?.length) {
        turnoverJobId = existingJobs[0].id
      } else if (action === 'scan') {
        const newJobRes = await fetch(`${supabaseUrl}/rest/v1/jobs`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify({
            client_id: prop.client_id,
            client_name: 'Rental Owner',
            property_id: prop.id,
            title: `Turnover Service — ${prop.name || prop.address_line1?.split(',')[0]}`,
            date: today,
            start_time: prop.cleaning_time || '11:00',
            end_time: '14:00',
            status: 'scheduled',
            service_type: 'turnover',
            service_type_id: turnoverServiceTypeId,
            is_recurring: false,
            is_active: true,
            source: 'ical_sync',
            address: prop.address_line1,
          }),
        })
        const newJobs = await newJobRes.json()
        turnoverJobId = newJobs?.[0]?.id
      }

      // Get checkout dates — prefer Google Calendar (already fetched), fall back to iCal
      let checkoutDates = []

      // Primary: Google Calendar (already batch-fetched above)
      if (gcalEvents[prop.id]?.length > 0) {
        checkoutDates = gcalEvents[prop.id]
      }

      // Fallback: Direct iCal fetch (only if no Google Calendar data)
      if (checkoutDates.length === 0 && prop.ical_url) {
        try {
          const icalRes = await fetch(prop.ical_url, { signal: AbortSignal.timeout(5000) })
          if (icalRes.ok) {
            const icalText = await icalRes.text()
            // iCal all-day events use EXCLUSIVE DTEND (RFC 5545).
            // DTEND 20260419 means guest checks out Apr 19 = cleaning day.
            // Handle multiple DTSTART/DTEND formats:
            //   DTSTART;VALUE=DATE:20260416
            //   DTSTART:20260416
            //   DTSTART;TZID=...:20260416T...
            const events = icalText.split('BEGIN:VEVENT')
            for (const ev of events.slice(1)) {
              // Match DTEND in any format — extract 8-digit date
              const dtendRaw = ev.match(/DTEND[^:]*:(\d{4})(\d{2})(\d{2})/)?.[0]
              const dtstartRaw = ev.match(/DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/)?.[0]
              const summary = ev.match(/SUMMARY:(.*)/)?.[1]?.trim()
              const uid = ev.match(/UID:(.*)/)?.[1]?.trim()

              if (dtendRaw) {
                const endMatch = dtendRaw.match(/(\d{4})(\d{2})(\d{2})/)
                if (endMatch) {
                  const date = `${endMatch[1]}-${endMatch[2]}-${endMatch[3]}`
                  const startMatch = dtstartRaw?.match(/(\d{4})(\d{2})(\d{2})/)
                  const checkIn = startMatch ? `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}` : null

                  if (date >= today && date <= futureDate) {
                    checkoutDates.push({ date, guest: summary || 'Guest', checkIn, uid })
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error(`iCal fetch failed for ${prop.name || prop.id}:`, e.message)
        }
      }

      // Get client info
      let client = null
      if (prop.client_id) {
        try {
          const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${prop.client_id}&select=id,name,email,phone`, { headers: sbHeaders })
          const clients = await clientRes.json()
          client = clients?.[0]
        } catch {}
      }

      // Process each checkout — create visits (not jobs)
      for (const checkout of checkoutDates) {
        const key = `${prop.id}|${checkout.date}`
        const cleaningTime = prop.cleaning_time || '11:00'
        const checkoutTime = prop.checkout_time || '10:00'
        const alreadyScheduled = existingSet.has(key) || (checkout.uid && existingUids.has(checkout.uid))

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
          alreadyScheduled,
          source: gcalEvents[prop.id]?.length > 0 ? 'google_calendar' : 'ical_feed',
        }

        turnovers.push(turnover)

        // Create visit if scanning and not already scheduled
        if (action === 'scan' && !alreadyScheduled && turnoverJobId) {
          try {
            // Use property-specific cleaning duration (default 3 hours)
            const duration = parseInt(prop.cleaning_duration) || 3
            const [h, m] = cleaningTime.split(':').map(Number)
            const endH = String(Math.min(h + duration, 23)).padStart(2, '0')
            const endTime = `${endH}:${m.toString().padStart(2, '0')}`

            // Build instructions from guest info + property details
            const instrLines = []
            if (checkout.guest) instrLines.push(`Guest: ${checkout.guest}`)
            instrLines.push(`Checkout: ${checkoutTime}`)
            if (checkout.checkIn) instrLines.push(`Next check-in: ${checkout.checkIn}`)
            if (prop.access_notes) instrLines.push(`Access: ${prop.access_notes}`)
            if (prop.parking_instructions) instrLines.push(`Parking: ${prop.parking_instructions}`)
            if (prop.pet_details) instrLines.push(`Pets: ${prop.pet_details}`)
            if (prop.cleaning_notes) instrLines.push(`Notes: ${prop.cleaning_notes}`)
            if (prop.do_not_areas) instrLines.push(`Do not clean: ${prop.do_not_areas}`)

            const visitRes = await fetch(`${supabaseUrl}/rest/v1/visits`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
              body: JSON.stringify({
                job_id: turnoverJobId,
                client_id: prop.client_id,
                property_id: prop.id,
                scheduled_date: checkout.date,
                scheduled_start_time: cleaningTime,
                scheduled_end_time: endTime,
                status: 'scheduled',
                source: 'ical_sync',
                service_type_id: turnoverServiceTypeId,
                ical_event_uid: checkout.uid || null,
                instructions: instrLines.join('\n'),
                address: prop.address_line1,
                client_visible: true,
              }),
            })

            if (visitRes.ok) {
              const visit = await visitRes.json()
              const visitId = visit[0]?.id
              created.push({ ...turnover, visitId })

              // Sync to Google Calendar and log it
              if (accessToken && visitId) {
                try {
                  const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
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
                  if (calRes.ok) {
                    const calData = await calRes.json()
                    // Update visit with google_event_id
                    await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}`, {
                      method: 'PATCH',
                      headers: { ...sbHeaders, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ google_event_id: calData.id }),
                    })
                    // Log to calendar_sync_log
                    await fetch(`${supabaseUrl}/rest/v1/calendar_sync_log`, {
                      method: 'POST',
                      headers: { ...sbHeaders, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        visit_id: visitId,
                        provider: 'google_calendar',
                        external_id: calData.id,
                        direction: 'outbound',
                        sync_status: 'synced',
                      }),
                    })
                  }
                } catch {}
              }
            }
          } catch (e) {
            console.error('Failed to create turnover visit:', e)
            errors.push({ property: prop.name || prop.address_line1, date: checkout.date, error: e.message })
          }
        }
      }

      // Update last iCal sync timestamp
      if (action === 'scan') {
        await fetch(`${supabaseUrl}/rest/v1/properties?id=eq.${prop.id}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ last_ical_sync_at: new Date().toISOString() }),
        }).catch(() => {})
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
      errors: errors.length,
      turnovers,
      ...(errors.length > 0 ? { errorDetails: errors } : {}),
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
