// The MASTER's word over the Clients app: which views EXIST for anybody, and whether the selection-screen toolbar…
// Server-side config (the platform's config tab), read once per session through the declared `clientViewsPolicy`…
import { create } from 'zustand'
import { gasAction } from '@/features/hiring/shared'
import type { ClientViewId } from '@/stores/useClientViewsStore'

export type ClientToolId = 'share' | 'export' | 'add'

type ClientsPolicyState = {
  views: ClientViewId[]
  /** which toolbar buttons exist — Views is never here, it is always on */
  tools: ClientToolId[]
  fetched: boolean
  /** Read one `clientViewsPolicy` answer, from whichever door it arrived. */
  apply: (d: { views?: ClientViewId[]; tools?: ClientToolId[]; toolbar?: boolean }) => void
  ensure: () => void
}

let inFlight = false

export const useClientsPolicyStore = create<ClientsPolicyState>((set, get) => ({
  views: ['directory', 'record', 'unique'],
  tools: ['share', 'export', 'add'],
  fetched: false,
  // One reading of a `clientViewsPolicy` answer, whichever door it came through — the live action, or the bundle…
  apply: (d) => set({
    views: d?.views ?? ['directory', 'record', 'unique'],
    // a pre-update serving deployment answers `toolbar` instead of `tools` — honour it until the publish catches up
    tools: d?.tools ?? (d?.toolbar === false ? [] : ['share', 'export', 'add']),
    fetched: true,
  }),
  ensure: () => {
    if (get().fetched || inFlight) return
    inFlight = true
    void gasAction<{ views: ClientViewId[]; tools: ClientToolId[]; toolbar?: boolean }>('clientViewsPolicy', {})
      .then((d) => get().apply(d))
      .catch(() => set({ fetched: true }))   // fail open, once — no retry storm
      .finally(() => { inFlight = false })
  },
}))
