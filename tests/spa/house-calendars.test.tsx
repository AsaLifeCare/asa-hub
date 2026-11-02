/**
 * House Calendars, screen side: drop verdicts, the panel for its three readers, the rail order and house bar.
 * The server side is tools/test-house-calendars.py.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import ShiftCellPanel from '@/pages/features/shifts/ShiftCellPanel'
import HouseGrid from '@/pages/features/shifts/HouseGrid'
import { TIME_OFF_FLAG, timeOffMarksOf } from '@/pages/features/shifts/timeOffMarks'
import {
  dropVerdict, managerLine, nameKey, sameName, sortHouses,
  type CellFact, type Computed, type Grid, type House, type OpenShift,
} from '@/pages/features/shifts/houseCalTypes'

const drop = (over: Partial<Parameters<typeof dropVerdict>[0]> = {}) => dropVerdict({
  mayEdit: true, sameCell: false, fromOpenRow: false, toOpenRow: false,
  moving: '8A-4P', landing: '', swap: false, ...over,
})

describe('what a drop means — nothing destroyed without a word', () => {
  it('a drop onto an empty cell is a move', () => {
    assert.deepEqual(drop(), { kind: 'move' })
  })
  it('a plain drop onto a cell that holds a shift is a QUESTION, naming that shift', () => {
    assert.deepEqual(drop({ landing: '2P-10P' }), { kind: 'confirm', displaced: '2P-10P' })
  })
  it('even OFF is something — replacing a day off is asked about too', () => {
    assert.equal(drop({ landing: 'OFF' }).kind, 'confirm')
  })
  it('Shift-drop still trades the two, and a trade destroys nothing', () => {
    assert.deepEqual(drop({ landing: '2P-10P', swap: true }), { kind: 'swap' })
  })
  it('an OPEN row is never dropped on', () => {
    const got = drop({ toOpenRow: true })
    assert.equal(got.kind, 'refuse')
    assert.match(got.kind === 'refuse' ? got.why : '', /assigned from its panel/)
  })
  it('and never dragged from', () => {
    assert.equal(drop({ fromOpenRow: true }).kind, 'refuse')
  })
  it('a reader who does not edit this house moves nothing', () => {
    assert.equal(drop({ mayEdit: false }).kind, 'refuse')
  })
  it('the same cell, or an empty source, is nothing at all', () => {
    assert.deepEqual(drop({ sameCell: true }), { kind: 'none' })
    assert.deepEqual(drop({ moving: '  ' }), { kind: 'none' })
  })
})

describe('the rail and the house bar', () => {
  const houses: House[] = [
    { location: 'CAN - MS - MS4060', staff: 9, updated_at: '', may_edit: false },
    { location: 'CAN - 38TH - ABD2005', staff: 12, updated_at: '', may_edit: true },
    { location: 'CAN - BM - BM4060', staff: 8, updated_at: '' },
    { location: 'CAN - 48TH (B) - ABD1711', staff: 7, updated_at: '', may_edit: true },
  ]
  it('the houses this reader edits come first, then the rest, each by name', () => {
    assert.deepEqual(sortHouses(houses).map((h) => h.location), [
      'CAN - 38TH - ABD2005', 'CAN - 48TH (B) - ABD1711', 'CAN - BM - BM4060', 'CAN - MS - MS4060',
    ])
  })
  it('does not reorder what it was given', () => {
    sortHouses(houses)
    assert.equal(houses[0].location, 'CAN - MS - MS4060')
  })
  it('a house run by two people names both', () => {
    assert.equal(managerLine({ name: 'Wanda McCollum-Dotson', names: ['Wanda McCollum-Dotson', 'Jordyn Walker'], readable: true, why: '' }),
      'Wanda McCollum-Dotson and Jordyn Walker')
  })
  it('a house with nobody says the relay\'s sentence, not a blank', () => {
    const why = 'the hotline calendar names no house manager for this house, so only directors, supervisors and administrators edit its calendar'
    assert.equal(managerLine({ name: '', names: [], readable: true, why }), why)
  })
  it('names are the platform\'s own key', () => {
    assert.equal(nameKey('  Ann  ROE '), 'annroe')
    assert.equal(sameName('Ann Roe', 'ann roe'), true)
    assert.equal(sameName('', ''), false)
  })
})

const LOC = 'CAN - BM - BM4060'
const open: OpenShift = {
  key: 'OPEN 2|2026-09-30', location: LOC, open_row: 'OPEN 2', col_iso: '2026-09-30', raw: '8A-230P',
  code: '8A-230P', start: 8, end: 14.5, hours: 6.5, kind: 'day', overnight: false,
  claimed_by: null, claimed_via: null, claimed_at: null, starts_at: '2026-09-30T08:00:00-04:00', started: false,
}
const fact: CellFact = {
  employee: 'Ann Roe', col_iso: '2026-09-30', raw: '8A-4P', kind: 'day', code: '8A-4P', start: 8, end: 16,
  token: null, hours: 8, overnight: false, edited: false,
}
const computed: Computed = {
  cells: {}, people: [], days: [], conflicts: [], open_shifts: [open],
  window: { first: '2026-09-26', last: '2026-10-09', days: 14, covers_today: true, today: '2026-09-22' },
  weekly_ot_hours: 40, totals: { hours: 0, shifts: 0, people: 0, open: 1 },
}
const noop = () => {}

// framer-motion needs window listeners; removed again after this file
const g = globalThis as unknown as Record<string, unknown>
const hadListeners = typeof g.addEventListener === 'function'
before(() => {
  if (!hadListeners) {
    g.addEventListener = noop
    g.removeEventListener = noop
  }
})
after(() => {
  if (!hadListeners) {
    delete g.addEventListener
    delete g.removeEventListener
  }
})

function panel(over: Partial<Parameters<typeof ShiftCellPanel>[0]>): string {
  return renderToString(
    <ShiftCellPanel
      target={{ employee: 'OPEN 2', colIso: '2026-09-30', label: 'Wed 9/30' }}
      house={LOC} text="8A-230P" fact={undefined} computed={computed} saving={false}
      openShift={open} staff={['Ann Roe', 'Ben Left']} mayEdit={false} openRow me="Ann Roe"
      onClaim={noop} onOpenRequests={noop} onClose={noop}
      {...over}
    />,
  )
}

describe('the panel, for a caregiver who followed a link to an open shift', () => {
  it('is the open shift, named as one — not as a person called OPEN 2', () => {
    const html = panel({})
    assert.match(html, /Open shift/)
    assert.match(html, /row OPEN 2/)
  })
  it('with no word from the relay about them yet, says why there is no Apply — and where applications live', () => {
    // a shift the pool has not met yet cannot be applied for, and says so
    const html = panel({})
    assert.match(html, /not open for applications yet/)
    assert.match(html, /Calendar Builder → Requests/)
    assert.doesNotMatch(html, /Apply for this shift/)
  })
  it('offers nothing the door would refuse: no assignment, no cell editor, no Apply', () => {
    const html = panel({})
    assert.doesNotMatch(html, /Assign this shift/)
    assert.doesNotMatch(html, /placeholder="8A-8P/)
    assert.doesNotMatch(html, />Apply</)
  })
})

describe('the panel, for the house\'s editor', () => {
  it('assigns an open shift, and never types over it', () => {
    const html = panel({ mayEdit: true })
    assert.match(html, /Assign this shift/)
    assert.doesNotMatch(html, /placeholder="8A-8P/)
    assert.match(html, /not typed over or cleared/)
  })
  it('does not offer an OPEN row as somebody to place', () => {
    const html = panel({ mayEdit: true })
    assert.doesNotMatch(html, /<option value="OPEN/)
  })
  it('a shift that has begun is assigned by nobody here', () => {
    const html = panel({ mayEdit: true, openShift: { ...open, started: true } })
    assert.match(html, /Started · nobody is on it/)
    assert.doesNotMatch(html, /Assign this shift/)
  })
  it('an ordinary cell is changed in Calendar Builder — the panel sends the editor there and types nothing', () => {
    const html = panel({
      mayEdit: true, openRow: false, openShift: undefined, fact, text: '8A-4P',
      target: { employee: 'Ben Left', colIso: '2026-09-30', label: 'Wed 9/30' },
      onEditInBuilder: noop,
    })
    assert.match(html, /Change it in Builder/)
    assert.match(html, /as a draft you publish for the house/)
    assert.doesNotMatch(html, /placeholder="8A-8P/)
    assert.doesNotMatch(html, />Apply</)
    assert.doesNotMatch(html, /NCNS/)
  })
  it('an EMPTY cell on an OPEN row is put up in Calendar Builder too, never typed here', () => {
    const html = panel({ mayEdit: true, openShift: undefined, text: '', onEditInBuilder: noop })
    assert.match(html, /Calendar Builder/)
    assert.doesNotMatch(html, /placeholder="8A-8P/)
  })
})

describe('the panel, read-only, on a person\'s cell', () => {
  const cell = (employee: string) => panel({
    openRow: false, openShift: undefined, fact, text: '8A-4P',
    target: { employee, colIso: '2026-09-30', label: 'Wed 9/30' },
  })
  it('their own shift can still be transferred — the receiver and the approver decide', () => {
    assert.match(cell('Ann Roe'), /Transfer this shift/)
  })
  it('somebody else\'s cannot, and nothing on it is editable', () => {
    const html = cell('Ben Left')
    assert.doesNotMatch(html, /Transfer this shift/)
    assert.doesNotMatch(html, /placeholder="8A-8P/)
    assert.match(html, /Read-only/)
  })
})

describe('as source — the page draws the relay\'s answer', () => {
  const root = process.env.SPA_ROOT ?? process.cwd()
  const page = readFileSync(resolve(root, 'src/pages/features/calendarbuilder/LiveView.tsx'), 'utf8')
  const screen = readFileSync(resolve(root, 'src/pages/features/calendarbuilder/calendarScreen.ts'), 'utf8')
  const card = readFileSync(resolve(root, 'src/pages/features/smartcomms/OpenShiftsCard.tsx'), 'utf8')
  const gridSrc = readFileSync(resolve(root, 'src/pages/features/shifts/HouseGrid.tsx'), 'utf8')
  const builder = readFileSync(resolve(root, 'src/pages/features/calendarbuilder/BuilderView.tsx'), 'utf8')
  it('never decides who edits from the role', () => {
    assert.doesNotMatch(page, /role === 'admin'|role === 'manager'/)
    assert.match(page, /grid\?\.access\?\.edit/)
  })
  it('House Calendars edits nothing any more — no drag, no cell door, and the editor is sent to the Builder', () => {
    assert.doesNotMatch(page, /canDrag|onDrop=/)
    assert.doesNotMatch(page, /housecal\/cell|housecal\/move/)
    assert.match(page, /Change in Builder/)
    // through the view switch, which spells the Builder's address with builderLink
    assert.match(page, /onView\('build', \{/)
    assert.match(screen, /: builderLink\(at\.house/)
  })
  it('the shared grid drags only where the Builder allows it, and never from or onto an OPEN row', () => {
    assert.match(gridSrc, /const draggable = canDrag && Boolean\(c\.text\) && !nobody/)
    assert.match(gridSrc, /if \(!dragFrom \|\| !canDrag \|\| nobody\) return/)
  })
  it('the Builder asks in the platform\'s own dialog before a replacing drop', () => {
    assert.match(builder, /<ConfirmDialog/)
    assert.match(builder, /move\(d\.from, d\.to, false, true\)/)
    for (const src of [page, builder]) assert.doesNotMatch(src, /window\.confirm|window\.alert|window\.prompt/)
  })
  it('the Desk\'s card counts days in Ohio, and its tail is a door, not a sentence', () => {
    assert.match(card, /ohioToday\(\)/)
    assert.doesNotMatch(card, /toISOString\(\)\.slice\(0, 10\)/)
    assert.match(card, /setShowAll\(true\)/)
  })
})

describe('time off on the calendars', () => {
  const offGrid = {
    location: LOC,
    cols: [{ iso: '2026-09-30', short: 'Wed 9/30' }, { iso: '2026-10-01', short: 'Thu 10/1' }],
    rows: [{ employee: 'Ann Roe', cells: [
      { text: '', time_off: { state: 'scheduled', ref: 'TO1A2B3C4D5E', until: '2026-10-01' } },
      { text: '8A-4P', time_off: { state: 'pending', ref: 'TO0000000002', until: '2026-10-01' } },
    ] }],
  } as unknown as Grid
  it('a scheduled day wears the hatch and TO, a pending one the corner flag, each titled with its request', () => {
    const html = renderToString(<MemoryRouter><HouseGrid grid={offGrid} clock={false} mode="operations" editor
      onOpen={noop} timeOff={timeOffMarksOf(offGrid, true)} /></MemoryRouter>)
    assert.match(html, />TO</)
    assert.ok(html.includes(TIME_OFF_FLAG), 'the corner flag')
    assert.match(html, /nobody can be put on a shift this day/)
    assert.match(html, /Time off asked \(TO0000000002\), waiting for approval/)
    assert.doesNotMatch(html, /outline-dashed|outline-violet-500/)
  })
  it('the cell panel says why no shift can be given, or warns that one was asked', () => {
    const hard = panel({ target: { employee: 'Ann Roe', colIso: '2026-09-30', label: 'Wed 9/30' }, openRow: false,
                         openShift: undefined, text: '',
                         timeOff: { state: 'scheduled', ref: 'TO1A2B3C4D5E', until: '2026-10-01' } })
    assert.match(hard, /On approved time off/)
    assert.match(hard, /no shift can be given to them this day/)
    const soft = panel({ target: { employee: 'Ann Roe', colIso: '2026-10-01', label: 'Thu 10/1' }, openRow: false,
                         openShift: undefined, text: '8A-4P',
                         timeOff: { state: 'pending', ref: 'TO0000000002', until: '2026-10-01' } })
    assert.match(soft, /Time off asked/)
    assert.match(soft, /a draft here is allowed/)
  })
})
