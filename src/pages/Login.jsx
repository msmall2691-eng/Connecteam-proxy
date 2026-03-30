import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { isSupabaseConfigured } from '../lib/supabase'

export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login') // 'login', 'signup', 'reset'
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    if (mode === 'login') {
      const { error } = await signIn(email, password)
      if (error) setError(error.message)
    } else if (mode === 'signup') {
      const { error } = await signUp(email, password)
      if (error) setError(error.message)
      else setMessage('Account created! Check your email to confirm, then log in.')
    } else if (mode === 'reset') {
      const { error } = await resetPassword(email)
      if (error) setError(error.message)
      else setMessage('Password reset email sent. Check your inbox.')
    }

    setLoading(false)
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-md text-center space-y-4">
          <h1 className="text-xl font-bold text-white">Workflow HQ</h1>
          <p className="text-sm text-gray-400">Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to Vercel env vars to enable authentication.</p>
          <p className="text-xs text-gray-600">The app will work without auth but data won't be secured.</p>
        </div>
      </div>
    )
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
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'login' ? 'Sign in to your account' :
             mode === 'signup' ? 'Create your account' :
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
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full px-3.5 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                className="w-full px-3.5 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors">
            {loading ? 'Please wait...' :
             mode === 'login' ? 'Sign In' :
             mode === 'signup' ? 'Create Account' :
             'Send Reset Link'}
          </button>
        </form>

        {/* Mode switchers */}
        <div className="text-center space-y-2">
          {mode === 'login' && (
            <>
              <button onClick={() => { setMode('reset'); setError(''); setMessage('') }}
                className="text-xs text-gray-500 hover:text-gray-300">Forgot password?</button>
              <p className="text-xs text-gray-600">
                Don't have an account?{' '}
                <button onClick={() => { setMode('signup'); setError(''); setMessage('') }}
                  className="text-blue-400 hover:text-blue-300">Sign up</button>
              </p>
            </>
          )}
          {mode === 'signup' && (
            <p className="text-xs text-gray-600">
              Already have an account?{' '}
              <button onClick={() => { setMode('login'); setError(''); setMessage('') }}
                className="text-blue-400 hover:text-blue-300">Sign in</button>
            </p>
          )}
          {mode === 'reset' && (
            <button onClick={() => { setMode('login'); setError(''); setMessage('') }}
              className="text-xs text-blue-400 hover:text-blue-300">Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  )
}
