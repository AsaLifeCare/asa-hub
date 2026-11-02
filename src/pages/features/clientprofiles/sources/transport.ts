// Clients › Transportation: the reader for `clientSourceTransport` and the model that turns its answer into the…
// The door is master-only Apps Script; this side draws what it answers and says why when a source did not read — a…
import { useCallback, useEffect, useRef, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'
import { onMemoryBoundary } from '@/lib/appPack'
import { ohioToday } from '@/lib/ohio'
import { clientPackOr } from '../clientReads'
import { unknownActionWords } from '../clientViewer'

export const TRANSPORT_ACTION = 'clientSourceTransport'

/** The section's three tabs; the PSI shifts that logged transportation units are a line under History. */
export type TransportView = 'calendar' | 'history' | 'vehicles'
export const TRANSPORT_VIEWS: readonly { id: TransportView; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'history', label: 'History' },
  { id: 'vehicles', label: 'Vehicles' },
]

export const TRIP_STATUSES = ['Needs assignment', 'Scheduled', 'Completed', 'Check date', 'No booking', 'Cancelled'] as const
export const AVAILABILITY = ['Available', 'Partly Booked', 'Booked', 'Maintenance'] as const

export type Trip = {
  id: string; record: string; date: string; details: string; status: string
  time: string; end_time: string; reserved_time: string; destination: string; reason: string
  staff: string; requested_at: string; requested_on: string; vehicle: string; assignment: string
  requests: number; conflict: string; conflict_time: string; source: string; sheet_row: number
  dr_name: string; dr_address: string; visit_id: string; book_status: string; realigned: boolean
}
export type CalendarTrip = Pick<Trip, 'id' | 'record' | 'date' | 'details' | 'status' | 'time' | 'end_time' | 'vehicle' | 'destination'>
export type Booking = { time: string; end_time: string; mine: boolean; trip_id: string; record: string; destination: string; who: string }
export type Repair = { id: string; date: string; issue: string; repair_type: string; status: string; resolution: string }
export type Fleet = { unit: string; vehicle: string; year: string; plate: string; status: string }
export type Vehicle = {
  id: string; record: string; vehicle: string; date: string; details: string; status: string
  requests_total: number; clients_total: number; first_date: string; last_date: string
  bookings: Booking[]; maintenance: Repair[]; repairs: Repair[]; fleet: Fleet | null
}
export type MileRow = {
  id: string; record: string; date: string; details: string; status: string; units: number
  employee: string; start_time: string; end_time: string; hours: string; work_code: string; psi_status: string
}
export type Conflict = { date: string; time: string; status: string; notes: string }
export type Source = { id: string; label: string; rows: number | null; realigned: number; why: string }

type TabBase<R, K> = { rows: R[]; kpis: K | null; why: string; as_of: string; note: string }
export type CalendarKpis = { trips: number; upcoming: number; vehicles: number }
export type HistoryKpis = { needs_assignment: number; scheduled: number; completed: number }
export type VehicleKpis = { vehicles: number; available: number; partly_booked: number; booked: number; maintenance: number }
export type MileKpis = { shifts: number; units: number; first: string; last: string }

export type TransportAnswer = {
  client: { client_key: string; name: string }
  today: string
  date: string
  rule: string
  degraded: boolean
  sources: Source[]
  calendar: TabBase<CalendarTrip, CalendarKpis> & { vehicles: string[]; range: { first: string; last: string } | null }
  history: TabBase<Trip, HistoryKpis> & { statuses: string[]; conflicts: Conflict[]; rule: string }
  vehicles: TabBase<Vehicle, VehicleKpis> & { date: string; window: { start: string; end: string } | null; statuses: string[]; rule: string }
  mileage: TabBase<MileRow, MileKpis>
}

/* ---------- the door ---------- */

/** The pack's part answers today only: one gathered on another day is not today's. */
const packToday = (part: unknown): boolean =>
  !!part && typeof part === 'object' && (part as { today?: unknown }).today === ohioToday()

// One read of the client's transport; `date` (yyyy-mm-dd) picks the fleet's day, '' is the door's today — which the…
export const readTransport = (client: string, date = '') =>
  date ? gasAction<unknown>(TRANSPORT_ACTION, { client, date })
    : clientPackOr(client, 'transport', () => gasAction<unknown>(TRANSPORT_ACTION, { client }), packToday)

export const NOT_PUBLISHED = 'The server did not recognise this read: Clients answers once the platform release that carries it is live.'

/** A refusal as a sentence. "Unknown action." is a door shut to this account, or to the master a deployment without it. */
export function transportRefusal(error: string): string {
  return unknownActionWords(error, NOT_PUBLISHED) ?? (error || 'The read did not answer.')
}

/* ---------- the answer, typed ---------- */

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {})
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => list(v).map(str).filter(Boolean)
const nullable = <T>(v: unknown, fn: (o: Obj) => T): T | null => (v && typeof v === 'object' ? fn(v as Obj) : null)

function tripOf(v: unknown): Trip {
  const o = obj(v)
  return {
    id: str(o.id), record: str(o.record), date: str(o.date), details: str(o.details), status: str(o.status),
    time: str(o.time), end_time: str(o.end_time), reserved_time: str(o.reserved_time), destination: str(o.destination),
    reason: str(o.reason), staff: str(o.staff), requested_at: str(o.requested_at), requested_on: str(o.requested_on),
    vehicle: str(o.vehicle), assignment: str(o.assignment), requests: num(o.requests) || 1, conflict: str(o.conflict),
    conflict_time: str(o.conflict_time), source: str(o.source), sheet_row: num(o.sheet_row), dr_name: str(o.dr_name),
    dr_address: str(o.dr_address), visit_id: str(o.visit_id), book_status: str(o.book_status), realigned: o.realigned === true,
  }
}

const calendarTripOf = (v: unknown): CalendarTrip => {
  const o = obj(v)
  return { id: str(o.id), record: str(o.record), date: str(o.date), details: str(o.details), status: str(o.status),
    time: str(o.time), end_time: str(o.end_time), vehicle: str(o.vehicle), destination: str(o.destination) }
}

const repairOf = (v: unknown): Repair => {
  const o = obj(v)
  return { id: str(o.id), date: str(o.date), issue: str(o.issue), repair_type: str(o.repair_type), status: str(o.status),
    resolution: str(o.resolution) }
}

function vehicleOf(v: unknown): Vehicle {
  const o = obj(v)
  return {
    id: str(o.id), record: str(o.record), vehicle: str(o.vehicle), date: str(o.date), details: str(o.details), status: str(o.status),
    requests_total: num(o.requests_total), clients_total: num(o.clients_total), first_date: str(o.first_date), last_date: str(o.last_date),
    bookings: list(o.bookings).map((b) => {
      const x = obj(b)
      return { time: str(x.time), end_time: str(x.end_time), mine: x.mine === true, trip_id: str(x.trip_id), record: str(x.record),
        destination: str(x.destination), who: str(x.who) }
    }),
    maintenance: list(o.maintenance).map(repairOf),
    repairs: list(o.repairs).map(repairOf),
    fleet: nullable(o.fleet, (f) => ({ unit: str(f.unit), vehicle: str(f.vehicle), year: str(f.year), plate: str(f.plate), status: str(f.status) })),
  }
}

function mileOf(v: unknown): MileRow {
  const o = obj(v)
  return {
    id: str(o.id), record: str(o.record), date: str(o.date), details: str(o.details), status: str(o.status), units: num(o.units),
    employee: str(o.employee), start_time: str(o.start_time), end_time: str(o.end_time), hours: str(o.hours),
    work_code: str(o.work_code), psi_status: str(o.psi_status),
  }
}

function base<R, K>(t: Obj, row: (v: unknown) => R, kpis: (o: Obj) => K): TabBase<R, K> {
  return { rows: list(t.rows).map(row), kpis: nullable(t.kpis, kpis), why: str(t.why), as_of: str(t.as_of), note: str(t.note) }
}

export function transportOf(raw: unknown): TransportAnswer {
  const a = obj(raw)
  const tabs = obj(a.tabs)
  const cal = obj(tabs.calendar), his = obj(tabs.history), veh = obj(tabs.vehicles), mil = obj(tabs.mileage)
  const client = obj(a.client)
  return {
    client: { client_key: str(client.client_key), name: str(client.name) },
    today: str(a.today), date: str(a.date), rule: str(a.rule), degraded: a.degraded === true,
    sources: list(a.sources).map((s) => {
      const o = obj(s)
      return { id: str(o.id), label: str(o.label), rows: o.rows === null || o.rows === undefined ? null : num(o.rows),
        realigned: num(o.realigned), why: str(o.why) }
    }),
    calendar: {
      ...base(cal, calendarTripOf, (k) => ({ trips: num(k.trips), upcoming: num(k.upcoming), vehicles: num(k.vehicles) })),
      vehicles: strs(cal.vehicles),
      range: nullable(cal.range, (r) => ({ first: str(r.first), last: str(r.last) })),
    },
    history: {
      ...base(his, tripOf, (k) => ({ needs_assignment: num(k.needs_assignment), scheduled: num(k.scheduled), completed: num(k.completed) })),
      statuses: strs(his.statuses),
      conflicts: list(his.conflicts).map((c) => {
        const o = obj(c)
        return { date: str(o.date), time: str(o.time), status: str(o.status), notes: str(o.notes) }
      }),
      rule: str(his.rule),
    },
    vehicles: {
      ...base(veh, vehicleOf, (k) => ({ vehicles: num(k.vehicles), available: num(k.available), partly_booked: num(k.partly_booked),
        booked: num(k.booked), maintenance: num(k.maintenance) })),
      date: str(veh.date), window: nullable(veh.window, (w) => ({ start: str(w.start), end: str(w.end) })),
      statuses: strs(veh.statuses), rule: str(veh.rule),
    },
    mileage: base(mil, mileOf, (k) => ({ shifts: num(k.shifts), units: num(k.units), first: str(k.first), last: str(k.last) })),
  }
}

/* ---------- what the section draws ---------- */

export type Kpi = { label: string; value: string }

const count = (n: number | undefined, kpis: unknown) => (kpis ? String(n ?? 0) : '—')

/** The mockup's cards per view; a tab whose source did not read shows '—', never a zero. */
export function transportKpis(a: TransportAnswer, view: TransportView | 'mileage'): Kpi[] {
  if (view === 'vehicles') {
    const k = a.vehicles.kpis
    return [
      { label: 'Fleet vehicles', value: count(k?.vehicles, k) },
      { label: `Available on ${dayLabel(a.vehicles.date || a.date)}`, value: count(k?.available, k) },
      { label: 'In maintenance', value: count(k?.maintenance, k) },
    ]
  }
  if (view === 'mileage') {
    const k = a.mileage.kpis
    return [
      { label: 'Shifts with transportation', value: count(k?.shifts, k) },
      { label: 'Transportation units', value: k ? String(k.units) : '—' },
      { label: 'Latest shift', value: k ? (k.last ? dayLabel(k.last) : 'None') : '—' },
    ]
  }
  const k = a.history.kpis
  return [
    { label: 'Needs assignment', value: count(k?.needs_assignment, k) },
    { label: 'Scheduled trips', value: count(k?.scheduled, k) },
    { label: 'Completed trips', value: count(k?.completed, k) },
  ]
}

export type Tint = 'mint' | 'amber' | 'danger' | 'slate' | 'blue'
const TINT: Record<string, Tint> = {
  Scheduled: 'blue', Completed: 'mint', 'Needs assignment': 'amber', 'Check date': 'danger', 'No booking': 'slate',
  Cancelled: 'slate', Available: 'mint', 'Partly Booked': 'amber', Booked: 'blue', Maintenance: 'danger', Logged: 'slate',
}
export const statusTint = (status: string): Tint => TINT[status] ?? 'slate'

/** The search box and the "All statuses" select, over whatever text the row shows. */
export function filterRows<T extends { status: string }>(rows: T[], query: string, status: string, text: (row: T) => string): T[] {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => (!status || r.status === status) && (!q || text(r).toLowerCase().includes(q)))
}

export const tripText = (t: Trip) =>
  [t.record, t.destination, t.dr_name, t.dr_address, t.staff, t.vehicle, t.status, t.reserved_time, t.date, dayLabel(t.date)].join(' ')
export const mileText = (m: MileRow) => [m.record, m.details, m.date, dayLabel(m.date), m.work_code].join(' ')
export const vehicleText = (v: Vehicle) => [v.vehicle, v.details, v.status].join(' ')

/** The statuses a view's select offers: the ones present, in the door's order. */
export function statusesIn<T extends { status: string }>(rows: T[], order: readonly string[]): string[] {
  const present = new Set(rows.map((r) => r.status).filter(Boolean))
  return [...order.filter((s) => present.has(s)), ...[...present].filter((s) => !order.includes(s))]
}

/* ---------- days and the month grid ---------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-09-30" → "Sep 30, 2026"; anything else as given. */
export function dayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${Number(m[3])}, ${m[1]}`
}

export const monthOf = (iso: string) => (/^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : '')

export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : month
}

export function shiftMonth(month: string, by: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return month
  const n = Number(m[1]) * 12 + Number(m[2]) - 1 + by
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
}

/** The month as weeks from Sunday: each cell a yyyy-mm-dd, or '' outside the month. */
export function monthWeeks(month: string): string[][] {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return []
  const y = Number(m[1]), mo = Number(m[2])
  const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const cells: string[] = Array.from({ length: first }, () => '')
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7) cells.push('')
  const weeks: string[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** The trips on one day, with the vehicle filter ('' = All vehicles), in clock order as the door sent them. */
export function tripsOn(rows: CalendarTrip[], day: string, vehicle: string): CalendarTrip[] {
  return rows.filter((t) => t.date === day && (!vehicle || t.vehicle === vehicle))
}

export const tripById = (a: TransportAnswer, id: string): Trip | null => a.history.rows.find((t) => t.id === id) ?? null

/** History's line for the PSI shifts with this client that logged transportation units; '' when there are none. */
export function mileageLine(a: TransportAnswer): string {
  const k = a.mileage.kpis
  if (!k) return a.mileage.why ? `The PSI shifts with transportation units were not read: ${a.mileage.why}.` : ''
  if (!k.shifts) return ''
  const shifts = `${k.shifts} PSI shift${k.shifts === 1 ? '' : 's'}`
  const units = `${k.units} transportation unit${k.units === 1 ? '' : 's'}`
  return `${shifts} with this client logged ${units}${k.last ? `, the latest on ${dayLabel(k.last)}` : ''}.`
}

/** The panel as the page's address carries it: 'trip~<id>', 'vehicle~<id>' or 'sources'. */
/** A trip's type as recorded: a van-required Dr visit is a Dr Appointment; any other trip says its own. */
export const tripTypeOf = (t: Pick<Trip, 'source' | 'reason'>): string => (t.source === 'dr_visits' ? 'Dr Appointment' : t.reason)

/** `trip-new`'s day: the calendar day pressed, the trip's start day. */
export type TransportPanel = { kind: 'trip' | 'vehicle'; id: string } | { kind: 'sources' } | { kind: 'trip-new'; day?: string }

export function transportPanelParam(ask: TransportPanel | null): string {
  if (!ask) return ''
  if (ask.kind === 'trip-new') return ask.day ? `trip-new~${ask.day}` : 'trip-new'
  return ask.kind === 'sources' ? 'sources' : `${ask.kind}~${ask.id}`
}

export function transportPanelOf(v: string | null | undefined): TransportPanel | null {
  const s = String(v ?? '')
  if (s === 'sources') return { kind: 'sources' }
  const asked = /^trip-new(?:~(\d{4}-\d{2}-\d{2}))?$/.exec(s)
  if (asked) return asked[1] ? { kind: 'trip-new', day: asked[1] } : { kind: 'trip-new' }
  const m = /^(trip|vehicle)~(.+)$/.exec(s)
  return m ? { kind: m[1] as 'trip' | 'vehicle', id: m[2] } : null
}

export function bookingLine(b: Booking): string {
  const clock = b.end_time ? `${b.time} – ${b.end_time}` : b.time
  return [clock, b.mine ? b.record || 'This client' : b.who].filter(Boolean).join(' · ')
}

export function sourceLine(s: Source): string {
  if (s.rows === null) return `${s.label}: not read — ${s.why || 'no answer'}`
  return `${s.label}: ${s.rows} row${s.rows === 1 ? '' : 's'}${s.realigned ? ` (${s.realigned} read one column over)` : ''}`
}

/* ---------- the read ---------- */

export type TransportRead = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  data: TransportAnswer | null
  error: string
  refreshing: boolean
  reload: () => void
}

const FRESH_MS = 60_000
type Entry = { at: number; data: TransportAnswer | null; error: string; inflight: Promise<void> | null }
const READS = new Map<string, Entry>()
export const transportKey = (client: string, date: string) => `${TRANSPORT_ACTION}|${client}|${date}`
// bumped at a memory boundary (another account, a visit, a tenant or a world): nothing asked before it is kept after it
let readsEpoch = 0
export function forgetTransportReads(): void { READS.clear() }

onMemoryBoundary(() => {
  readsEpoch++
  READS.clear()
})

const WRITTEN = new Set<(client: string) => void>()

/** A write landed for this client (an appointment's day or van): every day held for it is stale, and one on screen reads again. */
export function transportWritten(client: string): void {
  for (const [k, e] of [...READS]) if (k.split('|')[1] === client) READS.set(k, { ...e, at: 0 })
  for (const fn of [...WRITTEN]) fn(client)
}

function fetchInto(key: string, client: string, date: string): Promise<void> {
  const held = READS.get(key) ?? { at: 0, data: null, error: '', inflight: null }
  if (held.inflight) return held.inflight
  const asked = readsEpoch
  const p = readTransport(client, date)
    .then((raw) => {
      if (asked === readsEpoch) READS.set(key, { at: Date.now(), data: transportOf(raw), error: '', inflight: null })
    })
    .catch((e: unknown) => {
      if (asked !== readsEpoch) return
      const was = READS.get(key)
      READS.set(key, { at: was?.at ?? 0, data: was?.data ?? null, error: transportRefusal(e instanceof Error ? e.message : String(e)), inflight: null })
    })
  READS.set(key, { ...held, inflight: p })
  return p
}

/** A trip changed for the client: every day held goes stale and today's read is awaited; a failed read throws its words. */
export async function rereadTransport(client: string): Promise<void> {
  transportWritten(client)
  const key = transportKey(client, '')
  await fetchInto(key, client, '')
  const error = READS.get(key)?.error
  if (error) throw new Error(error)
}

/** 60 s fresh per client and day; one request in flight per key; a failed refresh keeps the rows before it. */
export function useTransportRead(client: string, date: string): TransportRead {
  const key = transportKey(client, date)
  const [, bump] = useState(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // another account, a visit, a tenant or a world: nothing drawn for the one before, and read again
  const [crossed, setCrossed] = useState(0)
  useEffect(() => onMemoryBoundary(() => setCrossed((n) => n + 1)), [])
  const start = useCallback((force: boolean): boolean => {
    if (!client) return false
    const held = READS.get(key)
    if (!force && held && !held.error && Date.now() - held.at < FRESH_MS) return false
    if (force && held) READS.set(key, { ...held, at: 0 })
    void fetchInto(key, client, date).then(() => { if (alive.current) bump((n) => n + 1) })
    return true
  }, [client, date, key])
  useEffect(() => { start(false) }, [start, crossed])
  useEffect(() => {
    const fn = (c: string) => { if (c === client && start(true)) bump((n) => n + 1) }
    WRITTEN.add(fn)
    return () => { WRITTEN.delete(fn) }
  }, [client, start])
  const held = READS.get(key)
  const reload = useCallback(() => { if (start(true)) bump((n) => n + 1) }, [start])
  if (!client) return { status: 'idle', data: null, error: '', refreshing: false, reload }
  if (!held) return { status: 'loading', data: null, error: '', refreshing: true, reload }
  const refreshing = !!held.inflight
  if (held.error && !refreshing) return { status: 'failed', data: held.data, error: held.error, refreshing: false, reload }
  if (held.data) return { status: 'ready', data: held.data, error: '', refreshing, reload }
  return { status: 'loading', data: null, error: '', refreshing, reload }
}
