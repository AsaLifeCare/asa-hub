/**
 * What interrupts the screen: pinned urgent toasts, held notices, the OS copy, the one-time question,
 * frame routing and ref-named cells. The bell itself is notices.test.ts. Network answered at `fetch`.
 */
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import {
  NOTICE_FRESH_MS, asServerNotice, heldOf, noticeAlert, type ServerNotice,
} from '@/lib/noticesApi'
import { onHiddenBeat, onNoticeFrame } from '@/lib/notices'
import {
  OS_ASK_PREFIX, answerOf, askOsPermission, closeOsNotices, osAskKey, osPermission, recordAnswer,
  shouldOfferAsk, showOsNotice,
} from '@/lib/osNotify'
import { CHAT_FRAME_KINDS, frameRoute } from '@/lib/streamFrames'
import { lookingAtConversation, routeNow } from '@/lib/routeNow'
import { DEFAULT_NOTIF_PREFS, saveNotifPrefs } from '@/lib/notifPrefs'
import { useNotificationStore } from '@/stores/useNotificationStore'
import {
  ROUTINE_TOASTS_MAX, URGENT_TOASTS_MAX, useToastStore, type ToastItem,
} from '@/stores/useToastStore'
import { useUiPrefsStore } from '@/stores/useUiPrefsStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { ToastStacks } from '@/components/shell/Toasts'
import { stackOrder, urgentCorner } from '@/components/shell/toastLayout'
import { openShiftByRef, type Computed } from '@/pages/features/shifts/houseCalTypes'
import { appliedFor, refNoLongerOpen, safeRef, type Feed } from '@/pages/features/shifts/requestsLogic'

const ROOT = resolve(process.cwd())
const source = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

const NOW = Date.now()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const later = (msAhead: number) => new Date(NOW + msAhead).toISOString()

const notice = (over: Partial<ServerNotice> = {}): ServerNotice => ({
  id: 41, kind: 'call_off', role: 'invited', at: iso(60_000), published_at: iso(30_000),
  title: 'Open shift at 48TH (B) — somebody called off', body: 'Thu 9/24 · {shift} · apply by 10:38 PM',
  shift: '10P-8A', house: '48TH (B)', col_iso: '2026-09-24', ref: 'SPABC',
  href: '/app/calendarbuilder/requests?tab=me&ref=SPABC', priority: 'high', tone: 'urgent', read: false,
  expires_at: '', held: false,
  ...over,
})

/** A high notice that is not a call-off or an open shift. */
const decided = (over: Partial<ServerNotice> = {}): ServerNotice => notice({
  id: 90, kind: 'decided', role: 'theirs', title: 'You have the shift at 48TH (B)',
  body: 'Thu 9/24 · {shift} · approved by Hal', tone: 'good', href: '/app/calendarbuilder/requests?tab=all',
  ...over,
})

/* ---------- the ground: fetch, the Notification API, a document ---------- */

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []
let answer: (url: string) => { status: number; message?: string; data?: unknown } = () => ({ status: 200, data: {} })

function stubFetch(): void {
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    // only the notice doors are recorded; anything else is refused
    if (String(url).startsWith('/erp-lanes/')) calls.push({ url, init })
    const env = String(url).startsWith('/erp-lanes/') ? answer(url) : { status: 503, message: 'not here' }
    return { ok: true, status: 200, json: async () => env } as unknown as Response
  }
}

const inbox = (notices: ServerNotice[], seq: number) =>
  ({ status: 200, data: { notices, unread: notices.filter((n) => !n.read).length, seq, since: 0, me: 'Ann Roe' } })

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static made: FakeNotification[] = []
  static requestPermission(cb?: (p: NotificationPermission) => void): Promise<NotificationPermission> {
    FakeNotification.permission = FakeNotification.nextAnswer
    cb?.(FakeNotification.permission)
    return Promise.resolve(FakeNotification.permission)
  }
  static nextAnswer: NotificationPermission = 'granted'
  onclick: (() => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  title: string
  opts: NotificationOptions & { requireInteraction?: boolean }
  constructor(title: string, opts: NotificationOptions & { requireInteraction?: boolean }) {
    this.title = title
    this.opts = opts
    FakeNotification.made.push(this)
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
}

// node 18 keeps Web Crypto on its own module
if (!(globalThis as { crypto?: unknown }).crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
}

// motion cards listen for resize; node's global window has no event hooks
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const doc = document as unknown as { visibilityState: string }
const g = globalThis as unknown as { Notification?: unknown; location?: { hash: string } }

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }

beforeEach(() => {
  calls = []
  answer = () => ({ status: 200, data: {} })
  stubFetch()
  useAuthStore.setState({ token: 'tok-ann', user: { id: 'u-ann' } } as never)
  saveNotifPrefs(DEFAULT_NOTIF_PREFS)
  useNotificationStore.getState().reset()
  useToastStore.setState({ toasts: [] })
  useUiPrefsStore.setState({ toastPosition: 'bottom-right' })
  FakeNotification.permission = 'default'
  FakeNotification.made = []
  g.Notification = FakeNotification
  g.location = { hash: '' }
  doc.visibilityState = 'visible'
})

afterEach(() => {
  closeOsNotices(() => true)
  delete g.Notification
  doc.visibilityState = 'visible'
})

/* ======================================================================== */

describe('which notices interrupt, and how', () => {
  it('a call-off or an open shift is pinned; other high notices toast; normal ones never interrupt', () => {
    assert.equal(noticeAlert(notice(), NOW, true), 'pin')
    assert.equal(noticeAlert(notice({ kind: 'open_shift' }), NOW, true), 'pin')
    assert.equal(noticeAlert(decided(), NOW, true), 'toast')
    assert.equal(noticeAlert(notice({ priority: 'normal', tone: '' }), NOW, true), null)
    assert.equal(noticeAlert(notice({ read: true }), NOW, true), null)
  })
  it('the in-app toast switch silences the routine ones and NEVER a call-off', () => {
    assert.equal(noticeAlert(decided(), NOW, false), null)
    assert.equal(noticeAlert(notice(), NOW, false), 'pin')
  })
  it('an invitation still open is pinned for somebody who arrives an hour into its window…', () => {
    const open = notice({ published_at: iso(60 * 60_000), expires_at: later(60 * 60_000) })
    assert.equal(noticeAlert(open, NOW, true), 'pin')
  })
  it('…and not once its window has closed, however fresh', () => {
    assert.equal(noticeAlert(notice({ expires_at: iso(1000) }), NOW, true), null)
  })
  it('a decider\'s call-off with no end of its own interrupts only while it is fresh', () => {
    const stale = notice({ role: 'decider', published_at: iso(NOTICE_FRESH_MS * 2), expires_at: '' })
    assert.equal(noticeAlert(stale, NOW, true), null)
    assert.equal(noticeAlert({ ...stale, published_at: iso(5000) }, NOW, true), 'pin')
  })
  it('a notice that is urgent only in name (a no-call is urgent in tone, but not a call-off) toasts', () => {
    assert.equal(noticeAlert(notice({ kind: 'no_call_no_show', role: 'decider' }), NOW, true), 'toast')
  })
})

describe('the red toast on the right', () => {
  it('a call-off frame is pinned, blood red, sticky, and tied to its bell row', () => {
    onNoticeFrame(notice())
    const [t] = useToastStore.getState().toasts
    assert.equal(t.urgent, true)
    assert.equal(t.type, 'danger')
    assert.equal(t.key, 'srv-41')
    assert.equal(t.expiresAt, undefined)
  })
  it('with the in-app toasts switched off, the call-off is still pinned and the rest only lands in the bell', () => {
    saveNotifPrefs({ ...DEFAULT_NOTIF_PREFS, toasts: false })
    onNoticeFrame(decided())
    onNoticeFrame(notice())
    const toasts = useToastStore.getState().toasts
    assert.deepEqual(toasts.map((t) => t.key), ['srv-41'])
    assert.equal(useNotificationStore.getState().items.length, 2)
  })
  it('an invitation carries the minute its window closes, so the toast leaves then', () => {
    const closes = later(10 * 60_000)
    onNoticeFrame(notice({ kind: 'open_shift', expires_at: closes }))
    assert.equal(useToastStore.getState().toasts[0].expiresAt, Date.parse(closes))
  })
  it('an invitation still open is pinned on the first read of a session, however long ago it was published', async () => {
    answer = () => inbox([notice({ published_at: iso(90 * 60_000), expires_at: later(3 * 3_600_000) })], 41)
    await useNotificationStore.getState().fetchAll({ force: true })
    assert.equal(useToastStore.getState().toasts.length, 1)
    assert.equal(useToastStore.getState().toasts[0].urgent, true)
  })
  it('reading it in the bell takes the pinned toast away; so does the relay no longer carrying it', async () => {
    onNoticeFrame(notice())
    useNotificationStore.getState().markRead('srv-41')
    assert.equal(useToastStore.getState().toasts.length, 0)
    onNoticeFrame(notice({ id: 42 }))
    answer = () => inbox([], 42)
    useNotificationStore.setState({ loaded: true })
    await useNotificationStore.getState().fetchAll({ force: true })
    assert.equal(useToastStore.getState().toasts.length, 0)
  })
  it('a burst of routine toasts never pushes an unanswered call-off off the screen', () => {
    onNoticeFrame(notice())
    for (let i = 0; i < 10; i++) useToastStore.getState().push({ type: 'success', title: `Saved ${i}` })
    const toasts = useToastStore.getState().toasts
    assert.equal(toasts.filter((t) => t.urgent).length, 1)
    assert.equal(toasts.filter((t) => !t.urgent).length, ROUTINE_TOASTS_MAX)
    for (let i = 0; i < 9; i++) useToastStore.getState().push({ type: 'danger', title: `c${i}`, urgent: true, key: `srv-${100 + i}` })
    assert.equal(useToastStore.getState().toasts.filter((t) => t.urgent).length, URGENT_TOASTS_MAX)
  })
  it('one subject is one toast', () => {
    const push = useToastStore.getState().push
    const a = push({ type: 'danger', title: 'x', urgent: true, key: 'srv-7' })
    const b = push({ type: 'danger', title: 'x again', urgent: true, key: 'srv-7' })
    assert.equal(a, b)
    assert.equal(useToastStore.getState().toasts.length, 1)
  })
  it('the urgent stack pins to the RIGHT on the person\'s own edge, whatever corner they chose', () => {
    assert.equal(urgentCorner('bottom-left'), 'bottom-right')
    assert.equal(urgentCorner('top-left'), 'top-right')
    assert.equal(urgentCorner('top-right'), 'top-right')
    assert.equal(urgentCorner('bottom-right'), 'bottom-right')
  })
  it('in a shared column the urgent ones sit nearest the edge', () => {
    const r = { id: 'r', type: 'info', title: 'r' } as ToastItem
    const u = { id: 'u', type: 'danger', title: 'u', urgent: true } as ToastItem
    assert.deepEqual(stackOrder([u, r], 'bottom-right').map((t) => t.id), ['r', 'u'])
    assert.deepEqual(stackOrder([u, r], 'top-right').map((t) => t.id), ['u', 'r'])
  })

  /** each corner's html from the two stores, read here as <Toasts/> does */
  function drawn(): Record<string, string> {
    const html = renderToString(
      <MemoryRouter>
        <ToastStacks toasts={useToastStore.getState().toasts} position={useUiPrefsStore.getState().toastPosition} />
      </MemoryRouter>,
    )
    const out: Record<string, string> = {}
    const parts = html.split('data-toast-corner="').slice(1)
    for (const p of parts) out[p.slice(0, p.indexOf('"'))] = p
    return out
  }

  it('drawn: with the corner on the LEFT, the call-off is on the right and the routine toast stays left', () => {
    useUiPrefsStore.setState({ toastPosition: 'bottom-left' })
    useToastStore.getState().push({ type: 'success', title: 'Saved the cell' })
    onNoticeFrame(notice())
    const stacks = drawn()
    assert.deepEqual(Object.keys(stacks).sort(), ['bottom-left', 'bottom-right'])
    assert.match(stacks['bottom-right'], /data-urgent-toast/)
    assert.match(stacks['bottom-right'], /role="alert"/)
    assert.match(stacks['bottom-right'], /#8b0000/)
    assert.match(stacks['bottom-right'], /somebody called off/)
    assert.doesNotMatch(stacks['bottom-left'], /data-urgent-toast/)
    assert.match(stacks['bottom-left'], /Saved the cell/)
  })
  it('drawn: with the corner already on the right, one column', () => {
    onNoticeFrame(notice())
    const stacks = drawn()
    assert.deepEqual(Object.keys(stacks), ['bottom-right'])
    assert.match(stacks['bottom-right'], /data-urgent-toast/)
  })
  it('drawn: a top corner on the left pins the call-off top-right', () => {
    useUiPrefsStore.setState({ toastPosition: 'top-left' })
    onNoticeFrame(notice())
    const stacks = drawn()
    assert.match(stacks['top-right'], /data-urgent-toast/)
    assert.doesNotMatch(stacks['top-left'], /data-urgent-toast/)
  })
  it('the shell draws exactly these stacks from the person\'s toasts and corner; only a routine card keeps a timer', () => {
    const src = source('src/components/shell/Toasts.tsx')
    assert.match(src, /export default function Toasts\(\) \{\s*const toasts = useToastStore\(\(s\) => s\.toasts\)\s*const position = useUiPrefsStore\(\(s\) => s\.toastPosition\)\s*return <ToastStacks toasts=\{toasts\} position=\{position\} \/>/)
    const urgent = src.slice(src.indexOf('function UrgentCard'), src.indexOf('function Stack'))
    assert.doesNotMatch(urgent, /setTimeout\(\(\) => dismiss\(t\.id\), 5000\)/)
    assert.match(urgent, /if \(!t\.expiresAt\) return/)
  })
})

describe('what the relay holds back is never drawn', () => {
  it('a held frame never enters the bell, never toasts, never reaches the operating system', () => {
    FakeNotification.permission = 'granted'
    doc.visibilityState = 'hidden'
    onNoticeFrame(notice({ held: true }))
    assert.equal(useNotificationStore.getState().items.length, 0)
    assert.equal(useToastStore.getState().toasts.length, 0)
    assert.equal(FakeNotification.made.length, 0)
  })
  it('a row already on screen that the relay now holds leaves, with its toast', async () => {
    onNoticeFrame(notice())
    assert.equal(useToastStore.getState().toasts.length, 1)
    answer = () => inbox([notice({ held: true })], 41)
    useNotificationStore.setState({ loaded: true })
    await useNotificationStore.getState().refreshInbox()
    assert.equal(useNotificationStore.getState().items.length, 0)
    assert.equal(useToastStore.getState().toasts.length, 0)
  })
  it('the mark is believed in any form the relay may write, and anything not plainly "no" counts as held', () => {
    assert.equal(asServerNotice({ id: 3, title: 'x', held: true })?.held, true)
    assert.equal(asServerNotice({ id: 3, title: 'x', held: 'test mode' })?.held, true)
    assert.equal(asServerNotice({ id: 3, title: 'x', held: false })?.held, false)
    assert.equal(asServerNotice({ id: 3, title: 'x' })?.held, false)
    assert.equal(heldOf('false'), false)
    assert.equal(heldOf(1), true)
    assert.equal(noticeAlert(notice({ held: true }), NOW, true), null)
  })
})

describe('the operating system, for a tab nobody is looking at', () => {
  it('a hidden tab with permission shows the call-off once, tagged by its notice, and it stays', () => {
    FakeNotification.permission = 'granted'
    doc.visibilityState = 'hidden'
    onNoticeFrame(notice())
    onNoticeFrame(notice())
    assert.equal(FakeNotification.made.length, 1)
    const [n] = FakeNotification.made
    assert.equal(n.opts.tag, 'srv-41')
    assert.equal(n.opts.requireInteraction, true)
    assert.match(n.title, /somebody called off/)
    assert.match(String(n.opts.body), /10P-8A/)
  })
  it('a tab somebody is looking at gets the toast only; no permission means no copy either', () => {
    FakeNotification.permission = 'granted'
    onNoticeFrame(notice())
    assert.equal(FakeNotification.made.length, 0)
    FakeNotification.permission = 'default'
    doc.visibilityState = 'hidden'
    onNoticeFrame(notice({ id: 43 }))
    assert.equal(FakeNotification.made.length, 0)
  })
  it('a click lands on the route after the `#` and reads the notice', () => {
    FakeNotification.permission = 'granted'
    doc.visibilityState = 'hidden'
    onNoticeFrame(notice())
    FakeNotification.made[0].onclick?.()
    assert.equal(g.location?.hash, '#/app/calendarbuilder/requests?tab=me&ref=SPABC')
    assert.equal(useNotificationStore.getState().items.find((n) => n.id === 'srv-41')?.read, true)
    assert.equal(FakeNotification.made[0].closed, true)
  })
  it('reading it in the bell closes the operating system\'s copy; a new session closes them all', () => {
    FakeNotification.permission = 'granted'
    doc.visibilityState = 'hidden'
    onNoticeFrame(notice())
    onNoticeFrame(notice({ id: 44 }))
    useNotificationStore.getState().markRead('srv-41')
    assert.deepEqual(FakeNotification.made.map((n) => n.closed), [true, false])
    useNotificationStore.getState().reset()
    assert.deepEqual(FakeNotification.made.map((n) => n.closed), [true, true])
  })
  it('a copy the quiet window holds keeps its bell row and its toast, and never reaches the operating system', () => {
    FakeNotification.permission = 'granted'
    doc.visibilityState = 'hidden'
    onNoticeFrame(notice({ quiet: true }))
    assert.equal(FakeNotification.made.length, 0)
    assert.equal(useToastStore.getState().toasts.length, 1)
    assert.equal(useNotificationStore.getState().items.length, 1)
    assert.equal(asServerNotice({ id: 3, title: 'x', quiet: true })?.quiet, true)
    assert.equal(asServerNotice({ id: 3, title: 'x', quiet: 'yes' })?.quiet, true)
    assert.equal(asServerNotice({ id: 3, title: 'x' })?.quiet, false)
    // the same notice by day reaches it as before
    onNoticeFrame(notice({ id: 46 }))
    assert.equal(FakeNotification.made.length, 1)
  })
  it('a browser without the API is "unsupported" and shows nothing', () => {
    delete g.Notification
    assert.equal(osPermission(), 'unsupported')
    assert.equal(showOsNotice({ key: 'k', title: 't', body: '', urgent: false }, { force: true }), false)
  })
  it('a hidden tab whose stream is down still reads what is new — only when the OS may speak for it', async () => {
    answer = () => inbox([], 40)
    await useNotificationStore.getState().fetchAll({ force: true })
    calls = []
    onHiddenBeat(false)
    assert.equal(calls.length, 0, 'no permission: nothing to show, nothing read')
    FakeNotification.permission = 'granted'
    onHiddenBeat(true)
    assert.equal(calls.length, 0, 'a live stream brings the frames itself')
    answer = () => inbox([notice({ id: 45 })], 45)
    doc.visibilityState = 'hidden'
    onHiddenBeat(false)
    await settle()
    assert.deepEqual(calls.map((c) => c.url), ['/erp-lanes/notices?since=40'])
    assert.equal(FakeNotification.made.length, 1)
  })
})

describe('a session that changes under a read', () => {
  it('a bell read still in flight when the session changes never lands in the next person\'s bell', async () => {
    let release: (v: unknown) => void = () => {}
    const pending = new Promise((r) => { release = r })
    ;(globalThis as { fetch: unknown }).fetch = async (url: string) => {
      calls.push({ url })
      await pending
      return { ok: true, status: 200, json: async () => inbox(
        [notice({ published_at: iso(1000), expires_at: later(3_600_000) })], 41) } as unknown as Response
    }
    FakeNotification.permission = 'granted'
    doc.visibilityState = 'hidden'
    const read = useNotificationStore.getState().fetchAll({ force: true })
    useAuthStore.setState({ token: 'tok-ben', user: { id: 'u-ben' } } as never)
    useNotificationStore.getState().reset()
    // the next person's read is their own, never the last person's promise
    stubFetch()
    answer = () => inbox([], 50)
    await useNotificationStore.getState().fetchAll({ force: true })
    release(null)
    await read
    await settle()
    assert.equal(useNotificationStore.getState().items.length, 0)
    assert.equal(useToastStore.getState().toasts.length, 0)
    assert.equal(FakeNotification.made.length, 0)
    assert.equal(useNotificationStore.getState().seq, 50)
  })
  it('a refused clear that answers after the session changed does not put the last person\'s rows back', async () => {
    onNoticeFrame(decided())
    let refuse: () => void = () => {}
    const pending = new Promise<void>((r) => { refuse = r })
    ;(globalThis as { fetch: unknown }).fetch = async () => {
      await pending
      return { ok: true, status: 200, json: async () => ({ status: 502, message: 'no' }) } as unknown as Response
    }
    useNotificationStore.getState().dismiss(['srv-90'])
    useNotificationStore.getState().reset()
    useToastStore.setState({ toasts: [] })
    refuse()
    await settle()
    assert.equal(useNotificationStore.getState().items.length, 0)
    assert.equal(useToastStore.getState().toasts.length, 0, 'no "Not cleared" for rows that were not theirs')
  })
})

describe('the one question, asked once per person', () => {
  const base = { uid: 'u-new', permission: 'default' as const, mustChangePassword: false, visiting: false, settled: true }
  it('is put only when there is a question left, after the password gate, in the person\'s own session', () => {
    assert.equal(shouldOfferAsk(base), true)
    assert.equal(shouldOfferAsk({ ...base, mustChangePassword: true }), false)
    assert.equal(shouldOfferAsk({ ...base, visiting: true }), false)
    assert.equal(shouldOfferAsk({ ...base, settled: false }), false, 'their answer from another device has not arrived yet')
    assert.equal(shouldOfferAsk({ ...base, permission: 'granted' }), false)
    assert.equal(shouldOfferAsk({ ...base, permission: 'denied' }), false)
    assert.equal(shouldOfferAsk({ ...base, permission: 'unsupported' }), false)
    assert.equal(shouldOfferAsk({ ...base, uid: '' }), false)
  })
  it('any answer — allowed, blocked or "Not now" — is written down per person and never asked again', () => {
    useAuthStore.setState({ token: null } as never)
    for (const [uid, said] of [['u-a', 'granted'], ['u-b', 'denied'], ['u-c', 'later']] as const) {
      assert.equal(answerOf(uid), '')
      recordAnswer(uid, said, '2026-01-01T00:00:00Z')
      assert.equal(answerOf(uid), said)
      assert.equal(shouldOfferAsk({ ...base, uid }), false)
    }
    // one person's answer is not another's
    assert.equal(shouldOfferAsk({ ...base, uid: 'u-d' }), true)
  })
  it('the browser\'s answer is read back whichever road it takes — the promise or an old Safari\'s callback', async () => {
    FakeNotification.nextAnswer = 'denied'
    assert.equal(await askOsPermission(), 'denied')
    FakeNotification.nextAnswer = 'granted'
    assert.equal(await askOsPermission(), 'granted')
    assert.equal(osPermission(), 'granted')
    delete g.Notification
    assert.equal(await askOsPermission(), 'unsupported')
  })
  it('the answers ride the preferences that follow a person to every device — each person\'s own key only', () => {
    const sync = source('src/lib/prefsSync.ts')
    assert.match(sync, new RegExp(`OWN_PREFIX_KEYS = \\['${OS_ASK_PREFIX}'\\]`))
    // never as one shared key that a whole browser's accounts are written into
    assert.doesNotMatch(sync, /'asa-os-notify-asked'[,\]]/)
    assert.match(sync, /localStorage\.getItem\(prefix \+ uid\)/)
  })
  it('one person\'s answer is kept under their own key and names nobody else', () => {
    recordAnswer('u-one', 'granted', '2026-01-01T00:00:00Z')
    recordAnswer('u-two', 'denied', '2026-01-01T00:00:00Z')
    const one = localStorage.getItem(osAskKey('u-one')) ?? ''
    assert.match(one, /granted/)
    assert.doesNotMatch(one, /u-two|denied/)
    assert.doesNotMatch(localStorage.getItem(osAskKey('u-two')) ?? '', /u-one|granted/)
    assert.equal(localStorage.getItem('asa-os-notify-asked'), null)
  })
  it('the browser\'s own question is put only from a click, never on its own', () => {
    const card = source('src/features/auth/NotificationAsk.tsx')
    assert.doesNotMatch(card, /useEffect/)
    assert.equal(card.match(/askOsPermission\(\)/g)?.length, 1)
    assert.match(card, /const allow = async \(\) => \{\s*setBusy\(true\)\s*const got = await askOsPermission\(\)/)
    assert.match(card, /onClick=\{\(\) => void allow\(\)\}/)
  })
  it('the card comes after the password gate and the tour, in the shell every account opens', () => {
    const layout = source('src/components/Layout.tsx')
    const gate = layout.indexOf('<MustChangePasswordGate />')
    const tour = layout.indexOf('<FirstLoginTour />')
    const ask = layout.indexOf('<NotificationAsk />')
    assert.ok(gate > 0 && tour > gate && ask > tour, `${gate} ${tour} ${ask}`)
  })
})

describe('the stream and the route', () => {
  it('only chat frames are chat; a notice, a refusal or a kind this bundle does not know never reach the listeners', () => {
    assert.equal(frameRoute({ kind: 'notice' }), 'notice')
    assert.equal(frameRoute({ kind: 'write_refused' }), 'refused')
    assert.equal(frameRoute({ kind: 'chatSend' }), 'chat')
    assert.equal(frameRoute({ kind: 'chatReact' }), 'chat')
    assert.equal(frameRoute({ kind: 'something_newer' }), 'ignore')
    assert.equal(frameRoute(null), 'ignore')
    assert.deepEqual([...CHAT_FRAME_KINDS].sort(), ['chatReact', 'chatSend'])
  })
  it('the shell hands a notice to the bell and skips every non-chat frame BEFORE the listeners fan out', () => {
    const chat = source('src/lib/chatPresence.ts')
    const fan = chat.indexOf('for (const fn of listeners) fn(msg)')
    assert.ok(chat.indexOf("route === 'notice'") > 0 && chat.indexOf("route === 'notice'") < fan)
    assert.ok(chat.indexOf("if (route !== 'chat') continue") > 0 && chat.indexOf("if (route !== 'chat') continue") < fan)
    assert.ok(chat.indexOf('onNoticeFrame(msg.notice)') > 0 && chat.indexOf('onNoticeFrame(msg.notice)') < fan)
    assert.doesNotMatch(chat, /window\.location\.pathname\.startsWith\('\/app\/chat\/'\)/)
  })
  it('the route is read after the `#` — where `location.pathname` is `/` on every screen', () => {
    const loc = { hash: '#/app/chat/messages?with=u1', pathname: '/', search: '' }
    assert.deepEqual(routeNow(loc), { pathname: '/app/chat/messages', search: '?with=u1' })
    assert.equal(lookingAtConversation('u1', undefined, routeNow(loc)), true)
    assert.equal(lookingAtConversation('u2', undefined, routeNow(loc)), false)
    // the check the shell used to make, against the same address, never matched
    assert.equal(loc.pathname.startsWith('/app/chat/'), false)
    assert.deepEqual(routeNow({ hash: '', pathname: '/app/x', search: '?a=1' }), { pathname: '/app/x', search: '?a=1' })
  })
  it('the chat screen, when it is up, says which conversation is open — a click never reaches the address', () => {
    const route = routeNow({ hash: '#/app/chat/messages?with=u1', pathname: '/', search: '' })
    assert.equal(lookingAtConversation('u3', 'u3', route), true)
    assert.equal(lookingAtConversation('u1', null, route), false)
    assert.equal(lookingAtConversation('', 'u3', route), false)
  })
})

describe('where a click on a notice lands', () => {
  it('the page finds the shift among the grid\'s own open shifts by its ref — the keyed ref is never worked out here', () => {
    const computed = { open_shifts: [{ ref: 'SP16E30015E5', open_row: 'OPEN · call-off', col_iso: '2026-09-23' }] } as unknown as Computed
    assert.equal(openShiftByRef(computed, 'sp16e30015e5')?.col_iso, '2026-09-23')
    assert.equal(openShiftByRef(computed, 'SP0000000000'), undefined)
    assert.equal(openShiftByRef({ open_shifts: [] } as unknown as Computed, 'SP16E30015E5'), undefined,
      'a grid without that shift finds nothing')
    assert.equal(openShiftByRef(null, 'SP16E30015E5'), undefined)
  })
  it('House Calendars opens the panel from the ref, never from a row in the address', () => {
    const page = source('src/pages/features/calendarbuilder/LiveView.tsx')
    assert.match(page, /params\.get\('ref'\)/)
    assert.match(page, /openShiftByRef\(grid\.computed, wantRef\)/)
    // no ref hashing or ref-to-row table in the bundle
    assert.doesNotMatch(page, /crypto\.subtle|poolRef|pool_refs/)
    assert.doesNotMatch(source('server/snapshot_service.py'), /pool_refs/)
  })
  it('a cell taken elsewhere is re-read on the relay\'s ring, on every screen that shows one', () => {
    for (const path of ['src/pages/features/calendarbuilder/LiveView.tsx',
      'src/pages/features/shifts/ShiftRequestsPage.tsx', 'src/pages/features/shifts/useOpenShifts.ts']) {
      assert.match(source(path), /onLiveEvent\(HOUSECAL_LIVE_EVENT, /, path)
    }
    assert.match(source('src/pages/features/smartcomms/OpenShiftsCard.tsx'), /useOpenShifts\(\)/)
    assert.match(source('server/snapshot_service.py'), /HOUSECAL_EVENT = "housecal"/)
    assert.match(source('src/pages/features/shifts/houseCalTypes.ts'), /HOUSECAL_LIVE_EVENT = 'housecal'/)
  })
  it('Requests rings the row a notice names, and says when the invitation has ended', () => {
    assert.equal(safeRef('SP16E30015E5'), 'SP16E30015E5')
    assert.equal(safeRef('"]<img>'), '')
    assert.equal(safeRef(null), '')
    const feed = { available: [{ ref: 'SP1' }] } as unknown as Feed
    assert.equal(refNoLongerOpen(feed, 'me', 'SP2'), true)
    assert.equal(refNoLongerOpen(feed, 'me', 'SP1'), false)
    assert.equal(refNoLongerOpen(feed, 'calloffs', 'SP2'), false)
    assert.equal(refNoLongerOpen(null, 'me', 'SP2'), false)
  })
  it('the person who just applied from the notice is told they applied — not that it is no longer open', () => {
    const row = { ref: 'SP2', mine: true, kind: 'call_off', state: 'applied' }
    const feed = { available: [{ ref: 'SP1' }], rows: [row] } as unknown as Feed
    assert.equal(appliedFor(feed, 'SP2'), true)
    assert.equal(refNoLongerOpen(feed, 'me', 'SP2'), false)
    const lost = { ...feed, rows: [{ ...row, state: 'not_chosen' }] } as unknown as Feed
    assert.equal(appliedFor(lost, 'SP2'), false)
    assert.equal(refNoLongerOpen(lost, 'me', 'SP2'), true)
    const theirs = { ...feed, rows: [{ ...row, mine: false }] } as unknown as Feed
    assert.equal(appliedFor(theirs, 'SP2'), false, 'somebody else\'s application is not mine')
    const page = source('src/pages/features/shifts/ShiftRequestsPage.tsx')
    assert.match(page, /useNotificationStore\.getState\(\)\.fetchAll\(\{ force: true \}\)/)
  })
  it('the Requests tab follows the address, so a notice clicked on an open screen still lands', () => {
    const page = source('src/pages/features/shifts/ShiftRequestsPage.tsx')
    assert.match(page, /const tab = params\.get\('tab'\) \|\| 'me'/)
    assert.doesNotMatch(page, /useState\(params\.get\('tab'\)/)
  })
})
