import { useState } from 'react'
import { saveClient, getClients } from '../lib/store'

// Smart column mapping — auto-detects which CSV/Sheet columns match client fields
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

function autoDetectMapping(headers) {
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
  return autoMap
}

export default function ImportClients({ onDone }) {
  const [step, setStep] = useState('choose') // choose, upload, sheets-browse, map, preview, done
  const [importSource, setImportSource] = useState(null) // 'csv' or 'sheets'
  const [csvData, setCsvData] = useState(null)
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)

  // Google Sheets state
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [sheetsError, setSheetsError] = useState(null)
  const [sheetFiles, setSheetFiles] = useState([])
  const [sheetSearch, setSheetSearch] = useState('\u{1F499}')
  const [selectedFile, setSelectedFile] = useState(null)
  const [sheetTabs, setSheetTabs] = useState([])
  const [readingSheet, setReadingSheet] = useState(false)

  // ── CSV handlers ──
  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(ev.target.result)
      setCsvData({ headers, rows })
      setMapping(autoDetectMapping(headers))
      setStep('map')
    }
    reader.readAsText(file)
  }

  function handlePaste() {
    const text = prompt('Paste your CSV data (with headers):')
    if (!text) return
    const { headers, rows } = parseCSV(text)
    setCsvData({ headers, rows })
    setMapping(autoDetectMapping(headers))
    setStep('map')
  }

  // ── Google Sheets handlers ──
  async function searchSheets(query) {
    setSheetsLoading(true)
    setSheetsError(null)
    try {
      const q = encodeURIComponent(query || '')
      const res = await fetch(`/api/sheets?action=search&q=${q}`)
      const data = await res.json()
      if (data.error) { setSheetsError(data.error); setSheetFiles([]) }
      else setSheetFiles(data.files || [])
    } catch (err) {
      setSheetsError(err.message)
    }
    setSheetsLoading(false)
  }

  async function selectSheet(file) {
    setSelectedFile(file)
    setSheetsLoading(true)
    try {
      // Check for multiple tabs
      const tabRes = await fetch(`/api/sheets?action=list-sheets&spreadsheetId=${file.id}`)
      const tabData = await tabRes.json()
      const tabs = tabData.sheets || []

      if (tabs.length > 1) {
        setSheetTabs(tabs)
        setSheetsLoading(false)
        return // User picks a tab
      }

      // Single tab — read it directly
      await readSheetData(file.id, tabs[0]?.title)
    } catch (err) {
      setSheetsError(err.message)
      setSheetsLoading(false)
    }
  }

  async function readSheetData(spreadsheetId, tabName) {
    setReadingSheet(true)
    setSheetsError(null)
    try {
      const tabParam = tabName ? `&sheet=${encodeURIComponent(tabName)}` : ''
      const res = await fetch(`/api/sheets?action=read&spreadsheetId=${spreadsheetId}${tabParam}`)
      const data = await res.json()
      if (data.error) { setSheetsError(data.error); setReadingSheet(false); return }
      if (!data.headers?.length) { setSheetsError('Sheet appears to be empty'); setReadingSheet(false); return }

      setCsvData({ headers: data.headers, rows: data.rows })
      setMapping(autoDetectMapping(data.headers))
      setStep('map')
    } catch (err) {
      setSheetsError(err.message)
    }
    setReadingSheet(false)
    setSheetsLoading(false)
  }

  // ── Build preview ──
  function buildPreview() {
    const clients = csvData.rows.map(row => {
      const client = {
        status: importSource === 'sheets' ? 'active' : 'lead',
        type: 'residential',
        source: importSource === 'sheets' ? 'Google Sheets' : undefined,
      }
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

  // ── Import ──
  async function doImport() {
    setImporting(true)
    const existing = getClients()
    const existingEmails = new Set(existing.map(c => c.email?.toLowerCase()).filter(Boolean))
    const existingPhones = new Set(existing.map(c => c.phone).filter(Boolean))
    const existingNames = new Set(existing.map(c => c.name?.toLowerCase()).filter(Boolean))

    let imported = 0, skipped = 0, duplicates = 0

    for (const client of preview) {
      if (skipDuplicates) {
        const isDupe = (client.email && existingEmails.has(client.email.toLowerCase())) ||
          (client.phone && existingPhones.has(client.phone)) ||
          (client.name && existingNames.has(client.name.toLowerCase()))
        if (isDupe) { duplicates++; skipped++; continue }
      }

      try {
        saveClient(client)
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

  function resetAll() {
    setStep('choose')
    setImportSource(null)
    setCsvData(null)
    setPreview([])
    setResult(null)
    setSheetFiles([])
    setSelectedFile(null)
    setSheetTabs([])
    setSheetsError(null)
  }

  return (
    <div className="space-y-4">

      {/* ── Step: Choose source ── */}
      {step === 'choose' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400 text-center">How would you like to import clients?</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setImportSource('csv'); setStep('upload') }}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-xl p-5 text-left transition-colors">
              <div className="text-2xl mb-2">📄</div>
              <div className="text-sm font-semibold text-white">Upload CSV</div>
              <div className="text-xs text-gray-500 mt-1">Upload a .csv or paste data</div>
            </button>
            <button onClick={() => { setImportSource('sheets'); setStep('sheets-browse'); searchSheets(sheetSearch) }}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-green-700 rounded-xl p-5 text-left transition-colors">
              <div className="text-2xl mb-2">📊</div>
              <div className="text-sm font-semibold text-white">Google Sheets</div>
              <div className="text-xs text-gray-500 mt-1">Browse your Drive and pick a sheet</div>
            </button>
          </div>
        </div>
      )}

      {/* ── Step: CSV Upload ── */}
      {step === 'upload' && (
        <div className="text-center space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-400">Upload a CSV or paste data. Columns are auto-detected.</p>
            <button onClick={() => setStep('choose')} className="text-xs text-gray-500 hover:text-gray-300">Back</button>
          </div>
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

      {/* ── Step: Google Sheets Browse ── */}
      {step === 'sheets-browse' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-400">Search your Google Drive for a spreadsheet</p>
            <button onClick={() => setStep('choose')} className="text-xs text-gray-500 hover:text-gray-300">Back</button>
          </div>

          {/* Search bar */}
          <div className="flex gap-2">
            <input
              type="text"
              value={sheetSearch}
              onChange={e => setSheetSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchSheets(sheetSearch)}
              placeholder="Search sheets by name..."
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={() => searchSheets(sheetSearch)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">
              Search
            </button>
            <button onClick={() => { setSheetSearch(''); searchSheets('') }}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-400">
              All
            </button>
          </div>

          {sheetsError && (
            <div className="p-3 bg-red-900/20 border border-red-800/30 rounded-lg text-sm text-red-400">{sheetsError}</div>
          )}

          {sheetsLoading && !readingSheet && (
            <div className="text-center py-6 text-gray-500">
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
              Searching Google Drive...
            </div>
          )}

          {/* Sheet tab picker (when a multi-tab sheet is selected) */}
          {sheetTabs.length > 1 && selectedFile && (
            <div className="bg-blue-900/20 border border-blue-800/30 rounded-lg p-4 space-y-3">
              <p className="text-sm text-blue-300">
                <strong>{selectedFile.name}</strong> has {sheetTabs.length} tabs. Which one has your clients?
              </p>
              <div className="flex flex-wrap gap-2">
                {sheetTabs.map(tab => (
                  <button key={tab.sheetId} onClick={() => { setSheetTabs([]); readSheetData(selectedFile.id, tab.title) }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white">
                    {tab.title}
                  </button>
                ))}
              </div>
              <button onClick={() => { setSheetTabs([]); setSelectedFile(null) }}
                className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
            </div>
          )}

          {readingSheet && (
            <div className="text-center py-6 text-gray-500">
              <div className="animate-spin w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full mx-auto mb-2" />
              Reading sheet data...
            </div>
          )}

          {/* Results list */}
          {!sheetsLoading && !readingSheet && sheetTabs.length <= 1 && sheetFiles.length > 0 && (
            <div className="space-y-2">
              {sheetFiles.map(file => (
                <button key={file.id} onClick={() => selectSheet(file)}
                  className="w-full bg-gray-800/50 hover:bg-gray-800 border border-gray-700 hover:border-blue-700 rounded-lg p-3 flex items-center gap-3 text-left transition-colors">
                  <span className="text-xl">📊</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{file.name}</div>
                    <div className="text-xs text-gray-500">
                      Last modified: {new Date(file.modifiedTime).toLocaleDateString()}
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              ))}
            </div>
          )}

          {!sheetsLoading && !readingSheet && sheetFiles.length === 0 && !sheetsError && (
            <div className="text-center py-6 text-gray-500">
              <p className="text-sm">No spreadsheets found. Try a different search or click "All" to see everything.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Step: Map columns ── */}
      {step === 'map' && csvData && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-400">
                {selectedFile && <span className="text-blue-400">{selectedFile.name} — </span>}
                {csvData.rows.length} rows, {csvData.headers.length} columns. Verify the mapping:
              </p>
            </div>
            <button onClick={() => setStep(importSource === 'sheets' ? 'sheets-browse' : 'upload')} className="text-xs text-gray-500 hover:text-gray-300">Back</button>
          </div>

          {importSource === 'sheets' && (
            <div className="bg-green-900/10 border border-green-800/30 rounded-lg p-3">
              <p className="text-xs text-green-400">Clients from Google Sheets will be imported as <strong>active</strong> clients with source tagged as "Google Sheets".</p>
            </div>
          )}

          <div className="bg-gray-800/50 rounded-lg p-4 space-y-2 max-h-72 overflow-y-auto">
            {csvData.headers.map((h, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-gray-400 w-40 truncate" title={h}>{h}</span>
                <span className="text-gray-600">&rarr;</span>
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

      {/* ── Step: Preview ── */}
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
                <tr>
                  <th className="px-3 py-1.5 text-left text-gray-500">Name</th>
                  <th className="px-3 py-1.5 text-left text-gray-500">Email</th>
                  <th className="px-3 py-1.5 text-left text-gray-500">Phone</th>
                  <th className="px-3 py-1.5 text-left text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {preview.slice(0, 50).map((c, i) => (
                  <tr key={i} className="text-gray-300">
                    <td className="px-3 py-1.5">{c.name}</td>
                    <td className="px-3 py-1.5 text-gray-500">{c.email || '-'}</td>
                    <td className="px-3 py-1.5 text-gray-500">{c.phone || '-'}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${c.status === 'active' ? 'bg-green-900/30 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
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

      {/* ── Step: Done ── */}
      {step === 'done' && result && (
        <div className="text-center space-y-3">
          <p className="text-lg text-green-400 font-semibold">Import Complete!</p>
          <div className="text-sm text-gray-400 space-y-1">
            <p><strong className="text-white">{result.imported}</strong> clients imported{importSource === 'sheets' ? ' as active' : ''}</p>
            {result.duplicates > 0 && <p><strong className="text-yellow-400">{result.duplicates}</strong> duplicates skipped</p>}
            {result.skipped > result.duplicates && <p><strong className="text-gray-500">{result.skipped - result.duplicates}</strong> errors skipped</p>}
          </div>
          <div className="flex gap-3 justify-center">
            <button onClick={resetAll} className="px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300">Import More</button>
            {onDone && <button onClick={onDone} className="px-4 py-2 bg-blue-600 rounded-lg text-sm text-white">Done</button>}
          </div>
        </div>
      )}
    </div>
  )
}
