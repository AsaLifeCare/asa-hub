/**
 * LOCATIONS · the contract between the page and its doors. Every call the page makes is caught at `fetch` and
 * handed to Apps Script's own Locations.gs, run here on in-memory stores; the answer comes back as JSON and is read
 * by the page's own readers. A name, a parameter or a field that one side renames breaks here, not on the screen.
 *
 * Only the stores are stood in for (the registry, the clients, the calendar, the punches, the estate tabs, the
 * drive). The helpers Locations.gs leans on are lifted whole out of their own .gs files.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import type { HouseClient, HousePolicy } from '@/pages/features/houses/houseModel'
import { blobOf, docShapeOf } from '@/pages/features/myprofile/certDocFile'
import { openPlatformDoc } from '@/lib/platformDoc'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import {
  LOCATION_EDITIONS, NOT_MEASURED, clientKeyOf, consumptionLine, documentRows, documentsOf, filterIncidents, incidentChoices,
  incidentClock, incidentDay, incidentsOf, istCellFor, notesOf, overviewOf, repairStreet, repairsOf, shownRepairs,
  slicePolicies, staffOf, suppliesOf, supplyDraft, type SupplyValues,
} from '@/pages/features/locations/locationModel'
import {
  addAsset, addClients, addNote, addSupplyEntry, editAsset, editIncident, editNote, editRepair, editSupplyEntry,
  fileIncident, fileIstPaper,
  fileRepair, forgetLocationReads, linkDoc, locationWrote, readDocFile, readDocuments, readIncidents, readKey,
  readLocationScope, readNotes, readOverview, readRepairs, readStaff, readSupplies, removeDoc, removeStaff, saveHouse,
  setNoteState, uploadDoc, useLocationRead, writeQueued,
} from '@/pages/features/locations/useLocation'
import { serverSteps } from '@/pages/features/locations/locationApply'
import { forgetDocs } from '@/pages/features/locations/locationReads'
import { mountHook } from './react-host'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const HOUSE = 'NW4045'
const NOW = '2026-09-28T15:00:00Z'
const PDF = [0x25, 0x50, 0x44, 0x46]
const PNG = [0x89, 0x50, 0x4e, 0x47]
const PDF_B64 = Buffer.from(PDF).toString('base64')

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
  ['Clients.gs', 'clientNameKey_'], ['Main.gs', 'hubAddrKey_'], ['CommBroadcast.gs', 'commBroadcastDay_'],
  ['Hotline.gs', 'HOTLINE_MANAGER_CURRENT_DAYS'], ['Hotline.gs', 'hotlineRowDay_'], ['Hotline.gs', 'hotlineManagersByHouse_'],
  ['IST.gs', 'istPairKey_'], ['HubCore.gs', 'hubCellSafe_'], ['Talent.gs', 'str_'],
  ['ComplianceDocs.gs', 'CERT_DOC_TYPES'], ['ComplianceDocs.gs', 'CERT_DOC_TYPE_WORDS'],
  ['ComplianceDocs.gs', 'complianceDocsTypeOk_'], ['ComplianceDocs.gs', 'complianceDocsTypeByName_'],
  ['ComplianceDocs.gs', 'complianceDocsTypeLoose_'], ['ComplianceDocs.gs', 'complianceDocsSameType_'],
  ['ComplianceDocs.gs', 'complianceDocsFileType_'], ['ComplianceDocs.gs', 'complianceDocsShownType_'],
  ['Estate.gs', 'ESTATE_FILE_COLUMNS'], ['Estate.gs', 'estateRowNum_'], ['Estate.gs', 'estateCell_'],
  ['Estate.gs', 'estateReadRow_'], ['RecordEdit.gs', 'HUB_EDIT_MAX_CHANGES'], ['RecordEdit.gs', 'hubEditText_'],
  ['RecordEdit.gs', 'hubEditChanges_'],
  ['RecordEdit.gs', 'hubEditWitness_'], ['RecordEdit.gs', 'hubEditShort_'], ['RecordEdit.gs', 'hubEditLog_'],
]

/* ---------- the stores ---------- */

type Row = Record<string, unknown>
type DriveFile = { name: string; mime: string; bytes: number[] }
type Folder = { id: string; name: string; folders: Folder[]; files: string[] }
type Grid = unknown[][]

const POLICY_TITLES = ['Company Policies', 'Medical Policies and Procedures', 'Med Del Cat 1', 'Med Del Cat 2',
  'Med Del Cat 3 Part 1', 'Med Del Cat 3 Part 2', 'Bill of Rights - ER', 'MUI Handbook']
const policyId = (i: number) => `policy000000${i}`
const policyUrl = (i: number) => `https://drive.google.com/file/d/${policyId(i)}/view`

/** The houses slice's own list: the same Common Data rows the door reads. */
const SLICE_POLICIES: HousePolicy[] = POLICY_TITLES.map((title, i) => ({ title, url: policyUrl(i), audience: 'all' }))
const SLICE_CLIENTS: HouseClient[] = [{ name: 'Kenny Marsh', client_id: 'C1', client_key: 'kenny_marsh' }, { name: 'Lia Gomez', client_id: 'C2' }]

function freshStores() {
  const files: Record<string, DriveFile> = {
    istpaper0001: { name: 'IST Noah Kenny.pdf', mime: 'application/pdf', bytes: PDF },
    ispdoc000001: { name: 'Kenny Marsh ISP 2026', mime: 'application/vnd.google-apps.document', bytes: [] },
    guide0000001: { name: 'Arlington Guidebook', mime: 'application/vnd.google-apps.document', bytes: [] },
    plan00000001: { name: 'Floor plan.png', mime: 'image/png', bytes: PNG },
    other0000001: { name: 'Briar Guidebook', mime: 'application/pdf', bytes: PDF },
  }
  POLICY_TITLES.forEach((title, i) => { files[policyId(i)] = { name: `${title}.pdf`, mime: 'application/pdf', bytes: PDF } })
  return {
    homes: [
      ['abbreviation', 'home_name', 'address', 'region', 'telephone', 'manager_name', 'manager_phone', 'calendar_link', 'thumbnail_url'],
      ['NW4045', 'CAN - NW - NW4045', '908 Arlington Ave NW, Canton, OH 44708', 'Canton', '3305550100', 'Older Name', '', '', ''],
      ['BW1001', 'CAN - BW - BW1001', '12 Briar Way, Canton, OH 44708', 'Canton', '', '', '', '', ''],
    ] as Grid,
    policies: [['Title', 'Link'], ...POLICY_TITLES.map((t, i) => [t, policyUrl(i)])] as Grid | null,
    clients: [
      { client_key: 'kenny_marsh', name: 'Kenny Marsh', house: 'NW4045', home_address: '908 Arlington Ave NW, Canton, OH 44708',
        status: 'active', isp_year: '2026', medications: ['Secret pill'] },
      // no house code and no client_key: joined by the registry street, keyed by the folded name
      { name: 'Lia Gomez', house: '', home_address: '908 Arlington Ave NW, Canton, OH 44708', status: 'active' },
      { client_key: 'bo_briar', name: 'Bo Briar', house: 'BW1001', home_address: '12 Briar Way', status: 'active' },
    ] as Row[],
    calendar: [
      ['Location', 'Employee', 'Designation', 'Phone', 'Date'],
      ['CAN - NW - NW4045', 'Noah Reed', '', '', '01/06/2025'],
      ['CAN - NW - NW4045', 'Noah Reed', '**', '3305550111', '09/25/2026'],
      ['CAN - NW - NW4045', 'Ava Stone', '***', '', '09/20/2026'],
      ['CAN - NW - NW4045', 'OPEN', '', '', '09/21/2026'],
      ['CAN - BW - BW1001', 'Other Person', '', '', '09/20/2026'],
    ] as Grid,
    punches: [
      { employee: 'Noah Reed', house: 'NW4045', location_name: '908 Arlington Ave NW', date_iso: '2026-09-27',
        consumer_1: 'Client Secret', comments: 'private words' },
      { employee: 'Ava Stone', house: '', location_name: '908  Arlington Ave NW', date_iso: '2026-06-07' },
    ] as Row[],
    ist: [
      { id: 'IST1', staffName: 'Noah Reed', clientName: 'Kenny Marsh', house: 'NW4045', status: 'done', trainedAt: '2025-02-01',
        docUrl: 'https://drive.google.com/file/d/istpaper0001/view', docFileId: 'istpaper0001' },
      { id: 'IST2', staffName: 'Noah  Reed', clientName: 'Lia Gomez', house: 'NW4045', status: 'owed' },
      { id: 'IST3', staffName: 'Ava Stone', clientName: 'Lia Gomez', house: 'NW4045', status: 'done', trainedAt: '2026-06-10' },
      { id: 'IST4', staffName: 'Ava Stone', clientName: 'Kenny Marsh', house: 'BW1001', status: 'owed' },
    ] as Row[],
    estate: {
      workOrders: [
        { id: 'r2', timestamp: '2026-09-20T12:00:00.000Z', select_address_vehicle: '908 Arlington Ave NW', repair_type: 'Plumbing',
          urgency_level: '5', please_describe_the_issue: 'Leak under the sink', status: '', resolution_notes: '' },
        { id: 'r3', timestamp: '2026-09-10T12:00:00.000Z', select_address_vehicle: '908 Arlington (request maintenance)',
          repair_type: 'Door', urgency_level: '2', please_describe_the_issue: 'Hinge', status: 'Completed', resolution_notes: 'Fixed' },
        { id: 'r4', timestamp: '2026-09-11T12:00:00.000Z', select_address_vehicle: 'ALL', repair_type: 'Roof',
          please_describe_the_issue: 'Gutters', status: 'Cancelled' },
        { id: 'r5', timestamp: '2026-09-12T12:00:00.000Z', select_address_vehicle: 'ALL', repair_type: 'Paint',
          please_describe_the_issue: 'Hallway', status: 'In Progress' },
        { id: 'r6', timestamp: '2026-09-13T12:00:00.000Z', select_address_vehicle: '12 Briar Way', repair_type: 'Door',
          please_describe_the_issue: 'Another house', status: '' },
      ],
      uiIncidents: [
        { id: 'r2', timestamp: '2026-09-20T18:00:00.000Z', your_name: 'Ann Lee', client_name: 'Kenny Marsh',
          incident_category: 'Minor injury or illness (rash, bruise, small cut), Fall', incident_location: 'Client Home',
          incident_date: '2026-09-20T04:00:00.000Z', incident_time: '14:05', summary_of_incident: 'Slipped in the hall' },
        { id: 'r3', timestamp: '2026-09-24T18:00:00.000Z', your_name: 'Bo Diaz', client_name: 'lia  gomez',
          incident_category: 'Medication error', incident_location: 'Day program', incident_date: '2026-09-24T04:00:00.000Z',
          incident_time: '09:30' },
        { id: 'r4', timestamp: '2026-09-25T18:00:00.000Z', your_name: 'Cy', client_name: 'Bo Briar', incident_category: 'Fall',
          incident_date: '2026-09-25T04:00:00.000Z', incident_time: '10:00' },
      ],
      houseInventory: [
        { id: 'r2', item: 'Fridge', address: '908 Arlington Ave NW', cost_to_replace: '900', current_condition: 'Good',
          est_expiration_year: '2030', replacement_frequency: '10 years' },
        { id: 'r3', item: 'Couch', address: '12 Briar Way', cost_to_replace: '400', current_condition: 'Worn' },
      ],
    } as Record<string, Row[]>,
    isps: { 'Kenny Marsh': { id: 'ispdoc000001', name: 'Kenny Marsh ISP 2026', url: 'https://docs.google.com/document/d/ispdoc000001/edit' } } as
      Record<string, { id: string; name: string; url: string }>,
    room: {
      id: 'room', name: 'Houses', files: [], folders: [
        { id: 'f1', name: 'Canton', files: [], folders: [{ id: 'f2', name: 'NW4045 - Arlington', folders: [], files: ['guide0000001', 'plan00000001'] }] },
        { id: 'f3', name: 'BW1001 - Briar', folders: [], files: ['other0000001'] },
      ],
    } as Folder,
    files,
    tabs: {} as Record<string, ReturnType<typeof sheetOf>>,
    ledgerDeclared: true,
    // the platform config tab: Settings → Editions' one cell (Editions.gs), nothing set
    config: {} as Record<string, string>,
  }
}

let S = freshStores()

function sheetOf(grid: Grid) {
  return {
    grid,
    getLastColumn: () => (grid[0] ?? []).length,
    getDataRange: () => ({
      getValues: () => grid.map((r) => Array.from({ length: (grid[0] ?? []).length }, (_, i) => r[i] ?? '')),
    }),
    getRange: (r: number, c: number) => ({
      setValue: (v: unknown) => {
        while (grid.length < r) grid.push([])
        grid[r - 1][c - 1] = v
      },
    }),
    appendRow: (line: unknown[]) => { grid.push([...line]) },
  }
}

const iter = <T>(list: T[]) => {
  let i = 0
  return { hasNext: () => i < list.length, next: () => list[i++] }
}

let driveIds = 0

/** A file the drive holds, as DriveApp hands it: read, moved into a folder, copied into one. */
function fileOf(id: string) {
  const f = S.files[id]
  if (!f) throw new Error(`File not found: ${id}`)
  return {
    getId: () => id, getName: () => f.name, getMimeType: () => f.mime, isTrashed: () => false, getSize: () => f.bytes.length,
    getLastUpdated: () => new Date('2026-09-01T12:00:00Z'), getUrl: () => `https://drive.google.com/file/d/${id}/view`,
    getBlob: () => ({ getBytes: () => f.bytes }), getAs: () => ({ getBytes: () => PDF }),
    moveTo: (to: { _f: Folder }) => {
      const out = (x: Folder) => { x.files = x.files.filter((k) => k !== id); x.folders.forEach(out) }
      out(S.room)
      to._f.files.push(id)
    },
    makeCopy: (name: string, to: { _f: Folder }) => {
      const copy = `copy${String(++driveIds).padStart(8, '0')}`
      S.files[copy] = { ...f, name }
      to._f.files.push(copy)
      return fileOf(copy)
    },
  }
}

function folderById(id: string, f: Folder = S.room): Folder | null {
  if (f.id === id) return f
  for (const k of f.folders) {
    const hit = folderById(id, k)
    if (hit) return hit
  }
  return null
}

function folderOf(f: Folder): unknown {
  return {
    _f: f,
    getId: () => f.id,
    getName: () => f.name,
    getFolders: () => iter(f.folders.map(folderOf)),
    getFoldersByName: (name: string) => iter(f.folders.filter((k) => k.name === name).map(folderOf)),
    getFiles: () => iter(f.files.map(fileOf)),
    createFolder: (name: string) => {
      const made: Folder = { id: `fold${++driveIds}`, name, folders: [], files: [] }
      f.folders.push(made)
      return folderOf(made)
    },
    createFile: (blob: { bytes: number[]; mime: string; name: string }) => {
      const id = `upload${String(++driveIds).padStart(8, '0')}`
      S.files[id] = { name: blob.name, mime: blob.mime, bytes: blob.bytes }
      f.files.push(id)
      return fileOf(id)
    },
  }
}

/** The estate tab a resource's rows stand for, as estateSheet_ hands it: row "rN" is sheet row N. */
function estateHandleOf(resource: string) {
  const rows = S.estate[resource] ?? []
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => k !== 'id'))]
  const at = (n: number) => rows.find((r) => r.id === `r${n}`)
  return {
    keys, tz: 'America/New_York',
    sheet: {
      getLastRow: () => Math.max(1, ...rows.map((r) => Number(String(r.id).slice(1)) || 0)),
      getRange: (r: number, c: number, _nr = 1, nc = 1) => ({
        getValues: () => [Array.from({ length: nc }, (_, i) => (at(r) ?? {})[keys[c - 1 + i]] ?? '')],
        setValue: (v: unknown) => { const row = at(r); if (row) row[keys[c - 1]] = v },
      }),
      appendRow: (line: unknown[]) => {
        const next = Math.max(1, ...rows.map((r) => Number(String(r.id).slice(1)) || 0)) + 1
        rows.push({ id: `r${next}`, ...Object.fromEntries(keys.map((k, i) => [k, line[i]])) })
      },
    },
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
  LOCATION_ACTIONS: string[]
}

function boot(): Gs {
  let uuid = 0
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {},
    Utilities: {
      formatDate, getUuid: () => `u${++uuid}`,
      base64Encode: (b: number[]) => Buffer.from(b).toString('base64'),
      base64Decode: (s: string) => [...Buffer.from(s, 'base64')],
      newBlob: (bytes: number[], mime: string, name: string) => ({ bytes, mime, name }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      getFileById: (id: string) => fileOf(id),
      getFolderById: (id: string) => {
        const f = folderById(id)
        if (!f) throw new Error(`Folder not found: ${id}`)
        return folderOf(f)
      },
    },
    // the platform config tab, read through its own reader (Editions.gs reads Settings → Editions from it)
    hiringAlerts_: () => S.config,
    // the estate's own create, answering the row it appended; and its tab as the edit doors read it
    estateRoute_: (resource: string, action: string, payload: Row) => {
      if (action !== 'create') return { status: 400, message: `st: ${action}` }
      const rows = (S.estate[resource] ??= [])
      const row = { id: `r${Math.max(1, ...rows.map((r) => Number(String(r.id).slice(1)) || 0)) + 1}`, ...payload }
      rows.push(row)
      return { status: 200, data: row }
    },
    estateSheet_: (resource: string) => estateHandleOf(resource),
    // Clients' own edit of a record's house: the client found, what the profile shows, and the write
    clientProfilesClient_: (key: string) => {
      const row = S.clients.find((c) => String(c.client_key || clientKeyOf({ name: String(c.name) })) === key)
      return row ? { key, name: String(row.name), row, archived: false } : { refused: { status: 404, message: `No client "${key}".` } }
    },
    cpEditLive_: (cctx: { row: Row }) => ({ house: String(cctx.row.house ?? '') }),
    cpProfileEdit_: (cctx: { row: Row }, payload: { changes: { field: string; value: string; expected: string }[] }) => {
      const [c] = payload.changes
      if (String(cctx.row.house ?? '') !== c.expected) return { status: 409, data: { written: [], refused: [] } }
      cctx.row.house = c.value
      return { status: 200, data: { written: ['house'], refused: [] } }
    },
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'boss@example.org' && !u.visiting_member && !u.is_service,
    // ViewerScope.gs's gate, stood in for by the scope each test account is given
    hubProfileAppGate_: (app: string, u: Row | null) => {
      const scope = (kind: string, keys: string[] = [], codes: string[] = []) =>
        ({ kind, client_keys: keys, house_codes: codes, ssa_keys: [], family_keys: [], why: '' })
      if (app !== 'locations' || !u) return { open: false, scope: scope('none') }
      if (u.email === 'boss@example.org') return { open: true, scope: scope('master') }
      if (u.email === 'kay@example.org') return { open: true, scope: scope('client', ['kenny_marsh'], ['NW4045']) }
      if (u.email === 'sam@example.org') return { open: true, scope: scope('all') }
      return { open: false, scope: scope('none') }
    },
    hubStaffVisibleForHouses_: (codes: string[]) => ({ keys: codes.join() === 'NW4045' ? ['noahreed'] : [], why: '' }),
    hubQuietNow_: () => new Date(NOW),
    hubProp_: () => '',
    cacheRead_: (_scope: string, _name: string, fn: () => unknown) => fn(),
    cacheScopeSheet_: (id: string, tab: string) => `${id}:${tab}`,
    cacheScope_: (t: string) => t,
    cacheVersion_: () => 1,
    cacheBump_: () => {},
    ssOpen_: () => ({
      getSheetByName: (tab: string) => (tab === 'entity_homes' ? sheetOf(S.homes)
        : tab === 'Company Policies' && S.policies ? sheetOf(S.policies) : null),
    }),
    clientsDerived_: () => S.clients,
    estateSource_: (r: string) => ({ id: 'estate', tab: r }),
    estateRows_: (r: string) => S.estate[r] ?? [],
    listRows_: (r: string) => (r === 'istRecords' ? S.ist : []),
    commBroadcastCalendarRows_: () => ({ values: S.calendar, tz: 'America/New_York' }),
    psiPunchesFullSheet_: () => ({}),
    psiPunchesRows_: () => ({ rows: S.punches }),
    docRoomFolder_: () => ({ folder: folderOf(S.room) }),
    ispDocFor_: (name: string) => S.isps[name] ?? { id: '', name: '', url: '' },
    houseMoved_: () => S.ledgerDeclared,
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
    complianceDocsFolder_: () => ({
      createFile: (blob: { bytes: number[]; mime: string; name: string }) => {
        const id = `paper${String(++uuid).padStart(7, '0')}`
        S.files[id] = { name: blob.name, mime: blob.mime, bytes: blob.bytes }
        return { getId: () => id }
      },
    }),
    updateRowById_: (_resource: string, patch: Row) => {
      const row = S.ist.find((r) => r.id === patch.id)
      if (!row) return null
      Object.assign(row, patch)
      return { ...row }
    },
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('Locations.gs'), ctx)
  vm.runInContext(gsText('Editions.gs'), ctx)
  return ctx as unknown as Gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin', display_name: 'Boss' }
const KAY = { email: 'kay@example.org', role: 'client', display_name: 'Kenny Marsh' }
const SAM = { id: 'u-sam', email: 'sam@example.org', role: 'staff', display_name: 'Sam Staff' }

/* ---------- the page's calls, answered by the doors ---------- */

const calls: { action: string; payload: Row }[] = []
const realFetch = globalThis.fetch
// the session every door is asked as
let AS: Row = MASTER

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Row }
    calls.push({ action: env.action, payload: env.payload ?? {} })
    const door = GS.HUB_ACTIONS[env.action]
    let out: unknown
    // a door that throws answers as the dispatcher would, with its words, so a test says what broke
    try { out = door ? door(JSON.parse(JSON.stringify(env.payload ?? {})), AS) : { status: 404, message: 'Unknown action.' } }
    catch (e) { out = { status: 500, message: `threw: ${e instanceof Error ? e.message : String(e)}` } }
    return new Response(JSON.stringify(out))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  S = freshStores()
  AS = MASTER
  forgetLocationReads()
})

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

describe('the names', () => {
  it('every door the page names is a Locations.gs action or a Python door, and every Locations.gs action has a caller', () => {
    const named = new Set<string>()
    for (const f of walk('src/pages/features/locations')) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    // the doors only Python answers (app/doors.json): a module that answers them, on the read or the write lane
    const python = JSON.parse(readFileSync(resolve(ROOT, 'app/doors.json'), 'utf8')) as Record<string, { file: string; lane: string }>
    for (const name of named) {
      if (python[name]) {
        assert.ok(/^app\/[a-z_]+\.py$/.test(python[name].file) && ['read', 'write'].includes(python[name].lane),
          `${name} is a Python door`)
        continue
      }
      assert.equal(GS.HUB_POLICY[name]?.file, 'Locations.gs', `${name} is declared in Locations.gs`)
      assert.equal(typeof GS.HUB_ACTIONS[name], 'function', `${name} has a handler`)
    }
    assert.deepEqual([...named].filter((n) => !python[n]).sort(), [...GS.LOCATION_ACTIONS].sort())
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of named) assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
  })
})

describe('the reads, as the page reads them', () => {
  it('overview: the ** house manager with the calendar\'s phone, the house phone, and the clients a note may name', async () => {
    const o = overviewOf(await readOverview(HOUSE))
    assert.deepEqual(o.managers[0], { name: 'Noah Reed', phone: '3305550111' })
    assert.equal(o.housePhone, '3305550100')
    assert.equal(o.address, '908 Arlington Ave NW, Canton, OH 44708')
    assert.equal(o.type, null)
    assert.deepEqual(o.registryManager, { name: 'Older Name', phone: '' })
    assert.deepEqual(o.clients, [{ client_key: 'kenny_marsh', name: 'Kenny Marsh' }, { client_key: 'liagomez', name: 'Lia Gomez' }])
    // the slice's fallback key is the same key the door checks a note against
    assert.deepEqual(SLICE_CLIENTS.map(clientKeyOf), o.clients.map((c) => c.client_key))
  })

  it('staff: first and latest shift with their sources, the roles, one IST column per current client', async () => {
    const raw = await readStaff(HOUSE)
    assert.ok(!/consumer|Client Secret|private words|Secret pill/.test(JSON.stringify(raw)))
    const s = staffOf(raw)
    assert.deepEqual(s.clients.map((c) => c.name), ['Kenny Marsh', 'Lia Gomez'])
    assert.deepEqual(s.rows.map((r) => r.name), ['Noah Reed', 'Ava Stone'])
    const [noah, ava] = s.rows
    assert.deepEqual([noah.first, noah.last, noah.shifts, noah.hm], [
      { day: '2025-01-06', source: 'archive' }, { day: '2026-09-27', source: 'punches' }, 3, true])
    assert.deepEqual([ava.first, ava.last, ava.lead], [
      { day: '2026-06-07', source: 'punches' }, { day: '2026-09-20', source: 'archive' }, true])
    assert.deepEqual(istCellFor(noah, 'Kenny Marsh'), { kind: 'paper', fileId: 'istpaper0001', at: '2025-02-01' })
    assert.deepEqual(istCellFor(noah, 'Lia Gomez'), { kind: 'upload' })
    assert.deepEqual(istCellFor(ava, 'Lia Gomez'), { kind: 'trained', at: '2026-06-10' })
    assert.deepEqual(istCellFor(ava, 'Kenny Marsh'), { kind: 'none' }, 'the only pair is at another house')
  })

  it('repairs: the page\'s open split is the door\'s; ALL is the whole estate; the street is spelled as the tab spells it', async () => {
    const rawOpen = await readRepairs(HOUSE, false)
    const open = repairsOf(rawOpen)
    assert.deepEqual(open.map((r) => r.id), ['r2', 'r5'])
    assert.deepEqual(shownRepairs(open, false).map((r) => r.id), ['r2', 'r5'])
    const all = repairsOf(await readRepairs(HOUSE, true))
    assert.deepEqual(all.map((r) => r.id).sort(), ['r2', 'r3', 'r4', 'r5'])
    assert.deepEqual(shownRepairs(all, false).map((r) => r.id), open.map((r) => r.id), 'Show resolved off hides what the door calls resolved')
    assert.deepEqual(all.filter((r) => r.wholeEstate).map((r) => r.id).sort(), ['r4', 'r5'])
    assert.equal(all.find((r) => r.id === 'r3')?.match, 'street_number')
    assert.equal(repairStreet(rawOpen, open, 'fallback'), '908 Arlington Ave NW')
  })

  it('incidents: the six columns, the door\'s own category split, both filters, Ohio\'s day and the typed time', async () => {
    const rows = incidentsOf(await readIncidents(HOUSE))
    assert.deepEqual(rows.map((r) => r.id), ['r3', 'r2'], 'newest first, another house left out')
    const r2 = rows[1]
    assert.deepEqual([r2.yourName, r2.client, r2.location, incidentDay(r2.date), incidentClock(r2.time)],
      ['Ann Lee', 'Kenny Marsh', 'Client Home', 'Sep 20, 2026', '14:05'])
    assert.deepEqual(r2.categories, ['Minor injury or illness (rash, bruise, small cut)', 'Fall'])
    assert.equal(r2.row.summary_of_incident, 'Slipped in the hall')
    assert.deepEqual(incidentChoices(rows).clients.length, 2)
    assert.deepEqual(filterIncidents(rows, 'Lia Gomez', '').map((r) => r.id), ['r3'], 'a client folds as the door folds')
    assert.deepEqual(filterIncidents(rows, '', 'Fall').map((r) => r.id), ['r2'])
  })

  it('incidents: a filing that names any client the overview offers comes back on the house\'s list', async () => {
    const o = overviewOf(await readOverview(HOUSE))
    S.estate.uiIncidents = o.clients.map((c, i) => ({ id: `n${i}`, client_name: c.name, incident_category: 'Fall',
      incident_date: '2026-09-27T04:00:00.000Z' }))
    const back = incidentsOf(await readIncidents(HOUSE))
    assert.deepEqual(back.map((r) => r.client).sort(), o.clients.map((c) => c.name).sort())
  })

  it('documents: every file the page offers, the door serves as bytes that open centred in the platform\'s viewer', async () => {
    const docs = documentsOf(await readDocuments(HOUSE))
    const rows = documentRows(slicePolicies(SLICE_POLICIES), docs, 'Arlington', SLICE_CLIENTS)
    const offered = rows.filter((d) => d.fileId)
    assert.deepEqual(offered.map((d) => d.type), [...POLICY_TITLES.map((t) => (/Med Del/.test(t) ? 'Medication Delivery' : 'Policy')),
      'ISP', 'Guidebook', 'House document'])
    assert.deepEqual(rows.filter((d) => d.type === 'ISP').map((d) => [d.applies, d.fileId]), [['Kenny Marsh', 'ispdoc000001'], ['Lia Gomez', '']])
    for (const d of offered) {
      const got = await readDocFile(HOUSE, d.fileId)
      assert.ok(docShapeOf(got.mime) && blobOf(got), `${d.title} is a type the platform draws (${got.mime})`)
      assert.equal(await openPlatformDoc(got, { title: d.title }), true, d.title)
      const file = useFileViewerStore.getState().file
      assert.equal(file?.title, d.title)
      assert.match(file?.url ?? '', /^blob:/, `${d.title} opens from its bytes, never a link`)
    }
    useFileViewerStore.getState().closeFile()
    const isp = await readDocFile(HOUSE, 'ispdoc000001')
    assert.deepEqual([isp.mime, isp.exported], ['application/pdf', true], 'a Google document arrives as its PDF')
    await assert.rejects(readDocFile(HOUSE, 'other0000001'), /names no such document/, 'another house\'s file is refused')
  })

  it('documents: a company list the door could not read is listed without a file, never offered for a refusal', async () => {
    S.policies = null
    const docs = documentsOf(await readDocuments(HOUSE))
    assert.match(docs.why, /company policies could not be read/)
    const rows = documentRows(slicePolicies(SLICE_POLICIES), docs, 'Arlington', SLICE_CLIENTS)
    assert.deepEqual(rows.filter((d) => d.appliesTo === 'all').map((d) => [d.title, d.fileId]), POLICY_TITLES.map((t) => [t, '']))
    await assert.rejects(readDocFile(HOUSE, policyId(0)), /names no such document/)
  })

  it('documents: no guidebook folder says why', async () => {
    S.room = { id: 'room', name: 'Houses', files: [], folders: [] }
    const docs = documentsOf(await readDocuments(HOUSE))
    assert.equal(docs.guidebook, null)
    assert.equal(docs.guidebookWhy, 'no folder in the houses room names NW4045')
  })
})

describe('the writes, as the page files them', () => {
  it('house notes: a client picked from the overview (one with no client_key on file too), then resolved', async () => {
    const o = overviewOf(await readOverview(HOUSE))
    const lia = o.clients.find((c) => c.name === 'Lia Gomez')?.client_key ?? ''
    assert.equal(lia, 'liagomez')
    const got = await addNote({ house: HOUSE, client_key: lia, priority: 'urgent', details: 'Back door sticks' })
    assert.equal(writeQueued(got), false, 'the door\'s own answer is the note, not a ledger receipt')
    const [note] = notesOf(await readNotes(HOUSE))
    assert.deepEqual([note.clientName, note.priority, note.details, note.state, note.by],
      ['Lia Gomez', 'urgent', 'Back door sticks', 'open', 'Boss'])
    await setNoteState(note.id, 'resolved', HOUSE)
    assert.equal(notesOf(await readNotes(HOUSE))[0].state, 'resolved')
    await assert.rejects(setNoteState(note.id, 'open', 'BW1001'), /moved since it was opened/, 'the house rides as the witness')
    await assert.rejects(addNote({ house: HOUSE, client_key: 'bo_briar', priority: 'low', details: 'x' }), /not a current client/)
  })

  it('IST papers: Upload is offered exactly where the door has a record to file against; the paper then opens', async () => {
    const s = staffOf(await readStaff(HOUSE))
    for (const m of s.rows) {
      for (const c of s.clients) {
        const cell = istCellFor(m, c.name)
        const send = fileIstPaper({ house: HOUSE, staff: m.name, client: c.name, file: { name: 'ist.pdf', mime: 'application/pdf', b64: PDF_B64 } })
        if (cell.kind === 'none') await assert.rejects(send, /No IST record pairs/, `${m.name} × ${c.name}`)
        else assert.equal(writeQueued(await send), false, `${m.name} × ${c.name} is filed`)
      }
    }
    const filed = staffOf(await readStaff(HOUSE))
    const cell = istCellFor(filed.rows.find((r) => r.name === 'Noah Reed')!, 'Lia Gomez')
    assert.equal(cell.kind, 'paper')
    const paper = await readDocFile(HOUSE, cell.kind === 'paper' ? cell.fileId : '')
    assert.equal(docShapeOf(paper.mime), 'pdf')
    assert.equal(await openPlatformDoc(paper, { title: 'IST' }), true)
    assert.match(useFileViewerStore.getState().file?.url ?? '', /^blob:/, 'the filed paper opens centred from its bytes')
    useFileViewerStore.getState().closeFile()
  })

  it('supplies: counts and deliveries through the door; consumption, status and "Not measured yet" read back', async () => {
    const entry = (v: Partial<SupplyValues>) => {
      const d = supplyDraft(HOUSE, { kind: 'count', item: '', category: '', qty: '', onHandAfter: '', note: '', ...v })
      assert.equal(typeof d, 'object', String(d))
      return addSupplyEntry(d as Exclude<typeof d, string>)
    }
    await entry({ kind: 'par', item: 'Gloves', category: 'Care', qty: '24' })
    await entry({ kind: 'count', item: 'Gloves', qty: '10' })
    await entry({ kind: 'delivery', item: 'Gloves', qty: '30' })
    await entry({ kind: 'count', item: 'Gloves', qty: '16' })
    await entry({ kind: 'delivery', item: 'Towels', qty: '12', onHandAfter: '20' })
    await entry({ kind: 'count', item: 'Towels', qty: '18' })
    await entry({ kind: 'par', item: 'Soap', qty: '6' })
    await entry({ kind: 'count', item: 'Soap', qty: '4' })
    // the ledger rows the door appended, dated days apart
    const grid = S.tabs.houseSupplies.grid
    const at = (grid[0] as string[]).indexOf('at')
    const days = ['2026-09-01', '2026-09-01', '2026-09-02', '2026-09-08', '2026-09-02', '2026-09-08', '2026-09-01', '2026-09-03']
    days.forEach((d, i) => { grid[i + 1][at] = `${d}T12:00:00.000Z` })
    const s = suppliesOf(await readSupplies(HOUSE))
    assert.equal(s.ledgerReady, true)
    const by = Object.fromEntries(s.consumables.map((c) => [c.item, c]))
    assert.deepEqual([by.Gloves.category, by.Gloves.onHand, by.Gloves.par, by.Gloves.consumption, by.Gloves.status],
      ['Care', 16, 24, 24, 'Order now'])
    assert.equal(consumptionLine(by.Gloves), '24 used since Sep 02, 2026')
    assert.deepEqual([by.Towels.consumption, by.Towels.status], [2, 'In stock'])
    assert.deepEqual([by.Soap.consumption, by.Soap.status, consumptionLine(by.Soap)], [null, 'Low', NOT_MEASURED])
    assert.deepEqual(s.assets.map((a) => a.item), ['Fridge'])
  })

  it('supplies: an undeclared ledger reads "not set up", and a count is refused rather than lost', async () => {
    S.ledgerDeclared = false
    const s = suppliesOf(await readSupplies(HOUSE))
    assert.deepEqual([s.ledgerReady, /not declared/.test(s.ledgerWhy)], [false, true])
    await assert.rejects(addSupplyEntry({ house: HOUSE, item: 'Gloves', category: '', kind: 'count', qty: 3 }), /not set up/)
  })
})

describe('the editions, as the page applies them', () => {
  const steps = (answer: unknown) => {
    const s = serverSteps(answer)
    return [s.steps.map((x) => `${x.id}:${x.landed}`).join(','), s.slices.join(','), s.mirror.join(','), s.app]
  }

  it('Staff: a person taken off the list, then put back — the steps said, the record untouched', async () => {
    const before = staffOf(await readStaff(HOUSE)).rows.map((r) => r.name)
    assert.ok(before.includes('Ava Stone'))
    const off = await removeStaff(HOUSE, 'Ava Stone')
    assert.deepEqual(steps(off), ['sheet:true,cache:true', '', '', 'locations'])
    const after = staffOf(await readStaff(HOUSE))
    assert.ok(!after.rows.some((r) => r.name === 'Ava Stone'))
    assert.deepEqual(after.removed.map((r) => [r.name, r.by]), [['Ava Stone', 'Boss']])
    assert.ok(S.ist.some((r) => r.staffName === 'Ava Stone'), 'her IST records stay')
    await assert.rejects(removeStaff(HOUSE, 'Nobody Here'), /not on NW4045's Staff list/)
    await removeStaff(HOUSE, 'Ava Stone', true)
    assert.ok(staffOf(await readStaff(HOUSE)).rows.some((r) => r.name === 'Ava Stone'), 'put back, she is listed again')
  })

  it('Incidents: one opened for a client of the house and one edited, through the estate\'s own sheet', async () => {
    const filed = await fileIncident(HOUSE, { client_name: 'kenny  marsh', incident_category: 'Fall', incident_location: 'Yard',
      incident_date: '2026-09-27', incident_time: '11:15', summary_of_incident: 'Tripped on the step' })
    assert.deepEqual(steps(filed), ['sheet:true,cache:true', 'uiIncidents', '', 'locations'])
    const rows = incidentsOf(await readIncidents(HOUSE))
    assert.ok(rows.some((r) => r.client === 'Kenny Marsh' && r.location === 'Yard'), 'the house lists it')
    await assert.rejects(fileIncident(HOUSE, { client_name: 'Bo Briar', incident_category: 'Fall' }), /current clients/)
    const edited = await editIncident(HOUSE, 'r2', [{ field: 'incident_location', value: 'Kitchen', expected: 'Client Home' }])
    assert.deepEqual((edited as { written?: string[] }).written, ['incident_location'])
    assert.equal(incidentsOf(await readIncidents(HOUSE)).find((r) => r.id === 'r2')?.location, 'Kitchen')
    await assert.rejects(editIncident(HOUSE, 'r4', [{ field: 'incident_location', value: 'x', expected: '' }]), /moved since/,
      'another house\'s client\'s incident is not this house\'s')
  })

  it('Repairs: one filed for the house\'s own street and one edited', async () => {
    const filed = await fileRepair(HOUSE, { select_address_vehicle: '908 Arlington Ave NW', repair_type: 'Window',
      urgency_level: '3', please_describe_the_issue: 'Cracked pane' })
    assert.deepEqual(steps(filed), ['sheet:true,cache:true', 'workOrders', '', 'locations'])
    assert.ok(repairsOf(await readRepairs(HOUSE, false)).some((r) => r.repairType === 'Window'))
    await assert.rejects(fileRepair(HOUSE, { select_address_vehicle: '12 Briar Way', repair_type: 'Door' }), /not NW4045's/)
    const edited = await editRepair(HOUSE, 'r2', [{ field: 'status', value: 'In Progress', expected: '' }])
    assert.deepEqual((edited as { written?: string[] }).written, ['status'])
  })

  it('House assets: one of the house\'s edited and one added on House Supplies\' own inventory; another house\'s refused', async () => {
    const edited = await editAsset(HOUSE, 'r2', [{ field: 'current_condition', value: 'Fair', expected: 'Good' }])
    assert.deepEqual((edited as { written?: string[] }).written, ['current_condition'])
    assert.deepEqual(steps(edited), ['sheet:true,cache:true', '', '', 'locations'])
    await assert.rejects(editAsset(HOUSE, 'r3', [{ field: 'item', value: 'Sofa', expected: 'Couch' }]), /moved since/,
      'another house\'s asset is not this house\'s')
    const added = await addAsset(HOUSE, { item: 'Washer', current_condition: 'New' })
    assert.deepEqual(steps(added), ['sheet:true,cache:true', '', '', 'locations'])
    const assets = suppliesOf(await readSupplies(HOUSE)).assets
    assert.deepEqual(assets.map((a) => [a.item, a.current_condition]), [['Fridge', 'Fair'], ['Washer', 'New']])
    const inventory = S.estate.houseInventory
    assert.equal(inventory[inventory.length - 1].address, '908 Arlington Ave NW, Canton, OH 44708', 'at the registry\'s street')
    await assert.rejects(addAsset(HOUSE, { item: ' ' }), /item/)
  })

  it('House photo: the registry row names a picture the relay keeps for this house, and no other', async () => {
    const url = 'https://hub.example.org/erp-lanes/locations/image/NW4045/20261008T120000000Z.jpg'
    const saved = await saveHouse(HOUSE, 'CAN - NW - NW4045', [{ field: 'thumbnail_url', value: url, expected: '' }])
    assert.deepEqual((saved as { written?: string[] }).written, ['thumbnail_url'])
    assert.equal(overviewOf(await readOverview(HOUSE)).edit.thumbnail_url, url)
    for (const bad of ['https://hub.example.org/erp-lanes/locations/image/BW1001/20261008T120000000Z.jpg',
      'https://elsewhere.example.org/photo.jpg']) {
      const refused = await saveHouse(HOUSE, 'CAN - NW - NW4045', [{ field: 'thumbnail_url', value: bad, expected: url }])
      assert.deepEqual((refused as { written?: string[] }).written, [], bad)
    }
  })

  it('Documents: one added from a Drive link, one uploaded, one of the house\'s own removed — never a company document', async () => {
    const linked = await linkDoc(HOUSE, 'https://drive.google.com/file/d/other0000001/view')
    assert.deepEqual(steps(linked), ['sheet:true,cache:true', '', '', 'locations'])
    assert.equal((serverSteps(linked).steps[0]).label, 'Drive')
    await uploadDoc(HOUSE, { name: 'Fire plan.pdf', mime: 'application/pdf', b64: PDF_B64 })
    const docs = documentsOf(await readDocuments(HOUSE))
    assert.deepEqual(docs.guidebook?.files.map((f) => f.name).sort(), ['Arlington Guidebook', 'Briar Guidebook', 'Fire plan.pdf', 'Floor plan.png'])
    await removeDoc(HOUSE, 'plan00000001')
    const left = documentsOf(await readDocuments(HOUSE))
    assert.ok(!left.guidebook?.files.some((f) => f.id === 'plan00000001'))
    assert.ok(S.room.folders.some((f) => f.name === 'Removed from Locations' && f.files.includes('plan00000001')),
      'moved to the room\'s own folder, never the trash')
    await assert.rejects(removeDoc(HOUSE, policyId(0)), /applies to every location/)
    await assert.rejects(removeDoc(HOUSE, 'ispdoc000001'), /client's own plan/)
    await assert.rejects(linkDoc(HOUSE, 'https://drive.google.com/drive/folders/abcdefghijkl'), /folder/)
    await assert.rejects(uploadDoc(HOUSE, { name: 'run.exe', mime: 'application/x-msdownload', b64: PDF_B64 }), /Word, Excel or PowerPoint/)
  })

  it('Associated clients: a client placed in no house added; a client of another house refused; none taken off', async () => {
    S.clients.push({ client_key: 'new_bie', name: 'New Bie', house: '', home_address: '1 Elsewhere St', status: 'active' })
    const got = await addClients(HOUSE, ['new_bie', 'bo_briar']) as { added: { name: string }[]; refused: { why: string }[] }
    assert.deepEqual(got.added.map((a) => a.name), ['New Bie'])
    assert.match(got.refused[0].why, /current client of BW1001; a client is never taken off/)
    assert.deepEqual(steps(got), ['sheet:true,cache:true', 'clients', 'houses', 'locations'])
    const o = overviewOf(await readOverview(HOUSE))
    assert.deepEqual(o.clients.map((c) => c.name).sort(), ['Kenny Marsh', 'Lia Gomez', 'New Bie'], 'nobody was taken off')
    await assert.rejects(addClients(HOUSE, ['kenny_marsh']), /already a client of NW4045/)
  })

  it('a person App Control lets read: refused with no edition, allowed for theirs while its key is on, refused when it is off', async () => {
    AS = SAM
    await assert.rejects(removeStaff(HOUSE, 'Ava Stone'), /Unknown action/)
    S.config = { mywork_editions: JSON.stringify([{ id: 'locations.staffRemove', on: true, people: ['u-sam'] }]) }
    forgetLocationReads()
    const scope = await readLocationScope()
    assert.deepEqual(scope.editions, ['locations.staffRemove'])
    const off = await removeStaff(HOUSE, 'Ava Stone')
    assert.equal(serverSteps(off).app, 'locations')
    await assert.rejects(addNote({ house: HOUSE, priority: 'low', details: 'x' }), /Unknown action/, 'another edition stays shut')
    S.config = { mywork_editions: JSON.stringify([{ id: 'locations.staffRemove', on: false, people: ['u-sam'] }]) }
    await assert.rejects(removeStaff(HOUSE, 'Ava Stone', true), /Unknown action/, 'the key off shuts it even for a listed person')
  })
})

describe('a write the relay\'s ledger holds', () => {
  it('{accepted, queued|confirmed} and a pending id are held; a door\'s own answer is not', () => {
    assert.equal(writeQueued({ accepted: true, queued: true }), true)
    assert.equal(writeQueued({ accepted: true, confirmed: false }), true)
    assert.equal(writeQueued({ id: 'pending-abc', client_name: 'Kenny Marsh' }), true)
    assert.equal(writeQueued({ note: { id: 'HN_1' } }), false)
    assert.equal(writeQueued(null), false)
  })

  it('the house is read again at once', async () => {
    const before = calls.length
    const h = mountHook(() => useLocationRead(readKey('locationNotes', HOUSE), () => readNotes(HOUSE), notesOf), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(calls.length, before + 1)
    let queued = false
    h.run(() => { queued = locationWrote(HOUSE, { accepted: true, queued: true }) })
    assert.equal(queued, true)
    await h.settle(() => calls.length === before + 2 && !h.current.refreshing)
    assert.equal(calls.length, before + 2)
    h.unmount()
  })
})

describe('a viewer App Control released it to, as the page reads it', () => {
  it('the scope: the master everything and the writes, STAFF every house and no write, a client its house', async () => {
    assert.deepEqual(await readLocationScope(),
      { kind: 'master', writes: true, editions: LOCATION_EDITIONS, cut: false, houses: null, why: '' })
    AS = SAM
    assert.deepEqual(await readLocationScope(), { kind: 'all', writes: false, editions: [], cut: false, houses: null, why: '' })
    AS = KAY
    const kay = await readLocationScope()
    assert.deepEqual([kay.kind, kay.cut, kay.writes], ['client', true, false])
    assert.deepEqual(kay.houses?.map((h) => [h.code, h.title, h.clientCount, h.clients]),
      [['NW4045', 'CAN - NW - NW4045', 2, [{ client_key: 'kenny_marsh', name: 'Kenny Marsh' }]]])
    AS = { email: 'nobody@example.org', role: 'staff' }
    await assert.rejects(readLocationScope(), /Unknown action/)
  })

  it('STAFF reads every section as the master does, and every write is refused', async () => {
    AS = SAM
    const o = overviewOf(await readOverview(HOUSE))
    assert.equal(o.clients.length, 2)
    assert.equal(notesOf(await readNotes(HOUSE)).length, 0)
    assert.equal(staffOf(await readStaff(HOUSE)).rows.length, 2)
    await assert.rejects(addNote({ house: HOUSE, priority: 'low', details: 'x' }), /Unknown action/)
    await assert.rejects(addSupplyEntry({ house: HOUSE, item: 'Gloves', category: '', kind: 'count', qty: 3 }), /Unknown action/)
    await assert.rejects(setNoteState('HN_1', 'resolved', HOUSE), /Unknown action/)
    await assert.rejects(fileIstPaper({ house: HOUSE, staff: 'Noah Reed', client: 'Kenny Marsh',
      file: { name: 'ist.pdf', mime: 'application/pdf', b64: PDF_B64 } }), /Unknown action/)
  })

  it('a client: its own house only; its own client, incidents and ISP; the visible staff without papers; no notes or guidebook', async () => {
    // another account's held documents are dropped at the crossing; here, by hand
    forgetDocs()
    AS = KAY
    await assert.rejects(readOverview('BW1001'), /Unknown action/, 'another house is the closed gate')
    const o = overviewOf(await readOverview(HOUSE))
    assert.deepEqual(o.clients, [{ client_key: 'kenny_marsh', name: 'Kenny Marsh' }])
    const s = staffOf(await readStaff(HOUSE))
    assert.deepEqual(s.rows.map((r) => r.name), ['Noah Reed'])
    assert.deepEqual(s.clients.map((c) => c.name), ['Kenny Marsh'])
    assert.deepEqual(istCellFor(s.rows[0], 'Kenny Marsh'), { kind: 'trained', at: '2025-02-01' }, 'the paper is not theirs to open')
    assert.deepEqual(incidentsOf(await readIncidents(HOUSE)).map((r) => r.client), ['Kenny Marsh'])
    const docs = documentsOf(await readDocuments(HOUSE))
    assert.deepEqual(docs.isps.map((d) => d.client), ['Kenny Marsh'])
    assert.deepEqual(docs.policies.map((p) => p.title), ['Bill of Rights - ER', 'MUI Handbook'])
    assert.deepEqual([docs.guidebook, docs.withheld], [null, true])
    assert.ok(!documentRows([], docs, 'Arlington').some((d) => d.type === 'Guidebook'))
    await assert.rejects(readNotes(HOUSE), /Unknown action/)
    assert.equal((await readDocFile(HOUSE, 'ispdoc000001')).mime, 'application/pdf', 'its own client\'s ISP opens')
    await assert.rejects(readDocFile(HOUSE, 'guide0000001'), /names no such document/)
    await assert.rejects(readDocFile(HOUSE, 'istpaper0001'), /names no such document/)
    await assert.rejects(readDocFile(HOUSE, policyId(0)), /names no such document/)
    await assert.rejects(addNote({ house: HOUSE, priority: 'low', details: 'x' }), /Unknown action/)
    const one = [{ field: 'x', value: '1', expected: '' }]
    await assert.rejects(saveHouse(HOUSE, 'Arlington', one), /Unknown action/)
    await assert.rejects(editNote(HOUSE, 'LN_1', one), /Unknown action/)
    await assert.rejects(editSupplyEntry(HOUSE, 'LS_1', one), /Unknown action/)
  })
})

describe('what crossed the wire', () => {
  it('every call carried only the parameters its door declares, and every door was called', () => {
    const bad = calls.filter((c) => {
      const declared = Object.keys(GS.HUB_POLICY[c.action]?.params ?? {})
      return Object.keys(c.payload).some((k) => !declared.includes(k))
    })
    assert.deepEqual(bad, [])
    assert.deepEqual([...new Set(calls.map((c) => c.action))].sort(), [...GS.LOCATION_ACTIONS].sort())
  })

  it('a house document is never kept as a relay receipt', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    assert.ok(line.includes('"locationDocFile"'), line)
    assert.ok(!line.includes('"locationIstFile"'), 'an upload keeps its exactly-once receipt')
  })
})
