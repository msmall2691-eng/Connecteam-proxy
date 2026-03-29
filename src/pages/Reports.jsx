import { useState, useEffect } from 'react'
import { getApiKey, fetchUsers, fetchTimesheets, fetchTimeActivities, dateRangeWeeks } from '../lib/api'

export default function Reports() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)
  const [weeks, setWeeks] = useState(2)

  const apiKey = getApiKey()

  useEffect(() => {
    if (apiKey) loadReport()
  }, [apiKey, weeks])

  async function loadReport() {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateRangeWeeks(weeks)
      const users = await fetchUsers()
      const timesheets = await fetchTimesheets(start, end)
      const activities = await fetchTimeActivities(start, end)

      const tsUsers = timesheets.data?.users || []
      const actUsers = activities.data?.timeActivitiesByUsers || []

      // Build activity index by userId
      const actByUser = {}
      for (const u of actUsers) {
        actByUser[u.userId] = u.shifts || []
      }

      const employeeReports = []

      for (const u of tsUsers) {
        const info = users[u.userId] || { name: `User ${u.userId}` }
        let totalHours = 0
        let totalPay = 0
        const dailyBreakdown = []

        for (const dr of u.dailyRecords || []) {
          const hours = (dr.totalTime || 0) / 3600
          let pay = 0
          for (const pi of dr.payItems || []) pay += pi.amount || 0
          totalHours += hours
          totalPay += pay
          if (hours > 0) {
            dailyBreakdown.push({
              date: dr.date,
              hours: Math.round(hours * 100) / 100,
              pay: Math.round(pay * 100) / 100,
            })
          }
        }

        // Get shifts
        const shifts = actByUser[u.userId] || []
        const shiftDetails = shifts.map(s => {
          const startTime = s.startTime ? new Date(s.startTime * 1000) : null
          const endTime = s.endTime ? new Date(s.endTime * 1000) : null
          const hours = startTime && endTime ? (s.endTime - s.startTime) / 3600 : 0
          let miles = 0
          for (const att of s.shiftAttachments || []) {
            if (att.attachment?.number) miles += att.attachment.number
          }
          const notes = []
          if (s.startNote) notes.push(s.startNote)
          if (s.endNote) notes.push(s.endNote)
          const location = s.startPoint?.address || ''

          return {
            date: startTime?.toLocaleDateString() || '',
            start: startTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '',
            end: endTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '',
            hours: Math.round(hours * 100) / 100,
            miles: Math.round(miles * 100) / 100,
            location,
            notes: notes.join(' | '),
          }
        })

        if (totalHours > 0) {
          employeeReports.push({
            name: info.name,
            title: info.title,
            totalHours: Math.round(totalHours * 100) / 100,
            totalPay: Math.round(totalPay * 100) / 100,
            approved: u.approvedState === 'approved',
            dailyBreakdown,
            shifts: shiftDetails,
          })
        }
      }

      employeeReports.sort((a, b) => b.totalHours - a.totalHours)

      setReport({
        period: { start, end },
        employees: employeeReports,
        generated: new Date().toLocaleString(),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Set your API key on the Dashboard first.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Weekly Reports</h1>
          {report && (
            <p className="text-sm text-gray-500 mt-1">
              {report.period.start} to {report.period.end} &middot; Generated {report.generated}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={weeks}
            onChange={e => setWeeks(Number(e.target.value))}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={1}>Last week</option>
            <option value={2}>Last 2 weeks</option>
            <option value={4}>Last 4 weeks</option>
          </select>
          <button
            onClick={loadReport}
            disabled={loading}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}

      {loading && !report && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {report && report.employees.map(emp => (
        <div key={emp.name} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">{emp.name}</h3>
              {emp.title && <p className="text-xs text-gray-500">{emp.title}</p>}
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-400">{emp.totalHours}h</span>
              <span className="text-green-400">${emp.totalPay.toLocaleString()}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${emp.approved ? 'bg-green-900/40 text-green-400' : 'bg-yellow-900/40 text-yellow-400'}`}>
                {emp.approved ? 'Approved' : 'Pending'}
              </span>
            </div>
          </div>

          {/* Shift details */}
          {emp.shifts.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wider">
                    <th className="px-5 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                    <th className="px-3 py-2 text-right">Miles</th>
                    <th className="px-3 py-2 text-left">Location</th>
                    <th className="px-5 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {emp.shifts.map((s, i) => (
                    <tr key={i} className="text-gray-300 hover:bg-gray-800/30">
                      <td className="px-5 py-2">{s.date}</td>
                      <td className="px-3 py-2">{s.start} - {s.end}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.hours}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.miles || '-'}</td>
                      <td className="px-3 py-2 text-gray-400 truncate max-w-48">{s.location || '-'}</td>
                      <td className="px-5 py-2 text-gray-500 truncate max-w-64">{s.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {emp.shifts.length === 0 && emp.dailyBreakdown.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wider">
                    <th className="px-5 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                    <th className="px-3 py-2 text-right">Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {emp.dailyBreakdown.map((d, i) => (
                    <tr key={i} className="text-gray-300 hover:bg-gray-800/30">
                      <td className="px-5 py-2">{d.date}</td>
                      <td className="px-3 py-2 text-right font-mono">{d.hours}</td>
                      <td className="px-3 py-2 text-right font-mono">${d.pay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
