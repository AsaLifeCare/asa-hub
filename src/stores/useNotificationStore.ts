// Notification store: bell badge, bell panel, toasts.
// `srv-<n>` rows are relay notices (lib/noticesApi); `n-local-…` rows live in this session only.
import { create } from 'zustand'
import { toast, useToastStore, type ToastType } from '@/stores/useToastStore'
import { useUiPrefsStore } from '@/stores/useUiPrefsStore'
import { notifToastWanted, notifWanted } from '@/lib/notifPrefs'
import {
  NOTICE_ID_PREFIX, expiryOf, isServerNotice, markNotices, noticeAlert, readInbox, serverIdOf,
  toAppNotification,
  type ServerNotice,
} from '@/lib/noticesApi'
import { closeOsNotices, closeWorkerNotices, showOsNotice } from '@/lib/osNotify'
import type { AppNotification } from '@/engine/types'

type NotificationState = {
  items: AppNotification[]
  loaded: boolean
  /** incrementing counter — topbar bell wiggles when this changes */
  arrivalTick: number
  /** '' while the last read of the bell worked; otherwise why it did not. */
  inboxError: string
  /** the relay's newest notice id at the last read */
  seq: number
  /** What is holding every company notice back ('test mode'), or ''. */
  paused: string
  /** When the bell was last read whole — a paused bell asks again on the beat. */
  readAt: number
  fetchAll: (opts?: { force?: boolean }) => Promise<void>
  /** Read only what is newer than `seq`, and let the fresh ones interrupt. */
  refreshInbox: () => Promise<void>
  /** take relay notices in; `replace` drops what the relay no longer carries */
  absorb: (notices: ServerNotice[], opts: { announce: boolean; replace?: boolean }) => void
  /** the relay holds every notice: company rows leave, `paused` says why */
  hold: (why: string) => void
  markRead: (id: string) => void
  markAllRead: () => void
  markManyRead: (ids: string[]) => void
  /** Clear rows out of the bell; a relay notice stays cleared on every device. */
  dismiss: (ids: string[]) => void
  /** Another session took this tab: nothing of the last person's bell stays. */
  reset: () => void
  /** A row of this session's own; its id (its toast is keyed by it and leaves with it), or null when not wanted. */
  push: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'> & { read?: boolean }) => string | null
}

let pushSeq = 0
/** Minimum gap between whole-bell reads from opening the panel. */
const FULL_READ_GAP_MS = 20_000
let lastFullRead = 0
let inflight: Promise<void> | null = null
/** Bumped on every session change; a read lands only if it has not moved. */
let generation = 0

const TONE_TOAST: Record<string, ToastType> = { urgent: 'warning', good: 'success' }

function serverIds(ids: string[]): number[] {
  return ids.map(serverIdOf).filter((n): n is number => n !== null)
}

/** Remove toasts and OS copies whose bell row is read, cleared or gone. */
function retireStale(items: AppNotification[]): void {
  const live = new Set(items.filter((n) => !n.read && isServerNotice(n.id)).map((n) => n.id))
  useToastStore.getState().retire((t) => Boolean(t.key) && isServerNotice(String(t.key)) && !live.has(String(t.key)))
  closeOsNotices((key) => isServerNotice(key) && !live.has(key))
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  loaded: false,
  arrivalTick: 0,
  inboxError: '',
  seq: 0,
  paused: '',
  readAt: 0,

  fetchAll: async (opts) => {
    if (!opts?.force && get().loaded && Date.now() - lastFullRead < FULL_READ_GAP_MS) return
    if (inflight) return inflight
    const mine = generation
    let run: Promise<void> | null = null
    run = (async () => {
      try {
        const box = await readInbox(0)
        if (mine !== generation) return // another session took the tab meanwhile
        lastFullRead = Date.now()
        if (box.held) {
          get().hold(box.held)
          set({ loaded: true, inboxError: '', readAt: lastFullRead, seq: Math.max(get().seq, box.seq) })
          return
        }
        // a first read is not a round of arrivals
        get().absorb(box.notices, { announce: false, replace: true })
        set({ loaded: true, inboxError: '', paused: '', readAt: lastFullRead,
          seq: Math.max(get().seq, box.seq) })
      } catch (err) {
        if (mine === generation) set({ inboxError: err instanceof Error ? err.message : 'could not be read' })
      } finally {
        if (inflight === run) inflight = null
      }
    })()
    inflight = run
    return run
  },

  refreshInbox: async () => {
    // a paused bell reads whole: held notices have ids below `seq`
    if (!get().loaded || get().paused) return get().fetchAll({ force: true })
    if (inflight) return inflight
    const mine = generation
    let run: Promise<void> | null = null
    run = (async () => {
      try {
        const box = await readInbox(get().seq)
        if (mine !== generation) return // another session took the tab meanwhile
        if (box.held) {
          get().hold(box.held)
          set({ inboxError: '', seq: Math.max(get().seq, box.seq) })
          return
        }
        get().absorb(box.notices, { announce: true })
        set({ inboxError: '', seq: Math.max(get().seq, box.seq) })
      } catch (err) {
        if (mine === generation) set({ inboxError: err instanceof Error ? err.message : 'could not be read' })
      } finally {
        if (inflight === run) inflight = null
      }
    })()
    inflight = run
    return run
  },

  absorb: (arrived, { announce, replace }) => {
    const clock = useUiPrefsStore.getState().calendarClockTimes
    // a held notice is never drawn, and leaves if already there
    const held = new Set(arrived.filter((n) => n.held).map((n) => `${NOTICE_ID_PREFIX}${n.id}`))
    const notices = arrived.filter((n) => !n.held)
    const before = new Map(get().items.map((n) => [n.id, n]))
    const incoming = notices.map((n) => toAppNotification(n, clock))
    const incomingIds = new Set(incoming.map((n) => n.id))
    const fresh: ServerNotice[] = []
    const merged: AppNotification[] = incoming.map((n, i) => {
      const had = before.get(n.id)
      if (!had) fresh.push(notices[i])
      // a local read survives a relay answer that predates the mark
      return had?.read ? { ...n, read: true } : n
    })
    const kept = get().items.filter((n) => !incomingIds.has(n.id) && !held.has(n.id)
      && !(replace && isServerNotice(n.id)))
    const items = [...merged, ...kept].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    set((s) => ({ items, arrivalTick: s.arrivalTick + (fresh.length ? 1 : 0) }))
    retireStale(items)
    const toastsOn = notifToastWanted()
    const now = Date.now()
    for (const n of fresh) {
      const how = noticeAlert(n, now, toastsOn)
      // a non-arrival read interrupts only for a still-open pinned notice
      if (!how || (!announce && how !== 'pin')) continue
      const row = toAppNotification(n, clock)
      const urgent = how === 'pin'
      toast({
        type: urgent ? 'danger' : TONE_TOAST[n.tone] ?? 'info',
        title: row.title,
        body: row.body,
        action: row.href ? { label: 'View', href: row.href } : undefined,
        urgent,
        key: row.id,
        expiresAt: expiryOf(n) || undefined,
      })
      // a hidden tab gets an OS copy (lib/osNotify), except a notice marked `quiet`
      if (!n.quiet) {
        showOsNotice({
          key: row.id, title: row.title, body: row.body, href: row.href, urgent,
          onOpen: () => get().markRead(row.id),
        })
      }
    }
  },

  hold: (why) => {
    const items = get().items.filter((n) => !isServerNotice(n.id))
    set({ items, paused: why || 'test mode' })
    retireStale(items)
    closeWorkerNotices('all')
  },

  markRead: (id) => get().markManyRead([id]),

  markAllRead: () => get().markManyRead(get().items.filter((n) => !n.read).map((n) => n.id)),

  markManyRead: (ids) => {
    if (!ids.length) return
    const prev = get().items
    const want = new Set(ids)
    const items = prev.map((n) => (want.has(n.id) ? { ...n, read: true } : n))
    set({ items }) // optimistic
    retireStale(items)
    // read here is read on this device's push copy too
    closeWorkerNotices(want)
    // only relay notices are marked; a refused mark restores the unread dot
    const remote = serverIds(ids)
    if (!remote.length) return
    const wasUnread = new Set(prev.filter((n) => want.has(n.id) && !n.read && isServerNotice(n.id))
      .map((n) => n.id))
    const mine = generation
    markNotices(remote).catch(() => {
      if (mine !== generation) return // those rows belonged to the last session
      set((s) => ({ items: s.items.map((n) => (wasUnread.has(n.id) ? { ...n, read: false } : n)) }))
    })
  },

  dismiss: (ids) => {
    if (!ids.length) return
    const prev = get().items
    const gone = new Set(ids)
    const items = prev.filter((n) => !gone.has(n.id))
    set({ items })
    retireStale(items)
    // a local row's toast leaves with it too
    useToastStore.getState().retire((t) => Boolean(t.key) && gone.has(String(t.key)))
    closeWorkerNotices(gone)
    const remote = serverIds(ids)
    if (!remote.length) return
    const mine = generation
    markNotices(remote, true).catch(() => {
      // The rows being put back were the last session's: they stay gone.
      if (mine !== generation) return
      // not written on the relay: the rows come back
      set((s) => ({ items: [...prev.filter((n) => gone.has(n.id)), ...s.items]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) }))
      toast({ type: 'warning', title: 'Not cleared', body: 'The notices could not be cleared on the server. Try again.' })
    })
  },

  reset: () => {
    generation += 1
    inflight = null
    lastFullRead = 0
    set({ items: [], loaded: false, seq: 0, inboxError: '', paused: '', readAt: 0 })
    // The next person on this tab is never shown the last one's pinned call-off.
    retireStale([])
    closeWorkerNotices('all')
  },

  push: (n) => {
    // The person's own switches decide whether this kind arrives at all — and, separately, whether it may interrupt…
    if (!notifWanted(n.type)) return null
    const item: AppNotification = {
      ...n,
      id: `n-local-${++pushSeq}-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      read: n.read ?? false,
    }
    set((s) => ({ items: [item, ...s.items], arrivalTick: s.arrivalTick + 1 }))
    // no server write: `notifications` is readOnly; local rows live in this session
    if (item.priority === 'high' && notifToastWanted()) {
      toast({ type: 'info', title: item.title, body: item.body, action: item.href ? { label: 'View', href: item.href } : undefined,
        key: item.id })
    }
    return item.id
  },
}))

export const selectUnreadCount = (s: { items: AppNotification[] }) => s.items.filter((n) => !n.read).length
