// Vercel serverless: Visit management
// GET /api/visits?action=generate-recurring — generate visits for all active recurring jobs
// GET /api/visits?action=generate-recurring&jobId=xxx — generate for one job
// Called via daily cron (7am UTC) or manually

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const action = req.query.action || 'generate-recurring'
  const jobId = req.query.jobId || null
  const weeksAhead = parseInt(req.query.weeks) || 8

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  const sbHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  }

  if (action === 'generate-recurring') {
    try {
      // Fetch active recurring jobs
      let jobsUrl = `${supabaseUrl}/rest/v1/jobs?is_recurring=eq.true&is_active=eq.true&select=*`
      if (jobId) jobsUrl = `${supabaseUrl}/rest/v1/jobs?id=eq.${jobId}&is_recurring=eq.true&select=*`

      const jobsRes = await fetch(jobsUrl, { headers: sbHeaders })
      const jobs = await jobsRes.json() || []

      if (jobs.length === 0) {
        return res.status(200).json({
          action, jobsProcessed: 0, visitsCreated: 0,
          message: jobId ? 'Job not found or not recurring' : 'No active recurring jobs found',
        })
      }

      const endDate = new Date(Date.now() + weeksAhead * 7 * 86400000).toISOString().split('T')[0]
      const today = new Date().toISOString().split('T')[0]
      let totalCreated = 0
      const details = []

      for (const job of jobs) {
        // Fetch existing visits for this job in the generation window
        const existRes = await fetch(
          `${supabaseUrl}/rest/v1/visits?job_id=eq.${job.id}&scheduled_date=gte.${today}&scheduled_date=lte.${endDate}&select=scheduled_date`,
          { headers: sbHeaders }
        )
        const existing = await existRes.json() || []
        const existingDates = new Set(existing.map(v => v.scheduled_date))

        // Fetch property for address
        let address = job.address || ''
        if (!address && job.property_id) {
          try {
            const propRes = await fetch(`${supabaseUrl}/rest/v1/properties?id=eq.${job.property_id}&select=address_line1`, { headers: sbHeaders })
            const props = await propRes.json()
            address = props?.[0]?.address_line1 || ''
          } catch {}
        }

        // Calculate visit dates
        const interval = job.recurrence_rule === 'weekly' ? 7
          : job.recurrence_rule === 'biweekly' ? 14
          : job.recurrence_rule === 'monthly' ? 'monthly'
          : 7

        const startDate = job.recurrence_start_date || job.last_visit_generated_date || job.date || today
        const startTime = job.preferred_start_time || job.start_time || '09:00'
        const endTime = job.preferred_end_time || job.end_time || '12:00'
        const recurrenceDay = job.recurrence_day // 0=Sun, 1=Mon, ...

        let current = new Date(startDate + 'T12:00:00')
        const end = new Date(endDate + 'T12:00:00')
        let created = 0

        // If monthly, step by month
        if (interval === 'monthly') {
          const dayOfMonth = recurrenceDay || current.getDate()
          current = new Date(current.getFullYear(), current.getMonth(), dayOfMonth)
          if (current < new Date(today + 'T00:00:00')) {
            current.setMonth(current.getMonth() + 1)
          }

          while (current <= end) {
            const dateStr = current.toISOString().split('T')[0]
            if (dateStr >= today && !existingDates.has(dateStr)) {
              await createVisit(supabaseUrl, sbHeaders, job, dateStr, startTime, endTime, address)
              created++
              existingDates.add(dateStr)
            }
            current.setMonth(current.getMonth() + 1)
          }
        } else {
          // Weekly/biweekly: find next occurrence of recurrence_day
          if (recurrenceDay !== null && recurrenceDay !== undefined) {
            while (current.getDay() !== recurrenceDay) {
              current.setDate(current.getDate() + 1)
            }
          }
          // If before today, advance
          while (current < new Date(today + 'T00:00:00')) {
            current.setDate(current.getDate() + interval)
          }

          while (current <= end) {
            const dateStr = current.toISOString().split('T')[0]
            if (!existingDates.has(dateStr)) {
              await createVisit(supabaseUrl, sbHeaders, job, dateStr, startTime, endTime, address)
              created++
              existingDates.add(dateStr)
            }
            current.setDate(current.getDate() + interval)
          }
        }

        // Update job's last_visit_generated_date
        if (created > 0) {
          await fetch(`${supabaseUrl}/rest/v1/jobs?id=eq.${job.id}`, {
            method: 'PATCH',
            headers: sbHeaders,
            body: JSON.stringify({ last_visit_generated_date: endDate }),
          }).catch(err => console.error('Failed to update last_visit_generated_date:', err.message))
        }

        totalCreated += created
        details.push({ jobId: job.id, title: job.title, visitsCreated: created })
      }

      return res.status(200).json({
        action,
        weeksAhead,
        jobsProcessed: jobs.length,
        visitsCreated: totalCreated,
        details,
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use: generate-recurring' })
}

async function createVisit(supabaseUrl, sbHeaders, job, date, startTime, endTime, address) {
  await fetch(`${supabaseUrl}/rest/v1/visits`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      job_id: job.id,
      client_id: job.client_id,
      property_id: job.property_id || null,
      scheduled_date: date,
      scheduled_start_time: startTime,
      scheduled_end_time: endTime,
      status: 'scheduled',
      source: 'recurring',
      service_type_id: job.service_type_id || null,
      address: address || null,
      instructions: job.instructions || null,
      client_visible: true,
    }),
  })
}
