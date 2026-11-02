// THE DAILY SECTION'S ARITHMETIC — filtering, counting and grouping one client's notes, with no React in it, so the…
// A DAY IS CUT, NEVER PARSED.
import { clockOf, longDay } from '../shared'
import type { DailyNote, DailyShift, SourceHealth, UnmatchedSpelling } from './dailyApi'

export type DailyFilter = 'all' | 'daily' | 'not_daily'

export const DAILY_FILTERS: { id: DailyFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'daily', label: 'Daily status' },
  { id: 'not_daily', label: 'Not daily' },
]

// ONE PAGE IS ONE DAY, in both chart views.
export const DAYS_PER_PAGE = 1

// THE COUNT BESIDE THE DAY'S HEADER — how many NOTES that day carries, which is now exactly what the page under it…
export function dayCountLine(d: Pick<DailyDay, 'count'>): string {
  return `· ${d.count} ${d.count === 1 ? 'note' : 'notes'}`
}

// WHAT THE PAGER'S OWN LINE COUNTS — the days it walks, said so that the last page is not counted as a day it is…
export function dayPagerNoun(days: readonly Pick<DailyDay, 'day'>[]): string {
  return days.some((d) => !d.day) ? 'days, one undated' : 'days'
}

export function countNotes(notes: DailyNote[]): Record<DailyFilter, number> {
  let notDaily = 0
  for (const n of notes) if (n.kind === 'not_daily') notDaily++
  return { all: notes.length, daily: notes.length - notDaily, not_daily: notDaily }
}

export function filterNotes(notes: DailyNote[], filter: DailyFilter): DailyNote[] {
  if (filter === 'all') return notes
  return notes.filter((n) => n.kind === filter)
}

// ------------------------------------------------------------------ one call's header…

// HOW MUCH OF THE SCHEDULE THE DOOR READ — what "no shift was found" may be said on.
export type ScheduleRead = 'read' | 'partial' | 'unread' | 'unknown'

export function scheduleReadOf(h: SourceHealth | undefined): ScheduleRead {
  if (!h) return 'unknown'
  if (h.ok) return 'read'
  return h.rows !== null ? 'partial' : 'unread'
}

export type ShiftLine = {
  /** 'Afternoon', or '' when nothing places the call on a shift */
  label: string
  /** '2:30 PM–10:00 PM', or '' when the schedule gave no window */
  window: string
  // 'began Mon, Sep 15, 2026' — only for a shift that began on another day than the note's reporting day, or ran…
  began: string
  /** the house the DSP worked — ONLY when it is known not to be the client's */
  elsewhere: string
  // the muted qualifier: how the shift was placed, when it is not the schedule's shift at the hour of the call — ''…
  hedge: string
  /** the DSP's spoken name met the schedule by spelling, not exactly */
  bySpelling: boolean
  // the shift is the part of the day the CALL fell in, worked out from the call's own clock — so it is exactly as…
  byCallTime: boolean
}

/** Why no scheduled shift stands behind the header, by how much of the schedule was read. */
const NOT_FOUND: Record<ScheduleRead, string> = {
  read: 'no scheduled shift found',
  partial: 'part of the schedule could not be read',
  unread: 'the schedule could not be read',
  unknown: 'shift not known',
}

export function shiftLine(shift: DailyShift, reportingDay = '', schedule: ScheduleRead = 'unknown'): ShiftLine {
  const none = { window: '', began: '', elsewhere: '', bySpelling: false, byCallTime: false }
  if (shift.via === 'none') {
    return { ...none, label: '', hedge: NOT_FOUND[schedule] }
  }
  if (shift.via === 'call_time') {
    return {
      ...none,
      byCallTime: true,
      label: shift.label,
      hedge: !shift.label ? NOT_FOUND[schedule] : schedule === 'unknown' ? 'by call time' : `by call time — ${NOT_FOUND[schedule]}`,
    }
  }
  const from = clockOf(shift.start)
  const to = clockOf(shift.end)
  const pastMidnight = !!shift.start && !!shift.end && shift.end <= shift.start
  return {
    label: shift.label,
    window: from && to ? `${from}–${to}` : from || to,
    began: shift.date && (shift.date !== reportingDay || pastMidnight) ? `began ${longDay(shift.date)}` : '',
    elsewhere: shift.at_client_house === false ? shift.house : '',
    // a shift the DSP worked that day, at other hours than the call's, is not the shift they were on when they…
    hedge: shift.covers_call === false ? 'shift that day, not at the call time' : '',
    bySpelling: shift.staff_match === 'similar',
    byCallTime: false,
  }
}

// ------------------------------------------------------------------ days and calls…

export type DailyCall = {
  key: string
  callId: string
  // The EARLIEST readable instant the call carries on this day, across every header it was split into — '' when no…
  callAt: string
  // How many readable instants the book gives this call on this day: 0 (the call has no time in the book), 1 (the…
  readings: number
  dsp: string
  shift: ShiftLine
  // Set when EVERY note under the call was matched to this client by similarity from one and the same spelling…
  similar: { writtenAs: string } | null
  notes: DailyNote[]
}

export type DailyDay = {
  /** 'YYYY-MM-DD', or '' for notes whose day could not be read */
  day: string
  title: string
  count: number
  calls: DailyCall[]
}

/** 'r123' -> 123; anything else sorts after every numbered row. */
function rowOf(id: string): number {
  const m = /^r(\d+)$/.exec(id)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

/** A call's instant; an unreadable one is older than every readable one. */
function instant(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
}

/** Ascending, and safe for the infinities above (Infinity − Infinity is NaN). */
function ascending(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1
}

export function dayTitle(day: string): string {
  return day ? longDay(day) : 'Date not recorded'
}

export function categoryLabel(note: DailyNote): string {
  if (note.category_label) return note.category_label
  const words = note.category.replace(/_+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'No category'
}

export function similarLine(writtenAs: string): string {
  return writtenAs
    ? `Written as ‘${writtenAs}’ — matched by spelling similarity`
    : 'Matched by spelling similarity'
}

// WHAT A CALL THE BOOK TIMES TWO WAYS SAYS INSTEAD OF A CLOCK.
export function callTimeDisputedLine(readings: number, byCallTime: boolean): string {
  const head = `Filed more than once — the book gives this call ${readings} different times, so none is shown`
  return byCallTime ? `${head}, nor the part of the day it fell in.` : `${head}.`
}

// THE WHOLE BOOK'S UNMATCHED NOTES, said as the whole book's.
export function unmatchedLine(rows: number, client: string, accountedFor = 0): string {
  const n = rows.toLocaleString('en-US')
  const head = rows === 1
    ? '1 note across all clients names someone the platform could not match to a client on file'
    : `${n} notes across all clients name someone the platform could not match to a client on file`
  return rows > accountedFor ? `${head}; ${rows === 1 ? 'it' : 'some'} may be about ${client}.` : `${head}.`
}

// ------------------------------------------------------------------ spellings that could be this client…

// HOW CLOSE TWO WRITTEN NAMES ARE, 0..1 — the relay's name score (Names.gs nameScore_, which server/daily_notes.py…
export function nameCloseness(a: string, b: string): number {
  const ac = coreTokens(a)
  const bc = coreTokens(b)
  if (!ac.length || !bc.length) return 0
  const an = ac.join(' ')
  const bn = bc.join(' ')
  if (an === bn) return 1
  if (ac.length === 1 || bc.length === 1) return similarity(an, bn)
  const [af, al] = [ac[0], ac[ac.length - 1]]
  const [bf, bl] = [bc[0], bc[bc.length - 1]]
  const direct = (similarity(af, bf) + similarity(al, bl)) / 2
  const swapped = ((similarity(af, bl) + similarity(al, bf)) / 2) * 0.98
  const score = Math.max(direct, swapped)
  const partsHold = Math.min(similarity(af, bf), similarity(al, bl)) >= 0.7 ||
    Math.min(similarity(af, bl), similarity(al, bf)) >= 0.7
  return partsHold ? Math.max(score, similarity(an, bn)) : score
}

const NAME_SUFFIXES = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv', 'v',
  'md', 'rn', 'lpn', 'stna', 'dsp', 'phd', 'esq',
  'mr', 'mrs', 'ms', 'miss', 'dr',
  // Names.gs looks a suffix up on a plain object, which also answers for the keys every object inherits…
  'constructor',
])

const NAME_NICKNAMES: Record<string, string> = {
  mike: 'michael', mikey: 'michael', mick: 'michael',
  bob: 'robert', bobby: 'robert', robbie: 'robert', rob: 'robert',
  bill: 'william', billy: 'william', willie: 'william',
  jim: 'james', jimmy: 'james',
  joe: 'joseph', joey: 'joseph',
  tom: 'thomas', tommy: 'thomas',
  dave: 'david', davey: 'david',
  dan: 'daniel', danny: 'daniel',
  chris: 'christopher', kris: 'christopher',
  matt: 'matthew', nick: 'nicholas', tony: 'anthony',
  steve: 'steven', stevie: 'steven',
  eddie: 'edward', ed: 'edward',
  rick: 'richard', ricky: 'richard', rich: 'richard',
  jen: 'jennifer', jenny: 'jennifer', jess: 'jessica', jessie: 'jessica',
  liz: 'elizabeth', lizzie: 'elizabeth', beth: 'elizabeth',
  katie: 'katherine', kathy: 'katherine', kate: 'katherine',
  sue: 'susan', suzy: 'susan', susie: 'susan',
  patty: 'patricia', trish: 'patricia',
  maggie: 'margaret', peggy: 'margaret',
  becky: 'rebecca', debbie: 'deborah', deb: 'deborah',
  cindy: 'cynthia', vicky: 'victoria', angie: 'angela', barb: 'barbara',
  ken: 'kenneth', kenny: 'kenneth',
  larry: 'lawrence', jerry: 'gerald', gerry: 'gerald',
  ron: 'ronald', ronnie: 'ronald', don: 'donald', donnie: 'donald',
  charlie: 'charles', chuck: 'charles',
  hank: 'henry', johnny: 'john', jon: 'john', jack: 'john',
  greg: 'gregory', andy: 'andrew', drew: 'andrew',
  ben: 'benjamin', benny: 'benjamin',
  sam: 'samuel', sammy: 'samuel',
  alex: 'alexander', zach: 'zachary', josh: 'joshua',
  nate: 'nathaniel', gabe: 'gabriel', theo: 'theodore',
  tina: 'christina', chrissy: 'christina',
  shell: 'michelle', shelly: 'michelle',
  toni: 'antoinette', dee: 'deandra',
}

function coreTokens(name: string): string[] {
  const all = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’`]/g, '').replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((t) => t && !NAME_SUFFIXES.has(t))
  let core = all.filter((t) => t.length > 1)
  if (!core.length) core = all
  const full = core.length > 1 && Object.prototype.hasOwnProperty.call(NAME_NICKNAMES, core[0]) ? NAME_NICKNAMES[core[0]] : ''
  return full ? [full, ...core.slice(1)] : core
}

function similarity(a: string, b: string): number {
  if (a === b) return 1
  const m = Math.max(a.length, b.length)
  if (!m) return 0
  let sim = 1 - levenshtein(a, b) / m
  if (a[0] !== b[0] && sim < 0.85) sim *= 0.75
  return sim < 0 ? 0 : sim
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// Below this, a spelling is not pointed at on a chart.
export const NEAR_MIN = 0.6

export type NearSpelling = { writtenAs: string; rows: number }

// THE UNMATCHED SPELLINGS THAT COULD BE THIS CLIENT: close enough to the client's name, and no closer to another…
export function nearSpellings(
  spellings: UnmatchedSpelling[] | null,
  client: string,
  clients: readonly string[],
): NearSpelling[] {
  if (!spellings?.length || !client) return []
  const others = clients.filter((c) => c && c !== client)
  const out: NearSpelling[] = []
  for (const s of spellings) {
    const mine = nameCloseness(s.written_as, client)
    if (mine < NEAR_MIN) continue
    if (others.some((o) => nameCloseness(s.written_as, o) > mine)) continue
    out.push({ writtenAs: s.written_as, rows: s.rows })
  }
  return out.sort((a, b) => b.rows - a.rows || a.writtenAs.localeCompare(b.writtenAs))
}

/** '21 notes name “S. Bxx” (12) or “S. Byy” (9), which could be this client — …' */
export function nearLine(near: NearSpelling[]): string {
  if (!near.length) return ''
  const total = near.reduce((a, s) => a + s.rows, 0)
  const named = near.map((s) => (near.length > 1 ? `“${s.writtenAs}” (${s.rows.toLocaleString('en-US')})` : `“${s.writtenAs}”`))
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} or ${named[named.length - 1]}`
  return total === 1
    ? `1 note names ${list}, which could be this client — the platform does not match it by guesswork, so it is not shown here.`
    : `${total.toLocaleString('en-US')} notes name ${list}, which could be this client — the platform does not match them by guesswork, so they are not shown here.`
}

// WHICH CALL A NOTE BELONGS TO — its call id, or the row itself when the book gave none.
function callKeyOf(n: DailyNote): string {
  return n.call_id || `row:${n.key || n.id}`
}

// Days newest first, a day's calls newest first, a call's notes in the order the book wrote them.
export function groupNotes(notes: DailyNote[], schedule: ScheduleRead = 'unknown'): DailyDay[] {
  const days = new Map<string, Map<string, DailyNote[]>>()
  for (const n of notes) {
    const s = n.shift
    const key = [
      callKeyOf(n),
      n.dsp_name,
      s.via, s.label, s.start, s.end, s.house, String(s.at_client_house), s.staff_match,
      s.date, String(s.covers_call),
    ].join('')
    let calls = days.get(n.reporting_date)
    if (!calls) days.set(n.reporting_date, (calls = new Map()))
    const bucket = calls.get(key)
    if (bucket) bucket.push(n)
    else calls.set(key, [n])
  }

  const out: DailyDay[] = []
  for (const [day, calls] of days) {
    // EVERY TIME THE BOOK GIVES EACH CALL OF THIS DAY, gathered by the call itself — so a call the book filed…
    const heard = new Map<string, { times: Set<number>; at: string }>()
    for (const group of calls.values()) {
      for (const n of group) {
        const t = instant(n.call_at)
        if (t === Number.NEGATIVE_INFINITY) continue
        const held = heard.get(callKeyOf(n))
        if (!held) heard.set(callKeyOf(n), { times: new Set([t]), at: n.call_at })
        else {
          held.times.add(t)
          if (t < instant(held.at)) held.at = n.call_at
        }
      }
    }

    const built: DailyCall[] = []
    for (const [key, group] of calls) {
      const ordered = [...group].sort((a, b) => ascending(rowOf(a.id), rowOf(b.id)))
      const first = ordered[0]
      const held = heard.get(callKeyOf(first))
      const oneSpelling = ordered.every((n) => n.client_match === 'similar' && n.written_as === first.written_as)
      built.push({
        key,
        callId: first.call_id,
        callAt: held?.at ?? '',
        readings: held?.times.size ?? 0,
        dsp: first.dsp_name,
        shift: shiftLine(first.shift, day, schedule),
        similar: oneSpelling ? { writtenAs: first.written_as } : null,
        notes: ordered,
      })
    }
    // newest call first; a call with no readable time after every timed one, and among those the later row first
    built.sort((a, b) =>
      ascending(instant(b.callAt), instant(a.callAt)) || ascending(rowOf(b.notes[0].id), rowOf(a.notes[0].id)))
    out.push({ day, title: dayTitle(day), count: built.reduce((a, c) => a + c.notes.length, 0), calls: built })
  }

  // '' (unreadable day) sorts last; the rest newest first as plain strings
  out.sort((a, b) => {
    if (!a.day || !b.day) return a.day ? -1 : b.day ? 1 : 0
    return b.day.localeCompare(a.day)
  })
  return out
}
