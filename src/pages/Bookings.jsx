import { useState, useEffect, useCallback } from 'react'

const STATUS_COLORS = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' },
  approved: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  rejected: { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500' },
}

export default function Bookings() {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [approving, setApproving] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [adminNotes, setAdminNotes] = useState('')
  const [assignee, setAssignee] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('12:00')
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })

  const fetchBookings = useCallback(async () => {
    try {
      const url = filter === 'all' ? '/api/leads?action=booking-list' : `/api/leads?action=booking-list&status=${filter}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setBookings(data.bookings || [])
      }
    } catch (e) {
      console.error('Failed to fetch bookings:', e)
    }
    setLoading(false)
  }, [filter])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/leads?action=booking-stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data.stats || { total: 0, pending: 0, approved: 0, rejected: 0 })
      }
    } catch (e) { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchBookings()
    fetchStats()
    const interval = setInterval(() => { fetchBookings(); fetchStats() }, 30000)
    return () => clearInterval(interval)
  }, [fetchBookings, fetchStats])

  async function approveBooking(id) {
    setApproving(id)
    try {
      const res = await fetch('/api/leads?action=booking-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: id, adminNotes, assignee, startTime, endTime }),
      })
      if (res.ok) {
        await fetchBookings()
        await fetchStats()
        setExpandedId(null)
        setAdminNotes('')
        setAssignee('')
      } else {
        const data = await res.json()
        alert('Approval failed: ' + (data.error || 'Unknown error'))
      }
    } catch (e) {
      alert('Approval failed: ' + e.message)
    }
    setApproving(null)
  }

  async function rejectBooking(id) {
    setRejecting(id)
    try {
      const res = await fetch('/api/leads?action=booking-reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: id, adminNotes }),
      })
      if (res.ok) {
        await fetchBookings()
        await fetchStats()
        setExpandedId(null)
        setAdminNotes('')
      }
    } catch (e) {
      alert('Rejection failed: ' + e.message)
    }
    setRejecting(null)
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'N/A'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  function formatEstimate(min, max) {
    if (!min) return 'Custom'
    return `$${min}-$${max}`
  }

  const filtered = bookings

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Booking Requests</h1>
        <p className="text-sm text-gray-500 mt-1">Self-bookings from the website. Approve to add to Google Calendar & Connecteam.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-gray-900' },
          { label: 'Pending', value: stats.pending, color: 'text-amber-600' },
          { label: 'Approved', value: stats.approved, color: 'text-green-600' },
          { label: 'Rejected', value: stats.rejected, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {['all', 'pending', 'approved', 'rejected'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'pending' && stats.pending > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">{stats.pending}</span>
            )}
          </button>
        ))}
      </div>

      {/* Bookings list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading bookings...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-gray-500">{filter === 'all' ? 'No booking requests yet.' : `No ${filter} bookings.`}</p>
          <p className="text-xs text-gray-400 mt-1">Bookings from the website will appear here for approval.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(booking => {
            const isExpanded = expandedId === booking.id
            const colors = STATUS_COLORS[booking.status] || STATUS_COLORS.pending
            const isPending = booking.status === 'pending'

            return (
              <div key={booking.id} className={`bg-white rounded-xl border ${isPending ? 'border-amber-200 ring-1 ring-amber-100' : 'border-gray-200'} overflow-hidden`}>
                {/* Summary row */}
                <button
                  onClick={() => { setExpandedId(isExpanded ? null : booking.id); setAdminNotes(''); setAssignee('') }}
                  className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colors.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-sm">{booking.name || 'Unknown'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors.bg} ${colors.text}`}>
                        {booking.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{formatDate(booking.requested_date)}</span>
                      <span>·</span>
                      <span>{booking.service_type || 'Cleaning'}</span>
                      <span>·</span>
                      <span>{formatEstimate(booking.estimate_min, booking.estimate_max)}</span>
                      {booking.distance_miles && (
                        <>
                          <span>·</span>
                          <span>{booking.distance_miles} mi</span>
                        </>
                      )}
                    </div>
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-4">
                    {/* Contact info */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Phone</p>
                        <a href={`tel:${booking.phone}`} className="text-blue-600 hover:underline">{booking.phone || 'N/A'}</a>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Email</p>
                        <a href={`mailto:${booking.email}`} className="text-blue-600 hover:underline">{booking.email || 'N/A'}</a>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-gray-500 font-medium">Address</p>
                        <p className="text-gray-900">{booking.address || 'N/A'}</p>
                      </div>
                    </div>

                    {/* Property details */}
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      {booking.sqft && (
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                          <p className="text-xs text-gray-500">Sq Ft</p>
                          <p className="font-semibold text-gray-900">{Number(booking.sqft).toLocaleString()}</p>
                        </div>
                      )}
                      {booking.bathrooms && (
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                          <p className="text-xs text-gray-500">Bathrooms</p>
                          <p className="font-semibold text-gray-900">{booking.bathrooms}</p>
                        </div>
                      )}
                      {booking.frequency && (
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                          <p className="text-xs text-gray-500">Frequency</p>
                          <p className="font-semibold text-gray-900">{booking.frequency}</p>
                        </div>
                      )}
                      {booking.pet_hair && booking.pet_hair !== 'none' && (
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                          <p className="text-xs text-gray-500">Pet Hair</p>
                          <p className="font-semibold text-gray-900">{booking.pet_hair}</p>
                        </div>
                      )}
                      {booking.condition && booking.condition !== 'maintenance' && (
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                          <p className="text-xs text-gray-500">Condition</p>
                          <p className="font-semibold text-gray-900">{booking.condition}</p>
                        </div>
                      )}
                    </div>

                    {/* Approval form (only for pending) */}
                    {isPending && (
                      <div className="border-t border-gray-100 pt-3 space-y-3">
                        <p className="text-sm font-semibold text-gray-900">Approve or Reject</p>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500 font-medium block mb-1">Start Time</label>
                            <input
                              type="time"
                              value={startTime}
                              onChange={e => setStartTime(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 font-medium block mb-1">End Time</label>
                            <input
                              type="time"
                              value={endTime}
                              onChange={e => setEndTime(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs text-gray-500 font-medium block mb-1">Assign to (optional)</label>
                          <input
                            type="text"
                            value={assignee}
                            onChange={e => setAssignee(e.target.value)}
                            placeholder="Employee name"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label className="text-xs text-gray-500 font-medium block mb-1">Notes (optional)</label>
                          <input
                            type="text"
                            value={adminNotes}
                            onChange={e => setAdminNotes(e.target.value)}
                            placeholder="Internal notes or message to customer"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => approveBooking(booking.id)}
                            disabled={approving === booking.id}
                            className="flex-1 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
                          >
                            {approving === booking.id ? 'Approving...' : 'Approve & Schedule'}
                          </button>
                          <button
                            onClick={() => rejectBooking(booking.id)}
                            disabled={rejecting === booking.id}
                            className="flex-1 bg-white text-red-600 border border-red-300 px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-red-50 disabled:opacity-50 transition-colors"
                          >
                            {rejecting === booking.id ? 'Rejecting...' : 'Reject'}
                          </button>
                        </div>

                        <p className="text-xs text-gray-400 text-center">
                          Approving creates a Google Calendar event and Connecteam shift.
                        </p>
                      </div>
                    )}

                    {/* Show approval details for approved bookings */}
                    {booking.status === 'approved' && (
                      <div className="border-t border-gray-100 pt-3 space-y-2">
                        {booking.google_event_id && (
                          <p className="text-xs text-gray-500">Google Calendar: <span className="text-green-600 font-medium">Created</span></p>
                        )}
                        {booking.connecteam_shift_id && (
                          <p className="text-xs text-gray-500">Connecteam Shift: <span className="text-green-600 font-medium">Created</span></p>
                        )}
                        {booking.admin_notes && (
                          <p className="text-xs text-gray-500">Notes: <span className="text-gray-700">{booking.admin_notes}</span></p>
                        )}
                        {booking.approved_at && (
                          <p className="text-xs text-gray-400">Approved {new Date(booking.approved_at).toLocaleDateString()}</p>
                        )}
                      </div>
                    )}

                    {booking.status === 'rejected' && booking.admin_notes && (
                      <div className="border-t border-gray-100 pt-3">
                        <p className="text-xs text-gray-500">Rejection reason: <span className="text-gray-700">{booking.admin_notes}</span></p>
                      </div>
                    )}

                    {/* Created timestamp */}
                    <p className="text-xs text-gray-400">
                      Requested {new Date(booking.created_at).toLocaleString()}
                      {booking.source && ` via ${booking.source}`}
                    </p>
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
