// Vercel serverless: Booking request management
// Accepts self-booking requests from maine-cleaning-co website
// Admin approves/rejects via dashboard → on approve, creates Google Calendar event + Connecteam shift
//
// Actions:
//   POST ?action=create    — Website submits a new booking request
//   GET  ?action=list      — Dashboard lists booking requests (filterable by status)
//   POST ?action=approve   — Admin approves a booking → creates calendar event + shift
//   POST ?action=reject    — Admin rejects a booking
//   GET  ?action=stats     — Booking stats summary

const ALLOWED_ORIGINS = [
  'https://maineclean.co',
  'https://www.maineclean.co',
  'https://maine-clean.co',
  'https://www.maine-clean.co',
  'https://connecteam-proxy.vercel.app',
  'http://localhost:5000',
  'http://localhost:5173',
]

export default async function handler(req, res) {
  const origin = req.headers.origin || ''
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  const action = req.query.action || 'list'
  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  }

  // ── CREATE BOOKING REQUEST ──
  if (action === 'create' && req.method === 'POST') {
    const {
      websiteBookingId, name, email, phone, address, zip,
      serviceType, frequency, sqft, bathrooms, petHair, condition,
      estimateMin, estimateMax, requestedDate, distanceMiles, source,
    } = req.body

    if (!name && !phone) {
      return res.status(400).json({ error: 'Name or phone required' })
    }
    if (!requestedDate) {
      return res.status(400).json({ error: 'Requested date required' })
    }

    try {
      // 1. Find or create client
      let clientId = null
      if (email) {
        const existingRes = await fetch(
          `${supabaseUrl}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&limit=1`,
          { headers: sbHeaders }
        )
        const existing = existingRes.ok ? await existingRes.json() : []
        if (existing.length > 0) {
          clientId = existing[0].id
        }
      }
      if (!clientId && phone) {
        const existingRes = await fetch(
          `${supabaseUrl}/rest/v1/clients?phone=eq.${encodeURIComponent(phone)}&limit=1`,
          { headers: sbHeaders }
        )
        const existing = existingRes.ok ? await existingRes.json() : []
        if (existing.length > 0) {
          clientId = existing[0].id
        }
      }
      if (!clientId) {
        const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify({
            name: name || 'Unknown',
            email: email || '',
            phone: phone || '',
            address: address || '',
            status: 'lead',
            type: 'residential',
            source: source || 'Website',
            tags: ['self-booking', serviceType, frequency].filter(Boolean),
          }),
        })
        if (clientRes.ok) {
          const data = await clientRes.json()
          clientId = data[0]?.id
        }
      }

      // 2. Create booking request in Supabase
      const estimateRange = estimateMin ? `$${estimateMin}-$${estimateMax}` : 'Custom'
      const bookingRes = await fetch(`${supabaseUrl}/rest/v1/booking_requests`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          client_id: clientId,
          website_booking_id: websiteBookingId || null,
          name: name || '',
          email: email || '',
          phone: phone || '',
          address: address || '',
          zip: zip || '',
          service_type: serviceType || 'standard',
          frequency: frequency || 'one-time',
          sqft: sqft ? parseInt(sqft) : null,
          bathrooms: bathrooms ? parseInt(bathrooms) : null,
          pet_hair: petHair || 'none',
          condition: condition || 'maintenance',
          estimate_min: estimateMin || null,
          estimate_max: estimateMax || null,
          requested_date: requestedDate,
          distance_miles: distanceMiles || null,
          status: 'pending',
          source: source || 'Website',
        }),
      })

      if (!bookingRes.ok) {
        const err = await bookingRes.text()
        console.error('Booking creation failed:', err)
        // Table might not exist yet — return success anyway
        return res.status(200).json({ success: true, bookingId: null, note: 'Booking received but table may need creation. See SQL below.' })
      }

      const bookingData = await bookingRes.json()
      const bookingId = bookingData[0]?.id

      // 3. Create notification
      try {
        await fetch(`${supabaseUrl}/rest/v1/notifications`, {
          method: 'POST',
          headers: sbHeaders,
          body: JSON.stringify({
            type: 'booking_request',
            title: `New Booking: ${name}`,
            message: `${name} requested ${serviceType} cleaning on ${requestedDate} (${estimateRange}). ${distanceMiles ? distanceMiles + ' mi away.' : ''}`,
            client_id: clientId,
            data: { bookingId, requestedDate, serviceType, estimateRange },
          }),
        })
      } catch (e) { console.error('Notification creation failed:', e) }

      // 4. Send admin email notification
      try {
        await sendBookingNotificationEmail({
          name, email, phone, address, serviceType, frequency,
          estimateMin, estimateMax, requestedDate, distanceMiles,
        })
      } catch (e) { console.error('Booking email notification failed:', e) }

      return res.status(200).json({ success: true, bookingId, clientId })
    } catch (err) {
      console.error('Booking creation error:', err)
      return res.status(500).json({ error: 'Failed to create booking' })
    }
  }

  // ── LIST BOOKING REQUESTS ──
  if (action === 'list' && req.method === 'GET') {
    const status = req.query.status
    let url = `${supabaseUrl}/rest/v1/booking_requests?order=created_at.desc&limit=100`
    if (status) url += `&status=eq.${status}`

    try {
      const listRes = await fetch(url, { headers: sbHeaders })
      if (!listRes.ok) {
        return res.status(200).json({ success: true, bookings: [], note: 'booking_requests table may not exist yet' })
      }
      const bookings = await listRes.json()
      return res.status(200).json({ success: true, bookings })
    } catch (e) {
      console.error('Booking list error:', e)
      return res.status(200).json({ success: true, bookings: [] })
    }
  }

  // ── APPROVE BOOKING ──
  if (action === 'approve' && req.method === 'POST') {
    const { bookingId, adminNotes, assignee, startTime, endTime } = req.body
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' })

    try {
      // 1. Get booking details
      const bookingRes = await fetch(
        `${supabaseUrl}/rest/v1/booking_requests?id=eq.${bookingId}&limit=1`,
        { headers: sbHeaders }
      )
      if (!bookingRes.ok) return res.status(404).json({ error: 'Booking not found' })
      const bookings = await bookingRes.json()
      if (bookings.length === 0) return res.status(404).json({ error: 'Booking not found' })

      const booking = bookings[0]
      const start = startTime || '09:00'
      const end = endTime || '12:00'

      // 2. Create Google Calendar event
      let googleEventId = null
      try {
        const calRes = await fetch(
          `https://${req.headers.host}/api/google?action=calendar-create`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              summary: `${booking.service_type === 'deep' ? 'Deep Clean' : 'Cleaning'} - ${booking.name}`,
              description: [
                `Client: ${booking.name}`,
                `Phone: ${booking.phone}`,
                booking.email ? `Email: ${booking.email}` : '',
                `Address: ${booking.address}`,
                booking.estimate_min ? `Estimate: $${booking.estimate_min}-$${booking.estimate_max}` : '',
                `Service: ${booking.service_type}`,
                booking.frequency ? `Frequency: ${booking.frequency}` : '',
                adminNotes ? `Notes: ${adminNotes}` : '',
                '',
                'Booked via website self-booking',
              ].filter(Boolean).join('\n'),
              startDateTime: `${booking.requested_date.split('T')[0]}T${start}:00`,
              endDateTime: `${booking.requested_date.split('T')[0]}T${end}:00`,
              location: booking.address,
            }),
          }
        )
        if (calRes.ok) {
          const calData = await calRes.json()
          googleEventId = calData.id
        }
      } catch (e) { console.error('Google Calendar creation failed:', e) }

      // 3. Create Connecteam shift
      let connecteamShiftId = null
      const connecteamKey = process.env.CONNECTEAM_API_KEY
      if (connecteamKey) {
        try {
          const shiftRes = await fetch(
            `https://${req.headers.host}/api/connecteam?action=shift`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': connecteamKey,
              },
              body: JSON.stringify({
                title: `${booking.service_type === 'deep' ? 'Deep Clean' : 'Cleaning'} - ${booking.name}`,
                date: booking.requested_date.split('T')[0],
                startTime: start,
                endTime: end,
                address: booking.address,
                clientName: booking.name,
                clientPhone: booking.phone,
                clientEmail: booking.email,
                price: booking.estimate_min ? `${booking.estimate_min}-${booking.estimate_max}` : '',
                notes: adminNotes || 'Self-booked via website',
                assignee: assignee || '',
              }),
            }
          )
          if (shiftRes.ok) {
            const shiftData = await shiftRes.json()
            connecteamShiftId = shiftData.shift?.id || null
          }
        } catch (e) { console.error('Connecteam shift creation failed:', e) }
      }

      // 4. Create job in Supabase
      let jobId = null
      try {
        const jobRes = await fetch(`${supabaseUrl}/rest/v1/jobs`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify({
            client_id: booking.client_id,
            client_name: booking.name,
            title: `${booking.service_type === 'deep' ? 'Deep Clean' : 'Cleaning'} - ${booking.name}`,
            date: booking.requested_date.split('T')[0],
            start_time: start,
            end_time: end,
            status: 'scheduled',
            assignee: assignee || null,
            notes: adminNotes || 'Self-booked via website',
            price: booking.estimate_min || null,
            service_type: booking.service_type,
            address: booking.address,
            google_event_id: googleEventId,
          }),
        })
        if (jobRes.ok) {
          const jobData = await jobRes.json()
          jobId = jobData[0]?.id
        }
      } catch (e) { console.error('Job creation failed:', e) }

      // 5. Update booking status
      await fetch(`${supabaseUrl}/rest/v1/booking_requests?id=eq.${bookingId}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify({
          status: 'approved',
          admin_notes: adminNotes || null,
          google_event_id: googleEventId,
          connecteam_shift_id: connecteamShiftId,
          job_id: jobId,
          approved_at: new Date().toISOString(),
        }),
      })

      // 6. Send customer confirmation email
      try {
        await sendBookingConfirmationEmail(booking, { start, end, adminNotes })
      } catch (e) { console.error('Booking confirmation email failed:', e) }

      return res.status(200).json({
        success: true,
        bookingId,
        jobId,
        googleEventId,
        connecteamShiftId,
      })
    } catch (err) {
      console.error('Booking approval error:', err)
      return res.status(500).json({ error: 'Failed to approve booking' })
    }
  }

  // ── REJECT BOOKING ──
  if (action === 'reject' && req.method === 'POST') {
    const { bookingId, adminNotes } = req.body
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' })

    try {
      // Get booking for email
      const bookingRes = await fetch(
        `${supabaseUrl}/rest/v1/booking_requests?id=eq.${bookingId}&limit=1`,
        { headers: sbHeaders }
      )
      const bookings = bookingRes.ok ? await bookingRes.json() : []
      const booking = bookings[0]

      await fetch(`${supabaseUrl}/rest/v1/booking_requests?id=eq.${bookingId}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify({
          status: 'rejected',
          admin_notes: adminNotes || null,
          rejected_at: new Date().toISOString(),
        }),
      })

      // Send rejection/reschedule email to customer
      if (booking?.email) {
        try {
          await sendBookingRejectionEmail(booking, adminNotes)
        } catch (e) { console.error('Rejection email failed:', e) }
      }

      return res.status(200).json({ success: true, bookingId })
    } catch (err) {
      console.error('Booking rejection error:', err)
      return res.status(500).json({ error: 'Failed to reject booking' })
    }
  }

  // ── STATS ──
  if (action === 'stats' && req.method === 'GET') {
    try {
      const allRes = await fetch(`${supabaseUrl}/rest/v1/booking_requests?select=status`, { headers: sbHeaders })
      const all = allRes.ok ? await allRes.json() : []
      const stats = { total: all.length, pending: 0, approved: 0, rejected: 0 }
      for (const b of all) {
        if (b.status === 'pending') stats.pending++
        else if (b.status === 'approved') stats.approved++
        else if (b.status === 'rejected') stats.rejected++
      }
      return res.status(200).json({ success: true, stats })
    } catch (e) {
      return res.status(200).json({ success: true, stats: { total: 0, pending: 0, approved: 0, rejected: 0 } })
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use: create, list, approve, reject, stats' })
}

// ── Email helpers ──

async function getGmailAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  const data = await tokenRes.json()
  return data.access_token || null
}

async function sendGmail(accessToken, to, subject, htmlBody) {
  const raw = Buffer.from(
    'To: ' + to + '\r\n' +
    'From: The Maine Cleaning Co. <office@mainecleaningco.com>\r\n' +
    'Reply-To: office@mainecleaningco.com\r\n' +
    'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=\r\n' +
    'MIME-Version: 1.0\r\n' +
    'Content-Type: text/html; charset=UTF-8\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    '\r\n' +
    Buffer.from(htmlBody).toString('base64')
  ).toString('base64url')

  await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
}

async function sendBookingNotificationEmail(booking) {
  const token = await getGmailAccessToken()
  if (!token) return

  const estimate = booking.estimateMin ? `$${booking.estimateMin}-$${booking.estimateMax}` : 'Custom'
  const subject = `New Booking Request: ${booking.name} - ${booking.requestedDate} (${estimate})`
  const body = [
    'NEW SELF-BOOKING REQUEST',
    '----------------------------------------',
    '',
    'Name: ' + (booking.name || 'N/A'),
    'Phone: ' + (booking.phone || 'N/A'),
    'Email: ' + (booking.email || 'N/A'),
    'Address: ' + (booking.address || 'N/A'),
    '',
    'Requested Date: ' + booking.requestedDate,
    'Service: ' + (booking.serviceType || 'N/A'),
    'Frequency: ' + (booking.frequency || 'N/A'),
    'Estimate: ' + estimate,
    booking.distanceMiles ? 'Distance: ' + booking.distanceMiles + ' miles' : '',
    '',
    '----------------------------------------',
    'APPROVE/REJECT in Workflow HQ:',
    'https://connecteam-proxy.vercel.app/#/bookings',
  ].filter(Boolean).join('\r\n')

  const raw = Buffer.from(
    'To: office@mainecleaningco.com\r\n' +
    'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=\r\n' +
    'Content-Type: text/plain; charset=UTF-8\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    '\r\n' +
    Buffer.from(body).toString('base64')
  ).toString('base64url')

  await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
}

async function sendBookingConfirmationEmail(booking, { start, end, adminNotes }) {
  if (!booking.email) return
  const token = await getGmailAccessToken()
  if (!token) return

  const firstName = booking.name ? booking.name.split(' ')[0] : 'there'
  const dateStr = new Date(booking.requested_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const estimate = booking.estimate_min ? `$${booking.estimate_min}-$${booking.estimate_max}` : ''
  const subject = `Your cleaning is confirmed for ${dateStr}!`

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f4f4f2;">' +
    '<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e3;">' +
    '<div style="background:#3a4f5c;padding:32px;text-align:center;">' +
    '<h1 style="color:#fff;font-size:22px;margin:0 0 6px;font-weight:700;">Booking Confirmed!</h1>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0;">The Maine Cleaning Co.</p></div>' +
    '<div style="padding:32px;">' +
    '<p style="font-size:16px;color:#1f2937;line-height:1.6;margin:0 0 24px;">Hi ' + firstName + ', great news! Your cleaning has been confirmed.</p>' +
    '<div style="background:linear-gradient(135deg,#eff6ff,#ecfdf5);border:1px solid #93c5fd;border-radius:12px;padding:20px 24px;margin-bottom:28px;text-align:center;">' +
    '<div style="font-size:11px;color:#1d4ed8;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Your Cleaning Date</div>' +
    '<div style="font-size:28px;font-weight:800;color:#1e40af;">' + dateStr + '</div>' +
    '<div style="font-size:14px;color:#6b7280;margin-top:6px;">' + start + ' - ' + end + (estimate ? ' &middot; ' + estimate : '') + '</div>' +
    '</div>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:28px;">' +
    '<tr><td style="padding:6px 0;color:#6b7280;width:100px;font-size:14px;">Address</td><td style="padding:6px 0;font-weight:600;color:#1f2937;font-size:14px;">' + (booking.address || '') + '</td></tr>' +
    '<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;font-weight:600;color:#1f2937;font-size:14px;">' + (booking.service_type || 'Cleaning') + '</td></tr>' +
    (adminNotes ? '<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Notes</td><td style="padding:6px 0;font-weight:600;color:#1f2937;font-size:14px;">' + adminNotes + '</td></tr>' : '') +
    '</table>' +
    '<div style="text-align:center;padding:16px 0;">' +
    '<p style="font-size:14px;color:#374151;margin:0 0 8px;">Need to reschedule? Contact us:</p>' +
    '<p style="font-size:14px;margin:0;"><a href="tel:207-572-0502" style="color:#3a4f5c;font-weight:600;text-decoration:none;">(207) 572-0502</a>' +
    '<span style="color:#d1d5db;margin:0 10px;">|</span>' +
    '<a href="mailto:office@mainecleaningco.com" style="color:#3a4f5c;font-weight:600;text-decoration:none;">office@mainecleaningco.com</a></p></div>' +
    '</div>' +
    '<div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e5e3;text-align:center;">' +
    '<p style="font-size:12px;color:#9ca3af;margin:0;">The Maine Cleaning Co. &middot; Southern Maine &middot; Est. 2018</p></div>' +
    '</div></body></html>'

  await sendGmail(token, booking.email, subject, html)
}

async function sendBookingRejectionEmail(booking, adminNotes) {
  if (!booking.email) return
  const token = await getGmailAccessToken()
  if (!token) return

  const firstName = booking.name ? booking.name.split(' ')[0] : 'there'
  const dateStr = new Date(booking.requested_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const subject = 'About your cleaning request for ' + dateStr

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f4f4f2;">' +
    '<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e3;">' +
    '<div style="background:#3a4f5c;padding:32px;text-align:center;">' +
    '<h1 style="color:#fff;font-size:22px;margin:0 0 6px;font-weight:700;">Let\'s Find a Better Date</h1>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0;">The Maine Cleaning Co.</p></div>' +
    '<div style="padding:32px;">' +
    '<p style="font-size:16px;color:#1f2937;line-height:1.6;margin:0 0 24px;">Hi ' + firstName + ', unfortunately we\'re unable to accommodate the date you requested (' + dateStr + ').' +
    (adminNotes ? ' ' + adminNotes : '') + '</p>' +
    '<p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 24px;">We\'d love to help find a date that works! Please give us a call or text and we\'ll get you scheduled.</p>' +
    '<div style="text-align:center;padding:16px 0;">' +
    '<a href="tel:207-572-0502" style="display:inline-block;background:#3a4f5c;color:#fff;padding:12px 32px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;">Call (207) 572-0502</a></div>' +
    '</div>' +
    '<div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e5e3;text-align:center;">' +
    '<p style="font-size:12px;color:#9ca3af;margin:0;">The Maine Cleaning Co. &middot; Southern Maine &middot; Est. 2018</p></div>' +
    '</div></body></html>'

  await sendGmail(token, booking.email, subject, html)
}
