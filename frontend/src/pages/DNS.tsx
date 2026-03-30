import { useEffect, useMemo, useState } from 'react'

interface DNSRecord {
  hostname: string
  ip: string
  source: 'container' | 'static' | 'ingress'
  description: string
  host: string
}

interface StaticRecord {
  hostname: string
  ip: string
  description: string
}

interface DNSSettings {
  zones: { name: string; internal: boolean; external: boolean }[]
  pihole_host: string
  pihole_config_path: string
}

interface HostOption { name: string; type: string }

const PAGE_SIZE = 10

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

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  color: '#8890a0',
  padding: '0.5rem 0.75rem',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
}

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.85rem',
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

const pageBtnStyle = (active: boolean): React.CSSProperties => ({
  background: 'none',
  border: 'none',
  color: active ? '#7c9ef8' : '#555',
  cursor: active ? 'pointer' : 'default',
  fontSize: '0.8rem',
  padding: '0.25rem 0.5rem',
})

/* ── Pagination ─────────────────────────────────────────────────────── */

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.25rem', marginTop: '0.75rem' }}>
      <button style={pageBtnStyle(page > 0)} disabled={page === 0} onClick={() => onPage(page - 1)}>Prev</button>
      <span style={{ color: '#8890a0', fontSize: '0.8rem' }}>{page + 1} / {totalPages}</span>
      <button style={pageBtnStyle(page < totalPages - 1)} disabled={page === totalPages - 1} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  )
}

/* ── Main ───────────────────────────────────────────────────────────── */

export default function DNS() {
  const [records, setRecords] = useState<DNSRecord[]>([])
  const [staticRecords, setStaticRecords] = useState<StaticRecord[]>([])
  const [dnsSettings, setDnsSettings] = useState<DNSSettings>({ zones: [], pihole_host: '', pihole_config_path: '/etc/pihole/pihole.toml' })
  const [hostOptions, setHostOptions] = useState<HostOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Static record form
  const [editingStatic, setEditingStatic] = useState<StaticRecord | null>(null)
  const [staticForm, setStaticForm] = useState<StaticRecord>({ hostname: '', ip: '', description: '' })
  const [staticError, setStaticError] = useState<string | null>(null)

  // Preview
  const [preview, setPreview] = useState<{ type: string; content: string } | null>(null)

  // Settings dirty
  const [settingsDirty, setSettingsDirty] = useState(false)

  // Pagination
  const [containerPage, setContainerPage] = useState(0)
  const [staticPage, setStaticPage] = useState(0)

  const containerRecords = useMemo(() => records.filter(r => r.source === 'container' || r.source === 'ingress'), [records])
  const containerTotalPages = Math.max(1, Math.ceil(containerRecords.length / PAGE_SIZE))
  const containerSlice = containerRecords.slice(containerPage * PAGE_SIZE, (containerPage + 1) * PAGE_SIZE)

  const staticTotalPages = Math.max(1, Math.ceil(staticRecords.length / PAGE_SIZE))
  const staticSlice = staticRecords.slice(staticPage * PAGE_SIZE, (staticPage + 1) * PAGE_SIZE)
  // We need original indices for delete-by-index
  const staticSliceStart = staticPage * PAGE_SIZE

  const fetchAll = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/dns/records').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/dns/static').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/dns/settings').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/nodes/').then(r => r.json()),
      fetch('/api/vms/').then(r => r.json()),
    ])
      .then(([rec, stat, sett, nodes, vms]) => {
        setRecords(rec)
        setStaticRecords(stat)
        setDnsSettings(sett)
        setSettingsDirty(false)
        setHostOptions([
          ...nodes.map((n: { name: string; type: string }) => ({ name: n.name, type: n.type })),
          ...vms.map((v: { name: string }) => ({ name: v.name, type: 'vm' })),
        ])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll() }, [])

  // Reset pages when data changes
  useEffect(() => { if (containerPage >= containerTotalPages) setContainerPage(0) }, [containerRecords.length])
  useEffect(() => { if (staticPage >= staticTotalPages) setStaticPage(0) }, [staticRecords.length])

  const saveStaticRecord = () => {
    setStaticError(null)
    if (!staticForm.hostname.trim()) { setStaticError('Hostname is required'); return }
    if (!staticForm.ip.trim()) { setStaticError('IP address is required'); return }
    const method = editingStatic ? 'PUT' : 'POST'
    const url = editingStatic ? `/api/dns/static/${encodeURIComponent(editingStatic.hostname)}` : '/api/dns/static'
    fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(staticForm) })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(list => {
        setStaticRecords(list)
        setEditingStatic(null)
        setStaticForm({ hostname: '', ip: '', description: '' })
        fetch('/api/dns/records').then(r => r.json()).then(setRecords)
      })
      .catch(e => setStaticError(e.message))
  }

  const deleteStaticRecord = (index: number) => {
    fetch(`/api/dns/static/by-index/${index}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(list => {
        setStaticRecords(list)
        fetch('/api/dns/records').then(r => r.json()).then(setRecords)
      })
      .catch(e => setStaticError(e.message))
  }

  const saveSettings = () => {
    fetch('/api/dns/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dnsSettings) })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(s => { setDnsSettings(s); setSettingsDirty(false) })
      .catch(e => setError(e.message))
  }

  const loadPreview = (type: 'custom-list' | 'pihole-toml') => {
    fetch(`/api/dns/preview/${type}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setPreview({ type, content: d.content }))
      .catch(e => setError(e.message))
  }

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>DNS</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button style={btnSecondary} onClick={() => loadPreview('custom-list')}>Preview custom.list</button>
          <button style={btnSecondary} onClick={() => loadPreview('pihole-toml')}>Preview pihole.toml</button>
        </div>
      </div>

      {/* Preview modal */}
      {preview && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>Preview: {preview.type}</h2>
            <button style={btnSecondary} onClick={() => setPreview(null)}>Close</button>
          </div>
          <pre style={{
            background: '#0f0f1a',
            color: '#b0b8d0',
            padding: '1rem',
            borderRadius: '4px',
            fontSize: '0.8rem',
            overflow: 'auto',
            maxHeight: '300px',
            margin: 0,
          }}>{preview.content || '(empty)'}</pre>
        </div>
      )}

      {/* Derived Records (containers + ingress) */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: 0 }}>
            Derived Records
            <span style={{ color: '#8890a0', fontWeight: 400, fontSize: '0.8rem', marginLeft: '0.5rem' }}>({containerRecords.length})</span>
          </h2>
        </div>
        {containerRecords.length === 0 ? (
          <p style={{ color: '#8890a0', margin: 0 }}>No derived DNS records. Add containers with DNS names or ingress proxy rules to generate records.</p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                  <th style={thStyle}>Hostname</th>
                  <th style={thStyle}>IP</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Host</th>
                  <th style={thStyle}>Description</th>
                </tr>
              </thead>
              <tbody>
                {containerSlice.map((r, i) => (
                  <tr key={`${r.hostname}-${r.ip}-${i}`} style={{ borderBottom: '1px solid #1f1f35' }}>
                    <td style={{ ...tdStyle, color: '#e0e0e0' }}>{r.hostname}</td>
                    <td style={{ ...tdStyle, color: '#b0b8d0', fontFamily: 'monospace' }}>{r.ip}</td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                        background: r.source === 'ingress' ? 'rgba(245,158,11,0.15)' : 'rgba(124,158,248,0.15)',
                        color: r.source === 'ingress' ? '#f59e0b' : '#7c9ef8',
                      }}>{r.source}</span>
                    </td>
                    <td style={{ ...tdStyle, color: '#8890a0' }}>{r.host || '—'}</td>
                    <td style={{ ...tdStyle, color: '#8890a0' }}>{r.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={containerPage} totalPages={containerTotalPages} onPage={setContainerPage} />
          </>
        )}
      </div>

      {/* Static Records */}
      <div style={cardStyle}>
        <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>
          Static Records
          <span style={{ color: '#8890a0', fontWeight: 400, fontSize: '0.8rem', marginLeft: '0.5rem' }}>({staticRecords.length})</span>
        </h2>
        {staticError && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0 0 0.5rem 0' }}>{staticError}</p>}

        {/* Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.75rem', marginBottom: '1rem', alignItems: 'end' }}>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Hostname</label>
            <input
              style={inputStyle}
              placeholder="app.example.com"
              value={staticForm.hostname}
              onChange={e => setStaticForm({ ...staticForm, hostname: e.target.value })}
              disabled={!!editingStatic}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>IP Address</label>
            <input
              style={inputStyle}
              placeholder="192.168.1.100"
              value={staticForm.ip}
              onChange={e => setStaticForm({ ...staticForm, ip: e.target.value })}
            />
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Description</label>
            <input
              style={inputStyle}
              placeholder="optional"
              value={staticForm.description}
              onChange={e => setStaticForm({ ...staticForm, description: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button style={btnPrimary} onClick={saveStaticRecord}>
              {editingStatic ? 'Update' : 'Add'}
            </button>
            {editingStatic && (
              <button style={btnSecondary} onClick={() => { setEditingStatic(null); setStaticForm({ hostname: '', ip: '', description: '' }) }}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* List */}
        {staticRecords.length === 0 ? (
          <p style={{ color: '#8890a0', margin: 0, fontSize: '0.85rem' }}>No static records. Use the form above to add one.</p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                  <th style={thStyle}>Hostname</th>
                  <th style={thStyle}>IP</th>
                  <th style={thStyle}>Description</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staticSlice.map((r, i) => (
                  <tr key={`${r.hostname}-${staticSliceStart + i}`} style={{ borderBottom: '1px solid #1f1f35' }}>
                    <td style={{ ...tdStyle, color: '#e0e0e0' }}>{r.hostname || <span style={{ color: '#555' }}>(blank)</span>}</td>
                    <td style={{ ...tdStyle, color: '#b0b8d0', fontFamily: 'monospace' }}>{r.ip || <span style={{ color: '#555' }}>(blank)</span>}</td>
                    <td style={{ ...tdStyle, color: '#8890a0' }}>{r.description || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button
                        style={{ ...btnSecondary, marginRight: '0.35rem', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                        onClick={() => { setEditingStatic(r); setStaticForm({ ...r }) }}
                      >Edit</button>
                      <button
                        style={{ ...btnDanger, fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                        onClick={() => deleteStaticRecord(staticSliceStart + i)}
                      >Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={staticPage} totalPages={staticTotalPages} onPage={setStaticPage} />
          </>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Pi-hole Host</label>
            <select
              style={inputStyle}
              value={dnsSettings.pihole_host}
              onChange={e => { setDnsSettings({ ...dnsSettings, pihole_host: e.target.value }); setSettingsDirty(true) }}
            >
              <option value="">Select host...</option>
              {hostOptions.map(h => (
                <option key={h.name} value={h.name}>{h.name} ({h.type})</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Pi-hole Config Path</label>
            <input
              style={inputStyle}
              value={dnsSettings.pihole_config_path}
              onChange={e => { setDnsSettings({ ...dnsSettings, pihole_config_path: e.target.value }); setSettingsDirty(true) }}
            />
          </div>
        </div>

        {/* Zones */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <label style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase' }}>Zones</label>
            <button
              style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
              onClick={() => {
                setDnsSettings({ ...dnsSettings, zones: [...dnsSettings.zones, { name: '', internal: true, external: false }] })
                setSettingsDirty(true)
              }}
            >+ Add Zone</button>
          </div>
          {dnsSettings.zones.length === 0 ? (
            <p style={{ color: '#8890a0', margin: 0, fontSize: '0.85rem' }}>No zones configured.</p>
          ) : (
            dnsSettings.zones.map((zone, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="example.com"
                  value={zone.name}
                  onChange={e => {
                    const zones = [...dnsSettings.zones]
                    zones[i] = { ...zones[i], name: e.target.value }
                    setDnsSettings({ ...dnsSettings, zones })
                    setSettingsDirty(true)
                  }}
                />
                <label style={{ color: '#8890a0', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={zone.internal}
                    onChange={e => {
                      const zones = [...dnsSettings.zones]
                      zones[i] = { ...zones[i], internal: e.target.checked }
                      setDnsSettings({ ...dnsSettings, zones })
                      setSettingsDirty(true)
                    }}
                  /> Internal
                </label>
                <label style={{ color: '#8890a0', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={zone.external}
                    onChange={e => {
                      const zones = [...dnsSettings.zones]
                      zones[i] = { ...zones[i], external: e.target.checked }
                      setDnsSettings({ ...dnsSettings, zones })
                      setSettingsDirty(true)
                    }}
                  /> External
                </label>
                <button
                  style={{ ...btnDanger, fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                  onClick={() => {
                    const zones = dnsSettings.zones.filter((_, j) => j !== i)
                    setDnsSettings({ ...dnsSettings, zones })
                    setSettingsDirty(true)
                  }}
                >X</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
