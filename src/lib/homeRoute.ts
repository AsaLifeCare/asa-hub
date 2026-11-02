// Where a signed-in user lands.
// Everyone goes to My Work. Nobody lands on the Overview (the operator, 2026-10-30): anyone My Work is not released to
// goes to the App Hub, and the choice waits for this sign-in's matrix (lib/matrixLanded).
import type { Role } from '@/auth/types'
import { isManifestVisible } from '@/lib/audience'
import { isAllowedWith, masterOnlyRefused } from '@/lib/appAccess'
import { restrictedAppsFor } from '@/lib/roleAccess'
import { MY_WORK_APP_ID, MY_WORK_PAGE_ID } from '@/registry/apps-mywork'
import { useRegistryStore } from '@/stores/useRegistryStore'

export const DEFAULT_HOME = '/apps'
export const MY_WORK_HOME = `/app/${MY_WORK_APP_ID}/${MY_WORK_PAGE_ID}`

// Fallback first pages for allow-listed apps, used before the registry finishes loading (keeps the very first…
const FALLBACK_PAGE: Record<string, string> = {
  hiring: 'pipeline',
}

// My Work when the route guard would let this role through it.
function myWorkOpens(role: Role | null | undefined): boolean {
  const apps = useRegistryStore.getState().apps
  if (!apps.length) return true
  const app = apps.find((a) => a.id === MY_WORK_APP_ID)
  if (!app || !app.enabled || masterOnlyRefused(MY_WORK_APP_ID)) return false
  if (!isManifestVisible(app, { role })) return false
  return isAllowedWith(apps, role, MY_WORK_APP_ID)
}

export function homeRouteFor(role: Role | null | undefined): string {
  const allow = restrictedAppsFor(role)
  if (!allow || allow.length === 0) return myWorkOpens(role) ? MY_WORK_HOME : DEFAULT_HOME
  const apps = useRegistryStore.getState().apps
  for (const id of allow) {
    const app = apps.find((a) => a.id === id)
    const pageId = app?.pages?.[0]?.id ?? FALLBACK_PAGE[id]
    if (pageId) return `/app/${id}/${pageId}`
  }
  return '/apps'
}
