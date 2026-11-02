/**
 * Scheduling › Staff Calendars, as the operator asked on 10-30: the dropdown lists only the active staff (what the
 * read says Staff's roster holds as active; nobody inactive, archived or not staff), the shifts table reads Date,
 * Location, Start time, End time with no Status column, and a location opens that house's House Calendar in Locations,
 * only for a house with a code that Locations opens to the viewer.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import StaffCalendars, {
  OPEN_WHO, STAFF_COLUMNS, ShiftRows, choicesFor, houseCalendarHref, othersFor,
} from '@/pages/features/scheduling/StaffCalendars'
import { boardFrom, type Board } from '@/pages/features/scheduling/schedulingModel'
import type { StaffShift } from '@/pages/features/scheduling/schedulingLane'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const PEOPLE = [
  { key: 'annroe', name: 'Ann Roe', has_account: true },
  { key: 'bobfar', name: 'Bob Far', has_account: true, phone: '3305550101' },
  { key: 'carlgone', name: 'Carl Gone', has_account: true },
  { key: 'doraclient', name: 'Dora Client', has_account: true },
  { key: 'evaactive', name: 'Eva Active', has_account: false },
]

function board(viewer: Record<string, unknown> = {}): Board {
  return boardFrom({
    ok: true, now: '2026-10-30T12:00:00Z', today: '2026-10-30',
    period: { id: 'P2026-10-26', first: '2026-10-26', last: '2026-11-22', state: 'live' },
    periods: [{ id: 'P2026-10-26', first: '2026-10-26', last: '2026-11-22', state: 'live' }],
    houses: [
      { code: 'BM4060', location: 'CAN - BM - BM4060', short: 'BM', staff: 2, managers: [], open: 0 },
      { code: 'WORKSHOP', location: 'Workshop', short: 'Workshop', staff: 0, managers: [], open: 0 },
    ],
    viewer: { uid: 'U1', name: 'Ann Roe', key: 'annroe', is_master: false, is_director: false, editor_of: [], can_edit_any: false, ...viewer },
    test_mode: { on: false, readable: true, why: '' },
    display: { hidden: { hours: true } },
    settings: { min_days_ahead: 7, outreach_wait_min: 7, cycle_days: 28, roll_lead_days: 7, directors: [], directors_readable: true },
    grids: {}, busy: {}, people: PEOPLE, mine: [], waiting_on_me: [],
  })
}

const MASTER = { is_master: true, can_edit_any: true }

describe('Staff Calendars — the dropdown lists only the active staff', () => {
  it('a viewer who chooses anybody gets Open, themselves, then only the people the read calls active, by name', () => {
    const got = choicesFor(board(MASTER), ['evaactive', 'bobfar', 'annroe'])
    assert.deepEqual(got.map((c) => c.key), [OPEN_WHO, 'annroe', 'bobfar', 'evaactive'])
    assert.deepEqual(got.map((c) => c.chip), ['Open shifts', 'You', '', ''])
    assert.equal(got.find((c) => c.key === 'bobfar')?.phone, '(330) 555-0101')
    for (const gone of ['carlgone', 'doraclient']) assert.ok(!got.some((c) => c.key === gone), `${gone} is not listed`)
  })

  it('a key the read names that is on no calendar is not invented', () => {
    assert.deepEqual(othersFor(board(MASTER), ['bobfar', 'nobodyhere']).map((p) => p.key), ['bobfar'])
  })

  it('a director and a house manager are held to the same list', () => {
    for (const v of [{ is_director: true }, { editor_of: ['BM4060'] }]) {
      assert.deepEqual(othersFor(board(v), ['bobfar']).map((p) => p.key), ['bobfar'], JSON.stringify(v))
    }
  })

  it('nobody else is listed until the read answers; everyone on the calendars when the staff list could not be read', () => {
    assert.deepEqual(choicesFor(board(MASTER), undefined).map((c) => c.key), [OPEN_WHO, 'annroe'])
    assert.deepEqual(othersFor(board(MASTER), null).map((p) => p.key), ['bobfar', 'carlgone', 'doraclient', 'evaactive'])
  })

  it('a viewer who chooses only themselves still gets Open and themselves, whatever the list', () => {
    assert.deepEqual(choicesFor(board(), ['bobfar', 'annroe']).map((c) => c.key), [OPEN_WHO, 'annroe'])
    assert.deepEqual(othersFor(board(), null), [])
  })
})

const SHIFT = (house: string, date: string, over: Partial<StaffShift> = {}): StaffShift => ({
  period_id: 'P2026-10-26', house_code: house, row_id: 'P:bobfar', date, text: '8A-4P', kind: 'morning', state: 'scheduled',
  start: 8, end: 16, ...over,
})

const rows = (shifts: StaffShift[], calendarHref: (house: string) => string) => renderToString(createElement(MemoryRouter, null,
  createElement(ShiftRows, { board: board(MASTER), shifts, today: '2026-10-30', openKey: '', onOpen: () => {}, calendarHref })))

describe('Staff Calendars — Date, Location, Start time, End time, and no Status', () => {
  it('the header reads the four columns in that order', () => {
    assert.deepEqual([...STAFF_COLUMNS], ['Date', 'Location', 'Start time', 'End time'])
    const html = renderToString(createElement(MemoryRouter, null, createElement(StaffCalendars, {
      board: board(MASTER), who: OPEN_WHO, onWho: () => {}, tick: 0, openKey: '', onOpen: () => {},
    })))
    const head = /<div class="[^"]*uppercase[^"]*">(.*?)<\/div>/.exec(html)?.[1] ?? ''
    assert.deepEqual([...head.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]), ['Date', 'Location', 'Start time', 'End time'])
    assert.ok(!html.includes('>Status<'), 'no Status column')
  })

  it('each row draws its cells in the header order and no state pill', () => {
    const called = SHIFT('BM4060', '2026-10-31', { state: 'called_off' })
    const html = rows([SHIFT('BM4060', '2026-10-30'), called], () => '')
    for (const row of html.split('data-shift-row=').slice(1)) {
      assert.deepEqual([...row.matchAll(/data-col="([a-z]+)"/g)].map((m) => m[1]), ['date', 'location', 'start', 'end'])
    }
    assert.match(html, /Fri, Oct 30.*Today.*>BM<.*8:00 AM.*4:00 PM/s)
    assert.ok(!/Called off|rounded-full px-2 py-0\.5/.test(html), 'no pills where the Status column was')
  })

  it('the row still opens the shift: one button per row, holding no link', () => {
    const html = rows([SHIFT('BM4060', '2026-10-30')], () => '/somewhere')
    assert.equal((html.match(/<button/g) ?? []).length, 1)
    assert.match(html, /<button[^>]*data-shift="BM4060\|P:bobfar\|2026-10-30"[^>]*><\/button>/)
  })
})

describe('Staff Calendars — a location opens Locations › House Calendar', () => {
  const ALL = { cut: false, houses: null }
  it('the link is the Locations route itself, on the House Calendar tab', () => {
    assert.equal(houseCalendarHref('BM4060', true, ALL), '/app/locations/overview?house=BM4060&tab=calendar')
    assert.equal(houseCalendarHref('CAN - BM - BM4060', true, ALL), '/app/locations/overview?house=BM4060&tab=calendar')
  })

  it('a house with no code is plain text', () => {
    assert.equal(houseCalendarHref('WORKSHOP', true, ALL), '')
    assert.equal(houseCalendarHref('', true, ALL), '')
  })

  it("never a page the viewer cannot open: Locations shut, its scope unread, cut, or not holding the house", () => {
    assert.equal(houseCalendarHref('BM4060', false, ALL), '', 'Locations is not open to the viewer')
    assert.equal(houseCalendarHref('BM4060', true, null), '', 'the scope has not answered')
    assert.equal(houseCalendarHref('BM4060', true, { cut: true, houses: null }), '', 'a cut view shows no House Calendar')
    const one = (code: string) => ({ code, title: code, address: '', photo: '', clients: [], clientCount: 0 })
    assert.equal(houseCalendarHref('BM4060', true, { cut: false, houses: [one('NW4045')] }), '', 'another house only')
    assert.equal(houseCalendarHref('BM4060', true, { cut: false, houses: [one('NW4045'), one('BM4060')] }),
      '/app/locations/overview?house=BM4060&tab=calendar')
  })

  it('the row draws the link only where the house has one, and plain text elsewhere', () => {
    const href = (house: string) => houseCalendarHref(house, true, ALL)
    const html = rows([SHIFT('BM4060', '2026-10-30'), SHIFT('WORKSHOP', '2026-10-31', { row_id: 'P:bobfar2' })], href)
    const link = /<a ([^>]*)>BM<\/a>/.exec(html)?.[1] ?? ''
    assert.match(link, /href="\/app\/locations\/overview\?house=BM4060&amp;tab=calendar"/)
    assert.match(link, /data-house-calendar="BM4060"/)
    assert.equal((html.match(/<a /g) ?? []).length, 1, 'one link, the house with a code')
    assert.ok(!html.includes('data-house-calendar="WORKSHOP"'), 'the code-less house carries no link')
    assert.match(html, /<span class="truncate">Workshop<\/span>/)
  })
})
