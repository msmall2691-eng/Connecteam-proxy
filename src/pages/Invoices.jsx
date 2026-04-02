import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getInvoices, getInvoicesAsync, saveInvoice, saveInvoiceAsync, getClients, getClientsAsync, getJobs, getJobsAsync, generateInvoiceNumber } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'

function buildInvoiceEmailHtml(inv) {
  const itemRows = (inv.items || []).map(item =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">${item.description}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">${item.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">$${(parseFloat(item.unitPrice) || 0).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;font-weight:600;">$${(parseFloat(item.total) || 0).toFixed(2)}</td>
    </tr>`
  ).join('');

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:32px 24px;text-align:center;">
    <h1 style="color:#ffffff;font-size:22px;margin:0;">Maine Cleaning Co</h1>
    <p style="color:#bfdbfe;font-size:13px;margin:8px 0 0;">Invoice ${inv.invoiceNumber}</p>
  </div>
  <div style="padding:24px;">
    <table style="width:100%;margin-bottom:20px;font-size:14px;">
      <tr>
        <td style="color:#6b7280;">Bill To:</td>
        <td style="text-align:right;color:#6b7280;">Invoice Date:</td>
      </tr>
      <tr>
        <td style="color:#111827;font-weight:600;padding-bottom:12px;">${inv.clientName || 'N/A'}</td>
        <td style="text-align:right;color:#111827;padding-bottom:12px;">${inv.issueDate || 'N/A'}</td>
      </tr>
      ${inv.dueDate ? `<tr><td></td><td style="text-align:right;color:#6b7280;">Due Date:</td></tr><tr><td></td><td style="text-align:right;color:#dc2626;font-weight:600;">${inv.dueDate}</td></tr>` : ''}
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:600;font-size:12px;text-transform:uppercase;">Description</th>
          <th style="padding:10px 12px;text-align:center;color:#6b7280;font-weight:600;font-size:12px;text-transform:uppercase;">Qty</th>
          <th style="padding:10px 12px;text-align:right;color:#6b7280;font-weight:600;font-size:12px;text-transform:uppercase;">Price</th>
          <th style="padding:10px 12px;text-align:right;color:#6b7280;font-weight:600;font-size:12px;text-transform:uppercase;">Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <table style="width:100%;font-size:14px;margin-bottom:24px;">
      <tr><td style="text-align:right;padding:4px 12px;color:#6b7280;">Subtotal:</td><td style="text-align:right;padding:4px 12px;color:#374151;width:100px;">$${(inv.subtotal || 0).toFixed(2)}</td></tr>
      ${inv.taxAmount ? `<tr><td style="text-align:right;padding:4px 12px;color:#6b7280;">Tax:</td><td style="text-align:right;padding:4px 12px;color:#374151;">$${inv.taxAmount.toFixed(2)}</td></tr>` : ''}
      <tr style="border-top:2px solid #111827;"><td style="text-align:right;padding:10px 12px;color:#111827;font-weight:700;font-size:16px;">Total Due:</td><td style="text-align:right;padding:10px 12px;color:#111827;font-weight:700;font-size:16px;">$${(inv.total || 0).toFixed(2)}</td></tr>
    </table>
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;font-size:13px;color:#1e40af;">
      <strong>Payment Instructions</strong><br>
      Please send payment via Zelle, Venmo, check, or card on file. Contact us if you have any questions.<br>
      ${inv.dueDate ? `<strong>Payment is due by ${inv.dueDate}.</strong>` : ''}
    </div>
    ${inv.notes ? `<p style="margin-top:16px;font-size:13px;color:#6b7280;"><em>${inv.notes}</em></p>` : ''}
    <div style="text-align:center;margin-top:24px;">
      <a href="${window.location.origin}/portal.html?token=${btoa(inv.clientId + '|' + Date.now()).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}" style="display:inline-block;padding:10px 24px;background:#1e40af;color:white;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">View Your Portal</a>
    </div>
    <p style="text-align:center;margin-top:12px;font-size:12px;color:#9ca3af;">Thank you for your business!</p>
  </div>
</div>`;
}

async function sendInvoiceEmail(inv) {
  const allClients = isSupabaseConfigured() ? await getClientsAsync() : getClients();
  const client = allClients.find(c => c.id === inv.clientId);
  const toEmail = client?.email;
  if (!toEmail) {
    throw new Error('Client does not have an email address. Please add one in Client details first.');
  }

  const html = buildInvoiceEmailHtml(inv);
  const res = await fetch('/api/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'gmail-send',
      to: toEmail,
      subject: `Invoice ${inv.invoiceNumber} from Maine Cleaning Co - $${inv.total.toFixed(2)}`,
      body: html,
      isHtml: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send email');
  }
  return res.json();
}

const STATUS_COLORS = {
  draft: 'bg-gray-800 text-gray-400',
  sent: 'bg-blue-900/40 text-blue-400',
  paid: 'bg-green-900/40 text-green-400',
  overdue: 'bg-red-900/40 text-red-400',
  cancelled: 'bg-gray-800 text-gray-500',
}

export default function Invoices() {
  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [activeInvoice, setActiveInvoice] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [sendingId, setSendingId] = useState(null)
  const [emailStatus, setEmailStatus] = useState({})
  const [searchQuery, setSearchQuery] = useState('')
  const [filterClient, setFilterClient] = useState('all')
  const [dateRange, setDateRange] = useState('all')
  const [sortBy, setSortBy] = useState('date-desc')

  useEffect(() => { reload() }, [])

  async function reload() {
    if (isSupabaseConfigured()) {
      const [inv, cls] = await Promise.all([getInvoicesAsync(), getClientsAsync()])
      setInvoices(inv); setClients(cls)
    } else {
      setInvoices(getInvoices()); setClients(getClients())
    }
  }

  const filtered = useMemo(() => {
    let result = invoices

    // Status filter
    if (filterStatus !== 'all') result = result.filter(i => i.status === filterStatus)

    // Client filter
    if (filterClient !== 'all') result = result.filter(i => i.clientId === filterClient)

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(i =>
        (i.clientName || '').toLowerCase().includes(q) ||
        (i.invoiceNumber || '').toLowerCase().includes(q) ||
        (i.notes || '').toLowerCase().includes(q)
      )
    }

    // Date range filter
    if (dateRange !== 'all') {
      const now = new Date()
      let start
      if (dateRange === 'this-week') {
        start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0)
      } else if (dateRange === 'this-month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1)
      } else if (dateRange === 'last-month') {
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const end = new Date(now.getFullYear(), now.getMonth(), 0)
        result = result.filter(i => {
          const d = new Date(i.issueDate)
          return d >= start && d <= end
        })
        start = null // already filtered
      }
      if (start) {
        result = result.filter(i => new Date(i.issueDate) >= start)
      }
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'date-asc': return new Date(a.issueDate) - new Date(b.issueDate)
        case 'date-desc': return new Date(b.issueDate) - new Date(a.issueDate)
        case 'amount-asc': return (a.total || 0) - (b.total || 0)
        case 'amount-desc': return (b.total || 0) - (a.total || 0)
        case 'status': return (a.status || '').localeCompare(b.status || '')
        default: return new Date(b.issueDate) - new Date(a.issueDate)
      }
    })

    return result
  }, [invoices, filterStatus, filterClient, searchQuery, dateRange, sortBy])

  const filteredTotal = filtered.reduce((s, i) => s + (i.total || 0), 0)

  const stats = {
    outstanding: invoices.filter(i => i.status === 'sent').reduce((s, i) => s + i.total, 0),
    overdue: invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.total, 0),
    paidThisMonth: invoices.filter(i => {
      if (i.status !== 'paid') return false
      const paid = new Date(i.paidAt || i.updatedAt)
      const now = new Date()
      return paid.getMonth() === now.getMonth() && paid.getFullYear() === now.getFullYear()
    }).reduce((s, i) => s + i.total, 0),
    draftCount: invoices.filter(i => i.status === 'draft').length,
  }

  // Unique clients that have invoices, for the client filter dropdown
  const invoiceClients = useMemo(() => {
    const map = new Map()
    invoices.forEach(i => { if (i.clientId && i.clientName) map.set(i.clientId, i.clientName) })
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [invoices])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">{invoices.length} total invoices</p>
        </div>
        <button onClick={() => { setActiveInvoice(null); setShowForm(true) }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors">
          + New Invoice
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Outstanding</p>
          <p className="text-xl font-bold text-blue-400">${stats.outstanding.toFixed(2)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Overdue</p>
          <p className="text-xl font-bold text-red-400">${stats.overdue.toFixed(2)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Paid This Month</p>
          <p className="text-xl font-bold text-green-400">${stats.paidThisMonth.toFixed(2)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Drafts</p>
          <p className="text-xl font-bold text-gray-400">{stats.draftCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        {/* Search + Client + Date Range */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search invoices..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={filterClient}
            onChange={e => setFilterClient(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Clients</option>
            {invoiceClients.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="amount-desc">Highest Amount</option>
            <option value="amount-asc">Lowest Amount</option>
            <option value="status">Status</option>
          </select>
        </div>

        {/* Date range toggles + Status filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1">
            {[['all', 'All Time'], ['this-week', 'This Week'], ['this-month', 'This Month'], ['last-month', 'Last Month']].map(([val, label]) => (
              <button key={val} onClick={() => setDateRange(val)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  dateRange === val ? 'bg-purple-600/20 text-purple-400' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}>{label}</button>
            ))}
          </div>
          <div className="w-px h-5 bg-gray-700 hidden sm:block" />
          <div className="flex flex-wrap gap-1">
            {['all', 'draft', 'sent', 'paid', 'overdue', 'cancelled'].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterStatus === s ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}>{s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Invoice Form */}
      {showForm && (
        <InvoiceForm
          invoice={activeInvoice}
          clients={clients}
          onSave={() => { setShowForm(false); reload() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Invoice List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-5 py-3 text-left">Invoice</th>
              <th className="px-3 py-3 text-left">Client</th>
              <th className="px-3 py-3 text-left">Source</th>
              <th className="px-3 py-3 text-left">Date</th>
              <th className="px-3 py-3 text-left">Due</th>
              <th className="px-3 py-3 text-right">Amount</th>
              <th className="px-3 py-3 text-center">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {filtered.map(inv => (
              <tr key={inv.id} className="text-gray-300 hover:bg-gray-800/30 transition-colors">
                <td className="px-5 py-3 font-mono text-white">{inv.invoiceNumber}</td>
                <td className="px-3 py-3">{inv.clientId ? <Link to={`/clients/${inv.clientId}`} className="hover:text-blue-400 transition-colors">{inv.clientName || '-'}</Link> : (inv.clientName || '-')}</td>
                <td className="px-3 py-3 text-xs text-gray-500">
                  {inv.quoteId ? (
                    <Link to={`/clients/${inv.clientId}`} className="text-purple-400 hover:text-purple-300">Quote</Link>
                  ) : inv.items?.some(item => item.jobId) ? (
                    <Link to={`/clients/${inv.clientId}`} className="text-cyan-400 hover:text-cyan-300">Job</Link>
                  ) : (
                    <span className="text-gray-600">Manual</span>
                  )}
                </td>
                <td className="px-3 py-3">{inv.issueDate}</td>
                <td className="px-3 py-3">{inv.dueDate || '-'}</td>
                <td className="px-3 py-3 text-right font-mono">${inv.total.toFixed(2)}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[inv.status]}`}>{inv.status}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setActiveInvoice(inv); setShowForm(true) }}
                      className="text-xs text-gray-500 hover:text-blue-400">Edit</button>
                    {inv.status === 'draft' && (
                      <button
                        disabled={sendingId === inv.id}
                        onClick={async () => {
                          setSendingId(inv.id)
                          setEmailStatus(prev => ({ ...prev, [inv.id]: null }))
                          try {
                            await sendInvoiceEmail(inv)
                            const updated = { ...inv, status: 'sent' }
                            isSupabaseConfigured() ? await saveInvoiceAsync(updated) : saveInvoice(updated)
                            setEmailStatus(prev => ({ ...prev, [inv.id]: 'sent' }))
                            reload()
                          } catch (err) {
                            setEmailStatus(prev => ({ ...prev, [inv.id]: err.message }))
                          } finally {
                            setSendingId(null)
                          }
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
                      >
                        {sendingId === inv.id ? 'Sending...' : emailStatus[inv.id] === 'sent' ? 'Sent & Emailed' : 'Send & Email'}
                      </button>
                    )}
                    {inv.status === 'draft' && (
                      <button onClick={async () => { isSupabaseConfigured() ? await saveInvoiceAsync({ ...inv, status: 'sent' }) : saveInvoice({ ...inv, status: 'sent' }); reload() }}
                        className="text-xs text-gray-500 hover:text-green-400">Mark Sent Only</button>
                    )}
                    {inv.status === 'sent' && (
                      <button onClick={async () => { isSupabaseConfigured() ? await saveInvoiceAsync({ ...inv, status: 'paid', paidAt: new Date().toISOString() }) : saveInvoice({ ...inv, status: 'paid', paidAt: new Date().toISOString() }); reload() }}
                        className="text-xs text-gray-500 hover:text-green-400">Mark Paid</button>
                    )}
                    {(inv.status === 'sent' || inv.status === 'overdue') && (
                      <button
                        disabled={sendingId === inv.id}
                        onClick={async () => {
                          setSendingId(inv.id)
                          setEmailStatus(prev => ({ ...prev, [inv.id]: null }))
                          try {
                            await sendInvoiceEmail(inv)
                            setEmailStatus(prev => ({ ...prev, [inv.id]: 'sent' }))
                          } catch (err) {
                            setEmailStatus(prev => ({ ...prev, [inv.id]: err.message }))
                          } finally {
                            setSendingId(null)
                          }
                        }}
                        className="text-xs text-gray-500 hover:text-purple-400 disabled:opacity-50"
                      >
                        {sendingId === inv.id ? 'Sending...' : emailStatus[inv.id] === 'sent' ? 'Emailed' : 'Resend Email'}
                      </button>
                    )}
                  </div>
                  {emailStatus[inv.id] && emailStatus[inv.id] !== 'sent' && (
                    <p className="text-xs text-red-400 mt-1 text-right">{emailStatus[inv.id]}</p>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-12 text-center">
                <div className="space-y-2">
                  <p className="text-gray-500">{invoices.length === 0 ? 'No invoices yet.' : 'No invoices match the current filters.'}</p>
                  {invoices.length === 0 && (
                    <p className="text-sm text-gray-600">
                      Create one from a client page or{' '}
                      <Link to="/clients" className="text-blue-400 hover:text-blue-300 underline">browse your clients</Link>{' '}
                      to get started.
                    </p>
                  )}
                </div>
              </td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-700 bg-gray-800/40">
                <td colSpan={5} className="px-5 py-3 text-xs text-gray-400 font-medium uppercase">
                  {filtered.length} invoice{filtered.length !== 1 ? 's' : ''} shown
                </td>
                <td className="px-3 py-3 text-right font-mono text-sm text-white font-semibold">${filteredTotal.toFixed(2)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>
    </div>
  )
}

function InvoiceForm({ invoice, clients, onSave, onCancel }) {
  const clientJobs = invoice?.clientId ? getJobs(invoice.clientId) : []

  const [form, setForm] = useState({
    invoiceNumber: invoice?.invoiceNumber || generateInvoiceNumber(),
    clientId: invoice?.clientId || '',
    clientName: invoice?.clientName || '',
    status: invoice?.status || 'draft',
    issueDate: invoice?.issueDate || new Date().toISOString().split('T')[0],
    dueDate: invoice?.dueDate || '',
    taxRate: invoice?.taxRate || 0,
    notes: invoice?.notes || '',
    items: invoice?.items || [{ description: '', quantity: 1, unitPrice: 0, total: 0 }],
  })

  function updateItem(idx, field, value) {
    const items = [...form.items]
    items[idx] = { ...items[idx], [field]: value }
    if (field === 'quantity' || field === 'unitPrice') {
      items[idx].total = (parseFloat(items[idx].quantity) || 0) * (parseFloat(items[idx].unitPrice) || 0)
    }
    setForm({ ...form, items })
  }

  function addItem() {
    setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unitPrice: 0, total: 0 }] })
  }

  function removeItem(idx) {
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })
  }

  function addFromJob(job) {
    const item = {
      description: `${job.title}${job.date ? ` (${job.date})` : ''}`,
      quantity: 1,
      unitPrice: job.price || 0,
      total: job.price || 0,
      jobId: job.id,
    }
    setForm({ ...form, items: [...form.items, item] })
  }

  function handleClientChange(clientId) {
    const client = clients.find(c => c.id === clientId)
    setForm({ ...form, clientId, clientName: client?.name || '' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const subtotal = form.items.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
    const taxAmount = subtotal * (parseFloat(form.taxRate) || 0)
    const total = subtotal + taxAmount

    const inv = {
      ...(invoice?.id ? { id: invoice.id } : {}),
      invoiceNumber: form.invoiceNumber,
      clientId: form.clientId,
      clientName: form.clientName,
      status: form.status,
      issueDate: form.issueDate,
      dueDate: form.dueDate || null,
      subtotal,
      taxRate: parseFloat(form.taxRate) || 0,
      taxAmount,
      total,
      notes: form.notes,
      items: form.items.filter(i => i.description),
    }

    if (isSupabaseConfigured()) { await saveInvoiceAsync(inv) } else { saveInvoice(inv) }
    onSave()
  }

  const subtotal = form.items.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
  const taxAmount = subtotal * (parseFloat(form.taxRate) || 0)
  const total = subtotal + taxAmount

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
      <h2 className="text-base font-semibold text-white">{invoice ? 'Edit Invoice' : 'New Invoice'}</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice #</label>
            <input value={form.invoiceNumber} readOnly
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 font-mono" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Client</label>
            <select value={form.clientId} onChange={e => handleClientChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select client...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Issue Date</label>
            <input type="date" value={form.issueDate} onChange={e => setForm({ ...form, issueDate: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Due Date</label>
            <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* Line Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Line Items</label>
            <div className="flex gap-2">
              {form.clientId && clientJobs.filter(j => j.status === 'completed').length > 0 && (
                <div className="relative group">
                  <button type="button" className="text-xs text-blue-400 hover:text-blue-300">+ From Job</button>
                  <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg p-2 hidden group-hover:block z-10 w-64">
                    {clientJobs.filter(j => j.status === 'completed').slice(0, 5).map(j => (
                      <button key={j.id} type="button" onClick={() => addFromJob(j)}
                        className="w-full text-left px-2 py-1.5 rounded text-xs text-gray-300 hover:bg-gray-700">
                        {j.title} - {j.date} {j.price ? `($${j.price})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" onClick={addItem} className="text-xs text-blue-400 hover:text-blue-300">+ Add Line</button>
            </div>
          </div>

          <div className="space-y-2">
            {form.items.map((item, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)}
                  placeholder="Description" className="sm:col-span-5 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" min="0" step="0.5" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)}
                  placeholder="Qty" className="sm:col-span-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateItem(i, 'unitPrice', e.target.value)}
                  placeholder="Price" className="sm:col-span-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="sm:col-span-2 text-sm text-gray-300 text-right font-mono">${(parseFloat(item.total) || 0).toFixed(2)}</span>
                <button type="button" onClick={() => removeItem(i)} className="sm:col-span-1 text-gray-600 hover:text-red-400 text-center">&times;</button>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>Subtotal</span>
              <span className="font-mono">${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-gray-400">
              <div className="flex items-center gap-2">
                <span>Tax</span>
                <input type="number" min="0" max="1" step="0.01" value={form.taxRate}
                  onChange={e => setForm({ ...form, taxRate: e.target.value })}
                  className="w-16 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white text-right" />
              </div>
              <span className="font-mono">${taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-white font-semibold border-t border-gray-700 pt-2">
              <span>Total</span>
              <span className="font-mono">${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Notes</label>
          <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="Payment terms, thank you note, etc."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="flex gap-3">
          <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">
            {invoice ? 'Save' : 'Create Invoice'}
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300">Cancel</button>
        </div>
      </form>
    </div>
  )
}
