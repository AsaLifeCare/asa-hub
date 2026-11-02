// Restricted roles — the workspace map, in ONE place.
// A role listed here sees ONLY the apps named for it (everything else is hidden from the sidebar, the App Hub and…
import type { Role } from '@/auth/types'

export const RESTRICTED_ROLE_APPS: Partial<Record<Role, string[]>> = {
  // Interview day: the interviewer signs in, records the scorecard on the candidate, and that is all they can reach.
  interviewer: ['hiring'],
  // A new hire is not staff yet: their six steps (Overview), the policies they must read (Knowledge) and the videos…
  onboarding: ['onboarding', 'myasa'],
}

/** The app allow-list for a restricted role, or null when unrestricted. */
export function restrictedAppsFor(role: Role | null | undefined): string[] | null {
  if (!role) return null
  return RESTRICTED_ROLE_APPS[role] ?? null
}

/** True when the role only gets its allow-listed apps + a bare shell. */
export function isRestrictedRole(role: Role | null | undefined): boolean {
  return restrictedAppsFor(role) !== null
}

// ------------------------------------------------------------------ Page-header actions, per role…
export type PageActionKind = 'primary' | 'secondary' | 'filter' | 'export'

const ALL_ACTIONS: Record<PageActionKind, boolean> = {
  primary: true,
  secondary: true,
  filter: true,
  export: true,
}

export const ROLE_PAGE_ACTIONS: Partial<Record<Role, Partial<Record<PageActionKind, boolean>>>> = {
  interviewer: { primary: false, secondary: false, filter: false, export: false },
  onboarding: { primary: false, secondary: false, export: false },
  client: { primary: false, secondary: false, export: false },
}

/** May this role see that page-header control? */
export function roleCanUseAction(role: Role | null | undefined, kind: PageActionKind): boolean {
  if (!role) return false
  const cfg = ROLE_PAGE_ACTIONS[role]
  if (!cfg) return ALL_ACTIONS[kind]
  return cfg[kind] ?? ALL_ACTIONS[kind]
}

// ------------------------------------------------------------------ Document reader — who may print, edit, delete…
export type DocAction = 'print' | 'edit' | 'delete'

const DOC_ACTION_DEFAULT: Record<DocAction, boolean> = { print: true, edit: false, delete: false }

export const ROLE_DOC_ACTIONS: Partial<Record<Role, Partial<Record<DocAction, boolean>>>> = {
  admin: { print: true, edit: true, delete: true },
  manager: { print: true, edit: true, delete: false },
  staff: { print: true },
  onboarding: { print: true },
  interviewer: { print: false },
  client: { print: true },
}

export function roleCanDocAction(role: Role | null | undefined, action: DocAction): boolean {
  if (!role) return false
  const cfg = ROLE_DOC_ACTIONS[role]
  if (!cfg) return DOC_ACTION_DEFAULT[action]
  return cfg[action] ?? DOC_ACTION_DEFAULT[action]
}

// ------------------------------------------------------------------ One-shot sessions — sign out once the job is…
export type OneShotTask = 'interview-scorecard'

export const ROLE_SIGN_OUT_AFTER: Partial<Record<Role, OneShotTask[]>> = {
  interviewer: ['interview-scorecard'],
}

// Milliseconds between "saved" and the sign-out — the modal closes and the confirmation toast is readable before…
export const SIGN_OUT_AFTER_DELAY_MS = 1400

/** Does finishing this task end the role's session? */
export function roleSignsOutAfter(role: Role | null | undefined, task: OneShotTask): boolean {
  if (!role) return false
  return (ROLE_SIGN_OUT_AFTER[role] ?? []).includes(task)
}

// ------------------------------------------------------------------ Shared seats — one account, many people, one…
export type SeatFlow = 'onboarding' | 'interview'

export const SHARED_SEAT_ROLES: Partial<Record<Role, SeatFlow>> = {
  onboarding: 'onboarding',
  interviewer: 'interview',
}

/** Which seat flow this role sits at, if any. */
export function seatFlowFor(role: Role | null | undefined): SeatFlow | undefined {
  return role ? SHARED_SEAT_ROLES[role] : undefined
}

// ------------------------------------------------------------------ Where an account is managed…

// The account split: People are records with no access; the Users app holds the access accounts we create for staff…
export const OPEN_ACCESS_ROLES: Role[] = ['staff', 'client']

/** True → managed in Settings → System users, never in the Users app. */
export function isSystemManagedAccount(u: { role?: string | null }): boolean {
  return !OPEN_ACCESS_ROLES.includes((u.role ?? '') as Role)
}
