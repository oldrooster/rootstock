import { useEffect, useState } from 'react'

interface Template {
  name: string
  cloud_image: string
  cpu: number
  memory: number
  disk: number
  user: string
  ssh_key_secret: string
  network: { type: string; subnet_mask: string; gateway: string; dns: string }
  timezone: string
  locale: string
}

interface Image {
  name: string
  type: 'iso' | 'cloud_image'
  download_url: string
  nodes: string[]
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

/* ── Form types ───────────────────────────────────────────────────────── */

interface TplFormData {
  name: string; cloud_image: string; cpu: string; memory: string; disk: string
  user: string; ssh_key_secret: string; net_type: string; subnet_mask: string
  gateway: string; dns: string; timezone: string; locale: string
}

const emptyForm: TplFormData = {
  name: '', cloud_image: '', cpu: '2', memory: '4096', disk: '32',
  user: 'deploy', ssh_key_secret: '', net_type: 'dhcp', subnet_mask: '/24', gateway: '',
  dns: '', timezone: 'Pacific/Auckland', locale: 'en_NZ.UTF-8',
}

function tplToForm(t: Template): TplFormData {
  return {
    name: t.name, cloud_image: t.cloud_image, cpu: String(t.cpu),
    memory: String(t.memory), disk: String(t.disk), user: t.user,
    ssh_key_secret: t.ssh_key_secret, net_type: t.network.type,
    subnet_mask: t.network.subnet_mask || '/24', gateway: t.network.gateway, dns: t.network.dns,
    timezone: t.timezone, locale: t.locale,
  }
}

function formToPayload(f: TplFormData) {
  return {
    name: f.name, cloud_image: f.cloud_image, cpu: Number(f.cpu),
    memory: Number(f.memory), disk: Number(f.disk), user: f.user,
    ssh_key_secret: f.ssh_key_secret,
    network: { type: f.net_type, subnet_mask: f.subnet_mask, gateway: f.gateway, dns: f.dns },
    timezone: f.timezone, locale: f.locale,
  }
}

/* ── Template Form ────────────────────────────────────────────────────── */

function TemplateForm({ form, setForm, images, secretKeys, disableName }: {
  form: TplFormData
  setForm: (f: TplFormData) => void
  images: Image[]
  secretKeys: string[]
  disableName?: boolean
}) {
  const set = (field: keyof TplFormData, value: string) => setForm({ ...form, [field]: value })
  const cloudImages = images.filter(i => i.type === 'cloud_image')
  const sshKeys = secretKeys.filter(k => k.startsWith('ssh/') && k.endsWith('/public_key'))

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={form.name} disabled={disableName}
            onChange={e => set('name', e.target.value)} placeholder="ubuntu-base" />
        </div>
        <div>
          <label style={labelStyle}>Cloud Image</label>
          {cloudImages.length > 0 ? (
            <select style={inputStyle} value={form.cloud_image} onChange={e => set('cloud_image', e.target.value)}>
              <option value="">Select image...</option>
              {cloudImages.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
            </select>
          ) : (
            <input style={inputStyle} value={form.cloud_image}
              onChange={e => set('cloud_image', e.target.value)} placeholder="ubuntu-24.04-cloudimg.img" />
          )}
        </div>
        <div>
          <label style={labelStyle}>SSH Key Secret</label>
          {sshKeys.length > 0 ? (
            <select style={inputStyle} value={form.ssh_key_secret} onChange={e => set('ssh_key_secret', e.target.value)}>
              <option value="">Select key...</option>
              {sshKeys.map(k => {
                const name = k.replace('ssh/', '').replace('/public_key', '')
                return <option key={k} value={k}>{name}</option>
              })}
            </select>
          ) : (
            <input style={inputStyle} value={form.ssh_key_secret}
              onChange={e => set('ssh_key_secret', e.target.value)} placeholder="ssh/deploy/public_key" />
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>CPU Cores</label>
          <input style={inputStyle} value={form.cpu} type="number" onChange={e => set('cpu', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Memory (MB)</label>
          <input style={inputStyle} value={form.memory} type="number" onChange={e => set('memory', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Disk (GB)</label>
          <input style={inputStyle} value={form.disk} type="number" onChange={e => set('disk', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>User</label>
          <input style={inputStyle} value={form.user} onChange={e => set('user', e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Network</label>
          <select style={inputStyle} value={form.net_type} onChange={e => set('net_type', e.target.value)}>
            <option value="dhcp">DHCP</option>
            <option value="static">Static</option>
          </select>
        </div>
        {form.net_type === 'static' && (
          <>
            <div>
              <label style={labelStyle}>Subnet Mask</label>
              <input style={inputStyle} value={form.subnet_mask} onChange={e => set('subnet_mask', e.target.value)} placeholder="/24" />
            </div>
            <div>
              <label style={labelStyle}>Gateway</label>
              <input style={inputStyle} value={form.gateway} onChange={e => set('gateway', e.target.value)} placeholder="10.0.0.1" />
            </div>
            <div>
              <label style={labelStyle}>DNS</label>
              <input style={inputStyle} value={form.dns} onChange={e => set('dns', e.target.value)} placeholder="1.1.1.1" />
            </div>
          </>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Timezone</label>
          <input style={inputStyle} value={form.timezone} onChange={e => set('timezone', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Locale</label>
          <input style={inputStyle} value={form.locale} onChange={e => set('locale', e.target.value)} />
        </div>
      </div>
    </>
  )
}

/* ── Main ─────────────────────────────────────────────────────────────── */

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [images, setImages] = useState<Image[]>([])
  const [secretKeys, setSecretKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<TplFormData>(emptyForm)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<TplFormData>(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  function loadAll() {
    Promise.all([
      fetch('/api/templates/').then(r => r.json()),
      fetch('/api/images/').then(r => r.json()),
      fetch('/api/secrets/').then(r => r.json()),
    ]).then(([tpls, imgs, secs]) => {
      setTemplates(tpls)
      setImages(imgs)
      setSecretKeys(secs)
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [])

  async function handleCreate() {
    try {
      const r = await fetch('/api/templates/', {
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
      const { name: _, ...patchPayload } = payload
      const r = await fetch(`/api/templates/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchPayload),
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
      const r = await fetch(`/api/templates/${name}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setDeleteConfirm(null)
      loadAll()
    } catch (e) { setError((e as Error).message) }
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Templates</h1>
        {!showAdd && (
          <button style={btnPrimary} onClick={() => setShowAdd(true)}>Add Template</button>
        )}
      </div>

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button style={{ ...btnSecondary, border: 'none', color: '#fca5a5' }} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {showAdd && (
        <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
          <TemplateForm form={addForm} setForm={setAddForm} images={images} secretKeys={secretKeys} />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowAdd(false); setAddForm(emptyForm) }}>Cancel</button>
            <button style={btnPrimary} onClick={handleCreate}>Create</button>
          </div>
        </div>
      )}

      {templates.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No templates configured yet.</p>
      )}

      {templates.map(tpl => (
        <div key={tpl.name} style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
          {editingName === tpl.name ? (
            <>
              <TemplateForm form={editForm} setForm={setEditForm} images={images} secretKeys={secretKeys} disableName />
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button style={btnSecondary} onClick={() => setEditingName(null)}>Cancel</button>
                <button style={btnPrimary} onClick={() => handleUpdate(tpl.name)}>Save</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>{tpl.name}</div>
                <div style={{ color: '#8890a0', fontSize: '0.85rem', lineHeight: 1.6 }}>
                  <span>Image: <strong style={{ color: '#b0b8d0' }}>{tpl.cloud_image}</strong></span>
                  <span style={{ margin: '0 0.75rem' }}>|</span>
                  <span>{tpl.cpu} CPU, {tpl.memory} MB, {tpl.disk} GB</span>
                  <span style={{ margin: '0 0.75rem' }}>|</span>
                  <span>User: <strong style={{ color: '#b0b8d0' }}>{tpl.user}</strong></span>
                  <span style={{ margin: '0 0.75rem' }}>|</span>
                  <span>Net: <strong style={{ color: '#b0b8d0' }}>{tpl.network.type}</strong></span>
                  <span style={{ margin: '0 0.75rem' }}>|</span>
                  <span>{tpl.timezone}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                {deleteConfirm === tpl.name ? (
                  <>
                    <span style={{ color: '#fca5a5', fontSize: '0.85rem', alignSelf: 'center' }}>Delete?</span>
                    <button style={btnDanger} onClick={() => handleDelete(tpl.name)}>Confirm</button>
                    <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button style={btnSecondary} onClick={() => { setEditingName(tpl.name); setEditForm(tplToForm(tpl)) }}>Edit</button>
                    <button style={{ ...btnSecondary, borderColor: '#ef4444', color: '#ef4444' }} onClick={() => setDeleteConfirm(tpl.name)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
