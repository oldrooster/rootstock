import React, { useEffect, useMemo, useRef, useState } from 'react'

interface ApplyPreview {
  total_services: number
  enabled_services: number
  total_vms: number
  enabled_vms: number
}

interface DirtyStatus {
  dirty: Record<string, boolean>
  any_dirty: boolean
}

const btnPrimary: React.CSSProperties = {
  background: '#7c9ef8',
  color: '#0f0f1a',
  border: 'none',
  borderRadius: '4px',
  padding: '0.5rem 1.25rem',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 600,
}

const btnDanger: React.CSSProperties = {
  background: '#ef4444',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  padding: '0.5rem 1.25rem',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 600,
}

const btnSecondary: React.CSSProperties = {
  background: 'transparent',
  color: '#b0b8d0',
  border: '1px solid #2a2a3e',
  borderRadius: '4px',
  padding: '0.5rem 1.25rem',
  cursor: 'pointer',
  fontSize: '0.9rem',
}

const btnApply: React.CSSProperties = {
  ...btnPrimary,
  background: '#22c55e',
  color: '#0f0f1a',
}

const logStyle: React.CSSProperties = {
  background: '#0a0a14',
  border: '1px solid #2a2a3e',
  borderRadius: '4px',
  padding: '0.75rem',
  color: '#c8d0e0',
  fontSize: '0.8rem',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: '30rem',
  overflow: 'auto',
  margin: 0,
  lineHeight: 1.5,
}

const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: '6px',
  padding: '1rem',
  marginBottom: '0.75rem',
}

interface SectionDef {
  key: string
  label: string
  description: string
  type: 'terraform' | 'ansible'
}

const SECTIONS: SectionDef[] = [
  { key: 'terraform', label: 'Terraform (VMs)', description: 'Provision and manage Proxmox VMs', type: 'terraform' },
  { key: 'roles', label: 'Ansible: Roles', description: 'Apply Ansible roles to assigned hosts', type: 'ansible' },
  { key: 'containers', label: 'Ansible: Containers', description: 'Deploy docker-compose, pull and start containers', type: 'ansible' },
  { key: 'dns', label: 'Ansible: DNS', description: 'Update Pi-hole DNS configuration', type: 'ansible' },
  { key: 'ingress', label: 'Ansible: Ingress', description: 'Deploy Caddyfile and Cloudflare tunnel configs', type: 'ansible' },
  { key: 'backups', label: 'Ansible: Backups', description: 'Deploy backup cron jobs to hosts', type: 'ansible' },
]

/* ── ANSI color code → HTML conversion ──────────────────────────────── */

const ANSI_COLORS: Record<string, string> = {
  '30': '#4a4a4a', '31': '#ef4444', '32': '#22c55e', '33': '#eab308',
  '34': '#3b82f6', '35': '#a855f7', '36': '#06b6d4', '37': '#e0e0e0',
  '90': '#6b7280', '91': '#f87171', '92': '#4ade80', '93': '#facc15',
  '94': '#60a5fa', '95': '#c084fc', '96': '#22d3ee', '97': '#ffffff',
}

function ansiToHtml(text: string): string {
  // Escape HTML entities first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Replace ANSI codes with spans
  // Match: ESC[ (params) m  — where ESC is \x1b or \033
  let openSpans = 0
  html = html.replace(/\x1b\[([0-9;]*)m/g, (_match, codes: string) => {
    const parts = codes.split(';').filter(Boolean)
    // Reset
    if (parts.length === 0 || (parts.length === 1 && parts[0] === '0')) {
      const close = openSpans > 0 ? '</span>' : ''
      if (openSpans > 0) openSpans--
      return close
    }
    // Find color code (last numeric part that maps to a color)
    let color = ''
    for (const p of parts) {
      if (ANSI_COLORS[p]) color = ANSI_COLORS[p]
    }
    if (color) {
      // Close previous span if nested
      const close = openSpans > 0 ? '</span>' : ''
      if (openSpans > 0) openSpans--
      openSpans++
      return `${close}<span style="color:${color}">`
    }
    return ''
  })

  // Close any remaining open spans
  while (openSpans > 0) {
    html += '</span>'
    openSpans--
  }

  return html
}

const AnsiPre = React.forwardRef<HTMLPreElement, { style: React.CSSProperties; text: string }>(
  ({ style, text }, ref) => {
    const html = useMemo(() => ansiToHtml(text), [text])
    return <pre ref={ref} style={style} dangerouslySetInnerHTML={{ __html: html }} />
  }
)

interface RoleInfo {
  name: string
  description: string
}

interface ContainerInfo {
  name: string
  enabled: boolean
  hosts: string[]
}

export default function Apply() {
  const [preview, setPreview] = useState<ApplyPreview | null>(null)
  const [dirty, setDirty] = useState<DirtyStatus>({ dirty: {}, any_dirty: false })
  const [error, setError] = useState<string | null>(null)

  // Execution
  const [running, setRunning] = useState(false)
  const [runningScope, setRunningScope] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Roles selection
  const [availableRoles, setAvailableRoles] = useState<RoleInfo[]>([])
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set())
  const [rolesExpanded, setRolesExpanded] = useState(false)

  // Containers host selection
  const [availableContainers, setAvailableContainers] = useState<ContainerInfo[]>([])
  const [selectedContainerHosts, setSelectedContainerHosts] = useState<Set<string>>(new Set())
  const [containersExpanded, setContainersExpanded] = useState(false)

  // Ingress host selection
  const [selectedIngressHosts, setSelectedIngressHosts] = useState<Set<string>>(new Set())
  const [ingressExpanded, setIngressExpanded] = useState(false)

  // Ansible options
  const [ansibleDiff, setAnsibleDiff] = useState(true)
  const [ansibleVerbosity, setAnsibleVerbosity] = useState(0)
  const [ansibleFreeStrategy, setAnsibleFreeStrategy] = useState(false)

  const fetchStatus = () => {
    Promise.all([
      fetch('/api/apply/').then(r => r.json()),
      fetch('/api/apply/status').then(r => r.json()),
    ])
      .then(([p, s]) => { setPreview(p); setDirty(s) })
      .catch(e => setError(e.message))
  }

  const fetchRoles = () => {
    fetch('/api/roles/')
      .then(r => r.json())
      .then((roles: RoleInfo[]) => {
        setAvailableRoles(roles)
        setSelectedRoles(new Set(roles.map(r => r.name)))
      })
      .catch(() => {})
  }

  const fetchContainers = () => {
    fetch('/api/containers/')
      .then(r => r.json())
      .then((ctrs: ContainerInfo[]) => {
        const enabled = ctrs.filter(c => c.enabled)
        setAvailableContainers(enabled)
        const hosts = new Set<string>()
        for (const c of enabled) {
          if (c.hosts) c.hosts.forEach(h => hosts.add(h))
        }
        setSelectedContainerHosts(hosts)
        setSelectedIngressHosts(new Set(hosts))
      })
      .catch(() => {})
  }

  useEffect(() => {
    fetchStatus()
    fetchRoles()
    fetchContainers()
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  // Derive host -> container names map (shared for containers + ingress display)
  const hostContainerMap = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const c of availableContainers) {
      for (const h of c.hosts) {
        if (!map[h]) map[h] = []
        map[h].push(c.name)
      }
    }
    return map
  }, [availableContainers])
  const allContainerHosts = useMemo(() => Object.keys(hostContainerMap).sort(), [hostContainerMap])
  const allIngressHosts = allContainerHosts

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  async function streamAction(url: string, scope: string) {
    setRunning(true)
    setRunningScope(scope)
    setLog('')
    setError(null)
    setConfirmDestroy(false)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const r = await fetch(url, { method: 'POST', signal: controller.signal })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }

      const reader = r.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setLog(prev => prev + decoder.decode(value, { stream: true }))
      }

      // Refresh dirty status after run
      fetchStatus()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  function handleAbort() {
    abortRef.current?.abort()
  }

  function dirtyBadge(key: string) {
    const isDirty = dirty.dirty[key]
    return (
      <span style={{
        fontSize: '0.65rem',
        padding: '0.1rem 0.4rem',
        borderRadius: '9999px',
        marginLeft: '0.5rem',
        background: isDirty ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)',
        color: isDirty ? '#f59e0b' : '#22c55e',
      }}>
        {isDirty ? 'changes pending' : 'clean'}
      </span>
    )
  }

  if (!preview && !error) return <p style={{ color: '#8890a0' }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Apply</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {running && (
            <button style={btnSecondary} onClick={handleAbort}>Abort</button>
          )}
          <button
            style={{ ...btnApply, opacity: running ? 0.5 : 1 }}
            disabled={running}
            onClick={() => streamAction('/api/apply/all', 'all')}
          >
            {running && runningScope === 'all' ? 'Applying All...' : 'Apply All'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {preview && (
        <div style={{ ...cardStyle, color: '#8890a0', fontSize: '0.85rem' }}>
          <strong style={{ color: '#e0e0e0' }}>{preview.enabled_services}</strong> container(s), <strong style={{ color: '#e0e0e0' }}>{preview.enabled_vms}</strong> VM(s) configured
        </div>
      )}

      {/* Ansible options */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '0.6rem 1rem' }}>
        <span style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ansible options</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#b0b8d0', fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={ansibleDiff} onChange={e => setAnsibleDiff(e.target.checked)} />
          --diff
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#b0b8d0', fontSize: '0.85rem', cursor: 'pointer' }} title="Run all hosts in parallel (strategy: free) — containers scope only">
          <input type="checkbox" checked={ansibleFreeStrategy} onChange={e => setAnsibleFreeStrategy(e.target.checked)} />
          Parallel hosts
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <label style={{ color: '#8890a0', fontSize: '0.75rem' }}>Verbosity</label>
          <select
            value={ansibleVerbosity}
            onChange={e => setAnsibleVerbosity(Number(e.target.value))}
            style={{
              background: '#0f0f1a', border: '1px solid #2a2a3e', color: '#e0e0e0',
              borderRadius: '4px', padding: '0.25rem 0.5rem', fontSize: '0.82rem', cursor: 'pointer',
            }}
          >
            <option value={0}>none</option>
            <option value={1}>-v</option>
            <option value={2}>-vv</option>
            <option value={3}>-vvv</option>
            <option value={4}>-vvvv</option>
          </select>
        </div>
      </div>

      {/* Per-section cards */}
      {SECTIONS.map(section => {
        const isRoles = section.key === 'roles'
        const isContainers = section.key === 'containers'
        const isIngress = section.key === 'ingress'
        const hasFilter = isRoles || isContainers || isIngress

        const buildUrl = () => {
          const params = new URLSearchParams()
          if (!ansibleDiff) params.set('diff', 'false')
          if (ansibleVerbosity > 0) params.set('verbosity', String(ansibleVerbosity))
          if (ansibleFreeStrategy && section.key === 'containers') params.set('free_strategy', 'true')
          if (isRoles && selectedRoles.size < availableRoles.length) {
            Array.from(selectedRoles).forEach(r => params.append('roles', r))
          }
          if (isContainers && selectedContainerHosts.size < allContainerHosts.length) {
            Array.from(selectedContainerHosts).forEach(h => params.append('hosts', h))
          }
          if (isIngress && selectedIngressHosts.size < allIngressHosts.length) {
            Array.from(selectedIngressHosts).forEach(h => params.append('hosts', h))
          }
          const qs = params.toString()
          return `/api/apply/ansible/${section.key}${qs ? '?' + qs : ''}`
        }

        const filterEmpty = (isRoles && selectedRoles.size === 0) || (isContainers && selectedContainerHosts.size === 0) || (isIngress && selectedIngressHosts.size === 0)

        return (
        <div key={section.key} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '0.95rem' }}>{section.label}</span>
              {dirtyBadge(section.key)}
              {isRoles && availableRoles.length > 0 && (
                <button
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#8890a0',
                    fontSize: '0.75rem', padding: '0.1rem 0.3rem',
                  }}
                  onClick={() => setRolesExpanded(!rolesExpanded)}
                >
                  {rolesExpanded ? '▾' : '▸'} {selectedRoles.size}/{availableRoles.length} roles
                </button>
              )}
              {isContainers && allContainerHosts.length > 0 && (
                <button
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#8890a0',
                    fontSize: '0.75rem', padding: '0.1rem 0.3rem',
                  }}
                  onClick={() => setContainersExpanded(!containersExpanded)}
                >
                  {containersExpanded ? '▾' : '▸'} {selectedContainerHosts.size}/{allContainerHosts.length} hosts
                </button>
              )}
              {isIngress && allIngressHosts.length > 0 && (
                <button
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#8890a0',
                    fontSize: '0.75rem', padding: '0.1rem 0.3rem',
                  }}
                  onClick={() => setIngressExpanded(!ingressExpanded)}
                >
                  {ingressExpanded ? '▾' : '▸'} {selectedIngressHosts.size}/{allIngressHosts.length} hosts
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {section.type === 'terraform' ? (
                <>
                  <button
                    style={{ ...btnPrimary, padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                    disabled={running}
                    onClick={() => streamAction('/api/apply/terraform/plan', 'terraform-plan')}
                  >
                    {running && runningScope === 'terraform-plan' ? 'Planning...' : 'Plan'}
                  </button>
                  <button
                    style={{ ...btnApply, padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                    disabled={running}
                    onClick={() => streamAction('/api/apply/terraform/apply', 'terraform-apply')}
                  >
                    {running && runningScope === 'terraform-apply' ? 'Applying...' : 'Apply'}
                  </button>
                  {!confirmDestroy ? (
                    <button
                      style={{ ...btnDanger, padding: '0.35rem 0.75rem', fontSize: '0.8rem', opacity: running ? 0.5 : 1 }}
                      disabled={running}
                      onClick={() => setConfirmDestroy(true)}
                    >Destroy</button>
                  ) : (
                    <>
                      <button
                        style={{ ...btnDanger, padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => streamAction('/api/apply/terraform/destroy', 'terraform-destroy')}
                      >Confirm Destroy</button>
                      <button
                        style={{ ...btnSecondary, padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => setConfirmDestroy(false)}
                      >Cancel</button>
                    </>
                  )}
                </>
              ) : (
                <button
                  style={{ ...btnApply, padding: '0.35rem 0.75rem', fontSize: '0.8rem', opacity: hasFilter && filterEmpty ? 0.5 : 1 }}
                  disabled={running || (hasFilter && filterEmpty)}
                  onClick={() => streamAction(buildUrl(), section.key)}
                >
                  {running && runningScope === section.key ? 'Running...' : 'Run'}
                </button>
              )}
            </div>
          </div>
          <p style={{ color: '#8890a0', fontSize: '0.8rem', margin: 0 }}>{section.description}</p>

          {/* Expandable role selector */}
          {isRoles && rolesExpanded && availableRoles.length > 0 && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#0f0f1a', borderRadius: '4px', border: '1px solid #2a2a3e' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ color: '#8890a0', fontSize: '0.75rem' }}>Select roles to apply:</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.75rem', cursor: 'pointer' }}
                    onClick={() => setSelectedRoles(new Set(availableRoles.map(r => r.name)))}
                  >All</button>
                  <button
                    style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.75rem', cursor: 'pointer' }}
                    onClick={() => setSelectedRoles(new Set())}
                  >None</button>
                </div>
              </div>
              {availableRoles.map(role => (
                <label key={role.name} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.25rem 0', cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={selectedRoles.has(role.name)}
                    onChange={e => {
                      const next = new Set(selectedRoles)
                      if (e.target.checked) next.add(role.name)
                      else next.delete(role.name)
                      setSelectedRoles(next)
                    }}
                  />
                  <span style={{ color: '#e0e0e0', fontSize: '0.85rem' }}>{role.name}</span>
                  {role.description && (
                    <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>{role.description}</span>
                  )}
                </label>
              ))}
            </div>
          )}

          {/* Expandable container host selector */}
          {isContainers && containersExpanded && allContainerHosts.length > 0 && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#0f0f1a', borderRadius: '4px', border: '1px solid #2a2a3e' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ color: '#8890a0', fontSize: '0.75rem' }}>Select hosts to deploy containers:</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.75rem', cursor: 'pointer' }}
                    onClick={() => setSelectedContainerHosts(new Set(allContainerHosts))}
                  >All</button>
                  <button
                    style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.75rem', cursor: 'pointer' }}
                    onClick={() => setSelectedContainerHosts(new Set())}
                  >None</button>
                </div>
              </div>
              {allContainerHosts.map(host => (
                <label key={host} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.25rem 0', cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={selectedContainerHosts.has(host)}
                    onChange={e => {
                      const next = new Set(selectedContainerHosts)
                      if (e.target.checked) next.add(host)
                      else next.delete(host)
                      setSelectedContainerHosts(next)
                    }}
                  />
                  <span style={{ color: '#e0e0e0', fontSize: '0.85rem' }}>{host}</span>
                  {hostContainerMap[host] && (
                    <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>{hostContainerMap[host].join(', ')}</span>
                  )}
                </label>
              ))}
            </div>
          )}

          {/* Expandable ingress host selector */}
          {isIngress && ingressExpanded && allIngressHosts.length > 0 && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#0f0f1a', borderRadius: '4px', border: '1px solid #2a2a3e' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ color: '#8890a0', fontSize: '0.75rem' }}>Select hosts to deploy ingress:</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.75rem', cursor: 'pointer' }}
                    onClick={() => setSelectedIngressHosts(new Set(allIngressHosts))}
                  >All</button>
                  <button
                    style={{ background: 'none', border: 'none', color: '#7c9ef8', fontSize: '0.75rem', cursor: 'pointer' }}
                    onClick={() => setSelectedIngressHosts(new Set())}
                  >None</button>
                </div>
              </div>
              {allIngressHosts.map(host => (
                <label key={host} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.25rem 0', cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={selectedIngressHosts.has(host)}
                    onChange={e => {
                      const next = new Set(selectedIngressHosts)
                      if (e.target.checked) next.add(host)
                      else next.delete(host)
                      setSelectedIngressHosts(next)
                    }}
                  />
                  <span style={{ color: '#e0e0e0', fontSize: '0.85rem' }}>{host}</span>
                  {hostContainerMap[host] && (
                    <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>{hostContainerMap[host].join(', ')}</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
        )
      })}

      {/* Streaming output */}
      {(log || running) && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <h2 style={{ color: '#e0e0e0', fontSize: '0.95rem', margin: 0 }}>
              Output {runningScope && <span style={{ color: '#8890a0', fontWeight: 400 }}>({runningScope})</span>}
            </h2>
            {!running && log && (
              <button style={{ ...btnSecondary, padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setLog('')}>Clear</button>
            )}
          </div>
          <AnsiPre ref={logRef} style={logStyle} text={log || 'Starting...\n'} />
        </div>
      )}
    </div>
  )
}
