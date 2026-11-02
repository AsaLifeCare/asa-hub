/**
 * SCHEDULING · the contract between the screen, My Work and their doors. Every call the screen's lane makes (and My
 * Work's Approve / Decline) is caught at `fetch` and handed to Apps Script's own Scheduling.gs and SchedulingFlows.gs,
 * run here over in-memory houses; the answer comes back as JSON and is read by the screen's own model. A name, a
 * parameter or a field that one side renames breaks here, not on the screen.
 *
 * Only the ground is stood in for (the six houses, the accounts, the App Control gate, the certificates, the phones,
 * the send door, the clock). The small helpers the two files lean on are lifted whole out of their own .gs files.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { gasAction } from '@/features/hiring/shared'
import { decidePayload, decideToast, type DecideAnswer } from '@/pages/features/mywork/myWorkModel'
import {
  HOURS_HIDDEN_LINE, cellMarks, clashFor, editsHouse, flowLabel, flowSteps, freePeople, hoursHiddenLine, hoursShown,
  mergeWrite, notPossibleLine, orderRows, panelMode, testModeBanner, withdrawable,
  type Board, type Cell, type GridRow, type WriteAnswer,
} from '@/pages/features/scheduling/schedulingModel'
import {
  SCHEDULING_ACTIONS, addPerson, answerItem, callOff, importTimeOff, proposeSwap, readBoard, readStaffShifts, readTimeOffList, requestOff,
  rolledFrom, rollForward, saveCell, seedCalendars, setSettings, takeShift, timeOff, undoLast, withdrawFlow,
  readBuilder, saveBuilder, publishBuilder,
} from '@/pages/features/scheduling/schedulingLane'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const NOW_MS = Date.parse('2026-10-01T15:00:00Z')
const BM = 'BM4060'
const B = 'ABD1711'

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

const SCHED_TEXTS = ['CALLOFF_HOUSE', 'CALLOFF_EVERYONE', 'SWAP_ASK', 'SWAP_DECLINED_STAFF', 'SWAP_DECLINED_MANAGER',
  'SWAP_DECLINED_DIRECTOR', 'SWAP_DONE', 'REQUEST_DECIDED', 'TIMEOFF_DECIDED'].map((n) => `SMART_SCHED_${n}_TEXT`)

// Smart Comms says every Scheduling text (smartTell_): its door and the words it renders are lifted whole too
const HELPERS: [string, string][] = [
  ['Clients.gs', 'clientNameKey_'], ['Profile.gs', 'hubNameFold_'], ['HubCore.gs', 'hubCellSafe_'],
  ['HubCore.gs', 'hubPhoneE164_'], ['Talent.gs', 'str_'], ['Members.gs', 'hubActingUserId_'],
  ['SmartComms.gs', 'smartRender_'], ['SmartComms.gs', 'smartList_'], ['SmartComms.gs', 'smartPruneUnfilled_'],
  ['SmartComms.gs', 'SMART_TELL_LEDGERED'], ['SmartComms.gs', 'smartTell_'], ['Packet.gs', 'packetSendableNumber_'],
  ['Rpc.gs', 'HUB_QUIET_FROM'], ['Rpc.gs', 'HUB_QUIET_TO'], ['Rpc.gs', 'hubQuietWords_'],
  ...SCHED_TEXTS.map((n): [string, string] => ['SmartComms.gs', n]),
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
  if (pattern === 'EEE M/d') return `${part({ weekday: 'short' })} ${part({ month: 'numeric' })}/${part({ day: 'numeric' })}`
  if (pattern === 'EEEE') return part({ weekday: 'long' })
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/* ---------- the six houses, in memory ---------- */

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
          // a sheet keeps a quoted value as its text, as Sheets does
          for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = String(vals[i][j] ?? '').replace(/^'/, '')
        }
      },
      setNumberFormat() { return this },
    }),
  }
}

type Sheet = ReturnType<typeof sheetOf>

const ACCOUNTS: Row[] = [
  { userid: 'USR_M', displayname: 'Master', email: 'master@example.org', role: 'admin', types: '', active: 'TRUE' },
  { userid: 'USR_TY', displayname: 'Ty Bond', email: 'ty.bond@asalifecare.com', role: 'director', types: 'DIRECTOR', active: 'TRUE' },
  { userid: 'USR_BR', displayname: 'Brittany Anderson', email: 'brittfrench1316@gmail.com', role: 'staff', types: 'HM, STAFF', active: 'TRUE' },
  { userid: 'USR_RB', displayname: 'Regina Bowman', email: 'regina@example.org', role: 'staff', types: 'HM, STAFF', active: 'TRUE' },
  { userid: 'USR_AN', displayname: 'Ann Roe', email: 'ann@example.org', role: 'staff', types: 'STAFF', active: 'TRUE' },
  { userid: 'USR_BE', displayname: 'Ben Left', email: 'ben@example.org', role: 'staff', types: 'STAFF', active: 'TRUE' },
  { userid: 'USR_CY', displayname: 'Cy Far', email: 'cy@example.org', role: 'staff', types: 'STAFF', active: 'TRUE' },
  { userid: 'USR_NO', displayname: 'Noel Body', email: 'nobody@example.org', role: 'staff', types: 'STAFF', active: 'TRUE' },
]
const session = (uid: string): Row => {
  const a = ACCOUNTS.find((x) => x.userid === uid)!
  return { id: a.userid, email: a.email, display_name: a.displayname, role: a.role }
}
const MASTER = session('USR_M')
const TY = session('USR_TY')
const BRIT = session('USR_BR')
const REGINA = session('USR_RB')
const ANN = session('USR_AN')
const BEN = session('USR_BE')
const CY = session('USR_CY')
const NOBODY = session('USR_NO')

const PHONES: Record<string, string> = {
  reginabowman: '3305550101', annroe: '3305550102', benleft: '3305550103', cyfar: '3305550104', tybond: '3305550105',
  brittanyanderson: '3305550106',
}

type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; params?: Record<string, unknown> }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => unknown>
  SCHED_HEADERS: Record<string, string[]>
  SCHED_ACTIONS: string[]
  SCHED_FLOW_ACTIONS: string[]
  SCHED_VIEW_ACTIONS: string[]
  SCHED_BUILDER_ACTIONS: string[]
  schedMemoDrop_: () => void
  schedRowId_: (house: string, rowId: string) => string
  schedCellRow_: (house: string, rowId: string, date: string, text: string, extra?: Row) => Record<string, unknown>
}

let tabs: Record<string, Sheet> = {}
let cache = new Map<string, string>()
let props = new Map<string, string>()
let hoursHidden = true
let sent: { to: string; body: string; reason: string; key: string }[] = []

/** Everybody trained at both houses, unless a test says otherwise. */
const TRAINED = ['Regina Bowman', 'Ann Roe', 'Ben Left', 'Cy Far', 'Brittany Anderson', 'Ty Bond']
  .flatMap((staffName) => [BM, B].map((house) => ({ staffName, house, status: 'done', trainedAt: '2026-09-01', clientName: 'C1' })))
let istRows: Row[] = [...TRAINED]

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
    // App Control: open to every account with a row; the one without gets the closed gate
    hubProfileAppGate_: (app: string, u: Row | null) => (app === 'scheduling' && u && u.email !== 'nobody@example.org'
      ? { open: true, scope: { kind: u.email === 'master@example.org' ? 'master' : 'all' } } : { open: false, scope: { kind: 'none' } }),
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'master@example.org',
    hubSchedHoursHidden_: () => hoursHidden,
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
      const a = ACCOUNTS.find((x) => x.email === String(email).toLowerCase())
      return a ? { ...a } : null
    },
    userBadgesWorn_: (types: string, role: string) => [...String(types ?? '').split(/[,\s]+/), String(role ?? '').toUpperCase()]
      .filter(Boolean),
    certPicture_: () => ({
      annroe: { certs: { med2: { status: 'valid', expires: '1/1/2027' }, med3: { status: 'valid', expires: '' } } },
      reginabowman: { certs: { med3: { status: 'expiring', expires: '11/1/2026' } } },
    }),
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
      const name = `SMART_SCHED_${id.replace(/^sched_/, '').toUpperCase()}_TEXT`
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
    locationsHomes_: () => [{ code: BM, address: '908 Arlington Ave NW' }, { code: B, address: '12 Briar Way' }],
    mailPlatformUrl_: () => 'https://hub.example.org',
    reconCalendarLinks_: () => [{ label: 'CAN - BM - BM4060', id: 'book0000001' }],
    ssOpen_: () => { throw new Error('the book is not shared with this account') },
    // the IST record (Settings › IST read as a sheet, scope house, never lapsing) and the mirror's reader grant
    istConfig_: () => ({}),
    istConfigSource_: () => 'sheet',
    istCfgChoice_: () => 'house',
    istCfgInt_: () => 0,
    istOhioToday_: () => '2026-10-01',
    listRows_: (resource: string) => (resource === 'istRecords' ? istRows.map((r) => ({ ...r })) : []),
    houseIdFor_: () => '',
    hubGrantReader_: () => false,
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('Scheduling.gs'), ctx)
  vm.runInContext(gsText('SchedulingFlows.gs'), ctx)
  vm.runInContext(gsText('SchedulingViews.gs'), ctx)
  vm.runInContext(gsText('SchedulingBuilder.gs'), ctx)
  return ctx as unknown as Gs
}

const GS = boot()

/** The houses as the seed leaves them: two houses, one period, the two directors, a roster, a few shifts. */
function freshHouses(): void {
  tabs = {}
  for (const [tab, header] of Object.entries(GS.SCHED_HEADERS)) tabs[tab] = sheetOf([[...header]])
  const put = (tab: string, row: Record<string, unknown>) =>
    tabs[tab].grid.push(GS.SCHED_HEADERS[tab].map((h) => String(row[h] ?? '')))
  put('sched_settings', { key: 'houses', value: JSON.stringify([
    { code: BM, location: 'CAN - BM - BM4060', short: 'BM' }, { code: B, location: 'CAN - 48TH (B) - ABD1711', short: '48TH (B)' }]) })
  put('sched_settings', { key: 'periods', value: JSON.stringify([{ id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' }]) })
  put('sched_settings', { key: 'directors', value: 'ty.bond@asalifecare.com, brittfrench1316@gmail.com' })
  const rows: [string, string, string, string, string][] = [
    [BM, 'P:reginabowman', 'person', 'Regina Bowman', '**'], [BM, 'P:annroe', 'person', 'Ann Roe', ''],
    [BM, 'P:benleft', 'person', 'Ben Left', '*'], [BM, 'P:cyfar', 'person', 'Cy Far', ''],
    [BM, 'X:workshop-kc', 'workshop', 'WORKSHOP (KC)', ''], [BM, 'OPEN:1', 'open', 'OPEN', ''],
    [B, 'P:cyfar', 'person', 'Cy Far', '***'], [B, 'P:annroe', 'person', 'Ann Roe', ''], [B, 'OPEN:1', 'open', 'OPEN', ''],
  ]
  rows.forEach(([house, rowId, kind, name, designation], i) => put('sched_rows', {
    id: GS.schedRowId_(house, rowId), house_code: house, location: house === BM ? 'CAN - BM - BM4060' : 'CAN - 48TH (B) - ABD1711',
    row_id: rowId, row_kind: kind, name, person_key: kind === 'person' ? rowId.slice(2) : '', designation, order: String(i + 1),
    active: 'yes', source: 'seed:test',
  }))
  GS.schedMemoDrop_()
  const cells: [string, string, string, string, Row?][] = [
    [BM, 'P:annroe', '2026-09-28', '8A-4P'], [BM, 'P:annroe', '2026-09-29', '8A-4P'],
    [BM, 'P:annroe', '2026-10-02', '8A-4P'], [BM, 'P:annroe', '2026-10-12', '8A-4P'], [BM, 'P:annroe', '2026-10-20', '8A-4P'],
    [BM, 'P:reginabowman', '2026-10-02', '7A-7P'], [BM, 'P:benleft', '2026-10-14', '3P-11P'],
    [BM, 'OPEN:1', '2026-10-05', '4P-12A', { state: 'open' }], [BM, 'X:workshop-kc', '2026-10-02', '9A-3P'],
    [B, 'P:cyfar', '2026-10-03', '7A-3P'],
  ]
  for (const [house, rowId, date, text, extra] of cells) put('sched_cells', GS.schedCellRow_(house, rowId, date, text, extra ?? {}))
  GS.schedMemoDrop_()
}

const rowsOf = (tab: string): Row[] => {
  const [header, ...lines] = tabs[tab].grid
  return lines.map((line) => Object.fromEntries(header.map((h, i) => [h, String(line[i] ?? '')])))
}

/* ---------- the screen's calls, answered by the doors ---------- */

type Out = { status: number; data?: Record<string, unknown>; message?: string }
const calls: { action: string; payload: Record<string, unknown> }[] = []
const answers: { action: string; out: Out }[] = []
const realFetch = globalThis.fetch
// the session every door is asked as
let AS: Row = MASTER

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload?: Record<string, unknown> }
    calls.push({ action: env.action, payload: env.payload ?? {} })
    // every request is its own execution: nothing read for the last one is held
    GS.schedMemoDrop_()
    GS.SCHED_BOARD_MEMO = {}
    GS.SCHED_IST_MEMO = null
    const door = GS.HUB_ACTIONS[env.action]
    const out = (door ? door(JSON.parse(JSON.stringify(env.payload ?? {})), { ...AS }) : { status: 404, message: 'Unknown action.' }) as Out
    answers.push({ action: env.action, out: JSON.parse(JSON.stringify(out)) as Out })
    return new Response(JSON.stringify(out))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  cache = new Map()
  props = new Map()
  sent = []
  hoursHidden = true
  istRows = [...TRAINED]
  AS = MASTER
  freshHouses()
})

const as = async <T>(who: Row, fn: () => Promise<T>): Promise<T> => {
  AS = who
  return fn()
}
const rowIn = (b: Board, house: string, rowId: string): GridRow => {
  const r = b.grids[house]?.rows.find((x) => x.row_id === rowId)
  assert.ok(r, `${house} has the row ${rowId}`)
  return r
}
const cellIn = (b: Board, house: string, rowId: string, iso: string): Cell | null => {
  const grid = b.grids[house]
  const ci = grid.cols.findIndex((c) => c.iso === iso)
  assert.ok(ci >= 0, `${house} draws ${iso}`)
  return rowIn(b, house, rowId).cells[ci] ?? null
}
/** A refusal as the screen receives it: the door's status on the error, and its sentence as the message. */
const refusal = (status: number, said?: string | RegExp) => (e: unknown): boolean => {
  const err = e as Error & { status?: number }
  return err.status === status && (said === undefined || (typeof said === 'string' ? err.message === said : said.test(err.message)))
}
const inbox = (pred: (r: Row) => boolean) => rowsOf('sched_inbox').filter(pred)
const flows = (kind: string) => rowsOf('sched_flows').filter((f) => f.kind === kind)
const decide = (itemId: string, word: 'approve' | 'decline', note = '') =>
  gasAction<DecideAnswer>('schedulingAnswer', decidePayload(itemId, word, note))
const waitingFor = (uid: string, flowId: string) =>
  inbox((r) => r.box === 'work' && r.state === 'waiting' && r.to_uid === uid && r.flow_id === flowId)

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

/* ---------- the names ---------- */

describe('the names', () => {
  it('every door the screen and My Work name is a Scheduling action, and every Scheduling action has a caller', () => {
    const named = new Set<string>()
    for (const f of [...walk('src/pages/features/scheduling'), ...walk('src/pages/features/mywork')]) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) {
        if (m[1].startsWith('scheduling')) named.add(m[1])
      }
    }
    const declared = Object.keys(GS.HUB_POLICY)
      .filter((a) => ['Scheduling.gs', 'SchedulingFlows.gs', 'SchedulingViews.gs', 'SchedulingBuilder.gs'].includes(GS.HUB_POLICY[a].file))
    for (const name of named) {
      assert.ok(declared.includes(name), `${name} is declared in a Scheduling file`)
      assert.equal(typeof GS.HUB_ACTIONS[name], 'function', `${name} has a handler`)
    }
    assert.deepEqual([...named].sort(), [...declared].sort(), 'every declared action is called by the screen or My Work')
    assert.deepEqual([...SCHEDULING_ACTIONS].sort(), [...declared].sort())
    assert.deepEqual([...GS.SCHED_ACTIONS, ...GS.SCHED_FLOW_ACTIONS, ...GS.SCHED_VIEW_ACTIONS, ...GS.SCHED_BUILDER_ACTIONS].sort(),
      [...declared].sort())
    const reads = ['schedulingBoard', 'schedulingBuilderRead', ...GS.SCHED_VIEW_ACTIONS]
    for (const a of reads) assert.equal(GS.HUB_POLICY[a].lane, 'read', a)
    for (const a of declared.filter((x) => !reads.includes(x))) assert.equal(GS.HUB_POLICY[a].lane, 'tool', a)
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of declared) assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
  })

  it('the board is never kept as a relay receipt, and no write is spared one', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    // the board and the screens beside it are reads cut per viewer; no write is spared a receipt
    const reads = ['schedulingBoard', 'schedulingStaffShifts', 'schedulingTimeOffList', 'schedulingBuilderRead']
    for (const r of reads) assert.ok(line.includes(`"${r}"`), r)
    for (const a of SCHEDULING_ACTIONS.filter((x) => !reads.includes(x))) assert.ok(!line.includes(`"${a}"`), a)
  })
})

/* ---------- the gate ---------- */

describe('the gate', () => {
  it('an account with no App Control row is answered 404-shaped, before anything is read', async () => {
    AS = NOBODY
    await assert.rejects(readBoard(), refusal(404, 'Unknown action.'))
    await assert.rejects(callOff({ house: BM, row_id: 'P:annroe', date: '2026-10-02' }),
      refusal(404, /Unknown action/))
    await assert.rejects(saveCell({ house: BM, row_id: 'P:annroe', date: '2026-10-04', value: '8A-4P', via: 'add' }), /Unknown action/)
    assert.equal(rowsOf('sched_log').length, 0, 'nothing was written')
  })
})

/* ---------- the board, as the screen reads it ---------- */

describe('the board, as the screen reads it', () => {
  it('the master: every hour, the muted line while the switch hides them from everyone else, OPEN rows on top', async () => {
    const b = await readBoard()
    assert.deepEqual([b.viewer.is_master, b.viewer.can_edit_any, b.today, b.period.id], [true, true, '2026-10-01', 'P2026-09-28'])
    assert.equal(hoursShown(b, true), true)
    assert.equal(rowIn(b, BM, 'P:annroe').hours?.period, 40)
    assert.equal(hoursHiddenLine(b, true), HOURS_HIDDEN_LINE, 'the switch hides the hours from everyone else')
    assert.equal(hoursHiddenLine(b, false), '', 'a session that is not the master never draws the line')
    assert.deepEqual(orderRows(b.grids[BM].rows).map((r) => r.row_id),
      ['OPEN:1', 'P:reginabowman', 'P:annroe', 'P:benleft', 'P:cyfar', 'X:workshop-kc'])
    assert.deepEqual(b.grids[BM].rows.map((r) => r.row_id), orderRows(b.grids[BM].rows).map((r) => r.row_id), 'the server orders them so too')
    assert.deepEqual(rowIn(b, BM, 'P:reginabowman').badges, { hm: true, lead: false, med: 3 })
    assert.deepEqual(rowIn(b, BM, 'P:annroe').badges, { hm: false, lead: false, med: 2 })
    assert.deepEqual(rowIn(b, B, 'P:cyfar').badges, { hm: false, lead: true, med: 0 })
    assert.equal(testModeBanner(b, false).show, true, 'test mode on: the banner')
    assert.ok(!JSON.stringify(b).includes('1/1/2027') && !JSON.stringify(b).includes('555'), 'no date of a certificate, no phone')
    hoursHidden = false
    assert.equal(hoursHiddenLine(await readBoard(), true), '', 'the switch off: no line')
  })

  it('staff: no hour anywhere while the switch hides them, their own row marked, their shift opens their panel', async () => {
    const b = await as(ANN, () => readBoard())
    assert.equal(b.display.hidden.hours, true)
    assert.equal(hoursShown(b, false), false)
    assert.ok(!JSON.stringify(b.grids).includes('"hours"'), 'no hours travel')
    assert.equal(hoursHiddenLine(b, false), '')
    const me = rowIn(b, BM, 'P:annroe')
    assert.equal(me.me, true)
    assert.equal(panelMode({ row: me, cell: cellIn(b, BM, 'P:annroe', '2026-10-02'), editor: editsHouse(b, BM), date: '2026-10-02', today: b.today }), 'own')
    assert.equal(panelMode({ row: rowIn(b, BM, 'OPEN:1'), cell: cellIn(b, BM, 'OPEN:1', '2026-10-05'), editor: false, date: '2026-10-05', today: b.today }), 'take')
    assert.deepEqual(cellIn(b, B, 'P:annroe', '2026-10-02'), { text: '', kind: 'alias', state: 'scheduled', echo: 'BM' },
      'an empty cell echoes the house the person works at that day')
  })
})

/* ---------- the walks ---------- */

describe('Call Off', () => {
  it('staff: C/O at once, the shift on the OPEN row on top, the directors warned in My Inbox, the house texted', async () => {
    const before = await as(ANN, () => readBoard())
    const answer = await callOff({ house: BM, row_id: 'P:annroe', date: '2026-10-02' }, 'flu')
    assert.match(answer.said, /^Called off\. The shift is open at the top of BM/)
    const b = mergeWrite(before, answer)
    const mine = cellIn(b, BM, 'P:annroe', '2026-10-02')
    assert.deepEqual([mine?.text, mine?.state, mine?.flow?.kind], ['C/O', 'called_off', 'call_off'])
    const top = orderRows(b.grids[BM].rows)[0]
    assert.equal(top.kind, 'open')
    const open = cellIn(b, BM, top.row_id, '2026-10-02')
    assert.deepEqual([open?.text, open?.state], ['8A-4P', 'open'])
    assert.ok(b.mine.some((f) => f.kind === 'call_off' && f.reason === 'flu'), 'the caller sees their own reason')

    const warned = inbox((r) => r.box === 'inbox' && r.kind === 'warning')
    assert.deepEqual(warned.map((r) => [r.seat, r.to_uid]).sort(), [['director', 'USR_BR'], ['director', 'USR_TY']])
    assert.ok(warned.every((r) => r.title === 'Call off — Fri 10/2 · 8A-4P · BM' && r.state === 'posted' && r.test_mode === 'yes'
      && r.link === '/app/scheduling/calendar?house=BM4060&day=2026-10-02'), JSON.stringify(warned[0]))

    const stage1 = sent.filter((s) => s.reason === 'scheduling: sched_calloff_house')
    assert.deepEqual(stage1.map((s) => s.to).sort(), ['+13305550101', '+13305550103', '+13305550104'], 'the HM and the free house staff')
    assert.ok(stage1.every((s) => !/Ann|flu/.test(s.body) && /URGENT OPEN SHIFT/.test(s.body)), 'the text never names the caller nor why')

    const other = await as(BEN, () => readBoard())
    assert.equal(cellIn(other, BM, 'P:annroe', '2026-10-02'), null, 'a C/O is not another staff member\'s to see')
    assert.equal(cellIn(other, BM, top.row_id, '2026-10-02')?.text, '8A-4P')
    assert.ok(!JSON.stringify(other).includes('flu'))
    assert.match(answer.said, /texts to the house went out|held by test mode/, 'the call-off says what its texts did')
    assert.doesNotMatch(answer.said, /being texted/)
  })

  it('another staff member reads the caller only as "not free that day"; the editor reads where, and gives the shift away in one write', async () => {
    await as(ANN, () => callOff({ house: BM, row_id: 'P:annroe', date: '2026-10-02' }, 'flu'))
    const ben = await as(BEN, () => readBoard())
    assert.deepEqual(ben.busy.annroe?.filter((x) => x[0] === '2026-10-02'), [['2026-10-02', 0, 1440, '', 'day']])
    assert.equal(clashFor(ben, 'annroe', '2026-10-02', 480, 960)?.why, 'not free that day')
    const regina = await as(REGINA, () => readBoard())
    assert.deepEqual(regina.busy.annroe?.filter((x) => x[0] === '2026-10-02'), [['2026-10-02', 0, 1440, BM, 'day']])

    const open = orderRows(regina.grids[BM].rows).find((r) => r.kind === 'open' && cellIn(regina, BM, r.row_id, '2026-10-02')?.state === 'open')!
    const given = await saveCell({ house: BM, row_id: 'P:benleft', person: 'Ben Left', date: '2026-10-02', open_row_id: open.row_id, via: 'add' })
    assert.equal(given.said, 'Gave 8A-4P on Fri 10/2 to Ben Left.')
    const after = mergeWrite(regina, given)
    assert.deepEqual([cellIn(after, BM, 'P:benleft', '2026-10-02')?.text, cellIn(after, BM, 'P:benleft', '2026-10-02')?.state], ['8A-4P', 'taken'])
    assert.equal(cellIn(after, BM, open.row_id, '2026-10-02'), null, 'the OPEN cell went with it')
    assert.equal(flows('call_off')[0].state, 'covered', 'the outreach stops')
    assert.ok((after.log?.[BM] ?? []).some((l) => l.row_id === 'P:benleft' && l.date === '2026-10-02'), 'the history drawn moves with the write')
  })
})

describe('Request Off', () => {
  it('both directors are asked in My Work; the first answer decides and supersedes the other\'s item', async () => {
    const answer = await as(ANN, () => requestOff({ house: BM, row_id: 'P:annroe', date: '2026-10-12' }, 'wedding'))
    assert.equal(answer.said, 'Asked. Both directors have it in My Work; the first answer decides.')
    const flow = flows('request_off')[0]
    assert.equal(flow.state, 'waiting')
    assert.ok(answer.mine?.some((f) => f.id === flow.id && f.state === 'waiting'))
    const [brit] = waitingFor('USR_BR', flow.id)
    const [ty] = waitingFor('USR_TY', flow.id)
    assert.ok(brit && ty, 'one item for each director')

    const britBoard = await as(BRIT, () => readBoard())
    assert.deepEqual(britBoard.waiting_on_me.map((i) => i.id), [brit.id], 'the screen\'s own card lists it too')
    const got = await decide(brit.id, 'approve')
    assert.equal(got.changed, true)
    assert.match(String(got.said), /^Approved\. The shift is open at the top of BM/)
    assert.equal(rowsOf('sched_inbox').find((r) => r.id === ty.id)?.state, 'superseded')
    assert.equal(rowsOf('sched_flows').find((f) => f.id === flow.id)?.state, 'approved')

    const late = await as(TY, () => decide(ty.id, 'approve'))
    assert.deepEqual([late.changed, late.said], [false, 'Already answered by Brittany Anderson.'])
    assert.equal(decideToast('approve', late).title, 'Already answered')

    const b = await as(ANN, () => readBoard())
    assert.deepEqual([cellIn(b, BM, 'P:annroe', '2026-10-12')?.text, cellIn(b, BM, 'P:annroe', '2026-10-12')?.state], ['R/O', 'requested_off'])
    assert.deepEqual([cellIn(b, BM, 'OPEN:1', '2026-10-12')?.text, cellIn(b, BM, 'OPEN:1', '2026-10-12')?.state], ['8A-4P', 'open'])
    assert.equal(flows('call_off').length, 1, 'the approval runs the call-off outreach')
    assert.ok(inbox((r) => r.box === 'inbox' && r.kind === 'info' && r.seat === 'director').length === 2, 'both directors are told')
  })

  it('inside the notice only Call Off and Swap are offered, and the server says the same', async () => {
    await assert.rejects(as(ANN, () => requestOff({ house: BM, row_id: 'P:annroe', date: '2026-10-02' })),
      /Request Off needs at least 7 days' notice/)
  })

  it('the requester withdraws while it waits: the items close and nothing on the calendar changes', async () => {
    await as(ANN, () => requestOff({ house: BM, row_id: 'P:annroe', date: '2026-10-12' }))
    const flow = flows('request_off')[0]
    const answer = await withdrawFlow(flow.id)
    assert.equal(answer.said, 'Withdrawn. Nothing on the calendar changed.')
    assert.deepEqual(inbox((r) => r.flow_id === flow.id).map((r) => r.state), ['closed', 'closed'])
    assert.equal(cellIn(await readBoard(), BM, 'P:annroe', '2026-10-12')?.text, '8A-4P')
  })
})

describe('Swap', () => {
  const propose = async () => {
    const b = await as(BEN, () => readBoard())
    const cell = cellIn(b, BM, 'P:benleft', '2026-10-14')
    const span: [number, number] = [Math.round((cell?.start ?? 0) * 60), Math.round((cell?.end ?? 0) * 60)]
    const free = freePeople(b, '2026-10-14', span, { except: 'benleft' })
    assert.ok(free.free.some((p) => p.key === 'cyfar'), 'Cy is offered: free for the shift')
    return proposeSwap({ house: BM, row_id: 'P:benleft', date: '2026-10-14' }, 'cyfar')
  }

  it('the house manager declines: the swap ends and the original is told (My Inbox and a text)', async () => {
    const asked = await propose()
    assert.equal(asked.said, 'Asked Cy Far. Next the house manager, then a director.')
    const flow = flows('swap')[0]
    assert.ok(sent.some((s) => s.reason === 'scheduling: sched_swap_ask' && s.to === '+13305550104'), 'the replacement gets the heads-up')
    const accepted = await as(CY, () => decide(waitingFor('USR_CY', flow.id)[0].id, 'approve'))
    assert.equal(accepted.said, 'Accepted. The house manager is asked next.')
    const [hm] = waitingFor('USR_RB', flow.id)
    assert.ok(hm && hm.seat === 'house_manager')
    sent = []
    const declined = await as(REGINA, () => decide(hm.id, 'decline', 'short staffed'))
    assert.equal(declined.said, 'Declined. Ben Left is told.')
    assert.equal(rowsOf('sched_flows').find((f) => f.id === flow.id)?.state, 'declined')
    const told = inbox((r) => r.flow_id === flow.id && r.box === 'inbox' && r.to_uid === 'USR_BE')
    assert.equal(told.length, 1)
    assert.match(told[0].body, /^The house manager declined\. "short staffed" The shift is still yours\./)
    assert.deepEqual(sent.map((s) => [s.reason, s.to]), [['scheduling: sched_swap_declined_manager', '+13305550103']])
    assert.match(sent[0].body, /^The house manager declined the swap - BM, Wed 10\/14, 3P-11P\./)
    assert.equal(cellIn(await as(BEN, () => readBoard()), BM, 'P:benleft', '2026-10-14')?.text, '3P-11P')
  })

  it('through the three seats: the replacement, the house manager, one director — then the names change places', async () => {
    await propose()
    const flow = flows('swap')[0]
    await as(CY, () => decide(waitingFor('USR_CY', flow.id)[0].id, 'approve'))
    const hmSaid = await as(REGINA, () => decide(waitingFor('USR_RB', flow.id)[0].id, 'approve'))
    assert.equal(hmSaid.said, 'Approved. A director is asked last.')
    const [ty] = waitingFor('USR_TY', flow.id)
    const [brit] = waitingFor('USR_BR', flow.id)
    assert.ok(ty && brit, 'both directors hold the last seat')
    const done = await as(TY, () => decide(ty.id, 'approve'))
    assert.equal(done.said, 'Approved. The swap is done: Cy Far has the shift.')
    assert.equal(rowsOf('sched_inbox').find((r) => r.id === brit.id)?.state, 'superseded')
    const everyone = inbox((r) => r.flow_id === flow.id && r.seat === 'everyone')
    assert.deepEqual(everyone.map((r) => [r.box, r.to_uid, r.title]),
      [['inbox', '', 'Shift swapped: BM Wed 10/14 3P-11P — Ben Left → Cy Far']])
    const b = await readBoard()
    assert.deepEqual([cellIn(b, BM, 'P:cyfar', '2026-10-14')?.text, cellIn(b, BM, 'P:cyfar', '2026-10-14')?.state], ['3P-11P', 'swap_in'])
    assert.equal(cellIn(b, BM, 'P:benleft', '2026-10-14')?.state, 'swapped_out')
    assert.equal(cellIn(await as(ANN, () => readBoard()), BM, 'P:benleft', '2026-10-14'), null, 'an emptied cell is nothing to the others')
  })

  it('a shift got by a swap is the replacement\'s own in every way: their panel offers it all, and a new swap goes out', async () => {
    await propose()
    const flow = flows('swap')[0]
    await as(CY, () => decide(waitingFor('USR_CY', flow.id)[0].id, 'approve'))
    await as(REGINA, () => decide(waitingFor('USR_RB', flow.id)[0].id, 'approve'))
    await as(TY, () => decide(waitingFor('USR_TY', flow.id)[0].id, 'approve'))
    const b = await as(CY, () => readBoard())
    const cell = cellIn(b, BM, 'P:cyfar', '2026-10-14')
    assert.equal(cell?.state, 'swap_in')
    assert.equal(panelMode({ row: rowIn(b, BM, 'P:cyfar'), cell, editor: editsHouse(b, BM), date: '2026-10-14', today: b.today }), 'own')
    const done = b.mine.find((f) => f.id === cell?.flow?.id)
    assert.ok(!done || !withdrawable(done), 'a finished swap holds nothing back: the own-shift acts are drawn')
    const again = await as(CY, () => proposeSwap({ house: BM, row_id: 'P:cyfar', date: '2026-10-14' }, 'annroe'))
    assert.match(again.said, /^Asked Ann Roe\./)
  })

  it('nobody approves their own swap, and one person never fills two seats', async () => {
    await propose()
    const flow = flows('swap')[0]
    await as(CY, () => decide(waitingFor('USR_CY', flow.id)[0].id, 'approve'))
    const item = waitingFor('USR_RB', flow.id)[0]
    await assert.rejects(as(BEN, () => decide(item.id, 'approve')), /waiting on someone else/)
  })
})

describe('Take', () => {
  it('the first free taker has it at once; the second is refused; the HM and both directors are told', async () => {
    const b = await as(ANN, () => readBoard())
    const open = cellIn(b, BM, 'OPEN:1', '2026-10-05')
    assert.deepEqual([open?.text, open?.state], ['4P-12A', 'open'])
    const mine = await takeShift({ house: BM, row_id: 'OPEN:1', date: '2026-10-05' })
    assert.equal(mine.said, 'It is yours. The house manager and the directors are told.')
    const after = mergeWrite(b, mine)
    assert.deepEqual([cellIn(after, BM, 'P:annroe', '2026-10-05')?.text, cellIn(after, BM, 'P:annroe', '2026-10-05')?.state], ['4P-12A', 'taken'])
    assert.equal(cellIn(after, BM, 'OPEN:1', '2026-10-05'), null)
    await assert.rejects(as(BEN, () => takeShift({ house: BM, row_id: 'OPEN:1', date: '2026-10-05' })),
      refusal(409, 'Somebody else took this shift a moment ago.'))
    const take = flows('take')[0]
    assert.deepEqual(inbox((r) => r.flow_id === take.id).map((r) => `${r.box}:${r.kind}:${r.seat}:${r.to_uid}`).sort(),
      ['inbox:info:director:USR_BR', 'inbox:info:director:USR_TY', 'inbox:info:house_manager:USR_RB'])
  })

  it('a shift taken from OPEN is the taker\'s own: their panel offers Call Off, and the server takes it', async () => {
    await as(ANN, () => takeShift({ house: BM, row_id: 'OPEN:1', date: '2026-10-05' }))
    const b = await as(ANN, () => readBoard())
    const cell = cellIn(b, BM, 'P:annroe', '2026-10-05')
    assert.equal(cell?.state, 'taken')
    assert.equal(panelMode({ row: rowIn(b, BM, 'P:annroe'), cell, editor: false, date: '2026-10-05', today: b.today }), 'own')
    const off = await as(ANN, () => callOff({ house: BM, row_id: 'P:annroe', date: '2026-10-05' }, 'sick'))
    assert.equal(cellIn(mergeWrite(b, off), BM, 'P:annroe', '2026-10-05')?.state, 'called_off')
    assert.ok(flows('call_off').some((f) => f.date === '2026-10-05'))
  })
})

describe('Training (no IST at the house)', () => {
  it('placed without the house IST: a training cell, both seats asked, and a decline reopens the shift at the top', async () => {
    istRows = TRAINED.filter((r) => !(r.staffName === 'Ben Left' && r.house === B))
    const placed = await saveCell({ house: B, person: 'Ben Left', date: '2026-10-06', value: '8A-4P', via: 'add' })
    assert.ok(placed.training?.flow_id, 'the answer names the training')
    assert.match(placed.said, /training with the house manager/)
    const master = mergeWrite(await readBoard(), placed)
    const cell = cellIn(master, B, 'P:benleft', '2026-10-06')
    assert.equal(cell?.state, 'training')
    assert.deepEqual(cellMarks(rowIn(master, B, 'P:benleft'), cell), ['training-waiting'])
    const training = flows('training')[0]
    assert.equal(training.id, placed.training?.flow_id)
    const asked = inbox((r) => r.flow_id === training.id && r.box === 'work' && r.state === 'waiting')
    assert.ok(asked.some((r) => r.to_uid === 'USR_TY') && asked.some((r) => r.to_uid === 'USR_BR'), 'the directors are asked')
    assert.ok(asked.every((r) => /^Training — Ben Left/.test(r.title)), asked.map((r) => r.title).join(' | '))

    const ben = await as(BEN, () => readBoard())
    const own = cellIn(ben, B, 'P:benleft', '2026-10-06')
    assert.equal(own?.state, 'training')
    assert.equal(panelMode({ row: rowIn(ben, B, 'P:benleft'), cell: own, editor: false, date: '2026-10-06', today: ben.today }), 'own')
    const mine = ben.mine.find((f) => f.id === training.id)
    assert.ok(mine && !withdrawable(mine), 'a training is never withdrawn')
    assert.deepEqual(flowSteps(mine).map((s) => s.label), ['Placed', 'House manager', 'Director', 'Training'])
    await assert.rejects(as(BEN, () => requestOff({ house: B, row_id: 'P:benleft', date: '2026-10-06' })), refusal(409),
      'Request Off waits for the answer, as the panel says')

    await as(TY, () => decide(waitingFor('USR_TY', training.id)[0].id, 'decline', 'not this week'))
    const after = await readBoard()
    assert.notEqual(cellIn(after, B, 'P:benleft', '2026-10-06')?.state, 'training', 'the trainee is off the shift')
    const reopened = orderRows(after.grids[B].rows).filter((r) => r.kind === 'open')
      .map((r) => cellIn(after, B, r.row_id, '2026-10-06')).find((c) => c?.state === 'open')
    assert.equal(reopened?.text, '8A-4P', 'the shift is on an OPEN row at the top')
    const call = flows('call_off').find((f) => f.source === 'training')
    assert.ok(call, 'the outreach runs for it')
    assert.equal(flowLabel({ kind: 'call_off', source: call.source }), 'Shift reopened (training not approved)')
  })
})

describe('the editor', () => {
  it('Add Shift on somebody already working elsewhere then: the panel and the server say the same sentence', async () => {
    const b = await as(REGINA, () => readBoard())
    assert.deepEqual(b.viewer.editor_of, [BM], 'the house manager edits their own house')
    const clash = clashFor(b, 'cyfar', '2026-10-03', 480, 960)
    assert.ok(clash)
    const line = notPossibleLine('Cy Far', clash)
    assert.equal(line, 'Not possible: Cy Far is already at 48TH (B) 7A-3P that day.')
    await assert.rejects(saveCell({ house: BM, row_id: 'P:cyfar', person: 'Cy Far', date: '2026-10-03', value: '8A-4P', via: 'add' }),
      refusal(409, line))
  })

  it('a free person is placed, their new row made, the edit undone; staff cannot edit; Add Somebody adds a row', async () => {
    AS = REGINA
    const placed = await saveCell({ house: BM, person: 'Brittany Anderson', date: '2026-10-04', value: '8A-4P', via: 'add' })
    assert.equal(placed.said, 'Saved 8A-4P for Brittany Anderson on Sun 10/4.')
    assert.ok(placed.grids[BM].rows.some((r) => r.row_id === 'P:brittanyanderson' && r.kind === 'person'))
    const undone = await undoLast(BM)
    assert.equal(undone.said, 'Undone: an empty cell is back.')
    const added = await addPerson(BM, 'Kim Lead')
    assert.equal(added.said, 'Kim Lead is on BM.')
    await assert.rejects(as(ANN, () => saveCell({ house: BM, row_id: 'P:annroe', date: '2026-10-04', value: '8A-4P', via: 'add' })),
      refusal(403))
  })
})

describe('time off and the roll', () => {
  it('days inside the calendar open at once; days beyond it wait for the roll, which lays exactly those and closes the flow', async () => {
    const asked = await as(ANN, () => timeOff('2026-10-20', '2026-10-28', 'family trip'))
    assert.equal(asked.said, 'Asked. Both directors have it in My Work; the first answer decides.')
    const flow = flows('time_off')[0]
    const approved = await as(TY, () => decide(waitingFor('USR_TY', flow.id)[0].id, 'approve'))
    assert.equal(approved.said, 'Approved. 1 shift(s) are open now; the days beyond the last period are kept for the roll.')
    const held = rowsOf('sched_flows').find((f) => f.id === flow.id)!
    assert.equal(held.state, 'approved_future')
    assert.deepEqual(JSON.parse(held.outreach_log).future, ['2026-10-26', '2026-10-27', '2026-10-28'])
    const now = await as(ANN, () => readBoard())
    assert.deepEqual([cellIn(now, BM, 'P:annroe', '2026-10-20')?.text, cellIn(now, BM, 'P:annroe', '2026-10-20')?.state], ['R/O', 'time_off'])

    AS = MASTER
    const dry = await rollForward(true)
    assert.equal(dry.dry_run, true)
    assert.equal(rolledFrom(dry.report), 'P2026-09-28', 'the dry run names the period it copies')
    const rolled = await rollForward(false, rolledFrom(dry.report))
    const report = rolled.report as { period: { id: string }; time_off_applied: number }
    assert.deepEqual([rolled.dry_run, report.period.id, report.time_off_applied], [false, 'P2026-10-26', 2])
    await assert.rejects(rollForward(false, rolledFrom(dry.report)),
      refusal(409, 'Already rolled: the last period is now P2026-10-26.'), 'the same press again rolls nothing')
    const after = rowsOf('sched_flows').find((f) => f.id === flow.id)!
    assert.equal(after.state, 'approved', 'every owed day now sits in a period')
    assert.deepEqual(JSON.parse(after.outreach_log).future, [])
    const next = await as(ANN, () => readBoard('P2026-10-26'))
    for (const iso of ['2026-10-26', '2026-10-27']) {
      const c = cellIn(next, BM, 'P:annroe', iso)
      assert.deepEqual([c?.text, c?.state, c?.time_off], ['R/O', 'time_off', 'approved'], iso)
      const top = orderRows(next.grids[BM].rows).filter((r) => r.kind === 'open').map((r) => cellIn(next, BM, r.row_id, iso)?.text)
      assert.ok(top.includes('8A-4P'), `${iso}: the shift is on an OPEN row`)
    }
    assert.equal(flows('call_off').filter((f) => f.date >= '2026-10-26').length, 0, 'no outreach for the days the roll laid')
  })
})

describe('the master\'s setup', () => {
  it('settings are the master\'s; the seed and the roll default to a dry run', async () => {
    const saved = await setSettings({ min_days_ahead: '7' })
    assert.equal(saved.ok, true)
    await assert.rejects(as(ANN, () => setSettings({ min_days_ahead: '1' })), /Only the master/)
    AS = MASTER
    const seed = await seedCalendars(true)
    const report = seed.report as { unreadable_books: { code: string }[] }
    assert.deepEqual([seed.dry_run, report.unreadable_books.map((x) => x.code)], [true, [BM]])
    assert.equal((await rollForward(true)).dry_run, true)
    // the Time Off house has no pointer here: said, and nothing carried
    await assert.rejects(importTimeOff(false), /The Time Off house could not be read just now — the Time Off house has no pointer/)
    await assert.rejects(as(ANN, () => importTimeOff(false)), /Only the master/)
    // the Builder's three doors, each with its declared parameters; the drafts house is not minted here
    await readBuilder(BM, '', '').catch(() => null)
    await saveBuilder({ house: BM, first: '2026-10-05', last: '2026-10-18', draft: {} as never, state: 'pattern', rev: '' })
      .catch(() => null)
    await publishBuilder(BM, '2026-10-05', 1).catch(() => null)
  })
})

/* ---------- Staff Calendars and Time Off Requests ---------- */

describe('the screens beside the calendars', () => {
  it('are the master\'s until App Control releases them, and read across every house', async () => {
    const ann = await as(MASTER, () => readStaffShifts('annroe'))
    assert.equal(ann.person, 'annroe')
    assert.ok(ann.shifts.length > 0 && ann.shifts.every((s) => s.row_id === 'P:annroe' && s.kind !== 'off'), JSON.stringify(ann.shifts))
    assert.deepEqual(ann.shifts.map((s) => s.date), [...ann.shifts.map((s) => s.date)].sort(), 'soonest first')
    const open = await as(MASTER, () => readStaffShifts('open'))
    assert.ok(open.shifts.every((s) => s.row_id.startsWith('OPEN:') && s.date >= open.today))
    const list = await as(MASTER, () => readTimeOffList(true))
    assert.ok(Array.isArray(list.pending) && Array.isArray(list.approved) && list.sees_all)
    await assert.rejects(as(ANN, () => readStaffShifts('')), /Unknown action/)
    await assert.rejects(as(ANN, () => readTimeOffList(false)), /Unknown action/)
  })
})

/* ---------- what crossed the wire ---------- */

describe('what crossed the wire', () => {
  it('every call carried only the parameters its door declares, and every Scheduling door was called', () => {
    const bad = calls.filter((c) => {
      const declared = Object.keys(GS.HUB_POLICY[c.action]?.params ?? {})
      return Object.keys(c.payload).some((k) => !declared.includes(k))
    })
    assert.deepEqual(bad, [])
    assert.deepEqual([...new Set(calls.map((c) => c.action))].sort(), [...SCHEDULING_ACTIONS].sort())
  })

  it('every write the screen lays over its board answers the one envelope, from either file', () => {
    const WRITES = ['schedulingCellSave', 'schedulingAddPerson', 'schedulingUndo', 'schedulingCallOff', 'schedulingRequestOff',
      'schedulingTimeOff', 'schedulingSwapPropose', 'schedulingTake', 'schedulingWithdraw']
    const landed = answers.filter((a) => WRITES.includes(a.action) && a.out.status === 200)
    assert.deepEqual([...new Set(landed.map((a) => a.action))].sort(), [...WRITES].sort(), 'each write landed at least once here')
    for (const a of landed) {
      const d = a.out.data as WriteAnswer & Record<string, unknown>
      for (const k of ['ok', 'said', 'period_id', 'grids', 'busy', 'mine', 'waiting_on_me', 'test_mode']) {
        assert.ok(k in d, `${a.action} answers ${k}`)
      }
      assert.equal(typeof d.said, 'string')
      assert.equal(typeof (d.test_mode as { on?: unknown }).on, 'boolean', `${a.action}: test mode said`)
    }
    for (const a of answers.filter((x) => x.action === 'schedulingAnswer' && x.out.status === 200)) {
      assert.deepEqual(Object.keys(a.out.data ?? {}).sort(), ['changed', 'ok', 'said', 'state'])
    }
    const refused = answers.filter((a) => a.out.status >= 400)
    assert.ok(refused.every((a) => typeof a.out.message === 'string' && a.out.message.length > 0), 'every refusal is a sentence')
  })

  it('My Work\'s answer goes out as the door reads it', async () => {
    const asked = await as(ANN, () => requestOff({ house: BM, row_id: 'P:annroe', date: '2026-10-12' }))
    const [item] = waitingFor('USR_TY', String(asked.flow_id))
    const before = calls.length
    await as(TY, () => answerItem(item.id, 'decline', 'not that day'))
    assert.deepEqual(calls[before], { action: 'schedulingAnswer', payload: { item_id: item.id, word: 'decline', note: 'not that day' } })
    assert.deepEqual(decidePayload(item.id, 'decline', ' not that day '), { item_id: item.id, word: 'decline', note: 'not that day' })
  })
})
