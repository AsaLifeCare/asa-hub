// Shared types and display metadata for Time Reconciliation.
// The reads are the Hub's own lanes (app/recon_lanes.py, app/overtime_lanes.py: /hub-lanes/time-recon/…) and the
// writes the recon doors (reconRun, reconErrorResolve, reconRunClose, reconErrorRemind) — the worked side is
// PsiAnywhere's record, and every range is read in its pay periods (14 days, Sunday to Saturday, app/psi_periods.py).
import type { TintName } from '@/engine/types'
import { ohioDateTime } from '@/lib/ohio'

export type ReconType = 'missing' | 'noEnd' | 'dupe' | 'gap' | 'overlap'
export type ReconStatus = 'Open' | 'Excused' | 'Covered' | 'Verified' | 'Flagged' | 'Reviewed'
/** The queue's status filter, as the lane takes it. */
export type QueueStatus = 'open' | 'resolved' | 'all'

export type ReconError = {
  id: string
  runId: string
  /** the anomaly's identity across runs (type|date|house|employee|start): a resolution rides it to the next run */
  key?: string
  type: ReconType
  date: string
  location: string
  employeeId: string
  employeeName: string
  /** Client(s) affected — the server sends a list; a lone string is tolerated. */
  consumers: string[] | string
  startTime: string
  endTime: string
  hours: number
  detail: string
  status: ReconStatus
  note: string
  resolvedBy: string
  resolvedAt: string
  createdAt?: string
  // Reminder trail, stamped by reconErrorRemind — present only after a text was queued for the person.
  reminderQueuedAt?: string
  remindedBy?: string
}

export type ReconRun = {
  id: string
  dateFrom: string
  dateTo: string
  status: 'Review' | 'Reviewed'
  createdAt: string
  createdBy: string
  // the counts are the run row's own flat columns; `counts` is tolerated for a row written before them
  missing?: number
  noEnd?: number
  dupe?: number
  gap?: number
  overlap?: number
  total?: number
  /** resolutions carried forward from the run this one superseded */
  carried?: number
  /** where its worked side came from ('psi', or the retired workbook import on an old run) */
  source?: string
  counts?: Partial<Record<ReconType, number>>
}

/** reconRun's answer. Only `counts` is certain; the rest is read when present. */
export type ReconRunResult = {
  runId: string
  counts?: Partial<Record<ReconType, number>>
  total?: number
  carried?: number
  suppressed?: number
}

// ---- the lanes' answers --------------------------------------------------------------------------------------------

export type PayWeek = { from: string; to: string; label: string }
/** One PsiAnywhere pay period (psi_periods.period): id 'P' + its Sunday, labelled as PsiAnywhere writes it. */
export type PayPeriod = { id: string; from: string; to: string; label: string; current: boolean; weeks: PayWeek[] }
/** A person with PsiAnywhere entries; `key` is recon's match key (the people id, or 'name:<core tokens>'). */
export type ReconEmployee = { key: string; id?: string; name: string }

/** GET /hub-lanes/time-recon/periods */
export type ReconPeriods = {
  today: string
  periods: PayPeriod[]
  houses: string[]
  employees: ReconEmployee[]
  coverage: { psiFrom: string; psiTo: string }
  lastAuto: { ranAt: string; said: string } | null
}

export type TypeCounts = Record<ReconType, number>

/** GET /hub-lanes/time-recon/queue — the counts honour every filter but the type. */
export type ReconQueue = {
  from: string
  to: string
  period: string
  errors: ReconError[]
  counts: {
    total: number
    byType: TypeCounts
    byHouse: { house: string; total: number; byType: TypeCounts }[]
    byEmployee: { key: string; name: string; total: number }[]
  }
  runs: ReconRun[]
  daysWithoutData: string[]
}

export type OvertimeWeek = { from: string; hours: number; over: boolean; overtime: number }
export type OvertimePerson = {
  key: string
  employeeId: string
  employeeName: string
  /** one per week of the answer, each the WHOLE Sunday–Saturday's hours */
  weeks: OvertimeWeek[]
  total: number
  /** the hours inside the dates asked (the weeks may reach past them) */
  inRange: number
  overtime: number
  days: Record<string, number>
  /** entries still open (no clock-out): their hours are not in the sums */
  open?: number | boolean
}

/** GET /hub-lanes/time-recon/overtime */
export type OvertimeData = {
  from: string
  to: string
  threshold: number
  weeks: PayWeek[]
  people: OvertimePerson[]
  totals: { people: number; peopleOver: number; overtimeHours: number; hours: number }
  periods: PayPeriod[]
  employees: ReconEmployee[]
}

export type OvertimeEntry = {
  date: string
  startTime: string
  endTime: string
  hours: number
  location: string
  site: string
  workCode: string
  status: string
  consumers: string[] | string
  entryIds: string[] | string
}

/** GET /hub-lanes/time-recon/overtime/entries */
export type OvertimeEntries = { employee: { key: string; name: string }; entries: OvertimeEntry[] }

// ---- display ------------------------------------------------------------------------------------------------------

export const RECON_TYPES: ReconType[] = ['missing', 'noEnd', 'dupe', 'gap', 'overlap']

export const TYPE_META: Record<ReconType, { label: string; tint: TintName; blurb: string }> = {
  missing: { label: 'Missing punch', tint: 'amber', blurb: 'Scheduled, never clocked in' },
  noEnd: { label: 'No clock-out', tint: 'pink', blurb: 'A punch left open' },
  dupe: { label: 'Overlapping punches', tint: 'lavender', blurb: 'Two punches at the same time' },
  gap: { label: 'Coverage gap', tint: 'blue', blurb: 'Client unattended over 5 minutes' },
  overlap: { label: 'Double coverage', tint: 'peach', blurb: '2+ staff on one client over 45 minutes' },
}

/** Which resolution each anomaly offers, beyond "Mark reviewed" (offered to all). */
export const TYPE_ACTIONS: Record<ReconType, ReconStatus[]> = {
  missing: ['Excused', 'Covered'],
  noEnd: [],
  dupe: [],
  gap: ['Verified'],
  overlap: ['Flagged'],
}

export const ACTION_LABEL: Record<ReconStatus, string> = {
  Open: 'Reopen',
  Excused: 'Excused',
  Covered: 'Covered',
  Verified: 'Verified',
  Flagged: 'Flag',
  Reviewed: 'Mark reviewed',
}

// Excused and Covered are durable audit claims — the note IS the evidence, so the panel refuses to save them empty.
export const NOTE_REQUIRED: ReadonlySet<ReconStatus> = new Set(['Excused', 'Covered'])

export const STATUS_TINT: Record<ReconStatus, TintName> = {
  Open: 'amber',
  Excused: 'blue',
  Covered: 'mint',
  Verified: 'mint',
  Flagged: 'pink',
  Reviewed: 'mint',
}

/** PsiAnywhere's entry statuses (P, A, S and I are worked time; R and D never reach the sums). */
export const PSI_STATUS: Record<string, string> = {
  A: 'Awaiting approval', P: 'Pending', R: 'Rejected', I: 'Imported', S: 'Submitted', D: 'Duplicate',
}

export function zeroCounts(): TypeCounts {
  return { missing: 0, noEnd: 0, dupe: 0, gap: 0, overlap: 0 }
}

/** A run row's counts per type: its flat columns, or a `counts` object on a row written before them. */
export function runCounts(r: ReconRun): TypeCounts {
  const out = zeroCounts()
  for (const t of RECON_TYPES) out[t] = Number(r[t] ?? r.counts?.[t]) || 0
  return out
}

/** The server sends consumers as a list; a lone string is read as one, never guessed. */
export function consumerList(v: ReconError['consumers']): string[] {
  if (Array.isArray(v)) return v.filter(Boolean)
  return v ? [v] : []
}

/** Hours as a person reads them: '7.5h', never '7.499999h'. */
export function hoursLabel(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(n * 100) / 100}h`
}

// ---- days and pay periods -----------------------------------------------------------------------------------------

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000
// app/psi_periods.py PERIOD_ANCHOR / PERIOD_DAYS: the grid PsiAnywhere's own Imported batches follow
const PERIOD_ANCHOR = '2026-06-07'
const PERIOD_DAYS = 14

/** A 'YYYY-MM-DD' as a whole UTC day count — day arithmetic with no clock and no DST in it. */
function dayNumber(d: string): number | null {
  const m = ISO_DAY.exec(String(d ?? '').trim())
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const back = new Date(t)
  // 2026-02-31 is no day: refused rather than rolled into March
  if (back.getUTCMonth() !== +m[2] - 1 || back.getUTCDate() !== +m[3]) return null
  return Math.round(t / DAY_MS)
}

function dayOfNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

export function isDay(d: string): boolean {
  return dayNumber(d) !== null
}

/** Days from `a` to `b` counting both ends (0 when either is not a day). */
export function daySpan(a: string, b: string): number {
  const x = dayNumber(a)
  const y = dayNumber(b)
  return x === null || y === null ? 0 : y - x + 1
}

function short(d: string): string {
  const m = ISO_DAY.exec(d)
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : d
}

/** The pay period holding `day`, computed on the same grid as the server's (so the queue can start before /periods
 *  answers, and a day older than the 13 listed still opens its own period). */
export function payPeriodOf(day: string, today = ''): PayPeriod | null {
  const n = dayNumber(day)
  const anchor = dayNumber(PERIOD_ANCHOR)!
  if (n === null) return null
  const a = anchor + Math.floor((n - anchor) / PERIOD_DAYS) * PERIOD_DAYS
  const b = a + PERIOD_DAYS - 1
  const now = dayNumber(today) ?? n
  const from = dayOfNumber(a)
  const to = dayOfNumber(b)
  return {
    id: `P${from}`, from, to, label: `${short(from)} – ${short(to)}`, current: a <= now && now <= b,
    weeks: [0, 1].map((k) => {
      const wf = dayOfNumber(a + 7 * k)
      const wt = dayOfNumber(a + 7 * k + 6)
      return { from: wf, to: wt, label: `${short(wf)} – ${short(wt)}` }
    }),
  }
}

/** Every day from `a` to `b` (inclusive); none when the range is not one. */
export function daysBetween(a: string, b: string): string[] {
  const x = dayNumber(a)
  const y = dayNumber(b)
  if (x === null || y === null || y < x) return []
  return Array.from({ length: y - x + 1 }, (_, i) => dayOfNumber(x + i))
}

/** A list of days folded into runs: ['Aug 13 – Sep 19', 'Oct 2'] — 38 empty days read as one hole, not 38 words. */
export function dayRuns(days: string[]): string[] {
  const nums = [...new Set(days.map(dayNumber).filter((n): n is number => n !== null))].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < nums.length;) {
    let j = i
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1
    const a = dayOfNumber(nums[i])
    const b = dayOfNumber(nums[j])
    out.push(i === j ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`)
    i = j + 1
  }
  return out
}

// A stored 'YYYY-MM-DD' read as a LOCAL day — new Date('2026-08-12') is midnight UTC, a day early in Ohio.
export function dayLabel(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '')
  if (!m) return d || '—'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** 'Thu, Oct 29' — a day in a list of days, where the weekday is what tells the weeks apart. */
export function weekdayLabel(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '')
  if (!m) return d || '—'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** 'Oct 29, 2026' — a day that may sit in another year than the one being read. */
export function dayYearLabel(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '')
  if (!m) return d || '—'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// A punch time as a wall clock.
export function timeLabel(v: string): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  // 1899-12-30T07:00:00.000Z — a time-only cell, never a date in 1899.
  const epoch = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::\d{2})?/.exec(s)
  if (epoch && /^18\d\d-/.test(s)) return clock(+epoch[1], +epoch[2])
  // 7:00:00 AM / 4:30 PM — already a wall clock; drop the seconds.
  const ampm = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?$/.exec(s)
  if (ampm) {
    let h = +ampm[1] % 12
    if (ampm[3].toLowerCase() === 'p') h += 12
    return clock(h, +ampm[2])
  }
  // 21:30 / 21:30:00 — 24-hour, as some imports write it.
  const h24 = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s)
  if (h24 && +h24[1] < 24) return clock(+h24[1], +h24[2])
  return s
}

function clock(h: number, m: number): string {
  const ap = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`
}

// An ISO timestamp as a short stamp in Ohio wall-clock — the company clock, whoever is reading; anything unparsable…
export function stampLabel(iso: string): string {
  if (!iso) return '—'
  return ohioDateTime(iso) || iso
}
