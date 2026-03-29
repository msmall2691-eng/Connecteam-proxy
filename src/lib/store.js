// Unified data store — uses Supabase when configured, falls back to localStorage
import { getSupabase, isSupabaseConfigured } from './supabase'

// ══════════════════════════════════════════
// LOCAL STORAGE LAYER (fallback)
// ══════════════════════════════════════════
const STORE_KEY = 'workflowhq_data'

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || defaultData() }
  catch { return defaultData() }
}

function saveLocal(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data))
}

function defaultData() {
  return { clients: [], conversations: [], jobs: [], invoices: [] }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ══════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════
export async function getClientsAsync() {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('clients').select('*').order('created_at', { ascending: false })
    return (data || []).map(normalizeClient)
  }
  return getClients()
}

export function getClients() {
  return loadLocal().clients
}

export function getClient(id) {
  return loadLocal().clients.find(c => c.id === id) || null
}

export async function getClientAsync(id) {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('clients').select('*').eq('id', id).single()
    return data ? normalizeClient(data) : null
  }
  return getClient(id)
}

export async function saveClientAsync(client) {
  const sb = getSupabase()
  if (sb) {
    if (client.id) {
      const { data } = await sb.from('clients').update(toSnake(client)).eq('id', client.id).select().single()
      return normalizeClient(data)
    } else {
      const row = toSnake(client)
      delete row.id
      const { data } = await sb.from('clients').insert(row).select().single()
      return normalizeClient(data)
    }
  }
  return saveClient(client)
}

export function saveClient(client) {
  const data = loadLocal()
  const now = new Date().toISOString()
  if (client.id) {
    const idx = data.clients.findIndex(c => c.id === client.id)
    if (idx >= 0) data.clients[idx] = { ...data.clients[idx], ...client, updatedAt: now }
  } else {
    client.id = genId()
    client.createdAt = now
    client.updatedAt = now
    data.clients.unshift(client)
  }
  saveLocal(data)
  return client
}

export async function deleteClientAsync(id) {
  const sb = getSupabase()
  if (sb) {
    await sb.from('clients').delete().eq('id', id)
    return
  }
  deleteClient(id)
}

export function deleteClient(id) {
  const data = loadLocal()
  data.clients = data.clients.filter(c => c.id !== id)
  data.conversations = data.conversations.filter(c => c.clientId !== id)
  data.jobs = data.jobs.filter(j => j.clientId !== id)
  data.invoices = (data.invoices || []).filter(i => i.clientId !== id)
  saveLocal(data)
}

// ══════════════════════════════════════════
// CONVERSATIONS
// ══════════════════════════════════════════
export async function getConversationsAsync(clientId = null) {
  const sb = getSupabase()
  if (sb) {
    let q = sb.from('conversations').select('*').order('updated_at', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    const { data } = await q
    return (data || []).map(normalizeConvo)
  }
  return getConversations(clientId)
}

export function getConversations(clientId = null) {
  const data = loadLocal()
  let convos = data.conversations
  if (clientId) convos = convos.filter(c => c.clientId === clientId)
  return convos.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

export function getConversation(id) {
  return loadLocal().conversations.find(c => c.id === id) || null
}

export async function saveConversationAsync(convo) {
  const sb = getSupabase()
  if (sb) {
    if (convo.id) {
      const { data } = await sb.from('conversations').update(convoToSnake(convo)).eq('id', convo.id).select().single()
      return normalizeConvo(data)
    } else {
      const row = convoToSnake(convo)
      delete row.id
      const { data } = await sb.from('conversations').insert(row).select().single()
      return normalizeConvo(data)
    }
  }
  return saveConversation(convo)
}

export function saveConversation(convo) {
  const data = loadLocal()
  const now = new Date().toISOString()
  if (convo.id) {
    const idx = data.conversations.findIndex(c => c.id === convo.id)
    if (idx >= 0) data.conversations[idx] = { ...data.conversations[idx], ...convo, updatedAt: now }
  } else {
    convo.id = genId()
    convo.createdAt = now
    convo.updatedAt = now
    convo.messages = convo.messages || []
    data.conversations.unshift(convo)
  }
  saveLocal(data)
  return convo
}

export async function addMessageAsync(convoId, message) {
  const sb = getSupabase()
  if (sb) {
    const msg = {
      conversation_id: convoId,
      content: message.content,
      direction: message.direction,
      sender: message.sender,
      channel: message.channel || null,
      gmail_message_id: message.gmailMessageId || null,
      twilio_sid: message.twilioSid || null,
      metadata: message.metadata || {},
    }
    const { data } = await sb.from('messages').insert(msg).select().single()
    // Update conversation last_message
    await sb.from('conversations').update({
      last_message: message.content?.slice(0, 100) || '',
    }).eq('id', convoId)
    return data
  }
  return addMessage(convoId, message)
}

export function addMessage(convoId, message) {
  const data = loadLocal()
  const now = new Date().toISOString()
  const idx = data.conversations.findIndex(c => c.id === convoId)
  if (idx >= 0) {
    message.id = genId()
    message.timestamp = now
    data.conversations[idx].messages.push(message)
    data.conversations[idx].updatedAt = now
    data.conversations[idx].lastMessage = message.content?.slice(0, 100) || ''
    saveLocal(data)
  }
  return message
}

export async function getMessagesAsync(convoId) {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('messages').select('*').eq('conversation_id', convoId).order('timestamp', { ascending: true })
    return (data || []).map(m => ({
      id: m.id,
      content: m.content,
      direction: m.direction,
      sender: m.sender,
      channel: m.channel,
      timestamp: m.timestamp,
      gmailMessageId: m.gmail_message_id,
      twilioSid: m.twilio_sid,
    }))
  }
  const convo = getConversation(convoId)
  return convo?.messages || []
}

// ══════════════════════════════════════════
// JOBS
// ══════════════════════════════════════════
export async function getJobsAsync(clientId = null) {
  const sb = getSupabase()
  if (sb) {
    let q = sb.from('jobs').select('*').order('date', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    const { data } = await q
    return (data || []).map(normalizeJob)
  }
  return getJobs(clientId)
}

export function getJobs(clientId = null) {
  const data = loadLocal()
  let jobs = data.jobs
  if (clientId) jobs = jobs.filter(j => j.clientId === clientId)
  return jobs.sort((a, b) => new Date(b.date) - new Date(a.date))
}

export function getJob(id) {
  return loadLocal().jobs.find(j => j.id === id) || null
}

export async function saveJobAsync(job) {
  const sb = getSupabase()
  if (sb) {
    const row = jobToSnake(job)
    if (job.id) {
      const { data } = await sb.from('jobs').update(row).eq('id', job.id).select().single()
      return normalizeJob(data)
    } else {
      delete row.id
      const { data } = await sb.from('jobs').insert(row).select().single()
      return normalizeJob(data)
    }
  }
  return saveJob(job)
}

export function saveJob(job) {
  const data = loadLocal()
  const now = new Date().toISOString()
  if (job.id) {
    const idx = data.jobs.findIndex(j => j.id === job.id)
    if (idx >= 0) data.jobs[idx] = { ...data.jobs[idx], ...job, updatedAt: now }
  } else {
    job.id = genId()
    job.createdAt = now
    job.updatedAt = now
    data.jobs.unshift(job)
  }
  saveLocal(data)
  return job
}

export function deleteJob(id) {
  const data = loadLocal()
  data.jobs = data.jobs.filter(j => j.id !== id)
  saveLocal(data)
}

// ══════════════════════════════════════════
// INVOICES
// ══════════════════════════════════════════
export async function getInvoicesAsync(clientId = null) {
  const sb = getSupabase()
  if (sb) {
    let q = sb.from('invoices').select('*, invoice_items(*)').order('created_at', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    const { data } = await q
    return (data || []).map(normalizeInvoice)
  }
  return getInvoices(clientId)
}

export function getInvoices(clientId = null) {
  const data = loadLocal()
  let invoices = data.invoices || []
  if (clientId) invoices = invoices.filter(i => i.clientId === clientId)
  return invoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export function getInvoice(id) {
  return (loadLocal().invoices || []).find(i => i.id === id) || null
}

export async function saveInvoiceAsync(invoice) {
  const sb = getSupabase()
  if (sb) {
    const row = invoiceToSnake(invoice)
    const items = invoice.items || []
    if (invoice.id) {
      const { data } = await sb.from('invoices').update(row).eq('id', invoice.id).select().single()
      // Upsert items
      if (items.length > 0) {
        await sb.from('invoice_items').delete().eq('invoice_id', invoice.id)
        await sb.from('invoice_items').insert(items.map(i => ({
          invoice_id: invoice.id,
          job_id: i.jobId || null,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unitPrice,
          total: i.total,
        })))
      }
      return normalizeInvoice(data)
    } else {
      delete row.id
      const { data } = await sb.from('invoices').insert(row).select().single()
      if (items.length > 0) {
        await sb.from('invoice_items').insert(items.map(i => ({
          invoice_id: data.id,
          job_id: i.jobId || null,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unitPrice,
          total: i.total,
        })))
      }
      return normalizeInvoice(data)
    }
  }
  return saveInvoice(invoice)
}

export function saveInvoice(invoice) {
  const data = loadLocal()
  const now = new Date().toISOString()
  if (invoice.id) {
    const idx = (data.invoices || []).findIndex(i => i.id === invoice.id)
    if (idx >= 0) data.invoices[idx] = { ...data.invoices[idx], ...invoice, updatedAt: now }
  } else {
    if (!data.invoices) data.invoices = []
    invoice.id = genId()
    invoice.createdAt = now
    invoice.updatedAt = now
    data.invoices.unshift(invoice)
  }
  saveLocal(data)
  return invoice
}

// ══════════════════════════════════════════
// RECURRING JOB GENERATION
// ══════════════════════════════════════════
export async function generateRecurringJobs(weeksAhead = 4) {
  const jobs = isSupabaseConfigured() ? await getJobsAsync() : getJobs()
  const recurring = jobs.filter(j => j.isRecurring && j.recurrenceRule)
  const generated = []

  for (const template of recurring) {
    const existingDates = new Set(
      jobs.filter(j => j.recurrenceParentId === template.id).map(j => j.date)
    )

    const today = new Date()
    for (let w = 0; w < weeksAhead; w++) {
      let nextDate
      if (template.recurrenceRule === 'weekly') {
        nextDate = new Date(today)
        nextDate.setDate(nextDate.getDate() + (7 * w) + ((template.recurrenceDay || 0) - nextDate.getDay() + 7) % 7)
      } else if (template.recurrenceRule === 'biweekly') {
        nextDate = new Date(today)
        nextDate.setDate(nextDate.getDate() + (14 * w) + ((template.recurrenceDay || 0) - nextDate.getDay() + 7) % 7)
      } else if (template.recurrenceRule === 'monthly') {
        nextDate = new Date(today.getFullYear(), today.getMonth() + w, template.recurrenceDay || 1)
      }

      if (!nextDate || nextDate < today) continue
      const dateStr = nextDate.toISOString().split('T')[0]
      if (existingDates.has(dateStr)) continue

      const newJob = {
        clientId: template.clientId,
        clientName: template.clientName,
        title: template.title,
        description: template.description,
        date: dateStr,
        startTime: template.startTime,
        endTime: template.endTime,
        status: 'scheduled',
        assignee: template.assignee,
        notes: template.notes,
        price: template.price,
        priceType: template.priceType,
        recurrenceParentId: template.id,
      }

      if (isSupabaseConfigured()) {
        await saveJobAsync(newJob)
      } else {
        saveJob(newJob)
      }
      generated.push(newJob)
    }
  }

  return generated
}

// ══════════════════════════════════════════
// INVOICE NUMBER GENERATION
// ══════════════════════════════════════════
export function generateInvoiceNumber() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0')
  return `INV-${year}${month}-${seq}`
}

// ══════════════════════════════════════════
// IMPORT / EXPORT
// ══════════════════════════════════════════
export function exportData() { return loadLocal() }
export function importData(data) { saveLocal(data) }

// ══════════════════════════════════════════
// HELPERS: snake_case <-> camelCase
// ══════════════════════════════════════════
function normalizeClient(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    status: row.status,
    type: row.type,
    source: row.source,
    notes: row.notes,
    tags: row.tags || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toSnake(client) {
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    phone: client.phone,
    address: client.address,
    status: client.status,
    type: client.type,
    source: client.source,
    notes: client.notes,
    tags: client.tags || [],
  }
}

function normalizeConvo(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    subject: row.subject,
    channel: row.channel,
    lastMessage: row.last_message,
    gmailThreadId: row.gmail_thread_id,
    messages: row.messages || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function convoToSnake(convo) {
  return {
    id: convo.id,
    client_id: convo.clientId,
    subject: convo.subject,
    channel: convo.channel,
    last_message: convo.lastMessage,
    gmail_thread_id: convo.gmailThreadId,
  }
}

function normalizeJob(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    title: row.title,
    description: row.description,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    assignee: row.assignee,
    notes: row.notes,
    isRecurring: row.is_recurring,
    recurrenceRule: row.recurrence_rule,
    recurrenceDay: row.recurrence_day,
    recurrenceParentId: row.recurrence_parent_id,
    price: row.price,
    priceType: row.price_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function jobToSnake(job) {
  return {
    id: job.id,
    client_id: job.clientId,
    client_name: job.clientName,
    title: job.title,
    description: job.description,
    date: job.date,
    start_time: job.startTime,
    end_time: job.endTime,
    status: job.status,
    assignee: job.assignee,
    notes: job.notes,
    is_recurring: job.isRecurring || false,
    recurrence_rule: job.recurrenceRule || null,
    recurrence_day: job.recurrenceDay || null,
    recurrence_parent_id: job.recurrenceParentId || null,
    price: job.price || null,
    price_type: job.priceType || null,
  }
}

function normalizeInvoice(row) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    clientId: row.client_id,
    clientName: row.client_name,
    status: row.status,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    subtotal: parseFloat(row.subtotal) || 0,
    taxRate: parseFloat(row.tax_rate) || 0,
    taxAmount: parseFloat(row.tax_amount) || 0,
    total: parseFloat(row.total) || 0,
    notes: row.notes,
    paymentMethod: row.payment_method,
    paidAt: row.paid_at,
    items: (row.invoice_items || []).map(i => ({
      id: i.id,
      jobId: i.job_id,
      description: i.description,
      quantity: parseFloat(i.quantity),
      unitPrice: parseFloat(i.unit_price),
      total: parseFloat(i.total),
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function invoiceToSnake(inv) {
  return {
    id: inv.id,
    invoice_number: inv.invoiceNumber,
    client_id: inv.clientId,
    client_name: inv.clientName,
    status: inv.status,
    issue_date: inv.issueDate,
    due_date: inv.dueDate,
    subtotal: inv.subtotal,
    tax_rate: inv.taxRate,
    tax_amount: inv.taxAmount,
    total: inv.total,
    notes: inv.notes,
    payment_method: inv.paymentMethod,
    paid_at: inv.paidAt,
  }
}
