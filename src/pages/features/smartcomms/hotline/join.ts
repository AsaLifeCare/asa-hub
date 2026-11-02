// THE JOIN — pure functions that turn the relay's calls index and the four business sheets into one picture: which…
// NOTHING HERE FETCHES, WRITES OR THROWS.
import { ZONE } from '@/lib/ohio'
import type { CallRow, DailyNote } from './hotlineApi'
import {
  CLIENT_MATCH, LANE_IDS, NOTE_KIND, shiftText, type LaneId, type Modality, type ScheduleRead, type SheetLaneId,
} from './vocabulary'

export type Row = Record<string, unknown>

/** One cell as trimmed text. Objects and nulls are empty, never "[object Object]". */
export function cell(r: Row | null | undefined, k: string): string {
  const v = r ? r[k] : undefined
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return ''
  return String(v).trim()
}

// ------------------------------------------------------------------ time — every stamp on Ohio's clock…

export type Stamp = {
  /** Ohio's wall clock read as if it were UTC — comparable across every row */
  sort: number
  /** the Ohio calendar day, yyyy-mm-dd */
  day: string
  /** 'HH:MM' on Ohio's clock, or '' when the cell held a day and no hour */
  time: string
  /** the real instant, when the cell carried one or an Ohio hour placed it */
  instant: number | null
}

const WALL = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number }

function wallOf(ms: number): Wall {
  const p: Record<string, string> = {}
  for (const { type, value } of WALL.formatToParts(new Date(ms))) p[type] = value
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second }
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayKeyOf = (w: Pick<Wall, 'y' | 'mo' | 'd'>) => `${w.y}-${pad(w.mo)}-${pad(w.d)}`

// An instant, read on Ohio's clock.
function fromInstant(ms: number): Stamp | null {
  if (!Number.isFinite(ms)) return null
  const w = wallOf(ms)
  const midnight = w.h === 0 && w.mi === 0 && w.s === 0 && ms % 1000 === 0
  return {
    sort: Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s),
    day: dayKeyOf(w),
    time: midnight ? '' : `${pad(w.h)}:${pad(w.mi)}`,
    instant: ms,
  }
}

// A wall clock somebody typed in Ohio — echoed as typed, and placed on the timeline with the offset Ohio wore…
function fromWall(w: Wall, hasTime: boolean): Stamp | null {
  if (w.mo < 1 || w.mo > 12 || w.d < 1 || w.d > 31 || w.h > 23 || w.mi > 59 || w.s > 59) return null
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)
  const back = new Date(asUtc)
  // 2/31 rolls into March in Date.UTC; a day that does not exist is junk.
  if (back.getUTCMonth() !== w.mo - 1 || back.getUTCDate() !== w.d) return null
  let instant: number | null = null
  if (hasTime) {
    const o = wallOf(asUtc)
    const offset = Date.UTC(o.y, o.mo - 1, o.d, o.h, o.mi, o.s) - asUtc
    instant = asUtc - offset
  }
  return {
    sort: asUtc,
    day: dayKeyOf(w),
    time: hasTime ? `${pad(w.h)}:${pad(w.mi)}` : '',
    instant,
  }
}

const RE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i
const RE_US = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:[\s,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/
// `Wed Feb 18 2026 19:23:23 GMT-0300 (…)` — and the same cell cut short ("…10:07:27 GM"), which keeps its day and…
const RE_JS = /^(?:[A-Z][a-z]{2},? )?([A-Z][a-z]{2}) (\d{1,2}),? (\d{4})(?:,? (\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s*GMT([+-]\d{2}):?(\d{2}))?/

// Any date the lanes hold, or null.
export function parseStamp(raw: unknown): Stamp | null {
  // Only text is a date here: a bare number in a date column is a serial or a typo, and reading it as epoch…
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v) return null
  let m = RE_DAY.exec(v)
  if (m) return fromWall({ y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0, s: 0 }, false)
  m = RE_ISO.exec(v)
  if (m) {
    if (m[7]) {
      const zone = m[7].toUpperCase() === 'Z' ? 'Z' : m[7].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${zone}`
      const frac = /\.(\d+)/.exec(v)
      const ms = Date.parse(iso) + (frac ? Math.round(Number(`0.${frac[1]}`) * 1000) : 0)
      return fromInstant(ms)
    }
    return fromWall({ y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] ?? 0) }, true)
  }
  m = RE_US.exec(v)
  if (m) {
    // a two-digit year is this century's unless that would put it in the future
    const yy = +m[3]
    const y = m[3].length === 2 ? (2000 + yy > new Date().getUTCFullYear() + 1 ? 1900 + yy : 2000 + yy) : yy
    let h = m[4] ? +m[4] : 0
    if (m[7]) {
      const pm = m[7].toLowerCase() === 'pm'
      if (h < 1 || h > 12) return null
      h = (h % 12) + (pm ? 12 : 0)
    }
    return fromWall({ y, mo: +m[1], d: +m[2], h, mi: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0 }, !!m[4])
  }
  m = RE_JS.exec(v)
  if (m) {
    const mo = MONTH.indexOf(m[1]) + 1
    if (!mo) return null
    const w: Wall = { y: +m[3], mo, d: +m[2], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0 }
    if (m[7] && m[4]) {
      const sign = m[7].startsWith('-') ? -1 : 1
      const offsetMs = sign * (Math.abs(+m[7]) * 60 + +m[8]) * 60_000
      return fromInstant(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - offsetMs)
    }
    return fromWall(w, !!m[4])
  }
  return null
}

/** The Ohio calendar day an instant falls on — the screen's "today" is Ohio's. */
export function ohioDayOf(ms: number): string {
  return Number.isFinite(ms) ? dayKeyOf(wallOf(ms)) : ''
}

/** Whole Ohio days from `day` to `today` (0 = today, 1 = yesterday), or null. */
export function daysBefore(today: string, day: string): number | null {
  const a = RE_DAY.exec(today)
  const b = RE_DAY.exec(day)
  if (!a || !b) return null
  return Math.round(
    (Date.UTC(+a[1], +a[2] - 1, +a[3]) - Date.UTC(+b[1], +b[2] - 1, +b[3])) / 86_400_000,
  )
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayWords(day: string, today: string, withYear: boolean): string {
  const m = RE_DAY.exec(day)
  if (!m) return ''
  const ago = daysBefore(today, day)
  if (ago === 0) return 'Today'
  if (ago === 1) return 'Yesterday'
  const sameYear = today.slice(0, 4) === m[1]
  return `${MONTH[+m[2] - 1]} ${+m[3]}${withYear || !sameYear ? `, ${m[1]}` : ''}`
}

/** "Today 07:02" · "Yesterday 16:43" · "Sep 12 · 09:10" · "Mar 1, 2024" — or ''. */
export function stampLabel(st: Stamp | null, today: string): string {
  if (!st) return ''
  const day = dayWords(st.day, today, false)
  if (!st.time) return day
  const near = day === 'Today' || day === 'Yesterday'
  return near ? `${day} ${st.time}` : `${day} · ${st.time}`
}

/** "Wed, Sep 17, 2026 · 07:02" — the panel's full stamp. */
export function stampLong(st: Stamp | null): string {
  if (!st) return ''
  const m = RE_DAY.exec(st.day)
  if (!m) return ''
  const wd = WEEKDAY[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]
  const day = `${wd}, ${MONTH[+m[2] - 1]} ${+m[3]}, ${m[1]}`
  return st.time ? `${day} · ${st.time}` : day
}

/** "just now" · "12 min ago" · "3 h ago" · "2 days ago" — from an instant. */
export function relativeTime(ms: number | null, now: number): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  const d = Math.max(0, now - ms)
  const min = Math.floor(d / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.floor(h / 24)
  return days === 1 ? 'a day ago' : `${days} days ago`
}

/** "42s" · "3m 05s" · "—" */
export function durationText(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '—'
  const whole = Math.round(sec)
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return m ? `${m}m ${pad(s)}s` : `${s}s`
}

// ------------------------------------------------------------------ phones…

/** The last ten digits of a US number, or '' — the key the roster matches on. */
export function digits10(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return d
  if (d.length === 11 && d.startsWith('1')) return d.slice(1)
  return ''
}

// ------------------------------------------------------------------ call ids…

export const CALL_ID_RE = /\bAC[0-9a-f]{32}\b/i

/** The key a call id is joined on — case never decides a link. */
export const callKey = (id: string) => String(id ?? '').trim().toLowerCase()

/** The first call id written anywhere in a cell, as a join key, or ''. */
export function callIdIn(text: string): string {
  const m = CALL_ID_RE.exec(text || '')
  return m ? callKey(m[0]) : ''
}

// ------------------------------------------------------------------ the lanes' records…

export type LaneRecord = {
  key: string
  lane: LaneId
  /** the row as cells — a Daily Note flattened by noteRow */
  row: Row
  /** the Daily Note itself, typed, on the notes lane only */
  note: DailyNote | null
  /** position in the sheet — the tie-breaker between rows of the same day */
  index: number
  stamp: Stamp | null
  /** the call this row came from, as a join key, or '' */
  callKey: string
  /** how the link was made — evidence, said */
  via: 'call_id' | 'notes' | 'time' | ''
}

// Which cell dates a row, lane by lane — the first one that parses.
const STAMP_FIELDS: Record<LaneId, string[]> = {
  calloffs: ['timestamp', 'date', 'createdAt'],
  queue: ['date_received'],
  notes: ['call_at', 'reporting_date'],
  incidents: ['timestamp', 'incident_reported_date', 'incident_date'],
}

function stampOfRow(lane: LaneId, row: Row): Stamp | null {
  for (const k of STAMP_FIELDS[lane]) {
    const st = parseStamp(cell(row, k))
    if (st) return st
  }
  return null
}

function ownLink(lane: SheetLaneId, row: Row): { callKey: string; via: LaneRecord['via'] } {
  if (lane === 'calloffs') {
    const id = callIdIn(cell(row, 'call_id'))
    if (id) return { callKey: id, via: 'call_id' }
    const inNotes = callIdIn(cell(row, 'notes'))
    return inNotes ? { callKey: inNotes, via: 'notes' } : { callKey: '', via: '' }
  }
  if (lane === 'queue') {
    const inNotes = callIdIn(cell(row, 'notes'))
    return inNotes ? { callKey: inNotes, via: 'notes' } : { callKey: '', via: '' }
  }
  return { callKey: '', via: '' }
}

/** Newest first; an undated row sinks, in reverse sheet order. */
function byNewest(a: { stamp: Stamp | null; index: number }, b: { stamp: Stamp | null; index: number }): number {
  if (a.stamp && b.stamp) return b.stamp.sort - a.stamp.sort || b.index - a.index
  if (a.stamp) return -1
  if (b.stamp) return 1
  return b.index - a.index
}

export function recordsOf(lane: SheetLaneId, rows: Row[]): LaneRecord[] {
  const out = rows.map((row, index): LaneRecord => {
    const id = cell(row, 'id')
    const link = ownLink(lane, row)
    return {
      key: `rec:${lane}:${id || `#${index}`}`,
      lane,
      row,
      note: null,
      index,
      stamp: stampOfRow(lane, row),
      callKey: link.callKey,
      via: link.via,
    }
  })
  return out.sort(byNewest)
}

// A NOTE'S CLIENT, WITH THE EVIDENCE.
export function noteClient(n: DailyNote): string {
  if (n.client_match === 'exact') return n.client
  if (n.client_match === 'similar') return `${n.client} (written “${n.written_as}” — the one similar name on file)`
  return n.written_as ? `“${n.written_as}” — not a client on file` : ''
}

// A Daily Note as cells — so the search, the chips, the field list and the spreadsheet view read a note the way…
export function noteRow(n: DailyNote, schedule: ScheduleRead = 'unknown'): Row {
  return {
    id: n.id,
    reporting_date: n.reporting_date,
    call_at: n.call_at,
    dsp_name: n.dsp_name,
    client: n.client,
    // the name as written is worth a line only when it is not the match itself
    client_written: n.client_match === 'exact' ? '' : n.written_as,
    client_match: n.client_match,
    client_match_label: CLIENT_MATCH[n.client_match],
    category: n.category,
    category_label: n.category_label || n.category,
    kind: n.kind,
    kind_label: NOTE_KIND[n.kind],
    shift_label: n.shift.label,
    shift_via: n.shift.via,
    shift_start: n.shift.start,
    shift_end: n.shift.end,
    shift_house: n.shift.house,
    shift_date: n.shift.date,
    shift_text: shiftText(n, schedule),
    response: n.response,
    call_id: n.call_id,
  }
}

// A NOTE'S RECORD KEY FOLLOWS THE NOTE, NOT ITS ROW.
export function noteRecordsOf(notes: DailyNote[], schedule: ScheduleRead = 'unknown'): LaneRecord[] {
  const seen = new Map<string, number>()
  for (const n of notes) if (n.key) seen.set(n.key, (seen.get(n.key) ?? 0) + 1)
  const out = notes.map((n, index): LaneRecord => {
    const row = noteRow(n, schedule)
    const k = callKey(n.call_id)
    const own = n.key && seen.get(n.key) === 1 ? `k:${n.key}` : n.id || `#${index}`
    return {
      key: `rec:notes:${own}`,
      lane: 'notes',
      row,
      note: n,
      // the door answers newest first, so its first note wins a tie
      index: notes.length - index,
      stamp: stampOfRow('notes', row),
      callKey: k,
      via: k ? 'call_id' : '',
    }
  })
  return out.sort(byNewest)
}

/** A kind as the log wrote it, without the failure mark. */
export const kindBase = (k: string) => String(k ?? '').replace(/!failed$/i, '').trim()
export const kindFailed = (k: string) => /!failed$/i.test(String(k ?? ''))

const INCIDENT_WINDOW_MS = 120_000

// THE INCIDENT LINK, the only one made from time.
export function linkIncidents(records: LaneRecord[], calls: CallRow[]): LaneRecord[] {
  const filers: { key: string; ms: number }[] = []
  for (const c of calls) {
    if (c.line_key !== 'hotline' || !c.hotline) continue
    if (!c.hotline.kinds.some((k) => !kindFailed(k) && kindBase(k) === 'Incident')) continue
    const ms = Date.parse(c.at)
    if (Number.isFinite(ms)) filers.push({ key: callKey(c.call_id), ms })
  }
  if (!filers.length) return records
  return records.map((r) => {
    const st = parseStamp(cell(r.row, 'timestamp'))
    if (!st || st.instant === null) return r
    const hits = filers.filter((f) => Math.abs(f.ms - (st.instant as number)) <= INCIDENT_WINDOW_MS)
    return hits.length === 1 ? { ...r, callKey: hits[0].key, via: 'time' } : r
  })
}

// ------------------------------------------------------------------ screening…

export type ScreenRecord = {
  key: string
  row: Row
  index: number
  stamp: Stamp | null
  callKey: string
  candidate: Row | null
}

export function screensOf(screens: Row[], candidates: Row[] | null): ScreenRecord[] {
  const byId = new Map<string, Row>()
  for (const c of candidates ?? []) {
    const id = cell(c, 'id')
    if (id) byId.set(id, c)
  }
  return screens
    .map((row, index): ScreenRecord => ({
      // phoneScreens rows carry no id column; the candidate and the moment the screen was created name one row as…
      key: `screen:${cell(row, 'id') || [cell(row, 'candidate_id'), cell(row, 'created_at')].filter(Boolean).join('@') || `#${index}`}`,
      row,
      index,
      stamp: parseStamp(cell(row, 'screen_date')) ?? parseStamp(cell(row, 'created_at')),
      callKey: callKey(cell(row, 'transcript_call_id')),
      candidate: byId.get(cell(row, 'candidate_id')) ?? null,
    }))
    .sort(byNewest)
}

// The candidate behind a screening call: the one its screen is filed under, else — for an OUTSIDE number only — the…
export function candidateForCall(call: CallRow, screen: ScreenRecord | null, candidates: Row[] | null): Row | null {
  if (screen?.candidate) return screen.candidate
  if (call.caller.kind !== 'outside' || call.caller.who === 'shared') return null
  const d = digits10(call.caller.phone)
  if (!d || !candidates) return null
  const hits = candidates.filter((c) => digits10(cell(c, 'phone')) === d)
  return hits.length === 1 ? hits[0] : null
}

// ------------------------------------------------------------------ modality…

export const isCallOffType = (t: string) => /call[\s-]*off/i.test(t)

// What kind of call this was.
export function modalitiesOf(call: CallRow, linked: LaneRecord[], screen: ScreenRecord | null = null): Modality[] {
  if (call.line_key === 'screening') return screen ? ['screening'] : []
  const set = new Set<Modality>()
  for (const r of linked) {
    if (r.lane === 'calloffs') set.add('calloffs')
    else if (r.lane === 'queue') set.add(isCallOffType(cell(r.row, 'type_of_request')) ? 'calloffs' : 'queue')
    else set.add(r.lane)
  }
  const has = (lane: LaneId) => linked.some((r) => r.lane === lane)
  for (const k of call.hotline?.kinds ?? []) {
    if (kindFailed(k)) continue
    const base = kindBase(k)
    if (base === 'Request' && !has('queue') && !has('calloffs')) set.add('queue')
    if (base === 'DailyNote' && !has('notes')) set.add('notes')
    if (base === 'Incident' && !has('incidents')) set.add('incidents')
  }
  return (['calloffs', 'queue', 'notes', 'incidents'] as Modality[]).filter((m) => set.has(m))
}

// Kinds the read filed that no linked row accounts for.
export function unlinkedKinds(call: CallRow, linked: LaneRecord[]): { landed: string[]; failed: string[] } {
  const landed: string[] = []
  const failed: string[] = []
  const count = (lane: LaneId) => linked.filter((r) => r.lane === lane).length
  const left: Record<string, number> = {
    Request: Math.max(count('queue'), count('calloffs')),
    DailyNote: count('notes'),
    Incident: count('incidents'),
  }
  for (const k of call.hotline?.kinds ?? []) {
    const base = kindBase(k)
    if (kindFailed(k)) { failed.push(base); continue }
    if (base in left && left[base] > 0) { left[base] -= 1; continue }
    landed.push(base)
  }
  return { landed, failed }
}

// ------------------------------------------------------------------ who…

export type WhoSource = 'roster' | 'stated' | 'candidate' | 'shared' | 'unknown'
export type Who = { name: string; source: WhoSource }

const NOT_A_NAME = /^(undetermined|unknown|not specified.*|n\/?a|none|caller|anonymous|-+|\?+)$/i

const STATED_FIELD: Record<LaneId, string> = {
  calloffs: 'employee_name',
  queue: 'requestor',
  notes: 'dsp_name',
  incidents: 'your_name',
}

// The name a lane row holds — '' when the cell holds a placeholder.
export function statedName(rec: LaneRecord): string {
  const v = cell(rec.row, STATED_FIELD[rec.lane])
  return v && !NOT_A_NAME.test(v) ? v : ''
}

// The sentence the sweep writes into a queue row's note when the requestor's name came from the number, not from…
const CALLER_ID_NOTE = /^\s*Named from the caller ID\b/i

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Did the sweep take this row's name from the caller ID?
export function nameFromCallerId(rec: LaneRecord, linked: LaneRecord[]): boolean {
  if (rec.lane === 'queue') return CALLER_ID_NOTE.test(cell(rec.row, 'notes'))
  if (rec.lane !== 'calloffs') return false
  const from = cell(rec.row, 'name_from').toLowerCase()
  if (from) return from === 'phone'
  const n = nameKey(cell(rec.row, 'employee_name'))
  return !!n && linked.some((q) => q.lane === 'queue'
    && CALLER_ID_NOTE.test(cell(q.row, 'notes'))
    && nameKey(cell(q.row, 'requestor')) === n)
}

export function whoOfCall(call: CallRow, linked: LaneRecord[], candidate: Row | null): Who {
  if (call.caller.who === 'sole' && call.caller.name) return { name: call.caller.name, source: 'roster' }
  for (const lane of LANE_IDS) {
    for (const r of linked) {
      if (r.lane !== lane) continue
      // a caller-ID name is the relay's to give, as `sole`, or nobody's
      if (nameFromCallerId(r, linked)) continue
      const n = statedName(r)
      if (n) return { name: n, source: 'stated' }
    }
  }
  if (candidate) {
    const n = cell(candidate, 'name')
    if (n) return { name: n, source: 'candidate' }
  }
  if (call.caller.who === 'shared' || call.caller.kind === 'company_line') return { name: 'Shared line', source: 'shared' }
  return { name: 'Unknown caller', source: 'unknown' }
}

// ------------------------------------------------------------------ small text…

// The first sentence of a text, capped — a list row's one-line preview, and all of a summary the browser's kept…
export function firstSentence(text: string, max = 160): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const m = /^(.+?[.!?])(\s|$)/.exec(t)
  const s = m && m[1].length >= 12 ? m[1] : t
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/** Counts of a value across items, most common first — a chip row. */
export function tally(values: string[]): { value: string; count: number }[] {
  const n = new Map<string, number>()
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1)
  return [...n.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}
