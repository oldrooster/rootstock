import { useEffect, useRef, useState } from 'react'
import jsYaml from 'js-yaml'
import Terminal from '../components/Terminal'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'

interface PortMapping { host: number; container: number }
interface VolumeMount { host_path: string; container_path: string; backup: boolean; backup_exclusions: string[] }

interface Container {
  name: string
  enabled: boolean
  image: string
  hosts: string[]
  host_rule: string
  dns_name: string
  ingress_mode: string
  ingress_port: number
  external: boolean
  ports: PortMapping[]
  volumes: VolumeMount[]
  env: Record<string, string>
  devices: string[]
  compose_extras: Record<string, unknown>
  network: string | null
  build_repo: string
  build_branch: string
  build_dockerfile: string
  build_context: string
}

interface HostOption {
  name: string
  type: string
}

const inputStyle: React.CSSProperties = {
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  color: '#e0e0e0',
  borderRadius: '4px',
  padding: '0.4rem 0.6rem',
  fontSize: '0.85rem',
  width: '100%',
  boxSizing: 'border-box',
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

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  color: '#e0e0e0',
  padding: '0.4rem 0.75rem',
  fontSize: '0.85rem',
  cursor: 'pointer',
}

/* ── Form ─────────────────────────────────────────────────────────────── */

interface FormVolume {
  host_path: string
  container_path: string
  backup: boolean
  backup_exclusions: string[]
}

interface FormData {
  name: string
  image: string
  enabled: boolean
  hosts: string
  host_rule: string
  dns_name: string
  ingress_mode: string
  ingress_port: string
  external: boolean
  network: string
  ports_text: string
  volumes: FormVolume[]
  env_text: string
  devices_text: string
  compose_extras_text: string
  build_repo: string
  build_branch: string
  build_dockerfile: string
  build_context: string
}

const emptyForm: FormData = {
  name: '', image: '', enabled: true,
  hosts: '', host_rule: '',
  dns_name: '', ingress_mode: 'none', ingress_port: '', external: false,
  network: 'backend',
  ports_text: '', volumes: [], env_text: '',
  devices_text: '',
  compose_extras_text: '',
  build_repo: '', build_branch: 'main', build_dockerfile: 'Dockerfile', build_context: '.',
}

function containerToForm(c: Container): FormData {
  return {
    name: c.name,
    image: c.image,
    enabled: c.enabled,
    hosts: (c.hosts || []).join(', '),
    host_rule: c.host_rule || '',
    dns_name: c.dns_name || '',
    ingress_mode: c.ingress_mode || 'none',
    ingress_port: c.ingress_port ? String(c.ingress_port) : '',
    external: c.external || false,
    network: c.network || '',
    ports_text: (c.ports || []).map(p => `${p.host}:${p.container}`).join('\n'),
    volumes: (c.volumes || []).map(v => ({
      host_path: v.host_path,
      container_path: v.container_path,
      backup: v.backup,
      backup_exclusions: v.backup_exclusions || [],
    })),
    env_text: Object.entries(c.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    devices_text: (c.devices || []).join('\n'),
    compose_extras_text: c.compose_extras && Object.keys(c.compose_extras).length > 0
      ? JSON.stringify(c.compose_extras, null, 2) : '',
    build_repo: c.build_repo || '',
    build_branch: c.build_branch || 'main',
    build_dockerfile: c.build_dockerfile || 'Dockerfile',
    build_context: c.build_context || '.',
  }
}

function formToPayload(f: FormData) {
  const payload: Record<string, unknown> = {
    name: f.name,
    image: f.image,
    enabled: f.enabled,
    hosts: f.hosts.split(',').map(s => s.trim()).filter(Boolean),
    host_rule: f.host_rule,
    dns_name: f.dns_name,
    ingress_mode: f.ingress_mode,
    ingress_port: f.ingress_port ? Number(f.ingress_port) : 0,
    external: f.external,
  }

  if (f.network) payload.network = f.network

  if (f.ports_text.trim()) {
    payload.ports = f.ports_text.trim().split('\n').filter(Boolean).map(line => {
      const [h, c] = line.split(':')
      return { host: Number(h), container: Number(c) }
    })
  } else {
    payload.ports = []
  }

  payload.volumes = f.volumes.map(v => ({
    host_path: v.host_path,
    container_path: v.container_path,
    backup: v.backup,
    backup_exclusions: v.backup_exclusions.filter(Boolean),
  }))

  if (f.env_text.trim()) {
    const env: Record<string, string> = {}
    f.env_text.trim().split('\n').forEach(line => {
      const idx = line.indexOf('=')
      if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1)
    })
    payload.env = env
  } else {
    payload.env = {}
  }


  if (f.devices_text.trim()) {
    payload.devices = f.devices_text.trim().split('\n').map(l => l.trim()).filter(Boolean)
  } else {
    payload.devices = []
  }

  if (f.compose_extras_text.trim()) {
    try { payload.compose_extras = JSON.parse(f.compose_extras_text) } catch { /* ignore */ }
  }

  payload.build_repo = f.build_repo
  payload.build_branch = f.build_branch
  payload.build_dockerfile = f.build_dockerfile
  payload.build_context = f.build_context

  return payload
}

/* ── Docker Compose Import Parser ─────────────────────────────────── */

function parseComposeYaml(yaml: string): Partial<FormData> & { error?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = jsYaml.load(yaml) as any
    if (!doc || typeof doc !== 'object') return { error: 'Invalid YAML' }

    // Find the services block — could be top-level services: or just a single service
    let services: Record<string, any> = {}
    if (doc.services && typeof doc.services === 'object') {
      services = doc.services
    } else if (doc.image) {
      // User pasted just a single service definition
      services = { service: doc }
    } else {
      // Maybe the whole thing is services (no wrapper)
      const keys = Object.keys(doc)
      const hasImage = keys.some(k => doc[k]?.image)
      if (hasImage) services = doc
      else return { error: 'Could not find services in YAML' }
    }

    const serviceNames = Object.keys(services)
    if (serviceNames.length === 0) return { error: 'No services found' }

    // Use the first service as the primary container
    const primaryName = serviceNames[0]
    const primary = services[primaryName]
    const result: Partial<FormData> = {}

    result.name = primaryName
    if (primary.image) result.image = primary.image

    // Ports
    if (Array.isArray(primary.ports)) {
      result.ports_text = primary.ports.map((p: string | number) => String(p)).join('\n')
    }

    // Volumes
    if (Array.isArray(primary.volumes)) {
      result.volumes = primary.volumes.map((v: string | { source: string; target: string }) => {
        if (typeof v === 'string') {
          const parts = v.split(':')
          return { host_path: parts[0], container_path: parts.slice(1).join(':'), backup: false }
        }
        if (v.source && v.target) return { host_path: v.source, container_path: v.target, backup: false }
        return null
      }).filter(Boolean) as FormVolume[]
    }

    // Environment
    if (primary.environment) {
      if (Array.isArray(primary.environment)) {
        result.env_text = primary.environment.join('\n')
      } else if (typeof primary.environment === 'object') {
        result.env_text = Object.entries(primary.environment)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      }
    }

    // Devices
    if (Array.isArray(primary.devices)) {
      result.devices_text = primary.devices.map((d: string) => String(d)).join('\n')
    }

    // Network
    if (primary.networks) {
      const nets = Array.isArray(primary.networks)
        ? primary.networks
        : Object.keys(primary.networks)
      if (nets.length > 0) result.network = nets[0]
    } else if (primary.network_mode) {
      result.network = primary.network_mode
    }

    // Sidecars (other services become compose_extras)
    if (serviceNames.length > 1) {
      const extras: Record<string, any> = {}
      for (const name of serviceNames.slice(1)) {
        extras[name] = services[name]
      }
      result.compose_extras_text = JSON.stringify(extras, null, 2)
    }

    return result
  } catch (e) {
    return { error: `YAML parse error: ${(e as Error).message}` }
  }
}

const sectionHeading: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '0.7rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.5rem',
  paddingBottom: '0.25rem',
  borderBottom: '1px solid #1f1f35',
}

/* ── Volume Editor ────────────────────────────────────────────────── */

const volRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.4rem 0.6rem',
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  borderRadius: '4px',
  fontSize: '0.85rem',
  fontFamily: 'monospace',
}

function VolumeEditor({ volumes, onChange, gap, rowGap }: {
  volumes: FormVolume[]
  onChange: (v: FormVolume[]) => void
  gap: string
  rowGap: string
}) {
  const [hostPath, setHostPath] = useState('${DOCKER_VOLS}/')
  const [containerPath, setContainerPath] = useState('')
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editHost, setEditHost] = useState('')
  const [editContainer, setEditContainer] = useState('')
  const [exclInput, setExclInput] = useState<Record<number, string>>({})

  function addExclusion(idx: number) {
    const val = (exclInput[idx] || '').trim()
    if (!val) return
    onChange(volumes.map((v, i) => i === idx ? { ...v, backup_exclusions: [...v.backup_exclusions, val] } : v))
    setExclInput({ ...exclInput, [idx]: '' })
  }

  function removeExclusion(volIdx: number, exclIdx: number) {
    onChange(volumes.map((v, i) => i === volIdx ? { ...v, backup_exclusions: v.backup_exclusions.filter((_, j) => j !== exclIdx) } : v))
  }

  function addVolume() {
    if (!hostPath.trim() || !containerPath.trim()) return
    onChange([...volumes, { host_path: hostPath.trim(), container_path: containerPath.trim(), backup: false, backup_exclusions: [] }])
    setHostPath('${DOCKER_VOLS}/')
    setContainerPath('')
  }

  function removeVolume(idx: number) {
    onChange(volumes.filter((_, i) => i !== idx))
  }

  function toggleBackup(idx: number) {
    onChange(volumes.map((v, i) => i === idx ? { ...v, backup: !v.backup } : v))
  }

  function startEdit(idx: number) {
    setEditIdx(idx)
    setEditHost(volumes[idx].host_path)
    setEditContainer(volumes[idx].container_path)
  }

  function saveEdit() {
    if (editIdx === null || !editHost.trim() || !editContainer.trim()) return
    onChange(volumes.map((v, i) => i === editIdx ? { ...v, host_path: editHost.trim(), container_path: editContainer.trim() } : v))
    setEditIdx(null)
  }

  function handleAddKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); addVolume() }
  }

  return (
    <div style={{ marginBottom: gap }}>
      {/* Add row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: gap, marginBottom: volumes.length > 0 ? rowGap : 0 }}>
        <div>
          <label style={labelStyle}>Host Path</label>
          <input style={inputStyle} value={hostPath} onChange={e => setHostPath(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="/app/config" />
        </div>
        <div style={{ display: 'flex', gap: gap, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Container Path</label>
            <input style={inputStyle} value={containerPath} onChange={e => setContainerPath(e.target.value)}
              onKeyDown={handleAddKeyDown}
              placeholder="/config" />
          </div>
          <button style={{ ...btnPrimary, padding: '0.4rem 0.75rem', whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={addVolume} disabled={!hostPath.trim() || !containerPath.trim()}>Add</button>
        </div>
      </div>

      {/* Volume list */}
      {volumes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {volumes.map((vol, idx) => (
            <div key={idx}>
              {editIdx === idx ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: gap, alignItems: 'end' }}>
                  <input style={inputStyle} value={editHost} onChange={e => setEditHost(e.target.value)} />
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'end' }}>
                    <input style={{ ...inputStyle, flex: 1 }} value={editContainer} onChange={e => setEditContainer(e.target.value)} />
                    <button style={{ ...btnPrimary, padding: '0.4rem 0.6rem', fontSize: '0.8rem', flexShrink: 0 }} onClick={saveEdit}>Save</button>
                    <button style={{ ...btnSecondary, padding: '0.4rem 0.6rem', fontSize: '0.8rem', flexShrink: 0 }} onClick={() => setEditIdx(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={volRowStyle}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', flexShrink: 0 }}>
                      <input type="checkbox" checked={vol.backup} onChange={() => toggleBackup(idx)} />
                      <span style={{ color: '#8890a0', fontSize: '0.75rem' }}>backup</span>
                    </label>
                    <span style={{ color: '#e0e0e0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {vol.host_path}<span style={{ color: '#555' }}>:</span>{vol.container_path}
                    </span>
                    <button onClick={() => startEdit(idx)}
                      style={{ background: 'none', border: 'none', color: '#7c9ef8', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0.25rem' }}>edit</button>
                    <button onClick={() => removeVolume(idx)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0.25rem' }}>remove</button>
                  </div>
                  {vol.backup && (
                    <div style={{ marginLeft: '1.6rem', marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {vol.backup_exclusions.map((excl, ei) => (
                          <span key={ei} style={{
                            fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                            background: 'rgba(248,113,113,0.1)', color: '#fca5a5',
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          }}>
                            {excl}
                            <button onClick={() => removeExclusion(idx, ei)}
                              style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '0.65rem', padding: 0, lineHeight: 1 }}>&times;</button>
                          </span>
                        ))}
                        <input
                          style={{ ...inputStyle, width: '120px', fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                          value={exclInput[idx] || ''}
                          onChange={e => setExclInput({ ...exclInput, [idx]: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExclusion(idx) } }}
                          placeholder="exclude..."
                        />
                        <button onClick={() => addExclusion(idx)}
                          disabled={!(exclInput[idx] || '').trim()}
                          style={{ background: 'none', border: 'none', color: '#7c9ef8', cursor: 'pointer', fontSize: '0.7rem', padding: 0 }}>+ add</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  fontSize: '0.75rem',
  padding: '0.2rem 0.5rem',
  borderRadius: '9999px',
  border: '1px solid',
  borderColor: active ? '#7c9ef8' : '#2a2a3e',
  background: active ? 'rgba(124,158,248,0.15)' : 'transparent',
  color: active ? '#7c9ef8' : '#8890a0',
  cursor: 'pointer',
})

function ContainerForm({ form, setForm, onSubmit, onCancel, submitLabel, disableName, hostOptions }: {
  form: FormData
  setForm: (f: FormData) => void
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  disableName?: boolean
  hostOptions: HostOption[]
}) {
  const [imageMode, setImageMode] = useState<'image' | 'build'>(form.build_repo ? 'build' : 'image')
  const [showAdvanced, setShowAdvanced] = useState(
    !!(form.env_text || form.devices_text || form.compose_extras_text)
  )
  const [showExtras, setShowExtras] = useState(!!form.compose_extras_text)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const set = (field: keyof FormData, value: string | boolean) =>
    setForm({ ...form, [field]: value })

  const selectedHosts = form.hosts.split(',').map(s => s.trim()).filter(Boolean)

  function toggleHost(name: string) {
    const current = selectedHosts.includes(name)
    const next = current ? selectedHosts.filter(h => h !== name) : [...selectedHosts, name]
    set('hosts', next.join(', '))
  }

  function handleImport() {
    setImportError(null)
    const result = parseComposeYaml(importText)
    if (result.error) {
      setImportError(result.error)
      return
    }
    const { error: _, ...fields } = result
    setForm({ ...form, ...fields } as FormData)
    setShowImport(false)
    setImportText('')
    // Auto-expand advanced if we imported env/secrets/extras
    if (fields.env_text || fields.devices_text || fields.compose_extras_text) {
      setShowAdvanced(true)
      if (fields.compose_extras_text) setShowExtras(true)
    }
  }

  const GAP = '1.25rem'        // gap between fields in a row
  const SECTION_GAP = '1.5rem' // gap between sections
  const ROW_GAP = '1rem'       // gap between rows within a section
  const PAD = '1.75rem'         // uniform form padding

  return (
    <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: PAD, marginBottom: '0.75rem' }}>

      {/* ── Import from Compose ──────────────────────────────── */}
      {!showImport ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: GAP }}>
          <button
            style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
            onClick={() => setShowImport(true)}
          >
            Import from docker-compose
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: SECTION_GAP, padding: PAD, background: '#0f0f1a', borderRadius: '4px', border: '1px solid #2a2a3e' }}>
          <label style={{ ...labelStyle, marginBottom: '0.35rem' }}>Paste docker-compose YAML</label>
          <textarea
            style={{ ...inputStyle, minHeight: '8rem', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8rem' }}
            value={importText}
            onChange={e => { setImportText(e.target.value); setImportError(null) }}
            placeholder={'services:\n  unifi:\n    image: lscr.io/linuxserver/unifi:latest\n    ports:\n      - 8443:8443\n    volumes:\n      - ./config:/config\n    environment:\n      - TZ=Pacific/Auckland'}
          />
          {importError && (
            <div style={{ color: '#fca5a5', fontSize: '0.8rem', marginTop: '0.35rem' }}>{importError}</div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: ROW_GAP }}>
            <button style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
              onClick={() => { setShowImport(false); setImportText(''); setImportError(null) }}>Cancel</button>
            <button style={{ ...btnPrimary, fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
              onClick={handleImport} disabled={!importText.trim()}>Import</button>
          </div>
        </div>
      )}

      {/* ── General ──────────────────────────────────────────── */}
      <div style={sectionHeading}>General</div>
      <div style={{ marginBottom: SECTION_GAP }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: GAP, marginBottom: ROW_GAP }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={form.name} disabled={disableName}
              onChange={e => set('name', e.target.value)} placeholder="unifi" />
          </div>
        </div>

        {/* Image source tabs */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '0.75rem' }}>
          {(['image', 'build'] as const).map((mode, i, arr) => (
            <button
              key={mode}
              style={{
                padding: '0.35rem 0.75rem', fontSize: '0.8rem', cursor: 'pointer',
                border: '1px solid #2a2a3e',
                borderLeft: i === 0 ? '1px solid #2a2a3e' : 'none',
                borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : '0',
                background: imageMode === mode ? '#2a2a3e' : 'transparent',
                color: imageMode === mode ? '#e0e0e0' : '#6b7280',
              }}
              onClick={() => {
                setImageMode(mode)
                if (mode === 'image') {
                  setForm({ ...form, build_repo: '', build_branch: 'main', build_dockerfile: 'Dockerfile', build_context: '.', image: '' })
                } else {
                  setForm({ ...form, image: '' })
                }
              }}
            >{{ image: 'Pull Image', build: 'Build from Repo' }[mode]}</button>
          ))}
        </div>

        {imageMode === 'image' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: GAP }}>
            <div>
              <label style={labelStyle}>Image</label>
              <input style={inputStyle} value={form.image}
                onChange={e => set('image', e.target.value)} placeholder="lscr.io/linuxserver/unifi-network-application:latest" />
            </div>
          </div>
        )}

        {imageMode === 'build' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: GAP, marginBottom: ROW_GAP }}>
              <div>
                <label style={labelStyle}>Repository URL</label>
                <input style={inputStyle} value={form.build_repo}
                  onChange={e => set('build_repo', e.target.value)} placeholder="https://github.com/user/repo.git" />
              </div>
              <div>
                <label style={labelStyle}>Image Tag</label>
                <input style={inputStyle} value={form.image}
                  onChange={e => set('image', e.target.value)} placeholder="my-app:latest" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: GAP }}>
              <div>
                <label style={labelStyle}>Branch</label>
                <input style={inputStyle} value={form.build_branch}
                  onChange={e => set('build_branch', e.target.value)} placeholder="main" />
              </div>
              <div>
                <label style={labelStyle}>Dockerfile</label>
                <input style={inputStyle} value={form.build_dockerfile}
                  onChange={e => set('build_dockerfile', e.target.value)} placeholder="Dockerfile" />
              </div>
              <div>
                <label style={labelStyle}>Build Context</label>
                <input style={inputStyle} value={form.build_context}
                  onChange={e => set('build_context', e.target.value)} placeholder="." />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Hosts ────────────────────────────────────────────── */}
      <div style={sectionHeading}>Hosts</div>
      <div style={{ marginBottom: SECTION_GAP }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: ROW_GAP }}>
          {hostOptions.map(h => (
            <button key={h.name} onClick={() => toggleHost(h.name)} style={chipStyle(selectedHosts.includes(h.name))}>
              {h.name} <span style={{ opacity: 0.6, fontSize: '0.65rem' }}>({h.type})</span>
            </button>
          ))}
        </div>
        <div>
          <label style={labelStyle}>Host Rule (role-based, optional)</label>
          <input style={{ ...inputStyle, maxWidth: 'calc(50% - 0.5rem)' }} value={form.host_rule}
            onChange={e => set('host_rule', e.target.value)} placeholder="role:docker" />
        </div>
      </div>

      {/* ── Networking ───────────────────────────────────────── */}
      <div style={sectionHeading}>Networking</div>
      <div style={{ marginBottom: SECTION_GAP }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: GAP, marginBottom: ROW_GAP }}>
          <div>
            <label style={labelStyle}>DNS Name</label>
            <input style={inputStyle} value={form.dns_name}
              onChange={e => set('dns_name', e.target.value)} placeholder="unifi.cbf.nz" />
          </div>
          <div>
            <label style={labelStyle}>Ingress Mode</label>
            <select style={inputStyle} value={form.ingress_mode} onChange={e => set('ingress_mode', e.target.value)}>
              <option value="none">None</option>
              <option value="caddy">Caddy (reverse proxy)</option>
              <option value="direct">Direct (no proxy)</option>
            </select>
          </div>
        </div>
        {form.ingress_mode === 'caddy' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: GAP, marginBottom: ROW_GAP }}>
            <div>
              <label style={labelStyle}>Ingress Port</label>
              <input style={inputStyle} value={form.ingress_port} type="number"
                onChange={e => set('ingress_port', e.target.value)} placeholder="8443" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.3rem' }}>
              <label style={{ color: '#8890a0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={form.external}
                  onChange={e => set('external', e.target.checked)} />
                External (Cloudflare)
              </label>
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: GAP }}>
          <div>
            <label style={labelStyle}>Network</label>
            <input style={inputStyle} value={form.network}
              onChange={e => set('network', e.target.value)} placeholder="backend" />
          </div>
          <div>
            <label style={labelStyle}>Ports (host:container per line)</label>
            <textarea style={{ ...inputStyle, minHeight: '2.2rem', resize: 'vertical', fontFamily: 'monospace' }} value={form.ports_text}
              onChange={e => set('ports_text', e.target.value)} placeholder="8443:8443&#10;3478:3478" />
          </div>
        </div>
      </div>

      {/* ── Volumes ──────────────────────────────────────────── */}
      <div style={sectionHeading}>Volumes</div>
      <VolumeEditor
        volumes={form.volumes}
        onChange={vols => setForm({ ...form, volumes: vols })}
        gap={GAP}
        rowGap={ROW_GAP}
      />

      {/* ── Advanced (collapsible) ───────────────────────────── */}
      <div
        style={{ ...sectionHeading, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        <span style={{ fontSize: '0.6rem', transition: 'transform 0.15s', transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>&#9654;</span>
        Advanced
      </div>
      {showAdvanced && (
        <div style={{ marginBottom: SECTION_GAP }}>
          <div style={{ marginBottom: ROW_GAP }}>
            <label style={labelStyle}>Environment Variables (KEY=VALUE per line)</label>
            <textarea style={{ ...inputStyle, minHeight: '5.5rem', resize: 'vertical', fontFamily: 'monospace' }} value={form.env_text}
              onChange={e => set('env_text', e.target.value)} placeholder={'TZ=Pacific/Auckland\nPUID=1000\nAPI_KEY=${secret:myapp/api_key}'} />
            <p style={{ color: '#6b7280', fontSize: '0.7rem', margin: '0.25rem 0 0 0' }}>
              Use <code style={{ color: '#c084fc' }}>{'${secret:path/to/key}'}</code> to reference secrets from the store
            </p>
          </div>
          <div style={{ marginBottom: ROW_GAP }}>
            <label style={labelStyle}>Devices (one per line, e.g. /dev/dri:/dev/dri)</label>
            <textarea style={{ ...inputStyle, minHeight: '2.5rem', resize: 'vertical', fontFamily: 'monospace' }} value={form.devices_text}
              onChange={e => set('devices_text', e.target.value)} placeholder={'/dev/dri:/dev/dri'} />
          </div>
          <div>
            <div
              style={{ color: '#6b7280', fontSize: '0.7rem', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}
              onClick={() => setShowExtras(!showExtras)}
            >
              <span style={{ fontSize: '0.6rem', transition: 'transform 0.15s', transform: showExtras ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>&#9654;</span>
              Compose Extras (sidecars)
            </div>
            {showExtras && (
              <textarea style={{ ...inputStyle, minHeight: '3rem', resize: 'vertical', fontFamily: 'monospace' }} value={form.compose_extras_text}
                onChange={e => set('compose_extras_text', e.target.value)}
                placeholder='{"mongo": {"image": "mongo:7.0", "volumes": ["${DOCKER_VOLS}/unifi/db:/data/db"]}}' />
            )}
          </div>
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: GAP, paddingTop: ROW_GAP, marginTop: ROW_GAP, borderTop: '1px solid #1f1f35' }}>
        <label style={{ color: '#8890a0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={form.enabled}
            onChange={e => set('enabled', e.target.checked)} />
          Enabled
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button style={btnSecondary} onClick={onCancel}>Cancel</button>
          <button style={btnPrimary} onClick={onSubmit}>{submitLabel}</button>
        </div>
      </div>
    </div>
  )
}

/* ── Main Page ───────────────────────────────────────────────────────── */

export default function Containers() {
  const [containers, setContainers] = useState<Container[]>([])
  const [hostOptions, setHostOptions] = useState<HostOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<FormData>(emptyForm)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormData>(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [composePreview, setComposePreview] = useState<{ host: string; yaml: string } | null>(null)

  useUnsavedChanges(showAdd || editingName !== null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ name: string; host: string; x: number; y: number } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [terminalInfo, setTerminalInfo] = useState<{ wsPath: string; title: string } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Container status: { containerName: { host: status } }
  const [statuses, setStatuses] = useState<Record<string, Record<string, string>>>({})
  const [statusLoading, setStatusLoading] = useState(false)

  // Log viewer state
  const [logInfo, setLogInfo] = useState<{ name: string; host: string } | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const logWsRef = useRef<WebSocket | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  // Host filter
  const [hostFilter, setHostFilter] = useState<string | null>(null)

  // Migration state
  interface MigrateStep { step: string; status: string; detail: string }
  const [migrateDialog, setMigrateDialog] = useState<{ name: string; sourceHost: string } | null>(null)
  const [migrateTarget, setMigrateTarget] = useState('')
  const [migrateSteps, setMigrateSteps] = useState<MigrateStep[]>([])
  const [migrateRunning, setMigrateRunning] = useState(false)
  const [migrateVolumes, setMigrateVolumes] = useState<Set<string>>(new Set())
  const migrateWsRef = useRef<WebSocket | null>(null)

  // Import state
  interface DiscoveredContainer {
    name: string; image: string; status: string
    ports: PortMapping[]; volumes: VolumeMount[]
    env: Record<string, string>; network: string | null
  }
  const [showImport, setShowImport] = useState(false)
  const [importHost, setImportHost] = useState('')
  const [discoveringCtrs, setDiscoveringCtrs] = useState(false)
  const [discoverCtrError, setDiscoverCtrError] = useState<string | null>(null)
  const [discoveredCtrs, setDiscoveredCtrs] = useState<DiscoveredContainer[]>([])
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set())
  const [importingCtrs, setImportingCtrs] = useState(false)

  function loadStatus() {
    setStatusLoading(true)
    fetch('/api/containers/status/all')
      .then(r => r.json())
      .then(setStatuses)
      .catch(() => {})
      .finally(() => setStatusLoading(false))
  }

  function loadAll() {
    Promise.all([
      fetch('/api/containers/').then(r => r.json()),
      fetch('/api/nodes/').then(r => r.json()),
      fetch('/api/vms/').then(r => r.json()),
    ]).then(([ctrs, nodes, vms]) => {
      setContainers(ctrs)
      const opts: HostOption[] = [
        ...nodes.map((n: { name: string; type: string }) => ({ name: n.name, type: n.type })),
        ...vms.map((v: { name: string }) => ({ name: v.name, type: 'vm' })),
      ]
      setHostOptions(opts)
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAll(); loadStatus() }, [])

  // Auto-scroll log viewer
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  async function dockerAction(name: string, action: string, host: string) {
    setContextMenu(null)
    setActionLoading(`${action}:${name}`)
    try {
      const r = await fetch(`/api/containers/${encodeURIComponent(name)}/action/${action}?host=${encodeURIComponent(host)}`, { method: 'POST' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActionLoading(null)
      loadStatus()
    }
  }

  function openLogs(name: string, host: string) {
    setContextMenu(null)
    // Close any existing log connection
    if (logWsRef.current) { logWsRef.current.close(); logWsRef.current = null }
    setLogLines([])
    setLogInfo({ name, host })

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/containers/${encodeURIComponent(name)}/logs?host=${encodeURIComponent(host)}`
    )
    logWsRef.current = ws

    let buffer = ''
    ws.onmessage = (e) => {
      buffer += e.data
      const parts = buffer.split('\n')
      buffer = parts.pop() || ''
      if (parts.length > 0) {
        setLogLines(prev => [...prev, ...parts])
      }
    }
    ws.onclose = () => {
      if (buffer) setLogLines(prev => [...prev, buffer])
    }
  }

  function closeLogs() {
    if (logWsRef.current) { logWsRef.current.close(); logWsRef.current = null }
    setLogInfo(null)
    setLogLines([])
  }

  function resolveVolPath(path: string) {
    return path.replace('${DOCKER_VOLS}', '/var/docker_vols')
  }

  function openMigrateDialog(name: string, sourceHost: string) {
    setContextMenu(null)
    setMigrateDialog({ name, sourceHost })
    setMigrateTarget('')
    setMigrateSteps([])
    setMigrateRunning(false)

    // Initialize volume selection — all selected except /mnt paths
    const ctr = containers.find(c => c.name === name)
    if (ctr && ctr.volumes.length > 0) {
      const selected = new Set<string>()
      for (const v of ctr.volumes) {
        const resolved = resolveVolPath(v.host_path)
        if (!resolved.startsWith('/mnt')) {
          selected.add(resolved)
        }
      }
      setMigrateVolumes(selected)
    } else {
      setMigrateVolumes(new Set())
    }
  }

  function startMigration() {
    if (!migrateDialog || !migrateTarget) return
    setMigrateRunning(true)
    setMigrateSteps([])

    const { name, sourceHost } = migrateDialog
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({
      target_host: migrateTarget,
      source_host: sourceHost,
    })
    if (migrateVolumes.size > 0) {
      params.set('volumes', Array.from(migrateVolumes).join(','))
    }
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/containers/${encodeURIComponent(name)}/migrate?${params}`
    )
    migrateWsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const step = JSON.parse(e.data) as MigrateStep
        setMigrateSteps(prev => {
          // Update existing step or append new one
          const idx = prev.findIndex(s => s.step === step.step)
          if (idx >= 0) {
            const updated = [...prev]
            updated[idx] = step
            return updated
          }
          return [...prev, step]
        })
      } catch { /* ignore non-JSON */ }
    }

    ws.onclose = () => {
      setMigrateRunning(false)
      loadAll()
      loadStatus()
    }
  }

  function closeMigrate() {
    if (migrateWsRef.current) { migrateWsRef.current.close(); migrateWsRef.current = null }
    setMigrateDialog(null)
    setMigrateSteps([])
    setMigrateRunning(false)
  }

  async function discoverContainers(hostName: string) {
    setImportHost(hostName)
    setDiscoveringCtrs(true)
    setDiscoverCtrError(null)
    setDiscoveredCtrs([])
    setSelectedImports(new Set())
    try {
      const r = await fetch(`/api/containers/discover/${encodeURIComponent(hostName)}`)
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      const ctrs: DiscoveredContainer[] = await r.json()
      setDiscoveredCtrs(ctrs)
      if (ctrs.length === 0) setDiscoverCtrError('No unmanaged containers found on this host')
      else setSelectedImports(new Set(ctrs.map(c => c.name)))
    } catch (e) {
      setDiscoverCtrError((e as Error).message)
    } finally {
      setDiscoveringCtrs(false)
    }
  }

  async function handleImportContainers() {
    if (selectedImports.size === 0 || !importHost) return
    setImportingCtrs(true)
    try {
      const toImport = discoveredCtrs.filter(c => selectedImports.has(c.name))
      for (const ctr of toImport) {
        const r = await fetch('/api/containers/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: ctr.name,
            host: importHost,
            image: ctr.image,
            ports: ctr.ports,
            volumes: ctr.volumes,
            env: ctr.env,
            network: ctr.network,
          }),
        })
        if (!r.ok) {
          const data = await r.json().catch(() => null)
          throw new Error(data?.detail || `Failed to import ${ctr.name}: HTTP ${r.status}`)
        }
      }
      setShowImport(false)
      loadAll()
      loadStatus()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImportingCtrs(false)
    }
  }

  function closeImport() {
    setShowImport(false)
    setImportHost('')
    setDiscoveredCtrs([])
    setSelectedImports(new Set())
    setDiscoverCtrError(null)
  }

  function openShell(name: string, host: string) {
    setContextMenu(null)
    setTerminalInfo({
      wsPath: `/api/containers/${encodeURIComponent(name)}/shell?host=${encodeURIComponent(host)}`,
      title: `${name} (${host})`,
    })
  }

  async function handleCreate() {
    try {
      const r = await fetch('/api/containers/', {
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
      loadAll()
    } catch (e) { setError((e as Error).message) }
  }

  async function handleUpdate(name: string) {
    try {
      const payload = formToPayload(editForm)
      delete payload.name
      const r = await fetch(`/api/containers/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setEditingName(null)
      loadAll()
    } catch (e) { setError((e as Error).message) }
  }

  async function handleDelete(name: string) {
    try {
      const r = await fetch(`/api/containers/${name}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setDeleteConfirm(null)
      loadAll()
    } catch (e) { setError((e as Error).message) }
  }

  async function showCompose(host: string) {
    try {
      const r = await fetch(`/api/containers/compose/${encodeURIComponent(host)}`)
      const data = await r.json()
      setComposePreview({ host, yaml: data.compose })
    } catch (e) { setError((e as Error).message) }
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  // Group containers by host for summary
  const hostContainers: Record<string, string[]> = {}
  for (const c of containers) {
    for (const h of c.hosts) {
      if (!hostContainers[h]) hostContainers[h] = []
      hostContainers[h].push(c.name)
    }
  }

  const ingressBadge = (mode: string): React.CSSProperties => ({
    fontSize: '0.65rem',
    padding: '0.1rem 0.4rem',
    borderRadius: '9999px',
    background: mode === 'caddy' ? '#1e3a5f' : mode === 'direct' ? '#3b1f5e' : '#1a1a2e',
    color: mode === 'caddy' ? '#7cb3f8' : mode === 'direct' ? '#c084fc' : '#8890a0',
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Containers</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
            onClick={loadStatus}
            disabled={statusLoading}
          >
            {statusLoading ? 'Checking...' : 'Refresh Status'}
          </button>
          {!showAdd && (
            <>
              <button style={btnSecondary} onClick={() => setShowImport(true)}>
                Import Container
              </button>
              <button style={btnPrimary} onClick={() => { setShowAdd(true); setAddForm(emptyForm) }}>
                Add Container
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button style={{ ...btnSecondary, border: 'none', color: '#fca5a5' }} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {showAdd && (
        <ContainerForm
          form={addForm}
          setForm={setAddForm}
          onSubmit={handleCreate}
          onCancel={() => setShowAdd(false)}
          submitLabel="Create"
          hostOptions={hostOptions}
        />
      )}

      {/* Compose preview modal */}
      {composePreview && (
        <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ color: '#e0e0e0', fontWeight: 600 }}>docker-compose.yml — {composePreview.host}</span>
            <button style={btnSecondary} onClick={() => setComposePreview(null)}>Close</button>
          </div>
          <pre style={{
            background: '#0f0f1a',
            border: '1px solid #2a2a3e',
            borderRadius: '4px',
            padding: '0.75rem',
            color: '#e0e0e0',
            fontSize: '0.8rem',
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            overflow: 'auto',
            maxHeight: '400px',
            margin: 0,
          }}>
            {composePreview.yaml}
          </pre>
        </div>
      )}

      {/* Host filter bar */}
      {containers.length > 0 && (() => {
        const allHosts = [...new Set(containers.flatMap(c => c.hosts))].sort()
        if (allHosts.length <= 1) return null
        return (
          <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase', marginRight: '0.25rem' }}>Filter:</span>
            <button
              style={{
                fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '9999px', cursor: 'pointer',
                border: '1px solid #2a2a3e',
                background: hostFilter === null ? '#7c9ef8' : 'transparent',
                color: hostFilter === null ? '#0f0f1a' : '#b0b8d0',
                fontWeight: hostFilter === null ? 600 : 400,
              }}
              onClick={() => setHostFilter(null)}
            >All ({containers.length})</button>
            {allHosts.map(h => {
              const count = containers.filter(c => c.hosts.includes(h)).length
              const active = hostFilter === h
              return (
                <button key={h}
                  style={{
                    fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '9999px', cursor: 'pointer',
                    border: '1px solid #2a2a3e',
                    background: active ? '#7c9ef8' : 'transparent',
                    color: active ? '#0f0f1a' : '#b0b8d0',
                    fontWeight: active ? 600 : 400,
                  }}
                  onClick={() => setHostFilter(active ? null : h)}
                >{h} ({count})</button>
              )
            })}
          </div>
        )
      })()}

      {containers.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No containers defined yet.</p>
      )}

      {containers.filter(ctr => !hostFilter || ctr.hosts.includes(hostFilter)).map(ctr => (
        <div key={ctr.name} style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
          {editingName === ctr.name ? (
            <ContainerForm
              form={editForm}
              setForm={setEditForm}
              onSubmit={() => handleUpdate(ctr.name)}
              onCancel={() => setEditingName(null)}
              submitLabel="Save"
              disableName
              hostOptions={hostOptions}
            />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                  <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '1rem' }}>{ctr.name}</span>
                  {(() => {
                    const hostStatuses = statuses[ctr.name]
                    let label = 'not provisioned'
                    let bg = '#1a1a2e'
                    let fg = '#8890a0'
                    if (!ctr.enabled) {
                      label = 'disabled'; bg = '#7f1d1d'; fg = '#fca5a5'
                    } else if (hostStatuses) {
                      const vals = Object.values(hostStatuses)
                      if (vals.every(v => v === 'running')) {
                        label = 'running'; bg = '#166534'; fg = '#86efac'
                      } else if (vals.some(v => v === 'running')) {
                        label = 'partial'; bg = '#78350f'; fg = '#fde68a'
                      } else if (vals.every(v => v === 'exited' || v === 'created')) {
                        label = 'stopped'; bg = '#7f1d1d'; fg = '#fca5a5'
                      } else if (vals.every(v => v === 'not found')) {
                        label = 'not provisioned'; bg = '#1a1a2e'; fg = '#8890a0'
                      } else {
                        label = vals[0]; bg = '#1a1a2e'; fg = '#8890a0'
                      }
                    } else if (statusLoading) {
                      label = '...'; bg = '#1a1a2e'; fg = '#6b7280'
                    }
                    return (
                      <span style={{
                        fontSize: '0.7rem', padding: '0.15rem 0.5rem',
                        borderRadius: '9999px', background: bg, color: fg,
                        border: bg === '#1a1a2e' ? '1px solid #2a2a3e' : 'none',
                      }}>{label}</span>
                    )
                  })()}
                  {ctr.ingress_mode !== 'none' && (
                    <span style={ingressBadge(ctr.ingress_mode)}>{ctr.ingress_mode}</span>
                  )}
                  {ctr.external && (
                    <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', background: '#78350f', color: '#fde68a' }}>
                      external
                    </span>
                  )}
                  {actionLoading && actionLoading.endsWith(`:${ctr.name}`) && (
                    <span style={{ color: '#f59e0b', fontSize: '0.7rem' }}>
                      {actionLoading.split(':')[0]}...
                    </span>
                  )}
                </div>
                <div style={{ color: '#8890a0', fontSize: '0.85rem', lineHeight: 1.6 }}>
                  <span>Image: <strong style={{ color: '#b0b8d0' }}>{ctr.image.length > 60 ? ctr.image.slice(0, 60) + '...' : ctr.image}</strong></span>
                  {ctr.hosts.length > 0 && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span>Hosts: {ctr.hosts.map(h => (
                        <button key={h} onClick={() => showCompose(h)} style={{
                          background: 'rgba(124,158,248,0.1)',
                          border: 'none',
                          color: '#7c9ef8',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          padding: '0.1rem 0.35rem',
                          borderRadius: '3px',
                          marginRight: '0.25rem',
                          textDecoration: 'underline',
                        }}>{h}</button>
                      ))}</span>
                    </>
                  )}
                  {ctr.host_rule && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span>Rule: <strong style={{ color: '#c084fc' }}>{ctr.host_rule}</strong></span>
                    </>
                  )}
                  {ctr.dns_name && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span style={{ color: '#7c9ef8' }}>{ctr.dns_name}</span>
                    </>
                  )}
                  {ctr.ports.length > 0 && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span>Ports: {ctr.ports.map(p => `${p.host}:${p.container}`).join(', ')}</span>
                    </>
                  )}
                  {Object.keys(ctr.compose_extras || {}).length > 0 && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span>Sidecars: {Object.keys(ctr.compose_extras).join(', ')}</span>
                    </>
                  )}
                  {ctr.build_repo && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span style={{ color: '#a78bfa' }}>Build: {ctr.build_repo.replace(/.*\//, '').replace(/\.git$/, '')}</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                {deleteConfirm === ctr.name ? (
                  <>
                    <span style={{ color: '#fca5a5', fontSize: '0.85rem', alignSelf: 'center' }}>Delete?</span>
                    <button style={btnDanger} onClick={() => handleDelete(ctr.name)}>Confirm</button>
                    <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    {ctr.enabled && ctr.hosts.length > 0 && (
                      <div style={{ position: 'relative' }}>
                        <button
                          style={{ ...btnSecondary, fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
                          onClick={(e) => {
                            const rect = (e.target as HTMLElement).getBoundingClientRect()
                            if (ctr.hosts.length === 1) {
                              setContextMenu({ name: ctr.name, host: ctr.hosts[0], x: rect.right, y: rect.bottom })
                            } else {
                              setContextMenu({ name: ctr.name, host: '', x: rect.right, y: rect.bottom })
                            }
                          }}
                        >
                          Actions
                        </button>
                      </div>
                    )}
                    <button style={btnSecondary} onClick={() => {
                      setEditingName(ctr.name)
                      setEditForm(containerToForm(ctr))
                    }}>Edit</button>
                    <button style={{ ...btnSecondary, borderColor: '#ef4444', color: '#ef4444' }}
                      onClick={() => setDeleteConfirm(ctr.name)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Context menu popup */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            transform: 'translateX(-100%)',
            background: '#1a1a2e',
            border: '1px solid #2a2a3e',
            borderRadius: '6px',
            padding: '0.25rem 0',
            zIndex: 999,
            minWidth: '160px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          {/* If multi-host, show host selection first */}
          {!contextMenu.host ? (
            <>
              <div style={{ padding: '0.4rem 0.75rem', color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                Select Host
              </div>
              {containers.find(c => c.name === contextMenu.name)?.hosts.map(h => (
                <button
                  key={h}
                  onClick={() => setContextMenu({ ...contextMenu, host: h })}
                  style={menuItemStyle}
                >
                  {h}
                </button>
              ))}
            </>
          ) : (
            <>
              <div style={{ padding: '0.3rem 0.75rem', color: '#6b7280', fontSize: '0.65rem', borderBottom: '1px solid #2a2a3e', marginBottom: '0.25rem' }}>
                {contextMenu.name} @ {contextMenu.host}
              </div>
              <button style={menuItemStyle} onClick={() => openShell(contextMenu.name, contextMenu.host)}>
                Console
              </button>
              <button style={menuItemStyle} onClick={() => openLogs(contextMenu.name, contextMenu.host)}>
                View Logs
              </button>
              <div style={{ borderTop: '1px solid #2a2a3e', margin: '0.25rem 0' }} />
              <button style={menuItemStyle} onClick={() => dockerAction(contextMenu.name, 'restart', contextMenu.host)}>
                Restart
              </button>
              <button style={menuItemStyle} onClick={() => dockerAction(contextMenu.name, 'start', contextMenu.host)}>
                Start
              </button>
              <button style={{ ...menuItemStyle, color: '#f87171' }} onClick={() => dockerAction(contextMenu.name, 'stop', contextMenu.host)}>
                Stop
              </button>
              <div style={{ borderTop: '1px solid #2a2a3e', margin: '0.25rem 0' }} />
              <button style={{ ...menuItemStyle, color: '#c084fc' }} onClick={() => openMigrateDialog(contextMenu.name, contextMenu.host)}>
                Migrate...
              </button>
            </>
          )}
        </div>
      )}

      {/* Log viewer overlay */}
      {logInfo && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.5rem 1rem', background: '#1a1a2e', borderBottom: '1px solid #2a2a3e',
          }}>
            <span style={{ color: '#e0e0e0', fontSize: '0.9rem', fontWeight: 600 }}>
              Logs: {logInfo.name} ({logInfo.host})
            </span>
            <button onClick={closeLogs} style={{
              background: 'transparent', border: '1px solid #2a2a3e', color: '#b0b8d0',
              borderRadius: '4px', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem',
            }}>Close</button>
          </div>
          <div style={{
            flex: 1, overflow: 'auto', padding: '0.75rem 1rem',
            background: '#0f0f1a',
          }}>
            <pre style={{
              margin: 0, fontFamily: 'Menlo, Monaco, "Courier New", monospace',
              fontSize: '0.8rem', lineHeight: 1.5, color: '#d4d4d4',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {logLines.length === 0
                ? <span style={{ color: '#6b7280' }}>Connecting...</span>
                : logLines.map((line, i) => (
                    <div key={i} style={{ padding: '1px 0' }}>{line || '\u00a0'}</div>
                  ))
              }
              <div ref={logEndRef} />
            </pre>
          </div>
        </div>
      )}

      {/* Migration dialog */}
      {migrateDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#1a1a2e', borderRadius: '8px', padding: '1.5rem',
            width: '480px', maxHeight: '80vh', overflow: 'auto',
            border: '1px solid #2a2a3e',
          }}>
            <h2 style={{ color: '#e0e0e0', fontSize: '1.1rem', margin: '0 0 0.25rem 0' }}>
              Migrate Container
            </h2>
            <p style={{ color: '#8890a0', fontSize: '0.85rem', margin: '0 0 1rem 0' }}>
              {migrateDialog.name} — from <strong style={{ color: '#e0e0e0' }}>{migrateDialog.sourceHost}</strong>
            </p>

            {!migrateRunning && migrateSteps.length === 0 && (
              <>
                <label style={labelStyle}>Destination Host</label>
                <select
                  style={{ ...inputStyle, marginBottom: '1rem' }}
                  value={migrateTarget}
                  onChange={e => setMigrateTarget(e.target.value)}
                >
                  <option value="">Select host...</option>
                  {hostOptions
                    .filter(h => h.name !== migrateDialog.sourceHost)
                    .map(h => <option key={h.name} value={h.name}>{h.name} ({h.type})</option>)
                  }
                </select>

                {/* Volume selection */}
                {(() => {
                  const ctr = containers.find(c => c.name === migrateDialog.name)
                  const vols = ctr?.volumes.filter(v => v.host_path.trim()) || []
                  if (vols.length === 0) return null
                  return (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                        <label style={{ ...labelStyle, marginBottom: 0 }}>Volumes</label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span style={{ color: '#6b7280', fontSize: '0.7rem' }}>Copy data:</span>
                          <button
                            style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.7rem', cursor: 'pointer' }}
                            onClick={() => setMigrateVolumes(new Set(vols.map(v => resolveVolPath(v.host_path))))}
                          >All</button>
                          <button
                            style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.7rem', cursor: 'pointer' }}
                            onClick={() => setMigrateVolumes(new Set())}
                          >None</button>
                        </div>
                      </div>
                      <div style={{ background: '#0f0f1a', border: '1px solid #2a2a3e', borderRadius: '4px', padding: '0.4rem 0.6rem' }}>
                        {vols.map((v, i) => {
                          const resolved = resolveVolPath(v.host_path)
                          const checked = migrateVolumes.has(resolved)
                          const isFile = resolved.split('/').pop()?.includes('.') || false
                          return (
                            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  const next = new Set(migrateVolumes)
                                  if (e.target.checked) next.add(resolved)
                                  else next.delete(resolved)
                                  setMigrateVolumes(next)
                                }}
                              />
                              <span style={{ color: '#e0e0e0', fontSize: '0.8rem', fontFamily: 'monospace', flex: 1, minWidth: 0 }}>{resolved}</span>
                              {isFile && <span style={{ color: '#f59e0b', fontSize: '0.65rem', padding: '0.05rem 0.3rem', background: 'rgba(245,158,11,0.12)', borderRadius: '9999px' }}>file</span>}
                              <span style={{
                                fontSize: '0.65rem', padding: '0.05rem 0.3rem', borderRadius: '9999px',
                                background: checked ? 'rgba(34,197,94,0.12)' : 'rgba(136,144,160,0.12)',
                                color: checked ? '#22c55e' : '#8890a0',
                              }}>{checked ? 'copy data' : 'create empty'}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button style={btnSecondary} onClick={closeMigrate}>Cancel</button>
                  <button
                    style={{ ...btnPrimary, background: '#c084fc' }}
                    onClick={startMigration}
                    disabled={!migrateTarget}
                  >
                    Start Migration
                  </button>
                </div>
              </>
            )}

            {migrateSteps.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {migrateSteps.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                    padding: '0.4rem 0.6rem', background: '#0f0f1a', borderRadius: '4px',
                    border: '1px solid #2a2a3e',
                  }}>
                    <span style={{
                      flexShrink: 0, width: '1.2rem', textAlign: 'center', fontSize: '0.85rem',
                      color: s.status === 'done' ? '#22c55e'
                        : s.status === 'error' ? '#ef4444'
                        : s.status === 'skipped' ? '#6b7280'
                        : s.status === 'running' ? '#f59e0b'
                        : '#8890a0',
                    }}>
                      {s.status === 'done' ? '\u2713'
                        : s.status === 'error' ? '\u2717'
                        : s.status === 'skipped' ? '\u2014'
                        : s.status === 'running' ? '\u25CB'
                        : '\u00B7'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        color: '#e0e0e0', fontSize: '0.85rem', fontWeight: 600,
                        textTransform: 'capitalize',
                      }}>{s.step}</div>
                      {s.detail && (
                        <div style={{ color: '#8890a0', fontSize: '0.8rem', marginTop: '0.1rem' }}>
                          {s.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {!migrateRunning && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                    <button style={btnPrimary} onClick={closeMigrate}>Close</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import Container Dialog */}
      {showImport && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#1a1a2e', borderRadius: '8px', padding: '1.5rem',
            width: '620px', maxHeight: '80vh', overflow: 'auto',
            border: '1px solid #2a2a3e',
          }}>
            <h2 style={{ color: '#e0e0e0', fontSize: '1.1rem', margin: '0 0 1rem 0' }}>
              Import Containers
            </h2>

            <label style={labelStyle}>Host</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <select
                style={{ ...inputStyle, flex: 1 }}
                value={importHost}
                onChange={e => e.target.value && discoverContainers(e.target.value)}
              >
                <option value="">Select host...</option>
                {hostOptions.map(h => (
                  <option key={h.name} value={h.name}>{h.name} ({h.type})</option>
                ))}
              </select>
              {importHost && (
                <button
                  style={{ ...btnSecondary, whiteSpace: 'nowrap' }}
                  onClick={() => discoverContainers(importHost)}
                  disabled={discoveringCtrs}
                >
                  {discoveringCtrs ? 'Scanning...' : 'Refresh'}
                </button>
              )}
            </div>

            {discoverCtrError && (
              <div style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                {discoverCtrError}
              </div>
            )}

            {discoveringCtrs && (
              <p style={{ color: '#8890a0', fontSize: '0.85rem' }}>Discovering containers via SSH...</p>
            )}

            {discoveredCtrs.length > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ color: '#8890a0', fontSize: '0.75rem' }}>
                    {discoveredCtrs.length} unmanaged container(s) found
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.7rem', cursor: 'pointer' }}
                      onClick={() => setSelectedImports(new Set(discoveredCtrs.map(c => c.name)))}
                    >All</button>
                    <button
                      style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.7rem', cursor: 'pointer' }}
                      onClick={() => setSelectedImports(new Set())}
                    >None</button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
                  {discoveredCtrs.map(ctr => (
                    <label
                      key={ctr.name}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                        padding: '0.5rem 0.75rem', background: '#0f0f1a', border: '1px solid #2a2a3e',
                        borderRadius: '4px', cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedImports.has(ctr.name)}
                        onChange={e => {
                          const next = new Set(selectedImports)
                          if (e.target.checked) next.add(ctr.name)
                          else next.delete(ctr.name)
                          setSelectedImports(next)
                        }}
                        style={{ marginTop: '0.15rem' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                          <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '0.9rem' }}>{ctr.name}</span>
                          <span style={{
                            fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                            background: ctr.status === 'running' ? '#166534' : '#7f1d1d',
                            color: ctr.status === 'running' ? '#86efac' : '#fca5a5',
                          }}>{ctr.status}</span>
                          {ctr.network && (
                            <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', background: 'rgba(124,158,248,0.15)', color: '#7c9ef8' }}>
                              {ctr.network}
                            </span>
                          )}
                        </div>
                        <div style={{ color: '#8890a0', fontSize: '0.75rem', fontFamily: 'monospace' }}>{ctr.image}</div>
                        {ctr.ports.length > 0 && (
                          <div style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: '0.15rem' }}>
                            Ports: {ctr.ports.map(p => `${p.host}:${p.container}`).join(', ')}
                          </div>
                        )}
                        {ctr.volumes.length > 0 && (
                          <div style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: '0.15rem' }}>
                            Volumes: {ctr.volumes.map(v => v.host_path).join(', ')}
                          </div>
                        )}
                        {Object.keys(ctr.env).length > 0 && (
                          <div style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: '0.15rem' }}>
                            Env: {Object.keys(ctr.env).join(', ')}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={closeImport}>Cancel</button>
              {discoveredCtrs.length > 0 && (
                <button
                  style={btnPrimary}
                  onClick={handleImportContainers}
                  disabled={importingCtrs || selectedImports.size === 0}
                >
                  {importingCtrs ? 'Importing...' : `Import ${selectedImports.size} Container${selectedImports.size !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Terminal overlay (console) */}
      {terminalInfo && (
        <Terminal
          wsPath={terminalInfo.wsPath}
          title={terminalInfo.title}
          onClose={() => setTerminalInfo(null)}
        />
      )}
    </div>
  )
}
