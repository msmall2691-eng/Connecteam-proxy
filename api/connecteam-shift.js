// Vercel serverless: Push shifts to Connecteam Scheduler
// POST /api/connecteam-shift — creates a shift in Connecteam

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const apiKey = req.headers['x-api-key']
  if (!apiKey) return res.status(400).json({ error: 'X-API-KEY header required' })

  const SCHEDULER_ID = 15248539

  const { title, date, startTime, endTime, notes, address } = req.body
  if (!title || !date) return res.status(400).json({ error: 'title and date required' })

  // Build start/end timestamps
  const start = startTime || '09:00'
  const end = endTime || '12:00'
  const startTs = Math.floor(new Date(`${date}T${start}:00`).getTime() / 1000)
  const endTs = Math.floor(new Date(`${date}T${end}:00`).getTime() / 1000)

  try {
    // Create shift via Connecteam API
    const response = await fetch(`https://api.connecteam.com/scheduler/v1/schedulers/${SCHEDULER_ID}/shifts`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: title,
        startTime: startTs,
        endTime: endTs,
        description: `${notes || ''}\n${address ? `Address: ${address}` : ''}`.trim(),
        location: address ? { name: address } : undefined,
      }),
    })

    if (response.status === 429) {
      return res.status(429).json({ error: 'Connecteam rate limited. Wait a minute and try again.' })
    }

    const data = await response.text()

    if (!response.ok) {
      return res.status(response.status).json({ error: `Connecteam API error: ${response.status}`, detail: data })
    }

    let parsed
    try { parsed = JSON.parse(data) } catch { parsed = { raw: data } }

    return res.status(200).json({ success: true, shift: parsed })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
