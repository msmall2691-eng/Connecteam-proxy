import { useState, useEffect } from 'react'
import { getApiKey, fetchUsers, fetchShifts, fetchTimeActivities } from '../lib/api'
import { getJobs, getClients } from '../lib/store'

// Rental calendar config — stored in localStorage
const RENTAL_CAL_KEY = 'workflowhq_rental_calendars'
function getRentalCalendars() {
  try { return JSON.parse(localStorage.getItem(RENTAL_CAL_KEY)) || [] } catch { return [] }
}
function saveRentalCalendars(cals) {
  localStorage.setItem(RENTAL_CAL_KEY, JSON.stringify(cals))
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function Schedule() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [view, setView] = useState('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const [connecteamShifts, setConnecteamShifts] = useState([])
  const [calendarEvents, setCalendarEvents] = useState([])
  const [turnovers, setTurnovers] = useState([])
  const [localJobs, setLocalJobs] = useState([])
  const [users, setUsers] = useState({})
  const [clients, setClients] = useState({})
  const [rentalCals, setRentalCals] = useState(getRentalCalendars())
  const [showSettings, setShowSettings] = useState(false)
  const [allCalendars, setAllCalendars] = useState([])
  const [newRental, setNewRental] = useState({ calendarId: '', name: '', checkoutTime: '10:00', cleaningTime: '11:00' })
  const [creatingCleaning, setCreatingCleaning] = useState(null)

  const apiKey = getApiKey()

  // Week boundaries
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1 + weekOffset * 7)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })

  useEffect(() => { loadSchedule() }, [weekOffset])

  async function loadSchedule() {
    setLoading(true)
    setError(null)

    // Local data
    const cls = {}
    for (const c of getClients()) cls[c.id] = c
    setClients(cls)
    setLocalJobs(getJobs())

    const startStr = weekStart.toISOString().split('T')[0]
    const endStr = weekEnd.toISOString().split('T')[0]

    // Fetch Google Calendar events
    try {
      const res = await fetch(`/api/calendar?action=events&calendarId=primary&timeMin=${startStr}T00:00:00-04:00&timeMax=${endStr}T23:59:59-04:00`)
      if (res.ok) {
        const data = await res.json()
        setCalendarEvents(data.events || [])
      }
    } catch {}

    // Fetch turnovers from rental calendars
    if (rentalCals.length > 0) {
      try {
        const calParam = rentalCals.map(c => `${c.calendarId}|${c.name}`).join(',')
        const res = await fetch(`/api/calendar?action=turnovers&calendars=${encodeURIComponent(calParam)}&timeMin=${startStr}T00:00:00Z&timeMax=${new Date(weekEnd.getTime() + 86400000).toISOString()}`)
        if (res.ok) {
          const data = await res.json()
          setTurnovers(data.turnovers || [])
        }
      } catch {}
    }

    // Fetch Connecteam shifts
    if (apiKey) {
      try {
        const usrs = await fetchUsers()
        setUsers(usrs)
        const shifts = await fetchShifts(startStr, endStr)
        const shiftList = shifts.data?.objects || []
        const processed = shiftList.map(s => {
          const start = new Date(s.startTime * 1000)
          const end = new Date(s.endTime * 1000)
          return {
            id: s.id, title: s.title || 'Shift', start, end,
            date: start.toISOString().split('T')[0],
            startTime: start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            endTime: end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            assignees: (s.assignees || []).map(a => ({ name: usrs[a.userId]?.name || `User ${a.userId}`, status: a.status })),
            isOpen: !!s.openShift, openSpots: s.openSpots || 0,
          }
        }).sort((a, b) => a.start - b.start)
        setConnecteamShifts(processed)
      } catch {}
    }

    setLoading(false)
  }

  // Fetch available Google Calendars for settings
  async function loadCalendarList() {
    try {
      const res = await fetch('/api/calendar?action=calendars')
      if (res.ok) {
        const data = await res.json()
        setAllCalendars(data.calendars || [])
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
      cleanEnd.setHours(cleanEnd.getHours() + 3) // 3 hour cleaning window

      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          calendarId: 'primary',
          summary: `🧹 Turnover: ${turnover.property}`,
          description: `Checkout: ${turnover.checkoutTime}\nGuest: ${turnover.guestName}\nProperty: ${turnover.property}\n${turnover.reservationUrl ? `Reservation: ${turnover.reservationUrl}` : ''}`,
          startDateTime: `${turnover.checkOut}T${turnover.cleaningTime}:00`,
          endDateTime: cleanEnd.toISOString().split('.')[0],
          location: turnover.property,
          colorId: '6', // orange
        }),
      })

      if (res.ok) {
        await loadSchedule() // Refresh
      } else {
        const err = await res.json()
        setError(err.error || 'Failed to create event')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingCleaning(null)
    }
  }

  // Group data by date for week view
  function getDateItems(dateStr) {
    const items = []

    // Google Calendar events
    for (const e of calendarEvents) {
      const eDate = e.allDay ? e.start.date : e.start.dateTime?.split('T')[0]
      if (eDate === dateStr) {
        const isCleaning = e.summary?.includes('🧹') || e.summary?.includes('Turnover')
        items.push({
          type: isCleaning ? 'cleaning' : 'calendar',
          title: e.summary,
          time: e.allDay ? 'All day' : new Date(e.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          color: isCleaning ? 'bg-orange-900/20 border-orange-800/50' : 'bg-cyan-900/20 border-cyan-800/50',
        })
      }
    }

    // Turnovers (checkouts needing cleaning)
    for (const t of turnovers) {
      if (t.checkOut === dateStr) {
        const alreadyScheduled = calendarEvents.some(e =>
          e.summary?.includes(t.property) && (e.start.dateTime?.startsWith(dateStr) || e.start.date === dateStr)
        )
        items.push({
          type: 'turnover',
          title: `${t.property}`,
          subtitle: `${t.guestName} checkout ${t.checkoutTime}`,
          time: `Clean @ ${t.cleaningTime}`,
          color: alreadyScheduled ? 'bg-green-900/20 border-green-800/50' : 'bg-red-900/20 border-red-800/50',
          scheduled: alreadyScheduled,
          turnover: t,
        })
      }
    }

    // Connecteam shifts
    for (const s of connecteamShifts) {
      if (s.date === dateStr) {
        items.push({
          type: 'connecteam',
          title: s.title,
          time: `${s.startTime}-${s.endTime}`,
          subtitle: s.assignees.map(a => a.name).join(', '),
          color: s.isOpen ? 'bg-yellow-900/20 border-yellow-800/50' : 'bg-blue-900/20 border-blue-800/50',
        })
      }
    }

    // Local CRM jobs
    const dateJobs = localJobs.filter(j => j.date === dateStr)
    for (const j of dateJobs) {
      items.push({
        type: 'crm',
        title: j.title,
        subtitle: clients[j.clientId]?.name || j.clientName,
        time: j.startTime || '',
        color: j.status === 'completed' ? 'bg-green-900/20 border-green-800/50' : 'bg-purple-900/20 border-purple-800/50',
      })
    }

    return items
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Schedule</h1>
          <p className="text-sm text-gray-500 mt-1">
            {days[0].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - {days[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(w => w - 1)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">&larr;</button>
          <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">Today</button>
          <button onClick={() => setWeekOffset(w => w + 1)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">&rarr;</button>
          <button onClick={() => { setShowSettings(!showSettings); if (!showSettings) loadCalendarList() }}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${showSettings ? 'bg-blue-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700'}`}>
            Rentals
          </button>
          <button onClick={loadSchedule} disabled={loading}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg text-sm text-gray-300 disabled:opacity-50">
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>}

      {/* Rental Calendar Settings */}
      {showSettings && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Rental Property Calendars</h2>
          <p className="text-xs text-gray-500">Add Airbnb/VRBO iCal calendars to auto-detect turnovers and schedule cleanings.</p>

          {/* Current rentals */}
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

          {/* Add new */}
          <form onSubmit={addRentalCalendar} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Calendar</label>
              <select value={newRental.calendarId} onChange={e => {
                const cal = allCalendars.find(c => c.id === e.target.value)
                setNewRental({ ...newRental, calendarId: e.target.value, name: cal?.summaryOverride || cal?.summary || '' })
              }} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select a calendar...</option>
                {allCalendars.map(c => (
                  <option key={c.id} value={c.id}>{c.summaryOverride || c.summary}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Property Name</label>
              <input value={newRental.name} onChange={e => setNewRental({ ...newRental, name: e.target.value })}
                placeholder="e.g. Spin Drift"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
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

          <p className="text-xs text-gray-600">
            To add a new Airbnb calendar: In Google Calendar, click "+", "From URL", paste the Airbnb iCal link. Then it will appear in the dropdown above.
          </p>
        </div>
      )}

      {/* Upcoming turnovers alert */}
      {turnovers.filter(t => !calendarEvents.some(e => e.summary?.includes(t.property) && e.start.dateTime?.startsWith(t.checkOut))).length > 0 && (
        <div className="bg-orange-900/20 border border-orange-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-orange-400 mb-2">Turnovers Needing Cleaning</h3>
          <div className="space-y-2">
            {turnovers.filter(t => !calendarEvents.some(e => e.summary?.includes(t.property) && e.start.dateTime?.startsWith(t.checkOut))).map(t => (
              <div key={`${t.eventId}-${t.checkOut}`} className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-white font-medium">{t.property}</span>
                  <span className="text-gray-400 ml-2">{t.checkOut} @ {t.checkoutTime}</span>
                  <span className="text-gray-500 ml-2">({t.guestName})</span>
                </div>
                <button onClick={() => createCleaningEvent(t)}
                  disabled={creatingCleaning === t.eventId}
                  className="px-3 py-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded text-xs text-white font-medium">
                  {creatingCleaning === t.eventId ? 'Creating...' : `Schedule Clean @ ${t.cleaningTime}`}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-orange-600" /> Turnover cleaning</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-red-600" /> Needs scheduling</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-cyan-600" /> Google Calendar</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-blue-600" /> Connecteam shift</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-purple-600" /> CRM job</span>
      </div>

      {/* Week grid */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, i) => {
          const dateStr = day.toISOString().split('T')[0]
          const isToday = dateStr === now.toISOString().split('T')[0]
          const items = getDateItems(dateStr)

          return (
            <div key={i} className={`bg-gray-900 border rounded-xl min-h-[180px] ${isToday ? 'border-blue-600' : 'border-gray-800'}`}>
              <div className={`px-3 py-2 border-b text-center ${isToday ? 'border-blue-600/50 bg-blue-600/10' : 'border-gray-800'}`}>
                <p className="text-xs text-gray-500">{DAY_NAMES[i]}</p>
                <p className={`text-lg font-bold ${isToday ? 'text-blue-400' : 'text-white'}`}>{day.getDate()}</p>
              </div>
              <div className="p-1.5 space-y-1">
                {items.map((item, j) => (
                  <div key={j} className={`px-2 py-1.5 rounded-lg text-xs border ${item.color}`}>
                    <p className="font-medium text-white truncate">{item.title}</p>
                    {item.time && <p className="text-gray-400">{item.time}</p>}
                    {item.subtitle && <p className="text-gray-500 truncate">{item.subtitle}</p>}
                    {item.type === 'turnover' && !item.scheduled && (
                      <button onClick={() => createCleaningEvent(item.turnover)}
                        disabled={creatingCleaning === item.turnover.eventId}
                        className="mt-1 px-1.5 py-0.5 bg-orange-600 hover:bg-orange-500 rounded text-xs text-white w-full disabled:opacity-50">
                        {creatingCleaning === item.turnover.eventId ? '...' : 'Schedule'}
                      </button>
                    )}
                    {item.type === 'turnover' && item.scheduled && (
                      <p className="text-green-400 text-xs mt-0.5">Scheduled</p>
                    )}
                  </div>
                ))}
                {items.length === 0 && <p className="text-xs text-gray-700 text-center py-4">-</p>}
              </div>
            </div>
          )
        })}
      </div>

      {!apiKey && rentalCals.length === 0 && calendarEvents.length === 0 && (
        <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-500 text-center">
          Connect your Connecteam API key on the Dashboard, or add rental calendars above to see your schedule here.
        </div>
      )}
    </div>
  )
}
