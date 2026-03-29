import { useState, useRef, useEffect } from 'react'
import { getApiKey, fetchUsers, fetchTimesheets, fetchTimeActivities, fetchShifts, dateRangeWeeks } from '../lib/api'

const SYSTEM_PROMPT = `You are a helpful operations assistant for a cleaning company. You have access to employee timesheet data, schedules, and mileage info from Connecteam. Answer questions about hours, pay, attendance, schedules, and mileage. Be concise and direct.`

export default function AgentChat({ onClose }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hey! I'm your operations assistant. I can pull data from Connecteam and give you a rundown on hours, pay, schedules, mileage, and attendance. What do you want to know?" }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load context data on mount
  useEffect(() => {
    loadContext()
  }, [])

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
      console.error('Failed to load context:', err)
    }
  }

  function buildContextSummary() {
    if (!context) return 'Data is still loading...'

    const { users, timesheets, activities, period } = context
    const tsUsers = timesheets.data?.users || []
    const lines = [`Data period: ${period.start} to ${period.end}`, '']

    for (const u of tsUsers) {
      const info = users[u.userId] || { name: `User ${u.userId}` }
      let hours = 0, pay = 0
      for (const dr of u.dailyRecords || []) {
        hours += (dr.totalTime || 0) / 3600
        for (const pi of dr.payItems || []) pay += pi.amount || 0
      }
      if (hours > 0) {
        lines.push(`${info.name}: ${hours.toFixed(1)}h, $${pay.toFixed(2)}, ${u.approvedState || 'unknown'}`)
      }
    }

    const actUsers = activities.data?.timeActivitiesByUsers || []
    let totalMiles = 0
    for (const u of actUsers) {
      for (const shift of u.shifts || []) {
        for (const att of shift.shiftAttachments || []) {
          if (att.attachment?.number) totalMiles += att.attachment.number
        }
      }
    }
    lines.push('', `Total miles logged: ${totalMiles.toFixed(0)}`)

    return lines.join('\n')
  }

  async function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      // Build a local AI response based on the data context
      const summary = buildContextSummary()
      const response = generateLocalResponse(text, summary)
      setMessages(prev => [...prev, { role: 'assistant', content: response }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  function generateLocalResponse(question, dataSummary) {
    const q = question.toLowerCase()

    // Parse the data for answering
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

    // Match common questions
    if (q.includes('rundown') || q.includes('summary') || q.includes('overview') || q.includes('how are we') || q.includes('what\'s going on')) {
      let resp = `**${period.start} to ${period.end}**\n\n`
      resp += `- **${employees.length}** employees worked\n`
      resp += `- **${totalHours.toFixed(1)}** total hours\n`
      resp += `- **$${totalPay.toFixed(2)}** total pay\n`
      resp += `- **${totalMiles.toFixed(0)}** miles logged\n`
      if (unapproved.length > 0) {
        resp += `\n**Needs attention:** ${unapproved.length} timesheet(s) not yet approved: ${unapproved.map(e => e.name).join(', ')}`
      } else {
        resp += `\nAll timesheets are approved.`
      }
      return resp
    }

    if (q.includes('hours') || q.includes('who worked')) {
      let resp = `**Hours breakdown (${period.start} to ${period.end}):**\n\n`
      for (const e of employees) {
        resp += `- **${e.name}**: ${e.hours}h ($${e.pay})\n`
      }
      resp += `\n**Total: ${totalHours.toFixed(1)}h / $${totalPay.toFixed(2)}**`
      return resp
    }

    if (q.includes('mile') || q.includes('mileage') || q.includes('driving')) {
      let resp = `**Mileage (${period.start} to ${period.end}):**\n\n`
      resp += `Total miles logged: **${totalMiles.toFixed(0)}**\n\n`

      const milesByUser = {}
      for (const u of actUsers) {
        const info = users[u.userId] || { name: `User ${u.userId}` }
        let m = 0
        for (const shift of u.shifts || []) {
          for (const att of shift.shiftAttachments || []) {
            if (att.attachment?.number) m += att.attachment.number
          }
        }
        if (m > 0) milesByUser[info.name] = m
      }
      for (const [name, miles] of Object.entries(milesByUser).sort((a, b) => b[1] - a[1])) {
        resp += `- **${name}**: ${miles.toFixed(0)} mi\n`
      }
      return resp
    }

    if (q.includes('approv') || q.includes('pending') || q.includes('unapproved')) {
      if (unapproved.length === 0) return 'All timesheets are approved!'
      let resp = `**${unapproved.length} pending timesheet(s):**\n\n`
      for (const e of unapproved) {
        resp += `- **${e.name}**: ${e.hours}h / $${e.pay}\n`
      }
      return resp
    }

    if (q.includes('pay') || q.includes('wage') || q.includes('earn') || q.includes('money') || q.includes('cost')) {
      let resp = `**Pay breakdown (${period.start} to ${period.end}):**\n\n`
      for (const e of employees) {
        const rate = e.hours > 0 ? (e.pay / e.hours).toFixed(2) : '0'
        resp += `- **${e.name}**: $${e.pay} (${e.hours}h @ ~$${rate}/hr)\n`
      }
      resp += `\n**Total payroll: $${totalPay.toFixed(2)}**`
      return resp
    }

    // Specific employee search
    const nameMatch = employees.find(e => q.includes(e.name.toLowerCase().split(' ')[0].toLowerCase()))
    if (nameMatch) {
      const rate = nameMatch.hours > 0 ? (nameMatch.pay / nameMatch.hours).toFixed(2) : '0'
      return `**${nameMatch.name}** (${period.start} to ${period.end}):\n- Hours: ${nameMatch.hours}\n- Pay: $${nameMatch.pay}\n- Rate: ~$${rate}/hr\n- Approved: ${nameMatch.approved ? 'Yes' : 'No'}`
    }

    // Fallback
    return `Here's what I know for **${period.start} to ${period.end}**:\n\n` +
      `- ${employees.length} employees, ${totalHours.toFixed(1)} total hours, $${totalPay.toFixed(2)} total pay, ${totalMiles.toFixed(0)} miles\n\n` +
      `Try asking about: **hours**, **pay**, **mileage**, **approvals**, **summary**, or a specific employee name.`
  }

  return (
    <aside className="w-96 bg-gray-900 border-l border-gray-800 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">AI Agent</h2>
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
            <div className="bg-gray-800 rounded-xl px-3 py-2 text-sm text-gray-400">
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
            placeholder="Ask about hours, pay, schedule..."
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
