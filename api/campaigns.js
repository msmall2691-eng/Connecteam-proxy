// Vercel serverless: Campaign & Sequence management
// POST /api/campaigns?action=create — create a campaign (blast or sequence)
// POST /api/campaigns?action=send-blast — send a blast campaign immediately
// GET  /api/campaigns?action=list — list all campaigns
// GET  /api/campaigns?action=run-sequences — cron: process pending sequence steps
// POST /api/campaigns?action=trigger-sequence — enroll a client in a sequence

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' })

  const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' }
  const action = req.query.action || req.body?.action

  try {
    // ════════════════════════════════════════════════
    // LIST campaigns
    // ════════════════════════════════════════════════
    if (action === 'list') {
      const type = req.query.type // 'blast' or 'sequence' or undefined for all
      let url = `${supabaseUrl}/rest/v1/campaigns?select=*&order=created_at.desc`
      if (type) url += `&type=eq.${type}`
      const r = await fetch(url, { headers: sbHeaders })
      const campaigns = await r.json()

      // For sequences, also fetch steps
      for (const c of campaigns) {
        if (c.type === 'sequence') {
          const stepsRes = await fetch(
            `${supabaseUrl}/rest/v1/campaign_steps?campaign_id=eq.${c.id}&order=delay_days.asc`,
            { headers: sbHeaders }
          )
          c.steps = await stepsRes.json()
        }
      }

      return res.status(200).json({ campaigns })
    }

    // ════════════════════════════════════════════════
    // CREATE campaign
    // ════════════════════════════════════════════════
    if (action === 'create' && req.method === 'POST') {
      const { name, type, channel, subject, body, audience, steps } = req.body
      if (!name || !type) return res.status(400).json({ error: 'name and type required' })

      const campaign = {
        name,
        type, // 'blast' or 'sequence'
        channel: channel || 'sms', // 'sms', 'email', or 'both'
        subject: subject || null,
        body: body || null,
        audience: audience || {}, // { status: 'active', tags: [...], type: 'residential' }
        status: 'draft',
      }

      const createRes = await fetch(`${supabaseUrl}/rest/v1/campaigns`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(campaign),
      })
      const created = await createRes.json()
      const campaignId = created?.[0]?.id

      // If sequence, create steps
      if (type === 'sequence' && steps?.length && campaignId) {
        for (const step of steps) {
          await fetch(`${supabaseUrl}/rest/v1/campaign_steps`, {
            method: 'POST', headers: sbHeaders,
            body: JSON.stringify({
              campaign_id: campaignId,
              step_order: step.step_order,
              delay_days: step.delay_days,
              channel: step.channel || channel || 'sms',
              subject: step.subject || null,
              body: step.body,
            }),
          })
        }
      }

      return res.status(201).json({ campaign: created?.[0] })
    }

    // ════════════════════════════════════════════════
    // SEND BLAST — send campaign to matching audience now
    // ════════════════════════════════════════════════
    if (action === 'send-blast' && req.method === 'POST') {
      const { campaignId } = req.body
      if (!campaignId) return res.status(400).json({ error: 'campaignId required' })

      // Fetch campaign
      const cRes = await fetch(`${supabaseUrl}/rest/v1/campaigns?id=eq.${campaignId}&limit=1`, { headers: sbHeaders })
      const campaigns = await cRes.json()
      const campaign = campaigns?.[0]
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' })
      if (campaign.type !== 'blast') return res.status(400).json({ error: 'Not a blast campaign' })

      // Build audience query
      let clientUrl = `${supabaseUrl}/rest/v1/clients?select=id,name,email,phone,status,type,tags`
      const aud = campaign.audience || {}
      if (aud.status) clientUrl += `&status=eq.${aud.status}`
      if (aud.type) clientUrl += `&type=eq.${aud.type}`
      // Tags filter: clients with any of the specified tags
      if (aud.tags?.length) {
        clientUrl += `&tags=ov.{${aud.tags.join(',')}}`
      }

      const clientRes = await fetch(clientUrl, { headers: sbHeaders })
      const clients = (await clientRes.json()) || []

      let sentCount = 0
      let failedCount = 0
      const results = []

      // Send to each client
      for (const client of clients) {
        const firstName = (client.name || '').split(' ')[0] || 'there'
        const personalizedBody = (campaign.body || '')
          .replace(/\{name\}/gi, client.name || '')
          .replace(/\{first_name\}/gi, firstName)

        let sent = false

        // Send SMS
        if ((campaign.channel === 'sms' || campaign.channel === 'both') && client.phone) {
          try {
            const twilioResult = await sendTwilioSms(client.phone, personalizedBody)
            if (twilioResult.sid) {
              sent = true
              // Log message
              await logCampaignMessage(supabaseUrl, sbHeaders, client, personalizedBody, 'sms', campaign.id, null, twilioResult.sid)
            }
          } catch (e) { console.error('Blast SMS failed:', e.message) }
        }

        // Send email
        if ((campaign.channel === 'email' || campaign.channel === 'both') && client.email) {
          try {
            const personalizedSubject = (campaign.subject || 'Message from The Maine Cleaning Co.')
              .replace(/\{name\}/gi, client.name || '')
              .replace(/\{first_name\}/gi, firstName)
            const emailResult = await sendGmailEmail(client.email, personalizedSubject, personalizedBody)
            if (emailResult.id) {
              sent = true
              await logCampaignMessage(supabaseUrl, sbHeaders, client, personalizedBody, 'email', campaign.id, emailResult.id, null)
            }
          } catch (e) { console.error('Blast email failed:', e.message) }
        }

        if (sent) {
          sentCount++
          results.push({ clientId: client.id, name: client.name, status: 'sent' })
        } else {
          failedCount++
          results.push({ clientId: client.id, name: client.name, status: 'failed' })
        }

        // Rate limit: small delay between sends
        await new Promise(r => setTimeout(r, 200))
      }

      // Update campaign status
      await fetch(`${supabaseUrl}/rest/v1/campaigns?id=eq.${campaignId}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), sent_count: sentCount }),
      })

      return res.status(200).json({ sent: sentCount, failed: failedCount, total: clients.length, results })
    }

    // ════════════════════════════════════════════════
    // TRIGGER SEQUENCE — enroll a client in a drip sequence
    // POST /api/campaigns?action=trigger-sequence
    // Body: { campaignId, clientId, trigger }
    // ════════════════════════════════════════════════
    if (action === 'trigger-sequence' && req.method === 'POST') {
      const { campaignId, clientId, trigger } = req.body
      if (!campaignId || !clientId) return res.status(400).json({ error: 'campaignId and clientId required' })

      // Check if already enrolled
      const existRes = await fetch(
        `${supabaseUrl}/rest/v1/campaign_enrollments?campaign_id=eq.${campaignId}&client_id=eq.${clientId}&status=eq.active&limit=1`,
        { headers: sbHeaders }
      )
      const existing = await existRes.json()
      if (existing?.length) return res.status(200).json({ message: 'Already enrolled', enrollment: existing[0] })

      const enrollment = {
        campaign_id: campaignId,
        client_id: clientId,
        trigger: trigger || 'manual',
        status: 'active',
        current_step: 0,
        enrolled_at: new Date().toISOString(),
      }

      const createRes = await fetch(`${supabaseUrl}/rest/v1/campaign_enrollments`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(enrollment),
      })
      const created = await createRes.json()

      return res.status(201).json({ enrollment: created?.[0] })
    }

    // ════════════════════════════════════════════════
    // RUN SEQUENCES — cron: process all active enrollments
    // GET /api/campaigns?action=run-sequences
    // ════════════════════════════════════════════════
    if (action === 'run-sequences') {
      // Fetch all active enrollments
      const enrRes = await fetch(
        `${supabaseUrl}/rest/v1/campaign_enrollments?status=eq.active&select=*,client:clients(id,name,email,phone),campaign:campaigns(id,name,channel)`,
        { headers: sbHeaders }
      )
      const enrollments = (await enrRes.json()) || []
      if (!enrollments.length) return res.status(200).json({ message: 'No active enrollments', processed: 0 })

      let processed = 0
      let sent = 0

      for (const enrollment of enrollments) {
        const client = enrollment.client
        if (!client) continue

        // Fetch sequence steps for this campaign
        const stepsRes = await fetch(
          `${supabaseUrl}/rest/v1/campaign_steps?campaign_id=eq.${enrollment.campaign_id}&order=step_order.asc`,
          { headers: sbHeaders }
        )
        const steps = (await stepsRes.json()) || []
        if (!steps.length) continue

        const nextStepIndex = enrollment.current_step || 0
        if (nextStepIndex >= steps.length) {
          // Sequence complete — mark enrollment done
          await fetch(`${supabaseUrl}/rest/v1/campaign_enrollments?id=eq.${enrollment.id}`, {
            method: 'PATCH', headers: sbHeaders,
            body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() }),
          })
          processed++
          continue
        }

        const step = steps[nextStepIndex]
        const enrolledAt = new Date(enrollment.last_step_at || enrollment.enrolled_at)
        const daysSinceLastStep = (Date.now() - enrolledAt.getTime()) / 86400000

        // Check if enough days have passed for this step
        if (daysSinceLastStep < (step.delay_days || 0)) continue

        // Time to send this step
        const firstName = (client.name || '').split(' ')[0] || 'there'
        const personalizedBody = (step.body || '')
          .replace(/\{name\}/gi, client.name || '')
          .replace(/\{first_name\}/gi, firstName)
        const channel = step.channel || enrollment.campaign?.channel || 'sms'
        let stepSent = false

        if ((channel === 'sms' || channel === 'both') && client.phone) {
          try {
            const result = await sendTwilioSms(client.phone, personalizedBody)
            if (result.sid) stepSent = true
          } catch (e) { console.error('Sequence SMS failed:', e.message) }
        }

        if ((channel === 'email' || channel === 'both') && client.email) {
          try {
            const personalizedSubject = (step.subject || 'The Maine Cleaning Co.')
              .replace(/\{name\}/gi, client.name || '')
              .replace(/\{first_name\}/gi, firstName)
            const result = await sendGmailEmail(client.email, personalizedSubject, personalizedBody)
            if (result.id) stepSent = true
          } catch (e) { console.error('Sequence email failed:', e.message) }
        }

        if (stepSent) {
          const newStep = nextStepIndex + 1
          const isComplete = newStep >= steps.length
          await fetch(`${supabaseUrl}/rest/v1/campaign_enrollments?id=eq.${enrollment.id}`, {
            method: 'PATCH', headers: sbHeaders,
            body: JSON.stringify({
              current_step: newStep,
              last_step_at: new Date().toISOString(),
              status: isComplete ? 'completed' : 'active',
              ...(isComplete ? { completed_at: new Date().toISOString() } : {}),
            }),
          })
          sent++
        }

        processed++
        await new Promise(r => setTimeout(r, 200))
      }

      return res.status(200).json({ processed, sent })
    }

    // ════════════════════════════════════════════════
    // DELETE campaign
    // ════════════════════════════════════════════════
    if (action === 'delete' && req.method === 'POST') {
      const { campaignId } = req.body
      if (!campaignId) return res.status(400).json({ error: 'campaignId required' })

      // Delete steps and enrollments first
      await fetch(`${supabaseUrl}/rest/v1/campaign_steps?campaign_id=eq.${campaignId}`, {
        method: 'DELETE', headers: sbHeaders,
      }).catch(() => {})
      await fetch(`${supabaseUrl}/rest/v1/campaign_enrollments?campaign_id=eq.${campaignId}`, {
        method: 'DELETE', headers: sbHeaders,
      }).catch(() => {})
      await fetch(`${supabaseUrl}/rest/v1/campaigns?id=eq.${campaignId}`, {
        method: 'DELETE', headers: sbHeaders,
      })

      return res.status(200).json({ deleted: true })
    }

    return res.status(400).json({ error: 'Unknown action. Use: list, create, send-blast, trigger-sequence, run-sequences, delete' })
  } catch (err) {
    console.error('Campaigns handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// ── Helper: Send SMS via Twilio ──
async function sendTwilioSms(to, body) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    throw new Error('Twilio not configured')
  }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: TWILIO_PHONE_NUMBER, To: to, Body: body }),
  })
  return r.json()
}

// ── Helper: Send email via Gmail API ──
async function sendGmailEmail(to, subject, body) {
  const creds = getGmailCreds()
  if (!creds) throw new Error('Gmail not configured')
  const token = await getAccessToken(creds)
  if (!token) throw new Error('Gmail token refresh failed')

  const raw = Buffer.from(
    `To: ${to}\r\nFrom: The Maine Cleaning Co. <office@mainecleaningco.com>\r\nReply-To: office@mainecleaningco.com\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString('base64url')

  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  return r.json()
}

// ── Helper: Log campaign message to conversations/messages ──
async function logCampaignMessage(supabaseUrl, sbHeaders, client, content, channel, campaignId, gmailId, twilioSid) {
  try {
    const convChannel = channel === 'sms' ? 'text' : 'email'
    const convRes = await fetch(
      `${supabaseUrl}/rest/v1/conversations?client_id=eq.${client.id}&channel=eq.${convChannel}&limit=1&order=updated_at.desc`,
      { headers: sbHeaders }
    )
    const convos = (await convRes.json()) || []
    let convoId = convos[0]?.id

    if (!convoId) {
      const newConvo = await fetch(`${supabaseUrl}/rest/v1/conversations`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({
          client_id: client.id, subject: 'Campaign Message',
          channel: convChannel, last_message: content.slice(0, 100),
        }),
      })
      const created = await newConvo.json()
      convoId = created?.[0]?.id
    }

    if (convoId) {
      await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: 'POST', headers: sbHeaders,
        body: JSON.stringify({
          conversation_id: convoId, content, direction: 'outbound',
          sender: 'Campaign', channel, is_automated: true,
          automation_trigger: 'campaign',
          ...(gmailId ? { gmail_message_id: gmailId } : {}),
          ...(twilioSid ? { twilio_sid: twilioSid } : {}),
          metadata: JSON.stringify({ campaign_id: campaignId }),
        }),
      })
      await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${convoId}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ last_message: content.slice(0, 100), updated_at: new Date().toISOString() }),
      })
    }
  } catch (e) { console.error('Campaign message log failed:', e.message) }
}

function getGmailCreds() {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null
  return { clientId, clientSecret, refreshToken }
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  const data = await r.json()
  return data.access_token || null
}
