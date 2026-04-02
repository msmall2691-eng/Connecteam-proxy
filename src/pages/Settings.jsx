import { useState, useEffect } from 'react'
import { getApiKey, setApiKey } from '../lib/api'
import { isSupabaseConfigured } from '../lib/supabase'
import { exportData, importData,
  getServiceTypesAsync, saveServiceTypeAsync, deleteServiceTypeAsync,
  getExtrasAsync, saveExtraAsync, deleteExtraAsync,
  getChecklistTemplatesAsync, saveChecklistTemplateAsync,
  getEmployeesAsync, saveEmployeeAsync, deleteEmployeeAsync,
  getTeamsAsync, saveTeamAsync, deleteTeamAsync,
} from '../lib/store'

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

  // Client-side keys (stored in browser) — also persisted in settings via Save All
  const [connecteamKey, setConnecteamKey] = useState(getApiKey() || settings.connecteamKey || '')

  // Server-side integration status
  const [integrations, setIntegrations] = useState({
    anthropic: null, gmail: null, twilio: null, square: null, calendar: null, supabase: isSupabaseConfigured(),
  })

  // Business settings
  const [company, setCompany] = useState(settings.company || {
    name: 'The Maine Cleaning & Property Management Co.',
    email: 'office@mainecleaningco.com',
    phone: '(207) 572-0502',
    address: '',
  })
  const [payroll, setPayroll] = useState(settings.payroll || {
    irsRate: 0.70, mileageThreshold: 35, payPeriod: 'biweekly',
  })
  const [invoice, setInvoice] = useState(settings.invoice || {
    defaultTaxRate: 0, defaultDueDays: 30, paymentInstructions: '', prefix: 'INV',
  })
  const [quote, setQuote] = useState(settings.quote || {
    quotePrefix: 'QTE', defaultExpiryDays: 30, quoteTerms: '', defaultFrequency: 'one-time',
  })
  const [scheduling, setScheduling] = useState(settings.scheduling || {
    defaultStartTime: '09:00', defaultEndTime: '12:00', defaultAssignee: '', bufferMinutes: 30,
  })
  const [notifications, setNotifications] = useState(settings.notifications || {
    notifyOnNewLead: true, notifyOnQuoteAccepted: true, notifyOnPayment: true, notificationEmail: '',
  })
  const [clientPortal, setClientPortal] = useState(settings.clientPortal || {
    portalEnabled: true, portalShowInvoices: true, portalShowSchedule: true, portalShowQuotes: true, portalWelcomeMessage: '',
  })
  const [automations, setAutomations] = useState(settings.automations || {
    autoScanTurnovers: true,
    turnoverScanDays: 30,
    turnoverDefaultCleanTime: '11:00',
    turnoverDefaultCheckoutTime: '10:00',
    autoSendReminders: true,
    reminderTime: '14:00',
    reminderChannel: 'both', // 'email', 'sms', 'both'
    reminderMessage: 'Hi {firstName}! This is a reminder that your cleaning is scheduled for tomorrow at {time}. Please make sure the space is accessible. — The Maine Cleaning Co.',
    autoCreateInvoice: true,
    autoEmailInvoice: false,
  })

  useEffect(() => { checkIntegrations() }, [])

  async function checkIntegrations() {
    const results = { supabase: isSupabaseConfigured() }

    const checks = [
      { key: 'anthropic', url: '/api/chat', method: 'POST', body: { messages: [{ role: 'user', content: 'ping' }], context: '' } },
      { key: 'gmail', url: '/api/google?action=gmail-profile' },
      { key: 'twilio', url: '/api/sms?action=list&limit=1' },
      { key: 'square', url: '/api/square?action=team' },
      { key: 'calendar', url: '/api/google?action=calendars' },
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
    // Save all settings including Connecteam key
    saveSettings({ company, payroll, invoice, quote, scheduling, notifications, clientPortal, automations, connecteamKey })
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
        {connecteamKey && (
          <div className="mt-3 bg-gray-800/50 rounded-lg p-3 space-y-1">
            <p className="text-xs text-gray-400 font-medium">Connecteam Webhook URL:</p>
            <code className="block text-xs text-blue-400 break-all">https://connecteam-proxy.vercel.app/api/connecteam?action=webhook</code>
            <p className="text-xs text-gray-600">Add this in Connecteam → Settings → Webhooks to receive real-time clock in/out, shift changes, and form submissions.</p>
          </div>
        )}
      </Section>

      {/* ── SERVER-SIDE INTEGRATIONS ── */}
      <Section title="Server Integrations" desc="These keys are set in Vercel → Settings → Environment Variables. Add them there and redeploy.">
        <div className="space-y-4">
          <IntegrationRow name="Claude AI (Anthropic)" envVars="ANTHROPIC_API_KEY" status={integrations.anthropic}
            onTest={() => testEndpoint('anthropic', '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }], context: '' }) })}
            testResult={testResults.anthropic} />

          <IntegrationRow name="Gmail" envVars="GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN" status={integrations.gmail}
            onTest={() => testEndpoint('gmail', '/api/google?action=gmail-profile')} testResult={testResults.gmail} />

          <IntegrationRow name="Google Calendar" envVars="Same as Gmail (auto-shared)" status={integrations.calendar}
            onTest={() => testEndpoint('calendar', '/api/google?action=calendars')} testResult={testResults.calendar} />

          <IntegrationRow name="Twilio SMS" envVars="TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER" status={integrations.twilio}
            onTest={() => testEndpoint('twilio', '/api/sms?action=list&limit=1')} testResult={testResults.twilio} />

          <IntegrationRow name="Square" envVars="SQUARE_ACCESS_TOKEN" status={integrations.square}
            onTest={() => testEndpoint('square', '/api/square?action=team')} testResult={testResults.square} />

          <div className="py-2 border-b border-gray-800/50">
            <IntegrationRow name="Supabase Database" envVars="VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY"
              status={integrations.supabase ? 'connected' : 'not configured'} />
            {!integrations.supabase && (
              <div className="ml-4 mt-2 space-y-2">
                <input placeholder="Supabase Project URL" defaultValue={localStorage.getItem('supabase_url') || ''}
                  onChange={e => localStorage.setItem('supabase_url_draft', e.target.value)}
                  className="w-full max-w-md px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500" />
                <input placeholder="Supabase Anon Key" type="password" defaultValue={localStorage.getItem('supabase_anon_key') || ''}
                  onChange={e => localStorage.setItem('supabase_anon_key_draft', e.target.value)}
                  className="w-full max-w-md px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500" />
                <button onClick={() => {
                  const url = localStorage.getItem('supabase_url_draft') || ''
                  const key = localStorage.getItem('supabase_anon_key_draft') || ''
                  if (url && key) {
                    localStorage.setItem('supabase_url', url)
                    localStorage.setItem('supabase_anon_key', key)
                    localStorage.removeItem('supabase_url_draft')
                    localStorage.removeItem('supabase_anon_key_draft')
                    window.location.reload()
                  }
                }} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Connect Supabase</button>
              </div>
            )}
          </div>

          <IntegrationRow name="ManyChat" envVars="No env vars needed"
            status="ready" note="Webhook: https://connecteam-proxy.vercel.app/api/manychat" />

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

      {/* ── QUOTE DEFAULTS ── */}
      <Section title="Quote Defaults" desc="Default settings for new quotes.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Quote Prefix" value={quote.quotePrefix} onChange={v => setQuote({ ...quote, quotePrefix: v })} />
          <Field label="Default Expiry (days)" type="number" value={quote.defaultExpiryDays} onChange={v => setQuote({ ...quote, defaultExpiryDays: parseInt(v) || 30 })} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Default Frequency</label>
            <select value={quote.defaultFrequency} onChange={e => setQuote({ ...quote, defaultFrequency: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="one-time">One-time</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-xs text-gray-500 mb-1">Terms & Conditions</label>
          <textarea rows={4} value={quote.quoteTerms} onChange={e => setQuote({ ...quote, quoteTerms: e.target.value })}
            placeholder="Terms and conditions shown on quotes..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </Section>

      {/* ── SCHEDULING DEFAULTS ── */}
      <Section title="Scheduling Defaults" desc="Default settings when creating new scheduled jobs.">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Default Start Time</label>
            <input type="time" value={scheduling.defaultStartTime} onChange={e => setScheduling({ ...scheduling, defaultStartTime: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Default End Time</label>
            <input type="time" value={scheduling.defaultEndTime} onChange={e => setScheduling({ ...scheduling, defaultEndTime: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <Field label="Default Assignee" value={scheduling.defaultAssignee} onChange={v => setScheduling({ ...scheduling, defaultAssignee: v })} placeholder="e.g. Charnette" />
          <Field label="Buffer Between Jobs (min)" type="number" value={scheduling.bufferMinutes} onChange={v => setScheduling({ ...scheduling, bufferMinutes: parseInt(v) || 0 })} />
        </div>
      </Section>

      {/* ── NOTIFICATIONS ── */}
      <Section title="Notifications" desc="Configure which events trigger notifications.">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={notifications.notifyOnNewLead} onChange={e => setNotifications({ ...notifications, notifyOnNewLead: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">New lead received</span><p className="text-xs text-gray-600">Get notified when a new lead comes in from Facebook, ManyChat, or the website</p></div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={notifications.notifyOnQuoteAccepted} onChange={e => setNotifications({ ...notifications, notifyOnQuoteAccepted: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Quote accepted</span><p className="text-xs text-gray-600">Get notified when a client accepts a quote</p></div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={notifications.notifyOnPayment} onChange={e => setNotifications({ ...notifications, notifyOnPayment: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Payment received</span><p className="text-xs text-gray-600">Get notified when a payment is recorded or received via Square</p></div>
          </label>
        </div>
        <div className="mt-3">
          <Field label="Notification Email" value={notifications.notificationEmail} onChange={v => setNotifications({ ...notifications, notificationEmail: v })} placeholder="e.g. alerts@mainecleaningco.com" />
        </div>
      </Section>

      {/* ── CLIENT PORTAL ── */}
      <Section title="Client Portal" desc="Configure the client-facing portal experience.">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={clientPortal.portalEnabled} onChange={e => setClientPortal({ ...clientPortal, portalEnabled: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Enable client portal</span><p className="text-xs text-gray-600">Allow clients to log in and view their account</p></div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={clientPortal.portalShowInvoices} onChange={e => setClientPortal({ ...clientPortal, portalShowInvoices: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Show invoices</span><p className="text-xs text-gray-600">Clients can view and pay their invoices</p></div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={clientPortal.portalShowSchedule} onChange={e => setClientPortal({ ...clientPortal, portalShowSchedule: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Show schedule</span><p className="text-xs text-gray-600">Clients can see their upcoming scheduled services</p></div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={clientPortal.portalShowQuotes} onChange={e => setClientPortal({ ...clientPortal, portalShowQuotes: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Show quotes</span><p className="text-xs text-gray-600">Clients can view and accept/decline quotes</p></div>
          </label>
        </div>
        <div className="mt-3">
          <label className="block text-xs text-gray-500 mb-1">Welcome Message</label>
          <textarea rows={3} value={clientPortal.portalWelcomeMessage} onChange={e => setClientPortal({ ...clientPortal, portalWelcomeMessage: e.target.value })}
            placeholder="Welcome message displayed when clients log in..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </Section>

      {/* ── AUTOMATIONS ── */}
      <Section title="Automations" desc="Configure automated workflows. Changes save when you click Save All Settings.">
        {/* Turnover scanning */}
        <div className="space-y-3">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider">Rental Turnovers</h3>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={automations.autoScanTurnovers} onChange={e => setAutomations({ ...automations, autoScanTurnovers: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Auto-scan iCal feeds daily</span><p className="text-xs text-gray-600">Scans all rental properties at 6 AM and creates cleaning jobs for upcoming checkouts</p></div>
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 ml-7">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Days ahead</label>
              <input type="number" value={automations.turnoverScanDays} onChange={e => setAutomations({ ...automations, turnoverScanDays: parseInt(e.target.value) || 30 })}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default checkout</label>
              <input type="time" value={automations.turnoverDefaultCheckoutTime} onChange={e => setAutomations({ ...automations, turnoverDefaultCheckoutTime: e.target.value })}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default clean time</label>
              <input type="time" value={automations.turnoverDefaultCleanTime} onChange={e => setAutomations({ ...automations, turnoverDefaultCleanTime: e.target.value })}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
            </div>
          </div>
          <div className="ml-7 flex gap-2">
            <button onClick={async () => {
              try {
                const res = await fetch(`/api/auto-turnovers?action=preview&days=${automations.turnoverScanDays}`)
                if (res.ok) { const d = await res.json(); alert(`Preview: ${d.properties} properties, ${d.newTurnovers} new turnovers to create (${d.alreadyScheduled} already scheduled)`) }
              } catch { alert('Failed to scan') }
            }} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Preview Scan</button>
            <button onClick={async () => {
              try {
                const res = await fetch(`/api/auto-turnovers?action=scan&days=${automations.turnoverScanDays}`)
                if (res.ok) { const d = await res.json(); alert(`Done! Created ${d.created} new turnover cleanings from ${d.properties} properties.`) }
              } catch { alert('Failed to scan') }
            }} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 rounded-lg text-xs text-white">Run Scan Now</button>
          </div>
        </div>

        <hr className="border-gray-800" />

        {/* Reminders */}
        <div className="space-y-3">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider">Client Reminders</h3>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={automations.autoSendReminders} onChange={e => setAutomations({ ...automations, autoSendReminders: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Auto-send reminders day before</span><p className="text-xs text-gray-600">Texts/emails clients at 2 PM the day before their scheduled cleaning</p></div>
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 ml-7">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Send via</label>
              <select value={automations.reminderChannel} onChange={e => setAutomations({ ...automations, reminderChannel: e.target.value })}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                <option value="email">Email only</option><option value="sms">SMS only</option><option value="both">Email + SMS</option>
              </select>
            </div>
          </div>
          <div className="ml-7">
            <label className="block text-xs text-gray-500 mb-1">Reminder message template</label>
            <textarea rows={3} value={automations.reminderMessage} onChange={e => setAutomations({ ...automations, reminderMessage: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500" />
            <p className="text-xs text-gray-600 mt-1">Variables: {'{firstName}'}, {'{time}'}, {'{date}'}, {'{address}'}</p>
          </div>
          <div className="ml-7 flex gap-2">
            <button onClick={async () => {
              try {
                const res = await fetch('/api/reminders?action=preview')
                if (res.ok) { const d = await res.json(); alert(`Preview: ${d.count} reminders would be sent for ${d.date}\n\n${d.reminders.map(r => `${r.clientName}: ${r.jobTitle} @ ${r.startTime}`).join('\n') || 'No jobs tomorrow'}`) }
              } catch { alert('Failed to check') }
            }} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Preview Reminders</button>
            <button onClick={async () => {
              try {
                const res = await fetch('/api/reminders?action=send')
                if (res.ok) { const d = await res.json(); alert(`Sent ${d.sent} reminders for ${d.date}. ${d.failed} failed.`) }
              } catch { alert('Failed to send') }
            }} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Send Now</button>
          </div>
        </div>

        <hr className="border-gray-800" />

        {/* Invoice automation */}
        <div className="space-y-3">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider">Invoicing</h3>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={automations.autoCreateInvoice} onChange={e => setAutomations({ ...automations, autoCreateInvoice: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Auto-create invoice when job completed</span><p className="text-xs text-gray-600">Draft invoice created automatically when you mark a job as completed</p></div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={automations.autoEmailInvoice} onChange={e => setAutomations({ ...automations, autoEmailInvoice: e.target.checked })} className="rounded border-gray-600" />
            <div><span className="text-sm text-white">Auto-email invoices to clients</span><p className="text-xs text-gray-600">Automatically sends the invoice email when it's created (otherwise stays as draft)</p></div>
          </label>
        </div>
      </Section>

      {/* ── SERVICE CATALOG ── */}
      <ServiceCatalogSettings />

      {/* ── EMPLOYEES & TEAMS ── */}
      <EmployeeSettings />

      {/* ── CHECKLISTS ── */}
      <ChecklistSettings />

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

      {/* Spacer for sticky save bar */}
      <div className="h-20" />

      {/* Sticky save bar — always visible at bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-gray-900/95 backdrop-blur border-t border-gray-800 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <p className="text-xs text-gray-500">Changes are saved to your browser. Click Save to apply.</p>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-400 font-medium">{saved}</span>}
            <button onClick={handleSaveAll} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white shadow-lg">
              Save All Settings
            </button>
          </div>
        </div>
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
      const res = await fetch('/api/google?action=calendars')
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

// ══════════════════════════════════════════
// SERVICE CATALOG (service types + extras)
// ══════════════════════════════════════════
function ServiceCatalogSettings() {
  const [serviceTypes, setServiceTypes] = useState([])
  const [extras, setExtras] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [editingExtra, setEditingExtra] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [st, ex] = await Promise.all([getServiceTypesAsync(), getExtrasAsync()])
      setServiceTypes(st)
      setExtras(ex)
    } catch {}
    setLoading(false)
  }

  async function saveType(st) {
    const saved = await saveServiceTypeAsync(st)
    setServiceTypes(prev => st.id ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved])
    setEditing(null)
  }

  async function removeType(id) {
    if (!confirm('Remove this service type?')) return
    await deleteServiceTypeAsync(id)
    setServiceTypes(prev => prev.filter(s => s.id !== id))
  }

  async function saveExtra(ex) {
    const saved = await saveExtraAsync(ex)
    setExtras(prev => ex.id ? prev.map(e => e.id === saved.id ? saved : e) : [...prev, saved])
    setEditingExtra(null)
  }

  async function removeExtra(id) {
    await deleteExtraAsync(id)
    setExtras(prev => prev.filter(e => e.id !== id))
  }

  return (
    <Section title="Service Catalog" desc="Standardize your service types and add-on extras. Used in quotes, jobs, and booking forms.">
      {loading ? <p className="text-sm text-gray-500">Loading...</p> : (
        <>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Service Types</h3>
              <button onClick={() => setEditing({ name: '', description: '', baseDurationMinutes: 120, isRecurringEligible: true })}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">+ Add</button>
            </div>
            <div className="space-y-1">
              {serviceTypes.map(st => (
                <div key={st.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm text-white">{st.name}</span>
                    <span className="text-xs text-gray-500 ml-2">{st.baseDurationMinutes}min</span>
                    {st.isRecurringEligible && <span className="text-xs text-blue-400/60 ml-2">recurring</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(st)} className="text-xs text-gray-400 hover:text-white">Edit</button>
                    <button onClick={() => removeType(st.id)} className="text-xs text-gray-500 hover:text-red-400">Remove</button>
                  </div>
                </div>
              ))}
              {serviceTypes.length === 0 && <p className="text-xs text-gray-600">No service types yet. Run the v5 migration to seed defaults.</p>}
            </div>
          </div>

          {editing && (
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-medium text-white">{editing.id ? 'Edit' : 'Add'} Service Type</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Name</label>
                  <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Duration (min)</label>
                  <input type="number" value={editing.baseDurationMinutes} onChange={e => setEditing({ ...editing, baseDurationMinutes: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })}
                  className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing.isRecurringEligible} onChange={e => setEditing({ ...editing, isRecurringEligible: e.target.checked })} />
                <span className="text-xs text-gray-400">Eligible for recurring scheduling</span>
              </label>
              <div className="flex gap-2">
                <button onClick={() => saveType(editing)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Save</button>
                <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-gray-700 rounded-lg text-xs text-gray-300">Cancel</button>
              </div>
            </div>
          )}

          <hr className="border-gray-800" />

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Add-On Extras</h3>
              <button onClick={() => setEditingExtra({ name: '', price: 0, priceType: 'flat', durationMinutes: 0 })}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">+ Add</button>
            </div>
            <div className="space-y-1">
              {extras.map(ex => (
                <div key={ex.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm text-white">{ex.name}</span>
                    <span className="text-xs text-gray-500 ml-2">${ex.price} {ex.priceType === 'per_unit' ? `/ ${ex.unitLabel || 'unit'}` : 'flat'}</span>
                    <span className="text-xs text-gray-600 ml-2">+{ex.durationMinutes}min</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingExtra(ex)} className="text-xs text-gray-400 hover:text-white">Edit</button>
                    <button onClick={() => removeExtra(ex.id)} className="text-xs text-gray-500 hover:text-red-400">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {editingExtra && (
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-medium text-white">{editingExtra.id ? 'Edit' : 'Add'} Extra</h4>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Name</label>
                  <input value={editingExtra.name} onChange={e => setEditingExtra({ ...editingExtra, name: e.target.value })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Price ($)</label>
                  <input type="number" step="0.01" value={editingExtra.price} onChange={e => setEditingExtra({ ...editingExtra, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Price Type</label>
                  <select value={editingExtra.priceType} onChange={e => setEditingExtra({ ...editingExtra, priceType: e.target.value })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white">
                    <option value="flat">Flat fee</option>
                    <option value="per_unit">Per unit</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Extra time (min)</label>
                  <input type="number" value={editingExtra.durationMinutes} onChange={e => setEditingExtra({ ...editingExtra, durationMinutes: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
              </div>
              {editingExtra.priceType === 'per_unit' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Unit label</label>
                  <input value={editingExtra.unitLabel || ''} onChange={e => setEditingExtra({ ...editingExtra, unitLabel: e.target.value })}
                    placeholder="e.g. per window, per load"
                    className="w-full max-w-xs px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => saveExtra(editingExtra)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Save</button>
                <button onClick={() => setEditingExtra(null)} className="px-3 py-1.5 bg-gray-700 rounded-lg text-xs text-gray-300">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  )
}

// ══════════════════════════════════════════
// EMPLOYEES & TEAMS
// ══════════════════════════════════════════
function EmployeeSettings() {
  const [employees, setEmployees] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [editingTeam, setEditingTeam] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [emps, tms] = await Promise.all([getEmployeesAsync(), getTeamsAsync()])
      setEmployees(emps)
      setTeams(tms)
    } catch {}
    setLoading(false)
  }

  async function saveEmp(emp) {
    const saved = await saveEmployeeAsync(emp)
    setEmployees(prev => emp.id ? prev.map(e => e.id === saved.id ? saved : e) : [...prev, saved])
    setEditing(null)
  }

  async function removeEmp(id) {
    if (!confirm('Remove this employee?')) return
    await deleteEmployeeAsync(id)
    setEmployees(prev => prev.filter(e => e.id !== id))
  }

  async function saveTm(team) {
    const saved = await saveTeamAsync(team)
    setTeams(prev => team.id ? prev.map(t => t.id === saved.id ? saved : t) : [...prev, saved])
    setEditingTeam(null)
  }

  async function removeTm(id) {
    if (!confirm('Remove this team?')) return
    await deleteTeamAsync(id)
    setTeams(prev => prev.filter(t => t.id !== id))
  }

  const roleColors = { admin: 'text-red-400', manager: 'text-yellow-400', technician: 'text-blue-400', dispatcher: 'text-purple-400' }

  return (
    <Section title="Employees & Teams" desc="Manage your team members and crew assignments. Links to Connecteam employee IDs.">
      {loading ? <p className="text-sm text-gray-500">Loading...</p> : (
        <>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Employees</h3>
              <button onClick={() => setEditing({ firstName: '', lastName: '', role: 'technician', hourlyRate: 0, status: 'active', skills: [], zones: [] })}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">+ Add</button>
            </div>
            <div className="space-y-1">
              {employees.map(emp => (
                <div key={emp.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-3">
                    {emp.color && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: emp.color }} />}
                    <div>
                      <span className="text-sm text-white">{emp.firstName} {emp.lastName}</span>
                      <span className={`text-xs ml-2 ${roleColors[emp.role] || 'text-gray-500'}`}>{emp.role}</span>
                      {emp.hourlyRate > 0 && <span className="text-xs text-gray-500 ml-2">${emp.hourlyRate}/hr</span>}
                      {emp.status !== 'active' && <span className="text-xs text-red-400/60 ml-2">{emp.status}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(emp)} className="text-xs text-gray-400 hover:text-white">Edit</button>
                    <button onClick={() => removeEmp(emp.id)} className="text-xs text-gray-500 hover:text-red-400">Remove</button>
                  </div>
                </div>
              ))}
              {employees.length === 0 && <p className="text-xs text-gray-600">No employees added yet.</p>}
            </div>
          </div>

          {editing && (
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-medium text-white">{editing.id ? 'Edit' : 'Add'} Employee</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">First Name</label>
                  <input value={editing.firstName} onChange={e => setEditing({ ...editing, firstName: e.target.value })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Last Name</label>
                  <input value={editing.lastName} onChange={e => setEditing({ ...editing, lastName: e.target.value })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Role</label>
                  <select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white">
                    <option value="technician">Technician</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                    <option value="dispatcher">Dispatcher</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Hourly Rate ($)</label>
                  <input type="number" step="0.01" value={editing.hourlyRate} onChange={e => setEditing({ ...editing, hourlyRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Email</label>
                  <input value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Phone</label>
                  <input value={editing.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Connecteam ID</label>
                  <input value={editing.connecteamUserId || ''} onChange={e => setEditing({ ...editing, connecteamUserId: e.target.value })}
                    placeholder="Optional"
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Color</label>
                  <input type="color" value={editing.color || '#3b82f6'} onChange={e => setEditing({ ...editing, color: e.target.value })}
                    className="w-full h-[34px] bg-gray-900 border border-gray-700 rounded-lg cursor-pointer" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Skills (comma-separated)</label>
                <input value={(editing.skills || []).join(', ')} onChange={e => setEditing({ ...editing, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  placeholder="e.g. deep_clean, post_construction, commercial"
                  className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => saveEmp(editing)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Save</button>
                <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-gray-700 rounded-lg text-xs text-gray-300">Cancel</button>
              </div>
            </div>
          )}

          <hr className="border-gray-800" />

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Teams / Crews</h3>
              <button onClick={() => setEditingTeam({ name: '', memberIds: [], zone: '' })}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">+ Add</button>
            </div>
            <div className="space-y-1">
              {teams.map(tm => (
                <div key={tm.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm text-white">{tm.name}</span>
                    {tm.zone && <span className="text-xs text-gray-500 ml-2">{tm.zone}</span>}
                    <span className="text-xs text-gray-600 ml-2">{(tm.memberIds || []).length} members</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingTeam(tm)} className="text-xs text-gray-400 hover:text-white">Edit</button>
                    <button onClick={() => removeTm(tm.id)} className="text-xs text-gray-500 hover:text-red-400">Remove</button>
                  </div>
                </div>
              ))}
              {teams.length === 0 && <p className="text-xs text-gray-600">No teams created yet.</p>}
            </div>
          </div>

          {editingTeam && (
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-medium text-white">{editingTeam.id ? 'Edit' : 'Add'} Team</h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Team Name</label>
                  <input value={editingTeam.name} onChange={e => setEditingTeam({ ...editingTeam, name: e.target.value })}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Zone</label>
                  <input value={editingTeam.zone || ''} onChange={e => setEditingTeam({ ...editingTeam, zone: e.target.value })}
                    placeholder="e.g. Naples, Portland"
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Color</label>
                  <input type="color" value={editingTeam.color || '#3b82f6'} onChange={e => setEditingTeam({ ...editingTeam, color: e.target.value })}
                    className="w-full h-[34px] bg-gray-900 border border-gray-700 rounded-lg cursor-pointer" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Team Lead</label>
                <select value={editingTeam.leadEmployeeId || ''} onChange={e => setEditingTeam({ ...editingTeam, leadEmployeeId: e.target.value || null })}
                  className="w-full max-w-xs px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white">
                  <option value="">None</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Members</label>
                <div className="flex flex-wrap gap-2">
                  {employees.map(emp => (
                    <label key={emp.id} className="flex items-center gap-1.5 px-2 py-1 bg-gray-900 rounded cursor-pointer text-xs">
                      <input type="checkbox" checked={(editingTeam.memberIds || []).includes(emp.id)}
                        onChange={e => {
                          const ids = editingTeam.memberIds || []
                          setEditingTeam({ ...editingTeam, memberIds: e.target.checked ? [...ids, emp.id] : ids.filter(id => id !== emp.id) })
                        }} />
                      <span className="text-gray-300">{emp.firstName} {emp.lastName}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => saveTm(editingTeam)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Save</button>
                <button onClick={() => setEditingTeam(null)} className="px-3 py-1.5 bg-gray-700 rounded-lg text-xs text-gray-300">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  )
}

// ══════════════════════════════════════════
// CHECKLIST TEMPLATES
// ══════════════════════════════════════════
function ChecklistSettings() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      setTemplates(await getChecklistTemplatesAsync())
    } catch {}
    setLoading(false)
  }

  async function saveTemplate(tpl) {
    const saved = await saveChecklistTemplateAsync(tpl)
    setTemplates(prev => tpl.id ? prev.map(t => t.id === saved.id ? saved : t) : [...prev, saved])
    setEditing(null)
  }

  function addSection() {
    setEditing({ ...editing, sections: [...(editing.sections || []), { name: '', items: [{ task: '', required: true }] }] })
  }

  function removeSection(idx) {
    setEditing({ ...editing, sections: editing.sections.filter((_, i) => i !== idx) })
  }

  function updateSection(idx, field, value) {
    const sections = [...editing.sections]
    sections[idx] = { ...sections[idx], [field]: value }
    setEditing({ ...editing, sections })
  }

  function addItem(sectionIdx) {
    const sections = [...editing.sections]
    sections[sectionIdx].items = [...sections[sectionIdx].items, { task: '', required: true }]
    setEditing({ ...editing, sections })
  }

  function removeItem(sectionIdx, itemIdx) {
    const sections = [...editing.sections]
    sections[sectionIdx].items = sections[sectionIdx].items.filter((_, i) => i !== itemIdx)
    setEditing({ ...editing, sections })
  }

  function updateItem(sectionIdx, itemIdx, field, value) {
    const sections = [...editing.sections]
    sections[sectionIdx].items = sections[sectionIdx].items.map((item, i) =>
      i === itemIdx ? { ...item, [field]: value } : item
    )
    setEditing({ ...editing, sections })
  }

  return (
    <Section title="Cleaning Checklists" desc="Create per-room checklist templates. Assigned to service types and snapshotted onto each visit.">
      {loading ? <p className="text-sm text-gray-500">Loading...</p> : (
        <>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs text-gray-500 uppercase tracking-wider">Templates</h3>
            <button onClick={() => setEditing({ name: '', sections: [{ name: 'Kitchen', items: [{ task: '', required: true }] }] })}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">+ Add</button>
          </div>

          <div className="space-y-1">
            {templates.map(tpl => (
              <div key={tpl.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm text-white">{tpl.name}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    {(tpl.sections || []).length} sections, {(tpl.sections || []).reduce((sum, s) => sum + (s.items || []).length, 0)} items
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditing(tpl)} className="text-xs text-gray-400 hover:text-white">Edit</button>
                </div>
              </div>
            ))}
            {templates.length === 0 && <p className="text-xs text-gray-600">No checklists yet. Run the v5 migration to seed defaults.</p>}
          </div>

          {editing && (
            <div className="bg-gray-800 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-white">{editing.id ? 'Edit' : 'Add'} Checklist</h4>
                <button onClick={() => setEditing(null)} className="text-xs text-gray-500 hover:text-white">Close</button>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Template Name</label>
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                  className="w-full max-w-sm px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white" />
              </div>

              {(editing.sections || []).map((section, si) => (
                <div key={si} className="bg-gray-900 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <input value={section.name} onChange={e => updateSection(si, 'name', e.target.value)}
                      placeholder="Section name (e.g. Kitchen)"
                      className="px-2 py-1 bg-transparent border-b border-gray-700 text-sm font-medium text-white focus:outline-none focus:border-blue-500" />
                    <button onClick={() => removeSection(si)} className="text-xs text-gray-600 hover:text-red-400">Remove section</button>
                  </div>
                  {section.items.map((item, ii) => (
                    <div key={ii} className="flex items-center gap-2 ml-2">
                      <input value={item.task} onChange={e => updateItem(si, ii, 'task', e.target.value)}
                        placeholder="Task description"
                        className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                      <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                        <input type="checkbox" checked={item.required} onChange={e => updateItem(si, ii, 'required', e.target.checked)} />
                        Req
                      </label>
                      <button onClick={() => removeItem(si, ii)} className="text-xs text-gray-600 hover:text-red-400">x</button>
                    </div>
                  ))}
                  <button onClick={() => addItem(si)} className="text-xs text-blue-400 hover:text-blue-300 ml-2">+ Add task</button>
                </div>
              ))}

              <button onClick={addSection} className="text-xs text-blue-400 hover:text-blue-300">+ Add section</button>
              <div className="flex gap-2">
                <button onClick={() => saveTemplate(editing)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Save</button>
                <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-gray-700 rounded-lg text-xs text-gray-300">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
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
        <p className="text-xs text-gray-600 mt-0.5 ml-4 break-all">Env: <code className="text-gray-500">{envVars}</code></p>
        {note && <p className="text-xs text-blue-400/60 mt-0.5 ml-4 break-all">{note}</p>}
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
