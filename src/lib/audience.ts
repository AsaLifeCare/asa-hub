// Manifest visibility — the single audience filter used by the Sidebar, the App Hub (/apps), the ⌘K palette and the…
// Semantics (documented on AppManifest.audience in src/engine/types.ts): 1.
import type { AppManifest, PageSchema } from '@/engine/types'
import type { Role } from '@/auth/types'
import { visibleInFocus, type Focus, type FocusType } from '@/stores/useContextStore'
import { restrictedAppsFor } from '@/lib/roleAccess'
import { MASTER_ONLY_APPS, useBadgeAccessStore } from '@/lib/badgeAccess'

export type AudienceContext = {
  /** Active Person Focus Mode (null = normal mode). Omit where focus never applied. */
  focus?: Focus | null
  /** Signed-in user's role (null/undefined = logged out → legacy-open). */
  role?: Role | null
}

// Access check for one app (optionally one of its pages) → allowed.
export type AccessChecker = (appId: string, pageId?: string) => boolean

// THE MATRIX EXTENDS A RESTRICTED ROLE'S FLOOR — the INTERVIEWER and ONBOARDING chips granted nothing at all.
function explicitBadgeGrant(appId: string, role: Role | null | undefined): boolean {
  if (!role || MASTER_ONLY_APPS.includes(appId)) return false
  const word = String(role).toUpperCase()
  return (useBadgeAccessStore.getState().rules[appId] ?? []).includes(word)
}

/** Visibility rule for one manifest (audience semantics only — no grants). */
export function isManifestVisible(app: AppManifest, { focus = null, role = null }: AudienceContext): boolean {
  const aud = app.audience ?? ['all']
  // 0.
  const restricted = restrictedAppsFor(role)
  if (restricted) {
    return app.enabled !== false && (restricted.includes(app.id) || explicitBadgeGrant(app.id, role))
  }
  // 1. onboarding trainees: hard allow-list
  if (role === 'onboarding') return aud.includes('onboarding')
  // 2.
  const focusAud = app.focusAudience ?? (aud as ('all' | FocusType)[])
  if (!visibleInFocus(focusAud, focus)) return false
  // 3.
  if (role === 'admin') return true
  // (the caregiver tightening stood here until 2026-08-19 — see the header: who among the employees opens an app is…
  if (role === 'client') return aud.includes('client') || aud.includes('all')
  return true
}

// Filtered manifest list — drop-in replacement for the per-call-site filters.
export function visibleManifests(apps: AppManifest[], ctx: AudienceContext, isAllowed?: AccessChecker): AppManifest[] {
  // AN ABSORBED APP IS NOT A RUNG — and this is the ONLY place that rule may live (2026-08-27, found live: "NADA…
  const listed = apps.filter((app) => !app.unlisted)
  if (ctx.role === 'onboarding' || !isAllowed) return listed.filter((app) => isManifestVisible(app, ctx))
  return listed.filter((app) => isManifestVisible(app, ctx) && isAllowed(app.id))
}

// The pages of an app the checker still allows.
export function allowedPages(app: AppManifest, role: Role | null | undefined, isAllowed?: AccessChecker): PageSchema[] {
  // config.hidden pages ROUTE (deep links like the candidate profile) but are never menu rungs — filtered at the…
  const pages = app.pages.filter((p) => !(p.config as { hidden?: boolean } | undefined)?.hidden)
  if (!isAllowed || role === 'onboarding') return pages
  return pages.filter((p) => isAllowed(app.id, p.id))
}

/** The menu entry an address lights: a hidden page that is a view of a listed one (`config.menuAs`) lights that one. */
export function menuPageId(app: AppManifest | undefined, pageId: string): string {
  const as = (app?.pages.find((p) => p.id === pageId)?.config as { menuAs?: unknown } | undefined)?.menuAs
  return typeof as === 'string' && as ? as : pageId
}
