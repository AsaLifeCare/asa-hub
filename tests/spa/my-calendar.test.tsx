/**
 * MY CALENDAR · Week: the manifest, the week and the requests drawn whole, the right panel, the reads and the
 * writes through the Time Off doors.
 *
 * Whose calendar it is is the relay's decision; the screen is held to what it promises with it — "No shifts"
 * only for a day a calendar shows empty, an overnight on the day it starts in Eastern Time, the chooser only
 * for a mass answer, a greyed pencil or trash that carries the relay's own reason, Add always drawn and filing
 * FOR a chosen person under the relay's own spelling of them, nothing written from a switched session, an
 * approved request's new dates warned before they are saved, a change of dates that never loses a withdrawal,
 * and a panel on the right that is not a dialog.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeAllowsApp } from '@/lib/badgeAccess'
import { useMemberStore } from '@/stores/useMemberStore'
import { myCalendarManifests } from '@/registry/apps-mycalendar'
import { appManifests } from '@/registry/apps'
import SidePanel, { PanelScrim, usePanelEscape } from '@/components/shared/SidePanel'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import {
  ACTING_SENTENCE, CONCLUDED_SHOWN, DAY_WORDS, NO_FILE_FOR, TEST_MODE_FILE, addFor, checkPath, choiceAfter, dayHead, dayLine,
  fileBody, fileFor, filedForLine, figureLine, groupsOf, hoursLine, markLines, mondayOf, myCalendarPath, onRecordNote, orphanLine,
  overnightLine, rangeWords, rowActs, spanLine, testModeLine, waitingWords, weekAfter, weekShift, whoseDays,
  type Day, type DayState, type MyCalendarView, type PanelAsk, type RequestMay, type RequestRow, type ShiftCard,
} from '@/pages/features/mycalendar/myCalendarModel'
import {
  CalendarPanel, MyCalendarScreen, PersonBar, VISIT_SENTENCE, VisitNotice, useMyCalendarPage,
} from '@/pages/features/mycalendar/MyCalendarPage'
import WeekCard from '@/pages/features/mycalendar/WeekCard'
import RequestsCard from '@/pages/features/mycalendar/RequestsCard'
import ShiftBody from '@/pages/features/mycalendar/ShiftPanel'
import {
  MY_CALENDAR_IDLE, changeDates, checkDates, fileAdd, forgetHeld, previewAdd, useMyCalendar, withdrawRequest,
  type MyCalendarState,
} from '@/pages/features/mycalendar/useMyCalendar'
import { mountHook } from './react-host'
import { SHELL_HIDDEN, primeShellHides } from '@/lib/myWorkHides'

// the screens below draw their test mode warnings, as Settings › My Work shows them when the switch says so
primeShellHides({ ...SHELL_HIDDEN, test_mode_warnings: false })

// the window's own listeners, kept so a test can press a key
const listeners = new Map<string, Set<(e: unknown) => void>>()
Object.defineProperty(globalThis, 'addEventListener', {
  value: (type: string, fn: (e: unknown) => void) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type))?.add(fn) },
  configurable: true, writable: true,
})
Object.defineProperty(globalThis, 'removeEventListener', {
  value: (type: string, fn: (e: unknown) => void) => { listeners.get(type)?.delete(fn) },
  configurable: true, writable: true,
})

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const FEATURE = 'src/pages/features/mycalendar'
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: React.ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
const noop = () => {}

const EDIT_STARTED = 'It has started, so its dates are not changed here.'
const EDIT_WARNS = 'Changing the dates sends this request for approval again; both approvals start over. OPEN or R/O squares ' +
  'already staged on the house calendar stay until the house manager changes them.'
const WARNS = 'Both approvals are dropped. OPEN or R/O squares already staged on the house calendar stay until the house manager changes them.'
const WITHDRAW_STARTED = 'It has started. Only a director or an administrator cancels it, in Time Off.'
const NOT_YOURS = 'Only the person or whoever filed it changes it; a director cancels an approved one in Time Off.'

function card(over: Partial<ShiftCard> = {}): ShiftCard {
  return {
    id: 'OD:2026-09-24:0', iso: '2026-09-24', kind: 'overnight', house: 'Orchard Dale', house_name: 'Orchard Dale Home', code: 'OD',
    address: '12 Orchard Dale Rd, Canton, OH 44709', shift_code: '11P-7A',
    shift_start: '2026-09-24T23:00:00-04:00', shift_end: '2026-09-25T07:00:00-04:00',
    hours: 8, hours_known: true, overnight: true, manager: 'Hanna Hale', managers: ['Hanna Hale'], managers_readable: true,
    also: [], marks: [], ...over,
  }
}

const day = (iso: string, state: DayState, over: Partial<Day> = {}): Day => ({ iso, state, why: '', cards: [], off: null, notes: [], ...over })

const WEEK: Day[] = [
  day('2026-09-21', 'none'),
  day('2026-09-22', 'shifts', { cards: [card({ id: 'MD:2026-09-22:0', iso: '2026-09-22', kind: 'day', house: 'Meadowlane', house_name: 'Meadowlane Home',
    code: 'MD', shift_code: '7A-3P', shift_start: '2026-09-22T07:00:00-04:00', shift_end: '2026-09-22T15:00:00-04:00', overnight: false })] }),
  day('2026-09-23', 'none'),
  day('2026-09-24', 'shifts', { cards: [card()] }),
  day('2026-09-25', 'none'),
  day('2026-09-26', 'off'),
  day('2026-09-27', 'shifts', { cards: [card({ id: '49:2026-09-27:0', iso: '2026-09-27', kind: 'day', house: '49th St', house_name: '',
    code: '49', shift_code: '7A-3P', shift_start: '2026-09-27T07:00:00-04:00', shift_end: '2026-09-27T15:00:00-04:00', overnight: false })] }),
]

const may = (over: Partial<RequestMay> = {}): RequestMay =>
  ({ withdraw: true, withdraw_why: '', withdraw_warns: '', edit: true, edit_why: '', ...over })

function req(ref: string, over: Partial<RequestRow> = {}): RequestRow {
  return {
    ref, status: 'pending', word: 'Waiting', group: 'pending', start: '2026-12-21', end: '2026-12-23', days: 3,
    houses: [{ code: 'OD', label: 'Orchard Dale' }], status_why: 'Waiting on the house manager and a director',
    filed_by_other: false, test_mode: false,
    details: [{ label: 'Dates', value: 'Mon 12/21 – Wed 12/23' }, { label: 'Filed by', value: 'Maya Chen' }],
    may: may(), ...over,
  }
}

const APPROVED = req('TO00000000A1', { status: 'scheduled', word: 'Approved', group: 'upcoming', start: '2026-10-15', end: '2026-10-19',
  days: 5, may: may({ withdraw_warns: WARNS, edit_warns: EDIT_WARNS }) })
const PENDING = req('TO00000000B2')
const ON_NOW = req('TO00000000C3', { status: 'scheduled', word: 'On now', group: 'ongoing', start: '2026-09-25', end: '2026-09-29', days: 5,
  may: may({ withdraw: false, withdraw_why: WITHDRAW_STARTED, edit: false, edit_why: EDIT_STARTED }) })

/** The master's own session on Bob Bee's calendar: Add files for him; only a row the master filed is the master's to change. */
function bobView(over: Partial<MyCalendarView['form']> = {}, rows?: RequestRow[]): MyCalendarView {
  return view({
    scope: { mode: 'mass', why: '', person: 'PPL_BOB', people: [{ key: 'PPL_BOB', name: 'Bob Bee', status: 'Active' }], people_why: '' },
    person: { own: false, name: 'Bob Bee', key_why: '' },
    form: { ...view().form, earliest: '', file_for: 'Bob Bee', ...over },
    requests: { ...view().requests, rows: rows ?? [
      { ...PENDING, may: may({ withdraw: false, withdraw_why: NOT_YOURS, edit: false, edit_why: NOT_YOURS }) },
      { ...APPROVED, filed_by_other: true },
    ] },
  })
}

function view(over: Partial<MyCalendarView> = {}): MyCalendarView {
  return {
    scope: { mode: 'own', why: '', person: '' },
    person: { own: true, name: 'Maya Chen', key_why: '' },
    today: '2026-09-27',
    week: {
      from: '2026-09-21', to: '2026-09-27', this: '2026-09-21', prev: '2026-09-14', next: '2026-09-28',
      head: { state: 'ready', why: '', copied_at: '2026-09-27T13:14:00Z', stale: false, stale_why: '' }, days: WEEK, notes: [],
    },
    requests: { state: 'ready', why: '', rows: [PENDING, APPROVED], figure: { year: 2026, approved_days: 5, waiting_days: 3, on_record_days: 0 }, as_of: '' },
    form: { may_file: true, may_file_why: '', reason_max: 500, max_days: 120, earliest: '2026-09-27' },
    test_mode: { on: true, readable: true, why: '' },
    read_at: '2026-09-27T13:20:00Z',
    ...over,
  }
}

const ready = (v: MyCalendarView): MyCalendarState => ({ ...MY_CALENDAR_IDLE, status: 'ready', data: v, readAt: Date.parse('2026-09-27T13:20:00Z') })
const screen = (s: MyCalendarState, extra: { backdrop?: MyCalendarView | null; acting?: boolean; person?: string } = {}) =>
  draw(<MyCalendarScreen state={s} backdrop={extra.backdrop ?? null} person={extra.person ?? ''} week="" acting={extra.acting ?? false}
    onPerson={noop} onWeek={noop} onRetry={noop} onOpen={noop} />)
const weekCard = (v: MyCalendarView) => draw(<WeekCard week={v.week} title="My Week" asked="" today={v.today} reading={false} failed=""
  refs={new Set(v.requests.rows.map((r) => r.ref))} onWeek={noop} onOpen={noop} onRetry={noop} />)
const panel = (ask: PanelAsk, v: MyCalendarView = view(), acting = false) =>
  draw(<CalendarPanel ask={ask} view={v} acting={acting} onAsk={noop} onClose={noop} onChanged={noop} />)
/** The text of the column a day draws. */
const column = (html: string, iso: string) => {
  const at = html.indexOf(`data-day="${iso}"`)
  const next = html.indexOf('data-day="', at + 10)
  return html.slice(at, next === -1 ? undefined : next)
}
const featureFiles = () => readdirSync(resolve(ROOT, FEATURE)).map((n) => join(FEATURE, n))

describe('the app', () => {
  it('is "My Calendar", id my-calendar, one page "week", in Workspace, open to the client role, with a staff focus', () => {
    const app = myCalendarManifests[0]
    assert.equal(app.id, 'my-calendar')
    assert.equal(app.name, 'My Calendar')
    assert.equal(app.category, 'Workspace')
    assert.deepEqual(app.pages.map((p) => [p.id, p.title]), [['week', 'Week']])
    assert.deepEqual(app.focusAudience, ['staff'])
    assert.deepEqual(app.audience, ['admin', 'manager', 'staff', 'client'])
    assert.equal(appManifests.filter((m) => m.id === 'my-calendar').length, 1)
  })

  it('ships no App Control row: staff with an empty matrix cannot open it, nor an admin whose badge is on another app\'s row; the master can', () => {
    const staff = { role: 'staff', types: ['STAFF'], isMaster: false }
    assert.equal(badgeAllowsApp('my-calendar', staff, {}), false)
    assert.equal(badgeAllowsApp('my-calendar', { ...staff, role: 'admin', types: ['ADMIN'] }, { timeoff: ['ADMIN'] }), false)
    assert.equal(badgeAllowsApp('my-calendar', { role: 'admin', types: [], isMaster: true }, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools', 'server']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(name) || name === 'test-my-calendar.py') continue
        const text = readFileSync(join(resolve(ROOT, dir), name), 'utf8')
        if (/app_badge_access[^\n]{0,200}my-calendar|my-calendar[^\n]{0,200}app_badge_access/.test(text)) hits.push(name)
      }
    }
    assert.deepEqual(hits, [])
  })

  it('routes its page to the one screen', () => {
    const routes = readFileSync(resolve(ROOT, 'src/pages/AppRoutePage.tsx'), 'utf8')
    assert.match(routes, /'my-calendar\/week': MyCalendarPage/)
  })
})

describe('the model', () => {
  it('"No shifts" is said only for a day a calendar shows empty; every other state says its own words', () => {
    const states: DayState[] = ['shifts', 'off', 'none', 'not_drawn', 'not_listed', 'unreadable']
    for (const s of states) {
      const line = dayLine({ state: s, why: s === 'none' || s === 'off' ? '' : `why ${s}` })
      assert.equal(line === 'No shifts', s === 'none', `${s} → ${line}`)
    }
    assert.equal(DAY_WORDS.none, 'No shifts')
    assert.equal(DAY_WORDS.off, 'Off')
    assert.equal(dayLine({ state: 'not_drawn', why: 'No house calendar that lists you shows this day yet.' }), 'No house calendar that lists you shows this day yet.')
    assert.equal(dayLine({ state: 'not_listed', why: '' }), 'Not on any house calendar.')
    assert.equal(dayLine({ state: 'something new', why: '' }), 'This day could not be read.')
    assert.equal(dayLine({ state: 'shifts', why: '' }), '')
  })

  it('weeks move by whole weeks across the clock change and the year end, and snap to Monday', () => {
    assert.equal(weekShift('2026-10-26', 1), '2026-11-02')
    assert.equal(weekShift('2026-11-02', -1), '2026-10-26')
    assert.equal(weekShift('2026-12-28', 1), '2027-01-04')
    assert.equal(weekShift('2027-01-04', -1), '2026-12-28')
    assert.equal(mondayOf('2026-09-27'), '2026-09-21')
    assert.equal(mondayOf('2026-11-01'), '2026-10-26')
    assert.equal(mondayOf('2027-01-01'), '2026-12-28')
    assert.equal(weekShift('2026-02-30', 1), '')
    assert.equal(weekShift('9/21/2026', 1), '')
  })

  it('a calendar day is read as itself in Ohio, whatever the clock', () => {
    assert.equal(dayHead('2026-09-21'), 'Sep 21, 2026')
    assert.equal(dayHead('2026-11-01'), 'Nov 1, 2026')
    assert.equal(dayHead('2027-01-01'), 'Jan 1, 2027')
    assert.equal(dayHead(''), '')
    assert.equal(rangeWords('2026-09-21', '2026-09-27'), 'Sep 21, 2026 – Sep 27, 2026')
    assert.equal(rangeWords('2026-09-21', '2026-09-21'), 'Sep 21, 2026')
  })

  it('an overnight is spoken from the day it starts to the morning it ends, in Eastern Time', () => {
    assert.equal(spanLine(card()), 'Sep 24, 2026 · 11:00 PM – Sep 25, 2026 · 7:00 AM · Eastern Time')
    assert.equal(overnightLine(card()), 'Overnight coverage 11:00 PM – 7:00 AM (shown on the day it starts).')
    const dayShift = card({ shift_start: '2026-09-22T07:00:00-04:00', shift_end: '2026-09-22T15:00:00-04:00', overnight: false })
    assert.equal(spanLine(dayShift), 'Sep 22, 2026 · 7:00 AM – 3:00 PM · Eastern Time')
    assert.equal(overnightLine(dayShift), '')
    // the fall-back night: nine real hours, the wall clock still reads 11 to 7
    const fallBack = card({ iso: '2026-10-31', shift_start: '2026-10-31T23:00:00-04:00', shift_end: '2026-11-01T07:00:00-05:00', hours: 9 })
    assert.equal(spanLine(fallBack), 'Oct 31, 2026 · 11:00 PM – Nov 1, 2026 · 7:00 AM · Eastern Time')
    assert.equal(hoursLine(fallBack), '9 hours')
    const noHours = card({ kind: 'alias', shift_code: 'ADMIN', shift_start: '', shift_end: '', hours: null, hours_known: false, overnight: false })
    assert.equal(spanLine(noHours), 'Sep 24, 2026 · Hours not written on the calendar')
    assert.equal(hoursLine(noHours), 'Hours not written on the calendar')
  })

  it('no bare day is ever handed to the Date parser, anywhere in the app or its panel', () => {
    for (const file of [...featureFiles(), 'src/components/shared/SidePanel.tsx']) {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      assert.doesNotMatch(text, /new Date\(\s*['"`]/, file)
      assert.doesNotMatch(text, /new Date\(\s*`\$\{/, file)
      assert.doesNotMatch(text, /Date\.parse\(\s*[a-z]+\s*\)/i, file)
    }
  })

  it('no browser dialog and no modal: no window.confirm, no Dialog or Sheet import, no aria-modal', () => {
    for (const file of [...featureFiles(), 'src/components/shared/SidePanel.tsx']) {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(/, file)
      assert.doesNotMatch(text, /import[^;]*\b\w*(Dialog|Sheet)\b[^;]*from/, file)
      assert.doesNotMatch(text, /from '[^']*(dialog|sheet)[^']*'/i, file)
      assert.doesNotMatch(text, /aria-modal|role="dialog"/, file)
    }
  })

  it('the requests fall into Pending, On now, Approved and Concluded, in that order', () => {
    const old = (n: number) => req(`TO0000000${n}D0`, { status: 'denied', word: 'Denied', group: 'concluded', may: may({ withdraw: false, edit: false }) })
    const groups = groupsOf([APPROVED, old(1), PENDING, ON_NOW, req('TO00000000E5', { group: 'someday' })])
    assert.deepEqual(groups.map((g) => g.group), ['pending', 'ongoing', 'upcoming', 'concluded'])
    assert.deepEqual(groups[3].rows.map((r) => r.ref), ['TO00000001D0', 'TO00000000E5'], 'a group the screen does not know is still listed')
  })

  it('the figure counts approved days in the year, with the waiting ones beside it and no allowance', () => {
    const f = { year: 2026, approved_days: 12, waiting_days: 3, on_record_days: 4 }
    assert.equal(figureLine(f), 'Days off approved · 2026: 12')
    assert.equal(waitingWords(f), '+ 3 waiting')
    assert.equal(onRecordNote(f), '4 days on record from the earlier time off form are not counted here.')
    assert.equal(figureLine(null), '', 'a figure not read is not drawn as 0')
    assert.equal(waitingWords({ ...f, waiting_days: 0 }), '')
  })

  it('the door is addressed by week and person; the check never carries a reason', () => {
    assert.equal(myCalendarPath(), '/erp-lanes/my-calendar')
    assert.equal(myCalendarPath({ week: '2026-09-28' }), '/erp-lanes/my-calendar?week=2026-09-28')
    assert.equal(myCalendarPath({ week: '2026-09-28', person: 'PPL BOB' }), '/erp-lanes/my-calendar?week=2026-09-28&person=PPL%20BOB')
    assert.equal(checkPath('TO00000000B2', '2026-12-21', '2026-12-22'), '/erp-lanes/my-calendar/check?ref=TO00000000B2&start=2026-12-21&end=2026-12-22')
    assert.ok(!checkPath('TO00000000B2', '2026-12-21', '').includes('reason'))
    assert.equal(choiceAfter({ status: 'refused', reason: 'scope' }, 'PPL_BOB'), '')
    assert.equal(choiceAfter({ status: 'refused', reason: 'person' }, 'PPL_BOB'), '')
    assert.equal(choiceAfter({ status: 'refused', reason: 'badge' }, 'PPL_BOB'), 'PPL_BOB')
    assert.equal(weekAfter({ status: 'failed', reason: 'week' }, '2031-01-01'), '')
    assert.equal(weekAfter({ status: 'failed', reason: 'unreadable' }, '2026-09-28'), '2026-09-28')
  })

  it('a request is sent with no person and no house, so the relay files for the session\'s own name', () => {
    const body = fileBody('2026-12-21', '', '  family  ')
    assert.deepEqual(body, { start: '2026-12-21', end: '2026-12-21', reason: 'family', houses: [] })
    assert.ok(!('person' in body))
    assert.equal(fileFor(view()), '', 'your own calendar names nobody')
  })

  it('on a chosen person\'s calendar a request carries the relay\'s own spelling of them, never the roster id nor anything typed', () => {
    assert.equal(fileFor(bobView()), 'Bob Bee')
    assert.deepEqual(fileBody('2026-12-21', '2026-12-22', '', fileFor(bobView())),
      { start: '2026-12-21', end: '2026-12-22', reason: '', houses: [], person: 'Bob Bee' })
    assert.equal(fileFor(bobView({ file_for: '' })), '')
    assert.equal(fileFor({ ...bobView(), person: { own: true, name: 'The Boss', key_why: '' } }), '', 'the master\'s own row, chosen, is their own')
    assert.equal(filedForLine('Bob Bee'), 'Filed for Bob Bee by you.')
    assert.equal(filedForLine(''), '')
    assert.equal(whoseDays(bobView()), 'Choose the first and last day of Bob Bee\'s time off.')
    assert.equal(whoseDays(view()), 'Choose the first and last day of your time off.')
  })

  it('test mode is said when it is on, and a switch that could not be read is never said to be off', () => {
    assert.equal(testModeLine({ on: false, readable: true, why: '' }), '')
    assert.match(testModeLine({ on: true, readable: true, why: '' }), /Test mode is on/)
    assert.equal(testModeLine({ on: false, readable: false, why: 'the settings row did not answer.' }),
      'Whether test mode is on could not be read (the settings row did not answer).')
  })
})

describe('My Week', () => {
  it('draws seven days, Monday to Sunday, today tinted, each shift as its hours and its house', () => {
    const html = weekCard(view())
    assert.ok(html.includes('>My Week<'))
    assert.ok(html.includes('>Sep 21, 2026 – Sep 27, 2026<'))
    const days = [...html.matchAll(/data-day="([\d-]+)"/g)].map((m) => m[1])
    assert.deepEqual(days, ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'])
    assert.match(column(html, '2026-09-27'), /aria-current="date"/)
    assert.doesNotMatch(column(html, '2026-09-21'), /aria-current/)
    assert.ok(column(html, '2026-09-22').includes('>7A-3P<') && column(html, '2026-09-22').includes('>Meadowlane<'))
    assert.ok(column(html, '2026-09-27').includes('>49th St<'), 'no directory name: the calendar\'s own')
    assert.ok(column(html, '2026-09-21').includes('>No shifts<'))
    assert.ok(column(html, '2026-09-26').includes('>Off<') && !column(html, '2026-09-26').includes('No shifts'))
    for (const b of ['Previous week', 'Next week']) assert.ok(html.includes(`aria-label="${b}"`))
    assert.ok(/<button[^>]*data-nav="today"[^>]*>/.exec(html)?.[0].includes('disabled=""'), 'this week: Today has nowhere to go')
    assert.ok(!/<button[^>]*data-nav="prev"[^>]*>/.exec(html)?.[0].includes('disabled=""'))
    assert.ok(html.includes('From the house calendar, copied Sep 27, 2026, 9:14 AM'), 'the copy stamp in Ohio time')
  })

  it('an overnight sits only on the day it starts', () => {
    const html = weekCard(view())
    assert.ok(column(html, '2026-09-24').includes('>11P-7A<'))
    assert.ok(!column(html, '2026-09-25').includes('11P-7A'))
  })

  it('a day no calendar shows, a person on no calendar, and a week that could not be read say so — never "No shifts"', () => {
    const notDrawn = view({ week: { ...view().week, days: WEEK.map((d, i) => (i > 4 ? day(d.iso, 'not_drawn', { why: 'No house calendar that lists you shows this day yet.' }) : d)) } })
    const html = weekCard(notDrawn)
    assert.ok(column(html, '2026-09-26').includes('No house calendar that lists you shows this day yet.'))
    assert.ok(!column(html, '2026-09-26').includes('No shifts'))
    const why = 'The house calendars could not be read (OperationalError), so this week is not shown.'
    const down = view({ week: { ...view().week, head: { ...view().week.head, state: 'unreadable', why, copied_at: '' },
      days: WEEK.map((d) => day(d.iso, 'unreadable', { why })) } })
    const downHtml = weekCard(down)
    assert.ok(!downHtml.includes('No shifts'))
    assert.equal(downHtml.split(why).length - 1, 8, 'the head and each of the seven days')
    const nobody = 'No name that is yours alone is on file, so nothing on a calendar can be tied to you.'
    const na = view({ week: { ...view().week, head: { ...view().week.head, state: 'not_attributable', why: nobody },
      days: WEEK.map((d) => day(d.iso, 'unreadable', { why: nobody })) } })
    assert.ok(!weekCard(na).includes('No shifts') && weekCard(na).includes(nobody))
  })

  it('an R/O and a rehearsal square are muted; every mark wears a chip; time off bands its day', () => {
    const ro = card({ id: 'OD:2026-09-23:0', iso: '2026-09-23', kind: 'ro', shift_code: 'R/O', shift_start: '', shift_end: '', hours: null,
      hours_known: false, overnight: false })
    const rehearsal = card({ id: 'OD:2026-09-25:0', iso: '2026-09-25', kind: 'day', marks: [{ kind: 'rehearsal', words: 'Rehearsal square, not a real shift' }] })
    const marked = card({ marks: [{ kind: 'called_off', words: 'Called off' }, { kind: 'covered', words: 'Covered by another staff member' }] })
    const days = WEEK.map((d) => d.iso === '2026-09-23' ? day(d.iso, 'shifts', { cards: [ro], off: { state: 'scheduled', ref: 'TO00000000A1' } })
      : d.iso === '2026-09-25' ? day(d.iso, 'shifts', { cards: [rehearsal], off: { state: 'asked', ref: 'TO00000000FF' } })
        : d.iso === '2026-09-24' ? day(d.iso, 'shifts', { cards: [marked], notes: ['Orchard Dale\'s calendar has a column whose date and weekday disagree, so what it holds for this day is not shown.'] })
          : d)
    const html = weekCard(view({ week: { ...view().week, days } }))
    assert.match(column(html, '2026-09-23'), /data-muted="yes"/)
    assert.match(column(html, '2026-09-25'), /data-muted="yes"/)
    assert.match(column(html, '2026-09-24'), /data-muted="no"/)
    assert.ok(column(html, '2026-09-24').includes('data-chip="called_off"') && column(html, '2026-09-24').includes('data-chip="covered"'))
    assert.ok(column(html, '2026-09-24').includes(esc('Orchard Dale\'s calendar has a column whose date and weekday disagree')))
    assert.match(column(html, '2026-09-23'), /<button[^>]*data-off="scheduled"[^>]*>Time off · Approved</, 'a listed request opens from its band')
    assert.match(column(html, '2026-09-25'), /<p data-off="asked"[^>]*>Time off · Asked</, 'a request not listed is only said')
  })
})

describe('the shift panel', () => {
  it('says where, when in Eastern Time, the overnight, the address, the house manager, the cell as written and the hours', () => {
    const html = draw(<ShiftBody card={card()} head={view().week.head} />)
    for (const s of ['Sep 24, 2026 · 11:00 PM – Sep 25, 2026 · 7:00 AM · Eastern Time',
      'Overnight coverage 11:00 PM – 7:00 AM (shown on the day it starts).', '12 Orchard Dale Rd, Canton, OH 44709', 'Hanna Hale',
      '>11P-7A<', '8 hours', 'From the house calendar, copied Sep 27, 2026, 9:14 AM']) assert.ok(html.includes(s), s)
  })

  it('a covered call-off says so and never names who covered it; one not yet covered says that', () => {
    const lines = markLines(card({ marks: [{ kind: 'called_off', words: 'Called off' }, { kind: 'covered', words: 'Covered by another staff member' }] }))
    assert.deepEqual(lines, [{ kind: 'called_off', label: 'Called off', words: 'Covered by another staff member.' }])
    assert.deepEqual(markLines(card({ marks: [{ kind: 'called_off', words: 'Called off' }] })),
      [{ kind: 'called_off', label: 'Called off', words: 'Not yet covered.' }])
    const html = draw(<ShiftBody card={card({ marks: [
      { kind: 'offered', words: 'Offered to another staff member, still yours until accepted' },
      { kind: 'test_mode', words: 'Held by test mode, not on the workbook' },
      { kind: 'off_scheduled', ref: 'TO00000000A1', words: 'On approved time off (TO00000000A1), and still on the calendar under this name' },
    ] })} head={null} />)
    for (const s of ['Offered to transfer', 'Held by test mode', 'On approved time off']) assert.ok(html.includes(s), s)
  })

  it('a house nobody manages on file, an unreadable manager list, and a missing address each say so', () => {
    const html = draw(<ShiftBody card={card({ address: '', manager: '', managers: [] })} head={null} />)
    assert.ok(html.includes('No address is on file for this house.') && html.includes('No house manager is on file for this house.'))
    assert.ok(draw(<ShiftBody card={card({ managers_readable: false })} head={null} />).includes('Who manages this house could not be read.'))
  })
})

describe('Vacation Requests', () => {
  it('draws the figure, Add, the columns, and each row\'s pill, dates and days, grouped', () => {
    const html = draw(<RequestsCard view={view()} acting={false} onOpen={noop} />)
    assert.ok(html.includes('>Vacation Requests<'))
    const figure = /data-figure="">(.*?)<\/p>/.exec(html)?.[1].replace(/<[^>]+>/g, '') ?? ''
    assert.equal(figure, 'Days off approved · 2026: 5 + 3 waiting')
    assert.match(html, /<button[^>]*data-add=""[^>]*>.*Add Time Off Request/)
    for (const h of ['Status', 'Start date', 'End date', 'Days']) assert.ok(html.includes(`<span>${h}</span>`), h)
    assert.ok(html.indexOf('data-group="pending"') < html.indexOf('data-group="upcoming"'))
    assert.ok(html.includes('>Pending<') && html.includes('>Approved<'))
    assert.ok(html.includes('>Oct 15, 2026<') && html.includes('>Oct 19, 2026<') && html.includes('>Dec 21, 2026<'))
    assert.match(html, /data-status="scheduled"[^>]*>Approved</)
    assert.match(html, /data-status="pending"[^>]*>Waiting</)
  })

  it('a greyed pencil or trash carries the relay\'s own reason, on hover and read out with it', () => {
    const html = draw(<RequestsCard view={view({ requests: { ...view().requests, rows: [PENDING, APPROVED, ON_NOW] } })} acting={false} onOpen={noop} />)
    assert.match(html, /<button[^>]*disabled=""[^>]*data-act="edit"[^>]*aria-describedby="my-calendar-edit-TO00000000C3-why"/)
    assert.ok(html.includes(`<span id="my-calendar-edit-TO00000000C3-why" class="sr-only">${EDIT_STARTED}</span>`), 'an approved request on now keeps its dates')
    assert.ok(html.includes(`title="${EDIT_STARTED}"`))
    assert.ok(html.includes(`<span id="my-calendar-withdraw-TO00000000C3-why" class="sr-only">${WITHDRAW_STARTED}</span>`))
    assert.doesNotMatch(html, /aria-describedby="my-calendar-withdraw-TO00000000A1-why"/, 'an approved request not yet started may be withdrawn')
    assert.doesNotMatch(html, /aria-describedby="my-calendar-edit-TO00000000A1-why"/, '…and its dates changed')
    assert.doesNotMatch(html, /aria-describedby="my-calendar-edit-TO00000000B2-why"/, 'a waiting request may be changed')
  })

  it('concluded requests fold after five', () => {
    const concluded = Array.from({ length: 7 }, (_, i) => req(`TO0000000${i}AA0`, {
      status: 'withdrawn', word: 'Withdrawn', group: 'concluded', may: may({ withdraw: false, edit: false }) }))
    const html = draw(<RequestsCard view={view({ requests: { ...view().requests, rows: concluded } })} acting={false} onOpen={noop} />)
    assert.equal((html.match(/data-request="/g) ?? []).length, CONCLUDED_SHOWN)
    assert.ok(html.includes('Show 2 more concluded'))
  })

  it('requests that could not be read say so, and none is drawn as an empty list', () => {
    const why = 'Time off could not be read (OperationalError).'
    const html = draw(<RequestsCard view={view({ requests: { state: 'unreadable', why, rows: [], figure: null, as_of: '' } })} acting={false} onOpen={noop} />)
    assert.ok(html.includes(why) && !html.includes('You have no time off requests yet.') && !html.includes('Days off approved'))
    assert.ok(draw(<RequestsCard view={view({ requests: { ...view().requests, rows: [] } })} acting={false} onOpen={noop} />)
      .includes('You have no time off requests yet.'))
  })

  it('on a chosen person\'s calendar Add is drawn and pressable, and the pencil and trash follow Time Off\'s own rule', () => {
    const bob = bobView()
    const html = draw(<RequestsCard view={bob} acting={false} onOpen={noop} />)
    assert.match(html, /<button type="button"[^>]*data-add=""[^>]*>.*Add Time Off Request/)
    assert.doesNotMatch(html, /disabled=""[^>]*data-add=""/, 'the master files for the person chosen')
    assert.deepEqual(addFor(bob, false), { allowed: true, why: '' })
    assert.ok(html.includes('>Vacation Requests · Bob Bee<'))
    // the row Bob filed is not the master's; the one the master filed is
    assert.ok(html.includes(`<span id="my-calendar-edit-TO00000000B2-why" class="sr-only">${NOT_YOURS}</span>`))
    assert.ok(html.includes(`<span id="my-calendar-withdraw-TO00000000B2-why" class="sr-only">${NOT_YOURS}</span>`))
    assert.doesNotMatch(html, /aria-describedby="my-calendar-(edit|withdraw)-TO00000000A1-why"/)
    assert.equal((html.match(/<button[^>]*disabled=""[^>]*data-act="/g) ?? []).length, 2)
  })

  it('on a chosen person\'s calendar Add stays drawn, greyed with the relay\'s reason; with no spelling of them nothing is filed or re-dated', () => {
    const shut = bobView({ may_file: false, may_file_why: 'Time Off is not open to you.', file_for: '' })
    const html = draw(<RequestsCard view={shut} acting={false} onOpen={noop} />)
    assert.match(html, /<button[^>]*disabled=""[^>]*data-add=""/)
    assert.ok(html.includes('Add Time Off Request') && html.includes('data-add-why=""') && html.includes('Time Off is not open to you.'))
    const unspelled = bobView({ file_for: '' })
    assert.deepEqual(addFor(unspelled, false), { allowed: false, why: NO_FILE_FOR })
    assert.deepEqual(rowActs(APPROVED, false, unspelled).edit, { allowed: false, why: NO_FILE_FOR }, 'new dates would be filed for nobody')
    assert.deepEqual(rowActs(APPROVED, false, unspelled).withdraw, { allowed: true, why: '' })
    assert.deepEqual(rowActs(APPROVED, false, bobView()).edit, { allowed: true, why: '' })
  })

  it('in a switched session Add, the pencil and the trash are greyed with the relay\'s own sentence', () => {
    const html = draw(<RequestsCard view={view({ requests: { ...view().requests, rows: [PENDING, APPROVED, ON_NOW] } })} acting onOpen={noop} />)
    assert.match(html, /<button[^>]*disabled=""[^>]*data-add=""/)
    assert.ok(html.includes(`title="${ACTING_SENTENCE}"`) && html.includes(`id="my-calendar-add-why"`))
    assert.ok(html.includes(`<span id="my-calendar-edit-TO00000000B2-why" class="sr-only">${ACTING_SENTENCE}</span>`))
    assert.ok(html.includes(`<span id="my-calendar-withdraw-TO00000000B2-why" class="sr-only">${ACTING_SENTENCE}</span>`))
    assert.ok(html.includes(`<span id="my-calendar-edit-TO00000000A1-why" class="sr-only">${ACTING_SENTENCE}</span>`))
    assert.ok(html.includes(`<span id="my-calendar-edit-TO00000000C3-why" class="sr-only">${EDIT_STARTED}</span>`), 'a refusal of its own keeps its words')
    assert.deepEqual(addFor(view(), true), { allowed: false, why: ACTING_SENTENCE })
    assert.deepEqual(rowActs(PENDING, true), { edit: { allowed: false, why: ACTING_SENTENCE }, withdraw: { allowed: false, why: ACTING_SENTENCE } })
    assert.deepEqual(rowActs(PENDING, false), { edit: { allowed: true, why: '' }, withdraw: { allowed: true, why: '' } })
  })
})

describe('the right panel', () => {
  it('is an aside with its label, not a dialog; it draws its children and nothing when closed', () => {
    const html = draw(<SidePanel open onClose={noop} label="Shift" title="Orchard Dale"><p>the child</p></SidePanel>)
    assert.match(html, /<aside aria-label="Shift"/)
    assert.ok(html.includes('>the child<') && html.includes('>Orchard Dale</h2>'))
    assert.ok(!html.includes('aria-modal') && !html.includes('role="dialog"'))
    assert.ok(html.includes('data-panel-scrim'))
    assert.equal(draw(<SidePanel open={false} onClose={noop} label="Shift" title="x"><p>the child</p></SidePanel>), '')
  })

  it('Escape closes it, and the scrim closes it', () => {
    let closed = 0
    const onClose = () => { closed++ }
    const h = mountHook((p: { open: boolean }) => usePanelEscape(p.open, onClose), { open: true })
    const press = (key: string) => [...(listeners.get('keydown') ?? [])].forEach((fn) => fn({ key }))
    press('Enter')
    assert.equal(closed, 0)
    press('Escape')
    assert.equal(closed, 1)
    h.rerender({ open: false })
    press('Escape')
    assert.equal(closed, 1, 'a closed panel listens to nothing')
    h.unmount()
    const scrim = PanelScrim({ onClose }) as unknown as { props: { onClick: () => void } }
    scrim.props.onClick()
    assert.equal(closed, 2)
  })

  it('Escape over a document in the centred viewer closes the document, not the panel under it', () => {
    let closed = 0
    const h = mountHook((p: { open: boolean }) => usePanelEscape(p.open, () => { closed++ }), { open: true })
    const press = (key: string) => [...(listeners.get('keydown') ?? [])].forEach((fn) => fn({ key }))
    useFileViewerStore.getState().openFile({ title: 'IST', url: 'blob:https://x/1' })
    press('Escape')
    assert.equal(closed, 0, 'the panel stays while the viewer holds a file')
    useFileViewerStore.getState().closeFile()
    press('Escape')
    assert.equal(closed, 1)
    h.unmount()
  })

  it('a shift opens as the house, read only', () => {
    const html = panel({ kind: 'shift', card: card() })
    assert.match(html, /<aside aria-label="Shift"/)
    assert.ok(html.includes('>Orchard Dale</h2>') && html.includes('Overnight coverage 11:00 PM – 7:00 AM'))
    assert.ok(!html.includes('data-press='), 'nothing to press')
  })

  it('a waiting request opens with its details and the two actions, each greyed with its reason', () => {
    const html = panel({ kind: 'request', mode: 'detail', ref: 'TO00000000B2' })
    assert.match(html, /<aside aria-label="Time off"/)
    assert.ok(html.includes('>Time Off Request</h2>') && html.includes('Mon 12/21 – Wed 12/23') && html.includes('Dec 21, 2026 – Dec 23, 2026'))
    assert.match(html, /<button type="button"[^>]*data-gated="Change dates"/, 'a waiting request may be re-dated')
    assert.match(html, /<button type="button"[^>]*data-gated="Withdraw"/)
    const greyed = req('TO00000000D4', { may: may({ withdraw: false, withdraw_why: WITHDRAW_STARTED, edit: false, edit_why: EDIT_STARTED }) })
    const started = panel({ kind: 'request', mode: 'detail', ref: 'TO00000000D4' },
      view({ requests: { ...view().requests, rows: [PENDING, APPROVED, greyed] } }))
    assert.match(started, /<button[^>]*disabled=""[^>]*data-gated="Change dates"/)
    assert.ok(started.includes(EDIT_STARTED) && started.includes(WITHDRAW_STARTED))
    assert.ok(panel({ kind: 'request', mode: 'detail', ref: 'TO0000000FFF' }).includes('This request is no longer listed here.'))
  })

  it('an approved request opens in the operator\'s layout, read from Time Off; its person keeps Withdraw, never an edit', () => {
    const rows = { ...view().requests, rows: [PENDING, APPROVED, ON_NOW] }
    for (const ref of ['TO00000000A1', 'TO00000000C3']) {
      const html = panel({ kind: 'request', mode: 'detail', ref }, view({ requests: rows }))
      assert.match(html, /<aside aria-label="Time off request"/)
      assert.ok(html.includes('data-status="Approved"') && html.includes('>Employee<') && html.includes('>Maya Chen</h2>'))
      assert.ok(html.includes('>Impacted shifts<') && html.includes('Reading the calendars…'), 'its facts are Time Off\'s record, being read')
      assert.ok(!/data-gated="Change dates"|data-act="edit"/.test(html), 'no Change dates, no Edit for the person on it')
    }
    const ahead = panel({ kind: 'request', mode: 'detail', ref: 'TO00000000A1' }, view({ requests: rows }))
    assert.ok(ahead.includes('>Oct 15, 2026<'))
    assert.match(ahead, /<button type="button"[^>]*data-gated="Withdraw"/, 'not started: its person may withdraw it')
    assert.ok(ahead.indexOf('data-gated="Withdraw"') > ahead.indexOf('>Impacted shifts<'), 'under the layout')
    const started = panel({ kind: 'request', mode: 'detail', ref: 'TO00000000C3' }, view({ requests: rows }))
    assert.ok(!started.includes('data-gated="Withdraw"'), 'started: nothing to press')
    const switched = panel({ kind: 'request', mode: 'detail', ref: 'TO00000000A1' }, view({ requests: rows }), true)
    assert.match(switched, /<button type="button" disabled=""[^>]*data-gated="Withdraw"/, 'a switched session is greyed with its reason')
  })

  it('an approver\'s Edit opens the record right here — the panel never sends anyone to Time Off', () => {
    const text = readFileSync(resolve(ROOT, 'src/pages/features/mycalendar/RequestPanel.tsx'), 'utf8')
    assert.doesNotMatch(text, /useNavigate|navigate\(|\/app\/timeoff|REQUESTS_ROUTE/)
    assert.match(text, /<RecordPanel /)
  })

  it('Add asks for the two days and a reason, says test mode, and files only on a second press', () => {
    const html = panel({ kind: 'add' })
    assert.ok(html.includes('>Add Time Off Request</h2>'))
    assert.match(html, /<input type="date" min="2026-09-27" data-field="start"[^>]*value=""/)
    assert.ok(html.includes('maxLength="500"') && html.includes('0/500'))
    assert.ok(html.includes(TEST_MODE_FILE))
    assert.match(html, /<button type="button" disabled=""[^>]*data-press="File request"/, 'nothing is filed before a clean check')
    assert.ok(!panel({ kind: 'add' }, view({ test_mode: { on: false, readable: true, why: '' } })).includes('Test mode is on'))
  })

  it('Edit carries the dates, not the reason, and says it withdraws and files again', () => {
    const html = panel({ kind: 'request', mode: 'edit', ref: 'TO00000000B2' })
    assert.ok(html.includes('>Edit Time Off Request</h2>'))
    assert.match(html, /<input type="date"[^>]*data-field="start"[^>]*value="2026-12-21"/)
    assert.match(html, /<input type="date"[^>]*data-field="end"[^>]*value="2026-12-23"/)
    assert.ok(html.includes('The earlier reason is not carried over.'))
    assert.ok(html.includes('Saving withdraws TO00000000B2 and files these dates as a new request'))
    assert.match(html, /<button type="button" disabled=""[^>]*data-press="Save Changes"/)
    assert.ok(!html.includes('data-edit-warns'), 'a waiting request is not warned')
  })

  it('new dates for an approved request ahead are warned before anything is saved: both approvals start over', () => {
    const html = panel({ kind: 'request', mode: 'edit', ref: 'TO00000000A1' })
    const warn = /<p role="alert"[^>]*data-edit-warns="">(.*?)<\/p>/.exec(html)?.[1] ?? ''
    assert.ok(warn.startsWith('Changing the dates sends this request for approval again; both approvals start over.'), warn)
    assert.ok(html.indexOf('data-edit-warns') < html.indexOf('data-press="Save Changes"'))
    assert.match(html, /<input type="date"[^>]*data-field="start"[^>]*value="2026-10-15"/)
    assert.doesNotMatch(html, /<input type="date"[^>]*disabled=""[^>]*data-field="start"/)
    assert.match(html, /<button type="button" disabled=""[^>]*data-press="Save Changes"/, 'nothing is saved before a clean check')
  })

  it('an approved request already on keeps its dates: the pencil\'s panel is greyed with the reason and warns of nothing', () => {
    const html = panel({ kind: 'request', mode: 'edit', ref: 'TO00000000C3' }, view({ requests: { ...view().requests, rows: [ON_NOW] } }))
    assert.ok(html.includes(`data-edit-why="">${EDIT_STARTED}</p>`))
    assert.match(html, /<input type="date"[^>]*disabled=""[^>]*data-field="start"/)
    assert.ok(!html.includes('data-edit-warns'))
  })

  it('on a chosen person\'s calendar Add is filed for them, by you, and says so; test mode is still said', () => {
    const html = panel({ kind: 'add' }, bobView())
    assert.ok(html.includes('>Add Time Off Request</h2>'))
    assert.ok(html.includes(esc('Choose the first and last day of Bob Bee\'s time off.')))
    assert.ok(html.includes('Only their house manager and the directors read this.'))
    assert.doesNotMatch(html, /<input type="date"[^>]*disabled=""/)
    assert.ok(!html.includes('data-add-why'))
    assert.ok(html.includes(TEST_MODE_FILE))
    const refused = panel({ kind: 'add' }, bobView({ file_for: '' }))
    assert.ok(refused.includes(NO_FILE_FOR) && /<input type="date"[^>]*disabled=""/.test(refused))
  })

  it('Withdraw says what an approved request loses, and takes a note', () => {
    const html = panel({ kind: 'request', mode: 'withdraw', ref: 'TO00000000A1' })
    assert.ok(html.includes('>Withdraw Time Off Request</h2>') && html.includes(WARNS))
    assert.match(html, /<button type="button"[^>]*data-press="Withdraw"/)
    assert.doesNotMatch(html, /disabled=""[^>]*data-press="Withdraw"/)
  })

  it('a change whose withdrawal landed and whose filing did not opens a new request with the dates and says so', () => {
    const note = orphanLine('TO00000000B2', 'Those days overlap TO00000000A1.')
    assert.equal(note, 'TO00000000B2 was withdrawn; the new dates were not filed: Those days overlap TO00000000A1. Press File to try again.')
    const html = panel({ kind: 'add', start: '2026-12-22', end: '2026-12-24', reason: '', note })
    assert.ok(html.includes(note) && html.includes('value="2026-12-22"') && html.includes('value="2026-12-24"'))
  })
})

describe('the scope, as the screen draws it', () => {
  it('the person chooser appears only on a mass answer', () => {
    const own = screen(ready(view()))
    assert.ok(!own.includes('my-calendar-person') && !own.includes('Your own calendar'))
    const mass = view({ scope: { mode: 'mass', why: 'Signed in as the master account.', person: '',
      people: [{ key: 'PPL_BOB', name: 'Bob Bee', status: 'Active', kind: 'staff' }], people_why: '' } })
    const html = screen(ready(mass))
    assert.ok(html.includes('id="my-calendar-person"') && html.includes('>Your own calendar<') && html.includes('>Bob Bee · Active<'))
    assert.ok(html.includes('Signed in as the master account.'))
    const failed = draw(<PersonBar chooser={{ people: [], people_why: 'the staff roster could not be read' }} person="" onPerson={noop} onRetry={noop} busy={false} />)
    assert.ok(failed.includes('No staff member can be chosen: The staff roster could not be read.'))
  })

  it('draws the two cards with no black band, and the test-mode strip while test mode is on', () => {
    const html = screen(ready(view()))
    assert.ok(html.indexOf('aria-label="My Week"') < html.indexOf('aria-label="Vacation Requests"'))
    assert.ok(html.includes('data-test-strip'))
    assert.ok(!screen(ready(view({ test_mode: { on: false, readable: true, why: '' } }))).includes('data-test-strip'))
    assert.ok(!html.includes('app-hero'))
  })

  it('a chosen person\'s calendar says whose it is, that what is added is filed for them, and is titled with their name', () => {
    const html = screen(ready(bobView()), { person: 'PPL_BOB' })
    assert.ok(html.includes(esc('Showing Bob Bee\'s calendar and requests. A request you add here is filed for Bob Bee, by you.')))
    assert.ok(html.includes('>Week · Bob Bee<') && !html.includes('read-only'))
    assert.match(html, /<button type="button"[^>]*data-add=""/)
  })

  it('a refusal is the relay\'s own words, never an empty calendar', () => {
    const html = screen({ ...MY_CALENDAR_IDLE, status: 'refused', reason: 'scope', error: 'My Calendar shows only your own calendar.' })
    assert.ok(html.includes('My Calendar shows only your own calendar.') && !html.includes('My Week') && html.includes('Try again'))
  })

  it('a failed first read says so and draws no day', () => {
    const html = screen({ ...MY_CALENDAR_IDLE, status: 'failed', error: 'the relay answered 503' })
    assert.ok(html.includes('My Calendar could not be read: the relay answered 503') && !html.includes('No shifts'))
  })

  it('while another week is read, the same person\'s requests stand and the week says it is reading', () => {
    const html = screen({ ...MY_CALENDAR_IDLE, status: 'loading', refreshing: true }, { backdrop: view() })
    assert.ok(html.includes('Reading the week…') && !html.includes('No shifts'))
    assert.ok(html.includes('data-request="TO00000000B2"'))
  })
})

describe('the reads and the writes', () => {
  const realFetch = globalThis.fetch
  let calls: { url: string; method: string; auth: string; body: string }[] = []
  let answer: (url: string, body: string) => Response | Promise<Response> = () => new Response(JSON.stringify({ status: 200, data: view() }))
  before(() => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      const body = typeof init?.body === 'string' ? init.body : ''
      calls.push({ url: String(url), method: String(init?.method ?? 'GET'), auth: headers.Authorization ?? '', body })
      return answer(String(url), body)
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  afterEach(() => {
    calls = []
    forgetHeld()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
    useAuthStore.setState({ user: null, token: null, beAnother: null } as never)
    useMemberStore.setState({ currentMemberId: '', memberName: '', memberRole: '', memberTypes: [] } as never)
  })
  const signIn = (isMaster = false) => useAuthStore.setState({
    user: { id: 'u-maya', name: 'Maya Chen', role: isMaster ? 'admin' : 'staff', types: [], isMaster }, token: 'tok-maya',
  } as never)

  it('reads its one door with the Bearer token; the week and the person ride the address', async () => {
    signIn()
    const h = mountHook(() => useMyCalendar(true, '', ''), {})
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(calls[0].url, '/erp-lanes/my-calendar')
    assert.equal(calls[0].auth, 'Bearer tok-maya')
    h.unmount()
    calls = []
    const p = mountHook(() => useMyCalendar(true, 'PPL_BOB', '2026-09-28'), {})
    await p.settle(() => p.current.state.status === 'ready')
    assert.equal(calls[0].url, '/erp-lanes/my-calendar?week=2026-09-28&person=PPL_BOB')
    p.unmount()
  })

  it('a new week never draws the week before it, while the same person\'s last answer stands behind it', async () => {
    signIn()
    let open: (r: Response) => void = () => {}
    answer = (url) => url.includes('week=') ? new Promise<Response>((r) => { open = r }) : new Response(JSON.stringify({ status: 200, data: view() }))
    const h = mountHook((p: { week: string }) => useMyCalendar(true, '', p.week), { week: '' })
    await h.settle(() => h.current.state.status === 'ready')
    h.rerender({ week: '2026-09-28' })
    const now = () => h.current
    assert.equal(now().state.data, null)
    assert.equal(now().state.status, 'loading')
    assert.equal(now().backdrop?.person.name, 'Maya Chen', 'the requests stand')
    const next = view({ week: { ...view().week, from: '2026-09-28', to: '2026-10-04' } })
    open(new Response(JSON.stringify({ status: 200, data: next })))
    await h.settle(() => now().state.data?.week.from === '2026-09-28')
    h.rerender({ week: '' })
    assert.equal(now().state.data?.week.from, '2026-09-21', 'the held week is drawn at once')
    await h.settle(() => !now().state.refreshing)
    h.unmount()
  })

  it('a new person has no answer standing behind it: never the person before', async () => {
    signIn(true)
    const people = [{ key: 'PPL_BOB', name: 'Bob Bee', status: 'Active' }]
    let open: (r: Response) => void = () => {}
    answer = (url) => url.includes('person=') ? new Promise<Response>((r) => { open = r })
      : new Response(JSON.stringify({ status: 200, data: view({ scope: { mode: 'mass', why: '', person: '', people, people_why: '' } }) }))
    const h = mountHook((p: { person: string }) => useMyCalendar(true, p.person, ''), { person: '' })
    await h.settle(() => h.current.state.status === 'ready')
    h.rerender({ person: 'PPL_BOB' })
    assert.equal(h.current.state.data, null)
    assert.equal(h.current.backdrop, null)
    assert.deepEqual(h.current.chooser?.people.map((x) => x.key), ['PPL_BOB'], 'the chooser stays while the read runs')
    open(new Response(JSON.stringify({ status: 200, data: view({ person: { own: false, name: 'Bob Bee', key_why: '' } }) })))
    await h.settle(() => h.current.state.data?.person.name === 'Bob Bee')
    h.unmount()
  })

  it('a 403 is refused with the relay\'s own reason and words; a refused person is dropped from the address', async () => {
    signIn()
    answer = () => new Response(JSON.stringify({ status: 403, reason: 'scope', message: 'My Calendar shows only your own calendar.' }))
    const h = mountHook(() => useMyCalendar(true, 'PPL_BOB', ''), {})
    await h.settle(() => h.current.state.status === 'refused')
    assert.equal(h.current.state.reason, 'scope')
    assert.equal(h.current.state.data, null)
    h.unmount()
    answer = (url) => url.includes('person=')
      ? new Response(JSON.stringify({ status: 404, reason: 'person', message: 'No row of the staff roster carries that person.' }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    const dropped: string[] = []
    const p = mountHook(() => useMyCalendarPage('PPL_GONE', '', (k) => dropped.push(k), noop), {})
    await p.settle(() => dropped.length > 0)
    assert.deepEqual(dropped.slice(0, 1), [''])
    p.unmount()
  })

  it('a week the door cannot read is let go', async () => {
    signIn()
    answer = (url) => url.includes('week=')
      ? new Response(JSON.stringify({ status: 400, reason: 'week', message: 'My Calendar shows the weeks up to 53 weeks from this one.' }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    const weeks: string[] = []
    const p = mountHook(() => useMyCalendarPage('', '2031-01-06', noop, (w) => weeks.push(w)), {})
    await p.settle(() => weeks.length > 0)
    assert.deepEqual(weeks.slice(0, 1), [''])
    p.unmount()
  })

  it('an open member visit draws the sentence and reads nothing', async () => {
    signIn(true)
    useMemberStore.setState({ currentMemberId: 'u-sam', memberName: 'Sam Staff', memberRole: 'staff', memberTypes: [] } as never)
    const h = mountHook(() => useMyCalendarPage('', '', noop, noop), {})
    await h.settle(() => false)
    assert.equal(h.current.visiting, true)
    assert.equal(calls.length, 0)
    h.unmount()
    assert.ok(draw(<VisitNotice />).includes(esc(VISIT_SENTENCE)))
    const page = readFileSync(resolve(ROOT, `${FEATURE}/MyCalendarPage.tsx`), 'utf8')
    assert.match(page, /const \{ visiting, [^}]*\} = useMyCalendarPage\([^)]*\)[\s\S]*if \(visiting\) return <VisitNotice \/>/)
  })

  it('a switched session is known to the page, so its writes are drawn disabled', async () => {
    signIn()
    useAuthStore.setState({ beAnother: { real: null, acting: { display_name: 'Ann Roe' } } } as never)
    const h = mountHook(() => useMyCalendarPage('', '', noop, noop), {})
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(h.current.acting, true)
    h.unmount()
  })

  it('the writes are the Time Off doors\': a dry run and a filing with no person, a withdrawal with its note', async () => {
    signIn()
    answer = (url, body) => new Response(JSON.stringify({ status: 200, data: url.endsWith('/withdraw') ? { ref: 'TO00000000B2' }
      : JSON.parse(body).dry_run ? { ok: true, refusals: [], person: 'Maya Chen', start: '2026-12-21', end: '2026-12-22' }
        : { ref: 'TO00000000D4', asked: { house_manager: [], hm_mode: 'house_manager', directors: [] } } }))
    await previewAdd('2026-12-21', '2026-12-22', 'family')
    await fileAdd('2026-12-21', '2026-12-22', '')
    await withdrawRequest('TO00000000B2', 'not needed')
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [
      ['POST', '/erp-lanes/time-off/request'], ['POST', '/erp-lanes/time-off/request'], ['POST', '/erp-lanes/time-off/withdraw'],
    ])
    assert.deepEqual(JSON.parse(calls[0].body), { start: '2026-12-21', end: '2026-12-22', reason: 'family', houses: [], dry_run: true })
    assert.deepEqual(JSON.parse(calls[1].body), { start: '2026-12-21', end: '2026-12-22', reason: '', houses: [] })
    assert.deepEqual(JSON.parse(calls[2].body), { ref: 'TO00000000B2', note: 'not needed' })
  })

  it('on a chosen person\'s calendar the dry run and the filing carry the relay\'s spelling of them, through the same door', async () => {
    signIn(true)
    answer = (_url, body) => new Response(JSON.stringify({ status: 200, data: JSON.parse(body).dry_run
      ? { ok: true, refusals: [], person: 'Bob Bee', start: '2026-12-21', end: '2026-12-22' }
      : { ref: 'TO00000000D5', asked: { house_manager: [], hm_mode: 'house_manager', directors: [] } } }))
    const person = fileFor(bobView())
    const preview = await previewAdd('2026-12-21', '2026-12-22', '', person)
    await fileAdd('2026-12-21', '2026-12-22', '', person)
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['POST', '/erp-lanes/time-off/request'], ['POST', '/erp-lanes/time-off/request']])
    assert.deepEqual(JSON.parse(calls[0].body), { start: '2026-12-21', end: '2026-12-22', reason: '', houses: [], person: 'Bob Bee', dry_run: true })
    assert.deepEqual(JSON.parse(calls[1].body), { start: '2026-12-21', end: '2026-12-22', reason: '', houses: [], person: 'Bob Bee' })
    assert.equal(filedForLine(preview.person), 'Filed for Bob Bee by you.')
  })

  it('the pencil\'s check is a GET with no reason; on a chosen person\'s calendar it names the roster row', async () => {
    signIn()
    answer = () => new Response(JSON.stringify({ status: 200, data: { ref: 'TO00000000B2', start: '2026-12-22', end: '2026-12-24', days: 3, dates: '', ok: true, refusals: [] } }))
    const got = await checkDates('TO00000000B2', '2026-12-22', '2026-12-24')
    assert.equal(got.ok, true)
    await checkDates('TO00000000A1', '2026-10-16', '2026-10-19', 'PPL_BOB')
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [
      ['GET', '/erp-lanes/my-calendar/check?ref=TO00000000B2&start=2026-12-22&end=2026-12-24'],
      ['GET', '/erp-lanes/my-calendar/check?ref=TO00000000A1&start=2026-10-16&end=2026-10-19&person=PPL_BOB'],
    ])
  })

  it('new dates: withdrawn then filed; a refused withdrawal changes nothing; a refused filing is said, never lost', async () => {
    const seen: string[] = []
    const ok = { withdraw: async (ref: string, note: string) => { seen.push(`withdraw ${ref} ${note}`) },
      file: async (s: string, e: string, _r: string, p: string) => { seen.push(`file ${s} ${e} for ${p || 'the session'}`); return { ref: 'TO00000000D4' } } }
    assert.deepEqual(await changeDates('TO00000000B2', '2026-12-22', '2026-12-24', '', '', ok), { state: 'done', ref: 'TO00000000D4' })
    assert.deepEqual(seen, ['withdraw TO00000000B2 Dates changed in My Calendar', 'file 2026-12-22 2026-12-24 for the session'])
    seen.length = 0
    assert.deepEqual(await changeDates('TO00000000A1', '2026-10-16', '2026-10-19', '', 'Bob Bee', ok), { state: 'done', ref: 'TO00000000D4' })
    assert.deepEqual(seen, ['withdraw TO00000000A1 Dates changed in My Calendar', 'file 2026-10-16 2026-10-19 for Bob Bee'],
      'on a chosen person\'s calendar the new dates are filed for them')
    seen.length = 0
    const kept = await changeDates('TO00000000B2', '2026-12-22', '2026-12-24', '', '', { ...ok,
      withdraw: async () => { throw new Error('Nothing to withdraw: it is scheduled.') } })
    assert.deepEqual(kept, { state: 'kept', message: 'Nothing was changed: Nothing to withdraw: it is scheduled.' })
    assert.deepEqual(seen, [], 'nothing is filed after a refused withdrawal')
    const lost = await changeDates('TO00000000B2', '2026-12-22', '2026-12-24', '', '', { ...ok,
      file: async () => { throw new Error('Those days overlap TO00000000A1.') } })
    assert.deepEqual(lost, { state: 'orphaned', message: orphanLine('TO00000000B2', 'Those days overlap TO00000000A1.') })
  })

  it('through the doors themselves, a switched session\'s refusal after the withdrawal is said with the relay\'s words', async () => {
    signIn()
    answer = (url) => url.endsWith('/withdraw')
      ? new Response(JSON.stringify({ status: 200, data: { ref: 'TO00000000B2' } }))
      : new Response(JSON.stringify({ status: 409, code: 'be_another_refused',
        message: 'Not in a switched session: this door cannot take the write. Press Be Back to do this as yourself.' }))
    const got = await changeDates('TO00000000B2', '2026-12-22', '2026-12-24', '')
    assert.equal(got.state, 'orphaned')
    assert.ok(got.state === 'orphaned' && got.message.startsWith('TO00000000B2 was withdrawn; the new dates were not filed: Not in a switched session'))
    assert.deepEqual(calls.map((c) => c.url), ['/erp-lanes/time-off/withdraw', '/erp-lanes/time-off/request'])
  })
})
