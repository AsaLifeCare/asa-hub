/**
 * Web push, browser side (lib/webPush, public/sw.js, osNotify's worker copy, the bell's `held`):
 * subscribing, letting go, the worker, test mode. The relay side is tools/test-web-push.py.
 */
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { readInbox, type ServerNotice } from '@/lib/noticesApi'
import { PAUSED_RECHECK_MS, onBeatSeq, onNoticeFrame } from '@/lib/notices'
import { closeWorkerNotices, setOsWorker, showOsNotice } from '@/lib/osNotify'
import {
  PUSH_WORDS, dropPush, ensurePush, isAppleMobile, keyBytes, onPushSession, onWorkerMessage, pushBlocker,
  pushStatus, resetPushForTests, sameKey, takeOpenedNotice, type PushState,
} from '@/lib/webPush'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { useToastStore } from '@/stores/useToastStore'
import { useAuthStore } from '@/auth/useAuthStore'

const ROOT = resolve(process.cwd())
const source = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) }

/* ---------- the ground: fetch, a service worker, push, permission ---------- */

type Call = { url: string; init?: RequestInit; auth: string }
let calls: Call[] = []
let answer: (url: string, init?: RequestInit) => { status: number; message?: string; data?: unknown } =
  () => ({ status: 200, data: {} })

function stubFetch(): void {
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
    if (String(url).startsWith('/erp-lanes/')) calls.push({ url, init, auth })
    const env = String(url).startsWith('/erp-lanes/') ? answer(url, init) : { status: 503, message: 'not here' }
    return { ok: true, status: 200, json: async () => env } as unknown as Response
  }
}

// a P-256 point is 65 bytes starting 0x04; these are shapes, not keys
const KEY_A = Buffer.from([4, ...Array.from({ length: 64 }, (_, i) => i)]).toString('base64url')
const KEY_B = Buffer.from([4, ...Array.from({ length: 64 }, (_, i) => 200 - i)]).toString('base64url')

class FakeSub {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer; userVisibleOnly: boolean }
  unsubscribed = false
  constructor(endpoint: string, key: string) {
    this.endpoint = endpoint
    this.options = { applicationServerKey: new Uint8Array(Buffer.from(key, 'base64url')).buffer, userVisibleOnly: true }
  }
  toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } } }
  // as a browser does: a dropped subscription is no longer this browser's
  async unsubscribe() {
    this.unsubscribed = true
    if (worker.current === this) worker.current = null
    return true
  }
}

type Shown = { title: string; opts: NotificationOptions & { data?: unknown } }
const worker = {
  current: null as FakeSub | null,
  made: 0,
  registered: [] as string[],
  shown: [] as Shown[],
  listed: [] as { tag: string; closed: boolean; close: () => void }[],
  listeners: [] as ((ev: { data: unknown }) => void)[],
}

const registration = {
  pushManager: {
    getSubscription: async () => worker.current,
    subscribe: async (opts: { applicationServerKey: Uint8Array }) => {
      worker.made += 1
      worker.current = new FakeSub(`https://push.example/${worker.made}`,
        Buffer.from(opts.applicationServerKey).toString('base64url'))
      return worker.current
    },
  },
  showNotification: async (title: string, opts: NotificationOptions) => { worker.shown.push({ title, opts }) },
  getNotifications: async () => worker.listed,
}

/** The registration, as the page's operating-system copy takes it. */
const asWorker = registration as unknown as Parameters<typeof setOsWorker>[0]

const g = globalThis as unknown as Record<string, unknown>
let permission: NotificationPermission = 'granted'

function installBrowser(opts: { push?: boolean; ua?: string; secure?: boolean; touch?: number } = {}): void {
  const nav: Record<string, unknown> = { userAgent: opts.ua ?? 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140', maxTouchPoints: opts.touch ?? 0 }
  if (opts.push !== false) {
    nav.serviceWorker = {
      register: async (url: string) => { worker.registered.push(url); return registration },
      getRegistration: async () => registration,
      addEventListener: (_t: string, fn: (ev: { data: unknown }) => void) => { worker.listeners.push(fn) },
    }
    g.PushManager = function PushManager() {}
  } else {
    delete g.PushManager
  }
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true })
  g.isSecureContext = opts.secure ?? true
  g.Notification = class {
    static get permission() { return permission }
    static requestPermission() { return Promise.resolve(permission) }
    constructor() { throw new TypeError('Illegal constructor') }
  }
}

const doc = document as unknown as { baseURI: string; visibilityState: string }

const notice = (over: Partial<ServerNotice> = {}): ServerNotice => ({
  id: 41, kind: 'call_off', role: 'invited', at: new Date().toISOString(), published_at: new Date().toISOString(),
  title: 'Open shift at 48TH (B) — somebody called off', body: 'Thu 9/24 · {shift}', shift: '10P-8A',
  house: '48TH (B)', col_iso: '2026-09-24', ref: 'SPABC', href: '/app/calendarbuilder/requests?tab=me&ref=SPABC',
  priority: 'high', tone: 'urgent', read: false, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  ...over,
})

const inbox = (notices: ServerNotice[], seq: number, held = '') =>
  ({ status: 200, data: { notices, unread: notices.length, seq, since: 0, me: 'Ann Roe', held } })

beforeEach(() => {
  calls = []
  answer = (url) => url === '/erp-lanes/push/key' ? { status: 200, data: { key: KEY_A, why: '' } } : { status: 200, data: { kept: true } }
  stubFetch()
  permission = 'granted'
  worker.current = null
  worker.made = 0
  worker.registered = []
  worker.shown = []
  worker.listed = []
  worker.listeners = []
  installBrowser()
  doc.baseURI = 'https://asamylife.asalifecare.com/'
  doc.visibilityState = 'hidden'
  g.location = { hash: '', pathname: '/', search: '' }
  g.history = { state: null, replaceState: (_s: unknown, _t: string, url: string) => {
    const at = url.indexOf('#'); (g.location as { hash: string }).hash = at === -1 ? '' : url.slice(at)
  } }
  resetPushForTests()
  useAuthStore.setState({ token: 'tok-ann', user: { id: 'u-ann' } } as never)
  useNotificationStore.getState().reset()
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  resetPushForTests()
  doc.visibilityState = 'visible'
})

/* ======================================================================== */

describe('what stops push before anybody is asked', () => {
  const base = { hasWorker: true, hasPush: true, secure: true, userAgent: 'Chrome', touchPoints: 0, standalone: false }
  it('a browser with a worker and push, on https, is ready', () => {
    assert.equal(pushBlocker(base), null)
  })
  it('an iPhone or iPad Safari TAB is told about the Home Screen — an iPad says it is a Mac', () => {
    const iphone = { ...base, hasPush: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari' }
    assert.equal(pushBlocker(iphone), 'home-screen')
    const ipad = { ...base, hasPush: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari', touchPoints: 5 }
    assert.equal(isAppleMobile(ipad), true)
    assert.equal(pushBlocker(ipad), 'home-screen')
    assert.equal(pushBlocker({ ...iphone, hasPush: true }), null, 'from the Home Screen it has push')
  })
  it('a desktop without push is unsupported, and http is insecure', () => {
    assert.equal(pushBlocker({ ...base, hasWorker: false }), 'unsupported')
    assert.equal(pushBlocker({ ...base, secure: false }), 'insecure')
  })
  it('the relay key is read as bytes, and a subscription knows which key made it', () => {
    assert.equal(keyBytes(KEY_A).length, 65)
    assert.equal(keyBytes(KEY_A)[0], 4)
    assert.equal(sameKey(new FakeSub('https://x', KEY_A), KEY_A), true)
    assert.equal(sameKey(new FakeSub('https://x', KEY_A), KEY_B), false)
  })
  it('Settings has words for every state, and says nothing where the permission line does', () => {
    const states: PushState[] = ['unsupported', 'home-screen', 'insecure', 'not-allowed', 'blocked', 'no-key', 'on', 'failed']
    for (const s of states) assert.equal(typeof PUSH_WORDS[s], 'string')
    assert.equal(PUSH_WORDS['not-allowed'], '')
    assert.match(PUSH_WORDS['home-screen'], /Add to Home Screen/)
  })
})

describe('subscribing this browser', () => {
  it('with permission, the key and a worker: subscribes with the relay key and hands the device over', async () => {
    const got = await ensurePush()
    assert.equal(got.state, 'on')
    assert.deepEqual(worker.registered, ['https://asamylife.asalifecare.com/sw.js'])
    assert.equal(worker.made, 1)
    assert.equal(Buffer.from(worker.current!.options.applicationServerKey).toString('base64url'), KEY_A)
    const post = calls.find((c) => c.url === '/erp-lanes/push/subscribe')
    assert.ok(post, 'the device reached the relay')
    const body = JSON.parse(String(post!.init?.body))
    assert.equal(body.subscription.endpoint, 'https://push.example/1')
    assert.equal('user_id' in body, false, 'the page never names whose device it is — the session does')
    assert.equal(post!.auth, 'Bearer tok-ann')
  })
  it('never asks anything of the person: without permission nothing is registered or sent', async () => {
    permission = 'default'
    assert.equal((await ensurePush()).state, 'not-allowed')
    permission = 'denied'
    assert.equal((await ensurePush()).state, 'blocked')
    assert.equal(worker.registered.length, 0)
    assert.equal(calls.length, 0)
  })
  it('a relay with no key: nothing is subscribed, and the state says why', async () => {
    answer = () => ({ status: 200, data: { key: null, why: 'no VAPID keys at /srv/secrets/webpush-vapid.json' } })
    const got = await ensurePush()
    assert.equal(got.state, 'no-key')
    assert.match(got.why, /VAPID/)
    assert.equal(worker.made, 0)
    assert.equal(calls.some((c) => c.url === '/erp-lanes/push/subscribe'), false)
  })
  it('a subscription made with another key is let go and made again with the relay key', async () => {
    const old = new FakeSub('https://push.example/old', KEY_B)
    worker.current = old
    assert.equal((await ensurePush()).state, 'on')
    assert.equal(old.unsubscribed, true)
    assert.equal(worker.made, 1)
  })
  it('"on" is said only when the relay KEPT the device', async () => {
    answer = (url) => url === '/erp-lanes/push/key'
      ? { status: 200, data: { key: KEY_A, why: '' } }
      : { status: 409, message: 'this relay has no push keys yet' }
    const got = await ensurePush()
    assert.equal(got.state, 'failed')
    assert.match(got.why, /no push keys/)
  })
  it('an iPhone Safari tab is told about the Home Screen and nothing is tried', async () => {
    installBrowser({ push: false, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari' })
    assert.equal((await ensurePush()).state, 'home-screen')
    assert.equal(calls.length, 0)
  })
})

describe('letting the device go', () => {
  it('a sign-out drops it on the relay, speaking for the session that ended, and in the browser', async () => {
    onPushSession('tok-ann')
    await settle()
    assert.equal(pushStatus().state, 'on')
    const sub = worker.current!
    calls = []
    useAuthStore.setState({ token: null, user: null } as never)
    onPushSession(null)
    await settle()
    const drop = calls.find((c) => c.url === '/erp-lanes/push/unsubscribe')
    assert.ok(drop)
    assert.equal(drop!.auth, 'Bearer tok-ann')
    assert.equal(JSON.parse(String(drop!.init?.body)).endpoint, sub.endpoint)
    assert.equal(sub.unsubscribed, true)
  })
  it('a token that only renewed for the same person keeps the device', async () => {
    onPushSession('tok-ann')
    await settle()
    const sub = worker.current!
    useAuthStore.setState({ token: 'tok-ann-2', user: { id: 'u-ann' } } as never)
    onPushSession('tok-ann-2')
    await settle()
    assert.equal(sub.unsubscribed, false)
    assert.equal(calls.some((c) => c.url === '/erp-lanes/push/unsubscribe'), false)
    assert.equal(calls.filter((c) => c.url === '/erp-lanes/push/subscribe').at(-1)?.auth, 'Bearer tok-ann-2')
  })
  it('another account signing in on this browser lets the last one go first, then keeps it for the new one', async () => {
    onPushSession('tok-ann')
    await settle()
    const annSub = worker.current!
    useAuthStore.setState({ token: 'tok-hal', user: { id: 'u-hal' } } as never)
    onPushSession('tok-hal')
    await settle()
    assert.equal(annSub.unsubscribed, true)
    const order = calls.map((c) => `${c.url}|${c.auth}`)
    const dropAt = order.indexOf('/erp-lanes/push/unsubscribe|Bearer tok-ann')
    const keepAt = order.lastIndexOf('/erp-lanes/push/subscribe|Bearer tok-hal')
    assert.ok(dropAt !== -1 && keepAt > dropAt, order.join(' → '))
    assert.notEqual(worker.current!.endpoint, annSub.endpoint)
  })
  it('dropPush without a token still ends the browser subscription', async () => {
    worker.current = new FakeSub('https://push.example/x', KEY_A)
    const sub = worker.current
    await dropPush()
    assert.equal(sub.unsubscribed, true)
    assert.equal(calls.length, 0)
  })
})

describe('a click on a notification, and a tab it opened', () => {
  it('lands on the platform route and marks the notice read', async () => {
    onWorkerMessage({ kind: 'hub-push-open', href: '/app/calendarbuilder/requests?tab=me&ref=SPABC', id: 41 })
    await settle()
    assert.equal((g.location as { hash: string }).hash, '#/app/calendarbuilder/requests?tab=me&ref=SPABC')
    const mark = calls.find((c) => c.url === '/erp-lanes/notices/read')
    assert.deepEqual(JSON.parse(String(mark?.init?.body)).ids, [41])
  })
  it('never lands on another site', () => {
    onWorkerMessage({ kind: 'hub-push-open', href: '//evil.example/x', id: 0 })
    assert.equal((g.location as { hash: string }).hash, '')
  })
  it('a tab the worker opened carries its notice, which is read once and taken out of the address', () => {
    (g.location as { hash: string }).hash = '#/app/calendarbuilder/requests?tab=me&notice=41'
    assert.equal(takeOpenedNotice(), 41)
    assert.equal((g.location as { hash: string }).hash, '#/app/calendarbuilder/requests?tab=me')
    assert.equal(takeOpenedNotice(), 0)
  })
})

describe('the page\'s own operating-system copy, through the worker', () => {
  it('a browser that refuses a page notification shows it through the worker, tagged by the notice', () => {
    permission = 'granted'
    setOsWorker(asWorker)
    const shown = showOsNotice({ key: 'srv-41', title: 'T', body: 'B', href: '/app/x', urgent: true })
    assert.equal(shown, true)
    assert.equal(worker.shown.length, 1)
    assert.equal(worker.shown[0].opts.tag, 'srv-41')
    assert.deepEqual(worker.shown[0].opts.data, { href: '/app/x', id: 41 })
  })
  it('reading a notice closes the push copy on this device — only the ones named, or all of them', async () => {
    setOsWorker(asWorker)
    const note = (tag: string) => { const n = { tag, closed: false, close: () => { n.closed = true } }; return n }
    worker.listed = [note('srv-1'), note('srv-2'), note('other')]
    closeWorkerNotices(new Set(['srv-1']))
    await settle()
    assert.deepEqual(worker.listed.map((n) => n.closed), [true, false, false])
    closeWorkerNotices('all')
    await settle()
    assert.deepEqual(worker.listed.map((n) => n.closed), [true, true, false], 'never a notification that is not a notice')
  })
})

describe('TEST MODE: the relay holds every notice, and nothing reaches the person', () => {
  it('a held answer is read as NO notices, whatever came with it', async () => {
    answer = () => inbox([notice()], 50, 'test mode')
    const box = await readInbox(0)
    assert.equal(box.held, 'test mode')
    assert.deepEqual(box.notices, [])
    assert.equal(box.unread, 0)
  })
  it('on a hidden tab, with permission and a worker, a held bell puts NOTHING on screen or through the OS', async () => {
    setOsWorker(asWorker)
    permission = 'granted'
    doc.visibilityState = 'hidden'
    answer = () => inbox([notice(), notice({ id: 42, kind: 'decided', tone: 'good' })], 50, 'test mode')
    await useNotificationStore.getState().fetchAll({ force: true })
    await useNotificationStore.getState().refreshInbox()
    await settle()
    assert.equal(useNotificationStore.getState().items.length, 0)
    assert.equal(useToastStore.getState().toasts.length, 0)
    assert.equal(worker.shown.length, 0, 'no operating-system notification')
    // the same notices, not held, would have reached the screen and the OS
    answer = () => inbox([notice()], 50)
    await useNotificationStore.getState().fetchAll({ force: true })
    await settle()
    assert.equal(worker.shown.length, 1)
  })
  it('the bell drops every company row, its toast and its operating-system copy, and says it is paused', async () => {
    setOsWorker(asWorker)
    answer = () => inbox([notice()], 50)
    await useNotificationStore.getState().fetchAll({ force: true })
    assert.equal(useNotificationStore.getState().items.length, 1)
    assert.equal(useToastStore.getState().toasts.length, 1, 'the open invitation was pinned')
    useNotificationStore.getState().push({ type: 'system', title: 'local', body: '', priority: 'normal' })
    const pushCopy = { tag: 'srv-41', closed: false, close: () => { pushCopy.closed = true } }
    worker.listed = [pushCopy]
    answer = () => inbox([notice()], 51, 'test mode')
    await useNotificationStore.getState().fetchAll({ force: true })
    await settle()
    const st = useNotificationStore.getState()
    assert.equal(st.paused, 'test mode')
    assert.deepEqual(st.items.map((n) => n.title), ['local'], 'only what this tab raised itself stays')
    assert.equal(useToastStore.getState().toasts.filter((t) => String(t.key).startsWith('srv-')).length, 0)
    assert.equal(pushCopy.closed, true, 'the push copy on this device leaves too')
  })
  it('a frame that arrives while paused is not drawn; the bell asks the relay instead', async () => {
    answer = () => inbox([], 51, 'test mode')
    await useNotificationStore.getState().fetchAll({ force: true })
    calls = []
    onNoticeFrame(notice({ id: 60 }))
    await settle()
    assert.equal(useNotificationStore.getState().items.length, 0)
    assert.equal(calls.filter((c) => c.url.startsWith('/erp-lanes/notices')).length, 1)
  })
  it('a paused bell asks again on the beat, and the first answer after the hold reads WHOLE', async () => {
    answer = () => inbox([], 51, 'test mode')
    await useNotificationStore.getState().fetchAll({ force: true })
    calls = []
    const readAt = useNotificationStore.getState().readAt
    onBeatSeq(51, readAt + 1000)
    await settle()
    assert.equal(calls.length, 0, 'not every beat — test mode going off stores no notice')
    answer = () => inbox([notice({ id: 45 })], 51)
    onBeatSeq(51, readAt + PAUSED_RECHECK_MS + 1)
    await settle()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/erp-lanes/notices', 'a whole read: what was held has ids below the last number')
    const st = useNotificationStore.getState()
    assert.equal(st.paused, '')
    assert.deepEqual(st.items.map((n) => n.id), ['srv-45'], 'still true, so it arrives with no second step')
  })
  it('the bell and the page say paused, never "all caught up", while held', () => {
    const panel = source('src/components/shell/NotificationPanel.tsx')
    assert.match(panel, /Company notices are paused/)
    assert.match(panel, /inboxError \|\| paused \? null/)
    const page = source('src/pages/NotificationsPage.tsx')
    assert.match(page, /Company notices are paused/)
    assert.match(page, /inboxError \|\| paused \? null/)
  })
})

/* ---------- the service worker itself, run as a worker runs it ---------- */

type Handler = (ev: Record<string, unknown>) => void

function loadWorker(clients: { url: string; visibilityState?: string; focused?: boolean }[] = []) {
  const handlers: Record<string, Handler> = {}
  const shown: Shown[] = []
  const posted: unknown[] = []
  const opened: string[] = []
  // the worker's objects come from another realm; compare values via JSON
  const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  const wins = clients.map((c) => ({
    ...c, focus: async () => {}, postMessage: (m: unknown) => { posted.push(plain(m)) },
  }))
  const self = {
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn },
    skipWaiting: () => {},
    registration: {
      scope: 'https://asamylife.asalifecare.com/',
      showNotification: async (title: string, opts: NotificationOptions) => { shown.push({ title, opts: plain(opts) }) },
      pushManager: { subscribe: async () => ({}) },
    },
    clients: {
      matchAll: async () => wins,
      openWindow: async (url: string) => { opened.push(url) },
      claim: async () => {},
    },
  }
  vm.runInNewContext(source('public/sw.js'), { self, console })
  const fire = async (type: string, ev: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve()
    handlers[type]({ ...ev, waitUntil: (p: Promise<unknown>) => { work = p } })
    await work
  }
  return { handlers, shown, posted, opened, fire }
}

describe('the service worker', () => {
  it('has no fetch handler — it caches nothing and answers no request', () => {
    const w = loadWorker()
    assert.deepEqual(Object.keys(w.handlers).sort(), ['activate', 'install', 'notificationclick', 'push', 'pushsubscriptionchange'])
  })
  it('shows every push, tagged by its notice, and an urgent one stays until acted on', async () => {
    const w = loadWorker()
    await w.fire('push', { data: { json: () => ({ id: 41, tag: 'srv-41', title: 'Call-off at 48TH (B)', body: 'Thu', href: '/app/x', urgent: true }) } })
    assert.equal(w.shown.length, 1)
    assert.equal(w.shown[0].title, 'Call-off at 48TH (B)')
    assert.equal(w.shown[0].opts.tag, 'srv-41')
    assert.equal(w.shown[0].opts.requireInteraction, true)
    assert.deepEqual(w.shown[0].opts.data, { href: '/app/x', id: 41 })
  })
  it('a push it cannot read is still shown — a browser requires it — and carries no route', async () => {
    const w = loadWorker()
    await w.fire('push', { data: { json: () => { throw new Error('not json') } } })
    assert.equal(w.shown.length, 1)
    assert.equal(w.shown[0].title, 'asa.')
    assert.deepEqual(w.shown[0].opts.data, { href: '', id: 0 })
  })
  it('a push to somebody looking at the platform is shown silently — the page draws its own toast', async () => {
    const w = loadWorker([{ url: 'https://asamylife.asalifecare.com/#/', visibilityState: 'visible', focused: true }])
    await w.fire('push', { data: { json: () => ({ id: 41, tag: 'srv-41', title: 'T', body: 'B', href: '/app/x' }) } })
    assert.equal(w.shown[0].opts.silent, true)
  })
  it('a click with the platform open moves that tab and asks it to mark the notice read', async () => {
    const w = loadWorker([{ url: 'https://asamylife.asalifecare.com/#/home' }])
    let closed = false
    await w.fire('notificationclick', { notification: { data: { href: '/app/x?tab=me', id: 41 }, close: () => { closed = true } } })
    assert.equal(closed, true)
    assert.deepEqual(w.posted, [{ kind: 'hub-push-open', href: '/app/x?tab=me', id: 41 }])
    assert.deepEqual(w.opened, [])
  })
  it('a click with no tab opens one on the route, carrying the notice to mark read', async () => {
    const w = loadWorker()
    await w.fire('notificationclick', { notification: { data: { href: '/app/x?tab=me', id: 41 }, close: () => {} } })
    assert.deepEqual(w.opened, ['https://asamylife.asalifecare.com/#/app/x?tab=me&notice=41'])
  })
  it('a route that is not the platform\'s own opens the platform\'s home instead', async () => {
    const w = loadWorker()
    await w.fire('notificationclick', { notification: { data: { href: '//evil.example/x', id: 0 }, close: () => {} } })
    assert.deepEqual(w.opened, ['https://asamylife.asalifecare.com/#/'])
  })
})

describe('the files the browser needs', () => {
  it('index.html links the manifest and the Home Screen icon; the manifest\'s icons exist', () => {
    const index = source('index.html')
    assert.match(index, /<link rel="manifest" href="\/app-manifest.json" \/>/)
    assert.match(index, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon.png" \/>/)
    const manifest = JSON.parse(source('public/app-manifest.json')) as { display: string; icons: { src: string }[] }
    assert.equal(manifest.display, 'standalone')
    for (const icon of manifest.icons) assert.ok(readFileSync(resolve(ROOT, 'public', icon.src)).length > 100, icon.src)
  })
  it('the shell hands every session change to the push lane, and the ask card subscribes on a yes', () => {
    assert.match(source('src/lib/chatPresence.ts'), /onPushSession\(token\)/)
    assert.match(source('src/features/auth/NotificationAsk.tsx'), /if \(got === 'granted'\) void ensurePush\(\{ force: true \}\)/)
  })
})
