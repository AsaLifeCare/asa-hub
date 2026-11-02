/**
 * CLIENTS › MEDICATION › REFILLS — the tab against its two doors.
 *
 *   forms      every call the tab makes to Apps Script is caught at `fetch` and handed to ClientSourceRefills.gs itself,
 *              run here on an in-memory Missing Medications book; the answer is read by the tab's own reader and model
 *   pharmacy   the relay's House Supplies door is answered with its own shape, WHOLE (as a relay that does not know
 *              `?client=` yet answers it), so the narrowing on this side is what is proved
 *   screen     the five columns, the search and the status filter, every row opening in the right side panel, and a
 *              source that could not be read saying why instead of drawing an empty table
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import type { MedsPatient, MedsRx, MedsView } from '@/lib/houseMedsAnalysis'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import SidePanel from '@/components/shared/SidePanel'
import {
  NO_DAYS_SUPPLY, REFILLS_ACTION, REFILLS_NOT_PUBLISHED, clientRx, companyToday, daysBetween, filterRefillRows,
  forgetRefillReads, formView, pharmacyPath, pharmacyView, readPharmacy, readRefillForms, readRxHistory, refillsModel,
  rxStatus, statusTint, useClientRefills, type RefillRow, type RefillsModel, type SourceState,
} from '@/pages/features/clientprofiles/sources/refills'
import RefillsTab, { RefillDetail, RefillTable, RefillsView } from '@/pages/features/clientprofiles/sources/RefillsTab'
import { NOT_OPEN } from '@/pages/features/clientprofiles/clientViewer'
import { mountHook } from './react-host'

// motion mounts its projection nodes against the window; a screen drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const TODAY = '2026-09-28'
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const gsText = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')

/** One top-level function of a .gs file, exactly as written there. */
function lift(file: string, name: string): string {
  const src = gsText(file)
  const fn = src.indexOf(`\nfunction ${name}(`)
  assert.notEqual(fn, -1, `${file} has no ${name}`)
  return src.slice(fn + 1, src.indexOf('\n}', fn + 1) + 2)
}

/* ---------- the stores ---------- */

type Grid = string[][]
type Row = Record<string, unknown>

function freshBook(): Record<string, Grid> {
  return {
    'Form Responses 4': [
      ['Status', 'Column 1', 'Timestamp', 'Your Name', 'Select Client:', 'Ann Test : Medications', 'Bob Test : Medications',
        "What's the issue related?", 'Expected date to run out of medication',
        'If you don’t see the missing medication above, please tell us here:'],
      ['Completed', 'Called 29/09', '9/22/2026 9:51:14', 'Sam Staff', 'Ann Test', 'LORAZEPAM TAB 0.5MG', '', 'Not delivered',
        '9/30/2026', ''],
      ['Outstanding', '', '9/27/2026 13:01:01', 'Sam Staff', 'Ann Test', 'CITALOPRAM TAB 20MG', '', 'Partially Delivered',
        '10/6/2026', ''],
      ['', '', '9/28/2026 8:00:00', 'Lee Staff', 'Bob Test', '', 'BOB ONLY DRUG', 'Not delivered', '10/2/2026', ''],
    ],
    'Form Responses 1': [
      ['Status', 'Timestamp', 'Your Name', 'Client Name', 'Issue Description', 'Medication(s) Name',
        'Expected date to run out of medication', 'House', 'Dr', 'OTC', 'Notes'],
      ['Resolved', '10/4/2024 12:29:48', 'Old Staff', 'ANN TEST', 'Low', 'VITAMIN D3', '12/1/2024', '48th (A)', 'Dr One', 'Yes', ''],
    ],
    'Low Refills': [
      ['Dr', 'Med', 'OTC', 'Dr #', 'House', 'Notes', 'Client', 'Status', 'Manager', 'Contact Dr', '# of Refills',
        'Important Med?', 'Finney\'s Received'],
      ['Dr One', 'GABAPENTIN CAP 400MG', 'Script Req', '3305550100', '48th (A)', 'check Mon', 'Ann Test', 'Completed',
        'Hal Manager', 'Thursday, December 12, 2024', '2', 'Yes', 'y'],
    ],
    'Medication Control': [
      ['Client Name', 'Medication Name', 'Physician Name', 'Physian NO.', 'Qty Written', 'Qty Dispensed', 'Qty Remaining',
        'Days Supply', 'Buffer Days', 'Refill Status', 'Next Refill Due', 'Notes / Action Needed'],
      ['Ann Test', 'OMEPRAZOLE CAP 40MG', 'Dr One', '', '', '', '', '', '', '', '', 'TAKE 1 CAPSULE DAILY'],
    ],
  }
}

let BOOK = freshBook()
let BOOK_OPENS = true
const CLIENTS: Row[] = [{ client_key: 'st_ann', name: 'Ann Test' }, { client_key: 'st_bob', name: 'Bob Test' }]

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
  CSR_ACTIONS: string[]
}

function boot(): Gs {
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {},
    Utilities: { formatDate },
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'boss@example.org' && !u.visiting_member && !u.is_service,
    hubProp_: () => '',
    cacheRead_: (_scope: string, _name: string, fn: () => unknown) => fn(),
    cacheBump_: () => {},
    locationsToday_: () => TODAY,
    clientsDerived_: () => CLIENTS.map((c) => ({ ...c })),
    listRows_: () => [],
    ssOpen_: () => {
      if (!BOOK_OPENS) throw new Error('no access')
      return {
        getSheetByName: (tab: string) => (BOOK[tab] ? {
          getDataRange: () => ({ getDisplayValues: () => BOOK[tab].map((r) => r.slice()) }),
        } : null),
      }
    },
  }
  const ctx = vm.createContext(g)
  const helpers = [['Clients.gs', 'clientNameKey_'], ['Talent.gs', 'str_'], ['Main.gs', 'hubAddrKey_'],
    ['Main.gs', 'hubClientIdentity_']] as const
  vm.runInContext(helpers.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('ClientSourceRefills.gs'), ctx)
  return ctx as unknown as Gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin' }

/* ---------- the relay's House Supplies answer ---------- */

const patient = (over: Partial<MedsPatient>): MedsPatient => ({
  patid: 'T1', key: 'T1', group: 'house', house: 'ABD1711', house_label: '48TH (B)', client_key: 'st_ann',
  client_name: 'Ann Test', initials: 'A.T.', match: 'auto', note: '', same_as: '', last_seen: '2026-08-29',
  facilities: ['ASLIFE'], ...over,
})

const rx = (over: Partial<MedsRx>): MedsRx => ({
  rx_root: 'r1', patid: 'T1', patient: 'T1', drug: 'LISINOPRIL 10 MG TABLET', physician: 'DR ONE', sig: 'TAKE 1 DAILY',
  date_written: '2026-01-02', last_dispense: '2026-08-20', dispensed_in_period: '30', qty_written: '300',
  qty_remaining: '120', qty_dispensed_to_date: '180', cutoff: '', report_end: '2026-08-29',
  first_report_end: '2026-01-31', reports_seen: 6, labels: ['LISINOPRIL 10MG TAB', 'LISINOPRIL 10 MG TABLET'],
  sum_dispensed: '180', current: true, maybe_same_as: '', facility: 'ASLIFE', ...over,
})

const MEDS: MedsView = {
  version: 'v1', pharmacy: 'A Brighter Dawn',
  scope: { every_house: true, houses: [], writer: true, why: '' },
  latest: { start: '2026-08-15', end: '2026-08-29' },
  periods: [{ import_id: 'MI-3', start: '2026-08-15', end: '2026-08-29', file_name: 'c', lines: 5, facility: 'ASLIFE' }],
  gaps: [], facilities: [{ facility: 'ASLIFE', from: '2026-08-15' }],
  summary: { reports: 1, duplicates: 0, held: 0, invalid: 0, failed: 0, house_pending: 0 },
  patients: [
    patient({}),
    // a second PatID the pharmacy keeps for the same client, folded under T1 by a person's "same as"
    patient({ patid: 'T9', key: 'T1', same_as: 'T1' }),
    patient({ patid: 'T2', key: 'T2', client_key: 'st_bob', client_name: 'Bob Test', initials: 'B.T.' }),
    patient({ patid: 'T3', key: 'T3', group: 'unmatched', house: '', client_key: '', client_name: '', match: 'none' }),
    // a fold whose own name fell to review: it keeps its head's client and key, and House Supplies lists it unmatched
    patient({ patid: 'T8', key: 'T1', same_as: 'T1', group: 'unmatched', match: 'review',
              note: 'this PatID now reports a different name' }),
  ],
  rx: [
    rx({}),
    rx({ rx_root: 'r2', drug: 'METFORMIN 500MG', labels: ['METFORMIN 500MG'], qty_remaining: '5', physician: 'DR TWO' }),
    rx({ rx_root: 'r3', drug: 'ASPIRIN 81MG', labels: ['ASPIRIN 81MG'], qty_remaining: '0' }),
    rx({ rx_root: 'r4', patid: 'T9', drug: 'VITAMIN D', labels: ['VITAMIN D'], cutoff: '2026-08-20' }),
    rx({ rx_root: 'r5', drug: 'OLD DRUG', labels: ['OLD DRUG'], current: false }),
    rx({ rx_root: 'r6', drug: 'BLANK LEFT', labels: ['BLANK LEFT'], qty_remaining: '', cutoff: '2026-10-15' }),
    rx({ rx_root: 'r7', patid: 'T2', patient: 'T2', drug: 'BOB ONLY RX', labels: ['BOB ONLY RX'] }),
    rx({ rx_root: 'r8', patid: 'T3', patient: 'T3', drug: 'UNMATCHED RX', labels: ['UNMATCHED RX'] }),
    rx({ rx_root: 'r9', patid: 'T8', patient: 'T1', drug: 'IN REVIEW RX', labels: ['IN REVIEW RX'] }),
  ],
  folder: {}, sweep: {}, low_left: 7, period_days: 15,
}

const HISTORY = {
  rx_root: 'r2', patient: 'T1', sum_dispensed: '60', cumulative: '90', not_in_reports: '30',
  rows: [{ report_start: '2026-08-01', report_end: '2026-08-14', drug: 'METFORMIN 500MG', physician: 'DR TWO',
           last_dispense: '2026-08-05', dispensed_in_period: '30', qty_remaining: '35', qty_dispensed_to_date: '60', cutoff: '' }],
}

/* ---------- the tab's calls, answered by the doors ---------- */

const gasCalls: { action: string; payload: Row }[] = []
const laneCalls: string[] = []
let caller: Row = MASTER
let network = true
let relayRefusal: Row | null = null
const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (!network) throw new TypeError('fetch failed')
    if (String(url).startsWith('/erp-lanes/')) {
      laneCalls.push(String(url))
      if (relayRefusal) return new Response(JSON.stringify(relayRefusal))
      if (String(url).startsWith('/erp-lanes/house-supplies/meds/rx?')) {
        const key = new URL(String(url), 'https://x.test').searchParams.get('key')
        return new Response(JSON.stringify(key === 'r2' ? { status: 200, data: HISTORY }
          : { status: 404, reason: 'missing', message: 'No such prescription.' }))
      }
      return new Response(JSON.stringify({ status: 200, data: MEDS }))
    }
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Row }
    gasCalls.push({ action: env.action, payload: env.payload ?? {} })
    const door = GS.HUB_ACTIONS[env.action]
    const out = door ? door(JSON.parse(JSON.stringify(env.payload ?? {})), caller) : { status: 404, message: 'Unknown action.' }
    return new Response(JSON.stringify(out))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  BOOK = freshBook()
  BOOK_OPENS = true
  caller = MASTER
  network = true
  relayRefusal = null
  gasCalls.length = 0
  laneCalls.length = 0
  forgetRefillReads()
})

/** The first element of a type in what a screen returned, walked through children as returned (never rendered). */
function findEl(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findEl(n, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node as ReactElement<Record<string, unknown>>
  return findEl((node.props as { children?: ReactNode }).children, type)
}

const ready = <T,>(data: T): SourceState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const failed = <T,>(error: string, data: T | null = null): SourceState<T> => ({ status: 'failed', data, error, refreshing: false })

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

describe('the names', () => {
  it('every door the tab names is a ClientSourceRefills.gs read, in the generated catalogue', () => {
    const named = new Set<string>()
    for (const f of walk('src/pages/features/clientprofiles/sources').filter((p) => /refills/i.test(p))) {
      const src = readFileSync(resolve(ROOT, f), 'utf8')
      for (const m of src.matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    assert.deepEqual([...named].sort(), [...GS.CSR_ACTIONS].sort())
    assert.deepEqual([...named], [REFILLS_ACTION])
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of named) {
      assert.equal(GS.HUB_POLICY[name]?.file, 'ClientSourceRefills.gs')
      assert.equal(GS.HUB_POLICY[name]?.lane, 'read')
      assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
    }
  })

  it('the pharmacy is read through the House Supplies door, narrowed by ?client= behind the Clients app\'s release', () => {
    assert.equal(pharmacyPath('st ann'), '/erp-lanes/house-supplies/meds?client=st%20ann')
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    assert.match(relay, /async def erp_house_meds\(response: Response, since: str = "", client: str = ""/)
    assert.match(relay, /async def erp_house_meds_rx\(response: Response, key: str = "", client: str = ""/)
    // the master flag is learned before it is judged, then the release (tools/test-house-meds.py runs the door itself)
    assert.match(relay, /unsure = await _my_work_learn_master\(authorization\)\n/)
    assert.match(relay, /if await _app_pack_released\(authorization, "client-profiles"\):/)
    assert.equal((relay.match(/shut = await _meds_client_reader\(authorization\)/g) ?? []).length, 2)
  })
})

describe('the forms door, run as Apps Script', () => {
  it('reads the client\'s reports, Low Refills and Medication Control, and nothing of another client', async () => {
    const got = await readRefillForms('st_ann')
    assert.deepEqual(gasCalls, [{ action: 'clientSourceRefills', payload: { client: 'st_ann' } }])
    assert.equal(got.client, 'st_ann')
    assert.equal(got.degraded, false)
    assert.ok(!JSON.stringify(got).includes('BOB ONLY'))
    const reports = formView(ready(got), 'reports')
    assert.equal(reports.state, 'ready')
    assert.deepEqual(reports.rows.map((r) => [r.record, r.date, r.status]), [
      ['CITALOPRAM TAB 20MG', '2026-09-27', 'Outstanding'],
      ['LORAZEPAM TAB 0.5MG', '2026-09-22', 'Completed'],
      ['VITAMIN D3', '2024-10-04', 'Resolved'],
    ])
    assert.equal(reports.rows[0].details, 'Partially Delivered · runs out Oct 6, 2026')
    assert.deepEqual(reports.kpis.map((k) => `${k.label}=${k.value}`),
      ['Reports=3', 'Open=1', 'Next expected run-out=Oct 6, 2026', 'Last report=Sep 27, 2026'])
    assert.equal(reports.asOf, 'Newest report on the form: Sep 28, 2026')
    const fields = Object.fromEntries(reports.rows[1].fields.map((f) => [f.label, f.value]))
    assert.equal(fields.Reported, 'Sep 22, 2026, 09:51')
    assert.equal(fields['Office note'], 'Called 29/09')
    assert.equal(fields['Expected to run out'], 'Sep 30, 2026')
    assert.deepEqual(reports.statuses, ['Outstanding', 'Completed', 'Resolved'])

    const low = formView(ready(got), 'low_refills')
    assert.equal(low.rows[0].details, 'Refills: 2 · Script Req · Dr One')
    assert.equal(low.rows[0].date, '2024-12-12')
    assert.deepEqual(low.kpis.map((k) => k.value), ['1', '0'])

    const control = formView(ready(got), 'control')
    assert.equal(control.rows[0].status, 'No due date')
    assert.match(control.note, /writes no Days Supply or Next Refill Due/)
  })

  it('a book that cannot be opened answers each tab with why — never an empty table dressed as none', async () => {
    BOOK_OPENS = false
    const got = await readRefillForms('st_ann')
    assert.equal(got.degraded, true)
    for (const tab of ['reports', 'low_refills', 'control'] as const) {
      const v = formView(ready(got), tab)
      assert.equal(v.state, 'failed', tab)
      assert.match(v.why, /could not be opened \(no access\)/, tab)
      assert.deepEqual(v.kpis, [], tab)
    }
  })

  it('a caller who is not the master meets the door\'s 404, drawn as "not published", and each view says so', async () => {
    caller = { email: 'mgr@example.org', role: 'manager' }
    await assert.rejects(readRefillForms('st_ann'), (err: Error & { status?: number }) => err.status === 404)
    const v = formView(failed('Unknown action.'), 'reports')
    assert.equal(v.state, 'failed')
    assert.equal(v.why, REFILLS_NOT_PUBLISHED)
  })

  it('a refresh that fails keeps the last rows and says so above them', async () => {
    const got = await readRefillForms('st_ann')
    const v = formView(failed('Network error — could not reach the server.', got), 'reports')
    assert.equal(v.state, 'ready')
    assert.equal(v.rows.length, 3)
    assert.match(v.why, /^The last read failed: Network error/)
  })
})

describe('the pharmacy, banded as House Supplies bands it', () => {
  it('narrows the whole answer to the client (a folded PatID too, never one in review), current families first by band', async () => {
    const view = await readPharmacy('st_ann')
    assert.deepEqual(laneCalls, ['/erp-lanes/house-supplies/meds?client=st_ann'])
    assert.deepEqual(clientRx(view, 'st_ann').map((r) => r.rx_root).sort(), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
    const v = pharmacyView(ready(view), 'st_ann', TODAY, false)
    assert.deepEqual(v.rows.map((r) => [r.record, r.status]), [
      ['VITAMIN D', 'Ending'], ['ASPIRIN 81MG', 'None left'], ['METFORMIN 500MG', 'Low'], ['BLANK LEFT', 'Not stated'],
      ['LISINOPRIL 10 MG TABLET', 'OK'],
    ])
    assert.ok(!v.rows.some((r) => /BOB ONLY|UNMATCHED|IN REVIEW/.test(r.record)))
    assert.ok(!pharmacyView(ready(view), 'st_ann', TODAY, true).rows.some((r) => r.rxRoot === 'r9'))
    const metformin = v.rows.find((r) => r.rxRoot === 'r2')!
    assert.equal(metformin.date, '2026-08-20')
    assert.equal(metformin.details, '5 left on Rx · 39 days since dispensed · DR TWO')
    const blank = v.rows.find((r) => r.rxRoot === 'r6')!
    assert.equal(blank.details, 'Left on Rx not stated · 39 days since dispensed · Ends Oct 15 · DR ONE')
    assert.deepEqual(v.kpis.map((k) => `${k.label}=${k.value}`), ['Current prescriptions=5', 'Low or none left=2',
      'Ending this report=1', 'Next refill cutoff=Oct 15, 2026'])
    assert.equal(v.note, NO_DAYS_SUPPLY)
    assert.match(v.note, /no days' supply/)
    assert.equal(v.asOf, 'Latest pharmacy report: Aug 15 – Aug 29, 2026')
    const fields = Object.fromEntries(metformin.fields.map((f) => [f.label, f.value]))
    assert.equal(fields['Left on Rx'], '5')
    assert.equal(fields['Refill cutoff'], 'None written')
    assert.equal(fields['Days since dispensed'], '39')
    const past = pharmacyView(ready(view), 'st_ann', TODAY, true)
    assert.equal(past.rows.at(-1)?.status, 'Not current')
    assert.equal(past.kpis[0].value, '5')
  })

  it('a client with no matched PatID is an empty table with the sentence, never another resident', () => {
    const v = pharmacyView(ready(MEDS), 'st_nobody', TODAY, true)
    assert.equal(v.rows.length, 0)
    assert.match(v.empty, /House Supplies › Medications/)
  })

  it('the relay\'s badge refusal is the plain "not open" words with no alert; any other refusal is the view\'s why; the band words carry their tints', async () => {
    relayRefusal = { status: 403, reason: 'badge', message: "One client's prescriptions are not open to this account." }
    await assert.rejects(readPharmacy('st_ann'), (err: Error) => err.message === NOT_OPEN)
    await assert.rejects(readRxHistory('r2', 'st_ann'), (err: Error) => err.message === NOT_OPEN)
    const shut = pharmacyView(failed(NOT_OPEN), 'st_ann', TODAY, false)
    assert.deepEqual([shut.state, shut.shut, shut.why, shut.note], ['failed', true, '', ''])
    relayRefusal = { status: 403, reason: 'unreadable', message: 'The access check failed (Timeout), so the door stays closed.' }
    await assert.rejects(readPharmacy('st_ann'), /access check failed/)
    const v = pharmacyView(failed('The access check failed (Timeout), so the door stays closed.'), 'st_ann', TODAY, false)
    assert.equal(v.state, 'failed')
    assert.ok(!v.shut)
    assert.match(v.why, /access check failed/)
    relayRefusal = { status: 503, reason: 'unknown', message: 'The master check could not be made (ReadTimeout), so ' +
      "one client's prescriptions are not shown. Try again." }
    await assert.rejects(readPharmacy('st_ann'), (err: Error & { status?: number; reason?: string }) =>
      err.status === 503 && err.reason === 'unknown' && /master check could not be made/.test(err.message))
    assert.deepEqual(['Ending', 'None left', 'Low', 'OK', 'Not stated', 'Outstanding', 'Completed', 'Due', 'Scheduled']
      .map(statusTint), ['lavender', 'danger', 'amber', 'mint', 'slate', 'amber', 'mint', 'danger', 'blue'])
    assert.equal(rxStatus(rx({ current: false }), MEDS), 'Not current')
  })

  it('a prescription\'s history is the House Supplies history door, asked for the client behind the Clients gate', async () => {
    const h = await readRxHistory('r2')
    assert.equal(h.cumulative, '90')
    assert.equal((await readRxHistory('r2', 'st ann')).cumulative, '90')
    assert.deepEqual(laneCalls, ['/erp-lanes/house-supplies/meds/rx?key=r2',
      '/erp-lanes/house-supplies/meds/rx?key=r2&client=st%20ann'])
  })
})

describe('the words', () => {
  it('days, the company\'s today, and the search over every field', () => {
    assert.equal(daysBetween('2026-08-20', TODAY), 39)
    assert.equal(daysBetween('', TODAY), null)
    assert.equal(companyToday(new Date('2026-09-29T02:00:00Z')), '2026-09-28')
    const v = pharmacyView(ready(MEDS), 'st_ann', TODAY, false)
    assert.deepEqual(filterRefillRows(v.rows, 'dr two', '').map((r) => r.rxRoot), ['r2'])
    assert.deepEqual(filterRefillRows(v.rows, 'take 1 daily', 'Low').map((r) => r.rxRoot), ['r2'])
    assert.deepEqual(filterRefillRows(v.rows, '', 'OK').map((r) => r.rxRoot), ['r1'])
  })
})

describe('the hook', () => {
  it('reads both doors for the client; one failing never blanks the other, and a failed refresh keeps the rows', async () => {
    const m = mountHook((c: string) => useClientRefills(c), 'st_ann')
    await m.settle(() => m.current.forms.status === 'ready' && m.current.pharmacy.status === 'ready')
    assert.equal(m.current.forms.data?.client, 'st_ann')
    assert.equal(m.current.pharmacy.data?.version, 'v1')
    network = false
    m.run(() => m.current.reload())
    await m.settle(() => m.current.forms.status === 'failed' && m.current.pharmacy.status === 'failed')
    assert.equal(m.current.forms.data?.client, 'st_ann')
    assert.equal(m.current.pharmacy.data?.version, 'v1')
    const model = refillsModel({ client: 'st_ann', todayIso: TODAY, showPast: false, forms: m.current.forms, pharmacy: m.current.pharmacy })
    assert.ok(model.views.every((v) => v.state === 'ready' && /The last read failed/.test(v.why)))
    m.unmount()
  })

  it('a held answer is drawn at once for the next mount, within the minute', async () => {
    const first = mountHook((c: string) => useClientRefills(c), 'st_ann')
    await first.settle(() => first.current.forms.status === 'ready' && first.current.pharmacy.status === 'ready')
    first.unmount()
    const calls = gasCalls.length + laneCalls.length
    const second = mountHook((c: string) => useClientRefills(c), 'st_ann')
    assert.equal(second.current.forms.status, 'ready')
    assert.equal(second.current.pharmacy.status, 'ready')
    await second.settle(() => false)
    assert.equal(gasCalls.length + laneCalls.length, calls)
    second.unmount()
  })
})

describe('the screen', () => {
  const model = async () => {
    const forms = await readRefillForms('st_ann')
    return refillsModel({ client: 'st_ann', todayIso: TODAY, showPast: false, forms: ready(forms), pharmacy: ready(MEDS) })
  }

  it('draws the pharmacy table in the five columns, the search, All statuses, the figures and the no-days-supply line', async () => {
    const html = flat(renderToString(<RefillsView model={await model()} onRetry={() => {}} onShowPast={() => {}} />))
    for (const head of ['Record', 'Date', 'Details', 'Status', 'Action']) assert.ok(html.includes(`>${head}</th>`), head)
    assert.ok(html.includes('placeholder="Search this view…"'))
    assert.ok(html.includes('>All statuses</option>'))
    assert.ok(html.includes('data-record-table="pharmacy"'))
    assert.ok(html.includes('Pharmacy (5)') && html.includes('Missing reports (3)') && html.includes('Low refills (1)') &&
      html.includes('Medication control (1)'))
    assert.ok(html.includes('data-status="Ending"') && html.includes('data-kpi="Next refill cutoff"'))
    assert.ok(html.includes('aria-label="Open METFORMIN 500MG"'))
    assert.ok(html.includes("The pharmacy&#x27;s report carries no days&#x27; supply"))
    assert.ok(html.includes('Show prescriptions no longer in the reports'))
    assert.ok(!/role="dialog"/.test(html))
  })

  it('draws another source first when asked, and a source that could not be read says why with no table', async () => {
    const m = await model()
    const reports = flat(renderToString(<RefillsView model={m} onRetry={() => {}} initialView="reports" />))
    assert.ok(reports.includes('data-record-table="reports"') && reports.includes('CITALOPRAM TAB 20MG'))
    assert.ok(reports.includes('Newest report on the form: Sep 28, 2026'))
    const broken = refillsModel({ client: 'st_ann', todayIso: TODAY, showPast: false,
      forms: failed('Unknown action.'), pharmacy: ready(MEDS) })
    const html = flat(renderToString(<RefillsView model={broken} onRetry={() => {}} initialView="low_refills" />))
    assert.ok(html.includes('data-read="why"') && html.includes('the Refills door answers once its Apps Script is published'))
    assert.ok(!html.includes('data-record-table="low_refills"'))
    const shut = refillsModel({ client: 'st_ann', todayIso: TODAY, showPast: false, forms: failed('x'),
      pharmacy: failed(NOT_OPEN) })
    const closed = flat(renderToString(<RefillsView model={shut} onRetry={() => {}} />))
    assert.ok(closed.includes('data-empty="missing"') && closed.includes(NOT_OPEN))
    assert.ok(!closed.includes('role="alert"') && !closed.includes('data-record-table="pharmacy"'))
  })

  it('a row opens in the right side panel with every field, and a prescription reads its history there', async () => {
    const m = await model()
    const view = m.views[0]
    const row = view.rows.find((r) => r.rxRoot === 'r2')!
    const html = flat(renderToString(
      <SidePanel open onClose={() => {}} label="Refill" title={row.record}><RefillDetail row={row} view={view} /></SidePanel>))
    assert.ok(html.includes('<aside') && html.includes('aria-label="Refill"'))
    assert.ok(html.includes('data-refill-detail="rx-r2"') && html.includes('>Prescriber</dt>') && html.includes('>DR TWO</dd>'))
    assert.ok(html.includes('data-history="loading"'))
    assert.ok(!/role="dialog"/.test(html))
  })

  it('every row is drawn behind its medication\'s photo, else the pill tile; the open row\'s panel under a larger one', async () => {
    const m = await model()
    const rowHtml = (html: string, id: string) => {
      const at = html.indexOf(`data-row="${id}"`)
      assert.notEqual(at, -1, `row ${id} is drawn`)
      return html.slice(at, html.indexOf('</tr>', at))
    }
    const pharmacy = flat(renderToString(<RefillsView model={m} onRetry={() => {}} />))
    const known = rowHtml(pharmacy, 'rx-r2')
    assert.ok(known.includes('data-med-photo="photo"') && known.includes('src="med-images/metformin-tab-1000mg.png"'), known)
    assert.ok(known.includes('loading="lazy"') && known.includes('width:32px;height:32px') && known.includes('>METFORMIN 500MG<'))
    const unknown = rowHtml(pharmacy, 'rx-r6')
    assert.ok(unknown.includes('data-med-photo="pill"') && unknown.includes('lucide-pill') && !unknown.includes('<img'), unknown)
    assert.ok(unknown.includes('>BLANK LEFT<'))
    for (const [view, file] of [['reports', 'citalopram'], ['low_refills', 'gabapentin'], ['control', 'omeprazole']] as const) {
      const html = flat(renderToString(<RefillsView model={m} onRetry={() => {}} initialView={view} />))
      assert.match(html, new RegExp(`data-med-photo="photo"><div[^>]*><img src="med-images/${file}[^"]*"`), view)
    }
    const open = flat(renderToString(<RefillsView model={m} onRetry={() => {}} panel="rx-r2" onPanel={() => {}} />))
    const aside = open.slice(open.indexOf('<aside'))
    assert.ok(aside.includes('aria-label="Refill"') && aside.includes('data-refill-detail="rx-r2"'))
    const heading = aside.slice(aside.indexOf('<h2'), aside.indexOf('</h2>'))
    assert.ok(heading.includes('src="med-images/metformin-tab-1000mg.png"') && heading.includes('loading="eager"'), heading)
    assert.ok(heading.includes('width:56px;height:56px') && heading.includes('>METFORMIN 500MG<'))
    assert.ok(!/role="dialog"/.test(open))
  })

  it('another client lets go of the open row, the chosen source and the search: the panel never shows the last client\'s row', async () => {
    const ann = await model()
    const bob = refillsModel({ client: 'st_bob', todayIso: TODAY, showPast: false, forms: failed('x'), pharmacy: ready(MEDS) })
    type Props = { client: string; model: RefillsModel }
    // the screen's own state, run by React; what it returns is read as drawn
    const host = mountHook((p: Props) => RefillsView({ model: p.model, client: p.client, onRetry: () => {} }),
      { client: 'st_ann', model: ann })
    const el = (type: unknown) => {
      const found = findEl(host.current, type)
      assert.ok(found, 'the screen draws the element')
      return found
    }
    const row = ann.views[0].rows.find((r) => r.rxRoot === 'r2')!
    host.run(() => (el(RefillTable).props.onOpen as (r: RefillRow) => void)(row))
    host.run(() => (el(SegmentedTabs).props.onChange as (id: string) => void)('reports'))
    assert.equal(el(SidePanel).props.open, true)
    assert.equal(el(SegmentedTabs).props.value, 'reports')
    host.rerender({ client: 'st_bob', model: bob })
    assert.equal(el(SidePanel).props.open, false)
    assert.equal(el(SidePanel).props.title, '')
    assert.equal(el(SegmentedTabs).props.value, 'pharmacy')
    assert.equal(el(RefillTable).key, 'st_bob|pharmacy')
    host.unmount()
    const tab = readFileSync(resolve(ROOT, 'src/pages/features/clientprofiles/sources/RefillsTab.tsx'), 'utf8')
    assert.match(tab, /<RefillsView model=\{model\} client=\{client\}/)
  })

  it('every overlay of the tab is the SidePanel; no dialog, no browser prompt', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/features/clientprofiles/sources/RefillsTab.tsx'), 'utf8')
    assert.ok(src.includes("import SidePanel from '@/components/shared/SidePanel'"))
    assert.ok(!/Dialog|Sheet\b|window\.(confirm|alert|prompt)|role="dialog"/.test(src))
    assert.equal(typeof RefillsTab, 'function')
  })
})
