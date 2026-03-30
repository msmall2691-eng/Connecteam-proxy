import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getClient, saveClient, getConversations, saveConversation, addMessage, getJobs, saveJob, getInvoices, saveInvoice, generateInvoiceNumber } from '../lib/store'
import QuoteBuilder from '../components/QuoteBuilder'

const TABS = ['overview', 'quotes', 'conversations', 'jobs', 'invoices', 'notes']

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [client, setClient] = useState(null)
  const [tab, setTab] = useState(searchParams.get('tab') || 'overview')
  const [convos, setConvos] = useState([])
  const [jobs, setJobs] = useState([])
  const [invoices, setInvoices] = useState([])

  useEffect(() => { reload() }, [id])
  useEffect(() => { const t = searchParams.get('tab'); if (t) setTab(t) }, [searchParams])

  function reload() {
    const c = getClient(id)
    if (!c) return navigate('/clients')
    setClient(c)
    setConvos(getConversations(id))
    setJobs(getJobs(id))
    setInvoices(getInvoices(id))
  }

  if (!client) return null

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/clients" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">&larr; Back to Clients</Link>
          <h1 className="text-2xl font-bold text-white mt-1">{client.name}</h1>
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
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab client={client} convos={convos} jobs={jobs} invoices={invoices} />}
      {tab === 'quotes' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-base font-semibold text-white mb-4">Send Quote</h3>
          <QuoteBuilder client={client} onSave={reload} />
        </div>
      )}
      {tab === 'conversations' && <ConversationsTab clientId={id} convos={convos} onReload={reload} />}
      {tab === 'jobs' && <JobsTab clientId={id} clientName={client.name} jobs={jobs} onReload={reload} />}
      {tab === 'invoices' && <InvoicesTab clientId={id} clientName={client.name} jobs={jobs} invoices={invoices} onReload={reload} />}
      {tab === 'notes' && <NotesTab client={client} onSave={reload} />}
    </div>
  )
}

function OverviewTab({ client, convos, jobs, invoices }) {
  const completedJobs = jobs.filter(j => j.status === 'completed').length
  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
  const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">Client Info</h3>
        <div className="space-y-2 text-sm">
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
  )
}

function InfoRow({ label, value }) {
  if (!value) return null
  return <div><span className="text-gray-500">{label}: </span><span className="text-gray-300 capitalize">{value}</span></div>
}

function ConversationsTab({ clientId, convos, onReload }) {
  const [showNew, setShowNew] = useState(false)
  const [newConvo, setNewConvo] = useState({ subject: '', channel: 'email' })
  const [activeConvo, setActiveConvo] = useState(null)
  const [newMsg, setNewMsg] = useState('')

  function createConvo(e) {
    e.preventDefault()
    if (!newConvo.subject.trim()) return
    saveConversation({ ...newConvo, clientId, messages: [] })
    setShowNew(false)
    setNewConvo({ subject: '', channel: 'email' })
    onReload()
  }

  function sendMessage(e) {
    e.preventDefault()
    if (!newMsg.trim() || !activeConvo) return
    addMessage(activeConvo.id, { content: newMsg.trim(), direction: 'outbound', sender: 'You' })
    setNewMsg('')
    onReload()
    setActiveConvo(getConversations(clientId).find(c => c.id === activeConvo.id))
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

function JobsTab({ clientId, clientName, jobs, onReload }) {
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({
    title: '', date: '', status: 'scheduled', notes: '', assignee: '',
    isRecurring: false, recurrenceRule: 'weekly', recurrenceDay: 1,
    price: '', priceType: 'flat', startTime: '', endTime: '',
  })

  function handleSubmit(e) {
    e.preventDefault()
    saveJob({
      ...form,
      clientId,
      clientName,
      price: form.price ? parseFloat(form.price) : null,
      recurrenceDay: parseInt(form.recurrenceDay),
    })
    setForm({ title: '', date: '', status: 'scheduled', notes: '', assignee: '', isRecurring: false, recurrenceRule: 'weekly', recurrenceDay: 1, price: '', priceType: 'flat', startTime: '', endTime: '' })
    setShowNew(false)
    onReload()
  }

  return (
    <div className="space-y-4">
      <button onClick={() => setShowNew(!showNew)}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">+ Schedule Job</button>

      {showNew && (
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-5 py-2.5 text-left">Job</th>
              <th className="px-3 py-2.5 text-left">Date</th>
              <th className="px-3 py-2.5 text-left">Time</th>
              <th className="px-3 py-2.5 text-left">Assignee</th>
              <th className="px-3 py-2.5 text-right">Price</th>
              <th className="px-3 py-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {jobs.map(j => (
              <tr key={j.id} className="text-gray-300 hover:bg-gray-800/30">
                <td className="px-5 py-2.5">
                  <span className="text-white">{j.title}</span>
                  {j.isRecurring && <span className="ml-1 px-1 py-0.5 rounded text-xs bg-purple-900/30 text-purple-400">{j.recurrenceRule}</span>}
                </td>
                <td className="px-3 py-2.5">{j.date}</td>
                <td className="px-3 py-2.5 text-gray-400">{j.startTime && j.endTime ? `${j.startTime}-${j.endTime}` : '-'}</td>
                <td className="px-3 py-2.5">{j.assignee || '-'}</td>
                <td className="px-3 py-2.5 text-right font-mono">{j.price ? `$${j.price}` : '-'}</td>
                <td className="px-3 py-2.5 text-center">
                  <select value={j.status} onChange={e => {
                    const newStatus = e.target.value
                    saveJob({ ...j, status: newStatus })
                    // Auto-generate invoice when job completed
                    if (newStatus === 'completed' && j.price) {
                      saveInvoice({
                        invoiceNumber: generateInvoiceNumber(),
                        clientId, clientName,
                        status: 'draft',
                        issueDate: new Date().toISOString().split('T')[0],
                        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
                        subtotal: j.price, taxRate: 0, taxAmount: 0, total: j.price,
                        items: [{ jobId: j.id, description: `${j.title} (${j.date})`, quantity: 1, unitPrice: j.price, total: j.price }],
                      })
                    }
                    onReload()
                  }}
                    className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-white">
                    <option value="scheduled">Scheduled</option><option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                  </select>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500">No jobs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InvoicesTab({ clientId, clientName, jobs, invoices, onReload }) {
  const completedJobs = jobs.filter(j => j.status === 'completed')

  function quickInvoice() {
    // Create invoice from unbilled completed jobs
    const items = completedJobs.map(j => ({
      jobId: j.id,
      description: `${j.title} (${j.date})`,
      quantity: 1,
      unitPrice: j.price || 0,
      total: j.price || 0,
    })).filter(i => i.unitPrice > 0)

    if (items.length === 0) {
      alert('No completed jobs with prices to invoice.')
      return
    }

    const subtotal = items.reduce((s, i) => s + i.total, 0)
    saveInvoice({
      invoiceNumber: generateInvoiceNumber(),
      clientId,
      clientName,
      status: 'draft',
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      subtotal,
      taxRate: 0,
      taxAmount: 0,
      total: subtotal,
      items,
    })
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

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-5 py-2.5 text-left">Invoice</th>
              <th className="px-3 py-2.5 text-left">Date</th>
              <th className="px-3 py-2.5 text-left">Due</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="px-3 py-2.5 text-center">Status</th>
              <th className="px-5 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {invoices.map(inv => (
              <tr key={inv.id} className="text-gray-300 hover:bg-gray-800/30">
                <td className="px-5 py-2.5 font-mono text-white text-xs">{inv.invoiceNumber}</td>
                <td className="px-3 py-2.5">{inv.issueDate}</td>
                <td className="px-3 py-2.5">{inv.dueDate || '-'}</td>
                <td className="px-3 py-2.5 text-right font-mono">${(inv.total || 0).toFixed(2)}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    inv.status === 'paid' ? 'bg-green-900/40 text-green-400' :
                    inv.status === 'overdue' ? 'bg-red-900/40 text-red-400' :
                    inv.status === 'sent' ? 'bg-blue-900/40 text-blue-400' :
                    'bg-gray-800 text-gray-400'
                  }`}>{inv.status}</span>
                </td>
                <td className="px-5 py-2.5 text-right">
                  {inv.status === 'draft' && (
                    <button onClick={() => { saveInvoice({ ...inv, status: 'sent' }); onReload() }}
                      className="text-xs text-gray-500 hover:text-green-400">Mark Sent</button>
                  )}
                  {inv.status === 'sent' && (
                    <button onClick={() => { saveInvoice({ ...inv, status: 'paid', paidAt: new Date().toISOString() }); onReload() }}
                      className="text-xs text-gray-500 hover:text-green-400">Mark Paid</button>
                  )}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NotesTab({ client, onSave }) {
  const [notes, setNotes] = useState(client.notes || '')
  const [saved, setSaved] = useState(false)

  function handleSave() {
    saveClient({ id: client.id, notes })
    setSaved(true)
    onSave()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">Client Notes</h3>
      <textarea rows={12} value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Add notes... cleaning preferences, access codes, special instructions, etc."
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">Save Notes</button>
        {saved && <span className="text-sm text-green-400">Saved!</span>}
      </div>
    </div>
  )
}
