import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getClients, getClientsAsync, saveClient, saveClientAsync, deleteClient, deleteClientAsync,
  getQuotes, getQuotesAsync, getJobs, getJobsAsync, getInvoices, getInvoicesAsync } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import ImportClients from '../components/ImportClients'
import { TableSkeleton, EmptyState, StatusBadge } from '../components/ui'

const STATUS_COLORS = {
  active: 'bg-green-900/40 text-green-400',
  lead: 'bg-blue-900/40 text-blue-400',
  inactive: 'bg-gray-800 text-gray-400',
  prospect: 'bg-purple-900/40 text-purple-400',
}

const SOURCE_OPTIONS = ['Website', 'Referral', 'Google', 'Facebook', 'Instagram', 'Yelp', 'Nextdoor', 'Google Contacts', 'Other']
const TYPE_OPTIONS = ['residential', 'commercial', 'rental', 'marina']
const SORT_OPTIONS = [
  { value: 'name-az', label: 'Name A-Z' },
  { value: 'name-za', label: 'Name Z-A' },
  { value: 'newest', label: 'Newest' },
  { value: 'revenue', label: 'Revenue (highest)' },
]

const EMPTY_CLIENT = {
  name: '', companyName: '', email: '', phone: '', address: '', status: 'lead',
  type: 'residential', notes: '', source: '', tags: [], preferredContact: 'email',
}

export default function Clients() {
  const [clients, setClients] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importingGoogle, setImportingGoogle] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...EMPTY_CLIENT })
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSource, setFilterSource] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [sortBy, setSortBy] = useState('name-az')
  const [clientStats, setClientStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  useEffect(() => { reload() }, [])

  async function reload() {
    setLoading(true)
    const data = isSupabaseConfigured() ? await getClientsAsync() : getClients()
    setClients(data)
    loadStats(data)
    setLoading(false)
  }

  async function loadStats(clientList) {
    const stats = {}
    for (const client of clientList) {
      try {
        const quotes = isSupabaseConfigured() ? await getQuotesAsync(client.id) : getQuotes(client.id)
        const jobs = isSupabaseConfigured() ? await getJobsAsync(client.id) : getJobs(client.id)
        const invoices = isSupabaseConfigured() ? await getInvoicesAsync(client.id) : getInvoices(client.id)
        const revenue = invoices
          .filter(inv => inv.status === 'paid')
          .reduce((sum, inv) => sum + (Number(inv.total) || 0), 0)
        stats[client.id] = { quotes: quotes.length, jobs: jobs.length, revenue }
      } catch {
        stats[client.id] = { quotes: 0, jobs: 0, revenue: 0 }
      }
    }
    setClientStats(stats)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const clientData = editing ? { ...form, id: editing } : { ...form }
    if (isSupabaseConfigured()) {
      await saveClientAsync(clientData)
    } else {
      saveClient(clientData)
    }
    setForm({ ...EMPTY_CLIENT })
    setEditing(null)
    setShowForm(false)
    reload()
  }

  function handleEdit(client) {
    setForm({ ...client })
    setEditing(client.id)
    setShowForm(true)
  }

  async function handleDelete(id) {
    if (confirm('Delete this client and all their data?')) {
      if (isSupabaseConfigured()) {
        await deleteClientAsync(id)
      } else {
        deleteClient(id)
      }
      reload()
    }
  }

  const filtered = useMemo(() => {
    let result = clients.filter(c => {
      if (filterStatus !== 'all' && c.status !== filterStatus) return false
      if (filterSource !== 'all' && (c.source || '').toLowerCase() !== filterSource.toLowerCase()) return false
      if (filterType !== 'all' && c.type !== filterType) return false
      if (search) {
        const s = search.toLowerCase()
        return c.name?.toLowerCase().includes(s) ||
          c.companyName?.toLowerCase().includes(s) ||
          c.email?.toLowerCase().includes(s) ||
          c.phone?.includes(s) ||
          c.address?.toLowerCase().includes(s)
      }
      return true
    })
    result.sort((a, b) => {
      switch (sortBy) {
        case 'name-az': return (a.name || '').localeCompare(b.name || '')
        case 'name-za': return (b.name || '').localeCompare(a.name || '')
        case 'newest': return (b.createdAt || b.id || '').toString().localeCompare((a.createdAt || a.id || '').toString())
        case 'revenue': return (clientStats[b.id]?.revenue || 0) - (clientStats[a.id]?.revenue || 0)
        default: return 0
      }
    })
    return result
  }, [clients, filterStatus, filterSource, filterType, search, sortBy, clientStats])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [filterStatus, filterSource, filterType, search, sortBy])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginatedClients = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (loading && clients.length === 0) return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div><h1 className="text-2xl font-bold text-white">Clients</h1><p className="text-sm text-gray-500 mt-1">Loading...</p></div>
      <TableSkeleton rows={8} cols={5} />
    </div>
  )

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">{clients.length} total clients</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setForm({ ...EMPTY_CLIENT }); setEditing(null); setShowForm(true) }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">+ New Client</button>
          <button onClick={() => setShowImport(!showImport)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${showImport ? 'bg-gray-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}>Import</button>
          <button onClick={async () => {
            setImportingGoogle(true)
            try {
              const res = await fetch('/api/google?action=contacts-list')
              if (res.ok) {
                const data = await res.json()
                let imported = 0
                const existing = isSupabaseConfigured() ? await getClientsAsync() : getClients()
                const existingEmails = new Set(existing.map(c => c.email?.toLowerCase()).filter(Boolean))
                for (const c of data.contacts) {
                  if (c.email && existingEmails.has(c.email.toLowerCase())) continue
                  if (!c.name) continue
                  const contactData = { name: c.name, email: c.email, phone: c.phone, address: c.address, status: 'lead', type: 'residential', source: 'Google Contacts' }
                  if (isSupabaseConfigured()) { await saveClientAsync(contactData) } else { saveClient(contactData) }
                  imported++
                }
                alert(`Imported ${imported} contacts from Google. ${data.total - imported} skipped (duplicates or no name).`)
                reload()
              } else { alert('Google Contacts not connected. Add People API scope to your OAuth.') }
            } catch { alert('Failed to sync Google Contacts') }
            setImportingGoogle(false)
          }} disabled={importingGoogle}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-sm text-gray-300">
            {importingGoogle ? 'Syncing...' : 'Google Contacts'}
          </button>
        </div>
      </div>

      {/* Import panel */}
      {showImport && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-semibold text-white">Import Clients</h2>
            <button onClick={() => setShowImport(false)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
          </div>
          <ImportClients onDone={() => { setShowImport(false); reload() }} />
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="flex-1 max-w-xs px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-1">
            {['all', 'active', 'lead', 'prospect', 'inactive'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterStatus === s
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Type filter */}
          <div className="flex gap-1">
            {['all', ...TYPE_OPTIONS].map(t => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  filterType === t
                    ? 'bg-purple-600/20 text-purple-400'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {t === 'all' ? 'All Types' : t === 'rental' ? 'Rental' : t}
              </button>
            ))}
          </div>
          {/* Source filter */}
          <select
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Sources</option>
            {SOURCE_OPTIONS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Client Intake Form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-white mb-4">
            {editing ? 'Edit Client' : 'New Client Intake'}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Company Name</label>
              <input value={form.companyName || ''} onChange={e => setForm({ ...form, companyName: e.target.value })}
                placeholder="Business or company name"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Address</label>
              <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="lead">Lead</option>
                <option value="prospect">Prospect</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="rental">Rental / Turnover</option>
                <option value="marina">Marina</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Source</label>
              <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Select Source --</option>
                {SOURCE_OPTIONS.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Preferred Contact</label>
              <select value={form.preferredContact || 'email'} onChange={e => setForm({ ...form, preferredContact: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="text">Text</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tags</label>
              <input value={form.tags?.join(', ') || ''} onChange={e => setForm({ ...form, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                placeholder="weekly, deep-clean, ..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors">
                {editing ? 'Save Changes' : 'Add Client'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditing(null) }}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Client List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-5 py-3 text-left">Client</th>
                <th className="px-3 py-3 text-left">Contact</th>
                <th className="px-3 py-3 text-left">Type</th>
                <th className="px-3 py-3 text-center">Status</th>
                <th className="px-3 py-3 text-center">Quotes</th>
                <th className="px-3 py-3 text-center">Jobs</th>
                <th className="px-3 py-3 text-right">Revenue</th>
                <th className="px-3 py-3 text-left">Tags</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {paginatedClients.map(client => (
                <tr key={client.id} className="text-gray-300 hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-3">
                    <Link to={`/clients/${client.id}`} className="font-medium text-white hover:text-blue-400 transition-colors">
                      {client.name}
                    </Link>
                    {client.companyName && <p className="text-xs text-gray-400 mt-0.5">{client.companyName}</p>}
                    {client.address && <p className="text-xs text-gray-500 mt-0.5">{client.address}</p>}
                  </td>
                  <td className="px-3 py-3">
                    {client.email && <p className="text-xs">{client.email}</p>}
                    {client.phone && <p className="text-xs text-gray-500">{client.phone}</p>}
                  </td>
                  <td className="px-3 py-3 text-xs capitalize">{client.type}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[client.status] || STATUS_COLORS.inactive}`}>
                      {client.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-block px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded text-xs font-medium">
                      {clientStats[client.id]?.quotes ?? '-'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-block px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-xs font-medium">
                      {clientStats[client.id]?.jobs ?? '-'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-gray-300">
                    {clientStats[client.id]?.revenue != null
                      ? `$${clientStats[client.id].revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : '-'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {(client.tags || []).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 bg-gray-800 rounded text-xs text-gray-400">{tag}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => handleEdit(client)} className="text-xs text-gray-500 hover:text-blue-400 transition-colors">Edit</button>
                      <button onClick={() => handleDelete(client.id)} className="text-xs text-gray-500 hover:text-red-400 transition-colors">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-gray-500">
                    {clients.length === 0 ? 'No clients yet. Add your first client to get started.' : 'No clients match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800">
            <p className="text-xs text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-xs text-gray-300 transition-colors">
                Prev
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let p
                if (totalPages <= 7) p = i + 1
                else if (page <= 4) p = i + 1
                else if (page >= totalPages - 3) p = totalPages - 6 + i
                else p = page - 3 + i
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                      p === page ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                    }`}>{p}</button>
                )
              })}
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-xs text-gray-300 transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
