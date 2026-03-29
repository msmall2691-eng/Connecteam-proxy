// Vercel serverless: Twilio SMS integration
// Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in env

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return res.status(500).json({ error: 'Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in Vercel env.' })
  }

  const action = req.query.action || req.body?.action
  const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}`
  const authHeader = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')

  try {
    // ── SEND SMS ──
    if (action === 'send' && req.method === 'POST') {
      const { to, body } = req.body
      if (!to || !body) return res.status(400).json({ error: 'to and body required' })

      const sendRes = await fetch(`${twilioBase}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: TWILIO_PHONE_NUMBER,
          To: to,
          Body: body,
        }),
      })
      const sendData = await sendRes.json()

      if (sendData.error_code) {
        return res.status(400).json({ error: sendData.message, code: sendData.error_code })
      }

      return res.status(200).json({
        sid: sendData.sid,
        to: sendData.to,
        from: sendData.from,
        body: sendData.body,
        status: sendData.status,
      })
    }

    // ── LIST RECENT MESSAGES ──
    if (action === 'list') {
      const limit = req.query.limit || 50
      const to = req.query.to || ''

      let url = `${twilioBase}/Messages.json?PageSize=${limit}`
      if (to) url += `&To=${encodeURIComponent(to)}`

      const listRes = await fetch(url, {
        headers: { Authorization: authHeader },
      })
      const listData = await listRes.json()

      const messages = (listData.messages || []).map(m => ({
        sid: m.sid,
        from: m.from,
        to: m.to,
        body: m.body,
        status: m.status,
        direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
        dateSent: m.date_sent,
      }))

      return res.status(200).json({ messages })
    }

    // ── INCOMING WEBHOOK (Twilio posts here when SMS received) ──
    if (action === 'webhook' && req.method === 'POST') {
      // Twilio sends form data
      const from = req.body.From
      const body = req.body.Body
      const sid = req.body.MessageSid

      // TODO: Store incoming message in Supabase or relay to frontend
      console.log(`Incoming SMS from ${from}: ${body} (SID: ${sid})`)

      // Respond with empty TwiML to acknowledge
      res.setHeader('Content-Type', 'text/xml')
      return res.status(200).send('<Response></Response>')
    }

    return res.status(400).json({ error: 'Unknown action. Use: send, list, webhook' })
  } catch (err) {
    console.error('SMS handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
