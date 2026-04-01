import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { usePortalAuth } from '../../lib/portalAuth'

export default function PortalDashboard() {
  const { user, client, portalFetch } = usePortalAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await portalFetch('/api/portal?action=dashboard')
        if (!res.ok) throw new Error('Failed to load dashboard')
        setData(await res.json())
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [portalFetch])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return <div className="p-6"><div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div></div>
  }

  const stats = data?.stats || {}
  const nextVisit = data?.upcomingJobs?.[0]

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Welcome back, {user?.name || client?.name || 'there'}</h1>
        <p className="text-sm text-gray-500 mt-1">Here is an overview of your account</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Upcoming Visits" value={stats.upcomingVisits || 0} color="emerald" to="/portal/schedule" />
        <StatCard label="Pending Invoices" value={stats.pendingInvoices || 0} color="amber" to="/portal/invoices" />
        <StatCard label="Active Quotes" value={stats.activeQuotes || 0} color="blue" to="/portal/quotes" />
        <StatCard label="Unread Messages" value={stats.unreadMessages || 0} color="purple" to="/portal/messages" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Next visit */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Next Scheduled Visit</h3>
          {nextVisit ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-white font-medium">{nextVisit.title || nextVisit.serviceType || 'Cleaning Service'}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(nextVisit.status)}`}>
                  {nextVisit.status}
                </span>
              </div>
              <div className="text-sm text-gray-400 space-y-1">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75" />
                  </svg>
                  {formatDate(nextVisit.date)}
                </div>
                {nextVisit.startTime && (
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {nextVisit.startTime}{nextVisit.endTime ? ` - ${nextVisit.endTime}` : ''}
                  </div>
                )}
                {nextVisit.address && (
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                    </svg>
                    {nextVisit.address}
                  </div>
                )}
              </div>
              <Link to="/portal/schedule" className="inline-block text-xs text-emerald-400 hover:text-emerald-300 mt-2">
                View full schedule &rarr;
              </Link>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No upcoming visits scheduled</p>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Quick Actions</h3>
          <div className="space-y-2">
            <Link to="/portal/requests" className="flex items-center gap-3 px-4 py-3 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors">
              <div className="w-8 h-8 bg-emerald-600/20 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-white font-medium">Request Service</p>
                <p className="text-xs text-gray-500">Book a cleaning or make a request</p>
              </div>
            </Link>
            <Link to="/portal/messages" className="flex items-center gap-3 px-4 py-3 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors">
              <div className="w-8 h-8 bg-blue-600/20 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-white font-medium">Send Message</p>
                <p className="text-xs text-gray-500">Contact our team directly</p>
              </div>
            </Link>
            <Link to="/portal/schedule" className="flex items-center gap-3 px-4 py-3 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors">
              <div className="w-8 h-8 bg-purple-600/20 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-white font-medium">View Schedule</p>
                <p className="text-xs text-gray-500">See all upcoming visits</p>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* Recent invoices */}
      {data?.recentInvoices?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Recent Invoices</h3>
            <Link to="/portal/invoices" className="text-xs text-emerald-400 hover:text-emerald-300">View all &rarr;</Link>
          </div>
          <div className="space-y-2">
            {data.recentInvoices.slice(0, 5).map(inv => (
              <div key={inv.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                <div>
                  <span className="text-sm text-white">{inv.invoiceNumber || 'Invoice'}</span>
                  <span className="text-xs text-gray-500 ml-2">{formatDate(inv.issueDate)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-white font-medium">${inv.total?.toFixed(2)}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${invoiceStatusColor(inv.status)}`}>
                    {inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open requests */}
      {data?.openRequests?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Open Requests</h3>
            <Link to="/portal/requests" className="text-xs text-emerald-400 hover:text-emerald-300">View all &rarr;</Link>
          </div>
          <div className="space-y-2">
            {data.openRequests.slice(0, 5).map(req => (
              <div key={req.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                <div>
                  <span className="text-sm text-white">{req.title}</span>
                  <span className="text-xs text-gray-500 ml-2">{req.type}</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${requestStatusColor(req.status)}`}>
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color, to }) {
  const colorMap = {
    emerald: 'bg-emerald-600/20 text-emerald-400 border-emerald-900/50',
    amber: 'bg-amber-600/20 text-amber-400 border-amber-900/50',
    blue: 'bg-blue-600/20 text-blue-400 border-blue-900/50',
    purple: 'bg-purple-600/20 text-purple-400 border-purple-900/50',
  }
  return (
    <Link to={to} className={`p-4 rounded-xl border ${colorMap[color]} hover:opacity-80 transition-opacity`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-1 opacity-80">{label}</p>
    </Link>
  )
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function statusColor(s) {
  const map = {
    scheduled: 'bg-blue-900/40 text-blue-400',
    'in-progress': 'bg-yellow-900/40 text-yellow-400',
    completed: 'bg-green-900/40 text-green-400',
    cancelled: 'bg-red-900/40 text-red-400',
  }
  return map[s] || 'bg-gray-800 text-gray-400'
}

function invoiceStatusColor(s) {
  const map = {
    draft: 'bg-gray-800 text-gray-400',
    sent: 'bg-blue-900/40 text-blue-400',
    paid: 'bg-green-900/40 text-green-400',
    overdue: 'bg-red-900/40 text-red-400',
  }
  return map[s] || 'bg-gray-800 text-gray-400'
}

function requestStatusColor(s) {
  const map = {
    pending: 'bg-yellow-900/40 text-yellow-400',
    reviewed: 'bg-blue-900/40 text-blue-400',
    approved: 'bg-green-900/40 text-green-400',
    scheduled: 'bg-purple-900/40 text-purple-400',
    declined: 'bg-red-900/40 text-red-400',
    completed: 'bg-gray-800 text-gray-400',
  }
  return map[s] || 'bg-gray-800 text-gray-400'
}
