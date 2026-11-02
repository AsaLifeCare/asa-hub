/** Scheduling's pure model: OPEN rows first, who is free, the notice rule, the badge tones and the hours gate. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALWAYS_MARKS, flowLabel, flowOpen, flowSteps, trainingSteps, trainingWaiting, withdrawable,
  HOURS_HIDDEN_LINE, MED_CLASS, MED_TONE, TEST_MODE_UNREAD, badgeList, boardFrom, cellMarks, cellMinutes, clashFor,
  daysAhead, drawnDays, firstRange, freePeople, hoursHiddenLine, hoursShown, marksPresent, mayAskAhead, mergeWrite,
  noticeLine, notPossibleLine, orderRows, panelMode, periodWeeks, swapSteps, testModeBanner, thisWeekOf, weekDays,
  type Board, type GridRow,
} from '@/pages/features/scheduling/schedulingModel'
import { schedHoursHiddenFor } from '@/pages/settings/myWorkDisplay'

const NO_BADGES = { hm: false, lead: false, med: 0 as const }
const row = (row_id: string, kind: GridRow['kind'], name = '', over: Partial<GridRow> = {}): GridRow => ({
  row_id, kind, name, key: name.toLowerCase().replace(/[^a-z0-9]+/g, ''), designation: '', badges: NO_BADGES, me: false,
  cells: [], ...over,
})

function board(over: Record<string, unknown> = {}): Board {
  return boardFrom({
    ok: true, today: '2026-10-01',
    period: { id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' },
    houses: [
      { code: 'BM4060', location: 'CAN - BM - BM4060', short: 'BM', staff: 3, managers: ['Mia Manager'], open: 1 },
      { code: 'ABD1711', location: 'CAN - 48TH (B) - ABD1711', short: '48TH (B)', staff: 2, managers: [], open: 0 },
    ],
    viewer: { uid: 'U1', name: 'Ann Roe', key: 'annroe', is_master: false, is_director: false, editor_of: [], can_edit_any: false },
    test_mode: { on: true, readable: true, why: '' },
    display: { hidden: { hours: true } },
    settings: { min_days_ahead: 7, directors: ['Ty Bond'], directors_readable: true },
    grids: {
      BM4060: {
        code: 'BM4060',
        cols: [{ iso: '2026-10-01', date: '10/1', short: 'Oct 1', weekday: 'THU' }, { iso: '2026-10-02', date: '10/2', short: 'Oct 2', weekday: 'FRI' }],
        rows: [
          row('P:annroe', 'person', 'Ann Roe', { me: true, cells: [{ text: '8A-4P', kind: 'morning', state: 'scheduled' }, null] }),
          row('P:bobbyrae', 'person', 'Bobby Rae', { cells: [{ text: 'R/O', kind: 'ro', state: 'scheduled' }, null] }),
        ],
        days: [],
      },
    },
    busy: {
      annroe: [['2026-10-01', 480, 960, 'BM4060']],
      cara: [['2026-10-01', 1200, 1920, 'ABD1711']],
    },
    people: [
      { key: 'annroe', name: 'Ann Roe', has_account: true },
      { key: 'bobbyrae', name: 'Bobby Rae', has_account: true },
      { key: 'cara', name: 'Cara Dee', has_account: false },
      { key: 'dan', name: 'Dan Fox', has_account: true },
    ],
    ...over,
  })
}

describe('scheduling model — the rows', () => {
  it('draws every OPEN row above the first person, by its number, and WORKSHOP last', () => {
    const rows = [
      row('P:a', 'person', 'A'), row('X:workshop', 'workshop', 'WORKSHOP (KC)'), row('OPEN:2', 'open', 'OPEN'),
      row('P:b', 'person', 'B'), row('OPEN:1', 'open', 'OPEN'),
    ]
    assert.deepEqual(orderRows(rows).map((r) => r.row_id), ['OPEN:1', 'OPEN:2', 'P:a', 'P:b', 'X:workshop'])
  })
})

describe('scheduling model — the badges', () => {
  it('house manager, the Med level held, team leader — in that order', () => {
    assert.deepEqual(badgeList({ hm: true, lead: true, med: 2 }).map((b) => b.id), ['hm', 'med', 'lead'])
    assert.deepEqual(badgeList({ hm: false, lead: false, med: 0 }), [])
    const med = badgeList({ med: 3 })[0]
    assert.equal(med.id === 'med' && med.label, 'Medication Administration 3')
  })

  it('Medication Administration 1 / 2 / 3 is bronze, silver, gold — each its own colour', () => {
    assert.deepEqual(MED_TONE, { 1: 'bronze', 2: 'silver', 3: 'gold' })
    assert.equal(new Set(Object.values(MED_CLASS)).size, 3)
    assert.match(MED_CLASS.gold, /tint-amber/)
    assert.match(MED_CLASS.silver, /tint-slate/)
    assert.doesNotMatch(MED_CLASS.bronze, /tint-amber|tint-peach/, 'peach and amber are one colour in the theme')
  })
})

describe('scheduling model — the hours gate', () => {
  it('fails closed: only a plain "shown" opens the hours to anybody but the master', () => {
    assert.equal(schedHoursHiddenFor(false, undefined), true)
    assert.equal(schedHoursHiddenFor(false, true), true)
    assert.equal(schedHoursHiddenFor(false, false), false)
    assert.equal(schedHoursHiddenFor(true, true), false)
  })

  it('the master is the master only when the session and the answer agree', () => {
    const staff = board()
    assert.equal(hoursShown(staff, false), false)
    assert.equal(hoursShown(staff, true), false, 'a session that says master, an answer that does not')
    const master = board({ viewer: { uid: 'M', name: 'Master', key: '', is_master: true }, display: { hidden: { hours: false } } })
    assert.equal(hoursShown(master, true), true)
    assert.equal(hoursShown(boardFrom({ display: {} }), false), false, 'an answer that says nothing hides')
    assert.equal(hoursShown(null, true), false)
  })

  it('the master is told when the hours are hidden from everyone else', () => {
    const master = board({ viewer: { is_master: true }, display: { hidden: { hours: false } } })
    assert.equal(hoursHiddenLine(master, true), HOURS_HIDDEN_LINE)
    assert.equal(hoursHiddenLine(board({ viewer: { is_master: true }, display: { hidden: { hours: false }, hidden_from_others: { hours: false } } }), true), '')
    assert.equal(hoursHiddenLine(board(), false), '')
  })
})

describe('scheduling model — test mode', () => {
  it('an answer with no test mode holds; a failed read draws the banner too', () => {
    assert.deepEqual(boardFrom({}).test_mode, TEST_MODE_UNREAD)
    assert.equal(boardFrom({ test_mode: { on: false, readable: false } }).test_mode.on, true)
    assert.deepEqual(testModeBanner(null, true), { show: true, unread: true })
    assert.deepEqual(testModeBanner(null, false), { show: true, unread: false }, 'still being read: it holds until the board says')
    assert.equal(testModeBanner(boardFrom({ test_mode: { on: false, readable: true } }), false).show, false)
  })
})

describe('scheduling model — who is free', () => {
  it('half-open intervals at every house: a handover is free, an overlap is not, an overnight carries', () => {
    const b = board()
    assert.equal(clashFor(b, 'annroe', '2026-10-01', 960, 1440), null, '4P start after a 4P end is a handover')
    assert.equal(clashFor(b, 'annroe', '2026-10-01', 900, 1000)?.house, 'BM')
    // Cara's 8P-8A at 48TH (B) holds the next morning too
    assert.equal(clashFor(b, 'cara', '2026-10-02', 420, 600)?.house, '48TH (B)')
    assert.equal(clashFor(b, 'cara', '2026-10-02', 480, 960), null)
  })

  it('a day off is not free, whatever the hours', () => {
    assert.match(clashFor(board(), 'bobbyrae', '2026-10-01', 0, 60)?.why ?? '', /off that day/)
  })

  it('the edited shift does not clash with itself', () => {
    const ignore = { house_code: 'BM4060', date: '2026-10-01', start: 480, end: 960 }
    assert.equal(clashFor(board(), 'annroe', '2026-10-01', 480, 1020, ignore), null)
  })

  it('the free list leaves out the busy, says why, and the warning names the house', () => {
    const split = freePeople(board(), '2026-10-01', [600, 900], { except: 'dan' })
    assert.deepEqual(split.free.map((p) => p.key), ['cara'])
    assert.deepEqual(split.blocked.map((x) => x.person.key).sort(), ['annroe', 'bobbyrae'])
    const clash = clashFor(board(), 'annroe', '2026-10-01', 600, 900)!
    assert.equal(notPossibleLine('Ann Roe', clash), 'Not possible: Ann Roe is already at BM 8A-4P that day.')
  })

  it('reads a chained cell the way the server does: the first range', () => {
    assert.deepEqual(firstRange('8A-4P > 48TH (B)'), { start: 8, end: 16 })
    assert.deepEqual(cellMinutes({ text: '930P-730A' }), [1290, 1890])
    assert.equal(firstRange('OFF'), null)
  })
})

describe('scheduling model — weeks and the notice rule', () => {
  it('Saturday weeks across the period', () => {
    assert.deepEqual(periodWeeks({ first: '2026-09-28', last: '2026-10-25' }), ['2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24'])
    assert.deepEqual(weekDays('2026-09-26'), ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
    assert.equal(thisWeekOf('2026-10-01', { first: '2026-09-28', last: '2026-10-25' }), '2026-09-26')
    assert.equal(thisWeekOf('2026-11-01', { first: '2026-09-28', last: '2026-10-25' }), null)
    assert.deepEqual(drawnDays('week', '2026-10-03', { first: '2026-09-28', last: '2026-10-25' }), { from: '2026-10-03', to: '2026-10-09', range: 'week' })
    assert.equal(drawnDays('period', '2026-10-03', { first: '2026-09-28', last: '2026-10-25' }).to, '2026-10-25')
  })

  it('Request Off and Time off need seven days; inside them only Call Off and Swap, and why', () => {
    assert.equal(daysAhead('2026-10-01', '2026-10-08'), 7)
    assert.equal(mayAskAhead('2026-10-01', '2026-10-08'), true)
    assert.equal(mayAskAhead('2026-10-01', '2026-10-07'), false)
    assert.equal(noticeLine('2026-10-01', '2026-10-03'),
      'Request Off and Time off need 7 days’ notice. This shift is in 2 days, so only Call Off and Swap are offered.')
  })
})

describe('scheduling model — which panel a press opens', () => {
  const shift = { text: '8A-4P', kind: 'morning', state: 'scheduled' }
  it('own, take, assign, edit, read', () => {
    const today = '2026-10-01'
    assert.equal(panelMode({ row: { kind: 'person', me: true }, cell: shift, editor: false, date: '2026-10-02', today }), 'own')
    assert.equal(panelMode({ row: { kind: 'person', me: true }, cell: shift, editor: false, date: '2026-09-30', today }), 'read', 'a past shift')
    assert.equal(panelMode({ row: { kind: 'open', me: false }, cell: shift, editor: false, date: '2026-10-02', today }), 'take')
    assert.equal(panelMode({ row: { kind: 'open', me: false }, cell: shift, editor: true, date: '2026-10-02', today }), 'assign')
    assert.equal(panelMode({ row: { kind: 'person', me: false }, cell: shift, editor: true, date: '2026-10-02', today }), 'edit')
    assert.equal(panelMode({ row: { kind: 'person', me: false }, cell: shift, editor: false, date: '2026-10-02', today }), 'read')
    assert.equal(panelMode({ row: { kind: 'person', me: true }, cell: { ...shift, state: 'called_off' }, editor: false, date: '2026-10-02', today }), 'read')
  })

  it('a shift got by a swap, taken from OPEN or worked as a training is the holder\'s own', () => {
    const today = '2026-10-01'
    for (const state of ['swap_in', 'taken', 'training']) {
      assert.equal(panelMode({ row: { kind: 'person', me: true }, cell: { ...shift, state }, editor: false, date: '2026-10-02', today }), 'own', state)
    }
  })
})

describe('scheduling model — a training (no IST at the house)', () => {
  const seats = (hm: string, dir: string) => [{ seat: 'house_manager', to: [], state: hm }, { seat: 'director', to: [], state: dir }]
  it('walks Placed → House manager → Director → Training; both seats asked at once, one decline decides', () => {
    const waiting = trainingSteps({ state: 'waiting', seats: seats('approved', 'waiting') as never })
    assert.deepEqual(waiting.map((s) => s.label), ['Placed', 'House manager', 'Director', 'Training'])
    assert.deepEqual(waiting.map((s) => s.state), ['done', 'done', 'waiting', 'na'])
    assert.deepEqual(trainingSteps({ state: 'approved', seats: seats('approved', 'approved') as never }).map((s) => s.state), ['done', 'done', 'done', 'done'])
    assert.deepEqual(trainingSteps({ state: 'declined', seats: seats('waiting', 'declined') as never }).map((s) => s.state), ['done', 'na', 'refused', 'refused'])
    const skipped = trainingSteps({ state: 'waiting', seats: JSON.stringify([{ seat: 'house_manager', to: [], state: 'skipped', why: 'no house manager on file' }]) })
    assert.deepEqual([skipped[1].state, skipped[1].note], ['na', 'no house manager on file'])
    assert.deepEqual(flowSteps({ kind: 'training', state: 'waiting', seats: [] }).map((s) => s.id), ['placed', 'house_manager', 'director', 'training'])
  })

  it('is never withdrawn, stays open while it waits, and its cell is marked apart from coverage', () => {
    assert.equal(withdrawable({ kind: 'training', state: 'waiting' }), false)
    assert.equal(withdrawable({ kind: 'request_off', state: 'waiting' }), true)
    assert.equal(flowOpen({ kind: 'training', state: 'waiting' }), true)
    assert.equal(trainingWaiting({ kind: 'training', state: 'approved' }), false)
    const cell = (state: string) => ({ text: '4P-12A', kind: 'evening', state: 'training', flow: { id: 'SF1', kind: 'training', state } })
    assert.deepEqual(cellMarks({ kind: 'person' }, cell('waiting')), ['training-waiting'])
    assert.deepEqual(cellMarks({ kind: 'person' }, cell('approved')), ['training'])
    assert.deepEqual(cellMarks({ kind: 'person' }, { text: '4P-12A', kind: 'evening', state: 'training' }), ['training'], 'no flow shown: still a training')
    assert.ok(ALWAYS_MARKS.includes('training'))
  })

  it('a shift reopened by a declined training never reads as the trainee\'s call-off', () => {
    assert.equal(flowLabel({ kind: 'call_off', source: 'training' }), 'Shift reopened (training not approved)')
    assert.equal(flowLabel({ kind: 'call_off', source: 'platform' }), 'Call off')
    assert.equal(flowLabel({ kind: 'training' }), 'Training')
  })
})

describe('scheduling model — flows and marks', () => {
  it('a swap walks Proposed → Staff → House manager → Director → Swapped', () => {
    const steps = swapSteps({ state: 'waiting_manager', seats: [] })
    assert.deepEqual(steps.map((s) => s.label), ['Proposed', 'Staff', 'House manager', 'Director', 'Swapped'])
    assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'waiting', 'na', 'na'])
    const declined = swapSteps({ state: 'declined', seats: JSON.stringify([{ seat: 'staff', to: [], state: 'approved' }, { seat: 'house_manager', to: [], state: 'declined' }]) })
    assert.deepEqual(declined.map((s) => s.state), ['done', 'done', 'refused', 'na', 'na'])
  })

  it('marks the cells and lists only the marks present', () => {
    assert.deepEqual(cellMarks({ kind: 'open' }, { text: '8A-4P', kind: 'morning', state: 'open' }), ['open'])
    assert.deepEqual(cellMarks({ kind: 'person' }, { text: '', kind: 'alias', state: 'scheduled', echo: '48TH (B)' }), ['echo'])
    assert.deepEqual(cellMarks({ kind: 'person' }, { text: '8A-4P', kind: 'morning', state: 'scheduled', flow: { id: 'SF1', kind: 'swap', state: 'waiting_staff' } }), ['swap-waiting'])
    assert.deepEqual(marksPresent(board().grids.BM4060), [])
  })

  it('a write lays its houses and people over the board', () => {
    const b = board()
    const merged = mergeWrite(b, { ok: true, said: 'Done.', period_id: b.period.id, grids: {}, busy: { annroe: [] }, mine: [], test_mode: { on: false, readable: true, why: '' } })
    assert.deepEqual(merged.busy.annroe, [])
    assert.deepEqual(merged.busy.cara, b.busy.cara)
    assert.equal(merged.test_mode.on, false)
  })
})
