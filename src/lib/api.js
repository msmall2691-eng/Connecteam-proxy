const PROXY_BASE = '/api/connecteam'

// Use stored key or fall back to env
export function getApiKey() {
  return localStorage.getItem('connecteam_api_key') || ''
}

export function setApiKey(key) {
  localStorage.setItem('connecteam_api_key', key)
}

// Rate limit queue — space out requests to avoid Connecteam 429s
let lastRequestTime = 0
const MIN_DELAY = 5000 // 5 seconds between requests

async function rateLimitedFetch(url, options = {}) {
  const now = Date.now()
  const wait = Math.max(0, lastRequestTime + MIN_DELAY - now)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRequestTime = Date.now()
  return fetch(url, options)
}

export async function apiGet(path, params = {}) {
  const query = new URLSearchParams({ path, ...params })
  const url = `${PROXY_BASE}?${query}`
  const headers = {}
  const key = getApiKey()
  if (key) headers['X-API-KEY'] = key

  // Single attempt — proxy handles retries server-side
  const res = await rateLimitedFetch(url, { headers })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${text.slice(0, 100)}`)
  }

  return res.json()
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
