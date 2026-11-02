// The last answer paints at once; younger than FRESH_MS it is not re-asked, older it refreshes quietly behind it.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// The platform's own rule for these two pages — the backend keeps its answer for half an hour, so the browser has…
export const MARKETING_FRESH_MS = 30 * 60 * 1000

type Held<T> = { data: T; at: number } | null

type State = {
  competitors: Held<any>
  analytics: Held<any>
  put: (key: 'competitors' | 'analytics', data: any) => void
}

export const useMarketingCache = create<State>()(
  persist(
    (set) => ({
      competitors: null,
      analytics: null,
      put: (key, data) => set({ [key]: { data, at: Date.now() } } as Partial<State>),
    }),
    { name: 'asa-marketing-cache' },
  ),
)

/** Is a held answer young enough that asking again would tell us nothing? */
export const marketingFresh = (held: Held<any>) =>
  Boolean(held && Date.now() - held.at < MARKETING_FRESH_MS)
