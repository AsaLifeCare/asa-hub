/**
 * Smart Comms and every road into the one calendar screen: the Desk's card, the URGENT {link}, the web notices,
 * the transfers, the 410 answers and Requests land on the right view, house and cell; no word sends a reader to a
 * screen the switcher no longer lists; and time off is drawn from one place (timeOffMarks) the Time Off app feeds.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import HouseGrid from '@/pages/features/shifts/HouseGrid'
import RangeBar from '@/pages/features/calendarbuilder/RangeBar'
import {
  BUILDER_PATH, HOUSE_CAL_PATH, builderLink, cellKey, houseCalLink, linkForCallOff, linkForShift,
  type Cell, type Grid, type OpenShift,
} from '@/pages/features/shifts/houseCalTypes'
import {
  VIEW_PAGE, linkedDay, liveForBuilderLink, statesPresent, viewOfPage, viewPath,
} from '@/pages/features/calendarbuilder/calendarScreen'
import { swapLink } from '@/pages/features/shifts/requestDetail'
import {
  TIME_OFF_FLAG, TIME_OFF_HATCH, TIME_OFF_KEY, TIME_OFF_LOOK, isAway, timeOffFill, timeOffMarkOf, timeOffMarksOf,
  timeOffUnreadLine, timeOffWarning,
} from '@/pages/features/shifts/timeOffMarks'

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

const JH = 'CAN - JH - ABD2704'
const B48 = 'CAN - 48TH (B) - ABD1711'

/** A link's page and its decoded parameters, however each side spells its escapes. */
function landing(link: string): { page: string; params: Record<string, string> } {
  const path = link.replace(/^\/#/, '')
  const [p, q = ''] = path.split('?')
  return { page: p.split('/').pop() ?? '', params: Object.fromEntries(new URLSearchParams(q)) }
}

/* ── every road lands on the right view, house and cell ─────────────────── */

describe('every road into the calendar screen lands on the right view, house and cell', () => {
  const shift: OpenShift = {
    key: 'OPEN 2|2026-09-24', location: JH, open_row: 'OPEN 2', col_iso: '2026-09-24', raw: '3P-11P', code: '3P-11P',
    start: 15, end: 23, hours: 8, kind: 'afternoon', overnight: false, claimed_by: null, claimed_via: null, claimed_at: null,
  }
  it('the Desk\'s open-shift card: Live, that house, the red cell by its handle, else by its cell', () => {
    const byRef = landing(linkForShift({ ...shift, ref: 'SP0123456789' }))
    assert.equal(viewOfPage(byRef.page), 'live')
    assert.deepEqual(byRef.params, { house: JH, ref: 'SP0123456789' })
    const byCell = landing(linkForShift(shift))
    assert.deepEqual(byCell.params, { house: JH, open: 'OPEN 2|2026-09-24' })
    assert.match(read('src/pages/features/smartcomms/OpenShiftsCard.tsx'), /onClick=\{\(\) => navigate\(linkForShift\(s\)\)\}/)
  })
  it('the Desk\'s call-off rows: the red cell when it is open, else the caller\'s own cell', () => {
    const open = { ...shift, kind_of_open: 'call_off', ref: 'SPCALLOFF01', open_row: 'OPEN · call-off',
                   called_off_by: 'Zed Caller' }
    const red = landing(linkForCallOff([open], { house: JH, day: '2026-09-24', person: 'Zed Caller' }))
    assert.equal(viewOfPage(red.page), 'live')
    assert.deepEqual(red.params, { house: JH, ref: 'SPCALLOFF01' })
    assert.deepEqual(landing(linkForCallOff([open], { house: JH, day: '2026-09-25', person: 'Zed Caller' })).params,
      { house: JH, open: 'Zed Caller|2026-09-25' })
  })
  it('the URGENT OPEN SHIFT {link}: the relay\'s path is Live\'s, spelled as the screen spells it', () => {
    assert.match(read('server/shift_requests.py'), /^DEEP_LINK_PATH = "\/#\/app\/calendarbuilder\/house-cal"$/m)
    assert.match(read('server/shift_requests.py'),
      /parts = \[f"house=\{quote\(location, safe=''\)\}"\] if location else \[\]\n\s+parts\.append\(f"ref=\{quote\(str\(ref or ''\), safe=''\)\}"\)/)
    // the self-test's own fixture is the path the relay hands the call-off road
    const fixture = /path: '(\/#\/app\/calendarbuilder\/house-cal\?[^']+)'/.exec(read('apps-script/SelfTest.gs'))?.[1] ?? ''
    assert.equal(fixture, `/#${houseCalLink(JH, { ref: 'SP0123456789' })}`)
    assert.equal(viewOfPage(landing(fixture).page), 'live')
  })
  it('a web notice: Live with the shift by its handle, and its day in view when the shift is gone', () => {
    const notices = read('server/web_notices.py')
    assert.match(notices, /^HOUSE_CAL_HREF = "\/app\/calendarbuilder\/house-cal"$/m)
    assert.match(notices, /urlencode\(\{"house": location, "day": col_iso, "ref": ref\}/)
    // the relay's spelling and the screen's decode the same
    const relay = landing('/app/calendarbuilder/house-cal?house=CAN%20-%2048TH%20%28B%29%20-%20ABD1711&day=2026-09-23&ref=SPABC')
    assert.deepEqual(relay, landing(houseCalLink(B48, { ref: 'SPABC', day: '2026-09-23' })))
    const live = read('src/pages/features/calendarbuilder/LiveView.tsx')
    assert.match(live, /const wantDay = params\.get\('day'\) \?\? ''/)
    assert.match(live, /if \(!grid \|\| \(!wantRef && !wantOpen && !wantDay\)\) return/)
    assert.match(live, /house: grid\.location, open: null, ref: null, day: null,/)
  })
  it('the day a link names: its shift\'s own, else the link\'s when the tab draws it, else none', () => {
    const isos = ['2026-09-19', '2026-09-20', '2026-09-21']
    assert.equal(linkedDay('2026-09-20', '2026-09-21', isos), '2026-09-20')
    assert.equal(linkedDay('', '2026-09-21', isos), '2026-09-21')
    assert.equal(linkedDay('', '2031-01-01', isos), '')
    assert.equal(linkedDay('', '', isos), '')
  })
  it('a linked cell comes into view on the whole tab and opens on a phone\'s agenda', () => {
    const live = read('src/pages/features/calendarbuilder/LiveView.tsx')
    const effect = live.slice(live.indexOf('// open the linked shift once its grid arrives'),
                              live.indexOf('// the ring (and a stream reconnect)'))
    assert.match(effect, /setAgendaPick\(day\)/)
    assert.match(effect, /if \(range === 'tab'\) setFocus\(\{ iso: day, tick: Date\.now\(\) \}\)/)
    assert.match(effect, /\.\.\.\(day && range === 'week' \? \{ week: weekKeyOf\(day\) \} : \{\}\)/)
  })
  it('the 410 moved_to_builder answer: the Builder on that house and day; a reader who does not build it keeps the day on Live', () => {
    const houses = read('server/calendar_builder_houses.py')
    assert.match(houses, /BUILDER_PATH = "\/app\/calendarbuilder\/builder"/)
    assert.match(houses, /parts = \[f"house=\{quote\(location, safe=''\)\}"\]\n\s+if day:\n\s+parts\.append\(f"day=\{quote\(day, safe=''\)\}"\)/)
    assert.match(read('server/snapshot_service.py'), /"reason": "moved_to_builder"/)
    const relay = landing(`/#${BUILDER_PATH}?house=CAN%20-%20JH%20-%20ABD2704&day=2026-09-24`)
    assert.equal(viewOfPage(relay.page), 'build')
    assert.deepEqual(relay, landing(builderLink(JH, { day: '2026-09-24' })))
    assert.deepEqual(landing(liveForBuilderLink(`?house=${encodeURIComponent(JH)}&day=2026-09-24`)).params,
      { house: JH, day: '2026-09-24' })
    assert.match(read('src/pages/features/calendarbuilder/BuilderView.tsx'),
      /onView\('live', \{ house: wantHouse, cell: wantDay \? \{ employee: wantEmployee, colIso: wantDay \} : null \}\)/)
  })
  it('the view switch carries a day with nobody named, both ways', () => {
    assert.equal(viewPath('live', { house: JH, cell: { employee: '', colIso: '2026-09-24' } }),
      houseCalLink(JH, { day: '2026-09-24' }))
    assert.equal(viewPath('build', { house: JH, cell: { employee: '', colIso: '2026-09-24' } }),
      builderLink(JH, { day: '2026-09-24' }))
    assert.deepEqual(VIEW_PAGE, { live: 'house-cal', build: 'builder' })
  })
  it('a transfer on Requests opens the giver\'s cell that day on Live, where the transfer waits', () => {
    const at = landing(swapLink({ location: JH, from_staff: 'Eve Gone', col_iso: '2026-09-24' }))
    assert.equal(viewOfPage(at.page), 'live')
    assert.deepEqual(at.params, { house: JH, open: 'Eve Gone|2026-09-24' })
    assert.deepEqual(landing(swapLink({ location: JH, col_iso: '2026-09-24' })).params, { house: JH })
    assert.match(read('src/pages/features/shifts/requestDetail.ts'), /href: swapLink\(r\)/)
  })
  it('Requests, the Houses tile and Ops open Live on the house, and say where they go by its listed name', () => {
    const onCal = read('src/pages/features/shifts/OnCalendar.tsx')
    assert.match(onCal, /navigate\(houseCalLink\(location, \{ ref: shiftRef \}\)\)/)
    assert.match(onCal, /title="Open this shift on Calendar Builder → Live"/)
    assert.match(read('src/pages/features/houses/houseTools.ts'), /note: 'Calendar Builder' \}/)
    assert.match(read('src/pages/features/opsdash/OpsDashPage.tsx'), /viewAllLabel: 'Calendar Builder'/)
  })
})

/* ── no word sends a reader to a screen the switcher no longer lists ────── */

/** Quoted text naming "House Calendars", comments and docstrings aside. */
function namesTheOldScreen(src: string, comment: RegExp): string[] {
  return src.split('\n')
    .filter((l) => !comment.test(l.trim()))
    .filter((l) => /(['"`])[^'"`]*House Calendars[^'"`]*\1/.test(l))
}

describe('no word sends a reader to "House Calendars"', () => {
  it('the screen\'s own words name Calendar Builder → Live, or Live inside the screen', () => {
    const files = [
      'src/pages/features/shifts/OnCalendar.tsx', 'src/pages/features/smartcomms/SmartCommsPage.tsx',
      'src/pages/features/houses/houseTools.ts', 'src/pages/features/opsdash/OpsDashPage.tsx',
      'src/pages/features/shifts/HouseGrid.tsx', 'src/pages/features/shifts/houseCalTypes.ts',
      'src/pages/features/calendarbuilder/BuilderView.tsx', 'src/pages/features/calendarbuilder/CalendarHero.tsx',
      'src/pages/features/calendarbuilder/builderLogic.ts', 'src/pages/features/calendarbuilder/MasterGrid.tsx',
      'src/pages/features/calendarbuilder/LiveView.tsx', 'src/pages/features/shifts/ShiftCellPanel.tsx',
      'src/pages/features/shifts/ShiftRequestsPage.tsx', 'src/pages/features/shifts/requestDetail.ts',
    ]
    for (const f of files) assert.deepEqual(namesTheOldScreen(read(f), /^(\/\/|\*|\/\*|\{\/\*)/), [], f)
  })
  it('the relay\'s answers and notices say the same', () => {
    for (const f of ['server/shift_handoff.py', 'server/web_notices.py', 'server/calendar_builder_houses.py',
                     'server/shift_requests.py', 'server/snapshot_service.py']) {
      assert.deepEqual(namesTheOldScreen(read(f), /^(#|""")/), [], f)
    }
    assert.match(read('server/web_notices.py'), /"somebody has to be placed on it from Calendar Builder → Live"/)
  })
})

/* ── time off, in one place ─────────────────────────────────────────────── */

const ISOS = ['2026-09-19', '2026-09-20', '2026-09-21']

function fed(): Grid {
  const cells = (marks: (Cell['time_off'] | undefined)[]): Cell[] => marks.map((m) => ({ text: '', ...(m ? { time_off: m } : {}) }))
  return {
    location: JH, cols: ISOS.map((iso) => ({ iso, label: iso.slice(5) })),
    rows: [
      { employee: 'Ann Roe', cells: cells([{ state: 'scheduled', ref: 'TO1', until: ISOS[1] }, undefined, undefined]) },
      { employee: 'Ben Left', cells: cells([undefined, { state: 'pending', ref: 'TO2', until: ISOS[1] }, { state: 'approved?' }]) },
      { employee: 'OPEN', open_row: true, cells: cells([{ state: 'scheduled' }, undefined, undefined]) },
    ],
  }
}

describe('time off: asked is the slate corner flag, scheduled the hatch, in one place', () => {
  it('reads the feed the relay lays on each cell: pending is asked, an unknown state draws nothing', () => {
    assert.equal(timeOffMarkOf({ state: 'scheduled' }), 'scheduled')
    assert.equal(timeOffMarkOf({ state: 'pending' }), 'asked')
    assert.equal(timeOffMarkOf({ state: 'asked' }), 'asked')
    assert.equal(timeOffMarkOf({ state: 'approved?' }), null)
    assert.equal(timeOffMarkOf(undefined), null)
  })
  it('one house\'s marks: the asked day for its editors only, and nobody off on an OPEN row', () => {
    const forEditor = timeOffMarksOf(fed(), true)
    assert.deepEqual([...forEditor.entries()].sort(), [
      [cellKey('Ann Roe', ISOS[0]), 'scheduled'], [cellKey('Ben Left', ISOS[1]), 'asked'],
    ])
    assert.deepEqual([...timeOffMarksOf(fed(), false).entries()], [[cellKey('Ann Roe', ISOS[0]), 'scheduled']])
    assert.equal(timeOffMarksOf(null, true).size, 0)
  })
  it('the look: scheduled hatches with TO and is a day off; asked is a flag, never dashed, and not a day off', () => {
    assert.deepEqual([TIME_OFF_LOOK.scheduled.hatch, TIME_OFF_LOOK.scheduled.flag, TIME_OFF_LOOK.scheduled.tag], [true, false, 'TO'])
    assert.deepEqual([TIME_OFF_LOOK.asked.hatch, TIME_OFF_LOOK.asked.flag, TIME_OFF_LOOK.asked.tag], [false, true, ''])
    assert.doesNotMatch(TIME_OFF_FLAG, /dashed/)
    assert.match(TIME_OFF_FLAG, /left-0 top-0/)
    assert.equal(isAway('scheduled'), true)
    assert.equal(isAway('asked'), false)
    assert.equal(timeOffFill('scheduled', false), TIME_OFF_HATCH)
    assert.equal(timeOffFill('scheduled', true), undefined, 'an OPEN fill wins over the hatch')
    assert.equal(timeOffFill('asked', false), undefined)
  })
  it('the grid draws what the feed laid: the hatch and TO for every reader, the flag for the editor', () => {
    const marks = timeOffMarksOf(fed(), true)
    const editor = draw(<HouseGrid grid={fed()} clock={false} mode="operations" editor onOpen={noop} timeOff={marks} />)
    assert.match(editor, /background-image:repeating-linear-gradient\(45deg/)
    assert.match(editor, />TO</)
    assert.ok(editor.includes(TIME_OFF_FLAG), 'the corner flag')
    const staff = draw(<HouseGrid grid={fed()} clock={false} mode="operations" editor={false} onOpen={noop}
      timeOff={timeOffMarksOf(fed(), false)} />)
    assert.match(staff, /time-off-scheduled/)
    assert.ok(!staff.includes(TIME_OFF_FLAG), 'no flag for a reader who does not edit')
  })
  it('the Key keys both from the same place, and the views ask it rather than spelling a mark', () => {
    assert.deepEqual(TIME_OFF_KEY.map((k) => [k.id, k.label, k.flag, Boolean(k.style)]),
      [['time-off', 'Time off', false, true], ['time-off-asked', 'Time off asked', true, false]])
    const key = draw(<RangeBar days={{ from: ISOS[0], to: ISOS[2], range: 'tab' }} weeks={[ISOS[0]]} week={ISOS[0]}
      range="tab" thisWeek={null} onWeek={noop} onRange={noop} time={<span />} present={['time-off', 'time-off-asked']} />)
    assert.doesNotMatch(key, /Time off asked/, 'the Key is closed until opened')
    assert.deepEqual(statesPresent(fed(), 'live', timeOffMarksOf(fed(), true), true).filter((s) => s.startsWith('time-off')).sort(),
      ['time-off', 'time-off-asked'])
    for (const f of ['src/pages/features/shifts/HouseGrid.tsx', 'src/pages/features/calendarbuilder/RangeBar.tsx',
                     'src/pages/features/calendarbuilder/DayAgenda.tsx', 'src/pages/features/shifts/ShiftEditor.tsx',
                     'src/pages/features/calendarbuilder/calendarScreen.ts']) {
      assert.doesNotMatch(read(f), /=== 'scheduled'|=== 'asked'|TIME_OFF_HATCH\b(?! =)/, f)
    }
  })
  it('the editor\'s warning and the unread line are said from the same place', () => {
    assert.equal(timeOffWarning('scheduled', 'Ann Roe'), 'Ann Roe has time off on the roster this day: a shift here is a conflict with it.')
    assert.equal(timeOffWarning('asked', 'Ann Roe'), 'Ann Roe asked for this day off; it is not on the roster yet.')
    assert.equal(timeOffUnreadLine({ time_off: { readable: false, why: 'the book did not answer' } }),
      'Time off could not be read (the book did not answer) — this is not saying nobody is off.')
    assert.equal(timeOffUnreadLine({ time_off: { readable: true, why: '' } }), '')
    assert.equal(timeOffUnreadLine({}), '')
    assert.match(read('src/pages/features/calendarbuilder/LiveView.tsx'), /timeOffUnreadLine\(grid\) && <span className="text-danger">/)
    assert.match(read('src/pages/features/calendarbuilder/BuilderView.tsx'), /timeOffUnreadLine\(grid\) && <span className="text-danger">/)
  })
  it('the paths every link builds stay the ones already sent', () => {
    assert.equal(HOUSE_CAL_PATH, '/app/calendarbuilder/house-cal')
    assert.equal(BUILDER_PATH, '/app/calendarbuilder/builder')
  })
})
