import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  getClient, getClientAsync, saveClient, saveClientAsync,
  getConversations, getConversationsAsync, saveConversation, saveConversationAsync,
  addMessage, addMessageAsync,
  getJobs, getJobsAsync, saveJob, saveJobAsync,
  getInvoices, getInvoicesAsync, saveInvoice, saveInvoiceAsync,
  generateInvoiceNumber,
  getProperties, getPropertiesAsync, saveProperty, savePropertyAsync,
  deleteProperty,
  getQuotes, getQuotesAsync, saveQuote, saveQuoteAsync,
  generateQuoteNumber, saveVisitAsync, lookupServiceTypeId,
} from '../lib/store'
import { isSupabaseConfigured, getSupabase } from '../lib/supabase'
import { calculateQuote } from '../lib/quoteEngine'
import PropertyForm from '../components/PropertyForm'
import CustomFields from '../components/CustomFields'

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hr = parseInt(h)
  return `${hr > 12 ? hr - 12 : hr || 12}:${m || '00'}${hr >= 12 ? 'pm' : 'am'}`
}

// Smart save wrappers — use Supabase when configured, localStorage otherwise
const sb = () => isSupabaseConfigured()
const _saveClient = (d) => sb() ? saveClientAsync(d) : Promise.resolve(saveClient(d))
const _saveJob = (d) => sb() ? saveJobAsync(d) : Promise.resolve(saveJob(d))
const _saveInvoice = (d) => sb() ? saveInvoiceAsync(d) : Promise.resolve(saveInvoice(d))
const _saveQuote = (d) => sb() ? saveQuoteAsync(d) : Promise.resolve(saveQuote(d))
const _saveProperty = (d) => sb() ? savePropertyAsync(d) : Promise.resolve(saveProperty(d))
const _saveConversation = (d) => sb() ? saveConversationAsync(d) : Promise.resolve(saveConversation(d))
const _addMessage = (id, m) => sb() ? addMessageAsync(id, m) : Promise.resolve(addMessage(id, m))

// Build HTML email for quote with "Review & Approve" button
function buildQuoteEmailHtml({ clientName, serviceType, sqft, frequency, estimateMin, estimateMax, finalPrice, property, approveUrl, portalUrl }) {
  const freqLabel = { 'one-time': 'One-Time', 'weekly': 'Weekly', 'biweekly': 'Every 2 Weeks', 'monthly': 'Monthly' }[frequency] || frequency
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
  <div style="text-align:center;padding:24px 0;">
    <h1 style="font-size:20px;color:#1e40af;margin:0;">The Maine Cleaning Co.</h1>
  </div>
  <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:16px;">
    <p style="color:#334155;font-size:15px;margin:0 0 12px;">Hi ${clientName.split(' ')[0]},</p>
    <p style="color:#334155;font-size:15px;margin:0 0 20px;">Thanks for your interest! Here's your cleaning quote:</p>
    <div style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px;">
      <div style="font-size:28px;font-weight:800;color:#1e40af;">$${estimateMin} – $${estimateMax}</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px;">per cleaning</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Service</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${serviceType}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Home Size</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${sqft} sqft</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Frequency</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${freqLabel}</td></tr>
      ${property ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Property</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${property}</td></tr>` : ''}
    </table>
    <div style="text-align:center;margin:24px 0 16px;">
      <a href="${approveUrl}" style="display:inline-block;padding:14px 32px;background:#1e40af;color:white;border-radius:10px;text-decoration:none;font-size:16px;font-weight:600;">Review & Approve Quote</a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;">Or call us at (207) 572-0502 to discuss</p>
  </div>
  <div style="text-align:center;padding:16px 0;font-size:12px;color:#94a3b8;">
    The Maine Cleaning & Property Management Co.<br>(207) 572-0502 · office@mainecleaningco.com
  </div>
</div></body></html>`
}

const TAB_META = {
  overview:      { icon: '\u2302', label: 'Overview' },
  properties:    { icon: '\uD83C\uDFE0', label: 'Properties' },
  quotes:        { icon: '\uD83D\uDCCB', label: 'Quotes' },
  conversations: { icon: '\uD83D\uDCAC', label: 'Msgs' },
  jobs:          { icon: '\uD83D\uDCC5', label: 'Jobs' },
  invoices:      { icon: '\uD83D\uDCB0', label: 'Invoices' },
  documents:     { icon: '\uD83D\uDCC4', label: 'Docs' },
  notes:         { icon: '\u270F\uFE0F', label: 'Notes' },
}
const TABS = Object.keys(TAB_META)

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [client, setClient] = useState(null)
  const [tab, setTab] = useState(searchParams.get('tab') || 'overview')
  const [convos, setConvos] = useState([])
  const [jobs, setJobs] = useState([])
  const [invoices, setInvoices] = useState([])
  const [properties, setProperties] = useState([])
  const [quotes, setQuotes] = useState([])
  const [toast, setToast] = useState(null)

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => { reload() }, [id])
  useEffect(() => { const t = searchParams.get('tab'); if (t) setTab(t) }, [searchParams])

  async function reload() {
    if (isSupabaseConfigured()) {
      const c = await getClientAsync(id)
      if (!c) return navigate('/clients')
      setClient(c)
      const [cv, j, inv, p, q] = await Promise.all([
        getConversationsAsync(id), getJobsAsync(id), getInvoicesAsync(id),
        getPropertiesAsync(id), getQuotesAsync(id),
      ])
      setConvos(cv); setJobs(j); setInvoices(inv)
      setProperties(p); setQuotes(q)
    } else {
      const c = getClient(id)
      if (!c) return navigate('/clients')
      setClient(c)
      setConvos(getConversations(id))
      setJobs(getJobs(id))
      setInvoices(getInvoices(id))
      setProperties(getProperties(id))
      setQuotes(getQuotes(id))
    }
  }

  if (!client) return null

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/clients" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">&larr; Back to Clients</Link>
          <h1 className="text-2xl font-bold text-white mt-1">{client.name}</h1>
          {client.companyName && <p className="text-sm text-gray-400 mt-0.5">{client.companyName}</p>}
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
            {client.email && <span>{client.email}</span>}
            {client.phone && <span>{client.phone}</span>}
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              client.status === 'active' ? 'bg-green-900/40 text-green-400' :
              client.status === 'lead' ? 'bg-blue-900/40 text-blue-400' :
              'bg-gray-800 text-gray-400'
            }`}>{client.status}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button onClick={() => setTab('quotes')} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-medium text-white">+ Quote</button>
          <button onClick={() => setTab('jobs')} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-medium text-white">+ Job</button>
          <button onClick={() => setTab('invoices')} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs font-medium text-white">+ Invoice</button>
          <button onClick={() => {
            const token = btoa(`${id}|${Date.now()}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
            navigator.clipboard.writeText(`${window.location.origin}/portal.html?token=${token}`)
            alert('Secure portal link copied!')
          }}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300" title="Copy client portal link">
            Portal Link
          </button>
        </div>
      </div>

      <div className="flex gap-0.5 border-b border-gray-800 overflow-x-auto whitespace-nowrap">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors border-b-2 -mb-px shrink-0 flex items-center gap-1 ${
              tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            <span className="sm:hidden">{TAB_META[t].icon}</span>
            <span className="hidden sm:inline">{TAB_META[t].icon}</span>
            <span className="hidden sm:inline">{TAB_META[t].label}</span>
            <span className="sm:hidden text-[10px]">{TAB_META[t].label}</span>
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab client={client} convos={convos} jobs={jobs} invoices={invoices} properties={properties} quotes={quotes} onSwitchTab={setTab} clientId={id} />}
      {tab === 'properties' && <PropertiesTab clientId={id} properties={properties} onReload={reload} />}
      {tab === 'quotes' && <QuotesTab client={client} properties={properties} quotes={quotes} jobs={jobs} onReload={reload} onSwitchTab={setTab} />}
      {tab === 'conversations' && <ConversationsTab clientId={id} convos={convos} onReload={reload} />}
      {tab === 'jobs' && <JobsTab clientId={id} clientName={client.name} clientAddress={client.address} jobs={jobs} properties={properties} invoices={invoices} onReload={reload} onToast={showToast} onSwitchTab={setTab} />}
      {tab === 'invoices' && <InvoicesTab clientId={id} clientName={client.name} jobs={jobs} invoices={invoices} onReload={reload} />}
      {tab === 'documents' && <DocumentsTab clientName={client.name} />}
      {tab === 'notes' && <NotesTab client={client} onSave={reload} />}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-pulse">
          {toast}
        </div>
      )}
    </div>
  )
}

function OverviewTab({ client, convos, jobs, invoices, properties, quotes, onSwitchTab, clientId }) {
  const completedJobs = jobs.filter(j => j.status === 'completed').length
  const scheduledJobs = jobs.filter(j => j.status === 'scheduled').length
  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
  const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0)
  const invoiceTotal = invoices.reduce((s, i) => s + (i.total || 0), 0)
  const paidInvoices = invoices.filter(i => i.status === 'paid').length
  const outstandingInvoices = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').length

  // Journey step calculations
  const draftQuotes = quotes.filter(q => q.status === 'draft').length
  const sentQuotes = quotes.filter(q => q.status === 'sent').length
  const acceptedQuotes = quotes.filter(q => q.status === 'accepted').length

  // Determine which steps are "done"
  const hasRequest = !!client.source || !!client.createdAt
  const hasQuotes = quotes.length > 0
  const hasScheduled = scheduledJobs > 0 || completedJobs > 0
  const hasCompleted = completedJobs > 0
  const hasInvoiced = invoices.length > 0

  // Current step (rightmost completed + 1, capped)
  const currentStep = hasInvoiced ? 5 : hasCompleted ? 4 : hasScheduled ? 3 : hasQuotes ? 2 : hasRequest ? 1 : 0

  const journeySteps = [
    { num: 1, label: 'Request', tab: 'overview', detail: `${client.source || 'Direct'}${client.createdAt ? ' · ' + new Date(client.createdAt).toLocaleDateString() : ''}`, done: hasRequest },
    { num: 2, label: 'Quote', tab: 'quotes', detail: quotes.length === 0 ? 'None yet' : `${quotes.length} quote${quotes.length !== 1 ? 's' : ''}${draftQuotes ? ` · ${draftQuotes} draft` : ''}${sentQuotes ? ` · ${sentQuotes} sent` : ''}${acceptedQuotes ? ` · ${acceptedQuotes} accepted` : ''}`, done: hasQuotes },
    { num: 3, label: 'Scheduled', tab: 'jobs', detail: scheduledJobs > 0 ? `${scheduledJobs} upcoming` : (completedJobs > 0 ? 'All completed' : 'None yet'), done: hasScheduled },
    { num: 4, label: 'Completed', tab: 'jobs', detail: completedJobs > 0 ? `${completedJobs} job${completedJobs !== 1 ? 's' : ''} done` : 'None yet', done: hasCompleted },
    { num: 5, label: 'Invoiced', tab: 'invoices', detail: invoices.length === 0 ? 'None yet' : `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} · $${invoiceTotal.toFixed(0)}${paidInvoices ? ` · ${paidInvoices} paid` : ''}${outstandingInvoices ? ` · ${outstandingInvoices} outstanding` : ''}`, done: hasInvoiced },
  ]

  return (
    <div className="space-y-6">
      {/* Client Journey Timeline */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Client Journey</h3>
        <div className="flex items-start gap-0 overflow-x-auto">
          {journeySteps.map((step, idx) => {
            const isActive = step.num === currentStep
            const isDone = step.done && step.num < currentStep
            const isCurrent = step.num === currentStep
            const isPending = step.num > currentStep
            const bg = isDone ? 'bg-green-900/40 border-green-700/50' : isCurrent ? 'bg-blue-900/40 border-blue-700/50' : 'bg-gray-800/50 border-gray-700/50'
            const numBg = isDone ? 'bg-green-600' : isCurrent ? 'bg-blue-600' : 'bg-gray-700'
            const textColor = isDone ? 'text-green-400' : isCurrent ? 'text-blue-400' : 'text-gray-500'
            return (
              <div key={step.num} className="flex items-start shrink-0">
                <button onClick={() => onSwitchTab && onSwitchTab(step.tab)}
                  className={`flex flex-col items-center p-3 rounded-lg border ${bg} hover:brightness-110 transition-all min-w-[120px] cursor-pointer`}>
                  <span className={`w-7 h-7 rounded-full ${numBg} text-white text-xs font-bold flex items-center justify-center mb-1.5`}>
                    {isDone ? '\u2713' : step.num}
                  </span>
                  <span className={`text-xs font-semibold ${textColor}`}>{step.label}</span>
                  <span className="text-[10px] text-gray-500 mt-1 text-center leading-tight max-w-[110px]">{step.detail}</span>
                </button>
                {idx < journeySteps.length - 1 && (
                  <div className="flex items-center self-center pt-2">
                    <span className={`text-lg ${step.done && journeySteps[idx + 1]?.done ? 'text-green-600' : step.done ? 'text-blue-600' : 'text-gray-700'}`}>&rarr;</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onSwitchTab && onSwitchTab('quotes')}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium text-white transition-colors">Create Quote</button>
          <button onClick={() => onSwitchTab && onSwitchTab('jobs')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors">Schedule Job</button>
          <button onClick={() => onSwitchTab && onSwitchTab('invoices')}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium text-white transition-colors">Create Invoice</button>
          <button onClick={() => {
            const token = btoa(`${clientId}|${Date.now()}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
            navigator.clipboard.writeText(`${window.location.origin}/portal.html?token=${token}`)
            alert('Portal link copied to clipboard!')
          }}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors">Send Portal Link</button>
          {client.email && (
            <a href={`mailto:${client.email}`}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors inline-flex items-center">Email Client</a>
          )}
        </div>
      </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">Client Info</h3>
        <div className="space-y-2 text-sm">
          {client.companyName && <InfoRow label="Company" value={client.companyName} />}
          <InfoRow label="Type" value={client.type} />
          <InfoRow label="Address" value={client.address} />
          <InfoRow label="Source" value={client.source} />
          <InfoRow label="Added" value={client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '-'} />
          {client.tags?.length > 0 && (
            <div>
              <span className="text-gray-500">Tags: </span>
              {client.tags.map(t => <span key={t} className="inline-block px-1.5 py-0.5 bg-gray-800 rounded text-xs text-gray-400 mr-1">{t}</span>)}
            </div>
          )}
        </div>
        <div className="pt-3 border-t border-gray-800 space-y-1">
          <div className="flex justify-between text-xs"><span className="text-gray-500">Jobs completed</span><span className="text-gray-300">{completedJobs}</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-500">Revenue (paid)</span><span className="text-green-400">${totalRevenue.toFixed(2)}</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-500">Outstanding</span><span className="text-yellow-400">${outstanding.toFixed(2)}</span></div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Recent Conversations</h3>
        {convos.length === 0 ? <p className="text-sm text-gray-500">No conversations yet.</p> : (
          <div className="space-y-2">
            {convos.slice(0, 5).map(c => (
              <div key={c.id} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300 truncate">{c.subject || 'No subject'}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${c.channel === 'email' ? 'bg-blue-900/30 text-blue-400' : c.channel === 'text' ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-400'}`}>{c.channel}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{c.lastMessage || 'No messages'}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Upcoming Jobs</h3>
          {jobs.filter(j => j.status === 'scheduled').length === 0 ? <p className="text-sm text-gray-500">No upcoming jobs.</p> : (
            <div className="space-y-2">
              {jobs.filter(j => j.status === 'scheduled').slice(0, 5).map(j => (
                <div key={j.id} className="flex justify-between text-sm">
                  <div>
                    <span className="text-gray-300">{j.title}</span>
                    {j.isRecurring && <span className="ml-1 text-xs text-purple-400">(recurring)</span>}
                  </div>
                  <span className="text-xs text-gray-500">{j.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Recent Invoices</h3>
          {invoices.length === 0 ? <p className="text-sm text-gray-500">No invoices.</p> : (
            <div className="space-y-2">
              {invoices.slice(0, 5).map(i => (
                <div key={i.id} className="flex justify-between text-sm">
                  <span className="text-gray-300 font-mono text-xs">{i.invoiceNumber}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">${i.total?.toFixed(2)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${i.status === 'paid' ? 'bg-green-900/30 text-green-400' : i.status === 'overdue' ? 'bg-red-900/30 text-red-400' : 'bg-gray-800 text-gray-400'}`}>{i.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  if (!value) return null
  return <div><span className="text-gray-500">{label}: </span><span className="text-gray-300 capitalize">{value}</span></div>
}

// ── PROPERTIES TAB ──
function PropertiesTab({ clientId, properties, onReload }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  async function handleSave(prop) {
    await _saveProperty({ ...prop, clientId })
    setShowForm(false)
    setEditing(null)
    onReload()
  }

  const TYPE_COLORS = {
    residential: 'bg-blue-900/30 text-blue-400',
    commercial: 'bg-purple-900/30 text-purple-400',
    rental: 'bg-orange-900/30 text-orange-400',
    marina: 'bg-cyan-900/30 text-cyan-400',
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">{properties.length} propert{properties.length === 1 ? 'y' : 'ies'}</p>
        <button onClick={() => { setEditing(null); setShowForm(true) }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">+ Add Property</button>
      </div>

      {(showForm || editing) && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">{editing ? 'Edit Property' : 'New Property'}</h3>
          <PropertyForm property={editing} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null) }} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {properties.map(prop => (
          <div key={prop.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold text-white">{prop.name || prop.addressLine1}</h3>
                {prop.name && <p className="text-xs text-gray-500">{prop.addressLine1}</p>}
                {prop.city && <p className="text-xs text-gray-500">{prop.city}, {prop.state} {prop.zip}</p>}
              </div>
              <div className="flex items-center gap-2">
                {prop.isPrimary && <span className="px-1.5 py-0.5 rounded text-xs bg-green-900/30 text-green-400">Primary</span>}
                <span className={`px-1.5 py-0.5 rounded text-xs ${TYPE_COLORS[prop.type] || 'bg-gray-800 text-gray-400'}`}>{prop.type}</span>
              </div>
            </div>
            <div className="flex gap-4 text-xs text-gray-500 mb-3">
              {prop.sqft && <span>{prop.sqft} sqft</span>}
              {prop.bedrooms && <span>{prop.bedrooms} bed</span>}
              {prop.bathrooms && <span>{prop.bathrooms} bath</span>}
              {prop.petHair && prop.petHair !== 'none' && <span>Pet hair: {prop.petHair}</span>}
            </div>
            {prop.type === 'rental' && prop.googleCalendarId && (
              <p className="text-xs text-blue-400 mb-2">Google Calendar linked ({prop.rentalPlatform || 'rental'})</p>
            )}
            {prop.type === 'rental' && !prop.googleCalendarId && prop.icalUrl && (
              <p className="text-xs text-orange-400 mb-2">iCal linked ({prop.rentalPlatform || 'rental'}) — add Google Calendar ID for better reliability</p>
            )}
            {prop.accessNotes && <p className="text-xs text-gray-600 mb-2">Access: {prop.accessNotes}</p>}
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setEditing(prop); setShowForm(true) }} className="text-xs text-gray-500 hover:text-blue-400">Edit</button>
              <button onClick={async () => { if (confirm('Delete this property?')) { if (sb()) { const s = getSupabase(); if(s) await s.from('properties').delete().eq('id', prop.id) } else { deleteProperty(prop.id) }; onReload() } }}
                className="text-xs text-gray-500 hover:text-red-400">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {properties.length === 0 && !showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-500 text-sm">No properties yet. Add a property to start quoting and scheduling jobs.</p>
        </div>
      )}
    </div>
  )
}

// ── QUOTES TAB ──
function QuotesTab({ client, properties, quotes, jobs, onReload, onSwitchTab }) {
  const [showCalculator, setShowCalculator] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState(null)
  const [calcInputs, setCalcInputs] = useState({ sqft: '1500', serviceType: 'standard', frequency: 'biweekly', bathrooms: '2', petHair: 'none', condition: 'maintenance' })
  const [sending, setSending] = useState(false)
  const [previewQuote, setPreviewQuote] = useState(null) // for viewing/editing existing quotes
  const [editingPrice, setEditingPrice] = useState('')

  // Pre-fill from selected property
  function selectProperty(propId) {
    const prop = properties.find(p => p.id === propId)
    if (prop) {
      setSelectedProperty(prop)
      setCalcInputs({
        sqft: String(prop.sqft || 1500),
        serviceType: prop.type === 'rental' ? 'airbnb-turnover' : 'standard',
        frequency: prop.type === 'rental' ? 'one-time' : 'biweekly',
        bathrooms: String(prop.bathrooms || 2),
        petHair: prop.petHair || 'none',
        condition: prop.condition || 'maintenance',
      })
    }
    setShowCalculator(true)
  }

  const quote = calculateQuote(calcInputs)

  async function handleSendQuote(channel) {
    setSending(true)
    const q = await _saveQuote({
      quoteNumber: generateQuoteNumber(),
      clientId: client.id,
      propertyId: selectedProperty?.id || null,
      serviceType: calcInputs.serviceType,
      frequency: calcInputs.frequency,
      estimateMin: quote.estimateMin,
      estimateMax: quote.estimateMax,
      finalPrice: quote.perClean,
      calcInputs,
      calcBreakdown: quote.breakdown,
      status: 'sent',
      sentVia: channel,
      sentAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      items: [{ description: `${quote.isDeep ? 'Deep' : 'Standard'} Cleaning — ${calcInputs.sqft} sqft`, quantity: 1, unitPrice: quote.perClean, total: quote.perClean }],
      notes: '',
      preferredDay: 1,
    })

    await _saveClient({ id: client.id, status: 'prospect' })

    // Generate approval link (quote-specific token: quoteId|clientId|timestamp)
    const approveToken = btoa(`${q.id}|${client.id}|${Date.now()}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const approveUrl = `${window.location.origin}/quote.html?token=${approveToken}`

    const portalToken = btoa(`${client.id}|${Date.now()}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const portalUrl = `${window.location.origin}/portal.html?token=${portalToken}`

    // SMS: short, with approval link
    const smsMsg = `Hi ${client.name.split(' ')[0]}! Here's your cleaning quote from The Maine Cleaning Co.:\n\n${quote.isDeep ? 'Deep' : 'Standard'} Cleaning: $${quote.estimateMin} – $${quote.estimateMax}/clean\n${calcInputs.frequency !== 'one-time' ? `Frequency: ${calcInputs.frequency}\n` : ''}\nReview & approve here:\n${approveUrl}\n\nOr call (207) 572-0502!`

    // Email: HTML with approve button
    const emailHtml = buildQuoteEmailHtml({
      clientName: client.name,
      serviceType: quote.isDeep ? 'Deep Cleaning' : 'Standard Cleaning',
      sqft: calcInputs.sqft,
      frequency: calcInputs.frequency,
      estimateMin: quote.estimateMin,
      estimateMax: quote.estimateMax,
      finalPrice: quote.perClean,
      property: selectedProperty?.addressLine1,
      approveUrl,
      portalUrl,
    })

    if (channel === 'email' && client.email) {
      try { await fetch('/api/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'gmail-send', to: client.email, subject: `Your Cleaning Quote — The Maine Cleaning Co.`, body: emailHtml, isHtml: true }) }) } catch {}
    }
    if (channel === 'text' && client.phone) {
      try { await fetch('/api/sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', to: client.phone, body: smsMsg }) }) } catch {}
    }

    setSending(false)
    setShowCalculator(false)
    onReload()
  }

  const [acceptingQuote, setAcceptingQuote] = useState(null)
  const [acceptDate, setAcceptDate] = useState('')
  const [acceptTime, setAcceptTime] = useState('09:00')

  function startAcceptQuote(q) {
    setAcceptingQuote(q)
    // Default to next Monday
    const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
    setAcceptDate(d.toISOString().split('T')[0])
    setAcceptTime('09:00')
  }

  async function confirmAcceptQuote() {
    const q = acceptingQuote
    if (!q || !acceptDate) return
    await _saveQuote({ ...q, status: 'accepted', acceptedAt: new Date().toISOString() })
    await _saveClient({ id: client.id, status: 'active' })

    const prop = properties.find(p => p.id === q.propertyId)
    const endTime = (() => { const [h, m] = acceptTime.split(':'); return `${String(Math.min(23, parseInt(h) + 3)).padStart(2, '0')}:${m}` })()

    const serviceTypeId = await lookupServiceTypeId(q.serviceType || 'standard')

    const job = await _saveJob({
      clientId: client.id, clientName: client.name,
      propertyId: q.propertyId, quoteId: q.id,
      title: (q.items?.[0]?.description) || 'Cleaning',
      date: acceptDate,
      startTime: acceptTime, endTime,
      status: 'scheduled',
      price: q.finalPrice, priceType: 'flat',
      serviceType: q.serviceType,
      serviceTypeId,
      address: prop?.addressLine1 || client.address,
      isRecurring: q.frequency !== 'one-time',
      recurrenceRule: q.frequency === 'one-time' ? null : q.frequency,
      recurrenceDay: q.preferredDay || 1,
      source: 'quote', isActive: true,
      preferredStartTime: acceptTime, preferredEndTime: endTime,
      recurrenceStartDate: acceptDate,
    })

    // Create the first visit
    if (job?.id) {
      await saveVisitAsync({
        jobId: job.id, clientId: client.id, propertyId: q.propertyId,
        scheduledDate: acceptDate, scheduledStartTime: acceptTime, scheduledEndTime: endTime,
        status: 'scheduled', source: q.frequency !== 'one-time' ? 'recurring' : 'one_off',
        serviceTypeId, address: prop?.addressLine1 || client.address, clientVisible: true,
      })
    }

    // Push to Google Calendar
    try {
      await fetch('/api/google?action=calendar-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `${q.serviceType === 'standard' ? 'Cleaning' : 'Deep Clean'} — ${client.name}`,
          description: `${client.name}\n${prop?.addressLine1 || ''}`,
          startDateTime: `${acceptDate}T${acceptTime}:00`,
          endDateTime: `${acceptDate}T${endTime}:00`,
          location: prop?.addressLine1 || client.address || '',
        }),
      })
    } catch {}

    setAcceptingQuote(null)
    onReload()
    // Auto-switch to Jobs tab so user sees the newly scheduled job
    if (onSwitchTab) onSwitchTab('jobs')
  }

  const QUOTE_STATUS_COLORS = {
    draft: 'bg-gray-800 text-gray-400', sent: 'bg-blue-900/40 text-blue-400',
    accepted: 'bg-green-900/40 text-green-400', declined: 'bg-red-900/40 text-red-400',
    expired: 'bg-gray-800 text-gray-500',
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">{quotes.length} quote{quotes.length !== 1 ? 's' : ''}</p>
        {properties.length > 0 ? (
          <div className="flex gap-2">
            {properties.map(p => (
              <button key={p.id} onClick={() => selectProperty(p.id)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-medium text-white">
                Quote: {p.name || p.addressLine1?.split(',')[0]}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">Add a property first to create quotes</p>
        )}
      </div>

      {/* Quote Calculator */}
      {showCalculator && (
        <div className="bg-gray-900 border border-blue-800/30 rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-white">
              New Quote {selectedProperty ? `— ${selectedProperty.name || selectedProperty.addressLine1}` : ''}
            </h3>
            <button onClick={() => setShowCalculator(false)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Sq Ft</label>
              <input type="number" value={calcInputs.sqft} onChange={e => setCalcInputs({ ...calcInputs, sqft: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Service</label>
              <select value={calcInputs.serviceType} onChange={e => setCalcInputs({ ...calcInputs, serviceType: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                <option value="standard">Standard</option><option value="deep">Deep Clean</option>
                <option value="move-in-out">Move-In/Out</option><option value="airbnb-turnover">Turnover</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bathrooms</label>
              <select value={calcInputs.bathrooms} onChange={e => setCalcInputs({ ...calcInputs, bathrooms: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Frequency</label>
              <select value={calcInputs.frequency} onChange={e => setCalcInputs({ ...calcInputs, frequency: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option><option value="one-time">One-time</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Pet Hair</label>
              <select value={calcInputs.petHair} onChange={e => setCalcInputs({ ...calcInputs, petHair: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                <option value="none">None</option><option value="some">Some</option><option value="heavy">Heavy</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Condition</label>
              <select value={calcInputs.condition} onChange={e => setCalcInputs({ ...calcInputs, condition: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                <option value="maintenance">Well-maintained</option><option value="moderate">Moderate</option><option value="heavy">Needs work</option>
              </select>
            </div>
          </div>

          {/* Price display */}
          <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-4 flex items-center justify-between">
            <div>
              <span className="text-2xl font-bold text-blue-400">${quote.estimateMin} – ${quote.estimateMax}</span>
              <span className="text-sm text-gray-500 ml-2">per clean</span>
            </div>
            <div className="flex gap-2">
              {client.email && (
                <button onClick={() => handleSendQuote('email')} disabled={sending}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium">
                  {sending ? '...' : 'Email Quote'}
                </button>
              )}
              {client.phone && (
                <button onClick={() => handleSendQuote('text')} disabled={sending}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium">
                  {sending ? '...' : 'Text Quote'}
                </button>
              )}
              <button onClick={() => handleSendQuote('none')} disabled={sending}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-300">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Quote preview/edit panel */}
      {previewQuote && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-white">Quote {previewQuote.quoteNumber}</h3>
            <button onClick={() => setPreviewQuote(null)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-500 text-xs block">Service</span><span className="text-white capitalize">{previewQuote.serviceType}</span></div>
            <div><span className="text-gray-500 text-xs block">Frequency</span><span className="text-white capitalize">{previewQuote.frequency}</span></div>
            <div><span className="text-gray-500 text-xs block">Estimate</span><span className="text-white">${previewQuote.estimateMin} – ${previewQuote.estimateMax}</span></div>
            <div><span className="text-gray-500 text-xs block">Status</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${QUOTE_STATUS_COLORS[previewQuote.status]}`}>{previewQuote.status}</span>
            </div>
          </div>

          {/* Editable final price */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500">Final Price:</label>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">$</span>
              <input type="number" step="5" value={editingPrice}
                onChange={e => setEditingPrice(e.target.value)}
                className="w-24 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white text-right" />
              <button onClick={async () => {
                await _saveQuote({ ...previewQuote, finalPrice: parseFloat(editingPrice) || previewQuote.finalPrice })
                onReload()
                setPreviewQuote({ ...previewQuote, finalPrice: parseFloat(editingPrice) || previewQuote.finalPrice })
              }} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white">Update</button>
            </div>
          </div>

          {/* Line items */}
          {previewQuote.items?.length > 0 && (
            <div className="border border-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-gray-500 bg-gray-800/50"><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
                <tbody>
                  {previewQuote.items.map((item, i) => (
                    <tr key={i} className="border-t border-gray-800/50 text-gray-300">
                      <td className="px-3 py-2">{item.description}</td>
                      <td className="px-3 py-2 text-right">{item.quantity}</td>
                      <td className="px-3 py-2 text-right font-mono">${item.unitPrice}</td>
                      <td className="px-3 py-2 text-right font-mono">${item.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {previewQuote.notes && <p className="text-xs text-gray-500">Notes: {previewQuote.notes}</p>}
          {previewQuote.sentAt && <p className="text-xs text-gray-600">Sent: {new Date(previewQuote.sentAt).toLocaleString()}</p>}

          {/* Signature info if accepted with signature */}
          {previewQuote.status === 'accepted' && previewQuote.signatureData?.signedAt && (
            <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-3">
              <p className="text-xs text-green-400 font-medium">Signed by {previewQuote.signatureData.signerName || 'Client'}</p>
              <p className="text-xs text-gray-500">{new Date(previewQuote.signatureData.signedAt).toLocaleString()}</p>
              {previewQuote.signatureData.signature && (
                <img src={previewQuote.signatureData.signature} alt="Signature" className="mt-2 max-h-16 bg-white rounded p-1" />
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-800">
            {previewQuote.status === 'draft' && (
              <>
                {client.email && <button onClick={() => { handleSendQuote('email'); setPreviewQuote(null) }} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Email Quote</button>}
                {client.phone && <button onClick={() => { handleSendQuote('text'); setPreviewQuote(null) }} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs text-white">Text Quote</button>}
                <button onClick={async () => { await _saveQuote({ ...previewQuote, status: 'sent', sentAt: new Date().toISOString() }); setPreviewQuote(null); onReload() }}
                  className="px-3 py-1.5 bg-gray-700 rounded-lg text-xs text-gray-300">Mark Sent</button>
              </>
            )}
            {previewQuote.status === 'sent' && (
              <>
                <button onClick={() => { startAcceptQuote(previewQuote); setPreviewQuote(null) }}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs text-white font-medium">Accept → Create Job</button>
                <button onClick={() => {
                  const token = btoa(`${previewQuote.id}|${client.id}|${Date.now()}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
                  const url = `${window.location.origin}/quote.html?token=${token}`
                  navigator.clipboard.writeText(url)
                  alert('Approval link copied!')
                }} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-300">Copy Approval Link</button>
              </>
            )}
            {(previewQuote.status === 'sent' || previewQuote.status === 'draft') && (
              <button onClick={async () => { await _saveQuote({ ...previewQuote, status: 'declined', declinedAt: new Date().toISOString() }); setPreviewQuote(null); onReload() }}
                className="px-3 py-1.5 bg-gray-800 rounded-lg text-xs text-red-400">Decline</button>
            )}
          </div>
        </div>
      )}

      {/* Accept quote — schedule date picker */}
      {acceptingQuote && (
        <div className="bg-green-900/20 border border-green-800/50 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Accept Quote &amp; Schedule First Job</h3>
          <p className="text-xs text-gray-400">Quote {acceptingQuote.quoteNumber} — ${acceptingQuote.finalPrice || acceptingQuote.estimateMax}/clean</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">First Service Date *</label>
              <input type="date" value={acceptDate} onChange={e => setAcceptDate(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Start Time</label>
              <input type="time" value={acceptTime} onChange={e => setAcceptTime(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={confirmAcceptQuote} disabled={!acceptDate}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
              Accept &amp; Schedule
            </button>
            <button onClick={() => setAcceptingQuote(null)}
              className="px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300">Cancel</button>
          </div>
        </div>
      )}

      {/* Existing quotes list */}
      {quotes.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-5 py-2.5 text-left">Quote</th>
                <th className="px-3 py-2.5 text-left">Service</th>
                <th className="px-3 py-2.5 text-left">Frequency</th>
                <th className="px-3 py-2.5 text-right">Price</th>
                <th className="px-3 py-2.5 text-center">Status</th>
                <th className="px-3 py-2.5 text-left">Linked Job</th>
                <th className="px-5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {quotes.map(q => {
                const linkedJob = (jobs || []).find(j => j.quoteId === q.id)
                return (
                <tr key={q.id} className="text-gray-300 hover:bg-gray-800/30">
                  <td className="px-5 py-2.5 font-mono text-xs text-white">{q.quoteNumber}</td>
                  <td className="px-3 py-2.5 text-xs capitalize">{q.serviceType}</td>
                  <td className="px-3 py-2.5 text-xs capitalize">{q.frequency}</td>
                  <td className="px-3 py-2.5 text-right font-mono">${q.finalPrice || q.estimateMax || 0}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${QUOTE_STATUS_COLORS[q.status] || 'bg-gray-800 text-gray-400'}`}>{q.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {linkedJob ? (
                      <button onClick={() => onSwitchTab && onSwitchTab('jobs')} className="text-green-400 hover:text-green-300">
                        {linkedJob.title} ({linkedJob.status})
                      </button>
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setPreviewQuote(q); setEditingPrice(String(q.finalPrice || q.estimateMax || 0)) }}
                        className="text-xs text-gray-400 hover:text-blue-400">View</button>
                      {q.status === 'sent' && (
                        <>
                          <button onClick={() => startAcceptQuote(q)}
                            className="text-xs text-green-400 hover:text-green-300">Accept</button>
                          <button onClick={() => {
                            const token = btoa(`${q.id}|${client.id}|${Date.now()}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
                            navigator.clipboard.writeText(`${window.location.origin}/quote.html?token=${token}`)
                            alert('Approval link copied!')
                          }} className="text-xs text-gray-400 hover:text-blue-400" title="Copy client approval link">Link</button>
                        </>
                      )}
                      {q.status === 'draft' && (
                        <button onClick={async () => { await _saveQuote({ ...q, status: 'sent', sentAt: new Date().toISOString() }); onReload() }}
                          className="text-xs text-blue-400 hover:text-blue-300">Send</button>
                      )}
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}

      {quotes.length === 0 && !showCalculator && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-500 text-sm">{properties.length > 0 ? 'No quotes yet. Select a property above to create one.' : 'Add a property first, then create a quote.'}</p>
        </div>
      )}
    </div>
  )
}

function ConversationsTab({ clientId, convos, onReload }) {
  const [showNew, setShowNew] = useState(false)
  const [newConvo, setNewConvo] = useState({ subject: '', channel: 'email' })
  const [activeConvo, setActiveConvo] = useState(null)
  const [newMsg, setNewMsg] = useState('')

  async function createConvo(e) {
    e.preventDefault()
    if (!newConvo.subject.trim()) return
    await _saveConversation({ ...newConvo, clientId, messages: [] })
    setShowNew(false)
    setNewConvo({ subject: '', channel: 'email' })
    onReload()
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!newMsg.trim() || !activeConvo) return
    await _addMessage(activeConvo.id, { content: newMsg.trim(), direction: 'outbound', sender: 'You' })
    setNewMsg('')
    onReload()
  }

  const currentConvo = activeConvo ? convos.find(c => c.id === activeConvo.id) || activeConvo : null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="space-y-3">
        <button onClick={() => setShowNew(true)} className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">+ New Conversation</button>
        {showNew && (
          <form onSubmit={createConvo} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <input required value={newConvo.subject} onChange={e => setNewConvo({ ...newConvo, subject: e.target.value })}
              placeholder="Subject" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={newConvo.channel} onChange={e => setNewConvo({ ...newConvo, channel: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="email">Email</option><option value="text">Text/SMS</option><option value="phone">Phone</option><option value="in-person">In-Person</option>
            </select>
            <div className="flex gap-2">
              <button type="submit" className="px-3 py-1.5 bg-blue-600 rounded-lg text-xs text-white">Create</button>
              <button type="button" onClick={() => setShowNew(false)} className="px-3 py-1.5 bg-gray-800 rounded-lg text-xs text-gray-300">Cancel</button>
            </div>
          </form>
        )}
        <div className="space-y-1">
          {convos.map(c => (
            <button key={c.id} onClick={() => setActiveConvo(c)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${currentConvo?.id === c.id ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-900 text-gray-300 hover:bg-gray-800'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{c.subject || 'No subject'}</span>
                <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-xs ${c.channel === 'email' ? 'bg-blue-900/30 text-blue-400' : c.channel === 'text' ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-400'}`}>{c.channel}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{c.lastMessage || 'No messages'}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl flex flex-col min-h-[400px]">
        {currentConvo ? (
          <>
            <div className="px-5 py-3 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-white">{currentConvo.subject}</h3>
              <p className="text-xs text-gray-500">{currentConvo.channel} &middot; {currentConvo.messages?.length || 0} messages</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(currentConvo.messages || []).map(msg => (
                <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${msg.direction === 'outbound' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}>
                    <p>{msg.content}</p>
                    <p className={`text-xs mt-1 ${msg.direction === 'outbound' ? 'text-blue-200' : 'text-gray-500'}`}>{msg.sender} &middot; {new Date(msg.timestamp).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {(!currentConvo.messages || currentConvo.messages.length === 0) && (
                <p className="text-center text-sm text-gray-500 py-8">No messages yet.</p>
              )}
            </div>
            <form onSubmit={sendMessage} className="p-3 border-t border-gray-800 flex gap-2">
              <input value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Type a message..."
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="submit" disabled={!newMsg.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm text-white">Send</button>
            </form>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">Select a conversation or start a new one</div>
        )}
      </div>
    </div>
  )
}

function JobsTab({ clientId, clientName, clientAddress, jobs, properties, invoices, onReload, onToast, onSwitchTab }) {
  const [showNew, setShowNew] = useState(false)
  const [pushingId, setPushingId] = useState(null)
  const [expandedJob, setExpandedJob] = useState(null)
  const [pushingCtId, setPushingCtId] = useState(null)

  async function pushToConnecteam(job) {
    setPushingCtId(job.id)
    try {
      const prop = (properties || []).find(p => p.id === job.propertyId)
      const client = sb() ? await getClientAsync(clientId) : getClient(clientId)
      const address = prop?.addressLine1 || job.address || clientAddress || ''
      const apiKey = localStorage.getItem('connecteam_api_key')
      if (!apiKey) { alert('Set your Connecteam API key in Settings first.'); setPushingCtId(null); return }

      const res = await fetch('/api/connecteam?action=shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify({
          title: `${job.title} — ${clientName}`,
          date: job.date,
          startTime: job.startTime || '09:00',
          endTime: job.endTime || '12:00',
          notes: job.notes || '',
          address,
          clientName: clientName,
          clientPhone: client?.phone || '',
          clientEmail: client?.email || '',
          price: job.price || '',
          propertyName: prop?.name || '',
          assignee: job.assignee || '',
        }),
      })
      if (res.ok) {
        const data = await res.json()
        await _saveJob({ ...job, connecteamShiftId: data.shift?.id || 'synced' })
        onReload()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to push to Connecteam')
      }
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setPushingCtId(null)
    }
  }

  const [form, setForm] = useState({
    title: '', date: '', status: 'scheduled', notes: '', assignee: '',
    isRecurring: false, recurrenceRule: 'weekly', recurrenceDay: 1,
    price: '', priceType: 'flat', startTime: '09:00', endTime: '12:00', propertyId: '',
  })

  // When property is selected, pre-fill title
  function selectProperty(propId) {
    const prop = (properties || []).find(p => p.id === propId)
    if (prop) {
      setForm(prev => ({
        ...prev,
        propertyId: propId,
        title: prev.title || `Cleaning — ${prop.name || prop.addressLine1?.split(',')[0]}`,
      }))
    } else {
      setForm(prev => ({ ...prev, propertyId: propId }))
    }
  }

  async function pushToCalendar(job) {
    setPushingId(job.id)
    try {
      const prop = (properties || []).find(p => p.id === job.propertyId)
      const address = prop?.addressLine1 || job.address || clientAddress || ''
      const startTime = job.startTime || '09:00'
      const endTime = job.endTime || '12:00'

      // ONLY push safe info to Google Calendar — no door codes, no pricing, no notes
      const res = await fetch('/api/google?action=calendar-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `${job.title} — ${clientName}`,
          description: `${clientName}\n${address}`,
          startDateTime: `${job.date}T${startTime}:00`,
          endDateTime: `${job.date}T${endTime}:00`,
          location: address,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        await _saveJob({ ...job, googleEventId: data.id })
        onReload()
      }
    } catch (err) {
      console.error('Calendar push failed:', err)
    } finally {
      setPushingId(null)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const prop = (properties || []).find(p => p.id === form.propertyId)
    const address = prop?.addressLine1 || clientAddress || ''
    const savedJob = await _saveJob({
      ...form,
      clientId,
      clientName,
      address,
      price: form.price ? parseFloat(form.price) : null,
      recurrenceDay: parseInt(form.recurrenceDay),
    })
    // Create visits immediately
    if (savedJob?.id && form.date) {
      if (form.isRecurring) {
        // Trigger server-side recurring generation (8 weeks of visits)
        try { await fetch(`/api/visits?action=generate-recurring&jobId=${savedJob.id}&weeks=8`) } catch {}
      } else {
        // One-off: create single visit
        try {
          await saveVisitAsync({
            jobId: savedJob.id, clientId,
            propertyId: form.propertyId || null,
            scheduledDate: form.date,
            scheduledStartTime: form.startTime || '09:00',
            scheduledEndTime: form.endTime || '12:00',
            status: 'scheduled', source: 'one_off',
            serviceTypeId: form.serviceTypeId || null,
            address, clientVisible: true,
          })
        } catch (err) { console.error('Visit creation failed:', err) }
      }
    }
    setForm({ title: '', date: '', status: 'scheduled', notes: '', assignee: '', isRecurring: false, recurrenceRule: 'weekly', recurrenceDay: 1, price: '', priceType: 'flat', startTime: '09:00', endTime: '12:00', propertyId: '' })
    setShowNew(false)
    onReload()
  }

  // Get property for a job
  function getJobProperty(job) {
    return (properties || []).find(p => p.id === job.propertyId)
  }

  // Calculate next occurrence for recurring jobs
  function getNextOccurrence(job) {
    if (!job.isRecurring || !job.date) return null
    const base = new Date(job.date + 'T00:00:00')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    let next = new Date(base)
    const interval = job.recurrenceRule === 'monthly' ? 30 : job.recurrenceRule === 'biweekly' ? 14 : 7
    while (next <= today) next.setDate(next.getDate() + interval)
    return next.toISOString().split('T')[0]
  }

  return (
    <div className="space-y-4">
      <button onClick={() => setShowNew(!showNew)}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">+ Schedule Job</button>

      {showNew && (
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Property selector — first field */}
          {properties.length > 0 && (
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Property</label>
              <select value={form.propertyId} onChange={e => selectProperty(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select property...</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.addressLine1} ({p.type})</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Job Title *</label>
            <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Weekly Cleaning"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date *</label>
            <input required type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start Time</label>
            <input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End Time</label>
            <input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Assignee</label>
            <input value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Price</label>
              <input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={form.priceType} onChange={e => setForm({ ...form, priceType: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="flat">Flat rate</option><option value="hourly">Hourly</option><option value="per_sqft">Per sq ft</option>
              </select>
            </div>
          </div>

          {/* Recurring toggle */}
          <div className="md:col-span-2 bg-gray-800/50 rounded-lg p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={form.isRecurring} onChange={e => setForm({ ...form, isRecurring: e.target.checked })}
                className="rounded border-gray-600" />
              Recurring job
            </label>
            {form.isRecurring && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Frequency</label>
                  <select value={form.recurrenceRule} onChange={e => setForm({ ...form, recurrenceRule: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Day</label>
                  <select value={form.recurrenceDay} onChange={e => setForm({ ...form, recurrenceDay: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value={0}>Sunday</option><option value={1}>Monday</option><option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option><option value={4}>Thursday</option><option value={5}>Friday</option><option value={6}>Saturday</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="md:col-span-2 flex gap-3">
            <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">Schedule</button>
            <button type="button" onClick={() => setShowNew(false)} className="px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-5 py-2.5 text-left">Job</th>
              <th className="px-3 py-2.5 text-left">Date</th>
              <th className="px-3 py-2.5 text-left">Time</th>
              <th className="px-3 py-2.5 text-left">Assignee</th>
              <th className="px-3 py-2.5 text-right">Price</th>
              <th className="px-3 py-2.5 text-center">Status</th>
              <th className="px-3 py-2.5 text-center">Calendar</th>
              <th className="px-3 py-2.5 text-center">Connecteam</th>
              <th className="px-3 py-2.5 text-left">Invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {jobs.map(j => {
              const jobProp = getJobProperty(j)
              const linkedInvoice = (invoices || []).find(inv => (inv.items || []).some(item => item.jobId === j.id))
              return (<>
              <tr key={j.id} className="text-gray-300 hover:bg-gray-800/30 cursor-pointer" onClick={() => setExpandedJob(expandedJob === j.id ? null : j.id)}>
                <td className="px-5 py-2.5">
                  <span className="text-white">{j.title}</span>
                  {j.isRecurring && <span className="ml-1 px-1 py-0.5 rounded text-xs bg-purple-900/30 text-purple-400">{j.recurrenceRule}</span>}
                  {jobProp && <p className="text-xs text-gray-600">{jobProp.name || jobProp.addressLine1?.split(',')[0]}</p>}
                </td>
                <td className="px-3 py-2.5">
                  {j.date}
                  {j.isRecurring && (() => {
                    const next = getNextOccurrence(j)
                    return next ? <p className="text-xs text-purple-400">Next: {next}</p> : null
                  })()}
                </td>
                <td className="px-3 py-2.5 text-gray-400">{j.startTime && j.endTime ? `${formatTime(j.startTime)} – ${formatTime(j.endTime)}` : '-'}</td>
                <td className="px-3 py-2.5">{j.assignee || '-'}</td>
                <td className="px-3 py-2.5 text-right font-mono">{j.price ? `$${j.price}` : '-'}</td>
                <td className="px-3 py-2.5 text-center">
                  <select value={j.status} onChange={async e => {
                    const newStatus = e.target.value
                    await _saveJob({ ...j, status: newStatus })
                    // Auto-generate invoice when job completed
                    if (newStatus === 'completed' && j.price) {
                      await _saveInvoice({
                        invoiceNumber: generateInvoiceNumber(),
                        clientId, clientName,
                        propertyId: j.propertyId,
                        status: 'draft',
                        issueDate: new Date().toISOString().split('T')[0],
                        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
                        subtotal: j.price, taxRate: 0, taxAmount: 0, total: j.price,
                        items: [{ jobId: j.id, description: `${j.title} (${j.date})`, quantity: 1, unitPrice: j.price, total: j.price }],
                      })
                      if (onToast) onToast(`Draft invoice created for $${j.price} — go to Invoices to send`)
                    }
                    onReload()
                  }}
                    className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-white">
                    <option value="scheduled">Scheduled</option><option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                  </select>
                </td>
                <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                  {j.googleEventId ? (
                    <span className="text-xs text-green-400" title="On Google Calendar">synced</span>
                  ) : (
                    <button onClick={() => pushToCalendar(j)} disabled={pushingId === j.id || !j.date}
                      className="px-2 py-0.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded text-xs text-white">
                      {pushingId === j.id ? '...' : 'Push'}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                  {j.connecteamShiftId ? (
                    <span className="text-xs text-green-400">synced</span>
                  ) : (
                    <button onClick={() => pushToConnecteam(j)} disabled={pushingCtId === j.id || !j.date}
                      className="px-2 py-0.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded text-xs text-white">
                      {pushingCtId === j.id ? '...' : 'Push'}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs" onClick={e => e.stopPropagation()}>
                  {linkedInvoice ? (
                    <button onClick={() => onSwitchTab && onSwitchTab('invoices')} className={`hover:brightness-125 ${linkedInvoice.status === 'paid' ? 'text-green-400' : linkedInvoice.status === 'sent' ? 'text-blue-400' : 'text-gray-400'}`}>
                      {linkedInvoice.invoiceNumber} ({linkedInvoice.status})
                    </button>
                  ) : (
                    <span className="text-gray-600">-</span>
                  )}
                </td>
              </tr>
              {/* Expanded job details */}
              {expandedJob === j.id && (
                <tr><td colSpan={9} className="px-5 py-3 bg-gray-800/30 border-b border-gray-800">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    {jobProp && (
                      <>
                        <div><span className="text-gray-500 block">Property</span><span className="text-white">{jobProp.name || jobProp.addressLine1}</span></div>
                        <div><span className="text-gray-500 block">Address</span><span className="text-gray-300">{jobProp.addressLine1}{jobProp.city ? `, ${jobProp.city}` : ''}</span></div>
                        {jobProp.accessNotes && <div className="md:col-span-2"><span className="text-gray-500 block">Access Notes</span><span className="text-yellow-400">{jobProp.accessNotes}</span></div>}
                        {jobProp.sqft && <div><span className="text-gray-500 block">Size</span><span className="text-gray-300">{jobProp.sqft} sqft, {jobProp.bedrooms}bd/{jobProp.bathrooms}ba</span></div>}
                      </>
                    )}
                    {j.notes && <div className="md:col-span-2"><span className="text-gray-500 block">Job Notes</span><span className="text-gray-300">{j.notes}</span></div>}
                    <div><span className="text-gray-500 block">Calendar</span><span className={j.googleEventId ? 'text-green-400' : 'text-gray-500'}>{j.googleEventId ? 'Synced to Google Calendar' : 'Not on calendar'}</span></div>
                  </div>
                </td></tr>
              )}
            </>)
            })}
            {jobs.length === 0 && <tr><td colSpan={9} className="px-5 py-8 text-center text-gray-500">No jobs yet.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

function InvoicesTab({ clientId, clientName, jobs, invoices, onReload }) {
  const completedJobs = jobs.filter(j => j.status === 'completed')
  const [previewInv, setPreviewInv] = useState(null)
  const [editItems, setEditItems] = useState([])

  async function quickInvoice() {
    const items = completedJobs.map(j => ({
      jobId: j.id, description: `${j.title} (${j.date})`, quantity: 1,
      unitPrice: j.price || 0, total: j.price || 0,
    })).filter(i => i.unitPrice > 0)
    if (items.length === 0) { alert('No completed jobs with prices.'); return }
    const subtotal = items.reduce((s, i) => s + i.total, 0)
    await _saveInvoice({
      invoiceNumber: generateInvoiceNumber(), clientId, clientName,
      status: 'draft', issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      subtotal, taxRate: 0, taxAmount: 0, total: subtotal, items,
    })
    onReload()
  }

  function openPreview(inv) {
    setPreviewInv(inv)
    setEditItems([...(inv.items || [])])
  }

  function updateItem(idx, field, value) {
    const updated = [...editItems]
    updated[idx] = { ...updated[idx], [field]: value }
    if (field === 'quantity' || field === 'unitPrice') {
      updated[idx].total = (parseFloat(updated[idx].quantity) || 0) * (parseFloat(updated[idx].unitPrice) || 0)
    }
    setEditItems(updated)
  }

  function addItem() {
    setEditItems(prev => [...prev, { description: '', quantity: 1, unitPrice: 0, total: 0 }])
  }

  function removeItem(idx) {
    setEditItems(editItems.filter((_, i) => i !== idx))
  }

  async function saveEdits() {
    const subtotal = editItems.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
    const taxAmount = subtotal * (previewInv.taxRate || 0)
    await _saveInvoice({ ...previewInv, items: editItems, subtotal, taxAmount, total: subtotal + taxAmount })
    setPreviewInv(null)
    onReload()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Link to="/invoices" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">+ New Invoice</Link>
        {completedJobs.length > 0 && (
          <button onClick={quickInvoice} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-medium text-white">
            Quick Invoice ({completedJobs.length} jobs)
          </button>
        )}
      </div>

      {/* Invoice preview/edit panel */}
      {previewInv && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-white">Invoice {previewInv.invoiceNumber}</h3>
            <button onClick={() => setPreviewInv(null)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><span className="text-gray-500 text-xs block">Client</span><span className="text-white">{previewInv.clientName}</span></div>
            <div><span className="text-gray-500 text-xs block">Issue Date</span><span className="text-white">{previewInv.issueDate}</span></div>
            <div><span className="text-gray-500 text-xs block">Due Date</span><span className="text-white">{previewInv.dueDate || '-'}</span></div>
            <div><span className="text-gray-500 text-xs block">Status</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${previewInv.status === 'paid' ? 'bg-green-900/40 text-green-400' : previewInv.status === 'sent' ? 'bg-blue-900/40 text-blue-400' : 'bg-gray-800 text-gray-400'}`}>{previewInv.status}</span>
            </div>
          </div>

          {/* Editable line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase">Line Items</span>
              <button onClick={addItem} className="text-xs text-blue-400 hover:text-blue-300">+ Add Line</button>
            </div>
            <div className="space-y-2">
              {editItems.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)}
                    placeholder="Description" className="col-span-5 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white" />
                  <input type="number" min="1" step="1" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)}
                    className="col-span-2 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white text-right" />
                  <input type="number" min="0" step="5" value={item.unitPrice} onChange={e => updateItem(i, 'unitPrice', e.target.value)}
                    className="col-span-2 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white text-right" />
                  <span className="col-span-2 text-sm text-gray-300 text-right font-mono">${(parseFloat(item.total) || 0).toFixed(2)}</span>
                  <button onClick={() => removeItem(i)} className="text-gray-600 hover:text-red-400">×</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3 text-sm">
              <span className="text-gray-400 mr-3">Total:</span>
              <span className="font-bold text-white">${editItems.reduce((s, i) => s + (parseFloat(i.total) || 0), 0).toFixed(2)}</span>
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t border-gray-800">
            <button onClick={saveEdits} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Save Changes</button>
            {previewInv.status === 'draft' && (
              <button onClick={async () => { await _saveInvoice({ ...previewInv, status: 'sent', items: editItems }); setPreviewInv(null); onReload() }}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs text-white">Mark Sent</button>
            )}
            {previewInv.status === 'sent' && (
              <button onClick={async () => { await _saveInvoice({ ...previewInv, status: 'paid', paidAt: new Date().toISOString() }); setPreviewInv(null); onReload() }}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs text-white">Mark Paid</button>
            )}
          </div>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-5 py-2.5 text-left">Invoice</th>
              <th className="px-3 py-2.5 text-left">Date</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="px-3 py-2.5 text-center">Status</th>
              <th className="px-3 py-2.5 text-left">Linked Job</th>
              <th className="px-5 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {invoices.map(inv => {
              const linkedJobIds = (inv.items || []).map(item => item.jobId).filter(Boolean)
              const linkedJobs = linkedJobIds.map(jid => jobs.find(j => j.id === jid)).filter(Boolean)
              return (
              <tr key={inv.id} className="text-gray-300 hover:bg-gray-800/30">
                <td className="px-5 py-2.5 font-mono text-white text-xs">{inv.invoiceNumber}</td>
                <td className="px-3 py-2.5">{inv.issueDate}</td>
                <td className="px-3 py-2.5 text-right font-mono">${(inv.total || 0).toFixed(2)}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    inv.status === 'paid' ? 'bg-green-900/40 text-green-400' :
                    inv.status === 'overdue' ? 'bg-red-900/40 text-red-400' :
                    inv.status === 'sent' ? 'bg-blue-900/40 text-blue-400' :
                    'bg-gray-800 text-gray-400'
                  }`}>{inv.status}</span>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {linkedJobs.length > 0 ? linkedJobs.map((lj, i) => (
                    <span key={lj.id}>
                      {i > 0 && ', '}
                      <span className="text-gray-300">{lj.title} ({lj.date})</span>
                    </span>
                  )) : <span className="text-gray-600">-</span>}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => openPreview(inv)} className="text-xs text-gray-400 hover:text-blue-400">View/Edit</button>
                    {inv.status === 'draft' && (
                      <button onClick={async () => { await _saveInvoice({ ...inv, status: 'sent' }); onReload() }}
                        className="text-xs text-gray-500 hover:text-green-400">Send</button>
                    )}
                    {inv.status === 'sent' && (
                      <button onClick={async () => { await _saveInvoice({ ...inv, status: 'paid', paidAt: new Date().toISOString() }); onReload() }}
                        className="text-xs text-gray-500 hover:text-green-400">Paid</button>
                    )}
                  </div>
                </td>
              </tr>
            )})}
            {invoices.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── DOCUMENTS TAB ──
function DocumentsTab({ clientName }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { loadFiles() }, [clientName])

  async function loadFiles() {
    setLoading(true)
    try {
      const res = await fetch(`/api/google?action=drive-list&clientName=${encodeURIComponent(clientName)}`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files || [])
      } else {
        setError('Google Drive not connected. Add Drive scope to your Google OAuth.')
      }
    } catch { setError('Could not load files') }
    setLoading(false)
  }

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        const content = ev.target.result
        await fetch('/api/google?action=drive-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientName, fileName: file.name, content, mimeType: file.type || 'application/octet-stream' }),
        })
        setUploading(false)
        loadFiles()
      }
      reader.readAsText(file)
    } catch { setUploading(false) }
  }

  async function saveNote(title, content) {
    await fetch('/api/google?action=drive-save-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName, title, content }),
    })
    loadFiles()
  }

  async function deleteFile(fileId) {
    if (!confirm('Delete this file from Google Drive?')) return
    await fetch('/api/google?action=drive-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    })
    loadFiles()
  }

  const FILE_ICONS = {
    'application/vnd.google-apps.document': '📄',
    'application/vnd.google-apps.spreadsheet': '📊',
    'application/pdf': '📕',
    'image/': '🖼️',
    'text/': '📝',
  }

  function getIcon(mimeType) {
    for (const [key, icon] of Object.entries(FILE_ICONS)) {
      if (mimeType?.includes(key)) return icon
    }
    return '📎'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{files.length} file{files.length !== 1 ? 's' : ''} in Google Drive</p>
        <div className="flex gap-2">
          <label className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-medium text-white cursor-pointer">
            {uploading ? 'Uploading...' : 'Upload File'}
            <input type="file" onChange={handleUpload} className="hidden" disabled={uploading} />
          </label>
          <button onClick={() => {
            const title = prompt('Document title:')
            if (!title) return
            const content = prompt('Content (or paste text):')
            if (content) saveNote(title, content)
          }} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">
            + New Doc
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-yellow-400">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading files...</p>}

      {!loading && files.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {files.map(f => (
            <div key={f.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg shrink-0">{getIcon(f.mimeType)}</span>
                <div className="min-w-0">
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm text-white hover:text-blue-400 truncate block">{f.name}</a>
                  <p className="text-xs text-gray-600">{f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ''} {f.size ? `· ${(f.size / 1024).toFixed(0)}KB` : ''}</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-blue-400">Open</a>
                <button onClick={() => deleteFile(f.id)} className="text-xs text-gray-500 hover:text-red-400">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && files.length === 0 && !error && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-500 text-sm">No documents yet. Upload files or create a new doc.</p>
          <p className="text-xs text-gray-600 mt-1">Files are stored in Google Drive → Workflow HQ → {clientName}</p>
        </div>
      )}
    </div>
  )
}

function NotesTab({ client, onSave }) {
  const [notes, setNotes] = useState(client.notes || '')
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    await _saveClient({ id: client.id, notes })
    setSaved(true)
    onSave()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Custom fields */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <CustomFields
          label="Custom Client Fields"
          fields={client.customFields || {}}
          onSave={async (fields) => { await _saveClient({ id: client.id, customFields: fields }); onSave() }}
        />
      </div>

      {/* Notes */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">Client Notes</h3>
      <textarea rows={8} value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Cleaning preferences, access codes, special instructions..."
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">Save Notes</button>
        {saved && <span className="text-sm text-green-400">Saved!</span>}
      </div>
      </div>
    </div>
  )
}
