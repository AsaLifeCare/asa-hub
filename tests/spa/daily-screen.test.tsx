/**
 * THE DAILY SECTION ITSELF (DailySection.tsx), drawn whole — not its hooks.
 *
 * daily-notes.test.ts holds useDailyPlace to its word; this file holds the
 * SCREEN to calling it. Put the section back the way the bugs had it — its own
 * `useState('all')` for the filter and a `usePager` with nothing kept, or a
 * pager walking calls instead of days — and every hook test stays green while
 * this file fails: the section, drawn again after "Medications and back",
 * opens on the newest report under All, and a day arrives cut in pieces.
 *
 * The notes arrive the way they do in the platform. useClientDaily reads the
 * door — answered here at `fetch`, with the door's own envelope — and
 * remembers the answer in memory; the section, drawn by react-dom/server,
 * reads that memory. The reader's clicks are the section's own place
 * (useDailyPlace, the hook the Pager's buttons call), and every draw is a
 * fresh mount, which is what the accordion gives the section on the way back.
 *
 * The chart pages' hold on the place (useDailyPlaceScope) is read as source:
 * drawing a whole chart needs the client directory, the policy store and the
 * router, and what matters here is only that each chart page makes the call.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import type { DailyNote } from '@/pages/features/clients/daily/dailyApi'
import DailySection from '@/pages/features/clients/daily/DailySection'
import { useClientDaily } from '@/pages/features/clients/daily/useClientDaily'
import {
  type DailyLook, forgetKeptFilters, useDailyPlace, useDailyPlaceScope,
} from '@/pages/features/clients/daily/useDailyPlace'
import { forgetKeptPages } from '@/lib/pager'
import { mountHook } from './react-host'
import { NOTES, TWICE_FILED, UNTIMED, manyDays } from './daily-fixture'

/** What the door answers for each client; anybody else has no notes. */
const BOOK: Record<string, DailyNote[]> = {
  'Jo Doe': NOTES,
  'Al Roe': NOTES,
  'Many Days': manyDays(),
  'Twice Filed': TWICE_FILED,
  'No Clock': UNTIMED,
}

const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://hub.test')
    const client = url.searchParams.get('client') ?? ''
    const notes = (BOOK[client] ?? []).map((n) => ({ ...n, client, written_as: client }))
    const ok = { ok: true, rows: notes.length, error: '' }
    const envelope = {
      status: 200,
      data: {
        client, built_at: '', version: 'test', notes,
        unmatched: { rows: 0, names: 0 },
        sources: { notes: ok, clients: ok, schedule: ok },
      },
    }
    return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
})

after(() => {
  globalThis.fetch = realFetch
})

beforeEach(() => {
  forgetKeptPages()
  forgetKeptFilters()
})

/** Open Daily once, the way the section does, so the answer is in memory. */
async function readDaily(client: string): Promise<DailyNote[]> {
  const h = mountHook(({ who }: { who: string }) => useClientDaily(who, true), { who: client })
  await h.settle(() => h.current.state.phase !== 'loading')
  const { state } = h.current
  h.unmount()
  assert.equal(state.phase, 'ok', `the door answered ${client}'s notes`)
  return state.phase === 'ok' ? state.data.notes : []
}

type Screen = {
  html: string
  /** the note texts on screen, in order */
  notes: string[]
  /** the page the pager marks as current, 1-based; 0 when there is no pager */
  page: number
  /** the pager's sentence, e.g. '3 of 4 days'; '' when there is no pager */
  line: string
  /** the day header's own count, e.g. '· 3 notes' */
  dayCount: string
  /** the filter tab marked as selected */
  filter: string
  /** every clock the page states, in order — the claim this screen makes */
  clocks: string[]
}

/** Mount the section afresh — what the accordion does on the way back — and read what it drew. */
function draw(client: string, look: DailyLook = 'unique'): Screen {
  const html = renderToString(<DailySection client={client} look={look} />).replace(/<!-- -->/g, '')
  return {
    html,
    notes: [...html.matchAll(/>(note r\d+)</g)].map((m) => m[1]),
    page: Number(/aria-current="page"[^>]*>(\d+)</.exec(html)?.[1] ?? 0),
    line: /(\d+(?:–\d+)? of \d+ days(?:, one undated)?)/.exec(html)?.[1] ?? '',
    dayCount: /(· \d+ notes?)/.exec(html)?.[1] ?? '',
    filter: /aria-selected="true"[^>]*>([^<]+)</.exec(html)?.[1] ?? '',
    clocks: [...html.matchAll(/Called ([^<·]+)/g)].map((m) => m[1].trim()),
  }
}

/** The reader's clicks inside the section: the place the section's own pager moves. */
function place(look: DailyLook, client: string, notes: DailyNote[]) {
  return mountHook(
    ({ l, c, n }: { l: DailyLook; c: string; n: DailyNote[] }) => useDailyPlace(l, c, n, 'read'),
    { l: look, c: client, n: notes },
  )
}

describe('the Daily section, drawn — one page is one day', () => {
  it('opens on the newest day, under All, with the days counted', async () => {
    await readDaily('Jo Doe')
    const s = draw('Jo Doe')
    assert.deepEqual(s.notes, ['note r20', 'note r21', 'note r22'], 'the newest day and its three notes')
    assert.deepEqual([s.page, s.line, s.filter], [1, '1 of 4 days, one undated', 'All'])
    assert.equal(s.dayCount, '· 3 notes')
  })

  it('a day with two calls draws every note of that day, together and in order', async () => {
    const notes = await readDaily('Jo Doe')
    const reader = place('unique', 'Jo Doe', notes)
    reader.run(() => reader.current.pager.setPage(1))
    reader.unmount()
    const s = draw('Jo Doe')
    assert.deepEqual(s.notes, ['note r12', 'note r10', 'note r11'], 'the later call first, its own notes as written')
    assert.deepEqual([s.page, s.line, s.dayCount], [2, '2 of 4 days, one undated', '· 3 notes'])
  })

  it('the day’s notes sit in a bounded area that scrolls inside itself', async () => {
    await readDaily('Jo Doe')
    for (const look of ['record', 'unique'] as DailyLook[]) {
      const s = draw('Jo Doe', look)
      assert.match(s.html, /class="[^"]*max-h-\[\d+px\][^"]*overflow-y-auto/, `${look} bounds the day`)
    }
  })

  it('the report’s own header stays put while its notes scroll under it', async () => {
    await readDaily('Jo Doe')
    for (const look of ['record', 'unique'] as DailyLook[]) {
      const s = draw('Jo Doe', look)
      assert.match(s.html, /class="[^"]*sticky top-0[^"]*"/, `${look} pins the report header`)
    }
  })

  it('states the call’s time, on the header the notes scroll under', async () => {
    await readDaily('Jo Doe')
    const s = draw('Jo Doe')
    assert.deepEqual(s.clocks, ['5:00 AM'], 'the day’s one call, on Ohio’s clock')
  })

  it('a call the book timed two ways states no time, and says it was filed more than once', async () => {
    await readDaily('Twice Filed')
    for (const look of ['record', 'unique'] as DailyLook[]) {
      const s = draw('Twice Filed', look)
      // the other call of that day still says its own time; the split one says none
      assert.deepEqual(s.clocks, ['6:00 PM'], `${look} states only the undisputed clock`)
      assert.equal((s.html.match(/Filed more than once/g) ?? []).length, 2,
        `${look} says it on both parts of the one call`)
      assert.doesNotMatch(s.html, /Afternoon/, `${look} does not state the part of the day that clock placed`)
      assert.equal((s.html.match(/Evening/g) ?? []).length, 1, `${look} says it only for the call that has a time`)
      assert.equal((s.html.match(/by call time/g) ?? []).length, 1,
        `${look} withdraws the hedge with the label it qualified`)
      assert.deepEqual(s.notes, ['note r65', 'note r71', 'note r72', 'note r61', 'note r62'],
        `${look} keeps the parts of the one call side by side`)
    }
  })

  it('a call the book never timed says so, rather than showing nothing', async () => {
    await readDaily('No Clock')
    const s = draw('No Clock')
    assert.deepEqual(s.clocks, [])
    assert.match(s.html, /Time not recorded/)
    assert.doesNotMatch(s.html, /Filed more than once/)
  })

  it('both chart views draw the same day the same way', async () => {
    const notes = await readDaily('Jo Doe')
    for (const look of ['record', 'unique'] as DailyLook[]) {
      const reader = place(look, 'Jo Doe', notes)
      reader.run(() => reader.current.pager.setPage(1))
      reader.unmount()
    }
    const rec = draw('Jo Doe', 'record')
    const uni = draw('Jo Doe', 'unique')
    assert.deepEqual(rec.notes, uni.notes)
    assert.deepEqual([rec.page, rec.line, rec.dayCount], [uni.page, uni.line, uni.dayCount])
  })

  it('the last page is the undated day', async () => {
    const notes = await readDaily('Jo Doe')
    const reader = place('unique', 'Jo Doe', notes)
    reader.run(() => reader.current.pager.setPage(3))
    reader.unmount()
    const s = draw('Jo Doe')
    assert.deepEqual(s.notes, ['note r1'])
    assert.match(s.html, /Date not recorded/)
    assert.deepEqual([s.page, s.line], [4, '4 of 4 days, one undated'])
  })
})

describe('the Daily section, drawn — Medications and back', () => {
  it('drawn again after the reader paged back, it shows the day they were on', async () => {
    const notes = await readDaily('Jo Doe')
    const reader = place('unique', 'Jo Doe', notes)
    reader.run(() => reader.current.pager.setPage(2))
    reader.unmount() // Medications opens
    const s = draw('Jo Doe') // and Daily again
    assert.deepEqual(s.notes, ['note r5'], 'the third day, one note')
    assert.deepEqual([s.page, s.line, s.dayCount], [3, '3 of 4 days, one undated', '· 1 note'])
  })

  it('the filter the reader chose comes back with its page', async () => {
    const notes = await readDaily('Jo Doe')
    const reader = place('unique', 'Jo Doe', notes)
    reader.run(() => reader.current.setFilter('daily'))
    reader.run(() => reader.current.pager.setPage(1))
    reader.unmount()
    const s = draw('Jo Doe')
    assert.equal(s.filter, 'Daily status')
    assert.deepEqual(s.notes, ['note r12', 'note r10', 'note r11'], 'the second day, its daily notes')
    assert.equal(s.page, 2)
  })

  it('the Record view comes back on its own day', async () => {
    const notes = await readDaily('Many Days')
    const reader = place('record', 'Many Days', notes)
    reader.run(() => reader.current.pager.setPage(2))
    reader.unmount()
    const s = draw('Many Days', 'record')
    assert.deepEqual(s.notes, ['note r23'], 'the third newest of twenty-five days')
    assert.deepEqual([s.page, s.line], [3, '3 of 25 days'])
  })

  it('another client’s section opens on its newest day under All', async () => {
    const notes = await readDaily('Jo Doe')
    await readDaily('Al Roe')
    const reader = place('unique', 'Jo Doe', notes)
    reader.run(() => reader.current.setFilter('daily'))
    reader.run(() => reader.current.pager.setPage(2))
    reader.unmount()
    const s = draw('Al Roe')
    assert.deepEqual([s.page, s.filter, s.notes[0]], [1, 'All', 'note r20'])
  })

  it('the chart closing forgets the place: the next visit opens on the newest under All', async () => {
    const notes = await readDaily('Jo Doe')
    const chart = mountHook(({ c }: { c: string }) => useDailyPlaceScope(c), { c: 'Jo Doe' })
    const reader = place('unique', 'Jo Doe', notes)
    reader.run(() => reader.current.setFilter('daily'))
    reader.run(() => reader.current.pager.setPage(2))
    reader.unmount()
    assert.equal(draw('Jo Doe').page, 3, 'kept while the chart stays open')
    chart.unmount()
    const s = draw('Jo Doe')
    assert.deepEqual([s.page, s.filter], [1, 'All'])
  })

  it('a client with no notes: the empty sentence, no pager', async () => {
    await readDaily('Nobody Here')
    const s = draw('Nobody Here')
    assert.deepEqual([s.notes, s.page, s.line], [[], 0, ''])
    assert.match(s.html, /No note was matched to Nobody Here by name\./)
  })
})

describe('the chart pages hold the place', () => {
  const root = process.env.SPA_ROOT ?? process.cwd()
  for (const page of ['ClientRecordPage.tsx', 'ClientUniquePage.tsx']) {
    it(`${page} gives Daily's place the chart's lifetime`, () => {
      const src = readFileSync(resolve(root, 'src/pages/features/clients', page), 'utf8')
      assert.match(src, /import \{[^}]*\buseDailyPlaceScope\b[^}]*\} from '\.\/daily\/useDailyPlace'/)
      assert.match(src, /\buseDailyPlaceScope\(client\?\.name \?\? ''\)/)
    })
  }

  // The one reader who goes looking for why the Pager's range collapses to a
  // single number is sent to that comment; while it named the Unique view's
  // reports it sent them to a shape the repo no longer has.
  it('the Pager explains a page of one as the Daily days, in both views', () => {
    const src = readFileSync(resolve(root, 'src/components/shared/Pager.tsx'), 'utf8')
    assert.match(src, /Daily days, one to a page, in both chart views/)
    assert.doesNotMatch(src, /the Unique\b/, 'page size 1 is no longer one view’s reports')
  })
})
