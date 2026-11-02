// The platform's e-mail composer (global).
// ANY USER, ANY SCREEN, ONE GESTURE.
import { create } from 'zustand'

export type EmailDraft = {
  /** prefilled recipient — the user can always retype it */
  to?: string
  subject?: string
  /** prefilled body — a record, a table as text, whatever the screen offers */
  body?: string
  /** where the draft came from, for the header ("Client Record", "Archive") */
  source?: string
}

type EmailComposeState = {
  draft: EmailDraft | null
  composeEmail: (d: EmailDraft) => void
  closeCompose: () => void
}

export const useEmailComposeStore = create<EmailComposeState>((set) => ({
  draft: null,
  composeEmail: (draft) => set({ draft }),
  closeCompose: () => set({ draft: null }),
}))

/** Imperative helper — usable from event handlers outside React components. */
export const composeEmail = (d: EmailDraft) => useEmailComposeStore.getState().composeEmail(d)
