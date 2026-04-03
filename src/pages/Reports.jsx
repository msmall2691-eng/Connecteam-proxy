import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey, fetchUsers, fetchTimesheets, fetchTimeActivities, fetchShifts, dateRangeWeeks } from '../lib/api'

const PRESETS = [
  {
    id: 'weekly-rundown',
    label: 'Weekly Rundown',
    icon: '📋',
    desc: 'Hours, pay, and mileage for each employee this period',
    prompt: 'Give me a complete weekly rundown. For each employee, show their total hours, pay, and mileage. Flag anything unusual — unapproved timesheets, very short shifts, high mileage. End with a summary of totals.',
    weeks: 1,
  },
  {
    id: 'payroll-prep',
    label: 'Payroll Prep',
    icon: '💰',
    desc: 'Ready-to-process payroll with mileage reimbursement',
    prompt: 'Prepare a payroll summary. For each employee show hours worked, hourly rate, gross pay, total miles, reimbursable miles (over 35mi threshold to first job + all between-job miles), mileage reimbursement at $0.70/mi, and total compensation. Flag any unapproved timesheets that need attention before processing. End with totals.',
    weeks: 2,
  },
  {
    id: 'attendance',
    label: 'Attendance Check',
    icon: '⏰',
    desc: 'Who showed up, who was late, missed shifts',
    prompt: 'Give me an attendance report. Compare scheduled shifts to actual clock-ins. Flag: late arrivals (>10 min), early leaves (>15 min early), no-shows (scheduled but no clock-in), rejected shifts and why. Show an attendance score for each employee.',
    weeks: 1,
  },
  {
    id: 'client-jobs',
    label: 'Client Job History',
    icon: '🏠',
    desc: 'Which locations were serviced and by whom',
    prompt: 'Show me a client/location job history. Group by location/address. For each location show: how many times it was cleaned, which employees worked there, total hours, and any employee notes. Sort by most-serviced locations first.',
    weeks: 2,
  },
  {
    id: 'mileage',
    label: 'Mileage Report',
    icon: '🚗',
    desc: 'Miles driven per employee with reimbursement calc',
    prompt: 'Generate a detailed mileage report. For each employee show total miles, reimbursable miles (miles over 35 to first job + all between-job miles), and reimbursement at $0.70/mi. Flag any suspiciously high mileage entries (>200 mi per shift). Show daily breakdown.',
    weeks: 2,
  },
  {
    id: 'issues',
    label: 'Issues & Flags',
    icon: '🚩',
    desc: 'Data problems, unapproved timesheets, anomalies',
    prompt: 'Audit the data and find all issues. Look for: unapproved/unsubmitted timesheets, very short clock-ins (<3 min), mileage over 1000 mi (data entry error), shifts with no location, missing pay data, schedule gaps. Be thorough and categorize by severity.',
    weeks: 2,
  },
]

export default function Reports() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)
  const [weeks, setWeeks] = useState(2)
  const [useCustomDates, setUseCustomDates] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [activePreset, setActivePreset] = useState(null)
  const [rawData, setRawData] = useState(null)
  const [step, setStep] = useState('choose') // 'choose', 'loading', 'prompt', 'report'

  const apiKey = getApiKey()

  async function pullData(numWeeks) {
    setStep('loading')
    setLoading(true)
    setError(null)
    try {
      let start, end
      if (useCustomDates && startDate && endDate) {
        start = startDate
        end = endDate
      } else {
        const range = dateRangeWeeks(numWeeks || weeks)
        start = range.start
        end = range.end
      }

      const users = await fetchUsers()
      const timesheets = await fetchTimesheets(start, end)
      const activities = await fetchTimeActivities(start, end)

      let shifts = null
      try {
        shifts = await fetchShifts(start, end)
      } catch {
        // Schedule data is optional
      }

      setRawData({ users, timesheets, activities, shifts, period: { start, end } })
      setStep('prompt')
    } catch (err) {
      setError(err.message)
      setStep('choose')
    } finally {
      setLoading(false)
    }
  }

  function buildDataContext() {
    if (!rawData) return ''

    const { users, timesheets, activities, shifts, period } = rawData
    const lines = [`Period: ${period.start} to ${period.end}`, '']

    // Timesheet data
    const tsUsers = timesheets.data?.users || []
    lines.push('=== TIMESHEET DATA ===')
    for (const u of tsUsers) {
      const info = users[u.userId] || { name: `User ${u.userId}` }
      let hours = 0, pay = 0
      const dailyDetails = []
      for (const dr of u.dailyRecords || []) {
        const dayHours = (dr.totalTime || 0) / 3600
        let dayPay = 0
        for (const pi of dr.payItems || []) dayPay += pi.amount || 0
        hours += dayHours
        pay += dayPay
        if (dayHours > 0) {
          dailyDetails.push(`  ${dr.date}: ${dayHours.toFixed(1)}h, $${dayPay.toFixed(2)}`)
        }
      }
      if (hours > 0) {
        lines.push(`\nEmployee: ${info.name} (${info.title || 'no title'})`)
        lines.push(`Total: ${hours.toFixed(1)}h, $${pay.toFixed(2)}, Approved: ${u.approvedState || 'unknown'}, Submitted: ${u.submittedState || 'unknown'}`)
        lines.push(...dailyDetails)
      }
    }

    // Activity/shift data with mileage reimbursement
    const MILEAGE_THRESHOLD = 35
    const IRS_RATE = 0.70
    const actUsers = activities.data?.timeActivitiesByUsers || []
    lines.push('\n=== SHIFT DETAILS (clock in/out, mileage, locations) ===')
    lines.push(`Mileage rules: reimburse miles over ${MILEAGE_THRESHOLD} to first job of day + all between-job miles at $${IRS_RATE.toFixed(2)}/mi`)
    for (const u of actUsers) {
      const info = users[u.userId] || { name: `User ${u.userId}` }
      const userShifts = u.shifts || []
      if (userShifts.length === 0) continue

      // Group shifts by date for mileage calculation
      const byDate = {}
      for (const s of userShifts) {
        const ts = s.start?.timestamp || s.startTime
        if (!ts) continue
        const dateKey = new Date(ts * 1000).toLocaleDateString()
        if (!byDate[dateKey]) byDate[dateKey] = []
        byDate[dateKey].push(s)
      }

      let totalMiles = 0, totalReimbursable = 0
      lines.push(`\nEmployee: ${info.name}`)
      for (const [dateKey, dayShifts] of Object.entries(byDate)) {
        dayShifts.sort((a, b) => (a.start?.timestamp || a.startTime || 0) - (b.start?.timestamp || b.startTime || 0))
        for (let i = 0; i < dayShifts.length; i++) {
          const s = dayShifts[i]
          const startTs = s.start?.timestamp || s.startTime
          const endTs = s.end?.timestamp || s.endTime
          const startDt = startTs ? new Date(startTs * 1000) : null
          const endDt = endTs ? new Date(endTs * 1000) : null
          const hours = startTs && endTs ? ((endTs - startTs) / 3600).toFixed(1) : '?'
          let miles = 0
          for (const att of s.shiftAttachments || []) {
            if (att.attachment?.number) miles += att.attachment.number
          }
          const loc = s.start?.locationData?.address?.split(',')[0] || s.startPoint?.address?.split(',')[0] || 'no location'
          const note = s.employeeNote?.trim() || [s.startNote, s.endNote].filter(Boolean).join(' | ')

          // Calculate reimbursable miles
          let reimbursable = 0
          const isFirstJob = i === 0
          if (miles > 0) {
            if (isFirstJob) {
              reimbursable = miles > MILEAGE_THRESHOLD ? miles - MILEAGE_THRESHOLD : 0
            } else {
              reimbursable = miles // between-job miles fully reimbursable
            }
          }
          totalMiles += miles
          totalReimbursable += reimbursable

          const marker = isFirstJob ? '(to job)' : '(between)'
          lines.push(`  ${startDt?.toLocaleDateString() || '?'} ${startDt?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || ''}-${endDt?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || ''} | ${hours}h | ${miles}mi ${marker} | reimb: ${reimbursable.toFixed(1)}mi | ${loc}${note ? ` | Notes: ${note}` : ''}`)
        }
      }
      const reimbursement = totalReimbursable * IRS_RATE
      lines.push(`  MILEAGE TOTALS: ${totalMiles.toFixed(1)} reported, ${totalReimbursable.toFixed(1)} reimbursable, $${reimbursement.toFixed(2)} reimbursement`)
    }

    // Schedule data
    if (shifts?.data?.objects?.length) {
      lines.push('\n=== SCHEDULE DATA ===')
      for (const s of shifts.data.objects) {
        const start = new Date(s.startTime * 1000)
        const end = new Date(s.endTime * 1000)
        const assignees = (s.assignees || []).map(a => {
          const name = users[a.userId]?.name || `User ${a.userId}`
          return `${name} (${a.status || 'unknown'}${a.rejectionReason ? `: ${a.rejectionReason}` : ''})`
        }).join(', ')
        const isOpen = s.openShift ? ` [OPEN - ${s.openSpots || 0} spots]` : ''
        lines.push(`${start.toLocaleDateString()} ${start.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}-${end.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} | ${s.title || 'Shift'}${isOpen} | ${assignees || 'unassigned'}`)
      }
    }

    return lines.join('\n')
  }

  async function generateReport(prompt) {
    setStep('report')
    setLoading(true)
    setError(null)
    try {
      const context = buildDataContext()

      // Try Claude API
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          context,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setReport({ content: data.content, prompt, generated: new Date().toLocaleString() })
      } else {
        // Fallback: show raw data summary
        setReport({
          content: `_Claude AI not configured. Add ANTHROPIC_API_KEY to Vercel env vars for AI-generated reports._\n\n**Raw Data Summary:**\n\n\`\`\`\n${context.slice(0, 3000)}\n\`\`\``,
          prompt,
          generated: new Date().toLocaleString(),
        })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handlePreset(preset) {
    setActivePreset(preset)
    setCustomPrompt(preset.prompt)
    setWeeks(preset.weeks)
    pullData(preset.weeks)
  }

  function handleCustom() {
    if (!customPrompt.trim()) return
    generateReport(customPrompt)
  }

  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <p className="text-gray-500">Set your Connecteam API key on the Dashboard first.</p>
          <Link to="/" className="text-sm text-blue-400 hover:text-blue-300">Go to Dashboard</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Pull Connecteam data and generate reports with AI</p>
        </div>
        {step !== 'choose' && (
          <button onClick={() => { setStep('choose'); setReport(null); setRawData(null); setActivePreset(null) }}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
            &larr; Start Over
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}

      {/* Step 1: Choose report type */}
      {step === 'choose' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PRESETS.map(preset => (
              <button key={preset.id} onClick={() => handlePreset(preset)}
                className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-left hover:border-blue-800/50 transition-colors group">
                <div className="text-2xl mb-2">{preset.icon}</div>
                <h3 className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors">{preset.label}</h3>
                <p className="text-xs text-gray-500 mt-1">{preset.desc}</p>
              </button>
            ))}
          </div>

          <div className="text-center text-xs text-gray-600 uppercase tracking-wider">or</div>

          {/* Custom prompt */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Custom Report</h3>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <label className="text-xs text-gray-500">Period:</label>
              {!useCustomDates ? (
                <>
                  <select value={weeks} onChange={e => setWeeks(Number(e.target.value))}
                    className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value={1}>Last week</option>
                    <option value={2}>Last 2 weeks</option>
                    <option value={4}>Last 4 weeks</option>
                    <option value={8}>Last 8 weeks</option>
                  </select>
                  <button onClick={() => setUseCustomDates(true)}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                    Pick dates instead
                  </button>
                </>
              ) : (
                <>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="text-xs text-gray-500">to</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button onClick={() => setUseCustomDates(false)}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                    Use presets instead
                  </button>
                </>
              )}
            </div>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="What do you want to know? e.g. 'Compare this week's hours to last week' or 'Which employee drove the most and where did they go?' or 'Give me a report I can send to my accountant'..."
              rows={4}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <button onClick={() => pullData()} disabled={!customPrompt.trim() || (useCustomDates && (!startDate || !endDate))}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors">
              Pull Data & Generate
            </button>
          </div>
        </>
      )}

      {/* Step 2: Loading data */}
      {step === 'loading' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
          <div>
            <p className="text-sm text-white">Pulling data from Connecteam...</p>
            <p className="text-xs text-gray-500 mt-1">This takes ~10 seconds (rate limited API)</p>
          </div>
        </div>
      )}

      {/* Step 3: Refine prompt before generating */}
      {step === 'prompt' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="px-2 py-0.5 bg-green-900/40 text-green-400 rounded text-xs font-medium">Data loaded</span>
            <span className="text-xs text-gray-500">{rawData?.period.start} to {rawData?.period.end}</span>
            <button onClick={() => { setStep('choose'); setRawData(null) }}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              Change dates
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Your prompt</label>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <p className="text-xs text-gray-600 mt-1">Edit the prompt if you want, or hit generate.</p>
          </div>

          {/* Quick modifier buttons */}
          <div className="flex flex-wrap gap-2">
            {[
              'Add a summary table at the end',
              'Format it for email to send to my team',
              'Include recommendations',
              'Keep it brief, bullet points only',
              'Flag anything I should worry about',
            ].map(mod => (
              <button key={mod} onClick={() => setCustomPrompt(prev => prev + '\n' + mod)}
                className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400 hover:text-gray-200 transition-colors">
                + {mod}
              </button>
            ))}
          </div>

          <button onClick={handleCustom} disabled={loading || !customPrompt.trim()}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors">
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
      )}

      {/* Step 4: Generated report */}
      {step === 'report' && loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto" />
          <div>
            <p className="text-sm text-white">Claude is writing your report...</p>
            <p className="text-xs text-gray-500 mt-1">Analyzing your Connecteam data</p>
          </div>
        </div>
      )}

      {step === 'report' && report && !loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 bg-purple-900/30 text-purple-400 rounded text-xs font-medium">AI Generated</span>
              <span className="text-xs text-gray-500">{report.generated}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('prompt')} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">
                Regenerate
              </button>
              <button onClick={() => {
                navigator.clipboard.writeText(report.content)
              }} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">
                Copy
              </button>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="prose prose-invert prose-sm max-w-none text-gray-300 whitespace-pre-wrap leading-relaxed">
              {report.content.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>
                }
                return part
              })}
            </div>
          </div>

          {/* Used prompt */}
          <details className="text-xs">
            <summary className="text-gray-600 cursor-pointer hover:text-gray-400">View prompt used</summary>
            <pre className="mt-2 p-3 bg-gray-900 border border-gray-800 rounded-lg text-gray-500 whitespace-pre-wrap">{report.prompt}</pre>
          </details>
        </div>
      )}
    </div>
  )
}
