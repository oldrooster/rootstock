import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Apply from '../pages/Apply'

export default function Layout() {
  const { pathname } = useLocation()
  const onApply = pathname === '/apply'

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem', background: '#0f0f1a' }}>
        {/* Apply is always mounted so state/streams persist across navigation */}
        <div style={{ display: onApply ? 'block' : 'none' }}>
          <Apply />
        </div>
        {!onApply && <Outlet />}
      </main>
    </div>
  )
}
