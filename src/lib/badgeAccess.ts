// APP ACCESS BY BADGE: the master's matrix — every app, which badges reach it — plus the per-person narrowing (the…
// The SERVER holds both truths (`app_badge_access` tab and the users tab's `app_denials` column); this store is the…
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { withFollowedBadges } from '@/lib/badgeFollows'
import { safeLocalStorage } from '@/lib/safeStorage'

type BadgeAccessState = {
  /** appId → badges allowed. Absent = open to audience. */
  rules: Record<string, string[]>
  // settings section id → badges allowed.
  configRules: Record<string, string[]>
  /** appId → the tenants it belongs to. Absent = every tenant. */
  tenantRules: Record<string, string[]>
  fetchedAt: string
  setRules: (rules: Record<string, string[]>) => void
  setRule: (appId: string, badges: string[]) => void
  setConfigRules: (rules: Record<string, string[]>) => void
  setConfigRule: (sectionId: string, badges: string[]) => void
  setTenantRules: (rules: Record<string, string[]>) => void
  setTenantRule: (appId: string, tenants: string[]) => void
}

export const useBadgeAccessStore = create<BadgeAccessState>()(
  persist(
    (set) => ({
      rules: {},
      configRules: {},
      tenantRules: {},
      fetchedAt: '',
      setRules: (rules) => set({ rules, fetchedAt: new Date().toISOString() }),
      setRule: (appId, badges) =>
        set((s) => {
          const next = { ...s.rules }
          if (badges.length) next[appId] = badges
          else delete next[appId]
          return { rules: next }
        }),
      setConfigRules: (configRules) => set({ configRules }),
      setTenantRules: (tenantRules) => set({ tenantRules }),
      setTenantRule: (appId, tenants) =>
        set((s) => {
          const next = { ...s.tenantRules }
          if (tenants.length) next[appId] = tenants
          else delete next[appId]
          return { tenantRules: next }
        }),
      setConfigRule: (sectionId, badges) =>
        set((s) => {
          const next = { ...s.configRules }
          if (badges.length) next[sectionId] = badges
          else delete next[sectionId]
          return { configRules: next }
        }),
    }),
    { name: 'asa-badge-access', storage: createJSONStorage(() => safeLocalStorage) },
  ),
)

// Pure: does this person wear one of the badges a rule names?
function badgesOf(user: { types?: string[]; role?: string } | null | undefined): string[] {
  const out = wornTypes({ types: user?.types })
  const role = String(user?.role ?? '').toUpperCase().trim()
  if (role && !out.includes(role) && roleWordCounts(user)) out.push(role)
  return withFollowedBadges(out)
}

/** THE FAMILY/SSA-WEARER RULE: an account whose ticked badges include FAMILY or SSA (the operator's FIX BADGES
 *  sheet, 10-30) is matched on its badges alone — its role word (staff, or client on a guardian's account) opens
 *  nothing; the rows name SSA and FAMILY themselves (server: scope.role_counts). */
export function roleWordCounts(user: { types?: string[]; role?: string } | null | undefined): boolean {
  const worn = wornTypes({ types: user?.types })
  return !worn.includes('FAMILY') && !worn.includes('SSA')
}

/** The only apps a badge worn by code opens (snapshot_service.CALENDAR_BADGE_APPS). */
export const CALENDAR_BADGE_APPS: readonly string[] = ['calendarbuilder', 'shiftboard']

/** Ticked badges plus those worn by code (AuthUser.derivedTypes); `types` is never touched. */
export function wornTypes(user: { types?: string[]; derivedTypes?: string[] } | null | undefined): string[] {
  const out: string[] = []
  for (const t of [...(user?.types ?? []), ...(user?.derivedTypes ?? [])]) {
    // a cell written before 10-30 says GUARDIAN for FAMILY (scope.BADGE_RENAMED)
    const raw = String(t).toUpperCase().trim()
    const w = raw === 'GUARDIAN' ? 'FAMILY' : raw
    if (w && !out.includes(w)) out.push(w)
  }
  return out
}

// THE SAME QUESTION, WITHOUT THE ROLE — for rules written about BADGES ALONE.
export function badgeLinkAllows(
  rule: string[] | undefined,
  // `role` is accepted and NOT READ.
  user: { isMaster?: boolean; types?: string[]; role?: string } | null | undefined,
): boolean {
  if (!rule || rule.length === 0) return true    // no badges = every badge
  if (!user) return false
  if (user.isMaster) return true                 // the master sees every link
  // the ticked badges, never the role nor a badge worn by code
  const worn = withFollowedBadges(wornTypes({ types: user.types }))
  return rule.some((b) => worn.includes(String(b).toUpperCase().trim()))
}

export function badgeRuleAllows(
  rule: string[] | undefined,
  user: { isMaster?: boolean; types?: string[]; role?: string } | null | undefined,
): boolean {
  if (!user) return false
  if (user.isMaster) return true      // the master's view is never narrowed
  if (!rule || rule.length === 0) return true
  // the role counts as a badge here too, as in badgeAllowsApp
  return rule.some((b) => badgesOf(user).includes(b))
}

// Pure: may THIS user open THIS app, by badge rule + personal denial?
export const TENANT_BASIC_APPS = ['myasa', 'users', 'chat', 'suggestions', 'teamboard', 'calendar',
  // AND THE STUDIO: in a franchise, access to the Playground was removed — and the Playground is one of the most…
  'playground']

// THE ONE APP NO MATRIX CAN TAKE AWAY.
export const BADGE_FLOOR_APPS = ['myasa']

/** The master's alone whatever a rule row says — no badge, admin included, opens these (server: Prefs.gs appAccessMayEdit_). */
export const MASTER_ONLY_APPS: readonly string[] = ['app-control', 'credentials', 'mail']

// THE FOUR MY APPS, CONTAINED AS THEIR DOORS CONTAIN THEM (hotline_desk.app_access, CONTAINED_ROLES): a client…
export const RELAY_CONTAINED_APPS: readonly string[] = ['my-work', 'my-profile', 'my-calendar', 'my-inbox']
export const RELAY_CONTAINED_ROLES: readonly string[] = ['client', 'onboarding', 'interviewer']

export function badgeAllowsApp(
  appId: string,
  user: { isMaster?: boolean; types?: string[]; derivedTypes?: string[]; role?: string;
          appDenials?: string[]; editionApps?: string[] } | null | undefined,
  rules: Record<string, string[]>,
): boolean {
  if (MASTER_ONLY_APPS.includes(appId)) return user?.isMaster === true
  if (!user) return true            // signed-out chrome never draws apps anyway
  if (user.isMaster) return true    // the master's view is never narrowed
  if (user.appDenials?.includes(appId)) return false
  // an edition may OPEN an app to a person by name (Settings › Editions), whatever their badge
  if (user.editionApps?.includes(appId)) return true
  const rule = rules[appId]
  if (!rule || rule.length === 0) {
    // NO ROW = THE MASTER'S, AND NOBODY ELSE'S — such an app is dedicated to the MASTER user alone.
    return BADGE_FLOOR_APPS.includes(appId)
  }
  const role = String(user.role ?? '').trim().toLowerCase()
  if (RELAY_CONTAINED_APPS.includes(appId) && RELAY_CONTAINED_ROLES.includes(role) &&
      !rule.includes(role.toUpperCase())) return false
  const mine = badgesOf(CALENDAR_BADGE_APPS.includes(appId)
    ? { types: wornTypes(user), role: user.role } : user)
  return rule.some((b) => mine.includes(b))
}

// Pure: does this app belong to the tenant being looked at?
export function tenantAllowsApp(
  appId: string,
  tenantId: string | null | undefined,
  rules: Record<string, string[]>,
): boolean {
  const rule = rules[appId]
  if (!rule || rule.length === 0) return true
  if (!tenantId) return true       // no tenant chosen yet: narrow nothing
  return rule.includes(tenantId)
}

// The server pull lives in prefsSync.ts (the pull-on-token home) — this module stays pure so lib/appAccess can…
