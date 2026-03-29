// Vercel serverless function: AI agent chat via Claude API
// POST /api/chat with { messages: [...], context: "..." }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' })
  }

  try {
    const { messages, context } = req.body

    const systemPrompt = `You are an operations assistant for The Maine Cleaning & Property Management Co. You help the owner manage their cleaning business — answering questions about employees, schedules, payroll, mileage, and clients.

You have access to real-time data from their Connecteam workforce management system. Be concise, direct, and helpful. Use bullet points and bold for key numbers. When asked for a "rundown" or "summary", give a quick operational overview.

If asked about things you don't have data for, say so honestly and suggest what data would help.

Here is the current Connecteam data:

${context || 'No data loaded yet.'}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Anthropic API error:', errText)
      return res.status(502).json({ error: 'AI service error', detail: errText })
    }

    const data = await response.json()
    const content = data.content?.[0]?.text || 'No response generated.'

    return res.status(200).json({ content })
  } catch (err) {
    console.error('Chat handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
