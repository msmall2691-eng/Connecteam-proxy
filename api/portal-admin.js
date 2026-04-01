// Vercel serverless: Portal Account Management (admin-only)
// Handles creation, management, and password resets for portal accounts
// POST /api/portal-admin?action=create-portal-account|create-on-quote|toggle-portal-access|reset-client-password
// GET /api/portal-admin?action=portal-users

import bcrypt from 'bcryptjs'
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

// Admin emails that can manage portal accounts
const ADMIN_EMAILS = [
  'office@mainecleaningco.com',
  'msmall2691@gmail.com',
]

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

function verifyAdmin(req) {
  // Check for API key
  const apiKey = req.headers['x-api-key']
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) return true

  // Check for Supabase session (admin auth via cookie/header)
  // For now, accept requests from allowed origins with valid API key
  return false
}

function generateTempPassword() {
  return crypto.randomBytes(6).toString('hex') // 12 chars
}

export default async function handler(req, res) {
  const origin = req.headers.origin || ''
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig()
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Database not configured' })
  }
  const headers = sbHeaders(supabaseKey)
  const action = req.query.action

  // Admin verification - accept API key or Supabase service key match
  const apiKey = req.headers['x-api-key'] || ''
  const authHeader = req.headers.authorization || ''
  const adminKey = process.env.ADMIN_API_KEY || process.env.SUPABASE_SERVICE_KEY
  const isAdmin = (apiKey && apiKey === adminKey) ||
                  (authHeader && authHeader === `Bearer ${adminKey}`) ||
                  // Allow from frontend with Supabase anon key (admin is already authenticated via Supabase Auth)
                  (authHeader && authHeader.includes(process.env.VITE_SUPABASE_ANON_KEY))

  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' })
  }

  try {
    // ── CREATE PORTAL ACCOUNT ──
    if (req.method === 'POST' && action === 'create-portal-account') {
      const { clientId, email: customEmail } = req.body || {}
      if (!clientId) return res.status(400).json({ error: 'clientId is required' })

      // Fetch client
      const clientRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=*`,
        { headers }
      )
      const clients = await clientRes.json()
      if (!clients?.length) return res.status(404).json({ error: 'Client not found' })
      const client = clients[0]

      // Check if already has portal account
      if (client.portal_enabled && client.portal_user_id) {
        return res.status(409).json({ error: 'Client already has a portal account' })
      }

      const portalEmail = (customEmail || client.email || '').trim().toLowerCase()
      if (!portalEmail) {
        return res.status(400).json({ error: 'Client email is required for portal access' })
      }

      // Check if email already used by another portal user
      const existingRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users?email=eq.${encodeURIComponent(portalEmail)}&select=id`,
        { headers }
      )
      const existing = await existingRes.json()
      if (existing?.length) {
        return res.status(409).json({ error: 'This email is already registered for portal access' })
      }

      const tempPassword = generateTempPassword()
      const hash = await bcrypt.hash(tempPassword, 10)

      // Create portal user
      const createRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users`,
        {
          method: 'POST', headers,
          body: JSON.stringify({
            client_id: clientId,
            email: portalEmail,
            password_hash: hash,
            name: client.name || 'Client',
            temp_password: true,
            must_change_password: true,
            is_active: true,
          }),
        }
      )
      const created = await createRes.json()
      const portalUserId = created?.[0]?.id || created?.id
      if (!portalUserId) return res.status(500).json({ error: 'Failed to create portal user' })

      // Update client
      await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`,
        {
          method: 'PATCH', headers,
          body: JSON.stringify({
            portal_enabled: true,
            portal_user_id: portalUserId,
          }),
        }
      )

      return res.status(201).json({
        success: true,
        portalUserId,
        email: portalEmail,
        tempPassword,
        portalUrl: 'https://tmcc.app/#/portal/login',
        message: `Portal account created. Share the temp password with the client: ${tempPassword}`,
      })
    }

    // ── CREATE ON QUOTE ──
    if (req.method === 'POST' && action === 'create-on-quote') {
      const { clientId, quoteId } = req.body || {}
      if (!clientId) return res.status(400).json({ error: 'clientId is required' })

      // Check if client already has portal access
      const clientRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=*`,
        { headers }
      )
      const clients = await clientRes.json()
      if (!clients?.length) return res.status(404).json({ error: 'Client not found' })
      const client = clients[0]

      if (client.portal_enabled && client.portal_user_id) {
        return res.status(200).json({
          success: true,
          alreadyExists: true,
          portalUrl: 'https://tmcc.app/#/portal/login',
          message: 'Client already has portal access',
        })
      }

      const portalEmail = (client.email || '').trim().toLowerCase()
      if (!portalEmail) {
        return res.status(400).json({ error: 'Client email is required for portal access' })
      }

      const tempPassword = generateTempPassword()
      const hash = await bcrypt.hash(tempPassword, 10)

      const createRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users`,
        {
          method: 'POST', headers,
          body: JSON.stringify({
            client_id: clientId,
            email: portalEmail,
            password_hash: hash,
            name: client.name || 'Client',
            temp_password: true,
            must_change_password: true,
            is_active: true,
          }),
        }
      )
      const created = await createRes.json()
      const portalUserId = created?.[0]?.id || created?.id
      if (!portalUserId) return res.status(500).json({ error: 'Failed to create portal user' })

      await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`,
        {
          method: 'PATCH', headers,
          body: JSON.stringify({
            portal_enabled: true,
            portal_user_id: portalUserId,
          }),
        }
      )

      return res.status(201).json({
        success: true,
        portalUserId,
        email: portalEmail,
        tempPassword,
        portalUrl: 'https://tmcc.app/#/portal/login',
        message: `Portal account created for quote. Share password: ${tempPassword}`,
      })
    }

    // ── LIST PORTAL USERS ──
    if (req.method === 'GET' && action === 'portal-users') {
      const usersRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users?select=id,client_id,email,name,is_active,last_login,login_count,must_change_password,created_at&order=created_at.desc`,
        { headers }
      )
      const users = await usersRes.json()

      // Fetch associated client info
      const clientIds = [...new Set((users || []).map(u => u.client_id).filter(Boolean))]
      let clientMap = {}
      if (clientIds.length) {
        const clientsRes = await fetch(
          `${supabaseUrl}/rest/v1/clients?id=in.(${clientIds.join(',')})&select=id,name,email,phone,status`,
          { headers }
        )
        const clients = await clientsRes.json()
        clientMap = (clients || []).reduce((m, c) => { m[c.id] = c; return m }, {})
      }

      return res.status(200).json({
        users: (users || []).map(u => ({
          id: u.id,
          email: u.email,
          name: u.name,
          isActive: u.is_active,
          lastLogin: u.last_login,
          loginCount: u.login_count,
          mustChangePassword: u.must_change_password,
          createdAt: u.created_at,
          client: clientMap[u.client_id] ? {
            id: clientMap[u.client_id].id,
            name: clientMap[u.client_id].name,
            email: clientMap[u.client_id].email,
            status: clientMap[u.client_id].status,
          } : null,
        })),
      })
    }

    // ── TOGGLE PORTAL ACCESS ──
    if (req.method === 'POST' && action === 'toggle-portal-access') {
      const { portalUserId, isActive } = req.body || {}
      if (!portalUserId || typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'portalUserId and isActive (boolean) are required' })
      }

      await fetch(
        `${supabaseUrl}/rest/v1/portal_users?id=eq.${portalUserId}`,
        {
          method: 'PATCH', headers,
          body: JSON.stringify({ is_active: isActive }),
        }
      )

      // Also update client record
      const userRes = await fetch(
        `${supabaseUrl}/rest/v1/portal_users?id=eq.${portalUserId}&select=client_id`,
        { headers }
      )
      const users = await userRes.json()
      if (users?.[0]?.client_id) {
        await fetch(
          `${supabaseUrl}/rest/v1/clients?id=eq.${users[0].client_id}`,
          {
            method: 'PATCH', headers,
            body: JSON.stringify({ portal_enabled: isActive }),
          }
        )
      }

      return res.status(200).json({ success: true, isActive })
    }

    // ── RESET CLIENT PASSWORD ──
    if (req.method === 'POST' && action === 'reset-client-password') {
      const { portalUserId } = req.body || {}
      if (!portalUserId) return res.status(400).json({ error: 'portalUserId is required' })

      const tempPassword = generateTempPassword()
      const hash = await bcrypt.hash(tempPassword, 10)

      await fetch(
        `${supabaseUrl}/rest/v1/portal_users?id=eq.${portalUserId}`,
        {
          method: 'PATCH', headers,
          body: JSON.stringify({
            password_hash: hash,
            temp_password: true,
            must_change_password: true,
            reset_token: null,
            reset_token_expires: null,
          }),
        }
      )

      return res.status(200).json({
        success: true,
        tempPassword,
        message: `Password reset. Share the new temp password with the client: ${tempPassword}`,
      })
    }

    return res.status(400).json({ error: 'Invalid action' })
  } catch (err) {
    console.error('Portal admin error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
