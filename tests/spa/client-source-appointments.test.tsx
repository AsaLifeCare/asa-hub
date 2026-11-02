/**
 * CLIENTS · APPOINTMENTS — the door and the section together. Every call the section makes is caught at `fetch` and
 * handed to Apps Script's own ClientSourceAppointments.gs, run here over the Dr Appointments book held in memory
 * (Dr Appt Archive, Future Apts, Dr Master, as the sheet's own headers and cells); the answer is read by the
 * section's own readers and drawn by its own components.
 *
 * Only the stores are stood in for. The helpers the door leans on are lifted whole out of their own .gs files.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import {
  APPOINTMENTS_ACTION, NEW_VISIT, NOT_PUBLISHED, appointmentsOf, apptPanelOf, apptPanelParam, apptRefusal, dayLabel,
  doctorNext, doctorsFor, filledFields, filterVisits, newVisitMissing, newestFirst, readAppointments, statusTint, visitDay,
  visitsLine, type Appointments, type ApptPanel,
} from '@/pages/features/clientprofiles/sources/appointments'
import AppointmentsTab, { AppointmentsPanel, AppointmentsView } from '@/pages/features/clientprofiles/sources/AppointmentsTab'
import { ClientReaderContext, type ClientReader } from '@/pages/features/clientprofiles/clientViewer'
import type { ReadState } from '@/pages/features/locations/useLocation'

// motion mounts its projection nodes against the window; a panel drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const SOURCES = 'src/pages/features/clientprofiles/sources'
const NOW = '2026-09-28T15:00:00Z'
const KENNY = 'kenny_marsh'

const gsText = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')

/** One top-level function or var of a .gs file, exactly as written there. */
function lift(file: string, name: string): string {
  const src = gsText(file)
  const fn = src.indexOf(`\nfunction ${name}(`)
  if (fn !== -1) return src.slice(fn + 1, src.indexOf('\n}', fn + 1) + 2)
  const v = src.indexOf(`\nvar ${name} =`)
  assert.notEqual(v, -1, `${file} has no ${name}`)
  return src.slice(v + 1, src.indexOf(';\n', v) + 1)
}

const HELPERS: [string, string][] = [
  ['Clients.gs', 'clientNameKey_'], ['Clients.gs', 'apptDay_'], ['Clients.gs', 'apptBucket_'], ['Talent.gs', 'str_'],
  ['Estate.gs', 'estateKey_'], ['Estate.gs', 'estateCell_'], ['Estate.gs', 'estateRows_'],
  ['Main.gs', 'hubAddrKey_'], ['Main.gs', 'hubClientIdentity_'],
]

/* ---------- the book ---------- */

type Row = Record<string, unknown>
type Grid = unknown[][]

const ARCHIVE_HEAD = ['Timestamp', 'Client Name', 'Dr Name', 'Appointment Address', 'Appointment Date', 'Appointment Start Time',
  'Wheelchair Van Required?', 'Upcoming?', 'Manager', 'Manager Phone']
const FUTURE_HEAD = ['Client Name', 'Dr Name', 'Appointment Date', 'Appointment Address', 'Appointment Start Time']
const MASTER_HEAD = ['Client', 'Specialist', 'Dr Name', 'Address', 'Phone', 'Fax', 'Last Visit', 'Next Visit', 'Standard Freq',
  'Status', 'Active or Discontinued', 'Notes']

/** A time typed into a time cell: a Date on Sheets' 1899 epoch. */
const clock = (h: number, m: number) => new Date(Date.UTC(1899, 11, 30, h + 5, m, 0))

function freshBook(): Record<string, Grid | null> {
  return {
    'Dr Appt Archive': [
      ARCHIVE_HEAD,
      [new Date('2026-09-01T16:00:00Z'), 'Kenny Marsh', 'Dr. Ann Smith (Family Practice)', '1 Main St, Canton',
        new Date('2026-09-30T04:00:00Z'), clock(14, 0), 'Yes', 'Yes', 'Secret Manager', '3305550000'],
      ['2023/02/20 11:02:55 AM GMT-3', 'kenny  marsh', 'Mercy Dental', '1320 Mercy Dr NW', 'Tuesday, February 21, 2023',
        '9:05:00 AM', 'No', '', '', ''],
      [new Date('2026-09-02T16:00:00Z'), 'Lia Gomez', 'Dr Other', 'Elsewhere', '10/01/2026', '1:00:00 PM', '', '', '', ''],
      [new Date('2026-08-20T16:00:00Z'), 'Kenny Marsh', 'Dr Jones', '5 Oak Ave', '9/1/2026', '3:20:00 PM', '', '', '', ''],
      [new Date('2026-09-10T16:00:00Z'), 'Kenny Marsh', 'Dr Smith', '1 Main St, Canton', '10/15/2026', '10:00 AM', 'No', '', '', ''],
    ],
    'Future Apts': [
      FUTURE_HEAD,
      ['Kenny Marsh', 'Dr. Ann Smith (Family Practice)', '9/30/2026', '1 Main St, Canton', '2:00:00 PM'],
      ['Kenny Marsh', 'Dr New', '11/2/2026', '9 Elm St', '8:00:00 AM'],
      ['', '', '', '', ''],
      ['', '', '', '', ''],
    ],
    'Dr Master': [
      MASTER_HEAD,
      ['Kenny Marsh', 'Primary', 'Dr. Ann Smith', '1 Main St, Canton', '330-555-0101', '330-555-0102', '', '', '', 'Active', '', ''],
      ['Kenny Marsh', 'Dental', 'Mercy Dental', '1320 Mercy Dr NW', '', '', '', '', 'As needed', '', 'Active', ''],
      ['Kenny Marsh', 'Podiatrist', 'Dr. Bo Jones', '', '', '', '', '', '', 'Old', '', ''],
      ['Kenny Marsh', 'Neurologist', 'Dr. Cy Jones', '', '', '', '', '', '', 'Active', '', ''],
      ['Lia Gomez', 'Primary', 'Dr Other', '', '', '', '', '', '', 'Active', '', ''],
    ],
  }
}

let BOOK = freshBook()
let CLIENTS: Row[] | null = null

function sheetOf(grid: Grid) {
  return {
    getDataRange: () => ({
      getValues: () => grid.map((r) => Array.from({ length: (grid[0] ?? []).length }, (_, i) => r[i] ?? '')),
    }),
  }
}

function formatDate(date: Date, tz: string, pattern: string): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(date)
  if (pattern === 'yyyy-MM-dd') {
    return `${part({ year: 'numeric' })}-${part({ month: '2-digit' }).padStart(2, '0')}-${part({ day: '2-digit' }).padStart(2, '0')}`
  }
  if (pattern === 'HH:mm') return part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/* ---------- Apps Script, booted ---------- */

type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; params?: Record<string, unknown> }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => unknown>
  CS_APPT_ACTIONS: string[]
}

function boot(): Gs {
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, parseInt, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {},
    Utilities: { formatDate },
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'boss@example.org' && !u.visiting_member && !u.is_service,
    hubQuietNow_: () => new Date(NOW),
    cacheRead_: (_scope: string, _name: string, fn: () => unknown) => fn(),
    cacheScopeSheet_: (id: string, tab: string) => `${id}:${tab}`,
    cacheVersion_: () => 1,
    cacheBump_: () => {},
    depNote_: () => {},
    estateSource_: (r: string) => (r === 'drVisits' ? { id: 'drbook', tab: 'Dr Appt Archive', prop: 'ESTATE_DR_ID' }
      : r === 'drAppointments' ? { id: 'drbook', tab: 'Dr Master', prop: 'ESTATE_DR_ID' } : null),
    ssOpen_: (id: string) => {
      if (id !== 'drbook') throw new Error(`no book ${id}`)
      return {
        getSpreadsheetTimeZone: () => 'America/New_York',
        getSheetByName: (tab: string) => (BOOK[tab] ? sheetOf(BOOK[tab] as Grid) : null),
      }
    },
    clientsDerived_: () => {
      if (!CLIENTS) throw new Error('the plans are closed')
      return CLIENTS
    },
    listRows_: () => [],
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('ClientSourceAppointments.gs'), ctx)
  return ctx as unknown as Gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin', display_name: 'Boss' }
let caller: Row = MASTER

/* ---------- the section's calls, answered by the door ---------- */

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
  BOOK = freshBook()
  CLIENTS = [
    { client_key: KENNY, name: 'Kenny Marsh', home_address: '1 Main St, Canton', medications: ['Secret pill'] },
    { client_key: 'lia_gomez', name: 'Lia Gomez', home_address: '' },
  ]
  caller = MASTER
})

const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}
const noModal = (html: string, what: string) => {
  assert.ok(!html.includes('aria-modal'), `${what}: no aria-modal`)
  assert.ok(!html.includes('role="dialog"') && !html.includes('role="alertdialog"'), `${what}: no dialog role`)
}
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const failed = <T,>(error: string): ReadState<T> => ({ status: 'failed', data: null, error, refreshing: false })
const sourceFiles = () => readdirSync(resolve(ROOT, SOURCES)).filter((f) => /^appointments\.ts$|^AppointmentsTab\.tsx$/.test(f))
  .map((f) => readFileSync(resolve(ROOT, SOURCES, f), 'utf8'))

async function kenny(): Promise<Appointments> {
  return appointmentsOf(await readAppointments(KENNY))
}

describe('the names', () => {
  it('the one door the section names is declared in ClientSourceAppointments.gs and in the generated catalogue', () => {
    const named = new Set<string>()
    for (const src of sourceFiles()) {
      for (const m of src.matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    assert.deepEqual([...named], [APPOINTMENTS_ACTION])
    assert.deepEqual([...GS.CS_APPT_ACTIONS], [APPOINTMENTS_ACTION])
    assert.equal(GS.HUB_POLICY[APPOINTMENTS_ACTION]?.file, 'ClientSourceAppointments.gs')
    assert.equal(GS.HUB_POLICY[APPOINTMENTS_ACTION]?.lane, 'read')
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    assert.ok(catalogue.includes(`"${APPOINTMENTS_ACTION}"`), 'the action is in the generated catalogue')
  })

  it('the rows reach the page through the door alone — no slice, no generic resource read', () => {
    for (const src of sourceFiles()) {
      assert.doesNotMatch(src, /api\.(list|get|create|update)|readSlice|'drVisits'|'drAppointments'/)
    }
  })
})

describe('the read, as the section reads it', () => {
  it('the visits: the client\'s alone, joined by folded name, upcoming soonest first then past newest first', async () => {
    const a = await kenny()
    assert.deepEqual(a.client, { key: KENNY, name: 'Kenny Marsh' })
    assert.deepEqual(a.visits.rows.map((v) => `${v.id}:${v.status}`),
      ['r2:Upcoming', 'r6:Upcoming', 'future:r3:Upcoming', 'r5:Past', 'r3:Past'])
    assert.deepEqual(calls.at(-1), { action: APPOINTMENTS_ACTION, payload: { client: KENNY } })
  })

  it('a row carries the mockup\'s columns: CLIENT, DATE, TIME, DR NAME, DR ADDRESS — from a date cell, a time cell or typed text', async () => {
    const [first, , future, , mercy] = (await kenny()).visits.rows
    assert.deepEqual([first.client, visitDay(first), first.time, first.drName, first.drAddress],
      ['Kenny Marsh', 'Sep 30, 2026', '2:00 PM', 'Dr. Ann Smith (Family Practice)', '1 Main St, Canton'])
    assert.deepEqual([first.van, first.vanAnswer, first.editable, first.witness, first.alsoIn], [true, 'Yes', true, 'Kenny Marsh', ['Future Apts']])
    assert.deepEqual([visitDay(mercy), mercy.time, mercy.van, mercy.vanAnswer], ['Feb 21, 2023', '9:05 AM', false, 'No'])
    assert.deepEqual([future.source, future.editable, visitDay(future), future.time], ['Future Apts', false, 'Nov 2, 2026', '8:00 AM'])
  })

  it('nothing else rides along: another client, the manager columns, the Upcoming? cell, a formula row, the plan', async () => {
    const answer = await readAppointments(KENNY) as { tabs: { visits: { rows: Row[] } } }
    const raw = JSON.stringify(answer)
    for (const word of ['Lia Gomez', 'Dr Other', 'Secret Manager', '3305550000', 'Secret pill']) {
      assert.ok(!raw.includes(word), word)
    }
    for (const row of answer.tabs.visits.rows) {
      for (const key of ['manager', 'manager_phone', 'upcoming']) assert.ok(!(key in row), key)
    }
    assert.equal(answer.tabs.visits.rows.length, 5, 'the blank formula rows of Future Apts are no visit')
  })

  it('the figures and the card\'s line', async () => {
    const a = await kenny()
    assert.deepEqual(a.visits.kpis, { total: 5, upcoming: 3, past: 2, upcomingVan: 1, nextDate: '2026-09-30', lastDate: '2026-09-01' })
    assert.equal(visitsLine(a.visits.kpis), '3 upcoming · 2 past · next Sep 30, 2026 · 1 upcoming with the wheelchair van')
    assert.deepEqual(a.visits.statuses, ['Upcoming', 'Past'])
    assert.equal(a.visits.why, '')
  })

  it('the doctors: Dr Master\'s, active first; a visit names one only on a name no other doctor of the client shares', async () => {
    const a = await kenny()
    assert.deepEqual(a.doctors.rows.map((d) => `${d.specialist}:${d.drName}:${d.status}`),
      ['Dental:Mercy Dental:Active', 'Neurologist:Dr. Cy Jones:Active', 'Primary:Dr. Ann Smith:Active', 'Podiatrist:Dr. Bo Jones:Old'])
    assert.deepEqual(a.doctors.kpis, { total: 4, active: 3, other: 1 })
    const smith = a.doctors.rows.find((d) => d.drName === 'Dr. Ann Smith')!
    assert.deepEqual(doctorNext(smith), { label: 'Sep 30, 2026', hint: 'booked · 2:00 PM' })
    assert.equal(smith.phone, '330-555-0101')
    const mercy = a.doctors.rows.find((d) => d.drName === 'Mercy Dental')!
    assert.deepEqual([doctorNext(mercy).label, dayLabel(mercy.lastSeen)], ['', 'Feb 21, 2023'])
    const jones = a.visits.rows.find((v) => v.drName === 'Dr Jones')!
    assert.equal(jones.doctorId, '', 'two Jones on file: the visit is not pinned to either')
    const first = a.visits.rows[0]
    assert.equal(doctorsFor(first, a.doctors.rows)[0].drName, 'Dr. Ann Smith', 'the visit\'s doctor leads its panel')
    assert.equal(doctorsFor(jones, a.doctors.rows)[0].drName, 'Mercy Dental')
  })

  it('search and All statuses', async () => {
    const rows = (await kenny()).visits.rows
    assert.deepEqual(filterVisits(rows, '', 'Past').map((v) => v.id), ['r5', 'r3'])
    assert.deepEqual(filterVisits(rows, '', 'Upcoming').length, 3)
    assert.deepEqual(filterVisits(rows, 'main st', '').map((v) => v.id), ['r2', 'r6'])
    assert.deepEqual(filterVisits(rows, 'sep 30', '').map((v) => v.id), ['r2'])
    assert.deepEqual(filterVisits(rows, 'mercy', 'Upcoming'), [])
  })

  it('the table: the newest day on top, upcoming and past alike, an undated visit last', async () => {
    const rows = newestFirst((await kenny()).visits.rows)
    const days = rows.map((r) => r.date).filter(Boolean)
    assert.ok(days.length > 1)
    assert.deepEqual(days, [...days].sort().reverse())
    const undated = rows.findIndex((r) => !r.date)
    assert.ok(undated === -1 || rows.slice(undated).every((r) => !r.date))
  })

  it('a Future Apts tab that is gone says so, and the archive\'s figures stand', async () => {
    BOOK['Future Apts'] = null
    const a = await kenny()
    assert.match(a.visits.why, /Future Apts tab could not be read/)
    assert.equal(a.visits.kpis?.total, 4)
    assert.ok(!a.visits.rows.some((v) => v.source === 'Future Apts'))
  })

  it('an archive that is gone is never an empty list dressed as zero', async () => {
    BOOK['Dr Appt Archive'] = null
    const a = await kenny()
    assert.match(a.visits.why, /Dr Appt Archive answered no row at all/)
    assert.equal(a.visits.kpis, null)
    assert.equal(visitsLine(a.visits.kpis), '')
    assert.deepEqual(a.visits.rows.map((v) => v.id), ['future:r2', 'future:r3'], 'what Future Apts could give still shows')
    BOOK = freshBook()
    BOOK['Dr Master'] = null
    const b = await kenny()
    assert.match(b.doctors.why, /Dr Master tab answered no row at all/)
    assert.equal(b.doctors.kpis, null)
  })

  it('refusals: not the master is the unknown-action 404, an unknown client is 404, unreadable plans are 503', async () => {
    caller = { email: 'admin@example.org', role: 'admin' }
    const refused = await readAppointments(KENNY).catch((e: Error) => e)
    assert.ok(refused instanceof Error)
    assert.equal(apptRefusal(refused.message), NOT_PUBLISHED)
    caller = { ...MASTER, visiting_member: 'mem_1' }
    await assert.rejects(readAppointments(KENNY), /Unknown action/)
    caller = MASTER
    await assert.rejects(readAppointments('nobody_here'), /No client with that key is on file/)
    CLIENTS = null
    await assert.rejects(readAppointments(KENNY), /clients could not be read/)
  })
})

describe('the section, drawn', () => {
  it('search, All statuses and the mockup\'s columns, each row with its pencil; no dialog', async () => {
    const a = await kenny()
    const html = draw(<AppointmentsView state={ready(a)} query="" status="" onQuery={noop} onStatus={noop} onOpen={noop} onRetry={noop} />)
    const heads = [...html.matchAll(/<th class="[^"]*">([^<]*)<\/th>/g)].map((m) => m[1])
    assert.deepEqual(heads, ['Client', 'Date', 'Time', 'Dr name', 'Dr address'])
    assert.ok(html.includes('placeholder="Search appointments…"'))
    assert.ok(html.includes('>All statuses</option>') && html.includes('>Upcoming</option>') && html.includes('>Past</option>'))
    assert.equal((html.match(/data-visit="/g) ?? []).length, 5)
    assert.equal((html.match(/data-pencil="/g) ?? []).length, 5)
    assert.ok(html.includes('Doctors on file · 4'))
    assert.ok(html.includes('3 upcoming · 2 past'))
    noModal(html, 'table')
  })

  it('a filter that hides every row says so; a source that did not answer says why', async () => {
    const a = await kenny()
    const none = draw(<AppointmentsView state={ready(a)} query="zzz" status="" onQuery={noop} onStatus={noop} onOpen={noop} onRetry={noop} />)
    assert.ok(none.includes('No appointment matches this search.'))
    BOOK['Dr Appt Archive'] = null
    const gone = await kenny()
    const html = draw(<AppointmentsView state={ready(gone)} query="" status="" onQuery={noop} onStatus={noop} onOpen={noop} onRetry={noop} />)
    assert.ok(html.includes('data-why="visits"') && html.includes('answered no row at all'))
    assert.ok(!html.includes('0 upcoming'), 'no figure is drawn for a source that did not answer')
  })

  it('a read the server does not know says the door is not published', () => {
    const html = draw(<AppointmentsView state={failed<Appointments>('Unknown action.')} query="" status="" onQuery={noop}
      onStatus={noop} onOpen={noop} onRetry={noop} />)
    assert.ok(html.includes('role="alert"') && html.includes(NOT_PUBLISHED))
  })

  it('the pencil opens the right panel: the visit whole and the client\'s doctors, its own first', async () => {
    const a = await kenny()
    const html = draw(<AppointmentsPanel ask={{ kind: 'visit', id: 'r2' }} state={ready(a)} onClose={noop} />)
    assert.match(html, /<aside aria-label="Appointment"/)
    assert.ok(html.includes('>Dr. Ann Smith (Family Practice)</h2>'))
    for (const w of ['Kenny Marsh', 'Sep 30, 2026', '2:00 PM', '1 Main St, Canton', 'Yes', 'Also on Future Apts', 'Dr Master']) {
      assert.ok(html.includes(w), w)
    }
    assert.ok(html.indexOf('data-doctor="r2"') < html.indexOf('data-doctor="r3"'), 'this visit\'s doctor leads')
    assert.ok(html.includes('This visit&#x27;s doctor') && html.includes('booked · 2:00 PM'))
    assert.ok(html.includes('href="tel:3305550101"'))
    noModal(html, 'visit panel')
    const doctors = draw(<AppointmentsPanel ask={{ kind: 'doctors' }} state={ready(a)} onClose={noop} />)
    assert.match(doctors, /<aside aria-label="Doctors"/)
    assert.equal((doctors.match(/data-doctor="/g) ?? []).length, 4)
    noModal(doctors, 'doctors panel')
    assert.equal(draw(<AppointmentsPanel ask={null} state={ready(a)} onClose={noop} />), '')
    const gone = draw(<AppointmentsPanel ask={{ kind: 'visit', id: 'r99' }} state={ready(a)} onClose={noop} />)
    assert.ok(gone.includes('data-gone=""'))
  })

  it('New Appointment and New Doctor: in the header for the master or a holder of each edition, each its own form', async () => {
    const a = await kenny()
    const view = (reader: ClientReader) => draw(
      <ClientReaderContext.Provider value={reader}>
        <AppointmentsView state={ready(a)} query="" status="" onQuery={noop} onStatus={noop} onOpen={noop} onRetry={noop} />
      </ClientReaderContext.Provider>)
    const master = view({ viewer: 'master', mayWrite: true })
    assert.ok(master.includes('data-open="new-visit"') && master.includes('New Appointment'))
    assert.ok(master.includes('data-open="new-doctor"') && master.includes('New Doctor'))
    assert.ok(master.indexOf('data-open="doctors"') < master.indexOf('data-open="new-doctor"'))
    const booker = view({ viewer: 'all', mayWrite: false, editions: ['clients.appointments'] })
    assert.ok(booker.includes('data-open="new-visit"') && !booker.includes('data-open="new-doctor"'))
    assert.ok(booker.includes('aria-label="Edit the appointment of'), 'the pencil edits for a holder')
    const adder = view({ viewer: 'all', mayWrite: false, editions: ['clients.doctors'] })
    assert.ok(!adder.includes('data-open="new-visit"') && adder.includes('data-open="new-doctor"'))
    const reader = view({ viewer: 'all', mayWrite: false, editions: [] })
    assert.ok(!reader.includes('data-open="new-visit"') && !reader.includes('data-open="new-doctor"'))
    assert.ok(!reader.includes('aria-label="Edit the appointment of'))
    const family = view({ viewer: 'guardian', mayWrite: false, editions: ['clients.appointments', 'clients.doctors'] })
    assert.ok(!family.includes('data-open="new-visit"') && !family.includes('data-open="new-doctor"'))

    const booking = draw(<AppointmentsPanel ask={{ kind: 'new-visit' }} state={ready(a)} client={KENNY} clientName="Kenny Marsh"
      onClose={noop} />)
    assert.match(booking, /<aside aria-label="Kenny Marsh"/)
    assert.ok(booking.includes('>New Appointment</h2>') && booking.includes('data-new-visit=""'))
    assert.ok(booking.includes('>Choose a doctor on file</option>') && booking.includes('>Another doctor…</option>'))
    assert.ok(booking.includes('>Dr. Ann Smith · Primary</option>') && booking.includes('>Mercy Dental · Dental</option>'))
    for (const f of ['date', 'time', 'dr_address', 'van']) assert.ok(booking.includes(`data-new="${f}"`), f)
    assert.ok(booking.includes('type="date"') && booking.includes('type="time"'))
    noModal(booking, 'new visit panel')
    const adding = draw(<AppointmentsPanel ask={{ kind: 'new-doctor' }} state={ready(a)} client={KENNY} clientName="Kenny Marsh"
      onClose={noop} />)
    assert.ok(adding.includes('>New Doctor</h2>') && adding.includes('data-new-doctor=""'))
    for (const f of ['dr_name', 'specialist', 'phone', 'fax', 'address', 'standard_freq', 'notes']) {
      assert.ok(adding.includes(`data-new="${f}"`), f)
    }
    noModal(adding, 'new doctor panel')
    const shut = draw(
      <ClientReaderContext.Provider value={{ viewer: 'all', mayWrite: false, editions: [] }}>
        <AppointmentsPanel ask={{ kind: 'new-visit' }} state={ready(a)} client={KENNY} onClose={noop} />
      </ClientReaderContext.Provider>)
    assert.ok(!shut.includes('data-new-visit'), 'no form for a reader without the edition')

    assert.deepEqual(newVisitMissing(NEW_VISIT), ['Doctor', 'Date'])
    assert.deepEqual(newVisitMissing({ ...NEW_VISIT, dr_name: 'Dr Smith', date: '2026-11-20' }), [])
    assert.deepEqual(filledFields({ ...NEW_VISIT, dr_name: ' Dr Smith ', date: '2026-11-20' }),
      { dr_name: 'Dr Smith', date: '2026-11-20', van: 'No' })
  })

  it('the section opens reading, and its panel rides the address', () => {
    const html = draw(<AppointmentsTab client={KENNY} panel={null} onPanel={noop} />)
    assert.ok(html.includes('data-read="loading"'))
    for (const ask of [{ kind: 'visit', id: 'future:r3' }, { kind: 'doctors' }, { kind: 'new-visit' },
      { kind: 'new-doctor' }] as ApptPanel[]) {
      assert.deepEqual(apptPanelOf(apptPanelParam(ask)), ask)
    }
    assert.equal(apptPanelOf('visit'), null)
    assert.equal(apptPanelOf('elsewhere~x'), null)
    assert.deepEqual([statusTint('Upcoming'), statusTint('Past'), statusTint('Active'), statusTint('Discontinued')],
      ['blue', 'slate', 'mint', 'amber'])
  })
})
