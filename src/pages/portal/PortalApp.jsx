import { Routes, Route, Navigate } from 'react-router-dom'
import { PortalAuthProvider } from '../../lib/portalAuth'
import PortalLogin from './PortalLogin'
import PortalLayout from './PortalLayout'
import PortalDashboard from './PortalDashboard'
import PortalSchedule from './PortalSchedule'
import PortalQuotes from './PortalQuotes'
import PortalInvoices from './PortalInvoices'
import PortalMessages from './PortalMessages'
import PortalRequests from './PortalRequests'
import PortalProfile from './PortalProfile'
import PortalChangePassword from './PortalChangePassword'

export default function PortalApp() {
  return (
    <PortalAuthProvider>
      <Routes>
        <Route path="login" element={<PortalLogin />} />
        <Route path="change-password" element={<PortalChangePassword />} />
        <Route element={<PortalLayout />}>
          <Route path="dashboard" element={<PortalDashboard />} />
          <Route path="schedule" element={<PortalSchedule />} />
          <Route path="quotes" element={<PortalQuotes />} />
          <Route path="invoices" element={<PortalInvoices />} />
          <Route path="messages" element={<PortalMessages />} />
          <Route path="requests" element={<PortalRequests />} />
          <Route path="profile" element={<PortalProfile />} />
        </Route>
        <Route index element={<Navigate to="login" replace />} />
        <Route path="*" element={<Navigate to="login" replace />} />
      </Routes>
    </PortalAuthProvider>
  )
}
