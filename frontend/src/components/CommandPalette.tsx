import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface Command {
  id: string
  label: string
  category: string
  path?: string
  action?: () => void
  keywords?: string[]
}

const COMMANDS: Command[] = [
  // Navigation
  { id: 'nav-dashboard', label: 'Dashboard', category: 'Navigate', path: '/dashboard', keywords: ['home', 'overview'] },
  { id: 'nav-containers', label: 'Containers', category: 'Navigate', path: '/containers', keywords: ['docker', 'services'] },
  { id: 'nav-vms', label: 'VMs', category: 'Navigate', path: '/vms', keywords: ['virtual machines', 'proxmox'] },
  { id: 'nav-nodes', label: 'Nodes', category: 'Navigate', path: '/nodes', keywords: ['hosts', 'servers'] },
  { id: 'nav-images', label: 'Images', category: 'Navigate', path: '/images', keywords: ['cloud images', 'iso'] },
  { id: 'nav-templates', label: 'Templates', category: 'Navigate', path: '/templates', keywords: ['vm templates'] },
  { id: 'nav-roles', label: 'Roles', category: 'Navigate', path: '/roles', keywords: ['ansible', 'roles'] },
  { id: 'nav-dns', label: 'DNS', category: 'Navigate', path: '/dns', keywords: ['pihole', 'dns records'] },
  { id: 'nav-ingress', label: 'Ingress', category: 'Navigate', path: '/ingress', keywords: ['caddy', 'reverse proxy', 'cloudflare'] },
  { id: 'nav-backups', label: 'Backups', category: 'Navigate', path: '/backups', keywords: ['backup', 's3', 'restore'] },
  { id: 'nav-git', label: 'Git', category: 'Navigate', path: '/git', keywords: ['git', 'commit', 'history'] },
  { id: 'nav-apply', label: 'Apply', category: 'Navigate', path: '/apply', keywords: ['terraform', 'ansible', 'deploy'] },
  { id: 'nav-stats', label: 'Stats', category: 'Navigate', path: '/stats', keywords: ['statistics', 'metrics'] },
  { id: 'nav-secrets', label: 'Secrets', category: 'Navigate', path: '/secrets', keywords: ['secrets', 'passwords', 'tokens'] },
  { id: 'nav-settings', label: 'Settings', category: 'Navigate', path: '/settings', keywords: ['configuration', 'config'] },
]

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.includes(q)) return true
  // fuzzy: all query chars appear in order
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

function scoreMatch(query: string, cmd: Command): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const label = cmd.label.toLowerCase()
  const keywords = (cmd.keywords || []).join(' ').toLowerCase()

  if (label === q) return 100
  if (label.startsWith(q)) return 80
  if (label.includes(q)) return 60
  if (keywords.includes(q)) return 40
  return 10 // fuzzy match
}

export default function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = COMMANDS.filter(cmd => {
    const searchText = [cmd.label, cmd.category, ...(cmd.keywords || [])].join(' ')
    return fuzzyMatch(query, searchText)
  }).sort((a, b) => scoreMatch(query, b) - scoreMatch(query, a))

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
        setQuery('')
        setSelectedIndex(0)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleSelect = (cmd: Command) => {
    setOpen(false)
    setQuery('')
    if (cmd.path) {
      navigate(cmd.path)
    } else if (cmd.action) {
      cmd.action()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex])
      }
    }
  }

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement
    if (item) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!open) return null

  // Group by category
  const grouped: Record<string, Command[]> = {}
  for (const cmd of filtered) {
    if (!grouped[cmd.category]) grouped[cmd.category] = []
    grouped[cmd.category].push(cmd)
  }

  // Flat list index tracker for highlighting
  let flatIndex = 0

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1a2e',
          border: '1px solid #2a2a3e',
          borderRadius: '10px',
          width: '560px',
          maxWidth: 'calc(100vw - 2rem)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid #2a2a3e',
        }}>
          <span style={{ color: '#8890a0', fontSize: '1rem', flexShrink: 0 }}>&#128269;</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, actions..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e0e0e0',
              fontSize: '1rem',
            }}
          />
          <kbd style={{
            background: '#0f0f1a',
            border: '1px solid #2a2a3e',
            borderRadius: '4px',
            color: '#8890a0',
            fontSize: '0.7rem',
            padding: '0.15rem 0.4rem',
            flexShrink: 0,
          }}>ESC</kbd>
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          style={{
            listStyle: 'none',
            padding: '0.4rem 0',
            margin: 0,
            maxHeight: '400px',
            overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <li style={{ color: '#8890a0', padding: '1.5rem 1rem', textAlign: 'center', fontSize: '0.9rem' }}>
              No results for "{query}"
            </li>
          ) : (
            Object.entries(grouped).map(([category, cmds]) => (
              <li key={category}>
                <div style={{
                  color: '#8890a0',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '0.5rem 1rem 0.2rem',
                }}>
                  {category}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {cmds.map(cmd => {
                    const idx = flatIndex++
                    const isSelected = idx === selectedIndex
                    return (
                      <li
                        key={cmd.id}
                        onClick={() => handleSelect(cmd)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.5rem 1rem',
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(124,158,248,0.12)' : 'transparent',
                          borderLeft: isSelected ? '2px solid #7c9ef8' : '2px solid transparent',
                          transition: 'background 0.1s',
                        }}
                      >
                        <span style={{ color: isSelected ? '#7c9ef8' : '#e0e0e0', fontSize: '0.9rem' }}>
                          {cmd.label}
                        </span>
                        {cmd.path && (
                          <span style={{ color: '#8890a0', fontSize: '0.75rem' }}>
                            {cmd.path}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        {/* Footer hint */}
        <div style={{
          borderTop: '1px solid #2a2a3e',
          padding: '0.4rem 1rem',
          display: 'flex',
          gap: '1rem',
          color: '#8890a0',
          fontSize: '0.72rem',
        }}>
          <span><kbd style={{ background: '#0f0f1a', border: '1px solid #2a2a3e', borderRadius: '3px', padding: '0.1rem 0.3rem' }}>↑↓</kbd> navigate</span>
          <span><kbd style={{ background: '#0f0f1a', border: '1px solid #2a2a3e', borderRadius: '3px', padding: '0.1rem 0.3rem' }}>↵</kbd> select</span>
          <span><kbd style={{ background: '#0f0f1a', border: '1px solid #2a2a3e', borderRadius: '3px', padding: '0.1rem 0.3rem' }}>ESC</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
