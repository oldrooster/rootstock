import { useEffect, useState } from 'react'

interface BackupEntry {
  service_name: string
  host: string
  volume_path: string
  last_backup: string | null
  status: string
}

interface BackupResult {
  service_name: string
  action: string
  detail: string
}

const btnSecondary: React.CSSProperties = {
  background: 'transparent',
  color: '#b0b8d0',
  border: '1px solid #2a2a3e',
  borderRadius: '4px',
  padding: '0.3rem 0.6rem',
  cursor: 'pointer',
  fontSize: '0.8rem',
}

export default function Backups() {
  const [entries, setEntries] = useState<BackupEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BackupResult | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  function loadBackups() {
    fetch('/api/backups/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setEntries)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadBackups() }, [])

  async function handleAction(serviceName: string, action: 'backup' | 'restore') {
    setActionLoading(`${serviceName}-${action}`)
    setResult(null)
    try {
      const r = await fetch(`/api/backups/${serviceName}/${action}`, { method: 'POST' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      const res = await r.json()
      setResult(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActionLoading(null)
    }
  }

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <h1 style={{ color: '#e0e0e0', marginBottom: '1rem' }}>Backups</h1>

      {result && (
        <div style={{ background: '#166534', color: '#86efac', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{result.action} — {result.detail}</span>
          <button style={{ ...btnSecondary, border: 'none', color: '#86efac' }} onClick={() => setResult(null)}>dismiss</button>
        </div>
      )}

      {entries.length === 0 ? (
        <p style={{ color: '#8890a0' }}>No backup-eligible volumes found. Add volumes with backup enabled to your services.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Service</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Host</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Volume</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Last Backup</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Status</th>
              <th style={{ textAlign: 'right', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={`${e.service_name}-${i}`} style={{ borderBottom: '1px solid #1a1a2e' }}>
                <td style={{ color: '#e0e0e0', padding: '0.6rem 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>{e.service_name}</td>
                <td style={{ color: '#b0b8d0', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}>{e.host}</td>
                <td style={{ color: '#b0b8d0', padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>{e.volume_path}</td>
                <td style={{ color: '#8890a0', padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>{e.last_backup || 'Never'}</td>
                <td style={{ padding: '0.6rem 0.75rem' }}>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    background: '#166534',
                    color: '#86efac',
                  }}>{e.status}</span>
                </td>
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                    <button
                      style={{ ...btnSecondary, borderColor: '#7c9ef8', color: '#7c9ef8' }}
                      disabled={actionLoading !== null}
                      onClick={() => handleAction(e.service_name, 'backup')}
                    >
                      {actionLoading === `${e.service_name}-backup` ? 'Running...' : 'Backup'}
                    </button>
                    <button
                      style={btnSecondary}
                      disabled={actionLoading !== null}
                      onClick={() => handleAction(e.service_name, 'restore')}
                    >
                      {actionLoading === `${e.service_name}-restore` ? 'Running...' : 'Restore'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
