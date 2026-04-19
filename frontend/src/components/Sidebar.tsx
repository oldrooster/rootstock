import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import logo from '../assets/logo.png'
import { clearAuth, getStoredUsername } from '../lib/api'
import { useTheme } from '../contexts/ThemeContext'

interface NavItem {
  to: string
  label: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

type NavEntry = NavItem | NavGroup

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'items' in entry
}

const NAV: NavEntry[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/containers', label: 'Containers' },
  {
    label: 'Infrastructure',
    items: [
      { to: '/nodes', label: 'Nodes' },
      { to: '/vms', label: 'VMs' },
      { to: '/images', label: 'Images' },
      { to: '/templates', label: 'Templates' },
      { to: '/roles', label: 'Roles' },
    ],
  },
  { to: '/stats', label: 'Stats' },
  { to: '/dns', label: 'DNS' },
  { to: '/ingress', label: 'Ingress' },
  { to: '/backups', label: 'Backups' },
  { to: '/git', label: 'Git' },
  { to: '/apply', label: 'Apply' },
  { to: '/secrets', label: 'Secrets' },
  { to: '/settings', label: 'Settings' },
]

function NavItemLink({ to, label, indent, badge, onClick }: {
  to: string; label: string; indent?: boolean; badge?: React.ReactNode; onClick?: () => void
}) {
  return (
    <li style={{ marginBottom: '0.15rem' }}>
      <NavLink
        to={to}
        onClick={onClick}
        style={({ isActive }) => ({
          color: isActive ? '#7c9ef8' : indent ? '#8890a0' : '#b0b8d0',
          textDecoration: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: indent ? '0.3rem 0.5rem 0.3rem 1.5rem' : '0.5rem',
          borderRadius: '4px',
          fontSize: indent ? '0.82rem' : '0.9rem',
          background: isActive ? 'rgba(124,158,248,0.1)' : 'transparent',
        })}
      >
        <span>{label}</span>
        {badge}
      </NavLink>
    </li>
  )
}

function CollapsibleGroup({ label, items, onNavigate }: NavGroup & { onNavigate?: () => void }) {
  const location = useLocation()
  const isChildActive = items.some(item => location.pathname.startsWith(item.to))
  const [open, setOpen] = useState(isChildActive)

  return (
    <li style={{ marginBottom: '0.15rem' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'transparent',
          border: 'none',
          color: isChildActive ? '#7c9ef8' : '#b0b8d0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '0.5rem',
          borderRadius: '4px',
          fontSize: '0.9rem',
          textAlign: 'left',
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map(item => (
            <NavItemLink key={item.to} to={item.to} label={item.label} indent onClick={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  )
}

const DirtyDot = () => (
  <span style={{
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#f59e0b',
    display: 'inline-block',
    flexShrink: 0,
  }} />
)

const MOBILE_BREAKPOINT = 768

export default function Sidebar() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const [anyDirty, setAnyDirty] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT)
  const username = getStoredUsername()

  const handleLogout = () => {
    clearAuth()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    const check = () => {
      fetch('/api/apply/status')
        .then(r => r.json())
        .then(data => setAnyDirty(data.any_dirty))
        .catch(() => {})
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT
      setIsMobile(mobile)
      if (!mobile) setMobileOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const closeMobile = () => { if (isMobile) setMobileOpen(false) }

  const navContent = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', padding: '0 0.5rem' }}>
        <img src={logo} alt="Rootstock" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>
          <span style={{ color: '#e0e0e0' }}>Root</span>
          <span style={{ color: '#7CC5D4' }}>stock</span>
        </h2>
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: '#8890a0', fontSize: '1.2rem', cursor: 'pointer', padding: '0.25rem',
            }}
            aria-label="Close menu"
          >{'\u2715'}</button>
        )}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {NAV.map((entry, i) =>
          isGroup(entry) ? (
            <CollapsibleGroup key={i} {...entry} onNavigate={closeMobile} />
          ) : (
            <NavItemLink
              key={entry.to}
              to={entry.to}
              label={entry.label}
              badge={entry.to === '/apply' && anyDirty ? <DirtyDot /> : undefined}
              onClick={closeMobile}
            />
          )
        )}
      </ul>

      {/* Logout + theme section pinned to bottom */}
      <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #2a2a3e' }}>
        {username && (
          <div style={{ color: '#8890a0', fontSize: '0.78rem', padding: '0 0.5rem 0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {username}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              background: 'transparent',
              border: '1px solid #2a2a3e',
              borderRadius: '4px',
              color: '#8890a0',
              cursor: 'pointer',
              padding: '0.4rem 0.5rem',
              fontSize: '0.82rem',
              flexShrink: 0,
            }}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            onClick={handleLogout}
            style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid #2a2a3e',
              borderRadius: '4px',
              color: '#8890a0',
              cursor: 'pointer',
              padding: '0.4rem 0.5rem',
              fontSize: '0.82rem',
              textAlign: 'left',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  )

  // Desktop: always visible sidebar
  if (!isMobile) {
    return (
      <nav style={{
        width: '200px',
        flexShrink: 0,
        background: '#1a1a2e',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {navContent}
      </nav>
    )
  }

  // Mobile: hamburger button + slide-out overlay
  return (
    <>
      {/* Hamburger button — fixed top-left */}
      {!mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          style={{
            position: 'fixed', top: '0.6rem', left: '0.6rem', zIndex: 1100,
            background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: '6px',
            color: '#b0b8d0', fontSize: '1.3rem', cursor: 'pointer',
            width: '2.5rem', height: '2.5rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="Open menu"
        >{'\u2630'}</button>
      )}

      {/* Overlay + drawer */}
      {mobileOpen && (
        <>
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 1200,
              background: 'rgba(0,0,0,0.5)',
            }}
          />
          <nav style={{
            position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 1300,
            width: '220px',
            background: '#1a1a2e',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            boxShadow: '4px 0 20px rgba(0,0,0,0.4)',
          }}>
            {navContent}
          </nav>
        </>
      )}
    </>
  )
}
