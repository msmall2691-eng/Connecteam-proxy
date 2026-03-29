// Vercel serverless: Google Calendar proxy
// Uses GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN from env
// (Same Gmail OAuth credentials work for Calendar API)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // Try Gmail creds first, then dedicated Google creds
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({ error: 'Google Calendar not configured. Uses same OAuth as Gmail (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN).' })
  }

  try {
    // Get fresh access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return res.status(401).json({ error: 'Failed to refresh token', detail: tokenData })
    }
    const accessToken = tokenData.access_token
    const calBase = 'https://www.googleapis.com/calendar/v3'
    const headers = { Authorization: `Bearer ${accessToken}` }

    const action = req.query.action || req.body?.action

    // ── LIST CALENDARS ──
    if (action === 'calendars') {
      const r = await fetch(`${calBase}/users/me/calendarList`, { headers })
      const data = await r.json()
      const calendars = (data.items || []).map(c => ({
        id: c.id,
        summary: c.summary,
        summaryOverride: c.summaryOverride,
        description: c.description,
        primary: c.primary || false,
        accessRole: c.accessRole,
        backgroundColor: c.backgroundColor,
        timeZone: c.timeZone,
      }))
      return res.status(200).json({ calendars })
    }

    // ── LIST EVENTS ──
    if (action === 'events') {
      const calendarId = req.query.calendarId || 'primary'
      const timeMin = req.query.timeMin
      const timeMax = req.query.timeMax
      const maxResults = req.query.maxResults || 100

      let url = `${calBase}/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&maxResults=${maxResults}&timeZone=America/New_York`
      if (timeMin) url += `&timeMin=${encodeURIComponent(timeMin)}`
      if (timeMax) url += `&timeMax=${encodeURIComponent(timeMax)}`

      const r = await fetch(url, { headers })
      const data = await r.json()

      const events = (data.items || []).map(e => ({
        id: e.id,
        summary: e.summary || '',
        description: e.description || '',
        start: e.start,
        end: e.end,
        status: e.status,
        location: e.location,
        allDay: !!e.start?.date,
        htmlLink: e.htmlLink,
      }))

      return res.status(200).json({ calendarId, events })
    }

    // ── CREATE EVENT ──
    if (action === 'create' && req.method === 'POST') {
      const { calendarId, summary, description, startDateTime, endDateTime, startDate, endDate, location, colorId } = req.body
      const calId = calendarId || 'primary'

      const event = { summary, description, location }

      if (startDate && endDate) {
        // All-day event
        event.start = { date: startDate }
        event.end = { date: endDate }
      } else {
        event.start = { dateTime: startDateTime, timeZone: 'America/New_York' }
        event.end = { dateTime: endDateTime, timeZone: 'America/New_York' }
      }

      if (colorId) event.colorId = colorId

      const r = await fetch(`${calBase}/calendars/${encodeURIComponent(calId)}/events`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      })
      const data = await r.json()

      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Failed to create event' })

      return res.status(200).json({
        id: data.id,
        summary: data.summary,
        start: data.start,
        end: data.end,
        htmlLink: data.htmlLink,
      })
    }

    // ── DELETE EVENT ──
    if (action === 'delete' && req.method === 'POST') {
      const { calendarId, eventId } = req.body
      const calId = calendarId || 'primary'
      const r = await fetch(`${calBase}/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {
        method: 'DELETE',
        headers,
      })
      return res.status(r.ok ? 200 : r.status).json({ deleted: r.ok })
    }

    // ── DETECT TURNOVERS from rental calendars ──
    // Reads rental iCal calendars, finds checkout dates, returns cleaning slots
    if (action === 'turnovers') {
      const rentalCalendars = req.query.calendars ? req.query.calendars.split(',') : []
      const timeMin = req.query.timeMin || new Date().toISOString()
      const timeMax = req.query.timeMax || new Date(Date.now() + 60 * 86400000).toISOString()
      const checkoutTime = req.query.checkoutTime || '10:00'
      const cleaningTime = req.query.cleaningTime || '11:00'

      const turnovers = []

      for (const cal of rentalCalendars) {
        const [calId, ...nameParts] = cal.split('|')
        const propertyName = nameParts.join('|') || calId

        let url = `${calBase}/calendars/${encodeURIComponent(calId)}/events?singleEvents=true&orderBy=startTime&maxResults=50&timeZone=America/New_York`
        if (timeMin) url += `&timeMin=${encodeURIComponent(timeMin)}`
        if (timeMax) url += `&timeMax=${encodeURIComponent(timeMax)}`

        try {
          const r = await fetch(url, { headers })
          const data = await r.json()

          for (const e of data.items || []) {
            // All-day events from Airbnb: end.date is the checkout day
            if (e.start?.date && e.end?.date) {
              const checkoutDate = e.end.date // This IS the checkout day for iCal
              // But Google's all-day end date is exclusive, so end.date is already the day after
              // For Airbnb iCal: a booking "Mar 31 - Apr 4" means checkout IS Apr 4
              // But Google represents it as start=Mar31, end=Apr04 (exclusive)
              // So the last night is Apr 3, checkout morning is Apr 4... but Google's end=Apr04 is already correct
              // Actually for Google, end date for all-day is exclusive, so "end: Apr 4" means the event ends before Apr 4
              // So the actual checkout = end.date (the day the event ends = checkout morning)

              const guestName = e.summary || 'Guest'
              const reservationUrl = (e.description || '').match(/Reservation URL: (https:\/\/[^\n]+)/)?.[1] || ''

              turnovers.push({
                property: propertyName,
                calendarId: calId,
                eventId: e.id,
                guestName,
                checkIn: e.start.date,
                checkOut: checkoutDate,
                checkoutTime,
                cleaningTime,
                cleaningDateTime: `${checkoutDate}T${cleaningTime}:00`,
                reservationUrl,
                description: e.description || '',
              })
            }
          }
        } catch (err) {
          console.error(`Error fetching calendar ${calId}:`, err)
        }
      }

      // Sort by checkout date
      turnovers.sort((a, b) => a.checkOut.localeCompare(b.checkOut))

      return res.status(200).json({ turnovers })
    }

    return res.status(400).json({ error: 'Unknown action. Use: calendars, events, create, delete, turnovers' })
  } catch (err) {
    console.error('Calendar handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
