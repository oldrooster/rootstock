import { useEffect, useState } from 'react'

interface DNSRecord {
  hostname: string
  ip: string
  source: 'service' | 'static'
}

export default function DNS() {
  const [records, setRecords] = useState<DNSRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dns/records')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setRecords)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <h1 style={{ color: '#e0e0e0', marginBottom: '1rem' }}>DNS</h1>

      {records.length === 0 ? (
        <p style={{ color: '#8890a0' }}>No DNS records found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Hostname</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>IP</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => (
              <tr key={r.hostname} style={{ borderBottom: '1px solid #1a1a2e' }}>
                <td style={{ color: '#e0e0e0', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}>{r.hostname}</td>
                <td style={{ color: '#b0b8d0', padding: '0.6rem 0.75rem', fontSize: '0.9rem', fontFamily: 'monospace' }}>{r.ip}</td>
                <td style={{ padding: '0.6rem 0.75rem' }}>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    background: r.source === 'service' ? 'rgba(124,158,248,0.15)' : 'rgba(136,144,160,0.15)',
                    color: r.source === 'service' ? '#7c9ef8' : '#8890a0',
                  }}>
                    {r.source}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
