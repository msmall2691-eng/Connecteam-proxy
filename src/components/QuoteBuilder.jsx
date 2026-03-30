import { useState, useEffect } from 'react'
import { saveInvoice, generateInvoiceNumber, saveJob, saveClient } from '../lib/store'
import { calculateQuote } from '../lib/quoteEngine'

const SERVICE_TEMPLATES = [
  { name: 'Standard Cleaning', price: 150, unit: 'flat', desc: 'Regular residential cleaning' },
  { name: 'Deep Cleaning', price: 250, unit: 'flat', desc: 'Thorough deep clean, all rooms' },
  { name: 'Move-In/Move-Out', price: 300, unit: 'flat', desc: 'Full property move cleaning' },
  { name: 'Airbnb Turnover', price: 175, unit: 'flat', desc: 'Same-day rental turnover' },
  { name: 'Commercial Janitorial', price: 45, unit: 'hourly', desc: 'Office/commercial cleaning' },
  { name: 'Post-Construction', price: 400, unit: 'flat', desc: 'Post-construction cleanup' },
]

export default function QuoteBuilder({ client, onSave, onSend }) {
  const [mode, setMode] = useState('calculator') // 'calculator' or 'manual'
  const [items, setItems] = useState([])
  const [notes, setNotes] = useState(client.notes || '')
  const [frequency, setFrequency] = useState('one-time')
  const [preferredDay, setPreferredDay] = useState(1)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  // Calculator fields (matches website)
  const [sqft, setSqft] = useState(client.tags?.find(t => t.match(/\d+.*sqft/))?.match(/\d+/)?.[0] || '1500')
  const [serviceType, setServiceType] = useState('standard')
  const [bathrooms, setBathrooms] = useState('2')
  const [petHair, setPetHair] = useState('none')
  const [condition, setCondition] = useState('maintenance')
  const [quote, setQuote] = useState(null)

  // Auto-calculate when inputs change
  useEffect(() => {
    const q = calculateQuote({ sqft, serviceType, frequency, bathrooms, petHair, condition })
    setQuote(q)
  }, [sqft, serviceType, frequency, bathrooms, petHair, condition])

  function applyQuoteToItems() {
    if (!quote) return
    const label = quote.isDeep ? 'Deep Cleaning' : 'Standard Cleaning'
    setItems([{
      description: `${label} — ${sqft} sqft, ${bathrooms} bath${frequency !== 'one-time' ? `, ${frequency}` : ''}`,
      quantity: 1,
      unitPrice: quote.perClean,
      total: quote.perClean,
      priceType: 'flat',
    }])
    setMode('manual') // switch to items view to finalize
  }

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
    if (items.length === 0 && !quote) return
    setSending(true)

    // If still in calculator mode, apply quote first
    if (items.length === 0 && quote) {
      applyQuoteToItems()
    }

    const finalItems = items.length > 0 ? items : [{
      description: `${quote.isDeep ? 'Deep' : 'Standard'} Cleaning — ${sqft} sqft`,
      quantity: 1, unitPrice: quote.perClean, total: quote.perClean, priceType: 'flat',
    }]
    const finalTotal = finalItems.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)

    // Create quote as draft invoice
    saveInvoice({
      invoiceNumber: generateInvoiceNumber().replace('INV', 'QTE'),
      clientId: client.id, clientName: client.name,
      status: 'draft',
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      subtotal: finalTotal, taxRate: 0, taxAmount: 0, total: finalTotal,
      notes: `QUOTE — ${frequency !== 'one-time' ? `${frequency} service` : 'One-time service'}\n${notes}`,
      items: finalItems.map(i => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })),
    })

    saveClient({ id: client.id, status: 'prospect' })

    const message = buildQuoteMessage(client, finalItems, finalTotal, frequency, notes, quote)

    if (channel === 'email' && client.email) {
      try {
        await fetch('/api/gmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send', to: client.email, subject: `Cleaning Quote — ${client.name} — The Maine Cleaning Co.`, body: message }),
        })
      } catch {}
    }

    if (channel === 'text' && client.phone) {
      try {
        await fetch('/api/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send', to: client.phone,
            body: `Hi ${client.name.split(' ')[0]}! Your cleaning quote from The Maine Cleaning Co.:\n\n${finalItems.map(i => `${i.description}: $${i.total}`).join('\n')}\n\nTotal: $${finalTotal}/clean${frequency !== 'one-time' ? ` (${frequency})` : ''}\n\nReply YES to book or call (207) 572-0502!`,
          }),
        })
      } catch {}
    }

    setSending(false)
    setSent(true)
    if (onSend) onSend()
    if (onSave) onSave()
  }

  async function handleAccept() {
    const finalItems = items.length > 0 ? items : [{
      description: `${quote?.isDeep ? 'Deep' : 'Standard'} Cleaning`, quantity: 1,
      unitPrice: quote?.perClean || subtotal, total: quote?.perClean || subtotal, priceType: 'flat',
    }]

    for (const item of finalItems) {
      saveJob({
        clientId: client.id, clientName: client.name, title: item.description,
        date: new Date().toISOString().split('T')[0], status: 'scheduled',
        price: item.unitPrice, priceType: item.priceType || 'flat',
        isRecurring: frequency !== 'one-time',
        recurrenceRule: frequency === 'one-time' ? null : frequency,
        recurrenceDay: preferredDay, notes,
      })

      try {
        await fetch('/api/calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            summary: `${item.description} — ${client.name}`,
            description: `Client: ${client.name}\nAddress: ${client.address || ''}\nPhone: ${client.phone || ''}\nPrice: $${item.unitPrice}\n${notes}`,
            startDateTime: `${new Date().toISOString().split('T')[0]}T09:00:00`,
            endDateTime: `${new Date().toISOString().split('T')[0]}T12:00:00`,
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
      <div className="bg-gray-800/50 rounded-xl p-6 text-center space-y-4">
        <p className="text-lg text-green-400 font-semibold">Quote Sent!</p>
        <p className="text-sm text-gray-400">Client moved to "Quoted" stage.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={handleAccept} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium text-white">
            Mark Accepted &rarr; Schedule Jobs
          </button>
          <button onClick={() => { setSent(false); setItems([]) }} className="px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300">New Quote</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5 w-fit">
        <button onClick={() => setMode('calculator')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${mode === 'calculator' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
          Instant Calculator
        </button>
        <button onClick={() => setMode('manual')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${mode === 'manual' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
          Manual Quote
        </button>
      </div>

      {mode === 'calculator' && (
        <>
          {/* Calculator form — matches website */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Square Footage</label>
              <input type="number" value={sqft} onChange={e => setSqft(e.target.value)} min="500" step="100"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Service Type</label>
              <select value={serviceType} onChange={e => setServiceType(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="standard">Standard Cleaning</option>
                <option value="deep">Deep Cleaning</option>
                <option value="move-in-out">Move-In/Move-Out</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bathrooms</label>
              <select value={bathrooms} onChange={e => setBathrooms(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Frequency</label>
              <select value={frequency} onChange={e => setFrequency(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="one-time">One-time (1.5x)</option>
                <option value="monthly">Monthly (1.15x)</option>
                <option value="biweekly">Bi-weekly (1x)</option>
                <option value="weekly">Weekly (0.85x)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Pet Hair</label>
              <select value={petHair} onChange={e => setPetHair(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="none">None</option>
                <option value="some">Some</option>
                <option value="heavy">Heavy</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Home Condition</label>
              <select value={condition} onChange={e => setCondition(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="maintenance">Well-maintained</option>
                <option value="moderate">Moderate</option>
                <option value="heavy">Needs attention</option>
              </select>
            </div>
          </div>

          {/* Quote result */}
          {quote && (
            <div className="bg-blue-900/20 border border-blue-800/50 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Instant Quote</h3>
                <span className="text-xs text-gray-500">Same formula as website</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-blue-400">${quote.estimateMin}</span>
                <span className="text-lg text-gray-500">–</span>
                <span className="text-3xl font-bold text-blue-400">${quote.estimateMax}</span>
                <span className="text-sm text-gray-500">/clean</span>
              </div>
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span>{quote.labor} labor units</span>
                <span>{quote.isDeep ? 'Deep clean' : 'Standard'}</span>
                <span>{quote.freqMultiplier}x freq</span>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={applyQuoteToItems} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">
                  Use This Price &rarr; Finalize Quote
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'manual' && (
        <>
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
            <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
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
              <div className="flex justify-between border-t border-gray-700 pt-3">
                <span className="text-sm text-gray-400">Total</span>
                <span className="text-lg font-bold text-white">${subtotal.toFixed(0)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Frequency + day */}
      {mode === 'manual' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Frequency</label>
            <select value={frequency} onChange={e => setFrequency(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
              <option value="one-time">One-time</option><option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option>
            </select>
          </div>
          {frequency !== 'one-time' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Preferred Day</label>
              <select value={preferredDay} onChange={e => setPreferredDay(Number(e.target.value))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
        placeholder="Special instructions, access codes, notes..."
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500" />

      {/* Send buttons */}
      {(items.length > 0 || (mode === 'calculator' && quote)) && (
        <div className="flex flex-wrap gap-3">
          {client.email && (
            <button onClick={() => handleSend('email')} disabled={sending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
              {sending ? 'Sending...' : `Email Quote`}
            </button>
          )}
          {client.phone && (
            <button onClick={() => handleSend('text')} disabled={sending}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
              {sending ? 'Sending...' : `Text Quote`}
            </button>
          )}
          <button onClick={() => handleSend('none')} disabled={sending}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300">
            Save Only
          </button>
        </div>
      )}
    </div>
  )
}

function buildQuoteMessage(client, items, total, frequency, notes, quote) {
  const firstName = client.name.split(' ')[0]
  let msg = `Hi ${firstName},\n\n`
  msg += `Thank you for your interest in The Maine Cleaning Co.! Here's your customized cleaning quote:\n\n`
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`
  for (const item of items) {
    msg += `${item.description}: $${parseFloat(item.total).toFixed(2)}\n`
  }
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`
  msg += `TOTAL: $${total.toFixed(2)}`
  if (frequency !== 'one-time') msg += ` per clean (${frequency})`
  msg += `\n\n`
  if (quote) msg += `Estimated range: $${quote.estimateMin} – $${quote.estimateMax}\n\n`
  if (notes) msg += `Notes: ${notes}\n\n`
  msg += `To accept this quote, simply reply to this email or call us at (207) 572-0502.\n\n`
  msg += `Best,\nThe Maine Cleaning & Property Management Co.\ninfo@maine-clean.co | (207) 572-0502\nwww.maine-clean.co`
  return msg
}
