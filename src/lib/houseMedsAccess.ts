// WHO SEES WHAT ON HOUSE SUPPLIES — what the SPA DRAWS (design §9).
// Inventory every reader the app already admits Medications a reader who decides every house (every house, and the…
import { wornTypes } from '@/lib/badgeAccess'
import { withFollowedBadges } from '@/lib/badgeFollows'
import { EVERY_HOUSE_BADGES, GATE_REFUSED_ROLES, HOUSE_MANAGER_BADGE } from '@/lib/pageGate'

type Reader = {
  isMaster?: boolean
  types?: string[]
  derivedTypes?: string[]
  role?: string | null
} | null | undefined

export type HouseMedsReach = {
  medications: boolean
  import: boolean
  everyHouse: boolean
}

const REFUSED_BADGES: readonly string[] = ['CLIENT', 'FAMILY', 'SSA']
const NONE: HouseMedsReach = { medications: false, import: false, everyHouse: false }

export function houseMedsReach(user: Reader): HouseMedsReach {
  if (!user) return NONE
  const role = String(user.role ?? '').trim().toLowerCase()
  const worn = wornTypes(user)
  if (GATE_REFUSED_ROLES.includes(role) || worn.some((w) => REFUSED_BADGES.includes(w))) return NONE
  // shift_requests.badges_of: the badges and the role as one more word
  const words = withFollowedBadges(role ? [...worn, role.toUpperCase()] : worn)
  const everyHouse = Boolean(user.isMaster) || words.some((w) => EVERY_HOUSE_BADGES.includes(w))
  const manager = words.includes(HOUSE_MANAGER_BADGE)
  return { medications: everyHouse || manager, import: everyHouse, everyHouse }
}

export type HouseSuppliesTab = 'inventory' | 'medications' | 'import'

/** The tabs this reader is drawn, in order. */
export function tabsFor(reach: HouseMedsReach): HouseSuppliesTab[] {
  return (['inventory', 'medications', 'import'] as HouseSuppliesTab[]).filter((t) =>
    t === 'inventory' || (t === 'medications' ? reach.medications : reach.import))
}

// The tab an address asks for, when this reader may open it; else the reader's default — Medications for a…
export function tabFor(asked: string | null, reach: HouseMedsReach): HouseSuppliesTab {
  const open = tabsFor(reach)
  if (asked && (open as string[]).includes(asked)) return asked as HouseSuppliesTab
  return reach.medications ? 'medications' : 'inventory'
}
