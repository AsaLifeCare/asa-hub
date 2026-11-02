// User-menu links store — SERVER-BACKED since 2026-08-15.
// These are the links rendered in the topbar avatar dropdown, below the identity block (name/email/photo), above…
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useAuthStore } from '@/auth/useAuthStore'
import { gasAction } from '@/features/hiring/shared'

export type UserMenuItem = {
  id: string
  label: string
  /** kebab-case lucide icon name (rendered via <AppIcon/>). */
  icon: string
  /** in-app path ('/app/…') or absolute URL when `external`. */
  href: string
  external?: boolean
  /** Badge words that see this link — EMPTY = every badge (everyone). */
  badges: string[]
  /** Server-side order (rows come back sorted; kept for round-tripping). */
  sort?: number
  /** Stamped by the server on every `userMenuLinksSet` — the audit line. */
  updated_at?: string
  updated_by?: string
}

// Load state of the server pull, THIS SESSION ONLY (never persisted).
export type UserMenuPullStatus = 'idle' | 'loading' | 'ready' | 'error'

type UserMenuState = {
  /** The one platform-wide list, raw (unfiltered) and in server order. */
  links: UserMenuItem[]
  /** ISO stamp of the last successful server pull ('' before the first). */
  fetchedAt: string
  /** Session-scoped: has THIS page load read the server list? */
  status: UserMenuPullStatus
  /** Why the last pull failed ('' unless `status` is 'error'). */
  error: string
  setLinks: (links: UserMenuItem[]) => void
  setPull: (pull: { status: UserMenuPullStatus; error?: string }) => void
}

export const useUserMenuStore = create<UserMenuState>()(
  persist(
    (set) => ({
      links: [],
      fetchedAt: '',
      status: 'idle',
      error: '',
      // a successful save IS the server's truth for this session — the write that lands is the list, so the card…
      setLinks: (links) =>
        set({ links, fetchedAt: new Date().toISOString(), status: 'ready', error: '' }),
      setPull: ({ status, error = '' }) => set({ status, error }),
    }),
    {
      name: 'asa-user-menu',
      // The kept copy paints the menu instantly; the load state must NOT ride along — a rehydrated 'ready' would…
      partialize: (s) => ({ links: s.links, fetchedAt: s.fetchedAt }),
      // v0 was { items: Record<tenantId, …> } with demo seeds — the shape that swallowed the real links.
      version: 1,
      migrate: (persisted, version) =>
        (version < 1 ? { links: [], fetchedAt: '' } : persisted) as UserMenuState,
    },
  ),
)

// Reactive raw list (filtered for NOBODY — Topbar applies the viewer's badges, Settings shows every row).
export function useUserMenuItems(tenantId?: string | null): UserMenuItem[] {
  void tenantId // compatibility only — the per-tenant Record is gone
  return useUserMenuStore((s) => s.links)
}

/* ---- self-wiring: pull once per session when a token appears ---- */

let pulledForToken: string | null = null
let inFlight: Promise<void> | null = null

// The same answer, arriving from the bundle instead of an execution (2026-08-29).
export function seedUserMenuLinks(links: unknown, token: string | null): void {
  if (!token || pulledForToken === token || !Array.isArray(links)) return
  pulledForToken = token
  useUserMenuStore.getState().setLinks(
    (links as UserMenuItem[]).map((l) => ({
      ...l,
      badges: Array.isArray(l.badges) ? l.badges : [],
    })),
  )
  useUserMenuStore.getState().setPull({ status: 'ready' })
}

// Fetch the server list (same pattern as prefsSync.ts): once per sign-in by default, and on demand with `{ force…
export async function pullUserMenuLinks(opts?: { force?: boolean }): Promise<void> {
  const token = useAuthStore.getState().token
  if (!token) {
    // 'error', not a silent return: a card that gates on this status would spin forever on a session that expired…
    useUserMenuStore.getState().setPull({ status: 'error', error: 'Signed out — sign in again to read the menu links.' })
    return
  }
  if (!opts?.force && token === pulledForToken) return
  if (inFlight) return inFlight
  pulledForToken = token
  useUserMenuStore.getState().setPull({ status: 'loading' })
  inFlight = (async () => {
    try {
      const { links } = await gasAction<{ links: UserMenuItem[] | null }>('userMenuLinksList', {})
      useUserMenuStore.getState().setLinks(
        (Array.isArray(links) ? links : []).map((l) => ({
          ...l,
          // an old row without the column must mean "everyone", not a crash
          badges: Array.isArray(l.badges) ? l.badges : [],
        })),
      )
    } catch (err) {
      pulledForToken = null // kept copy still paints; retried next sign-in
      // 'error', never a silent fall back to the kept copy: the whole-list write must not fire over a list nobody…
      useUserMenuStore.getState().setPull({
        status: 'error',
        error: err instanceof Error ? err.message : 'Could not read the menu links.',
      })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

// The build's snapshot-manifest emitter imports modules in Node behind a bare `window` shim (see src/lib/api.ts)…
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  queueMicrotask(() => {
    void pullUserMenuLinks()
  })
  useAuthStore.subscribe(() => {
    void pullUserMenuLinks()
  })
}
