// BE ANOTHER — the master wears another account, for debugging (BeAnother.gs).
// THE SERVER DECIDES EVERYTHING.
import {
  REAL_TOKEN_KEY, followMovedSession, isActing, restoreRealSession, sessionMovedUnderThisTab, useAuthStore,
} from '@/auth/useAuthStore'
import type { BeAnotherBlock } from '@/auth/types'
import { gasAction } from '@/features/hiring/shared'
import { isAwayTenant, useTenantStore } from '@/stores/useTenantStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { resetPlace } from '@/lib/placeReset'
import { rebootIntoWorkspace } from '@/lib/reboot'
import { toast } from '@/stores/useToastStore'

const TOKEN_KEY = 'asa-hub-token'
/** A sentence the last Be Back left for the next boot, shown once. */
const NOTE_KEY = 'asa-be-another-note'

export { isActing }

/** One account the master may wear, as beAnotherList answers it. */
export type BeAnotherAccount = {
  id: string
  display_name: string
  email: string
  role: string
  types: string[]
  title: string
  avatar: string
  active: boolean
  home_tenant: string
  system_hidden: boolean
}

export type BeAnotherList = { accounts: BeAnotherAccount[]; ttl_minutes: number }

/** Every account to act as. Throws with the server's own sentence; an unread list is never an empty one. */
export async function listAccounts(): Promise<BeAnotherList> {
  const d = await gasAction<{ accounts?: unknown; ttl_minutes?: unknown }>('beAnotherList', {})
  if (!d || !Array.isArray(d.accounts)) {
    throw new Error('The accounts could not be read — the answer carried no list.')
  }
  const accounts = d.accounts.map((raw) => {
    const a = (raw ?? {}) as Record<string, unknown>
    return {
      id: String(a.id ?? ''),
      display_name: String(a.display_name ?? ''),
      email: String(a.email ?? ''),
      role: String(a.role ?? ''),
      types: Array.isArray(a.types) ? a.types.map((t) => String(t)) : [],
      title: String(a.title ?? ''),
      avatar: String(a.avatar ?? ''),
      active: a.active !== false,
      home_tenant: String(a.home_tenant ?? ''),
      system_hidden: a.system_hidden === true,
    }
  }).filter((a) => a.id)
  return { accounts, ttl_minutes: Number(d.ttl_minutes) || 0 }
}

// Why a start cannot be offered HERE, or '' when it can.
export function startBlocker(): string {
  const block = useAuthStore.getState().beAnother
  if (!block) return 'Be Another belongs to the master account alone.'
  if (block.acting) return `You are acting as ${block.acting.display_name || 'another account'} — press Be Back first.`
  if (useMemberStore.getState().currentMemberId) return 'Leave the visit first — Be Another starts from your own workspace.'
  if (useWorldStore.getState().currentWorldId || isAwayTenant(useTenantStore.getState())) {
    return 'Be Another starts from headquarters — go home first.'
  }
  return ''
}

/** The display name of the acting block, for sentences. */
export function actingName(block: BeAnotherBlock | null | undefined): string {
  const a = block?.acting
  return a ? (a.display_name || a.email || 'another account') : ''
}

/** HH:MM on this browser's clock. */
export function clockOf(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Wear `id`.
export async function startActing(id: string): Promise<void> {
  const blocked = startBlocker()
  if (blocked) throw new Error(blocked)
  const master = useAuthStore.getState().token
  if (!master) throw new Error('Not signed in.')
  const d = await gasAction<{ token?: string; user?: { display_name?: string; email?: string }; be_another?: unknown }>(
    'beAnotherStart', { id })
  const child = String(d?.token ?? '')
  if (!child || child === master) throw new Error('The server answered without an acting session — nothing changed.')
  // the master's own pending preferences leave with the master's token, before it steps aside
  try {
    const { flushPrefsPush } = await import('@/lib/prefsSync')
    flushPrefsPush(master)
  } catch { /* the dirty stamp keeps them for the master's next boot */ }
  localStorage.setItem(REAL_TOKEN_KEY, master)
  localStorage.setItem(TOKEN_KEY, child)
  const name = String(d?.user?.display_name || d?.user?.email || 'another account')
  // nothing is painted under the wrong token: the boot names the worn account from its own authMe
  useAuthStore.setState({ user: null, hydrated: false, beAnother: null })
  resetPlace()
  rebootIntoWorkspace(`Acting as ${name}…`)
}

let leaving = false

// BE BACK.
export async function beBack(opts: { expired?: boolean } = {}): Promise<void> {
  if (leaving) return
  leaving = true
  // another tab already went back: nothing is left here to end, and nothing here may be signed out
  if (sessionMovedUnderThisTab()) {
    followMovedSession('Another tab went back to your own account — following it…')
    return
  }
  const block = useAuthStore.getState().beAnother
  const name = actingName(block) || 'the other account'
  let note = ''
  if (!opts.expired) {
    try {
      await gasAction('beAnotherStop', {})
    } catch (e) {
      const until = block?.acting?.local_until ?? 0
      note = `The server did not confirm the end (${e instanceof Error ? e.message : 'no answer'}) — ` +
        `that session ends by itself at ${clockOf(until)}.`
    }
  }
  if (note) {
    try { localStorage.setItem(NOTE_KEY, note) } catch { /* the session still ends at its clock */ }
  }
  const label = opts.expired ? `Your time acting as ${name} ended — back to your own account…`
    : 'Back to your own account…'
  if (restoreRealSession(label)) return
  leaving = false
  // another tab of this browser already went back (every tab arms the same clock): follow it, sign out nobody
  if (sessionMovedUnderThisTab()) {
    followMovedSession('Another tab went back to your own account — following it…')
    return
  }
  // no real sign-in is held here: signing out is the only honest way back
  useAuthStore.getState().logout()
  rebootIntoWorkspace('Signing out…', '#/login')
}

export function takeBeBackNote(): string {
  try {
    const note = localStorage.getItem(NOTE_KEY) || ''
    if (note) localStorage.removeItem(NOTE_KEY)
    return note
  } catch {
    return ''
  }
}

/* ---- the clock, and every other tab ---- */

let expiryTimer: ReturnType<typeof setTimeout> | undefined
let armedFor = 0

function armExpiry(): void {
  const until = useAuthStore.getState().beAnother?.acting?.local_until ?? 0
  if (until === armedFor) return
  armedFor = until
  clearTimeout(expiryTimer)
  expiryTimer = undefined
  if (!until) return
  expiryTimer = setTimeout(() => { void beBack({ expired: true }) }, Math.max(0, until - Date.now()))
}

/** For the tests: forget this page load's crossing and clock. */
export function resetBeAnotherForTests(): void {
  leaving = false
  armedFor = 0
  clearTimeout(expiryTimer)
  expiryTimer = undefined
}

/** The note from the last Be Back, said once the real account is back on screen. */
function sayBeBackNote(): void {
  const s = useAuthStore.getState()
  if (!s.hydrated || !s.user || s.beAnother?.acting) return
  const note = takeBeBackNote()
  if (note) toast({ type: 'warning', title: 'Back to your own account', body: note })
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  useAuthStore.subscribe(() => { armExpiry(); sayBeBackNote() })
  queueMicrotask(() => { armExpiry(); sayBeBackNote() })
  window.addEventListener('storage', (ev: StorageEvent) => {
    if (ev.key !== REAL_TOKEN_KEY) return
    // another tab of this browser started or ended acting: this one follows, never a tab of each
    rebootIntoWorkspace(ev.newValue ? 'Another tab is acting as another account — following it…'
      : 'Another tab went back to your own account — following it…')
  })
}
