// Vercel serverless: Client Portal
// Public page — no auth required for basic access via unique client ID
// JWT-authenticated endpoints for full portal access
// GET /api/portal?clientId=xxx — returns client's schedule + invoices (legacy)
// GET /api/portal?action=dashboard|schedule|quotes|invoices|messages|... — JWT authenticated

import { verifyPortalToken } from './portal-auth.js'

const ALLOWED_ORIGINS = [
  'https://tmcc.app',
  'https://www.tmcc.app',
  'https://maineclean.co',
  'https://www.maineclean.co',
  'https://maine-clean.co',
  'https://www.maine-clean.co',
  'https://connecteam-proxy.vercel.app',
  'http://localhost:5173',
  'http://localhost:5000',
]

function getSupabaseConfig() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  return { url, key }
}

function sbHeaders(key) {
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }
}

function sanitize(str) {
  if (typeof str !== 'string') return ''
  return str.replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;'
  }[c]))
}

export default async function handler(req, res) {
  const origin = req.headers.origin || ''
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = req.query.action

  // ══════════════════════════════════════════
  // LEGACY: Public portal access via clientId/token
  // ══════════════════════════════════════════
  if (!action) {
    let clientId = req.query.clientId || req.query.id
    const token = req.query.token

    if (token && !clientId) {
      try {
        const decoded = Buffer.from(token, 'base64url').toString()
        const [id, ts] = decoded.split('|')
        if (Date.now() - parseInt(ts) < 365 * 86400000) clientId = id
      } catch {}
    }

    if (!clientId) return res.status(400).json({ error: 'Invalid portal link' })

    const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig()
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Database not configured' })
    }
    const headers = sbHeaders(supabaseKey)

    try {
      const clientRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=name,email,phone`, { headers })
      const clients = await clientRes.json()
      if (!clients?.length) return res.status(404).json({ error: 'Client not found' })
      const client = clients[0]

      const today = new Date().toISOString().split('T')[0]
      const jobsRes = await fetch(`${supabaseUrl}/rest/v1/jobs?client_id=eq.${clientId}&date=gte.${today}&status=in.(scheduled,in-progress)&order=date.asc&limit=20`, { headers })
      const jobs = await jobsRes.json()

      const invoicesRes = await fetch(`${supabaseUrl}/rest/v1/invoices?client_id=eq.${clientId}&order=issue_date.desc&limit=20`, { headers })
      const invoices = await invoicesRes.json()

      return res.status(200).json({
        client: { name: client.name },
        upcomingJobs: (jobs || []).map(j => ({
          title: j.title, date: j.date, startTime: j.start_time, status: j.status,
        })),
        invoices: (invoices || []).map(i => ({
          invoiceNumber: i.invoice_number, issueDate: i.issue_date, dueDate: i.due_date,
          total: parseFloat(i.total) || 0, status: i.status,
          paymentUrl: i.stripe_payment_url || i.square_public_url || null,
        })),
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ══════════════════════════════════════════
  // JWT-AUTHENTICATED PORTAL ENDPOINTS
  // ══════════════════════════════════════════
  const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig()
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Database not configured' })
  }
  const headers = sbHeaders(supabaseKey)

  // Verify JWT for all action-based endpoints
  const decoded = verifyPortalToken(req)
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const clientId = decoded.clientId
  const portalUserId = decoded.portalUserId

  try {
    // ── DASHBOARD ──
    if (req.method === 'GET' && action === 'dashboard') {
      const today = new Date().toISOString().split('T')[0]
      const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

      const [jobsRes, invoicesRes, quotesRes, convosRes, requestsRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/jobs?client_id=eq.${clientId}&date=gte.${today}&date=lte.${thirtyDays}&status=in.(scheduled,in-progress)&order=date.asc&limit=10`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/invoices?client_id=eq.${clientId}&order=issue_date.desc&limit=10`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/quotes?client_id=eq.${clientId}&status=in.(sent,viewed)&order=created_at.desc`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/conversations?client_id=eq.${clientId}&select=id,unread_count&order=last_message_at.desc`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/service_requests?client_id=eq.${clientId}&status=in.(pending,reviewed,approved,scheduled)&order=created_at.desc`, { headers }),
      ])

      const [jobs, invoices, quotes, convos, requests] = await Promise.all([
        jobsRes.json(), invoicesRes.json(), quotesRes.json(), convosRes.json(), requestsRes.json(),
      ])

      const unreadMessages = (convos || []).reduce((sum, c) => sum + (c.unread_count || 0), 0)

      return res.status(200).json({
        upcomingJobs: (jobs || []).map(j => ({
          id: j.id, title: j.title, date: j.date, startTime: j.start_time,
          endTime: j.end_time, status: j.status, serviceType: j.service_type,
          propertyId: j.property_id, address: j.address,
        })),
        recentInvoices: (invoices || []).map(i => ({
          id: i.id, invoiceNumber: i.invoice_number, issueDate: i.issue_date,
          dueDate: i.due_date, total: parseFloat(i.total) || 0, status: i.status,
          paymentUrl: i.stripe_payment_url || i.square_public_url || null,
        })),
        activeQuotes: (quotes || []).map(q => ({
          id: q.id, quoteNumber: q.quote_number, createdAt: q.created_at,
          status: q.status, total: parseFloat(q.total) || 0,
          serviceType: q.service_type,
        })),
        unreadMessages,
        openRequests: (requests || []).map(r => ({
          id: r.id, type: r.type, title: r.title, status: r.status, createdAt: r.created_at,
        })),
        stats: {
          upcomingVisits: (jobs || []).length,
          pendingInvoices: (invoices || []).filter(i => i.status === 'sent' || i.status === 'overdue').length,
          activeQuotes: (quotes || []).length,
          unreadMessages,
        },
      })
    }

    // ── SCHEDULE ──
    if (req.method === 'GET' && action === 'schedule') {
      const from = req.query.from || new Date().toISOString().split('T')[0]
      const to = req.query.to || new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0]

      const jobsRes = await fetch(
        `${supabaseUrl}/rest/v1/jobs?client_id=eq.${clientId}&date=gte.${from}&date=lte.${to}&order=date.asc`,
        { headers }
      )
      const jobs = await jobsRes.json()

      return res.status(200).json({
        jobs: (jobs || []).map(j => ({
          id: j.id, title: j.title, date: j.date, startTime: j.start_time,
          endTime: j.end_time, status: j.status, serviceType: j.service_type,
          address: j.address, propertyId: j.property_id,
          assignedEmployees: j.assigned_employees || [],
          notes: j.client_notes || null,
        })),
      })
    }

    // ── QUOTES ──
    if (req.method === 'GET' && action === 'quotes') {
      const quotesRes = await fetch(
        `${supabaseUrl}/rest/v1/quotes?client_id=eq.${clientId}&order=created_at.desc`,
        { headers }
      )
      const quotes = await quotesRes.json()

      return res.status(200).json({
        quotes: (quotes || []).map(q => ({
          id: q.id, quoteNumber: q.quote_number, createdAt: q.created_at,
          status: q.status, total: parseFloat(q.total) || 0,
          serviceType: q.service_type, frequency: q.frequency,
          propertyId: q.property_id, propertyAddress: q.property_address,
          lineItems: q.line_items || [], notes: q.notes || null,
          validUntil: q.valid_until,
        })),
      })
    }

    // ── INVOICES ──
    if (req.method === 'GET' && action === 'invoices') {
      const invoicesRes = await fetch(
        `${supabaseUrl}/rest/v1/invoices?client_id=eq.${clientId}&order=issue_date.desc`,
        { headers }
      )
      const invoices = await invoicesRes.json()

      return res.status(200).json({
        invoices: (invoices || []).map(i => ({
          id: i.id, invoiceNumber: i.invoice_number, issueDate: i.issue_date,
          dueDate: i.due_date, total: parseFloat(i.total) || 0, status: i.status,
          lineItems: i.line_items || [], notes: i.notes || null,
          paymentUrl: i.stripe_payment_url || i.square_public_url || null,
          paidAt: i.paid_at || null,
        })),
      })
    }

    // ── MESSAGES (conversation list) ──
    if (req.method === 'GET' && action === 'messages') {
      const convosRes = await fetch(
        `${supabaseUrl}/rest/v1/conversations?client_id=eq.${clientId}&order=last_message_at.desc.nullslast`,
        { headers }
      )
      const convos = await convosRes.json()

      // Fetch last 5 messages for each conversation
      const convosWithMessages = await Promise.all(
        (convos || []).map(async (c) => {
          const msgsRes = await fetch(
            `${supabaseUrl}/rest/v1/messages?conversation_id=eq.${c.id}&order=created_at.desc&limit=5`,
            { headers }
          )
          const msgs = await msgsRes.json()
          return {
            id: c.id, subject: c.subject, status: c.status,
            lastMessageAt: c.last_message_at, unreadCount: c.unread_count || 0,
            createdAt: c.created_at,
            messages: (msgs || []).reverse().map(m => ({
              id: m.id, body: m.body, direction: m.direction,
              sender: m.sender, createdAt: m.created_at,
            })),
          }
        })
      )

      return res.status(200).json({ conversations: convosWithMessages })
    }

    // ── MESSAGE THREAD ──
    if (req.method === 'GET' && action === 'message-thread') {
      const conversationId = req.query.conversationId
      if (!conversationId) return res.status(400).json({ error: 'conversationId is required' })

      // Verify conversation belongs to this client
      const convoRes = await fetch(
        `${supabaseUrl}/rest/v1/conversations?id=eq.${conversationId}&client_id=eq.${clientId}&select=*`,
        { headers }
      )
      const convos = await convoRes.json()
      if (!convos?.length) return res.status(404).json({ error: 'Conversation not found' })

      const msgsRes = await fetch(
        `${supabaseUrl}/rest/v1/messages?conversation_id=eq.${conversationId}&order=created_at.asc`,
        { headers }
      )
      const msgs = await msgsRes.json()

      return res.status(200).json({
        conversation: {
          id: convos[0].id, subject: convos[0].subject, status: convos[0].status,
          createdAt: convos[0].created_at,
        },
        messages: (msgs || []).map(m => ({
          id: m.id, body: m.body, direction: m.direction,
          sender: m.sender, createdAt: m.created_at,
        })),
      })
    }

    // ── SEND MESSAGE ──
    if (req.method === 'POST' && action === 'send-message') {
      const { conversationId, message, subject } = req.body || {}
      if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message is required' })
      }
      if (message.length > 5000) {
        return res.status(400).json({ error: 'Message is too long (max 5000 characters)' })
      }

      let convoId = conversationId
      const sanitizedMessage = sanitize(message.trim())
      const sanitizedSubject = subject ? sanitize(subject.trim()) : null

      // If no conversation, create one
      if (!convoId) {
        const newConvo = {
          client_id: clientId,
          subject: sanitizedSubject || 'New message from portal',
          status: 'open',
          channel: 'portal',
          last_message_at: new Date().toISOString(),
        }
        const createRes = await fetch(
          `${supabaseUrl}/rest/v1/conversations`,
          { method: 'POST', headers, body: JSON.stringify(newConvo) }
        )
        const created = await createRes.json()
        convoId = created?.[0]?.id || created?.id
        if (!convoId) return res.status(500).json({ error: 'Failed to create conversation' })
      } else {
        // Verify conversation belongs to client
        const convoCheck = await fetch(
          `${supabaseUrl}/rest/v1/conversations?id=eq.${convoId}&client_id=eq.${clientId}&select=id`,
          { headers }
        )
        const checkResult = await convoCheck.json()
        if (!checkResult?.length) return res.status(404).json({ error: 'Conversation not found' })

        // Update last_message_at
        await fetch(
          `${supabaseUrl}/rest/v1/conversations?id=eq.${convoId}`,
          {
            method: 'PATCH', headers,
            body: JSON.stringify({ last_message_at: new Date().toISOString() }),
          }
        )
      }

      // Insert message
      const newMsg = {
        conversation_id: convoId,
        body: sanitizedMessage,
        direction: 'inbound',
        sender: decoded.name || 'Client',
        channel: 'portal',
      }
      const msgRes = await fetch(
        `${supabaseUrl}/rest/v1/messages`,
        { method: 'POST', headers, body: JSON.stringify(newMsg) }
      )
      const msgResult = await msgRes.json()

      // Create notification for admin
      try {
        await fetch(
          `${supabaseUrl}/rest/v1/notifications`,
          {
            method: 'POST', headers,
            body: JSON.stringify({
              type: 'portal_message',
              title: `New message from ${decoded.name}`,
              body: sanitizedMessage.substring(0, 200),
              client_id: clientId,
              reference_id: convoId,
              is_read: false,
            }),
          }
        )
      } catch {} // Don't fail if notifications table doesn't exist

      return res.status(201).json({
        success: true,
        conversationId: convoId,
        message: msgResult?.[0] || msgResult,
      })
    }

    // ── SERVICE REQUEST ──
    if (req.method === 'POST' && action === 'service-request') {
      const { type, title, description, preferredDate, preferredTime } = req.body || {}
      const validTypes = ['one-time', 'recurring', 'deep-clean', 'issue', 'change', 'cancel']
      if (!type || !validTypes.includes(type)) {
        return res.status(400).json({ error: 'Valid type is required' })
      }
      if (!title || title.trim().length === 0 || title.length > 200) {
        return res.status(400).json({ error: 'Title is required (max 200 characters)' })
      }
      if (description && description.length > 2000) {
        return res.status(400).json({ error: 'Description is too long (max 2000 characters)' })
      }

      const newRequest = {
        client_id: clientId,
        portal_user_id: portalUserId,
        type,
        title: sanitize(title.trim()),
        description: description ? sanitize(description.trim()) : null,
        preferred_date: preferredDate || null,
        preferred_time: preferredTime ? sanitize(preferredTime) : null,
        status: 'pending',
      }

      const reqRes = await fetch(
        `${supabaseUrl}/rest/v1/service_requests`,
        { method: 'POST', headers, body: JSON.stringify(newRequest) }
      )
      const result = await reqRes.json()

      // Create notification for admin
      try {
        await fetch(
          `${supabaseUrl}/rest/v1/notifications`,
          {
            method: 'POST', headers,
            body: JSON.stringify({
              type: 'service_request',
              title: `New service request from ${decoded.name}`,
              body: `${type}: ${sanitize(title.trim()).substring(0, 200)}`,
              client_id: clientId,
              reference_id: result?.[0]?.id || result?.id,
              is_read: false,
            }),
          }
        )
      } catch {}

      return res.status(201).json({ success: true, request: result?.[0] || result })
    }

    // ── SERVICE REQUESTS (list) ──
    if (req.method === 'GET' && action === 'service-requests') {
      const reqRes = await fetch(
        `${supabaseUrl}/rest/v1/service_requests?client_id=eq.${clientId}&order=created_at.desc`,
        { headers }
      )
      const requests = await reqRes.json()

      return res.status(200).json({
        requests: (requests || []).map(r => ({
          id: r.id, type: r.type, title: r.title, description: r.description,
          preferredDate: r.preferred_date, preferredTime: r.preferred_time,
          status: r.status, adminNotes: r.admin_notes,
          createdAt: r.created_at, updatedAt: r.updated_at,
        })),
      })
    }

    // ── PROPERTIES ──
    if (req.method === 'GET' && action === 'properties') {
      const propsRes = await fetch(
        `${supabaseUrl}/rest/v1/properties?client_id=eq.${clientId}&order=created_at.desc`,
        { headers }
      )
      const props = await propsRes.json()

      return res.status(200).json({
        properties: (props || []).map(p => ({
          id: p.id, name: p.name, address: p.address, type: p.type,
          bedrooms: p.bedrooms, bathrooms: p.bathrooms,
          squareFeet: p.square_feet, notes: p.notes,
        })),
      })
    }

    return res.status(400).json({ error: 'Invalid action' })
  } catch (err) {
    console.error('Portal error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
