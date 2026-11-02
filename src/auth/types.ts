// asa.
// auth contracts — shared types for the whole platform.

// Platform role.
export type Role = 'admin' | 'manager' | 'staff' | 'client' | 'onboarding' | 'interviewer'

/** A signed-in (or sign-in-able) workspace user. */
export type AuthUser = {
  id: string
  name: string
  email: string
  role: Role
  /** Photo URL, `icon:<lucide>[:<tint>]` ref, or '' → initials via <Avatar/>. */
  avatar: string
  /** Job title, shown under the name in shell chrome. */
  title: string
  // Contact phone — always the FIRST entry of `phones`, kept so every screen that reads a single number keeps…
  phone?: string
  // Every way to reach this person, labelled: which number to try depends on why you are calling.
  phones?: { label: string; number: string }[]
  // The candidate row this account IS, when it belongs to a new hire rather than to staff.
  candidateId?: string
  // The TYPE BADGES (HM, INTERVIEWER, …) — several allowed, validated server-side against HUB_USER_TYPES.
  types?: string[]
  /** badges worn by code (HM, Profile.gs hubCalendarBadges_); read every boot, never written back */
  derivedTypes?: string[]
  /** apps an edition opens to this person by name, on top of their badge (app/editions.py opened_apps) */
  editionApps?: string[]
  // EXTRA contact e-mails — the sign-in e-mail is identity and lives in `email` alone, so every additional address…
  emails?: string[]
  // THE PLATFORM CONTACT LINK (ContactsSync.gs).
  peopleId?: string
  rosterStatus?: string
  employeeId?: string
  startDate?: string
  endDate?: string
  contactSources?: Record<string, string>
  contactSyncedAt?: string
  // WHICH PERSON THIS ACCOUNT IS, for a client-role login — the `client_key` column on the users tab, matched…
  clientKey?: string
  // Server-computed: this session reads the PLATFORM mailbox (the master, or a badge the `platform_mail_badges`…
  mailReader?: boolean
  // Server-computed shell buttons by badge (empty config = everyone): the Copilot star and the command bar's…
  copilotStar?: boolean
  // The word your WORLD wears here: 'owner' on your own ground, 'user' inside somebody else's platform (Members.gs).
  worldRole?: 'owner' | 'user'
  /** the Smart Comms indicator on My asa. — a badge-gated shell feature */
  smartCommsWidget?: boolean
  /** Where this account may stand (Tenant.gs) — '' home = headquarters. */
  homeTenant?: string
  tenantIds?: string[]
  appsGrid?: boolean
  // The places-stack grants: master always; others only when the config names their badge (myworld_badges /…
  myWorld?: boolean
  /** My asa. and Bookmarks, the session's own answer (lib/myAsaOffered). */
  myAsa?: boolean
  franchiseView?: boolean
  // Apps the master's eye took from THIS person, narrowing whatever the badge matrix allows.
  appDenials?: string[]
  // The account signed in with a temporary password — every screen waits behind a password of their own.
  mustChangePassword?: boolean
  // THE MASTER — the one account named by the `HUB_MASTER_EMAIL` Script Property.
  isMaster?: boolean
  /** Settings › My Work's stamps switch (authMe/authLogin `stamps_hidden`); read through useStampsHidden. */
  stampsHidden?: boolean
  /** Settings › My Work's Staff source-notes switch (authMe/authLogin `record_notes_hidden`); read through useRecordNotesHidden. */
  recordNotesHidden?: boolean
  /** Settings › My Work's Clients switch (authMe/authLogin `client_activity_hidden`); read through useClientActivityHidden. */
  clientActivityHidden?: boolean
  /** Settings › My Work's Clients switch (authMe/authLogin `client_group_titles_hidden`); read through
   * useClientGroupTitlesHidden. */
  clientGroupTitlesHidden?: boolean
  /** Settings › My Work's Staff switch (authMe/authLogin `staff_doc_counts_hidden`); read through useStaffDocCountsHidden. */
  staffDocCountsHidden?: boolean
  /** Settings › My Work's Families & Guardians switch (authMe/authLogin `family_details_hidden`); read through
   * useFamilyDetailsHidden. */
  familyDetailsHidden?: boolean
  // Settings › App Control access: the apps the master shares App Control on with this account, and whether it may…
  appControl?: { apps: string[]; mayChange: boolean }
}

/** One side of a Be Another session (BeAnother.gs) — as the server named it. */
export type BeAnotherIdentity = { id: string; email: string; display_name: string }

/** The account being worn; `local_until` is this browser's own clock for `expires_in_ms`. */
export type BeAnotherActing = BeAnotherIdentity & {
  role: string
  types: string[]
  until: string
  expires_in_ms: number
  local_until: number
}

// THE SERVER'S WORD ON BE ANOTHER, from the auth answers only.
export type BeAnotherBlock = { real: BeAnotherIdentity; acting: BeAnotherActing | null }

// Capability strings, `<area>.<action>`.
export type Permission =
  | 'people.view'
  | 'people.edit'
  | 'clients.view'
  | 'clients.edit'
  | 'schedule.view'
  | 'schedule.edit'
  | 'hiring.view'
  | 'hiring.edit'
  /** Record the in-person interview scorecard (score + comments). */
  | 'hiring.interview'
  // Enter "Date accepted" by hand when the call reading failed (the Manual button on the phone-screen checklist).
  | 'hiring.dateManual'
  // Visit the new hire onboarding portal without being a trainee — for walking the six steps without logging out of…
  | 'hiring.onboardingPortal'
  | 'knowledge.view'
  | 'knowledge.edit'
  | 'academy.view'
  | 'academy.edit'
  | 'inventory.view'
  | 'inventory.edit'
  | 'expenses.edit'
  | 'tags.edit'
  // Edit YOUR OWN task card.
  | 'tasks.edit'
  | 'apps.manage'
  | 'settings.api'
  | 'settings.access'

/** Human label for each role (badges, menus). */
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
  client: 'Client',
  onboarding: 'Onboarding',
  interviewer: 'Interviewer',
}

// The badge every surface draws for an account — the ONE place that knows MASTER outranks the role label.
const EXTRA_TYPE_LABEL: Record<string, string> = {
  entity: 'Entity', hm: 'HM', family: 'Family', ssa: 'SSA',
  administrator: 'Administrator', director: 'Director', supervisor: 'Supervisor', teamlead: 'Team Lead',
  platformlead: 'Platform Lead',
}

export function roleBadge(user?: Pick<AuthUser, 'role' | 'isMaster'> | null): string {
  if (!user) return ''
  if (user.isMaster) return 'MASTER'
  return ROLE_LABEL[user.role] ?? EXTRA_TYPE_LABEL[String(user.role).toLowerCase()] ?? String(user.role)
}
