/**
 * CLIENTS › TRANSPORTATION · the section and its door together. Every call the section makes is caught at `fetch`
 * and handed to Apps Script's own ClientSourceTransport.gs, run here over in-memory stand-ins for the Van Calendar
 * book (its display values, rows one cell short included), the Hub form, Dr Appt Archive, Repairs, the fleet list
 * and the PSI punches. The answer is read by the section's own reader and model and drawn by its own components.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import {
  NOT_PUBLISHED, TRANSPORT_ACTION, dayLabel, filterRows, forgetTransportReads, monthWeeks, readTransport, shiftMonth,
  statusesIn, transportKpis, transportOf, transportPanelOf, transportPanelParam, tripText, tripsOn, useTransportRead,
  type TransportAnswer, type TransportRead,
} from '@/pages/features/clientprofiles/sources/transport'
import { TransportBody, TransportPanel, type TransportAsk } from '@/pages/features/clientprofiles/sources/TransportTab'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'
import { clientTripType } from '@/pages/features/vehiclecalendar/vehicleCalendarModel'
import { clientWritten } from '@/pages/features/clientprofiles/useClientRead'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const FEATURE = 'src/pages/features/clientprofiles/sources'
const gsText = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(node as never))
const noop = () => {}

function lift(file: string, name: string): string {
  const src = gsText(file)
  const at = src.indexOf(`\nfunction ${name}(`)
  assert.notEqual(at, -1, `${file} has no ${name}`)
  return src.slice(at + 1, src.indexOf('\n}', at + 1) + 2)
}

/* ---------- the stores ---------- */

type Row = Record<string, unknown>
type Grid = string[][]

const HEAD = ['Status', 'Event ID', 'Select Vehicle', 'Timestamp', 'Your Name', 'Client Name', 'Date (Day Client Needs the Van)',
  'Start Time', 'End Time', 'Why does the client need the van?', 'Destination Address']

function freshStores() {
  return {
    requests: [
      HEAD,
      ['', '', 'Wheelchair Van - 1', '10/16/2025', 'Dee Staff', 'Kenny Marsh', '10/16/2025', '5:30:00 PM', '8:00:00 PM', 'Social', 'Bingo'],
      ['New', '', 'Wheelchair Van - 1', '11/5/2025 10:14:07', '', 'Kenny Marsh', '11/17/2025', '9:45:00 AM', '11:45:00 AM', 'Dr. Adler Appt', '4100 Test Clinic Rd'],
      // the rows the book writes one cell short at Event ID
      ['New', 'Wheelchair Van - 1', '11/5/2025 10:14:07', '', 'Kenny Marsh', '11/17/2025', '9:45:00 AM', '', 'Dr. Adler Appt', '4100 Test Clinic Rd'],
      ['New', 'Wheelchair Van - 1', '9/20/2026 10:00:00', '', 'Kenny Marsh', '10/2/2026', '9:45:00 AM', '', 'Dr. Carver Appt', '4900 Sample Ave'],
      ['New', 'Wheelchair Van - 1', '9/23/2026 19:05:41', '', 'Kenny Marsh', '1/15/2026', '11:00:00 AM', '', 'Dr. Brandt Appt', '1300 Example Dr'],
      ['New', 'Wheelchair Van - 1', '9/21/2026 8:00:00', '', 'Lia Gomez', '10/2/2026', '9:45:00 AM', '8:00:00 PM', 'Dr. Private Clinic Appt', '1 Hidden Rd'],
      ['', '', 'Wheelchair Van - 1', '9/22/2026', 'Dee Staff', 'Kenny Marsh', '10/9/2026', '5:30:00 PM', '6:00:00 PM', 'Social', 'Bar'],
    ] as Grid,
    conflicts: [
      ['Status', 'Date', 'Clients in Conflict', 'Conflict Time', 'Notes'],
      ['Unresolved', '10/9/2026', 'Lia Gomez, Kenny Marsh', '5:30 PM - 6:00 PM', ''],
    ] as Grid,
    bookOpens: true,
    form: [
      { id: 'S1', form_slug: 'van-calendar-2', submitted_at: '2026-09-25T12:00:00Z', state: 'new',
        answers: JSON.stringify({ select_vehicle: 'Wheelchair Van - 1', your_name: 'Eve Form', client_name: 'Kenny Marsh',
          date_day_client_needs_the_van: '2026-10-20', start_time: '10:00', end_time: '11:00',
          why_does_the_client_need_the_van: 'Chores', destination_address: 'Store' }) },
      { id: 'S9', form_slug: 'house-repair', submitted_at: '2026-09-25T12:00:00Z', answers: '{}' },
    ] as Row[],
    visits: [
      { id: 'r7', client_name: 'Kenny Marsh', dr_name: 'Dr Carver', appointment_address: '4900 Sample Ave', appointment_date: '10/2/2026',
        appointment_start_time: '9:45 AM', wheelchair_van_required: 'Yes', manager: 'Max Manager', timestamp: '2026-09-19T12:00:00Z' },
      { id: 'r8', client_name: 'kenny  marsh', dr_name: 'Dr Future', appointment_address: '9 Future Rd', appointment_date: '2026-11-03T05:00:00.000Z',
        appointment_start_time: '13:30', wheelchair_van_required: 'Yes', timestamp: '2026-09-20T12:00:00Z' },
      { id: 'r9', client_name: 'Kenny Marsh', dr_name: 'Dr Walk', appointment_address: '1 Walk Rd', appointment_date: '10/5/2026',
        appointment_start_time: '10:00', wheelchair_van_required: 'No' },
    ] as Row[],
    repairs: [
      { id: 'r2', select_address_vehicle: 'Wheelchair Van', please_describe_the_issue: 'Oil change light on', status: 'In Progress',
        repair_type: 'Other', timestamp: '2026-10-01T14:00:00.000Z', resolution_notes: 'Booked at the dealer' },
      { id: 'r3', select_address_vehicle: '908 Arlington Ave NW', status: '', timestamp: '2026-09-01T14:00:00.000Z' },
    ] as Row[],
    punches: [
      { id: 'p1', employee: 'Ann Aide', date_iso: '2026-09-21', start_time: '01:57:00 PM', end_time: '10:00:00 PM', hours: '8.05',
        transportation_units: '10.00', work_code: 'HPC', status: 'I', consumer_1: 'Kenny, Marsh', comments: 'private words' },
      { id: 'p2', employee: 'Ann Aide', date_iso: '2026-09-22', transportation_units: '0.00', consumer_1: 'Kenny, Marsh' },
      { id: 'p3', employee: 'Ben Aide', date_iso: '2026-09-23', transportation_units: '40.00', consumer_1: 'Lia, Gomez' },
    ] as Row[] | null,
  }
}

let S = freshStores()

function sheetOf(grid: Grid) {
  const w = Math.max(...grid.map((r) => r.length))
  return { getDataRange: () => ({ getDisplayValues: () => grid.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? '')) }) }
}

/* ---------- Apps Script, booted ---------- */

type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; roles: string[]; params?: Record<string, unknown> }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => unknown>
  CS_TRANSPORT_ACTIONS: string[]
}

function boot(): Gs {
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {},
    Utilities: {
      formatDate: (d: Date, tz: string, pattern: string) => {
        if (pattern !== 'yyyy-MM-dd') throw new Error(`formatDate ${pattern} is not stood in for`)
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
      },
    },
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'boss@example.org' && !u.visiting_member && !u.is_service,
    hubQuietNow_: () => new Date('2026-09-28T15:00:00Z'),
    hubProp_: () => '',
    clientsDerived_: () => [
      { client_key: 'kenny_marsh', name: 'Kenny Marsh', medications: ['Secret pill'] },
      { client_key: 'liagomez', name: 'Lia Gomez' },
    ],
    ssOpen_: () => {
      if (!S.bookOpens) throw new Error('You do not have permission to access the requested document.')
      return { getSheetByName: (t: string) => (t === 'Requests' ? sheetOf(S.requests) : t === 'Conflicts' ? sheetOf(S.conflicts) : null) }
    },
    estateRows_: (r: string) => (r === 'drVisits' ? S.visits : r === 'workOrders' ? S.repairs : []),
    listRows_: (r: string) => (r === 'formSubmissions' ? S.form : []),
    psiPunchesFullSheet_: () => (S.punches ? {} : null),
    psiPunchesRows_: () => ({ rows: S.punches ?? [] }),
  }
  const ctx = vm.createContext(g)
  vm.runInContext(lift('Clients.gs', 'clientNameKey_'), ctx)
  vm.runInContext(gsText('ClientSourceTransport.gs'), ctx)
  return ctx as unknown as Gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin' }
let caller: Row = MASTER
const calls: { action: string; payload: Row }[] = []
const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Row }
    calls.push({ action: env.action, payload: env.payload ?? {} })
    const door = GS.HUB_ACTIONS[env.action]
    const out = door ? door(JSON.parse(JSON.stringify(env.payload ?? {})), caller) : { status: 404, message: 'Unknown action.' }
    return new Response(JSON.stringify(out))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  S = freshStores()
  caller = MASTER
  forgetTransportReads()
})

const read = async (date = '') => transportOf(await readTransport('kenny_marsh', date))

describe('the names', () => {
  it('the section names one door, declared in ClientSourceTransport.gs as a read the gate opens, and in the catalogue', () => {
    const named = new Set<string>()
    // the other sources share the folder; this section is its own two files
    for (const f of ['transport.ts', 'TransportTab.tsx']) {
      const text = readFileSync(resolve(ROOT, FEATURE, f), 'utf8')
      for (const m of text.matchAll(/gasAction(?:<[^>]*>)?\(\s*(?:'([A-Za-z]+)'|TRANSPORT_ACTION)/g)) named.add(m[1] ?? TRANSPORT_ACTION)
    }
    assert.deepEqual([...named], ['clientSourceTransport'])
    assert.deepEqual([...GS.CS_TRANSPORT_ACTIONS], ['clientSourceTransport'])
    const p = GS.HUB_POLICY.clientSourceTransport
    assert.deepEqual([p.file, p.lane, p.roles.join()],
      ['ClientSourceTransport.gs', 'read', 'admin,director,manager,staff,client,onboarding,interviewer'])
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    assert.ok(catalogue.includes('"clientSourceTransport"'), 'the action is in the generated catalogue')
  })

  it('a caller who is not the master, or a visit, reads "not published" — the door answers the plain 404', async () => {
    for (const who of [{ email: 'admin@example.org', role: 'admin' }, { ...MASTER, visiting_member: 'm1' }, { ...MASTER, is_service: true }]) {
      caller = who
      await assert.rejects(readTransport('kenny_marsh'), (e: Error) => /unknown action/i.test(e.message))
    }
    caller = MASTER
    await assert.rejects(readTransport('nobody'), /No client with that client_key/)
    await assert.rejects(readTransport('kenny_marsh', '10/2/2026'), /date: a day as yyyy-mm-dd/)
  })
})

describe('the answer, as the section reads it', () => {
  it('history: the client\'s own trips, a twice-filed day once, the Hub form\'s day, van visits, the statuses and the three counts', async () => {
    const a = await read('2026-10-02')
    const by = Object.fromEntries(a.history.rows.map((t) => [t.id, t]))
    assert.deepEqual(Object.keys(by).sort(), ['dvr8', 'hfS1', 'vc2', 'vc3', 'vc5', 'vc6', 'vc8'])
    assert.deepEqual([by.vc3.requests, by.vc3.reserved_time, by.vc3.status], [2, '9:45 AM – 11:45 AM', 'Completed'])
    assert.deepEqual([by.vc5.status, by.vc5.dr_name, by.vc5.staff], ['Scheduled', 'Dr Carver', ''])
    assert.deepEqual([by.vc6.status, by.dvr8.status, by.dvr8.assignment], ['Check date', 'Needs assignment', ''])
    assert.deepEqual([by.vc8.status, by.vc8.conflict], ['Needs assignment', 'Unresolved'])
    assert.deepEqual([by.hfS1.status, by.hfS1.staff, by.hfS1.source], ['Scheduled', 'Eve Form', 'hub_form'])
    assert.deepEqual(a.history.kpis, { needs_assignment: 2, scheduled: 2, completed: 2 })
    assert.deepEqual(transportKpis(a, 'history').map((k) => `${k.label}=${k.value}`),
      ['Needs assignment=2', 'Scheduled trips=2', 'Completed trips=2'])
    assert.equal(a.history.rows[0].id, 'dvr8', 'newest first')
    const text = JSON.stringify(a)
    assert.ok(!/Private Clinic|Hidden Rd|Secret pill|private words/.test(text), 'another client\'s trip and no clinical field leave the door')
  })

  it('measured on the fixture: the trips run 2025-10-16 to 2026-11-03 and the statuses are the door\'s own words', async () => {
    const a = await read()
    assert.deepEqual(a.calendar.range, { first: '2025-10-16', last: '2026-11-03' })
    assert.deepEqual(a.history.statuses, ['Needs assignment', 'Scheduled', 'Completed', 'Check date'])
    assert.deepEqual(statusesIn(a.history.rows, ['Scheduled']), ['Scheduled', 'Needs assignment', 'Check date', 'Completed'],
      'the order given first, then the rest as the rows carry them')
    assert.equal(a.sources.find((s) => s.id === 'van_requests')?.realigned, 4)
  })

  it('calendar: the month grid places each trip on its day, with the vehicle filter', async () => {
    const a = await read()
    const weeks = monthWeeks('2026-10')
    assert.deepEqual(weeks[0].slice(0, 5), ['', '', '', '', '2026-10-01'], 'October 2026 starts on a Thursday')
    assert.deepEqual(tripsOn(a.calendar.rows, '2026-10-02', '').map((t) => t.id), ['vc5'])
    assert.deepEqual(tripsOn(a.calendar.rows, '2026-10-02', 'Another van'), [])
    assert.deepEqual(a.calendar.vehicles, ['Wheelchair Van - 1'])
    assert.equal(shiftMonth('2026-12', 1), '2027-01')
  })

  it('vehicles: one van from the requests, Maintenance while an open repair names it, another client\'s booking only a clock', async () => {
    const a = await read('2026-10-02')
    const [v] = a.vehicles.rows
    assert.deepEqual([a.vehicles.rows.length, v.vehicle, v.status, v.maintenance.length], [1, 'Wheelchair Van - 1', 'Maintenance', 1])
    const other = v.bookings.find((b) => !b.mine)
    assert.deepEqual(other && [other.who, other.record, other.destination, other.trip_id], ['Another client', '', '', ''])
    assert.equal(v.bookings.find((b) => b.mine)?.trip_id, 'vc5')
    assert.deepEqual(transportKpis(a, 'vehicles').map((k) => k.value), ['1', '0', '1'])
    S.repairs = []
    forgetTransportReads()
    assert.equal((await read('2026-10-02')).vehicles.rows[0].status, 'Booked', 'the day\'s bookings cover the observed window')
    assert.equal((await read('2026-10-09')).vehicles.rows[0].status, 'Partly Booked')
    assert.equal((await read('2026-12-25')).vehicles.rows[0].status, 'Available')
  })

  it('mileage: PSI shifts with the client that logged units, a "Last, First" consumer matched', async () => {
    const a = await read()
    assert.deepEqual(a.mileage.rows.map((m) => [m.record, m.date, m.units, m.status]), [['Ann Aide', '2026-09-21', 10, 'Logged']])
    assert.deepEqual(transportKpis(a, 'mileage').map((k) => k.value), ['1', '10', 'Sep 21, 2026'])
  })

  it('a book that will not open: every tab says why, no KPI is a zero, and the van visits still show', async () => {
    S.bookOpens = false
    S.punches = null
    const a = await read()
    assert.equal(a.degraded, true)
    assert.match(a.history.why, /Van Calendar book could not be opened/)
    assert.equal(a.history.kpis, null)
    assert.deepEqual(transportKpis(a, 'history').map((k) => k.value), ['—', '—', '—'])
    assert.deepEqual(transportKpis(a, 'vehicles').map((k) => k.value), ['—', '—', '—'])
    assert.deepEqual(a.vehicles.rows, [])
    assert.equal(a.mileage.why, 'the PSI punch house is not declared')
    assert.deepEqual(transportKpis(a, 'mileage').map((k) => k.value), ['—', '—', '—'])
    assert.ok(a.history.rows.some((t) => t.source === 'dr_visits'))
  })
})

describe('the model', () => {
  it('search and status filter over what the row shows; days in words', async () => {
    const a = await read()
    assert.deepEqual(filterRows(a.history.rows, 'adler', '', tripText).map((t) => t.id), ['vc3'])
    assert.deepEqual(filterRows(a.history.rows, '', 'Check date', tripText).map((t) => t.id), ['vc6'])
    assert.equal(dayLabel('2026-09-30'), 'Sep 30, 2026')
    assert.equal(transportOf(null).history.kpis, null)
  })

  it('the read: 60 s fresh, a failed refresh keeps the rows before it and says so', async () => {
    const before = calls.length
    const h = mountHook((p: { client: string; date: string }) => useTransportRead(p.client, p.date), { client: 'kenny_marsh', date: '' })
    await h.settle(() => h.current.status === 'ready')
    assert.equal(calls.length, before + 1)
    assert.equal(h.current.data?.history.rows.length, 7)
    caller = { email: 'admin@example.org', role: 'admin' }
    h.run(() => h.current.reload())
    await h.settle(() => h.current.status === 'failed')
    assert.equal(h.current.error, NOT_PUBLISHED)
    assert.equal(h.current.data?.history.rows.length, 7, 'the rows from the read before stay')
    h.unmount()
  })

  it('a write for the client (the appointment pencil) reads the trips again at once; another client\'s write does not', async () => {
    const h = mountHook((p: { client: string; date: string }) => useTransportRead(p.client, p.date), { client: 'kenny_marsh', date: '' })
    await h.settle(() => h.current.status === 'ready')
    const first = calls.length
    S.visits[1].wheelchair_van_required = 'No'
    h.run(() => clientWritten('liagomez'))
    assert.equal(calls.length, first, 'another client\'s write reads nothing')
    h.run(() => clientWritten('kenny_marsh'))
    await h.settle(() => calls.length === first + 1 && !h.current.refreshing)
    assert.equal(calls.at(-1)?.action, TRANSPORT_ACTION)
    assert.equal(h.current.data?.history.rows.length, 6, 'the visit no longer flagged for the van is gone from History')
    h.unmount()
  })
})

describe('the screen', () => {
  const state = (a: TransportAnswer): TransportRead => ({ status: 'ready', data: a, error: '', refreshing: false, reload: noop })
  const body = (a: TransportAnswer, view: 'calendar' | 'history' | 'vehicles') => draw(
    createElement(TransportBody, { read: state(a), view, onView: noop, date: a.date, onDate: noop, onAsk: noop }))
  const noModal = (html: string, what: string) => assert.ok(!/role="dialog"|role="alertdialog"|aria-modal/.test(html), what)
  primeShellHides(SHELL_SHOWN)

  it('the three views in the mockup\'s shape; the PSI shifts with transportation units are a line under History', async () => {
    const a = await read('2026-10-02')
    const cal = body(a, 'calendar')
    assert.ok(cal.includes('data-trip-calendar-read="loading"'), 'the calendar is the Transportation app\'s own, read for this client')
    assert.deepEqual([...cal.matchAll(/role="tab"[^>]*data-view="(\w+)"/g)].map((m) => m[1]), ['calendar', 'history', 'vehicles'])
    const his = body(a, 'history')
    for (const s of ['>Date<', '>Time<', '>Trip Type<', '>Trip Details<', '>Vehicle<', '>Edit<', 'All statuses',
      'data-kpi="Needs assignment"', 'data-kpi="Scheduled trips"', 'data-kpi="Completed trips"']) assert.ok(his.includes(s), s)
    for (const gone of ['Trip / Destination', 'Staff / Request', 'Reserved time', '>Assignment<', '>Status<']) assert.ok(!his.includes(gone), gone)
    assert.ok(his.includes(`data-note="">${a.history.note || a.history.rule}`), 'what Completed means is said beside the counts')
    assert.ok(his.includes('data-mileage=""') && his.includes('1 PSI shift with this client logged 10 transportation units, the latest on Sep 21, 2026.'))
    const veh = body(a, 'vehicles')
    for (const s of ['Manage vehicles', 'Shared fleet across all clients', 'Availability', 'Bookings on selected date', 'data-status="Maintenance"',
      'Another client']) assert.ok(veh.includes(s), s)
    for (const [html, what] of [[cal, 'calendar'], [his, 'history'], [veh, 'vehicles']]) noModal(html, what)
  })

  it('Settings › My Work keeps Vehicles, the counts and their notes to the master; the trips and a failed source stay', async () => {
    primeShellHides({ ...SHELL_SHOWN, client_transport_notes: true })
    try {
      const a = await read('2026-10-02')
      const his = body(a, 'history')
      assert.deepEqual([...his.matchAll(/role="tab"[^>]*data-view="(\w+)"/g)].map((m) => m[1]), ['calendar', 'history'])
      assert.ok(!his.includes('data-kpi=') && !his.includes('data-note=""') && !his.includes('data-as-of='))
      assert.ok(his.includes('>Trip Type<') && his.includes('All statuses'))
      assert.ok(body(a, 'vehicles').includes('data-not-open=""'), 'an address that names Vehicles opens nothing')
    } finally {
      primeShellHides(SHELL_SHOWN)
    }
  })

  it('a client\'s New trip sends one of its own trip types, Other with what was filled in', () => {
    assert.equal(clientTripType('Chores', ''), 'Chores')
    assert.equal(clientTripType('Other', '  Haircut '), 'Other: Haircut')
    assert.equal(clientTripType('Other', '  '), '', 'an Other left blank is not a trip type yet')
  })

  it('the panel rides the page\'s address as its own parameter', () => {
    for (const ask of [{ kind: 'trip', id: 'vc3' }, { kind: 'vehicle', id: 'veh_wheelchairvan1' }, { kind: 'sources' },
      { kind: 'trip-new' }, { kind: 'trip-new', day: '2026-10-28' }] as TransportAsk[]) {
      assert.deepEqual(transportPanelOf(transportPanelParam(ask)), ask)
    }
    for (const bad of ['', 'mile~m1', 'trip~', 'nope']) assert.equal(transportPanelOf(bad), null, bad)
  })

  it('a source that did not read shows its sentence and dashes, never an empty table dressed as zero', async () => {
    S.bookOpens = false
    const a = await read()
    const his = body(a, 'history')
    assert.ok(his.includes('data-why=""') && his.includes('could not be opened'))
    assert.ok(/data-kpi="Completed trips"><p[^>]*>—<\/p>/.test(his))
  })

  it('every detail opens in the right panel — never a dialog', async () => {
    const a = await read('2026-10-02')
    const asks: TransportAsk[] = [{ kind: 'trip', id: 'vc3' }, { kind: 'trip', id: 'dvr8' }, { kind: 'vehicle', id: a.vehicles.rows[0].id },
      { kind: 'sources' }]
    for (const ask of asks) {
      const html = draw(createElement(TransportPanel, { ask, answer: a, onAsk: noop, onClose: noop }))
      assert.match(html, /<aside aria-label="/, ask.kind)
      noModal(html, ask.kind)
    }
    const trip = draw(createElement(TransportPanel, { ask: { kind: 'trip', id: 'vc3' }, answer: a, onAsk: noop, onClose: noop }))
    assert.ok(trip.includes('Van Calendar › Requests · row 3') && trip.includes('filed 2 times'))
    const veh = draw(createElement(TransportPanel, { ask: { kind: 'vehicle', id: a.vehicles.rows[0].id }, answer: a, onAsk: noop, onClose: noop }))
    assert.ok(veh.includes('Oil change light on') && veh.includes('Not on the fleet list'))
  })

  it('no modal, browser dialog or delete anywhere in the section', () => {
    for (const f of readdirSync(resolve(ROOT, FEATURE))) {
      const text = readFileSync(resolve(ROOT, FEATURE, f), 'utf8')
      assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(/, f)
      assert.doesNotMatch(text, /import[^;]*\b\w*(Dialog|Sheet)\b[^;]*from/, f)
      assert.doesNotMatch(text, /aria-modal|role="dialog"/, f)
      assert.doesNotMatch(text, /api\.(remove|delete|create|update)\(/, f)
    }
  })
})
