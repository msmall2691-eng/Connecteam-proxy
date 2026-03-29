import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getConversations, getClients, addMessage, saveConversation } from '../lib/store'

export default function Communications() {
  const [convos, setConvos] = useState([])
  const [clients, setClients] = useState({})
  const [active, setActive] = useState(null)
  const [newMsg, setNewMsg] = useState('')
  const [search, setSearch] = useState('')
  const [filterChannel, setFilterChannel] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [newConvo, setNewConvo] = useState({ clientId: '', subject: '', channel: 'email' })
  const [gmailMessages, setGmailMessages] = useState([])
  const [gmailLoading, setGmailLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { reload() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active])

  function reload() {
    const allConvos = getConversations()
    setConvos(allConvos)
    const cls = {}
    for (const c of getClients()) cls[c.id] = c
    setClients(cls)
    if (active) {
      const updated = allConvos.find(c => c.id === active.id)
      if (updated) setActive(updated)
    }
  }

  async function fetchGmail() {
    setGmailLoading(true)
    try {
      const res = await fetch('/api/gmail?action=list&maxResults=20')
      if (res.ok) {
        const data = await res.json()
        setGmailMessages(data.messages || [])
      }
    } catch {}
    setGmailLoading(false)
  }

  async function importGmailThread(gmail) {
    // Find or create client by email
    const fromEmail = gmail.from.match(/<(.+)>/)?.[1] || gmail.from
    const clientList = Object.values(clients)
    let client = clientList.find(c => c.email && fromEmail.includes(c.email))

    if (!client) {
      // Create conversation without client match
      const convo = saveConversation({
        clientId: '',
        subject: gmail.subject,
        channel: 'email',
        gmailThreadId: gmail.threadId,
        messages: [],
      })

      // Fetch thread content
      try {
        const res = await fetch(`/api/gmail?action=thread&threadId=${gmail.threadId}`)
        if (res.ok) {
          const data = await res.json()
          for (const msg of data.messages || []) {
            const isInbound = !msg.from.includes(Object.values(clients)[0]?.email || '')
            addMessage(convo.id, {
              content: msg.body || msg.snippet,
              direction: isInbound ? 'inbound' : 'outbound',
              sender: msg.from.split('<')[0].trim(),
              channel: 'email',
              gmailMessageId: msg.id,
            })
          }
        }
      } catch {}

      reload()
      return
    }

    // Create conversation for matched client
    const convo = saveConversation({
      clientId: client.id,
      subject: gmail.subject,
      channel: 'email',
      gmailThreadId: gmail.threadId,
      messages: [],
    })

    try {
      const res = await fetch(`/api/gmail?action=thread&threadId=${gmail.threadId}`)
      if (res.ok) {
        const data = await res.json()
        for (const msg of data.messages || []) {
          const isInbound = msg.from.includes(fromEmail)
          addMessage(convo.id, {
            content: msg.body || msg.snippet,
            direction: isInbound ? 'inbound' : 'outbound',
            sender: msg.from.split('<')[0].trim(),
            channel: 'email',
            gmailMessageId: msg.id,
          })
        }
      }
    } catch {}

    reload()
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!newMsg.trim() || !active) return
    setSending(true)

    const client = clients[active.clientId]

    // If email channel and Gmail configured, try sending via Gmail
    if (active.channel === 'email' && client?.email) {
      try {
        const res = await fetch('/api/gmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send',
            to: client.email,
            subject: active.subject,
            body: newMsg.trim(),
            threadId: active.gmailThreadId || undefined,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          addMessage(active.id, {
            content: newMsg.trim(),
            direction: 'outbound',
            sender: 'You',
            channel: 'email',
            gmailMessageId: data.messageId,
          })
          setNewMsg('')
          reload()
          setSending(false)
          return
        }
      } catch {}
    }

    // If text channel and Twilio configured, try sending via Twilio
    if (active.channel === 'text' && client?.phone) {
      try {
        const res = await fetch('/api/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send',
            to: client.phone,
            body: newMsg.trim(),
          }),
        })
        if (res.ok) {
          const data = await res.json()
          addMessage(active.id, {
            content: newMsg.trim(),
            direction: 'outbound',
            sender: 'You',
            channel: 'text',
            twilioSid: data.sid,
          })
          setNewMsg('')
          reload()
          setSending(false)
          return
        }
      } catch {}
    }

    // Fallback: just log locally
    addMessage(active.id, { content: newMsg.trim(), direction: 'outbound', sender: 'You' })
    setNewMsg('')
    reload()
    setSending(false)
  }

  function logInbound() {
    if (!active) return
    const content = prompt('Paste or type the message received:')
    if (!content) return
    const sender = clients[active.clientId]?.name || 'Client'
    addMessage(active.id, { content, direction: 'inbound', sender })
    reload()
  }

  function createConvo(e) {
    e.preventDefault()
    if (!newConvo.clientId) return
    saveConversation({ ...newConvo, messages: [] })
    setShowNew(false)
    setNewConvo({ clientId: '', subject: '', channel: 'email' })
    reload()
  }

  const filtered = convos.filter(c => {
    if (filterChannel !== 'all' && c.channel !== filterChannel) return false
    if (search) {
      const s = search.toLowerCase()
      const clientName = clients[c.clientId]?.name || ''
      return clientName.toLowerCase().includes(s) || c.subject?.toLowerCase().includes(s) || c.lastMessage?.toLowerCase().includes(s)
    }
    return true
  })

  const clientList = Object.values(clients)

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-80 border-r border-gray-800 flex flex-col bg-gray-900/50">
        <div className="p-3 space-y-2 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Messages</h2>
            <div className="flex gap-1">
              <button onClick={fetchGmail} disabled={gmailLoading}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50">
                {gmailLoading ? 'Syncing...' : 'Sync Gmail'}
              </button>
              <span className="text-gray-700">|</span>
              <button onClick={() => setShowNew(true)} className="text-xs text-blue-400 hover:text-blue-300">+ New</button>
            </div>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations..."
            className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-1">
            {['all', 'email', 'text', 'phone'].map(ch => (
              <button key={ch} onClick={() => setFilterChannel(ch)}
                className={`px-2 py-1 rounded text-xs transition-colors ${filterChannel === ch ? 'bg-blue-600/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
                {ch === 'all' ? 'All' : ch.charAt(0).toUpperCase() + ch.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {showNew && (
          <form onSubmit={createConvo} className="p-3 border-b border-gray-800 space-y-2 bg-gray-900">
            <select required value={newConvo.clientId} onChange={e => setNewConvo({ ...newConvo, clientId: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select client...</option>
              {clientList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input required value={newConvo.subject} onChange={e => setNewConvo({ ...newConvo, subject: e.target.value })}
              placeholder="Subject" className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={newConvo.channel} onChange={e => setNewConvo({ ...newConvo, channel: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="email">Email</option>
              <option value="text">Text/SMS</option>
              <option value="phone">Phone</option>
              <option value="in-person">In-Person</option>
            </select>
            <div className="flex gap-2">
              <button type="submit" className="px-2.5 py-1 bg-blue-600 rounded text-xs text-white">Create</button>
              <button type="button" onClick={() => setShowNew(false)} className="px-2.5 py-1 bg-gray-800 rounded text-xs text-gray-300">Cancel</button>
            </div>
          </form>
        )}

        {/* Gmail imports */}
        {gmailMessages.length > 0 && (
          <div className="border-b border-gray-800">
            <div className="px-3 py-2 text-xs text-gray-500 uppercase tracking-wider bg-gray-900">Gmail Inbox</div>
            <div className="max-h-48 overflow-y-auto">
              {gmailMessages.map(m => (
                <button key={m.id} onClick={() => importGmailThread(m)}
                  className="w-full text-left px-3 py-2 border-b border-gray-800/30 hover:bg-gray-800/50 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-300 truncate">{m.from.split('<')[0].trim()}</span>
                    <span className="text-gray-600 shrink-0 ml-2">{new Date(m.date).toLocaleDateString()}</span>
                  </div>
                  <p className="text-gray-400 truncate">{m.subject}</p>
                  <p className="text-gray-600 truncate">{m.snippet}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-gray-500 text-center">
              {convos.length === 0 ? 'No conversations yet.' : 'No results.'}
            </p>
          )}
          {filtered.map(c => {
            const client = clients[c.clientId]
            return (
              <button key={c.id} onClick={() => setActive(c)}
                className={`w-full text-left px-3 py-3 border-b border-gray-800/50 transition-colors ${active?.id === c.id ? 'bg-blue-600/10' : 'hover:bg-gray-800/50'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white truncate">{client?.name || 'Unknown'}</span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs ${
                    c.channel === 'email' ? 'bg-blue-900/30 text-blue-400' :
                    c.channel === 'text' ? 'bg-green-900/30 text-green-400' :
                    'bg-gray-800 text-gray-400'
                  }`}>{c.channel}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{c.subject}</p>
                <p className="text-xs text-gray-600 mt-0.5 truncate">{c.lastMessage || 'No messages'}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main conversation area */}
      <div className="flex-1 flex flex-col">
        {active ? (
          <>
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-900/50">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-white">{clients[active.clientId]?.name || 'Unknown'}</h3>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    active.channel === 'email' ? 'bg-blue-900/30 text-blue-400' :
                    active.channel === 'text' ? 'bg-green-900/30 text-green-400' :
                    'bg-gray-800 text-gray-400'
                  }`}>{active.channel}</span>
                  {active.gmailThreadId && <span className="px-1.5 py-0.5 rounded text-xs bg-purple-900/30 text-purple-400">Gmail synced</span>}
                </div>
                <p className="text-xs text-gray-500">{active.subject}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={logInbound}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors">Log Received</button>
                {active.clientId && (
                  <Link to={`/clients/${active.clientId}`}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors">View Client</Link>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {(active.messages || []).map(msg => (
                <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[65%] rounded-xl px-4 py-2.5 text-sm ${
                    msg.direction === 'outbound' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-xs mt-1.5 flex items-center gap-1 ${msg.direction === 'outbound' ? 'text-blue-200' : 'text-gray-500'}`}>
                      {msg.sender} &middot; {new Date(msg.timestamp).toLocaleString()}
                      {msg.gmailMessageId && <span className="text-purple-400">(email)</span>}
                      {msg.twilioSid && <span className="text-green-400">(sms)</span>}
                    </p>
                  </div>
                </div>
              ))}
              {(!active.messages || active.messages.length === 0) && (
                <div className="flex items-center justify-center h-full"><p className="text-sm text-gray-500">No messages yet.</p></div>
              )}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={sendMessage} className="p-4 border-t border-gray-800 bg-gray-900/50">
              <div className="flex gap-2">
                <textarea value={newMsg} onChange={e => setNewMsg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e) } }}
                  placeholder={`Compose ${active.channel} message...${active.channel === 'email' ? ' (sends via Gmail)' : active.channel === 'text' ? ' (sends via Twilio)' : ''}`}
                  rows={2}
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                <button type="submit" disabled={!newMsg.trim() || sending}
                  className="self-end px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors">
                  {sending ? '...' : 'Send'}
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-1">Enter to send, Shift+Enter for new line</p>
            </form>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-gray-500 text-sm">Select a conversation</p>
              <p className="text-gray-600 text-xs mt-1">or sync Gmail / create a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
