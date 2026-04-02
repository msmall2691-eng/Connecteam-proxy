import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey, fetchTimesheets, fetchTimeActivities, dateRangeWeeks } from '../lib/api'
import {
  getClients, getClientsAsync, getJobs, getJobsAsync,
  getConversations, getConversationsAsync, getInvoices, getInvoicesAsync,
  getQuotes, getQuotesAsync, getProperties, getPropertiesAsync,
} from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [pendingBookings, setPendingBookings] = useState([])
  const [pendingCount, setPendingCount] = useState(0)

  // AI chat (compact)
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'Ask me anything about your operations.' }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [weeks, setWeeks] = useState(2)
  const [cachedData, setCachedData] = useState({})
  const bottomRef = useRef(null)
  const apiKey = getApiKey()

  useEffect(() => { loadDashboard(); loadPendingBookings() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function loadDashboard() {
    let clients, jobs, invoices, quotes, convos, properties
    if (isSupabaseConfigured()) {
      ;[clients, jobs, invoices, quotes, convos, properties] = await Promise.all([
        getClientsAsync(), getJobsAsync(), getInvoicesAsync(),
        getQuotesAsync(), getConversationsAsync(), getPropertiesAsync(),
      ])
    } else {
      clients = getClients(); jobs = getJobs(); invoices = getInvoices()
      quotes = getQuotes(); convos = getConversations(); properties = getProperties()
    }

    const today = new Date().toISOString().split('T')[0]
    const paidTotal = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
    const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0)

    // Jobs needing calendar push
    const unpushedJobs = jobs.filter(j => j.status === 'scheduled' && j.date >= today && !j.googleEventId).slice(0, 8)
    // Jobs needing Connecteam push
    const unpushedCT = jobs.filter(j => j.status === 'scheduled' && j.date >= today && !j.connecteamShiftId).slice(0, 8)
    // Quotes to send or follow up
    const draftQuotes = quotes.filter(q => q.status === 'draft').slice(0, 5)
    const sentQuotes = quotes.filter(q => q.status === 'sent').slice(0, 5)
    const acceptedQuotes = quotes.filter(q => q.status === 'accepted' || q.status === 'signed')
    // Today
    const todayJobs = jobs.filter(j => j.date === today && j.status !== 'cancelled')
    // Upcoming this week
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
    const weekStr = weekEnd.toISOString().split('T')[0]
    const thisWeekJobs = jobs.filter(j => j.date >= today && j.date <= weekStr && j.status === 'scheduled')
    // New leads
    const leads = clients.filter(c => c.status === 'lead').slice(0, 5)
    // Unpaid
    const unpaid = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').slice(0, 5)
    // Messages
    const recentMsgs = []
    for (const c of convos) {
      const cl = clients.find(x => x.id === c.clientId)
      if (c.messages?.length > 0) {
        const last = c.messages[c.messages.length - 1]
        recentMsgs.push({ ...last, clientName: cl?.name || 'Unknown', channel: c.channel })
      }
    }
    recentMsgs.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))

    // Workflow funnel stats
    const workflow = {
      leads: clients.filter(c => c.status === 'lead').length,
      quoted: clients.filter(c => c.status === 'prospect').length,
      active: clients.filter(c => c.status === 'active').length,
      totalQuotes: quotes.length,
      draftQuotes: quotes.filter(q => q.status === 'draft').length,
      sentQuotes: quotes.filter(q => q.status === 'sent').length,
      acceptedQuotes: acceptedQuotes.length,
      scheduledJobs: jobs.filter(j => j.status === 'scheduled').length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      draftInvoices: invoices.filter(i => i.status === 'draft').length,
      sentInvoices: invoices.filter(i => i.status === 'sent').length,
      paidInvoices: invoices.filter(i => i.status === 'paid').length,
      overdueInvoices: invoices.filter(i => i.status === 'overdue').length,
      totalProperties: properties.length,
    }

    setData({
      stats: { clients: clients.length, active: clients.filter(c => c.status === 'active').length, leads: leads.length, scheduled: thisWeekJobs.length, paidTotal, outstanding },
      workflow,
      todayJobs, thisWeekJobs, unpushedJobs, unpushedCT, draftQuotes, sentQuotes, leads, unpaid,
      recentMsgs: recentMsgs.slice(0, 4),
    })
  }

  async function loadPendingBookings() {
    try {
      const [statsRes, listRes] = await Promise.all([
        fetch('/api/leads?action=booking-stats'),
        fetch('/api/leads?action=booking-list&status=pending'),
      ])
      if (statsRes.ok) {
        const { stats } = await statsRes.json()
        setPendingCount(stats?.pending || 0)
      }
      if (listRes.ok) {
        const { bookings } = await listRes.json()
        setPendingBookings(bookings || [])
      }
    } catch (err) {
      console.error('Failed to load pending bookings:', err)
    }
  }

  // AI Report functions (simplified)
  async function pullEndpoint(endpoint) {
    const key = `${endpoint}_${weeks}`
    if (cachedData[key]) return cachedData[key]
    const { start, end } = dateRangeWeeks(weeks)
    const d = endpoint === 'timesheets' ? await fetchTimesheets(start, end) : await fetchTimeActivities(start, end)
    const r = { data: d, period: { start, end } }
    setCachedData(prev => ({ ...prev, [key]: r }))
    return r
  }

  function buildCtx(ep, r) {
    const lines = [`Period: ${r.period.start} to ${r.period.end}`, '']
    if (ep === 'timesheets') { for (const u of r.data?.data?.users || []) { let h = 0, p = 0; for (const dr of u.dailyRecords || []) { h += (dr.totalTime || 0) / 3600; for (const pi of dr.payItems || []) p += pi.amount || 0 }; if (h > 0) lines.push(`User ${u.userId}: ${h.toFixed(1)}h, $${p.toFixed(2)}, ${u.approvedState || '?'}`) } }
    if (ep === 'activities') { for (const u of r.data?.data?.timeActivitiesByUsers || []) { if (!u.shifts?.length) continue; lines.push(`\nUser ${u.userId}:`); for (const s of u.shifts) { const st = s.startTime ? new Date(s.startTime * 1000) : null; let mi = 0; for (const a of s.shiftAttachments || []) if (a.attachment?.number) mi += a.attachment.number; lines.push(`  ${st?.toLocaleDateString()||'?'} | ${mi}mi | ${s.startPoint?.address || '-'}`) } } }
    return lines.join('\n')
  }

  async function handleReport(ep, prompt) {
    if (loading) return
    setMessages(prev => [...prev, { role: 'user', content: prompt }])
    setLoading(true)
    try {
      const r = await pullEndpoint(ep); const ctx = buildCtx(ep, r)
      try { const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], context: ctx }) }); if (res.ok) { const d = await res.json(); setMessages(prev => [...prev, { role: 'assistant', content: d.content }]); return } } catch {}
      setMessages(prev => [...prev, { role: 'assistant', content: ctx.length > 50 ? ctx.slice(0, 2000) : 'No data for this period.' }])
    } catch (err) { setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]) }
    finally { setLoading(false) }
  }

  async function handleSend() {
    const text = input.trim(); if (!text || loading) return; setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }]); setLoading(true)
    try {
      let ctx = ''; if (apiKey) { try { const r = await pullEndpoint('timesheets'); ctx = buildCtx('timesheets', r) } catch {} }
      const msgs = messages.filter(m => m.role === 'user' || m.role === 'assistant').concat({ role: 'user', content: text }).map(m => ({ role: m.role, content: m.content }))
      try { const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs, context: ctx }) }); if (res.ok) { const d = await res.json(); setMessages(prev => [...prev, { role: 'assistant', content: d.content }]); return } } catch {}
      setMessages(prev => [...prev, { role: 'assistant', content: 'AI not connected. Add OPENAI_API_KEY to Vercel.' }])
    } catch (err) { setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]) }
    finally { setLoading(false) }
  }

  if (!data) return null

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-xs text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/pipeline" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Pipeline</Link>
          <Link to="/schedule" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Schedule</Link>
          <Link to="/revenue" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Revenue</Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <Stat label="Active" value={data.stats.active} />
        <Stat label="Leads" value={data.stats.leads} color={data.stats.leads > 0 ? 'text-blue-400' : ''} />
        <Stat label="This Week" value={data.stats.scheduled} />
        <Stat label="Revenue" value={`$${data.stats.paidTotal.toFixed(0)}`} color="text-green-400" />
        <Stat label="Owed" value={`$${data.stats.outstanding.toFixed(0)}`} color={data.stats.outstanding > 0 ? 'text-yellow-400' : ''} />
        <Stat label="Clients" value={data.stats.clients} />
      </div>

      {/* Workflow Funnel */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Workflow Pipeline</h2>
          <Link to="/pipeline" className="text-xs text-gray-500 hover:text-gray-300">View Pipeline</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Link to="/website-requests" className="bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-xs text-gray-400">Leads</span>
            </div>
            <p className="text-lg font-bold text-blue-400">{data.workflow.leads}</p>
            <p className="text-xs text-gray-600">new inquiries</p>
          </Link>
          <Link to="/pipeline" className="bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              <span className="text-xs text-gray-400">Quotes</span>
            </div>
            <p className="text-lg font-bold text-purple-400">{data.workflow.draftQuotes + data.workflow.sentQuotes}</p>
            <p className="text-xs text-gray-600">{data.workflow.draftQuotes} draft, {data.workflow.sentQuotes} sent</p>
          </Link>
          <Link to="/schedule" className="bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-cyan-500" />
              <span className="text-xs text-gray-400">Scheduled</span>
            </div>
            <p className="text-lg font-bold text-cyan-400">{data.workflow.scheduledJobs}</p>
            <p className="text-xs text-gray-600">{data.workflow.completedJobs} completed</p>
          </Link>
          <Link to="/invoices" className="bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-yellow-500" />
              <span className="text-xs text-gray-400">Invoiced</span>
            </div>
            <p className="text-lg font-bold text-yellow-400">{data.workflow.sentInvoices + data.workflow.draftInvoices}</p>
            <p className="text-xs text-gray-600">{data.workflow.overdueInvoices > 0 ? `${data.workflow.overdueInvoices} overdue` : `${data.workflow.draftInvoices} draft`}</p>
          </Link>
          <Link to="/revenue" className="bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-gray-400">Paid</span>
            </div>
            <p className="text-lg font-bold text-green-400">{data.workflow.paidInvoices}</p>
            <p className="text-xs text-gray-600">${data.stats.paidTotal.toFixed(0)} total</p>
          </Link>
        </div>
      </div>

      {/* Pending Bookings */}
      {pendingCount > 0 && (
        <div className="bg-gray-900 border border-amber-800/30 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">Pending Bookings</h2>
              <span className="px-2 py-0.5 bg-amber-600/20 text-amber-400 rounded-full text-xs font-medium">{pendingCount}</span>
            </div>
            <Link to="/website-requests" className="text-xs text-gray-500 hover:text-gray-300">View in Requests</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pendingBookings.slice(0, 6).map((b, i) => (
              <div key={b.id || i} className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-sm font-medium text-white truncate">{b.name || 'Unknown'}</p>
                <div className="mt-1 space-y-0.5">
                  {b.requested_date && <p className="text-xs text-gray-400">Date: <span className="text-gray-300">{b.requested_date}</span></p>}
                  {b.estimate && <p className="text-xs text-gray-400">Estimate: <span className="text-green-400">{b.estimate}</span></p>}
                  {b.distance && <p className="text-xs text-gray-400">Distance: <span className="text-gray-300">{b.distance}</span></p>}
                </div>
              </div>
            ))}
          </div>
          {pendingBookings.length > 6 && (
            <p className="mt-2 text-xs text-gray-600">+ {pendingBookings.length - 6} more pending</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* COLUMN 1: Quotes & Leads */}
        <div className="space-y-4">
          {/* Draft quotes - need to send */}
          <Panel title="Quotes to Send" icon="📝" count={data.draftQuotes.length} linkTo="/pipeline" color="purple">
            {data.draftQuotes.map(q => (
              <Link key={q.id} to={`/clients/${q.clientId}?tab=quotes`} className="flex justify-between py-1.5 hover:bg-gray-800/50 rounded -mx-1 px-1">
                <div className="min-w-0"><p className="text-sm text-white truncate">{q.quoteNumber}</p><p className="text-xs text-gray-500">{q.serviceType} · ${q.finalPrice || q.estimateMax || 0}</p></div>
                <span className="shrink-0 px-1.5 py-0.5 bg-purple-900/30 text-purple-400 rounded text-xs">draft</span>
              </Link>
            ))}
            {data.draftQuotes.length === 0 && <p className="text-xs text-gray-700">No drafts — all quotes sent</p>}
          </Panel>

          {/* Sent quotes - awaiting response */}
          <Panel title="Awaiting Response" icon="⏳" count={data.sentQuotes.length} linkTo="/pipeline" color="yellow">
            {data.sentQuotes.map(q => (
              <Link key={q.id} to={`/clients/${q.clientId}?tab=quotes`} className="flex justify-between py-1.5 hover:bg-gray-800/50 rounded -mx-1 px-1">
                <div className="min-w-0"><p className="text-sm text-white truncate">{q.quoteNumber}</p><p className="text-xs text-gray-500">${q.finalPrice || q.estimateMax || 0} · {q.frequency}</p></div>
                <span className="text-xs text-gray-600">{q.sentAt ? `${Math.floor((Date.now() - new Date(q.sentAt)) / 86400000)}d` : ''}</span>
              </Link>
            ))}
            {data.sentQuotes.length === 0 && <p className="text-xs text-gray-700">No pending quotes</p>}
          </Panel>

          {/* New leads */}
          <Panel title="New Leads" icon="🔔" count={data.leads.length} linkTo="/pipeline" color="blue">
            {data.leads.map(c => (
              <Link key={c.id} to={`/clients/${c.id}`} className="flex justify-between py-1.5 hover:bg-gray-800/50 rounded -mx-1 px-1">
                <span className="text-sm text-white truncate">{c.name}</span><span className="text-xs text-gray-600">{c.source || ''}</span>
              </Link>
            ))}
            {data.leads.length === 0 && <p className="text-xs text-gray-700">No new leads</p>}
          </Panel>
        </div>

        {/* COLUMN 2: Jobs & Calendar */}
        <div className="space-y-4">
          {/* Today's jobs */}
          <Panel title="Today" icon="📅" count={data.todayJobs.length} linkTo="/schedule" color="cyan">
            {data.todayJobs.map(j => (
              <div key={j.id} className="flex justify-between py-1.5">
                <div className="min-w-0"><p className="text-sm text-white truncate">{j.title}</p><p className="text-xs text-gray-500">{j.clientName} {j.startTime ? `@ ${j.startTime}` : ''}</p></div>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs ${j.status === 'completed' ? 'bg-green-900/30 text-green-400' : 'bg-cyan-900/30 text-cyan-400'}`}>{j.status}</span>
              </div>
            ))}
            {data.todayJobs.length === 0 && <p className="text-xs text-gray-700">No jobs today</p>}
          </Panel>

          {/* Push to Google Calendar */}
          <Panel title="Push to Calendar" icon="📆" count={data.unpushedJobs.length} linkTo="/schedule" color="green">
            {data.unpushedJobs.slice(0, 5).map(j => (
              <div key={j.id} className="flex justify-between py-1.5">
                <div className="min-w-0"><p className="text-sm text-white truncate">{j.title}</p><p className="text-xs text-gray-500">{j.date} · {j.clientName}</p></div>
                <Link to={`/clients/${j.clientId}?tab=jobs`} className="shrink-0 px-2 py-0.5 bg-cyan-600 hover:bg-cyan-500 rounded text-xs text-white">Push</Link>
              </div>
            ))}
            {data.unpushedJobs.length === 0 && <p className="text-xs text-gray-700">All jobs synced</p>}
          </Panel>

          {/* Push to Connecteam */}
          <Panel title="Push to Connecteam" icon="👥" count={data.unpushedCT.length} color="orange">
            {data.unpushedCT.slice(0, 5).map(j => (
              <div key={j.id} className="flex justify-between py-1.5">
                <div className="min-w-0"><p className="text-sm text-white truncate">{j.title}</p><p className="text-xs text-gray-500">{j.date}</p></div>
                <Link to={`/clients/${j.clientId}?tab=jobs`} className="shrink-0 px-2 py-0.5 bg-orange-600 hover:bg-orange-500 rounded text-xs text-white">Push</Link>
              </div>
            ))}
            {data.unpushedCT.length === 0 && <p className="text-xs text-gray-700">All shifts synced</p>}
          </Panel>
        </div>

        {/* COLUMN 3: Money + AI + Messages */}
        <div className="space-y-4">
          {/* Unpaid */}
          <Panel title="Unpaid" icon="💳" count={data.unpaid.length} linkTo="/invoices" color="red">
            {data.unpaid.map(inv => (
              <div key={inv.id} className="flex justify-between py-1.5">
                <span className="text-sm text-white truncate">{inv.clientName}</span>
                <span className={`shrink-0 font-mono text-sm ${inv.status === 'overdue' ? 'text-red-400' : 'text-yellow-400'}`}>${inv.total?.toFixed(0)}</span>
              </div>
            ))}
            {data.unpaid.length === 0 && <p className="text-xs text-gray-700">All paid up!</p>}
          </Panel>

          {/* Inbox / Notifications */}
          <Panel title="Inbox" icon="📥" count={data.recentMsgs.length} linkTo="/communications">
            {data.recentMsgs.map((msg, i) => (
              <Link key={i} to="/communications" className="block py-1.5 hover:bg-gray-800/50 rounded -mx-1 px-1">
                <div className="flex justify-between">
                  <span className="text-sm text-white truncate">{msg.clientName}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-xs px-1 py-0.5 rounded ${
                      msg.channel === 'email' ? 'bg-blue-900/30 text-blue-400' :
                      msg.channel === 'text' ? 'bg-green-900/30 text-green-400' :
                      msg.channel === 'instagram' ? 'bg-pink-900/30 text-pink-400' :
                      msg.channel === 'facebook' ? 'bg-indigo-900/30 text-indigo-400' :
                      'bg-gray-800 text-gray-400'
                    }`}>{msg.channel}</span>
                    <span className="text-xs text-gray-700">{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-600 truncate">{msg.content?.slice(0, 60)}</p>
              </Link>
            ))}
            {data.recentMsgs.length === 0 && <p className="text-xs text-gray-700">No recent messages. Gmail syncs when you open Inbox.</p>}
          </Panel>

          {/* AI Chat — compact */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl flex flex-col" style={{ maxHeight: '280px' }}>
            <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-white">AI Reports</span>
              <div className="flex gap-1">
                {messages.length > 1 && <button onClick={() => { setMessages([{ role: 'assistant', content: 'Ready.' }]); setCachedData({}) }} className="text-xs text-gray-600 hover:text-gray-400">Clear</button>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs whitespace-pre-wrap ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}>
                    {msg.content.split(/(\*\*[^*]+\*\*)/).map((p, j) => p.startsWith('**') && p.endsWith('**') ? <strong key={j} className="text-white">{p.slice(2, -2)}</strong> : p)}
                  </div>
                </div>
              ))}
              {loading && <div className="text-xs text-gray-500">Working...</div>}
              <div ref={bottomRef} />
            </div>
            {!loading && apiKey && (
              <div className="px-2.5 pb-1.5 flex flex-wrap gap-1 shrink-0">
                <button onClick={() => handleReport('timesheets', 'Hours & pay per employee.')} className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-500">Hours</button>
                <button onClick={() => handleReport('activities', 'Mileage per employee.')} className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-500">Miles</button>
                <button onClick={() => handleReport('timesheets', 'Payroll prep.')} className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-500">Payroll</button>
              </div>
            )}
            <form onSubmit={e => { e.preventDefault(); handleSend() }} className="p-2 border-t border-gray-800 shrink-0 flex gap-1.5">
              <input value={input} onChange={e => setInput(e.target.value)} disabled={loading} placeholder="Ask..."
                className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button type="submit" disabled={loading || !input.trim()} className="px-2 py-1 bg-blue-600 disabled:opacity-50 rounded text-xs text-white">Go</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color = '' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-center">
      <p className={`text-lg font-bold ${color || 'text-white'}`}>{value}</p>
      <p className="text-xs text-gray-600">{label}</p>
    </div>
  )
}

function Panel({ title, icon, count = 0, linkTo, color, children }) {
  const borderColors = { purple: 'border-purple-800/30', yellow: 'border-yellow-800/30', blue: 'border-blue-800/30', cyan: 'border-cyan-800/30', green: 'border-green-800/30', orange: 'border-orange-800/30', red: 'border-red-800/30' }
  return (
    <div className={`bg-gray-900 border ${borderColors[color] || 'border-gray-800'} rounded-xl p-3.5`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{icon}</span>
          <span className="text-sm font-medium text-white">{title}</span>
          {count > 0 && <span className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded text-xs">{count}</span>}
        </div>
        {linkTo && <Link to={linkTo} className="text-xs text-gray-600 hover:text-gray-400">View</Link>}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}
