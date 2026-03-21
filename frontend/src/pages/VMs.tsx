import { useEffect, useState } from 'react'

interface VM {
  name: string
  enabled: boolean
  node: string
  cpu: number
  memory: number
  disk: number
  image: string
  user: string
  ssh_key: string
  role: string
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
  node: string
  cpu: string
  memory: string
  disk: string
  image: string
  user: string
  ssh_key: string
  role: string
  enabled: boolean
}

const emptyForm: FormData = {
  name: '', node: '', cpu: '2', memory: '4096', disk: '32',
  image: 'ubuntu-24.04-cloudimg', user: 'deploy', ssh_key: '',
  role: 'container_host', enabled: true,
}

function vmToForm(vm: VM): FormData {
  return {
    name: vm.name,
    node: vm.node,
    cpu: String(vm.cpu),
    memory: String(vm.memory),
    disk: String(vm.disk),
    image: vm.image,
    user: vm.user,
    ssh_key: vm.ssh_key,
    role: vm.role,
    enabled: vm.enabled,
  }
}

function formToPayload(f: FormData) {
  return {
    name: f.name,
    node: f.node,
    cpu: Number(f.cpu),
    memory: Number(f.memory),
    disk: Number(f.disk),
    image: f.image,
    user: f.user,
    ssh_key: f.ssh_key,
    role: f.role,
    enabled: f.enabled,
  }
}

function VMForm({ form, setForm, onSubmit, onCancel, submitLabel, disableName, hypervisors }: {
  form: FormData
  setForm: (f: FormData) => void
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  disableName?: boolean
  hypervisors: { name: string; enabled: boolean }[]
}) {
  const set = (field: keyof FormData, value: string | boolean) =>
    setForm({ ...form, [field]: value })

  const enabledHVs = hypervisors.filter(h => h.enabled)

  return (
    <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={form.name} disabled={disableName}
            onChange={e => set('name', e.target.value)} placeholder="ubuntu-worker-01" />
        </div>
        <div>
          <label style={labelStyle}>Proxmox Node</label>
          {enabledHVs.length > 0 ? (
            <select style={inputStyle} value={form.node}
              onChange={e => set('node', e.target.value)}>
              <option value="">Select a hypervisor...</option>
              {enabledHVs.map(h => (
                <option key={h.name} value={h.name}>{h.name}</option>
              ))}
            </select>
          ) : (
            <div style={{ color: '#fca5a5', fontSize: '0.8rem', padding: '0.4rem 0' }}>
              No hypervisors configured. Add one first.
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>Image</label>
          <input style={inputStyle} value={form.image}
            onChange={e => set('image', e.target.value)} placeholder="ubuntu-24.04-cloudimg" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>CPU Cores</label>
          <input style={inputStyle} value={form.cpu} type="number"
            onChange={e => set('cpu', e.target.value)} placeholder="2" />
        </div>
        <div>
          <label style={labelStyle}>Memory (MB)</label>
          <input style={inputStyle} value={form.memory} type="number"
            onChange={e => set('memory', e.target.value)} placeholder="4096" />
        </div>
        <div>
          <label style={labelStyle}>Disk (GB)</label>
          <input style={inputStyle} value={form.disk} type="number"
            onChange={e => set('disk', e.target.value)} placeholder="32" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>User</label>
          <input style={inputStyle} value={form.user}
            onChange={e => set('user', e.target.value)} placeholder="deploy" />
        </div>
        <div>
          <label style={labelStyle}>Role</label>
          <input style={inputStyle} value={form.role}
            onChange={e => set('role', e.target.value)} placeholder="container_host" />
        </div>
        <div>
          <label style={labelStyle}>SSH Key</label>
          <input style={inputStyle} value={form.ssh_key}
            onChange={e => set('ssh_key', e.target.value)} placeholder="ssh-ed25519 AAAA..." />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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

export default function VMs() {
  const [vms, setVMs] = useState<VM[]>([])
  const [hypervisors, setHypervisors] = useState<{ name: string; enabled: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<FormData>(emptyForm)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormData>(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  function loadVMs() {
    fetch('/api/vms/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setVMs)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  function loadHypervisors() {
    fetch('/api/hypervisors/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setHypervisors)
      .catch(() => {})
  }

  useEffect(() => { loadVMs(); loadHypervisors() }, [])

  async function handleCreate() {
    try {
      const r = await fetch('/api/vms/', {
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
      loadVMs()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleUpdate(name: string) {
    try {
      const payload = formToPayload(editForm)
      const { name: _, ...patchPayload } = payload
      const r = await fetch(`/api/vms/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchPayload),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setEditingName(null)
      loadVMs()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDelete(name: string) {
    try {
      const r = await fetch(`/api/vms/${name}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setDeleteConfirm(null)
      loadVMs()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>VMs</h1>
        {!showAdd && (
          <button style={btnPrimary} onClick={() => { setShowAdd(true); setAddForm(emptyForm) }}>
            Add VM
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
        <VMForm
          form={addForm}
          setForm={setAddForm}
          onSubmit={handleCreate}
          onCancel={() => setShowAdd(false)}
          submitLabel="Create"
          hypervisors={hypervisors}
        />
      )}

      {vms.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No VMs defined yet.</p>
      )}

      {vms.map(vm => (
        <div key={vm.name} style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
          {editingName === vm.name ? (
            <VMForm
              form={editForm}
              setForm={setEditForm}
              onSubmit={() => handleUpdate(vm.name)}
              onCancel={() => setEditingName(null)}
              submitLabel="Save"
              disableName
              hypervisors={hypervisors}
            />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '1rem' }}>{vm.name}</span>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    background: vm.enabled ? '#166534' : '#7f1d1d',
                    color: vm.enabled ? '#86efac' : '#fca5a5',
                  }}>
                    {vm.enabled ? 'enabled' : 'disabled'}
                  </span>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    background: 'rgba(124,158,248,0.15)',
                    color: '#7c9ef8',
                  }}>
                    {vm.role}
                  </span>
                </div>
                <div style={{ color: '#8890a0', fontSize: '0.85rem', lineHeight: 1.6 }}>
                  <span>Node: <strong style={{ color: '#b0b8d0' }}>{vm.node}</strong></span>
                  <span style={{ margin: '0 0.75rem' }}>|</span>
                  <span>{vm.cpu} CPU, {vm.memory} MB, {vm.disk} GB</span>
                  <span style={{ margin: '0 0.75rem' }}>|</span>
                  <span>Image: <strong style={{ color: '#b0b8d0' }}>{vm.image}</strong></span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                {deleteConfirm === vm.name ? (
                  <>
                    <span style={{ color: '#fca5a5', fontSize: '0.85rem', alignSelf: 'center' }}>Destroy?</span>
                    <button style={btnDanger} onClick={() => handleDelete(vm.name)}>Confirm</button>
                    <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button style={btnSecondary} onClick={() => {
                      setEditingName(vm.name)
                      setEditForm(vmToForm(vm))
                    }}>Edit</button>
                    <button style={{ ...btnSecondary, borderColor: '#ef4444', color: '#ef4444' }}
                      onClick={() => setDeleteConfirm(vm.name)}>Destroy</button>
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
