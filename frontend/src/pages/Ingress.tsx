import { Fragment, useEffect, useRef, useState } from 'react'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { getWsUrl } from '../lib/api'

interface IngressRule {
  name: string
  hostname: string
  backend: string
  caddy_host: string
  ingress_mode: string
  external: boolean
  enabled: boolean
  source: 'container' | 'manual'
}

interface ManualRule {
  name: string
  hostname: string
  backend: string
  caddy_host: string
  external: boolean
}

interface IngressSettings {
  wildcard_domain: string
  cloudflare_api_token_secret: string
  cloudflare_account_id: string
  acme_email: string
  docker_network: string
  tunnel_token_secret: string
  tunnel_tokens: Record<string, string>
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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'auto',
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
const btnDanger: React.CSSProperties = { ...btnStyle, background: '#f87171', color: '#0f0f1a' }
const btnSecondary: React.CSSProperties = { ...btnStyle, background: '#2a2a3e', color: '#e0e0e0' }

const emptyManual: ManualRule = { name: '', hostname: '', backend: '', caddy_host: '', external: false }

export default function Ingress() {
  const [rules, setRules] = useState<IngressRule[]>([])
  const [manualRules, setManualRules] = useState<ManualRule[]>([])
  const [ingressSettings, setIngressSettings] = useState<IngressSettings>({ wildcard_domain: '', cloudflare_api_token_secret: '', cloudflare_account_id: '', acme_email: '', docker_network: 'backend', tunnel_token_secret: '', tunnel_tokens: {} })
  const [hosts, setHosts] = useState<HostInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Manual rule form
  const [editingManual, setEditingManual] = useState<ManualRule | null>(null)
  const [manualForm, setManualForm] = useState<ManualRule>({ ...emptyManual })
  const [manualError, setManualError] = useState<string | null>(null)

  // Preview
  const [preview, setPreview] = useState<{ type: string; host: string; content: string } | null>(null)

  // Settings dirty
  const [settingsDirty, setSettingsDirty] = useState(false)
  useUnsavedChanges(settingsDirty || editingManual !== null)

  // Caddy management
  const [restartingHost, setRestartingHost] = useState<string | null>(null)
  const [caddyLogHost, setCaddyLogHost] = useState<string | null>(null)
  const [caddyLogLines, setCaddyLogLines] = useState<string[]>([])
  const caddyLogWsRef = useRef<WebSocket | null>(null)
  const caddyLogEndRef = useRef<HTMLDivElement>(null)

  // Cloudflared management
  const [restartingCfdHost, setRestartingCfdHost] = useState<string | null>(null)
  const [cfdLogHost, setCfdLogHost] = useState<string | null>(null)
  const [cfdLogLines, setCfdLogLines] = useState<string[]>([])
  const cfdLogWsRef = useRef<WebSocket | null>(null)
  const cfdLogEndRef = useRef<HTMLDivElement>(null)

  const fetchAll = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/ingress/rules').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/ingress/manual').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/ingress/settings').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/hosts/').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
    ])
      .then(([rul, man, sett, h]) => {
        setRules(rul)
        setManualRules(man)
        setIngressSettings(sett)
        setHosts(h)
        setSettingsDirty(false)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    caddyLogEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [caddyLogLines])

  useEffect(() => {
    cfdLogEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [cfdLogLines])

  async function restartCaddy(host: string) {
    setRestartingHost(host)
    try {
      const r = await fetch(`/api/ingress/caddy/${encodeURIComponent(host)}/restart`, { method: 'POST' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRestartingHost(null)
    }
  }

  function openCaddyLogs(host: string) {
    // Close existing connection
    if (caddyLogWsRef.current) { caddyLogWsRef.current.close(); caddyLogWsRef.current = null }
    setCaddyLogLines([])
    setCaddyLogHost(host)

    const ws = new WebSocket(
      getWsUrl(`/api/ingress/caddy/${encodeURIComponent(host)}/logs`)
    )
    caddyLogWsRef.current = ws

    let buffer = ''
    ws.onmessage = (e) => {
      buffer += e.data
      const parts = buffer.split('\n')
      buffer = parts.pop() || ''
      if (parts.length > 0) {
        setCaddyLogLines(prev => [...prev, ...parts].slice(-500))
      }
    }
    ws.onclose = () => {}
  }

  function closeCaddyLogs() {
    if (caddyLogWsRef.current) { caddyLogWsRef.current.close(); caddyLogWsRef.current = null }
    setCaddyLogHost(null)
    setCaddyLogLines([])
  }

  async function restartCloudflared(host: string) {
    setRestartingCfdHost(host)
    try {
      const r = await fetch(`/api/ingress/cloudflared/${encodeURIComponent(host)}/restart`, { method: 'POST' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRestartingCfdHost(null)
    }
  }

  function openCloudflaredLogs(host: string) {
    if (cfdLogWsRef.current) { cfdLogWsRef.current.close(); cfdLogWsRef.current = null }
    setCfdLogLines([])
    setCfdLogHost(host)

    const ws = new WebSocket(
      getWsUrl(`/api/ingress/cloudflared/${encodeURIComponent(host)}/logs`)
    )
    cfdLogWsRef.current = ws

    let buffer = ''
    ws.onmessage = (e) => {
      buffer += e.data
      const parts = buffer.split('\n')
      buffer = parts.pop() || ''
      if (parts.length > 0) {
        setCfdLogLines(prev => [...prev, ...parts].slice(-500))
      }
    }
    ws.onclose = () => {}
  }

  function closeCloudflaredLogs() {
    if (cfdLogWsRef.current) { cfdLogWsRef.current.close(); cfdLogWsRef.current = null }
    setCfdLogHost(null)
    setCfdLogLines([])
  }

  // Group rules by caddy_host
  const rulesByHost: Record<string, IngressRule[]> = {}
  for (const r of rules) {
    if (!rulesByHost[r.caddy_host]) rulesByHost[r.caddy_host] = []
    rulesByHost[r.caddy_host].push(r)
  }

  const saveManualRule = () => {
    setManualError(null)
    const method = editingManual ? 'PUT' : 'POST'
    const url = editingManual ? `/api/ingress/manual/${encodeURIComponent(editingManual.name)}` : '/api/ingress/manual'
    fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manualForm) })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(list => {
        setManualRules(list)
        setEditingManual(null)
        setManualForm({ ...emptyManual })
        // Refresh all rules
        fetch('/api/ingress/rules').then(r => r.json()).then(setRules)
      })
      .catch(e => setManualError(e.message))
  }

  const deleteManualRule = (name: string) => {
    fetch(`/api/ingress/manual/${encodeURIComponent(name)}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(list => {
        setManualRules(list)
        fetch('/api/ingress/rules').then(r => r.json()).then(setRules)
      })
      .catch(e => setManualError(e.message))
  }

  const saveSettings = () => {
    fetch('/api/ingress/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ingressSettings) })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(s => { setIngressSettings(s); setSettingsDirty(false) })
      .catch(e => setError(e.message))
  }

  const loadPreview = (type: 'caddyfile' | 'tunnel', host: string) => {
    const endpoint = type === 'caddyfile' ? `/api/ingress/preview/${encodeURIComponent(host)}` : `/api/ingress/tunnel-preview/${encodeURIComponent(host)}`
    fetch(endpoint)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setPreview({ type, host, content: d.content }))
      .catch(e => setError(e.message))
  }

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  const hostNames = [...new Set([...hosts.map(h => h.name), ...rules.map(r => r.caddy_host)])]

  return (
    <div>
      <h1 style={{ color: '#e0e0e0', marginBottom: '1rem' }}>Ingress</h1>

      {/* All Rules grouped by host */}
      <div style={cardStyle}>
        <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>All Rules</h2>
        {Object.keys(rulesByHost).length === 0 ? (
          <p style={{ color: '#8890a0', margin: 0 }}>No ingress rules found. Add containers with ingress or manual rules below.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Name</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Hostname</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Backend</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Mode</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>External</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Source</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(rulesByHost).sort(([a], [b]) => a.localeCompare(b)).map(([host, hostRules]) => (
                <Fragment key={host}>
                  <tr>
                    <td colSpan={7} style={{ padding: '0.75rem 0.75rem 0.3rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ color: '#7c9ef8', fontSize: '0.9rem', fontWeight: 600 }}>{host}</span>
                        <button style={{ ...btnSecondary, fontSize: '0.7rem', padding: '0.15rem 0.4rem' }} onClick={() => loadPreview('caddyfile', host)}>Caddyfile</button>
                        <button style={{ ...btnSecondary, fontSize: '0.7rem', padding: '0.15rem 0.4rem' }} onClick={() => loadPreview('tunnel', host)}>Tunnel</button>
                        <button
                          style={{ ...btnSecondary, fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderColor: '#22c55e', color: '#22c55e' }}
                          onClick={() => openCaddyLogs(host)}
                        >Caddy Logs</button>
                        <button
                          style={{ ...btnSecondary, fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderColor: '#f59e0b', color: '#f59e0b' }}
                          onClick={() => restartCaddy(host)}
                          disabled={restartingHost === host}
                        >{restartingHost === host ? 'Restarting...' : 'Restart Caddy'}</button>
                        {hostRules.some(r => r.external) && (
                          <>
                            <span style={{ color: '#2a2a3e' }}>|</span>
                            <button
                              style={{ ...btnSecondary, fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderColor: '#a78bfa', color: '#a78bfa' }}
                              onClick={() => openCloudflaredLogs(host)}
                            >CFD Logs</button>
                            <button
                              style={{ ...btnSecondary, fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderColor: '#fb923c', color: '#fb923c' }}
                              onClick={() => restartCloudflared(host)}
                              disabled={restartingCfdHost === host}
                            >{restartingCfdHost === host ? 'Restarting...' : 'Restart CFD'}</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {hostRules.map((r, i) => (
                    <tr key={`${host}-${r.name}-${i}`} style={{ borderBottom: '1px solid #1a1a2e' }}>
                      <td style={{ color: '#e0e0e0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', fontWeight: 600 }}>{r.name}</td>
                      <td style={{ color: '#7c9ef8', padding: '0.4rem 0.75rem', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.hostname}</td>
                      <td style={{ color: '#b0b8d0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.backend}</td>
                      <td style={{ padding: '0.4rem 0.75rem' }}>
                        <span style={{
                          fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                          background: r.ingress_mode === 'caddy' ? 'rgba(124,158,248,0.15)' : r.ingress_mode === 'manual' ? 'rgba(249,115,22,0.15)' : 'rgba(136,144,160,0.15)',
                          color: r.ingress_mode === 'caddy' ? '#7c9ef8' : r.ingress_mode === 'manual' ? '#f97316' : '#8890a0',
                        }}>{r.ingress_mode}</span>
                      </td>
                      <td style={{ padding: '0.4rem 0.75rem', color: r.external ? '#f59e0b' : '#8890a0', fontSize: '0.85rem' }}>
                        {r.external ? 'yes' : 'no'}
                      </td>
                      <td style={{ padding: '0.4rem 0.75rem' }}>
                        <span style={{
                          fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                          background: r.source === 'container' ? 'rgba(124,158,248,0.15)' : 'rgba(136,144,160,0.15)',
                          color: r.source === 'container' ? '#7c9ef8' : '#8890a0',
                        }}>{r.source}</span>
                      </td>
                      <td style={{ padding: '0.4rem 0.75rem' }}>
                        <span style={{
                          fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                          background: r.enabled ? '#166534' : '#7f1d1d',
                          color: r.enabled ? '#86efac' : '#fca5a5',
                        }}>{r.enabled ? 'enabled' : 'disabled'}</span>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Preview */}
      {preview && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>
              {preview.type === 'caddyfile' ? 'Caddyfile' : 'Tunnel Config'}: {preview.host}
            </h2>
            <button style={btnSecondary} onClick={() => setPreview(null)}>Close</button>
          </div>
          <pre style={{
            background: '#0f0f1a', color: '#b0b8d0', padding: '1rem', borderRadius: '4px',
            fontSize: '0.8rem', overflow: 'auto', maxHeight: '300px', margin: 0,
          }}>{preview.content || '(empty — no rules for this host)'}</pre>
        </div>
      )}

      {/* Caddy Logs */}
      {caddyLogHost && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>
              Caddy Logs: <span style={{ color: '#7c9ef8' }}>{caddyLogHost}</span>
            </h2>
            <button style={btnSecondary} onClick={closeCaddyLogs}>Close</button>
          </div>
          <div style={{
            background: '#0a0a14', border: '1px solid #2a2a3e', borderRadius: '4px',
            padding: '0.75rem', maxHeight: '400px', overflow: 'auto',
            fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.5,
          }}>
            {caddyLogLines.length === 0 ? (
              <span style={{ color: '#6b7280' }}>Connecting...</span>
            ) : (
              caddyLogLines.map((line, i) => (
                <div key={i} style={{ color: '#c8d0e0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>
              ))
            )}
            <div ref={caddyLogEndRef} />
          </div>
        </div>
      )}

      {/* Cloudflared Logs */}
      {cfdLogHost && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>
              Cloudflared Logs: <span style={{ color: '#a78bfa' }}>{cfdLogHost}</span>
            </h2>
            <button style={btnSecondary} onClick={closeCloudflaredLogs}>Close</button>
          </div>
          <div style={{
            background: '#0a0a14', border: '1px solid #2a2a3e', borderRadius: '4px',
            padding: '0.75rem', maxHeight: '400px', overflow: 'auto',
            fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.5,
          }}>
            {cfdLogLines.length === 0 ? (
              <span style={{ color: '#6b7280' }}>Connecting...</span>
            ) : (
              cfdLogLines.map((line, i) => (
                <div key={i} style={{ color: '#c8d0e0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>
              ))
            )}
            <div ref={cfdLogEndRef} />
          </div>
        </div>
      )}

      {/* Manual Rules */}
      <div style={cardStyle}>
        <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Manual Proxy Rules</h2>
        {manualError && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0 0 0.5rem 0' }}>{manualError}</p>}

        {/* Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto auto', gap: '0.5rem', marginBottom: '1rem', alignItems: 'end' }}>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Name</label>
            <input
              style={inputStyle}
              placeholder="proxmox-ui"
              value={manualForm.name}
              onChange={e => setManualForm({ ...manualForm, name: e.target.value })}
              disabled={!!editingManual}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Hostname</label>
            <input
              style={inputStyle}
              placeholder="pve.example.com"
              value={manualForm.hostname}
              onChange={e => setManualForm({ ...manualForm, hostname: e.target.value })}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Backend URL</label>
            <input
              style={inputStyle}
              placeholder="https://10.0.0.5:8006"
              value={manualForm.backend}
              onChange={e => setManualForm({ ...manualForm, backend: e.target.value })}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Caddy Host</label>
            <select
              style={selectStyle}
              value={manualForm.caddy_host}
              onChange={e => setManualForm({ ...manualForm, caddy_host: e.target.value })}
            >
              <option value="">Select host...</option>
              {hostNames.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>External</label>
            <label style={{ color: '#e0e0e0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem', height: '32px' }}>
              <input
                type="checkbox"
                checked={manualForm.external}
                onChange={e => setManualForm({ ...manualForm, external: e.target.checked })}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'end' }}>
            <button style={btnPrimary} onClick={saveManualRule}>
              {editingManual ? 'Update' : 'Add'}
            </button>
            {editingManual && (
              <button style={btnSecondary} onClick={() => { setEditingManual(null); setManualForm({ ...emptyManual }) }}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* List */}
        {manualRules.length === 0 ? (
          <p style={{ color: '#8890a0', margin: 0, fontSize: '0.85rem' }}>No manual proxy rules. Use the form above to add one.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Name</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Hostname</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Backend</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Caddy Host</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>External</th>
                <th style={{ textAlign: 'right', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {manualRules.map(r => (
                <tr key={r.name} style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <td style={{ color: '#e0e0e0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', fontWeight: 600 }}>{r.name}</td>
                  <td style={{ color: '#7c9ef8', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>{r.hostname}</td>
                  <td style={{ color: '#b0b8d0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>{r.backend}</td>
                  <td style={{ color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>{r.caddy_host}</td>
                  <td style={{ color: r.external ? '#f59e0b' : '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>{r.external ? 'yes' : 'no'}</td>
                  <td style={{ textAlign: 'right', padding: '0.4rem 0.75rem' }}>
                    <button
                      style={{ ...btnSecondary, marginRight: '0.35rem', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      onClick={() => { setEditingManual(r); setManualForm({ ...r }) }}
                    >Edit</button>
                    <button
                      style={{ ...btnDanger, fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      onClick={() => deleteManualRule(r.name)}
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Settings */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>
            Settings
            {settingsDirty && <span style={{ color: '#f59e0b', fontSize: '0.7rem', marginLeft: '0.5rem' }}>unsaved</span>}
          </h2>
          <button style={btnPrimary} onClick={saveSettings} disabled={!settingsDirty}>Save Settings</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Wildcard Domain</label>
            <input
              style={inputStyle}
              placeholder="*.example.com"
              value={ingressSettings.wildcard_domain}
              onChange={e => { setIngressSettings({ ...ingressSettings, wildcard_domain: e.target.value }); setSettingsDirty(true) }}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>ACME Email</label>
            <input
              style={inputStyle}
              placeholder="you@example.com"
              value={ingressSettings.acme_email}
              onChange={e => { setIngressSettings({ ...ingressSettings, acme_email: e.target.value }); setSettingsDirty(true) }}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Cloudflare API Token Secret</label>
            <input
              style={inputStyle}
              placeholder="cloudflare/api_token"
              value={ingressSettings.cloudflare_api_token_secret}
              onChange={e => { setIngressSettings({ ...ingressSettings, cloudflare_api_token_secret: e.target.value }); setSettingsDirty(true) }}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Cloudflare Account ID</label>
            <input
              style={inputStyle}
              placeholder="auto-detected from API token"
              value={ingressSettings.cloudflare_account_id}
              onChange={e => { setIngressSettings({ ...ingressSettings, cloudflare_account_id: e.target.value }); setSettingsDirty(true) }}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Docker Network</label>
            <input
              style={inputStyle}
              placeholder="backend"
              value={ingressSettings.docker_network}
              onChange={e => { setIngressSettings({ ...ingressSettings, docker_network: e.target.value }); setSettingsDirty(true) }}
            />
          </div>
        </div>

        {/* Tunnel Token Overrides — collapsed by default, only needed for manual tunnel management */}
        {(() => {
          const hasOverrides = ingressSettings.tunnel_token_secret || Object.keys(ingressSettings.tunnel_tokens || {}).length > 0
          const externalHosts = [...new Set([
            ...rules.filter(r => r.external).map(r => r.caddy_host),
            ...manualRules.filter(r => r.external).map(r => r.caddy_host),
          ])].filter(Boolean).sort()
          if (!hasOverrides && externalHosts.length === 0) return null
          return (
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }}>
                Tunnel Token Overrides
                <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: '0.5rem' }}>
                  (optional -- tunnels are auto-provisioned when a CF API token is set)
                </span>
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.35rem 0.75rem', alignItems: 'center', marginTop: '0.5rem' }}>
                <span style={{ color: '#8890a0', fontSize: '0.8rem' }}>Default</span>
                <input
                  style={inputStyle}
                  placeholder="leave empty for auto-provisioning"
                  value={ingressSettings.tunnel_token_secret}
                  onChange={e => { setIngressSettings({ ...ingressSettings, tunnel_token_secret: e.target.value }); setSettingsDirty(true) }}
                />
                {externalHosts.map(host => (
                  <Fragment key={host}>
                    <span style={{ color: '#e0e0e0', fontSize: '0.8rem' }}>{host}</span>
                    <input
                      style={inputStyle}
                      placeholder="auto-provisioned"
                      value={(ingressSettings.tunnel_tokens || {})[host] || ''}
                      onChange={e => {
                        const tokens = { ...(ingressSettings.tunnel_tokens || {}) }
                        if (e.target.value) tokens[host] = e.target.value
                        else delete tokens[host]
                        setIngressSettings({ ...ingressSettings, tunnel_tokens: tokens })
                        setSettingsDirty(true)
                      }}
                    />
                  </Fragment>
                ))}
              </div>
            </details>
          )
        })()}
      </div>
    </div>
  )
}
