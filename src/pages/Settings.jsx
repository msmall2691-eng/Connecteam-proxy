import { useState, useEffect } from 'react'
import { getApiKey, setApiKey } from '../lib/api'
import { isSupabaseConfigured } from '../lib/supabase'
import { exportData, importData } from '../lib/store'

const SETTINGS_KEY = 'workflowhq_settings'

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {} }
  catch { return {} }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

export default function Settings() {
  const [settings, setSettings] = useState(loadSettings())
  const [saved, setSaved] = useState(null)
  const [testResults, setTestResults] = useState({})

  // Client-side keys (stored in browser)
  const [connecteamKey, setConnecteamKey] = useState(getApiKey())

  // Server-side integration status
  const [integrations, setIntegrations] = useState({
    anthropic: null, gmail: null, twilio: null, square: null, calendar: null, supabase: isSupabaseConfigured(),
  })

  // Business settings
  const [company, setCompany] = useState(settings.company || {
    name: 'The Maine Cleaning & Property Management Co.',
    email: 'info@maine-clean.co',
    phone: '(207) 572-0502',
    address: '',
  })
  const [payroll, setPayroll] = useState(settings.payroll || {
    irsRate: 0.70, mileageThreshold: 35, payPeriod: 'biweekly',
  })
  const [invoice, setInvoice] = useState(settings.invoice || {
    defaultTaxRate: 0, defaultDueDays: 30, paymentInstructions: '', prefix: 'INV',
  })

  useEffect(() => { checkIntegrations() }, [])

  async function checkIntegrations() {
    const results = { supabase: isSupabaseConfigured() }

    const checks = [
      { key: 'anthropic', url: '/api/chat', method: 'POST', body: { messages: [{ role: 'user', content: 'ping' }], context: '' } },
      { key: 'gmail', url: '/api/gmail?action=profile' },
      { key: 'twilio', url: '/api/sms?action=list&limit=1' },
      { key: 'square', url: '/api/square-payroll?action=team' },
      { key: 'calendar', url: '/api/calendar?action=calendars' },
    ]

    for (const check of checks) {
      try {
        const opts = check.method === 'POST'
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(check.body) }
          : {}
        const res = await fetch(check.url, opts)
        results[check.key] = res.ok ? 'connected' : (res.status === 500 ? 'not configured' : 'error')
      } catch {
        results[check.key] = 'not configured'
      }
    }

    setIntegrations(results)
  }

  function handleSaveAll() {
    // Save business settings
    saveSettings({ company, payroll, invoice })
    // Save Connecteam key
    setApiKey(connecteamKey)
    setSaved('All settings saved!')
    setTimeout(() => setSaved(null), 3000)
  }

  function handleSaveConnecteam() {
    setApiKey(connecteamKey)
    setSaved('Connecteam API key saved!')
    setTimeout(() => setSaved(null), 3000)
  }

  function handleClearConnecteam() {
    setApiKey('')
    setConnecteamKey('')
    setSaved('Connecteam key cleared.')
    setTimeout(() => setSaved(null), 3000)
  }

  async function testEndpoint(name, url, opts) {
    setTestResults(prev => ({ ...prev, [name]: { status: 'testing', message: 'Testing...' } }))
    try {
      const res = await fetch(url, opts || {})
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setTestResults(prev => ({ ...prev, [name]: { status: 'ok', message: 'Connected!' } }))
        setIntegrations(prev => ({ ...prev, [name]: 'connected' }))
      } else {
        setTestResults(prev => ({ ...prev, [name]: { status: 'error', message: data.error || `Error ${res.status}` } }))
      }
    } catch (err) {
      setTestResults(prev => ({ ...prev, [name]: { status: 'error', message: err.message } }))
    }
  }

  function handleExport() {
    const data = exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `workflowhq-backup-${new Date().toISOString().split('T')[0]}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try { importData(JSON.parse(ev.target.result)); setSaved('Data imported!') }
      catch { setSaved('Import failed.') }
      setTimeout(() => setSaved(null), 3000)
    }
    reader.readAsText(file)
  }

  function StatusBadge({ status }) {
    const colors = {
      connected: 'bg-green-900/40 text-green-400',
      'not configured': 'bg-gray-800 text-gray-500',
      error: 'bg-red-900/40 text-red-400',
    }
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || colors['not configured']}`}>{status || 'checking...'}</span>
  }

  function TestResult({ name }) {
    const r = testResults[name]
    if (!r) return null
    return <span className={`text-xs ${r.status === 'ok' ? 'text-green-400' : r.status === 'testing' ? 'text-gray-400' : 'text-red-400'}`}>{r.message}</span>
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">API keys, integrations, and business settings</p>
      </div>

      {saved && <div className="p-3 bg-green-900/30 border border-green-800 rounded-lg text-sm text-green-300">{saved}</div>}

      {/* ── CONNECTEAM (client-side key) ── */}
      <Section title="Connecteam API Key" desc="Stored in your browser. Used for employee data, timesheets, scheduling.">
        <div className="flex gap-2 items-center">
          <input type="password" value={connecteamKey} onChange={e => setConnecteamKey(e.target.value)}
            placeholder="Paste your Connecteam API key"
            className="flex-1 max-w-md px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={handleSaveConnecteam} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">Save</button>
          <button onClick={() => testEndpoint('connecteam', `/api/connecteam?path=me`, { headers: { 'X-API-KEY': connecteamKey } })}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300">Test</button>
          {connecteamKey && (
            <button onClick={handleClearConnecteam} className="px-3 py-2 text-xs text-gray-500 hover:text-red-400">Clear</button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <StatusBadge status={connecteamKey ? 'connected' : 'not configured'} />
          <TestResult name="connecteam" />
        </div>
      </Section>

      {/* ── SERVER-SIDE INTEGRATIONS ── */}
      <Section title="Server Integrations" desc="These keys are set in Vercel → Settings → Environment Variables. Add them there and redeploy.">
        <div className="space-y-4">
          <IntegrationRow name="Claude AI (Anthropic)" envVars="ANTHROPIC_API_KEY" status={integrations.anthropic}
            onTest={() => testEndpoint('anthropic', '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }], context: '' }) })}
            testResult={testResults.anthropic} />

          <IntegrationRow name="Gmail" envVars="GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN" status={integrations.gmail}
            onTest={() => testEndpoint('gmail', '/api/gmail?action=profile')} testResult={testResults.gmail} />

          <IntegrationRow name="Google Calendar" envVars="Same as Gmail (auto-shared)" status={integrations.calendar}
            onTest={() => testEndpoint('calendar', '/api/calendar?action=calendars')} testResult={testResults.calendar} />

          <IntegrationRow name="Twilio SMS" envVars="TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER" status={integrations.twilio}
            onTest={() => testEndpoint('twilio', '/api/sms?action=list&limit=1')} testResult={testResults.twilio} />

          <IntegrationRow name="Square" envVars="SQUARE_ACCESS_TOKEN" status={integrations.square}
            onTest={() => testEndpoint('square', '/api/square-payroll?action=team')} testResult={testResults.square} />

          <IntegrationRow name="Supabase Database" envVars="VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY"
            status={integrations.supabase ? 'connected' : 'not configured'} />

          <IntegrationRow name="Facebook Leads" envVars="FB_PAGE_ACCESS_TOKEN, FB_VERIFY_TOKEN"
            status="not configured" note="Webhook: https://your-domain.vercel.app/api/leads?action=facebook" />
        </div>
      </Section>

      {/* ── GOOGLE CALENDAR ── */}
      <GoogleCalendarSettings />

      {/* ── BUSINESS INFO ── */}
      <Section title="Business Info" desc="Used in quotes, invoices, and emails.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Company Name" value={company.name} onChange={v => setCompany({ ...company, name: v })} />
          <Field label="Email" value={company.email} onChange={v => setCompany({ ...company, email: v })} />
          <Field label="Phone" value={company.phone} onChange={v => setCompany({ ...company, phone: v })} />
          <Field label="Address" value={company.address} onChange={v => setCompany({ ...company, address: v })} />
        </div>
      </Section>

      {/* ── PAYROLL ── */}
      <Section title="Payroll Defaults" desc="Default mileage and pay period settings.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="IRS Mileage Rate ($/mi)" type="number" step="0.01" value={payroll.irsRate} onChange={v => setPayroll({ ...payroll, irsRate: parseFloat(v) || 0 })} />
          <Field label="Mileage Threshold (mi)" type="number" value={payroll.mileageThreshold} onChange={v => setPayroll({ ...payroll, mileageThreshold: parseInt(v) || 0 })} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Pay Period</label>
            <select value={payroll.payPeriod} onChange={e => setPayroll({ ...payroll, payPeriod: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
      </Section>

      {/* ── INVOICE ── */}
      <Section title="Invoice Defaults" desc="Defaults for new invoices.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Invoice Prefix" value={invoice.prefix} onChange={v => setInvoice({ ...invoice, prefix: v })} />
          <Field label="Default Tax Rate" type="number" step="0.01" value={invoice.defaultTaxRate} onChange={v => setInvoice({ ...invoice, defaultTaxRate: parseFloat(v) || 0 })} />
          <Field label="Default Due Days" type="number" value={invoice.defaultDueDays} onChange={v => setInvoice({ ...invoice, defaultDueDays: parseInt(v) || 30 })} />
        </div>
        <div className="mt-3">
          <Field label="Payment Instructions" value={invoice.paymentInstructions} onChange={v => setInvoice({ ...invoice, paymentInstructions: v })} placeholder="e.g. Pay via Venmo @handle" />
        </div>
      </Section>

      {/* ── DATA ── */}
      <Section title="Data Management" desc="Export or import your CRM data.">
        <div className="flex gap-3">
          <button onClick={handleExport} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300">Export Data (JSON)</button>
          <label className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 cursor-pointer">
            Import Data <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          {isSupabaseConfigured() ? 'Data stored in Supabase.' : 'Data stored in browser localStorage. Set up Supabase for cloud storage.'}
        </p>
      </Section>

      {/* Save all */}
      <div className="flex justify-end">
        <button onClick={handleSaveAll} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">
          Save All Settings
        </button>
      </div>
    </div>
  )
}

// Rental calendar config
const RENTAL_CAL_KEY = 'workflowhq_rental_calendars'
const SELECTED_CALS_KEY = 'workflowhq_selected_calendars'

function GoogleCalendarSettings() {
  const [calendars, setCalendars] = useState([])
  const [selectedCals, setSelectedCals] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SELECTED_CALS_KEY)) || [] } catch { return [] }
  })
  const [rentalCals, setRentalCals] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RENTAL_CAL_KEY)) || [] } catch { return [] }
  })
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(false)
  const [newRental, setNewRental] = useState({ calendarId: '', name: '', checkoutTime: '10:00', cleaningTime: '11:00' })

  useEffect(() => { loadCalendars() }, [])

  async function loadCalendars() {
    setLoading(true)
    try {
      const res = await fetch('/api/calendar?action=calendars')
      if (res.ok) {
        const data = await res.json()
        setCalendars(data.calendars || [])
        setConnected(true)
        // Auto-select all if none selected yet
        if (selectedCals.length === 0) {
          const all = (data.calendars || []).map(c => c.id)
          setSelectedCals(all)
          localStorage.setItem(SELECTED_CALS_KEY, JSON.stringify(all))
        }
      }
    } catch {}
    setLoading(false)
  }

  function toggleCalendar(id) {
    const updated = selectedCals.includes(id)
      ? selectedCals.filter(c => c !== id)
      : [...selectedCals, id]
    setSelectedCals(updated)
    localStorage.setItem(SELECTED_CALS_KEY, JSON.stringify(updated))
  }

  function addRental(e) {
    e.preventDefault()
    if (!newRental.calendarId || !newRental.name) return
    const updated = [...rentalCals, { ...newRental }]
    localStorage.setItem(RENTAL_CAL_KEY, JSON.stringify(updated))
    setRentalCals(updated)
    setNewRental({ calendarId: '', name: '', checkoutTime: '10:00', cleaningTime: '11:00' })
  }

  function removeRental(idx) {
    const updated = rentalCals.filter((_, i) => i !== idx)
    localStorage.setItem(RENTAL_CAL_KEY, JSON.stringify(updated))
    setRentalCals(updated)
  }

  if (!connected && !loading) {
    return (
      <Section title="Google Calendar" desc="Connect Gmail OAuth to enable calendar features.">
        <p className="text-sm text-gray-500">Not connected. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN to Vercel.</p>
      </Section>
    )
  }

  return (
    <Section title="Google Calendar" desc="Choose which calendars to show on the Schedule page and set up rental turnovers.">
      {loading && <p className="text-sm text-gray-500">Loading calendars...</p>}

      {/* Calendar selection */}
      {calendars.length > 0 && (
        <div>
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Visible Calendars</h3>
          <div className="space-y-1">
            {calendars.map(cal => (
              <label key={cal.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 cursor-pointer">
                <input type="checkbox" checked={selectedCals.includes(cal.id)} onChange={() => toggleCalendar(cal.id)}
                  className="rounded border-gray-600" />
                <span className="w-3 h-3 rounded" style={{ backgroundColor: cal.backgroundColor || '#4285f4' }} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-white">{cal.summaryOverride || cal.summary}</span>
                  {cal.primary && <span className="text-xs text-gray-500 ml-2">(primary)</span>}
                  {cal.accessRole === 'reader' && <span className="text-xs text-gray-600 ml-2">(read-only)</span>}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Rental property setup */}
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Rental Properties (Airbnb/VRBO Turnovers)</h3>
        <p className="text-xs text-gray-600 mb-3">
          Add rental iCal calendars to auto-detect guest checkouts and schedule cleanings.
          First subscribe to the iCal URL in Google Calendar, then select it here.
        </p>

        {rentalCals.length > 0 && (
          <div className="space-y-2 mb-4">
            {rentalCals.map((cal, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm text-white">{cal.name}</span>
                  <span className="text-xs text-gray-500 ml-2">Checkout {cal.checkoutTime} / Clean {cal.cleaningTime}</span>
                </div>
                <button onClick={() => removeRental(i)} className="text-xs text-gray-500 hover:text-red-400">Remove</button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={addRental} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Calendar</label>
            <select value={newRental.calendarId} onChange={e => {
              const cal = calendars.find(c => c.id === e.target.value)
              setNewRental({ ...newRental, calendarId: e.target.value, name: cal?.summaryOverride || cal?.summary || '' })
            }} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
              <option value="">Select...</option>
              {calendars.map(c => <option key={c.id} value={c.id}>{c.summaryOverride || c.summary}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Property Name</label>
            <input value={newRental.name} onChange={e => setNewRental({ ...newRental, name: e.target.value })}
              placeholder="e.g. Spin Drift"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Checkout / Clean time</label>
            <div className="flex gap-1">
              <input type="time" value={newRental.checkoutTime} onChange={e => setNewRental({ ...newRental, checkoutTime: e.target.value })}
                className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white" />
              <input type="time" value={newRental.cleaningTime} onChange={e => setNewRental({ ...newRental, cleaningTime: e.target.value })}
                className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white" />
            </div>
          </div>
          <button type="submit" disabled={!newRental.calendarId}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
            Add Property
          </button>
        </form>
      </div>
    </Section>
  )
}

function Section({ title, desc, children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
  )
}

function IntegrationRow({ name, envVars, status, onTest, testResult, note }) {
  const isConnected = status === 'connected'
  return (
    <div className="flex items-start justify-between py-2 border-b border-gray-800/50 last:border-0">
      <div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-600'}`} />
          <span className="text-sm font-medium text-white">{name}</span>
          <span className={`px-1.5 py-0.5 rounded text-xs ${isConnected ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
            {status || 'checking...'}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-0.5 ml-4">Env: <code className="text-gray-500">{envVars}</code></p>
        {note && <p className="text-xs text-blue-400/60 mt-0.5 ml-4">{note}</p>}
      </div>
      <div className="flex items-center gap-2">
        {testResult && (
          <span className={`text-xs ${testResult.status === 'ok' ? 'text-green-400' : testResult.status === 'testing' ? 'text-gray-400' : 'text-red-400'}`}>
            {testResult.message}
          </span>
        )}
        {onTest && (
          <button onClick={onTest} className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300">Test</button>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', step, placeholder }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input type={type} step={step} value={value || ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  )
}
