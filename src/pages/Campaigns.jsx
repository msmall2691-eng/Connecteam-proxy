import { useState, useEffect } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import { getClientsAsync, getClients } from '../lib/store'

const CHANNEL_LABELS = { sms: 'SMS', email: 'Email', both: 'Both' }
const STATUS_COLORS = {
  draft: 'bg-gray-800 text-gray-400',
  sent: 'bg-green-900/30 text-green-400',
  active: 'bg-blue-900/30 text-blue-400',
  paused: 'bg-yellow-900/30 text-yellow-400',
  completed: 'bg-purple-900/30 text-purple-400',
  scheduled: 'bg-amber-900/30 text-amber-400',
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('blasts') // 'blasts' | 'sequences'
  const [showCreate, setShowCreate] = useState(false)
  const [sending, setSending] = useState(null)
  const [clients, setClients] = useState([])

  // Create form state
  const [form, setForm] = useState({
    name: '', type: 'blast', channel: 'sms', subject: '', body: '',
    audience: { status: 'active' }, steps: [],
  })

  useEffect(() => { loadCampaigns(); loadClients() }, [])

  async function loadClients() {
    const c = isSupabaseConfigured() ? await getClientsAsync() : getClients()
    setClients(c || [])
  }

  async function loadCampaigns() {
    setLoading(true)
    try {
      const res = await fetch('/api/campaigns?action=list')
      const data = await res.json()
      setCampaigns(data.campaigns || [])
    } catch (e) {
      console.error('Failed to load campaigns:', e)
    }
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    const payload = { ...form, type: tab === 'blasts' ? 'blast' : 'sequence' }
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...payload }),
      })
      if (res.ok) {
        setShowCreate(false)
        setForm({ name: '', type: 'blast', channel: 'sms', subject: '', body: '', audience: { status: 'active' }, steps: [] })
        loadCampaigns()
      }
    } catch (e) { console.error('Create failed:', e) }
  }

  async function sendBlast(campaignId) {
    if (!confirm('Send this campaign to all matching clients now?')) return
    setSending(campaignId)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-blast', campaignId }),
      })
      const data = await res.json()
      alert(`Sent to ${data.sent} of ${data.total} clients${data.failed ? ` (${data.failed} failed)` : ''}`)
      loadCampaigns()
    } catch (e) { alert('Send failed: ' + e.message) }
    setSending(null)
  }

  async function deleteCampaign(campaignId) {
    if (!confirm('Delete this campaign?')) return
    try {
      await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', campaignId }),
      })
      loadCampaigns()
    } catch (e) { console.error('Delete failed:', e) }
  }

  function addStep() {
    setForm(f => ({
      ...f,
      steps: [...f.steps, { step_order: f.steps.length, delay_days: f.steps.length === 0 ? 0 : 2, channel: f.channel, subject: '', body: '' }],
    }))
  }

  function updateStep(index, field, value) {
    setForm(f => ({
      ...f,
      steps: f.steps.map((s, i) => i === index ? { ...s, [field]: value } : s),
    }))
  }

  function removeStep(index) {
    setForm(f => ({
      ...f,
      steps: f.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i })),
    }))
  }

  // Count audience preview
  const audienceCount = clients.filter(c => {
    if (form.audience.status && c.status !== form.audience.status) return false
    if (form.audience.type && c.type !== form.audience.type) return false
    return true
  }).length

  const filtered = campaigns.filter(c => tab === 'blasts' ? c.type === 'blast' : c.type === 'sequence')

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Campaigns</h1>
          <p className="text-xs text-gray-500">Send blasts and automate drip sequences</p>
        </div>
        <button onClick={() => { setShowCreate(true); setForm(f => ({ ...f, type: tab === 'blasts' ? 'blast' : 'sequence' })) }}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-500">
          + New {tab === 'blasts' ? 'Blast' : 'Sequence'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 bg-gray-800 rounded-lg p-0.5 w-fit">
        <button onClick={() => setTab('blasts')}
          className={`px-4 py-1.5 rounded text-xs font-medium ${tab === 'blasts' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
          Blasts
        </button>
        <button onClick={() => setTab('sequences')}
          className={`px-4 py-1.5 rounded text-xs font-medium ${tab === 'sequences' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
          Sequences
        </button>
      </div>

      {/* Campaign list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">No {tab} yet</p>
          <p className="text-gray-600 text-xs mt-1">
            {tab === 'blasts' ? 'Send a one-time SMS or email to a group of clients' : 'Set up automated drip campaigns triggered by events'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div key={c.id} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-white truncate">{c.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[c.status] || STATUS_COLORS.draft}`}>
                      {c.status}
                    </span>
                    <span className="text-xs text-gray-500">{CHANNEL_LABELS[c.channel] || c.channel}</span>
                  </div>
                  {c.body && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{c.body}</p>}
                  {c.type === 'sequence' && c.steps?.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">{c.steps.length} step{c.steps.length > 1 ? 's' : ''}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    {c.sent_at && <span>Sent {new Date(c.sent_at).toLocaleDateString()}</span>}
                    {c.sent_count > 0 && <span>{c.sent_count} delivered</span>}
                    {c.audience && Object.keys(c.audience).length > 0 && (
                      <span>Audience: {Object.entries(c.audience).map(([k, v]) => `${k}=${v}`).join(', ')}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3">
                  {c.type === 'blast' && c.status === 'draft' && (
                    <button onClick={() => sendBlast(c.id)} disabled={sending === c.id}
                      className="px-2.5 py-1 bg-green-600/20 text-green-400 text-xs rounded hover:bg-green-600/30 disabled:opacity-50">
                      {sending === c.id ? 'Sending...' : 'Send Now'}
                    </button>
                  )}
                  <button onClick={() => deleteCampaign(c.id)}
                    className="px-2 py-1 text-red-400/60 text-xs rounded hover:text-red-400 hover:bg-red-900/20">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-white mb-4">
              New {tab === 'blasts' ? 'Blast Campaign' : 'Drip Sequence'}
            </h2>
            <form onSubmit={handleCreate} className="space-y-3">
              {/* Name */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Campaign Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={tab === 'blasts' ? 'e.g. Spring Cleaning Promo' : 'e.g. New Lead Welcome'}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>

              {/* Channel */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Channel</label>
                <div className="flex gap-1">
                  {['sms', 'email', 'both'].map(ch => (
                    <button type="button" key={ch} onClick={() => setForm(f => ({ ...f, channel: ch }))}
                      className={`px-3 py-1.5 rounded text-xs ${form.channel === ch ? 'bg-blue-600/20 text-blue-400 border border-blue-600/40' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
                      {CHANNEL_LABELS[ch]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Audience */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Audience ({audienceCount} clients)</label>
                <div className="flex gap-2">
                  <select value={form.audience.status || ''} onChange={e => setForm(f => ({ ...f, audience: { ...f.audience, status: e.target.value || undefined } }))}
                    className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-white">
                    <option value="">Any Status</option>
                    <option value="lead">Leads</option>
                    <option value="prospect">Prospects</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <select value={form.audience.type || ''} onChange={e => setForm(f => ({ ...f, audience: { ...f.audience, type: e.target.value || undefined } }))}
                    className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-white">
                    <option value="">Any Type</option>
                    <option value="residential">Residential</option>
                    <option value="commercial">Commercial</option>
                    <option value="rental">Rental</option>
                  </select>
                </div>
              </div>

              {/* Blast: single message */}
              {tab === 'blasts' && (
                <>
                  {(form.channel === 'email' || form.channel === 'both') && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Email Subject</label>
                      <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                        placeholder="e.g. Spring Special - 20% Off Your Next Clean!"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Message Body</label>
                    <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                      placeholder="Hi {first_name}! ..."
                      rows={4}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                    <p className="text-xs text-gray-600 mt-1">Use {'{first_name}'} or {'{name}'} for personalization</p>
                  </div>
                </>
              )}

              {/* Sequence: multiple steps */}
              {tab === 'sequences' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-400">Steps</label>
                    <button type="button" onClick={addStep} className="text-xs text-blue-400 hover:text-blue-300">+ Add Step</button>
                  </div>
                  {form.steps.length === 0 && (
                    <p className="text-xs text-gray-600 text-center py-3">No steps yet. Add steps to build your sequence.</p>
                  )}
                  {form.steps.map((step, i) => (
                    <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-300">Step {i + 1}</span>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-500">Delay:</label>
                          <input type="number" min="0" value={step.delay_days}
                            onChange={e => updateStep(i, 'delay_days', parseInt(e.target.value) || 0)}
                            className="w-14 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white text-center" />
                          <span className="text-xs text-gray-500">days</span>
                          <button type="button" onClick={() => removeStep(i)} className="text-red-400/60 hover:text-red-400 text-xs ml-2">Remove</button>
                        </div>
                      </div>
                      {(step.channel === 'email' || step.channel === 'both') && (
                        <input value={step.subject || ''} onChange={e => updateStep(i, 'subject', e.target.value)}
                          placeholder="Email subject..."
                          className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                      )}
                      <textarea value={step.body || ''} onChange={e => updateStep(i, 'body', e.target.value)}
                        placeholder={`Step ${i + 1} message... Use {first_name} for personalization`}
                        rows={3}
                        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
                <button type="submit"
                  className="px-4 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-500">
                  Create {tab === 'blasts' ? 'Blast' : 'Sequence'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
