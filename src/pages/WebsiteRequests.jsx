import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { saveClient, saveClientAsync, getClientAsync, saveProperty, savePropertyAsync, getPropertiesAsync, getQuotesAsync, saveQuote, saveQuoteAsync, generateQuoteNumber } from '../lib/store'
import { isSupabaseConfigured, getSupabase } from '../lib/supabase'

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
  const [converting, setConverting] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

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
          // Merge server data with local status updates
          const local = loadLocalRequests()
          const localStatusMap = {}
          local.forEach(r => { if (r.id && r.status) localStatusMap[r.id] = r.status })

          const merged = data.requests.map(r => ({
            ...r,
            status: localStatusMap[r.id] || r.status || 'new',
          }))
          setRequests(merged)
          saveLocalRequests(merged)
          setLoading(false)
          return
        }
      }
    } catch (e) {
      console.error('Failed to fetch website requests:', e)
    }
    setRequests(loadLocalRequests())
    setLoading(false)
  }

  async function updateStatus(id, newStatus, clientId = null) {
    setRequests(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, status: newStatus, ...(clientId ? { client_id: clientId } : {}) } : r)
      saveLocalRequests(updated)
      return updated
    })

    // Also update in Supabase website_requests table if configured
    if (isSupabaseConfigured()) {
      try {
        const sb = getSupabase()
        if (sb) {
          const updateData = { status: newStatus }
          if (clientId) updateData.client_id = clientId
          await sb.from('website_requests').update(updateData).eq('id', id)
        }
      } catch (e) {
        console.error('Failed to update request status in Supabase:', e)
      }
    }
  }

  async function acceptAsLead(req) {
    setConverting(req.id)
    try {
      let client = null

      // Check if /api/leads already created a client for this request
      if (req.client_id && isSupabaseConfigured()) {
        try {
          client = await getClientAsync(req.client_id)
        } catch (e) { console.error('Failed to fetch existing client:', e) }
      }

      // Only create a new client if one doesn't already exist
      if (!client) {
        const clientData = {
          name: req.name || 'Unknown',
          email: req.email || '',
          phone: req.phone || '',
          address: req.address || '',
          status: 'lead',
          type: req.property_type || req.propertyType || 'residential',
          source: req.source || 'Website',
          notes: [
            req.estimate_min ? `Estimate: $${req.estimate_min}–$${req.estimate_max}` : '',
            req.message || '',
            req.service ? `Service: ${req.service}` : '',
            req.frequency ? `Frequency: ${req.frequency}` : '',
            req.sqft ? `Sq ft: ${req.sqft}` : '',
            req.bathrooms ? `Bathrooms: ${req.bathrooms}` : '',
          ].filter(Boolean).join('\n'),
          tags: [req.service, req.frequency, 'Website'].filter(Boolean),
        }
        client = isSupabaseConfigured()
          ? await saveClientAsync(clientData)
          : saveClient(clientData)
      }

      // Only create property if one doesn't already exist for this client
      if (client && req.address) {
        let hasProperty = false
        if (isSupabaseConfigured()) {
          try {
            const existing = await getPropertiesAsync(client.id)
            hasProperty = existing.length > 0
          } catch {}
        }
        if (!hasProperty) {
          const propData = {
            clientId: client.id,
            name: req.address.split(',')[0] || 'Primary',
            addressLine1: req.address,
            type: req.property_type || req.propertyType || 'residential',
            sqft: req.sqft ? parseInt(req.sqft) : null,
            bathrooms: req.bathrooms ? parseInt(req.bathrooms) : null,
            petHair: req.pet_hair || 'none',
            condition: req.condition || 'maintenance',
            isPrimary: true,
          }
          try {
            isSupabaseConfigured()
              ? await savePropertyAsync(propData)
              : saveProperty(propData)
          } catch (e) { console.error('Property creation failed:', e) }
        }
      }

      // Only create quote if one doesn't already exist for this client
      if (client && req.estimate_min) {
        let hasQuote = false
        if (isSupabaseConfigured()) {
          try {
            const existing = await getQuotesAsync(client.id)
            hasQuote = existing.length > 0
          } catch {}
        }
        if (!hasQuote) {
          const quoteData = {
            quoteNumber: generateQuoteNumber(),
            clientId: client.id,
            serviceType: req.service || 'standard',
            frequency: req.frequency || 'one-time',
            estimateMin: parseFloat(req.estimate_min),
            estimateMax: parseFloat(req.estimate_max),
            status: 'draft',
            notes: req.message || '',
            calcInputs: { sqft: req.sqft, bathrooms: req.bathrooms, petHair: req.pet_hair, condition: req.condition },
          }
          try {
            isSupabaseConfigured()
              ? await saveQuoteAsync(quoteData)
              : saveQuote(quoteData)
          } catch (e) { console.error('Quote creation failed:', e) }
        }
      }

      // Update request status to converted
      updateStatus(req.id, 'converted', client.id)
      setSuccessMessage({ id: req.id, clientId: client.id, name: req.name })
      setTimeout(() => setSuccessMessage(null), 5000)
    } catch (e) {
      console.error('Failed to convert request to lead:', e)
    }
    setConverting(null)
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)
  const newCount = requests.filter(r => r.status === 'new').length

  const statusColor = (status) => {
    const s = STATUS_OPTIONS.find(o => o.value === status)
    if (!s) return 'bg-gray-800 text-gray-400 border-gray-700'
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Requests</h1>
            {newCount > 0 && (
              <span className="px-2.5 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full animate-pulse">
                {newCount} new
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Incoming requests from maineclean.co &middot; Accept to add to your Pipeline
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/pipeline" className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">
            View Pipeline
          </Link>
          <button onClick={fetchRequests} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">
            Refresh
          </button>
        </div>
      </div>

      {/* Success toast */}
      {successMessage && (
        <div className="bg-green-900/30 border border-green-800 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-green-300">
              <strong>{successMessage.name}</strong> added to your Pipeline as a lead
            </span>
          </div>
          <Link to={`/clients/${successMessage.clientId}`}
            className="px-3 py-1 bg-green-800 text-green-200 rounded-lg text-xs font-medium hover:bg-green-700">
            View Client
          </Link>
        </div>
      )}

      {/* How it works */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <details>
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">How website requests work</summary>
          <div className="mt-3 grid md:grid-cols-3 gap-4 text-xs">
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold mb-2">1</div>
              <p className="text-gray-300 font-medium">Customer fills out form</p>
              <p className="text-gray-500 mt-1">Quote request or contact form on maineclean.co submits here automatically</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold mb-2">2</div>
              <p className="text-gray-300 font-medium">You review & accept</p>
              <p className="text-gray-500 mt-1">Click "Accept as Lead" to create a client, property, and draft quote in your Pipeline</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center text-white text-xs font-bold mb-2">3</div>
              <p className="text-gray-300 font-medium">Work the lead</p>
              <p className="text-gray-500 mt-1">Send a quote, schedule a walkthrough, or convert to an active client</p>
            </div>
          </div>
        </details>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:bg-gray-800'}`}>
          All ({requests.length})
        </button>
        {STATUS_OPTIONS.map(s => {
          const count = requests.filter(r => r.status === s.value).length
          if (count === 0 && s.value !== 'new') return null
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
          <p className="text-gray-500 text-sm">
            {filter === 'all' ? 'No requests yet' : `No ${filter} requests`}
          </p>
          <p className="text-gray-600 text-xs mt-1">
            {filter === 'all'
              ? 'When customers fill out a form on maineclean.co, their requests appear here'
              : 'Try a different filter or check back later'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => {
            const isExpanded = expandedId === (r.id || r.created_at)
            const timeAgo = r.created_at ? getTimeAgo(r.created_at) : ''
            const estimate = r.estimate_min && r.estimate_max ? `$${r.estimate_min}–$${r.estimate_max}` : null
            const isNew = !r.status || r.status === 'new'
            const isConverted = r.status === 'converted'
            const isConverting = converting === r.id

            return (
              <div key={r.id || r.created_at}
                className={`bg-gray-900 border rounded-xl overflow-hidden transition-colors ${
                  isNew ? 'border-blue-800/50 shadow-lg shadow-blue-900/10' : 'border-gray-800 hover:border-gray-700'
                }`}>
                {/* Main row */}
                <div className="px-5 py-4 flex items-center gap-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : (r.id || r.created_at))}>
                  {/* New indicator */}
                  {isNew && <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0 animate-pulse" />}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{r.name || 'Unknown'}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(r.status || 'new')}`}>
                        {(r.status || 'new').charAt(0).toUpperCase() + (r.status || 'new').slice(1)}
                      </span>
                      {r.service && (
                        <span className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-500">{r.service}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {r.email && <span>{r.email}</span>}
                      {r.phone && <span>{r.phone}</span>}
                      {r.frequency && <span className="text-gray-600">| {r.frequency}</span>}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {estimate && <p className="text-sm font-bold text-green-400">{estimate}</p>}
                    <p className="text-xs text-gray-600 mt-0.5">{timeAgo}</p>
                  </div>

                  {/* Accept button (visible without expanding for new requests) */}
                  {isNew && !isExpanded && (
                    <button
                      onClick={(e) => { e.stopPropagation(); acceptAsLead(r) }}
                      disabled={isConverting}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white shrink-0 transition-colors">
                      {isConverting ? 'Adding...' : 'Accept'}
                    </button>
                  )}

                  <svg className={`w-4 h-4 text-gray-600 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-5 pb-4 border-t border-gray-800 pt-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-gray-600 block">Address</span>
                        <span className="text-gray-300">{r.address || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600 block">Property Type</span>
                        <span className="text-gray-300 capitalize">{r.property_type || r.propertyType || 'residential'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600 block">Frequency</span>
                        <span className="text-gray-300">{r.frequency || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600 block">Source</span>
                        <span className="text-gray-300">{r.source || 'Website'}</span>
                      </div>
                      {r.sqft && <div><span className="text-gray-600 block">Sq Ft</span><span className="text-gray-300">{Number(r.sqft).toLocaleString()}</span></div>}
                      {r.bathrooms && <div><span className="text-gray-600 block">Bathrooms</span><span className="text-gray-300">{r.bathrooms}</span></div>}
                      {r.pet_hair && r.pet_hair !== 'none' && <div><span className="text-gray-600 block">Pet Hair</span><span className="text-gray-300 capitalize">{r.pet_hair}</span></div>}
                      {r.condition && r.condition !== 'maintenance' && <div><span className="text-gray-600 block">Condition</span><span className="text-gray-300 capitalize">{r.condition}</span></div>}
                    </div>

                    {r.message && (
                      <div className="mt-3">
                        <span className="text-xs text-gray-600 block mb-1">Message / Notes</span>
                        <p className="text-sm text-gray-300 bg-gray-800 rounded-lg p-3">{r.message}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 mt-4 flex-wrap">
                      {/* Primary: Accept as Lead */}
                      {!isConverted && (
                        <button
                          onClick={(e) => { e.stopPropagation(); acceptAsLead(r) }}
                          disabled={isConverting}
                          className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs font-semibold text-white transition-colors flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                          {isConverting ? 'Creating lead...' : 'Accept as Lead'}
                        </button>
                      )}

                      {isConverted && r.client_id && (
                        <Link to={`/clients/${r.client_id}`}
                          className="px-4 py-2 bg-green-900/40 border border-green-800 rounded-lg text-xs font-semibold text-green-400 flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                          </svg>
                          View Client
                        </Link>
                      )}

                      {/* Status buttons */}
                      {STATUS_OPTIONS.filter(s => s.value !== (r.status || 'new') && s.value !== 'converted').map(s => (
                        <button key={s.value}
                          onClick={(e) => { e.stopPropagation(); updateStatus(r.id, s.value) }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80 ${statusColor(s.value)}`}>
                          {s.label}
                        </button>
                      ))}

                      {/* Contact actions */}
                      <div className="flex gap-2 ml-auto">
                        {r.email && (
                          <a href={`mailto:${r.email}`}
                            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                            </svg>
                            Email
                          </a>
                        )}
                        {r.phone && (
                          <a href={`tel:${r.phone}`}
                            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                            </svg>
                            Call
                          </a>
                        )}
                      </div>
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
