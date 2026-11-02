// Settings → My Work, the app list (AlertsConfig.gs MYWORK_APPS_KEY): the apps only the master's own session sees.
// The server hands every other caller App Control's matrix and shelf without them, so on anybody else's screen such…
import { create } from 'zustand'
import { useAuthStore } from '@/auth/useAuthStore'
import { BADGE_FLOOR_APPS, MASTER_ONLY_APPS } from '@/lib/badgeAccess'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'

export const APPS_CUT_KEY = 'mywork_hide_apps'

type AppsCutState = { token: string | null; ids: string[] }

export const useAppsCutStore = create<AppsCutState>(() => ({ token: null, ids: [] }))

/** The cell as its ids, once each, in the order written. */
export function parseAppsCut(raw: unknown): string[] {
  const out: string[] = []
  for (const part of String(raw ?? '').split(/[,;\s]+/)) {
    const id = part.trim().slice(0, 80)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** The ids as the cell stores them. */
export function appsCutCell(ids: readonly string[]): string {
  return parseAppsCut(ids.join(',')).join(', ')
}

/** The apps the list can take: never the floor everybody lands on, never an app that is the master's already. */
export function appsCutOffered(id: string): boolean {
  return !BADGE_FLOOR_APPS.includes(id) && !MASTER_ONLY_APPS.includes(id)
}

/** Keep what a config answer says for the session that read it; an answer without the row lists none. */
export function adoptAppsCut(rows: unknown): void {
  const list = Array.isArray(rows) ? rows as { key?: unknown; value?: unknown }[] : []
  const row = list.find((r) => r && r.key === APPS_CUT_KEY)
  useAppsCutStore.setState({ token: useAuthStore.getState().token ?? null, ids: row ? parseAppsCut(row.value) : [] })
}

/** The list for the session holding it now; another token's list is nobody's. */
export function appsCutNow(): string[] {
  const s = useAppsCutStore.getState()
  return s.token && s.token === useAuthStore.getState().token ? s.ids : []
}

/** Reactive, for the master's own screens: the list while the effective account is the master, else none. */
export function useAppsCutForMaster(): string[] {
  const master = useEffectiveIsMaster()
  const token = useAuthStore((s) => s.token)
  const held = useAppsCutStore((s) => s)
  return master && held.token && held.token === token ? held.ids : []
}
