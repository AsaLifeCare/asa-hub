// Notification Center (route /notifications) — full inbox (notifications.md).
// Filter tabs (All/Unread/Mentions), type chips, day groups (Today/Yesterday/ Earlier), bulk actions (mark all…
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  CheckCheck,
  Loader2,
  PartyPopper,
  Settings2,
  Trash2,
} from 'lucide-react'
import { ohioDayOf } from '@/lib/ohio'
import { NotificationRow, dayGroups } from '@/components/shared/AlertRow'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import FilterChips, { type ActiveFilter } from '@/components/shared/FilterChips'
import PageHeader from '@/components/shared/PageHeader'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import Skeleton from '@/components/shared/Skeleton'
import { useNotificationStore, selectUnreadCount } from '@/stores/useNotificationStore'
import { visibleNotifications } from '@/lib/notificationVisibility'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { toast } from '@/stores/useToastStore'
import { staggerContainer, staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { AppNotification, NotificationType } from '@/engine/types'

const TYPE_CHIP_MAP: Record<string, NotificationType> = {
  Mentions: 'mention',
  System: 'system',
  Apps: 'app',
  Reminders: 'reminder',
}

const EMPTY_COPY: Record<string, { title: string; body: string }> = {
  all: { title: 'Nothing here yet', body: 'When your apps and teammates send you something, it will land here.' },
  unread: { title: 'No unread notifications', body: "You're all caught up — nice." },
  mentions: { title: 'No mentions yet', body: "When someone @s you in a document, it'll land here." },
}

export default function NotificationsPage() {
  const {
    items: allItems, loaded, fetchAll, markRead, markAllRead, markManyRead, dismiss, inboxError, paused,
  } = useNotificationStore()
  // An app put away stops talking. See lib/notificationVisibility.
  const apps = useRegistryStore((s) => s.apps)
  const items = useMemo(() => visibleNotifications(allItems, apps), [allItems, apps])
  const unread = useNotificationStore(selectUnreadCount)
  const navigate = useNavigate()

  const [tab, setTab] = useState('all')
  const [typeFilters, setTypeFilters] = useState<ActiveFilter[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState(10)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const mentionCount = items.filter((n) => n.type === 'mention').length

  const filtered = useMemo(() => {
    const type = typeFilters[0] ? TYPE_CHIP_MAP[typeFilters[0].value] : undefined
    return items
      .filter((n) => (tab === 'unread' ? !n.read : tab === 'mentions' ? n.type === 'mention' : true))
      .filter((n) => (type ? n.type === type : true))
  }, [items, tab, typeFilters])

  // the header and the chip on the row have to agree: relTime() prints the OHIO day, so the section has to be the…
  const groups = useMemo(
    () => dayGroups(filtered.slice(0, visible), (n) => ohioDayOf(n.createdAt)),
    [filtered, visible],
  )

  const openNotification = (n: AppNotification) => {
    if (!n.read) markRead(n.id)
    if (n.href) navigate(n.href)
  }

  // through the store, so relay marks follow every device and refusals come back
  const removeItems = (ids: string[]) => dismiss(ids)

  const markItemsRead = (ids: string[]) => markManyRead(ids)

  const clearRead = () => {
    const readIds = items.filter((n) => n.read).map((n) => n.id)
    if (readIds.length === 0) return
    removeItems(readIds)
    toast({ type: 'success', title: 'Read notifications cleared', body: `${readIds.length} item${readIds.length === 1 ? '' : 's'} removed from your inbox.` })
  }

  const loadMore = () => {
    setLoadingMore(true)
    window.setTimeout(() => {
      setVisible((v) => v + 10)
      setLoadingMore(false)
    }, 400)
  }

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Notifications"
        subtitle="Everything your apps and teammates sent you."
        actions={
          <>
            {unread > 0 && (
              <motion.span
                key={unread}
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="mr-1 inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-on-primary"
              >
                {unread} unread
              </motion.span>
            )}
            <button
              onClick={() => navigate('/settings#notifications')}
              className="flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              <Settings2 size={14} /> Notification settings
            </button>
            <button
              onClick={() => {
                markAllRead()
                toast({ type: 'success', title: 'All caught up', body: 'Every notification was marked as read.' })
              }}
              disabled={unread === 0}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              <CheckCheck size={14} /> Mark all as read
            </button>
          </>
        }
      />

      {/* toolbar (sticky) */}
      <div className="sticky top-0 z-10 -mx-2 mb-4 flex flex-wrap items-center gap-2 bg-bg/85 px-2 py-3 backdrop-blur">
        <SegmentedTabs
          tabs={[
            { id: 'all', label: `All · ${items.length}` },
            { id: 'unread', label: `Unread · ${unread}` },
            { id: 'mentions', label: `Mentions · ${mentionCount}` },
          ]}
          value={tab}
          onChange={setTab}
        />
        <FilterChips
          filters={[{ key: 'type', label: 'Type', options: Object.keys(TYPE_CHIP_MAP) }]}
          active={typeFilters}
          onAdd={(f) => setTypeFilters([f])}
          onRemove={() => setTypeFilters([])}
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            className={cn(
              'h-9 rounded-md px-3 text-[13px] font-medium transition-colors',
              selectMode ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
            )}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
          <button
            onClick={clearRead}
            className="h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            Clear read
          </button>
        </div>
      </div>

      {inboxError && (
        // unreadable: said, never an empty inbox
        <p className="mb-4 rounded-lg border-2 border-danger bg-danger/[0.05] px-4 py-2.5 text-[12.5px] leading-[18px] text-text-1">
          Your notices could not be read ({inboxError}). This page is not saying there are none.
        </p>
      )}
      {paused && !inboxError && (
        // held by test mode, not empty
        <p className="mb-4 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-[12.5px] leading-[18px] text-text-2">
          Company notices are paused ({paused}). Nothing is lost: whatever is still true arrives here when the pause ends.
        </p>
      )}

      {/* list */}
      {!loaded && !inboxError ? (
        <div className="space-y-4">
          {[0, 1].map((g) => (
            <div key={g}>
              <Skeleton className="mb-2 h-3 w-20" />
              <Card padded={false} className="divide-y divide-border">
                {[0, 1, 2].map((r) => (
                  <div key={r} className="flex items-center gap-3 px-5 py-4">
                    <Skeleton className="h-9 w-9 rounded-[10px]" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-2/5" />
                      <Skeleton className="h-3 w-3/5" />
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        inboxError || paused ? null : <Card padded={false}>
          <EmptyState
            title={EMPTY_COPY[tab]?.title ?? 'Nothing here'}
            body={EMPTY_COPY[tab]?.body}
            action={
              typeFilters.length
                ? { label: 'Clear filters', onClick: () => setTypeFilters([]) }
                : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{g.label}</h2>
              <motion.div variants={staggerContainer} initial="hidden" animate="show">
                <Card padded={false} className="divide-y divide-border overflow-hidden">
                  {g.rows.map((n, i) => (
                    <motion.div key={n.id} variants={i < 8 ? staggerItem : undefined} layout="position">
                      <NotificationRow
                        n={n}
                        selectMode={selectMode}
                        selected={selected.has(n.id)}
                        onSelect={(on) => toggleSelect(n.id, on)}
                        onOpen={() => openNotification(n)}
                        onMarkRead={() => markRead(n.id)}
                        onDelete={() => {
                          removeItems([n.id])
                          toast({ type: 'info', title: 'Notification deleted' })
                        }}
                      />
                    </motion.div>
                  ))}
                </Card>
              </motion.div>
            </section>
          ))}

          {/* footer */}
          <div className="flex justify-center pb-4 pt-1">
            {visible < filtered.length ? (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex h-9 items-center gap-2 rounded-md px-4 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                Load older notifications
              </button>
            ) : (
              <p className="flex items-center gap-1.5 text-[12px] text-text-3">
                <PartyPopper size={14} className="text-primary" /> You're all caught up
              </p>
            )}
          </div>
        </div>
      )}

      {/* floating bulk bar */}
      <AnimatePresence>
        {selectMode && selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            className="sticky bottom-4 z-10 mt-4 flex justify-center"
          >
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 shadow-2">
              <span className="px-2 text-[12px] font-medium text-text-2">{selected.size} selected</span>
              <button
                onClick={() => {
                  markItemsRead([...selected])
                  toast({ type: 'success', title: `${selected.size} marked as read` })
                  exitSelect()
                }}
                className="flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <Check size={13} /> Mark read
              </button>
              <button
                onClick={() => {
                  removeItems([...selected])
                  toast({ type: 'success', title: `${selected.size} notification${selected.size === 1 ? '' : 's'} deleted` })
                  exitSelect()
                }}
                className="flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[12px] font-semibold text-danger transition-colors hover:bg-tint-pink"
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
