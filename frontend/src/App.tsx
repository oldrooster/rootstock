import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Containers from './pages/Containers'
import Services from './pages/Services'
import VMs from './pages/VMs'
import DNS from './pages/DNS'
import Ingress from './pages/Ingress'
import Backups from './pages/Backups'
import Git from './pages/Git'
import Nodes from './pages/Nodes'
import Images from './pages/Images'
import Templates from './pages/Templates'
import Roles from './pages/Roles'
import Secrets from './pages/Secrets'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="containers" element={<Containers />} />
          <Route path="services" element={<Services />} /> {/* legacy */}
          <Route path="vms" element={<VMs />} />
          <Route path="nodes" element={<Nodes />} />
          <Route path="images" element={<Images />} />
          <Route path="templates" element={<Templates />} />
          <Route path="roles" element={<Roles />} />
          <Route path="dns" element={<DNS />} />
          <Route path="ingress" element={<Ingress />} />
          <Route path="backups" element={<Backups />} />
          <Route path="git" element={<Git />} />
          {/* Apply is rendered persistently in Layout, not here */}
          <Route path="apply" element={null} />
          <Route path="secrets" element={<Secrets />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
