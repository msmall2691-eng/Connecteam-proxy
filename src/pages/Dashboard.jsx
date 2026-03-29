import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey, setApiKey, fetchUsers, fetchTimesheets, fetchTimeActivities, fetchShifts, dateRangeWeeks } from '../lib/api'
import { getClients, getJobs, getConversations } from '../lib/store'
import MetricCard from '../components/MetricCard'
import EmployeeTable from '../components/EmployeeTable'
import AttendanceList from '../components/AttendanceList'

export default function Dashboard() {
  const [apiKey, setApiKeyState] = useState(getApiKey())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [weeks, setWeeks] = useState(2)
  const [crmStats, setCrmStats] = useState(null)

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
    loadCrmStats()
    if (apiKey) loadData()
  }, [apiKey, weeks])

  function loadCrmStats() {
    const clients = getClients()
    const jobs = getJobs()
    const convos = getConversations()
    setCrmStats({
      totalClients: clients.length,
      activeClients: clients.filter(c => c.status === 'active').length,
      leads: clients.filter(c => c.status === 'lead').length,
      prospects: clients.filter(c => c.status === 'prospect').length,
      totalJobs: jobs.length,
      scheduledJobs: jobs.filter(j => j.status === 'scheduled').length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      totalConvos: convos.length,
      recentConvos: convos.slice(0, 5),
      recentClients: clients.slice(0, 5),
      recentJobs: jobs.slice(0, 5),
    })
  }

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

      const tsUsers = timesheets.data?.users || []
      let totalHours = 0
      let totalPay = 0
      const employeeSummaries = []

      for (const u of tsUsers) {
        let hours = 0
        let pay = 0
        for (const dr of u.dailyRecords || []) {
          hours += (dr.totalTime || 0) / 3600
          for (const pi of dr.payItems || []) pay += pi.amount || 0
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

      let totalMiles = 0
      let totalShiftsWorked = 0
      const actUsers = activities.data?.timeActivitiesByUsers || []
      for (const u of actUsers) {
        for (const shift of u.shifts || []) {
          totalShiftsWorked++
          for (const att of shift.shiftAttachments || []) {
            if (att.attachment?.number) totalMiles += att.attachment.number
          }
        }
      }

      const scheduleShifts = shifts.data?.objects || []
      let scheduledCount = scheduleShifts.length
      let openShifts = 0
      let rejectedShifts = 0
      const attendanceIssues = []

      for (const s of scheduleShifts) {
        if (s.openShift && (s.openSpots || 0) > 0) openShifts++
        for (const a of s.assignees || []) {
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
          <p className="text-sm text-gray-400">Enter your API key to get started. You can still use the CRM features without it.</p>
          <input
            name="key"
            type="password"
            placeholder="API Key"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors">
            Connect
          </button>
          <Link to="/clients" className="block text-center text-sm text-gray-500 hover:text-gray-300 transition-colors">
            Skip for now &rarr; Go to CRM
          </Link>
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
            <p className="text-sm text-gray-500 mt-1">{data.period.start} to {data.period.end}</p>
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
          <button onClick={() => { loadData(); loadCrmStats() }} disabled={loading}
            className="px-4 py-1.5 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors disabled:opacity-50">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* CRM quick stats - always visible */}
      {crmStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Clients" value={crmStats.totalClients} sub={`${crmStats.activeClients} active, ${crmStats.leads} leads`} color="purple" />
          <MetricCard label="Jobs" value={crmStats.totalJobs} sub={`${crmStats.scheduledJobs} scheduled, ${crmStats.completedJobs} done`} color="blue" />
          <MetricCard label="Conversations" value={crmStats.totalConvos} sub="across all clients" />
          {data ? (
            <MetricCard label="Schedule" value={data.scheduledShifts} sub={`${data.openShifts} open, ${data.rejectedShifts} rejected`} color={data.openShifts > 0 ? 'yellow' : 'green'} />
          ) : (
            <MetricCard label="Prospects" value={crmStats.prospects} sub="in pipeline" color="green" />
          )}
        </div>
      )}

      {data && (
        <>
          {/* Connecteam metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <MetricCard label="Total Hours" value={data.totalHours.toLocaleString()} sub={`${data.employeeCount} employees`} />
            <MetricCard label="Total Pay" value={`$${data.totalPay.toLocaleString()}`} sub="gross wages" />
            <MetricCard label="Miles Logged" value={data.totalMiles.toLocaleString()} sub={`${data.totalShiftsWorked} shifts`} />
          </div>

          {/* Main panels */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <EmployeeTable employees={data.employees} />
            </div>
            <div className="space-y-6">
              <AttendanceList issues={data.attendanceIssues} />

              {/* Quick links */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-white mb-3">Quick Actions</h2>
                <div className="space-y-2">
                  <Link to="/clients" className="flex items-center gap-2 text-sm text-gray-400 hover:text-blue-400 transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Manage Clients
                  </Link>
                  <Link to="/communications" className="flex items-center gap-2 text-sm text-gray-400 hover:text-blue-400 transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> View Messages
                  </Link>
                  <Link to="/schedule" className="flex items-center gap-2 text-sm text-gray-400 hover:text-blue-400 transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> Schedule View
                  </Link>
                  <Link to="/reports" className="flex items-center gap-2 text-sm text-gray-400 hover:text-blue-400 transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" /> Generate Reports
                  </Link>
                </div>
              </div>

              {/* Recent CRM activity */}
              {crmStats && crmStats.recentClients.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-white mb-3">Recent Clients</h2>
                  <div className="space-y-2">
                    {crmStats.recentClients.map(c => (
                      <Link key={c.id} to={`/clients/${c.id}`} className="flex items-center justify-between text-sm hover:bg-gray-800/50 rounded px-1 py-0.5 -mx-1 transition-colors">
                        <span className="text-gray-300">{c.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          c.status === 'active' ? 'bg-green-900/40 text-green-400' :
                          c.status === 'lead' ? 'bg-blue-900/40 text-blue-400' :
                          'bg-gray-800 text-gray-400'
                        }`}>{c.status}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
