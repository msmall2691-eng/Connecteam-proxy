import { createContext, useContext, useState, useEffect } from 'react'
import { getSupabase, isSupabaseConfigured } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) {
      // No Supabase = skip auth, let everyone in
      setLoading(false)
      return
    }

    // Check current session
    sb.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const sb = getSupabase()
    if (!sb) return { error: { message: 'Supabase not configured' } }
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error) return { error }
    setUser(data.user)
    return { data }
  }

  async function signUp(email, password) {
    const sb = getSupabase()
    if (!sb) return { error: { message: 'Supabase not configured' } }
    const { data, error } = await sb.auth.signUp({ email, password })
    if (error) return { error }
    return { data }
  }

  async function signOut() {
    const sb = getSupabase()
    if (sb) await sb.auth.signOut()
    setUser(null)
  }

  async function resetPassword(email) {
    const sb = getSupabase()
    if (!sb) return { error: { message: 'Supabase not configured' } }
    return sb.auth.resetPasswordForEmail(email)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, resetPassword, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
