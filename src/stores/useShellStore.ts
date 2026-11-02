/** Shell UI state: ⌘K palette, notification panel, sidebar collapse (persisted). */
import { create } from 'zustand'

type ShellState = {
  paletteOpen: boolean
  setPaletteOpen: (v: boolean) => void
  // Text the palette starts with on next open — the assist bar's handoff.
  paletteSeed: string
  setPaletteSeed: (v: string) => void
  // The Copilot side sheet — shared so the topbar pill AND the assist bar open the same surface instead of growing…
  copilotOpen: boolean
  setCopilotOpen: (v: boolean) => void
  notifPanelOpen: boolean
  setNotifPanelOpen: (v: boolean) => void
  /** Mobile (<lg) off-canvas nav drawer. Not persisted, closes on navigation. */
  drawerOpen: boolean
  setDrawerOpen: (v: boolean) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  // THE PLACES RAIL, and it is collapsed by DEFAULT — the opposite of the app column.
  railExpanded: boolean
  toggleRail: () => void
}

export const useShellStore = create<ShellState>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  paletteSeed: '',
  setPaletteSeed: (paletteSeed) => set({ paletteSeed }),
  copilotOpen: false,
  setCopilotOpen: (copilotOpen) => set({ copilotOpen }),
  notifPanelOpen: false,
  setNotifPanelOpen: (notifPanelOpen) => set({ notifPanelOpen }),
  drawerOpen: false,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  railExpanded: localStorage.getItem('asa-rail') === 'expanded',
  toggleRail: () =>
    set((s) => {
      const railExpanded = !s.railExpanded
      localStorage.setItem('asa-rail', railExpanded ? 'expanded' : 'collapsed')
      return { railExpanded }
    }),
  sidebarCollapsed: localStorage.getItem('asa-sidebar') === 'collapsed',
  toggleSidebar: () =>
    set((s) => {
      const sidebarCollapsed = !s.sidebarCollapsed
      localStorage.setItem('asa-sidebar', sidebarCollapsed ? 'collapsed' : 'expanded')
      return { sidebarCollapsed }
    }),
}))
