/**
 * The one calendar screen, second half: the Builder view inside the shell (the amber frame and DRAFT bar, the
 * folded past, the struck base, the Publish review, the "All houses · master grid" rail entry, the Live-now box
 * and the transfer guard), the old addresses and the retired board, a phone (the day agenda, the bottom sheet,
 * the sticky Publish bar), and the names' drag choice carried from the Shift Board. The first half is
 * one-calendar-screen.test.tsx.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import HouseGrid from '@/pages/features/shifts/HouseGrid'
import CalendarHero from '@/pages/features/calendarbuilder/CalendarHero'
import HouseRail from '@/pages/features/calendarbuilder/HouseRail'
import RangeBar from '@/pages/features/calendarbuilder/RangeBar'
import DayAgenda from '@/pages/features/calendarbuilder/DayAgenda'
import PublishHouseReview from '@/pages/features/calendarbuilder/PublishHouseReview'
import { publishSummary } from '@/pages/features/calendarbuilder/builderLogic'
import { dragFocusOf } from '@/lib/dragFocus'
import { SHIFT_BOARD_MOVED_TO } from '@/registry/apps-shifts'
import { calendarPage } from '@/registry/apps-calendarbuilder'
import {
  HOUSE_CAL_PATH, houseCalLink,
  type Cell, type CellFact, type Computed, type DraftEntry, type Grid, type House, type OpenShift,
} from '@/pages/features/shifts/houseCalTypes'
import {
  MASTER_HOUSE, agendaDayOf, agendaOf, builderRailSections, foldPast, liveForBuilderLink, masterTiles, movedAddress,
  openDays, publishGroups, readPhoneView, weekDays, withParams,
} from '@/pages/features/calendarbuilder/calendarScreen'

const root = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const noop = () => {}
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
const ISOS = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']
const TODAY = '2026-09-23'
const WEEK = { from: SAT, to: ISOS[6], range: 'week' as const }

const view = read('src/pages/features/calendarbuilder/BuilderView.tsx')
const live = read('src/pages/features/calendarbuilder/LiveView.tsx')

const fact = (employee: string, iso: string, over: Partial<CellFact> = {}): CellFact => ({
  employee, col_iso: iso, raw: '8A-4P', kind: 'day', code: '8A-4P', start: 8, end: 16, token: null, hours: 8,
  overnight: false, edited: false, state: 'upcoming', ...over,
})

/** A week of BM: Ann works Wed (running) and Thu (a draft over 8A-4P), Ben is off Thu, an OPEN shift on Fri. */
function house(over: Partial<Grid> = {}): Grid {
  const empty = (): Cell[] => ISOS.map(() => ({ text: '' }))
  const ann = empty()
  ann[4] = { text: '8A-4P' }
  ann[5] = { text: '8A-2P', draft: { base: '8A-4P', note: 'swap', by: 'Hana Boss', at: '', ist: '' } }
  const ben = empty()
  ben[5] = { text: 'OFF' }
  const open = empty()
  open[6] = { text: '3P-11P' }
  const shift: OpenShift = {
    key: `OPEN|${ISOS[6]}`, location: BM, open_row: 'OPEN', col_iso: ISOS[6], raw: '3P-11P', code: '3P-11P',
    start: 15, end: 23, hours: 8, kind: 'afternoon', overnight: false, claimed_by: null, claimed_via: null,
    claimed_at: null, pool_state: 'open', window: { closes_at: '2026-09-23T19:05:00Z' } as never, ref: 'SP9',
  }
  const computed: Computed = {
    cells: {
      [`Ann Roe|${ISOS[4]}`]: fact('Ann Roe', ISOS[4], { state: 'in_progress' }),
      [`Ann Roe|${ISOS[5]}`]: fact('Ann Roe', ISOS[5], { code: '8A-2P', end: 14, hours: 6 }),
      [`Ben Left|${ISOS[5]}`]: fact('Ben Left', ISOS[5], { kind: 'off', code: 'OFF', start: null, end: null, hours: 0 }),
      [`OPEN|${ISOS[6]}`]: fact('OPEN', ISOS[6], { code: '3P-11P', start: 15, end: 23, kind: 'afternoon' }),
    },
    people: [{ employee: 'Ann Roe', hours: 14, shifts: 2, off: 0, elsewhere: 0, by_week: { [SAT]: 14 }, conflicts: [] }],
    days: ISOS.map((iso) => ({ col_iso: iso, working: 0, off: 0, elsewhere: 0, hours: 0, names: [] })),
    conflicts: [], open_shifts: [shift],
    window: { first: ISOS[0], last: ISOS[6], days: 7, covers_today: true, today: TODAY },
    weekly_ot_hours: 40, totals: { hours: 14, shifts: 2, people: 2, open: 1 },
    running: [`Ann Roe|${ISOS[4]}`],
  }
  return {
    location: BM, cols: ISOS.map((iso) => ({ iso, label: iso.slice(5), short: iso.slice(5) })),
    rows: [
      { employee: 'Ann Roe', cells: ann },
      { employee: 'Ben Left', cells: ben },
      { employee: 'OPEN', open_row: true, cells: open },
    ],
    computed, ...over,
  }
}

/* ── the Builder is the Builder page, inside the one shell ─────────────── */

describe('the Builder view, inside the one screen', () => {
  it('the Builder page draws BuilderView; the old HouseBuilder, BuilderTab and board are gone', () => {
    assert.match(read('src/pages/features/calendarbuilder/HouseCalendarsScreen.tsx'), /return <BuilderView onView=\{switchView\} \/>/)
    for (const gone of ['calendarbuilder/HouseBuilder.tsx', 'calendarbuilder/BuilderTab.tsx', 'shifts/ShiftCalendarPage.tsx']) {
      assert.equal(existsSync(resolve(root, 'src/pages/features', gone)), false, gone)
    }
  })
  it('calendars are still made only here: every edit goes to the Builder\'s draft doors, and Live posts to none of them', () => {
    for (const door of ['houseLane.cell(', 'houseLane.move(', 'houseLane.requestOff(', 'houseLane.publish(grid.location)']) {
      assert.ok(view.includes(door), door)
    }
    assert.doesNotMatch(live, /houseLane\.(cell|move|requestOff|publish|undo|discard)\(/)
  })
  it('the band says DRAFT, the switch sits on Builder, and the tiles act', () => {
    assert.match(view, /<CalendarHero\s+view="build"/)
    assert.match(view, /builderTiles\(grid, fold\.days\)/)
    assert.match(view, /if \(id === 'drafts'\) \{\s*if \(summary\.cells\) \{ setBlocked\(null\); setPublishOpen\(true\) \}/)
    // unread transfers are said (null), and nothing is said before the first read (undefined)
    assert.match(view, /transfersWaiting: boardWhy \? null : board \? board\.waiting : undefined/)
  })
  it('its range defaults to the whole tab, remembered per person; a phone draws one week', () => {
    assert.match(view, /useUiPrefsStore\(\(s\) => s\.calendarRange\?\.build \?\? 'tab'\)/)
    assert.match(view, /setCalendarRange\('build', r\)/)
    assert.match(view, /const range: CalendarRange = phone \? 'week' : isRange\(rangeParam\) \? rangeParam : rangePref/)
  })
  it('the header\'s Refresh is the only one: no reload icon on the house bar, no Reload on the master grid', () => {
    assert.doesNotMatch(view, /RefreshCw|>\s*Reload\s*</)
    assert.doesNotMatch(read('src/pages/features/calendarbuilder/MasterGrid.tsx'), /RefreshCw|Reload\s*</)
    assert.match(view, /useBuilderRefresh\(\(\) => \{/)
  })
  it('its banners come in the design\'s order', () => {
    const at = (s: string) => { const i = view.indexOf(s); assert.ok(i > 0, s); return i }
    const order = [at('Nothing was written. The draft is kept'), at('so it holds: Publish records'),
      at('Published in test mode, not in the workbook'), at('this is not "nothing held"'),
      at('grid.pool && !grid.pool.readable'), at('This tab does not cover today')]
    assert.deepEqual([...order].sort((a, b) => a - b), order)
  })
  it('no browser dialog anywhere on the new files', () => {
    for (const p of ['BuilderView.tsx', 'MasterGrid.tsx', 'PublishHouseReview.tsx', 'DayAgenda.tsx']) {
      assert.doesNotMatch(read(`src/pages/features/calendarbuilder/${p}`), /window\.(confirm|alert|prompt)/, p)
    }
  })
})

/* ── the frame that survives a screenshot ─────────────────────────────── */

describe('draft vs live: the frame, the bar, the struck base', () => {
  it('the grid card wears a 2px amber frame and a DRAFT bar naming the house', () => {
    assert.match(view, /grid && !gridLoading && 'border-2 border-warning'/)
    assert.match(view, /aria-label="Draft" className="bg-warning/)
    assert.match(view, /Draft · \{houseShort\(grid\.location\)\} · not live until you publish/)
  })
  it('the grid\'s own header row says Draft too, and only in the Builder', () => {
    const grid = (mode: 'builder' | 'operations') => draw(
      <HouseGrid grid={house()} clock={false} mode={mode} editor onOpen={noop} />)
    // the ink is the surface's, so it reads on the dark theme's light amber too
    assert.match(grid('builder'), /bg-warning[^"]*text-surface">Draft</)
    assert.doesNotMatch(view, /bg-warning[^"]*text-white/)
    assert.doesNotMatch(grid('operations'), />Draft</)
  })
  it('every drafted cell is ringed amber and shows its base struck, at any width', () => {
    const html = draw(<HouseGrid grid={house()} clock={false} mode="builder" editor onOpen={noop} />)
    assert.match(html, /ring-warning/)
    assert.match(html, /line-through">was 8A-4P</)
  })
  it('the Builder\'s Publish buttons wear the LIVE tag; Live has no draft layer to draw', () => {
    assert.match(view, /Publish house…\s*<span[^>]*>LIVE<\/span>/)
    assert.match(live, /lane<Grid>\(`\/erp-lanes\/housecal\/\$\{encodeURIComponent\(location\)\}`\)/)
    assert.doesNotMatch(live, /houseLane\.grid\(/)
  })
})

/* ── the folded past ──────────────────────────────────────────────────── */

describe('the days before today fold into a stub', () => {
  it('folds the days before today when the range holds it, and nothing once opened', () => {
    assert.deepEqual(foldPast(WEEK, TODAY, false), { days: { ...WEEK, from: TODAY }, folded: 4 })
    assert.deepEqual(foldPast(WEEK, TODAY, true), { days: WEEK, folded: 0 })
    assert.deepEqual(foldPast(WEEK, SAT, false), { days: WEEK, folded: 0 }, 'today first: nothing before it')
    assert.deepEqual(foldPast(WEEK, '2026-10-01', false), { days: WEEK, folded: 0 }, 'a week that is not this one')
    assert.deepEqual(foldPast(WEEK, '', false), { days: WEEK, folded: 0 }, 'a tab that does not draw today')
  })
  it('the stub opens on click, and the opened days are drawn dimmed', () => {
    assert.match(view, /‹ \{fold\.folded\} earlier \{fold\.folded === 1 \? 'day' : 'days'\}/)
    assert.match(view, /onClick=\{\(\) => setPastOpen\(true\)\}/)
    const html = draw(<HouseGrid grid={house()} clock={false} mode="builder" editor onOpen={noop} dimBefore={TODAY} />)
    assert.equal((html.match(/data-iso="[^"]+"[^>]*class="[^"]*opacity-50/g) ?? []).length, 4)
  })
  it('the view opens on today', () => {
    assert.match(view, /if \(w\?\.covers_today && w\.today\) setFocus\(\{ iso: w\.today, tick: Date\.now\(\) \}\)/)
  })
})

/* ── the Publish review ───────────────────────────────────────────────── */

describe('the Publish review: base struck → value, and nothing outside the days unseen', () => {
  const drafts: DraftEntry[] = [
    { employee: 'Ann Roe', col_iso: ISOS[5], value: '8A-2P', base: '8A-4P', note: 'swap', by: 'Hana', at: '', ist: '' },
    { employee: 'Zoe New', col_iso: '2026-10-02', value: '7A-3P', base: '', note: '', by: 'Hana', at: '', ist: 'no IST for BM' },
  ]
  const rows = [{ employee: 'Ann Roe', cells: [] }, { employee: 'Zoe New', cells: [], draft_row: true }]
  it('splits the drafted cells into the days drawn and the rest', () => {
    const got = publishGroups(drafts, WEEK)
    assert.deepEqual(got.inside.map((d) => d.employee), ['Ann Roe'])
    assert.deepEqual(got.outside.map((d) => d.employee), ['Zoe New'])
    assert.deepEqual(publishGroups(drafts, undefined).inside.length, 2)
  })
  it('draws each cell as base struck → value, the note and IST, and the ones outside under their own heading', () => {
    const html = draw(<PublishHouseReview location={BM} drafts={drafts} summary={publishSummary(drafts, rows)} days={WEEK}
      labelOf={(iso) => iso} saving={false} testMode={null} onClose={noop} onConfirm={noop} />)
    assert.match(html, /role="dialog" aria-modal="true"/)
    assert.match(html, /2 cells to CAN - BM - BM4060 · 1 new row · 1 training/)
    assert.match(html, /line-through">8A-4P<\/span><span class="text-text-3">→<\/span><span class="font-semibold text-text-1">8A-2P/)
    assert.match(html, /“swap”/)
    assert.match(html, /Outside the days you are looking at · 1/)
    assert.match(html, /no IST for BM/)
    assert.match(html, /LIVE: happens now/)
    assert.match(html, /changed one of these cells in the workbook since it was drafted, nothing is written/)
    assert.doesNotMatch(html, /Test mode/)
  })
  it('says test mode before it is pressed', () => {
    const html = draw(<PublishHouseReview location={BM} drafts={drafts} summary={publishSummary(drafts, rows)} days={WEEK}
      labelOf={(iso) => iso} saving={false} testMode="on" onClose={noop} onConfirm={noop} />)
    assert.match(html, /Test mode is on: Publish records\s+these cells on the platform and does not write the workbook/)
  })
})

/* ── the rail, and "All houses · master grid" ─────────────────────────── */

describe('the Builder\'s rail and the master grid', () => {
  const built: House[] = [
    { location: JH, staff: 4, updated_at: '', may_edit: true, drafts: 0 },
    { location: B48, staff: 7, updated_at: '', may_edit: true, drafts: 2 },
  ]
  it('lists only the houses this reader builds, A–Z by the name people say, as "Your houses"', () => {
    const s = builderRailSections(built)
    assert.deepEqual(s.map((x) => x.title), ['Your houses'])
    assert.deepEqual(s[0].houses.map((h) => h.location), [B48, JH])
    assert.deepEqual(builderRailSections(null), [])
  })
  it('"All houses · master grid" is a rail entry for every-house editors, above the houses; `house=all` opens it', () => {
    assert.equal(MASTER_HOUSE, 'all')
    assert.match(view, /const masterEntry = info\?\.edits_every_house \?/)
    assert.match(view, /All houses · master grid/)
    assert.match(view, /top=\{masterEntry\}/)
    const html = draw(<HouseRail sections={builderRailSections(built)} current={B48} onPick={noop} filter="" onFilter={noop}
      loading={false} failed="" top={<span>THE MASTER ENTRY</span>} />)
    assert.ok(html.indexOf('THE MASTER ENTRY') < html.indexOf('Your houses'))
  })
  it('the master grid needs a wide screen, and says so below 1024px', () => {
    assert.match(view, /useMediaQuery\('\(min-width: 1024px\)'\)/)
    assert.match(view, /The all-houses grid needs a wider screen\./)
  })
  it('its band: the master\'s own draft and conflicts, the houses with drafts, and test mode — "—" until read', () => {
    assert.ok(masterTiles(null, null).every((t) => t.value === '—'))
    const tiles = masterTiles({ drafts: 3, conflicts: 1, testMode: 'on' }, built)
    assert.deepEqual(tiles.map((t) => [t.id, t.value]), [['m-drafts', '3'], ['m-conflicts', '1'], ['m-houses', '1'], ['m-test', 'On']])
    assert.equal(tiles[3].sub, 'master publish refused')
    assert.equal(masterTiles({ drafts: 0, conflicts: 0, testMode: undefined }, built)[3].value, '—', 'a door that did not say is not "off"')
  })
  it('the master eyebrow and name replace a house\'s', () => {
    const html = draw(<CalendarHero view="build" house="" eyebrow="Master grid: the next period" title="All houses"
      managerText="" access={null} switcher={{ shown: true, enabled: true, why: '', drafts: 3 }} onView={noop}
      tiles={[]} onTile={noop} strip={{ heard: true, readAt: '', testMode: null }} />)
    assert.match(html, /Master grid: the next period/)
    assert.match(html, /All houses/)
    assert.doesNotMatch(html, /House manager/)
  })
  it('the master grid door says test mode, and the master says it before Publish master grid… is pressed', () => {
    const relay = read('server/snapshot_service.py')
    const door = relay.slice(relay.indexOf('async def erp_cal_builder_grid'), relay.indexOf('async def erp_cal_builder_cell'))
    assert.match(door, /"test_mode": effective_roster\.test_mode_said\(\)/)
    const master = read('src/pages/features/calendarbuilder/MasterGrid.tsx')
    assert.match(master, /Publish master grid is\s+refused and the draft is kept as it is/)
    assert.match(master, /Publish master grid…/)
  })
  it('the master grid is repainted in the shared colours, with no amber on its OPEN rows', () => {
    const grid = read('src/pages/features/calendarbuilder/BuilderGrid.tsx')
    assert.match(grid, /cellTint\(kind\)/)
    assert.doesNotMatch(grid, /tint-amber|ring-amber/)
  })
})

/* ── the panel in the Builder ─────────────────────────────────────────── */

describe('the Builder panel', () => {
  it('Mark Call-Off is handed to the panel\'s Live-now box, with the reason, through the Builder\'s own door', () => {
    assert.match(view, /onCallOff=\{\(note\) => \{ if \(panelTarget\) markCallOff\(panelTarget, note\) \}\}/)
    assert.match(view, /houseLane\.callOff\(grid\.location, at\.employee, at\.colIso, note\)/)
    assert.match(view, /drafted=\{Boolean\(panelCell\?\.draft\)\}/)
  })
  it('reads the transfers itself, and locks the editor on a shift with one waiting', () => {
    assert.match(view, /lane<Board>\(OFFER_PATH\)/)
    assert.match(view, /board\.list\.filter\(\(h\) => h\.location === gridLocation\)/)
    assert.match(view, /handoffAt\(boardHere, panelTarget\.employee, panelTarget\.colIso\)/)
    // the grid draws them (⇄), the Key keys them, and a drag never moves or lands on one
    assert.match(view, /handoffs=\{boardHere\}/)
    assert.match(view, /statesPresent\(grid, 'build', timeOff, true, boardHere\)/)
    assert.match(view, /transferWaiting: Boolean\(handoffAt\(boardHere, from\.employee, from\.colIso\)\s*\|\| handoffAt\(boardHere, to\.employee, to\.colIso\)\)/)
    assert.match(view, /: cellTransfer \? 'It is changed here once the transfer is answered or withdrawn in Live\.'/)
  })
  it('"Open it in Live" is the view switch, keeping the red cell\'s handle', () => {
    assert.match(view, /toLive\(\{ employee: panelTarget\.employee, colIso: panelTarget\.colIso, \.\.\.\(s\?\.ref \? \{ ref: s\.ref \} : \{\}\) \}\)/)
    assert.match(view, /const toLive = \(cell\?: CarriedCell \| null\) => onView\('live', \{/)
  })
  it('the editor is told of time off on the day, from the one place the Time Off app feeds', () => {
    assert.match(view, /timeOff=\{timeOffAt\(timeOff, cellKey\(panelTarget\.employee, panelTarget\.colIso\), true\)\}/)
    assert.match(view, /useTimeOffMarks\(grid, true\)/)
    assert.match(live, /useTimeOffMarks\(grid, mayEdit\)/)
  })
})

/* ── switching, links and old addresses ───────────────────────────────── */

describe('the switch and the addresses', () => {
  it('a Builder link for a house the reader does not build lands on that house in Live, and says so', () => {
    assert.equal(liveForBuilderLink(`?house=${encodeURIComponent(BM)}&day=2026-09-24&employee=Ann%20Roe`),
      houseCalLink(BM, { open: 'Ann Roe|2026-09-24' }))
    assert.equal(liveForBuilderLink('house=BM4060'), houseCalLink('BM4060'))
    assert.equal(liveForBuilderLink('?house=all'), HOUSE_CAL_PATH)
    assert.match(view, /toast\(\{ type: 'info', title: 'Not a house you build: showing its roster' \}\)/)
    const route = read('src/pages/AppRoutePage.tsx')
    assert.match(route, /app\.id === 'calendarbuilder' && page\.id === 'builder' && isAllowedWith\(apps, role, app\.id, 'house-cal'\)/)
    assert.match(route, /<NotABuilder to=\{liveForBuilderLink\(search\)\} \/>/)
    assert.match(route, /title: 'Not a house you build: showing its roster'/)
  })
  it('only an explicit range travels with the switch; each view otherwise opens on its own', () => {
    assert.match(view, /const carriedRange = isRange\(rangeParam\) \? rangeParam : undefined/)
    assert.match(live, /range: isRange\(rangeParam\) \? rangeParam : undefined/)
  })
  it('the old House Calendar address is Live\'s week, its query kept; a client or guardian lands on Shift Cards', () => {
    assert.equal(movedAddress('calendar', '?house=48TH%20(B)', true), '/app/calendarbuilder/house-cal?house=48TH%20(B)&range=week')
    assert.equal(movedAddress('calendar', '?house=BM&range=tab', true), '/app/calendarbuilder/house-cal?house=BM&range=tab')
    assert.equal(movedAddress('calendar', '', true), '/app/calendarbuilder/house-cal?range=week')
    assert.equal(movedAddress('calendar', '?house=BM', false), '/app/calendarbuilder/cards')
    assert.equal(movedAddress('house-cal', '?house=BM', true), null)
    const page = read('src/pages/features/calendarbuilder/CalendarBuilderPage.tsx')
    assert.match(page, /const moved = movedAddress\(pageId, search, isAllowedWith\(apps, role, APP_ID, 'house-cal'\)\)/)
    assert.ok(page.indexOf('const moved = movedAddress') < page.indexOf('<PageHeader'), 'checked before anything is drawn')
    assert.doesNotMatch(page, /case 'calendar':|ShiftCalendarPage/)
  })
  it('the board is off the menu and the switcher but still routes, and the Shift Board\'s old address goes to Live', () => {
    assert.equal((calendarPage.config as { hidden?: boolean }).hidden, true)
    assert.match(read('src/pages/AppRoutePage.tsx'), /'calendarbuilder\/calendar': CalendarBuilderPage/)
    assert.equal(SHIFT_BOARD_MOVED_TO.calendar, 'house-cal')
  })
  it('the links that named the board name Live now', () => {
    const client = read('src/pages/features/clients/ClientRecordPage.tsx')
    assert.match(client, /const houseHref = house \? `\$\{houseCalLink\(house\)\}&range=week` : ''/)
    assert.match(client, /const opensCalendar = isAllowedWith\(apps, role, 'calendarbuilder', 'house-cal'\)/)
    assert.match(client, /\{!opensCalendar \? null : houseHref \?/)
    const ops = read('src/pages/features/opsdash/OpsDashPage.tsx')
    assert.doesNotMatch(ops, /calendarbuilder\/calendar\b/)
    assert.equal(ops.split("'/app/calendarbuilder/house-cal?range=week'").length - 1, 2)
  })
  it('the address helper drops what is emptied and keeps the rest', () => {
    const next = withParams(new URLSearchParams('house=BM&day=2026-09-24&employee=Ann'), { day: null, employee: '', week: SAT })
    assert.equal(next.toString(), `house=BM&week=${SAT}`)
  })
})

/* ── a phone ──────────────────────────────────────────────────────────── */

describe('a phone', () => {
  it('Live opens on the day agenda unless this device chose the grid', () => {
    assert.equal(readPhoneView(), 'day')
    assert.match(live, /const dayView = phone && phoneView === 'day'/)
    assert.match(live, /<DayAgenda grid=\{grid\}/)
    assert.match(live, /writePhoneView\(v\)/)
  })
  it('the agenda\'s day: the one picked if the week holds it, else today, else the week\'s first', () => {
    const week = weekDays(SAT)
    assert.equal(week.length, 7)
    assert.equal(agendaDayOf(week, ISOS[2], TODAY), ISOS[2])
    assert.equal(agendaDayOf(week, '2026-10-09', TODAY), TODAY)
    assert.equal(agendaDayOf(weekDays('2026-09-26'), '', TODAY), '2026-09-26')
  })
  it('one day of the house: the shifts nobody has, who works by start, who is off', () => {
    const wed = agendaOf(house(), ISOS[4])
    assert.deepEqual(wed.working.map((w) => w.employee), ['Ann Roe'])
    const thu = agendaOf(house(), ISOS[5], new Map([['Ann Roe|2026-09-24', 'scheduled' as const]]))
    assert.deepEqual(thu.off.map((o) => [o.employee, o.timeOff]), [['Ben Left', false]])
    assert.deepEqual(agendaOf(house(), ISOS[6]).open.map((s) => s.ref), ['SP9'])
    assert.deepEqual([...openDays(house())], [ISOS[6]])
  })
  it('draws the strip with a red dot, the red card with Give for the editor and Apply for staff, the working rows', () => {
    const editor = draw(<DayAgenda grid={house()} week={ISOS} day={ISOS[6]} onDay={noop} mayEdit nowMs={0}
      saving={false} onOpen={noop} onApply={noop} />)
    assert.match(editor, /aria-label="an open shift"/)
    assert.match(editor, /bg-\[#8b0000\] p-3 text-white/)
    assert.match(editor, />Give</)
    const g2 = house()
    g2.computed!.open_shifts = [{ ...g2.computed!.open_shifts[0], mine: { may: true, code: 'ok', why: '' } }]
    const staff = draw(<DayAgenda grid={g2} week={ISOS} day={ISOS[6]} onDay={noop} mayEdit={false} nowMs={0}
      saving={false} onOpen={noop} onApply={noop} />)
    assert.match(staff, />Apply</)
    const wed = draw(<DayAgenda grid={house()} week={ISOS} day={ISOS[4]} onDay={noop} mayEdit nowMs={0}
      saving={false} onOpen={noop} onApply={noop} />)
    assert.match(wed, /Working · 1/)
    assert.match(wed, /aria-label="running now"/)
    const thu = draw(<DayAgenda grid={house()} week={ISOS} day={ISOS[5]} onDay={noop} mayEdit nowMs={0}
      saving={false} onOpen={noop} onApply={noop} />)
    assert.match(thu, /Off · R\/O · Time off · 1/)
  })
  it('the panel is a bottom sheet at 90% with a handle', () => {
    const panel = read('src/pages/features/shifts/ShiftCellPanel.tsx')
    assert.match(panel, /phone \? 'max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-\[90vh\] max-sm:rounded-t-\[16px\]'/)
    // the phone of the code is Tailwind's max-sm, so the two never disagree at 640px
    assert.match(panel, /useMediaQuery\('\(max-width: 639px\)'\)/)
  })
  it('the Builder keeps its count and Publish in a sticky bar, above the safe area, and never drags', () => {
    assert.match(view, /fixed bottom-0 z-20[^"]*pb-\[calc\(0\.625rem\+env\(safe-area-inset-bottom\)\)\][^"]*max-sm:inset-x-0 sm:hidden/)
    assert.match(view, /canDrag=\{Boolean\(grid\.access\?\.edit\) && !phone\}/)
    assert.match(view, /weekOnly=\{phone\}/)
  })
  it('the rail folds into one sticky button that opens the list full screen', () => {
    const html = draw(<HouseRail sections={builderRailSections([{ location: B48, staff: 7, updated_at: '', may_edit: true }])}
      current={B48} onPick={noop} filter="" onFilter={noop} loading={false} failed="" />)
    assert.match(html, /sticky top-0 z-20[^"]*sm:hidden"><span class="min-w-0 truncate">48TH \(B\)</)
  })
  it('from a tablet up the rail stays a 240px column beside the grid, its list scrolling inside it', () => {
    const html = draw(<HouseRail sections={builderRailSections([{ location: B48, staff: 7, updated_at: '', may_edit: true }])}
      current={B48} onPick={noop} filter="" onFilter={noop} loading={false} failed="" />)
    assert.match(html, /<aside aria-label="Houses" class="hidden w-\[240px\] shrink-0 flex-col[^"]*sm:flex"/)
    assert.match(html, /overflow-y-auto[^"]*sm:max-h-\[calc\(100vh-260px\)\]/)
    for (const v of [view, live]) assert.match(v, /<div className="flex flex-col gap-3 sm:flex-row sm:items-start">/)
  })
  it('the phone\'s day says a shift test mode held, as the grid does', () => {
    const g2 = house()
    g2.rows[0].cells[4] = { text: '8A-4P', test_mode: true }
    assert.equal(agendaOf(g2, ISOS[4]).working[0].mark, 'test-mode')
    assert.equal(agendaOf(house(), ISOS[4]).working[0].mark, null)
    const html = draw(<DayAgenda grid={g2} week={ISOS} day={ISOS[4]} onDay={noop} mayEdit nowMs={0}
      saving={false} onOpen={noop} onApply={noop} />)
    assert.match(html, /border-dashed border-warning[^"]*">test mode</)
  })
  it('the range bar tucks the Time switch into "⋯", and a phone\'s Builder offers no range pair', () => {
    const bar = (weekOnly: boolean) => draw(<RangeBar days={WEEK} weeks={[SAT]} week={SAT} range="week" thisWeek={SAT}
      onWeek={noop} onRange={noop} time={<span>TIME</span>} present={[]} weekOnly={weekOnly} />)
    assert.match(bar(false), /aria-label="More"/)
    assert.match(bar(false), /aria-label="Range"/)
    assert.doesNotMatch(bar(true), /aria-label="Range"/)
  })
  it('the band\'s tiles scroll sideways two rows at a time, and the switch runs full width', () => {
    const hero = read('src/pages/features/calendarbuilder/CalendarHero.tsx')
    assert.match(hero, /snap-x snap-mandatory auto-cols-\[calc\(50%-4px\)\] grid-flow-col grid-rows-2/)
    assert.match(hero, /flex w-full gap-\[3px\] self-start rounded-\[12px\]/)
  })
})

/* ── the names, handles for the tracker ───────────────────────────────── */

describe('the names drag to the tracker by Calendar Builder\'s own choice', () => {
  it('carries the Shift Board\'s choice until Calendar Builder has one of its own', () => {
    assert.equal(dragFocusOf([{ id: 'shiftboard', dragFocus: false }, { id: 'calendarbuilder' }], 'calendarbuilder'), false)
    assert.equal(dragFocusOf([{ id: 'shiftboard', dragFocus: false }, { id: 'calendarbuilder', dragFocus: true }], 'calendarbuilder'), true)
    assert.equal(dragFocusOf([{ id: 'calendarbuilder' }], 'calendarbuilder'), true, 'on by default')
    assert.equal(dragFocusOf([{ id: 'shiftboard', dragFocus: false }], 'ui-incidents'), true, 'nothing carried elsewhere')
    assert.match(read('src/lib/dragFocus.ts'), /useRegistryStore\(\(s\) => dragFocusOf\(s\.apps, appId\)\)/)
  })
  it('the house grid and the last roster read it', () => {
    assert.match(read('src/pages/features/shifts/HouseGrid.tsx'), /useDragFocusEnabled\('calendarbuilder'\)/)
    assert.match(read('src/pages/features/shifts/LastRosterWeek.tsx'), /useDragFocusEnabled\('calendarbuilder'\)/)
  })
})
