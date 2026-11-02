// Unfinished-work drafts: leaving a screen with something typed but not saved leaves a thin post-it peeking from…
// What is stored is the REMINDER, not the content: { id, label, href, at }.
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { useAuthStore } from '@/auth/useAuthStore'

export type DraftEntry = {
  id: string
  /** Plain words shown on the post-it row, e.g. "An unsent Kanban card". */
  label: string
  /** Where to take the person back to: pathname + search at typing time. */
  href: string
  /** Epoch ms when the draft was (last) registered — newest first. */
  at: number
}

export type DraftState = {
  drafts: Record<string, DraftEntry>
  setDraft: (id: string, label: string, href: string) => void
  clearDraft: (id: string) => void
}

/** asa-auth hydrates synchronously at module init, so the user is known here. */
const keyFor = (name: string): string => {
  const uid = useAuthStore.getState().user?.id
  return uid ? `${name}:${uid}` : name
}

const perUserStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(keyFor(name)),
  setItem: (name, value) => localStorage.setItem(keyFor(name), value),
  removeItem: (name) => localStorage.removeItem(keyFor(name)),
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (id, label, href) =>
        set((s) => {
          const prev = s.drafts[id]
          // same reminder already on record — no write, no re-render
          if (prev && prev.label === label && prev.href === href) return s
          return { drafts: { ...s.drafts, [id]: { id, label, href, at: Date.now() } } }
        }),
      clearDraft: (id) =>
        set((s) => {
          if (!s.drafts[id]) return s
          const next = { ...s.drafts }
          delete next[id]
          return { drafts: next }
        }),
    }),
    { name: 'asa-drafts', storage: createJSONStorage(() => perUserStorage) },
  ),
)

/** The post-it's list: newest first. */
export const selectDraftList = (s: DraftState): DraftEntry[] =>
  Object.values(s.drafts).sort((a, b) => b.at - a.at)
