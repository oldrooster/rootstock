import React, { useEffect, useMemo, useRef, useState } from 'react'

interface HistoryRun { timestamp: number; scope: string; exit_code: number; log: string }

interface PlanFieldDiff {
  key: string
  before: string | null
  after: string | null
  change_type: 'add' | 'remove' | 'update'
}

interface PlanResourceChange {
  address: string
  module_address: string | null
  type: string
  name: string
  action: 'create' | 'update' | 'destroy' | 'replace'
  fields: PlanFieldDiff[]
}

interface PlanDiff {
  summary: { add: number; change: number; destroy: number; no_op: number }
  changes: PlanResourceChange[]
  terraform_version: string | null
}

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

  // Plan diff
  const [planDiff, setPlanDiff] = useState<PlanDiff | null>(null)
  const [planDiffLoading, setPlanDiffLoading] = useState(false)
  const [planDiffError, setPlanDiffError] = useState<string | null>(null)
  const [planDiffExpanded, setPlanDiffExpanded] = useState<Set<string>>(new Set())

  // Execution
  const [running, setRunning] = useState(false)
  const [runningScope, setRunningScope] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const [destroyResources, setDestroyResources] = useState<string[] | null>(null)
  const [destroyLoading, setDestroyLoading] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // History
  const [history, setHistory] = useState<Record<string, HistoryRun[]>>({})
  const [historyScope, setHistoryScope] = useState<string | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)

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

  // Rollback
  const [rollbackAvailable, setRollbackAvailable] = useState(false)
  const [rollbackConfirm, setRollbackConfirm] = useState(false)
  const [rollbackLoading, setRollbackLoading] = useState(false)

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

  const fetchRollbackStatus = () => {
    fetch('/api/apply/terraform/rollback-status')
      .then(r => r.json())
      .then(d => setRollbackAvailable(d.available))
      .catch(() => {})
  }

  async function handleRollback() {
    setRollbackLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/apply/terraform/rollback', { method: 'POST' })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        throw new Error(d?.detail || `HTTP ${r.status}`)
      }
      setRollbackConfirm(false)
      fetchRollbackStatus()
      fetchStatus()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRollbackLoading(false)
    }
  }

  const fetchHistory = () => {
    fetch('/api/apply/history')
      .then(r => r.json())
      .then(setHistory)
      .catch(() => {})
  }

  async function fetchPlanDiff() {
    setPlanDiffLoading(true)
    setPlanDiffError(null)
    setPlanDiff(null)
    setPlanDiffExpanded(new Set())
    try {
      const r = await fetch('/api/apply/terraform/plan-diff', { method: 'POST' })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.detail || `HTTP ${r.status}`)
      }
      const data: PlanDiff = await r.json()
      setPlanDiff(data)
      // Auto-expand all changed resources
      setPlanDiffExpanded(new Set(data.changes.map(c => c.address)))
    } catch (e) {
      setPlanDiffError((e as Error).message)
    } finally {
      setPlanDiffLoading(false)
    }
  }

  async function loadDestroyPreview() {
    setDestroyLoading(true)
    setDestroyResources(null)
    try {
      const r = await fetch('/api/apply/terraform/destroy-preview', { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setDestroyResources(data.resources || [])
      setConfirmDestroy(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDestroyLoading(false)
    }
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
    fetchHistory()
    fetchRollbackStatus()
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

      // Refresh dirty status, history, and rollback availability after run
      fetchStatus()
      fetchHistory()
      fetchRollbackStatus()
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
                    style={{ ...btnSecondary, padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderColor: '#7c9ef8', color: '#7c9ef8', opacity: (running || planDiffLoading) ? 0.5 : 1 }}
                    disabled={running || planDiffLoading}
                    onClick={fetchPlanDiff}
                  >
                    {planDiffLoading ? 'Planning...' : 'Plan Diff'}
                  </button>
                  <button
                    style={{ ...btnPrimary, padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                    disabled={running}
                    onClick={() => streamAction('/api/apply/terraform/plan', 'terraform-plan')}
                  >
                    {running && runningScope === 'terraform-plan' ? 'Planning...' : 'Plan (raw)'}
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
                      style={{ ...btnDanger, padding: '0.35rem 0.75rem', fontSize: '0.8rem', opacity: (running || destroyLoading) ? 0.5 : 1 }}
                      disabled={running || destroyLoading}
                      onClick={loadDestroyPreview}
                    >{destroyLoading ? 'Loading...' : 'Destroy'}</button>
                  ) : (
                    <>
                      <button
                        style={{ ...btnDanger, padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => streamAction('/api/apply/terraform/destroy', 'terraform-destroy')}
                      >Confirm Destroy</button>
                      <button
                        style={{ ...btnSecondary, padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => { setConfirmDestroy(false); setDestroyResources(null) }}
                      >Cancel</button>
                    </>
                  )}
                  {rollbackAvailable && !rollbackConfirm && (
                    <button
                      style={{ ...btnSecondary, padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderColor: '#f59e0b', color: '#f59e0b', opacity: running ? 0.5 : 1 }}
                      disabled={running}
                      onClick={() => setRollbackConfirm(true)}
                    >Rollback</button>
                  )}
                  {rollbackConfirm && (
                    <>
                      <button
                        style={{ ...btnSecondary, padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderColor: '#f59e0b', color: '#f59e0b', opacity: rollbackLoading ? 0.5 : 1 }}
                        disabled={rollbackLoading}
                        onClick={handleRollback}
                      >{rollbackLoading ? 'Restoring...' : 'Confirm Rollback'}</button>
                      <button
                        style={{ ...btnSecondary, padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => setRollbackConfirm(false)}
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

          {/* Destroy preview resources */}
          {section.type === 'terraform' && confirmDestroy && destroyResources !== null && (
            <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: '#3b0808', border: '1px solid #7f1d1d', borderRadius: '4px' }}>
              <div style={{ color: '#fca5a5', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                {destroyResources.length === 0
                  ? 'No resources to destroy'
                  : `${destroyResources.length} resource(s) will be destroyed:`}
              </div>
              {destroyResources.map(r => (
                <div key={r} style={{ color: '#fca5a5', fontSize: '0.8rem', fontFamily: 'monospace', padding: '0.1rem 0' }}>- {r}</div>
              ))}
            </div>
          )}

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

      {/* Plan Diff Viewer */}
      {(planDiff || planDiffError) && (
        <div style={{ ...cardStyle, marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ color: '#e0e0e0', fontSize: '0.95rem', margin: 0 }}>Terraform Plan</h2>
            <button style={{ ...btnSecondary, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => { setPlanDiff(null); setPlanDiffError(null) }}>Clear</button>
          </div>

          {planDiffError && (
            <pre style={{ color: '#fca5a5', fontSize: '0.8rem', background: '#3b0808', padding: '0.75rem', borderRadius: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
              {planDiffError}
            </pre>
          )}

          {planDiff && (
            <>
              {/* Summary bar */}
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                {[
                  { label: 'add', count: planDiff.summary.add, color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
                  { label: 'change', count: planDiff.summary.change, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
                  { label: 'destroy', count: planDiff.summary.destroy, color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
                  { label: 'no-op', count: planDiff.summary.no_op, color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
                ].map(({ label, count, color, bg }) => (
                  <div key={label} style={{ background: bg, borderRadius: '6px', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ color, fontWeight: 700, fontSize: '1.1rem' }}>{count}</span>
                    <span style={{ color, fontSize: '0.78rem' }}>{label}</span>
                  </div>
                ))}
                {planDiff.terraform_version && (
                  <span style={{ color: '#6b7280', fontSize: '0.72rem', alignSelf: 'center', marginLeft: 'auto' }}>
                    Terraform {planDiff.terraform_version}
                  </span>
                )}
              </div>

              {planDiff.changes.length === 0 ? (
                <p style={{ color: '#22c55e', fontSize: '0.9rem', margin: 0 }}>No changes. Infrastructure is up-to-date.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {planDiff.changes.map(rc => {
                    const isExpanded = planDiffExpanded.has(rc.address)
                    const actionColor = rc.action === 'create' ? '#22c55e' : rc.action === 'destroy' ? '#ef4444' : rc.action === 'replace' ? '#f97316' : '#f59e0b'
                    const actionSymbol = rc.action === 'create' ? '+' : rc.action === 'destroy' ? '-' : rc.action === 'replace' ? '±' : '~'
                    return (
                      <div key={rc.address} style={{ background: '#0f0f1a', border: '1px solid #2a2a3e', borderRadius: '4px', overflow: 'hidden' }}>
                        <button
                          onClick={() => setPlanDiffExpanded(prev => {
                            const next = new Set(prev)
                            if (next.has(rc.address)) next.delete(rc.address)
                            else next.add(rc.address)
                            return next
                          })}
                          style={{
                            display: 'flex', width: '100%', alignItems: 'center', gap: '0.6rem',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            padding: '0.5rem 0.75rem', textAlign: 'left',
                          }}
                        >
                          <span style={{
                            color: actionColor, fontWeight: 700, fontSize: '1rem',
                            width: '1.2rem', textAlign: 'center', flexShrink: 0,
                          }}>{actionSymbol}</span>
                          <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace', flex: 1 }}>{rc.address}</span>
                          <span style={{
                            fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '9999px', flexShrink: 0,
                            background: rc.action === 'create' ? 'rgba(34,197,94,0.15)' : rc.action === 'destroy' ? 'rgba(239,68,68,0.15)' : rc.action === 'replace' ? 'rgba(249,115,22,0.15)' : 'rgba(245,158,11,0.15)',
                            color: actionColor,
                          }}>{rc.action}</span>
                          <span style={{ color: '#6b7280', fontSize: '0.72rem', flexShrink: 0 }}>{isExpanded ? '▾' : '▸'} {rc.fields.length} field{rc.fields.length !== 1 ? 's' : ''}</span>
                        </button>

                        {isExpanded && rc.fields.length > 0 && (
                          <div style={{ borderTop: '1px solid #2a2a3e' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', fontFamily: 'monospace' }}>
                              <tbody>
                                {rc.fields.map((f, fi) => (
                                  <tr key={fi} style={{ borderBottom: '1px solid #1a1a2e' }}>
                                    <td style={{ color: '#8890a0', padding: '0.3rem 0.75rem', width: '30%', verticalAlign: 'top', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {f.key}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.25rem', width: '35%', verticalAlign: 'top' }}>
                                      {f.before != null ? (
                                        <span style={{ color: '#fca5a5', display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                          - {f.before}
                                        </span>
                                      ) : (
                                        <span style={{ color: '#4b5563' }}>-</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.25rem 0.3rem 0', width: '35%', verticalAlign: 'top' }}>
                                      {f.after != null ? (
                                        <span style={{ color: f.after === '(known after apply)' ? '#6b7280' : '#86efac', display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontStyle: f.after === '(known after apply)' ? 'italic' : 'normal' }}>
                                          + {f.after}
                                        </span>
                                      ) : (
                                        <span style={{ color: '#4b5563' }}>-</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

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

      {/* Apply History */}
      {Object.keys(history).length > 0 && (
        <div style={{ ...cardStyle, marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: historyExpanded ? '0.75rem' : 0 }}>
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e0e0e0', fontSize: '0.95rem', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              onClick={() => setHistoryExpanded(!historyExpanded)}
            >
              {historyExpanded ? '▾' : '▸'} Apply History
            </button>
            <button
              style={{ ...btnSecondary, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
              onClick={fetchHistory}
            >Refresh</button>
          </div>
          {historyExpanded && (
            <>
              {/* Scope tabs */}
              <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  style={{
                    fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '9999px', cursor: 'pointer',
                    border: '1px solid #2a2a3e',
                    background: historyScope === null ? '#7c9ef8' : 'transparent',
                    color: historyScope === null ? '#0f0f1a' : '#b0b8d0',
                  }}
                  onClick={() => setHistoryScope(null)}
                >All</button>
                {Object.keys(history).sort().map(scope => (
                  <button
                    key={scope}
                    style={{
                      fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '9999px', cursor: 'pointer',
                      border: '1px solid #2a2a3e',
                      background: historyScope === scope ? '#7c9ef8' : 'transparent',
                      color: historyScope === scope ? '#0f0f1a' : '#b0b8d0',
                    }}
                    onClick={() => setHistoryScope(scope)}
                  >{scope}</button>
                ))}
              </div>

              {/* History entries */}
              {(() => {
                const entries: (HistoryRun & { scope: string })[] = []
                for (const [scope, runs] of Object.entries(history)) {
                  if (historyScope && scope !== historyScope) continue
                  for (const run of runs) {
                    entries.push({ ...run, scope })
                  }
                }
                entries.sort((a, b) => b.timestamp - a.timestamp)
                const shown = entries.slice(0, 20)
                return shown.map((run, i) => (
                  <details key={i} style={{ marginBottom: '0.4rem', borderRadius: '4px', background: '#0f0f1a', border: '1px solid #2a2a3e', overflow: 'hidden' }}>
                    <summary style={{
                      cursor: 'pointer',
                      padding: '0.45rem 0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      listStyle: 'none',
                      userSelect: 'none',
                    }}>
                      <span style={{
                        fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                        background: run.exit_code === 0 ? '#166534' : '#7f1d1d',
                        color: run.exit_code === 0 ? '#86efac' : '#fca5a5',
                        flexShrink: 0,
                      }}>{run.exit_code === 0 ? 'ok' : 'failed'}</span>
                      <span style={{ color: '#7c9ef8', fontSize: '0.82rem', fontWeight: 600 }}>{run.scope}</span>
                      <span style={{ color: '#8890a0', fontSize: '0.78rem' }}>
                        {new Date(run.timestamp * 1000).toLocaleString()}
                      </span>
                    </summary>
                    <pre style={{ ...logStyle, maxHeight: '200px', margin: 0, borderRadius: 0, border: 'none', borderTop: '1px solid #2a2a3e' }}>
                      {run.log || '(no log)'}
                    </pre>
                  </details>
                ))
              })()}
            </>
          )}
        </div>
      )}
    </div>
  )
}
