import { useEffect, useState } from 'react'

interface GitStatus {
  branch: string
  is_dirty: boolean
  staged_files: string[]
  unstaged_files: string[]
  untracked_files: string[]
  ahead: number
  behind: number
}

interface CommitInfo { hash: string; message: string; date: string }

const btnPrimary: React.CSSProperties = {
  background: '#7c9ef8',
  color: '#0f0f1a',
  border: 'none',
  borderRadius: '4px',
  padding: '0.4rem 1rem',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 600,
}

const btnSecondary: React.CSSProperties = {
  background: 'transparent',
  color: '#b0b8d0',
  border: '1px solid #2a2a3e',
  borderRadius: '4px',
  padding: '0.4rem 0.8rem',
  cursor: 'pointer',
  fontSize: '0.85rem',
}

export default function Git() {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [pushing, setPushing] = useState(false)

  function loadStatus() {
    fetch('/api/git/status')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setStatus)
      .catch(e => setError(e.message))
  }

  function loadCommits() {
    fetch('/api/dashboard/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => setCommits(data.recent_commits || []))
      .catch(() => {})
  }

  useEffect(() => { loadStatus(); loadCommits() }, [])

  async function handlePush() {
    setPushing(true)
    setPushMsg(null)
    try {
      const r = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setPushMsg('Push successful')
      loadStatus()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPushing(false)
    }
  }

  if (!status && !error) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Git</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button style={btnSecondary} onClick={() => { loadStatus(); loadCommits() }}>Refresh</button>
          <button style={btnPrimary} onClick={handlePush} disabled={pushing}>
            {pushing ? 'Pushing...' : 'Push'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button style={{ ...btnSecondary, border: 'none', color: '#fca5a5' }} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {pushMsg && (
        <div style={{ background: '#166534', color: '#86efac', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{pushMsg}</span>
          <button style={{ ...btnSecondary, border: 'none', color: '#86efac' }} onClick={() => setPushMsg(null)}>dismiss</button>
        </div>
      )}

      {status && (
        <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <span style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase' }}>Branch</span>
              <div style={{ color: '#7c9ef8', fontWeight: 600, marginTop: '0.25rem' }}>{status.branch}</div>
            </div>
            <div>
              <span style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase' }}>Status</span>
              <div style={{ marginTop: '0.25rem' }}>
                <span style={{
                  fontSize: '0.7rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '9999px',
                  background: status.is_dirty ? '#7f1d1d' : '#166534',
                  color: status.is_dirty ? '#fca5a5' : '#86efac',
                }}>
                  {status.is_dirty ? 'dirty' : 'clean'}
                </span>
              </div>
            </div>
          </div>

          {status.ahead > 0 && <p style={{ color: '#b0b8d0', fontSize: '0.85rem', margin: '0.25rem 0' }}>Ahead of remote by {status.ahead} commit(s)</p>}
          {status.behind > 0 && <p style={{ color: '#b0b8d0', fontSize: '0.85rem', margin: '0.25rem 0' }}>Behind remote by {status.behind} commit(s)</p>}

          {status.staged_files.length > 0 && (
            <details style={{ color: '#b0b8d0', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer' }}>Staged ({status.staged_files.length})</summary>
              <ul style={{ margin: '0.25rem 0', paddingLeft: '1.25rem' }}>{status.staged_files.map(f => <li key={f} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{f}</li>)}</ul>
            </details>
          )}
          {status.unstaged_files.length > 0 && (
            <details style={{ color: '#b0b8d0', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer' }}>Unstaged ({status.unstaged_files.length})</summary>
              <ul style={{ margin: '0.25rem 0', paddingLeft: '1.25rem' }}>{status.unstaged_files.map(f => <li key={f} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{f}</li>)}</ul>
            </details>
          )}
          {status.untracked_files.length > 0 && (
            <details style={{ color: '#b0b8d0', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer' }}>Untracked ({status.untracked_files.length})</summary>
              <ul style={{ margin: '0.25rem 0', paddingLeft: '1.25rem' }}>{status.untracked_files.map(f => <li key={f} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{f}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem' }}>
        <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Recent Commits</h2>
        {commits.length === 0 ? (
          <p style={{ color: '#8890a0', margin: 0 }}>No commits yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Hash</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Message</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {commits.map(c => (
                <tr key={c.hash} style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <td style={{ color: '#7c9ef8', padding: '0.5rem 0.75rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>{c.hash}</td>
                  <td style={{ color: '#e0e0e0', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>{c.message}</td>
                  <td style={{ color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}>{new Date(c.date).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
