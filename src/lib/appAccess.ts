// THE ONE ACCESS CHECKER — may this person open this app?
// What decides, in order: 1.
import type { Role } from '@/auth/types'
import type { AppManifest } from '@/engine/types'
import { isManifestVisible } from '@/lib/audience'
import { badgeAllowsApp, tenantAllowsApp, MASTER_ONLY_APPS, TENANT_BASIC_APPS, useBadgeAccessStore } from '@/lib/badgeAccess'
import { featureAllowsWith } from '@/lib/featureAccess'
import { useAuthStore } from '@/auth/useAuthStore'
import { appsCutNow, useAppsCutStore } from '@/lib/appsCut'
import { appControlDelegated, useAppControlGrantKey } from '@/lib/appControlGrant'
import { MYASA_APP_ID, myAsaOffered, useMyAsaOffered } from '@/lib/myAsaOffered'
import { effectiveUser } from '@/lib/effectiveUser'
import { pageGateAllows } from '@/lib/pageGate'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { activeWorldId } from '@/stores/useWorldStore'

// Audience-derived default for one app + role (enabled apps only).
function defaultAllowed(role: Role | null | undefined, app: AppManifest): boolean {
  return app.enabled && isManifestVisible(app, { role })
}

// A master-only app opens for the master, on company ground, and for nobody else anywhere — but for an account the…
export function masterOnlyRefused(appId: string): boolean {
  if (!MASTER_ONLY_APPS.includes(appId)) return false
  if (activeWorldId()) return true
  return effectiveUser()?.isMaster !== true && !appControlDelegated(appId)
}

/** Pure effective check against a manifest list; a `pageId` also asks that page's own gate (lib/pageGate). */
export function isAllowedWith(
  apps: AppManifest[],
  role: Role | null | undefined,
  appId: string,
  pageId?: string,
): boolean {
  const app = apps.find((a) => a.id === appId)
  if (!app) return false
  if (masterOnlyRefused(appId)) return false
  if (pageId) {
    const gate = app.pages.find((p) => p.id === pageId)?.gate
    if (gate && !activeWorldId() && !pageGateAllows(gate, effectiveUser())) return false
    // a page an App Control control opens (the master's alone until released, when the control says so) — but an
    // edition that OPENS the app opens all of its pages, full access, to the people it names
    const feature = app.pages.find((p) => p.id === pageId)?.feature
    const editionOpensApp = effectiveUser()?.editionApps?.includes(appId) === true
    if (feature && !editionOpensApp && !featureAllowsWith(feature, effectiveUser(), useBadgeAccessStore.getState().rules)) return false
  }
  // inside a world the registry serves only world apps, so being in the list is the grant
  if (activeWorldId()) return app.enabled !== false
  // Settings → My Work's app list, held only where the master read it (lib/appsCut): a visit sees it shut, as the server answers one
  if (effectiveUser()?.isMaster !== true && appsCutNow().includes(appId)) return false
  // the session's own my_asa (lib/myAsaOffered): no means the app was never there
  if (appId === MYASA_APP_ID && !myAsaOffered()) return false
  // App Control shared with this account opens its door, and no badge row decides it; the screen shows the server's list alone
  if (MASTER_ONLY_APPS.includes(appId) && effectiveUser()?.isMaster !== true) {
    return appControlDelegated(appId) && defaultAllowed(role, app)
  }
  // getState() reads are deliberate: callers re-memo on the badge store via useBadgeRulesVersion() below, so the…
  const badges = useBadgeAccessStore.getState()
  // THE MATRIX IS THE DOOR — the factory default is App access by badge.
  if (!badgeAllowsApp(appId, effectiveUser(), badges.rules)) return false
  // the master's own screen is never narrowed by place: a tenant row on it could lock him out with no screen left to undo it
  if (MASTER_ONLY_APPS.includes(appId)) return defaultAllowed(role, app)
  const { currentTenantId, homeTenantId, tenantsLoaded } = useTenantStore.getState()
  // THE BASICS ARE A FLOOR, NOT A CHOICE: a new place has to start with the Users app so that it does not open…
  if (!TENANT_BASIC_APPS.includes(appId) &&
      !tenantAllowsApp(appId, currentTenantId, badges.tenantRules)) return false
  // A FOREIGN TENANT STARTS FROM SCRATCH — another tenant begins with only the basics it needs in order to operate.
  const away = Boolean(tenantsLoaded && homeTenantId && currentTenantId &&
                       currentTenantId !== homeTenantId)
  // tenantRules is keyed by app id: the tenants each app belongs to
  const installedHere = Boolean(badges.tenantRules[appId]?.includes(currentTenantId))
  if (away && !installedHere && !TENANT_BASIC_APPS.includes(appId)) return false
  return defaultAllowed(role, app)
}

// The floor lives in lib/badgeAccess (the pure module) so the badge law can consult it too — an app nobody has…
export { TENANT_BASIC_APPS } from '@/lib/badgeAccess'

// Subscribe a component to the badge rules so its access memo re-runs when the master edits the matrix (or the…
export function useBadgeRulesVersion(): string {
  const rules = useBadgeAccessStore((s) => s.rules)
  const tenantRules = useBadgeAccessStore((s) => s.tenantRules)
  const tenantId = useTenantStore((s) => s.currentTenantId)
  const homeId = useTenantStore((s) => s.homeTenantId)
  const tenantsLoaded = useTenantStore((s) => s.tenantsLoaded)
  const denials = useAuthStore((s) => s.user?.appDenials)
  // the visited person too: isAllowedWith answers for the effective identity
  const memberId = useMemberStore((s) => s.currentMemberId)
  const memberEpoch = useMemberStore((s) => s.memberEpoch)
  const cut = useAppsCutStore((s) => `${s.token ?? ''}:${s.ids.join(',')}`)
  const myAsa = useMyAsaOffered()
  // App Control shared with this account (lib/appControlGrant): its tile comes and goes with the share
  const shared = useAppControlGrantKey()
  const encode = (m: Record<string, string[]>) =>
    Object.entries(m)
      .map(([appId, list]) => `${appId}:${[...list].sort().join('.')}`)
      .sort()
      .join('|')
  // the tenant, home and loaded flag too: each changes the answer for every app
  return `${encode(rules)}::${encode(tenantRules)}::${tenantId}::${homeId}:${tenantsLoaded ? 1 : 0}::${[...(denials ?? [])].sort().join(',')}::${memberId}:${memberEpoch}::${cut}::${myAsa ? 1 : 0}::${shared}`
}

// Checker for chrome (Sidebar, App Hub, ⌘K) and guards.
export function selectAccessChecker(apps: AppManifest[], role: Role | null | undefined) {
  return (appId: string, pageId?: string) => isAllowedWith(apps, role, appId, pageId)
}
