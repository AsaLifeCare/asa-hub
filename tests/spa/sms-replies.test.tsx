/**
 * The Texts panel, screen side: outcome words, sender naming, non-replies on demand, unreadable lists.
 * The server side is tools/test-sms-ears.py.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import TextReplies from '@/pages/features/shifts/TextReplies'
import {
  REPLY_LABEL, REPLY_TINT, ackLabel, senderLabel, splitReplies, type Panels, type TextReply,
} from '@/pages/features/shifts/requestsLogic'

const root = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const JH = 'CAN - JH - ABD2704'

function reply(over: Partial<TextReply>): TextReply {
  return {
    id: 'm1', at: '2026-09-23T13:02:00+00:00', heard_at: '2026-09-23T13:02:05+00:00', line: '5558',
    person: 'Ann Roe', sender: 'named', phone_tail: '0101', word: 'yes', words: 'Yes',
    outcome: 'applied', road: 'call_off', code: 'ok',
    why: 'Ann Roe applied by text for the 8P-8A shift at JH on Thu 9/24 — the house manager decides',
    location: JH, house: 'JH', col_iso: '2026-09-24', value: '8P-8A', ref: 'SP3F9A2B1C4D',
    request_id: 'SR0000000001', handoff_id: '', candidates: [], ack: 'sms_reply_applied',
    ack_state: 'waiting', ack_note: '', ...over,
  }
}

function panels(rows: TextReply[], readable = true, why = ''): Panels {
  return {
    readable: true, why: '', late_calls: [], no_show_no_call: [], took_open: [], took_call_off: [],
    replies: rows, replies_readable: readable, replies_why: why,
  }
}

/** The panel as visible text (renderer comment markers stripped). */
function draw(p: Panels | undefined): string {
  return renderToString(<MemoryRouter><TextReplies panels={p} /></MemoryRouter>).replace(/<!-- -->/g, '')
}

describe('every outcome the relay writes has its words here', () => {
  const ear = read('server/sms_ears.py')
  const block = ear.split('# ── what a text came to')[1]?.split('OUTCOMES = (')[0] ?? ''
  const outcomes = [...block.matchAll(/^[A-Z_]+ = "([a-z_]+)"/gm)].map((m) => m[1])
  it('the relay\'s list is read from its own source', () => {
    assert.ok(outcomes.length >= 12, outcomes.join(','))
    assert.ok(outcomes.includes('applied') && outcomes.includes('ambiguous') && outcomes.includes('unheard'))
  })
  it('each has a label and a tint', () => {
    for (const o of outcomes) {
      assert.ok(REPLY_LABEL[o], `no label for ${o}`)
      assert.ok(REPLY_TINT[o], `no tint for ${o}`)
    }
  })
})

describe('who sent it — a name only when the relay named them', () => {
  it('a number exactly one person holds is that person', () => {
    assert.equal(senderLabel(reply({})), 'Ann Roe')
  })
  it('a shared number, a number nobody holds, and a holder that could not be read each say so', () => {
    assert.equal(senderLabel(reply({ sender: 'shared', person: '', phone_tail: '0199' })),
      'A shared number …0199 — never named')
    assert.equal(senderLabel(reply({ sender: 'unknown', person: '', phone_tail: '0777' })), 'Unknown number …0777')
    assert.equal(senderLabel(reply({ sender: 'unread', person: '', phone_tail: '0111' })),
      'Number …0111 — who holds it could not be read')
  })
  it('a name the relay did not stand behind is never drawn', () => {
    assert.equal(senderLabel(reply({ sender: 'unknown', person: 'Ann Roe', phone_tail: '' })), 'Unknown number')
  })
})

describe('the lists and the acknowledgements', () => {
  it('the texts that were not replies are split off, not dropped', () => {
    const got = splitReplies([reply({ id: 'a' }), reply({ id: 'b', outcome: 'not_a_reply' }),
      reply({ id: 'c', outcome: 'ambiguous' })])
    assert.deepEqual(got.acted.map((r) => r.id), ['a', 'c'])
    assert.deepEqual(got.notReplies.map((r) => r.id), ['b'])
  })
  it('the acknowledgement says whether it went, waits, or was dropped — and why', () => {
    assert.equal(ackLabel(reply({ ack: '' })), '')
    assert.equal(ackLabel(reply({ ack_state: 'said' })), 'Acknowledged by text')
    assert.match(ackLabel(reply({ ack_state: 'waiting' })), /not sent yet/)
    assert.equal(ackLabel(reply({ ack_state: 'expired', ack_note: 'the application was no longer open' })),
      'Acknowledgement dropped — the application was no longer open')
  })
  it('"ok" is not "sent": a recorded, held or unreachable acknowledgement never reads as answered', () => {
    const recorded = ackLabel(reply({ ack_state: 'rehearsal', ack_note: 'written to the rehearsal book' }))
    assert.match(recorded, /recorded only, not sent/)
    assert.match(recorded, /rehearsal book/)
    assert.doesNotMatch(recorded, /Acknowledged by text/)
    const unsent = ackLabel(reply({ ack_state: 'not_sent', ack_note: 'no number we may text' }))
    assert.match(unsent, /could not be texted — no number we may text/)
    assert.match(unsent, /tried again/)
    assert.match(ackLabel(reply({ ack_state: 'opted_out' })), /asked not to be texted/)
  })
})

describe('the Texts panel, drawn', () => {
  const rows = [
    reply({}),
    reply({ id: 'm2', outcome: 'ambiguous', code: 'several', location: '', house: '', value: '', col_iso: '',
            ref: '', ack: 'sms_reply_unclear', why: 'a bare YES that could answer 2 things — so nothing was done' }),
    reply({ id: 'm3', sender: 'unknown', person: '', phone_tail: '0777', outcome: 'unknown_sender', ack: '',
            location: '', house: '', value: '', col_iso: '', ref: '', why: 'a number nobody on the staff roster holds' }),
    reply({ id: 'm4', outcome: 'not_a_reply', words: '', ack: '', location: '', house: '', value: '',
            col_iso: '', ref: '', why: 'neither a yes, a no nor a shift ref — WORDS-OF-A-NON-REPLY' }),
  ]
  const html = draw(panels(rows))
  it('each reply with what it came to, in words, and the sender as the relay named them', () => {
    assert.match(html, /Applied by text/)
    assert.match(html, /Ambiguous — nothing done/)
    assert.match(html, /Nobody can be named/)
    assert.match(html, /Unknown number …0777/)
    assert.match(html, /Replies by text/)
  })
  it('a shift named by a reply links to it on the calendar, by its ref', () => {
    assert.match(html, /On the calendar/)
    assert.match(html, /ref SP3F9A2B1C4D/)
  })
  it('the texts that were not replies are one click away, not drawn and not hidden in a count', () => {
    assert.doesNotMatch(html, /WORDS-OF-A-NON-REPLY/)
    assert.match(html, /Show the 1 text that was not a reply/)
  })
  it('an unreadable list says so, and never draws "no reply"', () => {
    const bad = draw(panels([], false, 'the replies by text could not be read (OperationalError)'))
    assert.match(bad, /could not be read \(OperationalError\)/)
    assert.match(bad, /This list is not saying\s+nobody replied/)
    assert.doesNotMatch(bad, /No reply by text/)
  })
  it('an empty readable list says there was none', () => {
    assert.match(draw(panels([])), /No reply by text in the last two weeks/)
  })
})

describe('as source — the tab is the house managers\', and a row says it came by text', () => {
  const page = read('src/pages/features/shifts/ShiftRequestsPage.tsx')
  it('the Texts tab rides the panels, which only the house managers and above are sent', () => {
    assert.match(page, /if \(feed\?\.panels\) \{[\s\S]*?id: 'texts'/)
    assert.match(page, /<TextReplies panels=\{feed\.panels\} \/>/)
  })
  it('an application made by text reads "by text" on its row', () => {
    assert.match(page, /r\.via === 'sms' && ' · by text'/)
  })
  it('one "On the calendar" button, shared', () => {
    assert.match(page, /import OnCalendar from '\.\/OnCalendar'/)
    assert.doesNotMatch(page, /function OnCalendar\(/)
  })
  it('no browser dialogs', () => {
    for (const src of [page, read('src/pages/features/shifts/TextReplies.tsx')]) {
      assert.doesNotMatch(src, /window\.(confirm|alert|prompt)/)
    }
  })
})
