import { createClient } from '@supabase/supabase-js'

// Supabase config — check VITE_ env vars (build-time) OR localStorage fallback (runtime)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('supabase_url') || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabase_anon_key') || ''

let supabase = null

export function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  return supabase
}

export function isSupabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY)
}

// Allow setting Supabase config at runtime (from Settings page)
export function setSupabaseConfig(url, key) {
  localStorage.setItem('supabase_url', url)
  localStorage.setItem('supabase_anon_key', key)
  // Force reload to reinitialize
  window.location.reload()
}
