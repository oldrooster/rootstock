import { useEffect, useRef, useState } from 'react'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'

interface Image {
  name: string
  type: 'iso' | 'cloud_image'
  download_url: string
  nodes: string[]
}

interface Node {
  name: string
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

const CLOUD_EXTS = ['.img', '.qcow2', '.raw']

function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    return path.split('/').pop() || ''
  } catch {
    return url.split('/').pop() || ''
  }
}

function typeFromFilename(name: string): 'iso' | 'cloud_image' {
  if (CLOUD_EXTS.some(ext => name.endsWith(ext))) return 'cloud_image'
  return 'iso'
}

const typeBadge = (type: string): React.CSSProperties => ({
  fontSize: '0.7rem',
  padding: '0.1rem 0.4rem',
  borderRadius: '4px',
  background: type === 'iso' ? '#1e3a5f' : '#3b1f5e',
  color: type === 'iso' ? '#7cb3f8' : '#c084fc',
})

/* ── MultiSelect ──────────────────────────────────────────────────────── */

function MultiSelect({ options, selected, onChange }: {
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as unknown as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const isAll = selected.includes('ALL')

  function toggle(value: string) {
    if (value === 'ALL') { onChange(['ALL']); return }
    let next = selected.filter(v => v !== 'ALL')
    if (next.includes(value)) next = next.filter(v => v !== value)
    else next.push(value)
    if (next.length === 0 || next.length === options.length) onChange(['ALL'])
    else onChange(next)
  }

  const label = isAll ? 'ALL' : selected.join(', ')

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(!open)} style={{
        ...inputStyle, cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', minHeight: '1.8rem', width: 'auto', minWidth: '120px',
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>{open ? '\u25B2' : '\u25BC'}</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, background: '#0f0f1a',
          border: '1px solid #2a2a3e', borderRadius: '4px', zIndex: 100, maxHeight: '200px',
          overflowY: 'auto', marginTop: '2px',
        }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.6rem',
            cursor: 'pointer', color: '#e0e0e0', fontSize: '0.85rem', borderBottom: '1px solid #2a2a3e',
          }}>
            <input type="checkbox" checked={isAll} onChange={() => toggle('ALL')} /> ALL
          </label>
          {options.map(opt => (
            <label key={opt} style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.6rem',
              cursor: 'pointer', color: '#e0e0e0', fontSize: '0.85rem',
            }}>
              <input type="checkbox" checked={isAll || selected.includes(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Main ─────────────────────────────────────────────────────────────── */

export default function Images() {
  const [images, setImages] = useState<Image[]>([])
  const [infraNodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [addHvs, setAddHvs] = useState<string[]>(['ALL'])
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editUrl, setEditUrl] = useState('')
  const [editHvs, setEditHvs] = useState<string[]>(['ALL'])
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  useUnsavedChanges(showAdd || editingName !== null)

  const nodeNames = infraNodes.filter(h => h.enabled).map(h => h.name)

  function load() {
    Promise.all([
      fetch('/api/images/').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/nodes/').then(r => r.json()),
    ]).then(([imgs, hvs]) => { setImages(imgs); setNodes(hvs) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const derivedName = filenameFromUrl(addUrl)
  const derivedType = typeFromFilename(derivedName)

  async function handleAdd() {
    if (!addUrl.trim() || !derivedName) return
    try {
      const r = await fetch('/api/images/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: derivedName, type: derivedType, download_url: addUrl, nodes: addHvs }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setShowAdd(false)
      setAddUrl('')
      setAddHvs(['ALL'])
      load()
    } catch (e) { setError((e as Error).message) }
  }

  async function handleUpdate(name: string) {
    try {
      const newName = filenameFromUrl(editUrl)
      const newType = typeFromFilename(newName || name)
      const r = await fetch(`/api/images/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ download_url: editUrl, nodes: editHvs, type: newType }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setEditingName(null)
      load()
    } catch (e) { setError((e as Error).message) }
  }

  async function handleDelete(name: string) {
    try {
      const r = await fetch(`/api/images/${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setDeleteConfirm(null)
      load()
    } catch (e) { setError((e as Error).message) }
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Images</h1>
        {!showAdd && (
          <button style={btnPrimary} onClick={() => setShowAdd(true)}>Add Image</button>
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
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={labelStyle}>Download URL</label>
              <input style={inputStyle} value={addUrl} onChange={e => setAddUrl(e.target.value)}
                placeholder="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img" />
              {derivedName && (
                <div style={{ color: '#8890a0', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  Name: <strong style={{ color: '#e0e0e0' }}>{derivedName}</strong>
                  <span style={{ margin: '0 0.5rem' }}>|</span>
                  Type: <span style={typeBadge(derivedType)}>{derivedType === 'iso' ? 'ISO' : 'Cloud Image'}</span>
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Nodes</label>
              <MultiSelect options={nodeNames} selected={addHvs} onChange={setAddHvs} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowAdd(false); setAddUrl(''); setAddHvs(['ALL']) }}>Cancel</button>
            <button style={btnPrimary} onClick={handleAdd} disabled={!derivedName}>Create</button>
          </div>
        </div>
      )}

      {images.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No images configured yet.</p>
      )}

      {images.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#1a1a2e', borderRadius: '6px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Name</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Type</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Download URL</th>
              <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Nodes</th>
              <th style={{ textAlign: 'right', color: '#8890a0', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {images.map(img => (
              <tr key={img.name} style={{ borderBottom: '1px solid #2a2a3e' }}>
                {editingName === img.name ? (
                  <>
                    <td style={{ color: '#e0e0e0', padding: '0.4rem 0.75rem', fontSize: '0.9rem' }}>{img.name}</td>
                    <td style={{ padding: '0.4rem 0.75rem' }}>
                      <span style={typeBadge(img.type)}>{img.type === 'iso' ? 'ISO' : 'Cloud'}</span>
                    </td>
                    <td style={{ padding: '0.4rem 0.75rem' }}>
                      <input style={{ ...inputStyle, width: '100%' }} value={editUrl} onChange={e => setEditUrl(e.target.value)} />
                    </td>
                    <td style={{ padding: '0.4rem 0.75rem' }}>
                      <MultiSelect options={nodeNames} selected={editHvs} onChange={setEditHvs} />
                    </td>
                    <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button style={btnSecondary} onClick={() => setEditingName(null)}>Cancel</button>
                        <button style={btnPrimary} onClick={() => handleUpdate(img.name)}>Save</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ color: '#e0e0e0', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}>{img.name}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>
                      <span style={typeBadge(img.type)}>{img.type === 'iso' ? 'ISO' : 'Cloud'}</span>
                    </td>
                    <td style={{ color: '#8890a0', padding: '0.6rem 0.75rem', fontSize: '0.85rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {img.download_url || <span style={{ color: '#555' }}>—</span>}
                    </td>
                    <td style={{ color: '#b0b8d0', padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>
                      {img.nodes.includes('ALL') ? (
                        <span style={{ background: '#1e3a5f', color: '#7cb3f8', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem' }}>ALL</span>
                      ) : (
                        img.nodes.map(h => (
                          <span key={h} style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', color: '#b0b8d0', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', marginRight: '0.3rem' }}>{h}</span>
                        ))
                      )}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                      {deleteConfirm === img.name ? (
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                          <span style={{ color: '#fca5a5', fontSize: '0.85rem' }}>Delete?</span>
                          <button style={btnDanger} onClick={() => handleDelete(img.name)}>Confirm</button>
                          <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                          <button style={btnSecondary} onClick={() => {
                            setEditingName(img.name)
                            setEditUrl(img.download_url)
                            setEditHvs([...img.nodes])
                          }}>Edit</button>
                          <button style={{ ...btnSecondary, borderColor: '#ef4444', color: '#ef4444' }} onClick={() => setDeleteConfirm(img.name)}>Delete</button>
                        </div>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
