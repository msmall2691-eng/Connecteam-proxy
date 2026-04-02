// Vercel serverless: ManyChat Webhook Integration
// Receives messages and subscriber data from ManyChat
// POST /api/manychat — incoming webhook from ManyChat flows

import crypto from 'crypto'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ManyChat webhook active', timestamp: new Date().toISOString() })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  // Verify webhook secret if configured
  const WEBHOOK_SECRET = process.env.MANYCHAT_WEBHOOK_SECRET
  if (WEBHOOK_SECRET) {
    const providedSecret = req.headers['x-webhook-secret']
    if (!providedSecret || !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(WEBHOOK_SECRET))) {
      return res.status(401).json({ error: 'Invalid webhook secret' })
    }
  } else {
    console.warn('MANYCHAT_WEBHOOK_SECRET not set — webhook authentication skipped')
  }

  try {
    const data = req.body

    // ManyChat sends different formats depending on the trigger
    // Normalize the data
    const subscriber = {
      name: data.full_name || data.name || data.first_name ? `${data.first_name || ''} ${data.last_name || ''}`.trim() : '',
      firstName: data.first_name || '',
      lastName: data.last_name || '',
      email: data.email || '',
      phone: data.phone || data.phone_number || '',
      source: data.source || detectSource(data),
      channel: data.channel || detectChannel(data),
      message: data.last_input_text || data.message || data.text || '',
      // ManyChat-specific fields
      manychatId: data.id || data.subscriber_id || data.manychat_id || '',
      manychatName: data.name || data.full_name || '',
      profilePic: data.profile_pic || '',
      gender: data.gender || '',
      locale: data.locale || '',
      timezone: data.timezone || '',
      liveChatUrl: data.live_chat_url || '',
      // Custom fields from ManyChat
      service: data.service || data.custom_field_service || '',
      address: data.address || data.custom_field_address || '',
      propertyType: data.property_type || data.custom_field_property_type || '',
      notes: data.notes || data.custom_field_notes || '',
      // Tags
      tags: data.tags || [],
    }

    if (!subscriber.name && !subscriber.email && !subscriber.phone) {
      return res.status(200).json({ success: true, action: 'skipped', reason: 'No identifying info' })
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

    let clientId = null

    if (supabaseUrl && supabaseKey) {
      const sbHeaders = { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=representation' }

      // Check if client already exists (by email or phone)
      let existingClient = null
      if (subscriber.email) {
        const r = await fetch(`${supabaseUrl}/rest/v1/clients?email=eq.${encodeURIComponent(subscriber.email)}&limit=1`, { headers: sbHeaders })
        const clients = await r.json()
        if (clients?.length > 0) existingClient = clients[0]
      }
      if (!existingClient && subscriber.phone) {
        const r = await fetch(`${supabaseUrl}/rest/v1/clients?phone=eq.${encodeURIComponent(subscriber.phone)}&limit=1`, { headers: sbHeaders })
        const clients = await r.json()
        if (clients?.length > 0) existingClient = clients[0]
      }

      if (existingClient) {
        clientId = existingClient.id
        // Add message to existing conversation or create new one
        if (subscriber.message) {
          await addMessageToClient(supabaseUrl, sbHeaders, existingClient, subscriber)
        }
      } else {
        // Create new client
        const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients`, {
          method: 'POST', headers: sbHeaders,
          body: JSON.stringify({
            name: subscriber.name || subscriber.email || subscriber.phone,
            email: subscriber.email, phone: subscriber.phone,
            address: subscriber.address,
            status: 'lead',
            type: subscriber.propertyType || 'residential',
            source: `ManyChat (${subscriber.channel})`,
            notes: buildNotes(subscriber),
            tags: subscriber.tags.length > 0 ? subscriber.tags : [subscriber.channel, 'manychat'].filter(Boolean),
          }),
        })
        if (clientRes.ok) {
          const created = await clientRes.json()
          clientId = created[0]?.id

          // Create conversation for their first message
          if (subscriber.message && clientId) {
            await addMessageToClient(supabaseUrl, sbHeaders, { id: clientId, name: subscriber.name }, subscriber)
          }
        }
      }

      // Store notification for dashboard widget
      await fetch(`${supabaseUrl}/rest/v1/notifications`, {
        method: 'POST', headers: sbHeaders,
        body: JSON.stringify({
          type: 'manychat',
          title: `${subscriber.channel === 'instagram' ? '📸' : subscriber.channel === 'facebook' ? '📘' : subscriber.channel === 'sms' ? '💬' : '📧'} ${subscriber.name || 'Someone'} via ${subscriber.channel}`,
          message: subscriber.message || 'New contact',
          client_id: clientId,
          data: JSON.stringify({ subscriber }),
          read: false,
        }),
      }).catch(() => {}) // Ignore if notifications table doesn't exist yet
    }

    // Send email notification
    await sendNotificationEmail(subscriber)

    return res.status(200).json({
      success: true,
      action: clientId ? 'processed' : 'received',
      clientId,
      subscriber: { name: subscriber.name, channel: subscriber.channel },
    })
  } catch (err) {
    console.error('ManyChat webhook error:', err)
    return res.status(200).json({ success: false, error: err.message }) // Return 200 so ManyChat doesn't retry
  }
}

function detectSource(data) {
  if (data.ig_id || data.instagram_id) return 'Instagram'
  if (data.fb_id || data.facebook_id || data.messenger_id) return 'Facebook'
  if (data.whatsapp_id) return 'WhatsApp'
  if (data.sms_phone || data.phone) return 'SMS'
  return 'ManyChat'
}

function detectChannel(data) {
  if (data.ig_id || data.instagram_id) return 'instagram'
  if (data.fb_id || data.facebook_id || data.messenger_id) return 'facebook'
  if (data.whatsapp_id) return 'whatsapp'
  if (data.sms_phone) return 'sms'
  if (data.email && !data.fb_id) return 'email'
  return 'manychat'
}

function buildNotes(s) {
  const lines = []
  if (s.message) lines.push(`First message: ${s.message}`)
  if (s.service) lines.push(`Service: ${s.service}`)
  if (s.channel) lines.push(`Channel: ${s.channel}`)
  if (s.manychatId) lines.push(`ManyChat ID: ${s.manychatId}`)
  if (s.liveChatUrl) lines.push(`Live chat: ${s.liveChatUrl}`)
  return lines.join('\n')
}

async function addMessageToClient(supabaseUrl, headers, client, subscriber) {
  // Find or create conversation
  const channel = subscriber.channel === 'instagram' || subscriber.channel === 'facebook' ? subscriber.channel : 'text'
  const convRes = await fetch(`${supabaseUrl}/rest/v1/conversations?client_id=eq.${client.id}&channel=eq.${channel}&limit=1&order=updated_at.desc`, { headers })
  const convos = await convRes.json()

  let convoId
  if (convos?.length > 0) {
    convoId = convos[0].id
  } else {
    const newConvo = await fetch(`${supabaseUrl}/rest/v1/conversations`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ client_id: client.id, subject: `${subscriber.channel} conversation`, channel, last_message: subscriber.message?.slice(0, 100) }),
    })
    const created = await newConvo.json()
    convoId = created[0]?.id
  }

  if (convoId && subscriber.message) {
    await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ conversation_id: convoId, content: subscriber.message, direction: 'inbound', sender: subscriber.name || 'Client', channel: subscriber.channel }),
    })
    // Update conversation last_message
    await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${convoId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ last_message: subscriber.message.slice(0, 100) }),
    })
  }
}

async function sendNotificationEmail(subscriber) {
  try {
    const clientId = process.env.GMAIL_CLIENT_ID
    const clientSecret = process.env.GMAIL_CLIENT_SECRET
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN
    if (!clientId || !clientSecret || !refreshToken) return

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return

    const emoji = subscriber.channel === 'instagram' ? '📸' : subscriber.channel === 'facebook' ? '📘' : subscriber.channel === 'sms' ? '💬' : '📧'
    const body = [
      `${emoji} New message via ${subscriber.channel}`,
      '', `From: ${subscriber.name || 'Unknown'}`,
      subscriber.email ? `Email: ${subscriber.email}` : '',
      subscriber.phone ? `Phone: ${subscriber.phone}` : '',
      subscriber.message ? `\nMessage: ${subscriber.message}` : '',
      '', `View in Workflow HQ: https://connecteam-proxy.vercel.app/#/communications`,
      subscriber.liveChatUrl ? `Reply in ManyChat: ${subscriber.liveChatUrl}` : '',
    ].filter(Boolean).join('\n')

    const raw = Buffer.from(
      `To: office@mainecleaningco.com\r\nSubject: ${emoji} ${subscriber.name || 'New message'} via ${subscriber.channel}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString('base64url')

    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    })
  } catch {}
}
