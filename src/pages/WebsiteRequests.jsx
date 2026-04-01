import { useState, useEffect } from 'react'

const STATUS_OPTIONS = [
  { value: 'new', label: 'New', color: 'blue' },
  { value: 'contacted', label: 'Contacted', color: 'yellow' },
  { value: 'quoted', label: 'Quoted', color: 'purple' },
  { value: 'converted', label: 'Converted', color: 'green' },
  { value: 'lost', label: 'Lost', color: 'gray' },
]

const LOCAL_KEY = 'workflowhq_website_requests'

function loadLocalRequests() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || [] }
  catch { return [] }
}

function saveLocalRequests(requests) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(requests))
}

export default function WebsiteRequests() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    fetchRequests()
    const interval = setInterval(fetchRequests, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchRequests() {
    try {
      const res = await fetch('/api/leads?action=list')
      if (res.ok) {
        const data = await res.json()
        if (data.requests?.length > 0) {
          setRequests(data.requests)
          saveLocalRequests(data.requests)
          setLoading(false)
          return
        }
      }
    } catch (e) {
      console.error('Failed to fetch website requests:', e)
    }
    // Fallback to localStorage
    setRequests(loadLocalRequests())
    setLoading(false)
  }

  function updateStatus(id, newStatus) {
    setRequests(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, status: newStatus } : r)
      saveLocalRequests(updated)
      return updated
    })
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)
  const newCount = requests.filter(r => r.status === 'new').length

  const statusColor = (status) => {
    const s = STATUS_OPTIONS.find(o => o.value === status)
    if (!s) return 'bg-gray-800 text-gray-400'
    switch (s.color) {
      case 'blue': return 'bg-blue-900/40 text-blue-400 border-blue-800'
      case 'yellow': return 'bg-yellow-900/40 text-yellow-400 border-yellow-800'
      case 'purple': return 'bg-purple-900/40 text-purple-400 border-purple-800'
      case 'green': return 'bg-green-900/40 text-green-400 border-green-800'
      default: return 'bg-gray-800 text-gray-400 border-gray-700'
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Website Requests</h1>
            {newCount > 0 && (
              <span className="px-2.5 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full animate-pulse">
                {newCount} new
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">Incoming requests from maineclean.co</p>
        </div>
        <button onClick={fetchRequests} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:bg-gray-800'}`}>
          All ({requests.length})
        </button>
        {STATUS_OPTIONS.map(s => {
          const count = requests.filter(r => r.status === s.value).length
          return (
            <button key={s.value} onClick={() => setFilter(s.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === s.value ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:bg-gray-800'}`}>
              {s.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Requests list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-700 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-gray-500 text-sm">No website requests yet</p>
          <p className="text-gray-600 text-xs mt-1">Requests from your website form will appear here automatically</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(req => {
            const isExpanded = expandedId === (req.id || req.created_at)
            const timeAgo = req.created_at ? getTimeAgo(req.created_at) : ''
            const estimate = req.estimate_min && req.estimate_max ? `$${req.estimate_min}–$${req.estimate_max}` : null
            return (
              <div key={req.id || req.created_at}
                className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors">
                {/* Main row */}
                <div className="px-5 py-4 flex items-center gap-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : (req.id || req.created_at))}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{req.name || 'Unknown'}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(req.status || 'new')}`}>
                        {(req.status || 'new').charAt(0).toUpperCase() + (req.status || 'new').slice(1)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {req.email && <span>{req.email}</span>}
                      {req.phone && <span>{req.phone}</span>}
                      {req.service && <span className="text-gray-600">| {req.service}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {estimate && <p className="text-sm font-bold text-green-400">{estimate}</p>}
                    <p className="text-xs text-gray-600 mt-0.5">{timeAgo}</p>
                  </div>
                  <svg className={`w-4 h-4 text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-5 pb-4 border-t border-gray-800 pt-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-gray-600 block">Address</span>
                        <span className="text-gray-300">{req.address || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600 block">Property Type</span>
                        <span className="text-gray-300 capitalize">{req.property_type || req.propertyType || 'residential'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600 block">Frequency</span>
                        <span className="text-gray-300">{req.frequency || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600 block">Source</span>
                        <span className="text-gray-300">{req.source || 'Website'}</span>
                      </div>
                      {req.sqft && <div><span className="text-gray-600 block">Sq Ft</span><span className="text-gray-300">{req.sqft}</span></div>}
                      {req.bathrooms && <div><span className="text-gray-600 block">Bathrooms</span><span className="text-gray-300">{req.bathrooms}</span></div>}
                      {req.pet_hair && <div><span className="text-gray-600 block">Pet Hair</span><span className="text-gray-300 capitalize">{req.pet_hair}</span></div>}
                      {req.condition && <div><span className="text-gray-600 block">Condition</span><span className="text-gray-300 capitalize">{req.condition}</span></div>}
                    </div>
                    {req.message && (
                      <div className="mt-3">
                        <span className="text-xs text-gray-600 block mb-1">Message</span>
                        <p className="text-sm text-gray-300 bg-gray-800 rounded-lg p-3">{req.message}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 mt-4">
                      {STATUS_OPTIONS.filter(s => s.value !== (req.status || 'new')).map(s => (
                        <button key={s.value}
                          onClick={(e) => { e.stopPropagation(); updateStatus(req.id || req.created_at, s.value) }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80 ${statusColor(s.value)}`}>
                          Mark {s.label}
                        </button>
                      ))}
                      {req.email && (
                        <a href={`mailto:${req.email}`} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700 ml-auto">
                          Email
                        </a>
                      )}
                      {req.phone && (
                        <a href={`tel:${req.phone}`} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700">
                          Call
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function getTimeAgo(dateStr) {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
