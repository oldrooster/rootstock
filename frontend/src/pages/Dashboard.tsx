import { useEffect, useState } from 'react'

interface CommitInfo { hash: string; message: string; date: string }
interface DashboardData {
  total_services: number
  enabled_services: number
  total_vms: number
  enabled_vms: number
  total_hypervisors: number
  hosts: string[]
  recent_commits: CommitInfo[]
}

const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: '6px',
  padding: '1.25rem',
  textAlign: 'center',
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
  }, [])

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (!data) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <h1 style={{ color: '#e0e0e0', marginBottom: '1rem' }}>Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={cardStyle}>
          <div style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Services</div>
          <div style={{ color: '#e0e0e0', fontSize: '2rem', fontWeight: 700 }}>{data.enabled_services}</div>
          <div style={{ color: '#8890a0', fontSize: '0.8rem' }}>{data.total_services} total</div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>VMs</div>
          <div style={{ color: '#e0e0e0', fontSize: '2rem', fontWeight: 700 }}>{data.enabled_vms}</div>
          <div style={{ color: '#8890a0', fontSize: '0.8rem' }}>{data.total_vms} total</div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Hypervisors</div>
          <div style={{ color: '#e0e0e0', fontSize: '2rem', fontWeight: 700 }}>{data.total_hypervisors}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Hosts</div>
          <div style={{ color: '#e0e0e0', fontSize: '2rem', fontWeight: 700 }}>{data.hosts.length}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', justifyContent: 'center', marginTop: '0.35rem' }}>
            {data.hosts.map(h => (
              <span key={h} style={{
                fontSize: '0.7rem',
                padding: '0.1rem 0.5rem',
                borderRadius: '9999px',
                background: 'rgba(124,158,248,0.15)',
                color: '#7c9ef8',
              }}>{h}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem' }}>
        <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Recent Commits</h2>
        {data.recent_commits.length === 0 ? (
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
              {data.recent_commits.map(c => (
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
