import { useEffect, useState, lazy, Suspense } from 'react'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'

const Terminal = lazy(() => import('../components/Terminal'))

interface VM {
  name: string
  enabled: boolean
  node: string
  ip: string
  template: string
  cpu: number
  cpu_type: string
  memory: number
  disk: number
  image: string
  user: string
  ssh_key: string
  gpu_passthrough: boolean
  roles: string[]
}

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
  ip: string
  template: string
  cpu: string
  cpu_type: string
  memory: string
  disk: string
  image: string
  user: string
  ssh_key: string
  gpu_passthrough: boolean
  roles: string
  enabled: boolean
}

const emptyForm: FormData = {
  name: '', node: '', ip: '', template: '', cpu: '2', cpu_type: 'host', memory: '4096', disk: '32',
  image: '', user: 'deploy', ssh_key: '', gpu_passthrough: false,
  roles: '', enabled: true,
}

function vmToForm(vm: VM): FormData {
  return {
    name: vm.name,
    node: vm.node,
    ip: vm.ip || '',
    template: vm.template || '',
    cpu: String(vm.cpu),
    cpu_type: vm.cpu_type || 'host',
    memory: String(vm.memory),
    disk: String(vm.disk),
    image: vm.image,
    user: vm.user,
    ssh_key: vm.ssh_key,
    gpu_passthrough: vm.gpu_passthrough || false,
    roles: (vm.roles || []).join(', '),
    enabled: vm.enabled,
  }
}

function formToPayload(f: FormData) {
  return {
    name: f.name,
    node: f.node,
    ip: f.ip,
    template: f.template,
    cpu: Number(f.cpu),
    cpu_type: f.cpu_type,
    memory: Number(f.memory),
    disk: Number(f.disk),
    image: f.image,
    user: f.user,
    ssh_key: f.ssh_key,
    gpu_passthrough: f.gpu_passthrough,
    roles: f.roles.split(',').map(s => s.trim()).filter(Boolean),
    enabled: f.enabled,
  }
}

function VMForm({ form, setForm, onSubmit, onCancel, submitLabel, disableName, infraNodes, templates, allVms, currentName }: {
  form: FormData
  setForm: (f: FormData) => void
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  disableName?: boolean
  infraNodes: { name: string; enabled: boolean }[]
  templates: Template[]
  allVms?: VM[]
  currentName?: string
}) {
  const set = (field: keyof FormData, value: string | boolean) =>
    setForm({ ...form, [field]: value })

  const enabledNodes = infraNodes.filter(h => h.enabled)
  const hasTemplate = form.template !== ''

  function handleTemplateChange(tplName: string) {
    if (!tplName) {
      setForm({ ...form, template: '', image: '' })
      return
    }
    const tpl = templates.find(t => t.name === tplName)
    if (!tpl) return
    setForm({
      ...form,
      template: tplName,
      cpu: String(tpl.cpu),
      memory: String(tpl.memory),
      disk: String(tpl.disk),
      user: tpl.user,
      ssh_key: tpl.ssh_key_secret,
      image: '',
    })
  }

  return (
    <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={form.name} disabled={disableName}
            onChange={e => set('name', e.target.value)} placeholder="ubuntu-worker-01" />
        </div>
        <div>
          <label style={labelStyle}>Node</label>
          {enabledNodes.length > 0 ? (
            <select style={inputStyle} value={form.node}
              onChange={e => set('node', e.target.value)}>
              <option value="">Select a node...</option>
              {enabledNodes.map(h => (
                <option key={h.name} value={h.name}>{h.name}</option>
              ))}
            </select>
          ) : (
            <div style={{ color: '#fca5a5', fontSize: '0.8rem', padding: '0.4rem 0' }}>
              No infraNodes configured. Add one first.
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>IP Address</label>
          <input style={inputStyle} value={form.ip}
            onChange={e => set('ip', e.target.value)} placeholder="10.0.0.50" />
        </div>
        <div>
          <label style={labelStyle}>Template</label>
          <select style={inputStyle} value={form.template} onChange={e => handleTemplateChange(e.target.value)}>
            <option value="">No template (manual)</option>
            {templates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </div>
      </div>
      {!hasTemplate && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <label style={labelStyle}>Image</label>
            <input style={inputStyle} value={form.image}
              onChange={e => set('image', e.target.value)} placeholder="ubuntu-24.04-cloudimg.img" />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>CPU Cores</label>
          <input style={inputStyle} value={form.cpu} type="number"
            onChange={e => set('cpu', e.target.value)} placeholder="2" />
        </div>
        <div>
          <label style={labelStyle}>CPU Type</label>
          <select style={{ ...inputStyle, appearance: 'auto' }} value={form.cpu_type}
            onChange={e => set('cpu_type', e.target.value)}>
            <option value="host">host</option>
            <option value="x86-64-v2-AES">x86-64-v2-AES</option>
            <option value="x86-64-v2">x86-64-v2</option>
            <option value="x86-64-v3">x86-64-v3</option>
            <option value="x86-64-v4">x86-64-v4</option>
            <option value="kvm64">kvm64</option>
            <option value="qemu64">qemu64</option>
          </select>
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
          <label style={labelStyle}>Roles</label>
          <input style={inputStyle} value={form.roles}
            onChange={e => set('roles', e.target.value)} placeholder="docker, monitoring" />
        </div>
        <div>
          <label style={labelStyle}>SSH Key</label>
          <input style={inputStyle} value={form.ssh_key}
            onChange={e => set('ssh_key', e.target.value)} placeholder="ssh-ed25519 AAAA... or ssh/name/public_key" />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <label style={{ color: '#8890a0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={form.enabled}
            onChange={e => set('enabled', e.target.checked)} />
          Enabled
        </label>
        <label style={{ color: '#8890a0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={form.gpu_passthrough}
            onChange={e => set('gpu_passthrough', e.target.checked)} />
          iGPU Passthrough
        </label>
        {form.gpu_passthrough && (() => {
          const conflict = (allVms || []).find(v =>
            v.name !== (currentName || form.name) && v.enabled && v.node === form.node && v.gpu_passthrough
          )
          if (conflict) return (
            <span style={{ color: '#f87171', fontSize: '0.8rem' }}>
              iGPU already assigned to {conflict.name} on {form.node}
            </span>
          )
          return null
        })()}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button style={btnSecondary} onClick={onCancel}>Cancel</button>
          <button style={btnPrimary} onClick={onSubmit}>{submitLabel}</button>
        </div>
      </div>
    </div>
  )
}

interface DiscoveredVM {
  name: string
  vmid: number
  status: string
  cpu: number
  memory: number
  disk: number
  ip: string
}

interface NodeInfo {
  name: string
  enabled: boolean
  node_name: string
}

export default function VMs() {
  const [vms, setVMs] = useState<VM[]>([])
  const [infraNodes, setInfraNodes] = useState<NodeInfo[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<FormData>(emptyForm)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormData>(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [terminalVM, setTerminalVM] = useState<string | null>(null)
  useUnsavedChanges(showAdd || editingName !== null)

  // Import state
  const [showImport, setShowImport] = useState(false)
  const [importNode, setImportNode] = useState('')
  const [discovered, setDiscovered] = useState<DiscoveredVM[]>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [selectedVM, setSelectedVM] = useState<DiscoveredVM | null>(null)
  const [importUser, setImportUser] = useState('deploy')
  const [importKey, setImportKey] = useState('')
  const [importRoles, setImportRoles] = useState('')
  const [sshTestResult, setSSHTestResult] = useState<{ success: boolean; detail: string } | null>(null)
  const [sshTesting, setSSHTesting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [sshMode, setSSHMode] = useState<'existing' | 'generate' | 'secret'>('existing')
  const [importPassword, setImportPassword] = useState('')
  const [generatingKey, setGeneratingKey] = useState(false)
  const [generateResult, setGenerateResult] = useState<{ success: boolean; detail: string } | null>(null)
  const [secretKeys, setSecretKeys] = useState<string[]>([])
  const [selectedSecret, setSelectedSecret] = useState('')

  function loadVMs() {
    fetch('/api/vms/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setVMs)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  function loadNodes() {
    fetch('/api/nodes/')
      .then(r => r.json())
      .then(setInfraNodes)
      .catch(() => {})
  }

  function loadTemplates() {
    fetch('/api/templates/')
      .then(r => r.json())
      .then(setTemplates)
      .catch(() => {})
  }

  function loadSecrets() {
    fetch('/api/secrets/')
      .then(r => r.json())
      .then((keys: string[]) => setSecretKeys(keys.filter(k => k.includes('ssh') && k.includes('private'))))
      .catch(() => {})
  }

  useEffect(() => { loadVMs(); loadNodes(); loadTemplates(); loadSecrets() }, [])

  async function discoverVMs(nodeName: string) {
    setImportNode(nodeName)
    setDiscoverLoading(true)
    setDiscoverError(null)
    setDiscovered([])
    setSelectedVM(null)
    try {
      const r = await fetch(`/api/vms/discover/${encodeURIComponent(nodeName)}`)
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      const vms = await r.json()
      setDiscovered(vms)
      if (vms.length === 0) setDiscoverError('No unmanaged VMs found on this node')
    } catch (e) {
      setDiscoverError((e as Error).message)
    } finally {
      setDiscoverLoading(false)
    }
  }

  function selectDiscoveredVM(vm: DiscoveredVM) {
    setSelectedVM(vm)
    setImportUser('deploy')
    setImportKey('')
    setImportRoles('')
    setSSHTestResult(null)
    setSSHMode('existing')
    setImportPassword('')
    setGenerateResult(null)
    setSelectedSecret('')
  }

  async function testSSH() {
    if (!selectedVM || !selectedVM.ip || !importKey) return
    setSSHTesting(true)
    setSSHTestResult(null)
    try {
      const r = await fetch('/api/vms/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: selectedVM.ip, user: importUser, private_key: importKey }),
      })
      const result = await r.json()
      setSSHTestResult(result)
    } catch (e) {
      setSSHTestResult({ success: false, detail: (e as Error).message })
    } finally {
      setSSHTesting(false)
    }
  }

  async function generateSSHKey() {
    if (!selectedVM || !selectedVM.ip || !importPassword) return
    setGeneratingKey(true)
    setGenerateResult(null)
    try {
      const r = await fetch('/api/vms/setup-ssh-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: selectedVM.ip, user: importUser, password: importPassword }),
      })
      const result = await r.json()
      setGenerateResult({ success: result.success, detail: result.detail })
      if (result.success && result.private_key) {
        setImportKey(result.private_key)
        setSSHTestResult({ success: true, detail: result.detail })
      }
    } catch (e) {
      setGenerateResult({ success: false, detail: (e as Error).message })
    } finally {
      setGeneratingKey(false)
    }
  }

  async function testSSHWithSecret() {
    if (!selectedVM || !selectedVM.ip || !selectedSecret) return
    setSSHTesting(true)
    setSSHTestResult(null)
    try {
      // Fetch the private key from the secret store
      const sr = await fetch(`/api/secrets/${encodeURIComponent(selectedSecret)}`)
      if (!sr.ok) throw new Error('Failed to fetch secret')
      const { value } = await sr.json()
      setImportKey(value)
      // Test SSH with it
      const r = await fetch('/api/vms/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: selectedVM.ip, user: importUser, private_key: value }),
      })
      const result = await r.json()
      setSSHTestResult(result)
    } catch (e) {
      setSSHTestResult({ success: false, detail: (e as Error).message })
    } finally {
      setSSHTesting(false)
    }
  }

  async function handleImport() {
    if (!selectedVM) return
    setImporting(true)
    try {
      const r = await fetch('/api/vms/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedVM.name,
          node: importNode,
          ip: selectedVM.ip,
          cpu: selectedVM.cpu,
          memory: selectedVM.memory,
          disk: selectedVM.disk,
          user: importUser,
          ssh_private_key: importKey,
          roles: importRoles.split(',').map(s => s.trim()).filter(Boolean),
        }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setShowImport(false)
      setSelectedVM(null)
      setDiscovered([])
      loadVMs()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  function closeImport() {
    setShowImport(false)
    setImportNode('')
    setDiscovered([])
    setSelectedVM(null)
    setDiscoverError(null)
  }

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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!showAdd && (
            <>
              <button style={btnSecondary} onClick={() => setShowImport(true)}>
                Import VM
              </button>
              <button style={btnPrimary} onClick={() => { setShowAdd(true); setAddForm(emptyForm) }}>
                Add VM
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
        <VMForm
          form={addForm}
          setForm={setAddForm}
          onSubmit={handleCreate}
          onCancel={() => setShowAdd(false)}
          submitLabel="Create"
          infraNodes={infraNodes}
          templates={templates}
          allVms={vms}
        />
      )}

      {vms.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No VMs defined yet.</p>
      )}

      {terminalVM && (
        <Suspense fallback={null}>
          <Terminal
            wsPath={`/api/terminal/${encodeURIComponent(terminalVM)}/terminal`}
            title={terminalVM}
            onClose={() => setTerminalVM(null)}
          />
        </Suspense>
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
              infraNodes={infraNodes}
              templates={templates}
              allVms={vms}
              currentName={vm.name}
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
                  {(vm.roles || []).map(r => (
                    <span key={r} style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '9999px',
                      background: 'rgba(124,158,248,0.15)',
                      color: '#7c9ef8',
                    }}>
                      {r}
                    </span>
                  ))}
                </div>
                <div style={{ color: '#8890a0', fontSize: '0.85rem', lineHeight: 1.6 }}>
                  <span>Node: <strong style={{ color: '#b0b8d0' }}>{vm.node}</strong></span>
                  {vm.ip && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span>IP: <strong style={{ color: '#b0b8d0', fontFamily: 'monospace' }}>{vm.ip}</strong></span>
                    </>
                  )}
                  <span style={{ margin: '0 0.75rem' }}>|</span>
                  <span>
                    {vm.cpu} CPU ({vm.cpu_type || 'host'}), {vm.memory} MB, {vm.disk} GB
                    {vm.gpu_passthrough && (
                      <span style={{
                        marginLeft: '0.5rem', fontSize: '0.7rem', padding: '0.1rem 0.4rem',
                        borderRadius: '9999px', background: 'rgba(124,158,248,0.15)', color: '#7c9ef8',
                      }}>iGPU</span>
                    )}
                  </span>
                  {vm.template && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span>Template: <strong style={{ color: '#c084fc' }}>{vm.template}</strong></span>
                    </>
                  )}
                  {vm.image && (
                    <>
                      <span style={{ margin: '0 0.75rem' }}>|</span>
                      <span>Image: <strong style={{ color: '#b0b8d0' }}>{vm.image}</strong></span>
                    </>
                  )}
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
                    <button style={{ ...btnSecondary, borderColor: '#22c55e', color: '#22c55e' }}
                      onClick={() => setTerminalVM(vm.name)}>SSH</button>
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

      {/* Import VM Dialog */}
      {showImport && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#1a1a2e', borderRadius: '8px', padding: '1.5rem',
            width: '560px', maxHeight: '80vh', overflow: 'auto',
            border: '1px solid #2a2a3e',
          }}>
            <h2 style={{ color: '#e0e0e0', fontSize: '1.1rem', margin: '0 0 1rem 0' }}>
              Import Existing VM
            </h2>

            {/* Step 1: Select node */}
            {!selectedVM && (
              <>
                <label style={labelStyle}>Proxmox Node</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <select
                    style={{ ...inputStyle, flex: 1 }}
                    value={importNode}
                    onChange={e => e.target.value && discoverVMs(e.target.value)}
                  >
                    <option value="">Select node...</option>
                    {infraNodes.filter(n => n.enabled).map(n => (
                      <option key={n.name} value={n.name}>{n.name}</option>
                    ))}
                  </select>
                  {importNode && (
                    <button
                      style={{ ...btnSecondary, whiteSpace: 'nowrap' }}
                      onClick={() => discoverVMs(importNode)}
                      disabled={discoverLoading}
                    >
                      {discoverLoading ? 'Scanning...' : 'Refresh'}
                    </button>
                  )}
                </div>

                {discoverError && (
                  <div style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                    {discoverError}
                  </div>
                )}

                {discoverLoading && (
                  <p style={{ color: '#8890a0', fontSize: '0.85rem' }}>Querying Proxmox API...</p>
                )}

                {/* VM list */}
                {discovered.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
                    {discovered.map(dvm => (
                      <button
                        key={dvm.vmid}
                        onClick={() => selectDiscoveredVM(dvm)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '0.6rem 0.75rem', background: '#0f0f1a', border: '1px solid #2a2a3e',
                          borderRadius: '4px', cursor: 'pointer', textAlign: 'left', width: '100%',
                        }}
                      >
                        <div>
                          <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '0.9rem' }}>{dvm.name}</span>
                          <span style={{ color: '#6b7280', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                            VMID {dvm.vmid}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ color: '#8890a0', fontSize: '0.8rem' }}>
                            {dvm.cpu}C / {dvm.memory}MB / {dvm.disk}GB
                          </span>
                          {dvm.ip && (
                            <span style={{ color: '#7c9ef8', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                              {dvm.ip}
                            </span>
                          )}
                          <span style={{
                            fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                            background: dvm.status === 'running' ? '#166534' : '#7f1d1d',
                            color: dvm.status === 'running' ? '#86efac' : '#fca5a5',
                          }}>{dvm.status}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button style={btnSecondary} onClick={closeImport}>Cancel</button>
                </div>
              </>
            )}

            {/* Step 2: Configure SSH + import */}
            {selectedVM && (
              <>
                <div style={{
                  padding: '0.6rem 0.75rem', background: '#0f0f1a', borderRadius: '4px',
                  border: '1px solid #2a2a3e', marginBottom: '1rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{selectedVM.name}</span>
                      <span style={{ color: '#6b7280', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                        on {importNode}
                      </span>
                    </div>
                    <button
                      style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                      onClick={() => setSelectedVM(null)}
                    >Back</button>
                  </div>
                  <div style={{ color: '#8890a0', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    {selectedVM.cpu} CPU ({selectedVM.cpu_type || 'host'}), {selectedVM.memory} MB, {selectedVM.disk} GB
                    {selectedVM.ip && <> | IP: <strong style={{ color: '#7c9ef8', fontFamily: 'monospace' }}>{selectedVM.ip}</strong></>}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={labelStyle}>SSH User</label>
                    <input style={inputStyle} value={importUser}
                      onChange={e => { setImportUser(e.target.value); setSSHTestResult(null) }}
                      placeholder="deploy" />
                  </div>
                  <div>
                    <label style={labelStyle}>Roles (comma-separated)</label>
                    <input style={inputStyle} value={importRoles}
                      onChange={e => setImportRoles(e.target.value)}
                      placeholder="docker, monitoring" />
                  </div>
                </div>

                {/* SSH mode tabs */}
                <div style={{ display: 'flex', gap: '0', marginBottom: '0.75rem' }}>
                  {(['existing', 'generate', 'secret'] as const).map((mode, i, arr) => (
                    <button
                      key={mode}
                      style={{
                        padding: '0.35rem 0.75rem', fontSize: '0.8rem', cursor: 'pointer',
                        border: '1px solid #2a2a3e',
                        borderLeft: i === 0 ? '1px solid #2a2a3e' : 'none',
                        borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : '0',
                        background: sshMode === mode ? '#2a2a3e' : 'transparent',
                        color: sshMode === mode ? '#e0e0e0' : '#6b7280',
                      }}
                      onClick={() => {
                        setSSHMode(mode)
                        setImportKey(''); setImportPassword(''); setSelectedSecret('')
                        setSSHTestResult(null); setGenerateResult(null)
                      }}
                    >{{ existing: 'Paste Key', generate: 'Generate from Password', secret: 'Use Secret' }[mode]}</button>
                  ))}
                </div>

                {sshMode === 'existing' && (
                  <>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={labelStyle}>SSH Private Key (PEM)</label>
                      <textarea
                        style={{ ...inputStyle, minHeight: '6rem', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.75rem' }}
                        value={importKey}
                        onChange={e => { setImportKey(e.target.value); setSSHTestResult(null) }}
                        placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <button
                        style={{ ...btnSecondary, borderColor: '#22c55e', color: '#22c55e' }}
                        onClick={testSSH}
                        disabled={sshTesting || !importKey.trim() || !selectedVM.ip}
                      >
                        {sshTesting ? 'Testing...' : 'Test SSH'}
                      </button>
                      {!selectedVM.ip && (
                        <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>
                          VM has no IP — start it first to test SSH
                        </span>
                      )}
                      {sshTestResult && (
                        <span style={{ fontSize: '0.85rem', color: sshTestResult.success ? '#22c55e' : '#ef4444' }}>
                          {sshTestResult.detail}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {sshMode === 'generate' && (
                  <>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={labelStyle}>Password for {importUser}@{selectedVM.ip || '...'}</label>
                      <input
                        type="password"
                        style={inputStyle}
                        value={importPassword}
                        onChange={e => { setImportPassword(e.target.value); setGenerateResult(null) }}
                        placeholder="Enter SSH password"
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <button
                        style={{ ...btnSecondary, borderColor: '#22c55e', color: '#22c55e' }}
                        onClick={generateSSHKey}
                        disabled={generatingKey || !importPassword.trim() || !selectedVM.ip}
                      >
                        {generatingKey ? 'Generating...' : 'Generate & Deploy Key'}
                      </button>
                      {!selectedVM.ip && (
                        <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>
                          VM has no IP — start it first
                        </span>
                      )}
                      {generateResult && (
                        <span style={{ fontSize: '0.85rem', color: generateResult.success ? '#22c55e' : '#ef4444' }}>
                          {generateResult.detail}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {sshMode === 'secret' && (
                  <>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={labelStyle}>SSH Private Key Secret</label>
                      {secretKeys.length > 0 ? (
                        <select
                          style={inputStyle}
                          value={selectedSecret}
                          onChange={e => { setSelectedSecret(e.target.value); setSSHTestResult(null); setImportKey('') }}
                        >
                          <option value="">Select a secret...</option>
                          {secretKeys.map(k => (
                            <option key={k} value={k}>{k}</option>
                          ))}
                        </select>
                      ) : (
                        <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0.25rem 0' }}>
                          No SSH private key secrets found
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <button
                        style={{ ...btnSecondary, borderColor: '#22c55e', color: '#22c55e' }}
                        onClick={testSSHWithSecret}
                        disabled={sshTesting || !selectedSecret || !selectedVM.ip}
                      >
                        {sshTesting ? 'Testing...' : 'Test SSH'}
                      </button>
                      {!selectedVM.ip && (
                        <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>
                          VM has no IP — start it first to test SSH
                        </span>
                      )}
                      {sshTestResult && (
                        <span style={{ fontSize: '0.85rem', color: sshTestResult.success ? '#22c55e' : '#ef4444' }}>
                          {sshTestResult.detail}
                        </span>
                      )}
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button style={btnSecondary} onClick={closeImport}>Cancel</button>
                  <button
                    style={btnPrimary}
                    onClick={handleImport}
                    disabled={importing || !importKey.trim() || (!!selectedVM.ip && !sshTestResult?.success)}
                  >
                    {importing ? 'Importing...' : 'Import VM'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
