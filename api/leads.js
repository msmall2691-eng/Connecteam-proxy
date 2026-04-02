// Vercel serverless: Lead intake webhook
// Accepts leads from: website form, Facebook Lead Ads, email parsing, SMS, manual
// POST /api/leads — creates a new lead in the system
// GET /api/leads — lists recent leads (for dashboard polling)

// In-memory store for leads (use Supabase in production)
// Leads are stored via the frontend store, but this endpoint
// accepts external webhooks and forwards to the store

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = req.query.action || 'create'

  // ── LIST WEBSITE REQUESTS ──
  if (req.method === 'GET' && (action === 'list' || action === 'create')) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey) {
      // Try website_requests table first
      try {
        const listRes = await fetch(
          `${supabaseUrl}/rest/v1/website_requests?order=created_at.desc&limit=100`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        )
        if (listRes.ok) {
          const requests = await listRes.json()
          if (requests.length > 0) {
            return res.status(200).json({ success: true, requests })
          }
        }
      } catch (e) {
        console.error('website_requests table query failed (may not exist yet):', e)
      }

      // Fallback: query clients table for website leads
      try {
        const clientsRes = await fetch(
          `${supabaseUrl}/rest/v1/clients?source=eq.Website&order=created_at.desc&limit=100`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        )
        if (clientsRes.ok) {
          const clients = await clientsRes.json()
          const requests = clients.map(c => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            source: c.source,
            property_type: c.type,
            status: c.status === 'lead' ? 'new' : c.status === 'prospect' ? 'quoted' : c.status === 'active' ? 'converted' : c.status,
            message: c.notes,
            service: (c.tags || [])[0] || '',
            frequency: (c.tags || [])[1] || '',
            created_at: c.created_at,
            client_id: c.id,
          }))
          return res.status(200).json({ success: true, requests })
        }
      } catch (e) {
        console.error('Clients fallback query failed:', e)
      }
    }

    return res.status(200).json({ success: true, requests: [] })
  }

  // ── WEBSITE FORM SUBMISSION ──
  if (action === 'create' && req.method === 'POST') {
    const {
      name, email, phone, address, message, service,
      source, propertyType, frequency, bedrooms, bathrooms,
      squareFeet, preferredDate, preferredTime, budget,
      petHair, condition,
      // Website quote fields (pre-calculated)
      estimateMin, estimateMax,
      // Facebook Lead Ads fields
      fb_lead_id, fb_form_id, fb_page_id,
      // Generic fields
      utm_source, utm_medium, utm_campaign,
    } = req.body

    if (!name && !email && !phone) {
      return res.status(400).json({ error: 'At least name, email, or phone is required' })
    }

    const lead = {
      // Core info
      name: name || 'Unknown',
      email: email || '',
      phone: phone || '',
      address: address || '',
      message: message || '',
      // Service details
      service: service || '',
      propertyType: propertyType || '',
      frequency: frequency || '',
      bedrooms: bedrooms || '',
      bathrooms: bathrooms || '',
      squareFeet: squareFeet || '',
      preferredDate: preferredDate || '',
      preferredTime: preferredTime || '',
      budget: budget || '',
      // Tracking
      source: source || detectSource(req, { utm_source, fb_lead_id }),
      utm_source: utm_source || '',
      utm_medium: utm_medium || '',
      utm_campaign: utm_campaign || '',
      fbLeadId: fb_lead_id || '',
      fbFormId: fb_form_id || '',
      // Estimate data (from website quote calculator)
      estimateMin: estimateMin || null,
      estimateMax: estimateMax || null,
      petHair: petHair || '',
      condition: condition || '',
      // Meta
      status: 'lead',
      type: mapPropertyType(propertyType),
      createdAt: new Date().toISOString(),
      receivedVia: detectChannel(req, { fb_lead_id, source }),
    }

    // Store lead (in production, write to Supabase)
    // For now, we return the lead data for the frontend to store
    // The frontend polls this or we push via webhook

    // If Supabase is configured, write directly
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey) {
      try {
        const sbRes = await fetch(`${supabaseUrl}/rest/v1/clients`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            address: lead.address,
            status: 'lead',
            type: lead.type,
            source: lead.source,
            notes: buildLeadNotes(lead),
            tags: [lead.service, lead.frequency, lead.receivedVia].filter(Boolean),
          }),
        })
        if (sbRes.ok) {
          const created = await sbRes.json()
          const clientId = created[0]?.id

          // Create property for this lead
          let propertyId = null
          if (clientId && lead.address) {
            try {
              const propRes = await fetch(`${supabaseUrl}/rest/v1/properties`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Prefer': 'return=representation' },
                body: JSON.stringify({
                  client_id: clientId,
                  name: lead.address.split(',')[0] || 'Primary',
                  address_line1: lead.address,
                  type: lead.type || 'residential',
                  sqft: lead.squareFeet ? parseInt(lead.squareFeet) : null,
                  bedrooms: lead.bedrooms ? parseInt(lead.bedrooms) : null,
                  bathrooms: lead.bathrooms ? parseInt(lead.bathrooms) : null,
                  pet_hair: lead.petHair || 'none',
                  condition: lead.condition || 'maintenance',
                  is_primary: true,
                }),
              })
              if (propRes.ok) {
                const propData = await propRes.json()
                propertyId = propData[0]?.id
              }
            } catch (e) { console.error('Property creation failed:', e) }
          }

          // Create draft quote
          if (clientId && lead.estimateMin) {
            try {
              const qNum = `QTE-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${String(Math.floor(Math.random()*9999)).padStart(4,'0')}`
              await fetch(`${supabaseUrl}/rest/v1/quotes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
                body: JSON.stringify({
                  quote_number: qNum,
                  client_id: clientId,
                  property_id: propertyId,
                  service_type: lead.service || lead.propertyType || 'standard',
                  frequency: lead.frequency || 'one-time',
                  estimate_min: lead.estimateMin,
                  estimate_max: lead.estimateMax,
                  status: 'draft',
                  calc_inputs: { sqft: lead.squareFeet, bathrooms: lead.bathrooms, petHair: lead.petHair, condition: lead.condition },
                  notes: lead.message || '',
                }),
              })
            } catch (e) { console.error('Quote creation failed:', e) }
          }

          // Send email notifications
          try {
            const gmailClientId = process.env.GMAIL_CLIENT_ID
            const gmailClientSecret = process.env.GMAIL_CLIENT_SECRET
            const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN
            if (gmailClientId && gmailClientSecret && gmailRefreshToken) {
              const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: gmailClientId, client_secret: gmailClientSecret, refresh_token: gmailRefreshToken, grant_type: 'refresh_token' }),
              })
              const tokenData = await tokenRes.json()
              if (tokenData.access_token) {
                const quoteRange = lead.estimateMin ? ('$' + lead.estimateMin + '-$' + lead.estimateMax) : 'Custom quote'
                const serviceLabel = lead.service || lead.frequency || 'Cleaning'

                // 1. NOTIFICATION EMAIL TO YOU (plain text, no emojis)
                const notifySubject = 'New Lead: ' + lead.name + ' - ' + serviceLabel + ' ' + quoteRange
                const notifyBody = [
                  'NEW LEAD FROM ' + (lead.source || 'WEBSITE').toUpperCase(),
                  '----------------------------------------',
                  '',
                  'Name: ' + lead.name,
                  'Email: ' + (lead.email || 'N/A'),
                  'Phone: ' + (lead.phone || 'N/A'),
                  'Address: ' + (lead.address || 'N/A'),
                  '',
                  'Service: ' + (lead.service || 'N/A'),
                  'Frequency: ' + (lead.frequency || 'N/A'),
                  'Estimate: ' + quoteRange,
                  '',
                  lead.squareFeet ? 'Sq Ft: ' + lead.squareFeet : '',
                  lead.bathrooms ? 'Bathrooms: ' + lead.bathrooms : '',
                  lead.petHair && lead.petHair !== 'none' ? 'Pet Hair: ' + lead.petHair : '',
                  lead.condition && lead.condition !== 'maintenance' ? 'Condition: ' + lead.condition : '',
                  lead.message ? '\nMessage: ' + lead.message : '',
                  '',
                  '----------------------------------------',
                  'View in Workflow HQ:',
                  'https://connecteam-proxy.vercel.app/#/website-requests',
                ].filter(Boolean).join('\r\n')

                const notifyRaw = Buffer.from(
                  'To: office@mainecleaningco.com\r\n' +
                  'Subject: =?UTF-8?B?' + Buffer.from(notifySubject).toString('base64') + '?=\r\n' +
                  'Content-Type: text/plain; charset=UTF-8\r\n' +
                  'Content-Transfer-Encoding: base64\r\n' +
                  '\r\n' +
                  Buffer.from(notifyBody).toString('base64')
                ).toString('base64url')

                await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + tokenData.access_token, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ raw: notifyRaw }),
                })

                // 2. CONFIRMATION EMAIL TO CUSTOMER (HTML)
                if (lead.email) {
                  const firstName = lead.name ? lead.name.split(' ')[0] : ''
                  const custSubject = (firstName ? firstName + ', w' : 'W') + 'e received your cleaning request - ' + quoteRange

                  const serviceDisplay = lead.service || 'Cleaning'
                  const freqDisplay = lead.frequency || 'One-time'
                  const addressDisplay = lead.address || ''

                  const detailRows = [
                    ['Service', serviceDisplay],
                    ['Frequency', freqDisplay],
                    addressDisplay ? ['Address', addressDisplay] : null,
                    lead.squareFeet ? ['Square Footage', Number(lead.squareFeet).toLocaleString() + ' sq ft'] : null,
                    lead.bathrooms ? ['Bathrooms', lead.bathrooms] : null,
                  ].filter(Boolean)

                  const detailRowsHtml = detailRows.map(function(r) {
                    return '<tr><td style="padding:6px 0;color:#6b7280;width:130px;font-size:14px;">' + r[0] + '</td><td style="padding:6px 0;font-weight:600;color:#1f2937;font-size:14px;">' + r[1] + '</td></tr>'
                  }).join('')

                  const custHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
                    '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;background:#f4f4f2;-webkit-text-size-adjust:100%;">' +
                    '<div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e3;">' +

                    // Header
                    '<div style="background:#3a4f5c;padding:32px;text-align:center;">' +
                    '<h1 style="color:#ffffff;font-size:22px;margin:0 0 6px;font-weight:700;">We Got Your Request!</h1>' +
                    '<p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0;">The Maine Cleaning Co.</p>' +
                    '</div>' +

                    // Body
                    '<div style="padding:32px;">' +

                    // Greeting
                    '<p style="font-size:16px;color:#1f2937;line-height:1.6;margin:0 0 24px;">Hi ' + (firstName || 'there') + ', thank you for requesting a cleaning estimate! We\'re excited to help.</p>' +

                    // Estimate box
                    '<div style="background:linear-gradient(135deg,#ecfdf5,#eff6ff);border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;margin-bottom:28px;text-align:center;">' +
                    '<div style="font-size:11px;color:#15803d;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Your Estimate Range</div>' +
                    '<div style="font-size:36px;font-weight:800;color:#166534;">' + quoteRange + '</div>' +
                    '<p style="font-size:12px;color:#6b7280;margin:8px 0 0;font-style:italic;">Non-binding estimate. Final price confirmed after review.</p>' +
                    '</div>' +

                    // Details table
                    '<table style="width:100%;border-collapse:collapse;margin-bottom:28px;">' + detailRowsHtml + '</table>' +

                    // What happens next
                    '<div style="background:#f8f8f6;border-radius:12px;padding:24px;margin-bottom:28px;">' +
                    '<h3 style="font-size:15px;color:#1f2937;margin:0 0 16px;font-weight:700;">What Happens Next</h3>' +
                    '<table style="width:100%;border-collapse:collapse;">' +
                    '<tr><td style="padding:8px 12px 8px 0;vertical-align:top;width:32px;"><div style="width:28px;height:28px;border-radius:50%;background:#3a4f5c;color:#fff;font-size:13px;font-weight:700;text-align:center;line-height:28px;">1</div></td><td style="padding:8px 0;"><div style="font-size:14px;font-weight:600;color:#1f2937;">We\'ll review your request</div><div style="font-size:12px;color:#6b7280;margin-top:2px;">Typically within 1 business day</div></td></tr>' +
                    '<tr><td style="padding:8px 12px 8px 0;vertical-align:top;"><div style="width:28px;height:28px;border-radius:50%;background:#3a4f5c;color:#fff;font-size:13px;font-weight:700;text-align:center;line-height:28px;">2</div></td><td style="padding:8px 0;"><div style="font-size:14px;font-weight:600;color:#1f2937;">We\'ll reach out to confirm details</div><div style="font-size:12px;color:#6b7280;margin-top:2px;">Via phone, text, or email</div></td></tr>' +
                    '<tr><td style="padding:8px 12px 8px 0;vertical-align:top;"><div style="width:28px;height:28px;border-radius:50%;background:#3a4f5c;color:#fff;font-size:13px;font-weight:700;text-align:center;line-height:28px;">3</div></td><td style="padding:8px 0;"><div style="font-size:14px;font-weight:600;color:#1f2937;">Get a final quote and schedule</div><div style="font-size:12px;color:#6b7280;margin-top:2px;">Usually within 3-7 business days</div></td></tr>' +
                    '</table></div>' +

                    // Contact
                    '<div style="text-align:center;padding:16px 0;">' +
                    '<p style="font-size:14px;color:#374151;margin:0 0 8px;">Have questions? We\'re here to help.</p>' +
                    '<p style="font-size:14px;margin:0;">' +
                    '<a href="tel:207-572-0502" style="color:#3a4f5c;font-weight:600;text-decoration:none;">(207) 572-0502</a>' +
                    '<span style="color:#d1d5db;margin:0 10px;">|</span>' +
                    '<a href="mailto:office@mainecleaningco.com" style="color:#3a4f5c;font-weight:600;text-decoration:none;">office@mainecleaningco.com</a>' +
                    '</p></div>' +

                    '</div>' +

                    // Footer
                    '<div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e5e3;text-align:center;">' +
                    '<p style="font-size:12px;color:#9ca3af;margin:0;">The Maine Cleaning Co. &middot; Southern Maine &middot; Est. 2018</p>' +
                    '</div>' +

                    '</div></body></html>'

                  const custRaw = Buffer.from(
                    'To: ' + lead.email + '\r\n' +
                    'From: The Maine Cleaning Co. <office@mainecleaningco.com>\r\n' +
                    'Reply-To: office@mainecleaningco.com\r\n' +
                    'Subject: =?UTF-8?B?' + Buffer.from(custSubject).toString('base64') + '?=\r\n' +
                    'MIME-Version: 1.0\r\n' +
                    'Content-Type: text/html; charset=UTF-8\r\n' +
                    'Content-Transfer-Encoding: base64\r\n' +
                    '\r\n' +
                    Buffer.from(custHtml).toString('base64')
                  ).toString('base64url')

                  await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + tokenData.access_token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ raw: custRaw }),
                  })
                }
              }
            }
          } catch (e) { console.error('Lead notification email failed:', e) }

          // Also store as a website request for the dashboard
          try {
            if (supabaseUrl && supabaseKey) {
              await fetch(`${supabaseUrl}/rest/v1/website_requests`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': supabaseKey,
                  'Authorization': `Bearer ${supabaseKey}`,
                },
                body: JSON.stringify({
                  name: lead.name,
                  email: lead.email,
                  phone: lead.phone,
                  address: lead.address,
                  service: lead.service,
                  message: lead.message,
                  source: lead.source,
                  property_type: lead.type,
                  frequency: lead.frequency,
                  estimate_min: lead.estimateMin || null,
                  estimate_max: lead.estimateMax || null,
                  sqft: lead.squareFeet || null,
                  bathrooms: lead.bathrooms || null,
                  pet_hair: lead.petHair || null,
                  condition: lead.condition || null,
                  status: 'new',
                  client_id: clientId || null,
                }),
              })
            }
          } catch (e) { console.error('Website request storage failed:', e) }

          lead.websiteRequestStored = true
          return res.status(200).json({ success: true, leadId: clientId, propertyId, lead })
        }
      } catch (err) {
        console.error('Supabase write failed:', err)
      }
    }

    // Fallback: return lead for frontend to handle
    lead.websiteRequestStored = true
    return res.status(200).json({ success: true, lead, note: 'Lead received. Add to CRM from the dashboard.' })
  }

  // ── FACEBOOK LEAD ADS WEBHOOK ──
  if (action === 'facebook' && req.method === 'POST') {
    // Facebook sends lead data in a specific format
    const { entry } = req.body || {}

    if (!entry) {
      // Facebook webhook verification (GET with hub.challenge)
      if (req.method === 'GET' && req.query['hub.verify_token'] === (process.env.FB_VERIFY_TOKEN || 'workflowhq')) {
        return res.status(200).send(req.query['hub.challenge'])
      }
      return res.status(400).json({ error: 'No entry data' })
    }

    const leads = []
    for (const e of entry) {
      for (const change of e.changes || []) {
        if (change.field === 'leadgen') {
          const leadData = change.value
          // Fetch lead details from Facebook Graph API
          const fbToken = process.env.FB_PAGE_ACCESS_TOKEN
          if (fbToken && leadData.leadgen_id) {
            try {
              const fbRes = await fetch(
                `https://graph.facebook.com/v18.0/${leadData.leadgen_id}?access_token=${fbToken}`
              )
              const fbLead = await fbRes.json()
              const fields = {}
              for (const f of fbLead.field_data || []) {
                fields[f.name] = f.values?.[0] || ''
              }
              leads.push({
                name: fields.full_name || fields.first_name || '',
                email: fields.email || '',
                phone: fields.phone_number || '',
                source: 'Facebook Lead Ad',
                fb_lead_id: leadData.leadgen_id,
                fb_form_id: leadData.form_id,
                fb_page_id: leadData.page_id,
                service: fields.service || fields.what_service || '',
                message: fields.message || fields.comments || '',
              })
            } catch (err) {
              console.error('Facebook lead fetch error:', err)
            }
          }
        }
      }
    }

    return res.status(200).json({ received: leads.length, leads })
  }

  // ── FACEBOOK WEBHOOK VERIFICATION ──
  if (action === 'facebook' && req.method === 'GET') {
    const verifyToken = process.env.FB_VERIFY_TOKEN || 'workflowhq'
    if (req.query['hub.verify_token'] === verifyToken) {
      return res.status(200).send(req.query['hub.challenge'])
    }
    return res.status(403).json({ error: 'Invalid verify token' })
  }

  // ══════════════════════════════════════════════
  // BOOKING ACTIONS (booking-create, booking-list, booking-approve, booking-reject, booking-stats)
  // Self-booking requests from website, admin approval workflow
  // ══════════════════════════════════════════════

  if (action.startsWith('booking-')) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase not configured' })
    }
    const sbHeaders = {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    }

    // ── CREATE BOOKING REQUEST ──
    if (action === 'booking-create' && req.method === 'POST') {
      const {
        websiteBookingId, name, email, phone, address, zip,
        serviceType, frequency, sqft, bathrooms, petHair, condition,
        estimateMin, estimateMax, requestedDate, distanceMiles, source,
      } = req.body

      if (!name && !phone) return res.status(400).json({ error: 'Name or phone required' })
      if (!requestedDate) return res.status(400).json({ error: 'Requested date required' })

      try {
        // Find existing client — try email, then normalized phone, then name
        let clientId = null
        const phoneDigits = (phone || '').replace(/\D/g, '')

        if (email) {
          const r = await fetch(`${supabaseUrl}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&limit=1`, { headers: sbHeaders })
          const d = r.ok ? await r.json() : []
          if (d.length > 0) clientId = d[0].id
        }
        if (!clientId && phoneDigits.length >= 10) {
          // Search by phone containing the digits (handles format differences)
          const r = await fetch(`${supabaseUrl}/rest/v1/clients?or=(phone.eq.${phoneDigits},phone.eq.${phoneDigits.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')},phone.eq.${phoneDigits.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')},phone.like.*${phoneDigits.slice(-7)}*)&limit=1`, { headers: sbHeaders })
          const d = r.ok ? await r.json() : []
          if (d.length > 0) clientId = d[0].id
        }
        if (!clientId && name) {
          // Fallback: search by name + address match
          const r = await fetch(`${supabaseUrl}/rest/v1/clients?name=eq.${encodeURIComponent(name)}&limit=5`, { headers: sbHeaders })
          const d = r.ok ? await r.json() : []
          if (d.length === 1) {
            clientId = d[0].id
          } else if (d.length > 1 && address) {
            // Multiple matches — pick the one with matching address
            const match = d.find(c => c.address && address.includes(c.address.split(',')[0]))
            if (match) clientId = match.id
            else clientId = d[0].id
          }
        }

        // Update existing client with booking tag, or create new
        if (clientId) {
          try {
            await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`, {
              method: 'PATCH', headers: sbHeaders,
              body: JSON.stringify({ status: 'prospect', updated_at: new Date().toISOString() }),
            })
          } catch (e) { /* ignore update failure */ }
        } else {
          const r = await fetch(`${supabaseUrl}/rest/v1/clients`, {
            method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=representation' },
            body: JSON.stringify({ name: name || 'Unknown', email: email || '', phone: phone || '', address: address || '', status: 'prospect', type: 'residential', source: source || 'Website', tags: ['self-booking', serviceType, frequency].filter(Boolean) }),
          })
          if (r.ok) { const d = await r.json(); clientId = d[0]?.id }
        }

        // Also link to existing website_request if there is one
        if (clientId) {
          try {
            const wrRes = await fetch(`${supabaseUrl}/rest/v1/website_requests?client_id=eq.${clientId}&order=created_at.desc&limit=1`, { headers: sbHeaders })
            if (wrRes.ok) {
              const wr = await wrRes.json()
              if (wr.length > 0) {
                await fetch(`${supabaseUrl}/rest/v1/website_requests?id=eq.${wr[0].id}`, {
                  method: 'PATCH', headers: sbHeaders,
                  body: JSON.stringify({ status: 'booked' }),
                })
              }
            }
          } catch (e) { /* ignore */ }
        }

        // Try to find or create a matching property for this client
        let propertyId = null
        if (clientId && address) {
          try {
            const propRes = await fetch(`${supabaseUrl}/rest/v1/properties?client_id=eq.${clientId}&limit=10`, { headers: sbHeaders })
            if (propRes.ok) {
              const props = await propRes.json()
              const addrNorm = (address || '').toLowerCase().replace(/[^a-z0-9]/g, '')
              const match = props.find(p => (p.address_line1 || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(addrNorm.slice(0, 15)))
              if (match) {
                propertyId = match.id
              } else {
                // Create new property from booking data
                const newProp = await fetch(`${supabaseUrl}/rest/v1/properties`, {
                  method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                  body: JSON.stringify({ client_id: clientId, address_line1: address || '', zip: zip || '', type: 'residential', sqft: sqft ? parseInt(sqft) : null, bathrooms: bathrooms ? parseInt(bathrooms) : null, pet_hair: petHair || 'none', condition: condition || 'maintenance', is_primary: true }),
                })
                if (newProp.ok) { const np = await newProp.json(); propertyId = np[0]?.id }
              }
            }
          } catch (e) { /* property linking is best-effort */ }
        }

        const bookingRes = await fetch(`${supabaseUrl}/rest/v1/booking_requests`, {
          method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify({ client_id: clientId, property_id: propertyId, website_booking_id: websiteBookingId || null, name: name || '', email: email || '', phone: phone || '', address: address || '', zip: zip || '', service_type: serviceType || 'standard', frequency: frequency || 'one-time', sqft: sqft ? parseInt(sqft) : null, bathrooms: bathrooms ? parseInt(bathrooms) : null, pet_hair: petHair || 'none', condition: condition || 'maintenance', estimate_min: estimateMin || null, estimate_max: estimateMax || null, requested_date: requestedDate, distance_miles: distanceMiles || null, status: 'pending', source: source || 'Website' }),
        })
        if (!bookingRes.ok) return res.status(200).json({ success: true, bookingId: null, note: 'Booking received but table may need creation.' })

        const bookingData = await bookingRes.json()
        const bookingId = bookingData[0]?.id
        const estimateRange = estimateMin ? `$${estimateMin}-$${estimateMax}` : 'Custom'

        try { await fetch(`${supabaseUrl}/rest/v1/notifications`, { method: 'POST', headers: sbHeaders, body: JSON.stringify({ type: 'booking_request', title: `New Booking: ${name}`, message: `${name} requested ${serviceType} cleaning on ${requestedDate} (${estimateRange}). ${distanceMiles ? distanceMiles + ' mi away.' : ''}`, client_id: clientId, data: { bookingId, requestedDate, serviceType, estimateRange } }) }) } catch (e) { console.error('Notification failed:', e) }
        try { await sendBookingNotificationEmail({ name, email, phone, address, serviceType, frequency, estimateMin, estimateMax, requestedDate, distanceMiles }) } catch (e) { console.error('Booking email failed:', e) }

        return res.status(200).json({ success: true, bookingId, clientId })
      } catch (err) {
        console.error('Booking creation error:', err)
        return res.status(500).json({ error: 'Failed to create booking' })
      }
    }

    // ── LIST BOOKING REQUESTS ──
    if (action === 'booking-list' && req.method === 'GET') {
      const status = req.query.status
      let url = `${supabaseUrl}/rest/v1/booking_requests?order=created_at.desc&limit=100`
      if (status) url += `&status=eq.${status}`
      try {
        const r = await fetch(url, { headers: sbHeaders })
        if (!r.ok) return res.status(200).json({ success: true, bookings: [] })
        return res.status(200).json({ success: true, bookings: await r.json() })
      } catch (e) { return res.status(200).json({ success: true, bookings: [] }) }
    }

    // ── APPROVE BOOKING ──
    if (action === 'booking-approve' && req.method === 'POST') {
      const { bookingId, adminNotes, assignee, startTime, endTime } = req.body
      if (!bookingId) return res.status(400).json({ error: 'bookingId required' })

      try {
        const bRes = await fetch(`${supabaseUrl}/rest/v1/booking_requests?id=eq.${bookingId}&limit=1`, { headers: sbHeaders })
        if (!bRes.ok) return res.status(404).json({ error: 'Booking not found' })
        const bList = await bRes.json()
        if (bList.length === 0) return res.status(404).json({ error: 'Booking not found' })

        const booking = bList[0]
        const start = startTime || '09:00', end = endTime || '12:00'

        let googleEventId = null
        try {
          const r = await fetch(`https://${req.headers.host}/api/google?action=calendar-create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: `${booking.service_type === 'deep' ? 'Deep Clean' : 'Cleaning'} - ${booking.name}`, description: [`Client: ${booking.name}`, `Phone: ${booking.phone}`, booking.email ? `Email: ${booking.email}` : '', `Address: ${booking.address}`, booking.estimate_min ? `Estimate: $${booking.estimate_min}-$${booking.estimate_max}` : '', `Service: ${booking.service_type}`, booking.frequency ? `Frequency: ${booking.frequency}` : '', adminNotes ? `Notes: ${adminNotes}` : '', '', 'Booked via website self-booking'].filter(Boolean).join('\n'), startDateTime: `${booking.requested_date.split('T')[0]}T${start}:00`, endDateTime: `${booking.requested_date.split('T')[0]}T${end}:00`, location: booking.address }) })
          if (r.ok) { const d = await r.json(); googleEventId = d.id }
        } catch (e) { console.error('GCal failed:', e) }

        let connecteamShiftId = null
        const ctKey = process.env.CONNECTEAM_API_KEY
        if (ctKey) {
          try {
            const r = await fetch(`https://${req.headers.host}/api/connecteam?action=shift`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': ctKey }, body: JSON.stringify({ title: `${booking.service_type === 'deep' ? 'Deep Clean' : 'Cleaning'} - ${booking.name}`, date: booking.requested_date.split('T')[0], startTime: start, endTime: end, address: booking.address, clientName: booking.name, clientPhone: booking.phone, clientEmail: booking.email, price: booking.estimate_min ? `${booking.estimate_min}-${booking.estimate_max}` : '', notes: adminNotes || 'Self-booked via website', assignee: assignee || '' }) })
            if (r.ok) { const d = await r.json(); connecteamShiftId = d.shift?.id || null }
          } catch (e) { console.error('Connecteam failed:', e) }
        }

        // Look up service_type_id
        let serviceTypeId = null
        try {
          const stMap = { 'standard': 'Standard Clean', 'deep': 'Deep Clean', 'move-out': 'Move-Out', 'move-in-out': 'Move-Out', 'turnover': 'Turnover', 'janitorial': 'Janitorial', 'one-time': 'One-Time' }
          const stName = stMap[(booking.service_type || 'standard').toLowerCase()] || 'Standard Clean'
          const stRes = await fetch(`${supabaseUrl}/rest/v1/service_types?name=eq.${encodeURIComponent(stName)}&select=id`, { headers: sbHeaders })
          const stData = await stRes.json()
          serviceTypeId = stData?.[0]?.id || null
        } catch {}

        let jobId = null
        try {
          const jobDate = booking.requested_date.split('T')[0]
          const r = await fetch(`${supabaseUrl}/rest/v1/jobs`, { method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=representation' }, body: JSON.stringify({ client_id: booking.client_id, client_name: booking.name, title: `${booking.service_type === 'deep' ? 'Deep Clean' : 'Cleaning'} - ${booking.name}`, date: jobDate, start_time: start, end_time: end, status: 'scheduled', assignee: assignee || null, notes: adminNotes || 'Self-booked via website', price: booking.estimate_min || null, service_type: booking.service_type, service_type_id: serviceTypeId, source: 'booking_request', is_active: true, address: booking.address, google_event_id: googleEventId }) })
          if (r.ok) { const d = await r.json(); jobId = d[0]?.id }
        } catch (e) { console.error('Job failed:', e) }

        // Create visit (visits are the canonical schedule)
        let visitId = null
        if (jobId) {
          try {
            const jobDate = booking.requested_date.split('T')[0]
            const vRes = await fetch(`${supabaseUrl}/rest/v1/visits`, { method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }, body: JSON.stringify({ job_id: jobId, client_id: booking.client_id, property_id: booking.property_id || null, scheduled_date: jobDate, scheduled_start_time: start, scheduled_end_time: end, status: 'scheduled', source: 'booking', service_type_id: serviceTypeId, address: booking.address, google_event_id: googleEventId, connecteam_shift_id: connecteamShiftId, client_visible: true }) })
            if (vRes.ok) { const vData = await vRes.json(); visitId = vData[0]?.id }
          } catch (e) { console.error('Visit creation failed:', e) }

          // Log calendar syncs
          if (visitId && googleEventId) {
            await fetch(`${supabaseUrl}/rest/v1/calendar_sync_log`, { method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ visit_id: visitId, provider: 'google_calendar', external_id: googleEventId, direction: 'outbound', sync_status: 'synced' }) }).catch(() => {})
          }
          if (visitId && connecteamShiftId) {
            await fetch(`${supabaseUrl}/rest/v1/calendar_sync_log`, { method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ visit_id: visitId, provider: 'connecteam', external_id: connecteamShiftId, direction: 'outbound', sync_status: 'synced' }) }).catch(() => {})
          }
        }

        await fetch(`${supabaseUrl}/rest/v1/booking_requests?id=eq.${bookingId}`, { method: 'PATCH', headers: sbHeaders, body: JSON.stringify({ status: 'approved', admin_notes: adminNotes || null, google_event_id: googleEventId, connecteam_shift_id: connecteamShiftId, job_id: jobId, approved_at: new Date().toISOString() }) })

        try { await sendBookingConfirmationEmail(booking, { start, end, adminNotes }) } catch (e) { console.error('Confirm email failed:', e) }

        return res.status(200).json({ success: true, bookingId, jobId, visitId, googleEventId, connecteamShiftId })
      } catch (err) {
        console.error('Booking approval error:', err)
        return res.status(500).json({ error: 'Failed to approve booking' })
      }
    }

    // ── REJECT BOOKING ──
    if (action === 'booking-reject' && req.method === 'POST') {
      const { bookingId, adminNotes } = req.body
      if (!bookingId) return res.status(400).json({ error: 'bookingId required' })
      try {
        const bRes = await fetch(`${supabaseUrl}/rest/v1/booking_requests?id=eq.${bookingId}&limit=1`, { headers: sbHeaders })
        const bList = bRes.ok ? await bRes.json() : []
        const booking = bList[0]
        await fetch(`${supabaseUrl}/rest/v1/booking_requests?id=eq.${bookingId}`, { method: 'PATCH', headers: sbHeaders, body: JSON.stringify({ status: 'rejected', admin_notes: adminNotes || null, rejected_at: new Date().toISOString() }) })
        if (booking?.email) { try { await sendBookingRejectionEmail(booking, adminNotes) } catch (e) { console.error('Reject email failed:', e) } }
        return res.status(200).json({ success: true, bookingId })
      } catch (err) { return res.status(500).json({ error: 'Failed to reject booking' }) }
    }

    // ── STATS ──
    if (action === 'booking-stats' && req.method === 'GET') {
      try {
        const r = await fetch(`${supabaseUrl}/rest/v1/booking_requests?select=status`, { headers: sbHeaders })
        const all = r.ok ? await r.json() : []
        const stats = { total: all.length, pending: 0, approved: 0, rejected: 0 }
        for (const b of all) { if (b.status === 'pending') stats.pending++; else if (b.status === 'approved') stats.approved++; else if (b.status === 'rejected') stats.rejected++ }
        return res.status(200).json({ success: true, stats })
      } catch (e) { return res.status(200).json({ success: true, stats: { total: 0, pending: 0, approved: 0, rejected: 0 } }) }
    }

    return res.status(400).json({ error: 'Unknown booking action. Use: booking-create, booking-list, booking-approve, booking-reject, booking-stats' })
  }

  return res.status(400).json({ error: 'Unknown action. POST to /api/leads to create a lead.' })
}

function detectSource(req, { utm_source, fb_lead_id }) {
  if (fb_lead_id) return 'Facebook Lead Ad'
  if (utm_source) return utm_source
  const referer = req.headers?.referer || ''
  if (referer.includes('maine-clean')) return 'Website'
  if (referer.includes('facebook')) return 'Facebook'
  if (referer.includes('google')) return 'Google'
  return 'Direct'
}

function detectChannel(req, { fb_lead_id, source }) {
  if (fb_lead_id) return 'facebook'
  if (source === 'sms' || source === 'text') return 'sms'
  if (source === 'email') return 'email'
  return 'website'
}

function mapPropertyType(type) {
  if (!type) return 'residential'
  const t = type.toLowerCase()
  if (t.includes('commercial') || t.includes('office')) return 'commercial'
  if (t.includes('rental') || t.includes('airbnb') || t.includes('vrbo')) return 'rental'
  if (t.includes('marina')) return 'marina'
  return 'residential'
}

function buildLeadNotes(lead) {
  const lines = []
  if (lead.estimateMin && lead.estimateMax) lines.push('Estimate: $' + lead.estimateMin + '-$' + lead.estimateMax)
  if (lead.message) lines.push('Notes: ' + lead.message)
  if (lead.squareFeet) lines.push('Sq ft: ' + lead.squareFeet)
  if (lead.bathrooms) lines.push('Bathrooms: ' + lead.bathrooms)
  if (lead.petHair && lead.petHair !== 'none') lines.push('Pet hair: ' + lead.petHair)
  if (lead.condition && lead.condition !== 'maintenance') lines.push('Condition: ' + lead.condition)
  if (lead.preferredDate) lines.push('Preferred date: ' + lead.preferredDate)
  if (lead.receivedVia) lines.push('Source: ' + lead.receivedVia)
  return lines.join('\n')
}

// ── Booking email helpers ──

async function getBookingGmailToken() {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) })
  const d = await r.json()
  return d.access_token || null
}

async function sendBookingGmail(token, to, subject, body, isHtml) {
  const raw = Buffer.from(
    'To: ' + to + '\r\n' + 'From: The Maine Cleaning Co. <office@mainecleaningco.com>\r\n' + 'Reply-To: office@mainecleaningco.com\r\n' +
    'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=\r\n' + 'MIME-Version: 1.0\r\n' +
    'Content-Type: ' + (isHtml ? 'text/html' : 'text/plain') + '; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    Buffer.from(body).toString('base64')
  ).toString('base64url')
  await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) })
}

async function sendBookingNotificationEmail(booking) {
  const token = await getBookingGmailToken()
  if (!token) return
  const estimate = booking.estimateMin ? `$${booking.estimateMin}-$${booking.estimateMax}` : 'Custom'
  const subject = `New Booking Request: ${booking.name} - ${booking.requestedDate} (${estimate})`
  const body = ['NEW SELF-BOOKING REQUEST', '----------------------------------------', '', 'Name: ' + (booking.name || 'N/A'), 'Phone: ' + (booking.phone || 'N/A'), 'Email: ' + (booking.email || 'N/A'), 'Address: ' + (booking.address || 'N/A'), '', 'Requested Date: ' + booking.requestedDate, 'Service: ' + (booking.serviceType || 'N/A'), 'Frequency: ' + (booking.frequency || 'N/A'), 'Estimate: ' + estimate, booking.distanceMiles ? 'Distance: ' + booking.distanceMiles + ' miles' : '', '', '----------------------------------------', 'APPROVE/REJECT in Workflow HQ:', 'https://connecteam-proxy.vercel.app/#/bookings'].filter(Boolean).join('\r\n')
  await sendBookingGmail(token, 'office@mainecleaningco.com', subject, body, false)
}

async function sendBookingConfirmationEmail(booking, { start, end, adminNotes }) {
  if (!booking.email) return
  const token = await getBookingGmailToken()
  if (!token) return
  const firstName = booking.name ? booking.name.split(' ')[0] : 'there'
  const dateStr = new Date(booking.requested_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const estimate = booking.estimate_min ? `$${booking.estimate_min}-$${booking.estimate_max}` : ''
  const subject = `Your cleaning is confirmed for ${dateStr}!`
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f4f4f2;"><div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e3;"><div style="background:#3a4f5c;padding:32px;text-align:center;"><h1 style="color:#fff;font-size:22px;margin:0 0 6px;font-weight:700;">Booking Confirmed!</h1><p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0;">The Maine Cleaning Co.</p></div><div style="padding:32px;"><p style="font-size:16px;color:#1f2937;line-height:1.6;margin:0 0 24px;">Hi ' + firstName + ', great news! Your cleaning has been confirmed.</p><div style="background:linear-gradient(135deg,#eff6ff,#ecfdf5);border:1px solid #93c5fd;border-radius:12px;padding:20px 24px;margin-bottom:28px;text-align:center;"><div style="font-size:11px;color:#1d4ed8;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Your Cleaning Date</div><div style="font-size:28px;font-weight:800;color:#1e40af;">' + dateStr + '</div><div style="font-size:14px;color:#6b7280;margin-top:6px;">' + start + ' - ' + end + (estimate ? ' &middot; ' + estimate : '') + '</div></div><table style="width:100%;border-collapse:collapse;margin-bottom:28px;"><tr><td style="padding:6px 0;color:#6b7280;width:100px;font-size:14px;">Address</td><td style="padding:6px 0;font-weight:600;color:#1f2937;font-size:14px;">' + (booking.address || '') + '</td></tr><tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;font-weight:600;color:#1f2937;font-size:14px;">' + (booking.service_type || 'Cleaning') + '</td></tr>' + (adminNotes ? '<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Notes</td><td style="padding:6px 0;font-weight:600;color:#1f2937;font-size:14px;">' + adminNotes + '</td></tr>' : '') + '</table><div style="text-align:center;padding:16px 0;"><p style="font-size:14px;color:#374151;margin:0 0 8px;">Need to reschedule? Contact us:</p><p style="font-size:14px;margin:0;"><a href="tel:207-572-0502" style="color:#3a4f5c;font-weight:600;text-decoration:none;">(207) 572-0502</a><span style="color:#d1d5db;margin:0 10px;">|</span><a href="mailto:office@mainecleaningco.com" style="color:#3a4f5c;font-weight:600;text-decoration:none;">office@mainecleaningco.com</a></p></div></div><div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e5e3;text-align:center;"><p style="font-size:12px;color:#9ca3af;margin:0;">The Maine Cleaning Co. &middot; Southern Maine &middot; Est. 2018</p></div></div></body></html>'
  await sendBookingGmail(token, booking.email, subject, html, true)
}

async function sendBookingRejectionEmail(booking, adminNotes) {
  if (!booking.email) return
  const token = await getBookingGmailToken()
  if (!token) return
  const firstName = booking.name ? booking.name.split(' ')[0] : 'there'
  const dateStr = new Date(booking.requested_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const subject = 'About your cleaning request for ' + dateStr
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f4f4f2;"><div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e3;"><div style="background:#3a4f5c;padding:32px;text-align:center;"><h1 style="color:#fff;font-size:22px;margin:0 0 6px;font-weight:700;">Let\'s Find a Better Date</h1><p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0;">The Maine Cleaning Co.</p></div><div style="padding:32px;"><p style="font-size:16px;color:#1f2937;line-height:1.6;margin:0 0 24px;">Hi ' + firstName + ', unfortunately we\'re unable to accommodate the date you requested (' + dateStr + ').' + (adminNotes ? ' ' + adminNotes : '') + '</p><p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 24px;">We\'d love to help find a date that works! Please give us a call or text and we\'ll get you scheduled.</p><div style="text-align:center;padding:16px 0;"><a href="tel:207-572-0502" style="display:inline-block;background:#3a4f5c;color:#fff;padding:12px 32px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;">Call (207) 572-0502</a></div></div><div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e5e3;text-align:center;"><p style="font-size:12px;color:#9ca3af;margin:0;">The Maine Cleaning Co. &middot; Southern Maine &middot; Est. 2018</p></div></div></body></html>'
  await sendBookingGmail(token, booking.email, subject, html, true)
}
