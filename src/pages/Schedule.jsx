import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey } from '../lib/api'
import { getClients, getClientsAsync, getJobs, getJobsAsync, getVisitsAsync, getScheduleAsync, getEmployeesAsync, saveVisitAsync, saveJobAsync, getPropertiesAsync, savePropertyAsync } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'

// DST-safe timezone offset for America/New_York
function easternOffset(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
  const parts = fmt.formatToParts(d)
  const tzPart = parts.find(p => p.type === 'timeZoneName')
  // e.g. "GMT-4" or "GMT-5" → "-04:00" or "-05:00"
  const m = tzPart?.value?.match(/GMT([+-]?\d+)/)
  if (m) {
    const h = parseInt(m[1], 10)
    return `${h <= 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`
  }
  return '-05:00' // fallback EST
}

// Format time string (09:00:00 or 09:00) to human-friendly (9:00am)
function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hr = parseInt(h)
  if (isNaN(hr)) return t
  return `${hr > 12 ? hr - 12 : hr || 12}:${m || '00'}${hr >= 12 ? 'pm' : 'am'}`
}

// Strip seconds from time string (10:30:00 → 10:30)
function stripSeconds(t) {
  if (!t) return t
  return t.replace(/^(\d{2}:\d{2}):\d{2}$/, '$1')
}

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
  const [newEvent, setNewEvent] = useState({ title: '', date: '', startTime: '09:00', endTime: '12:00', location: '', description: '', clientEmail: '', clientId: '' })
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [allClients, setAllClients] = useState([])
  const [crmJobs, setCrmJobs] = useState([])
  const [crmVisits, setCrmVisits] = useState([])

  // New state for improvements
  const [toast, setToast] = useState(null) // { type: 'success'|'error'|'info', message, details }
  const [scanning, setScanning] = useState(false)
  const [connecteamShifts, setConnecteamShifts] = useState([])
  const [showShifts, setShowShifts] = useState(false)
  const [loadingShifts, setLoadingShifts] = useState(false)
  const [pushingToConnecteam, setPushingToConnecteam] = useState(null)
  const [pushingVisitToCal, setPushingVisitToCal] = useState(null)
  const [pushingVisitToCT, setPushingVisitToCT] = useState(null)
  const [unlinkedCals, setUnlinkedCals] = useState([])
  const [linkingCal, setLinkingCal] = useState(null)
  const [linkClientId, setLinkClientId] = useState('')
  const [linkPropertyName, setLinkPropertyName] = useState('')
  const [rentalStays, setRentalStays] = useState([])
  const [showStays, setShowStays] = useState(true)
  const [batchSyncing, setBatchSyncing] = useState(false)
  const [completingVisit, setCompletingVisit] = useState(null)

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
    loadCrmData()
    loadRentalStays()
  }, [])

  async function loadCrmData() {
    try {
      const today = new Date().toISOString().split('T')[0]
      const sixWeeksOut = new Date(Date.now() + 42 * 86400000).toISOString().split('T')[0]
      const [cls, jbs, visits] = isSupabaseConfigured()
        ? await Promise.all([
            getClientsAsync(),
            getJobsAsync(),
            getScheduleAsync({ startDate: today, endDate: sixWeeksOut }),
          ])
        : [getClients(), getJobs(), []]
      setAllClients(cls || [])
      setCrmJobs(jbs || [])
      setCrmVisits(visits || [])
    } catch {}
  }

  async function loadUnlinkedCalendars() {
    if (!isSupabaseConfigured()) return
    try {
      const props = await getPropertiesAsync()
      const linkedIds = new Set(props.filter(p => p.googleCalendarId).map(p => p.googleCalendarId))
      const unlinked = allCalendars.filter(c =>
        !c.primary && !linkedIds.has(c.id) &&
        !rentalCals.some(rc => rc.calendarId === c.id)
      )
      setUnlinkedCals(unlinked)
    } catch {}
  }

  // Load unlinked calendars when settings opened or calendars change
  useEffect(() => {
    if (showSettings && allCalendars.length > 0) loadUnlinkedCalendars()
  }, [showSettings, allCalendars.length])

  async function loadRentalStays() {
    try {
      const allProps = isSupabaseConfigured() ? await getPropertiesAsync() : []
      const rentalProps = allProps.filter(p => p.type === 'rental' && p.googleCalendarId)
      if (rentalProps.length === 0) return

      const now = new Date()
      const future = new Date(now.getTime() + 60 * 86400000)
      const stays = []

      // Fetch events from each rental property's Google Calendar
      const promises = rentalProps.map(async (prop) => {
        try {
          const calParam = `${prop.googleCalendarId}|${prop.name || prop.addressLine1}`
          const res = await fetch(`/api/google?action=turnovers&calendars=${encodeURIComponent(calParam)}&timeMin=${now.toISOString()}&timeMax=${future.toISOString()}`)
          if (res.ok) {
            const data = await res.json()
            for (const t of (data.turnovers || [])) {
              stays.push({
                propertyId: prop.id,
                propertyName: prop.name || prop.addressLine1,
                address: prop.addressLine1,
                guest: t.guestName || 'Guest',
                checkIn: t.checkIn,
                checkOut: t.checkOut,
                clientId: prop.clientId,
              })
            }
          }
        } catch {}
      })

      await Promise.all(promises)
      stays.sort((a, b) => (a.checkOut || '').localeCompare(b.checkOut || ''))
      setRentalStays(stays)
    } catch {}
  }

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
    try {
      // Primary: load from Supabase rental properties (persists across devices)
      const allProps = isSupabaseConfigured() ? await getPropertiesAsync() : []
      const rentalProps = allProps.filter(p => p.type === 'rental' && (p.googleCalendarId || p.icalUrl))

      // Fallback: also include legacy localStorage calendars
      const legacyCals = rentalCals.filter(c =>
        !rentalProps.some(p => p.googleCalendarId === c.calendarId)
      )

      // Only include properties with Google Calendar IDs in the Google API call
      const gcalRentalProps = rentalProps.filter(p => p.googleCalendarId)
      const calEntries = [
        ...gcalRentalProps.map(p => ({ calendarId: p.googleCalendarId, name: p.name || p.addressLine1, clientId: p.clientId, propertyId: p.id, address: p.addressLine1 })),
        ...legacyCals.map(c => ({ calendarId: c.calendarId, name: c.name, clientId: null, propertyId: null, address: '' })),
      ]

      // If no Google Calendar entries but we have iCal-only properties, just return
      // (they'll be picked up by Auto-Scan which uses the /api/auto-turnovers endpoint)
      if (calEntries.length === 0) return

      const calParam = calEntries.map(c => `${c.calendarId}|${c.name}`).join(',')
      const now = new Date()
      const future = new Date(now.getTime() + 60 * 86400000)
      const res = await fetch(`/api/google?action=turnovers&calendars=${encodeURIComponent(calParam)}&timeMin=${now.toISOString()}&timeMax=${future.toISOString()}`)
      if (res.ok) {
        const data = await res.json()
        // Enrich turnovers with client/property linkage from Supabase properties
        const enriched = (data.turnovers || []).map(t => {
          const match = calEntries.find(c => c.calendarId === t.calendarId || c.name === t.property)
          return { ...t, clientId: match?.clientId || null, propertyId: match?.propertyId || null, address: t.address || match?.address || '' }
        })
        setTurnovers(enriched)
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
          clientId: st.clientId,
          propertyId: st.propertyId,
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

        const errCount = data.errors || 0
        if (propCount === 0) {
          setToast({
            type: 'info',
            message: 'No rental properties found',
            details: 'Add rental properties (type=rental) with a Google Calendar ID or iCal URL in the Properties tab.',
          })
        } else if (createdCount > 0) {
          setToast({
            type: 'success',
            message: `Created ${createdCount} new turnover${createdCount !== 1 ? 's' : ''}`,
            details: `Scanned ${propCount} properties. ${totalCount} found, ${alreadyCount} already scheduled.${errCount ? ` ${errCount} errors.` : ''}`,
          })
        } else if (totalCount > 0) {
          setToast({
            type: 'info',
            message: 'All turnovers already scheduled',
            details: `${propCount} properties scanned. ${alreadyCount} turnovers already have visits.`,
          })
        } else {
          setToast({
            type: 'info',
            message: `No turnovers found (${propCount} properties scanned)`,
            details: propCount > 0
              ? `Check that your rental properties have iCal/Google Calendar data with upcoming reservations. No checkouts detected in next ${daysAhead} days.`
              : 'Add rental properties with a Google Calendar ID or iCal URL in the Properties tab.',
          })
        }

        // Refresh all schedule data so new visits appear immediately
        loadTurnovers()
        loadCrmData()
        loadRentalStays()
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
      const cleanTime = stripSeconds(turnover.cleaningTime) || '11:00'
      const cleanEnd = new Date(`${turnover.checkOut}T${cleanTime}:00`)
      cleanEnd.setHours(cleanEnd.getHours() + 3)

      await fetch('/api/google?action=calendar-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `🧹 Turnover: ${turnover.property}`,
          description: `Checkout: ${formatTime(turnover.checkoutTime)}\nGuest: ${turnover.guestName}\nProperty: ${turnover.property}\n${turnover.reservationUrl ? `Reservation: ${turnover.reservationUrl}` : ''}`,
          startDateTime: `${turnover.checkOut}T${cleanTime}:00`,
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

    setPushingToConnecteam(turnover.eventId)
    try {
      const cleanTime = stripSeconds(turnover.cleaningTime) || '11:00'
      const startDateTime = `${turnover.checkOut}T${cleanTime}:00`
      const startUnix = Math.floor(new Date(startDateTime + easternOffset(turnover.checkOut)).getTime() / 1000)
      const endUnix = startUnix + 3 * 3600 // 3 hours

      const res = await fetch(`/api/connecteam?action=shift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
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

  // Push a visit/job to Google Calendar
  async function pushVisitToCalendar(item) {
    setPushingVisitToCal(item.id)
    try {
      const date = item.scheduledDate || item.date
      const startTime = item.scheduledStartTime || item.startTime || '09:00'
      const endTime = item.scheduledEndTime || item.endTime || '12:00'
      const title = item.job?.title || item.title || 'Cleaning'
      const clientName = item.client?.name || item.clientName || ''
      const address = item.address || item.client?.address || item.property?.address_line1 || ''

      const res = await fetch('/api/google?action=calendar-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `${title}${clientName ? ' — ' + clientName : ''}`,
          description: [clientName, address, item.instructions].filter(Boolean).join('\n'),
          startDateTime: `${date}T${startTime.replace(/:\d{2}$/, '')}:00`,
          endDateTime: `${date}T${endTime.replace(/:\d{2}$/, '')}:00`,
          location: address,
        }),
      })
      if (res.ok) {
        const calData = await res.json()
        // Update the visit with the google_event_id
        if (item.scheduledDate) {
          await saveVisitAsync({ id: item.id, googleEventId: calData.id })
        } else {
          await saveJobAsync({ id: item.id, googleEventId: calData.id })
        }
        setToast({ type: 'success', message: `Added to Google Calendar`, details: `${title} on ${new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` })
        loadCrmData()
      } else {
        setToast({ type: 'error', message: 'Failed to add to calendar' })
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to add to calendar', details: err.message })
    } finally {
      setPushingVisitToCal(null)
    }
  }

  // Push a visit/job to Connecteam
  async function pushVisitToConnecteam(item) {
    const apiKey = getApiKey()
    setPushingVisitToCT(item.id)
    try {
      const date = item.scheduledDate || item.date
      const startTime = item.scheduledStartTime || item.startTime || '09:00'
      const endTime = item.scheduledEndTime || item.endTime || '12:00'
      const title = item.job?.title || item.title || 'Cleaning'
      const clientName = item.client?.name || item.clientName || ''
      const address = item.address || item.client?.address || ''

      const tzOff = easternOffset(date)
      const startStr = `${date}T${startTime.replace(/:\d{2}$/, '')}:00${tzOff}`
      const startUnix = Math.floor(new Date(startStr).getTime() / 1000)
      const endStr = `${date}T${endTime.replace(/:\d{2}$/, '')}:00${tzOff}`
      const endUnix = Math.floor(new Date(endStr).getTime() / 1000)

      const res = await fetch('/api/connecteam?action=shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
        body: JSON.stringify({
          title: `${title}${clientName ? ' — ' + clientName : ''}`,
          startTime: startUnix,
          endTime: endUnix,
          description: [clientName, address, item.instructions].filter(Boolean).join('\n'),
          location: address,
          visitId: item.scheduledDate ? item.id : undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (item.scheduledDate) {
          await saveVisitAsync({ id: item.id, connecteamShiftId: data.shift?.id || 'synced' })
        } else {
          await saveJobAsync({ id: item.id, connecteamShiftId: data.shift?.id || 'synced' })
        }
        setToast({ type: 'success', message: 'Pushed to Connecteam', details: title })
        loadCrmData()
      } else {
        setToast({ type: 'error', message: 'Failed to push to Connecteam' })
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to push to Connecteam', details: err.message })
    } finally {
      setPushingVisitToCT(null)
    }
  }

  async function loadConnecteamShifts() {
    const apiKey = getApiKey()

    setLoadingShifts(true)
    try {
      const now = new Date()
      const startDate = now.toISOString().split('T')[0]
      const future = new Date(now.getTime() + 14 * 86400000)
      const endDate = future.toISOString().split('T')[0]
      const startTime = Math.floor(now.getTime() / 1000)
      const endTime = Math.floor(future.getTime() / 1000)

      const res = await fetch(`/api/connecteam?path=${encodeURIComponent(`scheduler/v1/schedulers/15248539/shifts?startTime=${startTime}&endTime=${endTime}`)}`, {
        headers: { ...(apiKey && { 'X-API-KEY': apiKey }) },
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

  // Batch sync all unsynced visits to Google Calendar + Connecteam
  async function handleBatchSync() {
    setBatchSyncing(true)
    try {
      const res = await fetch('/api/visits?action=sync-all', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setToast({ type: 'success', message: `Synced ${data.synced} of ${data.total} visits`, details: 'Google Calendar + Connecteam' })
        loadCrmData()
      } else {
        setToast({ type: 'error', message: 'Batch sync failed' })
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Batch sync failed', details: err.message })
    } finally {
      setBatchSyncing(false)
    }
  }

  // Mark a visit as complete (triggers auto-invoice)
  async function handleCompleteVisit(item) {
    setCompletingVisit(item.id)
    try {
      const res = await fetch(`/api/visits?action=complete&visitId=${item.id}`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        const msg = data.invoice ? `Completed + Invoice #${data.invoice.invoice_number} created` : 'Marked as completed'
        setToast({ type: 'success', message: msg, details: item.title || 'Visit' })
        loadCrmData()
      } else {
        setToast({ type: 'error', message: 'Failed to complete visit' })
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to complete visit', details: err.message })
    } finally {
      setCompletingVisit(null)
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
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowCalendarFilter(false)} />
                <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-800 rounded-lg p-3 z-20 w-72 shadow-xl">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Show/Hide Calendars</p>
                    <button onClick={() => setShowCalendarFilter(false)} className="text-xs text-gray-500 hover:text-white">Close</button>
                  </div>
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
              </>
            )}
          </div>

          {/* Turnovers toggle */}
          <button onClick={() => setShowTurnovers(!showTurnovers)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              showTurnovers ? 'bg-orange-600/20 border-orange-800/50 text-orange-400' : 'bg-gray-800 border-gray-700 text-gray-400'
            }`}>
            Turnovers {mergedTurnovers.length > 0 ? `(${mergedTurnovers.length})` : ''}
          </button>

          {/* Guest Stays toggle */}
          <button onClick={() => setShowStays(!showStays)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              showStays ? 'bg-teal-600/20 border-teal-800/50 text-teal-400' : 'bg-gray-800 border-gray-700 text-gray-400'
            }`}>
            Guest Stays {rentalStays.length > 0 ? `(${rentalStays.length})` : ''}
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
              <label className="block text-xs text-gray-500 mb-1">Link to Client (optional)</label>
              <select value={newEvent.clientId} onChange={e => {
                const cl = allClients.find(c => c.id === e.target.value)
                setNewEvent({
                  ...newEvent,
                  clientId: e.target.value,
                  clientEmail: cl?.email || newEvent.clientEmail,
                  location: cl?.address || newEvent.location,
                })
              }} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                <option value="">Select client...</option>
                {allClients.map(c => <option key={c.id} value={c.id}>{c.name}{c.companyName ? ` (${c.companyName})` : ''}</option>)}
              </select>
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

      {/* Unlinked Calendars — Google Calendars not yet linked to a client property */}
      {showSettings && unlinkedCals.length > 0 && (
        <div className="bg-yellow-900/10 border border-yellow-800/50 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-yellow-400">Unlinked Rental Calendars</h3>
          <p className="text-xs text-gray-500">These Google Calendars aren't linked to a client property yet. Link them to enable automatic turnover detection.</p>
          <div className="space-y-2">
            {unlinkedCals.map(cal => (
              <div key={cal.id} className="bg-gray-800/50 rounded-lg px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white">{cal.summaryOverride || cal.summary}</span>
                  {linkingCal !== cal.id ? (
                    <button onClick={() => { setLinkingCal(cal.id); setLinkPropertyName(cal.summaryOverride || cal.summary || '') }}
                      className="px-2.5 py-1 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-xs text-white font-medium">
                      Link to Client
                    </button>
                  ) : (
                    <button onClick={() => setLinkingCal(null)} className="text-xs text-gray-500">Cancel</button>
                  )}
                </div>
                {linkingCal === cal.id && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Client</label>
                      <select value={linkClientId} onChange={e => setLinkClientId(e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white">
                        <option value="">Select client...</option>
                        {allClients.filter(c => c.status === 'active').map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Property Name</label>
                      <input value={linkPropertyName} onChange={e => setLinkPropertyName(e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white" />
                    </div>
                    <button disabled={!linkClientId} onClick={async () => {
                      try {
                        await savePropertyAsync({
                          clientId: linkClientId,
                          name: linkPropertyName || cal.summaryOverride || cal.summary,
                          type: 'rental',
                          googleCalendarId: cal.id,
                          checkoutTime: '10:00',
                          cleaningTime: '11:00',
                          isPrimary: false,
                        })
                        setToast({ type: 'success', message: `Linked "${linkPropertyName}" to client`, details: 'This calendar will now be scanned for turnovers. Click Auto-Scan to detect checkouts.' })
                        setLinkingCal(null)
                        setLinkClientId('')
                        setLinkPropertyName('')
                        // Refresh unlinked list
                        loadUnlinkedCalendars()
                      } catch (e) {
                        setToast({ type: 'error', message: 'Failed to link calendar', details: e.message })
                      }
                    }} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium">
                      Save Property
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
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
                Add a Google Calendar ID to rental properties in client Properties tab,
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
                      {new Date(t.checkOut + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} &middot;
                      Checkout {formatTime(t.checkoutTime)} &middot; {t.guestName}
                      {t.clientName && <span className="text-gray-600"> &middot; {t.clientName}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => createCleaningEvent(t)} disabled={creatingCleaning === t.eventId}
                    className="px-2.5 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium"
                    title="Add to Google Calendar">
                    {creatingCleaning === t.eventId ? '...' : `Cal @ ${formatTime(t.cleaningTime)}`}
                  </button>
                  <button onClick={() => pushTurnoverToConnecteam(t)} disabled={pushingToConnecteam === t.eventId}
                    className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium"
                    title="Push to Connecteam Scheduler">
                    {pushingToConnecteam === t.eventId ? '...' : 'Connecteam'}
                  </button>
                  {t.clientId && (
                    <Link to={`/clients/${t.clientId}?tab=properties`} className="text-xs text-gray-500 hover:text-gray-300" title="View client & property">View</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Guest Stays — cross-reference reservations with scheduled cleanings */}
      {showStays && rentalStays.length > 0 && (
        <div className="bg-teal-900/10 border border-teal-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-teal-400">Guest Stays (Next 60 Days)</h3>
            <button onClick={loadRentalStays} className="text-xs text-teal-400 hover:text-teal-300">Refresh</button>
          </div>
          <div className="space-y-1.5">
            {rentalStays.map((stay, i) => {
              // Cross-reference: find a matching turnover visit for checkout day
              const hasCleaningVisit = crmVisits.some(v =>
                v.propertyId === stay.propertyId &&
                v.scheduledDate === stay.checkOut &&
                !['cancelled', 'skipped'].includes(v.status)
              )
              const hasTurnover = mergedTurnovers.some(t =>
                t.checkOut === stay.checkOut && (t.property === stay.propertyName || t.address === stay.address)
              )
              return (
                <div key={`stay-${i}`} className="flex flex-col sm:flex-row sm:items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2.5 gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white font-medium truncate">{stay.propertyName}</p>
                      {hasCleaningVisit ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-600/20 text-green-400 rounded">cleaning scheduled</span>
                      ) : hasTurnover ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-orange-600/20 text-orange-400 rounded">turnover detected</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 bg-red-600/20 text-red-400 rounded">no cleaning</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {stay.guest}
                      {stay.checkIn && <> &middot; Check-in {new Date(stay.checkIn + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
                      {stay.checkOut && <> &middot; Checkout <span className="text-white">{new Date(stay.checkOut + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span></>}
                      {stay.address && <span className="text-gray-600"> &middot; {stay.address.split(',')[0]}</span>}
                    </p>
                  </div>
                  {!hasCleaningVisit && (
                    <div className="shrink-0">
                      {stay.clientId ? (
                        <Link to={`/clients/${stay.clientId}?tab=properties`}
                          className="px-2.5 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs text-white font-medium inline-block">
                          Schedule Cleaning
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-600">No client linked</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty guest stays notice — only show if user actively clicked Guest Stays toggle */}

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

      {/* Empty Connecteam shifts notice — hidden to reduce noise */}

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

      {/* Upcoming Schedule (visits-first, fallback to jobs) */}
      {(() => {
        const today = new Date().toISOString().split('T')[0]
        // Use visits if available, fall back to jobs
        const items = crmVisits.length > 0
          ? crmVisits
              .filter(v => !['cancelled', 'skipped'].includes(v.status))
              .map(v => ({
                id: v.id, type: 'visit',
                title: v.job?.title || 'Cleaning',
                date: v.scheduledDate,
                startTime: v.scheduledStartTime,
                endTime: v.scheduledEndTime,
                clientName: v.client?.name || '',
                clientId: v.clientId,
                propertyId: v.propertyId,
                propertyName: v.property?.name || '',
                address: v.address || v.property?.address_line1 || '',
                googleEventId: v.googleEventId,
                connecteamShiftId: v.connecteamShiftId,
                status: v.status,
                source: v.source,
                scheduledDate: v.scheduledDate,
                scheduledStartTime: v.scheduledStartTime,
                scheduledEndTime: v.scheduledEndTime,
                job: v.job, client: v.client, property: v.property,
                instructions: v.instructions,
              }))
          : crmJobs
              .filter(j => j.status === 'scheduled' && j.date >= today)
              .map(j => ({
                id: j.id, type: 'job',
                title: j.title, date: j.date,
                startTime: j.startTime, endTime: j.endTime,
                clientName: j.clientName, clientId: j.clientId,
                propertyId: j.propertyId,
                address: j.address,
                googleEventId: j.googleEventId,
                connecteamShiftId: j.connecteamShiftId,
                status: j.status,
              }))
        const sorted = items.sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, 20)

        if (sorted.length === 0) return null
        return (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Upcoming Schedule</h3>
              <div className="flex items-center gap-2">
                <button onClick={handleBatchSync} disabled={batchSyncing}
                  className="px-2.5 py-1 bg-indigo-600/20 border border-indigo-800 rounded text-xs text-indigo-400 hover:bg-indigo-600/30 disabled:opacity-50 flex items-center gap-1">
                  {batchSyncing ? 'Syncing...' : 'Sync All'}
                </button>
                <span className="text-xs text-gray-500">{sorted.length} upcoming</span>
              </div>
            </div>
            <div className="space-y-1.5">
              {sorted.map(item => (
                <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2.5 gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white truncate">{item.title}</p>
                      {item.source === 'ical_sync' && <span className="text-[10px] px-1.5 py-0.5 bg-orange-600/20 text-orange-400 rounded">turnover</span>}
                      {item.source === 'recurring' && <span className="text-[10px] px-1.5 py-0.5 bg-blue-600/20 text-blue-400 rounded">recurring</span>}
                      {item.source === 'booking' && <span className="text-[10px] px-1.5 py-0.5 bg-green-600/20 text-green-400 rounded">booking</span>}
                    </div>
                    <p className="text-xs text-gray-500">
                      {new Date(item.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {item.startTime && ` @ ${formatTime(item.startTime)}`}
                      {item.endTime && ` – ${formatTime(item.endTime)}`}
                      {item.clientName && <span className="text-gray-600"> &middot; {item.clientName}</span>}
                      {item.address && <span className="text-gray-600"> &middot; {item.address.split(',')[0]}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!item.googleEventId && (
                      <button onClick={() => pushVisitToCalendar(item)} disabled={pushingVisitToCal === item.id}
                        className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium">
                        {pushingVisitToCal === item.id ? '...' : 'Google Cal'}
                      </button>
                    )}
                    {item.googleEventId && (
                      <span className="text-xs text-green-500 px-1.5">On cal</span>
                    )}
                    {!item.connecteamShiftId && (
                      <button onClick={() => pushVisitToConnecteam(item)} disabled={pushingVisitToCT === item.id}
                        className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-xs text-white font-medium">
                        {pushingVisitToCT === item.id ? '...' : 'Connecteam'}
                      </button>
                    )}
                    {item.connecteamShiftId && (
                      <span className="text-xs text-purple-400 px-1.5">Synced</span>
                    )}
                    {item.status === 'scheduled' || item.status === 'confirmed' || item.status === 'in_progress' ? (
                      <button onClick={() => handleCompleteVisit(item)} disabled={completingVisit === item.id}
                        className="px-2 py-1 bg-green-600/20 border border-green-800 rounded text-xs text-green-400 hover:bg-green-600/30 disabled:opacity-50">
                        {completingVisit === item.id ? '...' : 'Done'}
                      </button>
                    ) : item.status === 'completed' ? (
                      <span className="text-xs text-green-500 px-1">Done</span>
                    ) : null}
                    {item.clientId && (
                      <Link to={`/clients/${item.clientId}?tab=${item.source === 'ical_sync' ? 'properties' : 'jobs'}`} className="text-xs text-gray-500 hover:text-gray-300">View</Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Legend + links */}
      {calendarConnected && (
        <div className="flex items-center justify-between">
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-gray-500"><span className="w-2.5 h-2.5 rounded bg-orange-600" /> Turnover cleaning</span>
            <span className="flex items-center gap-1.5 text-gray-500"><span className="w-2.5 h-2.5 rounded bg-teal-600" /> Guest stay</span>
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
