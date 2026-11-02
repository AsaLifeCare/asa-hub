/**
 * TIME RECONCILIATION — what its screens keep while the lanes answer again.
 *
 * The queue's sections and pages are the reviewer's place in the work: a resolve refetches the queue quietly, and
 * that refetch must not fold or open sections under them, even when it empties a house or brings a new one. The
 * Overtime panel draws the answer on screen, never the one its row was clicked in. The entries behind a person's
 * weeks are read whole under the lane's 62-day cap. The Close-run warning only counts what the list can say. A blank
 * location keeps the lane's order and totals. And the screen's App Control words say what the screen now is.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { featureOf } from '@/lib/featureAccess'
import ErrorQueue from '@/pages/features/time-recon/ErrorQueue'
import OvertimeTab from '@/pages/features/time-recon/OvertimeTab'
import {
  OPEN_UP_TO, OVERTIME_MAX_DAYS, PER_EMPLOYEE, askKey, entryRanges, openLeftInRun, useOpenPerson, useQueueFolds,
  type QueueAsk,
} from '@/pages/features/time-recon/reconState'
import {
  daySpan, zeroCounts, type OvertimePerson, type PayWeek, type ReconError, type ReconRun,
} from '@/pages/features/time-recon/reconTypes'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const flat = (html: string) => html.replace(/<!-- -->/g, '')
const noop = () => {}

/** Sunday-to-Saturday weeks from `sunday`, `n` of them. */
function weeksFrom(sunday: string, n: number): PayWeek[] {
  const day = (k: number) => new Date(Date.parse(`${sunday}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10)
  return Array.from({ length: n }, (_, i) => ({ from: day(i * 7), to: day(i * 7 + 6), label: `${day(i * 7)} – ${day(i * 7 + 6)}` }))
}

function err(over: Partial<ReconError> = {}): ReconError {
  return {
    id: 'E1', runId: 'R1', type: 'missing', date: '2026-10-14', location: 'ABD1305', employeeId: 'P1',
    employeeName: 'Ann Roe', consumers: [], startTime: '', endTime: '', hours: 0, detail: '', status: 'Open',
    note: '', resolvedBy: '', resolvedAt: '', ...over,
  }
}

function person(key: string, hours: number[]): OvertimePerson {
  const weeks = weeksFrom('2026-10-11', hours.length)
  return {
    key, employeeId: key, employeeName: `Person ${key}`,
    weeks: weeks.map((w, i) => ({ from: w.from, hours: hours[i], over: hours[i] > 40, overtime: Math.max(0, hours[i] - 40) })),
    total: hours.reduce((s, h) => s + h, 0), inRange: hours.reduce((s, h) => s + h, 0),
    overtime: hours.reduce((s, h) => s + Math.max(0, h - 40), 0), days: {},
  }
}

type FoldProps = { key: string; houses: number; filtered?: boolean }
const useFolds = ({ key, houses, filtered }: FoldProps) => useQueueFolds(key, houses, !!filtered)

describe('the queue keeps its folds through a resolve', () => {
  it('more than three houses start folded, and a refetch that empties one keeps every untouched section folded', () => {
    const h = mountHook(useFolds, { key: 'P1|open', houses: OPEN_UP_TO + 1 })
    assert.equal(h.current.isOpen('ABD2005'), false, 'four houses: folded')
    // the last open card of one house resolved: the quiet refetch draws three sections under the SAME filters
    h.rerender({ key: 'P1|open', houses: OPEN_UP_TO })
    assert.equal(h.current.isOpen('ABD2005'), false, 'still folded: the default was decided on the first answer')
    assert.equal(h.current.isOpen('ABD1305'), false)
    h.unmount()
  })

  it('three houses start open, and a refetch that brings a fourth does not shut them', () => {
    const h = mountHook(useFolds, { key: 'P1|open', houses: OPEN_UP_TO })
    assert.equal(h.current.isOpen('ABD2005'), true)
    h.rerender({ key: 'P1|open', houses: OPEN_UP_TO + 1 })
    assert.equal(h.current.isOpen('ABD2005'), true, 'still open')
    h.unmount()
  })

  it('a pressed section and an employee\'s pages survive the refetch; new filters fold and page afresh', () => {
    const h = mountHook(useFolds, { key: 'P1|open', houses: 5 })
    h.run(() => h.current.setOpen('ABD2005', true))
    h.run(() => h.current.showMore('ABD2005|P1'))
    assert.equal(h.current.limitOf('ABD2005|P1'), PER_EMPLOYEE * 2)
    h.rerender({ key: 'P1|open', houses: 4 })
    assert.equal(h.current.isOpen('ABD2005'), true, 'the reviewer opened it: it stays open')
    assert.equal(h.current.isOpen('ABD1305'), false)
    assert.equal(h.current.limitOf('ABD2005|P1'), PER_EMPLOYEE * 2, 'its pages stay')
    // the reviewer picks other filters: the new answer decides its own default, in the render it arrives in
    h.rerender({ key: 'P2|open', houses: 2 })
    assert.equal(h.current.folded, false)
    assert.equal(h.current.isOpen('ABD1305'), true)
    assert.equal(h.current.limitOf('ABD2005|P1'), PER_EMPLOYEE, 'paged afresh')
    h.run(() => h.current.setAll(['ABD1305', 'ABD2005'], false))
    assert.equal(h.current.isOpen('ABD1305'), false)
    h.rerender({ key: 'P3|open', houses: 5 })
    assert.equal(h.current.folded, true)
    assert.equal(h.current.isOpen('ABD1305'), false)
    h.unmount()
  })

  it('an empty answer decides nothing: a Run over an empty period still folds its five houses', () => {
    const h = mountHook(useFolds, { key: 'P1|open', houses: 0 })
    h.rerender({ key: 'P1|open', houses: 5 })
    assert.equal(h.current.folded, true)
    assert.equal(h.current.isOpen('ABD1305'), false)
    h.rerender({ key: 'P1|open', houses: 3 })
    assert.equal(h.current.isOpen('ABD1305'), false, 'and then kept')
    h.unmount()
  })

  it('a house filter opens its section whatever the count', () => {
    const h = mountHook(useFolds, { key: 'P1|ABD1305', houses: 5, filtered: true })
    assert.equal(h.current.isOpen('ABD1305'), true)
    h.unmount()
  })

  it('the key is the filters the answer was read for, every one of them', () => {
    const a: QueueAsk = { from: '2026-10-11', to: '2026-10-24', house: '', employee: '', status: 'open', type: '' }
    assert.equal(askKey(null), '')
    assert.notEqual(askKey(a), askKey({ ...a, type: 'gap' }))
    assert.notEqual(askKey(a), askKey({ ...a, status: 'all' }))
    assert.equal(askKey(a), askKey({ ...a }))
  })
})

describe('the Overtime panel draws the answer on screen', () => {
  type P = { people: OvertimePerson[] | null }
  const useOpen = ({ people }: P) => useOpenPerson(people)

  it('a new answer redraws the open person from it, and closes the panel when it no longer holds them', () => {
    const first = [person('A', [38, 44]), person('B', [50, 41])]
    const h = mountHook(useOpen, { people: first })
    // read through a function: an assertion must not narrow what the next render returns
    const opened = (): OvertimePerson | null => h.current.open
    assert.equal(opened(), null)
    h.run(() => h.current.setOpenKey('A'))
    assert.equal(opened(), first[0])

    // Refresh, or other dates: the same person, other weeks and totals
    const second = [person('A', [45, 46, 47]), person('B', [50, 41, 40])]
    h.rerender({ people: second })
    assert.equal(opened(), second[0], 'the new answer\'s person, never the clicked one')
    assert.deepEqual(opened()?.weeks.map((w) => w.hours), [45, 46, 47])
    assert.equal(opened()?.total, 138)

    // an employee filter that leaves A out: the panel closes…
    h.rerender({ people: [second[1]] })
    assert.equal(opened(), null)
    assert.equal(h.current.openKey, '')
    // …and an answer that brings A back does not reopen it unasked
    h.rerender({ people: second })
    assert.equal(opened(), null)
    h.unmount()
  })
})

describe('the entries behind a person\'s weeks', () => {
  it('61 days picked touch 63 days of weeks: read in runs of whole weeks, each inside the lane\'s cap', () => {
    // 2026-09-01..2026-10-31 → the weeks 08-30..10-31, the proven refusal
    const weeks = weeksFrom('2026-08-30', 9)
    assert.equal(daySpan('2026-09-01', '2026-10-31'), 61)
    assert.equal(daySpan(weeks[0].from, weeks[8].to), 63)
    const got = entryRanges(weeks)
    assert.deepEqual(got, [{ from: '2026-08-30', to: '2026-10-24' }, { from: '2026-10-25', to: '2026-10-31' }])
    for (const r of got) assert.ok(daySpan(r.from, r.to) <= OVERTIME_MAX_DAYS, `${r.from}..${r.to} fits`)
  })

  it('the widest case, 62 days from a Saturday, touches ten weeks and still takes two reads', () => {
    const weeks = weeksFrom('2026-08-30', 10)
    const got = entryRanges(weeks)
    assert.equal(got.length, 2)
    assert.equal(got[0].from, '2026-08-30')
    assert.equal(got[got.length - 1].to, weeks[9].to)
    for (const r of got) assert.ok(daySpan(r.from, r.to) <= OVERTIME_MAX_DAYS)
  })

  it('one pay period is one read, and no week is no read', () => {
    assert.deepEqual(entryRanges(weeksFrom('2026-10-11', 2)), [{ from: '2026-10-11', to: '2026-10-24' }])
    assert.deepEqual(entryRanges([]), [])
  })
})

describe('the Close-run warning counts only what the list can say', () => {
  const run: ReconRun = { id: 'R1', dateFrom: '2026-10-11', dateTo: '2026-10-24', status: 'Review', createdAt: '', createdBy: '' }
  const errors = [err({ id: 'a' }), err({ id: 'b', location: 'ABD2005' }), err({ id: 'c', status: 'Excused' }), err({ id: 'd', runId: 'R0' })]
  const whole: QueueAsk = { from: '2026-10-11', to: '2026-10-24', house: '', employee: '', status: 'open', type: '' }

  it('over the run\'s own dates, or dates covering them, with nothing narrowing: its open anomalies', () => {
    assert.equal(openLeftInRun(run, errors, whole), 2)
    assert.equal(openLeftInRun(run, errors, { ...whole, status: 'all' }), 2)
    assert.equal(openLeftInRun(run, errors, { ...whole, from: '2026-09-27', to: '2026-10-31' }), 2)
  })

  it('a custom range narrower than the run, or any narrowing filter, says nothing rather than a partial count', () => {
    assert.equal(openLeftInRun(run, errors, { ...whole, to: '2026-10-17' }), null)
    assert.equal(openLeftInRun(run, errors, { ...whole, from: '2026-10-12' }), null)
    assert.equal(openLeftInRun(run, errors, { ...whole, house: 'ABD1305' }), null)
    assert.equal(openLeftInRun(run, errors, { ...whole, employee: 'P1' }), null)
    assert.equal(openLeftInRun(run, errors, { ...whole, type: 'missing' }), null)
    assert.equal(openLeftInRun(run, errors, { ...whole, status: 'resolved' }), null)
    assert.equal(openLeftInRun(run, errors, null), null, 'no answer drawn yet')
  })
})

describe('the queue drawn', () => {
  const byType = (n: Partial<ReturnType<typeof zeroCounts>>) => ({ ...zeroCounts(), ...n })

  it('a blank location is the lane\'s house \'\': its section keeps the lane\'s order, full total and type chips', () => {
    const html = flat(renderToString(
      <ErrorQueue
        errors={[err({ id: 'a', location: 'ABD1305' }), err({ id: 'b', location: '', type: 'gap', employeeId: 'P2', employeeName: 'Bo Ray' })]}
        byHouse={[
          { house: '', total: 7, byType: byType({ gap: 4, missing: 3 }) },
          { house: 'ABD1305', total: 2, byType: byType({ missing: 2 }) },
        ]}
        houseFiltered={false} typeFilter="" resetKey="k" empty={{ title: 'x', body: 'y' }}
        onAction={noop} onViewShifts={noop}
      />,
    ))
    const unknown = html.indexOf('Unknown location')
    const known = html.indexOf('>ABD1305<')
    assert.ok(unknown >= 0 && known >= 0, 'both sections drawn')
    assert.ok(unknown < known, 'first, as the lane counts it')
    const header = html.slice(unknown, known)
    assert.match(header, />7</, 'the lane\'s total, not the one card drawn')
    assert.match(header, /4<\/span>coverage gap/)
    assert.match(header, /3<\/span>missing punch/)
  })
})

describe('the Overtime tab', () => {
  it('says nothing of its own about inverted dates: the filter card says it once, beside the dates', () => {
    const html = flat(renderToString(
      <OvertimeTab from="2026-10-24" to="2026-10-11" rangeOk={false} fallbackEmployees={[]} reloadKey={0} />,
    ))
    assert.doesNotMatch(html, /Pick a From day/)
  })
})

describe('the screen\'s App Control words', () => {
  it('describe the review queue by pay period and its runs, never the retired location report or upload', () => {
    const hint = featureOf('scheduling.timeReconciliation')?.hint ?? ''
    assert.doesNotMatch(hint, /location report|upload/i)
    assert.match(hint, /pay period/)
    for (const word of ['resolve', 'remind', 'run', 'close']) assert.match(hint, new RegExp(`\\b${word}\\b`))
  })
})
