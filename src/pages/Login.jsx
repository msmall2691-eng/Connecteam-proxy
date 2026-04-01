import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { isSupabaseConfigured } from '../lib/supabase'

// Only these emails can access the CRM
const ALLOWED_EMAILS = [
  'office@mainecleaningco.com',
  'msmall2691@gmail.com',
]

export default function Login() {
  const { signIn, resetPassword, setupPassword, needsSetup } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mode, setMode] = useState(needsSetup ? 'setup' : 'login')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const isLocal = !isSupabaseConfigured()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    // Local auth setup (no Supabase)
    if (mode === 'setup') {
      if (password.length < 6) {
        setError('Password must be at least 6 characters')
        setLoading(false)
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match')
        setLoading(false)
        return
      }
      await setupPassword(password)
      setLoading(false)
      return
    }

    // Validate allowed email
    if (!isLocal && mode === 'login') {
      const normalizedEmail = email.trim().toLowerCase()
      if (!ALLOWED_EMAILS.includes(normalizedEmail)) {
        setError('Access denied. This CRM is restricted to authorized users only.')
        setLoading(false)
        return
      }
    }

    if (mode === 'login') {
      const { error } = await signIn(email, password)
      if (error) {
        // Friendly error messages
        if (error.message?.includes('Invalid login')) {
          setError('Incorrect email or password. Try again.')
        } else {
          setError(error.message)
        }
      }
    } else if (mode === 'reset') {
      const normalizedEmail = email.trim().toLowerCase()
      if (!ALLOWED_EMAILS.includes(normalizedEmail)) {
        setError('Access denied.')
        setLoading(false)
        return
      }
      const { error } = await resetPassword(email)
      if (error) setError(error.message)
      else setMessage('If this account exists, a password reset link has been sent.')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-md space-y-6">
        {/* Logo / Header */}
        <div className="text-center">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span className="text-white font-bold text-lg">W</span>
          </div>
          <h1 className="text-xl font-bold text-white">Workflow HQ</h1>
          <p className="text-xs text-gray-600 mt-0.5">Maine Cleaning & Property Management</p>
          <p className="text-sm text-gray-500 mt-2">
            {mode === 'setup' ? 'Set up your password to get started' :
             mode === 'login' ? (isLocal ? 'Enter your password to continue' : 'Sign in to continue') :
             'Reset your password'}
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
        )}
        {message && (
          <div className="p-3 bg-green-900/30 border border-green-800 rounded-lg text-sm text-green-300">{message}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email field */}
          {!isLocal && mode !== 'setup' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="office@mainecleaningco.com"
                className="w-full px-3.5 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          {mode !== 'reset' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                {mode === 'setup' ? 'Choose a Password' : 'Password'}
              </label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                className="w-full px-3.5 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          {mode === 'setup' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Confirm Password</label>
              <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                className="w-full px-3.5 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors">
            {loading ? 'Please wait...' :
             mode === 'setup' ? 'Set Up Password' :
             mode === 'login' ? 'Sign In' :
             'Send Reset Link'}
          </button>
        </form>

        {/* Forgot password */}
        {!isLocal && mode !== 'setup' && (
          <div className="text-center">
            {mode === 'login' ? (
              <button onClick={() => { setMode('reset'); setError(''); setMessage('') }}
                className="text-xs text-gray-500 hover:text-gray-300">Forgot password?</button>
            ) : (
              <button onClick={() => { setMode('login'); setError(''); setMessage('') }}
                className="text-xs text-blue-400 hover:text-blue-300">Back to sign in</button>
            )}
          </div>
        )}

        {mode === 'setup' && (
          <p className="text-xs text-gray-600 text-center">
            This password protects your Workflow HQ data. You'll need it each time you open the app.
          </p>
        )}
      </div>
    </div>
  )
}
