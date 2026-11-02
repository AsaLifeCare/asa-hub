/**
 * Calendar Builder whole: page gates, the one checker, the registry's moved screens, the switcher,
 * and a Requests row and its panel from the relay's cut.
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  EVERY_HOUSE_BADGES, GATE_REFUSED_ROLES, HOUSE_MANAGER_BADGE, pageGateAllows, pageGateReachesRole,
} from '@/lib/pageGate'
import { isAllowedWith } from '@/lib/appAccess'
import { BADGE_FOLLOWS } from '@/lib/badgeFollows'
import { allowedPages, menuPageId } from '@/lib/audience'
import { useAuthStore } from '@/auth/useAuthStore'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { calendarBuilderManifests, SHIFT_BOARD_PAGES } from '@/registry/apps-calendarbuilder'
import { shiftsSuiteManifests, SHIFT_BOARD_MOVED_TO } from '@/registry/apps-shifts'
import { groupItems } from '@/components/shared/PageSwitchMenu'
import { switchItems } from '@/pages/features/calendarbuilder/CalendarBuilderPage'
import { HOUSE_CAL_PATH, REQUESTS_PATH } from '@/pages/features/shifts/houseCalTypes'
import {
  callOffExportRows, calledOffLine, clockSpan, displacedLine, exportRows, filterRows, filterTimeOff,
  placeLine, reasonLine, shiftLine, timeOffCutsFrom, timeOffExportRows, urgentLine, windowLine,
  type PoolShift, type RequestRow, type ShiftCard, type ShiftDetail, type TimeOffRow,
} from '@/pages/features/shifts/requestsLogic'
import { shiftPanel, swapPanel, timeOffPanel } from '@/pages/features/shifts/requestDetail'
import type { AppManifest } from '@/engine/types'

const root = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const staff = { role: 'staff', types: [] as string[] }
const derivedHm = { role: 'staff', types: [] as string[], derivedTypes: ['HM'] }
const tickedHm = { role: 'staff', types: ['HM'] }
const director = { role: 'staff', types: ['DIRECTOR'] }
// the director's stand-in badge, read from BADGE_FOLLOWS rather than spelled here
const follower = Object.keys(BADGE_FOLLOWS).find((w) => BADGE_FOLLOWS[w] === 'DIRECTOR') ?? 'DIRECTOR'
const followsDirector = { role: 'staff', types: [follower] }
const managerRole = { role: 'manager', types: [] as string[] }
const client = { role: 'client', types: ['DIRECTOR'] }

describe('the page gates', () => {
  it('a page with no gate is the app\'s', () => {
    assert.equal(pageGateAllows(undefined, staff), true)
    assert.equal(pageGateReachesRole(undefined, 'client'), true)
  })
  it('the Builder: a house\'s managers — ticked or worn by code — and above; never staff', () => {
    assert.equal(pageGateAllows('house-manager', staff), false)
    assert.equal(pageGateAllows('house-manager', derivedHm), true)
    assert.equal(pageGateAllows('house-manager', tickedHm), true)
    assert.equal(pageGateAllows('house-manager', director), true)
    assert.equal(pageGateAllows('house-manager', followsDirector), true, 'the badge that follows DIRECTOR')
    assert.equal(pageGateAllows('house-manager', managerRole), true, 'the named role exception')
  })
  it('the estate-wide screens: only the readers who edit every house — a house manager builds theirs in the Builder', () => {
    assert.equal(pageGateAllows('every-house', derivedHm), false)
    assert.equal(pageGateAllows('every-house', tickedHm), false)
    assert.equal(pageGateAllows('every-house', staff), false)
    assert.equal(pageGateAllows('every-house', director), true)
    assert.equal(pageGateAllows('every-house', { role: 'admin', types: [] }), true, 'the admin role folds in as ADMIN')
    assert.equal(pageGateAllows('every-house', managerRole), true)
    assert.equal(pageGateAllows('every-house', { role: 'staff', types: [], isMaster: true }), true)
  })
  it('Requests and House Calendars: everybody but a client or a guardian', () => {
    assert.equal(pageGateAllows('no-client', staff), true)
    assert.equal(pageGateAllows('no-client', director), true)
    assert.equal(pageGateAllows('no-client', client), false)
    assert.equal(pageGateAllows('no-client', { role: 'guardian', types: [] }), false)
    assert.equal(pageGateReachesRole('no-client', 'client'), false)
    assert.equal(pageGateReachesRole('no-client', 'staff'), true)
  })
  it('a client or a guardian never passes a gate, whatever badge the column says', () => {
    assert.equal(pageGateAllows('every-house', client), false)
    assert.equal(pageGateAllows('house-manager', { role: 'guardian', types: ['HM'] }), false)
    assert.equal(pageGateReachesRole('every-house', 'client'), false)
    assert.equal(pageGateReachesRole('house-manager', 'staff'), true)
    assert.equal(pageGateAllows('house-manager', null), false)
  })
  it('the words are the relay\'s (tools/check-badges.mjs holds the two files together)', () => {
    assert.deepEqual([...EVERY_HOUSE_BADGES].sort(), ['ADMIN', 'ADMINISTRATOR', 'DIRECTOR', 'MASTER'])
    assert.deepEqual([...GATE_REFUSED_ROLES].sort(), ['client', 'guardian'])
    assert.equal(HOUSE_MANAGER_BADGE, 'HM')
  })
})

describe('the Shift Board\'s screens are Calendar Builder\'s', () => {
  const cb = calendarBuilderManifests[0]
  const board = shiftsSuiteManifests[0]
  it('every screen is a page of Calendar Builder, the same object the Shift Board lists', () => {
    for (const page of board.pages) {
      assert.ok(cb.pages.includes(page), `${page.id} is not the same object in Calendar Builder`)
    }
    assert.deepEqual(SHIFT_BOARD_PAGES, board.pages)
  })
  it('every old address has a page to land on, and names only real pages', () => {
    for (const page of board.pages) {
      const to = SHIFT_BOARD_MOVED_TO[page.id]
      assert.ok(to, `/app/shiftboard/${page.id} has nowhere to go`)
      assert.ok(cb.pages.some((p) => p.id === to), `${to} is not a Calendar Builder page`)
    }
  })
  it('the moved screens keep the Shift Board\'s audience; Requests and House Calendars close to clients as the relay does; the building screens are gated as before', () => {
    for (const role of board.audience ?? []) assert.ok(cb.audience?.includes(role), role)
    const gate = Object.fromEntries(cb.pages.map((p) => [p.id, p.gate ?? '']))
    assert.deepEqual(gate, {
      smartcomms: 'every-house', builder: 'house-manager', conflicts: 'every-house', requests: 'no-client',
      swaps: 'no-client', hours: 'every-house', staff: 'every-house', houses: 'every-house',
      'house-cal': 'no-client', calendar: '', cards: '', timeline: '', coverage: '', week: '',
    })
  })
  it('no page a member of staff opens names a slice that covers every house — Requests reads the relay\'s own feed', () => {
    const estate = ['calendarGrid', 'calendarConflicts', 'calendarRequests', 'calendarHours',
                    'calendarStaff', 'calendarHouses', 'coverageSuggestions', 'rosterProfile']
    for (const p of cb.pages.filter((x) => pageGateAllows(x.gate, staff))) {
      const text = JSON.stringify(p)
      for (const r of estate) assert.ok(!text.includes(`"${r}"`), `${p.id} names ${r}`)
    }
  })
  it('every link in the code points at the new addresses', () => {
    assert.equal(HOUSE_CAL_PATH, '/app/calendarbuilder/house-cal')
    assert.equal(REQUESTS_PATH, '/app/calendarbuilder/requests')
    assert.match(read('server/shift_requests.py'), /^DEEP_LINK_PATH = "\/#\/app\/calendarbuilder\/house-cal"$/m)
    assert.match(read('server/web_notices.py'), /^REQUESTS_HREF = "\/app\/calendarbuilder\/requests"$/m)
    assert.match(read('server/web_notices.py'), /^HOUSE_CAL_HREF = "\/app\/calendarbuilder\/house-cal"$/m)
  })
  it('the redirect stands above the installed guard, and the page guard lands a reader on a page they may open', () => {
    const page = read('src/pages/AppRoutePage.tsx')
    const body = page.slice(page.indexOf('export default function AppRoutePage'))
    assert.ok(body.indexOf('SHIFT_BOARD_MOVED_TO') < body.indexOf('if (!app || !app.enabled)'))
    assert.match(body, /Navigate to=\{`\/app\/calendarbuilder\/\$\{movedTo\}\$\{search\}`\}/)
    assert.match(body, /page\?\.gate && role !== 'onboarding' && !isAllowedWith\(apps, role, app\.id, page\.id\)/)
  })
})

describe('the one checker, page by page', () => {
  const apps = [...calendarBuilderManifests, ...shiftsSuiteManifests] as AppManifest[]
  const cb = apps[0]
  const as = (user: Record<string, unknown>) =>
    useAuthStore.setState({ user: { id: 'u1', name: 'Ann Roe', email: '', ...user } } as never)
  afterEach(() => {
    useAuthStore.setState({ user: null } as never)
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {} })
  })
  const rules = { calendarbuilder: ['DIRECTOR', 'ADMINISTRATOR', 'ADMIN', 'ENTITY', 'MANAGER', 'HM', 'STAFF', 'CLIENT', 'GUARDIAN'] }

  it('a member of staff opens the app and is offered the calendar screen, Requests and the calendars — never the Builder view', () => {
    useBadgeAccessStore.setState({ rules })
    as(staff)
    assert.equal(isAllowedWith(apps, 'staff', 'calendarbuilder'), true)
    assert.equal(isAllowedWith(apps, 'staff', 'calendarbuilder', 'builder'), false)
    assert.equal(isAllowedWith(apps, 'staff', 'calendarbuilder', 'house-cal'), true)
    const ids = allowedPages(cb, 'staff', (a, p) => isAllowedWith(apps, 'staff', a, p)).map((p) => p.id)
    // the old House Calendar board is Live's week now, and the Builder is a view of the one screen: routed, never listed
    assert.deepEqual(ids, ['house-cal', 'requests', 'swaps', 'cards', 'timeline', 'week'])
  })
  it('a house manager worn by code opens the Builder view, from the same one entry, never the estate-wide screens', () => {
    useBadgeAccessStore.setState({ rules })
    as(derivedHm)
    assert.equal(isAllowedWith(apps, 'staff', 'calendarbuilder', 'builder'), true, 'the Builder view still has its gate')
    const ids = allowedPages(cb, 'staff', (a, p) => isAllowedWith(apps, 'staff', a, p)).map((p) => p.id)
    assert.deepEqual(ids, ['house-cal', 'requests', 'swaps', 'cards', 'timeline', 'week'])
  })
  it('a client lands on Shift Cards, as on the Shift Board, and is never offered Requests or House Calendars', () => {
    useBadgeAccessStore.setState({ rules })
    as({ role: 'client', types: [] })
    const ids = allowedPages(cb, 'client', (a, p) => isAllowedWith(apps, 'client', a, p)).map((p) => p.id)
    assert.equal(ids[0], 'cards')
    assert.ok(!ids.includes('requests') && !ids.includes('house-cal'), ids.join(','))
  })
  it('a director gets every listed screen, and the routed-only ones still open', () => {
    useBadgeAccessStore.setState({ rules })
    as(director)
    const offered = cb.pages.filter((p) => !(p.config as { hidden?: boolean } | undefined)?.hidden)
    assert.deepEqual(cb.pages.filter((p) => !offered.includes(p)).map((p) => p.id).sort(),
      ['builder', 'calendar', 'coverage', 'houses'], 'the Builder view, the old board, Houses and Shifts & Coverage route without an entry')
    assert.equal(allowedPages(cb, 'staff', (a, p) => isAllowedWith(apps, 'staff', a, p)).length, offered.length)
    for (const id of ['builder', 'calendar', 'coverage', 'houses']) {
      assert.equal(isAllowedWith(apps, 'staff', 'calendarbuilder', id), true, id)
    }
  })
  it('the app\'s own row still decides the app — a page gate never opens a closed app', () => {
    useBadgeAccessStore.setState({ rules: { calendarbuilder: ['DIRECTOR'] } })
    as(derivedHm)
    assert.equal(isAllowedWith(apps, 'staff', 'calendarbuilder', 'builder'), false)
  })
})

describe('the page switcher', () => {
  const cb = calendarBuilderManifests[0]
  const listed = cb.pages.filter((p) => !(p.config as { hidden?: boolean } | undefined)?.hidden)
  it('lists exactly these ten, in this order: the calendar screen once, for both its views', () => {
    assert.deepEqual(switchItems(listed).map((i) => i.title), [
      'Smart Comms', 'Calendar Builder', 'Conflicts', 'Hours', 'Staff Preferences', 'Requests',
      'Swaps', 'Shift Cards', 'Shift Timeline', 'Staff Schedule',
    ])
    assert.ok(!switchItems(listed).some((i) => /House Calendar|^Builder$|Houses|Shifts & Coverage/.test(i.title)))
  })
  it('groups the screens under their headings, in the order they first appear', () => {
    const all = switchItems(listed)
    assert.deepEqual(groupItems(all).map((g) => g.group), ['Build', 'Requests', 'Calendars'])
    assert.deepEqual(groupItems(all)[0].items.map((i) => i.id), ['smartcomms', 'house-cal', 'conflicts', 'hours', 'staff'])
    assert.deepEqual(groupItems(all)[2].items.map((i) => i.id), ['cards', 'timeline', 'week'])
  })
  it('offers only what it is handed — a member of staff gets the calendar screen and no estate-wide screen', () => {
    const mine = switchItems(listed.filter((p) => pageGateAllows(p.gate, staff)))
    assert.deepEqual(groupItems(mine).map((g) => g.group), ['Build', 'Requests', 'Calendars'])
    assert.deepEqual(groupItems(mine)[0].items.map((i) => i.id), ['house-cal'])
  })
  it('both views light the one entry, and picking it again keeps the view, house and cell', () => {
    assert.equal(menuPageId(cb, 'builder'), 'house-cal')
    assert.equal(menuPageId(cb, 'house-cal'), 'house-cal')
    assert.equal(menuPageId(cb, 'requests'), 'requests')
    assert.equal(menuPageId(undefined, 'builder'), 'builder')
    const page = read('src/pages/features/calendarbuilder/CalendarBuilderPage.tsx')
    assert.match(page, /const entry = menuPageId\(app, pageId\)/)
    assert.match(page, /current=\{entry\}/)
    assert.match(page, /onPick=\{\(id\) => \{ if \(id !== entry\) navigate\(`\/app\/\$\{APP_ID\}\/\$\{id\}`\) \}\}/)
    const bar = read('src/components/shell/Sidebar.tsx')
    assert.match(bar, /const lit = activePageId === null \? null : menuPageId\(app, activePageId\)/)
    assert.match(bar, /p\.id === lit \?/)
  })
  it('stands after Refresh in the header, and is the platform\'s one menu', () => {
    const page = read('src/pages/features/calendarbuilder/CalendarBuilderPage.tsx')
    const header = page.slice(page.indexOf('<PageHeader'), page.indexOf('</BuilderRefreshTick.Provider>'))
    assert.ok(header.indexOf('Refresh') < header.indexOf('<PageSwitchMenu'))
    assert.doesNotMatch(page, /SegmentedTabs/)
    assert.match(read('src/pages/features/smartcomms/PageSwitch.tsx'), /<PageSwitchMenu/)
  })
})

/* ── the row and its panel ─────────────────────────────────────────────── */

const WINDOW = { kind: 'call_off', opens_at: '2026-09-24T12:00:00Z', closes_at: '2026-09-24T17:00:00Z',
                 state: 'open', seconds_left: 3600, reserved: false, why: '' }
const card = (over: Partial<ShiftCard> = {}): ShiftCard => ({
  ref: 'SPCALLOFF01', location: 'CAN - JH - ABD2704', kind: 'call_off', state: 'open', window: WINDOW,
  link: '/#/app/calendarbuilder/house-cal?house=CAN%20-%20JH%20-%20ABD2704&ref=SPCALLOFF01',
  applicant_count: 2, filled: false,
  house: 'JH', house_name: 'JH home', code: 'ABD2704', address: '2704 Abbot Dr', col_iso: '2026-09-24',
  shift_code: '7A-3P', shift_start: '2026-09-24T11:00:00Z', shift_end: '2026-09-24T19:00:00Z', hours: 8,
  manager: 'Mia Manager', managers: ['Mia Manager'], managers_readable: true,
  urgent: { known: false, why: 'the relay keeps no copy of that send' },
  ...over,
})
const called = { by: 'Zed Caller', at: '2026-09-24T12:00:00Z', road: 'tracker', road_words: 'a Call Off Tracker row',
                 filed_by: 'Boyd Bailey', reason: 'Mother was in the hospital', reason_why: '', readable: true, why: '' }

describe('what a row leads with', () => {
  it('the house by name, code and street; the day, the clock with its code, and the hours', () => {
    assert.equal(placeLine(card()), 'JH home · ABD2704 · 2704 Abbot Dr')
    assert.equal(shiftLine(card(), '2026-09-24'), 'Today · 7:00 AM – 3:00 PM (7A-3P) · 8h')
    assert.equal(clockSpan('', ''), '')
  })
  it('the window with its time left, and the three other states in words', () => {
    const now = Date.parse('2026-09-24T16:50:00Z')
    assert.equal(windowLine('open', WINDOW, now), 'Applications open to everyone — close 1:00 PM · 10m 0s left')
    assert.match(windowLine('closed', WINDOW, now), /^Applications closed at 1:00 PM — the house manager decides$/)
    assert.equal(windowLine('filled', WINDOW, now), 'Given')
  })
  it('the URGENT OPEN SHIFT: sent, held in test mode, or where its record is — never "not sent" for want of a copy', () => {
    assert.equal(urgentLine({ known: true, state: 'sent', sent: 41, at: '2026-09-24T12:05:00Z', why: '' }),
                 'URGENT OPEN SHIFT sent to 41 people at 8:05 AM')
    assert.match(urgentLine({ known: true, state: 'held', held: 3, why: '' }), /held, not sent to staff/)
    assert.match(urgentLine({ known: true, state: 'deferred', sent: 0, why: 'held by the quiet window' }),
                 /deferred by the quiet hours/)
    assert.equal(urgentLine({ known: true, state: 'not_sent', sent: 0, why: 'switched off' }),
                 'URGENT OPEN SHIFT not sent — switched off')
    assert.doesNotMatch(urgentLine({ known: true, state: 'deferred', sent: 0, why: '' }), /sent to 0/)
    assert.match(urgentLine(card().urgent), /Smart Comms → Activity/)
    assert.doesNotMatch(urgentLine(card().urgent), /not sent/)
  })
  it('who called off, when, by which road and why — only when the relay sent it', () => {
    assert.equal(calledOffLine(called).startsWith('Called off by Zed Caller · '), true)
    assert.match(calledOffLine(called), /a Call Off Tracker row \(filed by Boyd Bailey\)$/)
    assert.equal(reasonLine(called), '“Mother was in the hospital”')
    assert.equal(reasonLine({ ...called, reason: '', reason_why: 'the tracker row gives no reason' }),
                 'the tracker row gives no reason')
    assert.equal(calledOffLine(undefined), '')
  })
})

describe('export, share and print carry no more than the screen', () => {
  const row = (over: Partial<RequestRow> = {}): RequestRow => ({
    id: 'r1', kind: 'call_off', at: '2026-09-24T12:10:00Z', house: 'JH', location: 'CAN - JH - ABD2704',
    col_iso: '2026-09-24', ref: 'SPCALLOFF01', shift: '7A-3P', person: 'Dee Way', state: 'applied', why: '',
    via: 'app', decided_by: '', decided_at: '', mine: true, visible: true, ...over,
  })
  it('a staff member\'s export has the facts and an empty caller and reason — the relay did not send them', () => {
    const [out] = exportRows([row()], { SPCALLOFF01: card() }, 0)
    assert.equal(out.code, 'ABD2704')
    assert.equal(out.address, '2704 Abbot Dr')
    assert.equal(out.clock, '7:00 AM – 3:00 PM')
    assert.equal(out.called_off, '')
    assert.equal(out.reason, '')
  })
  it('a house manager\'s export carries what their card carries', () => {
    const [out] = exportRows([row()], { SPCALLOFF01: card({ called_off: called }) }, 0)
    assert.match(String(out.called_off), /Zed Caller/)
    assert.equal(out.reason, 'Mother was in the hospital')
  })
  it('the call-offs tab exports its own rows', () => {
    const s = { key: 'SPCALLOFF01', ref: 'SPCALLOFF01', location: 'CAN - JH - ABD2704', house: 'JH', open_row: '',
                col_iso: '2026-09-24', value: '7A-3P', kind: 'call_off', window: WINDOW, state: 'open',
                shift_start: '2026-09-24T11:00:00Z', shift_end: '2026-09-24T19:00:00Z', called_off_by: '',
                reason: '', filled_by: '', filled_how: '', decided_by: '', closed_at: '', applicants: [],
                applicant_count: 2 } as PoolShift
    const [out] = callOffExportRows([s], { SPCALLOFF01: card() }, 0)
    assert.equal(out.applicant_count, 2)
    assert.equal(out.called_off, '')
  })
  it('the person cut finds a swap by either side', () => {
    const rows = [row(), row({ id: 's', kind: 'swap', person: 'Ben Left', from_staff: 'Eve Gone', to_staff: 'Ben Left' })]
    assert.deepEqual(filterRows(rows, { person: 'Eve Gone' }).map((r) => r.id), ['s'])
  })
})

describe('time off, one tab of Requests', () => {
  const off = (over: Partial<TimeOffRow> = {}): TimeOffRow => ({
    id: 'TO1', kind: 'time_off', person: 'Ann Roe', start: '2026-09-30', end: '2026-10-02', days: 3,
    calendar_name: 'ANN R', asked: '2026-09-21T18:08:11.000Z', state: 'upcoming', decided_by: 'Mia Manager',
    decided_why: 'waiting on the director',
    houses: ['ABD2704'], mine: false, visible: true,
    ref: 'TO1A2B3C4D5E', status: 'pending', link: '/app/timeoff/requests?ref=TO1A2B3C4D5E', filed_via: 'platform',
    hm: { state: 'approved', by: 'Mia Manager', via: 'platform', at: '2026-09-22T12:00:00.000Z' },
    dir: { state: 'waiting', by: '', via: '', at: '' }, house_labels: ['JH'],
    displaced: [
      { house: 'JH', location: 'CAN - JH - ABD2704', col_iso: '2026-09-30', value: '7A-3P', working: true, covered: false, why: 'still on the calendar under their name' },
      { house: 'JH', location: 'CAN - JH - ABD2704', col_iso: '2026-10-01', value: 'R/O', working: false, covered: true, why: 'every open shift at this house that day was given' },
      { house: 'JH', location: 'CAN - JH - ABD2704', col_iso: '2026-10-02', value: 'R/O', working: false, covered: null, why: 'no open shift was put up at this house that day' },
    ],
    ...over,
  })
  it('says what the dates do to the shifts they touch — a missing open shift is never "covered"', () => {
    assert.equal(displacedLine(off()),
      '1 shift still on the calendar under their name · 1 day off with every open shift given · 1 day off with no open shift put up')
    assert.equal(displacedLine(off({ displaced: [] })), 'Touches no shift on a drawn calendar')
  })
  it('is cut by house, person, state and a day the time off covers', () => {
    const rows = [off(), off({ id: 'TO2', person: 'Ben Left', houses: ['BM4060'], start: '2026-08-01', end: '2026-08-01', state: 'past' })]
    assert.deepEqual(filterTimeOff(rows, { house: 'BM4060' }).map((t) => t.id), ['TO2'])
    assert.deepEqual(filterTimeOff(rows, { day: '2026-10-01' }).map((t) => t.id), ['TO1'])
    assert.deepEqual(filterTimeOff(rows, { state: 'past' }).map((t) => t.id), ['TO2'])
    assert.deepEqual(timeOffCutsFrom(rows).houses, ['ABD2704', 'BM4060'])
  })
  it('its panel carries the status, both halves and a link to where it is decided — never a second place to decide', () => {
    const p = timeOffPanel(off(), '2026-09-24')
    const text = JSON.stringify(p.config)
    assert.match(text, /Mia Manager · Approved · via Platform/)
    assert.match(text, /"Director","value":"Waiting"/)
    assert.match(text, /"Status","value":"Waiting — waiting on the director"/)
    assert.match(JSON.stringify(timeOffPanel(off({ status: 'needs_review', decided_why: '' }), '2026-09-24').config),
      /"Status","value":"Needs review"/)
    assert.match(text, /"href":"\/app\/timeoff\/requests\?ref=TO1A2B3C4D5E"/)
    assert.equal(text.includes('2026-09-21T18:08:11'), false)
    assert.match(text, /still on the calendar under their name/)
  })
  it('its export names the status, both halves as the Time Off app words them, and the house names', () => {
    const out = timeOffExportRows([off()])[0]
    assert.equal(out.status, 'Waiting')
    assert.equal(out.house_manager, 'Mia Manager · Approved · via Platform')
    assert.equal(out.director, 'Waiting')
    assert.equal(out.houses, 'JH')
    assert.equal(out.ref, 'TO1A2B3C4D5E')
  })
})

describe('the panel a row opens', () => {
  const detail = (over: Partial<ShiftDetail> = {}): ShiftDetail => ({
    ...card({ called_off: called }),
    eligible: { may_apply_now: 12, free: 30, of: 90, why: '' },
    applicants: [{ id: 'a1', person: 'Dee Way', state: 'applied', why: '', via: 'sms', at: '2026-09-24T12:10:00Z',
                   week_hours: 24, decided_by: '', decided_at: '', live: true,
                   ist: { ok: false, state: 'missing', why: 'no IST for JH' }, regular: true, overlap: '' }],
    manager_availability: [{ name: 'Mia Manager', free: false, why: 'busy — that overlaps the 7A-3P shift at MS on 2026-09-24' }],
    mine: null, at: '', ...over,
  })
  it('a staff member\'s panel has no call-off section — the relay sent no caller and no reason', () => {
    const text = JSON.stringify(shiftPanel(card(), { today: '2026-09-24', nowMs: 0, detail: null }).config)
    assert.doesNotMatch(text, /The call-off/)
    assert.doesNotMatch(text, /Zed Caller/)
    assert.match(text, /2704 Abbot Dr/)
    assert.match(text, /\/app\/calendarbuilder\/house-cal\?house=CAN%20-%20JH%20-%20ABD2704&ref=SPCALLOFF01/)
  })
  it('the house manager\'s panel weighs every applicant for that house and says whether the manager is free', () => {
    const text = JSON.stringify(shiftPanel(card({ called_off: called }), { today: '2026-09-24', nowMs: 0, detail: detail() }).config)
    assert.match(text, /Mother was in the hospital/)
    assert.match(text, /no IST here — a training · a regular · 24h that week · no overlap · applied 8:10 AM by sms/)
    assert.match(text, /12 may apply now · 30 of 90 on the calendars are free for its hours/)
    assert.match(text, /busy — that overlaps/)
  })
  it('while the detail is read the counts say so, and a detail that failed is said — never a zero', () => {
    const reading = shiftPanel(card(), { today: '2026-09-24', nowMs: 0, detail: null }).config as { stats: { value: unknown }[] }
    assert.equal(reading.stats[1].value, '…')
    const failed = shiftPanel(card(), { today: '2026-09-24', nowMs: 0, detail: null, detailWhy: 'the relay answered 502' })
    assert.equal((failed.config as { stats: { value: unknown }[] }).stats[1].value, '—')
    assert.match(JSON.stringify(failed.config), /could not be read — the relay answered 502/)
  })
  it('a swap says both consents with their road and time, and who approves', () => {
    const r = {
      id: 'h1', kind: 'swap', at: '', house: 'JH', location: 'CAN - JH - ABD2704', col_iso: '2026-09-24',
      shift: '7A-3P', person: 'Ben Left', state: 'pending', why: '', via: '', decided_by: '', decided_at: '',
      from_staff: 'Eve Gone', to_staff: 'Ben Left', staff_state: 'yes', staff_via: 'sms', staff_at: '2026-09-24T12:00:00Z',
      manager_state: 'pending', approval: { mode: 'house_manager', names: ['Mia Manager'], why: '' },
      mine: false, visible: true,
    } as RequestRow
    const text = JSON.stringify(swapPanel(r, '2026-09-24').config)
    assert.match(text, /Eve Gone/)
    assert.match(text, /yes · by sms/)
    assert.match(text, /Mia Manager/)
  })
})
