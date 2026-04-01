import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const PortalAuthContext = createContext(null)

const TOKEN_KEY = 'portal_token'
const API_BASE = '/api'

export function PortalAuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [client, setClient] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  const getToken = () => localStorage.getItem(TOKEN_KEY)

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
    setClient(null)
  }, [])

  // Helper for authenticated API calls
  const portalFetch = useCallback(async (url, options = {}) => {
    const token = getToken()
    if (!token) {
      logout()
      throw new Error('Not authenticated')
    }
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    })
    if (res.status === 401) {
      logout()
      throw new Error('Session expired')
    }
    return res
  }, [logout])

  const refreshUser = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setIsLoading(false)
      return
    }
    try {
      const res = await fetch(`${API_BASE}/portal-auth?action=me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) {
        logout()
        return
      }
      const data = await res.json()
      setUser(data.user)
      setClient(data.client)
    } catch {
      logout()
    } finally {
      setIsLoading(false)
    }
  }, [logout])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  async function login(email, password) {
    const res = await fetch(`${API_BASE}/portal-auth?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    if (!res.ok) {
      return { error: data.error || 'Login failed' }
    }
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    return { data }
  }

  return (
    <PortalAuthContext.Provider value={{
      user,
      client,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      refreshUser,
      portalFetch,
      getToken,
    }}>
      {children}
    </PortalAuthContext.Provider>
  )
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext)
  if (!ctx) throw new Error('usePortalAuth must be used within PortalAuthProvider')
  return ctx
}
