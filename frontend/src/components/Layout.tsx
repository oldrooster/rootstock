import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Apply from '../pages/Apply'

const MOBILE_BREAKPOINT = 768

export default function Layout() {
  const { pathname } = useLocation()
  const onApply = pathname === '/apply'
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Sidebar />
      <main style={{
        flex: 1, overflow: 'auto', background: '#0f0f1a',
        padding: isMobile ? '3.5rem 1rem 1rem 1rem' : '1.5rem',
      }}>
        {/* Apply is always mounted so state/streams persist across navigation */}
        <div style={{ display: onApply ? 'block' : 'none' }}>
          <Apply />
        </div>
        {!onApply && <Outlet />}
      </main>
    </div>
  )
}
