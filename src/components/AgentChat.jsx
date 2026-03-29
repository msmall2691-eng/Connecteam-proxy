import { useState, useRef, useEffect } from 'react'
import { getApiKey, fetchUsers, fetchTimesheets, fetchTimeActivities, dateRangeWeeks } from '../lib/api'
import { getClients, getJobs, getConversations } from '../lib/store'

export default function AgentChat({ onClose }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hey! I'm your operations assistant powered by Claude. I can pull live data from Connecteam and your CRM — ask me about hours, pay, schedules, mileage, clients, or anything about your operations. What do you need?" }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState(null)
  const [aiMode, setAiMode] = useState('auto') // 'auto' tries Claude API, falls back to local
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => { loadContext() }, [])

  async function loadContext() {
    try {
      const { start, end } = dateRangeWeeks(2)
      const [users, timesheets, activities] = await Promise.all([
        fetchUsers(),
        fetchTimesheets(start, end),
        fetchTimeActivities(start, end),
      ])
      setContext({ users, timesheets, activities, period: { start, end } })
    } catch (err) {
      console.error('Failed to load Connecteam context:', err)
    }
  }

  function buildContextSummary() {
    const lines = []

    // Connecteam data
    if (context) {
      const { users, timesheets, activities, period } = context
      const tsUsers = timesheets.data?.users || []
      lines.push(`=== CONNECTEAM DATA (${period.start} to ${period.end}) ===`, '')

      let grandHours = 0, grandPay = 0
      for (const u of tsUsers) {
        const info = users[u.userId] || { name: `User ${u.userId}` }
        let hours = 0, pay = 0
        for (const dr of u.dailyRecords || []) {
          hours += (dr.totalTime || 0) / 3600
          for (const pi of dr.payItems || []) pay += pi.amount || 0
        }
        grandHours += hours
        grandPay += pay
        if (hours > 0) {
          lines.push(`Employee: ${info.name} | Hours: ${hours.toFixed(1)} | Pay: $${pay.toFixed(2)} | Approved: ${u.approvedState || 'unknown'}`)
        }
      }
      lines.push(``, `Totals: ${grandHours.toFixed(1)} hours, $${grandPay.toFixed(2)} pay`)

      const actUsers = activities.data?.timeActivitiesByUsers || []
      let totalMiles = 0
      for (const u of actUsers) {
        const info = users[u.userId] || { name: `User ${u.userId}` }
        let miles = 0
        for (const shift of u.shifts || []) {
          for (const att of shift.shiftAttachments || []) {
            if (att.attachment?.number) miles += att.attachment.number
          }
        }
        totalMiles += miles
        if (miles > 0) lines.push(`Mileage - ${info.name}: ${miles.toFixed(0)} mi`)
      }
      lines.push(`Total miles: ${totalMiles.toFixed(0)}`)
    } else {
      lines.push('Connecteam data: not loaded yet')
    }

    // CRM data
    const clients = getClients()
    const jobs = getJobs()
    const convos = getConversations()

    lines.push('', `=== CRM DATA ===`)
    lines.push(`Clients: ${clients.length} total`)
    const active = clients.filter(c => c.status === 'active')
    const leads = clients.filter(c => c.status === 'lead')
    lines.push(`Active: ${active.length}, Leads: ${leads.length}`)
    for (const c of clients.slice(0, 20)) {
      lines.push(`Client: ${c.name} | Status: ${c.status} | Type: ${c.type} | ${c.email || 'no email'} | ${c.phone || 'no phone'}`)
    }

    lines.push('', `Jobs: ${jobs.length} total`)
    for (const j of jobs.slice(0, 10)) {
      lines.push(`Job: ${j.title} | Client: ${j.clientName || 'unknown'} | Date: ${j.date} | Status: ${j.status} | Assignee: ${j.assignee || 'unassigned'}`)
    }

    lines.push('', `Conversations: ${convos.length} total`)

    return lines.join('\n')
  }

  async function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', content: text }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    try {
      // Try Claude API first
      const contextSummary = buildContextSummary()
      let response = null

      try {
        const apiMessages = updatedMessages
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role, content: m.content }))

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: apiMessages, context: contextSummary }),
        })

        if (res.ok) {
          const data = await res.json()
          response = data.content
        }
      } catch {
        // Claude API not available, fall through to local
      }

      // Fallback to local response
      if (!response) {
        response = generateLocalResponse(text)
      }

      setMessages(prev => [...prev, { role: 'assistant', content: response }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  function generateLocalResponse(question) {
    const q = question.toLowerCase()

    if (!context) return "I'm still loading the data. Give me a moment and try again."

    const { users, timesheets, activities, period } = context
    const tsUsers = timesheets.data?.users || []

    const employees = []
    let totalHours = 0, totalPay = 0, totalMiles = 0

    for (const u of tsUsers) {
      const info = users[u.userId] || { name: `User ${u.userId}` }
      let hours = 0, pay = 0
      for (const dr of u.dailyRecords || []) {
        hours += (dr.totalTime || 0) / 3600
        for (const pi of dr.payItems || []) pay += pi.amount || 0
      }
      totalHours += hours
      totalPay += pay
      if (hours > 0) {
        employees.push({ name: info.name, hours: +hours.toFixed(1), pay: +pay.toFixed(2), approved: u.approvedState === 'approved' })
      }
    }

    const actUsers = activities.data?.timeActivitiesByUsers || []
    for (const u of actUsers) {
      for (const shift of u.shifts || []) {
        for (const att of shift.shiftAttachments || []) {
          if (att.attachment?.number) totalMiles += att.attachment.number
        }
      }
    }

    employees.sort((a, b) => b.hours - a.hours)
    const unapproved = employees.filter(e => !e.approved)

    // CRM data
    const clients = getClients()
    const jobs = getJobs()

    if (q.includes('rundown') || q.includes('summary') || q.includes('overview') || q.includes('how are we') || q.includes('what\'s going on') || q.includes('status')) {
      let resp = `**Operations Summary (${period.start} to ${period.end})**\n\n`
      resp += `**Workforce:**\n`
      resp += `- ${employees.length} employees worked\n`
      resp += `- ${totalHours.toFixed(1)} total hours / $${totalPay.toFixed(2)} payroll\n`
      resp += `- ${totalMiles.toFixed(0)} miles logged\n`
      if (unapproved.length > 0) {
        resp += `- ${unapproved.length} unapproved timesheet(s): ${unapproved.map(e => e.name).join(', ')}\n`
      }
      resp += `\n**CRM:**\n`
      resp += `- ${clients.length} clients (${clients.filter(c => c.status === 'active').length} active, ${clients.filter(c => c.status === 'lead').length} leads)\n`
      resp += `- ${jobs.length} jobs tracked\n`
      return resp
    }

    if (q.includes('client')) {
      if (clients.length === 0) return 'No clients in your CRM yet. Add some from the Clients page!'
      let resp = `**Clients (${clients.length} total):**\n\n`
      for (const c of clients.slice(0, 15)) {
        resp += `- **${c.name}** (${c.status}) — ${c.type}${c.phone ? ` — ${c.phone}` : ''}\n`
      }
      if (clients.length > 15) resp += `\n...and ${clients.length - 15} more`
      return resp
    }

    if (q.includes('hours') || q.includes('who worked')) {
      let resp = `**Hours (${period.start} to ${period.end}):**\n\n`
      for (const e of employees) resp += `- **${e.name}**: ${e.hours}h ($${e.pay})\n`
      resp += `\n**Total: ${totalHours.toFixed(1)}h / $${totalPay.toFixed(2)}**`
      return resp
    }

    if (q.includes('mile') || q.includes('mileage') || q.includes('driving')) {
      let resp = `**Mileage (${period.start} to ${period.end}):** ${totalMiles.toFixed(0)} total miles\n\n`
      const milesByUser = {}
      for (const u of actUsers) {
        const info = users[u.userId] || { name: `User ${u.userId}` }
        let m = 0
        for (const shift of u.shifts || []) {
          for (const att of shift.shiftAttachments || []) { if (att.attachment?.number) m += att.attachment.number }
        }
        if (m > 0) milesByUser[info.name] = m
      }
      for (const [name, miles] of Object.entries(milesByUser).sort((a, b) => b[1] - a[1])) {
        resp += `- **${name}**: ${miles.toFixed(0)} mi\n`
      }
      return resp
    }

    if (q.includes('pay') || q.includes('wage') || q.includes('cost') || q.includes('payroll')) {
      let resp = `**Payroll (${period.start} to ${period.end}):**\n\n`
      for (const e of employees) {
        const rate = e.hours > 0 ? (e.pay / e.hours).toFixed(2) : '0'
        resp += `- **${e.name}**: $${e.pay} (${e.hours}h @ ~$${rate}/hr)\n`
      }
      resp += `\n**Total: $${totalPay.toFixed(2)}**`
      return resp
    }

    if (q.includes('approv') || q.includes('pending') || q.includes('unapproved')) {
      if (unapproved.length === 0) return 'All timesheets are approved!'
      let resp = `**${unapproved.length} pending timesheet(s):**\n\n`
      for (const e of unapproved) resp += `- **${e.name}**: ${e.hours}h / $${e.pay}\n`
      return resp
    }

    // Employee name search
    const nameMatch = employees.find(e => q.includes(e.name.toLowerCase().split(' ')[0].toLowerCase()))
    if (nameMatch) {
      const rate = nameMatch.hours > 0 ? (nameMatch.pay / nameMatch.hours).toFixed(2) : '0'
      return `**${nameMatch.name}** (${period.start} to ${period.end}):\n- Hours: ${nameMatch.hours}\n- Pay: $${nameMatch.pay}\n- Rate: ~$${rate}/hr\n- Approved: ${nameMatch.approved ? 'Yes' : 'No'}`
    }

    return `Here's what I have for **${period.start} to ${period.end}**:\n\n` +
      `- ${employees.length} employees, ${totalHours.toFixed(1)}h, $${totalPay.toFixed(2)} payroll, ${totalMiles.toFixed(0)} miles\n` +
      `- ${clients.length} CRM clients, ${jobs.length} jobs\n\n` +
      `Ask about: **summary**, **hours**, **pay**, **mileage**, **clients**, **approvals**, or an employee name.\n\n` +
      `_Note: For richer answers, add your Anthropic API key (ANTHROPIC_API_KEY) to your Vercel environment._`
  }

  return (
    <aside className="w-96 bg-gray-900 border-l border-gray-800 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">AI Agent</h2>
          <span className="px-1.5 py-0.5 rounded text-xs bg-purple-900/30 text-purple-400">Claude</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!context && (
        <div className="px-4 py-2 bg-blue-900/20 border-b border-gray-800">
          <p className="text-xs text-blue-400">Loading Connecteam data...</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300'
            }`}>
              {msg.content.split(/(\*\*[^*]+\*\*)/).map((part, j) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return <strong key={j} className="font-semibold text-white">{part.slice(2, -2)}</strong>
                }
                return part
              })}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-xl px-3 py-2 text-sm text-gray-400 flex items-center gap-2">
              <div className="animate-spin w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full" />
              Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask anything about your operations..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </form>
    </aside>
  )
}
