import { createContext, useContext, useState, useEffect } from 'react'
import { getSupabase, isSupabaseConfigured } from './supabase'
import {
  isPasswordSet, verifyPassword, setPassword as setLocalPassword,
  isSessionValid, createSession, clearSession, changePassword
} from './localAuth'

const AuthContext = createContext(null)

// Role hierarchy for permission checks
const ROLE_LEVELS = { owner: 7, admin: 6, manager: 5, dispatcher: 4, technician: 3, viewer: 2, client: 1 }

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load user profile (role, employee_id, etc.) from user_profiles table
  async function loadProfile(authUser) {
    if (!authUser?.id) return null
    const sb = getSupabase()
    if (!sb) return null

    try {
      const { data, error } = await sb
        .from('user_profiles')
        .select('*')
        .eq('auth_user_id', authUser.id)
        .eq('is_active', true)
        .single()

      if (error || !data) {
        // No profile yet — user exists in auth but not in user_profiles
        // Allow access with 'viewer' role so they can at least see the app
        return { role: 'viewer', display_name: authUser.email }
      }

      // Update last login
      sb.from('user_profiles')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', data.id)
        .then(() => {})

      return data
    } catch {
      return { role: 'viewer', display_name: authUser.email }
    }
  }

  useEffect(() => {
    if (isSupabaseConfigured()) {
      const sb = getSupabase()
      if (!sb) { setLoading(false); return }
      sb.auth.getSession().then(async ({ data: { session } }) => {
        const sessionUser = session?.user || null
        if (sessionUser) {
          const prof = await loadProfile(sessionUser)
          setUser(sessionUser)
          setProfile(prof)
        }
        setLoading(false)
      })
      const { data: { subscription } } = sb.auth.onAuthStateChange(async (_event, session) => {
        const sessionUser = session?.user || null
        setUser(sessionUser)
        if (sessionUser) {
          const prof = await loadProfile(sessionUser)
          setProfile(prof)
        } else {
          setProfile(null)
        }
      })
      return () => subscription.unsubscribe()
    } else {
      // Local auth: check session
      if (isSessionValid()) {
        setUser({ email: 'admin@mainecleaningco.com', isLocal: true })
        setProfile({ role: 'owner', display_name: 'Admin' })
      }
      setLoading(false)
    }
  }, [])

  async function signIn(email, password) {
    if (isSupabaseConfigured()) {
      const sb = getSupabase()
      if (!sb) return { error: { message: 'Supabase not configured' } }
      const { data, error } = await sb.auth.signInWithPassword({ email, password })
      if (error) return { error }
      const prof = await loadProfile(data.user)
      setUser(data.user)
      setProfile(prof)
      return { data }
    }
    // Local auth
    const valid = await verifyPassword(password)
    if (!valid) return { error: { message: 'Invalid password' } }
    createSession()
    setUser({ email: 'admin@mainecleaningco.com', isLocal: true })
    setProfile({ role: 'owner', display_name: 'Admin' })
    return { data: { user: { email: 'admin@mainecleaningco.com' } } }
  }

  async function signUp(email, password) {
    if (isSupabaseConfigured()) {
      const sb = getSupabase()
      if (!sb) return { error: { message: 'Supabase not configured' } }
      const { data, error } = await sb.auth.signUp({ email, password })
      if (error) return { error }
      return { data }
    }
    return { error: { message: 'Sign up not available in local mode' } }
  }

  async function signOut() {
    if (isSupabaseConfigured()) {
      const sb = getSupabase()
      if (sb) await sb.auth.signOut()
    }
    clearSession()
    setUser(null)
    setProfile(null)
  }

  async function resetPassword(email) {
    if (isSupabaseConfigured()) {
      const sb = getSupabase()
      if (!sb) return { error: { message: 'Supabase not configured' } }
      return sb.auth.resetPasswordForEmail(email)
    }
    return { error: { message: 'Use the Settings page to change your password' } }
  }

  async function setupPassword(password) {
    await setLocalPassword(password)
    createSession()
    setUser({ email: 'admin@mainecleaningco.com', isLocal: true })
    setProfile({ role: 'owner', display_name: 'Admin' })
  }

  const role = profile?.role || 'viewer'

  return (
    <AuthContext.Provider value={{
      user, loading, profile, role,
      signIn, signUp, signOut, resetPassword, setupPassword,
      isAuthenticated: !!user,
      isLocal: user?.isLocal || false,
      needsSetup: !isSupabaseConfigured() && !isPasswordSet(),
      changeLocalPassword: changePassword,
      // Permission helpers
      isOwner: role === 'owner',
      isAdmin: role === 'owner' || role === 'admin',
      isManager: ROLE_LEVELS[role] >= ROLE_LEVELS.manager,
      isStaff: ROLE_LEVELS[role] >= ROLE_LEVELS.technician,
      employeeId: profile?.employee_id || null,
      clientId: profile?.client_id || null,
      hasRole: (minRole) => ROLE_LEVELS[role] >= (ROLE_LEVELS[minRole] || 0),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
