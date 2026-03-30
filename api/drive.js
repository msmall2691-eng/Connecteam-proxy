// Vercel serverless: Google Drive integration
// Uses same Gmail/Google OAuth credentials
// Stores files in a "Workflow HQ" folder, organized by client

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({ error: 'Google not configured. Uses same OAuth as Gmail.' })
  }

  try {
    // Get access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return res.status(401).json({ error: 'Token refresh failed' })

    const accessToken = tokenData.access_token
    const driveBase = 'https://www.googleapis.com/drive/v3'
    const headers = { Authorization: `Bearer ${accessToken}` }

    const action = req.query.action || req.body?.action

    // ── GET OR CREATE APP FOLDER ──
    async function getAppFolder() {
      // Find "Workflow HQ" folder
      const searchRes = await fetch(`${driveBase}/files?q=${encodeURIComponent("name='Workflow HQ' and mimeType='application/vnd.google-apps.folder' and trashed=false")}&fields=files(id,name)`, { headers })
      const searchData = await searchRes.json()
      if (searchData.files?.length > 0) return searchData.files[0].id

      // Create it
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
    if (action === 'list') {
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
    if (action === 'upload' && req.method === 'POST') {
      const { clientName, fileName, content, mimeType } = req.body
      if (!fileName || !content) return res.status(400).json({ error: 'fileName and content required' })

      const appFolder = await getAppFolder()
      const folderId = clientName ? await getClientFolder(appFolder, clientName) : appFolder

      // Create file metadata
      const metaRes = await fetch(`${driveBase}/files`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fileName, parents: [folderId] }),
      })
      const fileMeta = await metaRes.json()

      // Upload content
      const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileMeta.id}?uploadType=media`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': mimeType || 'text/plain' },
        body: content,
      })
      const uploadData = await uploadRes.json()

      // Get shareable link
      const linkRes = await fetch(`${driveBase}/files/${fileMeta.id}?fields=webViewLink`, { headers })
      const linkData = await linkRes.json()

      return res.status(200).json({
        id: fileMeta.id, name: fileName, url: linkData.webViewLink,
      })
    }

    // ── SAVE REPORT TO DRIVE ──
    if (action === 'save-report' && req.method === 'POST') {
      const { title, content, clientName } = req.body
      if (!title || !content) return res.status(400).json({ error: 'title and content required' })

      const appFolder = await getAppFolder()
      const folderId = clientName ? await getClientFolder(appFolder, clientName) : appFolder

      // Create as Google Doc
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

      // Write content to doc using Docs API
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
    if (action === 'delete' && req.method === 'POST') {
      const { fileId } = req.body
      if (!fileId) return res.status(400).json({ error: 'fileId required' })
      await fetch(`${driveBase}/files/${fileId}`, { method: 'DELETE', headers })
      return res.status(200).json({ deleted: true })
    }

    return res.status(400).json({ error: 'Unknown action. Use: list, upload, save-report, delete' })
  } catch (err) {
    console.error('Drive error:', err)
    return res.status(500).json({ error: err.message })
  }
}
