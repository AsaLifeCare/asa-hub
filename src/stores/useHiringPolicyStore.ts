// The MASTER's word over the Hiring Pipeline app: which views EXIST for anybody.
// Same mechanism as useClientsPolicyStore — server config, read once per session through the declared…
import { create } from 'zustand'
import { gasAction } from '@/features/hiring/shared'
import { expandHiringViews, HIRING_VIEWS, TALENT_VIEWS, type HiringViewId } from '@/stores/useHiringViewsStore'

type HiringPolicyState = {
  views: HiringViewId[]
  fetched: boolean
  // TRUE while the SERVING Apps Script still speaks the two-word vocabulary (it answered the literal `flow`, which…
  legacyServer: boolean
  // DID THE MASTER'S CELL SPEAK ABOUT THE ABSORBED VIEWS AT ALL?
  masterSpokeOfTalent: boolean
  /** Read one `hiringViewsPolicy` answer, from whichever door it arrived. */
  apply: (d: { views?: HiringViewId[] }) => void
  ensure: () => void
}

let inFlight = false

/** Everything the app has — what a blank cell and a fail-open read mean. */
const ALL: HiringViewId[] = HIRING_VIEWS.map((v) => v.id)

export const useHiringPolicyStore = create<HiringPolicyState>((set, get) => ({
  views: ALL,
  fetched: false,
  legacyServer: false,
  // fail-open until the read lands: nobody has spoken yet
  masterSpokeOfTalent: false,
  // ONE PATH FOR THE ANSWER, whichever door it came through (2026-08-28).
  apply: (d) => {
    // AN EMPTY ANSWER IS THE MASTER'S 'no' AND MUST SURVIVE (2026-08-27 review): reading it as "nothing came back…
    const raw = Array.isArray(d?.views) ? d.views : null
    // the server speaks the same vocabulary, but a cell written before the merge still says `flow` — expanding here…
    set({
      views: raw ? expandHiringViews(raw) : ALL,
      legacyServer: !!raw?.includes('flow' as HiringViewId),
      // A cell that never names a talent view is silent about them, not against them — see the field's own note.
      masterSpokeOfTalent: !!raw?.some((v) => TALENT_VIEWS.includes(v as HiringViewId)),
      fetched: true,
    })
  },
  ensure: () => {
    if (get().fetched || inFlight) return
    inFlight = true
    void gasAction<{ views: HiringViewId[] }>('hiringViewsPolicy', {})
      .then((d) => get().apply(d))
      .catch(() => set({ fetched: true }))   // fail open, once — no retry storm
      .finally(() => { inFlight = false })
  },
}))
