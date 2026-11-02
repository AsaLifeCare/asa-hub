/**
 * The Broadcast page (broadcastLogic.ts and the page): length rules read off the .gs, preview keys,
 * Send refusals and sentences. The door's side is the `staff broadcast` self-test.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import {
  HISTORY_COLUMNS, SIGNATURE_MAX, TEXT_MAX, TEXT_MIN, composerFromRow, composerKey, composerPayload, headline,
  modeSentences,
  outcomeChip, previewMatches, reviewBlock, rowActions, sendBlock, stateChip, tallyWords, textProblem,
  type BroadcastBoard, type BroadcastMode, type BroadcastPreview, type BroadcastRow, type Composer,
} from '@/pages/features/smartcomms/broadcastLogic'
import SmartCommsBroadcastPage from '@/pages/features/smartcomms/SmartCommsBroadcastPage'
import { notificationManifests } from '@/registry/apps-notifications'

const ROOT = resolve(process.cwd())
const GS = readFileSync(resolve(ROOT, 'apps-script/CommBroadcast.gs'), 'utf8')
const gsNumber = (name: string): number => {
  const m = new RegExp(`var ${name} = (\\d+);`).exec(GS)
  return m ? Number(m[1]) : NaN
}

const MODE: BroadcastMode = {
  test_mode: 'on', dial: 'record', dial_readable: true, quiet_now: false,
  quiet_words: '21:31–07:59 New York', quiet_until: '08:00', send_switch: 'off',
}
const SIT = { id: 'staff_broadcast', on: true, found: true, sms_text: '{message}\n{signature}', cc_count: 0, why: '' }

const board = (over: Partial<BroadcastBoard> = {}): BroadcastBoard => ({
  can_send: true, above: false, hm: true, master: false, why: '', name: 'Ann Able',
  audiences: [
    { id: 'allstaff', label: 'All staff', allowed: true, why: '' },
    { id: 'house', label: 'One house', allowed: true, why: '' },
    { id: 'leadership', label: 'Leadership', allowed: false, why: 'Leadership is sent by a director.' },
  ],
  houses: [{ location: 'CAN - 48TH (A) - ABD1547', label: '48TH (A)', people: 3, meddel: 2 }],
  own_houses_via: 'name', situation: SIT, mode: MODE, house_ready: true,
  calendar: { readable: true, why: '', from: '2026-08-25' },
  limits: { text_min: 2, text_max: 1400, signature_max: 160, cap: 200 },
  history: [], history_error: '', ...over,
})

const preview = (over: Partial<BroadcastPreview> = {}): BroadcastPreview => ({
  audience: 'allstaff', audience_label: 'All staff', house: '', house_label: '', meddel: false,
  readable: true, refused: '', why: [], notes: [], count: 3, cap: 200, over_cap: false,
  recipients: [{ name: 'Ann Able', to: '•••0101', from: 'people' }], dropped: [], audience_sha: 'abc',
  sample: 'Open shift', chars: 10, too_long: false, reason_words: [], situation: SIT, mode: MODE, ...over,
})

const row = (over: Partial<BroadcastRow> = {}): BroadcastRow => ({
  id: 'BC_1', at: '2026-09-22T16:00:00Z', updated_at: '2026-09-22T16:00:10Z', by_name: 'Ann Able', mine: true,
  audience: 'allstaff', audience_label: 'All staff', house: '', meddel: false, message: 'Open shift today',
  signature: '', body_sample: 'Open shift today', state: 'done', count: 3,
  tally: { pending: 0, sent: 0, recorded: 3, held: 0, refused: 0, failed: 0, withdrawn: 0 },
  test_mode: 'on', dial: 'record', why: '', warnings: '', dropped: [], withdrawn_by: '', withdrawn_at: '',
  can_continue: false, can_withdraw: false, recipients: [], ...over,
})

const compose = (over: Partial<Composer> = {}): Composer => ({
  audience: 'allstaff', house: '', meddel: false, message: 'Open shift today', signature: '', ...over,
})

describe('the length rules are the door\'s own, number for number', () => {
  it('reads the same three numbers CommBroadcast.gs refuses with', () => {
    assert.equal(TEXT_MIN, gsNumber('COMM_BROADCAST_TEXT_MIN'))
    assert.equal(TEXT_MAX, gsNumber('COMM_BROADCAST_TEXT_MAX'))
    assert.equal(SIGNATURE_MAX, gsNumber('COMM_BROADCAST_SIGNATURE_MAX'))
  })
  it('refuses an empty, a "." and a one-character text, and lets two characters through', () => {
    assert.notEqual(textProblem('', ''), '')
    assert.notEqual(textProblem('.', ''), '')
    assert.notEqual(textProblem('  a  ', ''), '')
    assert.equal(textProblem('ok', ''), '')
  })
  it('refuses too long a message or signature, saying its length', () => {
    assert.match(textProblem('x'.repeat(TEXT_MAX + 1), ''), new RegExp(String(TEXT_MAX + 1)))
    assert.match(textProblem('Open shift', 's'.repeat(SIGNATURE_MAX + 1)), new RegExp(String(SIGNATURE_MAX)))
  })
})

describe('a preview is good only for what it was taken of', () => {
  it('the house and its Med Del filter ride with the one-house audience alone', () => {
    const p = composerPayload(compose({ audience: 'allstaff', house: 'CAN - X', meddel: true }))
    assert.equal(p.house, '')
    assert.equal(p.meddel, false)
    const h = composerPayload(compose({ audience: 'house', house: 'CAN - X', meddel: true }))
    assert.equal(h.house, 'CAN - X')
    assert.equal(h.meddel, true)
  })
  it('a changed word, audience or signature needs a new review; trailing space does not', () => {
    const c = compose()
    const key = composerKey(c)
    assert.equal(previewMatches(c, key), true)
    assert.equal(previewMatches({ ...c, message: 'Open shift today!' }, key), false)
    assert.equal(previewMatches({ ...c, audience: 'meddel' }, key), false)
    assert.equal(previewMatches({ ...c, signature: 'Ann' }, key), false)
    assert.equal(previewMatches({ ...c, message: 'Open shift today  ' }, key), true)
    assert.equal(previewMatches(c, ''), false)
  })
})

describe('the buttons refuse in words what the door would refuse', () => {
  it('Review waits for the page, the right, an audience, a house and a text', () => {
    assert.notEqual(reviewBlock(compose(), null), '')
    assert.match(reviewBlock(compose(), board({ can_send: false, why: 'not you' })), /not you/)
    assert.match(reviewBlock(compose({ audience: 'leadership' }), board()), /director/)
    assert.match(reviewBlock(compose({ audience: 'house' }), board()), /house/)
    assert.notEqual(reviewBlock(compose({ message: '.' }), board()), '')
    assert.equal(reviewBlock(compose(), board()), '')
  })
  it('Send refuses a switched-off row, an unminted house, a blind switch, nobody, too many and too long', () => {
    assert.match(sendBlock(null, board()), /Review/)
    assert.match(sendBlock(preview({ situation: { ...SIT, on: false, why: 'switched off' } }), board()), /switched off/)
    assert.match(sendBlock(preview(), board({ house_ready: false })), /not minted/)
    assert.match(sendBlock(preview({ mode: { ...MODE, dial_readable: false } }), board()), /could not be read/)
    assert.match(sendBlock(preview({ count: 0 }), board()), /nobody/)
    assert.match(sendBlock(preview({ count: 250, over_cap: true }), board()), /over the 200/)
    assert.match(sendBlock(preview({ too_long: true, chars: 1700 }), board()), /1700/)
    assert.match(sendBlock(preview({ readable: false, why: ['we cannot see'] }), board()), /we cannot see/)
    assert.match(sendBlock(preview({ refused: 'not your house' }), board()), /not your house/)
    assert.equal(sendBlock(preview(), board()), '')
  })
})

describe('the sentence under a broadcast', () => {
  it('in test mode the blast became rows in the mock outbox, and NOBODY WAS CONTACTED', () => {
    const h = headline(row())
    assert.match(h.text, /^Test mode is on: /)
    assert.match(h.text, /3 rows in the mock outbox \(ASA Data — CommMock\) and the rehearsal book/)
    assert.match(h.text, /NOBODY WAS CONTACTED/)
    assert.doesNotMatch(h.text, /\bsent\b/)
  })
  it('a copy a brake held is never called sent', () => {
    const h = headline(row({ test_mode: 'off', tally: { pending: 0, sent: 0, recorded: 0, held: 3, refused: 0, failed: 0, withdrawn: 0 } }))
    assert.match(h.text, /3 held by a brake — NOBODY WAS CONTACTED/)
    assert.doesNotMatch(h.text, /\bsent\b/)
    assert.equal(outcomeChip('held').label, 'Held')
    assert.equal(outcomeChip('recorded').label, 'Recorded — not sent')
    assert.doesNotMatch(tallyWords({ held: 2, recorded: 1 }), /\bsent\b/)
  })
  it('in production it counts what the provider took, beside what it did not', () => {
    const h = headline(row({ test_mode: 'off', tally: { pending: 0, sent: 2, recorded: 0, held: 0, refused: 1, failed: 0, withdrawn: 0 } }))
    assert.equal(h.text, '2 of 3 sent · 1 refused.')
    assert.equal(h.tone, 'mint')
  })
  it('held for the morning, stopped part way, withdrawn — each says what it is', () => {
    assert.match(headline(row({ state: 'held_quiet', tally: { pending: 3, sent: 0, recorded: 0, held: 0, refused: 0, failed: 0, withdrawn: 0 } })).text,
      /quiet window — it goes at 08:00 unless it is withdrawn first/)
    assert.match(headline(row({ state: 'partial', tally: { pending: 2, sent: 1, recorded: 0, held: 0, refused: 0, failed: 0, withdrawn: 0 } })).text,
      /2 not asked yet — Continue sends them/)
    assert.match(headline(row({ state: 'withdrawn', withdrawn_by: 'Ann Able', tally: { pending: 0, sent: 0, recorded: 0, held: 0, refused: 0, failed: 0, withdrawn: 3 } })).text,
      /Withdrawn by Ann Able — 3 never asked. Nobody was contacted./)
  })
  it('a row the door says will not go on says why, in place of "Continue sends them"', () => {
    const pend = { pending: 3, sent: 0, recorded: 0, held: 0, refused: 0, failed: 0, withdrawn: 0 }
    const why = 'Confirmed while test mode was on, and test mode is off now — the rest was never sent'
    for (const state of ['held_quiet', 'partial', 'interrupted']) {
      const h = headline(row({ state, tally: pend, hold_why: why }))
      assert.equal(h.text, why, state)
      assert.doesNotMatch(h.text, /Continue sends them|it goes at 08:00/, state)
    }
    /* a row with nothing left pending is drawn by its own ending */
    assert.doesNotMatch(headline(row({ hold_why: why })).text, /test mode is off now/)
  })
  it('the chips say the state in words', () => {
    assert.equal(stateChip('held_quiet').label, 'Held for 08:00')
    assert.equal(stateChip('interrupted').label, 'Interrupted')
    assert.equal(stateChip('done').tint, 'mint')
  })
})

describe('the brakes, in front of the sender', () => {
  it('names test mode, the quiet window, a blind switch and a switched-off row', () => {
    assert.match(modeSentences(MODE, SIT).join(' '), /Test mode is on: a broadcast becomes rows in the mock outbox/)
    assert.match(modeSentences({ ...MODE, quiet_now: true }, SIT).join(' '), /held and goes at 08:00/)
    assert.match(modeSentences({ ...MODE, dial_readable: false }, SIT).join(' '), /could not be read/)
    assert.match(modeSentences({ ...MODE, test_mode: 'off' }, SIT).join(' '), /sending switch is off/)
    assert.match(modeSentences(MODE, { ...SIT, on: false, why: 'the row is off' }).join(' '), /the row is off/)
    assert.deepEqual(modeSentences({ ...MODE, test_mode: 'off', send_switch: 'on' }, SIT), [])
  })
  it('Continue and Withdraw are drawn only where the door said so and something is still pending', () => {
    const pend = { pending: 2, sent: 1, recorded: 0, held: 0, refused: 0, failed: 0, withdrawn: 0 }
    assert.deepEqual(rowActions({ can_continue: true, can_withdraw: true, tally: pend }), { cont: true, withdraw: true, resend: false })
    assert.deepEqual(rowActions({ can_continue: true, can_withdraw: true, tally: { ...pend, pending: 0 } }), { cont: false, withdraw: false, resend: false })
    assert.deepEqual(rowActions({ can_continue: false, can_withdraw: false, tally: pend }), { cont: false, withdraw: false, resend: false })
    assert.equal(rowActions({ can_continue: false, can_withdraw: false, can_resend: true, tally: pend }).resend, true)
  })
  it('"Write it again" puts the row\'s own audience and words back, to be reviewed like a new broadcast', () => {
    const c = composerFromRow(row({ audience: 'house', house: 'CAN - 48TH (A) - ABD1547', meddel: true,
                                    message: 'TEST', signature: 'Ann' }))
    assert.deepEqual(c, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', meddel: true, message: 'TEST', signature: 'Ann' })
    assert.deepEqual(composerFromRow(row({ audience: 'allstaff', house: 'CAN - X', meddel: true })),
      { audience: 'allstaff', house: '', meddel: false, message: 'Open shift today', signature: '' })
    assert.equal(composerFromRow(row({ audience: 'nonsense' })).audience, '')
  })
  it('the page\'s key is one composition\'s: kept for a retry of the same words, new when the words change', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/features/smartcomms/SmartCommsBroadcastPage.tsx'), 'utf8')
    assert.match(src, /if \(sendKey\.current\.composer && sendKey\.current\.composer !== composing\) \{\s*sendKey\.current = \{ id: newClientId\(\), composer: composing \}/)
    assert.match(src, /client_id: sendKey\.current\.id/)
    assert.doesNotMatch(src, /setClientId/)
  })
  it('the warning names who called off beside why', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/features/smartcomms/SmartCommsBroadcastPage.tsx'), 'utf8')
    assert.match(src, /may say why a shift is open or who called off/)
    assert.match(GS, /'called off, call off, calling off, called out, call out, calling out, no call, no show'/)
  })
  it('Share and Export carry the words, the audience and what happened', () => {
    const labels = HISTORY_COLUMNS.map((c) => c.label)
    assert.ok(labels.includes('Message') && labels.includes('Audience') && labels.includes('What happened'))
    const what = HISTORY_COLUMNS.find((c) => c.label === 'What happened')!
    assert.match(String(what.accessor!(row())), /NOBODY WAS CONTACTED/)
  })
})

describe('the page is declared, routed and draws', () => {
  it('Smart Comms declares a Broadcast page with its own screen', () => {
    const app = notificationManifests.find((m) => m.id === 'smartcomms')!
    const page = app.pages.find((p) => p.id === 'broadcast')
    assert.ok(page, 'no broadcast page in the Smart Comms manifest')
    assert.equal(page!.title, 'Broadcast')
    assert.equal((page!.config as { customFeature?: string }).customFeature, 'smartcomms/SmartCommsBroadcastPage')
  })
  it('the router maps the page to the screen', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/AppRoutePage.tsx'), 'utf8')
    assert.match(src, /'smartcomms\/broadcast': SmartCommsBroadcastPage/)
  })
  it('the screen draws before anything has answered, and offers no browser dialog', () => {
    /* lend window listeners for the entrance animation */
    const g = globalThis as unknown as Record<string, unknown>
    const held = { add: g.addEventListener, remove: g.removeEventListener }
    g.addEventListener = held.add ?? (() => {})
    g.removeEventListener = held.remove ?? (() => {})
    let html = ''
    try {
      html = renderToString(
        <MemoryRouter initialEntries={['/app/smartcomms/broadcast']}>
          <SmartCommsBroadcastPage />
        </MemoryRouter>,
      )
    } finally {
      g.addEventListener = held.add
      g.removeEventListener = held.remove
    }
    assert.match(html, /Broadcast/)
    assert.match(html, /Where a broadcast goes today/)
    const src = readFileSync(resolve(ROOT, 'src/pages/features/smartcomms/SmartCommsBroadcastPage.tsx'), 'utf8')
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(/)
    assert.match(src, /askConfirm\(/)
  })
})
