/**
 * Scheduling · the registry entry, the route, the master-only release and the screen drawn from a board: OPEN rows
 * above the people, symbol badges where the hours would be for anybody but the master, the test-mode banner even when
 * the board could not be read, and Add Somebody then Add Shift at the far right of the top bar. No App Control row
 * ships with it — the app is the master's alone until released (lib/badgeAccess).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { appManifests } from '@/registry/apps'
import { SCHEDULING_APP_ID, schedulingManifests } from '@/registry/apps-scheduling'
import { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { badgeAllowsApp } from '@/lib/badgeAccess'
import SchedulingPage, { PICK_PERIOD_NOTICE, SchedulingView, swapsShifts, type Pick } from '@/pages/features/scheduling/SchedulingPage'
import ShiftPanel from '@/pages/features/scheduling/ShiftPanel'
import ShiftForm from '@/pages/features/scheduling/ShiftForm'
import { FreePicker } from '@/pages/features/scheduling/SwapPanel'
import { SwapAskBody } from '@/pages/features/scheduling/SwapShiftsPanel'
import { FlowPanel, ItemPanel, MineCard, TEST_MODE_ITEM, WaitingCard } from '@/pages/features/scheduling/FlowCards'
import { SCHEDULING_ACTIONS, type TimeOffAsk } from '@/pages/features/scheduling/schedulingLane'
import { AskPanel, askHistory, askStatus, seatLine } from '@/pages/features/scheduling/TimeOffRequests'
import {
  EXCHANGE_CHECKS, HOURS_HIDDEN_LINE, TEST_MODE_UNREAD_WORDS, TEST_MODE_WORDS, TRAINING_PICK_LINE, boardFrom, boardNowMs, busyWeekMinutes,
  clashFor, dragKeys, dropPlan,
  SWAP_ASK_STAFF, badgeList, exchangeBlock, exchangePlanSteps, freePeople, hmOrAbove, istMissingAt, itemFlow, mayWithdraw, mergeWrite,
  openCount, otherPeriodOf, phonesOf,
  pendingFlowLine, pickMarks, shiftAt, swapSteps, trainingTitle, upcomingShifts, type Board, type PickMark,
} from '@/pages/features/scheduling/schedulingModel'
import type { BoardState } from '@/pages/features/scheduling/schedulingLane'
import { SHELL_HIDDEN, primeShellHides, withoutTestWords } from '@/lib/myWorkHides'
import { sheetReloadFrom, sheetReloadWords } from '@/pages/features/scheduling/SheetReload'

// the screens below draw their test mode warnings, as Settings › My Work shows them when the switch says so
primeShellHides({ ...SHELL_HIDDEN, test_mode_warnings: false })

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const NO = { hm: false, lead: false, med: 0 }
const COLS = [
  { iso: '2026-10-03', date: '10/3', short: 'Oct 3', weekday: 'SAT' },
  { iso: '2026-10-04', date: '10/4', short: 'Oct 4', weekday: 'SUN' },
]

function fixture(viewer: Record<string, unknown>, over: Record<string, unknown> = {}): Board {
  const hours = viewer.is_master === true
  return boardFrom({
    ok: true, now: '2026-10-03T12:00:00Z', today: '2026-10-03',
    period: { id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' },
    periods: [{ id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' }],
    houses: [{ code: 'BM4060', location: 'CAN - BM - BM4060', short: 'BM', staff: 2, managers: ['Mia Manager'], open: 1 }],
    viewer: { uid: 'U1', name: 'Ann Roe', key: 'annroe', is_master: false, is_director: false, editor_of: [], can_edit_any: false, ...viewer },
    test_mode: { on: false, readable: true, why: '' },
    display: { hidden: { hours: !hours } },
    settings: { min_days_ahead: 7, outreach_wait_min: 7, cycle_days: 28, roll_lead_days: 7, directors: ['Ty Bond'], directors_readable: true },
    grids: {
      BM4060: {
        code: 'BM4060', cols: COLS,
        rows: [
          { row_id: 'P:miamanager', kind: 'person', name: 'Mia Manager', key: 'miamanager', designation: '**',
            badges: { hm: true, lead: false, med: 3 }, me: false,
            ...(hours ? { hours: { period: 24, by_week: { '2026-10-03': 16 } } } : {}),
            cells: [{ text: '8A-4P', kind: 'morning', state: 'scheduled' }, { text: '8A-4P', kind: 'morning', state: 'scheduled' }] },
          { row_id: 'P:annroe', kind: 'person', name: 'Ann Roe', key: 'annroe', designation: '', badges: { ...NO, med: 1, lead: true }, me: true,
            cells: [{ text: '4P-12A', kind: 'evening', state: 'scheduled' }, { text: '', kind: 'alias', state: 'scheduled', echo: '48TH (B)' }] },
          { row_id: 'OPEN:1', kind: 'open', name: 'OPEN', key: '', designation: '', badges: NO, me: false,
            cells: [{ text: '12A-8A', kind: 'overnight', state: 'open' }, null] },
        ],
        days: [{ iso: '2026-10-03', working: 2, ...(hours ? { hours: 16 } : {}) }, { iso: '2026-10-04', working: 1, ...(hours ? { hours: 8 } : {}) }],
      },
    },
    busy: {}, people: [], mine: [], waiting_on_me: [],
    ...over,
  })
}

const ready = (board: Board): BoardState => ({ status: 'ready', board, error: '', refreshing: false })
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (state: BoardState, master = false) => flat(renderToString(createElement(MemoryRouter,
  { initialEntries: ['/app/scheduling/calendar?house=BM4060'] },
  createElement(SchedulingView, { state, sessionMaster: master, onReload: () => {}, onAbsorb: () => {} }))))

describe('scheduling — the app', () => {
  it('is one app with one calendar page, registered once', () => {
    assert.equal(schedulingManifests.length, 1)
    const manifest = schedulingManifests[0]
    assert.equal(manifest.id, SCHEDULING_APP_ID)
    assert.equal(manifest.id, 'scheduling')
    assert.equal(manifest.name, 'Scheduling')
    assert.equal(manifest.category, 'Operations')
    assert.deepEqual(manifest.audience, ['admin', 'manager', 'staff'])
    assert.deepEqual(manifest.pages.map((p) => p.id), ['calendar'])
    assert.equal(appManifests.filter((a) => a.id === SCHEDULING_APP_ID).length, 1)
  })

  it('its CUSTOM_PAGES route resolves to the page', async () => {
    assert.equal(await CUSTOM_PAGES['scheduling/calendar'].load(), SchedulingPage)
  })

  it('ships master-only: no badge row opens it to nobody else', () => {
    assert.equal(badgeAllowsApp(SCHEDULING_APP_ID, { types: ['STAFF'], role: 'staff' }, {}), false)
    assert.equal(badgeAllowsApp(SCHEDULING_APP_ID, { types: ['ADMIN'], role: 'admin' }, {}), false)
    assert.equal(badgeAllowsApp(SCHEDULING_APP_ID, { isMaster: true }, {}), true)
    // a row the master writes releases it by badge, as for every app
    assert.equal(badgeAllowsApp(SCHEDULING_APP_ID, { types: ['STAFF'], role: 'staff' }, { [SCHEDULING_APP_ID]: ['STAFF'] }), true)
  })

  it('calls only its own actions, each by its literal name', () => {
    assert.ok(SCHEDULING_ACTIONS.every((a) => a.startsWith('scheduling')))
    assert.equal(new Set(SCHEDULING_ACTIONS).size, 20)
  })

  it('every Scheduling write goes out once — My Work\'s Approve and Decline too (a re-sent answer would read as another\'s)', () => {
    const page = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'src/pages/features/mywork/MyWorkPage.tsx'), 'utf8')
    const call = /gasAction<[^>]*>\('schedulingAnswer',[^\n]*/.exec(page)?.[0] ?? ''
    assert.match(call, /\{ retry: false \}\)$/, call)
  })
})

describe('scheduling — the screen', () => {
  it('draws the OPEN row above the first person', () => {
    const html = draw(ready(fixture({})))
    const rows = [...html.matchAll(/data-row="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(rows, ['OPEN:1', 'P:miamanager', 'P:annroe'])
  })

  it('one house alone (Locations › House Calendar): its grid and its rows, no house dropdown, no other screen', () => {
    const html = flat(renderToString(createElement(MemoryRouter,
      { initialEntries: ['/app/locations/houses?house=BM4060&tab=calendar'] },
      createElement(SchedulingView, { state: ready(fixture({})), sessionMaster: false, onReload: () => {}, onAbsorb: () => {},
        houseOnly: 'BM4060' }))))
    assert.ok(html.includes('data-house-only="BM4060"') && html.includes('data-grid-card'))
    assert.ok(!html.includes('data-screen-switch') && !html.includes('aria-haspopup="listbox"'))
    assert.deepEqual([...html.matchAll(/data-row="([^"]+)"/g)].map((m) => m[1]), ['OPEN:1', 'P:miamanager', 'P:annroe'])
    const other = flat(renderToString(createElement(MemoryRouter, { initialEntries: ['/app/locations/houses?house=ZZ9999'] },
      createElement(SchedulingView, { state: ready(fixture({})), sessionMaster: false, onReload: () => {}, onAbsorb: () => {},
        houseOnly: 'ZZ9999' }))))
    assert.ok(other.includes('Scheduling shows you no calendar for this house.'))
  })

  it('a staff member sees the badges and no hours anywhere', () => {
    const html = draw(ready(fixture({})))
    assert.ok(!html.includes('Hrs ('), 'no hours column')
    assert.ok(!/\d+ · \d+h/.test(html), 'no hours in the day totals')
    assert.ok(html.includes('data-badge="hm"') && html.includes('title="House manager"'))
    assert.ok(html.includes('data-badge="med-3"') && html.includes('data-tone="gold"'))
    assert.ok(html.includes('title="Medication Administration 1"') && html.includes('data-tone="bronze"'))
    assert.deepEqual(badgeList({ hm: false, lead: false, med: 3, meds: [1, 2, 3] }).map((b) => b.label),
      ['Medication Administration 1', 'Medication Administration 2', 'Medication Administration 3'], 'every level held, not the highest alone')
    assert.ok(html.includes('title="Team leader"'))
    assert.ok(html.includes('data-you=""'), 'the viewer\'s own row says You')
    assert.ok(html.includes('@48TH (B)'), 'the echo of a shift at another house')
    assert.ok(!html.includes(HOURS_HIDDEN_LINE))
    assert.ok(html.includes('data-legend=""') && !/>Key</.test(html), 'the legend is always drawn, with no Key button')
    assert.ok(!html.includes('data-on-shift'), 'the ON SHIFT row is the master\'s alone (the operator, 10-31)')
  })

  it('the master sees the hours column, the ON SHIFT row with its totals, and the line saying who does not', () => {
    const html = draw(ready(fixture({ is_master: true, key: '' })), true)
    assert.ok(html.includes('Hrs (week)'))
    assert.ok(html.includes('data-on-shift=""') && html.includes('2 · 16h'))
    assert.ok(html.includes(HOURS_HIDDEN_LINE))
  })

  it('the test-mode banner is drawn when test mode holds, and when the board could not be read', () => {
    assert.ok(draw(ready(fixture({}, { test_mode: { on: true, readable: true, why: '' } }))).includes(TEST_MODE_WORDS))
    assert.ok(!draw(ready(fixture({}))).includes(TEST_MODE_WORDS))
    const failed = draw({ status: 'failed', board: null, error: 'timeout', refreshing: false })
    assert.ok(failed.includes(TEST_MODE_WORDS))
    assert.ok(failed.includes(TEST_MODE_UNREAD_WORDS))
    assert.ok(failed.includes('The calendar could not be read — timeout.'))
    assert.ok(failed.indexOf('data-top-bar') < failed.indexOf('data-test-mode'), 'under the top bar')
  })

  it('Settings › My Work hides every test mode warning from anyone but the master: no banner, held or failed', () => {
    primeShellHides({ ...SHELL_HIDDEN })
    try {
      const held = draw(ready(fixture({}, { test_mode: { on: true, readable: true, why: '' } })))
      const failed = draw({ status: 'failed', board: null, error: 'timeout', refreshing: false })
      assert.ok(!held.includes(TEST_MODE_WORDS) && !held.includes('data-test-mode'))
      assert.ok(!failed.includes(TEST_MODE_WORDS) && failed.includes('The calendar could not be read — timeout.'))
      assert.equal(withoutTestWords('Approved by Ty · 2 days · Test mode'), 'Approved by Ty · 2 days')
      assert.equal(withoutTestWords('Approved by Ty'), 'Approved by Ty')
    } finally {
      primeShellHides({ ...SHELL_HIDDEN, test_mode_warnings: false })
    }
  })

  it('an editor gets Add Somebody then Add Shift, at the far right of the top bar', () => {
    const html = draw(ready(fixture({ editor_of: ['BM4060'] })))
    const bar = html.slice(html.indexOf('data-top-actions'), html.indexOf('data-grid-card'))
    const acts = [...bar.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(acts.slice(-2), ['add-somebody', 'add-shift'])
    assert.ok(bar.indexOf('Add Somebody') < bar.indexOf('Add Shift'))
    assert.deepEqual([...draw(ready(fixture({}))).matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]), ['swap-shifts', 'time-off'], 'staff: Swap shifts and Time off')
  })

  it('the banner holds while the board is still being read: test mode is not known to be off yet', () => {
    const loading = draw({ status: 'loading', board: null, error: '', refreshing: false })
    assert.ok(loading.includes(TEST_MODE_WORDS))
    assert.ok(!loading.includes(TEST_MODE_UNREAD_WORDS), 'not "could not be read" while it is being read')
  })

  it('every cell is named for a screen reader (who, which day, what), and the badges are images', () => {
    const html = draw(ready(fixture({})))
    const cells = [...html.matchAll(/<button type="button"[^>]*data-iso="[^"]+"[^>]*>/g)].map((m) => m[0])
    assert.ok(cells.length >= 6 && cells.every((b) => /aria-label="[^"]+ · Oct \d+ · [^"]+"/.test(b)), cells[0])
    assert.ok([...html.matchAll(/data-badge="[^"]+"/g)].length >= 3 &&
      [...html.matchAll(/<span role="img"[^>]*data-badge=/g)].length === [...html.matchAll(/data-badge="[^"]+"/g)].length)
  })
})

/* ---------- the shift panel and the free lists ---------- */

const COLS3 = [
  { iso: '2026-10-03', date: '10/3', short: 'Oct 3', weekday: 'SAT' },
  { iso: '2026-10-06', date: '10/6', short: 'Oct 6', weekday: 'TUE' },
  { iso: '2026-10-13', date: '10/13', short: 'Oct 13', weekday: 'TUE' },
]
const SHIFT = (text: string, start: number, end: number, more: Record<string, unknown> = {}) =>
  ({ text, kind: 'evening', start, end, state: 'scheduled', ...more })

function panelBoard(viewer: Record<string, unknown>, annCells: unknown[], over: Record<string, unknown> = {}): Board {
  return boardFrom({
    ok: true, now: '2026-10-03T12:00:00Z', today: '2026-10-03',
    period: { id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' },
    periods: [{ id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' },
              { id: 'P2026-10-26', first: '2026-10-26', last: '2026-11-22', state: 'live' }],
    houses: [{ code: 'BM4060', location: 'CAN - BM - BM4060', short: 'BM', staff: 2, managers: ['Mia Manager'], open: 9 }],
    viewer: { uid: 'U1', name: 'Ann Roe', key: 'annroe', is_master: false, is_director: false, editor_of: [], can_edit_any: false, ...viewer },
    test_mode: { on: true, readable: true, why: '' }, display: { hidden: { hours: true } },
    settings: { min_days_ahead: 7, outreach_wait_min: 7, cycle_days: 28, roll_lead_days: 7, directors: ['Ty Bond'], directors_readable: true },
    grids: {
      BM4060: {
        code: 'BM4060', cols: COLS3,
        rows: [
          { row_id: 'OPEN:1', kind: 'open', name: 'OPEN', key: '', designation: '', badges: NO, me: false,
            cells: [SHIFT('12A-8A', 0, 8, { kind: 'overnight', state: 'open' }), SHIFT('4P-12A', 16, 24, { state: 'open' }), null] },
          { row_id: 'P:miamanager', kind: 'person', name: 'Mia Manager', key: 'miamanager', designation: '**',
            badges: { hm: true, lead: false, med: 3 }, me: false,
            cells: [SHIFT('8A-4P', 8, 16, { kind: 'morning' }), SHIFT('8A-4P', 8, 16, { kind: 'morning' }), { text: 'OFF', kind: 'off', state: 'scheduled' }] },
          { row_id: 'P:annroe', kind: 'person', name: 'Ann Roe', key: 'annroe', designation: '', badges: NO, me: true, cells: annCells },
        ],
        days: [],
      },
    },
    busy: {}, people: [{ key: 'miamanager', name: 'Mia Manager', has_account: true }, { key: 'annroe', name: 'Ann Roe', has_account: true },
                       { key: 'newhire', name: 'New Hire', has_account: false }],
    mine: [], waiting_on_me: [],
    ...over,
  })
}
const panel = (board: Board, rowId: string, iso: string) => flat(renderToString(createElement(ShiftPanel, {
  board, house: 'BM4060', target: { rowId, iso }, hours: false, clock: false, onClose: () => {}, onWrite: () => {}, onTimeOff: () => {},
  onSwap: () => {},
})))

describe('scheduling — drag and drop on the grid', () => {
  it('a dropped shift opens its workflow with the pair picked, or says why not; nothing is written', () => {
    const at = (rowId: string, iso: string) => ({ rowId, iso })
    const staff = panelBoard({}, [null, null, SHIFT('4P-12A', 16, 24)])
    const editor = panelBoard({ editor_of: ['BM4060'] }, [null, null, SHIFT('4P-12A', 16, 24)])
    const now = boardNowMs(staff)
    const drop = (b: Board, from: ReturnType<typeof at>, to: ReturnType<typeof at>) => dropPlan(b, 'BM4060', from, to, now)
    // an OPEN shift: the editor's Assign with the person picked, the staff's own Take; on its own day only
    assert.deepEqual(drop(editor, at('OPEN:1', '2026-10-06'), at('P:annroe', '2026-10-06')),
      { kind: 'assign', open: at('OPEN:1', '2026-10-06'), key: 'annroe' })
    assert.equal(drop(editor, at('OPEN:1', '2026-10-06'), at('P:annroe', '2026-10-13'))?.kind, 'refused')
    assert.equal(drop(staff, at('OPEN:1', '2026-10-06'), at('P:annroe', '2026-10-06'))?.kind, 'take')
    assert.equal(drop(staff, at('OPEN:1', '2026-10-06'), at('P:miamanager', '2026-10-06'))?.kind, 'refused')
    // one's own shift: on another shift an exchange, on somebody's free day a give-away, on an OPEN row its own panel
    assert.equal(drop(staff, at('P:annroe', '2026-10-13'), at('P:miamanager', '2026-10-06'))?.kind, 'exchange')
    const away = drop(staff, at('P:annroe', '2026-10-13'), at('P:miamanager', '2026-10-13'))
    assert.ok(away?.kind === 'away' && away.key === 'miamanager' && away.give.text === '4P-12A')
    assert.deepEqual(drop(staff, at('P:annroe', '2026-10-13'), at('OPEN:1', '2026-10-13')), { kind: 'release', from: at('P:annroe', '2026-10-13') })
    // what staff may pick up: the OPEN shifts still ahead and their own
    assert.deepEqual([...dragKeys(staff, 'BM4060', now)].sort(), ['OPEN:1|2026-10-03', 'OPEN:1|2026-10-06', 'P:annroe|2026-10-13'])
  })
})

describe('scheduling — the shift panel', () => {
  it('a shift taken from OPEN, or got by a swap, is the person\'s own: Request Off, Call Off, Swap and Time off', () => {
    for (const [state, kind] of [['taken', 'take'], ['swap_in', 'swap']] as const) {
      const cell = SHIFT('4P-12A', 16, 24, { state, flow: { id: 'SF1', kind, state: 'done' } })
      const mine = [{ id: 'SF1', kind, state: 'done', house_code: 'BM4060', date: '2026-10-13', person: 'Bo', shift_text: '4P-12A', seats: [] }]
      const html = panel(panelBoard({}, [null, null, cell], { mine }), 'P:annroe', '2026-10-13')
      assert.ok(html.includes('data-panel-mode="own"') && html.includes('data-own=""'), state)
      for (const w of ['Request Off', 'Call Off', 'Swap', 'Time off']) assert.ok(html.includes(w), `${state}: ${w}`)
    }
  })

  it('the Employee field: the holder gives the shift through a swap; an editor gives it to any of the house\'s staff', () => {
    const cell = SHIFT('4P-12A', 16, 24)
    const own = panel(panelBoard({}, [null, null, cell]), 'P:annroe', '2026-10-13')
    assert.ok(own.includes('data-employee-swap=""') && own.includes('data-shift-facts=""'))
    assert.ok(!own.includes('data-cell-means') && !own.includes('Or the code, as the houses write it'))
    assert.ok(own.includes('<option value="miamanager">Mia Manager</option>') && !own.includes('New Hire'), 'free and with an account')
    const editor = panel(panelBoard({ editor_of: ['BM4060'] }, [null, null, cell]), 'P:annroe', '2026-10-13')
    assert.ok(editor.includes('data-shift-form="edit"') && editor.includes('data-house-staff=""') && !editor.includes('data-shift-facts'))
    assert.ok(!editor.includes('data-employee-swap') && !editor.includes('Or the code, as the houses write it'))
    // the house's person rows, the holder picked; nobody outside the house
    assert.match(editor, /data-house-staff=""[^]*<option value="miamanager">Mia Manager<\/option><option value="annroe" selected="">Ann Roe<\/option><\/select>/)
    assert.ok(!editor.includes('New Hire'))
    // an OFF day of somebody else's, for a calendar edition too: the same choice of who works it
    const listed = panel(panelBoard({ editions: ['scheduling.calendar', 'scheduling.swaps'] }, [null, null, null]), 'P:miamanager', '2026-10-06')
    assert.ok(listed.includes('data-house-staff=""') && !listed.includes('data-employee-swap'))
    assert.equal(hmOrAbove(panelBoard({}, [])), false)
    assert.equal(hmOrAbove(panelBoard({ editor_of: ['BM4060'] }, [])), true)
    assert.equal(SWAP_ASK_STAFF, 'Are you sure you want to swap your shift? This person will be notified to accept the change before it is approved.')
  })

  it('every person on the grid has their phone under the name', () => {
    assert.deepEqual(phonesOf([{ key: 'a', phone: '3305551234' }, { key: 'b', phone: '' }, { key: 'c' }]), { a: '(330) 555-1234' })
  })

  it('a shift with a request still waiting holds its own acts: Withdraw, and no second ask', () => {
    const cell = SHIFT('4P-12A', 16, 24, { flow: { id: 'SF2', kind: 'request_off', state: 'waiting' } })
    const mine = [{ id: 'SF2', kind: 'request_off', state: 'waiting', house_code: 'BM4060', date: '2026-10-13', shift_text: '4P-12A', seats: [] }]
    const html = panel(panelBoard({}, [null, null, cell], { mine }), 'P:annroe', '2026-10-13')
    assert.ok(html.includes('Withdraw') && !html.includes('data-own=""'))
  })

  it('an editor calls off for somebody under its own heading — one version, never "Live now"', () => {
    const html = panel(panelBoard({ editor_of: ['BM4060'] }, [null, null, null]), 'P:miamanager', '2026-10-06')
    assert.ok(html.includes('data-call-off-for=""') && html.includes('Call off for them') && !/Live now/.test(html))
  })

  it('take: somebody already working at that house that day is told why, and the press is off', () => {
    const html = panel(panelBoard({}, [null, SHIFT('8A-4P', 8, 16, { kind: 'morning' }), null]), 'OPEN:1', '2026-10-06')
    assert.ok(html.includes('data-take=""'))
    assert.ok(html.includes('Not possible: you already have 8A-4P at BM that day — a row holds one shift a day.'), html.slice(html.indexOf('data-take')))
  })
})

describe('scheduling — the free lists and what a write moves', () => {
  it('OFF is free; a shift at that house that day is not (one row, one cell); a swap needs an account', () => {
    const b = panelBoard({}, [null, null, null])
    const atBm = freePeople(b, '2026-10-13', [960, 1440], { house: 'BM4060' })
    assert.ok(atBm.free.some((p) => p.key === 'miamanager'), 'OFF that day: free, the add replaces it')
    const sameDay = freePeople(b, '2026-10-06', [960, 1440], { house: 'BM4060' })
    assert.deepEqual(sameDay.blocked.map((x) => [x.person.key, x.why]), [['miamanager', 'already has 8A-4P at BM that day']])
    const swap = freePeople(b, '2026-10-13', [960, 1440], { house: 'BM4060', needsAccount: true, except: 'annroe' })
    assert.ok(swap.blocked.some((x) => x.person.key === 'newhire' && /no platform account/.test(x.why)))
    assert.ok(!swap.free.some((p) => p.key === 'newhire'))
  })

  it('somebody else\'s call-off or time off reads only as "not free that day"; week hours count shifts, not days off', () => {
    const b = panelBoard({}, [null, null, null], { busy: { miamanager: [['2026-10-13', 0, 1440, '', 'day'], ['2026-10-06', 480, 960, 'BM4060', 'work']] } })
    assert.equal(clashFor(b, 'miamanager', '2026-10-13', 960, 1440)?.why, 'not free that day')
    assert.equal(busyWeekMinutes(b.busy.miamanager, '2026-10-03'), 480)
    assert.equal(busyWeekMinutes(b.busy.miamanager, '2026-10-10'), 0)
  })

  it('a write answer of another period moves flows and items, never this period\'s grids or busy days', () => {
    const b = panelBoard({}, [null, null, null], { busy: { annroe: [['2026-10-06', 960, 1440, 'BM4060', 'work']] } })
    const merged = mergeWrite(b, { ok: true, said: 'Asked.', period_id: 'P2026-10-26', grids: { BM4060: { ...b.grids.BM4060, cols: [] } },
      busy: { annroe: [['2026-10-30', 960, 1440, 'BM4060', 'work']] }, mine: [], test_mode: { on: true, readable: true, why: '' } })
    assert.deepEqual(merged.busy.annroe, b.busy.annroe)
    assert.equal(merged.grids.BM4060.cols.length, 3)
    const log = { BM4060: [{ id: 'SL1', at: 'x', by_name: 'M', house_code: 'BM4060', date: '2026-10-06', row_id: 'P:annroe', was: '', now: '8A-4P', via: 'add', flow_id: '', note: '', undone_at: '' }] }
    assert.deepEqual(mergeWrite(b, { ok: true, said: 'Saved.', period_id: 'P2026-09-28', grids: {}, busy: {}, test_mode: b.test_mode, log }).log, log,
      'a write\'s history is laid over the board')
  })

  it('the house dropdown\'s open count comes from the grid as it stands; a link to a later day opens its period', () => {
    const b = panelBoard({}, [null, null, null])
    assert.equal(openCount(b.grids.BM4060, b.today), 2)
    assert.equal(openCount(b.grids.BM4060, '2026-10-04'), 1, 'a day gone by is not open any more')
    assert.equal(otherPeriodOf(b, '2026-10-30'), 'P2026-10-26')
    assert.equal(otherPeriodOf(b, '2026-10-06'), '')
    assert.equal(otherPeriodOf(b, '2027-01-01'), '')
  })
})

/* ---------- decisions in the right panel ---------- */

const ITEM = {
  id: 'SI00000000B1', flow_id: 'SF00000000B1', box: 'work', kind: 'approval', seat: 'director',
  title: 'Request off — Ann Roe · Tue 10/13 · 4P-12A · BM', body: 'Ann Roe asks to be off this shift.',
  house_code: 'BM4060', house_label: 'BM', date: '2026-10-13', shift_text: '4P-12A', state: 'waiting',
  link: '/app/scheduling/calendar?house=BM4060&day=2026-10-13', test_mode: 'yes', created_at: '2026-10-03T12:00:00Z',
}
const SWAP_FLOW = {
  id: 'SF00000000C1', kind: 'swap' as const, state: 'waiting_manager', house_code: 'BM4060', date: '2026-10-13',
  person: 'Ann Roe', shift_text: '4P-12A', replacement: 'Mia Manager',
  seats: [{ seat: 'staff' as const, to: [], state: 'approved' as const, by: 'Mia Manager' },
    { seat: 'house_manager' as const, to: [], state: 'waiting' as const }],
}
const drawNode = (node: React.ReactNode) => flat(renderToString(createElement(MemoryRouter, null, node)))

describe('scheduling — decisions are made in the right panel, never in a card row', () => {
  it('"Waiting on you" lists each item as a row that opens; Approve and Decline are not in the card', () => {
    const b = panelBoard({}, [null, null, null], { waiting_on_me: [ITEM] })
    const html = drawNode(createElement(WaitingCard, { board: b, gone: new Set<string>(), openId: '', onOpen: () => {} }))
    assert.ok(html.includes(`data-item="${ITEM.id}"`) && html.includes('Open') && html.includes(ITEM.title))
    assert.ok(!html.includes('data-press') && !/>Approve</.test(html) && !/>Decline</.test(html))
    assert.equal(drawNode(createElement(WaitingCard, { board: b, gone: new Set([ITEM.id]), openId: '', onOpen: () => {} })), '',
      'an item answered here leaves at once')
  })

  it('the item\'s panel: its title, house, day, shift, words, the test-mode line, then Approve and Decline (Decline pressed twice)', () => {
    const b = panelBoard({}, [null, null, null], { waiting_on_me: [ITEM] })
    const html = drawNode(createElement(ItemPanel, { board: b, item: b.waiting_on_me[0], onClose: () => {}, busy: false, refusal: '', onAnswer: () => {} }))
    for (const w of [ITEM.title, '>BM<', '>2026-10-13<', '>4P-12A<', ITEM.body, TEST_MODE_ITEM, 'data-press="approve"', 'data-press="decline"'])
      assert.ok(html.includes(w), w)
    assert.ok(!html.includes('data-armed') && !html.includes('role="dialog"'))
    const refused = drawNode(createElement(ItemPanel, { board: b, item: b.waiting_on_me[0], onClose: () => {}, busy: false,
      refusal: 'Only the account this item waits on can answer it.', onAnswer: () => {} }))
    assert.ok(refused.includes('role="alert"') && refused.includes('Only the account this item waits on can answer it.'))
  })

  it('the steps are drawn when the flow is known: the item carries it, or it is the viewer\'s own (a replacement\'s swap)', () => {
    const b = panelBoard({}, [null, null, null], { waiting_on_me: [{ ...ITEM, flow_id: SWAP_FLOW.id }], mine: [SWAP_FLOW] })
    assert.equal(itemFlow(b, b.waiting_on_me[0])?.id, SWAP_FLOW.id)
    const html = drawNode(createElement(ItemPanel, { board: b, item: b.waiting_on_me[0], onClose: () => {}, busy: false, refusal: '', onAnswer: () => {} }))
    assert.ok(html.includes('data-decision-steps=""') && html.includes('House manager') && html.includes('data-decision-who=""'))
    const carried = panelBoard({}, [null, null, null], { waiting_on_me: [{ ...ITEM, flow: { ...SWAP_FLOW, id: 'SF00000000C2' } }] })
    assert.equal(itemFlow(carried, carried.waiting_on_me[0])?.id, 'SF00000000C2')
    assert.equal(itemFlow(panelBoard({}, [null, null, null]), ITEM), null)
  })

  it('"Your requests" rows open a panel with the steps and Withdraw (pressed twice); a training is never withdrawn', () => {
    const mine = { ...SWAP_FLOW, state: 'waiting_staff' }
    const b = panelBoard({}, [null, null, null], { mine: [mine] })
    const card = drawNode(createElement(MineCard, { board: b, openId: '', onOpen: () => {} }))
    assert.ok(card.includes(`data-flow-row="${mine.id}"`) && !card.includes('Withdraw'), 'nothing decided in the card')
    const panelHtml = drawNode(createElement(FlowPanel, { board: b, flow: b.mine[0], onClose: () => {}, onWrite: () => {} }))
    assert.ok(panelHtml.includes('data-withdraw=""') && panelHtml.includes('data-press="withdraw"') && panelHtml.includes('data-steps=""'))
    const training = { id: 'SF00000000D1', kind: 'training' as const, state: 'waiting', house_code: 'BM4060', date: '2026-10-13',
      person: 'Ann Roe', shift_text: '4P-12A', seats: [{ seat: 'house_manager' as const, to: [], state: 'waiting' as const }] }
    const t = panelBoard({}, [null, null, null], { mine: [training] })
    const tHtml = drawNode(createElement(FlowPanel, { board: t, flow: t.mine[0], onClose: () => {}, onWrite: () => {} }))
    assert.ok(!tHtml.includes('data-withdraw') && tHtml.includes('Waiting on the house manager and a director'))
    const other = panelBoard({}, [null, null, null], { mine: [{ ...mine, person: 'Bo Other' }] })
    assert.equal(mayWithdraw(other, other.mine[0]), false, 'the replacement reads the swap, the asker withdraws it')
  })

  it('the page opens the item and the request in the right panel, and holds no answer button in the cards', () => {
    const html = draw(ready(fixture({}, { waiting_on_me: [ITEM], mine: [SWAP_FLOW] })))
    const cards = html.slice(html.indexOf('data-waiting-on-you'), html.indexOf('data-grid-card'))
    assert.ok(cards.includes('data-item=') && cards.includes('data-flow-row='))
    assert.ok(!cards.includes('data-press'), 'no Approve, Decline or Withdraw in the cards')
  })
})

/* ---------- training: no IST at the house ---------- */

const TRAINING_CELL = (state: string) => SHIFT('4P-12A', 16, 24, { state: 'training', flow: { id: 'SF00000000E1', kind: 'training', state } })

describe('scheduling — a training on screen', () => {
  it('the legend keeps its training line to the master unless Settings › My Work shows it; a waiting one is listed when drawn', () => {
    // until the session's own answer says otherwise (myWorkHidesMine), the switch's part is hidden
    const html = draw(ready(fixture({})))
    assert.ok(!html.includes('data-legend-state="training"') && !html.includes('Training with the house manager (no IST) — not counted as DSP'))
    assert.ok(!html.includes('data-legend-state="training-waiting"'))
  })

  it('a training cell carries the cap and says where and with whom; waiting and approved are told apart', () => {
    const cells = (state: string) => [{ text: '4P-12A', kind: 'evening', state: 'training', flow: { id: 'SF1', kind: 'training', state } }, null]
    const at = (state: string) => fixture({}, {
      grids: { BM4060: { ...fixture({}).grids.BM4060, rows: fixture({}).grids.BM4060.rows.map((r) => (r.row_id === 'P:annroe' ? { ...r, cells: cells(state) } : r)) } },
    })
    const waiting = draw(ready(at('waiting')))
    assert.ok(waiting.includes('data-training="waiting"') && waiting.includes('data-legend-state="training-waiting"'))
    assert.ok(waiting.includes(`${trainingTitle('BM')} · waiting on the house manager and a director`))
    const approved = draw(ready(at('approved')))
    assert.ok(approved.includes('data-training="yes"') && approved.includes(`${trainingTitle('BM')} · approved`))
  })

  it('the trainee\'s panel explains it; while it waits only Call Off and Time off are offered, with the steps and no Withdraw', () => {
    const mine = [{ id: 'SF00000000E1', kind: 'training', state: 'waiting', house_code: 'BM4060', date: '2026-10-13', person: 'Ann Roe',
      shift_text: '4P-12A', reason: 'no IST at BM on file', seats: [{ seat: 'house_manager', to: [], state: 'approved', by: 'Mia Manager' },
        { seat: 'director', to: [], state: 'waiting' }] }]
    const html = panel(panelBoard({}, [null, null, TRAINING_CELL('waiting')], { mine }), 'P:annroe', '2026-10-13')
    assert.ok(html.includes('data-training-means="waiting"') && html.includes(trainingTitle('BM')))
    assert.ok(html.includes('data-own=""') && html.includes('data-training-wait=""'))
    assert.ok(html.includes('data-press="call-off"') && html.includes('Time off'))
    assert.ok(!html.includes('data-press="request-off"') && !html.includes('</svg> Swap</button>'), 'Request Off and Swap wait for the answer')
    for (const s of ['Placed', 'House manager', 'Director', 'Training']) assert.ok(html.includes(s), s)
    assert.ok(!html.includes('data-press="withdraw"') && html.includes('no IST at BM on file'))
    const done = panel(panelBoard({}, [null, null, TRAINING_CELL('approved')], { mine: [{ ...mine[0], state: 'approved' }] }), 'P:annroe', '2026-10-13')
    assert.ok(done.includes('data-press="request-off"') && done.includes('</svg> Swap</button>'), 'an approved training is the person\'s shift in every way')
  })

  it('a picker says so before the press when the person picked has no IST at the house', () => {
    const b = panelBoard({ editor_of: ['BM4060'] }, [null, null, null], {
      people: [{ key: 'newhire', name: 'New Hire', has_account: true, no_ist: ['BM4060'] }, { key: 'annroe', name: 'Ann Roe', has_account: true }],
    })
    assert.equal(istMissingAt(b, 'BM4060', 'newhire'), true)
    assert.equal(istMissingAt(b, 'EC4048', 'newhire'), false)
    assert.equal(istMissingAt(b, 'BM4060', 'annroe'), false, 'unsaid is not known: the server decides')
    const pick = drawNode(createElement(FreePicker, { board: b, date: '2026-10-13', span: [960, 1440], house: 'BM4060',
      picked: b.people[0], onPick: () => {}, label: 'People free for it' }))
    assert.ok(pick.includes('data-no-ist="newhire"') && pick.includes(TRAINING_PICK_LINE) && !pick.includes('data-no-ist="annroe"'))
    const form = drawNode(createElement(ShiftForm, { board: b, house: 'BM4060', mode: 'add', personKey: 'newhire', date: '2026-10-13',
      text: '4P-12A', days: [{ iso: '2026-10-13', label: 'TUE Oct 13' }], hours: false, saving: false, refusal: '', onSave: () => {} }))
    assert.ok(form.includes(TRAINING_PICK_LINE) && form.includes('New Hire — training (no IST here)'))
  })
})

/* ---------- Swap shifts: two shifts change hands, at any house ---------- */

function swapBoard(viewer: Record<string, unknown>): Board {
  const base = panelBoard(viewer, [null, SHIFT('4P-12A', 16, 24), SHIFT('4P-12A', 16, 24)])
  const person = (key: string, name: string, cells: unknown[]) =>
    ({ row_id: `P:${key}`, kind: 'person', name, key, designation: '', badges: NO, me: key === base.viewer.key && Boolean(key), cells })
  return boardFrom({
    ...base,
    houses: [...base.houses, { code: 'FT4801', location: 'CAN - FT - FT4801', short: 'FT', staff: 3, managers: [], open: 0 }],
    grids: {
      BM4060: {
        ...base.grids.BM4060,
        rows: base.grids.BM4060.rows.map((r) => (r.kind === 'person' ? { ...r, me: r.key === base.viewer.key && Boolean(r.key) } : r)),
      },
      FT4801: {
        code: 'FT4801', cols: COLS3, days: [],
        rows: [
          person('bobfar', 'Bob Far', [null, SHIFT('8A-4P', 8, 16, { kind: 'morning' }), SHIFT('12A-8A', 0, 8, { kind: 'overnight' })]),
          person('cyfar', 'Cy Far', [null, SHIFT('4P-12A', 16, 24), SHIFT('6P-10P', 18, 22)]),
          person('deeode', 'Dee Ode', [null, null, SHIFT('8A-4P', 8, 16, { kind: 'morning' })]),
        ],
      },
    },
    busy: {
      annroe: [['2026-10-06', 960, 1440, 'BM4060', 'work'], ['2026-10-13', 960, 1440, 'BM4060', 'work']],
      miamanager: [['2026-10-03', 480, 960, 'BM4060', 'work'], ['2026-10-06', 480, 960, 'BM4060', 'work']],
      bobfar: [['2026-10-06', 480, 960, 'FT4801', 'work'], ['2026-10-13', 0, 480, 'FT4801', 'work']],
      cyfar: [['2026-10-06', 960, 1440, 'FT4801', 'work'], ['2026-10-13', 1080, 1320, 'FT4801', 'work']],
      deeode: [['2026-10-13', 480, 960, 'FT4801', 'work']],
    },
    people: [{ key: 'annroe', name: 'Ann Roe', has_account: true }, { key: 'miamanager', name: 'Mia Manager', has_account: true },
      { key: 'bobfar', name: 'Bob Far', has_account: true }, { key: 'cyfar', name: 'Cy Far', has_account: true },
      { key: 'deeode', name: 'Dee Ode', has_account: false }],
  })
}
const PERIOD = 'P2026-09-28'
const drawPick = (board: Board, pick: Pick, house = 'BM4060') => flat(renderToString(createElement(MemoryRouter,
  { initialEntries: [`/app/scheduling/calendar?house=${house}&range=period`] },
  createElement(SchedulingView, { state: ready(board), sessionMaster: board.viewer.is_master, onReload: () => {}, onAbsorb: () => {},
    initialPick: pick }))))
const byState = (marks: Record<string, PickMark>, state: PickMark['state']) =>
  Object.keys(marks).filter((k) => marks[k].state === state).sort()
/** each drawn cell of a row: [iso, data-pick, aria-disabled, title] */
const pickCells = (html: string, rowId: string) => {
  const row = html.slice(html.indexOf(`data-row="${rowId}"`), html.indexOf('</tr>', html.indexOf(`data-row="${rowId}"`)))
  return [...row.matchAll(/<button type="button"([^>]*)>/g)].map((m) => ({
    iso: /data-iso="([^"]+)"/.exec(m[1])?.[1] ?? '', pick: /data-pick="([^"]+)"/.exec(m[1])?.[1] ?? '',
    disabled: /aria-disabled="true"/.test(m[1]), title: /title="([^"]+)"/.exec(m[1])?.[1] ?? '',
  }))
}

describe('scheduling — Swap shifts: two shifts change hands, at any house', () => {
  it('the button is for every account with rows on a house, whatever its badge, and for the master', () => {
    const acts = (b: Board) => [...draw(ready(b), b.viewer.is_master).matchAll(/data-act="([^"]+)"/g)].map((m) => m[1])
    assert.ok(swapsShifts(swapBoard({})), 'staff')
    assert.ok(swapsShifts(swapBoard({ key: 'miamanager', name: 'Mia Manager', is_director: true, can_edit_any: true })), 'a house manager or director with a row')
    assert.ok(swapsShifts(swapBoard({ key: '', is_master: true })), 'the master, with no row at all')
    assert.equal(swapsShifts(swapBoard({ key: 'outsider', name: 'Out Sider' })), false, 'no row anywhere: nothing to swap')
    assert.ok(acts(swapBoard({ key: 'miamanager', name: 'Mia Manager', is_director: true, can_edit_any: true })).includes('swap-shifts'))
  })

  it('pick mode, first click: only your own shifts still to come are pickable, every other cell is off; the master picks anybody\'s', () => {
    const b = swapBoard({})
    const now = Date.parse(b.now)
    assert.deepEqual(byState(pickMarks(b, 'BM4060', null, now), 'pick'), ['P:annroe|2026-10-06', 'P:annroe|2026-10-13'])
    assert.deepEqual(Object.keys(pickMarks(b, 'FT4801', null, now)), [], 'nothing of yours at FT')
    const m = swapBoard({ key: '', is_master: true })
    const mBM = byState(pickMarks(m, 'BM4060', null, now), 'pick')
    assert.ok(mBM.includes('P:miamanager|2026-10-06') && !mBM.includes('P:miamanager|2026-10-03'), 'a shift already begun is never offered')
    assert.ok(byState(pickMarks(m, 'FT4801', null, now), 'pick').includes('P:bobfar|2026-10-06'))
    const html = drawPick(b, { give: null, period: PERIOD, notice: '' })
    assert.ok(html.includes('data-pick-bar="give"') && html.includes('Swap — pick your shift') && html.includes('data-act="pick-cancel"'))
    const ann = pickCells(html, 'P:annroe')
    assert.deepEqual(ann.map((c) => `${c.iso}:${c.pick}:${c.disabled}`),
      ['2026-10-03:off:true', '2026-10-06:pick:false', '2026-10-13:pick:false'])
    assert.ok(pickCells(html, 'P:miamanager').every((c) => c.pick === 'off' && c.disabled), 'somebody else\'s shift is not clickable')
    assert.ok(drawPick(m, { give: null, period: PERIOD, notice: '' }).includes('Swap — pick the first shift (anybody’s)'))
  })

  it('pick mode, second click: the first pick survives a house change; valid shifts are highlighted, blocked ones dimmed with why', () => {
    const b = swapBoard({})
    const now = Date.parse(b.now)
    const give = shiftAt(b, 'BM4060', 'P:annroe', '2026-10-06', now)!
    const ft = pickMarks(b, 'FT4801', give, now)
    assert.deepEqual(byState(ft, 'valid'), ['P:bobfar|2026-10-06', 'P:bobfar|2026-10-13', 'P:cyfar|2026-10-06'])
    assert.deepEqual(byState(ft, 'blocked'), ['P:cyfar|2026-10-13', 'P:deeode|2026-10-13'])
    assert.match(ft['P:cyfar|2026-10-13'].why, /^Ann Roe is already at BM 4P-12A that day/)
    assert.equal(ft['P:deeode|2026-10-13'].why, 'no platform account — they could not answer in My Work')
    const bm = pickMarks(b, 'BM4060', give, now)
    assert.equal(bm['P:annroe|2026-10-06'].state, 'given')
    assert.equal(bm['P:miamanager|2026-10-06'].state, 'valid')
    assert.equal(bm['P:annroe|2026-10-13'].why, 'it is Ann Roe’s own shift')
    const html = drawPick(b, { give, period: PERIOD, notice: '' }, 'FT4801')
    assert.ok(html.includes('data-pick-bar="take"'))
    assert.ok(html.includes('You give:</span> BM TUE Oct 6 4P-12A — now pick their shift (any house)'), 'the bar names the shift given')
    const cy = pickCells(html, 'P:cyfar')
    assert.deepEqual(cy.map((c) => `${c.iso}:${c.pick}:${c.disabled}`), ['2026-10-03:off:true', '2026-10-06:valid:false', '2026-10-13:blocked:true'])
    assert.ok(cy[2].title.includes('Not possible: Ann Roe is already at BM 4P-12A that day'), cy[2].title)
    assert.ok(cy[1].title.includes('Pick it to take this shift'))
    assert.ok(html.includes('data-act="pick-change"') && html.includes('data-act="pick-give-away"'), 'Change and give-away stay in reach')
  })

  it('pick mode: a period changed mid-pick is said in the bar; a phone draws the bar as a bottom sheet', () => {
    const html = drawPick(swapBoard({}), { give: null, period: PERIOD, notice: PICK_PERIOD_NOTICE })
    assert.ok(html.includes('data-pick-notice=""') && html.includes(PICK_PERIOD_NOTICE))
    const page = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'src/pages/features/scheduling/SchedulingPage.tsx'), 'utf8')
    assert.match(page, /phone \? 'fixed inset-x-0 bottom-0/, 'the bar is a bottom sheet on a phone')
    assert.match(page, /e\.key === 'Escape'\) setPick\(null\)/, 'Escape leaves pick mode')
  })

  it('the second pick opens the ask: you give, you take, the checks, the seats in order, a note, the two-press send, the give-away', () => {
    const b = swapBoard({})
    const now = Date.parse(b.now)
    const give = shiftAt(b, 'BM4060', 'P:annroe', '2026-10-06', now)!
    const take = shiftAt(b, 'FT4801', 'P:bobfar', '2026-10-13', now)!
    const html = drawNode(createElement(SwapAskBody, { board: b, give, take, onWrite: () => {} }))
    assert.ok(html.includes('You give</span> BM · TUE Oct 6 · 4P-12A') && html.includes('You take</span> FT · TUE Oct 13 · 12A-8A'))
    assert.ok(EXCHANGE_CHECKS.every((c) => html.includes(c.replace(/’/g, '&#x27;')) || html.includes(c)), 'every check is listed')
    assert.ok(html.indexOf('House manager · BM') < html.indexOf('House manager · FT') && html.includes('Director'))
    assert.ok(html.includes('Note (optional)') && html.includes('data-press="send-swap"') && html.includes('Send swap request'))
    assert.ok(html.includes('Give it instead — nothing comes back'))
    const away = drawNode(createElement(SwapAskBody, { board: b, give, take: null, startAway: true, onWrite: () => {} }))
    assert.ok(away.includes('data-give-away=""') && away.includes('data-free-picker=""'), 'giving it away picks somebody free')
  })

  it('the model judges each leg: both people free with their own shift set aside, one row one shift, never the same person', () => {
    const b = swapBoard({})
    const all = upcomingShifts(b, Date.parse(b.now))
    const get = (id: string) => all.find((s) => `${s.house}|${s.rowId}|${s.iso}` === id)!
    const ann = get('BM4060|P:annroe|2026-10-06')
    assert.equal(exchangeBlock(b, ann, get('FT4801|P:bobfar|2026-10-06')), '')
    assert.equal(exchangeBlock(b, ann, get('BM4060|P:annroe|2026-10-13')), 'it is Ann Roe’s own shift')
    assert.match(exchangeBlock(b, ann, get('FT4801|P:cyfar|2026-10-13')), /^Ann Roe is already at BM 4P-12A that day/)
    // Bob taking Ann's Tuesday evening at BM would leave his own FT Tuesday morning — a handover, so free
    assert.equal(exchangeBlock(b, get('FT4801|P:bobfar|2026-10-13'), ann), '')
    const waiting = { ...ann, flow: { id: 'SF1', kind: 'swap', state: 'waiting_staff' } }
    assert.equal(exchangeBlock(b, get('FT4801|P:bobfar|2026-10-06'), waiting), 'a request is already waiting on it')
  })

  it('both picked: what each gives and takes, a house manager step for each house, then Ask', () => {
    const steps = exchangePlanSteps({ house: 'BM4060', short: 'BM' }, { house: 'FT4801', short: 'FT', name: 'Bob Far' })
    assert.deepEqual(steps.map((s) => s.label), ['Proposed', 'Bob', 'House manager · BM', 'House manager · FT', 'Director', 'Swapped'])
    assert.equal(exchangePlanSteps({ house: 'BM4060', short: 'BM' }, { house: 'BM4060', short: 'BM', name: 'Mia Manager' })
      .filter((s) => s.id.startsWith('house_manager')).length, 1, 'one house, one seat')
    const flow = { id: 'SF2', kind: 'swap' as const, state: 'waiting_manager', house_code: 'BM4060', date: '2026-10-06', person: 'Ann Roe',
      replacement: 'Bob Far', shift_text: '4P-12A', exchange: { house_code: 'FT4801', house_label: 'FT', date: '2026-10-06', row_id: 'P:bobfar', shift_text: '8A-4P' },
      seats: [{ seat: 'staff' as const, to: [], state: 'approved' as const },
        { seat: 'house_manager' as const, house: 'BM4060', house_label: 'BM', to: [], state: 'approved' as const },
        { seat: 'house_manager' as const, house: 'FT4801', house_label: 'FT', to: [], state: 'waiting' as const }] }
    const s = swapSteps(flow)
    assert.deepEqual(s.map((x) => `${x.label}:${x.state}`), ['Proposed:done', 'Staff:done', 'House manager · BM:done',
      'House manager · FT:waiting', 'Director:na', 'Swapped:na'])
    const b = swapBoard({}, )
    const card = drawNode(createElement(FlowPanel, { board: { ...b, mine: [flow] }, flow, onClose: () => {}, onWrite: () => {} }))
    assert.ok(card.includes('data-exchange=""') && card.includes('In exchange for FT · 2026-10-06 · 8A-4P'))
  })
})

/* ---------- editors against the flows waiting on a cell ---------- */

describe('scheduling — an editor over a cell a flow waits on', () => {
  it('the sentence names what waits: a swap with whoever is on the other side, a Request Off, a training', () => {
    const at = (kind: string, state: string, more: Record<string, string> = {}) => pendingFlowLine({ flow: { id: 'SF1', kind, state, ...more } })
    assert.equal(at('swap', 'waiting_manager', { with: 'Bob Far' }), 'This shift has a pending swap with Bob Far: answer it or cancel it first.')
    assert.equal(at('request_off', 'waiting'), 'This shift has a pending Request Off: answer it or cancel it first.')
    assert.equal(at('training', 'waiting'), 'This shift has a pending training: answer it or cancel it first.')
    assert.equal(at('swap', 'done', { with: 'Bob Far' }), '', 'a done swap holds nothing')
    assert.equal(at('call_off', 'outreach_1'), '', 'a call-off\'s outreach is not a request on the cell')
  })

  it('the editor\'s form says it above Save and offers a two-press "Cancel it and edit" (and "Cancel it and delete")', () => {
    const cell = SHIFT('4P-12A', 16, 24, { flow: { id: 'SF9', kind: 'swap', state: 'waiting_staff', with: 'Bob Far' } })
    const b = panelBoard({ key: 'miamanager', name: 'Mia Manager', editor_of: ['BM4060'] }, [null, null, cell])
    const html = panel(b, 'P:annroe', '2026-10-13')
    assert.ok(html.includes('data-pending-flow=""') && html.includes('This shift has a pending swap with Bob Far: answer it or cancel it first.'))
    assert.ok(html.includes('data-press="cancel-edit"') && html.includes('Cancel it and edit'))
    assert.ok(html.includes('Cancel it and delete'))
    assert.ok(!html.includes('data-save=""'), 'no plain Save while the flow waits')
    const free = panel(panelBoard({ key: 'miamanager', name: 'Mia Manager', editor_of: ['BM4060'] }, [null, null, SHIFT('4P-12A', 16, 24)]), 'P:annroe', '2026-10-13')
    assert.ok(free.includes('data-save=""') && !free.includes('data-pending-flow'), 'nothing waits: the plain Save')
  })
})

const ASK: TimeOffAsk = {
  id: 'SFTO1', kind: 'time_off', state: 'waiting', person: 'Ann Roe', house_code: '', house_label: '',
  from: '2026-10-20', to: '2026-10-21', days: 2, shift_text: '', requested_at: '2026-10-01T14:00:00Z', decided_by: '',
  decided_at: '', own: false, ended: false, reason: 'family trip',
  item: { id: 'SI1', title: 'Time off — Ann Roe', body: 'Approve to open her shifts.', test_mode: 'no', created_at: '2026-10-01T14:00:00Z' },
  houses: [{ code: 'BM4060', label: 'BM' }], filed_by: 'Ann Roe', filed_via: 'On the platform',
  seats: [{ seat: 'director', state: 'waiting', by: '', at: '', note: '', why: '', asked: ['Ty Bond', 'Bo Alder'] }],
  holds: [{ date: '2026-10-20', house_code: 'BM4060', house_label: 'BM', text: '7A-3P' }], applied: [], future_days: 0,
}
const askPanel = (ask: TimeOffAsk, focus: '' | 'approve' | 'decline' = '', edit = false) => drawNode(createElement(AskPanel, {
  ask, focus, edit, onClose: () => {}, busy: false, refusal: '', onAnswer: () => {},
}))

describe('scheduling — Time Off Requests: every ask opens whole in the right panel', () => {
  it('behind Edit, the record draws who, when, where, how it was filed, the reason, whom it waits on, the history and the shifts', () => {
    const html = askPanel({ ...ASK, may_edit: true }, '', true)
    assert.ok(html.includes('data-act="back"'), 'Edit\'s record goes back to the request')
    for (const w of ['Time off — Ann Roe', '>BM<', 'Oct 20, 2026', 'Oct 21, 2026', 'Ann Roe · On the platform', 'family trip',
      'Director: Waiting on Ty Bond, Bo Alder', 'Asked by Ann Roe · On the platform', 'If approved, these go up as open shifts',
      'Oct 20, 2026 · BM · 7A-3P', 'data-press="approve"', 'data-press="decline"', 'data-status="Waiting"'])
      assert.ok(html.includes(w), w)
    assert.ok(!html.includes('data-armed'), 'opened from the row, nothing is armed')
  })

  it('opened from Decline, Decline is armed; an ask with no seat for the viewer is only read', () => {
    assert.ok(askPanel(ASK, 'decline').includes('data-armed'))
    const read = askPanel({ ...ASK, item: undefined, reason: undefined })
    assert.ok(!read.includes('data-press') && read.includes('Only the approvers and the person who asked read it.'))
  })

  it('an approved ask, opened by Edit, says who approved it, what it opened and what waits on a later period', () => {
    const ok: TimeOffAsk = { ...ASK, state: 'approved_future', item: undefined, decided_by: 'Ty Bond', decided_at: '2026-10-02T15:00:00Z',
      seats: [{ seat: 'director', state: 'approved', by: 'Ty Bond', at: '2026-10-02T15:00:00Z', note: 'enjoy', why: '', asked: ['Ty Bond'] }],
      holds: [], applied: [{ date: '2026-10-20', house_label: 'BM' }], future_days: 3, may_edit: true }
    const html = drawNode(createElement(AskPanel, { ask: ok, focus: '', edit: true, onClose: () => {}, busy: false,
                                                     refusal: '', onAnswer: () => {} }))
    assert.ok(html.includes('data-act="back"'), 'Edit\'s record goes back to the request')
    for (const w of ['Director: Ty Bond · Approved', 'Director: approved by Ty Bond — “enjoy”', 'Put up as an open shift: Oct 20, 2026 · BM',
      '3 days after the last period apply when that period is made', 'data-status="Approved · later days pending"'])
      assert.ok(html.includes(w), w)
    assert.deepEqual(askStatus({ state: 'approved', ended: true }), { label: 'Past', tint: 'slate' })
    assert.equal(seatLine({ seat: 'director', state: 'declined', by: 'Bo Alder', at: '', note: '', why: '', asked: [] }), 'Director: Bo Alder · Declined')
    assert.deepEqual(askHistory({ ...ASK, seats: undefined, state: 'approved', decided_by: 'Ty Bond', decided_at: '2026-10-02' })
      .map((e) => e.text), ['Asked by Ann Roe · On the platform', 'Approved by Ty Bond'])
  })
})

describe('scheduling — an approved time off opens in the operator\'s layout', () => {
  const OK: TimeOffAsk = { ...ASK, state: 'approved', item: undefined, from: '2026-11-03', to: '2026-11-09', days: 7,
    person: 'Jordan Lee', requested_at: '2026-10-01T15:00:00Z', reason: 'Family trip.', decided_by: 'Ty Bond',
    decided_at: '2026-10-02T15:00:00Z', holds: [], may_edit: true,
    approved: { year: 2026, year_days: 15, year_why: '', shifts_why: '', shifts: [
      { date: '2026-11-02', house_code: 'CH1', location: 'Cedar House', start_min: 1320, end_min: 1860, text: '10P-7A', state: 'given_up' },
      { date: '2026-11-04', house_code: 'CH1', location: 'Cedar House', start_min: 420, end_min: 900, text: '7A-3P', state: 'scheduled' }] } }

  it('the header pill, Employee, the facts, the reason, the year and the impacted shifts; the record waits behind Edit', () => {
    const html = askPanel(OK)
    for (const w of ['aria-label="Time off request"', 'data-status="Approved"', '>Employee<', '>Jordan Lee<', '>Nov 03, 2026<',
      '>Nov 09, 2026<', '>Oct 01, 2026<', '>7<', 'Family trip.', '>Approved time off · 2026<', '>15 days<', '>Impacted shifts<',
      '>Cedar House<', '>10:00 PM<', '>3:00 PM<'])
      assert.ok(html.includes(w), w)
    assert.ok(!html.includes('Who approves') && !html.includes('>History<'), 'the whole ask is Edit\'s')
  })

  it('Edit is drawn only where the server names the reader an approver, never for the person on it', () => {
    assert.ok(askPanel(OK).includes('data-act="edit"'))
    assert.ok(!askPanel({ ...OK, may_edit: false }).includes('data-act="edit"'), 'a reader')
    assert.ok(!askPanel({ ...OK, own: true, may_edit: false }).includes('data-act="edit"'), 'the person on it')
    // the address alone opens nothing: without `may_edit` the layout stays
    const asked = drawNode(createElement(AskPanel, { ask: { ...OK, may_edit: false }, focus: '', edit: true, onClose: () => {},
                                                      busy: false, refusal: '', onAnswer: () => {} }))
    assert.ok(asked.includes('>Employee<') && !asked.includes('Who approves'))
  })

  it('an overnight shift ends on the next day, written under its end time', () => {
    const html = askPanel(OK)
    assert.ok(/>7:00 AM<span[^>]*data-end-date="">Nov 03, 2026<\/span>/.test(html), 'the overnight end')
    assert.ok(/>3:00 PM<\/td>/.test(html), 'a same-day end carries no day')
  })

  it('a waiting ask opens on the same layout: the approver answers in its footer, the person withdraws there', () => {
    const waiting: TimeOffAsk = { ...OK, state: 'waiting', item: ASK.item, decided_by: '', decided_at: '' }
    const html = askPanel(waiting)
    const order = ['data-status="Waiting"', '>Employee<', '>Jordan Lee<', 'data-act="edit"', '>Nov 03, 2026<', 'Family trip.',
      '>Approved time off · 2026<', '>Impacted shifts<', '>10:00 PM<', 'data-ask-decide', 'data-press="approve"', 'data-press="decline"']
    let from = 0
    for (const w of order) {
      const i = html.indexOf(w, from)
      assert.ok(i >= 0, `${w} after position ${from}`)
      from = i
    }
    assert.ok(!html.includes('Who approves') && !html.includes('data-status="Approved"'))
    assert.ok(askPanel(waiting, 'decline').includes('data-armed'), 'a row\'s Decline arms it in the footer')
    // the person on it: no answer, no edit — their Withdraw
    const own = drawNode(createElement(AskPanel, { ask: { ...waiting, own: true, item: undefined, may_edit: false }, focus: '',
      onClose: () => {}, busy: false, refusal: '', onAnswer: () => {}, onWithdraw: () => {} }))
    assert.ok(own.includes('>Employee<') && own.includes('data-act="withdraw"'))
    assert.ok(!own.includes('data-press') && !own.includes('data-act="edit"'))
    // a Request Off opens on it too
    const ro: TimeOffAsk = { ...OK, kind: 'request_off', house_code: 'BM4060', house_label: 'BM', shift_text: '7A-3P' }
    assert.ok(askPanel(ro).includes('>Employee<') && askPanel(ro).includes('data-status="Approved"'))
  })
})

describe('scheduling — the reload from the sheet, the master\'s', () => {
  it('only the master gets the small reload, at the end of the range bar, with no words of its own', () => {
    const master = draw(ready(fixture({ is_master: true })), true)
    assert.match(master, /data-range-bar=""[^]*data-act="sheet-reload"[^]*data-grid-scroll/)
    // the colour key sits under the grid, never on the range bar (the operator, 10-31)
    assert.match(master, /data-grid-scroll=""[^]*data-legend=""/)
    assert.ok(!master.includes('data-bar-legend'))
    const button = /<button[^>]*data-act="sheet-reload"[^>]*>([^]*?)<\/button>/.exec(master)
    assert.ok(button, 'the reload is drawn')
    assert.equal(button[1].replace(/<[^>]+>/g, '').trim(), '', 'an icon alone, no description')
    assert.match(button[0], /aria-label="Read the house calendars from the sheet again"/)
    // one period and no master: no bar at all; a master's board seen by a session minted from it: no reload either
    for (const html of [draw(ready(fixture({}))), draw(ready(fixture({ is_director: true }))), draw(ready(fixture({ is_master: true })), false)]) {
      assert.ok(!html.includes('data-act="sheet-reload"'))
      assert.ok(!html.includes('data-period-bar'))
    }
  })

  it('says what came in from the sheet, or that the sheet holds nothing newer', () => {
    const none = { sheet_at: '2026-10-29T16:58:00.000Z', copy_at: '2026-10-29T17:00:37.591Z', houses_read: 0, why: '', added: 0, changed: 0, cleared: 0, rows_added: 0 }
    const current = sheetReloadFrom({ ...none, ahead: false })
    assert.ok(current)
    const said = sheetReloadWords(current)
    assert.equal(said.type, 'info')
    assert.equal(said.title, 'Already up to date')
    assert.match(said.body, /^The sheet has nothing newer — last changed .+, read here .+\.$/)
    assert.deepEqual(sheetReloadWords(sheetReloadFrom({ ...none, ahead: true, houses_read: 17, added: 2, changed: 1, rows_added: 1 })!),
      { type: 'success', title: 'Updated from the sheet', body: '2 added · 1 changed · 1 person added.' })
    assert.deepEqual(sheetReloadWords(sheetReloadFrom({ ...none, ahead: true, houses_read: 17 })!),
      { type: 'info', title: 'Read from the sheet', body: 'Nothing new for the calendars: every house already matched it.' })
    assert.deepEqual(sheetReloadWords(sheetReloadFrom({ ...none, ahead: false, why: "Drive did not name the house calendars' workbook" })!),
      { type: 'warning', title: 'Not read from the sheet', body: "Drive did not name the house calendars' workbook." })
    assert.equal(sheetReloadFrom({ said: 'not an answer' }), null)
  })
})
