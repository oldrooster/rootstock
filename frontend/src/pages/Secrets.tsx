import { useEffect, useState } from 'react'

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

export default function Secrets() {
  const [keys, setKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  function loadKeys() {
    fetch('/api/secrets/')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setKeys)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadKeys() }, [])

  async function handleSave() {
    if (!newKey.trim() || !newValue.trim()) return
    try {
      const r = await fetch('/api/secrets/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey, value: newValue }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setShowAdd(false)
      setNewKey('')
      setNewValue('')
      loadKeys()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDelete(key: string) {
    try {
      const r = await fetch(`/api/secrets/${key}`, { method: 'DELETE' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      setDeleteConfirm(null)
      loadKeys()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Secrets</h1>
        {!showAdd && (
          <button style={btnPrimary} onClick={() => setShowAdd(true)}>
            Add Secret
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
        <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={labelStyle}>Key</label>
              <input style={inputStyle} value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder="proxmox/lappy/token_secret" />
            </div>
            <div>
              <label style={labelStyle}>Value</label>
              <input style={inputStyle} type="password" value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="secret value" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowAdd(false); setNewKey(''); setNewValue('') }}>Cancel</button>
            <button style={btnPrimary} onClick={handleSave}>Save</button>
          </div>
        </div>
      )}

      {keys.length === 0 && !showAdd && (
        <p style={{ color: '#8890a0' }}>No secrets stored yet.</p>
      )}

      {keys.length > 0 && (
        <div style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem' }}>
          {keys.map(key => (
            <div key={key} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.5rem 0',
              borderBottom: '1px solid #2a2a3e',
            }}>
              <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{key}</span>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                {deleteConfirm === key ? (
                  <>
                    <span style={{ color: '#fca5a5', fontSize: '0.85rem', alignSelf: 'center' }}>Delete?</span>
                    <button style={btnDanger} onClick={() => handleDelete(key)}>Confirm</button>
                    <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button style={btnSecondary} onClick={() => {
                      setNewKey(key)
                      setNewValue('')
                      setShowAdd(true)
                    }}>Update</button>
                    <button style={{ ...btnSecondary, borderColor: '#ef4444', color: '#ef4444' }}
                      onClick={() => setDeleteConfirm(key)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ color: '#8890a0', fontSize: '0.8rem', marginTop: '1rem' }}>
        Secrets are encrypted at rest with your ROOTSTOCK_SECRET_KEY. Use the key format: category/name/field (e.g., proxmox/lappy/token_secret).
      </p>
    </div>
  )
}
