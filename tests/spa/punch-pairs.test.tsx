/**
 * The punch pairs on the punch board (punchPairsLogic.ts, PunchWarnings.tsx): a chip for every pair verdict
 * and every warning state the relay writes, read off server/punch_pairs.py; a card the relay could not
 * write said in words beside an em dash; and a RECEIVED offered only where a warning really reached a
 * director. The relay's side is tools/test-punch-pairs.py.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import {
  PAIR, WARNING_STATE, mayAnswer, pairSpec, pairsCardState, warningSentence, warningSpec,
  type PairsCard, type PunchWarning,
} from '@/pages/features/smartcomms/punchPairsLogic'
import PunchWarnings from '@/pages/features/smartcomms/PunchWarnings'

const ROOT = resolve(process.cwd())
const PY = readFileSync(resolve(ROOT, 'server/punch_pairs.py'), 'utf8')
const SLICE = readFileSync(resolve(ROOT, 'server/punch_board_slices.py'), 'utf8')

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

/** The values of `NAME = "word"` constants listed in a Python tuple, read off the source. */
function wordsOf(tuple: string): string[] {
  const names = new RegExp(`^${tuple} = \\(([^)]*)\\)`, 'm').exec(PY)?.[1] ?? ''
  return names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => {
    const m = new RegExp(`^${n} = "([a-z_]+)"`, 'm').exec(PY)
    return m ? m[1] : `?${n}`
  })
}

const warning = (over: Partial<PunchWarning> = {}): PunchWarning => ({
  id: 'danareed|2026-09-22T11:00:00+00:00', ref: 'PW0123456789', person: 'Dana Reed', house: 'JH',
  house_name: 'JH home', shift_code: '7a-3p', day: '2026-09-22', shift_at: '2026-09-22T07:00:00-04:00',
  state: 'warned', tells: 2, delivered: 1, why: 'the 3 reminders that reached them have all been said',
  opened_at: '2026-09-22T08:40:00-04:00', told_at: '2026-09-22T09:00:00-04:00', received_by: '',
  call_off_ref: '', ...over,
})

describe('every verdict and state the relay writes has its own chip', () => {
  it('reads the pair verdicts off punch_pairs.py and finds a label for each', () => {
    const verdicts = wordsOf('VERDICTS')
    assert.equal(verdicts.length, 7, verdicts.join(','))
    for (const v of verdicts) {
      assert.ok(v in PAIR, `the verdict "${v}" has no chip`)
      assert.notEqual(pairSpec(v)?.label, v)
    }
  })
  it('reads the warning states off punch_pairs.py and finds a label for each', () => {
    const states = wordsOf('STATES')
    assert.equal(states.length, 5, states.join(','))
    for (const s of states) {
      assert.ok(s in WARNING_STATE, `the state "${s}" has no chip`)
      assert.notEqual(warningSpec(s).label, s)
    }
  })
  it('never draws an unknown verdict as a finding', () => {
    assert.equal(PAIR.unreadable.tint, null)
    assert.equal(PAIR.double_booked.tint, null)
    assert.equal(pairSpec('something_new')?.tint, null)
  })
  it('the slice lets the pair fields and the card through its allow-list', () => {
    for (const f of ['"pair"', '"pair_fault"', '"pair_why"', '"warning_state"', '"warning_ref"', '"pairs"']) {
      assert.ok(SLICE.includes(f), `${f} is not on the slice's allow-list`)
    }
  })
})

const READ_AT = '2026-09-22T09:01:00-04:00'

describe('the warnings card', () => {
  it('lists every warning, the stopped ones with their reason', () => {
    const card: PairsCard = {
      paired_at: '2026-09-22T09:00:00-04:00', stale: '', counts: { missing: 1 }, warnings_at: READ_AT,
      warnings: [warning(), warning({ id: 'x', ref: 'PWAAAAAAAAAA', person: 'Kim Ash', state: 'gave_up', delivered: 0,
                                     why: 'the shift ended with no answer from a director' })],
    }
    const html = draw(<PunchWarnings card={card} />)
    assert.match(html, /Dana Reed/)
    assert.match(html, /Kim Ash/)
    assert.match(html, /the shift ended with no answer from a director/)
    assert.match(html, /Warnings to the directors — 2/)
  })
  it('offers RECEIVED only on a live warning that really reached a director', () => {
    assert.equal(mayAnswer(warning()), true)
    assert.equal(mayAnswer(warning({ delivered: 0 })), false)
    assert.equal(mayAnswer(warning({ state: 'gave_up' })), false)
    const reached = draw(<PunchWarnings card={{ warnings: [warning()], warnings_at: READ_AT }} />)
    assert.match(reached, />RECEIVED</)
    const rehearsed = draw(<PunchWarnings card={{ warnings: [warning({ delivered: 0 })], warnings_at: READ_AT }} />)
    assert.doesNotMatch(rehearsed, />RECEIVED</)
    assert.match(warningSentence(warning({ delivered: 0 })), /none of them reached a director/)
  })
  it('a card the relay could not write is an em dash and a sentence — never zero warnings', () => {
    const html = draw(<PunchWarnings card={undefined} />)
    assert.match(html, /Warnings to the directors — —/)
    assert.match(html, /could not be read/)
    assert.doesNotMatch(html, /No warning in the last two days/)
    assert.equal(pairsCardState({ readable: false, why: 'the punch pairs could not be read (KeyError)' }).kind, 'unread')
  })
  it('a stale pairing says so, and that nothing is told or answered from it', () => {
    const got = pairsCardState({ stale: 'the shifts were last paired 25 minutes ago', warnings: [], warnings_at: READ_AT })
    assert.equal(got.kind, 'stale')
    assert.match(got.text, /no warning is opened, told or answered/)
    assert.match(draw(<PunchWarnings card={{ stale: 'the shifts were last paired 25 minutes ago', warnings: [],
                                             warnings_at: READ_AT }} />),
      /last paired 25 minutes ago/)
  })
  it('warnings never read are an em dash and a sentence — never "0" and never "no warning"', () => {
    for (const card of [{ warnings: [], warnings_at: '' }, { warnings: [] },
                        { warnings: [], stale: 'the shifts have not been paired since the relay started' }] as PairsCard[]) {
      const got = pairsCardState(card)
      assert.equal(got.kind, 'unread', JSON.stringify(card))
      const html = draw(<PunchWarnings card={card} />)
      assert.match(html, /Warnings to the directors — —/)
      assert.match(html, /could not be read yet/)
      assert.doesNotMatch(html, /No warning in the last two days/)
      assert.doesNotMatch(html, /Warnings to the directors — 0/)
    }
    const relay = pairsCardState({ readable: false, warnings: [],
                                   why: 'the warnings to the directors have not been read since the relay started' })
    assert.equal(relay.kind, 'unread')
    assert.match(relay.text, /have not been read since the relay started/)
  })
  it('a read that failed after one that landed keeps the list and says it may be out of date', () => {
    const card: PairsCard = { warnings: [warning()], warnings_at: READ_AT,
                              warnings_why: 'the last read of the warnings failed (OperationalError)' }
    const got = pairsCardState(card)
    assert.equal(got.kind, 'stale')
    assert.match(got.text, /the last read of the warnings failed \(OperationalError\): the list below is the last one read/)
    const html = draw(<PunchWarnings card={card} />)
    assert.match(html, /Warnings to the directors — 1/)
    assert.match(html, /may be out of date/)
  })
  it('a warning is told with no cap: the board says so and gives the real span, never "at the cap"', () => {
    assert.match(WARNING_STATE.warned.means, /no cap/)
    assert.doesNotMatch(WARNING_STATE.gave_up.means, /cap/)
    assert.match(WARNING_STATE.gave_up.means, /shift ended/)
    const told = warning({ tells: 7, delivered: 7, span: 'it was said 7 time(s) over 120 minutes, from 09:00 to 11:00' })
    assert.equal(warningSentence(told),
      'Said 7 time(s) over 120 minutes, from 09:00 to 11:00; 7 reached a director. Each director may answer RECEIVED PW0123456789.')
    assert.equal(mayAnswer(told), true)
  })
  it('a warning nobody could be told says why, instead of promising the next beat', () => {
    const held = warning({ tells: 0, delivered: 0, unheard: 'calsample: the situation shift_punch_warning is off or absent' })
    assert.match(warningSentence(held), /^Not told yet — the last try reached nobody \(calsample: the situation shift_punch_warning is off or absent\)/)
    assert.match(warningSentence(held), /tried again until a director answers RECEIVED, the punches arrive or the shift ends/)
    assert.doesNotMatch(warningSentence(held), /next beat/)
    assert.match(warningSentence(warning({ tells: 0, delivered: 0 })), /next beat/)
    assert.match(warningSentence(warning({ tells: 3, delivered: 1, unheard: 'annqexample: failed' })),
      /The last try reached nobody \(annqexample: failed\)\.$/)
  })
  it('the relay card says unread, with the reason, until a post has read the warnings', () => {
    assert.match(PY, /if not w_at:\s*\n\s*out\.update\(readable=False, warnings=\[\]/)
    assert.match(PY, /_warnings_failed\(type\(exc\)\.__name__\)/)
  })
  it('a due telling the directors list kept back says so — never "not told yet, it goes at the next beat"', () => {
    const blank = warning({ tells: 0, delivered: 0,
      waits: 'the directors list on the Time Off settings is blank, so nobody is warned and nobody may answer - nobody is told until it can be' })
    const said = warningSentence(blank)
    assert.match(said, /^Not told yet — the directors list on the Time Off settings is blank/)
    assert.match(said, /nobody is told until it can be\.$/)
    assert.doesNotMatch(said, /next beat/)
    const again = warningSentence(warning({ tells: 4, delivered: 4, span: 'it was said 4 time(s) over 60 minutes, from 09:00 to 10:00',
      waits: 'the time clock has not been read in the last 20 minutes - it is told at the next read that still shows no punch, which is asked for now' }))
    assert.match(again, /Each director may answer RECEIVED PW0123456789\. The next telling waits: the time clock has not been read/)
    assert.match(PY, /"waits": ""/)
    assert.match(PY, /def _note_waits\(/)
  })
  it('an answered warning says why it is not open yet — never the reason it was opened', () => {
    const refused = warning({ state: 'received', received_by: 'Cal Sample',
      call_off_why: 'the house calendars could not be read (OperationalError)' })
    assert.equal(warningSentence(refused),
      'Cal Sample answered RECEIVED — not open yet: the house calendars could not be read (OperationalError); it is tried again.')
    assert.doesNotMatch(warningSentence(refused), /reminders that reached them/)
    const reading = warningSentence(warning({ state: 'received', received_by: 'Cal Sample', call_off_why: '' }))
    assert.match(reading, /not open yet: it opens as a call off on the next read of the time clock/)
    assert.doesNotMatch(reading, /reminders that reached them/)
    assert.match(PY, /"call_off_why": str\(w\.get\("call_off_why"\) or ""\)/)
  })
  it('a shift that shares its calendar cell never promises an open shift: RECEIVED stops it, and it is opened by hand', () => {
    const shared = warning({ by_hand: 'the JH home calendar holds this shift in one cell with 1 other shift(s)' })
    assert.match(warningSentence(shared), /shares its calendar cell .* opened by hand on the house calendar\.$/)
    assert.doesNotMatch(warningSentence(warning()), /by hand/)
    const html = draw(<PunchWarnings card={{ warnings: [shared], warnings_at: READ_AT }} />)
    assert.match(html, /opened by hand/)
    assert.match(PY, /^K_WARNING_BY_HAND = "punch_warning_by_hand"$/m)
  })
})
