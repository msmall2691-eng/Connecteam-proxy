import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getInvoices, getInvoicesAsync, getJobs, getJobsAsync, getClients, getClientsAsync, getQuotes, getQuotesAsync } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { CardSkeleton, ProgressBar } from '../components/ui'

export default function Revenue() {
  const [months, setMonths] = useState([])
  const [totals, setTotals] = useState({})
  const [topClients, setTopClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [hoveredMonth, setHoveredMonth] = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    let invoices, jobs, clients, quotes
    if (isSupabaseConfigured()) {
      ;[invoices, jobs, clients, quotes] = await Promise.all([
        getInvoicesAsync(), getJobsAsync(), getClientsAsync(), getQuotesAsync(),
      ])
    } else {
      invoices = getInvoices(); jobs = getJobs(); clients = getClients(); quotes = getQuotes()
    }

    // Monthly breakdown (last 12 months)
    const monthData = {}
    const now = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' })
      monthData[key] = { key, label, revenue: 0, outstanding: 0, jobs: 0, newClients: 0, quotes: 0 }
    }

    for (const inv of invoices) {
      const key = inv.issueDate?.slice(0, 7)
      if (monthData[key]) {
        if (inv.status === 'paid') monthData[key].revenue += inv.total || 0
        if (inv.status === 'sent' || inv.status === 'overdue') monthData[key].outstanding += inv.total || 0
      }
    }

    for (const job of jobs) {
      const key = job.date?.slice(0, 7)
      if (monthData[key]) monthData[key].jobs++
    }

    for (const c of clients) {
      const key = c.createdAt?.slice(0, 7)
      if (monthData[key]) monthData[key].newClients++
    }

    for (const q of quotes) {
      const key = q.createdAt?.slice(0, 7)
      if (monthData[key]) monthData[key].quotes++
    }

    setMonths(Object.values(monthData))

    // Totals
    const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
    const totalOutstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0)
    const thisMonth = monthData[`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`]

    setTotals({
      allTimeRevenue: totalRevenue,
      allTimeOutstanding: totalOutstanding,
      thisMonthRevenue: thisMonth?.revenue || 0,
      thisMonthJobs: thisMonth?.jobs || 0,
      totalClients: clients.filter(c => c.status === 'active').length,
      totalJobs: jobs.length,
      avgJobValue: jobs.length > 0 ? totalRevenue / Math.max(1, invoices.filter(i => i.status === 'paid').length) : 0,
      conversionRate: clients.length > 0 ? Math.round(clients.filter(c => c.status === 'active').length / clients.length * 100) : 0,
    })

    // Top clients by revenue
    const clientRevenue = {}
    for (const inv of invoices) {
      if (inv.status === 'paid' && inv.clientId) {
        if (!clientRevenue[inv.clientId]) clientRevenue[inv.clientId] = { id: inv.clientId, name: inv.clientName, revenue: 0, invoiceCount: 0 }
        clientRevenue[inv.clientId].revenue += inv.total || 0
        clientRevenue[inv.clientId].invoiceCount++
      }
    }
    setTopClients(Object.values(clientRevenue).sort((a, b) => b.revenue - a.revenue).slice(0, 10))
    setLoading(false)
  }

  const maxRevenue = Math.max(...months.map(m => m.revenue + m.outstanding), 1)

  if (loading) return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-white">Revenue</h1>
      <CardSkeleton count={4} />
    </div>
  )

  // SVG chart dimensions
  const chartW = 720, chartH = 200, padL = 50, padR = 10, padT = 10, padB = 30
  const plotW = chartW - padL - padR, plotH = chartH - padT - padB
  const yScale = (v) => padT + plotH - (v / maxRevenue) * plotH
  const xScale = (i) => padL + (i / (months.length - 1 || 1)) * plotW

  // Build SVG path for revenue line
  const revPath = months.map((m, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(m.revenue).toFixed(1)}`).join(' ')
  const revArea = revPath + ` L${xScale(months.length - 1).toFixed(1)},${yScale(0).toFixed(1)} L${xScale(0).toFixed(1)},${yScale(0).toFixed(1)} Z`

  // Y-axis labels
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxRevenue * f))

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-white">Revenue</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="All-Time Revenue" value={`$${(totals.allTimeRevenue || 0).toLocaleString()}`} color="text-green-400" />
        <KPI label="Outstanding" value={`$${(totals.allTimeOutstanding || 0).toLocaleString()}`} color={totals.allTimeOutstanding > 0 ? 'text-amber-400' : 'text-gray-500'} />
        <KPI label="This Month" value={`$${(totals.thisMonthRevenue || 0).toLocaleString()}`} sub={`${totals.thisMonthJobs || 0} jobs`} color="text-blue-400" />
        <KPI label="Avg Invoice" value={`$${(totals.avgJobValue || 0).toFixed(0)}`} sub={`${totals.conversionRate || 0}% lead conversion`} color="text-purple-400" />
      </div>

      {/* Revenue chart — SVG */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Monthly Revenue</h2>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Revenue</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500/40" /> Outstanding</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" style={{ minWidth: '500px' }}>
            {/* Grid lines */}
            {yTicks.map(v => (
              <g key={v}>
                <line x1={padL} x2={chartW - padR} y1={yScale(v)} y2={yScale(v)} stroke="#1f2937" strokeWidth="1" />
                <text x={padL - 8} y={yScale(v) + 4} textAnchor="end" fill="#4b5563" fontSize="10" fontFamily="monospace">
                  ${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                </text>
              </g>
            ))}

            {/* Revenue area fill */}
            <path d={revArea} fill="url(#revGradient)" opacity="0.3" />

            {/* Revenue line */}
            <path d={revPath} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

            {/* Outstanding bars */}
            {months.map((m, i) => m.outstanding > 0 && (
              <rect key={`out-${i}`} x={xScale(i) - 8} y={yScale(m.outstanding)} width="16"
                height={yScale(0) - yScale(m.outstanding)} fill="#f59e0b" opacity="0.25" rx="2" />
            ))}

            {/* Data points + hover targets */}
            {months.map((m, i) => (
              <g key={i} onMouseEnter={() => setHoveredMonth(i)} onMouseLeave={() => setHoveredMonth(null)} style={{ cursor: 'pointer' }}>
                <rect x={xScale(i) - 20} y={padT} width="40" height={plotH} fill="transparent" />
                <circle cx={xScale(i)} cy={yScale(m.revenue)} r={hoveredMonth === i ? 5 : 3}
                  fill={hoveredMonth === i ? '#22c55e' : '#166534'} stroke="#22c55e" strokeWidth="2"
                  className="transition-all duration-150" />
                {/* X labels */}
                <text x={xScale(i)} y={chartH - 5} textAnchor="middle" fill="#4b5563" fontSize="10">{m.label}</text>
                {/* Hover tooltip */}
                {hoveredMonth === i && (
                  <g>
                    <rect x={xScale(i) - 50} y={yScale(m.revenue) - 38} width="100" height="28" rx="6" fill="#111827" stroke="#374151" />
                    <text x={xScale(i)} y={yScale(m.revenue) - 20} textAnchor="middle" fill="#22c55e" fontSize="12" fontWeight="600">
                      ${m.revenue.toLocaleString()}
                    </text>
                  </g>
                )}
              </g>
            ))}

            {/* Gradient definition */}
            <defs>
              <linearGradient id="revGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      {/* Monthly breakdown table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-5 py-2.5 text-left">Month</th>
              <th className="px-3 py-2.5 text-right">Revenue</th>
              <th className="px-3 py-2.5 text-right">Outstanding</th>
              <th className="px-3 py-2.5 text-right">Jobs</th>
              <th className="px-3 py-2.5 text-right">New Clients</th>
              <th className="px-5 py-2.5 text-right">Quotes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {[...months].reverse().map(m => (
              <tr key={m.key} className="text-gray-300 hover:bg-gray-800/30">
                <td className="px-5 py-2.5 text-white">{m.label}</td>
                <td className="px-3 py-2.5 text-right font-mono text-green-400">{m.revenue > 0 ? `$${m.revenue.toFixed(0)}` : '-'}</td>
                <td className="px-3 py-2.5 text-right font-mono text-yellow-400">{m.outstanding > 0 ? `$${m.outstanding.toFixed(0)}` : '-'}</td>
                <td className="px-3 py-2.5 text-right">{m.jobs || '-'}</td>
                <td className="px-3 py-2.5 text-right">{m.newClients || '-'}</td>
                <td className="px-5 py-2.5 text-right">{m.quotes || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Top clients */}
      {topClients.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Top Clients by Revenue</h2>
          <div className="space-y-3">
            {topClients.map((c, i) => (
              <Link key={c.id} to={`/clients/${c.id}`} className="flex items-center gap-3 group hover:bg-gray-800/30 rounded-lg -mx-2 px-2 py-1.5 transition-colors">
                <span className="text-xs text-gray-600 w-5 font-mono">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-white group-hover:text-blue-400 transition-colors truncate">{c.name}</span>
                    <span className="font-mono text-sm text-green-400 tabular-nums shrink-0 ml-3">${c.revenue.toLocaleString()}</span>
                  </div>
                  <ProgressBar value={c.revenue} max={topClients[0]?.revenue || 1} color="green" size="xs" />
                </div>
                <span className="text-[10px] text-gray-600 shrink-0">{c.invoiceCount} inv</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3.5 hover:border-gray-700 transition-colors">
      <p className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </div>
  )
}
