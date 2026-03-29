export default function EmployeeTable({ employees }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white">Employee Breakdown</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-5 py-2.5 text-left">Employee</th>
              <th className="px-3 py-2.5 text-right">Hours</th>
              <th className="px-3 py-2.5 text-right">Pay</th>
              <th className="px-5 py-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {employees.map(emp => (
              <tr key={emp.id} className="text-gray-300 hover:bg-gray-800/30 transition-colors">
                <td className="px-5 py-2.5">
                  <div className="font-medium text-white">{emp.name}</div>
                  {emp.title && <div className="text-xs text-gray-500">{emp.title}</div>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{emp.hours}</td>
                <td className="px-3 py-2.5 text-right font-mono">${emp.pay.toLocaleString()}</td>
                <td className="px-5 py-2.5 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    emp.approved ? 'bg-green-900/40 text-green-400' : 'bg-yellow-900/40 text-yellow-400'
                  }`}>
                    {emp.approved ? 'Approved' : 'Pending'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
