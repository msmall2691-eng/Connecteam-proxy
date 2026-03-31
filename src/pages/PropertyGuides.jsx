import { useState, useEffect } from 'react'

export default function PropertyGuides() {
  const [forms, setForms] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/customer-form?action=list')
      .then(r => r.json())
      .then(data => { setForms(data.forms || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const baseUrl = window.location.origin

  const [copied, setCopied] = useState(null)

  function copyLink(path, label) {
    navigator.clipboard.writeText(baseUrl + path)
    setCopied(label || path)
    setTimeout(() => setCopied(null), 2000)
  }

  function deleteForm(id) {
    if (!confirm('Delete this property guide?')) return
    fetch(`/api/customer-form?action=delete&id=${id}`)
      .then(() => setForms(forms.filter(f => f.id !== id)))
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Property Guides</h1>
          <p className="text-sm text-gray-500 mt-1">Customer property info forms for turnover guides</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => copyLink('/customer-form.html')}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.07a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.343 8.82" />
            </svg>
            Copy Blank Form Link
          </button>
          <a
            href="/customer-form.html"
            target="_blank"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Form
          </a>
        </div>
      </div>

      {/* Copied toast */}
      {copied && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg animate-pulse">
          Link copied!
        </div>
      )}

      {/* Info banner */}
      <div className="bg-blue-900/20 border border-blue-800/30 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-300">
          Send the form link to customers to collect property details. Submitted forms auto-generate beautiful turnover guides your team can reference.
        </p>
        <p className="text-xs text-blue-400/60 mt-2">
          Blank form: <code className="text-blue-400">{baseUrl}/customer-form.html</code>
        </p>
        <p className="text-xs text-blue-400/60 mt-1">
          Clients can edit anytime using their unique form link (copy it from any property below).
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          Loading...
        </div>
      ) : forms.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <svg className="w-12 h-12 mx-auto mb-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-gray-400 font-medium">No property guides yet</p>
          <p className="text-sm mt-1">Send the form link to a customer or create one yourself</p>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map(form => (
            <div key={form.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
              {/* Top row: name + status */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 min-w-0">
                  <h3 className="font-semibold text-white truncate text-base">{form.property_name}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                    form.status === 'active' ? 'bg-green-900/30 text-green-400' :
                    form.status === 'draft' ? 'bg-gray-800 text-gray-400' :
                    'bg-blue-900/30 text-blue-400'
                  }`}>
                    {form.status || 'draft'}
                  </span>
                </div>
                <button
                  onClick={() => deleteForm(form.id)}
                  className="px-2 py-1.5 hover:bg-red-900/30 text-gray-600 hover:text-red-400 rounded-lg text-xs transition-colors shrink-0"
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>

              {/* Details row */}
              <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                {form.address_city && <span>{form.address_city}</span>}
                {form.client_name && <span>{form.client_name}</span>}
                {form.bedrooms && <span>{form.bedrooms} bed / {form.bathrooms || '?'} bath</span>}
                {form.property_type && <span className="capitalize">{form.property_type}</span>}
                <span>Updated {new Date(form.updated_at || form.created_at).toLocaleDateString()}</span>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* YOU edit it */}
                <a
                  href={`/customer-form.html?id=${form.id}`}
                  target="_blank"
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                  Edit
                </a>

                {/* View the guide */}
                <a
                  href={`/property-guide.html?id=${form.id}`}
                  target="_blank"
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-blue-400 rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  View Guide
                </a>

                <div className="w-px h-5 bg-gray-800 mx-1" />

                {/* Send form link to client */}
                <button
                  onClick={() => copyLink(`/customer-form.html?id=${form.id}`, 'client-' + form.id)}
                  className="px-3 py-1.5 bg-green-900/20 hover:bg-green-900/30 text-green-400 border border-green-800/30 rounded-lg text-xs font-medium flex items-center gap-1.5"
                  title="Copy the form link to send to your client so they can fill in or update their info"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                  </svg>
                  Send to Client
                </button>

                {/* Copy guide link (for crew) */}
                <button
                  onClick={() => copyLink(`/property-guide.html?id=${form.id}`, 'guide-' + form.id)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg text-xs font-medium flex items-center gap-1.5"
                  title="Copy the read-only guide link to share with your cleaning crew"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.07a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.343 8.82" />
                  </svg>
                  Crew Link
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
