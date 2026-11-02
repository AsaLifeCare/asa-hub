/**
 * MY CALENDAR · MY WEEK FOR A CLIENT OR A GUARDIAN — the natural My Week (WeekCard), at the account's own house.
 *
 * The same card every account reads: the title, the range, ‹ Today ›, one column a day. A client's day holds its own
 * doctor appointments (their own tint, a stethoscope) and every staff shift at its house (the hours and the staff
 * member's name). "No shifts" only where the house calendar shows the day; a day it does not reach, or shifts that
 * could not be read, say so instead. Only an appointment with no day written stays unplaced, said in one line.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { familyIdle, type FamilyCalendar, type FamilySource, type FamilyState } from '@/pages/features/family/myFamily'
import { AppointmentChip, FamilyWeekScreen, StaffShiftChip } from '@/pages/features/mycalendar/FamilyWeek'
import {
  appointmentLine, familyDayOf, familyShiftCode, familyWeekCurrent, familyWeekOf, nextLine, undatedLine,
} from '@/pages/features/mycalendar/familyWeekModel'
import WeekCard from '@/pages/features/mycalendar/WeekCard'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}

const src = (key: string, state: FamilySource['state'], over: Partial<FamilySource> = {}): FamilySource =>
  ({ key, label: key, state, why: '', count: state === 'ok' || state === 'empty' ? 0 : null, ...over })
const ready = <T,>(data: T, over: Partial<FamilyState<T>> = {}): FamilyState<T> =>
  ({ ...familyIdle<T>(), status: 'ready', data, readAt: Date.parse('2026-09-28T13:00:00Z'), ...over })

function week(over: Partial<FamilyCalendar> = {}): FamilyCalendar {
  return {
    family: true, part: 'calendar', viewer: 'client', linked: true, ward: { name: 'Jane Doe' }, why: '',
    today: '2026-09-29', read_at: '2026-09-29T13:00:00Z',
    week: { from: '2026-09-28', to: '2026-10-04', prev: '2026-09-21', next: '2026-10-05', this: '2026-09-28' },
    shifts: {
      rows: [
        { day: '2026-09-28', staff: 'Ann Staff', start: '07:00', end: '15:00' },
        { day: '2026-09-30', staff: 'Ben Night', start: '23:00', end: '07:00' },
        { day: '2026-09-30', staff: 'Cy Day', start: '', end: '' },
      ],
      drawn: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'],
      houses: ['ABD4708'],
      source: src('shifts', 'ok', { label: 'Shifts at the house', count: 3 }),
    },
    appointments: {
      rows: [{ day: '2026-09-30', title: 'Dentist', doctor: 'Dr Ada', time: '10:00 AM', place: '12 Main St', status: '' }],
      next: { day: '2026-10-09', title: 'Eye doctor', doctor: '', time: '', place: '', status: '' },
      undated: 0, source: src('appointments', 'ok', { label: 'Doctor appointments', count: 1 }),
    },
    manager: { rows: [{ name: 'Mary Manager', phone: '3305550100' }], source: src('manager', 'ok', { count: 1 }) },
    ...over,
  }
}

/** One day's column, as drawn. */
const column = (html: string, iso: string) => {
  const at = html.indexOf(`data-day="${iso}"`)
  assert.ok(at !== -1, `no column for ${iso}`)
  const next = html.indexOf('data-day="', at + 10)
  return html.slice(at, next === -1 ? undefined : next)
}

/** Every element under a node that `pred` picks, props.children walked. */
function pick(node: unknown, pred: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = []
  const visit = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(visit); return }
    if (!isValidElement(n)) return
    const el = n as ReactElement<Record<string, unknown>>
    if (pred(el)) out.push(el)
    visit(el.props.children)
  }
  visit(node)
  return out
}

describe('My Week for a client: the natural week at its own house', () => {
  it('is the same card every account reads — the title, the range, ‹ Today › and one column a day', () => {
    const html = draw(<FamilyWeekScreen state={ready(week())} onWeek={noop} onRetry={noop} />)
    assert.match(html, /<h2[^>]*>My Week<\/h2>/)
    assert.match(html, /data-week-range=""[^>]*>Sep 28, 2026 – Oct 4, 2026</)
    for (const nav of ['prev', 'today', 'next']) assert.match(html, new RegExp(`data-nav="${nav}"`), nav)
    assert.ok(/<button[^>]*data-nav="today"[^>]*>/.exec(html)?.[0].includes('disabled=""'), 'this week: Today has nowhere to go')
    assert.equal((html.match(/data-day="2026-/g) ?? []).length, 7)
    assert.doesNotMatch(html, /Your doctor appointments/)
    assert.match(html, /data-manager=""[^>]*>Mary Manager/)
  })

  it('a shift card carries the hours and the staff member\'s name; an appointment card its own tint, clock, title and doctor', () => {
    const html = draw(<FamilyWeekScreen state={ready(week())} onWeek={noop} onRetry={noop} />)
    const mon = column(html, '2026-09-28')
    assert.match(mon, /data-state="shifts"/)
    assert.match(mon, /data-shift=""[\s\S]*?7:00A-3:00P[\s\S]*?Ann Staff/)
    const wed = column(html, '2026-09-30')
    assert.match(wed, /data-appointment=""[^>]*bg-tint-mint[\s\S]*?10:00 AM[\s\S]*?Dentist[\s\S]*?Dr Ada · 12 Main St/)
    assert.match(wed, /data-shift=""[\s\S]*?11:00P-7:00A[\s\S]*?Ben Night/)
    assert.match(wed, /Hours not written[\s\S]*?Cy Day/)
    assert.ok(wed.indexOf('data-appointment') < wed.indexOf('data-shift'), 'the appointment stands above the shifts')
    assert.doesNotMatch(wed, /No shifts/)
  })

  it('"No shifts" only where the house calendar shows the day; a day it does not reach says so', () => {
    const html = draw(<FamilyWeekScreen state={ready(week())} onWeek={noop} onRetry={noop} />)
    assert.match(column(html, '2026-09-29'), /data-state="none"[\s\S]*?No shifts/)
    const sat = column(html, '2026-10-03')
    assert.match(sat, /data-state="not_drawn"/)
    assert.match(sat, /No house calendar shows this day\./)
    assert.doesNotMatch(sat, /No shifts/)
  })

  it('the Time switch spells a shift\'s hours as it does every other card', () => {
    const shift = { day: '2026-09-28', staff: 'Ann Staff', start: '07:00', end: '15:00' }
    assert.match(flat(renderToString(<StaffShiftChip shift={shift} clock={false} />)), /7:00A-3:00P/)
    assert.match(flat(renderToString(<StaffShiftChip shift={shift} clock />)), /7:00 AM – 3:00 PM/)
    assert.equal(familyShiftCode({ start: '23:00', end: '07:00' }), '11:00P-7:00A')
    assert.equal(familyShiftCode({ start: '00:30', end: '12:00' }), '12:30A-12:00P')
    assert.equal(familyShiftCode({ start: '07:00', end: '' }), 'From 7:00A')
    assert.equal(familyShiftCode({ start: '', end: '' }), '')
    const html = flat(renderToString(<AppointmentChip appointment={{ day: '2026-09-30', title: '', doctor: '', time: '', place: '', status: '' }} />))
    assert.match(html, /Appointment[\s\S]*?Doctor appointment/)
    assert.equal(appointmentLine({ doctor: 'Dr Ada', place: '' }), 'Dr Ada')
  })

  it('only an appointment with no day written stays unplaced, said once; none, no line', () => {
    const none = draw(<FamilyWeekScreen state={ready(week())} onWeek={noop} onRetry={noop} />)
    assert.doesNotMatch(none, /no date yet/)
    assert.match(none, /Next appointment after this week: Eye doctor on Oct 9, 2026\./)
    const three = week()
    three.appointments = { ...three.appointments!, undated: 3 }
    const html = draw(<FamilyWeekScreen state={ready(three)} onWeek={noop} onRetry={noop} />)
    assert.equal((html.match(/no date yet/g) ?? []).length, 1)
    assert.match(html, /3 appointments on file have no date yet, so they are not placed on a day\./)
    assert.equal(undatedLine(1), 'One appointment on file has no date yet, so it is not placed on a day.')
    assert.equal(undatedLine(0), '')
    assert.equal(nextLine(null), '')
  })

  it('shifts that could not be read say so once, and no day claims "No shifts"; shut ones are said as shut', () => {
    const down = week({
      shifts: { rows: [], drawn: [], houses: [], source: src('shifts', 'unreadable', { label: 'Shifts at the house', why: 'The house calendar could not be read (down).' }) },
    })
    const html = draw(<FamilyWeekScreen state={ready(down)} onWeek={noop} onRetry={noop} />)
    assert.equal((html.match(/The house calendar could not be read \(down\)\./g) ?? []).length, 1)
    assert.doesNotMatch(html, /No shifts|No house calendar shows this day|data-shift=/)
    assert.match(column(html, '2026-09-30'), /Dentist/)
    const shut = week({
      shifts: { rows: [], drawn: [], houses: [], source: src('shifts', 'not_applicable', { label: 'Shifts at the house', why: 'This is not open to this account in App Control.' }) },
    })
    const off = draw(<FamilyWeekScreen state={ready(shut)} onWeek={noop} onRetry={noop} />)
    assert.match(off, /Shifts at the house: This is not open to this account in App Control\./)
    assert.doesNotMatch(off, /No shifts|data-shift=/)
  })

  it('appointments read only in part say which part could not be read, and draw what was', () => {
    const half = week()
    half.appointments = { ...half.appointments!, source: src('appointments', 'ok', { count: 1, why: 'The Dr Appt Archive could not be read (down). What could be read is shown.' }) }
    const html = draw(<FamilyWeekScreen state={ready(half)} onWeek={noop} onRetry={noop} />)
    assert.match(html, /data-week-lines=""[\s\S]*?The Dr Appt Archive could not be read \(down\)\. What could be read is shown\./)
    assert.match(column(html, '2026-09-30'), /Dentist/)
  })

  it('a guardian reads the same week in the client\'s name', () => {
    const html = draw(<FamilyWeekScreen state={ready(week({ viewer: 'guardian' }))} onWeek={noop} onRetry={noop} />)
    assert.match(html, /<h2[^>]*>Jane’s week<\/h2>/)
    assert.match(column(html, '2026-09-28'), /Ann Staff/)
  })

  it('another week\'s answer is never drawn under the week asked for: the card reads it, with the asked range', () => {
    const html = draw(<FamilyWeekScreen state={ready(week(), { refreshing: true })} asked="2026-10-07" onWeek={noop} onRetry={noop} />)
    assert.match(html, /data-week-range=""[^>]*>Oct 5, 2026 – Oct 11, 2026</)
    assert.match(html, /Reading the week…/)
    assert.doesNotMatch(html, /data-day="2026-/)
    const failed = draw(<FamilyWeekScreen state={ready(week(), { status: 'failed', error: 'no answer' })} asked="2026-10-05" onWeek={noop} onRetry={noop} />)
    assert.match(failed, /This week could not be read: no answer/)
    assert.equal(familyWeekCurrent(week(), ''), true)
    assert.equal(familyWeekCurrent(week(), '2026-09-30'), true)
    assert.equal(familyWeekCurrent(week(), '2026-10-05'), false)
    assert.equal(familyWeekCurrent({ ...week(), week: { ...week().week!, from: '2026-10-05' } }, ''), false)
  })

  it('‹ and › ask for the week before and after, Today for this week', () => {
    const asked: string[] = []
    const onWeek = (w: string) => { asked.push(w) }
    const later = week({ week: { from: '2026-10-05', to: '2026-10-11', prev: '2026-09-28', next: '2026-10-12', this: '2026-09-28' } })
    const screen = FamilyWeekScreen({ state: ready(later), asked: '2026-10-05', onWeek, onRetry: noop })
    const [card] = pick(screen, (el) => el.type === WeekCard)
    assert.ok(card, 'the screen draws the natural WeekCard')
    const props = card.props as Parameters<typeof WeekCard>[0]
    const mounted = mountHook(() => WeekCard(props), null)
    const button = (nav: string) => pick(mounted.current, (el) => el.props['data-nav'] === nav)[0]
    for (const nav of ['prev', 'next', 'today']) (button(nav).props.onClick as () => void)()
    mounted.unmount()
    // the week before is this week, asked for as ''
    assert.deepEqual(asked, ['', '2026-10-12', ''])
  })

  it('a day\'s cards are the backend\'s alone, and none from a part that could not be read', () => {
    const v = week()
    assert.deepEqual(familyDayOf(v, '2026-09-30').shifts.map((s) => s.staff), ['Ben Night', 'Cy Day'])
    assert.deepEqual(familyDayOf(v, '2026-09-30').appointments.map((a) => a.title), ['Dentist'])
    const down = week({ appointments: { rows: v.appointments!.rows, next: null, undated: 0, source: src('appointments', 'unreadable') } })
    assert.deepEqual(familyDayOf(down, '2026-09-30').appointments, [])
    const days = familyWeekOf(v)?.days.map((d) => `${d.iso}:${d.state}`)
    assert.deepEqual(days, ['2026-09-28:shifts', '2026-09-29:none', '2026-09-30:shifts', '2026-10-01:none', '2026-10-02:none',
      '2026-10-03:not_drawn', '2026-10-04:not_drawn'])
  })
})
