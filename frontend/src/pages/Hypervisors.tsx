import { useEffect, useState } from 'react'

interface Hypervisor {
  name: string
  endpoint: string
  node_name: string
  username: string
  token_name: string
  enabled: boolean
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
  endpoint: string
  node_name: string
  username: string
  token_name: string
  enabled: boolean
}

const emptyForm: FormData = {
  name: '', endpoint: '', node_name: '', username: 'root@pam',
  token_name: '', enabled: true,
}

function hvToForm(hv: Hypervisor): FormData {
  return {
    name: hv.name,
    endpoint: hv.endpoint,
    node_name: hv.node_name,
    username: hv.username,
    token_name: hv.token_name,
    enabled: hv.enabled,
  }
}

function formToPayload(f: FormData) {
  return {
    name: f.name,
    endpoint: f.endpoint,
    node_name: f.node_name,
    username: f.username,
    token_name: f.token_name,
    enabled: f.enabled,
  }
}

function HypervisorForm({ form, setForm, onSubmit, onCancel, submitLabel, disableName }: {
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
            onChange={e => set('name', e.target.value)} placeholder="lappy" />
        </div>
        <div>
          <label style={labelStyle}>Endpoint</label>
          <input style={inputStyle} value={form.endpoint}
            onChange={e => set('endpoint', e.target.value)} placeholder="https://10.0.0.5:8006" />
        </div>
        <div>
          <label style={labelStyle}>Node Name</label>
          <input style={inputStyle} value={form.node_name}
            onChange={e => set('node_name', e.target.value)} placeholder="pve" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Username</label>
          <input style={inputStyle} value={form.username}
            onChange={e => set('username', e.target.value)} placeholder="root@pam" />
        </div>
        <div>
          <label style={labelStyle}>API Token Name</label>
          <input style={inputStyle} value={form.token_name}
            onChange={e => set('token_name', e.target.value)} placeholder="rootstock" />
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

export default function Hypervisors() {
  const [hypervisors, setHypervisors] = useState<Hypervisor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<FormData>(emptyForm)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormData>(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [testingName, setTestingName] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ name: string; success: boolean; message: string } | null>(null)

  function loadHypervisors() {
    fetch('/api/hypervisors/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setHypervisors)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadHypervisors() }, [])

  async function handleCreate() {
    try {
      const r = await fetch('/api/hypervisors/', {
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
      loadHypervisors()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleUpdate(name: string) {
    try {
      const payload = formToPayload(editForm)
      const { name: _, ...patchPayload } = payload
      const r = await fetch(`/api/hypervisors/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchPayload),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setEditingName(null)
      loadHypervisors()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDelete(name: string) {
    try {
      const r = await fetch(`/api/hypervisors/${name}`, { method: 'DELETE' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setDeleteConfirm(null)
      loadHypervisors()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleTest(name: string) {
    setTestingName(name)
    setTestResult(null)
    try {
      const r = await fetch(`/api/hypervisors/${name}/test`, { method: 'POST' })
      const data = await r.json()
      setTestResult({ name, success: data.success, message: data.message })
    } catch (e) {
      setTestResult({ name, success: false, message: (e as Error).message })
    } finally {
      setTestingName(null)
    }
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Hypervisors</h1>
        {!showAdd && (
          <button style={btnPrimary} onClick={() => { setShowAdd(true); setAddForm(emptyForm) }}>
            Add Hypervisor
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
        <HypervisorForm
          form={addForm}
          setForm={setAddForm}
          onSubmit={handleCreate}
          onCancel={() => setShowAdd(false)}
          submitLabel="Create"
        />
      )}

      {hypervisors.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No hypervisors configured yet.</p>
      )}

      {hypervisors.map(hv => (
        <div key={hv.name} style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
          {editingName === hv.name ? (
            <HypervisorForm
              form={editForm}
              setForm={setEditForm}
              onSubmit={() => handleUpdate(hv.name)}
              onCancel={() => setEditingName(null)}
              submitLabel="Save"
              disableName
            />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '1rem' }}>{hv.name}</span>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    background: hv.enabled ? '#166534' : '#7f1d1d',
                    color: hv.enabled ? '#86efac' : '#fca5a5',
                  }}>
                    {hv.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                <div style={{ color: '#8890a0', fontSize: '0.85rem', lineHeight: 1.6 }}>
                  <span>Endpoint: <strong style={{ color: '#b0b8d0' }}>{hv.endpoint}</strong></span>
                  <span style={{ margin: '0 0.75rem' }}>|</span>
                  <span>Node: <strong style={{ color: '#b0b8d0' }}>{hv.node_name}</strong></span>
                  <span style={{ margin: '0 0.75rem' }}>|</span>
                  <span>User: <strong style={{ color: '#b0b8d0' }}>{hv.username}</strong></span>
                  {hv.token_name && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span>Token: <strong style={{ color: '#b0b8d0' }}>{hv.token_name}</strong></span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                {deleteConfirm === hv.name ? (
                  <>
                    <span style={{ color: '#fca5a5', fontSize: '0.85rem', alignSelf: 'center' }}>Delete?</span>
                    <button style={btnDanger} onClick={() => handleDelete(hv.name)}>Confirm</button>
                    <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button style={btnSecondary} onClick={() => handleTest(hv.name)}
                      disabled={testingName === hv.name}>
                      {testingName === hv.name ? 'Testing...' : 'Test'}
                    </button>
                    <button style={btnSecondary} onClick={() => {
                      setEditingName(hv.name)
                      setEditForm(hvToForm(hv))
                    }}>Edit</button>
                    <button style={{ ...btnSecondary, borderColor: '#ef4444', color: '#ef4444' }}
                      onClick={() => setDeleteConfirm(hv.name)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          )}
          {testResult?.name === hv.name && (
            <div style={{
              marginTop: '0.5rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '4px',
              fontSize: '0.85rem',
              background: testResult.success ? '#166534' : '#7f1d1d',
              color: testResult.success ? '#86efac' : '#fca5a5',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>{testResult.message}</span>
              <button style={{ ...btnSecondary, border: 'none', color: testResult.success ? '#86efac' : '#fca5a5', padding: '0 0.4rem' }}
                onClick={() => setTestResult(null)}>dismiss</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
