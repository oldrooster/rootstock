import { useEffect, useRef, useState, useCallback } from 'react'

interface NodeStat {
  name: string
  cpu_pct: number
  mem_used_mb: number
  mem_total_mb: number
  disk_used_gb: number
  disk_total_gb: number
  uptime_s: number
}

interface VMStat {
  name: string
  node: string
  status: string
  cpu_pct: number
  mem_used_mb: number
  mem_total_mb: number
}

interface ContainerStat {
  name: string
  host: string
  cpu_pct: number
  mem_used_mb: number
  mem_limit_mb: number
}

interface StatsSnapshot {
  timestamp: number
  nodes: NodeStat[]
  vms: VMStat[]
  containers: ContainerStat[]
}

const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: '6px',
  padding: '1rem',
  marginBottom: '0.75rem',
}

const labelStyle: React.CSSProperties = {
  color: '#8890a0',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: '0.2rem',
}

const btnSecondary: React.CSSProperties = {
  background: 'transparent',
  color: '#b0b8d0',
  border: '1px solid #2a2a3e',
  borderRadius: '4px',
  padding: '0.3rem 0.75rem',
  cursor: 'pointer',
  fontSize: '0.82rem',
}

const btnGreen: React.CSSProperties = {
  background: 'transparent',
  color: '#22c55e',
  border: '1px solid #22c55e',
  borderRadius: '4px',
  padding: '0.3rem 0.75rem',
  cursor: 'pointer',
  fontSize: '0.82rem',
}

const btnRed: React.CSSProperties = {
  background: 'transparent',
  color: '#ef4444',
  border: '1px solid #ef4444',
  borderRadius: '4px',
  padding: '0.3rem 0.75rem',
  cursor: 'pointer',
  fontSize: '0.82rem',
}

const inputStyle: React.CSSProperties = {
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  color: '#e0e0e0',
  borderRadius: '4px',
  padding: '0.25rem 0.5rem',
  fontSize: '0.82rem',
  width: '80px',
}

// ── Gauge bar ─────────────────────────────────────────────────────────────────

function GaugeBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, pct))
  const barColor = clamped > 85 ? '#ef4444' : clamped > 65 ? '#f59e0b' : color
  return (
    <div style={{ background: '#0f0f1a', borderRadius: '3px', height: '6px', overflow: 'hidden' }}>
      <div style={{ width: `${clamped}%`, height: '100%', background: barColor, borderRadius: '3px', transition: 'width 0.4s ease' }} />
    </div>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ values, color = '#7c9ef8', width = 80, height = 24 }: {
  values: number[]
  color?: string
  width?: number
  height?: number
}) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - (v / max) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ── Uptime formatter ──────────────────────────────────────────────────────────

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

function formatMem(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

function formatAge(timestamp: number): string {
  if (!timestamp) return 'never'
  const secs = Math.floor(Date.now() / 1000 - timestamp)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ${secs % 60}s ago`
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface CollectorStatus { running: boolean; interval_seconds: number }

export default function Stats() {
  const [snap, setSnap] = useState<StatsSnapshot | null>(null)
  const [history, setHistory] = useState<StatsSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [age, setAge] = useState('')
  const [status, setStatus] = useState<CollectorStatus | null>(null)
  const [intervalInput, setIntervalInput] = useState('')
  const [controlBusy, setControlBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadLatest = useCallback(async () => {
    const [s, h, st] = await Promise.all([
      fetch('/api/stats/latest').then(r => r.json()),
      fetch('/api/stats/history').then(r => r.json()),
      fetch('/api/stats/status').then(r => r.json()),
    ])
    setSnap(s)
    setHistory(h)
    setStatus(st)
    if (!intervalInput) setIntervalInput(String(st.interval_seconds))
    setLoading(false)
  }, []) // eslint-disable-line

  async function handleRefresh() {
    setRefreshing(true)
    await fetch('/api/stats/refresh', { method: 'POST' })
    setTimeout(async () => {
      await loadLatest()
      setRefreshing(false)
    }, 3500)
  }

  async function handleStart() {
    setControlBusy(true)
    const r = await fetch('/api/stats/start', { method: 'POST' })
    setStatus(await r.json())
    setControlBusy(false)
  }

  async function handleStop() {
    setControlBusy(true)
    const r = await fetch('/api/stats/stop', { method: 'POST' })
    setStatus(await r.json())
    setControlBusy(false)
  }

  async function handleConfigure() {
    const secs = parseInt(intervalInput)
    if (!secs || secs < 10) return
    setControlBusy(true)
    const r = await fetch('/api/stats/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval_seconds: secs }),
    })
    setStatus(await r.json())
    setControlBusy(false)
  }

  useEffect(() => {
    loadLatest()
    const poll = setInterval(loadLatest, 30000)
    return () => clearInterval(poll)
  }, [loadLatest])

  // Tick age counter
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setAge(snap?.timestamp ? formatAge(snap.timestamp) : 'never')
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [snap?.timestamp])

  // CPU sparkline history per node name
  const cpuHistory: Record<string, number[]> = {}
  for (const s of history) {
    for (const n of s.nodes) {
      if (!cpuHistory[n.name]) cpuHistory[n.name] = []
      cpuHistory[n.name].push(n.cpu_pct)
    }
  }

  if (loading) return <p style={{ color: '#8890a0' }}>Loading stats...</p>

  const nodes = snap?.nodes ?? []
  const vms = snap?.vms ?? []
  const containers = snap?.containers ?? []

  // Group VMs and containers by node/host
  const vmsByNode: Record<string, VMStat[]> = {}
  for (const vm of vms) {
    if (!vmsByNode[vm.node]) vmsByNode[vm.node] = []
    vmsByNode[vm.node].push(vm)
  }

  const containersByHost: Record<string, ContainerStat[]> = {}
  for (const c of containers) {
    if (!containersByHost[c.host]) containersByHost[c.host] = []
    containersByHost[c.host].push(c)
  }

  const hasData = nodes.length > 0

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Stats</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {snap?.timestamp ? (
            <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>Updated: {age}</span>
          ) : null}
          <button style={btnSecondary} onClick={handleRefresh} disabled={refreshing || !status?.running}>
            {refreshing ? 'Collecting...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Collector controls */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '0.65rem 1rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px',
            background: status?.running ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
            color: status?.running ? '#22c55e' : '#9ca3af',
          }}>
            {status?.running ? 'running' : 'stopped'}
          </span>
          {status?.running ? (
            <button style={btnRed} disabled={controlBusy} onClick={handleStop}>Stop</button>
          ) : (
            <button style={btnGreen} disabled={controlBusy} onClick={handleStart}>Start</button>
          )}
        </div>
        <div style={{ width: '1px', height: '24px', background: '#2a2a3e' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ color: '#8890a0', fontSize: '0.78rem' }}>Poll every</label>
          <input
            style={inputStyle}
            type="number"
            min={10}
            value={intervalInput}
            onChange={e => setIntervalInput(e.target.value)}
          />
          <span style={{ color: '#8890a0', fontSize: '0.78rem' }}>seconds</span>
          <button
            style={btnSecondary}
            disabled={controlBusy || !intervalInput || parseInt(intervalInput) < 10}
            onClick={handleConfigure}
          >Apply</button>
        </div>
      </div>

      {!hasData && !loading && (
        <div style={{ ...cardStyle, color: '#8890a0', fontSize: '0.85rem' }}>
          {status?.running
            ? 'No stats yet — first collection happens shortly. Click Refresh to collect now.'
            : 'Collector is stopped. Click Start to begin collecting stats.'}
        </div>
      )}

      {/* Node + VM cards */}
      {nodes.map(node => {
        const nodeVMs = (vmsByNode[node.name] || []).sort((a, b) => a.name.localeCompare(b.name))
        const memPct = node.mem_total_mb > 0 ? (node.mem_used_mb / node.mem_total_mb) * 100 : 0
        const diskPct = node.disk_total_gb > 0 ? (node.disk_used_gb / node.disk_total_gb) * 100 : 0
        const sparkValues = cpuHistory[node.name] || []

        return (
          <div key={node.name} style={cardStyle}>
            {/* Node header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.85rem' }}>
              <div>
                <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '1rem' }}>{node.name}</span>
                <span style={{ color: '#6b7280', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                  up {formatUptime(node.uptime_s)}
                </span>
              </div>
              {sparkValues.length >= 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem' }}>
                  <span style={{ color: '#6b7280', fontSize: '0.65rem' }}>CPU (1h)</span>
                  <Sparkline values={sparkValues} color="#7c9ef8" />
                </div>
              )}
            </div>

            {/* Node gauges */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '0.85rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                  <span style={labelStyle}>CPU</span>
                  <span style={{ color: '#e0e0e0', fontSize: '0.82rem', fontWeight: 600 }}>{node.cpu_pct}%</span>
                </div>
                <GaugeBar pct={node.cpu_pct} color="#7c9ef8" />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                  <span style={labelStyle}>Memory</span>
                  <span style={{ color: '#e0e0e0', fontSize: '0.82rem', fontWeight: 600 }}>
                    {formatMem(node.mem_used_mb)} / {formatMem(node.mem_total_mb)}
                  </span>
                </div>
                <GaugeBar pct={memPct} color="#22c55e" />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                  <span style={labelStyle}>Disk</span>
                  <span style={{ color: '#e0e0e0', fontSize: '0.82rem', fontWeight: 600 }}>
                    {node.disk_used_gb.toFixed(1)} / {node.disk_total_gb.toFixed(1)} GB
                  </span>
                </div>
                <GaugeBar pct={diskPct} color="#f59e0b" />
              </div>
            </div>

            {/* VMs on this node */}
            {nodeVMs.length > 0 && (
              <div style={{ borderTop: '1px solid #2a2a3e', paddingTop: '0.65rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.3rem', padding: '0 0.25rem' }}>
                  {['VM', 'Status', 'CPU', 'Memory'].map(h => (
                    <span key={h} style={{ ...labelStyle, marginBottom: 0 }}>{h}</span>
                  ))}
                </div>
                {nodeVMs.map(vm => {
                  const vmMemPct = vm.mem_total_mb > 0 ? (vm.mem_used_mb / vm.mem_total_mb) * 100 : 0
                  const isRunning = vm.status === 'running'
                  return (
                    <div key={vm.name} style={{
                      display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 1fr 1fr',
                      gap: '0.5rem', alignItems: 'center',
                      padding: '0.35rem 0.25rem',
                      borderRadius: '4px',
                      opacity: isRunning ? 1 : 0.45,
                    }}>
                      <span style={{ color: '#b0b8d0', fontSize: '0.82rem' }}>{vm.name}</span>
                      <span style={{
                        fontSize: '0.65rem', padding: '0.1rem 0.35rem', borderRadius: '9999px',
                        background: isRunning ? '#166534' : '#374151',
                        color: isRunning ? '#86efac' : '#9ca3af',
                        textAlign: 'center',
                      }}>{vm.status}</span>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.15rem' }}>
                          <span style={{ color: '#8890a0', fontSize: '0.72rem' }}>{vm.cpu_pct}%</span>
                        </div>
                        <GaugeBar pct={vm.cpu_pct} color="#7c9ef8" />
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.15rem' }}>
                          <span style={{ color: '#8890a0', fontSize: '0.72rem' }}>
                            {formatMem(vm.mem_used_mb)} / {formatMem(vm.mem_total_mb)}
                          </span>
                        </div>
                        <GaugeBar pct={vmMemPct} color="#22c55e" />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Container stats */}
      {Object.keys(containersByHost).length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ color: '#e0e0e0', fontSize: '0.95rem', margin: '0 0 0.85rem 0' }}>Containers</h2>
          {Object.entries(containersByHost).sort(([a], [b]) => a.localeCompare(b)).map(([host, ctrs]) => (
            <div key={host} style={{ marginBottom: '1rem' }}>
              <div style={{ color: '#8890a0', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                {host}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.5fr', gap: '0.5rem', marginBottom: '0.25rem', padding: '0 0.25rem' }}>
                {['Container', 'CPU', 'Memory'].map(h => (
                  <span key={h} style={{ ...labelStyle, marginBottom: 0 }}>{h}</span>
                ))}
              </div>
              {ctrs.sort((a, b) => a.name.localeCompare(b.name)).map(c => {
                const memPct = c.mem_limit_mb > 0 ? (c.mem_used_mb / c.mem_limit_mb) * 100 : 0
                return (
                  <div key={c.name} style={{
                    display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.5fr',
                    gap: '0.5rem', alignItems: 'center',
                    padding: '0.3rem 0.25rem',
                  }}>
                    <span style={{ color: '#b0b8d0', fontSize: '0.82rem' }}>{c.name}</span>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.15rem' }}>
                        <span style={{ color: '#8890a0', fontSize: '0.72rem' }}>{c.cpu_pct}%</span>
                      </div>
                      <GaugeBar pct={c.cpu_pct} color="#7c9ef8" />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.15rem' }}>
                        <span style={{ color: '#8890a0', fontSize: '0.72rem' }}>
                          {formatMem(c.mem_used_mb)}
                          {c.mem_limit_mb > 0 ? ` / ${formatMem(c.mem_limit_mb)}` : ''}
                        </span>
                      </div>
                      <GaugeBar pct={memPct} color="#22c55e" />
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
