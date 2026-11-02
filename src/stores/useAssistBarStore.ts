// The assist bar at the bottom of the shell — the old Jarvis bar, redrawn with our materials.
// ON or OFF is THIS USER's choice, per browser, like every UI preference here.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type AssistBarState = {
  enabled: boolean
  setEnabled: (v: boolean) => void
}

export const useAssistBarStore = create<AssistBarState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    { name: 'asa-assist-bar' },
  ),
)
