import { useState, useEffect } from 'react'
import { getApiKey, fetchUsers, fetchTimesheets, fetchTimeActivities, dateRangeWeeks } from '../lib/api'

const IRS_RATE = 0.70
const MILE_THRESHOLD = 35

export default function Payroll() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [payrollData, setPayrollData] = useState(null)
  const [weeks, setWeeks] = useState(2)
  const [mileRate, setMileRate] = useState(IRS_RATE)
  const [threshold, setThreshold] = useState(MILE_THRESHOLD)
  const [exporting, setExporting] = useState(false)
  const [squareStatus, setSquareStatus] = useState(null)

  const apiKey = getApiKey()

  useEffect(() => {
    if (apiKey) loadPayroll()
  }, [apiKey, weeks])

  async function loadPayroll() {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateRangeWeeks(weeks)
      const [users, timesheets, activities] = await Promise.all([
        fetchUsers(),
        fetchTimesheets(start, end),
        fetchTimeActivities(start, end),
      ])

      const tsUsers = timesheets.data?.users || []
      const actUsers = activities.data?.timeActivitiesByUsers || []

      // Build mileage by user
      const mileageByUser = {}
      for (const u of actUsers) {
        const shifts = u.shifts || []
        let totalMiles = 0
        let reimbursableMiles = 0

        // Group shifts by date
        const byDate = {}
        for (const s of shifts) {
          const date = s.startTime ? new Date(s.startTime * 1000).toISOString().split('T')[0] : 'unknown'
          if (!byDate[date]) byDate[date] = []
          byDate[date].push(s)
        }

        for (const [, dayShifts] of Object.entries(byDate)) {
          dayShifts.sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
          dayShifts.forEach((s, idx) => {
            let miles = 0
            for (const att of s.shiftAttachments || []) {
              if (att.attachment?.number) miles += att.attachment.number
            }
            totalMiles += miles

            if (idx === 0) {
              // First job: only miles over threshold
              if (miles > threshold) reimbursableMiles += miles - threshold
            } else {
              // Between jobs: all miles reimbursable
              reimbursableMiles += miles
            }
          })
        }

        mileageByUser[u.userId] = {
          totalMiles: Math.round(totalMiles * 100) / 100,
          reimbursableMiles: Math.round(reimbursableMiles * 100) / 100,
          reimbursement: Math.round(reimbursableMiles * mileRate * 100) / 100,
        }
      }

      // Build employee payroll
      const employees = []
      let grandHours = 0, grandPay = 0, grandReimbursement = 0

      for (const u of tsUsers) {
        const info = users[u.userId] || { name: `User ${u.userId}` }
        let hours = 0, pay = 0
        for (const dr of u.dailyRecords || []) {
          hours += (dr.totalTime || 0) / 3600
          for (const pi of dr.payItems || []) pay += pi.amount || 0
        }

        if (hours <= 0) continue

        const mileage = mileageByUser[u.userId] || { totalMiles: 0, reimbursableMiles: 0, reimbursement: 0 }
        const rate = hours > 0 ? pay / hours : 0
        const totalComp = pay + mileage.reimbursement

        grandHours += hours
        grandPay += pay
        grandReimbursement += mileage.reimbursement

        employees.push({
          id: u.userId,
          name: info.name,
          title: info.title,
          hours: Math.round(hours * 100) / 100,
          rate: Math.round(rate * 100) / 100,
          pay: Math.round(pay * 100) / 100,
          totalMiles: mileage.totalMiles,
          reimbursableMiles: mileage.reimbursableMiles,
          mileageReimbursement: mileage.reimbursement,
          totalComp: Math.round(totalComp * 100) / 100,
          approved: u.approvedState === 'approved',
        })
      }

      employees.sort((a, b) => b.hours - a.hours)

      setPayrollData({
        period: { start, end },
        employees,
        totals: {
          hours: Math.round(grandHours * 100) / 100,
          pay: Math.round(grandPay * 100) / 100,
          reimbursement: Math.round(grandReimbursement * 100) / 100,
          totalComp: Math.round((grandPay + grandReimbursement) * 100) / 100,
        },
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function exportToSquare() {
    if (!payrollData) return
    setExporting(true)
    try {
      const res = await fetch('/api/square-payroll?action=export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employees: payrollData.employees }),
      })

      if (res.ok) {
        // Download CSV
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `payroll-${payrollData.period.start}-${payrollData.period.end}.csv`
        a.click()
        URL.revokeObjectURL(url)
        setSquareStatus({ type: 'success', message: 'CSV downloaded! Upload to Square Payroll.' })
      } else {
        const err = await res.json()
        setSquareStatus({ type: 'error', message: err.error || 'Export failed' })
      }
    } catch (err) {
      setSquareStatus({ type: 'error', message: err.message })
    } finally {
      setExporting(false)
      setTimeout(() => setSquareStatus(null), 5000)
    }
  }

  async function checkSquareTeam() {
    try {
      const res = await fetch('/api/square-payroll?action=team')
      const data = await res.json()
      if (data.members) {
        setSquareStatus({ type: 'success', message: `Connected! ${data.members.length} team members in Square.` })
      } else {
        setSquareStatus({ type: 'error', message: data.error || 'Could not connect to Square' })
      }
    } catch (err) {
      setSquareStatus({ type: 'error', message: 'Square not configured. Add SQUARE_ACCESS_TOKEN to Vercel env.' })
    }
    setTimeout(() => setSquareStatus(null), 5000)
  }

  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Set your Connecteam API key on the Dashboard first.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Payroll</h1>
          {payrollData && (
            <p className="text-sm text-gray-500 mt-1">
              {payrollData.period.start} to {payrollData.period.end}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select value={weeks} onChange={e => setWeeks(Number(e.target.value))}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value={1}>Last week</option>
            <option value={2}>Last 2 weeks</option>
            <option value={4}>Last 4 weeks</option>
          </select>
          <button onClick={loadPayroll} disabled={loading}
            className="px-4 py-1.5 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors disabled:opacity-50">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>}
      {squareStatus && (
        <div className={`p-4 rounded-lg text-sm ${squareStatus.type === 'success' ? 'bg-green-900/30 border border-green-800 text-green-300' : 'bg-red-900/30 border border-red-800 text-red-300'}`}>
          {squareStatus.message}
        </div>
      )}

      {loading && !payrollData && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Settings */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Mileage Settings</h2>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">IRS Rate ($/mi)</label>
            <input type="number" step="0.01" value={mileRate} onChange={e => setMileRate(parseFloat(e.target.value) || 0)}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white text-right" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Threshold (mi)</label>
            <input type="number" value={threshold} onChange={e => setThreshold(parseInt(e.target.value) || 0)}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white text-right" />
          </div>
          <button onClick={loadPayroll} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white">Recalculate</button>
        </div>
        <p className="text-xs text-gray-600 mt-2">First job: reimburse miles over {threshold}mi. Between jobs: all miles at ${mileRate}/mi.</p>
      </div>

      {payrollData && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase">Total Hours</p>
              <p className="text-xl font-bold text-blue-400">{payrollData.totals.hours}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase">Gross Pay</p>
              <p className="text-xl font-bold text-green-400">${payrollData.totals.pay.toLocaleString()}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase">Mileage Reimb.</p>
              <p className="text-xl font-bold text-yellow-400">${payrollData.totals.reimbursement.toLocaleString()}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase">Total Comp</p>
              <p className="text-xl font-bold text-white">${payrollData.totals.totalComp.toLocaleString()}</p>
            </div>
          </div>

          {/* Payroll table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Employee Payroll</h2>
              <div className="flex gap-2">
                <button onClick={checkSquareTeam}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors">
                  Check Square
                </button>
                <button onClick={exportToSquare} disabled={exporting}
                  className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg text-xs text-white transition-colors disabled:opacity-50">
                  {exporting ? 'Exporting...' : 'Export to Square CSV'}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                    <th className="px-5 py-2.5 text-left">Employee</th>
                    <th className="px-3 py-2.5 text-right">Hours</th>
                    <th className="px-3 py-2.5 text-right">Rate</th>
                    <th className="px-3 py-2.5 text-right">Pay</th>
                    <th className="px-3 py-2.5 text-right">Total Mi</th>
                    <th className="px-3 py-2.5 text-right">Reimb. Mi</th>
                    <th className="px-3 py-2.5 text-right">Reimb. $</th>
                    <th className="px-3 py-2.5 text-right">Total Comp</th>
                    <th className="px-5 py-2.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {payrollData.employees.map(emp => (
                    <tr key={emp.id} className="text-gray-300 hover:bg-gray-800/30">
                      <td className="px-5 py-2.5">
                        <div className="text-white font-medium">{emp.name}</div>
                        {emp.title && <div className="text-xs text-gray-500">{emp.title}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{emp.hours}</td>
                      <td className="px-3 py-2.5 text-right font-mono">${emp.rate}</td>
                      <td className="px-3 py-2.5 text-right font-mono">${emp.pay.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{emp.totalMiles}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{emp.reimbursableMiles}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-yellow-400">${emp.mileageReimbursement}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-white">${emp.totalComp.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${emp.approved ? 'bg-green-900/40 text-green-400' : 'bg-yellow-900/40 text-yellow-400'}`}>
                          {emp.approved ? 'Approved' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-700 text-white font-semibold">
                    <td className="px-5 py-3">Totals</td>
                    <td className="px-3 py-3 text-right font-mono">{payrollData.totals.hours}</td>
                    <td className="px-3 py-3"></td>
                    <td className="px-3 py-3 text-right font-mono">${payrollData.totals.pay.toLocaleString()}</td>
                    <td className="px-3 py-3" colSpan={2}></td>
                    <td className="px-3 py-3 text-right font-mono text-yellow-400">${payrollData.totals.reimbursement.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right font-mono">${payrollData.totals.totalComp.toLocaleString()}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Unapproved warning */}
          {payrollData.employees.some(e => !e.approved) && (
            <div className="p-4 bg-yellow-900/20 border border-yellow-800 rounded-lg text-sm text-yellow-300">
              Some timesheets are not approved yet. Approve in Connecteam before processing payroll.
            </div>
          )}
        </>
      )}
    </div>
  )
}
