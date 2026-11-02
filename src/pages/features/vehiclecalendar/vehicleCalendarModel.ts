// Transportation's model: the board `vehicleCalendarBoard` answers, read defensively, and every pure question the…
// Every clock is Eastern.
import type { TintName } from '@/engine/types'
import { ohioToday } from '@/lib/ohio'

export const ZONE = 'America/New_York'

/* ---------- the board ---------- */

export type Tone = 'amber' | 'peach' | 'blue' | 'mint' | 'grey' | 'rose'
export type VehicleTint = 'blue' | 'mint' | 'peach' | 'lilac' | 'amber' | 'rose'
export type Availability = 'available' | 'maintenance' | 'out_of_service'
export type TripState = 'requested' | 'scheduled' | 'needs_assignment' | 'declined' | 'cancelled'
export type TripWord = 'Requested' | 'Needs assignment' | 'Scheduled' | 'In use' | 'Completed' | 'Declined' | 'Cancelled'

export type TripSpan = { id: string; start_at: string; end_at: string }

export type Vehicle = {
  id: string
  name: string
  description: string
  seats: number
  wheelchair_accessible: boolean
  availability: Availability
  tint: VehicleTint
  order: number
  details: string
  status: { word: string; tone: Tone }
  active_trip?: TripSpan
  next_trip?: TripSpan
}

export type Seat = { to: string[]; state: string; by: string; at: string }

export type Trip = {
  id: string
  state: TripState
  word: TripWord | string
  tone: Tone
  vehicle_id: string
  vehicle_name: string
  requested_vehicle_id: string
  requested_vehicle_name: string
  start_at: string
  end_at: string
  day: string
  start_label: string
  end_label: string
  end_known: boolean
  wheelchair_required: boolean
  trip_type: string
  purpose: string
  destination: string
  details: string
  client_key: string
  client_name: string
  staff_key: string
  staff_name: string
  driver_key: string
  driver_name: string
  requested_by: { uid: string; name: string }
  decided_by: string
  decided_at: string
  decision_note: string
  assign_note: string
  seats: Seat[]
  source: string
  mine: boolean
  private: boolean
  test_mode: boolean
  created_at: string
  updated_at: string
}

export type Viewer = {
  uid: string
  name: string
  is_master: boolean
  is_director: boolean
  can_edit: boolean
  can_request: boolean
  visiting: boolean
  /** the client this board was asked for (Clients › Transportation), whose trips are whole to whoever may change them */
  client: string
}

export type Kpis = { needs_assignment: number; scheduled: number; in_service: number }
export type Person = { key: string; uid: string; name: string }
export type Client = { key: string; name: string }
export type DriverWord = { may_drive: boolean | null; word: string }
export type SourceKey = 'vehicles' | 'trips' | 'inbox' | 'settings' | 'people' | 'clients' | 'drivers'
export type Source = { key: SourceKey | string; state: 'ready' | 'unreadable'; why: string; count: number }

export type Settings = {
  directors: { uid: string; name: string }[]
  directors_readable: boolean
  directors_why: string
  trip_types: string[]
  seeded: boolean
  imported_at: string
}

export type Board = {
  ok: boolean
  now: string
  today: string
  stamp: string
  viewer: Viewer
  test_mode: { on: boolean; readable: boolean; why: string }
  settings: Settings
  vehicles: Vehicle[]
  trips: Trip[]
  kpis: Kpis
  people: Person[]
  clients: Client[]
  drivers?: Record<string, DriverWord>
  waiting: { item_id: string; trip_id: string }[]
  sources: Source[]
  note: string
}

/** A write's answer: its sentence, and the viewer's fresh board when the gate let the board be read. */
export type WriteAnswer = {
  ok: boolean
  said: string
  trip_id?: string
  vehicle_id?: string
  warnings?: string[]
  changed?: boolean
  state?: string
  board?: Board
}

type Raw = Record<string, unknown>
const rec = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)
const yes = (v: unknown): boolean => v === true || v === 'yes' || v === 'true'

const TONES: Tone[] = ['amber', 'peach', 'blue', 'mint', 'grey', 'rose']
const TINTS: VehicleTint[] = ['blue', 'mint', 'peach', 'lilac', 'amber', 'rose']
const AVAILABILITIES: Availability[] = ['available', 'maintenance', 'out_of_service']
const STATES: TripState[] = ['requested', 'scheduled', 'needs_assignment', 'declined', 'cancelled']

const toneOf = (v: unknown, fallback: Tone = 'grey'): Tone => (TONES.includes(v as Tone) ? (v as Tone) : fallback)

function tripSpanFrom(v: unknown): TripSpan | undefined {
  const o = rec(v)
  return o.id ? { id: str(o.id), start_at: str(o.start_at), end_at: str(o.end_at) } : undefined
}

export function vehicleFrom(v: unknown): Vehicle {
  const o = rec(v)
  const status = rec(o.status)
  return {
    id: str(o.id),
    name: str(o.name),
    description: str(o.description),
    seats: num(o.seats),
    wheelchair_accessible: yes(o.wheelchair_accessible),
    availability: AVAILABILITIES.includes(o.availability as Availability) ? (o.availability as Availability) : 'available',
    tint: TINTS.includes(o.tint as VehicleTint) ? (o.tint as VehicleTint) : 'blue',
    order: num(o.order),
    details: str(o.details),
    status: { word: str(status.word), tone: toneOf(status.tone) },
    active_trip: tripSpanFrom(o.active_trip),
    next_trip: tripSpanFrom(o.next_trip),
  }
}

export function tripFrom(v: unknown): Trip {
  const o = rec(v)
  const by = rec(o.requested_by)
  return {
    id: str(o.id),
    state: STATES.includes(o.state as TripState) ? (o.state as TripState) : 'requested',
    word: str(o.word),
    tone: toneOf(o.tone),
    vehicle_id: str(o.vehicle_id),
    vehicle_name: str(o.vehicle_name),
    requested_vehicle_id: str(o.requested_vehicle_id),
    requested_vehicle_name: str(o.requested_vehicle_name),
    start_at: str(o.start_at),
    end_at: str(o.end_at),
    day: str(o.day),
    start_label: str(o.start_label),
    end_label: str(o.end_label),
    end_known: o.end_known !== false && o.end_known !== 'no',
    wheelchair_required: yes(o.wheelchair_required),
    trip_type: str(o.trip_type),
    purpose: str(o.purpose),
    destination: str(o.destination),
    details: str(o.details),
    client_key: str(o.client_key),
    client_name: str(o.client_name),
    staff_key: str(o.staff_key),
    staff_name: str(o.staff_name),
    driver_key: str(o.driver_key),
    driver_name: str(o.driver_name),
    requested_by: { uid: str(by.uid), name: str(by.name) },
    decided_by: str(o.decided_by),
    decided_at: str(o.decided_at),
    decision_note: str(o.decision_note),
    assign_note: str(o.assign_note),
    seats: list(o.seats).map((s) => {
      const x = rec(s)
      return { to: list(x.to).map(str), state: str(x.state), by: str(x.by), at: str(x.at) }
    }),
    source: str(o.source),
    mine: o.mine === true,
    private: o.private === true,
    test_mode: yes(o.test_mode),
    created_at: str(o.created_at),
    updated_at: str(o.updated_at),
  }
}

/** The board as the screen reads it: every list an array, every flag a boolean, nothing undefined. */
export function boardFrom(raw: unknown): Board {
  const o = rec(raw)
  const viewer = rec(o.viewer)
  const tm = rec(o.test_mode)
  const s = rec(o.settings)
  const k = rec(o.kpis)
  const drivers = o.drivers && typeof o.drivers === 'object' ? rec(o.drivers) : null
  return {
    ok: o.ok !== false,
    now: str(o.now),
    today: DAY_RE.test(str(o.today)) ? str(o.today) : ohioToday(),
    stamp: str(o.stamp),
    viewer: {
      uid: str(viewer.uid),
      name: str(viewer.name),
      is_master: viewer.is_master === true,
      is_director: viewer.is_director === true,
      can_edit: viewer.can_edit === true,
      can_request: viewer.can_request === true,
      visiting: viewer.visiting === true,
      client: str(viewer.client),
    },
    // unknown is on: the banner says test mode holds until the board says it does not
    test_mode: { on: tm.on !== false, readable: tm.readable === true, why: str(tm.why) },
    settings: {
      directors: list(s.directors).map((d) => ({ uid: str(rec(d).uid), name: str(rec(d).name) })),
      directors_readable: s.directors_readable === true,
      directors_why: str(s.directors_why),
      trip_types: list(s.trip_types).map(str).filter(Boolean),
      seeded: s.seeded === true,
      imported_at: str(s.imported_at),
    },
    vehicles: list(o.vehicles).map(vehicleFrom).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    trips: list(o.trips).map(tripFrom),
    kpis: { needs_assignment: num(k.needs_assignment), scheduled: num(k.scheduled), in_service: num(k.in_service) },
    people: list(o.people).map((p) => ({ key: str(rec(p).key), uid: str(rec(p).uid), name: str(rec(p).name) })).filter((p) => p.key),
    clients: list(o.clients).map((c) => ({ key: str(rec(c).key), name: str(rec(c).name) })).filter((c) => c.key),
    ...(drivers ? {
      drivers: Object.fromEntries(Object.entries(drivers).map(([key, d]) => {
        const x = rec(d)
        return [key, { may_drive: x.may_drive === true ? true : x.may_drive === false ? false : null, word: str(x.word) }]
      })),
    } : {}),
    waiting: list(o.waiting).map((w) => ({ item_id: str(rec(w).item_id), trip_id: str(rec(w).trip_id) })).filter((w) => w.item_id),
    sources: list(o.sources).map((x) => {
      const r = rec(x)
      return { key: str(r.key), state: r.state === 'ready' ? 'ready' as const : 'unreadable' as const, why: str(r.why), count: num(r.count) }
    }),
    note: str(o.note),
  }
}

/** A write's answer, its board read as the screen reads one. */
export function writeFrom(raw: unknown): WriteAnswer {
  const o = rec(raw)
  return {
    ok: o.ok !== false,
    said: str(o.said),
    ...(o.trip_id ? { trip_id: str(o.trip_id) } : {}),
    ...(o.vehicle_id ? { vehicle_id: str(o.vehicle_id) } : {}),
    ...(Array.isArray(o.warnings) ? { warnings: o.warnings.map(str).filter(Boolean) } : {}),
    ...(typeof o.changed === 'boolean' ? { changed: o.changed } : {}),
    ...(o.state ? { state: str(o.state) } : {}),
    ...(o.board && typeof o.board === 'object' ? { board: boardFrom(o.board) } : {}),
  }
}

/** The board a write leaves: the fresh one it carried, else the one held. */
export const mergeWrite = (board: Board, answer: WriteAnswer): Board => answer.board ?? board

/* ---------- the editions (Settings › Editions) ---------- */

/** Transportation's editions (Editions.gs, app vehicle-calendar); each door is Python's alone. */
export const TRANSPORT_EDITIONS = {
  trips: 'transportation.trips', vehicles: 'transportation.vehicles', settings: 'transportation.settings',
} as const
export const TRANSPORT_EDITION_IDS: readonly string[] = Object.values(TRANSPORT_EDITIONS)

/** What this viewer changes here: the trips, the vehicles, the trip types (the master's own Setup is the session's). */
export type Powers = { trips: boolean; vehicles: boolean; types: boolean }

// the directors and the master as before, and whom editionsMine names (none while the app runs on Apps Script)
export function transportPowers(viewer: Viewer | null | undefined, editions: readonly string[]): Powers {
  const listed = (id: string) => Boolean(viewer && !viewer.visiting && editions.includes(id))
  return {
    trips: Boolean(viewer?.can_edit) || listed(TRANSPORT_EDITIONS.trips),
    vehicles: Boolean(viewer?.can_edit) || listed(TRANSPORT_EDITIONS.vehicles),
    types: listed(TRANSPORT_EDITIONS.settings),
  }
}

/* ---------- pages and the panel in the address ---------- */

export type PageId = 'calendar' | 'history' | 'vehicles'
export const PAGES: readonly { id: PageId; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'history', label: 'History' },
  { id: 'vehicles', label: 'Vehicles' },
]
export const pageOf = (v: string | null | undefined): PageId =>
  (PAGES.find((p) => p.id === v)?.id ?? 'calendar')
export const pageHref = (page: PageId): string => `/app/vehicle-calendar/${page}`

export type Panel =
  | { kind: 'request' }
  | { kind: 'trip'; id: string }
  | { kind: 'vehicle'; id: string }
  | { kind: 'vehicle-new' }
  | { kind: 'share' }
  | { kind: 'setup' }

/** The panel as `?panel=` carries it: request | trip~<id> | vehicle~<id> | vehicle~new | share | setup. */
export function panelParam(p: Panel | null): string {
  if (!p) return ''
  if (p.kind === 'trip' || p.kind === 'vehicle') return `${p.kind}~${p.id}`
  if (p.kind === 'vehicle-new') return 'vehicle~new'
  return p.kind
}

export function panelOf(v: string | null | undefined): Panel | null {
  const s = String(v ?? '').trim()
  if (s === 'request' || s === 'share' || s === 'setup') return { kind: s }
  if (s === 'vehicle~new') return { kind: 'vehicle-new' }
  const m = /^(trip|vehicle)~([A-Za-z0-9_-]{1,40})$/.exec(s)
  return m ? { kind: m[1] as 'trip' | 'vehicle', id: m[2] } : null
}

/* ---------- Eastern clocks ---------- */

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** An instant's Eastern wall clock as 'yyyy-MM-ddTHH:mm'; '' when unreadable. */
export function easternWall(v: string | number | Date): string {
  const ms = typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(String(v ?? ''))
  if (!Number.isFinite(ms)) return ''
  const p: Record<string, string> = {}
  for (const { type, value } of PARTS.formatToParts(new Date(ms))) p[type] = value
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

// An Eastern wall clock as an instant.
export function wallToMs(wall: string): number {
  const m = WALL_RE.exec(String(wall ?? ''))
  if (!m) return NaN
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  for (const hours of [4, 5]) {
    const ms = base + hours * 3_600_000
    if (easternWall(ms) === wall) return ms
  }
  return NaN
}

const msOf = (iso: string): number => Date.parse(String(iso ?? ''))

/** 'HH:mm' of an instant, Eastern. */
export const clock24 = (v: string | number): string => easternWall(v).slice(11)

const CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' })
const WEEKDAY_DAY = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric' })
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric' })

/** '1:00 PM', Eastern. */
export function clock12(v: string | number): string {
  const ms = typeof v === 'number' ? v : msOf(v)
  return Number.isFinite(ms) ? CLOCK.format(new Date(ms)) : ''
}

/** 'Tue Oct 7, 1:00 PM – 3:20 PM', or 'Oct 7, 1:00 PM – Oct 8, 9:00 AM' across days. */
export function whenWords(startIso: string, endIso: string): string {
  const s = msOf(startIso)
  const e = msOf(endIso)
  if (!Number.isFinite(s)) return ''
  if (!Number.isFinite(e)) return `${WEEKDAY_DAY.format(new Date(s)).replace(',', '')}, ${clock12(s)}`
  if (easternWall(s).slice(0, 10) === easternWall(e).slice(0, 10)) {
    return `${WEEKDAY_DAY.format(new Date(s)).replace(',', '')}, ${clock12(s)} – ${clock12(e)}`
  }
  return `${MONTH_DAY.format(new Date(s))}, ${clock12(s)} – ${MONTH_DAY.format(new Date(e))}, ${clock12(e)}`
}

/** 'Tue Oct 7, 1:00 PM' — one instant, Eastern. */
export function momentWords(iso: string): string {
  const ms = msOf(iso)
  return Number.isFinite(ms) ? `${WEEKDAY_DAY.format(new Date(ms)).replace(',', '')}, ${clock12(ms)}` : ''
}

/** The request form's selects as a wall clock: 'yyyy-MM-ddTHH:mm', or '' while any part is missing. */
export function wallOf(date: string, hour12: string | number, minute: string | number, ampm: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return ''
  const h = Number(hour12)
  const mi = Number(minute)
  if (!Number.isInteger(h) || h < 1 || h > 12 || !Number.isInteger(mi) || mi < 0 || mi > 59) return ''
  if (ampm !== 'AM' && ampm !== 'PM') return ''
  const h24 = (h % 12) + (ampm === 'PM' ? 12 : 0)
  return `${date}T${String(h24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

export type WallParts = { date: string; hour: string; minute: string; ampm: 'AM' | 'PM' }

/** A wall clock back into the form's selects. */
export function partsOfWall(wall: string): WallParts {
  const m = WALL_RE.exec(String(wall ?? ''))
  if (!m) return { date: '', hour: '', minute: '00', ampm: 'AM' }
  const h = +m[4]
  return { date: `${m[1]}-${m[2]}-${m[3]}`, hour: String(h % 12 === 0 ? 12 : h % 12), minute: m[5], ampm: h < 12 ? 'AM' : 'PM' }
}

export const HOURS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const
export const MINUTES = ['00', '15', '30', '45'] as const

/* ---------- days, months and weeks ---------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function addDays(day: string, n: number): string {
  const m = DAY_RE.exec(day)
  if (!m) return day
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n))
  return d.toISOString().slice(0, 10)
}

/** 'Sep 30, 2026'. */
export function dayLabel(day: string): string {
  const m = DAY_RE.exec(day)
  return m ? `${MONTHS[+m[2] - 1].slice(0, 3)} ${+m[3]}, ${m[1]}` : day
}

export const monthOf = (day: string): string => (DAY_RE.test(day) ? day.slice(0, 7) : '')

/** 'September 2026'. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : month
}

/** The month as weeks from Sunday: each cell a yyyy-MM-dd, or '' outside the month. */
export function monthWeeks(month: string): string[][] {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return []
  const y = +m[1]
  const mo = +m[2]
  const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const cells: string[] = Array.from({ length: first }, () => '')
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7) cells.push('')
  const weeks: string[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** The seven days, Sunday first, of the week that holds `day`. */
export function weekOf(day: string): string[] {
  const m = DAY_RE.exec(day)
  if (!m) return []
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()
  const sunday = addDays(day, -dow)
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i))
}

/** 'Sep 27, 2026 – Oct 3, 2026'. */
export function weekLabel(days: string[]): string {
  return days.length ? `${dayLabel(days[0])} – ${dayLabel(days[days.length - 1])}` : ''
}

/** The day `by` months on, kept inside the month it lands in. */
export function shiftMonthDay(day: string, by: number): string {
  const m = DAY_RE.exec(day)
  if (!m) return day
  const n = +m[1] * 12 + (+m[2] - 1) + by
  const y = Math.floor(n / 12)
  const mo = (n % 12) + 1
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(+m[3], last)).padStart(2, '0')}`
}

/** Midnight that opens an Eastern day, as an instant. */
export const dayStartMs = (day: string): number => wallToMs(`${day}T00:00`)

/* ---------- overlap and the calendar ---------- */

export type Span = { s: number; e: number }

/** Half-open: a trip ending at 10:00 and one starting at 10:00 do not overlap. */
export const overlap = (a: Span, b: Span): boolean => a.s < b.e && b.s < a.e

export const spanOf = (t: Pick<Trip, 'start_at' | 'end_at'>): Span => ({ s: msOf(t.start_at), e: msOf(t.end_at) })

/** Only a scheduled trip reserves its vehicle, and only it is drawn on the calendar. */
export const reserves = (t: Trip): boolean => t.state === 'scheduled' && Boolean(t.vehicle_id)

/** The Eastern days a trip's reservation covers (its end instant itself is not held). */
export function tripDays(t: Trip): string[] {
  const span = spanOf(t)
  const first = t.day || easternWall(span.s).slice(0, 10)
  if (!Number.isFinite(span.e) || span.e <= span.s) return first ? [first] : []
  const last = easternWall(span.e - 1).slice(0, 10)
  const out: string[] = []
  for (let d = first; d && d <= last && out.length < 31; d = addDays(d, 1)) out.push(d)
  return out
}

/** The reserved trips on a day, for the vehicles shown (null = all), in clock order. */
export function tripsOn(trips: Trip[], day: string, shown: ReadonlySet<string> | null): Trip[] {
  return trips
    .filter((t) => reserves(t) && (!shown || shown.has(t.vehicle_id)) && tripDays(t).includes(day))
    .sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id))
}

export type Chip = {
  id: string
  vehicle: string
  time: string
  text: string
  tint: VehicleTint
  private: boolean
  /** asked for and not yet decided: drawn as waiting, the vehicle it asked for */
  pending: boolean
}

/** A trip asked for and not yet decided (requested, or waiting for a vehicle): drawn only where a page asks for it. */
export const pendingTrip = (t: Trip): boolean => t.state === 'requested' || t.state === 'needs_assignment'

/** A calendar chip: the vehicle, '09:00–11:30', and what the trip is for — "Booked" when its details are private.
 * `pending`: the undecided trips a page also draws, each as awaiting approval. */
export function chipsFor(trips: Trip[], day: string, vehicles: Vehicle[], shown: ReadonlySet<string> | null,
  pending?: (t: Trip) => boolean): Chip[] {
  const byId = new Map(vehicles.map((v) => [v.id, v]))
  const asked = pending
    ? trips.filter((t) => pending(t) && (!shown || shown.has(t.vehicle_id || t.requested_vehicle_id)) && tripDays(t).includes(day))
    : []
  return [...tripsOn(trips, day, shown), ...asked]
    .sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id))
    .map((t) => {
      const days = tripDays(t)
      const first = days[0] === day
      const last = days[days.length - 1] === day
      const from = first ? t.start_label || clock24(t.start_at) : '00:00'
      const to = last ? t.end_label || clock24(t.end_at) : '24:00'
      const waiting = !reserves(t)
      const v = byId.get(t.vehicle_id || t.requested_vehicle_id)
      const what = t.purpose || t.trip_type
      return {
        id: t.id,
        vehicle: v?.name || t.vehicle_name || 'Vehicle',
        time: `${from}–${to}`,
        text: t.private ? 'Booked' : waiting ? `Awaiting approval${what ? ` · ${what}` : ''}` : what || 'Booked',
        tint: v?.tint ?? 'blue',
        private: t.private,
        pending: waiting,
      }
    })
}

/* ---------- is it free? ---------- */

export type Verdict = { word: string; tone: Tone; why: string }

const nameOf = (v: Pick<Vehicle, 'name'>) => (/^the /i.test(v.name) ? v.name : `the ${v.name}`)

// Whether a vehicle can take a trip from `s` to `e`: out of service, in maintenance, not accessible when a…
export function vehicleAt(vehicle: Vehicle, trips: Trip[], s: number, e: number,
  opts: { wheelchair?: boolean; except?: string } = {}): Verdict {
  if (vehicle.availability === 'maintenance') return { word: 'Maintenance', tone: 'peach', why: `${cap(nameOf(vehicle))} is in maintenance.` }
  if (vehicle.availability === 'out_of_service') return { word: 'Out of service', tone: 'grey', why: `${cap(nameOf(vehicle))} is out of service.` }
  if (opts.wheelchair && !vehicle.wheelchair_accessible) {
    return { word: 'Not wheelchair accessible', tone: 'rose', why: `${cap(nameOf(vehicle))} is not wheelchair accessible.` }
  }
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return { word: 'Available', tone: 'mint', why: '' }
  const span = { s, e }
  const others = trips.filter((t) => t.id !== opts.except && overlap(span, spanOf(t)))
  const booked = others.find((t) => reserves(t) && t.vehicle_id === vehicle.id)
  if (booked) return { word: 'Booked', tone: 'blue', why: `${cap(nameOf(vehicle))} is booked ${whenWords(booked.start_at, booked.end_at)}.` }
  const asked = others.find((t) => t.state === 'requested' && (t.requested_vehicle_id || t.vehicle_id) === vehicle.id)
  if (asked) {
    return { word: 'Requested', tone: 'amber', why: `Another request for ${nameOf(vehicle)} is waiting for the same time — the first one approved gets it.` }
  }
  return { word: 'Available', tone: 'mint', why: '' }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Whether a person can drive from `s` to `e`: not cleared, already on a trip then (scheduled or waiting, unless…
export function driverAt(key: string, trips: Trip[], s: number, e: number,
  opts: { except?: string; drivers?: Record<string, DriverWord>; states?: TripState[] } = {}): Verdict {
  if (!key) return { word: 'No driver', tone: 'grey', why: '' }
  const record = opts.drivers?.[key]
  if (record && record.may_drive === false) return { word: 'Not cleared to drive', tone: 'rose', why: record.word || 'Not cleared to drive (Employee Database).' }
  const states = opts.states ?? ['scheduled', 'requested']
  if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
    const busy = trips.find((t) => t.id !== opts.except && states.includes(t.state)
      && (t.driver_key === key || (!t.driver_key && t.staff_key === key)) && overlap({ s, e }, spanOf(t)))
    if (busy) {
      const v = busy.vehicle_name || busy.requested_vehicle_name
      return { word: 'Has a trip then', tone: 'amber', why: `Already has a trip then (${[v, `${clock12(busy.start_at)} – ${clock12(busy.end_at)}`].filter(Boolean).join(', ')}).` }
    }
  }
  if (record && record.may_drive === null) return { word: 'Available', tone: 'mint', why: 'No driver record on the Employee Database.' }
  return { word: 'Available', tone: 'mint', why: '' }
}

export type DayAvailability = 'Available' | 'Partly booked' | 'Booked' | 'Maintenance' | 'Out of service'

/** A vehicle on one Eastern day: its own availability first, then how much of the day scheduled trips hold. */
export function availabilityOn(vehicle: Vehicle, trips: Trip[], day: string): DayAvailability {
  if (vehicle.availability === 'maintenance') return 'Maintenance'
  if (vehicle.availability === 'out_of_service') return 'Out of service'
  const s = dayStartMs(day)
  const e = dayStartMs(addDays(day, 1))
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 'Available'
  const held = trips.filter((t) => reserves(t) && t.vehicle_id === vehicle.id).map(spanOf).filter((x) => overlap(x, { s, e }))
  if (!held.length) return 'Available'
  // the day is Booked only when the reservations leave no gap in it
  const sorted = held.map((x) => ({ s: Math.max(x.s, s), e: Math.min(x.e, e) })).sort((a, b) => a.s - b.s)
  let reach = s
  for (const x of sorted) {
    if (x.s > reach) return 'Partly booked'
    reach = Math.max(reach, x.e)
  }
  return reach >= e ? 'Booked' : 'Partly booked'
}

export const AVAILABILITY_TONE: Record<DayAvailability, Tone> = {
  Available: 'mint', 'Partly booked': 'amber', Booked: 'blue', Maintenance: 'peach', 'Out of service': 'grey',
}

export type Booking = { trip_id: string; line: string }

/** A vehicle's reservations on a day: '16:00–17:30 · Grocery shopping'. */
export function bookingsOn(vehicle: Vehicle, trips: Trip[], day: string): Booking[] {
  return chipsFor(trips, day, [vehicle], new Set([vehicle.id])).map((c) => ({ trip_id: c.id, line: `${c.time} · ${c.text}` }))
}

/* ---------- the history ---------- */

export const STATUS_ORDER: readonly string[] = ['Requested', 'Needs assignment', 'Scheduled', 'In use', 'Completed', 'Declined', 'Cancelled']

export const tripText = (t: Trip): string => [
  t.client_name, t.purpose, t.trip_type, t.destination, t.staff_name, t.driver_name, t.requested_by.name,
  t.vehicle_name, t.requested_vehicle_name, t.word, t.day, dayLabel(t.day), t.details,
].join(' ').toLowerCase()

/** Every trip, newest start first, narrowed by the search box and the status select ('' = all). */
export function historyRows(trips: Trip[], search: string, status: string): Trip[] {
  const words = String(search ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return trips
    .filter((t) => (!status || t.word === status) && words.every((w) => tripText(t).includes(w)))
    .sort((a, b) => b.start_at.localeCompare(a.start_at) || b.id.localeCompare(a.id))
}

/** The statuses the select offers: the ones present, in the screen's order. */
export function statusesIn(trips: Trip[]): string[] {
  const present = new Set(trips.map((t) => t.word).filter(Boolean))
  return [...STATUS_ORDER.filter((s) => present.has(s)), ...[...present].filter((s) => !STATUS_ORDER.includes(s))]
}

/* ---------- the request form ---------- */

export type RequestForm = {
  vehicle_id: string
  staff_key: string
  start: string
  end: string
  client_key: string
  trip_type: string
  details: string
  wheelchair_required: boolean
}

export type RequestField = 'vehicle_id' | 'staff_key' | 'start' | 'end' | 'trip_type' | 'details'
export const MAX_DAYS = 14
export const MAX_DETAILS = 1000

/** The trip types a client's own page offers (Clients › Transportation); Other is filled in and sent as "Other: …". */
export const CLIENT_TRIP_TYPES = ['Dr Appointment', 'Chores', 'Community Outing'] as const
export const OTHER_TRIP = 'Other'

/** The trip type a client's form sends: the type chosen, or Other with what was filled in ('' until it is). */
export function clientTripType(chosen: string, other: string): string {
  if (chosen !== OTHER_TRIP) return chosen
  const said = other.trim()
  return said ? `Other: ${said}` : ''
}

/** The form's own checks, said by field before anything is sent; the server checks again. */
export function requestErrors(form: RequestForm, vehicles: Vehicle[] = []): Partial<Record<RequestField, string>> {
  const out: Partial<Record<RequestField, string>> = {}
  const vehicle = vehicles.find((v) => v.id === form.vehicle_id)
  if (!form.vehicle_id) out.vehicle_id = 'Choose a vehicle.'
  else if (vehicles.length && !vehicle) out.vehicle_id = 'Choose a vehicle.'
  else if (vehicle && vehicle.availability !== 'available') {
    out.vehicle_id = `${cap(nameOf(vehicle))} is ${vehicle.availability === 'maintenance' ? 'in maintenance' : 'out of service'} — choose another vehicle.`
  } else if (vehicle && form.wheelchair_required && !vehicle.wheelchair_accessible) {
    const fits = vehicles.filter((v) => v.wheelchair_accessible).map((v) => nameOf(v))
    out.vehicle_id = `${cap(nameOf(vehicle))} is not wheelchair accessible${fits.length ? ` — choose ${fits.join(' or ')}` : ''}.`
  }
  if (!form.staff_key) out.staff_key = 'Choose a staff member.'
  const s = wallToMs(form.start)
  const e = wallToMs(form.end)
  if (!form.start) out.start = 'Choose the start date and time.'
  else if (!Number.isFinite(s)) out.start = 'That time does not exist in Eastern Time (the clocks jump forward).'
  if (!form.end) out.end = 'Choose the end date and time.'
  else if (!Number.isFinite(e)) out.end = 'That time does not exist in Eastern Time (the clocks jump forward).'
  else if (Number.isFinite(s) && e <= s) out.end = 'The end must be after the start.'
  else if (Number.isFinite(s) && e - s > MAX_DAYS * 86_400_000) out.end = `A reservation can be at most ${MAX_DAYS} days.`
  if (!form.trip_type) out.trip_type = 'Choose a trip type.'
  if (form.details.length > MAX_DETAILS) out.details = `Trip details can be at most ${MAX_DETAILS} characters.`
  return out
}

/* ---------- words, tones and tints ---------- */

/** The pill classes a tone draws with. */
export const TONE_PILL: Record<Tone, string> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  amber: 'bg-tint-amber text-tint-fg-amber',
  peach: 'bg-tint-peach text-tint-fg-peach',
  blue: 'bg-tint-blue text-tint-fg-blue',
  grey: 'bg-tint-slate text-tint-fg-slate',
  rose: 'bg-tint-danger text-tint-fg-danger',
}

/** A vehicle's tint as the platform's tint pairs name it. */
export const TINT: Record<VehicleTint, TintName> = {
  blue: 'blue', mint: 'mint', peach: 'peach', lilac: 'lavender', amber: 'amber', rose: 'pink',
}

/** The three figures over History and Vehicles. */
export function kpiItems(board: Board): { key: keyof Kpis; label: string; value: number }[] {
  return [
    { key: 'needs_assignment', label: 'Needs assignment', value: board.kpis.needs_assignment },
    { key: 'scheduled', label: 'Scheduled trips', value: board.kpis.scheduled },
    { key: 'in_service', label: 'Vehicles in service', value: board.kpis.in_service },
  ]
}

/** 'Vehicles · 2 of 3'. */
export const vehicleFilterLabel = (shown: ReadonlySet<string> | null, vehicles: Vehicle[]): string =>
  `Vehicles · ${shown ? vehicles.filter((v) => shown.has(v.id)).length : vehicles.length} of ${vehicles.length}`

/** Who a waiting request waits on, by name. */
export function waitingOn(trip: Trip, settings: Settings): string[] {
  const named = trip.seats.filter((s) => s.state === 'waiting').flatMap((s) => s.to)
  if (named.length) return [...new Set(named)]
  return settings.directors.filter((d) => d.uid !== trip.requested_by.uid).map((d) => d.name)
}

/** Names joined as people say them: 'Ty Bond and Brittany Anderson'. */
export function namesWords(names: string[]): string {
  const n = names.filter(Boolean)
  if (n.length <= 1) return n[0] ?? ''
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

export type StepState = 'done' | 'waiting' | 'refused' | 'na'
export type Step = { id: string; label: string; state: StepState; note?: string }

/** Requested → Directors → On the calendar, as the trip stands. */
export function stepsOf(trip: Trip, settings: Settings): Step[] {
  const requested: Step = { id: 'requested', label: 'Requested', state: 'done', note: trip.requested_by.name }
  const decided = trip.decided_by ? `${trip.state === 'declined' ? 'Declined' : 'Approved'} by ${trip.decided_by}` : ''
  if (trip.state === 'requested') {
    return [requested, { id: 'directors', label: 'Directors', state: 'waiting', note: `Waiting on ${namesWords(waitingOn(trip, settings))}` },
      { id: 'calendar', label: 'On the calendar', state: 'na' }]
  }
  if (trip.state === 'declined') {
    return [requested, { id: 'directors', label: 'Declined', state: 'refused', note: decided }, { id: 'calendar', label: 'On the calendar', state: 'na' }]
  }
  if (trip.state === 'cancelled') {
    const answered = Boolean(trip.decided_by)
    return [requested, { id: 'directors', label: 'Directors', state: answered ? 'done' : 'na', note: decided },
      { id: 'calendar', label: 'Cancelled', state: 'refused' }]
  }
  const directors: Step = { id: 'directors', label: 'Directors', state: 'done', note: decided }
  if (trip.state === 'needs_assignment') {
    return [requested, directors, { id: 'calendar', label: 'Needs a vehicle', state: 'waiting', note: trip.assign_note }]
  }
  return [requested, directors, { id: 'calendar', label: 'On the calendar', state: 'done', note: trip.vehicle_name }]
}

/** The address of a client's Transportation section. */
export const clientHref = (key: string): string =>
  `/app/client-profiles/profile?client=${encodeURIComponent(key)}&tab=transportation`

/** The sentence a source that did not read gets, or ''. */
export function sourceLines(board: Board): string[] {
  const label: Record<string, string> = {
    vehicles: 'The vehicles', trips: 'The trips', inbox: 'The approvals', settings: 'The settings',
    people: 'The staff list', clients: 'The client list', drivers: 'The driver records',
  }
  return board.sources.filter((s) => s.state !== 'ready')
    .map((s) => `${label[s.key] ?? s.key} could not be read${s.why ? ` — ${s.why.replace(/\.$/, '')}` : ''}.`)
}
