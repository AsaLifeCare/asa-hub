// POTENTIAL CLIENTS VIEWS — the same two configs every viewed app carries: 1.
// the MASTER's policy (`potclients_views_master` config row, read once per session via `potClientsViewsPolicy`)…
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { gasAction } from '@/features/hiring/shared'

// THE FOUR VIEWS THIS APP HAS (2026-08-21).
export const POTCLIENTS_VIEWS = ['unique', 'pipeline', 'compare', 'funnel'] as const
export type PotClientsViewId = (typeof POTCLIENTS_VIEWS)[number]

/** The same four, with the words a person reads. Ordered as they appear. */
export const POTCLIENTS_VIEW_LIST: { id: PotClientsViewId; label: string; sub: string }[] = [
  { id: 'unique', label: 'Unique', sub: 'One referral read like a profile' },
  { id: 'pipeline', label: 'Pipeline', sub: 'The whole list as a table' },
  { id: 'compare', label: 'Compare', sub: 'Referrals ranked against each other, and sent to the funnel' },
  { id: 'funnel', label: 'Funnel', sub: 'The board — only the ones worth a call enter New' },
]

type PolicyState = {
  views: PotClientsViewId[]
  fetched: boolean
  /** Read one `potClientsViewsPolicy` answer, from whichever door it arrived. */
  apply: (d: { views?: string[] }) => void
  ensure: () => void
}

let fetching = false
export const usePotClientsPolicyStore = create<PolicyState>()((set, get) => ({
  views: [...POTCLIENTS_VIEWS],   // fail-open: the master's cut applies once read
  fetched: false,
  // One reading of a `potClientsViewsPolicy` answer, whichever door it came through — the live action, or the…
  apply: (d) => {
    const views = (d?.views ?? []).filter((v): v is PotClientsViewId =>
      (POTCLIENTS_VIEWS as readonly string[]).includes(v))
    set({ views: views.length ? views : ['pipeline'], fetched: true })
  },
  ensure: () => {
    if (get().fetched || fetching) return
    fetching = true
    void gasAction<{ views: string[] }>('potClientsViewsPolicy', {})
      .then((d) => get().apply(d))
      .catch(() => { fetching = false /* fail-open; retried next mount */ })
  },
}))

type PrefState = {
  enabled: Record<PotClientsViewId, boolean>
  setEnabled: (id: PotClientsViewId, on: boolean) => void
}

export const usePotClientsViewsStore = create<PrefState>()(
  persist(
    (set) => ({
      enabled: { unique: true, pipeline: true, compare: true, funnel: true },
      setEnabled: (id, on) => set((s) => ({ enabled: { ...s.enabled, [id]: on } })),
    }),
    { name: 'asa-potclients-views' },
  ),
)
