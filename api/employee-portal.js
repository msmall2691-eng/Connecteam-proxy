// Vercel serverless: Employee self-service portal
// Mobile-friendly endpoints for field technicians
//
// GET  /api/employee-portal?action=my-schedule          — today/week schedule
// GET  /api/employee-portal?action=my-visits&date=YYYY-MM-DD — visits for a date
// POST /api/employee-portal?action=clock-in&visitId=xxx  — clock in with GPS
// POST /api/employee-portal?action=clock-out&visitId=xxx — clock out with GPS + mileage
// POST /api/employee-portal?action=update-checklist      — update checklist items
// GET  /api/employee-portal?action=my-shift-offers       — pending shift offers
// POST /api/employee-portal?action=respond-offer         — accept/decline shift offer
// GET  /api/employee-portal?action=my-pay-history        — pay history (own only)
// POST /api/employee-portal?action=log-supply            — log supply usage on a visit

import { getAuthUser, setAdminCors } from './_auth.js'

export default async function handler(req, res) {
  setAdminCors(req, res)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Database not configured' })
  }

  // Authenticate — must be a staff member
  const user = await getAuthUser(req)
  if (!user || !['owner', 'admin', 'manager', 'dispatcher', 'technician'].includes(user.role)) {
    return res.status(401).json({ error: 'Authentication required. Staff access only.' })
  }

  const employeeId = user.employee_id
  if (!employeeId && user.role === 'technician') {
    return res.status(403).json({ error: 'Your account is not linked to an employee record. Contact your admin.' })
  }

  const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' }
  const action = req.query.action || ''

  try {
    // ════════════════════════════════════════════════
    // MY SCHEDULE — upcoming visits for this employee
    // ════════════════════════════════════════════════
    if (action === 'my-schedule') {
      const days = parseInt(req.query.days) || 7
      const today = new Date().toISOString().split('T')[0]
      const endDate = new Date(Date.now() + days * 86400000).toISOString().split('T')[0]

      // Admins/managers can see all schedules; technicians see only their own
      let url = `${supabaseUrl}/rest/v1/visits?scheduled_date=gte.${today}&scheduled_date=lte.${endDate}&status=not.in.(cancelled,skipped)&order=scheduled_date,scheduled_start_time&select=*,client:clients(name,phone,email),property:properties(address_line1,city,access_type,parking_instructions,cleaning_notes,has_pets,pet_details),service_type:service_types(name)`

      if (user.role === 'technician') {
        url += `&assigned_employee_id=eq.${employeeId}`
      } else if (req.query.employeeId) {
        url += `&assigned_employee_id=eq.${req.query.employeeId}`
      }

      const r = await fetch(url, { headers: sbHeaders })
      const visits = await r.json()

      return res.status(200).json({ visits, employee_id: employeeId, days })
    }

    // ════════════════════════════════════════════════
    // MY VISITS — visits for a specific date
    // ════════════════════════════════════════════════
    if (action === 'my-visits') {
      const date = req.query.date || new Date().toISOString().split('T')[0]

      let url = `${supabaseUrl}/rest/v1/visits?scheduled_date=eq.${date}&status=not.in.(cancelled,skipped)&order=scheduled_start_time&select=*,client:clients(name,phone,email,address),property:properties(address_line1,city,state,zip,access_type,parking_instructions,cleaning_notes,has_pets,pet_details,latitude,longitude),service_type:service_types(name)`

      if (user.role === 'technician') {
        url += `&assigned_employee_id=eq.${employeeId}`
      }

      const r = await fetch(url, { headers: sbHeaders })
      const visits = await r.json()

      return res.status(200).json({ date, visits })
    }

    // ════════════════════════════════════════════════
    // CLOCK IN — start a visit with GPS
    // ════════════════════════════════════════════════
    if (action === 'clock-in' && req.method === 'POST') {
      const visitId = req.query.visitId || req.body?.visitId
      const lat = req.body?.latitude
      const lng = req.body?.longitude

      if (!visitId) return res.status(400).json({ error: 'visitId required' })

      // Verify this visit is assigned to this employee (or user is admin)
      if (user.role === 'technician') {
        const checkRes = await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}&assigned_employee_id=eq.${employeeId}&select=id`, { headers: sbHeaders })
        const check = await checkRes.json()
        if (!check?.length) return res.status(403).json({ error: 'This visit is not assigned to you' })
      }

      const patch = {
        status: 'in_progress',
        actual_start_time: new Date().toISOString(),
      }
      if (lat) patch.start_lat = lat
      if (lng) patch.start_lng = lng

      await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}`, {
        method: 'PATCH', headers: sbHeaders, body: JSON.stringify(patch),
      })

      return res.status(200).json({ success: true, visitId, clockedInAt: patch.actual_start_time })
    }

    // ════════════════════════════════════════════════
    // CLOCK OUT — end a visit with GPS + mileage
    // ════════════════════════════════════════════════
    if (action === 'clock-out' && req.method === 'POST') {
      const visitId = req.query.visitId || req.body?.visitId
      const lat = req.body?.latitude
      const lng = req.body?.longitude
      const mileage = req.body?.mileage
      const notes = req.body?.employee_notes

      if (!visitId) return res.status(400).json({ error: 'visitId required' })

      // Verify assignment
      if (user.role === 'technician') {
        const checkRes = await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}&assigned_employee_id=eq.${employeeId}&select=id,actual_start_time`, { headers: sbHeaders })
        const check = await checkRes.json()
        if (!check?.length) return res.status(403).json({ error: 'This visit is not assigned to you' })
      }

      // Get visit to calculate duration
      const vRes = await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}&select=actual_start_time`, { headers: sbHeaders })
      const visits = await vRes.json()
      const startTime = visits?.[0]?.actual_start_time

      const now = new Date()
      const patch = {
        status: 'completed',
        actual_end_time: now.toISOString(),
      }
      if (startTime) {
        patch.duration_actual_minutes = Math.round((now - new Date(startTime)) / 60000)
      }
      if (lat) patch.end_lat = lat
      if (lng) patch.end_lng = lng
      if (mileage) patch.mileage = mileage
      if (notes) patch.employee_notes = notes

      await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}`, {
        method: 'PATCH', headers: sbHeaders, body: JSON.stringify(patch),
      })

      return res.status(200).json({ success: true, visitId, clockedOutAt: patch.actual_end_time, durationMinutes: patch.duration_actual_minutes })
    }

    // ════════════════════════════════════════════════
    // UPDATE CHECKLIST — per-item completion from mobile
    // ════════════════════════════════════════════════
    if (action === 'update-checklist' && req.method === 'POST') {
      const visitId = req.query.visitId || req.body?.visitId
      const updates = req.body?.checklist || []

      if (!visitId) return res.status(400).json({ error: 'visitId required' })

      // Verify assignment
      if (user.role === 'technician') {
        const checkRes = await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}&assigned_employee_id=eq.${employeeId}&select=id`, { headers: sbHeaders })
        const check = await checkRes.json()
        if (!check?.length) return res.status(403).json({ error: 'This visit is not assigned to you' })
      }

      const vRes = await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}&select=checklist_snapshot`, { headers: sbHeaders })
      const visit = (await vRes.json())?.[0]
      if (!visit) return res.status(404).json({ error: 'Visit not found' })

      let snapshot = visit.checklist_snapshot || { sections: [] }

      for (const update of updates) {
        const section = snapshot.sections?.find(s => s.name === update.section)
        if (section) {
          const item = section.items?.find(i => i.task === update.item)
          if (item) {
            if (update.completed !== undefined) item.completed = update.completed
            if (update.photoUrl) {
              item.photos = item.photos || []
              item.photos.push({ url: update.photoUrl, timestamp: new Date().toISOString() })
            }
            if (update.notes) item.notes = update.notes
          }
        }
      }

      // Calculate completion
      let total = 0, done = 0
      for (const s of (snapshot.sections || [])) {
        for (const i of (s.items || [])) { total++; if (i.completed) done++ }
      }
      snapshot.completionPercent = total > 0 ? Math.round((done / total) * 100) : 0
      snapshot.lastUpdated = new Date().toISOString()

      const patchBody = { checklist_snapshot: snapshot }
      if (req.body?.photosBefore) patchBody.photos_before = req.body.photosBefore
      if (req.body?.photosAfter) patchBody.photos_after = req.body.photosAfter

      await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${visitId}`, {
        method: 'PATCH', headers: sbHeaders, body: JSON.stringify(patchBody),
      })

      return res.status(200).json({ visitId, completionPercent: snapshot.completionPercent })
    }

    // ════════════════════════════════════════════════
    // MY SHIFT OFFERS — pending offers for this employee
    // ════════════════════════════════════════════════
    if (action === 'my-shift-offers') {
      if (!employeeId) return res.status(400).json({ error: 'No employee linked' })

      const r = await fetch(
        `${supabaseUrl}/rest/v1/shift_offers?employee_id=eq.${employeeId}&status=eq.pending&select=*,visit:visits(*,client:clients(name,phone),property:properties(address_line1,city),service_type:service_types(name))&order=created_at.desc`,
        { headers: sbHeaders }
      )
      const offers = await r.json()

      return res.status(200).json({ offers })
    }

    // ════════════════════════════════════════════════
    // RESPOND TO SHIFT OFFER — accept or decline
    // ════════════════════════════════════════════════
    if (action === 'respond-offer' && req.method === 'POST') {
      const offerId = req.body?.offerId
      const response = req.body?.response // 'accepted' or 'declined'
      const reason = req.body?.reason

      if (!offerId || !['accepted', 'declined'].includes(response)) {
        return res.status(400).json({ error: 'offerId and response (accepted/declined) required' })
      }

      // Verify this offer belongs to this employee
      const offerRes = await fetch(`${supabaseUrl}/rest/v1/shift_offers?id=eq.${offerId}&employee_id=eq.${employeeId}&status=eq.pending&select=*`, { headers: sbHeaders })
      const offers = await offerRes.json()
      if (!offers?.length) return res.status(404).json({ error: 'Offer not found or already responded' })

      const offer = offers[0]

      // Update offer
      await fetch(`${supabaseUrl}/rest/v1/shift_offers?id=eq.${offerId}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ status: response, responded_at: new Date().toISOString(), decline_reason: reason || null }),
      })

      // If accepted, assign this employee to the visit
      if (response === 'accepted') {
        await fetch(`${supabaseUrl}/rest/v1/visits?id=eq.${offer.visit_id}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify({ assigned_employee_id: employeeId }),
        })

        // Expire other pending offers for the same visit
        await fetch(`${supabaseUrl}/rest/v1/shift_offers?visit_id=eq.${offer.visit_id}&status=eq.pending&id=neq.${offerId}`, {
          method: 'PATCH', headers: sbHeaders,
          body: JSON.stringify({ status: 'expired' }),
        })
      }

      return res.status(200).json({ success: true, offerId, response })
    }

    // ════════════════════════════════════════════════
    // MY PAY HISTORY — employee's own payroll data
    // ════════════════════════════════════════════════
    if (action === 'my-pay-history') {
      if (!employeeId) return res.status(400).json({ error: 'No employee linked' })

      // Get employee info
      const empRes = await fetch(`${supabaseUrl}/rest/v1/employees?id=eq.${employeeId}&select=first_name,last_name,hourly_rate,custom_rates`, { headers: sbHeaders })
      const emp = (await empRes.json())?.[0]

      // Get completed visits with duration for this employee (last 90 days)
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
      const visitsRes = await fetch(
        `${supabaseUrl}/rest/v1/visits?assigned_employee_id=eq.${employeeId}&status=eq.completed&scheduled_date=gte.${ninetyDaysAgo}&select=scheduled_date,duration_actual_minutes,mileage,price_override,client:clients(name),service_type:service_types(name)&order=scheduled_date.desc`,
        { headers: sbHeaders }
      )
      const visits = await visitsRes.json()

      return res.status(200).json({ employee: emp, visits, period: { from: ninetyDaysAgo, to: 'now' } })
    }

    // ════════════════════════════════════════════════
    // LOG SUPPLY USAGE — technician logs what they used
    // ════════════════════════════════════════════════
    if (action === 'log-supply' && req.method === 'POST') {
      const { visitId, supplyItemId, quantity, notes } = req.body || {}
      if (!supplyItemId) return res.status(400).json({ error: 'supplyItemId required' })

      await fetch(`${supabaseUrl}/rest/v1/supply_usage`, {
        method: 'POST', headers: sbHeaders,
        body: JSON.stringify({
          supply_item_id: supplyItemId,
          visit_id: visitId || null,
          employee_id: employeeId,
          quantity_used: quantity || 1,
          notes: notes || null,
        }),
      })

      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Unknown action. Use: my-schedule, my-visits, clock-in, clock-out, update-checklist, my-shift-offers, respond-offer, my-pay-history, log-supply' })
  } catch (err) {
    console.error('Employee portal error:', err)
    return res.status(500).json({ error: err.message })
  }
}
