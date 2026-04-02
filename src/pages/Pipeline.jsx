import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getClientsAsync, saveClientAsync,
  getJobsAsync, getInvoicesAsync,
  getPropertiesAsync, getQuotesAsync, saveQuoteAsync, saveJobAsync,
  savePropertyAsync, generateQuoteNumber, saveVisitAsync, lookupServiceTypeId,
} from '../lib/store'
import { isSupabaseConfigured, getSupabase } from '../lib/supabase'
import { CardSkeleton, StatusBadge } from '../components/ui'

// Linear workflow: Request → Quote Sent → Approved → Scheduled
const STAGES = [
  { id: 'new_request', label: 'New Requests', color: 'blue', desc: 'Needs quote' },
  { id: 'quote_sent', label: 'Quote Sent', color: 'purple', desc: 'Awaiting approval' },
  { id: 'approved', label: 'Approved', color: 'amber', desc: 'Needs scheduling' },
  { id: 'scheduled', label: 'Scheduled', color: 'green', desc: 'Active clients' },
]

export default function Pipeline() {
  const [clients, setClients] = useState([])
  const [allQuotes, setAllQuotes] = useState([])
  const [allJobs, setAllJobs] = useState([])
  const [allProperties, setAllProperties] = useState([])
  const [invoices, setInvoices] = useState([])
  const [requests, setRequests] = useState([])
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [acting, setActing] = useState(null)
  const [toast, setToast] = useState(null)
  const [dragCard, setDragCard] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)

  useEffect(() => { reload() }, [])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t) } }, [toast])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [c, q, j, p, inv] = await Promise.all([
        getClientsAsync(), getQuotesAsync(), getJobsAsync(),
        getPropertiesAsync(), getInvoicesAsync(),
      ])
      setClients(c); setAllQuotes(q); setAllJobs(j)
      setAllProperties(p); setInvoices(inv)

      // Fetch website requests + bookings
      try {
        const [reqRes, bookRes] = await Promise.all([
          fetch('/api/leads?action=list'),
          fetch('/api/leads?action=booking-list'),
        ])
        if (reqRes.ok) { const d = await reqRes.json(); setRequests(d.requests || []) }
        if (bookRes.ok) { const d = await bookRes.json(); setBookings(d.bookings || []) }
      } catch {}
    } catch {}
    setLoading(false)
  }, [])

  // ── Classify each client into a linear stage ──
  function getStage(client) {
    const quotes = allQuotes.filter(q => q.clientId === client.id)
    const jobs = allJobs.filter(j => j.clientId === client.id)

    // Has a scheduled/active job → Scheduled
    if (jobs.some(j => j.status === 'scheduled' || j.status === 'in-progress' || j.status === 'completed')) {
      return 'scheduled'
    }
    // Has an accepted quote but no job → Approved (needs scheduling)
    if (quotes.some(q => q.status === 'accepted')) {
      return 'approved'
    }
    // Has a sent/viewed quote → Quote Sent
    if (quotes.some(q => q.status === 'sent' || q.status === 'viewed')) {
      return 'quote_sent'
    }
    // Everything else (lead/prospect with no sent quote) → New Request
    return 'new_request'
  }

  // ── Unconverted website requests (not yet in CRM) ──
  const unconvertedRequests = useMemo(() => {
    return requests.filter(r =>
      r.status !== 'converted' && r.status !== 'lost'
    )
  }, [requests])

  // ── Build pipeline cards ──
  const pipelineCards = useMemo(() => {
    const cards = { new_request: [], quote_sent: [], approved: [], scheduled: [] }

    // Add unconverted website requests as cards in "New Requests"
    unconvertedRequests.forEach(req => {
      cards.new_request.push({
        type: 'request',
        id: req.id,
        name: req.name || 'Unknown',
        email: req.email,
        phone: req.phone,
        address: req.address,
        serviceType: req.service || req.service_type || 'Standard Clean',
        frequency: req.frequency,
        estimateMin: req.estimate_min,
        estimateMax: req.estimate_max,
        source: req.source || 'Website',
        createdAt: req.created_at,
        raw: req,
      })
    })

    // Add CRM clients in their appropriate stage
    clients.forEach(client => {
      if (client.status === 'inactive') return // skip archived
      const stage = getStage(client)
      const quotes = allQuotes.filter(q => q.clientId === client.id)
      const jobs = allJobs.filter(j => j.clientId === client.id)
      const props = allProperties.filter(p => p.clientId === client.id)
      const latestQuote = quotes[0]
      const revenue = invoices
        .filter(i => i.clientId === client.id && i.status === 'paid')
        .reduce((s, i) => s + (i.total || 0), 0)

      cards[stage].push({
        type: 'client',
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        address: props[0]?.addressLine1 || client.address,
        serviceType: latestQuote?.serviceType || jobs[0]?.serviceType || '',
        frequency: latestQuote?.frequency || '',
        estimateMin: latestQuote?.estimateMin,
        estimateMax: latestQuote?.estimateMax,
        finalPrice: latestQuote?.finalPrice,
        quoteStatus: latestQuote?.status,
        quoteId: latestQuote?.id,
        jobCount: jobs.length,
        revenue,
        source: client.source,
        createdAt: client.createdAt,
        client,
        latestQuote,
      })
    })

    // Sort each column by newest first
    Object.values(cards).forEach(arr => arr.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)))
    return cards
  }, [clients, allQuotes, allJobs, allProperties, invoices, unconvertedRequests])

  // ── Filter by search ──
  const filtered = useMemo(() => {
    if (!search) return pipelineCards
    const term = search.toLowerCase()
    const result = {}
    for (const [stage, cards] of Object.entries(pipelineCards)) {
      result[stage] = cards.filter(c =>
        (c.name || '').toLowerCase().includes(term) ||
        (c.email || '').toLowerCase().includes(term) ||
        (c.address || '').toLowerCase().includes(term)
      )
    }
    return result
  }, [pipelineCards, search])

  // ── ACTIONS ──

  // Stage 1: New Request → Send Quote (creates client + property + quote, sends it)
  async function sendQuote(card) {
    setActing(card.id)
    try {
      if (card.type === 'request') {
        // Convert request to client + property + quote, then send
        const req = card.raw
        const clientData = {
          name: req.name || 'Unknown',
          email: req.email || '',
          phone: req.phone || '',
          address: req.address || '',
          status: 'prospect',
          type: req.property_type || 'residential',
          source: req.source || 'Website',
          tags: [req.service, req.frequency, 'Website'].filter(Boolean),
        }
        const client = await saveClientAsync(clientData)

        // Create property
        if (req.address) {
          try {
            await savePropertyAsync({
              clientId: client.id,
              name: req.address.split(',')[0] || 'Primary',
              addressLine1: req.address,
              type: req.property_type || 'residential',
              sqft: req.sqft ? parseInt(req.sqft) : null,
              bathrooms: req.bathrooms ? parseInt(req.bathrooms) : null,
              bedrooms: req.bedrooms ? parseInt(req.bedrooms) : null,
              petHair: req.pet_hair || 'none',
              condition: req.condition || 'maintenance',
              isPrimary: true,
            })
          } catch {}
        }

        // Create and send quote
        const quote = await saveQuoteAsync({
          quoteNumber: generateQuoteNumber(),
          clientId: client.id,
          serviceType: req.service || 'standard',
          frequency: req.frequency || 'one-time',
          estimateMin: parseFloat(req.estimate_min) || 0,
          estimateMax: parseFloat(req.estimate_max) || 0,
          status: 'sent',
          sentAt: new Date().toISOString(),
          calcInputs: { sqft: req.sqft, bathrooms: req.bathrooms, bedrooms: req.bedrooms },
        })

        // Mark request as converted
        try {
          const sb = getSupabase()
          if (sb) {
            await sb.from('website_requests').update({ status: 'converted', client_id: client.id }).eq('id', req.id)
          }
        } catch {}

        // Send quote email if client has email
        if (client.email) {
          try {
            await fetch('/api/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'gmail-send',
                to: client.email,
                subject: `Your cleaning estimate — ${quote.quoteNumber}`,
                body: `Hi ${client.name.split(' ')[0]},\n\nThank you for your interest! Based on the details you provided, your estimated price is $${quote.estimateMin}–$${quote.estimateMax}.\n\nPlease review and approve your quote here:\nhttps://connecteam-proxy.vercel.app/quote.html?id=${quote.id}\n\nQuestions? Just reply to this email.\n\n— The Maine Cleaning Co.`,
              }),
            })
          } catch {}
        }

        setToast({ type: 'success', message: `Quote sent to ${client.name}` })
      } else {
        // Existing client — create quote if needed, then send
        const quote = card.latestQuote
        if (quote && quote.status === 'draft') {
          await saveQuoteAsync({ ...quote, status: 'sent', sentAt: new Date().toISOString() })

          if (card.email) {
            try {
              await fetch('/api/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'gmail-send',
                  to: card.email,
                  subject: `Your cleaning estimate — ${quote.quoteNumber}`,
                  body: `Hi ${card.name.split(' ')[0]},\n\nYour quote is ready for review:\nhttps://connecteam-proxy.vercel.app/quote.html?id=${quote.id}\n\n— The Maine Cleaning Co.`,
                }),
              })
            } catch {}
          }
          setToast({ type: 'success', message: `Quote sent to ${card.name}` })
        } else {
          // No quote yet — go to detail page to build one
          window.location.hash = `/clients/${card.id}?tab=quotes`
          return
        }
      }
    } catch (e) {
      console.error('Failed to send quote:', e)
      setToast({ type: 'error', message: 'Failed to send quote' })
    }
    setActing(null)
    reload()
  }

  // Stage 3: Approved → Create Job + Visit
  async function createJob(card) {
    setActing(card.id)
    try {
      const quote = card.latestQuote
      const serviceTypeId = await lookupServiceTypeId(card.serviceType || 'standard')
      const today = new Date().toISOString().split('T')[0]
      const job = await saveJobAsync({
        clientId: card.id,
        clientName: card.name,
        title: `${card.serviceType || 'Cleaning'} — ${card.name}`,
        date: today,
        startTime: '09:00',
        endTime: '12:00',
        status: 'scheduled',
        price: quote?.finalPrice || quote?.estimateMax || quote?.estimateMin || null,
        serviceType: card.serviceType,
        serviceTypeId,
        address: card.address,
        isRecurring: card.frequency && card.frequency !== 'one-time',
        recurrenceRule: card.frequency === 'weekly' ? 'weekly' : card.frequency === 'biweekly' ? 'biweekly' : card.frequency === 'monthly' ? 'monthly' : null,
        source: 'manual', isActive: true,
        preferredStartTime: '09:00', preferredEndTime: '12:00',
        recurrenceStartDate: today,
      })
      // Create first visit
      if (job?.id) {
        await saveVisitAsync({
          jobId: job.id, clientId: card.id,
          scheduledDate: today, scheduledStartTime: '09:00', scheduledEndTime: '12:00',
          status: 'scheduled', source: card.frequency && card.frequency !== 'one-time' ? 'recurring' : 'one_off',
          serviceTypeId, address: card.address, clientVisible: true,
        })
      }
      await saveClientAsync({ id: card.id, status: 'active' })
      setToast({ type: 'success', message: `Job created for ${card.name}` })
    } catch (e) {
      console.error('Failed to create job:', e)
      setToast({ type: 'error', message: 'Failed to create job' })
    }
    setActing(null)
    reload()
  }

  // Dismiss / mark lost
  async function dismissCard(card) {
    setActing(card.id)
    if (card.type === 'request') {
      try {
        const sb = getSupabase()
        if (sb) await sb.from('website_requests').update({ status: 'lost' }).eq('id', card.raw.id)
      } catch {}
    } else {
      await saveClientAsync({ id: card.id, status: 'inactive' })
    }
    setActing(null)
    reload()
  }

  // Drag and drop handlers
  function handleDragStart(card, fromStage) {
    setDragCard({ ...card, fromStage })
  }

  function handleDragEnd() {
    setDragCard(null)
    setDragOverStage(null)
  }

  async function handleDrop(toStageId) {
    setDragOverStage(null)
    if (!dragCard || dragCard.fromStage === toStageId) { setDragCard(null); return }

    // Determine the action based on source → destination
    const from = dragCard.fromStage
    const to = toStageId

    if (from === 'new_request' && to === 'quote_sent') {
      await sendQuote(dragCard)
    } else if ((from === 'quote_sent' || from === 'new_request') && to === 'approved') {
      // Accept the quote
      if (dragCard.type === 'client' && dragCard.quoteId) {
        const q = allQuotes.find(q => q.id === dragCard.quoteId)
        if (q) await saveQuoteAsync({ ...q, status: 'accepted', acceptedAt: new Date().toISOString() })
      }
      reload()
    } else if ((from === 'approved' || from === 'quote_sent') && to === 'scheduled') {
      await createJob(dragCard)
    } else {
      setToast({ type: 'error', message: `Can't move directly from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}` })
    }
    setDragCard(null)
  }

  // Stats
  const stats = {
    newRequests: (filtered.new_request || []).length,
    quoteSent: (filtered.quote_sent || []).length,
    approved: (filtered.approved || []).length,
    scheduled: (filtered.scheduled || []).length,
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-full mx-auto space-y-4 animate-fade-in">
        <div><h1 className="text-2xl font-bold text-white">Pipeline</h1><p className="text-sm text-gray-500 mt-1">Loading workflow...</p></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <div className="h-5 w-24 bg-gray-800 rounded animate-pulse" />
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="bg-gray-800/50 rounded-lg p-3 space-y-2">
                  <div className="h-4 w-3/4 bg-gray-800 rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-gray-800/60 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-full mx-auto space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">
            {stats.newRequests} new &middot; {stats.quoteSent} quoted &middot; {stats.approved} approved &middot; {stats.scheduled} active
          </p>
        </div>
        <div className="relative w-64">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 pl-9 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-600"
          />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`p-3 rounded-lg text-sm ${
          toast.type === 'success' ? 'bg-green-900/30 border border-green-800 text-green-300' :
          'bg-red-900/30 border border-red-800 text-red-300'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Linear progress bar */}
      <div className="flex items-center gap-1">
        {STAGES.map((stage, i) => {
          const count = (filtered[stage.id] || []).length
          return (
            <div key={stage.id} className="flex items-center flex-1">
              <div className={`flex-1 h-1.5 rounded-full ${
                stage.color === 'blue' ? 'bg-blue-500/40' :
                stage.color === 'purple' ? 'bg-purple-500/40' :
                stage.color === 'amber' ? 'bg-amber-500/40' : 'bg-green-500/40'
              }`}>
                <div className={`h-full rounded-full transition-all ${
                  stage.color === 'blue' ? 'bg-blue-500' :
                  stage.color === 'purple' ? 'bg-purple-500' :
                  stage.color === 'amber' ? 'bg-amber-500' : 'bg-green-500'
                }`} style={{ width: count > 0 ? '100%' : '0%' }} />
              </div>
              {i < STAGES.length - 1 && (
                <svg className="w-4 h-4 text-gray-700 mx-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          )
        })}
      </div>

      {/* Kanban columns */}
      <div className="flex md:grid md:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3 min-h-[500px] overflow-x-auto pb-2">
        {STAGES.map(stage => {
          const cards = filtered[stage.id] || []
          return (
            <div key={stage.id}
              onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id) }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={e => { e.preventDefault(); handleDrop(stage.id) }}
              className={`bg-gray-900/50 border rounded-xl flex flex-col min-w-[260px] md:min-w-0 shrink-0 md:shrink transition-colors ${
                dragOverStage === stage.id ? 'border-blue-500/50 bg-blue-950/10' : 'border-gray-800'
              }`}>
              {/* Column header */}
              <div className="px-4 py-3 border-b border-gray-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      stage.color === 'blue' ? 'bg-blue-500' :
                      stage.color === 'purple' ? 'bg-purple-500' :
                      stage.color === 'amber' ? 'bg-amber-500' : 'bg-green-500'
                    }`} />
                    <span className="text-sm font-semibold text-white">{stage.label}</span>
                  </div>
                  <span className="text-xs text-gray-500 bg-gray-800 rounded-full px-2 py-0.5">{cards.length}</span>
                </div>
                <p className="text-xs text-gray-600 mt-0.5">{stage.desc}</p>
              </div>

              {/* Cards */}
              <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                {cards.map(card => (
                  <div key={card.id} draggable
                    onDragStart={() => handleDragStart(card, stage.id)}
                    onDragEnd={handleDragEnd}
                    className={`bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-all cursor-grab active:cursor-grabbing ${
                      dragCard?.id === card.id ? 'opacity-40 scale-95' : ''
                    }`}>
                    {/* Name + link */}
                    {card.type === 'client' ? (
                      <Link to={`/clients/${card.id}`} className="text-sm font-medium text-white hover:text-blue-400 block">{card.name}</Link>
                    ) : (
                      <span className="text-sm font-medium text-white block">{card.name}</span>
                    )}

                    {/* Contact */}
                    {(card.email || card.phone) && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{card.email || card.phone}</p>
                    )}

                    {/* Service + address */}
                    {card.serviceType && (
                      <p className="text-xs text-gray-400 mt-1">{card.serviceType}{card.frequency && card.frequency !== 'one-time' ? ` · ${card.frequency}` : ''}</p>
                    )}
                    {card.address && (
                      <p className="text-xs text-gray-600 mt-0.5 truncate">{card.address}</p>
                    )}

                    {/* Price */}
                    {(card.finalPrice || card.estimateMin) && (
                      <p className="text-xs font-mono mt-1.5">
                        <span className={stage.id === 'scheduled' ? 'text-green-400' : 'text-blue-400'}>
                          {card.finalPrice ? `$${card.finalPrice}` : `$${card.estimateMin}–$${card.estimateMax}`}
                        </span>
                        {card.frequency && card.frequency !== 'one-time' && (
                          <span className="text-gray-600 ml-1">/{card.frequency}</span>
                        )}
                      </p>
                    )}

                    {/* Revenue for scheduled */}
                    {card.revenue > 0 && (
                      <p className="text-xs text-green-500/70 mt-0.5">${card.revenue.toFixed(0)} earned</p>
                    )}

                    {/* Source + age */}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-700">{card.source || ''}</span>
                      <span className="text-xs text-gray-700">
                        {card.createdAt ? `${Math.floor((Date.now() - new Date(card.createdAt)) / 86400000)}d` : ''}
                      </span>
                    </div>

                    {/* ONE action per stage */}
                    <div className="mt-2 flex gap-1.5">
                      {stage.id === 'new_request' && (
                        <>
                          <button
                            onClick={() => sendQuote(card)}
                            disabled={acting === card.id}
                            className="flex-1 px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors"
                          >
                            {acting === card.id ? 'Sending...' : 'Send Quote'}
                          </button>
                          <button onClick={() => dismissCard(card)}
                            className="px-2 py-1.5 text-gray-600 hover:text-red-400 text-xs">
                            Dismiss
                          </button>
                        </>
                      )}
                      {stage.id === 'quote_sent' && (
                        <span className="text-xs text-purple-400/60 italic">Waiting for approval...</span>
                      )}
                      {stage.id === 'approved' && (
                        <button
                          onClick={() => createJob(card)}
                          disabled={acting === card.id}
                          className="flex-1 px-2.5 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors"
                        >
                          {acting === card.id ? 'Creating...' : 'Create Job'}
                        </button>
                      )}
                      {stage.id === 'scheduled' && card.type === 'client' && (
                        <Link to={`/clients/${card.id}`}
                          className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors">
                          View Client
                        </Link>
                      )}
                    </div>
                  </div>
                ))}

                {cards.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-700">
                    <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p className="text-xs">No {stage.label.toLowerCase()}</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Webhook info (collapsed) */}
      <details className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Lead intake endpoints</summary>
        <div className="mt-3 space-y-2 text-xs">
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-gray-400 font-medium">Website Form:</p>
            <code className="text-blue-400">POST https://connecteam-proxy.vercel.app/api/leads</code>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-gray-400 font-medium">Self-Booking Form:</p>
            <code className="text-blue-400">POST https://connecteam-proxy.vercel.app/api/leads?action=booking</code>
          </div>
        </div>
      </details>
    </div>
  )
}
