// Shared webhook dispatch utility
// Call dispatchWebhook('visit.completed', { visitId, clientId, ... }) from any API route
// It will find all subscribers for that event and POST the payload

import crypto from 'crypto'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

/**
 * Dispatch a webhook event to all subscribers
 * @param {string} event - e.g. 'visit.completed', 'invoice.paid', 'client.created'
 * @param {object} payload - event data
 */
export async function dispatchWebhook(event, payload) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return

  const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }

  try {
    // Find active webhooks subscribed to this event
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/webhooks?is_active=eq.true&events=cs.{${event}}&select=id,url,secret`,
      { headers: sbHeaders }
    )
    const webhooks = await r.json()
    if (!webhooks?.length) return

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload })

    for (const webhook of webhooks) {
      const headers = { 'Content-Type': 'application/json' }

      // Sign payload with shared secret if configured
      if (webhook.secret) {
        const sig = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')
        headers['X-Webhook-Signature'] = `sha256=${sig}`
      }

      try {
        const deliveryRes = await fetch(webhook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) })

        // Log delivery
        await fetch(`${SUPABASE_URL}/rest/v1/webhook_deliveries`, {
          method: 'POST', headers: sbHeaders,
          body: JSON.stringify({
            webhook_id: webhook.id,
            event,
            payload: JSON.parse(body),
            response_status: deliveryRes.status,
            response_body: (await deliveryRes.text()).slice(0, 500),
          }),
        })

        // Update last triggered
        await fetch(`${SUPABASE_URL}/rest/v1/webhooks?id=eq.${webhook.id}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify({ last_triggered_at: new Date().toISOString(), failure_count: 0 }),
        })
      } catch (err) {
        // Log failed delivery
        await fetch(`${SUPABASE_URL}/rest/v1/webhook_deliveries`, {
          method: 'POST', headers: sbHeaders,
          body: JSON.stringify({
            webhook_id: webhook.id, event,
            payload: JSON.parse(body),
            response_status: 0,
            response_body: err.message,
          }),
        })

        // Increment failure count, disable after 10 consecutive failures
        const whRes = await fetch(`${SUPABASE_URL}/rest/v1/webhooks?id=eq.${webhook.id}&select=failure_count`, { headers: sbHeaders })
        const wh = (await whRes.json())?.[0]
        const newCount = (wh?.failure_count || 0) + 1

        await fetch(`${SUPABASE_URL}/rest/v1/webhooks?id=eq.${webhook.id}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify({
            failure_count: newCount,
            is_active: newCount < 10,
          }),
        })
      }
    }
  } catch (err) {
    console.error('Webhook dispatch error:', err.message)
  }
}

/**
 * Create an in-app notification
 */
export async function createNotification({ title, body, type, userId, roleTarget, actionUrl, entityType, entityId }) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return

  const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }

  await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
    method: 'POST', headers: sbHeaders,
    body: JSON.stringify({
      title, body, type: type || 'info',
      user_id: userId || null,
      role_target: roleTarget || null,
      action_url: actionUrl || null,
      entity_type: entityType || null,
      entity_id: entityId || null,
    }),
  }).catch(err => console.error('Notification create error:', err.message))
}
