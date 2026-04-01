// Vercel serverless: Portal Authentication
// Handles login, password change, forgot/reset password for client portal users
// POST /api/portal-auth?action=login|change-password|forgot-password|reset-password
// GET /api/portal-auth?action=me

import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'

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

// Rate limiting (in-memory, resets on cold start)
const loginAttempts = new Map()
const forgotAttempts = new Map()

// Clear rate limit maps every 60 seconds
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of loginAttempts) {
    if (now - val.firstAttempt > 5 * 60 * 1000) loginAttempts.delete(key)
  }
  for (const [key, val] of forgotAttempts) {
    if (now - val.firstAttempt > 15 * 60 * 1000) forgotAttempts.delete(key)
  }
}, 60000)

function checkLoginRateLimit(email) {
  const key = email.toLowerCase()
  const entry = loginAttempts.get(key)
  if (!entry) return true
  if (Date.now() - entry.firstAttempt > 5 * 60 * 1000) {
    loginAttempts.delete(key)
    return true
  }
  return entry.count < 5
}

function recordLoginAttempt(email) {
  const key = email.toLowerCase()
  const entry = loginAttempts.get(key)
  if (!entry || Date.now() - entry.firstAttempt > 5 * 60 * 1000) {
    loginAttempts.set(key, { count: 1, firstAttempt: Date.now() })
  } else {
    entry.count++
  }
}

function checkForgotRateLimit(email) {
  const key = email.toLowerCase()
  const entry = forgotAttempts.get(key)
  if (!entry) return true
  if (Date.now() - entry.firstAttempt > 15 * 60 * 1000) {
    forgotAttempts.delete(key)
    return true
  }
  return entry.count < 3
}

function recordForgotAttempt(email) {
  const key = email.toLowerCase()
  const entry = forgotAttempts.get(key)
  if (!entry || Date.now() - entry.firstAttempt > 15 * 60 * 1000) {
    forgotAttempts.set(key, { count: 1, firstAttempt: Date.now() })
  } else {
    entry.count++
  }
}

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

export function verifyPortalToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  if (!authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const secret = process.env.PORTAL_JWT_SECRET
  if (!secret) return null
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] })
  } catch {
    return null
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
  const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig()
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Database not configured' })
  }
  const jwtSecret = process.env.PORTAL_JWT_SECRET
  if (!jwtSecret) {
    return res.status(500).json({ error: 'Portal not configured' })
  }

  const headers = sbHeaders(supabaseKey)

  try {
    // ── LOGIN ──
    if (req.method === 'POST' && action === 'login') {
      const { email, password } = req.body || {}
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' })
      }
      const normalizedEmail = email.trim().toLowerCase()

      if (!checkLoginRateLimit(normalizedEmail)) {
        return res.status(429).json({ error: 'Too many login attempts. Please try again in a few minutes.' })
      }

      // Find portal user
      const userRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users?email=eq.${encodeURIComponent(normalizedEmail)}&is_active=eq.true&select=*`,
        { headers }
      )
      const users = await userRes.json()
      if (!users?.length) {
        recordLoginAttempt(normalizedEmail)
        console.log(`Failed portal login attempt: ${normalizedEmail}`)
        return res.status(401).json({ error: 'Invalid email or password' })
      }
      const user = users[0]

      // Verify password
      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid) {
        recordLoginAttempt(normalizedEmail)
        console.log(`Failed portal login attempt (bad password): ${normalizedEmail}`)
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      // Generate JWT
      const token = jwt.sign(
        {
          portalUserId: user.id,
          clientId: user.client_id,
          email: user.email,
          name: user.name,
        },
        jwtSecret,
        { algorithm: 'HS256', expiresIn: '7d' }
      )

      // Update last_login and login_count
      await fetch(
        `${supabaseUrl}/rest/v1/portal_users?id=eq.${user.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            last_login: new Date().toISOString(),
            login_count: (user.login_count || 0) + 1,
          }),
        }
      )

      return res.status(200).json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          clientId: user.client_id,
          mustChangePassword: user.must_change_password,
        },
      })
    }

    // ── CHANGE PASSWORD ──
    if (req.method === 'POST' && action === 'change-password') {
      const decoded = verifyPortalToken(req)
      if (!decoded) return res.status(401).json({ error: 'Unauthorized' })

      const { oldPassword, newPassword } = req.body || {}
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' })
      }

      // Fetch current user
      const userRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users?id=eq.${decoded.portalUserId}&select=*`,
        { headers }
      )
      const users = await userRes.json()
      if (!users?.length) return res.status(404).json({ error: 'User not found' })
      const user = users[0]

      // If not temp password, verify old password
      if (!user.temp_password && !user.must_change_password) {
        if (!oldPassword) {
          return res.status(400).json({ error: 'Current password is required' })
        }
        const valid = await bcrypt.compare(oldPassword, user.password_hash)
        if (!valid) {
          return res.status(401).json({ error: 'Current password is incorrect' })
        }
      }

      const hash = await bcrypt.hash(newPassword, 10)
      await fetch(
        `${supabaseUrl}/rest/v1/portal_users?id=eq.${user.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            password_hash: hash,
            must_change_password: false,
            temp_password: false,
          }),
        }
      )

      return res.status(200).json({ success: true, message: 'Password changed successfully' })
    }

    // ── FORGOT PASSWORD ──
    if (req.method === 'POST' && action === 'forgot-password') {
      const { email } = req.body || {}
      if (!email) return res.status(400).json({ error: 'Email is required' })
      const normalizedEmail = email.trim().toLowerCase()

      if (!checkForgotRateLimit(normalizedEmail)) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' })
      }
      recordForgotAttempt(normalizedEmail)

      // Always return success (don't reveal if email exists)
      const userRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users?email=eq.${encodeURIComponent(normalizedEmail)}&is_active=eq.true&select=id`,
        { headers }
      )
      const users = await userRes.json()

      if (users?.length) {
        const resetToken = crypto.randomBytes(32).toString('hex')
        const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
        await fetch(
          `${supabaseUrl}/rest/v1/portal_users?id=eq.${users[0].id}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              reset_token: resetToken,
              reset_token_expires: expires,
            }),
          }
        )
      }

      return res.status(200).json({ success: true, message: 'If this email is registered, a reset link will be sent.' })
    }

    // ── RESET PASSWORD ──
    if (req.method === 'POST' && action === 'reset-password') {
      const { token, newPassword } = req.body || {}
      if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token and new password are required' })
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' })
      }

      const userRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users?reset_token=eq.${encodeURIComponent(token)}&is_active=eq.true&select=*`,
        { headers }
      )
      const users = await userRes.json()
      if (!users?.length) {
        return res.status(400).json({ error: 'Invalid or expired reset token' })
      }
      const user = users[0]

      if (!user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
        return res.status(400).json({ error: 'Reset token has expired' })
      }

      const hash = await bcrypt.hash(newPassword, 10)
      await fetch(
        `${supabaseUrl}/rest/v1/portal_users?id=eq.${user.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            password_hash: hash,
            reset_token: null,
            reset_token_expires: null,
            must_change_password: false,
            temp_password: false,
          }),
        }
      )

      return res.status(200).json({ success: true, message: 'Password reset successfully' })
    }

    // ── ME (current user info) ──
    if (req.method === 'GET' && action === 'me') {
      const decoded = verifyPortalToken(req)
      if (!decoded) return res.status(401).json({ error: 'Unauthorized' })

      const userRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users?id=eq.${decoded.portalUserId}&is_active=eq.true&select=id,name,email,client_id,must_change_password,last_login,login_count,created_at`,
        { headers }
      )
      const users = await userRes.json()
      if (!users?.length) return res.status(404).json({ error: 'User not found' })
      const user = users[0]

      // Also fetch client info
      const clientRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${user.client_id}&select=id,name,email,phone,address,status`,
        { headers }
      )
      const clients = await clientRes.json()

      return res.status(200).json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          clientId: user.client_id,
          mustChangePassword: user.must_change_password,
          lastLogin: user.last_login,
          loginCount: user.login_count,
          createdAt: user.created_at,
        },
        client: clients?.[0] ? {
          id: clients[0].id,
          name: clients[0].name,
          email: clients[0].email,
          phone: clients[0].phone,
          address: clients[0].address,
        } : null,
      })
    }

    return res.status(400).json({ error: 'Invalid action' })
  } catch (err) {
    console.error('Portal auth error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
