import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey, setApiKey, fetchUsers, fetchTimesheets, fetchTimeActivities, fetchShifts, dateRangeWeeks } from '../lib/api'
import { getClients, getJobs, getConversations, getInvoices } from '../lib/store'
import MetricCard from '../components/MetricCard'

const QUICK_PROMPTS = [
  { label: 'Weekly rundown', prompt: 'Give me a quick weekly rundown — hours, pay, mileage per employee. Flag anything unusual.' },
  { label: 'Payroll prep', prompt: 'Prepare payroll: hours, pay, reimbursable mileage (over 35mi threshold at $0.70/mi), and total comp per employee.' },
  { label: 'Who worked today?', prompt: 'Who clocked in today? Show their hours, locations, and any notes.' },
  { label: 'Attendance issues', prompt: 'Any attendance issues? Late arrivals, no-shows, rejected shifts?' },
  { label: 'Mileage breakdown', prompt: 'Mileage breakdown per employee with reimbursement calculations.' },
  { label: 'Unapproved timesheets', prompt: 'Which timesheets are unapproved or unsubmitted?' },
]

export default function Dashboard() {
  const [apiKey, setApiKeyState] = useState(getApiKey())
  const [crmStats, setCrmStats] = useState(null)
  const [showKeyInput, setShowKeyInput] = useState(false)

  // Chat state
  const [messages, setMessages] = useState([
    { role: 'assistant', content: apiKey
      ? "Hey! I can pull your Connecteam data and generate reports. Pick a quick prompt below or type your own question."
      : "Hey! Set your Connecteam API key in Settings to pull employee data. In the meantime, I can help with CRM questions — ask about clients, jobs, or invoices." }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [weeks, setWeeks] = useState(2)
  const bottomRef = useRef(null)
  const dataRef = useRef(null) // cached connecteam data

  function saveKey(e) {
    e.preventDefault()
    const key = e.target.elements.key.value.trim()
    if (key) { setApiKey(key); setApiKeyState(key); setShowKeyInput(false) }
  }

  useEffect(() => { loadCrmStats() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function loadCrmStats() {
    const clients = getClients()
    const jobs = getJobs()
    const convos = getConversations()
    const invoices = getInvoices()
    const paidTotal = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
    const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0)
    setCrmStats({
      totalClients: clients.length, activeClients: clients.filter(c => c.status === 'active').length,
      leads: clients.filter(c => c.status === 'lead').length, prospects: clients.filter(c => c.status === 'prospect').length,
      totalJobs: jobs.length, scheduledJobs: jobs.filter(j => j.status === 'scheduled').length,
      completedJobs: jobs.filter(j => j.status === 'completed').length, totalConvos: convos.length,
      paidTotal, outstanding, recentClients: clients.slice(0, 5), recentJobs: jobs.slice(0, 5),
    })
  }

  async function pullConnecteamData() {
    if (dataRef.current) return dataRef.current
    if (!getApiKey()) return null
    setMessages(prev => [...prev, { role: 'system', content: 'Pulling data from Connecteam... (~10 sec)' }])

    const { start, end } = dateRangeWeeks(weeks)
    const users = await fetchUsers()
    const timesheets = await fetchTimesheets(start, end)
    const activities = await fetchTimeActivities(start, end)
    let shifts = null
    try { shifts = await fetchShifts(start, end) } catch {}

    const data = { users, timesheets, activities, shifts, period: { start, end } }
    dataRef.current = data
    setDataLoaded(true)
    return data
  }

  function buildContext(data) {
    const { users, timesheets, activities, shifts, period } = data
    const lines = [`Period: ${period.start} to ${period.end}`, '']

    const tsUsers = timesheets.data?.users || []
    lines.push('=== TIMESHEET DATA ===')
    for (const u of tsUsers) {
      const info = users[u.userId] || { name: `User ${u.userId}` }
      let hours = 0, pay = 0
      const daily = []
      for (const dr of u.dailyRecords || []) {
        const dh = (dr.totalTime || 0) / 3600
        let dp = 0; for (const pi of dr.payItems || []) dp += pi.amount || 0
        hours += dh; pay += dp
        if (dh > 0) daily.push(`  ${dr.date}: ${dh.toFixed(1)}h, $${dp.toFixed(2)}`)
      }
      if (hours > 0) {
        lines.push(`\n${info.name} (${info.title || '-'}): ${hours.toFixed(1)}h, $${pay.toFixed(2)}, Approved: ${u.approvedState || '?'}, Submitted: ${u.submittedState || '?'}`)
        lines.push(...daily)
      }
    }

    const actUsers = activities.data?.timeActivitiesByUsers || []
    lines.push('\n=== SHIFTS (clock in/out, mileage, locations) ===')
    for (const u of actUsers) {
      const info = users[u.userId] || { name: `User ${u.userId}` }
      if (!u.shifts?.length) continue
      lines.push(`\n${info.name}:`)
      for (const s of u.shifts) {
        const st = s.startTime ? new Date(s.startTime * 1000) : null
        const en = s.endTime ? new Date(s.endTime * 1000) : null
        const hrs = st && en ? ((s.endTime - s.startTime) / 3600).toFixed(1) : '?'
        let mi = 0; for (const a of s.shiftAttachments || []) if (a.attachment?.number) mi += a.attachment.number
        const loc = s.startPoint?.address || '-'
        const notes = [s.startNote, s.endNote].filter(Boolean).join(' | ')
        lines.push(`  ${st?.toLocaleDateString()||'?'} ${st?.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})||''}-${en?.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})||''} | ${hrs}h | ${mi}mi | ${loc}${notes ? ` | ${notes}` : ''}`)
      }
    }

    if (shifts?.data?.objects?.length) {
      lines.push('\n=== SCHEDULE ===')
      for (const s of shifts.data.objects) {
        const st = new Date(s.startTime * 1000), en = new Date(s.endTime * 1000)
        const assignees = (s.assignees || []).map(a => `${users[a.userId]?.name||a.userId} (${a.status}${a.rejectionReason?': '+a.rejectionReason:''})`).join(', ')
        lines.push(`${st.toLocaleDateString()} ${st.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}-${en.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} | ${s.title||'Shift'}${s.openShift?' [OPEN]':''} | ${assignees||'unassigned'}`)
      }
    }
    return lines.join('\n')
  }

  async function handleSend(prompt) {
    const text = (prompt || input).trim()
    if (!text || loading) return
    if (!prompt) setInput('')

    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const data = await pullConnecteamData()
      const context = data ? buildContext(data) : 'Connecteam API key not set. No employee data available. CRM data may be available.'

      // Try Claude API
      const allMessages = [...messages.filter(m => m.role !== 'system'), { role: 'user', content: text }]
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages, context }),
      })

      if (res.ok) {
        const result = await res.json()
        setMessages(prev => prev.filter(m => m.role !== 'system').concat({ role: 'assistant', content: result.content }))
      } else {
        setMessages(prev => prev.filter(m => m.role !== 'system').concat({
          role: 'assistant',
          content: '_Claude API not connected. Add ANTHROPIC_API_KEY to Vercel env vars._\n\nData was pulled successfully though — here\'s a raw summary:\n\n' + context.slice(0, 2000)
        }))
      }
    } catch (err) {
      setMessages(prev => prev.filter(m => m.role !== 'system').concat({ role: 'assistant', content: `Error: ${err.message}` }))
    } finally {
      setLoading(false)
    }
  }

  function handleExport() {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant) return
    const blob = new Blob([lastAssistant.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${new Date().toISOString().split('T')[0]}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleCopy() {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    if (lastAssistant) navigator.clipboard.writeText(lastAssistant.content)
  }

  function clearChat() {
    setMessages([{ role: 'assistant', content: "Fresh start! Pick a quick prompt or ask me anything about your operations." }])
    dataRef.current = null
    setDataLoaded(false)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Your operations at a glance</p>
      </div>

      {/* CRM stats */}
      {crmStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Clients" value={crmStats.totalClients} sub={`${crmStats.activeClients} active, ${crmStats.leads} leads`} color="purple" />
          <MetricCard label="Jobs" value={crmStats.totalJobs} sub={`${crmStats.scheduledJobs} scheduled, ${crmStats.completedJobs} done`} color="blue" />
          <MetricCard label="Revenue" value={`$${crmStats.paidTotal.toFixed(0)}`} sub={`$${crmStats.outstanding.toFixed(0)} outstanding`} color="green" />
          <MetricCard label="Messages" value={crmStats.totalConvos} sub="conversations" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Chat widget — takes 2 columns */}
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl flex flex-col" style={{ height: '520px' }}>
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <span className="text-sm font-semibold text-white">AI Reports</span>
              <span className="px-1.5 py-0.5 rounded text-xs bg-purple-900/30 text-purple-400">Claude</span>
              {dataLoaded && <span className="px-1.5 py-0.5 rounded text-xs bg-green-900/30 text-green-400">data loaded</span>}
            </div>
            <div className="flex items-center gap-2">
              <select value={weeks} onChange={e => { setWeeks(Number(e.target.value)); dataRef.current = null; setDataLoaded(false) }}
                className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-400 focus:outline-none">
                <option value={1}>1 week</option>
                <option value={2}>2 weeks</option>
                <option value={4}>4 weeks</option>
              </select>
              {messages.length > 1 && (
                <>
                  <button onClick={handleCopy} title="Copy last response"
                    className="p-1 text-gray-500 hover:text-gray-300 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                  </button>
                  <button onClick={handleExport} title="Export as .md"
                    className="p-1 text-gray-500 hover:text-gray-300 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                  </button>
                  <button onClick={clearChat} title="Clear chat"
                    className="p-1 text-gray-500 hover:text-gray-300 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                  msg.role === 'user' ? 'bg-blue-600 text-white' :
                  msg.role === 'system' ? 'bg-gray-800/50 text-gray-500 italic text-xs' :
                  'bg-gray-800 text-gray-300'
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
                <div className="bg-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-gray-400 flex items-center gap-2">
                  <div className="animate-spin w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full" />
                  {dataLoaded ? 'Generating report...' : 'Pulling Connecteam data...'}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts */}
          {messages.length <= 2 && !loading && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
              {QUICK_PROMPTS.map(qp => (
                <button key={qp.label} onClick={() => handleSend(qp.prompt)}
                  className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors">
                  {qp.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form onSubmit={e => { e.preventDefault(); handleSend() }} className="p-3 border-t border-gray-800 shrink-0">
            <div className="flex gap-2">
              <input value={input} onChange={e => setInput(e.target.value)}
                placeholder="Ask about hours, pay, mileage, attendance..."
                disabled={loading}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
              <button type="submit" disabled={loading || !input.trim()}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
          </form>
        </div>

        {/* Right column — quick actions + recent */}
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Quick Actions</h3>
            <div className="space-y-1.5">
              {[
                { to: '/clients', label: 'Manage Clients', color: 'bg-purple-500' },
                { to: '/communications', label: 'Messages', color: 'bg-green-500' },
                { to: '/schedule', label: 'Schedule', color: 'bg-blue-500' },
                { to: '/invoices', label: 'Invoices', color: 'bg-yellow-500' },
                { to: '/payroll', label: 'Payroll', color: 'bg-orange-500' },
                { to: '/reports', label: 'Full Reports Page', color: 'bg-purple-500' },
              ].map(item => (
                <Link key={item.to} to={item.to}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors">
                  <span className={`w-1.5 h-1.5 rounded-full ${item.color}`} />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {crmStats && crmStats.recentClients.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Recent Clients</h2>
              <div className="space-y-1.5">
                {crmStats.recentClients.map(c => (
                  <Link key={c.id} to={`/clients/${c.id}`}
                    className="flex items-center justify-between text-sm hover:bg-gray-800/50 rounded px-1 py-0.5 -mx-1 transition-colors">
                    <span className="text-gray-300">{c.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      c.status === 'active' ? 'bg-green-900/40 text-green-400' :
                      c.status === 'lead' ? 'bg-blue-900/40 text-blue-400' :
                      'bg-gray-800 text-gray-400'
                    }`}>{c.status}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {crmStats && crmStats.recentJobs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Recent Jobs</h2>
              <div className="space-y-1.5">
                {crmStats.recentJobs.map(j => (
                  <div key={j.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300 truncate">{j.title}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs ${
                      j.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                      j.status === 'scheduled' ? 'bg-blue-900/30 text-blue-400' :
                      'bg-gray-800 text-gray-400'
                    }`}>{j.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
