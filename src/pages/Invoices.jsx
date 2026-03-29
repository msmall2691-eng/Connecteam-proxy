import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getInvoices, saveInvoice, getClients, getJobs, generateInvoiceNumber } from '../lib/store'

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

  useEffect(() => { reload() }, [])

  function reload() {
    setInvoices(getInvoices())
    setClients(getClients())
  }

  const filtered = invoices.filter(i => filterStatus === 'all' || i.status === filterStatus)

  const stats = {
    outstanding: invoices.filter(i => i.status === 'sent').reduce((s, i) => s + i.total, 0),
    overdue: invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.total, 0),
    paidThisMonth: invoices.filter(i => {
      if (i.status !== 'paid') return false
      const paid = new Date(i.paidAt || i.updatedAt)
      const now = new Date()
      return paid.getMonth() === now.getMonth() && paid.getFullYear() === now.getFullYear()
    }).reduce((s, i) => s + i.total, 0),
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
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
      <div className="grid grid-cols-3 gap-4">
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
      </div>

      {/* Filter */}
      <div className="flex gap-1">
        {['all', 'draft', 'sent', 'paid', 'overdue', 'cancelled'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterStatus === s ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}>{s.charAt(0).toUpperCase() + s.slice(1)}</button>
        ))}
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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-5 py-3 text-left">Invoice</th>
              <th className="px-3 py-3 text-left">Client</th>
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
                <td className="px-3 py-3">{inv.clientName || '-'}</td>
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
                      <button onClick={() => { saveInvoice({ ...inv, status: 'sent' }); reload() }}
                        className="text-xs text-gray-500 hover:text-green-400">Mark Sent</button>
                    )}
                    {inv.status === 'sent' && (
                      <button onClick={() => { saveInvoice({ ...inv, status: 'paid', paidAt: new Date().toISOString() }); reload() }}
                        className="text-xs text-gray-500 hover:text-green-400">Mark Paid</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-500">No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
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

  function handleSubmit(e) {
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

    saveInvoice(inv)
    onSave()
  }

  const subtotal = form.items.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
  const taxAmount = subtotal * (parseFloat(form.taxRate) || 0)
  const total = subtotal + taxAmount

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
      <h2 className="text-base font-semibold text-white">{invoice ? 'Edit Invoice' : 'New Invoice'}</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)}
                  placeholder="Description" className="col-span-5 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" min="0" step="0.5" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)}
                  placeholder="Qty" className="col-span-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateItem(i, 'unitPrice', e.target.value)}
                  placeholder="Price" className="col-span-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="col-span-2 text-sm text-gray-300 text-right font-mono">${(parseFloat(item.total) || 0).toFixed(2)}</span>
                <button type="button" onClick={() => removeItem(i)} className="col-span-1 text-gray-600 hover:text-red-400 text-center">&times;</button>
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
