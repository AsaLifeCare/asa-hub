// Right contextual detail panel (§7.4).
// Hosts a `detail` page-type instance: any template opens it with a DetailTemplate config + the record it describes.
import { create } from 'zustand'

export type DetailPanelPayload = {
  /** DetailTemplate config (page-types.md §7) */
  config: Record<string, unknown>
  /** the record being shown (templates may resolve fields from it) */
  record?: Record<string, unknown>
}

type DetailPanelState = {
  panel: DetailPanelPayload | null
  openDetail: (p: DetailPanelPayload) => void
  closeDetail: () => void
}

export const useDetailPanelStore = create<DetailPanelState>((set) => ({
  panel: null,
  openDetail: (panel) => set({ panel }),
  closeDetail: () => set({ panel: null }),
}))
