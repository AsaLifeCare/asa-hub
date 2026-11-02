/**
 * The bell's side of company notices (lib/noticesApi, lib/notices, useNotificationStore): translation,
 * interruption, marks, failed reads, intake roads. Audiences are tools/test-web-notices.py's.
 */
import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  NOTICE_FRESH_MS, asServerNotice, isFresh, serverIdOf, spellShift, toAppNotification,
  type ServerNotice,
} from '@/lib/noticesApi'
import { onBeatSeq, onNoticeFrame, onSession } from '@/lib/notices'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { useToastStore } from '@/stores/useToastStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { visibleNotifications } from '@/lib/notificationVisibility'
import type { AppManifest } from '@/engine/types'

const NOW = Date.now()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const notice = (over: Partial<ServerNotice> = {}): ServerNotice => ({
  id: 41, kind: 'call_off', role: 'invited', at: iso(60_000), published_at: iso(30_000),
  title: 'Open shift at 48TH (B) — somebody called off', body: 'Thu 9/24 · {shift} · apply by 10:38 PM',
  shift: '10P-8A', house: '48TH (B)', col_iso: '2026-09-24', ref: 'SPABC',
  href: '/app/calendarbuilder/requests?tab=me&ref=SPABC', priority: 'high', tone: 'urgent', read: false,
  expires_at: '',
  ...over,
})

/** A high notice that is not a call-off or an open shift: it toasts, it is never pinned. */
const decided = (over: Partial<ServerNotice> = {}): ServerNotice => notice({
  id: 90, kind: 'decided', role: 'theirs', title: 'You have the shift at 48TH (B)',
  body: 'Thu 9/24 · {shift} · approved by Hal', tone: 'good', href: '/app/calendarbuilder/requests?tab=all',
  ...over,
})

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []
let answer: (url: string, init?: RequestInit) => { status: number; message?: string; data?: unknown } =
  () => ({ status: 200, data: {} })

function stubFetch(): void {
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const env = answer(url, init)
    return { ok: true, status: 200, json: async () => env } as unknown as Response
  }
}

const inbox = (notices: ServerNotice[], seq: number) =>
  ({ status: 200, data: { notices, unread: notices.filter((n) => !n.read).length, seq, since: 0, me: 'Ann Roe' } })

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  calls = []
  stubFetch()
  useAuthStore.setState({ token: 'tok-ann' } as never)
  useNotificationStore.getState().reset()
  useToastStore.setState({ toasts: [] })
})

describe('the translation — a relay notice as a bell row', () => {
  it('is a platform row with NO appId, so putting Shift Board away never hides a call-off', () => {
    const row = toAppNotification(notice(), false)
    assert.equal(row.id, 'srv-41')
    assert.equal(row.type, 'system')
    assert.equal(row.appId, undefined)
    const apps = [{ id: 'shiftboard', enabled: false }] as unknown as AppManifest[]
    assert.equal(visibleNotifications([row], apps).length, 1)
  })
  it('spells the shift the way the person reads the calendars', () => {
    assert.equal(toAppNotification(notice(), false).body, 'Thu 9/24 · 10P-8A · apply by 10:38 PM')
    const clock = toAppNotification(notice(), true).body
    assert.match(clock, /10:00 PM/)
    assert.match(clock, /8:00 AM/)
    assert.equal(spellShift('{shift} and {shift}', '8A-4P', false), '8A-4P and 8A-4P')
    assert.equal(spellShift('{shift}', '', false), 'a shift')
  })
  it('carries the weight as a tone, and nothing it does not know', () => {
    assert.equal(toAppNotification(notice(), false).tone, 'urgent')
    assert.equal(toAppNotification(notice({ tone: 'good' }), false).tone, 'good')
    assert.equal(toAppNotification(notice({ tone: 'loud' }), false).tone, undefined)
  })
  it('a frame is believed only when it has an id and words', () => {
    assert.equal(asServerNotice({ title: 'x' }), null)
    assert.equal(asServerNotice({ id: -3, title: 'x' }), null)
    assert.equal(asServerNotice(null), null)
    assert.equal(asServerNotice({ id: 5, title: 'x', priority: 'urgent!' })?.priority, 'normal')
    assert.equal(serverIdOf('srv-12'), 12)
    assert.equal(serverIdOf('n-local-1-abc'), null)
  })
  it('is fresh when the relay PUBLISHED it just now, whenever the thing itself happened', () => {
    assert.equal(isFresh({ published_at: iso(1000), at: iso(3_600_000) }, NOW), true)
    assert.equal(isFresh({ published_at: iso(NOTICE_FRESH_MS + 1000), at: '' }, NOW), false)
    assert.equal(isFresh({ published_at: '', at: '' }, NOW), false)
  })
})

describe('when a notice may interrupt the screen', () => {
  it('the first read of a session fills the bell and toasts nothing routine', async () => {
    answer = () => inbox([decided(), notice({ id: 40, priority: 'normal', tone: '' })], 44)
    await useNotificationStore.getState().fetchAll({ force: true })
    const s = useNotificationStore.getState()
    assert.equal(s.items.length, 2)
    assert.equal(s.loaded, true)
    assert.equal(s.seq, 44)
    assert.equal(useToastStore.getState().toasts.length, 0)
    assert.equal(calls[0].url, '/erp-lanes/notices')
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer tok-ann')
  })
  it('…but a call-off published minutes ago and still unread is pinned even on the first read', async () => {
    answer = () => inbox([notice(), decided()], 44)
    await useNotificationStore.getState().fetchAll({ force: true })
    const toasts = useToastStore.getState().toasts
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].urgent, true)
    assert.equal(toasts[0].key, 'srv-41')
  })
  it('a frame that arrives fresh and high toasts once, in the tone it carries', () => {
    onNoticeFrame(decided())
    onNoticeFrame(decided())
    const toasts = useToastStore.getState().toasts
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].type, 'success')
    assert.equal(toasts[0].urgent, false)
    assert.equal(toasts[0].action?.href, '/app/calendarbuilder/requests?tab=all')
    assert.equal(useNotificationStore.getState().items.length, 1)
  })
  it('a call-off frame is pinned once, blood red, and links where the reader acts', () => {
    onNoticeFrame(notice())
    onNoticeFrame(notice())
    const toasts = useToastStore.getState().toasts
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].urgent, true)
    assert.equal(toasts[0].type, 'danger')
    assert.equal(toasts[0].action?.href, '/app/calendarbuilder/requests?tab=me&ref=SPABC')
  })
  it('a stale or a normal notice lands in the bell without interrupting', () => {
    onNoticeFrame(notice({ id: 50, published_at: iso(NOTICE_FRESH_MS * 3) }))
    onNoticeFrame(notice({ id: 51, priority: 'normal' }))
    assert.equal(useToastStore.getState().toasts.length, 0)
    assert.equal(useNotificationStore.getState().items.length, 2)
  })
  it('a frame that is not a notice is ignored', () => {
    onNoticeFrame({ nonsense: true })
    assert.equal(useNotificationStore.getState().items.length, 0)
  })
})

describe('the roads — a beat whose number moved, a session that changed', () => {
  it('a beat past the bell reads only what is newer; a beat that did not move reads nothing', async () => {
    answer = () => inbox([notice({ id: 40, priority: 'normal', tone: '' })], 40)
    await useNotificationStore.getState().fetchAll({ force: true })
    calls = []
    onBeatSeq(40)
    onBeatSeq(null)
    onBeatSeq(undefined)
    assert.equal(calls.length, 0)
    answer = () => inbox([notice({ id: 42 })], 42)
    onBeatSeq(42)
    await settle()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/erp-lanes/notices?since=40')
    assert.equal(useNotificationStore.getState().seq, 42)
    assert.deepEqual(useNotificationStore.getState().items.map((n) => n.id).sort(), ['srv-40', 'srv-42'])
    // a notice read back since the bell's last seq is an arrival: it may interrupt
    assert.equal(useToastStore.getState().toasts.length, 1)
  })
  it('a whole-bell read drops an invitation the relay no longer carries, and keeps what this tab raised', async () => {
    answer = () => inbox([notice({ id: 40 }), notice({ id: 41 })], 41)
    await useNotificationStore.getState().fetchAll({ force: true })
    useNotificationStore.getState().push({ type: 'system', title: 'local', body: '', priority: 'low' })
    answer = () => inbox([notice({ id: 41 })], 41)
    await useNotificationStore.getState().fetchAll({ force: true })
    const ids = useNotificationStore.getState().items.map((n) => n.id)
    assert.ok(!ids.includes('srv-40'))
    assert.ok(ids.includes('srv-41'))
    assert.ok(ids.some((id) => id.startsWith('n-local-')))
  })
  it('another session on this tab leaves nothing of the last person\'s bell', async () => {
    onSession('tok-ann')
    onNoticeFrame(notice())
    assert.equal(useNotificationStore.getState().items.length, 1)
    answer = () => inbox([], 3)
    onSession('tok-ben')
    assert.equal(useNotificationStore.getState().items.length, 0)
    await settle()
    assert.equal(useNotificationStore.getState().seq, 3)
    onSession(null)
    assert.equal(useNotificationStore.getState().loaded, false)
  })
})

describe('the marks and the honesty', () => {
  it('only the relay\'s own rows are posted, and a refused mark puts the dot back', async () => {
    onNoticeFrame(notice({ id: 60, priority: 'normal' }))
    useNotificationStore.getState().push({ type: 'system', title: 'local', body: '', priority: 'low' })
    answer = () => ({ status: 502, message: 'not marked' })
    useNotificationStore.getState().markAllRead()
    assert.equal(useNotificationStore.getState().items.every((n) => n.read), true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/erp-lanes/notices/read')
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { ids: [60], dismiss: false })
    await settle()
    await settle()
    const srv = useNotificationStore.getState().items.find((n) => n.id === 'srv-60')
    const local = useNotificationStore.getState().items.find((n) => n.id.startsWith('n-local-'))
    assert.equal(srv?.read, false)
    assert.equal(local?.read, true)
  })
  it('a cleared notice is cleared on the server, and comes back if the server refused', async () => {
    onNoticeFrame(notice({ id: 70, priority: 'normal' }))
    answer = () => ({ status: 200, data: { marked: 1 } })
    useNotificationStore.getState().dismiss(['srv-70'])
    assert.equal(useNotificationStore.getState().items.length, 0)
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { ids: [70], dismiss: true })
    onNoticeFrame(notice({ id: 71, priority: 'normal' }))
    answer = () => ({ status: 502, message: 'away' })
    useNotificationStore.getState().dismiss(['srv-71'])
    await settle()
    await settle()
    assert.deepEqual(useNotificationStore.getState().items.map((n) => n.id), ['srv-71'])
  })
  it('a bell that could not be read says why, keeps what it had, and is not "loaded"', async () => {
    onNoticeFrame(notice({ id: 80, priority: 'normal' }))
    answer = () => ({ status: 502, message: 'notices unreadable (OperationalError)' })
    await useNotificationStore.getState().fetchAll({ force: true })
    const s = useNotificationStore.getState()
    assert.equal(s.inboxError, 'notices unreadable (OperationalError)')
    assert.equal(s.loaded, false)
    assert.deepEqual(s.items.map((n) => n.id), ['srv-80'])
  })
  it('signed out, the bell does not ask the relay at all', async () => {
    useAuthStore.setState({ token: null } as never)
    await useNotificationStore.getState().fetchAll({ force: true })
    assert.equal(calls.length, 0)
    assert.equal(useNotificationStore.getState().inboxError, 'not signed in')
  })
})
