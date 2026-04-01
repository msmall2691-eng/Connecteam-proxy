// Simple built-in authentication (works without Supabase)
// Uses SHA-256 hash stored in localStorage

const AUTH_KEY = 'workflowhq_auth'
const SESSION_KEY = 'workflowhq_session'
const SESSION_DURATION = 24 * 60 * 60 * 1000 // 24 hours

async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + '_workflowhq_salt_2024')
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function isPasswordSet() {
  return !!localStorage.getItem(AUTH_KEY)
}

export async function setPassword(password) {
  const hash = await hashPassword(password)
  localStorage.setItem(AUTH_KEY, hash)
  // Auto-login after setup
  createSession()
}

export async function verifyPassword(password) {
  const stored = localStorage.getItem(AUTH_KEY)
  if (!stored) return false
  const hash = await hashPassword(password)
  return hash === stored
}

export function createSession() {
  const session = {
    ts: Date.now(),
    expires: Date.now() + SESSION_DURATION,
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function isSessionValid() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY))
    if (!session) return false
    return session.expires > Date.now()
  } catch {
    return false
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export async function changePassword(currentPassword, newPassword) {
  const valid = await verifyPassword(currentPassword)
  if (!valid) return false
  const hash = await hashPassword(newPassword)
  localStorage.setItem(AUTH_KEY, hash)
  return true
}
