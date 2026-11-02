// Person Focus Mode — workspace context store (context-mode wave).
// Persisted to localStorage key "asa-context".
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 'form' and 'project' joined later: form and project names track like people names — the first non-person focuses…
export type FocusType = 'client' | 'staff' | 'director' | 'form' | 'project' | 'house'

export type Focus = {
  type: FocusType
  id: string
  name: string
  avatar?: string
  subtitle?: string
}

type ContextState = {
  focus: Focus | null
  // The last few people focused on, newest first — switching back to someone you were just looking at should not…
  recents: Focus[]
  setFocus: (f: Focus) => void
  clearFocus: () => void
  forgetRecents: () => void
}

const RECENTS_MAX = 8

export const useContextStore = create<ContextState>()(
  persist(
    (set) => ({
      focus: null,
      recents: [],
      setFocus: (f) =>
        set((s) => ({
          focus: f,
          recents: [f, ...s.recents.filter((r) => !(r.id === f.id && r.type === f.type))].slice(0, RECENTS_MAX),
        })),
      clearFocus: () => set({ focus: null }),
      forgetRecents: () => set({ recents: [] }),
    }),
    { name: 'asa-context' },
  ),
)

/** Sidebar/palette visibility rule for one manifest while focused. */
export function visibleInFocus(audience: ('all' | FocusType)[] | undefined, focus: Focus | null): boolean {
  if (!focus) return true
  const aud = audience ?? ['all']
  return aud.includes('all') || aud.includes(focus.type)
}
