/** What Time Off draws before the relay answers; every door decides again (server/time_off.scope_of). */
import { wornTypes } from '@/lib/badgeAccess'
import { withFollowedBadges } from '@/lib/badgeFollows'
import { EVERY_HOUSE_BADGES, EVERY_HOUSE_ROLES, HOUSE_MANAGER_BADGES } from '@/lib/pageGate'

type Reader = {
  isMaster?: boolean
  types?: string[]
  derivedTypes?: string[]
  role?: string | null
} | null | undefined

export const TIME_OFF_REFUSED_ROLES: readonly string[] = ['client', 'guardian', 'onboarding', 'interviewer']
const REFUSED_BADGES: readonly string[] = ['CLIENT', 'FAMILY', 'SSA']
const WORKING_ROLES: readonly string[] = ['staff', 'manager', 'admin']

export type TimeOffReach = {
  /** the app is drawn at all */
  opens: boolean
  /** a first guess at the rows, until the feed's own `me.scope` arrives */
  scope: 'refused' | 'own' | 'houses' | 'all'
  everyHouse: boolean
  /** Settings → Time Off */
  settings: boolean
}

const NONE: TimeOffReach = { opens: false, scope: 'refused', everyHouse: false, settings: false }

export function timeOffReach(user: Reader): TimeOffReach {
  if (!user) return NONE
  const role = String(user.role ?? '').trim().toLowerCase()
  const worn = wornTypes(user)
  // an SSA or a FAMILY reads none of it, whatever its role says (server: time_off.refused_reader)
  if (worn.includes('FAMILY') || worn.includes('SSA')) return NONE
  if (TIME_OFF_REFUSED_ROLES.includes(role)) return NONE
  if (!WORKING_ROLES.includes(role) && worn.some((w) => REFUSED_BADGES.includes(w))) return NONE
  const words = withFollowedBadges(role ? [...worn, role.toUpperCase()] : worn)
  const everyHouse = Boolean(user.isMaster) || words.some((w) => EVERY_HOUSE_BADGES.includes(w))
  const scope = everyHouse || EVERY_HOUSE_ROLES.includes(role) ? 'all'
    : words.some((w) => HOUSE_MANAGER_BADGES.includes(w)) ? 'houses' : 'own'
  return { opens: true, scope, everyHouse, settings: Boolean(user.isMaster) || role === 'admin' }
}
