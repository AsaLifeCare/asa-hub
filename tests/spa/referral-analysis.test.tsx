/**
 * The Potential Clients analysis stays ONE computation: Compare draws it, the
 * black header quotes it, the Funnel's board uses its rule — and an unread or
 * failed read is never shown as a 0.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import {
  RANK_MAX, TOP_N, analyseReferrals, boardStage, leadRating, type Lead,
} from '@/lib/referralAnalysis'
import { potentialClientsFunnelPage, potentialClientsPipelinePage } from '@/registry/apps-potclients'
import ReferralsHero from '@/pages/features/potclients/ReferralsHero'
import { useReferralAnalysis, type ReferralRead } from '@/pages/features/potclients/useReferralAnalysis'
import { mountHook } from './react-host'

const NOW = Date.parse('2030-03-10T12:00:00Z')
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString().slice(0, 10)

/** Five referrals, each carrying a different reason to rank where it does. */
const ROWS: Lead[] = [
  { id: 'a', client_name: 'Ada Stone', ai_rating: '9', phone: '330-555-0101', funding_source: 'Waiver', frequency: '24/7', expiration_date: inDays(5), stage: 'new', postal_code: '44310' },
  { id: 'b', client_name: 'Ben Hale', ai_rating: '7', email: 'ben@example.com', frequency: 'weekly', expiration_date: inDays(40), stage: 'new', postal_code: '44310' },
  { id: 'c', client_name: 'Cy Moss', ai_rating: '  ', funding_source: 'Medicaid', expiration_date: inDays(-3), stage: 'new', postal_code: '44305' },
  { id: 'd', client_name: 'Di Park', ai_rating: '5', phone: '330-555-0104', in_funnel: 'yes', stage: 'new' },
  { id: 'e', client_name: 'Ed Lane', ai_rating: '8', phone: '330-555-0105', funding_source: 'Private', stage: 'contacted' },
]

describe('the analysis Compare draws', () => {
  it('a blank score is unscored — not a scored zero', () => {
    assert.equal(leadRating({ ai_rating: '' }), null)
    assert.equal(leadRating({ ai_rating: '   ' }), null)
    assert.equal(leadRating({}), null)
    assert.equal(leadRating({ ai_rating: 'n/a' }), null)
    assert.equal(leadRating({ ai_rating: '0' }), 0)
    const a = analyseReferrals(ROWS, NOW)
    assert.equal(a.scored, 4)
    assert.equal(a.unscored, 1)
    assert.equal(a.histogram.reduce((s, h) => s + h.c, 0), 4, 'the blank never lands in a bucket')
  })

  it('counts the cohort the way the header states it', () => {
    const a = analyseReferrals(ROWS, NOW)
    assert.equal(a.total, 5)
    assert.equal(a.worthCall, 1, 'only a score ABOVE the line — 8 is not worth the call, 9 is')
    assert.equal(a.reachable, 4)
    assert.equal(a.funded, 3)
    assert.equal(a.expiring, 1)
    assert.equal(a.expired, 1)
    assert.deepEqual(a.byZip, [['44310', 2], ['44305', 1]])
  })

  it('ranks on the five signals, and says why the leader leads', () => {
    const a = analyseReferrals(ROWS, NOW)
    assert.equal(RANK_MAX, 20)
    assert.deepEqual(a.ranked.map((r) => r.id), ['a', 'e', 'b', 'd', 'c'])
    assert.ok(a.leader)
    assert.equal(a.leader.row.id, 'a')
    assert.equal(a.leader.rank, 19, '9 + reachable 3 + funding 3 + 24/7 2 + five days left 2')
    assert.deepEqual(a.leader.why, ['score 9', 'reachable', 'funding named', '24/7 hours', '5d left'])
  })

  it('what is waiting is the top of the ranking not on the board — the Funnel’s own board', () => {
    const a = analyseReferrals(ROWS, NOW)
    assert.equal(a.top.length, ROWS.length)
    assert.equal(a.waiting, 2, 'Ben (7) and Cy (unscored) — Ada scored in, Di was sent, Ed was moved')
    const stageFrom = potentialClientsFunnelPage.config.stageFrom as (r: Lead) => string
    for (const r of ROWS) assert.equal(stageFrom(r), boardStage(r), `the board and Compare agree on ${String(r.id)}`)
    assert.deepEqual(ROWS.map(boardStage), ['new', '', '', 'new', 'contacted'])
  })

  it('names the biggest gap, and has none to name when there is none', () => {
    assert.deepEqual(analyseReferrals(ROWS, NOW).gap, { key: 'unfunded', n: 2, label: 'no funding named' })
    const whole = [{ id: 'x', ai_rating: '9', phone: '1', funding_source: 'Waiver', expiration_date: inDays(30) }]
    assert.equal(analyseReferrals(whole, NOW).gap, null)
  })

  it('an empty file is an empty file: nobody leads and nothing waits', () => {
    const a = analyseReferrals([], NOW)
    assert.equal(a.total, 0)
    assert.equal(a.leader, null)
    assert.equal(a.waiting, 0)
    assert.equal(a.gap, null)
  })

  it('compares the top twelve, however many are on file', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, client_name: `R ${i}`, ai_rating: String(i % 10) }))
    assert.equal(analyseReferrals(many, NOW).top.length, TOP_N)
  })
})

/* ---------- the read behind it ---------- */

describe('the read the header and Compare share', () => {
  let door: 'down' | 'up' = 'down'
  const realFetch = globalThis.fetch
  before(() => {
    // the platform's own envelope: a 5xx the door reports, then the rows
    globalThis.fetch = (async () => new Response(JSON.stringify(
      door === 'down' ? { status: 500, message: 'Sheet quota exceeded' } : { status: 200, data: ROWS },
    ), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  it('a read that failed is `failed` with its reason — then the retry reads the rows', async () => {
    door = 'down'
    const h = mountHook(() => useReferralAnalysis(), {})
    await h.settle(() => h.current.read.state !== 'loading')
    assert.deepEqual(h.current.read, { state: 'failed', reason: 'Sheet quota exceeded' })

    door = 'up'
    h.run(() => h.current.retry())
    await h.settle(() => h.current.read.state === 'ready')
    // the retry changed what the hook returns; the assertion above narrowed the old value
    const read = h.current.read as ReferralRead
    assert.equal(read.state === 'ready' ? read.analysis.total : read.state, ROWS.length)
    h.unmount()
  })

  it('a write that landed moves every figure with it', async () => {
    door = 'up'
    const h = mountHook(() => useReferralAnalysis(), {})
    await h.settle(() => h.current.read.state === 'ready')
    const waiting = () => (h.current.read.state === 'ready' ? h.current.read.analysis.waiting : -1)
    assert.equal(waiting(), 2)
    h.run(() => h.current.patch('b', { in_funnel: 'yes', stage: 'new' }))
    assert.equal(waiting(), 1, 'Ben is on the board now, so one decision is left')
    h.unmount()
  })
})

/* ---------- the header ---------- */

const draw = (
  read: ReferralRead,
  on: 'pipeline' | 'compare' | 'funnel' | 'unique' = 'pipeline',
  onRetry?: () => void,
  record?: Lead | null,
) =>
  renderToString(
    <MemoryRouter>
      <ReferralsHero read={read} on={on} onRetry={onRetry} record={record} />
    </MemoryRouter>,
  ).replace(/<!-- -->/g, '')

/** every big and small figure the header states */
const figures = (html: string) => [...html.matchAll(/class="[^"]*font-stat[^"]*">([^<]*)</g)].map((m) => m[1])

describe('the black header', () => {
  it('while the read has not answered, it says so — no figure is a zero', () => {
    const html = draw({ state: 'loading' })
    assert.match(html, /Reading the referrals/)
    assert.ok(figures(html).length >= 8)
    for (const f of figures(html)) assert.equal(f, '—')
  })

  it('a failed read is unknown, in words, with a way to try again — never a zero', () => {
    const html = draw({ state: 'failed', reason: 'Live API unreachable.' }, 'pipeline', () => {})
    assert.match(html, /could not be read, so these figures are unknown — not zero/)
    assert.match(html, /Live API unreachable\./)
    assert.match(html, /Try again/)
    for (const f of figures(html)) assert.equal(f, '—')
  })

  it('states Compare’s figures, and each opens where it is explained', () => {
    const html = draw({ state: 'ready', analysis: analyseReferrals(ROWS, NOW) })
    assert.deepEqual(figures(html), ['5', '19/20', '2', '2', '1', '1', '1', '4', '3'])
    assert.match(html, /Ada Stone/)
    assert.match(html, /19\/20/)
    assert.match(html, /score 9 · reachable · funding named · 24\/7 hours · 5d left/)
    assert.match(html, /no funding named · of 5/)
    assert.match(html, /href="\/app\/potential-clients\/unique\?record=a"/, 'the leader opens its profile')
    assert.match(html, /href="\/app\/potential-clients\/compare\?focus=top"/, 'what is waiting opens the compared top')
    assert.match(html, /href="\/app\/potential-clients\/compare\?focus=funding"/, 'the gap opens who pays')
  })

  it('on Compare it opens Compare’s own sections, never Compare again', () => {
    const html = draw({ state: 'ready', analysis: analyseReferrals(ROWS, NOW) }, 'compare')
    assert.match(html, /href="\/app\/potential-clients\/compare\?focus=distribution"/)
    assert.doesNotMatch(html, /href="\/app\/potential-clients\/compare"/)
  })

  it('a figure nothing on Compare explains is plain text, on every screen', () => {
    /** whether the first occurrence of `label` sits inside a link */
    const linked = (html: string, label: string) => {
      const at = html.indexOf(label)
      assert.ok(at >= 0, `${label} is drawn`)
      return html.lastIndexOf('<a ', at) > html.lastIndexOf('</a>', at)
    }
    for (const on of ['pipeline', 'compare', 'funnel'] as const) {
      const html = draw({ state: 'ready', analysis: analyseReferrals(ROWS, NOW) }, on)
      for (const label of ['Expiring ≤14d', 'Already expired', 'Reachable']) {
        assert.equal(linked(html, label), false, `${label} on ${on}`)
      }
      assert.equal(linked(html, 'Funding named'), true, `who pays explains funding, on ${on}`)
      // nobody reachable is the widest gap here, and no section of Compare counts it
      const unreachable = [{ id: 'x', ai_rating: '9', funding_source: 'Waiver', expiration_date: inDays(30) }]
      const gapHtml = draw({ state: 'ready', analysis: analyseReferrals(unreachable, NOW) }, on)
      assert.equal(linked(gapHtml, 'no phone or e-mail'), false, `the unreachable gap on ${on}`)
    }
  })
})

describe('the black header on the Unique screen', () => {
  const ready = (): ReferralRead => ({ state: 'ready', analysis: analyseReferrals(ROWS, NOW) })
  const row = (id: string): Lead => ROWS.find((r) => r.id === id) as Lead

  it('reading one referral, it places THAT one in the ranking — not the leader', () => {
    const html = draw(ready(), 'unique', undefined, row('b'))
    assert.match(html, /This referral/)
    assert.match(html, /of 5 ranked · score 7 · reachable · 40d left · not on the board yet/)
    assert.deepEqual(figures(html).slice(0, 3), ['5', '#3', '11/20'], 'third of five, eleven of twenty')
    assert.doesNotMatch(html, /First in the ranking/)
    assert.doesNotMatch(html, /Ada Stone/, 'the leader is not this screen’s question')
  })

  it('whether it is already on the board is the board’s own rule, not a second one', () => {
    const html = draw(ready(), 'unique', undefined, row('e'))
    assert.deepEqual(figures(html).slice(0, 3), ['5', '#2', '15/20'])
    assert.match(html, /of 5 ranked · score 8 · reachable · funding named · no expiry date · on the board/)
  })

  it('with no referral chosen, the screen carries the whole file’s header', () => {
    const html = draw(ready(), 'unique')
    assert.match(html, /First in the ranking/)
    assert.match(html, /Ada Stone/)
    assert.match(html, /href="\/app\/potential-clients\/compare"/, 'and Compare is one click away')
  })

  it('a referral the read does not hold says so — it is not placed first', () => {
    const html = draw(ready(), 'unique', undefined, { id: 'zz', client_name: 'Not in the read' })
    assert.match(html, /this referral is not in the read/)
    assert.equal(figures(html)[1], '—', 'no place is invented for it')
  })

  it('an unanswered read leaves the place a dash, like every other figure', () => {
    const html = draw({ state: 'loading' }, 'unique', undefined, row('a'))
    assert.match(html, /Reading the referrals/)
    for (const f of figures(html)) assert.equal(f, '—')
  })

  it('a failed read with a referral open is unknown — never a place, never a zero', () => {
    const html = draw({ state: 'failed', reason: 'Sheet quota exceeded' }, 'unique', () => {}, row('a'))
    assert.match(html, /could not be read, so these figures are unknown — not zero/)
    assert.match(html, /unknown — the read failed/)
    for (const f of figures(html)) assert.equal(f, '—')
  })
})

describe('the strips under the header', () => {
  const labels = (page: { config: Record<string, unknown> }) =>
    ((page.config.summaryStrip as { items: { label: string }[] }).items).map((i) => i.label)

  it('repeat nothing the header states', () => {
    assert.deepEqual(labels(potentialClientsPipelinePage), ['Still open'])
    assert.deepEqual(labels(potentialClientsFunnelPage), ['Median score', 'Already contacted', 'Needs 24/7'])
  })

  it('still open is a dated referral that has not expired — the header’s own reading of a date', () => {
    const now = Date.now()
    const day = (d: number) => new Date(now + d * 86_400_000).toISOString()
    const rows: Lead[] = [
      { expiration_date: day(20) }, { expiration_date: day(1) }, { expiration_date: day(-2) },
      { expiration_date: '' }, { expiration_date: 'soon' },
    ]
    const strip = potentialClientsPipelinePage.config.summaryStrip as { items: { compute: (r: Lead[]) => number }[] }
    assert.equal(strip.items[0].compute(rows), 2, 'a blank or unreadable date is neither open nor expired')
    assert.equal(analyseReferrals(rows, now).expired, 1)
  })

  it('the registry reads no score or date for itself', () => {
    const root = process.env.SPA_ROOT ?? process.cwd()
    const src = readFileSync(resolve(root, 'src/registry/apps-potclients.ts'), 'utf8')
    assert.doesNotMatch(src, /Number\(/, 'no private reading of a score')
    assert.doesNotMatch(src, /new Date\(|Date\.parse\(/, 'no private reading of a date')
  })
})

describe('the screens that carry it', () => {
  const root = process.env.SPA_ROOT ?? process.cwd()
  for (const file of ['PotentialClientsPage', 'PotentialClientsComparePage', 'PotentialClientsFunnelPage', 'PotentialClientUniquePage']) {
    it(`${file} draws the header over itself`, () => {
      const src = readFileSync(resolve(root, `src/pages/features/potclients/${file}.tsx`), 'utf8')
      assert.match(src, /<ReferralsHero\b/)
      assert.match(src, /useReferralAnalysis\(\)/)
    })
  }

  it('the Unique screen hands the header the referral it is reading', () => {
    const src = readFileSync(resolve(root, 'src/pages/features/potclients/PotentialClientUniquePage.tsx'), 'utf8')
    assert.match(src, /<ReferralsHero read=\{referrals\.read\} on="unique" record=\{rec\}/)
    assert.doesNotMatch(src, /catch\(\(\) => setRows\(\[\]\)\)/, 'a failed read is never an empty list')
  })

  it('Compare counts nothing for itself — every figure is the shared analysis', () => {
    const src = readFileSync(resolve(root, 'src/pages/features/potclients/PotentialClientsComparePage.tsx'), 'utf8')
    assert.doesNotMatch(src, /Number\(/, 'no private reading of a score')
    assert.doesNotMatch(src, /Date\.parse\(/, 'no private reading of a date')
  })

  it('the Funnel address is the page that carries the header', () => {
    const src = readFileSync(resolve(root, 'src/pages/AppRoutePage.tsx'), 'utf8')
    assert.match(src, /'potential-clients\/funnel': PotentialClientsFunnelPage/)
  })
})
