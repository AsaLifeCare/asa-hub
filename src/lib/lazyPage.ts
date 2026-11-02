// A page loads when it is opened, not when the platform boots.
// Every screen shipped in one bundle, so each visit downloaded, parsed and ran the code of every app before the…
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export type LazyPage<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  /** fetch the page's code now; resolves to the component */
  load: () => Promise<T>
}

const RELOAD_KEY = 'asa-preload-reload-at'
const RELOAD_GAP_MS = 30_000

// One reload onto the served index after a chunk failed to arrive.
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < RELOAD_GAP_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/** Never settles: the fallback stays drawn until the reload replaces the page. */
function whileReloading<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

export function lazyPage<T extends ComponentType<any>>(importer: () => Promise<{ default: T }>): LazyPage<T> {
  let loaded: { default: T } | undefined
  let pending: Promise<{ default: T }> | undefined
  const fetchPage = () => (pending ??= importer().then(
    // undefined: the preload guard in main.tsx caught the failure and is reloading
    (mod) => (mod ? (loaded = mod) : whileReloading<{ default: T }>()),
    (err: unknown) => {
      pending = undefined
      if (reloadForStaleChunk()) return whileReloading<{ default: T }>()
      throw err
    },
  ))
  const Page = lazy(() => {
    if (!loaded) return fetchPage()
    // already here: a thenable that answers synchronously lets React render without suspending
    const done = loaded
    return { then: (resolve: (m: { default: T }) => void) => resolve(done) } as unknown as Promise<{ default: T }>
  })
  return Object.assign(Page, { load: () => fetchPage().then((mod) => mod.default) })
}
