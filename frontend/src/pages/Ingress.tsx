import { useEffect, useState } from 'react'

interface IngressRule {
  service_name: string
  hostname: string
  backend_port: number
  enabled: boolean
}

export default function Ingress() {
  const [rules, setRules] = useState<IngressRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ingress/rules')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setRules)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <h1 style={{ color: '#e0e0e0', marginBottom: '1rem' }}>Ingress</h1>

      {rules.length === 0 ? (
        <p style={{ color: '#8890a0' }}>No ingress rules found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Service</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Hostname</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Backend Port</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.service_name} style={{ borderBottom: '1px solid #1a1a2e' }}>
                <td style={{ color: '#e0e0e0', padding: '0.6rem 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>{r.service_name}</td>
                <td style={{ color: '#7c9ef8', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}>{r.hostname}</td>
                <td style={{ color: '#b0b8d0', padding: '0.6rem 0.75rem', fontSize: '0.9rem', fontFamily: 'monospace' }}>{r.backend_port}</td>
                <td style={{ padding: '0.6rem 0.75rem' }}>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    background: r.enabled ? '#166534' : '#7f1d1d',
                    color: r.enabled ? '#86efac' : '#fca5a5',
                  }}>
                    {r.enabled ? 'enabled' : 'disabled'}
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
