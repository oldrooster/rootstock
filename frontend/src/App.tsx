import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Services from './pages/Services'
import VMs from './pages/VMs'
import DNS from './pages/DNS'
import Ingress from './pages/Ingress'
import Backups from './pages/Backups'
import Git from './pages/Git'
import Apply from './pages/Apply'
import Hypervisors from './pages/Hypervisors'
import Secrets from './pages/Secrets'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="services" element={<Services />} />
          <Route path="vms" element={<VMs />} />
          <Route path="hypervisors" element={<Hypervisors />} />
          <Route path="dns" element={<DNS />} />
          <Route path="ingress" element={<Ingress />} />
          <Route path="backups" element={<Backups />} />
          <Route path="git" element={<Git />} />
          <Route path="apply" element={<Apply />} />
          <Route path="secrets" element={<Secrets />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
