import { useEffect, useState } from 'react'

interface ApplyPreview {
  total_services: number
  enabled_services: number
  total_vms: number
  enabled_vms: number
}

interface DNSRecord { hostname: string; ip: string; source: string }
interface ApplyResult {
  caddyfile: string
  pihole_custom_dns: string
  dns_records: DNSRecord[]
  terraform_main_tf: string
  ansible_inventory: string
  ansible_status: string
}

const btnPrimary: React.CSSProperties = {
  background: '#7c9ef8',
  color: '#0f0f1a',
  border: 'none',
  borderRadius: '4px',
  padding: '0.5rem 1.25rem',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 600,
}

const preStyle: React.CSSProperties = {
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  borderRadius: '4px',
  padding: '0.75rem',
  color: '#b0b8d0',
  fontSize: '0.8rem',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: '20rem',
  overflow: 'auto',
  margin: 0,
}

export default function Apply() {
  const [preview, setPreview] = useState<ApplyPreview | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/apply/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setPreview)
      .catch(e => setError(e.message))
  }, [])

  async function handleApply() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/apply/', { method: 'POST' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      const data = await r.json()
      setResult(data)
      setExpanded({})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function toggle(key: string) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (!preview && !error) return <p style={{ color: '#8890a0' }}>Loading...</p>

  const sections = result ? [
    { key: 'caddyfile', label: 'Caddyfile', content: result.caddyfile },
    { key: 'pihole', label: 'Pi-hole Custom DNS', content: result.pihole_custom_dns },
    { key: 'terraform', label: 'Terraform main.tf', content: result.terraform_main_tf },
    { key: 'inventory', label: 'Ansible Inventory', content: result.ansible_inventory },
  ] : []

  return (
    <div>
      <h1 style={{ color: '#e0e0e0', marginBottom: '1rem' }}>Apply</h1>

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem' }}>
          {error}
        </div>
      )}

      <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '1rem' }}>
        {preview && (
          <div style={{ color: '#8890a0', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            This will generate configs for{' '}
            <strong style={{ color: '#e0e0e0' }}>{preview.enabled_services}</strong> service(s) and{' '}
            <strong style={{ color: '#e0e0e0' }}>{preview.enabled_vms}</strong> VM(s).
          </div>
        )}
        <button style={btnPrimary} onClick={handleApply} disabled={loading}>
          {loading ? 'Generating...' : 'Generate Configs'}
        </button>
      </div>

      {result && (
        <>
          <div style={{ background: '#166534', color: '#86efac', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
            {result.ansible_status}
          </div>

          {sections.map(({ key, label, content }) => (
            <div key={key} style={{ background: '#1a1a2e', borderRadius: '6px', marginBottom: '0.5rem' }}>
              <button
                onClick={() => toggle(key)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#e0e0e0',
                  padding: '0.75rem 1rem',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                {label}
                <span style={{ color: '#8890a0', fontSize: '0.8rem' }}>
                  {expanded[key] ? 'collapse' : 'expand'}
                </span>
              </button>
              {expanded[key] && (
                <div style={{ padding: '0 1rem 1rem' }}>
                  <pre style={preStyle}>{content || '(empty)'}</pre>
                </div>
              )}
            </div>
          ))}

          {result.dns_records.length > 0 && (
            <div style={{ background: '#1a1a2e', borderRadius: '6px', marginBottom: '0.5rem' }}>
              <button
                onClick={() => toggle('dns')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#e0e0e0',
                  padding: '0.75rem 1rem',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                DNS Records ({result.dns_records.length})
                <span style={{ color: '#8890a0', fontSize: '0.8rem' }}>
                  {expanded['dns'] ? 'collapse' : 'expand'}
                </span>
              </button>
              {expanded['dns'] && (
                <div style={{ padding: '0 1rem 1rem' }}>
                  <pre style={preStyle}>
                    {result.dns_records.map(r => `${r.hostname} → ${r.ip} (${r.source})`).join('\n')}
                  </pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
