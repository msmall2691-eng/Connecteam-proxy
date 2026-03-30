import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getClients, saveClient, getJobs, getInvoices } from '../lib/store'

const STAGES = [
  { id: 'lead', label: 'Leads', color: 'blue', desc: 'New inquiries' },
  { id: 'prospect', label: 'Quoted', color: 'purple', desc: 'Quote sent' },
  { id: 'active', label: 'Active', color: 'green', desc: 'Paying clients' },
  { id: 'inactive', label: 'Inactive', color: 'gray', desc: 'Past clients' },
]

const SOURCE_ICONS = {
  'Website': '🌐', 'Facebook': '📘', 'Facebook Lead Ad': '📘', 'Google': '🔍',
  'Referral': '🤝', 'Email': '📧', 'SMS': '💬', 'Phone': '📞', 'Direct': '📋',
}

export default function Pipeline() {
  const [clients, setClients] = useState([])
  const [jobs, setJobs] = useState([])
  const [invoices, setInvoices] = useState([])
  const [view, setView] = useState('kanban') // 'kanban' or 'list'

  useEffect(() => { reload() }, [])

  function reload() {
    setClients(getClients())
    setJobs(getJobs())
    setInvoices(getInvoices())
  }

  function moveClient(clientId, newStatus) {
    saveClient({ id: clientId, status: newStatus })
    reload()
  }

  function getClientStats(clientId) {
    const clientJobs = jobs.filter(j => j.clientId === clientId)
    const clientInvoices = invoices.filter(i => i.clientId === clientId)
    return {
      jobCount: clientJobs.length,
      completedJobs: clientJobs.filter(j => j.status === 'completed').length,
      revenue: clientInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0),
      outstanding: clientInvoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0),
    }
  }

  // Pipeline stats
  const stats = {
    leads: clients.filter(c => c.status === 'lead').length,
    quoted: clients.filter(c => c.status === 'prospect').length,
    active: clients.filter(c => c.status === 'active').length,
    totalRevenue: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0),
  }

  return (
    <div className="p-6 max-w-full mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">
            {stats.leads} leads &middot; {stats.quoted} quoted &middot; {stats.active} active &middot; ${stats.totalRevenue.toFixed(0)} revenue
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button onClick={() => setView('kanban')} className={`px-3 py-1.5 text-xs ${view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>Board</button>
            <button onClick={() => setView('list')} className={`px-3 py-1.5 text-xs ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>List</button>
          </div>
          <Link to="/clients" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">+ New Lead</Link>
        </div>
      </div>

      {/* Webhook info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <details>
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Lead intake endpoints (for website, Facebook, etc.)</summary>
          <div className="mt-3 space-y-2 text-xs">
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-400 font-medium">Website Form:</p>
              <code className="text-blue-400">POST https://connecteam-proxy.vercel.app/api/leads</code>
              <p className="text-gray-500 mt-1">Body: {`{ name, email, phone, address, service, message, propertyType, frequency }`}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-400 font-medium">Facebook Lead Ads Webhook:</p>
              <code className="text-blue-400">POST https://connecteam-proxy.vercel.app/api/leads?action=facebook</code>
              <p className="text-gray-500 mt-1">Set as webhook URL in Facebook Developer App → Webhooks → Page → leadgen</p>
            </div>
          </div>
        </details>
      </div>

      {view === 'kanban' ? (
        /* ── KANBAN BOARD ── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 min-h-[500px]">
          {STAGES.map(stage => {
            const stageClients = clients.filter(c => c.status === stage.id)
            return (
              <div key={stage.id} className="bg-gray-900/50 border border-gray-800 rounded-xl flex flex-col">
                <div className="px-4 py-3 border-b border-gray-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        stage.color === 'blue' ? 'bg-blue-500' :
                        stage.color === 'purple' ? 'bg-purple-500' :
                        stage.color === 'green' ? 'bg-green-500' : 'bg-gray-500'
                      }`} />
                      <span className="text-sm font-semibold text-white">{stage.label}</span>
                    </div>
                    <span className="text-xs text-gray-500 bg-gray-800 rounded-full px-2 py-0.5">{stageClients.length}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{stage.desc}</p>
                </div>
                <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                  {stageClients.map(client => {
                    const cStats = getClientStats(client.id)
                    return (
                      <div key={client.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors">
                        <Link to={`/clients/${client.id}`} className="text-sm font-medium text-white hover:text-blue-400">{client.name}</Link>
                        <div className="flex items-center gap-2 mt-1">
                          {client.source && (
                            <span className="text-xs text-gray-500">{SOURCE_ICONS[client.source] || '📋'} {client.source}</span>
                          )}
                          <span className="text-xs capitalize text-gray-600">{client.type}</span>
                        </div>
                        {(client.email || client.phone) && (
                          <p className="text-xs text-gray-600 mt-1 truncate">{client.email || client.phone}</p>
                        )}
                        {client.tags?.length > 0 && (
                          <div className="flex gap-1 mt-1.5 flex-wrap">
                            {client.tags.slice(0, 3).map(t => (
                              <span key={t} className="px-1.5 py-0.5 bg-gray-800 rounded text-xs text-gray-500">{t}</span>
                            ))}
                          </div>
                        )}
                        {cStats.revenue > 0 && (
                          <p className="text-xs text-green-500 mt-1">${cStats.revenue.toFixed(0)} earned</p>
                        )}
                        {/* Stage actions */}
                        <div className="flex gap-1 mt-2">
                          {stage.id === 'lead' && (
                            <>
                              <Link to={`/clients/${client.id}?tab=quotes`}
                                className="px-2 py-0.5 bg-purple-600/20 text-purple-400 rounded text-xs hover:bg-purple-600/30">Send Quote</Link>
                              <button onClick={() => moveClient(client.id, 'active')}
                                className="px-2 py-0.5 bg-green-600/20 text-green-400 rounded text-xs hover:bg-green-600/30">Activate</button>
                            </>
                          )}
                          {stage.id === 'prospect' && (
                            <>
                              <button onClick={() => moveClient(client.id, 'active')}
                                className="px-2 py-0.5 bg-green-600/20 text-green-400 rounded text-xs hover:bg-green-600/30">Won</button>
                              <button onClick={() => moveClient(client.id, 'inactive')}
                                className="px-2 py-0.5 bg-gray-700 text-gray-400 rounded text-xs hover:bg-gray-600">Lost</button>
                            </>
                          )}
                          {stage.id === 'active' && (
                            <Link to={`/clients/${client.id}?tab=jobs`}
                              className="px-2 py-0.5 bg-blue-600/20 text-blue-400 rounded text-xs hover:bg-blue-600/30">Schedule</Link>
                          )}
                        </div>
                        {/* Time in stage */}
                        <p className="text-xs text-gray-700 mt-1.5">
                          {client.createdAt ? `${Math.floor((Date.now() - new Date(client.createdAt)) / 86400000)}d ago` : ''}
                        </p>
                      </div>
                    )
                  })}
                  {stageClients.length === 0 && (
                    <p className="text-xs text-gray-700 text-center py-8">No {stage.label.toLowerCase()}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── LIST VIEW ── */
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-5 py-3 text-left">Client</th>
                <th className="px-3 py-3 text-left">Contact</th>
                <th className="px-3 py-3 text-left">Source</th>
                <th className="px-3 py-3 text-left">Type</th>
                <th className="px-3 py-3 text-center">Stage</th>
                <th className="px-3 py-3 text-right">Revenue</th>
                <th className="px-3 py-3 text-left">Age</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {clients.map(client => {
                const cStats = getClientStats(client.id)
                const ageInDays = client.createdAt ? Math.floor((Date.now() - new Date(client.createdAt)) / 86400000) : 0
                return (
                  <tr key={client.id} className="text-gray-300 hover:bg-gray-800/30">
                    <td className="px-5 py-3">
                      <Link to={`/clients/${client.id}`} className="font-medium text-white hover:text-blue-400">{client.name}</Link>
                      {client.tags?.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {client.tags.slice(0, 2).map(t => <span key={t} className="px-1 py-0.5 bg-gray-800 rounded text-xs text-gray-500">{t}</span>)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {client.email && <p>{client.email}</p>}
                      {client.phone && <p className="text-gray-500">{client.phone}</p>}
                    </td>
                    <td className="px-3 py-3 text-xs">{SOURCE_ICONS[client.source] || ''} {client.source || '-'}</td>
                    <td className="px-3 py-3 text-xs capitalize">{client.type}</td>
                    <td className="px-3 py-3 text-center">
                      <select value={client.status} onChange={e => moveClient(client.id, e.target.value)}
                        className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-white">
                        <option value="lead">Lead</option>
                        <option value="prospect">Quoted</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">
                      {cStats.revenue > 0 ? `$${cStats.revenue.toFixed(0)}` : '-'}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">{ageInDays}d</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        {client.status === 'lead' && (
                          <Link to={`/clients/${client.id}?tab=quotes`} className="text-xs text-purple-400 hover:text-purple-300">Quote</Link>
                        )}
                        <Link to={`/clients/${client.id}`} className="text-xs text-gray-500 hover:text-blue-400">View</Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
