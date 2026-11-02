// House Repair's one reading of "House Repair Requests › Repairs": the list and its black header both count from…
// A figure the rows cannot give is null (drawn "—"), never 0.
import type { OpsRow } from '@/features/ops-flows/useOpsCrud'
import { ohioWall } from '@/lib/ohio'
import type { ExtendedTintName } from '@/lib/tints'

export type Priority = 'urgent' | 'high' | 'medium' | 'low'
export type Stage = 'New' | 'In Progress' | 'Completed'
export type StatusBucket = 'new' | 'in-progress' | 'on-hold' | 'completed' | 'cancelled' | 'other'

export type RepairRow = {
  id: string
  house: string
  repairType: string
  issue: string
  resolution: string
  /** the urgency cell as typed */
  urgencyRaw: string
  urgency: number | null
  /** null when the cell is blank or holds a word that is not a level */
  priority: Priority | null
  /** the status cell as typed */
  status: string
  bucket: StatusBucket
  stage: Stage
  onHold: boolean
  cancelled: boolean
  reported: Date | null
  /** the row as the sheet holds it — what an edit prefills from and writes back */
  raw: OpsRow
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim())
const fold = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, ' ').trim()

/** ISO instants on Ohio's clock; a typed M/D/YYYY stays as typed. */
export function repairDate(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (mdy) {
    const d = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  return ohioWall(s)
}

const PRIORITY_WORDS: Record<string, Priority> = { urgent: 'urgent', high: 'high', medium: 'medium', low: 'low' }

/** The form's 1–5 scale (5 urgent, 4 high, 3 medium, 2 and 1 low), or the page's own four words. */
export function readUrgency(cell: unknown): { level: number | null; priority: Priority | null } {
  const s = str(cell)
  if (!s) return { level: null, priority: null }
  if (/^[1-5]$/.test(s)) {
    const n = Number(s)
    return { level: n, priority: n === 5 ? 'urgent' : n === 4 ? 'high' : n === 3 ? 'medium' : 'low' }
  }
  return { level: null, priority: PRIORITY_WORDS[fold(s)] ?? null }
}

const STATUS_WORDS: Record<string, StatusBucket> = {
  '': 'new',
  new: 'new',
  'in progress': 'in-progress',
  'on hold': 'on-hold',
  completed: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
}

/** Blank is New — how the estate's form files a request. */
export const statusBucket = (status: unknown): StatusBucket => STATUS_WORDS[fold(str(status))] ?? 'other'

export function toRepairRow(raw: OpsRow, i: number): RepairRow {
  const { level, priority } = readUrgency(raw.urgency_level)
  const status = str(raw.status)
  const bucket = statusBucket(status)
  return {
    id: str(raw.id) || `row-${i}`,
    house: str(raw.select_address_vehicle),
    repairType: str(raw.repair_type),
    issue: str(raw.please_describe_the_issue),
    resolution: str(raw.resolution_notes),
    urgencyRaw: str(raw.urgency_level),
    urgency: level,
    priority,
    status,
    bucket,
    stage: bucket === 'completed' ? 'Completed' : bucket === 'in-progress' ? 'In Progress' : 'New',
    onHold: bucket === 'on-hold',
    cancelled: bucket === 'cancelled',
    reported: repairDate(raw.timestamp),
    raw,
  }
}

export const repairDay = (d: Date | null) =>
  d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

/** Address cell may name the whole estate ('ALL' / 'All') or be blank. */
export const isWholeEstate = (house: string) => house.toLowerCase() === 'all'
export const houseLabel = (house: string) => (isWholeEstate(house) ? 'All houses' : house || '—')

export const isOpen = (r: RepairRow) => r.bucket !== 'completed' && r.bucket !== 'cancelled'
export const isUrgentOpen = (r: RepairRow) => isOpen(r) && (r.priority === 'urgent' || r.priority === 'high')

/** Groups the status distribution; a word outside the lifecycle is its own group. */
export const statusKey = (r: RepairRow) => (r.bucket === 'other' ? `other:${fold(r.status)}` : r.bucket)

const houseKey = (house: string) => fold(house)
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/* ---------- the header's figures ---------- */

export const BUCKET_LABEL: Record<Exclude<StatusBucket, 'other'>, string> = {
  new: 'New',
  'in-progress': 'In progress',
  'on-hold': 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
const LIFECYCLE: Exclude<StatusBucket, 'other'>[] = ['new', 'in-progress', 'on-hold', 'completed', 'cancelled']

export type StatusSlice = { key: string; bucket: StatusBucket; label: string; count: number }

const BUCKET_TINT: Record<Exclude<StatusBucket, 'other'>, ExtendedTintName> = {
  new: 'blue',
  'in-progress': 'lavender',
  'on-hold': 'amber',
  completed: 'mint',
  cancelled: 'slate',
}
const OTHER_TINTS: ExtendedTintName[] = ['pink', 'peach', 'violet']

/** One colour per status, the same on the header's bar and pills and on the list's badge. */
export function statusTints(statuses: StatusSlice[]): Map<string, ExtendedTintName> {
  let other = 0
  return new Map(statuses.map((s) => [
    s.key,
    s.bucket === 'other' ? OTHER_TINTS[other++ % OTHER_TINTS.length] : BUCKET_TINT[s.bucket],
  ]))
}

export type RepairFigures = {
  total: number
  open: { count: number; new: number; inProgress: number; onHold: number; other: number }
  urgent: { count: number; urgent: number; high: number; unreadable: number }
  /** null when nothing open carries a readable date */
  oldest: { row: RepairRow; ageDays: number } | null
  undatedOpen: number
  month: { key: string; name: string; filed: number; done: number }
  /** null when nothing open names a single house or vehicle */
  topHouse: { key: string; label: string; open: number; tiedWith: number } | null
  openNoHouse: number
  /** open requests filed for every house at once ('ALL') — never a house of their own */
  openWholeEstate: number
  statuses: StatusSlice[]
  undated: number
  noUrgency: number
}

export function analyseRepairs(rows: RepairRow[], now: number): RepairFigures {
  const today = ohioWall(new Date(now)) ?? new Date(now)
  const todayN = dayNumber(today)
  const thisMonth = monthKey(today)
  const open = rows.filter(isOpen)

  let oldest: { row: RepairRow; at: Date } | null = null
  for (const r of open) {
    if (r.reported && (!oldest || r.reported.getTime() < oldest.at.getTime())) oldest = { row: r, at: r.reported }
  }

  const houses = new Map<string, { label: string; open: number }>()
  for (const r of open) {
    if (!r.house || isWholeEstate(r.house)) continue
    const k = houseKey(r.house)
    const hit = houses.get(k)
    if (hit) hit.open++
    else houses.set(k, { label: r.house, open: 1 })
  }
  const ranked = [...houses.entries()].sort((a, b) => b[1].open - a[1].open || a[1].label.localeCompare(b[1].label))
  const top = ranked[0]

  const statuses: StatusSlice[] = []
  for (const b of LIFECYCLE) {
    const count = rows.filter((r) => r.bucket === b).length
    if (count) statuses.push({ key: b, bucket: b, label: BUCKET_LABEL[b], count })
  }
  const others = new Map<string, StatusSlice>()
  for (const r of rows) {
    if (r.bucket !== 'other') continue
    const k = statusKey(r)
    const hit = others.get(k)
    if (hit) hit.count++
    else others.set(k, { key: k, bucket: 'other', label: r.status, count: 1 })
  }
  statuses.push(...[...others.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)))

  const filed = rows.filter((r) => r.reported && monthKey(r.reported) === thisMonth)
  const openUrgent = open.filter(isUrgentOpen)

  return {
    total: rows.length,
    open: {
      count: open.length,
      new: open.filter((r) => r.bucket === 'new').length,
      inProgress: open.filter((r) => r.bucket === 'in-progress').length,
      onHold: open.filter((r) => r.bucket === 'on-hold').length,
      other: open.filter((r) => r.bucket === 'other').length,
    },
    urgent: {
      count: openUrgent.length,
      urgent: openUrgent.filter((r) => r.priority === 'urgent').length,
      high: openUrgent.filter((r) => r.priority === 'high').length,
      unreadable: open.filter((r) => r.priority === null).length,
    },
    // a future-dated filing is not negative age
    oldest: oldest ? { row: oldest.row, ageDays: Math.max(0, todayN - dayNumber(oldest.at)) } : null,
    undatedOpen: open.filter((r) => !r.reported).length,
    month: {
      key: thisMonth,
      name: today.toLocaleDateString('en-US', { month: 'long' }),
      filed: filed.length,
      done: filed.filter((r) => r.bucket === 'completed').length,
    },
    topHouse: top
      ? { key: top[0], label: top[1].label, open: top[1].open, tiedWith: ranked.filter((h) => h !== top && h[1].open === top[1].open).length }
      : null,
    openNoHouse: open.filter((r) => !r.house).length,
    openWholeEstate: open.filter((r) => isWholeEstate(r.house)).length,
    statuses,
    undated: rows.filter((r) => !r.reported).length,
    noUrgency: rows.filter((r) => r.priority === null).length,
  }
}

/* ---------- a figure, clicked, is the list of what it counted ---------- */

export type RepairFilter =
  | { kind: 'open' }
  /** the open requests, listed oldest first */
  | { kind: 'oldest' }
  | { kind: 'urgent' }
  | { kind: 'month-done'; month: string; name: string }
  | { kind: 'house'; key: string; label: string }
  | { kind: 'status'; key: string; label: string }

export function repairFilterTest(f: RepairFilter): (r: RepairRow) => boolean {
  switch (f.kind) {
    case 'open':
    case 'oldest': return isOpen
    case 'urgent': return isUrgentOpen
    case 'month-done': return (r) => r.bucket === 'completed' && !!r.reported && monthKey(r.reported) === f.month
    case 'house': return (r) => isOpen(r) && houseKey(r.house) === f.key
    case 'status': return (r) => statusKey(r) === f.key
  }
}

export function repairFilterLabel(f: RepairFilter): string {
  switch (f.kind) {
    case 'open': return 'Open requests'
    case 'oldest': return 'Open requests, oldest first'
    case 'urgent': return 'Urgent / high, open'
    case 'month-done': return `Completed, filed in ${f.name}`
    case 'house': return `Open at ${houseLabel(f.label)}`
    case 'status': return `Status: ${f.label}`
  }
}

/** 'oldest' is its own id: the two open figures are never pressed together. */
const filterId = (f: RepairFilter): string =>
  f.kind === 'house' || f.kind === 'status' ? `${f.kind}:${f.key}` : f.kind === 'month-done' ? `${f.kind}:${f.month}` : f.kind

export const sameRepairFilter = (a: RepairFilter | null, b: RepairFilter | null): boolean =>
  !!a && !!b && filterId(a) === filterId(b)
