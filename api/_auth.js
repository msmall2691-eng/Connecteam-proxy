// Shared API authentication middleware
// Import and use in any API route that requires admin/staff access
//
// Usage in an API route:
//   import { requireAuth, requireRole } from './_auth.js'
//
//   export default async function handler(req, res) {
//     const user = await requireAuth(req, res)
//     if (!user) return // already sent 401
//
//     // Or require a specific role:
//     const admin = await requireRole(req, res, ['owner', 'admin'])
//     if (!admin) return // already sent 403
//   }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

// Public endpoints that don't require auth (webhooks, client portal, crons)
const PUBLIC_ACTIONS = new Set([
  // Client-facing
  'portal', 'confirm', 'confirm-token', 'quote', 'quote-decline', 'pm-portal',
  // Webhooks
  'webhook', 'turno-webhook', 'fb-webhook', 'fb-verify',
  // Cron jobs (verified by Vercel's cron secret or internal call)
  'generate-recurring', 'calendar-sync', 'scan', 'send', 'follow-up',
  'review-request', 'run-sequences',
  // Booking form (public)
  'book', 'availability',
])

// Cron jobs are called by Vercel's cron scheduler — verify with CRON_SECRET
function isCronRequest(req) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true // no secret configured = allow (backward compat)
  return req.headers['authorization'] === `Bearer ${cronSecret}`
}

/**
 * Verify the JWT from the Authorization header against Supabase.
 * Returns the user profile (with role) or null.
 */
export async function getAuthUser(req) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)

  try {
    // Verify JWT with Supabase auth
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY },
    })

    if (!userRes.ok) return null
    const user = await userRes.json()
    if (!user?.id) return null

    // Fetch user profile with role
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?auth_user_id=eq.${user.id}&is_active=eq.true&select=*`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    )

    const profiles = await profileRes.json()
    const profile = profiles?.[0]

    return {
      id: user.id,
      email: user.email,
      role: profile?.role || 'viewer',
      employee_id: profile?.employee_id || null,
      client_id: profile?.client_id || null,
      profile,
    }
  } catch (err) {
    console.error('Auth verification failed:', err.message)
    return null
  }
}

/**
 * Require authentication. Returns user or sends 401 and returns null.
 */
export async function requireAuth(req, res) {
  // Check if this is a public action
  const action = req.query?.action || ''
  if (PUBLIC_ACTIONS.has(action)) return { role: 'public', isPublic: true }

  // Check if this is a cron request
  if (isCronRequest(req) && PUBLIC_ACTIONS.has(action)) {
    return { role: 'system', isCron: true }
  }

  // Check for API key (for server-to-server calls)
  const apiKey = req.headers['x-api-key']
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
    return { role: 'admin', isApiKey: true }
  }

  const user = await getAuthUser(req)
  if (!user) {
    res.status(401).json({ error: 'Authentication required' })
    return null
  }

  return user
}

/**
 * Require a specific role. Returns user or sends 403 and returns null.
 * @param {string[]} allowedRoles - e.g. ['owner', 'admin', 'manager']
 */
export async function requireRole(req, res, allowedRoles) {
  const user = await requireAuth(req, res)
  if (!user) return null

  // Public/cron/API key requests bypass role checks
  if (user.isPublic || user.isCron || user.isApiKey) return user

  if (!allowedRoles.includes(user.role)) {
    res.status(403).json({ error: 'Insufficient permissions', required: allowedRoles, current: user.role })
    return null
  }

  return user
}

/**
 * Standard CORS headers for admin endpoints (restrict to known origins)
 */
export function setAdminCors(req, res) {
  const ADMIN_ORIGINS = [
    'https://connecteam-proxy.vercel.app',
    'http://localhost:5000',
    'http://localhost:5173',
  ]
  const origin = req.headers.origin || ''
  const allowed = ADMIN_ORIGINS.includes(origin) ? origin : ADMIN_ORIGINS[0]

  res.setHeader('Access-Control-Allow-Origin', allowed)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
}
