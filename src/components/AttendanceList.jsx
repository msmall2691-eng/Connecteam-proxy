export default function AttendanceList({ issues }) {
  if (!issues || issues.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Attendance Issues</h2>
        <p className="text-sm text-gray-500">No issues found. All clear.</p>
      </div>
    )
  }

  const typeColors = {
    Rejected: 'bg-red-900/40 text-red-400',
    Late: 'bg-yellow-900/40 text-yellow-400',
    'No clock-in': 'bg-orange-900/40 text-orange-400',
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-3">Attendance Issues</h2>
      <div className="space-y-3">
        {issues.slice(0, 10).map((issue, i) => (
          <div key={i} className="flex items-start gap-3 text-sm">
            <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${typeColors[issue.type] || 'bg-gray-800 text-gray-400'}`}>
              {issue.type}
            </span>
            <div className="min-w-0">
              <p className="text-gray-300">{issue.employee}</p>
              <p className="text-xs text-gray-500">{issue.date} &middot; {issue.detail}</p>
            </div>
          </div>
        ))}
        {issues.length > 10 && (
          <p className="text-xs text-gray-500">+ {issues.length - 10} more issues</p>
        )}
      </div>
    </div>
  )
}
