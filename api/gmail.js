// Vercel serverless: Gmail integration
// Requires GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in env
// OAuth2 token refresh is handled automatically

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'Gmail not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in Vercel env.' })
  }

  try {
    // Get fresh access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return res.status(401).json({ error: 'Failed to refresh Gmail token', detail: tokenData })
    }
    const accessToken = tokenData.access_token

    const action = req.query.action || req.body?.action

    // ── LIST MESSAGES ──
    if (action === 'list') {
      const query = req.query.q || ''
      const maxResults = req.query.maxResults || 20
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${query ? `&q=${encodeURIComponent(query)}` : ''}`

      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const listData = await listRes.json()
      const messageIds = (listData.messages || []).map(m => m.id)

      // Fetch each message's headers
      const messages = await Promise.all(messageIds.slice(0, 20).map(async (id) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        const msg = await msgRes.json()
        const headers = {}
        for (const h of msg.payload?.headers || []) {
          headers[h.name.toLowerCase()] = h.value
        }
        return {
          id: msg.id,
          threadId: msg.threadId,
          snippet: msg.snippet,
          from: headers.from || '',
          to: headers.to || '',
          subject: headers.subject || '',
          date: headers.date || '',
          labelIds: msg.labelIds || [],
        }
      }))

      return res.status(200).json({ messages })
    }

    // ── GET THREAD ──
    if (action === 'thread') {
      const threadId = req.query.threadId
      if (!threadId) return res.status(400).json({ error: 'threadId required' })

      const threadRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const thread = await threadRes.json()

      const messages = (thread.messages || []).map(msg => {
        const headers = {}
        for (const h of msg.payload?.headers || []) {
          headers[h.name.toLowerCase()] = h.value
        }
        // Extract body
        let body = ''
        function extractText(part) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            body += Buffer.from(part.body.data, 'base64url').toString('utf-8')
          }
          if (part.parts) part.parts.forEach(extractText)
        }
        extractText(msg.payload)

        return {
          id: msg.id,
          from: headers.from || '',
          to: headers.to || '',
          subject: headers.subject || '',
          date: headers.date || '',
          body,
          snippet: msg.snippet,
        }
      })

      return res.status(200).json({ threadId, messages })
    }

    // ── SEND EMAIL ──
    if (action === 'send' && req.method === 'POST') {
      const { to, subject, body, threadId } = req.body
      if (!to || !body) return res.status(400).json({ error: 'to and body required' })

      // Build raw email
      const email = [
        `To: ${to}`,
        `Subject: ${subject || ''}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        body,
      ].join('\r\n')

      const encodedEmail = Buffer.from(email).toString('base64url')
      const sendBody = { raw: encodedEmail }
      if (threadId) sendBody.threadId = threadId

      const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
      })
      const sendData = await sendRes.json()

      return res.status(200).json({ messageId: sendData.id, threadId: sendData.threadId })
    }

    // ── GET PROFILE ──
    if (action === 'profile') {
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return res.status(200).json(await profileRes.json())
    }

    return res.status(400).json({ error: 'Unknown action. Use: list, thread, send, profile' })
  } catch (err) {
    console.error('Gmail handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
