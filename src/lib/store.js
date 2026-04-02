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
      // v5 fields
      job_id: message.jobId || null,
      visit_id: message.visitId || null,
      subject: message.subject || null,
      from_address: message.fromAddress || null,
      to_address: message.toAddress || null,
      is_automated: message.isAutomated || false,
      automation_trigger: message.automationTrigger || null,
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
      // v5 fields
      jobId: m.job_id,
      visitId: m.visit_id,
      subject: m.subject,
      fromAddress: m.from_address,
      toAddress: m.to_address,
      isAutomated: m.is_automated,
      automationTrigger: m.automation_trigger,
      callDurationSeconds: m.call_duration_seconds,
      callOutcome: m.call_outcome,
      attachments: m.attachments || [],
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
  return property
}

export function deleteProperty(id) {
  const data = loadLocal()
  data.properties = (data.properties || []).filter(p => p.id !== id)
  saveLocal(data)
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
  return quote
}

export function generateQuoteNumber() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0')
  return `QTE-${y}${m}-${seq}`
}

// ══════════════════════════════════════════
// EMPLOYEES
// ══════════════════════════════════════════
export async function getEmployeesAsync() {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('employees').select('*').order('first_name')
    return (data || []).map(normalizeEmployee)
  }
  return []
}

export async function getEmployeeAsync(id) {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('employees').select('*').eq('id', id).single()
    return data ? normalizeEmployee(data) : null
  }
  return null
}

export async function saveEmployeeAsync(employee) {
  const sb = getSupabase()
  if (!sb) return employee
  const row = employeeToSnake(employee)
  if (employee.id) {
    const { data } = await sb.from('employees').update(row).eq('id', employee.id).select().single()
    return normalizeEmployee(data)
  } else {
    delete row.id
    const { data } = await sb.from('employees').insert(row).select().single()
    return normalizeEmployee(data)
  }
}

export async function deleteEmployeeAsync(id) {
  const sb = getSupabase()
  if (sb) await sb.from('employees').delete().eq('id', id)
}

// ══════════════════════════════════════════
// TEAMS
// ══════════════════════════════════════════
export async function getTeamsAsync() {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('teams').select('*').order('name')
    return (data || []).map(normalizeTeam)
  }
  return []
}

export async function saveTeamAsync(team) {
  const sb = getSupabase()
  if (!sb) return team
  const row = teamToSnake(team)
  if (team.id) {
    const { data } = await sb.from('teams').update(row).eq('id', team.id).select().single()
    return normalizeTeam(data)
  } else {
    delete row.id
    const { data } = await sb.from('teams').insert(row).select().single()
    return normalizeTeam(data)
  }
}

export async function deleteTeamAsync(id) {
  const sb = getSupabase()
  if (sb) await sb.from('teams').delete().eq('id', id)
}

// ══════════════════════════════════════════
// SERVICE TYPES
// ══════════════════════════════════════════
export async function getServiceTypesAsync() {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('service_types').select('*').order('sort_order')
    return (data || []).map(normalizeServiceType)
  }
  return []
}

export async function saveServiceTypeAsync(st) {
  const sb = getSupabase()
  if (!sb) return st
  const row = serviceTypeToSnake(st)
  if (st.id) {
    const { data } = await sb.from('service_types').update(row).eq('id', st.id).select().single()
    return normalizeServiceType(data)
  } else {
    delete row.id
    const { data } = await sb.from('service_types').insert(row).select().single()
    return normalizeServiceType(data)
  }
}

export async function deleteServiceTypeAsync(id) {
  const sb = getSupabase()
  if (sb) await sb.from('service_types').delete().eq('id', id)
}

// ══════════════════════════════════════════
// PRICING RULES
// ══════════════════════════════════════════
export async function getPricingRulesAsync(serviceTypeId = null) {
  const sb = getSupabase()
  if (sb) {
    let q = sb.from('pricing_rules').select('*')
    if (serviceTypeId) q = q.eq('service_type_id', serviceTypeId)
    const { data } = await q
    return (data || []).map(normalizePricingRule)
  }
  return []
}

export async function savePricingRuleAsync(rule) {
  const sb = getSupabase()
  if (!sb) return rule
  const row = pricingRuleToSnake(rule)
  if (rule.id) {
    const { data } = await sb.from('pricing_rules').update(row).eq('id', rule.id).select().single()
    return normalizePricingRule(data)
  } else {
    delete row.id
    const { data } = await sb.from('pricing_rules').insert(row).select().single()
    return normalizePricingRule(data)
  }
}

export async function deletePricingRuleAsync(id) {
  const sb = getSupabase()
  if (sb) await sb.from('pricing_rules').delete().eq('id', id)
}

// ══════════════════════════════════════════
// EXTRAS / ADD-ONS
// ══════════════════════════════════════════
export async function getExtrasAsync() {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('extras').select('*').eq('active', true).order('sort_order')
    return (data || []).map(normalizeExtra)
  }
  return []
}

export async function saveExtraAsync(extra) {
  const sb = getSupabase()
  if (!sb) return extra
  const row = extraToSnake(extra)
  if (extra.id) {
    const { data } = await sb.from('extras').update(row).eq('id', extra.id).select().single()
    return normalizeExtra(data)
  } else {
    delete row.id
    const { data } = await sb.from('extras').insert(row).select().single()
    return normalizeExtra(data)
  }
}

export async function deleteExtraAsync(id) {
  const sb = getSupabase()
  if (sb) await sb.from('extras').update({ active: false }).eq('id', id)
}

// ══════════════════════════════════════════
// CHECKLIST TEMPLATES
// ══════════════════════════════════════════
export async function getChecklistTemplatesAsync() {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('checklist_templates').select('*').eq('active', true).order('name')
    return (data || []).map(normalizeChecklistTemplate)
  }
  return []
}

export async function saveChecklistTemplateAsync(tpl) {
  const sb = getSupabase()
  if (!sb) return tpl
  const row = checklistTemplateToSnake(tpl)
  if (tpl.id) {
    const { data } = await sb.from('checklist_templates').update(row).eq('id', tpl.id).select().single()
    return normalizeChecklistTemplate(data)
  } else {
    delete row.id
    const { data } = await sb.from('checklist_templates').insert(row).select().single()
    return normalizeChecklistTemplate(data)
  }
}

export async function deleteChecklistTemplateAsync(id) {
  const sb = getSupabase()
  if (sb) await sb.from('checklist_templates').update({ active: false }).eq('id', id)
}

// ══════════════════════════════════════════
// VISITS
// ══════════════════════════════════════════
export async function getVisitsAsync({ jobId, clientId, startDate, endDate, status } = {}) {
  const sb = getSupabase()
  if (sb) {
    let q = sb.from('visits').select('*').order('scheduled_date', { ascending: false })
    if (jobId) q = q.eq('job_id', jobId)
    if (clientId) q = q.eq('client_id', clientId)
    if (startDate) q = q.gte('scheduled_date', startDate)
    if (endDate) q = q.lte('scheduled_date', endDate)
    if (status) q = q.eq('status', status)
    const { data } = await q
    return (data || []).map(normalizeVisit)
  }
  return []
}

export async function getVisitAsync(id) {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('visits').select('*').eq('id', id).single()
    return data ? normalizeVisit(data) : null
  }
  return null
}

export async function saveVisitAsync(visit) {
  const sb = getSupabase()
  if (!sb) return visit
  const row = visitToSnake(visit)
  if (visit.id) {
    const { data } = await sb.from('visits').update(row).eq('id', visit.id).select().single()
    return normalizeVisit(data)
  } else {
    delete row.id
    const { data } = await sb.from('visits').insert(row).select().single()
    return normalizeVisit(data)
  }
}

export async function deleteVisitAsync(id) {
  const sb = getSupabase()
  if (sb) await sb.from('visits').delete().eq('id', id)
}

// Generate visits from a recurring job
export async function generateVisitsForJob(job, weeksAhead = 8) {
  if (!job.isRecurring || !job.recurrenceRule) return []

  const existing = await getVisitsAsync({ jobId: job.id })
  const existingDates = new Set(existing.map(v => v.scheduledDate))
  const generated = []
  const today = new Date()

  for (let w = 0; w < weeksAhead; w++) {
    let nextDate
    if (job.recurrenceRule === 'weekly') {
      nextDate = new Date(today)
      nextDate.setDate(nextDate.getDate() + (7 * w) + ((job.recurrenceDay || 0) - nextDate.getDay() + 7) % 7)
    } else if (job.recurrenceRule === 'biweekly') {
      nextDate = new Date(today)
      nextDate.setDate(nextDate.getDate() + (14 * Math.floor(w / 1)) + ((job.recurrenceDay || 0) - nextDate.getDay() + 7) % 7)
      if (w % 2 !== 0) continue
    } else if (job.recurrenceRule === 'monthly') {
      nextDate = new Date(today.getFullYear(), today.getMonth() + w, job.recurrenceDay || 1)
    }

    if (!nextDate || nextDate < today) continue
    const dateStr = nextDate.toISOString().split('T')[0]
    if (existingDates.has(dateStr)) continue

    const visit = await saveVisitAsync({
      jobId: job.id,
      clientId: job.clientId,
      propertyId: job.propertyId,
      visitNumber: existing.length + generated.length + 1,
      scheduledDate: dateStr,
      scheduledStartTime: job.preferredStartTime || job.startTime,
      scheduledEndTime: job.preferredEndTime || job.endTime,
      status: 'scheduled',
      assignedEmployeeId: job.assignedEmployeeId,
      assignedTeamId: job.assignedTeamId,
      source: 'recurring',
      serviceTypeId: job.serviceTypeId,
      instructions: job.instructions,
      clientVisible: true,
    })
    generated.push(visit)
  }

  return generated
}

// ══════════════════════════════════════════
// SCHEDULE (visits-first queries)
// ══════════════════════════════════════════
export async function getScheduleAsync({ startDate, endDate, employeeId, status } = {}) {
  const sb = getSupabase()
  if (!sb) return []
  let q = sb.from('visits').select(`
    *,
    job:jobs(id, title, price, service_type, service_type_id, is_recurring, recurrence_rule),
    client:clients(id, name, email, phone),
    property:properties(id, name, address_line1, city, type)
  `).order('scheduled_date', { ascending: true })
  if (startDate) q = q.gte('scheduled_date', startDate)
  if (endDate) q = q.lte('scheduled_date', endDate)
  if (employeeId) q = q.eq('assigned_employee_id', employeeId)
  if (status) q = q.in('status', Array.isArray(status) ? status : [status])
  else q = q.not('status', 'in', '(cancelled,skipped)')
  const { data } = await q
  return (data || []).map(normalizeVisit)
}

// ══════════════════════════════════════════
// CALENDAR SYNC LOG
// ══════════════════════════════════════════
export async function getCalendarSyncAsync(visitId) {
  const sb = getSupabase()
  if (!sb) return []
  const { data } = await sb.from('calendar_sync_log').select('*').eq('visit_id', visitId)
  return data || []
}

export async function saveCalendarSyncAsync(syncEntry) {
  const sb = getSupabase()
  if (!sb) return syncEntry
  const { data } = await sb.from('calendar_sync_log').upsert({
    visit_id: syncEntry.visitId,
    provider: syncEntry.provider,
    external_id: syncEntry.externalId,
    direction: syncEntry.direction || 'outbound',
    sync_status: syncEntry.syncStatus || 'synced',
    error_message: syncEntry.error || null,
  }, { onConflict: 'visit_id,provider' }).select().single()
  return data
}

// ══════════════════════════════════════════
// CLIENT SCHEDULE TOKENS
// ══════════════════════════════════════════
export async function getClientScheduleTokenAsync(clientId) {
  const sb = getSupabase()
  if (!sb) return null
  const { data } = await sb.from('client_schedule_tokens')
    .select('*').eq('client_id', clientId).eq('is_active', true).single()
  return data
}

export async function createClientScheduleTokenAsync(clientId) {
  const sb = getSupabase()
  if (!sb) return null
  // Generate URL-safe token
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 32; i++) token += chars[Math.floor(Math.random() * chars.length)]
  const { data } = await sb.from('client_schedule_tokens')
    .upsert({ client_id: clientId, token, is_active: true }, { onConflict: 'client_id' })
    .select().single()
  return data
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
    companyName: row.company_name || row.companyName || '',
    squareCustomerId: row.square_customer_id,
    stripeCustomerId: row.stripe_customer_id,
    preferredContact: row.preferred_contact,
    // v5 fields
    referralSource: row.referral_source,
    referredByClientId: row.referred_by_client_id,
    defaultPaymentTerms: row.default_payment_terms,
    leadStage: row.lead_stage,
    lostReason: row.lost_reason,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toSnake(client) {
  return {
    id: client.id, name: client.name, email: client.email, phone: client.phone,
    address: client.address, status: client.status, type: client.type,
    source: client.source, notes: client.notes, tags: client.tags || [],
    company_name: client.companyName || '',
    square_customer_id: client.squareCustomerId || null,
    stripe_customer_id: client.stripeCustomerId || null,
    preferred_contact: client.preferredContact || 'email',
    // v5 fields
    referral_source: client.referralSource || null,
    referred_by_client_id: client.referredByClientId || null,
    default_payment_terms: client.defaultPaymentTerms || 30,
    lead_stage: client.leadStage || null,
    lost_reason: client.lostReason || null,
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
    // v5 fields
    serviceTypeId: row.service_type_id,
    assignedEmployeeId: row.assigned_employee_id,
    assignedTeamId: row.assigned_team_id,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    frequencyDiscountPct: row.frequency_discount_pct,
    extras: row.extras || [],
    checklistTemplateId: row.checklist_template_id,
    instructions: row.instructions,
    // v6 fields — service agreement
    recurrenceStartDate: row.recurrence_start_date,
    recurrenceEndDate: row.recurrence_end_date,
    preferredStartTime: row.preferred_start_time,
    preferredEndTime: row.preferred_end_time,
    visitGenerationHorizonWeeks: row.visit_generation_horizon_weeks,
    lastVisitGeneratedDate: row.last_visit_generated_date,
    source: row.source,
    isActive: row.is_active,
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
    // v5 fields
    service_type_id: job.serviceTypeId || null,
    assigned_employee_id: job.assignedEmployeeId || null,
    assigned_team_id: job.assignedTeamId || null,
    estimated_duration_minutes: job.estimatedDurationMinutes || null,
    frequency_discount_pct: job.frequencyDiscountPct || 0,
    extras: job.extras || [],
    checklist_template_id: job.checklistTemplateId || null,
    instructions: job.instructions || null,
    // v6 fields — service agreement
    recurrence_start_date: job.recurrenceStartDate || null,
    recurrence_end_date: job.recurrenceEndDate || null,
    preferred_start_time: job.preferredStartTime || null,
    preferred_end_time: job.preferredEndTime || null,
    visit_generation_horizon_weeks: job.visitGenerationHorizonWeeks || 8,
    last_visit_generated_date: job.lastVisitGeneratedDate || null,
    source: job.source || 'manual',
    is_active: job.isActive !== false,
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
    // v5 fields
    latitude: row.latitude, longitude: row.longitude,
    hasPets: row.has_pets, petDetails: row.pet_details,
    parkingInstructions: row.parking_instructions,
    accessType: row.access_type, doNotAreas: row.do_not_areas,
    cleaningNotes: row.cleaning_notes, photos: row.photos || [],
    stories: row.stories,
    googleCalendarId: row.google_calendar_id,
    autoScheduleTurnovers: row.auto_schedule_turnovers,
    lastIcalSyncAt: row.last_ical_sync_at,
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
    // v5 fields
    latitude: p.latitude || null, longitude: p.longitude || null,
    has_pets: p.hasPets || false, pet_details: p.petDetails || null,
    parking_instructions: p.parkingInstructions || null,
    access_type: p.accessType || null, do_not_areas: p.doNotAreas || null,
    cleaning_notes: p.cleaningNotes || null, photos: p.photos || [],
    stories: p.stories || 1,
    google_calendar_id: p.googleCalendarId || null,
    auto_schedule_turnovers: p.autoScheduleTurnovers || false,
    last_ical_sync_at: p.lastIcalSyncAt || null,
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

// ══════════════════════════════════════════
// v5 NORMALIZERS
// ══════════════════════════════════════════
function normalizeEmployee(row) {
  if (!row) return null
  return {
    id: row.id,
    connecteamUserId: row.connecteam_user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    hourlyRate: parseFloat(row.hourly_rate) || 0,
    customRates: row.custom_rates || {},
    hireDate: row.hire_date,
    status: row.status,
    zones: row.zones || [],
    skills: row.skills || [],
    maxHoursWeekly: row.max_hours_weekly,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function employeeToSnake(e) {
  return {
    id: e.id,
    connecteam_user_id: e.connecteamUserId || null,
    first_name: e.firstName,
    last_name: e.lastName || '',
    email: e.email || null,
    phone: e.phone || null,
    role: e.role || 'technician',
    hourly_rate: e.hourlyRate || null,
    custom_rates: e.customRates || {},
    hire_date: e.hireDate || null,
    status: e.status || 'active',
    zones: e.zones || [],
    skills: e.skills || [],
    max_hours_weekly: e.maxHoursWeekly || null,
    color: e.color || null,
  }
}

function normalizeTeam(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    leadEmployeeId: row.lead_employee_id,
    memberIds: row.member_ids || [],
    color: row.color,
    zone: row.zone,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function teamToSnake(t) {
  return {
    id: t.id,
    name: t.name,
    lead_employee_id: t.leadEmployeeId || null,
    member_ids: t.memberIds || [],
    color: t.color || null,
    zone: t.zone || null,
    active: t.active !== false,
  }
}

function normalizeServiceType(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baseDurationMinutes: row.base_duration_minutes,
    isRecurringEligible: row.is_recurring_eligible,
    checklistTemplateId: row.checklist_template_id,
    active: row.active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }
}

function serviceTypeToSnake(st) {
  return {
    id: st.id,
    name: st.name,
    description: st.description || null,
    base_duration_minutes: st.baseDurationMinutes || 120,
    is_recurring_eligible: st.isRecurringEligible !== false,
    checklist_template_id: st.checklistTemplateId || null,
    active: st.active !== false,
    sort_order: st.sortOrder || 0,
  }
}

function normalizePricingRule(row) {
  if (!row) return null
  return {
    id: row.id,
    serviceTypeId: row.service_type_id,
    propertyType: row.property_type,
    bedroomsMin: row.bedrooms_min,
    bedroomsMax: row.bedrooms_max,
    bathroomsMin: row.bathrooms_min,
    bathroomsMax: row.bathrooms_max,
    basePrice: parseFloat(row.base_price) || 0,
    pricePerSqft: parseFloat(row.price_per_sqft) || 0,
    frequencyDiscounts: row.frequency_discounts || {},
    createdAt: row.created_at,
  }
}

function pricingRuleToSnake(r) {
  return {
    id: r.id,
    service_type_id: r.serviceTypeId,
    property_type: r.propertyType || null,
    bedrooms_min: r.bedroomsMin || null,
    bedrooms_max: r.bedroomsMax || null,
    bathrooms_min: r.bathroomsMin || null,
    bathrooms_max: r.bathroomsMax || null,
    base_price: r.basePrice,
    price_per_sqft: r.pricePerSqft || null,
    frequency_discounts: r.frequencyDiscounts || {},
  }
}

function normalizeExtra(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    price: parseFloat(row.price) || 0,
    priceType: row.price_type,
    unitLabel: row.unit_label,
    durationMinutes: row.duration_minutes,
    active: row.active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }
}

function extraToSnake(e) {
  return {
    id: e.id,
    name: e.name,
    price: e.price,
    price_type: e.priceType || 'flat',
    unit_label: e.unitLabel || null,
    duration_minutes: e.durationMinutes || 0,
    active: e.active !== false,
    sort_order: e.sortOrder || 0,
  }
}

function normalizeChecklistTemplate(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    sections: row.sections || [],
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function checklistTemplateToSnake(t) {
  return {
    id: t.id,
    name: t.name,
    sections: t.sections || [],
    active: t.active !== false,
  }
}

function normalizeVisit(row) {
  if (!row) return null
  return {
    id: row.id,
    jobId: row.job_id,
    clientId: row.client_id,
    propertyId: row.property_id,
    visitNumber: row.visit_number,
    scheduledDate: row.scheduled_date,
    scheduledStartTime: row.scheduled_start_time,
    scheduledEndTime: row.scheduled_end_time,
    status: row.status,
    assignedEmployeeId: row.assigned_employee_id,
    assignedTeamId: row.assigned_team_id,
    actualStartTime: row.actual_start_time,
    actualEndTime: row.actual_end_time,
    durationActualMinutes: row.duration_actual_minutes,
    startLat: row.start_lat, startLng: row.start_lng,
    endLat: row.end_lat, endLng: row.end_lng,
    checklistSnapshot: row.checklist_snapshot,
    photosBefore: row.photos_before || [],
    photosAfter: row.photos_after || [],
    employeeNotes: row.employee_notes,
    clientRating: row.client_rating,
    clientFeedback: row.client_feedback,
    mileage: row.mileage ? parseFloat(row.mileage) : null,
    priceOverride: row.price_override ? parseFloat(row.price_override) : null,
    invoiceId: row.invoice_id,
    googleEventId: row.google_event_id,
    connecteamShiftId: row.connecteam_shift_id,
    // v6 fields
    source: row.source,
    serviceTypeId: row.service_type_id,
    clientVisible: row.client_visible,
    reminderSentAt: row.reminder_sent_at,
    confirmedAt: row.confirmed_at,
    icalEventUid: row.ical_event_uid,
    turnoTaskId: row.turno_task_id,
    instructions: row.instructions,
    address: row.address,
    // joined data (when using select with joins)
    job: row.job || null,
    client: row.client || null,
    property: row.property || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function visitToSnake(v) {
  return {
    id: v.id,
    job_id: v.jobId,
    client_id: v.clientId,
    property_id: v.propertyId || null,
    visit_number: v.visitNumber || 1,
    scheduled_date: v.scheduledDate,
    scheduled_start_time: v.scheduledStartTime || null,
    scheduled_end_time: v.scheduledEndTime || null,
    status: v.status || 'scheduled',
    assigned_employee_id: v.assignedEmployeeId || null,
    assigned_team_id: v.assignedTeamId || null,
    actual_start_time: v.actualStartTime || null,
    actual_end_time: v.actualEndTime || null,
    duration_actual_minutes: v.durationActualMinutes || null,
    start_lat: v.startLat || null, start_lng: v.startLng || null,
    end_lat: v.endLat || null, end_lng: v.endLng || null,
    checklist_snapshot: v.checklistSnapshot || null,
    photos_before: v.photosBefore || [],
    photos_after: v.photosAfter || [],
    employee_notes: v.employeeNotes || null,
    client_rating: v.clientRating || null,
    client_feedback: v.clientFeedback || null,
    mileage: v.mileage || null,
    price_override: v.priceOverride || null,
    invoice_id: v.invoiceId || null,
    google_event_id: v.googleEventId || null,
    connecteam_shift_id: v.connecteamShiftId || null,
    // v6 fields
    source: v.source || 'manual',
    service_type_id: v.serviceTypeId || null,
    client_visible: v.clientVisible !== false,
    reminder_sent_at: v.reminderSentAt || null,
    confirmed_at: v.confirmedAt || null,
    ical_event_uid: v.icalEventUid || null,
    turno_task_id: v.turnoTaskId || null,
    instructions: v.instructions || null,
    address: v.address || null,
  }
}
