/**
 * House Repair's black header counts the rows the list is drawn from, each
 * figure narrows the list to exactly what it counted, and an unread, failed or
 * unreadable value is never a 0.
 *
 * The figures are held on their own; the header is drawn by react-dom/server;
 * the page's clicks are its own board (useHouseRepairBoard) mounted by React's
 * client renderer against the door answered at `fetch`, and the screen is then
 * drawn whole over the board that was clicked.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import {
  analyseRepairs,
  readUrgency,
  repairFilterTest,
  statusBucket,
  statusTints,
  toRepairRow,
  type RepairFilter,
} from '@/lib/houseRepairAnalysis'
import { TINT_BG, heroBand } from '@/lib/tints'
import type { OpsRow } from '@/features/ops-flows/useOpsCrud'
import HouseRepairHero, { type RepairRead } from '@/pages/features/clientops/HouseRepairHero'
import HouseRepairPage, { HouseRepairScreen } from '@/pages/features/clientops/HouseRepairPage'
import { useHouseRepairBoard, type HouseRepairBoard } from '@/pages/features/clientops/useHouseRepairBoard'
import { mountHook } from './react-host'

/** Noon on Ohio's clock. */
const NOW = Date.parse('2030-04-15T16:00:00Z')
const DAY = 86_400_000

const row = (id: string, house: string, urgency: string, status: string, timestamp: string): OpsRow => ({
  id, select_address_vehicle: house, repair_type: 'Other', please_describe_the_issue: `issue ${id}`,
  urgency_level: urgency, status, timestamp,
})

/** Each row carries a different reason to count where it does. */
const RAW: OpsRow[] = [
  row('a', '1711 48th St NW', '5', '', '2030-04-01T13:00:00.000Z'),
  row('b', '1711 48th St NW', '4', 'In Progress', '2030-03-20T04:00:00.000Z'),
  row('c', '1305 49th St NW', '3', 'On-Hold', '2/14/2030'),
  row('d', '1305 49th St NW', 'ASAP', 'in progress', '2030-04-10T15:00:00Z'),
  row('e', '1711 48th St NW', '5', 'Completed', '2030-04-05T12:00:00Z'),
  row('f', 'ALL', 'High', 'Waiting on parts', ''),
  row('g', '4708 Meadowlane Dr NW', '', 'completed', '2030-03-02T12:00:00Z'),
  row('h', '', '2', 'Cancelled', '2030-04-12T12:00:00Z'),
  row('i', '1305 49th St NW', '1', 'COMPLETED', '2030-04-14T23:30:00Z'),
  // the evening before the month turns in Ohio — the next month only on the UTC clock
  row('j', '4708 Meadowlane Dr NW', '5', 'Completed', '2030-04-01T02:00:00Z'),
]
const ROWS = RAW.map(toRepairRow)

describe('the reading', () => {
  it('reads the 1–5 scale and the page’s own four words; any other word is unknown, not low', () => {
    assert.deepEqual(readUrgency(' 5 '), { level: 5, priority: 'urgent' })
    assert.deepEqual(readUrgency('4'), { level: 4, priority: 'high' })
    assert.deepEqual(readUrgency('3'), { level: 3, priority: 'medium' })
    assert.deepEqual(readUrgency('2'), { level: 2, priority: 'low' })
    assert.deepEqual(readUrgency('1'), { level: 1, priority: 'low' })
    assert.deepEqual(readUrgency('High'), { level: null, priority: 'high' })
    assert.deepEqual(readUrgency('URGENT'), { level: null, priority: 'urgent' })
    for (const word of ['ASAP', 'soon', 'n/a', 'critical']) {
      assert.deepEqual(readUrgency(word), { level: null, priority: null }, word)
    }
    assert.deepEqual(readUrgency(''), { level: null, priority: null })
    assert.deepEqual(readUrgency(undefined), { level: null, priority: null })
  })

  it('a number off the 1–5 scale is unreadable, never a level', () => {
    for (const n of ['0', '-1', '2.5', '4.5', '6', '9', '10', '0x5', '1e1']) {
      assert.deepEqual(readUrgency(n), { level: null, priority: null }, n)
    }
    const off = analyseRepairs([row('x', '1711 48th St NW', '10', '', '2030-04-02T12:00:00Z')].map(toRepairRow), NOW)
    assert.deepEqual(off.urgent, { count: 0, urgent: 0, high: 0, unreadable: 1 })
  })

  it('reads the status case- and spacing-folded; blank is New, a word outside the lifecycle is kept', () => {
    assert.equal(statusBucket(''), 'new')
    assert.equal(statusBucket('In Progress'), 'in-progress')
    assert.equal(statusBucket('in-progress'), 'in-progress')
    assert.equal(statusBucket('On-Hold'), 'on-hold')
    assert.equal(statusBucket('COMPLETED'), 'completed')
    assert.equal(statusBucket('Canceled'), 'cancelled')
    assert.equal(statusBucket('Waiting on parts'), 'other')
    const f = ROWS.find((r) => r.id === 'f')!
    assert.equal(f.stage, 'New')
    assert.equal(f.status, 'Waiting on parts')
  })
})

describe('the header’s figures', () => {
  const a = analyseRepairs(ROWS, NOW)

  it('open is everything not completed or cancelled, by where it stands', () => {
    assert.equal(a.total, 10)
    assert.deepEqual(a.open, { count: 5, new: 1, inProgress: 2, onHold: 1, other: 1 })
  })

  it('urgent / high counts levels 5 and 4 and the words — an unknown word is named, never counted', () => {
    assert.deepEqual(a.urgent, { count: 3, urgent: 1, high: 2, unreadable: 1 })
  })

  it('the oldest open is aged in Ohio days; an undated one is named, not guessed', () => {
    assert.ok(a.oldest)
    assert.equal(a.oldest.row.id, 'c')
    assert.equal(a.oldest.ageDays, 60, 'Feb 14 to Apr 15')
    assert.equal(a.undatedOpen, 1)
  })

  it('done this month is the completed among those FILED this month — the sheet dates no finish', () => {
    assert.deepEqual(a.month, { key: '2030-04', name: 'April', filed: 5, done: 2 })
  })

  it('the address with the most open requests, ties said out loud', () => {
    assert.deepEqual(a.topHouse, { key: '1305 49th st nw', label: '1305 49th St NW', open: 2, tiedWith: 1 })
    const b = analyseRepairs(ROWS.filter((r) => r.id !== 'd'), NOW)
    assert.deepEqual(b.topHouse, { key: '1711 48th st nw', label: '1711 48th St NW', open: 2, tiedWith: 0 })
  })

  it('a request for every house is counted apart, never the house with the most', () => {
    const estate = [...RAW, row('k', 'All', '3', '', '2030-04-03T12:00:00Z'), row('l', 'ALL', '3', '', '2030-04-04T12:00:00Z')]
    const e = analyseRepairs(estate.map(toRepairRow), NOW)
    assert.equal(e.openWholeEstate, 3)
    assert.deepEqual(e.topHouse, { key: '1305 49th st nw', label: '1305 49th St NW', open: 2, tiedWith: 1 })
    const only = analyseRepairs([row('m', 'ALL', '3', '', '2030-04-03T12:00:00Z')].map(toRepairRow), NOW)
    assert.equal(only.topHouse, null)
    assert.equal(only.openWholeEstate, 1)
  })

  it('the status distribution covers every row, lifecycle first, then the sheet’s own words', () => {
    assert.deepEqual(a.statuses.map((s) => [s.label, s.count]), [
      ['New', 1], ['In progress', 2], ['On hold', 1], ['Completed', 4], ['Cancelled', 1], ['Waiting on parts', 1],
    ])
    assert.equal(a.statuses.reduce((n, s) => n + s.count, 0), a.total)
    assert.equal(a.undated, 1)
    assert.equal(a.noUrgency, 2)
  })

  it('each figure, clicked, is the list of exactly what it counted', () => {
    const count = (f: RepairFilter) => ROWS.filter(repairFilterTest(f)).length
    assert.equal(count({ kind: 'open' }), a.open.count)
    assert.equal(count({ kind: 'oldest' }), a.open.count)
    assert.equal(count({ kind: 'urgent' }), a.urgent.count)
    assert.equal(count({ kind: 'month-done', month: a.month.key, name: a.month.name }), a.month.done)
    assert.equal(count({ kind: 'house', key: a.topHouse!.key, label: a.topHouse!.label }), a.topHouse!.open)
    for (const s of a.statuses) assert.equal(count({ kind: 'status', key: s.key, label: s.label }), s.count, s.label)
  })

  it('an empty sheet is an empty sheet: nothing open, nobody leads, nothing is guessed', () => {
    const e = analyseRepairs([], NOW)
    assert.equal(e.total, 0)
    assert.deepEqual(e.open, { count: 0, new: 0, inProgress: 0, onHold: 0, other: 0 })
    assert.equal(e.oldest, null)
    assert.equal(e.topHouse, null)
    assert.deepEqual(e.statuses, [])
    assert.deepEqual(e.month, { key: '2030-04', name: 'April', filed: 0, done: 0 })
  })

  it('open requests with no date and no house say so instead of leading', () => {
    const bare = [row('x', '', '', '', '')].map(toRepairRow)
    const b = analyseRepairs(bare, NOW)
    assert.equal(b.open.count, 1)
    assert.equal(b.oldest, null)
    assert.equal(b.undatedOpen, 1)
    assert.equal(b.topHouse, null)
    assert.equal(b.openNoHouse, 1)
    assert.equal(b.urgent.unreadable, 1)
  })
})

/* ---------- the header ---------- */

// framer-motion measures the window
const g = globalThis as unknown as Record<string, unknown>
const hadListeners = typeof g.addEventListener === 'function'
before(() => {
  if (!hadListeners) {
    g.addEventListener = () => {}
    g.removeEventListener = () => {}
  }
})
after(() => {
  if (!hadListeners) {
    delete g.addEventListener
    delete g.removeEventListener
  }
})

const draw = (read: RepairRead, active: RepairFilter | null = null, scope: string | null = null, onRetry?: () => void) =>
  renderToString(<HouseRepairHero read={read} scope={scope} active={active} onFilter={() => {}} onRetry={onRetry} />)
    .replace(/<!-- -->/g, '')

/** every figure the header states in the stat face */
const figures = (html: string) => [...html.matchAll(/class="[^"]*font-stat[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1])
/** the figure that names an address */
const named = (html: string) => /class="truncate text-\[20px\] font-medium leading-tight text-white" title="[^"]*">([^<]*)</.exec(html)?.[1]
const HEAVY = /font-(semibold|bold|extrabold|black)\b/

describe('the black header', () => {
  const ready: RepairRead = { state: 'ready', figures: analyseRepairs(ROWS, NOW) }

  it('is the platform’s dark hero, four figures to a row, weights at 500 or under', () => {
    for (const read of [{ state: 'loading' } as const, { state: 'failed', reason: 'x' } as const, ready]) {
      const html = draw(read)
      assert.match(html, /class="mb-5 rounded-\[16px\] bg-detail-hero p-5 shadow-2 sm:p-6"/)
      assert.match(html, /grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4"/)
      assert.doesNotMatch(html, /lg:grid-cols-5/)
      assert.doesNotMatch(html, HEAVY, read.state)
    }
  })

  it('while the read has not answered, it says so — no figure is a zero', () => {
    const html = draw({ state: 'loading' })
    assert.match(html, /Reading the repair requests/)
    assert.match(html, /Status · not read yet/)
    assert.doesNotMatch(html, /on file</)
    assert.ok(figures(html).length >= 4)
    for (const f of figures(html)) assert.equal(f, '—')
    assert.doesNotMatch(html, /<button/, 'nothing to filter before the rows arrive')
  })

  it('a failed read is unknown, in words, with the kit’s way to try again — never a zero', () => {
    const html = draw({ state: 'failed', reason: 'Sheet quota exceeded.' }, null, null, () => {})
    assert.match(html, /could not be read, so these figures are unknown — not zero/)
    assert.match(html, /Sheet quota exceeded\./)
    assert.match(html, /Status · unknown — the read failed/)
    assert.match(html, /class="inline-flex items-center gap-1 rounded-full bg-white\/10 px-2 py-0\.5 text-\[11\.5px\] text-white\/85 hover:bg-white\/15"[^>]*>.*Try again/)
    for (const f of figures(html)) assert.equal(f, '—')
  })

  it('states the figures, each one a filter', () => {
    const html = draw(ready)
    assert.deepEqual(figures(html), ['5', '3', '60d', '2', '1', '2', '1', '4', '1', '1'])
    assert.equal(named(html), '1305 49th St NW', 'the address that leads is named')
    assert.match(html, /1 new · 2 in progress · 1 on hold · 1 other status/)
    assert.match(html, /1 urgent · 2 high · 1 open request with no readable urgency/)
    assert.match(html, /1305 49th St NW · filed Feb 14, 2030 · 1 open undated/)
    assert.match(html, /of 5 requests filed in April · the sheet keeps no completion date/)
    assert.match(html, /2 open requests · tied with 1 other · 1 open for all houses/)
    assert.match(html, /Status · all 10 requests on file/)
    assert.match(html, /10 requests on record in House Repair Requests › Repairs · 1 with no readable date · 2 with no readable urgency/)
    assert.equal((html.match(/<button/g) ?? []).length, 5 + 6, 'five figures and six status pills')
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 0)
  })

  it('the status pills are the kit’s pill', () => {
    const pills = [...draw(ready).matchAll(/<button type="button" aria-pressed="false" title="Show the [^"]*requests" class="([^"]*)"/g)].map((m) => m[1])
    assert.equal(pills.length, 6)
    for (const cls of pills) assert.match(cls, /rounded-full px-2\.5 py-0\.5 text-\[11\.5px\] text-white\/75 /)
  })

  it('under a focus, every total names the house it counts', () => {
    const at = '1711 48th St NW'
    const scoped = ROWS.filter((r) => r.house === at)
    const html = draw({ state: 'ready', figures: analyseRepairs(scoped, NOW) }, null, at)
    assert.match(html, /Repair requests · 1711 48th St NW/)
    assert.match(html, /Status · 3 requests at 1711 48th St NW/)
    assert.match(html, /3 requests at 1711 48th St NW in House Repair Requests › Repairs/)
    assert.doesNotMatch(html, />[^<]*(on record|on file)/, 'no line claims the whole sheet')
  })

  it('marks the one figure whose filter is on — Open and Oldest open are never pressed together', () => {
    for (const kind of ['open', 'oldest', 'urgent'] as const) {
      const html = draw(ready, { kind })
      assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1, kind)
    }
    assert.match(draw(ready, { kind: 'oldest' }), /aria-pressed="true" class="[^"]*"><span class="block font-stat[^>]*>60d</)
  })

  it('open requests that name no single house leave the address unknown, not "None"', () => {
    const html = draw({ state: 'ready', figures: analyseRepairs([row('x', '', '', '', ''), row('y', 'ALL', '', '', '')].map(toRepairRow), NOW) })
    assert.equal(named(html), '—')
    assert.match(html, /no open request names a single house or vehicle · 1 open for all houses · 1 open with no house named/)
    assert.equal(figures(html)[2], '—', 'the oldest is as unknown')
  })

  it('an empty sheet reads as one — zeros that are true, and nothing to lead', () => {
    const html = draw({ state: 'ready', figures: analyseRepairs([], NOW) })
    assert.deepEqual(figures(html).slice(0, 4), ['0', '0', 'None', '0'])
    assert.equal(named(html), 'None')
    assert.match(html, /no request on file/)
    assert.match(html, /nothing filed in April yet/)
    assert.match(html, /No request on file\./)
    assert.doesNotMatch(html, /<button/, 'a zero opens nothing')
  })
})

/* ---------- the page, clicked ---------- */

describe('the page carries it', () => {
  let door: 'up' | 'down' = 'up'
  const realFetch = globalThis.fetch
  before(() => {
    // the platform's own envelope: a 5xx the door reports, or the rows
    globalThis.fetch = (async () => new Response(JSON.stringify(
      door === 'down' ? { status: 500, message: 'Sheet quota exceeded' } : { status: 200, data: RAW },
    ), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  let t = NOW
  const clock = () => t
  async function board() {
    const h = mountHook(() => useHouseRepairBoard(clock), {})
    await h.settle(() => h.current.read.state !== 'loading')
    return h
  }
  const screen = (b: HouseRepairBoard) =>
    renderToString(<MemoryRouter><HouseRepairScreen board={b} /></MemoryRouter>).replace(/<!-- -->/g, '')
  const hero = (html: string) => /<section aria-label="House repair[^]*?<\/section>/.exec(html)?.[0] ?? ''
  const bar = (html: string) => /<div role="group" aria-label="The list’s filter"[^]*?<\/div>/.exec(html)?.[0] ?? ''
  /** the cards on screen, in order */
  const cards = (html: string) => [...html.matchAll(/>issue (\w)</g)].map((m) => m[1])
  const pressed = (html: string) => [...hero(html).matchAll(/aria-pressed="true"[^>]*>(?:<span[^>]*>)+([^<]*)</g)].map((m) => m[1])

  it('draws the header over the list before the rows answer, and no stat strip', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/app/house-repair/orders']}>
        <HouseRepairPage />
      </MemoryRouter>,
    ).replace(/<!-- -->/g, '')
    assert.match(html, /House Repair/)
    assert.match(html, /aria-label="House repair — the requests on file"/)
    assert.match(html, /Reading the repair requests/)
    assert.equal((html.match(/bg-detail-hero/g) ?? []).length, 1)
    assert.ok(html.indexOf('bg-detail-hero') < html.indexOf('New repair request'), 'the header sits above the actions')
    assert.doesNotMatch(html, /grid-cols-3 gap-3/, 'the old stat strip is gone')
  })

  it('a failed read says so once, in the header, with the way to try again there', async () => {
    door = 'down'
    const h = await board()
    const html = screen(h.current)
    assert.equal(h.current.read.state, 'failed')
    assert.equal((html.match(/Sheet quota exceeded/g) ?? []).length, 1)
    assert.match(hero(html), /Try again/)
    assert.match(html, /Could not load work orders/)
    h.unmount()
    door = 'up'
  })

  it('draws the ready header over the whole list, figures from the same rows', async () => {
    const h = await board()
    const html = screen(h.current)
    assert.deepEqual(figures(hero(html)), ['5', '3', '60d', '2', '1', '2', '1', '4', '1', '1'])
    assert.equal(named(hero(html)), '1305 49th St NW')
    assert.equal(cards(html).length, 10)
    assert.equal(bar(html), '', 'no filter, no filter bar')
    h.unmount()
  })

  it('Oldest open, clicked, lists the request it names first and the undated one last — clicked again, the ordering comes back', async () => {
    const h = await board()
    assert.equal(h.current.order, 'newest')
    h.run(() => h.current.pick({ kind: 'oldest' }))
    assert.equal(h.current.order, 'oldest')
    let html = screen(h.current)
    assert.deepEqual(cards(html), ['c', 'b', 'a', 'd', 'f'])
    assert.deepEqual(pressed(html), ['60d'], 'only the figure clicked is pressed')
    assert.match(bar(html), /Open requests, oldest first/)
    assert.match(bar(html), />5 of 10</)

    h.run(() => h.current.pick({ kind: 'oldest' }))
    assert.equal(h.current.filter, null)
    assert.equal(h.current.order, 'newest', 'the ordering it replaced is back')
    html = screen(h.current)
    assert.deepEqual(pressed(html), [])
    assert.equal(cards(html).length, 10)
    h.unmount()
  })

  it('Clear, or another figure, puts back the ordering the reader had', async () => {
    const h = await board()
    h.run(() => h.current.chooseOrder('priority'))
    h.run(() => h.current.pick({ kind: 'oldest' }))
    assert.equal(h.current.order, 'oldest')
    h.run(() => h.current.clearFilter())
    assert.equal(h.current.order, 'priority')

    h.run(() => h.current.pick({ kind: 'oldest' }))
    h.run(() => h.current.pick({ kind: 'urgent' }))
    assert.equal(h.current.order, 'priority')
    assert.deepEqual(pressed(screen(h.current)), ['3'])
    h.unmount()
  })

  it('the ordering chosen by hand is the reader’s: Open requests stays the one pressed, and nothing is put back over it', async () => {
    const h = await board()
    h.run(() => h.current.pick({ kind: 'open' }))
    h.run(() => h.current.chooseOrder('oldest'))
    assert.deepEqual(pressed(screen(h.current)), ['5'], 'Oldest open was never clicked')

    h.run(() => h.current.pick({ kind: 'oldest' }))
    h.run(() => h.current.chooseOrder('name'))
    assert.deepEqual(h.current.filter, { kind: 'open' }, 'no longer oldest first, still the open requests')
    h.run(() => h.current.clearFilter())
    assert.equal(h.current.order, 'name')
    h.unmount()
  })

  it('a filter that has come to match nothing says so, with the count', async () => {
    const h = await board()
    h.run(() => h.current.pick({ kind: 'house', key: 'nowhere', label: 'Nowhere' }))
    const html = screen(h.current)
    assert.match(html, /Nothing matches/)
    assert.match(bar(html), />0 of 10</)
    assert.equal(cards(html).length, 0)
    assert.doesNotMatch(bar(html), HEAVY, 'the filter bar keeps to 500')
    h.unmount()
  })

  it('a status reads the same on the card as in the header: its colour and its words', async () => {
    const h = await board()
    const html = screen(h.current)
    const tints = statusTints(h.current.figures.statuses)
    for (const [key, word] of [['other:waiting on parts', 'Waiting on parts'], ['on-hold', 'On hold']] as const) {
      const tint = tints.get(key)!
      assert.match(hero(html), new RegExp(`background:${heroBand(tint)}"></span>${word}<`), `${word} in the header`)
      assert.match(html, new RegExp(`${TINT_BG[tint]}[^"]*">${word}<`), `${word} on the card`)
    }
    assert.doesNotMatch(html, /On-Hold</)
    h.unmount()
  })

  it('an open page keeps Ohio’s day: a read after the month turns ages the oldest and counts the new month', async () => {
    t = NOW
    const h = await board()
    h.run(() => h.current.pick({ kind: 'month-done', month: '2030-04', name: 'April' }))
    assert.equal(cards(screen(h.current)).length, 2)

    t = NOW + 16 * DAY
    h.run(() => h.current.crud.reload())
    await h.settle(() => h.current.read.state === 'ready' && h.current.figures.month.key === '2030-05')
    assert.equal(h.current.figures.oldest?.ageDays, 76)
    assert.deepEqual(h.current.filter, { kind: 'month-done', month: '2030-05', name: 'May' }, 'this month’s, not the last')
    const html = screen(h.current)
    assert.match(bar(html), /Completed, filed in May/)
    assert.match(hero(html), /nothing filed in May yet/)
    h.unmount()
    t = NOW
  })
})
