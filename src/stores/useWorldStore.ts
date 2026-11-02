// USER WORLDS — which face of the platform this browser is wearing.
// Every user has TWO worlds: the asalifecare world and THEIR OWN — same platform face, their own workbook behind it.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from '@/stores/useToastStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { rebootIntoWorkspace } from '@/lib/reboot'
import { worldOffered, worldOfferedTo } from '@/lib/worldOffered'

type WorldSwitching = { to: 'world' | 'company' } | null

type WorldState = {
  /** '' = the company world; anything else = the user's own workbook id. */
  currentWorldId: string
  /** The personal world's display name (from worldEnsure/worldGet). */
  worldName: string
  /** Monotonic counter, bumped on every switch — mirrors tenantEpoch. */
  worldEpoch: number
  /** Non-null while the traveler overlay covers the reboot. Never persisted. */
  switching: WorldSwitching
  /** worldEnsure (creates the workbook on first entry) → set → overlay → reboot. */
  switchToWorld: () => Promise<void>
  // Open a world that already exists and is not necessarily yours — the visited member's, when they left their door…
  enterWorld: (worldId: string, name: string) => void
  /** Clear → overlay → reboot into the company workspace. */
  switchToCompany: () => void
}

export const useWorldStore = create<WorldState>()(
  persist(
    (set, get) => ({
      currentWorldId: '',
      worldName: '',
      worldEpoch: 0,
      switching: null,

      // A WORLD THAT ALREADY EXISTS, opened by id.
      enterWorld: (worldId, name) => {
        const s = get()
        if (s.switching || !worldId || s.currentWorldId === worldId || !worldOffered()) return
        set({
          currentWorldId: String(worldId),
          worldName: String(name || 'World'),
          worldEpoch: s.worldEpoch + 1,
          switching: { to: 'world' },
        })
      },

      switchToWorld: async () => {
        const s = get()
        if (s.switching || s.currentWorldId || !worldOffered()) return
        // the overlay IS the loading — up before the server answers
        set({ switching: { to: 'world' } })
        try {
          const { gasAction } = await import('@/features/hiring/shared')
          // worldEnsure answers {world, created} — reading world_id off the envelope itself stored the STRING…
          type WorldRow = { world_id?: string | number; name?: string }
          const idOf = (r: WorldRow | null | undefined) => String(r?.world_id ?? '').trim()
          // TWO SHAPES, ONE ANSWER.
          const res = await gasAction<{ world?: WorldRow } & WorldRow>('worldEnsure', {})
          let w: WorldRow | undefined = res?.world ?? (idOf(res) ? res : undefined)
          if (!idOf(w)) {
            try {
              const again = await gasAction<{ world?: WorldRow } & WorldRow>('worldGet', {})
              w = again?.world ?? (idOf(again) ? again : undefined)
            } catch { /* the throw below carries the honest message */ }
          }
          const worldId = idOf(w)
          if (!worldId) {
            throw new Error('The server did not name your world — try again in a moment.')
          }
          set({
            currentWorldId: worldId,
            worldName: String(w?.name ?? '').trim() || 'My world',
            worldEpoch: get().worldEpoch + 1,
          })
          // long enough for the loading to be SEEN (the traveler's own timing)
          window.setTimeout(() => { rebootIntoWorkspace() }, 1200)
        } catch (err) {
          set({ switching: null })
          toast({
            type: 'danger',
            title: 'Could not open your world',
            body: err instanceof Error ? err.message : 'The server did not answer — try again in a moment.',
          })
        }
      },

      switchToCompany: () => {
        const s = get()
        if (s.switching || !s.currentWorldId) return
        // worldName stays — the sidebar tile keeps its label between visits
        set({ currentWorldId: '', switching: { to: 'company' }, worldEpoch: s.worldEpoch + 1 })
        window.setTimeout(() => { rebootIntoWorkspace() }, 1200)
      },
    }),
    {
      name: 'asa-world',
      partialize: (s) => ({ currentWorldId: s.currentWorldId, worldName: s.worldName, worldEpoch: s.worldEpoch }),
    },
  ),
)

/** The active world id ('' = company) — the one read every data path shares. */
export function activeWorldId(): string {
  return useWorldStore.getState().currentWorldId
}

// RECONCILE — the persisted flag against the account that actually signed in.
let reconciledFor: string | null = null

// A WORLD THIS ACCOUNT IS NOT OFFERED IS LEFT AT ONCE — its own or a visited one, a visit open or not.
export function leaveWorldNotOffered(): boolean {
  const auth = useAuthStore.getState()
  if (!auth.hydrated || !auth.user || worldOfferedTo(auth.user)) return false
  const st = useWorldStore.getState()
  if (!st.currentWorldId || st.switching) return false
  useWorldStore.setState({ currentWorldId: '', worldName: '', switching: { to: 'company' } })
  rebootIntoWorkspace()
  return true
}

function reconcileWorld() {
  const token = useAuthStore.getState().token
  if (!token || token === reconciledFor) return
  reconciledFor = token
  if (!useWorldStore.getState().currentWorldId) return
  if (leaveWorldNotOffered()) return
  // A WORLD WE ARE VISITING IS NOT OURS TO HEAL.
  if (useMemberStore.getState().currentMemberId) return
  void (async () => {
    try {
      const { gasAction } = await import('@/features/hiring/shared')
      const res = await gasAction<{ world: { world_id: string | number; name?: string } | null }>('worldGet', {})
      const st = useWorldStore.getState()
      if (!st.currentWorldId || st.switching) return
      if (!res || !res.world) {
        useWorldStore.setState({ currentWorldId: '', worldName: '', switching: { to: 'company' } })
        rebootIntoWorkspace()
        return
      }
      const id = String(res.world.world_id)
      const name = String(res.world.name ?? '').trim() || st.worldName || 'My world'
      if (id !== st.currentWorldId || name !== st.worldName) {
        useWorldStore.setState({ currentWorldId: id, worldName: name })
      }
      // A boot straight into a world must furnish/upgrade it exactly like a crossing does — worldEnsure carries the…
      void gasAction('worldEnsure', {}).catch(() => { /* the next entry retries */ })
    } catch { /* unsure — the persisted state stands */ }
  })()
}

// Same trigger shape as the registry's dynamic-apps kick: reload-with-session via the deferred call, sign-in via…
queueMicrotask(() => {
  reconcileWorld()
  leaveWorldNotOffered()
  useAuthStore.subscribe((state, prev) => {
    if (state.token && state.token !== prev.token) reconcileWorld()
    if (state.user !== prev.user || state.hydrated !== prev.hydrated) leaveWorldNotOffered()
  })
})
