// Vercel serverless: Square Payroll integration
// Requires SQUARE_ACCESS_TOKEN in env
// Square API: https://developer.squareup.com/reference/square/team-api

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN
  const SQUARE_BASE = process.env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'

  if (!SQUARE_TOKEN) {
    return res.status(500).json({ error: 'Square not configured. Set SQUARE_ACCESS_TOKEN in Vercel env.' })
  }

  const action = req.query.action || req.body?.action
  const headers = {
    Authorization: `Bearer ${SQUARE_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-01-18',
  }

  try {
    // ── LIST TEAM MEMBERS ──
    if (action === 'team') {
      const teamRes = await fetch(`${SQUARE_BASE}/v2/team-members/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: { filter: { status: { members: ['ACTIVE'] } } } }),
      })
      const teamData = await teamRes.json()
      const members = (teamData.team_members || []).map(m => ({
        id: m.id,
        name: `${m.given_name || ''} ${m.family_name || ''}`.trim(),
        email: m.email_address,
        phone: m.phone_number,
        status: m.status,
      }))
      return res.status(200).json({ members })
    }

    // ── GET PAYROLL (via Team Member Wages) ──
    if (action === 'wages') {
      // List wages/pay rates for team members
      const wageRes = await fetch(`${SQUARE_BASE}/v2/labor/team-member-wages`, { headers })
      const wageData = await wageRes.json()
      return res.status(200).json(wageData)
    }

    // ── EXPORT PAYROLL CSV ──
    // This generates a CSV that can be uploaded to Square Payroll
    if (action === 'export' && req.method === 'POST') {
      const { employees } = req.body
      if (!employees || !Array.isArray(employees)) {
        return res.status(400).json({ error: 'employees array required' })
      }

      // Generate Square Payroll CSV format
      const csvLines = ['Employee Name,Hours Worked,Hourly Rate,Gross Pay,Mileage Reimbursement,Total Compensation']
      for (const emp of employees) {
        csvLines.push([
          `"${emp.name}"`,
          emp.hours,
          emp.rate || '',
          emp.pay,
          emp.mileageReimbursement || 0,
          emp.totalComp || emp.pay,
        ].join(','))
      }

      const csv = csvLines.join('\n')
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="payroll-export-${new Date().toISOString().split('T')[0]}.csv"`)
      return res.status(200).send(csv)
    }

    // ── CREATE PAYROLL ADJUSTMENT (bonus/reimbursement) ──
    if (action === 'adjustment' && req.method === 'POST') {
      // Note: Square Payroll API for pay runs requires specific Square Payroll subscription
      // This endpoint prepares the data; actual submission may need manual upload
      const { teamMemberId, amount, description } = req.body

      return res.status(200).json({
        note: 'Square Payroll API requires specific subscription for automated pay runs. Use the CSV export to import into Square Payroll, or submit adjustments manually.',
        prepared: {
          teamMemberId,
          amount,
          description,
          date: new Date().toISOString().split('T')[0],
        },
      })
    }

    return res.status(400).json({ error: 'Unknown action. Use: team, wages, export, adjustment' })
  } catch (err) {
    console.error('Square handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
