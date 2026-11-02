// Notification bell panel (§8.2) — the standard 384px slide-over under the topbar.
// Tabs All/Unread/Mentions, Today/Earlier groups, click → navigate + mark read.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import { ohioSameDay } from '@/lib/ohio'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { visibleNotifications } from '@/lib/notificationVisibility'
import { useShellStore } from '@/stores/useShellStore'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import EmptyState from '@/components/shared/EmptyState'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { AppNotification, TintName } from '@/engine/types'

const TYPE_TINT: Record<AppNotification['type'], TintName> = {
  mention: 'blue',
  system: 'lavender',
  app: 'mint',
  reminder: 'amber',
}
const TYPE_ICON: Record<AppNotification['type'], string> = {
  mention: 'at-sign',
  system: 'info',
  app: 'layout-grid',
  reminder: 'alarm-clock',
}

/** A notice's tone wins over its type. */
const TONE_TINT: Record<NonNullable<AppNotification['tone']>, TintName> = { urgent: 'pink', good: 'mint' }
const TONE_ICON: Record<NonNullable<AppNotification['tone']>, string> = { urgent: 'triangle-alert', good: 'circle-check' }

function Row({ n, accent }: { n: AppNotification; accent?: TintName }) {
  const navigate = useNavigate()
  const { markRead } = useNotificationStore()
  const setOpen = useShellStore((s) => s.setNotifPanelOpen)
  const tint = n.tone ? TONE_TINT[n.tone] : n.type === 'app' && accent ? accent : TYPE_TINT[n.type]
  const icon = n.tone ? TONE_ICON[n.tone] : TYPE_ICON[n.type]
  return (
    <button
      onClick={() => {
        markRead(n.id)
        setOpen(false)
        if (n.href) navigate(n.href)
      }}
      className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2"
    >
      <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', TINT_BG[tint])}>
        <AppIcon name={icon} size={16} className={TINT_FG[tint]} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('clamp-1 block text-[13px] leading-5', n.read ? 'font-medium text-text-2' : 'font-semibold text-text-1')}>
          {n.title}
        </span>
        <span className="clamp-2 block text-[13px] leading-5 text-text-2">{n.body}</span>
        <span className="mt-0.5 block text-[12px] text-text-3">
          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
        </span>
      </span>
      {!n.read && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
    </button>
  )
}

export default function NotificationPanel() {
  const open = useShellStore((s) => s.notifPanelOpen)
  const setOpen = useShellStore((s) => s.setNotifPanelOpen)
  const { items: allItems, fetchAll, markAllRead, inboxError, paused } = useNotificationStore()
  // An app put away stops talking. See lib/notificationVisibility.
  const apps = useRegistryStore((s) => s.apps)
  const items = useMemo(() => visibleNotifications(allItems, apps), [allItems, apps])
  const navigate = useNavigate()
  const [tab, setTab] = useState('all')

  useEffect(() => {
    if (open) fetchAll()
  }, [open, fetchAll])

  const filtered = useMemo(() => {
    if (tab === 'unread') return items.filter((n) => !n.read)
    if (tab === 'mentions') return items.filter((n) => n.type === 'mention')
    return items
  }, [items, tab])

  // "Today" is OHIO's today: a notification raised at 9 PM in Canton belongs under Today for the director reading…
  const today = filtered.filter((n) => ohioSameDay(n.createdAt, new Date()))
  const earlier = filtered.filter((n) => !ohioSameDay(n.createdAt, new Date()))
  const accentOf = (appId?: string) => apps.find((a) => a.id === appId)?.accent

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-black/20 xl:bg-transparent"
          />
          <motion.aside
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            aria-label="Notifications panel"
            // under the Topbar, and under the strip at the top while it is up
            className="fixed bottom-0 right-0 top-[calc(68px+var(--hub-strip-h,0px))] z-30 flex w-full flex-col border-l border-border bg-surface shadow-3 sm:w-[384px]"
          >
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5">
              <h2 className="font-display text-[16px] font-bold text-text-1">Notifications</h2>
              <SegmentedTabs
                className="ml-auto"
                tabs={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'mentions', label: 'Mentions' }]}
                value={tab}
                onChange={setTab}
              />
              <button onClick={markAllRead} className="text-[12px] font-medium text-primary hover:text-primary-hover">
                Mark all read
              </button>
            </div>

            <div className="scroll-thin flex-1 overflow-y-auto p-2">
              {inboxError && (
                // unreadable: said, never "all caught up"
                <p className="m-2 rounded-md border border-danger bg-danger/[0.05] px-3 py-2 text-[12.5px] leading-[18px] text-text-1">
                  Your notices could not be read ({inboxError}). This is not an empty inbox.
                </p>
              )}
              {paused && !inboxError && (
                // held by test mode, not empty
                <p className="m-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-[18px] text-text-2">
                  Company notices are paused ({paused}). Nothing is lost: whatever is still true arrives here when the pause ends.
                </p>
              )}
              {filtered.length === 0 ? (
                inboxError || paused ? null : (
                  <EmptyState title="All caught up" body="New mentions, app updates and reminders will land here." />
                )
              ) : (
                <>
                  {today.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Today</p>
                      {today.map((n) => <Row key={n.id} n={n} accent={accentOf(n.appId)} />)}
                    </>
                  )}
                  {earlier.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Earlier</p>
                      {earlier.map((n) => <Row key={n.id} n={n} accent={accentOf(n.appId)} />)}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="border-t border-border p-3">
              <button
                onClick={() => { setOpen(false); navigate('/notifications') }}
                className="h-9 w-full rounded-md text-[13px] font-semibold text-primary transition-colors hover:bg-primary-soft"
              >
                View all
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
