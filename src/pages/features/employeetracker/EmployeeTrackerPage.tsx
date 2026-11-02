// EMPLOYEE TRACKER — the employee-docs tracker of the old platform's app pages/HelpTracker.tsx, kind…
// the old platform screen answered "what does the sheet hold?" This one answers the question underneath it: "for…
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight, GraduationCap,
  HeartPulse, Loader2, PenLine, RefreshCw, Search, ShieldCheck, TrendingUp, X,
} from 'lucide-react'
import ScreenSwitcher from '@/pages/features/employeetracker/ScreenSwitcher'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Pager from '@/components/shared/Pager'
import { usePager } from '@/lib/pager'
import { api } from '@/lib/api'
import {
  fetchIstConfig, certScreenColumns, certStateTints, cfgTints, istRowOwed, IST_CONFIG_FALLBACK,
  IST_STATUS_DONE, IST_STATUS_OWED, TINT_CHIP,
  type CertScreenColumn, type IstConfig,
} from '@/lib/istConfig'
import { gasAction } from '@/features/hiring/shared'
import { TRACKER_VIEWS, nameFold, trackerRowsOf, type TrackerAnswer } from '@/lib/certUploads'
import { useAuthStore } from '@/auth/useAuthStore'
import { cachedUsers, fetchUsers, findAccountByName } from '@/lib/usersDirectory'
import { toast } from '@/stores/useToastStore'
import { SummaryStrip } from '@/engine/templates/sheet/SummaryStrip'
import type { SummaryStripConfig } from '@/engine/templates/sheet/types'
import { cn } from '@/lib/utils'

/* ── the row shapes, as the resources hold them ── */
type MatrixCert = { certId?: string; certName?: string; status?: string; expiresAt?: string | null }
type MatrixRow = {
  id?: string
  name?: string
  avatar?: string
  role?: string
  department?: string
  certs?: MatrixCert[]
  // THE EIGHT COLUMNS AS THE SHEET ACTUALLY HOLDS THEM.
  dodd?: string
  cpr?: string
  med1?: string
  med2?: string
  med3?: string
  mais?: string
  money?: string
  mandt?: string
  attention?: number
}
type CertRow = {
  personName?: string
  certId?: string
  certName?: string
  status?: string
  issuedAt?: string | null
  expiresAt?: string | null
}
type IstRow = {
  staffName?: string
  clientName?: string
  house?: string
  status?: string
  dueDate?: string
  certNote?: string
  trainedAt?: string
}
type AckRow = {
  policy?: string
  version?: string
  staff?: string
  status?: string
  signedAt?: string | null
  effectiveDate?: string
}
type EngineRow = {
  person_name?: string
  req_id?: string
  state?: string
  expires?: string
  days_left?: string
}
/** requirementStatesList's answer: 'own' = only the caller's rows (RequirementStates.gs), keyed by the roster name in `self` */
type EngineAnswer = { rows?: EngineRow[]; scope?: string; self?: string }
// The staffPerfList board row (StaffPerformance.gs) — same shape as StaffPerformancePage's BoardRow.
type PerfRow = {
  emp_id?: string
  name?: string
  status?: string
  hire_date?: string
  attendance_90d?: number
  attendance_all?: number
  incidents?: number
  incidents_major?: number
  grade?: number
}

// THE NOTA'S COLOUR — the performance app's one rule, verbatim: 8+ mint, 6+ amber, under 6 pink.
const gradeCls = (g?: number) =>
  g === undefined || !Number.isFinite(g) ? 'bg-surface-2 text-text-3'
  : g >= 8 ? 'bg-tint-mint text-tint-fg-mint'
  : g >= 6 ? 'bg-tint-amber text-tint-fg-amber'
  : 'bg-tint-pink text-tint-fg-pink'

type Overall = 'clear' | 'attention' | 'action'

const norm = (s?: string) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
}

const OVERALL_STYLE: Record<Overall, { label: string; cls: string }> = {
  clear: { label: 'Clear', cls: 'bg-tint-mint text-tint-fg-mint' },
  attention: { label: 'Attention', cls: 'bg-tint-amber text-tint-fg-amber' },
  action: { label: 'Action needed', cls: 'bg-tint-pink text-tint-fg-pink' },
}

/** Another person's rows, answered to a caller who reads only their own (`self` = the roster name they are keyed by). */
const isPrivateTo = (self: string | null, name: string) => self !== null && nameFold(name) !== nameFold(self)
const ENGINE_PRIVATE = 'Another person’s compliance engine states are private to them'
const OVERALL_PRIVATE = 'Not known here — another person’s certifications and engine states are private to them'

const CERT_STYLE: Record<string, string> = {
  valid: 'bg-tint-mint text-tint-fg-mint',
  expiring: 'bg-tint-amber text-tint-fg-amber',
  expired: 'bg-tint-pink text-tint-fg-pink',
  missing: 'bg-surface-2 text-text-3',
}
/** The IST settings every row paints with; the page provides the copy it read. */
const IstCfgContext = createContext<IstConfig>(IST_CONFIG_FALLBACK)

// THE PAGE'S LOOK, AS THE IST SETTINGS SAY IT: certification chips (an edited `ist_cert_status_tints` colour wins…
export function istLook(cfg: IstConfig) {
  const cert = certStateTints(cfg, CERT_STYLE, (t) => TINT_CHIP[t] ?? CERT_STYLE.missing)
  const ist = cfgTints(cfg, 'ist_status_tints')
  const tintOf = (status?: string) => ist[String(status ?? '').trim().toLowerCase()] ?? ''
  return {
    certCls: (s?: string) => cert[s ?? ''] ?? 'bg-surface-2 text-text-3',
    istCls: (status?: string) => TINT_CHIP[tintOf(status)] ?? 'bg-surface-2 text-text-3',
    istSoft: (status?: string) => TINT_SOFT[tintOf(status)] ?? 'bg-surface-2 text-text-3',
    owed: (r: IstRow) => istRowOwed(r, cfg),
  }
}

/** The house chips' lighter wash of each platform colour (static, so the stylesheet keeps them). */
const TINT_SOFT: Record<string, string> = {
  mint: 'bg-tint-mint/60 text-tint-fg-mint',
  peach: 'bg-tint-peach/60 text-tint-fg-peach',
  lavender: 'bg-tint-lavender/60 text-tint-fg-lavender',
  pink: 'bg-tint-pink/60 text-tint-fg-pink',
  blue: 'bg-tint-blue/60 text-tint-fg-blue',
  amber: 'bg-tint-amber/60 text-tint-fg-amber',
  green: 'bg-tint-green/60 text-tint-fg-green',
}
const useIstLook = () => {
  const cfg = useContext(IstCfgContext)
  return useMemo(() => istLook(cfg), [cfg])
}

const ACK_STYLE: Record<string, string> = {
  signed: 'bg-tint-mint text-tint-fg-mint',
  pending: 'bg-tint-amber text-tint-fg-amber',
  overdue: 'bg-tint-pink text-tint-fg-pink',
}
const ackCls = (s?: string) => ACK_STYLE[(s ?? '').toLowerCase()] ?? 'bg-surface-2 text-text-3'

const ENGINE_STYLE: Record<string, string> = {
  ok: 'bg-tint-mint text-tint-fg-mint',
  expiring: 'bg-tint-amber text-tint-fg-amber',
  expired: 'bg-tint-pink text-tint-fg-pink',
  missing: 'bg-tint-blue text-tint-fg-blue',
  na: 'bg-surface-2 text-text-3',
}
const engineCls = (s?: string) => ENGINE_STYLE[s ?? ''] ?? 'bg-surface-2 text-text-3'

/** One employee, everything the union knows about them. */
type Person = {
  key: string
  name: string
  role: string
  avatar: string
  certs: { id: string; name: string; status: string; expiresAt: string | null }[]
  ist: IstRow[]
  acks: AckRow[]
  engine: EngineRow[]
  perf?: PerfRow
  overall: Overall
}

/** The worst open item colours the person — pink beats amber beats mint. */
function overallOf(p: Omit<Person, 'overall'>, owed: (r: IstRow) => boolean): Overall {
  if (
    p.certs.some((c) => c.status === 'expired' || c.status === 'missing') ||
    p.acks.some((a) => (a.status ?? '').toLowerCase() === 'overdue') ||
    p.engine.some((e) => e.state === 'expired')
  ) return 'action'
  if (
    p.certs.some((c) => c.status === 'expiring') ||
    p.ist.some(owed) ||
    p.acks.some((a) => (a.status ?? '').toLowerCase() === 'pending') ||
    p.engine.some((e) => e.state === 'expiring' || e.state === 'missing')
  ) return 'attention'
  return 'clear'
}

/* ── the Documents Matrix, as complianceMatrix answers it ── */
type DocItem = { id: string; label: string; source?: string }
type DocEmployee = { name?: string; cells?: Record<string, { state?: string; text?: string }> }
type DocAnswer = {
  items?: DocItem[]
  employees?: DocEmployee[]
  total?: number
  unreadableItems?: string[]
  /** 'own' = only the caller's row answered (Compliance.gs), keyed by the roster name in `self` */
  scope?: string
  self?: string
}

/** The six words `complianceMatrix` answers with, dressed as Compliance dresses them. */
const DOC_CELL_TINT: Record<string, string> = {
  ok: 'bg-tint-mint text-tint-fg-mint',
  warning: 'bg-tint-amber text-tint-fg-amber',
  missing: 'bg-tint-pink text-tint-fg-pink',
  na: 'bg-surface-2 text-text-3',
  blank: 'bg-surface-2 text-text-3',
  other: 'bg-surface-2 text-text-3',
}

/* ══════════════════ THE ENGINE AS A SECOND WITNESS ══════════════════ */

// COMPARE THE TWO AND SAY WHETHER THEY MATCH.

/** The three vocabularies, flattened to the one they can be compared in. */
function sameState(raw?: string): string {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return ''
  // the matrix says `valid`, the engine says `ok`, the documents matrix says `ok` too; `warning` is the documents…
  if (s === 'valid' || s === 'ok') return 'ok'
  if (s === 'warning' || s === 'expiring') return 'expiring'
  if (s === 'expired') return 'expired'
  if (s === 'missing') return 'missing'
  if (s === 'na') return 'na'
  // `blank`, `other`, and anything a source grows later: NOT a state.
  return ''
}

type Disagreement = { id: string; label: string; sheet: string; engine: string }
type MatchResult = {
  compared: number
  agree: number
  disagree: Disagreement[]
  // ITEMS THE TABLE DRAWS AND THE ENGINE HAS NO STATE FOR — they are marked missing.
  missing: { id: string; label: string; sheet: string }[]
}

// Compare, item by item, only where BOTH sides actually said something.
function compareWitnesses(
  engineStates: Map<string, string>,
  mx: MatrixLine | undefined,
  docItems: DocItem[],
  doc: Record<string, { state?: string; text?: string }> | undefined,
  // The course columns as the `ist_config` tab leaves them — the same list the table draws, so the comparison…
  cols: readonly CertScreenColumn[] = MATRIX_COLS,
): MatchResult {
  const out: MatchResult = { compared: 0, agree: 0, disagree: [], missing: [] }
  if (!engineStates.size) return out
  const check = (id: string, label: string, rawSheet?: string) => {
    const sheet = sameState(rawSheet)
    // The SHEET is the side that decides whether an item is on this screen at all.
    if (!sheet) return
    const engine = sameState(engineStates.get(id))
    if (!engine) { out.missing.push({ id, label, sheet }); return }
    out.compared++
    if (sheet === engine) out.agree++
    else out.disagree.push({ id, label, sheet, engine })
  }
  for (const c of cols) check(c.certId.replace(/^cert-/, ''), c.label, mx?.cells[c.key])
  for (const it of docItems) check(it.id, it.label, doc?.[it.id]?.state)
  return out
}

const FILTERS: { id: '' | Overall; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'action', label: 'Action needed' },
  { id: 'attention', label: 'Attention' },
  { id: 'clear', label: 'Clear' },
]

export default function EmployeeTrackerPage() {
  const [matrix, setMatrix] = useState<MatrixRow[]>([])
  const [certs, setCerts] = useState<CertRow[]>([])
  const [ist, setIst] = useState<IstRow[]>([])
  const [acks, setAcks] = useState<AckRow[]>([])
  const [engine, setEngine] = useState<EngineRow[]>([])
  const [perf, setPerf] = useState<PerfRow[]>([])
  /** The Documents Matrix: its column list, and one row per person. */
  const [docItems, setDocItems] = useState<DocItem[]>([])
  const [docRows, setDocRows] = useState<DocEmployee[]>([])
  /** Items whose Master column the server could not read — named, never hidden. */
  const [docUnreadable, setDocUnreadable] = useState<string[]>([])
  // WHOSE CERTIFICATES AND DOCUMENTS ANSWERED.
  const [certSelf, setCertSelf] = useState<string | null>(null)
  const [docSelf, setDocSelf] = useState<string | null>(null)
  /** the same for the compliance engine's states (RequirementStates.gs requirementStatesList) */
  const [engineSelf, setEngineSelf] = useState<string | null>(null)
  // THE COURSE COLUMNS' OWN SETTINGS (`ist_config`).
  const [istCfg, setIstCfg] = useState<IstConfig | null>(null)
  /* which resources answered — a silent gap is a lie of omission */
  const [failed, setFailed] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'' | Overall>('')
  const [who, setWho] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  // ProfilePage refuses anyone but an admin (a hard Navigate to /apps), so the question here is the same question…
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')

  // THE NAME AND THE INITIALS OPEN THE PERSON — pressing either goes straight to the profile, and it is the…
  const openProfile = useCallback(async (p: Person, onMiss: () => void) => {
    if (!isAdmin) { onMiss(); return }
    const seed = cachedUsers()
    let found = seed ? findAccountByName(seed, p.name) : null
    if (!found) {
      try { found = findAccountByName(await fetchUsers(), p.name) } catch { found = null }
    }
    if (!found?.id) { onMiss(); return }
    // `from` is how ProfilePage's Back comes back HERE instead of falling to the accounts list — the same state…
    navigate(`/app/users/profile?u=${encodeURIComponent(found.id)}`,
             { state: { from: location.pathname + location.search } })
  }, [isAdmin, navigate, location])

  // The same click, from inside the panel, cannot fall back to OPENING the panel — it is already open, and a button…
  const missFromDrawer = useCallback((name: string) => () => {
    toast(isAdmin
      ? { type: 'warning', title: `${name} has no platform account`,
          body: 'Only people who sign in to asa. have a profile here. An admin can invite them in Settings → Users.' }
      : { type: 'warning', title: 'The profile is admin-only',
          body: 'Everything this record holds is on this panel; the full staff profile opens for admins.' })
  }, [isAdmin])

  const load = useCallback(async () => {
    setLoading(true)
    setFailed([])
    const miss: string[] = []
    const pull = async <T,>(resource: string, set: (rows: T[]) => void) => {
      try {
        const r = await api.list<T>(resource as never)
        set(Array.isArray(r) ? r : [])
      } catch {
        // degrade honestly: the section says the source did not answer
        miss.push(resource)
        set([])
      }
    }
    // the tracker through the door that knows who is asking; an own answer names whose rows it holds
    let trackerSelf: string | null = null
    let docsSelf: string | null = null
    let statesSelf: string | null = null
    const track = async <T,>(resource: 'certMatrix' | 'staffCerts', set: (rows: T[]) => void) => {
      try {
        const got = await gasAction<TrackerAnswer>('certTrackerList', { view: TRACKER_VIEWS[resource] })
        set(trackerRowsOf(got) as T[])
        if (got?.scope === 'own') trackerSelf = String(got.self ?? '')
      } catch {
        miss.push(resource)
        set([])
      }
    }
    await Promise.all([
      track<MatrixRow>('certMatrix', setMatrix),
      track<CertRow>('staffCerts', setCerts),
      pull<IstRow>('istRecords', setIst),
      pull<AckRow>('policyAcks', setAcks),
      // THE ENGINE'S STATES ARE AN ACTION, NOT A RESOURCE.
      gasAction<EngineAnswer>('requirementStatesList', { limit: 2000 })
        .then((d) => {
          setEngine(Array.isArray(d?.rows) ? d.rows : [])
          if (d?.scope === 'own') statesSelf = String(d.self ?? '')
        })
        .catch(() => { miss.push('requirementStatesList (engine)'); setEngine([]) }),
      // the performance board is an action, not a resource — same honesty: a refusal is named, never read as "no…
      gasAction<{ rows?: PerfRow[] }>('staffPerfList', {}, { timeoutMs: 120000 })
        .then((d) => setPerf(Array.isArray(d?.rows) ? d.rows : []))
        .catch(() => { miss.push('staffPerfList (performance)'); setPerf([]) }),
      // THE DOCUMENTS MATRIX, and the one read on this screen that PAGES.
      (async () => {
        const PAGE = 200
        const PAGE_CAP = 6
        try {
          const first = await gasAction<DocAnswer>('complianceMatrix',
            { tab: 'documents', limit: PAGE, offset: 0 }, { timeoutMs: 120000 })
          const rows = [...(first?.employees ?? [])]
          const total = Number(first?.total ?? rows.length)
          for (let page = 1; page < PAGE_CAP && rows.length < total; page++) {
            const next = await gasAction<DocAnswer>('complianceMatrix',
              { tab: 'documents', limit: PAGE, offset: page * PAGE }, { timeoutMs: 120000 })
            const got = next?.employees ?? []
            if (!got.length) break   // the server has no more to give; believe it
            rows.push(...got)
          }
          setDocItems(first?.items ?? [])
          setDocRows(rows)
          setDocUnreadable(first?.unreadableItems ?? [])
          if (first?.scope === 'own') docsSelf = String(first.self ?? '')
        } catch {
          miss.push('complianceMatrix (documents)')
          setDocItems([]); setDocRows([]); setDocUnreadable([])
        }
      })(),
    ])
    setCertSelf(trackerSelf)
    setDocSelf(docsSelf)
    setEngineSelf(statesSelf)
    setFailed(miss)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // THE COURSE COLUMNS' SETTINGS, read once per mount and NOT part of `load`.
  useEffect(() => {
    void fetchIstConfig().then(setIstCfg).catch(() => setIstCfg(IST_CONFIG_FALLBACK))
  }, [])

  // The eight course columns as the tab leaves them: same keys the backend computes, same order, the screen's own…
  const matrixCols = useMemo<readonly CertScreenColumn[]>(
    () => (istCfg ? certScreenColumns(MATRIX_COLS, istCfg) : MATRIX_COLS),
    [istCfg],
  )
  const look = useMemo(() => istLook(istCfg ?? IST_CONFIG_FALLBACK), [istCfg])

  /* ── the union: one Person per name, from whichever resources named them ── */
  const people = useMemo<Person[]>(() => {
    const byKey = new Map<string, Omit<Person, 'overall'>>()
    const slot = (rawName?: string) => {
      const name = (rawName ?? '').trim()
      if (!name) return null
      const key = norm(name)
      let p = byKey.get(key)
      if (!p) {
        p = { key, name, role: '', avatar: '', certs: [], ist: [], acks: [], engine: [] }
        byKey.set(key, p)
      }
      return p
    }
    // the roster spine — every active person appears even with no open item
    for (const m of matrix) {
      const p = slot(m.name)
      if (!p) continue
      p.role = m.role ?? p.role
      p.avatar = m.avatar ?? p.avatar
    }
    for (const c of certs) {
      const p = slot(c.personName)
      if (p && c.certName) p.certs.push({ id: c.certId ?? '', name: c.certName, status: c.status ?? '', expiresAt: c.expiresAt ?? null })
    }
    for (const i of ist) { const p = slot(i.staffName); if (p) p.ist.push(i) }
    for (const a of acks) { const p = slot(a.staff); if (p) p.acks.push(a) }
    for (const e of engine) { const p = slot(e.person_name); if (p) p.engine.push(e) }
    // the performance board names people too — one board row per name
    for (const r of perf) { const p = slot(r.name); if (p) p.perf = r }
    // fall back to the matrix's 8 cert statuses where the ledger held nothing
    for (const m of matrix) {
      const p = slot(m.name)
      if (p && !p.certs.length && m.certs?.length) {
        p.certs = m.certs
          .filter((c) => c.certName)
          .map((c) => ({ id: c.certId ?? '', name: c.certName!, status: c.status ?? '', expiresAt: c.expiresAt ?? null }))
      }
    }
    // CURRENT EMPLOYEES FIRST, and the ledger-only tail last — any further people are appended at the end.
    const onSheet = new Set(matrix.map((m) => norm(m.name)).filter(Boolean))
    return [...byKey.values()]
      .map((p) => ({ ...p, overall: overallOf(p, look.owed) }))
      .sort((a, b) => {
        const cur = (x: { key: string }) => (onSheet.has(x.key) ? 0 : 1)
        const rank = (o: Overall) => (o === 'action' ? 0 : o === 'attention' ? 1 : 2)
        return cur(a) - cur(b) || rank(a.overall) - rank(b.overall) || a.name.localeCompare(b.name)
      })
  }, [matrix, certs, ist, acks, engine, perf, look])

  // THE MATRIX LINES — the sheet's own rows first, then everyone the ledger names that the sheet does not.
  const currentKeys = useMemo(() => {
    const set = new Set<string>()
    for (const m of matrix) { const n = norm(m.name); if (n) set.add(n) }
    return set
  }, [matrix])

  // THE MATRIX CELLS, keyed by person, for the nine columns on the right.
  const matrixByKey = useMemo(() => {
    const onSheet = new Map<string, MatrixRow>()
    for (const m of matrix) { const n = norm(m.name); if (n) onSheet.set(n, m) }
    const out = new Map<string, MatrixLine>()
    for (const p of people) {
      const m = onSheet.get(p.key)
      const cells: Record<string, string> = {}
      if (m) {
        for (const c of matrixCols) cells[c.key] = String((m as Record<string, unknown>)[c.key] ?? '')
      } else {
        for (const c of p.certs) if (c.id) cells[c.id.replace(/^cert-/, '')] = c.status
      }
      out.set(p.key, {
        cells,
        // the sheet's own count of non-valid columns; null for a rebuilt row, because deriving one from a different…
        attention: m && Number.isFinite(m.attention) ? Number(m.attention) : null,
        onMatrix: !!m,
      })
    }
    return out
  }, [matrix, people, matrixCols])

  // THE DOCUMENTS CELLS, keyed the way every other join on this screen is keyed — the normalized display name…
  const docByKey = useMemo(() => {
    const out = new Map<string, Record<string, { state?: string; text?: string }>>()
    for (const e of docRows) {
      const n = norm(e.name)
      if (n) out.set(n, e.cells ?? {})
    }
    return out
  }, [docRows])

  // The engine's states, keyed person → requirement.
  const engineByKey = useMemo(() => {
    const out = new Map<string, Map<string, string>>()
    for (const e of engine) {
      const n = norm(e.person_name)
      const req = String(e.req_id ?? '').trim()
      if (!n || !req) continue
      let m = out.get(n)
      if (!m) { m = new Map(); out.set(n, m) }
      m.set(req, String(e.state ?? ''))
    }
    return out
  }, [engine])

  // WHOSE OVERALL CAN BE TOLD.
  const ownScope = certSelf !== null || engineSelf !== null
  const overallHidden = useCallback(
    (p: { name: string }) => isPrivateTo(certSelf, p.name) || isPrivateTo(engineSelf, p.name),
    [certSelf, engineSelf],
  )

  const counts = useMemo(() => {
    const c = { clear: 0, attention: 0, action: 0 }
    for (const p of people) if (!overallHidden(p)) c[p.overall]++
    return c
  }, [people, overallHidden])

  // THE OPEN-ITEMS STRIP — there is room at the top for more indicators.
  const stripConfig = useMemo<SummaryStripConfig>(() => {
    const dead = (...names: string[]) => names.every((n) => failed.includes(n))
    // a count over everyone cannot be made from an own answer: the banner above the table says why
    const expiring = dead('staffCerts', 'certMatrix') || certSelf !== null
      ? '—'
      : people.filter((p) => p.certs.some((c) => c.status === 'expiring')).length
    const owed = ist.filter(look.owed)
    const istVal = failed.includes('istRecords')
      ? '—'
      : `${owed.length} across ${new Set(owed.map((i) => norm(i.staffName))).size} people`
    const overdue = acks.filter((a) => (a.status ?? '').toLowerCase() === 'overdue').length
    const pendingSig = acks.filter((a) => (a.status ?? '').toLowerCase() === 'pending').length
    const sigVal = failed.includes('policyAcks') ? '—' : `${overdue} overdue · ${pendingSig} pending`
    let missCells = 0
    const missPeople = new Set<string>()
    for (const e of docRows) {
      for (const it of docItems) {
        if (e.cells?.[it.id]?.state === 'missing') { missCells++; missPeople.add(e.name ?? '') }
      }
    }
    const docVal = failed.includes('complianceMatrix (documents)') || docSelf !== null
      ? '—'
      : `${missCells} across ${missPeople.size} people`
    // the page's own headline finding, promoted to a number: people where the engine contradicts the sheet on at…
    const disagree = failed.includes('requirementStatesList (engine)') || engine.length === 0 || engineSelf !== null
      ? '—'
      : people.filter((p) =>
          compareWitnesses(
            engineByKey.get(p.key) ?? new Map(),
            matrixByKey.get(p.key),
            docItems,
            docByKey.get(p.key),
            matrixCols,
          ).disagree.length > 0,
        ).length
    return {
      title: 'Open items',
      icon: 'activity',
      tint: 'blue',
      items: [
        { label: 'Expiring soon', icon: 'clock', tint: 'amber', value: expiring },
        { label: 'IST owed', icon: 'graduation-cap', tint: 'amber', value: istVal },
        { label: 'Signatures open', icon: 'pen-line', tint: overdue > 0 ? 'pink' : 'amber', value: sigVal },
        { label: 'Missing documents', icon: 'file-x', tint: 'pink', value: docVal },
        { label: 'Witnesses disagree', icon: 'git-compare', tint: 'pink', value: disagree },
      ],
    }
  }, [people, ist, acks, docRows, docItems, engine, failed, engineByKey, matrixByKey, docByKey, matrixCols, look, certSelf, docSelf, engineSelf])

  const visible = useMemo(() => {
    let out = people
    if (filter) out = out.filter((p) => p.overall === filter && !overallHidden(p))
    const n = norm(q)
    if (n) out = out.filter((p) => norm(`${p.name} ${p.role}`).includes(n))
    return out
  }, [people, filter, q, overallHidden])

  // FIFTY AT A TIME.
  const pager = usePager(visible, 50, `${filter}|${norm(q)}`)

  const open = who ? people.find((p) => p.key === who) ?? null : null

  return (
    <IstCfgContext.Provider value={istCfg ?? IST_CONFIG_FALLBACK}>
    <div className="w-full">
      <PageHeader
        title="Employee tracker"
        subtitle="Certifications, IST obligations and policy signatures — one row per employee, coloured by the worst open item"
        actions={
          // REFRESH ON THE LEFT, THE SWITCHER ON THE RIGHT.
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Refresh
            </button>
            <ScreenSwitcher />
          </div>
        }
      />

      {/* the source line — what fed this screen, and what could not be read */}
      <p className="-mt-2 mb-4 text-[11.5px] text-text-3">
        {matrix.length} matrix rows · {certs.length} cert records · {ist.length} IST records · {acks.length} signatures · {engine.length} engine states · {perf.length} performance rows · {docRows.length} document rows
        {docUnreadable.length > 0 && (
          // The server distinguishes an item whose Master column it could not read from one that is genuinely empty.
          <span className="text-tint-fg-amber">
            {' '}— unreadable document columns: {docUnreadable.join(', ')}
          </span>
        )}
        {failed.length > 0 && (
          <span className="text-tint-fg-amber"> — could not be read: {failed.join(', ')} (those columns are blank, not clear)</span>
        )}
        {istCfg?.blind && (
          // THE COURSE COLUMNS ARE NOT THE ONES IN THE TAB.
          <span className="text-tint-fg-amber">
            {' '}— the {istCfg.tab} settings could not be read, so the certification columns are
            the ones this screen ships with; every status below is still the real one
          </span>
        )}
      </p>

      {/* headline tiles — the fifth is the matrix's own
          pink threshold promoted to a number: people owing 5+ requirements */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile icon={<ShieldCheck size={15} className="text-tint-fg-blue" />} tint="bg-tint-blue" label="Employees tracked" value={people.length} />
        {/* an overall over everyone cannot be made from own answers: the banner below the strip says why */}
        <Tile icon={<CheckCircle2 size={15} className="text-tint-fg-mint" />} tint="bg-tint-mint" label="Clear" value={ownScope ? '—' : counts.clear} />
        <Tile icon={<AlertTriangle size={15} className="text-tint-fg-amber" />} tint="bg-tint-amber" label="Attention" value={ownScope ? '—' : counts.attention} />
        <Tile icon={<AlertTriangle size={15} className="text-tint-fg-pink" />} tint="bg-tint-pink" label="Action needed" value={ownScope ? '—' : counts.action} />
        <Tile
          icon={<AlertTriangle size={15} className="text-tint-fg-pink" />}
          tint="bg-tint-pink"
          label="Owing 5+ items"
          value={failed.includes('certMatrix') || certSelf !== null ? '—' : matrix.filter((m) => Number(m.attention) >= 5).length}
        />
      </div>

      {/* the open-items strip — five numbers already in memory, see stripConfig */}
      <div className="mt-3">
        <SummaryStrip summaryStrip={stripConfig} data={people} />
      </div>

      {(certSelf !== null || docSelf !== null || engineSelf !== null) && (
        <p className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
          The certifications, documents and compliance engine states on this screen are your own
          {certSelf || docSelf || engineSelf ? ` (${certSelf || docSelf || engineSelf})` : ''} — every other
          person&apos;s are private to them, so their cells and their overall show a dash and the counts over
          everyone are not drawn.
        </p>
      )}

      {/* filters + search */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id || 'all'}
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
              filter === f.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-surface text-text-3 hover:text-text-1',
            )}
          >
            {f.label}{f.id ? ` (${ownScope ? '—' : counts[f.id]})` : ` (${people.length})`}
          </button>
        ))}
        <span className="ml-auto flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3">
          <Search size={13} className="text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search employees…"
            className="w-44 bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3"
          />
        </span>
      </div>

      {/* THE RING IS A LEGEND, and a legend nobody can see is decoration. It
          sits with the first table because that is where the first set of
          initials appears; the matrix band below repeats it in its own colours. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-text-3">
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-full bg-surface-2 ring-2 ring-emerald-400 ring-offset-2 ring-offset-bg" />
          <span className="font-semibold text-text-2">{currentKeys.size}</span> current employees — carried by the compliance matrix
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-full bg-surface-2 ring-2 ring-tint-fg-blue ring-offset-2 ring-offset-bg" />
          <span className="font-semibold text-text-2">{Math.max(0, people.length - currentKeys.size)}</span> named by the ledger only — leavers and history the sheet never deleted
        </span>
      </div>

      {/* the roster */}
      <Card padded={false} className="mt-2">
        {loading && !people.length ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12px] text-text-3">
            <Loader2 size={13} className="animate-spin" /> Reading the roster…
          </div>
        ) : !visible.length ? (
          <EmptyState
            title={people.length ? 'Nobody matches' : 'No employees on file'}
            body={
              people.length
                ? 'Adjust the search or the state filter.'
                : failed.length === 7
                  ? 'None of the data sources answered — the roster is unknown, not empty.'
                  : 'The certification matrix holds no active people yet.'
            }
          />
        ) : (
          // THE ROSTER SCROLLS INSIDE ITSELF — the section below it was unfindable, and rightly so: the union names…
          <DoubleScroll>
            <table className="w-full min-w-[2200px] border-collapse text-[12.5px]">
              <thead className="sticky top-0 z-[3]">
                {/* the group row — the two things this table joins, named */}
                <tr className="border-b border-border bg-surface-2 text-left text-[10.5px] font-bold uppercase tracking-[0.12em]">
                  <th rowSpan={2} className="sticky left-0 z-[1] border-r border-border bg-surface-2 px-3 py-2 align-bottom text-text-3">Employee</th>
                  <th colSpan={6} className="border-r border-border px-3 pb-1 pt-2 text-text-3">Employee tracker</th>
                  {/* the course columns plus "Needs attention" — counted, not
                      typed, because the course list is a cell now */}
                  <th colSpan={matrixCols.length + 1} className="border-r border-border px-3 pb-1 pt-2 text-tint-fg-blue">Compliance Matrix</th>
                  {docItems.length > 0 && (
                    <th colSpan={docItems.length} className="px-3 pb-1 pt-2 text-tint-fg-lavender">Documents Matrix</th>
                  )}
                  <th rowSpan={2} className="px-3 py-2" />
                </tr>
                <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">
                  <th className="px-3 pb-2">Certifications</th>
                  <th className="px-3 pb-2">IST</th>
                  <th className="px-3 pb-2">Policies</th>
                  <th className="px-3 pb-2">Engine</th>
                  <th className="px-3 pb-2">Performance</th>
                  <th className="border-r border-border px-3 pb-2">Overall</th>
                  {matrixCols.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 pb-2 text-center">{c.label}</th>
                  ))}
                  <th className={cn('whitespace-nowrap px-3 pb-2 text-right', docItems.length > 0 && 'border-r border-border')}>Needs attention</th>
                  {docItems.map((it) => (
                    <th key={it.id} title={it.source} className="whitespace-nowrap px-3 pb-2 text-center">{it.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pager.slice.map((p) => (
                  <PersonRow
                    key={p.key}
                    person={p}
                    current={currentKeys.has(p.key)}
                    mx={matrixByKey.get(p.key)}
                    matrixCols={matrixCols}
                    docItems={docItems}
                    doc={docByKey.get(p.key)}
                    certPrivate={certSelf !== null && nameFold(p.name) !== nameFold(certSelf)}
                    docPrivate={docSelf !== null && nameFold(p.name) !== nameFold(docSelf)}
                    enginePrivate={isPrivateTo(engineSelf, p.name)}
                    overallPrivate={overallHidden(p)}
                    docUnread={failed.includes('complianceMatrix (documents)')}
                    states={engineByKey.get(p.key)}
                    onOpen={() => setWho(p.key)}
                    onProfile={() => void openProfile(p, () => setWho(p.key))}
                  />
                ))}
              </tbody>
            </table>
          </DoubleScroll>
        )}
      </Card>

      {/* Under the card, not inside it: the table scrolls in its own box, and a
          control that scrolled away with the rows would be a control nobody
          reaches on the page it is needed. <Pager/> draws nothing at all when
          everything fits on one page. */}
      <Pager
        className="mt-3"
        page={pager.page}
        pages={pager.pages}
        from={pager.from}
        to={pager.to}
        total={pager.total}
        onPage={pager.setPage}
        noun="people"
      />

      {/* STAFF ISSUES — the live HR tracker (kill list 6). A
          section of THIS screen, not a rung: the roster above already answers
          "is the paperwork in order" per person, and this is the row-level
          record behind the incident counts those rows wear. Read-only — the
          estate's sheet is the writer (see the section's own header note). */}

      {open && (
        <PersonDrawer
          person={open}
          failed={failed}
          certPrivate={certSelf !== null && nameFold(open.name) !== nameFold(certSelf)}
          enginePrivate={isPrivateTo(engineSelf, open.name)}
          overallPrivate={overallHidden(open)}
          match={compareWitnesses(
            engineByKey.get(open.key) ?? new Map(),
            matrixByKey.get(open.key),
            docItems,
            docByKey.get(open.key),
            matrixCols,
          )}
          onClose={() => setWho(null)}
          onProfile={() => void openProfile(open, missFromDrawer(open.name))}
        />
      )}
    </div>
    </IstCfgContext.Provider>
  )
}

function Tile({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: number | string; tint: string }) {
  return (
    <div className="rounded-[16px] border border-border bg-surface p-3.5">
      <span className={cn('mb-2 grid h-8 w-8 place-items-center rounded-[10px]', tint)}>{icon}</span>
      <div className="font-stat text-[20px] font-bold leading-7 text-text-1">{value}</div>
      <div className="text-[11.5px] text-text-3">{label}</div>
    </div>
  )
}

function PersonRow({
  person: p, current, mx, matrixCols, docItems, doc, certPrivate = false, docPrivate = false, docUnread = false,
  enginePrivate = false, overallPrivate = false, states, onOpen, onProfile,
}: {
  person: Person
  current: boolean
  mx?: MatrixLine
  matrixCols: readonly CertScreenColumn[]
  docItems: DocItem[]
  doc?: Record<string, { state?: string; text?: string }>
  /** another person's certifications, answered to a caller who reads only their own */
  certPrivate?: boolean
  /** the same for the documents matrix */
  docPrivate?: boolean
  /** the documents matrix did not answer at all */
  docUnread?: boolean
  /** the same for the compliance engine's states */
  enginePrivate?: boolean
  /** the overall rests on one of those, so it is not known here */
  overallPrivate?: boolean
  states?: Map<string, string>
  onOpen: () => void
  onProfile: () => void
}) {
  const match = useMemo(
    () => compareWitnesses(states ?? new Map(), mx, docItems, doc, matrixCols),
    [states, mx, docItems, doc, matrixCols],
  )
  const certCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const cert of p.certs) c[cert.status || 'unknown'] = (c[cert.status || 'unknown'] ?? 0) + 1
    return c
  }, [p.certs])
  const look = useIstLook()
  const istOwed = p.ist.filter(look.owed).length
  // ONE CHIP PER HOUSE, not per record.
  const istHouses = useMemo(() => {
    const byHouse = new Map<string, { clients: string[]; owed: boolean }>()
    for (const i of p.ist) {
      const house = (i.house ?? '').trim() || '(no house)'
      const at = byHouse.get(house) ?? { clients: [], owed: false }
      const who = (i.clientName ?? '').trim()
      const due = (i.dueDate ?? '').trim()
      at.clients.push([who || '(no client)', due ? `due ${fmtDate(due)}` : ''].filter(Boolean).join(' · '))
      if (look.owed(i)) at.owed = true
      byHouse.set(house, at)
    }
    return [...byHouse.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([house, v]) => ({
        house,
        owed: v.owed,
        title: `${house} — ${v.clients.join(' | ')}`,
      }))
  }, [p.ist, look])
  const ackPending = p.acks.filter((a) => (a.status ?? '').toLowerCase() === 'pending').length
  const ackOverdue = p.acks.filter((a) => (a.status ?? '').toLowerCase() === 'overdue').length
  // `engineWorst` used to pick the loudest state so the column could tint a count by it.

  return (
    <tr onClick={onOpen} className="group cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2/50">
      {/* The name and the initials go to the PERSON; the rest of the row still
          opens the drawer. stopPropagation is what keeps the two apart, and
          the keyboard gets the same door as the mouse. */}
      <td className="sticky left-0 z-[1] border-r border-border bg-surface px-3 py-2.5 transition-colors group-hover:bg-surface-2">
        <span
          role="link"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onProfile() }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault(); e.stopPropagation(); onProfile()
          }}
          className="-mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-0.5 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary"
        >
          {/* ── and every name is a drag handle. The standing rule is that
              names on every page can be dragged to the tracker at the top.
              DragPerson wires the NATIVE
              dragstart, so it coexists with the click above — a drag never
              fires a click, and the avatar travels with the payload. ── */}
          <DragPerson name={p.name} avatar={p.avatar} subtitle={p.role} className="min-w-0 items-center gap-2.5">
            {/**
              * THE PLATFORM ALREADY HAS THIS RING, and it is emerald-400.
              *
              * The sidebar lights the user you are standing as with
              * `ring-2 ring-emerald-400 ring-offset-2` — the standing rule
              * that a live user's circle wears a green rim.
              * So "this person is live in the system" is
              * ALREADY a shape and a colour on this platform, and a second
              * green for the same idea would just be a second dialect.
              *
              * Two greens were tried and both were wrong: `tint-mint` is
              * #0f6482, a teal that landed a shade from the blue it had to
              * contrast with, and `--status-green` (#16a34a) is a muted
              * signal-green that reads as a border. emerald-400 is the near
              * fluorescent one, and it is the one already in the shell.
              */}
            <span
              className={cn(
                'shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-surface group-hover:ring-offset-surface-2',
                current ? 'ring-emerald-400' : 'ring-tint-fg-blue',
              )}
            >
              <Avatar src={p.avatar} name={p.name} size="xs" />
            </span>
            <span className="min-w-0">
              <span className="clamp-1 block text-[13px] font-medium text-text-1">{p.name}</span>
              {p.role && <span className="clamp-1 block text-[11px] text-text-3">{p.role}</span>}
            </span>
          </DragPerson>
        </span>
      </td>
      <td className="px-3 py-2.5">
        {p.certs.length ? (
          <span className="flex flex-wrap gap-1">
            {(['expired', 'missing', 'expiring'] as const).map((s) =>
              certCounts[s] ? (
                <span key={s} className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', look.certCls(s))}>
                  {certCounts[s]} {s}
                </span>
              ) : null,
            )}
            <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', look.certCls('valid'))}>
              {certCounts.valid ?? 0} valid
            </span>
          </span>
        ) : certPrivate ? (
          <span title="Another person's certifications are private to them" className="text-[11.5px] text-text-3">—</span>
        ) : (
          <span className="text-[11.5px] text-text-3">no records</span>
        )}
      </td>
      {/**
        * IST IS PER HOUSE, so the cell shows the HOUSES — the IST reports
        * and their several houses, stacked or side by side.
        * One chip per house, side by side, wrapping onto the next line
        * when somebody owes more than the column is wide — both stacked and
        * side by side, chosen by the data rather than by a setting.
        *
        * MEASURED before drawing: 169 records over 71 people, one to eleven
        * each, across 9 houses. A single "3 owed" pill hid the one fact that
        * decides who to send where, and the house codes ARE that fact.
        *
        * The chips are not coloured by due date, deliberately. Every one of the
        * 169 is `owed` AND past due, so a date tint would paint the column one
        * flat colour and call it information. What varies is WHICH house and
        * HOW LATE, and those live in the count, the chip and its title.
        */}
      <td className="max-w-[260px] px-3 py-2.5">
        {p.ist.length ? (
          <span className="flex flex-wrap items-center gap-1">
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
              look.istCls(istOwed ? IST_STATUS_OWED : IST_STATUS_DONE),
            )}>
              {istOwed ? `${istOwed} owed` : `${p.ist.length} done`}
            </span>
            {istHouses.map((h) => (
              <span
                key={h.house}
                title={h.title}
                className={cn(
                  'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
                  h.owed ? look.istSoft(IST_STATUS_OWED) : 'bg-surface-2 text-text-3',
                )}
              >
                {h.house}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-[11.5px] text-text-3">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {p.acks.length ? (
          <span className={cn(
            'rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
            ackOverdue ? 'bg-tint-pink text-tint-fg-pink' : ackPending ? 'bg-tint-amber text-tint-fg-amber' : 'bg-tint-mint text-tint-fg-mint',
          )}>
            {ackOverdue ? `${ackOverdue} overdue` : ackPending ? `${ackPending} pending` : `${p.acks.length} signed`}
          </span>
        ) : (
          <span className="text-[11.5px] text-text-3">—</span>
        )}
      </td>
      {/**
        * THE ENGINE COLUMN STOPPED COUNTING AND STARTED COMPARING
        * — compare the two and say whether they match. It is only that.
        *
        * It used to say "3 states", which is a number nobody acts on. The
        * engine's value here is that it is a SECOND WITNESS to the same
        * thirteen facts this table already draws: its requirement ids ARE the
        * Compliance Matrix's eight column keys and the Documents Matrix's five
        * item ids, character for character. So the useful question is not how
        * many states exist, it is whether the two sources agree — and where
        * they do not, one of them is wrong about somebody's paperwork.
        */}
      <td className="px-3 py-2.5">
        {enginePrivate ? (
          <span title={ENGINE_PRIVATE} className="text-[11.5px] text-text-3">—</span>
        ) : match.compared === 0 && match.missing.length === 0 ? (
          <span title="Nothing to compare — the engine has no state for any item this table draws" className="text-[11.5px] text-text-3">—</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {match.compared > 0 && (
              <span
                title={match.disagree.length
                  ? match.disagree.map((d) => `${d.label}: sheet says ${d.sheet}, engine says ${d.engine}`).join('\n')
                  : `The engine agrees with the sheet on all ${match.compared} items it judged`}
                className={cn(
                  'inline-flex cursor-help items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                  match.disagree.length ? 'bg-tint-pink text-tint-fg-pink' : 'bg-tint-mint text-tint-fg-mint',
                )}
              >
                {match.disagree.length
                  ? `${match.disagree.length} disagree`
                  : `match ${match.agree}/${match.compared}`}
              </span>
            )}
            {/* The gap in the SECOND witness, said as itself. Amber, not pink:
                the engine having nothing to say about an item is not the engine
                contradicting the sheet, and the two must not read alike. */}
            {match.missing.length > 0 && (
              <span
                title={`The engine has no state for:\n${match.missing.map((m) => `${m.label} (sheet says ${m.sheet})`).join('\n')}`}
                className="inline-flex cursor-help items-center rounded-full bg-tint-amber px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-amber"
              >
                {match.missing.length} missing
              </span>
            )}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {p.perf ? (
          <span className="flex items-center gap-2">
            <span className={cn('rounded-md px-1.5 py-0.5 text-[12px] font-bold tabular-nums', gradeCls(p.perf.grade))}>
              {Number.isFinite(p.perf.grade) ? p.perf.grade!.toFixed(1) : '—'}
            </span>
            <span className="text-[11px] leading-4 text-text-3">
              <span className="block">{p.perf.attendance_90d ?? 0} call-off{(p.perf.attendance_90d ?? 0) === 1 ? '' : 's'} / 90d</span>
              {(p.perf.incidents ?? 0) > 0 && (
                <span className="block">
                  {p.perf.incidents} incident{p.perf.incidents === 1 ? '' : 's'}{(p.perf.incidents_major ?? 0) > 0 ? ` (${p.perf.incidents_major} major)` : ''}
                </span>
              )}
            </span>
          </span>
        ) : (
          <span className="text-[11.5px] text-text-3">—</span>
        )}
      </td>
      <td className="border-r border-border px-3 py-2.5">
        {overallPrivate ? (
          <span title={OVERALL_PRIVATE} className="text-[11.5px] text-text-3">—</span>
        ) : (
          <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold', OVERALL_STYLE[p.overall].cls)}>
            {OVERALL_STYLE[p.overall].label}
          </span>
        )}
      </td>

      {/* ── COMPLIANCE MATRIX — the same columns the backend computes, which
             the `ist_config` tab decides and this row follows ── */}
      {matrixCols.map((c) => (
        <td key={c.key} className="px-3 py-2.5 text-center">
          <MatrixCell status={mx?.cells[c.key] ?? ''} />
        </td>
      ))}
      <td className={cn('px-3 py-2.5 text-right', docItems.length > 0 && 'border-r border-border')}>
        {mx == null || mx.attention === null ? (
          <span title="Not on the matrix — the sheet keeps no attention count for this person" className="text-[11px] text-text-3/60">—</span>
        ) : (
          <span className={cn(
            'inline-flex min-w-[26px] justify-center rounded-md px-1.5 py-0.5 font-stat text-[12px] font-bold tabular-nums',
            mx.attention === 0 ? 'bg-tint-mint text-tint-fg-mint'
              : mx.attention >= 5 ? 'bg-tint-pink text-tint-fg-pink'
                : 'bg-tint-amber text-tint-fg-amber',
          )}>
            {mx.attention}
          </span>
        )}
      </td>

      {/* ── DOCUMENTS MATRIX — the columns complianceMatrix named, in its order.
             A person the compliance roster does not carry has no entry at all,
             and that is drawn as "no record" rather than as a missing document:
             the sheet never said this person is short an I-9, it never mentioned
             them. ── */}
      {docItems.map((it) => {
        const cell = doc?.[it.id]
        if (!doc) {
          // unread and private are unknowns, drawn as a dash; only an answered roster without them is "no record"
          const why = docUnread ? 'The documents matrix did not answer — unknown, not missing'
            : docPrivate ? "Another person's documents are private to them"
              : 'Not on the compliance roster — no document record either way'
          return (
            <td key={it.id} className="px-3 py-2.5 text-center">
              <span title={why} className="text-[13px] text-text-3/50">{docUnread || docPrivate ? '—' : '·'}</span>
            </td>
          )
        }
        return (
          <td key={it.id} className="px-3 py-2.5 text-center">
            <span className={cn(
              'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
              DOC_CELL_TINT[cell?.state ?? 'blank'] ?? 'bg-surface-2 text-text-3',
            )}>
              {cell?.text || cell?.state || '—'}
            </span>
          </td>
        )
      })}

      <td className="px-3 py-2.5 text-right text-text-3">
        <ChevronRight size={14} className="ml-auto" />
      </td>
    </tr>
  )
}

// THE PER-PERSON PANEL — the candidate panel's grammar, for real this time — the layout was fine but the panel had…
function PersonDrawer({
  person: p, failed, certPrivate = false, enginePrivate = false, overallPrivate = false, match, onClose, onProfile,
}: {
  person: Person; failed: string[]
  /** another person's certifications, answered to a caller who reads only their own */
  certPrivate?: boolean
  /** the same for the compliance engine's states */
  enginePrivate?: boolean
  /** the overall rests on one of those, so it is not known here */
  overallPrivate?: boolean
  match: MatchResult; onClose: () => void; onProfile: () => void
}) {
  const failedNote = (resource: string) =>
    failed.includes(resource) ? (
      <p className="mb-2 rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
        The {resource} resource did not answer — this section is unknown, not empty.
      </p>
    ) : null

  const certValid = p.certs.filter((c) => c.status === 'valid').length
  const certBad = p.certs.filter((c) => c.status === 'expired' || c.status === 'missing').length
  const certSoon = p.certs.filter((c) => c.status === 'expiring').length
  const look = useIstLook()
  const istOwed = p.ist.filter(look.owed).length
  const ackOpen = p.acks.filter((a) => ['pending', 'overdue'].includes((a.status ?? '').toLowerCase())).length
  const engineBad = p.engine.filter((e) => e.state === 'expired' || e.state === 'expiring').length

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="flex h-full w-full flex-col border-l border-border bg-bg shadow-3 sm:w-[384px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* the strip — says what this panel is, and closes it */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Employee record</span>
          <button onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1">
            <X size={15} />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          {/* ── the hero ── */}
          <div className="rounded-lg bg-detail-hero p-5">
            <div className="flex items-start gap-4">
              <DragPerson name={p.name} avatar={p.avatar} subtitle={p.role} className="shrink-0">
                <button
                  onClick={onProfile}
                  aria-label={`Open ${p.name}`}
                  className="rounded-[14px] outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <Avatar src={p.avatar} name={p.name} size="lg" />
                </button>
              </DragPerson>
              <div className="min-w-0 flex-1 pt-0.5">
                <DragPerson name={p.name} avatar={p.avatar} subtitle={p.role} className="min-w-0">
                  <button
                    onClick={onProfile}
                    className="clamp-1 block max-w-full text-left text-[19px] font-bold leading-6 text-white outline-none hover:underline focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    {p.name}
                  </button>
                </DragPerson>
                {p.role && <p className="clamp-1 mt-0.5 text-[13px] text-white/60">{p.role}</p>}
                {overallPrivate ? (
                  <p className="mt-2 text-[11.5px] leading-4 text-white/60">— {OVERALL_PRIVATE}.</p>
                ) : (
                  <span className={cn('mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold', OVERALL_STYLE[p.overall].cls)}>
                    {OVERALL_STYLE[p.overall].label}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── the four numbers, before any list ── */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat
              icon={<ShieldCheck size={15} className={certBad ? 'text-tint-fg-pink' : certSoon ? 'text-tint-fg-amber' : 'text-tint-fg-mint'} />}
              tint={certBad ? 'bg-tint-pink' : certSoon ? 'bg-tint-amber' : 'bg-tint-mint'}
              value={p.certs.length ? `${certValid}/${p.certs.length}` : '—'}
              label={p.certs.length ? 'Certifications valid' : certPrivate ? 'Certifications — private to them' : 'No cert records'}
            />
            <Stat
              icon={<GraduationCap size={15} className={istOwed ? 'text-tint-fg-amber' : 'text-tint-fg-blue'} />}
              tint={istOwed ? 'bg-tint-amber' : 'bg-tint-blue'}
              value={p.ist.length ? String(istOwed) : '—'}
              label={p.ist.length ? 'IST obligations owed' : 'No IST records'}
            />
            <Stat
              icon={<PenLine size={15} className={ackOpen ? 'text-tint-fg-amber' : 'text-tint-fg-lavender'} />}
              tint={ackOpen ? 'bg-tint-amber' : 'bg-tint-lavender'}
              value={p.acks.length ? String(ackOpen) : '—'}
              label={p.acks.length ? 'Signatures outstanding' : 'No signatures on file'}
            />
            <Stat
              icon={<TrendingUp size={15} className="text-tint-fg-blue" />}
              tint="bg-tint-blue"
              value={Number.isFinite(p.perf?.grade) ? p.perf!.grade!.toFixed(1) : '—'}
              label={p.perf ? 'Performance grade' : 'No board row'}
            />
          </div>

          {/* ── details ── */}
          <SectionHead>Details</SectionHead>
          <div className="rounded-xl border border-border">
            <DetailRow icon={<ShieldCheck size={13} />} label="Certifications" value={p.certs.length ? `${p.certs.length} tracked` : '—'} />
            <DetailRow icon={<GraduationCap size={13} />} label="IST records" value={p.ist.length ? `${p.ist.length} on file` : '—'} />
            <DetailRow icon={<PenLine size={13} />} label="Policy signatures" value={p.acks.length ? `${p.acks.length} on the ledger` : '—'} />
            <DetailRow icon={<HeartPulse size={13} />} label="Engine states" value={p.engine.length ? `${p.engine.length} materialized${engineBad ? ` · ${engineBad} open` : ''}` : '—'} />
            {p.perf?.status ? <DetailRow icon={<CheckCircle2 size={13} />} label="Status" value={p.perf.status} /> : null}
            {p.perf?.hire_date ? <DetailRow icon={<TrendingUp size={13} />} label="On the record since" value={p.perf.hire_date} /> : null}
          </div>

          {/* ── CERTIFICATIONS ── */}
          <SectionHead icon={<ShieldCheck size={12} />} count={p.certs.length}>Certifications</SectionHead>
          {failedNote('staffCerts')}
          <div className="rounded-xl border border-border">
            {p.certs.map((c, i) => (
              <div key={`${c.name}-${i}`} className={cn('flex items-center gap-2 px-3 py-2', i > 0 && 'border-t border-border/50')}>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-1">{c.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-text-3">{c.expiresAt ? fmtDate(c.expiresAt) : ''}</span>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', look.certCls(c.status))}>
                  {c.status || 'unknown'}
                </span>
              </div>
            ))}
            {!p.certs.length && !failed.includes('staffCerts') && (
              <p className="px-3 py-4 text-[12.5px] text-text-3">
                {certPrivate ? 'Another person’s certifications are private to them.' : 'No certification records on file.'}
              </p>
            )}
          </div>
          {/* NOT "open the compliance matrix" any more: the matrix is nine
              columns of the table this panel is floating over, so that link
              pointed at the screen you are already on. The Compliance
              scorecard is a different question and a real destination. */}
          <DrawerLink to="/app/employee-tracker/certifications" label="Open the compliance scorecard" />

          {/* ── IST OBLIGATIONS ── */}
          <SectionHead icon={<GraduationCap size={12} />} count={p.ist.length}>IST obligations</SectionHead>
          {failedNote('istRecords')}
          <div className="rounded-xl border border-border">
            {p.ist.map((i, k) => (
              <div key={k} className={cn('flex items-center gap-2 px-3 py-2', k > 0 && 'border-t border-border/50')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-text-1">{i.clientName || '(no client)'}</span>
                  <span className="block truncate text-[11px] text-text-3">
                    {i.house || ''}{i.dueDate ? ` · needed by ${fmtDate(i.dueDate)}` : ''}{i.certNote ? ` · ${i.certNote}` : ''}
                  </span>
                </span>
                <span className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                  look.istCls(look.owed(i) ? IST_STATUS_OWED : i.status || IST_STATUS_DONE),
                )}>
                  {/* a done row past ist_valid_days is owed again, and says so */}
                  {look.owed(i) && (i.status ?? '').trim().toLowerCase() !== IST_STATUS_OWED
                    ? 'lapsed' : (i.status || 'unknown')}
                </span>
              </div>
            ))}
            {!p.ist.length && !failed.includes('istRecords') && (
              <p className="px-3 py-4 text-[12.5px] text-text-3">No IST records — no per-client training owed or recorded.</p>
            )}
          </div>
          {/* IST Records was uninstalled and its rung removed —
              the obligations are the houses in this person's row. There is no
              screen left to send anybody to, and a link to a page that bounces
              to /apps is worse than no link. */}

          {/* ── POLICY SIGNATURES ── */}
          <SectionHead icon={<PenLine size={12} />} count={p.acks.length}>Policy signatures</SectionHead>
          {failedNote('policyAcks')}
          <div className="rounded-xl border border-border">
            {p.acks.map((a, k) => (
              <div key={k} className={cn('flex items-center gap-2 px-3 py-2', k > 0 && 'border-t border-border/50')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-text-1">{a.policy || '(unnamed policy)'}</span>
                  <span className="block truncate text-[11px] text-text-3">
                    {a.version || ''}{a.signedAt ? ` · signed ${fmtDate(a.signedAt)}` : a.effectiveDate ? ` · effective ${fmtDate(a.effectiveDate)}` : ''}
                  </span>
                </span>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', ackCls(a.status))}>
                  {(a.status || 'unknown').toLowerCase()}
                </span>
              </div>
            ))}
            {!p.acks.length && !failed.includes('policyAcks') && (
              <p className="px-3 py-4 text-[12.5px] text-text-3">No signatures on the ledger for this person.</p>
            )}
          </div>
          {/* Policies went back to being ONLY its own app, so the
              link goes there — and that app is open to everyone, unlike this one. */}
          <DrawerLink to="/app/policy-acks/documents" label="Open Policies" />

          {/* ── COMPLIANCE ENGINE ── */}
          <SectionHead icon={<HeartPulse size={12} />} count={enginePrivate ? undefined : p.engine.length}>Compliance engine</SectionHead>
          {failedNote('requirementStatesList (engine)')}

          {/**
            * WHERE THE TWO SOURCES DISAGREE — the row's pill said how many,
            * this says which, and in whose words. It sits ABOVE the state list
            * because a contradiction about somebody's paperwork outranks the
            * inventory of it: one of these two is wrong, and the row above is
            * how you find out there is anything to look at. Another person's
            * states did not answer here, so there is nothing to compare.
            */}
          {!enginePrivate && (match.compared > 0 || match.missing.length > 0) && (
            <div className={cn(
              'mb-2 rounded-xl border px-3 py-2.5',
              match.disagree.length ? 'border-tint-pink bg-tint-pink/30' : 'border-border',
            )}>
              {match.disagree.length ? (
                <>
                  <p className="text-[12px] font-semibold text-tint-fg-pink">
                    The engine contradicts the sheet on {match.disagree.length} of {match.compared} item
                    {match.compared === 1 ? '' : 's'} it judged
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {match.disagree.map((d) => (
                      <p key={d.id} className="text-[11.5px] leading-4 text-text-2">
                        <span className="font-medium text-text-1">{d.label}</span>
                        {' — sheet says '}
                        <span className={cn('rounded px-1 font-semibold', engineCls(d.sheet === 'ok' ? 'ok' : d.sheet))}>{d.sheet}</span>
                        {', engine says '}
                        <span className={cn('rounded px-1 font-semibold', engineCls(d.engine === 'ok' ? 'ok' : d.engine))}>{d.engine}</span>
                      </p>
                    ))}
                  </div>
                </>
              ) : match.compared > 0 ? (
                <p className="text-[12px] text-text-2">
                  The engine agrees with the sheet on all {match.compared} item
                  {match.compared === 1 ? '' : 's'} it judged.
                </p>
              ) : null}

              {/* THE ITEMS THE SECOND WITNESS NEVER LOOKED AT. Listed, not
                  counted away: the sheet's word on them stands unchallenged,
                  and a reader deciding a shift should know which of these
                  cells nothing has checked. */}
              {match.missing.length > 0 && (
                <div className={cn(match.compared > 0 && 'mt-2 border-t border-border/50 pt-2')}>
                  <p className="text-[12px] font-semibold text-tint-fg-amber">
                    The engine has no state for {match.missing.length} item
                    {match.missing.length === 1 ? '' : 's'} — the sheet stands alone on {match.missing.length === 1 ? 'it' : 'these'}
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {match.missing.map((m) => (
                      <p key={m.id} className="text-[11.5px] leading-4 text-text-2">
                        <span className="font-medium text-text-1">{m.label}</span>
                        {' — sheet says '}
                        <span className={cn('rounded px-1 font-semibold', engineCls(m.sheet === 'ok' ? 'ok' : m.sheet))}>{m.sheet}</span>
                        {', engine has not judged it'}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="rounded-xl border border-border">
            {p.engine.map((e, k) => (
              <div key={k} className={cn('flex items-center gap-2 px-3 py-2', k > 0 && 'border-t border-border/50')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-text-1">{e.req_id || '(requirement)'}</span>
                  <span className="block truncate text-[11px] text-text-3">
                    {e.expires ? `expires ${e.expires}` : ''}{e.days_left ? ` · ${e.days_left}d left` : ''}
                  </span>
                </span>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', engineCls(e.state))}>
                  {e.state || 'unknown'}
                </span>
              </div>
            ))}
            {!p.engine.length && !failed.includes('requirementStatesList (engine)') && (
              <p className="px-3 py-4 text-[12.5px] text-text-3">
                {enginePrivate ? `${ENGINE_PRIVATE}.` : 'The engine has materialized no state for this person.'}
              </p>
            )}
          </div>
          {/* The states matrix was uninstalled with its rung —
              and the block above is what replaced it: not a list of states, but
              what those states SAY about the sheet's own cells. There is no
              second screen left to send anybody to. */}

          {/* ── PERFORMANCE ── */}
          <SectionHead icon={<TrendingUp size={12} />}>Performance</SectionHead>
          {failedNote('staffPerfList (performance)')}
          {p.perf ? (
            <div className="rounded-xl border border-border px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[15px] font-bold tabular-nums', gradeCls(p.perf.grade))}>
                  {Number.isFinite(p.perf.grade) ? p.perf.grade!.toFixed(1) : '—'}
                </span>
                <span className="min-w-0 flex-1 text-[12.5px] leading-4 text-text-2">
                  <span className="block">
                    {p.perf.attendance_90d ?? 0} call-off{(p.perf.attendance_90d ?? 0) === 1 ? '' : 's'} in 90 days
                    ({p.perf.attendance_all ?? 0} ever)
                  </span>
                  <span className="block">
                    {(p.perf.incidents ?? 0) > 0
                      ? `${p.perf.incidents} incident${p.perf.incidents === 1 ? '' : 's'}${(p.perf.incidents_major ?? 0) > 0 ? ` — ${p.perf.incidents_major} major` : ''}`
                      : 'No incidents on the record'}
                  </span>
                </span>
              </div>
            </div>
          ) : !failed.includes('staffPerfList (performance)') ? (
            <div className="rounded-xl border border-border px-3 py-4 text-[12.5px] text-text-3">
              The performance board holds no row for this person.
            </div>
          ) : null}
          <DrawerLink
            to={p.perf?.emp_id ? `/app/employee-tracker/board?person=${encodeURIComponent(p.perf.emp_id)}` : '/app/employee-tracker/board'}
            label={p.perf?.emp_id ? 'Open the full performance profile' : 'Open Staff Performance'}
          />
        </div>

        {/* ── the footer: the two things to do next, always reachable ── */}
        <div className="flex shrink-0 gap-2 border-t border-border bg-surface px-4 py-3">
          <Link
            to="/app/employee-tracker/certifications"
            className="flex h-9 flex-1 items-center justify-center rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 no-underline transition-colors hover:bg-surface-2"
          >
            Compliance scorecard
          </Link>
          <button
            onClick={onProfile}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Open profile <ArrowUpRight size={14} />
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/** One of the four headline numbers — the panel's own compact Tile. */
function Stat({ icon, tint, value, label }: { icon: React.ReactNode; tint: string; value: string; label: string }) {
  return (
    <div className="rounded-[16px] border border-border bg-surface p-3">
      <span className={cn('mb-2 grid h-8 w-8 place-items-center rounded-[10px]', tint)}>{icon}</span>
      <div className="font-stat text-[19px] font-bold leading-6 text-text-1">{value}</div>
      <div className="clamp-1 text-[11px] text-text-3">{label}</div>
    </div>
  )
}

/** The uppercase rule every section hangs from — the count is optional. */
function SectionHead({ icon, count, children }: { icon?: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-3">
      {icon}{children}{count ? ` · ${count}` : ''}
    </p>
  )
}

/** A labelled fact — the details block's one row shape. */
function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border/50">
      <span className="text-text-3">{icon}</span>
      <span className="w-[132px] shrink-0 text-[12px] text-text-3">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-1">{value}</span>
    </div>
  )
}

// The five section links.
function DrawerLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary no-underline hover:underline">
      {label} <ChevronRight size={11} />
    </Link>
  )
}

/* ══════════════════ THE COMPLIANCE MATRIX, ABSORBED ══════════════════ */

// THE EIGHT TRACKED CERTIFICATIONS — the shipped floor, not the law.
export const MATRIX_COLS = [
  { key: 'dodd', label: 'DODD 8-Hr', certId: 'cert-dodd' },
  { key: 'cpr', label: 'CPR/FA', certId: 'cert-cpr' },
  { key: 'med1', label: 'Med Del 1', certId: 'cert-med1' },
  { key: 'med2', label: 'Med Del 2', certId: 'cert-med2' },
  { key: 'med3', label: 'Med Del 3', certId: 'cert-med3' },
  { key: 'mais', label: 'DODD MAIS', certId: 'cert-mais' },
  { key: 'money', label: 'Money Mgmt', certId: 'cert-money' },
  { key: 'mandt', label: 'MANDT', certId: 'cert-mandt' },
] as const

/** One line of the matrix — from the sheet, or reconstructed from the ledger. */
type MatrixLine = {
  /** column key → status word, or '' for "this table cannot say". */
  cells: Record<string, string>
  /** the sheet's own count of non-valid columns; null on a ledger-built line. */
  attention: number | null
  onMatrix: boolean
}

// A CELL THAT IS BLANK IS NOT A CELL THAT IS MISSING.
function MatrixCell({ status }: { status: string }) {
  const look = useIstLook()
  if (!status) {
    return (
      <span title="No record either way — either this row was built from the ledger rather than the matrix, or nothing on the platform can answer for this course yet" className="text-[13px] text-text-3/50">
        ·
      </span>
    )
  }
  if (status === 'missing') {
    return (
      <span className="inline-flex rounded-full border border-dashed border-tint-fg-pink/50 px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-pink">
        missing
      </span>
    )
  }
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold', look.certCls(status))}>{status}</span>
}

// A HORIZONTAL SCROLLBAR AT THE TOP AND AT THE BOTTOM.
function DoubleScroll({ children }: { children: React.ReactNode }) {
  const body = useRef<HTMLDivElement | null>(null)
  const rail = useRef<HTMLDivElement | null>(null)
  const lock = useRef(false)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = body.current
    if (!el) return
    const measure = () => setWidth(el.scrollWidth)
    measure()
    // the table grows when rows arrive and when the window changes: watch both the scroller and the table inside…
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [children])

  const drive = (from: 'rail' | 'body') => () => {
    if (lock.current) return
    const a = from === 'rail' ? rail.current : body.current
    const b = from === 'rail' ? body.current : rail.current
    if (!a || !b || a.scrollLeft === b.scrollLeft) return
    lock.current = true
    b.scrollLeft = a.scrollLeft
    requestAnimationFrame(() => { lock.current = false })
  }

  return (
    <>
      <div
        ref={rail}
        onScroll={drive('rail')}
        aria-hidden
        className="scroll-thin overflow-x-auto overflow-y-hidden border-b border-border/50"
      >
        <div style={{ width, height: 1 }} />
      </div>
      <div ref={body} onScroll={drive('body')} className="scroll-thin overflow-x-auto">
        {children}
      </div>
    </>
  )
}

