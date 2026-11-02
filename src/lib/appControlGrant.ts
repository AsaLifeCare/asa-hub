// Settings → App Control access, on the side of the account it is shared with: the apps the master lists for this…
// It rides the session's own auth answer (`app_control`), so it is the SIGNED-IN account's and nobody else's: a…
import { useMemo } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'

export const APP_CONTROL_APP_ID = 'app-control'

export type AppControlGrant = { apps: string[]; mayChange: boolean }

type GrantInputs = {
  user: { isMaster?: boolean; appControl?: AppControlGrant } | null | undefined
  memberId: string
  worldId: string
  away: boolean
}

/** Pure: the share these inputs carry, or null. */
export function appControlGrantFrom({ user, memberId, worldId, away }: GrantInputs): AppControlGrant | null {
  if (!user || user.isMaster === true || memberId || worldId || away) return null
  const g = user.appControl
  return g && Array.isArray(g.apps) && g.apps.length ? { apps: [...g.apps], mayChange: g.mayChange === true } : null
}

function awayNow(s: { currentTenantId: string; homeTenantId: string; tenantsLoaded: boolean }): boolean {
  return Boolean(s.tenantsLoaded && s.homeTenantId && s.currentTenantId && s.currentTenantId !== s.homeTenantId)
}

/** The share the session holds right now, or null. */
export function appControlGrantNow(): AppControlGrant | null {
  return appControlGrantFrom({
    user: useAuthStore.getState().user,
    memberId: useMemberStore.getState().currentMemberId,
    worldId: useWorldStore.getState().currentWorldId,
    away: awayNow(useTenantStore.getState()),
  })
}

/** Does the session's share open this app's door? Only App Control's. */
export function appControlDelegated(appId: string): boolean {
  return appId === APP_CONTROL_APP_ID && appControlGrantNow() !== null
}

/** Reactive twin of appControlGrantNow, for App Control itself; the same object while nothing it reads changes. */
export function useAppControlGrant(): AppControlGrant | null {
  const user = useAuthStore((s) => s.user)
  const memberId = useMemberStore((s) => s.currentMemberId)
  const worldId = useWorldStore((s) => s.currentWorldId)
  const away = useTenantStore((s) => awayNow(s))
  return useMemo(() => appControlGrantFrom({ user, memberId, worldId, away }), [user, memberId, worldId, away])
}

/** The share as a short string, so a memo keyed on it re-runs when the master changes it. */
export function useAppControlGrantKey(): string {
  const g = useAuthStore((s) => s.user?.appControl)
  return g ? `${g.apps.join(',')}:${g.mayChange ? 1 : 0}` : ''
}
