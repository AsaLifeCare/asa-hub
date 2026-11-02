/**
 * The one calendar screen, first half: the view carried by the page id, the switch that replaces the address,
 * the band, the rail, the range, the one colour language beside KIND_TINT, the Live view's safety (no draft
 * layer, a call-off never absorbs the Builder's picture), the panel in live mode and the outage fallback.
 * The relay half (test mode, the published mark, the draft pills) is tools/test-house-calendars.py.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import HouseGrid from '@/pages/features/shifts/HouseGrid'
import ShiftCellPanel from '@/pages/features/shifts/ShiftCellPanel'
import HandoffCard from '@/pages/features/shifts/HandoffCard'
import LastRosterWeek from '@/pages/features/shifts/LastRosterWeek'
import CalendarHero from '@/pages/features/calendarbuilder/CalendarHero'
import HouseRail from '@/pages/features/calendarbuilder/HouseRail'
import RangeBar from '@/pages/features/calendarbuilder/RangeBar'
import { LaneError } from '@/pages/features/shifts/laneFetch'
import { CELL_TINT, KIND_TINT, cellTint, workbookStripe } from '@/pages/features/shifts/shiftUi'
import { timeOffAt, useTimeOffMarks } from '@/pages/features/shifts/timeOffMarks'
import { callOffConfirmBody } from '@/pages/features/calendarbuilder/builderLogic'
import {
  BUILDER_PATH, HOUSE_CAL_PATH, builderLink, cellTitle, dropVerdict, houseCalLink, houseShort, notAPerson, resolveHouse,
  type CellFact, type Computed, type Grid, type House, type OpenShift,
} from '@/pages/features/shifts/houseCalTypes'
import {
  VIEW_PAGE, acrossHouses, builderSwitch, builderTiles, clampWeek, conflictCell, defaultHouse, drawnDays, houseToOpen,
  houseTint, isOutage, isRange, lastRosterNote, liveEditorTiles, liveStaffTiles, openCountByHouse, railSections,
  rangeLabel, shiftsDrawn, statesPresent, tabWeeks, testModeHolds, thisWeek, viewOfPage, viewPath, withoutAbsences,
} from '@/pages/features/calendarbuilder/calendarScreen'
import { DEFAULT_CALENDAR_RANGE, useUiPrefsStore } from '@/stores/useUiPrefsStore'

const root = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const noop = () => {}
/** the markup as a reader reads it: React's text-node separators dropped */
const draw = (el: Parameters<typeof renderToString>[0]): string => renderToString(el).replace(/<!-- -->/g, '')

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

const BM = 'CAN - BM - BM4060'
const B48 = 'CAN - 48TH (B) - ABD1711'
const JH = 'CAN - JH - ABD2704'
const SAT = '2026-09-19'
const ISOS = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
  '2026-09-26', '2026-09-27']
const WINDOW = { first: ISOS[0], last: ISOS[8], days: 9, covers_today: true, today: '2026-09-24' }

/* ── the view is the page id; the switch replaces the address ─────────── */

describe('one screen, two views, carried by the page ids that already exist', () => {
  it('House Calendars is Live and the Builder page is the Builder view; nothing else is', () => {
    assert.deepEqual(VIEW_PAGE, { live: 'house-cal', build: 'builder' })
    assert.equal(viewOfPage('house-cal'), 'live')
    assert.equal(viewOfPage('builder'), 'build')
    assert.equal(viewOfPage('calendar'), null)
  })
  it('both page ids draw the one screen', () => {
    const page = read('src/pages/features/calendarbuilder/CalendarBuilderPage.tsx')
    assert.match(page, /case 'builder':\s*return <HouseCalendarsScreen view="build" \/>/)
    assert.match(page, /case 'house-cal':\s*return <HouseCalendarsScreen view="live" \/>/)
  })
  it('the switch REPLACES the address, so Back leaves the screen instead of bouncing between views', () => {
    const screen = read('src/pages/features/calendarbuilder/HouseCalendarsScreen.tsx')
    assert.match(screen, /navigate\(viewPath\(to, at\), \{ replace: true \}\)/)
  })
  it('the switch carries the house, range, week and the open cell, in the links\' own spelling', () => {
    const cell = { employee: 'Ann Roe', colIso: '2026-09-24' }
    assert.equal(viewPath('build', { house: BM, cell }), builderLink(BM, { day: cell.colIso, employee: 'Ann Roe' }))
    assert.equal(viewPath('live', { house: BM, cell }), houseCalLink(BM, { open: 'Ann Roe|2026-09-24' }))
    assert.equal(viewPath('live', { house: BM, cell: { ...cell, employee: 'OPEN · call-off', ref: 'SP1' } }),
      houseCalLink(BM, { ref: 'SP1' }))
    assert.equal(viewPath('build', { house: BM, range: 'week', week: SAT }),
      `${BUILDER_PATH}?house=CAN%20-%20BM%20-%20BM4060&range=week&week=${SAT}`)
    assert.equal(viewPath('live', {}), HOUSE_CAL_PATH)
  })
  it('every link already sent keeps working: the paths and the relay\'s spellings are unchanged', () => {
    assert.equal(HOUSE_CAL_PATH, '/app/calendarbuilder/house-cal')
    assert.equal(BUILDER_PATH, '/app/calendarbuilder/builder')
    assert.match(read('server/shift_requests.py'), /^DEEP_LINK_PATH = "\/#\/app\/calendarbuilder\/house-cal"$/m)
    assert.match(read('server/web_notices.py'), /^HOUSE_CAL_HREF = "\/app\/calendarbuilder\/house-cal"$/m)
    assert.match(read('server/calendar_builder_houses.py'), /BUILDER_PATH = "\/app\/calendarbuilder\/builder"/)
    assert.match(read('server/snapshot_service.py'), /"reason": "moved_to_builder"/)
  })
})

describe('the Builder half of the switch', () => {
  const houses: House[] = [
    { location: BM, staff: 9, updated_at: '', may_edit: true, drafts: 3 },
    { location: JH, staff: 4, updated_at: '', may_edit: false },
  ]
  it('is drawn only for a reader the Builder page opens to, who builds a house here', () => {
    assert.equal(builderSwitch({ builderOpen: true, houses, current: BM }).shown, true)
    assert.equal(builderSwitch({ builderOpen: false, houses, current: BM }).shown, false, 'the page gate')
    assert.equal(builderSwitch({ builderOpen: true, houses: houses.map((h) => ({ ...h, may_edit: false })), current: BM }).shown,
      false, 'staff never see the switch')
  })
  it('on a house the reader does not build it is closed, and says why', () => {
    const sw = builderSwitch({ builderOpen: true, houses, current: JH })
    assert.equal(sw.enabled, false)
    assert.equal(sw.why, 'Not a house you build: you can operate it, not build it')
  })
  it('carries the house\'s draft count, never a guess', () => {
    assert.equal(builderSwitch({ builderOpen: true, houses, current: BM }).drafts, 3)
    assert.equal(builderSwitch({ builderOpen: true, houses: [{ ...houses[0], drafts: undefined }], current: BM }).drafts, null)
  })
})

/* ── the range ────────────────────────────────────────────────────────── */

describe('the range: a Saturday-start week inside the tab, or the whole tab', () => {
  it('lists the tab\'s Saturdays and Ohio\'s this week', () => {
    assert.deepEqual(tabWeeks(WINDOW), ['2026-09-19', '2026-09-26'])
    assert.equal(thisWeek(WINDOW), '2026-09-19')
    assert.equal(thisWeek({ ...WINDOW, covers_today: false }), null)
  })
  it('keeps a wanted week inside the tab, else this week, else the first', () => {
    const weeks = tabWeeks(WINDOW)
    assert.equal(clampWeek('2026-09-29', weeks, '2026-09-19'), '2026-09-26', 'a Tuesday maps to its Saturday')
    assert.equal(clampWeek('2031-01-04', weeks, '2026-09-19'), '2026-09-19')
    assert.equal(clampWeek('', weeks, null), '2026-09-19')
  })
  it('a week is seven days; the whole tab is the tab', () => {
    assert.deepEqual(drawnDays('week', SAT, WINDOW), { from: SAT, to: '2026-09-25', range: 'week' })
    assert.deepEqual(drawnDays('tab', SAT, WINDOW), { from: ISOS[0], to: ISOS[8], range: 'tab' })
    assert.equal(rangeLabel({ from: '2026-09-20', to: '2026-09-26' }), 'Sep 20 – Sep 26')
    assert.equal(isRange('week') && isRange('tab') && !isRange('month'), true)
  })
  it('Live opens on the week and the Builder on the whole tab, each remembered per person', () => {
    assert.deepEqual(DEFAULT_CALENDAR_RANGE, { live: 'week', build: 'tab' })
    assert.deepEqual(useUiPrefsStore.getState().calendarRange, { live: 'week', build: 'tab' })
    assert.equal(useUiPrefsStore.getState().calendarHouse, '')
    // per person: the bundle that rides prefsSync, never the workspace's
    assert.match(read('src/lib/prefsSync.ts'), /'asa-ui-prefs'/)
  })
})

/* ── the rail ─────────────────────────────────────────────────────────── */

describe('the rail', () => {
  const houses: House[] = [
    { location: 'CAN - MS - MS4060', staff: 9, updated_at: '', may_edit: false },
    { location: B48, staff: 7, updated_at: '', may_edit: true },
    { location: JH, staff: 4, updated_at: '', may_edit: true },
    { location: BM, staff: 8, updated_at: '' },
  ]
  it('your houses, then the others, each A–Z by the name people say', () => {
    const s = railSections(houses)
    assert.deepEqual(s.map((x) => x.title), ['Your houses', 'Other houses'])
    assert.deepEqual(s[0].houses.map((h) => houseShort(h.location)), ['48TH (B)', 'JH'])
    assert.deepEqual(s[1].houses.map((h) => houseShort(h.location)), ['BM', 'MS'])
  })
  it('a reader who builds none sees one list, "Houses"', () => {
    const s = railSections(houses.map((h) => ({ ...h, may_edit: false })))
    assert.deepEqual(s.map((x) => x.title), ['Houses'])
  })
  it('filters by name or code', () => {
    assert.deepEqual(railSections(houses, 'abd27').flatMap((x) => x.houses.map((h) => h.location)), [JH])
    assert.deepEqual(railSections(houses, '48th').flatMap((x) => x.houses.map((h) => h.location)), [B48])
  })
  it('opens on the house last opened, else the reader\'s first, else A–Z', () => {
    assert.equal(defaultHouse(houses, 'ABD2704'), JH)
    assert.equal(defaultHouse(houses, 'gone'), B48)
    assert.equal(defaultHouse(houses.filter((h) => h.location !== B48).map((h) => ({ ...h, may_edit: false })), ''), BM)
  })
  it('a house is found by its full name, its code, or its short name (the old board\'s key)', () => {
    assert.equal(resolveHouse(houses, B48), B48)
    assert.equal(resolveHouse(houses, 'abd1711'), B48)
    assert.equal(resolveHouse(houses, '48th (b)'), B48)
    assert.equal(resolveHouse(houses, 'nowhere'), '')
  })
  it('a house keeps its dot colour, and an open pill counts only what nobody has', () => {
    assert.equal(houseTint(B48), houseTint(B48))
    const shift = (over: Partial<OpenShift>) => ({ location: BM, claimed_by: null, started: false, ...over }) as OpenShift
    const m = openCountByHouse([shift({}), shift({ claimed_by: 'Ann' }), shift({ started: true }), shift({ location: JH })])
    assert.equal(m.get(BM), 1)
    assert.equal(m.get(JH), 1)
  })
  it('draws the red open pill and the amber draft pill; a read-only house says so', () => {
    const html = draw(
      <HouseRail sections={railSections(houses.map((h) => (h.location === B48 ? { ...h, drafts: 2 } : h)))}
        current={B48} onPick={noop} filter="" onFilter={noop} loading={false} failed=""
        openBy={new Map([[B48, 2]])} />)
    assert.match(html, /2 open/)
    assert.match(html, /2 draft/)
    assert.match(html, /read-only/)
    assert.match(html, /Filter houses by name or code…/)
  })
})

/* ── the one colour language, beside KIND_TINT ────────────────────────── */

describe('the cells\' one colour language', () => {
  it('KIND_TINT is untouched — Shift Cards, the timeline, My Week, the profile and invoices read it', () => {
    assert.deepEqual(KIND_TINT, {
      day: 'primary', afternoon: 'info', morning: 'amber', evening: 'lavender', overnight: 'pink',
      ro: 'danger', alias: 'slate', off: 'slate',
    })
  })
  it('the grids tint by kind: day blue, morning peach, afternoon mint, evening lavender, overnight pink', () => {
    assert.deepEqual(CELL_TINT, { day: 'blue', morning: 'peach', afternoon: 'mint', evening: 'lavender', overnight: 'pink' })
    assert.match(cellTint('day'), /bg-tint-blue/)
    assert.equal(cellTint('off'), 'text-text-3')
    assert.match(cellTint('ro'), /bg-surface-3/)
    assert.match(cellTint('alias'), /border/)
  })
  it('the workbook\'s own colour survives as a stripe; white and transparent are no colour', () => {
    assert.equal(workbookStripe('#FF9900'), '#ff9900')
    assert.equal(workbookStripe('#ffffff'), null)
    assert.equal(workbookStripe('transparent'), null)
    assert.equal(workbookStripe('url(x)'), null)
  })
})

const fact = (employee: string, iso: string, over: Partial<CellFact> = {}): CellFact => ({
  employee, col_iso: iso, raw: '8A-4P', kind: 'day', code: '8A-4P', start: 8, end: 16, token: null, hours: 8,
  overnight: false, edited: false, state: 'upcoming', ...over,
})

function house(over: Partial<Grid> = {}, computedOver: Partial<Computed> = {}): Grid {
  const texts = ISOS.map(() => '')
  const annCells = texts.map((_, i) => ({ text: i === 5 ? '8A-4P' : '' }))
  const benCells = texts.map((_, i) => ({ text: i === 5 ? '10P-8A' : i === 6 ? 'OFF' : i === 4 ? 'R/O' : '' }))
  const openCells = texts.map((_, i) => ({ text: i === 6 ? '3P-11P' : '' }))
  const computed: Computed = {
    cells: {
      [`Ann Roe|${ISOS[5]}`]: fact('Ann Roe', ISOS[5], { state: 'in_progress' }),
      [`Ben Left|${ISOS[5]}`]: fact('Ben Left', ISOS[5], { kind: 'overnight', code: '10P-8A', start: 22, end: 32, hours: 10 }),
      [`Ben Left|${ISOS[6]}`]: fact('Ben Left', ISOS[6], { kind: 'off', code: 'OFF', start: null, end: null, hours: 0 }),
      [`OPEN|${ISOS[6]}`]: fact('OPEN', ISOS[6], { code: '3P-11P', start: 15, end: 23, kind: 'afternoon' }),
    },
    people: [{ employee: 'Ann Roe', hours: 16, shifts: 2, off: 0, elsewhere: 0, by_week: { [SAT]: 8, '2026-09-26': 8 }, conflicts: [] }],
    days: ISOS.map((iso, i) => ({ col_iso: iso, working: i === 5 ? 2 : 0, off: 0, elsewhere: 0, hours: i === 5 ? 18 : 0, names: [] })),
    conflicts: [], open_shifts: [{
      key: `OPEN|${ISOS[6]}`, location: BM, open_row: 'OPEN', col_iso: ISOS[6], raw: '3P-11P', code: '3P-11P',
      start: 15, end: 23, hours: 8, kind: 'afternoon', overnight: false, claimed_by: null, claimed_via: null, claimed_at: null,
    }],
    window: WINDOW, weekly_ot_hours: 40, totals: { hours: 18, shifts: 2, people: 2, open: 1 },
    running: [`Ann Roe|${ISOS[5]}`],
    ...computedOver,
  }
  return {
    location: BM, cols: ISOS.map((iso) => ({ iso, label: iso.slice(5) })),
    rows: [
      { employee: 'Ann Roe', cells: annCells },
      { employee: 'Ben Left', cells: benCells },
      { employee: 'OPEN', open_row: true, cells: openCells },
    ],
    computed, ...over,
  }
}

const grid = (g: Grid, extra: Partial<Parameters<typeof HouseGrid>[0]> = {}) => draw(
  <HouseGrid grid={g} clock={false} mode="operations" editor={false} onOpen={noop} {...extra} />)

describe('the grid, drawn', () => {
  it('draws only the week asked for, and says which hours the column counts', () => {
    const html = grid(house(), { days: { from: SAT, to: '2026-09-25', range: 'week' } })
    assert.equal(html.match(/data-iso=/g)?.length, 7)
    assert.match(html, /Hrs \(week\)/)
    assert.match(grid(house()), /Hrs \(tab\)/)
    assert.equal(grid(house()).match(/data-iso=/g)?.length, 9)
  })
  it('tints by kind, OPEN in solid dark red, and rings the running shift green', () => {
    const html = grid(house())
    assert.match(html, /bg-tint-blue/)
    assert.match(html, /bg-tint-pink/)
    assert.match(html, /bg-\[#8b0000\] text-white/)
    assert.match(html, /data-marks="running"/)
    assert.match(html, /ring-success/)
  })
  it('AMBER MEANS ONE THING: a grid with no draft and nothing held carries no amber in any cell', () => {
    const html = grid(house({ handoffs: [{ id: 'H1', state: 'pending', col_iso: ISOS[5], from_staff: 'Ann Roe' } as never] },
      { conflicts: [{ key: `Ben Left|${ISOS[5]}`, employee: 'Ben Left', col_iso: ISOS[5], kind: 'two-houses', why: 'x' }] }))
    // the cells, not the avatars' own pastel tiles
    const cells = [...html.matchAll(/<button[^>]*class="([^"]*min-h-9[^"]*)"[^>]*>([\s\S]*?)<\/button>/g)]
      .map((m) => m[0])
    assert.equal(cells.length, 27)
    for (const cell of cells) assert.doesNotMatch(cell, /warning|amber/)
    assert.match(html, /data-marks="[^"]*transfer/)
    assert.match(html, /outline-danger/)
  })
  it('…and a draft or a held cell is the amber, dashed when test mode held it', () => {
    const drafted = house()
    drafted.rows[0].cells[5] = { text: '8A-2P', draft: { base: '8A-4P', note: '', by: 'Hana', at: '', ist: '' } }
    assert.match(grid(drafted, { mode: 'builder', editor: true }), /ring-warning/)
    const held = house()
    held.rows[1].cells[5] = { text: '10P-8A', test_mode: true, pending: true }
    assert.match(grid(held), /border border-dashed border-warning/)
  })
  it('the marks never hide each other: a held cell with a conflict keeps its dash, and the open cell its halo', () => {
    const held = house({}, { conflicts: [{ key: `Ben Left|${ISOS[5]}`, employee: 'Ben Left', col_iso: ISOS[5], kind: 'two-houses', why: 'x' }] })
    held.rows[1].cells[5] = { text: '10P-8A', test_mode: true }
    const html = grid(held, { selected: { employee: 'Ben Left', colIso: ISOS[5] } })
    const cell = /<button[^>]*data-marks="[^"]*test-mode[^"]*"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? ''
    assert.match(cell, /outline-danger/)
    assert.match(cell, /border-dashed border-warning/)
    assert.match(cell, /shadow-\[0_0_0_2px_var\(--primary\)\]/)
  })
  it('LIVE NEVER DRAWS A DRAFT: a drafted cell that reached the live grid reads as its base, with no draft mark', () => {
    const leaked = house()
    leaked.rows[0].cells[5] = { text: '8A-2P', draft: { base: '8A-4P', note: '', by: 'Hana', at: '', ist: '' } }
    const html = grid(leaked)
    assert.doesNotMatch(html, /8A-2P|ring-warning|data-marks="[^"]*draft/)
    assert.match(html, />8A-4P</)
    assert.ok(!statesPresent(leaked, 'live').includes('draft'))
    assert.match(grid(leaked, { mode: 'builder', editor: true }), /8A-2P/)
  })
  it('the Builder draws the transfers it read itself, and the Key keys them', () => {
    const h = [{ id: 'H1', state: 'pending', col_iso: ISOS[5], from_staff: 'Ann Roe' }] as never[]
    assert.match(grid(house(), { mode: 'builder', editor: true, handoffs: h }), /data-marks="[^"]*transfer/)
    assert.doesNotMatch(grid(house(), { mode: 'builder', editor: true }), /data-marks="[^"]*transfer/)
    assert.ok(statesPresent(house(), 'build', null, true, h).includes('transfer'))
  })
  it('keeps the workbook\'s colour as a stripe, says whose row is the reader\'s, and labels OPEN rows', () => {
    const coloured = house()
    coloured.rows[0].cells[5] = { text: '8A-4P', color: '#ffd966' }
    const html = grid(coloured, { me: 'ann roe' })
    assert.match(html, /title="Workbook colour"/)
    assert.match(html, />You</)
    assert.match(grid(house(), { mode: 'builder', editor: true }), /OPEN · row 1/)
  })
  it('time off: a hatch and TO for everybody, the asked flag only for the house\'s editors', () => {
    const marks = new Map([[`Ann Roe|${ISOS[3]}`, 'scheduled' as const], [`Ben Left|${ISOS[3]}`, 'asked' as const]])
    const staff = grid(house(), { timeOff: marks })
    assert.match(staff, /time-off-scheduled/)
    assert.match(staff, />TO</)
    assert.doesNotMatch(staff, /time-off-asked/)
    assert.match(grid(house(), { timeOff: marks, editor: true }), /time-off-asked/)
    // a shift still on scheduled time off is a conflict too
    assert.match(grid(house(), { timeOff: new Map([[`Ann Roe|${ISOS[5]}`, 'scheduled' as const]]) }),
      /data-marks="running conflict time-off-scheduled"/)
  })
  it('one title reader keeps every sentence word for word, and adds time off and a waiting transfer', () => {
    const base = { spelled: false, running: false, mode: 'operations' as const, editor: false, canDrag: false }
    assert.equal(cellTitle({ ...base, cell: { text: '8A-4P' } }), 'Click to open')
    assert.equal(cellTitle({ ...base, cell: { text: '8A-4P', pending: true } }),
      'Just published — the copy of the workbook catches up within half an hour')
    assert.equal(cellTitle({ ...base, cell: { text: '8A-4P', test_mode: true } }),
      'Recorded while test mode was on — test mode — not written to the workbook')
    assert.equal(cellTitle({ ...base, cell: { text: '8A-4P' }, timeOff: 'Time off, on the roster', transfer: true }),
      'Click to open · Time off, on the roster · A transfer is waiting on this shift')
  })
})

/* ── the band ─────────────────────────────────────────────────────────── */

describe('the band\'s tiles', () => {
  const dl = (iso: string) => iso.slice(5)
  it('an editor sees open shifts, decisions, call-offs, who is on now, transfers and what to look at', () => {
    const tiles = liveEditorTiles({ computed: house().computed!, nowMs: 0, transfers: 2, across: null, dayLabel: dl })
    assert.deepEqual(tiles.map((t) => [t.id, t.value]),
      [['open', '1'], ['decisions', '0'], ['calloffs', '0'], ['onshift', '1'], ['transfers', '2'], ['look', '0']])
    assert.equal(tiles[3].title, 'Ann Roe')
  })
  it('a figure the relay did not answer is "—", never 0', () => {
    const tiles = liveEditorTiles({ computed: null, nowMs: 0, transfers: null, across: null, dayLabel: dl })
    assert.ok(tiles.every((t) => t.value === '—'), tiles.map((t) => t.value).join(','))
    assert.ok(liveStaffTiles({ computed: null, me: 'Ann Roe', transfers: null, dayLabel: dl }).every((t) => t.value === '—'))
  })
  it('a decision is a closed window with somebody applied and nobody given', () => {
    const c = house().computed!
    c.open_shifts = [{ ...c.open_shifts[0], pool_state: 'closed', applicants: 2 }]
    const tiles = liveEditorTiles({ computed: c, nowMs: 0, transfers: 0, across: null, dayLabel: dl })
    assert.equal(tiles.find((t) => t.id === 'decisions')?.value, '1')
    assert.match(tiles.find((t) => t.id === 'decisions')?.sub ?? '', /2 applied/)
  })
  it('"across your houses" only for a reader who edits two or more', () => {
    const shifts = [{ location: BM, claimed_by: null, started: false, col_iso: ISOS[6] },
      { location: JH, claimed_by: null, started: false, col_iso: ISOS[7] }] as OpenShift[]
    const one: House[] = [{ location: BM, staff: 1, updated_at: '', may_edit: true }]
    assert.equal(acrossHouses(shifts, one), null)
    const two = [...one, { location: JH, staff: 1, updated_at: '', may_edit: true }]
    assert.equal(acrossHouses(shifts, two)?.open.length, 2)
    const tiles = liveEditorTiles({ computed: house().computed!, nowMs: 0, transfers: 0, across: acrossHouses(shifts, two), dayLabel: dl })
    assert.equal(tiles[0].sub2, '2 across your houses')
  })
  it('a member of staff sees what is open to them, their applications, their week here and transfers', () => {
    const c = house().computed!
    c.open_shifts = [{ ...c.open_shifts[0], mine: { may: true, code: 'ok', why: '' } }]
    const tiles = liveStaffTiles({ computed: c, me: 'Ann Roe', transfers: 0, dayLabel: dl })
    assert.deepEqual(tiles.map((t) => [t.id, t.value]),
      [['mine-open', '1'], ['mine-applied', '0'], ['mine-hours', '8h'], ['transfers', '0']])
  })
  it('the Builder\'s band counts drafts outside the days drawn, and never reads an unread total as none', () => {
    const b = house({
      drafts: [{ employee: 'Ann Roe', col_iso: ISOS[8], value: '8A-4P', base: '', note: '', by: '', at: '', ist: 'no IST' }],
      draft_count: 1, estate_readable: false, held_readable: false,
    })
    const tiles = builderTiles(b, { from: SAT, to: '2026-09-25' })
    assert.equal(tiles.find((t) => t.id === 'drafts')?.sub, '1 outside the days drawn')
    assert.equal(tiles.find((t) => t.id === 'trainings')?.value, '1')
    assert.equal(tiles.find((t) => t.id === 'over40')?.value, '—')
    assert.equal(tiles.find((t) => t.id === 'held')?.sub, 'could not be read')
  })
  it('the footer\'s shift count is the relay\'s per-day count, over the days drawn', () => {
    assert.equal(shiftsDrawn(house().computed, { from: SAT, to: '2026-09-25' }), 2)
    assert.equal(shiftsDrawn(null, undefined), null)
  })
})

describe('the band, drawn', () => {
  const sw = { shown: true, enabled: true, why: '', drafts: 3 }
  const band = (over: Partial<Parameters<typeof CalendarHero>[0]> = {}) => draw(
    <CalendarHero view="live" house={B48} managerText="Jane Doe" access={{ edit: true, why: 'you manage it' }}
      switcher={sw} onView={noop} tiles={[]} onTile={noop} strip={{ heard: true, readAt: '', testMode: null }} {...over} />)
  it('Live: the eyebrow, the house by its short name and code, who manages it and whether it is yours', () => {
    const html = band()
    assert.match(html, /Live · the roster as it is now/)
    assert.doesNotMatch(html, /House Calendars/)
    assert.match(html, /48TH \(B\)/)
    assert.match(html, /ABD1711/)
    assert.match(html, /House manager: Jane Doe/)
    assert.match(html, /You edit this calendar/)
    assert.match(html, /Following changes live/)
  })
  it('the switch shows Live pressed and the Builder with its drafts; a staff reader gets no switch', () => {
    const html = band()
    assert.match(html, /aria-pressed="true"[^>]*>.*Live/)
    assert.match(html, /3 drafts/)
    assert.doesNotMatch(band({ switcher: { ...sw, shown: false } }), /role="group" aria-label="View"/)
  })
  it('the Builder\'s eyebrow says nobody sees the changes until published', () => {
    assert.match(band({ view: 'build' }), /Builder · draft of 48TH \(B\): nobody sees these changes until you publish/)
  })
  it('the strip: test mode held, the drafts not on the calendar (Live), the transfers waiting (Builder)', () => {
    assert.match(band({ strip: { heard: false, readAt: '', testMode: 'on', draftsHere: 3 } }), /TEST MODE: roster writes are held/)
    assert.match(band({ strip: { heard: false, readAt: '', testMode: 'unreadable', draftsHere: 3 } }), /3 draft edits here are NOT on the calendar/)
    assert.match(band({ strip: { heard: false, readAt: '', testMode: null } }), /Not hearing live changes right now/)
    assert.match(band({ view: 'build', strip: { heard: true, readAt: '', testMode: null, transfersWaiting: 2 } }),
      /2 transfers need your answer/)
  })
  it('test mode is said when on, and when it cannot be read (which holds too)', () => {
    assert.equal(testModeHolds(house({ test_mode: { on: true, readable: true, why: '' } })), 'on')
    assert.equal(testModeHolds(house({ test_mode: { on: true, readable: false, why: 'x' } })), 'unreadable')
    assert.equal(testModeHolds(house({ test_mode: { on: false, readable: true, why: '' } })), null)
  })
})

describe('the range bar and its Key', () => {
  it('This week is closed when the tab does not draw today; the range is a pressed pair', () => {
    const html = draw(<RangeBar days={{ from: SAT, to: '2026-09-25', range: 'week' }} weeks={[SAT]} week={SAT}
      range="week" thisWeek={null} onWeek={noop} onRange={noop} time={<span>TIME</span>} present={[]} />)
    assert.match(html, /disabled=""[^>]*>This week/)
    assert.match(html, /aria-pressed="true"[^>]*>Week/)
    assert.match(html, /TIME/)
    assert.match(html, /Sep 19 – Sep 25/)
  })
  it('the Key lists the states present; the Builder always keys its draft, asked time off only for editors', () => {
    assert.ok(statesPresent(house(), 'live').includes('open'))
    assert.ok(statesPresent(house(), 'live').includes('running'))
    assert.ok(!statesPresent(house(), 'live').includes('draft'))
    assert.ok(statesPresent(house(), 'build', null, true).includes('draft'))
    const asked = new Map([['Ann Roe|x', 'asked' as const]])
    assert.ok(!statesPresent(house(), 'live', asked, false).includes('time-off-asked'))
    assert.ok(statesPresent(house(), 'live', asked, true).includes('time-off-asked'))
  })
})

/* ── the panel in live mode ───────────────────────────────────────────── */

describe('the panel, live', () => {
  const computed = house().computed!
  const panel = (over: Partial<Parameters<typeof ShiftCellPanel>[0]> = {}) => draw(
    <ShiftCellPanel target={{ employee: 'Ben Left', colIso: ISOS[5], label: 'Thu 9/24' }} house={BM} text="10P-8A"
      fact={computed.cells[`Ben Left|${ISOS[5]}`]} computed={computed} saving={false} staff={['Ann Roe', 'Ben Left']}
      mayEdit openRow={false} me="Hana Boss" onClaim={noop} onOpenRequests={noop} onClose={noop} {...over} />)
  it('says it is live, with the green edge; the Builder\'s says draft, amber', () => {
    assert.match(panel(), /Shift · live/)
    assert.match(panel(), /border-t-success/)
    const draft = panel({ mode: 'builder', editor: <p>EDITOR</p> })
    assert.match(draft, /Shift · draft/)
    assert.match(draft, /border-t-warning/)
  })
  it('says how the cell got here, or that it cannot be known right now', () => {
    const mark = { at: '2026-09-24T13:00:00Z', by: 'Hana Boss', via: 'publish', state: 'confirmed' }
    const html = panel({ published: mark })
    assert.match(html, /How it got here/)
    assert.match(html, /Published on Calendar Builder at/)
    assert.match(panel({ publishedWhy: 'the marks could not be read' }), /not known right now: the marks could not be read/)
  })
  it('an editor may Mark call-off here, in its own "Live now" box, apart from anything drafted', () => {
    const html = panel({ onCallOff: noop })
    assert.match(html, /aria-label="Live now"/)
    assert.match(html, /A call-off is not a draft: it happens the moment you confirm/)
    assert.match(html, /Mark call-off/)
    assert.match(html, /LIVE: happens now/)
  })
  it('never for a reader who does not edit the house, an open row, a past shift or a drafted cell in the Builder', () => {
    assert.doesNotMatch(panel({ onCallOff: noop, mayEdit: false }), /Mark call-off/)
    assert.doesNotMatch(panel({ onCallOff: noop, openRow: true }), /Mark call-off/)
    assert.doesNotMatch(panel({ onCallOff: noop, fact: { ...computed.cells[`Ben Left|${ISOS[5]}`], state: 'past' } }), /Mark call-off/)
    assert.doesNotMatch(panel({ onCallOff: noop, mode: 'builder', editor: <p>EDITOR</p>, drafted: true }), /aria-label="Live now"/)
    assert.doesNotMatch(panel(), /Mark call-off/, 'no door handed in, no button')
  })
  it('in the Builder panel the same box sits below the draft\'s editor, with the same door and words', () => {
    const html = panel({ onCallOff: noop, mode: 'builder', editor: <p>EDITOR</p> })
    assert.ok(html.indexOf('EDITOR') < html.indexOf('aria-label="Live now"'))
    assert.match(html, /LIVE: happens now/)
  })
  it('a cell with a draft on it says so, and offers the Builder on that cell', () => {
    const html = panel({ onCallOff: noop, onEditInBuilder: noop,
                         callOffSaid: { code: 'draft_pending', why: 'this cell has a draft on it' } })
    assert.match(html, /This cell has a draft in the Builder: publish or discard it first/)
    assert.match(html, /Open it in Builder/)
  })
  it('the confirm names every effect, and the mock outbox when test mode holds', () => {
    const body = callOffConfirmBody('Ben Left', '10P-8A')
    for (const effect of ['URGENT OPEN SHIFT to all staff with no reason', 'Call Off Tracker row',
      'attendance check stand down', "directors' group", 'five hours']) {
      assert.ok(body.includes(effect), effect)
    }
    assert.match(body, /While test mode is on, every one of those goes to the mock outbox instead\.$/)
    assert.match(callOffConfirmBody('Ben Left', '10P-8A', true), /Test mode is on, so every one of those goes to the mock outbox instead\.$/)
    // one wording, one box: both views' panels confirm through the same LiveNowBox, the editor has none
    assert.match(read('src/pages/features/shifts/ShiftCellPanel.tsx'), /body=\{callOffConfirmBody\(employee, text, testMode\)\}/)
    assert.doesNotMatch(read('src/pages/features/shifts/ShiftEditor.tsx'), /callOffConfirmBody|onCallOff/)
  })
})

/* ── Live's safety: no draft layer, ever ──────────────────────────────── */

describe('Live never draws a draft', () => {
  const live = read('src/pages/features/calendarbuilder/LiveView.tsx')
  it('reads its grid only from the live door, never the Builder\'s draft door', () => {
    assert.match(live, /lane<Grid>\(`\/erp-lanes\/housecal\/\$\{encodeURIComponent\(location\)\}`\)/)
    assert.doesNotMatch(live, /houseLane\.grid\(|calendar-builder\/house\?/)
  })
  it('a call-off from Live never paints the answer\'s grid (the Builder\'s draft picture); it re-reads its own door', () => {
    const body = live.slice(live.indexOf('const markCallOff'), live.indexOf('if (refused)'))
    assert.match(body, /houseLane\.callOff\(location, at\.employee, at\.colIso, note\)/)
    assert.doesNotMatch(body, /absorb\(|setGrid\(/)
    assert.match(body, /refresh\(location\)/)
  })
  it('test mode is said on Live too, before a Give is pressed', () => {
    assert.match(live, /a Give or a\s+finished transfer is recorded on the platform, not in the workbook/)
    assert.match(read('src/pages/features/shifts/houseCalTypes.ts'), /Whether test mode holds roster writes now \(unreadable holds\); both doors say it/)
  })
  it('no browser dialog anywhere on the new screen', () => {
    for (const p of ['LiveView.tsx', 'HouseCalendarsScreen.tsx', 'CalendarHero.tsx', 'HouseRail.tsx', 'RangeBar.tsx']) {
      assert.doesNotMatch(read(`src/pages/features/calendarbuilder/${p}`), /window\.(confirm|alert|prompt)/, p)
    }
  })
  it('transfers are info blue on the calendar screen — amber is kept for what is not in the workbook', () => {
    assert.doesNotMatch(read('src/pages/features/shifts/HandoffWaiting.tsx'), /amber/)
    const h = { id: 'H1', state: 'pending', col_iso: ISOS[5], from_staff: 'Ann Roe', to_staff: 'Ben Left',
                value: '8A-4P', house: '48TH (B)' } as never
    const info = draw(<HandoffCard h={h} busy={false} onAnswer={noop} onWithdraw={noop} tone="info" />)
    assert.match(info, /border-info bg-tint-info/)
    assert.doesNotMatch(info, /amber/)
    for (const p of ['shifts/HandoffWaiting.tsx', 'shifts/ShiftCellPanel.tsx']) {
      assert.match(read(`src/pages/features/${p}`), /<HandoffCard[^>]*tone="info"/, p)
    }
  })
  it('the Requests page keeps its amber transfer cards, unchanged', () => {
    const h = { id: 'H1', state: 'pending', col_iso: ISOS[5], from_staff: 'Ann Roe', to_staff: 'Ben Left',
                value: '8A-4P', house: '48TH (B)' } as never
    assert.match(draw(<HandoffCard h={h} busy={false} onAnswer={noop} onWithdraw={noop} />),
      /rounded-lg border-2 p-3 border-amber-500 bg-amber-500\/\[0\.05\]/)
    assert.doesNotMatch(read('src/pages/features/shifts/ShiftRequestsPage.tsx'), /<HandoffCard[^>]*tone=/)
  })
  it('no class the stylesheet cannot build: no opacity modifier on a CSS-variable colour in the new screen', () => {
    const tokens = 'info|warning|success|danger|primary|text-[123]|surface(?:-[23])?|border'
    const dead = new RegExp(`\\b(?:bg|border|text|ring|outline|from|to)-(?:${tokens})/(?:\\d|\\[)`)
    for (const p of ['calendarbuilder/LiveView.tsx', 'calendarbuilder/BuilderView.tsx', 'calendarbuilder/CalendarHero.tsx',
      'calendarbuilder/HouseRail.tsx', 'calendarbuilder/RangeBar.tsx', 'calendarbuilder/DayAgenda.tsx',
      'calendarbuilder/MasterGrid.tsx', 'calendarbuilder/PublishHouseReview.tsx', 'shifts/HouseGrid.tsx',
      'shifts/HandoffCard.tsx', 'shifts/HandoffWaiting.tsx', 'shifts/LastRosterWeek.tsx', 'shifts/shiftUi.ts']) {
      const hit = dead.exec(read(`src/pages/features/${p}`))
      assert.equal(hit, null, `${p}: ${hit?.[0]}`)
    }
  })
})

/* ── the outage fallback ──────────────────────────────────────────────── */

describe('when the live calendar does not answer', () => {
  it('a 5xx or no answer at all falls back to the last roster; a refusal or "no such house" never does', () => {
    assert.equal(isOutage(new LaneError('the relay answered 502', 502, '', {})), true)
    assert.equal(isOutage(new TypeError('Failed to fetch')), true)
    assert.equal(isOutage(new LaneError('not yours', 403, '', {})), false)
    assert.equal(isOutage(new LaneError('no calendar for that house', 404, '', {})), false)
    const live = read('src/pages/features/calendarbuilder/LiveView.tsx')
    assert.match(live, /gridFailed\?\.outage \? \(\s*<LastRosterWeek location=\{current\} why=\{gridFailed\.why\} seesCallers=\{Boolean\(here\?\.may_edit\)\}/)
  })
  it('with the rail down too, the house last opened still opens (and so falls back); with none, the slices\' own houses', () => {
    const houses: House[] = [{ location: BM, staff: 1, updated_at: '', may_edit: true }]
    assert.equal(houseToOpen(null, true, B48), B48)
    assert.equal(houseToOpen(null, false, B48), '', 'the rail is still being read')
    assert.equal(houseToOpen(null, true, ''), '')
    assert.equal(houseToOpen(houses, false, ''), BM)
    const live = read('src/pages/features/calendarbuilder/LiveView.tsx')
    assert.match(live, /const loc = houseToOpen\(houses, Boolean\(failed\), remembered\)/)
    assert.match(live, /!current && railDown \? \(\s*(?:\/\/[^\n]*\n\s*)?<LastRosterWeek location="" why=\{failed\} onPick=\{pickHouse\} \/>/)
  })
  it('a good quiet re-read lifts the last roster, and an answer for another house is never drawn under this one', () => {
    const live = read('src/pages/features/calendarbuilder/LiveView.tsx')
    const body = live.slice(live.indexOf('const refresh = useCallback'), live.indexOf('/** Refresh: the rail'))
    assert.match(body, /if \(asked\.current !== location\) return\s*setGrid\(g\)\s*setGridFailed\(null\)/)
    const open = live.slice(live.indexOf('const openHouse = useCallback'), live.indexOf('/** the quiet re-read'))
    assert.match(open, /setGrid\(null\)\s*setReadAt\(''\)/)
    assert.equal(open.match(/if \(asked\.current !== location\) return/g)?.length, 2)
    const builder = read('src/pages/features/calendarbuilder/BuilderView.tsx')
    assert.match(builder.slice(builder.indexOf('const openHouse = useCallback'), builder.indexOf('const openMaster')),
      /setGrid\(null\)\s*setReadAt\(''\)/)
  })
  it('the outage fallback keeps the privacy cut: no call-off or no-show marks for a reader who is not told callers', () => {
    const cells = [{ code: '8A-4P' }, { code: 'C/O' }, { code: ' ncns ' }, { code: 'R/O' }]
    assert.deepEqual(withoutAbsences(cells, false).map((c) => c.code), ['8A-4P', 'R/O'])
    assert.equal(withoutAbsences(cells, true).length, 4)
    const live = read('src/pages/features/calendarbuilder/LiveView.tsx')
    assert.match(read('src/pages/features/shifts/LastRosterWeek.tsx'), /seesCallers = false/)
    assert.match(live, /seesCallers=\{Boolean\(here\?\.may_edit\)\}/)
  })
  it('says what it is and what is not on it, and when only the floor answered', () => {
    const note = lastRosterNote('the relay answered 502', 'Sep 24, 10:05 AM', false)
    assert.match(note, /^The live calendar did not answer \(the relay answered 502\)\. This is the last roster the platform built \(Sep 24, 10:05 AM\)/)
    assert.match(note, /open shifts, call-offs, hours and transfers are not on it\. Nothing can be given or applied for from it\.$/)
    assert.match(lastRosterNote('x', '', true), /Serving the last roster we hold\.$/)
  })
  it('draws the note while it reads, and a failed read is "The roster did not load", never an empty week', () => {
    assert.match(draw(<LastRosterWeek location={BM} why="the relay answered 502" />),
      /The live calendar did not answer \(the relay answered 502\)/)
    assert.match(read('src/pages/features/shifts/LastRosterWeek.tsx'), /The roster did not load/)
  })
})

/* ── what the review found, held ─────────────────────────────────────── */

describe('the band never mixes two houses, and never says a guess', () => {
  const sw = { shown: true, enabled: true, why: '', drafts: null }
  const band = (over: Partial<Parameters<typeof CalendarHero>[0]> = {}) => draw(
    <CalendarHero view="live" house={B48} managerText="" access={null} switcher={sw} onView={noop} tiles={[]}
      onTile={noop} strip={{ heard: true, readAt: '', testMode: null }} {...over} />)
  it('while a house is read, the band names it and says nothing about its manager or access', () => {
    const html = band()
    assert.match(html, /48TH \(B\)/)
    assert.doesNotMatch(html, /House manager|Read-only|You edit/)
  })
  it('the relay\'s reasons are words on the band, not a hover: why nobody is named, why read-only', () => {
    const html = band({ managerText: 'the ** row names nobody for 48TH (B)', access: { edit: false, why: 'you do not manage 48TH (B)' } })
    assert.match(html, /House manager: the \*\* row names nobody for 48TH \(B\)/)
    assert.match(html, /Read-only/)
    assert.match(html, /<p[^>]*>you do not manage 48TH \(B\)<\/p>/)
  })
  it('drafts that could not be counted are said on the switch and the strip, never drawn as none', () => {
    const houses: House[] = [{ location: B48, staff: 7, updated_at: '', may_edit: true }]
    const s = builderSwitch({ builderOpen: true, houses, current: B48, draftsReadable: false })
    assert.equal(s.draftsUnread, true)
    assert.equal(builderSwitch({ builderOpen: true, houses, current: B48 }).draftsUnread, false)
    const html = band({ switcher: s, strip: { heard: true, readAt: '', testMode: null, draftsHere: 'unread' } })
    assert.match(html, /drafts —/)
    assert.match(html, /The drafts here could not be counted; this is not saying there are none/)
    const rail = draw(<HouseRail sections={railSections(houses)} current={B48} onPick={noop} filter="" onFilter={noop}
      loading={false} failed="" draftsUnread />)
    assert.match(rail, /drafts —/)
  })
  it('the Builder\'s strip says transfers that could not be read, and says nothing before they are read', () => {
    const b = (t: number | null | undefined) => band({ view: 'build', strip: { heard: true, readAt: '', testMode: null, transfersWaiting: t } })
    assert.match(b(null), /The transfers could not be read; this is not saying none wait/)
    assert.doesNotMatch(b(undefined), /transfers could not be read/)
  })
  it('the countdown ticks in the band: the tiles are a function of the band\'s own clock', () => {
    const html = band({ nowMs: 5, tiles: (now: number) => [{ id: 'x', label: 'Clock', value: String(now), sub: '' }] })
    assert.match(html, />5</)
    const live = read('src/pages/features/calendarbuilder/LiveView.tsx')
    assert.doesNotMatch(live, /setNowMs|setInterval/)
    assert.match(live, /tiles=\{tilesAt\}\s*ticking=\{ticking\}/)
    assert.match(live, /const days = useMemo\(\(\) => drawnDays\(range, week, win\), \[range, week, win\]\)/)
    const builder = read('src/pages/features/calendarbuilder/BuilderView.tsx')
    assert.match(builder, /const fold = useMemo\(/)
    assert.match(builder, /if \(!target\) return\s*const first = window\.setTimeout\(\(\) => setNowMs/)
  })
})

describe('the tiles', () => {
  const dl = (iso: string) => iso.slice(5)
  const overWeek = { key: `Ann Roe|${SAT}`, employee: 'Ann Roe', col_iso: '', kind: 'over-week', why: '44 h in 2026-09-19' }
  it('a week over the line is "To look at" too, in red; it opens that person\'s first shift of the week', () => {
    const c = house({}, { conflicts: [overWeek] }).computed!
    const live = liveEditorTiles({ computed: c, nowMs: 0, transfers: 0, across: null, dayLabel: dl })
    const look = live.find((t) => t.id === 'look')!
    assert.equal(look.value, '1')
    assert.equal(look.tone, 'bad')
    assert.equal(builderTiles(house({}, { conflicts: [overWeek] }), null).find((t) => t.id === 'look')?.value, '1')
    assert.deepEqual(conflictCell(overWeek, c), { employee: 'Ann Roe', colIso: ISOS[5] })
    assert.deepEqual(conflictCell({ ...overWeek, key: 'Ann Roe|2031-01-04' }, c), { employee: 'Ann Roe', colIso: '2031-01-04' })
  })
  it('transfers not read yet are "not read yet"; unreadable ones "could not be read"; neither is 0', () => {
    const t = (n: number | null | undefined) => liveStaffTiles({ computed: null, me: '', transfers: n, dayLabel: dl })
      .find((x) => x.id === 'transfers')!
    assert.deepEqual([t(undefined).value, t(undefined).sub], ['—', 'not read yet'])
    assert.deepEqual([t(null).value, t(null).sub], ['—', 'could not be read'])
    assert.deepEqual([t(2).value, t(2).sub], ['2', 'waiting on your answer'])
  })
  it('amber is not a conflict or an hours line: those tiles are red', () => {
    const b = house({ estate_weeks: { 'Ann Roe': { [SAT]: 44 } }, estate_readable: true })
    assert.equal(builderTiles(b, null).find((t) => t.id === 'over40')?.tone, 'bad')
  })
})

describe('the range bar and the Key', () => {
  const bar = (over: Partial<Parameters<typeof RangeBar>[0]> = {}) => draw(
    <RangeBar days={{ from: SAT, to: ISOS[8], range: 'tab' }} weeks={[SAT]} week={SAT} range="tab" thisWeek={SAT}
      onWeek={noop} onRange={noop} time={<span />} present={[]} {...over} />)
  it('on the whole tab, Today brings today into view and keeps the range; on a week it is This week', () => {
    assert.match(bar({ onToday: noop }), />Today</)
    assert.doesNotMatch(bar({ onToday: noop }), />This week</)
    assert.match(bar({ range: 'week', onToday: noop }), />This week</)
    assert.match(bar(), />This week</)
  })
  it('keys the workbook\'s colour, and draws the just-published dot', () => {
    const coloured = house()
    coloured.rows[0].cells[5] = { text: '8A-4P', color: '#ffd966' }
    assert.ok(statesPresent(coloured, 'live').includes('workbook-colour'))
    assert.ok(!statesPresent(house(), 'live').includes('workbook-colour'))
    const bar = read('src/pages/features/calendarbuilder/RangeBar.tsx')
    assert.match(bar, /id: 'workbook-colour', label: 'Workbook colour/)
    assert.match(bar, /id: 'pending', label: 'Just published \(dot\)', swatch: 'bg-surface border border-border', inner: 'dot'/)
  })
})

describe('Mark call-off, only where a call-off means something', () => {
  const computed = house().computed!
  const panel = (over: Partial<Parameters<typeof ShiftCellPanel>[0]> = {}) => draw(
    <ShiftCellPanel target={{ employee: 'Ben Left', colIso: ISOS[5], label: 'Thu 9/24' }} house={BM} text="10P-8A"
      fact={computed.cells[`Ben Left|${ISOS[5]}`]} computed={computed} saving={false} staff={['Ann Roe', 'Ben Left']}
      mayEdit openRow={false} me="Hana Boss" onClaim={noop} onOpenRequests={noop} onClose={noop} onCallOff={noop} {...over} />)
  const pending = { id: 'H1', state: 'pending', col_iso: ISOS[5], from_staff: 'Ben Left', to_staff: 'Ann Roe',
                    value: '10P-8A', house: 'BM' } as never
  it('never on a WORKSHOP row, which is nobody', () => {
    const fact = { ...computed.cells[`Ben Left|${ISOS[5]}`], employee: 'WORKSHOP (JH)' }
    assert.doesNotMatch(panel({ target: { employee: 'WORKSHOP (JH)', colIso: ISOS[5], label: 'Thu' }, fact }), /aria-label="Live now"/)
    assert.equal(notAPerson('WORKSHOP (JH)'), true)
    assert.equal(notAPerson('Ann Roe', 'CAN - WORKSHOP - W1'), true)
    assert.equal(notAPerson('OPEN 2'), true)
    assert.equal(notAPerson('Ann Roe', BM), false)
  })
  it('never on a shift with a transfer waiting, in either view', () => {
    assert.doesNotMatch(panel({ handoffs: [pending] }), /aria-label="Live now"/)
    assert.doesNotMatch(panel({ mode: 'builder', editor: <p>EDITOR</p>, transferWaiting: pending }), /aria-label="Live now"/)
    assert.match(panel(), /aria-label="Live now"/)
  })
  it('the box says who the URGENT reaches, as its confirm does: all staff', () => {
    const html = panel()
    assert.match(html, /sends the URGENT OPEN\s+SHIFT to all staff/)
    assert.doesNotMatch(html, /house&#x27;s staff|house's staff/)
  })
  it('an unreadable test mode is never promised as the mock outbox', () => {
    const body = callOffConfirmBody('Ben Left', '10P-8A', 'unreadable')
    assert.doesNotMatch(body, /goes to the mock outbox/)
    assert.match(body, /could not be read just now, so count on these going out for real/)
    assert.match(callOffConfirmBody('Ben Left', '10P-8A', 'on'), /Test mode is on, so every one of those goes to the mock outbox instead\.$/)
    for (const p of ['LiveView.tsx', 'BuilderView.tsx']) {
      const src = read(`src/pages/features/calendarbuilder/${p}`)
      assert.match(src, /testMode=\{held\}/, p)
      assert.doesNotMatch(src, /testMode=\{held !== null\}/, p)
    }
  })
})

describe('a waiting transfer, in the Builder', () => {
  it('a drag never moves a shift with a transfer waiting, nor lands on one', () => {
    const base = { mayEdit: true, sameCell: false, fromOpenRow: false, toOpenRow: false, moving: '8A-4P', landing: '', swap: false }
    assert.deepEqual(dropVerdict({ ...base, transferWaiting: true }),
      { kind: 'refuse', why: 'A transfer is waiting on this shift: answer it or withdraw it in Live first.' })
    assert.deepEqual(dropVerdict(base), { kind: 'move' })
  })
})

describe('time off for the Time Off feed', () => {
  it('the hook is asked per reader, and an asked day is never shown to a reader who does not edit', () => {
    assert.equal(useTimeOffMarks.length, 2)
    const marks = new Map([['a|1', 'asked' as const], ['b|1', 'scheduled' as const]])
    assert.equal(timeOffAt(marks, 'a|1', false), null)
    assert.equal(timeOffAt(marks, 'a|1', true), 'asked')
    assert.equal(timeOffAt(marks, 'b|1', false), 'scheduled')
  })
})

describe('the prefs push only a change', () => {
  it('opening the house already remembered, or the range already chosen, writes nothing', () => {
    const s = useUiPrefsStore.getState()
    s.setCalendarHouse(s.calendarHouse)
    s.setCalendarRange('live', s.calendarRange.live)
    assert.equal(useUiPrefsStore.getState(), s)
  })
})
