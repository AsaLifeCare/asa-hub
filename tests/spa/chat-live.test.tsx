/**
 * LIVE CHAT (lib/chatLive) — who gets it, what one frame does to the screen, and the whole client against a hub
 * answered at the WebSocket: the ticket, the handshake, the rail, a message arriving into the open conversation
 * (read 1.5 s later), one arriving elsewhere (counted and announced), a send confirmed, a send refused and
 * retried with the same client id, and a reauth that keeps the socket.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import {
  CHAT_APP_ROUTE, INBOX_CHAT_ROUTE, chatAppFallback, chatKindOf, inboxChatFallback, LIVE_CHAT_ID, liveModeWith,
} from '@/lib/chatLive/access'
import { useAuthStore } from '@/auth/useAuthStore'
import type { Role } from '@/auth/types'
import { isAllowedWith, masterOnlyRefused } from '@/lib/appAccess'
import { isManifestVisible } from '@/lib/audience'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { useRegistryStore } from '@/stores/useRegistryStore'
import * as model from '@/lib/chatLive/model'
import { HubCallError, HubClient, oneAtATime, splitRecords } from '@/lib/chatLive/signalr'
import { liveKeyOf, sameKey } from '@/lib/chatLive/shell'
import { useChatLiveStore } from '@/lib/chatLive/store'
import { REAUTH_RETRY_MS, reconnectDelay, refusalOf, startLive } from '@/lib/chatLive/connection'
import { shouldArm, useChatPresenceStore } from '@/lib/chatPresence'
import { APP_FEATURES, featureAllowsWith, featureIsGated } from '@/lib/featureAccess'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { useToastStore } from '@/stores/useToastStore'
import ChatLiveView, { LIVE_ACTING_LINE, LIVE_REFUSED_LINE, LIVE_STATE_LINE } from '@/pages/features/chat/live/ChatLiveView'

const msg = (over: Partial<model.LiveMessage>): model.LiveMessage => ({
  id: 'm1', from_user: 'per-2', from_name: 'Bob', body: 'hi', created_at: '2026-01-01T10:00:00.000Z', mine: false,
  status: 'sent', ...over,
})

describe('who gets live chat', () => {
  it('no App Control row: the master alone; a released row: whoever wears it; acting: off, and said', () => {
    assert.equal(liveModeWith({ isMaster: true }, {}, false), 'on')
    assert.equal(liveModeWith({ role: 'staff', types: [] }, {}, false), 'off')
    assert.equal(liveModeWith({ role: 'staff', types: [] }, { [LIVE_CHAT_ID]: ['STAFF'] }, false), 'off',
      'My Inbox itself must be open too')
    assert.equal(liveModeWith({ role: 'staff', types: [] }, { [LIVE_CHAT_ID]: ['STAFF'], 'my-inbox': ['STAFF'] }, false), 'on')
    assert.equal(liveModeWith({ isMaster: false, role: 'client' }, {}, true), 'acting')
    assert.equal(liveModeWith(null, {}, false), 'off')
  })

  it('a client wears it only where App Control names CLIENT on both rows; elsewhere it keeps today\'s chat', () => {
    const client = { role: 'client', types: ['CLIENT'] }
    assert.equal(liveModeWith(client, { [LIVE_CHAT_ID]: ['CLIENT'], 'my-inbox': ['CLIENT'] }, false), 'on')
    assert.equal(liveModeWith(client, { 'my-inbox': ['CLIENT'] }, false), 'off')
    assert.equal(liveModeWith(client, { [LIVE_CHAT_ID]: ['STAFF'], 'my-inbox': ['CLIENT'] }, false), 'off')
    assert.equal(chatKindOf(liveModeWith(client, { 'my-inbox': ['CLIENT'] }, false), null), 'today')
  })

  it('the view: live where it is on; today\'s chat where the relay or the tab said no, and in a switched session', () => {
    assert.equal(chatKindOf('on', null), 'live')
    assert.equal(chatKindOf('acting', null), 'today', 'a switched session reads the person\'s chat, read-only')
    assert.equal(chatKindOf('acting', 'acting'), 'today')
    assert.equal(chatKindOf('off', null), 'today')
    assert.equal(chatKindOf('on', 'access'), 'today')
    assert.equal(chatKindOf('on', 'unavailable'), 'today')
    assert.equal(chatKindOf('on', 'visit'), 'live')
  })

  it('App Control lists it under My Inbox, the master\'s until released — never "everyone"', () => {
    const f = (APP_FEATURES['my-inbox'] ?? []).find((x) => x.id === LIVE_CHAT_ID)
    assert.ok(f && f.masterUntilReleased)
    assert.equal(featureIsGated(LIVE_CHAT_ID, {}), true)
    assert.equal(featureAllowsWith(LIVE_CHAT_ID, { role: 'staff' }, {}), false)
    assert.equal(featureAllowsWith(LIVE_CHAT_ID, { isMaster: true }, {}), true)
    assert.equal(featureAllowsWith(LIVE_CHAT_ID, { role: 'staff' }, { [LIVE_CHAT_ID]: ['STAFF'] }), true)
    assert.equal(featureAllowsWith('schedule.messageStaff', { role: 'staff' }, {}), true, 'other controls keep their polarity')
  })

  it('arms on a token change only: the same session written twice is one connection', () => {
    assert.equal(shouldArm(undefined, null), true)
    assert.equal(shouldArm('tok', 'tok'), false)
    assert.equal(shouldArm('tok', 'tok-2'), true)
    assert.equal(shouldArm(null, null), false)
    const a = liveKeyOf({ token: 'tok', account: 'acc', mode: 'on', tenant: '' })
    assert.equal(sameKey(a, liveKeyOf({ token: 'tok', account: 'acc', mode: 'on', tenant: '' })), true)
    assert.equal(sameKey(a, liveKeyOf({ token: 'tok', account: 'acc', mode: 'on', tenant: 'akron' })), false, 'a place change is a new connection')
    assert.equal(liveKeyOf({ token: 'tok', account: 'acc', mode: 'off', tenant: '' }), null)
    assert.equal(liveKeyOf({ token: null, account: 'acc', mode: 'on', tenant: '' }), null)
  })

  it('the ticket door\'s refusals end it only where no retry can help; it reconnects forever', () => {
    assert.equal(refusalOf(409, 'acting'), 'acting')
    assert.equal(refusalOf(403, 'badge'), 'access')
    assert.equal(refusalOf(400, 'member'), 'visit')
    assert.equal(refusalOf(401, 'session'), null, 'a gate that refused a good session after a relay restart is tried again')
    assert.equal(refusalOf(503, 'unavailable'), null)
    assert.deepEqual([0, 1, 2, 3, 4, 5, 50].map(reconnectDelay), [0, 2000, 5000, 10000, 30000, 60000, 60000])
  })
})

describe('a chat push\'s link, for a session My Inbox does not open to', () => {
  const INBOX_CHAT = '/app/my-inbox/chat'
  /** AppRoutePage's canOpenRoute, asked of the registry as it stands: registry, audience, access matrix */
  const opens = (role: Role) => (route: string) => {
    const id = /^\/app\/([^/?#]+)\//.exec(route)?.[1] ?? ''
    const app = useRegistryStore.getState().apps.find((a) => a.id === id)
    if (!app || !app.enabled || masterOnlyRefused(id) || !isManifestVisible(app, { role })) return false
    return isAllowedWith(useRegistryStore.getState().apps, role, id)
  }
  const as = (user: { id: string; role: Role; types: string[] }, rules: Record<string, string[]>) => {
    useAuthStore.setState({ user: { ...user, name: 'N', email: 'n@example.org', isMaster: false } } as never)
    useBadgeAccessStore.setState({ rules, tenantRules: {}, configRules: {} })
  }
  after(() => {
    useAuthStore.setState({ user: null } as never)
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} })
  })

  it('reads the conversation on Chat when Chat opens and My Inbox does not, the query kept', () => {
    as({ id: 'u-st', role: 'staff', types: [] }, { chat: ['STAFF'] })
    assert.equal(inboxChatFallback('off', opens('staff'), '?with=per-1'), `${CHAT_APP_ROUTE}?with=per-1`)
  })

  it('keeps My Inbox where it opens, where live chat is the session\'s, and where Chat does not open (a client\'s)', () => {
    as({ id: 'u-st', role: 'staff', types: [] }, { chat: ['STAFF'], 'my-inbox': ['STAFF'] })
    assert.equal(inboxChatFallback('off', opens('staff'), '?with=per-1'), null)
    as({ id: 'u-st', role: 'staff', types: [] }, { chat: ['STAFF'] })
    assert.equal(inboxChatFallback('on', opens('staff'), '?with=per-1'), null, 'Chat would send a live session back')
    as({ id: 'u-cl', role: 'client', types: [] }, { chat: ['STAFF'], 'my-inbox': ['CLIENT'] })
    assert.equal(inboxChatFallback('off', opens('client'), '?with=per-1'), null)
    as({ id: 'u-cl', role: 'client', types: [] }, { chat: ['STAFF'] })
    assert.equal(opens('client')(CHAT_APP_ROUTE), false)
    assert.equal(inboxChatFallback('off', opens('client'), '?with=per-1'), null, 'its guard answers, as before')
    assert.equal(inboxChatFallback('off', (r) => r === INBOX_CHAT, '?with=x'), null)
    assert.equal(inboxChatFallback('off', () => false, '?with=x'), null, 'nothing opens: the guard answers')
  })

  it('is asked by the route before its guards, with the guards\' own question', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/AppRoutePage.tsx'), 'utf8')
    const body = page.slice(page.indexOf('export default function AppRoutePage'))
    const asked = body.indexOf('inboxChatFallback(liveMode, (route) => canOpenRoute(route, apps, role), search)')
    assert.ok(asked > -1 && asked < body.indexOf('if (!app || !app.enabled)'))
    const back = body.indexOf('chatAppFallback((route) => canOpenRoute(route, apps, role), search)')
    assert.ok(back > -1 && back < body.indexOf('if (!app || !app.enabled)'))
    assert.match(body, /appId === 'chat' && pageId === 'messages'\s*\?\s*chatAppFallback/)
  })

  it('a link to Chat\'s conversation reads it in My Inbox for a client, whom Chat does not open to', () => {
    as({ id: 'u-cl', role: 'client', types: ['CLIENT'] }, { chat: ['STAFF'], 'my-inbox': ['CLIENT'] })
    assert.equal(opens('client')(CHAT_APP_ROUTE), false)
    assert.equal(chatAppFallback(opens('client'), '?with=per-1'), `${INBOX_CHAT_ROUTE}?with=per-1`)
    as({ id: 'u-st', role: 'staff', types: [] }, { chat: ['STAFF'], 'my-inbox': ['STAFF'] })
    assert.equal(chatAppFallback(opens('staff'), '?with=per-1'), null, 'Chat opens: it stays there')
    as({ id: 'u-cl', role: 'client', types: ['CLIENT'] }, { chat: ['STAFF'] })
    assert.equal(chatAppFallback(opens('client'), '?with=per-1'), null, 'neither opens: the guard answers')
    // never both ways: the two fallbacks cannot send a link back and forth
    for (const [inbox, chat] of [[true, false], [false, true], [true, true], [false, false]]) {
      const canOpen = (r: string) => (r === INBOX_CHAT_ROUTE ? inbox : r === CHAT_APP_ROUTE ? chat : false)
      assert.ok(!(chatAppFallback(canOpen, '') && inboxChatFallback('off', canOpen, '')))
    }
  })
})

describe('what one frame or answer does', () => {
  it('a send is pending under its client id, then confirmed with the sheet\'s id — or failed, and never dropped', () => {
    let list = model.addPending([], msg({ id: 'pending-c1', client_id: 'c1', mine: true, body: 'yo', status: 'pending' }))
    assert.equal(list[0].status, 'pending')
    const failed = model.failSent(list, 'c1', 'Not found.')
    assert.equal(failed[0].status, 'failed')
    assert.equal(failed[0].why, 'Not found.')
    assert.equal(model.retrySent(failed, 'c1')[0].status, 'pending')
    assert.equal(model.failedWords(failed[0]).mark, 'not sent')
    // nobody could say whether it landed: never "not sent" (a retyped copy would be a second message)
    const unsure = model.failSent(list, 'c1', 'no answer yet', true)
    assert.deepEqual([unsure[0].status, unsure[0].unsure], ['failed', true])
    assert.deepEqual([model.failedWords(unsure[0]).mark, model.failedWords(unsure[0]).line],
      ['not confirmed', 'Not confirmed — no answer yet'])
    assert.equal(model.retrySent(unsure, 'c1')[0].unsure, undefined, 'a retry is waiting again, not unsure')
    assert.equal(model.confirmSent(unsure, 'c1', { id: 'm7', created_at: '' })[0].unsure, undefined)
    list = model.confirmSent(list, 'c1', { id: 'm7', created_at: '2026-01-01T10:05:00.000Z' })
    assert.deepEqual([list[0].id, list[0].status], ['m7', 'sent'])
  })

  it('the same message from the hub and from a read is drawn once', () => {
    const pending = model.addPending([], msg({ id: 'pending-c1', client_id: 'c1', mine: true, body: 'yo', status: 'pending' }))
    const echoed = model.applyIncoming(pending, msg({ id: 'm7', client_id: 'c1', mine: true, body: 'yo' }))
    assert.deepEqual(echoed.map((m) => [m.id, m.status]), [['m7', 'sent']])
    assert.equal(model.applyIncoming(echoed, msg({ id: 'm7', mine: true, body: 'yo' })).length, 1)
    const raced = model.mergeServer(pending, [msg({ id: 'm7', mine: true, body: 'yo' })], false)
    assert.deepEqual(raced.map((m) => [m.id, m.status, m.client_id]), [['m7', 'sent', 'c1']],
      'a read that brings the sheet\'s copy first takes the waiting line\'s place, and keeps its client id')
    assert.deepEqual(model.confirmSent(raced, 'c1', { id: 'm7', created_at: '' }).map((m) => m.id), ['m7'])
    assert.deepEqual(model.applyIncoming(raced, msg({ id: 'm7', client_id: 'c1', mine: true, body: 'yo' })).map((m) => m.id), ['m7'],
      '…and the hub\'s own frame after it is still one line')
    const reset = model.mergeServer([msg({ id: 'old' }), ...pending], [msg({ id: 'm2' })], true)
    assert.deepEqual(reset.map((m) => m.id), ['m2', 'pending-c1'], 'a reset replaces the thread; a waiting line survives it')
  })

  it('a read goes on from the last row a read carried — a pushed line never moves the cursor', () => {
    assert.equal(model.readCursor('', [{ id: 'm1' }, { id: 'm2' }], true), 'm2')
    assert.equal(model.readCursor('m2', [], false), 'm2', 'a read with nothing new keeps it')
    assert.equal(model.readCursor('m2', [], true), '', 'an empty whole read starts it again')
    const s = useChatLiveStore.getState()
    s.reset(true, 'acc-1')
    s.addMe(['per-1'])
    const row = (id: string, from: string, at: string) => ({ id, from_user: from, from_name: '', body: id, created_at: at })
    s.applyMessages('per-2', { messages: [row('m1', 'per-2', '2026-01-01T09:00:00.000Z')] }, false)
    assert.equal(useChatLiveStore.getState().cursors['per-2'], 'm1')
    // my own line, pushed back: drawn, but the row before it (the other end's, not read yet) is still owed
    s.incoming(msg({ id: 'm3', from_user: 'per-1', to_user: 'per-2', mine: true, created_at: '2026-01-01T09:02:00.000Z' }), false)
    assert.ok(useChatLiveStore.getState().messages['per-2'].some((m) => m.id === 'm3'))
    assert.equal(useChatLiveStore.getState().cursors['per-2'], 'm1', 'a pushed line does not move it')
    s.applyMessages('per-2', { messages: [] }, true)
    assert.equal(useChatLiveStore.getState().cursors['per-2'], 'm1')
    const got = s.applyMessages('per-2', { messages: [row('m2', 'per-2', '2026-01-01T09:01:00.000Z'),
      row('m3', 'per-1', '2026-01-01T09:02:00.000Z')] }, true)
    assert.equal(got.fresh, 1, 'the owed row is drawn')
    assert.deepEqual(useChatLiveStore.getState().messages['per-2'].map((m) => m.id), ['m1', 'm2', 'm3'])
    assert.equal(useChatLiveStore.getState().cursors['per-2'], 'm3')
    s.reset(true, 'acc-1')
    assert.deepEqual(useChatLiveStore.getState().cursors, {})
  })

  it('a send whose answer was lost between two connections is found by the re-read, not left "Not sent"', () => {
    const typed = '2026-01-01T10:00:00.000Z'
    let list = model.addPending([msg({ id: 'm1', body: 'ok', created_at: '2026-01-01T09:00:00.000Z', mine: true })],
      msg({ id: 'pending-c2', client_id: 'c2', mine: true, body: 'ok', created_at: typed, status: 'pending' }))
    list = model.failSent(list, 'c2', 'not confirmed yet')
    // the re-read carries the old "ok" (already drawn) and the new one the lost answer was for
    const reread = model.mergeServer(list, [
      msg({ id: 'm1', body: 'ok', created_at: '2026-01-01T09:00:00.000Z', mine: true }),
      msg({ id: 'm9', body: 'ok', created_at: '2026-01-01T10:00:12.000Z', mine: true }),
    ], false)
    assert.deepEqual(reread.map((m) => [m.id, m.status, m.client_id ?? '']), [['m1', 'sent', ''], ['m9', 'sent', 'c2']])
    assert.deepEqual(model.settledClientIds(list, reread), ['c2'], 'its timer stops')
    const old = model.mergeServer(model.addPending([], msg({ id: 'pending-c3', client_id: 'c3', mine: true, body: 'ok', created_at: typed, status: 'pending' })),
      [msg({ id: 'm0', body: 'ok', created_at: '2025-12-31T09:00:00.000Z', mine: true })], true)
    assert.deepEqual(old.map((m) => [m.id, m.status]), [['m0', 'sent'], ['pending-c3', 'pending']],
      'the same words sent long before are not the waiting line')
    const theirs = model.mergeServer(model.addPending([], msg({ id: 'pending-c4', client_id: 'c4', mine: true, body: 'ok', created_at: typed, status: 'pending' })),
      [msg({ id: 'm8', body: 'ok', created_at: '2026-01-01T10:00:05.000Z', mine: false })], false)
    assert.equal(theirs.find((m) => m.client_id === 'c4')?.status, 'pending', 'the other end\'s words are never mine')
  })

  it('an Overview announces a thread whose unread rose from somebody else — never the one on screen, never mine', () => {
    const t = (over: Partial<model.LiveThread>): model.LiveThread => ({
      thread_key: '', with_user: 'per-2', with_name: 'Bob', last: 'x', last_at: '2026-01-01T10:00:00.000Z', last_from: 'per-2', unread: 0, ...over })
    const now = Date.parse('2026-01-01T10:01:00.000Z')
    const me = ['per-1', 'acc-1']
    assert.deepEqual(model.arrivals([t({ unread: 1 })], [t({ unread: 2 })], me, now, null).map((x) => x.with_user), ['per-2'])
    assert.deepEqual(model.arrivals([t({ unread: 2 })], [t({ unread: 2 })], me, now, null), [], 'the same count is nothing new')
    assert.deepEqual(model.arrivals([], [t({ unread: 1 })], me, now, 'per-2'), [], 'the conversation on screen is being read')
    assert.deepEqual(model.arrivals([], [t({ unread: 1, last_from: 'acc-1' })], me, now, null), [], 'my own last line')
    assert.deepEqual(model.arrivals(null, [t({ unread: 3 })], me, now, null).length, 1, 'a first read rings a line that just landed')
    assert.deepEqual(model.arrivals(null, [t({ unread: 3, last_at: '2026-01-01T08:00:00.000Z' })], me, now, null), [],
      '…and primes an old one silently')
    const s = useChatLiveStore.getState()
    s.reset(true, 'acc-1')
    s.applyOverview({ me: 'per-1', threads: [t({ unread: 2 }), t({ with_user: 'per-3', unread: 1 })] }, 'per-2')
    assert.deepEqual(useChatLiveStore.getState().threads.map((x) => x.unread), [0, 1], 'the sheet\'s count for the thread on screen is not shown')
    assert.equal(useChatLiveStore.getState().unread, 1)
  })

  it('the Server-Sent Events leg posts one record at a time, in order', async () => {
    const order: string[] = []
    const post = (text: string) => new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        order.push(text)
        if (text === 'b') reject(new Error('refused'))
        else resolve()
      }, text === 'a' ? 30 : 0)
    })
    const send = oneAtATime(post)
    const all = [send('a'), send('b').catch(() => 'b refused'), send('c')]
    await Promise.all(all)
    assert.deepEqual(order, ['a', 'b', 'c'], 'the slow first post is not overtaken, and a refused one does not stop the rest')
  })

  it('unread: one more for a message from somebody else not being read; nothing for mine; read goes to zero', () => {
    const s = useChatLiveStore.getState()
    s.reset(true, 'acc-1')
    s.applyOverview({ me: 'per-1', live_ids: ['per-1', 'acc-1'], threads: [
      { thread_key: 'per-1|per-2', with_user: 'per-2', with_name: 'Bob', last: '', last_at: '', unread: 2 }], people: [] })
    assert.equal(useChatLiveStore.getState().unread, 2)
    useChatLiveStore.getState().incoming(msg({ id: 'm3', from_user: 'per-3', from_name: 'Cy' }), true)
    assert.equal(useChatLiveStore.getState().unread, 3)
    assert.equal(useChatLiveStore.getState().threads[0].with_user, 'per-3', 'the thread moves to the top')
    useChatLiveStore.getState().incoming(msg({ id: 'm4', from_user: 'per-1', to_user: 'per-2', mine: true }), false)
    assert.equal(useChatLiveStore.getState().unread, 3)
    useChatLiveStore.getState().readHere('per-2')
    assert.equal(useChatLiveStore.getState().unread, 1)
    assert.deepEqual(useChatLiveStore.getState().me, ['acc-1', 'per-1'])
  })

  it('the same line pushed twice (a Retry handed its receipt back) is drawn and counted once', () => {
    const s = useChatLiveStore.getState()
    s.reset(true, 'acc-1')
    s.applyOverview({ me: 'per-1', live_ids: ['per-1', 'acc-1'], threads: [
      { thread_key: 'per-1|per-2', with_user: 'per-2', with_name: 'Bob', last: '', last_at: '', unread: 0 }], people: [] })
    s.applyMessages('per-2', { messages: [] }, false)
    const line = msg({ id: 'm5', client_id: 'c5', body: 'once' })
    s.incoming(line, true)
    assert.equal(useChatLiveStore.getState().unread, 1)
    s.incoming(line, true)
    s.incoming({ ...line, id: 'm5-copy' }, true)
    assert.equal(useChatLiveStore.getState().unread, 1, 'by its id, or by its client id')
    assert.equal(useChatLiveStore.getState().messages['per-2'].filter((m) => m.body === 'once').length, 1)
    assert.equal(model.alreadyDrawn([msg({ id: 'p', client_id: 'c6', status: 'pending' })], { id: 'm6', client_id: 'c6' }), false,
      'a waiting line of mine is not drawn yet: its echo still lands')
  })

  it('words on their way: pending under the sender\'s client id, the row on its confirm, gone on its retract', () => {
    const me = ['per-1', 'acc-1']
    const onWay = model.fromWire({ client_id: 'c9', from: 'per-2', from_name: 'Bob', to: 'per-1', body: 'hi',
      at: '2026-01-01T10:00:00.000Z', thread_key: 'per-1|per-2', state: 'sending' }, me)
    assert.deepEqual([onWay.id, onWay.status, onWay.mine, onWay.from_user, onWay.to_user, onWay.created_at],
      ['pending-c9', 'pending', false, 'per-2', 'per-1', '2026-01-01T10:00:00.000Z'])
    const row = model.fromWire({ client_id: 'c9', id: 'm9', created_at: '2026-01-01T10:00:09.000Z', state: 'sent',
      from: 'per-2', to: 'per-1', body: 'hi' }, me)
    assert.deepEqual([row.id, row.status], ['m9', 'sent'])
    const list = model.applyIncoming([msg({ id: 'm1', created_at: '2026-01-01T09:00:00.000Z' })], onWay)
    assert.equal(model.applyIncoming(list, onWay), list, 'the same words again change nothing')
    const confirmed = model.applyIncoming(list, row)
    assert.deepEqual(confirmed.map((m) => [m.id, m.status]), [['m1', 'sent'], ['m9', 'sent']], 'one line, the row')
    assert.equal(model.applyIncoming(confirmed, onWay), confirmed, 'words on their way never undo the row')
    assert.deepEqual(model.retractLine(list, 'c9').map((m) => m.id), ['m1'])
    assert.equal(model.retractLine(confirmed, 'c9').length, 2, 'a row stays')
    const mine = model.addPending([], msg({ id: 'pending-c1', client_id: 'c1', mine: true, status: 'pending' }))
    assert.equal(model.retractLine(mine, 'c1').length, 1, 'never a line of mine')
    // another tab's Retry of my failed line: on its way again here
    const again = model.applyIncoming(model.failSent(mine, 'c1', 'Not found.'), { ...mine[0], status: 'pending' })
    assert.deepEqual([again[0].status, again[0].why], ['pending', undefined])
    // a read that overtakes the confirm takes the line's place; the same words from before they were typed do not
    const read = model.mergeServer(list, [msg({ id: 'm9', body: 'hi', created_at: '2026-01-01T10:00:09.000Z' })], false)
    assert.deepEqual(read.map((m) => [m.id, m.status, m.client_id ?? '']), [['m1', 'sent', ''], ['m9', 'sent', 'c9']])
    const old = model.mergeServer(list, [msg({ id: 'm0', body: 'hi', created_at: '2026-01-01T09:55:00.000Z' })], false)
    assert.equal(old.find((m) => m.client_id === 'c9')?.status, 'pending')
  })

  it('a line on its way counts once: at once, not again on its confirm, and not at all once retracted', () => {
    const s = useChatLiveStore.getState()
    s.reset(true, 'acc-1')
    s.applyOverview({ me: 'per-1', live_ids: ['per-1', 'acc-1'], threads: [], people: [] })
    const onWay = (clientId: string, from: string, body: string) => model.fromWire({ client_id: clientId, from,
      from_name: from, to: 'per-1', body, at: '2026-01-01T10:00:00.000Z', state: 'sending' }, ['per-1'])
    s.incoming(onWay('c7', 'per-3', 'lunch?'), true)
    assert.equal(useChatLiveStore.getState().unread, 1)
    s.incoming({ ...onWay('c7', 'per-3', 'lunch?'), id: 'm7', created_at: '2026-01-01T10:00:05.000Z', status: 'sent' }, false)
    assert.equal(useChatLiveStore.getState().unread, 1, 'its confirm is the same line')
    s.incoming(onWay('c6', 'per-3', 'never stored'), true)
    assert.equal(useChatLiveStore.getState().unread, 2)
    s.retract('c6', 'per-3')
    assert.equal(useChatLiveStore.getState().unread, 1)
    // drawn here, and a read already found its row: the sheet has it, so the count stays with the line
    s.applyMessages('per-2', { messages: [] }, false)
    s.incoming(onWay('c8', 'per-2', 'landed'), true)
    s.applyMessages('per-2', { messages: [{ id: 'm8', from_user: 'per-2', from_name: 'per-2', body: 'landed',
      created_at: '2026-01-01T10:00:04.000Z' }] }, true)
    s.retract('c8', 'per-2')
    assert.equal(useChatLiveStore.getState().unread, 2)
    assert.deepEqual(useChatLiveStore.getState().messages['per-2'].map((m) => [m.id, m.status]), [['m8', 'sent']])
    // drawn here and never a row: it goes
    s.incoming(onWay('c5', 'per-2', 'gone'), false)
    s.retract('c5', null)
    assert.ok(!useChatLiveStore.getState().messages['per-2'].some((m) => m.client_id === 'c5'))
  })

  it('a reaction flips optimistically as the server will', () => {
    const r = model.toggleReaction({}, 'm1', '👍', 'per-1')
    assert.deepEqual(r, { m1: { '👍': ['per-1'] } })
    assert.deepEqual(model.toggleReaction(r, 'm1', '👍', 'per-1'), { m1: {} })
  })

  it('a HubException says its kind; records split on U+001E and keep the partial one', () => {
    const e = new HubCallError("An unexpected error occurred invoking 'Send' on the server. HubException: failed: Not found.")
    assert.deepEqual([e.kind, e.message], ['failed', 'Not found.'])
    assert.equal(new HubCallError('HubException: reauth: renew').kind, 'reauth')
    assert.deepEqual(splitRecords('{"type":6}\u001e{"type":1'), { records: ['{"type":6}'], rest: '{"type":1' })
  })
})

describe('the screen', () => {
  it('acting, if ever drawn here: one line, no composer, no connection (My Inbox draws today\'s chat instead)', () => {
    const html = renderToString(<MemoryRouter><ChatLiveView mode="acting" /></MemoryRouter>)
    assert.ok(html.includes(LIVE_ACTING_LINE.replace(/'/g, '&#x27;')))
    assert.ok(!html.includes('aria-label="Send"'))
  })

  it('on: the two panes, and what the connection is doing', () => {
    // the server renderer reads the store's first state: a connection not yet started
    const html = renderToString(<MemoryRouter><ChatLiveView mode="on" /></MemoryRouter>)
    assert.ok(html.includes('Search people…') && html.includes('Pick somebody to write to'))
    assert.ok(html.includes(LIVE_STATE_LINE.idle))
    assert.equal(LIVE_STATE_LINE.live, '', 'a live connection says nothing')
    assert.match(LIVE_STATE_LINE.reconnecting, /^Reconnecting live chat/)
    assert.equal(LIVE_REFUSED_LINE.acting, LIVE_ACTING_LINE)
  })

  it('a line of mine shows at once with one tick, and two once the sheet has it — never "sending…"', () => {
    const initial = { ...useChatLiveStore.getInitialState() }
    Object.assign(useChatLiveStore.getInitialState(), {
      connection: 'live', loaded: true, open: 'per-2', me: ['per-1'], self: 'per-1',
      threads: [{ thread_key: 'per-1|per-2', with_user: 'per-2', with_name: 'Bob', last: '', last_at: '', unread: 0 }],
      messages: { 'per-2': [
        msg({ id: 'm1', from_user: 'per-1', to_user: 'per-2', mine: true, body: 'saved one', created_at: '2026-01-01T09:00:00.000Z' }),
        msg({ id: 'pending-c3', client_id: 'c3', body: 'theirs on its way', status: 'pending', created_at: '2026-01-01T09:30:00.000Z' }),
        msg({ id: 'pending-c2', client_id: 'c2', from_user: 'per-1', to_user: 'per-2', mine: true, body: 'typed now', status: 'pending' }),
      ] },
    })
    try {
      const html = renderToString(<MemoryRouter><ChatLiveView mode="on" /></MemoryRouter>)
      assert.ok(html.includes('typed now') && html.includes('theirs on its way') && html.includes('saved one'))
      assert.ok(!html.includes('sending…'))
      assert.equal((html.match(/data-ticks="1"/g) ?? []).length, 1, 'one tick: the line typed now')
      assert.equal((html.match(/data-ticks="2"/g) ?? []).length, 1, 'two: the line the sheet has')
    } finally {
      Object.assign(useChatLiveStore.getInitialState(), initial)
    }
  })
})

/* ---------------- the client against a hub answered at the socket ---------------- */

const RS = '\u001e'
type Sent = { type?: number; invocationId?: string; target?: string; arguments?: unknown[] }

class FakeSocket {
  static OPEN = 1
  static last: FakeSocket | null = null
  /**
   * How the next socket answers, set BEFORE the client starts: the connect's own Overview can go out within the
   * first few milliseconds, before a test polling for the socket could hand it an answer afterwards.
   */
  static answerWith: ((frame: Sent, hub: FakeSocket) => unknown) | null = null
  readyState = 0
  url: string
  sent: Sent[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  answer: (frame: Sent) => unknown = () => null
  failNext: Record<string, string> = {}

  constructor(url: string) {
    this.url = url
    FakeSocket.last = this
    const given = FakeSocket.answerWith
    if (given) this.answer = (frame) => given(frame, this)
    setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
  }

  push(frame: object): void {
    this.onmessage?.({ data: JSON.stringify(frame) + RS })
  }

  send(text: string): void {
    for (const raw of text.split(RS).filter(Boolean)) {
      const frame = JSON.parse(raw) as Sent
      if (!frame.type) {
        setTimeout(() => this.onmessage?.({ data: '{}' + RS }), 0)
        continue
      }
      this.sent.push(frame)
      if (frame.type === 1 && frame.invocationId) {
        const target = String(frame.target)
        const error = this.failNext[target]
        if (error) delete this.failNext[target]
        const result = error ? undefined : this.answer(frame)
        setTimeout(() => this.push(error
          ? { type: 3, invocationId: frame.invocationId, error }
          : { type: 3, invocationId: frame.invocationId, result }), 0)
      }
    }
  }

  close(): void {
    this.readyState = 3
    this.onclose?.({ code: 1000 })
  }

  calls(target: string): Sent[] {
    return this.sent.filter((f) => f.type === 1 && f.target === target)
  }
}

const until = async (what: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!what()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('the client, end to end against a fake hub', () => {
  const g = globalThis as Record<string, unknown>
  const saved = { fetch: g.fetch, WebSocket: g.WebSocket, location: g.location }
  after(() => {
    g.fetch = saved.fetch
    g.WebSocket = saved.WebSocket
    g.location = saved.location
  })

  /** How many of the next ticket asks the door answers 503 (a relay restarting). */
  let ticketFailures = 0

  /** The relay's ticket door and the hub's negotiate, answered at fetch; the socket is FakeSocket. */
  const fakeTransport = () => {
    const asked: { url: string; headers: Record<string, string> }[] = []
    FakeSocket.last = null
    FakeSocket.answerWith = null
    ticketFailures = 0
    g.location = { href: 'https://hub.example/#/app/my-inbox/chat', hash: '', pathname: '/', search: '' }
    g.WebSocket = FakeSocket
    g.fetch = (async (url: string, init?: RequestInit) => {
      asked.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
      if (String(url) === '/snapshot/chat-ticket') {
        if (ticketFailures > 0) {
          ticketFailures--
          return new Response(JSON.stringify({ status: 503, reason: 'unavailable', message: 'restarting' }), { status: 503 })
        }
        return new Response(JSON.stringify({ status: 200, data: { ticket: 't'.repeat(43), expires_in: 60 } }))
      }
      if (String(url).startsWith('/chat-hub/live/negotiate')) {
        return new Response(JSON.stringify({ negotiateVersion: 1, connectionId: 'cid', connectionToken: 'ctok',
          availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text'] }] }))
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    return asked
  }

  it('connects with a ticket, keeps the rail, marks what arrives while it is read, and retries a send as itself', async () => {
    const asked = fakeTransport()

    useChatLiveStore.getState().reset(true, 'acc-1')
    useNotificationStore.setState({ items: [] } as never)
    let sendN = 0
    let refuse = ''
    let unsure = false
    const answer = (f: Sent, hub: FakeSocket) => {
      switch (f.target) {
        case 'Overview':
          return { me: 'per-1', live_ids: ['per-1', 'acc-1'], people: [], unread: 2,
            threads: [{ thread_key: 'per-1|per-2', with_user: 'per-2', with_name: 'Bob', last: 'x', last_at: '', unread: 2 }] }
        case 'Messages':
          return { messages: [{ id: 'm1', from_user: 'per-2', from_name: 'Bob', body: 'x', created_at: '2026-01-01T09:00:00.000Z', mine: false }], reset: false, reactions: {} }
        case 'MarkRead':
          return { marked: '1' }
        case 'Send': {
          // answered at once; the outcome follows as a frame to the sender's tabs
          const [to, body, clientId] = (f.arguments ?? []) as string[]
          const why = refuse
          const unconfirmed = unsure
          refuse = ''
          unsure = false
          if (!why) sendN++
          setTimeout(() => hub.push(why
            ? { type: 1, target: 'send_failed', arguments: [{ client_id: clientId, to_user: to, why, unconfirmed }] }
            : { type: 1, target: 'confirm', arguments: [{ client_id: clientId, id: `m-sent-${sendN}`,
              created_at: '2026-01-01T11:00:00.000Z', state: 'sent', thread_key: 'per-1|per-2', from: 'per-1',
              from_name: 'Ann', to, body }] }), 5)
          return { client_id: clientId, queued: true }
        }
        default:
          return null
      }
    }

    FakeSocket.answerWith = answer
    const api = startLive({ token: 'tok-session', account: 'acc-1', tenant: '' })
    try {
      await until(() => FakeSocket.last !== null)
      const hub = FakeSocket.last!
      await until(() => useChatLiveStore.getState().connection === 'live' && useChatLiveStore.getState().loaded)

      const ticketAsk = asked.find((a) => a.url === '/snapshot/chat-ticket')
      assert.equal(ticketAsk?.headers.Authorization, 'Bearer tok-session', 'the ticket is asked with the session')
      assert.ok(!hub.url.includes('tok-session'), 'the session token never reaches the socket')
      assert.ok(hub.url.startsWith('wss://hub.example/chat-hub/live?id=ctok&access_token=' + 't'.repeat(43)))
      assert.equal(useChatPresenceStore.getState().unread, 2, 'the shell\'s badge follows the rail')

      api.open('per-2')
      await until(() => hub.calls('MarkRead').length === 1)
      assert.equal(hub.calls('OpenThread')[0]?.arguments?.[0], 'per-2')
      assert.equal(useChatLiveStore.getState().unread, 0)
      assert.equal(useChatLiveStore.getState().messages['per-2']?.length, 1)

      // a message into the open, visible conversation: shown, not counted, read 1.5 s later
      hub.push({ type: 1, target: 'message', arguments: [{ id: 'm2', from_user: 'per-2', from_name: 'Bob', to_user: 'per-1', body: 'there?', created_at: '2026-01-01T10:00:00.000Z' }] })
      await until(() => (useChatLiveStore.getState().messages['per-2'] ?? []).some((m) => m.id === 'm2'))
      assert.equal(useChatLiveStore.getState().unread, 0)
      await until(() => hub.calls('MarkRead').length === 2, 4000)

      // one elsewhere: counted, announced, linked to My Inbox
      hub.push({ type: 1, target: 'message', arguments: [{ id: 'm3', from_user: 'per-3', from_name: 'Cy', to_user: 'per-1', body: 'hello', created_at: '2026-01-01T10:01:00.000Z' }] })
      await until(() => useChatLiveStore.getState().unread === 1)
      const note = useNotificationStore.getState().items.find((n) => n.title.includes('Cy'))
      assert.equal(note?.href, '/app/my-inbox/chat?with=per-3')

      // a send: pending, answered at once, then the hub's confirm with its client id puts the sheet's id on it
      api.send('per-2', 'on my way')
      assert.equal(useChatLiveStore.getState().messages['per-2'].at(-1)?.status, 'pending')
      await until(() => (useChatLiveStore.getState().messages['per-2'] ?? []).some((m) => m.id === 'm-sent-1' && m.status === 'sent'))
      assert.equal(useChatLiveStore.getState().messages['per-2'].filter((m) => m.body === 'on my way').length, 1, 'drawn once')
      const firstSend = hub.calls('Send')[0]
      assert.deepEqual(firstSend.arguments?.slice(0, 2), ['per-2', 'on my way'])
      assert.equal(useChatLiveStore.getState().unread, 1, 'my own line counts nothing')

      // a send the relay refused: said by the hub, kept on screen as not sent; Retry sends the same client id
      refuse = 'Not found.'
      api.send('per-2', 'again')
      await until(() => (useChatLiveStore.getState().messages['per-2'] ?? []).some((m) => m.status === 'failed'))
      const failed = useChatLiveStore.getState().messages['per-2'].find((m) => m.status === 'failed')!
      assert.equal(failed.why, 'Not found.')
      assert.equal(model.failedWords(failed).line, 'Not sent — Not found.', 'a refusal ran nothing: it was not sent')
      api.retry('per-2', failed.client_id!)
      await until(() => hub.calls('Send').length === 3)
      const [second, third] = hub.calls('Send').slice(1)
      assert.equal(second.arguments?.[2], third.arguments?.[2], 'the retry is the same write')
      await until(() => (useChatLiveStore.getState().messages['per-2'] ?? []).every((m) => m.status === 'sent'))

      // a send nobody could confirm (Apps Script took it and never answered): it may be in the sheet, so it says
      // "not confirmed", and its Retry is the same write again
      refuse = 'Sent, but the server has not confirmed it yet.'
      unsure = true
      api.send('per-2', 'maybe')
      await until(() => (useChatLiveStore.getState().messages['per-2'] ?? []).some((m) => m.status === 'failed'))
      const maybe = useChatLiveStore.getState().messages['per-2'].find((m) => m.status === 'failed')!
      assert.equal(maybe.unsure, true)
      assert.equal(model.failedWords(maybe).mark, 'not confirmed')
      api.retry('per-2', maybe.client_id!)
      await until(() => (useChatLiveStore.getState().messages['per-2'] ?? []).every((m) => m.status === 'sent'))
      assert.equal(hub.calls('Send').at(-1)?.arguments?.[2], maybe.client_id, 'the retry checks under the same id')
      assert.equal(useChatLiveStore.getState().messages['per-2'].filter((m) => m.body === 'maybe').length, 1)

      // a send the hub itself refused: the line stays, with the hub's words
      hub.failNext.Send = "An unexpected error occurred invoking 'Send' on the server. HubException: refused: a message is 1 to 4000 characters"
      api.send('per-2', 'x')
      await until(() => (useChatLiveStore.getState().messages['per-2'] ?? []).some((m) => m.status === 'failed'))
      const refusedHere = useChatLiveStore.getState().messages['per-2'].find((m) => m.status === 'failed')
      assert.equal(refusedHere?.why, 'a message is 1 to 4000 characters')
      assert.ok(!refusedHere?.unsure, 'the hub refused it: surely not sent')

      // the relay forgot the ref: a new ticket on the same socket — and a door still restarting is asked again
      const ticketsBefore = asked.filter((a) => a.url === '/snapshot/chat-ticket').length
      ticketFailures = 1
      hub.push({ type: 1, target: 'reauth', arguments: [] })
      await until(() => hub.calls('Reauth').length === 1, 3000 + REAUTH_RETRY_MS[0])
      assert.equal(asked.filter((a) => a.url === '/snapshot/chat-ticket').length, ticketsBefore + 2,
        'the 503 was asked again, not left to the hub\'s grace')
      assert.equal(hub.calls('Reauth')[0].arguments?.[0], 't'.repeat(43))
      assert.equal(hub.readyState, 1, 'the socket stays')

      // a reaction names the conversation it was made in, for the frame the other tabs file it by
      await api.react('per-2', 'm2', '👍')
      assert.deepEqual(hub.calls('React')[0].arguments?.slice(0, 2), ['m2', '👍'])
      assert.equal(hub.calls('React')[0].arguments?.[3], 'per-2')
    } finally {
      api.stop()
    }
  })

  it('a client: the rail is the circle the relay carried and nothing else, and a line to its guardian goes out as itself', async () => {
    fakeTransport()
    useChatLiveStore.getState().reset(true, 'acc-cora')
    const circle: model.LivePerson[] = [
      { user_id: 'per-grd', name: 'Gary Guardian', online: true },
      { user_id: 'per-ssa', name: 'Sue Ssa', title: 'SSA', online: false },
      { user_id: 'per-stf', name: 'Ann Roe', online: true },
    ]
    let people = circle
    FakeSocket.answerWith = (f) => {
      if (f.target === 'Overview') {
        return { me: 'per-cora', live_ids: ['per-cora', 'acc-cora'], people, threads: [], unread: 0, circle: { why: '' } }
      }
      if (f.target === 'Messages') return { messages: [], reset: false, reactions: {} }
      if (f.target === 'MarkRead') return { marked: '0' }
      if (f.target === 'Send') return { client_id: (f.arguments ?? [])[2], queued: true }
      return null
    }
    const api = startLive({ token: 'tok-cora', account: 'acc-cora', tenant: '' })
    try {
      await until(() => FakeSocket.last !== null)
      const hub = FakeSocket.last!
      await until(() => useChatLiveStore.getState().connection === 'live' && useChatLiveStore.getState().loaded)
      assert.deepEqual(useChatLiveStore.getState().people.map((p) => p.user_id), ['per-grd', 'per-ssa', 'per-stf'])
      api.open('per-grd')
      api.send('per-grd', 'see you sunday')
      await until(() => hub.calls('Send').length === 1)
      assert.deepEqual(hub.calls('Send')[0].arguments?.slice(0, 2), ['per-grd', 'see you sunday'])
      // a later rail replaces the earlier one whole: nobody it no longer names stays on screen
      people = [circle[0]]
      await api.refresh()
      await until(() => useChatLiveStore.getState().people.length === 1)
      assert.deepEqual(useChatLiveStore.getState().people.map((p) => p.user_id), ['per-grd'])
    } finally {
      api.stop()
    }
    // another account's connection starts from nothing of this one's
    useChatLiveStore.getState().reset(true, 'acc-other')
    assert.deepEqual([useChatLiveStore.getState().people, useChatLiveStore.getState().threads], [[], []])
  })

  it('a nudge from a sender on today\'s chat: the open conversation is read and marked; a count rising elsewhere rings once', async () => {
    fakeTransport()
    useChatLiveStore.getState().reset(true, 'acc-1')
    useNotificationStore.setState({ items: [] } as never)
    useChatPresenceStore.getState().setState(0, null)
    const bob = (id: string, body: string, at: string) => ({ id, from_user: 'per-2', from_name: 'Bob', body, created_at: at, mine: false })
    const lines = [bob('m1', 'x', '2026-01-01T09:00:00.000Z')]
    const thread = (over: Partial<model.LiveThread>): model.LiveThread => ({
      thread_key: 'per-1|per-2', with_user: 'per-2', with_name: 'Bob', last: 'x', last_at: '2026-01-01T09:00:00.000Z',
      last_from: 'per-2', unread: 0, ...over })
    let threads = [thread({})]
    FakeSocket.answerWith = (f) => {
      if (f.target === 'Overview') return { me: 'per-1', live_ids: ['per-1', 'acc-1'], people: [], threads }
      if (f.target === 'Messages') return { messages: lines, reset: false, reactions: {} }
      if (f.target === 'MarkRead') return { marked: '1' }
      return null
    }
    const api = startLive({ token: 'tok-session', account: 'acc-1', tenant: '' })
    try {
      await until(() => FakeSocket.last !== null)
      const hub = FakeSocket.last!
      await until(() => useChatLiveStore.getState().connection === 'live' && useChatLiveStore.getState().loaded)
      api.open('per-2')
      await until(() => hub.calls('MarkRead').length === 1)

      // Bob writes from today's chat: the sheet has the line, still unread, and the hub only nudges
      const at = new Date().toISOString()
      lines.push(bob('m2', 'are you there?', at))
      threads = [thread({ last: 'are you there?', last_at: at, unread: 1 })]
      const overviews = hub.calls('Overview').length
      hub.push({ type: 1, target: 'nudge', arguments: [{ thread_key: 'per-1|per-2', action: 'chatSend' }] })
      await until(() => (useChatLiveStore.getState().messages['per-2'] ?? []).some((m) => m.id === 'm2'))
      await until(() => hub.calls('MarkRead').length === 2, 5000)
      assert.equal(hub.calls('MarkRead')[1].arguments?.[0], 'per-2', 'the line that landed on screen is marked read')
      await until(() => hub.calls('Overview').length > overviews, 5000)
      await new Promise((r) => setTimeout(r, 50))
      assert.equal(useChatLiveStore.getState().unread, 0, 'the rail does not count what is being read')
      assert.equal(useChatPresenceStore.getState().unread, 0, 'nor does the shell\'s badge')
      assert.equal(useNotificationStore.getState().items.length, 0, 'and nothing rings for it')

      // Cy writes from today's chat to a conversation that is not open: counted, announced, once
      const cyAt = new Date().toISOString()
      threads = [thread({ last: 'are you there?', last_at: at, unread: 0 }),
        thread({ thread_key: 'per-1|per-3', with_user: 'per-3', with_name: 'Cy', last: 'lunch?', last_at: cyAt, last_from: 'per-3', unread: 1 })]
      hub.push({ type: 1, target: 'nudge', arguments: [{ thread_key: 'per-1|per-3', action: 'chatSend' }] })
      await until(() => useNotificationStore.getState().items.some((n) => n.title.includes('Cy')), 5000)
      const note = useNotificationStore.getState().items.find((n) => n.title.includes('Cy'))!
      assert.equal(note.href, '/app/my-inbox/chat?with=per-3')
      assert.equal(note.body, 'lunch?')
      assert.equal(useChatPresenceStore.getState().unread, 1)
      assert.equal(useChatPresenceStore.getState().latest?.from_user, 'per-3', 'My Inbox\'s latest line is Cy\'s')
      const before = hub.calls('Overview').length
      hub.push({ type: 1, target: 'nudge', arguments: [{ thread_key: 'per-1|per-3', action: 'chatReact' }] })
      await until(() => hub.calls('Overview').length > before, 5000)
      await new Promise((r) => setTimeout(r, 50))
      assert.equal(useNotificationStore.getState().items.filter((n) => n.title.includes('Cy')).length, 1, 'the same line rings once')
    } finally {
      api.stop()
    }
  })

  it('a nudge that names no thread (the hub\'s ping found unread moving) reads the rail and rings what rose', async () => {
    fakeTransport()
    useChatLiveStore.getState().reset(true, 'acc-1')
    useNotificationStore.setState({ items: [] } as never)
    useChatPresenceStore.getState().setState(0, null)
    const thread = (over: Partial<model.LiveThread>): model.LiveThread => ({
      thread_key: 'per-1|per-2', with_user: 'per-2', with_name: 'Bob', last: 'x', last_at: '2026-01-01T09:00:00.000Z',
      last_from: 'per-2', unread: 0, ...over })
    let threads = [thread({})]
    FakeSocket.answerWith = (f) => {
      if (f.target === 'Overview') return { me: 'per-1', live_ids: ['per-1', 'acc-1'], people: [], threads }
      return null
    }
    const api = startLive({ token: 'tok-session', account: 'acc-1', tenant: '' })
    try {
      await until(() => FakeSocket.last !== null)
      const hub = FakeSocket.last!
      await until(() => useChatLiveStore.getState().connection === 'live' && useChatLiveStore.getState().loaded)
      assert.equal(useChatLiveStore.getState().open, null)

      // Bob wrote from today's chat and the relay never heard the answer: the ping's nudge is the only word of it
      const at = new Date().toISOString()
      threads = [thread({ last: 'from the old chat', last_at: at, unread: 1 })]
      const overviews = hub.calls('Overview').length
      hub.push({ type: 1, target: 'nudge', arguments: [{ thread_key: '', action: 'chatPing' }] })
      await until(() => useNotificationStore.getState().items.some((n) => n.title.includes('Bob')), 5000)
      assert.ok(hub.calls('Overview').length > overviews, 'the rail was read')
      assert.equal(hub.calls('Messages').length, 0, 'no conversation is open: the rail alone')
      const note = useNotificationStore.getState().items.find((n) => n.title.includes('Bob'))!
      assert.equal(note.body, 'from the old chat')
      assert.equal(note.href, '/app/my-inbox/chat?with=per-2')
      assert.equal(useChatPresenceStore.getState().unread, 1, 'the shell\'s badge rose with it')

      // one line the hub pushed twice (a Retry handed its receipt back): counted once, rung once
      const cy = { id: 'm-cy', from_user: 'per-3', from_name: 'Cy', to_user: 'per-1', body: 'lunch?', created_at: new Date().toISOString() }
      hub.push({ type: 1, target: 'message', arguments: [cy] })
      hub.push({ type: 1, target: 'message', arguments: [cy] })
      await until(() => useChatLiveStore.getState().unread === 2)
      await new Promise((r) => setTimeout(r, 50))
      assert.equal(useChatLiveStore.getState().unread, 2)
      assert.equal(useNotificationStore.getState().items.filter((n) => n.title.includes('Cy')).length, 1)
    } finally {
      api.stop()
    }
  })

  it('a pushed line never hides an older one no read has fetched: it is read, drawn, and only then marked', async () => {
    fakeTransport()
    useChatLiveStore.getState().reset(true, 'acc-1')
    useNotificationStore.setState({ items: [] } as never)
    useChatPresenceStore.getState().setState(0, null)
    const row = (id: string, from: string, body: string, at: string) => ({
      id, from_user: from, from_name: from === 'per-1' ? 'Ann' : 'Bob', body, created_at: at, mine: from === 'per-1' })
    // the sheet, in row order, and what Chat.gs counts unread for the viewer
    const sheet = [row('m1', 'per-2', 'x', '2026-01-01T09:00:00.000Z')]
    let unread = 0
    const drawn = () => new Set((useChatLiveStore.getState().messages['per-2'] ?? []).map((m) => m.id))
    const marks: Set<string>[] = []
    FakeSocket.answerWith = (f) => {
      if (f.target === 'Overview') {
        const last = sheet[sheet.length - 1]
        return { me: 'per-1', live_ids: ['per-1', 'acc-1'], people: [], threads: [{ thread_key: 'per-1|per-2',
          with_user: 'per-2', with_name: 'Bob', last: last.body, last_at: last.created_at, last_from: last.from_user, unread }] }
      }
      if (f.target === 'Messages') {
        // Chat.gs chatMessages: only the rows after the cursor's row; a cursor it does not hold re-reads it whole
        const after = String(f.arguments?.[1] ?? '')
        const at = after ? sheet.findIndex((m) => m.id === after) : -1
        if (after && at === -1) return { messages: [...sheet], reset: true, reactions: {} }
        return { messages: sheet.slice(at + 1), reset: false, reactions: {} }
      }
      if (f.target === 'MarkRead') {
        marks.push(drawn())
        unread = 0
        return { marked: '1' }
      }
      return null
    }
    const api = startLive({ token: 'tok-session', account: 'acc-1', tenant: '' })
    try {
      await until(() => FakeSocket.last !== null)
      const hub = FakeSocket.last!
      await until(() => useChatLiveStore.getState().connection === 'live' && useChatLiveStore.getState().loaded)
      api.open('per-2')
      await until(() => marks.length === 1)

      // Bob, still on today's chat, writes Y: the hub hears of it only later, as a nudge. Meanwhile my own reply Z
      // lands after it, and its echo is pushed here first.
      const yAt = new Date(Date.now() - 2_000).toISOString()
      const zAt = new Date(Date.now() - 1_000).toISOString()
      sheet.push(row('m-y', 'per-2', 'are you there?', yAt))
      unread = 1
      sheet.push(row('m-z', 'per-1', 'back in five', zAt))
      hub.push({ type: 1, target: 'message', arguments: [{ id: 'm-z', thread_key: 'per-1|per-2', from_user: 'per-1',
        from_name: 'Ann', to_user: 'per-2', body: 'back in five', created_at: zAt }] })
      await until(() => drawn().has('m-z'))
      assert.ok(!drawn().has('m-y'))

      // Y's nudge: the read goes on from the last row a read carried, not from the pushed echo
      hub.push({ type: 1, target: 'nudge', arguments: [{ thread_key: 'per-1|per-2', action: 'chatSend' }] })
      await until(() => drawn().has('m-y'))
      assert.equal(hub.calls('Messages').at(-1)?.arguments?.[1], 'm1', 'read from the read cursor')
      await until(() => marks.length === 2, 5000)
      assert.ok(marks[1].has('m-y'), 'Y was drawn before it was marked read')
      assert.deepEqual([...drawn()], ['m1', 'm-y', 'm-z'], 'each line once, in time order')

      // Y2 lands and its nudge is lost: the next Overview finds the open conversation counted unread and reads it
      // before it marks it
      sheet.push(row('m-y2', 'per-2', 'hello?', new Date().toISOString()))
      unread = 1
      const reads = hub.calls('Messages').length
      hub.push({ type: 1, target: 'nudge', arguments: [{ thread_key: 'per-1|per-3', action: 'chatSend' }] })
      await until(() => drawn().has('m-y2'), 5000)
      assert.equal(hub.calls('Messages').length, reads + 1)
      assert.equal(hub.calls('Messages').at(-1)?.arguments?.[1], 'm-z')
      await until(() => marks.length === 3, 5000)
      assert.ok(marks[2].has('m-y2'), 'Y2 was drawn before it was marked read')
      assert.equal(useChatLiveStore.getState().unread, 0)
      assert.equal(useNotificationStore.getState().items.length, 0, 'nothing rings for the conversation on screen')
    } finally {
      api.stop()
    }
  })

  /** A hub that hands words on at once: `message` on their way, then `confirm` or `retract`. */
  const onTheirWay = (over: Record<string, unknown>) => ({ type: 1, target: 'message', arguments: [{ client_id: 'c-bob-1',
    from: 'per-2', from_name: 'Bob', to: 'per-1', body: 'on my way', thread_key: 'per-1|per-2',
    at: new Date().toISOString(), state: 'sending', ...over }] })
  const confirmOf = (over: Record<string, unknown>) => ({ type: 1, target: 'confirm', arguments: [{ client_id: 'c-bob-1',
    id: 'm-bob-1', created_at: new Date().toISOString(), state: 'sent', thread_key: 'per-1|per-2', from: 'per-2',
    from_name: 'Bob', to: 'per-1', body: 'on my way', ...over }] })
  const quietHub = (f: Sent) => {
    if (f.target === 'Overview') {
      return { me: 'per-1', live_ids: ['per-1', 'acc-1'], people: [], threads: [{ thread_key: 'per-1|per-2', with_user: 'per-2',
        with_name: 'Bob', last: 'x', last_at: '2026-01-01T09:00:00.000Z', last_from: 'per-2', unread: 0 }] }
    }
    if (f.target === 'Messages') {
      return { messages: [{ id: 'm1', from_user: 'per-2', from_name: 'Bob', body: 'x', created_at: '2026-01-01T09:00:00.000Z', mine: false }],
        reset: false, reactions: {} }
    }
    if (f.target === 'MarkRead') return { marked: '1' }
    if (f.target === 'Send') return { client_id: String(f.arguments?.[2] ?? ''), queued: true }
    return null
  }

  it('the other end\'s words show the moment the hub has them, become the row on its confirm, and go on its retract', async () => {
    fakeTransport()
    useChatLiveStore.getState().reset(true, 'acc-1')
    useNotificationStore.setState({ items: [] } as never)
    useChatPresenceStore.getState().setState(0, null)
    FakeSocket.answerWith = quietHub
    const api = startLive({ token: 'tok-session', account: 'acc-1', tenant: '' })
    try {
      await until(() => FakeSocket.last !== null)
      const hub = FakeSocket.last!
      await until(() => useChatLiveStore.getState().connection === 'live' && useChatLiveStore.getState().loaded)
      api.open('per-2')
      await until(() => hub.calls('MarkRead').length === 1)
      const lines = () => useChatLiveStore.getState().messages['per-2'] ?? []

      // into the open conversation: drawn at once, counted nowhere, and not marked before the sheet has it
      hub.push(onTheirWay({}))
      hub.push(onTheirWay({}))
      await until(() => lines().some((m) => m.client_id === 'c-bob-1'))
      assert.equal(lines().find((m) => m.client_id === 'c-bob-1')?.status, 'pending')
      assert.equal(useChatLiveStore.getState().unread, 0)
      await new Promise((r) => setTimeout(r, 1_700))
      assert.equal(hub.calls('MarkRead').length, 1, 'no mark reaches the sheet ahead of the row')
      assert.equal(lines().filter((m) => m.body === 'on my way').length, 1, 'the same words twice are one line')

      // its confirm: the sheet's row in the same place, then marked read
      hub.push(confirmOf({}))
      await until(() => lines().some((m) => m.id === 'm-bob-1' && m.status === 'sent'))
      assert.equal(lines().filter((m) => m.body === 'on my way').length, 1)
      await until(() => hub.calls('MarkRead').length === 2, 4000)
      assert.equal(useNotificationStore.getState().items.length, 0, 'nothing rings for the conversation on screen')

      // elsewhere: counted and announced the moment it arrives, and taken back when the sheet never took it
      hub.push(onTheirWay({ client_id: 'c-cy-1', from: 'per-3', from_name: 'Cy', body: 'lunch?', thread_key: 'per-1|per-3' }))
      await until(() => useChatLiveStore.getState().unread === 1)
      const cyNote = useNotificationStore.getState().items.find((n) => n.title.includes('Cy'))
      assert.ok(cyNote)
      assert.ok(useToastStore.getState().toasts.some((t) => t.key === cyNote.id), 'a toast rang for it, keyed by its row')
      assert.equal(useChatPresenceStore.getState().unread, 1, 'the shell\'s badge rose at once')
      assert.equal(useChatPresenceStore.getState().latest?.from_user, 'per-3', 'the shell\'s latest line is Cy\'s')
      let overviews = hub.calls('Overview').length
      hub.push({ type: 1, target: 'retract', arguments: [{ client_id: 'c-cy-1', why: 'Not found.' }] })
      await until(() => useChatLiveStore.getState().unread === 0)
      assert.equal(useChatPresenceStore.getState().unread, 0)
      // words the sheet never took leave nothing behind: no notification, no toast, no latest line
      assert.ok(!useNotificationStore.getState().items.some((n) => n.title.includes('Cy')), 'its notification went')
      assert.ok(!useToastStore.getState().toasts.some((t) => t.key === cyNote.id), 'its toast went')
      assert.notEqual(useChatPresenceStore.getState().latest?.from_user, 'per-3', 'the latest line is no longer Cy\'s')
      await until(() => hub.calls('Overview').length > overviews, 3000)

      // on screen while it is on its way: the line goes with its retract
      hub.push(onTheirWay({ client_id: 'c-bob-2', body: 'gone soon' }))
      await until(() => lines().some((m) => m.client_id === 'c-bob-2'))
      overviews = hub.calls('Overview').length
      hub.push({ type: 1, target: 'retract', arguments: [{ client_id: 'c-bob-2', why: 'Not found.' }] })
      await until(() => !lines().some((m) => m.client_id === 'c-bob-2'))
      await until(() => hub.calls('Overview').length > overviews, 3000)
      await new Promise((r) => setTimeout(r, 50))

      // a confirm nothing here drew on its way (the gate opened by the answer): it arrives whole, once
      hub.push(confirmOf({ client_id: 'c-di-1', id: 'm-di-1', from: 'per-4', from_name: 'Di', body: 'hello', thread_key: 'per-1|per-4' }))
      await until(() => useNotificationStore.getState().items.some((n) => n.title.includes('Di')))
      assert.equal(useChatLiveStore.getState().unread, 1)
      assert.equal(useChatLiveStore.getState().threads[0].with_user, 'per-4')
    } finally {
      api.stop()
    }
  })

  it('a line typed here shows at once and takes the sheet\'s id on its confirm; one from another tab of mine follows its ending', async () => {
    fakeTransport()
    useChatLiveStore.getState().reset(true, 'acc-1')
    useNotificationStore.setState({ items: [] } as never)
    useChatPresenceStore.getState().setState(0, null)
    FakeSocket.answerWith = quietHub
    const api = startLive({ token: 'tok-session', account: 'acc-1', tenant: '' })
    try {
      await until(() => FakeSocket.last !== null)
      const hub = FakeSocket.last!
      await until(() => useChatLiveStore.getState().connection === 'live' && useChatLiveStore.getState().loaded)
      api.open('per-2')
      await until(() => hub.calls('MarkRead').length === 1)
      const lines = () => useChatLiveStore.getState().messages['per-2'] ?? []

      api.send('per-2', 'typed here')
      const typed = lines().find((m) => m.body === 'typed here')!
      assert.equal(typed.status, 'pending', 'on screen before any answer: one tick')
      await until(() => hub.calls('Send').length === 1)
      hub.push(confirmOf({ client_id: typed.client_id, id: 'm-ann-1', from: 'per-1', from_name: 'Ann', to: 'per-2', body: 'typed here' }))
      await until(() => lines().some((m) => m.id === 'm-ann-1' && m.status === 'sent'))
      assert.equal(lines().filter((m) => m.body === 'typed here').length, 1)

      // sent from another tab of mine: on its way here too, counted nowhere
      const phone = { client_id: 'c-phone-1', from: 'per-1', from_name: 'Ann', to: 'per-2', body: 'from my phone' }
      hub.push(onTheirWay(phone))
      await until(() => lines().some((m) => m.client_id === 'c-phone-1' && m.mine && m.status === 'pending'))
      assert.equal(useChatLiveStore.getState().unread, 0)
      hub.push({ type: 1, target: 'send_failed', arguments: [{ client_id: 'c-phone-1', to_user: 'per-2', why: 'Not found.', unconfirmed: false }] })
      await until(() => lines().some((m) => m.client_id === 'c-phone-1' && m.status === 'failed'))
      // that tab's Retry: on its way again here, then the row
      hub.push(onTheirWay(phone))
      await until(() => lines().some((m) => m.client_id === 'c-phone-1' && m.status === 'pending'))
      hub.push(confirmOf({ ...phone, id: 'm-ann-2' }))
      await until(() => lines().some((m) => m.id === 'm-ann-2' && m.status === 'sent'))
      assert.equal(lines().filter((m) => m.body === 'from my phone').length, 1)
      assert.equal(useNotificationStore.getState().items.length, 0, 'my own lines ring nothing')
    } finally {
      api.stop()
    }
  })

  it('a send the relay kept is refused later: mine stays as not sent with its Retry, theirs goes; filed elsewhere, it is read again', async () => {
    fakeTransport()
    useChatLiveStore.getState().reset(true, 'acc-1')
    useNotificationStore.setState({ items: [] } as never)
    FakeSocket.answerWith = quietHub
    const api = startLive({ token: 'tok-session', account: 'acc-1', tenant: '' })
    try {
      await until(() => FakeSocket.last !== null)
      const hub = FakeSocket.last!
      await until(() => useChatLiveStore.getState().connection === 'live' && useChatLiveStore.getState().loaded)
      api.open('per-2')
      await until(() => hub.calls('MarkRead').length === 1)
      const lines = () => useChatLiveStore.getState().messages['per-2'] ?? []

      api.send('per-2', 'kept, then refused')
      const typed = lines().find((m) => m.body === 'kept, then refused')!
      await until(() => hub.calls('Send').length === 1)
      hub.push(confirmOf({ client_id: typed.client_id, id: 'm-kept-1', from: 'per-1', from_name: 'Ann', to: 'per-2', body: 'kept, then refused' }))
      await until(() => lines().some((m) => m.id === 'm-kept-1' && m.status === 'sent'))
      hub.push(confirmOf({ client_id: 'bL-theirs', id: 'm-theirs-1', body: 'theirs, then refused' }))
      await until(() => lines().some((m) => m.id === 'm-theirs-1'))

      hub.push({ type: 1, target: 'gone', arguments: [{ id: 'm-kept-1', client_id: typed.client_id, why: 'Not found.', moved: false }] })
      await until(() => lines().some((m) => m.id === 'm-kept-1' && m.status === 'failed'))
      const failed = lines().find((m) => m.id === 'm-kept-1')!
      assert.equal(model.failedWords(failed).line, 'Not sent — Not found.', 'said as not sent, words kept for the Retry')
      hub.push({ type: 1, target: 'gone', arguments: [{ id: 'm-theirs-1', client_id: 'bL-theirs', why: 'Not found.', moved: false }] })
      await until(() => !lines().some((m) => m.id === 'm-theirs-1'))
      const overviews = hub.calls('Overview').length
      await until(() => hub.calls('Overview').length > overviews, 3000)

      const reads = hub.calls('Messages').length
      hub.push(confirmOf({ client_id: 'bL-moved', id: 'm-moved-1', body: 'filed elsewhere' }))
      await until(() => lines().some((m) => m.id === 'm-moved-1'))
      hub.push({ type: 1, target: 'gone', arguments: [{ id: 'm-moved-1', client_id: 'bL-moved', why: '', moved: true }] })
      await until(() => !lines().some((m) => m.id === 'm-moved-1'))
      await until(() => hub.calls('Messages').length > reads)
    } finally {
      api.stop()
    }
  })

  it('a tab whose timers are held back still answers the hub: every frame that arrives carries the keepalive when it is due', async () => {
    fakeTransport()
    FakeSocket.answerWith = () => null
    const client = new HubClient({ url: '/chat-hub/live', ticket: async () => 't'.repeat(43), pingMs: 40 })
    try {
      await client.start()
      const hub = FakeSocket.last!
      const pings = () => hub.sent.filter((f) => f.type === 6).length
      hub.push({ type: 6 })
      assert.equal(pings(), 0, 'not due yet: nothing sent')
      await new Promise((r) => setTimeout(r, 60))
      const before = pings()
      hub.push({ type: 6 })
      assert.equal(pings(), before + 1, 'due: the frame that arrived sent it, not the one-second tick')
      hub.push({ type: 6 })
      assert.equal(pings(), before + 1, 'and once, not once per frame')
    } finally {
      await client.stop()
    }
  })
})

describe('a kept send refused later, in the model', () => {
  it('mine stays failed with its words; theirs goes; one filed under another id goes too', () => {
    const list = [
      msg({ id: 'k1', mine: true, from_user: 'per-1', client_id: 'c1', body: 'mine' }),
      msg({ id: 'k2', client_id: 'c2', body: 'theirs' }),
      msg({ id: 'k3', mine: true, from_user: 'per-1', client_id: 'c3', body: 'moved' }),
    ]
    const refused = model.goneLine(model.goneLine(list, 'k1', 'c1', 'Not found.'), '', 'c2', 'Not found.')
    assert.deepEqual(refused.map((m) => [m.id, m.status, m.why]), [['k1', 'failed', 'Not found.'], ['k3', 'sent', undefined]])
    assert.deepEqual(model.goneLine(refused, 'k3', '', '').map((m) => m.id), ['k1'])
  })
})
