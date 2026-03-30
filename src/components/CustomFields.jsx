import { useState } from 'react'

// Reusable custom fields editor — stores as key-value pairs
// Usage: <CustomFields fields={obj.customFields || {}} onSave={(fields) => saveObj({...obj, customFields: fields})} />

export default function CustomFields({ fields = {}, onSave, label = 'Custom Fields' }) {
  const [editing, setEditing] = useState(false)
  const [localFields, setLocalFields] = useState({ ...fields })
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  function addField() {
    if (!newKey.trim()) return
    const updated = { ...localFields, [newKey.trim()]: newValue.trim() }
    setLocalFields(updated)
    setNewKey('')
    setNewValue('')
  }

  function removeField(key) {
    const updated = { ...localFields }
    delete updated[key]
    setLocalFields(updated)
  }

  function updateField(key, value) {
    setLocalFields(prev => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    onSave(localFields)
    setEditing(false)
  }

  const entries = Object.entries(localFields).filter(([k]) => k)

  if (!editing) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
          <button onClick={() => setEditing(true)} className="text-xs text-blue-400 hover:text-blue-300">
            {entries.length > 0 ? 'Edit' : '+ Add'}
          </button>
        </div>
        {entries.length > 0 ? (
          <div className="space-y-1">
            {entries.map(([key, value]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-gray-500">{key}</span>
                <span className="text-gray-300">{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600">No custom fields</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>

      {/* Existing fields */}
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 items-center">
          <span className="text-xs text-gray-400 w-32 shrink-0">{key}</span>
          <input value={value} onChange={e => updateField(key, e.target.value)}
            className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white" />
          <button onClick={() => removeField(key)} className="text-gray-600 hover:text-red-400 text-xs">×</button>
        </div>
      ))}

      {/* Add new field */}
      <div className="flex gap-2 items-center">
        <input value={newKey} onChange={e => setNewKey(e.target.value)}
          placeholder="Field name" className="w-32 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white placeholder-gray-600" />
        <input value={newValue} onChange={e => setNewValue(e.target.value)}
          placeholder="Value" onKeyDown={e => { if (e.key === 'Enter') addField() }}
          className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white placeholder-gray-600" />
        <button onClick={addField} disabled={!newKey.trim()}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-gray-300">+</button>
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white">Save</button>
        <button onClick={() => { setLocalFields({ ...fields }); setEditing(false) }} className="px-3 py-1 bg-gray-800 rounded text-xs text-gray-300">Cancel</button>
      </div>
    </div>
  )
}
