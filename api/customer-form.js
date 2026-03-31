// Vercel serverless: Customer Info Form API
// Handles saving/loading customer property info for turnover guides
// POST /api/customer-form — save form data
// GET /api/customer-form?id=xxx — load form data
// GET /api/customer-form?action=list — list all forms
// GET /api/customer-form?action=list&clientId=xxx — list forms for a client

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Database not configured' })
  }

  const sbHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
  const sbBase = `${supabaseUrl}/rest/v1`

  try {
    // ── LIST ALL FORMS ──
    if (req.method === 'GET' && req.query.action === 'list') {
      const clientId = req.query.clientId
      let url = `${sbBase}/customer_info?select=id,property_name,address_line1,address_city,client_name,status,bedrooms,bathrooms,property_type,created_at,updated_at&order=updated_at.desc`
      if (clientId) url += `&client_id=eq.${clientId}`

      const r = await fetch(url, { headers: sbHeaders })
      const data = await r.json()
      return res.status(200).json({ forms: data || [] })
    }

    // ── GET SINGLE FORM ──
    if (req.method === 'GET' && req.query.id) {
      const r = await fetch(`${sbBase}/customer_info?id=eq.${req.query.id}`, { headers: sbHeaders })
      const data = await r.json()
      if (!data?.length) return res.status(404).json({ error: 'Form not found' })
      return res.status(200).json({ form: data[0] })
    }

    // ── SAVE / UPDATE FORM ──
    if (req.method === 'POST') {
      const body = req.body
      if (!body || !body.property_name) {
        return res.status(400).json({ error: 'property_name is required' })
      }

      // Clean up the data — only allow known columns
      const allowed = [
        'client_id', 'property_id', 'property_name', 'address_line1', 'address_city',
        'address_state', 'address_zip', 'property_type', 'bedrooms', 'bathrooms', 'sqft',
        'max_guests', 'views', 'door_code', 'wifi_name', 'wifi_password', 'trash_pickup',
        'parking', 'bed_configuration', 'wash_linens_onsite', 'supplies_stored', 'linen_closet',
        'linen_standard', 'scope_of_work', 'supplies_list', 'special_notes', 'client_name',
        'client_email', 'client_phone', 'client_alt_phone', 'client_address', 'preferred_contact',
        'policies', 'active_season', 'status',
      ]
      const row = {}
      for (const key of allowed) {
        if (body[key] !== undefined) row[key] = body[key]
      }
      row.updated_at = new Date().toISOString()

      // Update existing
      if (body.id) {
        const r = await fetch(`${sbBase}/customer_info?id=eq.${body.id}`, {
          method: 'PATCH',
          headers: sbHeaders,
          body: JSON.stringify(row),
        })
        const data = await r.json()
        if (!data?.length) return res.status(404).json({ error: 'Form not found' })

        // Save to Google Drive as HTML if status is active
        if (row.status === 'active') {
          await saveToDrive(data[0])
        }

        return res.status(200).json({ form: data[0] })
      }

      // Create new
      const r = await fetch(`${sbBase}/customer_info`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify(row),
      })
      const data = await r.json()

      return res.status(201).json({ form: Array.isArray(data) ? data[0] : data })
    }

    // ── DELETE ──
    if (req.method === 'GET' && req.query.action === 'delete' && req.query.id) {
      await fetch(`${sbBase}/customer_info?id=eq.${req.query.id}`, {
        method: 'DELETE',
        headers: sbHeaders,
      })
      return res.status(200).json({ deleted: true })
    }

    return res.status(400).json({ error: 'Unknown request. Use GET with ?id= or ?action=list, or POST to save.' })
  } catch (err) {
    console.error('Customer form error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// Save property guide HTML to Google Drive under client folder
async function saveToDrive(form) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN

    if (!clientId || !clientSecret || !refreshToken) return

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return

    const headers = { Authorization: `Bearer ${tokenData.access_token}` }
    const driveBase = 'https://www.googleapis.com/drive/v3'

    // Find or create "Workflow HQ" folder
    const searchRes = await fetch(`${driveBase}/files?q=${encodeURIComponent("name='Workflow HQ' and mimeType='application/vnd.google-apps.folder' and trashed=false")}&fields=files(id)`, { headers })
    const searchData = await searchRes.json()
    let appFolderId = searchData.files?.[0]?.id

    if (!appFolderId) {
      const createRes = await fetch(`${driveBase}/files`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Workflow HQ', mimeType: 'application/vnd.google-apps.folder' }),
      })
      appFolderId = (await createRes.json()).id
    }

    // Find or create "Property Guides" subfolder
    const guidesSearch = await fetch(`${driveBase}/files?q=${encodeURIComponent(`name='Property Guides' and '${appFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)`, { headers })
    const guidesData = await guidesSearch.json()
    let guidesFolderId = guidesData.files?.[0]?.id

    if (!guidesFolderId) {
      const createRes = await fetch(`${driveBase}/files`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Property Guides', mimeType: 'application/vnd.google-apps.folder', parents: [appFolderId] }),
      })
      guidesFolderId = (await createRes.json()).id
    }

    // Upload as HTML file
    const fileName = `${form.property_name} - Property Guide.html`

    // Check if file already exists (update it)
    const existingSearch = await fetch(`${driveBase}/files?q=${encodeURIComponent(`name='${fileName}' and '${guidesFolderId}' in parents and trashed=false`)}&fields=files(id)`, { headers })
    const existingData = await existingSearch.json()

    const guideUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://connecteam-proxy.vercel.app'}/property-guide.html?id=${form.id}`

    const content = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${guideUrl}"><title>${form.property_name} - Property Guide</title></head><body><p>Redirecting to <a href="${guideUrl}">property guide</a>...</p></body></html>`

    if (existingData.files?.length > 0) {
      // Update existing file
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingData.files[0].id}?uploadType=media`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'text/html' },
        body: content,
      })
    } else {
      // Create new file
      const metaRes = await fetch(`${driveBase}/files`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fileName, parents: [guidesFolderId] }),
      })
      const fileMeta = await metaRes.json()
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileMeta.id}?uploadType=media`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'text/html' },
        body: content,
      })
    }
  } catch (err) {
    console.error('Drive save error:', err)
  }
}
