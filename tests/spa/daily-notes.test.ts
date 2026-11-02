/**
 * The Daily notes on a client's chart (src/pages/features/clients/daily):
 * ONE PAGE IS ONE DAY, newest day first, the day's notes together on it — and
 * the reader's place, the filter and the page, kept while the accordion has
 * the section unmounted, for as long as the chart stays on that client.
 *
 * THE TWO REGRESSIONS THIS FILE EXISTS FOR. The first: open Medications, come
 * back to Daily, and the reader was on page 1 of All again, whatever they had
 * paged back to — every test below that unmounts and mounts again is that
 * click. The second: the section paged by CALL, so one busy day was cut across
 * six screens that each repeated the day's whole note total, and the Record
 * view poured ten days onto one page and pushed the chart down — every test
 * below that counts pages against days is that.
 *
 * daily-screen.test.tsx holds the section itself to calling what is tested here.
 */
import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DailyNote } from '@/pages/features/clients/daily/dailyApi'
import {
  DAYS_PER_PAGE, callTimeDisputedLine, dayCountLine, dayPagerNoun, groupNotes,
} from '@/pages/features/clients/daily/grouping'
import {
  type DailyLook, forgetDailyPlace, forgetKeptFilters, keptFilter, placeKey, useDailyPlace, useDailyPlaceScope,
} from '@/pages/features/clients/daily/useDailyPlace'
import { forgetKeptPages } from '@/lib/pager'
import { forgetAllKept } from '@/lib/kept'
import { mountHook } from './react-host'
import {
  LATER, LATER_SAME_DAY, NEWEST_DAYS_FIRST, NOTES, NO_SHIFT, TWICE_FILED, TWICE_FILED_AT,
  TWICE_FILED_ORDER, UNTIMED, manyDays, note,
} from './daily-fixture'

type Props = { look: DailyLook; client: string; notes: DailyNote[] }
const useDaily = ({ look, client, notes }: Props) => useDailyPlace(look, client, notes, 'read')

/** The day on screen — one page is one day, so this is one date. */
const shown = (h: { current: ReturnType<typeof useDaily> }) => h.current.pager.slice.map((d) => d.day)
/** Every note on the page, in the order the page draws them. */
const notesOn = (h: { current: ReturnType<typeof useDaily> }) =>
  h.current.pager.slice.flatMap((d) => d.calls.flatMap((c) => c.notes.map((n) => n.id)))

/** The chart page's hold on the place — the component that outlives the section. */
const useChart = ({ client }: { client: string }) => useDailyPlaceScope(client)

/** One chart, the section inside it, both on one client — the chart switching client under it. */
const useChartWithDaily = ({ client, notes }: { client: string; notes: DailyNote[] }) => {
  useDailyPlaceScope(client)
  return useDailyPlace('unique', client, notes, 'read')
}

/** The shift as the relay placed it on a read where the schedule answered… */
function bySchedule(n: DailyNote): DailyNote {
  return {
    ...n,
    shift: {
      via: 'schedule', label: 'Afternoon', start: '14:30', end: '22:00', house: 'H1', at_client_house: true,
      staff_match: 'exact', date: n.reporting_date, source: 'schedule', covers_call: true,
    },
  }
}
/** …and on the next read, when no copy of the schedule answered. */
function byCallTime(n: DailyNote): DailyNote {
  return { ...n, shift: { ...NO_SHIFT, via: 'call_time', label: 'Afternoon' } }
}

const LOOKS: DailyLook[] = ['record', 'unique']

beforeEach(() => {
  forgetKeptPages()
  forgetKeptFilters()
})

describe('Daily notes — the days, newest first', () => {
  it('orders the days newest first, with an undated day last', () => {
    assert.deepEqual(groupNotes(NOTES).map((d) => d.day), NEWEST_DAYS_FIRST)
  })

  it('orders the calls inside a day newest first, and a call’s notes in the order the book wrote them', () => {
    const sep20 = groupNotes(NOTES)[1]
    assert.deepEqual(sep20.calls.map((c) => c.callId), ['c2', 'c1'])
    assert.deepEqual(sep20.calls[1].notes.map((n) => n.id), ['r10', 'r11'])
    assert.equal(sep20.count, 3)
  })

  it('puts a call with no readable time after every timed call of its day', () => {
    const days = groupNotes([
      note('r2', 'untimed', '2026-09-20', ''),
      note('r1', 'early', '2026-09-20', '2026-09-20T06:00:00Z'),
    ])
    assert.deepEqual(days[0].calls.map((c) => c.callId), ['early', 'untimed'])
  })
})

describe('Daily notes — one page is one day', () => {
  for (const look of LOOKS) {
    it(`the ${look} view pages by day: as many pages as days, not notes or calls`, () => {
      const h = mountHook(useDaily, { look, client: 'Jo Doe', notes: NOTES })
      assert.equal(DAYS_PER_PAGE, 1)
      assert.equal(h.current.pager.pages, 4, 'eight notes, five calls, four days')
      assert.equal(h.current.pager.total, 4)
      assert.deepEqual(shown(h), ['2026-09-21'])
      h.run(() => h.current.pager.setPage(3))
      assert.deepEqual(shown(h), [''], 'the last page is the undated day')
      h.unmount()
    })
  }

  it('walks the days one at a time, newest first, the undated one last', () => {
    const h = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    const walk: string[] = []
    for (let p = 0; p < h.current.pager.pages; p++) {
      h.run(() => h.current.pager.setPage(p))
      assert.equal(h.current.pager.slice.length, 1, 'one day on the page')
      walk.push(...shown(h))
    }
    assert.deepEqual(walk, NEWEST_DAYS_FIRST)
    h.unmount()
  })

  it('a day with several calls keeps every note of that day together, in order, on its page', () => {
    const h = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    h.run(() => h.current.pager.setPage(1))
    assert.deepEqual(shown(h), ['2026-09-20'])
    // c2 (20:00) before c1 (13:00), and c1's own notes as the book wrote them
    assert.deepEqual(notesOn(h), ['r12', 'r10', 'r11'])
    assert.equal(h.current.pager.slice[0].count, 3, 'the day’s own note total')
    h.unmount()
  })

  it('a day whose call the grouping split keeps both parts on the one page', () => {
    const split = [
      note('r40', 'c7', '2026-09-23', '2026-09-23T10:00:00Z', { dsp_name: 'Ann Lee' }),
      note('r41', 'c7', '2026-09-23', '2026-09-23T10:00:00Z', { dsp_name: 'Anne Lee' }),
      ...NOTES,
    ]
    const h = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: split })
    assert.deepEqual(shown(h), ['2026-09-23'])
    assert.equal(h.current.pager.slice[0].calls.length, 2, 'two headers, one day')
    // the two parts share the call's instant, so the later row is the later report
    assert.deepEqual(notesOn(h), ['r41', 'r40'])
    h.unmount()
  })

  it('a client with many days: one page each, and the page walks to the oldest', () => {
    const many = manyDays()
    const h = mountHook(useDaily, { look: 'record', client: 'Jo Doe', notes: many })
    assert.equal(h.current.pager.pages, 25)
    assert.deepEqual(shown(h), ['2026-08-25'])
    h.run(() => h.current.pager.setPage(24))
    assert.deepEqual(shown(h), ['2026-08-01'])
    h.unmount()
  })

  it('the filter narrows the days it pages through', () => {
    const h = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    h.run(() => h.current.setFilter('not_daily'))
    assert.equal(h.current.filter, 'not_daily')
    assert.equal(h.current.pager.pages, 1, 'one note is not daily, on one day')
    assert.deepEqual(shown(h), ['2026-09-21'])
    assert.deepEqual(notesOn(h), ['r21'])
    h.unmount()
  })

  it('no notes: no days, one empty page, nothing to page', () => {
    const h = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: [] })
    const p = h.current.pager
    assert.deepEqual(h.current.days, [])
    assert.deepEqual([p.page, p.pages, p.total, p.slice.length], [0, 1, 0, 0])
    h.unmount()
  })
})

describe('Daily notes — a call the book timed more than one way', () => {
  it('gives every part of one call the call’s earliest instant, not the latest of one part', () => {
    const [day] = groupNotes(TWICE_FILED)
    const parts = day.calls.filter((c) => c.callId === 'twice')
    assert.equal(parts.length, 2, 'two headers: the part of the day differs with the stamp')
    assert.deepEqual(parts.map((c) => c.callAt), [TWICE_FILED_AT, TWICE_FILED_AT])
  })

  it('counts the times the book gave the call, across both its headers', () => {
    const [day] = groupNotes(TWICE_FILED)
    assert.deepEqual(day.calls.map((c) => [c.callId, c.readings]),
      [['mid', 1], ['twice', 2], ['twice', 2]])
  })

  it('keeps the two parts of one call side by side, not hours apart', () => {
    const [day] = groupNotes(TWICE_FILED)
    assert.deepEqual(day.calls.flatMap((c) => c.notes.map((n) => n.id)), TWICE_FILED_ORDER)
    assert.equal(day.count, 5, 'and every note of the day is still on it')
  })

  it('a call the book never timed carries no instant and no reading', () => {
    const [day] = groupNotes(UNTIMED)
    assert.deepEqual(day.calls.map((c) => [c.callAt, c.readings]), [['', 0]])
  })

  it('says, instead of a clock, that the call was filed more than once', () => {
    assert.equal(callTimeDisputedLine(2, true),
      'Filed more than once — the book gives this call 2 different times, '
      + 'so none is shown, nor the part of the day it fell in.')
    assert.equal(callTimeDisputedLine(3, false),
      'Filed more than once — the book gives this call 3 different times, so none is shown.')
  })

  it('marks a shift placed by the call’s own clock as that clock’s', () => {
    const [day] = groupNotes(TWICE_FILED)
    assert.ok(day.calls.every((c) => c.shift.byCallTime), 'every one was placed by call time')
    assert.equal(groupNotes(NOTES)[0].calls[0].shift.byCallTime, false, 'and a shift nothing placed is not')
  })
})

describe('Daily notes — what the pager’s line counts', () => {
  it('counts days, and says so when the last page is not one', () => {
    assert.equal(dayPagerNoun(groupNotes(NOTES)), 'days, one undated')
    assert.equal(dayPagerNoun(groupNotes(manyDays())), 'days')
    assert.equal(dayPagerNoun([]), 'days')
  })
})

describe('Daily notes — the count beside the day', () => {
  it('counts the notes on the page, which is the day’s own total', () => {
    assert.equal(dayCountLine({ count: 53 }), '· 53 notes')
    assert.equal(dayCountLine({ count: 1 }), '· 1 note')
    assert.equal(dayCountLine({ count: 0 }), '· 0 notes')
  })

  it('is the number the day on the page actually carries', () => {
    const h = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    h.run(() => h.current.pager.setPage(1))
    const day = h.current.pager.slice[0]
    assert.equal(dayCountLine(day), '· 3 notes')
    assert.equal(day.count, notesOn(h).length)
    h.unmount()
  })
})

describe('Daily notes — the place survives Medications and back', () => {
  it('the same day is on screen after the section unmounts and mounts again', () => {
    const chart = mountHook(useChart, { client: 'Jo Doe' })
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.pager.setPage(2))
    assert.deepEqual(shown(a), ['2026-09-19'])
    a.unmount() // Medications opens: the accordion unmounts Daily
    const b = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    assert.equal(b.current.pager.page, 2)
    assert.deepEqual(shown(b), ['2026-09-19'])
    b.unmount()
    chart.unmount()
  })

  it('the filter comes back with its page', () => {
    const chart = mountHook(useChart, { client: 'Jo Doe' })
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.setFilter('daily'))
    a.run(() => a.current.pager.setPage(2))
    a.unmount()
    const b = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    assert.equal(b.current.filter, 'daily')
    assert.equal(b.current.pager.page, 2)
    b.unmount()
    chart.unmount()
  })

  it('another client’s section opens on its newest day under All', () => {
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.setFilter('daily'))
    a.run(() => a.current.pager.setPage(2))
    a.unmount()
    const other = mountHook(useDaily, { look: 'unique', client: 'Al Roe', notes: NOTES })
    assert.equal(other.current.filter, 'all')
    assert.equal(other.current.pager.page, 0)
    assert.deepEqual(shown(other), ['2026-09-21'])
    other.unmount()
  })

  it('changing the filter starts at page 1, and changing it back does not revive the old page', () => {
    const h = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    h.run(() => h.current.pager.setPage(2))
    h.run(() => h.current.setFilter('daily'))
    assert.equal(h.current.pager.page, 0)
    h.run(() => h.current.setFilter('all'))
    assert.equal(h.current.pager.page, 0)
    h.unmount()
    const again = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    assert.equal(again.current.pager.page, 0)
    again.unmount()
  })

  it('a newer day filed while away: page 1 is still the newest, and the reader is still on theirs', () => {
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.pager.setPage(2))
    a.unmount()
    const b = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: [...NOTES, LATER] })
    assert.equal(b.current.days[0].day, '2026-09-22', 'the new day is page 1')
    assert.deepEqual(shown(b), ['2026-09-19'])
    assert.equal(b.current.pager.page, 3)
    assert.equal(b.current.pager.pages, 5)
    b.unmount()
  })

  it('a note filed on the day the reader is reading joins the page they are on', () => {
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.pager.setPage(1))
    assert.deepEqual(notesOn(a), ['r12', 'r10', 'r11'])
    a.unmount()
    const b = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: [...NOTES, LATER_SAME_DAY] })
    assert.deepEqual(shown(b), ['2026-09-20'], 'still their day')
    assert.equal(b.current.pager.page, 1, 'and still page 2 of four')
    assert.deepEqual(notesOn(b), ['r31', 'r12', 'r10', 'r11'], 'the newer call at the top of the day')
    b.unmount()
  })

  it('a day filed while away AND the shifts placed another way: still on the day they were reading', () => {
    // the review's repro: the schedule answered on the first read and not on
    // the next, so every grouping key moved, and one new day came in front
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES.map(bySchedule) })
    a.run(() => a.current.pager.setPage(1))
    assert.deepEqual(shown(a), ['2026-09-20'])
    a.unmount()
    const b = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: [...NOTES.map(byCallTime), LATER] })
    assert.deepEqual(shown(b), ['2026-09-20'], 'not the newer day the reader already read')
    assert.equal(b.current.pager.page, 2)
    b.unmount()
  })

  it('a reader who was on page 1 comes back to the newest day, new or not', () => {
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.pager.setPage(2))
    a.run(() => a.current.pager.setPage(0))
    a.unmount()
    const b = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: [...NOTES, LATER] })
    assert.deepEqual(shown(b), ['2026-09-22'])
    b.unmount()
  })

  it('while the notes are read again, the kept page waits for them', () => {
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.pager.setPage(2))
    a.unmount()
    // the section's memory of the notes has gone stale: it mounts with none
    const b = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: [] })
    assert.equal(b.current.pager.total, 0)
    b.rerender({ look: 'unique', client: 'Jo Doe', notes: NOTES })
    assert.deepEqual(shown(b), ['2026-09-19'])
    b.unmount()
  })

  it('the Record view keeps its own page, apart from Unique', () => {
    const many = manyDays()
    const rec = mountHook(useDaily, { look: 'record', client: 'Jo Doe', notes: many })
    assert.equal(rec.current.pager.pages, 25)
    rec.run(() => rec.current.pager.setPage(2))
    rec.unmount()
    const uni = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: many })
    assert.equal(uni.current.pager.page, 0)
    uni.unmount()
    const rec2 = mountHook(useDaily, { look: 'record', client: 'Jo Doe', notes: many })
    assert.equal(rec2.current.pager.page, 2)
    assert.deepEqual(shown(rec2), ['2026-08-23'])
    rec2.unmount()
  })

  it('a sign-out forgets the place', () => {
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.setFilter('daily'))
    a.run(() => a.current.pager.setPage(2))
    a.unmount()
    forgetAllKept()
    assert.equal(keptFilter(placeKey('unique', 'Jo Doe')), 'all')
    const b = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    assert.equal(b.current.filter, 'all')
    assert.equal(b.current.pager.page, 0)
    b.unmount()
  })
})

describe('Daily notes — the chart holds the place, not the session', () => {
  it('the chart moving to another client forgets the first: coming back opens on the newest under All', () => {
    const chart = mountHook(useChart, { client: 'Jo Doe' })
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.setFilter('daily'))
    a.run(() => a.current.pager.setPage(2))
    a.unmount()
    chart.rerender({ client: 'Al Roe' })
    const other = mountHook(useDaily, { look: 'unique', client: 'Al Roe', notes: NOTES })
    assert.deepEqual([other.current.filter, other.current.pager.page], ['all', 0])
    other.run(() => other.current.pager.setPage(1))
    other.unmount()
    chart.rerender({ client: 'Jo Doe' })
    const back = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    assert.equal(back.current.filter, 'all')
    assert.equal(back.current.pager.page, 0)
    back.unmount()
    chart.unmount()
  })

  it('the chart closing forgets the place, in both views', () => {
    const chart = mountHook(useChart, { client: 'Jo Doe' })
    const uni = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: manyDays() })
    uni.run(() => uni.current.setFilter('daily'))
    uni.run(() => uni.current.pager.setPage(6))
    uni.unmount()
    const rec = mountHook(useDaily, { look: 'record', client: 'Jo Doe', notes: manyDays() })
    rec.run(() => rec.current.pager.setPage(2))
    rec.unmount()
    chart.unmount() // the Clients list, another view, another app
    const uni2 = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: manyDays() })
    assert.deepEqual([uni2.current.filter, uni2.current.pager.page], ['all', 0])
    uni2.unmount()
    const rec2 = mountHook(useDaily, { look: 'record', client: 'Jo Doe', notes: manyDays() })
    assert.equal(rec2.current.pager.page, 0)
    rec2.unmount()
  })

  it('the chart switching client under a mounted section starts the other client at the top, and keeps nothing', () => {
    const h = mountHook(useChartWithDaily, { client: 'Jo Doe', notes: NOTES })
    h.run(() => h.current.pager.setPage(2))
    h.rerender({ client: 'Al Roe', notes: NOTES })
    assert.equal(h.current.pager.page, 0)
    h.rerender({ client: 'Jo Doe', notes: NOTES })
    assert.equal(h.current.pager.page, 0)
    h.unmount()
  })

  it('a chart whose client list is still loading holds nothing, and keeps the place once the client lands', () => {
    const chart = mountHook(useChart, { client: '' })
    chart.rerender({ client: 'Jo Doe' }) // the client list landed
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.pager.setPage(2))
    a.unmount()
    const b = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    assert.equal(b.current.pager.page, 2)
    b.unmount()
    chart.unmount()
  })

  it('forgetting one client’s place leaves another’s alone', () => {
    const a = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    a.run(() => a.current.pager.setPage(2))
    a.unmount()
    const b = mountHook(useDaily, { look: 'unique', client: 'Al Roe', notes: NOTES })
    b.run(() => b.current.setFilter('daily'))
    b.run(() => b.current.pager.setPage(1))
    b.unmount()
    forgetDailyPlace('Jo Doe')
    const again = mountHook(useDaily, { look: 'unique', client: 'Jo Doe', notes: NOTES })
    assert.equal(again.current.pager.page, 0)
    again.unmount()
    const other = mountHook(useDaily, { look: 'unique', client: 'Al Roe', notes: NOTES })
    assert.deepEqual([other.current.filter, other.current.pager.page], ['daily', 1])
    other.unmount()
  })
})
