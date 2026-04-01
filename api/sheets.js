// Vercel serverless: Google Sheets integration
// Search Drive for spreadsheets, read sheet data for client import
// Uses same OAuth credentials as Gmail/Drive/Calendar

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({ error: 'Google not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN to Vercel env vars.' })
  }

  try {
    // Get access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return res.status(401).json({ error: 'Token refresh failed' })

    const accessToken = tokenData.access_token
    const headers = { Authorization: `Bearer ${accessToken}` }
    const driveBase = 'https://www.googleapis.com/drive/v3'
    const sheetsBase = 'https://sheets.googleapis.com/v4/spreadsheets'

    const action = req.query.action

    // ── SEARCH: Find Google Sheets on Drive ──
    if (action === 'search') {
      const q = req.query.q || ''
      let query = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
      if (q) query += ` and name contains '${q.replace(/'/g, "\\'")}'`

      const searchRes = await fetch(
        `${driveBase}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=20`,
        { headers }
      )
      const data = await searchRes.json()

      return res.status(200).json({
        files: (data.files || []).map(f => ({
          id: f.id, name: f.name, modifiedTime: f.modifiedTime, url: f.webViewLink,
        })),
      })
    }

    // ── LIST-SHEETS: List tabs within a spreadsheet ──
    if (action === 'list-sheets') {
      const spreadsheetId = req.query.spreadsheetId
      if (!spreadsheetId) return res.status(400).json({ error: 'spreadsheetId required' })

      const sheetRes = await fetch(
        `${sheetsBase}/${spreadsheetId}?fields=sheets.properties(sheetId,title,index)`,
        { headers }
      )
      if (!sheetRes.ok) {
        const err = await sheetRes.json().catch(() => ({}))
        return res.status(sheetRes.status).json({ error: err.error?.message || 'Failed to read spreadsheet' })
      }
      const data = await sheetRes.json()

      return res.status(200).json({
        sheets: (data.sheets || []).map(s => ({
          sheetId: s.properties.sheetId,
          title: s.properties.title,
          index: s.properties.index,
        })),
      })
    }

    // ── READ: Read all data from a sheet tab ──
    if (action === 'read') {
      const spreadsheetId = req.query.spreadsheetId
      if (!spreadsheetId) return res.status(400).json({ error: 'spreadsheetId required' })

      let sheetName = req.query.sheet
      // If no tab specified, get the first one
      if (!sheetName) {
        const metaRes = await fetch(
          `${sheetsBase}/${spreadsheetId}?fields=sheets.properties(title,index)`,
          { headers }
        )
        const meta = await metaRes.json()
        const firstSheet = (meta.sheets || []).sort((a, b) => a.properties.index - b.properties.index)[0]
        sheetName = firstSheet?.properties?.title || 'Sheet1'
      }

      const range = encodeURIComponent(`${sheetName}!A:Z`)
      const valuesRes = await fetch(
        `${sheetsBase}/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
        { headers }
      )
      if (!valuesRes.ok) {
        const err = await valuesRes.json().catch(() => ({}))
        return res.status(valuesRes.status).json({ error: err.error?.message || 'Failed to read sheet data' })
      }
      const valuesData = await valuesRes.json()
      const values = valuesData.values || []

      if (values.length === 0) {
        return res.status(200).json({ headers: [], rows: [], totalRows: 0 })
      }

      const sheetHeaders = values[0]
      // Filter out completely empty rows
      const rows = values.slice(1).filter(row => row.some(cell => cell && cell.toString().trim()))

      return res.status(200).json({
        headers: sheetHeaders,
        rows,
        totalRows: rows.length,
      })
    }

    return res.status(400).json({ error: 'Unknown action. Use: search, list-sheets, read' })
  } catch (err) {
    console.error('Sheets error:', err)
    return res.status(500).json({ error: err.message })
  }
}
