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
  return { clients: [], conversations: [], jobs: [], invoices: [], properties: [], quotes: [] }
}

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ══════════════════════════════════════════
// SUPABASE SYNC HELPERS
// ══════════════════════════════════════════
let _storeInitialized = false

export async function initializeStore() {
  if (_storeInitialized) return
  _storeInitialized = true
  const sb = getSupabase()
  if (!sb) return

  try {
    const [clientsRes, jobsRes, invoicesRes, propertiesRes, quotesRes, convosRes] = await Promise.all([
      sb.from('clients').select('*').order('created_at', { ascending: false }),
      sb.from('jobs').select('*').order('date', { ascending: false }),
      sb.from('invoices').select('*, invoice_items(*)').order('created_at', { ascending: false }),
      sb.from('properties').select('*').order('created_at', { ascending: false }),
      sb.from('quotes').select('*').order('created_at', { ascending: false }),
      sb.from('conversations').select('*').order('updated_at', { ascending: false }),
    ])

    const data = {
      clients: (clientsRes.data || []).map(normalizeClient),
      conversations: (convosRes.data || []).map(normalizeConvo),
      jobs: (jobsRes.data || []).map(normalizeJob),
      invoices: (invoicesRes.data || []).map(normalizeInvoice),
      properties: (propertiesRes.data || []).map(normalizeProperty),
      quotes: (quotesRes.data || []).map(normalizeQuote),
    }

    saveLocal(data)
  } catch (err) {
    console.error('Store initialization from Supabase failed:', err)
  }
}

function syncToSupabase(table, record, toSnakeFn) {
  const sb = getSupabase()
  if (!sb) return
  const row = toSnakeFn(record)
  sb.from(table).upsert(row, { onConflict: 'id' }).then(({ error }) => {
    if (error) console.error(`Supabase ${table} sync failed:`, error)
  })
}

function deleteFromSupabase(table, id) {
  const sb = getSupabase()
  if (!sb) return
  sb.from(table).delete().eq('id', id).then(({ error }) => {
    if (error) console.error(`Supabase ${table} delete failed:`, error)
  })
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
  syncToSupabase('clients', client, toSnake)
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
  deleteFromSupabase('clients', id)
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
  syncToSupabase('conversations', convo, convoToSnake)
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
  syncToSupabase('jobs', job, jobToSnake)
  return job
}

export function deleteJob(id) {
  const data = loadLocal()
  data.jobs = data.jobs.filter(j => j.id !== id)
  saveLocal(data)
  deleteFromSupabase('jobs', id)
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
  syncToSupabase('invoices', invoice, invoiceToSnake)
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
// ══════════════════════════════════════════
// RECURRING INVOICE AUTO-GENERATION
// ══════════════════════════════════════════
export function generateRecurringInvoices() {
  const jobs = getJobs()
  const invoices = getInvoices()
  const generated = []

  // Find completed recurring jobs that don't have an invoice yet
  const completedJobs = jobs.filter(j => j.status === 'completed' && j.price)

  for (const job of completedJobs) {
    // Check if this specific job (by id) already has an invoice
    const hasInvoice = invoices.some(inv =>
      inv.items?.some(item => item.jobId === job.id)
    )
    if (hasInvoice) continue

    // Auto-create invoice
    const inv = saveInvoice({
      invoiceNumber: generateInvoiceNumber(),
      clientId: job.clientId,
      clientName: job.clientName,
      propertyId: job.propertyId,
      status: 'draft',
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      subtotal: job.price,
      taxRate: 0,
      taxAmount: 0,
      total: job.price,
      items: [{ jobId: job.id, description: `${job.title} (${job.date})`, quantity: 1, unitPrice: job.price, total: job.price }],
    })
    generated.push(inv)
  }

  return generated
}

// ══════════════════════════════════════════
// PROPERTIES
// ══════════════════════════════════════════
export async function getPropertiesAsync(clientId = null) {
  const sb = getSupabase()
  if (sb) {
    let q = sb.from('properties').select('*').order('created_at', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    const { data } = await q
    return (data || []).map(normalizeProperty)
  }
  return getProperties(clientId)
}

export function getProperties(clientId = null) {
  const data = loadLocal()
  let props = data.properties || []
  if (clientId) props = props.filter(p => p.clientId === clientId)
  return props
}

export function getProperty(id) {
  return (loadLocal().properties || []).find(p => p.id === id) || null
}

export async function savePropertyAsync(property) {
  const sb = getSupabase()
  if (sb) {
    const row = propertyToSnake(property)
    if (property.id) {
      const { data } = await sb.from('properties').update(row).eq('id', property.id).select().single()
      return normalizeProperty(data)
    } else {
      delete row.id
      const { data } = await sb.from('properties').insert(row).select().single()
      return normalizeProperty(data)
    }
  }
  return saveProperty(property)
}

export function saveProperty(property) {
  const data = loadLocal()
  if (!data.properties) data.properties = []
  const now = new Date().toISOString()
  if (property.id) {
    const idx = data.properties.findIndex(p => p.id === property.id)
    if (idx >= 0) data.properties[idx] = { ...data.properties[idx], ...property, updatedAt: now }
  } else {
    property.id = genId()
    property.createdAt = now
    property.updatedAt = now
    data.properties.unshift(property)
  }
  saveLocal(data)
  syncToSupabase('properties', property, propertyToSnake)
  return property
}

export function deleteProperty(id) {
  const data = loadLocal()
  data.properties = (data.properties || []).filter(p => p.id !== id)
  saveLocal(data)
  deleteFromSupabase('properties', id)
}

// ══════════════════════════════════════════
// QUOTES
// ══════════════════════════════════════════
export async function getQuotesAsync(clientId = null, propertyId = null) {
  const sb = getSupabase()
  if (sb) {
    let q = sb.from('quotes').select('*').order('created_at', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    if (propertyId) q = q.eq('property_id', propertyId)
    const { data } = await q
    return (data || []).map(normalizeQuote)
  }
  return getQuotes(clientId)
}

export function getQuotes(clientId = null) {
  const data = loadLocal()
  let quotes = data.quotes || []
  if (clientId) quotes = quotes.filter(q => q.clientId === clientId)
  return quotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export function getQuote(id) {
  return (loadLocal().quotes || []).find(q => q.id === id) || null
}

export async function saveQuoteAsync(quote) {
  const sb = getSupabase()
  if (sb) {
    const row = quoteToSnake(quote)
    if (quote.id) {
      const { data } = await sb.from('quotes').update(row).eq('id', quote.id).select().single()
      return normalizeQuote(data)
    } else {
      delete row.id
      const { data } = await sb.from('quotes').insert(row).select().single()
      return normalizeQuote(data)
    }
  }
  return saveQuote(quote)
}

export function saveQuote(quote) {
  const data = loadLocal()
  if (!data.quotes) data.quotes = []
  const now = new Date().toISOString()
  if (quote.id) {
    const idx = data.quotes.findIndex(q => q.id === quote.id)
    if (idx >= 0) data.quotes[idx] = { ...data.quotes[idx], ...quote, updatedAt: now }
  } else {
    quote.id = genId()
    quote.createdAt = now
    quote.updatedAt = now
    data.quotes.unshift(quote)
  }
  saveLocal(data)
  syncToSupabase('quotes', quote, quoteToSnake)
  return quote
}

export function generateQuoteNumber() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0')
  return `QTE-${y}${m}-${seq}`
}

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
    id: row.id, name: row.name, email: row.email, phone: row.phone,
    address: row.address, status: row.status, type: row.type,
    source: row.source, notes: row.notes, tags: row.tags || [],
    squareCustomerId: row.square_customer_id,
    stripeCustomerId: row.stripe_customer_id,
    preferredContact: row.preferred_contact,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toSnake(client) {
  return {
    id: client.id, name: client.name, email: client.email, phone: client.phone,
    address: client.address, status: client.status, type: client.type,
    source: client.source, notes: client.notes, tags: client.tags || [],
    square_customer_id: client.squareCustomerId || null,
    stripe_customer_id: client.stripeCustomerId || null,
    preferred_contact: client.preferredContact || 'email',
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
    id: row.id, clientId: row.client_id, clientName: row.client_name,
    title: row.title, description: row.description, date: row.date,
    startTime: row.start_time, endTime: row.end_time, status: row.status,
    assignee: row.assignee, notes: row.notes,
    isRecurring: row.is_recurring, recurrenceRule: row.recurrence_rule,
    recurrenceDay: row.recurrence_day, recurrenceParentId: row.recurrence_parent_id,
    price: row.price, priceType: row.price_type,
    // v2 fields
    propertyId: row.property_id, quoteId: row.quote_id,
    googleEventId: row.google_event_id, serviceType: row.service_type,
    address: row.address,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function jobToSnake(job) {
  return {
    id: job.id, client_id: job.clientId, client_name: job.clientName,
    title: job.title, description: job.description, date: job.date,
    start_time: job.startTime, end_time: job.endTime, status: job.status,
    assignee: job.assignee, notes: job.notes,
    is_recurring: job.isRecurring || false, recurrence_rule: job.recurrenceRule || null,
    recurrence_day: job.recurrenceDay || null, recurrence_parent_id: job.recurrenceParentId || null,
    price: job.price || null, price_type: job.priceType || null,
    // v2 fields
    property_id: job.propertyId || null, quote_id: job.quoteId || null,
    google_event_id: job.googleEventId || null, service_type: job.serviceType || null,
    address: job.address || null,
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
    notes: row.notes, paymentMethod: row.payment_method,
    // v2 fields
    propertyId: row.property_id, quoteId: row.quote_id,
    squareInvoiceId: row.square_invoice_id, squarePublicUrl: row.square_public_url,
    sentAt: row.sent_at, emailSent: row.email_sent,
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
    id: inv.id, invoice_number: inv.invoiceNumber,
    client_id: inv.clientId, client_name: inv.clientName,
    status: inv.status, issue_date: inv.issueDate, due_date: inv.dueDate,
    subtotal: inv.subtotal, tax_rate: inv.taxRate, tax_amount: inv.taxAmount,
    total: inv.total, notes: inv.notes,
    payment_method: inv.paymentMethod, paid_at: inv.paidAt,
    // v2 fields
    property_id: inv.propertyId || null, quote_id: inv.quoteId || null,
    square_invoice_id: inv.squareInvoiceId || null,
    square_public_url: inv.squarePublicUrl || null,
    sent_at: inv.sentAt || null, email_sent: inv.emailSent || false,
  }
}

function normalizeProperty(row) {
  if (!row) return null
  return {
    id: row.id, clientId: row.client_id, name: row.name,
    addressLine1: row.address_line1, addressLine2: row.address_line2,
    city: row.city, state: row.state, zip: row.zip,
    type: row.type, sqft: row.sqft, bedrooms: row.bedrooms, bathrooms: row.bathrooms,
    petHair: row.pet_hair, condition: row.condition, accessNotes: row.access_notes,
    isPrimary: row.is_primary,
    icalUrl: row.ical_url, checkoutTime: row.checkout_time, cleaningTime: row.cleaning_time,
    rentalPlatform: row.rental_platform,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function propertyToSnake(p) {
  return {
    id: p.id, client_id: p.clientId, name: p.name,
    address_line1: p.addressLine1, address_line2: p.addressLine2,
    city: p.city, state: p.state, zip: p.zip,
    type: p.type, sqft: p.sqft ? parseInt(p.sqft) : null,
    bedrooms: p.bedrooms ? parseInt(p.bedrooms) : null,
    bathrooms: p.bathrooms ? parseInt(p.bathrooms) : null,
    pet_hair: p.petHair || 'none', condition: p.condition || 'maintenance',
    access_notes: p.accessNotes, is_primary: p.isPrimary || false,
    ical_url: p.icalUrl, checkout_time: p.checkoutTime, cleaning_time: p.cleaningTime,
    rental_platform: p.rentalPlatform,
  }
}

function normalizeQuote(row) {
  if (!row) return null
  return {
    id: row.id, quoteNumber: row.quote_number,
    clientId: row.client_id, propertyId: row.property_id,
    serviceType: row.service_type, frequency: row.frequency,
    estimateMin: parseFloat(row.estimate_min) || 0,
    estimateMax: parseFloat(row.estimate_max) || 0,
    finalPrice: parseFloat(row.final_price) || 0,
    calcInputs: row.calc_inputs || {}, calcBreakdown: row.calc_breakdown || {},
    status: row.status, sentVia: row.sent_via,
    sentAt: row.sent_at, viewedAt: row.viewed_at,
    acceptedAt: row.accepted_at, declinedAt: row.declined_at, expiresAt: row.expires_at,
    signatureData: row.signature_data,
    items: row.items || [], notes: row.notes,
    preferredDay: row.preferred_day, preferredTime: row.preferred_time,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function quoteToSnake(q) {
  return {
    id: q.id, quote_number: q.quoteNumber,
    client_id: q.clientId, property_id: q.propertyId,
    service_type: q.serviceType, frequency: q.frequency,
    estimate_min: q.estimateMin, estimate_max: q.estimateMax,
    final_price: q.finalPrice,
    calc_inputs: q.calcInputs || {}, calc_breakdown: q.calcBreakdown || {},
    status: q.status, sent_via: q.sentVia,
    sent_at: q.sentAt, viewed_at: q.viewedAt,
    accepted_at: q.acceptedAt, declined_at: q.declinedAt, expires_at: q.expiresAt,
    signature_data: q.signatureData,
    items: q.items || [], notes: q.notes,
    preferred_day: q.preferredDay, preferred_time: q.preferredTime,
  }
}
