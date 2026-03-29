import { useState, useEffect } from 'react'
import { getClients } from '../lib/store'

// Rental calendar config
const RENTAL_CAL_KEY = 'workflowhq_rental_calendars'
function getRentalCalendars() {
  try { return JSON.parse(localStorage.getItem(RENTAL_CAL_KEY)) || [] } catch { return [] }
}
function saveRentalCalendars(cals) {
  localStorage.setItem(RENTAL_CAL_KEY, JSON.stringify(cals))
}

export default function Schedule() {
  const [calView, setCalView] = useState('WEEK') // WEEK, MONTH, AGENDA
  const [calendarIds, setCalendarIds] = useState([])
  const [allCalendars, setAllCalendars] = useState([])
  const [selectedCals, setSelectedCals] = useState([])
  const [turnovers, setTurnovers] = useState([])
  const [rentalCals, setRentalCals] = useState(getRentalCalendars())
  const [showSettings, setShowSettings] = useState(false)
  const [showTurnovers, setShowTurnovers] = useState(true)
  const [newRental, setNewRental] = useState({ calendarId: '', name: '', checkoutTime: '10:00', cleaningTime: '11:00' })
  const [creatingCleaning, setCreatingCleaning] = useState(null)
  const [error, setError] = useState(null)
  const [calendarConnected, setCalendarConnected] = useState(false)

  useEffect(() => {
    loadCalendars()
    loadTurnovers()
  }, [])

  async function loadCalendars() {
    try {
      const res = await fetch('/api/calendar?action=calendars')
      if (res.ok) {
        const data = await res.json()
        const cals = data.calendars || []
        setAllCalendars(cals)
        setCalendarConnected(true)
        // Default: show primary + any non-import calendars
        const defaultIds = cals
          .filter(c => c.primary || c.accessRole === 'owner')
          .map(c => c.id)
        setSelectedCals(defaultIds)
        setCalendarIds(cals.map(c => c.id))
      }
    } catch {
      setCalendarConnected(false)
    }
  }

  async function loadTurnovers() {
    if (rentalCals.length === 0) return
    try {
      const calParam = rentalCals.map(c => `${c.calendarId}|${c.name}`).join(',')
      const now = new Date()
      const future = new Date(now.getTime() + 60 * 86400000)
      const res = await fetch(`/api/calendar?action=turnovers&calendars=${encodeURIComponent(calParam)}&timeMin=${now.toISOString()}&timeMax=${future.toISOString()}`)
      if (res.ok) {
        const data = await res.json()
        setTurnovers(data.turnovers || [])
      }
    } catch {}
  }

  function addRentalCalendar(e) {
    e.preventDefault()
    if (!newRental.calendarId || !newRental.name) return
    const updated = [...rentalCals, { ...newRental }]
    saveRentalCalendars(updated)
    setRentalCals(updated)
    setNewRental({ calendarId: '', name: '', checkoutTime: '10:00', cleaningTime: '11:00' })
    loadTurnovers()
  }

  function removeRentalCalendar(idx) {
    const updated = rentalCals.filter((_, i) => i !== idx)
    saveRentalCalendars(updated)
    setRentalCals(updated)
  }

  async function createCleaningEvent(turnover) {
    setCreatingCleaning(turnover.eventId)
    try {
      const cleanEnd = new Date(`${turnover.checkOut}T${turnover.cleaningTime}:00`)
      cleanEnd.setHours(cleanEnd.getHours() + 3)

      await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          summary: `🧹 Turnover: ${turnover.property}`,
          description: `Checkout: ${turnover.checkoutTime}\nGuest: ${turnover.guestName}\nProperty: ${turnover.property}\n${turnover.reservationUrl ? `Reservation: ${turnover.reservationUrl}` : ''}`,
          startDateTime: `${turnover.checkOut}T${turnover.cleaningTime}:00`,
          endDateTime: cleanEnd.toISOString().split('.')[0],
          location: turnover.property,
          colorId: '6',
        }),
      })
      loadTurnovers()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingCleaning(null)
    }
  }

  // Build Google Calendar embed URL
  function buildEmbedUrl() {
    const params = new URLSearchParams()
    params.set('mode', calView)
    params.set('showTitle', '0')
    params.set('showNav', '1')
    params.set('showDate', '1')
    params.set('showPrint', '0')
    params.set('showTabs', '0')
    params.set('showCalendars', '0')
    params.set('showTz', '0')
    params.set('height', '700')
    params.set('wkst', '2') // Week starts Monday
    params.set('bgcolor', '#0a0a0a')
    params.set('ctz', 'America/New_York')
    // Add selected calendars
    for (const id of selectedCals) {
      params.append('src', id)
    }
    return `https://calendar.google.com/calendar/embed?${params}`
  }

  return (
    <div className="p-6 max-w-full mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Schedule</h1>
          <p className="text-sm text-gray-500 mt-0.5">Google Calendar + Rental Turnovers</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {['WEEK', 'MONTH', 'AGENDA'].map(v => (
              <button key={v} onClick={() => setCalView(v)}
                className={`px-3 py-1.5 text-xs ${calView === v ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                {v === 'AGENDA' ? 'List' : v.charAt(0) + v.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          {/* Calendar filter */}
          <div className="relative group">
            <button className="px-3 py-1.5 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg text-xs text-gray-300">
              Calendars ({selectedCals.length})
            </button>
            <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-800 rounded-lg p-3 hidden group-hover:block z-20 w-72 shadow-xl">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Show/Hide Calendars</p>
              {allCalendars.map(cal => (
                <label key={cal.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer">
                  <input type="checkbox" checked={selectedCals.includes(cal.id)}
                    onChange={e => {
                      if (e.target.checked) setSelectedCals(prev => [...prev, cal.id])
                      else setSelectedCals(prev => prev.filter(id => id !== cal.id))
                    }}
                    className="rounded border-gray-600" />
                  <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: cal.backgroundColor || '#4285f4' }} />
                  <span className="text-xs text-gray-300 truncate">{cal.summaryOverride || cal.summary}</span>
                  {cal.primary && <span className="text-xs text-gray-600">(primary)</span>}
                </label>
              ))}
            </div>
          </div>

          {/* Turnovers toggle */}
          <button onClick={() => setShowTurnovers(!showTurnovers)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              showTurnovers ? 'bg-orange-600/20 border-orange-800/50 text-orange-400' : 'bg-gray-800 border-gray-700 text-gray-400'
            }`}>
            Turnovers {turnovers.length > 0 ? `(${turnovers.length})` : ''}
          </button>

          {/* Rental settings */}
          <button onClick={() => { setShowSettings(!showSettings); if (!showSettings) loadCalendars() }}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              showSettings ? 'bg-blue-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700'
            }`}>
            Rental Setup
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>}

      {/* Rental settings panel */}
      {showSettings && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Rental Property Calendars</h2>
          <p className="text-xs text-gray-500">Subscribe to Airbnb/VRBO iCal links in Google Calendar first, then add them here to auto-detect turnovers.</p>

          {rentalCals.length > 0 && (
            <div className="space-y-2">
              {rentalCals.map((cal, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm text-white">{cal.name}</span>
                    <span className="text-xs text-gray-500 ml-2">Checkout {cal.checkoutTime} / Clean {cal.cleaningTime}</span>
                  </div>
                  <button onClick={() => removeRentalCalendar(i)} className="text-xs text-gray-500 hover:text-red-400">Remove</button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={addRentalCalendar} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Calendar</label>
              <select value={newRental.calendarId} onChange={e => {
                const cal = allCalendars.find(c => c.id === e.target.value)
                setNewRental({ ...newRental, calendarId: e.target.value, name: cal?.summaryOverride || cal?.summary || '' })
              }} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                <option value="">Select calendar...</option>
                {allCalendars.map(c => <option key={c.id} value={c.id}>{c.summaryOverride || c.summary}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Property Name</label>
              <input value={newRental.name} onChange={e => setNewRental({ ...newRental, name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Checkout / Clean</label>
              <div className="flex gap-1">
                <input type="time" value={newRental.checkoutTime} onChange={e => setNewRental({ ...newRental, checkoutTime: e.target.value })}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white" />
                <input type="time" value={newRental.cleaningTime} onChange={e => setNewRental({ ...newRental, cleaningTime: e.target.value })}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white" />
              </div>
            </div>
            <button type="submit" disabled={!newRental.calendarId}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">Add</button>
          </form>
        </div>
      )}

      {/* Turnovers alert */}
      {showTurnovers && turnovers.length > 0 && (
        <div className="bg-orange-900/10 border border-orange-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-orange-400 mb-3">Upcoming Turnovers</h3>
          <div className="space-y-2">
            {turnovers.map(t => (
              <div key={`${t.eventId}-${t.checkOut}`} className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm text-white font-medium">{t.property}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(t.checkOut).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} &middot;
                      Checkout {t.checkoutTime} &middot; {t.guestName}
                    </p>
                  </div>
                </div>
                <button onClick={() => createCleaningEvent(t)} disabled={creatingCleaning === t.eventId}
                  className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium shrink-0">
                  {creatingCleaning === t.eventId ? 'Creating...' : `🧹 Schedule @ ${t.cleaningTime}`}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Google Calendar embed */}
      {calendarConnected ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <iframe
            src={buildEmbedUrl()}
            style={{ border: 0, width: '100%', height: '700px' }}
            title="Google Calendar"
          />
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center space-y-4">
          <p className="text-gray-500">Google Calendar not connected.</p>
          <p className="text-xs text-gray-600">Add Gmail OAuth credentials to Vercel env vars (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN) to enable calendar integration.</p>
          <a href="/#/settings" className="text-sm text-blue-400 hover:text-blue-300">Go to Settings</a>
        </div>
      )}

      {/* Direct link to Google Calendar */}
      {calendarConnected && (
        <div className="flex items-center justify-between">
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-gray-500"><span className="w-2.5 h-2.5 rounded bg-orange-600" /> Turnover cleaning</span>
            <span className="flex items-center gap-1.5 text-gray-500"><span className="w-2.5 h-2.5 rounded bg-blue-600" /> Calendar event</span>
          </div>
          <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Open in Google Calendar &rarr;
          </a>
        </div>
      )}
    </div>
  )
}
