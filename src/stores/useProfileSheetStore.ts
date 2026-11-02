/** Open/close state for the "My profile" side sheet (mounted in Topbar).
 *  Opened from the avatar menu and from the My asa. profile card. */
import { create } from 'zustand'

type ProfileSheetState = {
  open: boolean
  setOpen: (v: boolean) => void
}

export const useProfileSheetStore = create<ProfileSheetState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
