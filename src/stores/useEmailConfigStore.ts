// Email config store (zustand, persisted to localStorage key "asa-email-config").
// Admin-owned for now: holds the platform email address configured in Settings → Email.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type EmailConfigState = {
  /** admin-configured platform email address */
  adminEmail: string
  setAdminEmail: (email: string) => void
}

export const useEmailConfigStore = create<EmailConfigState>()(
  persist(
    (set) => ({
      adminEmail: '',
      setAdminEmail: (adminEmail) => set({ adminEmail }),
    }),
    { name: 'asa-email-config' },
  ),
)
