/**
 * CLIENTS · the contract between the page and its doors. Every call the page makes is caught at `fetch` and handed to
 * Apps Script's own ClientProfiles.gs — and, for the appointment the pencil saves, ClientSourceAppointments.gs, which
 * the Appointments section reads — run here on in-memory stores; the answer comes back as JSON and is read by the
 * page's own readers (and, for the empty states, drawn by its own sections). A name, a parameter or a field that one
 * side renames breaks here, not on the screen.
 *
 * Only the stores are stood in for (the clients, the books, the Hub tabs, the estate tabs, the drive). The helpers
 * the doors lean on are lifted whole out of their own .gs files, and Locations.gs is loaded as it is.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { bootClientFiles } from './client-files-index'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { blobOf, docShapeOf } from '@/pages/features/myprofile/certDocFile'
import {
  EDIT_FIELDS, INCIDENT_STATUSES, NOT_PUBLISHED, ROUTINE_LABEL, activityKindLabel, activityOf,
  cardMask, careOf, clientEditFields, clientIncidentsOf, medEditFields, medsOf, onFileMask, profileOf,
  readRefusal, rosterOf, routineLabel, ssnMask,
} from '@/pages/features/clientprofiles/clientModel'
import {
  editMedication, editOverride, editProfile, forgetClientReads, readActivity, readCare, readDetails, readDocFile,
  readIncidents, readMeds, readRoster, renameClient, saveAppointment, setClientStatus, setIncidentStatus, writeQueued,
} from '@/pages/features/clientprofiles/useClientRead'
import { diffChanges, editAnswerOf } from '@/lib/recordEdit'
import { APPT_FIELDS, appointmentsOf, apptChanges, readAppointments } from '@/pages/features/clientprofiles/sources/appointments'
import { forgetLocationReads } from '@/pages/features/locations/useLocation'
import { CareBody } from '@/pages/features/clientprofiles/sections/Care'
import { ActivityBody } from '@/pages/features/clientprofiles/sections/Activity'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const KEY = 'annettekowal'
const NOW = '2026-09-28T15:00:00Z'
const PDF = [0x25, 0x50, 0x44, 0x46]
const PNG = [0x89, 0x50, 0x4e, 0x47]
const noop = () => {}
const draw = (node: ReactNode) => renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '')
const ready = <T,>(data: T) => ({ status: 'ready' as const, data, error: '', refreshing: false })

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
  ['Clients.gs', 'clientNameKey_'], ['Clients.gs', 'apptDay_'], ['Clients.gs', 'apptBucket_'], ['Clients.gs', 'CLIENT_APPT_INDEX_'],
  ['Clients.gs', 'GUARDIAN_NON_PERSON'], ['Clients.gs', 'guardianIsPerson_'], ['Clients.gs', 'guardianDisplayName_'],
  ['Clients.gs', 'cleanGuardianName_'], ['Clients.gs', 'ispStripLabel_'], ['Clients.gs', 'ispPhone_'], ['Clients.gs', 'ispPeople_'],
  ['Clients.gs', 'ISP_PEOPLE_ROLES'], ['Clients.gs', 'ispRoleLine_'], ['Clients.gs', 'ISP_CELL_LABEL'], ['Clients.gs', 'ispCellValue_'],
  ['Clients.gs', 'ISP_EMAIL_TLDS'], ['Clients.gs', 'ispEmailWhole_'], ['Clients.gs', 'ispEmailGlue_'],
  ['HubCore.gs', 'hubCellSafe_'], ['Talent.gs', 'str_'], ['SheetDb.gs', 'HUB_TAB_HOME'], ['SheetDb.gs', 'HUB_TAB_BORN_HOME'],
  ['Main.gs', 'hubAddrKey_'], ['Main.gs', 'hubClientIdentity_'], ['Estate.gs', 'estateKey_'], ['Estate.gs', 'estateCell_'],
  ['ComplianceDocs.gs', 'CERT_DOC_TYPES'], ['ComplianceDocs.gs', 'CERT_DOC_TYPE_WORDS'],
  ['ComplianceDocs.gs', 'complianceDocsTypeOk_'], ['ComplianceDocs.gs', 'complianceDocsTypeByName_'],
  ['ComplianceDocs.gs', 'complianceDocsTypeLoose_'], ['ComplianceDocs.gs', 'complianceDocsSameType_'],
  ['ComplianceDocs.gs', 'complianceDocsFileType_'], ['ComplianceDocs.gs', 'complianceDocsShownType_'],
  ['SheetDb.gs', 'cellText_'], ['SheetDb.gs', 'cellPad2_'], ['SheetDb.gs', 'deserialize_'],
]

/** A plan's text with three routines, a template question, page furniture and a Paid Supports block. */
const PLAN = [
  'OhioISP - Annette Kowal', 'Page 1', 'Daily Life & Employment',
  'What does her evening look like?',
  'Annette likes a slow morning with coffee before her day', 'program.',
  'At bedtime staff help her lay out clothes for the next day.',
  'Overnight checks happen every two hours.',
  'Paid Supports:', 'Homemaker Personal Care', 'Asa LifeCare', 'Weekly',
  'Informed Consent', 'Page 2',
].join('\n')

const PEOPLE = [
  'Contact Information', 'Important People', 'Type', 'Name/Relationship', 'Address', 'Phone',
  'Guardian', 'Mary Kowal', '12 Elm St', '(330) 555-0101',
  'Case Manager', 'Sam Support', 'sam@county.org', '(330) 555-0102',
].join('\n')

/* ---------- the stores ---------- */

type Row = Record<string, unknown>
type Grid = unknown[][]
type DriveFile = { name: string; mime: string; bytes: number[] }

function freshStores() {
  return {
    clients: [
      { id: 'CLI_annettekowal', client_key: KEY, name: 'Annette Kowal', house: 'NW4045', status: 'active', isp_year: '2026',
        home_address: '908 Arlington Ave NW, Canton, OH 44708', guardianName: 'Mary Kowal', guardian_relationship: 'Mother',
        dob: '1961-03-14', medications: ['Secret pill'], diagnoses_text: 'Private words' },
      { id: 'CLI_kennymarsh', client_key: 'kennymarsh', name: 'Kenny Marsh', house: 'NW4045', status: 'active', isp_year: '2025' },
      { id: 'CLI_oldgone', client_key: 'oldgone', name: 'Old Gone', house: 'NW4045', status: 'inactive' },
    ] as Row[],
    books: {
      entity_homes: [
        ['abbreviation', 'home_name', 'address', 'region', 'telephone', 'manager_name', 'manager_phone', 'calendar_link', 'thumbnail_url'],
        ['NW4045', 'CAN - NW - NW4045', '908 Arlington Ave NW, Canton, OH 44708', 'Canton', '3305550100', '', '', '', ''],
        ['NE2020', 'CAN - NE - NE2020', '1 Elm St NE, Canton, OH 44705', 'Canton', '', '', '', '', ''],
      ],
      Master: [
        ['Client', 'SSN', 'DC PIN #', 'DC Exp Date', 'DC Security Code', 'Medicaid #', 'Outcome', 'Payee Rep', 'Payee Rep #',
          'SSA', 'SSA Email', 'SSA #', 'Workshop', 'House Manager', 'House Manager #', 'Login Username', 'Password', 'House'],
        ['Annette  Kowal', '900-11-4544', '8264', '11/29', '739', '112233445566', 'Community living', 'Pat Payee', '3305550123',
          'Sam Support', 'sam@county.org', '3305550102', 'Bright Days', 'Noah Reed', '3305550111', 'annettelogin', 'hunter2', 'NW4045'],
      ],
      'Client - Database': [['Customer', 'TL Debit Card Number', 'DC PIN #'], ['Annette Kowal', '4000 1234 1234 4812', '']],
      'Archive - Old Clients': [['Customer', 'SSN', 'House', 'Status'], ['Archive One', '900114545', 'QQ1000', 'Discharged']],
      'Future Apts': [['Client Name', 'Dr Name', 'Appointment Date', 'Appointment Address', 'Appointment Start Time']],
    } as Record<string, Grid>,
    tables: {
      isps: [{ client_key: KEY, client_name: 'Annette Kowal', isp_year: '2026', source_file: 'Annette Kowal ISP 2026.pdf',
        loaded_at: '2026-02-01T10:00:00Z', page_count: 30, personal_care: 'Needs prompts to brush her teeth.',
        mobility: 'Walks with a cane.', diagnoses: 'Condition A', allergies: 'Peanuts', goals_outcomes: 'Cook one meal a week',
        important_to: 'Music', contact_block: PEOPLE }],
      people: [{ id: 'PPL_guardian_marykowal', name: 'Mary Kowal', avatar: 'https://example.org/mary.jpg' }],
      clients: [],
      clientFiles: [
        { id: 'cf1', client_key: KEY, client_name: 'Annette Kowal', title: 'Behavior Support Plan', folder: 'ISP',
          drive_id: 'bsp000000001', expires_on: '2025-12-31', issued_on: '2025-01-01' },
        { id: 'cf2', client_key: 'kennymarsh', client_name: 'Kenny Marsh', title: 'Kenny ISP', drive_id: 'kennyisp0001' },
      ],
      medications: [
        { 'Id - Auto': '7', Client: 'Annette Kowal', PrescriptionName: 'Gabapentin', Dosage: '300 mg', MedType: 'Tablet', PRN: 'Daily',
          AdministrationTimes: '"0800" "2000"', 'Added Date': '2026-03-01', Discountinued: '' },
        { 'Id - Auto': '8', Client: 'Annette Kowal', PrescriptionName: 'Old Med', Discountinued: 'Yes',
          'Discountinued Date': '2026-05-01', 'Added Date': '2025-01-02' },
      ],
      financeTransactions: [
        { id: 't1', client: 'Annette Kowal', date: '2026-09-02', amount: -18.5, receiptName: 'kroger.png', receiptFileId: 'rcpt00000001' },
      ],
      clientNotes: [{ id: 'n1', client_key: KEY, note: 'Called the pharmacy.', entry_date: '2026-09-10', contact: 'Ann Lee' }],
    } as Record<string, Row[]>,
    estate: {
      drVisits: [
        { id: 'r5', client_name: 'Annette  Kowal', dr_name: 'Dr Lee', appointment_date: '2026-10-02', appointment_start_time: '10:30',
          appointment_address: '1 Clinic Rd', wheelchair_van_required: 'Yes', manager: 'Noah Reed' },
        { id: 'r6', client_name: 'Annette Kowal', dr_name: 'Dr Past', appointment_date: '2026-09-01', upcoming: 'No' },
        { id: 'r7', client_name: 'Kenny Marsh', dr_name: 'Dr Else', appointment_date: '2026-09-25' },
      ],
      uiIncidents: [
        { id: 'r2', timestamp: '2026-09-20T18:00:00.000Z', your_name: 'Ann Lee', client_name: 'Annette Kowal',
          incident_category: 'Minor injury or illness (rash, bruise, small cut), Fall', incident_location: 'Client Home',
          incident_date: '2026-09-20T04:00:00.000Z', incident_time: '14:05', employees_involved: 'Ann Lee, Bo Diaz',
          summary_of_incident: 'Slipped in the hall' },
        { id: 'r3', timestamp: '2026-09-24T18:00:00.000Z', your_name: 'Bo Diaz', client_name: 'Kenny Marsh', incident_category: 'Fall' },
      ],
      drAppointments: [{ client: 'Annette Kowal', dr_name: 'Dr Lee', specialist: 'Cardiology', phone: '3305550111', active_or_discontinued: 'Active' }],
      dailyNotes: [{ id: 'r9', client_name: 'Annette Kowal', category: 'Behavior', response: 'Calm day at the park.', dsp_name: 'Noah Reed',
        reporting_date: '2026-09-12' }],
    } as Record<string, Row[]>,
    files: {
      ispdoc000001: { name: 'Annette Kowal ISP 2026', mime: 'application/vnd.google-apps.document', bytes: [] },
      bsp000000001: { name: 'Behavior Support Plan.pdf', mime: 'application/pdf', bytes: PDF },
      rcpt00000001: { name: 'kroger.png', mime: 'image/png', bytes: PNG },
      rcptkenny001: { name: 'kenny.png', mime: 'image/png', bytes: PNG },
      kennyisp0001: { name: 'Kenny ISP.pdf', mime: 'application/pdf', bytes: PDF },
    } as Record<string, DriveFile>,
    tabs: {} as Record<string, ReturnType<typeof sheetOf>>,
  }
}

let S = freshStores()

function sheetOf(grid: Grid) {
  const width = () => (grid[0] ?? []).length
  return {
    grid,
    getLastColumn: width,
    getDataRange: () => ({ getValues: () => grid.map((r) => Array.from({ length: width() }, (_, i) => r[i] ?? '')) }),
    getRange: (r: number, c: number, nr = 1, nc = 1) => ({
      setValue: (v: unknown) => {
        while (grid.length < r) grid.push([])
        grid[r - 1][c - 1] = v
      },
      setValues: (vals: unknown[][]) => {
        for (let i = 0; i < nr; i++) {
          while (grid.length < r + i) grid.push([])
          for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = vals[i][j]
        }
      },
    }),
    appendRow: (line: unknown[]) => { grid.push([...line]) },
  }
}

function formatDate(date: Date, tz: string, pattern: string): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(date)
  if (pattern === 'yyyy-MM-dd') {
    return `${part({ year: 'numeric' })}-${part({ month: '2-digit' }).padStart(2, '0')}-${part({ day: '2-digit' }).padStart(2, '0')}`
  }
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/** A write to the Hub clients tab lands on the derived row the doors read back, as clientsDerived_ merges it. */
function clientsWrite(rec: Row): Row {
  const derived = S.clients.find((c) => c.client_key === rec.client_key || c.id === rec.id)
  if (derived) Object.assign(derived, rec)
  const tab = S.tables.clients.find((c) => c.id === rec.id)
  if (tab) Object.assign(tab, rec)
  else S.tables.clients.push({ ...rec })
  return { ...(tab ?? rec) }
}

/* ---------- Apps Script, booted ---------- */

type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; params?: Record<string, unknown> }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => { status: number; data?: unknown; message?: string }>
  CP_ACTIONS: string[]
  CP_ROUTINES: { section: string }[]
  CP_PLAN_SECTIONS: { section: string }[]
  CP_CARE_FIELDS: Record<string, [string, string][]>
  clientProfileSaveFields_: (raw: unknown) => { refused?: { status: number; message: string }; fields?: Row }
}

function boot(): Gs {
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, isFinite, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {},
    Utilities: {
      formatDate,
      base64Encode: (b: number[]) => Buffer.from(b).toString('base64'),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      getFileById: (id: string) => {
        const f = S.files[id]
        if (!f) throw new Error(`File not found: ${id}`)
        return {
          isTrashed: () => false, getName: () => f.name, getMimeType: () => f.mime, getSize: () => f.bytes.length,
          getBlob: () => ({ getBytes: () => f.bytes }), getAs: () => ({ getBytes: () => PDF }),
        }
      },
    },
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'boss@example.org' && !u.visiting_member && !u.is_service,
    hubIsWriter_: () => true,
    hubDenied_: () => ({ status: 403, message: 'Denied.' }),
    hubQuietNow_: () => new Date(NOW),
    hubProp_: () => '',
    hubId_: () => 'masterdata01',
    cacheRead_: (_scope: string, _name: string, fn: () => unknown) => fn(),
    cacheScopeSheet_: (id: string, tab: string) => `${id}:${tab}`,
    cacheScope_: (t: string) => t,
    cacheVersion_: () => 1,
    cacheBump_: () => {},
    ssOpen_: () => ({
      getSheetByName: (tab: string) => (S.books[tab] ? sheetOf(S.books[tab]) : null),
      getSpreadsheetTimeZone: () => 'America/New_York',
    }),
    clientsDerived_: () => S.clients.map((c) => ({ ...c })),
    clientPhotoIndex_: () => ({ annettekowal: 'https://example.org/annette.jpg' }),
    estateSource_: (r: string) => ({ id: 'estate', tab: r }),
    estateRows_: (r: string) => JSON.parse(JSON.stringify(S.estate[r] ?? [])),
    estateRoute_: (resource: string, action: string, patch: Row) => {
      const row = S.estate[resource]?.find((r) => r.id === patch.id)
      if (action !== 'update' || !row) return { status: 404, message: 'No such row.' }
      if (String(row.client_name ?? '').trim() !== String(patch.witness ?? '').trim()) return { status: 409, message: 'The row moved.' }
      for (const [k, v] of Object.entries(patch)) if (k !== 'id' && k !== 'witness') row[k] = v
      return { status: 200, data: { ...row } }
    },
    listRows_: (r: string) => JSON.parse(JSON.stringify(S.tables[r] ?? [])),
    createRow_: (r: string, rec: Row) => (r === 'clients' ? clientsWrite(rec) : null),
    updateRowById_: (r: string, patch: Row) => (r === 'clients' ? clientsWrite(patch) : null),
    ispDocFor_: (name: string) => (name === 'Annette Kowal'
      ? { id: 'ispdoc000001', name: 'Annette Kowal ISP 2026', url: '' } : { id: '', name: '', url: '' }),
    ispIntakeFiles_: () => [{ id: 'planfile0001', name: 'Annette Kowal ISP 2026.pdf' }],
    ispIntakeDecode_: () => ({ status: 200, data: { raw_text: PLAN } }),
    hubTabSheet_: (tab: string) => S.tabs[tab] ?? null,
    hubTabEnsure_: (tab: string, header: string[]) => (S.tabs[tab] ??= sheetOf([[...header]])),
    ensureHeader_: (sheet: ReturnType<typeof sheetOf>, keys: string[]) => {
      const head = (sheet.grid[0] ?? []).map(String)
      for (const k of keys) if (!head.includes(k)) head.push(k)
      sheet.grid[0] = head
      return [...head]
    },
    sheetDbGateHolds_: () => null,
    sheetDbRefused_: () => null,
    hubSysLog_: () => {},
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('RecordEdit.gs'), ctx)
  vm.runInContext(gsText('Locations.gs'), ctx)
  vm.runInContext(gsText('ClientProfiles.gs'), ctx)
  vm.runInContext(gsText('Meds.gs'), ctx)
  vm.runInContext(gsText('ClientSourceAppointments.gs'), ctx)
  bootClientFiles(ctx)
  return ctx as unknown as Gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin', display_name: 'Boss' }
let USER: Row = MASTER

/* ---------- the page's calls, answered by the doors ---------- */

const calls: { action: string; payload: Row }[] = []
const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action?: string; payload: Row }
    // a write's slice refresh is not a door call
    if (!env.action) return new Response(JSON.stringify({ status: 200, data: {} }))
    calls.push({ action: env.action, payload: env.payload ?? {} })
    const door = GS.HUB_ACTIONS[env.action]
    const out = door ? door(JSON.parse(JSON.stringify(env.payload ?? {})), USER) : { status: 404, message: 'Unknown action.' }
    return new Response(JSON.stringify(out))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  S = freshStores()
  USER = MASTER
  forgetClientReads()
  forgetLocationReads()
})

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

/** Read the plans, as run once per plan after publishing: the client's sections are filed. */
function fileTheSections() {
  const got = GS.HUB_ACTIONS.clientProfileIspSections({ client: KEY }, MASTER)
  assert.equal(got.status, 200, JSON.stringify(got))
}

/** The one door no screen calls: the admin's one-plan-per-run backfill. */
const UNCALLED = ['clientProfileIspSections']
/** The doors a screen calls, as a plain array of this realm. */
const CALLED = () => [...GS.CP_ACTIONS].filter((a) => !UNCALLED.includes(a)).sort()
// the doors only Python answers (app/client_care_records.py): in the app's front door table, never in a .gs
const PYTHON_ONLY = ['clientProfileApptAdd', 'clientProfileDoctorAdd', 'clientProfileSecretSet']

describe('the names', () => {
  it('every clientProfile door the page names is a ClientProfiles.gs action or a Python door, and every such action but one has a caller', () => {
    const named = new Set<string>()
    for (const f of walk('src/pages/features/clientprofiles')) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    const own = [...named].filter((n) => n.startsWith('clientProfile') && !PYTHON_ONLY.includes(n))
    for (const name of own) {
      assert.equal(GS.HUB_POLICY[name]?.file, 'ClientProfiles.gs', `${name} is declared in ClientProfiles.gs`)
      assert.equal(typeof GS.HUB_ACTIONS[name], 'function', `${name} has a handler`)
    }
    assert.deepEqual(own.sort(), CALLED())
    const routes = JSON.parse(readFileSync(resolve(ROOT, 'app/front_door_routes.json'), 'utf8'))
    for (const name of PYTHON_ONLY) {
      assert.ok(named.has(name), `${name} has a caller`)
      assert.equal(routes.writes[name], 'client-care', `${name} is answered by Python`)
    }
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of named) {
      if (!PYTHON_ONLY.includes(name)) assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
    }
  })

  it('every section, routine and plan field a care answer may call absent has words on the screen', () => {
    const keys = [...GS.CP_ROUTINES.map((r) => r.section), ...GS.CP_PLAN_SECTIONS.map((s) => s.section),
      ...Object.values(GS.CP_CARE_FIELDS).flat().map((f) => f[0])]
    assert.deepEqual(keys.filter((k) => !ROUTINE_LABEL[k]), [])
  })
})

describe('the reads, as the page reads them', () => {
  it('roster: the active clients by default with the record id Create user sends; Show Inactive adds the archive', async () => {
    const active = rosterOf(await readRoster(false))
    assert.deepEqual(active.clients.map((c) => [c.client_key, c.client_id, c.status]),
      [[KEY, 'CLI_annettekowal', 'active'], ['kennymarsh', 'CLI_kennymarsh', 'active']])
    assert.equal(active.clients[0].avatar, 'https://example.org/annette.jpg')
    const all = rosterOf(await readRoster(true))
    assert.deepEqual(all.clients.map((c) => `${c.client_key}:${c.status}`).sort(),
      ['annettekowal:active', 'archiveone:inactive', 'kennymarsh:active', 'oldgone:inactive'])
    assert.equal(all.clients.find((c) => c.client_key === 'archiveone')?.client_id, '', 'an archived client has no Hub record')
    assert.ok(!/Secret pill|Private words|900114545/.test(JSON.stringify(await readRoster(true))), 'identity only')
  })

  it('details: the masks the page draws are made from what the door sends; nothing raw crosses the wire', async () => {
    const raw = await readDetails(KEY)
    const text = JSON.stringify(raw)
    for (const secret of ['900-11-4544', '900114544', '4000 1234', '1234 4812', '11/29', '"739"', '8264', 'hunter2', 'annettelogin']) {
      assert.ok(!text.includes(secret), `${secret} never leaves Apps Script`)
    }
    const p = profileOf(raw)
    assert.equal(ssnMask(p.identity), '•••-••-4544')
    assert.equal(cardMask(p.financial.tl_card_last4), '•••• •••• •••• 4812')
    assert.deepEqual([onFileMask(p.financial.dc_exp_on_file, '••/••'), onFileMask(p.financial.dc_security_code_on_file, '•••'),
      onFileMask(p.financial.dc_pin_on_file, '••••')], ['••/••', '•••', '••••'])
    assert.deepEqual([p.client.name, p.client.age, p.home.house_code, p.home.house_label, p.identity.medicaid_id],
      ['Annette Kowal', 65, 'NW4045', 'CAN - NW - NW4045', '112233445566'])
    assert.deepEqual([p.guardian.name, p.guardian.person_id, p.home.house_manager_phone], ['Mary Kowal', 'PPL_guardian_marykowal', '(330) 555-0111'])
    assert.equal(p.services.isp_file_id, 'ispdoc000001')
    assert.deepEqual(p.family.map((f) => `${f.name}:${f.relationship}`), ['Mary Kowal:Guardian', 'Sam Support:Case Manager'])
  })

  it('care: before the plan is cut nothing is called absent and the screen says why; after, the routines and the words', async () => {
    const early = careOf(await readCare(KEY, 'daily'))
    assert.match(early.why, /not been read into sections yet/)
    assert.deepEqual(early.absent.filter((k) => GS.CP_ROUTINES.some((r) => r.section === k)), [])
    const earlyHtml = draw(<CareBody view="daily" care={ready(early)} onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(!earlyHtml.includes('not been read into sections yet'), 'a chapter tab reads its chapter alone, without the why')
    fileTheSections()
    const daily = careOf(await readCare(KEY, 'daily'))
    assert.deepEqual(daily.rows.map((r) => r.record), ['Morning', 'Bedtime', 'Overnight', 'Personal care', 'Mobility'])
    assert.equal(daily.rows[0].text, 'Annette likes a slow morning with coffee before her day program.')
    assert.deepEqual(daily.statuses, ['Current'])
    const html = draw(<CareBody view="daily" care={ready(daily)} onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(html.includes('Not in this ISP: Afternoon routine, Evening routine, Meals, Hygiene, Sleep, Waking up, Diet &amp; nutrition, Communication.'), html)
    const home = careOf(await readCare(KEY, 'home'))
    assert.deepEqual(home.rows.map((r) => r.record), ['Home', 'Homemaker Personal Care'])
    assert.deepEqual(home.absent.map(routineLabel), ['Community living'])
    const team = careOf(await readCare(KEY, 'team'))
    const mary = team.people.find((x) => x.name === 'Mary Kowal')
    assert.deepEqual([mary?.person_id, mary?.avatar], ['PPL_guardian_marykowal', 'https://example.org/mary.jpg'])
    assert.equal(team.people.find((x) => x.name === 'Dr Lee')?.relationship, 'Cardiology')
    for (const view of ['health', 'goals'] as const) assert.ok(careOf(await readCare(KEY, view)).rows.length > 0, view)
  })

  it('care plans: each document the page offers opens as bytes through the client\'s door; another client\'s is refused', async () => {
    const plans = careOf(await readCare(KEY, 'plans'))
    assert.deepEqual(plans.rows.map((r) => [r.status, r.file_id]), [['Current', 'ispdoc000001'], ['Expired', 'bsp000000001']])
    for (const r of plans.rows) {
      const got = await readDocFile(KEY, r.file_id)
      assert.ok(docShapeOf(got.mime) && blobOf(got), `${r.record} opens in the platform (${got.mime})`)
    }
    assert.equal((await readDocFile(KEY, 'ispdoc000001')).exported, true, 'a Google document arrives as its PDF')
    await assert.rejects(readDocFile(KEY, 'kennyisp0001'), /names no such document/)
    await assert.rejects(readDocFile(KEY, 'rcpt00000001'), /names no such document/, 'a receipt is Client Funds\' own door')
  })

  it('medication: Medications is the eMAR list, Active before Discontinued; the other two tabs read their own apps', async () => {
    const meds = medsOf(await readMeds(KEY))
    assert.deepEqual(meds.rows.map((r) => `${r.record}:${r.status}`), ['Gabapentin:Active', 'Old Med:Discontinued'])
    assert.equal(GS.HUB_ACTIONS.clientProfileMeds({ client: KEY, tab: 'admin' }, MASTER).status, 400)
  })

  it('incidents: the client\'s reports keyed by their stamp, the three statuses, Reported until reviewed', async () => {
    const inc = clientIncidentsOf(await readIncidents(KEY))
    assert.deepEqual(inc.rows.map((r) => [r.incident_ts, r.status, r.incident_date]), [['2026-09-20T18:00:00.000Z', 'Reported', '2026-09-20']])
    assert.deepEqual(inc.rows[0].employees_involved, ['Ann Lee', 'Bo Diaz'])
    assert.deepEqual(inc.statuses, [...INCIDENT_STATUSES])
  })

  it('the sections read from their own apps have no second door in ClientProfiles.gs', () => {
    for (const gone of ['clientProfileAppointments', 'clientProfileTransport', 'clientProfileFunds', 'clientProfileBilling', 'clientProfileSources']) {
      assert.equal(GS.HUB_ACTIONS[gone], undefined, gone)
    }
    assert.equal(typeof GS.HUB_ACTIONS.clientSourceAppointments, 'function')
  })

  it('activity: every row\'s type is one the filter offers; newest first; the full text for the panel', async () => {
    const a = activityOf(await readActivity(KEY))
    assert.ok(a.rows.length >= 5)
    for (const r of a.rows) assert.ok(a.kinds.includes(activityKindLabel(r.kind)), `${r.kind} is offered as ${activityKindLabel(r.kind)}`)
    assert.deepEqual(a.rows.map((r) => r.at), [...a.rows.map((r) => r.at)].sort().reverse())
    assert.equal(a.rows.find((r) => r.kind === 'daily_note')?.text, 'Calm day at the park.')
    assert.equal(a.total, a.rows.length)
    const html = draw(<ActivityBody activity={ready(a)} onAsk={noop} onRetry={noop} />)
    for (const kind of ['Doctor visit', 'Daily note', 'Incident', 'Medication added', 'Medication discontinued', 'Client note']) {
      assert.ok(html.includes(`data-status="${kind}"`), kind)
    }
  })

  it('anyone but the master, or a visit, reads "not published" — the door answers as if it did not exist', async () => {
    for (const u of [{ email: 'mgr@example.org', role: 'manager' }, { ...MASTER, visiting_member: 'mem_1' }]) {
      USER = u
      const err = await readDetails(KEY).then(() => null, (e: unknown) => (e instanceof Error ? e.message : String(e)))
      assert.equal(readRefusal(err ?? ''), NOT_PUBLISHED)
    }
  })
})

describe('the writes, as the page files them', () => {
  it('the details pencil: every field the panel offers is saved and the panel opens on it next; the house moves in the ' +
     'Master too, and a cleared field stays blank over the Master\'s value', async () => {
    // the name and the status file through their own doors
    const own = (f: { key: string; lockedBy?: unknown }) => !f.lockedBy && f.key !== 'name' && f.key !== 'status'
    const fields = clientEditFields(profileOf(await readDetails(KEY))).filter(own)
    assert.deepEqual(fields.map((f) => f.key).sort(), EDIT_FIELDS.map((f) => f.key).sort())
    const typed: Record<string, string> = {}
    fields.forEach((f, i) => {
      typed[f.key] = f.kind === 'date' ? `2020-01-${String(i + 1).padStart(2, '0')}` : f.kind === 'phone' ? `33055501${String(i).padStart(2, '0')}`
        : f.kind === 'email' ? `${f.key}@example.org` : f.kind === 'select' ? 'NE2020' : `Typed ${f.key}`
    })
    const changes = diffChanges(fields, typed)
    assert.equal(changes.length, fields.length)
    const got = await editProfile(KEY, changes)
    assert.equal(writeQueued(got), false)
    assert.deepEqual(editAnswerOf(got), { written: changes.map((c) => c.field), refused: [] })
    const after = clientEditFields(profileOf(await readDetails(KEY))).filter(own)
    assert.deepEqual(Object.fromEntries(after.map((f) => [f.key, f.raw])), typed)
    assert.equal(S.books.Master[1][17], 'NE2020', 'the Master row the name matches moved house')
    const outcome = after.find((f) => f.key === 'outcome')
    const cleared = await editProfile(KEY, [{ field: 'outcome', value: '', expected: outcome?.raw ?? '' }])
    assert.deepEqual(editAnswerOf(cleared).written, ['outcome'])
    const blank = profileOf(await readDetails(KEY))
    assert.deepEqual([blank.services.outcome, blank.edit.outcome, S.books.Master[1][6]], ['', '', 'Community living'])
    await assert.rejects(editProfile(KEY, [{ field: 'outcome', value: 'Work', expected: 'Day program' }]), /Changed since/)
    const locked = editAnswerOf(await editProfile(KEY, ['ssn', 'tl_card', 'dc_exp', 'dc_security_code', 'dc_pin', 'name', 'status']
      .map((field) => ({ field, value: '1', expected: '' }))))
    assert.deepEqual([locked.written, locked.refused.length], [[], 7])
    for (const masked of ['ssn', 'ssn_last4', 'tl_card', 'tl_card_last4', 'dc_exp', 'dc_security_code', 'dc_pin']) {
      assert.equal(GS.clientProfileSaveFields_({ [masked]: '1' }).refused?.status, 422, `${masked} is never written`)
      assert.ok(!EDIT_FIELDS.some((f) => f.key === masked), `${masked} is not an open field`)
    }
  })

  it('the medication pencil: a chart row is corrected in place by its eMAR id, each cell witnessed', async () => {
    const head = ['Id - Auto', 'Client', 'PrescriptionName', 'Dosage', 'MedType', 'PRN', 'AdministrationTimes', 'Discountinued']
    S.tabs.medications = sheetOf([head, ...S.tables.medications.map((r) => head.map((h) => r[h] ?? ''))])
    const row = medsOf(await readMeds(KEY)).rows.find((r) => r.id === '7')
    assert.deepEqual(row?.edit, { name: 'Gabapentin', dose: '300 mg', times: '08:00 20:00', route: 'Tablet', freq: 'Daily', discontinued: '' })
    const changes = diffChanges(medEditFields(row?.edit ?? {}), { dose: '600 mg', times: '0900 2100' })
    const got = editAnswerOf(await editMedication(KEY, '7', changes))
    assert.deepEqual(got, { written: ['dose', 'times'], refused: [] })
    assert.deepEqual([S.tabs.medications.grid[1][3], S.tabs.medications.grid[1][6]], ['600 mg', '"0900" "2100"'])
    await assert.rejects(editMedication(KEY, '7', [{ field: 'dose', value: '1 mg', expected: '300 mg' }]), /Changed since/)
  })

  it('the appointment pencil: a visit the Appointments section reads (the Dr Appointments book) saves through ' +
     'clientProfileApptSave, every field the form offers lands on it, the witness its own name cell', async () => {
    const read = async () => appointmentsOf(await readAppointments(KEY))
    const first = await read()
    assert.equal(first.visits.why, '', 'the book read whole')
    const visit = first.visits.rows.find((v) => v.id === 'r5')
    assert.ok(visit && visit.editable, 'an archive row is editable')
    assert.equal(visit.witness, 'Annette  Kowal', 'the name cell as it stands on the row')
    const before = { date: visit.date, time: visit.time, dr_name: visit.drName, dr_address: visit.drAddress, van: visit.vanAnswer }
    const fields = apptChanges(before, { date: '2026-10-09', time: '11:30 AM', dr_name: 'Dr Lee Jr', dr_address: '2 Clinic Rd', van: 'No' })
    assert.deepEqual(Object.keys(fields).sort(), APPT_FIELDS.map((f) => f.key).sort())
    const got = await saveAppointment({ client: KEY, id: visit.id, witness: visit.witness, fields })
    assert.equal(writeQueued(got), false)
    forgetLocationReads()
    const back = (await read()).visits.rows.find((v) => v.id === 'r5')
    assert.deepEqual([back?.date, back?.time, back?.drName, back?.drAddress, back?.vanAnswer],
      ['2026-10-09', '11:30 AM', 'Dr Lee Jr', '2 Clinic Rd', 'No'])
    await assert.rejects(saveAppointment({ client: KEY, id: 'r7', witness: 'Kenny Marsh', fields: { time: '09:00' } }), /not this client's/)
  })

  it('the incident status: each status the select offers is kept by client_key|incident_ts and reads back', async () => {
    const [row] = clientIncidentsOf(await readIncidents(KEY)).rows
    for (const status of INCIDENT_STATUSES) {
      await setIncidentStatus({ client: KEY, incident_ts: row.incident_ts, client_name: row.client_name, status })
      const back = clientIncidentsOf(await readIncidents(KEY)).rows[0]
      assert.deepEqual([back.status, back.status_by], [status, 'Boss'])
    }
    assert.equal(S.tabs.incident_reviews.grid.length, 2, 'one review row, updated in place')
    assert.equal(S.tabs.incident_reviews.grid[1][0], `${KEY}|${row.incident_ts}`)
  })
})

describe('what crossed the wire', () => {
  it('every call carried only the parameters its door declares, and every door a screen uses was called', async () => {
    calls.length = 0
    await readRoster(true)
    await readDetails(KEY)
    for (const v of ['plans', 'team', 'daily', 'health', 'goals', 'home'] as const) await readCare(KEY, v)
    await readMeds(KEY)
    await readIncidents(KEY)
    await readActivity(KEY)
    await readDocFile(KEY, 'ispdoc000001')
    await editProfile(KEY, [{ field: 'spending_limit', value: '$60', expected: profileOf(await readDetails(KEY)).edit.spending_limit }])
    await saveAppointment({ client: KEY, id: 'r5', witness: 'Annette  Kowal', fields: { time: '09:15' } })
    const [inc] = clientIncidentsOf(await readIncidents(KEY)).rows
    await setIncidentStatus({ client: KEY, incident_ts: inc.incident_ts, client_name: inc.client_name, status: 'Closed' })
    await assert.rejects(renameClient(KEY, [{ field: 'name', value: 'New Name', expected: 'stale' }]), /Changed since it was opened/)
    await assert.rejects(setClientStatus(KEY, [{ field: 'status', value: 'Active', expected: 'stale' }]))
    await assert.rejects(editOverride({ client: KEY, kind: 'family', target: 'nobody', changes: [{ field: 'name', value: 'x', expected: 'stale' }] }))
    const bad = calls.filter((c) => {
      const declared = Object.keys(GS.HUB_POLICY[c.action]?.params ?? {})
      return Object.keys(c.payload).some((k) => !declared.includes(k))
    })
    assert.deepEqual(bad, [])
    assert.deepEqual([...new Set(calls.map((c) => c.action))].sort(), CALLED())
  })

  it('a client\'s document — a plan, a receipt, a MARS paper — is never kept as a relay receipt', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    for (const door of ['clientProfileDocFile', 'clientSourceFinanceFile', 'clientSourceMarDocFile']) assert.ok(line.includes(`"${door}"`), door)
  })

  it('every read the Clients app declares is never stamped for a receipt; its writes keep exactly-once', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    const listed = new Set([...line.matchAll(/"(\w+)"/g)].map((m) => m[1]))
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/resolver-manifest.json'), 'utf8')) as {
      actions: Record<string, { lane: string }>
    }
    const mine = Object.entries(manifest.actions).filter(([name]) => /^client(Profile|Source)[A-Z]/.test(name))
    const reads = mine.filter(([, p]) => p.lane === 'read').map(([name]) => name)
    const writes = mine.filter(([, p]) => p.lane === 'write').map(([name]) => name)
    assert.ok(reads.length >= 12 && writes.length >= 3, `${reads.length} reads, ${writes.length} writes`)
    assert.deepEqual(reads.filter((a) => !listed.has(a)), [])
    assert.deepEqual(writes.filter((a) => listed.has(a)), [])
  })
})
