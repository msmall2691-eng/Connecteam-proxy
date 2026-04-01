import { useState, useEffect } from 'react'
import { usePortalAuth } from '../../lib/portalAuth'

const STATUS_BADGES = {
  draft: 'bg-gray-800 text-gray-400',
  sent: 'bg-blue-900/40 text-blue-400',
  paid: 'bg-green-900/40 text-green-400',
  overdue: 'bg-red-900/40 text-red-400',
}

export default function PortalInvoices() {
  const { portalFetch } = usePortalAuth()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await portalFetch('/api/portal?action=invoices')
        if (!res.ok) throw new Error('Failed to load invoices')
        const data = await res.json()
        setInvoices(data.invoices || [])
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
        <h1 className="text-2xl font-bold text-white">Invoices</h1>
        <p className="text-sm text-gray-500 mt-1">Your billing history and outstanding invoices</p>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}

      {invoices.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75" />
          </svg>
          <p className="text-gray-500">No invoices yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map(inv => (
            <div key={inv.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
                className="w-full text-left p-4 hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{inv.invoiceNumber || 'Invoice'}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[inv.status] || STATUS_BADGES.draft}`}>
                        {inv.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>Issued: {formatDate(inv.issueDate)}</span>
                      {inv.dueDate && <span>Due: {formatDate(inv.dueDate)}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-white font-medium">${inv.total?.toFixed(2) || '0.00'}</p>
                    <svg className={`w-4 h-4 text-gray-500 mt-1 ml-auto transition-transform ${expanded === inv.id ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </div>
              </button>

              {expanded === inv.id && (
                <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
                  {inv.lineItems?.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-600 mb-2">Line Items</p>
                      <div className="space-y-1">
                        {inv.lineItems.map((item, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-gray-400">{item.description || item.name}</span>
                            <span className="text-gray-300">${(item.amount || item.total || 0).toFixed(2)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-sm font-medium pt-2 border-t border-gray-800">
                          <span className="text-gray-300">Total</span>
                          <span className="text-white">${inv.total?.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {inv.paidAt && (
                    <div className="text-sm">
                      <span className="text-gray-600">Paid on: </span>
                      <span className="text-green-400">{formatDate(inv.paidAt)}</span>
                    </div>
                  )}
                  {inv.notes && (
                    <div className="text-sm">
                      <span className="text-gray-600">Notes: </span>
                      <span className="text-gray-400">{inv.notes}</span>
                    </div>
                  )}
                  {inv.paymentUrl && (inv.status === 'sent' || inv.status === 'overdue') && (
                    <a
                      href={inv.paymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium text-white transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                      </svg>
                      Pay Now
                    </a>
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
