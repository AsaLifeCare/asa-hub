/**
 * FAMILIES · the contract between the page and its doors. Every call the page makes is caught at `fetch` — the
 * relay's pack (answered by FamilyProfiles.gs's own familyPack, as the relay's service identity runs it) and each
 * Apps Script door — and handed to Apps Script's own FamilyProfiles.gs (with Locations.gs and ClientProfiles.gs, whose
 * helpers it leans on), run here on in-memory stores; the answer comes back as JSON and is read by the page's own
 * readers and drawn by its own sections. A name, a parameter, a part or a field that one side renames breaks here,
 * not on the screen.
 *
 * The app ships master-only: no App Control row, mounted only through CUSTOM_PAGES. Nothing in it is a dialog: every
 * form is a mode of the one right panel, and a document opens centred in the platform's viewer.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { bootClientFiles } from './client-files-index'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { isAllowedWith } from '@/lib/appAccess'
import { PREFETCH_GAP_MS, forgetPack } from '@/lib/appPack'
import { ohioToday } from '@/lib/ohio'
import { forgetSnapshot } from '@/lib/snapshotClient'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { appManifests } from '@/registry/apps'
import { familyProfilesManifests } from '@/registry/apps-family-profiles'
import AppRoutePage, { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { blobOf, docShapeOf } from '@/pages/features/myprofile/certDocFile'
import { editAnswerOf } from '@/lib/recordEdit'
import FamilyProfilesPage from '@/pages/features/familyprofiles/FamilyProfilesPage'
import FamilyPanel from '@/pages/features/familyprofiles/FamilyPanel'
import FamilyActions, { ActionsMenu } from '@/pages/features/familyprofiles/FamilyActions'
import { SwitcherList } from '@/pages/features/familyprofiles/FamilySwitcher'
import { OverviewView } from '@/pages/features/familyprofiles/sections/Overview'
import { NotesView } from '@/pages/features/familyprofiles/sections/Notes'
import { APP_FEATURES } from '@/lib/featureAccess'
import { DocumentsView } from '@/pages/features/familyprofiles/sections/Documents'
import { ActivityView } from '@/pages/features/familyprofiles/sections/Activity'
import {
  CLIENTS_PATH, NOT_OPEN, NOT_PUBLISHED, activityOf, actionGroups, bodyParts, callMissing, documentsOf, familyEditFields,
  familyEditOf, familyKeyOf, familyQuery, familyTabs, incidentClients, notesOf, overviewOf, panelOf, readRefusal, relationshipLine, rosterOf, sharePayloadFor, viewOf,
  type FamilyAsk, type RosterRow,
} from '@/pages/features/familyprofiles/familyModel'
import {
  addNote, familyWrote, forgetFamilyReads, readActivity, readDocFile, readDocuments, readKey, readNotes, readOverview,
  readRoster, saveFamily, scheduleCall, tieFiled, tieIncident, useFamilyRead, type ReadState,
} from '@/pages/features/familyprofiles/useFamilyRead'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const FEATURE = 'src/pages/features/familyprofiles'
const KEY = 'fam_jeanafern'
const NOW = '2026-09-28T15:00:00Z'
const PDF = [0x25, 0x50, 0x44, 0x46]
const PAPERS = 'gpapersAbCdEfGhIjKlMnOpQrSt'
const noop = () => {}
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(createElement(MemoryRouter, null, node)))
const ready = <T>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const noModal = (html: string, what: string) => {
  assert.ok(!html.includes('aria-modal'), `${what}: no aria-modal`)
  assert.ok(!html.includes('role="dialog"') && !html.includes('role="alertdialog"'), `${what}: no dialog role`)
}

const gsText = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')

/** One top-level function or var of a .gs file, exactly as written there (its first line too). */
function lift(file: string, name: string): string {
  const src = `\n${gsText(file)}`
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
  ['Clients.gs', 'ISP_CONTACT_NEXT_LABEL'], ['Clients.gs', 'guardianContactSegment_'],
  ['HubCore.gs', 'hubCellSafe_'], ['Talent.gs', 'str_'], ['SheetDb.gs', 'HUB_TAB_HOME'], ['SheetDb.gs', 'HUB_TAB_BORN_HOME'],
  ['Main.gs', 'hubAddrKey_'], ['Main.gs', 'hubClientIdentity_'], ['Main.gs', 'hubOwnerOf_'], ['Estate.gs', 'estateKey_'],
  ['Estate.gs', 'estateCell_'], ['MyFamily.gs', 'MY_FAMILY_TASK_WORDS'], ['CommBroadcast.gs', 'commBroadcastDay_'],
  ['ComplianceDocs.gs', 'CERT_DOC_TYPES'], ['ComplianceDocs.gs', 'CERT_DOC_TYPE_WORDS'],
  ['ComplianceDocs.gs', 'complianceDocsTypeOk_'], ['ComplianceDocs.gs', 'complianceDocsTypeByName_'],
  ['ComplianceDocs.gs', 'complianceDocsTypeLoose_'], ['ComplianceDocs.gs', 'complianceDocsSameType_'],
  ['ComplianceDocs.gs', 'complianceDocsFileType_'], ['ComplianceDocs.gs', 'complianceDocsShownType_'],
  ['StaffProfiles.gs', 'spDigits10_'], ['StaffProfiles.gs', 'spReadColumns_'], ['StaffProfiles.gs', 'spNumbers_'],
  ['StaffProfiles.gs', 'spLineOf_'], ['StaffProfiles.gs', 'spTime_'], ['ClientSourceFinance.gs', 'CSF_MONTHS'],
  ['ClientSourceFinance.gs', 'csfIso_'], ['ClientSourceFinance.gs', 'csfDay_'], ['ClientSourceFinance.gs', 'csfSerialDay_'],
  ['ClientSourceFinance.gs', 'csfDays_'], ['ClientSourceFinance.gs', 'csfSpan_'], ['Hotline.gs', 'HOTLINE_TRANSCRIPTS_TAB'],
  ['Hotline.gs', 'HOTLINE_COLS'],
]

/* ---------- the stores ---------- */

type Row = Record<string, unknown>
type Grid = unknown[][]
type DriveFile = { name: string; mime: string; bytes: number[] }

const PLAN = [
  'Important People', 'Type', 'Name/Relationship', 'Address', 'Phone',
  'Family', 'Rita Long (aunt)', '5 Elm St, Canton, OH', '330-555-0177',
  'Case Manager', 'Sam Support', '330-555-0199',
].join('\n')

function freshStores() {
  return {
    // the clients as clientsDerived_ answers them
    clients: [
      { client_key: 'meganfern', id: 'CLI_meganfern', name: 'Megan Fern', house: 'NW4045', status: 'active',
        guardianName: 'Jeana Fern', guardian_relationship: 'Mom', guardian_phone: '3305550101',
        guardian_email: 'Jeana.Fern@Example.org', guardian_address: '12 Oak St, Canton, OH', guardianship_papers: PAPERS,
        isp_signed_date: '2026-03-01', contacts: 'Guardian: Jeana Fern, her mom and guardian.', medications: ['Secret pill'] },
      { client_key: 'evanfern', id: 'CLI_evanfern', name: 'Evan Fern', house: 'BW1001', status: 'active',
        guardianName: 'Jeana Fern', guardian_relationship: 'Mother', guardian_phone: '(330) 555-0101' },
      { client_key: 'kelliemarsh', id: 'CLI_kelliemarsh', name: 'Kellie Marsh', house: 'NW4045', status: 'active',
        guardianName: 'Denise Hollenbach', guardian_relationship: 'State Appointed', guardian_phone: '3305550155' },
      { client_key: 'jessicahankins', id: 'CLI_jessicahankins', name: 'Jessica Hankins', house: 'BW1001', status: 'active',
        guardianName: 'Self' },
      { client_key: 'owenpal', id: 'CLI_owenpal', name: 'Owen Pal', house: 'BW1001', status: 'active',
        guardianName: 'Gil Buddy', guardian_relationship: 'Friend', guardian_phone: '3305550166' },
    ] as Row[],
    books: {
      entity_homes: [
        ['abbreviation', 'home_name', 'address', 'region', 'telephone', 'manager_name', 'manager_phone', 'calendar_link', 'thumbnail_url'],
        ['NW4045', 'CAN - NW - NW4045', '908 Arlington Ave NW, Canton, OH 44708', 'Canton', '3305550100', '', '', '', ''],
        ['BW1001', 'CAN - BW - BW1001', '12 Briar Way, Canton, OH 44708', 'Canton', '', '', '', '', ''],
      ],
      Master: [['Client', 'Guardian']],
      'Archive - Old Clients': [['Customer', 'House', 'Status', 'Guardian', 'Guardian Relationship', 'Guardian #'],
        ['Old Timer', 'QQ1000', 'Discharged', 'Grace Timer', 'Sister', '3305550133']],
      Transcripts: [
        ['Call ID', 'Transcript Created', 'Event Timestamp', 'Duration (sec)', 'Direction', 'Participant(s)', 'Team Member(s)'],
        ['AC1', '2026-09-15T14:01:00Z', '2026-09-15T14:00:00Z', 180, 'incoming', '+13305550101', '+13305550100'],
        ['AC2', '2026-09-16T14:01:00Z', '2026-09-16T14:00:00Z', 30, 'incoming', '+13305550999', '+13305550100'],
      ],
    } as Record<string, Grid>,
    tables: {
      isps: [
        { client_key: 'meganfern', isp_year: '3/1/2026 - 2/28/2027', loaded_at: '2026-03-02T10:00:00Z' },
        { client_key: 'jessicahankins', isp_year: '1/1/2026 - 12/31/2026', loaded_at: '2026-01-02T10:00:00Z', contact_block: PLAN },
      ],
      people: [
        { id: 'PPL_guardian_jeanafern', name: 'Jeana Fern', role: 'guardian', guardian_for: 'Megan Fern',
          phone: '330-555-0101', avatar: 'https://example.org/jeana.jpg' },
        { id: 'P1', name: 'Noah Reed', role: 'DSP' },
      ],
      clientFiles: [
        { id: 'cf1', client_key: 'meganfern', client_name: 'Megan Fern', title: 'Consent for release of information',
          drive_id: 'consent00001', issued_on: '2026-05-01' },
        { id: 'cf2', client_key: 'meganfern', client_name: 'Megan Fern', title: 'Dental x-ray', drive_id: 'xrayfile0001' },
        { id: 'cf3', client_key: 'otherclient', client_name: 'Other Client', title: 'Guardianship letter', drive_id: 'foreign00001' },
        { id: 'cf5', client_key: 'meganfern', client_name: 'Megan Fern', title: 'Letters of Guardianship', doc_kind: 'guardianship',
          digest_category: 'legal', drive_id: 'guardletter1', issued_on: '2026-04-01' },
        { id: 'cf6', client_key: 'meganfern', client_name: 'Megan Fern', title: 'Benefit letter - Job and Family Services',
          doc_kind: 'benefit_letter', digest_category: 'receipt_invoice', drive_id: 'jfsletter001' },
        { id: 'cf7', client_key: 'meganfern', client_name: 'Megan Fern', title: 'Receipt paid by Jeana Fern', folder: 'Receipts',
          drive_id: 'receipt00001' },
        { id: 'cf4', client_key: 'meganfern', client_name: 'Megan Fern', title: 'Birth certificate of Jeana Fern', doc_kind: 'birth',
          drive_id: 'birthcert001' },
      ],
      tasks: [] as Row[],
    } as Record<string, Row[]>,
    files: {
      [PAPERS]: { name: 'Guardianship.pdf', mime: 'application/pdf', bytes: PDF },
      ispdoc000001: { name: 'Megan Fern ISP 2026.pdf', mime: 'application/pdf', bytes: PDF },
      consent00001: { name: 'Consent.pdf', mime: 'application/pdf', bytes: PDF },
      xrayfile0001: { name: 'Xray.pdf', mime: 'application/pdf', bytes: PDF },
      foreign00001: { name: 'Other.pdf', mime: 'application/pdf', bytes: PDF },
      guardletter1: { name: 'Letters.pdf', mime: 'application/pdf', bytes: PDF },
      jfsletter001: { name: 'Jfs.pdf', mime: 'application/pdf', bytes: PDF },
      receipt00001: { name: 'Receipt.pdf', mime: 'application/pdf', bytes: PDF },
      birthcert001: { name: 'Birth.pdf', mime: 'application/pdf', bytes: PDF },
    } as Record<string, DriveFile>,
    tabs: {
      quo_messages: sheetOf([
        ['message_id', 'message_created', 'direction', 'from_number', 'to_number', 'body', 'quo_number'],
        ['M1', '2026-09-20T12:00:00Z', 'incoming', '+13305550101', '+13305550100', 'Can Megan come home Sunday?', 'PN_main'],
        ['M2', '2026-09-21T12:00:00Z', 'incoming', '+13305550999', '+13305550100', 'stranger text', 'PN_main'],
      ]),
    } as Record<string, ReturnType<typeof sheetOf>>,
    calendar: [
      ['Location', 'Employee', 'Position', 'Notes', 'Date', 'Start Time', 'End Time'],
      ['CAN - NW - NW4045', 'FAMILY', '', '', '2026-09-26', '08:00', '16:00'],
      ['CAN - NW - NW4045', 'FAMILY', '', '', '2026-09-27', '08:00', '16:00'],
      ['CAN - NW - NW4045', 'Noah Reed', '', '', '2026-09-27', '16:00', '23:00'],
    ] as Grid | null,
    incidents: [
      { id: 'I1', client_name: 'Megan Fern', incident_category: 'Fall', incident_date: '2026-09-18', incident_time: '10:00',
        summary_of_incident: 'Jeana Fern called to say Megan fell at home', your_name: 'Boss', timestamp: '2026-09-18T15:00:00Z' },
      { id: 'I2', client_name: 'Megan Fern', incident_category: 'Med error', incident_date: '2026-09-19',
        summary_of_incident: 'A missed dose', your_name: 'Boss', timestamp: '2026-09-19T15:00:00Z' },
    ] as Row[],
    packOpen: true,
    // the relay's index of the whole app: shut unless a case opens it (its lane is the first, and the others are each
    // proved on their own), or still being gathered
    index: 'shut' as 'shut' | 'open' | 'filling',
  }
}

function sheetOf(grid: Grid) {
  const width = () => (grid[0] ?? []).length
  const cell = (r: number, c: number) => (grid[r] ?? [])[c] ?? ''
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: width,
    getDataRange: () => ({ getValues: () => grid.map((_, r) => Array.from({ length: width() }, (_, c) => cell(r, c))) }),
    getRange: (r: number, c: number, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r - 1 + i, c - 1 + j))),
      setValue: (v: unknown) => {
        while (grid.length < r) grid.push([])
        grid[r - 1][c - 1] = v
      },
    }),
    appendRow: (line: unknown[]) => { grid.push([...line]) },
  }
}

let S = freshStores()

function formatDate(date: Date, tz: string, pattern: string): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(date)
  if (pattern === 'yyyy-MM-dd') {
    return `${part({ year: 'numeric' })}-${part({ month: '2-digit' }).padStart(2, '0')}-${part({ day: '2-digit' }).padStart(2, '0')}`
  }
  if (pattern === 'HH:mm') return part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/* ---------- Apps Script, booted ---------- */

type Answer = { status: number; data?: unknown; message?: string }
type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; params?: Record<string, unknown> }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => Answer>
  FAM_ACTIONS: string[]
  FAM_PACK_PARTS: string[]
  FAM_CALL_PRIORITIES: string[]
  FAM_NOTE_MAX: number
  famKeyOf_: (name: unknown) => string
}

const LINES: Record<string, { name: string; e164: string; shared: boolean; humans: number; owner: string }> = {
  '3305550100': { name: 'Main line', e164: '+13305550100', shared: false, humans: 1, owner: 'Ann Lee' },
}

const MASTER_ID = 'U_boss'

type Scope = { kind: string; client_keys: string[]; house_codes: string[]; ssa_keys: string[]; family_keys: string[]; why: string }
const scopeOf = (kind: string, clients: string[] = []): Scope =>
  ({ kind, client_keys: clients, house_codes: [], ssa_keys: [], family_keys: [], why: '' })
const CLOSED = () => ({ open: false, scope: scopeOf('none') })
/** No App Control row names the app: it is the master's alone. */
let GATE: (app: string, u: Row | null) => { open: boolean; scope: Scope } = CLOSED
/** App Control releases the app to this session's badge, with this scope. */
const released = (scope: Scope) => {
  GATE = (app) => (app === 'family-profiles' ? { open: true, scope } : CLOSED())
}

function boot(): Gs {
  let uuid = 0
  let task = 0
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, isFinite, parseInt, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {}, CLIENTS_DERIVED_MEMO_: null,
    RESOURCES: { tasks: { ownedBy: 'owner_id' } },
    Utilities: {
      formatDate, getUuid: () => `u${++uuid}`,
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
    // ViewerScope.gs's gate, as App Control answers it for the case at hand
    hubProfileAppGate_: (app: string, u: Row | null) => GATE(app, u),
    hubMasterEmail_: () => 'boss@example.org',
    userByEmail_: (email: string) => (email === 'boss@example.org' ? { id: MASTER_ID, email } : null),
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
    clientPhotoIndex_: () => ({ meganfern: 'https://example.org/megan.jpg' }),
    listRows_: (r: string) => JSON.parse(JSON.stringify(S.tables[r] ?? [])),
    estateRows_: (r: string) => (r === 'uiIncidents' ? JSON.parse(JSON.stringify(S.incidents)) : []),
    commBroadcastCalendarRows_: () => {
      if (!S.calendar) throw new Error('the archive is not reachable')
      return { values: S.calendar.map((l) => [...l]), tz: 'America/New_York' }
    },
    ispDocIndex_: () => ({ files: { meganfern: 'ispdoc000001' } }),
    ispDocFor_: (name: string) => (name === 'Megan Fern'
      ? { id: 'ispdoc000001', name: 'Megan Fern ISP 2026.pdf', url: '' } : { id: '', name: '', url: '' }),
    hubLineOurs_: (d: string) => !!LINES[d],
    hubLineRow_: (id: string) => LINES[id] ?? null,
    hubTabSheet_: (tab: string) => S.tabs[tab] ?? null,
    hubTabEnsure_: (tab: string, header: string[]) => (S.tabs[tab] ??= sheetOf([[...header]])),
    ensureHeader_: (sheet: ReturnType<typeof sheetOf>, keys: string[]) => {
      const head = (sheet.grid[0] ?? []).map(String)
      for (const k of keys) if (!head.includes(k)) head.push(k)
      sheet.grid[0] = head
      return [...head]
    },
    // the Task Board's own create, as the router files it: the owner stamped from the session
    route: (resource: string, verb: string, card: Row, user: Row) => {
      if (resource !== 'tasks' || verb !== 'create') return { status: 400, message: 'not stood in for' }
      const made = { ...card, id: `T${++task}`, createdAt: NOW, owner_id: user.email === 'boss@example.org' ? MASTER_ID : 'U_other' }
      S.tables.tasks.push(made)
      return { status: 200, data: made }
    },
    sheetDbGateHolds_: () => null,
    sheetDbRefused_: () => null,
    hubSysLog_: () => true,
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('Locations.gs'), ctx)
  vm.runInContext(gsText('ClientProfiles.gs'), ctx)
  vm.runInContext(gsText('RecordEdit.gs'), ctx)
  vm.runInContext(gsText('FamilyProfiles.gs'), ctx)
  bootClientFiles(ctx)
  return ctx as unknown as Gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin', display_name: 'Boss' }
const DIRECTOR = { email: 'dee@example.org', role: 'admin', display_name: 'Dee Rector' }
const SERVICE = { email: 'relay@example.org', role: 'admin', is_service: true }
let SESSION: Row = MASTER

/** A door's answer as the platform's envelope carries it. */
function door(action: string, payload: Row, user: Row = SESSION): Answer {
  const fn = GS.HUB_ACTIONS[action]
  return fn ? JSON.parse(JSON.stringify(fn(JSON.parse(JSON.stringify(payload)), user))) : { status: 404, message: 'Unknown action.' }
}

/* ---------- the page's calls, answered by the relay's pack and the doors ---------- */

let seen: { kind: 'pack' | 'gas' | 'other'; name: string; payload?: Row; url?: string }[] = []
const realFetch = globalThis.fetch
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

before(() => {
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/erp-lanes/app-pack/')) {
      const app = decodeURIComponent(url.slice('/erp-lanes/app-pack/'.length).split('?')[0])
      const key = decodeURIComponent(new Headers(init?.headers).get('X-App-Pack-Key') ?? '')
      seen.push({ kind: 'pack', name: `${app}:${key}`, url })
      if (app === 'family-index' && S.index !== 'shut') {
        if (SESSION !== MASTER) return json({ status: 403, message: 'Not here.' }, 403)
        if (S.index === 'filling') return json({ status: 503, reason: 'filling', message: 'This read is still being gathered.' })
        // the relay holds what the service identity's familyIndexPack answered, and tells the master its own view
        const got = door('familyIndexPack', {}, SERVICE)
        return json(got.status === 200
          ? { status: 200, data: { ...(got.data as Row), read_age_s: 1, view: { kind: 'master', notes: true } } } : got)
      }
      if (!S.packOpen || app !== 'family-profiles') return json({ status: 404, reason: 'unknown' }, 404)
      // the relay's door is the master's alone; the pack itself is gathered by the service identity
      if (SESSION !== MASTER) return json({ status: 403, message: 'Not here.' }, 403)
      const got = door('familyPack', { family: key }, SERVICE)
      return json(got.status === 200 ? { status: 200, data: { ...(got.data as Row), read_age_s: 1 } } : got)
    }
    if (url.startsWith('/snapshot/')) {
      seen.push({ kind: 'other', name: url })
      return new Response('no', { status: 404 })
    }
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action?: string; payload: Row }
    if (!env.action) return json({ status: 200, data: {} })
    seen.push({ kind: 'gas', name: env.action, payload: env.payload ?? {} })
    return json(door(env.action, env.payload ?? {}))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  S = freshStores()
  SESSION = MASTER
  GATE = CLOSED
  useAuthStore.setState({ user: null } as never)
  seen = []
  forgetSnapshot()
  forgetPack()
  forgetFamilyReads()
  useMemberStore.setState({ currentMemberId: '' } as never)
})
afterEach(async () => {
  // a neighbour's prefetch waits for an idle moment: let it drop, and its turn end, before the next case
  await new Promise((r) => setTimeout(r, 100))
  forgetPack()
  await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS + 400))
})

const gasCalls = () => seen.filter((s) => s.kind === 'gas').map((s) => s.name)
const packAsks = () => seen.filter((s) => s.kind === 'pack').map((s) => s.name)

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

const RELAY_NO_RECEIPT = (): Set<string> => {
  const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
  const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
  return new Set([...line.matchAll(/"(\w+)"/g)].map((m) => m[1]))
}

/* ---------- the app ---------- */

describe('the app', () => {
  after(() => useAuthStore.setState({ user: null } as never))

  it('is "Families & Guardians", id family-profiles, one page "profile" on the houses slice, for admins and managers, next to Clients', () => {
    const app = familyProfilesManifests[0]
    assert.deepEqual([app.id, app.name, app.icon, app.accent, app.category, app.isNew, app.enabled],
      ['family-profiles', 'Families & Guardians', 'users-round', 'peach', 'Care', true, true])
    assert.deepEqual([app.audience, app.focusAudience], [['admin', 'manager', 'client'], []])
    assert.deepEqual(app.pages.map((p) => [p.id, p.title, (p as { dataSource?: { resource?: string } }).dataSource?.resource]),
      [['profile', 'Family Profile', 'houses']])
    assert.equal(appManifests.filter((m) => m.id === 'family-profiles').length, 1)
    const ids = appManifests.map((m) => m.id)
    assert.ok(ids.indexOf('family-profiles') > ids.indexOf('client-profiles'), 'registered after Clients')
    assert.ok(ids.slice(ids.indexOf('client-profiles') + 1, ids.indexOf('family-profiles')).every((id) => id.endsWith('-profiles')),
      'among the profile apps that follow Clients')
  })

  it('is mounted only through CUSTOM_PAGES, never on a static route', async () => {
    // a lazy chunk (lib/lazyPage): the entry resolves to the screen itself
    assert.equal(await CUSTOM_PAGES['family-profiles/profile'].load(), FamilyProfilesPage)
    assert.ok(!readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8').includes('family-profiles'), 'no static route in App.tsx')
  })

  it('ships no App Control row: a non-master admin is refused, the master passes', async () => {
    // the screen's chunk is in before the render, so the master's render draws it rather than a fallback
    await CUSTOM_PAGES['family-profiles/profile'].load()
    const director = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
    const master = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
    assert.equal(badgeAllowsApp('family-profiles', director as never, {}), false)
    assert.equal(badgeAllowsApp('family-profiles', { ...director, role: 'manager' } as never, { houses: ['DIRECTOR'] }), false)
    assert.equal(badgeAllowsApp('family-profiles', master as never, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools', 'server']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(name)) continue
        const text = readFileSync(join(resolve(ROOT, dir), name), 'utf8')
        if (/app_badge_access[^\n]{0,200}['"]family-profiles['"]|['"]family-profiles['"][^\n]{0,200}app_badge_access/.test(text)) hits.push(name)
      }
    }
    assert.deepEqual(hits, [])

    useRegistryStore.setState({ apps: appManifests })
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} } as never)
    const open = () => flat(renderToString(createElement(MemoryRouter, { initialEntries: [`/app/family-profiles/profile?family=${KEY}`] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) })))))
    useAuthStore.setState({ user: director } as never)
    assert.equal(isAllowedWith(appManifests, 'admin', 'family-profiles'), false)
    assert.ok(!open().includes('data-family-profiles'), 'a director sees nothing of it')
    useAuthStore.setState({ user: master } as never)
    assert.equal(isAllowedWith(appManifests, 'admin', 'family-profiles'), true)
    assert.ok(open().includes('data-family-profiles'), 'the master gets the screen')
  })
})

/* ---------- the names ---------- */

describe('the names', () => {
  it('every door the page names is a FamilyProfiles.gs action, every such action has a caller, and each is in the catalogue', () => {
    const named = new Set<string>()
    for (const f of walk(FEATURE)) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    // the platform's read of a viewer's editions (Editions.gs) rides beside Families' own doors
    const platform = new Set(['editionsMine'])
    // a note's and a call's edit, New Family, its client choices and a paper added are Python's alone (app/doors.json)
    const py: Record<string, { file: string }> = JSON.parse(readFileSync(resolve(ROOT, 'app/doors.json'), 'utf8'))
    const pyFamily = [...named].filter((n) => py[n]).sort()
    assert.deepEqual(pyFamily, ['familyClientChoices', 'familyCreate', 'familyProfileCallEdit', 'familyProfileDocAdd', 'familyProfileNoteEdit'])
    for (const name of pyFamily) {
      assert.ok(['app/family.py', 'app/family_writes.py'].includes(py[name].file), `${name} is answered by app/family*.py`)
      assert.equal(GS.HUB_ACTIONS[name], undefined, `${name} has no Apps Script handler`)
    }
    for (const name of named) {
      if (platform.has(name) || py[name]) continue
      assert.equal(GS.HUB_POLICY[name]?.file, 'FamilyProfiles.gs', `${name} is declared in FamilyProfiles.gs`)
      assert.equal(typeof GS.HUB_ACTIONS[name], 'function', `${name} has a handler`)
    }
    assert.deepEqual([...named].filter((n) => !platform.has(n) && !py[n]).sort(), [...GS.FAM_ACTIONS].sort())
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of named) assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
  })

  it('the pack parts the page reads are the ones familyPack gathers', () => {
    const reads = readFileSync(resolve(ROOT, FEATURE, 'familyReads.ts'), 'utf8')
    const parts = [...reads.matchAll(/familyPackOr\(family, '([a-z_]+)'/g)].map((m) => m[1]).sort()
    assert.deepEqual(parts, [...GS.FAM_PACK_PARTS].sort())
  })

  it('a family member is keyed exactly as FamilyProfiles.gs keys them; the call\'s priorities are the door\'s', () => {
    for (const name of ['Jeana Fern', 'Jeana  Fern ', 'N/A', 'none', 'Self', 'Jo', 'Stark County Board of DD', '', 'No guardian listed',
      'Guardianship Services Inc', 'Rita Long']) {
      assert.equal(familyKeyOf(name), GS.famKeyOf_(name), JSON.stringify(name))
    }
    const priorities = readFileSync(resolve(ROOT, FEATURE, 'familyModel.ts'), 'utf8')
    for (const p of GS.FAM_CALL_PRIORITIES) assert.ok(priorities.includes(`id: '${p}'`), p)
  })

  it('a session that is not the master in its own gets "Unknown action.", which the page says as a sentence', async () => {
    S.packOpen = false
    SESSION = DIRECTOR
    await assert.rejects(readOverview(KEY), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
    SESSION = { ...MASTER, visiting_member: 'mem_1' }
    await assert.rejects(readRoster(), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
    assert.equal(door('familyPack', { family: KEY }, MASTER).status, 404, 'the pack answers the service identity only')
  })

  it('a family member no record names is refused in words', async () => {
    S.packOpen = false
    await assert.rejects(readOverview('fam_nobodyatall'), /No family member "fam_nobodyatall" is on file/)
  })
})

/* ---------- the lanes ---------- */

describe('the lanes: the relay\'s pack, then the door', () => {
  it('the switcher\'s roster is the action\'s: the record\'s guardians, the plans\' family, the archive\'s — never an appointed one', async () => {
    const r = rosterOf(await readRoster())
    assert.deepEqual(gasCalls(), ['familyProfileRoster'])
    assert.deepEqual(r.families.map((f) => [f.key, f.relationship, f.clients, f.status]), [
      ['fam_gracetimer', 'Sister', 1, 'inactive'], ['fam_jeanafern', 'Mother', 2, 'active'], ['fam_ritalong', 'Aunt', 1, 'active']])
    assert.ok(!r.families.some((f) => /Hollenbach|Sam Support/.test(f.name)), 'a state-appointed guardian and a case manager are not family')
    assert.ok(!r.families.some((f) => /Gil Buddy/.test(f.name)), 'a guardian the record calls a friend is not family')
  })

  it('every section reads the relay\'s pack first — the key in the header, never the address — and the door\'s own answer is the same', async () => {
    const [o, d, a, n] = await Promise.all([readOverview(KEY), readDocuments(KEY), readActivity(KEY), readNotes(KEY)])
    assert.deepEqual(gasCalls(), [], 'no section read its door')
    assert.equal(packAsks().filter((p) => p === `family-profiles:${KEY}`).length, 1, 'one pack serves every section')
    assert.ok(seen.every((s) => !(s.url ?? '').includes('jeana')), 'the key rides the header, never the address')
    assert.deepEqual(overviewOf(o), overviewOf(door('familyProfileOverview', { family: KEY }).data))
    assert.deepEqual(documentsOf(d), documentsOf(door('familyProfileDocuments', { family: KEY }).data))
    assert.deepEqual(activityOf(a).items.map((x) => x.id), activityOf(door('familyProfileActivity', { family: KEY }).data).items.map((x) => x.id))
    assert.deepEqual(notesOf(n), notesOf(door('familyProfileNotes', { family: KEY }).data))
  })

  it('when the relay has no pack door, each section reads its own action', async () => {
    S.packOpen = false
    await Promise.all([readOverview(KEY), readDocuments(KEY), readActivity(KEY), readNotes(KEY)])
    assert.deepEqual(gasCalls().sort(), ['familyProfileActivity', 'familyProfileDocuments', 'familyProfileNotes', 'familyProfileOverview'])
  })

  it('a family member the roster holds as inactive is never asked of the relay', async () => {
    await readRoster()
    seen = []
    await readOverview('fam_gracetimer')
    assert.deepEqual(packAsks(), [])
    assert.deepEqual(gasCalls(), ['familyProfileOverview'])
  })
})

describe('the lanes: the relay\'s index of the whole app first', () => {
  it('opening the app reads the roster, the overview and the admin notes from the index — one ask, no door — each the door\'s own answer', async () => {
    S.index = 'open'
    await addNote(KEY, 'Prefers a call after five')
    seen = []
    const roster = await readRoster()
    const [o, n] = await Promise.all([readOverview(KEY), readNotes(KEY)])
    assert.deepEqual(gasCalls(), [], 'no Apps Script door was asked')
    assert.equal(packAsks().filter((p) => p === 'family-index:all').length, 1, 'one index serves the roster and both sections')
    assert.ok(seen.every((s) => !(s.url ?? '').includes('jeana')), 'no family key rides the address')
    const r = rosterOf(roster)
    assert.deepEqual(r.families, rosterOf(door('familyProfileRoster', {}).data).families)
    assert.deepEqual(r.view, { kind: 'master', notes: true }, 'the relay says which view the session reads')
    assert.deepEqual(overviewOf(o), overviewOf(door('familyProfileOverview', { family: KEY }).data))
    assert.deepEqual(notesOf(n).notes.map((x) => x.body), ['Prefers a call after five'])
    assert.deepEqual(notesOf(n), notesOf(door('familyProfileNotes', { family: KEY }).data))
  })

  it('an inactive family member\'s overview is the index\'s too, never a per-member pack', async () => {
    S.index = 'open'
    await readRoster()
    seen = []
    const o = overviewOf(await readOverview('fam_gracetimer'))
    assert.deepEqual(gasCalls(), [])
    assert.ok(!packAsks().includes('family-profiles:fam_gracetimer'))
    assert.deepEqual(o, overviewOf(door('familyProfileOverview', { family: 'fam_gracetimer' }).data))
  })

  it('an index the relay is still gathering: the roster reads its door, and a section never waits on it', async () => {
    S.index = 'filling'
    const r = rosterOf(await readRoster())
    assert.deepEqual(gasCalls(), ['familyProfileRoster'])
    assert.ok(r.families.some((f) => f.key === KEY))
    seen = []
    await readOverview(KEY)
    assert.deepEqual(gasCalls(), [], 'the overview came from the family member\'s pack')
    assert.ok(packAsks().includes(`family-profiles:${KEY}`))
  })

  it('a note filed: no index read before it was sent is drawn — the relay is told — and the section shows the note at once', async () => {
    S.index = 'open'
    const h = mountHook(() => useFamilyRead(readKey('familyProfileNotes', KEY), () => readNotes(KEY), notesOf), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(h.current.data?.notes.length, 0)
    seen = []
    const sentAt = Date.now()
    const got = await addNote(KEY, 'Called about Sunday')
    h.run(() => { familyWrote(KEY, got, sentAt) })
    await h.settle(() => (h.current.data?.notes.length ?? 0) === 1 && !h.current.refreshing)
    assert.equal(h.current.data?.notes[0].body, 'Called about Sunday')
    const asked = seen.filter((s) => s.kind === 'pack' && s.name === 'family-index:all').map((s) => s.url ?? '')
    assert.ok(asked.length >= 1 && asked.every((u) => /written_ms=\d+/.test(u)), asked.join(' | '))
    h.unmount()
  })

  it('a call scheduled leaves the index as it is: the relay is not told to read it again', async () => {
    S.index = 'open'
    await readRoster()
    const today = ohioToday()
    const sentAt = Date.now()
    const got = await scheduleCall({ family: KEY, client_key: 'meganfern', date: today, priority: 'normal', details: '' })
    familyWrote(KEY, got, sentAt, false)
    seen = []
    await readRoster()
    const asked = seen.filter((s) => s.kind === 'pack' && s.name === 'family-index:all').map((s) => s.url ?? '')
    assert.equal(asked.length, 1)
    assert.ok(!asked[0].includes('written_ms='), asked[0])
  })
})

/* ---------- the reads, as the page reads them ---------- */

describe('the reads', () => {
  it('overview: the details, every client they are family of (each a link into Clients), where they were found', async () => {
    const o = overviewOf(await readOverview(KEY))
    assert.deepEqual([o.family.name, o.family.phone, o.family.email, o.family.address, o.family.status, o.family.avatar],
      ['Jeana Fern', '(330) 555-0101', 'jeana.fern@example.org', '12 Oak St, Canton, OH', 'active', 'https://example.org/jeana.jpg'])
    assert.deepEqual(o.clients.map((c) => [c.client_key, c.relationship, c.house_label]), [
      ['evanfern', 'Mother', 'CAN - BW - BW1001'], ['meganfern', 'Mom', 'CAN - NW - NW4045']])
    assert.ok(o.family.sources.includes('Client record') && o.family.sources.includes('People directory'), o.family.sources.join())
    assert.ok(!/medications|Secret pill/.test(JSON.stringify(await readOverview(KEY))), 'nothing clinical')
    const row = rosterOf(await readRoster()).families.find((f) => f.key === KEY) as RosterRow
    useAuthStore.setState({ user: { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true } } as never)
    const html = draw(createElement(OverviewView, { row, overview: ready(o), onRetryOverview: noop }))
    assert.ok(html.includes(`href="${CLIENTS_PATH}?client=meganfern"`) && html.includes(`href="${CLIENTS_PATH}?client=evanfern"`),
      'a client opens in Clients')
    for (const w of ['Family Details', 'Relationship', 'Mother of Evan Fern · Mom of Megan Fern', 'href="tel:3305550101"',
      'href="mailto:jeana.fern@example.org"', 'Address', '12 Oak St, Canton, OH', 'Associated clients', 'Mom · CAN - NW - NW4045',
      'Named in: Client record', '2 clients whose records name Jeana Fern as family.']) {
      assert.ok(html.includes(w), w)
    }
    assert.ok(!html.includes('Admin notes'), 'the admin notes are their own tab')
    noModal(html, 'overview')
    // Settings › My Work: the source line, the clients' count and the side pencils are the master's alone
    useAuthStore.setState({ user: { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'],
      isMaster: false } } as never)
    const bare = draw(createElement(OverviewView, { row, overview: ready(o), onEdit: noop, onRetryOverview: noop }))
    assert.ok(!bare.includes('Named in:') && !bare.includes('whose records name') && !bare.includes('Edit relationships'))
    assert.ok(bare.includes('Edit family details') && bare.includes('Mom · CAN - NW - NW4045'), 'the details and the clients stay')
    const d = documentsOf(await readDocuments(KEY))
    const docs = (onEdit?: () => void) => draw(createElement(DocumentsView, { row: { key: KEY, name: 'Jeana Fern' }, docs: ready(d),
      doc: { opening: '', open: noop }, onRetry: noop, onEdit, onAdd: noop }))
    assert.ok(!docs(noop).includes('3 documents') && !docs(noop).includes('Edit guardianship papers') && docs(noop).includes('data-add-doc'))
    useAuthStore.setState({ user: { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'],
      isMaster: false, familyDetailsHidden: false } } as never)
    assert.ok(docs(noop).includes('3 documents') && docs(noop).includes('Edit guardianship papers'), 'shown while the switch is off')
    useAuthStore.setState({ user: null } as never)
  })

  it('an unknown e-mail and address are left out of the details, never shown as a made-up value', () => {
    const o = overviewOf({ family: { key: 'fam_ritalong', name: 'Rita Long', relationships: ['Aunt'], phone: '', email: '', address: '' },
      clients: [{ client_key: 'jessicahankins', name: 'Jessica Hankins', relationship: 'Aunt', house: 'BW1001' }] })
    const row: RosterRow = { key: 'fam_ritalong', name: 'Rita Long', relationship: 'Aunt', phone: '', email: '', clients: 1, status: 'active', avatar: '' }
    const html = draw(createElement(OverviewView, { row, overview: ready(o), onRetryOverview: noop }))
    assert.ok(html.includes('Not on file'), 'no phone is "Not on file"')
    assert.ok(!html.includes('>Email<') && !html.includes('>Address<'), 'no e-mail or address row')
  })

  it('documents: the guardianship papers, the plan and the client files that are guardianship papers — never a consent, a receipt, a benefit letter, another\'s file or an identity paper — each opening as bytes', async () => {
    const d = documentsOf(await readDocuments(KEY))
    assert.deepEqual(d.docs.map((x) => [x.kind, x.file_id, x.client_key]).sort(), [
      ['client_doc', 'guardletter1', 'meganfern'], ['guardianship', PAPERS, 'meganfern'], ['isp', 'ispdoc000001', 'meganfern']])
    for (const x of d.docs) {
      const got = await readDocFile(KEY, x.file_id)
      assert.ok(docShapeOf(got.mime) && blobOf(got), `${x.title} opens in the platform`)
    }
    await assert.rejects(readDocFile(KEY, 'foreign00001'), /names no such document/, 'another client\'s file is refused')
    await assert.rejects(readDocFile(KEY, 'birthcert001'), /names no such document/, 'an identity paper is never served')
    await assert.rejects(readDocFile(KEY, 'xrayfile0001'), /names no such document/, 'a file that does not concern the family is not theirs')
    for (const id of ['consent00001', 'jfsletter001', 'receipt00001']) {
      await assert.rejects(readDocFile(KEY, id), /names no such document/, `${id}: a consent, a benefit letter or a receipt is never theirs`)
    }
    const html = draw(createElement(DocumentsView, { row: { key: KEY, name: 'Jeana Fern' }, docs: ready(d),
      doc: { opening: '', open: noop }, onRetry: noop }))
    assert.equal((html.match(/data-open-doc="/g) ?? []).length, 3)
    assert.ok(html.includes('Megan Fern · Guardianship papers') && html.includes('Megan Fern · ISP'))
    noModal(html, 'documents')
  })

  it('activity: the notes, texts and calls on their own phone, the plan, the FAMILY shifts, the incidents naming them; a stranger never', async () => {
    const a = activityOf(await readActivity(KEY))
    const kinds = new Set(a.items.map((x) => x.kind))
    for (const k of ['sms', 'call', 'isp', 'calendar', 'incident'] as const) assert.ok(kinds.has(k), k)
    assert.ok(!JSON.stringify(a.items).includes('stranger text'))
    assert.ok(!JSON.stringify(a.items).includes('A missed dose'), 'an incident that does not name them is not theirs')
    const shift = a.items.find((x) => x.kind === 'calendar')
    assert.equal(shift?.client_key, 'meganfern', 'a FAMILY cell at the one house they have a client at is tied to that client')
    const clients = overviewOf(door('familyProfileOverview', { family: KEY }).data).clients
    const html = draw(createElement(ActivityView, { row: { key: KEY, name: 'Jeana Fern' }, activity: ready(a), clients, onRetry: noop }))
    assert.ok(html.includes('Family coverage shifts') && html.includes('Family coverage shift ·'), 'the kind and the date')
    assert.ok(html.includes(`href="${CLIENTS_PATH}?client=meganfern"`), 'the client is a link')
    assert.ok(html.includes('href="/app/family-profiles/profile?family=fam_jeanafern"'), 'the family member is a link')
    noModal(html, 'activity')
  })

  it('a source that cannot be read is said, line by line, and the answer is marked — never taken for nothing', async () => {
    S.packOpen = false
    S.calendar = null
    const a = activityOf(await readActivity(KEY))
    assert.equal(a.degraded, true)
    assert.ok(a.why.some((w) => /Calendar Archive/i.test(w)), a.why.join(' | '))
    const html = draw(createElement(ActivityView, { row: { key: KEY, name: 'Jeana Fern' }, activity: ready(a), clients: [], onRetry: noop }))
    assert.ok(html.includes('data-degraded=""') && html.includes('Part of this could not be read.'))
  })
})

/* ---------- the writes ---------- */

describe('the writes', () => {
  it('an admin note is filed, read back on the notes and in Activity; an empty one is refused', async () => {
    S.packOpen = false
    const got = await addNote(KEY, 'Prefers a call after five')
    assert.equal(familyWrote(KEY, got), false, 'the door\'s own answer is the note, not a ledger receipt')
    const n = notesOf(await readNotes(KEY))
    assert.deepEqual(n.notes.map((x) => [x.by, x.body]), [['Boss', 'Prefers a call after five']])
    const a = activityOf(await readActivity(KEY))
    assert.ok(a.items.some((x) => x.kind === 'note' && x.body === 'Prefers a call after five'))
    await assert.rejects(addNote(KEY, '   '), /body/)
  })

  it('a note filed from the page is on the section at once: the write forgets the family member and the section reads again', async () => {
    S.packOpen = false
    const h = mountHook(() => useFamilyRead(readKey('familyProfileNotes', KEY), () => readNotes(KEY), notesOf), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(h.current.data?.notes.length, 0)
    const sentAt = Date.now()
    const got = await addNote(KEY, 'Called about Sunday')
    h.run(() => { familyWrote(KEY, got, sentAt) })
    await h.settle(() => (h.current.data?.notes.length ?? 0) === 1 && !h.current.refreshing)
    assert.equal(h.current.data?.notes[0].body, 'Called about Sunday')
    h.unmount()
  })

  it('a call is scheduled on the Task Board for one of their clients and shows in Activity; a stranger\'s client or a past day is refused', async () => {
    S.packOpen = false
    const today = ohioToday()
    const got = await scheduleCall({ family: KEY, client_key: 'meganfern', date: today, priority: 'high', details: 'About Sunday' })
    assert.equal((got as { call?: { client_key?: string } }).call?.client_key, 'meganfern')
    assert.equal(S.tables.tasks.length, 1)
    assert.deepEqual([S.tables.tasks[0].family_key, S.tables.tasks[0].priority, S.tables.tasks[0].due], [KEY, 'high', today])
    const a = activityOf(await readActivity(KEY))
    assert.ok(a.items.some((x) => x.kind === 'scheduled_call' && x.client_key === 'meganfern'))
    await assert.rejects(scheduleCall({ family: KEY, client_key: 'kelliemarsh', date: today, priority: 'normal', details: '' }), /client_key/)
    await assert.rejects(scheduleCall({ family: KEY, client_key: 'meganfern', date: '2020-01-01', priority: 'normal', details: '' }), /date/)
    // the form asks for what the door checks before it can be reviewed
    assert.deepEqual(callMissing({ client_key: 'meganfern', date: today }, today), [])
    assert.deepEqual(callMissing({ client_key: '', date: '2020-01-01' }, today), ['an associated client', 'a date from today on'])
    assert.deepEqual(callMissing({ client_key: 'meganfern', date: '2026-02-31' }, today), ['a date'])
  })

  it('an incident filed from the panel is tied to the family member and shows in Activity though its words never name them', async () => {
    S.packOpen = false
    const ts = '2026-09-25T14:00:00.000Z'
    // the report as Clients' own door files it, and another client's report of the same second
    S.incidents.push({ id: 'I3', client_name: 'Megan Fern', incident_category: 'Fall', incident_date: '2026-09-25',
      summary_of_incident: 'Slipped on the porch step', your_name: 'Boss', timestamp: ts })
    S.incidents.push({ id: 'I4', client_name: 'Evan Fern', incident_category: 'Fall', incident_date: '2026-09-25',
      summary_of_incident: 'Tripped in the hall', your_name: 'Boss', timestamp: ts })
    const before = activityOf(await readActivity(KEY)).items.map((x) => x.id)
    assert.ok(!before.includes('inc_I3'), 'a report that does not name them is not theirs until it is tied')
    const row = { key: KEY, name: 'Jeana Fern' }
    assert.equal(await tieFiled(row, 'meganfern', ts), true)
    assert.equal(await tieFiled(row, 'meganfern', ts), true, 'a second tie of the same report is taken')
    const ties = (S.tabs.family_notes?.grid ?? []).filter((l) => l.includes('incident'))
    assert.equal(ties.length, 1, 'one tie per report')
    const after = activityOf(await readActivity(KEY)).items
    assert.ok(after.some((x) => x.id === 'inc_I3' && x.kind === 'incident' && x.client_key === 'meganfern'), 'the tied report is listed')
    assert.ok(!after.some((x) => x.id === 'inc_I4'), 'another client\'s report of the same second is not')
    assert.equal(notesOf(await readNotes(KEY)).notes.length, 0, 'a tie is no admin note')
    await assert.rejects(tieIncident(KEY, 'kelliemarsh', ts), /client_key/)
    await assert.rejects(tieIncident(KEY, 'meganfern', 'last week'), /incident_ts/)
  })
})

/* ---------- a released viewer ---------- */

describe('a released viewer', () => {
  const STAFF = { id: 'u-sam', email: 'sam@example.org', role: 'staff', display_name: 'Sam Staff' }
  const EVAN = { id: 'u-evan', email: 'evan@example.org', role: 'client', display_name: 'Evan Fern' }

  it('a STAFF account the app is released to reads every section by its door — the master\'s own answers — and is told it sees everything', async () => {
    const master = {
      roster: rosterOf(door('familyProfileRoster', {}).data), overview: overviewOf(door('familyProfileOverview', { family: KEY }).data),
      docs: documentsOf(door('familyProfileDocuments', { family: KEY }).data), notes: notesOf(door('familyProfileNotes', { family: KEY }).data),
    }
    SESSION = STAFF
    released(scopeOf('all'))
    const r = rosterOf(await readRoster())
    assert.deepEqual(r.view, { kind: 'all', notes: true })
    assert.deepEqual(r.families, master.roster.families)
    assert.deepEqual(overviewOf(await readOverview(KEY)), master.overview)
    assert.deepEqual(documentsOf(await readDocuments(KEY)), master.docs)
    assert.deepEqual(notesOf(await readNotes(KEY)), master.notes)
    assert.ok(activityOf(await readActivity(KEY)).items.some((x) => x.kind === 'sms'), 'the texts too')
    await assert.rejects(addNote(KEY, 'Not mine to file'), /unknown action/i, 'a write stays the master\'s')
    assert.equal(S.tabs.family_notes, undefined, 'nothing was filed')
  })

  it('a client reads only the family of their own record, drawn from it alone, never from the relay\'s uncut pack; the admin notes are not theirs', async () => {
    SESSION = EVAN
    S.index = 'open'
    // a client-role session never asks the relay's index: its door opens to no client
    useAuthStore.setState({ user: { id: EVAN.id, name: EVAN.display_name, email: EVAN.email, role: 'client' } } as never)
    released(scopeOf('client', ['evanfern']))
    const r = rosterOf(await readRoster())
    assert.deepEqual(r.view, { kind: 'client', notes: false })
    assert.deepEqual(r.families.map((f) => [f.key, f.relationship, f.clients]), [[KEY, 'Mother', 1]])
    const o = overviewOf(await readOverview(KEY))
    assert.deepEqual(o.clients.map((c) => c.client_key), ['evanfern'])
    assert.deepEqual(documentsOf(await readDocuments(KEY)).docs, [], 'Megan\'s papers and plan are not Evan\'s')
    const a = activityOf(await readActivity(KEY))
    assert.ok(a.items.every((x) => ['isp', 'calendar', 'incident'].includes(x.kind)), a.items.map((x) => x.kind).join())
    const said = JSON.stringify([o, a])
    assert.ok(!/Megan|NW4045|stranger|Sunday/.test(said), 'nothing of another client, and no text')
    assert.deepEqual(packAsks(), [], 'the relay is never asked')
    await assert.rejects(readNotes(KEY), (err: Error) => readRefusal(err.message, false) === NOT_OPEN)
    await assert.rejects(readOverview('fam_ritalong'), /unknown action/i, 'another client\'s family is not on file for them')
    await assert.rejects(readDocFile(KEY, 'ispdoc000001'), /names no such document/, 'Megan\'s plan never opens for Evan')
    await assert.rejects(addNote(KEY, 'x'), /unknown action/i)
  })

  it('the admin notes are their own tab, drawn only where the server opens them; no Actions or composer but the master\'s', () => {
    const o = overviewOf(door('familyProfileOverview', { family: KEY }).data)
    const row = rosterOf(door('familyProfileRoster', {}).data).families.find((f) => f.key === KEY) as RosterRow
    assert.ok(!draw(createElement(OverviewView, { row, overview: ready(o), onRetryOverview: noop })).includes('Admin notes'),
      'the Overview carries no admin notes card')
    assert.deepEqual(familyTabs(false).map((t) => t.id), ['overview', 'documents', 'activity'], 'no Notes tab where they are shut')
    assert.deepEqual(familyTabs(true).map((t) => t.id), ['overview', 'documents', 'activity', 'notes'])
    // App Control's control inside the app, the row the server asks (app/family.py NOTES_FEATURE)
    const notesRow = (APP_FEATURES['family-profiles'] ?? []).find((f) => f.id === 'family-profiles.notes')
    assert.ok(notesRow && notesRow.label === 'Notes' && notesRow.whenEmpty === 'Admin and above' && !notesRow.masterUntilReleased)
    const notes = (writes: boolean) => draw(createElement(NotesView, { row, notes: ready({ notes: [] }), writes, onRetry: noop }))
    const reader = notes(false)
    assert.ok(reader.includes('Admin notes') && reader.includes('No admin notes yet.') && !reader.includes('data-note-composer'),
      'an account the notes are open to reads them but files none without the edition')
    assert.ok(notes(true).includes('data-note-composer') && notes(true).includes('Save note'), 'the master files them')
    const bar = (writes: boolean) => draw(createElement(FamilyActions, { clients: o.clients, writes, onAsk: noop }))
    assert.ok(!bar(false).includes('data-actions=""') && bar(false).includes('data-share'), 'Share stays; Actions is the master\'s')
    assert.ok(bar(true).includes('data-actions=""'))
    assert.equal(readRefusal('Unknown action.', false), NOT_OPEN)
    assert.equal(readRefusal('Unknown action.'), NOT_PUBLISHED)
    assert.deepEqual(viewOf(undefined), { kind: 'master', notes: true }, 'an answer with no view is the master-only server\'s')
    assert.deepEqual(viewOf({ kind: 'guardian', notes: true }), { kind: 'guardian', notes: false }, 'a narrowed view never reads notes')
  })
})

/* ---------- the model ---------- */

describe('the model', () => {
  it('the address holds the family member, the section and the panel; an unknown panel is none', () => {
    assert.equal(familyQuery(KEY, 'activity', { kind: 'call' }), `?family=${KEY}&tab=activity&panel=call`)
    assert.equal(familyQuery(KEY, 'overview'), `?family=${KEY}`)
    for (const k of ['share', 'note', 'call', 'incident', 'edit'] as const) assert.deepEqual(panelOf(k), { kind: k })
    assert.equal(panelOf('modal'), null)
  })

  it('the edit panel: the member\'s fields, then each client\'s relationship and papers; a tie from elsewhere is read-only with its reason', () => {
    assert.equal(familyEditOf({ family: {} }), null)
    const e = familyEditOf({ edit: {
      raw: { name: 'Pat Foster', phone: '(330) 555-0171', email: '', address: '', rel_kay: 'Mom', papers_kay: 'Abc123', rel_old: 'Mom', papers_old: '' },
      locked: { rel_old: { why: 'The archive names this tie.' }, papers_old: { why: 'The archive names this tie.' } },
      ties: [{ client_key: 'kay', name: 'Kay Test', status: 'active', why: '' }, { client_key: 'old', name: 'Old Gone', status: 'inactive', why: 'The archive names this tie.' }],
      records: ['kay'], person_id: '', account: true,
    } })
    assert.ok(e && e.account && e.records.join() === 'kay')
    const fields = familyEditFields(e!)
    assert.deepEqual(fields.map((f) => f.key), ['name', 'phone', 'email', 'address', 'rel_kay', 'papers_kay', 'rel_old', 'papers_old'])
    assert.equal(fields.find((f) => f.key === 'rel_kay')?.raw, 'Mom')
    assert.equal(fields.find((f) => f.key === 'rel_old')?.lockedBy?.why, 'The archive names this tie.')
    assert.ok(!fields.some((f) => f.key === 'avatar'), 'no directory row, no photo')
    // Settings › My Work keeps the papers, the hints and a lock's words to the master; a locked field stays locked
    const bare = familyEditFields(e!, true)
    assert.deepEqual(bare.map((f) => f.key), ['name', 'phone', 'email', 'address', 'rel_kay', 'rel_old'])
    assert.deepEqual(bare.find((f) => f.key === 'rel_old')?.lockedBy, {})
    assert.ok(!bare.some((f) => f.hint), 'no hint')
  })

  it('an activity line links the family member and the client: by name where the body says it, else at its end', () => {
    const links = [{ name: 'Jeana Fern', href: '/f' }, { name: 'Megan Fern', href: '/c' }]
    assert.deepEqual(bodyParts('Jeana Fern called about Megan Fern', links),
      [{ text: 'Jeana Fern', href: '/f' }, { text: ' called about ' }, { text: 'Megan Fern', href: '/c' }])
    assert.deepEqual(bodyParts('Due Sep 30, 2026 · High priority', links),
      [{ text: 'Due Sep 30, 2026 · High priority' }, { text: ' · ' }, { text: 'Megan Fern', href: '/c' }])
    assert.deepEqual(bodyParts('', [links[0]]), [])
  })

  it('the relationship reads per client when there are several, and the incident form is Clients\' own roster row', () => {
    const clients = [{ client_key: 'a', name: 'Ann', relationship: 'Mom', house: '', house_label: '', avatar: '', status: 'active' as const },
      { client_key: 'b', name: 'Bo', relationship: 'Aunt', house: '', house_label: '', avatar: '', status: 'inactive' as const }]
    assert.equal(relationshipLine({ relationships: ['Mom', 'Aunt'] }, clients), 'Mom of Ann · Aunt of Bo')
    assert.equal(relationshipLine({ relationships: ['Mom'] }, clients.slice(0, 1)), 'Mom')
    assert.deepEqual(incidentClients(clients).map((c) => [c.client_key, c.name, c.status]), [['a', 'Ann', 'active'], ['b', 'Bo', 'inactive']])
  })
})

/* ---------- no modal anywhere ---------- */

describe('no modal anywhere', () => {
  const row: RosterRow = { key: KEY, name: 'Jeana Fern', relationship: 'Mom', phone: '(330) 555-0101', email: 'jeana.fern@example.org',
    clients: 2, status: 'active', avatar: '' }

  it('no browser dialog, no Dialog or Sheet, no modal or viewer of its own, no framed document, no Drive link', () => {
    for (const file of walk(FEATURE)) {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(/, file)
      assert.doesNotMatch(text, /import[^;]*\b\w*(Dialog|Sheet|Modal)\b[^;]*from/, file)
      assert.doesNotMatch(text, /from '[^']*(ui\/dialog|ui\/sheet)'/, file)
      assert.doesNotMatch(text, /components\/shared\/FileViewer|openFile\(|fixed inset-0|aria-modal|role="dialog"/, file)
      assert.doesNotMatch(text, /<iframe|createObjectURL/, `${file}: a document opens in the platform's viewer`)
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      assert.doesNotMatch(code, /drive\.google\.com|docs\.google\.com|webViewLink|target="_blank"/, file)
    }
    const openers = walk(FEATURE).filter((f) => readFileSync(resolve(ROOT, f), 'utf8').includes("from '@/lib/platformDoc'"))
    assert.deepEqual(openers.map((f) => f.slice(FEATURE.length + 1)), ['useFamilyRead.ts'])
  })

  it('every mode of the panel is the SidePanel aside — share, note, call, incident — the call and the incident for an associated client', async () => {
    S.packOpen = false
    // the overview held, as the page holds it before a panel opens
    const h = mountHook(() => useFamilyRead(readKey('familyProfileOverview', KEY), () => readOverview(KEY), overviewOf), {})
    await h.settle(() => h.current.status === 'ready')
    h.unmount()
    const share = sharePayloadFor(row, 'overview')
    for (const ask of [{ kind: 'share' }, { kind: 'note' }, { kind: 'call' }, { kind: 'incident' }] as FamilyAsk[]) {
      const html = draw(createElement(FamilyPanel, { ask, row, share, onClose: noop }))
      assert.match(html, /<aside aria-label="/, ask.kind)
      noModal(html, ask.kind)
    }
    assert.equal(draw(createElement(FamilyPanel, { ask: null, row, share, onClose: noop })), '')
    const shared = draw(createElement(FamilyPanel, { ask: { kind: 'share' }, row, share, onClose: noop }))
    assert.ok(shared.includes(`/app/family-profiles/profile?family=${KEY}`))
    assert.ok(!/Megan|Evan/.test(shared), 'nothing about a client rides a share')
    const note = draw(createElement(FamilyPanel, { ask: { kind: 'note' }, row, share, onClose: noop }))
    assert.ok(note.includes('Review draft') && note.includes('Notes on file'))
    const call = draw(createElement(FamilyPanel, { ask: { kind: 'call' }, row, share, onClose: noop }))
    for (const w of ['For', 'Associated client', 'Date', 'Priority', 'Normal', 'High', 'Urgent', 'Details', 'Review draft']) {
      assert.ok(call.includes(w), `call: ${w}`)
    }
    assert.ok(call.includes('value="evanfern"') && call.includes('value="meganfern"'), 'the call is for one of their clients')
    const incident = draw(createElement(FamilyPanel, { ask: { kind: 'incident' }, row, share, onClose: noop }))
    assert.ok(incident.includes('data-incident-form=""'), 'Clients\' own New incident form')
    assert.ok(incident.includes('data-incident-tie=""') && incident.includes('shows in Jeana Fern&#x27;s activity'),
      'the panel says the report is tied to the family member')
    assert.ok(incident.includes('data-family-incident="evanfern"') && incident.includes('value="Evan Fern"'),
      'the first associated client picked for it')
  })

  it('Actions is a menu in four groups — Families (New Family), Details (Edit details, Add document), Activity (Add note, Schedule call), Family contact actions (New incident) — and the switcher a listbox', () => {
    const clients = overviewOf(door('familyProfileOverview', { family: KEY }).data).clients
    const menu = draw(createElement(ActionsMenu, { clients, onPick: noop }))
    assert.match(menu, /role="menu"/)
    assert.deepEqual([...menu.matchAll(/data-group="([^"]+)"/g)].map((m) => m[1]), ['Families &amp; Guardians', 'Details', 'Activity', 'Family contact actions'])
    assert.deepEqual([...menu.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]), ['create', 'edit', 'doc', 'note', 'call', 'incident'])
    for (const w of ['New Family', 'Edit details', 'Add document', 'Add note', 'Schedule call', 'New incident']) assert.ok(menu.includes(w), w)
    const none = draw(createElement(ActionsMenu, { clients: [], onPick: noop }))
    assert.equal((none.match(/disabled=""/g) ?? []).length, 2, 'with no client, a call or an incident has nothing to be for')
    assert.deepEqual(actionGroups(null).flatMap((g) => g.items.filter((i) => i.why).map((i) => i.id)), ['call', 'incident'])
    const list = draw(createElement(SwitcherList, { families: [row, { ...row, key: 'fam_gracetimer', name: 'Grace Timer', status: 'inactive' }],
      current: KEY, query: '', onQuery: noop, why: [], showInactive: false, onInactive: noop, onPick: noop }))
    assert.match(list, /role="listbox"/)
    assert.ok(list.includes('Jeana Fern') && !list.includes('Grace Timer'), 'the inactive only when asked')
    assert.ok(list.includes('Mom · 2 clients'))
  })
})

/* ---------- what crossed the wire ---------- */

describe('what crossed the wire', () => {
  it('every call carries only the parameters its door declares', async () => {
    S.packOpen = false
    await Promise.all([readRoster(), readOverview(KEY), readDocuments(KEY), readActivity(KEY), readNotes(KEY)])
    await readDocFile(KEY, 'ispdoc000001')
    await addNote(KEY, 'One more')
    await scheduleCall({ family: KEY, client_key: 'meganfern', date: ohioToday(), priority: 'normal', details: '' })
    await tieIncident(KEY, 'meganfern', '2026-09-18T15:00:00Z')
    const saved = editAnswerOf(await saveFamily(KEY, [{ field: 'zzz', value: 'x', expected: '' }]))
    assert.deepEqual([saved.written, saved.refused.map((r) => r.field)], [[], ['zzz']])
    const calls = seen.filter((s) => s.kind === 'gas')
    assert.deepEqual([...new Set(calls.map((c) => c.name))].sort(), [...GS.FAM_ACTIONS].sort())
    const bad = calls.filter((c) => {
      const declared = Object.keys(GS.HUB_POLICY[c.name]?.params ?? {})
      return Object.keys(c.payload ?? {}).some((k) => !declared.includes(k))
    })
    assert.deepEqual(bad, [])
  })

  it('every read and the pack are never stamped for a receipt; the writes keep their exactly-once receipt', () => {
    const listed = RELAY_NO_RECEIPT()
    for (const name of [...GS.FAM_ACTIONS, 'familyPack']) {
      const lane = GS.HUB_POLICY[name]?.lane
      if (lane === 'write') assert.ok(!listed.has(name), `${name} keeps its receipt`)
      else assert.ok(listed.has(name), `${name} (${lane}) is in RELAY_NO_RECEIPT_ACTIONS`)
    }
    assert.deepEqual(['familyProfileNoteAdd', 'familyProfileCallSchedule', 'familyProfileIncidentTie'].map((a) => GS.HUB_POLICY[a].lane),
      ['write', 'write', 'write'])
  })
})
