import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey, fetchTimesheets, fetchTimeActivities, dateRangeWeeks } from '../lib/api'
import { getClients, getJobs, getConversations, getInvoices, getQuotes } from '../lib/store'

export default function Dashboard() {
  const [crmStats, setCrmStats] = useState(null)
  const [todayJobs, setTodayJobs] = useState([])
  const [pendingQuotes, setPendingQuotes] = useState([])
  const [newLeads, setNewLeads] = useState([])
  const [unpaidInvoices, setUnpaidInvoices] = useState([])

  // AI chat
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "What do you need? Pick a report or ask me anything." }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [weeks, setWeeks] = useState(2)
  const [cachedData, setCachedData] = useState({})
  const bottomRef = useRef(null)
  const apiKey = getApiKey()

  useEffect(() => { loadDashboard() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function loadDashboard() {
    const clients = getClients()
    const jobs = getJobs()
    const invoices = getInvoices()
    const quotes = getQuotes()
    const convos = getConversations()

    const today = new Date().toISOString().split('T')[0]
    const paidTotal = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
    const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0)

    setCrmStats({
      totalClients: clients.length,
      activeClients: clients.filter(c => c.status === 'active').length,
      leads: clients.filter(c => c.status === 'lead').length,
      totalJobs: jobs.length,
      scheduledJobs: jobs.filter(j => j.status === 'scheduled').length,
      paidTotal, outstanding,
      totalConvos: convos.length,
    })

    // Today's jobs
    setTodayJobs(jobs.filter(j => j.date === today && j.status !== 'cancelled').slice(0, 5))

    // Pending quotes (sent but not accepted)
    setPendingQuotes(quotes.filter(q => q.status === 'sent').slice(0, 5))

    // New leads
    setNewLeads(clients.filter(c => c.status === 'lead').slice(0, 5))

    // Unpaid invoices
    setUnpaidInvoices(invoices.filter(i => i.status === 'sent' || i.status === 'overdue').slice(0, 5))
  }

  // Report generation (same as before, simplified)
  async function pullEndpoint(endpoint) {
    const cacheKey = `${endpoint}_${weeks}`
    if (cachedData[cacheKey]) return cachedData[cacheKey]
    const { start, end } = dateRangeWeeks(weeks)
    let data
    if (endpoint === 'timesheets') data = await fetchTimesheets(start, end)
    else if (endpoint === 'activities') data = await fetchTimeActivities(start, end)
    const result = { data, period: { start, end } }
    setCachedData(prev => ({ ...prev, [cacheKey]: result }))
    return result
  }

  function buildContext(endpoint, result) {
    const { data, period } = result
    const lines = [`Period: ${period.start} to ${period.end}`, '']
    if (endpoint === 'timesheets') {
      for (const u of data?.data?.users || []) {
        let hours = 0, pay = 0
        for (const dr of u.dailyRecords || []) {
          const dh = (dr.totalTime || 0) / 3600; let dp = 0
          for (const pi of dr.payItems || []) dp += pi.amount || 0
          hours += dh; pay += dp
        }
        if (hours > 0) lines.push(`User ${u.userId}: ${hours.toFixed(1)}h, $${pay.toFixed(2)}, Approved: ${u.approvedState || '?'}`)
      }
    }
    if (endpoint === 'activities') {
      for (const u of data?.data?.timeActivitiesByUsers || []) {
        if (!u.shifts?.length) continue
        lines.push(`\nUser ${u.userId}:`)
        for (const s of u.shifts) {
          const st = s.startTime ? new Date(s.startTime * 1000) : null
          const en = s.endTime ? new Date(s.endTime * 1000) : null
          let mi = 0; for (const a of s.shiftAttachments || []) if (a.attachment?.number) mi += a.attachment.number
          lines.push(`  ${st?.toLocaleDateString()||'?'} ${st?.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})||''}-${en?.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})||''} | ${mi}mi | ${s.startPoint?.address || '-'}`)
        }
      }
    }
    return lines.join('\n')
  }

  async function handleReport(endpoint, prompt) {
    if (loading) return
    setMessages(prev => [...prev, { role: 'user', content: prompt }])
    setLoading(true)
    try {
      const result = await pullEndpoint(endpoint)
      const context = buildContext(endpoint, result)
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], context }),
      })
      if (res.ok) {
        const d = await res.json()
        setMessages(prev => [...prev, { role: 'assistant', content: d.content }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `Raw data:\n\`\`\`\n${context.slice(0, 2000)}\n\`\`\`` }])
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: err.message === 'RATE_LIMITED' ? 'Rate limited — wait a minute and try again.' : `Error: ${err.message}` }])
    } finally { setLoading(false) }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)
    try {
      let context = ''
      if (apiKey) { try { const r = await pullEndpoint('timesheets'); context = buildContext('timesheets', r) } catch {} }
      const crmClients = getClients()
      if (crmClients.length > 0) context += `\n\nCRM: ${crmClients.length} clients`
      const allMsgs = messages.filter(m => m.role === 'user' || m.role === 'assistant').concat({ role: 'user', content: text }).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: allMsgs, context }) })
      if (res.ok) { const d = await res.json(); setMessages(prev => [...prev, { role: 'assistant', content: d.content }]) }
      else setMessages(prev => [...prev, { role: 'assistant', content: 'Claude AI not connected — add ANTHROPIC_API_KEY to Vercel.' }])
    } catch (err) { setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]) }
    finally { setLoading(false) }
  }

  function exportLast() {
    const last = [...messages].reverse().find(m => m.role === 'assistant')
    if (!last) return
    const blob = new Blob([last.content], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `report-${new Date().toISOString().split('T')[0]}.md`; a.click()
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <span className="text-sm text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
      </div>

      {/* Stats row */}
      {crmStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Active Clients" value={crmStats.activeClients} sub={`${crmStats.leads} leads`} color="text-blue-400" />
          <StatCard label="Jobs Scheduled" value={crmStats.scheduledJobs} sub={`${crmStats.totalJobs} total`} color="text-purple-400" />
          <StatCard label="Revenue" value={`$${crmStats.paidTotal.toFixed(0)}`} sub={`$${crmStats.outstanding.toFixed(0)} outstanding`} color="text-green-400" />
          <StatCard label="Messages" value={crmStats.totalConvos} color="text-gray-400" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Left: Action items (2 cols) */}
        <div className="xl:col-span-2 space-y-4">
          {/* Today's jobs */}
          <ActionPanel title="Today's Jobs" icon="📅" count={todayJobs.length} emptyText="No jobs today" linkTo="/schedule">
            {todayJobs.map(j => (
              <div key={j.id} className="flex items-center justify-between py-1.5">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{j.title}</p>
                  <p className="text-xs text-gray-500">{j.clientName} {j.startTime ? `@ ${j.startTime}` : ''}</p>
                </div>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs ${j.status === 'completed' ? 'bg-green-900/30 text-green-400' : 'bg-blue-900/30 text-blue-400'}`}>{j.status}</span>
              </div>
            ))}
          </ActionPanel>

          {/* New leads */}
          <ActionPanel title="New Leads" icon="🔔" count={newLeads.length} emptyText="No new leads" linkTo="/pipeline">
            {newLeads.map(c => (
              <Link key={c.id} to={`/clients/${c.id}`} className="flex items-center justify-between py-1.5 hover:bg-gray-800/50 rounded -mx-1 px-1">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.source || 'Direct'} {c.email ? `· ${c.email}` : ''}</p>
                </div>
                <span className="shrink-0 text-xs text-gray-600">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''}</span>
              </Link>
            ))}
          </ActionPanel>

          {/* Pending quotes */}
          <ActionPanel title="Awaiting Response" icon="📨" count={pendingQuotes.length} emptyText="No pending quotes" linkTo="/pipeline">
            {pendingQuotes.map(q => (
              <div key={q.id} className="flex items-center justify-between py-1.5">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{q.quoteNumber}</p>
                  <p className="text-xs text-gray-500">${q.finalPrice || q.estimateMax} · {q.frequency}</p>
                </div>
                <span className="shrink-0 text-xs text-yellow-400">{q.sentAt ? `${Math.floor((Date.now() - new Date(q.sentAt)) / 86400000)}d ago` : ''}</span>
              </div>
            ))}
          </ActionPanel>

          {/* Unpaid invoices */}
          <ActionPanel title="Unpaid Invoices" icon="💳" count={unpaidInvoices.length} emptyText="All paid up!" linkTo="/invoices">
            {unpaidInvoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between py-1.5">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{inv.clientName}</p>
                  <p className="text-xs text-gray-500">{inv.invoiceNumber} · due {inv.dueDate || 'N/A'}</p>
                </div>
                <span className={`shrink-0 font-mono text-sm ${inv.status === 'overdue' ? 'text-red-400' : 'text-yellow-400'}`}>${inv.total?.toFixed(0)}</span>
              </div>
            ))}
          </ActionPanel>
        </div>

        {/* Right: AI chat (3 cols) */}
        <div className="xl:col-span-3 bg-gray-900 border border-gray-800 rounded-xl flex flex-col" style={{ minHeight: '400px', maxHeight: '700px' }}>
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">AI Reports</span>
              <span className="px-1.5 py-0.5 rounded text-xs bg-purple-900/30 text-purple-400">Claude</span>
            </div>
            <div className="flex items-center gap-2">
              <select value={weeks} onChange={e => { setWeeks(Number(e.target.value)); setCachedData({}) }}
                className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-400">
                <option value={1}>1 wk</option><option value={2}>2 wk</option><option value={4}>4 wk</option>
              </select>
              {messages.length > 1 && (
                <>
                  <button onClick={() => { const l = [...messages].reverse().find(m => m.role === 'assistant'); if (l) navigator.clipboard.writeText(l.content) }}
                    title="Copy" className="p-1 text-gray-500 hover:text-gray-300">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
                  </button>
                  <button onClick={exportLast} title="Export" className="p-1 text-gray-500 hover:text-gray-300">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  </button>
                  <button onClick={() => { setMessages([{ role: 'assistant', content: 'Fresh start! What do you need?' }]); setCachedData({}) }}
                    title="Clear" className="p-1 text-gray-500 hover:text-gray-300">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                  msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'
                }`}>
                  {msg.content.split(/(\*\*[^*]+\*\*)/).map((part, j) => {
                    if (part.startsWith('**') && part.endsWith('**')) return <strong key={j} className="font-semibold text-white">{part.slice(2, -2)}</strong>
                    return part
                  })}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-gray-400 flex items-center gap-2">
                  <div className="animate-spin w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full" /> Generating...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Report buttons */}
          {!loading && apiKey && (
            <div className="px-4 pb-2 shrink-0">
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => handleReport('timesheets', 'Quick weekly rundown: hours and pay per employee.')}
                  className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400 hover:text-gray-200">Hours & Pay</button>
                <button onClick={() => handleReport('activities', 'Mileage breakdown per employee with reimbursement.')}
                  className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400 hover:text-gray-200">Mileage</button>
                <button onClick={() => handleReport('timesheets', 'Payroll prep: hours, rate, gross pay per employee.')}
                  className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400 hover:text-gray-200">Payroll</button>
                <button onClick={() => handleReport('activities', 'All shifts today with locations and notes.')}
                  className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400 hover:text-gray-200">Shifts</button>
              </div>
            </div>
          )}

          <form onSubmit={e => { e.preventDefault(); handleSend() }} className="p-3 border-t border-gray-800 shrink-0">
            <div className="flex gap-2">
              <input value={input} onChange={e => setInput(e.target.value)} disabled={loading}
                placeholder="Ask anything..." className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
              <button type="submit" disabled={loading || !input.trim()}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}

function ActionPanel({ title, icon, count, emptyText, linkTo, children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className="text-sm font-medium text-white">{title}</span>
          {count > 0 && <span className="px-1.5 py-0.5 bg-blue-900/30 text-blue-400 rounded text-xs">{count}</span>}
        </div>
        {linkTo && <Link to={linkTo} className="text-xs text-gray-500 hover:text-gray-300">View all</Link>}
      </div>
      {count > 0 ? (
        <div className="space-y-0.5">{children}</div>
      ) : (
        <p className="text-xs text-gray-600 py-2">{emptyText}</p>
      )}
    </div>
  )
}
