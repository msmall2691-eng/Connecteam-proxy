// Simple client data store using localStorage
// Architecture is ready to swap to a real API/database later

const STORE_KEY = 'workflowhq_data'

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || defaultData()
  } catch {
    return defaultData()
  }
}

function save(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data))
}

function defaultData() {
  return {
    clients: [],
    conversations: [],
    jobs: [],
  }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ── Clients ──

export function getClients() {
  return load().clients
}

export function getClient(id) {
  return load().clients.find(c => c.id === id) || null
}

export function saveClient(client) {
  const data = load()
  const now = new Date().toISOString()
  if (client.id) {
    const idx = data.clients.findIndex(c => c.id === client.id)
    if (idx >= 0) {
      data.clients[idx] = { ...data.clients[idx], ...client, updatedAt: now }
    }
  } else {
    client.id = genId()
    client.createdAt = now
    client.updatedAt = now
    data.clients.unshift(client)
  }
  save(data)
  return client
}

export function deleteClient(id) {
  const data = load()
  data.clients = data.clients.filter(c => c.id !== id)
  // Also remove related conversations and jobs
  data.conversations = data.conversations.filter(c => c.clientId !== id)
  data.jobs = data.jobs.filter(j => j.clientId !== id)
  save(data)
}

// ── Conversations ──

export function getConversations(clientId = null) {
  const data = load()
  let convos = data.conversations
  if (clientId) convos = convos.filter(c => c.clientId === clientId)
  return convos.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

export function getConversation(id) {
  return load().conversations.find(c => c.id === id) || null
}

export function saveConversation(convo) {
  const data = load()
  const now = new Date().toISOString()
  if (convo.id) {
    const idx = data.conversations.findIndex(c => c.id === convo.id)
    if (idx >= 0) {
      data.conversations[idx] = { ...data.conversations[idx], ...convo, updatedAt: now }
    }
  } else {
    convo.id = genId()
    convo.createdAt = now
    convo.updatedAt = now
    convo.messages = convo.messages || []
    data.conversations.unshift(convo)
  }
  save(data)
  return convo
}

export function addMessage(convoId, message) {
  const data = load()
  const now = new Date().toISOString()
  const idx = data.conversations.findIndex(c => c.id === convoId)
  if (idx >= 0) {
    message.id = genId()
    message.timestamp = now
    data.conversations[idx].messages.push(message)
    data.conversations[idx].updatedAt = now
    data.conversations[idx].lastMessage = message.content?.slice(0, 100) || ''
    save(data)
  }
  return message
}

// ── Jobs ──

export function getJobs(clientId = null) {
  const data = load()
  let jobs = data.jobs
  if (clientId) jobs = jobs.filter(j => j.clientId === clientId)
  return jobs.sort((a, b) => new Date(b.date) - new Date(a.date))
}

export function getJob(id) {
  return load().jobs.find(j => j.id === id) || null
}

export function saveJob(job) {
  const data = load()
  const now = new Date().toISOString()
  if (job.id) {
    const idx = data.jobs.findIndex(j => j.id === job.id)
    if (idx >= 0) {
      data.jobs[idx] = { ...data.jobs[idx], ...job, updatedAt: now }
    }
  } else {
    job.id = genId()
    job.createdAt = now
    job.updatedAt = now
    data.jobs.unshift(job)
  }
  save(data)
  return job
}

export function deleteJob(id) {
  const data = load()
  data.jobs = data.jobs.filter(j => j.id !== id)
  save(data)
}

// ── Import/Export ──

export function exportData() {
  return load()
}

export function importData(data) {
  save(data)
}
