import { useState, useEffect, useRef } from 'react'
import { usePortalAuth } from '../../lib/portalAuth'

export default function PortalMessages() {
  const { portalFetch, user } = usePortalAuth()
  const [conversations, setConversations] = useState([])
  const [selectedConvo, setSelectedConvo] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    loadConversations()
  }, [portalFetch])

  async function loadConversations() {
    try {
      const res = await portalFetch('/api/portal?action=messages')
      if (!res.ok) throw new Error('Failed to load messages')
      const data = await res.json()
      setConversations(data.conversations || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadThread(convoId) {
    setThreadLoading(true)
    try {
      const res = await portalFetch(`/api/portal?action=message-thread&conversationId=${convoId}`)
      if (!res.ok) throw new Error('Failed to load thread')
      const data = await res.json()
      setMessages(data.messages || [])
      setSelectedConvo(data.conversation)
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (err) {
      setError(err.message)
    } finally {
      setThreadLoading(false)
    }
  }

  async function handleSendReply(e) {
    e.preventDefault()
    if (!reply.trim() || !selectedConvo) return
    setSending(true)
    try {
      const res = await portalFetch('/api/portal?action=send-message', {
        method: 'POST',
        body: JSON.stringify({ conversationId: selectedConvo.id, message: reply }),
      })
      if (!res.ok) throw new Error('Failed to send message')
      setReply('')
      await loadThread(selectedConvo.id)
      await loadConversations()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleSendNew(e) {
    e.preventDefault()
    if (!newMessage.trim()) return
    setSending(true)
    try {
      const res = await portalFetch('/api/portal?action=send-message', {
        method: 'POST',
        body: JSON.stringify({ subject: newSubject || 'New message', message: newMessage }),
      })
      if (!res.ok) throw new Error('Failed to send message')
      const data = await res.json()
      setNewSubject('')
      setNewMessage('')
      setShowCompose(false)
      await loadConversations()
      if (data.conversationId) loadThread(data.conversationId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Messages</h1>
          <p className="text-sm text-gray-500 mt-1">Communicate with our team</p>
        </div>
        <button
          onClick={() => setShowCompose(!showCompose)}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-medium text-white"
        >
          + New Message
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}

      {/* Compose form */}
      {showCompose && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">New Message</h3>
          <form onSubmit={handleSendNew} className="space-y-3">
            <input
              type="text" value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              placeholder="Subject (optional)"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <textarea
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              placeholder="Write your message..."
              rows={4}
              required
              maxLength={5000}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={sending}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
                {sending ? 'Sending...' : 'Send'}
              </button>
              <button type="button" onClick={() => setShowCompose(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: '400px' }}>
        {/* Conversation list */}
        <div className="lg:col-span-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-gray-800">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">Conversations</h3>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '500px' }}>
            {conversations.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 text-center">No conversations yet</p>
            ) : (
              conversations.map(convo => (
                <button
                  key={convo.id}
                  onClick={() => loadThread(convo.id)}
                  className={`w-full text-left p-3 border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                    selectedConvo?.id === convo.id ? 'bg-gray-800' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <p className="text-sm text-white font-medium truncate pr-2">
                      {convo.subject || 'No subject'}
                    </p>
                    {convo.unreadCount > 0 && (
                      <span className="bg-emerald-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                        {convo.unreadCount}
                      </span>
                    )}
                  </div>
                  {convo.messages?.[convo.messages.length - 1] && (
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {convo.messages[convo.messages.length - 1].body}
                    </p>
                  )}
                  <p className="text-xs text-gray-600 mt-1">{formatDate(convo.lastMessageAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread view */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
          {!selectedConvo ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-gray-500">Select a conversation to view messages</p>
            </div>
          ) : threadLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-gray-800">
                <h3 className="text-sm font-semibold text-white">{selectedConvo.subject || 'Conversation'}</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: '400px' }}>
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.direction === 'inbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
                      msg.direction === 'inbound'
                        ? 'bg-emerald-600/20 border border-emerald-800'
                        : 'bg-gray-800 border border-gray-700'
                    }`}>
                      <p className="text-xs text-gray-500 mb-1">{msg.sender || (msg.direction === 'inbound' ? 'You' : 'Team')}</p>
                      <p className="text-sm text-gray-200 whitespace-pre-wrap">{msg.body}</p>
                      <p className="text-xs text-gray-600 mt-1">{formatTime(msg.createdAt)}</p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={handleSendReply} className="p-3 border-t border-gray-800 flex gap-2">
                <input
                  type="text" value={reply}
                  onChange={e => setReply(e.target.value)}
                  placeholder="Type your reply..."
                  maxLength={5000}
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button type="submit" disabled={sending || !reply.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function formatDate(d) {
  if (!d) return ''
  try {
    const dt = new Date(d)
    const now = new Date()
    const diff = now - dt
    if (diff < 86400000) return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    if (diff < 7 * 86400000) return dt.toLocaleDateString('en-US', { weekday: 'short' })
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function formatTime(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}
