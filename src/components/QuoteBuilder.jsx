import { useState } from 'react'
import { saveInvoice, generateInvoiceNumber, saveJob, saveClient } from '../lib/store'

const SERVICE_TEMPLATES = [
  { name: 'Standard Cleaning', price: 150, unit: 'flat', desc: 'Regular residential cleaning' },
  { name: 'Deep Cleaning', price: 250, unit: 'flat', desc: 'Thorough deep clean, all rooms' },
  { name: 'Move-In/Move-Out', price: 300, unit: 'flat', desc: 'Full property move cleaning' },
  { name: 'Airbnb Turnover', price: 175, unit: 'flat', desc: 'Same-day rental turnover' },
  { name: 'Commercial Janitorial', price: 45, unit: 'hourly', desc: 'Office/commercial cleaning' },
  { name: 'Post-Construction', price: 400, unit: 'flat', desc: 'Post-construction cleanup' },
  { name: 'Window Cleaning', price: 100, unit: 'flat', desc: 'Interior/exterior windows' },
  { name: 'Carpet Cleaning', price: 75, unit: 'per_room', desc: 'Per room carpet cleaning' },
]

export default function QuoteBuilder({ client, onSave, onSend }) {
  const [items, setItems] = useState([])
  const [notes, setNotes] = useState('')
  const [frequency, setFrequency] = useState('one-time')
  const [preferredDay, setPreferredDay] = useState(1)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  function addTemplate(template) {
    setItems(prev => [...prev, {
      description: template.name,
      quantity: 1,
      unitPrice: template.price,
      total: template.price,
      priceType: template.unit,
    }])
  }

  function updateItem(idx, field, value) {
    const updated = [...items]
    updated[idx] = { ...updated[idx], [field]: value }
    if (field === 'quantity' || field === 'unitPrice') {
      updated[idx].total = (parseFloat(updated[idx].quantity) || 0) * (parseFloat(updated[idx].unitPrice) || 0)
    }
    setItems(updated)
  }

  function removeItem(idx) {
    setItems(items.filter((_, i) => i !== idx))
  }

  const subtotal = items.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)

  async function handleSend(channel) {
    if (items.length === 0) return
    setSending(true)

    // Create quote as a draft invoice
    const quote = saveInvoice({
      invoiceNumber: generateInvoiceNumber().replace('INV', 'QTE'),
      clientId: client.id,
      clientName: client.name,
      status: 'draft',
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      subtotal,
      taxRate: 0,
      taxAmount: 0,
      total: subtotal,
      notes: `QUOTE — ${frequency !== 'one-time' ? `${frequency} service` : 'One-time service'}\n${notes}`,
      items: items.map(i => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })),
    })

    // Move client to prospect
    saveClient({ id: client.id, status: 'prospect' })

    // Build quote message
    const message = buildQuoteMessage(client, items, subtotal, frequency, notes)

    // Send via email or text
    if (channel === 'email' && client.email) {
      try {
        await fetch('/api/gmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send',
            to: client.email,
            subject: `Cleaning Quote — ${client.name} — The Maine Cleaning Co.`,
            body: message,
          }),
        })
      } catch {}
    }

    if (channel === 'text' && client.phone) {
      try {
        await fetch('/api/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send',
            to: client.phone,
            body: `Hi ${client.name.split(' ')[0]}! Here's your cleaning quote from The Maine Cleaning Co.:\n\n${items.map(i => `${i.description}: $${i.total}`).join('\n')}\n\nTotal: $${subtotal}\n${frequency !== 'one-time' ? `Frequency: ${frequency}` : ''}\n\nReply YES to book or call us at (207) 572-0502!`,
          }),
        })
      } catch {}
    }

    setSending(false)
    setSent(true)

    if (onSend) onSend(quote)
    if (onSave) onSave()
  }

  async function handleAccept() {
    // Convert quote to job + schedule on Google Calendar
    for (const item of items) {
      const job = saveJob({
        clientId: client.id,
        clientName: client.name,
        title: item.description,
        date: new Date().toISOString().split('T')[0],
        status: 'scheduled',
        price: item.unitPrice,
        priceType: item.priceType || 'flat',
        isRecurring: frequency !== 'one-time',
        recurrenceRule: frequency === 'one-time' ? null : frequency,
        recurrenceDay: preferredDay,
        notes: notes,
      })

      // Create Google Calendar event
      try {
        const startHour = '09:00'
        const endHour = '12:00'
        const today = new Date().toISOString().split('T')[0]

        await fetch('/api/calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            summary: `${item.description} — ${client.name}`,
            description: `Client: ${client.name}\nAddress: ${client.address || ''}\nPhone: ${client.phone || ''}\nPrice: $${item.unitPrice}\n${notes}`,
            startDateTime: `${today}T${startHour}:00`,
            endDateTime: `${today}T${endHour}:00`,
            location: client.address || '',
          }),
        })
      } catch {}
    }

    saveClient({ id: client.id, status: 'active' })
    if (onSave) onSave()
  }

  if (sent) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center space-y-4">
        <p className="text-lg text-green-400 font-semibold">Quote Sent!</p>
        <p className="text-sm text-gray-400">Client moved to "Quoted" stage.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={handleAccept}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium text-white">
            Mark Accepted → Schedule Jobs
          </button>
          <button onClick={() => { setSent(false); setItems([]) }}
            className="px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300">New Quote</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Service templates */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Add Services</p>
        <div className="flex flex-wrap gap-2">
          {SERVICE_TEMPLATES.map(t => (
            <button key={t.name} onClick={() => addTemplate(t)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors">
              {t.name} <span className="text-gray-500">${t.price}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Line items */}
      {items.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)}
                className="col-span-5 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white" />
              <input type="number" min="1" step="1" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)}
                className="col-span-2 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white text-right" />
              <input type="number" min="0" step="5" value={item.unitPrice} onChange={e => updateItem(i, 'unitPrice', e.target.value)}
                className="col-span-2 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white text-right" />
              <span className="col-span-2 text-sm text-gray-300 text-right font-mono">${(parseFloat(item.total) || 0).toFixed(0)}</span>
              <button onClick={() => removeItem(i)} className="text-gray-600 hover:text-red-400">&times;</button>
            </div>
          ))}
          <div className="flex justify-between border-t border-gray-800 pt-3">
            <span className="text-sm text-gray-400">Total</span>
            <span className="text-lg font-bold text-white">${subtotal.toFixed(0)}</span>
          </div>
        </div>
      )}

      {/* Frequency */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Frequency</label>
          <select value={frequency} onChange={e => setFrequency(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
            <option value="one-time">One-time</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        {frequency !== 'one-time' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Preferred Day</label>
            <select value={preferredDay} onChange={e => setPreferredDay(Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
              {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Notes */}
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
        placeholder="Special instructions, access codes, notes for the quote..."
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500" />

      {/* Send */}
      {items.length > 0 && (
        <div className="flex gap-3">
          {client.email && (
            <button onClick={() => handleSend('email')} disabled={sending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
              {sending ? 'Sending...' : `Email Quote to ${client.email}`}
            </button>
          )}
          {client.phone && (
            <button onClick={() => handleSend('text')} disabled={sending}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
              {sending ? 'Sending...' : `Text Quote to ${client.phone}`}
            </button>
          )}
          <button onClick={() => handleSend('none')} disabled={sending}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300">
            Save Quote Only
          </button>
        </div>
      )}
    </div>
  )
}

function buildQuoteMessage(client, items, total, frequency, notes) {
  const firstName = client.name.split(' ')[0]
  let msg = `Hi ${firstName},\n\n`
  msg += `Thank you for your interest in The Maine Cleaning Co.! Here's your customized cleaning quote:\n\n`
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`
  for (const item of items) {
    msg += `${item.description}: $${parseFloat(item.total).toFixed(2)}\n`
  }
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`
  msg += `TOTAL: $${total.toFixed(2)}`
  if (frequency !== 'one-time') msg += ` (${frequency})`
  msg += `\n\n`
  if (notes) msg += `Notes: ${notes}\n\n`
  msg += `To accept this quote, simply reply to this email or call us at (207) 572-0502.\n\n`
  msg += `We look forward to working with you!\n\n`
  msg += `Best,\nThe Maine Cleaning & Property Management Co.\n`
  msg += `info@maine-clean.co | (207) 572-0502\n`
  msg += `www.maine-clean.co`
  return msg
}
