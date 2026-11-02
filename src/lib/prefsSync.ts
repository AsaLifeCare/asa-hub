// Durable per-user UI preferences — localStorage is the CACHE, the `user_prefs` tab in the Hub sheet is the source…
// On sign-in (token appears) the server blob is pulled and written into the whitelisted localStorage keys, then…
import { isActing, useAuthStore } from '@/auth/useAuthStore'
import { gasAction } from '@/features/hiring/shared'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { bootPull } from '@/lib/bootPull'
import { markMatrixLanded } from '@/lib/matrixLanded'
import { dirtySinceOf, dropReleasedMarks, nextDirtyStamp } from '@/lib/prefsRelease'
import { markSettled } from '@/lib/prefsSettled'
import type { UiPrefsState } from '@/stores/useUiPrefsStore'

// not `asa-categories`: the sidebar's sections are the workspace's (useCategoryStore), never a browser's
const EXACT_KEYS = ['asa-accent', 'asa-avatar-prefs', 'asa-sidebar-groups',
  // which apps this person put away — personal, never the workspace's
  'asa-apps-uninstalled',
  // and which baseline-off apps they explicitly turned ON (People et al.)
  'asa-apps-installed',
  // toast corner, logs default view, topbar weather and clock, the house calendars' Time switch, range and last…
  'asa-ui-prefs',
  // who has already been walked through the platform once — it rides here so somebody who saw the tour on their…
  'asa-tour-seen',
  // same law for the Playground's own explainer (playground/PlaygroundIntro)
  'asa-playground-intro-seen',
  // and for the world's own welcome (worlds/MyWorldIntro)
  'asa-myworld-intro-seen']
const PREFIX_KEYS = ['asa-stats-order:']
/** Per-person keys (`<prefix><uid>`); only the signed-in person's own are carried up. */
const OWN_PREFIX_KEYS = ['asa-os-notify-asked:']
function collectPrefs(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of EXACT_KEYS) {
    const v = localStorage.getItem(key)
    if (v != null) out[key] = v
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && PREFIX_KEYS.some((p) => key.startsWith(p))) {
      const v = localStorage.getItem(key)
      if (v != null) out[key] = v
    }
  }
  const uid = useAuthStore.getState().user?.id
  if (uid) {
    for (const prefix of OWN_PREFIX_KEYS) {
      const v = localStorage.getItem(prefix + uid)
      if (v != null) out[prefix + uid] = v
    }
  }
  return out
}

async function applyPrefs(blob: Record<string, string>): Promise<void> {
  // UNSYNCED LOCAL CHANGES WIN — for THEIR OWNER.
  const stamp = dirtyUid()
  if (stamp !== null) {
    const uid = useAuthStore.getState().user?.id
    if (uid == null) {
      // whose session this is isn't known yet — decide when it is, and never guess: a wrong guess either clobbers…
      retryApplyWhenUserKnown(blob)
      return
    }
    if (stamp === '' || stamp === uid) {
      dropReleasedMarks(blob, uid, dirtySince())
      schedulePrefsPush()
      return
    }
    clearDirty()   // somebody else's leftover — their loss, not this user's law
  }
  for (const [key, value] of Object.entries(blob)) {
    // the blob is the person's own, so its own-key family is written back as is
    const allowed = EXACT_KEYS.includes(key) || PREFIX_KEYS.some((p) => key.startsWith(p))
      || OWN_PREFIX_KEYS.some((p) => key.startsWith(p))
    if (allowed && typeof value === 'string') localStorage.setItem(key, value)
  }
  // the registry applied its app lists at creation, before this pull, so it re-applies them now
  try {
    const { applyUninstalled } = await import('@/stores/useRegistryStore')
    applyUninstalled()
  } catch {
    /* registry unavailable — the next boot applies */
  }
  // Live surfaces that already initialized from the OLD cache re-apply now.
  try {
    // initAccent() is boot-once idempotent — re-apply explicitly instead.
    const { applyAccent, storedAccent } = await import('./accent')
    applyAccent(storedAccent())
  } catch {
    /* accent module unavailable — cache applied anyway */
  }
  try {
    const { useAvatarPrefsStore } = await import('@/stores/useAvatarPrefsStore')
    const raw = localStorage.getItem('asa-avatar-prefs')
    if (raw) useAvatarPrefsStore.setState({ prefs: JSON.parse(raw) })
  } catch {
    /* malformed cache — store keeps its state */
  }
  try {
    // zustand/persist envelope — the preferences live under `state`.
    const { useUiPrefsStore, UI_PREFS_VERSION, migrateUiPrefs } =
      await import('@/stores/useUiPrefsStore')
    const raw = localStorage.getItem('asa-ui-prefs')
    const parsed = raw
      ? (JSON.parse(raw) as { state?: Partial<UiPrefsState>; version?: number })
      : undefined
    if (parsed?.state && typeof parsed.state === 'object') {
      const ver = parsed.version ?? 0
      if (ver < UI_PREFS_VERSION) {
        parsed.state = migrateUiPrefs(parsed.state, ver)
        parsed.version = UI_PREFS_VERSION
        localStorage.setItem('asa-ui-prefs', JSON.stringify(parsed))
      }
      useUiPrefsStore.setState(parsed.state)
    }
  } catch {
    /* malformed cache — store keeps its state */
  }
}

// applyPrefs found a dirty stamp before the user object loaded — re-run the decision once the identity is known…
function retryApplyWhenUserKnown(blob: Record<string, string>, tries = 0): void {
  if (tries > 20) return
  setTimeout(() => {
    if (useAuthStore.getState().user?.id != null) void applyPrefs(blob)
    else retryApplyWhenUserKnown(blob, tries + 1)
  }, 500)
}

let pushTimer: ReturnType<typeof setTimeout> | undefined

// THE DIRTY STAMP — set the moment a preference mutates, cleared only when a push lands.
const DIRTY_KEY = 'asa-prefs-dirty'

/** The stamp carries WHOSE change it is and SINCE WHEN (prefsRelease nextDirtyStamp). */
function markDirty(): void {
  try {
    const uid = useAuthStore.getState().user?.id ?? ''
    localStorage.setItem(DIRTY_KEY, nextDirtyStamp(localStorage.getItem(DIRTY_KEY), uid, Date.now()))
  } catch { /* held in-session */ }
}
function clearDirty(): void {
  try { localStorage.removeItem(DIRTY_KEY) } catch { /* harmless */ }
}
function dirtySince(): number | null {
  try { return dirtySinceOf(localStorage.getItem(DIRTY_KEY)) } catch { return null }
}
function dirtyUid(): string | null {
  try {
    const raw = localStorage.getItem(DIRTY_KEY)
    if (raw == null) return null
    const parsed = JSON.parse(raw) as { uid?: string }
    return String(parsed?.uid ?? '')
  } catch { return '' /* malformed stamp still counts as dirty, owner unknown */ }
}
function isDirty(): boolean {
  return dirtyUid() !== null
}

/** Debounced full-bundle push — call after any whitelisted pref mutation. */
export function schedulePrefsPush(): void {
  if (!useAuthStore.getState().token) return
  // wearing another account (Be Another): their preferences are read, never written, and no stamp is left
  if (isActing()) return
  markDirty()
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = undefined
    gasAction('prefsSet', { prefs: collectPrefs() })
      .then(() => clearDirty())
      .catch(() => {
        // offline/expired — the local cache still holds the preference and the dirty stamp keeps the next pull from…
      })
  }, 2500)
}

// THE REFRESH MUST NOT EAT THE PUSH: the debounce timer dies with the page, so a pref changed and refreshed inside…
export function flushPrefsPush(tokenOverride?: string): void {
  if (!isDirty() && pushTimer === undefined) return
  // wearing another account: this browser's preferences are not that person's to receive
  if (isActing()) return
  clearTimeout(pushTimer)
  pushTimer = undefined
  // logout hands the token in BY VALUE: its own store write (token: null) lands before the dynamic import's .then()…
  const token = tokenOverride ?? useAuthStore.getState().token
  if (!token) return
  try {
    void fetch('/gas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'body=' + encodeURIComponent(JSON.stringify({
        token, action: 'prefsSet', payload: { prefs: collectPrefs() },
      })),
      keepalive: true,
    }).then((r) => { if (r.ok) clearDirty() }).catch(() => { /* dirty stamp stands */ })
  } catch { /* dirty stamp stands */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushPrefsPush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPrefsPush()
  })
}

/* ---- self-wiring: pull once per session when a token appears ---- */

let pulledForToken: string | null = null

async function pullIfNeeded(token: string | null): Promise<void> {
  if (!token || token === pulledForToken) return
  pulledForToken = token
  try {
    const { prefs } = await gasAction<{ prefs: Record<string, string> | null }>('prefsGet')
    if (prefs && typeof prefs === 'object') await applyPrefs(prefs)
  } catch {
    /* server unreachable — local cache remains authoritative this session */
  }
}

// THE BADGE MATRIX RIDES THE SAME PULL: one fetch per sign-in hydrates the apps×badges rules every access check…
let badgePulledForToken: string | null = null
let badgePulledAt = 0
function pullBadgeRules(token: string | null, again = false): void {
  if (!token || (!again && token === badgePulledForToken)) return
  badgePulledForToken = token
  badgePulledAt = Date.now()
  void gasAction<{
    rules: Record<string, string[]>
    configRules?: Record<string, string[]>
    tenantRules?: Record<string, string[]>
  }>('appBadgeAccessGet', {})
    .then((d) => {
      // one read, three matrices: apps×badges, sections×badges and apps×tenants
      useBadgeAccessStore.getState().setRules(d.rules ?? {})
      useBadgeAccessStore.getState().setConfigRules(d.configRules ?? {})
      useBadgeAccessStore.getState().setTenantRules(d.tenantRules ?? {})
      markMatrixLanded(token)
    })
    .catch(() => {
      badgePulledForToken = null /* kept copy stands; retried next sign-in */
      markMatrixLanded(token)
    })
}

// A release in App Control reaches a tab that stays signed in: the matrix is read again when the tab comes back…
export const BADGE_REFRESH_MS = 3 * 60 * 1000
export function refreshBadgeRulesOnView(now: number = Date.now()): boolean {
  const token = useAuthStore.getState().token
  if (!token || token !== badgePulledForToken || now - badgePulledAt < BADGE_REFRESH_MS) return false
  pullBadgeRules(token, true)
  return true
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBadgeRulesOnView()
  })
}

// the sidebar's sections are the workspace's, so they arrive with the badge rules, once per sign-in
let shelfPulledForToken: string | null = null
function pullShelf(token: string | null): void {
  if (!token || token === shelfPulledForToken) return
  shelfPulledForToken = token
  void import('@/stores/useCategoryStore')
    .then(({ useCategoryStore }) => useCategoryStore.getState().load())
    .catch(() => { shelfPulledForToken = null /* kept copy stands; retried next sign-in */ })
}

// ONE EXECUTION FIRST, THE FOUR DOORS AFTER — the boot was still spending far too long reading.
function boot(token: string | null): void {
  if (!token) return
  void bootPull(token).then((parts) => {
    const applied = parts.prefs ? applyPrefs(parts.prefs) : Promise.resolve()
    if (parts.prefs) pulledForToken = token
    if (parts.access) { badgePulledForToken = token; badgePulledAt = Date.now(); markMatrixLanded(token) }
    // the shelf has no part in hubBoot yet — its own door, as always
    const pulled = pullIfNeeded(token)
    pullBadgeRules(token)
    pullShelf(token)
    void Promise.all([applied.catch(() => {}), pulled.catch(() => {})]).then(() => markSettled(token))
  })
}

/* ---- the moment this session's preferences have landed (lib/prefsSettled) ---- */

export { onPrefsSettled, prefsSettled } from '@/lib/prefsSettled'

queueMicrotask(() => {
  boot(useAuthStore.getState().token)
})
/** Only `boot()`: it calls the three doors itself, and a part hubBoot could not answer falls through to its own. */
useAuthStore.subscribe((s) => {
  boot(s.token)
})
