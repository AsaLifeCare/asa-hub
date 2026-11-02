// Guardian — the platform's health, one screen.
// Severity bands, engines, the host's outside view and the neural cortex card came later.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, AlertTriangle, Archive, CheckCircle2, Clock, Cpu, FileText, HardDrive,
  HeartPulse, KeyRound, PhoneCall, RefreshCw, Server, ShieldCheck, ShieldOff,
  Table2, XCircle,
} from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import AiLaneTest from '@/components/shared/AiLaneTest'
import GuardianHero, { type GuardianFigures } from './GuardianHero'
import { authHeaders, loadIndex } from '@/lib/snapshotClient'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'

type Row = Record<string, any>

/* ---------- shared bits ---------- */

export type CheckState = 'ok' | 'warn' | 'fail' | 'loading' | 'unknown' | 'retired'

// the cortex was the old platform's: its doors answer 410 since the old platform was shut down, and it reads Retired here
const CORTEX_RETIRED = 'retired with the old platform'

const STATE_META: Record<CheckState, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-emerald-500', label: 'OK' },
  warn: { icon: AlertTriangle, cls: 'text-amber-500', label: 'Attention' },
  fail: { icon: XCircle, cls: 'text-rose-500', label: 'Failing' },
  loading: { icon: RefreshCw, cls: 'text-text-3 animate-spin', label: 'Checking' },
  unknown: { icon: Activity, cls: 'text-text-3', label: 'Unknown' },
  retired: { icon: Archive, cls: 'text-text-3', label: 'Retired' },
}

function Chip({ state }: { state: CheckState }) {
  // loading: icon only, no spinning word — the Recheck button's own pattern
  if (state === 'loading') {
    return <RefreshCw size={14} className="animate-spin text-text-3" />
  }
  const m = STATE_META[state]
  const Icon = m.icon
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-semibold', m.cls)}>
      <Icon size={14} /> {m.label}
    </span>
  )
}

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`
  return `${(ms / 86_400_000).toFixed(1)}d ago`
}

/** The snapshot index as this screen counts it. */
export type SnapshotSlices = { total: number; stale: string[]; missing: string[] }
export type SnapshotDetail = { name: string; age: string; error: boolean }

// THE SNAPSHOT CHECK'S OWN READ.
export async function readSnapshotIndex(): Promise<{ slices: SnapshotSlices; detail: SnapshotDetail[] } | null> {
  const index = await loadIndex()
  if (index === null) return null
  const entries = Object.entries(index)
  const now = Date.now()
  return {
    slices: {
      total: entries.length,
      stale: entries.filter(([, s]) => {
        const built = Date.parse(String((s as Row).built_at ?? ''))
        return !Number.isNaN(built) && now - built > 15 * 60 * 1000
      }).map(([k]) => k),
      missing: entries.filter(([, s]) => (s as Row).error).map(([k]) => k),
    },
    // per-slice detail for the table below — errors first, then by name
    detail: entries.map(([name, s]) => ({
      name,
      age: ago(String((s as Row).built_at ?? '')),
      error: Boolean((s as Row).error),
    })).sort((a, b) => Number(b.error) - Number(a.error) || a.name.localeCompare(b.name)),
  }
}

/** No index answer is unknown: watched, never counted green. */
export function snapshotCheckState(snap: SnapshotSlices | null): CheckState {
  if (!snap) return 'unknown'
  return snap.missing.length > 0 || snap.stale.length > 0 ? 'warn' : 'ok'
}

// The shield's verdict.
export function guardianOverall(checks: CheckState[], buttons: CheckState[]): CheckState {
  const states = [...checks, ...buttons.filter((s) => s === 'fail' || s === 'ok')]
  if (states.includes('fail')) return 'fail'
  if (states.includes('warn')) return 'warn'
  if (states.some((s) => s === 'loading' || s === 'unknown')) return 'unknown'
  return 'ok'
}

/** Small inline spinner — icon only, never a spinning word. */
function SmallLoader() {
  return <RefreshCw size={12} className="animate-spin text-text-3" />
}

/** The first numeric answer among several spellings, or null. */
function num(...vals: any[]): number | null {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Epoch seconds → the relative time `ago` speaks; 'never' when not a number. */
function epochAgo(v: any): string {
  const n = num(v)
  return n === null ? 'never' : ago(new Date(n * 1000).toISOString())
}

// A watchdog fleet sweep in one line: the detail JSON's services-down count when it carries one (under any of its…
function sweepLine(row: Row): string {
  let d: any = row?.detail
  if (typeof d === 'string') { try { d = JSON.parse(d) } catch { d = null } }
  if (d && typeof d === 'object') {
    const down = num(d.services_down, d.servicesDown, d.down, d.down_count)
    if (down !== null) return `${down} service(s) down`
  }
  return String(row?.title ?? 'fleet sweep')
}

// One status card: title, verdict chip, the card's own content, and the two lines the law asks for — 'checks:'…
function StatusCard({ title, state, checks, why, children }: {
  title: string
  state: CheckState
  checks: string
  why?: string
  children: ReactNode
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-text-2">{title}</span>
        <Chip state={state} />
      </div>
      {children}
      <p className="mt-3 border-t border-border pt-2 text-[11px] text-text-3">checks: {checks}</p>
      {state !== 'ok' && why && (
        <p className={cn('mt-1 text-[11px]',
          state === 'fail' ? 'text-rose-500'
            : state === 'warn' ? 'text-amber-600' : 'text-text-3')}>
          why: {why}
        </p>
      )}
    </Card>
  )
}

/** A severity band: one verdict, the cards currently holding it. */
function Band({ title, dotCls, children }: { title: string; dotCls: string; children: ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-text-2">
        <span className={cn('h-2 w-2 rounded-full', dotCls)} />
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  )
}

/* ---------- the page ---------- */

export default function GuardianPage() {
  const [gas, setGas] = useState<Row | null>(null)
  const [gasErr, setGasErr] = useState<string>('')
  const [ids, setIds] = useState<Row | null>(null)
  const [idsRunning, setIdsRunning] = useState(false)
  const [relay, setRelay] = useState<Row | null>(null)
  const [relayErr, setRelayErr] = useState<string>('')
  const [selftest, setSelftest] = useState<Row | null>(null)
  const [selftestRunning, setSelftestRunning] = useState(false)
  const [logs, setLogs] = useState<Row[]>([])
  const [logsErr, setLogsErr] = useState<string>('')
  const [mesh, setMesh] = useState<Row | null>(null)
  const [meshErr, setMeshErr] = useState<string>('')
  const [cortexHealth, setCortexHealth] = useState<Row | null>(null)
  const [cortexHealthErr, setCortexHealthErr] = useState<string>('')
  const [cortexFleet, setCortexFleet] = useState<Row[] | null>(null)
  const [cortexFleetErr, setCortexFleetErr] = useState<string>('')
  const [snapSlices, setSnapSlices] = useState<{ total: number; stale: string[]; missing: string[] } | null>(null)
  /** the snapshot index read failed — apart from "not read yet", which is also null */
  const [snapFailed, setSnapFailed] = useState(false)
  const [snapDetail, setSnapDetail] = useState<{ name: string; age: string; error: boolean }[]>([])
  const [recentActions, setRecentActions] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  // The newest engine build this screen has seen the relay serve this session — "the newest the screen knows".
  const [newestBuild, setNewestBuild] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setSnapFailed(false)
    // 1. RELAY — the builder's own /health, over HTTP (no GAS spent).
    try {
      const r = await fetch('/health', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const body = (await r.json()) as Row
      setRelay(body)
      const build = body?.engine_build ? String(body.engine_build) : ''
      if (build) setNewestBuild((prev) => (build > prev ? build : prev))
      setRelayErr('')
    } catch (e) {
      setRelay(null)
      setRelayErr(e instanceof Error ? e.message : String(e))
    }
    // 2.
    try {
      const [gasRes, recentRes] = await Promise.all([
        gasAction<Row>('guardianStatus', {}),
        gasAction<{ events?: Row[] }>('logsList', { limit: 15 }),
      ])
      setGas(gasRes)
      setGasErr('')
      setLogs((gasRes?.recentFailures as Row[]) ?? [])
      setRecentActions(recentRes.events ?? [])
      setLogsErr('')
    } catch (e) {
      setGas(null)
      setLogs([])
      setRecentActions([])
      const msg = e instanceof Error ? e.message : String(e)
      setGasErr(msg)
      setLogsErr(msg)
    }
    // 3.
    try {
      const r = await fetch('/cortex/mesh/live', { cache: 'no-store', headers: authHeaders() })
      if (r.status === 410) throw new Error(CORTEX_RETIRED)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setMesh(await r.json())
      setMeshErr('')
    } catch (e) {
      setMesh(null)
      setMeshErr(e instanceof Error ? e.message : String(e))
    }
    // 4.
    try {
      const r = await fetch('/cortex/health', { cache: 'no-store', headers: authHeaders() })
      const body = (await r.json().catch(() => null)) as Row | null
      if (r.status === 410) {
        setCortexHealth(null)
        setCortexHealthErr(CORTEX_RETIRED)
      } else if (!r.ok) {
        const msg = String(body?.message ?? `HTTP ${r.status}`)
        setCortexHealth(null)
        setCortexHealthErr(/did not answer/i.test(msg) ? `unreachable — ${msg}` : msg)
      } else {
        setCortexHealth(body)
        setCortexHealthErr('')
      }
    } catch (e) {
      setCortexHealth(null)
      setCortexHealthErr(`unreachable — ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      const r = await fetch('/cortex/fleet', { cache: 'no-store', headers: authHeaders() })
      if (r.status === 410) throw new Error(CORTEX_RETIRED)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const body = (await r.json()) as Row
      setCortexFleet(Array.isArray(body?.rows) ? (body.rows as Row[]) : [])
      setCortexFleetErr('')
    } catch (e) {
      setCortexFleet(null)
      setCortexFleetErr(e instanceof Error ? e.message : String(e))
    }
    // 5.
    let snap: Awaited<ReturnType<typeof readSnapshotIndex>> = null
    try { snap = await readSnapshotIndex() } catch { snap = null }
    if (snap) {
      setSnapSlices(snap.slices)
      setSnapDetail(snap.detail)
    } else {
      setSnapSlices(null)
      setSnapFailed(true)
      setSnapDetail([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // A BUTTON, like the self-test and for the same reason: about thirty Drive round trips on a backend that runs one…
  const runIds = useCallback(async () => {
    setIdsRunning(true)
    try {
      setIds(await gasAction<Row>('guardianIds', {}, { timeoutMs: 120_000 }))
    } catch (e) {
      setIds({ state: 'fail', detail: e instanceof Error ? e.message : String(e), failed: [] })
    } finally {
      setIdsRunning(false)
    }
  }, [])

  const runSelftest = useCallback(async () => {
    setSelftestRunning(true)
    try {
      // Python's own checks (resolverHealth): routes against doors, doors against declarations, apps against back-ends
      const res = await gasAction<Row>('resolverHealth', {}, { timeoutMs: 120_000 })
      const checks = res?.checks as Row | undefined
      setSelftest(checks && typeof checks.ran === 'number' ? checks
        : { failures: -1, error: 'the health check came back without its checks' })
    } catch (e) {
      setSelftest({ failures: -1, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setSelftestRunning(false)
    }
  }, [])

  // derived status — RELAY sweeps: { hiring|staff|hotline|talent: consecutive failure count } — plain numbers…
  const sweepRows = Object.entries((relay?.sweeps ?? {}) as Row)
    .map(([name, v]) => ({ name, fails: num(v) ?? 0 }))
  const sweepBad = sweepRows.filter((s) => s.fails > 0)
  const hopeless = ((relay?.hopeless_adapters as any[]) ?? []).map(String)
  const servingBuild = relay?.engine_build ? String(relay.engine_build) : ''
  // bundle budget: { bundle: { budget_spent: { count, age_s } } } — how often the cycle's deadline won, and how…
  const budgetSpent = (relay?.bundle?.budget_spent ?? null) as Row | null
  const budgetCount = num(budgetSpent?.count) ?? 0
  const budgetAgeS = num(budgetSpent?.age_s)
  const budgetOver = budgetCount > 0
  // THE NEWEST BUILD THE SCREEN KNOWS.
  const knownBuilds = [gas?.build, gas?.code, gas?.engine_build, gas?.engines?.build]
    .filter(Boolean).map(String)
  const newestKnownBuild = [...knownBuilds, newestBuild].filter(Boolean).sort().pop() ?? ''
  const buildMismatch = Boolean(servingBuild && newestKnownBuild && servingBuild !== newestKnownBuild)
  const relayWhy = relayErr ? `unreachable — ${relayErr}`
    : (relay?.failing?.length ?? 0) > 0 ? `failing feeds: ${((relay?.failing ?? []) as string[]).join(', ')}`
    : sweepBad.length > 0 ? `sweep ${sweepBad[0].name}: ${sweepBad[0].fails} consecutive failure(s)`
    : hopeless.length > 0 ? `hopeless adapters: ${hopeless.join(', ')}`
    : budgetOver ? `the bundle budget has been spent ${budgetCount} time(s)`
    : buildMismatch ? `serving build ${servingBuild} — the newest known is ${newestKnownBuild}`
    : undefined
  const relayState: CheckState = relayErr ? 'fail'
    : !relay ? 'loading'
    : (relay.failing?.length ?? 0) > 0 ? 'warn'
    : sweepBad.length > 0 ? 'warn'
    : hopeless.length > 0 ? 'warn'
    : budgetOver ? 'warn'
    : buildMismatch ? 'warn'
    : 'ok'

  // derived status — SHEET MIRROR (the platform's own sheets⇄Postgres keeper, server/hub_sheet_sync.py) — the…
  const ss = (relay?.sheet_sync ?? null) as Row | null
  const ssPassAge = num(ss?.last_pass_age_s)
  const ssSessionAge = num(ss?.session_mirror_age_s)
  const ssErrorBooks = ((ss?.error_books ?? []) as Row[])
  const ssState: CheckState = relayErr ? 'fail'
    : !relay ? 'loading'
    : !ss ? 'unknown'
    : (ssPassAge === null || ssPassAge > 900) ? 'fail'
    // QUIET HOURS ARE NOT A DISEASE: overnight nobody signs in, hub_sessions does not change, and the photo…
    : (ssSessionAge !== null && ssSessionAge > 43200) ? 'fail'
    : (ssSessionAge !== null && ssSessionAge > 7200) ? 'warn'
    : ((num(ss?.books_error) ?? 0) > 0 || (num(ss?.last_pass_errors) ?? 0) > 0) ? 'warn'
    : 'ok'
  const ssWhy = relayErr ? `the relay is unreachable — ${relayErr}`
    : relay && !ss ? 'the keeper could not read its own vitals (Postgres unreachable?)'
    : ssPassAge === null ? 'the sync lane has never completed a pass'
    : ssPassAge > 900 ? `no sync pass for ${Math.round(ssPassAge / 60)} min — the lane may be stopped`
    : (ssSessionAge !== null && ssSessionAge > 43200)
      ? `the session mirror is ${(ssSessionAge / 3600).toFixed(1)}h old — no quiet night explains that`
    : (ssSessionAge !== null && ssSessionAge > 7200)
      ? `session mirror past its 2h ceiling (${(ssSessionAge / 3600).toFixed(1)}h) — normal overnight; the first sign-in renews it`
    : (num(ss?.books_error) ?? 0) > 0 ? `${num(ss?.books_error)} book(s) failing to sync`
    : (num(ss?.last_pass_errors) ?? 0) > 0 ? `${num(ss?.last_pass_errors)} error(s) on the last pass`
    : undefined

  // derived status — FORM DIGESTER (server/form_digest.py; the child process that turns every uploaded form file…
  const fd = (relay?.form_digest ?? null) as Row | null
  const fdCounts = (fd?.counts ?? {}) as Record<string, unknown>
  const fdOldest = num(fd?.oldest_pending_age_s)
  const fdErrItems = ((fd?.error_items ?? []) as Row[])
  const fdState: CheckState = relayErr ? 'fail'
    : !relay ? 'loading'
    : !fd ? 'unknown'
    : (fdOldest !== null && fdOldest > 1800) ? 'fail'
    : ((num(fdCounts.error) ?? 0) > 0) ? 'warn'
    : 'ok'
  const fdWhy = relayErr ? `the relay is unreachable — ${relayErr}`
    : relay && !fd ? 'the digester ledger is not readable yet (mirror still catching up?)'
    : (fdOldest !== null && fdOldest > 1800)
      ? `a file has waited ${Math.round(fdOldest / 60)} min undigested — is the engine's clock ringing?`
    : (num(fdCounts.error) ?? 0) > 0 ? `${num(fdCounts.error)} file(s) in error`
    : undefined

  // derived status — CORTEX A 200 IS NOT A PULSE.
  const meshState: CheckState = meshErr === CORTEX_RETIRED ? 'retired' : meshErr ? 'warn'
    : !mesh ? 'loading'
    : mesh.ok === false ? 'warn'
    : (Number(mesh.fibers_live ?? 0) === 0 && Number(mesh.fibers_total ?? 0) > 0) ? 'warn'
    : 'ok'
  const meshWhy = meshErr === CORTEX_RETIRED ? CORTEX_RETIRED : meshErr ? `not reachable from here — ${meshErr}`
    : mesh?.ok === false ? 'the mesh reports itself degraded'
    : mesh && Number(mesh.fibers_live ?? 0) === 0 && Number(mesh.fibers_total ?? 0) > 0
      ? `0 fibers live of ${String(mesh.fibers_total)}`
    : undefined

  // derived status — NEURAL CORTEX Same law as the mesh: the endpoint answering is not the cortex being well.
  const cortexState: CheckState = cortexHealthErr === CORTEX_RETIRED ? 'retired'
    : cortexHealthErr
    ? (/^unreachable/i.test(cortexHealthErr) ? 'fail' : 'warn')
    : !cortexHealth ? 'unknown'
    : String(cortexHealth.status ?? '') === 'healthy' ? 'ok'
    : String(cortexHealth.status ?? '') === 'degraded' ? 'warn'
    : 'unknown'
  const cortexWhy = cortexHealthErr
    || (cortexHealth && String(cortexHealth.status ?? '') === 'degraded'
      ? 'the cortex reports itself degraded' : undefined)
  const cortexProviders = num(cortexHealth?.providers, cortexHealth?.providers?.configured,
    cortexHealth?.providers?.count, cortexHealth?.providers?.total)
  const cortexKeys = num(cortexHealth?.total_keys)
  const cortexSheetsLive = num(cortexHealth?.sheets?.live, cortexHealth?.sheets_live)
  const cortexSheetsDisabled = num(cortexHealth?.sheets?.disabled, cortexHealth?.sheets_disabled)

  /* derived status — THE PLATFORM'S OWN VERDICT */
  const gasCheck = (id: string): Row | null =>
    ((gas?.checks as Row[]) ?? []).find((c) => c.id === id) ?? null
  const sheetsCheck = gasCheck('sheets')
  const propsCheck = gasCheck('properties')
  const callLaneCheck = gasCheck('callLane')
  const relayCheck = gasCheck('relay')
  const gasState: CheckState = gasErr ? 'fail'
    : !gas ? 'loading'
    : (gas.overall as CheckState) ?? 'unknown'
  const idsState: CheckState = idsRunning ? 'loading'
    : !ids ? 'unknown'
    : (ids.state as CheckState) ?? 'unknown'
  // THE HEADLINE'S REASON MUST COVER EVERY CHECK THE HEADLINE COUNTS.
  const gasChecks = ((gas?.checks as Row[]) ?? [])
  const badGasCheck = gasChecks.find((c) => c && c.state === 'fail')
    ?? gasChecks.find((c) => c && c.state === 'warn')
    ?? gasChecks.find((c) => c && c.state === 'unknown')
    ?? null
  const gasWhy = gasErr ? `the backend did not answer — ${gasErr}`
    : badGasCheck ? `${String(badGasCheck.label ?? badGasCheck.id)} — ${String(badGasCheck.detail ?? 'not ok')}`
    : idsState === 'fail' ? String(ids?.detail ?? 'an id did not open')
    : undefined

  // derived status — ENGINES (guardianStatus' engines block) The real shape (Guardian.gs guardianEngines_): {…
  const enginesBlock = (gas?.engines ?? null) as Row | null
  const engineView = useMemo(() => {
    if (!enginesBlock) return [] as {
      name: string; cursor: number | null; judgedAt: string; state: CheckState
    }[]
    return Object.entries(enginesBlock)
      .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
      .map(([name, v]) => {
        const e = v as Row
        const mark = (e.mark ?? null) as Row | null
        return {
          name,
          cursor: num(e.cursor),
          judgedAt: mark?.at ? String(mark.at) : '',
          state: ((e.state as CheckState) ?? 'unknown'),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [enginesBlock])
  const stuckEngines = engineView.filter((e) => e.state === 'warn')
  const muteEngines = engineView.filter((e) => e.state === 'unknown')
  const callerless: string[] = useMemo(() => {
    const raw = enginesBlock?.callerless as any[]
    if (!Array.isArray(raw)) return []
    // runtimeSweepNow above all — it is the one whose absence costs the most
    return raw.map((x) => String(x?.name ?? x)).sort((a, b) =>
      a === 'runtimeSweepNow' ? -1 : b === 'runtimeSweepNow' ? 1 : a.localeCompare(b))
  }, [enginesBlock])
  const enginesState: CheckState = gasErr ? 'unknown'
    : !gas ? 'loading'
    : !enginesBlock ? 'unknown'
    : stuckEngines.length > 0 ? 'warn'
    : callerless.length > 0 ? 'warn'
    : muteEngines.length > 0 ? 'unknown'
    : 'ok'
  const enginesWhy = !gasErr && gas && !enginesBlock
    ? 'this backend build does not report its engines'
    : stuckEngines.length > 0
      ? `${stuckEngines.map((e) => e.name).join(', ')} — cursor quiet past the 30-minute stall line`
    : callerless.length > 0 ? `${callerless.length} sweep(s) not on the clock: ${callerless.join(', ')}`
    : muteEngines.length > 0
      ? `${muteEngines.map((e) => e.name).join(', ')} never said when it last judged`
    : undefined

  // derived status — HOST (the watchdog's verdict, carried by /health.host) The real shape (the host agent's…
  const host = (relay?.host ?? null) as Row | null
  const hostServices = useMemo(() => {
    const raw = (host?.services ?? []) as Row[]
    if (!Array.isArray(raw)) return []
    const stateOf = (s: Row) => `${String(s.state ?? s.status ?? '')} ${String(s.health ?? '')}`
    const rank = (s: Row) => (/down|exited|dead|stopped/i.test(stateOf(s)) ? 0
      : /unhealthy/i.test(stateOf(s)) ? 1 : 2)
    // down first, then unhealthy — the order a person needs them in
    return [...raw].sort((a, b) => rank(a) - rank(b))
  }, [host])
  const hostDown = hostServices.filter((s) =>
    /down|exited|dead|stopped/i.test(`${String(s.state ?? s.status ?? '')} ${String(s.health ?? '')}`))
  const hostUnhealthy = hostServices.filter((s) =>
    /unhealthy/i.test(`${String(s.state ?? s.status ?? '')} ${String(s.health ?? '')}`))
  const hostAlerts = (host?.alerts ?? {}) as Row
  // flap and crashloop are NAME LISTS; disk and fatal are booleans
  const alertOn = (v: any): boolean => (Array.isArray(v) ? v.length > 0 : Boolean(v))
  const alertNames = (v: any): string[] => (Array.isArray(v) ? v.map(String) : [])
  const hostAgeS = num(relay?.host_age_s)
  const tlsDays = host?.tls && typeof host.tls === 'object'
    ? Object.values(host.tls as Row).reduce<number | null>(
        (best, v) => { const n = num(v); return n === null ? best : best === null ? n : Math.min(best, n) },
        null)
    : num(host?.tls_days)
  const diskPct = num(host?.disk?.pct, host?.disk_pct)
  const hostState: CheckState = relayErr ? 'unknown'
    : !relay ? 'loading'
    : !host ? 'unknown'
    : alertOn(hostAlerts.fatal) || hostDown.length > 0 ? 'fail'
    : alertOn(hostAlerts.flap) || alertOn(hostAlerts.crashloop) || alertOn(hostAlerts.disk)
      || hostUnhealthy.length > 0 || (tlsDays !== null && tlsDays < 14) ? 'warn'
    : 'ok'
  const hostWhy = !relayErr && relay && !host ? undefined   // the card body says it in full
    : alertOn(hostAlerts.fatal) ? 'the watchdog logged a fatal condition'
    : hostDown.length > 0 ? `${hostDown.map((s) => String(s.name ?? '?')).join(', ')} — down`
    : alertOn(hostAlerts.crashloop) ? `${alertNames(hostAlerts.crashloop).join(', ') || 'a service'} — crash-looping`
    : alertOn(hostAlerts.flap) ? `${alertNames(hostAlerts.flap).join(', ') || 'a service'} — flapping`
    : alertOn(hostAlerts.disk) || (diskPct !== null && diskPct >= 90) ? `disk at ${diskPct ?? '?'}%`
    : hostUnhealthy.length > 0 ? `${hostUnhealthy.map((s) => String(s.name ?? '?')).join(', ')} — unhealthy`
    : tlsDays !== null && tlsDays < 14 ? `TLS expires in ${tlsDays} day(s)`
    : undefined

  const snapState: CheckState = snapshotCheckState(snapSlices)
  const selftestState: CheckState = selftestRunning ? 'loading'
    : !selftest ? 'unknown'
    : selftest.failures === -1 ? 'fail'
    : (selftest.failures ?? 0) > 0 ? 'fail' : 'ok'
  const selftestWhy = selftest?.failures === -1 ? `could not run — ${String(selftest.error ?? '')}`
    : (selftest?.failures ?? 0) > 0 ? `${String(selftest?.failures ?? 0)} of its own checks failed`
    : undefined

  // THE SELF-TEST IS A BUTTON, so it may not drag the shield grey.
  const overall: CheckState = useMemo(
    () => guardianOverall(
      [gasState, relayState, enginesState, hostState, meshState, cortexState, snapState],
      [selftestState, idsState],
    ),
    [gasState, relayState, enginesState, hostState, meshState, cortexState, snapState, selftestState, idsState],
  )

  const OverallIcon = overall === 'ok' ? ShieldCheck : overall === 'fail' ? ShieldOff : HeartPulse
  const overallCls = overall === 'ok' ? 'text-emerald-500' : overall === 'fail' ? 'text-rose-500' : overall === 'warn' ? 'text-amber-500' : 'text-text-3'

  /* the cards, then the bands they currently belong to */

  const sheetsCard = (
    <StatusCard title="Sheets & properties" state={gasState} why={gasWhy}
      checks="guardianStatus — core sheets, properties, every id (on demand)">
      {gasErr ? (
        <p className="text-[12px] text-rose-500">The backend did not answer — {gasErr}</p>
      ) : gas ? (
        <div className="space-y-2 text-[12px]">
          <div className="flex items-start gap-2">
            <Table2 size={13} className="mt-0.5 shrink-0 text-text-3" />
            <div className="min-w-0">
              <p className="font-semibold text-text-1">Core sheets</p>
              <p className={cn('text-[11px]',
                sheetsCheck?.state === 'ok' ? 'text-text-3'
                  : sheetsCheck?.state === 'fail' ? 'text-rose-500' : 'text-amber-600')}>
                {String(sheetsCheck?.detail || (sheetsCheck ? 'answering' : 'not reported'))}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <KeyRound size={13} className="mt-0.5 shrink-0 text-text-3" />
            <div className="min-w-0">
              <p className="font-semibold text-text-1">Properties</p>
              <p className={cn('text-[11px]',
                propsCheck?.state === 'ok' ? 'text-text-3'
                  : propsCheck?.state === 'fail' ? 'text-rose-500' : 'text-amber-600')}>
                {String(propsCheck?.detail || (propsCheck ? 'all resolved' : 'not reported'))}
              </p>
              {((propsCheck?.meta?.empty as string[]) ?? []).length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {((propsCheck!.meta!.empty as string[])).map((k) => (
                    <li key={k} className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-500">
                      {k} — set it in the platform&apos;s properties
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {/* THE CALL HAND-OVER. The backend folds this check into `overall`,
              so without a line here the platform card could go amber for a
              lane no screen named. Its `unknown` is a QUESTION, not an alarm:
              a hand-over is logged only when the relay has something to send,
              so silence reads the same from a healthy idle lane and a dead
              one, and `detail` says which number would settle it. */}
          <div className="flex items-start gap-2">
            <PhoneCall size={13} className="mt-0.5 shrink-0 text-text-3" />
            <div className="min-w-0">
              <p className="font-semibold text-text-1">Call hand-over</p>
              <p className={cn('text-[11px]',
                callLaneCheck?.state === 'ok' ? 'text-text-3'
                  : callLaneCheck?.state === 'fail' ? 'text-rose-500'
                    : callLaneCheck?.state === 'warn' ? 'text-amber-600' : 'text-text-3')}>
                {String(callLaneCheck?.detail
                  || (callLaneCheck ? 'reported without a reason' : 'not reported'))}
              </p>
            </div>
          </div>
          {/* THE RELAY, RETIRED: down on purpose, it reads Retired; it answering again is the warning. */}
          <div className="flex items-start gap-2" data-guardian-relay={String(relayCheck?.state ?? '')}>
            <Server size={13} className="mt-0.5 shrink-0 text-text-3" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-text-1">Relay</p>
                {relayCheck && <Chip state={(relayCheck.state as CheckState) ?? 'unknown'} />}
              </div>
              <p className={cn('text-[11px]', relayCheck?.state === 'warn' ? 'text-amber-600' : 'text-text-3')}>
                {String(relayCheck?.detail || 'not reported')}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 border-t border-border pt-2">
            <Activity size={13} className="mt-0.5 shrink-0 text-text-3" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-text-1">Every id opens</p>
                <Chip state={idsState} />
              </div>
              <p className={cn('text-[11px]',
                idsState === 'ok' ? 'text-text-3'
                  : idsState === 'fail' ? 'text-rose-500' : 'text-text-3')}>
                {ids ? String(ids.detail ?? '') : 'Press “Check every id” — it opens each spreadsheet and folder.'}
              </p>
              {((ids?.failed as Row[]) ?? []).length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {((ids!.failed as Row[])).map((f, i) => (
                    <li key={i} className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-500">
                      <span className="font-semibold">{String(f.key)}</span> — {String(f.why)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : <SmallLoader />}
    </StatusCard>
  )

  const mirrorCard = (
    <StatusCard title="Sheet mirror" state={ssState} why={ssWhy}
      checks="/health sheet_sync — keeper pass age, session mirror age, per-book errors, vouch lane">
      {ss ? (
        <dl className="space-y-1.5 text-[12px] text-text-2">
          <div className="flex justify-between"><dt>Last sync pass</dt>
            <dd className={cn('font-semibold', ssPassAge !== null && ssPassAge > 900 ? 'text-rose-500' : '')}>
              {ss.last_pass_at ? ago(String(ss.last_pass_at)) : 'never'}
            </dd></div>
          <div className="flex justify-between"><dt>Books mirrored (2h)</dt>
            <dd className="font-semibold">{ss.books_fresh_2h ?? '—'}</dd></div>
          <div className="flex justify-between"><dt>Session mirror age</dt>
            <dd className={cn('font-semibold',
              ssSessionAge !== null && ssSessionAge > 7200 ? 'text-rose-500' : '')}>
              {ssSessionAge === null ? 'never'
                : ssSessionAge < 120 ? `${ssSessionAge}s`
                : `${Math.round(ssSessionAge / 60)}m`}
            </dd></div>
          <div className="flex justify-between"><dt>Vouched sessions (2h)</dt>
            <dd className="font-semibold">{ss.vouch_live_2h ?? '—'}</dd></div>
          {ssErrorBooks.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {ssErrorBooks.slice(0, 3).map((b, i) => (
                <li key={i} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600">
                  <span className="font-semibold">{String(b.name ?? '?')}</span> — {String(b.error ?? '')}
                </li>
              ))}
            </ul>
          )}
        </dl>
      ) : relayErr ? (
        <p className="text-[12px] text-rose-500">Unreachable — {relayErr}</p>
      ) : relay ? (
        <p className="text-[12px] text-amber-600">The keeper reported no vitals.</p>
      ) : <SmallLoader />}
    </StatusCard>
  )

  const digestCard = (
    <StatusCard title="File digester" state={fdState} why={fdWhy}
      checks="/health form_digest — the ledger's own truth: pending age, states, per-file errors (keeper: asa-hub-worker)">
      {fd ? (
        <dl className="space-y-1.5 text-[12px] text-text-2">
          <div className="flex justify-between"><dt>Waiting</dt>
            <dd className={cn('font-semibold', fdOldest !== null && fdOldest > 1800 ? 'text-rose-500' : '')}>
              {num(fdCounts.pending) ?? 0}
              {fdOldest !== null ? ` (oldest ${Math.round(fdOldest / 60)}m)` : ''}
            </dd></div>
          <div className="flex justify-between"><dt>Digested</dt>
            <dd className="font-semibold">{num(fdCounts.done) ?? 0}</dd></div>
          <div className="flex justify-between"><dt>Empty / unsupported</dt>
            <dd className="font-semibold">{(num(fdCounts.empty) ?? 0) + (num(fdCounts.unsupported) ?? 0)}</dd></div>
          <div className="flex justify-between"><dt>In error</dt>
            <dd className={cn('font-semibold', (num(fdCounts.error) ?? 0) > 0 ? 'text-amber-600' : '')}>
              {num(fdCounts.error) ?? 0}
            </dd></div>
          {fdErrItems.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {fdErrItems.slice(0, 3).map((b, i) => (
                <li key={i} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600">
                  <span className="font-semibold">{String(b.file_name ?? '')}</span> {String(b.error ?? '')}
                </li>
              ))}
            </ul>
          )}
        </dl>
      ) : relayErr ? (
        <p className="text-[12px] text-rose-500">Unreachable — {relayErr}</p>
      ) : relay ? (
        <p className="text-[12px] text-amber-600">The digester reported no vitals.</p>
      ) : <SmallLoader />}
    </StatusCard>
  )

  const relayCard = (
    <StatusCard title="Snapshot (asa-hub-app)" state={relayState} why={relayWhy}
      checks="/health — slices, bundle lane & budget, write ledger, sweeps, adapters, serving build">
      {relayErr ? (
        <p className="text-[12px] text-rose-500">Unreachable — {relayErr}</p>
      ) : relay ? (
        <dl className="space-y-1.5 text-[12px] text-text-2">
          <div className="flex justify-between"><dt>Slices built</dt><dd className="font-semibold">{relay.slices ?? '—'}</dd></div>
          <div className="flex justify-between"><dt>Last build</dt><dd className="font-semibold">{ago(relay.built_at)}</dd></div>
          <div className="flex justify-between">
            <dt>Serving build</dt>
            <dd className={cn('font-semibold', buildMismatch ? 'text-amber-600' : '')}>
              {servingBuild || '—'}
              {buildMismatch && ` — newest known is ${newestKnownBuild}`}
            </dd>
          </div>
          <div className="flex justify-between"><dt>Bundle lane</dt><dd className="font-semibold">{String(relay.bundle_lane ?? '—')}</dd></div>
          <div className="flex justify-between">
            <dt>Bundle budget</dt>
            <dd className={cn('font-semibold', budgetOver ? 'text-amber-600' : '')}>
              {budgetOver
                ? `spent ${budgetCount} time(s)${budgetAgeS !== null ? ` — last ${Math.round(budgetAgeS)}s ago` : ''}`
                : 'never spent'}
            </dd>
          </div>
          {sweepRows.length > 0 && (
            <div className="border-t border-border pt-1.5">
              <p className="mb-1 text-[11px] font-semibold text-text-3">Sweeps</p>
              {sweepRows.map((s) => (
                <div key={s.name} className="flex justify-between">
                  <dt>{s.name}</dt>
                  <dd className={cn('font-semibold', s.fails > 0 ? 'text-amber-600' : '')}>
                    {s.fails === 0 ? 'no failures' : `${s.fails} consecutive failure(s)`}
                  </dd>
                </div>
              ))}
            </div>
          )}
          {hopeless.length > 0 && (
            <div className="rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-600">
              Hopeless adapters: {hopeless.join(', ')}
            </div>
          )}
          {(relay.failing?.length ?? 0) > 0 && (
            <div className="mt-1 rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-600">
              Failing: {(relay.failing as string[]).join(', ')}
            </div>
          )}
        </dl>
      ) : <SmallLoader />}
    </StatusCard>
  )

  const enginesCard = (
    <StatusCard title="Engines" state={enginesState} why={enginesWhy}
      checks="guardianStatus.engines — cursor position, ENGINE_MARK idleness stamp, callerless sweeps">
      {gasErr ? (
        <p className="text-[12px] text-text-3">Unknown — the backend did not answer, so the engines cannot be asked.</p>
      ) : !gas ? <SmallLoader />
      : !enginesBlock ? (
        <p className="text-[12px] text-text-3">Unknown — this backend build does not report its engines.</p>
      ) : (
        <div className="space-y-1.5 text-[12px] text-text-2">
          {engineView.map((e) => (
            <div key={e.name} className="flex items-start justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Cpu size={12} className="shrink-0 text-text-3" /> {e.name}
                <span className="text-[11px] text-text-3">cursor {e.cursor ?? '—'}</span>
              </span>
              <span className={cn('text-right font-semibold',
                e.state === 'warn' ? 'text-amber-600'
                  : e.state === 'unknown' ? 'text-text-3' : '')}>
                {e.judgedAt ? `judged ${ago(e.judgedAt)}` : 'never said'}
              </span>
            </div>
          ))}
          {engineView.length === 0 && (
            <p className="text-text-3">No engines reported.</p>
          )}
          {callerless.map((name) => (
            <div key={name} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600">
              {name} — not on the clock
            </div>
          ))}
        </div>
      )}
    </StatusCard>
  )

  const hostCard = (
    <StatusCard title="Host watchdog" state={hostState} why={hostWhy}
      checks="/health.host — the screen's outside view: it answers even when the cortex and the engines are down">
      {relayErr ? (
        <p className="text-[12px] text-text-3">Unknown — the relay that carries the watchdog's verdict is unreachable.</p>
      ) : !relay ? <SmallLoader />
      : !host ? (
        <div className="space-y-1">
          <p className="text-[12px] text-text-3">unknown — the host watchdog has not reported</p>
          {hostAgeS !== null && (
            <p className="text-[11px] text-text-3">
              the last verdict reached the relay {Math.round(hostAgeS)}s ago and is too old to trust
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-[12px] text-text-2">
          <p className="text-[11px] text-text-3">
            Verdict {hostAgeS !== null ? `${Math.round(hostAgeS)}s old` : `from ${ago(String(host.generated_iso ?? host.at ?? ''))}`}
          </p>
          {hostServices.length > 0 && (
            <div className="space-y-1">
              {hostServices.map((s, i) => {
                const st = String(s.state ?? s.status ?? '—')
                const down = /down|exited|dead|stopped/i.test(`${st} ${String(s.health ?? '')}`)
                const unhealthy = !down && /unhealthy/i.test(`${st} ${String(s.health ?? '')}`)
                return (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Server size={12} className="shrink-0 text-text-3" />
                      <span className="truncate font-medium text-text-1">{String(s.name ?? '?')}</span>
                      {s.tier && <span className="text-[11px] text-text-3">{String(s.tier)}</span>}
                    </span>
                    <span className={cn('shrink-0 font-semibold',
                      down ? 'text-rose-500' : unhealthy ? 'text-amber-600' : 'text-text-3')}>
                      {st}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <dl className="space-y-1.5">
            {diskPct !== null && (
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1.5"><HardDrive size={12} className="text-text-3" /> Disk</dt>
                <dd className={cn('font-semibold', diskPct >= 90 ? 'text-amber-600' : '')}>{diskPct}%</dd>
              </div>
            )}
            {tlsDays !== null && (
              <div className="flex items-center justify-between gap-2">
                <dt>TLS (soonest)</dt>
                <dd className={cn('font-semibold', tlsDays < 14 ? 'text-amber-600' : '')}>{tlsDays} day(s)</dd>
              </div>
            )}
          </dl>
          {host.probes && typeof host.probes === 'object' && (
            <div className="border-t border-border pt-1.5">
              <p className="mb-1 text-[11px] font-semibold text-text-3">Probes</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {(Array.isArray(host.probes)
                  ? (host.probes as Row[]).map((p) => [String(p?.name ?? '?'), p?.state ?? p?.status] as const)
                  : Object.entries(host.probes as Row)
                ).map(([name, st]) => {
                  // the watchdog answers booleans; words arrive as words
                  const s = typeof st === 'boolean' ? (st ? 'up' : 'down') : String(st ?? '—')
                  return (
                    <div key={name} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-text-2">{name}</span>
                      <span className={cn('font-semibold',
                        /^(ok|up|pass|healthy)$/i.test(s) ? 'text-emerald-600'
                          : /^(fail|down|dead)$/i.test(s) ? 'text-rose-500' : 'text-amber-600')}>
                        {s}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1 border-t border-border pt-1.5">
            {(['flap', 'crashloop', 'disk', 'fatal'] as const).map((k) => {
              const on = alertOn(hostAlerts[k])
              const names = alertNames(hostAlerts[k])
              return (
                <span key={k} className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold',
                  on && k === 'fatal' ? 'bg-rose-500/10 text-rose-500'
                    : on ? 'bg-amber-500/10 text-amber-600'
                    : 'bg-surface-2 text-text-3')}>
                  {on ? (names.length > 0 ? `${k}: ${names.join(', ')}` : k) : `no ${k}`}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </StatusCard>
  )

  const selftestCard = (
    <StatusCard title="Platform self-test" state={selftestState} why={selftestWhy}
      checks="resolverHealth — Python's own checks of its routes, doors and back-ends, run on demand">
      {selftest ? (
        selftest.failures === -1 ? (
          <p className="text-[12px] text-rose-500">Could not run — {String(selftest.error ?? '')}</p>
        ) : (
          <div>
            <p className="text-[12px] text-text-2">
              <span className="font-semibold">{selftest.ran ?? '—'}</span> checks,{' '}
              <span className={cn('font-semibold', (selftest.failures ?? 0) > 0 ? 'text-rose-500' : 'text-emerald-600')}>
                {selftest.failures ?? 0} failures
              </span>
            </p>
            {(selftest.failed?.length ?? 0) > 0 && (
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[11px] text-rose-500">
                {(selftest.failed as Row[]).map((f, i) => (
                  <li key={i} className="rounded bg-rose-500/10 px-2 py-1">{String(f.check ?? f)}</li>
                ))}
              </ul>
            )}
          </div>
        )
      ) : (
        <p className="text-[12px] text-text-3">
          {selftestRunning ? 'Running the checks…' : 'Press “Run self-test” to run the platform’s own checks.'}
        </p>
      )}
    </StatusCard>
  )

  const meshCard = (
    <StatusCard title="Cortex mesh" state={meshState} why={meshWhy}
      checks="/cortex/mesh/live — leader, fibers, synapses (authenticated)">
      {meshErr === CORTEX_RETIRED ? (
        <p className="text-[12px] text-text-3">Retired with the old platform (the old platform is shut down).</p>
      ) : meshErr ? (
        <p className="text-[12px] text-amber-600">Not reachable from here — {meshErr}</p>
      ) : mesh ? (
        <dl className="space-y-1.5 text-[12px] text-text-2">
          <div className="flex justify-between"><dt>Status</dt><dd className="font-semibold">{mesh.ok === true ? 'live' : mesh.ok === false ? 'degraded' : '—'}</dd></div>
          <div className="flex justify-between"><dt>Leader</dt><dd className="font-semibold">{String(mesh.leader ?? '—')}</dd></div>
          <div className="flex justify-between"><dt>Fibers live</dt><dd className="font-semibold">{String(mesh.fibers_live ?? '—')}/{String(mesh.fibers_total ?? '—')}</dd></div>
          <div className="flex justify-between"><dt>Synapses</dt><dd className="font-semibold">{String(mesh.synapses_confirmed ?? '—')}</dd></div>
        </dl>
      ) : <SmallLoader />}
    </StatusCard>
  )

  const cortexCard = (
    <StatusCard title="Neural cortex" state={cortexState} why={cortexWhy}
      checks="/cortex/health + /cortex/fleet — liveness, providers & keys, sheets, ai_enrich, the watchdog's last sweeps (authenticated)">
      {cortexHealthErr === CORTEX_RETIRED ? (
        <p className="text-[12px] text-text-3">Retired with the old platform (the old platform is shut down).</p>
      ) : cortexHealthErr ? (
        <p className={cn('text-[12px]', cortexState === 'fail' ? 'text-rose-500' : 'text-amber-600')}>
          {cortexState === 'fail' ? 'Unreachable' : 'Not healthy'} — {cortexHealthErr}
        </p>
      ) : cortexHealth ? (
        <div className="space-y-2 text-[12px] text-text-2">
          <dl className="space-y-1.5">
            <div className="flex justify-between">
              <dt>Status</dt>
              <dd className={cn('font-semibold', cortexState === 'warn' ? 'text-amber-600' : '')}>
                {String(cortexHealth.status ?? '—')}{cortexHealth.version ? ` · v${String(cortexHealth.version)}` : ''}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Providers / keys</dt>
              <dd className="font-semibold">{cortexProviders ?? '—'} / {cortexKeys ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Sheets</dt>
              <dd className={cn('font-semibold', (cortexSheetsDisabled ?? 0) > 0 ? 'text-amber-600' : '')}>
                {cortexSheetsLive !== null
                  ? `${cortexSheetsLive} live${cortexSheetsDisabled !== null ? ` · ${cortexSheetsDisabled} disabled` : ''}`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>AI enrich</dt>
              <dd className="font-semibold">
                {cortexHealth.ai_enrich == null ? '—' : cortexHealth.ai_enrich ? 'on' : 'off'}
              </dd>
            </div>
          </dl>
          <div className="border-t border-border pt-1.5">
            <p className="mb-1 text-[11px] font-semibold text-text-3">The watchdog's last sweeps</p>
            {cortexFleetErr ? (
              <p className="text-[11px] text-text-3">The sweeps could not be read — {cortexFleetErr}</p>
            ) : cortexFleet === null ? <SmallLoader />
            : cortexFleet.length === 0 ? (
              <p className="text-[11px] text-text-3">No sweep has reported yet.</p>
            ) : (
              <ul className="space-y-1">
                {cortexFleet.map((row, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Cpu size={12} className="shrink-0 text-text-3" />
                      <span className="truncate">{sweepLine(row)}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-text-3">{epochAgo(row.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : <SmallLoader />}
    </StatusCard>
  )

  // SEVERITY BANDS.
  const cards: { id: string; state: CheckState; node: ReactNode }[] = [
    { id: 'sheets', state: gasState, node: sheetsCard },
    { id: 'mirror', state: ssState, node: mirrorCard },
    { id: 'digest', state: fdState, node: digestCard },
    { id: 'relay', state: relayState, node: relayCard },
    { id: 'engines', state: enginesState, node: enginesCard },
    { id: 'host', state: hostState, node: hostCard },
    { id: 'selftest', state: selftestState, node: selftestCard },
    { id: 'mesh', state: meshState, node: meshCard },
    { id: 'cortex', state: cortexState, node: cortexCard },
  ]
  const bandOf = (s: CheckState) => (s === 'fail' ? 'fail' : s === 'ok' ? 'ok' : 'watch')

  // THE HEADER'S FIGURES — the same banding as the cards below, counted once.
  const heroFigures: GuardianFigures | null = loading && !gas && !relay ? null : {
    checks: cards.length,
    failing: cards.filter((c) => bandOf(c.state) === 'fail').length,
    watching: cards.filter((c) => bandOf(c.state) === 'watch').length,
    green: cards.filter((c) => bandOf(c.state) === 'ok').length,
    waiting: cards.filter((c) => c.state === 'loading' || c.state === 'unknown').length,
    slices: snapSlices ? snapSlices.total : null,
    slicesRead: snapSlices ? 'ready' : snapFailed ? 'failed' : 'pending',
    stale: snapSlices?.stale.length ?? 0,
    errored: snapSlices?.missing.length ?? 0,
    build: servingBuild,
    buildRead: relay ? 'ready' : relayErr ? 'failed' : 'pending',
  }
  const bands: { key: 'fail' | 'watch' | 'ok'; title: string; dotCls: string }[] = [
    { key: 'fail', title: 'Needs action now', dotCls: 'bg-rose-500' },
    { key: 'watch', title: 'Watch', dotCls: 'bg-amber-500' },
    { key: 'ok', title: 'All green', dotCls: 'bg-emerald-500' },
  ]

  // FILLS THE WINDOW (check:width — the other agent left this one red on purpose while the page was in flight).
  return (
    <div className="w-full pb-16">
      {/* header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
        className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn('grid h-11 w-11 place-items-center rounded-xl bg-surface-2', overallCls)}>
            <OverallIcon size={22} />
          </span>
          <div>
            <h1 className="text-[17px] font-bold text-text-1">Guardian</h1>
            <p className="text-[12px] text-text-3">
              {loading ? 'Checking the platform…' : overall === 'ok' ? 'Everything is healthy' : overall === 'fail' ? 'Something needs attention' : overall === 'warn' ? 'A few things to watch' : 'Partial picture — some checks did not run'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Recheck
          </button>
          <button onClick={() => void runIds()} disabled={idsRunning}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
            <KeyRound size={13} className={idsRunning ? 'animate-pulse' : ''} />
            {idsRunning ? 'Opening every id…' : 'Check every id'}
          </button>
          <AiLaneTest />
          <button onClick={() => void runSelftest()} disabled={selftestRunning}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
            <HeartPulse size={13} className={selftestRunning ? 'animate-pulse' : ''} />
            {selftestRunning ? 'Running self-test…' : 'Run self-test'}
          </button>
        </div>
      </motion.div>

      {/* the platform's one dark surface, over the platform's own health */}
      <GuardianHero
        read={heroFigures ? { state: 'ready' } : { state: 'loading' }}
        figures={heroFigures}
        onRetry={() => void load()}
      />

      {/* status cards, banded by verdict */}
      {bands.map((band) => {
        const inBand = cards.filter((c) => bandOf(c.state) === band.key)
        if (inBand.length === 0) return null
        return (
          <Band key={band.key} title={band.title} dotCls={band.dotCls}>
            {inBand.map((c) => <div key={c.id}>{c.node}</div>)}
          </Band>
        )
      })}

      {/* ═══ more info below ═══ */}

      {/* Snapshot freshness — per-slice detail */}
      <div className="mt-6">
        <h2 className="mb-3 text-[13px] font-semibold text-text-2">Snapshot slices</h2>
        <Card>
          {snapSlices ? (
            <>
              <p className="mb-3 text-[12px] text-text-2">
                <span className="font-semibold">{snapSlices.total}</span> slices cached,{' '}
                <span className={cn('font-semibold', snapSlices.stale.length > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                  {snapSlices.stale.length} stale
                </span>
                {snapSlices.missing.length > 0 && <>, <span className="font-semibold text-rose-500">{snapSlices.missing.length} with errors</span></>}
              </p>
              {snapDetail.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-border text-left text-text-3">
                        <th className="pb-1.5 pr-3 font-semibold">Resource</th>
                        <th className="pb-1.5 pr-3 font-semibold">Age</th>
                        <th className="pb-1.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapDetail.map((s) => (
                        <tr key={s.name} className="border-b border-border/50">
                          <td className="py-1.5 pr-3 font-medium text-text-1">{s.name}</td>
                          <td className="py-1.5 pr-3 text-text-2">{s.age}</td>
                          <td className="py-1.5">
                            {s.error
                              ? <span className="text-rose-500">error</span>
                              : <span className="text-emerald-600">ok</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : snapFailed ? (
            <p className="text-[12px] text-amber-600">The snapshot index did not answer, so this check could not run — the slices are unknown, not zero.</p>
          ) : (
            <p className="text-[12px] text-text-3">Reading the snapshot index…</p>
          )}
        </Card>
      </div>

      {/* Relay + Recent activity, side by side */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Relay */}
        <div>
          <h2 className="mb-3 text-[13px] font-semibold text-text-2">Relay</h2>
          <Card>
            {relay ? (
              <dl className="space-y-1.5 text-[12px] text-text-2">
                <div className="flex justify-between"><dt>Identity</dt><dd className="font-semibold">{String(relay.identity ?? '—')}</dd></div>
                <div className="flex justify-between"><dt>Resolver</dt><dd className="font-semibold">{relay.resolver?.declared ?? '—'} declared</dd></div>
              </dl>
            ) : relayErr ? (
              <p className="text-[12px] text-rose-500">Relay unreachable</p>
            ) : <SmallLoader />}
          </Card>
        </div>

        {/* Recent activity */}
        <div>
          <h2 className="mb-3 text-[13px] font-semibold text-text-2">Recent activity</h2>
          <Card>
            {recentActions.length > 0 ? (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {recentActions.map((ev, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-surface-2">
                    <Clock size={12} className="mt-0.5 shrink-0 text-text-3" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-1">{String(ev.summary ?? ev.action ?? '—')}</p>
                      <p className="text-[11px] text-text-3">
                        {String(ev.actor_name ?? ev.actor ?? '')} · {ago(ev.timestamp)}{ev.area ? ` · ${String(ev.area)}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : logsErr ? (
              <p className="text-[12px] text-text-3">Could not read the log — {logsErr}</p>
            ) : (
              <p className="text-[12px] text-text-3">No recent activity on record.</p>
            )}
          </Card>
        </div>
      </div>

      {/* Recent failures */}
      <div className="mt-4">
        <h2 className="mb-3 text-[13px] font-semibold text-text-2">Recent failures &amp; denials</h2>
        <Card>
          {logsErr ? (
            <p className="text-[12px] text-text-3">Could not read the log — {logsErr}</p>
          ) : logs.length === 0 ? (
            <EmptyState
              title="No failures on record"
              body="The platform log shows no failed or denied action in the recent window."
            />
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {logs.map((ev, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md bg-rose-500/5 px-2.5 py-2 text-[12px]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose-500" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-1">{String(ev.summary ?? ev.action ?? '—')}</p>
                    <p className="text-[11px] text-text-3">
                      {String(ev.actor_name ?? ev.actor ?? '')} · {ago(ev.timestamp)}{ev.area ? ` · ${String(ev.area)}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* footer */}
      <p className="mt-6 text-center text-[11px] text-text-3">
        <FileText size={11} className="mr-1 inline" />
        All checks are live — nothing cached, nothing simulated. Last checked {new Date().toLocaleTimeString()}.
      </p>
    </div>
  )
}
