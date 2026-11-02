// Leadership Dashboard — the WEEK across the company, on REAL data only.
// Everything on this screen is a number the platform already holds: apps + logsList what IT/the platform itself did…
import { useEffect, useMemo, useState } from 'react'
import { differenceInDays, format, subDays } from 'date-fns'
import DashboardTemplate from '@/engine/templates/dashboard'
import DragPerson from '@/components/shared/DragPerson'
import { api } from '@/lib/api'
import { TRACKER_OWN_ONLY, isTrackerOwnOnly } from '@/lib/certUploads'
import { gasAction } from '@/features/hiring/shared'
import { asList } from '@/lib/asList'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { ohioDayYear, ohioWall } from '@/lib/ohio'
import { readSlice, readSliceFloor } from '@/lib/snapshotClient'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { houseById, rosterDayISO, type ShiftMatrixCell } from '@/lib/seed-shifts2'
import type { PageSchema, TintName } from '@/engine/types'

type Row = Record<string, any>
const FEED_NAMES = ['apps', 'clients', 'callOffs', 'uiIncidents', 'drAppointments', 'financeTransactions',
  'people', 'candidates', 'staffCerts'] as const
type FeedName = (typeof FEED_NAMES)[number]
type Feeds = Record<FeedName, Row[] | null>

type MatrixState = { rows: (ShiftMatrixCell & { date?: string; houseName?: string })[]; ready: boolean; failed: boolean }

// Roster cells are a slice, never a live tab — an empty Hub tab would lie "nobody is scheduled".
async function readRosterMatrix(live: boolean): Promise<(ShiftMatrixCell & { date?: string })[]> {
  if (!live) return (await api.list<ShiftMatrixCell>('shiftMatrix' as never)) as ShiftMatrixCell[]
  const fresh = await readSlice<ShiftMatrixCell & { date?: string }>('shiftMatrix')
  if (fresh) return fresh
  const floor = await readSliceFloor<ShiftMatrixCell & { date?: string }>('shiftMatrix')
  if (floor) return floor.rows
  throw new Error('roster slice missing')
}
function cellDate(c: ShiftMatrixCell & { date?: string }): string {
  return String(c.date || (typeof c.dayIndex === 'number' ? rosterDayISO(c.dayIndex) : ''))
}
function isWorkingKind(kind: string): boolean {
  const k = kind.toLowerCase()
  return k !== '' && k !== 'off' && k !== 'ro' && k !== 'alias'
}

type LogEvent = { at: string; when: string; actor_name: string; summary: string; area: string; outcome: string }
type LogsState = { events: LogEvent[] } | null

// Tolerant date parse over the mirrors' mixed formats (ISO / M/D/YYYY), landing on OHIO's clock — the whole…
function toDate(v: unknown): Date | null {
  return ohioWall(String(v ?? '').trim())
}

// Death language, matched against every text cell of a UI/MUI row.
const DEATH_RE = /\b(death|deceased|passed away|passing|fatal|fatality)\b/i
function rowMentionsDeath(row: Row): boolean {
  return Object.values(row).some((v) => typeof v === 'string' && DEATH_RE.test(v))
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

// A list widget's `title` accepts a node, so the name it shows can be dragged to the sidebar tracker like any other…
const clientTitle = (raw: unknown) => {
  const name = String(raw ?? '').trim()
  return (
    <DragPerson name={name} type="client">
      {name || '—'}
    </DragPerson>
  )
}

/** The staff twin — rows that name the employee, never the person served. */
const staffTitle = (raw: unknown) => {
  const name = String(raw ?? '').trim()
  return (
    <DragPerson name={name}>
      {name || '—'}
    </DragPerson>
  )
}

export default function LeadershipPage() {
  const [feeds, setFeeds] = useState<Feeds>({
    apps: null, clients: null, callOffs: null,
    uiIncidents: null, drAppointments: null, financeTransactions: null,
    people: null, candidates: null, staffCerts: null,
  })
  const [logs, setLogs] = useState<LogsState>(null)
  const [failed, setFailed] = useState<string[]>([])
  /** the tracker answered only this account's own certifications (Certs.gs certTrackerList): nothing here counts them */
  const [certsOwnOnly, setCertsOwnOnly] = useState(false)
  // staffPerfList's PRECOMPUTED board — kept-copy paint-first (the source page's own key, so the two screens share…
  const [perf, setPerf] = useState<{ rows: Row[]; computed_at?: string } | null>(
    () => {
      const kept = readKept<Row[]>('asa:perf:board')
      return kept ? { rows: kept } : null
    },
  )
  const [recon, setRecon] = useState<Row[] | null>(null)
  // Time Reconciliation's reads are its writers' (admin, manager, its Review edition): a refusal is not a failure, so
  // the tile says "—" and the banner stays out of it
  const [reconShut, setReconShut] = useState(false)
  // hiringAnalysis: null = in flight, false = absent (builder has not written it yet), object = the crossed file.
  const [analysis, setAnalysis] = useState<Row | null | false>(
    () => readKept<Row>('asa:hiring:analysis'),
  )
  // The Command Deck's two tiles (kill list 4): null = in flight, [] = the honest none / not-cached-yet state.
  const [triage, setTriage] = useState<Row[] | null>(() => readKept<Row[]>('asa:alerts:triage'))
  const [forecast, setForecast] = useState<Row[] | null>(() => readKept<Row[]>('asa:workforce:forecast'))
  const [matrix, setMatrix] = useState<MatrixState>({ rows: [], ready: false, failed: false })
  const live = useApiConfigStore((s) => s.driver) === 'apps-script'

  useEffect(() => {
    let alive = true
    // a read still in flight at a sign-out or a crossing keeps nothing (lib/kept)
    const generation = keptGeneration()
    FEED_NAMES.forEach((name) => {
      api.list<Row>(name as never)
        .then((rows) => alive && setFeeds((f) => ({ ...f, [name]: Array.isArray(rows) ? rows : [] })))
        .catch((e) => {
          if (!alive) return
          if (isTrackerOwnOnly(e)) setCertsOwnOnly(true)
          setFailed((xs) => (xs.includes(name) ? xs : [...xs, name]))
        })
    })
    // The system log is an action, not a resource — one call, the whole week.
    gasAction<{ events: LogEvent[] }>('logsList', {
      since: subDays(new Date(), 7).toISOString(), limit: 1000,
    })
      .then((r) => alive && setLogs({ events: Array.isArray(r.events) ? r.events : [] }))
      .catch(() => alive && setFailed((xs) => (xs.includes('platform log') ? xs : [...xs, 'platform log'])))
    // The people/hiring lanes: the leadership-grade reads that existed and were never wired in.
    gasAction<{ rows?: Row[]; computed_at?: string }>('staffPerfList', {}, { timeoutMs: 120_000 })
      .then((d) => {
        if (!alive) return
        setPerf({ rows: d.rows ?? [], computed_at: d.computed_at })
        keepIfCurrent('asa:perf:board', d.rows ?? [], generation)
      })
      .catch(() => alive && setFailed((xs) => (xs.includes('performance board') ? xs : [...xs, 'performance board'])))
    gasAction<{ errors?: Row[] }>('reconErrors', {})
      .then((d) => alive && setRecon(Array.isArray(d.errors) ? d.errors : []))
      .catch((e) => {
        if (!alive) return
        if ((e as { status?: number })?.status === 403) setReconShut(true)
        else setFailed((xs) => (xs.includes('recon anomalies') ? xs : [...xs, 'recon anomalies']))
      })
    api.list<Row>('hiringAnalysis' as never)
      .then((rows) => {
        if (!alive) return
        const first = rows?.[0] ?? null
        setAnalysis(first ?? false)
        if (first) keepIfCurrent('asa:hiring:analysis', first, generation)
      })
      .catch(() => alive && setAnalysis(false))
    // The Command Deck's two tiles (kill list 4): derived slices off the old platform's mirror, kept-copy…
    api.list<Row>('alertsTriage' as never)
      .then((rows) => {
        if (!alive) return
        const r = Array.isArray(rows) ? rows : []
        setTriage(r)
        keepIfCurrent('asa:alerts:triage', r, generation)
      })
      .catch(() => alive && setFailed((xs) => (xs.includes('alerts triage') ? xs : [...xs, 'alerts triage'])))
    api.list<Row>('workforceForecast' as never)
      .then((rows) => {
        if (!alive) return
        const r = Array.isArray(rows) ? rows : []
        setForecast(r)
        keepIfCurrent('asa:workforce:forecast', r, generation)
      })
      .catch(() => alive && setFailed((xs) => (xs.includes('workforce forecast') ? xs : [...xs, 'workforce forecast'])))
    readRosterMatrix(live)
      .then((rows) => alive && setMatrix({ rows: Array.isArray(rows) ? rows : [], ready: true, failed: false }))
      .catch(() => {
        if (!alive) return
        setMatrix({ rows: [], ready: false, failed: true })
        setFailed((xs) => (xs.includes('roster slice') ? xs : [...xs, 'roster slice']))
      })
    return () => { alive = false }
  }, [live])

  const board = useMemo(() => {
    // Ohio's now, on the same carrier toDate() returns — the spark buckets and the rows landing in them have to…
    const now = ohioWall(new Date()) as Date
    const days7 = (v: unknown) => {
      const dt = toDate(v)
      return dt !== null && differenceInDays(now, dt) <= 7 && differenceInDays(now, dt) >= 0
    }
    const days30 = (v: unknown) => {
      const dt = toDate(v)
      return dt !== null && differenceInDays(now, dt) <= 30 && differenceInDays(now, dt) >= 0
    }
    const f = (name: FeedName) => feeds[name] ?? []
    const loading = (name: FeedName) => feeds[name] === null && !failed.includes(name)
    const broken = (name: FeedName) => failed.includes(name)
    const num = (name: FeedName, v: number | string) => (broken(name) ? '—' : loading(name) ? '' : v)
    // an own answer is one person's rows: said, never counted as the company's
    const certsWhy = certsOwnOnly ? TRACKER_OWN_ONLY : 'The certifications feed is not readable from this session.'

    const apps = f('apps'), clients = f('clients'), callOffs = f('callOffs')
    const uiIncidents = f('uiIncidents'), drAppointments = f('drAppointments')
    const tx = f('financeTransactions')

    /* ── The platform's own week (the IT lane) ─────────────────────────── */

    const appsEnabled = apps.filter((a) => String(a.enabled ?? 'yes').toLowerCase() !== 'no').length
    const appsChanged7 = apps
      .filter((a) => days7(a.updated_at))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))

    const events = logs?.events ?? []
    const logsBroken = failed.includes('platform log')
    const logsLoading = logs === null && !logsBroken
    // Per-day spark, oldest → newest, LOCAL days (the UTC-day trap is real).
    const sparkDays: string[] = []
    for (let i = 6; i >= 0; i--) sparkDays.push(format(subDays(now, i), 'yyyy-MM-dd'))
    const perDay = new Map<string, number>(sparkDays.map((d) => [d, 0]))
    const perArea = new Map<string, number>()
    const failures: LogEvent[] = []
    events.forEach((e) => {
      const dt = toDate(e.at)
      if (dt) {
        const key = format(dt, 'yyyy-MM-dd')
        if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1)
      }
      perArea.set(e.area || 'other', (perArea.get(e.area || 'other') ?? 0) + 1)
      if (String(e.outcome).toLowerCase() === 'failed') failures.push(e)
    })
    const areaBars = [...perArea.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    /* ── The clients' money this week ──────────────────────────────────── */

    const tx7 = tx.filter((t) => days7(t.date))
    let deposits7 = 0, spending7 = 0
    const byClient = new Map<string, number>()
    tx7.forEach((t) => {
      const amt = Number(t.amount) || 0
      if (amt >= 0) deposits7 += amt
      else spending7 += -amt
      const name = String(t.client || '—')
      byClient.set(name, (byClient.get(name) ?? 0) + Math.abs(amt))
    })
    const moverBars = [...byClient.entries()]
      .map(([label, value]) => ({ label, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    /* ── People and incidents ──────────────────────────────────────────── */

    const offs7 = callOffs.filter((c) => days7(c.date))
    const offsByDay = sparkDays.map((d) => ({
      label: format(new Date(`${d}T12:00:00`), 'EEE d'),
      value: offs7.filter((c) => {
        const dt = toDate(c.date)
        return dt !== null && format(dt, 'yyyy-MM-dd') === d
      }).length,
    }))

    const inc7 = uiIncidents.filter((i) => days7(i.incident_date))
    const recentInc = [...inc7]
      .map((i) => ({ ...i, _d: toDate(i.incident_date) }) as Row & { _d: Date | null })
      .sort((a, b) => ((b._d as Date)?.getTime() ?? 0) - ((a._d as Date)?.getTime() ?? 0))
      .slice(0, 6)

    // 30 days, not 7: a death from ten days ago is not old news on this screen.
    const deaths30 = uiIncidents
      .filter((i) => days30(i.incident_date) && rowMentionsDeath(i))
      .map((i) => ({ ...i, _d: toDate(i.incident_date) }) as Row & { _d: Date | null })
      .sort((a, b) => ((b._d as Date)?.getTime() ?? 0) - ((a._d as Date)?.getTime() ?? 0))

    const upcomingDr = drAppointments
      .map((a) => ({ ...a, _d: toDate(a.next_visit) }) as Row & { _d: Date | null })
      .filter((a) => a._d !== null && differenceInDays(a._d as Date, now) >= 0 && differenceInDays(a._d as Date, now) <= 7)
      .filter((a) => String(a.active_or_discontinued || '').toLowerCase() !== 'discontinued')
      .sort((a, b) => (a._d as Date).getTime() - (b._d as Date).getTime())
      .slice(0, 8)

    // ── People, performance, hiring, coverage (the leadership- grade reads the board never drew)…

    const people = f('people'), candidates = f('candidates'), staffCerts = f('staffCerts')
    const activeStaff = people.filter((p) => String(p.status ?? '').toLowerCase() === 'active').length
    const pendingCandidates = candidates.filter((c) => !['hired', 'not_hiring'].includes(String(c.stage))).length
    const certExpired = staffCerts.filter((c) => String(c.status).toLowerCase() === 'expired').length
    const certExpiring = staffCerts.filter((c) => String(c.status).toLowerCase() === 'expiring').length
    const certMissing = staffCerts.filter((c) => String(c.status).toLowerCase() === 'missing').length

    const perfBroken = failed.includes('performance board')
    const perfRows = perf?.rows ?? []
    const grades = perfRows.map((r) => Number(r.grade)).filter((n) => Number.isFinite(n))
    const gradeAvg = grades.length ? (grades.reduce((s, n) => s + n, 0) / grades.length).toFixed(1) : null
    const perfAttention = [...perfRows]
      .filter((r) => String(r.status ?? '').toLowerCase() !== 'terminated')
      .sort((a, b) => (Number(b.incidents_major) || 0) - (Number(a.incidents_major) || 0) ||
                      (Number(a.grade) || 0) - (Number(b.grade) || 0))
      .slice(0, 6)

    const reconBroken = failed.includes('recon anomalies')
    const reconOpen = (recon ?? []).filter((e) => String(e.status ?? '').toLowerCase() === 'open')

    // 30-day per-day area series — the board's first trend lines.
    const days30List: string[] = []
    for (let i = 29; i >= 0; i--) days30List.push(format(subDays(now, i), 'yyyy-MM-dd'))
    const perDaySeries = (rows: Row[], key: string) => {
      const m = new Map<string, number>(days30List.map((d) => [d, 0]))
      rows.forEach((r) => {
        const dt = toDate(r[key])
        if (!dt) return
        const k = format(dt, 'yyyy-MM-dd')
        if (m.has(k)) m.set(k, (m.get(k) ?? 0) + 1)
      })
      return days30List.map((d) => m.get(d) ?? 0)
    }
    const incSeries30 = perDaySeries(uiIncidents, 'incident_date')
    const offSeries30 = perDaySeries(callOffs, 'date')

    // Who called off, named — the field was in the feed and discarded.
    const offNameMix = new Map<string, number>()
    callOffs.filter((c) => days30(c.date)).forEach((c) => {
      const who = String(c.employee_name ?? '').trim()
      if (who) offNameMix.set(who, (offNameMix.get(who) ?? 0) + 1)
    })
    const offNames = [...offNameMix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

    // The hiring funnel — the ONE crossed file the builder writes.
    const stages: Row[] = Array.isArray((analysis as Row | null)?.process?.stages)
      ? ((analysis as Row).process.stages as Row[]) : []
    const funnelBars = stages.map((s) => ({ label: String(s.label ?? s.id), value: Number(s.count) || 0 }))
    const stuck = stages
      .filter((s) => String(s.longest_who ?? '').trim() && Number(s.longest_days) > 0)
      .sort((a, b) => (Number(b.longest_days) || 0) - (Number(a.longest_days) || 0))
      .slice(0, 6)
    const book = (analysis as Row | null)?.books?.book as Row | undefined
    const analysisEmpty = analysis === false
      ? 'The crossed analysis has not been built yet — that is the builder, not the company; this fills on its next pass.'
      : analysis === null ? 'Loading…' : ''

    // Coverage today, off the roster slice — an empty tab must never lie.
    const todayISO = format(now, 'yyyy-MM-dd')
    const todayCells = matrix.rows.filter((c) => cellDate(c) === todayISO)
    const workingToday = todayCells.filter((c) => isWorkingKind(String(c.kind || '')))
    const houseIds = new Set(matrix.rows.map((c) => String(c.houseId || '')).filter(Boolean))
    const coveredIds = new Set(workingToday.map((c) => String(c.houseId || '')).filter(Boolean))
    const gapIds = [...houseIds].filter((id) => !coveredIds.has(id))
    const houseLabel = (id: string) => {
      const named = matrix.rows.find((c) => String(c.houseId || '') === id && String((c as Row).houseName || '').trim())
      return String((named as Row | undefined)?.houseName || '').trim() || houseById(id)?.name || houseById(id)?.code || id
    }
    const covNum = (v: number | string) => (matrix.failed ? '—' : matrix.ready ? v : '')

    /* ── Round two: the fields round one left on the floor ── */

    // Certifications expiring, BY NAME — the donut's counts made actionable.
    const certsSoon = staffCerts
      .map((c) => ({ ...c, _d: toDate(c.expiresAt) }) as Row & { _d: Date | null })
      .filter((c) => c._d !== null && differenceInDays(c._d as Date, now) >= 0 && differenceInDays(c._d as Date, now) <= 60)
      .sort((a, b) => (a._d as Date).getTime() - (b._d as Date).getTime())
      .slice(0, 8)
    const certsUndatedExpiring = staffCerts
      .filter((c) => String(c.status).toLowerCase() === 'expiring' && !String(c.expiresAt ?? '').trim())
      .slice(0, 3)

    // Working today, named — the roster slice's per-day cells.
    const KIND_RANK: Record<string, number> = { morning: 0, day: 1, afternoon: 2, evening: 3, overnight: 4 }
    const onDutyToday = matrix.rows
      .filter((c) => cellDate(c) === todayISO && isWorkingKind(String(c.kind || '')))
      .sort((a, b) =>
        String((a as Row).houseName || '').localeCompare(String((b as Row).houseName || '')) ||
        (KIND_RANK[String(a.kind).toLowerCase()] ?? 9) - (KIND_RANK[String(b.kind).toLowerCase()] ?? 9))
      .slice(0, 12)

    // Week vs the week before + 8 weekly buckets.
    const weekly = (rows: Row[], key: string) => {
      const buckets = new Array(8).fill(0) as number[]
      let cur = 0, prev = 0
      rows.forEach((r) => {
        const dt = toDate(r[key])
        if (!dt) return
        const diff = differenceInDays(now, dt)
        if (diff < 0) return
        if (diff <= 7) cur++
        else if (diff <= 14) prev++
        const w = Math.floor(diff / 7)
        if (w <= 7) buckets[7 - w]++
      })
      return { cur, prev, buckets }
    }
    const offsWow = weekly(callOffs, 'date')
    const incWow = weekly(uiIncidents, 'incident_date')

    // Incidents by HOUSE, via the client on the report — incident_location is free text (482× "Client Home") and…
    const houseOfClient = new Map<string, string>()
    clients.forEach((c) => {
      const n = String(c.name ?? '').trim().toLowerCase()
      if (n && String(c.house ?? '').trim()) houseOfClient.set(n, String(c.house).trim())
    })
    const incByHouse = new Map<string, number>()
    uiIncidents.filter((i) => days30(i.incident_date)).forEach((i) => {
      const h = houseOfClient.get(String(i.client_name ?? '').trim().toLowerCase())
      const label = h ? houseLabel(h) : 'No house on file'
      incByHouse.set(label, (incByHouse.get(label) ?? 0) + 1)
    })
    const incHouseBars = [...incByHouse.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8)

    // Attendance events by TYPE — the field was loaded and discarded; a no-show is a different failure than a…
    const offTypes = { calloff: 0, late: 0, noshow: 0, senthome: 0 }
    callOffs.filter((c) => days30(c.date)).forEach((c) => {
      const t = String(c.type ?? '')
      if (/no.?show/i.test(t)) offTypes.noshow++
      else if (/late/i.test(t)) offTypes.late++
      else if (/sent home/i.test(t)) offTypes.senthome++
      else offTypes.calloff++
    })

    // Work anniversaries in the next 30 days — retention, finally on a board.
    const anniversaries = people
      .filter((p) => String(p.role ?? '') === 'staff' && String(p.status ?? '').toLowerCase() === 'active')
      .map((p) => {
        const d = toDate(p.start_date)
        if (!d) return null
        let anniv = new Date(now.getFullYear(), d.getMonth(), d.getDate())
        if (differenceInDays(anniv, now) < 0) anniv = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate())
        const years = anniv.getFullYear() - d.getFullYear()
        const until = differenceInDays(anniv, now)
        return years >= 1 && until >= 0 && until <= 30 ? { name: String(p.name ?? ''), years, anniv, until } : null
      })
      .filter(Boolean)
      .sort((a, b) => (a as { until: number }).until - (b as { until: number }).until) as { name: string; years: number; anniv: Date; until: number }[]

    // Hiring blockers — WHY the funnel is stuck, with the owner lane.
    const conditions: Row[] = Array.isArray((analysis as Row | null)?.conditions)
      ? ((analysis as Row).conditions as Row[]) : []
    const blockerBars = conditions
      .map((c) => ({ label: `${c.label} — ${c.owner}`, value: (Number(c.pending) || 0) + (Number(c.missing) || 0) }))
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    /* ── The Command Deck's two tiles (kill list 4) ───────────────────── */

    // Alerts to triage: the actionable types (cert / scheduling / drift / spike …) each draw a bar tinted by their…
    const triageBroken = failed.includes('alerts triage')
    const triageRows = triage ?? []
    const NOISE = /multi_metric|attention/i
    const sevTint = (s: string): TintName =>
      /crit|high|severe/i.test(s) ? 'pink' : /warn|med/i.test(s) ? 'amber' : 'blue'
    const SEV_RANK: Record<string, number> = { pink: 3, amber: 2, blue: 1 }
    const triageGroups = new Map<string, { value: number; tint: TintName; noise: boolean }>()
    triageRows.forEach((r) => {
      const type = String(r.alert_type ?? '')
      const noise = NOISE.test(type)
      const key = noise ? 'statistical (multi-metric · attention)' : type.replace(/_/g, ' ')
      const t = noise ? ('lavender' as TintName) : sevTint(String(r.severity ?? ''))
      const g = triageGroups.get(key) ?? { value: 0, tint: t, noise }
      g.value += Number(r.count) || 0
      if (!noise && (SEV_RANK[t] ?? 0) > (SEV_RANK[g.tint] ?? 0)) g.tint = t
      triageGroups.set(key, g)
    })
    const triageTotal = triageRows.reduce((n, r) => n + (Number(r.count) || 0), 0)
    const triageNew = triageRows.reduce((n, r) => n + (Number(r.new_24h) || 0), 0)
    const triageBars = [...triageGroups.entries()]
      .map(([label, g]) => ({ label, value: g.value, tint: g.tint }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
    const triageEmpty = triageBroken
      ? 'The alerts feed failed — the banner above names it.'
      : triage === null ? 'Loading…' : 'The queue is clear — no unacknowledged alerts.'

    // Flight risk / workforce forecast: the latest cached run's payload, its own field names — flight_risk and the…
    const forecastBroken = failed.includes('workforce forecast')
    const analysisRow = (forecast ?? []).find((r) => r.id === 'analysis')
    const insightsRow = (forecast ?? []).find((r) => r.id === 'insights')
    const flightRisk: Row[] = Array.isArray(insightsRow?.flight_risk) ? insightsRow.flight_risk : []
    const riskTop = [...flightRisk]
      .sort((a, b) => (Number(b.risk) || 0) - (Number(a.risk) || 0))
      .slice(0, 5)
    const conclusions: Row[] = Array.isArray(insightsRow?.executive_conclusions)
      ? insightsRow.executive_conclusions : []
    const forecastAt = String(insightsRow?.computed_at ?? analysisRow?.computed_at ?? '').trim()
    const forecastEmpty = forecastBroken
      ? 'The forecast feed failed — the banner above names it.'
      : forecast === null ? 'Loading…'
        : 'The forecast job has not cached a run yet — that is the builder, not the company; this fills on its next pass.'

    // Clients per house (catalog) — pairs with the coverage gaps.
    const censusByHouse = new Map<string, number>()
    clients.filter((c) => String(c.status ?? '').toLowerCase() === 'active').forEach((c) => {
      const h = String(c.house ?? '').trim()
      censusByHouse.set(h ? houseLabel(h) : 'No house on file', (censusByHouse.get(h ? houseLabel(h) : 'No house on file') ?? 0) + 1)
    })
    const censusBars = [...censusByHouse.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)

    // Money 30-day trend (catalog): series stay EMPTY when the feed failed — an area chart cannot say "broken" and…
    const moneyIn = new Array(days30List.length).fill(0) as number[]
    const moneyOut = new Array(days30List.length).fill(0) as number[]
    tx.forEach((t) => {
      const dt = toDate(t.date)
      if (!dt) return
      const k = format(dt, 'yyyy-MM-dd')
      const idx = days30List.indexOf(k)
      if (idx === -1) return
      const amt = Number(t.amount) || 0
      if (amt >= 0) moneyIn[idx] += amt
      else moneyOut[idx] += -amt
    })
    const moneySeries = broken('financeTransactions') ? [] : [
      { name: 'In', color: 'mint' as TintName, points: moneyIn.map(Math.round) },
      { name: 'Out', color: 'peach' as TintName, points: moneyOut.map(Math.round) },
    ]

    // The AI screening class + the grade mix (catalog) — loaded, never drawn.
    const notas = (analysis as Row | null)?.notas as Row | undefined
    const gradeMix = { top: 0, good: 0, mid: 0, low: 0 }
    perfRows.filter((r) => String(r.status ?? '').toLowerCase() !== 'terminated').forEach((r) => {
      const g = Number(r.grade)
      if (!Number.isFinite(g)) return
      if (g >= 9) gradeMix.top++
      else if (g >= 7) gradeMix.good++
      else if (g >= 5) gradeMix.mid++
      else gradeMix.low++
    })

    // Stable ids: the persisted layout keys on them — renaming or retinting a widget must never lose the leader's…
    const widgets = [
      /* the headline row — the company, not the platform */
      { id: 'stat-staff', kind: 'stat', label: 'Active staff', description: 'People on the roster with status Active.', value: num('people', activeStaff), tint: 'blue', href: '/app/employee-tracker/board' },
      { id: 'stat-clients', kind: 'stat', label: 'Active clients', description: 'Count of the client directory.', value: num('clients', clients.length), tint: 'pink', href: '/app/clients/directory' },
      { id: 'stat-grade', kind: 'stat', label: 'Average staff grade', description: 'The performance board’s precomputed grade, averaged across the roster.', value: perfBroken ? '—' : perf === null ? '' : (gradeAvg ?? '—'), deltaLabel: perf?.computed_at ? `computed ${ohioDayYear(String(perf.computed_at))}` : undefined, tint: 'lavender', href: '/app/staff-performance/board' },
      { id: 'stat-hiring', kind: 'stat', label: 'Candidates in process', description: 'Everyone on the hiring board who is neither hired nor out.', value: num('candidates', pendingCandidates), tint: 'mint', href: '/app/talent-pipeline/analysis' },
      { id: 'stat-anomalies', kind: 'stat', label: 'Attendance anomalies open', description: 'Open time-reconciliation errors — shifts that do not add up.', value: reconBroken || reconShut ? '—' : recon === null ? '' : reconOpen.length, tint: 'amber', href: '/app/time-recon/queue' },
      { id: 'stat-calloffs', kind: 'stat', label: 'Call-offs — 7 days', description: 'Call-offs filed in the last 7 days.', value: num('callOffs', offs7.length), tint: 'amber', href: '/app/call-offs/log' },
      { id: 'stat-money', kind: 'stat', label: 'Client money moved — 7 days', description: 'Total ledger movement this week — deposits and spending together.', value: num('financeTransactions', money(deposits7 + spending7)), deltaLabel: `${money(deposits7)} in · ${money(spending7)} out · ${tx7.length} transactions`, tint: 'mint', href: '/app/finance/portal' },
      { id: 'stat-coverage', kind: 'stat', label: 'Houses covered today', description: 'Houses with somebody working today, off the roster slice.', value: covNum(houseIds.size ? `${coveredIds.size}/${houseIds.size}` : '—'), tint: 'peach', href: '/app/shift-board/board' },

      /* deaths — always present, see the header comment */
      {
        id: 'deaths-flag', kind: 'list', title: 'Deaths — flagged from UI/MUI reports, last 30 days', span: 1,
        description: 'Death language scanned out of every UI/MUI report of the last 30 days — always present.',
        empty: broken('uiIncidents') ? 'The incidents feed failed — this widget cannot vouch for anything right now.'
          : loading('uiIncidents') ? 'Loading…' : 'None reported in the last 30 days.',
        items: deaths30.map((i) => ({
          title: clientTitle(i.client_name),
          meta: [asList(i.incident_category)[0] || 'UI/MUI report', i._d ? format(i._d as Date, 'MMM d') : '', String(i.incident_location || '')].filter(Boolean).join(' · '),
          icon: 'triangle-alert', tint: 'pink' as TintName,
        })),
        viewAllHref: '/app/ui-incidents/log',
      },

      /* the clients' week */
      {
        id: 'incidents-week', kind: 'list', title: `UI/MUI reports — ${inc7.length} this week`, span: 1,
        description: 'The week’s UI/MUI reports, newest first.',
        empty: loading('uiIncidents') ? 'Loading…' : 'No reports filed this week.',
        items: recentInc.map((i) => ({
          title: clientTitle(i.client_name),
          meta: [asList(i.incident_category)[0] || 'Incident', i._d ? format(i._d as Date, 'MMM d') : '', String(i.incident_location || '')].filter(Boolean).join(' · '),
          icon: 'triangle-alert', tint: (rowMentionsDeath(i) ? 'pink' : 'peach') as TintName,
        })),
        viewAllHref: '/app/ui-incidents/log',
      },
      {
        id: 'calloffs-by-day', kind: 'bars', title: 'Call-offs by day — 7 days', span: 1,
        description: 'Call-offs bucketed per day across the last week.',
        bars: offsByDay,
        empty: loading('callOffs') ? 'Loading…' : 'No call-offs this week.',
        viewAllHref: '/app/call-offs/log',
      },
      {
        id: 'money-movers', kind: 'bars', title: 'Ledger movement by client — 7 days', span: 1,
        description: 'Which client ledgers moved the most money this week.',
        bars: moverBars,
        empty: broken('financeTransactions') ? 'The ledger feed is not readable from this session.'
          : loading('financeTransactions') ? 'Loading…' : 'No transactions recorded this week.',
        viewAllHref: '/app/finance/portal', viewAllLabel: 'Open the ledger',
      },
      {
        id: 'dr-week', kind: 'list', title: 'Client appointments — next 7 days', span: 1,
        description: 'Doctor appointments scheduled inside the next week.',
        empty: loading('drAppointments') ? 'Loading…' : 'Nothing scheduled in the next week.',
        items: upcomingDr.map((a) => ({
          title: clientTitle(a.client),
          meta: [String(a.specialist || a.dr_name || ''), a._d ? format(a._d as Date, 'MMM d') : ''].filter(Boolean).join(' · '),
          icon: 'stethoscope', tint: 'blue' as TintName,
        })),
        viewAllHref: '/app/dr-appointments/upcoming',
      },

      /* the people lane */
      {
        id: 'list-perf-attention', kind: 'list', title: 'Performance — needs a look', span: 1,
        description: 'The precomputed performance board’s bottom of the class: major incidents first, lowest grade next.',
        empty: perfBroken ? 'The performance board is not readable from this session.'
          : perf === null ? 'Loading…' : 'Nobody stands out — the board reads clean.',
        items: perfAttention.map((r) => ({
          title: staffTitle(r.name),
          // attendance_90d is a COUNT of call-offs (perfGrade_ deducts per row) — the % it wore here was a unit lie
          meta: [`grade ${r.grade ?? '—'}`, `${r.attendance_90d ?? '—'} call-offs 90d`,
                 Number(r.incidents_major) > 0 ? `${r.incidents_major} major` : `${r.incidents ?? 0} incidents`]
            .filter(Boolean).join(' · '),
          icon: 'gauge', tint: (Number(r.incidents_major) > 0 ? 'pink' : 'amber') as TintName,
        })),
        viewAllHref: '/app/staff-performance/board',
      },
      {
        id: 'list-calloff-names', kind: 'list', title: 'Call-offs by person — 30 days', span: 1,
        description: 'Who called off the most in the last 30 days — the feed always carried the names.',
        empty: broken('callOffs') ? 'The call-offs feed is not readable from this session.'
          : loading('callOffs') ? 'Loading…' : 'No call-offs in the last 30 days.',
        items: offNames.map(([who, n]) => ({
          title: staffTitle(who),
          meta: `${n} call-off${n === 1 ? '' : 's'}`,
          icon: 'phone-off', tint: (n >= 3 ? 'pink' : 'amber') as TintName,
        })),
        viewAllHref: '/app/call-offs/log',
      },
      {
        id: 'donut-certs', kind: 'donut', title: 'Certifications at risk', span: 1,
        description: 'Expired, expiring and missing staff certifications, as share-of-total.',
        slices: [
          { label: 'Expired', value: certExpired, tint: 'pink' },
          { label: 'Expiring', value: certExpiring, tint: 'amber' },
          { label: 'Missing', value: certMissing, tint: 'peach' },
        ],
        centerLabel: 'at risk',
        // an unread feed is never a donut of zeros
        unavailable: broken('staffCerts') ? certsWhy : undefined,
      },
      {
        id: 'area-calloffs', kind: 'area', title: 'Call-offs — 30-day trend', span: 2,
        description: 'Call-offs per day across the last 30 days — the board’s first trend line.',
        series: [{ name: 'Call-offs', color: 'amber' as TintName, points: offSeries30 }],
      },

      /* the hiring lane — all off the crossed hiringAnalysis slice */
      {
        id: 'bars-hiring-funnel', kind: 'bars', title: 'Hiring funnel — who stands where', span: 1,
        description: 'Every hiring stage with its current count, from the crossed analysis file.',
        bars: funnelBars,
        empty: analysisEmpty || 'The funnel is empty.',
        viewAllHref: '/app/talent-pipeline/analysis',
      },
      {
        id: 'list-hiring-stuck', kind: 'list', title: 'Hiring — longest waits', span: 1,
        description: 'The person who has waited longest at each stage, by days.',
        empty: analysisEmpty || 'Nobody is waiting unusually long.',
        items: stuck.map((s) => ({
          title: staffTitle(s.longest_who),
          meta: `${s.longest_days} days at ${String(s.label ?? s.id)}`,
          icon: 'hourglass', tint: (Number(s.longest_days) > 14 ? 'pink' : 'amber') as TintName,
        })),
        viewAllHref: '/app/talent-pipeline/analysis',
      },
      {
        id: 'donut-contracts', kind: 'donut', title: 'Contracts — signed vs waiting', span: 1,
        description: 'The contract book: signed, pending and declined.',
        slices: book ? [
          { label: 'Signed', value: Number(book.signed) || 0, tint: 'mint' },
          { label: 'Pending', value: Number(book.pending) || 0, tint: 'amber' },
          { label: 'Declined', value: Number(book.declined) || 0, tint: 'pink' },
        ] : [],
        centerLabel: 'contracts',
      },

      // the Command Deck's two tiles (kill list 4) — company lanes, not platform telemetry
      {
        id: 'bars-alerts-triage', kind: 'bars', span: 1,
        title: triage === null || triageBroken ? 'Alerts to triage' : `Alerts to triage — ${triageTotal} open · ${triageNew} new in 24h`,
        description: 'Unacknowledged alerts grouped by type, the bar tinted by the worst severity inside; the statistical-outlier noise folds into one dimmer bar.',
        bars: triageBars,
        empty: triageEmpty,
      },
      {
        id: 'list-flight-risk', kind: 'list', span: 1,
        title: forecastAt ? `Flight risk — computed ${ohioDayYear(forecastAt)}` : 'Flight risk — the workforce forecast',
        description: 'The workforce forecast’s top flight-risk names with their driver, then the run’s own conclusion lines.',
        empty: forecastEmpty,
        items: [
          ...riskTop.map((r) => ({
            title: staffTitle(r.name),
            meta: [`risk ${r.risk ?? '—'}`, asList(r.factors)[0] || ''].filter(Boolean).join(' · '),
            icon: 'trending-up', tint: (Number(r.risk) >= 50 ? 'pink' : 'amber') as TintName,
          })),
          ...conclusions.slice(0, 3).map((c) => ({
            title: String(c.claim ?? '—'),
            meta: String(c.action ?? ''),
            icon: 'lightbulb', tint: 'lavender' as TintName,
          })),
        ],
        viewAllHref: '/app/staff-performance/board',
      },

      /* coverage — the roster slice, never a live tab */
      {
        id: 'list-coverage-gaps', kind: 'list', title: 'Houses with nobody today', span: 1,
        description: 'Houses the roster slice shows uncovered today.',
        empty: matrix.failed ? 'The roster slice is not readable — this widget cannot vouch for coverage.'
          : !matrix.ready ? 'Loading…' : 'Every house has somebody today.',
        items: gapIds.slice(0, 8).map((id) => ({
          title: houseLabel(id),
          meta: 'no working shift today',
          icon: 'house', tint: 'pink' as TintName,
        })),
        viewAllHref: '/app/shift-board/board',
      },
      {
        id: 'area-incidents', kind: 'area', title: 'UI/MUI reports — 30-day trend', span: 2,
        description: 'Incident reports per day across the last 30 days.',
        series: [{ name: 'Reports', color: 'pink' as TintName, points: incSeries30 }],
      },

      /* round two — the fields that were on the floor */
      {
        id: 'stat-wow-calloffs', kind: 'stat', label: 'Call-offs — this week vs last',
        description: 'The week against the week before, with eight weekly buckets behind it.',
        value: num('callOffs', offsWow.cur), deltaLabel: `${offsWow.prev} the week before`,
        spark: offsWow.buckets, tint: 'amber', href: '/app/call-offs/log',
      },
      {
        id: 'stat-wow-incidents', kind: 'stat', label: 'Incidents — this week vs last',
        description: 'UI/MUI reports this week against the week before, weekly buckets behind.',
        value: num('uiIncidents', incWow.cur), deltaLabel: `${incWow.prev} the week before`,
        spark: incWow.buckets, tint: 'pink', href: '/app/ui-incidents/log',
      },
      {
        id: 'list-certs-expiring-named', kind: 'list', title: 'Certifications expiring — by name', span: 1,
        description: 'Every certification dated inside the next 60 days, soonest first — the donut’s counts, made actionable.',
        empty: broken('staffCerts') ? certsWhy
          : loading('staffCerts') ? 'Loading…' : 'Nothing expires in the next 60 days.',
        items: [
          ...certsSoon.map((c) => {
            const days = differenceInDays(c._d as Date, now)
            return {
              title: staffTitle(c.personName),
              meta: `${c.certName} · ${days}d — ${format(c._d as Date, 'MMM d')}`,
              icon: 'badge-alert', tint: (days <= 14 ? 'pink' : 'amber') as TintName,
            }
          }),
          ...certsUndatedExpiring.map((c) => ({
            title: staffTitle(c.personName),
            meta: `${c.certName} · no date on file`,
            icon: 'badge-alert', tint: 'amber' as TintName,
          })),
        ],
        viewAllHref: '/app/employee-tracker/certifications',
      },
      {
        id: 'list-on-duty-today', kind: 'list', title: 'Working today', span: 1,
        description: 'Who the roster slice puts on shift today, house by house, with the shift time.',
        empty: matrix.failed ? 'The roster slice is not readable — this widget cannot vouch for coverage.'
          : !matrix.ready ? 'Loading…' : 'Nobody is scheduled today.',
        items: onDutyToday.map((c) => ({
          title: staffTitle(c.staffName),
          meta: `${String((c as Row).houseName || houseLabel(String(c.houseId || '')))} · ${String((c as Row).code || c.kind)}`,
          icon: 'clock', tint: (String(c.kind).toLowerCase() === 'overnight' ? 'lavender' : 'blue') as TintName,
        })),
        viewAllHref: '/app/shift-board/board',
      },
      {
        id: 'bars-incidents-by-house', kind: 'bars', title: 'Incidents by house — 30 days (via the client on the report)', span: 1,
        description: 'Reports grouped by the reported client’s own house — the location cell is free text and cannot group.',
        bars: incHouseBars,
        empty: broken('uiIncidents') ? 'The incidents feed is not readable from this session.'
          : broken('clients') ? 'The clients feed is not readable — the house join needs it.'
          : loading('uiIncidents') ? 'Loading…' : 'No reports in the last 30 days.',
        viewAllHref: '/app/ui-incidents/log',
      },
      {
        id: 'donut-calloff-types', kind: 'donut', title: 'Attendance events by type — 30 days', span: 1,
        description: 'Call-off, late show, no-show/no-call and sent home — a no-show is a different failure than a call-off.',
        slices: [
          { label: 'Call off', value: offTypes.calloff, tint: 'amber' },
          { label: 'Late show', value: offTypes.late, tint: 'peach' },
          { label: 'No show / no call', value: offTypes.noshow, tint: 'pink' },
          { label: 'Sent home', value: offTypes.senthome, tint: 'lavender' },
        ],
        centerLabel: 'events 30d',
      },
      {
        id: 'list-anniversaries', kind: 'list', title: 'Work anniversaries — next 30 days', span: 1,
        description: 'Active staff completing another year — retention, finally on a board.',
        empty: broken('people') ? 'The people feed is not readable from this session.'
          : loading('people') ? 'Loading…' : 'No work anniversaries in the next 30 days.',
        items: anniversaries.map((a) => ({
          title: staffTitle(a.name),
          meta: `${a.years} year${a.years === 1 ? '' : 's'} · ${format(a.anniv, 'MMM d')}`,
          icon: 'cake', tint: 'mint' as TintName,
        })),
      },
      {
        id: 'bars-hiring-blockers', kind: 'bars', title: 'Hiring — what is blocking whom', span: 1,
        description: 'Open conditions (pending + missing) per requirement and owner lane, from the crossed analysis.',
        bars: blockerBars,
        empty: analysisEmpty || 'Nothing is blocking anyone.',
        viewAllHref: '/app/talent-pipeline/analysis',
      },
    ]

    // ── THE SUGGESTION CATALOG — more widgets this board can draw from the SAME feeds, off until a leader turns…

    const catTints: TintName[] = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber']

    const incCatMix = new Map<string, number>()
    inc7.forEach((i) => {
      const cats = asList(i.incident_category)
      for (const c of cats.length ? cats : ['Uncategorised']) incCatMix.set(c, (incCatMix.get(c) ?? 0) + 1)
    })
    const incCatBars = [...incCatMix.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    const bigTx = [...tx7]
      .sort((a, b) => Math.abs(Number(b.amount) || 0) - Math.abs(Number(a.amount) || 0))
      .slice(0, 6)

    const recentEvents = [...events]
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, 6)

    const inc30count = uiIncidents.filter((i) => days30(i.incident_date)).length

    const catalog = [
      // THE PLATFORM LANE, DEMOTED: half the default board was IT telemetry — apps changed, actions, failures.
      { id: 'stat-apps', kind: 'stat', label: 'Apps live on the platform', description: 'Enabled apps, with how many changed this week.', value: num('apps', appsEnabled), deltaLabel: `${appsChanged7.length} changed ≤7d`, tint: 'lavender', href: '/apps' },
      { id: 'stat-actions', kind: 'stat', label: 'Platform actions — 7 days', description: 'Every platform action of the week, with a per-day sparkline and the failure count.', value: logsBroken ? '—' : logsLoading ? '' : events.length, deltaLabel: failures.length ? `${failures.length} failed` : 'no failures', spark: sparkDays.map((d) => perDay.get(d) ?? 0), tint: 'blue', href: '/app/logs/feed' },
      {
        id: 'apps-changed', kind: 'list', title: 'App changes — 7 days', span: 1,
        description: 'Apps created or changed this week, and by whom.',
        empty: loading('apps') ? 'Loading…' : 'No app was created or changed this week.',
        items: appsChanged7.slice(0, 6).map((a) => ({
          title: String(a.name || a.id || '—'),
          // `updated_at` is a real stamp — slicing its first ten characters publishes the UTC day, which is already…
          meta: [String(a.updated_by || ''), ohioDayYear(String(a.updated_at || ''))].filter(Boolean).join(' · '),
          icon: 'layout-grid', tint: 'lavender' as TintName,
        })),
        viewAllHref: '/apps', viewAllLabel: 'All apps',
      },
      {
        id: 'activity-areas', kind: 'bars', title: 'Platform activity by area — 7 days', span: 1,
        description: 'The week’s platform actions grouped by area of the system.',
        bars: areaBars,
        empty: logsLoading ? 'Loading…' : logsBroken ? 'The platform log is not readable from this session.' : 'No activity recorded this week.',
        viewAllHref: '/app/logs/feed',
      },
      {
        id: 'failures-week', kind: 'list', title: `Platform failures — ${failures.length} this week`, span: 2,
        description: 'Every failed platform action of the week — what broke and who was acting.',
        empty: logsLoading ? 'Loading…' : logsBroken ? 'The platform log is not readable from this session.' : 'Not one failed action this week.',
        items: failures.slice(0, 8).map((e) => ({
          title: e.summary || '—',
          meta: [e.actor_name, e.when].filter(Boolean).join(' · '),
          icon: 'triangle-alert', tint: 'amber' as TintName,
        })),
        viewAllHref: '/app/logs/feed', viewAllLabel: 'Open the log',
      },
      /* round two catalog */
      {
        id: 'bars-census-by-house', kind: 'bars', title: 'Clients per house',
        description: 'Active clients grouped by their house — pairs with the coverage gaps.',
        bars: censusBars,
        empty: broken('clients') ? 'The clients feed is not readable from this session.'
          : loading('clients') ? 'Loading…' : 'No clients on file.',
        viewAllHref: '/app/clients/directory',
      },
      {
        id: 'area-money-30d', kind: 'area', title: 'Client money — 30-day trend', span: 2,
        description: 'Deposits and spending per day over the last 30 days. Draws nothing when the ledger is unreadable — a flat zero line would lie.',
        series: moneySeries,
      },
      {
        id: 'donut-ai-screening', kind: 'donut', title: 'AI screening — the class',
        description: 'The resume rubric’s strong / middle / weak split, plus the unscored tail.',
        slices: notas ? [
          { label: 'Strong', value: Number(notas.strong) || 0, tint: 'mint' },
          { label: 'Middle', value: Number(notas.middle) || 0, tint: 'amber' },
          { label: 'Weak', value: Number(notas.weak) || 0, tint: 'pink' },
          { label: 'Unscored', value: Number(notas.unscored) || 0, tint: 'lavender' },
        ] : [],
        centerLabel: notas?.average != null ? `avg ${notas.average}` : 'scores',
      },
      {
        id: 'bars-grade-mix', kind: 'bars', title: 'Staff grades — the mix',
        description: 'Non-terminated staff bucketed by the performance board’s grade.',
        bars: [
          { label: '9–10', value: gradeMix.top },
          { label: '7–8.9', value: gradeMix.good },
          { label: '5–6.9', value: gradeMix.mid },
          { label: 'under 5', value: gradeMix.low },
        ],
        empty: perfBroken ? 'The performance board is not readable from this session.'
          : perf === null ? 'Loading…' : undefined,
        viewAllHref: '/app/staff-performance/board',
      },
      {
        id: 'cat-stat-deposits', kind: 'stat', label: 'Deposits — 7 days',
        description: 'Money INTO client ledgers in the last 7 days.',
        value: num('financeTransactions', money(deposits7)), tint: 'mint', href: '/app/finance/portal',
      },
      {
        id: 'cat-stat-spending', kind: 'stat', label: 'Spending — 7 days',
        description: 'Money OUT of client ledgers in the last 7 days.',
        value: num('financeTransactions', money(spending7)), tint: 'peach', href: '/app/finance/portal',
      },
      {
        id: 'cat-donut-money', kind: 'donut', title: 'Money in vs out — 7 days',
        description: 'The week’s ledger movement as share-of-total: deposits against spending.',
        slices: [
          { label: 'Deposits', value: Math.round(deposits7), tint: 'mint' },
          { label: 'Spending', value: Math.round(spending7), tint: 'peach' },
        ],
        centerLabel: 'moved',
      },
      {
        id: 'cat-bars-incident-cats', kind: 'bars', title: 'Incidents by category — 7 days',
        description: 'The week’s UI/MUI reports grouped by category.',
        bars: incCatBars,
        empty: loading('uiIncidents') ? 'Loading…' : 'No reports filed this week.',
        viewAllHref: '/app/ui-incidents/log',
      },
      {
        id: 'cat-list-big-tx', kind: 'list', title: 'Biggest transactions — 7 days',
        description: 'The week’s largest ledger transactions by absolute amount.',
        empty: broken('financeTransactions') ? 'The ledger feed is not readable from this session.'
          : loading('financeTransactions') ? 'Loading…' : 'No transactions recorded this week.',
        items: bigTx.map((t) => ({
          title: clientTitle(t.client),
          meta: [money(Number(t.amount) || 0), ohioDayYear(String(t.date || ''))].filter(Boolean).join(' · '),
          icon: 'banknote', tint: ((Number(t.amount) || 0) >= 0 ? 'mint' : 'peach') as TintName,
        })),
        viewAllHref: '/app/finance/portal',
      },
      {
        id: 'cat-list-actions', kind: 'list', title: 'Latest platform actions',
        description: 'The most recent actions anyone ran on the platform.',
        empty: logsLoading ? 'Loading…' : logsBroken ? 'The platform log is not readable from this session.' : 'No activity recorded this week.',
        items: recentEvents.map((e) => ({
          title: e.summary || '—',
          meta: [e.actor_name, e.when].filter(Boolean).join(' · '),
          icon: 'activity', tint: (String(e.outcome).toLowerCase() === 'failed' ? 'amber' : 'blue') as TintName,
        })),
        viewAllHref: '/app/logs/feed',
      },
      {
        id: 'cat-stat-inc30', kind: 'stat', label: 'UI/MUI reports — 30 days',
        description: 'Incident reports filed in the last 30 days.',
        value: num('uiIncidents', inc30count), tint: 'amber', href: '/app/ui-incidents/log',
      },
      {
        id: 'cat-donut-incident-cats', kind: 'donut', title: 'Incident categories — share',
        description: 'The week’s incident categories drawn as share-of-total slices.',
        slices: incCatBars.slice(0, 6).map((b, i) => ({ label: b.label, value: b.value, tint: catTints[i % catTints.length] })),
        centerLabel: 'reports',
      },
    ]

    catalog.push(
      {
        id: 'cat-stat-tx-count', kind: 'stat', label: 'Transactions — 7 days',
        description: 'How many ledger transactions the week recorded.',
        value: num('financeTransactions', tx7.length), tint: 'blue', href: '/app/finance/portal',
      },
      {
        id: 'cat-bars-active-actors', kind: 'bars', title: 'Most active people — 7 days',
        description: 'Who ran the most platform actions this week.',
        bars: (() => {
          const mixA = new Map<string, number>()
          events.forEach((e) => {
            const who = String(e.actor_name || 'service')
            mixA.set(who, (mixA.get(who) ?? 0) + 1)
          })
          return [...mixA.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8)
        })(),
        empty: logsLoading ? 'Loading…' : logsBroken ? 'The platform log is not readable from this session.' : 'No activity recorded this week.',
        viewAllHref: '/app/logs/feed',
      },
    )

    /* READY-MADE BOARDS — same law as the Dashboard's. */
    const presets = [
      { id: 'the-company-week', title: 'The company week', blurb: 'People, performance, hiring, coverage, care and money — the new default face',
        on: widgets.map((w) => w.id) },
      { id: 'people-performance', title: 'People & performance', blurb: 'Grades, call-offs by name and type, certifications by name, anniversaries, anomalies and the flight-risk forecast',
        on: ['stat-staff', 'stat-grade', 'stat-anomalies', 'stat-wow-calloffs', 'list-perf-attention', 'list-calloff-names', 'donut-calloff-types', 'list-certs-expiring-named', 'list-anniversaries', 'donut-certs', 'area-calloffs', 'bars-grade-mix', 'list-flight-risk'] },
      { id: 'hiring-funnel', title: 'Hiring funnel', blurb: 'Every stage, the blockers with their owners, the longest waits and the contract book',
        on: ['stat-hiring', 'bars-hiring-funnel', 'bars-hiring-blockers', 'list-hiring-stuck', 'donut-contracts', 'donut-ai-screening'] },
      { id: 'coverage-today', title: 'Coverage today', blurb: 'Who is working, which houses have nobody, and where the clients are',
        on: ['stat-coverage', 'list-on-duty-today', 'list-coverage-gaps', 'bars-census-by-house', 'bars-incidents-by-house'] },
      { id: 'whole-week', title: 'The whole week', blurb: 'Everything this board can draw, all at once',
        on: [...widgets.map((w) => w.id), ...catalog.map((c) => c.id)] },
      { id: 'money-week', title: 'Money week', blurb: 'Deposits, spending, movers and the biggest transactions',
        on: ['stat-money', 'cat-stat-deposits', 'cat-stat-spending', 'cat-stat-tx-count', 'cat-donut-money', 'cat-list-big-tx', 'money-movers'] },
      { id: 'safety', title: 'Safety & incidents', blurb: 'Deaths flag, reports, the 30-day trend and appointments — the care lane',
        on: ['deaths-flag', 'incidents-week', 'area-incidents', 'cat-bars-incident-cats', 'cat-donut-incident-cats', 'cat-stat-inc30', 'dr-week'] },
      { id: 'platform-ops', title: 'Platform ops', blurb: 'Apps, actions, failures and who is acting — the IT lane, now opt-in',
        on: ['stat-apps', 'stat-actions', 'apps-changed', 'activity-areas', 'failures-week', 'cat-list-actions', 'cat-bars-active-actors'] },
      { id: 'executive-minimal', title: 'Executive minimal', blurb: 'Six headline numbers and the deaths flag',
        on: ['stat-staff', 'stat-clients', 'stat-grade', 'stat-hiring', 'stat-money', 'stat-coverage', 'deaths-flag'] },
    ]

    return { widgets, catalog, presets }
  }, [feeds, failed, logs, perf, recon, reconShut, analysis, matrix, triage, forecast, certsOwnOnly])

  const schema = useMemo<PageSchema>(
    () => ({
      id: 'overview', type: 'dashboard', title: 'Leadership Board', icon: 'briefcase',
      dataSource: { resource: 'activity' },
      config: {},
    }),
    [],
  )

  return (
    <div>
      {failed.length > 0 && (
        <p className="mb-3 rounded-md bg-tint-pink/40 px-3 py-2 text-[12.5px] text-text-1">
          Could not load: {failed.join(', ')} — those widgets say so in place until the connection recovers.
        </p>
      )}
      <DashboardTemplate
        config={{ title: 'Leadership Board', widgets: board.widgets, catalog: board.catalog, presets: board.presets }}
        data={[]}
        schema={schema}
      />
    </div>
  )
}
