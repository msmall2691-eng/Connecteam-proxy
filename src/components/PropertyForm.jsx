import { useState, useCallback } from 'react'

const PROPERTY_TYPES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'rental', label: 'Rental (Airbnb/VRBO)' },
  { value: 'marina', label: 'Marina' },
]

export default function PropertyForm({ property, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: property?.name || '',
    addressLine1: property?.addressLine1 || '',
    addressLine2: property?.addressLine2 || '',
    city: property?.city || '',
    state: property?.state || 'ME',
    zip: property?.zip || '',
    type: property?.type || 'residential',
    sqft: property?.sqft || '',
    bedrooms: property?.bedrooms || '',
    bathrooms: property?.bathrooms || '',
    petHair: property?.petHair || 'none',
    condition: property?.condition || 'maintenance',
    accessNotes: property?.accessNotes || '',
    isPrimary: property?.isPrimary || false,
    icalUrl: property?.icalUrl || '',
    googleCalendarId: property?.googleCalendarId || '',
    checkoutTime: property?.checkoutTime || '10:00',
    cleaningTime: property?.cleaningTime || '11:00',
    cleaningDuration: property?.cleaningDuration || '3',
    rentalPlatform: property?.rentalPlatform || '',
  })

  const [enriching, setEnriching] = useState(false)
  const [enrichResult, setEnrichResult] = useState(null)

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.addressLine1.trim()) return
    onSave({ ...form, ...(property?.id ? { id: property.id } : {}) })
  }

  async function handleEnrich() {
    if (!form.addressLine1.trim()) return
    setEnriching(true)
    setEnrichResult(null)
    try {
      const res = await fetch('/api/enrich-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: [form.addressLine1, form.city, form.state, form.zip].filter(Boolean).join(', '),
          name: form.name,
          clientType: form.type,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.enriched) {
          // Auto-fill empty fields only (don't overwrite user input)
          setForm(prev => ({
            ...prev,
            sqft: prev.sqft || (data.sqft ? String(data.sqft) : ''),
            bedrooms: prev.bedrooms || (data.bedrooms ? String(data.bedrooms) : ''),
            bathrooms: prev.bathrooms || (data.bathrooms ? String(data.bathrooms) : ''),
            type: data.propertyType || prev.type,
            parkingInstructions: prev.parkingInstructions || data.parkingInstructions || '',
            cleaningNotes: prev.cleaningNotes || data.notes || '',
          }))
          setEnrichResult({ type: 'success', message: `Estimated: ${data.sqft || '?'} sqft, ${data.bedrooms || '?'}bd/${data.bathrooms || '?'}ba (${data.confidence} confidence)` })
        } else {
          setEnrichResult({ type: 'info', message: 'Could not estimate — fill in manually' })
        }
      }
    } catch (e) {
      setEnrichResult({ type: 'error', message: e.message })
    } finally {
      setEnriching(false)
    }
  }

  const isRental = form.type === 'rental'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Property Name</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Main Home, Beach Rental"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {PROPERTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Address *</label>
        <input required value={form.addressLine1} onChange={e => setForm({ ...form, addressLine1: e.target.value })}
          placeholder="123 Main Street"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City"
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="State"
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={form.zip} onChange={e => setForm({ ...form, zip: e.target.value })} placeholder="ZIP"
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* AI Enrichment */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={handleEnrich} disabled={enriching || !form.addressLine1.trim()}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium">
          {enriching ? 'Estimating...' : 'Auto-fill with AI'}
        </button>
        {enrichResult && (
          <span className={`text-xs ${enrichResult.type === 'success' ? 'text-green-400' : enrichResult.type === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
            {enrichResult.message}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Sq Ft</label>
          <input type="number" value={form.sqft} onChange={e => setForm({ ...form, sqft: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Bedrooms</label>
          <select value={form.bedrooms} onChange={e => setForm({ ...form, bedrooms: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">-</option>
            {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Bathrooms</label>
          <select value={form.bathrooms} onChange={e => setForm({ ...form, bathrooms: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">-</option>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Pet Hair</label>
          <select value={form.petHair} onChange={e => setForm({ ...form, petHair: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="none">None</option><option value="some">Some</option><option value="heavy">Heavy</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Access Notes</label>
        <textarea rows={2} value={form.accessNotes} onChange={e => setForm({ ...form, accessNotes: e.target.value })}
          placeholder="Gate code, lockbox, key location..."
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Rental-specific fields */}
      {isRental && (
        <div className="bg-orange-900/10 border border-orange-800/30 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-medium text-orange-400">Rental Property Settings</h4>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Google Calendar ID (recommended)</label>
            <input value={form.googleCalendarId} onChange={e => setForm({ ...form, googleCalendarId: e.target.value })}
              placeholder="abc123@import.calendar.google.com"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-600 mt-1">Import your Airbnb/VRBO iCal into Google Calendar, then paste the Calendar ID here. Google Calendar → Settings → Integrate calendar → Calendar ID</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">iCal URL (fallback)</label>
              <input value={form.icalUrl} onChange={e => setForm({ ...form, icalUrl: e.target.value })}
                placeholder="https://www.airbnb.com/calendar/ical/..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Platform</label>
              <select value={form.rentalPlatform} onChange={e => setForm({ ...form, rentalPlatform: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select...</option><option value="airbnb">Airbnb</option><option value="vrbo">VRBO</option><option value="both">Both</option><option value="direct">Direct booking</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Checkout Time</label>
              <input type="time" value={form.checkoutTime} onChange={e => setForm({ ...form, checkoutTime: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cleaning Start</label>
              <input type="time" value={form.cleaningTime} onChange={e => setForm({ ...form, cleaningTime: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duration (hrs)</label>
              <select value={form.cleaningDuration} onChange={e => setForm({ ...form, cleaningDuration: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="2">2 hours</option>
                <option value="3">3 hours</option>
                <option value="4">4 hours</option>
                <option value="5">5 hours</option>
                <option value="6">6 hours</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
        <input type="checkbox" checked={form.isPrimary} onChange={e => setForm({ ...form, isPrimary: e.target.checked })} className="rounded border-gray-600" />
        Primary property
      </label>

      <div className="flex gap-3">
        <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">
          {property?.id ? 'Save Changes' : 'Add Property'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300">Cancel</button>}
      </div>
    </form>
  )
}
