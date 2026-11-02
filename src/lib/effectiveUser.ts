// WHO THIS SCREEN IS DRAWN FOR — the signed-in account normally, the visited member while a visit is open.
// THE BUG THIS FILE EXISTS FOR, after five rounds: "Their work" rendered the viewer's OWN My work.
import { useMemo } from 'react'
import type { AuthUser, Role } from '@/auth/types'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'

// The server's own ranking (Members.gs `HUB_ROLE_RANK`).
const ROLE_RANK: Record<string, number> = {
  admin: 4, manager: 3, staff: 2, onboarding: 1, client: 1,
}

function rankOf(role: string | null | undefined): number {
  return ROLE_RANK[String(role ?? '').toLowerCase()] ?? 0
}

const upper = (list: readonly string[] | null | undefined) =>
  (list ?? []).map((t) => String(t).toUpperCase().trim()).filter(Boolean)

// The shape every access question needs, and nothing else.
export type EffectiveUser = {
  /** the account whose workspace is drawn — the visited person while visiting */
  id: string
  name: string
  role: Role | undefined
  types: string[]
  /** badges worn by code (a current ** manager's HM); absent during a visit */
  derivedTypes?: string[]
  // FALSE FOR THE WHOLE OF A VISIT, whoever is visiting.
  isMaster: boolean
  // narrowing only, and the SIGNED-IN account's: a visit may not lift a denial the master wrote against the…
  appDenials?: string[]
  /** apps an edition opens to the signed-in person by name (Settings › Editions); a visit grants none */
  editionApps?: string[]
  /** true exactly while a member visit is open */
  visiting: boolean
}

/** The visited half — what `useMemberStore` holds, as a plain value. */
export type MemberVisit = {
  memberId: string
  name: string
  role: string
  types: string[]
}

// PURE, and that is the point: the whole law is one function of two values, so the self-test and the next reader…
export function effectiveUserFrom(
  user: Pick<AuthUser, 'id' | 'name' | 'role' | 'types' | 'isMaster' | 'appDenials'>
    & Partial<Pick<AuthUser, 'derivedTypes' | 'editionApps'>> | null | undefined,
  visit: MemberVisit | null | undefined,
): EffectiveUser | null {
  if (!user) return null
  const mine: EffectiveUser = {
    id: String(user.id ?? ''),
    name: String(user.name ?? ''),
    role: user.role ?? undefined,
    types: upper(user.types),
    // worn by code; only the calendar apps and the page gates read it
    derivedTypes: upper(user.derivedTypes).filter((t, i, all) => all.indexOf(t) === i),
    isMaster: user.isMaster === true,
    appDenials: user.appDenials,
    // the apps an edition opens to this account by name; carried for the access checker (lib/appAccess)
    editionApps: user.editionApps,
    visiting: false,
  }
  if (!visit || !visit.memberId) return mine
  // the weaker of the two roles (memberClampRole_)
  const theirRole = String(visit.role ?? '').trim()
  const role = (rankOf(theirRole) <= rankOf(user.role) ? theirRole : String(user.role ?? '')) as Role
  // the badges BOTH wear (memberClampTypes_) — a visit hands out nothing
  const theirs = upper(visit.types)
  const types = theirs.filter((t) => mine.types.includes(t))
  return {
    id: String(visit.memberId),
    name: String(visit.name ?? ''),
    role: role || undefined,
    types,
    isMaster: false,
    appDenials: user.appDenials,
    visiting: true,
  }
}

/** The live visit ('' memberId = nobody). */
function currentVisit(): MemberVisit | null {
  const m = useMemberStore.getState()
  if (!m.currentMemberId) return null
  return { memberId: m.currentMemberId, name: m.memberName, role: m.memberRole, types: m.memberTypes }
}

// Non-reactive read, for the pure checkers (`lib/appAccess`, `lib/settingsNav`) that already re-memo on…
export function effectiveUser(): EffectiveUser | null {
  return effectiveUserFrom(useAuthStore.getState().user, currentVisit())
}

// Reactive: re-renders on sign-in, on a profile change, and on a crossing.
export function useEffectiveUser(): EffectiveUser | null {
  const user = useAuthStore((s) => s.user)
  const memberId = useMemberStore((s) => s.currentMemberId)
  const memberName = useMemberStore((s) => s.memberName)
  const memberRole = useMemberStore((s) => s.memberRole)
  const memberTypes = useMemberStore((s) => s.memberTypes)
  return useMemo(
    () => effectiveUserFrom(
      user,
      memberId ? { memberId, name: memberName, role: memberRole, types: memberTypes } : null,
    ),
    [user, memberId, memberName, memberRole, memberTypes],
  )
}

/** The role every audience filter and access checker should be handed. */
export function useEffectiveRole(): Role | undefined {
  return useEffectiveUser()?.role
}

/** The master's blanket pass — never lent to a visit. */
export function useEffectiveIsMaster(): boolean {
  return useEffectiveUser()?.isMaster === true
}
