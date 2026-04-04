// Vercel serverless: Twilio SMS integration
// Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in env

import crypto from 'crypto'
import { requireAuth, setAdminCors } from './_auth.js'

export default async function handler(req, res) {
  const action = req.query.action || req.body?.action

  // Webhook is public (Twilio posts here)
  if (action === 'webhook') {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else {
    setAdminCors(req, res)
    // Require auth for send/list actions
    const user = await requireAuth(req, res)
    if (!user) return
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')

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
      // Verify Twilio request signature
      const twilioSig = req.headers['x-twilio-signature']
      if (twilioSig) {
        const webhookUrl = `https://${req.headers.host}${req.url}`
        const params = req.body || {}
        // Sort params alphabetically and concatenate key+value
        const paramStr = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], '')
        const expectedSig = crypto
          .createHmac('sha1', TWILIO_AUTH_TOKEN)
          .update(webhookUrl + paramStr)
          .digest('base64')
        if (!crypto.timingSafeEqual(Buffer.from(twilioSig), Buffer.from(expectedSig))) {
          return res.status(401).json({ error: 'Invalid Twilio signature' })
        }
      } else {
        console.warn('No X-Twilio-Signature header — webhook signature verification skipped')
      }

      // Twilio sends form data
      const from = req.body.From
      const body = req.body.Body
      const sid = req.body.MessageSid

      // Store incoming message in Supabase
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
      if (supabaseUrl && supabaseKey && from && body) {
        const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' }
        try {
          // Find client by phone number
          const clientRes = await fetch(
            `${supabaseUrl}/rest/v1/clients?phone=like.*${encodeURIComponent(from.replace(/^\+1/, ''))}*&limit=1`,
            { headers: sbHeaders }
          )
          const clients = await clientRes.json()
          if (clients?.length) {
            const client = clients[0]
            // Find or create SMS conversation
            const convRes = await fetch(
              `${supabaseUrl}/rest/v1/conversations?client_id=eq.${client.id}&channel=eq.text&limit=1&order=updated_at.desc`,
              { headers: sbHeaders }
            )
            const convos = await convRes.json()
            let convoId = convos?.[0]?.id
            if (!convoId) {
              const newConvo = await fetch(`${supabaseUrl}/rest/v1/conversations`, {
                method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
                body: JSON.stringify({ client_id: client.id, subject: 'SMS Conversation', channel: 'text', last_message: body.slice(0, 100) }),
              })
              const created = await newConvo.json()
              convoId = created?.[0]?.id
            }
            if (convoId) {
              await fetch(`${supabaseUrl}/rest/v1/messages`, {
                method: 'POST', headers: sbHeaders,
                body: JSON.stringify({ conversation_id: convoId, content: body, direction: 'inbound', sender: client.name || from, channel: 'sms', twilio_sid: sid }),
              })
              await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${convoId}`, {
                method: 'PATCH', headers: sbHeaders,
                body: JSON.stringify({ last_message: body.slice(0, 100), updated_at: new Date().toISOString() }),
              })
            }
          }
        } catch (e) {
          console.error('Failed to store incoming SMS:', e.message)
        }
      }

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
