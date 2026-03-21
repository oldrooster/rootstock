import { useEffect, useState } from 'react'

interface SettingsData {
  app_name: string
  homelab_repo_path: string
  homelab_remote_url: string
  log_level: string
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '0.6rem 0',
  borderBottom: '1px solid #2a2a3e',
}

export default function Settings() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
  }, [])

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (!data) return <p style={{ color: '#8890a0' }}>Loading...</p>

  const items = [
    { label: 'Application Name', value: data.app_name },
    { label: 'Homelab Repo Path', value: data.homelab_repo_path },
    { label: 'Remote URL', value: data.homelab_remote_url || '(not configured)' },
    { label: 'Log Level', value: data.log_level },
  ]

  return (
    <div>
      <h1 style={{ color: '#e0e0e0', marginBottom: '1rem' }}>Settings</h1>

      <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem' }}>
        {items.map(item => (
          <div key={item.label} style={rowStyle}>
            <span style={{ color: '#8890a0', fontSize: '0.85rem' }}>{item.label}</span>
            <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{item.value}</span>
          </div>
        ))}
      </div>

      <p style={{ color: '#8890a0', fontSize: '0.8rem', marginTop: '1rem' }}>
        Settings are configured via environment variables. Changes require a restart.
      </p>
    </div>
  )
}
