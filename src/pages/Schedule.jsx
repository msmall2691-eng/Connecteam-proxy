import { useState, useEffect } from 'react'
import { getApiKey, fetchUsers, fetchShifts, fetchTimeActivities, dateRangeWeeks } from '../lib/api'
import { getJobs, getClients } from '../lib/store'

export default function Schedule() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [view, setView] = useState('week') // 'week' or 'list'
  const [connecteamShifts, setConnecteamShifts] = useState([])
  const [localJobs, setLocalJobs] = useState([])
  const [users, setUsers] = useState({})
  const [clients, setClients] = useState({})
  const [weekOffset, setWeekOffset] = useState(0)

  const apiKey = getApiKey()

  useEffect(() => {
    loadSchedule()
  }, [weekOffset])

  async function loadSchedule() {
    // Load local jobs
    const cls = {}
    for (const c of getClients()) cls[c.id] = c
    setClients(cls)
    setLocalJobs(getJobs())

    if (!apiKey) return

    setLoading(true)
    setError(null)
    try {
      const now = new Date()
      const weekStart = new Date(now)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1 + weekOffset * 7)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)

      const startStr = weekStart.toISOString().split('T')[0]
      const endStr = weekEnd.toISOString().split('T')[0]

      const usrs = await fetchUsers()
      const shifts = await fetchShifts(startStr, endStr)
      const activities = await fetchTimeActivities(startStr, endStr)

      setUsers(usrs)

      const shiftList = shifts.data?.objects || []
      const actByShift = {}
      const actUsers = activities.data?.timeActivitiesByUsers || []
      for (const u of actUsers) {
        for (const s of u.shifts || []) {
          if (s.schedulerShiftId) actByShift[s.schedulerShiftId] = s
        }
      }

      const processed = shiftList.map(s => {
        const start = new Date(s.startTime * 1000)
        const end = new Date(s.endTime * 1000)
        const assignees = (s.assignees || []).map(a => ({
          name: usrs[a.userId]?.name || `User ${a.userId}`,
          status: a.status,
        }))
        const activity = actByShift[s.id]
        return {
          id: s.id,
          title: s.title || 'Shift',
          start,
          end,
          date: start.toISOString().split('T')[0],
          startTime: start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          endTime: end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          hours: ((s.endTime - s.startTime) / 3600).toFixed(1),
          assignees,
          isOpen: !!s.openShift,
          openSpots: s.openSpots || 0,
          location: s.location?.name || '',
          clockedIn: !!activity,
          dayOfWeek: start.getDay(),
        }
      })

      processed.sort((a, b) => a.start - b.start)
      setConnecteamShifts(processed)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Build week days
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1 + weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // Merge local jobs into the calendar
  const jobsByDate = {}
  for (const j of localJobs) {
    if (!jobsByDate[j.date]) jobsByDate[j.date] = []
    jobsByDate[j.date].push(j)
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
        <div className="flex items-center gap-3">
          <button onClick={() => setWeekOffset(w => w - 1)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">&larr;</button>
          <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">Today</button>
          <button onClick={() => setWeekOffset(w => w + 1)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">&rarr;</button>
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button onClick={() => setView('week')} className={`px-3 py-1.5 text-xs ${view === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>Week</button>
            <button onClick={() => setView('list')} className={`px-3 py-1.5 text-xs ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>List</button>
          </div>
        </div>
      </div>

      {error && <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>}

      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {view === 'week' ? (
        /* Week grid view */
        <div className="grid grid-cols-7 gap-2">
          {days.map((day, i) => {
            const dateStr = day.toISOString().split('T')[0]
            const dayShifts = connecteamShifts.filter(s => s.date === dateStr)
            const dayJobs = jobsByDate[dateStr] || []
            const isToday = dateStr === now.toISOString().split('T')[0]

            return (
              <div key={i} className={`bg-gray-900 border rounded-xl min-h-[200px] ${isToday ? 'border-blue-600' : 'border-gray-800'}`}>
                <div className={`px-3 py-2 border-b text-center ${isToday ? 'border-blue-600/50 bg-blue-600/10' : 'border-gray-800'}`}>
                  <p className="text-xs text-gray-500">{dayNames[i]}</p>
                  <p className={`text-lg font-bold ${isToday ? 'text-blue-400' : 'text-white'}`}>{day.getDate()}</p>
                </div>
                <div className="p-2 space-y-1.5">
                  {/* Connecteam shifts */}
                  {dayShifts.map(s => (
                    <div key={s.id} className={`px-2 py-1.5 rounded-lg text-xs ${
                      s.isOpen ? 'bg-yellow-900/20 border border-yellow-800/50' :
                      s.clockedIn ? 'bg-green-900/20 border border-green-800/50' :
                      'bg-blue-900/20 border border-blue-800/50'
                    }`}>
                      <p className="font-medium text-white truncate">{s.title}</p>
                      <p className="text-gray-400">{s.startTime} - {s.endTime}</p>
                      {s.assignees.map((a, j) => (
                        <p key={j} className="text-gray-500 truncate">{a.name}</p>
                      ))}
                      {s.isOpen && <p className="text-yellow-400">{s.openSpots} spot(s) open</p>}
                    </div>
                  ))}
                  {/* Local jobs */}
                  {dayJobs.map(j => (
                    <div key={j.id} className={`px-2 py-1.5 rounded-lg text-xs border ${
                      j.status === 'completed' ? 'bg-green-900/20 border-green-800/50' :
                      j.status === 'cancelled' ? 'bg-gray-800/50 border-gray-700' :
                      'bg-purple-900/20 border-purple-800/50'
                    }`}>
                      <p className="font-medium text-white truncate">{j.title}</p>
                      <p className="text-gray-400">{clients[j.clientId]?.name || j.clientName || ''}</p>
                      {j.assignee && <p className="text-gray-500">{j.assignee}</p>}
                    </div>
                  ))}
                  {dayShifts.length === 0 && dayJobs.length === 0 && (
                    <p className="text-xs text-gray-700 text-center py-2">-</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* List view */
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-5 py-2.5 text-left">Date</th>
                <th className="px-3 py-2.5 text-left">Shift/Job</th>
                <th className="px-3 py-2.5 text-left">Time</th>
                <th className="px-3 py-2.5 text-left">Assigned</th>
                <th className="px-3 py-2.5 text-center">Status</th>
                <th className="px-5 py-2.5 text-left">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {connecteamShifts.map(s => (
                <tr key={`ct-${s.id}`} className="text-gray-300 hover:bg-gray-800/30">
                  <td className="px-5 py-2.5">{new Date(s.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                  <td className="px-3 py-2.5 text-white">{s.title}</td>
                  <td className="px-3 py-2.5">{s.startTime} - {s.endTime}</td>
                  <td className="px-3 py-2.5">{s.assignees.map(a => a.name).join(', ') || '-'}</td>
                  <td className="px-3 py-2.5 text-center">
                    {s.isOpen ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-yellow-900/40 text-yellow-400">Open</span>
                    ) : s.clockedIn ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-green-900/40 text-green-400">Clocked In</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-900/40 text-blue-400">Scheduled</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5"><span className="px-1.5 py-0.5 bg-blue-900/20 text-blue-400 rounded text-xs">Connecteam</span></td>
                </tr>
              ))}
              {days.flatMap(day => {
                const dateStr = day.toISOString().split('T')[0]
                return (jobsByDate[dateStr] || []).map(j => (
                  <tr key={`local-${j.id}`} className="text-gray-300 hover:bg-gray-800/30">
                    <td className="px-5 py-2.5">{new Date(j.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td className="px-3 py-2.5 text-white">{j.title} {j.clientName ? `(${j.clientName})` : ''}</td>
                    <td className="px-3 py-2.5">-</td>
                    <td className="px-3 py-2.5">{j.assignee || '-'}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        j.status === 'completed' ? 'bg-green-900/40 text-green-400' :
                        j.status === 'scheduled' ? 'bg-purple-900/40 text-purple-400' :
                        'bg-gray-800 text-gray-400'
                      }`}>{j.status}</span>
                    </td>
                    <td className="px-5 py-2.5"><span className="px-1.5 py-0.5 bg-purple-900/20 text-purple-400 rounded text-xs">CRM</span></td>
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </div>
      )}

      {!apiKey && (
        <div className="p-4 bg-yellow-900/20 border border-yellow-800 rounded-lg text-sm text-yellow-300">
          Connect your Connecteam API key on the Dashboard to see scheduled shifts here alongside your CRM jobs.
        </div>
      )}
    </div>
  )
}
