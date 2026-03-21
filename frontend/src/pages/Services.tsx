import { useEffect, useState } from 'react'

interface PortMapping { host: number; container: number }
interface VolumeMount { host_path: string; container_path: string; backup: boolean }
interface IngressConfig { hostname: string; backend_port: number }
interface DNSConfig { hostname: string; ip: string }

interface MoveStep { name: string; status: string; detail: string }
interface MoveResultData { service: string; from_host: string; to_host: string; steps: MoveStep[] }

interface Service {
  name: string
  enabled: boolean
  host: string
  image: string
  network: string | null
  ports: PortMapping[]
  volumes: VolumeMount[]
  ingress: IngressConfig | null
  dns: DNSConfig | null
  secrets: string[]
  env: Record<string, string>
}

const inputStyle: React.CSSProperties = {
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  color: '#e0e0e0',
  borderRadius: '4px',
  padding: '0.4rem 0.6rem',
  fontSize: '0.85rem',
  width: '100%',
}

const labelStyle: React.CSSProperties = {
  color: '#8890a0',
  fontSize: '0.75rem',
  marginBottom: '0.25rem',
  display: 'block',
}

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

const btnDanger: React.CSSProperties = {
  background: '#ef4444',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  padding: '0.4rem 0.8rem',
  cursor: 'pointer',
  fontSize: '0.85rem',
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

interface FormData {
  name: string
  host: string
  image: string
  network: string
  enabled: boolean
  port_host: string
  port_container: string
  vol_host: string
  vol_container: string
  vol_backup: boolean
  ingress_hostname: string
  ingress_port: string
  dns_hostname: string
  dns_ip: string
  env_text: string
  secrets_text: string
}

const emptyForm: FormData = {
  name: '', host: '', image: '', network: '', enabled: true,
  port_host: '', port_container: '',
  vol_host: '', vol_container: '', vol_backup: false,
  ingress_hostname: '', ingress_port: '',
  dns_hostname: '', dns_ip: '',
  env_text: '', secrets_text: '',
}

function serviceToForm(svc: Service): FormData {
  const port = svc.ports[0]
  const vol = svc.volumes[0]
  return {
    name: svc.name,
    host: svc.host,
    image: svc.image,
    network: svc.network || '',
    enabled: svc.enabled,
    port_host: port ? String(port.host) : '',
    port_container: port ? String(port.container) : '',
    vol_host: vol ? vol.host_path : '',
    vol_container: vol ? vol.container_path : '',
    vol_backup: vol ? vol.backup : false,
    ingress_hostname: svc.ingress?.hostname || '',
    ingress_port: svc.ingress ? String(svc.ingress.backend_port) : '',
    dns_hostname: svc.dns?.hostname || '',
    dns_ip: svc.dns?.ip || '',
    env_text: Object.entries(svc.env).map(([k, v]) => `${k}=${v}`).join('\n'),
    secrets_text: svc.secrets.join('\n'),
  }
}

function formToPayload(f: FormData) {
  const payload: Record<string, unknown> = {
    name: f.name,
    host: f.host,
    image: f.image,
    enabled: f.enabled,
  }
  if (f.network) payload.network = f.network
  if (f.port_host && f.port_container) {
    payload.ports = [{ host: Number(f.port_host), container: Number(f.port_container) }]
  }
  if (f.vol_host && f.vol_container) {
    payload.volumes = [{ host_path: f.vol_host, container_path: f.vol_container, backup: f.vol_backup }]
  }
  if (f.ingress_hostname && f.ingress_port) {
    payload.ingress = { hostname: f.ingress_hostname, backend_port: Number(f.ingress_port) }
  }
  if (f.dns_hostname && f.dns_ip) {
    payload.dns = { hostname: f.dns_hostname, ip: f.dns_ip }
  }
  if (f.env_text.trim()) {
    const env: Record<string, string> = {}
    f.env_text.trim().split('\n').forEach(line => {
      const idx = line.indexOf('=')
      if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1)
    })
    payload.env = env
  }
  if (f.secrets_text.trim()) {
    payload.secrets = f.secrets_text.trim().split('\n').filter(Boolean)
  }
  return payload
}

function ServiceForm({ form, setForm, onSubmit, onCancel, submitLabel, disableName }: {
  form: FormData
  setForm: (f: FormData) => void
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  disableName?: boolean
}) {
  const set = (field: keyof FormData, value: string | boolean) =>
    setForm({ ...form, [field]: value })

  return (
    <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={form.name} disabled={disableName}
            onChange={e => set('name', e.target.value)} placeholder="immich" />
        </div>
        <div>
          <label style={labelStyle}>Host</label>
          <input style={inputStyle} value={form.host}
            onChange={e => set('host', e.target.value)} placeholder="g2mini" />
        </div>
        <div>
          <label style={labelStyle}>Image</label>
          <input style={inputStyle} value={form.image}
            onChange={e => set('image', e.target.value)} placeholder="ghcr.io/org/image:tag" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Network</label>
          <input style={inputStyle} value={form.network}
            onChange={e => set('network', e.target.value)} placeholder="immich_net" />
        </div>
        <div>
          <label style={labelStyle}>Host Port</label>
          <input style={inputStyle} value={form.port_host} type="number"
            onChange={e => set('port_host', e.target.value)} placeholder="8080" />
        </div>
        <div>
          <label style={labelStyle}>Container Port</label>
          <input style={inputStyle} value={form.port_container} type="number"
            onChange={e => set('port_container', e.target.value)} placeholder="8080" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Volume Host Path</label>
          <input style={inputStyle} value={form.vol_host}
            onChange={e => set('vol_host', e.target.value)} placeholder="/var/docker_vols/svc/config" />
        </div>
        <div>
          <label style={labelStyle}>Volume Container Path</label>
          <input style={inputStyle} value={form.vol_container}
            onChange={e => set('vol_container', e.target.value)} placeholder="/config" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Ingress Hostname</label>
          <input style={inputStyle} value={form.ingress_hostname}
            onChange={e => set('ingress_hostname', e.target.value)} placeholder="svc.cbf.nz" />
        </div>
        <div>
          <label style={labelStyle}>Ingress Port</label>
          <input style={inputStyle} value={form.ingress_port} type="number"
            onChange={e => set('ingress_port', e.target.value)} placeholder="8080" />
        </div>
        <div>
          <label style={labelStyle}>DNS Hostname</label>
          <input style={inputStyle} value={form.dns_hostname}
            onChange={e => set('dns_hostname', e.target.value)} placeholder="svc.cbf.nz" />
        </div>
        <div>
          <label style={labelStyle}>DNS IP</label>
          <input style={inputStyle} value={form.dns_ip}
            onChange={e => set('dns_ip', e.target.value)} placeholder="10.0.2.22" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Env vars (KEY=VALUE per line)</label>
          <textarea style={{ ...inputStyle, minHeight: '3rem', resize: 'vertical' }} value={form.env_text}
            onChange={e => set('env_text', e.target.value)} placeholder="TZ=Pacific/Auckland" />
        </div>
        <div>
          <label style={labelStyle}>Secrets (one per line)</label>
          <textarea style={{ ...inputStyle, minHeight: '3rem', resize: 'vertical' }} value={form.secrets_text}
            onChange={e => set('secrets_text', e.target.value)} placeholder="DB_PASSWORD" />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <label style={{ color: '#8890a0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={form.enabled}
            onChange={e => set('enabled', e.target.checked)} />
          Enabled
        </label>
        <label style={{ color: '#8890a0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={form.vol_backup}
            onChange={e => set('vol_backup', e.target.checked)} />
          Backup volume
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button style={btnSecondary} onClick={onCancel}>Cancel</button>
          <button style={btnPrimary} onClick={onSubmit}>{submitLabel}</button>
        </div>
      </div>
    </div>
  )
}

export default function Services() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<FormData>(emptyForm)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormData>(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [movingName, setMovingName] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [moveResult, setMoveResult] = useState<MoveResultData | null>(null)
  const [moveLoading, setMoveLoading] = useState(false)

  function loadServices() {
    fetch('/api/services/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setServices)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadServices() }, [])

  async function handleCreate() {
    try {
      const r = await fetch('/api/services/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPayload(addForm)),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setShowAdd(false)
      setAddForm(emptyForm)
      loadServices()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleUpdate(name: string) {
    try {
      const payload = formToPayload(editForm)
      delete payload.name
      const r = await fetch(`/api/services/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setEditingName(null)
      loadServices()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDelete(name: string) {
    try {
      const r = await fetch(`/api/services/${name}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setDeleteConfirm(null)
      loadServices()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleMove(name: string) {
    setMoveLoading(true)
    setMoveResult(null)
    try {
      const r = await fetch(`/api/services/${name}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_host: moveTarget }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      const result = await r.json()
      setMoveResult(result)
      loadServices()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setMoveLoading(false)
    }
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Services</h1>
        {!showAdd && (
          <button style={btnPrimary} onClick={() => { setShowAdd(true); setAddForm(emptyForm) }}>
            Add Service
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button style={{ ...btnSecondary, border: 'none', color: '#fca5a5' }} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {showAdd && (
        <ServiceForm
          form={addForm}
          setForm={setAddForm}
          onSubmit={handleCreate}
          onCancel={() => setShowAdd(false)}
          submitLabel="Create"
        />
      )}

      {services.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No services defined yet.</p>
      )}

      {services.map(svc => (
        <div key={svc.name} style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
          {editingName === svc.name ? (
            <ServiceForm
              form={editForm}
              setForm={setEditForm}
              onSubmit={() => handleUpdate(svc.name)}
              onCancel={() => setEditingName(null)}
              submitLabel="Save"
              disableName
            />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '1rem' }}>{svc.name}</span>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '9999px',
                      background: svc.enabled ? '#166534' : '#7f1d1d',
                      color: svc.enabled ? '#86efac' : '#fca5a5',
                    }}>
                      {svc.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </div>
                  <div style={{ color: '#8890a0', fontSize: '0.85rem', lineHeight: 1.6 }}>
                    <span>Host: <strong style={{ color: '#b0b8d0' }}>{svc.host}</strong></span>
                    <span style={{ margin: '0 0.75rem' }}>|</span>
                    <span>Image: <strong style={{ color: '#b0b8d0' }}>{svc.image.length > 50 ? svc.image.slice(0, 50) + '...' : svc.image}</strong></span>
                    {svc.ingress && (
                      <>
                        <span style={{ margin: '0 0.75rem' }}>|</span>
                        <span style={{ color: '#7c9ef8' }}>{svc.ingress.hostname}</span>
                      </>
                    )}
                    {svc.ports.length > 0 && (
                      <>
                        <span style={{ margin: '0 0.75rem' }}>|</span>
                        <span>Port: {svc.ports.map(p => `${p.host}:${p.container}`).join(', ')}</span>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                  {deleteConfirm === svc.name ? (
                    <>
                      <span style={{ color: '#fca5a5', fontSize: '0.85rem', alignSelf: 'center' }}>Delete?</span>
                      <button style={btnDanger} onClick={() => handleDelete(svc.name)}>Confirm</button>
                      <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button style={btnSecondary} onClick={() => {
                        setEditingName(svc.name)
                        setEditForm(serviceToForm(svc))
                      }}>Edit</button>
                      <button style={{ ...btnSecondary, borderColor: '#7c9ef8', color: '#7c9ef8' }}
                        onClick={() => { setMovingName(svc.name); setMoveTarget(''); setMoveResult(null) }}>Move</button>
                      <button style={{ ...btnSecondary, borderColor: '#ef4444', color: '#ef4444' }}
                        onClick={() => setDeleteConfirm(svc.name)}>Delete</button>
                    </>
                  )}
                </div>
              </div>

              {movingName === svc.name && (
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2a2a3e' }}>
                  {moveResult ? (
                    <div>
                      <div style={{ color: '#e0e0e0', fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: 600 }}>
                        Move complete: {moveResult.from_host} → {moveResult.to_host}
                      </div>
                      {moveResult.steps.map((step, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                          <span style={{
                            fontSize: '0.65rem',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '9999px',
                            background: step.status === 'done' ? '#166534' : step.status === 'skipped' ? '#44403c' : '#7f1d1d',
                            color: step.status === 'done' ? '#86efac' : step.status === 'skipped' ? '#a8a29e' : '#fca5a5',
                          }}>
                            {step.status}
                          </span>
                          <span style={{ color: '#b0b8d0' }}>{step.name}</span>
                          <span style={{ color: '#8890a0' }}>{step.detail}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: '0.5rem' }}>
                        <button style={btnSecondary} onClick={() => setMovingName(null)}>Close</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ color: '#8890a0', fontSize: '0.85rem' }}>
                        Current host: <strong style={{ color: '#b0b8d0' }}>{svc.host}</strong>
                      </span>
                      <input
                        style={{ ...inputStyle, width: '12rem' }}
                        value={moveTarget}
                        onChange={e => setMoveTarget(e.target.value)}
                        placeholder="Target host..."
                      />
                      <button
                        style={btnPrimary}
                        disabled={!moveTarget || moveLoading}
                        onClick={() => handleMove(svc.name)}
                      >
                        {moveLoading ? 'Moving...' : 'Start Move'}
                      </button>
                      <button style={btnSecondary} onClick={() => setMovingName(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}
