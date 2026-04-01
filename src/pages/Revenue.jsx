import { useState, useEffect } from 'react'
import { getInvoices, getInvoicesAsync, getJobs, getJobsAsync, getClients, getClientsAsync, getQuotes, getQuotesAsync } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'

export default function Revenue() {
  const [months, setMonths] = useState([])
  const [totals, setTotals] = useState({})
  const [topClients, setTopClients] = useState([])

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
  }

  const maxRevenue = Math.max(...months.map(m => m.revenue), 1)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Revenue</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="All-Time Revenue" value={`$${totals.allTimeRevenue?.toFixed(0) || 0}`} color="text-green-400" />
        <KPI label="Outstanding" value={`$${totals.allTimeOutstanding?.toFixed(0) || 0}`} color="text-yellow-400" />
        <KPI label="This Month" value={`$${totals.thisMonthRevenue?.toFixed(0) || 0}`} sub={`${totals.thisMonthJobs || 0} jobs`} color="text-blue-400" />
        <KPI label="Avg Invoice" value={`$${totals.avgJobValue?.toFixed(0) || 0}`} sub={`${totals.conversionRate || 0}% conversion`} color="text-purple-400" />
      </div>

      {/* Revenue chart (bar chart using divs) */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Monthly Revenue (12 months)</h2>
        <div className="overflow-x-auto">
        <div className="flex items-end gap-1.5" style={{ height: '200px', minWidth: '600px' }}>
          {months.map(m => (
            <div key={m.key} className="flex-1 flex flex-col items-center justify-end h-full">
              {/* Outstanding bar */}
              {m.outstanding > 0 && (
                <div className="w-full bg-yellow-600/30 rounded-t"
                  style={{ height: `${Math.max(2, (m.outstanding / maxRevenue) * 100)}%` }}
                  title={`$${m.outstanding.toFixed(0)} outstanding`} />
              )}
              {/* Revenue bar */}
              <div className="w-full bg-green-500 rounded-t"
                style={{ height: `${Math.max(2, (m.revenue / maxRevenue) * 100)}%`, minHeight: m.revenue > 0 ? '4px' : '0' }}
                title={`$${m.revenue.toFixed(0)} revenue`} />
              <span className="text-xs text-gray-600 mt-1 block truncate w-full text-center">{m.label}</span>
            </div>
          ))}
        </div>
        </div>
        <div className="flex gap-4 mt-3 text-xs">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-500" /> Revenue</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-yellow-600/30" /> Outstanding</span>
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
          <h2 className="text-sm font-semibold text-white mb-3">Top Clients by Revenue</h2>
          <div className="space-y-2">
            {topClients.map((c, i) => (
              <div key={c.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-5">{i + 1}</span>
                  <span className="text-sm text-white">{c.name}</span>
                  <span className="text-xs text-gray-600">{c.invoiceCount} invoices</span>
                </div>
                <span className="font-mono text-sm text-green-400">${c.revenue.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}
