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

  // API Keys
  const [connecteamKey, setConnecteamKey] = useState(getApiKey())
  const [anthropicConfigured, setAnthropicConfigured] = useState(false)
  const [gmailConfigured, setGmailConfigured] = useState(false)
  const [twilioConfigured, setTwilioConfigured] = useState(false)
  const [squareConfigured, setSquareConfigured] = useState(false)

  // Business settings
  const [company, setCompany] = useState(settings.company || {
    name: 'The Maine Cleaning & Property Management Co.',
    email: '',
    phone: '',
    address: '',
  })
  const [payroll, setPayroll] = useState(settings.payroll || {
    irsRate: 0.70,
    mileageThreshold: 35,
    payPeriod: 'biweekly',
  })
  const [invoice, setInvoice] = useState(settings.invoice || {
    defaultTaxRate: 0,
    defaultDueDays: 30,
    paymentInstructions: '',
    prefix: 'INV',
  })

  // Check server-side integrations on mount
  useEffect(() => {
    checkIntegrations()
  }, [])

  async function checkIntegrations() {
    // Check Anthropic
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }], context: '' }) })
      setAnthropicConfigured(res.status !== 500)
    } catch { setAnthropicConfigured(false) }

    // Check Gmail
    try {
      const res = await fetch('/api/gmail?action=profile')
      setGmailConfigured(res.ok)
    } catch { setGmailConfigured(false) }

    // Check Twilio
    try {
      const res = await fetch('/api/sms?action=list&limit=1')
      setTwilioConfigured(res.ok)
    } catch { setTwilioConfigured(false) }

    // Check Square
    try {
      const res = await fetch('/api/square-payroll?action=team')
      setSquareConfigured(res.ok)
    } catch { setSquareConfigured(false) }
  }

  function handleSave() {
    saveSettings({ company, payroll, invoice })
    setSaved('Settings saved!')
    setTimeout(() => setSaved(null), 3000)
  }

  function handleSaveConnecteam() {
    setApiKey(connecteamKey)
    setSaved('Connecteam API key saved!')
    setTimeout(() => setSaved(null), 3000)
  }

  async function testEndpoint(name, url) {
    setTestResults(prev => ({ ...prev, [name]: 'testing...' }))
    try {
      const res = await fetch(url)
      const data = await res.json()
      if (res.ok) {
        setTestResults(prev => ({ ...prev, [name]: 'Connected!' }))
      } else {
        setTestResults(prev => ({ ...prev, [name]: data.error || `Error ${res.status}` }))
      }
    } catch (err) {
      setTestResults(prev => ({ ...prev, [name]: err.message }))
    }
  }

  function handleExport() {
    const data = exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflowhq-backup-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        importData(data)
        setSaved('Data imported successfully!')
        setTimeout(() => setSaved(null), 3000)
      } catch {
        setSaved('Failed to import data.')
        setTimeout(() => setSaved(null), 3000)
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure integrations, API keys, and business settings</p>
      </div>

      {saved && (
        <div className="p-3 bg-green-900/30 border border-green-800 rounded-lg text-sm text-green-300">{saved}</div>
      )}

      {/* ── INTEGRATIONS ── */}
      <Section title="Integrations" desc="Connect your services. Server-side keys are set in Vercel environment variables.">
        {/* Connecteam */}
        <div className="space-y-3">
          <IntegrationRow
            name="Connecteam"
            desc="Employee time tracking, scheduling, and workforce management"
            status={connecteamKey ? 'connected' : 'not configured'}
          />
          <div className="flex gap-2 ml-8">
            <input type="password" value={connecteamKey} onChange={e => setConnecteamKey(e.target.value)}
              placeholder="Connecteam API Key"
              className="flex-1 max-w-sm px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={handleSaveConnecteam}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">Save</button>
            <button onClick={() => testEndpoint('connecteam', `/api/connecteam?path=me&X-API-KEY=${connecteamKey}`)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Test</button>
            {testResults.connecteam && <span className="self-center text-xs text-gray-400">{testResults.connecteam}</span>}
          </div>
        </div>

        <hr className="border-gray-800" />

        {/* Claude AI */}
        <IntegrationRow
          name="Claude AI (Anthropic)"
          desc="Powers the AI agent. Set ANTHROPIC_API_KEY in Vercel env."
          status={anthropicConfigured ? 'connected' : 'not configured'}
          envVar="ANTHROPIC_API_KEY"
        />

        <hr className="border-gray-800" />

        {/* Gmail */}
        <div className="space-y-2">
          <IntegrationRow
            name="Gmail"
            desc="Sync emails into client conversations. Requires OAuth2 setup."
            status={gmailConfigured ? 'connected' : 'not configured'}
            envVar="GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN"
          />
          <div className="ml-8 flex gap-2">
            <button onClick={() => testEndpoint('gmail', '/api/gmail?action=profile')}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Test Connection</button>
            {testResults.gmail && <span className="self-center text-xs text-gray-400">{testResults.gmail}</span>}
          </div>
        </div>

        <hr className="border-gray-800" />

        {/* Twilio */}
        <div className="space-y-2">
          <IntegrationRow
            name="Twilio SMS"
            desc="Send and receive text messages with clients."
            status={twilioConfigured ? 'connected' : 'not configured'}
            envVar="TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER"
          />
          <div className="ml-8 space-y-2">
            <div className="flex gap-2">
              <button onClick={() => testEndpoint('twilio', '/api/sms?action=list&limit=1')}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Test Connection</button>
              {testResults.twilio && <span className="self-center text-xs text-gray-400">{testResults.twilio}</span>}
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-400 space-y-1">
              <p className="font-medium text-gray-300">Webhook URL for incoming SMS:</p>
              <code className="block text-blue-400">https://your-domain.vercel.app/api/sms?action=webhook</code>
              <p>Set this as your Twilio phone number's webhook URL for incoming messages.</p>
            </div>
          </div>
        </div>

        <hr className="border-gray-800" />

        {/* Square */}
        <div className="space-y-2">
          <IntegrationRow
            name="Square Payroll"
            desc="Export payroll data and sync with Square."
            status={squareConfigured ? 'connected' : 'not configured'}
            envVar="SQUARE_ACCESS_TOKEN"
          />
          <div className="ml-8 flex gap-2">
            <button onClick={() => testEndpoint('square', '/api/square-payroll?action=team')}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Test Connection</button>
            {testResults.square && <span className="self-center text-xs text-gray-400">{testResults.square}</span>}
          </div>
        </div>

        <hr className="border-gray-800" />

        {/* Supabase */}
        <IntegrationRow
          name="Supabase Database"
          desc="Persistent cloud storage. Set in .env or Vercel env."
          status={isSupabaseConfigured() ? 'connected' : 'using localStorage'}
          envVar="VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY"
        />
      </Section>

      {/* ── BUSINESS INFO ── */}
      <Section title="Business Info" desc="Your company details for invoices and communications.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Company Name" value={company.name} onChange={v => setCompany({ ...company, name: v })} />
          <Field label="Email" value={company.email} onChange={v => setCompany({ ...company, email: v })} />
          <Field label="Phone" value={company.phone} onChange={v => setCompany({ ...company, phone: v })} />
          <Field label="Address" value={company.address} onChange={v => setCompany({ ...company, address: v })} />
        </div>
      </Section>

      {/* ── PAYROLL SETTINGS ── */}
      <Section title="Payroll Defaults" desc="Default settings for payroll calculations.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="IRS Mileage Rate ($/mi)" type="number" step="0.01" value={payroll.irsRate} onChange={v => setPayroll({ ...payroll, irsRate: parseFloat(v) || 0 })} />
          <Field label="Mileage Threshold (mi)" type="number" value={payroll.mileageThreshold} onChange={v => setPayroll({ ...payroll, mileageThreshold: parseInt(v) || 0 })} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Pay Period</label>
            <select value={payroll.payPeriod} onChange={e => setPayroll({ ...payroll, payPeriod: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
      </Section>

      {/* ── INVOICE SETTINGS ── */}
      <Section title="Invoice Defaults" desc="Default values for new invoices.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Invoice Prefix" value={invoice.prefix} onChange={v => setInvoice({ ...invoice, prefix: v })} />
          <Field label="Default Tax Rate" type="number" step="0.01" value={invoice.defaultTaxRate} onChange={v => setInvoice({ ...invoice, defaultTaxRate: parseFloat(v) || 0 })} />
          <Field label="Default Due Days" type="number" value={invoice.defaultDueDays} onChange={v => setInvoice({ ...invoice, defaultDueDays: parseInt(v) || 30 })} />
        </div>
        <div className="mt-3">
          <Field label="Payment Instructions" value={invoice.paymentInstructions} onChange={v => setInvoice({ ...invoice, paymentInstructions: v })} placeholder="e.g. Pay via Venmo @handle, or check to..." />
        </div>
      </Section>

      {/* ── DATA MANAGEMENT ── */}
      <Section title="Data Management" desc="Export or import your CRM data.">
        <div className="flex gap-3">
          <button onClick={handleExport}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
            Export Data (JSON)
          </button>
          <label className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors cursor-pointer">
            Import Data
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          {isSupabaseConfigured()
            ? 'Data is stored in Supabase. Export creates a local backup.'
            : 'Data is stored in your browser (localStorage). Set up Supabase for persistent cloud storage.'}
        </p>
      </Section>

      {/* Save */}
      <div className="flex justify-end">
        <button onClick={handleSave}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors">
          Save All Settings
        </button>
      </div>
    </div>
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

function IntegrationRow({ name, desc, status, envVar }) {
  const isConnected = status === 'connected'
  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-600'}`} />
          <span className="text-sm font-medium text-white">{name}</span>
          <span className={`px-1.5 py-0.5 rounded text-xs ${isConnected ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
            {status}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 ml-4">{desc}</p>
        {envVar && !isConnected && (
          <p className="text-xs text-gray-600 mt-0.5 ml-4">Env: <code className="text-gray-500">{envVar}</code></p>
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
