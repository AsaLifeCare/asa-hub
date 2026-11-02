/**
 * SSA · the contract between the page and its doors. Every call the page makes is caught at `fetch` — the slices,
 * the relay's pack (answered by SsaProfiles.gs's own ssaPack, as the relay's service identity runs it) and each
 * Apps Script door — and handed to Apps Script's own SsaProfiles.gs (with Locations.gs and ClientProfiles.gs, whose
 * helpers it leans on), run here on in-memory stores; the answer comes back as JSON and is read by the page's own
 * readers and drawn by its own sections. A name, a parameter, a part or a field that one side renames breaks here,
 * not on the screen.
 *
 * The app ships master-only: no App Control row, mounted only through CUSTOM_PAGES. Nothing in it is a dialog.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { bootClientFiles } from './client-files-index'
import { Fragment, createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { isAllowedWith } from '@/lib/appAccess'
import { PREFETCH_GAP_MS, forgetPack } from '@/lib/appPack'
import { forgetSnapshot } from '@/lib/snapshotClient'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { appManifests } from '@/registry/apps'
import { ssaProfilesManifests } from '@/registry/apps-ssa-profiles'
import AppRoutePage, { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { blobOf, docShapeOf } from '@/pages/features/myprofile/certDocFile'
import SsaProfilesPage, { SsaScreen } from '@/pages/features/ssaprofiles/SsaProfilesPage'
import SsaPanel from '@/pages/features/ssaprofiles/SsaPanel'
import { ActionsMenu } from '@/pages/features/ssaprofiles/SsaActions'
import { ReadLine } from '@/pages/features/ssaprofiles/SsaParts'
import { SwitcherList } from '@/pages/features/ssaprofiles/SsaSwitcher'
import { OverviewView } from '@/pages/features/ssaprofiles/sections/Overview'
import { NotesView } from '@/pages/features/ssaprofiles/sections/Notes'
import { DocumentsView } from '@/pages/features/ssaprofiles/sections/Documents'
import { ActivityView } from '@/pages/features/ssaprofiles/sections/Activity'
import {
  CLIENTS_PATH, NOT_OPEN, NOT_PUBLISHED, activityOf, agencyOf, askWithin, docOpens, documentsOf, narrowedViewer, notesOf, overviewOf,
  readRefusal, refusalFor, rosterFrom, rosterOf, sharePayloadFor, ssaKeyOf, ssaReach, tabWithin, withoutDocuments, type RosterRow,
  type SsaAsk,
} from '@/pages/features/ssaprofiles/ssaModel'
import { SHELL_HIDDEN, SHELL_SHOWN, primeShellHides, shellHidesOf } from '@/lib/myWorkHides'
import {
  addNote, editActivity, editDoc, forgetSsaReads, readActivity, readDocFile, readDocuments, readEdit, readKey, readNotes,
  readOverview, readRoster, saveSsa, saveSsaClients, ssaWrote, useSsaRead, type ReadState,
} from '@/pages/features/ssaprofiles/useSsaRead'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const FEATURE = 'src/pages/features/ssaprofiles'
const KEY = 'ssa_denisealvarez'
const NOW = '2026-09-28T15:00:00Z'
const SOURCE_AT = '2026-09-28T14:00:00.000Z'
const PDF = [0x25, 0x50, 0x44, 0x46]
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
  ['HubCore.gs', 'hubCellSafe_'], ['Talent.gs', 'str_'], ['SheetDb.gs', 'HUB_TAB_HOME'], ['SheetDb.gs', 'HUB_TAB_BORN_HOME'],
  ['Main.gs', 'hubAddrKey_'], ['Main.gs', 'hubClientIdentity_'], ['Estate.gs', 'estateKey_'], ['Estate.gs', 'estateCell_'],
  ['ComplianceDocs.gs', 'CERT_DOC_TYPES'], ['ComplianceDocs.gs', 'CERT_DOC_TYPE_WORDS'],
  ['ComplianceDocs.gs', 'complianceDocsTypeOk_'], ['ComplianceDocs.gs', 'complianceDocsTypeByName_'],
  ['ComplianceDocs.gs', 'complianceDocsTypeLoose_'], ['ComplianceDocs.gs', 'complianceDocsSameType_'],
  ['ComplianceDocs.gs', 'complianceDocsFileType_'], ['ComplianceDocs.gs', 'complianceDocsShownType_'],
  ['StaffProfiles.gs', 'spDigits10_'], ['StaffProfiles.gs', 'spReadColumns_'], ['StaffProfiles.gs', 'spNumbers_'],
  ['StaffProfiles.gs', 'spLineOf_'], ['ClientSourceFinance.gs', 'CSF_MONTHS'], ['ClientSourceFinance.gs', 'csfIso_'],
  ['ClientSourceFinance.gs', 'csfDay_'], ['ClientSourceFinance.gs', 'csfSerialDay_'], ['ClientSourceFinance.gs', 'csfDays_'],
  ['ClientSourceFinance.gs', 'csfSpan_'], ['Hotline.gs', 'HOTLINE_TRANSCRIPTS_TAB'], ['Hotline.gs', 'HOTLINE_COLS'],
  ['MailLog.gs', 'MAIL_LOG_TAB'],
]

/* ---------- the stores ---------- */

type Row = Record<string, unknown>
type Grid = unknown[][]
type DriveFile = { name: string; mime: string; bytes: number[] }

function freshStores() {
  return {
    // the clients as clientsDerived_ answers them, and the clients slice the relay writes from the same rows
    clients: [
      { client_key: 'annettekowal', id: 'CLI_annettekowal', name: 'Annette Kowal', house: 'NW4045', status: 'active',
        ssa_name: 'Denise Alvarez', ssa_phone: '3305550102', ssa_email: 'Denise.Alvarez@StarkDD.org', county: 'Stark',
        isp_signed_date: '2026-03-01', medications: ['Secret pill'] },
      { client_key: 'kennymarsh', id: 'CLI_kennymarsh', name: 'Kenny Marsh', house: 'NW4045', status: '',
        ssa_name: 'Denise  Alvarez', ssa_phone: '(330) 555-0102', ssa_email: '', county: 'Stark' },
      { client_key: 'lialopez', id: 'CLI_lialopez', name: 'Lia Lopez', house: 'BW1001', status: 'active',
        ssa_name: 'Sam Support', ssa_phone: '330-555-0199', ssa_email: 'sam.support@gmail.com', county: 'Summit' },
      { client_key: 'nobody', id: 'CLI_nobody', name: 'No Body', house: 'BW1001', status: 'active', ssa_name: 'N/A' },
      { client_key: 'oldtimer', id: 'CLI_oldtimer', name: 'Old Timer', house: 'BW1001', status: 'inactive',
        ssa_name: 'Pat Past', ssa_email: 'pat.past@stardd.org' },
    ] as Row[],
    photos: [{ kind: 'avatar', title: 'Annette Kowal', src: 'https://example.org/annette.jpg' }] as Row[],
    books: {
      entity_homes: [
        ['abbreviation', 'home_name', 'address', 'region', 'telephone', 'manager_name', 'manager_phone', 'calendar_link', 'thumbnail_url'],
        ['NW4045', 'CAN - NW - NW4045', '908 Arlington Ave NW, Canton, OH 44708', 'Canton', '3305550100', '', '', '', ''],
        ['BW1001', 'CAN - BW - BW1001', '12 Briar Way, Canton, OH 44708', 'Canton', '', '', '', '', ''],
      ],
      Master: [['Client', 'SSA', 'SSA Email', 'SSA #']],
      'Archive - Old Clients': [['Customer', 'House', 'Status', 'SSA', 'SSA Email', 'SSA #'],
        ['Archie Old', 'QQ1000', 'Discharged', 'Denise Alvarez', 'denise.alvarez@starkdd.org', '3305550102']],
      Transcripts: [
        ['Call ID', 'Transcript Created', 'Event Timestamp', 'Duration (sec)', 'Direction', 'Participant(s)', 'Team Member(s)'],
        ['AC1', '2026-09-15T14:01:00Z', '2026-09-15T14:00:00Z', 180, 'incoming', '+13305550102', '+13305550100'],
        ['AC2', '2026-09-16T14:01:00Z', '2026-09-16T14:00:00Z', 30, 'incoming', '+13305550999', '+13305550100'],
      ],
    } as Record<string, Grid>,
    tables: {
      isps: [
        { client_key: 'annettekowal', isp_year: '11/16/2025 - 11/15/2026', loaded_at: '2026-02-01T10:00:00Z' },
        { client_key: 'kennymarsh', isp_year: '9/1/2025 - 8/31/2026', loaded_at: '2025-09-02T10:00:00Z' },
      ],
      clientFiles: [
        { id: 'cf1', client_key: 'annettekowal', client_name: 'Annette Kowal', title: 'Behavior support plan',
          drive_id: 'bsplan000001', issued_on: '2026-05-01' },
        { id: 'cf2', client_key: 'otherclient', client_name: 'Other Client', title: 'Other Client ISP',
          drive_id: 'foreign00001', issued_on: '2026-05-02' },
        { id: 'cf3', client_key: 'annettekowal', client_name: 'Annette Kowal', title: 'SSN card of Denise Alvarez', doc_kind: 'ssn',
          drive_id: 'ssncard00001' },
        { id: 'cf4', client_key: 'annettekowal', client_name: 'Annette Kowal', title: 'Letter from Denise Alvarez',
          drive_id: 'letter000001', issued_on: '2026-06-01' },
        { id: 'cf5', client_key: 'annettekowal', client_name: 'Annette Kowal', title: 'Lunch with Denise Alvarez',
          digest_category: 'receipt_invoice', doc_kind: 'receipt', drive_id: 'receipt00001', issued_on: '2026-06-02' },
      ],
    } as Record<string, Row[]>,
    files: {
      ispdoc000001: { name: 'Annette Kowal ISP 2026.pdf', mime: 'application/pdf', bytes: PDF },
      bsplan000001: { name: 'Plan.pdf', mime: 'application/pdf', bytes: PDF },
      letter000001: { name: 'Letter.pdf', mime: 'application/pdf', bytes: PDF },
      receipt00001: { name: 'Receipt.pdf', mime: 'application/pdf', bytes: PDF },
      foreign00001: { name: 'Other.pdf', mime: 'application/pdf', bytes: PDF },
      ssncard00001: { name: 'Card.pdf', mime: 'application/pdf', bytes: PDF },
    } as Record<string, DriveFile>,
    tabs: {
      quo_messages: sheetOf([
        ['message_id', 'message_created', 'direction', 'from_number', 'to_number', 'body', 'quo_number'],
        ['M1', '2026-09-20T12:00:00Z', 'incoming', '+13305550102', '+13305550100', 'The ISP meeting moved to Friday', 'PN_main'],
        ['M2', '2026-09-21T12:00:00Z', 'incoming', '+13305550999', '+13305550100', 'stranger text', 'PN_main'],
      ]),
      mail: sheetOf([
        ['id', 'at', 'direction', 'from', 'to', 'cc', 'subject', 'preview'],
        ['E1', '2026-09-22T12:00:00Z', 'in', 'Denise Alvarez <denise.alvarez@starkdd.org>', 'ops@example.org', '', 'Annual review',
          'Please send the ISP signatures'],
      ]),
    } as Record<string, ReturnType<typeof sheetOf>>,
    slicesServed: true,
    packOpen: true,
    // what App Control's release and the viewer's scope answer another session, by its e-mail (ViewerScope.gs)
    scopes: {} as Record<string, Row>,
    // Settings > My Work's switches as AlertsConfig.gs hubMyWorkHideRead_ reads them; null: not read here
    hide: null as Row | null,
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
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/* ---------- Apps Script, booted ---------- */

type Answer = { status: number; data?: unknown; message?: string }
type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; params?: Record<string, unknown> }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => Answer>
  SSA_ACTIONS: string[]
  SSA_PACK_PARTS: string[]
  ssaKeyOf_: (name: unknown) => string
  ssaAgency_: (email: unknown) => string
}

const LINES: Record<string, { name: string; e164: string; shared: boolean; humans: number; owner: string }> = {
  '3305550100': { name: 'Main line', e164: '+13305550100', shared: false, humans: 1, owner: 'Ann Lee' },
}

function boot(): Gs {
  let uuid = 0
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, isFinite, parseInt, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {}, CLIENTS_DERIVED_MEMO_: null,
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
    hubProfileAppGate_: (app: string, u: Row | null) => {
      const scope = u && !u.is_service ? S.scopes[String(u.email)] : undefined
      return app === 'ssa-profiles' && scope ? { open: true, scope } : { open: false, scope: { kind: 'none' } }
    },
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
    listRows_: (r: string) => JSON.parse(JSON.stringify(S.tables[r] ?? [])),
    ispDocIndex_: () => ({ files: { annettekowal: 'ispdoc000001' } }),
    ispDocFor_: (name: string) => (name === 'Annette Kowal'
      ? { id: 'ispdoc000001', name: 'Annette Kowal ISP 2026.pdf', url: '' } : { id: '', name: '', url: '' }),
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
    sheetDbGateHolds_: () => null,
    sheetDbRefused_: () => null,
    hubSysLog_: () => true,
    hubMyWorkHideRead_: () => {
      if (!S.hide) throw new Error('the display switches are not read here')
      return S.hide
    },
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('Locations.gs'), ctx)
  vm.runInContext(gsText('ClientProfiles.gs'), ctx)
  vm.runInContext(gsText('SsaProfiles.gs'), ctx)
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

/* ---------- the page's calls, answered by the slices, the relay's pack and the doors ---------- */

let seen: { kind: 'slice' | 'pack' | 'gas'; name: string; payload?: Row; url?: string }[] = []
const realFetch = globalThis.fetch
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

before(() => {
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/snapshot/')) {
      const name = url.slice('/snapshot/'.length).replace(/\.json$/, '')
      seen.push({ kind: 'slice', name })
      const slices: Record<string, Row[]> = S.slicesServed ? { clients: S.clients, photos: S.photos } : {}
      if (name === 'index') return json({ slices: Object.fromEntries(Object.keys(slices).map((k) => [k, { built_at: SOURCE_AT }])) })
      const rows = slices[name]
      return rows ? json({ resource: name, built_at: SOURCE_AT, source_at: SOURCE_AT, rows }) : new Response('no', { status: 404 })
    }
    if (url.startsWith('/erp-lanes/app-pack/')) {
      const app = decodeURIComponent(url.slice('/erp-lanes/app-pack/'.length).split('?')[0])
      const key = decodeURIComponent(new Headers(init?.headers).get('X-App-Pack-Key') ?? '')
      seen.push({ kind: 'pack', name: `${app}:${key}`, url })
      if (!S.packOpen || app !== 'ssa-profiles') return json({ status: 404, reason: 'unknown' }, 404)
      // the relay's door is the master's alone; the pack itself is gathered by the service identity
      if (SESSION !== MASTER) return json({ status: 403, message: 'Not here.' }, 403)
      const got = door('ssaPack', { ssa: key }, SERVICE)
      return json(got.status === 200 ? { status: 200, data: { ...(got.data as Row), read_age_s: 1 } } : got)
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
  seen = []
  forgetSnapshot()
  forgetPack()
  forgetSsaReads()
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

/** The doors only Python answers (app/doors.json): declared there, never in SsaProfiles.gs. */
const PY_DOORS: Record<string, { file: string; lane: string; params?: Row }> =
  JSON.parse(readFileSync(resolve(ROOT, 'app/doors.json'), 'utf8'))
const PY_SSA = Object.keys(PY_DOORS).filter((n) => n.startsWith('ssaProfile')).sort()

const RELAY_NO_RECEIPT = (): Set<string> => {
  const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
  const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
  return new Set([...line.matchAll(/"(\w+)"/g)].map((m) => m[1]))
}

/* ---------- the app ---------- */

describe('the app', () => {
  after(() => useAuthStore.setState({ user: null } as never))

  it('is "SSA", id ssa-profiles, one page "profile" on the houses slice, for admins and managers, in the registry once', () => {
    const app = ssaProfilesManifests[0]
    assert.deepEqual([app.id, app.name, app.icon, app.accent, app.category, app.isNew, app.enabled],
      ['ssa-profiles', 'SSA', 'briefcase', 'lavender', 'Care', true, true])
    assert.deepEqual([app.audience, app.focusAudience], [['admin', 'manager', 'client'], []])
    assert.deepEqual(app.pages.map((p) => [p.id, p.title, (p as { dataSource?: { resource?: string } }).dataSource?.resource]),
      [['profile', 'SSA Profile', 'houses']])
    assert.equal(appManifests.filter((m) => m.id === 'ssa-profiles').length, 1)
    const ids = appManifests.map((m) => m.id)
    assert.equal(ids.indexOf('ssa-profiles'), ids.indexOf('client-profiles') + 1, 'registered next to Clients')
  })

  it('is mounted only through CUSTOM_PAGES, never on a static route', async () => {
    // a lazy chunk (lib/lazyPage): the entry resolves to the screen itself
    assert.equal(await CUSTOM_PAGES['ssa-profiles/profile'].load(), SsaProfilesPage)
    assert.ok(!readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8').includes('ssa-profiles'), 'no static route in App.tsx')
  })

  it('ships no App Control row: a non-master admin is refused, the master passes', async () => {
    // the screen's chunk is in before the render, so the master's render draws it rather than a fallback
    await CUSTOM_PAGES['ssa-profiles/profile'].load()
    const director = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
    const master = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
    assert.equal(badgeAllowsApp('ssa-profiles', director as never, {}), false)
    assert.equal(badgeAllowsApp('ssa-profiles', { ...director, role: 'manager' } as never, { houses: ['DIRECTOR'] }), false)
    assert.equal(badgeAllowsApp('ssa-profiles', master as never, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools', 'server']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(name)) continue
        const text = readFileSync(join(resolve(ROOT, dir), name), 'utf8')
        if (/app_badge_access[^\n]{0,200}['"]ssa-profiles['"]|['"]ssa-profiles['"][^\n]{0,200}app_badge_access/.test(text)) hits.push(name)
      }
    }
    assert.deepEqual(hits, [])

    useRegistryStore.setState({ apps: appManifests })
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} } as never)
    const open = () => flat(renderToString(createElement(MemoryRouter, { initialEntries: [`/app/ssa-profiles/profile?ssa=${KEY}`] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) })))))
    useAuthStore.setState({ user: director } as never)
    assert.equal(isAllowedWith(appManifests, 'admin', 'ssa-profiles'), false)
    assert.ok(!open().includes('data-ssa-profiles'), 'a director sees nothing of it')
    useAuthStore.setState({ user: master } as never)
    assert.equal(isAllowedWith(appManifests, 'admin', 'ssa-profiles'), true)
    assert.ok(open().includes('data-ssa-profiles'), 'the master gets the screen')
  })
})

/* ---------- the names ---------- */

describe('the names', () => {
  it('every SSA door the page names is a SsaProfiles.gs action, every such action has a caller, and each is in the catalogue', () => {
    const named = new Set<string>()
    for (const f of walk(FEATURE)) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    // the platform's own door the page also names: the editions this viewer makes (Editions.gs); the edit's two doors
    // are Python's alone (app/doors.json)
    const own = [...named].filter((n) => n.startsWith('ssaProfile') && !PY_SSA.includes(n))
    assert.deepEqual([...named].filter((n) => !n.startsWith('ssaProfile')), ['editionsMine'])
    assert.deepEqual([...named].filter((n) => PY_SSA.includes(n)).sort(),
      ['ssaProfileActivityEdit', 'ssaProfileClients', 'ssaProfileDocEdit', 'ssaProfileEdit', 'ssaProfileEditRead'])
    for (const name of PY_SSA) {
      assert.match(PY_DOORS[name].file, /^app\/ssa(_writes)?\.py$/, `${name} is answered by Python's SSA module`)
      assert.equal(GS.HUB_ACTIONS[name], undefined, `${name} has no Apps Script handler`)
    }
    for (const name of own) {
      assert.equal(GS.HUB_POLICY[name]?.file, 'SsaProfiles.gs', `${name} is declared in SsaProfiles.gs`)
      assert.equal(typeof GS.HUB_ACTIONS[name], 'function', `${name} has a handler`)
    }
    assert.deepEqual(own.sort(), [...GS.SSA_ACTIONS].sort())
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of named) assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
  })

  it('the pack parts the page reads are the ones ssaPack gathers; the client views are the relay\'s to cut', () => {
    const reads = readFileSync(resolve(ROOT, FEATURE, 'ssaReads.ts'), 'utf8')
    const parts = [...reads.matchAll(/ssaPackOr\(ssa, '([a-z_]+)'/g)].map((m) => m[1]).sort()
    assert.deepEqual(parts, [...GS.SSA_PACK_PARTS].filter((p) => p !== 'client_views').sort())
    assert.ok(GS.SSA_PACK_PARTS.includes('client_views'))
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    assert.ok(relay.includes('views = parts.get("client_views")'), 'the relay reads each client\'s own view out of the pack')
  })

  it('an SSA is keyed, and an agency named, exactly as SsaProfiles.gs does', () => {
    for (const name of ['Denise Alvarez', 'Denise  Alvarez ', 'N/A', 'none', 'Self', 'Jo', 'Deborah Riley- SSA', '', 'No SSA assigned']) {
      assert.equal(ssaKeyOf(name), GS.ssaKeyOf_(name), JSON.stringify(name))
    }
    for (const email of ['a@starkdd.org', 'A@StarDD.org', 'x@gmail.com', 'y@county.oh.us', 'not an email', '']) {
      assert.equal(agencyOf(email), GS.ssaAgency_(email.toLowerCase()), email)
    }
  })

  it('a session that is not the master in its own gets "Unknown action.", which the page says as a sentence', async () => {
    S.packOpen = false
    SESSION = DIRECTOR
    await assert.rejects(readOverview(KEY), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
    SESSION = { ...MASTER, visiting_member: 'mem_1' }
    await assert.rejects(readRoster(true), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
    assert.equal(door('ssaPack', { ssa: KEY }, DIRECTOR).status, 404, 'the pack answers the service identity or the master only')
  })

  it('an SSA no record names is refused in words', async () => {
    S.packOpen = false
    await assert.rejects(readOverview('ssa_nobodyatall'), /No SSA "ssa_nobodyatall" is on file/)
  })
})

/* ---------- the lanes ---------- */

describe('the lanes: the slices, then the relay\'s pack, then the door', () => {
  it('the switcher\'s roster comes from the clients slice with no execution, and says what the action says', async () => {
    const lane1 = rosterOf(await readRoster(false))
    assert.deepEqual(gasCalls(), [])
    assert.deepEqual(packAsks(), [])
    const action = rosterOf(door('ssaProfileRoster', {}).data)
    const shown = (r: RosterRow) => [r.key, r.name, r.phone, r.email, r.agency, r.county, r.status, r.avatar]
    assert.deepEqual(lane1.ssas.map(shown), action.ssas.map(shown))
    assert.deepEqual(lane1.ssas.map((r) => [r.key, r.status, r.agency]), [
      ['ssa_denisealvarez', 'active', 'Stark County Board of DD'], ['ssa_patpast', 'inactive', 'Stark County Board of DD'],
      ['ssa_samsupport', 'active', '']])
    assert.equal(lane1.ssas[0].email, 'denise.alvarez@starkdd.org')
    assert.equal(lane1.ssas[0].phone, '(330) 555-0102')
    assert.ok(!lane1.ssas.some((r) => r.name === 'N/A'), '"N/A" names no SSA')
    // Show Inactive asks the action, which also counts the clients the archive names
    const all = rosterOf(await readRoster(true))
    assert.deepEqual(gasCalls(), ['ssaProfileRoster'])
    assert.equal(all.ssas.find((r) => r.key === KEY)?.clients, 3)
  })

  it('with no clients slice here the roster reads its action', async () => {
    S.slicesServed = false
    const r = rosterOf(await readRoster(false))
    assert.deepEqual(gasCalls(), ['ssaProfileRoster'])
    assert.equal(r.ssas.length, 3)
  })

  it('every section reads the relay\'s pack first — the key in the header, never the address — and the door\'s own answer is the same', async () => {
    const [o, d, a, n] = await Promise.all([readOverview(KEY), readDocuments(KEY), readActivity(KEY), readNotes(KEY)])
    assert.deepEqual(gasCalls(), [], 'no section read its door')
    assert.equal(packAsks().filter((p) => p === `ssa-profiles:${KEY}`).length, 1, 'one pack serves every section')
    assert.ok(seen.every((s) => !(s.url ?? '').includes('denise')), 'the key rides the header, never the address')
    assert.deepEqual(overviewOf(o), overviewOf(door('ssaProfileOverview', { ssa: KEY }).data))
    assert.deepEqual(documentsOf(d), documentsOf(door('ssaProfileDocuments', { ssa: KEY }).data))
    assert.deepEqual(activityOf(a).followups, activityOf(door('ssaProfileActivity', { ssa: KEY }).data).followups)
    assert.deepEqual(notesOf(n), notesOf(door('ssaProfileNotes', { ssa: KEY }).data))
  })

  it('when the relay has no pack door, each section reads its own action', async () => {
    S.packOpen = false
    await Promise.all([readOverview(KEY), readDocuments(KEY), readActivity(KEY), readNotes(KEY)])
    assert.deepEqual(gasCalls().sort(), ['ssaProfileActivity', 'ssaProfileDocuments', 'ssaProfileNotes', 'ssaProfileOverview'])
  })

  it('an SSA only archived clients name is never asked of the relay', async () => {
    await readOverview('ssa_patpast')
    assert.deepEqual(packAsks(), [])
    assert.deepEqual(gasCalls(), ['ssaProfileOverview'])
  })

  it('a current client the slice names no SSA for: lane 1 says it is partial, the action\'s roster names the SSA the Asa Client Database gives, and that SSA is asked of the relay', async () => {
    S.clients.push({ client_key: 'maxnew', id: 'CLI_maxnew', name: 'Max New', house: 'BW1001', status: 'active', ssa_name: '' })
    S.books.Master.push(['Max New', 'Rita Master', 'rita.master@starkdd.org', '3305550177'])
    const lane1 = rosterOf(await readRoster(false))
    assert.equal(lane1.partial, true)
    assert.ok(!lane1.ssas.some((r) => r.key === 'ssa_ritamaster'))
    assert.deepEqual(gasCalls(), [])
    const all = rosterOf(await readRoster(true))
    assert.equal(all.partial, false)
    assert.equal(all.ssas.find((r) => r.key === 'ssa_ritamaster')?.status, 'active')
    seen = []
    const o = overviewOf(await readOverview('ssa_ritamaster'))
    assert.deepEqual(packAsks(), ['ssa-profiles:ssa_ritamaster'])
    assert.deepEqual(gasCalls(), [])
    assert.deepEqual(o.clients.map((c) => c.client_key), ['maxnew'])
  })
})

/* ---------- the reads, as the page reads them ---------- */

describe('the reads', () => {
  it('overview: the SSA\'s details, every client whose record names them (the current first), each a link into Clients', async () => {
    const o = overviewOf(await readOverview(KEY))
    assert.deepEqual([o.ssa.name, o.ssa.phone, o.ssa.email, o.ssa.agency, o.ssa.county, o.ssa.office_address, o.ssa.status],
      ['Denise Alvarez', '(330) 555-0102', 'denise.alvarez@starkdd.org', 'Stark County Board of DD', 'Stark', '', 'active'])
    assert.deepEqual(o.clients.map((c) => [c.client_key, c.status, c.house_label]), [
      ['annettekowal', 'active', 'CAN - NW - NW4045'], ['kennymarsh', 'active', 'CAN - NW - NW4045'], ['archieold', 'inactive', 'QQ1000']])
    assert.ok(!/medications|Secret pill/.test(JSON.stringify(await readOverview(KEY))), 'nothing clinical')
    const row = rosterOf(await readRoster(false)).ssas[0]
    const html = draw(createElement(Fragment, null, createElement(OverviewView, { row, overview: ready(o), onRetryOverview: noop }),
      createElement(NotesView, { row, notes: ready(notesOf({ notes: [] })), write: true, onRetry: noop })))
    assert.ok(html.includes(`href="${CLIENTS_PATH}?client=annettekowal"`), 'a client opens in Clients')
    assert.ok(html.includes('Service and Support Administrator · CAN - NW - NW4045'))
    for (const w of ['SSA Details', 'County / Agency', 'Stark County · Stark County Board of DD', 'href="tel:3305550102"',
      'href="mailto:denise.alvarez@starkdd.org"', 'Office address', 'Not on file', 'Associated clients', 'Admin notes',
      'Add a note about this SSA…', 'Add note', 'No admin notes yet.']) {
      assert.ok(html.includes(w), w)
    }
    noModal(html, 'overview')
  })

  it('documents: each client\'s plan — with no file when the plans folder holds none — and the plan files the Clients app lists; never another\'s file, an identity paper, or a letter or receipt that only names the SSA', async () => {
    const d = documentsOf(await readDocuments(KEY))
    assert.deepEqual(d.docs.map((x) => [x.kind, x.file_id, x.client_key]), [
      ['client_doc', 'bsplan000001', 'annettekowal'], ['isp', 'ispdoc000001', 'annettekowal'], ['isp', '', 'kennymarsh']])
    for (const x of d.docs.filter(docOpens)) {
      const got = await readDocFile(KEY, x.file_id)
      assert.ok(docShapeOf(got.mime) && blobOf(got), `${x.title} opens in the platform`)
    }
    await assert.rejects(readDocFile(KEY, 'foreign00001'), /names no such document/, 'another client\'s file is refused')
    await assert.rejects(readDocFile(KEY, 'ssncard00001'), /names no such document/, 'an identity paper is never served')
    await assert.rejects(readDocFile(KEY, 'letter000001'), /names no such document/, 'a letter naming the SSA is not a plan')
    await assert.rejects(readDocFile(KEY, 'receipt00001'), /names no such document/, 'a receipt naming the SSA is not a plan')
    const html = draw(createElement(DocumentsView, { row: { key: KEY, name: 'Denise Alvarez' }, docs: ready(d),
      doc: { opening: '', open: noop }, onRetry: noop }))
    assert.equal((html.match(/data-open-doc="/g) ?? []).length, 2)
    assert.equal((html.match(/data-arrow=""/g) ?? []).length, 2, 'the plan with no file has no arrow')
    assert.ok(html.includes('Annette Kowal · ISP') && html.includes('data-doc="isp_kennymarsh"'))
    assert.ok(html.includes('Individual Service Plan 9/1/2025 - 8/31/2026'))
    noModal(html, 'documents')
  })

  it('activity: the texts and calls on the SSA\'s own phone, the mail from their address, the records naming them; a stranger never', async () => {
    const a = activityOf(await readActivity(KEY))
    const kinds = new Set(a.items.map((x) => x.kind))
    for (const k of ['sms', 'call', 'mail', 'record'] as const) assert.ok(kinds.has(k), k)
    assert.ok(!JSON.stringify(a.items).includes('stranger text'))
    assert.deepEqual(a.followups.map((f) => [f.client_key, f.status, f.due]), [
      ['kennymarsh', 'overdue', '2026-08-31'], ['annettekowal', 'to_schedule', '2026-11-15']])
    // Coordination follow-up is shown while Settings › My Work shows it to everyone
    primeShellHides(SHELL_SHOWN)
    const html = draw(createElement(ActivityView, { row: { name: 'Denise Alvarez' }, activity: ready(a), onRetry: noop }))
    primeShellHides(SHELL_HIDDEN)
    assert.ok(html.includes('Coordination follow-up') && html.includes('ISP review · follow-up'))
    assert.ok(html.includes('>To Schedule<') && html.includes('>Overdue<'))
    assert.ok(html.includes(`href="${CLIENTS_PATH}?client=kennymarsh"`))
    assert.ok(html.includes('Annual review'), 'the mail\'s subject is its title')
  })

  it('a source that cannot be read is said, line by line, and the answer is marked — never taken for nothing', async () => {
    delete S.tabs.mail
    S.packOpen = false
    const a = activityOf(await readActivity(KEY))
    assert.equal(a.degraded, true)
    assert.ok(a.why.some((w) => /mail log/i.test(w)), a.why.join(' | '))
    const html = draw(createElement(ActivityView, { row: { name: 'Denise Alvarez' }, activity: ready(a), onRetry: noop }))
    assert.ok(html.includes('data-degraded=""') && html.includes('Part of this could not be read.'))
    assert.ok(a.why.every((w) => html.includes(w.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;'))), 'every why line is drawn')
  })
})

/* ---------- the write ---------- */

describe('the admin note', () => {
  it('is filed, read back on the notes and in Activity; an empty one is refused', async () => {
    S.packOpen = false
    const got = await addNote(KEY, 'Prefers e-mail before noon')
    assert.equal(ssaWrote(KEY, got), false, 'the door\'s own answer is the note, not a ledger receipt')
    const n = notesOf(await readNotes(KEY))
    assert.deepEqual(n.notes.map((x) => [x.by, x.body]), [['Boss', 'Prefers e-mail before noon']])
    const a = activityOf(await readActivity(KEY))
    assert.ok(a.items.some((x) => x.kind === 'note' && x.body === 'Prefers e-mail before noon'))
    await assert.rejects(addNote(KEY, '   '), /body/)
  })

  it('a note filed from the page is on the section at once: the write forgets the SSA and the section reads again', async () => {
    S.packOpen = false
    const h = mountHook(() => useSsaRead(readKey('ssaProfileNotes', KEY), () => readNotes(KEY), notesOf), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(h.current.data?.notes.length, 0)
    const sentAt = Date.now()
    const got = await addNote(KEY, 'Called about the review')
    h.run(() => { ssaWrote(KEY, got, sentAt) })
    await h.settle(() => (h.current.data?.notes.length ?? 0) === 1 && !h.current.refreshing)
    assert.equal(h.current.data?.notes[0].body, 'Called about the review')
    h.unmount()
  })
})

/* ---------- released: the server cuts, the page follows ---------- */

describe('released: App Control opens the reads, the server cuts them, the page offers only what answers', () => {
  const STAFF = { email: 'sally@example.org', role: 'staff', display_name: 'Sally Staff' }
  const FAMILY = { email: 'fam@example.org', role: 'client', display_name: 'Fam Ily' }
  const SELF = { email: 'denise.alvarez@starkdd.org', role: 'staff', display_name: 'D Alvarez' }
  const signIn = (u: Row, types: string[]) => useAuthStore.setState({
    user: { id: `u-${String(u.email)}`, name: String(u.display_name), email: String(u.email), role: String(u.role), types, isMaster: false },
  } as never)
  const shut = (err: Error) => refusalFor(err.message, false) === NOT_OPEN
  const row: RosterRow = { key: KEY, name: 'Denise Alvarez', phone: '(330) 555-0102', email: 'denise.alvarez@starkdd.org',
    agency: 'Stark County Board of DD', county: 'Stark', clients: 1, status: 'active', avatar: '' }
  afterEach(() => useAuthStore.setState({ user: null } as never))

  it('a staff member it is released to reads every section as the master does — the switcher from the slices, a refused pack left to each door — and the note stays the master\'s', async () => {
    S.scopes[STAFF.email] = { kind: 'all', client_keys: [], house_codes: [], ssa_keys: [], family_keys: [] }
    SESSION = STAFF
    signIn(STAFF, ['STAFF'])
    const lane1 = rosterOf(await readRoster(false))
    assert.deepEqual(gasCalls(), [], 'a session the server does not cut draws the switcher from the slices')
    assert.equal(lane1.ssas.length, 3)
    const [o, d, a, n] = await Promise.all([readOverview(KEY), readDocuments(KEY), readActivity(KEY), readNotes(KEY)])
    assert.deepEqual(overviewOf(o), overviewOf(door('ssaProfileOverview', { ssa: KEY }, MASTER).data))
    assert.deepEqual(documentsOf(d), documentsOf(door('ssaProfileDocuments', { ssa: KEY }, MASTER).data))
    assert.deepEqual(activityOf(a), activityOf(door('ssaProfileActivity', { ssa: KEY }, MASTER).data))
    assert.deepEqual(notesOf(n), notesOf(door('ssaProfileNotes', { ssa: KEY }, MASTER).data))
    assert.deepEqual(gasCalls().sort(), ['ssaProfileActivity', 'ssaProfileDocuments', 'ssaProfileNotes', 'ssaProfileOverview'])
    await assert.rejects(addNote(KEY, 'Not mine to file'), shut)
    const all = rosterOf(await readRoster(true))
    assert.equal(all.viewer, 'all')
    // the Notes tab is Admin's and above (or whom App Control names): a staff badge is not offered it
    assert.deepEqual(ssaReach(all.viewer, narrowedViewer({ isMaster: false, role: 'staff', types: ['STAFF'] }), false, all.notes),
      { tabs: ['overview', 'documents', 'activity'], notes: false, write: false })
  })

  it('Settings › My Work\'s SSA parts ride the answers — the relay\'s pack and each door alike: gone for anyone released, all there for the master; off, all there for everyone', async () => {
    S.hide = { header: true, ssa_updated: true, ssa_county: true, ssa_count: true, ssa_role: true }
    const view = (o: unknown, n: unknown, master: boolean) => draw(createElement(Fragment, null,
      createElement(OverviewView, { row, overview: ready(overviewOf(o)), master, onRetryOverview: noop }),
      createElement(NotesView, { row, notes: ready(notesOf(n)), write: master, master, onRetry: noop })))
    const COUNTY = 'Stark County · Stark County Board of DD'
    const ROLE = 'Service and Support Administrator · CAN - NW - NW4045'
    const COUNT = 'whose record names this SSA.'
    const ALL = { updated: true, county: true, count: true, role: true }

    const [mo, mn] = await Promise.all([readOverview(KEY), readNotes(KEY)])
    assert.ok(packAsks().includes(`ssa-profiles:${KEY}`) && !gasCalls().includes('ssaProfileOverview'), 'the master reads the pack')
    assert.deepEqual([overviewOf(mo).hidden, notesOf(mn).hidden], [ALL, ALL])
    const own = view(mo, mn, true)
    for (const w of [COUNTY, ROLE, COUNT, 'data-for-users']) assert.ok(own.includes(w), w)

    forgetSsaReads()
    S.scopes[STAFF.email] = { kind: 'all', client_keys: [], house_codes: [], ssa_keys: [], family_keys: [] }
    SESSION = STAFF
    signIn(STAFF, ['STAFF'])
    seen = []
    const [so, sn] = await Promise.all([readOverview(KEY), readNotes(KEY)])
    assert.deepEqual(gasCalls().sort(), ['ssaProfileNotes', 'ssaProfileOverview'], 'a released session reads each door')
    assert.deepEqual([overviewOf(so).hidden, notesOf(sn).hidden], [ALL, ALL])
    const other = view(so, sn, false)
    assert.ok(other.includes('Stark County Board of DD') && other.includes('>CAN - NW - NW4045<') && other.includes('Annette Kowal'))
    for (const w of [COUNTY, ROLE, COUNT, 'Service and Support Administrator', 'data-for-users']) assert.ok(!other.includes(w), w)

    S.hide = { ssa_updated: false, ssa_county: false, ssa_count: false, ssa_role: false }
    forgetSsaReads()
    const [fo, fn] = await Promise.all([readOverview(KEY), readNotes(KEY)])
    assert.deepEqual(overviewOf(fo).hidden, { updated: false, county: false, count: false, role: false })
    const off = view(fo, fn, false)
    for (const w of [COUNTY, ROLE, COUNT]) assert.ok(off.includes(w), w)
    assert.ok(!off.includes('data-for-users'))
  })

  it('family sees their ward\'s SSA alone, with only the ward — read from the doors, never the slices or the pack — and no activity or notes', async () => {
    S.scopes[FAMILY.email] = { kind: 'guardian', client_keys: ['kennymarsh'], house_codes: [], ssa_keys: [KEY], family_keys: [] }
    SESSION = FAMILY
    signIn(FAMILY, ['GUARDIAN'])
    const r = rosterOf(await readRoster(false))
    assert.deepEqual(seen.filter((s) => s.kind !== 'gas'), [], 'no slice and no pack is asked')
    assert.deepEqual(gasCalls(), ['ssaProfileRoster'])
    assert.equal(r.viewer, 'guardian')
    assert.deepEqual(r.ssas.map((s) => [s.key, s.clients]), [[KEY, 1]])
    assert.deepEqual(overviewOf(await readOverview(KEY)).clients.map((c) => c.client_key), ['kennymarsh'])
    const d = documentsOf(await readDocuments(KEY))
    assert.deepEqual(d.docs.map((x) => x.id), ['isp_kennymarsh'])
    await assert.rejects(readDocFile(KEY, 'bsplan000001'), /names no such document/, 'another client\'s plan is not theirs')
    await assert.rejects(readActivity(KEY), shut)
    await assert.rejects(readNotes(KEY), shut)
    await assert.rejects(readOverview('ssa_samsupport'), shut, 'another SSA is a shut door')
    await assert.rejects(addNote(KEY, 'x'), shut)
    assert.deepEqual(packAsks(), [])
    const reach = ssaReach(r.viewer, true, false)
    assert.deepEqual(reach, { tabs: ['overview', 'documents'], notes: false, write: false })
    assert.equal(tabWithin('activity', reach), 'overview')
    assert.equal(askWithin({ kind: 'note' }, reach), null)
    assert.deepEqual(askWithin({ kind: 'share' }, reach), { kind: 'share' })
    assert.equal(askWithin({ kind: 'activity-edit', id: 'record_kennymarsh' }, reach, false, false,
      { docs: true, activity: true }), null, 'no entry of a section this reach does not hold')
  })

  it('an SSA sees themselves: only their own clients, their documents and activity — never an admin note — and no other SSA', async () => {
    assert.equal(door('ssaProfileNoteAdd', { ssa: KEY, body: 'Internal words' }, MASTER).status, 200)
    S.scopes[SELF.email] = { kind: 'ssa', client_keys: ['annettekowal'], house_codes: [], ssa_keys: [KEY], family_keys: [] }
    SESSION = SELF
    signIn(SELF, ['GUARDIAN'])
    const r = rosterOf(await readRoster(false))
    assert.equal(r.viewer, 'ssa')
    assert.deepEqual(r.ssas.map((s) => [s.key, s.clients]), [[KEY, 1]])
    assert.deepEqual(overviewOf(await readOverview(KEY)).clients.map((c) => c.client_key), ['annettekowal'])
    const a = activityOf(await readActivity(KEY))
    assert.ok(!a.items.some((x) => x.kind === 'note') && !JSON.stringify(a).includes('Internal words'))
    assert.deepEqual(a.items.filter((x) => x.kind === 'record').map((x) => x.client_key), ['annettekowal'])
    assert.deepEqual(a.followups.map((f) => f.client_key), ['annettekowal'])
    for (const k of ['sms', 'call', 'mail'] as const) assert.ok(a.items.some((x) => x.kind === k), `their own ${k}`)
    await assert.rejects(readNotes(KEY), shut)
    await assert.rejects(readActivity('ssa_samsupport'), shut)
    assert.deepEqual(packAsks(), [])
    assert.deepEqual(ssaReach(r.viewer, true, false), { tabs: ['overview', 'documents', 'activity'], notes: false, write: false })
  })

  it('the screen offers a cut session only its sections, no admin notes and no Add note; a shut door is said plainly', () => {
    signIn(FAMILY, ['GUARDIAN'])
    const reach = ssaReach('guardian', true, false)
    const html = draw(createElement(SsaScreen, { roster: ready({}), onRetry: noop, ssas: [row], wanted: KEY, row, tab: 'overview',
      reach, master: false, overview: null, inactive: { on: false, reading: false, why: '' }, onInactive: noop, onSsa: noop,
      onTab: noop, onAsk: noop }))
    assert.ok(html.includes('data-tab="overview"') && html.includes('data-tab="documents"'))
    assert.ok(!html.includes('data-tab="activity"') && !html.includes('Admin notes'))
    const failed = { status: 'failed', data: null, error: 'Unknown action.', refreshing: false } as unknown as ReadState<unknown>
    const line = draw(createElement(ReadLine, { state: failed, what: 'the documents', onRetry: noop }))
    assert.ok(line.includes(NOT_OPEN) && !line.includes('role="alert"'), line)
    assert.equal(refusalFor('Unknown action.', true), NOT_PUBLISHED, 'the master is told the deployment lacks it')
    assert.equal(refusalFor('This action is for admin or manager.', false), NOT_OPEN)
    assert.equal(refusalFor('The SSA could not be read just now.', false), 'The SSA could not be read just now.')
    const notesless = draw(createElement(OverviewView, { row, overview: ready(overviewOf(door('ssaProfileOverview', { ssa: KEY }, MASTER).data)),
      onRetryOverview: noop }))
    assert.ok(!notesless.includes('Admin notes') && !notesless.includes('Add a note about this SSA'))
  })
})

/* ---------- no modal anywhere ---------- */

describe('no modal anywhere', () => {
  const row: RosterRow = { key: KEY, name: 'Denise Alvarez', phone: '(330) 555-0102', email: 'denise.alvarez@starkdd.org',
    agency: 'Stark County Board of DD', county: 'Stark', clients: 3, status: 'active', avatar: '' }

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
    assert.deepEqual(openers.map((f) => f.slice(FEATURE.length + 1)), ['useSsaRead.ts'])
  })

  it('every mode of the panel is the SidePanel aside; share carries the SSA\'s address and nothing about a client', () => {
    const share = sharePayloadFor(row, 'overview')
    for (const ask of [{ kind: 'share' }, { kind: 'note' }] as SsaAsk[]) {
      const html = draw(createElement(SsaPanel, { ask, row, share, onClose: noop }))
      assert.match(html, /<aside aria-label="/, ask.kind)
      noModal(html, ask.kind)
    }
    assert.equal(draw(createElement(SsaPanel, { ask: null, row, share, onClose: noop })), '')
    const html = draw(createElement(SsaPanel, { ask: { kind: 'share' }, row, share, onClose: noop }))
    assert.ok(html.includes(`/app/ssa-profiles/profile?ssa=${KEY}`))
    assert.ok(!/Annette|Kenny/.test(html))
    const note = draw(createElement(SsaPanel, { ask: { kind: 'note' }, row, share, onClose: noop }))
    assert.ok(note.includes('Review draft') && note.includes('Notes on file'))
  })

  it('Actions is a menu — Add note, Copy e-mail, Call, the first client in Clients — and the switcher a listbox', () => {
    const clients = overviewOf(door('ssaProfileOverview', { ssa: KEY }).data).clients
    const menu = draw(createElement(ActionsMenu, { details: { email: row.email, phone: row.phone }, clients, write: true, onPick: noop, onDone: noop }))
    assert.match(menu, /role="menu"/)
    assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 4)
    for (const w of ['Add note', 'Copy e-mail', 'Call', 'Open first client in Clients']) assert.ok(menu.includes(w), w)
    assert.ok(menu.includes('href="tel:3305550102"') && menu.includes(`href="${CLIENTS_PATH}?client=annettekowal"`))
    const reader = draw(createElement(ActionsMenu, { details: { email: row.email, phone: row.phone }, clients, write: false, onPick: noop, onDone: noop }))
    assert.equal((reader.match(/role="menuitem"/g) ?? []).length, 3, 'a session that writes nothing is offered no Add note')
    assert.ok(!reader.includes('Add note') && !reader.includes('SSA actions'))
    const none = draw(createElement(ActionsMenu, { details: { email: '', phone: '' }, clients: [], write: true, onPick: noop, onDone: noop }))
    assert.equal((none.match(/disabled=""/g) ?? []).length, 3, 'an item with nothing behind it does nothing')
    const list = draw(createElement(SwitcherList, { ssas: [row, { ...row, key: 'ssa_patpast', name: 'Pat Past', status: 'inactive' }],
      current: KEY, query: '', onQuery: noop, inactive: { on: false, reading: false, why: '' }, onInactive: noop, onPick: noop }))
    assert.match(list, /role="listbox"/)
    assert.ok(list.includes('Denise Alvarez') && !list.includes('Pat Past'), 'the inactive only when asked')
  })
})

/* ---------- what crossed the wire ---------- */

describe('what crossed the wire', () => {
  it('every call carries only the parameters its door declares', async () => {
    S.packOpen = false
    await Promise.all([readRoster(true), readOverview(KEY), readDocuments(KEY), readActivity(KEY), readNotes(KEY)])
    await readDocFile(KEY, 'ispdoc000001')
    await addNote(KEY, 'One more')
    await readEdit(KEY).catch(() => null)
    await saveSsa(KEY, [{ field: 'phone', value: '330-555-0100', expected: '(330) 555-0102' }]).catch(() => null)
    await editDoc(KEY, 'isp_kennymarsh', [{ field: 'state', value: 'removed', expected: 'shown' }]).catch(() => null)
    await editActivity(KEY, 'record_kennymarsh', [{ field: 'title', value: 'Named SSA', expected: 'x' }]).catch(() => null)
    await saveSsaClients(KEY, ['annettekowal'], []).catch(() => null)
    const calls = seen.filter((s) => s.kind === 'gas')
    assert.deepEqual([...new Set(calls.map((c) => c.name))].sort(), [...GS.SSA_ACTIONS, ...PY_SSA].sort())
    const bad = calls.filter((c) => {
      const declared = Object.keys(GS.HUB_POLICY[c.name]?.params ?? PY_DOORS[c.name]?.params ?? {})
      return Object.keys(c.payload ?? {}).some((k) => !declared.includes(k))
    })
    assert.deepEqual(bad, [])
  })

  it('every SSA read and the pack are never stamped for a receipt; the note keeps its exactly-once receipt', () => {
    const listed = RELAY_NO_RECEIPT()
    for (const name of [...GS.SSA_ACTIONS, 'ssaPack']) {
      const lane = GS.HUB_POLICY[name]?.lane
      if (lane === 'write') assert.ok(!listed.has(name), `${name} keeps its receipt`)
      else assert.ok(listed.has(name), `${name} (${lane}) is in RELAY_NO_RECEIPT_ACTIONS`)
    }
    // Python's own doors answer in asa-hub-app's words: never a receipt of Apps Script's
    for (const name of PY_SSA) assert.ok(listed.has(name), `${name} (Python's) is in RELAY_NO_RECEIPT_ACTIONS`)
    assert.equal(GS.HUB_POLICY.ssaProfileNoteAdd.lane, 'write')
  })
})

/* ---------- rosterFrom stays pure ---------- */

describe('the lane-1 roster', () => {
  it('counts each client once, and a client with no SSA, or "N/A", names none', () => {
    const r = rosterFrom([...S.clients, S.clients[0]])
    assert.deepEqual(r.ssas.map((s) => [s.key, s.clients]), [['ssa_denisealvarez', 2], ['ssa_patpast', 1], ['ssa_samsupport', 1]])
    assert.equal(r.partial, false, '"N/A" is an answer, not a blank')
  })

  it('is partial only when a current client\'s row names no SSA at all', () => {
    const blank = (status: string) => ({ client_key: 'blank1', name: 'Blank One', status, ssa_name: '  ' })
    assert.equal(rosterFrom([...S.clients, blank('active')]).partial, true)
    assert.equal(rosterFrom([...S.clients, blank('')]).partial, true)
    assert.equal(rosterFrom([...S.clients, blank('inactive')]).partial, false)
    assert.equal(rosterOf(rosterFrom([blank('active')])).partial, true)
  })

  it('reads a client live as clientLive_ does: not archived, and a blank or active status', () => {
    const one = (status: string, archived = false) =>
      rosterFrom([{ client_key: 'una1', name: 'Una One', status, archived, ssa_name: 'Una Single' }]).ssas[0]?.status
    assert.equal(one(''), 'active')
    assert.equal(one(' Active '), 'active')
    assert.equal(one('inactive'), 'inactive')
    assert.equal(one('active', true), 'inactive', 'an archived client is never live')
    const shared = (second: string) => rosterFrom([
      { client_key: 'una1', name: 'Una One', status: 'inactive', ssa_name: 'Una Single' },
      { client_key: 'una2', name: 'Una Two', status: second, ssa_name: 'Una Single' },
    ]).ssas[0]?.status
    assert.equal(shared('active'), 'active', 'an SSA with another live client stays active')
    assert.equal(shared('inactive'), 'inactive', 'with no live client left the SSA is inactive')
  })
})

describe('Settings › My Work hides SSA › Documents from everyone but the master', () => {
  it('the section and its entry panel leave the reach; the master keeps both; unanswered reads as hidden', () => {
    const every = ssaReach('all', false, false)
    assert.ok(every.tabs.includes('documents'))
    const cut = withoutDocuments(every, false, true)
    assert.deepEqual(cut.tabs, every.tabs.filter((t) => t !== 'documents'))
    assert.equal(tabWithin('documents', cut), 'overview')
    assert.equal(askWithin({ kind: 'doc-edit', id: 'd1' } as SsaAsk, cut, false, false, { docs: true, activity: false }), null)
    assert.deepEqual(withoutDocuments(ssaReach('', false, true), true, true).tabs, ssaReach('', false, true).tabs)
    assert.equal(withoutDocuments(every, false, false), every)
    assert.equal(SHELL_HIDDEN.ssa_documents, true)
    assert.equal(shellHidesOf({}).ssa_documents, true, 'an answer that says nothing hides it')
    assert.equal(shellHidesOf({ ssa_documents: false }).ssa_documents, false)
  })
})
