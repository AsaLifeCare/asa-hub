/**
 * SUPPORT REQUESTS · the contract between the screen, My Inbox, My Calendar and their doors. Every call the lanes make
 * is caught at `fetch` and handed to Apps Script's own SupportDesk.gs — and to Scheduling.gs and SchedulingFlows.gs,
 * which it reads and answers through — run here over in-memory houses; the answer comes back as JSON and is read by
 * the screen's own model. A name, a parameter or a field that one side renames breaks here, not on the screen.
 *
 * Only the ground is stood in for (the houses, the accounts, the App Control gate, the hotline book, the call
 * transcripts, the phones, the send door, the clock). The helpers the files lean on are lifted whole out of their own
 * .gs files.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { gasAction } from '@/features/hiring/shared'
import { answerAct } from '@/pages/features/myinbox/AlertPanel'
import { fileAdd, isRouted, readVacationRoute } from '@/pages/features/mycalendar/useMyCalendar'
import {
  SUPPORT_DESK_ACTIONS, SUPPORT_DESK_LIVE_EVENT, adpAct, decide, forgetHeld, readBoard, readSeat,
} from '@/pages/features/supportdesk/supportDeskLane'
import { adpOpenHref, answerRow, isConflict, type Board, type Row as DeskRow } from '@/pages/features/supportdesk/supportDeskModel'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const NOW_MS = Date.parse('2026-10-01T15:00:00Z')
const BM = 'BM4060'

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

/** A function and every top-level helper of the same file it calls, each lifted whole. */
function liftDeep(file: string, name: string, seen = new Set<string>()): string[] {
  if (seen.has(name)) return []
  seen.add(name)
  const body = lift(file, name)
  const src = gsText(file)
  const more = [...new Set([...body.matchAll(/\b([A-Za-z_]\w*)\b/g)].map((m) => m[1]))]
    .filter((n) => n !== name && (src.includes(`\nfunction ${n}(`) || src.includes(`\nvar ${n} =`)))
  return [...more.flatMap((n) => liftDeep(file, n, seen)), body]
}

const TEXTS = [
  'SCHED_CALLOFF_HOUSE', 'SCHED_CALLOFF_EVERYONE', 'SCHED_SWAP_ASK', 'SCHED_SWAP_DECLINED_STAFF', 'SCHED_SWAP_DECLINED_MANAGER',
  'SCHED_SWAP_DECLINED_DIRECTOR', 'SCHED_SWAP_DONE', 'SCHED_REQUEST_DECIDED', 'SCHED_TIMEOFF_DECIDED',
  'SR_VEHICLE_REQUEST', 'SR_PAYROLL_REQUEST', 'SR_PUNCH_AWARE', 'SR_ADP_APPLIED',
].map((n) => `SMART_${n}_TEXT`)

const HELPERS: [string, string][] = [
  ['Clients.gs', 'clientNameKey_'], ['Profile.gs', 'hubNameFold_'], ['HubCore.gs', 'hubCellSafe_'],
  ['HubCore.gs', 'hubPhoneE164_'], ['HubCore.gs', 'hubDenied_'], ['Talent.gs', 'str_'], ['Talent.gs', 'SHARED_LINE_DIGITS'],
  ['Members.gs', 'hubActingUserId_'], ['Profile.gs', 'profileParsePhones_'], ['Profile.gs', 'profileParseEmails_'],
  ['StaffAlerts.gs', 'staffAlertLedgerKey_'], ['ContactGuard.gs', 'CG_NO_NAME_WORDS'], ['ContactGuard.gs', 'contactNameMissing_'],
  ['SmartComms.gs', 'smartRender_'], ['SmartComms.gs', 'smartList_'], ['SmartComms.gs', 'smartPruneUnfilled_'],
  ['SmartComms.gs', 'SMART_TELL_LEDGERED'], ['SmartComms.gs', 'smartTell_'], ['Packet.gs', 'packetSendableNumber_'],
  ['Rpc.gs', 'HUB_QUIET_FROM'], ['Rpc.gs', 'HUB_QUIET_TO'], ['Rpc.gs', 'hubQuietWords_'],
  ...TEXTS.map((n): [string, string] => ['SmartComms.gs', n]),
]
const DEEP: [string, string][] = [
  ['Hotline.gs', 'HOTLINE_CALL_OFF_TYPE'], ['Hotline.gs', 'hotlineRequestTypeKey_'], ['Hotline.gs', 'hotlineRequestTypeCallOffish_'],
]

/* ---------- the clock: one fixed instant, a weekday morning in Ohio ---------- */

class FixedDate extends Date {
  constructor(...a: [] | [string | number | Date]) {
    if (a.length === 0) super(NOW_MS)
    else super(a[0])
  }

  static now(): number { return NOW_MS }
}

function formatDate(date: Date, tz: string, pattern: string): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(date)
  if (pattern === 'yyyy-MM-dd') return `${part({ year: 'numeric' })}-${part({ month: '2-digit' })}-${part({ day: '2-digit' })}`
  if (pattern === 'HH:mm') return part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (pattern === 'h:mm a') return part({ hour: 'numeric', minute: '2-digit', hour12: true })
  if (pattern === 'EEE M/d') return `${part({ weekday: 'short' })} ${part({ month: 'numeric' })}/${part({ day: 'numeric' })}`
  if (pattern === 'EEEE') return part({ weekday: 'long' })
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/* ---------- the houses, in memory ---------- */

type Row = Record<string, string>
type Grid = string[][]

function sheetOf(grid: Grid) {
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => (grid[0] ?? []).length,
    getMaxRows: () => Math.max(grid.length, 1000),
    insertRowsAfter: () => {},
    deleteRow: (r: number) => { grid.splice(r - 1, 1) },
    getDataRange: () => ({ getValues: () => grid.map((line) => [...line]) }),
    getRange: (r: number, c: number, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => grid[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: (vals: unknown[][]) => {
        for (let i = 0; i < nr; i++) {
          while (grid.length < r + i) grid.push([])
          for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = String(vals[i][j] ?? '').replace(/^'/, '')
        }
      },
      setNumberFormat() { return this },
    }),
  }
}

type Sheet = ReturnType<typeof sheetOf>

const ACCOUNTS: Row[] = [
  { userid: 'USR_M', displayname: 'Master', email: 'master@example.org', role: 'admin', types: '', active: 'TRUE', phone: '' },
  { userid: 'USR_TY', displayname: 'Ty Bond', email: 'ty.bond@asalifecare.com', emails: '["ty.bond@abrighterdawninc.com"]',
    role: 'admin', types: 'DIRECTOR', active: 'TRUE', phone: '3305550105' },
  { userid: 'USR_BR', displayname: 'Brittany Anderson', email: 'brittfrench1316@gmail.com', role: 'staff', types: 'HM, STAFF',
    active: 'TRUE', phone: '3305550106' },
  { userid: 'USR_AR', displayname: 'Arthur Torres', email: 'arthur.torres@asalifecare.com', role: 'admin', types: '',
    active: 'TRUE', phone: '3309195559' },
  { userid: 'USR_WE', displayname: 'Wellington', email: 'admin@abrighterdawninc.com', role: 'admin', types: '', active: 'TRUE',
    phone: '3307544040' },
  { userid: 'USR_RB', displayname: 'Regina Bowman', email: 'regina@example.org', role: 'staff', types: 'HM, STAFF', active: 'TRUE' },
  { userid: 'USR_AN', displayname: 'Ann Roe', email: 'ann@example.org', role: 'staff', types: 'STAFF', active: 'TRUE' },
  { userid: 'USR_BE', displayname: 'Ben Left', email: 'ben@example.org', role: 'staff', types: 'STAFF', active: 'TRUE' },
  { userid: 'USR_JO', displayname: 'Joan Cheruiyot', email: 'joan@example.org', emails: '', role: 'staff', types: 'STAFF',
    active: 'TRUE', phone: '3305550133' },
  { userid: 'USR_NO', displayname: 'Noel Body', email: 'nobody@example.org', role: 'staff', types: 'STAFF', active: 'TRUE' },
]
const session = (uid: string): Row => {
  const a = ACCOUNTS.find((x) => x.userid === uid)!
  return { id: a.userid, email: a.email, display_name: a.displayname, role: a.role }
}
const MASTER = session('USR_M')
const TY = session('USR_TY')
const BRIT = session('USR_BR')
const ARTHUR = session('USR_AR')
const ANN = session('USR_AN')
const NOBODY = session('USR_NO')
const account = (uid: string) => ACCOUNTS.find((x) => x.userid === uid)!

const PHONES: Record<string, string> = { reginabowman: '3305550101', annroe: '3305550102', benleft: '3305550103' }

type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; params?: Record<string, unknown>; emits?: string[] }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => unknown>
  SCHED_HEADERS: Record<string, string[]>
  SD_HEADERS: Record<string, string[]>
  SD_ACTIONS: string[]
  MYWORK_AUTO_KEYS: Record<string, string>
  schedMemoDrop_: () => void
  sdMemoDrop_: () => void
  schedRowId_: (house: string, rowId: string) => string
  schedCellRow_: (house: string, rowId: string, date: string, text: string, extra?: Row) => Record<string, unknown>
  sdQueueAll_: () => { ref: string; row: Row }[]
  supportDeskAttendance_: (work: unknown[], today: string) => Record<string, number>
  supportDeskFiled_: (rows: Row[], ctx: Record<string, string>) => Record<string, number>
}

let tabs: Record<string, Sheet> = {}
let cache = new Map<string, string>()
let props = new Map<string, string>()
let cfg: Record<string, string> = {}
let queue: Row[] = []
let transcripts: Record<string, Row> = {}
let sent: { to: string; body: string; reason: string; key: string }[] = []

function boot(): Gs {
  const g: Record<string, unknown> = {
    console, JSON, Math, Date: FixedDate, String, Number, Boolean, Array, Object, RegExp, isNaN, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {}, HUB_MEMBER_CTX: null, SMART_LEAD_KEY: '__lead', SMART_SENDER_DEFAULT: 'ASA Lifecare',
    Utilities: {
      formatDate,
      DigestAlgorithm: { SHA_1: 'SHA_1', SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (algo: string, text: string) =>
        [...createHash(algo === 'SHA_1' ? 'sha1' : 'sha256').update(String(text), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => (cache.has(k) ? cache.get(k) : null),
        put: (k: string, v: string) => { cache.set(k, String(v)) },
        remove: (k: string) => { cache.delete(k) },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (props.has(k) ? props.get(k) : null),
        setProperty: (k: string, v: string) => { props.set(k, String(v)) },
        deleteProperty: (k: string) => { props.delete(k) },
      }),
    },
    // App Control: Scheduling and the new app open to every account with a row; the one without gets the closed gate
    hubProfileAppGate_: (app: string, u: Row | null) => ((app === 'scheduling' || app === 'support-desk') && u &&
      u.email !== 'nobody@example.org'
      ? { open: true, scope: { kind: u.email === 'master@example.org' ? 'master' : 'all' } } : { open: false, scope: { kind: 'none' } }),
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'master@example.org',
    hubSchedHoursHidden_: () => true,
    hubTestModeState_: () => ({ on: true }),
    hubTestModeUnknownWhy_: () => 'unknown word',
    hubQuietAt_: () => false,
    hubSysLog_: () => true,
    houseMoved_: (tab: string) => Boolean(tabs[tab]),
    hubTabEnsure_: (tab: string) => {
      if (!tabs[tab]) throw new Error(`no house ${tab}`)
      return tabs[tab]
    },
    ensureHeader_: (sheet: Sheet) => [...(sheet.grid[0] ?? [])],
    sheetDbGateHolds_: () => null,
    cellText_: (v: unknown) => String(v ?? ''),
    usersAll_: () => ACCOUNTS.map((a) => ({ ...a })),
    userByEmail_: (email: string) => {
      const want = String(email).toLowerCase()
      const a = ACCOUNTS.find((x) => x.email === want || String(x.emails ?? '').toLowerCase().includes(`"${want}"`))
      return a ? { ...a } : null
    },
    userBadgesWorn_: (types: string, role: string) => [...String(types ?? '').split(/[,\s]+/), String(role ?? '').toUpperCase()]
      .filter(Boolean),
    certPicture_: () => ({}),
    commBroadcastPeople_: () => ({
      readable: true, onStaff: { active: true },
      byKey: Object.fromEntries(Object.entries(PHONES).map(([k, phone]) => [k, { phone, status: 'active' }])),
    }),
    SMART_TO_KEYWORDS: {
      allstaff: {
        resolve: () => ({ readable: true, why: '', people: Object.entries(PHONES).map(([k, phone]) => ({ person_key: k, name: k, phone })) }),
      },
    },
    smartSituationOn_: (id: string) => {
      const name = `SMART_${id.toUpperCase()}_TEXT`
      return typeof GS[name] === 'string' ? { id, channels: 'sms', sms_text: GS[name], sender: 'ASA Lifecare' } : null
    },
    hubSituationRead_: () => ({ row: null, on: false, unreadable: '' }),
    smartUnwrittenWords_: () => false,
    smartRehearsalKey_: (key: string) => `REHEARSAL|${key}`,
    smartRecord_: () => true,
    HUB_REHEARSAL_CTX: null,
    COMM_MOCK_CTX: null,
    SpreadsheetApp: { flush: () => {} },
    rpcCall_: (method: string, params: Row, opts: Row) => {
      assert.equal(method, 'smsSend')
      sent.push({ to: params.to, body: params.body, reason: params.reason, key: opts.idempotency_key })
      return { ok: true, rehearsed: true }
    },
    locationsHomes_: () => [{ code: BM, address: '908 Arlington Ave NW' }],
    mailPlatformUrl_: () => 'https://hub.example.org',
    reconCalendarLinks_: () => [],
    ssOpen_: () => { throw new Error('the book is not shared with this account') },
    istConfig_: () => ({}),
    istConfigSource_: () => 'sheet',
    istCfgChoice_: () => 'house',
    istCfgInt_: () => 0,
    istOhioToday_: () => '2026-10-01',
    listRows_: () => [],
    houseIdFor_: () => '',
    hubGrantReader_: () => false,
    // the hotline book (Estate.gs) and the settings tab the switches live in (AlertsConfig.gs)
    estateRows_: (resource: string) => (resource === 'supportQueue' ? queue.map((r) => ({ ...r })) : []),
    estateSource_: () => null,
    cacheVersion_: () => '',
    cacheScopeSheet_: () => '',
    hiringAlerts_: () => ({ ...cfg }),
    hubMyWorkHideDefaults_: () => ({}),
    // who called (ContactGuard.gs) and what the call said (CommCalls.gs)
    contactPhoneWho_: (phone: string) => (String(phone).replace(/\D/g, '').endsWith('3305550133')
      ? { state: 'sole', name: 'Joan Cheruiyot', why: 'one person' } : { state: 'none', name: '', why: 'nobody holds it' }),
    contactGuard_: () => null,
    commCallsTranscriptRead_: (id: string) => (transcripts[id]
      ? { status: 200, data: { ...transcripts[id] } } : { status: 404, message: 'no transcript on file for that call' }),
  }
  const ctx = vm.createContext(g)
  vm.runInContext([...HELPERS.map(([file, name]) => lift(file, name)),
    ...DEEP.flatMap(([file, name]) => liftDeep(file, name))].join('\n'), ctx)
  for (const f of ['Scheduling.gs', 'SchedulingFlows.gs', 'SupportDeskSwitches.gs', 'SupportDesk.gs']) vm.runInContext(gsText(f), ctx)
  return ctx as unknown as Gs
}

const GS = boot()

/** Scheduling's houses as the seed leaves them, the four Support Requests houses empty (their defaults stand). */
function freshHouses(): void {
  tabs = {}
  for (const [tab, header] of Object.entries(GS.SCHED_HEADERS)) tabs[tab] = sheetOf([[...header]])
  for (const [tab, header] of Object.entries(GS.SD_HEADERS)) tabs[tab] = sheetOf([[...header]])
  const put = (tab: string, row: Record<string, unknown>) =>
    tabs[tab].grid.push(GS.SCHED_HEADERS[tab].map((h) => String(row[h] ?? '')))
  put('sched_settings', { key: 'houses', value: JSON.stringify([{ code: BM, location: 'CAN - BM - BM4060', short: 'BM' }]) })
  put('sched_settings', { key: 'periods', value: JSON.stringify([{ id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' }]) })
  put('sched_settings', { key: 'directors', value: 'ty.bond@asalifecare.com, brittfrench1316@gmail.com' })
  const rows: [string, string, string, string][] = [
    ['P:reginabowman', 'person', 'Regina Bowman', '**'], ['P:annroe', 'person', 'Ann Roe', ''],
    ['P:benleft', 'person', 'Ben Left', ''], ['OPEN:1', 'open', 'OPEN', ''],
  ]
  rows.forEach(([rowId, kind, name, designation], i) => put('sched_rows', {
    id: GS.schedRowId_(BM, rowId), house_code: BM, location: 'CAN - BM - BM4060', row_id: rowId, row_kind: kind, name,
    person_key: kind === 'person' ? rowId.slice(2) : '', designation, order: String(i + 1), active: 'yes', source: 'seed:test',
  }))
  GS.schedMemoDrop_()
  for (const [rowId, date, text] of [['P:annroe', '2026-10-02', '8A-4P'], ['P:annroe', '2026-10-20', '8A-4P']]) {
    put('sched_cells', GS.schedCellRow_(BM, rowId, date, text, {}))
  }
  GS.schedMemoDrop_()
}

const rowsOf = (tab: string): Row[] => {
  const [header, ...lines] = tabs[tab].grid
  return lines.map((line) => Object.fromEntries(header.map((h, i) => [h, String(line[i] ?? '')])))
}

/* ---------- the hotline book ---------- */

const VEHICLE: Row = {
  id: 'r2', status: 'New', urgency: 'High', date_received: '2026-09-30T15:04:00Z', requestor: 'Ann Roe',
  requestor_phone: '3305550102', type_of_request: 'Operations - Vehicle Issue',
  description_of_request: 'Van broke down on Route 62, stranded with client', notes: 'Call ID: ACaaa111', processed: '',
}
const PAYROLL: Row = {
  id: 'r3', status: 'New', urgency: 'Mid', date_received: '9/29/2026', requestor: 'Ben Left', requestor_phone: '3305550103',
  type_of_request: 'Payroll', description_of_request: 'Missing paycheck for last week', notes: '', processed: '',
}
const GENERAL: Row = {
  id: 'r4', status: 'Pending', urgency: 'Low', date_received: '2026-09-28', requestor: 'Regina Bowman',
  requestor_phone: '3305550101', type_of_request: 'Other - General Requests',
  description_of_request: 'Locker key for the BM house', notes: '', processed: '',
}
const adpRow = (id: string, desc: string, callId: string): Row => ({
  id, status: 'New', urgency: 'Low', date_received: '2026-10-01T13:00:00Z', requestor: 'Joan Cheruiyot',
  requestor_phone: '3305550133', type_of_request: 'ADP - Update Information', description_of_request: desc,
  notes: `Call ID: ${callId}`, processed: '',
})

/* ---------- the screen's calls, answered by the doors ---------- */

type Out = { status: number; data?: Record<string, unknown>; message?: string }
const calls: { action: string; payload: Record<string, unknown> }[] = []
const undeclared: string[] = []
const realFetch = globalThis.fetch
// the session every door is asked as
let AS: Row = MASTER

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload?: Record<string, unknown> }
    const payload = env.payload ?? {}
    calls.push({ action: env.action, payload })
    // the door takes only what it declares
    const declared = GS.HUB_POLICY[env.action]?.params ?? {}
    for (const k of Object.keys(payload)) if (!(k in declared)) undeclared.push(`${env.action}.${k}`)
    // every request is its own execution: nothing read for the last one is held
    GS.schedMemoDrop_()
    GS.SCHED_BOARD_MEMO = {}
    GS.sdMemoDrop_()
    const door = GS.HUB_ACTIONS[env.action]
    const out = (door ? door(JSON.parse(JSON.stringify(payload)), { ...AS }) : { status: 404, message: 'Unknown action.' }) as Out
    return new Response(JSON.stringify(out))
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = realFetch
  assert.deepEqual(undeclared, [], 'every parameter a screen sends is one its door declares')
})
beforeEach(() => {
  cache = new Map()
  props = new Map()
  cfg = {}
  sent = []
  transcripts = {}
  queue = [VEHICLE, PAYROLL, GENERAL]
  AS = MASTER
  forgetHeld()
  freshHouses()
  GS.sdMemoDrop_()
})

const as = async <T>(who: Row, fn: () => Promise<T>): Promise<T> => {
  AS = who
  return fn()
}
/** An answer out of the Apps Script realm, as plain data. */
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v))
const switchOn = (...parts: string[]) => { for (const p of parts) cfg[GS.MYWORK_AUTO_KEYS[p]] = 'yes' }
/** A refusal as the screen receives it: the door's status on the error, and its sentence as the message. */
const refusal = (status: number, said?: string | RegExp) => (e: unknown): boolean => {
  const err = e as Error & { status?: number }
  return err.status === status && (said === undefined || (typeof said === 'string' ? err.message === said : said.test(err.message)))
}
const refOf = (row: Row) => GS.sdQueueAll_().find((q) => q.row.id === row.id)!.ref
const rowIn = (b: Board, ref: string): DeskRow => {
  const r = b.rows.find((x) => x.ref === ref)
  assert.ok(r, `the list has ${ref}`)
  return r
}

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

/* ---------- the names ---------- */

describe('the names', () => {
  it('every Support Requests door a screen names is declared with a handler, and every one has its caller', () => {
    const named = new Set<string>()
    for (const f of [...walk('src/pages/features/supportdesk'), ...walk('src/pages/features/myinbox'), ...walk('src/pages/features/mycalendar')]) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) {
        if (GS.HUB_POLICY[m[1]]?.file === 'SupportDesk.gs') named.add(m[1])
      }
    }
    const declared = Object.keys(GS.HUB_POLICY).filter((a) => GS.HUB_POLICY[a].file === 'SupportDesk.gs')
    assert.deepEqual([...GS.SD_ACTIONS].sort(), [...declared].sort())
    for (const a of declared) assert.equal(typeof GS.HUB_ACTIONS[a], 'function', `${a} has a handler`)
    for (const a of SUPPORT_DESK_ACTIONS) assert.ok(named.has(a), `the screen calls ${a}`)
    // the relay posts the punch board's faults; the master's settings door is answered for the master alone
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    assert.match(relay, /"action": "supportDeskPunch"/)
    assert.deepEqual([...named, 'supportDeskPunch', 'supportDeskSettingsSet'].sort(), [...declared].sort(),
      'every declared door is called by a screen, by the relay, or is the master\'s settings door')
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of declared) assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
    assert.deepEqual(declared.filter((a) => GS.HUB_POLICY[a].lane === 'read').sort(), ['myCalendarVacationRoute', 'supportDeskList', 'supportDeskSeat'])
  })

  it('the list and the route are never kept as relay receipts; every write rings the screen', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    for (const a of ['supportDeskList', 'supportDeskSeat', 'myCalendarVacationRoute']) assert.ok(line.includes(`"${a}"`), a)
    for (const a of ['supportDeskDecide', 'supportDeskAdp', 'supportInboxAnswer', 'myCalendarVacationFile']) {
      assert.ok(!line.includes(`"${a}"`), a)
    }
    assert.equal(/^SUPPORT_DESK_EVENT = "([^"]+)"/m.exec(relay)?.[1], SUPPORT_DESK_LIVE_EVENT)
    const writes = /^_SUPPORT_DESK_WRITES = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    for (const a of ['supportDeskDecide', 'supportDeskAdp', 'supportDeskSettingsSet', 'supportInboxAnswer', 'myCalendarVacationFile']) {
      assert.ok(writes.includes(`"${a}"`), `${a} rings ${SUPPORT_DESK_LIVE_EVENT}`)
    }
  })

  it('the two apps carry their two names everywhere they show', () => {
    const reg = (f: string) => readFileSync(resolve(ROOT, 'src/registry', f), 'utf8')
    assert.match(reg('apps-requests.ts'), /id: 'support-requests',\s*name: 'Support Requests Queue'/)
    assert.match(reg('apps-support-desk.ts'), /name: 'Support Requests'/)
    const inbox = readFileSync(resolve(ROOT, 'server/my_inbox.py'), 'utf8')
    assert.match(inbox, /\("Support Requests Queue", "support-requests"\)/)
    assert.match(inbox, /\("Support Requests", "support-desk"\)/)
    assert.match(readFileSync(resolve(ROOT, 'server/my_work.py'), 'utf8'), /"label": "Open in Support Requests Queue"/)
    // My Inbox answers through the doors it names, by these literal names
    assert.match(inbox, /"supportInboxAnswer"/)
    assert.match(inbox, /"schedulingAnswer"/)
  })
})

/* ---------- the gate ---------- */

describe('the gate', () => {
  it('an account with no App Control row is answered 404, before anything is read or written', async () => {
    AS = NOBODY
    await assert.rejects(readBoard(false), refusal(404, 'Unknown action.'))
    await assert.rejects(decide(refOf(VEHICLE), 'approve'), refusal(404, 'Unknown action.'))
    await assert.rejects(adpAct(refOf(VEHICLE), 'approve', 'ABCDEF0123'), refusal(404, 'Unknown action.'))
    assert.equal(rowsOf('support_decisions').length, 0)
  })

  it('a lead sees only what is routed to the leads; someone else the gate lets in sees nothing, and is told why', async () => {
    const lead = await as(ARTHUR, () => readBoard(false))
    assert.deepEqual(lead.rows.map((r) => r.ref), [refOf(GENERAL)])
    assert.equal(lead.viewer.is_lead, true)
    const staff = await as(ANN, () => readBoard(false))
    assert.deepEqual([staff.rows.length, staff.note], [0, 'Requests are shown to the directors.'])
  })

  it('the master reads every row and decides a queue row as a director does, recorded as the master\'s', async () => {
    const b = await readBoard(false)
    assert.equal(b.viewer.can_decide, true)
    const v = rowIn(b, refOf(VEHICLE))
    assert.deepEqual([v.may.approve, v.may.deny, v.may.resolve], [true, true, true])
    const done = await decide(v.ref, 'approve', 'Handled by phone')
    assert.equal(answerRow(done)?.status.word, 'Approved')
    assert.deepEqual(rowsOf('support_decisions').map((d) => [d.verdict, d.by_uid]), [['approved', 'USR_M']])
    const lead = await as(ARTHUR, () => decide(refOf(GENERAL), 'approve')).catch((e: unknown) => e)
    assert.ok(lead instanceof Error)
  })
})

/* ---------- the walks ---------- */

describe('a queue row, answered here', () => {
  it('Approve, Deny and Resolve with a note; a different verdict after one is 409, the same one changes nothing', async () => {
    const b = await as(TY, () => readBoard(false))
    const vehicle = rowIn(b, refOf(VEHICLE))
    assert.deepEqual([vehicle.type.display, vehicle.urgency, vehicle.requestor.name, vehicle.status.tone],
      ['Operations · Vehicle Issue', 'High', 'Ann Roe', 'new'])
    assert.ok(vehicle.details.some((d) => d.label === 'Call ID' && d.value === 'ACaaa111'))
    assert.ok(!JSON.stringify(b).includes('3305550102'), 'the caller\'s number never leaves Apps Script')
    assert.deepEqual([vehicle.may.approve, vehicle.may.deny, vehicle.may.resolve], [true, true, true])

    const approved = await decide(vehicle.ref, 'approve', 'Van booked for the shop')
    assert.equal(approved.changed, true)
    const row = answerRow(approved)!
    assert.deepEqual([row.status.word, row.status.tone, row.completed], ['Approved', 'approved', true])
    assert.deepEqual(row.history.map((h) => [h.verdict, h.by, h.note, h.via]), [['approved', 'Ty Bond', 'Van booked for the shop', 'support-desk']])

    const again = await as(BRIT, () => decide(vehicle.ref, 'approve'))
    assert.deepEqual([again.changed, again.said], [false, 'Already approved by Ty Bond.'])
    const conflict = await as(BRIT, () => decide(vehicle.ref, 'deny', 'Wrong van')).catch((e: unknown) => e)
    assert.ok(isConflict(conflict))
    assert.match((conflict as Error).message, /^Already approved by Ty Bond at /)

    const denied = await as(BRIT, () => decide(refOf(PAYROLL), 'deny', 'Paid on the 25th'))
    assert.deepEqual([answerRow(denied)?.status.word, answerRow(denied)?.history[0].note], ['Denied', 'Paid on the 25th'])
    const resolved = await as(TY, () => decide(refOf(GENERAL), 'resolve', 'Key left at the office'))
    assert.equal(answerRow(resolved)?.status.word, 'Resolved')

    const lines = rowsOf('support_decisions')
    assert.deepEqual(lines.map((d) => [d.ref, d.verdict, d.by_uid, d.source]), [
      [vehicle.ref, 'approved', 'USR_TY', 'queue'], [refOf(PAYROLL), 'denied', 'USR_BR', 'queue'],
      [refOf(GENERAL), 'resolved', 'USR_TY', 'queue'],
    ])
    assert.deepEqual(JSON.parse(lines[0].witness), { row: 2, requestor: 'Ann Roe', type: 'Operations - Vehicle Issue',
      call_id: 'ACaaa111', date_received: '2026-09-30T15:04:00Z' })
    const open = await as(TY, () => readBoard(false))
    assert.deepEqual(open.rows.filter((r) => r.source === 'queue'), [], 'answered rows leave the open list')
    const all = await as(TY, () => readBoard(true))
    assert.equal(all.counts.completed, 3)
  })
})

describe('Redirect: a request handed to one account, answered from its My Work', () => {
  it('refuses yourself, an unknown account or nobody; lands as "Redirected to"; the holder reads and answers it through its seat', async () => {
    const b = await as(TY, () => readBoard(false))
    const payroll = rowIn(b, refOf(PAYROLL))
    assert.equal(payroll.may.redirect, true)
    assert.ok(b.people.some((p) => p.uid === 'USR_NO') && !b.people.some((p) => p.uid === 'USR_TY'), 'the people, the viewer left out')
    await assert.rejects(as(TY, () => decide(payroll.ref, 'redirect', '', 'USR_TY')),
      refusal(400, 'Redirect it to someone else — it is already yours to answer.'))
    await assert.rejects(as(TY, () => decide(payroll.ref, 'redirect', '', 'USR_GONE')), refusal(400, /not a live account/))
    await assert.rejects(as(TY, () => decide(payroll.ref, 'redirect')), refusal(400, 'Choose who to redirect it to.'))
    assert.deepEqual(rowsOf('support_decisions'), [], 'a refused redirect records nothing')

    const r = await as(TY, () => decide(payroll.ref, 'redirect', 'Can you check his stubs?', 'USR_NO'))
    assert.equal(r.said, 'Redirected to Noel Body — it waits in their My Work.')
    assert.deepEqual(calls[calls.length - 1]?.payload, { ref: payroll.ref, verdict: 'redirect', note: 'Can you check his stubs?', to: 'USR_NO' })
    const row = answerRow(r)!
    assert.deepEqual([row.status.word, row.completed, row.waiting_on], ['Redirected to Noel Body', false, ['Noel Body']])
    assert.deepEqual(row.history.map((h) => [h.verdict, h.to, h.by, h.note]), [['redirected', 'Noel Body', 'Ty Bond', 'Can you check his stubs?']])
    const item = rowsOf('support_inbox').find((i) => i.box === 'work')!
    assert.deepEqual([item.to_uid, item.state, item.kind, item.ref, item.note],
      ['USR_NO', 'waiting', 'redirect', payroll.ref, 'Redirected by Ty Bond: Can you check his stubs?'])

    // Noel's App Control gate is shut: the list stays shut, the seat opens his one request
    await assert.rejects(as(NOBODY, () => readBoard(false)), refusal(404))
    const seat = await as(NOBODY, () => readSeat(payroll.ref))
    assert.equal(seat.row?.ref, payroll.ref)
    assert.deepEqual(seat.row && [seat.row.may.approve, seat.row.may.deny, seat.row.may.resolve, seat.row.may.redirect], [true, true, true, true])
    assert.ok(seat.people.length > 0 && !seat.people.some((p) => p.uid === 'USR_NO'))
    await assert.rejects(as(NOBODY, () => readSeat(refOf(VEHICLE))), refusal(404))
    const done = await as(NOBODY, () => decide(payroll.ref, 'approve', 'Stub re-sent'))
    assert.equal(done.changed, true)
    assert.equal(rowsOf('support_inbox').find((i) => i.id === item.id)?.state, 'approved')

    const late = await as(BRIT, () => decide(payroll.ref, 'redirect', '', 'USR_AN')).catch((e: unknown) => e)
    assert.ok(isConflict(late), 'a redirect after the final verdict is the 409 law')
    const hist = rowIn(await as(TY, () => readBoard(true)), payroll.ref).history.map((h) => [h.verdict, h.to ?? '', h.by])
    assert.deepEqual(hist, [['redirected', 'Noel Body', 'Ty Bond'], ['approved', '', 'Noel Body']])
  })
})

describe('a Scheduling call-off and time off, decided here through Scheduling\'s own door', () => {
  it('the call-off warning "I\'m aware" is Scheduling\'s "seen" on the director\'s own item', async () => {
    await as(ANN, () => gasAction('schedulingCallOff', { house: BM, row_id: 'P:annroe', date: '2026-10-02', reason: 'flu' }))
    const b = await as(TY, () => readBoard(false))
    const row = b.rows.find((r) => r.source === 'scheduling' && r.kind === 'call_off')
    assert.ok(row, JSON.stringify(b.rows.map((r) => [r.source, r.kind])))
    assert.equal(row.type.raw, 'Schedule - Call Off')
    assert.deepEqual(row.sched?.words, ['seen'])
    assert.equal(row.may.aware, true)
    const item = rowsOf('sched_inbox').find((r) => r.to_uid === 'USR_TY' && r.kind === 'warning')!
    assert.equal(row.sched?.item_id, item.id)

    calls.length = 0
    const a = await as(TY, () => decide(row.ref, 'aware'))
    assert.equal(a.ok, true)
    assert.deepEqual(calls.map((c) => c.action), ['supportDeskDecide'], 'the screen asks one door; the server delegates')
    const after = rowsOf('sched_inbox').find((r) => r.id === item.id)!
    assert.ok(after.answered_at, 'Scheduling\'s own item carries the answer')
    assert.deepEqual(rowsOf('support_decisions').filter((d) => d.ref === row.ref && d.verdict !== 'note'), [],
      'no verdict on a Scheduling flow is written in Support Requests')
    const brit = await as(BRIT, () => readBoard(false))
    assert.equal(brit.rows.find((r) => r.ref === row.ref)?.may.aware, true, 'each director marks their own')
  })

  it('a time off Approve is Scheduling\'s approve, the note kept as Support Requests\' annotation', async () => {
    await as(ANN, () => gasAction('schedulingTimeOff', { from: '2026-10-20', to: '2026-10-21', reason: 'family trip' }))
    const b = await as(TY, () => readBoard(false))
    const row = b.rows.find((r) => r.source === 'scheduling' && r.kind === 'time_off')!
    assert.ok(row)
    assert.deepEqual(row.sched?.words, ['approve', 'decline'])
    assert.ok(!JSON.stringify(row.details).includes('family trip'), 'a time-off reason is never a detail')
    const a = await as(TY, () => decide(row.ref, 'approve', 'Covered by Ben'))
    assert.equal(a.changed, true)
    const flow = rowsOf('sched_flows').find((f) => f.id === row.ref)!
    assert.match(flow.state, /^approved/)
    assert.deepEqual(rowsOf('support_decisions').filter((d) => d.ref === row.ref).map((d) => [d.verdict, d.note]),
      [['note', 'Covered by Ben']])
    await assert.rejects(as(BRIT, () => decide(row.ref, 'deny')), (e: unknown) => /approved|waiting/i.test((e as Error).message))
  })
})

describe('a Late Show warning, marked aware by both directors', () => {
  it('raised once, worded until every director has marked it; one from the panel, one from My Inbox', async () => {
    const work = [{ kind: 'late_show', row: { person: 'Ann Roe', day: '2026-10-01', house: BM, shift_code: '8A-4P' } }]
    assert.deepEqual(plain(GS.supportDeskAttendance_(work, '2026-10-01')), { off: true }, 'the switch ships off')
    switchOn('late_show')
    assert.equal(GS.supportDeskAttendance_(work, '2026-10-01').raised, 1)
    assert.equal(GS.supportDeskAttendance_(work, '2026-10-01').already, 1, 'the same shift is raised once')
    const items = rowsOf('support_inbox')
    assert.deepEqual(items.map((i) => [i.to_uid, i.kind, i.seat]).sort(), [['USR_BR', 'warning', 'director'], ['USR_TY', 'warning', 'director']])

    const b = await as(TY, () => readBoard(false))
    const row = b.rows.find((r) => r.kind === 'late_show')!
    assert.deepEqual([row.status.word, row.status.tone, row.may.aware, row.type.display],
      ['Directors, are you aware?', 'warning', true, 'Attendance · Late Show'])
    assert.equal(b.counts.warnings, 1)
    const lead = await as(ARTHUR, () => readBoard(false))
    assert.ok(!lead.rows.some((r) => r.kind === 'late_show'), 'a Late Show is the directors\'')

    const ty = await as(TY, () => decide(row.ref, 'aware'))
    assert.equal(answerRow(ty)?.status.word, 'Directors, are you aware?', 'still waiting on Brittany')
    const tyItem = rowsOf('support_inbox').find((i) => i.to_uid === 'USR_TY')!
    assert.ok(tyItem.answered_at)

    const britItem = items.find((i) => i.to_uid === 'USR_BR')!
    await assert.rejects(as(TY, () => answerAct({ kind: 'aware', action: 'supportInboxAnswer', item_id: britItem.id,
      label: 'I\'m aware', done: false, by: '', at: '' })), refusal(403))
    const said = await as(BRIT, () => answerAct({ kind: 'aware', action: 'supportInboxAnswer', item_id: britItem.id,
      label: 'I\'m aware', done: false, by: '', at: '' }))
    assert.equal(said.changed, true)
    const after = await as(TY, () => readBoard(true))
    const done = after.rows.find((r) => r.ref === row.ref)!
    assert.deepEqual([done.status.tone, done.completed], ['aware', true])
    assert.match(done.status.word, /^Aware — Ty .* · Brittany /)
    assert.deepEqual(done.acks.map((x) => x.uid).sort(), ['USR_BR', 'USR_TY'])
  })
})

describe('ADP · Update Information', () => {
  it('an address read back and confirmed is applied by itself: the directors are told the field, never the value', async () => {
    switchOn('adp_update')
    const row = adpRow('r5', 'New address', 'ACddd444')
    queue = [row]
    transcripts.ACddd444 = { call_id: 'ACddd444', speaker_transcript: '',
      full_transcript: 'So your new home address is 42 Oak Street, Canton. Is that correct? Yes it is.' }
    assert.equal(GS.supportDeskFiled_([row], {}).routed, 1)
    const b = await as(TY, () => readBoard(false))
    const r = rowIn(b, refOf(row))
    assert.deepEqual([r.kind, r.adp?.state, r.adp?.field], ['adp', 'applied', 'address'])
    assert.deepEqual(rowsOf('support_inbox').map((i) => i.title),
      ['Update information from Joan Cheruiyot applied automatically', 'Update information from Joan Cheruiyot applied automatically'])
    assert.ok(sent.length > 0 && sent.every((s) => !s.body.includes('Oak')), JSON.stringify(sent))
  })

  it('a new e-mail is prepared, never written here: Approve records it and opens the profile with it filled in', async () => {
    switchOn('adp_update')
    const row = adpRow('r6', 'New e-mail', 'ACeee555')
    queue = [row]
    transcripts.ACeee555 = { call_id: 'ACeee555', full_transcript: '', speaker_transcript:
      '[0:12] agent: I have the new email address as joan.new@example.com. Is that correct?\n[0:15] +13305550133: Yes.' }
    assert.equal(GS.supportDeskFiled_([row], {}).routed, 1)
    const b = await as(TY, () => readBoard(false))
    const r = rowIn(b, refOf(row))
    assert.deepEqual([r.adp?.state, r.adp?.field, r.adp?.words], ['ready', 'email', 'Add joan.new@example.com to Joan Cheruiyot\'s e-mails'])
    assert.ok(r.adp?.proof)
    const before = JSON.stringify(ACCOUNTS)

    await assert.rejects(as(TY, () => adpAct(r.ref, 'approve', 'ABCDEF0123')), refusal(409))
    // the master holds every director seat: past the seat, a stale proof is what refuses it
    await assert.rejects(as(MASTER, () => adpAct(r.ref, 'approve', 'ABCDEF0123')), refusal(409))
    const a = await as(TY, () => adpAct(r.ref, 'approve', r.adp!.proof))
    assert.equal(a.changed, true)
    assert.equal(adpOpenHref(a), '/app/users/profile?u=USR_JO&contacts=1&add_email=joan.new%40example.com')
    assert.equal(JSON.stringify(ACCOUNTS), before, 'no account is written by this door')
    assert.deepEqual(rowsOf('support_decisions').map((d) => [d.verdict, d.by_uid]), [['approved', 'USR_TY']])
    const again = await as(BRIT, () => adpAct(r.ref, 'approve', r.adp!.proof))
    assert.deepEqual([again.changed, adpOpenHref(again)], [false, adpOpenHref(a)])

    // the profile's own Save (userUpdate) writes it; the list reads the account and says applied
    const joan = account('USR_JO')
    joan.emails = '["joan.new@example.com"]'
    try {
      const saved = await as(TY, () => readBoard(true))
      assert.equal(rowIn(saved, r.ref).adp?.state, 'applied')
    } finally {
      joan.emails = ''
    }
  })
})

describe('My Calendar: your own vacation, filed into Scheduling when the switch is on', () => {
  it('off: the route says so and nothing is filed there; on: the ask lands as a Scheduling time off from My Calendar', async () => {
    const off = await as(ANN, () => readVacationRoute())
    assert.equal(off.on, false)
    switchOn('time_off')
    const on = await as(ANN, () => readVacationRoute())
    assert.deepEqual([on.on, on.readable, on.mine], [true, true, []])
    const filed = await as(ANN, () => fileAdd('2026-10-20', '2026-10-21', 'family trip'))
    assert.ok(isRouted(filed))
    const flow = rowsOf('sched_flows').find((f) => f.kind === 'time_off')!
    assert.deepEqual([flow.source_ref, flow.person_key, filed.ref], ['my-calendar', 'annroe', flow.id])
    const mine = await as(ANN, () => readVacationRoute())
    assert.deepEqual(mine.mine.map((m) => [m.flow_id, m.from, m.to]), [[flow.id, '2026-10-20', '2026-10-21']])
    AS = { ...ANN, visiting_member: 'USR_BE' }
    await assert.rejects(gasAction('myCalendarVacationFile', { from: '2026-10-27', to: '2026-10-28' }),
      refusal(403, /^Ask from your own account/))
    assert.equal(rowsOf('sched_flows').filter((f) => f.kind === 'time_off').length, 1, 'nothing filed while visiting')
  })
})
