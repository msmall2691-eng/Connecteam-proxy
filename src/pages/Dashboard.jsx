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
  const [recentMessages, setRecentMessages] = useState([])

  // AI chat
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Pick a report or ask a question." }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [weeks, setWeeks] = useState(2)
  const [cachedData, setCachedData] = useState({})
  const bottomRef = useRef(null)
  const apiKey = getApiKey()

  useEffect(() => {
    loadDashboard()
    fetch('/api/gmail?action=profile').catch(() => {})
    fetch('/api/calendar?action=calendars').catch(() => {})
  }, [])
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

    setTodayJobs(jobs.filter(j => j.date === today && j.status !== 'cancelled').slice(0, 5))
    setPendingQuotes(quotes.filter(q => q.status === 'sent').slice(0, 5))
    setNewLeads(clients.filter(c => c.status === 'lead').slice(0, 5))
    setUnpaidInvoices(invoices.filter(i => i.status === 'sent' || i.status === 'overdue').slice(0, 5))

    // Recent messages from conversations
    const allMsgs = []
    for (const c of convos) {
      const client = clients.find(cl => cl.id === c.clientId)
      if (c.messages?.length > 0) {
        const last = c.messages[c.messages.length - 1]
        allMsgs.push({ ...last, clientName: client?.name || 'Unknown', channel: c.channel, subject: c.subject })
      }
    }
    allMsgs.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    setRecentMessages(allMsgs.slice(0, 5))
  }

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
          for (const pi of dr.payItems || []) dp += pi.amount || 0; hours += dh; pay += dp
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

      // Try AI first
      try {
        const res = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], context }),
        })
        if (res.ok) {
          const d = await res.json()
          setMessages(prev => [...prev, { role: 'assistant', content: d.content }])
          setLoading(false)
          return
        }
      } catch {}

      // Fallback: show raw data
      setMessages(prev => [...prev, { role: 'assistant', content: context.length > 50 ? `Here's the data:\n\n${context.slice(0, 3000)}` : 'No data found for this period. Try a different time range.' }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: err.message === 'RATE_LIMITED' ? 'Connecteam rate limited — wait a minute.' : `Error pulling data: ${err.message}. Make sure your Connecteam API key is set in Settings.` }])
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

      try {
        const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: allMsgs, context }) })
        if (res.ok) { const d = await res.json(); setMessages(prev => [...prev, { role: 'assistant', content: d.content }]); setLoading(false); return }
      } catch {}

      setMessages(prev => [...prev, { role: 'assistant', content: 'AI not connected. Add OPENAI_API_KEY to Vercel env vars. In the meantime, use the report buttons above to pull Connecteam data directly.' }])
    } catch (err) { setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]) }
    finally { setLoading(false) }
  }

  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  }

  function exportMonthlyReport(period) {
    const now = new Date()
    const year = period === 'last' ? (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()) : now.getFullYear()
    const month = period === 'last' ? (now.getMonth() === 0 ? 11 : now.getMonth() - 1) : now.getMonth()
    const monthName = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })
    const jobs = getJobs(); const invoices = getInvoices(); const clients = getClients()
    const monthJobs = jobs.filter(j => { const d = new Date(j.date); return d.getMonth() === month && d.getFullYear() === year })
    const monthInvoices = invoices.filter(i => { const d = new Date(i.issueDate); return d.getMonth() === month && d.getFullYear() === year })
    const revenue = monthInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
    let report = `# Monthly Report — ${monthName}\n\n- Jobs: ${monthJobs.length}\n- Revenue: $${revenue.toFixed(2)}\n- Invoices: ${monthInvoices.length}\n`
    if (monthJobs.length > 0) { report += `\n## Jobs\n`; monthJobs.forEach(j => { report += `- ${j.date} | ${j.title} | ${j.clientName || '-'} | ${j.status}\n` }) }
    downloadFile(report, `report-${year}-${String(month + 1).padStart(2, '0')}.md`)
  }

  function exportClientList() {
    let csv = 'Name,Email,Phone,Address,Status,Type\n'
    getClients().forEach(c => { csv += `"${c.name}","${c.email || ''}","${c.phone || ''}","${c.address || ''}","${c.status}","${c.type}"\n` })
    const blob = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `clients.csv`; a.click()
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold text-white">Dashboard</h1>
        <span className="text-xs text-gray-500 hidden md:block">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      </div>

      {/* Stats */}
      {crmStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Clients" value={crmStats.activeClients} sub={`${crmStats.leads} leads`} color="text-blue-400" />
          <StatCard label="Scheduled" value={crmStats.scheduledJobs} sub={`${crmStats.totalJobs} total`} color="text-purple-400" />
          <StatCard label="Revenue" value={`$${crmStats.paidTotal.toFixed(0)}`} sub={`$${crmStats.outstanding.toFixed(0)} owed`} color="text-green-400" />
          <StatCard label="Messages" value={crmStats.totalConvos} color="text-gray-400" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Left column: action panels */}
        <div className="xl:col-span-1 space-y-4">
          <ActionPanel title="Today" icon="📅" count={todayJobs.length} emptyText="No jobs today" linkTo="/schedule">
            {todayJobs.map(j => (
              <div key={j.id} className="flex justify-between py-1"><span className="text-sm text-white truncate">{j.title}</span><span className="text-xs text-gray-500 shrink-0 ml-2">{j.startTime || ''}</span></div>
            ))}
          </ActionPanel>

          <ActionPanel title="Leads" icon="🔔" count={newLeads.length} emptyText="No new leads" linkTo="/pipeline">
            {newLeads.map(c => (
              <Link key={c.id} to={`/clients/${c.id}`} className="flex justify-between py-1 hover:bg-gray-800/50 rounded -mx-1 px-1">
                <span className="text-sm text-white truncate">{c.name}</span><span className="text-xs text-gray-600 shrink-0 ml-2">{c.source || ''}</span>
              </Link>
            ))}
          </ActionPanel>

          <ActionPanel title="Unpaid" icon="💳" count={unpaidInvoices.length} emptyText="All paid!" linkTo="/invoices">
            {unpaidInvoices.map(inv => (
              <div key={inv.id} className="flex justify-between py-1">
                <span className="text-sm text-white truncate">{inv.clientName}</span>
                <span className={`text-sm font-mono shrink-0 ml-2 ${inv.status === 'overdue' ? 'text-red-400' : 'text-yellow-400'}`}>${inv.total?.toFixed(0)}</span>
              </div>
            ))}
          </ActionPanel>

          <ActionPanel title="Recent Messages" icon="💬" count={recentMessages.length} emptyText="No messages" linkTo="/communications">
            {recentMessages.map((msg, i) => (
              <div key={i} className="py-1">
                <div className="flex justify-between"><span className="text-sm text-white truncate">{msg.clientName}</span>
                  <span className={`text-xs shrink-0 ml-2 px-1 py-0.5 rounded ${msg.channel === 'email' ? 'bg-blue-900/30 text-blue-400' : msg.channel === 'text' ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-400'}`}>{msg.channel}</span></div>
                <p className="text-xs text-gray-600 truncate">{msg.content?.slice(0, 60)}</p>
              </div>
            ))}
          </ActionPanel>

          {/* Quick exports */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-2">Exports</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => exportMonthlyReport('current')} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300">This Month</button>
              <button onClick={() => exportMonthlyReport('last')} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300">Last Month</button>
              <button onClick={exportClientList} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300">Clients CSV</button>
              <Link to="/revenue" className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300 text-center">Revenue</Link>
            </div>
          </div>
        </div>

        {/* Right: AI chat (2 cols) */}
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl flex flex-col" style={{ minHeight: '400px', maxHeight: '600px' }}>
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between shrink-0">
            <span className="text-sm font-semibold text-white">AI Reports</span>
            <div className="flex items-center gap-2">
              <select value={weeks} onChange={e => { setWeeks(Number(e.target.value)); setCachedData({}) }}
                className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-400">
                <option value={1}>1w</option><option value={2}>2w</option><option value={4}>4w</option>
              </select>
              {messages.length > 1 && (
                <button onClick={() => { setMessages([{ role: 'assistant', content: 'Ready. Pick a report or ask a question.' }]); setCachedData({}) }}
                  className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'
                }`}>
                  {msg.content.split(/(\*\*[^*]+\*\*)/).map((part, j) => {
                    if (part.startsWith('**') && part.endsWith('**')) return <strong key={j} className="font-semibold text-white">{part.slice(2, -2)}</strong>
                    return part
                  })}
                </div>
              </div>
            ))}
            {loading && <div className="flex justify-start"><div className="bg-gray-800 rounded-xl px-3 py-2 text-sm text-gray-400 flex items-center gap-2"><div className="animate-spin w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full" /> Working...</div></div>}
            <div ref={bottomRef} />
          </div>

          {!loading && apiKey && (
            <div className="px-3 pb-1.5 shrink-0 flex flex-wrap gap-1">
              <button onClick={() => handleReport('timesheets', 'Hours and pay per employee.')} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400">Hours</button>
              <button onClick={() => handleReport('activities', 'Mileage per employee.')} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400">Mileage</button>
              <button onClick={() => handleReport('timesheets', 'Payroll prep.')} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400">Payroll</button>
              <button onClick={() => handleReport('activities', 'Shifts with locations.')} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400">Shifts</button>
            </div>
          )}

          <form onSubmit={e => { e.preventDefault(); handleSend() }} className="p-2.5 border-t border-gray-800 shrink-0">
            <div className="flex gap-2">
              <input value={input} onChange={e => setInput(e.target.value)} disabled={loading}
                placeholder="Ask anything..." className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
              <button type="submit" disabled={loading || !input.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm text-white">
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
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{icon}</span>
          <span className="text-sm font-medium text-white">{title}</span>
          {count > 0 && <span className="px-1.5 py-0.5 bg-blue-900/30 text-blue-400 rounded text-xs">{count}</span>}
        </div>
        {linkTo && <Link to={linkTo} className="text-xs text-gray-600 hover:text-gray-300">View</Link>}
      </div>
      {count > 0 ? <div className="space-y-0.5">{children}</div> : <p className="text-xs text-gray-700">{emptyText}</p>}
    </div>
  )
}

