/** The one calendar screen's own decisions, pure; every figure is the relay's, and one it did not answer is "—". */
import type { TintName } from '@/engine/types'
import type { CalendarRange, CalendarView } from '@/stores/useUiPrefsStore'
import { LaneError } from '@/pages/features/shifts/laneFetch'
import type { DrawnDays } from '@/pages/features/shifts/HouseGrid'
import { countdown, type HandoffView } from '@/pages/features/shifts/requestsLogic'
import { workbookStripe } from '@/pages/features/shifts/shiftUi'
import { TIME_OFF_LOOK, isAway, type TimeOffMarks } from '@/pages/features/shifts/timeOffMarks'
import { ohioTime } from '@/lib/ohio'
import {
  builderLink, cellKey, hhmm, houseCalLink, houseCode, houseShort, resolveHouse, sameName, weekKeyOf,
  type CellFact, type Computed, type Conflict, type Grid, type House, type OpenShift,
} from '@/pages/features/shifts/houseCalTypes'

/* ── the view is carried by the page id ─────────────────────────────────── */

/** Live is the House Calendars page, the Builder the Builder page: every link already sent keeps working. */
export const VIEW_PAGE: Record<CalendarView, string> = { live: 'house-cal', build: 'builder' }

export function viewOfPage(pageId: string): CalendarView | null {
  if (pageId === VIEW_PAGE.live) return 'live'
  if (pageId === VIEW_PAGE.build) return 'build'
  return null
}

export type CarriedCell = { employee: string; colIso: string; ref?: string }

/** What the view switch carries to the other view. */
export type ViewCarry = { house?: string; range?: CalendarRange; week?: string; cell?: CarriedCell | null }

/** `house=all` in the Builder is the master grid: every house at once, its own draft. */
export const MASTER_HOUSE = 'all'

// Where the view switch goes: the other view's page, with the house, range, week and the open cell.
export function viewPath(view: CalendarView, at: ViewCarry = {}): string {
  const cell = at.cell
  const base = view === 'live'
    ? houseCalLink(at.house ?? '', cell ? (cell.ref ? { ref: cell.ref }
      : cell.employee && cell.colIso ? { open: `${cell.employee}|${cell.colIso}` }
      : cell.colIso ? { day: cell.colIso } : {}) : {})
    : builderLink(at.house ?? '', cell ? { day: cell.colIso, employee: cell.employee } : {})
  const kept = [at.range ? `range=${encodeURIComponent(at.range)}` : '',
                at.week ? `week=${encodeURIComponent(at.week)}` : ''].filter(Boolean)
  if (!kept.length) return base
  return `${base}${base.includes('?') ? '&' : '?'}${kept.join('&')}`
}

/** The address's kept and one-shot parameters, changed together; `null` or '' removes one. */
export function withParams(prev: URLSearchParams, set: Record<string, string | null>): URLSearchParams {
  const next = new URLSearchParams(prev)
  for (const [k, v] of Object.entries(set)) {
    if (v === null || v === '') next.delete(k)
    else next.set(k, v)
  }
  return next
}

/** A Builder address for a reader who does not build that house: the same house, and cell or day, on Live. */
export function liveForBuilderLink(search: string): string {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const house = q.get('house') ?? ''
  const day = q.get('day') ?? ''
  const employee = q.get('employee') ?? ''
  return viewPath('live', {
    house: house === MASTER_HOUSE ? '' : house,
    cell: day ? { employee, colIso: day } : null,
  })
}

/** The day a link lands on: its shift's own, else the link's `day` when this tab draws it, else none. */
export function linkedDay(shiftDay: string, linkDay: string, isos: readonly string[]): string {
  if (shiftDay) return shiftDay
  return linkDay && isos.includes(linkDay) ? linkDay : ''
}

// Old addresses, followed before the page lookup with their query kept: the old House Calendar board is Live's…
export function movedAddress(pageId: string, search: string, opensLive: boolean): string | null {
  if (pageId !== 'calendar') return null
  if (!opensLive) return '/app/calendarbuilder/cards'
  const kept = (search.startsWith('?') ? search.slice(1) : search).split('&').filter(Boolean)
  if (!kept.some((p) => p.startsWith('range='))) kept.push('range=week')
  return `/app/calendarbuilder/${VIEW_PAGE.live}?${kept.join('&')}`
}

/** The Builder half of the switch, for a reader who builds a house here; drafts the relay could not count are said. */
export function builderSwitch(a: {
  builderOpen: boolean; houses: House[] | null; current: string; draftsReadable?: boolean
}): { shown: boolean; enabled: boolean; why: string; drafts: number | null; draftsUnread: boolean } {
  const shown = a.builderOpen && (a.houses ?? []).some((h) => h.may_edit)
  const here = (a.houses ?? []).find((h) => h.location === a.current)
  const enabled = shown && Boolean(here?.may_edit)
  return {
    shown, enabled,
    why: enabled ? '' : 'Not a house you build: you can operate it, not build it',
    drafts: enabled && typeof here?.drafts === 'number' ? here.drafts : null,
    draftsUnread: enabled && a.draftsReadable === false,
  }
}

/* ── the range ──────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000

function isoPlus(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = Date.UTC(y, (m || 1) - 1, d || 1) + days * DAY_MS
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : iso
}

export function isRange(v: string | null | undefined): v is CalendarRange {
  return v === 'week' || v === 'tab'
}

/** The Saturdays a tab spans, first to last. */
export function tabWeeks(window: { first: string; last: string } | null | undefined): string[] {
  if (!window?.first || !window.last) return []
  const out: string[] = []
  for (let w = weekKeyOf(window.first); w <= window.last && out.length < 60; w = isoPlus(w, 7)) out.push(w)
  return out
}

/** Ohio's week, when the tab draws today. */
export function thisWeek(window: { covers_today: boolean; today?: string } | null | undefined): string | null {
  return window?.covers_today && window.today ? weekKeyOf(window.today) : null
}

/** A wanted week kept inside the tab; else this week; else the tab's first. */
export function clampWeek(want: string, weeks: string[], today: string | null): string {
  const w = want ? weekKeyOf(want) : ''
  if (w && weeks.includes(w)) return w
  if (today && weeks.includes(today)) return today
  return weeks[0] ?? ''
}

/** The days a range draws, inside the tab. */
export function drawnDays(range: CalendarRange, week: string,
                          window: { first: string; last: string } | null | undefined): DrawnDays | undefined {
  if (!window?.first || !window.last) return undefined
  if (range === 'tab' || !week) return { from: window.first, to: window.last, range: 'tab' }
  return { from: week, to: isoPlus(week, 6), range: 'week' }
}

// The Builder folds the days before today into a stub: the days left drawn, and how many were folded.
export function foldPast(days: DrawnDays | undefined, today: string, open: boolean): {
  days: DrawnDays | undefined; folded: number
} {
  if (!days || open || !today || today <= days.from || today > days.to) return { days, folded: 0 }
  const [y1, m1, d1] = days.from.split('-').map(Number)
  const [y2, m2, d2] = today.split('-').map(Number)
  const folded = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS)
  return folded > 0 ? { days: { ...days, from: today }, folded } : { days, folded: 0 }
}

/** The seven days of one Saturday-start week. */
export function weekDays(week: string): string[] {
  return week ? Array.from({ length: 7 }, (_, i) => isoPlus(week, i)) : []
}

/** 'Sep 20 – Sep 26' */
export function rangeLabel(days: { from: string; to: string } | null | undefined): string {
  if (!days) return ''
  const one = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    const t = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12))
    return Number.isNaN(t.getTime()) ? iso
      : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  return `${one(days.from)} – ${one(days.to)}`
}

/* ── the rail ───────────────────────────────────────────────────────────── */

const RAIL_TINTS: TintName[] = ['blue', 'mint', 'lavender', 'peach', 'pink', 'amber']

/** A house's dot colour, the same on every visit: picked by its code. */
export function houseTint(location: string): TintName {
  let n = 0
  for (const ch of houseCode(location)) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return RAIL_TINTS[n % RAIL_TINTS.length]
}

/** Unclaimed open shifts that have not begun, per house. */
export function openCountByHouse(shifts: OpenShift[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of shifts ?? []) {
    if (s.claimed_by || s.started) continue
    m.set(s.location, (m.get(s.location) ?? 0) + 1)
  }
  return m
}

export type RailSection = { title: string; mine: boolean; houses: House[] }

/** Your houses, then the others; a reader who builds none sees one list. Each A–Z by the name people say. */
export function railSections(houses: House[] | null | undefined, filter = ''): RailSection[] {
  const q = filter.trim().toLowerCase()
  const byName = (a: House, b: House) => houseShort(a.location).localeCompare(houseShort(b.location))
    || a.location.localeCompare(b.location)
  const list = [...(houses ?? [])]
    .filter((h) => !q || h.location.toLowerCase().includes(q) || houseShort(h.location).toLowerCase().includes(q))
    .sort(byName)
  const all = houses ?? []
  if (!all.some((h) => h.may_edit)) return [{ title: 'Houses', mine: false, houses: list }]
  return [
    { title: 'Your houses', mine: true, houses: list.filter((h) => h.may_edit) },
    { title: 'Other houses', mine: false, houses: list.filter((h) => !h.may_edit) },
  ].filter((s) => s.houses.length > 0)
}

/** The Builder's rail: only the houses this reader builds (the Builder's own door), A–Z, under "Your houses". */
export function builderRailSections(houses: House[] | null | undefined, filter = ''): RailSection[] {
  if (!houses) return []
  return railSections(houses.map((h) => ({ ...h, may_edit: true })), filter)
}

/** The house the screen opens on: the link's, else the last one opened, else the reader's first, else A–Z. */
export function defaultHouse(houses: House[] | null | undefined, remembered: string): string {
  const list = houses ?? []
  const again = remembered ? resolveHouse(list, remembered) : ''
  if (again) return again
  const sections = railSections(list)
  return sections[0]?.houses[0]?.location ?? ''
}

/** The house to open when the address names none; with the rail down, the one last opened, so an outage still falls back. */
export function houseToOpen(houses: House[] | null | undefined, railFailed: boolean, remembered: string): string {
  if (houses) return defaultHouse(houses, remembered)
  return railFailed ? remembered : ''
}

/* ── when a read falls back to the last roster ──────────────────────────── */

/** A 5xx or no answer at all falls back to the slices; a refusal (403) or "no such house" (404) is said instead. */
export function isOutage(err: unknown): boolean {
  if (!(err instanceof LaneError)) return true
  return err.status === 0 || err.status >= 500
}

/** A caller's absence mark, which only those the relay tells who called off may see (shift_requests.ABSENCE_MARKS). */
const ABSENCE_MARKS = new Set(['C/O', 'NCNS'])

/** The relay's privacy cut, kept on the fallback: a reader not told callers gets no C/O or NCNS cell. */
export function withoutAbsences<T extends { code?: string | null }>(cells: T[], seesCallers: boolean): T[] {
  return seesCallers ? cells : cells.filter((c) => !ABSENCE_MARKS.has(String(c.code ?? '').trim().toUpperCase()))
}

/** The grey note over the fallback; the stamp is when the slices were built, when known. */
export function lastRosterNote(why: string, stamp: string, stale: boolean): string {
  return `The live calendar did not answer (${why || 'no answer'}). This is the last roster the platform built `
    + `(${stamp || 'when, is not known here'}): open shifts, call-offs, hours and transfers are not on it. `
    + `Nothing can be given or applied for from it.${stale ? ' Serving the last roster we hold.' : ''}`
}

/* ── the band's tiles ───────────────────────────────────────────────────── */

export type Tile = {
  id: string
  label: string
  /** '—' when the server did not answer */
  value: string
  sub: string
  /** the "across your houses" line, when the reader has more than one */
  sub2?: string
  tone?: 'bad' | 'warn'
  title?: string
}

const DASH = '—'

/** Unclaimed, not begun, soonest window first. */
export function openNow(shifts: OpenShift[] | null | undefined): OpenShift[] {
  return (shifts ?? []).filter((s) => !s.claimed_by && !s.started).sort(soonest)
}

/** Window closed (or the manager's alone), somebody applied, nobody given: the house manager's decision. */
export function decisionsWaiting(shifts: OpenShift[] | null | undefined): OpenShift[] {
  return openNow(shifts).filter((s) => (s.pool_state === 'closed' || s.pool_state === 'manager_only')
    && (s.applicants ?? 0) >= 1)
}

/** Called-off shifts nobody has been given. */
export function callOffsWaiting(shifts: OpenShift[] | null | undefined): OpenShift[] {
  return openNow(shifts).filter((s) => s.kind_of_open === 'call_off')
}

function soonest(a: OpenShift, b: OpenShift): number {
  const ka = a.window?.closes_at || '~'
  const kb = b.window?.closes_at || '~'
  return ka.localeCompare(kb) || a.col_iso.localeCompare(b.col_iso)
    || String(a.starts_at ?? '').localeCompare(String(b.starts_at ?? '')) || a.location.localeCompare(b.location)
}

/** 'Thu 9/25 · 3P-11P' */
function shiftWords(s: OpenShift, dayLabel: (iso: string) => string): string {
  return `${dayLabel(s.col_iso)} · ${s.code || s.raw}`
}

function windowLeft(s: OpenShift | undefined, nowMs: number): string {
  if (!s?.window?.closes_at || s.pool_state !== 'open') return ''
  const left = countdown(s.window.closes_at, nowMs)
  return left.seconds > 0 ? left.label : ''
}

export type Across = { open: OpenShift[]; decisions: OpenShift[]; calloffs: OpenShift[] }

/** The same three lists over every house this reader edits, from /housecal/open. */
export function acrossHouses(shifts: OpenShift[] | null | undefined, houses: House[] | null | undefined): Across | null {
  const mine = new Set((houses ?? []).filter((h) => h.may_edit).map((h) => h.location))
  if (mine.size < 2 || !shifts) return null
  const here = shifts.filter((s) => mine.has(s.location))
  return { open: openNow(here), decisions: decisionsWaiting(here), calloffs: callOffsWaiting(here) }
}

const across = (n: number | undefined) => (n === undefined ? undefined : `${n} across your houses`)

/** Transfers on this reader: `undefined` not read yet, `null` unreadable, else the count. */
export type TransfersCount = number | null | undefined

function transfersTile(transfers: TransfersCount): Tile {
  return {
    id: 'transfers', label: 'Transfers on you', value: typeof transfers === 'number' ? String(transfers) : DASH,
    sub: transfers === undefined ? 'not read yet' : transfers === null ? 'could not be read'
      : transfers ? 'waiting on your answer' : 'none waiting',
  }
}

/** The cell a conflict points at: its own, or, for a week over the line, the person's first shift that week. */
export function conflictCell(c: Conflict, computed: Computed | null | undefined): { employee: string; colIso: string } {
  if (c.col_iso) return { employee: c.employee, colIso: c.col_iso }
  const week = c.key.slice(c.key.lastIndexOf('|') + 1)
  const first = Object.values(computed?.cells ?? {})
    .filter((f) => f.employee === c.employee && weekKeyOf(f.col_iso) === week && f.hours > 0)
    .sort((x, y) => x.col_iso.localeCompare(y.col_iso))[0]
  return { employee: c.employee, colIso: first?.col_iso ?? week }
}

/** The "To look at" tile: every conflict, a week over the line included, so it never reads 0 over one. */
function lookTile(computed: Computed | null | undefined, clean: string): Tile {
  const looks = computed?.conflicts ?? []
  return { id: 'look', label: 'To look at', value: computed ? String(looks.length) : DASH,
           tone: looks.length ? 'bad' : undefined, sub: looks[0]?.why ?? (computed ? clean : 'not read yet') }
}

/** The Live band for a reader who edits this house. */
export function liveEditorTiles(a: {
  computed: Computed | null
  nowMs: number
  transfers: TransfersCount
  across: Across | null
  dayLabel: (iso: string) => string
}): Tile[] {
  const c = a.computed
  const open = openNow(c?.open_shifts)
  const decide = decisionsWaiting(c?.open_shifts)
  const offs = callOffsWaiting(c?.open_shifts)
  const next = open.find((s) => s.pool_state === 'open' && s.window?.closes_at)
  const nextLeft = windowLeft(next, a.nowMs)
  const nextOff = offs.find((s) => s.pool_state === 'open' && s.window?.closes_at)
  const offLeft = windowLeft(nextOff, a.nowMs)
  const running = (c?.running ?? []).map((k) => c?.cells[k]).filter(Boolean)
  const firstRun = running[0]
  return [
    { id: 'open', label: 'Open shifts', value: c ? String(open.length) : DASH, tone: open.length ? 'bad' : undefined,
      sub: !c ? 'not read yet' : next ? `next closes ${ohioTime(next.window?.closes_at ?? '')}${nextLeft ? ` · ${nextLeft}` : ''}`
        : open.length ? 'closed · the house manager decides' : 'none from now',
      sub2: across(a.across?.open.length) },
    { id: 'decisions', label: 'Decisions on you', value: c ? String(decide.length) : DASH,
      tone: decide.length ? 'bad' : undefined,
      sub: decide[0] ? `${shiftWords(decide[0], a.dayLabel)} · ${decide[0].applicants ?? 0} applied`
        : c ? 'nothing waiting on you' : 'not read yet',
      sub2: across(a.across?.decisions.length) },
    { id: 'calloffs', label: 'Call-offs waiting', value: c ? String(offs.length) : DASH,
      tone: offs.length ? 'bad' : undefined,
      sub: offs[0] ? (offLeft ? `5 h window · ${offLeft} left` : `${shiftWords(offs[0], a.dayLabel)} · the house manager decides`)
        : c ? 'none waiting' : 'not read yet',
      sub2: across(a.across?.calloffs.length) },
    { id: 'onshift', label: 'On shift now', value: c ? String(running.length) : DASH,
      title: running.map((f) => f!.employee).join(', ') || undefined,
      sub: firstRun ? `${firstRun.employee}${firstRun.end != null ? ` until ${hhmm(firstRun.end)}` : ''}`
        : c ? 'nobody right now' : 'not read yet' },
    transfersTile(a.transfers),
    lookTile(c, 'no conflicts'),
  ]
}

/** The Live band for a reader who does not edit this house. */
export function liveStaffTiles(a: {
  computed: Computed | null
  me: string
  transfers: TransfersCount
  dayLabel: (iso: string) => string
}): Tile[] {
  const c = a.computed
  const open = openNow(c?.open_shifts)
  const mayApply = open.filter((s) => s.mine?.may && s.mine.code !== 'applied')
  const applied = (c?.open_shifts ?? []).filter((s) => s.mine?.code === 'applied')
  const week = c?.window.today ? weekKeyOf(c.window.today) : ''
  const person = c?.people.find((p) => sameName(p.employee, a.me))
  const hours = person?.by_week?.[week] ?? 0
  const line = c?.weekly_ot_hours ?? 40
  return [
    { id: 'mine-open', label: 'Open to you now', value: c ? String(mayApply.length) : DASH,
      tone: mayApply.length ? 'bad' : undefined,
      sub: mayApply[0] ? shiftWords(mayApply[0], a.dayLabel) : c ? 'nothing you may apply for here' : 'not read yet' },
    { id: 'mine-applied', label: 'Your applications', value: c ? String(applied.length) : DASH,
      sub: applied[0] ? shiftWords(applied[0], a.dayLabel) : c ? 'none here' : 'not read yet' },
    { id: 'mine-hours', label: 'Your hours this week here', value: c && week ? `${hours}h` : DASH,
      tone: hours > line ? 'bad' : undefined,
      sub: !c ? 'not read yet' : person ? `the line is ${line}h` : 'not on this house\'s roster' },
    transfersTile(a.transfers),
  ]
}

/** The Builder band for one house, the draft laid on. */
export function builderTiles(grid: Grid | null, days: { from: string; to: string } | null | undefined): Tile[] {
  const drafts = grid?.drafts ?? []
  const count = grid ? (grid.draft_count ?? drafts.length) : null
  const outside = days ? drafts.filter((d) => d.col_iso < days.from || d.col_iso > days.to).length : 0
  const trainings = drafts.filter((d) => d.ist)
  const line = grid?.computed?.weekly_ot_hours ?? 40
  const over: { name: string; hours: number }[] = []
  for (const [name, weeks] of Object.entries(grid?.estate_weeks ?? {})) {
    const top = Math.max(0, ...Object.values(weeks ?? {}))
    if (top > line) over.push({ name, hours: top })
  }
  over.sort((a, b) => b.hours - a.hours)
  const held = grid?.held ?? []
  return [
    { id: 'drafts', label: 'Draft edits', value: count === null ? DASH : String(count), tone: count ? 'warn' : undefined,
      sub: count === null ? 'not read yet' : `${outside} outside the days drawn` },
    lookTile(grid?.computed, 'no conflicts, the draft on'),
    { id: 'trainings', label: 'Trainings in draft', value: grid ? String(trainings.length) : DASH,
      sub: trainings.map((d) => d.employee).join(', ') || (grid ? 'none' : 'not read yet') },
    { id: 'over40', label: `Over ${line}h`, value: !grid || grid.estate_readable === false ? DASH : String(over.length),
      tone: over.length ? 'bad' : undefined,
      sub: !grid ? 'not read yet' : grid.estate_readable === false ? 'the other houses could not be totalled'
        : over[0] ? `${over[0].name} ${over[0].hours}h at every house` : 'nobody over the line' },
    { id: 'held', label: 'Held by test mode', value: !grid || grid.held_readable === false ? DASH : String(held.length),
      tone: held.length ? 'warn' : undefined,
      sub: !grid ? 'not read yet' : grid.held_readable === false ? 'could not be read' : 'published, not in the workbook' },
  ]
}

// What the master grid tells the band: its own draft, its conflicts, and whether test mode holds (`undefined` when…
export type MasterSummary = { drafts: number; conflicts: number; testMode: 'on' | 'unreadable' | null | undefined }

/** The Builder band on "All houses · master grid". */
export function masterTiles(summary: MasterSummary | null, houses: House[] | null | undefined): Tile[] {
  const s = summary
  const withDrafts = (houses ?? []).filter((h) => (h.drafts ?? 0) > 0)
  const test = s?.testMode
  return [
    { id: 'm-drafts', label: 'Master draft edits', value: s ? String(s.drafts) : DASH, tone: s?.drafts ? 'warn' : undefined,
      sub: !s ? 'not read yet' : s.drafts ? 'a separate draft from each house\'s' : 'nothing staged' },
    { id: 'm-conflicts', label: 'Master conflicts', value: s ? String(s.conflicts) : DASH,
      tone: s?.conflicts ? 'bad' : undefined,
      sub: !s ? 'not read yet' : s.conflicts ? 'double-bookings, the draft on' : 'none' },
    { id: 'm-houses', label: 'Houses with drafts', value: houses ? String(withDrafts.length) : DASH,
      tone: withDrafts.length ? 'warn' : undefined,
      sub: withDrafts.map((h) => houseShort(h.location)).join(', ') || (houses ? 'every house published' : 'not read yet') },
    { id: 'm-test', label: 'Test mode', value: !s || test === undefined ? DASH : test === 'on' ? 'On' : test ? 'Unreadable' : 'Off',
      tone: test ? 'warn' : undefined,
      sub: !s || test === undefined ? 'not said by the grid' : test ? 'master publish refused' : 'the master publishes' },
  ]
}

/** The Publish review's two lists: the drafted cells in the days drawn, then every one outside them. */
export function publishGroups<T extends { col_iso: string }>(drafts: T[], days: { from: string; to: string } | null | undefined): {
  inside: T[]; outside: T[]
} {
  if (!days) return { inside: drafts, outside: [] }
  const inside: T[] = []
  const outside: T[] = []
  for (const d of drafts) (d.col_iso < days.from || d.col_iso > days.to ? outside : inside).push(d)
  return { inside, outside }
}

/** The cell states this view shows (the Key's list); `handoffs` when the view reads the transfers itself. */
export function statesPresent(grid: Grid | null | undefined, view: CalendarView,
                              timeOff?: TimeOffMarks | null, editor = false,
                              handoffs?: HandoffView[]): string[] {
  const got = new Set<string>()
  const c = grid?.computed
  for (const s of c?.open_shifts ?? []) got.add(s.claimed_by ? 'taken' : 'open')
  if ((c?.running ?? []).length) got.add('running')
  if ((c?.conflicts ?? []).some((x) => x.kind !== 'over-week')) got.add('conflict')
  if ((handoffs ?? grid?.handoffs ?? []).some((h) => h.state === 'pending')) got.add('transfer')
  for (const r of grid?.rows ?? []) {
    for (const cell of r.cells ?? []) {
      // Live never draws a draft, so it never keys one
      if (cell.draft && view === 'build') got.add('draft')
      if (cell.draft) continue
      if (cell.called_off) got.add('called-off')
      if (cell.test_mode) got.add('test-mode')
      if (cell.pending && !cell.test_mode) got.add('pending')
      if (cell.edited) got.add('override')
      if (!r.open_row && !r.call_off_row && !cell.called_off && workbookStripe(cell.color)) got.add('workbook-colour')
    }
  }
  for (const m of timeOff?.values() ?? []) got.add(TIME_OFF_LOOK[m].state)
  if (view === 'build') { got.add('draft'); got.add(TIME_OFF_LOOK.asked.state) }
  // an asked day is shown to the house's editors only
  if (!editor) got.delete(TIME_OFF_LOOK.asked.state)
  return [...got]
}

/** Test mode as the band and the banners say it: on, or unreadable (which holds too), or off. */
export function testModeHolds(grid: Pick<Grid, 'test_mode'> | null | undefined): 'on' | 'unreadable' | null {
  const t = grid?.test_mode
  if (!t) return null
  if (!t.readable) return 'unreadable'
  return t.on ? 'on' : null
}

/** The shifts worked in these days, from the relay's own per-day count; null when it has not answered. */
export function shiftsDrawn(computed: Computed | null | undefined,
                            days: { from: string; to: string } | undefined): number | null {
  if (!computed) return null
  return computed.days
    .filter((d) => !days || (d.col_iso >= days.from && d.col_iso <= days.to))
    .reduce((n, d) => n + (d.working || 0), 0)
}

/* ── a phone: Live one day at a time ────────────────────────────────────── */

export type PhoneView = 'day' | 'grid'

const PHONE_VIEW_KEY = 'asa-calendar-phone-view'

/** Live on a phone opens on the day agenda; the choice is this device's own. */
export function readPhoneView(): PhoneView {
  try {
    return globalThis.localStorage?.getItem(PHONE_VIEW_KEY) === 'grid' ? 'grid' : 'day'
  } catch {
    return 'day'
  }
}

export function writePhoneView(view: PhoneView): void {
  try {
    globalThis.localStorage?.setItem(PHONE_VIEW_KEY, view)
  } catch {
    // a device that keeps nothing still draws the view it was asked for
  }
}

/** The day the agenda draws: the one picked if the week holds it, else today, else the week's first. */
export function agendaDayOf(week: string[], picked: string, today: string): string {
  if (picked && week.includes(picked)) return picked
  if (week.includes(today)) return today
  return week[0] ?? ''
}

/** `mark`: the cell is on the platform, not in the workbook (test mode held it), or just published. */
export type AgendaRow = {
  employee: string; key: string; fact: CellFact | null; timeOff: boolean; mark: 'test-mode' | 'pending' | null
}

/** One day of a house as the phone draws it: the shifts nobody has, who works (by start), who is off. */
export function agendaOf(grid: Grid | null | undefined, iso: string, timeOff?: TimeOffMarks | null): {
  open: OpenShift[]; working: AgendaRow[]; off: AgendaRow[]
} {
  const c = grid?.computed
  const open = (c?.open_shifts ?? []).filter((s) => s.col_iso === iso && !s.claimed_by)
    .sort((a, b) => (a.start ?? 99) - (b.start ?? 99) || a.open_row.localeCompare(b.open_row))
  const working: AgendaRow[] = []
  const off: AgendaRow[] = []
  const col = (grid?.cols ?? []).findIndex((x) => String(x.iso || x.date || '') === iso)
  for (const r of grid?.rows ?? []) {
    if (r.open_row || r.call_off_row) continue
    const key = cellKey(r.employee, iso)
    const fact = c?.cells[key] ?? null
    const away = isAway(timeOff?.get(key))
    const cell = col >= 0 ? r.cells[col] : undefined
    const mark = cell?.test_mode ? 'test-mode' : cell?.pending ? 'pending' : null
    const row: AgendaRow = { employee: r.employee, key, fact, timeOff: away, mark }
    if (fact && fact.start != null && fact.hours > 0) working.push(row)
    else if (away || fact?.kind === 'off' || fact?.kind === 'ro') off.push(row)
  }
  working.sort((a, b) => (a.fact?.start ?? 0) - (b.fact?.start ?? 0) || a.employee.localeCompare(b.employee))
  return { open, working, off }
}

/** The days of the strip that hold a shift nobody has (the red dots). */
export function openDays(grid: Grid | null | undefined): Set<string> {
  return new Set((grid?.computed?.open_shifts ?? []).filter((s) => !s.claimed_by && !s.started).map((s) => s.col_iso))
}
