import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getConversations, getConversationsAsync, getClients, getClientsAsync, addMessage, addMessageAsync, saveConversation, saveConversationAsync } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'

export default function Communications() {
  const [convos, setConvos] = useState([])
  const [clients, setClients] = useState({})
  const [active, setActive] = useState(null)
  const [newMsg, setNewMsg] = useState('')
  const [search, setSearch] = useState('')
  const [filterChannel, setFilterChannel] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [newConvo, setNewConvo] = useState({ clientId: '', subject: '', channel: 'email' })
  const [gmailEmails, setGmailEmails] = useState([])
  const [gmailLoading, setGmailLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [viewMode, setViewMode] = useState('conversations') // 'conversations' | 'inbox'
  const bottomRef = useRef(null)

  useEffect(() => { reload(); fetchGmail() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active])

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
      if (updated) setActive(updated)
    }
  }

  // Fetch Gmail inbox
  async function fetchGmail(query = '') {
    setGmailLoading(true)
    try {
      const q = query || ''
      const res = await fetch(`/api/gmail?action=list&maxResults=30${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      if (res.ok) {
        const data = await res.json()
        // Match emails to known clients
        const enriched = (data.messages || []).map(m => {
          const fromEmail = m.from.match(/<(.+)>/)?.[1] || m.from
          const clientMatch = Object.values(clients).find(c => c.email && fromEmail.toLowerCase().includes(c.email.toLowerCase()))
          return { ...m, clientMatch, fromEmail, fromName: m.from.split('<')[0].trim() }
        })
        setGmailEmails(enriched)
      }
    } catch {}
    setGmailLoading(false)
  }

  // Import a Gmail thread into a client conversation
  async function importThread(email) {
    const client = email.clientMatch
    const _save = isSupabaseConfigured() ? saveConversationAsync : saveConversation
    const _msg = isSupabaseConfigured() ? addMessageAsync : addMessage
    const convo = await _save({
      clientId: client?.id || '',
      subject: email.subject,
      channel: 'email',
      gmailThreadId: email.threadId,
      messages: [],
    })

    try {
      const res = await fetch(`/api/gmail?action=thread&threadId=${email.threadId}`)
      if (res.ok) {
        const data = await res.json()
        for (const msg of data.messages || []) {
          const isInbound = !msg.from.includes('maine-clean') && !msg.from.includes('info@')
          await _msg(convo.id, {
            content: msg.body || msg.snippet,
            direction: isInbound ? 'inbound' : 'outbound',
            sender: msg.from.split('<')[0].trim(),
            channel: 'email',
            gmailMessageId: msg.id,
          })
        }
      }
    } catch {}

    await reload()
    const allConvos = isSupabaseConfigured() ? await getConversationsAsync() : getConversations()
    setActive(allConvos.find(c => c.id === convo.id))
    setViewMode('conversations')
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!newMsg.trim() || !active) return
    setSending(true)
    setSendError(null)

    const client = clients[active.clientId]

    // Email via Gmail
    if (active.channel === 'email' && client?.email) {
      try {
        const res = await fetch('/api/gmail', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send', to: client.email, subject: active.subject, body: newMsg.trim(), threadId: active.gmailThreadId || undefined }),
        })
        if (res.ok) {
          const data = await res.json()
          const _msg = isSupabaseConfigured() ? addMessageAsync : addMessage
          await _msg(active.id, { content: newMsg.trim(), direction: 'outbound', sender: 'You', channel: 'email', gmailMessageId: data.messageId })
          setNewMsg(''); reload(); setSending(false); return
        } else { const err = await res.json().catch(() => ({})); setSendError(err.error || 'Email failed') }
      } catch (err) { setSendError(err.message || 'Email failed') }
    }

    // SMS via Twilio
    if (active.channel === 'text' && client?.phone) {
      try {
        const res = await fetch('/api/sms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send', to: client.phone, body: newMsg.trim() }),
        })
        if (res.ok) {
          const data = await res.json()
          const _msg2 = isSupabaseConfigured() ? addMessageAsync : addMessage
          await _msg2(active.id, { content: newMsg.trim(), direction: 'outbound', sender: 'You', channel: 'text', twilioSid: data.sid })
          setNewMsg(''); reload(); setSending(false); return
        } else { const err = await res.json().catch(() => ({})); setSendError(err.error || 'SMS failed') }
      } catch (err) { setSendError(err.message || 'SMS failed') }
    }

    // Fallback: local
    const _msgLocal = isSupabaseConfigured() ? addMessageAsync : addMessage
    await _msgLocal(active.id, { content: newMsg.trim(), direction: 'outbound', sender: 'You' })
    setNewMsg(''); reload(); setSending(false)
  }

  async function logInbound() {
    if (!active) return
    const content = prompt('Paste the message received:')
    if (!content) return
    const _msg = isSupabaseConfigured() ? addMessageAsync : addMessage
    await _msg(active.id, { content, direction: 'inbound', sender: clients[active.clientId]?.name || 'Client' })
    reload()
  }

  async function createConvo(e) {
    e.preventDefault()
    if (!newConvo.clientId || !newConvo.subject.trim()) return
    const _save = isSupabaseConfigured() ? saveConversationAsync : saveConversation
    await _save({ ...newConvo, messages: [] })
    setShowNew(false)
    setNewConvo({ clientId: '', subject: '', channel: 'email' })
    reload()
  }

  const filtered = convos.filter(c => {
    if (filterChannel !== 'all' && c.channel !== filterChannel) return false
    if (search) {
      const s = search.toLowerCase()
      const name = clients[c.clientId]?.name || ''
      return name.toLowerCase().includes(s) || c.subject?.toLowerCase().includes(s) || c.lastMessage?.toLowerCase().includes(s)
    }
    return true
  })

  const clientList = Object.values(clients)
  const CHANNEL_COLORS = { email: 'bg-blue-900/30 text-blue-400', text: 'bg-green-900/30 text-green-400', phone: 'bg-yellow-900/30 text-yellow-400', 'in-person': 'bg-gray-800 text-gray-400' }

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Left panel */}
      <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-gray-800 flex flex-col bg-gray-900/50 md:max-h-full max-h-[40vh]">
        {/* Header */}
        <div className="p-3 space-y-2 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Communications</h2>
            <button onClick={() => setShowNew(true)} className="text-xs text-blue-400 hover:text-blue-300">+ New</button>
          </div>

          {/* View toggle */}
          <div className="flex gap-0.5 bg-gray-800 rounded-lg p-0.5">
            <button onClick={() => setViewMode('conversations')} className={`flex-1 px-2 py-1 rounded text-xs ${viewMode === 'conversations' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>Threads</button>
            <button onClick={() => { setViewMode('inbox'); if (gmailEmails.length === 0) fetchGmail() }} className={`flex-1 px-2 py-1 rounded text-xs ${viewMode === 'inbox' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>Gmail</button>
          </div>

          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={viewMode === 'inbox' ? 'Search Gmail...' : 'Search threads...'}
            onKeyDown={e => { if (e.key === 'Enter' && viewMode === 'inbox') fetchGmail(search) }}
            className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />

          {viewMode === 'conversations' && (
            <div className="flex gap-1">
              {['all', 'email', 'text', 'phone'].map(ch => (
                <button key={ch} onClick={() => setFilterChannel(ch)}
                  className={`px-2 py-1 rounded text-xs ${filterChannel === ch ? 'bg-blue-600/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
                  {ch === 'all' ? 'All' : ch.charAt(0).toUpperCase() + ch.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New conversation form */}
        {showNew && (
          <form onSubmit={createConvo} className="p-3 border-b border-gray-800 space-y-2 bg-gray-900">
            <select required value={newConvo.clientId} onChange={e => setNewConvo({ ...newConvo, clientId: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white">
              <option value="">Select client...</option>
              {clientList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input required value={newConvo.subject} onChange={e => setNewConvo({ ...newConvo, subject: e.target.value })}
              placeholder="Subject" className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={newConvo.channel} onChange={e => setNewConvo({ ...newConvo, channel: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white">
              <option value="email">Email</option><option value="text">Text/SMS</option><option value="phone">Phone</option>
            </select>
            <div className="flex gap-2">
              <button type="submit" className="px-2.5 py-1 bg-blue-600 rounded text-xs text-white">Create</button>
              <button type="button" onClick={() => setShowNew(false)} className="px-2.5 py-1 bg-gray-800 rounded text-xs text-gray-300">Cancel</button>
            </div>
          </form>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {viewMode === 'conversations' && (
            <>
              {filtered.length === 0 && <p className="p-4 text-sm text-gray-500 text-center">No conversations</p>}
              {filtered.map(c => {
                const client = clients[c.clientId]
                return (
                  <button key={c.id} onClick={() => setActive(c)}
                    className={`w-full text-left px-3 py-3 border-b border-gray-800/50 transition-colors ${active?.id === c.id ? 'bg-blue-600/10' : 'hover:bg-gray-800/50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white truncate">{client?.name || 'Unknown'}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs ${CHANNEL_COLORS[c.channel] || 'bg-gray-800 text-gray-400'}`}>{c.channel}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{c.subject}</p>
                    <p className="text-xs text-gray-600 mt-0.5 truncate">{c.lastMessage || 'No messages'}</p>
                  </button>
                )
              })}
            </>
          )}

          {viewMode === 'inbox' && (
            <>
              {gmailLoading && <p className="p-4 text-xs text-gray-500 text-center">Loading Gmail...</p>}
              {!gmailLoading && gmailEmails.length === 0 && <p className="p-4 text-xs text-gray-500 text-center">Click to load Gmail or search above</p>}
              {gmailEmails.map(em => (
                <button key={em.id} onClick={() => importThread(em)}
                  className="w-full text-left px-3 py-3 border-b border-gray-800/50 hover:bg-gray-800/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white truncate">{em.fromName}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {em.clientMatch && <span className="px-1 py-0.5 rounded text-xs bg-green-900/30 text-green-400">Client</span>}
                      <span className="text-xs text-gray-600">{em.date ? new Date(em.date).toLocaleDateString() : ''}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-300 mt-0.5 truncate">{em.subject}</p>
                  <p className="text-xs text-gray-600 mt-0.5 truncate">{em.snippet}</p>
                  {em.clientMatch && <p className="text-xs text-green-500 mt-0.5">→ {em.clientMatch.name}</p>}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Right panel - conversation detail */}
      <div className="flex-1 flex flex-col">
        {active ? (
          <>
            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-white">{clients[active.clientId]?.name || 'Unknown'}</h3>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${CHANNEL_COLORS[active.channel] || 'bg-gray-800 text-gray-400'}`}>{active.channel}</span>
                  {active.gmailThreadId && <span className="px-1.5 py-0.5 rounded text-xs bg-purple-900/30 text-purple-400">Gmail</span>}
                </div>
                <p className="text-xs text-gray-500">{active.subject}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={logInbound} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Log Received</button>
                {active.clientId && <Link to={`/clients/${active.clientId}`} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300">Client</Link>}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {(active.messages || []).map(msg => (
                <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-xl px-4 py-2.5 text-sm ${
                    msg.direction === 'outbound' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-xs mt-1.5 ${msg.direction === 'outbound' ? 'text-blue-200' : 'text-gray-500'}`}>
                      {msg.sender} · {msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ''}
                      {msg.channel === 'email' && <span className="ml-1 text-blue-300/60">(email)</span>}
                      {msg.channel === 'text' && <span className="ml-1 text-green-300/60">(sms)</span>}
                    </p>
                  </div>
                </div>
              ))}
              {(!active.messages || active.messages.length === 0) && (
                <div className="flex items-center justify-center h-full"><p className="text-sm text-gray-500">No messages yet</p></div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Compose */}
            <form onSubmit={sendMessage} className="p-4 border-t border-gray-800 bg-gray-900/50 shrink-0">
              <div className="flex gap-2">
                <textarea value={newMsg} onChange={e => setNewMsg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e) } }}
                  placeholder={`${active.channel === 'email' ? 'Reply via email' : active.channel === 'text' ? 'Send text' : 'Type message'}...`}
                  rows={2}
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                <button type="submit" disabled={!newMsg.trim() || sending}
                  className="self-end px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
                  {sending ? '...' : 'Send'}
                </button>
              </div>
              {sendError && <p className="text-xs text-red-400 mt-1">{sendError}</p>}
              <p className="text-xs text-gray-600 mt-1">Enter to send · Shift+Enter for new line</p>
            </form>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <p className="text-gray-500">Select a conversation</p>
              <p className="text-xs text-gray-600">or switch to Gmail tab to import threads</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
