/**
 * Scheduling › Overtime: PsiAnywhere's pay-period grid as app/psi_periods.py draws it, the day Scheduling stands on
 * (a Saturday-started week opens the pay period of the six days after it), the 62-day limit, the lane's answer shaped
 * so nothing missing breaks the table, and the screen drawn from a held answer — rows in the server's order, only
 * those over the line by default, worked past 40 h red and planned past it amber, the current period marked. Also
 * where Scheduling draws it: the master's alone while its row is undeclared, drawn when the board could not be read,
 * never drawn on a period a link is leaving, and its dates dropped from the address when the viewer leaves it.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { screenAllowsWith } from '@/lib/featureAccess'
import { withParams } from '@/pages/features/calendarbuilder/calendarScreen'
import OvertimeScreen, { EmployeePicker, PersonDays } from '@/pages/features/scheduling/OvertimeScreen'
import {
  PSI_PERIOD_ANCHOR, PSI_PERIOD_DAYS, cutsWeeks, hoursText, isPsiPeriod, overtimeFrom, periodChoices, pickedWords, pickerEmployees,
  plannedSourceLine, psiAnchorDay, psiLabel, psiPeriodOf, rangeProblem, screenParams, shownPeople, summaryOf, weekDays,
} from '@/pages/features/scheduling/overtimeModel'
import { SchedulingView } from '@/pages/features/scheduling/SchedulingPage'
import { OVERTIME_SCREEN_FEATURE, STAFF_SCREEN_FEATURE } from '@/pages/features/scheduling/ScreenSwitch'
import { boardFrom, type Board } from '@/pages/features/scheduling/schedulingModel'
import { useSchedulingRead, type BoardState } from '@/pages/features/scheduling/schedulingLane'
import { mountHook } from './react-host'

const ROOT = process.env.SPA_ROOT ?? process.cwd()

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

/** React's server draw marks where text and values meet; the words are read without the marks. */
const flat = (html: string) => html.replace(/<!-- -->/g, '')

const WEEKS = [
  { from: '2026-10-11', to: '2026-10-17', label: '10/11/26 – 10/17/26' },
  { from: '2026-10-18', to: '2026-10-24', label: '10/18/26 – 10/24/26' },
]

function answer(): Record<string, unknown> {
  const wk = (from: string, planned: number, actual: number) => ({
    from, planned, actual, over: actual > 40, plannedOver: planned > 40, overtime: Math.max(0, actual - 40),
  })
  return {
    from: '2026-10-11', to: '2026-10-24', threshold: 40, weeks: WEEKS, plannedSource: 'house calendars',
    people: [
      { key: 'U7', employeeId: 'U7', employeeName: 'Zoe Worked', weeks: [wk('2026-10-11', 40, 46.5), wk('2026-10-18', 32, 30)],
        planned: 72, actual: 76.5, overtime: 6.5, days: { '2026-10-12': { planned: 8, actual: 12.5 } } },
      { key: 'name:amy planned', employeeId: '', employeeName: 'Amy Planned', weeks: [wk('2026-10-11', 48, 36), wk('2026-10-18', 40, 40)],
        planned: 88, actual: 76, overtime: 0, days: {} },
      { key: 'U9', employeeId: 'U9', employeeName: 'Bo Under', weeks: [wk('2026-10-11', 24, 24)],
        planned: 24, actual: 24, overtime: 0, days: {} },
    ],
    totals: { people: 3, peopleOver: 1, overtimeHours: 6.5 },
    periods: [
      { id: 'P2026-10-25', from: '2026-10-25', to: '2026-11-07', label: '10/25/26 – 11/07/26', current: true, weeks: [] },
      { id: 'P2026-10-11', from: '2026-10-11', to: '2026-10-24', label: '10/11/26 – 10/24/26', current: false, weeks: WEEKS },
    ],
    employees: [{ key: 'U7', name: 'Zoe Worked' }, { key: 'name:amy planned', name: 'Amy Planned' }, { key: 'U9', name: 'Bo Under' }],
  }
}

describe('overtime — PsiAnywhere\'s pay periods', () => {
  it('the 14-day grid from Sunday 2026-06-07, as psi_periods.period_start', () => {
    assert.deepEqual(psiPeriodOf('2026-10-29'), { from: '2026-10-25', to: '2026-11-07' })
    assert.deepEqual(psiPeriodOf('2026-10-24'), { from: '2026-10-11', to: '2026-10-24' })
    assert.deepEqual(psiPeriodOf('2026-06-07'), { from: '2026-06-07', to: '2026-06-20' })
    assert.deepEqual(psiPeriodOf('2026-06-06'), { from: '2026-05-24', to: '2026-06-06' })
    assert.equal(psiPeriodOf('not a day'), null)
    assert.ok(isPsiPeriod('2026-10-25', '2026-11-07'))
    assert.ok(!isPsiPeriod('2026-10-26', '2026-11-07'))
    assert.equal(psiLabel('2026-10-25', '2026-11-07'), '10/25/26 – 11/07/26')
  })

  it('the grid is the server\'s: PERIOD_ANCHOR and PERIOD_DAYS of app/psi_periods.py, the same values', () => {
    // the copy only lets the first read ask for a real pay period; if one side moves alone, this fails
    const py = readFileSync(resolve(ROOT, 'app/psi_periods.py'), 'utf8')
    const anchor = /^PERIOD_ANCHOR\s*=\s*date\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)\s*$/m.exec(py)
    const days = /^PERIOD_DAYS\s*=\s*(\d+)\s*$/m.exec(py)
    assert.ok(anchor, 'app/psi_periods.py no longer says PERIOD_ANCHOR = date(y, m, d)')
    assert.ok(days, 'app/psi_periods.py no longer says PERIOD_DAYS = n')
    const [, y, m, d] = anchor
    assert.equal(PSI_PERIOD_ANCHOR, `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
    assert.equal(PSI_PERIOD_DAYS, Number(days[1]))
  })

  it('the day Scheduling stands on: the linked day, else today, else past a Saturday start', () => {
    const week = { from: '2026-10-24', to: '2026-10-30' } // Scheduling's Saturday→Friday week
    assert.equal(psiAnchorDay(week, '2026-10-29'), '2026-10-29')
    assert.equal(psiAnchorDay(week, '2026-10-29', '2026-10-26'), '2026-10-26')
    // another week drawn: its Saturday ends a PsiAnywhere week, the six days after it are the next one's
    assert.equal(psiAnchorDay({ from: '2026-11-07', to: '2026-11-13' }, '2026-10-29'), '2026-11-08')
    // a Monday-started period opens on its first day
    assert.equal(psiAnchorDay({ from: '2026-11-23', to: '2026-12-20' }, '2026-10-29'), '2026-11-23')
    assert.equal(psiAnchorDay({ from: '', to: '' }, ''), '')
  })

  it('at most 62 whole days, in order', () => {
    assert.equal(rangeProblem('2026-09-01', '2026-11-01'), '')
    assert.match(rangeProblem('2026-09-01', '2026-11-02'), /At most 62 days/)
    assert.match(rangeProblem('2026-10-02', '2026-10-01'), /after the last/)
    assert.match(rangeProblem('', '2026-10-01'), /both days/)
  })
})

describe('overtime — the answer and the filters', () => {
  it('an answer missing its fields draws as nothing, never a throw', () => {
    const d = overtimeFrom({ people: [{ key: 'K', weeks: [{ from: '2026-10-11', actual: '41' }], days: { bad: 1, '2026-10-12': 9 } }] })
    assert.equal(d.threshold, 40)
    assert.deepEqual(d.weeks, [])
    assert.equal(d.people[0].employeeName, 'K')
    assert.equal(d.people[0].weeks[0].over, true, 'a flag left out still follows the hours')
    assert.deepEqual(d.people[0].days, { '2026-10-12': { planned: 0, actual: 9 } })
    assert.deepEqual(overtimeFrom(null).people, [])
    // shaping twice changes nothing (a kept copy is shaped again when drawn)
    assert.deepEqual(overtimeFrom(overtimeFrom(answer())), overtimeFrom(answer()))
  })

  it('the picker lists the server\'s periods, the current one marked, and a period it did not list', () => {
    const d = overtimeFrom(answer())
    assert.deepEqual(periodChoices(d.periods, '2026-10-11', '2026-10-24').map((c) => c.label),
      ['10/25/26 – 11/07/26 (current)', '10/11/26 – 10/24/26'])
    assert.equal(periodChoices(d.periods, '2026-11-08', '2026-11-21')[0].label, '11/08/26 – 11/21/26')
    assert.equal(periodChoices(d.periods, '2026-11-09', '2026-11-21').length, 2, 'custom dates are no period')
  })

  it('a period the server did not list takes its place by date, so the list stays newest first', () => {
    const d = overtimeFrom(answer())
    const froms = (from: string, to: string, periods = d.periods) => periodChoices(periods, from, to).map((c) => c.from)
    // an older one a link opened goes below the newest, not above it
    assert.deepEqual(froms('2026-09-27', '2026-10-10'), ['2026-10-25', '2026-10-11', '2026-09-27'])
    // a future one Scheduling stands on is the newest
    assert.deepEqual(froms('2026-11-08', '2026-11-21'), ['2026-11-08', '2026-10-25', '2026-10-11'])
    // one between two listed sits between them
    const gap = [d.periods[0], { ...d.periods[1], id: 'P2026-09-27', from: '2026-09-27', to: '2026-10-10' }]
    assert.deepEqual(froms('2026-10-11', '2026-10-24', gap), ['2026-10-25', '2026-10-11', '2026-09-27'])
    // before any answer it is the only one
    assert.deepEqual(froms('2026-10-25', '2026-11-07', []), ['2026-10-25'])
  })

  it('a pick keeps its name when the next dates do not list that person, and can be unticked there', () => {
    const picked = new Map([['name:amy planned', 'Amy Planned']])
    assert.equal(pickedWords(new Map()), 'All employees')
    assert.equal(pickedWords(picked), 'Amy Planned')
    assert.equal(pickedWords(new Map([...picked, ['U7', 'Zoe Worked']])), '2 employees')
    const others = [{ key: 'U9', name: 'Bo Under' }, { key: 'U7', name: 'Zoe Worked' }]
    assert.deepEqual(pickerEmployees(others, picked), [
      { key: 'name:amy planned', name: 'Amy Planned', absent: true },
      { key: 'U9', name: 'Bo Under', absent: false },
      { key: 'U7', name: 'Zoe Worked', absent: false },
    ])
    // listed and picked: once, not absent
    assert.deepEqual(pickerEmployees([{ key: 'name:amy planned', name: 'Amy Planned' }], picked),
      [{ key: 'name:amy planned', name: 'Amy Planned', absent: false }])
    // the rows filter by the keys alone, as before
    assert.deepEqual(shownPeople(overtimeFrom(answer()).people, picked, false).map((p) => p.key), ['name:amy planned'])

    const draw = (employees: { key: string; name: string }[] | null) => flat(renderToString(createElement(EmployeePicker,
      { employees, picked, onPicked: () => {}, initialOpen: true })))
    const away = draw(others)
    assert.match(away, /aria-label="Employees: Amy Planned"/)
    assert.ok(!away.includes('>name:amy planned<'), 'never the bare key')
    assert.match(away, /data-ot-employee="name:amy planned" data-ot-absent=""/)
    assert.match(away, /Amy Planned<span[^>]*> · no hours in these dates<\/span>/)
    // while the next answer is read: the name still, and no claim about hours yet
    const reading = draw(null)
    assert.match(reading, /aria-label="Employees: Amy Planned"/)
    assert.ok(!reading.includes('data-ot-absent') && !reading.includes('no hours in these dates'))
  })

  it('only those over the line (worked or planned), the employees picked, in the server\'s order', () => {
    const d = overtimeFrom(answer())
    assert.deepEqual(shownPeople(d.people, new Set(), true).map((p) => p.key), ['U7', 'name:amy planned'])
    assert.deepEqual(shownPeople(d.people, new Set(), false).map((p) => p.key), ['U7', 'name:amy planned', 'U9'])
    assert.deepEqual(shownPeople(d.people, new Set(['U9']), true), [])
    assert.deepEqual(summaryOf(shownPeople(d.people, new Set(), true)), { people: 2, workedOver: 1, overtime: 6.5 })
    assert.equal(hoursText(46.499999), '46.5')
    assert.equal(plannedSourceLine('schedule'), 'Planned hours from the schedule.')
    assert.equal(plannedSourceLine('house calendars'), 'Planned hours from the house calendars.')
    assert.equal(weekDays('2026-10-11').length, 7)
    assert.equal(cutsWeeks(d), false)
    assert.equal(cutsWeeks({ ...d, from: '2026-10-12' }), true)
  })
})

describe('overtime — the screen', () => {
  it('draws the held answer: the period, the rows over the line, red and amber, the note', async () => {
    // the screen's read holds its answer as every Scheduling screen's does; the server draw takes it from there
    const h = mountHook(() => useSchedulingRead('overtime|2026-10-11|2026-10-24', async () => answer()), undefined)
    await h.settle(() => h.current.status === 'ready')
    h.unmount()
    const html = flat(renderToString(createElement(MemoryRouter, { initialEntries: ['/app/scheduling/calendar?view=overtime&ot_from=2026-10-11&ot_to=2026-10-24'] },
      createElement(OvertimeScreen, { anchor: '2026-10-29', tick: 0 }))))
    const rows = [...html.matchAll(/data-ot-person="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(rows, ['U7', 'name:amy planned'], 'Bo Under is not over the line')
    assert.match(html, /10\/25\/26 – 11\/07\/26 \(current\)/)
    assert.match(html, /<option value="P2026-10-11" selected="">10\/11\/26 – 10\/24\/26<\/option>/)
    assert.match(html, /Custom dates/)
    assert.equal((html.match(/data-worked-over=""/g) ?? []).length, 1, 'Zoe\'s 46.5 h week')
    assert.equal((html.match(/data-planned-over=""/g) ?? []).length, 1, 'Amy\'s 48 h planned week')
    assert.match(html, /Planned hours from the house calendars\./)
    assert.match(html, /Only over 40 h/)
    assert.match(html, /2 people · 1 worked over 40 h · 6\.5 h overtime/)
    assert.ok(!/role="dialog"|aria-modal/.test(html), 'no modal')
  })

  it('the right panel: each week\'s seven days, planned against worked, the days outside the dates greyed', () => {
    const d = overtimeFrom(answer())
    const html = flat(renderToString(createElement(PersonDays, { person: d.people[0], data: { ...d, from: '2026-10-12' } })))
    assert.equal((html.match(/data-ot-day="/g) ?? []).length, 14)
    assert.match(html, /data-ot-day="2026-10-12"><td class="py-1\.5">Mon, Oct 12<\/td><td[^>]*>8<\/td><td[^>]*>12\.5<\/td>/)
    assert.match(html, /Sun, Oct 11<span[^>]*>· outside the dates<\/span>/)
    assert.match(html, /6\.5 over/)
  })

  it('without dates in the address it asks for the pay period holding Scheduling\'s day', () => {
    const html = flat(renderToString(createElement(MemoryRouter, { initialEntries: ['/app/scheduling/calendar?view=overtime'] },
      createElement(OvertimeScreen, { anchor: '2026-11-08', tick: 0 }))))
    assert.match(html, /11\/08\/26 – 11\/21\/26/)
    assert.match(html, /data-ot-loading=""/)
  })
})

/* ---------- where Scheduling draws it ---------- */

const signIn = (user: Record<string, unknown> | null) => useAuthStore.setState({ user } as never)
after(() => signIn(null))

const PERIODS = [
  { id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' },
  { id: 'P2026-10-26', first: '2026-10-26', last: '2026-11-22', state: 'live' },
]

/** A board of one empty house in period `id`, for the master. */
function board(id: string): Board {
  const period = PERIODS.find((p) => p.id === id) ?? PERIODS[0]
  return boardFrom({
    ok: true, now: '2026-10-03T12:00:00Z', today: '2026-10-03', period, periods: PERIODS,
    houses: [{ code: 'BM4060', location: 'CAN - BM - BM4060', short: 'BM', staff: 0, managers: [], open: 0 }],
    viewer: { uid: 'M', name: 'The Master', key: 'master', is_master: true, is_director: false, editor_of: [], can_edit_any: true },
    test_mode: { on: false, readable: true, why: '' },
    display: { hidden: { hours: false } },
    settings: { min_days_ahead: 7, outreach_wait_min: 7, cycle_days: 28, roll_lead_days: 7, directors: [], directors_readable: true },
    grids: {}, busy: {}, people: [], mine: [], waiting_on_me: [],
  })
}

const view = (search: string, state: BoardState) => flat(renderToString(createElement(MemoryRouter,
  { initialEntries: [`/app/scheduling/calendar?${search}`] },
  createElement(SchedulingView, { state, sessionMaster: true, onReload: () => {}, onAbsorb: () => {} }))))
const readyBoard = (b: Board): BoardState => ({ status: 'ready', board: b, error: '', refreshing: false })

describe('overtime — inside Scheduling', () => {
  it('a screen whose row is not declared yet is the master\'s alone, never everybody\'s', () => {
    const anyone = { isMaster: false, types: ['DIRECTOR'] }
    // an undeclared id with no row: the master, and nobody else (a control's missing row would open it to all)
    assert.equal(screenAllowsWith('scheduling.notDeclaredYet', anyone, {}), false)
    assert.equal(screenAllowsWith('scheduling.notDeclaredYet', { isMaster: true }, {}), true)
    assert.equal(screenAllowsWith('scheduling.notDeclaredYet', null, {}), false)
    // a row naming a badge answers as App Control says, declared or not
    assert.equal(screenAllowsWith('scheduling.notDeclaredYet', anyone, { 'scheduling.notDeclaredYet': ['DIRECTOR'] }), true)
    // Overtime: refused to a non-master with no row, whether or not this branch declares it yet
    assert.equal(screenAllowsWith(OVERTIME_SCREEN_FEATURE, anyone, {}), false)
    assert.equal(screenAllowsWith(OVERTIME_SCREEN_FEATURE, { isMaster: true }, {}), true)
    // a declared screen answers exactly as before (masterUntilReleased, then its row)
    assert.equal(screenAllowsWith(STAFF_SCREEN_FEATURE, anyone, {}), false)
    assert.equal(screenAllowsWith(STAFF_SCREEN_FEATURE, anyone, { [STAFF_SCREEN_FEATURE]: ['DIRECTOR'] }), true)

    signIn({ id: 'u-1', name: 'Dee Rector', types: ['DIRECTOR'], isMaster: false })
    const other = view('view=overtime&house=BM4060', readyBoard(board('P2026-09-28')))
    assert.ok(!other.includes('data-overtime=""') && !other.includes('data-screen="overtime"'), 'not offered, not drawn')
    signIn({ id: 'u-m', name: 'The Master', types: [], isMaster: true })
    const master = view('view=overtime&house=BM4060', readyBoard(board('P2026-09-28')))
    assert.ok(master.includes('data-screen="overtime"') && master.includes('data-overtime=""'))
  })

  it('drawn when the board could not be read, on the lane\'s own default period', () => {
    signIn({ id: 'u-m', name: 'The Master', types: [], isMaster: true })
    const html = view('view=overtime', { status: 'failed', board: null, error: 'down', refreshing: false })
    assert.ok(html.includes('data-read-failed=""'), 'the calendars say they could not be read')
    assert.ok(html.includes('data-overtime=""'), 'Overtime does not need the board')
    assert.match(html, /<h2[^>]*>Overtime<\/h2>/)
  })

  it('a link to a day of another period waits for that period\'s board, then opens on the day', () => {
    signIn({ id: 'u-m', name: 'The Master', types: [], isMaster: true })
    for (const screen of ['overtime', 'recon']) {
      // the current period's board under a day of the next one: the screen is not drawn on it, to be drawn again
      const leaving = view(`view=${screen}&day=2026-11-03`, readyBoard(board('P2026-09-28')))
      assert.ok(leaving.includes(`data-screen="${screen}"`), screen)
      assert.ok(!leaving.includes('data-overtime=""') && !leaving.includes('data-time-recon=""'), `${screen}: held`)
    }
    // the recon screen, too, once the linked period is in place
    assert.ok(view('view=recon&period=P2026-10-26&day=2026-11-03', readyBoard(board('P2026-10-26'))).includes('data-time-recon=""'))
    // the linked period in place: drawn once, on the pay period holding the linked day
    const there = view('view=overtime&period=P2026-10-26&day=2026-11-03', readyBoard(board('P2026-10-26')))
    assert.ok(there.includes('data-overtime=""'))
    assert.match(there, /<h2[^>]*>10\/25\/26 – 11\/07\/26<\/h2>/)
    // the same day inside the board on screen: no wait
    assert.ok(view('view=overtime&day=2026-10-20', readyBoard(board('P2026-09-28'))).includes('data-overtime=""'))
  })

  it('leaving Overtime drops its dates from the address; the other keys stay', () => {
    const at = new URLSearchParams('view=overtime&house=BM4060&period=P2026-10-26&ot_from=2026-10-11&ot_to=2026-10-24')
    assert.equal(withParams(at, screenParams('staff')).toString(), 'view=staff&house=BM4060&period=P2026-10-26')
    assert.equal(withParams(at, screenParams('house')).toString(), 'house=BM4060&period=P2026-10-26')
    // pressing Overtime again keeps the dates picked
    assert.equal(withParams(at, screenParams('overtime')).toString(), at.toString())
  })
})
