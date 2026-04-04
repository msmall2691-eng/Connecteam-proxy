const PROXY_BASE = '/api/connecteam'

// Use stored key or fall back to env
export function getApiKey() {
  return localStorage.getItem('connecteam_api_key') || import.meta.env.VITE_CONNECTEAM_API_KEY || ''
}

export function setApiKey(key) {
  localStorage.setItem('connecteam_api_key', key)
}

// Get the current Supabase auth token for API calls
async function getAuthToken() {
  try {
    const { getSupabase, isSupabaseConfigured } = await import('./supabase')
    if (!isSupabaseConfigured()) return null
    const sb = getSupabase()
    if (!sb) return null
    const { data } = await sb.auth.getSession()
    return data?.session?.access_token || null
  } catch {
    return null
  }
}

// Authenticated fetch helper — adds Bearer token to any /api/* call
export async function authFetch(url, options = {}) {
  const token = await getAuthToken()
  const headers = { ...options.headers }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return fetch(url, { ...options, headers })
}

// Simple fetch — no client-side retry (proxy is stateless, Vercel Hobby has 10s timeout)
export async function apiGet(path, params = {}) {
  const query = new URLSearchParams({ path, ...params })
  const url = `${PROXY_BASE}?${query}`
  const headers = {}
  const key = getApiKey()
  if (key) headers['X-API-KEY'] = key

  const res = await fetch(url, { headers })

  if (res.status === 429) {
    throw new Error('RATE_LIMITED')
  }

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }

  const data = await res.json()
  if (data?.detail?.includes?.('Too many requests')) {
    throw new Error('RATE_LIMITED')
  }

  return data
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
