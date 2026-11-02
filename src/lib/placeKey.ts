// WHERE THIS BROWSER IS STANDING — one vocabulary, one file (audit, 2026-08-18: "src/lib/placeKey.ts exists and…
// There are three axes and they are independent: the WORLD re-points the whole workbook, the TENANT narrows which…
import { useWorldStore } from '@/stores/useWorldStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useMemberStore } from '@/stores/useMemberStore'

export type Place = { world: string; tenant: string; member: string }

// Read through getState() inside function bodies only: the stores import gasAction statically, so a top-level read…
export function currentPlace(): Place {
  const world = useWorldStore.getState().currentWorldId
  // the tenantsLoaded law: until the directory answers, home and current differ for reasons that are not travel…
  const { currentTenantId, homeTenantId, tenantsLoaded } = useTenantStore.getState()
  const tenant = tenantsLoaded && homeTenantId && currentTenantId !== homeTenantId ? currentTenantId : ''
  return { world, tenant, member: useMemberStore.getState().currentMemberId }
}

// Do two standings mean the same place?
export function samePlace(a: Partial<Place> | undefined, b: Place): boolean {
  return (a?.world ?? '') === b.world &&
         (a?.tenant ?? '') === b.tenant &&
         (a?.member ?? '') === b.member
}

// The prefix every remembered thing carries.
export function placeScope(name: string, p: Place = currentPlace()): string {
  let out = name
  if (p.tenant) out = `t:${p.tenant}:${out}`
  if (p.member) out = `m:${p.member}:${out}`
  if (p.world) out = `w:${p.world}:${out}`
  return out
}

// THE PLACE KEY for a per-place row (Profile.gs's user_place_profiles): '' = home, a tenant id on travel…
export function currentPlaceKey(): string {
  const { world, tenant } = currentPlace()
  if (world) return `world:${world}`
  return tenant
}
