import { useEffect, useState, useCallback } from 'react'

interface Role {
  name: string
  description: string
}

interface MatrixHost {
  name: string
  type: string
  roles: string[]
}

interface MatrixData {
  roles: string[]
  hosts: MatrixHost[]
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

type View = 'list' | 'editor' | 'matrix'

/* ── File Editor ─────────────────────────────────────────────────────── */

function FileEditor({ roleName, onBack }: { roleName: string; onBack: () => void }) {
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)

  const loadFiles = useCallback(() => {
    fetch(`/api/roles/${encodeURIComponent(roleName)}/files`)
      .then(r => r.json())
      .then(setFiles)
      .catch(e => setError(e.message))
  }, [roleName])

  useEffect(() => { loadFiles() }, [loadFiles])

  function openFile(path: string) {
    fetch(`/api/roles/${encodeURIComponent(roleName)}/files/${path}`)
      .then(r => r.json())
      .then(data => {
        setSelectedFile(path)
        setContent(data.content)
        setSavedContent(data.content)
        setError(null)
      })
      .catch(e => setError(e.message))
  }

  async function saveFile() {
    if (!selectedFile) return
    setSaving(true)
    try {
      const r = await fetch(`/api/roles/${encodeURIComponent(roleName)}/files/${selectedFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setSavedContent(content)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteFile(path: string) {
    try {
      const r = await fetch(`/api/roles/${encodeURIComponent(roleName)}/files/${path}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      if (selectedFile === path) {
        setSelectedFile(null)
        setContent('')
        setSavedContent('')
      }
      loadFiles()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function createFile() {
    if (!newFileName.trim()) return
    try {
      const r = await fetch(`/api/roles/${encodeURIComponent(roleName)}/files/${newFileName.trim()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setShowNewFile(false)
      setNewFileName('')
      loadFiles()
      openFile(newFileName.trim())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const isDirty = content !== savedContent

  // Build file tree from flat paths
  function buildTree(paths: string[]): { label: string; path?: string; children?: ReturnType<typeof buildTree> }[] {
    const tree: Record<string, string[]> = {}
    const leafs: string[] = []
    for (const p of paths) {
      const parts = p.split('/')
      if (parts.length === 1) {
        leafs.push(p)
      } else {
        const dir = parts[0]
        const rest = parts.slice(1).join('/')
        if (!tree[dir]) tree[dir] = []
        tree[dir].push(rest)
      }
    }
    const result: { label: string; path?: string; children?: ReturnType<typeof buildTree> }[] = []
    for (const dir of Object.keys(tree).sort()) {
      result.push({ label: dir + '/', children: buildTree(tree[dir]) })
    }
    for (const f of leafs.sort()) {
      result.push({ label: f, path: paths.find(p => p === f || p.endsWith('/' + f)) || f })
    }
    return result
  }

  function TreeNode({ node, prefix }: { node: ReturnType<typeof buildTree>[0]; prefix: string }) {
    const fullPath = node.path ? (prefix ? prefix + '/' + node.path : node.path) : undefined
    // For directory nodes, recalculate full paths for children
    const dirPrefix = node.children ? (prefix ? prefix + '/' + node.label.replace('/', '') : node.label.replace('/', '')) : prefix

    if (node.children) {
      return (
        <div>
          <div style={{ color: '#8890a0', fontSize: '0.8rem', padding: '0.2rem 0', fontWeight: 600 }}>
            {node.label}
          </div>
          <div style={{ paddingLeft: '0.75rem' }}>
            {node.children.map((child, i) => (
              <TreeNode key={i} node={child} prefix={dirPrefix} />
            ))}
          </div>
        </div>
      )
    }

    const filePath = prefix ? prefix + '/' + node.label : node.label
    const isActive = selectedFile === filePath

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <button
          onClick={() => openFile(filePath)}
          style={{
            background: isActive ? 'rgba(124,158,248,0.15)' : 'transparent',
            border: 'none',
            color: isActive ? '#7c9ef8' : '#b0b8d0',
            cursor: 'pointer',
            fontSize: '0.8rem',
            padding: '0.2rem 0.35rem',
            borderRadius: '3px',
            textAlign: 'left',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.label}
        </button>
        <button
          onClick={() => { if (confirm(`Delete ${filePath}?`)) deleteFile(filePath) }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: '0.7rem',
            padding: '0.1rem 0.25rem',
            opacity: 0.6,
            flexShrink: 0,
          }}
        >
          x
        </button>
      </div>
    )
  }

  const treeNodes = buildTree(files)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button style={btnSecondary} onClick={onBack}>Back</button>
        <h2 style={{ color: '#e0e0e0', margin: 0, fontSize: '1.1rem' }}>Role: {roleName}</h2>
      </div>

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button style={{ ...btnSecondary, border: 'none', color: '#fca5a5' }} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', height: 'calc(100vh - 200px)' }}>
        {/* File tree */}
        <div style={{
          width: '220px',
          flexShrink: 0,
          background: '#1a1a2e',
          borderRadius: '6px',
          padding: '0.75rem',
          overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase' }}>Files</span>
            <button
              onClick={() => setShowNewFile(!showNewFile)}
              style={{ background: 'transparent', border: 'none', color: '#7c9ef8', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              + New
            </button>
          </div>
          {showNewFile && (
            <div style={{ marginBottom: '0.5rem' }}>
              <input
                style={{ ...inputStyle, fontSize: '0.8rem', padding: '0.25rem 0.4rem', marginBottom: '0.25rem' }}
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createFile() }}
                placeholder="templates/config.j2"
                autoFocus
              />
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button style={{ ...btnPrimary, fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={createFile}>Add</button>
                <button style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={() => { setShowNewFile(false); setNewFileName('') }}>Cancel</button>
              </div>
            </div>
          )}
          {treeNodes.map((node, i) => (
            <TreeNode key={i} node={node} prefix="" />
          ))}
          {files.length === 0 && (
            <div style={{ color: '#8890a0', fontSize: '0.8rem', fontStyle: 'italic' }}>No files yet</div>
          )}
        </div>

        {/* Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {selectedFile ? (
            <>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.5rem',
              }}>
                <span style={{ color: '#b0b8d0', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                  {selectedFile}
                  {isDirty && <span style={{ color: '#fde68a', marginLeft: '0.5rem' }}>(unsaved)</span>}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    style={btnPrimary}
                    onClick={saveFile}
                    disabled={saving || !isDirty}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                    e.preventDefault()
                    if (isDirty) saveFile()
                  }
                  // Tab support
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    const target = e.target as HTMLTextAreaElement
                    const start = target.selectionStart
                    const end = target.selectionEnd
                    const newContent = content.substring(0, start) + '  ' + content.substring(end)
                    setContent(newContent)
                    setTimeout(() => {
                      target.selectionStart = target.selectionEnd = start + 2
                    }, 0)
                  }
                }}
                spellCheck={false}
                style={{
                  flex: 1,
                  background: '#0f0f1a',
                  border: '1px solid #2a2a3e',
                  color: '#e0e0e0',
                  borderRadius: '6px',
                  padding: '0.75rem',
                  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                  fontSize: '0.85rem',
                  lineHeight: 1.6,
                  resize: 'none',
                  outline: 'none',
                  tabSize: 2,
                }}
              />
            </>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#1a1a2e',
              borderRadius: '6px',
              color: '#8890a0',
              fontSize: '0.9rem',
            }}>
              Select a file from the tree to edit
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Assignment Matrix ───────────────────────────────────────────────── */

function AssignmentMatrix({ onBack }: { onBack: () => void }) {
  const [matrix, setMatrix] = useState<MatrixData | null>(null)
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    fetch('/api/roles/matrix')
      .then(r => r.json())
      .then((data: MatrixData) => {
        setMatrix(data)
        const a: Record<string, string[]> = {}
        for (const host of data.hosts) {
          a[host.name] = [...host.roles]
        }
        setAssignments(a)
      })
      .catch(e => setError(e.message))
  }, [])

  function toggle(hostName: string, roleName: string) {
    setAssignments(prev => {
      const current = prev[hostName] || []
      const next = current.includes(roleName)
        ? current.filter(r => r !== roleName)
        : [...current, roleName]
      setDirty(true)
      return { ...prev, [hostName]: next }
    })
  }

  async function save() {
    setSaving(true)
    try {
      const r = await fetch('/api/roles/matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!matrix) return <p style={{ color: '#8890a0' }}>Loading...</p>

  const typeBadge = (type: string): React.CSSProperties => ({
    fontSize: '0.65rem',
    padding: '0.1rem 0.4rem',
    borderRadius: '9999px',
    background: type === 'node' ? '#1e3a5f' : '#1a3a1a',
    color: type === 'node' ? '#7cb3f8' : '#86efac',
    marginLeft: '0.35rem',
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button style={btnSecondary} onClick={onBack}>Back</button>
        <h2 style={{ color: '#e0e0e0', margin: 0, fontSize: '1.1rem' }}>Role Assignments</h2>
        {dirty && (
          <button style={btnPrimary} onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem' }}>
          {error}
        </div>
      )}

      {matrix.roles.length === 0 ? (
        <p style={{ color: '#8890a0' }}>No roles defined yet. Create a role first.</p>
      ) : matrix.hosts.length === 0 ? (
        <p style={{ color: '#8890a0' }}>No nodes or VMs configured yet.</p>
      ) : (
        <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  Host
                </th>
                {matrix.roles.map(role => (
                  <th key={role} style={{ textAlign: 'center', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.hosts.map(host => (
                <tr key={host.name} style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#e0e0e0', fontSize: '0.85rem' }}>{host.name}</span>
                    <span style={typeBadge(host.type)}>{host.type}</span>
                  </td>
                  {matrix.roles.map(role => (
                    <td key={role} style={{ textAlign: 'center', padding: '0.5rem 0.75rem' }}>
                      <input
                        type="checkbox"
                        checked={(assignments[host.name] || []).includes(role)}
                        onChange={() => toggle(host.name, role)}
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ── Main Page ───────────────────────────────────────────────────────── */

export default function Roles() {
  const [roles, setRoles] = useState<Role[]>([])
  const [roleOrder, setRoleOrder] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [view, setView] = useState<View>('list')
  const [editorRole, setEditorRole] = useState<string | null>(null)

  function loadRoles() {
    Promise.all([
      fetch('/api/roles/').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/roles/order').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
    ])
      .then(([r, o]) => { setRoles(r); setRoleOrder(o) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadRoles() }, [])

  async function saveOrder(newOrder: string[]) {
    setRoleOrder(newOrder)
    try {
      const r = await fetch('/api/roles/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: newOrder }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function moveRole(name: string, direction: -1 | 1) {
    const idx = roleOrder.indexOf(name)
    if (idx < 0) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= roleOrder.length) return
    const next = [...roleOrder]
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    saveOrder(next)
  }

  async function handleCreate() {
    try {
      const r = await fetch('/api/roles/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName, description: addDesc }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setShowAdd(false)
      setAddName('')
      setAddDesc('')
      loadRoles()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleUpdate(name: string) {
    try {
      const r = await fetch(`/api/roles/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editDesc }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setEditingName(null)
      loadRoles()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDelete(name: string) {
    try {
      const r = await fetch(`/api/roles/${name}`, { method: 'DELETE' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setDeleteConfirm(null)
      loadRoles()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (view === 'editor' && editorRole) {
    return <FileEditor roleName={editorRole} onBack={() => { setView('list'); setEditorRole(null); loadRoles() }} />
  }

  if (view === 'matrix') {
    return <AssignmentMatrix onBack={() => setView('list')} />
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Roles</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button style={btnSecondary} onClick={() => setView('matrix')}>Assignment Matrix</button>
          {!showAdd && (
            <button style={btnPrimary} onClick={() => setShowAdd(true)}>Add Role</button>
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
        <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input style={inputStyle} value={addName}
                onChange={e => setAddName(e.target.value)} placeholder="docker" />
            </div>
            <div>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={addDesc}
                onChange={e => setAddDesc(e.target.value)} placeholder="Install and configure Docker Engine" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowAdd(false); setAddName(''); setAddDesc('') }}>Cancel</button>
            <button style={btnPrimary} onClick={handleCreate} disabled={!addName.trim()}>Create</button>
          </div>
        </div>
      )}

      {roles.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No roles defined yet.</p>
      )}

      {roleOrder.length > 0 && (
        <div style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
          Execution Order (top runs first)
        </div>
      )}

      {/* Roles ordered by execution order */}
      {roleOrder.map((name, idx) => {
        const role = roles.find(r => r.name === name)
        if (!role) return null
        return (
        <div key={role.name} style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          {/* Order controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flexShrink: 0, paddingTop: '0.1rem' }}>
            <button
              style={{
                background: 'transparent', border: '1px solid #2a2a3e', color: idx === 0 ? '#333' : '#8890a0',
                borderRadius: '3px', width: '1.5rem', height: '1.3rem', cursor: idx === 0 ? 'default' : 'pointer',
                fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
              onClick={() => moveRole(role.name, -1)}
              disabled={idx === 0}
              title="Move up (run earlier)"
            >{'\u25B2'}</button>
            <span style={{ color: '#555', fontSize: '0.7rem', textAlign: 'center', lineHeight: 1 }}>{idx + 1}</span>
            <button
              style={{
                background: 'transparent', border: '1px solid #2a2a3e', color: idx === roleOrder.length - 1 ? '#333' : '#8890a0',
                borderRadius: '3px', width: '1.5rem', height: '1.3rem', cursor: idx === roleOrder.length - 1 ? 'default' : 'pointer',
                fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
              onClick={() => moveRole(role.name, 1)}
              disabled={idx === roleOrder.length - 1}
              title="Move down (run later)"
            >{'\u25BC'}</button>
          </div>

          {/* Role content */}
          <div style={{ flex: 1, minWidth: 0 }}>
          {editingName === role.name ? (
            <div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={labelStyle}>Description</label>
                <input style={inputStyle} value={editDesc}
                  onChange={e => setEditDesc(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button style={btnSecondary} onClick={() => setEditingName(null)}>Cancel</button>
                <button style={btnPrimary} onClick={() => handleUpdate(role.name)}>Save</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>{role.name}</div>
                {role.description && (
                  <div style={{ color: '#8890a0', fontSize: '0.85rem' }}>{role.description}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                {deleteConfirm === role.name ? (
                  <>
                    <span style={{ color: '#fca5a5', fontSize: '0.85rem', alignSelf: 'center' }}>Delete?</span>
                    <button style={btnDanger} onClick={() => handleDelete(role.name)}>Confirm</button>
                    <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button style={{ ...btnSecondary, borderColor: '#7c9ef8', color: '#7c9ef8' }}
                      onClick={() => { setEditorRole(role.name); setView('editor') }}>
                      Edit Files
                    </button>
                    <button style={btnSecondary} onClick={() => { setEditingName(role.name); setEditDesc(role.description) }}>Edit</button>
                    <button style={{ ...btnSecondary, borderColor: '#ef4444', color: '#ef4444' }}
                      onClick={() => setDeleteConfirm(role.name)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
        )
      })}
    </div>
  )
}
