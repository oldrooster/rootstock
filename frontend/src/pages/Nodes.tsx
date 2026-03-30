import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'

const Terminal = lazy(() => import('../components/Terminal'))

interface Node {
  name: string
  type: string
  endpoint: string
  node_name: string
  username: string
  token_name: string
  ssh_user: string
  roles: string[]
  enabled: boolean
}

const NODE_TYPES = ['proxmox', 'bare-metal']

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
  type: string
  endpoint: string
  node_name: string
  username: string
  token_name: string
  ssh_user: string
  roles: string
  enabled: boolean
}

const emptyForm: FormData = {
  name: '', type: 'proxmox', endpoint: '', node_name: '', username: 'root@pam',
  token_name: '', ssh_user: 'root', roles: '', enabled: true,
}

function nodeToForm(n: Node): FormData {
  return {
    name: n.name,
    type: n.type,
    endpoint: n.endpoint,
    node_name: n.node_name,
    username: n.username,
    token_name: n.token_name,
    ssh_user: n.ssh_user || 'root',
    roles: (n.roles || []).join(', '),
    enabled: n.enabled,
  }
}

function formToPayload(f: FormData) {
  return {
    name: f.name,
    type: f.type,
    endpoint: f.endpoint,
    node_name: f.node_name,
    username: f.username,
    token_name: f.token_name,
    ssh_user: f.ssh_user,
    roles: f.roles.split(',').map(s => s.trim()).filter(Boolean),
    enabled: f.enabled,
  }
}

function SecretStatus({ label, secretKey, exists }: {
  label: string
  secretKey: string
  exists: boolean
}) {
  return (
    <div style={{
      padding: '0.4rem 0.75rem',
      borderRadius: '4px',
      fontSize: '0.8rem',
      marginBottom: '0.5rem',
      background: exists ? '#166534' : '#78350f',
      color: exists ? '#86efac' : '#fde68a',
    }}>
      {exists ? (
        <span>{label}: <code style={{ fontFamily: 'monospace' }}>{secretKey}</code> is configured. <Link to={`/secrets?key=${encodeURIComponent(secretKey)}`} style={{ color: '#86efac', textDecoration: 'underline' }}>Update</Link></span>
      ) : (
        <span>{label}: missing <code style={{ fontFamily: 'monospace' }}>{secretKey}</code> — <Link to={`/secrets?key=${encodeURIComponent(secretKey)}`} style={{ color: '#fde68a', textDecoration: 'underline' }}>create it</Link></span>
      )}
    </div>
  )
}

const typeBadge = (type: string): React.CSSProperties => ({
  fontSize: '0.7rem',
  padding: '0.15rem 0.5rem',
  borderRadius: '9999px',
  background: type === 'proxmox' ? '#1e3a5f' : '#3b1f5e',
  color: type === 'proxmox' ? '#7cb3f8' : '#c084fc',
})

function NodeForm({ form, setForm, onSubmit, onCancel, submitLabel, disableName, secretKeys }: {
  form: FormData
  setForm: (f: FormData) => void
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  disableName?: boolean
  secretKeys: string[]
}) {
  const isProxmox = form.type === 'proxmox'
  const tokenSecret = form.name && isProxmox ? `proxmox/${form.name}/token_secret` : null
  const sshSecret = form.name ? `proxmox/${form.name}/ssh_private_key` : null
  const set = (field: keyof FormData, value: string | boolean) =>
    setForm({ ...form, [field]: value })

  return (
    <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: isProxmox ? '1fr 1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={form.name} disabled={disableName}
            onChange={e => set('name', e.target.value)} placeholder="g2mini" />
        </div>
        <div>
          <label style={labelStyle}>Type</label>
          <select style={inputStyle} value={form.type} onChange={e => set('type', e.target.value)}>
            {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Endpoint</label>
          <input style={inputStyle} value={form.endpoint}
            onChange={e => set('endpoint', e.target.value)} placeholder={isProxmox ? 'https://10.0.0.5:8006' : '10.0.0.10'} />
        </div>
        <div>
          <label style={labelStyle}>SSH User</label>
          <input style={inputStyle} value={form.ssh_user}
            onChange={e => set('ssh_user', e.target.value)} placeholder="root" />
        </div>
        <div>
          <label style={labelStyle}>Roles</label>
          <input style={inputStyle} value={form.roles}
            onChange={e => set('roles', e.target.value)} placeholder="docker, monitoring" />
        </div>
        {isProxmox && (
          <div>
            <label style={labelStyle}>Node Name</label>
            <input style={inputStyle} value={form.node_name}
              onChange={e => set('node_name', e.target.value)} placeholder="pve" />
          </div>
        )}
      </div>

      {isProxmox && (
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
      )}

      {tokenSecret && (
        <SecretStatus label="API Token" secretKey={tokenSecret} exists={secretKeys.includes(tokenSecret)} />
      )}
      {sshSecret && (
        <SecretStatus label="SSH Key" secretKey={sshSecret} exists={secretKeys.includes(sshSecret)} />
      )}

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

/* ── Main Page ───────────────────────────────────────────────────────── */

export default function Nodes() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<FormData>(emptyForm)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormData>(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  useUnsavedChanges(showAdd || editingName !== null)
  const [testingName, setTestingName] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ name: string; success: boolean; api_ok: boolean; ssh_ok: boolean; message: string } | null>(null)
  const [secretKeys, setSecretKeys] = useState<string[]>([])
  const [sshSetupName, setSshSetupName] = useState<string | null>(null)
  const [sshSetupUser, setSshSetupUser] = useState('root')
  const [sshSetupPass, setSshSetupPass] = useState('')
  const [sshSetupLoading, setSshSetupLoading] = useState(false)
  const [sshSetupResult, setSshSetupResult] = useState<{ name: string; success: boolean; message: string; public_key?: string } | null>(null)
  const [terminalNode, setTerminalNode] = useState<string | null>(null)

  function loadSecretKeys() {
    fetch('/api/secrets/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setSecretKeys)
      .catch(() => {})
  }

  function loadNodes() {
    fetch('/api/nodes/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setNodes)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadNodes(); loadSecretKeys() }, [])

  async function handleCreate() {
    try {
      const r = await fetch('/api/nodes/', {
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
      loadNodes()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleUpdate(name: string) {
    try {
      const payload = formToPayload(editForm)
      const { name: _, ...patchPayload } = payload
      const r = await fetch(`/api/nodes/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchPayload),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setEditingName(null)
      loadNodes()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDelete(name: string) {
    try {
      const r = await fetch(`/api/nodes/${name}`, { method: 'DELETE' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setDeleteConfirm(null)
      loadNodes()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleTest(name: string) {
    setTestingName(name)
    setTestResult(null)
    try {
      const r = await fetch(`/api/nodes/${name}/test`, { method: 'POST' })
      const data = await r.json()
      setTestResult({ name, success: data.success, api_ok: data.api_ok, ssh_ok: data.ssh_ok, message: data.message })
    } catch (e) {
      setTestResult({ name, success: false, api_ok: false, ssh_ok: false, message: (e as Error).message })
    } finally {
      setTestingName(null)
    }
  }

  async function handleSSHSetup(name: string) {
    setSshSetupLoading(true)
    setSshSetupResult(null)
    try {
      const r = await fetch(`/api/nodes/${name}/setup-ssh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: sshSetupUser, password: sshSetupPass }),
      })
      const data = await r.json()
      setSshSetupResult({ name, success: data.success, message: data.message, public_key: data.public_key })
      if (data.success) {
        setSshSetupName(null)
        setSshSetupPass('')
        loadSecretKeys()
      }
    } catch (e) {
      setSshSetupResult({ name, success: false, message: (e as Error).message })
    } finally {
      setSshSetupLoading(false)
    }
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Nodes</h1>
        {!showAdd && (
          <button style={btnPrimary} onClick={() => { setShowAdd(true); setAddForm(emptyForm) }}>
            Add Node
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
        <NodeForm
          form={addForm}
          setForm={setAddForm}
          onSubmit={handleCreate}
          onCancel={() => setShowAdd(false)}
          submitLabel="Create"
          secretKeys={secretKeys}
        />
      )}

      {nodes.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No nodes configured yet.</p>
      )}

      {nodes.map(node => {
        const isProxmox = node.type === 'proxmox'
        const tokenKey = `proxmox/${node.name}/token_secret`
        const sshKey = `proxmox/${node.name}/ssh_private_key`
        const hasToken = secretKeys.includes(tokenKey)
        const hasSSH = secretKeys.includes(sshKey)
        const missingSecrets: { label: string; key: string }[] = []
        if (isProxmox && node.token_name && !hasToken) missingSecrets.push({ label: 'API Token', key: tokenKey })
        if (!hasSSH) missingSecrets.push({ label: 'SSH Key', key: sshKey })

        return (
          <div key={node.name} style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
            {editingName === node.name ? (
              <NodeForm
                form={editForm}
                setForm={setEditForm}
                onSubmit={() => handleUpdate(node.name)}
                onCancel={() => setEditingName(null)}
                submitLabel="Save"
                disableName
                secretKeys={secretKeys}
              />
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '1rem' }}>{node.name}</span>
                    <span style={typeBadge(node.type)}>{node.type}</span>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '9999px',
                      background: node.enabled ? '#166534' : '#7f1d1d',
                      color: node.enabled ? '#86efac' : '#fca5a5',
                    }}>
                      {node.enabled ? 'enabled' : 'disabled'}
                    </span>
                    {(node.roles || []).map(r => (
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
                    {node.endpoint && (
                      <span>Endpoint: <strong style={{ color: '#b0b8d0' }}>{node.endpoint}</strong></span>
                    )}
                    {isProxmox && node.node_name && (
                      <>
                        <span style={{ margin: '0 0.75rem' }}>|</span>
                        <span>PVE Node: <strong style={{ color: '#b0b8d0' }}>{node.node_name}</strong></span>
                      </>
                    )}
                    {isProxmox && (
                      <>
                        <span style={{ margin: '0 0.75rem' }}>|</span>
                        <span>User: <strong style={{ color: '#b0b8d0' }}>{node.username}</strong></span>
                      </>
                    )}
                    {isProxmox && node.token_name && (
                      <>
                        <span style={{ margin: '0 0.75rem' }}>|</span>
                        <span>Token: <strong style={{ color: '#b0b8d0' }}>{node.token_name}</strong></span>
                      </>
                    )}
                  </div>
                  {missingSecrets.length > 0 && (
                    <div style={{ fontSize: '0.8rem', marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                      {missingSecrets.map(({ label, key }) => (
                        <span key={key} style={{ color: '#fde68a' }}>
                          Missing {label}: <code style={{ fontFamily: 'monospace' }}>{key}</code> — <Link to={`/secrets?key=${encodeURIComponent(key)}`} style={{ color: '#fde68a', textDecoration: 'underline' }}>create</Link>
                        </span>
                      ))}
                      {!hasSSH && sshSetupName !== node.name && (
                        <button style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                          onClick={() => { setSshSetupName(node.name); setSshSetupUser(node.ssh_user || 'root'); setSshSetupPass(''); setSshSetupResult(null) }}>
                          Setup SSH Key
                        </button>
                      )}
                    </div>
                  )}
                  {sshSetupName === node.name && (
                    <div style={{ marginTop: '0.5rem', background: '#0f0f1a', borderRadius: '4px', padding: '0.75rem' }}>
                      <div style={{ fontSize: '0.8rem', color: '#8890a0', marginBottom: '0.5rem' }}>
                        Generate an SSH keypair and install it on the host via password authentication.
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                        <div>
                          <label style={{ ...labelStyle, marginBottom: '0.15rem' }}>SSH Username</label>
                          <input style={{ ...inputStyle, width: '120px' }} value={sshSetupUser}
                            onChange={e => setSshSetupUser(e.target.value)} />
                        </div>
                        <div>
                          <label style={{ ...labelStyle, marginBottom: '0.15rem' }}>Password</label>
                          <input style={{ ...inputStyle, width: '200px' }} type="password" value={sshSetupPass}
                            onChange={e => setSshSetupPass(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && sshSetupPass) handleSSHSetup(node.name) }} />
                        </div>
                        <button style={btnPrimary} disabled={!sshSetupPass || sshSetupLoading}
                          onClick={() => handleSSHSetup(node.name)}>
                          {sshSetupLoading ? 'Installing...' : 'Install Key'}
                        </button>
                        <button style={btnSecondary} onClick={() => { setSshSetupName(null); setSshSetupResult(null) }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {sshSetupResult?.name === node.name && (
                    <div style={{
                      marginTop: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '4px',
                      fontSize: '0.85rem',
                      background: sshSetupResult.success ? '#166534' : '#7f1d1d',
                      color: sshSetupResult.success ? '#86efac' : '#fca5a5',
                    }}>
                      <div>{sshSetupResult.message}</div>
                      {sshSetupResult.public_key && (
                        <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.85 }}>
                          {sshSetupResult.public_key}
                        </div>
                      )}
                      <button
                        style={{ ...btnSecondary, border: 'none', fontSize: '0.75rem', padding: '0.2rem 0.5rem', marginTop: '0.25rem' }}
                        onClick={() => setSshSetupResult(null)}
                      >
                        dismiss
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                  {deleteConfirm === node.name ? (
                    <>
                      <span style={{ color: '#fca5a5', fontSize: '0.85rem', alignSelf: 'center' }}>Delete?</span>
                      <button style={btnDanger} onClick={() => handleDelete(node.name)}>Confirm</button>
                      <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      {hasSSH && (
                        <button style={{ ...btnSecondary, borderColor: '#22c55e', color: '#22c55e' }}
                          onClick={() => setTerminalNode(node.name)}>
                          SSH
                        </button>
                      )}
                      <button style={btnSecondary} onClick={() => handleTest(node.name)}
                        disabled={testingName === node.name}>
                        {testingName === node.name ? 'Testing...' : 'Test'}
                      </button>
                      <button style={btnSecondary} onClick={() => {
                        setEditingName(node.name)
                        setEditForm(nodeToForm(node))
                      }}>Edit</button>
                      <button style={{ ...btnSecondary, borderColor: '#ef4444', color: '#ef4444' }}
                        onClick={() => setDeleteConfirm(node.name)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            )}
            {testResult?.name === node.name && (
              <div style={{
                marginTop: '0.5rem',
                borderRadius: '4px',
                fontSize: '0.85rem',
                overflow: 'hidden',
              }}>
                {testResult.message.split('\n').map((line, i) => {
                  const isApi = line.startsWith('API:')
                  const isSsh = line.startsWith('SSH:')
                  const ok = isApi ? testResult.api_ok : isSsh ? testResult.ssh_ok : testResult.success
                  return (
                    <div key={i} style={{
                      padding: '0.4rem 0.75rem',
                      background: ok ? '#166534' : '#7f1d1d',
                      color: ok ? '#86efac' : '#fca5a5',
                      borderBottom: i < testResult.message.split('\n').length - 1 ? '1px solid rgba(0,0,0,0.2)' : 'none',
                    }}>
                      {line}
                    </div>
                  )
                })}
                <button
                  style={{ ...btnSecondary, border: 'none', fontSize: '0.75rem', padding: '0.2rem 0.5rem', marginTop: '0.25rem' }}
                  onClick={() => setTestResult(null)}
                >
                  dismiss
                </button>
              </div>
            )}
          </div>
        )
      })}

      {terminalNode && (
        <Suspense fallback={null}>
          <Terminal
            wsPath={`/api/terminal/node/${encodeURIComponent(terminalNode)}/terminal`}
            title={terminalNode}
            onClose={() => setTerminalNode(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
