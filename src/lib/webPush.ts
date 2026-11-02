// This browser's push subscription, kept by the relay for the session's account (server/web_push.py).
// Never asks for permission itself; a session that ends lets the device go.
import { isActing, useAuthStore } from '@/auth/useAuthStore'
import { relayLane } from '@/lib/noticesApi'
import { osPermission, setOsWorker } from '@/lib/osNotify'
import { useNotificationStore } from '@/stores/useNotificationStore'

export const PUSH_KEY_PATH = '/hub-lanes/push/key'
export const PUSH_SUBSCRIBE_PATH = '/hub-lanes/push/subscribe'
export const PUSH_UNSUBSCRIBE_PATH = '/hub-lanes/push/unsubscribe'
/** Beside index.html, so its scope is the whole platform wherever it is served. */
export const SW_FILE = 'sw.js'

export type PushState =
  /** this browser has no service worker or no push at all */
  | 'unsupported'
  /** an iPhone or iPad Safari tab: push arrives only from the Home Screen */
  | 'home-screen'
  /** browsers offer push only on a secure (https) page */
  | 'insecure'
  /** notifications are not allowed yet — the card or Settings asks */
  | 'not-allowed'
  /** notifications are blocked in this browser */
  | 'blocked'
  /** the relay has no push keys yet, so nothing could reach the device */
  | 'no-key'
  /** the relay keeps this device for the account signed in */
  | 'on'
  /** it was tried and did not work — `why` says what answered */
  | 'failed'

export type PushStatus = { state: PushState; why: string }

/** Settings → Notifications wording; empty where the permission line says it all. */
export const PUSH_WORDS: Record<PushState, string> = {
  on: 'This device also gets them with the platform closed.',
  'home-screen': 'On an iPhone or iPad they reach you with the platform closed only once it is on your ' +
    'Home Screen: Share, then Add to Home Screen, and open it from there.',
  unsupported: 'This browser cannot get them with the platform closed.',
  insecure: 'Getting them with the platform closed needs the secure (https) address.',
  'not-allowed': '',
  blocked: '',
  'no-key': 'Getting them with the platform closed is not switched on for the platform yet.',
  failed: 'This device could not be set up to get them with the platform closed',
}

type Env = {
  hasWorker: boolean
  hasPush: boolean
  secure: boolean
  userAgent: string
  touchPoints: number
  standalone: boolean
}

function env(): Env {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { standalone?: boolean }
  const win = (typeof window !== 'undefined' ? window : {}) as Window & { PushManager?: unknown }
  let standalone = Boolean(nav.standalone)
  try {
    standalone = standalone || Boolean(win.matchMedia?.('(display-mode: standalone)').matches)
  } catch { /* an old browser has no display-mode query */ }
  return {
    hasWorker: Boolean(nav.serviceWorker),
    hasPush: typeof win.PushManager !== 'undefined',
    secure: Boolean(win.isSecureContext),
    userAgent: String(nav.userAgent ?? ''),
    touchPoints: Number(nav.maxTouchPoints ?? 0),
    standalone,
  }
}

/** An iPhone or iPad (an iPad reports a Mac with touch points). */
export function isAppleMobile(e: Pick<Env, 'userAgent' | 'touchPoints'>): boolean {
  return /iPad|iPhone|iPod/.test(e.userAgent) || (/Macintosh/.test(e.userAgent) && e.touchPoints > 1)
}

/** What stops push in this browser, or null. */
export function pushBlocker(e: Env = env()): PushState | null {
  if (!e.hasWorker || !e.hasPush) return isAppleMobile(e) && !e.standalone ? 'home-screen' : 'unsupported'
  if (!e.secure) return 'insecure'
  return null
}

/** The relay's key as the browser takes it. */
export function keyBytes(b64url: string): Uint8Array {
  const clean = String(b64url ?? '').trim().replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Whether this subscription was made with this key. */
export function sameKey(sub: Pick<PushSubscription, 'options'>, b64url: string): boolean {
  const had = sub.options?.applicationServerKey
  if (!had) return false
  const a = new Uint8Array(had as ArrayBuffer)
  const b = keyBytes(b64url)
  return a.length === b.length && a.every((v, i) => v === b[i])
}

// ------------------------------------------------------------------ THE STATE, for Settings…

let status: PushStatus = { state: 'not-allowed', why: '' }
const listeners = new Set<() => void>()

function setStatus(next: PushStatus): PushStatus {
  if (next.state !== status.state || next.why !== status.why) {
    status = next
    for (const fn of listeners) fn()
  }
  return status
}

export function pushStatus(): PushStatus {
  return status
}

export function onPushStatus(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ------------------------------------------------------------------ THE WORKER…

let registration: ServiceWorkerRegistration | null = null
let listening = false

/** Worker messages: a clicked notification's route and notice, or a replaced subscription. */
export function onWorkerMessage(data: unknown): void {
  const msg = (data && typeof data === 'object' ? data : {}) as { kind?: string; href?: string; id?: number }
  if (msg.kind === 'hub-push-open') {
    const href = typeof msg.href === 'string' && msg.href.startsWith('/') && !msg.href.startsWith('//')
      ? msg.href : ''
    if (href) window.location.hash = '#' + href
    const id = Number(msg.id)
    if (Number.isInteger(id) && id > 0) useNotificationStore.getState().markRead(`srv-${id}`)
    return
  }
  if (msg.kind === 'hub-push-renew') void ensurePush({ force: true })
}

/** The service worker, once per page load (osNotify uses it too); null where unsupported. */
export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration
  const e = env()
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
  if (!sw || !e.secure) return null
  const url = new URL(SW_FILE, document.baseURI).href
  registration = await sw.register(url)
  setOsWorker(registration)
  if (!listening) {
    listening = true
    sw.addEventListener('message', (ev: MessageEvent) => onWorkerMessage(ev.data))
  }
  return registration
}

// ------------------------------------------------------------------ SUBSCRIBE, AND LET GO…

let heldEndpoint = ''
let inflight: Promise<PushStatus> | null = null

/** Keep this device for the signed-in person when allowed; asks nothing. `force` re-sends it. */
export async function ensurePush(opts: { force?: boolean } = {}): Promise<PushStatus> {
  if (inflight) return inflight
  // `.finally` outside run(): a synchronous answer would clear `inflight` before assignment
  inflight = run(opts).finally(() => { inflight = null })
  return inflight
}

async function run(opts: { force?: boolean }): Promise<PushStatus> {
  try {
    const token = useAuthStore.getState().token
    if (!token) return setStatus({ state: 'not-allowed', why: 'not signed in' })
    // WEARING ANOTHER ACCOUNT (Be Another): this device stays the master's — subscribing it here would hand the…
    if (isActing()) return setStatus({ state: 'not-allowed', why: 'acting as another account — this device stays yours' })
    const blocked = pushBlocker()
    if (blocked) return setStatus({ state: blocked, why: '' })
    const perm = osPermission()
    if (perm === 'denied') return setStatus({ state: 'blocked', why: '' })
    if (perm !== 'granted') return setStatus({ state: perm === 'unsupported' ? 'unsupported' : 'not-allowed', why: '' })
    if (!opts.force && status.state === 'on' && heldEndpoint) return status
    const reg = await registerWorker()
    if (!reg) return setStatus({ state: 'unsupported', why: '' })
    const got = await relayLane<{ key: string | null; why: string }>(PUSH_KEY_PATH)
    if (!got?.key) return setStatus({ state: 'no-key', why: String(got?.why ?? '') })
    let sub = await reg.pushManager.getSubscription()
    if (sub && !sameKey(sub, got.key)) {
      await sub.unsubscribe().catch(() => false)
      sub = null
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true,
        applicationServerKey: keyBytes(got.key) as BufferSource })
    }
    await relayLane(PUSH_SUBSCRIBE_PATH, {
      method: 'POST',
      body: JSON.stringify({ subscription: sub.toJSON(), ua: String(navigator.userAgent ?? '').slice(0, 300) }),
    })
    heldEndpoint = sub.endpoint
    return setStatus({ state: 'on', why: '' })
  } catch (err) {
    return setStatus({ state: 'failed', why: err instanceof Error ? err.message : 'it did not work' })
  }
}

/** Let this device go, on the relay (as `asToken`) and in the browser. */
export async function dropPush(asToken?: string): Promise<void> {
  const reg = registration ?? (await navigator.serviceWorker?.getRegistration?.().catch(() => undefined)) ?? null
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null
  const endpoint = sub?.endpoint || heldEndpoint
  heldEndpoint = ''
  if (endpoint && asToken) {
    await relayLane(PUSH_UNSUBSCRIBE_PATH, { method: 'POST', body: JSON.stringify({ endpoint }) }, asToken)
      .catch(() => { /* the browser's own unsubscribe below still ends it */ })
  }
  if (sub) await sub.unsubscribe().catch(() => false)
  setStatus({ state: 'not-allowed', why: '' })
}

// ------------------------------------------------------------------ THE SESSION…

let sessionToken: string | null | undefined
let sessionUid = ''
let chain: Promise<unknown> = Promise.resolve()

/** A push-opened tab's `notice=<id>`, taken out of the address once read. */
export function takeOpenedNotice(): number {
  if (typeof window === 'undefined') return 0
  const hash = String(window.location.hash ?? '')
  const q = hash.indexOf('?')
  if (q === -1) return 0
  const params = new URLSearchParams(hash.slice(q + 1))
  const id = Number(params.get('notice'))
  if (!Number.isInteger(id) || id <= 0) return 0
  params.delete('notice')
  const rest = params.toString()
  const next = hash.slice(0, q) + (rest ? `?${rest}` : '')
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + next)
  } catch { /* the address keeps it; marking read twice is harmless */ }
  return id
}

/** The tab's session changed (lib/chatPresence): an ended session lets the device go, a new one keeps it. */
export function onPushSession(token: string | null): void {
  if (token === sessionToken) return
  const prevToken = sessionToken
  const prevUid = sessionUid
  const uid = token ? String(useAuthStore.getState().user?.id ?? '') : ''
  sessionToken = token
  sessionUid = uid
  const ended = Boolean(prevToken) && (!token || (Boolean(prevUid) && Boolean(uid) && prevUid !== uid))
  chain = chain.then(async () => {
    if (ended && prevToken) await dropPush(prevToken)
    if (!token) return
    const opened = takeOpenedNotice()
    if (opened) useNotificationStore.getState().markRead(`srv-${opened}`)
    if (osPermission() === 'granted' && !pushBlocker()) await ensurePush({ force: true })
    else setStatus({ state: pushBlocker() ?? (osPermission() === 'denied' ? 'blocked' : 'not-allowed'), why: '' })
  }).catch(() => { /* each step says its own outcome in the state */ })
}

/** For the tests: forget what this page load did. */
export function resetPushForTests(): void {
  registration = null
  listening = false
  heldEndpoint = ''
  inflight = null
  sessionToken = undefined
  sessionUid = ''
  chain = Promise.resolve()
  status = { state: 'not-allowed', why: '' }
  setOsWorker(null)
}
