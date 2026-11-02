/**
 * THE DESK'S BOARD OF DOORS WITHOUT WORDS (SmartCommsPage GateBoard).
 *
 * The board is read by a person deciding whether to arm a door, so what it must
 * never do is say something it did not read:
 *   · a backend that did not carry the gates is "this desk was not told",
 *     never an empty board — and a read still in flight, failed or refused
 *     says that instead, never "not told";
 *   · an unreadable send switch, or one whose word nobody defined, is drawn
 *     as HOLDING, never as off;
 *   · a gate whose asking code is not in the published build is "not wired",
 *     never "holding now", whatever its switch says;
 *   · a door that hands a person something for ever says an unreadable tab
 *     holds it too;
 *   · each authentication letter says where its words live.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToString as renderBare } from 'react-dom/server'
import { GateBoard, type AuthLetterFact, type GateFact } from '@/pages/features/smartcomms/SmartCommsPage'

/** The cards animate in, and the animation asks the window for a resize listener; the test window
 *  is deliberately bare (tests/spa/env.ts), so each render lends it those and takes them back. */
function renderToString(node: ReactNode): string {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    return renderBare(node)
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}

/** The words a reader sees, in order. */
function words(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .split(/<[^>]+>/)
    .map((t) => t.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim())
    .filter(Boolean)
    .join(' ')
}

const gate = (over: Partial<GateFact>): GateFact => ({
  id: 'gate_x', label: 'a door', reaches: 'somebody', costs: 'something',
  relay: false, known: true, armed: false, holds_now: false, ...over,
})

const letter = (over: Partial<AuthLetterFact>): AuthLetterFact => ({
  kind: 'password_reset', id: 'auth_password_reset', known: true, on: true,
  delivered_while_held: true, note: '', ...over,
})

describe('the board of doors without words', () => {
  it('says it was not told when the read carried no gates and no letters — never an empty board', () => {
    const text = words(renderToString(<GateBoard gates={null} letters={null} />))
    assert.match(text, /This desk was not told\. The read it makes did not carry the gates/)
    assert.match(text, /It is not an all-clear/)
    assert.match(text, /This desk was not told which letters carry the exemption/)
    assert.doesNotMatch(text, /armed|holding now/)
  })

  it('a read still in flight is being read — never "not told"', () => {
    const text = words(renderToString(<GateBoard gates={null} letters={null} reading />))
    assert.match(text, /Reading the doors…/)
    assert.match(text, /Reading the letters…/)
    assert.doesNotMatch(text, /not told/)
  })

  it('a read that failed says the doors are unknown and why — never "not told"', () => {
    const text = words(renderToString(<GateBoard gates={null} letters={null} readError="timeout" />))
    // the bold lead is its own element, so the words helper sets its comma apart
    assert.match(text, /The situations read failed ?, so which doors are armed is unknown — timeout\. It is not an all-clear/)
    assert.match(text, /which letters carry the exemption is unknown — timeout/)
    assert.doesNotMatch(text, /not told/)
  })

  it('a refused read is a refusal, not a silence', () => {
    const text = words(renderToString(
      <GateBoard gates={null} letters={null} refused readError="Admins only" />,
    ))
    assert.match(text, /This desk was refused\. The situations read was declined for this account/)
    assert.match(text, /Admins only/)
    assert.doesNotMatch(text, /not told|Reading the doors/)
  })

  it('a board from an earlier read says the latest one failed', () => {
    const text = words(renderToString(
      <GateBoard gates={{ lane: 'holding', gates: [gate({})] }} letters={[]} readError="timeout" />,
    ))
    assert.match(text, /The latest situations read failed \(timeout\), so this board is the one this desk last read/)
    assert.match(text, /The send switch is on/)
  })

  it('a switch word nobody defined, or none at all, is never drawn as off — the board holds', () => {
    for (const lane of ['', 'paused']) {
      const text = words(renderToString(
        <GateBoard gates={{ lane, gates: [gate({ armed: true, label: 'the funnel' })] }} letters={[
          letter({}),
        ]} />,
      ))
      assert.match(text, /This desk was not told the state of the send switch/, lane)
      assert.match(text, /A switch nobody named is not an off switch/, lane)
      assert.match(text, /the funnel armed holding now/, lane)
      assert.match(text, /delivered while the lane holds/, lane)
      assert.doesNotMatch(text, /The send switch is off/, lane)
    }
    assert.match(words(renderToString(<GateBoard gates={{ lane: 'paused', gates: [] }} letters={[]} />)),
      /the read said “paused”/)
  })

  it('draws an unreadable switch as holding, and an armed door as holding now', () => {
    const text = words(renderToString(
      <GateBoard gates={{ lane: 'unreadable', gates: [gate({ armed: true, label: 'the funnel' })] }} letters={[]} />,
    ))
    assert.match(text, /The send switch could not be read\./)
    assert.match(text, /An unreadable switch HOLDS — it is not an off switch/)
    assert.match(text, /the funnel armed holding now/)
    assert.doesNotMatch(text, /The send switch is off/)
  })

  it('never draws a door as holding when nothing in the build asks its switch', () => {
    const text = words(renderToString(
      <GateBoard gates={{ lane: 'holding', gates: [gate({
        armed: true, label: 'the resource door', wired: false,
        wired_why: 'the door that asks this gate is in Main.gs, which is not published with this package',
      })] }} letters={[]} />,
    ))
    assert.match(text, /not wired in this build/)
    assert.match(text, /Nothing asks this switch yet: the door that asks this gate is in Main\.gs/)
    assert.doesNotMatch(text, /holding now/)
  })

  it('says a door that reaches a person holds on an unreadable tab, and carries a caveat when there is one', () => {
    const text = words(renderToString(
      <GateBoard gates={{ lane: 'off', gates: [
        gate({ label: 'Drive access', person: true }),
        gate({ id: 'gate_y', label: 'the funnel', caveat: 'a held create is still answered as saved' }),
      ] }} letters={[]} />,
    ))
    assert.match(text, /The send switch is off\. Nothing below is holding/)
    assert.match(text, /reaches a person/)
    assert.match(text, /If the situations tab cannot be read, this door holds while the send switch holds/)
    assert.match(text, /a held create is still answered as saved/)
  })

  it('says when a switch takes effect when the backend says it, and says nothing of it when it does not', () => {
    const lag = 'An `enabled` cell typed straight into the situations tab acts only when the armed map is ' +
                'rebuilt — up to 5 minutes later.'
    const told = words(renderToString(
      <GateBoard gates={{ lane: 'holding', gates: [gate({})], lag }} letters={[]} />,
    ))
    assert.match(told, /acts only when the armed map is rebuilt — up to 5 minutes later/)
    const older = words(renderToString(
      <GateBoard gates={{ lane: 'holding', gates: [gate({})] }} letters={[]} />,
    ))
    assert.doesNotMatch(older, /armed map is rebuilt/)
  })

  it('says where each letter\'s words live, and that a letter switched off does not send at all', () => {
    const text = words(renderToString(
      <GateBoard gates={{ lane: 'holding', gates: [] }} letters={[
        letter({ email_words: 'row' }),
        letter({ kind: 'invitation', id: 'auth_invitation', on: false, email_words: 'template' }),
        letter({ kind: 'mystery', id: 'auth_mystery' }),
      ]} />,
    ))
    assert.match(text, /password reset on delivered while the lane holds/)
    assert.match(text, /The e-mail’s subject and words are this row’s cells/)
    assert.match(text, /invitation off — does not send at all/)
    assert.match(text, /The e-mail is a designed letter whose words are not in this row/)
    assert.match(text, /This desk was not told where this letter’s words live/)
    assert.match(text, /the letter is held and the log says why/)
  })

  it('draws a letter that claims a kind it does not own under its own name, with the row it also needs', () => {
    const text = words(renderToString(
      <GateBoard gates={{ lane: 'holding', gates: [] }} letters={[
        letter({ kind: 'invitation', id: 'auth_invitation', email_words: 'row' }),
        letter({ kind: 'invitation', id: 'user_release_invite', label: 'the release invite (a first password)',
                 also_needs: 'auth_invitation', on: false, email_words: 'row' }),
      ]} />,
    ))
    assert.match(text, /The letters that leave while the lane is holding/)
    assert.doesNotMatch(text, /The two letters/)
    assert.match(text, /the release invite \(a first password\) off — does not send at all/)
    assert.match(text, /sends only while this row and auth_invitation are both on/)
    // a decision, said in plain words: this letter passes test mode, its text does not
    assert.match(text, /Its letter passes test mode: it claims the invitation’s exemption/)
    assert.match(text, /reaches the real person while test mode holds every other message, and only its text waits/)
  })
})
