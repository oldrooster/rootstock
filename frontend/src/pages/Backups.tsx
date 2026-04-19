import { useEffect, useRef, useState, useCallback } from 'react'
import { getWsUrl } from '../lib/api'

function describeCron(expr: string): string {
  if (!expr.trim()) return ''
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const [min, hour, dom, mon, dow] = parts
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  let time = ''
  if (hour !== '*' && min !== '*') {
    const h = parseInt(hour)
    const m = parseInt(min)
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    time = m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
  } else if (hour !== '*') {
    const h = parseInt(hour)
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    time = `${h12}${ampm}`
  } else {
    time = 'every minute'
  }

  if (dom === '*' && mon === '*' && dow === '*') return `${time} every day`
  if (dom === '*' && mon === '*' && dow !== '*') {
    const dayNames = dow.split(',').map(d => { const n = parseInt(d); return isNaN(n) ? d : (DAYS[n] || d) })
    return dayNames.length === 1 ? `${time} every ${dayNames[0]}` : `${time} on ${dayNames.join(', ')}`
  }
  if (dom !== '*' && mon === '*' && dow === '*') return `${time} on day ${dom} of every month`
  if (dom !== '*' && mon !== '*') { const monthName = MONTHS[parseInt(mon)] || mon; return `${time} on ${monthName} ${dom}` }
  if (min.startsWith('*/')) return `every ${min.slice(2)} minutes`
  if (hour.startsWith('*/')) return `every ${hour.slice(2)} hours`
  return expr
}

interface BackupPath {
  host: string
  path: string
  source: 'container' | 'manual'
  description: string
  exclusions: string[]
}

interface ManualBackupPath {
  host: string
  path: string
  description: string
}

interface PathStat {
  host: string
  path: string
  slug: string
  size_bytes: number
  backup_sets: number
}

interface StatsResponse {
  updated_at: number
  stats: PathStat[]
}

interface HostInfo {
  name: string
  type: string
  status: string
}

interface BackupSettings {
  backup_target: string
  backup_schedule: string
}

interface CronStatusInfo {
  installed: boolean
  schedule: string
  error?: string
}

interface S3SyncConfig {
  enabled: boolean
  bucket: string
  region: string
  access_key_secret: string
  secret_key_secret: string
  sync_host: string
  schedule: string
  prefix: string
}

interface SnapshotInfo {
  slug: string
  dates: string[]
}

interface StepMsg {
  step: string
  status: string
  detail: string
}

const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: '6px',
  padding: '1.25rem',
  marginBottom: '1.5rem',
}

const inputStyle: React.CSSProperties = {
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  color: '#e0e0e0',
  padding: '0.4rem 0.6rem',
  borderRadius: '4px',
  fontSize: '0.85rem',
  width: '100%',
  boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' }

const btnStyle: React.CSSProperties = {
  padding: '0.4rem 0.9rem',
  borderRadius: '4px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 600,
}

const btnPrimary: React.CSSProperties = { ...btnStyle, background: '#7c9ef8', color: '#0f0f1a' }
const btnDanger: React.CSSProperties = { ...btnStyle, background: '#f87171', color: '#0f0f1a' }
const btnSecondary: React.CSSProperties = { ...btnStyle, background: '#2a2a3e', color: '#e0e0e0' }
const btnSuccess: React.CSSProperties = { ...btnStyle, background: '#22c55e', color: '#0f0f1a' }
const btnAmber: React.CSSProperties = { ...btnStyle, background: '#f59e0b', color: '#0f0f1a' }

const labelStyle: React.CSSProperties = {
  color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase',
  display: 'block', marginBottom: '0.25rem',
}

const emptyManual: ManualBackupPath = { host: '', path: '', description: '' }

/* ── Step Progress Renderer ────────────────────────────────────── */

function StepList({ steps }: { steps: StepMsg[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [steps])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '400px', overflowY: 'auto' }}>
      {steps.map((s, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
          padding: '0.4rem 0.6rem', background: '#0f0f1a', borderRadius: '4px',
          border: '1px solid #2a2a3e',
        }}>
          <span style={{
            flexShrink: 0, width: '1.2rem', textAlign: 'center', fontSize: '0.85rem',
            color: s.status === 'done' ? '#22c55e'
              : s.status === 'error' ? '#ef4444'
              : s.status === 'running' ? '#f59e0b'
              : '#8890a0',
          }}>
            {s.status === 'done' ? '\u2713'
              : s.status === 'error' ? '\u2717'
              : s.status === 'running' ? '\u25CB'
              : '\u00B7'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: '#e0e0e0', fontSize: '0.85rem', fontWeight: 600,
              textTransform: 'capitalize',
            }}>{s.step.replace(/^(host|vol):/, '')}</div>
            {s.detail && (
              <div style={{
                color: '#8890a0', fontSize: '0.8rem', marginTop: '0.1rem',
                fontFamily: s.detail.includes('%') ? 'monospace' : 'inherit',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>{s.detail}</div>
            )}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}

/* ── Main Page ─────────────────────────────────────────────────── */

export default function Backups() {
  const [paths, setPaths] = useState<BackupPath[]>([])
  const [manualPaths, setManualPaths] = useState<ManualBackupPath[]>([])
  const [hosts, setHosts] = useState<HostInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backupSettings, setBackupSettings] = useState<BackupSettings>({ backup_target: '', backup_schedule: '' })
  const [editingSettings, setEditingSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({ target: '', hour: '2', minute: '0', days: new Set<string>(['0', '1', '2', '3', '4', '5', '6']) })
  const [settingsSaving, setSettingsSaving] = useState(false)

  // Manual form
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [manualForm, setManualForm] = useState<ManualBackupPath>({ ...emptyManual })
  const [manualError, setManualError] = useState<string | null>(null)

  // Backup Now dialog
  const [showBackup, setShowBackup] = useState(false)
  const [backupSelection, setBackupSelection] = useState<Set<string>>(new Set())
  const [backupRunning, setBackupRunning] = useState(false)
  const [backupSteps, setBackupSteps] = useState<StepMsg[]>([])
  const backupWsRef = useRef<WebSocket | null>(null)

  // Restore dialog
  const [showRestore, setShowRestore] = useState(false)
  const [restoreHost, setRestoreHost] = useState('')
  const [restoreSnapshots, setRestoreSnapshots] = useState<SnapshotInfo[]>([])
  const [restoreDate, setRestoreDate] = useState('')
  const [restoreSelection, setRestoreSelection] = useState<Set<string>>(new Set())
  const [restoreTargetHost, setRestoreTargetHost] = useState('')
  const [restoreRunning, setRestoreRunning] = useState(false)
  const [restoreSteps, setRestoreSteps] = useState<StepMsg[]>([])
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)
  const restoreWsRef = useRef<WebSocket | null>(null)

  // Stats
  const [stats, setStats] = useState<PathStat[]>([])
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<number>(0)
  const [statsLoading, setStatsLoading] = useState(false)

  // Export/Import
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  // Last backup times: "host:path" -> date string
  const [lastBackups, setLastBackups] = useState<Record<string, string>>({})
  const [lastBackupsLoading, setLastBackupsLoading] = useState(false)

  // Cron status per host
  const [cronStatus, setCronStatus] = useState<Record<string, CronStatusInfo>>({})
  const [cronLoading, setCronLoading] = useState(false)

  // Purge
  const [showPurge, setShowPurge] = useState(false)
  const [purgeHost, setPurgeHost] = useState('')
  const [purgeSnapshots, setPurgeSnapshots] = useState<{ slug: string; dates: string[] }[]>([])
  const [purgeSelection, setPurgeSelection] = useState<Set<string>>(new Set()) // "slug:date"
  const [purgeRunning, setPurgeRunning] = useState(false)
  const [purgeResult, setPurgeResult] = useState<string | null>(null)
  const [purgeConfirm, setPurgeConfirm] = useState(false)

  // S3 config
  const [s3Config, setS3Config] = useState<S3SyncConfig>({
    enabled: false, bucket: '', region: 'us-east-1',
    access_key_secret: '', secret_key_secret: '',
    sync_host: '', schedule: '', prefix: '',
  })
  const [s3Dirty, setS3Dirty] = useState(false)
  const [s3Saving, setS3Saving] = useState(false)

  const fetchStats = useCallback((refresh = false) => {
    setStatsLoading(true)
    fetch(`/api/backups/stats${refresh ? '?refresh=true' : ''}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: StatsResponse) => {
        setStats(data.stats)
        setStatsUpdatedAt(data.updated_at)
      })
      .catch(e => console.error('Failed to load stats:', e))
      .finally(() => setStatsLoading(false))
  }, [])

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '\u2014'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    const val = bytes / Math.pow(1024, i)
    return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
  }

  const getStatForPath = (host: string, path: string): PathStat | undefined => {
    return stats.find(s => s.host === host && s.path === path)
  }

  const exportSettings = useCallback(() => {
    fetch('/api/settings/export')
      .then(r => r.json())
      .then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `rootstock-export-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(e => setError(e.message))
  }, [])

  const importSettings = useCallback((file: File) => {
    setImporting(true)
    setImportResult(null)
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { setImportResult({ ok: false, msg: 'Invalid JSON file' }); setImporting(false); return }
      fetch('/api/settings/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(() => {
        setImportResult({ ok: true, msg: 'Settings imported successfully' })
        fetchAll()
      })
      .catch(e => setImportResult({ ok: false, msg: e.message }))
      .finally(() => setImporting(false))
    }
    reader.readAsText(file)
  }, [])

  const fetchLastBackups = useCallback(() => {
    setLastBackupsLoading(true)
    fetch('/api/backups/last-backup')
      .then(r => r.json())
      .then(setLastBackups)
      .catch(() => {})
      .finally(() => setLastBackupsLoading(false))
  }, [])

  const fetchCronStatus = useCallback(() => {
    setCronLoading(true)
    fetch('/api/backups/cron-status')
      .then(r => r.json())
      .then(setCronStatus)
      .catch(() => {})
      .finally(() => setCronLoading(false))
  }, [])

  const fetchAll = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/backups/paths').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/backups/manual').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/hosts/').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/settings/').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
    ])
      .then(([p, m, h, s]) => {
        setPaths(p)
        setManualPaths(m)
        setHosts(h)
        const target = s.global_settings?.backup_target || ''
        const schedule = s.global_settings?.backup_schedule || ''
        setBackupSettings({ backup_target: target, backup_schedule: schedule })
        // Parse schedule into form
        if (schedule.trim()) {
          const parts = schedule.trim().split(/\s+/)
          if (parts.length === 5) {
            const [min, hour, , , dow] = parts
            const days = dow === '*' ? new Set(['0','1','2','3','4','5','6']) : new Set<string>(dow.split(',').filter(Boolean))
            setSettingsForm({ target, hour: hour === '*' ? '2' : hour, minute: min === '*' ? '0' : min, days })
          }
        } else {
          setSettingsForm(f => ({ ...f, target }))
        }
        if (s.global_settings?.s3_sync) {
          setS3Config(prev => ({ ...prev, ...s.global_settings.s3_sync }))
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll(); fetchStats(); fetchLastBackups(); fetchCronStatus() }, [])

  // Group paths by host
  const pathsByHost: Record<string, BackupPath[]> = {}
  for (const p of paths) {
    if (!pathsByHost[p.host]) pathsByHost[p.host] = []
    pathsByHost[p.host].push(p)
  }

  const saveManualPath = () => {
    setManualError(null)
    const method = editingIndex !== null ? 'PUT' : 'POST'
    const url = editingIndex !== null ? `/api/backups/manual/${editingIndex}` : '/api/backups/manual'
    fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manualForm) })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(list => {
        setManualPaths(list)
        setEditingIndex(null)
        setManualForm({ ...emptyManual })
        fetch('/api/backups/paths').then(r => r.json()).then(setPaths)
      })
      .catch(e => setManualError(e.message))
  }

  const deleteManualPath = (index: number) => {
    fetch(`/api/backups/manual/${index}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(list => {
        setManualPaths(list)
        fetch('/api/backups/paths').then(r => r.json()).then(setPaths)
      })
      .catch(e => setManualError(e.message))
  }

  /* ── Backup Now ─────────────────────────────────────────── */

  function openBackupDialog() {
    // Pre-select all volumes
    const all = new Set(paths.map(p => `${p.host}:${p.path}`))
    setBackupSelection(all)
    setBackupSteps([])
    setBackupRunning(false)
    setShowBackup(true)
  }

  function toggleBackupVol(key: string) {
    setBackupSelection(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function startBackup() {
    if (backupSelection.size === 0) return
    setBackupRunning(true)
    setBackupSteps([])

    const params = new URLSearchParams()
    params.set('volumes', Array.from(backupSelection).join(','))
    const ws = new WebSocket(getWsUrl(`/api/backups/run?${params}`))
    backupWsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const step = JSON.parse(e.data) as StepMsg
        setBackupSteps(prev => {
          const idx = prev.findIndex(s => s.step === step.step)
          if (idx >= 0) { const u = [...prev]; u[idx] = step; return u }
          return [...prev, step]
        })
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      setBackupRunning(false)
    }
  }

  function closeBackupDialog() {
    if (backupWsRef.current) { backupWsRef.current.close(); backupWsRef.current = null }
    setShowBackup(false)
    setBackupSteps([])
    setBackupRunning(false)
  }

  /* ── Restore ────────────────────────────────────────────── */

  function openRestoreDialog() {
    setRestoreHost('')
    setRestoreSnapshots([])
    setRestoreDate('')
    setRestoreSelection(new Set())
    setRestoreTargetHost('')
    setRestoreSteps([])
    setRestoreRunning(false)
    setShowRestore(true)
  }

  async function loadSnapshots(hostName: string) {
    setRestoreHost(hostName)
    setRestoreDate('')
    setRestoreSelection(new Set())
    setRestoreSnapshots([])
    setLoadingSnapshots(true)
    try {
      const r = await fetch(`/api/backups/snapshots/${encodeURIComponent(hostName)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setRestoreSnapshots(data)
    } catch {
      setRestoreSnapshots([])
    } finally {
      setLoadingSnapshots(false)
    }
  }

  // Reverse-lookup: slug -> original path
  function slugToPath(slug: string): string {
    for (const p of paths) {
      if (p.host === restoreHost) {
        const s = p.path.replace(/^\//, '').replace(/[^a-zA-Z0-9_.-]/g, '_')
        if (s === slug) return p.path
      }
    }
    return slug // fallback
  }

  // Collect all unique dates across all snapshots for a host
  const allRestoreDates: string[] = (() => {
    const dates = new Set<string>()
    for (const s of restoreSnapshots) {
      for (const d of s.dates) dates.add(d)
    }
    return [...dates].sort().reverse()
  })()

  // Volumes available for the selected date
  const restoreVolumesForDate: { slug: string; path: string }[] = (() => {
    if (!restoreDate) return []
    return restoreSnapshots
      .filter(s => s.dates.includes(restoreDate))
      .map(s => ({ slug: s.slug, path: slugToPath(s.slug) }))
  })()

  function selectRestoreDate(date: string) {
    setRestoreDate(date)
    // Pre-select all volumes for this date
    const vols = restoreSnapshots
      .filter(s => s.dates.includes(date))
      .map(s => slugToPath(s.slug))
    setRestoreSelection(new Set(vols))
  }

  function toggleRestoreVol(path: string) {
    setRestoreSelection(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function startRestore() {
    if (!restoreHost || !restoreDate || restoreSelection.size === 0) return
    setRestoreRunning(true)
    setRestoreSteps([])

    const params = new URLSearchParams({
      host: restoreHost,
      paths: Array.from(restoreSelection).join(','),
      snapshot: restoreDate,
    })
    if (restoreTargetHost && restoreTargetHost !== restoreHost) {
      params.set('target_host', restoreTargetHost)
    }
    const ws = new WebSocket(getWsUrl(`/api/backups/restore?${params}`))
    restoreWsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const step = JSON.parse(e.data) as StepMsg
        setRestoreSteps(prev => {
          const idx = prev.findIndex(s => s.step === step.step)
          if (idx >= 0) { const u = [...prev]; u[idx] = step; return u }
          return [...prev, step]
        })
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      setRestoreRunning(false)
    }
  }

  function closeRestoreDialog() {
    if (restoreWsRef.current) { restoreWsRef.current.close(); restoreWsRef.current = null }
    setShowRestore(false)
    setRestoreSteps([])
    setRestoreRunning(false)
  }

  /* ── Purge ──────────────────────────────────────────────── */

  function openPurgeDialog() {
    setPurgeHost('')
    setPurgeSnapshots([])
    setPurgeSelection(new Set())
    setPurgeRunning(false)
    setPurgeResult(null)
    setPurgeConfirm(false)
    setShowPurge(true)
  }

  function loadPurgeSnapshots(host: string) {
    setPurgeHost(host)
    setPurgeSnapshots([])
    setPurgeSelection(new Set())
    setPurgeResult(null)
    setPurgeConfirm(false)
    if (!host) return
    fetch(`/api/backups/snapshots/${host}`)
      .then(r => r.json())
      .then(setPurgeSnapshots)
      .catch(() => {})
  }

  function togglePurgeItem(key: string) {
    setPurgeSelection(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
    setPurgeConfirm(false)
  }

  function executePurge() {
    if (!purgeConfirm) { setPurgeConfirm(true); return }
    setPurgeRunning(true)
    setPurgeResult(null)

    // Build items: group by slug -> dates
    const bySlug: Record<string, string[]> = {}
    for (const key of purgeSelection) {
      const [slug, date] = key.split(':', 2)
      if (!bySlug[slug]) bySlug[slug] = []
      bySlug[slug].push(date)
    }
    // Convert slugs back to paths (best effort from snapshot data)
    const items = Object.entries(bySlug).map(([slug, dates]) => ({
      host: purgeHost,
      path: slug, // path_slug is used on backend to resolve
      dates,
    }))

    fetch('/api/backups/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
      .then(r => r.json())
      .then(data => {
        const ok = data.results?.filter((r: { ok?: boolean }) => r.ok).length || 0
        const err = data.results?.filter((r: { error?: string }) => r.error).length || 0
        setPurgeResult(`Purged ${ok} snapshot(s)${err > 0 ? `, ${err} error(s)` : ''}`)
        fetchStats(true)
        fetchLastBackups()
        loadPurgeSnapshots(purgeHost)
      })
      .catch(e => setPurgeResult(`Error: ${e.message}`))
      .finally(() => { setPurgeRunning(false); setPurgeConfirm(false) })
  }

  /* ── Global Settings Save ──────────────────────────────── */

  function saveBackupSettings() {
    const sortedDays = Array.from(settingsForm.days).sort().join(',')
    const dowPart = settingsForm.days.size === 7 ? '*' : sortedDays
    const cron = `${settingsForm.minute} ${settingsForm.hour} * * ${dowPart}`
    setSettingsSaving(true)
    fetch('/api/settings/')
      .then(r => r.json())
      .then(data => {
        const gs = data.global_settings || {}
        gs.backup_target = settingsForm.target
        gs.backup_schedule = cron
        return fetch('/api/settings/global', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gs),
        })
      })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(() => {
        const sortedDows = Array.from(settingsForm.days).sort().join(',')
        setBackupSettings({
          backup_target: settingsForm.target,
          backup_schedule: `${settingsForm.minute} ${settingsForm.hour} * * ${settingsForm.days.size === 7 ? '*' : sortedDows}`,
        })
        setEditingSettings(false)
      })
      .catch(e => setError(e.message))
      .finally(() => setSettingsSaving(false))
  }

  /* ── S3 Config ─────────────────────────────────────────── */

  function saveS3Config() {
    setS3Saving(true)
    // Load current global settings, update s3_sync, save
    fetch('/api/settings/')
      .then(r => r.json())
      .then(data => {
        const gs = data.global_settings || {}
        gs.s3_sync = s3Config
        return fetch('/api/settings/global', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gs),
        })
      })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(() => { setS3Dirty(false) })
      .catch(e => setError(e.message))
      .finally(() => setS3Saving(false))
  }

  /* ── Render ─────────────────────────────────────────────── */

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>
  if (loading) return <p style={{ color: '#8890a0' }}>Loading...</p>

  const hostNames = [...new Set([...hosts.map(h => h.name), ...paths.map(p => p.host)])]
  const sortedHosts = Object.entries(pathsByHost).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ color: '#e0e0e0', margin: 0 }}>Backups</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button style={btnSecondary} onClick={exportSettings}>Export</button>
          <button style={btnSecondary} onClick={() => importFileRef.current?.click()} disabled={importing}>
            {importing ? 'Importing...' : 'Import'}
          </button>
          <input ref={importFileRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) { importSettings(e.target.files[0]); e.target.value = '' } }} />
          <div style={{ width: '1px', height: '1.5rem', background: '#2a2a3e' }} />
          <button style={btnSuccess} onClick={openBackupDialog} disabled={paths.length === 0}>Backup Now</button>
          <button style={btnAmber} onClick={openRestoreDialog}>Restore</button>
          <button style={btnDanger} onClick={openPurgeDialog} disabled={paths.length === 0}>Purge</button>
        </div>
      </div>

      {importResult && (
        <div style={{
          padding: '0.5rem 1rem', borderRadius: '4px', marginBottom: '0.75rem', fontSize: '0.85rem',
          background: importResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(248,113,113,0.1)',
          border: `1px solid ${importResult.ok ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.3)'}`,
          color: importResult.ok ? '#86efac' : '#fca5a5',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{importResult.msg}</span>
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem' }}
            onClick={() => setImportResult(null)}>&times;</button>
        </div>
      )}

      {/* Settings card */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: editingSettings ? '0.75rem' : 0 }}>
          <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <span style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase' }}>Target: </span>
              <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                {backupSettings.backup_target || <span style={{ color: '#f87171' }}>not configured</span>}
              </span>
            </div>
            <div>
              <span style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase' }}>Schedule: </span>
              {backupSettings.backup_schedule
                ? <span style={{ color: '#e0e0e0', fontSize: '0.85rem' }}>{describeCron(backupSettings.backup_schedule)}</span>
                : <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>not set</span>
              }
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {statsUpdatedAt > 0 && (
              <span style={{ color: '#6b7280', fontSize: '0.7rem' }}>
                Stats: {new Date(statsUpdatedAt * 1000).toLocaleString()}
              </span>
            )}
            <button style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
              onClick={() => fetchStats(true)} disabled={statsLoading}>
              {statsLoading ? 'Calculating...' : 'Refresh Stats'}
            </button>
            <button
              style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
              onClick={() => {
                setSettingsForm(f => ({ ...f, target: backupSettings.backup_target }))
                setEditingSettings(!editingSettings)
              }}
            >{editingSettings ? 'Cancel' : 'Edit'}</button>
          </div>
        </div>

        {/* Inline schedule builder */}
        {editingSettings && (
          <div style={{ borderTop: '1px solid #2a2a3e', paddingTop: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.75rem', alignItems: 'end', marginBottom: '0.75rem' }}>
              <div>
                <label style={labelStyle}>Backup Target Path</label>
                <input
                  style={inputStyle}
                  placeholder="/mnt/nas/backups"
                  value={settingsForm.target}
                  onChange={e => setSettingsForm(f => ({ ...f, target: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>Hour</label>
                <select
                  style={{ ...selectStyle, width: 'auto' }}
                  value={settingsForm.hour}
                  onChange={e => setSettingsForm(f => ({ ...f, hour: e.target.value }))}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={String(i)}>
                      {i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i - 12}pm`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Minute</label>
                <select
                  style={{ ...selectStyle, width: 'auto' }}
                  value={settingsForm.minute}
                  onChange={e => setSettingsForm(f => ({ ...f, minute: e.target.value }))}
                >
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                    <option key={m} value={String(m)}>{String(m).padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ ...labelStyle, marginBottom: '0.4rem' }}>Days</label>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => {
                  const val = String(i)
                  const active = settingsForm.days.has(val)
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const next = new Set(settingsForm.days)
                        if (active) next.delete(val); else next.add(val)
                        setSettingsForm(f => ({ ...f, days: next }))
                      }}
                      style={{
                        padding: '0.25rem 0.55rem', borderRadius: '4px', cursor: 'pointer',
                        border: '1px solid #2a2a3e', fontSize: '0.82rem',
                        background: active ? '#7c9ef8' : '#0f0f1a',
                        color: active ? '#0f0f1a' : '#8890a0',
                        fontWeight: active ? 600 : 400,
                      }}
                    >{day}</button>
                  )
                })}
              </div>
            </div>

            {/* Preview */}
            {settingsForm.days.size > 0 && (
              <div style={{ color: '#8890a0', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
                Schedule: <span style={{ color: '#e0e0e0' }}>{describeCron(`${settingsForm.minute} ${settingsForm.hour} * * ${settingsForm.days.size === 7 ? '*' : Array.from(settingsForm.days).sort().join(',')}`)}</span>
              </div>
            )}

            <button
              style={btnPrimary}
              disabled={settingsSaving || !settingsForm.target || settingsForm.days.size === 0}
              onClick={saveBackupSettings}
            >{settingsSaving ? 'Saving...' : 'Save Settings'}</button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {sortedHosts.map(([host, hostPaths]) => {
          const hostTotal = stats
            .filter(s => s.host === host)
            .reduce((sum, s) => sum + s.size_bytes, 0)
          return (
          <div key={host} style={{ background: '#1a1a2e', borderRadius: '6px', padding: '1rem', textAlign: 'center' }}>
            <div style={{ color: '#8890a0', fontSize: '0.7rem', textTransform: 'uppercase', marginBottom: '0.35rem' }}>{host}</div>
            <div style={{ color: '#e0e0e0', fontSize: '1.5rem', fontWeight: 700 }}>{hostPaths.length}</div>
            <div style={{ color: '#8890a0', fontSize: '0.75rem' }}>volume{hostPaths.length !== 1 ? 's' : ''}</div>
            {hostTotal > 0 && (
              <div style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: '0.25rem' }}>{formatBytes(hostTotal)}</div>
            )}
            {cronLoading ? (
              <div style={{ marginTop: '0.35rem', fontSize: '0.65rem', color: '#6b7280' }}>...</div>
            ) : cronStatus[host] ? (
              <div style={{
                marginTop: '0.35rem', fontSize: '0.65rem', padding: '0.15rem 0.4rem',
                borderRadius: '9999px', display: 'inline-block',
                background: cronStatus[host].installed ? '#166534' : '#7f1d1d',
                color: cronStatus[host].installed ? '#86efac' : '#fca5a5',
              }}>
                {cronStatus[host].installed ? 'cron active' : 'no cron'}
              </div>
            ) : null}
          </div>
          )
        })}
        {sortedHosts.length === 0 && (
          <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
            <p style={{ color: '#8890a0', margin: 0 }}>No backup paths found. Add volumes with backup enabled to containers, or add manual paths below.</p>
          </div>
        )}
      </div>

      {/* Size chart */}
      {stats.length > 0 && (() => {
        const maxBytes = Math.max(...stats.map(s => s.size_bytes), 1)
        const sorted = [...stats].sort((a, b) => b.size_bytes - a.size_bytes)
        return (
          <div style={cardStyle}>
            <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Backup Size by Path</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {sorted.map((s, i) => {
                const pct = maxBytes > 0 ? (s.size_bytes / maxBytes) * 100 : 0
                const label = `${s.host}: ${s.path.replace(/^.*\/([^/]+)$/, '$1')}`
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '200px', flexShrink: 0, color: '#8890a0', fontSize: '0.75rem', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</div>
                    <div style={{ flex: 1, height: '14px', background: '#0f0f1a', borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: '3px',
                        background: pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#7c9ef8',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <div style={{ width: '70px', flexShrink: 0, color: '#e0e0e0', fontSize: '0.78rem', textAlign: 'right', fontFamily: 'monospace' }}>
                      {formatBytes(s.size_bytes)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* All paths grouped by host */}
      {sortedHosts.map(([host, hostPaths]) => (
        <div key={host} style={cardStyle}>
          <h2 style={{ color: '#7c9ef8', fontSize: '0.95rem', margin: '0 0 0.5rem 0' }}>{host}</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Path</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Source</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Description</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Exclusions</th>
                <th style={{ textAlign: 'right', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Last Backup</th>
                <th style={{ textAlign: 'right', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Size</th>
                <th style={{ textAlign: 'right', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Sets</th>
              </tr>
            </thead>
            <tbody>
              {hostPaths.map((p, i) => {
                const stat = getStatForPath(p.host, p.path)
                const lastDate = lastBackups[`${p.host}:${p.path}`]
                return (
                <tr key={`${p.path}-${i}`} style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <td style={{ color: '#e0e0e0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>{p.path}</td>
                  <td style={{ padding: '0.4rem 0.75rem' }}>
                    <span style={{
                      fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                      background: p.source === 'container' ? 'rgba(124,158,248,0.15)' : 'rgba(136,144,160,0.15)',
                      color: p.source === 'container' ? '#7c9ef8' : '#8890a0',
                    }}>{p.source}</span>
                  </td>
                  <td style={{ color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>{p.description || '\u2014'}</td>
                  <td style={{ color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                    {p.exclusions && p.exclusions.length > 0
                      ? p.exclusions.map((e, j) => (
                          <span key={j} style={{
                            fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px',
                            background: 'rgba(248,113,113,0.1)', color: '#fca5a5',
                            marginRight: '0.25rem', display: 'inline-block', marginBottom: '0.15rem',
                          }}>{e}</span>
                        ))
                      : '\u2014'}
                  </td>
                  <td style={{ color: lastDate && lastDate !== 'never' ? '#e0e0e0' : '#6b7280', padding: '0.4rem 0.75rem', fontSize: '0.85rem', textAlign: 'right' }}>
                    {lastBackupsLoading ? '...' : (lastDate && lastDate !== 'never' ? lastDate : '\u2014')}
                  </td>
                  <td style={{ color: '#e0e0e0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', textAlign: 'right', fontFamily: 'monospace' }}>
                    {stat ? formatBytes(stat.size_bytes) : '\u2014'}
                  </td>
                  <td style={{ color: '#e0e0e0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', textAlign: 'right' }}>
                    {stat ? (stat.backup_sets > 0 ? stat.backup_sets : '\u2014') : '\u2014'}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Manual Backup Paths */}
      <div style={cardStyle}>
        <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Manual Backup Paths</h2>
        {manualError && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0 0 0.5rem 0' }}>{manualError}</p>}

        {/* Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr auto', gap: '0.5rem', marginBottom: '1rem', alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Host</label>
            <select
              style={selectStyle}
              value={manualForm.host}
              onChange={e => setManualForm({ ...manualForm, host: e.target.value })}
            >
              <option value="">Select host...</option>
              {hostNames.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Path</label>
            <input
              style={inputStyle}
              placeholder="/home/pi/scripts"
              value={manualForm.path}
              onChange={e => setManualForm({ ...manualForm, path: e.target.value })}
            />
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <input
              style={inputStyle}
              placeholder="optional"
              value={manualForm.description}
              onChange={e => setManualForm({ ...manualForm, description: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button style={btnPrimary} onClick={saveManualPath}>
              {editingIndex !== null ? 'Update' : 'Add'}
            </button>
            {editingIndex !== null && (
              <button style={btnSecondary} onClick={() => { setEditingIndex(null); setManualForm({ ...emptyManual }) }}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* List */}
        {manualPaths.length === 0 ? (
          <p style={{ color: '#8890a0', margin: 0, fontSize: '0.85rem' }}>No manual backup paths. Use the form above to add one.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Host</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Path</th>
                <th style={{ textAlign: 'left', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Description</th>
                <th style={{ textAlign: 'right', color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {manualPaths.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <td style={{ color: '#e0e0e0', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>{p.host}</td>
                  <td style={{ color: '#b0b8d0', padding: '0.4rem 0.75rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>{p.path}</td>
                  <td style={{ color: '#8890a0', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>{p.description || '\u2014'}</td>
                  <td style={{ textAlign: 'right', padding: '0.4rem 0.75rem' }}>
                    <button
                      style={{ ...btnSecondary, marginRight: '0.35rem', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      onClick={() => { setEditingIndex(i); setManualForm({ ...p }) }}
                    >Edit</button>
                    <button
                      style={{ ...btnDanger, fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      onClick={() => deleteManualPath(i)}
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Backup Now Dialog ──────────────────────────────── */}
      {showBackup && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
        }} onClick={(e) => { if (e.target === e.currentTarget && !backupRunning) closeBackupDialog() }}>
          <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '1.5rem', width: '600px', maxHeight: '80vh', overflowY: 'auto' }}>
            <h2 style={{ color: '#e0e0e0', margin: '0 0 1rem 0', fontSize: '1.1rem' }}>Backup Now</h2>

            {!backupRunning && backupSteps.length === 0 && (
              <>
                <p style={{ color: '#8890a0', fontSize: '0.85rem', margin: '0 0 0.75rem 0' }}>
                  Select volumes to back up to <code style={{ color: '#c084fc' }}>{backupSettings.backup_target}</code>
                </p>

                {/* All / None */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                    onClick={() => setBackupSelection(new Set(paths.map(p => `${p.host}:${p.path}`)))}>All</button>
                  <button style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                    onClick={() => setBackupSelection(new Set())}>None</button>
                  <span style={{ color: '#8890a0', fontSize: '0.8rem', alignSelf: 'center', marginLeft: 'auto' }}>
                    {backupSelection.size} / {paths.length} selected
                  </span>
                </div>

                {/* Volume checkboxes grouped by host */}
                <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem' }}>
                  {sortedHosts.map(([host, hostPaths]) => (
                    <div key={host} style={{ marginBottom: '0.75rem' }}>
                      <div style={{ color: '#7c9ef8', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>{host}</div>
                      {hostPaths.map((p, i) => {
                        const key = `${p.host}:${p.path}`
                        return (
                          <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0', cursor: 'pointer' }}>
                            <input type="checkbox" checked={backupSelection.has(key)}
                              onChange={() => toggleBackupVol(key)} />
                            <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{p.path}</span>
                            {p.description && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>({p.description})</span>}
                          </label>
                        )
                      })}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button style={btnSecondary} onClick={closeBackupDialog}>Cancel</button>
                  <button style={btnSuccess} onClick={startBackup} disabled={backupSelection.size === 0}>
                    Start Backup ({backupSelection.size} volume{backupSelection.size !== 1 ? 's' : ''})
                  </button>
                </div>
              </>
            )}

            {/* Progress */}
            {(backupRunning || backupSteps.length > 0) && (
              <>
                <StepList steps={backupSteps} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  {!backupRunning && (
                    <button style={btnPrimary} onClick={closeBackupDialog}>Close</button>
                  )}
                  {backupRunning && (
                    <span style={{ color: '#f59e0b', fontSize: '0.85rem' }}>Backup in progress...</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Restore Dialog ─────────────────────────────────── */}
      {showRestore && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
        }} onClick={(e) => { if (e.target === e.currentTarget && !restoreRunning) closeRestoreDialog() }}>
          <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '1.5rem', width: '600px', maxHeight: '80vh', overflowY: 'auto' }}>
            <h2 style={{ color: '#e0e0e0', margin: '0 0 1rem 0', fontSize: '1.1rem' }}>Restore from Backup</h2>

            {!restoreRunning && restoreSteps.length === 0 && (
              <>
                {/* Host selection */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={labelStyle}>Host</label>
                  <select style={selectStyle} value={restoreHost}
                    onChange={e => loadSnapshots(e.target.value)}>
                    <option value="">Select host...</option>
                    {hostNames.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>

                {loadingSnapshots && <p style={{ color: '#8890a0', fontSize: '0.85rem' }}>Loading snapshots...</p>}

                {restoreHost && !loadingSnapshots && restoreSnapshots.length === 0 && (
                  <p style={{ color: '#8890a0', fontSize: '0.85rem' }}>No snapshots found for {restoreHost}</p>
                )}

                {/* Date selection */}
                {allRestoreDates.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={labelStyle}>Snapshot Date</label>
                    <select style={selectStyle} value={restoreDate}
                      onChange={e => selectRestoreDate(e.target.value)}>
                      <option value="">Select date...</option>
                      {allRestoreDates.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Volume checkboxes */}
                {restoreDate && restoreVolumesForDate.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                      <label style={{ ...labelStyle, margin: 0 }}>Volumes to Restore</label>
                      <button style={{ ...btnSecondary, fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                        onClick={() => setRestoreSelection(new Set(restoreVolumesForDate.map(v => v.path)))}>All</button>
                      <button style={{ ...btnSecondary, fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                        onClick={() => setRestoreSelection(new Set())}>None</button>
                      <span style={{ color: '#8890a0', fontSize: '0.8rem', marginLeft: 'auto' }}>
                        {restoreSelection.size} / {restoreVolumesForDate.length} selected
                      </span>
                    </div>
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {restoreVolumesForDate.map(v => (
                        <label key={v.slug} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0', cursor: 'pointer' }}>
                          <input type="checkbox" checked={restoreSelection.has(v.path)}
                            onChange={() => toggleRestoreVol(v.path)} />
                          <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontFamily: 'monospace' }}>{v.path}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Restore to different host */}
                {restoreDate && restoreSelection.size > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={labelStyle}>Restore To</label>
                    <select style={selectStyle} value={restoreTargetHost || restoreHost}
                      onChange={e => setRestoreTargetHost(e.target.value === restoreHost ? '' : e.target.value)}>
                      {hostNames.map(h => (
                        <option key={h} value={h}>{h}{h === restoreHost ? ' (source)' : ''}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Warning */}
                {restoreDate && restoreSelection.size > 0 && (
                  <div style={{
                    background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.3)',
                    borderRadius: '4px', padding: '0.75rem', marginBottom: '1rem',
                  }}>
                    <p style={{ color: '#fca5a5', fontSize: '0.85rem', margin: 0 }}>
                      This will stop affected containers on <strong>{restoreTargetHost || restoreHost}</strong>,
                      overwrite {restoreSelection.size} volume{restoreSelection.size !== 1 ? 's' : ''} with
                      the {restoreDate} snapshot from {restoreHost}, then restart the containers.
                    </p>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button style={btnSecondary} onClick={closeRestoreDialog}>Cancel</button>
                  <button style={btnAmber} onClick={startRestore}
                    disabled={!restoreHost || !restoreDate || restoreSelection.size === 0}>
                    Restore ({restoreSelection.size} volume{restoreSelection.size !== 1 ? 's' : ''})
                  </button>
                </div>
              </>
            )}

            {/* Progress */}
            {(restoreRunning || restoreSteps.length > 0) && (
              <>
                <StepList steps={restoreSteps} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  {!restoreRunning && (
                    <button style={btnPrimary} onClick={closeRestoreDialog}>Close</button>
                  )}
                  {restoreRunning && (
                    <span style={{ color: '#f59e0b', fontSize: '0.85rem' }}>Restore in progress...</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Purge Dialog ──────────────────────────────────── */}
      {showPurge && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
        }} onClick={(e) => { if (e.target === e.currentTarget && !purgeRunning) setShowPurge(false) }}>
          <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '1.5rem', width: '600px', maxHeight: '80vh', overflowY: 'auto' }}>
            <h2 style={{ color: '#e0e0e0', margin: '0 0 1rem 0', fontSize: '1.1rem' }}>Purge Backup Sets</h2>

            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Host</label>
              <select style={selectStyle} value={purgeHost}
                onChange={e => loadPurgeSnapshots(e.target.value)}>
                <option value="">Select host...</option>
                {hostNames.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>

            {purgeHost && purgeSnapshots.length === 0 && (
              <p style={{ color: '#8890a0', fontSize: '0.85rem' }}>No snapshots found for {purgeHost}</p>
            )}

            {purgeSnapshots.length > 0 && (
              <>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                    onClick={() => {
                      const all = new Set<string>()
                      purgeSnapshots.forEach(s => s.dates.forEach(d => all.add(`${s.slug}:${d}`)))
                      setPurgeSelection(all)
                    }}>All</button>
                  <button style={{ ...btnSecondary, fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                    onClick={() => setPurgeSelection(new Set())}>None</button>
                  <span style={{ color: '#8890a0', fontSize: '0.8rem', alignSelf: 'center', marginLeft: 'auto' }}>
                    {purgeSelection.size} selected
                  </span>
                </div>

                <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem' }}>
                  {purgeSnapshots.map(snap => (
                    <div key={snap.slug} style={{ marginBottom: '0.75rem' }}>
                      <div style={{ color: '#7c9ef8', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'monospace', marginBottom: '0.25rem' }}>
                        {snap.slug}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {snap.dates.map(date => {
                          const key = `${snap.slug}:${date}`
                          return (
                            <label key={date} style={{
                              display: 'flex', alignItems: 'center', gap: '0.3rem',
                              fontSize: '0.8rem', color: '#e0e0e0', padding: '0.2rem 0.5rem',
                              background: purgeSelection.has(key) ? 'rgba(248,113,113,0.15)' : '#0f0f1a',
                              border: '1px solid #2a2a3e', borderRadius: '4px', cursor: 'pointer',
                            }}>
                              <input type="checkbox" checked={purgeSelection.has(key)}
                                onChange={() => togglePurgeItem(key)} />
                              {date}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {purgeResult && (
              <div style={{
                padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem',
                background: purgeResult.startsWith('Error') ? 'rgba(248,113,113,0.1)' : 'rgba(34,197,94,0.1)',
                color: purgeResult.startsWith('Error') ? '#fca5a5' : '#86efac',
                fontSize: '0.85rem',
              }}>{purgeResult}</div>
            )}

            {purgeConfirm && !purgeRunning && (
              <div style={{
                background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.3)',
                borderRadius: '4px', padding: '0.75rem', marginBottom: '1rem',
              }}>
                <p style={{ color: '#fca5a5', fontSize: '0.85rem', margin: 0 }}>
                  This will permanently delete {purgeSelection.size} backup snapshot(s) from {purgeHost}.
                  This action cannot be undone. Click "Confirm Purge" to proceed.
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowPurge(false)} disabled={purgeRunning}>Cancel</button>
              {purgeSelection.size > 0 && (
                <button style={btnDanger} onClick={executePurge} disabled={purgeRunning}>
                  {purgeRunning ? 'Purging...' : purgeConfirm ? 'Confirm Purge' : `Purge (${purgeSelection.size})`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── S3 Sync Configuration ────────────────────────── */}
      <div style={cardStyle}>
        <h2 style={{ color: '#e0e0e0', fontSize: '1rem', margin: '0 0 0.75rem 0' }}>S3 Sync</h2>
        <p style={{ color: '#8890a0', fontSize: '0.8rem', margin: '0 0 0.75rem 0' }}>
          Sync backup sets to an AWS S3 bucket. Deployed via Ansible: Backups.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <label style={labelStyle}>S3 Bucket</label>
            <input style={inputStyle} value={s3Config.bucket}
              onChange={e => { setS3Config({ ...s3Config, bucket: e.target.value }); setS3Dirty(true) }}
              placeholder="my-homelab-backups" />
          </div>
          <div>
            <label style={labelStyle}>Region</label>
            <input style={inputStyle} value={s3Config.region}
              onChange={e => { setS3Config({ ...s3Config, region: e.target.value }); setS3Dirty(true) }}
              placeholder="us-east-1" />
          </div>
          <div>
            <label style={labelStyle}>Access Key (secret path)</label>
            <input style={inputStyle} value={s3Config.access_key_secret}
              onChange={e => { setS3Config({ ...s3Config, access_key_secret: e.target.value }); setS3Dirty(true) }}
              placeholder="aws/access_key" />
          </div>
          <div>
            <label style={labelStyle}>Secret Key (secret path)</label>
            <input style={inputStyle} value={s3Config.secret_key_secret}
              onChange={e => { setS3Config({ ...s3Config, secret_key_secret: e.target.value }); setS3Dirty(true) }}
              placeholder="aws/secret_key" />
          </div>
          <div>
            <label style={labelStyle}>Sync From Host</label>
            <select style={selectStyle} value={s3Config.sync_host}
              onChange={e => { setS3Config({ ...s3Config, sync_host: e.target.value }); setS3Dirty(true) }}>
              <option value="">Select host...</option>
              {hostNames.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>S3 Key Prefix</label>
            <input style={inputStyle} value={s3Config.prefix}
              onChange={e => { setS3Config({ ...s3Config, prefix: e.target.value }); setS3Dirty(true) }}
              placeholder="backups/" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Sync Schedule (cron, leave empty to use backup schedule)</label>
            <input style={inputStyle} value={s3Config.schedule}
              onChange={e => { setS3Config({ ...s3Config, schedule: e.target.value }); setS3Dirty(true) }}
              placeholder="0 4 * * *" />
            {s3Config.schedule && (
              <p style={{ color: '#8890a0', fontSize: '0.75rem', margin: '0.25rem 0 0 0' }}>
                {describeCron(s3Config.schedule)}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label style={{ color: '#8890a0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={s3Config.enabled}
              onChange={e => { setS3Config({ ...s3Config, enabled: e.target.checked }); setS3Dirty(true) }} />
            Enabled
          </label>
          <div style={{ marginLeft: 'auto' }}>
            <button style={btnPrimary} onClick={saveS3Config} disabled={!s3Dirty || s3Saving}>
              {s3Saving ? 'Saving...' : 'Save S3 Config'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
