const PROXY_BASE = '/api/connecteam'

// Use stored key or fall back to env
export function getApiKey() {
  return localStorage.getItem('connecteam_api_key') || ''
}

export function setApiKey(key) {
  localStorage.setItem('connecteam_api_key', key)
}

// Rate limit queue — Connecteam allows ~5 requests per 10 seconds
let lastRequestTime = 0
const MIN_DELAY = 3000 // ms between requests — Connecteam allows ~5 req/10s

async function rateLimitedFetch(url, options = {}) {
  const now = Date.now()
  const wait = Math.max(0, lastRequestTime + MIN_DELAY - now)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRequestTime = Date.now()
  return fetch(url, options)
}

export async function apiGet(path, params = {}, retries = 3) {
  const query = new URLSearchParams({ path, ...params })
  const url = `${PROXY_BASE}?${query}`
  const headers = {}
  const key = getApiKey()
  if (key) headers['X-API-KEY'] = key

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await rateLimitedFetch(url, { headers })

    if (res.status === 429) {
      // Rate limited — wait and retry
      const backoff = Math.pow(2, attempt + 1) * 2000 // 4s, 8s, 16s
      await new Promise(r => setTimeout(r, backoff))
      continue
    }

    if (!res.ok) throw new Error(`API error: ${res.status}`)

    const data = await res.json()
    // Connecteam sometimes returns rate limit in the body
    if (data?.detail?.includes?.('Too many requests')) {
      const backoff = Math.pow(2, attempt + 1) * 1000
      await new Promise(r => setTimeout(r, backoff))
      continue
    }

    return data
  }

  throw new Error('Rate limited by Connecteam API. Try again in a moment.')
}

export async function fetchUsers() {
  const data = await apiGet('users/v1/users')
  const users = {}
  for (const u of data.data?.objects || []) {
    users[u.id] = {
      id: u.id,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      role: u.role,
      title: u.title || '',
      email: u.email || '',
    }
  }
  return users
}

export function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function getWeekRange(weeksAgo = 0) {
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() - (end.getDay() === 0 ? 6 : end.getDay() - 1) - weeksAgo * 7 + 6)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  }
}

export function dateRangeWeeks(numWeeks) {
  const now = new Date()
  const end = new Date(now)
  const start = new Date(now)
  start.setDate(start.getDate() - numWeeks * 7)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  }
}

const TIME_CLOCK_ID = 15248536
const SCHEDULER_ID = 15248539

export async function fetchTimesheets(startDate, endDate) {
  return apiGet(`time-clock/v1/time-clocks/${TIME_CLOCK_ID}/timesheet`, { startDate, endDate })
}

export async function fetchTimeActivities(startDate, endDate) {
  return apiGet(`time-clock/v1/time-clocks/${TIME_CLOCK_ID}/time-activities`, { startDate, endDate })
}

export async function fetchShifts(startDate, endDate) {
  const startTime = Math.floor(new Date(startDate).getTime() / 1000)
  const endTime = Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000)
  return apiGet(`scheduler/v1/schedulers/${SCHEDULER_ID}/shifts`, { startTime, endTime })
}
