/**
 * THE SMART COMMS DESK'S SAVES AND ITS READS (deskWrites, SmartCommsPage, shared gasAction, streamFrames).
 *
 *   · a save sends the cells it changes and nothing else: a switch writes `enabled` alone, and a cleared cell is
 *     sent as '' — so a stored `team` nobody touched never refuses a save of the row again;
 *   · the line a text leaves from is judged by the door's own rule: an e-mail address, a word no line answers to and
 *     a role two lines share are refused, a role, a name or a number one line answers to is taken, and every choice
 *     the drawer offers names exactly one line;
 *   · the relay's receipt is never a read's answer: gasAction keeps no copy of one, so the next ask reaches the door;
 *   · a card names the stored cells the platform refuses, with what it accepts instead, and nothing when it has
 *     nothing to say;
 *   · a refusal told down the stream reaches the screen that drew the write, with its rows and its words.
 * The lines and the rows are invented.
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToString as renderBare } from 'react-dom/server'
import {
  patchCells, readSenderLine, rowPatch, senderChoice, senderNames, senderOptions, withPatch, type DeskLine,
} from '@/pages/features/smartcomms/deskWrites'
import { gasAction, isRelayReceipt } from '@/features/hiring/shared'
import { onWriteRefused, tellWriteRefused, type WriteRefused } from '@/lib/streamFrames'
import { StoredFix } from '@/pages/features/smartcomms/SmartCommsPage'

/** The cards animate in and ask the window for a resize listener; the test window is bare, so each render lends one. */
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

function words(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .split(/<[^>]+>/)
    .map((t) => t.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim())
    .filter(Boolean)
    .join(' ')
}

const LINES: DeskLine[] = [
  { id: 'PNaaaaaaa1', digits: '5550000001', name: 'Front Desk', role: 'Administration' },
  { id: 'PNaaaaaaa2', digits: '5550000002', name: 'Harvey', role: '' },
  { id: 'PNaaaaaaa3', digits: '5550000003', name: 'Dee Line', role: 'Director' },
  { id: 'PNaaaaaaa4', digits: '5550000004', name: 'Other Dee', role: 'Director' },
]

const ROW = {
  id: 'truelink_run', enabled: 'no', to: 'team', cc: '', from_line: '', sms_text: 'Hello {first_name}',
  email_subject: '', email_text: '',
}

describe('a save sends the cells it changes', () => {
  it('a switch writes `enabled` and nothing else — never the stored `team` beside it', () => {
    const patch = rowPatch(ROW, { ...ROW, enabled: 'yes' })
    assert.deepEqual(patch, { id: 'truelink_run', enabled: 'yes' })
    assert.deepEqual(patchCells(patch), ['enabled'])
  })
  it('a cleared cell is sent as the empty word, so clearing `team` really empties it', () => {
    const patch = rowPatch(ROW, { ...ROW, to: '', sms_text: 'Hello again' })
    assert.deepEqual(patch, { id: 'truelink_run', to: '', sms_text: 'Hello again' })
  })
  it('an untouched row sends no cell at all', () => {
    assert.deepEqual(patchCells(rowPatch(ROW, { ...ROW })), [])
  })
  it('the platform keeps every cell a patch leaves out', () => {
    const after = withPatch(ROW, { id: 'truelink_run', enabled: 'yes' })
    assert.equal(after.to, 'team')
    assert.equal(after.enabled, 'yes')
    assert.equal(withPatch(ROW, { id: 'another_row', enabled: 'yes' }), ROW)
  })
})

describe('the line a text leaves from', () => {
  it('refuses an e-mail address, and says it names a phone line', () => {
    const read = readSenderLine('desk@example.com', LINES)
    assert.equal(read.ok, false)
    assert.match(read.ok ? '' : read.why, /e-mail address/)
  })
  it('refuses a word no line answers to, and a role two lines share', () => {
    assert.equal(readSenderLine('Nobody', LINES).ok, false)
    const shared = readSenderLine('Director', LINES)
    assert.equal(shared.ok, false)
    assert.match(shared.ok ? '' : shared.why, /more than one/)
  })
  it('takes blank, a role, a name or a number one line answers to', () => {
    assert.deepEqual(readSenderLine('', LINES), { ok: true, via: 'blank', line: null })
    assert.equal(readSenderLine('administration', LINES).ok, true)
    assert.equal(readSenderLine('Harvey', LINES).ok, true)
    assert.equal(readSenderLine('+1 (555) 000-0003', LINES).ok, true)
    assert.equal(readSenderLine('5559999999', LINES).ok, false)
  })
  it('every choice the drawer offers names exactly its own line', () => {
    const options = senderOptions(LINES)
    assert.equal(options.length, LINES.length)
    options.forEach((o, i) => {
      const read = readSenderLine(o.value, LINES)
      assert.ok(read.ok && read.line === LINES[i], `${o.value} names line ${i}`)
    })
    // the two lines that share a role are offered by name, never by the role neither answers to
    assert.ok(!options.some((o) => o.value === 'Director'))
  })
  it('a stored number stands for its line’s own choice, and a stray word for none', () => {
    assert.equal(senderChoice('5550000001', LINES), 'Administration')
    assert.equal(senderChoice('', LINES), '')
    assert.equal(senderChoice('desk@example.com', LINES), null)
  })
  it('names the lines the way the door lists them when it refuses', () => {
    assert.deepEqual(senderNames(LINES), ['Administration', 'Harvey', 'Director'])
  })
})

describe('the relay’s receipt is not the platform’s answer', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  it('knows a receipt from an answer', () => {
    assert.equal(isRelayReceipt({ accepted: true, deduplicated: true }), true)
    assert.equal(isRelayReceipt({ accepted: true, queued: true }), true)
    assert.equal(isRelayReceipt({ accepted: true, confirmed: false }), true)
    assert.equal(isRelayReceipt({ saved: 1, unknown: [], unaddressed: [] }), false)
    assert.equal(isRelayReceipt({ accepted: true, situations: [] }), false)
    assert.equal(isRelayReceipt([]), false)
    assert.equal(isRelayReceipt(null), false)
  })

  it('a read answered with a receipt is not kept: the next ask reaches the door, and a real answer is kept', async () => {
    let asked = 0
    let answer: unknown = { accepted: true, deduplicated: true }
    globalThis.fetch = (async () => {
      asked++
      return new Response(JSON.stringify({ status: 200, data: answer }), {
        status: 200, headers: { 'content-type': 'application/json', 'x-kept-ring': 'gs:SmartComms' },
      })
    }) as typeof fetch
    const payload = { probe: 'receipt-not-kept' }
    const first = await gasAction<Record<string, unknown>>('smartCommsGet', payload)
    assert.equal(first.deduplicated, true)
    answer = { situations: [{ id: 'a_row', enabled: 'yes' }] }
    const second = await gasAction<{ situations?: unknown[] }>('smartCommsGet', payload)
    assert.equal(asked, 2, 'the receipt was not answered from the tab’s copy')
    assert.equal(second.situations?.length, 1)
    const third = await gasAction<{ situations?: unknown[] }>('smartCommsGet', payload)
    assert.equal(asked, 2, 'the real answer was')
    assert.equal(third.situations?.length, 1)
  })
})

describe('a card names what the platform would refuse', () => {
  const book = { keys: ['allstaff', 'housemanagers', 'directors'], now: {} }

  it('a `team` in Goes to, with the words the platform resolves instead', () => {
    const text = words(renderToString(
      <StoredFix sit={{ ...ROW }} book={book} lines={null} hours={null} onEdit={() => {}} />))
    assert.match(text, /Goes to holds “team”, which reaches nobody/)
    assert.match(text, /allstaff, housemanagers, directors/)
    assert.match(text, /The switch still works/)
  })
  it('an e-mail in Sends from, with our lines', () => {
    const text = words(renderToString(
      <StoredFix sit={{ ...ROW, to: '', from_line: 'desk@example.com' }} book={book} lines={LINES} hours={null}
        onEdit={() => {}} />))
    assert.match(text, /Sends from holds “desk@example.com”, which is not one of our lines/)
    assert.match(text, /Administration, Harvey, Director, or blank for Automations/)
  })
  it('nothing for a row the platform would take, nor for a word this desk could not check', () => {
    assert.equal(renderToString(
      <StoredFix sit={{ ...ROW, to: '+13305550100' }} book={book} lines={LINES} hours={null} onEdit={() => {}} />), '')
    assert.equal(renderToString(
      <StoredFix sit={{ ...ROW, from_line: 'desk@example.com' }} book={null} lines={null} hours={null}
        onEdit={() => {}} />), '')
  })
})

describe('a refusal told down the stream', () => {
  it('reaches the screen that drew the write, with its rows and its words', () => {
    const heard: WriteRefused[] = []
    const stop = onWriteRefused((m) => heard.push(m))
    tellWriteRefused({ kind: 'write_refused', action: 'smartCommsSet', resource: '', rows: ['truelink_run'],
      why: 'validation 400: Nobody would be reached' })
    stop()
    tellWriteRefused({ kind: 'write_refused', action: 'smartCommsSet', rows: ['after_stop'], why: 'x' })
    assert.deepEqual(heard, [{ action: 'smartCommsSet', resource: '', rows: ['truelink_run'],
      why: 'validation 400: Nobody would be reached' }])
  })
})
