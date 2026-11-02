/*
 * Service worker: shows relay pushes (server/web_push.py) and opens their screen on click.
 * No fetch handler, so it never caches a stale release. Tag `srv-<id>` matches osNotify.ts; `chat-<hex>` is one
 * conversation's (server/chat_push.py).
 */
'use strict'

const ICON = 'icons/icon-192.png'
const BADGE = 'icons/badge-96.png'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/** A route inside the platform, or ''. */
function safeHref(raw) {
  const href = typeof raw === 'string' ? raw.trim() : ''
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return ''
  return href
}

function readPush(event) {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = {}
  }
  if (!data || typeof data !== 'object') data = {}
  const id = Number(data.id)
  return {
    id: Number.isInteger(id) && id > 0 ? id : 0,
    // a chat push carries its thread's tag, so the newest of one conversation replaces the last
    tag: typeof data.tag === 'string' && /^(srv-\d+|chat-[0-9a-f]{20})$/.test(data.tag) ? data.tag : '',
    title: typeof data.title === 'string' && data.title.trim() ? data.title.slice(0, 200) : 'asa.',
    body: typeof data.body === 'string' ? data.body.slice(0, 600) : '',
    href: safeHref(data.href),
    urgent: data.urgent === true,
  }
}

async function someoneIsLooking() {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return wins.some((w) => w.visibilityState === 'visible' && w.focused)
}

self.addEventListener('push', (event) => {
  const push = readPush(event)
  event.waitUntil((async () => {
    // a visible page draws its own toast; browsers still require the push be shown
    const quiet = await someoneIsLooking().catch(() => false)
    await self.registration.showNotification(push.title, {
      body: push.body,
      tag: push.tag || undefined,
      renotify: Boolean(push.tag) && !quiet,
      requireInteraction: push.urgent,
      silent: quiet,
      icon: ICON,
      badge: BADGE,
      data: { href: push.href, id: push.id },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const href = safeHref(data.href)
  const id = Number(data.id) > 0 ? Number(data.id) : 0
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = wins.find((w) => w.url.startsWith(self.registration.scope))
    if (open) {
      // the page navigates and marks it read; the worker holds no session
      try { await open.focus() } catch (e) { /* the message still lands */ }
      open.postMessage({ kind: 'hub-push-open', href, id })
      return
    }
    const route = href || '/'
    const sep = route.includes('?') ? '&' : '?'
    await self.clients.openWindow(self.registration.scope + '#' + route + (id ? `${sep}notice=${id}` : ''))
  })())
})

self.addEventListener('pushsubscriptionchange', (event) => {
  // resubscribe with the same key; an open page (or the next visit) hands it to the relay
  event.waitUntil((async () => {
    const key = event.oldSubscription && event.oldSubscription.options
      ? event.oldSubscription.options.applicationServerKey : null
    if (key) {
      try {
        await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      } catch (e) { /* the next visit subscribes */ }
    }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) w.postMessage({ kind: 'hub-push-renew' })
  })())
})
