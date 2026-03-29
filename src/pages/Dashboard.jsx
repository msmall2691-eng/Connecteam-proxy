import { useState, useEffect } from 'react'
import { getApiKey, setApiKey, fetchUsers, fetchTimesheets, fetchTimeActivities, fetchShifts, dateRangeWeeks } from '../lib/api'
import MetricCard from '../components/MetricCard'
import EmployeeTable from '../components/EmployeeTable'
import AttendanceList from '../components/AttendanceList'

export default function Dashboard() {
  const [apiKey, setApiKeyState] = useState(getApiKey())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [weeks, setWeeks] = useState(2)

  const needsKey = !apiKey

  function saveKey(e) {
    e.preventDefault()
    const key = e.target.elements.key.value.trim()
    if (key) {
      setApiKey(key)
      setApiKeyState(key)
    }
  }

  useEffect(() => {
    if (!apiKey) return
    loadData()
  }, [apiKey, weeks])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateRangeWeeks(weeks)
      const [users, timesheets, activities, shifts] = await Promise.all([
        fetchUsers(),
        fetchTimesheets(start, end),
        fetchTimeActivities(start, end),
        fetchShifts(start, end),
      ])

      // Process timesheet data
      const tsUsers = timesheets.data?.users || []
      let totalHours = 0
      let totalPay = 0
      const employeeSummaries = []

      for (const u of tsUsers) {
        let hours = 0
        let pay = 0
        for (const dr of u.dailyRecords || []) {
          hours += (dr.totalTime || 0) / 3600
          for (const pi of dr.payItems || []) {
            pay += (pi.amount || 0)
          }
        }
        totalHours += hours
        totalPay += pay
        const info = users[u.userId] || { name: `User ${u.userId}`, title: '' }
        if (hours > 0) {
          employeeSummaries.push({
            id: u.userId,
            name: info.name,
            title: info.title,
            hours: Math.round(hours * 100) / 100,
            pay: Math.round(pay * 100) / 100,
            approved: u.approvedState === 'approved',
            submitted: u.submittedState === 'submitted',
          })
        }
      }

      // Process activities for mileage
      let totalMiles = 0
      let totalShiftsWorked = 0
      const actUsers = activities.data?.timeActivitiesByUsers || []
      for (const u of actUsers) {
        for (const shift of u.shifts || []) {
          totalShiftsWorked++
          for (const att of shift.shiftAttachments || []) {
            if (att.attachment?.number) {
              totalMiles += att.attachment.number
            }
          }
        }
      }

      // Process schedule shifts
      const scheduleShifts = shifts.data?.objects || []
      let scheduledCount = scheduleShifts.length
      let openShifts = 0
      let rejectedShifts = 0
      const attendanceIssues = []

      for (const s of scheduleShifts) {
        if (s.openShift && (s.openSpots || 0) > 0) openShifts++
        const assignees = s.assignees || []
        for (const a of assignees) {
          if (a.status === 'rejected') {
            rejectedShifts++
            attendanceIssues.push({
              type: 'Rejected',
              employee: users[a.userId]?.name || `User ${a.userId}`,
              detail: a.rejectionReason || 'No reason given',
              date: new Date(s.startTime * 1000).toLocaleDateString(),
            })
          }
        }
      }

      employeeSummaries.sort((a, b) => b.hours - a.hours)

      setData({
        totalHours: Math.round(totalHours * 100) / 100,
        totalPay: Math.round(totalPay * 100) / 100,
        totalMiles: Math.round(totalMiles * 100) / 100,
        totalShiftsWorked,
        employeeCount: employeeSummaries.length,
        scheduledShifts: scheduledCount,
        openShifts,
        rejectedShifts,
        employees: employeeSummaries,
        attendanceIssues,
        period: { start, end },
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (needsKey) {
    return (
      <div className="flex items-center justify-center h-full">
        <form onSubmit={saveKey} className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-96 space-y-4">
          <h2 className="text-lg font-semibold text-white">Connect to Connecteam</h2>
          <p className="text-sm text-gray-400">Enter your API key to get started.</p>
          <input
            name="key"
            type="password"
            placeholder="API Key"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors"
          >
            Connect
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          {data && (
            <p className="text-sm text-gray-500 mt-1">
              {data.period.start} to {data.period.end}
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
            <option value={8}>Last 8 weeks</option>
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-1.5 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {data && (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Hours" value={data.totalHours.toLocaleString()} sub={`${data.employeeCount} employees`} />
            <MetricCard label="Total Pay" value={`$${data.totalPay.toLocaleString()}`} sub="gross wages" />
            <MetricCard label="Miles Logged" value={data.totalMiles.toLocaleString()} sub={`${data.totalShiftsWorked} shifts`} />
            <MetricCard label="Schedule" value={data.scheduledShifts} sub={`${data.openShifts} open, ${data.rejectedShifts} rejected`} color={data.openShifts > 0 ? 'yellow' : 'green'} />
          </div>

          {/* Employee breakdown */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <EmployeeTable employees={data.employees} />
            </div>
            <div>
              <AttendanceList issues={data.attendanceIssues} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
