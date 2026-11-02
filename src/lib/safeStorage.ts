// A FULL SHELF MUST NEVER LOCK A SCREEN.
// zustand's persist writes on every `set`, and over plain localStorage a write that does not fit THROWS — out of…
import type { StateStorage } from 'zustand/middleware'
import { freeKeptSpace, isQuotaError } from '@/lib/kept'

export const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try { return localStorage.getItem(name) } catch { return null }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch (e) {
      if (!isQuotaError(e) || freeKeptSpace() <= 0) return
      try { localStorage.setItem(name, value) } catch { /* memory holds it for this session */ }
    }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name) } catch { /* nothing to remove, then */ }
  },
}
