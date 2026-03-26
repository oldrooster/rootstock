import { useEffect, useState } from 'react'

interface BackupPath {
  host: string
  path: string
  source: 'container' | 'manual'
  description: string
}

interface ManualBackupPath {
  host: string
  path: string
  description: string
}

interface HostInfo {
  name: string
  type: string
  status: string
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

const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' }

const btnStyle: React.CSSProperties = {
  padding: '0.4rem 0.9rem',
  borderRadius: '4px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 600,
}

const btnPrimary: React.CSSProperties = { ...btnStyle, background: '#7c9ef8', color: '#0f0f1a' }
const btnDanger: React.CSSProperties = { ...btnStyle, background: '#f87171', color: '#0f0f1a' }
const btnSecondary: React.CSSProperties = { ...btnStyle, background: '#2a2a3e', color: '#e0e0e0' }

const emptyManual: ManualBackupPath = { host: '', path: '', description: '' }

export default function Backups() {
  const [paths, setPaths] = useState<BackupPath[]>([])
  const [manualPaths, setManualPaths] = useState<ManualBackupPath[]>([])
  const [hosts, setHosts] = useState<HostInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Manual form
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [manualForm, setManualForm] = useState<ManualBackupPath>({ ...emptyManual })
  const [manualError, setManualError] = useState<string | null>(null)

  const fetchAll = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/backups/paths').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/backups/manual').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/hosts/').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
    ])
      .then(([p, m, h]) => {
        setPaths(p)
        setManualPaths(m)
        setHosts(h)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll() }, [])

  // Group paths by host
  const pathsByHost: Record<string, BackupPath[]> = {}
  for (const p of paths) {
    if (!pathsByHost[p.host]) pathsByHost[p.host] = []
    pathsByHost[p.host].push(p)
  }

  const saveManualPath = () => {
    setManualError(null)
    const method = editingIndex !== null ? 'PUT' : 'POST'
    const url = editingIndex !== null ? `/api/backups/manual/${editingIndex}` : '/api/backups/manual'
    fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manualForm) })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(list => {
        setManualPaths(list)
        setEditingIndex(null)
        setManualForm({ ...emptyManual })
        // Refresh all paths
        fetch('/api/backups/paths').then(r => r.json()).then(setPaths)
      })
      .catch(e => setManualError(e.message))
  }

  const deleteManualPath = (index: number) => {
    fetch(`/api/backups/manual/${index}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(list => {
        setManualPaths(list)
        fetch('/api/backups/paths').then(r => r.json()).then(setPaths)
      })
      .catch(e => setManualError(e.message))
  }

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  const hostNames = [...new Set([...hosts.map(h => h.name), ...paths.map(p => p.host)])]
  const sortedHosts = Object.entries(pathsByHost).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div>
      <h1 style={{ color: '#e0e0e0', marginBottom: '1rem' }}>Backups</h1>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {sortedHosts.map(([host, hostPaths]) => (
          <div key={host} style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', textAlign: 'center' }}>
            <div style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', marginBottom: '0.35rem' }}>{host}</div>
            <div style={{ color: '#e0e0e0', fontSize: '1.5rem', fontWeight: 700 }}>{hostPaths.length}</div>
            <div style={{ color: '#8890a0', fontSize: '0.75rem' }}>volume{hostPaths.length !== 1 ? 's' : ''}</div>
          </div>
        ))}
        {sortedHosts.length === 0 && (
          <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
            <p style={{ color: '#8890a0', margin: 0 }}>No backup paths found. Add volumes with backup enabled to containers, or add manual paths below.</p>
          </div>
        )}
      </div>

      {/* All paths grouped by host */}
      {sortedHosts.map(([host, hostPaths]) => (
        <div key={host} style={cardStyle}>
          <h2 style={{ color: '#7c9ef8', fontSize: '0.95rem', margin: '0 0 0.5rem 0' }}>{host}</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Path</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Source</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {hostPaths.map((p, i) => (
                <tr key={`${p.path}-${i}`} style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <td style={{ color: '#e0e0e0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>{p.path}</td>
                  <td style={{ padding: '0.4rem 0.75rem' }}>
                    <span style={{
                      fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                      background: p.source === 'container' ? 'rgba(124,158,248,0.15)' : 'rgba(136,144,160,0.15)',
                      color: p.source === 'container' ? '#7c9ef8' : '#8890a0',
                    }}>{p.source}</span>
                  </td>
                  <td style={{ color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>{p.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Manual Backup Paths */}
      <div style={cardStyle}>
        <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Manual Backup Paths</h2>
        {manualError && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0 0 0.5rem 0' }}>{manualError}</p>}

        {/* Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr auto', gap: '0.5rem', marginBottom: '1rem', alignItems: 'end' }}>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Host</label>
            <select
              style={selectStyle}
              value={manualForm.host}
              onChange={e => setManualForm({ ...manualForm, host: e.target.value })}
            >
              <option value="">Select host...</option>
              {hostNames.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Path</label>
            <input
              style={inputStyle}
              placeholder="/home/pi/scripts"
              value={manualForm.path}
              onChange={e => setManualForm({ ...manualForm, path: e.target.value })}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Description</label>
            <input
              style={inputStyle}
              placeholder="optional"
              value={manualForm.description}
              onChange={e => setManualForm({ ...manualForm, description: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button style={btnPrimary} onClick={saveManualPath}>
              {editingIndex !== null ? 'Update' : 'Add'}
            </button>
            {editingIndex !== null && (
              <button style={btnSecondary} onClick={() => { setEditingIndex(null); setManualForm({ ...emptyManual }) }}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* List */}
        {manualPaths.length === 0 ? (
          <p style={{ color: '#8890a0', margin: 0, fontSize: '0.85rem' }}>No manual backup paths. Use the form above to add one.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Host</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Path</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Description</th>
                <th style={{ textAlign: 'right', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {manualPaths.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <td style={{ color: '#e0e0e0', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>{p.host}</td>
                  <td style={{ color: '#b0b8d0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>{p.path}</td>
                  <td style={{ color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>{p.description || '—'}</td>
                  <td style={{ textAlign: 'right', padding: '0.4rem 0.75rem' }}>
                    <button
                      style={{ ...btnSecondary, marginRight: '0.35rem', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      onClick={() => { setEditingIndex(i); setManualForm({ ...p }) }}
                    >Edit</button>
                    <button
                      style={{ ...btnDanger, fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      onClick={() => deleteManualPath(i)}
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
