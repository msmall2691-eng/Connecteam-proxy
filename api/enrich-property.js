// Vercel serverless: AI Property Enrichment
// POST /api/enrich-property — uses Claude to estimate property details from address
// Returns: sqft, bedrooms, bathrooms, stories, property type, notes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { address, name, clientType } = req.body
  if (!address) return res.status(400).json({ error: 'address required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'AI not configured (ANTHROPIC_API_KEY missing)' })

  try {
    const prompt = `Given this property address, estimate the property details. This is for a cleaning company in Maine to help with scheduling and pricing.

Address: ${address}
${name ? `Property Name: ${name}` : ''}
${clientType ? `Client Type: ${clientType}` : ''}

Based on the address (location, neighborhood, typical housing stock), provide your best estimates. For Maine properties: coastal areas tend to have larger vacation rentals, Portland/South Portland has mixed residential, and rural areas have varied sizes.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "sqft": <number or null if unknown>,
  "bedrooms": <number or null>,
  "bathrooms": <number or null>,
  "stories": <1 or 2 or 3>,
  "propertyType": "<residential|commercial|rental|marina>",
  "parkingInstructions": "<brief note or null>",
  "notes": "<any useful context about the area/property, 1-2 sentences>",
  "confidence": "<low|medium|high>"
}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(500).json({ error: 'AI request failed', details: err })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return res.status(200).json({ enriched: false, raw: text, error: 'Could not parse AI response' })
    }

    const enrichment = JSON.parse(jsonMatch[0])

    return res.status(200).json({
      enriched: true,
      address,
      ...enrichment,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
