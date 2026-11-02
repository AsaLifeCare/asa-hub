// Per-user icon-avatar overrides (house rule: UI preferences are per user, never global).
// Maps a record id to the icon + tint chosen in the drawer's TilePicker; persisted to localStorage…
import { create } from 'zustand'
import type { FallbackTint } from '@/components/shared/SafeImg'

export type AvatarPref = { icon: string; tint: FallbackTint }

type AvatarPrefsState = {
  prefs: Record<string, AvatarPref>
  setAvatar: (id: string, pref: AvatarPref) => void
}

const STORAGE_KEY = 'asa-avatar-prefs'

function load(): Record<string, AvatarPref> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const useAvatarPrefsStore = create<AvatarPrefsState>((set) => ({
  prefs: load(),
  setAvatar: (id, pref) =>
    set((s) => {
      const prefs = { ...s.prefs, [id]: pref }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
      // durable per-user prefs: sync the bundle to the Hub sheet (debounced)
      void import('@/lib/prefsSync').then((m) => m.schedulePrefsPush())
      return { prefs }
    }),
}))
