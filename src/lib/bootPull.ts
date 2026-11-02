// `hubBoot` runs the four boot reads in ONE Apps Script execution; a missing part falls back to its own pull.
import { gasAction } from '@/features/hiring/shared'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { useMembersRoster, type RosterMember } from '@/stores/useMembersRoster'
import { useTenantStore } from '@/stores/useTenantStore'

type BootAnswer = {
  prefs?: { prefs?: Record<string, string> | null }
  access?: {
    rules?: Record<string, string[]>
    configRules?: Record<string, string[]>
    tenantRules?: Record<string, string[]>
  }
  tenants?: { tenants?: unknown[] }
  members?: { members?: RosterMember[] }
}

/** What the one call managed to answer — each part the caller may skip. */
export type BootParts = {
  prefs: Record<string, string> | null
  access: boolean
  tenants: unknown[] | null
  members: RosterMember[] | null
}

const EMPTY: BootParts = { prefs: null, access: false, tenants: null, members: null }

let inFlight: Promise<BootParts> | null = null
let doneForToken: string | null = null
// WHAT THE ONE EXECUTION ANSWERED, KEPT FOR WHOEVER ASKS NEXT (2026-08-29).
let lastParts: BootParts = EMPTY

// One execution, fanned out.
export function bootPull(token: string | null): Promise<BootParts> {
  if (!token) return Promise.resolve(EMPTY)
  if (doneForToken === token && !inFlight) return Promise.resolve(lastParts)
  if (inFlight) return inFlight
  // A DIFFERENT TOKEN IS A DIFFERENT PERSON.
  lastParts = EMPTY
  inFlight = gasAction<BootAnswer>('hubBoot', {})
    .then((d) => {
      const out: BootParts = { ...EMPTY }
      if (d?.access?.rules) {
        // ONE read, THREE matrices — the same fan-out the badge pull did
        useBadgeAccessStore.getState().setRules(d.access.rules ?? {})
        useBadgeAccessStore.getState().setConfigRules(d.access.configRules ?? {})
        useBadgeAccessStore.getState().setTenantRules(d.access.tenantRules ?? {})
        out.access = true
      }
      if (Array.isArray(d?.members?.members)) {
        const rows = d.members.members.filter((m) => m.status === 'active')
        useMembersRoster.getState().adopt(rows)
        out.members = rows
      }
      if (Array.isArray(d?.tenants?.tenants)) {
        // the store's own healing still runs — only the fetch is skipped
        void useTenantStore.getState().loadTenants(d.tenants.tenants as never)
        out.tenants = d.tenants.tenants
      }
      if (d?.prefs?.prefs && typeof d.prefs.prefs === 'object') out.prefs = d.prefs.prefs
      doneForToken = token
      lastParts = out
      return out
    })
    .catch(() => {
      // NOT PUBLISHED, OR IT FAILED — every caller still has its own door, so this is silence rather than an error.
      return EMPTY
    })
    .finally(() => { inFlight = null })
  return inFlight
}
