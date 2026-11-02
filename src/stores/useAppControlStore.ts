// App Control UI store (zustand, persisted to localStorage "asa-appcontrol-ui").
// Pure view state for the App Control screen (src/pages/features/appcontrol/AppControlPage.tsx): which layout the…
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppControlLayout = 'board' | 'matrix' | 'list'
export type AppControlDensity = 'comfortable' | 'compact'

type AppControlUiState = {
  layout: AppControlLayout
  density: AppControlDensity
  /** Category ids whose group is collapsed (Matrix + List). */
  collapsedGroups: string[]
  /** App ids whose category suggestion the admin dismissed. */
  dismissedSuggestions: string[]
  setLayout: (layout: AppControlLayout) => void
  setDensity: (density: AppControlDensity) => void
  toggleGroup: (categoryId: string) => void
  dismissSuggestion: (appId: string) => void
  /** Bring back every dismissed suggestion. */
  resetDismissed: () => void
}

export const useAppControlStore = create<AppControlUiState>()(
  persist(
    (set) => ({
      layout: 'board',
      density: 'comfortable',
      collapsedGroups: [],
      dismissedSuggestions: [],

      setLayout: (layout) => set({ layout }),
      setDensity: (density) => set({ density }),
      toggleGroup: (categoryId) =>
        set((s) => ({
          collapsedGroups: s.collapsedGroups.includes(categoryId)
            ? s.collapsedGroups.filter((id) => id !== categoryId)
            : [...s.collapsedGroups, categoryId],
        })),
      dismissSuggestion: (appId) =>
        set((s) =>
          s.dismissedSuggestions.includes(appId)
            ? s
            : { dismissedSuggestions: [...s.dismissedSuggestions, appId] },
        ),
      resetDismissed: () => set({ dismissedSuggestions: [] }),
    }),
    { name: 'asa-appcontrol-ui' },
  ),
)
