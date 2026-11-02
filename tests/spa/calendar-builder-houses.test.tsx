/**
 * The Builder's house editor, screen side: picker codes (builder-codes.json), save routing, picks, the publish
 * summary and the editor as drawn. The server side is tools/test-calendar-builder-houses.py.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import ShiftEditor from '@/pages/features/shifts/ShiftEditor'
import ShiftCellPanel from '@/pages/features/shifts/ShiftCellPanel'
import {
  codeOf, hourOfTimeInput, ohioHourNow, runningFor, spanHours, timeInputOf, timesOf,
} from '@/pages/features/shifts/shiftTimes'
import {
  BUILDER_PATH, builderLink,
  type CellFact, type Computed, type DraftEntry, type HistoryEntry, type OpenShift, type Row,
} from '@/pages/features/shifts/houseCalTypes'
import {
  callOffReach, heldLine, publishSummary, publishedReach, publishedTitle, saveRequest, staffChoices,
} from '@/pages/features/calendarbuilder/builderLogic'
import { builderClosedLine } from '@/pages/features/shifts/houseCalTypes'
import { TEST_MODE_CELL, publishedLine } from '@/pages/features/shifts/publishedMark'

const root = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const CASES = JSON.parse(read('tests/spa/fixtures/builder-codes.json')) as [number, number, string][]
const noop = () => {}

describe('the code a time picker writes — the relay\'s own table of cases', () => {
  for (const [start, end, want] of CASES) {
    it(`${start} → ${end} is ${want}`, () => {
      assert.equal(codeOf(start, end), want)
    })
  }
  it('and every one of them reads back through the screen\'s copy of the estate\'s reader', () => {
    for (const [start, end, want] of CASES) {
      const got = timesOf(want)
      assert.ok(got, want)
      assert.equal(got.start, start % 24, want)
      assert.equal(spanHours(got.start, got.end), spanHours(start, end), want)
    }
  })
})

describe('a shift\'s times, as the pickers work them', () => {
  it('a decimal hour is a time input\'s value, an overnight end wrapped', () => {
    assert.equal(timeInputOf(21.5), '21:30')
    assert.equal(timeInputOf(31.5), '07:30')
    assert.equal(timeInputOf(null), '')
  })
  it('and back', () => {
    assert.equal(hourOfTimeInput('21:30'), 21.5)
    assert.equal(hourOfTimeInput(''), null)
    assert.equal(hourOfTimeInput('25:00'), null)
  })
  it('a range\'s length wraps midnight, and equal ends are a whole day', () => {
    assert.equal(spanHours(22, 8), 10)
    assert.equal(spanHours(8, 8), 24)
  })
  it('a cell that is not one plain range has no times to pick', () => {
    assert.equal(timesOf('OFF'), null)
    assert.equal(timesOf('BM > 8P-8A'), null)
    assert.deepEqual(timesOf('*8A-8P'), { start: 8, end: 20, star: true })
  })
  it('a running shift says how long it has gone', () => {
    assert.equal(runningFor('2026-09-23T08:00:00-04:00', Date.parse('2026-09-23T11:12:00-04:00')), '3h 12m')
    assert.equal(runningFor('2026-09-23T08:00:00-04:00', Date.parse('2026-09-23T07:00:00-04:00')), '')
  })
  it('"End now" is the nearest quarter hour on Ohio\'s clock, whatever the device says', () => {
    assert.equal(ohioHourNow(Date.parse('2026-09-23T14:07:00Z')), 10)
    assert.equal(ohioHourNow(Date.parse('2026-09-23T14:08:00Z')), 10.25)
  })
})

describe('the link to where a calendar is changed', () => {
  it('opens a house on a day, a person\'s cell when named', () => {
    assert.equal(builderLink('CAN - BM - BM4060', { day: '2026-09-30', employee: 'Ann Roe' }),
      `${BUILDER_PATH}?house=CAN%20-%20BM%20-%20BM4060&day=2026-09-30&employee=Ann%20Roe`)
    assert.equal(builderLink(''), BUILDER_PATH)
  })
  it('is the same path the relay\'s closed edit doors answer with', () => {
    assert.match(read('server/calendar_builder_houses.py'), /BUILDER_PATH = "\/app\/calendarbuilder\/builder"/)
  })
  it('is offered only where the App Access matrix opens the Builder page — else it is said in words', () => {
    const page = read('src/pages/features/calendarbuilder/LiveView.tsx')
    // the Builder page's own gate is asked, not only the app
    assert.match(page, /isAllowedWith\(apps, effRole, 'calendarbuilder', 'builder'\)/)
    assert.match(page, /mayEdit && builderOpen &&/)
    assert.match(page, /mayEdit && !builderOpen &&/)
    assert.match(page, /onEditInBuilder=\{builderOpen/)
    assert.match(builderClosedLine(), /not opened to your badge yet/)
    assert.match(builderClosedLine(), /App Control/)
  })
})

describe('what a publish and a call-off say they reach — what the code does', () => {
  it('a recorded publish reaches every screen and the reminders within a minute', () => {
    assert.match(publishedReach(true), /within a minute/)
    assert.doesNotMatch(publishedReach(true), /rest of the platform reads it from the workbook/)
    assert.match(publishedReach(undefined), /within a minute/)
  })
  it('a publish whose record failed says the platform sees it only on the next copy', () => {
    assert.match(publishedReach(false), /record could not be written/)
    assert.match(publishedReach(false), /next copy/)
  })
  it('Mark Call-Off is a full call-off: the tracker row, the URGENT OPEN SHIFT with no reason, the reason to the directors — the mock while test mode is on', () => {
    const line = callOffReach('3:00 PM')
    assert.match(line, /3:00 PM/)
    assert.match(line, /reminders stand down/)
    assert.match(line, /full call-off/)
    assert.match(line, /Call Off Tracker row/)
    assert.match(line, /URGENT OPEN SHIFT to all staff \(never the reason\)/)
    assert.match(line, /directors' group alone/)
    assert.match(line, /test mode/)
    assert.doesNotMatch(line, /Nobody is texted/)
  })
  it('at the press the rest of the call-off is owed, so the toast never says it was filed or sent', () => {
    const owed = callOffReach('3:00 PM', 'owed')
    assert.match(owed, /being filed/)
    assert.match(owed, /on Requests/)
    assert.doesNotMatch(owed, /was filed|It is filed/)
    assert.equal(callOffReach('3:00 PM'), owed)
    assert.match(callOffReach('3:00 PM', 'told'), /was filed as a full call-off/)
  })
  it('a publish test mode held says the workbook was NOT written, and where the cells wait', () => {
    assert.match(publishedReach(true, true), /workbook was NOT written/)
    assert.match(publishedReach(true, true), /Published in test mode/)
    assert.match(publishedTitle({ written: 2, test_mode: true }, 'CAN - BM - BM4060'), /^Recorded in test mode — 2 cells/)
    assert.doesNotMatch(publishedTitle({ written: 2, test_mode: true }, 'X'), /written to X/)
    assert.equal(publishedTitle({ written: 1 }, 'X'), 'Published — 1 cell written to X')
  })
  it('a held cell says what it would be and what the workbook still says', () => {
    assert.equal(heldLine({ employee: 'Ann Roe', value: '8A-4P', base: '' }, 'Thu 9/24'),
                 'Ann Roe · Thu 9/24: 8A-4P (the workbook still says nothing)')
  })
  it('the cell a reader sees says test mode, in one sentence everywhere', () => {
    const line = publishedLine({ at: '2026-09-24T13:00:00Z', by: 'Hana Boss', via: 'publish', state: 'test_mode' },
                               new Date('2026-09-24T14:00:00Z'))
    assert.match(line ?? '', /^Test mode — not written to the workbook: published on Calendar Builder at/)
    assert.equal(TEST_MODE_CELL, 'test mode — not written to the workbook')
    // the grid's titles come from the one cellTitle, which says it
    assert.match(read('src/pages/features/shifts/houseCalTypes.ts'), /c\.test_mode \?.*TEST_MODE_CELL/)
    assert.match(read('src/pages/features/shifts/HouseGrid.tsx'), /title=\{cellTitle\(/)
  })
})

describe('the Builder a house manager gets — their houses, never the whole estate', () => {
  // offering is calendar-builder-screens.test.tsx's; reading is held here
  it('the estate\'s slices are read only once the relay says the reader edits every house', () => {
    const page = read('src/pages/features/calendarbuilder/CalendarBuilderPage.tsx')
    const before = page.slice(0, page.indexOf('function EstateTables'))
    assert.doesNotMatch(before.replace(/^\s*(\/\/|\*).*$/gm, ''), /useCalendarData\(/)
    const gate = page.slice(page.indexOf('function useEditsEveryHouse'), page.indexOf('function EstateTables'))
    assert.match(gate, /houseLane\.houses\(\)/)
    assert.match(gate, /edits_every_house/)
    assert.match(gate, /if \(answer === null\)/)
    assert.match(gate, /if \(!answer\.every\)/)
    assert.match(gate, /<EstateTables pageId=\{pageId\} \/>/)
  })
  it('a failed read of that answer is said as a failure with Refresh, never as "builds one by one"', () => {
    const page = read('src/pages/features/calendarbuilder/CalendarBuilderPage.tsx')
    const gate = page.slice(page.indexOf('function useEditsEveryHouse'), page.indexOf('function EstateTables'))
    assert.match(gate, /\.catch\(\(e: unknown\) => \{\s*if \(live\) setGot\(\{ tick, answer: \{ error:/)
    assert.doesNotMatch(gate, /\.catch\([^)]*\) => \{[^}]*every: false/)
    assert.match(gate, /return got\.tick === tick \? got\.answer : null/)
    assert.match(gate, /if \('error' in answer\)/)
    assert.match(gate, /Could not ask the relay whether this account edits every house/)
    assert.match(gate, /\}, \[tick\]\)/)
    assert.ok(gate.indexOf("if ('error' in answer)") < gate.indexOf('if (!answer.every)'))
  })
  it('the Builder lists what test mode held, with Publish now closed while it holds', () => {
    const house = read('src/pages/features/calendarbuilder/BuilderView.tsx')
    assert.match(house, /Published in test mode, not in the workbook/)
    assert.match(house, /disabled=\{saving \|\| Boolean\(grid\.test_mode\?\.on\)\}/)
    assert.match(house, /houseLane\.heldPublish\(grid\.location\)/)
    assert.match(house, /houseLane\.heldDiscard\(grid\.location\)/)
    assert.doesNotMatch(house, /window\.confirm/)
  })
})

describe('where a Save goes', () => {
  const LOC = 'CAN - BM - BM4060'
  const at = { employee: 'Ann Roe', colIso: '2026-09-30' }
  it('a changed code on the same cell drafts that one cell', () => {
    assert.deepEqual(saveRequest(LOC, at, true, { employee: 'Ann Roe', colIso: '2026-09-30', value: '8A-2P', note: '' }),
      { door: 'cell', body: { location: LOC, employee: 'Ann Roe', col_iso: '2026-09-30', value: '8A-2P', note: '', via: 'cell' } })
  })
  it('the pickers travel as times, and the star the cell had rides along', () => {
    const got = saveRequest(LOC, at, true, { employee: 'Ann Roe', colIso: '2026-09-30', start: '21:30', end: '07:30', keepStar: true, note: 'n' })
    assert.equal(got.door, 'cell')
    assert.deepEqual(got.body, { location: LOC, employee: 'Ann Roe', col_iso: '2026-09-30', start: '21:30', end: '07:30', keep_star: true, note: 'n', via: 'times' })
  })
  it('a shift saved onto another person or day is ONE move, carrying its new times', () => {
    const got = saveRequest(LOC, at, true, { employee: 'Ben Left', colIso: '2026-10-01', start: '08:00', end: '16:00', note: '' })
    assert.deepEqual(got, { door: 'move', body: { location: LOC, from: { employee: 'Ann Roe', col_iso: '2026-09-30' },
      to: { employee: 'Ben Left', col_iso: '2026-10-01' }, start: '08:00', end: '16:00', note: '' } })
  })
  it('an empty cell is an ADD — to its own person, or to the person picked for it', () => {
    const own = saveRequest(LOC, at, false, { employee: 'Ann Roe', colIso: '2026-09-30', value: '8A-4P', note: '' })
    assert.equal(own.door === 'cell' ? own.body.via : '', 'add')
    const other = saveRequest(LOC, at, false, { employee: 'Zoe New', colIso: '2026-09-30', value: '8A-4P', note: '' })
    assert.equal(other.door, 'cell')
    assert.equal((other.body as { employee: string }).employee, 'Zoe New')
  })
})

describe('who may be picked for a cell', () => {
  const rows: Row[] = [
    { employee: 'OPEN', cells: [], open_row: true },
    { employee: 'OPEN · call-off', cells: [], open_row: true, call_off_row: true },
    { employee: 'Ben Left', cells: [] },
    { employee: 'Ann Roe', cells: [] },
  ]
  it('the house\'s own people first, never an OPEN row or the call-off line, then the directory', () => {
    assert.deepEqual(staffChoices(rows, ['Zoe New', 'ann  roe', 'Cy Far']), ['Ben Left', 'Ann Roe', 'Cy Far', 'Zoe New'])
  })
})

describe('what a publish is about to do', () => {
  const drafts: DraftEntry[] = [
    { employee: 'Ann Roe', col_iso: '2026-09-30', value: '8A-2P', base: '8A-4P', note: '', by: 'Hana', at: '', ist: '' },
    { employee: 'Zoe New', col_iso: '2026-10-01', value: '8A-4P', base: '', note: '', by: 'Hana', at: '', ist: 'no IST for BM' },
    { employee: 'OPEN', col_iso: '2026-10-01', value: '8P-8A', base: '', note: '', by: 'Hana', at: '', ist: '' },
  ]
  const rows: Row[] = [{ employee: 'Ann Roe', cells: [] }, { employee: 'Zoe New', cells: [], draft_row: true }]
  it('counts the cells, the people, the new rows and the trainings taken on', () => {
    assert.deepEqual(publishSummary(drafts, rows), { cells: 3, people: 2, newPeople: ['Zoe New'], trainings: 1 })
  })
})

// framer-motion measures the window
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

const DAYS = [{ iso: '2026-09-23', label: 'WED Sep 23' }, { iso: '2026-09-24', label: 'THU Sep 24' }]
const running: CellFact = {
  employee: 'Ann Roe', col_iso: '2026-09-23', raw: '8A-8P', kind: 'day', code: '8A-8P', start: 8, end: 20,
  token: null, hours: 12, overnight: false, edited: false, state: 'in_progress',
  starts_at: '2026-09-23T08:00:00-04:00', ends_at: '2026-09-23T20:00:00-04:00',
}

function editor(over: Partial<Parameters<typeof ShiftEditor>[0]> = {}): string {
  return renderToString(
    <ShiftEditor
      employee="Ann Roe" colIso="2026-09-23" text="8A-8P" fact={running} days={DAYS}
      staff={['Ann Roe', 'Ben Left']} openRow={false} locked="" saving={false}
      history={[]} historyFailed="" weekHere={36} weekAll={44} overLine={40}
      nowMs={Date.parse('2026-09-23T11:12:00-04:00')}
      onSave={noop} onRequestOff={noop} onDelete={noop} onUndo={noop}
      {...over}
    />,
  ).replace(/<!-- -->/g, '')
}

describe('the editor, on a shift that is running now', () => {
  const html = () => editor()
  it('says it is running, since when, how long, and when it ends', () => {
    assert.match(html(), /Running now — started 8:00 AM, 3h 12m so far, ends 8:00 PM/)
  })
  it('its start has happened: the start picker, the person and the day are not moved', () => {
    assert.match(html(), /type="time" disabled=""[^>]*value="08:00"|value="08:00"[^>]*disabled=""/)
    assert.match(html(), /End now/)
  })
  it('offers Save, Request Off, Delete and Undo, and says they are drafts', () => {
    for (const label of ['Save', 'Request Off', 'Delete', 'Undo']) assert.match(html(), new RegExp(label))
    assert.match(html(), /nothing reaches the house&#x27;s calendar until you publish the house/)
  })
  it('Mark Call-Off is not among the draft\'s buttons: it is live, in the panel\'s own box below them', () => {
    assert.doesNotMatch(html(), /Mark Call-Off|Mark call-off/)
    assert.doesNotMatch(read('src/pages/features/shifts/ShiftEditor.tsx'), /onCallOff|callOffConfirmBody/)
  })
  it('says a day of time off before a shift is saved onto it; an asked day is not a scheduled one', () => {
    assert.match(editor({ timeOff: 'scheduled' }), /Ann Roe has time off on the roster this day: a shift here is a conflict with it\./)
    assert.match(editor({ timeOff: 'asked' }), /Ann Roe asked for this day off; it is not on the roster yet\./)
    assert.doesNotMatch(editor(), /time off on the roster|asked for this day off/)
  })
  it('shows the change before it is made — the hours and the week at every house', () => {
    assert.match(html(), /8:00 AM – 8:00 PM/)
    assert.match(html(), /44h at every house — past 40h/)
  })
})

describe('the editor, on a draft and on an empty cell', () => {
  it('a drafted cell says what the workbook holds until the house is published, and a missing IST', () => {
    const html = editor({ fact: { ...running, state: 'upcoming' },
      draft: { base: '8A-4P', note: 'swap', by: 'Hana Boss', at: '', ist: 'no IST for BM on record' } })
    assert.match(html, /the workbook says <span class="font-semibold">8A-4P<\/span> here/)
    assert.match(html, /no IST for BM on record\. Publishing takes the training on as your approval, and only while whoever trains is free then/)
    assert.doesNotMatch(html, /Mark Call-Off<\/button>/, 'a draft is published or undone before a call-off is marked')
  })
  it('an empty cell is an Add, with nothing to delete, request off or call off', () => {
    const html = editor({ text: '', fact: undefined })
    assert.match(html, /Add shift/)
    assert.doesNotMatch(html, /(Request Off|Mark Call-Off|Delete)<\/button>/)
  })
  it('a cell that may not be edited here says why, and offers nothing', () => {
    const html = editor({ locked: 'An open shift the calendar holds is not typed over.' })
    assert.match(html, /not typed over/)
    assert.doesNotMatch(html, /Save|Undo/)
  })
})

describe('the cell\'s history', () => {
  const rows: HistoryEntry[] = [
    { id: 3, was: '8A-4P', now: '8A-2P', via: 'publish', by: 'Hana Boss', at: '2026-09-23T14:00:00Z', stage: 'published', note: 'covering', undone: false },
    { id: 2, was: '', now: '8A-4P', via: 'decision:assigned', by: 'Hana Boss', at: '2026-09-22T14:00:00Z', stage: 'published', note: '', undone: false },
    { id: 1, was: '8A-4P', now: '8A-4P', via: 'call_off', by: 'Rita Lead', at: '2026-09-21T14:00:00Z', stage: 'call_off', note: 'sick', undone: false },
    { id: 0, was: '8A-4P', now: '', via: 'delete', by: 'Hana Boss', at: '2026-09-20T14:00:00Z', stage: 'draft', note: '', undone: true },
  ]
  it('names each change in words, with who, when and the note', () => {
    const html = editor({ history: rows })
    assert.match(html, /Published<\/span> 8A-4P → 8A-2P/)
    assert.match(html, /Given by the house manager/)
    assert.match(html, /Called off/)
    assert.match(html, /“covering”/)
    assert.match(html, /line-through/)
  })
  it('a history that could not be read says so, and is never "nothing changed"', () => {
    const html = editor({ history: [], historyFailed: 'relay down' })
    assert.match(html, /could not be read \(relay down\)/)
    assert.doesNotMatch(html, /Nothing has changed this cell/)
  })
})

describe('the shared panel, on the Builder', () => {
  const computed: Computed = {
    cells: {}, people: [{ employee: 'Ann Roe', hours: 36, shifts: 3, off: 0, elsewhere: 0, by_week: { '2026-09-19': 36 }, conflicts: [] }],
    days: [], conflicts: [], open_shifts: [],
    window: { first: '2026-09-19', last: '2026-10-02', days: 14, covers_today: true, today: '2026-09-23' },
    weekly_ot_hours: 40, totals: { hours: 36, shifts: 3, people: 1, open: 0 },
  }
  const panel = (over: Partial<Parameters<typeof ShiftCellPanel>[0]> = {}) => renderToString(
    <ShiftCellPanel
      target={{ employee: 'Ann Roe', colIso: '2026-09-23', label: 'Wed 9/23' }}
      house="CAN - BM - BM4060" text="8A-8P" fact={running} computed={computed} saving={false}
      staff={['Ann Roe', 'Ben Left']} mayEdit openRow={false} me="Hana Boss" mode="builder"
      estateWeek={44} editor={<p>THE EDITOR</p>}
      onClaim={noop} onOpenRequests={noop} onClose={noop}
      {...over}
    />,
  ).replace(/<!-- -->/g, '')
  it('hosts the editor where the cell is changed, and offers no swap', () => {
    const html = panel()
    assert.match(html, /THE EDITOR/)
    assert.doesNotMatch(html, /Transfer this shift/)
    assert.doesNotMatch(html, /Edit in Calendar Builder/)
  })
  it('shows the person\'s week at every house beside this one', () => {
    assert.match(panel(), /Every house/)
    assert.match(panel(), /44h/)
  })
  it('an open shift is pointed back at Live, where it is given', () => {
    const open: OpenShift = {
      key: 'OPEN|2026-09-23', location: 'CAN - BM - BM4060', open_row: 'OPEN', col_iso: '2026-09-23', raw: '8P-8A',
      code: '8P-8A', start: 20, end: 32, hours: 12, kind: 'overnight', overnight: true,
      claimed_by: null, claimed_via: null, claimed_at: null,
    }
    const html = panel({ openShift: open, openRow: true, onOpenLive: noop,
                         target: { employee: 'OPEN', colIso: '2026-09-23', label: 'Wed 9/23' } })
    assert.match(html, /Applied for and given in Live/)
    assert.match(html, /Open it in Live/)
    assert.doesNotMatch(html, /Assign this shift|Apply for this shift/)
  })
  it('Mark call-off is the panel\'s one live act, in its own "Live now" box BELOW the draft\'s buttons', () => {
    const html = panel({ onCallOff: noop, fact: { ...running, state: 'upcoming' } })
    assert.match(html, /aria-label="Live now"/)
    assert.match(html, /A call-off is not a draft: it happens the moment you confirm/)
    assert.ok(html.indexOf('THE EDITOR') < html.indexOf('aria-label="Live now"'), 'the live box sits after the editor')
    assert.match(html, /LIVE: happens now/)
  })
  it('a draft is published or undone before a call-off is marked; a past shift, an empty cell or a reader who does not edit get none', () => {
    const at = { onCallOff: noop, fact: { ...running, state: 'upcoming' as const } }
    assert.doesNotMatch(panel({ ...at, drafted: true }), /aria-label="Live now"/)
    assert.doesNotMatch(panel({ ...at, fact: { ...running, state: 'past' } }), /aria-label="Live now"/)
    assert.doesNotMatch(panel({ ...at, fact: undefined, text: '' }), /aria-label="Live now"/)
    assert.doesNotMatch(panel({ ...at, mayEdit: false }), /aria-label="Live now"/)
  })
  it('a transfer waiting on the shift is answered in Live first; unread transfers are said, never read as none', () => {
    const h = { id: 'H1', state: 'pending', col_iso: '2026-09-23', from_staff: 'Ann Roe', to_staff: 'Ben Left', value: '8A-8P' }
    const html = panel({ transferWaiting: h as never, onOpenLive: noop })
    assert.match(html, /A transfer is waiting on this shift: answer it in Live first\./)
    assert.match(html, /Ann Roe offers 8A-8P to Ben Left/)
    assert.match(html, /Open it in Live/)
    assert.match(panel({ transfersWhy: 'the relay answered 502' }),
      /The transfers waiting here could not be read \(the relay answered 502\) — this is not saying none are waiting\./)
  })
})

describe('as source — the Builder reads the relay\'s answer, and House Calendars edits nothing', () => {
  const builder = read('src/pages/features/calendarbuilder/BuilderView.tsx')
  const tab = read('src/pages/features/calendarbuilder/MasterGrid.tsx')
  const lane = read('src/pages/features/calendarbuilder/useHouseBuilderLane.ts')
  const page = read('src/pages/features/calendarbuilder/LiveView.tsx')
  it('nothing on the Builder decides who edits from the role', () => {
    for (const src of [builder, tab]) {
      assert.doesNotMatch(src, /role === 'admin'|role === 'manager'|useAuthStore\(\(s\) => s\.user\?\.role/)
    }
  })
  it('the house editor talks only to the Builder\'s house doors', () => {
    for (const door of ['/houses', '/house?location=', '/staff', '/house-history', '/house/cell', '/house/move',
      '/house/request-off', '/house/call-off', '/house/undo', '/house/discard', '/house/publish']) {
      assert.ok(lane.includes(door), door)
    }
  })
  it('the master grid is offered only when the relay says the reader edits every house', () => {
    // the rail's "All houses" entry, and `house=all` itself, answer to the relay's edits_every_house
    assert.match(builder, /const masterEntry = info\?\.edits_every_house \?/)
    assert.match(builder, /if \(info\.edits_every_house\) \{\s*if \(current !== MASTER_HOUSE\) openMaster\(\)/)
    assert.match(builder, /edits_every_house: d\.edits_every_house/)
    // there is no second switch: the master is a rail entry, not a tab
    assert.doesNotMatch(tab, /SegmentedTabs|export default function BuilderTab/)
  })
  it('a refused publish shows its cells and keeps the draft', () => {
    assert.match(builder, /Nothing was written\. The draft is kept/)
    assert.match(builder, /Array\.isArray\(err\.data\.blocked\)/)
  })
  it('House Calendars posts to no editing door and draws the shared grid read-only', () => {
    assert.doesNotMatch(page, /housecal\/cell|housecal\/move/)
    assert.match(page, /<HouseGrid grid=\{grid\} clock=\{clock\} mode="operations"/)
    assert.doesNotMatch(page, /canDrag/)
  })
  it('no browser dialogs on the Builder', () => {
    for (const src of [builder, tab, read('src/pages/features/shifts/ShiftEditor.tsx')]) {
      assert.doesNotMatch(src, /window\.(confirm|alert|prompt)/)
    }
  })
})
