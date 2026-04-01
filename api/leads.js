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
                  service_type: lead.service || 'standard',
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

                // 2. CONFIRMATION EMAIL TO CUSTOMER
                if (lead.email) {
                  const firstName = lead.name ? lead.name.split(' ')[0] : ''
                  const custSubject = (firstName ? firstName + ', w' : 'W') + 'e received your cleaning request - ' + quoteRange
                  const custBody = [
                    'Hi ' + (firstName || 'there') + ',',
                    '',
                    'Thank you for your cleaning request! We received your information and will be in touch shortly.',
                    '',
                    'Here is a summary of your request:',
                    '----------------------------------------',
                    'Service: ' + (lead.service || 'Cleaning'),
                    'Frequency: ' + (lead.frequency || 'One-time'),
                    'Estimate: ' + quoteRange,
                    lead.address ? 'Address: ' + lead.address : '',
                    '',
                    'WHAT HAPPENS NEXT:',
                    '1. We will review your request (within 1 business day)',
                    '2. We will reach out to confirm details via phone, text, or email',
                    '3. You will receive a final quote and we can get you scheduled',
                    '',
                    'Have questions? Reply to this email or call us at (207) 572-0502.',
                    '',
                    'Best,',
                    'The Maine Cleaning Co.',
                    'office@mainecleaningco.com | (207) 572-0502',
                    'www.maineclean.co',
                  ].filter(Boolean).join('\r\n')

                  const custRaw = Buffer.from(
                    'To: ' + lead.email + '\r\n' +
                    'From: The Maine Cleaning Co. <office@mainecleaningco.com>\r\n' +
                    'Reply-To: office@mainecleaningco.com\r\n' +
                    'Subject: =?UTF-8?B?' + Buffer.from(custSubject).toString('base64') + '?=\r\n' +
                    'Content-Type: text/plain; charset=UTF-8\r\n' +
                    'Content-Transfer-Encoding: base64\r\n' +
                    '\r\n' +
                    Buffer.from(custBody).toString('base64')
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
