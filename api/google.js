// Vercel serverless: Unified Google proxy (Calendar, Contacts, Drive)
// Uses GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN from env
// (Same Gmail OAuth credentials work for all Google APIs)
//
// Action routing:
//   calendar-*  or legacy: calendars, events, create, delete, turnovers
//   contacts-*  or legacy: list (when routed here)
//   drive-*     or legacy: list, upload, save-report, delete (when routed here)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({ error: 'Google not configured. Uses same OAuth as Gmail (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN).' })
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

    const action = req.query.action || req.body?.action || ''

    // ════════════════════════════════════════════════════════════════
    // CALENDAR ACTIONS
    // Supports: calendar-list, calendar-events, calendar-create,
    //           calendar-delete, calendar-turnovers
    // Legacy:   calendars, events, create, delete, turnovers
    // ════════════════════════════════════════════════════════════════
    if (action === 'calendar-list' || action === 'calendar-events' || action === 'calendar-create' ||
        action === 'calendar-delete' || action === 'calendar-turnovers' ||
        action === 'calendars' || action === 'events' || action === 'turnovers' ||
        action.startsWith('calendar')) {

      const calBase = 'https://www.googleapis.com/calendar/v3'
      const headers = { Authorization: `Bearer ${accessToken}` }

      // ── LIST CALENDARS ──
      if (action === 'calendars' || action === 'calendar-list') {
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
      if (action === 'events' || action === 'calendar-events') {
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
      if ((action === 'create' || action === 'calendar-create') && req.method === 'POST') {
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
      if ((action === 'delete' || action === 'calendar-delete') && req.method === 'POST') {
        const { calendarId, eventId } = req.body
        const calId = calendarId || 'primary'
        const r = await fetch(`${calBase}/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {
          method: 'DELETE',
          headers,
        })
        return res.status(r.ok ? 200 : r.status).json({ deleted: r.ok })
      }

      // ── DETECT TURNOVERS from rental calendars ──
      if (action === 'turnovers' || action === 'calendar-turnovers') {
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
              if (e.start?.date && e.end?.date) {
                const checkoutDate = e.end.date
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

        turnovers.sort((a, b) => a.checkOut.localeCompare(b.checkOut))

        return res.status(200).json({ turnovers })
      }

      return res.status(400).json({ error: 'Unknown calendar action. Use: calendar-list, calendar-events, calendar-create, calendar-delete, calendar-turnovers (or legacy: calendars, events, create, delete, turnovers)' })
    }

    // ════════════════════════════════════════════════════════════════
    // CONTACTS ACTIONS
    // Supports: contacts-list, contacts-search
    // Legacy:   list (use contacts-list to be explicit)
    // ════════════════════════════════════════════════════════════════
    if (action === 'contacts-list' || action === 'contacts-search' || action === 'contacts-sync' || action.startsWith('contacts')) {

      // ── LIST / SEARCH CONTACTS ──
      const pageSize = req.query.pageSize || 100
      const query = req.query.q || ''

      let url = `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,addresses,organizations&pageSize=${pageSize}&sortOrder=LAST_MODIFIED_DESCENDING`
      if (query || action === 'contacts-search') {
        const searchQuery = query || req.query.query || ''
        url = `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(searchQuery)}&readMask=names,emailAddresses,phoneNumbers,addresses,organizations&pageSize=${pageSize}`
      }

      const contactsRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const data = await contactsRes.json()

      const contacts = (data.connections || data.results?.map(r => r.person) || []).map(p => ({
        name: p.names?.[0]?.displayName || '',
        firstName: p.names?.[0]?.givenName || '',
        lastName: p.names?.[0]?.familyName || '',
        email: p.emailAddresses?.[0]?.value || '',
        phone: p.phoneNumbers?.[0]?.value || '',
        address: p.addresses?.[0]?.formattedValue || '',
        company: p.organizations?.[0]?.name || '',
      })).filter(c => c.name || c.email || c.phone)

      return res.status(200).json({ contacts, total: contacts.length })
    }

    // ════════════════════════════════════════════════════════════════
    // DRIVE ACTIONS
    // Supports: drive-list, drive-upload, drive-save-report,
    //           drive-delete, drive-download
    // Legacy:   list, upload, save-report, delete (use drive-* prefix)
    // ════════════════════════════════════════════════════════════════
    if (action === 'drive-list' || action === 'drive-upload' || action === 'drive-download' ||
        action === 'drive-save-report' || action === 'drive-delete' ||
        action.startsWith('drive')) {

      const driveBase = 'https://www.googleapis.com/drive/v3'
      const headers = { Authorization: `Bearer ${accessToken}` }

      // ── GET OR CREATE APP FOLDER ──
      async function getAppFolder() {
        const searchRes = await fetch(`${driveBase}/files?q=${encodeURIComponent("name='Workflow HQ' and mimeType='application/vnd.google-apps.folder' and trashed=false")}&fields=files(id,name)`, { headers })
        const searchData = await searchRes.json()
        if (searchData.files?.length > 0) return searchData.files[0].id

        const createRes = await fetch(`${driveBase}/files`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Workflow HQ', mimeType: 'application/vnd.google-apps.folder' }),
        })
        const folder = await createRes.json()
        return folder.id
      }

      // ── GET OR CREATE CLIENT FOLDER ──
      async function getClientFolder(parentId, clientName) {
        const safeName = clientName.replace(/[^\w\s-]/g, '').trim() || 'Unknown'
        const searchRes = await fetch(`${driveBase}/files?q=${encodeURIComponent(`name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name)`, { headers })
        const searchData = await searchRes.json()
        if (searchData.files?.length > 0) return searchData.files[0].id

        const createRes = await fetch(`${driveBase}/files`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: safeName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
        })
        const folder = await createRes.json()
        return folder.id
      }

      // ── LIST FILES ──
      if (action === 'drive-list') {
        const clientName = req.query.clientName
        const appFolder = await getAppFolder()

        let folderId = appFolder
        if (clientName) {
          folderId = await getClientFolder(appFolder, clientName)
        }

        const listRes = await fetch(`${driveBase}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink)&orderBy=modifiedTime desc&pageSize=50`, { headers })
        const listData = await listRes.json()

        return res.status(200).json({
          folderId,
          files: (listData.files || []).map(f => ({
            id: f.id, name: f.name, mimeType: f.mimeType,
            size: f.size, modifiedTime: f.modifiedTime,
            url: f.webViewLink, icon: f.iconLink, thumbnail: f.thumbnailLink,
          })),
        })
      }

      // ── UPLOAD FILE (from URL or text content) ──
      if ((action === 'drive-upload') && req.method === 'POST') {
        const { clientName, fileName, content, mimeType } = req.body
        if (!fileName || !content) return res.status(400).json({ error: 'fileName and content required' })

        const appFolder = await getAppFolder()
        const folderId = clientName ? await getClientFolder(appFolder, clientName) : appFolder

        const metaRes = await fetch(`${driveBase}/files`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: fileName, parents: [folderId] }),
        })
        const fileMeta = await metaRes.json()

        const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileMeta.id}?uploadType=media`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': mimeType || 'text/plain' },
          body: content,
        })
        const uploadData = await uploadRes.json()

        const linkRes = await fetch(`${driveBase}/files/${fileMeta.id}?fields=webViewLink`, { headers })
        const linkData = await linkRes.json()

        return res.status(200).json({
          id: fileMeta.id, name: fileName, url: linkData.webViewLink,
        })
      }

      // ── SAVE REPORT TO DRIVE ──
      if ((action === 'drive-save-report') && req.method === 'POST') {
        const { title, content, clientName } = req.body
        if (!title || !content) return res.status(400).json({ error: 'title and content required' })

        const appFolder = await getAppFolder()
        const folderId = clientName ? await getClientFolder(appFolder, clientName) : appFolder

        const metaRes = await fetch(`${driveBase}/files`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: title,
            mimeType: 'application/vnd.google-apps.document',
            parents: [folderId],
          }),
        })
        const doc = await metaRes.json()

        await fetch(`https://docs.googleapis.com/v1/documents/${doc.id}:batchUpdate`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{ insertText: { location: { index: 1 }, text: content } }],
          }),
        })

        const linkRes = await fetch(`${driveBase}/files/${doc.id}?fields=webViewLink`, { headers })
        const linkData = await linkRes.json()

        return res.status(200).json({ id: doc.id, name: title, url: linkData.webViewLink })
      }

      // ── DELETE FILE ──
      if ((action === 'drive-delete') && req.method === 'POST') {
        const { fileId } = req.body
        if (!fileId) return res.status(400).json({ error: 'fileId required' })
        await fetch(`${driveBase}/files/${fileId}`, { method: 'DELETE', headers })
        return res.status(200).json({ deleted: true })
      }

      return res.status(400).json({ error: 'Unknown drive action. Use: drive-list, drive-upload, drive-save-report, drive-delete' })
    }

    return res.status(400).json({ error: 'Unknown action. Use calendar-*, contacts-*, or drive-*' })
  } catch (err) {
    console.error('Google handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
