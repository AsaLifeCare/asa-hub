/**
 * The "covered" follow-up on the Broadcast page (coveredLogic.ts, CoveredNotices.tsx): chips read off the .gs,
 * the sentences, the hand-typed warning. The door's side is the `open shift covered` self-test.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import {
  COVERED_COLUMNS, countOf, coveredChip, coveredSentence, looksLikeCovered,
  type CoveredBoard, type CoveredItem,
} from '@/pages/features/smartcomms/coveredLogic'
import CoveredNotices from '@/pages/features/smartcomms/CoveredNotices'

const ROOT = resolve(process.cwd())
const GS = readFileSync(resolve(ROOT, 'apps-script/CommOpenShiftCovered.gs'), 'utf8')

/** Renders with window listeners lent for the animation, then taken back. */
function draw(node: Parameters<typeof renderToString>[0]): string {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    return renderToString(node)
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}

const item = (over: Partial<CoveredItem> = {}): CoveredItem => ({
  id: 'COF_1', day: '2026-09-22', house: 'JH', state: 'recorded', rehearsal: false,
  why: 'the sending dial stands at `record`', at: '2026-09-22T16:00:00Z', filled_at: '2026-09-22T15:59:00Z',
  count: '0/3', audience: 3, ask: 'recorded', ...over,
})

const board = (over: Partial<CoveredBoard> = {}): CoveredBoard => ({
  can_see: true, why: '',
  situation: { id: 'open_shift_covered', on: true, found: true,
               sms_text: 'OPEN SHIFT COVERED\nThe shift for {house} at {time} {day_word} has been covered.' },
  items: [item()], error: '', ...over,
})

describe('every ending the door writes has its own chip', () => {
  it('reads the endings off CommOpenShiftCovered.gs and finds a label for each', () => {
    const written = new Set<string>()
    for (const m of GS.matchAll(/openShiftCoveredEnd_\([^,]+,\s*'([a-z_]+)'/g)) written.add(m[1])
    for (const m of GS.matchAll(/state = '([a-z_]+)'/g)) written.add(m[1])
    assert.ok(written.size >= 6, `found only ${[...written].join(', ')}`)
    for (const s of written) {
      assert.notEqual(coveredChip(s).label, s, `"${s}" has no chip of its own`)
    }
  })
})

describe('the sentence under a follow-up', () => {
  it('says the people were told only when they were', () => {
    assert.match(coveredSentence(item({ state: 'told', count: '3/3' })).text, /3 of 3 people .* were told/)
    for (const s of ['recorded', 'rehearsed', 'held', 'nobody_heard', 'ask_dropped', 'unknown_audience', 'stale', 'waiting']) {
      assert.doesNotMatch(coveredSentence(item({ state: s })).text, / were told the shift is covered/, s)
    }
  })
  it('says NOBODY WAS CONTACTED whenever nothing left, and names the mock outbox in test mode', () => {
    const rec = coveredSentence(item({ state: 'recorded' })).text
    assert.match(rec, /mock outbox \(ASA Data — CommMock\)/)
    assert.match(rec, /NOBODY WAS CONTACTED/)
    for (const s of ['held', 'nobody_heard', 'unknown_audience', 'stale']) {
      assert.match(coveredSentence(item({ state: s })).text, /NOBODY WAS CONTACTED/, s)
    }
  })
  it('a stopped pass says how many were told, and that the rest are not', () => {
    const t = coveredSentence(item({ state: 'partial', count: '2/5' })).text
    assert.match(t, /2 of 5 people were told/)
    assert.match(t, /never sent twice/)
  })
  it('reads the count the door writes', () => {
    assert.deepEqual(countOf('3/77'), { sent: 3, of: 77 })
    assert.deepEqual(countOf(''), { sent: null, of: null })
  })
})

describe('a manager typing "covered" by hand is told it was already said', () => {
  it('recognises the outside form\'s own follow-ups, and not an ask', () => {
    assert.equal(looksLikeCovered('ASA ALERT 48A\nOPEN SHIFT FOR 9/18\nHas been filled.\nThank you!'), true)
    assert.equal(looksLikeCovered('ABD ALERT  Open shift with KC covered. Thank you Charmaine'), true)
    assert.equal(looksLikeCovered('ABD ALERT  Sorry so late! Shift filled with KC.  Thank you Temeka'), true)
    assert.equal(looksLikeCovered('ASA ALERT\nCoverage need 2-6pm TODAY with MS'), false)
    assert.equal(looksLikeCovered('Open shift today 2P-10P at MS. Please contact Tonisha'), false)
  })
  it('the composer says it, beside the words, and never blocks', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/features/smartcomms/SmartCommsBroadcastPage.tsx'), 'utf8')
    assert.match(src, /looksLikeCovered\(c\.message\)/)
    assert.doesNotMatch(src, /reviewBlock\([^)]*looksLikeCovered/)
    assert.match(src, /<CoveredNotices \/>/)
  })
})

describe('Share, Export and Print carry the follow-ups as shown', () => {
  it('the state column is the chip and the last column is the sentence', () => {
    const state = COVERED_COLUMNS.find((c) => c.label === 'State')!
    const what = COVERED_COLUMNS.find((c) => c.label === 'What happened')!
    assert.equal(String(state.accessor!(item({ state: 'told' }))), 'Told')
    assert.match(String(what.accessor!(item())), /NOBODY WAS CONTACTED/)
  })
})

describe('the section draws', () => {
  it('draws what the door handed over — the house, the day, the chip, the sentence — and never the caller', () => {
    const html = draw(<CoveredNotices initial={board({
      items: [item(), item({ id: 'COF_2', state: 'told', count: '3/3', why: '3 of 3 told · filled by Ann Able' })],
    })} />)
    assert.match(html, /said by itself/)
    assert.match(html, /JH/)
    assert.match(html, /Recorded — not sent/)
    assert.match(html, /NOBODY WAS CONTACTED/)
    assert.match(html, /nobody needs to text them again/)
    assert.match(html, /open_shift_covered/)
    assert.doesNotMatch(html, /Zed Caller/)
  })
  it('says the row is off when it is, and draws nothing for somebody it is not open to', () => {
    const off = draw(<CoveredNotices initial={board({
      situation: { id: 'open_shift_covered', on: false, found: true, sms_text: '' } })} />)
    assert.match(off, /switched off on the Desk/)
    assert.equal(draw(<CoveredNotices initial={board({ can_see: false, items: [] })} />), '')
  })
  it('a list that could not be read says so rather than drawing an empty one', () => {
    const html = draw(<CoveredNotices initial={board({ items: [], error: 'the call-off house could not be read' })} />)
    assert.match(html, /could not be read/)
    assert.doesNotMatch(html, /No call-off shift has been filled/)
  })
  it('offers no browser dialog and uses the platform\'s own Share and Export', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/features/smartcomms/CoveredNotices.tsx'), 'utf8')
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(/)
    assert.match(src, /share\(\{/)
    assert.match(src, /<ExportMenu /)
    assert.match(src, /'openShiftCoveredBoard'/)
  })
})
