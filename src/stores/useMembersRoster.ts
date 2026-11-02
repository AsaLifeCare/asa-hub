// THE ROSTER, LOADED ONCE AND KEPT CURRENT.
// Adding another platform user used to require refreshing the screen before they appeared.
import { create } from 'zustand'
import { useAuthStore } from '@/auth/useAuthStore'

export type RosterMember = {
  member_id: string
  user_id?: string
  email: string
  name: string
  role: string
  types?: string[]
  status: string
  scope: string
  avatar?: string
  title?: string
  /** their world, and only while they have left the door open */
  world_id?: string
}

type RosterState = {
  /** null = not answered yet. [] = answered, and there is nobody. */
  rows: RosterMember[] | null
  loading: boolean
  /** bumped on every successful load, so memos can hang off one number */
  version: number
  /** Fetch unless a fetch is already in flight. */
  load: (force?: boolean) => Promise<void>
  /** Every screen that adds, authorises or removes somebody calls this. */
  invalidate: () => void
  // Seed from a read somebody else already paid for (lib/bootPull) — it counts as the boot's read, so `load()` will…
  adopt: (rows: RosterMember[]) => void
}

// THE LAST GOOD ANSWER, ON DISK.
const shelfKey = (uid: string) => `asa-members-roster:${uid}`

function currentUid(): string {
  try {
    const raw = localStorage.getItem('asa-auth')
    return String(JSON.parse(raw ?? '{}')?.state?.user?.id ?? '')
  } catch {
    return ''
  }
}

function readShelf(): RosterMember[] | null {
  const uid = currentUid()
  if (!uid) return null
  try {
    const raw = localStorage.getItem(shelfKey(uid))
    if (!raw) return null
    const list = JSON.parse(raw) as RosterMember[]
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

function writeShelf(rows: RosterMember[]): void {
  const uid = currentUid()
  if (!uid) return
  try { localStorage.setItem(shelfKey(uid), JSON.stringify(rows)) } catch { /* the visit still works */ }
}

export const useMembersRoster = create<RosterState>((set, get) => ({
  rows: readShelf(),
  loading: false,
  version: 0,
  load: async (force = false) => {
    if (get().loading) return
    // A CACHED LIST IS NOT AN ANSWER.
    if (!force && get().version > 0) return
    set({ loading: true })
    try {
      const { gasAction } = await import('@/features/hiring/shared')
      const r = await gasAction<{ members?: RosterMember[] }>('platformMembersList', {})
      const rows = (r?.members ?? []).filter((m) => m.status === 'active')
      writeShelf(rows)
      set({ rows, version: get().version + 1 })
    } catch {
      // UNSURE NEVER STRIPS.
      const g = get() as { _retries?: number }
      const n = (g._retries ?? 0) + 1
      ;(set as (p: object) => void)({ _retries: n })
      if (n <= 3) window.setTimeout(() => { void get().load(true) }, 15000 * n)
    } finally {
      set({ loading: false })
    }
  },
  invalidate: () => { void get().load(true) },
  adopt: (rows) => {
    writeShelf(rows)
    set({ rows, version: get().version + 1 })
  },
}))

// AND IT LETS GO WHEN THE ACCOUNT CHANGES — a client's own My world card drew as a bare circle with no name and no…
let knownUid = currentUid()
useAuthStore.subscribe((s) => {
  const uid = String(s.user?.id ?? '')
  if (uid === knownUid) return
  knownUid = uid
  // rows: null is "not answered yet", which is what a new account truly is — never [], because an empty stack says…
  useMembersRoster.setState({ rows: readShelf(), version: 0 })
  // THE ONE-EXECUTION BOOT ANSWERS THIS TOO (2026-08-29).
  if (uid) {
    void import('@/lib/bootPull').then(({ bootPull }) =>
      bootPull(useAuthStore.getState().token).then((parts) => {
        if (!parts.members) void useMembersRoster.getState().load(true)
      }),
    ).catch(() => { void useMembersRoster.getState().load(true) })
  }
})

/** Never wraps: first name kept whole, the rest initialled, clipped only as a last resort. */
export function fitName(full: string, budget = 17): string {
  const name = String(full ?? '').trim().replace(/\s+/g, ' ')
  if (!name || name.length <= budget) return name
  const parts = name.split(' ')
  if (parts.length === 1) return name.slice(0, budget - 1) + '…'
  // first name + initials for everything after it
  const first = parts[0]
  const initialled = `${first} ${parts.slice(1).map((p) => p[0].toUpperCase() + '.').join(' ')}`
  if (initialled.length <= budget) return initialled
  // first name + ONE initial (the last name's, the one that identifies)
  const one = `${first} ${parts[parts.length - 1][0].toUpperCase()}.`
  if (one.length <= budget) return one
  // a first name longer than the budget on its own: clip it, keep the initial
  return `${first.slice(0, Math.max(1, budget - 3))}… ${parts[parts.length - 1][0].toUpperCase()}.`
}
