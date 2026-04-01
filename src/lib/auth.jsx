import { createContext, useContext, useState, useEffect } from 'react'
import { getSupabase, isSupabaseConfigured } from './supabase'
import {
  isPasswordSet, verifyPassword, setPassword as setLocalPassword,
  isSessionValid, createSession, clearSession, changePassword
} from './localAuth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isSupabaseConfigured()) {
      const sb = getSupabase()
      if (!sb) { setLoading(false); return }
      sb.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user || null)
        setLoading(false)
      })
      const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user || null)
      })
      return () => subscription.unsubscribe()
    } else {
      // Local auth: check session
      if (isSessionValid()) {
        setUser({ email: 'admin@maine-clean.co', isLocal: true })
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
      setUser(data.user)
      return { data }
    }
    // Local auth
    const valid = await verifyPassword(password)
    if (!valid) return { error: { message: 'Invalid password' } }
    createSession()
    setUser({ email: 'admin@maine-clean.co', isLocal: true })
    return { data: { user: { email: 'admin@maine-clean.co' } } }
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
    setUser({ email: 'admin@maine-clean.co', isLocal: true })
  }

  return (
    <AuthContext.Provider value={{
      user, loading, signIn, signUp, signOut, resetPassword, setupPassword,
      isAuthenticated: !!user,
      isLocal: user?.isLocal || false,
      needsSetup: !isSupabaseConfigured() && !isPasswordSet(),
      changeLocalPassword: changePassword,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
