import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey, setApiKey } from '../lib/api'
import { getClients, getJobs, getConversations, getInvoices } from '../lib/store'
import MetricCard from '../components/MetricCard'

export default function Dashboard() {
  const [apiKey, setApiKeyState] = useState(getApiKey())
  const [crmStats, setCrmStats] = useState(null)

  const needsKey = !apiKey

  function saveKey(e) {
    e.preventDefault()
    const key = e.target.elements.key.value.trim()
    if (key) {
      setApiKey(key)
      setApiKeyState(key)
    }
  }

  useEffect(() => { loadCrmStats() }, [])

  function loadCrmStats() {
    const clients = getClients()
    const jobs = getJobs()
    const convos = getConversations()
    const invoices = getInvoices()
    const paidTotal = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
    const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0)

    setCrmStats({
      totalClients: clients.length,
      activeClients: clients.filter(c => c.status === 'active').length,
      leads: clients.filter(c => c.status === 'lead').length,
      prospects: clients.filter(c => c.status === 'prospect').length,
      totalJobs: jobs.length,
      scheduledJobs: jobs.filter(j => j.status === 'scheduled').length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      totalConvos: convos.length,
      totalInvoices: invoices.length,
      paidTotal,
      outstanding,
      recentClients: clients.slice(0, 5),
      recentJobs: jobs.slice(0, 5),
    })
  }

  if (needsKey) {
    return (
      <div className="flex items-center justify-center h-full">
        <form onSubmit={saveKey} className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-96 space-y-4">
          <h2 className="text-lg font-semibold text-white">Connect to Connecteam</h2>
          <p className="text-sm text-gray-400">Enter your API key to get started. You can still use the CRM features without it.</p>
          <input name="key" type="password" placeholder="API Key"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="submit" className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors">Connect</button>
          <Link to="/clients" className="block text-center text-sm text-gray-500 hover:text-gray-300 transition-colors">Skip for now &rarr; Go to CRM</Link>
        </form>
      </div>
    )
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

      {/* Main action area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Generate Report card */}
        <Link to="/reports" className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-blue-800/50 transition-colors group">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white group-hover:text-blue-400 transition-colors">Generate AI Report</h3>
              <p className="text-sm text-gray-500 mt-1">Pull Connecteam data on-demand and get an AI-generated report. Choose from presets or write your own prompt.</p>
            </div>
          </div>
        </Link>

        {/* Quick actions */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-base font-semibold text-white mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/clients" className="flex items-center gap-2 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
              <span className="w-2 h-2 rounded-full bg-purple-500" /> Manage Clients
            </Link>
            <Link to="/communications" className="flex items-center gap-2 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
              <span className="w-2 h-2 rounded-full bg-green-500" /> Messages
            </Link>
            <Link to="/schedule" className="flex items-center gap-2 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> Schedule
            </Link>
            <Link to="/invoices" className="flex items-center gap-2 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
              <span className="w-2 h-2 rounded-full bg-yellow-500" /> Invoices
            </Link>
            <Link to="/payroll" className="flex items-center gap-2 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
              <span className="w-2 h-2 rounded-full bg-orange-500" /> Payroll
            </Link>
            <Link to="/setup" className="flex items-center gap-2 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
              <span className="w-2 h-2 rounded-full bg-gray-500" /> Setup Wizard
            </Link>
          </div>
        </div>
      </div>

      {/* Recent activity */}
      {crmStats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {crmStats.recentClients.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Recent Clients</h2>
              <div className="space-y-2">
                {crmStats.recentClients.map(c => (
                  <Link key={c.id} to={`/clients/${c.id}`} className="flex items-center justify-between text-sm hover:bg-gray-800/50 rounded px-1 py-0.5 -mx-1 transition-colors">
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
          {crmStats.recentJobs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Recent Jobs</h2>
              <div className="space-y-2">
                {crmStats.recentJobs.map(j => (
                  <div key={j.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="text-gray-300">{j.title}</span>
                      {j.clientName && <span className="text-gray-600 ml-2">{j.clientName}</span>}
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
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
      )}
    </div>
  )
}
