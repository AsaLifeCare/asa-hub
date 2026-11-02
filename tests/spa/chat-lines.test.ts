/**
 * TODAY'S CHAT (lib/chatLines, lib/chatPresence) — a send the relay kept first is the message the moment its answer
 * comes, words the stream brings are drawn with no read, a line no read carried yet is never wiped by one that does
 * not carry it, a pending bubble leaves only for its own copy, the cursor is only a row a read carried, and the
 * shell says a kept send's words once, at once.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  type ChatLine, goneFrom, LOCAL_KEEP_MS, mergeRead, pushedLine, type RailThread, railAfterLine, settleSent,
  streamLineOf,
} from '@/lib/chatLines'
import { heardLine, useChatPresenceStore } from '@/lib/chatPresence'
import { useNotificationStore } from '@/stores/useNotificationStore'

const row = (id: string, over: Partial<ChatLine> = {}): ChatLine => ({
  id, from_user: 'per-2', from_name: 'Bob', body: id, created_at: `2026-09-30T13:00:0${id.slice(-1)}.000Z`, mine: false,
  ...over,
})
const NOW = 1_800_000_000_000

describe('a send, answered', () => {
  it('with its row\'s id: the bubble is that message at once, in its place in time', () => {
    const prev = [row('m1'), { ...row('pending-1', { mine: true, body: 'hi', created_at: '2026-09-30T13:00:09.000Z' }), pending: true }]
    const got = settleSent(prev, 'pending-1', { id: 'msg_kept', created_at: '2026-09-30T13:00:05.000Z' }, NOW)
    assert.deepEqual(got.map((m) => [m.id, Boolean(m.pending), m.local]), [['m1', false, undefined], ['msg_kept', false, NOW]])
    assert.equal(got[1].created_at, '2026-09-30T13:00:05.000Z')
  })

  it('whose line the stream drew first: the bubble goes, the line stays once', () => {
    const prev = [row('msg_kept', { mine: true, local: NOW }), { ...row('pending-1', { mine: true }), pending: true }]
    assert.deepEqual(settleSent(prev, 'pending-1', { id: 'msg_kept', created_at: '' }, NOW).map((m) => m.id), ['msg_kept'])
  })
})

describe('a read', () => {
  it('never wipes a line no read carried yet, and takes it over once one does', () => {
    const prev = [row('m1'), row('msg_kept', { mine: true, local: NOW - 1000, created_at: '2026-09-30T13:00:05.000Z' })]
    const whole = mergeRead(prev, [row('m1')], true, NOW, 'per-2')
    assert.deepEqual(whole.lines.map((m) => m.id), ['m1', 'msg_kept'], 'a whole read without it keeps it')
    assert.equal(whole.cursor, 'm1', 'the cursor is a row a read carried, never the kept line')
    const carried = mergeRead(whole.lines, [row('msg_kept', { mine: true, created_at: '2026-09-30T13:00:05.000Z' })], false, NOW, 'per-2')
    assert.deepEqual(carried.lines.map((m) => [m.id, m.local]), [['m1', undefined], ['msg_kept', undefined]])
    assert.equal(carried.cursor, 'msg_kept')
  })

  it('lets a line nobody ever carried go once it is old', () => {
    const prev = [row('msg_lost', { local: NOW - LOCAL_KEEP_MS - 1 })]
    assert.deepEqual(mergeRead(prev, [row('m1')], true, NOW, 'per-2').lines.map((m) => m.id), ['m1'])
  })

  it('keeps a line or a bubble only in the conversation it was drawn in', () => {
    const prev = [row('msg_a', { local: NOW, with: 'per-2' }), { ...row('p1', { mine: true, body: 'to bob' }), pending: true, with: 'per-2' }]
    assert.deepEqual(mergeRead(prev, [row('m9', { from_user: 'per-3' })], true, NOW, 'per-3').lines.map((m) => m.id), ['m9'])
    assert.deepEqual(mergeRead(prev, [row('m1')], true, NOW, 'per-2').lines.map((m) => m.id), ['m1', 'msg_a', 'p1'])
  })

  it('takes a pending bubble away for a copy of its words new to the list, one for one — never for an old row', () => {
    const prev = [row('m1', { mine: true, body: 'ok' }), { ...row('p1', { mine: true, body: 'ok' }), pending: true },
      { ...row('p2', { mine: true, body: 'ok' }), pending: true }]
    const again = mergeRead(prev, [row('m1', { mine: true, body: 'ok' })], true, NOW, 'per-2')
    assert.equal(again.lines.filter((m) => m.pending).length, 2, 'the old "ok" is not either bubble\'s copy')
    const one = mergeRead(prev, [row('m7', { mine: true, body: 'ok' })], false, NOW, 'per-2')
    assert.equal(one.lines.filter((m) => m.pending).length, 1)
    assert.equal(one.lines.at(-1)?.pending, true, 'a bubble still waiting stays last')
  })
})

describe('the stream\'s words', () => {
  const line = { id: 'msg_w', from_user: 'per-2', from_name: 'Bob', body: 'hello', created_at: '2026-09-30T13:00:07.000Z',
    mine: false, with_user: 'per-2' }

  it('are drawn once, in time; mine take the place of their own bubble', () => {
    const once = pushedLine([row('m1')], line, NOW)
    assert.deepEqual(once.map((m) => m.id), ['m1', 'msg_w'])
    assert.equal(pushedLine(once, line, NOW), once)
    const mine = { ...line, id: 'msg_mine', mine: true, body: 'on it', from_user: 'per-1', with_user: 'per-2' }
    const bubble = { ...row('p1', { mine: true, body: 'on it' }), pending: true }
    assert.deepEqual(pushedLine([row('m1'), bubble], mine, NOW).map((m) => [m.id, Boolean(m.pending)]),
      [['m1', false], ['msg_mine', false]])
  })

  it('move the rail: to the top, one more unread unless it is being read, and the same line twice moves nothing', () => {
    const rail: RailThread[] = [{ thread_key: 'per-1|per-3', with_user: 'per-3', with_name: 'Cy', last: 'x', last_at: '2026-09-30T12:00:00.000Z', unread: 0 },
      { thread_key: 'per-1|per-2', with_user: 'per-2', with_name: 'Bob', last: 'old', last_at: '2026-09-30T11:00:00.000Z', unread: 1 }]
    const moved = railAfterLine(rail, line, 'per-1|per-2', false)
    assert.deepEqual(moved.map((t) => [t.with_user, t.last, t.unread]), [['per-2', 'hello', 2], ['per-3', 'x', 0]])
    assert.equal(railAfterLine(moved, line, 'per-1|per-2', false), moved)
    assert.equal(railAfterLine(rail, line, 'per-1|per-2', true)[0].unread, 1, 'on screen: not counted')
    const first = railAfterLine([], { ...line, with_user: 'per-9', from_name: 'Nia' }, 'per-1|per-9', false)
    assert.deepEqual(first, [{ thread_key: 'per-1|per-9', with_user: 'per-9', with_name: 'Nia', last: 'hello',
      last_at: line.created_at, last_from: 'per-2', unread: 1 }])
  })

  it('are read only when the line carries them whole; a fact is not a line', () => {
    assert.equal(streamLineOf(undefined), null)
    assert.equal(streamLineOf({ id: 'x' }), null)
    assert.deepEqual(streamLineOf({ ...line, extra: 1 }), line)
  })

  it('a refused send leaves, and says which line it was', () => {
    const got = goneFrom([row('m1'), row('msg_gone', { mine: true, body: 'mine' })], 'msg_gone')
    assert.deepEqual(got.lines.map((m) => m.id), ['m1'])
    assert.equal(got.gone?.body, 'mine')
    assert.equal(goneFrom([row('m1')], 'nope').gone, null)
  })

  it('are said by the shell at once, once, and not while that conversation is on screen', () => {
    useNotificationStore.setState({ items: [] } as never)
    useChatPresenceStore.getState().setState(0, null)
    useChatPresenceStore.getState().setViewing(undefined)
    assert.equal(heardLine({ ...line, id: 'msg_said' }), true)
    assert.equal(useChatPresenceStore.getState().unread, 1)
    assert.equal(useChatPresenceStore.getState().latest?.id, 'msg_said')
    assert.equal(useNotificationStore.getState().items.length, 1)
    assert.equal(useNotificationStore.getState().items[0].href, '/app/chat/messages?with=per-2')
    assert.equal(heardLine({ ...line, id: 'msg_said' }), false, 'the beat or a second line says it no more')
    assert.equal(useChatPresenceStore.getState().unread, 1)
    assert.equal(heardLine({ ...line, id: 'msg_mine2', mine: true }), false, 'my own words ring nothing')
    useChatPresenceStore.getState().setViewing('per-2')
    heardLine({ ...line, id: 'msg_seen' })
    assert.equal(useNotificationStore.getState().items.length, 1, 'on screen: counted, not rung')
    useChatPresenceStore.getState().setViewing(undefined)
  })
})

describe('the screen', () => {
  it('draws a kept send from its answer and the stream\'s words without a read, and keeps a taken-unconfirmed bubble', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/features/chat/ChatPage.tsx'), 'utf8')
    assert.ok(page.includes('settleSent(m, pendingId'))
    assert.ok(page.includes('pushedLine(m, line, Date.now())') && page.includes('railAfterLine(t, line, msg.thread_key, reading)'))
    assert.ok(page.includes('mergeRead(prev, arrived'))
    const sendAt = page.indexOf('const send = () =>')
    const send = page.slice(sendAt, page.indexOf('const react = async', sendAt))
    assert.ok(!send.includes('m.filter((x) => x.id !== pendingId))\n        void loadMessages(to, true)\n        void loadOverview(false)\n      } catch'),
      'an answer never takes the bubble away before its copy is on screen')
    assert.ok(send.includes('UNCONFIRMED_KEEP_MS'))
  })
})
