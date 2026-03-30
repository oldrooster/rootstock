import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'

interface AppInfo {
  app_name: string
  homelab_repo_path: string
  homelab_remote_url: string
  log_level: string
}

interface GlobalSettings {
  docker_vols_base: string
  backup_target: string
  backup_schedule: string
}

interface DNSSettings {
  zones: { name: string; internal: boolean; external: boolean }[]
  pihole_host: string
  pihole_config_path: string
}

interface IngressSettings {
  wildcard_domain: string
  cloudflare_api_token_secret: string
  acme_email: string
}

interface AllSettings {
  app: AppInfo
  global_settings: GlobalSettings
  dns: DNSSettings
  ingress: IngressSettings
}

const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: '6px',
  padding: '1.25rem',
  marginBottom: '1.5rem',
}

const inputStyle: React.CSSProperties = {
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  color: '#e0e0e0',
  padding: '0.4rem 0.6rem',
  borderRadius: '4px',
  fontSize: '0.85rem',
  width: '100%',
  boxSizing: 'border-box',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '0.5rem 0',
  borderBottom: '1px solid #2a2a3e',
}

const btnStyle: React.CSSProperties = {
  padding: '0.4rem 0.9rem',
  borderRadius: '4px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 600,
}

const btnPrimary: React.CSSProperties = { ...btnStyle, background: '#7c9ef8', color: '#0f0f1a' }
const btnLink: React.CSSProperties = {
  ...btnStyle,
  background: 'transparent',
  color: '#7c9ef8',
  border: '1px solid #2a2a3e',
  fontSize: '0.75rem',
  padding: '0.25rem 0.5rem',
}

function describeCron(expr: string): string {
  if (!expr.trim()) return 'Not yet active \u2014 schedule logic coming soon'
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return `Not yet active \u2014 schedule logic coming soon`

  const [min, hour, dom, mon, dow] = parts
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  let time = ''
  if (hour !== '*' && min !== '*') {
    const h = parseInt(hour)
    const m = parseInt(min)
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    time = m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
  } else if (hour !== '*') {
    const h = parseInt(hour)
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    time = `${h12}${ampm}`
  } else {
    time = 'every minute'
  }

  // Every day
  if (dom === '*' && mon === '*' && dow === '*') {
    return `Runs at ${time} every day (not yet active)`
  }
  // Specific day(s) of week
  if (dom === '*' && mon === '*' && dow !== '*') {
    const dayNames = dow.split(',').map(d => {
      const n = parseInt(d)
      return isNaN(n) ? d : (DAYS[n] || d)
    })
    if (dayNames.length === 1) return `Runs at ${time} every ${dayNames[0]} (not yet active)`
    return `Runs at ${time} on ${dayNames.join(', ')} (not yet active)`
  }
  // Specific day of month
  if (dom !== '*' && mon === '*' && dow === '*') {
    return `Runs at ${time} on day ${dom} of every month (not yet active)`
  }
  // Specific month + day
  if (dom !== '*' && mon !== '*') {
    const monthName = MONTHS[parseInt(mon)] || mon
    return `Runs at ${time} on ${monthName} ${dom} (not yet active)`
  }
  // Interval patterns
  if (min.startsWith('*/')) {
    return `Runs every ${min.slice(2)} minutes (not yet active)`
  }
  if (hour.startsWith('*/')) {
    return `Runs every ${hour.slice(2)} hours (not yet active)`
  }
  return `Custom schedule: ${expr} (not yet active)`
}

export default function Settings() {
  const [data, setData] = useState<AllSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [globalForm, setGlobalForm] = useState<GlobalSettings>({ docker_vols_base: '/var/docker_vols', backup_target: '/mnt/share/backups', backup_schedule: '' })
  const [globalDirty, setGlobalDirty] = useState(false)
  useUnsavedChanges(globalDirty)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/settings/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => {
        setData(d)
        setGlobalForm(d.global_settings)
      })
      .catch(e => setError(e.message))
  }, [])

  const saveGlobal = () => {
    fetch('/api/settings/global', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(globalForm) })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(g => { setGlobalForm(g); setGlobalDirty(false) })
      .catch(e => setError(e.message))
  }

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (!data) return <p style={{ color: '#8890a0' }}>Loading...</p>

  const appItems = [
    { label: 'Application Name', value: data.app.app_name },
    { label: 'Homelab Repo Path', value: data.app.homelab_repo_path },
    { label: 'Remote URL', value: data.app.homelab_remote_url || '(not configured)' },
    { label: 'Log Level', value: data.app.log_level },
  ]

  return (
    <div>
      <h1 style={{ color: '#e0e0e0', marginBottom: '1rem' }}>Settings</h1>

      {/* App Info (read-only, from env) */}
      <div style={cardStyle}>
        <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Application</h2>
        {appItems.map(item => (
          <div key={item.label} style={rowStyle}>
            <span style={{ color: '#8890a0', fontSize: '0.85rem' }}>{item.label}</span>
            <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{item.value}</span>
          </div>
        ))}
        <p style={{ color: '#8890a0', fontSize: '0.75rem', margin: '0.75rem 0 0 0' }}>
          These are configured via environment variables and require a restart to change.
        </p>
      </div>

      {/* Global Settings (editable) */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>
            Global
            {globalDirty && <span style={{ color: '#f59e0b', fontSize: '0.7rem', marginLeft: '0.5rem' }}>unsaved</span>}
          </h2>
          <button style={btnPrimary} onClick={saveGlobal} disabled={!globalDirty}>Save</button>
        </div>
        <div>
          <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Docker Volumes Base Path</label>
          <input
            style={inputStyle}
            value={globalForm.docker_vols_base}
            onChange={e => { setGlobalForm({ ...globalForm, docker_vols_base: e.target.value }); setGlobalDirty(true) }}
          />
          <p style={{ color: '#8890a0', fontSize: '0.75rem', margin: '0.35rem 0 0 0' }}>
            Replaces <code style={{ color: '#c084fc' }}>{'${DOCKER_VOLS}'}</code> in container volume paths. Default: /var/docker_vols
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Backup Target Path</label>
            <input
              style={inputStyle}
              value={globalForm.backup_target}
              onChange={e => { setGlobalForm({ ...globalForm, backup_target: e.target.value }); setGlobalDirty(true) }}
              placeholder="/mnt/share/backups"
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Backup Schedule (cron)</label>
            <input
              style={inputStyle}
              value={globalForm.backup_schedule}
              onChange={e => { setGlobalForm({ ...globalForm, backup_schedule: e.target.value }); setGlobalDirty(true) }}
              placeholder="0 2 * * *"
            />
            <p style={{ color: '#8890a0', fontSize: '0.75rem', margin: '0.35rem 0 0 0' }}>
              {describeCron(globalForm.backup_schedule)}
            </p>
          </div>
        </div>
      </div>

      {/* DNS Settings (summary + link) */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>DNS</h2>
          <button style={btnLink} onClick={() => navigate('/dns')}>Edit in DNS page</button>
        </div>
        <div style={rowStyle}>
          <span style={{ color: '#8890a0', fontSize: '0.85rem' }}>Pi-hole Host</span>
          <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{data.dns.pihole_host || '(not set)'}</span>
        </div>
        <div style={rowStyle}>
          <span style={{ color: '#8890a0', fontSize: '0.85rem' }}>Pi-hole Config Path</span>
          <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{data.dns.pihole_config_path}</span>
        </div>
        <div style={rowStyle}>
          <span style={{ color: '#8890a0', fontSize: '0.85rem' }}>Zones</span>
          <span style={{ color: '#e0e0e0', fontSize: '0.85rem' }}>
            {data.dns.zones.length === 0 ? '(none)' : data.dns.zones.map(z => z.name).join(', ')}
          </span>
        </div>
      </div>

      {/* Ingress Settings (summary + link) */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>Ingress</h2>
          <button style={btnLink} onClick={() => navigate('/ingress')}>Edit in Ingress page</button>
        </div>
        <div style={rowStyle}>
          <span style={{ color: '#8890a0', fontSize: '0.85rem' }}>Wildcard Domain</span>
          <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{data.ingress.wildcard_domain || '(not set)'}</span>
        </div>
        <div style={rowStyle}>
          <span style={{ color: '#8890a0', fontSize: '0.85rem' }}>ACME Email</span>
          <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{data.ingress.acme_email || '(not set)'}</span>
        </div>
        <div style={rowStyle}>
          <span style={{ color: '#8890a0', fontSize: '0.85rem' }}>Cloudflare API Token Secret</span>
          <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{data.ingress.cloudflare_api_token_secret || '(not set)'}</span>
        </div>
      </div>
    </div>
  )
}
