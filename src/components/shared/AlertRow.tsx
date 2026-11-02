// One alert row and the Today / Yesterday / Earlier groups — shared by the Notification Center and My Inbox.
// The row draws and calls back; what a mark or a clear writes is the caller's.
import { ArrowUpRight, Check, Flag, Trash2 } from 'lucide-react'
import { differenceInMinutes, differenceInHours } from 'date-fns'
import { ohioDay, ohioDayOf, ohioSameDay } from '@/lib/ohio'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import TintTile from '@/components/shared/TintTile'
import { Dot } from '@/components/shared/Badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { personById } from '@/lib/people-lookup'
import { cn } from '@/lib/utils'
import type { AppNotification, TintName } from '@/engine/types'

/** 'now', '5m', '3h' today, else the Ohio day. */
export function relTime(iso: string): string {
  const d = new Date(iso)
  const mins = differenceInMinutes(new Date(), d)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = differenceInHours(new Date(), d)
  // "today" and the day label are Ohio's, not the viewer's
  if (hrs < 24 && ohioSameDay(d, new Date())) return `${hrs}h`
  return ohioDay(d)
}

export type DayGroup<T> = { label: string; rows: T[] }

// Today / Yesterday / Earlier by the OHIO day each row's `dayOf` names ('yyyy-mm-dd', '' for none), empty groups…
export function dayGroups<T>(rows: T[], dayOf: (row: T) => string, now: Date = new Date()): DayGroup<T>[] {
  const g: DayGroup<T>[] = [
    { label: 'Today', rows: [] },
    { label: 'Yesterday', rows: [] },
    { label: 'Earlier', rows: [] },
  ]
  const today = ohioDayOf(now)
  const yesterday = ohioDayOf(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  for (const r of rows) {
    const day = dayOf(r)
    if (day && day === today) g[0].rows.push(r)
    else if (day && day === yesterday) g[1].rows.push(r)
    else g[2].rows.push(r)
  }
  return g.filter((x) => x.rows.length > 0)
}

export type AlertActor = { id?: string; name: string; avatar?: string; role?: string }

/** A level's paint: a warning's unread bar and wash are the danger red, an important one's amber. */
const LEVEL_BAR: Record<'warning' | 'important', string> = { warning: 'bg-danger', important: 'bg-[var(--warning)]' }
const LEVEL_WASH: Record<'warning' | 'important', string> = {
  warning: 'bg-[color-mix(in_srgb,var(--danger)_7%,transparent)]',
  important: 'bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]',
}
const ROW_PILL: Record<'danger' | 'warning' | 'good' | 'muted', string> = {
  danger: 'bg-tint-pink text-danger',
  warning: 'bg-tint-amber text-tint-fg-amber',
  good: 'bg-[var(--status-green-soft)] text-[var(--status-green)]',
  muted: 'bg-surface-2 text-text-2',
}

export function AlertRow({
  icon,
  tint,
  title,
  body,
  when,
  read,
  flag,
  level,
  pill,
  actor,
  canOpen,
  openLabel = 'Open',
  selectMode,
  selected,
  selectLabel = 'Select notification',
  onSelect,
  onOpen,
  onMarkRead,
  onDelete,
  deleteLabel = 'Delete',
}: {
  icon: string
  tint: TintName
  title: string
  body: string
  /** the stamp at the right, already in words */
  when: string
  read: boolean
  flag: boolean
  /** absent: the row is painted as every other */
  level?: 'warning' | 'important' | 'info'
  /** a word under the title, always shown (never a button) */
  pill?: { text: string; tone: 'danger' | 'warning' | 'good' | 'muted' } | null
  actor?: AlertActor
  canOpen: boolean
  openLabel?: string
  selectMode: boolean
  selected: boolean
  selectLabel?: string
  onSelect: (on: boolean) => void
  onOpen: () => void
  /** absent: the row offers no mark */
  onMarkRead?: () => void
  /** absent: the row offers no clear */
  onDelete?: () => void
  deleteLabel?: string
}) {
  const strong = level === 'warning' || level === 'important' ? level : null
  return (
    <div
      role="button"
      tabIndex={0}
      data-level={level || undefined}
      onClick={() => (selectMode ? onSelect(!selected) : onOpen())}
      onKeyDown={(e) => e.key === 'Enter' && (selectMode ? onSelect(!selected) : onOpen())}
      className={cn(
        'group relative flex min-h-[72px] cursor-pointer items-start gap-3 px-5 py-4 transition-colors duration-150',
        !read ? (strong ? LEVEL_WASH[strong] : 'bg-primary-soft') : 'hover:bg-surface-2',
      )}
    >
      {!read && <span className={cn('absolute bottom-3 left-0 top-3 w-[3px] rounded-full', strong ? LEVEL_BAR[strong] : 'bg-primary')} />}
      {selectMode && (
        <div className="flex h-10 items-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={selectLabel} />
        </div>
      )}
      <div className="relative shrink-0">
        <TintTile icon={icon} tint={tint} size="md" />
        {actor && (
          // The badge is positioned by the WRAPPER now — the offsets have to stay on the box that is the positioned…
          <DragPerson
            name={actor.name}
            id={actor.id}
            avatar={actor.avatar}
            subtitle={actor.role}
            className="absolute -bottom-1 -right-1"
          >
            <Avatar
              src={actor.avatar}
              name={actor.name}
              size="xs"
              className="h-[18px] w-[18px] ring-2 ring-surface"
            />
          </DragPerson>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('text-[14px] leading-5', read ? 'font-medium text-text-2' : 'font-semibold text-text-1')}>
          {title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-text-2">{body}</p>
        {pill && (
          <span data-row-pill={pill.tone}
            className={cn('mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', ROW_PILL[pill.tone])}>
            {pill.text}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5">
          {flag && <Flag size={11} className="text-danger" />}
          <span className="text-[12px] tabular-nums text-text-3">{when}</span>
          {read ? <span className="w-1.5" /> : <Dot className="h-2 w-2" />}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {!read && onMarkRead && (
            <button
              onClick={(e) => { e.stopPropagation(); onMarkRead() }}
              aria-label="Mark as read"
              className="grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface hover:text-primary"
            >
              <Check size={13} />
            </button>
          )}
          {canOpen && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpen() }}
              aria-label={openLabel}
              className="grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface hover:text-text-1"
            >
              <ArrowUpRight size={13} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              aria-label={deleteLabel}
              className="grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The Notification Center's row: a bell notification drawn through the one alert row. */
export function NotificationRow({
  n,
  selectMode,
  selected,
  onSelect,
  onOpen,
  onMarkRead,
  onDelete,
}: {
  n: AppNotification
  selectMode: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  onOpen: () => void
  onMarkRead: () => void
  onDelete: () => void
}) {
  const app = useRegistryStore((s) => (n.appId ? s.getApp(n.appId) : undefined))
  const person = n.actorId ? personById(n.actorId) : undefined

  let icon = 'info'
  let tint: TintName = 'lavender'
  if (n.type === 'mention') {
    icon = 'at-sign'
    tint = 'blue'
  } else if (n.type === 'reminder') {
    icon = 'bell'
    tint = 'amber'
  } else if (n.type === 'app') {
    icon = app?.icon ?? 'layout-grid'
    tint = app?.accent ?? 'mint'
  }

  return (
    <AlertRow
      icon={icon}
      tint={tint}
      title={n.title}
      body={n.body}
      when={relTime(n.createdAt)}
      read={n.read}
      flag={n.priority === 'high'}
      actor={person ? { id: n.actorId, name: person.name, avatar: person.avatar, role: person.role } : undefined}
      canOpen={!!n.href}
      selectMode={selectMode}
      selected={selected}
      onSelect={onSelect}
      onOpen={onOpen}
      onMarkRead={onMarkRead}
      onDelete={onDelete}
    />
  )
}
