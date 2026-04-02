import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey, fetchTimesheets, fetchTimeActivities, dateRangeWeeks } from '../lib/api'
import {
  getClients, getClientsAsync, getJobs, getJobsAsync,
  getConversations, getConversationsAsync, getInvoices, getInvoicesAsync,
  getQuotes, getQuotesAsync, getProperties, getPropertiesAsync,
  getScheduleAsync,
} from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { Skeleton, CardSkeleton, StatusBadge, ProgressBar } from '../components/ui'

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
    let clients, jobs, invoices, quotes, convos, properties, visits
    const today = new Date().toISOString().split('T')[0]
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
    const weekStr = weekEnd.toISOString().split('T')[0]

    if (isSupabaseConfigured()) {
      ;[clients, jobs, invoices, quotes, convos, properties, visits] = await Promise.all([
        getClientsAsync(), getJobsAsync(), getInvoicesAsync(),
        getQuotesAsync(), getConversationsAsync(), getPropertiesAsync(),
        getScheduleAsync({ startDate: today, endDate: weekStr }),
      ])
    } else {
      clients = getClients(); jobs = getJobs(); invoices = getInvoices()
      quotes = getQuotes(); convos = getConversations(); properties = getProperties()
      visits = []
    }

    const paidTotal = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
    const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0)

    // Visits needing calendar push (no google_event_id)
    const unpushedVisits = (visits || []).filter(v => v.status === 'scheduled' && !v.googleEventId).slice(0, 8)
    // Visits needing Connecteam push
    const unpushedCTVisits = (visits || []).filter(v => v.status === 'scheduled' && !v.connecteamShiftId).slice(0, 8)
    // Fallback to jobs if no visits loaded yet
    const unpushedJobs = unpushedVisits.length > 0
      ? unpushedVisits.map(v => ({ ...v, title: v.job?.title || 'Cleaning', date: v.scheduledDate, startTime: v.scheduledStartTime, googleEventId: v.googleEventId }))
      : jobs.filter(j => j.status === 'scheduled' && j.date >= today && !j.googleEventId).slice(0, 8)
    const unpushedCT = unpushedCTVisits.length > 0
      ? unpushedCTVisits.map(v => ({ ...v, title: v.job?.title || 'Cleaning', date: v.scheduledDate, connecteamShiftId: v.connecteamShiftId }))
      : jobs.filter(j => j.status === 'scheduled' && j.date >= today && !j.connecteamShiftId).slice(0, 8)

    // Quotes to send or follow up
    const draftQuotes = quotes.filter(q => q.status === 'draft').slice(0, 5)
    const sentQuotes = quotes.filter(q => q.status === 'sent').slice(0, 5)
    const acceptedQuotes = quotes.filter(q => q.status === 'accepted' || q.status === 'signed')
    // Stale quotes (sent > 3 days ago, no response)
    const staleQuotes = quotes.filter(q => q.status === 'sent' && q.sentAt && (Date.now() - new Date(q.sentAt)) > 3 * 86400000).slice(0, 5)

    // Today's schedule (prefer visits)
    const todayVisits = (visits || []).filter(v => v.scheduledDate === today && !['cancelled', 'skipped'].includes(v.status))
    const todayJobs = todayVisits.length > 0
      ? todayVisits.map(v => ({ ...v, title: v.job?.title || 'Cleaning', date: v.scheduledDate, startTime: v.scheduledStartTime, status: v.status }))
      : jobs.filter(j => j.date === today && j.status !== 'cancelled')

    // This week (prefer visits)
    const thisWeekVisits = (visits || []).filter(v => v.scheduledDate >= today && v.scheduledDate <= weekStr && v.status === 'scheduled')
    const thisWeekJobs = thisWeekVisits.length > 0
      ? thisWeekVisits.map(v => ({ ...v, title: v.job?.title || 'Cleaning', date: v.scheduledDate, startTime: v.scheduledStartTime }))
      : jobs.filter(j => j.date >= today && j.date <= weekStr && j.status === 'scheduled')

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

    // Workflow funnel stats (use visits for scheduling metrics)
    const scheduledCount = (visits || []).length > 0
      ? (visits || []).filter(v => v.status === 'scheduled').length
      : jobs.filter(j => j.status === 'scheduled').length
    const completedCount = (visits || []).length > 0
      ? (visits || []).filter(v => v.status === 'completed').length
      : jobs.filter(j => j.status === 'completed').length

    const workflow = {
      leads: clients.filter(c => c.status === 'lead').length,
      quoted: clients.filter(c => c.status === 'prospect').length,
      active: clients.filter(c => c.status === 'active').length,
      totalQuotes: quotes.length,
      draftQuotes: quotes.filter(q => q.status === 'draft').length,
      sentQuotes: quotes.filter(q => q.status === 'sent').length,
      acceptedQuotes: acceptedQuotes.length,
      scheduledJobs: scheduledCount,
      completedJobs: completedCount,
      draftInvoices: invoices.filter(i => i.status === 'draft').length,
      sentInvoices: invoices.filter(i => i.status === 'sent').length,
      paidInvoices: invoices.filter(i => i.status === 'paid').length,
      overdueInvoices: invoices.filter(i => i.status === 'overdue').length,
      totalProperties: properties.length,
    }

    // Action items count (things needing attention)
    const actionCount = draftQuotes.length + staleQuotes.length + unpushedJobs.length + leads.length + unpaid.filter(i => i.status === 'overdue').length

    setData({
      stats: { clients: clients.length, active: clients.filter(c => c.status === 'active').length, leads: leads.length, scheduled: thisWeekJobs.length, paidTotal, outstanding },
      workflow, actionCount,
      todayJobs, thisWeekJobs, unpushedJobs, unpushedCT, draftQuotes, sentQuotes, staleQuotes, leads, unpaid,
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

  if (!data) return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><div className="h-6 w-32 bg-gray-800 rounded animate-pulse" /><div className="h-4 w-48 bg-gray-800/50 rounded animate-pulse mt-2" /></div>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <div className="h-7 w-12 bg-gray-800 rounded animate-pulse mx-auto" />
            <div className="h-3 w-16 bg-gray-800/50 rounded animate-pulse mx-auto mt-2" />
          </div>
        ))}
      </div>
      <CardSkeleton count={3} />
    </div>
  )

  const formatTime = (t) => { if (!t) return ''; const [h, m] = t.split(':'); const hr = parseInt(h); if (isNaN(hr)) return t; return `${hr > 12 ? hr - 12 : hr || 12}:${m || '00'}${hr >= 12 ? 'pm' : 'am'}` }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-xs text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div className="flex gap-2">
          {data.actionCount > 0 && (
            <span className="px-2.5 py-1.5 bg-amber-600/20 border border-amber-800/30 rounded-lg text-xs text-amber-400 font-medium">
              {data.actionCount} action{data.actionCount !== 1 ? 's' : ''} needed
            </span>
          )}
          <Link to="/pipeline" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors">Pipeline</Link>
          <Link to="/schedule" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors">Schedule</Link>
          <Link to="/revenue" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors">Revenue</Link>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <Stat label="Active Clients" value={data.stats.active} icon={<span className="w-2 h-2 rounded-full bg-green-500 inline-block mr-1.5" />} />
        <Stat label="New Leads" value={data.stats.leads} color={data.stats.leads > 0 ? 'text-blue-400' : ''} pulse={data.stats.leads > 0} />
        <Stat label="This Week" value={data.stats.scheduled} />
        <Stat label="Revenue" value={`$${data.stats.paidTotal.toLocaleString()}`} color="text-green-400" />
        <Stat label="Outstanding" value={`$${data.stats.outstanding.toLocaleString()}`} color={data.stats.outstanding > 0 ? 'text-amber-400' : 'text-gray-500'} />
        <Stat label="Total Clients" value={data.stats.clients} />
      </div>

      {/* Workflow Pipeline — visual funnel with progress */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Workflow Pipeline</h2>
          <Link to="/pipeline" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">View All &rarr;</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { to: '/pipeline', dot: 'bg-blue-500', label: 'Leads', value: data.workflow.leads, sub: 'new inquiries', color: 'text-blue-400', bar: { value: data.workflow.leads, max: Math.max(data.workflow.leads, data.stats.clients || 1), color: 'blue' } },
            { to: '/pipeline', dot: 'bg-purple-500', label: 'Quotes', value: data.workflow.draftQuotes + data.workflow.sentQuotes, sub: `${data.workflow.draftQuotes} draft, ${data.workflow.sentQuotes} sent`, color: 'text-purple-400', bar: { value: data.workflow.acceptedQuotes, max: data.workflow.totalQuotes || 1, color: 'purple' } },
            { to: '/schedule', dot: 'bg-cyan-500', label: 'Scheduled', value: data.workflow.scheduledJobs, sub: `${data.workflow.completedJobs} completed`, color: 'text-cyan-400', bar: { value: data.workflow.completedJobs, max: data.workflow.scheduledJobs + data.workflow.completedJobs || 1, color: 'green' } },
            { to: '/invoices', dot: 'bg-amber-500', label: 'Invoiced', value: data.workflow.sentInvoices + data.workflow.draftInvoices, sub: data.workflow.overdueInvoices > 0 ? `${data.workflow.overdueInvoices} overdue` : `${data.workflow.draftInvoices} draft`, color: 'text-amber-400', bar: { value: data.workflow.paidInvoices, max: data.workflow.paidInvoices + data.workflow.sentInvoices + data.workflow.draftInvoices || 1, color: 'amber' } },
            { to: '/revenue', dot: 'bg-green-500', label: 'Paid', value: data.workflow.paidInvoices, sub: `$${data.stats.paidTotal.toLocaleString()}`, color: 'text-green-400', bar: { value: data.workflow.paidInvoices, max: data.workflow.paidInvoices || 1, color: 'green' } },
          ].map(stage => (
            <Link key={stage.label} to={stage.to} className="bg-gray-800/40 hover:bg-gray-800/70 rounded-xl p-3 transition-all duration-200 group">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`w-2 h-2 rounded-full ${stage.dot}`} />
                <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">{stage.label}</span>
              </div>
              <p className={`text-xl font-bold ${stage.color}`}>{stage.value}</p>
              <p className="text-[11px] text-gray-600 mt-0.5">{stage.sub}</p>
              <div className="mt-2"><ProgressBar {...stage.bar} size="xs" /></div>
            </Link>
          ))}
        </div>
      </div>

      {/* Stale Quotes Warning — quotes sent > 3 days with no response */}
      {data.staleQuotes.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-800/30 rounded-xl p-4 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-amber-400 text-sm">Needs Follow-Up</span>
              <span className="px-1.5 py-0.5 bg-amber-600/20 text-amber-400 rounded text-xs font-medium">{data.staleQuotes.length}</span>
            </div>
            <Link to="/pipeline" className="text-xs text-gray-500 hover:text-gray-300">View in Pipeline</Link>
          </div>
          <div className="space-y-1.5">
            {data.staleQuotes.map(q => {
              const daysAgo = Math.floor((Date.now() - new Date(q.sentAt)) / 86400000)
              return (
                <Link key={q.id} to={`/clients/${q.clientId}?tab=quotes`}
                  className="flex items-center justify-between py-2 px-3 bg-gray-900/50 rounded-lg hover:bg-gray-800/50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{q.quoteNumber}</p>
                    <p className="text-xs text-gray-500">${q.finalPrice || q.estimateMax || 0} &middot; {q.frequency}</p>
                  </div>
                  <span className="shrink-0 text-xs text-amber-400 font-medium">{daysAgo}d ago — no response</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

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
                <div className="min-w-0"><p className="text-sm text-white truncate">{j.title}</p><p className="text-xs text-gray-500">{j.clientName} {j.startTime ? `@ ${formatTime(j.startTime)}` : ''}</p></div>
                <StatusBadge status={j.status} />
              </div>
            ))}
            {data.todayJobs.length === 0 && <p className="text-xs text-gray-600 py-2 text-center">No jobs scheduled for today</p>}
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

function Stat({ label, value, color = '', icon, pulse }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-center transition-all hover:border-gray-700 ${pulse ? 'ring-1 ring-blue-800/30' : ''}`}>
      <p className={`text-lg font-bold tabular-nums ${color || 'text-white'}`}>{icon}{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
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
