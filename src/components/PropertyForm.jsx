import { useState } from 'react'

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
    rentalPlatform: property?.rentalPlatform || '',
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.addressLine1.trim()) return
    onSave({ ...form, ...(property?.id ? { id: property.id } : {}) })
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Checkout Time</label>
              <input type="time" value={form.checkoutTime} onChange={e => setForm({ ...form, checkoutTime: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cleaning Time</label>
              <input type="time" value={form.cleaningTime} onChange={e => setForm({ ...form, cleaningTime: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
