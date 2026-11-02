// THE ONE CROSSING — every door that changes where you are standing.
// WHY THIS FILE EXISTS.
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { rebootIntoWorkspace } from '@/lib/reboot'
import { homeRouteFor } from '@/lib/homeRoute'
import { useAuthStore } from '@/auth/useAuthStore'
import { worldOffered } from '@/lib/worldOffered'

/** The member a roster row describes — what `enterMember` needs. */
export type CrossMember = {
  member_id: string; name: string; role: string; scope: string
  types?: string[]; world_id?: string
  avatar?: string; email?: string; title?: string
}

/** Is a crossing already under way? Every door checks this before moving. */
export function crossing(): boolean {
  return Boolean(useWorldStore.getState().switching)
}

// Put down every axis.
function putDownAll(): void {
  if (useMemberStore.getState().currentMemberId) useMemberStore.getState().leaveMember()
  if (useWorldStore.getState().currentWorldId) {
    useWorldStore.setState({ currentWorldId: '', worldName: '' })
  }
}

// COMPANY GROUND, AT THE HOME TENANT — the way out of anything.
export function crossHome(label?: string): void {
  if (crossing()) return
  const { currentTenantId, homeTenantId } = useTenantStore.getState()
  if (currentTenantId !== homeTenantId) useTenantStore.getState().setTenant(homeTenantId)
  putDownAll()
  // HOME LANDS AT HOME: the boot used to wake in the App Hub — the hash names the role's own home page instead.
  let home = ''
  try {
    home = homeRouteFor(useAuthStore.getState().user?.role)
  } catch { home = '' }
  rebootIntoWorkspace(label ?? 'Coming home to ASA LifeCare', home ? '#' + home : undefined)
}

// LEAVE THE VISIT — and the world that came with it.
export function leaveVisit(label = 'Back to your workspace'): void {
  if (crossing()) return
  putDownAll()
  rebootIntoWorkspace(label)
}

// Another company face.
export function crossToTenant(tenantId: string, label?: string): void {
  if (crossing()) return
  putDownAll()
  useTenantStore.getState().setTenant(tenantId)
  rebootIntoWorkspace(label)
}

// YOUR OWN WORLD.
export function crossToMyWorld(): void {
  if (crossing() || !worldOffered()) return
  putDownAll()
  void useWorldStore.getState().switchToWorld()
}

/** Somebody's WORK — company ground, wearing their badge. */
export function crossToMemberWork(m: CrossMember, label?: string): void {
  if (crossing()) return
  putDownAll()
  useMemberStore.getState().enterMember(m)
  rebootIntoWorkspace(label ?? `Opening ${m.name || 'their'}'s work`)
}

// Somebody's WORLD.
export function crossToMemberWorld(m: CrossMember, label?: string): void {
  if (crossing() || !m.world_id || !worldOffered()) return
  putDownAll()
  useMemberStore.getState().enterMember(m)
  useWorldStore.getState().enterWorld(m.world_id, `${m.name || 'Their'}'s world`)
  rebootIntoWorkspace(label ?? `Opening ${m.name || 'their'}'s world`)
}
