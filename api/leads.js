// Vercel serverless: Lead intake webhook
// Accepts leads from: website form, Facebook Lead Ads, email parsing, SMS, manual
// POST /api/leads — creates a new lead in the system
// GET /api/leads — lists recent leads (for dashboard polling)

// In-memory store for leads (use Supabase in production)
// Leads are stored via the frontend store, but this endpoint
// accepts external webhooks and forwards to the store

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = req.query.action || 'create'

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

          // Send email notification to you about the new lead
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
                const quoteRange = lead.estimateMin ? `$${lead.estimateMin} – $${lead.estimateMax}` : 'No quote'
                const emailBody = [
                  `🔔 New Lead from ${lead.source || 'Website'}!`,
                  '',
                  `Name: ${lead.name}`,
                  `Email: ${lead.email || 'N/A'}`,
                  `Phone: ${lead.phone || 'N/A'}`,
                  `Address: ${lead.address || 'N/A'}`,
                  `Service: ${lead.service || 'N/A'}`,
                  `Frequency: ${lead.frequency || 'N/A'}`,
                  `Quote: ${quoteRange}`,
                  lead.message ? `Message: ${lead.message}` : '',
                  '',
                  `View in Workflow HQ: https://connecteam-proxy.vercel.app/#/pipeline`,
                ].filter(Boolean).join('\n')

                const raw = Buffer.from(
                  `To: info@maine-clean.co\r\nSubject: 🔔 New Lead: ${lead.name} — ${quoteRange}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${emailBody}`
                ).toString('base64url')

                await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ raw }),
                })
              }
            }
          } catch (e) { console.error('Lead notification email failed:', e) }

          return res.status(200).json({ success: true, leadId: clientId, propertyId, lead })
        }
      } catch (err) {
        console.error('Supabase write failed:', err)
      }
    }

    // Fallback: return lead for frontend to handle
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
  if (lead.estimateMin && lead.estimateMax) lines.push(`💰 INSTANT QUOTE: $${lead.estimateMin} – $${lead.estimateMax}`)
  if (lead.message) lines.push(`Message: ${lead.message}`)
  if (lead.service) lines.push(`Service: ${lead.service}`)
  if (lead.frequency) lines.push(`Frequency: ${lead.frequency}`)
  if (lead.squareFeet) lines.push(`Sq ft: ${lead.squareFeet}`)
  if (lead.bedrooms) lines.push(`Bedrooms: ${lead.bedrooms}`)
  if (lead.bathrooms) lines.push(`Bathrooms: ${lead.bathrooms}`)
  if (lead.petHair) lines.push(`Pet hair: ${lead.petHair}`)
  if (lead.condition) lines.push(`Condition: ${lead.condition}`)
  if (lead.preferredDate) lines.push(`Preferred date: ${lead.preferredDate}`)
  if (lead.preferredTime) lines.push(`Preferred time: ${lead.preferredTime}`)
  if (lead.budget) lines.push(`Budget: ${lead.budget}`)
  if (lead.receivedVia) lines.push(`Received via: ${lead.receivedVia}`)
  if (lead.utm_campaign) lines.push(`Campaign: ${lead.utm_campaign}`)
  return lines.join('\n')
}
