// API driver config (§12).
// driver "apps-script" (default: the Hub's own Apps Script /exec endpoint) | "mock" (DEVELOPMENT ONLY — see below).
import { create } from 'zustand'

// The Hub's backend, reached through OUR origin: the relay, which Python answers. There is no rung past it — the
// sign-in, the sessions and every record live on this server, so a call sent anywhere else would sign nobody in and
// write where nothing reads.
export const DEFAULT_EXEC_URL = '/gas'

export type ApiDriver = 'mock' | 'apps-script'

/** Is the seeded dataset allowed to exist at all in this build? Dev only. */
export const MOCK_DRIVER_ALLOWED = import.meta.env.DEV

type ApiConfigState = {
  driver: ApiDriver
  execUrl: string
  // A KNOWN-live resource failed at the transport level — real trouble, badge-worthy.
  demoFallback: boolean
  // Resources the live backend has no table for yet.
  unservedResources: Record<string, true>
  setDriver: (d: ApiDriver) => void
  setExecUrl: (url: string) => void
  setDemoFallback: (v: boolean) => void
  markUnserved: (resource: string) => void
}

const storedDriver = localStorage.getItem('asa-api-driver')

// Anyone who explicitly saved the direct script.google.com URL gets moved to the relay: the direct path is exactly…
const storedUrl = localStorage.getItem('asa-api-url') ?? ''
if (storedUrl.includes('script.google.com')) localStorage.removeItem('asa-api-url')

export const useApiConfigStore = create<ApiConfigState>((set) => ({
  driver: MOCK_DRIVER_ALLOWED && storedDriver === 'mock' ? 'mock' : 'apps-script',
  execUrl: storedUrl.includes('script.google.com') ? '' : storedUrl,
  demoFallback: false,
  unservedResources: {},
  setDriver: (driver) => {
    // A browser that once carried the dev preference must not be able to wake up in it, and no control in the…
    const next: ApiDriver = driver === 'mock' && !MOCK_DRIVER_ALLOWED ? 'apps-script' : driver
    localStorage.setItem('asa-api-driver', next)
    set({ driver: next, demoFallback: false })
  },
  setExecUrl: (execUrl) => {
    localStorage.setItem('asa-api-url', execUrl)
    set({ execUrl })
  },
  setDemoFallback: (demoFallback) => set({ demoFallback }),
  markUnserved: (resource) =>
    set((s) => (s.unservedResources[resource] ? s : { unservedResources: { ...s.unservedResources, [resource]: true } })),
}))
