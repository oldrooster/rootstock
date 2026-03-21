import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem', background: '#0f0f1a' }}>
        <Outlet />
      </main>
    </div>
  )
}
