// Vercel serverless: Google Contacts (People API)
// Uses same Gmail OAuth credentials

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({ error: 'Google not configured' })
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return res.status(401).json({ error: 'Token refresh failed' })

    const accessToken = tokenData.access_token
    const action = req.query.action || 'list'

    // ── LIST CONTACTS ──
    if (action === 'list') {
      const pageSize = req.query.pageSize || 100
      const query = req.query.q || ''

      let url = `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,addresses,organizations&pageSize=${pageSize}&sortOrder=LAST_MODIFIED_DESCENDING`
      if (query) {
        // Use search instead
        url = `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(query)}&readMask=names,emailAddresses,phoneNumbers,addresses,organizations&pageSize=${pageSize}`
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

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
