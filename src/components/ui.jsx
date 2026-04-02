import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { useNavigate } from 'react-router-dom'

// ─── TOAST NOTIFICATION SYSTEM ───────────────────────────────────────────────
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    if (duration > 0) setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback({
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error', 6000),
    info: (msg) => addToast(msg, 'info'),
    warning: (msg) => addToast(msg, 'warning', 5000),
  }, [addToast])

  // Make toast callable as toast.success(), toast.error(), etc.
  const api = { toast: addToast, ...toast, removeToast }

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: '380px' }}>
        {toasts.map(t => (
          <div key={t.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-sm transition-all duration-300 animate-slide-up ${
              t.type === 'success' ? 'bg-green-950/90 border-green-800/50 text-green-300' :
              t.type === 'error' ? 'bg-red-950/90 border-red-800/50 text-red-300' :
              t.type === 'warning' ? 'bg-amber-950/90 border-amber-800/50 text-amber-300' :
              'bg-gray-900/90 border-gray-700/50 text-gray-300'
            }`}>
            <span className="text-sm shrink-0 mt-0.5">
              {t.type === 'success' ? '\u2713' : t.type === 'error' ? '\u2717' : t.type === 'warning' ? '\u26A0' : '\u2139'}
            </span>
            <p className="text-sm flex-1">{t.message}</p>
            <button onClick={() => removeToast(t.id)} className="text-xs opacity-50 hover:opacity-100 shrink-0 mt-0.5">\u2715</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}


// ─── LOADING SKELETON ────────────────────────────────────────────────────────
export function Skeleton({ className = '', lines = 1 }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-gray-800 rounded animate-pulse" style={{ width: `${85 - i * 15}%` }} />
      ))}
    </div>
  )
}

export function CardSkeleton({ count = 3 }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="h-4 bg-gray-800 rounded animate-pulse w-1/3" />
          <div className="h-8 bg-gray-800 rounded animate-pulse w-1/2" />
          <div className="h-3 bg-gray-800 rounded animate-pulse w-2/3" />
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="border-b border-gray-800 px-5 py-3 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 bg-gray-800 rounded animate-pulse" style={{ width: `${20 + Math.random() * 15}%` }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="border-b border-gray-800/50 px-5 py-3 flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="h-4 bg-gray-800/60 rounded animate-pulse" style={{ width: `${15 + Math.random() * 20}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}


// ─── EMPTY STATE ─────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, description, action, actionLabel, actionTo }) {
  return (
    <div className="bg-gray-900 border border-gray-800 border-dashed rounded-xl p-8 md:p-12 text-center">
      {icon && <div className="text-4xl mb-3 opacity-40">{icon}</div>}
      <h3 className="text-base font-semibold text-gray-300 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 max-w-sm mx-auto mb-4">{description}</p>}
      {action && (
        <button onClick={action}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors">
          {actionLabel || 'Get Started'}
        </button>
      )}
      {actionTo && !action && (
        <a href={actionTo}
          className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors">
          {actionLabel || 'Get Started'}
        </a>
      )}
    </div>
  )
}


// ─── CMD+K SEARCH PALETTE ────────────────────────────────────────────────────
export function CommandPalette({ clients = [], isOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Navigation items
  const pages = [
    { label: 'Dashboard', path: '/', type: 'page' },
    { label: 'Pipeline', path: '/pipeline', type: 'page' },
    { label: 'Clients', path: '/clients', type: 'page' },
    { label: 'Schedule', path: '/schedule', type: 'page' },
    { label: 'Invoices', path: '/invoices', type: 'page' },
    { label: 'Communications', path: '/communications', type: 'page' },
    { label: 'Payroll', path: '/payroll', type: 'page' },
    { label: 'Reports', path: '/reports', type: 'page' },
    { label: 'Revenue', path: '/revenue', type: 'page' },
    { label: 'Settings', path: '/settings', type: 'page' },
  ]

  const q = query.toLowerCase().trim()
  const filteredPages = q ? pages.filter(p => p.label.toLowerCase().includes(q)) : pages
  const filteredClients = q && q.length >= 2
    ? clients.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.companyName || '').toLowerCase().includes(q)
      ).slice(0, 8)
    : []

  const results = [
    ...filteredPages.map(p => ({ ...p, id: `page-${p.path}` })),
    ...filteredClients.map(c => ({
      id: `client-${c.id}`, label: c.name, sublabel: c.email || c.phone || c.companyName || '',
      path: `/clients/${c.id}`, type: 'client',
    })),
  ]

  useEffect(() => { setSelectedIdx(0) }, [query])

  function handleSelect(item) {
    navigate(item.path)
    onClose()
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[selectedIdx]) { e.preventDefault(); handleSelect(results[selectedIdx]) }
    if (e.key === 'Escape') onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Search clients, navigate pages..."
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none" />
          <kbd className="hidden sm:inline px-1.5 py-0.5 bg-gray-800 rounded text-[10px] text-gray-500 font-mono">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-6 text-sm text-gray-500 text-center">No results for "{query}"</p>
          )}
          {filteredPages.length > 0 && (
            <div className="mb-1">
              <p className="px-3 py-1 text-[10px] text-gray-600 uppercase tracking-wider font-medium">Pages</p>
              {filteredPages.map((item, i) => {
                const idx = results.findIndex(r => r.id === `page-${item.path}`)
                return (
                  <button key={item.path} onClick={() => handleSelect(item)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      idx === selectedIdx ? 'bg-blue-600/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}>
                    <span className="text-sm">{item.label}</span>
                  </button>
                )
              })}
            </div>
          )}
          {filteredClients.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[10px] text-gray-600 uppercase tracking-wider font-medium">Clients</p>
              {filteredClients.map((c, i) => {
                const item = results.find(r => r.id === `client-${c.id}`)
                const idx = results.findIndex(r => r.id === `client-${c.id}`)
                return (
                  <button key={c.id} onClick={() => handleSelect(item)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      idx === selectedIdx ? 'bg-blue-600/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}>
                    <div className="min-w-0">
                      <p className="text-sm truncate">{c.name}</p>
                      <p className="text-xs text-gray-500 truncate">{c.email || c.phone || ''}</p>
                    </div>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      c.status === 'active' ? 'bg-green-900/30 text-green-400' :
                      c.status === 'lead' ? 'bg-blue-900/30 text-blue-400' :
                      'bg-gray-800 text-gray-500'
                    }`}>{c.status}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="px-3 py-2 border-t border-gray-800 flex gap-3 text-[10px] text-gray-600">
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded font-mono">\u2191\u2193</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded font-mono">\u23CE</kbd> select</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}


// ─── STATUS BADGE (unified) ──────────────────────────────────────────────────
const STATUS_STYLES = {
  active: 'bg-green-900/30 text-green-400 border-green-800/30',
  lead: 'bg-blue-900/30 text-blue-400 border-blue-800/30',
  prospect: 'bg-purple-900/30 text-purple-400 border-purple-800/30',
  inactive: 'bg-gray-800 text-gray-500 border-gray-700',
  scheduled: 'bg-cyan-900/30 text-cyan-400 border-cyan-800/30',
  completed: 'bg-green-900/30 text-green-400 border-green-800/30',
  confirmed: 'bg-green-900/30 text-green-400 border-green-800/30',
  cancelled: 'bg-red-900/30 text-red-400 border-red-800/30',
  draft: 'bg-gray-800 text-gray-400 border-gray-700',
  sent: 'bg-blue-900/30 text-blue-400 border-blue-800/30',
  accepted: 'bg-green-900/30 text-green-400 border-green-800/30',
  declined: 'bg-red-900/30 text-red-400 border-red-800/30',
  expired: 'bg-gray-800 text-gray-500 border-gray-700',
  paid: 'bg-green-900/30 text-green-400 border-green-800/30',
  overdue: 'bg-red-900/30 text-red-400 border-red-800/30',
  in_progress: 'bg-amber-900/30 text-amber-400 border-amber-800/30',
}

export function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || 'bg-gray-800 text-gray-400 border-gray-700'
  return <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium border ${style}`}>{(status || '').replace(/_/g, ' ')}</span>
}


// ─── PROGRESS BAR ────────────────────────────────────────────────────────────
export function ProgressBar({ value = 0, max = 100, color = 'blue', size = 'sm' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const colors = { blue: 'bg-blue-500', green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500', purple: 'bg-purple-500' }
  const h = size === 'xs' ? 'h-1' : size === 'sm' ? 'h-1.5' : 'h-2'
  return (
    <div className={`w-full ${h} bg-gray-800 rounded-full overflow-hidden`}>
      <div className={`${h} ${colors[color] || colors.blue} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  )
}
