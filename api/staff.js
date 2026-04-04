// Vercel serverless: Staff management endpoints
// Availability, time-off, supplies, documents, notifications, webhooks, health scoring
// All require authentication via _auth.js
//
// Availability:
//   GET  /api/staff?action=availability&employeeId=xxx
//   POST /api/staff?action=set-availability
//
// Time-Off:
//   GET  /api/staff?action=time-off-requests
//   POST /api/staff?action=request-time-off
//   POST /api/staff?action=review-time-off
//
// Shift Offers:
//   POST /api/staff?action=create-shift-offer
//   GET  /api/staff?action=shift-offers&visitId=xxx
//
// Supplies:
//   GET  /api/staff?action=supplies
//   POST /api/staff?action=add-supply
//   POST /api/staff?action=restock
//   GET  /api/staff?action=low-stock
//
// Documents:
//   GET  /api/staff?action=documents&clientId=xxx|propertyId=xxx|employeeId=xxx
//   POST /api/staff?action=upload-document
//   POST /api/staff?action=delete-document
//
// Notifications:
//   GET  /api/staff?action=notifications
//   POST /api/staff?action=mark-read
//   POST /api/staff?action=create-notification
//
// Webhooks:
//   GET  /api/staff?action=webhooks
//   POST /api/staff?action=create-webhook
//   POST /api/staff?action=delete-webhook
//
// Health:
//   GET  /api/staff?action=refresh-health — recalculate all client health scores
//   GET  /api/staff?action=churn-risk — clients at risk of churning

import { requireAuth, requireRole, setAdminCors } from './_auth.js'

export default async function handler(req, res) {
  setAdminCors(req, res)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Database not configured' })

  const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' }
  const action = req.query.action || ''

  try {
    // ══════════════════════════════════════════════════════
    // AVAILABILITY
    // ══════════════════════════════════════════════════════

    if (action === 'availability') {
      const user = await requireAuth(req, res)
      if (!user) return

      const employeeId = req.query.employeeId || user.employee_id
      if (!employeeId) return res.status(400).json({ error: 'employeeId required' })

      const r = await fetch(
        `${supabaseUrl}/rest/v1/employee_availability?employee_id=eq.${employeeId}&order=day_of_week,start_time`,
        { headers: sbHeaders }
      )
      return res.status(200).json({ availability: await r.json() })
    }

    if (action === 'set-availability' && req.method === 'POST') {
      const user = await requireAuth(req, res)
      if (!user) return

      const employeeId = req.body?.employeeId || user.employee_id
      if (!employeeId) return res.status(400).json({ error: 'employeeId required' })

      // Only managers can set other employees' availability
      if (employeeId !== user.employee_id && !['owner', 'admin', 'manager'].includes(user.role)) {
        return res.status(403).json({ error: 'Cannot set availability for other employees' })
      }

      const slots = req.body?.slots || [] // [{day_of_week, start_time, end_time, is_available, notes}]

      // Delete existing and replace (simpler than diffing)
      await fetch(`${supabaseUrl}/rest/v1/employee_availability?employee_id=eq.${employeeId}`, {
        method: 'DELETE', headers: sbHeaders,
      })

      if (slots.length > 0) {
        const rows = slots.map(s => ({
          employee_id: employeeId,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          is_available: s.is_available !== false,
          notes: s.notes || null,
          effective_from: s.effective_from || new Date().toISOString().split('T')[0],
          effective_until: s.effective_until || null,
        }))

        await fetch(`${supabaseUrl}/rest/v1/employee_availability`, {
          method: 'POST', headers: sbHeaders,
          body: JSON.stringify(rows),
        })
      }

      return res.status(200).json({ success: true, count: slots.length })
    }

    // ══════════════════════════════════════════════════════
    // TIME-OFF REQUESTS
    // ══════════════════════════════════════════════════════

    if (action === 'time-off-requests') {
      const user = await requireAuth(req, res)
      if (!user) return

      let url = `${supabaseUrl}/rest/v1/time_off_requests?select=*,employee:employees(first_name,last_name)&order=start_date.desc`

      // Technicians see only their own
      if (user.role === 'technician' && user.employee_id) {
        url += `&employee_id=eq.${user.employee_id}`
      }

      // Filter by status
      if (req.query.status) url += `&status=eq.${req.query.status}`

      const r = await fetch(url, { headers: sbHeaders })
      return res.status(200).json({ requests: await r.json() })
    }

    if (action === 'request-time-off' && req.method === 'POST') {
      const user = await requireAuth(req, res)
      if (!user) return

      const employeeId = req.body?.employeeId || user.employee_id
      if (!employeeId) return res.status(400).json({ error: 'employeeId required' })

      const { type, start_date, end_date, reason } = req.body || {}
      if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' })

      const r = await fetch(`${supabaseUrl}/rest/v1/time_off_requests`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({
          employee_id: employeeId,
          type: type || 'pto',
          start_date, end_date,
          reason: reason || null,
        }),
      })
      const created = await r.json()
      return res.status(201).json({ request: created?.[0] })
    }

    if (action === 'review-time-off' && req.method === 'POST') {
      const user = await requireRole(req, res, ['owner', 'admin', 'manager'])
      if (!user) return

      const { requestId, decision, notes } = req.body || {}
      if (!requestId || !['approved', 'denied'].includes(decision)) {
        return res.status(400).json({ error: 'requestId and decision (approved/denied) required' })
      }

      await fetch(`${supabaseUrl}/rest/v1/time_off_requests?id=eq.${requestId}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({
          status: decision,
          reviewed_by: user.email || 'admin',
          reviewed_at: new Date().toISOString(),
          review_notes: notes || null,
        }),
      })

      return res.status(200).json({ success: true, requestId, decision })
    }

    // ══════════════════════════════════════════════════════
    // SHIFT OFFERS (manager creates, technician responds via employee-portal)
    // ══════════════════════════════════════════════════════

    if (action === 'create-shift-offer' && req.method === 'POST') {
      const user = await requireRole(req, res, ['owner', 'admin', 'manager', 'dispatcher'])
      if (!user) return

      const { visitId, employeeIds, expiresInHours } = req.body || {}
      if (!visitId || !employeeIds?.length) {
        return res.status(400).json({ error: 'visitId and employeeIds[] required' })
      }

      const expiresAt = expiresInHours
        ? new Date(Date.now() + expiresInHours * 3600000).toISOString()
        : null

      const offers = employeeIds.map(eid => ({
        visit_id: visitId,
        employee_id: eid,
        expires_at: expiresAt,
      }))

      const r = await fetch(`${supabaseUrl}/rest/v1/shift_offers`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(offers),
      })

      return res.status(201).json({ offers: await r.json() })
    }

    if (action === 'shift-offers') {
      const user = await requireRole(req, res, ['owner', 'admin', 'manager', 'dispatcher'])
      if (!user) return

      let url = `${supabaseUrl}/rest/v1/shift_offers?select=*,employee:employees(first_name,last_name),visit:visits(scheduled_date,scheduled_start_time,address,client:clients(name))&order=created_at.desc`
      if (req.query.visitId) url += `&visit_id=eq.${req.query.visitId}`
      if (req.query.status) url += `&status=eq.${req.query.status}`

      const r = await fetch(url, { headers: sbHeaders })
      return res.status(200).json({ offers: await r.json() })
    }

    // ══════════════════════════════════════════════════════
    // SUPPLIES
    // ══════════════════════════════════════════════════════

    if (action === 'supplies') {
      const user = await requireAuth(req, res)
      if (!user) return

      const r = await fetch(`${supabaseUrl}/rest/v1/supply_items?active=eq.true&order=category,name`, { headers: sbHeaders })
      return res.status(200).json({ supplies: await r.json() })
    }

    if (action === 'add-supply' && req.method === 'POST') {
      const user = await requireRole(req, res, ['owner', 'admin', 'manager'])
      if (!user) return

      const { name, category, unit, current_stock, reorder_threshold, unit_cost, preferred_vendor } = req.body || {}
      if (!name) return res.status(400).json({ error: 'name required' })

      const r = await fetch(`${supabaseUrl}/rest/v1/supply_items`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ name, category, unit, current_stock, reorder_threshold, unit_cost, preferred_vendor }),
      })
      return res.status(201).json({ supply: (await r.json())?.[0] })
    }

    if (action === 'restock' && req.method === 'POST') {
      const user = await requireRole(req, res, ['owner', 'admin', 'manager'])
      if (!user) return

      const { supplyItemId, quantity } = req.body || {}
      if (!supplyItemId || !quantity) return res.status(400).json({ error: 'supplyItemId and quantity required' })

      // Get current stock and add
      const curRes = await fetch(`${supabaseUrl}/rest/v1/supply_items?id=eq.${supplyItemId}&select=current_stock`, { headers: sbHeaders })
      const cur = (await curRes.json())?.[0]
      if (!cur) return res.status(404).json({ error: 'Supply item not found' })

      await fetch(`${supabaseUrl}/rest/v1/supply_items?id=eq.${supplyItemId}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ current_stock: (cur.current_stock || 0) + quantity }),
      })

      return res.status(200).json({ success: true, newStock: (cur.current_stock || 0) + quantity })
    }

    if (action === 'low-stock') {
      const user = await requireAuth(req, res)
      if (!user) return

      const r = await fetch(
        `${supabaseUrl}/rest/v1/supply_items?active=eq.true&select=*&order=current_stock`,
        { headers: sbHeaders }
      )
      const all = await r.json()
      const lowStock = (all || []).filter(s => s.current_stock <= s.reorder_threshold)

      return res.status(200).json({ lowStock, total: all?.length || 0 })
    }

    // ══════════════════════════════════════════════════════
    // DOCUMENTS
    // ══════════════════════════════════════════════════════

    if (action === 'documents') {
      const user = await requireAuth(req, res)
      if (!user) return

      let url = `${supabaseUrl}/rest/v1/documents?order=created_at.desc`
      if (req.query.clientId) url += `&client_id=eq.${req.query.clientId}`
      if (req.query.propertyId) url += `&property_id=eq.${req.query.propertyId}`
      if (req.query.employeeId) url += `&employee_id=eq.${req.query.employeeId}`
      if (req.query.jobId) url += `&job_id=eq.${req.query.jobId}`
      if (req.query.type) url += `&type=eq.${req.query.type}`

      const r = await fetch(url, { headers: sbHeaders })
      return res.status(200).json({ documents: await r.json() })
    }

    if (action === 'upload-document' && req.method === 'POST') {
      const user = await requireAuth(req, res)
      if (!user) return

      const { name, type, storage_url, client_id, property_id, employee_id, job_id, mime_type, file_size_bytes, expires_at, notes } = req.body || {}
      if (!name || !storage_url) return res.status(400).json({ error: 'name and storage_url required' })

      const r = await fetch(`${supabaseUrl}/rest/v1/documents`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({
          name, type: type || 'other', storage_url,
          client_id, property_id, employee_id, job_id,
          mime_type, file_size_bytes, expires_at, notes,
          uploaded_by: user.id,
        }),
      })
      return res.status(201).json({ document: (await r.json())?.[0] })
    }

    if (action === 'delete-document' && req.method === 'POST') {
      const user = await requireRole(req, res, ['owner', 'admin', 'manager'])
      if (!user) return

      const { documentId } = req.body || {}
      if (!documentId) return res.status(400).json({ error: 'documentId required' })

      await fetch(`${supabaseUrl}/rest/v1/documents?id=eq.${documentId}`, {
        method: 'DELETE', headers: sbHeaders,
      })
      return res.status(200).json({ success: true })
    }

    // ══════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ══════════════════════════════════════════════════════

    if (action === 'notifications') {
      const user = await requireAuth(req, res)
      if (!user) return

      const unreadOnly = req.query.unread === 'true'
      let url = `${supabaseUrl}/rest/v1/notifications?or=(user_id.eq.${user.id},role_target.eq.${user.role},and(user_id.is.null,role_target.is.null))&order=created_at.desc&limit=50`
      if (unreadOnly) url += '&is_read=eq.false'

      const r = await fetch(url, { headers: sbHeaders })
      return res.status(200).json({ notifications: await r.json() })
    }

    if (action === 'mark-read' && req.method === 'POST') {
      const user = await requireAuth(req, res)
      if (!user) return

      const { notificationIds } = req.body || {}
      if (!notificationIds?.length) return res.status(400).json({ error: 'notificationIds[] required' })

      for (const nid of notificationIds) {
        await fetch(`${supabaseUrl}/rest/v1/notifications?id=eq.${nid}&user_id=eq.${user.id}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() }),
        })
      }
      return res.status(200).json({ success: true, marked: notificationIds.length })
    }

    if (action === 'create-notification' && req.method === 'POST') {
      const user = await requireRole(req, res, ['owner', 'admin', 'manager'])
      if (!user) return

      const { title, body, type, user_id, role_target, action_url, entity_type, entity_id } = req.body || {}
      if (!title) return res.status(400).json({ error: 'title required' })

      const r = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ title, body, type: type || 'info', user_id, role_target, action_url, entity_type, entity_id }),
      })
      return res.status(201).json({ notification: (await r.json())?.[0] })
    }

    // ══════════════════════════════════════════════════════
    // WEBHOOKS (admin only)
    // ══════════════════════════════════════════════════════

    if (action === 'webhooks') {
      const user = await requireRole(req, res, ['owner', 'admin'])
      if (!user) return

      const r = await fetch(`${supabaseUrl}/rest/v1/webhooks?order=created_at.desc`, { headers: sbHeaders })
      return res.status(200).json({ webhooks: await r.json() })
    }

    if (action === 'create-webhook' && req.method === 'POST') {
      const user = await requireRole(req, res, ['owner', 'admin'])
      if (!user) return

      const { url, events, secret } = req.body || {}
      if (!url || !events?.length) return res.status(400).json({ error: 'url and events[] required' })

      const r = await fetch(`${supabaseUrl}/rest/v1/webhooks`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ url, events, secret: secret || null }),
      })
      return res.status(201).json({ webhook: (await r.json())?.[0] })
    }

    if (action === 'delete-webhook' && req.method === 'POST') {
      const user = await requireRole(req, res, ['owner', 'admin'])
      if (!user) return

      const { webhookId } = req.body || {}
      if (!webhookId) return res.status(400).json({ error: 'webhookId required' })

      await fetch(`${supabaseUrl}/rest/v1/webhooks?id=eq.${webhookId}`, {
        method: 'DELETE', headers: sbHeaders,
      })
      return res.status(200).json({ success: true })
    }

    // ══════════════════════════════════════════════════════
    // CLIENT HEALTH SCORING
    // ══════════════════════════════════════════════════════

    if (action === 'refresh-health') {
      // Can be called by cron or admin
      const user = await requireAuth(req, res)
      if (!user) return

      // Call the SQL function
      const r = await fetch(`${supabaseUrl}/rest/v1/rpc/refresh_all_client_health`, {
        method: 'POST', headers: sbHeaders, body: '{}',
      })
      const result = await r.json()

      return res.status(200).json({ success: true, clientsUpdated: result })
    }

    if (action === 'churn-risk') {
      const user = await requireAuth(req, res)
      if (!user) return

      const r = await fetch(
        `${supabaseUrl}/rest/v1/clients?churn_risk=eq.high&status=eq.active&select=id,name,email,phone,health_score,avg_rating,last_service_date,total_visits,churn_risk&order=health_score`,
        { headers: sbHeaders }
      )
      return res.status(200).json({ atRisk: await r.json() })
    }

    // ══════════════════════════════════════════════════════
    // EXPIRING DOCUMENTS ALERT
    // ══════════════════════════════════════════════════════

    if (action === 'expiring-documents') {
      const user = await requireAuth(req, res)
      if (!user) return

      const thirtyDaysOut = new Date(Date.now() + 30 * 86400000).toISOString()
      const r = await fetch(
        `${supabaseUrl}/rest/v1/documents?expires_at=lte.${thirtyDaysOut}&expires_at=not.is.null&order=expires_at&select=*,employee:employees(first_name,last_name),client:clients(name)`,
        { headers: sbHeaders }
      )
      return res.status(200).json({ expiring: await r.json() })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    console.error('Staff API error:', err)
    return res.status(500).json({ error: err.message })
  }
}
