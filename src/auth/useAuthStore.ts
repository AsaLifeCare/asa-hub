// Auth store (zustand, persisted to localStorage["asa-auth"]).
// Real sessions: the Hub is fully self-contained — auth lives in the Hub's own Apps Script backend (same /exec…
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser, BeAnotherActing, BeAnotherBlock, Permission, Role } from '@/auth/types'
import { ROLE_PRESETS } from '@/auth/permissions'
// safe top-level import: useApiConfigStore imports nothing from auth (no cycle)
import { DEFAULT_EXEC_URL, useApiConfigStore } from '@/stores/useApiConfigStore'

/** Per-user overrides: userId → perm → explicit grant/deny. */
export type PermissionOverrides = Record<string, Partial<Record<Permission, boolean>>>

/** Seeded demo directory — 1 admin, 2 managers, 3 staff, 1 onboarding trainee. */
export const DEMO_USERS: AuthUser[] = [
  {
    id: 'u-alex',
    name: 'Alex Morgan',
    email: 'alex@asahub.io',
    role: 'admin',
    avatar: 'animal:fox',
    title: 'Operations Director',
  },
  {
    id: 'u-priya',
    name: 'Priya Sharma',
    email: 'priya@asahub.io',
    role: 'manager',
    avatar: 'animal:owl',
    title: 'Care Coordination Lead',
  },
  {
    id: 'u-david',
    name: 'David Okafor',
    email: 'david@asahub.io',
    role: 'manager',
    avatar: 'animal:bear',
    title: 'Scheduling Manager',
  },
  {
    id: 'u-emma',
    name: 'Emma Wilson',
    email: 'emma@asahub.io',
    role: 'staff',
    avatar: 'animal:cat',
    title: 'Senior Caregiver',
  },
  {
    id: 'u-lucas',
    name: 'Lucas Silva',
    email: 'lucas@asahub.io',
    role: 'staff',
    avatar: 'animal:panda',
    title: 'Field Nurse',
  },
  {
    id: 'u-mia',
    name: 'Mia Chen',
    email: 'mia@asahub.io',
    role: 'staff',
    avatar: 'animal:rabbit',
    title: 'Intake Assistant',
  },
]

/** localStorage key for the GAS session token (managed outside persist). */
const TOKEN_KEY = 'asa-hub-token'

// BE ANOTHER (lib/beAnother): the master's own token, held here while TOKEN_KEY carries the acting one.
export const REAL_TOKEN_KEY = 'asa-hub-token-real'

function storedRealToken(): string | null {
  try { return localStorage.getItem(REAL_TOKEN_KEY) } catch { return null }
}

function forgetRealToken(): void {
  try { localStorage.removeItem(REAL_TOKEN_KEY) } catch { /* the next adopt overwrites it */ }
}

// The access matrices are the signed-out session's answer: the next account on this browser starts from its own.
function dropAccessCopy(): void {
  void import('@/lib/badgeAccess')
    .then((m) => m.useBadgeAccessStore.setState({ rules: {}, configRules: {}, tenantRules: {}, fetchedAt: '' }))
    .catch(() => {})
  // the shelf too: a whole-shelf save from the next account must wait for that account's own read
  void import('@/stores/useCategoryStore')
    .then((m) => m.useCategoryStore.setState({ status: 'idle' }))
    .catch(() => {})
}

/** The auth answers' `be_another` block, read strictly; anything else is none. */
export function readBeAnother(raw: unknown): BeAnotherBlock | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const who = (x: Record<string, unknown>) => ({
    id: String(x.id ?? ''), email: String(x.email ?? ''), display_name: String(x.display_name ?? ''),
  })
  const real = r.real && typeof r.real === 'object' ? (r.real as Record<string, unknown>) : null
  if (!real || !String(real.id ?? '').trim()) return null
  const a = r.acting && typeof r.acting === 'object' ? (r.acting as Record<string, unknown>) : null
  let acting: BeAnotherActing | null = null
  if (a && String(a.id ?? '').trim()) {
    const ms = Math.max(0, Number(a.expires_in_ms) || 0)
    acting = {
      ...who(a),
      role: String(a.role ?? ''),
      types: Array.isArray(a.types) ? a.types.map((t) => String(t)) : [],
      until: String(a.until ?? ''),
      expires_in_ms: ms,
      local_until: Date.now() + ms,
    }
  }
  return { real: who(real), acting }
}

/** True while this tab wears another account (the server's block says so). */
export function isActing(): boolean {
  return Boolean(useAuthStore.getState().beAnother?.acting)
}

let restoringReal = false

// BACK TO THE REAL SIGN-IN held beside an acting one — Be Back, an acting session that ended by itself, or a…
export function restoreRealSession(label: string): boolean {
  if (restoringReal) return true
  const real = storedRealToken()
  if (!real) return false
  restoringReal = true
  try {
    localStorage.setItem(TOKEN_KEY, real)
  } catch { /* the reload reads whatever stands */ }
  forgetRealToken()
  useAuthStore.setState({ user: null, hydrated: false, beAnother: null })
  void Promise.all([import('@/lib/placeReset'), import('@/lib/reboot')])
    .then(([place, reboot]) => {
      place.resetPlace()
      reboot.rebootIntoWorkspace(label)
    })
    .catch(() => { try { window.location.reload() } catch { /* a tab with no location has nothing to reload */ } })
  return true
}

// THIS TAB IS BEHIND, NOT SIGNED OUT: another tab of the browser already moved the session (a Be Back, a start, a…
export function sessionMovedUnderThisTab(): boolean {
  if (restoringReal) return true
  let stored: string | null = null
  try { stored = localStorage.getItem(TOKEN_KEY) } catch { return false }
  const held = useAuthStore.getState().token
  return Boolean(stored && held && stored !== held)
}

let following = false

/** Reboot onto whatever session this browser now holds; nothing is removed. */
export function followMovedSession(label: string): void {
  if (restoringReal || following) return
  following = true
  void import('@/lib/reboot')
    .then((reboot) => reboot.rebootIntoWorkspace(label))
    .catch(() => { try { window.location.reload() } catch { /* a tab with no location has nothing to reload */ } })
}

/** For the tests: the crossing guard is per page load. */
export function resetRealRestoreForTests(): void {
  restoringReal = false
  following = false
}

/** Backend user payload (authLogin/authBootstrap/authMe/usersList → `user`). */
export type BackendUser = {
  id?: string | number
  email?: string
  display_name?: string
  role?: string
  title?: string
  phone?: string
  phones?: { label: string; number: string }[]
  avatar?: string
  /** Per-person permission overrides layered over the role preset. */
  overrides?: Partial<Record<Permission, boolean>>
  /** Set for new-hire accounts: the candidate whose paperwork they own. */
  candidate_id?: string
  // the client this account IS (client-role logins) — Auth.gs has always sent it; nothing on this side had ever…
  client_key?: string
  /** The system TYPE label (DIRECTOR / HR / …) — Settings-side accounts. */
  system_type?: string
  /** The TYPE BADGES (HM, INTERVIEWER, …) — validated server-side. */
  types?: string[]
  /** badges worn by code (authMe/authLogin only), never part of `types` */
  derived_types?: string[]
  edition_apps?: string[]
  /** Extra contact e-mails (the sign-in e-mail stays in `email`). */
  emails?: string[]
  // THE PLATFORM CONTACT LINK (ContactsSync.gs): the roster row this account is, the employment facts the merge…
  people_id?: string
  roster_status?: string
  employee_id?: string
  start_date?: string
  end_date?: string
  contact_sources?: Record<string, string>
  contact_synced_at?: string
  /** Server-computed platform-mailbox membership (master or configured badge). */
  mail_reader?: boolean
  copilot_star?: boolean
  world_role?: 'owner' | 'user'
  smartcomms_widget?: boolean
  home_tenant?: string
  tenants?: string[]
  apps_grid?: boolean
  my_world?: boolean
  my_asa?: boolean
  franchise_view?: boolean
  /** Apps individually removed from this person by the master's eye. */
  app_denials?: string[]
  /** The shared default is still this account's password. */
  must_change_password?: boolean
  // Derived by the server from the HUB_MASTER_EMAIL Script Property on every read (Auth.gs, `userPublic_`).
  is_master?: boolean
  /** Settings › My Work's stamps switch, as the tab reads (authMe/authLogin only). */
  stamps_hidden?: boolean
  /** Settings › My Work's Staff source-notes switch, as the tab reads (authMe/authLogin only). */
  record_notes_hidden?: boolean
  /** Settings › My Work's Clients switch, as the tab reads (authMe/authLogin only). */
  client_activity_hidden?: boolean
  /** Settings › My Work's Clients switch for Client details' titles (authMe/authLogin only). */
  client_group_titles_hidden?: boolean
  /** Settings › My Work's Staff switch for Documents' count line (authMe/authLogin only). */
  staff_doc_counts_hidden?: boolean
  /** Settings › My Work's Families & Guardians switch (authMe/authLogin only). */
  family_details_hidden?: boolean
  /** Settings › App Control access: present only for an account App Control is shared with (authMe/authLogin only). */
  app_control?: { apps?: unknown; may_change?: unknown }
  // Removed from the config surfaces (System users + Per-person overrides) only — the account itself keeps working…
  system_hidden?: boolean
}

/** GAS response envelope — always HTTP 200, the real status lives inside. */
type AuthEnvelope = {
  status: number
  data?: { token?: string; user?: BackendUser; needsBootstrap?: boolean; be_another?: unknown }
  message?: string
  /** Machine-readable reason (e.g. 'account_blocked' on a 423). */
  code?: string
}

// Sentinel returned by `login` when the backend answers 423 account_blocked — the account exists, the password was…
export const ACCOUNT_BLOCKED = 'account_blocked'

// Backend role → Hub Role (1:1).
const BACKEND_ROLES: Role[] = ['admin', 'manager', 'staff', 'client', 'onboarding', 'interviewer']

function mapBackendRole(role?: string): Role {
  const r = String(role ?? '').trim().toLowerCase()
  return (BACKEND_ROLES as string[]).includes(r) ? (r as Role) : 'staff'
}

/** Backend user → AuthUser (profile columns are additive — may be empty). */
export function mapBackendUser(u: BackendUser): AuthUser {
  return {
    id: String(u.id ?? ''),
    name: u.display_name || u.email || '',
    email: u.email ?? '',
    role: mapBackendRole(u.role),
    // '' = the initials tile (platform norm); users pick photo/icon/initials in My profile.
    avatar: u.avatar ?? '',
    title: u.title ?? '',
    phone: u.phone ?? '',
    phones: Array.isArray(u.phones) ? u.phones : u.phone ? [{ label: 'Phone', number: u.phone }] : [],
    candidateId: u.candidate_id ?? '',
    // WHICH PERSON a client-role account IS.
    clientKey: String(u.client_key ?? ''),
    // the badges beside the role — HM, INTERVIEWER, …
    types: Array.isArray(u.types) ? u.types : [],
    // kept apart so nothing editing `types` writes it
    derivedTypes: Array.isArray(u.derived_types) ? u.derived_types.map((t) => String(t)) : [],
    editionApps: Array.isArray(u.edition_apps) ? u.edition_apps.map((a) => String(a)) : [],
    emails: Array.isArray(u.emails) ? u.emails : [],
    // the platform contact link — additive columns, blank on every account the lane has not reached; an older…
    peopleId: String(u.people_id ?? ''),
    rosterStatus: String(u.roster_status ?? ''),
    employeeId: String(u.employee_id ?? ''),
    startDate: String(u.start_date ?? ''),
    endDate: String(u.end_date ?? ''),
    contactSources: u.contact_sources && typeof u.contact_sources === 'object' && !Array.isArray(u.contact_sources)
      ? u.contact_sources : {},
    contactSyncedAt: String(u.contact_synced_at ?? ''),
    mailReader: u.mail_reader === true,
    // shell buttons by badge — `!== false` so an older backend that does not send the flags keeps every button on
    copilotStar: u.copilot_star !== false,
    // 'owner' unless the backend says otherwise — a pre-publish server that does not send it leaves your own ground…
    worldRole: u.world_role === 'user' ? 'user' : 'owner',
    homeTenant: String(u.home_tenant ?? ''),
    tenantIds: Array.isArray(u.tenants) ? u.tenants : [],
    appsGrid: u.apps_grid !== false,
    smartCommsWidget: u.smartcomms_widget !== false,
    // strict === true: absent on an older backend means NOT granted - the master keeps the stack via isMaster…
    myWorld: u.my_world === true,
    // only a plain false takes it: a backend that does not send it keeps My asa. as it shipped
    myAsa: u.my_asa !== false,
    franchiseView: u.franchise_view === true,
    appDenials: Array.isArray(u.app_denials) ? u.app_denials : [],
    mustChangePassword: u.must_change_password === true,
    // Server-derived, re-read on every authMe; `=== true` so a backend that has not shipped the field yet reads as…
    isMaster: u.is_master === true,
    // absent reads as hidden, as the switch ships
    stampsHidden: u.stamps_hidden !== false,
    recordNotesHidden: u.record_notes_hidden !== false,
    clientActivityHidden: u.client_activity_hidden !== false,
    clientGroupTitlesHidden: u.client_group_titles_hidden !== false,
    staffDocCountsHidden: u.staff_doc_counts_hidden !== false,
    familyDetailsHidden: u.family_details_hidden !== false,
    // absent for everybody App Control is not shared with; an answer listing no app shares nothing
    appControl: appControlOf(u.app_control),
  }
}

/** The App Control share as the session keeps it; undefined unless the answer names at least one app. */
function appControlOf(raw: BackendUser['app_control']): AuthUser['appControl'] {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.apps)) return undefined
  const apps: string[] = []
  for (const a of raw.apps) {
    const id = String(a ?? '').trim()
    if (id && !id.includes('.') && !apps.includes(id)) apps.push(id)
  }
  return apps.length ? { apps, mayChange: raw.may_change === true } : undefined
}

// State patch adopting a backend user: session user + their server-truth permission overrides (merged over whatever…
function adoptBackendUser(u: BackendUser, prev: PermissionOverrides): Pick<AuthState, 'user'> & { overrides: PermissionOverrides } {
  const user = mapBackendUser(u)
  const overrides =
    u.overrides && typeof u.overrides === 'object'
      ? { ...prev, [user.id]: u.overrides }
      : prev
  return { user, overrides }
}

// POST an auth action to the Hub's /exec endpoint.
async function authCall(action: string, payload?: unknown, token?: string | null): Promise<AuthEnvelope> {
  const post = async (url: string): Promise<AuthEnvelope> => {
    const res = await fetch(url, {
      method: 'POST',
      // form-encoded (still a CORS simple request): Google's anonymous-POST interstitial intercepts text/plain…
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'body=' + encodeURIComponent(JSON.stringify({ action, payload, token: token ?? undefined })),
    })
    return (await res.json()) as AuthEnvelope
  }
  const primary = useApiConfigStore.getState().execUrl || DEFAULT_EXEC_URL
  try {
    return await post(primary)
  } catch {
    // one more try at the same door after a breath: the sign-in and its sessions live on this server alone
    await new Promise((r) => setTimeout(r, 600))
    return post(primary)
  }
}

export type AuthState = {
  /** Signed-in user, `null` when logged out. */
  user: AuthUser | null
  /** GAS session token, `null` when logged out. Mirrors localStorage[TOKEN_KEY]. */
  token: string | null
  /** True once bootstrap() has revalidated the session against the backend. */
  hydrated: boolean
  /** Workspace user directory (demo: seeded, static — feeds the access matrix). */
  users: AuthUser[]
  /** Admin-edited grants/denies layered over role presets. */
  overrides: PermissionOverrides
  // BE ANOTHER, as the last auth answer said it: the hardcoded master's block (acting null), both identities while…
  beAnother: BeAnotherBlock | null
  // Revalidate the stored token (POST authMe) on app mount.
  bootstrap: () => Promise<void>
  // Sign in (POST authLogin).
  login: (identifier: string, password: string, lane?: string) => Promise<string | null>
  // Adopt a session the backend already minted — the registration page's door (Invites.gs answers with a token…
  adoptSession: (token: string, user: unknown) => void
  /** Sign out: kill the server session (fire-and-forget), clear token + user. */
  logout: () => void
  // Drop the local session WITHOUT calling the server — used by the API layer when an envelope comes back 401 (the…
  clearSession: () => void
  // Patch the signed-in user locally (after a successful profileUpdate, or directly in demo mode).
  applyUser: (patch: Partial<AuthUser>) => void
  // POST authStatus → true when the backend has no users yet (first run) and LoginPage must offer the "Create the…
  needsBootstrap: () => Promise<boolean>
  // First-run only: create the initial admin (POST authBootstrap) and sign in as them.
  bootstrapAdmin: (display_name: string, email: string, password: string) => Promise<string | null>
  /** Set (or clear, via `null`) one permission override for a user. */
  setOverride: (userId: string, perm: Permission, value: boolean | null) => void
  /** Remove every override for a user → back to pure role defaults. */
  resetOverrides: (userId: string) => void
  // Effective permission check: override wins, else the user's role preset.
  can: (user: AuthUser | null, perm: Permission) => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: localStorage.getItem(TOKEN_KEY),
      hydrated: false,
      users: DEMO_USERS,
      overrides: {},
      beAnother: null,

      bootstrap: async () => {
        const token = get().token
        if (!token) {
          set({ user: null, beAnother: null, hydrated: true })
          return
        }
        try {
          const env = await authCall('authMe', undefined, token)
          if (env.status === 200 && env.data?.user) {
            set({
              ...adoptBackendUser(env.data.user, get().overrides),
              beAnother: readBeAnother(env.data.be_another),
              hydrated: true,
            })
            return
          }
          if (env.status === 401 || env.status === 403) {
            // another tab moved the session while this one was asking: follow it, remove nothing
            if (sessionMovedUnderThisTab()) {
              followMovedSession('Another tab changed the account on this browser — following it…')
              return
            }
            // an acting token that ended while the tab was closed: back to the real sign-in, if it still lives
            const real = storedRealToken()
            if (real && real !== token && restoreRealSession('Your time as another account ended — back to your own…')) {
              return
            }
            // DEFINITIVE refusal → the token is dead, drop it — and the cached user directory with it…
            localStorage.removeItem(TOKEN_KEY)
            forgetRealToken()
            try { sessionStorage.removeItem('asa-users-directory-v1') } catch { /* best effort */ }
            set({ token: null, user: null, beAnother: null, hydrated: true })
            return
          }
          // Any OTHER envelope status is the backend having trouble, not a verdict on this session: the /gas relay…
          set({ user: get().user, hydrated: true })
        } catch {
          // Network down → ENTER with the persisted session snapshot instead of bouncing to a login page that…
          set({ user: get().user, hydrated: true })
        }
      },

      // ONE PLACE THAT ADOPTS A MINTED SESSION.
      adoptSession: (token, user) => {
        if (!token) return
        localStorage.setItem(TOKEN_KEY, token)
        // a freshly minted session is nobody's acting one; its own authMe below names the master, if it is
        forgetRealToken()
        set({ token, ...adoptBackendUser(user as never, get().overrides), beAnother: null, hydrated: true })
        void authCall('authMe', undefined, token).catch(() => {})
      },

      login: async (identifier, password, lane) => {
        try {
          // `lane` = which door on the login page was used; lane-bound accounts (interviewer, onboarding) are…
          // an e-mail typed with capitals is the same account: sent trimmed and lowercase, as every account keeps it
          const env = await authCall('authLogin', { identifier: identifier.trim().toLowerCase(), password, lane })
          if (env.status === 200 && env.data?.token && env.data.user) {
            localStorage.setItem(TOKEN_KEY, env.data.token)
            forgetRealToken()
            set({
              token: env.data.token,
              ...adoptBackendUser(env.data.user, get().overrides),
              // the answer's own word, or none: a copy left by an earlier sign-in never survives this one
              beAnother: readBeAnother(env.data.be_another),
              hydrated: true,
            })
            // INTRODUCE THE TOKEN TO THE GATE: the snapshot gate learns newborn tokens by watching auth traffic…
            void authCall('authMe', undefined, env.data.token).catch(() => {})
            return null
          }
          // 423 → deactivated account, right password: the page shows the blocked card, not an error banner
          if (env.status === 423 || env.code === 'account_blocked') return ACCOUNT_BLOCKED
          // 401 / 429 → surface the backend's own message when present
          return env.message || 'Invalid credentials'
        } catch {
          return 'Network error — could not reach the server.'
        }
      },

      logout: () => {
        // the crossing back owns this browser's session until its reload: nothing here may remove it
        if (restoringReal) return
        // A PENDING PREFERENCE LEAVES WITH ITS OWNER: sign-out is an SPA transition — no pagehide — and it takes…
        const heldToken = get().token ?? undefined
        // WHILE ACTING the preferences on this browser are the worn account's: nothing is pushed in their name
        const real = storedRealToken()
        const acting = Boolean(get().beAnother?.acting) || Boolean(real && real !== heldToken)
        if (!acting) void import('@/lib/prefsSync').then((m) => m.flushPrefsPush(heldToken)).catch(() => {})
        // fire-and-forget: the UI signs out immediately either way
        const token = get().token
        if (token) void authCall('authLogout', undefined, token).catch(() => {})
        // signing out while acting signs out BOTH: the acting session and the real one it came from
        if (real && real !== token) void authCall('authLogout', undefined, real).catch(() => {})
        // a session another tab set since (a Be Back there) is this browser's too: a sign-out here ends it
        let stored: string | null = null
        try { stored = localStorage.getItem(TOKEN_KEY) } catch { stored = null }
        if (stored && stored !== token && stored !== real) void authCall('authLogout', undefined, stored).catch(() => {})
        forgetRealToken()
        localStorage.removeItem(TOKEN_KEY)
        // the cached user directory (lib/usersDirectory) holds every account's contacts and overrides — it must not…
        try { sessionStorage.removeItem('asa-users-directory-v1') } catch { /* already gone */ }
        // WHERE THEY WERE STANDING GOES WITH THEM (lib/placeReset): tenant, world and member are all persisted, so…
        void import('@/lib/placeReset').then((m) => m.resetPlace()).catch(() => {})
        dropAccessCopy()
        set({ token: null, user: null, beAnother: null })
      },

      clearSession: () => {
        // A TAB BEHIND ANOTHER ONE follows it: the dead token is this tab's memory, not the browser's session
        if (sessionMovedUnderThisTab()) {
          followMovedSession('Another tab changed the account on this browser — following it…')
          return
        }
        // AN ACTING SESSION THAT DIED (its clock, Be Back elsewhere, the master's sign-out) is a Be Back, not a…
        const real = storedRealToken()
        const acting = Boolean(get().beAnother?.acting) || Boolean(real && real !== get().token)
        if (acting) {
          const name = get().beAnother?.acting?.display_name || 'the other account'
          if (restoreRealSession(`Your time acting as ${name} ended — back to your own account…`)) return
        }
        localStorage.removeItem(TOKEN_KEY)
        forgetRealToken()
        try { sessionStorage.removeItem('asa-users-directory-v1') } catch { /* already gone */ }
        // an expired or revoked session leaves the same residue as a sign-out
        void import('@/lib/placeReset').then((m) => m.resetPlace()).catch(() => {})
        dropAccessCopy()
        set({ token: null, user: null, beAnother: null })
      },

      applyUser: (patch) =>
        set((s) => {
          if (!s.user) return s
          const user = { ...s.user, ...patch }
          return {
            user,
            users: s.users.map((u) => (u.id === user.id ? { ...u, ...patch } : u)),
          }
        }),

      needsBootstrap: async () => {
        try {
          const env = await authCall('authStatus')
          return env.status === 200 && env.data?.needsBootstrap === true
        } catch {
          return false
        }
      },

      bootstrapAdmin: async (display_name, email, password) => {
        try {
          const env = await authCall('authBootstrap', { display_name, email, password })
          if (env.status === 200 && env.data?.token && env.data.user) {
            localStorage.setItem(TOKEN_KEY, env.data.token)
            forgetRealToken()
            set({ token: env.data.token, ...adoptBackendUser(env.data.user, get().overrides), beAnother: null,
                  hydrated: true })
            return null
          }
          // 409 = an admin already exists (someone else bootstrapped first)
          return env.message || 'Could not create the admin account.'
        } catch {
          return 'Network error — could not reach the server.'
        }
      },

      setOverride: (userId, perm, value) =>
        set((s) => {
          const forUser = { ...(s.overrides[userId] ?? {}) }
          if (value === null) delete forUser[perm]
          else forUser[perm] = value
          return { overrides: { ...s.overrides, [userId]: forUser } }
        }),

      resetOverrides: (userId) =>
        set((s) => {
          const overrides = { ...s.overrides }
          delete overrides[userId]
          return { overrides }
        }),

      can: (user, perm) => {
        if (!user) return false
        const override = get().overrides[user.id]?.[perm]
        if (override !== undefined) return override
        return ROLE_PRESETS[user.role].includes(perm)
      },
    }),
    {
      name: 'asa-auth',
      // Persist the session snapshot only — `hydrated` must restart false; the token rides its own localStorage key…
      partialize: (s) => ({ user: s.user, users: s.users, overrides: s.overrides, beAnother: s.beAnother }),
      // Backward-compatible rehydration: keep the persisted shape (user / users / overrides), union in any NEW…
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthState>
        const persistedUsers = p.users ?? []
        const users = [
          ...DEMO_USERS.map((d) => persistedUsers.find((u) => u.id === d.id) ?? d),
          ...persistedUsers.filter((u) => !DEMO_USERS.some((d) => d.id === u.id)),
        ]
        // A TOKEN WORN BESIDE A REAL ONE whose persisted identity is not the worn account (a tab that crossed while…
        let real: string | null = null
        let token: string | null = null
        try {
          real = localStorage.getItem(REAL_TOKEN_KEY)
          token = localStorage.getItem(TOKEN_KEY)
        } catch { /* no storage, no snapshot to doubt */ }
        const worn = p.beAnother?.acting ?? null
        const doubt = Boolean(real && token && real !== token && (!worn || p.user?.id !== worn.id))
        return { ...current, ...p, users, hydrated: false, ...(doubt ? { user: null } : null) }
      },
    },
  ),
)
