import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import { useAuth } from './lib/auth'
import { getClientsAsync, getClients, getQuotesAsync, getQuotes, getInvoicesAsync, getInvoices } from './lib/store'
import { isSupabaseConfigured } from './lib/supabase'
import Login from './pages/Login'
import { ToastProvider, CommandPalette, Badge } from './components/ui'

// Lazy-loaded pages for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Reports = lazy(() => import('./pages/Reports'))
const Clients = lazy(() => import('./pages/Clients'))
const Pipeline = lazy(() => import('./pages/Pipeline'))
const ClientDetail = lazy(() => import('./pages/ClientDetail'))
const Communications = lazy(() => import('./pages/Communications'))
const Schedule = lazy(() => import('./pages/Schedule'))
const Payroll = lazy(() => import('./pages/Payroll'))
const Invoices = lazy(() => import('./pages/Invoices'))
const Settings = lazy(() => import('./pages/Settings'))
const Setup = lazy(() => import('./pages/Setup'))
const Revenue = lazy(() => import('./pages/Revenue'))
const MyWebsite = lazy(() => import('./pages/MyWebsite'))
const AgentChat = lazy(() => import('./components/AgentChat'))

// Route loading fallback
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-gray-500">Loading...</p>
      </div>
    </div>
  )
}

const navItems = [
  { to: '/', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/pipeline', label: 'Pipeline', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' },
  { to: '/clients', label: 'Clients', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
  { to: '/communications', label: 'Inbox', icon: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75' },
  { to: '/schedule', label: 'Schedule', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5' },
  { to: '/invoices', label: 'Invoices', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
  { to: '/payroll', label: 'Payroll', icon: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z' },
  { to: '/reports', label: 'Reports', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { to: '/revenue', label: 'Revenue', icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941' },
  { to: '/my-website', label: 'My Website', icon: 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25' },
]

export default function App() {
  const { user, loading, signOut } = useAuth()
  const [chatOpen, setChatOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [cmdKOpen, setCmdKOpen] = useState(false)
  const [allClients, setAllClients] = useState([])
  const [navBadges, setNavBadges] = useState({})

  // Load clients for Cmd+K search + badge counts
  useEffect(() => {
    if (user) {
      (isSupabaseConfigured() ? getClientsAsync() : Promise.resolve(getClients()))
        .then(c => {
          setAllClients(c || [])
          setNavBadges(prev => ({ ...prev, leads: (c || []).filter(x => x.status === 'lead').length }))
        })
        .catch(() => {});
      // Load quote + invoice counts for badges
      (isSupabaseConfigured() ? getQuotesAsync() : Promise.resolve(getQuotes()))
        .then(q => {
          const draft = (q || []).filter(x => x.status === 'draft').length
          const sent = (q || []).filter(x => x.status === 'sent').length
          setNavBadges(prev => ({ ...prev, pipeline: draft + sent }))
        }).catch(() => {});
      (isSupabaseConfigured() ? getInvoicesAsync() : Promise.resolve(getInvoices()))
        .then(inv => {
          const overdue = (inv || []).filter(x => x.status === 'overdue').length
          const unpaid = (inv || []).filter(x => x.status === 'sent').length
          setNavBadges(prev => ({ ...prev, invoices: overdue, invoicesTotal: unpaid + overdue }))
        }).catch(() => {})
    }
  }, [user])

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      // Don't trigger shortcuts when typing in inputs/textareas
      const tag = document.activeElement?.tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.contentEditable === 'true'

      // Cmd+K — always works (search)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdKOpen(prev => !prev)
        return
      }

      // Skip other shortcuts when typing
      if (isTyping || cmdKOpen) return

      // G then D = go to Dashboard, G then P = Pipeline, etc.
      // Simple single-key shortcuts:
      if (e.key === '/' || e.key === 'f') { e.preventDefault(); setCmdKOpen(true) }
      if (e.key === '?' && e.shiftKey) { e.preventDefault(); setShowShortcuts(prev => !prev) }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [cmdKOpen])

  const [showShortcuts, setShowShortcuts] = useState(false)
  const location = useLocation()

  // Scroll to top on route change
  useEffect(() => {
    const main = document.querySelector('main')
    if (main) main.scrollTop = 0
  }, [location.pathname])

  // Show loading while checking auth
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  // Always require authentication
  if (!user) {
    return <Login />
  }

  return (
    <ToastProvider>
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Cmd+K search palette */}
      <CommandPalette clients={allClients} isOpen={cmdKOpen} onClose={() => setCmdKOpen(false)} />
      {/* Mobile hamburger button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3 left-3 z-50 p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 hover:text-white md:hidden"
        aria-label="Toggle menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          {sidebarOpen
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          }
        </svg>
      </button>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0
        transform transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white tracking-tight">Workflow HQ</h1>
          <p className="text-xs text-gray-500 mt-0.5">CRM & Operations</p>
        </div>
        {/* Search trigger */}
        <button onClick={() => setCmdKOpen(true)}
          className="mx-3 mt-3 mb-1 flex items-center gap-2 w-[calc(100%-1.5rem)] px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <span className="flex-1 text-left">Search...</span>
          <kbd className="hidden md:inline text-[10px] px-1.5 py-0.5 bg-gray-700/50 rounded font-mono">{'\u2318'}K</kbd>
        </button>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const badgeCount = item.to === '/pipeline' ? navBadges.pipeline
              : item.to === '/invoices' ? navBadges.invoices
              : item.label === 'Clients' ? navBadges.leads : 0
            const badgeColor = item.to === '/invoices' ? 'red' : item.to === '/pipeline' ? 'amber' : 'blue'
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  }`
                }>
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                <span className="flex-1">{item.label}</span>
                <Badge count={badgeCount} color={badgeColor} />
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom actions */}
        <div className="p-3 border-t border-gray-800 space-y-1">
          <button onClick={() => setChatOpen(!chatOpen)}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
              chatOpen ? 'bg-purple-600/20 text-purple-400' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}>
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            AI Agent
            {chatOpen && <span className="ml-auto text-xs text-purple-400">open</span>}
          </button>
          <NavLink to="/setup"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`
            }>
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1-3.4a.75.75 0 010-1.28l5.1-3.4a.75.75 0 011.08.67v6.74a.75.75 0 01-1.08.67zM17.25 7.5v9" />
            </svg>
            Setup Wizard
          </NavLink>
          <NavLink to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`
            }>
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </NavLink>
          {user ? (
            <div className="mt-1">
              <p className="px-3 py-1 text-xs text-gray-600 truncate">{user.email}</p>
              <button onClick={signOut}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-800 hover:text-red-400 transition-colors">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
                Sign Out
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0 pt-14 pb-16 md:pt-0 md:pb-0">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/communications" element={<Communications />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/payroll" element={<Payroll />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/revenue" element={<Revenue />} />
            <Route path="/website-requests" element={<Pipeline />} />
            <Route path="/my-website" element={<MyWebsite />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/setup" element={<Setup />} />
          </Routes>
        </Suspense>
      </main>

      {/* AI Agent panel */}
      {chatOpen && <Suspense fallback={null}><AgentChat onClose={() => setChatOpen(false)} /></Suspense>}

      {/* Keyboard shortcuts help */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setShowShortcuts(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcuts(false)} className="text-xs text-gray-500 hover:text-white">Close</button>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider font-medium mt-1 mb-1">Navigation</p>
              {[
                ['/', 'Search clients & pages'],
                ['\u2318K', 'Search (also Ctrl+K)'],
                ['Shift+?', 'Show this help'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-400">{desc}</span>
                  <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">{key}</kbd>
                </div>
              ))}
              <p className="text-[10px] text-gray-600 uppercase tracking-wider font-medium mt-3 mb-1">Clients Table</p>
              {[
                ['j / \u2193', 'Move down'],
                ['k / \u2191', 'Move up'],
                ['Enter', 'Open client'],
                ['x', 'Toggle select'],
                ['n', 'New client'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-400">{desc}</span>
                  <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">{key}</kbd>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-4">Shortcuts are disabled when typing in inputs.</p>
          </div>
        </div>
      )}
      {/* Mobile bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-gray-900/95 backdrop-blur border-t border-gray-800 flex md:hidden">
        {[
          { to: '/', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
          { to: '/pipeline', label: 'Pipeline', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25z' },
          { to: '/schedule', label: 'Schedule', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5' },
          { to: '/clients', label: 'Clients', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0z' },
          { to: '/invoices', label: 'Invoices', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
        ].map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                isActive ? 'text-blue-400' : 'text-gray-500'
              }`
            }>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
    </ToastProvider>
  )
}
