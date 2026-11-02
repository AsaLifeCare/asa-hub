// The Builder's pure model: the draft as schedulingBuilderRead answers it (SchedulingBuilder.gs), whole…
// Weekly totals run Monday to Sunday, a weekend is Saturday and Sunday, a night starts at 8 PM or crosses midnight.
import { addDays, dayIndex, firstRange } from './schedulingModel'

export type BuilderRow = { key: string; name: string }
export type DraftState = 'pattern' | 'approved' | 'published'
/** `a`/`b`: per row key, Monday..Sunday; `open_a`/`open_b`: the OPEN shifts of each weekday; `cells`/`open`: the period. */
export type Draft = {
  rows: BuilderRow[]
  a: Record<string, string[]>
  b: Record<string, string[]>
  open_a: string[][]
  open_b: string[][]
  cells: Record<string, Record<string, string>>
  open: Record<string, string[]>
  applied: boolean
}
export type BuilderStaff = { key: string; name: string; ist: boolean | null; ist_why: string }
export type Prefs = { here: boolean; a: string[]; b: string[] }
export type TimeOff = { key: string; name: string; from: string; to: string }
/** [date, start_min, end_min, house short]: a shift at another house. */
export type Elsewhere = [string, number, number, string]
export type PrevWeek = { rows: Record<string, string[]>; open: string[][]; names: Record<string, string> }
export type BuilderHouse = { code: string; short: string; location: string }
export type BuilderRead = {
  ok: true; today: string; house: string; first: string; last: string; weeks: number; store: string
  houses: BuilderHouse[]; periods: { id: string; first: string; last: string }[]
  drafts: { first: string; last: string; state: DraftState; updated_at: string }[]
  staff: BuilderStaff[] | null; staff_why: string; roster: BuilderRow[]
  prefs: Record<string, Prefs>; time_off: TimeOff[]; elsewhere: Record<string, Elsewhere[]>
  prev: { a: PrevWeek; b: PrevWeek } | null
  state: DraftState; rev: number; draft: Draft | null
  updated_at: string; updated_by: string; approved_at: string; approved_by: string; published_at: string
}
export type SaveAnswer = {
  ok: true; said: string; state: DraftState; rev: number; last: string; updated_at: string; updated_by: string
  approved_at: string; approved_by: string; published_at: string
}

export const OPEN_KEY = '__open'
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PREF_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const QUICK_SHIFTS = ['7A-3P', '2P-10P', '10P-7A', '8A-8P', 'OFF']
export const DAY_OFF = 'R/O'
export const MAX_WEEKS = 26

/* ---------- days ---------- */

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(iso: string): number {
  const d = dayIndex(iso)
  return Number.isNaN(d) ? 0 : (((d + 3) % 7) + 7) % 7
}

/** The Monday on or before the day. */
export function mondayOf(iso: string): string {
  return addDays(iso, -weekdayOf(iso))
}

export function daysOf(first: string, last: string): string[] {
  const out: string[] = []
  if (!first || !last) return out
  for (let d = first; d <= last && out.length < MAX_WEEKS * 7; d = addDays(d, 1)) out.push(d)
  return out
}

export function weeksOf(first: string, last: string): string[] {
  return daysOf(first, last).filter((_, i) => i % 7 === 0)
}

/** 'Oct 19' */
export function shortDay(iso: string): string {
  const d = dayIndex(iso)
  if (Number.isNaN(d)) return iso
  return new Date(d * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function rangeWords(first: string, last: string): string {
  return `${shortDay(first)} – ${shortDay(last)}`
}

/** Week A on even weeks from the first day, B on odd. */
export function weekLetter(first: string, iso: string): 'a' | 'b' {
  return Math.floor((dayIndex(iso) - dayIndex(first)) / 7) % 2 ? 'b' : 'a'
}

/* ---------- one cell ---------- */

export type Kind = 'day' | 'morning' | 'afternoon' | 'evening' | 'overnight' | 'off' | 'ro' | 'alias' | ''
export type ShiftInfo = { kind: Kind; start: number | null; end: number | null; hours: number; night: boolean; works: boolean }

const NOT_WORKING = new Set(['R/O', 'C/O', 'RO', 'R\\O', 'R/0', 'NCNS'])

/** The kind Scheduling.gs schedKindFor_ gives a range. */
function kindFor(start: number, end: number): Kind {
  if (start >= 19 || end > 24) return 'overnight'
  if (end - start >= 11 && start <= 10) return 'day'
  if (start < 11) return 'morning'
  if (start < 16) return 'afternoon'
  return 'evening'
}

export function shiftInfo(text: string | null | undefined): ShiftInfo {
  const t = String(text ?? '').trim()
  const none: ShiftInfo = { kind: '', start: null, end: null, hours: 0, night: false, works: false }
  if (!t) return none
  const r = firstRange(t)
  if (r) {
    const hours = Math.round((r.end - r.start) * 100) / 100
    return { kind: kindFor(r.start, r.end), start: r.start, end: r.end, hours, night: r.start >= 20 || r.end > 24, works: true }
  }
  const up = t.replace(/^\*+/, '').trim().toUpperCase()
  if (up === 'OFF') return { ...none, kind: 'off' }
  if (NOT_WORKING.has(up)) return { ...none, kind: 'ro' }
  return { ...none, kind: 'alias' }
}

/* ---------- the draft ---------- */

const blankWeek = (fill = 'OFF') => Array.from({ length: 7 }, () => fill)
const blankOpen = () => Array.from({ length: 7 }, () => [] as string[])

export function emptyDraft(rows: BuilderRow[]): Draft {
  const a: Record<string, string[]> = {}
  const b: Record<string, string[]> = {}
  rows.forEach((r) => { a[r.key] = blankWeek(); b[r.key] = blankWeek() })
  return { rows, a, b, open_a: blankOpen(), open_b: blankOpen(), cells: {}, open: {}, applied: false }
}

/** Every list present, every row's two weeks seven days long. */
export function draftFrom(raw: unknown): Draft | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<Draft>
  const rows = Array.isArray(d.rows) ? d.rows.filter((r) => r && r.key) : []
  const week = (src: Record<string, string[]> | undefined) => {
    const out: Record<string, string[]> = {}
    rows.forEach((r) => { const w = src?.[r.key] ?? []; out[r.key] = Array.from({ length: 7 }, (_, i) => String(w[i] ?? '')) })
    return out
  }
  const openWeek = (src: string[][] | undefined) => Array.from({ length: 7 }, (_, i) => (Array.isArray(src?.[i]) ? src![i].map(String) : []))
  return {
    rows, a: week(d.a), b: week(d.b), open_a: openWeek(d.open_a), open_b: openWeek(d.open_b),
    cells: d.cells && typeof d.cells === 'object' ? d.cells : {}, open: d.open && typeof d.open === 'object' ? d.open : {},
    applied: d.applied === true,
  }
}

export function addRow(d: Draft, row: BuilderRow): Draft {
  if (d.rows.some((r) => r.key === row.key)) return d
  return { ...d, rows: [...d.rows, row], a: { ...d.a, [row.key]: blankWeek() }, b: { ...d.b, [row.key]: blankWeek() } }
}

/** The row's person changed: its weeks and its cells move to the new key. */
export function swapRow(d: Draft, from: string, to: BuilderRow): Draft {
  if (from === to.key || d.rows.some((r) => r.key === to.key)) return d
  const move = <T>(m: Record<string, T>) => {
    const { [from]: kept, ...rest } = m
    return kept === undefined ? rest : { ...rest, [to.key]: kept }
  }
  return { ...d, rows: d.rows.map((r) => (r.key === from ? to : r)), a: move(d.a), b: move(d.b), cells: move(d.cells) }
}

export function dropRow(d: Draft, key: string): Draft {
  const drop = <T>(m: Record<string, T>) => { const rest = { ...m }; delete rest[key]; return rest }
  return { ...d, rows: d.rows.filter((r) => r.key !== key), a: drop(d.a), b: drop(d.b), cells: drop(d.cells) }
}

/** The pattern laid over the period: A on the first week, then B, A, B… */
export function applyPattern(d: Draft, first: string, last: string): Pick<Draft, 'cells' | 'open'> {
  const cells: Record<string, Record<string, string>> = {}
  const open: Record<string, string[]> = {}
  d.rows.forEach((r) => { cells[r.key] = {} })
  for (const iso of daysOf(first, last)) {
    const w = weekLetter(first, iso)
    const dow = weekdayOf(iso)
    d.rows.forEach((r) => { const t = (w === 'a' ? d.a : d.b)[r.key]?.[dow] ?? ''; if (t) cells[r.key][iso] = t })
    const o = (w === 'a' ? d.open_a : d.open_b)[dow] ?? []
    if (o.length) open[iso] = [...o]
  }
  return { cells, open }
}

/** The previous weeks copied into one week of the pattern: their rows' days, their OPEN shifts, and the people on them. */
export function copyPrevious(d: Draft, week: 'a' | 'b', prev: PrevWeek, staff: BuilderStaff[] | null): Draft {
  const active = new Set((staff ?? []).map((s) => s.key))
  let next = d
  Object.keys(prev.rows).forEach((k) => {
    if (active.has(k)) next = addRow(next, { key: k, name: staff?.find((s) => s.key === k)?.name ?? prev.names[k] ?? k })
  })
  const pat = { ...(week === 'a' ? next.a : next.b) }
  next.rows.forEach((r) => { pat[r.key] = prev.rows[r.key] ? prev.rows[r.key].map((t) => t || 'OFF') : blankWeek() })
  const open = prev.open.map((l) => [...l])
  return week === 'a' ? { ...next, a: pat, open_a: open } : { ...next, b: pat, open_b: open }
}

/* ---------- the checks ---------- */

export type Overlap = { name: string; date: string; text: string; with: string }
export type HoursLine = { key: string; name: string; avg: number; max: number; maxWeek: string }
export type PrefLine = { name: string; date: string; text: string; why: string }
export type RunLine = { name: string; from: string; to: string; days: number }
export type TimeOffLine = { name: string; from: string; to: string; shifts: number }
export type Check = {
  overlaps: Overlap[]; high: HoursLine[]; low: HoursLine[]; prefs: PrefLine[]; runs: RunLine[]; timeOff: TimeOffLine[]
}

type Span = { s: number; e: number; text: string; where: string; date: string }

/** A row's timed shifts as absolute minutes, this house's and (for overlaps) everywhere else's. */
function spansOf(read: Pick<BuilderRead, 'elsewhere'>, key: string, cells: Record<string, string>, house: string): Span[] {
  const out: Span[] = []
  for (const [iso, text] of Object.entries(cells)) {
    const i = shiftInfo(text)
    if (i.start === null || i.end === null) continue
    const base = dayIndex(iso) * 1440
    out.push({ s: base + Math.round(i.start * 60), e: base + Math.round(i.end * 60), text, where: house, date: iso })
  }
  for (const [iso, s, e, where] of read.elsewhere[key] ?? []) {
    const base = dayIndex(iso) * 1440
    out.push({ s: base + s, e: base + e, text: `${where} shift`, where, date: iso })
  }
  return out.sort((a, b) => a.s - b.s)
}

export function weekHours(cells: Record<string, string>, first: string, last: string): number[] {
  return weeksOf(first, last).map((mon) => {
    let h = 0
    for (let i = 0; i < 7; i++) h += shiftInfo(cells[addDays(mon, i)]).hours
    return Math.round(h * 100) / 100
  })
}

export function longestRuns(cells: Record<string, string>, first: string, last: string, min: number): { from: string; to: string; days: number }[] {
  const out: { from: string; to: string; days: number }[] = []
  let start = ''
  let n = 0
  const close = (end: string) => { if (n >= min) out.push({ from: start, to: end, days: n }); n = 0; start = '' }
  let prev = ''
  for (const iso of daysOf(first, last)) {
    if (shiftInfo(cells[iso]).works) { if (!n) start = iso; n++ } else if (n) close(prev)
    prev = iso
  }
  if (n) close(prev)
  return out
}

function maxStreak(cells: Record<string, string>, first: string, last: string): number {
  let best = 0
  let n = 0
  for (const iso of daysOf(first, last)) { n = shiftInfo(cells[iso]).works ? n + 1 : 0; best = Math.max(best, n) }
  return best
}

export function prefLines(read: Pick<BuilderRead, 'prefs'>, d: Pick<Draft, 'rows'>, cells: Draft['cells'], first: string, houseLabel: string): PrefLine[] {
  const out: PrefLine[] = []
  for (const r of d.rows) {
    const p = read.prefs[r.key]
    if (!p) continue
    const line = cells[r.key] ?? {}
    const worked = Object.keys(line).filter((iso) => shiftInfo(line[iso]).works).sort()
    if (p.here && worked.length) {
      out.push({ name: r.name, date: worked[0], text: `${worked.length} shift${worked.length === 1 ? '' : 's'}`, why: `cannot work at ${houseLabel}` })
    }
    for (const iso of worked) {
      const w = weekLetter(first, iso)
      if ((w === 'a' ? p.a : p.b).includes(PREF_DAYS[weekdayOf(iso)])) {
        out.push({ name: r.name, date: iso, text: line[iso], why: `unavailable on ${WEEKDAYS[weekdayOf(iso)]}s in Week ${w.toUpperCase()}` })
      }
    }
  }
  return out
}

export function patternCheck(read: BuilderRead, d: Draft, cells: Draft['cells'], first: string, last: string, house: string): Check {
  const weeks = weeksOf(first, last).length || 1
  const check: Check = { overlaps: [], high: [], low: [], prefs: [], runs: [], timeOff: [] }
  for (const r of d.rows) {
    const line = cells[r.key] ?? {}
    const spans = spansOf(read, r.key, line, house)
    for (let i = 1; i < spans.length; i++) {
      const a = spans[i - 1]
      const b = spans[i]
      if (b.s < a.e && (a.where === house || b.where === house)) {
        const mine = b.where === house ? b : a
        const other = mine === b ? a : b
        check.overlaps.push({ name: r.name, date: mine.date, text: mine.text, with: `${other.text} (${shortDay(other.date)})` })
      }
    }
    const wk = weekHours(line, first, last)
    const total = wk.reduce((x, y) => x + y, 0)
    const avg = Math.round((total / weeks) * 10) / 10
    const max = Math.max(0, ...wk)
    const maxAt = wk.indexOf(max)
    const h: HoursLine = { key: r.key, name: r.name, avg, max, maxWeek: maxAt >= 0 ? weeksOf(first, last)[maxAt] : '' }
    if (avg > 40 || max > 48) check.high.push(h)
    if (avg < 30) check.low.push(h)
    longestRuns(line, first, last, 6).forEach((run) => check.runs.push({ name: r.name, ...run }))
  }
  check.prefs = prefLines(read, d, cells, first, house)
  const onRows = new Set(d.rows.map((r) => r.key))
  for (const t of read.time_off) {
    if (!onRows.has(t.key)) continue
    const from = t.from < first ? first : t.from
    const to = t.to > last ? last : t.to
    const line = cells[t.key] ?? {}
    const shifts = daysOf(from, to).filter((iso) => shiftInfo(line[iso]).works).length
    check.timeOff.push({ name: d.rows.find((r) => r.key === t.key)?.name ?? t.name, from, to, shifts })
  }
  return check
}

/** Approved time off by person and day. */
export function timeOffDays(read: Pick<BuilderRead, 'time_off'>): Set<string> {
  const out = new Set<string>()
  for (const t of read.time_off) for (const iso of daysOf(t.from, t.to)) out.add(`${t.key}|${iso}`)
  return out
}

/* ---------- the Final Review ---------- */

export type Workload = {
  key: string; name: string; locations: string[]; shifts: number; total: number; avg: number; weeks: number[]
  ro: number; off: number; day: number; night: number; streak: number; weekends: number; pattern: string
  everyOther: boolean; flags: string[]
}
export type OpenLine = { date: string; text: string }
export type Review = {
  check: Check; open: OpenLine[]; busyDays: { date: string; n: number; list: string[] }[]
  high: Workload[]; low: Workload[]; halfWeekends: Workload[]; streaks: Workload[]; b2b: Workload[]; rows: Workload[]
}

export function finalReview(read: BuilderRead, d: Draft, first: string, last: string, house: string): Review {
  const check = patternCheck(read, d, d.cells, first, last, house)
  const weeks = weeksOf(first, last)
  const rows: Workload[] = d.rows.map((r) => {
    const line = d.cells[r.key] ?? {}
    let shifts = 0, ro = 0, off = 0, day = 0, night = 0
    for (const iso of daysOf(first, last)) {
      const i = shiftInfo(line[iso])
      if (i.works) { shifts++; if (i.night) night++; else day++ }
      else if (i.kind === 'ro') ro++
      else if (i.kind === 'off') off++
    }
    const wk = weekHours(line, first, last)
    const total = Math.round(wk.reduce((x, y) => x + y, 0) * 100) / 100
    const worked = weeks.map((mon) => [5, 6].some((i) => shiftInfo(line[addDays(mon, i)]).works))
    const weekends = worked.filter(Boolean).length
    const b2b = worked.some((w, i) => w && worked[i + 1])
    const everyOther = weeks.length > 1 && worked.every((w, i) => w !== worked[i + 1] || i === worked.length - 1) && weekends > 0
    const elsewhere = new Set((read.elsewhere[r.key] ?? []).map((e) => e[3]))
    const streak = maxStreak(line, first, last)
    const avg = Math.round((total / (weeks.length || 1)) * 10) / 10
    const flags: string[] = []
    if (avg > 40 || Math.max(0, ...wk) > 48) flags.push('High hrs')
    if (avg < 30) flags.push('Low hrs')
    if (weeks.length && weekends / weeks.length > 0.5) flags.push('>50% wknds')
    if (streak >= 6) flags.push('6+ consec.')
    if (b2b) flags.push('B2B wknds')
    return {
      key: r.key, name: r.name, locations: [house, ...elsewhere], shifts, total, avg, weeks: wk, ro, off, day, night, streak,
      weekends, pattern: worked.map((w) => (w ? 'W' : '–')).join('|'), everyOther, flags,
    }
  })
  const open: OpenLine[] = []
  const busyDays: Review['busyDays'] = []
  for (const iso of daysOf(first, last)) {
    const list = d.open[iso] ?? []
    list.forEach((text) => open.push({ date: iso, text }))
    if (list.length > 4) busyDays.push({ date: iso, n: list.length, list })
  }
  return {
    check, open, busyDays, rows,
    high: rows.filter((w) => w.flags.includes('High hrs')),
    low: rows.filter((w) => w.flags.includes('Low hrs')),
    halfWeekends: rows.filter((w) => w.flags.includes('>50% wknds')),
    streaks: rows.filter((w) => w.flags.includes('6+ consec.')),
    b2b: rows.filter((w) => w.flags.includes('B2B wknds')),
  }
}

/** The read as the screen draws it: every list present. */
export function builderFrom(raw: unknown): BuilderRead {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Partial<BuilderRead>
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : [])
  const obj = <T>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as T
  const week = (w: unknown): PrevWeek => {
    const o = obj<Partial<PrevWeek>>(w)
    return { rows: obj(o.rows), open: Array.from({ length: 7 }, (_, i) => arr<string>(arr<string[]>(o.open)[i])), names: obj(o.names) }
  }
  return {
    ok: true, today: String(b.today ?? ''), house: String(b.house ?? ''), first: String(b.first ?? ''), last: String(b.last ?? ''),
    weeks: Number(b.weeks ?? 0) || 0, store: String(b.store ?? ''), houses: arr(b.houses), periods: arr(b.periods),
    drafts: arr(b.drafts), staff: Array.isArray(b.staff) ? b.staff : null, staff_why: String(b.staff_why ?? ''),
    roster: arr(b.roster), prefs: obj(b.prefs), time_off: arr(b.time_off), elsewhere: obj(b.elsewhere),
    prev: b.prev ? { a: week(b.prev.a), b: week(b.prev.b) } : null,
    state: b.state === 'approved' || b.state === 'published' ? b.state : 'pattern', rev: Number(b.rev ?? 0) || 0,
    draft: draftFrom(b.draft), updated_at: String(b.updated_at ?? ''), updated_by: String(b.updated_by ?? ''),
    approved_at: String(b.approved_at ?? ''), approved_by: String(b.approved_by ?? ''), published_at: String(b.published_at ?? ''),
  }
}
