import { useState, useEffect } from 'react'
import { usePortalAuth } from '../../lib/portalAuth'

const STATUS_BADGES = {
  draft: 'bg-gray-800 text-gray-400',
  sent: 'bg-blue-900/40 text-blue-400',
  viewed: 'bg-purple-900/40 text-purple-400',
  accepted: 'bg-green-900/40 text-green-400',
  declined: 'bg-red-900/40 text-red-400',
}

export default function PortalQuotes() {
  const { portalFetch } = usePortalAuth()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await portalFetch('/api/portal?action=quotes')
        if (!res.ok) throw new Error('Failed to load quotes')
        const data = await res.json()
        setQuotes(data.quotes || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [portalFetch])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Quotes</h1>
        <p className="text-sm text-gray-500 mt-1">Your service quotes and estimates</p>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}

      {quotes.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-gray-500">No quotes yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map(quote => (
            <div key={quote.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === quote.id ? null : quote.id)}
                className="w-full text-left p-4 hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{quote.quoteNumber || 'Quote'}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[quote.status] || STATUS_BADGES.draft}`}>
                        {quote.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {quote.serviceType && <span>{quote.serviceType}</span>}
                      {quote.frequency && <span>/ {quote.frequency}</span>}
                      <span>{formatDate(quote.createdAt)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-white font-medium">${quote.total?.toFixed(2) || '0.00'}</p>
                    <svg className={`w-4 h-4 text-gray-500 mt-1 ml-auto transition-transform ${expanded === quote.id ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </div>
              </button>

              {expanded === quote.id && (
                <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
                  {quote.propertyAddress && (
                    <div className="text-sm">
                      <span className="text-gray-600">Property: </span>
                      <span className="text-gray-300">{quote.propertyAddress}</span>
                    </div>
                  )}
                  {quote.validUntil && (
                    <div className="text-sm">
                      <span className="text-gray-600">Valid until: </span>
                      <span className="text-gray-300">{formatDate(quote.validUntil)}</span>
                    </div>
                  )}
                  {quote.lineItems?.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-600 mb-2">Line Items</p>
                      <div className="space-y-1">
                        {quote.lineItems.map((item, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-gray-400">{item.description || item.name}</span>
                            <span className="text-gray-300">${(item.amount || item.total || 0).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {quote.notes && (
                    <div className="text-sm">
                      <span className="text-gray-600">Notes: </span>
                      <span className="text-gray-400">{quote.notes}</span>
                    </div>
                  )}
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
