import { useState } from 'react'
import { usePortalAuth } from '../../lib/portalAuth'

export default function PortalProfile() {
  const { user, client, portalFetch, refreshUser } = usePortalAuth()
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [properties, setProperties] = useState(null)
  const [propsLoading, setPropsLoading] = useState(false)

  async function handleChangePassword(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const res = await portalFetch('/api/portal-auth?action=change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to change password')
      setMessage('Password changed successfully')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowPasswordForm(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadProperties() {
    if (properties) return
    setPropsLoading(true)
    try {
      const res = await portalFetch('/api/portal?action=properties')
      if (!res.ok) throw new Error('Failed to load properties')
      const data = await res.json()
      setProperties(data.properties || [])
    } catch {
      setProperties([])
    } finally {
      setPropsLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Your account information</p>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>
      )}
      {message && (
        <div className="p-3 bg-green-900/30 border border-green-800 rounded-lg text-sm text-green-300">{message}</div>
      )}

      {/* Account info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Account Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoField label="Name" value={user?.name} />
          <InfoField label="Email" value={user?.email} />
          {client?.phone && <InfoField label="Phone" value={client.phone} />}
          {client?.address && <InfoField label="Address" value={client.address} />}
        </div>
        <div className="pt-2 border-t border-gray-800 text-xs text-gray-600 space-y-1">
          <p>Member since: {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</p>
          <p>Last login: {user?.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'N/A'}</p>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Password</h3>
          <button
            onClick={() => setShowPasswordForm(!showPasswordForm)}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            {showPasswordForm ? 'Cancel' : 'Change Password'}
          </button>
        </div>

        {showPasswordForm && (
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Current Password</label>
              <input
                type="password" value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">New Password</label>
              <input
                type="password" required value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                minLength={8}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Confirm New Password</label>
              <input
                type="password" required value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                minLength={8}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button type="submit" disabled={loading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
              {loading ? 'Changing...' : 'Update Password'}
            </button>
          </form>
        )}
      </div>

      {/* Properties */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Properties</h3>
          {!properties && (
            <button onClick={loadProperties} disabled={propsLoading}
              className="text-xs text-emerald-400 hover:text-emerald-300">
              {propsLoading ? 'Loading...' : 'View Properties'}
            </button>
          )}
        </div>

        {properties && (
          properties.length === 0 ? (
            <p className="text-sm text-gray-500">No properties on file</p>
          ) : (
            <div className="space-y-3">
              {properties.map(prop => (
                <div key={prop.id} className="p-3 bg-gray-800 rounded-lg">
                  <p className="text-sm text-white font-medium">{prop.name || prop.address || 'Property'}</p>
                  {prop.address && <p className="text-xs text-gray-400 mt-1">{prop.address}</p>}
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    {prop.type && <span className="capitalize">{prop.type}</span>}
                    {prop.bedrooms && <span>{prop.bedrooms} bed</span>}
                    {prop.bathrooms && <span>{prop.bathrooms} bath</span>}
                    {prop.squareFeet && <span>{prop.squareFeet} sqft</span>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function InfoField({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-600">{label}</p>
      <p className="text-sm text-gray-300 mt-0.5">{value || 'Not provided'}</p>
    </div>
  )
}
