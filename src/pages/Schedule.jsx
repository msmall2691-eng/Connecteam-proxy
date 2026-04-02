import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey } from '../lib/api'

// Rental calendar config (localStorage)
const RENTAL_CAL_KEY = 'workflowhq_rental_calendars'
function getRentalCalendars() {
  try { return JSON.parse(localStorage.getItem(RENTAL_CAL_KEY)) || [] } catch { return [] }
}
function saveRentalCalendars(cals) {
  localStorage.setItem(RENTAL_CAL_KEY, JSON.stringify(cals))
}

export default function Schedule() {
  const [calView, setCalView] = useState('MONTH')
  const [allCalendars, setAllCalendars] = useState([])
  const [selectedCals, setSelectedCals] = useState([])
  const [turnovers, setTurnovers] = useState([])
  const [scannedTurnovers, setScannedTurnovers] = useState([])
  const [rentalCals, setRentalCals] = useState(getRentalCalendars())
  const [showSettings, setShowSettings] = useState(false)
  const [showTurnovers, setShowTurnovers] = useState(true)
  const [newRental, setNewRental] = useState({ calendarId: '', name: '', checkoutTime: '10:00', cleaningTime: '11:00' })
  const [creatingCleaning, setCreatingCleaning] = useState(null)
  const [error, setError] = useState(null)
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [showCalendarFilter, setShowCalendarFilter] = useState(false)
  const [showNewEvent, setShowNewEvent] = useState(false)
  const [newEvent, setNewEvent] = useState({ title: '', date: '', startTime: '09:00', endTime: '12:00', location: '', description: '', clientEmail: '' })
  const [creatingEvent, setCreatingEvent] = useState(false)

  // New state for improvements
  const [toast, setToast] = useState(null) // { type: 'success'|'error'|'info', message, details }
  const [scanning, setScanning] = useState(false)
  const [connecteamShifts, setConnecteamShifts] = useState([])
  const [showShifts, setShowShifts] = useState(false)
  const [loadingShifts, setLoadingShifts] = useState(false)
  const [pushingToConnecteam, setPushingToConnecteam] = useState(null)

  // Auto-dismiss toast after 6s
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 6000)
      return () => clearTimeout(t)
    }
  }, [toast])

  useEffect(() => {
    loadCalendars()
    loadTurnovers()
  }, [])

  async function loadCalendars() {
    try {
      const res = await fetch('/api/google?action=calendars')
      if (res.ok) {
        const data = await res.json()
        const cals = data.calendars || []
        setAllCalendars(cals)
        setCalendarConnected(true)
        const defaultIds = cals
          .filter(c => c.primary || c.accessRole === 'owner')
          .map(c => c.id)
        setSelectedCals(defaultIds)
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
      const res = await fetch(`/api/google?action=turnovers&calendars=${encodeURIComponent(calParam)}&timeMin=${now.toISOString()}&timeMax=${future.toISOString()}`)
      if (res.ok) {
        const data = await res.json()
        setTurnovers(data.turnovers || [])
      }
    } catch {}
  }

  // Merged list: Google Calendar turnovers + auto-scanned Supabase turnovers
  const allTurnovers = useCallback(() => {
    const merged = [...turnovers]
    // Add scanned turnovers that aren't already in the Google Calendar list
    for (const st of scannedTurnovers) {
      const isDuplicate = turnovers.some(t =>
        t.property === st.propertyName && t.checkOut === st.checkoutDate
      )
      if (!isDuplicate && !st.alreadyScheduled) {
        merged.push({
          property: st.propertyName,
          eventId: `scan-${st.propertyId}-${st.checkoutDate}`,
          guestName: st.guest,
          checkIn: st.checkIn,
          checkOut: st.checkoutDate,
          checkoutTime: st.checkoutTime,
          cleaningTime: st.cleaningTime,
          address: st.address,
          clientName: st.clientName,
          fromScan: true,
        })
      }
    }
    merged.sort((a, b) => (a.checkOut || '').localeCompare(b.checkOut || ''))
    return merged
  }, [turnovers, scannedTurnovers])

  async function handleAutoScan() {
    setScanning(true)
    setError(null)
    try {
      const res = await fetch('/api/auto-turnovers?action=scan&days=30')
      if (res.ok) {
        const data = await res.json()
        const propCount = data.properties || 0
        const createdCount = data.created || 0
        const totalCount = data.totalTurnovers || 0
        const alreadyCount = data.alreadyScheduled || 0

        // Store scanned turnovers for display
        if (data.turnovers?.length) {
          setScannedTurnovers(data.turnovers)
        }

        if (propCount === 0) {
          setToast({
            type: 'info',
            message: 'No rental properties found',
            details: 'Add rental properties with iCal URLs in client Properties tab first.',
          })
        } else if (createdCount > 0) {
          setToast({
            type: 'success',
            message: `Created ${createdCount} new turnover cleaning${createdCount !== 1 ? 's' : ''}`,
            details: `Scanned ${propCount} properties. ${totalCount} total turnovers found, ${alreadyCount} already scheduled.`,
          })
        } else if (totalCount > 0) {
          setToast({
            type: 'info',
            message: 'All turnovers already scheduled',
            details: `${propCount} properties scanned. ${alreadyCount} turnovers already have jobs.`,
          })
        } else {
          setToast({
            type: 'info',
            message: 'No upcoming turnovers found',
            details: `Scanned ${propCount} properties with iCal feeds. No checkouts in the next 30 days.`,
          })
        }

        // Refresh Google Calendar turnovers too
        loadTurnovers()
      } else {
        const err = await res.json().catch(() => ({}))
        setToast({ type: 'error', message: 'Scan failed', details: err.error || 'Unknown error' })
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Scan failed', details: err.message })
    } finally {
      setScanning(false)
    }
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

      await fetch('/api/google?action=calendar-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `🧹 Turnover: ${turnover.property}`,
          description: `Checkout: ${turnover.checkoutTime}\nGuest: ${turnover.guestName}\nProperty: ${turnover.property}\n${turnover.reservationUrl ? `Reservation: ${turnover.reservationUrl}` : ''}`,
          startDateTime: `${turnover.checkOut}T${turnover.cleaningTime}:00`,
          endDateTime: cleanEnd.toISOString().split('.')[0],
          location: turnover.address || turnover.property,
          colorId: '6',
        }),
      })
      setToast({ type: 'success', message: `Scheduled turnover for ${turnover.property}`, details: `Google Calendar event created for ${turnover.checkOut}` })
      loadTurnovers()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingCleaning(null)
    }
  }

  async function pushTurnoverToConnecteam(turnover) {
    const apiKey = getApiKey()
    if (!apiKey) {
      setToast({ type: 'error', message: 'Connecteam API key not set', details: 'Go to Settings to add your Connecteam API key.' })
      return
    }

    setPushingToConnecteam(turnover.eventId)
    try {
      const startDateTime = `${turnover.checkOut}T${turnover.cleaningTime}:00`
      const startUnix = Math.floor(new Date(startDateTime + '-04:00').getTime() / 1000)
      const endUnix = startUnix + 3 * 3600 // 3 hours

      const res = await fetch(`/api/connecteam?action=shift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify({
          title: `Turnover Clean — ${turnover.property}`,
          startTime: startUnix,
          endTime: endUnix,
          description: [
            `Property: ${turnover.property}`,
            turnover.address ? `Address: ${turnover.address}` : '',
            `Guest: ${turnover.guestName}`,
            `Checkout: ${turnover.checkoutTime}`,
            turnover.clientName ? `Client: ${turnover.clientName}` : '',
          ].filter(Boolean).join('\n'),
          location: turnover.address || '',
        }),
      })

      if (res.ok) {
        setToast({ type: 'success', message: `Pushed to Connecteam`, details: `Shift created for ${turnover.property} on ${turnover.checkOut}` })
      } else {
        const err = await res.json().catch(() => ({}))
        setToast({ type: 'error', message: 'Failed to push to Connecteam', details: err.error || 'Unknown error' })
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to push to Connecteam', details: err.message })
    } finally {
      setPushingToConnecteam(null)
    }
  }

  async function loadConnecteamShifts() {
    const apiKey = getApiKey()
    if (!apiKey) {
      setToast({ type: 'error', message: 'Connecteam API key not set', details: 'Go to Settings to add your Connecteam API key.' })
      return
    }

    setLoadingShifts(true)
    try {
      const now = new Date()
      const startDate = now.toISOString().split('T')[0]
      const future = new Date(now.getTime() + 14 * 86400000)
      const endDate = future.toISOString().split('T')[0]
      const startTime = Math.floor(now.getTime() / 1000)
      const endTime = Math.floor(future.getTime() / 1000)

      const res = await fetch(`/api/connecteam?path=${encodeURIComponent(`scheduler/v1/schedulers/15248539/shifts?startTime=${startTime}&endTime=${endTime}`)}`, {
        headers: { 'X-API-KEY': apiKey },
      })

      if (res.ok) {
        const data = await res.json()
        const shifts = (data.data?.objects || []).map(s => ({
          id: s.id,
          title: s.title || 'Untitled Shift',
          start: new Date(s.startTime * 1000),
          end: new Date(s.endTime * 1000),
          assignees: s.assignedUserIds?.length || 0,
          status: s.status,
          location: s.location || '',
        }))
        shifts.sort((a, b) => a.start - b.start)
        setConnecteamShifts(shifts)
        setShowShifts(true)
      } else {
        setToast({ type: 'error', message: 'Failed to load shifts', details: 'Check your Connecteam API key.' })
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load shifts', details: err.message })
    } finally {
      setLoadingShifts(false)
    }
  }

  async function createCalendarEvent(e) {
    e.preventDefault()
    if (!newEvent.title || !newEvent.date) return
    setCreatingEvent(true)
    try {
      const res = await fetch('/api/google?action=calendar-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: newEvent.title,
          description: newEvent.description + (newEvent.clientEmail ? `\nClient: ${newEvent.clientEmail}` : ''),
          startDateTime: `${newEvent.date}T${newEvent.startTime}:00`,
          endDateTime: `${newEvent.date}T${newEvent.endTime}:00`,
          location: newEvent.location,
        }),
      })
      if (res.ok) {
        setNewEvent({ title: '', date: '', startTime: '09:00', endTime: '12:00', location: '', description: '', clientEmail: '' })
        setShowNewEvent(false)
        setToast({ type: 'success', message: 'Event created', details: 'Added to Google Calendar.' })
        setCalendarConnected(false)
        setTimeout(() => setCalendarConnected(true), 100)
      } else {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Failed to create event')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingEvent(false)
    }
  }

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
    params.set('wkst', '2')
    params.set('bgcolor', '#0a0a0a')
    params.set('ctz', 'America/New_York')
    for (const id of selectedCals) {
      params.append('src', id)
    }
    return `https://calendar.google.com/calendar/embed?${params}`
  }

  const mergedTurnovers = allTurnovers()

  return (
    <div className="p-6 max-w-full mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Schedule</h1>
          <p className="text-sm text-gray-500 mt-0.5">Google Calendar + Rental Turnovers</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <div className="relative">
            <button onClick={() => setShowCalendarFilter(!showCalendarFilter)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg text-xs text-gray-300">
              Calendars ({selectedCals.length})
            </button>
            {showCalendarFilter && (
              <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-800 rounded-lg p-3 z-20 w-72 shadow-xl">
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
            )}
          </div>

          {/* Turnovers toggle */}
          <button onClick={() => setShowTurnovers(!showTurnovers)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              showTurnovers ? 'bg-orange-600/20 border-orange-800/50 text-orange-400' : 'bg-gray-800 border-gray-700 text-gray-400'
            }`}>
            Turnovers {mergedTurnovers.length > 0 ? `(${mergedTurnovers.length})` : ''}
          </button>

          {/* Connecteam shifts */}
          <button onClick={() => { if (!showShifts) loadConnecteamShifts(); else setShowShifts(false) }}
            disabled={loadingShifts}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              showShifts ? 'bg-purple-600/20 border-purple-800/50 text-purple-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
            }`}>
            {loadingShifts ? 'Loading...' : `Shifts ${connecteamShifts.length > 0 ? `(${connecteamShifts.length})` : ''}`}
          </button>

          {/* New event */}
          <button onClick={() => setShowNewEvent(!showNewEvent)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showNewEvent ? 'bg-green-600 text-white' : 'bg-green-600 hover:bg-green-500 text-white'
            }`}>
            + Event
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

      {/* Toast notification */}
      {toast && (
        <div className={`p-3 rounded-lg text-sm flex items-start justify-between gap-3 ${
          toast.type === 'success' ? 'bg-green-900/30 border border-green-800 text-green-300' :
          toast.type === 'error' ? 'bg-red-900/30 border border-red-800 text-red-300' :
          'bg-blue-900/30 border border-blue-800 text-blue-300'
        }`}>
          <div>
            <p className="font-medium">{toast.message}</p>
            {toast.details && <p className="text-xs mt-0.5 opacity-80">{toast.details}</p>}
          </div>
          <button onClick={() => setToast(null)} className="text-xs opacity-60 hover:opacity-100 shrink-0">Close</button>
        </div>
      )}

      {error && <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>}

      {/* New calendar event form */}
      {showNewEvent && (
        <form onSubmit={createCalendarEvent} className="bg-gray-900 border border-green-800/30 rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-white">New Calendar Event</h3>
            <button type="button" onClick={() => setShowNewEvent(false)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Event Title *</label>
              <input required value={newEvent.title} onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
                placeholder="e.g. Weekly Cleaning — John Smith"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date *</label>
              <input type="date" required value={newEvent.date} onChange={e => setNewEvent({ ...newEvent, date: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start</label>
                <input type="time" value={newEvent.startTime} onChange={e => setNewEvent({ ...newEvent, startTime: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End</label>
                <input type="time" value={newEvent.endTime} onChange={e => setNewEvent({ ...newEvent, endTime: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Location</label>
              <input value={newEvent.location} onChange={e => setNewEvent({ ...newEvent, location: e.target.value })}
                placeholder="Address"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Client Email (optional)</label>
              <input type="email" value={newEvent.clientEmail} onChange={e => setNewEvent({ ...newEvent, clientEmail: e.target.value })}
                placeholder="client@email.com"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea rows={2} value={newEvent.description} onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
                placeholder="Details, instructions..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 resize-none" />
            </div>
          </div>
          <button type="submit" disabled={creatingEvent}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
            {creatingEvent ? 'Creating...' : 'Add to Google Calendar'}
          </button>
        </form>
      )}

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

      {/* Turnovers section */}
      {showTurnovers && (
        <div className="bg-orange-900/10 border border-orange-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-orange-400">Upcoming Turnovers</h3>
            <button onClick={handleAutoScan} disabled={scanning}
              className="px-3 py-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded text-xs text-white flex items-center gap-1.5">
              {scanning && (
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {scanning ? 'Scanning...' : 'Auto-Scan All Properties'}
            </button>
          </div>

          {mergedTurnovers.length === 0 && (
            <div className="text-center py-4">
              <p className="text-xs text-gray-500">No upcoming turnovers detected.</p>
              <p className="text-xs text-gray-600 mt-1">
                Add rental properties with iCal URLs in Settings or client Properties tab,
                then click <span className="text-orange-400">Auto-Scan</span> to detect checkouts.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {mergedTurnovers.map(t => (
              <div key={`${t.eventId}-${t.checkOut}`} className="flex flex-col sm:flex-row sm:items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2.5 gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white font-medium truncate">{t.property}</p>
                      {t.fromScan && <span className="text-[10px] px-1.5 py-0.5 bg-orange-600/20 text-orange-400 rounded">from scan</span>}
                    </div>
                    <p className="text-xs text-gray-500">
                      {new Date(t.checkOut).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} &middot;
                      Checkout {t.checkoutTime} &middot; {t.guestName}
                      {t.clientName && <span className="text-gray-600"> &middot; {t.clientName}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => createCleaningEvent(t)} disabled={creatingCleaning === t.eventId}
                    className="px-2.5 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium"
                    title="Add to Google Calendar">
                    {creatingCleaning === t.eventId ? '...' : `Cal @ ${t.cleaningTime}`}
                  </button>
                  <button onClick={() => pushTurnoverToConnecteam(t)} disabled={pushingToConnecteam === t.eventId}
                    className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium"
                    title="Push to Connecteam Scheduler">
                    {pushingToConnecteam === t.eventId ? '...' : 'Connecteam'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connecteam shifts panel */}
      {showShifts && connecteamShifts.length > 0 && (
        <div className="bg-purple-900/10 border border-purple-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-purple-400">Connecteam Shifts (Next 2 Weeks)</h3>
            <button onClick={loadConnecteamShifts} disabled={loadingShifts}
              className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-50">
              {loadingShifts ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="space-y-1.5">
            {connecteamShifts.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm text-white">{s.title}</p>
                  <p className="text-xs text-gray-500">
                    {s.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} &middot;
                    {s.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – {s.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    {s.location && <span className="text-gray-600"> &middot; {s.location}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {s.assignees > 0 && (
                    <span className="text-xs text-gray-500">{s.assignees} assigned</span>
                  )}
                  {s.assignees === 0 && (
                    <span className="text-xs text-yellow-500">Unassigned</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showShifts && connecteamShifts.length === 0 && !loadingShifts && (
        <div className="bg-purple-900/10 border border-purple-800/50 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">No Connecteam shifts found in the next 2 weeks.</p>
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
          <Link to="/settings" className="text-sm text-blue-400 hover:text-blue-300">Go to Settings</Link>
        </div>
      )}

      {/* Legend + links */}
      {calendarConnected && (
        <div className="flex items-center justify-between">
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-gray-500"><span className="w-2.5 h-2.5 rounded bg-orange-600" /> Turnover cleaning</span>
            <span className="flex items-center gap-1.5 text-gray-500"><span className="w-2.5 h-2.5 rounded bg-purple-600" /> Connecteam shift</span>
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
