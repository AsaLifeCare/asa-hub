// THE PUNCH RECORD — the hours PsiAnywhere, the agency's official time clock, wrote down.
// WHAT THIS SCREEN IS, SAID ONCE SO NOBODY HAS TO DEDUCE IT.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw, Search } from 'lucide-react'
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
import { toast } from '@/stores/useToastStore'
import { useContextStore } from '@/stores/useContextStore'
import { rowFocusTier } from '@/lib/focus'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

// ------------------------------------------------------------------ the shapes — exactly the columns the house…

// One stored punch.
type PunchRow = {
  single_entry_id: string
  status: string
  employee: string
  people_id: string
  date_service: string
  date_iso: string
  start_time: string
  end_time: string
  hours: string
  work_code: string
  submitted_user: string
  supervisor_id: string
  has_signature: string
  is_documented: string
  source: string
  source_synced_at: string
  evv_reasons: string
}

/** What `psiPunchesList` answers. `caveat` is the most important field on it. */
type ListAnswer = {
  rows: PunchRow[]
  shown: number
  total: number
  held: number
  offset: number
  limit: number
  summary?: { rows: number; people: number; hours: number; open_punches: number; undocumented: number }
  read_only: boolean
  frozen: boolean
  source?: string
  confirmed_at?: string
  caveat?: string
  note?: string
}

/** What the record says about itself, whichever path answered. */
type Provenance = {
  /** the door's own sentence about what a row is and what a gap is not */
  caveat: string
  /** where the rows were lifted from: the stored copy's table, the live reads, or both */
  source: string
  /** when the relay last proved the house matches the record it was handed */
  confirmed_at: string
  /** how many rows the house holds, as the house counted them */
  held: number | null
  /** which path answered, so the screen can say where it is reading from */
  via: 'slice' | 'door'
}

// ------------------------------------------------------------------ reading PsiAnywhere's own spellings…

const DAY_MS = 86_400_000
const MIN_PER_DAY = 1440

// A DAY IS A DAY, NOT AN INSTANT.
function dayIndex(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return null
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(at) ? null : Math.round(at / DAY_MS)
}

const dayLabel = (idx: number | null, opts?: Intl.DateTimeFormatOptions) =>
  idx === null
    ? ''
    : new Date(idx * DAY_MS).toLocaleDateString(undefined,
        { month: 'short', day: 'numeric', timeZone: 'UTC', ...opts })

// PsiAnywhere writes a clock as `hh:mm:ss AM`.
function clockMinutes(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?$/.exec((raw || '').trim())
  if (!m) return null
  const hour12 = Number(m[1])
  const min = Number(m[2])
  if (hour12 < 1 || hour12 > 12 || min > 59) return null
  const h = (hour12 % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)
  return h * 60 + min
}

/** Minutes past midnight → `7:30 PM`. */
function clockLabel(min: number | null): string {
  if (min === null) return ''
  const inDay = ((min % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY
  const h24 = Math.floor(inDay / 60)
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(inDay % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

// PsiAnywhere's own check_hours.
function checkHours(raw: string): number {
  const n = Number((raw || '').trim())
  return Number.isFinite(n) ? n : 0
}

const fmtHours = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 0 : 1 })

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

// An ISO instant as a short local stamp.
const stampText = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ------------------------------------------------------------------ THE STITCH — undoing PsiAnywhere's midnight…

// How much daylight between two punches still counts as one shift.
const STITCH_GAP_MIN = 5

type Leg = { row: PunchRow; start: number; end: number | null }

/** One real shift: the rows PsiAnywhere cut it into, put back together. */
type Shift = {
  who: string
  employee: string
  /** absolute minutes — day number × 1440 + clock */
  start: number
  /** null when a punch inside it was never closed: the END IS UNKNOWN */
  end: number | null
  /** PsiAnywhere's own hours, summed over the legs */
  hours: number
  legs: PunchRow[]
  open: boolean
  crosses: boolean
}

// people_id is the identity; a row that carries none falls back to the name it was filed under, so it is still…
const whoOf = (r: PunchRow) => (r.people_id || '').trim() || `name:${(r.employee || '').trim().toLowerCase()}`

// Rows → shifts.
function stitch(rows: PunchRow[]): { shifts: Shift[]; unreadable: number } {
  const byPerson = new Map<string, Leg[]>()
  let unreadable = 0

  for (const r of rows) {
    const day = dayIndex(r.date_iso)
    const from = clockMinutes(r.start_time)
    if (day === null || from === null) { unreadable++; continue }
    const start = day * MIN_PER_DAY + from
    const to = clockMinutes(r.end_time)
    let end: number | null = to === null ? null : day * MIN_PER_DAY + to
    // a clock-out earlier than the clock-in is the next day's clock — the record holds none of these, and the guard…
    if (end !== null && end < start) end += MIN_PER_DAY
    const key = whoOf(r)
    const legs = byPerson.get(key)
    if (legs) legs.push({ row: r, start, end })
    else byPerson.set(key, [{ row: r, start, end }])
  }

  const shifts: Shift[] = []
  for (const [who, legs] of byPerson) {
    legs.sort((a, b) => a.start - b.start || (a.end ?? a.start) - (b.end ?? b.start))
    let cur: Shift | null = null
    for (const leg of legs) {
      const joins = cur !== null && cur.end !== null && leg.start <= cur.end + STITCH_GAP_MIN
      if (!joins) {
        cur = {
          who,
          employee: (leg.row.employee || '').trim(),
          start: leg.start,
          end: leg.end,
          hours: checkHours(leg.row.hours),
          legs: [leg.row],
          open: leg.end === null,
          crosses: false,
        }
        shifts.push(cur)
        continue
      }
      const shift = cur as Shift
      shift.legs.push(leg.row)
      shift.hours += checkHours(leg.row.hours)
      if (leg.end === null) { shift.open = true; shift.end = null }
      else shift.end = Math.max(shift.end as number, leg.end)
    }
  }

  for (const s of shifts) {
    s.crosses = s.end !== null && Math.floor(s.end / MIN_PER_DAY) > Math.floor(s.start / MIN_PER_DAY)
  }
  shifts.sort((a, b) => b.start - a.start)
  return { shifts, unreadable }
}

// ------------------------------------------------------------------ THE ARITHMETIC — counted from the rows, never…

type Person = {
  key: string
  name: string
  /** PsiAnywhere filed one worker under more than one spelling; both are kept */
  aliases: string[]
  people_id: string
  rows: number
  shifts: number
  hours: number
  nights: number
  open: number
  days: number
  first: number | null
  last: number | null
  documented: number
  signed: number
  codes: string[]
}

type Tally = { label: string; n: number }

type Board = {
  rows: number
  unreadable: number
  shifts: number
  multiLeg: number
  absorbed: number
  hours: number
  people: Person[]
  names: number
  first: number | null
  last: number | null
  /** shifts, classified so the hero band adds up to the whole record */
  overnight: number
  early: number
  late: number
  daytime: number
  open: number
  /** the same two questions asked of ROWS — the proof of the cut */
  rowEarly: number
  rowLate: number
  // and asked of STITCHED SHIFTS, counted independently of the hero's mutually-exclusive bands so the comparison is…
  shiftEarly: number
  shiftEndLate: number
  /** shift starts, by hour of the day */
  startHour: number[]
  /** shifts per service day across the window, empty days included */
  rail: { day: number; n: number }[]
  // `live` counts the rows the relay read live with the field empty: the live read does not carry these fields at…
  documented: { yes: number; no: number; blank: number; live: number }
  signed: { yes: number; no: number; blank: number; live: number }
  evv: Tally[]
  evvRows: number
  /** live rows with no EVV code — not carried by the live read */
  evvLive: number
  status: Tally[]
  work: Tally[]
  submitters: number
  spans: Tally[]
  spanKnown: number
}

const EARLY_BEFORE_H = 6
const LATE_FROM_H = 21

function tallyOf(counts: Map<string, number>): Tally[] {
  return [...counts.entries()]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
}

function build(rows: PunchRow[]): Board {
  const { shifts, unreadable } = stitch(rows)

  const documented = { yes: 0, no: 0, blank: 0, live: 0 }
  const signed = { yes: 0, no: 0, blank: 0, live: 0 }
  const evv = new Map<string, number>()
  const status = new Map<string, number>()
  const work = new Map<string, number>()
  const submitters = new Set<string>()
  const names = new Set<string>()
  let evvRows = 0
  let evvLive = 0
  let rowEarly = 0
  let rowLate = 0

  for (const r of rows) {
    // A ROW THE RELAY READ LIVE carries no paperwork fields at all: its empty cells are "not carried", never the…
    const live = r.source === LIVE_SOURCE
    const doc = (r.is_documented || '').trim()
    if (doc === 'true') documented.yes++
    else if (doc === 'false') documented.no++
    else if (live) documented.live++
    else documented.blank++
    const sig = (r.has_signature || '').trim()
    if (sig === 'true') signed.yes++
    else if (sig === 'false') signed.no++
    else if (live) signed.live++
    else signed.blank++
    const code = (r.evv_reasons || '').trim()
    if (code) { evvRows++; evv.set(code, (evv.get(code) ?? 0) + 1) } else if (live) evvLive++
    const st = (r.status || '').trim()
    if (st) status.set(st, (status.get(st) ?? 0) + 1)
    const wc = (r.work_code || '').trim()
    if (wc) work.set(wc, (work.get(wc) ?? 0) + 1)
    const by = (r.submitted_user || '').trim()
    if (by) submitters.add(by.toLowerCase())
    const nm = (r.employee || '').trim()
    if (nm) names.add(nm.toLowerCase())
    // THE ROW-LEVEL PAIR, kept only so the page can show what the cut does to it.
    const from = clockMinutes(r.start_time)
    if (from !== null && from < EARLY_BEFORE_H * 60) rowEarly++
    const to = clockMinutes(r.end_time)
    if (to !== null && to >= LATE_FROM_H * 60) rowLate++
  }

  const startHour = new Array<number>(24).fill(0)
  const perDay = new Map<number, number>()
  const spanBuckets: [string, (h: number) => boolean][] = [
    ['under 4h', (h) => h < 4],
    ['4–8h', (h) => h >= 4 && h < 8],
    ['8–12h', (h) => h >= 8 && h < 12],
    ['12–16h', (h) => h >= 12 && h < 16],
    ['16–24h', (h) => h >= 16 && h < 24],
    ['24h or more', (h) => h >= 24],
  ]
  const spans = new Map<string, number>(spanBuckets.map(([label]) => [label, 0] as [string, number]))

  let overnight = 0
  let early = 0
  let late = 0
  let daytime = 0
  let open = 0
  let shiftEarly = 0
  let shiftEndLate = 0
  let multiLeg = 0
  let hours = 0
  let spanKnown = 0
  let first: number | null = null
  let last: number | null = null

  const people = new Map<string, Person & { spellings: Map<string, number>; dayset: Set<number>; codeset: Set<string> }>()

  for (const s of shifts) {
    hours += s.hours
    if (s.legs.length > 1) multiLeg++
    const day = Math.floor(s.start / MIN_PER_DAY)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
    if (first === null || day < first) first = day
    const endDay = s.end === null ? day : Math.floor(s.end / MIN_PER_DAY)
    if (last === null || endDay > last) last = endDay
    startHour[Math.floor((s.start % MIN_PER_DAY) / 60)]++

    // asked of every shift, independently of the band it lands in below
    if (s.start % MIN_PER_DAY < EARLY_BEFORE_H * 60) shiftEarly++
    if (s.end !== null && s.end % MIN_PER_DAY >= LATE_FROM_H * 60) shiftEndLate++

    if (s.end === null) open++
    else if (s.crosses) overnight++
    else if (s.start % MIN_PER_DAY < EARLY_BEFORE_H * 60) early++
    else if (s.end % MIN_PER_DAY >= LATE_FROM_H * 60) late++
    else daytime++

    if (s.end !== null) {
      const span = (s.end - s.start) / 60
      spanKnown++
      for (const [label, hit] of spanBuckets) {
        if (hit(span)) { spans.set(label, (spans.get(label) ?? 0) + 1); break }
      }
    }

    let p = people.get(s.who)
    if (!p) {
      p = {
        key: s.who, name: s.employee, aliases: [], people_id: s.who.startsWith('name:') ? '' : s.who,
        rows: 0, shifts: 0, hours: 0, nights: 0, open: 0, days: 0, first: null, last: null,
        documented: 0, signed: 0, codes: [],
        spellings: new Map(), dayset: new Set(), codeset: new Set(),
      }
      people.set(s.who, p)
    }
    p.shifts++
    p.rows += s.legs.length
    p.hours += s.hours
    if (s.crosses) p.nights++
    if (s.open) p.open++
    p.dayset.add(day)
    if (p.first === null || day < p.first) p.first = day
    if (p.last === null || endDay > p.last) p.last = endDay
    for (const leg of s.legs) {
      const nm = (leg.employee || '').trim()
      if (nm) p.spellings.set(nm, (p.spellings.get(nm) ?? 0) + 1)
      if ((leg.is_documented || '').trim() === 'true') p.documented++
      if ((leg.has_signature || '').trim() === 'true') p.signed++
      const wc = (leg.work_code || '').trim()
      if (wc) p.codeset.add(wc)
    }
  }

  const roster: Person[] = [...people.values()].map((p) => {
    const spellings = [...p.spellings.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
    return {
      key: p.key,
      name: spellings[0] || p.name || 'Unnamed',
      aliases: spellings.slice(1),
      people_id: p.people_id,
      rows: p.rows, shifts: p.shifts, hours: p.hours, nights: p.nights, open: p.open,
      days: p.dayset.size, first: p.first, last: p.last,
      documented: p.documented, signed: p.signed,
      codes: [...p.codeset].sort(),
    }
  }).sort((a, b) => b.hours - a.hours || b.shifts - a.shifts)

  const rail: { day: number; n: number }[] = []
  if (first !== null && last !== null) {
    for (let d = first; d <= last; d++) rail.push({ day: d, n: perDay.get(d) ?? 0 })
  }

  return {
    rows: rows.length,
    unreadable,
    shifts: shifts.length,
    multiLeg,
    absorbed: Math.max(0, rows.length - unreadable - shifts.length),
    hours,
    people: roster,
    names: names.size,
    first, last,
    overnight, early, late, daytime, open,
    rowEarly, rowLate, shiftEarly, shiftEndLate,
    startHour,
    rail,
    documented, signed,
    evv: tallyOf(evv), evvRows, evvLive,
    status: tallyOf(status),
    work: tallyOf(work),
    submitters: submitters.size,
    spans: [...spans.entries()].map(([label, n]) => ({ label, n })),
    spanKnown,
  }
}

// ------------------------------------------------------------------ the small drawings — divs and spans…

function Tile({ label, value, sub, tint }:
  { label: string; value: string | number; sub?: string; tint?: ExtendedTintName }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface-2 px-3 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</p>
      <p className={cn('mt-0.5 font-stat text-[22px] leading-tight', tint ? TINT_FG[tint] : 'text-text-1')}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-[1.4] text-text-3">{sub}</p>}
    </div>
  )
}

// UNKNOWN MUST LOOK LIKE UNKNOWN — a dashed outline and a sentence saying what is missing, never a zero and never a…
function NotOnFile({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[10px] border border-dashed border-border px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-text-3">
      {children}
    </p>
  )
}

// Ranked bars with the label on its own row: codes and names are long and an axis collides with them.
function Bars({ items, tint = 'blue', unit }:
  { items: Tally[]; tint?: ExtendedTintName; unit?: string }) {
  if (!items.length) return <NotOnFile>Nothing was filed in this column at all.</NotOnFile>
  const peak = Math.max(1, ...items.map((i) => i.n))
  return (
    <ul className="space-y-2.5">
      {items.map((i, idx) => (
        <li key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-[12.5px] font-medium text-text-1">{i.label}</span>
            <span className="shrink-0 font-stat text-[12.5px] text-text-2">
              {i.n.toLocaleString()}{unit ? <span className="ml-1 font-normal text-text-3">{unit}</span> : null}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, (i.n / peak) * 100)}%` }}
              transition={{ duration: 0.6, ease: EASE_OUT_EXPO, delay: Math.min(idx, 6) * 0.04 }}
              className="h-full rounded-full"
              style={{ background: TINT_VAR[tint] }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// THE WHOLE WINDOW, one column a service day.
function Rail({ rail }: { rail: { day: number; n: number }[] }) {
  if (!rail.length) return <NotOnFile>No service date in the record could be read, so there is no window to draw.</NotOnFile>
  const peak = Math.max(1, ...rail.map((d) => d.n))
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="flex h-[110px] min-w-[520px] items-end gap-[2px]">
        {rail.map((d) => {
          const weekend = [0, 6].includes(new Date(d.day * DAY_MS).getUTCDay())
          return (
            <div key={d.day} className="flex min-w-[4px] flex-1 flex-col items-center gap-1"
                 title={`${dayLabel(d.day, { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.n} ${plural(d.n, 'shift')}`}>
              <div
                className={cn('w-full rounded-[2px]', d.n ? (weekend ? 'bg-tint-amber' : 'bg-tint-blue') : 'bg-border')}
                style={{ height: d.n ? Math.max(5, Math.round((d.n / peak) * 92)) : 2 }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// When shifts BEGIN, by hour.
function StartClock({ hours }: { hours: number[] }) {
  const peak = Math.max(1, ...hours)
  return (
    <div className="flex h-[92px] items-end gap-[3px]">
      {hours.map((n, h) => {
        const night = h >= LATE_FROM_H || h < EARLY_BEFORE_H
        return (
          <div key={h} className="flex flex-1 flex-col items-center gap-1"
               title={`${clockLabel(h * 60)} · ${n} ${plural(n, 'shift')} began`}>
            <div
              className={cn('w-full rounded-[2px]', n ? (night ? 'bg-tint-amber' : 'bg-tint-lavender') : 'bg-border')}
              style={{ height: n ? Math.max(4, Math.round((n / peak) * 68)) : 2 }}
            />
            {h % 6 === 0 && <span className="text-[9px] text-text-3">{h}</span>}
          </div>
        )
      })}
    </div>
  )
}

function Chip({ label, value, tint = 'slate' }:
  { label: string; value: string | number; tint?: ExtendedTintName }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
      TINT_BG[tint], TINT_FG[tint])}>
      <span className="font-stat">{value}</span>
      <span className="font-normal opacity-80">{label}</span>
    </span>
  )
}

// ------------------------------------------------------------------ the page…

const KEPT = 'asa:psipunches:rows'
const PAGE_ROWS = 1000

const FALLBACK_CAVEAT =
  'A row is evidence that a punch was filed. A missing row is evidence of nothing — PsiAnywhere was habitually ' +
  'not filled in, and this record cannot show that somebody did not work.'

/** The relay's name for a row it read live (server/psi_punches_feed.py LIVE_SOURCE). */
const LIVE_SOURCE = 'psianywhere_live'

// WHERE THESE ROWS CAME FROM, named from the rows themselves: the stored copy alone, or the stored copy and the…
function sourceLabel(rows: PunchRow[]): string {
  const live = rows.filter((r) => r.source === LIVE_SOURCE).length
  return live
    ? `asa_psi_time_entries (the stored copy, to 2026-08-14) + ${live.toLocaleString()} ${live === 1 ? 'entry' : 'entries'} read live from PsiAnywhere`
    : 'asa_psi_time_entries (the stored copy — it stopped on 2026-08-14, port 8443)'
}

// One row per PsiAnywhere entry, whatever the paging did: the door sorts newest first, so a collection landing…
function uniqueEntries(rows: PunchRow[]): PunchRow[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    if (!r.single_entry_id) return true
    if (seen.has(r.single_entry_id)) return false
    seen.add(r.single_entry_id)
    return true
  })
}

const TABS = [
  { id: 'people', label: 'Who worked' },
  { id: 'days', label: 'The shape of the days' },
  { id: 'paperwork', label: 'What was never filled in' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function PsiPunchesPage() {
  const [rows, setRows] = useState<PunchRow[] | null>(() => readKept<PunchRow[]>(KEPT))
  const [prov, setProv] = useState<Provenance | null>(null)
  const [loading, setLoading] = useState(!readKept<PunchRow[]>(KEPT))
  const [progress, setProgress] = useState<{ got: number; of: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('people')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)

  const load = useCallback(async (loud: boolean) => {
    if (loud) setLoading(true)
    setError(null)
    setProgress(null)
    // a read still in flight at a sign-out or a crossing keeps nothing (lib/kept)
    const generation = keptGeneration()

    // THE FAST PATH: one flat file, zero executions.
    let got: PunchRow[] | null = null
    try { got = await readSlice<PunchRow>('psiPunches') } catch { got = null }
    // A FILE THAT ANSWERED WITH NO PUNCHES IS NOT A RECORD WITHOUT PUNCHES, and falling through to the door on…
    if (got !== null && got.length === 0) {
      console.warn('psiPunches answered with zero rows — the PsiAnywhere record cannot be empty, so the '
                   + 'fast path is broken and this mount is paying the paged door instead.')
      got = null
    }
    if (got?.length) {
      setRows(got)
      keepIfCurrent(KEPT, got, generation)
      // PROVENANCE ON THIS PATH IS COMPUTED FROM THE ROWS, like every other number here.
      const spoke = got.reduce((newest, r) => (
        r.source_synced_at && r.source_synced_at > newest ? r.source_synced_at : newest), '')
      setProv({
        caveat: FALLBACK_CAVEAT,
        source: sourceLabel(got),
        confirmed_at: spoke,
        held: got.length,
        via: 'slice',
      })
      setLoading(false)
      if (loud) toast({ type: 'success', title: 'The record was read again', body: `${got.length.toLocaleString()} punches.` })
      return
    }

    // THE DOOR, a thousand rows at a time.
    let all: PunchRow[] = []
    let first: ListAnswer | null = null
    try {
      for (let guard = 0; guard < 24; guard++) {
        const answer = await gasAction<ListAnswer>(
          'psiPunchesList', { limit: PAGE_ROWS, offset: all.length }, { timeoutMs: 120000 })
        if (!answer) break
        if (!first) first = answer
        const page = answer.rows ?? []
        all.push(...page)
        setProgress({ got: all.length, of: answer.total ?? all.length })
        if (!page.length || all.length >= (answer.total ?? all.length)) break
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : 'The punch record could not be read.'
      if (!all.length) {
        setError(why === 'timeout'
          ? 'The punch record did not answer in time. Nothing was lost — the relay keeps every entry it reads; try again.'
          : why)
        // the kept copy stays under the error, as it does when it was painted at mount — including when it was…
        const kept = readKept<PunchRow[]>(KEPT)
        if (kept?.length) setRows((r) => r ?? kept)
        setLoading(false)
        setProgress(null)
        return
      }
      // a partial read is still a true read of what arrived, and it says so
      setError(`Only ${all.length.toLocaleString()} of the record could be read this time. Everything below counts those rows and no others.`)
    }

    setProgress(null)
    setLoading(false)
    all = uniqueEntries(all)
    if (all.length) {
      setRows(all)
      keepIfCurrent(KEPT, all, generation)
      setProv({
        caveat: first?.caveat || FALLBACK_CAVEAT,
        source: first?.source || sourceLabel(all),
        confirmed_at: first?.confirmed_at || '',
        held: first && typeof first.held === 'number' ? first.held : null,
        via: 'door',
      })
      if (loud) toast({ type: 'success', title: 'The record was read again', body: `${all.length.toLocaleString()} punches.` })
    } else {
      // THE KEPT COPY IS RE-READ WHERE IT DECIDES, AND WHAT IS READ IS SHOWN.
      const kept = readKept<PunchRow[]>(KEPT)
      if (kept?.length) setRows((r) => r ?? kept)
      else {
        setError(first?.note
          || 'The punch house holds nothing yet. The relay carries the record across in passes — the stored copy and every entry read live since — and the whole of it lands within an afternoon of the house being minted.')
      }
    }
  }, [])

  useEffect(() => { void load(false) }, [load])

  const board = useMemo(() => (rows?.length ? build(rows) : null), [rows])

  // THE TRACKER SCOPES THE ROSTER.
  const focus = useContextStore((s) => s.focus)
  const scope = useMemo(() => {
    const everybody = board?.people ?? []
    if (!focus) return { people: everybody, matched: false }
    const hit = everybody.filter((p) => rowFocusTier(p, ['name', 'people_id'], focus) !== 0)
    return { people: hit.length ? hit : everybody, matched: hit.length > 0 }
  }, [board, focus])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return scope.people
    return scope.people.filter((p) =>
      p.name.toLowerCase().includes(needle)
      || p.people_id.includes(needle)
      || p.aliases.some((a) => a.toLowerCase().includes(needle))
      || p.codes.some((c) => c.toLowerCase().includes(needle)))
  }, [scope.people, q])

  const person = useMemo(
    () => board?.people.find((p) => p.key === picked) ?? null, [board, picked])

  const personShifts = useMemo(() => {
    if (!person || !rows?.length) return []
    return stitch(rows.filter((r) => whoOf(r) === person.key)).shifts
  }, [person, rows])

  if (person) {
    return (
      <PersonPanel
        person={person}
        shifts={personShifts}
        caveat={prov?.caveat || FALLBACK_CAVEAT}
        onBack={() => setPicked(null)}
      />
    )
  }

  const windowText = board && board.first !== null && board.last !== null
    ? `${dayLabel(board.first, { year: 'numeric' })} to ${dayLabel(board.last, { year: 'numeric' })}`
    : ''

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Punch Record"
          subtitle="The clock-in and clock-out record of PsiAnywhere, the agency's official time clock, as kept in ASA Data. The stored copy stopped on 2026-08-14 (its scraper dials port 8443); every entry the relay has read live since is added to it."
          actions={
            <>
              <PageSwitch />
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
              </button>
            </>
          }
        />
      </motion.div>

      <ContextBanner filtered={focus ? scope.matched : undefined} />

      {/* THE CAVEAT USED TO STAND HERE as a permanent amber banner above every
          number. It is gone from there — this app has a single reader — so
          the warning has moved to where it is actually needed rather than
          being repeated over a screen already read.
          It has NOT been deleted: `caveat` still rides on every answer from the
          door, the person panel still carries it, and the paperwork tab still
          says in its own words that a missing row is not a person who did not
          work. What is gone is the banner, not the truth. */}
      {/* THE HEADLINE, and only over a record that arrived. A hero drawn over a
          pending or failed read would print a zero in 60px type, which is the
          one thing this screen refuses to do. */}
      {!board ? (
        loading ? <Skeleton className="mb-5 h-[220px] w-full rounded-[16px]" /> : null
      ) : (
        <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Shifts on the record
              </p>
              <p className="font-stat text-[60px] leading-none text-white">{board.shifts.toLocaleString()}</p>
              <p className="mt-1 text-[12px] leading-[1.5] text-white/60">
                stitched back together from {board.rows.toLocaleString()} filed {plural(board.rows, 'row')}
                {' · '}{board.people.length} {plural(board.people.length, 'person', 'people')}
                {windowText ? ` · ${windowText}` : ''}
              </p>
              <p className="mt-2 text-[12px] leading-[1.5] text-white/50">
                {board.multiLeg.toLocaleString()} of them were filed as more than one row, because PsiAnywhere closed
                every overnight at 11:59:59 PM and opened a fresh one at midnight.
              </p>
              {board.unreadable > 0 && (
                <p className="mt-2 text-[12px] leading-[1.5] text-white/50">
                  {board.unreadable.toLocaleString()} {plural(board.unreadable, 'row')} carried a date or a clock this
                  page could not read. They are counted as rows and take no part in any shift.
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
                When those shifts happened
                {board.overnight * 3 >= board.shifts ? ' — this is a night workforce' : ''}
              </p>
              {/* The bands wear heroBand(), not their tint token: this bar sits
                  on --detail-hero, navy in BOTH themes, and the light theme's
                  tint foregrounds are dark ink for white paper. */}
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                {([
                  ['overnight', board.overnight, 'amber'],
                  ['late', board.late, 'peach'],
                  ['early', board.early, 'lavender'],
                  ['daytime', board.daytime, 'blue'],
                ] as [string, number, ExtendedTintName][]).map(([k, n, tint]) => (
                  n ? <span key={k} title={`${n} ${k}`}
                        style={{ width: `${(n / Math.max(1, board.shifts)) * 100}%`, background: heroBand(tint) }} />
                    : null
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-white/70">
                <HeroKey tint="amber" label="Crossed midnight" n={board.overnight} />
                <HeroKey tint="peach" label={`Ended ${LATE_FROM_H - 12}pm or later`} n={board.late} />
                <HeroKey tint="lavender" label={`Began before ${EARLY_BEFORE_H}am`} n={board.early} />
                <HeroKey tint="blue" label="Daytime" n={board.daytime} />
                {/* a shift with no clock-out gets an UNPAINTED dot, matching the
                    unpainted part of the track: it has no end to classify */}
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full border border-white/40" />
                  Never closed <span className="font-stat text-white">{board.open}</span>
                </span>
              </div>
              <p className="mt-3 text-[12.5px] leading-[1.55] text-white/70">
                <span className="font-stat text-white">
                  {Math.round((board.overnight / Math.max(1, board.shifts)) * 100)}%
                </span>{' '}
                of every shift in this record ran through midnight. The people in it worked nights, and that is the
                most useful thing the record says about this workforce.
              </p>
              <p className="mt-2 text-[12px] leading-[1.5] text-white/50">
                {fmtHours(board.hours)} hours in total — PsiAnywhere's own check_hours, summed. Never recomputed from the
                clocks: it is the official clock's own figure, and a parser that is subtly wrong would rewrite it silently.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* what the screen is reading, and how sure it can be */}
      {(prov || progress) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {prov && (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              TINT_BG.slate, TINT_FG.slate)}>
              <AppIcon name="clock" size={11} />
              {prov.source}
              {/* TWO DIFFERENT FACTS, NEVER ONE SENTENCE. Through the door the
                  stamp is when the relay last proved the HOUSE matches the
                  cortex; off the file there is no house, and the stamp is the
                  newest thing PsiAnywhere ever said about these rows. */}
              {prov.confirmed_at
                ? prov.via === 'slice'
                  ? ` · PsiAnywhere last spoke for these rows ${stampText(prov.confirmed_at)}`
                  : ` · last confirmed against the cortex ${stampText(prov.confirmed_at)}`
                : ''}
            </span>
          )}
          {prov && (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              TINT_BG.slate, TINT_FG.slate)}>
              read-only · {prov.via === 'slice' ? 'served from the snapshot' : 'read through the house'}
            </span>
          )}
          {progress && (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              TINT_BG.blue, TINT_FG.blue)}>
              <Loader2 size={11} className="animate-spin" />
              {progress.got.toLocaleString()} of {progress.of.toLocaleString()} rows read
            </span>
          )}
          {/* THE HOUSE'S OWN COUNT, BESIDE WHAT THIS SCREEN READ. They agree on
              a whole read; a difference means the screen is drawing part of the
              record and has to say which part rather than imply the whole. */}
          {board && typeof prov?.held === 'number' && prov.held !== board.rows && (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              TINT_BG.amber, TINT_FG.amber)}>
              the house holds {prov.held.toLocaleString()} rows · this screen read {board.rows.toLocaleString()}
            </span>
          )}
        </div>
      )}

      {error && (
        <Card padded={false} className="mb-4 p-4">
          <p className="flex items-start gap-2 text-[13px] leading-[1.5] text-text-2">
            <AlertTriangle size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} /> {error}
          </p>
        </Card>
      )}

      {loading && !board && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!loading && !board && !error && (
        <Card padded={false}>
          <EmptyState
            title="The punch house is empty"
            body="Nothing has landed yet. An empty declared tab and a broken one look the same from here — this one is simply waiting for the relay's first pass."
          />
        </Card>
      )}

      {board && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn('-mb-px border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors sm:px-4',
                  tab === t.id ? cn('border-current', TINT_FG.lavender)
                    : 'border-transparent text-text-3 hover:text-text-2')}
              >
                {t.label}
                {t.id === 'people' && (
                  <span className="ml-1.5 font-stat text-[11.5px] opacity-70">{scope.people.length}</span>
                )}
              </button>
            ))}
            {tab === 'people' && (
              <div className="ml-auto flex items-center gap-1.5 pb-2">
                <Search size={13} className="text-text-3" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find a person…"
                  className="h-8 w-[160px] rounded-sm border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary/50 sm:w-[220px]"
                />
              </div>
            )}
          </div>

          {tab === 'people' && (
            <PeopleView board={board} people={shown} onOpen={setPicked} />
          )}
          {tab === 'days' && <DaysView board={board} />}
          {tab === 'paperwork' && <PaperworkView board={board} />}
        </>
      )}
    </div>
  )
}

function HeroKey({ tint, label, n }: { tint: ExtendedTintName; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: heroBand(tint) }} />
      {label} <span className="font-stat text-white">{n.toLocaleString()}</span>
    </span>
  )
}

// ------------------------------------------------------------------ WHO WORKED WHEN…

function PeopleView({ board, people, onOpen }:
  { board: Board; people: Person[]; onOpen: (key: string) => void }) {
  const peak = Math.max(1, ...board.people.map((p) => p.hours))
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="The window of record"
          sub="One column a service day, from the first punch in the record to the last. Weekends wear amber." />
        <Rail rail={board.rail} />
        <p className="mt-3 text-[11.5px] leading-[1.5] text-text-3">
          A short column is a day few punches were FILED. It is not a day few people worked — PsiAnywhere was
          habitually not filled in, and a thin day says nothing about who was on.
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Chip label="people in the record" value={board.people.length} tint="blue" />
        <Chip label="name spellings PsiAnywhere filed" value={board.names} tint="slate" />
        <Chip label="hours, PsiAnywhere's own" value={fmtHours(board.hours)} tint="lavender" />
        <Chip label="shifts that crossed midnight" value={board.overnight.toLocaleString()} tint="amber" />
        {board.open > 0 && <Chip label="punches never closed" value={board.open} tint="pink" />}
      </div>

      {board.names > board.people.length && (
        <NotOnFile>
          PsiAnywhere filed {board.names} different spellings of a name across {board.people.length} people. Where one
          worker was typed two ways, both spellings are kept on their card — the identity here is PsiAnywhere's own
          people_id, never the spelling.
        </NotOnFile>
      )}

      {!people.length ? (
        <Card padded={false}>
          <EmptyState title="Nobody matches" body="No person in this record answers to that." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((p, i) => (
            <PersonCard key={p.key} p={p} index={i} peak={peak} onOpen={() => onOpen(p.key)} />
          ))}
        </div>
      )}

      <NotOnFile>
        Everybody the record could see is on this list. Anybody who is NOT on it is unknown, not idle — a person
        with no punch may have worked every day of this window and never been entered.
      </NotOnFile>
    </div>
  )
}

function PersonCard({ p, index, peak, onOpen }:
  { p: Person; index: number; peak: number; onOpen: () => void }) {
  const nightShare = p.shifts ? Math.round((p.nights / p.shifts) * 100) : 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO, delay: Math.min(index, 8) * 0.04 }}
    >
      <Card hover className="cursor-pointer">
        <div onClick={onOpen} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
          <div className="flex items-start gap-3">
            <DragPerson name={p.name} id={p.people_id || p.key} type="staff" subtitle="punch record">
              <Avatar name={p.name} size="md" />
            </DragPerson>
            <div className="min-w-0 flex-1">
              <DragPerson name={p.name} id={p.people_id || p.key} type="staff" subtitle="punch record"
                          className="block truncate text-[14px] font-semibold text-text-1"
                          title="Drag this name onto the tracker, top left">
                {p.name}
              </DragPerson>
              <p className="truncate text-[11.5px] text-text-3">
                {p.first !== null ? `${dayLabel(p.first)} – ${dayLabel(p.last)}` : 'no readable date'}
                {p.days ? ` · ${p.days} ${plural(p.days, 'day')} with a punch` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-stat text-[18px] leading-tight text-text-1">{fmtHours(p.hours)}</p>
              <p className="text-[10px] text-text-3">hours filed</p>
            </div>
          </div>

          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, (p.hours / peak) * 100)}%` }}
              transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
              className="h-full rounded-full"
              style={{ background: TINT_VAR[p.nights > p.shifts / 2 ? 'amber' : 'blue'] }}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-2">
            <span><span className="font-stat text-text-1">{p.shifts}</span> {plural(p.shifts, 'shift')}</span>
            <span className="text-text-3">from {p.rows} {plural(p.rows, 'row')}</span>
            {p.nights > 0 && (
              <span className={TINT_FG.amber}>
                <span className="font-stat">{p.nights}</span> through midnight
                {nightShare >= 50 ? ` · ${nightShare}%` : ''}
              </span>
            )}
            {p.open > 0 && (
              <span className={TINT_FG.pink}><span className="font-stat">{p.open}</span> never closed</span>
            )}
          </div>

          {p.aliases.length > 0 && (
            <p className="mt-2 text-[11px] text-text-3">also filed as {p.aliases.join(', ')}</p>
          )}

          {/* the paperwork, per person — and it is about the SYSTEM, which is
              why the sentence says so rather than naming a habit */}
          <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5 text-[11px] leading-[1.45] text-text-3">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-text-3" />
            {p.documented === 0 && p.signed === 0
              ? 'Not one of these rows is marked documented or signed — the stored copy has both fields false or blank throughout, and a row read live does not carry them.'
              : `${p.documented} documented · ${p.signed} signed.`}
          </p>
        </div>
      </Card>
    </motion.div>
  )
}

// ------------------------------------------------------------------ ONE PERSON — their shifts, put back together…

function PersonPanel({ person, shifts, caveat, onBack }:
  { person: Person; shifts: Shift[]; caveat: string; onBack: () => void }) {
  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title={person.name}
          subtitle={`What PsiAnywhere recorded for this person — ${person.shifts} ${plural(person.shifts, 'shift')} filed as ${person.rows} ${plural(person.rows, 'row')}, from the stored copy and the entries the relay has read live since.`}
          actions={
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
            >
              <ArrowLeft size={14} /> Everybody
            </button>
          }
        />
      </motion.div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Hours filed" value={fmtHours(person.hours)} sub="PsiAnywhere's own check_hours" />
        <Tile label="Shifts" value={person.shifts} sub={`stitched from ${person.rows} rows`} />
        <Tile label="Through midnight" value={person.nights}
              tint={person.nights ? 'amber' : undefined} sub="crossed into the next day" />
        <Tile label="Days with a punch" value={person.days}
              sub={person.first !== null ? `${dayLabel(person.first)} – ${dayLabel(person.last)}` : 'no readable date'} />
      </div>

      <div className={cn('mb-4 flex items-start gap-2.5 rounded-[12px] border border-dashed border-border px-3.5 py-2.5',
        TINT_BG.amber)}>
        <AlertTriangle size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
        <p className={cn('text-[12.5px] leading-[1.55]', TINT_FG.amber)}>{caveat}</p>
      </div>

      <Card>
        <CardHeader
          title="Every shift, newest first"
          sub="Rows PsiAnywhere cut at midnight are shown as the one shift they were. A row's own hours are its check_hours, never a duration this page worked out." />
        {!shifts.length ? (
          <NotOnFile>No readable shift for this person. That is a gap in the paperwork, not a person who did not work.</NotOnFile>
        ) : (
          <ul className="divide-y divide-border">
            {shifts.map((s) => (
              <li key={`${s.who}-${s.start}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className="w-[86px] shrink-0 text-[12.5px] font-semibold text-text-1">
                  {dayLabel(Math.floor(s.start / MIN_PER_DAY), { weekday: 'short' })}
                </span>
                <span className="text-[12.5px] text-text-2">
                  {clockLabel(s.start)}
                  {' – '}
                  {s.end === null
                    ? <span className={TINT_FG.pink}>never clocked out</span>
                    : clockLabel(s.end)}
                  {s.crosses && <span className={cn('ml-1.5 text-[11px]', TINT_FG.amber)}>next day</span>}
                </span>
                <span className="font-stat text-[12.5px] text-text-1">{fmtHours(s.hours)}h</span>
                {s.legs.length > 1 && (
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold', TINT_BG.lavender, TINT_FG.lavender)}>
                    stitched from {s.legs.length} rows
                  </span>
                )}
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  {[...new Set(s.legs.map((l) => (l.work_code || '').trim()).filter(Boolean))].map((c) => (
                    <span key={c} className={cn('rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold', TINT_BG.slate, TINT_FG.slate)}>
                      {c}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* THE FINDING, ATTACHED TO THE PERSON — and framed as what it is. A
            per-row "not documented" chip repeated down the whole list would
            read as an accusation against this person rather than as a column
            PsiAnywhere stopped writing for everybody. */}
        <p className="mt-3 border-t border-border pt-3 text-[11.5px] leading-[1.5] text-text-3">
          {person.documented === 0 && person.signed === 0
            ? 'Not one of these rows is marked documented or signed. Those two fields were not being written for anybody in this record — nothing here says this person failed to document their visits.'
            : `${person.documented} of ${person.rows} rows are marked documented, ${person.signed} signed. The rest are false or blank, and blank means nothing was written to the field.`}
        </p>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ THE SHAPE OF THE DAYS — and the trap in it…

function DaysView({ board }: { board: Board }) {
  const nightShare = Math.round((board.overnight / Math.max(1, board.shifts)) * 100)
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        {/* THE TRAP, DRAWN. Two numbers of the same fact, one wrong — and the
            page shows both and says which is which, because this is the single
            easiest way to misread the record. */}
        <Card>
          <CardHeader
            title="The midnight cut, and what it does to a count"
            sub="PsiAnywhere closed every overnight at 11:59:59 PM and opened a new row at midnight. The same night therefore appears twice, on two dates." />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[14px] border border-dashed border-border px-3.5 py-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">Counting rows — wrong</p>
              <p className={cn('mt-1 font-stat text-[26px] leading-tight', TINT_FG.pink)}>{board.rows.toLocaleString()}</p>
              <p className="mt-1 text-[11.5px] leading-[1.45] text-text-3">
                filed rows. Read as shifts, this inflates the workforce's count by
                {' '}{Math.round((board.absorbed / Math.max(1, board.shifts)) * 100)}%, shortens every night into two
                halves, and puts a one-second turnaround between them.
              </p>
            </div>
            <div className="rounded-[14px] border border-border bg-surface-2 px-3.5 py-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">Counting shifts — stitched</p>
              <p className={cn('mt-1 font-stat text-[26px] leading-tight', TINT_FG.mint)}>{board.shifts.toLocaleString()}</p>
              <p className="mt-1 text-[11.5px] leading-[1.45] text-text-3">
                real shifts. {board.absorbed.toLocaleString()} rows were absorbed into the shift in front of them;
                {' '}{board.multiLeg.toLocaleString()} shifts were filed as more than one row.
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11.5px] leading-[1.5] text-text-3">
            The rule: two punches from the same person join when the second begins within {STITCH_GAP_MIN} minutes of
            the furthest point the first reached. The cut itself leaves a gap of one second. A punch that was never
            closed ends the chain — an unknown end is not a time anything can be compared against.
          </p>
        </Card>

        <Card>
          <CardHeader
            title="The same question, asked of rows and of shifts"
            sub="Both numbers are true about what they count. Only one of them is about a working day." />
          <div className="space-y-3">
            <Pair
              question={`Began before ${EARLY_BEFORE_H}am`}
              rowsN={board.rowEarly} shiftsN={board.shiftEarly}
              note="Almost all of the row number is the SECOND half of a night — the row PsiAnywhere opened at midnight, not somebody who came in before dawn. Stitched, the pre-dawn start is a rare thing here." />
            <Pair
              question={`Clocked out at ${LATE_FROM_H - 12}pm or later`}
              rowsN={board.rowLate} shiftsN={board.shiftEndLate}
              note={`Most of the row number is the FIRST half of a night, cut at 11:59:59 PM. Stitched, a night that began in the evening clocks out in the morning and is counted once, in the morning — which is why ${board.overnight.toLocaleString()} shifts are better described as running THROUGH the evening than as ending in it.`} />
          </div>
        </Card>

        <Card>
          <CardHeader title="How long a shift ran"
            sub={`Clock-out minus clock-in, over the ${board.spanKnown.toLocaleString()} shifts that have both.`} />
          <Bars items={board.spans.filter((s) => s.n > 0)} tint="lavender" />
          {board.open > 0 && (
            <div className="mt-3">
              <NotOnFile>
                {board.open} {plural(board.open, 'shift')} {plural(board.open, 'is', 'are')} missing from this chart
                entirely: nobody clocked out of {plural(board.open, 'it', 'them')}. Their length is unknown, not zero.
              </NotOnFile>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="When a shift begins"
            sub={`Stitched starts, by hour. Amber is ${LATE_FROM_H - 12}pm to ${EARLY_BEFORE_H}am.`} />
          <StartClock hours={board.startHour} />
          <div className="mt-4 space-y-2 border-t border-border pt-3 text-[12.5px] text-text-2">
            <p className="flex items-center justify-between gap-2">
              <span>Ran through midnight</span>
              <span className="font-stat text-text-1">
                {board.overnight.toLocaleString()}{' '}
                <span className="text-[11px] text-text-3">({nightShare}%)</span>
              </span>
            </p>
            <p className="flex items-center justify-between gap-2">
              <span>Stayed inside one day</span>
              <span className="font-stat text-text-1">
                {(board.shifts - board.overnight - board.open).toLocaleString()}
              </span>
            </p>
            <p className="flex items-center justify-between gap-2">
              <span>End never recorded</span>
              <span className={cn('font-stat', board.open ? TINT_FG.pink : 'text-text-1')}>{board.open}</span>
            </p>
          </div>
          <p className="mt-3 text-[11.5px] leading-[1.5] text-text-3">
            {nightShare}% of every shift in this record crossed midnight — which is both the most useful thing it
            says about this workforce and the exact reason a row-level reading of it is so badly wrong.
          </p>
        </Card>

        <Card>
          <CardHeader title="What the work was called"
            sub="PsiAnywhere's own work codes, counted over rows." />
          <Bars items={board.work} tint="blue" />
        </Card>
      </div>
    </div>
  )
}

function Pair({ question, rowsN, shiftsN, note }:
  { question: string; rowsN: number; shiftsN: number; note: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-surface-2 px-3.5 py-3">
      <p className="text-[12.5px] font-semibold text-text-1">{question}</p>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-[12px] text-text-2">
          <span className={cn('font-stat text-[17px]', TINT_FG.pink)}>{rowsN.toLocaleString()}</span> rows
        </span>
        <span className="text-[12px] text-text-2">
          <span className={cn('font-stat text-[17px]', TINT_FG.mint)}>{shiftsN.toLocaleString()}</span> shifts
        </span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-[1.45] text-text-3">{note}</p>
    </div>
  )
}

// ------------------------------------------------------------------ WHAT WAS NEVER FILLED IN…

// THE TWO FINDINGS, AND THE SENTENCE THAT HAS TO GO WITH THEM.
function PaperworkView({ board }: { board: Board }) {
  const flagRow = (f: { yes: number; no: number; blank: number; live: number }): Tally[] => ([
    { label: 'marked true', n: f.yes },
    { label: 'marked false', n: f.no },
    { label: 'left blank', n: f.blank },
    ...(f.live ? [{ label: 'not carried by the live read', n: f.live }] : []),
  ])
  // THE SHARE IS OF THE ROWS THAT COULD CARRY A CODE: a row read live never does.
  const evvBase = Math.max(1, board.rows - board.evvLive)
  const evvShare = Math.round((board.evvRows / evvBase) * 100)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Two fields the system stopped filling in"
          sub="Counted over every row in the record." />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[12.5px] font-semibold text-text-1">Was it documented?</p>
            <Bars items={flagRow(board.documented)} tint="peach" />
          </div>
          <div>
            <p className="mb-2 text-[12.5px] font-semibold text-text-1">Was it signed?</p>
            <Bars items={flagRow(board.signed)} tint="peach" />
          </div>
        </div>
        <div className="mt-4 rounded-[12px] border border-dashed border-border px-3.5 py-3">
          <p className="text-[12.5px] leading-[1.6] text-text-2">
            {board.documented.yes === 0 && board.signed.yes === 0 ? (
              <>
                <span className="font-semibold text-text-1">Not one row in the whole record is marked documented,
                and not one is marked signed.</span>{' '}
                A field that is false or blank on every row of the stored copy is a field nothing was writing to there
                {board.documented.live ? <>, and the {board.documented.live.toLocaleString()} rows the relay read live
                do not carry the two columns at all (counted apart)</> : null}. It does NOT say that care went
                undocumented, and nothing here may be used to claim that it did.
              </>
            ) : (
              <>
                {board.documented.yes.toLocaleString()} rows are marked documented and{' '}
                {board.signed.yes.toLocaleString()} signed. The rest are false or blank — and blank is not false:
                it is a field nothing wrote to.
              </>
            )}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="The EVV exception code"
          sub={`Carried on ${board.evvRows.toLocaleString()} of ${(board.rows - board.evvLive).toLocaleString()} rows — ${evvShare}%${board.evvLive ? ` (${board.evvLive.toLocaleString()} rows read live carry no code field and are not counted)` : ''}.`} />
        <Bars items={board.evv} tint="amber" />
        <p className="mt-3 text-[11.5px] leading-[1.5] text-text-3">
          {board.evv.length === 1
            ? `One code, and it stands on ${evvShare}% of the record. A single exception reason repeated that often is a default the system wrote, not ${board.evvRows.toLocaleString()} separate judgements somebody made.`
            : 'Codes as PsiAnywhere filed them. A code repeated across the whole record is a default, not a judgement.'}
          {' '}The rows without one are blank, and blank means nothing was written — not that the visit was clean.
        </p>
      </Card>

      <Card>
        <CardHeader title="Who filed the punch"
          sub="The submitting login, which is not always the person who worked." />
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Submitting logins" value={board.submitters} />
          <Tile label="People worked for" value={board.people.length} />
        </div>
        <p className="mt-3 text-[11.5px] leading-[1.5] text-text-3">
          {board.submitters < board.people.length
            ? `${board.submitters} logins filed for ${board.people.length} workers, so many entries were typed by somebody who was not there. That is how this record was kept, and it is another reason a gap in it proves nothing.`
            : 'Each punch carries the login that filed it. Where that is not the worker, the row is somebody typing on their behalf.'}
        </p>
      </Card>

      <Card>
        <CardHeader title="Status, as PsiAnywhere left it"
            sub="PsiAnywhere's own status letter, counted over rows." />
        <Bars items={board.status} tint="violet" />
        <p className="mt-3 text-[11.5px] leading-[1.5] text-text-3">
          These are the letters PsiAnywhere itself writes. They are kept verbatim and are not translated here: nothing
          here documents what its codes mean, and guessing at them would be inventing evidence.
        </p>
      </Card>

      <Card>
        <CardHeader title="Punches nobody closed"
          sub="A clock-in with no clock-out." />
        {board.open === 0 ? (
          <NotOnFile>Every punch in the record was closed.</NotOnFile>
        ) : (
          <>
            <p className={cn('font-stat text-[34px] leading-none', TINT_FG.pink)}>{board.open}</p>
            <p className="mt-2 text-[12px] leading-[1.55] text-text-2">
              {plural(board.open, 'shift')} whose end was never recorded. The blank stays a blank everywhere on this
              screen — a house that filled it in would be inventing the end of somebody's shift — and they are left
              out of every length and turnaround number rather than counted as short.
            </p>
          </>
        )}
      </Card>
    </div>
  )
}
