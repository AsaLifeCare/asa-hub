// OS notifications for a hidden tab, tagged by notice id so every tab shows one.
// Permission is asked once per person from a click (features/auth/NotificationAsk), kept in lib/prefsSync.
export type OsPermission = 'granted' | 'denied' | 'default' | 'unsupported'

type NotificationCtor = typeof Notification

function api(): NotificationCtor | null {
  const N = (globalThis as { Notification?: NotificationCtor }).Notification
  return typeof N === 'function' ? N : null
}

/** This browser's answer for the site; `unsupported` shows none at all. */
export function osPermission(): OsPermission {
  const N = api()
  if (!N) return 'unsupported'
  return N.permission === 'granted' || N.permission === 'denied' ? N.permission : 'default'
}

/** The browser's own question; call it from a click only. */
export async function askOsPermission(): Promise<OsPermission> {
  const N = api()
  if (!N) return 'unsupported'
  try {
    // older Safari answers only through the callback
    const got = await new Promise<NotificationPermission>((resolve) => {
      const p = N.requestPermission((r) => resolve(r))
      if (p && typeof p.then === 'function') p.then(resolve, () => resolve(N.permission))
    })
    return got === 'granted' || got === 'denied' ? got : 'default'
  } catch {
    return osPermission()
  }
}

export type OsNotice = {
  /** the bell row it stands for (`srv-41`) — also its tag, so tabs show it once */
  key: string
  title: string
  body: string
  href?: string
  /** an urgent one stays on screen until the person acts on it */
  urgent: boolean
  /** what a click means besides going there — marking the bell row read */
  onOpen?: () => void
}

/** Shown and not yet closed. */
const shown = new Map<string, Notification>()

/** The platform's service worker, once lib/webPush has registered it. */
type WorkerLike = Pick<ServiceWorkerRegistration, 'showNotification' | 'getNotifications'>
let worker: WorkerLike | null = null

/** The service worker: shows what a page may not (Chrome on Android) and closes push copies. */
export function setOsWorker(reg: WorkerLike | null): void {
  worker = reg
}

function noticeIdOf(key: string): number {
  const n = Number(String(key).replace(/^srv-/, ''))
  return Number.isInteger(n) && n > 0 ? n : 0
}

function iconHref(): string | undefined {
  const link = typeof document !== 'undefined' && typeof document.querySelector === 'function'
    ? (document.querySelector('link[rel="icon"]') as HTMLLinkElement | null)
    : null
  return link?.href || undefined
}

/** Show a notice through the OS; whether it was shown. `force` is Settings' test button. */
export function showOsNotice(n: OsNotice, opts: { force?: boolean } = {}): boolean {
  if (!opts.force && typeof document !== 'undefined' && document.visibilityState === 'visible') return false
  const N = api()
  if (!N || N.permission !== 'granted') return false
  try {
    const note = new N(n.title, { body: n.body, tag: n.key, requireInteraction: n.urgent, icon: iconHref() })
    note.onclick = () => {
      try { window.focus() } catch { /* a browser that will not raise the tab still opens the route */ }
      if (n.href) window.location.hash = '#' + n.href
      n.onOpen?.()
      note.close()
    }
    note.onclose = () => { if (shown.get(n.key) === note) shown.delete(n.key) }
    shown.set(n.key, note)
    return true
  } catch {
    // the page may not show one: the service worker can
    if (!worker) return false
    try {
      void worker.showNotification(n.title, {
        body: n.body, tag: n.key, requireInteraction: n.urgent, icon: iconHref(),
        data: { href: n.href ?? '', id: noticeIdOf(n.key) },
      }).catch(() => { /* nothing more this browser will do */ })
      return true
    } catch {
      return false
    }
  }
}

/** Close the operating-system copies whose subject no longer holds. */
export function closeOsNotices(gone: (key: string) => boolean): void {
  for (const [key, note] of [...shown]) {
    if (!gone(key)) continue
    shown.delete(key)
    try { note.close() } catch { /* already gone */ }
  }
}

/** Close the worker's copies for read or cleared `keys`, or 'all'; named, never inferred from the bell. */
export function closeWorkerNotices(keys: ReadonlySet<string> | 'all'): void {
  if (!worker) return
  try {
    void worker.getNotifications().then((list) => {
      for (const note of list) {
        if (!note.tag || !note.tag.startsWith('srv-')) continue
        if (keys === 'all' || keys.has(note.tag)) note.close()
      }
    }).catch(() => { /* the worker's copies stay until the person closes them */ })
  } catch { /* a worker that will not list its notifications keeps them */ }
}

// ------------------------------------------------------------------ THE ANSWER, PER PERSON…

/** One key per person; prefsSync carries only the signed-in person's own. */
export const OS_ASK_PREFIX = 'asa-os-notify-asked:'

export function osAskKey(uid: string): string {
  return `${OS_ASK_PREFIX}${uid}`
}

/** `later` is "Not now" — an answer too, and never asked again. */
export type OsAnswer = 'granted' | 'denied' | 'later'

/** What this person said when they were asked, or '' when they never were. */
export function answerOf(uid: string): OsAnswer | '' {
  if (!uid) return ''
  try {
    const raw = JSON.parse(localStorage.getItem(osAskKey(uid)) ?? 'null') as { answer?: unknown } | null
    const got = raw && typeof raw === 'object' ? raw.answer : undefined
    return got === 'granted' || got === 'denied' || got === 'later' ? got : ''
  } catch {
    return ''
  }
}

/** Write the answer down where it follows the person to every device. */
export function recordAnswer(uid: string, answer: OsAnswer, nowIso = new Date().toISOString()): void {
  if (!uid) return
  try {
    localStorage.setItem(osAskKey(uid), JSON.stringify({ answer, at: nowIso }))
    void import('@/lib/prefsSync').then((m) => m.schedulePrefsPush()).catch(() => {
      /* this browser still remembers; the next push carries it */
    })
  } catch {
    /* storage refused: the card shows once more, which is the harmless way to fail */
  }
}

/** Whether the card may ask now: unanswered browser and person, past the password gate, own account, prefs loaded. */
export function shouldOfferAsk(p: {
  uid: string
  permission: OsPermission
  mustChangePassword: boolean
  visiting: boolean
  settled: boolean
}): boolean {
  return Boolean(p.uid) && p.permission === 'default' && !p.mustChangePassword &&
    !p.visiting && p.settled && !answerOf(p.uid)
}

/** The toast after the browser answers (shared by the card and Settings). */
export function answerToast(got: OsPermission): { type: 'success' | 'info'; title: string; body: string } {
  if (got === 'granted') {
    return { type: 'success', title: 'Notifications are on',
      body: 'Call-offs and open shifts will reach you even when this tab is in the background.' }
  }
  if (got === 'denied') {
    return { type: 'info', title: 'Notifications are blocked in this browser',
      body: 'Nothing more will be asked. Settings → Notifications says how to turn them on if you change your mind.' }
  }
  if (got === 'unsupported') {
    return { type: 'info', title: 'This browser cannot show notifications',
      body: 'Call-offs and open shifts still appear on the right of the screen while the platform is open.' }
  }
  return { type: 'info', title: 'Nothing was changed',
    body: 'You can allow notifications any time from Settings → Notifications.' }
}
