// Vercel serverless: AI chat — tries OpenAI first, falls back to Anthropic
// POST /api/chat with { messages: [...], context: "..." }

const SYSTEM_PROMPT = `You are an operations assistant for The Maine Cleaning & Property Management Co. You help the owner manage their cleaning business — answering questions about employees, schedules, payroll, mileage, clients, quotes, invoices, and properties.

You have access to real-time data from their Connecteam workforce management system and CRM. Be concise, direct, and helpful. Use bullet points and bold (**text**) for key numbers. When asked for a "rundown" or "summary", give a quick operational overview.

Format numbers clearly: hours, dollars, miles. Flag anything unusual or needing attention.`

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const openaiKey = process.env.OPENAI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (!openaiKey && !anthropicKey) {
    return res.status(500).json({ error: 'No AI API key configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to Vercel env vars.' })
  }

  try {
    const { messages, context } = req.body
    const systemContent = `${SYSTEM_PROMPT}\n\nCurrent data:\n${context || 'No data loaded.'}`

    // Try OpenAI first
    if (openaiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 1500,
            messages: [
              { role: 'system', content: systemContent },
              ...messages.map(m => ({ role: m.role, content: m.content })),
            ],
          }),
        })

        if (response.ok) {
          const data = await response.json()
          const content = data.choices?.[0]?.message?.content || 'No response.'
          return res.status(200).json({ content, provider: 'openai' })
        }
        // If OpenAI fails, fall through to Anthropic
        console.error('OpenAI error:', await response.text())
      } catch (e) {
        console.error('OpenAI failed:', e.message)
      }
    }

    // Fall back to Anthropic
    if (anthropicKey) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          system: systemContent,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const content = data.content?.[0]?.text || 'No response.'
        return res.status(200).json({ content, provider: 'anthropic' })
      }
      console.error('Anthropic error:', await response.text())
    }

    return res.status(502).json({ error: 'Both AI providers failed. Check API keys and credits.' })
  } catch (err) {
    console.error('Chat handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
