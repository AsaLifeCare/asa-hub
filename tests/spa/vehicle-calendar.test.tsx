/**
 * TRANSPORTATION · the registry entry, the routes, the master-only release, the rename of the older app, and the
 * screen drawn from a board: the off-white top bar and its tabs, a status card per vehicle, the compact month and
 * week, a private trip that says only "Booked", and the panels' own decisions — drawn inside the panel, never in a
 * dialog. No App Control row ships with it — the app is the master's alone until released (lib/badgeAccess).
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { appManifests } from '@/registry/apps'
import { VEHICLE_CALENDAR_APP_ID, vehicleCalendarManifests } from '@/registry/apps-vehicle-calendar'
import { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { badgeAllowsApp } from '@/lib/badgeAccess'
import VehicleCalendarPage, { NO_VEHICLES_WORDS, TEST_MODE_WORDS, VehicleCalendarView } from '@/pages/features/vehiclecalendar/VehicleCalendarPage'
import { ActionsMenu } from '@/pages/features/vehiclecalendar/TopBar'
import { NOT_READ } from '@/pages/features/vehiclecalendar/SetupPanel'
import { VEHICLE_CALENDAR_ACTIONS, type BoardState } from '@/pages/features/vehiclecalendar/vehicleCalendarLane'
import { boardFrom, wallToMs, type Board, type PageId, type Panel } from '@/pages/features/vehiclecalendar/vehicleCalendarModel'
import TripPanel, { PRIVATE_LINE, draftOf, tripChanges } from '@/pages/features/vehiclecalendar/TripPanel'
import RequestPanel, { REQUEST_SUBLINE, requestClosedWhy } from '@/pages/features/vehiclecalendar/RequestPanel'
import VehiclePanel, { OUT_OF_SERVICE_NOTE, tripsReturned } from '@/pages/features/vehiclecalendar/VehiclePanel'
import { EMPTY_BODY, EMPTY_TITLE } from '@/pages/features/vehiclecalendar/HistoryTable'
import { SHELL_HIDDEN, primeShellHides } from '@/lib/myWorkHides'

// the screens below draw their test mode warnings, as Settings › My Work shows them when the switch says so
primeShellHides({ ...SHELL_HIDDEN, test_mode_warnings: false })

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const iso = (wall: string) => new Date(wallToMs(wall)).toISOString()

const VEHICLES = [
  { id: 'VVAN0000001', name: 'Van', description: 'Wheelchair-accessible van', seats: 6, wheelchair_accessible: true, availability: 'available', tint: 'blue', order: 1,
    details: 'Wheelchair-accessible van · 6 seats · Wheelchair accessible', status: { word: 'In use', tone: 'amber' },
    active_trip: { id: 'VT0000000001', start_at: iso('2026-09-30T09:00'), end_at: iso('2026-09-30T11:30') } },
  { id: 'VMAZ0000002', name: 'Mazda', description: 'Mazda CX-5', seats: 5, wheelchair_accessible: false, availability: 'available', tint: 'mint', order: 2,
    details: 'Mazda CX-5 · 5 seats', status: { word: 'Available', tone: 'mint' },
    next_trip: { id: 'VT0000000002', start_at: iso('2026-10-02T16:00'), end_at: iso('2026-10-02T17:30') } },
  { id: 'VFOR0000003', name: 'Ford', description: 'Ford Escape', seats: 5, wheelchair_accessible: false, availability: 'maintenance', tint: 'peach', order: 3,
    details: 'Ford Escape · 5 seats', status: { word: 'Maintenance', tone: 'peach' } },
]

const TRIP_BASE = {
  vehicle_id: 'VVAN0000001', vehicle_name: 'Van', requested_vehicle_id: 'VVAN0000001', requested_vehicle_name: 'Van',
  end_known: true, wheelchair_required: false, trip_type: 'Doctor appointment', destination: '1 Main St', details: '',
  client_key: 'bethannsutter', client_name: 'Beth Ann Sutter', staff_key: 'taylorbrooks', staff_name: 'Taylor Brooks',
  driver_key: 'taylorbrooks', driver_name: 'Taylor Brooks', requested_by: { uid: 'USR_TB', name: 'Taylor Brooks' },
  decided_by: 'Ty Bond', decided_at: iso('2026-09-29T10:00'), decision_note: '', assign_note: '', source: 'platform',
  mine: false, test_mode: false, created_at: iso('2026-09-29T09:00'), updated_at: iso('2026-09-29T10:00'),
}

const trip = (id: string, from: string, to: string, over: Record<string, unknown> = {}) => ({
  ...TRIP_BASE, id, state: 'scheduled', word: 'Scheduled', tone: 'blue', start_at: iso(from), end_at: iso(to), day: from.slice(0, 10),
  start_label: from.slice(11), end_label: to.slice(11), purpose: 'Primary care follow-up', ...over,
})

function fixture(viewer: Record<string, unknown> = {}, over: Record<string, unknown> = {}): Board {
  return boardFrom({
    ok: true, now: iso('2026-09-30T10:00'), today: '2026-09-30', stamp: 'Sep 30, 2026, 10:00 AM Eastern',
    viewer: { uid: 'USR_AN', name: 'Ann Roe', is_master: false, is_director: false, can_edit: false, can_request: true, visiting: false, ...viewer },
    test_mode: { on: false, readable: true, why: '' },
    settings: { directors: [{ uid: 'USR_8F7DD2A6B756', name: 'Ty Bond' }, { uid: 'USR_B08C57743A1E', name: 'Brittany Anderson' }],
      directors_readable: true, directors_why: '', trip_types: ['Doctor appointment', 'Grocery shopping', 'Other'], seeded: true, imported_at: '' },
    vehicles: VEHICLES,
    trips: [
      trip('VT0000000001', '2026-09-30T09:00', '2026-09-30T11:30', { word: 'In use', tone: 'amber' }),
      trip('VT0000000002', '2026-10-02T16:00', '2026-10-02T17:30', { vehicle_id: 'VMAZ0000002', vehicle_name: 'Mazda', purpose: 'Grocery shopping' }),
      { id: 'VT0000000003', state: 'scheduled', word: 'Scheduled', tone: 'blue', vehicle_id: 'VVAN0000001', vehicle_name: 'Van',
        start_at: iso('2026-09-15T13:00'), end_at: iso('2026-09-15T14:00'), day: '2026-09-15', start_label: '13:00', end_label: '14:00',
        private: true, mine: false },
      trip('VT0000000004', '2026-10-06T09:00', '2026-10-06T10:00', { state: 'requested', word: 'Requested', tone: 'amber', vehicle_id: '',
        vehicle_name: '', decided_by: '', decided_at: '', requested_by: { uid: 'USR_CY', name: 'Cy Far' }, staff_key: 'cyfar', staff_name: 'Cy Far',
        seats: [{ to: ['Ty Bond', 'Brittany Anderson'], state: 'waiting', by: '', at: '' }] }),
    ],
    kpis: { needs_assignment: 1, scheduled: 2, in_service: 2 },
    people: [{ key: 'annroe', uid: 'USR_AN', name: 'Ann Roe' }, { key: 'taylorbrooks', uid: 'USR_TB', name: 'Taylor Brooks' }, { key: 'cyfar', uid: 'USR_CY', name: 'Cy Far' }],
    clients: [{ key: 'bethannsutter', name: 'Beth Ann Sutter' }],
    waiting: [], sources: [], note: '',
    ...over,
  })
}

const ready = (board: Board): BoardState => ({ status: 'ready', board, error: '', refreshing: false })
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const inRouter = (node: ReactNode, at = '/app/vehicle-calendar/calendar') =>
  flat(renderToString(createElement(MemoryRouter, { initialEntries: [at] }, node)))
const draw = (state: BoardState, page: PageId = 'calendar', opts: { master?: boolean; panel?: Panel | null } = {}) =>
  inRouter(createElement(VehicleCalendarView, {
    state, page, isMaster: opts.master ?? false, panel: opts.panel ?? null, onPanel: () => {}, onAbsorb: () => {}, onReload: () => {},
  }), `/app/vehicle-calendar/${page}`)

afterEach(() => { localStorage.removeItem('asa-vehicle-calendar:prefs') })

describe('transportation — the app', () => {
  it('is one app named Transportation with three pages, registered once', () => {
    assert.equal(vehicleCalendarManifests.length, 1)
    const m = vehicleCalendarManifests[0]
    assert.equal(m.id, VEHICLE_CALENDAR_APP_ID)
    assert.equal(m.id, 'vehicle-calendar')
    assert.equal(m.name, 'Transportation')
    assert.equal(m.icon, 'car-front')
    assert.equal(m.category, 'Operations')
    assert.deepEqual(m.pages.map((p) => p.id), ['calendar', 'history', 'vehicles'])
    assert.equal(appManifests.filter((a) => a.id === VEHICLE_CALENDAR_APP_ID).length, 1)
    assert.equal(appManifests.filter((a) => a.name === 'Transportation').length, 1, 'one app carries the name')
  })

  it('the older app keeps its id and becomes Transportation Users', () => {
    const old = appManifests.find((a) => a.id === 'transportation')
    assert.ok(old)
    assert.equal(old.name, 'Transportation Users')
    assert.equal(old.pages[0].title, 'Transportation Users')
    assert.ok(CUSTOM_PAGES['transportation/routes'], 'its route is untouched')
    const page = readFileSync(resolve(ROOT, 'src/pages/features/transportation/TransportationPage.tsx'), 'utf8')
    assert.match(page, /title="Transportation Users"/)
  })

  it('every page route resolves to the one screen', async () => {
    for (const p of ['calendar', 'history', 'vehicles']) {
      assert.equal(await CUSTOM_PAGES[`vehicle-calendar/${p}`].load(), VehicleCalendarPage, p)
    }
  })

  it('ships master-only: no badge row opens it to anybody else', () => {
    assert.equal(badgeAllowsApp(VEHICLE_CALENDAR_APP_ID, { types: ['STAFF'] }, {}), false)
    assert.equal(badgeAllowsApp(VEHICLE_CALENDAR_APP_ID, { types: ['DIRECTOR'], role: 'admin' }, {}), false)
    assert.equal(badgeAllowsApp(VEHICLE_CALENDAR_APP_ID, { isMaster: true }, {}), true)
    // the older app's own row does not open the new id
    assert.equal(badgeAllowsApp(VEHICLE_CALENDAR_APP_ID, { types: ['DIRECTOR'] }, { transportation: ['DIRECTOR'] }), false)
  })

  it('calls only its own actions, each by its literal name', () => {
    assert.deepEqual([...VEHICLE_CALENDAR_ACTIONS], [
      'vehicleCalendarBoard', 'vehicleCalendarRequest', 'vehicleCalendarAnswer', 'vehicleCalendarWithdraw',
      'vehicleCalendarTripSave', 'vehicleCalendarVehicleSave', 'vehicleCalendarSettingsSet', 'vehicleCalendarSeed',
      'vehicleCalendarImport', 'vehicleCalendarClientTrips', 'vehicleCalendarStaffTrips',
    ])
    const lane = readFileSync(resolve(ROOT, 'src/pages/features/vehiclecalendar/vehicleCalendarLane.ts'), 'utf8')
    for (const a of VEHICLE_CALENDAR_ACTIONS) assert.ok(lane.includes(`'${a}'`), a)
  })
})

describe('transportation — the screen', () => {
  it('an off-white top bar with Share and Actions, the three tabs, and no black hero', () => {
    const html = draw(ready(fixture()))
    assert.ok(html.includes('data-top-bar=""'))
    assert.match(html, /class="[^"]*bg-surface[^"]*"[^>]*data-top-bar=""/)
    assert.ok(!/bg-black|data-hero|bg-ink/.test(html), 'no black hero')
    assert.ok(html.includes('data-share=""') && html.includes('data-actions=""'))
    const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(tabs, ['calendar', 'history', 'vehicles'])
    assert.ok(html.includes('href="/app/vehicle-calendar/history"'))
    assert.ok(html.includes('As of Sep 30, 2026, 10:00 AM Eastern'))
  })

  it('a status card per vehicle: its word, its active trip or next booking, and the link to it', () => {
    const html = draw(ready(fixture()))
    assert.deepEqual([...html.matchAll(/data-vehicle-card="([^"]+)"/g)].map((m) => m[1]), ['VVAN0000001', 'VMAZ0000002', 'VFOR0000003'])
    assert.ok(html.includes('>Vehicle Status<'))
    assert.ok(html.includes('data-status="In use"') && html.includes('data-status="Maintenance"'))
    assert.ok(html.includes('View active trip') && html.includes('View next booking'))
    assert.ok(html.includes('data-open-trip="VT0000000001"'))
  })

  it('the month: Sunday first, chips for scheduled trips only, a private trip says Booked and never its client', () => {
    const html = draw(ready(fixture()))
    assert.ok(html.includes('data-month-grid="2026-09"'))
    assert.ok(html.includes('>September 2026<'))
    assert.ok(html.indexOf('>Sun<') < html.indexOf('>Mon<'))
    assert.ok(html.includes('data-trip="VT0000000001"'))
    assert.ok(!html.includes('data-trip="VT0000000004"'), 'a waiting request is not on the calendar')
    assert.ok(html.includes('data-trip="VT0000000003"'))
    const chip = html.slice(html.indexOf('data-trip="VT0000000003"'), html.indexOf('</button>', html.indexOf('data-trip="VT0000000003"')))
    assert.ok(chip.includes('Booked') && chip.includes('13:00–14:00'))
    assert.ok(!/data-day="2026-09-0[1-9]" data-trips/.test(html), 'an empty day carries no trips')
    assert.ok(html.includes('All times Eastern Time'))
    assert.ok(html.includes('Private trip details appear in the client workspace or manager views.'))
  })

  it('the week: seven days in one row, and an empty week draws no chip at all', () => {
    localStorage.setItem('asa-vehicle-calendar:prefs', JSON.stringify({ view: 'week', hidden: [] }))
    const html = draw(ready(fixture()))
    assert.ok(html.includes('data-week-grid="2026-09-27"'))
    assert.ok(html.includes('>Sep 27, 2026 – Oct 3, 2026<'))
    assert.equal([...html.matchAll(/data-day="/g)].length, 7)
    assert.ok(html.includes('data-trip="VT0000000002"'))
    const empty = draw(ready(fixture({}, { today: '2026-11-11' })))
    assert.ok(empty.includes('data-week-grid="2026-11-08"'))
    assert.ok(!empty.includes('data-trip="'))
    assert.ok(empty.includes('data-calendar-empty=""'))
  })

  it('the vehicle filter says how many are drawn, and a hidden vehicle\'s trips leave the grid', () => {
    localStorage.setItem('asa-vehicle-calendar:prefs', JSON.stringify({ view: 'month', hidden: ['VVAN0000001'] }))
    const html = draw(ready(fixture()))
    assert.ok(html.includes('Vehicles · 2 of 3'))
    assert.ok(!html.includes('data-trip="VT0000000001"'))
  })

  it('History: the figures, every trip, and Open into the panel', () => {
    const html = draw(ready(fixture()), 'history')
    assert.ok(html.includes('data-kpi="Needs assignment"') && html.includes('data-kpi="Scheduled trips"') && html.includes('data-kpi="Vehicles in service"'))
    for (const col of ['Client', 'Trip / Destination', 'Staff / Request', 'Reserved time', 'Assignment', 'Status', 'Action']) {
      assert.ok(html.includes(`>${col}<`), col)
    }
    assert.ok(html.includes('data-open-trip="VT0000000004"'))
    const row = html.slice(html.indexOf('data-row="VT0000000003"'), html.indexOf('</tr>', html.indexOf('data-row="VT0000000003"')))
    assert.ok(row.includes('Private') && row.includes('Booked') && !row.includes('Beth Ann Sutter'))
    const none = draw(ready(fixture({}, { trips: [] })), 'history')
    assert.ok(none.includes(EMPTY_TITLE) && none.includes(EMPTY_BODY))
  })

  it('Vehicles: details, availability on the date and its bookings; the pencil only for the directors', () => {
    const html = draw(ready(fixture()), 'vehicles')
    assert.ok(html.includes('>Manage vehicles<') && html.includes('Shared fleet across all clients'))
    assert.ok(html.includes('Wheelchair-accessible van · 6 seats · Wheelchair accessible'))
    assert.ok(html.includes('09:00–11:30 · Primary care follow-up'))
    assert.ok(html.includes('data-status="Partly booked"') && html.includes('data-status="Maintenance"'))
    assert.ok(!html.includes('data-pencil='))
    assert.ok(draw(ready(fixture({ can_edit: true, is_director: true })), 'vehicles').includes('data-pencil="VMAZ0000002"'))
  })

  it('the test-mode banner when test mode holds, and when the board could not be read', () => {
    assert.ok(draw(ready(fixture({}, { test_mode: { on: true, readable: true, why: '' } }))).includes(TEST_MODE_WORDS))
    assert.ok(!draw(ready(fixture())).includes(TEST_MODE_WORDS))
    const failed = draw({ status: 'failed', board: null, error: 'timeout', refreshing: false })
    assert.ok(failed.includes('The vehicle calendar could not be read — timeout.'))
    assert.ok(failed.includes(TEST_MODE_WORDS))
  })

  it('a board already drawn stays when a read again fails, and says so quietly', () => {
    const html = draw({ status: 'ready', board: fixture(), error: 'Network error', refreshing: false })
    assert.ok(html.includes('Showing the last copy — Network error.'))
    assert.ok(html.includes('data-vehicle-card="VVAN0000001"'))
  })
})

describe('transportation — inside the panel', () => {
  const panel = (node: ReactNode) => inRouter(node)

  it('New request: the Eastern sub-line, every field, and Submit request in the panel', () => {
    const board = fixture()
    const html = panel(<RequestPanel board={board} onDone={() => {}} onCancel={() => {}} />)
    assert.ok(html.includes(REQUEST_SUBLINE))
    for (const f of ['vehicle', 'staff', 'client', 'trip-type', 'details']) assert.ok(html.includes(`data-field="${f}"`), f)
    assert.ok(html.includes('data-wall="start"') && html.includes('data-wall="end"'))
    assert.ok(html.includes('Choose vehicle') && html.includes('Choose staff member') && html.includes('Choose a client') && html.includes('Choose trip type'))
    assert.ok(html.includes('Wheelchair-accessible vehicle required'))
    assert.ok(html.includes('>Submit request<') && html.includes('data-panel-actions=""'))
    assert.ok(html.includes('Ty Bond and Brittany Anderson are asked in My Work and by text'))
    assert.ok(!html.includes('role="dialog"'))
  })

  it('a request is closed, with why, while visiting or with nobody to approve', () => {
    assert.match(requestClosedWhy(fixture({ visiting: true })), /not while visiting/)
    assert.match(requestClosedWhy(fixture({}, { settings: { directors: [], directors_readable: false, directors_why: 'the settings house is not set up', trip_types: [] } })),
      /^Nobody is set to approve vehicle requests: the settings house is not set up\.$/)
    assert.equal(requestClosedWhy(fixture()), '')
  })

  it('the seat holder answers inside the panel; the master is told whom it waits on; the requester may withdraw', () => {
    const seat = fixture({ uid: 'USR_8F7DD2A6B756', name: 'Ty Bond', is_director: true, can_edit: true },
      { waiting: [{ item_id: 'VI0000000001', trip_id: 'VT0000000004' }] })
    const t = seat.trips.find((x) => x.id === 'VT0000000004') ?? null
    const html = panel(<TripPanel board={seat} trip={t} isMaster={false} onDone={() => {}} onClose={() => {}} />)
    assert.ok(html.includes('data-decide="VI0000000001"'))
    assert.ok(html.includes('>Approve<') && html.includes('>Decline<'))
    assert.ok(html.includes('Brittany Anderson was asked too'))
    assert.ok(html.includes('data-field="status"') && /data-field="status"[^>]*disabled=""|disabled=""[^>]*data-field="status"/.test(html), 'status is not set on a waiting request')

    const master = fixture({ uid: 'USR_M', name: 'Master', is_master: true, can_edit: true })
    const m = panel(<TripPanel board={master} trip={master.trips.find((x) => x.id === 'VT0000000004') ?? null} isMaster onDone={() => {}} onClose={() => {}} />)
    assert.ok(m.includes('Waiting on Ty Bond and Brittany Anderson — the first answer decides.'))
    assert.ok(!m.includes('data-decide='))

    const mine = fixture({ uid: 'USR_CY', name: 'Cy Far' })
    const r = panel(<TripPanel board={mine} trip={mine.trips.find((x) => x.id === 'VT0000000004') ?? null} isMaster={false} onDone={() => {}} onClose={() => {}} />)
    assert.ok(r.includes('data-withdraw=""') && r.includes('>Withdraw<'))
    assert.ok(!r.includes('data-assign-form'), 'a staff member reads, never assigns')
  })

  it('a private trip in the panel shows only that the vehicle is booked', () => {
    const board = fixture()
    const t = board.trips.find((x) => x.id === 'VT0000000003') ?? null
    const html = panel(<TripPanel board={board} trip={t} isMaster={false} onDone={() => {}} onClose={() => {}} />)
    assert.ok(html.includes(PRIVATE_LINE) && html.includes('>Booked<'))
    assert.ok(!html.includes('Beth Ann Sutter') && !html.includes('data-people'))
  })

  it('the directors assign: the availability box words each vehicle and driver, and only what changed is sent', () => {
    const board = fixture({ can_edit: true, is_director: true })
    const t = board.trips.find((x) => x.id === 'VT0000000002')!
    const html = panel(<TripPanel board={board} trip={t} isMaster={false} onDone={() => {}} onClose={() => {}} />)
    assert.ok(html.includes('data-availability-box=""') && html.includes('Availability for this time'))
    assert.ok(html.includes('Mazda · Available') && html.includes('Ford · Maintenance'))
    assert.ok(html.includes('Taylor Brooks · Available'))
    assert.ok(html.includes('Choose Scheduled to reserve these resources.'))
    assert.equal(tripChanges(t, draftOf(t)), null, 'nothing touched, nothing sent')
    assert.deepEqual(tripChanges(t, { ...draftOf(t), status: 'needs_assignment' }), { trip_id: t.id, status: 'needs_assignment' })
    assert.deepEqual(tripChanges(t, { ...draftOf(t), vehicle_id: 'VVAN0000001', purpose: 'Groceries' }),
      { trip_id: t.id, vehicle_id: 'VVAN0000001', purpose: 'Groceries' })
    const waiting = board.trips.find((x) => x.id === 'VT0000000004')!
    assert.deepEqual(tripChanges(waiting, { ...draftOf(waiting), status: 'scheduled', destination: 'Clinic' }),
      { trip_id: waiting.id, destination: 'Clinic' }, 'a waiting request never sends a status')
  })

  it('Edit vehicle: the out-of-service note, and which scheduled trips would go back to Needs assignment', () => {
    const board = fixture({ can_edit: true, is_director: true })
    const van = board.vehicles[0]
    const html = panel(<VehiclePanel board={board} vehicle={van} isNew={false} onDone={() => {}} onCancel={() => {}} />)
    assert.ok(html.includes(OUT_OF_SERVICE_NOTE))
    for (const f of ['name', 'description', 'seats', 'availability']) assert.ok(html.includes(`data-field="${f}"`), f)
    const now = Date.parse(board.now)
    assert.deepEqual(tripsReturned(van, board.trips, { availability: 'out_of_service', wheelchair: true }, now).map((t) => t.id), ['VT0000000001'])
    assert.deepEqual(tripsReturned(van, board.trips, { availability: 'available', wheelchair: true }, now), [])
    const reader = panel(<VehiclePanel board={fixture()} vehicle={van} isNew={false} onDone={() => {}} onCancel={() => {}} />)
    assert.ok(reader.includes('data-vehicle-facts=') && !reader.includes('data-field="name"'))
  })
})

describe('transportation — the one right panel', () => {
  it('opens the mode the address names, in the side panel and not a dialog', () => {
    const html = draw(ready(fixture()), 'calendar', { panel: { kind: 'request' } })
    assert.ok(html.includes('aria-label="Request"'), 'the panel names its mode')
    assert.ok(html.includes('>New request<'), 'its title')
    assert.ok(html.includes('data-request-panel=""'), 'its body')
    assert.ok(!html.includes('role="dialog"'))
    const trip = draw(ready(fixture()), 'history', { panel: { kind: 'trip', id: 'VT0000000002' } })
    assert.ok(trip.includes('>Trip details &amp; assignment<'), 'the trip title')
    assert.ok(trip.includes('data-trip-panel="VT0000000002"'), 'the trip body')
    const share = draw(ready(fixture()), 'vehicles', { panel: { kind: 'share' } })
    assert.ok(share.includes('data-share-panel=""'), 'the share body')
    assert.ok(share.includes('Transportation · Vehicles'), 'the share title')
  })

  it('Setup and Add vehicle are drawn only for whom they are', () => {
    assert.ok(!draw(ready(fixture()), 'calendar', { panel: { kind: 'setup' } }).includes('data-setup-panel'))
    const notSession = draw(ready(fixture({ is_master: true, can_edit: true })), 'calendar', { panel: { kind: 'setup' }, master: false })
    assert.ok(!notSession.includes('data-setup-panel'), 'the board alone never opens it; the session must be the master too')
    const master = draw(ready(fixture({ is_master: true, can_edit: true })), 'calendar', { panel: { kind: 'setup' }, master: true })
    assert.ok(master.includes('data-setup-panel=""'))
    for (const s of ['seed', 'import', 'settings']) assert.ok(master.includes(`data-setup="${s}"`), s)
    assert.ok(master.includes('data-act="seed-dry"') && master.includes('data-act="import-dry"'))
    assert.match(master, /data-press="import"[^>]*disabled=""|disabled=""[^>]*data-press="import"/, 'Import waits for its dry run')
    assert.ok(!draw(ready(fixture()), 'vehicles', { panel: { kind: 'vehicle-new' } }).includes('data-vehicle-panel'))
    assert.ok(draw(ready(fixture({ can_edit: true })), 'vehicles', { panel: { kind: 'vehicle-new' } }).includes('data-vehicle-panel="new"'))
  })

  it('Setup opens for the master with no board read, and for nobody else', () => {
    const failed: BoardState = { status: 'failed', board: null, error: 'the server did not answer', refreshing: false }
    const loading: BoardState = { status: 'loading', board: null, error: '', refreshing: false }
    for (const state of [failed, loading]) {
      const master = draw(state, 'calendar', { panel: { kind: 'setup' }, master: true })
      assert.ok(master.includes('data-setup-panel=""'), `${state.status}: the master's Setup does not wait for the board`)
      for (const s of ['seed', 'import', 'settings']) assert.ok(master.includes(`data-setup="${s}"`), `${state.status}: ${s}`)
      assert.ok(master.includes(`Now: ${NOT_READ}`), `${state.status}: settings not read are said so`)
      assert.ok(!master.includes('role="dialog"'))
      assert.ok(!draw(state, 'calendar', { panel: { kind: 'setup' }, master: false }).includes('data-setup-panel'), `${state.status}: others never`)
      for (const panel of [{ kind: 'request' }, { kind: 'share' }, { kind: 'vehicle-new' }] as Panel[]) {
        const html = draw(state, 'calendar', { panel, master: true })
        assert.ok(!/data-(request|share|vehicle)-panel=/.test(html), `${state.status}: ${panel.kind} needs a board`)
      }
    }
  })
})

describe('transportation — the Actions menu', () => {
  const menu = (canSetup: boolean, powers: { canRequest: boolean; requestWhy: string; canEdit: boolean } | null) =>
    flat(renderToString(<ActionsMenu label="Calendar" powers={powers} canSetup={canSetup} onPick={() => {}} onReload={() => {}} />))
  const staff = { canRequest: true, requestWhy: '', canEdit: false }
  const director = { canRequest: true, requestWhy: '', canEdit: true }

  it('the master sees Setup, with a board and without one', () => {
    for (const powers of [director, null]) {
      const html = menu(true, powers)
      assert.match(html, /data-action="setup"[^>]*>.*Setup</, 'Setup is in Actions')
      assert.ok(!html.includes('Setup &amp; import'), 'it is named Setup')
      assert.ok(html.includes('data-action="reload"'))
    }
  })

  it('nobody else ever sees Setup', () => {
    for (const powers of [staff, director, null]) {
      const html = menu(false, powers)
      assert.ok(!html.includes('data-action="setup"'), JSON.stringify(powers))
    }
    assert.ok(menu(false, director).includes('data-action="vehicle-new"'), 'a director still adds vehicles')
    assert.ok(!menu(false, staff).includes('data-action="vehicle-new"'))
  })

  it('the master on an empty fleet is told where the vehicles come from; nobody else is', () => {
    const empty = { vehicles: [], trips: [] }
    const master = fixture({ is_master: true, can_edit: true }, empty)
    for (const page of ['calendar', 'history', 'vehicles'] as PageId[]) {
      const html = draw(ready(master), page, { master: true })
      assert.ok(html.includes(NO_VEHICLES_WORDS), `${page}: the master's line`)
      assert.equal(html.split(NO_VEHICLES_WORDS).length - 1, 1, `${page}: said once`)
    }
    const notSession = draw(ready(master), 'calendar', { master: false })
    assert.ok(!notSession.includes(NO_VEHICLES_WORDS) && notSession.includes('No vehicle is on the list yet.'), 'the board alone is not the master')
    const director = draw(ready(fixture({ can_edit: true, is_director: true }, empty)), 'calendar', { master: false })
    assert.ok(!director.includes(NO_VEHICLES_WORDS) && director.includes('No vehicle is on the list yet.'))
    assert.ok(!draw(ready(fixture({ is_master: true, can_edit: true })), 'calendar', { master: true }).includes(NO_VEHICLES_WORDS), 'a fleet says nothing')
    const unread = fixture({ is_master: true, can_edit: true }, { ...empty, sources: [{ key: 'vehicles', state: 'unreadable', why: 'busy', count: 0 }] })
    assert.ok(!draw(ready(unread), 'calendar', { master: true }).includes(NO_VEHICLES_WORDS), 'a list not read is not an empty one')
  })
})

describe('transportation — the laws, read from the source', () => {
  const dir = resolve(ROOT, 'src/pages/features/vehiclecalendar')
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f))

  it('no dialog, no confirm, no PageHeader, no width cap', () => {
    assert.ok(files.length >= 10)
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      assert.ok(!src.includes('@/components/ui/dialog'), `${f}: no dialog`)
      assert.ok(!/ConfirmDialog|askConfirm|askPrompt|window\.confirm|window\.prompt/.test(src), `${f}: no confirm`)
      assert.ok(!src.includes('PageHeader'), `${f}: no PageHeader`)
      assert.ok(!/max-w-(\d|\[\d{3,}px\]|[3-7]xl|screen|full)/.test(src), `${f}: no width cap`)
    }
  })

  it('every call to the backend is one of the literal action names (and the editions reader)', () => {
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/gasAction(?:<[^>]*>)?\(\s*'([^']+)'/g)) {
        assert.ok([...VEHICLE_CALENDAR_ACTIONS, 'editionsMine'].includes(m[1]), `${f}: ${m[1]}`)
      }
    }
  })
})
