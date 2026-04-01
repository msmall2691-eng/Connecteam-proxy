import { useState, useEffect } from 'react'
import { usePortalAuth } from '../../lib/portalAuth'

const STATUS_COLORS = {
  scheduled: { bg: 'bg-blue-900/40', text: 'text-blue-400', dot: 'bg-blue-400' },
  'in-progress': { bg: 'bg-yellow-900/40', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  completed: { bg: 'bg-green-900/40', text: 'text-green-400', dot: 'bg-green-400' },
  cancelled: { bg: 'bg-red-900/40', text: 'text-red-400', dot: 'bg-red-400' },
}

export default function PortalSchedule() {
  const { portalFetch } = usePortalAuth()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedJob, setSelectedJob] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await portalFetch('/api/portal?action=schedule')
        if (!res.ok) throw new Error('Failed to load schedule')
        const data = await res.json()
        setJobs(data.jobs || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [portalFetch])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  // Group jobs by month
  const grouped = {}
  jobs.forEach(job => {
    const month = job.date ? new Date(job.date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : 'Unscheduled'
    if (!grouped[month]) grouped[month] = []
    grouped[month].push(job)
  })

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Schedule</h1>
        <p className="text-sm text-gray-500 mt-1">Your upcoming and past visits</p>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-4">
        {Object.entries(STATUS_COLORS).map(([status, colors]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
            <span className="text-xs text-gray-400 capitalize">{status}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}

      {jobs.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75" />
          </svg>
          <p className="text-gray-500">No scheduled visits</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([month, monthJobs]) => (
            <div key={month}>
              <h2 className="text-sm font-semibold text-gray-400 mb-3">{month}</h2>
              <div className="space-y-2">
                {monthJobs.map(job => {
                  const colors = STATUS_COLORS[job.status] || STATUS_COLORS.scheduled
                  return (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
                      className="w-full text-left bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors.dot}`} />
                          <div>
                            <p className="text-sm text-white font-medium">
                              {job.title || job.serviceType || 'Cleaning Service'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatDate(job.date)}
                              {job.startTime ? ` at ${job.startTime}` : ''}
                            </p>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}>
                          {job.status}
                        </span>
                      </div>

                      {selectedJob?.id === job.id && (
                        <div className="mt-3 pt-3 border-t border-gray-800 space-y-2 text-sm text-gray-400">
                          {job.address && (
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 shrink-0">Address:</span>
                              <span>{job.address}</span>
                            </div>
                          )}
                          {job.startTime && (
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 shrink-0">Time:</span>
                              <span>{job.startTime}{job.endTime ? ` - ${job.endTime}` : ''}</span>
                            </div>
                          )}
                          {job.serviceType && (
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 shrink-0">Service:</span>
                              <span>{job.serviceType}</span>
                            </div>
                          )}
                          {job.notes && (
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 shrink-0">Notes:</span>
                              <span>{job.notes}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
