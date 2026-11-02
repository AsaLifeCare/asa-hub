// Page gates (`PageSchema.gate`): `house-manager` (HM worn or ticked, TEAMLEAD, or an every-house editor), `every-house`…
// Mirrors shift_requests.edits_every_house and CALENDAR_REFUSED_ROLES (tools/check-badges.mjs holds them equal).
import { roleWordCounts } from '@/lib/badgeAccess'
import { withFollowedBadges } from '@/lib/badgeFollows'

export type PageGate = 'house-manager' | 'every-house' | 'no-client'

/** shift_requests.REASON_BADGES — the badges that decide in every house. */
export const EVERY_HOUSE_BADGES: readonly string[] = ['MASTER', 'DIRECTOR', 'ADMINISTRATOR', 'ADMIN']
/** shift_requests.CALENDAR_EDIT_ROLES — the one named role exception. */
export const EVERY_HOUSE_ROLES: readonly string[] = ['manager']
/** shift_requests.CALENDAR_REFUSED_ROLES — never a calendar screen. */
export const GATE_REFUSED_ROLES: readonly string[] = ['client', 'guardian']
/** shift_requests.CALENDAR_BADGE — the badge a current ** manager wears. */
export const HOUSE_MANAGER_BADGE = 'HM'
/** The badges a house manager's gate admits: HM, and TEAMLEAD beside it — the operator's matrix gives a team lead
 *  the house manager's column (2026-10-29), never the director's reach. */
export const HOUSE_MANAGER_BADGES: readonly string[] = [HOUSE_MANAGER_BADGE, 'TEAMLEAD']

type GateUser = {
  isMaster?: boolean
  types?: string[]
  derivedTypes?: string[]
  role?: string | null
} | null | undefined

/** Badges, role and followed badges, folded as the relay does. */
function worn(user: GateUser): string[] {
  const words = [...(user?.types ?? []), ...(user?.derivedTypes ?? [])]
  if (user?.role) words.push(String(user.role))
  return withFollowedBadges(words.map((w) => String(w).trim().toUpperCase()).filter(Boolean))
}

/** Whether this person passes the gate; no gate is true. */
export function pageGateAllows(gate: PageGate | undefined, user: GateUser): boolean {
  if (!gate) return true
  if (!user) return false
  if (user.isMaster) return true
  const role = String(user.role ?? '').trim().toLowerCase()
  // an SSA or a FAMILY, whatever its role says, is refused as a client is (badgeAccess.roleWordCounts)
  if (GATE_REFUSED_ROLES.includes(role) || !roleWordCounts(user as { types?: string[]; role?: string })) return false
  if (gate === 'no-client') return true
  const words = worn(user)
  const everyHouse = EVERY_HOUSE_ROLES.includes(role)
    || words.some((w) => EVERY_HOUSE_BADGES.includes(w))
  if (gate === 'every-house') return everyHouse
  return everyHouse || words.some((w) => HOUSE_MANAGER_BADGES.includes(w))
}

/** Whether any account of this role could pass (for the manifest emitter's roles line). */
export function pageGateReachesRole(gate: PageGate | undefined, role: string): boolean {
  if (!gate) return true
  return !GATE_REFUSED_ROLES.includes(String(role).toLowerCase())
}
