import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getConversations, getConversationsAsync, getClients, getClientsAsync, addMessage, addMessageAsync, saveConversation, saveConversationAsync, getMessagesAsync, getJobsAsync, getPropertiesAsync } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'

// ── Helpers ──────────────────────────────────────────────
function relativeTime(date) {
  if (!date) return ''
  const now = new Date(), d = new Date(date)
  const diffMs = now - d, diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000), diffDay = Math.floor(diffMs / 86400000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m`
  if (diffHr < 24) return `${diffHr}h`
  if (diffDay === 1) return 'Yesterday'
  if (diffDay < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dateGroup(date) {
  if (!date) return ''
  const now = new Date(), d = new Date(date)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.floor((today - msgDate) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

const CHANNEL_META = {
  email: { label: 'Email', color: 'bg-blue-500', badge: 'bg-blue-900/40 text-blue-400', icon: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75' },
  text: { label: 'SMS', color: 'bg-green-500', badge: 'bg-green-900/40 text-green-400', icon: 'M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z' },
  phone: { label: 'Phone', color: 'bg-yellow-500', badge: 'bg-yellow-900/40 text-yellow-400', icon: 'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z' },
  internal: { label: 'Note', color: 'bg-amber-500', badge: 'bg-amber-900/40 text-amber-400', icon: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z' },
  system: { label: 'System', color: 'bg-gray-500', badge: 'bg-gray-800 text-gray-400', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z' },
}

const QUICK_REPLIES = [
  'Thanks for reaching out! We\'ll get back to you shortly.',
  'We\'ll be there at your scheduled time.',
  'Your invoice has been sent. Please let us know if you have any questions.',
  'Can you confirm your address for us?',
  'We\'ve completed your cleaning! Please let us know if everything looks good.',
  'We have availability this week. Would you like to schedule a visit?',
]

const STATUS_META = {
  open: { label: 'Open', color: 'text-green-400', bg: 'bg-green-500', dot: 'bg-green-400' },
  snoozed: { label: 'Snoozed', color: 'text-yellow-400', bg: 'bg-yellow-500', dot: 'bg-yellow-400' },
  closed: { label: 'Closed', color: 'text-gray-500', bg: 'bg-gray-500', dot: 'bg-gray-500' },
}

// ── SVG Icon Component ─────────────────────────────────
function Icon({ path, className = 'w-4 h-4' }) {
  return <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d={path} /></svg>
}

// ── Channel Badge ──────────────────────────────────────
function ChannelBadge({ channel, size = 'sm' }) {
  const meta = CHANNEL_META[channel] || CHANNEL_META.system
  const cls = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-xs'
  return <span className={`inline-flex items-center gap-1 rounded-md font-medium ${meta.badge} ${cls}`}>{meta.label}</span>
}

// ── Avatar ─────────────────────────────────────────────
function Avatar({ name, channel, size = 'md' }) {
  const meta = CHANNEL_META[channel] || CHANNEL_META.email
  const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' }
  return (
    <div className={`${sizes[size]} ${meta.color} rounded-full flex items-center justify-center font-semibold text-white shrink-0`}>
      {initials(name)}
    </div>
  )
}

export default function Communications() {
  // ── State ──────────────────────────────────────────────
  const [convos, setConvos] = useState([])
  const [clients, setClients] = useState({})
  const [active, setActive] = useState(null)
  const [activeMessages, setActiveMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [newMsg, setNewMsg] = useState('')
  const [search, setSearch] = useState('')
  const [filterChannel, setFilterChannel] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [composeMode, setComposeMode] = useState('reply') // 'reply' | 'note'
  const [showQuickReplies, setShowQuickReplies] = useState(false)

  // Gmail
  const [viewMode, setViewMode] = useState('conversations')
  const [gmailEmails, setGmailEmails] = useState([])
  const [gmailLoading, setGmailLoading] = useState(false)
  const [autoImporting, setAutoImporting] = useState(false)
  const [autoImportCount, setAutoImportCount] = useState(0)

  // New conversation modal
  const [showNewModal, setShowNewModal] = useState(false)
  const [newConvo, setNewConvo] = useState({ clientId: '', subject: '', channel: 'email' })

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [clientJobs, setClientJobs] = useState([])
  const [clientProperties, setClientProperties] = useState([])

  // Status & read tracking
  const [statuses, setStatuses] = useState({})
  const [readSet, setReadSet] = useState(new Set())

  const bottomRef = useRef(null)
  const listRef = useRef(null)

  // ── Effects ────────────────────────────────────────────
  useEffect(() => { reload() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeMessages])

  // ── Data Loading ───────────────────────────────────────
  async function reload() {
    let allConvos, allClients
    if (isSupabaseConfigured()) {
      ;[allConvos, allClients] = await Promise.all([getConversationsAsync(), getClientsAsync()])
    } else {
      allConvos = getConversations(); allClients = getClients()
    }
    setConvos(allConvos)
    const cls = {}
    for (const c of allClients) cls[c.id] = c
    setClients(cls)
    if (active) {
      const updated = allConvos.find(c => c.id === active.id)
      if (updated) {
        setActive(updated)
        await loadMessages(updated)
      }
    }
  }

  async function loadMessages(convo) {
    if (!convo) return
    setMessagesLoading(true)
    try {
      if (isSupabaseConfigured()) {
        const msgs = await getMessagesAsync(convo.id)
        setActiveMessages(msgs)
      } else {
        setActiveMessages(convo.messages || [])
      }
    } catch (err) {
      console.error('Failed to load messages:', err)
      setActiveMessages(convo.messages || [])
    }
    setMessagesLoading(false)
  }

  async function loadClientContext(clientId) {
    if (!clientId) { setClientJobs([]); setClientProperties([]); return }
    try {
      if (isSupabaseConfigured()) {
        const [jobs, props] = await Promise.all([getJobsAsync(clientId), getPropertiesAsync(clientId)])
        setClientJobs((jobs || []).slice(0, 5))
        setClientProperties((props || []).slice(0, 5))
      }
    } catch { setClientJobs([]); setClientProperties([]) }
  }

  async function selectConversation(convo) {
    setActive(convo)
    setActiveMessages([])
    setSendError(null)
    setComposeMode('reply')
    setShowQuickReplies(false)
    setReadSet(prev => new Set([...prev, convo.id]))
    await Promise.all([loadMessages(convo), loadClientContext(convo.clientId)])
  }

  function getStatus(id) { return statuses[id] || 'open' }
  function setStatus(id, status) { setStatuses(prev => ({ ...prev, [id]: status })) }

  // ── Gmail ──────────────────────────────────────────────
  async function fetchGmail(query = '') {
    setGmailLoading(true)
    try {
      const q = query || ''
      const res = await fetch(`/api/google?action=gmail-list&maxResults=30${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      if (res.ok) {
        const data = await res.json()
        const enriched = (data.messages || []).map(m => {
          const fromEmail = m.from?.match(/<(.+)>/)?.[1] || m.from || ''
          const clientMatch = Object.values(clients).find(c => c.email && fromEmail.toLowerCase().includes(c.email.toLowerCase()))
          return { ...m, clientMatch, fromEmail, fromName: (m.from || '').split('<')[0].trim() || fromEmail }
        })
        setGmailEmails(enriched)
      }
    } catch {}
    setGmailLoading(false)
  }

  async function importThread(email) {
    const client = email.clientMatch
    const _save = isSupabaseConfigured() ? saveConversationAsync : saveConversation
    const _msg = isSupabaseConfigured() ? addMessageAsync : addMessage
    const convo = await _save({ clientId: client?.id || '', subject: email.subject, channel: 'email', gmailThreadId: email.threadId, messages: [] })
    try {
      const res = await fetch(`/api/google?action=gmail-thread&threadId=${email.threadId}`)
      if (res.ok) {
        const data = await res.json()
        for (const msg of data.messages || []) {
          const isInbound = !msg.from?.includes('maine-clean') && !msg.from?.includes('info@')
          await _msg(convo.id, { content: msg.body || msg.snippet, direction: isInbound ? 'inbound' : 'outbound', sender: (msg.from || '').split('<')[0].trim(), channel: 'email', gmailMessageId: msg.id })
        }
      }
    } catch {}
    await reload()
    const allConvos = isSupabaseConfigured() ? await getConversationsAsync() : getConversations()
    const imported = allConvos.find(c => c.id === convo.id)
    if (imported) await selectConversation(imported)
    setViewMode('conversations')
  }

  async function autoImportClientEmails() {
    setAutoImporting(true); setAutoImportCount(0)
    try {
      const existingThreadIds = new Set(convos.filter(c => c.gmailThreadId).map(c => c.gmailThreadId))
      const toImport = gmailEmails.filter(em => em.clientMatch && !existingThreadIds.has(em.threadId))
      for (const em of toImport) { await importThread(em); setAutoImportCount(prev => prev + 1) }
      if (toImport.length === 0) alert('No new client emails to import.')
    } catch (err) { console.error('Auto-import error:', err) }
    finally { setAutoImporting(false) }
  }

  // ── Send Message ───────────────────────────────────────
  async function sendMessage(e) {
    e.preventDefault()
    if (!newMsg.trim() || !active) return
    setSending(true); setSendError(null)

    const client = clients[active.clientId]
    const _msg = isSupabaseConfigured() ? addMessageAsync : addMessage
    const msgText = newMsg.trim()

    try {
      // Internal note
      if (composeMode === 'note') {
        await _msg(active.id, { content: msgText, direction: 'outbound', sender: 'You', channel: 'internal' })
        setNewMsg(''); await reload(); setSending(false); return
      }

      // Email via Gmail
      if (active.channel === 'email') {
        if (!client?.email) { setSendError('No email address on file for this client'); setSending(false); return }
        const res = await fetch('/api/google', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'gmail-send', to: client.email, subject: active.subject, body: msgText, threadId: active.gmailThreadId || undefined }),
        })
        if (!res.ok) { const err = await res.json().catch(() => ({})); setSendError(err.error || 'Email failed to send'); setSending(false); return }
        const data = await res.json()
        await _msg(active.id, { content: msgText, direction: 'outbound', sender: 'You', channel: 'email', gmailMessageId: data.messageId })
      }
      // SMS via Twilio
      else if (active.channel === 'text') {
        if (!client?.phone) { setSendError('No phone number on file for this client'); setSending(false); return }
        const res = await fetch('/api/sms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send', to: client.phone, body: msgText }),
        })
        if (!res.ok) { const err = await res.json().catch(() => ({})); setSendError(err.error || 'SMS failed to send'); setSending(false); return }
        const data = await res.json()
        await _msg(active.id, { content: msgText, direction: 'outbound', sender: 'You', channel: 'text', twilioSid: data.sid })
      }
      // Phone/other
      else {
        await _msg(active.id, { content: msgText, direction: 'outbound', sender: 'You', channel: active.channel })
      }
      setNewMsg(''); await reload()
    } catch (err) { setSendError(err.message || 'Failed to send message') }
    setSending(false)
  }

  async function logInbound() {
    if (!active) return
    const content = prompt('Paste the message received:')
    if (!content) return
    const _msg = isSupabaseConfigured() ? addMessageAsync : addMessage
    await _msg(active.id, { content, direction: 'inbound', sender: clients[active.clientId]?.name || 'Client', channel: active.channel })
    await reload()
  }

  async function createConvo(e) {
    e.preventDefault()
    if (!newConvo.clientId || !newConvo.subject.trim()) return
    const _save = isSupabaseConfigured() ? saveConversationAsync : saveConversation
    const created = await _save({ ...newConvo, messages: [] })
    setShowNewModal(false)
    setNewConvo({ clientId: '', subject: '', channel: 'email' })
    await reload()
    if (created) {
      const allConvos = isSupabaseConfigured() ? await getConversationsAsync() : getConversations()
      const found = allConvos.find(c => c.id === created.id)
      if (found) await selectConversation(found)
    }
  }

  // ── Filtering ──────────────────────────────────────────
  const filtered = convos.filter(c => {
    if (filterChannel !== 'all' && c.channel !== filterChannel) return false
    if (filterStatus !== 'all' && getStatus(c.id) !== filterStatus) return false
    if (search) {
      const s = search.toLowerCase()
      const name = clients[c.clientId]?.name || ''
      return name.toLowerCase().includes(s) || c.subject?.toLowerCase().includes(s) || c.lastMessage?.toLowerCase().includes(s)
    }
    return true
  })

  const clientList = Object.values(clients).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  const activeClient = active ? clients[active.clientId] : null

  // Group messages by date
  const messageGroups = []
  let lastGroup = null
  for (const msg of activeMessages) {
    const group = dateGroup(msg.timestamp)
    if (group !== lastGroup) {
      messageGroups.push({ type: 'date', label: group })
      lastGroup = group
    }
    messageGroups.push({ type: 'message', msg })
  }

  // Counts for status tabs
  const counts = { all: convos.length, open: 0, snoozed: 0, closed: 0 }
  convos.forEach(c => { const s = getStatus(c.id); counts[s] = (counts[s] || 0) + 1 })

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="flex h-full bg-gray-950 overflow-hidden">
      {/* ═══ LEFT PANEL — Conversation List ═══ */}
      <div className="w-80 min-w-[280px] border-r border-gray-800 flex flex-col bg-gray-900/60 shrink-0">
        {/* Header */}
        <div className="p-3 border-b border-gray-800 space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-bold text-white tracking-tight">Inbox</h1>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowNewModal(true)} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors" title="New conversation">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" /></svg>
              </button>
            </div>
          </div>

          {/* View toggle */}
          <div className="flex gap-0.5 bg-gray-800/80 rounded-lg p-0.5">
            <button onClick={() => setViewMode('conversations')} className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'conversations' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}>Threads</button>
            <button onClick={() => { setViewMode('inbox'); if (gmailEmails.length === 0) fetchGmail() }} className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'inbox' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}>Gmail</button>
          </div>

          {/* Search */}
          <div className="relative">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={viewMode === 'inbox' ? 'Search Gmail...' : 'Search conversations...'}
              onKeyDown={e => { if (e.key === 'Enter' && viewMode === 'inbox') fetchGmail(search) }}
              className="w-full pl-8 pr-3 py-2 bg-gray-800/80 border border-gray-700/50 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all" />
          </div>

          {viewMode === 'conversations' && (
            <>
              {/* Status tabs */}
              <div className="flex gap-0.5 text-xs">
                {['all', 'open', 'snoozed', 'closed'].map(s => (
                  <button key={s} onClick={() => setFilterStatus(s)}
                    className={`flex-1 px-2 py-1.5 rounded-md font-medium transition-all ${filterStatus === s ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'}`}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                    <span className="ml-1 text-gray-600">{counts[s] || 0}</span>
                  </button>
                ))}
              </div>
              {/* Channel filters */}
              <div className="flex gap-1 flex-wrap">
                {['all', 'email', 'text', 'phone'].map(ch => (
                  <button key={ch} onClick={() => setFilterChannel(ch)}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${filterChannel === ch ? 'bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'}`}>
                    {ch === 'all' ? 'All' : (CHANNEL_META[ch]?.label || ch)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Conversation List */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {viewMode === 'conversations' && (
            <>
              {filtered.length === 0 && <div className="p-6 text-center"><p className="text-sm text-gray-500">No conversations found</p><p className="text-xs text-gray-600 mt-1">Try adjusting your filters</p></div>}
              {filtered.map(c => {
                const client = clients[c.clientId]
                const isActive = active?.id === c.id
                const isRead = readSet.has(c.id)
                const status = getStatus(c.id)
                const statusMeta = STATUS_META[status]
                return (
                  <button key={c.id} onClick={() => selectConversation(c)}
                    className={`w-full text-left px-3 py-3 border-b border-gray-800/30 transition-all duration-150 group relative ${isActive ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : 'hover:bg-gray-800/40 border-l-2 border-l-transparent'}`}>
                    <div className="flex items-start gap-3">
                      <div className="relative">
                        <Avatar name={client?.name} channel={c.channel} size="sm" />
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-900 ${statusMeta.dot}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm truncate ${!isRead ? 'font-semibold text-white' : 'font-medium text-gray-300'}`}>{client?.name || 'Unknown'}</span>
                          <span className="text-xs text-gray-600 shrink-0">{relativeTime(c.updatedAt)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <ChannelBadge channel={c.channel} />
                          <span className="text-xs text-gray-400 truncate">{c.subject || 'No subject'}</span>
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5 truncate">{c.lastMessage || 'No messages yet'}</p>
                      </div>
                      {!isRead && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2" />}
                    </div>
                  </button>
                )
              })}
            </>
          )}

          {viewMode === 'inbox' && (
            <>
              {gmailLoading && <div className="p-6 text-center"><div className="inline-block animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" /><p className="text-xs text-gray-500 mt-2">Loading Gmail...</p></div>}
              {!gmailLoading && gmailEmails.filter(em => em.clientMatch).length > 0 && (
                <div className="px-3 py-2.5 border-b border-gray-800 bg-green-900/10">
                  <button onClick={autoImportClientEmails} disabled={autoImporting}
                    className="w-full text-xs text-green-400 hover:text-green-300 disabled:opacity-50 font-medium flex items-center justify-center gap-1.5">
                    {autoImporting ? <><div className="animate-spin w-3 h-3 border-2 border-green-400 border-t-transparent rounded-full" /> Importing... ({autoImportCount})</> :
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                        Auto-import {gmailEmails.filter(em => em.clientMatch && !convos.some(c => c.gmailThreadId === em.threadId)).length} client threads
                      </>
                    }
                  </button>
                </div>
              )}
              {!gmailLoading && gmailEmails.length === 0 && <div className="p-6 text-center"><p className="text-xs text-gray-500">Search Gmail or click to load inbox</p></div>}
              {gmailEmails.map(em => {
                const alreadyImported = convos.some(c => c.gmailThreadId === em.threadId)
                return (
                  <button key={em.id} onClick={() => !alreadyImported && importThread(em)} disabled={alreadyImported}
                    className={`w-full text-left px-3 py-3 border-b border-gray-800/30 transition-all ${alreadyImported ? 'opacity-40' : 'hover:bg-gray-800/40'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-white truncate">{em.fromName || em.fromEmail}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {em.clientMatch && <span className="px-1.5 py-0.5 rounded text-xs bg-green-900/30 text-green-400 font-medium">Client</span>}
                        {alreadyImported && <span className="px-1.5 py-0.5 rounded text-xs bg-gray-800 text-gray-500">Imported</span>}
                        <span className="text-xs text-gray-600">{em.date ? relativeTime(em.date) : ''}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-300 mt-0.5 truncate">{em.subject}</p>
                    <p className="text-xs text-gray-600 mt-0.5 truncate">{em.snippet}</p>
                    {em.clientMatch && <p className="text-xs text-green-500/70 mt-0.5 font-medium">{em.clientMatch.name}</p>}
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* ═══ CENTER PANEL — Message Thread ═══ */}
      <div className="flex-1 flex flex-col min-w-0">
        {active ? (
          <>
            {/* Thread Header */}
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-900/40 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={activeClient?.name} channel={active.channel} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-white truncate">{activeClient?.name || 'Unknown'}</h2>
                    <ChannelBadge channel={active.channel} />
                    {active.gmailThreadId && <span className="px-1.5 py-0.5 rounded text-xs bg-purple-900/30 text-purple-400 font-medium">Gmail Thread</span>}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{active.subject || 'No subject'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Status dropdown */}
                <select value={getStatus(active.id)} onChange={e => setStatus(active.id, e.target.value)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border-0 cursor-pointer focus:ring-2 focus:ring-blue-500/50 ${
                    getStatus(active.id) === 'open' ? 'bg-green-900/30 text-green-400' :
                    getStatus(active.id) === 'snoozed' ? 'bg-yellow-900/30 text-yellow-400' :
                    'bg-gray-800 text-gray-400'
                  }`}>
                  <option value="open">Open</option>
                  <option value="snoozed">Snoozed</option>
                  <option value="closed">Closed</option>
                </select>
                <button onClick={logInbound} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors font-medium" title="Log a received message">
                  Log Received
                </button>
                <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors" title="Toggle sidebar">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4.5 h-4.5"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {messagesLoading && (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="inline-block animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
                    <p className="text-sm text-gray-500 mt-3">Loading messages...</p>
                  </div>
                </div>
              )}
              {!messagesLoading && messageGroups.map((item, i) => {
                if (item.type === 'date') {
                  return (
                    <div key={`date-${i}`} className="flex items-center gap-3 my-5">
                      <div className="flex-1 h-px bg-gray-800" />
                      <span className="text-xs font-medium text-gray-500 shrink-0">{item.label}</span>
                      <div className="flex-1 h-px bg-gray-800" />
                    </div>
                  )
                }
                const msg = item.msg
                const isNote = msg.channel === 'internal'
                const isOutbound = msg.direction === 'outbound'
                return (
                  <div key={msg.id} className={`flex mb-3 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                    {!isOutbound && <Avatar name={msg.sender} channel={msg.channel || active.channel} size="sm" />}
                    <div className={`max-w-[65%] ${!isOutbound ? 'ml-2.5' : ''} ${isOutbound && !isNote ? 'mr-0' : ''}`}>
                      <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        isNote ? 'bg-amber-900/20 border border-amber-700/30 text-amber-200' :
                        isOutbound ? 'bg-blue-600 text-white' :
                        'bg-gray-800 text-gray-200'
                      }`}>
                        {isNote && <div className="flex items-center gap-1.5 mb-1.5"><Icon path={CHANNEL_META.internal.icon} className="w-3.5 h-3.5 text-amber-400" /><span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Internal Note</span></div>}
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      </div>
                      <div className={`flex items-center gap-1.5 mt-1 px-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                        <span className="text-xs text-gray-600">{msg.sender}</span>
                        <span className="text-gray-700">·</span>
                        <span className="text-xs text-gray-600">{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}</span>
                        {msg.channel && msg.channel !== 'internal' && msg.channel !== active.channel && (
                          <><span className="text-gray-700">·</span><ChannelBadge channel={msg.channel} /></>
                        )}
                        {isOutbound && !isNote && (
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3 text-blue-400"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {!messagesLoading && activeMessages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gray-800/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Icon path={CHANNEL_META[active.channel]?.icon || CHANNEL_META.email.icon} className="w-8 h-8 text-gray-600" />
                    </div>
                    <p className="text-sm text-gray-500 font-medium">No messages yet</p>
                    <p className="text-xs text-gray-600 mt-1">Send the first message to start the conversation</p>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Compose Area */}
            <div className="border-t border-gray-800 bg-gray-900/40 shrink-0">
              {/* Compose mode tabs */}
              <div className="flex items-center gap-1 px-4 pt-3 pb-1">
                <button onClick={() => { setComposeMode('reply'); setShowQuickReplies(false) }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${composeMode === 'reply' ? 'bg-blue-600/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
                  Reply
                </button>
                <button onClick={() => { setComposeMode('note'); setShowQuickReplies(false) }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${composeMode === 'note' ? 'bg-amber-600/20 text-amber-400' : 'text-gray-500 hover:text-gray-300'}`}>
                  <Icon path={CHANNEL_META.internal.icon} className="w-3 h-3" /> Note
                </button>
                <div className="flex-1" />
                {composeMode === 'reply' && (
                  <div className="relative">
                    <button onClick={() => setShowQuickReplies(!showQuickReplies)}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-all flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
                      Quick Reply
                    </button>
                    {showQuickReplies && (
                      <div className="absolute bottom-full right-0 mb-1 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl py-1.5 z-50 max-h-64 overflow-y-auto">
                        {QUICK_REPLIES.map((reply, idx) => (
                          <button key={idx} onClick={() => { setNewMsg(reply); setShowQuickReplies(false) }}
                            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700/50 transition-colors">
                            {reply}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <form onSubmit={sendMessage} className="px-4 pb-3">
                <div className={`rounded-xl border transition-all ${composeMode === 'note' ? 'border-amber-700/40 bg-amber-900/10' : 'border-gray-700/50 bg-gray-800/60'}`}>
                  <textarea value={newMsg} onChange={e => setNewMsg(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e) } }}
                    placeholder={composeMode === 'note' ? 'Write an internal note (not visible to client)...' :
                      active.channel === 'email' ? 'Reply via email...' :
                      active.channel === 'text' ? 'Send text message...' : 'Type a message...'}
                    rows={3}
                    className={`w-full px-3.5 py-2.5 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none resize-none ${composeMode === 'note' ? 'placeholder-amber-600/50' : ''}`} />
                  <div className="flex items-center justify-between px-3 pb-2.5">
                    <p className="text-xs text-gray-600">
                      {composeMode === 'note' ?
                        <span className="text-amber-600/60">Team only - not sent to client</span> :
                        <><kbd className="px-1 py-0.5 bg-gray-700/50 rounded text-gray-500">Enter</kbd> to send · <kbd className="px-1 py-0.5 bg-gray-700/50 rounded text-gray-500">Shift+Enter</kbd> new line</>
                      }
                    </p>
                    <button type="submit" disabled={!newMsg.trim() || sending}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 disabled:opacity-40 ${
                        composeMode === 'note'
                          ? 'bg-amber-600 hover:bg-amber-500 text-white'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}>
                      {sending ? <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> :
                        composeMode === 'note' ? 'Save Note' :
                        <><Icon path={CHANNEL_META[active.channel]?.icon || CHANNEL_META.email.icon} className="w-3.5 h-3.5" /> Send</>
                      }
                    </button>
                  </div>
                </div>
                {sendError && <p className="text-xs text-red-400 mt-1.5 px-1">{sendError}</p>}
              </form>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-xs">
              <div className="w-20 h-20 bg-gray-800/50 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-10 h-10 text-gray-600"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
              </div>
              <h3 className="text-base font-semibold text-gray-400 mb-1">Your Inbox</h3>
              <p className="text-sm text-gray-600 mb-4">Select a conversation from the left or import threads from Gmail</p>
              <button onClick={() => setShowNewModal(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors">
                Start New Conversation
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ RIGHT PANEL — Contact Sidebar ═══ */}
      {active && sidebarOpen && (
        <div className="w-72 min-w-[260px] border-l border-gray-800 bg-gray-900/40 flex flex-col overflow-y-auto shrink-0 hidden lg:flex">
          {/* Client Info */}
          <div className="p-5 border-b border-gray-800 text-center">
            <Avatar name={activeClient?.name} channel={active.channel} size="lg" />
            <h3 className="text-sm font-semibold text-white mt-3">{activeClient?.name || 'Unknown'}</h3>
            {activeClient?.leadStage && (
              <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs bg-blue-900/30 text-blue-400 font-medium capitalize">{activeClient.leadStage}</span>
            )}

            {/* Quick Actions */}
            <div className="flex items-center justify-center gap-2 mt-3">
              {activeClient?.phone && (
                <a href={`tel:${activeClient.phone}`} className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-green-400 transition-colors" title="Call">
                  <Icon path={CHANNEL_META.phone.icon} />
                </a>
              )}
              {activeClient?.email && (
                <a href={`mailto:${activeClient.email}`} className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-blue-400 transition-colors" title="Email">
                  <Icon path={CHANNEL_META.email.icon} />
                </a>
              )}
              {activeClient?.phone && (
                <button onClick={() => { if (active.channel !== 'text') { /* could create SMS convo */ } }} className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-green-400 transition-colors" title="Text">
                  <Icon path={CHANNEL_META.text.icon} />
                </button>
              )}
            </div>
          </div>

          {/* Contact Details */}
          <div className="p-4 border-b border-gray-800 space-y-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact Info</h4>
            {activeClient?.email && (
              <div className="flex items-center gap-2.5">
                <Icon path={CHANNEL_META.email.icon} className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span className="text-xs text-gray-300 truncate">{activeClient.email}</span>
              </div>
            )}
            {activeClient?.phone && (
              <div className="flex items-center gap-2.5">
                <Icon path={CHANNEL_META.phone.icon} className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span className="text-xs text-gray-300">{activeClient.phone}</span>
              </div>
            )}
            {activeClient?.address && (
              <div className="flex items-start gap-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5 text-gray-500 shrink-0 mt-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                <span className="text-xs text-gray-300">{activeClient.address}</span>
              </div>
            )}
            {activeClient?.preferredContact && (
              <div className="flex items-center gap-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5 text-gray-500 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                <span className="text-xs text-gray-300">Prefers <span className="font-medium text-gray-200 capitalize">{activeClient.preferredContact}</span></span>
              </div>
            )}
            {activeClient?.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {activeClient.tags.map((tag, i) => (
                  <span key={i} className="px-2 py-0.5 bg-gray-800 rounded-md text-xs text-gray-400">{tag}</span>
                ))}
              </div>
            )}
          </div>

          {/* Properties */}
          {clientProperties.length > 0 && (
            <div className="p-4 border-b border-gray-800 space-y-2">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Properties</h4>
              {clientProperties.map(p => (
                <div key={p.id} className="p-2.5 bg-gray-800/50 rounded-lg">
                  <p className="text-xs font-medium text-gray-300">{p.name || p.address || 'Property'}</p>
                  {p.address && p.name && <p className="text-xs text-gray-500 mt-0.5">{p.address}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Recent Jobs */}
          {clientJobs.length > 0 && (
            <div className="p-4 border-b border-gray-800 space-y-2">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recent Jobs</h4>
              {clientJobs.map(j => (
                <div key={j.id} className="p-2.5 bg-gray-800/50 rounded-lg">
                  <p className="text-xs font-medium text-gray-300">{j.title || 'Job'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {j.date && <span className="text-xs text-gray-500">{new Date(j.date).toLocaleDateString()}</span>}
                    {j.status && <span className={`text-xs px-1.5 py-0.5 rounded ${j.status === 'completed' ? 'bg-green-900/30 text-green-400' : j.status === 'scheduled' ? 'bg-blue-900/30 text-blue-400' : 'bg-gray-800 text-gray-400'}`}>{j.status}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* View Full Profile */}
          {active.clientId && (
            <div className="p-4">
              <Link to={`/clients/${active.clientId}`}
                className="block w-full text-center px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 font-medium transition-colors">
                View Full Profile
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ═══ NEW CONVERSATION MODAL ═══ */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNewModal(false)} />
          <div className="relative bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4">
            <div className="p-5 border-b border-gray-800">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">New Conversation</h3>
                <button onClick={() => setShowNewModal(false)} className="p-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <form onSubmit={createConvo} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Client</label>
                <select required value={newConvo.clientId} onChange={e => setNewConvo({ ...newConvo, clientId: e.target.value })}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50">
                  <option value="">Select a client...</option>
                  {clientList.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Subject</label>
                <input required value={newConvo.subject} onChange={e => setNewConvo({ ...newConvo, subject: e.target.value })}
                  placeholder="What is this about?" className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Channel</label>
                <div className="grid grid-cols-3 gap-2">
                  {['email', 'text', 'phone'].map(ch => {
                    const meta = CHANNEL_META[ch]
                    return (
                      <button key={ch} type="button" onClick={() => setNewConvo({ ...newConvo, channel: ch })}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                          newConvo.channel === ch ? `${meta.badge} ring-2 ring-current/30` : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        }`}>
                        <Icon path={meta.icon} className="w-4 h-4" />
                        {meta.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold text-white transition-colors">
                  Create Conversation
                </button>
                <button type="button" onClick={() => setShowNewModal(false)}
                  className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm text-gray-300 font-medium transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
