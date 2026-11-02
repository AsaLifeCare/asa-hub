// The HR record stays below the seam, apart from the wellbeing reading, and the whole app carries the record's audience.
// Joined by folded name only (no shared id); a name reaching two HR rows is dropped, never guessed.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlarmClock, AlertTriangle, ArrowLeft, Brain, Download, GraduationCap, Loader2,
  MessageSquarePlus, Printer, RefreshCw, Search, Send, Share2, ShieldAlert, ShieldCheck, Sparkles, UserCog, UserPlus,
} from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import ContextBanner from '@/components/shared/ContextBanner'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG, TINT_VAR, heroBand, type ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { readSlice } from '@/lib/snapshotClient'
import { gasAction } from '@/features/hiring/shared'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { ohioDateTime } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { exportRows, type ExportColumn } from '@/lib/exportTable'
import { share } from '@/stores/useShareStore'
import { toast } from '@/stores/useToastStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { useContextStore } from '@/stores/useContextStore'
import { rowFocusTier } from '@/lib/focus'
import { useSearchParams } from 'react-router'
import { useEffectiveIsMaster, useEffectiveRole } from '@/lib/effectiveUser'
import type { FocusType } from '@/stores/useContextStore'
import { cn } from '@/lib/utils'
// THE PEOPLE PROFILE, MOUNTED — not copied.
import { ProfileSummaryCard, ProfileSections, useDeepProfile, type UserRow } from '@/pages/features/users/ProfilePage'
import { wornTypes } from '@/lib/badgeAccess'
import RoleBadge from '@/components/shared/RoleBadge'
// THE ACCOUNT DOORS' OWN DIALOGS — exported from the Users section rather than re-written here.
import {
  ArmAccountsDialog, CreateUserDialog, InviteDialog, VARIANT_ROLES, u_needsActivation,
} from '@/pages/settings/UsersSection'
import { BulkPassBar } from '@/pages/features/users/UsersPage'
import {
  AppAccessDialog, ChangeRoleDialog, ContactsDialog, ProfileDialog, RemoveUserDialog,
  ResetPasswordDialog, SetBadgesDialog, SetPlaceDialog, SetTypeDialog, ToggleActiveDialog,
} from '@/pages/settings/UsersSection'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cachedUsers, fetchUsers } from '@/lib/usersDirectory'
import ExportMenu from '@/components/shared/ExportMenu'

// ------------------------------------------------------------------ the shapes the relay and the backend send…

type Metrics = {
  actions: number
  active_days: number
  distinct_actions: number
  night_actions: number
  weekend_actions: number
  failures: number
  longest_run_days: number
  first_seen: string
  last_seen: string
  hours: number[]
  rail: { day: string; n: number }[]
}

type ShiftFacts = {
  shifts: number
  days: number
  overnights: number
  houses: string[]
  houses_n?: number
  first: string
  last: string
  span_days: number
  longest_run_days: number
  /** the half of the roster that has NOT happened — a plan, never a rhythm */
  planned?: number
  planned_overnights?: number
  off_requested?: number
  /** shifts worked whose cell carried no time: hours unknown, never zero */
  hours_unknown?: number
  night_run_days?: number
}

// THE TIME CLOCK — the only source that can answer hours and turnaround.
type Worked = {
  shifts: number
  hours: number
  days: number
  nights: number
  night_run_days: number
  longest_run_days: number
  hours_per_week: number | null
  longest_shift_h: number
  longest_stretch_h: number
  quick_turnarounds: number
  back_to_back: number
  min_turnaround_h: number | null
  first: string
  last: string
  span_days: number
  as_of: string
  age_days: number
  fresh: boolean
}

// A call-off is a COUNT and a TYPE.
type Absences = {
  count: number
  types: { type: string; n: number }[]
  first: string
  last: string
  as_of: string
  age_days: number
  window_days: number
}

type BoardRow = {
  id: string
  subject_kind: 'person' | 'client' | 'platform'
  subject_key: string
  subject_name: string
  role: string
  title?: string
  types?: string
  active?: boolean
  armed?: boolean
  roster_status?: string
  window_days: number
  computed_at: string
  sample: 'full' | 'thin' | 'none'
  metrics: Metrics
  top_apps: { app: string; n: number }[]
  franchises: string[]
  world?: string
  forms_actions: number
  images_touched: number
  shifts: ShiftFacts | null
  // THE WORKING LIFE.
  worked?: Worked | null
  worked_as_of?: string
  worked_age_days?: number
  worked_fresh?: boolean
  absences?: Absences | null
  absences_as_of?: string
  absences_age_days?: number
  absences_known?: boolean
  /** how they ACTUALLY worked — the punches, in the same five words */
  work_verdict?: string
  work_why?: string
  /** the worse of the two measured axes, and which one it came from */
  rhythm_verdict?: string
  rhythm_from?: string
  rhythm_why?: string
  site_verdict: string
  site_why: string
  shift_verdict: string
  shift_why: string
  reach_verdict: string
  reach_why: string
  /** platform row only — how many people each frozen book reaches */
  worked_people?: number
  absences_people?: number
  // what they were trained to do — the estate's course record, folded to one entry per course and dated.
  training?: Training | null
  ist?: { done: number; owed: number; plans: number } | null
  requirements?: ReqCounts | null
  training_verdict?: string
  training_why?: string
  signals_hash: string
  unattributed_rows?: number
  unattributed_actors?: number
}

type Course = { course: string; expires: string; state: 'valid' | 'expiring' | 'expired' | 'undated' }
type Training = {
  courses: Course[]
  valid: number; expiring: number; expired: number; undated: number; total: number
}
type ReqCounts = {
  ok: number; missing: number; expiring: number; expired: number; na: number
  wrong?: { req: string; state: string; expires: string }[]
}

type Reading = {
  subject_key: string
  subject_name: string
  computed_at: string
  signals_hash: string
  site_verdict: string
  shift_verdict: string
  reading: string
  tags: string[]
  ai_via: string
  ai_at: string
  /** what the cortex last said, kept on the row and repainted on every open */
  cortex_note?: string
  cortex_at?: string
}

type Signal = {
  signal: string
  value: string
  unit: string
  detail: string
  at: string
  window: string
  source: string
}

type Profile = {
  subject_key: string
  subject_name: string
  sees_all?: boolean
  own?: string
  // the whole measured picture, filed in the house so a person who may not read the admin-only slice can still be…
  snapshot?: BoardRow | null
  signals: Signal[]
  reading: (Reading & { highlights?: string[]; site_why?: string; shift_why?: string;
                        state?: string; note?: string }) | null
}

// ------------------------------------------------------------------ the grammar — mint is healthy, amber is watch…

const VERDICT: Record<string, { tint: ExtendedTintName; label: string }> = {
  steady: { tint: 'mint', label: 'Steady' },
  heavy: { tint: 'amber', label: 'Heavy' },
  watch: { tint: 'amber', label: 'Watch' },
  strained: { tint: 'pink', label: 'Strained' },
  quiet: { tint: 'slate', label: 'Quiet' },
  unknown: { tint: 'slate', label: 'Not read' },
  machine: { tint: 'blue', label: 'Machines' },
  multi: { tint: 'lavender', label: 'Several places' },
  'own-world': { tint: 'blue', label: 'Own world' },
  headquarters: { tint: 'slate', label: 'Headquarters' },
  single: { tint: 'slate', label: 'Headquarters' },
  // the credential clock — about paper, never about the person
  current: { tint: 'mint', label: 'In date' },
  renewing: { tint: 'amber', label: 'Renewal due' },
  lapsed: { tint: 'pink', label: 'Past its date' },
}

const COURSE_TINT: Record<string, ExtendedTintName> = {
  valid: 'mint', expiring: 'amber', expired: 'pink', undated: 'slate',
}

// Which kind of person the tracker is holding.
function focusTypeOf(p: BoardRow): FocusType {
  return p.subject_kind === 'client' || p.role === 'client' ? 'client' : 'staff'
}

// WHOSE CARD MAY EVER CARRY A RECORD.
const isEmployeeRow = (p: BoardRow) => focusTypeOf(p) === 'staff'

// THE RING AROUND THE PORTRAIT — four states, one rule: GREEN for active staff, BLUE for inactive staff, RED for a…
type RingKind = 'client' | 'guardian' | 'staff-active' | 'staff-inactive' | null

// the word a guardian's ring reads (the operator's corrected FIX BADGES sheet, 10-30): SSA when the account wears SSA,
// else Family — a client's guardian is the Family column
const familyWord = (account: UserRow | null | undefined): string =>
  wornTypes({ types: account?.types }).includes('SSA') ? 'SSA' : 'Family'

function ringOf(
  p: BoardRow | null | undefined,
  dir: DirRow | null | undefined,
  account: UserRow | null | undefined,
): RingKind {
  if ((p && focusTypeOf(p) === 'client') || account?.client_key) return 'client'
  const dirRole = String(dir?.role || '').trim().toLowerCase()
  if (dirRole === 'guardian' || String(dir?.guardian_for || '').trim()) return 'guardian'
  if (dir) return dirActive(dir) ? 'staff-active' : 'staff-inactive'
  if (account) return String(account.active).toLowerCase() === 'false' ? 'staff-inactive' : 'staff-active'
  return null
}

// Both red cases wear the SAME red on purpose: the ring answers "is this somebody we serve", and a second shade…
const RING_CLASS: Record<Exclude<RingKind, null>, string> = {
  client: 'ring-2 ring-tint-fg-pink ring-offset-2 ring-offset-surface',
  guardian: 'ring-2 ring-tint-fg-pink ring-offset-2 ring-offset-surface',
  'staff-active': 'ring-2 ring-tint-fg-mint ring-offset-2 ring-offset-surface',
  'staff-inactive': 'ring-2 ring-tint-fg-blue ring-offset-2 ring-offset-surface',
}

const RING_TITLE: Record<Exclude<RingKind, null>, string> = {
  client: 'A client — somebody we serve',
  guardian: 'A guardian — somebody we serve',
  'staff-active': 'Staff, active on the roster',
  'staff-inactive': 'Staff, not active on the roster',
}

/** the class for a portrait, or '' when nothing has answered */
const ringClass = (k: RingKind) => (k ? RING_CLASS[k] : '')

// THE SYSTEM CUT — the seats and the machines, not people who work here.
const SYSTEM_ROLES = new Set(['interviewer', 'onboarding', 'service'])

type WhoCut = 'all' | 'staff' | 'clients' | 'system'
type StateCut = 'all' | 'active' | 'inactive'

// A NAME THIS BOARD MAY HAND TO THE TRACKER — an employee's, and only one.
function TrackerName({ p, className, title, children }: {
  p: BoardRow
  className?: string
  title?: string
  children: ReactNode
}) {
  if (!isEmployeeRow(p)) {
    return <span className={cn('inline-flex max-w-full items-center align-middle', className)}>{children}</span>
  }
  return (
    <DragPerson name={p.subject_name} id={p.subject_key} type={focusTypeOf(p)} subtitle={p.role}
                className={className} title={title}>
      {children}
    </DragPerson>
  )
}

const APP_TINT: ExtendedTintName[] = ['blue', 'lavender', 'mint', 'peach', 'amber', 'pink', 'violet', 'slate']

function verdictOf(v: string) {
  return VERDICT[v] ?? { tint: 'slate' as ExtendedTintName, label: v || 'Not read' }
}

function VerdictChip({ v, small }: { v: string; small?: boolean }) {
  const d = verdictOf(v)
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full font-semibold',
      small ? 'px-1.5 py-0.5 text-[10.5px]' : 'px-2 py-0.5 text-[11px]',
      TINT_BG[d.tint], TINT_FG[d.tint])}>
      {d.label}
    </span>
  )
}

// A DAY IS A DAY, NOT AN INSTANT.
const dayText = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const stampText = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ------------------------------------------------------------------ the second axis — what the time clock says…

// WHICH LIFE A VERDICT CAME FROM.
const AXIS_LABEL: Record<string, string> = {
  work: 'from the time clock',
  site: 'from the platform',
}

const axisText = (from?: string) => (from ? AXIS_LABEL[from] ?? `from ${from}` : '')

// The fused reading, falling back to the platform axis for a board filed before the working life was read.
const rhythmOf = (p: BoardRow) => p.rhythm_verdict || p.site_verdict || 'unknown'

const hoursText = (h?: number | null) =>
  h === null || h === undefined ? '' : `${Number.isInteger(h) ? h : h.toFixed(1)}h`

/** "33 days old". Anything the page cannot date says so instead. */
const ageText = (days?: number) =>
  typeof days === 'number' && days >= 0
    ? (days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} old`)
    : 'age unknown'

// HOW OLD THE EVIDENCE IS, said beside the evidence itself.
function AsOf({ at, age, fresh, what }: { at?: string; age?: number; fresh?: boolean; what?: string }) {
  if (!at) return null
  const tint: ExtendedTintName = fresh ? 'slate' : 'amber'
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
      TINT_BG[tint], TINT_FG[tint])}>
      <AppIcon name="clock" size={10} />
      {what ? `${what} ` : ''}to {dayText(at)} · {ageText(age)}
    </span>
  )
}

// UNKNOWN MUST LOOK LIKE UNKNOWN.
function NotOnFile({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[10px] border border-dashed border-border px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-text-3">
      {children}
    </p>
  )
}

// ------------------------------------------------------------------ the small drawings — divs and spans…

// Ranked bars with the label on its OWN row: app names are long and a chart library's axis collides with them…
function AppBars({ apps, cap = 6 }: { apps: { app: string; n: number }[]; cap?: number }) {
  const top = apps.slice(0, cap)
  const peak = Math.max(1, ...top.map((a) => a.n))
  if (!top.length) return <p className="text-[12.5px] text-text-3">No app work recorded in this window.</p>
  return (
    <ul className="space-y-2.5">
      {top.map((a, i) => (
        <li key={a.app}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-[12.5px] font-medium text-text-1">{a.app}</span>
            <span className="shrink-0 font-stat text-[12.5px] text-text-2">{a.n}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            {/* TINT_VAR values already read `var(--tint-…)`; wrapping them in another
                var() emitted `var(var(--tint-…))`, invalid CSS, and these bars painted
                nothing at all. These bars sit on a Card — a surface that follows the
                theme — so the theme-following token is the right colour here. */}
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, (a.n / peak) * 100)}%` }}
              transition={{ duration: 0.6, ease: EASE_OUT_EXPO, delay: Math.min(i, 6) * 0.04 }}
              className="h-full rounded-full"
              style={{ background: TINT_VAR[APP_TINT[i % APP_TINT.length]] }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// The last fortnight, one column a day.
function DayRail({ rail }: { rail: { day: string; n: number }[] }) {
  if (!rail?.length) return <p className="text-[12.5px] text-text-3">No day-by-day record in this window.</p>
  const peak = Math.max(1, ...rail.map((d) => d.n))
  return (
    <div className="flex h-[92px] items-end gap-1.5">
      {rail.map((d) => {
        const h = d.n ? Math.max(6, Math.round((d.n / peak) * 76)) : 2
        const weekend = [0, 6].includes(new Date(`${d.day}T12:00:00Z`).getUTCDay())
        return (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day} · ${d.n}`}>
            <span className="font-stat text-[10px] text-text-3">{d.n || ''}</span>
            <div
              className={cn('w-full rounded-[3px]', d.n ? (weekend ? 'bg-tint-amber' : 'bg-tint-blue') : 'bg-border')}
              style={{ height: h }}
            />
            <span className="text-[9.5px] text-text-3">{d.day.slice(8)}</span>
          </div>
        )
      })}
    </div>
  )
}

// The clock of a working day — 24 slivers.
function HourClock({ hours }: { hours: number[] }) {
  const peak = Math.max(1, ...hours)
  return (
    <div className="flex h-[64px] items-end gap-[3px]">
      {hours.map((n, h) => {
        const night = h >= 22 || h < 5
        return (
          <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${h}:00 · ${n}`}>
            <div
              className={cn('w-full rounded-[2px]', n ? (night ? 'bg-tint-amber' : 'bg-tint-lavender') : 'bg-border')}
              style={{ height: n ? Math.max(4, Math.round((n / peak) * 46)) : 2 }}
            />
            {h % 6 === 0 && <span className="text-[9px] text-text-3">{h}</span>}
          </div>
        )
      })}
    </div>
  )
}

function StatChip({ label, value, tint = 'slate' }: { label: string; value: string | number; tint?: ExtendedTintName }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
      TINT_BG[tint], TINT_FG[tint])}>
      <span className="font-stat">{value}</span>
      <span className="font-normal opacity-80">{label}</span>
    </span>
  )
}

// ------------------------------------------------------------------ the record — Staff Performance's board row…

// The HR board row, exactly as `staffPerfBoard` / `staffPerfList` send it.
type PerfRow = {
  emp_id: string
  name: string
  status: string
  phone: string
  email: string
  hire_date: string
  attendance_90d: number
  attendance_all: number
  incidents: number
  incidents_major: number
  certs_expired: number
  certs_expiring: number
  grade: number
}

// ONE ROW OF THE DIRECTORY — the People app's book, beside the two this page already reads.
type DirRow = {
  id: string
  name: string
  first_name?: string
  last_name?: string
  role: string
  status: string
  email: string
  phone: string
  city?: string
  state?: string
  employee_id?: string | number
  start_date?: string
  end_date?: string
  /** empty for every row in the book today — the ring is drawn on initials */
  avatar?: string
  source?: string
  /** which systems know this person: comms, erp, mylife, roster, sched, sheet */
  source_coverage?: string
  /** two shapes live in this column, so it is printed and never parsed */
  updated_at?: string
  guardian_for?: string
}

// THE DIRECTORY'S OWN WORD FOR "HERE TODAY".
const dirActive = (d?: DirRow | null) => String(d?.status || '').trim().toLowerCase() === 'active'

// THE RECORD'S OWN PROFILE — `staffPerfProfile`'s answer, exactly as the record screen receives it.
type StaffProfile = {
  staff: {
    emp_id: string; name: string; status: string; phone: string; email: string
    hire_date: string; driver: string; hs_diploma: string
  }
  attendance: { date: string; kind: string; notes: string; by: string }[]
  incidents: {
    date: string; type: string; severity: string; category: string
    summary: string; action: string; status: string
  }[]
  notes: { at: string; category: string; text: string }[]
  certs: { cert: string; expires: string; status: string }[]
  grade: { value: number; parts: { label: string; count: number; cut: number }[]; ai: number | null }
  ai: { summary: string; tags: string[]; made_at: string }
  ai_stale?: boolean
}

const STATUS_CHIP: Record<string, string> = {
  Active: 'bg-tint-mint text-tint-fg-mint',
  Pending: 'bg-tint-amber text-tint-fg-amber',
  Terminated: 'bg-surface-3 text-text-3',
}

// THE GRADE'S COLOUR — the record's own rule: 8+ mint, 6+ amber, under 6 pink.
const gradeChip = (g: number) =>
  g >= 8 ? 'bg-tint-mint text-tint-fg-mint' : g >= 6 ? 'bg-tint-amber text-tint-fg-amber' : 'bg-tint-pink text-tint-fg-pink'

// THE ONLY JOIN THERE IS.
const nameKey = (v: string) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// ONE CARD'S WORTH OF PERSON, and which of the honest shapes it is.
type MergedRow = {
  key: string
  p: BoardRow | null
  r: PerfRow | null
  why: 'reached' | 'unmatched' | 'ambiguous' | 'client' | 'no-account' | 'match-refused'
    | 'account-unread'
}

// WHETHER THE RECORD HAS ANSWERED AT ALL — a fact about the READ, kept apart from any fact about a person.
type RecordState = 'pending' | 'failed' | 'empty' | 'unmigrated' | 'ready'

// THE SAME LAW, ASKED OF THE OTHER BOOK — has the BEHAVIOUR BOARD answered?
type BoardState = 'pending' | 'failed' | 'ready'

// ------------------------------------------------------------------ the page…

const KEPT_BOARD = 'asa:behavior:board'
// The SAME kept keys the two screens already use.
const KEPT_PERF = 'asa:perf:board'

const TABS = [
  { id: 'people', label: 'The people' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'health', label: 'Health' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function UserSupportPage() {
  const token = useAuthStore((s) => s.token)
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  // THE GUARD, WRITTEN TWICE ON PURPOSE.
  const role = useEffectiveRole()
  const seesRecord = role === 'admin' || role === 'manager'

  const [board, setBoard] = useState<BoardRow[] | null>(() => readKept<BoardRow[]>(KEPT_BOARD))
  const [readings, setReadings] = useState<Record<string, Reading>>({})
  const [loading, setLoading] = useState(!readKept<BoardRow[]>(KEPT_BOARD))
  const [error, setError] = useState<string | null>(null)
  // HAS THE BOARD ANSWERED THIS VISIT — the board's half of the same fact `perfAnswered` holds for the record.
  const [boardAnswered, setBoardAnswered] = useState(false)
  // the record, its own failure and its own stamp — a board that looks complete while half of it never answered is…
  const [perf, setPerf] = useState<PerfRow[] | null>(() => readKept<PerfRow[]>(KEPT_PERF))
  const [perfError, setPerfError] = useState<string | null>(null)
  const [perfAt, setPerfAt] = useState('')
  // HAS THE RECORD ANSWERED THIS VISIT — a fact about the READ, and the only honest way to tell the kept copy from…
  const [perfAnswered, setPerfAnswered] = useState(false)
  // whether the old platform's Master Data was ever brought in.
  const [perfMigrated, setPerfMigrated] = useState(true)
  // THE DIRECTORY, read beside the two books.
  const [dir, setDir] = useState<DirRow[] | null>(null)
  // THE ACCOUNTS, for the grid's third storey and the state filter.
  const [accounts, setAccounts] = useState<UserRow[]>(() => (cachedUsers() ?? []) as UserRow[])
  useEffect(() => {
    let alive = true
    fetchUsers().then((rows) => { if (alive) setAccounts(rows as UserRow[]) }).catch(() => {})
    return () => { alive = false }
  }, [])
  // WHICH ACCOUNT DOOR IS OPEN.
  const [userDialog, setUserDialog] = useState<'create' | 'invite' | 'arm' | null>(null)
  const reloadAccounts = useCallback(async () => {
    try { setAccounts((await fetchUsers({ force: true })) as UserRow[]) } catch { /* the list stands */ }
  }, [])
  const accountBy = useMemo(() => {
    const m = new Map<string, UserRow>()
    for (const a of accounts) if (a.id) m.set(String(a.id), a)
    return m
  }, [accounts])
  const [moving, setMoving] = useState(false)
  const [recomputing, setRecomputing] = useState(false)

  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<TabId>('people')
  const [q, setQ] = useState('')
  const [who, setWho] = useState<WhoCut>('all')
  const [state, setState] = useState<StateCut>('all')
  const [picked, setPicked] = useState<string | null>(null)

  const load = useCallback(async (loud: boolean) => {
    // THE GUARD GATES THE READS, not only the paint
    if (!seesRecord) { setLoading(false); return }
    if (loud) setLoading(true)
    setError(null)
    // a board still in flight at a sign-out or a crossing keeps nothing: the next person on this machine may see…
    const generation = keptGeneration()
    // THE DIRECTORY, AND IT MAY FAIL QUIETLY.
    void readSlice<DirRow>('people')
      .then((rows) => { if (rows) setDir(rows) })
      .catch(() => { /* the People half says so on its own */ })

    // THE RECORD, built by Python at every read off the copy; the last answer kept here paints while it comes.
    void gasAction<{ rows: PerfRow[]; migrated: boolean; computed_at?: string }>(
      'staffPerfList', {}, { timeoutMs: 120000 })
      .then((d) => {
        setPerf(d?.rows ?? [])
        setPerfAnswered(true)
        keepIfCurrent(KEPT_PERF, d?.rows ?? [], generation)
        setPerfAt(d?.computed_at ?? '')
        setPerfMigrated(d?.migrated !== false)
        setPerfError(null)
      })
      .catch((err) => {
        const kept = readKept<PerfRow[]>(KEPT_PERF)
        if (kept?.length) setPerf((v) => (v?.length ? v : kept))
        // SAID OUT LOUD, either way.
        setPerfError(err instanceof Error ? err.message : 'The record did not answer.')
      })

    let rows: BoardRow[] | null = null
    try {
      // the fast path: one flat file, zero executions — admin only, because a file cannot check a badge
      rows = await readSlice<BoardRow>('behaviorBoard')
    } catch { rows = null }
    const fallBack = (why: string) => {
      // an empty kept board is not a copy worth hiding a failure behind
      const kept = readKept<BoardRow[]>(KEPT_BOARD)
      if (kept?.length) setBoard((b) => b ?? kept)
      setError(why)
    }
    if (!rows?.length) {
      // a manager is answered from the house instead, scoped by the backend (one execution)
      try {
        const r = await gasAction<{ rows: BoardRow[]; sees_all: boolean; own: string }>(
          'behaviorBoard', {}, { timeoutMs: 90000 })
        rows = r?.rows ?? []
      } catch (err) {
        // an empty file followed by a house that did not answer is not "nothing measured" — the failure is what is…
        rows = null
        fallBack(err instanceof Error ? err.message : 'The behaviour board could not be read.')
      }
    }
    if (rows?.length) {
      setBoard(rows)
      keepIfCurrent(KEPT_BOARD, rows, generation)
    } else if (rows) {
      fallBack('Nothing has been measured yet. The relay files what the platform’s own log says once an hour.')
    }
    // ANSWERED IS `rows !== null`: an empty board IS an answer — it says the relay measured nobody — while `null`…
    setBoardAnswered(rows !== null)
    setLoading(false)
    try {
      const r = await gasAction<{ readings: Reading[]; sees_all?: boolean }>(
        'behaviorReadings', {}, { timeoutMs: 60000 })
      const map: Record<string, Reading> = {}
      for (const one of r?.readings ?? []) map[one.subject_key] = one
      setReadings(map)
    } catch { /* the arithmetic stands on its own without a paragraph */ }
  }, [seesRecord])

  useEffect(() => { void load(false) }, [load])

  const runRecompute = () => {
    setRecomputing(true)
    void gasAction<{ rows: number; computed_at: string; stored: boolean }>(
      'staffPerfRecompute', {}, { timeoutMs: 300000 })
      .then((d) => {
        toast({ type: 'success', title: `Record recomputed — ${d.rows} row${d.rows === 1 ? '' : 's'}`,
                body: d.stored ? 'Stored; every next open answers instantly.' : 'Too large to store — the record keeps computing live.' })
        void load(false)
      })
      .catch((e) => toast({ type: 'danger', title: 'The recompute did not run',
                            body: e instanceof Error ? e.message : 'Try again.' }))
      .finally(() => setRecomputing(false))
  }

  const runMigrate = () => {
    setMoving(true)
    void gasAction<{ added: Record<string, number> }>('staffPerfMigrate', {}, { timeoutMs: 300000 })
      .then((d) => {
        const total = Object.values(d.added ?? {}).reduce((a, b) => a + b, 0)
        toast({ type: 'success', title: total ? `${total} rows moved onto our sheets` : 'Nothing new to move',
                body: Object.entries(d.added ?? {}).map(([t, n]) => `${t.replace('perf_', '')}: ${n}`).join(' · ') })
        void load(false)
      })
      .catch((e) => toast({ type: 'danger', title: 'The move did not run',
                            body: e instanceof Error ? e.message : 'Try again.' }))
      .finally(() => setMoving(false))
  }

  // THE TRACKER SCOPES THE WHOLE SCREEN.
  const focus = useContextStore((s) => s.focus)
  const everybody = useMemo(
    () => (board ?? []).filter((r) => r.subject_kind !== 'platform'),
    [board],
  )
  const scope = useMemo(() => {
    if (!focus) return { rows: everybody, matched: false }
    const rows = everybody.filter((p) => rowFocusTier(p, ['subject_name', 'subject_key'], focus) !== 0)
    return { rows: rows.length ? rows : everybody, matched: rows.length > 0 }
  }, [everybody, focus])
  const people = scope.rows
  const machines = useMemo(() => (board ?? []).find((r) => r.subject_kind === 'platform'), [board])
  const evidenced = useMemo(() => people.filter((p) => p.sample !== 'none' || p.worked), [people])
  const counts = useMemo(() => {
    const c: Record<string, number> = { steady: 0, heavy: 0, watch: 0, strained: 0, quiet: 0, unknown: 0 }
    for (const p of people) { const v = rhythmOf(p); c[v] = (c[v] ?? 0) + 1 }
    return c
  }, [people])
  const fromClock = useMemo(() => people.filter((p) => p.rhythm_from === 'work').length, [people])
  const clock = useMemo(() => {
    const src = machines ?? people.find((p) => p.worked_as_of) ?? null
    if (!src?.worked_as_of) return null
    return { at: src.worked_as_of, age: src.worked_age_days, fresh: src.worked_fresh }
  }, [machines, people])
  const rosterStrain = useMemo(
    () => people.filter((p) => p.shift_verdict === 'strained').length, [people])
  const rosterWatch = useMemo(
    () => people.filter((p) => p.shift_verdict === 'watch').length, [people])

  /* ---------------- the join ---------------- */

  // every HR row filed under a name key, so an ambiguous name is VISIBLE as ambiguous rather than resolved to…
  const perfByName = useMemo(() => {
    const m = new Map<string, PerfRow[]>()
    for (const r of perf ?? []) {
      const k = nameKey(r.name)
      if (!k) continue
      const list = m.get(k)
      if (list) list.push(r)
      else m.set(k, [r])
    }
    return m
  }, [perf])

  // THE ACCOUNT SIDE OF THE SAME FOLD — EMPLOYEE ROWS ONLY, AND COUNTED.
  const accountTally = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of everybody) {
      if (!isEmployeeRow(p)) continue
      const k = nameKey(p.subject_name)
      if (k) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [everybody])

  // THE DIRECTORY, FOLDED ON THE SAME KEY — and a SHARED key is DROPPED, not guessed, exactly as the record is two…
  const dirBy = useMemo(() => {
    const tally = new Map<string, number>()
    for (const d of dir ?? []) {
      const k = nameKey(d.name)
      if (k) tally.set(k, (tally.get(k) ?? 0) + 1)
    }
    const m = new Map<string, DirRow>()
    for (const d of dir ?? []) {
      const k = nameKey(d.name)
      if (k && tally.get(k) === 1) m.set(k, d)
    }
    return m
  }, [dir])

  // THE SAME FOLD, KEPT AS A POINTER BACK TO THE ACCOUNT.
  const accountByKey = useMemo(() => {
    const m = new Map<string, BoardRow>()
    for (const p of everybody) {
      if (!isEmployeeRow(p)) continue
      const k = nameKey(p.subject_name)
      if (!k || m.has(k)) continue
      m.set(k, p)
    }
    return m
  }, [everybody])

  // THE JOIN ITSELF, RESOLVED ONCE OVER EVERYBODY.
  const join = useMemo(() => {
    const record = new Map<string, PerfRow>()
    const ambiguous = new Set<string>()
    for (const [k, accounts] of accountTally) {
      const hit = perfByName.get(k)
      if (!hit?.length) continue
      if (accounts > 1 || hit.length > 1) { ambiguous.add(k); continue }
      record.set(k, hit[0])
    }
    return { record, ambiguous }
  }, [accountTally, perfByName])

  // HR rows no platform account reaches — a DSP on the roster who never held a login, and every terminated person…
  const orphans = useMemo(
    () => (perf ?? []).filter((r) => !join.record.has(nameKey(r.name))),
    [perf, join],
  )
  const orphanScope = useMemo(() => {
    if (!focus) return orphans
    // THE SAME EMPLOYEE TEST THE JOIN MAKES, ON THIS SIDE TOO.
    const hit = focus.type === 'staff'
      ? orphans.filter((r) => rowFocusTier(r, ['name'], focus) !== 0)
      : []
    // a scope that bit somewhere narrows here too; one that bit nowhere is dropped, exactly as it is above
    return hit.length || scope.matched ? hit : orphans
  }, [orphans, focus, scope.matched])


  // THE COUNTS BESIDE THE CUTS.
  const whoCounts = useMemo(() => {
    const c: Record<WhoCut, number> = { all: 0, staff: 0, clients: 0, system: 0 }
    for (const p of people) {
      const acct = accountBy.get(p.subject_key)
      const ring = ringOf(p, dirBy.get(nameKey(p.subject_name)), acct)
      c.all++
      if (ring === 'staff-active' || ring === 'staff-inactive') c.staff++
      if (ring === 'client' || ring === 'guardian') c.clients++
      if (SYSTEM_ROLES.has(String(acct?.role || '').toLowerCase())) c.system++
    }
    return c
  }, [people, accountBy, dirBy])

  const stateCounts = useMemo(() => {
    const c: Record<StateCut, number> = { all: 0, active: 0, inactive: 0 }
    for (const p of people) {
      const ring = ringOf(p, dirBy.get(nameKey(p.subject_name)), accountBy.get(p.subject_key))
      c.all++
      if (ring === 'staff-active') c.active++
      if (ring === 'staff-inactive') c.inactive++
    }
    return c
  }, [people, accountBy, dirBy])
  // WHO SURVIVES THE TWO CUTS AND THE SEARCH BOX.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    // A PHONE IS MATCHED ON DIGITS AND ONLY WHEN THREE WERE TYPED.
    const digits = needle.replace(/\D/g, '')
    const cut = (p: BoardRow) => {
      const acct = accountBy.get(p.subject_key)
      const dirRow = dirBy.get(nameKey(p.subject_name))
      const ring = ringOf(p, dirRow, acct)
      if (who === 'staff' && !(ring === 'staff-active' || ring === 'staff-inactive')) return false
      if (who === 'clients' && ring !== 'client' && ring !== 'guardian') return false
      if (who === 'system' && !SYSTEM_ROLES.has(String(acct?.role || '').toLowerCase())) return false
      if (state === 'active' && ring !== 'staff-active') return false
      if (state === 'inactive' && ring !== 'staff-inactive') return false
      if (!needle) return true
      // THE SAME FIELDS THAT CHOOSER SEARCHES, plus this app's own two — the role word and the apps somebody…
      if (p.subject_name.toLowerCase().includes(needle)) return true
      if (p.role.toLowerCase().includes(needle)) return true
      if (p.top_apps.some((a) => a.app.includes(needle))) return true
      if (String(acct?.email || '').toLowerCase().includes(needle)) return true
      if (String(acct?.title || '').toLowerCase().includes(needle)) return true
      if (String(dirRow?.email || '').toLowerCase().includes(needle)) return true
      if (String(dirRow?.role || '').toLowerCase().includes(needle)) return true
      if (digits.length >= 3) {
        const inAcct = String(acct?.phone || '').replace(/\D/g, '').includes(digits)
        const inDir = String(dirRow?.phone || '').replace(/\D/g, '').includes(digits)
        if (inAcct || inDir) return true
      }
      return false
    }
    const list = people.filter(cut)
    return [...list].sort((a, b) => {
      // strain first — this is a call list for a conversation, not a ranking of people.
      const rank = (p: BoardRow) => {
        const v = rhythmOf(p)
        return v === 'strained' || p.shift_verdict === 'strained' ? 0
          : v === 'heavy' ? 1
          : v === 'watch' || p.shift_verdict === 'watch' ? 2
          : p.sample !== 'none' || p.worked ? 3 : 4
      }
      const d = rank(a) - rank(b)
      return d !== 0 ? d : b.metrics.actions - a.metrics.actions
    })
  }, [people, q, who, state, accountBy, dirBy])

  // HAS THE RECORD ANSWERED?
  const recordState: RecordState =
    !perfAnswered ? (perfError ? 'failed' : 'pending')
      : perf?.length ? 'ready'
        : perfMigrated ? 'empty' : 'unmigrated'

  // HAS THE BOARD ANSWERED?
  const boardState: BoardState = !boardAnswered ? (error ? 'failed' : 'pending') : 'ready'

  /** ONE CARD PER PERSON, in the six honest shapes. */
  const cards = useMemo<MergedRow[]>(() => {
    const needle = q.trim().toLowerCase()
    const rows: MergedRow[] = shown.map((p) => {
      const key = p.subject_key
      // A CLIENT IS NOT AN EMPLOYEE, and the record is a book about employees.
      if (!isEmployeeRow(p)) return { key, p, r: null, why: 'client' }
      const k = nameKey(p.subject_name)
      // AMBIGUITY IS WITHHELD, NEVER GUESSED — on either side of the fold
      if (join.ambiguous.has(k)) return { key, p, r: null, why: 'ambiguous' }
      const r = join.record.get(k) ?? null
      return { key, p, r, why: r ? 'reached' : 'unmatched' }
    })
    const tail: MergedRow[] = orphanScope
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) ||
                     r.status.toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      // WHICH OF THE THREE PUT THIS ROW HERE — and the first one is about OUR READ, not about the person.
      .map((r) => ({
        key: `perf:${r.emp_id}`, p: null, r,
        why: boardState !== 'ready' ? ('account-unread' as const)
          : join.ambiguous.has(nameKey(r.name)) ? ('match-refused' as const) : ('no-account' as const),
      }))
    return [...rows, ...tail]
  }, [shown, join, orphanScope, q, boardState])

  // WHAT LEAVES THIS SCREEN, and it is what is ON it.
  const exportRows = useMemo(() => cards.map((row) => {
    const p = row.p
    const name = p?.subject_name || row.r?.name || ''
    const acct = p ? accountBy.get(p.subject_key) : undefined
    const d = dirBy.get(nameKey(name))
    const ring = ringOf(p, d, acct)
    return {
      name,
      role: acct?.role || d?.role || p?.role || '',
      title: acct?.title || '',
      email: acct?.email || d?.email || '',
      phone: formatPhoneDisplay(acct?.phone || d?.phone || ''),
      state: ring === 'client' ? 'Client' : ring === 'guardian' ? familyWord(acct)
        : ring === 'staff-active' ? 'Active' : ring === 'staff-inactive' ? 'Inactive'
          : 'Not on the roster',
      /* PRINTED AS THE BOOK SPELLS IT — two date shapes live in that column. */
      inactive_since: ring === 'staff-inactive' ? (d?.end_date || 'not on file') : '',
      last_sign_in: acct ? lastSignIn(acct.last_login) : '',
      reading: p ? rhythmOf(p) : '',
      grade: row.r && typeof row.r.grade === 'number' ? String(row.r.grade) : '',
    }
  }), [cards, accountBy, dirBy])

  const exportColumns = [
    { key: 'name', label: 'Name' },
    { key: 'role', label: 'Role' },
    { key: 'title', label: 'Title' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'state', label: 'State' },
    { key: 'inactive_since', label: 'Inactive since' },
    { key: 'last_sign_in', label: 'Last sign-in' },
    { key: 'reading', label: 'Wellbeing reading' },
    { key: 'grade', label: 'Grade' },
  ]

  // WHICH PERSON IS OPEN, AND WHICH OF THE HONEST SHAPES THEY ARE.
  const personParam = params.get('person') ?? ''
  const openRow = useMemo<MergedRow | null>(() => {
    if (personParam) {
      const hit = (perf ?? []).find((x) => x.emp_id === personParam) ?? null
      if (!hit) return null
      const k = nameKey(hit.name)
      // AMBIGUITY HAS TWO SIDES and this is the record's side of it
      if (join.ambiguous.has(k)) return { key: `perf:${hit.emp_id}`, p: null, r: hit, why: 'match-refused' }
      const acct = join.record.get(k)?.emp_id === hit.emp_id ? accountByKey.get(k) ?? null : null
      if (acct) return { key: acct.subject_key, p: acct, r: hit, why: 'reached' }
      // AN EMPTY BOARD IS NOT AN ABSENT ACCOUNT.
      if (boardState !== 'ready') {
        return { key: `perf:${hit.emp_id}`, p: null, r: hit, why: 'account-unread' }
      }
      return { key: `perf:${hit.emp_id}`, p: null, r: hit, why: 'no-account' }
    }
    if (!picked) return null
    const p = everybody.find((x) => x.subject_key === picked) ?? null
    if (!p) return null
    // A CLIENT IS NOT AN EMPLOYEE — no lookup, no record half, no record tab
    if (!isEmployeeRow(p)) return { key: p.subject_key, p, r: null, why: 'client' }
    const k = nameKey(p.subject_name)
    if (join.ambiguous.has(k)) return { key: p.subject_key, p, r: null, why: 'ambiguous' }
    const r = join.record.get(k) ?? null
    return { key: p.subject_key, p, r, why: r ? 'reached' : 'unmatched' }
  }, [personParam, picked, perf, everybody, join, accountByKey, boardState])

  // THE RECORD'S DOOR IS STILL THE URL — it just no longer leaves the app.
  const openRecord = useCallback((empId: string) => {
    const next = new URLSearchParams(params)
    next.set('person', empId)
    setParams(next)
  }, [params, setParams])
  const closeRecord = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete('person')
    setParams(next)
  }, [params, setParams])

  if (!seesRecord) {
    return (
      <div className="w-full pb-16">
        <PageHeader
          title="User Support"
          subtitle="The team’s record, beside how each person actually works."
        />
        <Card padded={false}>
          <EmptyState
            title="This app reads the team’s record"
            body="It is open to administrators and managers. Your own reading lives in Behavior Support, which answers you about yourself."
          />
        </Card>
      </div>
    )
  }

  // ONE PROFILE, AND IT IS THIS APP'S OWN.
  if (personParam) {
    if (!openRow) {
      return (
        <div className="w-full pb-16">
          <button
            type="button"
            onClick={closeRecord}
            className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-3 transition-colors hover:text-text-1"
          >
            <ArrowLeft size={14} /> Everybody
          </button>
          {/* A READ STILL IN FLIGHT IS A SKELETON, NEVER A STATED ABSENCE. */}
          {recordState === 'pending' ? (
            <Skeleton className="h-[220px] w-full rounded-[16px]" />
          ) : (
            <Card padded={false}>
              <EmptyState
                title="No record answers to that link"
                body={recordState === 'failed'
                  ? 'The record did not answer just now, so this link could not be resolved. That is a failed read, not a person who is off the roster.'
                  : 'No HR row carries that employee id. The link may be older than the record, or the row may since have been removed.'}
              />
            </Card>
          )}
        </div>
      )
    }
    return (
      <PersonPanel
        row={openRow}
        dirRow={dirBy.get(nameKey(openRow.p?.subject_name || openRow.r?.name || '')) ?? null}
        dirRead={dir !== null}
        recordState={recordState}
        boardState={boardState}
        reading={openRow.p ? readings[openRow.p.subject_key] ?? null : null}
        token={token}
        onBack={closeRecord}
        onReading={(r) => setReadings((m) => ({ ...m, [r.subject_key]: r }))}
      />
    )
  }

  if (openRow) {
    return (
      <PersonPanel
        row={openRow}
        dirRow={dirBy.get(nameKey(openRow.p?.subject_name || openRow.r?.name || '')) ?? null}
        dirRead={dir !== null}
        recordState={recordState}
        boardState={boardState}
        reading={openRow.p ? readings[openRow.p.subject_key] ?? null : null}
        token={token}
        onBack={() => setPicked(null)}
        onReading={(r) => setReadings((m) => ({ ...m, [r.subject_key]: r }))}
      />
    )
  }

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="User Support"
          subtitle="How each person actually works — the platform’s log and the time clock — and what the HR record holds."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <button
                  type="button"
                  onClick={runRecompute}
                  disabled={recomputing}
                  title="Rebuild the precomputed record board from the perf_* tabs right now — the hourly service clock does the same on its own"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  {recomputing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {recomputing ? 'Recomputing…' : 'Recompute'}
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={runMigrate}
                  disabled={moving}
                  title="Copy the old platform's Master Data onto our own sheets — idempotent, only new rows land"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  {moving ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {moving ? 'Moving…' : 'Sync from Master'}
                </button>
              )}
              {/* ── THE ACCOUNT DOORS. Every input the People screen has —
                  new users and the rest — belongs here: 100% of the inputs,
                  the edits and the features.

                  THE BUTTONS ARE OURS, THE DIALOGS ARE THEIRS. This screen
                  keeps its own chrome — it is the prettier one and it is
                  nearly finished — but every door behind these opens the
                  SAME component the Users app opens, exported rather than
                  re-written. A second Add-user form would be a second
                  contract with the backend, and the two would part company
                  the first time either was touched. */}
              {isAdmin && <BulkPassBar />}
              {isAdmin && accounts.some(u_needsActivation as never) && (
                <button
                  type="button"
                  onClick={() => setUserDialog('arm')}
                  title="Give a password to the accounts that have none — they cannot sign in until they do"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
                >
                  <ShieldCheck size={14} /> Arm accounts
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setUserDialog('invite')}
                  title="Send the platform invitation — the sign-in, the first-time password, and what happens next"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
                >
                  <Send size={14} /> Invite
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setUserDialog('create')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
                >
                  <UserPlus size={14} /> Add user
                </button>
              )}
              <button
                type="button"
                onClick={() => void load(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
              >
                <RefreshCw size={14} /> Refresh
              </button>
            {/* EXPORT · SHARE · PRINT — the Users chooser's trio, over the
                cards as they stand. The subtitle promises "as shown on
                screen" and it is kept: these read `exportRows`, which is
                built from `cards` after both cuts and the search. */}
            <ExportMenu filename="user-support" columns={exportColumns} rows={exportRows as never} />
            <button
              type="button"
              aria-label="Share this list"
              title="Share this list"
              onClick={() => share({
                title: 'User Support',
                subtitle: `${exportRows.length} ${exportRows.length === 1 ? 'person' : 'people'} — as shown on screen`,
                rows: exportRows as never,
                columns: exportColumns as never,
                filename: 'user-support',
                icon: 'user-check',
              })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2"
            >
              <Share2 size={15} />
            </button>
            <button
              type="button"
              aria-label="Print"
              title="Print this list"
              onClick={() => window.print()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2"
            >
              <Printer size={15} />
            </button>
            </div>
          }
        />
      </motion.div>

      {/* BOTH BOOKS NAMED, ONCE, ON THE PAGE. A card cannot carry two
          provenance stamps without becoming a receipt; the page can. */}
      <p className="mt-2 text-[11.5px] leading-[1.55] text-text-3">
        The platform’s own log over the last {people[0]?.window_days ?? 30} days
        {clock?.at ? <>, and the time clock to {dayText(clock.at)} ({ageText(clock.age)})</> : null}.
        {/* WHEN THE RECORD WAS COMPUTED — the record screen's own line, in its
            own words. Until it answers, the seams below are painting the kept
            copy and the page says so rather than letting a stamp's absence
            pass for freshness. */}
        {perfAnswered
          ? (perfAt ? ` Record computed ${ohioDateTime(perfAt)}.` : '')
          : perf?.length
            ? ' The record has not answered yet this visit — every seam below is painting this browser’s kept copy from an earlier one.'
            : ''}
        {/* WHETHER THE OTHER BOOK HAS ANSWERED, in the record's own grammar.
            Every account on this page — the hero's denominator, the chips, the
            join behind each card — is read off the behaviour board, so a board
            that has not answered is a fact the page owes the reader before any
            number under it is believed. */}
        {boardState === 'ready' ? ''
          : boardState === 'failed'
            ? (board?.length
                ? ' The behaviour board did not answer this visit — what stands above is this browser’s kept copy from an earlier one, so no HR row is called accountless on the strength of it.'
                : ' The behaviour board did not answer, so nothing here is matched to a platform account and no wellbeing reading stands — unread, which is not the same as nobody having one.')
            : board?.length
              ? ' The behaviour board has not answered yet this visit — the readings are painting this browser’s kept copy, and no HR row is called accountless until a read lands.'
              : ' The behaviour board has not answered yet this visit, so no HR row is matched to a platform account.'}
        {/* THE TAIL IS ONLY "ACCOUNTLESS" ONCE THE BOARD HAS ANSWERED. Until
            then the join reached nobody at all, so this line would be counting
            our own unread and calling it a roster fact. */}
        {boardState === 'ready' && orphanScope.length
          ? ` ${orphanScope.length} row${orphanScope.length === 1 ? '' : 's'} on the HR roster reach no platform account of their own — or none this join would guess at — and are drawn last.`
          : ''}
      </p>

      {/* what the tracker is holding, and whether this board could honour it */}
      <ContextBanner filtered={focus ? scope.matched : undefined} />

      {!board || !people.length ? (
        loading ? <Skeleton className="mb-5 h-[200px] w-full rounded-[16px]" /> : null
      ) : (
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              People with evidence to read
            </p>
            <p className="font-stat text-[60px] leading-none text-white">{evidenced.length}</p>
            <p className="mt-1 text-[12px] text-white/60">
              of {people.length} account{people.length === 1 ? '' : 's'} · the platform’s log over the last
              {' '}{people[0]?.window_days ?? 30} days, and the time clock
              {clock?.at ? ` to ${dayText(clock.at)}` : ''}
            </p>
            {people.length > evidenced.length && (
              <p className="mt-1.5 text-[12px] text-white/50">
                {people.length - evidenced.length} account{people.length - evidenced.length === 1 ? '' : 's'} appear
                in neither. Nothing is known about how they work — which is not the same as a good rhythm.
              </p>
            )}
            {/* THE HERO COUNTS ACCOUNTS. An HR row with no account is not one,
                and quietly adding it to this denominator would make the bar
                below claim a verdict about somebody nothing measured.
                AND IT SAYS "no account" ONLY WHEN THE BOARD HAS ANSWERED — the
                same law as the tail's own cards: while the board is unread the
                join reaches nobody, so this line can count rows and must not
                say what they lack. */}
            {orphanScope.length > 0 && (
              <p className="mt-1.5 text-[12px] text-white/50">
                {boardState === 'ready' ? (
                  <>{orphanScope.length} further row{orphanScope.length === 1 ? '' : 's'} on the HR roster reach no
                    platform account of their own — or none the match would guess at — so nothing above counts them.</>
                ) : (
                  <>{orphanScope.length} further row{orphanScope.length === 1 ? '' : 's'} on the HR roster
                    {boardState === 'failed'
                      ? (board?.length
                          ? ' are not matched to a platform account in this browser’s kept copy — the live read did not answer'
                          : ' could not be matched to a platform account, because that read did not answer')
                      : ' are not matched to a platform account yet this visit'} — nothing above counts them.</>
                )}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              How their rhythm reads — the platform and the time clock together
            </p>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {(['strained', 'heavy', 'watch', 'steady', 'quiet'] as const).map((k) => (
                counts[k] ? (
                  <span
                    key={k}
                    title={`${counts[k]} ${k}`}
                    style={{ width: `${(counts[k] / Math.max(1, people.length)) * 100}%`,
                             background: heroBand(verdictOf(k).tint) }}
                  />
                ) : null
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-white/70">
              {(['strained', 'heavy', 'watch', 'steady', 'quiet'] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: heroBand(verdictOf(k).tint) }} />
                  {verdictOf(k).label} <span className="font-stat text-white">{counts[k] ?? 0}</span>
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full border border-white/40" />
                Not read <span className="font-stat text-white">{counts.unknown ?? 0}</span>
              </span>
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.55] text-white/70">
              {fromClock > 0 ? (
                <>
                  <span className="font-stat text-white">{fromClock}</span> of these read the way they do because
                  of the TIME CLOCK, not the platform — hours actually worked, nights in a row, the gap between
                  clocking out and back in.
                </>
              ) : (
                <>No reading here is coming from the time clock right now — every verdict below is about how
                  people use the platform, which is only half of a working life.</>
              )}
              {clock?.at && (
                <>
                  {' '}The stored copy of PsiAnywhere’s punches stopped when its scraper lost port 8443: its newest shift is {dayText(clock.at)}
                  {typeof clock.age === 'number' ? `, ${ageText(clock.age)}` : ''}
                  {clock.fresh === false
                    ? ' — old enough that it no longer sets anybody’s reading; it is kept as evidence of the period it covers.'
                    : '.'}
                </>
              )}
            </p>
            {(rosterStrain > 0 || rosterWatch > 0) && (
              <p className="mt-3 text-[12.5px] text-white/80">
                On the roster, <span className="font-stat text-white">{rosterStrain}</span> person
                {rosterStrain === 1 ? '' : 's'} read as strained
                {rosterWatch ? <> and <span className="font-stat text-white">{rosterWatch}</span> as worth watching</> : null}
                {' '}— long unbroken runs, six-shift weeks, or a majority of overnights.
              </p>
            )}
          </div>
        </div>
      </div>
      )}

      {/* WHAT THIS SCREEN IS, ON THE SCREEN — and now what it is NOT, twice
          over, because the two halves of a card come from two books that
          judge in opposite directions. */}
      <p className="mb-4 text-[11.5px] leading-[1.55] text-text-3">
        Above the seam on each card is a WELLBEING reading — it reads who did what kind of thing and when, never
        a message, a client record or the reason anybody was absent, and no absence makes it read worse. Below
        the seam is the HR record, which is the opposite kind of fact: attendance, incidents and certifications,
        with a grade that starts at 10 and subtracts. They are kept apart because one word cannot do both jobs.
      </p>

      {!!people.length && (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatChip label="with a reading" value={Object.keys(readings).length} tint="lavender" />
        <StatChip label="on the roster" value={people.filter((p) => p.shifts?.shifts).length} tint="blue" />
        <StatChip label="on the time clock" value={people.filter((p) => p.worked).length} tint="violet" />
        <StatChip label="work with forms" value={people.filter((p) => p.forms_actions > 0).length} tint="mint" />
        <StatChip label="reach beyond headquarters"
          value={people.filter((p) => p.reach_verdict === 'multi' || p.reach_verdict === 'own-world').length}
          tint="peach" />
        {machines && (
          <StatChip label="actions by the platform's own machines"
            value={machines.metrics.actions.toLocaleString()} tint="slate" />
        )}
      </div>
      )}


      {/* ── THE TWO CUTS, with their counts. Everything the People chooser
          offers has to be here too.

          THEY COUNT WHAT THE CUT WOULD LEAVE, not what is on screen — a count
          that moved when you typed in the search box would be answering a
          different question from the one its label asks.

          DEFAULT IS ALL, on both. The Users screen's own ruling stands: one
          list, and the row says which. A count answers the question without
          hiding anybody, and one click narrows. */}
      {tab === 'people' && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-1">
            {([
              ['all', 'All'], ['staff', 'Staff'], ['clients', 'Clients'], ['system', 'System'],
            ] as [WhoCut, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setWho(id)}
                className={cn('rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors',
                  who === id ? 'bg-primary-soft text-primary' : 'text-text-3 hover:bg-surface-2')}
              >
                {label}
                <span className="ml-1.5 font-stat text-[11px] opacity-70">{whoCounts[id]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {([
              ['all', 'Any state'], ['active', 'Active'], ['inactive', 'Inactive'],
            ] as [StateCut, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setState(id)}
                className={cn('rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors',
                  state === id ? 'bg-primary-soft text-primary' : 'text-text-3 hover:bg-surface-2')}
              >
                {label}
                {id !== 'all' && (
                  <span className="ml-1.5 font-stat text-[11px] opacity-70">{stateCounts[id]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-4 flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn('-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors',
              tab === t.id ? cn('border-current', TINT_FG.lavender)
                : 'border-transparent text-text-3 hover:text-text-2')}
          >
            {t.label}
            {t.id === 'people' && (
              <span className="ml-1.5 font-stat text-[11.5px] opacity-70">{people.length + orphanScope.length}</span>
            )}
            {t.id === 'health' && (rosterStrain + (counts.strained ?? 0)) > 0 && (
              <span className="ml-1.5 font-stat text-[11.5px] opacity-70">{rosterStrain + (counts.strained ?? 0)}</span>
            )}
          </button>
        ))}
        {tab === 'people' && (
          <div className="ml-auto flex items-center gap-1.5 pb-2">
            <Search size={13} className="text-text-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, e-mail, phone, title or app…"
              className="h-8 w-[220px] rounded-sm border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary/50"
            />
          </div>
        )}
      </div>

      {error && (
        <Card padded={false} className="mb-4 p-4">
          <p className="flex items-start gap-2 text-[13px] text-text-2">
            <AlertTriangle size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} /> {error}
          </p>
        </Card>
      )}

      {/* A FAILED READ IS NEVER AN EMPTY READ. The half that did load is still
          drawn; what is said is that the other one did not answer. */}
      {perfError && (
        <Card padded={false} className="mb-4 p-4">
          <p className="flex items-start gap-2 text-[13px] leading-[1.55] text-text-2">
            <AlertTriangle size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
            <span>
              {perf?.length
                ? <>The record did not answer just now — {perfError} What is drawn under each seam below is the
                    last stored copy, not this minute’s truth.</>
                : <>The record could not be read — {perfError} Every card below shows its wellbeing half only:
                    no grade, no call-offs, no incidents, and nobody who is on the HR roster without a platform
                    account. That is a failed read, not a clean record and not a shorter roster.</>}
            </span>
          </p>
        </Card>
      )}

      {loading && !board && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {/* "NOTHING FILED" IS A CLAIM ABOUT THE BOARD, so it waits for the board.
          A failed read leaves an empty list behind too, and the banner above
          already says which read it was. */}
      {!loading && board && boardState === 'ready' && people.length === 0 && orphanScope.length === 0 && (
        <Card padded={false}>
          <EmptyState
            title="Nobody to read yet"
            body="The relay measures how people use the platform from the platform's own log, once an hour. Nothing has been filed yet."
          />
        </Card>
      )}

      {tab === 'people' && cards.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((row, i) => (
            <MergedCard
              key={row.key}
              row={row}
              account={accountBy.get(row.p?.subject_key ?? '')}
              ring={ringOf(row.p, dirBy.get(nameKey(row.p?.subject_name || row.r?.name || '')), accountBy.get(row.p?.subject_key ?? ''))}
              inactiveSince={dirBy.get(nameKey(row.p?.subject_name || row.r?.name || ''))?.end_date || undefined}
              recordState={recordState}
              recordAnswered={perfAnswered}
              boardState={boardState}
              boardKept={!!board?.length}
              reading={row.p ? readings[row.p.subject_key] ?? null : null}
              index={i}
              onOpen={() => {
                // ONE DOOR PER CARD, AND IT OPENS THIS APP'S OWN PROFILE.
                if (row.p) setPicked(row.p.subject_key)
                else if (row.r) openRecord(row.r.emp_id)
              }}
            />
          ))}
        </div>
      )}

      {/* THE OTHER TWO TABS COUNT WHAT THE PLATFORM READ, so they operate on
          `people` alone — an HR row with no account has no rhythm to draw. */}
      {tab === 'rhythm' && <RhythmView people={people} machines={machines ?? null} />}
      {tab === 'health' && <HealthView people={people} onOpen={setPicked} />}

      {/* THE ACCOUNT DIALOGS, MOUNTED. Each is the Users section's own — the
          same form, the same validation, the same call to the backend. A
          second copy of any of them would be a second contract, and this
          platform has paid for that twice today already. */}
      {userDialog === 'create' && (
        <CreateUserDialog
          roles={VARIANT_ROLES.all}
          onClose={() => setUserDialog(null)}
          onDone={reloadAccounts}
        />
      )}
      {userDialog === 'invite' && (
        <InviteDialog
          users={accounts as never}
          preselected={new Set<string>()}
          onClose={() => setUserDialog(null)}
        />
      )}
      {userDialog === 'arm' && (
        <ArmAccountsDialog
          users={(accounts as never[]).filter(u_needsActivation as never)}
          preselected={new Set<string>()}
          onClose={() => setUserDialog(null)}
          onDone={reloadAccounts}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ ONE CARD, TWO LIVES, ONE SEAM…

// The wellbeing half above, the record below a rule and on its own paper.
function MergedCard({ row, recordState, recordAnswered, boardState, boardKept, reading, index, onOpen, account, ring, inactiveSince }: {
  row: MergedRow
  recordState: RecordState
  // whether the record has ANSWERED this visit — see the page's own note.
  recordAnswered: boolean
  // and whether the BOARD has, which is what decides whether this card may say anything at all about the person's…
  boardState: BoardState
  // and whether a KEPT COPY is painting while that read failed.
  boardKept: boolean
  reading: Reading | null
  index: number
  onOpen: () => void
  /** the platform account for this person, or null when none reaches them */
  account: UserRow | null | undefined
  /** the portrait ring — client/guardian red, staff green or blue */
  ring: RingKind
  /** the directory's end date, when the roster has let them go */
  inactiveSince?: string
}) {
  const p = row.p
  const r = row.r
  // THE SAME THREE WORDS THE PROFILE USES (`accountUnread` in PersonPanel), so the tile and the panel behind it can…
  const accountUnread: '' | 'pending' | 'failed' =
    row.why !== 'account-unread' ? '' : boardState === 'failed' ? 'failed' : 'pending'
  const quiet = !!p && p.sample === 'none'
  const w = p?.worked ?? null
  // nothing at all is known about this person's rhythm — neither axis ran
  const blind = quiet && !w

  const roleLine = p ? (p.title || p.role) : ''
  const rosterWord = p?.roster_status ?? ''
  const subtitle = !p
    ? (r?.hire_date ? `Since ${r.hire_date}` : r?.email || '—')
    : !r
      ? `${roleLine}${rosterWord ? ` · ${rosterWord}` : ''}`
      : rosterWord && r.status && rosterWord.toLowerCase() !== r.status.toLowerCase()
        ? `${roleLine} · roster says ${rosterWord}`
        : roleLine

  // THE WHOLE CARD IS THE DOOR, and it opens the ONE merged profile this app holds — the wellbeing half above the…
  const opens = !!p || !!r

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO, delay: Math.min(index, 8) * 0.04 }}
    >
      <Card hover className={opens ? 'cursor-pointer' : undefined}>
        <div
          onClick={opens ? onOpen : undefined}
          role={opens ? 'button' : undefined}
          tabIndex={opens ? 0 : undefined}
          onKeyDown={opens ? (e) => { if (e.key === 'Enter') onOpen() } : undefined}
        >
          <div className="flex items-start gap-3">
            {/* NOTHING ELSE JOINS THIS ROW. It already holds three columns and
                is the first thing to break at 380px — the status chip and the
                grade live in the band, below the seam, where they belong. */}
            {p ? (
              <TrackerName p={p}>
                <span title={ring ? RING_TITLE[ring] : undefined}><Avatar name={p.subject_name} size="md" className={ringClass(ring)} /></span>
              </TrackerName>
            ) : (
              // NOT DRAGGABLE.
              <span title={ring ? RING_TITLE[ring] : undefined}><Avatar name={r?.name ?? ''} size="md" className={ringClass(ring)} /></span>
            )}
            <div className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                {p ? (
                  <TrackerName p={p} className="block truncate text-[14px] font-semibold text-text-1"
                               title="Drag this name onto the tracker, top left">
                    {p.subject_name || 'Unnamed account'}
                  </TrackerName>
                ) : (
                  <span className="block truncate text-[14px] font-semibold text-text-1">
                    {r?.name || 'Unnamed record'}
                  </span>
                )}
              </span>
              <p className="truncate text-[11.5px] text-text-3">{subtitle}</p>
            </div>
            {/* ONE VERDICT, AND WHICH LIFE IT CAME FROM. */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              <VerdictChip v={p ? rhythmOf(p) : 'unknown'} small />
              {/* THE CAPTION UNDER THE CHIP IS A CLAIM — and there is nothing
                  to claim while the board is unread. In flight it is a
                  Skeleton; failed, it names the unread. */}
              {accountUnread === 'pending' ? (
                <Skeleton className="h-[10px] w-[86px] rounded-full" />
              ) : (
                <span className="text-[10px] text-text-3">
                  {!p
                    ? accountUnread === 'failed' ? 'account unread'
                      : row.why === 'match-refused' ? 'account not matched' : 'no platform account'
                    : p.rhythm_from ? axisText(p.rhythm_from) : 'no evidence'}
                </span>
              )}
            </div>
          </div>

          {!p ? (
            // THREE DIFFERENT FACTS, THREE DIFFERENT SENTENCES — and the first of them is about this page, not…
            accountUnread === 'pending' ? (
              <div className="mt-3 space-y-1.5">
                <Skeleton className="h-[12px] w-full rounded-full" />
                <Skeleton className="h-[12px] w-3/4 rounded-full" />
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] leading-[1.5] text-text-3">
                {accountUnread === 'failed' && boardKept
                  ? <>The live read of the behaviour board did not answer. In this browser’s kept copy
                      no platform account answers to this name — what we last knew, not what is true
                      now. The record below is this row’s own.</>
                  : accountUnread === 'failed'
                  ? <>The behaviour board did not answer, so whether this person holds a platform account is
                      UNREAD — and their wellbeing reading, the platform’s log and the time clock with it. None of
                      that is a finding about them. The record below is this row’s own.</>
                  : row.why === 'match-refused'
                  ? <>More than one person answers to this name — on the HR roster, on the platform, or on both.
                      The platform account was not guessed at, so nothing here reads a log or a time clock for
                      them. The record below is this row’s own.</>
                  : <>This person is on the HR roster and holds no platform account, so neither the platform’s
                      log nor the time clock has anything to read about them.</>}
              </p>
            )
          ) : blind ? (
            <p className="mt-3 text-[12.5px] text-text-3">
              Neither the platform’s log nor the time clock holds anything for this account in the window.
              That is the absence of evidence, not a good rhythm and not a fault.
            </p>
          ) : (
            <>
              {w && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-2">
                  <span><span className="font-stat text-text-1">{w.shifts}</span> shift{w.shifts === 1 ? '' : 's'} punched</span>
                  <span><span className="font-stat text-text-1">{hoursText(w.hours)}</span> worked</span>
                  {w.nights > 0 && (
                    <span className={TINT_FG.amber}>
                      <span className="font-stat">{w.nights}</span> at night
                      {w.night_run_days >= 2 ? `, ${w.night_run_days} running` : ''}
                    </span>
                  )}
                  {w.hours_per_week !== null && (
                    <span><span className="font-stat text-text-1">{w.hours_per_week}</span> h/week</span>
                  )}
                </div>
              )}
              {w ? (
                <div className="mt-2"><AsOf at={w.as_of} age={w.age_days} fresh={w.fresh} what="time clock" /></div>
              ) : (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-3">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-text-3" />
                  time clock: no record — hours unread, not zero
                </p>
              )}

              {quiet ? (
                <p className="mt-3 border-t border-border pt-2.5 text-[12px] text-text-3">
                  The platform’s own log recorded nothing for this account in the window — their work happens
                  elsewhere.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2.5 text-[12px] text-text-2">
                    <span><span className="font-stat text-text-1">{p.metrics.actions.toLocaleString()}</span> actions</span>
                    <span><span className="font-stat text-text-1">{p.metrics.active_days}</span> day{p.metrics.active_days === 1 ? '' : 's'}</span>
                    {p.metrics.night_actions > 0 && (
                      <span className={TINT_FG.amber}>
                        <span className="font-stat">{p.metrics.night_actions}</span> at night
                      </span>
                    )}
                    {!!p.shifts?.shifts && <span><span className="font-stat text-text-1">{p.shifts.shifts}</span> rostered</span>}
                  </div>
                  {p.top_apps.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.top_apps.slice(0, 4).map((a, i) => (
                        <span key={a.app}
                          className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                            TINT_BG[APP_TINT[i % APP_TINT.length]], TINT_FG[APP_TINT[i % APP_TINT.length]])}>
                          {a.app} {a.n}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {reading?.reading && (
            <p className="mt-3 flex gap-1.5 border-t border-border pt-2.5 text-[12px] leading-[1.55] text-text-2">
              <Sparkles size={13} className={cn('mt-0.5 shrink-0', TINT_FG.lavender)} />
              <span className="clamp-2">{reading.reading}</span>
            </p>
          )}
        </div>

        {/* THE SEAM. Outside the body's click region on purpose: the record
            reads as a second storey and a thumb landing on it lands on the
            same door the rest of the card is — this app's own merged profile,
            where both halves live. Nothing on this card leaves the app.

            A CLIENT CARD HAS NO SEAM AT ALL. There is no HR record for a
            client and there never will be, so an empty band saying one is
            missing would accuse our filing of a gap that does not exist. */}
        {row.why !== 'client' && (
          <RecordBand row={row} state={recordState} answered={recordAnswered} />
        )}
        <AccountBand account={account} ring={ring} inactiveSince={inactiveSince} />
      </Card>
    </motion.div>
  )
}

// THE ACCOUNT BAND — the card's third storey.
function AccountBand({ account, ring, inactiveSince }: { account: UserRow | null | undefined; ring: RingKind; inactiveSince?: string }) {
  if (!account) return null
  // THE STATE COMES FROM THE SAME PLACE THE RING DOES, and that is the whole repair.
  const word = ring === 'client' ? 'Client'
    : ring === 'guardian' ? familyWord(account)
      : ring === 'staff-active' ? 'Active'
        : ring === 'staff-inactive' ? 'Inactive'
          : 'Not on the roster'
  const dot = ring === 'staff-active' ? 'bg-tint-fg-mint'
    : ring === 'staff-inactive' ? 'bg-tint-fg-blue'
      : ring ? 'bg-tint-fg-pink' : 'bg-border'
  // WHEN THE ROSTER LET THEM GO, SAID PLAINLY AND WITHOUT ALARM: do not deactivate anybody, leave the account be…
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-text-3">
        The account
      </p>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[11.5px] text-text-2">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
          {word}
        </span>
        {account.role ? <RoleBadge user={{ role: account.role as never, isMaster: false }} size="xs" /> : null}
        {account.title ? <span className="min-w-0 truncate text-[11.5px] text-text-3">{account.title}</span> : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px]">
        {account.email ? <span className="min-w-0 truncate text-text-2">{account.email}</span> : null}
        {/* every extra e-mail the account carries (Contacts) — each one signs the person in too */}
        {(account.emails ?? []).filter((e) => e && e.toLowerCase() !== String(account.email ?? '').toLowerCase()).map((e) => (
          <span key={e} className="min-w-0 truncate text-text-2" data-extra-email="">{e}</span>
        ))}
        {account.phone ? <span className="shrink-0 text-text-2">{formatPhoneDisplay(account.phone)}</span> : null}
        <span className="shrink-0 text-text-3">{lastSignIn(account.last_login)}</span>
      </div>
      {/* WHEN THE ROSTER LET THEM GO — said plainly and without alarm:
          nobody is deactivated, the account is left be and marked
          "inactive since xxx". The account is NOT touched: a login that
          stays open is an administrative decision and not this screen's.
          The date is the directory's
          own end date, printed as the book spells it — two shapes live in
          that column and a parser would age somebody by a decade. */}
      {/* AND THE ABSENCE IS VISIBLE TOO. Forty of the inactive rows carry no
          end date, and a line that simply did not appear for them read as
          "no date needed" rather than "the book does not have one". */}
      {ring === 'staff-inactive' && (
        <p className="mt-1.5 text-[11px] leading-4 text-text-3">
          {inactiveSince ? <>Inactive since {inactiveSince}</> : 'Inactive — no end date on file'}
        </p>
      )}
    </div>
  )
}

// THE SIGN-IN COLUMN, in the words the Users list uses: a day count, or Never.
function lastSignIn(v?: string): string {
  const raw = String(v || '').trim()
  if (!raw) return 'Never signed in'
  const t = Date.parse(raw)
  if (Number.isNaN(t)) return 'Never signed in'
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000))
  return days === 0 ? 'Signed in today' : `Signed in ${days}d ago`
}

// THE RECORD, UNDER ITS OWN EYEBROW.
function RecordBand({ row, state, answered }: {
  row: MergedRow
  state: RecordState
  // has the record answered THIS visit?
  answered: boolean
}) {
  const { p, r } = row
  const t = p?.training ?? null
  const g = r && Number.isFinite(r.grade) ? r.grade : null

  // the credential clock — the FOLDED course record, never the record board's doubled counts, and never the HR row…
  const credentialClock = (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-text-3">
      <GraduationCap size={10} className="shrink-0" />
      {p?.training_verdict && <VerdictChip v={p.training_verdict} small />}
      {t ? (
        (t.expired || t.expiring) ? (
          <span>
            {t.expired ? <><span className="font-stat">{t.expired}</span> past its date</> : null}
            {t.expired && t.expiring ? ' · ' : ''}
            {t.expiring ? <><span className="font-stat">{t.expiring}</span> renewing</> : null}
          </span>
        ) : <span>every course in date</span>
      ) : (
        <span>
          {p
            ? 'no course record reaches this name'
            : 'the course record is folded onto platform accounts — unread for this name'}
        </span>
      )}
    </div>
  )

  return (
    <div className="-mx-5 -mb-5 mt-3 rounded-b-lg border-t border-border bg-surface-2 px-5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-3">The record</span>
        <span className="text-[10px] text-text-3">attendance · incidents · certifications</span>
      </div>

      {!r ? (
        <>
          <div className="mt-2">
            {state === 'pending' ? (
              // STILL IN FLIGHT.
              <Skeleton className="h-[38px] w-full rounded-[10px]" />
            ) : (
              <NotOnFile>
                {state === 'failed'
                  ? <>The record did not answer. Nothing in this box is about this person’s file — the grade,
                      the call-offs and the incidents are simply unread.</>
                  : state === 'unmigrated'
                    ? <>The record has never been brought in from the old platform, so it holds nothing about
                        anybody. The grade, the call-offs and the incidents are unread for everyone on this
                        board, not for this person in particular.</>
                    : state === 'empty'
                      ? <>The record answered with no rows at all. The grade, the call-offs and the incidents
                          are unread for everyone on this board, not for this person in particular.</>
                      : row.why === 'ambiguous'
                        ? <>More than one person answers to this name — on the HR roster, on the platform, or
                            on both. The record is withheld rather than risk showing somebody else’s.</>
                        : <>No HR record reaches this name. The record is filed by name, so this is a gap in our
                            filing — the grade, the call-offs and the incidents are unread, not clean.</>}
              </NotOnFile>
            )}
          </div>
          {/* WHAT IS STILL KNOWN IS STILL SHOWN. The courses come from the
              behaviour row, so a missing HR row never silences them. */}
          {credentialClock}
        </>
      ) : (
        <>
          {/* A KEPT COPY IS A FAST PAINT, NOT A FACT. Until the record has
              answered this visit, everything below came out of this browser's
              own copy from an earlier one — and that copy carries no stamp a
              screen can read (lib/kept keeps the value, not its date), so its
              age is unknown. Said in the same dashed box every other unknown
              on this card wears, and gone the moment the read lands. */}
          {!answered && (
            <div className="mt-2">
              <NotOnFile>
                The record has not answered yet this visit. What is below is the copy this browser kept from an
                earlier one — what we last knew about this person, not what the record says now.
              </NotOnFile>
            </div>
          )}
          {/* the standing */}
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <span className="flex shrink-0 flex-col items-start gap-0.5">
              {g === null ? (
                <span className="rounded-md bg-surface-3 px-2 py-0.5 text-[13px] font-bold tabular-nums text-text-3">—</span>
              ) : (
                <span className={cn('rounded-md px-2 py-0.5 text-[13px] font-bold tabular-nums', gradeChip(g))}>
                  {g.toFixed(1)}
                </span>
              )}
              <span className="text-[10px] text-text-3">
                {g === null ? 'no grade on the record' : 'out of 10 · from the record'}
              </span>
            </span>
            {/* the fallback is bg-surface-3: on this band's own bg-surface-2
                paper the record screen's surface-2 fallback would vanish */}
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
              STATUS_CHIP[r.status] ?? 'bg-surface-3 text-text-3')}>
              {r.status || '—'}
            </span>
            {r.hire_date && <span className="text-[11px] text-text-3">Since {r.hire_date}</span>}
          </div>

          {/* what made it — each clause its own span, so a narrow card breaks
              between them and never mid-sentence */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-text-3">
            <span>
              <AlarmClock size={10} className="mr-1 inline" />
              <span className="font-stat">{r.attendance_90d}</span> call-off{r.attendance_90d === 1 ? '' : 's'} in
              90d ({r.attendance_all} ever)
            </span>
            {r.incidents > 0 && (
              <span>
                <ShieldAlert size={10} className="mr-1 inline" />
                <span className="font-stat">{r.incidents}</span> incident{r.incidents === 1 ? '' : 's'}
                {r.incidents_major ? ` (${r.incidents_major} major)` : ''}
              </span>
            )}
          </div>

          {credentialClock}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function RhythmView({ people, machines }: { people: BoardRow[]; machines: BoardRow | null }) {
  // the log's own drawings are about the people the LOG saw; the working-life strip below is about the people the…
  const logged = useMemo(() => people.filter((p) => p.sample !== 'none'), [people])
  const apps = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of logged) for (const a of p.top_apps) c[a.app] = (c[a.app] ?? 0) + a.n
    return Object.entries(c).map(([app, n]) => ({ app, n })).sort((a, b) => b.n - a.n)
  }, [logged])
  const hours = useMemo(() => {
    const h = new Array(24).fill(0)
    for (const p of logged) p.metrics.hours?.forEach((n, i) => { h[i] += n })
    return h
  }, [logged])
  const rail = useMemo(() => {
    const byDay: Record<string, number> = {}
    for (const p of logged) for (const d of p.metrics.rail ?? []) byDay[d.day] = (byDay[d.day] ?? 0) + d.n
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, n }))
  }, [logged])
  const night = logged.reduce((s, p) => s + p.metrics.night_actions, 0)
  const weekend = logged.reduce((s, p) => s + p.metrics.weekend_actions, 0)
  const total = logged.reduce((s, p) => s + p.metrics.actions, 0)

  // THE SHAPE OF THE WORKFORCE'S REAL WEEK, counted only over the people the punch record can actually see, and…
  const clocked = useMemo(() => people.filter((p) => p.worked), [people])
  const work = useMemo(() => {
    if (!clocked.length) return null
    const w = clocked.map((p) => p.worked!)
    const rates = w.map((x) => x.hours_per_week).filter((x): x is number => x !== null).sort((a, b) => a - b)
    return {
      people: w.length,
      hours: w.reduce((s, x) => s + x.hours, 0),
      nights: w.reduce((s, x) => s + x.nights, 0),
      runs: w.filter((x) => x.night_run_days >= 4).length,
      quick: w.filter((x) => x.quick_turnarounds > 0).length,
      stretch: w.filter((x) => x.longest_stretch_h >= 24).length,
      median: rates.length ? rates[Math.floor(rates.length / 2)] : null,
      rated: rates.length,
      as_of: w[0].as_of,
      age: w[0].age_days,
      fresh: w.every((x) => x.fresh),
    }
  }, [clocked])

  if (!people.length) {
    return <Card padded={false}><EmptyState title="No rhythm to draw yet" body="Nobody has been measured in this window." /></Card>
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {/* THE HOURS PEOPLE ACTUALLY WORKED, before the hours they clicked.
            Counts, never a ranking: no name is printed on this card. */}
        <Card>
          <CardHeader
            title="The week this workforce actually worked"
            sub={work
              ? `Counted from the time clock, over the ${work.people} of ${people.length} account(s) it can see.`
              : 'The time clock reaches nobody on this board.'} />
          {work ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Hours clocked" value={Math.round(work.hours).toLocaleString()} />
                <Tile label="Median a week" value={work.median === null ? '—' : hoursText(work.median)} />
                <Tile label="Nights worked" value={work.nights.toLocaleString()} tint={work.nights ? 'amber' : undefined} />
                <Tile label="4+ nights running" value={work.runs} tint={work.runs ? 'pink' : undefined} />
              </div>
              <p className="mt-3 text-[12.5px] leading-[1.55] text-text-2">
                <span className="font-stat text-text-1">{work.quick}</span> person(s) clocked back in less than
                ten hours after clocking out, and <span className="font-stat text-text-1">{work.stretch}</span>{' '}
                spent 24 hours or more clocked in with no gap between shifts.
                {work.median === null
                  ? ' No weekly rate could be taken: nobody has a week of punched span.'
                  : ` The weekly rate is an average over each person's punched span, taken for ${work.rated} of them.`}
              </p>
              <div className="mt-3">
                <AsOf at={work.as_of} age={work.age} fresh={work.fresh} what="punches" />
              </div>
              {people.length > work.people && (
                <p className="mt-2 text-[11.5px] leading-[1.45] text-text-3">
                  The other {people.length - work.people} account(s) are not in the punch record at all. Their
                  hours are unread — none of the numbers above says anything about them.
                </p>
              )}
            </>
          ) : (
            <NotOnFile>
              No punch record reaches anybody on this board, so there is nothing to say about hours, nights or
              turnaround. That is a gap in what we hold, not a quiet workforce.
            </NotOnFile>
          )}
        </Card>
        <Card>
          <CardHeader title="Where the platform work happens"
            sub={`Every recorded action in the window, grouped by the app it belongs to — the ${logged.length} account(s) the log saw.`} />
          <AppBars apps={apps} cap={10} />
        </Card>
        <Card>
          <CardHeader title="The last fortnight" sub="One column a day, the whole company. Weekends wear amber." />
          <DayRail rail={rail.slice(-15)} />
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="The hours people are on the platform"
            sub="On Ohio's clock. Amber is 10pm to 5am. This is clicking, not shifts — the time clock answers shifts." />
          <HourClock hours={hours} />
          <div className="mt-4 space-y-2 border-t border-border pt-3 text-[12.5px] text-text-2">
            <p className="flex items-center justify-between">
              <span>After 10pm or before 5am</span>
              <span className="font-stat text-text-1">
                {night.toLocaleString()} <span className="text-[11px] text-text-3">
                  ({total ? Math.round((night / total) * 100) : 0}%)</span>
              </span>
            </p>
            <p className="flex items-center justify-between">
              <span>At weekends</span>
              <span className="font-stat text-text-1">
                {weekend.toLocaleString()} <span className="text-[11px] text-text-3">
                  ({total ? Math.round((weekend / total) * 100) : 0}%)</span>
              </span>
            </p>
          </div>
        </Card>
        {machines && (
          <Card>
            <CardHeader title="And the platform's own machines"
              sub="Counted apart, so nobody's rhythm is judged on a sweep's work." />
            <p className="font-stat text-[26px] text-text-1">{machines.metrics.actions.toLocaleString()}</p>
            <p className="mt-1 text-[12px] text-text-3">{machines.site_why}</p>
            {!!machines.unattributed_rows && (
              <p className="mt-2 text-[11.5px] text-text-3">
                {machines.unattributed_rows.toLocaleString()} further action(s) came from
                {' '}{machines.unattributed_actors} actor(s) with no account row — neither judged nor hidden.
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function HealthView({ people, onOpen }: { people: BoardRow[]; onOpen: (k: string) => void }) {
  // THE BANDS READ THE FUSED VERDICT, so somebody strained at the time clock lands here even if the platform's log…
  const strained = people.filter((p) => rhythmOf(p) === 'strained' || p.shift_verdict === 'strained')
  const watch = people.filter((p) => !strained.includes(p) &&
    (rhythmOf(p) === 'heavy' || rhythmOf(p) === 'watch' || p.shift_verdict === 'watch'))
  const known = (p: BoardRow) => p.sample !== 'none' || !!p.worked || !!p.shifts?.shifts
  const steady = people.filter((p) => !strained.includes(p) && !watch.includes(p) && known(p))
  const unread = people.filter((p) => !known(p))

  const bands: { title: string; dot: string; note: string; rows: BoardRow[] }[] = [
    { title: 'Worth a conversation', dot: 'bg-tint-fg-pink', rows: strained,
      note: 'Two or more strain signals at once — nights in a row, a week of hours above this workforce’s own norm, turnarounds too short to sleep in, or days without one off.' },
    { title: 'Worth watching', dot: 'bg-tint-fg-amber', rows: watch,
      note: 'One signal above the norm, on the platform or on the clock. Not a problem yet.' },
    { title: 'A steady rhythm', dot: 'bg-tint-fg-mint', rows: steady,
      note: 'Nothing in what is on record suggests strain. Only ever as good as the axes that actually ran.' },
    { title: 'Not enough evidence', dot: 'bg-border', rows: unread,
      note: 'No log, no punch, no worked shift. This is a gap in what we hold — never a verdict about the person, and never to be read as a good rhythm.' },
  ]

  return (
    <div className="space-y-7">
      {bands.map((b) => (
        <section key={b.title}>
          <h2 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-text-2">
            <span className={cn('h-2 w-2 rounded-full', b.dot)} />
            {b.title}
            <span className="font-stat text-[12px] text-text-3">{b.rows.length}</span>
          </h2>
          <p className="mb-3 text-[11.5px] text-text-3">{b.note}</p>
          {b.rows.length === 0 ? (
            <p className="text-[12.5px] text-text-3">Nobody here.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {b.rows.slice(0, 24).map((p) => (
                <Card key={p.subject_key} hover className="cursor-pointer">
                  <div onClick={() => onOpen(p.subject_key)} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.subject_key) }}>
                    <div className="flex items-center justify-between gap-2">
                      <TrackerName p={p} className="block truncate text-[13.5px] font-semibold text-text-1"
                                   title="Drag this name onto the tracker, top left">
                        {p.subject_name}
                      </TrackerName>
                      <VerdictChip v={p.shift_verdict === 'strained' ? 'strained' : rhythmOf(p)} small />
                    </div>
                    {/* THE EVIDENCE, not just the word. The time clock's line
                        comes first when it is what the verdict rests on, and
                        it carries its own date because that book is frozen. */}
                    {p.worked && p.work_why && (
                      <p className="mt-1.5 flex gap-1.5 text-[12px] leading-[1.5] text-text-2">
                        <AppIcon name="clock" size={12} className="mt-0.5 shrink-0" />
                        <span>
                          {p.work_why}
                          <span className="text-text-3"> · punched to {dayText(p.worked.as_of)}, {ageText(p.worked.age_days)}</span>
                        </span>
                      </p>
                    )}
                    {p.site_why && p.sample !== 'none' && (
                      <p className="mt-1.5 text-[12px] leading-[1.5] text-text-2">{p.site_why}</p>
                    )}
                    {!!p.shifts?.shifts && p.shift_why && (
                      <p className="mt-1.5 flex gap-1.5 text-[12px] leading-[1.5] text-text-3">
                        <AppIcon name="calendar" size={12} className="mt-0.5 shrink-0" />
                        <span>{p.shift_why}</span>
                      </p>
                    )}
                    {!p.worked && (
                      <p className="mt-1.5 text-[11.5px] leading-[1.45] text-text-3">
                        No time-clock record — hours, nights and turnaround unread for this person.
                      </p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ one person…

// THE THREE AXES, KEPT APART AND SAID IN ORDER.
function RhythmCard({ person }: { person: BoardRow }) {
  const w = person.worked ?? null
  const rows: { v: string; where: string; why: string; stale?: ReactNode; missing?: string }[] = [
    {
      v: person.work_verdict || 'unknown',
      where: 'at the time clock',
      why: person.work_why || '',
      stale: w ? <AsOf at={w.as_of} age={w.age_days} fresh={w.fresh} /> : null,
      missing: w ? '' : 'No punch reaches this name, so hours, nights and turnaround are unread — not zero.',
    },
    {
      v: person.site_verdict,
      where: 'on the platform',
      why: person.site_why,
      missing: person.sample === 'none' ? 'Nothing recorded in the platform’s own log in this window.' : '',
    },
    {
      v: person.shift_verdict,
      where: 'on the roster',
      why: person.shift_why,
      missing: person.shifts?.shifts ? '' : 'No worked shift on the roster in this window.',
    },
  ]
  return (
    <Card>
      <CardHeader title="Their rhythm" sub="One reading, and the lives it was read from." />
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5">
        <VerdictChip v={rhythmOf(person)} />
        <span className="text-[11.5px] text-text-3">
          {person.rhythm_from ? axisText(person.rhythm_from) : 'no axis could be read'}
        </span>
        {person.rhythm_why && (
          <p className="w-full text-[12.5px] leading-[1.5] text-text-2">{person.rhythm_why}</p>
        )}
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.where} className={cn(i > 0 && 'border-t border-border pt-3')}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <VerdictChip v={r.v} small />
              <span className="text-[11.5px] text-text-3">{r.where}</span>
              {r.stale}
            </div>
            {r.missing
              ? <NotOnFile>{r.missing}</NotOnFile>
              : <p className="text-[12.5px] leading-[1.5] text-text-2">{r.why}</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-border pt-2.5 text-[10.5px] leading-[1.5] text-text-3">
        The fused word is the WORSE of the platform and the time clock, never an average, and an axis that
        did not run is skipped rather than counted as good. The roster is shown here but never fused: it
        covers the same days the punches do.
      </p>
    </Card>
  )
}

// WHAT THE TIME CLOCK SAYS — the hours somebody was actually paid for.
function WorkCard({ person }: { person: BoardRow }) {
  const w = person.worked ?? null
  if (!w) {
    return (
      <Card>
        <CardHeader title="What the time clock says" />
        <NotOnFile>
          No punch on the time clock reaches this name
          {person.worked_as_of ? ` in the record to ${dayText(person.worked_as_of)}` : ''}. Their hours, their
          nights and the gaps between their shifts are UNREAD — this is a gap in what we hold, not a person
          who worked nothing, and it must not be read as a healthy rhythm.
        </NotOnFile>
      </Card>
    )
  }
  const week = w.hours_per_week
  return (
    <Card>
      <CardHeader
        title="What the time clock says"
        sub={`${dayText(w.first)} — ${dayText(w.last)}, ${w.span_days} day(s) of record. Overnights split at midnight by PsiAnywhere are stitched back into one shift.`}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <VerdictChip v={person.work_verdict || 'unknown'} small />
        <AsOf at={w.as_of} age={w.age_days} fresh={w.fresh} what="punches" />
      </div>
      {w.fresh === false && (
        <p className={cn('mb-3 rounded-[10px] px-3 py-2 text-[11.5px] leading-[1.5]', TINT_BG.amber, TINT_FG.amber)}>
          These hours come from the stored copy of PsiAnywhere’s punches, which stopped when its scraper lost port
          8443. PsiAnywhere is still the official time clock — the Punch board in Smart Comms reads it live. This
          copy is true about the days it covers and is no longer allowed to set the reading at the top of the page.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Shifts" value={w.shifts} />
        <Tile label="Hours" value={hoursText(w.hours)} />
        <Tile label="A week" value={week === null ? '—' : hoursText(week)}
          tint={week !== null && week >= 48 ? 'pink' : undefined} />
        <Tile label="Nights" value={w.nights}
          tint={w.nights && w.nights / Math.max(1, w.shifts) >= 0.5 ? 'amber' : undefined} />
        <Tile label="Nights running" value={w.night_run_days}
          tint={w.night_run_days >= 4 ? 'pink' : undefined} />
        <Tile label="Days on, unbroken" value={`${w.longest_run_days}d`}
          tint={w.longest_run_days >= 10 ? 'pink' : undefined} />
        <Tile label="Shortest turnaround" value={w.min_turnaround_h === null ? '—' : hoursText(w.min_turnaround_h)}
          tint={w.min_turnaround_h !== null && w.min_turnaround_h < 10 ? 'pink' : undefined} />
        <Tile label="Longest stretch in" value={hoursText(w.longest_stretch_h)}
          tint={w.longest_stretch_h >= 24 ? 'pink' : undefined} />
      </div>
      {/* THE EVIDENCE UNDER EACH CLAIM — the sentence a manager can act on,
          and the arithmetic it came from, never one without the other. */}
      <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-[12.5px] leading-[1.5] text-text-2">
        <li>
          <span className="font-stat text-text-1">{w.nights}</span> of {w.shifts} shift(s) reached at least two
          hours into 10pm–6am, so an eight o'clock finish is not counted as a night.
          {w.night_run_days >= 2 && (
            <> The longest run of nights back to back was{' '}
              <span className="font-stat text-text-1">{w.night_run_days}</span> — counted on the night each
              shift belongs to, so a week of 10pm–6am reads as {w.night_run_days} nights and not twice as many
              halves.</>
          )}
        </li>
        <li>
          {week === null ? (
            <>Under a week of punched span, so there is NO weekly rate — {hoursText(w.hours)} over{' '}
              {w.span_days} day(s) is all that can honestly be said.</>
          ) : (
            <><span className="font-stat text-text-1">{hoursText(w.hours)}</span> clocked across{' '}
              {w.days} day(s), an average of <span className="font-stat text-text-1">{week}</span> a week over the
              span actually punched.</>
          )}
        </li>
        <li>
          {w.min_turnaround_h === null ? (
            <>Only one shift in range, so there is no gap to measure a turnaround from.</>
          ) : (
            <><span className="font-stat text-text-1">{w.quick_turnarounds}</span> gap(s) under 10 hours between
              clocking out and back in, the shortest {hoursText(w.min_turnaround_h)}
              {w.back_to_back ? <>, and <span className="font-stat text-text-1">{w.back_to_back}</span> straight
                back-to-back</> : ''}. Breaks over three days are holidays and are not counted as turnarounds.</>
          )}
        </li>
        {w.longest_stretch_h >= 24 && (
          <li className={TINT_FG.pink}>
            <span className="font-stat">{hoursText(w.longest_stretch_h)}</span> clocked in with no gap at all
            between shifts — the shift count alone hides this completely.
          </li>
        )}
      </ul>
      <p className="mt-3 text-[10.5px] leading-[1.5] text-text-3">
        This reads WHEN somebody was clocked in and for how long. It holds no client, no place and no reason,
        and nothing here knows whether a run of nights was chosen, covered for somebody, or imposed.
      </p>
    </Card>
  )
}

// ONE COMPOSED PARAGRAPH, DRAWN TWICE.
function AiParagraph({ eyebrow, lavender, text, highlights, tags, caption, fallback }: {
  eyebrow: string
  lavender?: boolean
  text: string
  highlights?: string[]
  tags?: string[]
  caption: ReactNode
  /** what is said when the model wrote nothing — never a filler paragraph */
  fallback: ReactNode
}) {
  return (
    <Card tint={lavender ? 'lavender' : undefined}>
      <div className="flex items-start gap-3">
        <Sparkles size={18} className={cn('mt-0.5 shrink-0', TINT_FG.lavender)} />
        <div className="min-w-0 flex-1">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-3">{eyebrow}</p>
          {text
            ? <p className="text-[13.5px] leading-[1.65] text-text-1">{text}</p>
            : <p className="text-[13px] leading-[1.6] text-text-3">{fallback}</p>}
          {!!highlights?.length && (
            <ul className="mt-2.5 space-y-1">
              {highlights.map((h) => (
                <li key={h} className="flex gap-1.5 text-[12.5px] text-text-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-3" />{h}
                </li>
              ))}
            </ul>
          )}
          {!!tags?.length && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {tags.map((t, i) => (
                <span key={t} className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                  TINT_BG[APP_TINT[i % APP_TINT.length]], TINT_FG[APP_TINT[i % APP_TINT.length]])}>{t}</span>
              ))}
            </div>
          )}
          <p className="mt-3 text-[10.5px] leading-[1.5] text-text-3">{caption}</p>
        </div>
      </div>
    </Card>
  )
}

// CREDENTIALS AND TRAINING — ONE CARD, TWO BOOKS, ONE PALETTE.
const CERT_STATE: Record<string, string> = { current: 'valid', expiring: 'expiring', expired: 'expired' }

// the join's own fold, applied to a COURSE name rather than a person's, so "CPR/First Aid" and "CPR First Aid" are…
const courseKey = (v: string) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

function CredentialsCard({ person, certs, certsRead, whyUnread }: {
  person: BoardRow | null
  certs: { cert: string; expires: string; status: string }[] | null
  /** has the record's own certification list been read at all this visit? */
  certsRead: boolean
  whyUnread: ReactNode
}) {
  const t = person?.training ?? null
  const ist = person?.ist ?? null
  const req = person?.requirements ?? null
  const folded = useMemo(() => new Set((t?.courses ?? []).map((c) => courseKey(c.course))), [t])
  // a record certification the fold does not reach — matched on the same fold, in both directions, so "CPR" inside…
  const extra = useMemo(() => (certs ?? []).filter((c) => {
    const k = courseKey(c.cert)
    if (k.length < 3) return true
    for (const f of folded) if (f === k || f.includes(k) || k.includes(f)) return false
    return true
  }), [certs, folded])

  return (
    <Card>
      <CardHeader
        title="Credentials and training"
        sub="Courses are folded onto the platform account; the record's own certification rows are listed separately."
      />
      {person?.training_verdict && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <VerdictChip v={person.training_verdict} small />
          <span className="text-[11.5px] text-text-3">{person.training_why}</span>
        </div>
      )}

      {t?.courses.length ? (
        <ul className="space-y-1">
          {t.courses.map((c) => (
            <li key={c.course} className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-text-1">{c.course}</span>
              <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                TINT_BG[COURSE_TINT[c.state] ?? 'slate'], TINT_FG[COURSE_TINT[c.state] ?? 'slate'])}>
                {c.expires ? dayText(c.expires) : 'no date'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <NotOnFile>
          {person
            ? <>No course record reaches this name. The estate files training by name, so this is a gap in our
                records rather than anything about this person.</>
            : <>The course record is folded onto platform accounts, and no account is attached to this record —
                so the fold is unread for this name.</>}
        </NotOnFile>
      )}

      {/* THE OTHER BOOK, NAMED. Never merged into the list above: these rows
          come from the migrated HR record, not from the estate's course fold,
          and a reader has to be able to tell which one they are looking at. */}
      <div className="mt-3 border-t border-border pt-3">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-3">
          On the migrated record only
        </p>
        {!certsRead ? (
          <NotOnFile>{whyUnread}</NotOnFile>
        ) : extra.length === 0 ? (
          <p className="text-[12px] leading-[1.5] text-text-3">
            {certs?.length
              ? 'Every certification on the record is already one of the courses above.'
              : 'None on the migrated record. The courses above are a different book and stand on their own.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {extra.map((c) => (
              <div key={c.cert} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1 text-[12.5px] text-text-1">{c.cert}</span>
                <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                  TINT_BG[COURSE_TINT[CERT_STATE[c.status] ?? 'undated'] ?? 'slate'],
                  TINT_FG[COURSE_TINT[CERT_STATE[c.status] ?? 'undated'] ?? 'slate'])}>
                  {c.expires || c.status || 'no date'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {ist && (
        <p className="mt-3 border-t border-border pt-3 text-[12.5px] leading-[1.5] text-text-2">
          Client-specific training: <strong>{ist.done}</strong> signed off across {ist.plans} plan
          {ist.plans === 1 ? '' : 's'}
          {ist.owed ? <>, <strong>{ist.owed}</strong> still owed</> : null}.
        </p>
      )}
      {req && (
        <p className="mt-2 text-[12.5px] leading-[1.5] text-text-3">
          Onboarding requirements: {req.ok} met · {req.missing} not on file · {req.expiring} expiring ·{' '}
          {req.expired} expired.
        </p>
      )}
      <p className="mt-3 border-t border-border pt-2.5 text-[10.5px] leading-[1.5] text-text-3">
        The record board's own expired/expiring counts are drawn nowhere on this profile: that house is exactly
        doubled, so those numbers are twice the truth. They are still inside the grade, which is why the grade
        says "from the record" rather than standing as this page's arithmetic.
      </p>
    </Card>
  )
}

// ------------------------------------------------------------------ the profile's own tab strip — the SAME…

type ProfileTabId = 'overview' | 'profile' | 'rhythm' | 'record' | 'attendance' | 'credentials'

function ProfileTabs({ tabs, tab, onTab }: {
  tabs: { id: ProfileTabId; label: string; count?: number }[]
  tab: ProfileTabId
  onTab: (id: ProfileTabId) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onTab(t.id)}
          className={cn('-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors',
            tab === t.id ? cn('border-current', TINT_FG.lavender)
              : 'border-transparent text-text-3 hover:text-text-2')}
        >
          {t.label}
          {typeof t.count === 'number' && (
            <span className="ml-1.5 font-stat text-[11.5px] opacity-70">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ ONE share, ONE download, BOTH books…

// A SHARE SHEET THAT CARRIES HALF A PROFILE WHILE THE PAGE SHOWS THE WHOLE ONE IS THE SAME CLASS OF LIE AS A…
const PROFILE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'book', label: 'Book' },
  { key: 'section', label: 'Section' },
  { key: 'date', label: 'Date' },
  { key: 'kind', label: 'Kind' },
  { key: 'detail', label: 'Detail' },
  { key: 'extra', label: 'Extra' },
]

function profileShareText(row: MergedRow, rec: StaffProfile | null, live: Reading | null,
                          recordSentence: string): string {
  const p = row.p
  const r = row.r
  const lines: string[] = [p?.subject_name || r?.name || 'Unnamed']
  if (p) lines.push([p.title, p.role].filter(Boolean).join(' · '))

  lines.push('', 'THE WELLBEING READING — the platform’s own log and the time clock')
  if (!p) {
    // THE SHARED COPY CARRIES THE SAME DISTINCTION THE SCREEN DOES — a board that never answered is not a person…
    lines.push(row.why === 'account-unread'
      ? 'The behaviour board did not answer, so whether a platform account is attached to this record is UNREAD — the log and the time clock are unread with it, never empty.'
      : 'No platform account is attached to this record, so neither the log nor the time clock has anything to read.')
  } else {
    lines.push(`Rhythm: ${verdictOf(rhythmOf(p)).label} ${axisText(p.rhythm_from)}`.trim())
    if (p.rhythm_why) lines.push(p.rhythm_why)
    const w = p.worked
    lines.push(w
      ? `Time clock: ${w.shifts} shift(s), ${hoursText(w.hours)}, ${w.nights} at night, longest run ${w.longest_run_days}d — to ${w.as_of} (${ageText(w.age_days)})`
      : 'Time clock: no punch reaches this name — hours unread, not zero.')
    const a = p.absences
    lines.push(a
      ? `Call-offs (frozen behaviour book): ${a.count} in ${a.window_days} days to ${a.as_of}`
      : 'Call-offs (frozen behaviour book): no number — the book stopped before this window.')
    if (live?.reading) lines.push('', live.reading, `— ${live.ai_via ? `via ${live.ai_via}, ` : ''}${live.ai_at}`)
  }

  lines.push('', 'THE RECORD — attendance · incidents · certifications')
  if (!rec) {
    lines.push(recordSentence)
    if (r) lines.push(`Board row: ${r.status || '—'}${r.hire_date ? `, hired ${r.hire_date}` : ''}, grade ${Number.isFinite(r.grade) ? r.grade.toFixed(1) : '—'}/10 — the entries behind these numbers were not read.`)
  } else {
    const s = rec.staff
    lines.push([s.status && `Status: ${s.status}`, s.hire_date && `Hired: ${s.hire_date}`,
                s.phone && `Phone: ${formatPhoneDisplay(s.phone)}`, s.email && `E-mail: ${s.email}`,
                s.driver && `Driver: ${s.driver}`, s.hs_diploma && `HS diploma: ${s.hs_diploma}`]
      .filter(Boolean).join(' · '))
    lines.push(`Grade: ${Number.isFinite(rec.grade?.value) ? rec.grade.value.toFixed(1) : '—'}/10${rec.grade?.ai != null ? ` (the model argues ${rec.grade.ai})` : ''}`)
    if (rec.grade?.parts?.length) lines.push(rec.grade.parts.map((x) => `${x.cut} for ${x.count} ${x.label}`).join('; '))
    if (rec.ai?.summary) lines.push('', rec.ai.summary, `— from the migrated record only, ${rec.ai.made_at}`)
    // THE NUMBERS IN THESE HEADINGS ARE PAGE SIZES — the record read is capped — so each says so, and the board…
    lines.push('', `ATTENDANCE (${rec.attendance.length} entries sent${r ? `, ${r.attendance_all} on the record in all` : ''}) — the record's own entries, never added to the behaviour book above:`)
    for (const x of rec.attendance.slice(0, 30)) lines.push(`${x.date} — ${x.kind}${x.notes ? ` — ${x.notes}` : ''}`)
    lines.push('', `INCIDENTS (${rec.incidents.length} entries sent${r ? `, ${r.incidents} on the record in all` : ''}):`)
    for (const x of rec.incidents.slice(0, 30)) lines.push(`${x.date} [${x.type}/${x.severity}] ${x.summary}`)
    lines.push('', `NOTES (${rec.notes.length} entries sent):`)
    for (const x of rec.notes.slice(0, 20)) lines.push(`${x.at.slice(0, 10)} — ${x.text}`)
  }

  lines.push('', 'COURSES — the estate’s own fold, one row per person per course')
  const t = p?.training
  if (t?.courses.length) lines.push(t.courses.map((c) => `${c.course}${c.expires ? ` (to ${c.expires}${c.state === 'expired' ? ', past its date' : ''})` : ''}`).join('; '))
  else lines.push('No course record reaches this name.')
  return lines.join('\n')
}

function profileExportRows(row: MergedRow, rec: StaffProfile | null): Record<string, string>[] {
  const p = row.p
  const rows: Record<string, string>[] = []
  if (p) {
    const w = p.worked
    rows.push({ book: 'wellbeing', section: 'rhythm', date: p.computed_at.slice(0, 10),
                kind: verdictOf(rhythmOf(p)).label, detail: p.rhythm_why ?? '', extra: axisText(p.rhythm_from) })
    if (w) {
      rows.push({ book: 'wellbeing', section: 'time clock', date: w.as_of, kind: `${w.shifts} shift(s)`,
                  detail: `${hoursText(w.hours)} · ${w.nights} night(s) · longest run ${w.longest_run_days}d`,
                  extra: ageText(w.age_days) })
    }
    if (p.absences) {
      rows.push({ book: 'wellbeing', section: 'call-offs (frozen book)', date: p.absences.as_of,
                  kind: `${p.absences.count}`, detail: p.absences.types.map((x) => `${x.type} ${x.n}`).join(' · '),
                  extra: `${p.absences.window_days} day window — never added to the record's entries` })
    }
    for (const c of p.training?.courses ?? []) {
      rows.push({ book: 'wellbeing', section: 'course', date: c.expires, kind: c.state, detail: c.course, extra: '' })
    }
  }
  if (rec) {
    const s = rec.staff
    rows.push({ book: 'record', section: 'staff', date: s.hire_date, kind: s.status, detail: s.name,
                extra: [formatPhoneDisplay(s.phone), s.email].filter(Boolean).join(' · ') })
    rows.push({ book: 'record', section: 'grade', date: '', kind: `${rec.grade?.value ?? ''}/10`,
                detail: (rec.grade?.parts ?? []).map((x) => `${x.cut} for ${x.count} ${x.label}`).join('; '),
                extra: rec.grade?.ai != null ? `the model argues ${rec.grade.ai}` : '' })
    for (const x of rec.attendance) rows.push({ book: 'record', section: 'attendance', date: x.date, kind: x.kind, detail: x.notes, extra: x.by })
    for (const x of rec.incidents) rows.push({ book: 'record', section: 'incident', date: x.date, kind: `${x.type}/${x.severity}`, detail: x.summary, extra: x.action })
    for (const x of rec.notes) rows.push({ book: 'record', section: 'note', date: x.at.slice(0, 10), kind: x.category, detail: x.text, extra: '' })
    for (const c of rec.certs) rows.push({ book: 'record', section: 'certification', date: c.expires, kind: c.status, detail: c.cert, extra: '' })
  }
  return rows
}

// ONE PROFILE, BOTH BOOKS, ONE TAB STRIP.
function PersonPanel({ row, recordState, boardState, reading, token, onBack, onReading, dirRow, dirRead }: {
  row: MergedRow
  recordState: RecordState
  // the OTHER read's state — the wellbeing half has to say which of the two it is showing exactly as the record…
  boardState: BoardState
  reading: Reading | null
  token: string | null
  onBack: () => void
  onReading: (r: Reading) => void
  // THE DIRECTORY'S ROW FOR THIS PERSON, or null when the book does not answer to the name — including when it…
  dirRow: DirRow | null
  // whether the directory slice landed at all.
  dirRead: boolean
}) {
  const person = row.p
  const r = row.r
  const empId = r?.emp_id ?? ''
  const subjectKey = person?.subject_key ?? ''

  // ── THE PEOPLE PROFILE, FOR THIS PERSON ────────────────────────────── The join is direct and needs no name…
  const { deep, busy: deepBusy, refresh: refreshDeep } = useDeepProfile(subjectKey)
  const [accounts, setAccounts] = useState<UserRow[]>(() => (cachedUsers() ?? []) as UserRow[])
  useEffect(() => {
    let alive = true
    fetchUsers().then((rows) => { if (alive) setAccounts(rows as UserRow[]) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const account = useMemo(
    () => accounts.find((x) => String(x.id) === String(subjectKey)),
    [accounts, subjectKey])
  const heroRing = ringOf(person, dirRow, account)
  // WHICH ACCOUNT EDIT IS OPEN.
  const [acctDialog, setAcctDialog] = useState<
    'profile' | 'contacts' | 'role' | 'badges' | 'app-access' | 'type' | 'place'
    | 'password' | 'active' | 'remove' | null>(null)
  // every account edit here is the master's alone: the Account menu is drawn for no other session
  const master = useEffectiveIsMaster()
  const reloadAccount = useCallback(async () => {
    try { setAccounts((await fetchUsers({ force: true })) as UserRow[]) } catch { /* the list stands */ }
  }, [])

  /* ---------------- the wellbeing half ---------------- */
  const [profile, setProfile] = useState<Profile | null>(null)
  // THE LEDGER'S READ HAS ITS OWN FAILURE.
  const [ledgerFailed, setLedgerFailed] = useState(false)
  const [busy, setBusy] = useState<'' | 'read' | 'cortex'>('')
  // THE TWO ANSWERS ARE HELD — each stays on screen until it is asked for again, never vanishing on its own.
  const [cortex, setCortex] = useState('')
  const [cortexAt, setCortexAt] = useState('')
  const [cortexErr, setCortexErr] = useState('')

  // ---------------- the record half ---------------- NOT SEEDED FROM THE KEPT COPY.
  const [rec, setRec] = useState<StaffProfile | null>(null)
  const [recBusy, setRecBusy] = useState(false)
  const [recError, setRecError] = useState('')
  const [recEvaluating, setRecEvaluating] = useState(false)
  const [recEvalFailed, setRecEvalFailed] = useState(false)
  // fired at most once per emp_id on open — the Refresh press goes through `loadRecord` directly and is not gated…
  const firedFor = useRef('')

  const [tab, setTab] = useState<ProfileTabId>('overview')
  const [noteText, setNoteText] = useState('')
  const [noting, setNoting] = useState(false)
  const [absence, setAbsence] = useState<{ date: string; kind: string; notes: string } | null>(null)
  const [incident, setIncident] = useState<{ severity: string; summary: string; category: string } | null>(null)
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    if (!subjectKey) return
    let alive = true
    setProfile(null); setLedgerFailed(false)
    setCortex(''); setCortexAt(''); setCortexErr('')
    void gasAction<Profile>('behaviorProfile', { subject_key: subjectKey }, { timeoutMs: 60000 })
      .then((p) => {
        if (!alive) return
        setProfile(p)
        const kept = p?.reading?.cortex_note ?? ''
        if (kept) { setCortex(kept); setCortexAt(p?.reading?.cortex_at ?? '') }
      })
      .catch(() => {
        // A FAILED READ IS NEVER AN EMPTY READ — said out loud where the ledger would have been, instead of…
        if (alive) setLedgerFailed(true)
      })
    return () => { alive = false }
  }, [subjectKey])

  // THE MODEL RUNS OFF THE READ.
  const evaluateRecord = useCallback((refresh: boolean) => {
    if (!empId) return
    setRecEvaluating(true); setRecEvalFailed(false)
    void gasAction<{ summary: string; tags: string[]; grade: number | null; made_at: string }>(
      'staffPerfEvaluate', refresh ? { emp_id: empId, refresh: true } : { emp_id: empId },
      { timeoutMs: 120000 })
      .then((d) => {
        if (!d?.summary) return
        setRec((p) => (p ? {
          ...p,
          ai: { summary: d.summary, tags: d.tags ?? [], made_at: d.made_at },
          grade: { ...p.grade, ai: d.grade },
          ai_stale: false,
        } : p))
      })
      .catch(() => setRecEvalFailed(true))
      .finally(() => setRecEvaluating(false))
  }, [empId])

  const loadRecord = useCallback(() => {
    if (!empId) return
    setRecBusy(true)
    gasAction<StaffProfile>('staffPerfProfile', { emp_id: empId }, { timeoutMs: 60000 })
      .then((d) => {
        setRec(d); setRecError('')
        if (d?.ai_stale) evaluateRecord(false)
      })
      .catch((e) => setRecError(e instanceof Error ? e.message : 'The record did not answer.'))
      .finally(() => setRecBusy(false))
  }, [empId, evaluateRecord])

  // A LATE JOIN.
  useEffect(() => {
    if (!empId || firedFor.current === empId) return
    firedFor.current = empId
    loadRecord()
  }, [empId, loadRecord])

  const compose = async (refresh: boolean) => {
    if (!person) return
    setBusy('read')
    try {
      const out = await gasAction<Reading & { state?: string; message?: string; note?: string }>(
        'behaviorEvaluate',
        {
          subject_key: person.subject_key, subject_kind: person.subject_kind,
          subject_name: person.subject_name, role: person.role, title: person.title,
          window_days: String(person.window_days), metrics: person.metrics,
          top_apps: person.top_apps, franchises: person.franchises,
          site_verdict: person.site_verdict, site_why: person.site_why,
          shift_verdict: person.shift_verdict, shift_why: person.shift_why,
          // THE WORKING LIFE GOES IN WITH THE QUESTION.
          work_verdict: person.work_verdict ?? '', work_why: person.work_why ?? '',
          rhythm_verdict: rhythmOf(person), rhythm_from: person.rhythm_from ?? '',
          rhythm_why: person.rhythm_why ?? '',
          worked: person.worked ?? null, worked_as_of: person.worked_as_of ?? '',
          reach_verdict: person.reach_verdict, refresh,
        },
        { timeoutMs: 180000 },
      )
      if (out?.reading) {
        onReading(out)
        setProfile((x) => (x ? { ...x, reading: { ...(x.reading ?? {} as never), ...out } } : x))
        toast({ type: 'success', title: out.state === 'stored' ? 'The stored reading is current' : 'Reading composed',
                body: out.note || undefined })
      } else {
        toast({ type: 'info', title: 'No reading', body: out?.message || 'The facts stand on their own.' })
      }
    } catch (err) {
      toast({ type: 'danger', title: 'The reading could not be composed',
              body: err instanceof Error ? err.message : 'Try again.' })
    } finally { setBusy('') }
  }

  // THE CORTEX, through the door that already exists — the same SSE reader the Cortex app and the Administration…
  const askCortex = async () => {
    if (!person) return
    if (!token) { setCortexErr('Sign in again.'); return }
    setBusy('cortex'); setCortexErr(''); setCortex('')
    // WHAT WE ALREADY HOLD GOES IN WITH THE QUESTION.
    const t = person.training
    const trained = t?.courses.length
      ? `Our own record says they completed: ${t.courses
          .map((c) => `${c.course}${c.expires ? ` (valid to ${c.expires}${c.state === 'expired' ? ', past its date' : ''})` : ''}`)
          .join('; ')}.`
      : `Our own record holds no completed course for them.`
    const question = `What do you know about ${person.subject_name}? Summarise their role, their schedule ` +
      `and anything on record about how they work. ${trained} Use that as context: say whether what you ` +
      `hold agrees with it, and name any training or qualification you know of that is missing from our ` +
      `list. Treat an expired date as a renewal to book, never as a judgement about the person. ` +
      `Facts only, four sentences at most, and say plainly if you hold nothing about them.`
    try {
      const res = await fetch('/cortex/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: question, session_id: `DLG-behavior-${person.subject_key}`.slice(0, 64) }),
      })
      if (!res.ok || !res.body) throw new Error(`The cortex did not answer (${res.status}).`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = '', text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const frame of frames) {
          let event = '', data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          let payload: Record<string, unknown> = {}
          try { payload = JSON.parse(data) } catch { /* a frame we cannot read is a frame we skip */ }
          if (event === 'token' || event === 'delta') {
            const piece = String(payload.delta ?? payload.text ?? payload.content ?? '')
            if (piece) { text += piece; setCortex(text) }
          } else if (event === 'complete' || event === 'response') {
            const whole = String(payload.response ?? '')
            if (whole && !text) { text = whole; setCortex(whole) }
          } else if (event === 'error') {
            throw new Error(String(payload.message ?? 'The cortex refused.'))
          }
        }
      }
      if (text.trim()) {
        void gasAction<{ cortex_at?: string }>('behaviorCortexNote', {
          subject_key: person.subject_key, subject_kind: person.subject_kind,
          subject_name: person.subject_name, note: text.slice(0, 4000),
        }).then((x) => setCortexAt(x?.cortex_at ?? new Date().toISOString()))
          .catch(() => { /* shown now, simply not kept — say nothing louder */ })
      }
    } catch (err) {
      setCortexErr(err instanceof Error ? err.message : 'The cortex could not be reached.')
    } finally { setBusy('') }
  }

  // ---------------- the three writes, each re-reading the RECORD only ---- Logging an absence does not change a…
  const addNote = () => {
    const t = noteText.trim()
    if (!t || noting || !empId) return
    setNoting(true)
    void gasAction('staffPerfNoteAdd', { emp_id: empId, text: t })
      .then(() => { setNoteText(''); loadRecord() })
      .catch((e) => toast({ type: 'danger', title: 'The note was not saved',
                            body: e instanceof Error ? e.message : 'Try again — what you typed is still here.' }))
      .finally(() => setNoting(false))
  }
  const logAbsence = async () => {
    if (!absence || writing || !empId) return
    setWriting(true)
    try {
      await gasAction('staffPerfAbsenceAdd',
        { emp_id: empId, date: absence.date, kind: absence.kind, notes: absence.notes.trim() })
      setAbsence(null)
      toast({ type: 'success', title: 'Absence logged' })
      loadRecord()
    } catch (e) {
      toast({ type: 'danger', title: 'Not logged',
              body: e instanceof Error ? e.message : 'Try again — what you typed is still here.' })
    } finally { setWriting(false) }
  }
  const addIncident = async () => {
    if (!incident || writing || !empId) return
    if (incident.summary.trim().length < 5) {
      toast({ type: 'warning', title: 'Describe it first', body: 'A few words on what happened.' })
      return
    }
    setWriting(true)
    try {
      await gasAction('staffPerfIncidentAdd',
        { emp_id: empId, severity: incident.severity, summary: incident.summary.trim(),
          category: incident.category.trim() })
      setIncident(null)
      toast({ type: 'success', title: 'Incident recorded' })
      loadRecord()
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded',
              body: e instanceof Error ? e.message : 'Try again — what you typed is still here.' })
    } finally { setWriting(false) }
  }

  /* ---------------- what is known, and what is not ---------------- */

  const m = person?.metrics ?? null
  const live = (profile?.reading ?? reading) as (Reading & { highlights?: string[]; note?: string }) | null
  const quiet = !!person && person.sample === 'none'
  const w = person?.worked ?? null
  /** nothing at all to read a rhythm from — neither the log nor the punch */
  const blind = quiet && !w
  const ab = person?.absences ?? null

  // WHICH SHAPE THE RECORD HALF IS IN — the READ is asked about first, and a fact about the read is never a fact…
  const recordShape: 'client' | 'reached' | 'withheld' | 'pending' | 'failed' | 'unmigrated' | 'empty' | 'unmatched' =
    row.why === 'client' ? 'client'
      : r ? 'reached'
        : row.why === 'ambiguous' ? 'withheld'
          : recordState === 'pending' ? 'pending'
            : recordState === 'failed' ? 'failed'
              : recordState === 'unmigrated' ? 'unmigrated'
                : recordState === 'empty' ? 'empty'
                  : 'unmatched'

  const recordSentence: ReactNode =
    recordShape === 'withheld'
      ? <>More than one person answers to this name — on the HR roster, on the platform, or on both. The record
          is withheld rather than risk showing somebody else’s.</>
      : recordShape === 'failed'
        ? <>The record did not answer. Nothing in this box is about this person’s file — the grade, the
            call-offs and the incidents are simply unread.</>
        : recordShape === 'unmigrated'
          ? <>The record has never been brought in from the old platform, so it holds nothing about anybody.
              The grade, the call-offs and the incidents are unread for everyone on this board, not for this
              person in particular.</>
          : recordShape === 'empty'
            ? <>The record answered with no rows at all. The grade, the call-offs and the incidents are unread
                for everyone on this board, not for this person in particular.</>
            : <>No HR record reaches this name. The record is filed by name, so this is a gap in our filing —
                the grade, the call-offs and the incidents are unread, not clean.</>

  const recordShort =
    recordShape === 'pending' ? 'the record has not answered yet this visit'
      : recordShape === 'withheld' ? 'withheld — more than one person answers to this name'
        : recordShape === 'failed' ? 'the record did not answer'
          : recordShape === 'unmigrated' ? 'the record has never been brought in'
            : recordShape === 'empty' ? 'the record answered with no rows at all'
              : 'no HR record reaches this name'

  // WHY THERE IS NO WELLBEING HALF — and whether that is about this person at all.
  const accountUnread: '' | 'pending' | 'failed' =
    row.why !== 'account-unread' ? '' : boardState === 'failed' ? 'failed' : 'pending'

  // THE ENTRIES ARE IN HAND — separate from "the record row is in hand".
  const entriesRead = recordShape === 'reached' && !!rec
  const entriesFailed = recordShape === 'reached' && !rec && !!recError
  const entriesPending = recordShape === 'reached' && !rec && !recError

  const grade = Number.isFinite(rec?.grade?.value) ? (rec as StaffProfile).grade.value
    : (r && Number.isFinite(r.grade) ? r.grade : null)
  const hireDate = rec?.staff?.hire_date || r?.hire_date || ''
  const status = rec?.staff?.status || r?.status || ''

  const roleLine = person ? (person.title || person.role) : ''
  const rosterWord = person?.roster_status ?? ''
  const subtitle = !person ? ''
    : rosterWord && status && rosterWord.toLowerCase() !== status.toLowerCase()
      ? `${roleLine} · roster says ${rosterWord}`
      : rosterWord && !status ? `${roleLine} · ${rosterWord}` : roleLine

  const showRecord = recordShape !== 'client'
  const hasCredentials = !!(person?.training || person?.ist || person?.requirements) || !!rec?.certs?.length

  /* A TAB WITH NOTHING IN IT IS NOT DRAWN AT ALL. */
  const tabs = useMemo(() => {
    const out: { id: ProfileTabId; label: string; count?: number }[] = [{ id: 'overview', label: 'Overview' }]
    // PROFILE SITS SECOND: after the overview comes the profile tab.
    out.push({ id: 'profile', label: 'Profile' })
    if (person) out.push({ id: 'rhythm', label: 'Rhythm' })
    if (showRecord) {
      // THE BADGES COUNT THE RECORD, NOT THE PAGE.
      out.push({ id: 'record', label: 'Record', count: r ? r.incidents : undefined })
      out.push({ id: 'attendance', label: 'Attendance', count: r ? r.attendance_all : undefined })
    }
    if (hasCredentials) out.push({ id: 'credentials', label: 'Credentials' })
    return out
  }, [person, showRecord, hasCredentials, r])
  const active: ProfileTabId = tabs.some((t) => t.id === tab) ? tab : 'overview'

  // EVERY HALF THAT COULD NOT BE READ SAYS WHICH HALF, AND WHY — collected once and printed on the Overview, so a…
  const unread: { key: string; body: ReactNode }[] = []
  if (!person) {
    // A READ STILL IN FLIGHT SAYS NOTHING HERE — it is a Skeleton on the hero and it will resolve on its own.
    if (accountUnread === 'failed') {
      unread.push({ key: 'board-failed', body: <>The behaviour board did not answer, so whether this person
        holds a platform account is UNREAD. Their wellbeing reading, the platform’s log and the time clock are
        all unread with it — none of that is a finding about them.</> })
    } else if (accountUnread === '') {
      unread.push({ key: 'no-account', body: row.why === 'match-refused'
        ? <>More than one person answers to this name on the platform, so no account was attached to this record.
            Their account is on this board with its own reading — what is missing is the proof of which one is
            theirs.</>
        : <>This person is on the HR roster and holds no platform account, so neither the platform’s log nor the
            time clock has anything to read about them.</> })
    }
  } else {
    if (blind) unread.push({ key: 'blind', body: <>Neither the platform’s log nor the time clock holds anything
      for this account in the window. That is the absence of evidence, not a good rhythm and not a fault.</> })
    else if (!w) unread.push({ key: 'no-punch', body: <>No punch on the time clock reaches this name. Their
      hours, their nights and the gaps between their shifts are UNREAD — never zero.</> })
    if (w && w.hours_per_week === null) unread.push({ key: 'no-rate', body: <>Under a week of punched span, so
      there is NO weekly rate for this person.</> })
    if (w && w.min_turnaround_h === null) unread.push({ key: 'no-turn', body: <>Only one shift in range, so
      there is no gap to measure a turnaround from.</> })
    if (!ab && person.absences_known === false) unread.push({ key: 'frozen', body: <>The behaviour call-off book
      is frozen and older than this window, so nobody gets a number from it — a zero here would say “never
      absent” about a book that simply stopped.</> })
    if (ledgerFailed) unread.push({ key: 'ledger', body: <>The behaviour house did not answer, so the ledger of
      everything filed about this person is unread — not empty.</> })
  }
  if (showRecord && recordShape !== 'reached' && recordShape !== 'pending') {
    unread.push({ key: 'record', body: recordSentence })
  }
  if (entriesFailed) {
    unread.push({ key: 'entries', body: <>The standing on the hero came down with the grid, but the entries
      behind it did not load — the call-offs, the incidents and the notes are unread, not empty.</> })
  }
  if (entriesRead && !rec?.ai?.summary) {
    unread.push({ key: 'no-para', body: <>Not enough on file for a written read of the record — the entries are
      everything the platform holds about it.</> })
  }
  if (recordShape === 'reached' && grade === null) {
    unread.push({ key: 'no-grade', body: <>There is no grade on the record for this person. A grade starts at 10
      and subtracts, so an absent record and a spotless one would produce the identical figure — which is why
      none is shown rather than a 10.</> })
  }
  // A KEPT COPY IS A FAST PAINT, NOT A FACT.
  if (recordShape === 'reached' && recordState === 'pending') {
    unread.push({ key: 'kept', body: <>The record has not answered yet this visit. The status, the hire date and
      the grade on the hero come from the copy this browser kept from an earlier one — what we last knew about
      this person, not what the record says now.</> })
  }

  /* ---------------- the drawing ---------------- */

  const recordCaption: ReactNode = (
    <>
      Assembled from the migrated record only — re-made when the record changes or on Refresh.
      {rec?.ai?.made_at ? ` ${stampText(rec.ai.made_at)}.` : ''}
      {rec?.ai_stale ? ' The record has moved since this paragraph; a fresh one is being composed.' : ''}
      {recEvalFailed ? ' A fresh read was attempted and did not land, so this one still stands.' : ''}
    </>
  )

  return (
    <div className="w-full pb-16">
      {/* ONE BACK BUTTON. The record screen's own BackBar is retired with the
          redirect that used to draw it. */}
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-3 transition-colors hover:text-text-1"
      >
        <ArrowLeft size={14} /> Everybody
      </button>

      {/* ── THE HERO — one portrait, one name, BOTH standings ── */}
      <Card className="mb-4">
        {/* THE GREEN RING IS THE DIRECTORY'S "HERE TODAY" — around the
            initials or the photo, whoever is active wears a green rim.
            It is the People book's own `status` and nothing
            else's — not the record's employment status and not the wellbeing
            verdict, both of which already speak on this hero in their own
            words. No ring means the directory says something other than
            active, or has not been read; an absent ring is never a claim. */}
        <div className="flex flex-wrap items-start gap-4">
          {person ? (
            <TrackerName p={person}>
              <span title={heroRing ? RING_TITLE[heroRing] : undefined}>
                <Avatar name={person.subject_name} size="lg" className={ringClass(heroRing)} />
              </span>
            </TrackerName>
          ) : (
            // NOT DRAGGABLE.
            <span title={heroRing ? RING_TITLE[heroRing] : undefined}>
              <Avatar name={r?.name ?? ''} size="lg" className={ringClass(heroRing)} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 font-display text-[20px] font-bold leading-tight text-text-1">
              {person ? (
                <TrackerName p={person} title="Drag this name onto the tracker, top left">
                  {person.subject_name || 'Unnamed account'}
                </TrackerName>
              ) : (
                <span className="min-w-0 truncate">{r?.name || 'Unnamed record'}</span>
              )}
            </h1>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-text-3">{subtitle}</p>}

            {/* the wellbeing standing */}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {person ? (
                <>
                  <VerdictChip v={rhythmOf(person)} />
                  <span className="text-[11px] text-text-3">
                    {person.rhythm_from ? axisText(person.rhythm_from) : 'nothing measurable'}
                  </span>
                  <VerdictChip v={person.reach_verdict} />
                  <span className="text-[11px] text-text-3">
                    measured {stampText(person.computed_at)} · the platform’s log, last {person.window_days} days
                  </span>
                </>
              ) : accountUnread === 'pending' ? (
                // THE BOARD HAS NOT ANSWERED — a Skeleton, exactly as the record's own standing does two lines…
                <Skeleton className="h-[20px] w-[260px] rounded-full" />
              ) : accountUnread === 'failed' ? (
                <span className="text-[11px] text-text-3">
                  The behaviour board did not answer, so whether an account is attached to this record is unread.
                  No wellbeing reading can stand here until it does.
                </span>
              ) : (
                <span className="text-[11px] text-text-3">
                  No platform account is attached to this record, so there is no wellbeing reading to stand here.
                </span>
              )}
            </div>

            {/* THE RECORD'S STANDING, ON THE SAME HERO AND SAYING SO. The
                hero used to carry the
                wellbeing verdict alone, so the record was invisible until the
                reader scrolled — or, worse, left the app. */}
            {showRecord && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-1.5">
                {r ? (
                  <>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                      STATUS_CHIP[status] ?? 'bg-surface-3 text-text-3')}>
                      {status || '—'}
                    </span>
                    <span className="text-[11px] text-text-3">
                      {hireDate ? `Since ${hireDate}` : 'hire date not on file'}
                    </span>
                    {grade === null ? (
                      <span className="rounded-md bg-surface-3 px-2 py-0.5 text-[12.5px] font-bold tabular-nums text-text-3">—</span>
                    ) : (
                      <span className={cn('rounded-md px-2 py-0.5 text-[12.5px] font-bold tabular-nums', gradeChip(grade))}>
                        {grade.toFixed(1)}
                      </span>
                    )}
                    <span className="text-[11px] text-text-3">
                      {grade === null ? 'no grade on the record' : 'out of 10'} · from the record
                      {recordState === 'pending' ? ' · this browser’s kept copy until it answers' : ''}
                    </span>
                  </>
                ) : recordShape === 'pending' ? (
                  <Skeleton className="h-[20px] w-[220px] rounded-full" />
                ) : (
                  <span className="text-[11px] text-text-3">
                    The record: {recordShort} — no status, no hire date and no grade stand on this hero.
                  </span>
                )}
              </div>
            )}

            {/* THE DIRECTORY'S OWN LINE, on the hero: the facts at the top —
                phone, e-mail, active and the rest — stay at the top, and
                they come from People to complete the picture.

                CAPTIONED LIKE THE TWO ABOVE IT. This hero already carries a
                wellbeing verdict and an employment status, each saying which
                book it came from; a third set of facts with no caption is how
                a reader comes to quote the directory's word for "active" at
                somebody as if the record had said it. */}
            {dirRow ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-1.5">
            {/* NO SECOND "ACTIVE" CHIP HERE — the word was appearing twice.
                The record's own status already stands one line above, and the
                directory's word for the same thing is carried by the GREEN
                RING on the portrait — so a chip here was the same fact said
                three times, and two of them in identical words. The contact
                details stay: those the record does not carry. */}
                {dirRow.phone && (
                  <a href={`tel:${dirRow.phone}`}
                    className="text-[11.5px] text-text-2 underline-offset-2 hover:underline">
                    {formatPhoneDisplay(dirRow.phone)}
                  </a>
                )}
                {dirRow.email && (
                  <a href={`mailto:${dirRow.email}`}
                    className="min-w-0 truncate text-[11.5px] text-text-2 underline-offset-2 hover:underline">
                    {dirRow.email}
                  </a>
                )}
                <span className="text-[11px] text-text-3">· the directory</span>
              </div>
            ) : (
              <div className="mt-1.5 border-t border-border pt-1.5">
                <span className="text-[11px] text-text-3">
                  {dirRead
                    ? 'No directory row answers to this name — so no contact details stand here. That is our filing, not a fact about them.'
                    : 'The directory has not been read this visit, so no contact details stand here yet.'}
                </span>
              </div>
            )}
          </div>

          {/* ONE ACTION ROW. Each button says which half it touches; no button
              silently refreshes both, because one costs the tool lane and the
              other does not. Log absence and Add incident are NOT here — they
              write to the record and live on the tabs that hold it.

              AND IT WRAPS. `shrink-0` on a wrapping row is a contradiction:
              the row's own content decides its width and the flex item is
              forbidden to give any of it back, so five h-9 buttons pushed the
              whole hero wider than a 380px phone instead of folding. Below
              `sm` the row takes a line of its own (`w-full`) and the three
              buttons that only READ — refresh, share, download — drop their
              labels to their icons, keeping their titles as the tooltip and
              an aria-label for anyone not using a pointer. The two that WRITE
              keep their words at every width, because a button that composes
              a paragraph through an AI door must never be a mystery glyph.
              Nothing is hidden behind an overflow: every action stays one tap
              away for the reader entitled to it. */}
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {person && (
              <>
                <button
                  type="button"
                  onClick={() => void compose(true)}
                  disabled={busy !== '' || blind}
                  title={blind ? 'There is nothing measured to read' : 'Compose a fresh reading through the platform’s own AI door'}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
                >
                  {busy === 'read' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {live?.reading ? 'New reading' : 'Compose a reading'}
                </button>
                <button
                  type="button"
                  onClick={() => void askCortex()}
                  disabled={busy !== ''}
                  title="Ask the cortex what it holds about this person"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
                >
                  {busy === 'cortex' ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                  Ask the cortex
                </button>
              </>
            )}
            {recordShape === 'reached' && (
              <button
                type="button"
                onClick={() => { loadRecord(); evaluateRecord(true) }}
                disabled={recBusy || recEvaluating}
                title="Re-read this person's HR record and re-compose its evaluation"
                aria-label="Refresh the record"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40 sm:px-3"
              >
                {recBusy || recEvaluating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                <span className="hidden sm:inline">Refresh the record</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => share({
                title: person?.subject_name || r?.name || 'Profile',
                subtitle: 'User Support — the wellbeing reading and the HR record',
                text: profileShareText(row, rec, live, recordShape === 'reached'
                  ? 'The entries behind the record did not load.' : String(recordShort)),
                rows: profileExportRows(row, rec),
                columns: PROFILE_EXPORT_COLUMNS,
                filename: `${(person?.subject_name || r?.name || 'profile').replace(/\s+/g, '-')}-profile`,
                icon: 'id-card',
              })}
              title="Share this profile — both books, as they stand on this screen"
              aria-label="Share this profile"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 sm:px-3"
            >
              <Share2 size={14} /> <span className="hidden sm:inline">Share</span>
            </button>
            <button
              type="button"
              onClick={() => exportRows(
                `${(person?.subject_name || r?.name || 'profile').replace(/\s+/g, '-')}-profile`,
                PROFILE_EXPORT_COLUMNS, profileExportRows(row, rec), 'csv')}
              title="Download this profile as a spreadsheet — one row per entry, each named with its book"
              aria-label="Download this profile"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 sm:px-3"
            >
              <Download size={14} /> <span className="hidden sm:inline">Download</span>
            </button>

            {/* ── THE ACCOUNT'S OWN DOORS. 100% of the inputs, the edits and
                the features belong here, and they belong on the profile.

                TEN EDITS THAT LIVED ONLY IN A ROW MENU. They are gathered
                under one word here rather than spread across this row: nine
                of the ten change what a person may DO on this platform, and
                a button that quietly sits beside Share is a button somebody
                presses by accident.

                EVERY ONE OPENS THE USERS SECTION'S OWN DIALOG. Not a copy —
                the same form, the same validation, the same call. Three
                copies of one contract is what this app was rebuilt twice
                today to stop making.

                NO ACCOUNT, NO MENU: an HR row nobody signs in as has no role
                to change and no password to reset.

                THE MASTER'S ALONE: no other session sees the menu. A new
                sign-in email is added under Contacts — sign-in takes any of
                the person's e-mails. */}
            {account && master && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Everything that can be changed about this person's platform account"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
                  >
                    <UserCog size={14} /> Account
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-surface">
                  <DropdownMenuItem onClick={() => setAcctDialog('profile')}>Edit profile</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAcctDialog('contacts')}>Contacts</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setAcctDialog('role')}>Change role</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAcctDialog('badges')}>Set badges</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAcctDialog('app-access')}>App access</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAcctDialog('type')}>Set type</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAcctDialog('place')}>Set place</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setAcctDialog('password')}>Reset password</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAcctDialog('active')}>
                    {String(account.active).toLowerCase() === 'false' ? 'Activate' : 'Deactivate'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setAcctDialog('remove')} className="text-tint-fg-pink">
                    Remove account
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </Card>

      <ProfileTabs tabs={tabs} tab={active} onTab={setTab} />

      {/* ══════════════ OVERVIEW — THE SYNTHESIS ══════════════
          The one screen a manager reads before a conversation: the handful of
          facts from BOTH books that decide what they do next, the two composed
          paragraphs each under its own date, and then — said out loud — every
          thing this page does not know. It is not a table of contents for the
          other tabs; the evidence behind each figure is what those hold. */}
      {active === 'overview' && (
        <div className="space-y-4">
          {quiet && person && (
            <Card padded={false} className="p-5">
              <p className="text-[13px] leading-[1.6] text-text-2">
                The platform’s own log recorded nothing for this account in the last {person.window_days} days.
                {person.worked
                  ? ' Their rhythm is read from the time clock instead — the hours they were actually paid for.'
                  : person.shifts?.shifts
                    ? ' Their roster is the only thing on record, and a roster is a plan, not hours.'
                    : ' The time clock holds nothing for them either.'}
                {' '}That is the absence of evidence, not a finding about the person.
              </p>
            </Card>
          )}

          {/* ── THE PEOPLE SUMMARY, ABOVE THE SYNTHESIS ──────────────────
              The People summary sits above "What decides the next
              conversation".

              IT IS THE SAME CARD the Users profile draws, mounted here —
              the paragraph the platform composes across every source, its
              chips, the books that answered and the Refresh that re-reads
              them. Who this person is, then how they are doing: that order
              is the whole point of the merge. */}
          <ProfileSummaryCard deep={deep} busy={deepBusy} onRefresh={refreshDeep} />

          <Card>
            <CardHeader
              title="What decides the next conversation"
              sub="The facts from both books that change what a manager does today. Each says which book it came from, and the two books are never added together."
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {person && (
                <>
                  <Tile label="Hours clocked" value={w ? hoursText(w.hours) : '—'}
                    sub={w ? `${w.shifts} shift(s) to ${dayText(w.as_of)} · the time clock`
                           : 'no punch reaches this name — unread, not zero'} />
                  <Tile label="Nights running" value={w ? w.night_run_days : '—'}
                    tint={w && w.night_run_days >= 4 ? 'pink' : undefined}
                    sub={w ? 'longest run back to back · the time clock' : 'the time clock holds nothing'} />
                  <Tile label="Days on, unbroken" value={w ? `${w.longest_run_days}d` : '—'}
                    tint={w && w.longest_run_days >= 10 ? 'pink' : undefined}
                    sub={w ? 'without a day off · the time clock' : 'the time clock holds nothing'} />
                </>
              )}
              {person && (
                <Tile label="Call-offs, the frozen book" value={ab ? ab.count : '—'}
                  sub={ab
                    ? `in the ${ab.window_days} days to ${dayText(ab.as_of)} · the behaviour book`
                    : person.absences_known
                      ? 'nothing on file in the window · the behaviour book'
                      : 'the book stopped before this window · the behaviour book'} />
              )}
              {showRecord && (
                // THE NUMBERS HERE ARE TOTALS, AND ONLY THE BOARD ROW HAS THEM.
                <>
                  <Tile label="Call-offs on the record"
                    value={r ? r.attendance_90d : '—'}
                    sub={r ? `in 90 days (${r.attendance_all} ever) · the HR board row`
                           : `the record: ${recordShort}`} />
                  <Tile label="Incidents"
                    value={r ? r.incidents : '—'}
                    tint={(r?.incidents ?? 0) > 0 ? 'amber' : undefined}
                    sub={r ? `${r.incidents_major} major · all time · the HR board row`
                           : `the record: ${recordShort}`} />
                </>
              )}
            </div>

            {/* the credential clock — the FOLD, never the record board's
                doubled counts */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-[11.5px] text-text-3">
              <GraduationCap size={12} className="shrink-0" />
              {person?.training_verdict && <VerdictChip v={person.training_verdict} small />}
              <span>
                {person?.training
                  ? (person.training.expired || person.training.expiring)
                    ? `${person.training.expired ? `${person.training.expired} past its date` : ''}${person.training.expired && person.training.expiring ? ' · ' : ''}${person.training.expiring ? `${person.training.expiring} renewing` : ''} of ${person.training.total} course(s)`
                    : `every one of ${person.training.total} course(s) in date`
                  : person ? 'no course record reaches this name'
                    : 'the course fold is filed on platform accounts and none is attached here'}
              </span>
            </div>

            {person && showRecord && (
              <p className="mt-2 text-[10.5px] leading-[1.5] text-text-3">
                The two call-off figures are DIFFERENT BOOKS over different windows with different staleness.
                They are never added together and never printed as one number.
              </p>
            )}
          </Card>

          {/* the wellbeing paragraph — above, and only ever about how somebody
              works */}
          {person && (
            <AiParagraph
              eyebrow="The wellbeing reading — how this person works"
              lavender
              text={live?.reading ?? ''}
              highlights={live?.highlights}
              tags={live?.tags}
              fallback={blind
                ? <>Neither axis ran for this person, so there is nothing to compose a reading over.</>
                : <>No reading has been composed for this person yet. “Compose a reading” writes one over the
                    counted facts on this page.</>}
              caption={<>
                Written by a model over the counted facts on this page — never over a message, a document, a
                client’s record or anything on the HR record.
                {live?.ai_via ? ` Via ${live.ai_via}.` : ''}
                {live?.ai_at ? ` ${stampText(live.ai_at)}.` : ''}
                {live?.note ? ` ${live.note}` : ''}
              </>}
            />
          )}

          {/* the record's paragraph — a SECOND paragraph over a SECOND fact
              set, under its own date and never merged into the one above */}
          {showRecord && (
            entriesPending ? (
              <Card><Skeleton className="h-[86px] w-full rounded-[10px]" /></Card>
            ) : entriesRead ? (
              <AiParagraph
                eyebrow="The record’s evaluation — attendance, incidents, certifications"
                text={rec!.ai?.summary ?? ''}
                tags={rec!.ai?.tags}
                fallback={<>Not enough on file for a written read — the record’s own entries are everything the
                  platform holds about it.</>}
                caption={recordCaption}
              />
            ) : null
          )}

          {unread.length > 0 && (
            <Card>
              <CardHeader
                title="What this page does not know"
                sub="Every half that could not be read says which half, and why. None of these is a fact about this person."
              />
              <div className="space-y-2">
                {unread.map((u) => <NotOnFile key={u.key}>{u.body}</NotOnFile>)}
              </div>
            </Card>
          )}

          {(cortex || cortexErr || busy === 'cortex') && (
            <Card>
              <CardHeader
                title="What the cortex holds"
                sub={cortexAt && busy !== 'cortex'
                  ? `Asked ${stampText(cortexAt)}. It stays here until you ask again.`
                  : "Asked live, through the platform's own cortex door."}
              />
              {cortexErr ? (
                <p className="flex items-center gap-2 text-[12.5px] text-text-2">
                  <AlertTriangle size={14} className={TINT_FG.amber} /> {cortexErr}
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-text-2">{cortex || 'Asking…'}</p>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ═══════════ PROFILE — the People app's record, whole ═══════════
          After the overview comes the profile tab, which is where every
          piece of the People content goes.

          EVERY COLUMN THE BOOK HOLDS, and not one it does not. The People
          page's schema still declares `department`, `tags` and `location`
          from its demo days; the live slice carries none of the three, so
          drawing them would have put three permanently empty rows on 448
          people's profiles. What IS here is what was measured in the file:
          identity, role, status, contact, where, the dates, the employee
          number, who they are guardian for, and which systems know them.

          THE PEOPLE APP IS NOT UNINSTALLED and this does not try to replace
          its editor: writing is still its door, and the link says so rather
          than drawing a form that would be a second writer to one book. */}
      {/* ═══════════ PROFILE — the People directory, whole ═══════════
          After the overview comes the profile tab, which is where every
          piece of the People content goes. Nothing is copied out of People;
          the information is brought into User Support.

          BROUGHT, NOT LINKED. There is no "open it over there" button: the
          point of the merge is that a manager never leaves this app, and a
          button that sends them away is the merge admitting it did not
          happen.

          ONE COLUMN. It was two, and the cards ended at different heights
          because their headers are different lengths — a grid of ragged
          cards reads as broken however correct the data is. */}
      {/* ═══════ PROFILE — the People profile, whole, mounted here ═══════
          After the overview comes the profile tab, which is where every
          piece of the People content goes.

          THE FIVE SECTIONS ARE THE REAL ONES — Information, Documents,
          Reports, Activity, Shifts — because this mounts the very component
          the Users profile mounts. Nothing here is a second rendering of
          that screen: there is one, and both apps draw it. */}
      {active === 'profile' && (
        <>
          {account ? (
            <ProfileSections u={account} deep={deep} />
          ) : (
            <Card>
              <p className="text-[12.5px] leading-[1.6] text-text-3">
                {subjectKey
                  ? 'The account directory has not answered for this person yet, so their profile cannot be drawn. Nothing here is a statement about them.'
                  : 'No platform account is attached to this record, so there is no People profile to draw. The record’s own tabs still hold everything we know.'}
              </p>
            </Card>
          )}
        </>
      )}

      {/* ══════════════ RHYTHM — the wellbeing evidence ══════════════ */}
      {active === 'rhythm' && person && m && (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card padded={false}>
              <div className="border-b border-border px-4 py-3">
                <p className="text-[12px] font-semibold text-text-2">The arithmetic — the platform’s own log</p>
              </div>
              <dl className="divide-y divide-border">
                <Fact label="Recorded actions" value={quiet ? '—' : m.actions.toLocaleString()} />
                <Fact label="Days worked on the platform" value={quiet ? '—' : String(m.active_days)} />
                <Fact label="Different things done" value={quiet ? '—' : String(m.distinct_actions)} />
                <Fact label="After 10pm or before 5am" value={quiet ? '—' : String(m.night_actions)}
                  tint={m.night_actions ? 'amber' : undefined} />
                <Fact label="At weekends" value={quiet ? '—' : String(m.weekend_actions)}
                  tint={m.weekend_actions ? 'amber' : undefined} />
                <Fact label="Longest run without a day off"
                  value={quiet ? '—' : `${m.longest_run_days} day${m.longest_run_days === 1 ? '' : 's'}`}
                  tint={m.longest_run_days >= 12 ? 'pink' : undefined} />
                <Fact label="First seen on the platform" value={dayText(m.first_seen) || '—'} />
                <Fact label="Last seen" value={stampText(m.last_seen) || '—'} />
                <Fact label="Works with forms"
                  value={person.forms_actions ? `yes · ${person.forms_actions} action(s)` : 'not in this window'} />
                <Fact label="Client images"
                  value={person.images_touched ? `yes · ${person.images_touched} action(s)` : 'not in this window'} />
                <Fact label="Where they may stand" value={person.reach_why || '—'} />
              </dl>
              {/* SINCE IS THE HIRE DATE AND NOTHING ELSE. First seen, first
                  punch and first rostered shift are three other dates, and a
                  hero printing one "Since" over four of them is the exact
                  defect this platform repeats. */}
              <p className="border-t border-border px-4 py-2 text-[10.5px] leading-[1.45] text-text-3">
                “First seen” is the first click in the platform’s log — not a hire date. The hire date is on the
                hero, from the record, and the two are never collapsed.
              </p>
            </Card>

            <RhythmCard person={person} />
          </div>

          <div className="space-y-4">
            {/* THE WORKING LIFE LEADS. Somebody who works nights and barely
                touches the site was, for a month, a page of empty charts about
                their clicking — the thing that mattered was never drawn. */}
            <WorkCard person={person} />

            <Card>
              <CardHeader title="Where their work happens on the platform"
                sub="Every recorded action, grouped by the app it belongs to." />
              <AppBars apps={person.top_apps} cap={8} />
            </Card>

            {!quiet && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <CardHeader title="The last fortnight" />
                  <DayRail rail={m.rail ?? []} />
                </Card>
                <Card>
                  <CardHeader title="The hours they work" sub="Ohio's clock; amber is 10pm to 5am." />
                  <HourClock hours={m.hours ?? new Array(24).fill(0)} />
                </Card>
              </div>
            )}

            {person.shifts && (
              <Card>
                <CardHeader title="On the roster"
                  sub={person.shifts.shifts
                    ? `${dayText(person.shifts.first)} — ${dayText(person.shifts.last)}. A roster names shifts, not hours, so this counts shifts, days and runs.`
                    : 'Nothing worked yet in this window.'} />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Tile label="Shifts worked" value={person.shifts.shifts} />
                  <Tile label="Days on" value={person.shifts.days} />
                  <Tile label="Overnights" value={person.shifts.overnights}
                    tint={person.shifts.shifts && person.shifts.overnights >= person.shifts.shifts / 2 ? 'amber' : undefined} />
                  <Tile label="Longest run" value={`${person.shifts.longest_run_days}d`}
                    tint={person.shifts.longest_run_days >= 7 ? 'pink' : undefined} />
                </div>
                {/* THE FUTURE IS A PLAN, AND IS NEVER JUDGED. */}
                {!!person.shifts.planned && (
                  <p className="mt-3 text-[12px] leading-[1.5] text-text-3">
                    <span className="font-stat text-text-2">{person.shifts.planned}</span> further shift(s) are
                    rostered AHEAD{person.shifts.planned_overnights
                      ? `, ${person.shifts.planned_overnights} of them overnight` : ''} — a plan, not a rhythm
                    anybody has lived, and no part of the verdict above.
                  </p>
                )}
                {!!person.shifts.hours_unknown && (
                  <p className="mt-1.5 text-[12px] leading-[1.5] text-text-3">
                    {person.shifts.hours_unknown} of those cells carry no time at all: worked, hours unknown —
                    never counted as zero. The time clock above is where hours are answered.
                  </p>
                )}
                {!!person.shifts.off_requested && (
                  <p className="mt-1.5 text-[12px] leading-[1.5] text-text-3">
                    {person.shifts.off_requested} day(s) marked as requested off, kept out of the count.
                  </p>
                )}
                {person.shifts.houses.length > 0 && (
                  <p className="mt-3 text-[12px] text-text-3">Houses: {person.shifts.houses.join(' · ')}</p>
                )}
              </Card>
            )}

            <Card padded={false}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="text-[12px] font-semibold text-text-2">Everything filed about this person</p>
                {profile && <span className="font-stat text-[11.5px] text-text-3">{profile.signals.length}</span>}
              </div>
              {ledgerFailed ? (
                <div className="p-4">
                  <NotOnFile>
                    The behaviour house did not answer, so the ledger of everything filed about this person is
                    unread — not empty.
                  </NotOnFile>
                </div>
              ) : !profile ? (
                <div className="p-4"><Skeleton className="h-[120px] w-full rounded-[10px]" /></div>
              ) : profile.signals.length === 0 ? (
                <p className="px-4 py-5 text-center text-[12.5px] text-text-3">
                  The house answered and holds nothing filed about this person.
                </p>
              ) : (
                <div className="scroll-thin max-h-[280px] overflow-y-auto">
                  <ul className="divide-y divide-border">
                    {profile.signals.map((s, i) => (
                      <li key={`${s.signal}-${i}`} className="px-4 py-2">
                        {/* AT 380px THIS WRAPS INSTEAD OF OVERFLOWING: the
                            label keeps a 150px basis and the source falls to a
                            second line rather than pushing the row wide. */}
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                          <span className="min-w-0 flex-1 basis-[150px] truncate text-[12px] text-text-2">{s.signal}</span>
                          <span className="font-stat text-[12.5px] text-text-1">{s.value}</span>
                          <span className="text-[11px] text-text-3">{s.unit}</span>
                          <span className="ml-auto truncate text-[11px] text-text-3">{s.source}</span>
                        </div>
                        {s.detail && <p className="mt-0.5 text-[11px] leading-[1.45] text-text-3">{s.detail}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="border-t border-border px-4 py-2 text-[10.5px] text-text-3">
                This is the generic behaviour house — anything the platform, the cortex or a person files about
                somebody lands here in the same shape.
              </p>
            </Card>
          </div>
        </div>
      )}

      {/* ══════════════ RECORD — the HR book's own paper ══════════════ */}
      {active === 'record' && (
        recordShape !== 'reached' ? (
          <Card>
            <CardHeader title="The record" sub="attendance · incidents · certifications" />
            {recordShape === 'pending'
              ? <Skeleton className="h-[120px] w-full rounded-[10px]" />
              : <NotOnFile>{recordSentence}</NotOnFile>}
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-4">
              <Card padded={false}>
                <div className="border-b border-border px-4 py-3">
                  <p className="text-[12px] font-semibold text-text-2">Personal details</p>
                </div>
                {entriesRead ? (
                  <dl className="divide-y divide-border">
                    <Fact label="Employee id" value={rec!.staff.emp_id.replace(/^EMP_/, '#')} />
                    <Fact label="Status" value={rec!.staff.status || 'Not on file'} />
                    <Fact label="Hired" value={rec!.staff.hire_date || 'Not on file'} />
                    <Fact label="Phone" value={rec!.staff.phone ? formatPhoneDisplay(rec!.staff.phone) : 'Not on file'} />
                    <Fact label="E-mail" value={rec!.staff.email || 'Not on file'} />
                    <Fact label="Driver" value={rec!.staff.driver || 'Not on file'} />
                    <Fact label="HS diploma" value={rec!.staff.hs_diploma || 'Not on file'} />
                  </dl>
                ) : entriesPending ? (
                  <div className="p-4"><Skeleton className="h-[140px] w-full rounded-[10px]" /></div>
                ) : (
                  <div className="p-4">
                    <NotOnFile>
                      {recError} The personal details behind the standing on the hero did not load — they are
                      unread, not missing from the record.
                    </NotOnFile>
                  </div>
                )}
              </Card>
            </div>

            <div className="space-y-4">
              {/* THE GRADE'S ARITHMETIC — and not the figure again. The number
                  itself is on the hero, once; this is what was subtracted from
                  10 to reach it. */}
              <Card>
                <CardHeader title="How the grade was made"
                  sub="Out of 10 — the record subtracts, and every subtraction is named. The figure itself is on the hero." />
                {entriesPending ? (
                  <Skeleton className="h-[72px] w-full rounded-[10px]" />
                ) : !entriesRead ? (
                  <NotOnFile>
                    The arithmetic behind the grade did not load. The figure on the hero came down with the
                    grid; what it was made of is unread.
                  </NotOnFile>
                ) : grade === null ? (
                  <NotOnFile>
                    There is no grade on the record for this person. A grade starts at 10 and subtracts, so an
                    absent record and a spotless one would produce the identical figure.
                  </NotOnFile>
                ) : (rec!.grade?.parts?.length ?? 0) > 0 ? (
                  <>
                    <ul className="space-y-0.5 text-[12.5px] leading-5 text-text-3">
                      {rec!.grade.parts.map((x) => (
                        <li key={x.label}>
                          <span className={cn('font-semibold tabular-nums', TINT_FG.pink)}>{x.cut}</span>
                          {' '}for {x.count} {x.label}
                        </li>
                      ))}
                    </ul>
                    {rec!.grade.ai !== null && rec!.grade.ai !== undefined
                      && Math.abs(rec!.grade.ai - rec!.grade.value) >= 0.1 && (
                      <p className="mt-2 text-[12px] text-text-3">
                        The model argues {rec!.grade.ai.toFixed(1)} instead — its reason is in the record’s
                        evaluation on the Overview.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[12.5px] text-text-3">A clean record — nothing subtracted from 10.</p>
                )}
              </Card>

              <Card padded={false}>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                  {/* the total the board row counted, not the page size the
                      profile read was capped at */}
                  <p className="min-w-0 flex-1 text-[12.5px] font-bold text-text-1">
                    Incidents {r ? <span className="font-stat text-text-3">· {r.incidents}</span> : null}
                  </p>
                  <button
                    type="button"
                    onClick={() => setIncident(incident ? null : { severity: 'low', summary: '', category: '' })}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
                  >
                    <ShieldAlert size={13} /> Add incident
                  </button>
                </div>
                {incident && (
                  <div className="flex flex-wrap items-end gap-2.5 border-b border-border px-4 py-3">
                    <label className="grid gap-1 text-[11.5px] font-semibold text-text-2">Severity
                      <select value={incident.severity}
                        onChange={(e) => setIncident({ ...incident, severity: e.target.value })}
                        className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary">
                        {['low', 'medium', 'high', 'critical'].map((s2) => <option key={s2}>{s2}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[11.5px] font-semibold text-text-2">Category
                      <input value={incident.category} placeholder="e.g. documentation"
                        onChange={(e) => setIncident({ ...incident, category: e.target.value })}
                        className="h-9 w-40 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary" />
                    </label>
                    <label className="grid min-w-[220px] flex-1 gap-1 text-[11.5px] font-semibold text-text-2">What happened
                      <input value={incident.summary} placeholder="A sentence on the incident"
                        onChange={(e) => setIncident({ ...incident, summary: e.target.value })}
                        className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary" />
                    </label>
                    <button type="button" onClick={() => void addIncident()} disabled={writing}
                      className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-50">
                      {writing ? 'Saving…' : 'Record it'}
                    </button>
                  </div>
                )}
                {entriesPending ? (
                  <div className="p-4"><Skeleton className="h-[120px] w-full rounded-[10px]" /></div>
                ) : !entriesRead ? (
                  <div className="p-4"><NotOnFile>The incident entries did not load — unread, never an empty list.</NotOnFile></div>
                ) : rec!.incidents.length === 0 ? (
                  <p className="px-4 py-5 text-center text-[12.5px] text-text-3">Nothing on the incident record.</p>
                ) : (
                  <>
                    <div className="divide-y divide-border">
                      {rec!.incidents.slice(0, 20).map((x, i) => (
                        <div key={i} className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-semibold tabular-nums text-text-1">{x.date || '—'}</span>
                            <span className={cn('rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                              x.severity === 'Major' ? cn(TINT_BG.pink, TINT_FG.pink) : cn(TINT_BG.blue, TINT_FG.blue))}>
                              {x.type}{x.severity ? ` · ${x.severity}` : ''}
                            </span>
                            {x.category && <span className="text-[11px] text-text-3">{x.category}</span>}
                            <span className="ml-auto text-[10.5px] uppercase tracking-wide text-text-3">{x.status}</span>
                          </div>
                          <p className="mt-1 text-[12.5px] leading-5 text-text-2">{x.summary}</p>
                          {x.action && <p className="mt-0.5 text-[11.5px] text-text-3">Action: {x.action}</p>}
                        </div>
                      ))}
                    </div>
                    {/* the entries this read returned — the read is capped at
                        60, so the board row's total is named beside it */}
                    {rec!.incidents.length > 20 && (
                      <p className="border-t border-border px-4 py-2 text-[11px] text-text-3">
                        …and {rec!.incidents.length - 20} more of the {rec!.incidents.length} entries this read
                        returned.
                        {r && r.incidents > rec!.incidents.length
                          ? ` The board row counts ${r.incidents} on the record in all — the read returns the most recent ones.`
                          : ''}
                      </p>
                    )}
                  </>
                )}
              </Card>

              <Card padded={false}>
                <p className="border-b border-border px-4 py-2.5 text-[12.5px] font-bold text-text-1">
                  {/* the notes have no total anywhere — the board row does not
                      count them — so this number says what it is: the entries
                      this read returned */}
                  Notes {entriesRead
                    ? <span className="font-stat text-text-3">· {rec!.notes.length} sent</span>
                    : null}
                </p>
                <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                  <MessageSquarePlus size={14} className="shrink-0 text-text-3" />
                  <input
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addNote() }}
                    placeholder="Write a manager note — lands on the record, signed by you"
                    className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3"
                  />
                  <button
                    type="button"
                    onClick={addNote}
                    disabled={noting || !noteText.trim()}
                    className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11.5px] font-semibold text-on-primary disabled:opacity-50"
                  >
                    {noting ? <Loader2 size={11} className="animate-spin" /> : null} Add
                  </button>
                </div>
                {entriesPending ? (
                  <div className="p-4"><Skeleton className="h-[100px] w-full rounded-[10px]" /></div>
                ) : !entriesRead ? (
                  <div className="p-4"><NotOnFile>The manager notes did not load — unread, never an empty list.</NotOnFile></div>
                ) : rec!.notes.length === 0 ? (
                  <p className="px-4 py-5 text-center text-[12.5px] text-text-3">No notes yet.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {rec!.notes.slice(0, 20).map((n, i) => (
                      <div key={i} className="px-4 py-2">
                        <div className="flex items-center gap-2 text-[11px] text-text-3">
                          {n.category && <span className="rounded bg-surface-2 px-1.5 text-[10.5px] font-semibold uppercase">{n.category}</span>}
                          <span>{n.at}</span>
                        </div>
                        <p className="mt-0.5 text-[12.5px] leading-5 text-text-2">{n.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )
      )}

      {/* ══════════════ ATTENDANCE — ONE section, TWO books, never summed ══ */}
      {active === 'attendance' && (
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            {/* THE HEADING'S NUMBER IS THE TOTAL, off the board row that
                counts the whole tab — never the length of the page the read
                returned. */}
            <p className="min-w-0 flex-1 text-[12.5px] font-bold text-text-1">
              Attendance {r ? <span className="font-stat text-text-3">· {r.attendance_all}</span> : null}
            </p>
            {recordShape === 'reached' && (
              <button
                type="button"
                onClick={() => setAbsence(absence ? null : { date: new Date().toISOString().slice(0, 10), kind: 'absence', notes: '' })}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
              >
                <AlarmClock size={13} /> Log absence
              </button>
            )}
          </div>

          {absence && (
            <div className="flex flex-wrap items-end gap-2.5 border-b border-border px-4 py-3">
              <label className="grid gap-1 text-[11.5px] font-semibold text-text-2">Date
                <input type="date" value={absence.date}
                  onChange={(e) => setAbsence({ ...absence, date: e.target.value })}
                  className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary" />
              </label>
              <label className="grid gap-1 text-[11.5px] font-semibold text-text-2">Kind
                <select value={absence.kind}
                  onChange={(e) => setAbsence({ ...absence, kind: e.target.value })}
                  className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary">
                  {['absence', 'late', 'no-show', 'left-early', 'excused'].map((k) => <option key={k}>{k}</option>)}
                </select>
              </label>
              <label className="grid min-w-[200px] flex-1 gap-1 text-[11.5px] font-semibold text-text-2">Notes
                <input value={absence.notes} placeholder="Optional context"
                  onChange={(e) => setAbsence({ ...absence, notes: e.target.value })}
                  className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary" />
              </label>
              <button type="button" onClick={() => void logAbsence()} disabled={writing}
                className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-50">
                {writing ? 'Saving…' : 'Log it'}
              </button>
            </div>
          )}

          {/* THE SPINE — the record's own entries */}
          {recordShape !== 'reached' ? (
            <div className="p-4">
              {recordShape === 'pending'
                ? <Skeleton className="h-[120px] w-full rounded-[10px]" />
                : <NotOnFile>{recordSentence}</NotOnFile>}
            </div>
          ) : entriesPending ? (
            <div className="p-4"><Skeleton className="h-[140px] w-full rounded-[10px]" /></div>
          ) : !entriesRead ? (
            <div className="p-4">
              <NotOnFile>
                The call-off entries did not load. The count on the hero’s board row stands, but what is behind
                it is unread — never an empty list.
              </NotOnFile>
            </div>
          ) : rec!.attendance.length === 0 ? (
            <p className="px-4 py-5 text-center text-[12.5px] text-text-3">
              No call-offs or lates on the record. The book answered — this is a real zero.
            </p>
          ) : (
            <>
              <div className="divide-y divide-border">
                {rec!.attendance.slice(0, 25).map((a, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">
                    <span className="w-[92px] shrink-0 text-[12px] font-semibold tabular-nums text-text-1">{a.date || '—'}</span>
                    <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                      TINT_BG.amber, TINT_FG.amber)}>{a.kind || 'Call off'}</span>
                    <span className="min-w-0 flex-1 text-[12px] text-text-3">{a.notes}</span>
                    {/* the manager who logged the call-off is a person too */}
                    {a.by && <span className="text-[10.5px] text-text-3">by <DragPerson name={a.by}>{a.by}</DragPerson></span>}
                  </div>
                ))}
              </div>
              {rec!.attendance.length > 25 && (
                // WHAT CAME DOWN, SAID AS WHAT CAME DOWN.
                <p className="border-t border-border px-4 py-2 text-[11px] text-text-3">
                  …and {rec!.attendance.length - 25} more of the {rec!.attendance.length} entries this read
                  returned.
                  {r && r.attendance_all > rec!.attendance.length
                    ? ` The board row counts ${r.attendance_all} on the record in all — the read returns the most recent ones.`
                    : ''}
                </p>
              )}
            </>
          )}

          {/* THE SECOND BOOK, IN A FOOTNOTE WITH ITS OWN AS-OF. Different
              book, different window, different staleness story: it is named
              here so a reader knows it exists, and it is NEVER added to the
              entries above or printed with them as one number. */}
          {person && (
            <div className="border-t border-border bg-surface-2 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3">
                A second book counts call-offs for this person
              </p>
              <p className="mt-1 text-[11.5px] leading-[1.5] text-text-3">
                {ab ? (
                  <>The frozen behaviour call-off book holds <span className="font-stat text-text-2">{ab.count}</span>{' '}
                    in the {ab.window_days} day(s) to {dayText(ab.as_of)}. It is a different book over a different
                    window, and it is never added to the entries above.</>
                ) : person.absences_known ? (
                  <>The frozen behaviour call-off book holds nothing for this person in the window ending{' '}
                    {dayText(person.absences_as_of) || 'an undated day'}.</>
                ) : (
                  <>The frozen behaviour call-off book stopped before this window — its newest entry is{' '}
                    {dayText(person.absences_as_of) || 'undated'}
                    {typeof person.absences_age_days === 'number' && person.absences_age_days >= 0
                      ? `, ${ageText(person.absences_age_days)}` : ''}. Nobody gets a number from it, because a
                    zero here would say “never absent” about a book that simply stopped.</>
                )}
              </p>
              {ab && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {ab.types.map((t) => <StatChip key={t.type} label={t.type} value={t.n} tint="slate" />)}
                  <AsOf at={ab.as_of} age={ab.age_days} fresh={false} what="the book" />
                </div>
              )}
              <p className="mt-2 text-[10.5px] leading-[1.5] text-text-3">
                That book also holds the reason somebody gave, how late they were and who reported it. None of
                the three is read here, and no absence makes anybody’s rhythm read worse.
              </p>
            </div>
          )}
        </Card>
      )}

      {/* ══════════════ CREDENTIALS — one card, the fold as the spine ══════ */}
      {active === 'credentials' && (
        <div className="lg:max-w-[720px]">
          <CredentialsCard
            person={person}
            certs={rec?.certs ?? null}
            certsRead={entriesRead}
            whyUnread={recordShape !== 'reached'
              ? recordSentence
              : entriesPending
                ? <>The record’s own certification rows are still being read.</>
                : <>The record’s own certification rows did not load — unread, not none. The courses above are a
                    different book and are unaffected.</>}
          />
        </div>
      )}

      {/* THE TEN, MOUNTED. Each closes on itself and re-reads the account
          list, so the hero and the card band behind this panel speak the new
          truth the moment the dialog is done. */}
      {account && master && acctDialog === 'profile' && (
        <ProfileDialog user={account as never} onClose={() => setAcctDialog(null)} onDone={reloadAccount} />
      )}
      {account && master && acctDialog === 'contacts' && (
        <ContactsDialog user={account as never} onClose={() => setAcctDialog(null)} onDone={reloadAccount} />
      )}
      {account && master && acctDialog === 'role' && (
        <ChangeRoleDialog roles={VARIANT_ROLES.all} user={account as never} onClose={() => setAcctDialog(null)} onDone={reloadAccount} />
      )}
      {account && master && acctDialog === 'badges' && (
        <SetBadgesDialog user={account as never} onClose={() => setAcctDialog(null)} onDone={reloadAccount} />
      )}
      {account && master && acctDialog === 'app-access' && (
        <AppAccessDialog user={account as never} onClose={() => setAcctDialog(null)} onDone={reloadAccount} />
      )}
      {account && master && acctDialog === 'type' && (
        <SetTypeDialog user={account as never} onClose={() => setAcctDialog(null)} onDone={reloadAccount} />
      )}
      {account && master && acctDialog === 'place' && (
        <SetPlaceDialog user={account as never} onClose={() => setAcctDialog(null)} onDone={reloadAccount} />
      )}
      {account && master && acctDialog === 'password' && (
        <ResetPasswordDialog user={account as never} onClose={() => setAcctDialog(null)} onDone={reloadAccount} />
      )}
      {account && master && acctDialog === 'active' && (
        <ToggleActiveDialog user={account as never} onClose={() => setAcctDialog(null)} onDone={reloadAccount} />
      )}
      {/* REMOVING AN ACCOUNT SENDS THE READER BACK. The profile they are on
          is about to stop existing, and a screen standing on a deleted row
          is a screen telling them something that is no longer true. */}
      {account && master && acctDialog === 'remove' && (
        <RemoveUserDialog
          variant={'all' as never}
          user={account as never}
          onClose={() => setAcctDialog(null)}
          onDone={async () => { await reloadAccount(); onBack() }}
        />
      )}
    </div>
  )
}

function Fact({ label, value, tint }: { label: string; value: string; tint?: ExtendedTintName }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <dt className="text-[12px] text-text-3">{label}</dt>
      <dd className={cn('shrink-0 text-right font-stat text-[12.5px]', tint ? TINT_FG[tint] : 'text-text-1')}>{value}</dd>
    </div>
  )
}

function Tile({ label, value, tint, sub }: {
  label: string
  value: string | number
  tint?: ExtendedTintName
  /** which book this figure came from, said on the tile itself */
  sub?: string
}) {
  return (
    <div className="rounded-[14px] border border-border bg-surface-2 px-3 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</p>
      <p className={cn('mt-0.5 font-stat text-[22px]', tint ? TINT_FG[tint] : 'text-text-1')}>{value}</p>
      {sub && <p className="mt-0.5 text-[10.5px] leading-[1.35] text-text-3">{sub}</p>}
    </div>
  )
}
