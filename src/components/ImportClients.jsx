import { useState } from 'react'
import { saveClient, saveClientAsync, getClients, getClientsAsync } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'

// Smart column mapping — auto-detects which CSV columns match client fields
const FIELD_MAP = {
  name: ['name', 'full name', 'fullname', 'client', 'client name', 'customer', 'customer name', 'contact', 'first name', 'firstname'],
  email: ['email', 'e-mail', 'email address', 'emailaddress', 'mail'],
  phone: ['phone', 'phone number', 'phonenumber', 'tel', 'telephone', 'mobile', 'cell', 'cell phone'],
  address: ['address', 'street', 'street address', 'location', 'full address', 'service address', 'property address'],
  type: ['type', 'property type', 'client type', 'service type', 'category'],
  source: ['source', 'referral', 'lead source', 'how found', 'marketing source'],
  notes: ['notes', 'note', 'comments', 'description', 'details', 'special instructions'],
  status: ['status', 'client status', 'lead status'],
  tags: ['tags', 'labels', 'categories'],
}

function detectColumn(header) {
  const h = header.toLowerCase().trim()
  for (const [field, aliases] of Object.entries(FIELD_MAP)) {
    if (aliases.includes(h)) return field
  }
  // Fuzzy match
  for (const [field, aliases] of Object.entries(FIELD_MAP)) {
    if (aliases.some(a => h.includes(a) || a.includes(h))) return field
  }
  return null
}

function parseCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return { headers: [], rows: [] }

  // Detect delimiter
  const firstLine = lines[0]
  const delimiter = firstLine.includes('\t') ? '\t' : ','

  function parseLine(line) {
    const result = []
    let current = ''
    let inQuotes = false
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue }
      if (char === delimiter && !inQuotes) { result.push(current.trim()); current = ''; continue }
      current += char
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(parseLine).filter(r => r.some(cell => cell))
  return { headers, rows }
}

export default function ImportClients({ onDone }) {
  const [step, setStep] = useState('upload') // upload, map, preview, done
  const [csvData, setCsvData] = useState(null)
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      const { headers, rows } = parseCSV(text)
      setCsvData({ headers, rows })

      // Auto-detect column mapping
      const autoMap = {}
      headers.forEach((h, i) => {
        const detected = detectColumn(h)
        if (detected) autoMap[i] = detected
      })

      // Handle first+last name combo
      const firstIdx = headers.findIndex(h => h.toLowerCase().includes('first'))
      const lastIdx = headers.findIndex(h => h.toLowerCase().includes('last'))
      if (firstIdx >= 0 && lastIdx >= 0 && !Object.values(autoMap).includes('name')) {
        autoMap[firstIdx] = 'firstName'
        autoMap[lastIdx] = 'lastName'
      }

      setMapping(autoMap)
      setStep('map')
    }
    reader.readAsText(file)
  }

  function handlePaste() {
    const text = prompt('Paste your CSV data (with headers):')
    if (!text) return
    const { headers, rows } = parseCSV(text)
    setCsvData({ headers, rows })
    const autoMap = {}
    headers.forEach((h, i) => { const d = detectColumn(h); if (d) autoMap[i] = d })
    setMapping(autoMap)
    setStep('map')
  }

  function buildPreview() {
    const clients = csvData.rows.map(row => {
      const client = { status: 'lead', type: 'residential' }
      let firstName = '', lastName = ''

      for (const [colIdx, field] of Object.entries(mapping)) {
        const value = row[parseInt(colIdx)] || ''
        if (!value) continue
        if (field === 'firstName') firstName = value
        else if (field === 'lastName') lastName = value
        else if (field === 'tags') client.tags = value.split(/[,;]/).map(t => t.trim()).filter(Boolean)
        else client[field] = value
      }

      if (firstName || lastName) client.name = `${firstName} ${lastName}`.trim()
      if (!client.name) return null
      return client
    }).filter(Boolean)

    setPreview(clients)
    setStep('preview')
  }

  async function doImport() {
    setImporting(true)
    const existing = isSupabaseConfigured() ? await getClientsAsync() : getClients()
    const existingEmails = new Set(existing.map(c => c.email?.toLowerCase()).filter(Boolean))
    const existingPhones = new Set(existing.map(c => c.phone).filter(Boolean))
    const existingNames = new Set(existing.map(c => c.name?.toLowerCase()).filter(Boolean))

    let imported = 0, skipped = 0, duplicates = 0

    for (const client of preview) {
      // Check for duplicates
      if (skipDuplicates) {
        const isDupe = (client.email && existingEmails.has(client.email.toLowerCase())) ||
          (client.phone && existingPhones.has(client.phone)) ||
          (client.name && existingNames.has(client.name.toLowerCase()))
        if (isDupe) { duplicates++; skipped++; continue }
      }

      try {
        if (isSupabaseConfigured()) { await saveClientAsync(client) } else { saveClient(client) }
        imported++
        if (client.email) existingEmails.add(client.email.toLowerCase())
        if (client.phone) existingPhones.add(client.phone)
        if (client.name) existingNames.add(client.name.toLowerCase())
      } catch { skipped++ }
    }

    setResult({ imported, skipped, duplicates, total: preview.length })
    setStep('done')
    setImporting(false)
  }

  return (
    <div className="space-y-4">
      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="text-center space-y-4">
          <p className="text-sm text-gray-400">Upload a CSV or paste data. Columns are auto-detected.</p>
          <div className="flex gap-3 justify-center">
            <label className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white cursor-pointer">
              Upload CSV <input type="file" accept=".csv,.tsv,.txt" onChange={handleFile} className="hidden" />
            </label>
            <button onClick={handlePaste} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300">
              Paste Data
            </button>
          </div>
          <p className="text-xs text-gray-600">Supports: CSV, TSV, tab-separated. Headers auto-mapped to: name, email, phone, address, type, source, notes, status, tags</p>
        </div>
      )}

      {/* Step 2: Map columns */}
      {step === 'map' && csvData && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-400">Found {csvData.rows.length} rows, {csvData.headers.length} columns. Verify the mapping:</p>
            <button onClick={() => setStep('upload')} className="text-xs text-gray-500 hover:text-gray-300">Back</button>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
            {csvData.headers.map((h, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-gray-400 w-40 truncate" title={h}>{h}</span>
                <span className="text-gray-600">→</span>
                <select value={mapping[i] || ''} onChange={e => {
                  const m = { ...mapping }
                  if (e.target.value) m[i] = e.target.value
                  else delete m[i]
                  setMapping(m)
                }} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white">
                  <option value="">Skip</option>
                  <option value="name">Name</option>
                  <option value="firstName">First Name</option>
                  <option value="lastName">Last Name</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="address">Address</option>
                  <option value="type">Type</option>
                  <option value="source">Source</option>
                  <option value="notes">Notes</option>
                  <option value="status">Status</option>
                  <option value="tags">Tags</option>
                </select>
                {mapping[i] && <span className="text-xs text-green-400">mapped</span>}
                <span className="text-xs text-gray-600 truncate">{csvData.rows[0]?.[i] || ''}</span>
              </div>
            ))}
          </div>

          <button onClick={buildPreview} disabled={!Object.values(mapping).includes('name') && !Object.values(mapping).includes('firstName')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
            Preview Import ({csvData.rows.length} rows)
          </button>
          {!Object.values(mapping).includes('name') && !Object.values(mapping).includes('firstName') && (
            <p className="text-xs text-yellow-400">Map at least a Name or First Name column to continue.</p>
          )}
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-400">{preview.length} clients ready to import</p>
            <button onClick={() => setStep('map')} className="text-xs text-gray-500 hover:text-gray-300">Back</button>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} className="rounded border-gray-600" />
            Skip duplicates (match by email, phone, or name)
          </label>

          <div className="bg-gray-800/50 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-800">
                <tr><th className="px-3 py-1.5 text-left text-gray-500">Name</th><th className="px-3 py-1.5 text-left text-gray-500">Email</th><th className="px-3 py-1.5 text-left text-gray-500">Phone</th><th className="px-3 py-1.5 text-left text-gray-500">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {preview.slice(0, 50).map((c, i) => (
                  <tr key={i} className="text-gray-300"><td className="px-3 py-1.5">{c.name}</td><td className="px-3 py-1.5 text-gray-500">{c.email || '-'}</td><td className="px-3 py-1.5 text-gray-500">{c.phone || '-'}</td><td className="px-3 py-1.5">{c.status}</td></tr>
                ))}
              </tbody>
            </table>
            {preview.length > 50 && <p className="p-2 text-xs text-gray-600 text-center">... and {preview.length - 50} more</p>}
          </div>

          <button onClick={doImport} disabled={importing}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
            {importing ? 'Importing...' : `Import ${preview.length} Clients`}
          </button>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && result && (
        <div className="text-center space-y-3">
          <p className="text-lg text-green-400 font-semibold">Import Complete!</p>
          <div className="text-sm text-gray-400 space-y-1">
            <p><strong className="text-white">{result.imported}</strong> clients imported</p>
            {result.duplicates > 0 && <p><strong className="text-yellow-400">{result.duplicates}</strong> duplicates skipped</p>}
            {result.skipped > result.duplicates && <p><strong className="text-gray-500">{result.skipped - result.duplicates}</strong> errors skipped</p>}
          </div>
          <div className="flex gap-3 justify-center">
            <button onClick={() => { setStep('upload'); setCsvData(null); setPreview([]); setResult(null) }}
              className="px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300">Import More</button>
            {onDone && <button onClick={onDone} className="px-4 py-2 bg-blue-600 rounded-lg text-sm text-white">Done</button>}
          </div>
        </div>
      )}
    </div>
  )
}
