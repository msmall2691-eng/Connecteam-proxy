import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { saveClient, saveClientAsync, getClientAsync, saveProperty, savePropertyAsync, getPropertiesAsync, getQuotesAsync, getJobsAsync, saveQuote, saveQuoteAsync, saveJobAsync, saveJob, saveVisitAsync, generateQuoteNumber, lookupServiceTypeId } from '../lib/store'
import { isSupabaseConfigured, getSupabase } from '../lib/supabase'

const STATUS_OPTIONS = [
  { value: 'new', label: 'New', color: 'blue' },
  { value: 'contacted', label: 'Contacted', color: 'yellow' },
  { value: 'quoted', label: 'Quoted', color: 'purple' },
  { value: 'converted', label: 'Converted', color: 'green' },
  { value: 'lost', label: 'Lost', color: 'gray' },
]

const SOURCE_OPTIONS = ['All Sources', 'Website', 'Facebook', 'Google', 'Referral', 'Yelp', 'Other']

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
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('All Sources')
  const [dateRange, setDateRange] = useState('all')
  const [bulkActioning, setBulkActioning] = useState(false)
  const [clientInfoCache, setClientInfoCache] = useState({})
  const [bookings, setBookings] = useState([])
  const [bookingApproving, setBookingApproving] = useState(null)
  const [bookingRejecting, setBookingRejecting] = useState(null)
  const [bookingNotes, setBookingNotes] = useState('')
  const [bookingAssignee, setBookingAssignee] = useState('')
  const [bookingStartTime, setBookingStartTime] = useState('09:00')
  const [bookingEndTime, setBookingEndTime] = useState('12:00')
  // Quote editor state
  const [editingQuote, setEditingQuote] = useState(null) // { reqId, price, frequency, service, notes }
  const [sendingQuote, setSendingQuote] = useState(null)

  const fetchBookings = useCallback(async () => {
    try {
      const res = await fetch('/api/leads?action=booking-list')
      if (res.ok) {
        const data = await res.json()
        setBookings(data.bookings || [])
      }
    } catch (e) { console.error('Failed to fetch bookings:', e) }
  }, [])

  useEffect(() => {
    fetchRequests()
    fetchBookings()
    const interval = setInterval(() => { fetchRequests(); fetchBookings() }, 30000)
    return () => clearInterval(interval)
  }, [])

  // Fetch linked client info for converted requests
  useEffect(() => {
    const convertedWithClients = requests.filter(r => r.status === 'converted' && r.client_id && !clientInfoCache[r.client_id])
    if (convertedWithClients.length === 0) return
    convertedWithClients.forEach(async (r) => {
      try {
        const [client, quotes, jobs] = await Promise.all([
          isSupabaseConfigured() ? getClientAsync(r.client_id) : null,
          isSupabaseConfigured() ? getQuotesAsync(r.client_id) : [],
          isSupabaseConfigured() ? getJobsAsync(r.client_id) : [],
        ])
        setClientInfoCache(prev => ({
          ...prev,
          [r.client_id]: {
            name: client?.name || r.name || 'Unknown',
            quoteCount: quotes?.length || 0,
            latestQuoteStatus: quotes?.[0]?.status || null,
            jobCount: jobs?.length || 0,
          }
        }))
      } catch (e) {
        console.error('Failed to fetch client info for', r.client_id, e)
      }
    })
  }, [requests])

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
          companyName: req.company_name || req.companyName || '',
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
            req.bedrooms ? `Bedrooms: ${req.bedrooms}` : '',
            req.preferred_day || req.preferredDay ? `Preferred day: ${req.preferred_day || req.preferredDay}` : '',
            req.preferred_time || req.preferredTime ? `Preferred time: ${req.preferred_time || req.preferredTime}` : '',
            (req.company_name || req.companyName) ? `Company: ${req.company_name || req.companyName}` : '',
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
            bedrooms: req.bedrooms ? parseInt(req.bedrooms) : null,
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
            calcInputs: { sqft: req.sqft, bathrooms: req.bathrooms, bedrooms: req.bedrooms, petHair: req.pet_hair, condition: req.condition },
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

  // Match a booking to a request by email or name
  function getBookingForRequest(req) {
    if (!req || !bookings.length) return null
    if (req.email) {
      const match = bookings.find(b => b.email && b.email.toLowerCase() === req.email.toLowerCase())
      if (match) return match
    }
    if (req.name) {
      const match = bookings.find(b => b.name && b.name.toLowerCase() === req.name.toLowerCase() && b.address && req.address && b.address.includes(req.address.split(',')[0]))
      if (match) return match
    }
    return null
  }

  // Accept & Schedule: creates client + property + quote + job + approves booking + calendar in one click
  async function acceptAndSchedule(req, booking) {
    setConverting(req.id)
    try {
      // 1. Create or find client (reuse acceptAsLead logic)
      let client = null
      if (req.client_id && isSupabaseConfigured()) {
        try { client = await getClientAsync(req.client_id) } catch {}
      }
      if (!client) {
        const clientData = {
          name: req.name || 'Unknown',
          email: req.email || '',
          phone: req.phone || '',
          address: req.address || '',
          companyName: req.company_name || req.companyName || '',
          status: 'active',
          type: req.property_type || req.propertyType || 'residential',
          source: req.source || 'Website',
          notes: [
            req.estimate_min ? `Estimate: $${req.estimate_min}–$${req.estimate_max}` : '',
            req.message || '',
            req.service ? `Service: ${req.service}` : '',
            req.frequency ? `Frequency: ${req.frequency}` : '',
          ].filter(Boolean).join('\n'),
          tags: [req.service, req.frequency, 'self-booked'].filter(Boolean),
        }
        client = isSupabaseConfigured() ? await saveClientAsync(clientData) : saveClient(clientData)
      } else {
        // Update existing client to active
        if (isSupabaseConfigured()) {
          try {
            const sb = getSupabase()
            if (sb) await sb.from('clients').update({ status: 'active' }).eq('id', client.id)
          } catch {}
        }
      }

      // 2. Create property
      if (client && req.address) {
        let hasProperty = false
        if (isSupabaseConfigured()) {
          try { const existing = await getPropertiesAsync(client.id); hasProperty = existing.length > 0 } catch {}
        }
        if (!hasProperty) {
          const propData = {
            clientId: client.id, name: req.address.split(',')[0] || 'Primary',
            addressLine1: req.address, type: req.property_type || 'residential',
            sqft: req.sqft ? parseInt(req.sqft) : null, bathrooms: req.bathrooms ? parseInt(req.bathrooms) : null,
            petHair: req.pet_hair || 'none', condition: req.condition || 'maintenance', isPrimary: true,
          }
          try { isSupabaseConfigured() ? await savePropertyAsync(propData) : saveProperty(propData) } catch {}
        }
      }

      // 3. Create quote
      if (client && req.estimate_min) {
        let hasQuote = false
        if (isSupabaseConfigured()) {
          try { const existing = await getQuotesAsync(client.id); hasQuote = existing.length > 0 } catch {}
        }
        if (!hasQuote) {
          const quoteData = {
            quoteNumber: generateQuoteNumber(), clientId: client.id,
            serviceType: req.service || 'standard', frequency: req.frequency || 'one-time',
            estimateMin: parseFloat(req.estimate_min), estimateMax: parseFloat(req.estimate_max),
            status: 'accepted', notes: 'Self-booked via website',
          }
          try { isSupabaseConfigured() ? await saveQuoteAsync(quoteData) : saveQuote(quoteData) } catch {}
        }
      }

      // 4. Create job + visit
      if (client && booking) {
        const serviceTypeId = await lookupServiceTypeId(req.service || 'standard')
        const jobDate = booking.requested_date ? booking.requested_date.split('T')[0] : new Date().toISOString().split('T')[0]
        const jobData = {
          clientId: client.id, clientName: client.name,
          title: `Cleaning - ${client.name}`,
          date: jobDate,
          startTime: bookingStartTime, endTime: bookingEndTime,
          status: 'scheduled', serviceType: req.service || 'standard',
          serviceTypeId,
          address: req.address, price: req.estimate_min ? parseInt(req.estimate_min) : null,
          notes: 'Booked via website self-booking',
          assignee: bookingAssignee || null,
          source: 'booking_request', isActive: true,
        }
        let savedJob = null
        try { savedJob = isSupabaseConfigured() ? await saveJobAsync(jobData) : saveJob(jobData) } catch (e) { console.error('Job creation failed:', e) }

        // Create corresponding visit
        if (savedJob?.id) {
          try {
            await saveVisitAsync({
              jobId: savedJob.id, clientId: client.id,
              scheduledDate: jobDate, scheduledStartTime: bookingStartTime, scheduledEndTime: bookingEndTime,
              status: 'scheduled', source: 'booking',
              serviceTypeId, address: req.address, clientVisible: true,
            })
          } catch (e) { console.error('Visit creation failed:', e) }
        }
      }

      // 5. Approve booking in CRM
      if (booking && booking.status === 'pending') {
        try {
          await fetch('/api/leads?action=booking-approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: booking.id,
              adminNotes: bookingNotes || 'Accepted via Requests page',
              assignee: bookingAssignee,
              startTime: bookingStartTime,
              endTime: bookingEndTime,
            }),
          })
        } catch (e) { console.error('Booking approve failed:', e) }
      }

      // 6. Update request status
      updateStatus(req.id, 'converted', client.id)
      setSuccessMessage({ id: req.id, clientId: client.id, name: req.name, scheduled: true })
      setTimeout(() => setSuccessMessage(null), 5000)
      fetchBookings()
      setBookingNotes('')
      setBookingAssignee('')
    } catch (e) {
      console.error('Accept & Schedule failed:', e)
    }
    setConverting(null)
  }

  function startEditQuote(req) {
    setEditingQuote({
      reqId: req.id,
      clientId: req.client_id,
      price: req.estimate_min || '',
      priceMax: req.estimate_max || '',
      frequency: req.frequency || 'one-time',
      service: req.service || 'standard',
      notes: '',
      extras: '',
    })
  }

  async function sendQuoteForApproval() {
    if (!editingQuote?.clientId) return
    setSendingQuote(editingQuote.reqId)
    try {
      // Find or create the quote for this client
      const quotes = isSupabaseConfigured() ? await getQuotesAsync(editingQuote.clientId) : []
      const draftQuote = quotes.find(q => q.status === 'draft')

      const quoteData = {
        ...(draftQuote || {}),
        clientId: editingQuote.clientId,
        serviceType: editingQuote.service,
        frequency: editingQuote.frequency,
        finalPrice: parseFloat(editingQuote.price) || 0,
        estimateMin: parseFloat(editingQuote.price) || 0,
        estimateMax: parseFloat(editingQuote.priceMax) || parseFloat(editingQuote.price) || 0,
        notes: [editingQuote.notes, editingQuote.extras].filter(Boolean).join('\n'),
        status: 'sent',
        sentAt: new Date().toISOString(),
      }
      if (!quoteData.quoteNumber) quoteData.quoteNumber = generateQuoteNumber()

      const saved = isSupabaseConfigured() ? await saveQuoteAsync(quoteData) : saveQuote(quoteData)

      // Send the approval email via /api/leads
      if (saved?.id) {
        try {
          await fetch('/api/leads?action=send-quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quoteId: saved.id, clientId: editingQuote.clientId }),
          })
        } catch {}
      }

      updateStatus(editingQuote.reqId, 'quoted', editingQuote.clientId)
      setEditingQuote(null)
      setSuccessMessage({ id: editingQuote.reqId, name: 'Quote', clientId: editingQuote.clientId, scheduled: false })
      setTimeout(() => setSuccessMessage(null), 5000)
    } catch (e) { console.error('Send quote failed:', e) }
    setSendingQuote(null)
  }

  async function rejectBooking(bookingId) {
    setBookingRejecting(bookingId)
    try {
      await fetch('/api/leads?action=booking-reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, adminNotes: bookingNotes || 'Date not available' }),
      })
      fetchBookings()
      setBookingNotes('')
    } catch (e) { console.error('Reject failed:', e) }
    setBookingRejecting(null)
  }

  const pendingBookingCount = bookings.filter(b => b.status === 'pending').length

  const filtered = useMemo(() => {
    let result = requests
    if (filter === 'booked') {
      result = result.filter(r => getBookingForRequest(r))
    } else if (filter !== 'all') {
      result = result.filter(r => r.status === filter)
    }
    if (sourceFilter !== 'All Sources') result = result.filter(r => (r.source || 'Website') === sourceFilter)
    if (search) {
      const s = search.toLowerCase()
      result = result.filter(r =>
        (r.name || '').toLowerCase().includes(s) ||
        (r.email || '').toLowerCase().includes(s) ||
        (r.phone || '').includes(s) ||
        (r.address || '').toLowerCase().includes(s) ||
        (r.company_name || r.companyName || '').toLowerCase().includes(s)
      )
    }
    if (dateRange !== 'all') {
      const days = parseInt(dateRange)
      const cutoff = new Date(Date.now() - days * 86400000).toISOString()
      result = result.filter(r => (r.created_at || '') >= cutoff)
    }
    return result
  }, [requests, filter, sourceFilter, search, dateRange])

  const newCount = requests.filter(r => r.status === 'new').length

  async function markAllContacted() {
    setBulkActioning(true)
    const newReqs = requests.filter(r => r.status === 'new')
    for (const r of newReqs) {
      await updateStatus(r.id, 'contacted')
    }
    setBulkActioning(false)
  }

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
            {pendingBookingCount > 0 && (
              <span className="px-2.5 py-0.5 bg-amber-600 text-white text-xs font-bold rounded-full animate-pulse">
                {pendingBookingCount} pending booking{pendingBookingCount !== 1 ? 's' : ''}
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
              <strong>{successMessage.name}</strong> {successMessage.scheduled ? 'accepted & scheduled — job created, calendar updated' : 'added to your Pipeline as a lead'}
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

      {/* Search + Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, phone, address..."
            className="flex-1 min-w-[200px] max-w-xs px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white">
            {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {[{ v: 'all', l: 'All' }, { v: '7', l: '7d' }, { v: '30', l: '30d' }].map(d => (
              <button key={d.v} onClick={() => setDateRange(d.v)}
                className={`px-2.5 py-1.5 text-xs ${dateRange === d.v ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                {d.l}
              </button>
            ))}
          </div>
          {newCount > 0 && (
            <button onClick={markAllContacted} disabled={bulkActioning}
              className="px-3 py-1.5 bg-yellow-600/20 border border-yellow-800 rounded-lg text-xs text-yellow-400 hover:bg-yellow-600/30 disabled:opacity-50">
              {bulkActioning ? 'Updating...' : `Mark all ${newCount} new as contacted`}
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:bg-gray-800'}`}>
            All ({requests.length})
          </button>
          {bookings.length > 0 && (
            <button onClick={() => setFilter('booked')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'booked' ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:bg-gray-800'}`}>
              Booked ({bookings.length})
            </button>
          )}
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
            const linkedInfo = isConverted && r.client_id ? clientInfoCache[r.client_id] : null
            const booking = getBookingForRequest(r)
            const hasBooking = !!booking
            const bookingPending = booking?.status === 'pending'
            const bookingApproved = booking?.status === 'approved'

            return (
              <div key={r.id || r.created_at}
                className={`bg-gray-900 border rounded-xl overflow-hidden transition-colors ${
                  bookingPending ? 'border-amber-800/50 shadow-lg shadow-amber-900/10' :
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
                      {hasBooking && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          bookingPending ? 'bg-amber-900/40 text-amber-400 border border-amber-800' :
                          bookingApproved ? 'bg-green-900/40 text-green-400 border border-green-800' :
                          'bg-red-900/40 text-red-400 border border-red-800'
                        }`}>
                          {bookingPending ? '📅 Booked ' : bookingApproved ? '✓ Scheduled ' : '✗ Declined '}
                          {booking.requested_date ? new Date(booking.requested_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                        </span>
                      )}
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
                      onClick={(e) => { e.stopPropagation(); bookingPending ? acceptAndSchedule(r, booking) : acceptAsLead(r) }}
                      disabled={isConverting}
                      className={`px-3 py-1.5 ${bookingPending ? 'bg-amber-600 hover:bg-amber-500' : 'bg-green-600 hover:bg-green-500'} disabled:opacity-50 rounded-lg text-xs font-medium text-white shrink-0 transition-colors`}>
                      {isConverting ? 'Working...' : bookingPending ? 'Accept & Schedule' : 'Accept'}
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
                      {(r.company_name || r.companyName) && <div><span className="text-gray-600 block">Company</span><span className="text-gray-300">{r.company_name || r.companyName}</span></div>}
                      {r.sqft && <div><span className="text-gray-600 block">Sq Ft</span><span className="text-gray-300">{Number(r.sqft).toLocaleString()}</span></div>}
                      {r.bedrooms && <div><span className="text-gray-600 block">Bedrooms</span><span className="text-gray-300">{r.bedrooms}</span></div>}
                      {r.bathrooms && <div><span className="text-gray-600 block">Bathrooms</span><span className="text-gray-300">{r.bathrooms}</span></div>}
                      {r.pet_hair && r.pet_hair !== 'none' && <div><span className="text-gray-600 block">Pet Hair</span><span className="text-gray-300 capitalize">{r.pet_hair}</span></div>}
                      {r.condition && r.condition !== 'maintenance' && <div><span className="text-gray-600 block">Condition</span><span className="text-gray-300 capitalize">{r.condition}</span></div>}
                      {(r.preferred_day || r.preferredDay) && <div><span className="text-gray-600 block">Preferred Day</span><span className="text-gray-300">{r.preferred_day || r.preferredDay}</span></div>}
                      {(r.preferred_time || r.preferredTime) && <div><span className="text-gray-600 block">Preferred Time</span><span className="text-gray-300">{r.preferred_time || r.preferredTime}</span></div>}
                    </div>

                    {r.message && (
                      <div className="mt-3">
                        <span className="text-xs text-gray-600 block mb-1">Message / Notes</span>
                        <p className="text-sm text-gray-300 bg-gray-800 rounded-lg p-3">{r.message}</p>
                      </div>
                    )}

                    {/* Booking section (inline) */}
                    {hasBooking && (
                      <div className={`mt-3 rounded-lg p-3 border ${
                        bookingPending ? 'bg-amber-900/10 border-amber-900/40' :
                        bookingApproved ? 'bg-green-900/10 border-green-900/40' :
                        'bg-red-900/10 border-red-900/40'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold text-white">
                            {bookingPending ? '📅 Booking Request' : bookingApproved ? '✓ Booking Confirmed' : '✗ Booking Declined'}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            bookingPending ? 'bg-amber-800 text-amber-300' : bookingApproved ? 'bg-green-800 text-green-300' : 'bg-red-800 text-red-300'
                          }`}>{booking.status}</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-2">
                          <div><span className="text-gray-600 block">Date</span><span className="text-white font-medium">{booking.requested_date ? new Date(booking.requested_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'N/A'}</span></div>
                          {booking.distance_miles && <div><span className="text-gray-600 block">Distance</span><span className="text-gray-300">{booking.distance_miles} miles</span></div>}
                          {booking.estimate_min && <div><span className="text-gray-600 block">Estimate</span><span className="text-green-400 font-medium">${booking.estimate_min}–${booking.estimate_max}</span></div>}
                          <div><span className="text-gray-600 block">Service</span><span className="text-gray-300">{booking.service_type || 'standard'}</span></div>
                        </div>

                        {/* Approval form for pending bookings */}
                        {bookingPending && !isConverted && (
                          <div className="border-t border-gray-800 pt-2 mt-2 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-500 block mb-0.5">Start</label>
                                <input type="time" value={bookingStartTime} onChange={e => setBookingStartTime(e.target.value)}
                                  className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 block mb-0.5">End</label>
                                <input type="time" value={bookingEndTime} onChange={e => setBookingEndTime(e.target.value)}
                                  className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                              </div>
                            </div>
                            <input type="text" value={bookingAssignee} onChange={e => setBookingAssignee(e.target.value)}
                              placeholder="Assign to (optional)" className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white placeholder-gray-600" />
                            <input type="text" value={bookingNotes} onChange={e => setBookingNotes(e.target.value)}
                              placeholder="Notes (optional)" className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white placeholder-gray-600" />
                            <div className="flex gap-2">
                              <button onClick={() => acceptAndSchedule(r, booking)} disabled={isConverting}
                                className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-xs font-semibold text-white">
                                {isConverting ? 'Working...' : 'Accept & Schedule'}
                              </button>
                              <button onClick={() => rejectBooking(booking.id)} disabled={bookingRejecting === booking.id}
                                className="px-3 py-1.5 bg-gray-800 border border-red-800 text-red-400 hover:bg-red-900/20 disabled:opacity-50 rounded text-xs font-medium">
                                {bookingRejecting === booking.id ? 'Rejecting...' : 'Decline'}
                              </button>
                            </div>
                            <p className="text-xs text-gray-600 text-center">Creates client, property, quote, job + Google Calendar event</p>
                          </div>
                        )}

                        {/* Approved booking details */}
                        {bookingApproved && (
                          <div className="text-xs text-gray-500 space-y-0.5 mt-1">
                            {booking.google_event_id && <p>Google Calendar: <span className="text-green-400">created</span></p>}
                            {booking.approved_at && <p>Approved {new Date(booking.approved_at).toLocaleDateString()}</p>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Linked client info for converted requests */}
                    {isConverted && r.client_id && linkedInfo && (
                      <div className="mt-3 bg-green-900/20 border border-green-900/40 rounded-lg p-3">
                        <div className="flex items-center gap-3 text-xs">
                          <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                          </svg>
                          <div className="flex items-center gap-4 flex-wrap">
                            <Link to={`/clients/${r.client_id}`} className="text-green-400 font-medium hover:underline">
                              {linkedInfo.name}
                            </Link>
                            {linkedInfo.latestQuoteStatus && (
                              <span className="text-gray-400">
                                Quote: <span className="text-gray-300 capitalize">{linkedInfo.latestQuoteStatus}</span>
                                {linkedInfo.quoteCount > 1 && <span className="text-gray-500"> (+{linkedInfo.quoteCount - 1} more)</span>}
                              </span>
                            )}
                            <span className="text-gray-400">
                              {linkedInfo.jobCount} job{linkedInfo.jobCount !== 1 ? 's' : ''} scheduled
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Inline Quote Editor */}
                    {editingQuote?.reqId === (r.id || r.created_at) && (
                      <div className="mt-3 bg-blue-900/10 border border-blue-900/40 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-sm font-semibold text-white">Edit & Send Quote</span>
                          <span className="text-xs text-gray-500">Customer will receive an approval link</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div>
                            <label className="text-gray-500 block mb-1">Price ($)</label>
                            <input type="number" value={editingQuote.price} onChange={e => setEditingQuote(q => ({ ...q, price: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm" placeholder="180" />
                          </div>
                          <div>
                            <label className="text-gray-500 block mb-1">Max ($)</label>
                            <input type="number" value={editingQuote.priceMax} onChange={e => setEditingQuote(q => ({ ...q, priceMax: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm" placeholder="220" />
                          </div>
                          <div>
                            <label className="text-gray-500 block mb-1">Service</label>
                            <select value={editingQuote.service} onChange={e => setEditingQuote(q => ({ ...q, service: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm">
                              <option value="standard">Standard Clean</option>
                              <option value="deep">Deep Clean</option>
                              <option value="move-in-out">Move In/Out</option>
                              <option value="turnover">Turnover</option>
                              <option value="one-time">One-Time</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-gray-500 block mb-1">Frequency</label>
                            <select value={editingQuote.frequency} onChange={e => setEditingQuote(q => ({ ...q, frequency: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm">
                              <option value="one-time">One-time</option>
                              <option value="weekly">Weekly</option>
                              <option value="biweekly">Biweekly</option>
                              <option value="monthly">Monthly</option>
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Add-ons / Extras</label>
                            <input value={editingQuote.extras} onChange={e => setEditingQuote(q => ({ ...q, extras: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm" placeholder="Inside oven $35, Laundry $25..." />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Notes for customer</label>
                            <input value={editingQuote.notes} onChange={e => setEditingQuote(q => ({ ...q, notes: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm" placeholder="First visit includes deep clean..." />
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button onClick={sendQuoteForApproval} disabled={sendingQuote === editingQuote.reqId || !editingQuote.price}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-xs font-semibold text-white transition-colors">
                            {sendingQuote === editingQuote.reqId ? 'Sending...' : 'Send Quote for Approval'}
                          </button>
                          <button onClick={() => setEditingQuote(null)}
                            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-400 hover:bg-gray-700">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 mt-4 flex-wrap">
                      {/* Primary: Accept as Lead OR Accept & Schedule */}
                      {!isConverted && (
                        <button
                          onClick={(e) => { e.stopPropagation(); bookingPending ? acceptAndSchedule(r, booking) : acceptAsLead(r) }}
                          disabled={isConverting}
                          className={`px-4 py-2 ${bookingPending ? 'bg-amber-600 hover:bg-amber-500' : 'bg-green-600 hover:bg-green-500'} disabled:opacity-50 rounded-lg text-xs font-semibold text-white transition-colors flex items-center gap-1.5`}>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d={bookingPending ? "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5" : "M12 4.5v15m7.5-7.5h-15"} />
                          </svg>
                          {isConverting ? 'Working...' : bookingPending ? 'Accept & Schedule' : 'Accept as Lead'}
                        </button>
                      )}

                      {/* Review & Send Quote button */}
                      {!isConverted && r.client_id && r.estimate_min && !editingQuote && (
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditQuote(r) }}
                          className="px-4 py-2 bg-blue-600/20 border border-blue-800 rounded-lg text-xs font-semibold text-blue-400 hover:bg-blue-600/30 transition-colors flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                          </svg>
                          Review & Send Quote
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
