// Warming the cache while nobody is looking.
// What used to work, described plainly: collect the data in advance, while the screen is idle or the person is…
import { api, asBackground } from '@/lib/api'
import { cacheKey } from '@/lib/apiCache'
import type { AppManifest, ResourceName } from '@/engine/types'

const GAP_MS = 2500
/** After a failure, stop for long enough that a struggling backend recovers. */
const COOLDOWN_MS = 60_000

let queue: ResourceName[] = []
let running = false
let pausedUntil = 0
const warmed = new Set<string>()

const idle = (fn: () => void) => {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 3000 })
  else setTimeout(fn, 600)
}

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length) {
      if (!visible() || Date.now() < pausedUntil) break
      const resource = queue.shift()
      if (!resource) break
      const key = cacheKey(resource, 'list', undefined)
      if (warmed.has(key)) continue
      try {
        // straight through the api facade, so it lands in the same cache the screens read from — a second copy…
        await asBackground(() => api.list(resource))
        warmed.add(key)
      } catch {
        pausedUntil = Date.now() + COOLDOWN_MS
        break
      }
      await new Promise((r) => setTimeout(r, GAP_MS))
    }
  } finally {
    running = false
  }
}

// Queue what this person is likely to open next.
export function warmFor(apps: AppManifest[], currentAppId?: string): void {
  if (!visible()) return
  const wanted: ResourceName[] = []
  const push = (r?: string) => {
    if (r && !wanted.includes(r as ResourceName)) wanted.push(r as ResourceName)
  }

  const current = apps.find((a) => a.id === currentAppId)
  current?.pages.forEach((p) => push(p.dataSource?.resource as string | undefined))
  for (const app of apps) {
    if (app.id === currentAppId) continue
    app.pages.forEach((p) => push(p.dataSource?.resource as string | undefined))
  }

  // keep it modest: the first handful covers where people actually go Six, not twelve: the backend runs every…
  queue = wanted.filter((r) => !warmed.has(cacheKey(r, 'list', undefined))).slice(0, 6)
  if (queue.length) idle(() => void drain())
}

/** A write means what we warmed may be wrong — let it be re-warmed. */
export function forgetWarm(resource: string): void {
  for (const key of [...warmed]) if (key.startsWith(`${resource}::`)) warmed.delete(key)
}

/** Stop warming (sign-out, or a screen that needs the bandwidth). */
export function stopWarming(): void {
  queue = []
}
