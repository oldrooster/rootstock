import { NavLink } from 'react-router-dom'
import logo from '../assets/logo.png'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/services', label: 'Services' },
  { to: '/vms', label: 'VMs' },
  { to: '/hypervisors', label: 'Hypervisors' },
  { to: '/dns', label: 'DNS' },
  { to: '/ingress', label: 'Ingress' },
  { to: '/backups', label: 'Backups' },
  { to: '/git', label: 'Git' },
  { to: '/apply', label: 'Apply' },
  { to: '/secrets', label: 'Secrets' },
  { to: '/settings', label: 'Settings' },
]

export default function Sidebar() {
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
        {NAV_ITEMS.map(({ to, label }) => (
          <li key={to} style={{ marginBottom: '0.25rem' }}>
            <NavLink
              to={to}
              style={({ isActive }) => ({
                color: isActive ? '#7c9ef8' : '#b0b8d0',
                textDecoration: 'none',
                display: 'block',
                padding: '0.5rem',
                borderRadius: '4px',
                fontSize: '0.9rem',
                background: isActive ? 'rgba(124,158,248,0.1)' : 'transparent',
              })}
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
