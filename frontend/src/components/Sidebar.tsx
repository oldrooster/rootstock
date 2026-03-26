import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import logo from '../assets/logo.png'

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
  { to: '/dns', label: 'DNS' },
  { to: '/ingress', label: 'Ingress' },
  { to: '/backups', label: 'Backups' },
  { to: '/git', label: 'Git' },
  { to: '/apply', label: 'Apply' },
  { to: '/secrets', label: 'Secrets' },
  { to: '/settings', label: 'Settings' },
]

function NavItemLink({ to, label, indent, badge }: { to: string; label: string; indent?: boolean; badge?: React.ReactNode }) {
  return (
    <li style={{ marginBottom: '0.15rem' }}>
      <NavLink
        to={to}
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

function CollapsibleGroup({ label, items }: NavGroup) {
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
            <NavItemLink key={item.to} to={item.to} label={item.label} indent />
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

export default function Sidebar() {
  const [anyDirty, setAnyDirty] = useState(false)

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

  return (
    <nav style={{
      width: '200px',
      background: '#1a1a2e',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', padding: '0 0.5rem' }}>
        <img src={logo} alt="Rootstock" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>
          <span style={{ color: '#e0e0e0' }}>Root</span>
          <span style={{ color: '#7CC5D4' }}>stock</span>
        </h2>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {NAV.map((entry, i) =>
          isGroup(entry) ? (
            <CollapsibleGroup key={i} {...entry} />
          ) : (
            <NavItemLink
              key={entry.to}
              to={entry.to}
              label={entry.label}
              badge={entry.to === '/apply' && anyDirty ? <DirtyDot /> : undefined}
            />
          )
        )}
      </ul>
    </nav>
  )
}
