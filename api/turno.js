// Vercel serverless: Turno (TurnoverBnB) webhook integration
// POST /api/turno?action=webhook — receives task events from Turno
// GET  /api/turno?action=status — check integration status
//
// Turno can send webhooks for: task_created, task_updated, task_cancelled
// Each task maps to a visit with source='turno' and turno_task_id set

import crypto from 'crypto'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Turno-Signature')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const action = req.query.action || 'webhook'

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  const sbHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  }

  // ── STATUS CHECK ──
  if (action === 'status') {
    try {
      // Count visits from Turno
      const vRes = await fetch(
        `${supabaseUrl}/rest/v1/visits?source=eq.turno&select=id`,
        { headers: sbHeaders }
      )
      const visits = await vRes.json()

      // Count properties with Turno listing IDs
      const pRes = await fetch(
        `${supabaseUrl}/rest/v1/properties?turno_listing_id=not.is.null&select=id,name,turno_listing_id`,
        { headers: sbHeaders }
      )
      const props = await pRes.json()

      return res.status(200).json({
        connected: (props || []).length > 0,
        propertiesLinked: (props || []).length,
        turnoVisits: (visits || []).length,
        properties: (props || []).map(p => ({ name: p.name, turnoListingId: p.turno_listing_id })),
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ── WEBHOOK ──
  if (action === 'webhook' && req.method === 'POST') {
    // Verify webhook secret if configured
    const WEBHOOK_SECRET = process.env.TURNO_WEBHOOK_SECRET
    if (WEBHOOK_SECRET) {
      const providedSecret = req.headers['x-turno-signature'] || req.headers['x-webhook-secret']
      if (!providedSecret || !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(WEBHOOK_SECRET))) {
        return res.status(401).json({ error: 'Invalid webhook signature' })
      }
    } else {
      console.warn('TURNO_WEBHOOK_SECRET not set — webhook authentication skipped')
    }

    const event = req.body

    if (!event || !event.type) {
      return res.status(400).json({ error: 'Invalid webhook payload' })
    }

    try {
      const eventType = event.type // task_created, task_updated, task_cancelled
      const task = event.data || event.task || event

      const turnoTaskId = task.id || task.task_id
      const listingId = task.listing_id || task.property_id
      const cleaningDate = task.date || task.cleaning_date
      const startTime = task.start_time || '11:00'
      const guestName = task.guest_name || task.guest || ''
      const notes = task.notes || ''
      const status = task.status || ''

      if (!turnoTaskId || !cleaningDate) {
        return res.status(400).json({ error: 'Missing task_id or date in webhook' })
      }

      // Find property by turno_listing_id
      let property = null
      if (listingId) {
        const propRes = await fetch(
          `${supabaseUrl}/rest/v1/properties?turno_listing_id=eq.${listingId}&select=*`,
          { headers: sbHeaders }
        )
        const props = await propRes.json()
        property = props?.[0]
      }

      // Check if visit already exists for this Turno task
      const existRes = await fetch(
        `${supabaseUrl}/rest/v1/visits?turno_task_id=eq.${turnoTaskId}&select=id,status`,
        { headers: sbHeaders }
      )
      const existing = await existRes.json()

      if (eventType === 'task_cancelled' || status === 'cancelled') {
        // Cancel existing visit
        if (existing?.length) {
          await fetch(`${supabaseUrl}/rest/v1/visits?turno_task_id=eq.${turnoTaskId}`, {
            method: 'PATCH', headers: sbHeaders,
            body: JSON.stringify({ status: 'cancelled' }),
          })
          return res.status(200).json({ success: true, action: 'cancelled', visitId: existing[0].id })
        }
        return res.status(200).json({ success: true, action: 'no_visit_to_cancel' })
      }

      if (eventType === 'task_updated' && existing?.length) {
        // Update existing visit
        const updates = {
          scheduled_date: cleaningDate,
          scheduled_start_time: startTime,
          instructions: [guestName ? `Guest: ${guestName}` : '', notes].filter(Boolean).join('\n') || null,
        }
        await fetch(`${supabaseUrl}/rest/v1/visits?turno_task_id=eq.${turnoTaskId}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify(updates),
        })
        return res.status(200).json({ success: true, action: 'updated', visitId: existing[0].id })
      }

      if (existing?.length) {
        return res.status(200).json({ success: true, action: 'already_exists', visitId: existing[0].id })
      }

      // Create new visit
      // Find or create turnover job for this property
      let jobId = null
      if (property) {
        const jobRes = await fetch(
          `${supabaseUrl}/rest/v1/jobs?property_id=eq.${property.id}&source=in.(ical_sync,turno)&is_active=eq.true&select=id`,
          { headers: sbHeaders }
        )
        const jobs = await jobRes.json()
        if (jobs?.length) {
          jobId = jobs[0].id
        } else {
          // Look up turnover service type
          let stId = null
          try {
            const stRes = await fetch(`${supabaseUrl}/rest/v1/service_types?name=eq.Turnover&select=id`, { headers: sbHeaders })
            const stData = await stRes.json()
            stId = stData?.[0]?.id || null
          } catch {}

          const newJobRes = await fetch(`${supabaseUrl}/rest/v1/jobs`, {
            method: 'POST',
            headers: { ...sbHeaders, Prefer: 'return=representation' },
            body: JSON.stringify({
              client_id: property.client_id,
              property_id: property.id,
              title: `Turnover Service — ${property.name || property.address_line1?.split(',')[0]}`,
              date: cleaningDate,
              start_time: startTime,
              end_time: '14:00',
              status: 'scheduled',
              service_type: 'turnover',
              service_type_id: stId,
              is_recurring: false,
              is_active: true,
              source: 'turno',
            }),
          })
          const newJobs = await newJobRes.json()
          jobId = newJobs?.[0]?.id
        }
      }

      // Calculate end time (3 hours)
      const [h, m] = startTime.split(':').map(Number)
      const endTime = `${String(Math.min(h + 3, 23)).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`

      // Look up turnover service type
      let serviceTypeId = null
      try {
        const stRes = await fetch(`${supabaseUrl}/rest/v1/service_types?name=eq.Turnover&select=id`, { headers: sbHeaders })
        serviceTypeId = (await stRes.json())?.[0]?.id || null
      } catch {}

      const visitPayload = {
        job_id: jobId,
        client_id: property?.client_id || null,
        property_id: property?.id || null,
        scheduled_date: cleaningDate,
        scheduled_start_time: startTime,
        scheduled_end_time: endTime,
        status: 'scheduled',
        source: 'turno',
        turno_task_id: turnoTaskId,
        service_type_id: serviceTypeId,
        instructions: [guestName ? `Guest: ${guestName}` : '', notes].filter(Boolean).join('\n') || null,
        address: property?.address_line1 || null,
        client_visible: true,
      }

      const vRes = await fetch(`${supabaseUrl}/rest/v1/visits`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(visitPayload),
      })
      const created = await vRes.json()

      return res.status(200).json({
        success: true,
        action: 'created',
        visitId: created?.[0]?.id,
        turnoTaskId,
        property: property?.name || 'unknown',
      })
    } catch (err) {
      console.error('Turno webhook error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use: webhook, status' })
}
