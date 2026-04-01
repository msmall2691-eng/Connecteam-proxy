import { useState, useEffect } from 'react'
import { getApiKey, setApiKey } from '../lib/api'
import { isSupabaseConfigured } from '../lib/supabase'

const STEPS = [
  {
    id: 'connecteam',
    title: 'Connecteam',
    desc: 'Employee time tracking & scheduling',
    icon: '👥',
    clientSide: true, // key stored in browser
    fields: [{ key: 'connecteam_api_key', label: 'API Key', type: 'password' }],
    instructions: [
      'Log in to Connecteam at app.connecteam.com',
      'Go to Settings (gear icon) → Developers → API',
      'Click "Generate API Key"',
      'Copy the key and paste it below',
    ],
    testEndpoint: '/api/connecteam?path=me',
    testHeaders: (vals) => ({ 'X-API-KEY': vals.connecteam_api_key }),
  },
  {
    id: 'anthropic',
    title: 'Claude AI (Anthropic)',
    desc: 'Powers the AI assistant agent',
    icon: '🤖',
    clientSide: false,
    fields: [{ key: 'ANTHROPIC_API_KEY', label: 'API Key', type: 'password' }],
    instructions: [
      'Go to console.anthropic.com',
      'Sign in or create an account',
      'Click "API Keys" in the sidebar',
      'Click "Create Key" → name it "workflow-hq"',
      'Copy the key (starts with sk-ant-...)',
      '⚠️ Add this to Vercel: Settings → Environment Variables → ANTHROPIC_API_KEY',
      'After adding, click Deployments → Redeploy',
    ],
    testEndpoint: '/api/chat',
    testMethod: 'POST',
    testBody: { messages: [{ role: 'user', content: 'Say "connected" in one word' }], context: '' },
  },
  {
    id: 'supabase',
    title: 'Supabase Database',
    desc: 'Cloud storage for clients, jobs, invoices',
    icon: '🗄️',
    clientSide: false,
    fields: [
      { key: 'VITE_SUPABASE_URL', label: 'Project URL', type: 'text' },
      { key: 'VITE_SUPABASE_ANON_KEY', label: 'Anon Public Key', type: 'password' },
    ],
    instructions: [
      'Go to supabase.com → Start your project (free tier)',
      'Create a new project → pick a name and password',
      'Once created, go to Settings → API',
      'Copy "Project URL" and "anon public" key',
      '⚠️ Add BOTH to Vercel as environment variables:',
      '   VITE_SUPABASE_URL = your project URL',
      '   VITE_SUPABASE_ANON_KEY = your anon key',
      'Then run the SQL schema: go to SQL Editor in Supabase',
      'Paste contents of supabase-schema.sql and click Run',
      'Redeploy on Vercel after adding the env vars',
    ],
    testCheck: () => isSupabaseConfigured(),
  },
  {
    id: 'gmail',
    title: 'Gmail',
    desc: 'Sync emails into client conversations',
    icon: '📧',
    clientSide: false,
    fields: [
      { key: 'GMAIL_CLIENT_ID', label: 'Client ID', type: 'text' },
      { key: 'GMAIL_CLIENT_SECRET', label: 'Client Secret', type: 'password' },
      { key: 'GMAIL_REFRESH_TOKEN', label: 'Refresh Token', type: 'password' },
    ],
    instructions: [
      'Go to console.cloud.google.com',
      'Create a project (or select existing)',
      'Enable the Gmail API: APIs & Services → Library → search "Gmail API" → Enable',
      'Create OAuth credentials: APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID',
      'Application type: Web application',
      'Add redirect URI: https://developers.google.com/oauthplayground',
      'Copy the Client ID and Client Secret',
      'Get a refresh token:',
      '  Go to developers.google.com/oauthplayground',
      '  Click the gear icon → check "Use your own OAuth credentials"',
      '  Enter your Client ID and Secret',
      '  In Step 1, find "Gmail API v1" → select all scopes → Authorize',
      '  In Step 2, click "Exchange authorization code for tokens"',
      '  Copy the Refresh Token',
      '⚠️ Add all 3 to Vercel env vars, then redeploy',
    ],
    testEndpoint: '/api/gmail?action=profile',
  },
  {
    id: 'twilio',
    title: 'Twilio SMS',
    desc: 'Send & receive text messages',
    icon: '💬',
    clientSide: false,
    fields: [
      { key: 'TWILIO_ACCOUNT_SID', label: 'Account SID', type: 'text' },
      { key: 'TWILIO_AUTH_TOKEN', label: 'Auth Token', type: 'password' },
      { key: 'TWILIO_PHONE_NUMBER', label: 'Phone Number', type: 'text' },
    ],
    instructions: [
      'Go to twilio.com → sign up (free trial available)',
      'From the Console dashboard, copy your Account SID and Auth Token',
      'Buy a phone number: Phone Numbers → Manage → Buy a number',
      'Copy the phone number (format: +1XXXXXXXXXX)',
      '⚠️ Add all 3 to Vercel env vars, then redeploy',
      '',
      'For incoming SMS, set this webhook URL on your Twilio number:',
      '  https://connecteam-proxy.vercel.app/api/sms?action=webhook',
      '  (Phone Numbers → Manage → Active → click your number → Messaging webhook)',
    ],
    testEndpoint: '/api/sms?action=list&limit=1',
  },
  {
    id: 'square',
    title: 'Square Payroll',
    desc: 'Export payroll & sync team',
    icon: '💰',
    clientSide: false,
    fields: [{ key: 'SQUARE_ACCESS_TOKEN', label: 'Access Token', type: 'password' }],
    instructions: [
      'Go to developer.squareup.com',
      'Sign in with your Square account',
      'Create an application (or select existing)',
      'Go to Credentials tab',
      'Copy the Production Access Token (or Sandbox for testing)',
      '⚠️ Add to Vercel as SQUARE_ACCESS_TOKEN, then redeploy',
    ],
    testEndpoint: '/api/square?action=team',
  },
]

export default function Setup() {
  const [currentStep, setCurrentStep] = useState(0)
  const [statuses, setStatuses] = useState({})
  const [testing, setTesting] = useState({})
  const [values, setValues] = useState({})
  const [expandedStep, setExpandedStep] = useState(null)

  // Check all integrations on mount
  useEffect(() => { checkAll() }, [])

  async function checkAll() {
    const results = {}

    // Connecteam
    const ctKey = getApiKey()
    if (ctKey) {
      try {
        const res = await fetch(`/api/connecteam?path=me`, { headers: { 'X-API-KEY': ctKey } })
        results.connecteam = res.ok ? 'connected' : 'error'
      } catch { results.connecteam = 'error' }
    } else {
      results.connecteam = 'not_configured'
    }

    // Anthropic
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }], context: '' }),
      })
      results.anthropic = res.status === 500 ? 'not_configured' : 'connected'
    } catch { results.anthropic = 'not_configured' }

    // Supabase
    results.supabase = isSupabaseConfigured() ? 'connected' : 'not_configured'

    // Gmail
    try {
      const res = await fetch('/api/gmail?action=profile')
      results.gmail = res.ok ? 'connected' : 'not_configured'
    } catch { results.gmail = 'not_configured' }

    // Twilio
    try {
      const res = await fetch('/api/sms?action=list&limit=1')
      results.twilio = res.ok ? 'connected' : 'not_configured'
    } catch { results.twilio = 'not_configured' }

    // Square
    try {
      const res = await fetch('/api/square?action=team')
      results.square = res.ok ? 'connected' : 'not_configured'
    } catch { results.square = 'not_configured' }

    setStatuses(results)

    // Find first unconfigured step
    const firstUnconfigured = STEPS.findIndex(s => results[s.id] !== 'connected')
    if (firstUnconfigured >= 0) setCurrentStep(firstUnconfigured)
  }

  async function testIntegration(step) {
    setTesting(prev => ({ ...prev, [step.id]: true }))

    try {
      if (step.id === 'connecteam' && values.connecteam_api_key) {
        // Save key first
        setApiKey(values.connecteam_api_key)
        const res = await fetch(`/api/connecteam?path=me`, {
          headers: { 'X-API-KEY': values.connecteam_api_key },
        })
        if (res.ok) {
          const data = await res.json()
          setStatuses(prev => ({ ...prev, connecteam: 'connected' }))
          setValues(prev => ({ ...prev, connecteam_result: `Connected to: ${data.data?.companyName || 'your company'}` }))
        } else {
          setStatuses(prev => ({ ...prev, connecteam: 'error' }))
          setValues(prev => ({ ...prev, connecteam_result: 'Invalid API key' }))
        }
      } else if (step.testEndpoint) {
        const opts = { headers: { 'Content-Type': 'application/json' } }
        if (step.testMethod === 'POST') {
          opts.method = 'POST'
          opts.body = JSON.stringify(step.testBody || {})
        }
        const res = await fetch(step.testEndpoint, opts)
        if (res.ok) {
          setStatuses(prev => ({ ...prev, [step.id]: 'connected' }))
          setValues(prev => ({ ...prev, [`${step.id}_result`]: 'Connected!' }))
        } else {
          const data = await res.json().catch(() => ({}))
          setStatuses(prev => ({ ...prev, [step.id]: 'error' }))
          setValues(prev => ({ ...prev, [`${step.id}_result`]: data.error || `Error: ${res.status}` }))
        }
      } else if (step.testCheck) {
        const ok = step.testCheck()
        setStatuses(prev => ({ ...prev, [step.id]: ok ? 'connected' : 'not_configured' }))
        setValues(prev => ({ ...prev, [`${step.id}_result`]: ok ? 'Connected!' : 'Not configured yet' }))
      }
    } catch (err) {
      setStatuses(prev => ({ ...prev, [step.id]: 'error' }))
      setValues(prev => ({ ...prev, [`${step.id}_result`]: err.message }))
    } finally {
      setTesting(prev => ({ ...prev, [step.id]: false }))
    }
  }

  const connectedCount = STEPS.filter(s => statuses[s.id] === 'connected').length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Setup Wizard</h1>
        <p className="text-sm text-gray-500 mt-1">Connect your services step by step. {connectedCount}/{STEPS.length} integrations active.</p>
      </div>

      {/* Progress bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-400">Setup Progress</span>
          <span className="text-sm font-mono text-white">{connectedCount}/{STEPS.length}</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2">
          <div className="bg-blue-500 h-2 rounded-full transition-all duration-500" style={{ width: `${(connectedCount / STEPS.length) * 100}%` }} />
        </div>
        <div className="flex justify-between mt-3">
          {STEPS.map((step, i) => (
            <button key={step.id} onClick={() => { setCurrentStep(i); setExpandedStep(step.id) }}
              className={`flex flex-col items-center gap-1 transition-colors ${
                statuses[step.id] === 'connected' ? 'text-green-400' :
                currentStep === i ? 'text-blue-400' : 'text-gray-600'
              }`}>
              <span className="text-lg">{step.icon}</span>
              <span className="text-xs">{step.title.split(' ')[0]}</span>
              {statuses[step.id] === 'connected' && (
                <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Steps */}
      {STEPS.map((step, i) => {
        const status = statuses[step.id]
        const isExpanded = expandedStep === step.id || (expandedStep === null && i === currentStep)

        return (
          <div key={step.id} className={`bg-gray-900 border rounded-xl overflow-hidden transition-colors ${
            status === 'connected' ? 'border-green-800/50' :
            isExpanded ? 'border-blue-800/50' : 'border-gray-800'
          }`}>
            {/* Header */}
            <button onClick={() => setExpandedStep(isExpanded ? null : step.id)}
              className="w-full px-5 py-4 flex items-center justify-between text-left">
              <div className="flex items-center gap-3">
                <span className="text-xl">{step.icon}</span>
                <div>
                  <h3 className="text-sm font-semibold text-white">{step.title}</h3>
                  <p className="text-xs text-gray-500">{step.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  status === 'connected' ? 'bg-green-900/40 text-green-400' :
                  status === 'error' ? 'bg-red-900/40 text-red-400' :
                  'bg-gray-800 text-gray-500'
                }`}>
                  {status === 'connected' ? 'Connected' : status === 'error' ? 'Error' : 'Not configured'}
                </span>
                <svg className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-5 pb-5 border-t border-gray-800 pt-4 space-y-4">
                {/* Instructions */}
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2">Setup Instructions</h4>
                  <ol className="space-y-1.5">
                    {step.instructions.map((inst, j) => (
                      <li key={j} className={`text-sm ${inst.startsWith('⚠️') ? 'text-yellow-400 font-medium' : inst.startsWith('  ') ? 'text-gray-500 ml-4' : 'text-gray-300'}`}>
                        {!inst.startsWith('⚠️') && !inst.startsWith('  ') && inst && (
                          <span className="text-gray-600 mr-2">{j + 1}.</span>
                        )}
                        {inst}
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Input fields for client-side keys */}
                {step.clientSide && (
                  <div className="space-y-3">
                    {step.fields.map(field => (
                      <div key={field.key}>
                        <label className="block text-xs text-gray-500 mb-1">{field.label}</label>
                        <input
                          type={field.type}
                          value={values[field.key] || ''}
                          onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                          placeholder={`Paste your ${field.label}...`}
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Server-side env var reminder */}
                {!step.clientSide && (
                  <div className="bg-blue-900/10 border border-blue-800/30 rounded-lg p-3">
                    <p className="text-xs text-blue-400">
                      These keys are added in <strong>Vercel</strong> → your project → <strong>Settings</strong> → <strong>Environment Variables</strong>.
                      After adding, go to <strong>Deployments</strong> and <strong>Redeploy</strong>.
                    </p>
                    <div className="mt-2 space-y-1">
                      {step.fields.map(f => (
                        <code key={f.key} className="block text-xs text-gray-400 bg-gray-800 rounded px-2 py-1">{f.key} = &lt;your {f.label.toLowerCase()}&gt;</code>
                      ))}
                    </div>
                  </div>
                )}

                {/* Test button */}
                <div className="flex items-center gap-3">
                  <button onClick={() => testIntegration(step)}
                    disabled={testing[step.id]}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors">
                    {testing[step.id] ? 'Testing...' : 'Test Connection'}
                  </button>
                  {values[`${step.id}_result`] && (
                    <span className={`text-sm ${status === 'connected' ? 'text-green-400' : 'text-red-400'}`}>
                      {values[`${step.id}_result`]}
                    </span>
                  )}
                </div>

                {/* Next button */}
                {status === 'connected' && i < STEPS.length - 1 && (
                  <button onClick={() => { setCurrentStep(i + 1); setExpandedStep(STEPS[i + 1].id) }}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
                    Next: {STEPS[i + 1].title} →
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* All done */}
      {connectedCount === STEPS.length && (
        <div className="bg-green-900/20 border border-green-800 rounded-xl p-6 text-center">
          <p className="text-lg font-semibold text-green-400">All integrations connected!</p>
          <p className="text-sm text-gray-400 mt-1">Your Workflow HQ is fully set up.</p>
        </div>
      )}

      {connectedCount > 0 && connectedCount < STEPS.length && (
        <p className="text-center text-sm text-gray-500">
          You can skip integrations you don't need right now. The app works with whatever you have configured.
        </p>
      )}
    </div>
  )
}
