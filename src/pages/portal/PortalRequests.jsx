import { useState, useEffect } from 'react'
import { usePortalAuth } from '../../lib/portalAuth'

const REQUEST_TYPES = [
  { value: 'one-time', label: 'One-Time Cleaning' },
  { value: 'recurring', label: 'Recurring Service' },
  { value: 'deep-clean', label: 'Deep Clean' },
  { value: 'issue', label: 'Report Issue' },
  { value: 'change', label: 'Request Change' },
  { value: 'cancel', label: 'Cancel Service' },
]

const STATUS_BADGES = {
  pending: 'bg-yellow-900/40 text-yellow-400',
  reviewed: 'bg-blue-900/40 text-blue-400',
  approved: 'bg-green-900/40 text-green-400',
  scheduled: 'bg-purple-900/40 text-purple-400',
  declined: 'bg-red-900/40 text-red-400',
  completed: 'bg-gray-800 text-gray-400',
}

export default function PortalRequests() {
  const { portalFetch } = usePortalAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    type: 'one-time',
    title: '',
    description: '',
    preferredDate: '',
    preferredTime: '',
  })

  useEffect(() => {
    loadRequests()
  }, [portalFetch])

  async function loadRequests() {
    try {
      const res = await portalFetch('/api/portal?action=service-requests')
      if (!res.ok) throw new Error('Failed to load requests')
      const data = await res.json()
      setRequests(data.requests || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const res = await portalFetch('/api/portal?action=service-request', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to submit request')
      }
      setForm({ type: 'one-time', title: '', description: '', preferredDate: '', preferredTime: '' })
      setShowForm(false)
      await loadRequests()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Service Requests</h1>
          <p className="text-sm text-gray-500 mt-1">Request services or report issues</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-medium text-white"
        >
          + New Request
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}

      {/* New request form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">New Service Request</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Request Type</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {REQUEST_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Title</label>
              <input
                type="text" required value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="Brief description of your request"
                maxLength={200}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Details (optional)</label>
              <textarea
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Any additional details..."
                rows={3}
                maxLength={2000}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Preferred Date (optional)</label>
                <input
                  type="date" value={form.preferredDate}
                  onChange={e => setForm({ ...form, preferredDate: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Preferred Time (optional)</label>
                <input
                  type="text" value={form.preferredTime}
                  onChange={e => setForm({ ...form, preferredTime: e.target.value })}
                  placeholder="e.g. Morning, 2:00 PM"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={submitting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Requests list */}
      {requests.length === 0 && !showForm ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15" />
          </svg>
          <p className="text-gray-500">No service requests yet</p>
          <button onClick={() => setShowForm(true)}
            className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium text-white">
            Make Your First Request
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => (
            <div key={req.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium">{req.title}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[req.status] || STATUS_BADGES.pending}`}>
                      {req.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="capitalize">{req.type?.replace('-', ' ')}</span>
                    <span>{formatDate(req.createdAt)}</span>
                    {req.preferredDate && <span>Preferred: {formatDate(req.preferredDate)}</span>}
                  </div>
                </div>
              </div>
              {req.description && (
                <p className="text-sm text-gray-400 mt-2">{req.description}</p>
              )}
              {req.adminNotes && (
                <div className="mt-2 p-2 bg-blue-900/20 border border-blue-900/30 rounded text-sm text-blue-300">
                  <span className="text-xs text-blue-500">Team response: </span>{req.adminNotes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDate(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}
