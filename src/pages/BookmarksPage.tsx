// Bookmarks (route /bookmarks) — everything pinned via BookmarkButton, grouped by type (People / Documents / Videos…
// Rows: avatar-or-tint-tile, title, subtitle, relative time, open (navigates to href) + remove.
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight, Trash2 } from 'lucide-react'
import { differenceInHours, differenceInMinutes } from 'date-fns'
import Avatar from '@/components/shared/Avatar'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import { AppIcon } from '@/lib/icons'
import { ohioDay, ohioSameDay } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { staggerContainer, staggerItem } from '@/engine/motion'
import { useBookmarksStore, type Bookmark, type BookmarkType } from '@/stores/useBookmarksStore'
import type { TintName } from '@/engine/types'

type GroupDef = {
  id: string
  label: string
  types: BookmarkType[]
  icon: string
  tint: TintName
}

const GROUPS: GroupDef[] = [
  { id: 'people', label: 'People', types: ['person'], icon: 'users', tint: 'lavender' },
  { id: 'documents', label: 'Documents', types: ['document'], icon: 'file-text', tint: 'peach' },
  { id: 'videos', label: 'Videos', types: ['video'], icon: 'play-circle', tint: 'pink' },
  { id: 'other', label: 'Other', types: ['candidate', 'page', 'widget'], icon: 'bookmark', tint: 'blue' },
]

const TYPE_ICON: Record<BookmarkType, string> = {
  person: 'users',
  document: 'file-text',
  video: 'play-circle',
  candidate: 'user-check',
  page: 'layout-grid',
  widget: 'layout-dashboard',
}

// "now" / "42m ago" / "5h ago" while it is still today, then the DAY it was saved.
function relTime(iso: string): string {
  const d = new Date(iso)
  const mins = differenceInMinutes(new Date(), d)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hrs = differenceInHours(new Date(), d)
  if (hrs < 24 && ohioSameDay(d, new Date())) return `${hrs}h ago`
  return ohioDay(d)
}

function BookmarkRow({ bookmark, index }: { bookmark: Bookmark; index: number }) {
  const remove = useBookmarksStore((s) => s.remove)
  const navigate = useNavigate()
  // A bookmarked PERSON is draggable to the tracker; a document, a video, a page or a widget is not — an empty name…
  const personName = bookmark.type === 'person' || bookmark.type === 'candidate' ? bookmark.title : ''
  return (
    <motion.div
      variants={index < 8 ? staggerItem : undefined}
      layout="position"
      className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-2"
    >
      {bookmark.avatar ? (
        <DragPerson name={personName} id={bookmark.refId} avatar={bookmark.avatar} subtitle={bookmark.subtitle} className="shrink-0">
          <Avatar src={bookmark.avatar} name={bookmark.title} size="md" />
        </DragPerson>
      ) : (
        <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-[10px]', TINT_BG[bookmark.tint])}>
          <AppIcon name={TYPE_ICON[bookmark.type]} size={18} className={TINT_FG[bookmark.tint]} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <DragPerson name={personName} id={bookmark.refId} avatar={bookmark.avatar} subtitle={bookmark.subtitle} className="block min-w-0">
          <div className="clamp-1 text-[14px] font-semibold leading-5 text-text-1">{bookmark.title}</div>
        </DragPerson>
        {bookmark.subtitle && <div className="clamp-1 text-[12px] leading-4 text-text-3">{bookmark.subtitle}</div>}
      </div>
      <span className="shrink-0 text-[12px] tabular-nums text-text-3">{relTime(bookmark.createdAt)}</span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => navigate(bookmark.href)}
          className="flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] font-semibold text-primary-strong transition-colors duration-150 hover:bg-primary-soft"
          aria-label={`Open ${bookmark.title}`}
        >
          Open <ArrowRight size={13} />
        </button>
        <button
          onClick={() => remove(bookmark.id)}
          className="grid h-8 w-8 place-items-center rounded-md text-text-3 transition-colors duration-150 hover:bg-surface-3 hover:text-danger"
          aria-label={`Remove bookmark: ${bookmark.title}`}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </motion.div>
  )
}

export default function BookmarksPage() {
  const bookmarks = useBookmarksStore((s) => s.bookmarks)

  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: bookmarks
          .filter((b) => g.types.includes(b.type))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      })).filter((g) => g.items.length > 0),
    [bookmarks],
  )

  return (
    <div className="w-full">
      <PageHeader
        title="Bookmarks"
        subtitle={
          bookmarks.length === 0
            ? 'Star people, documents, videos and pages to find them here.'
            : `${bookmarks.length} saved ${bookmarks.length === 1 ? 'item' : 'items'}`
        }
      />

      {bookmarks.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title="No bookmarks yet"
            body="Tap the star on any person, document, video or page and it will wait for you here."
            action={{ label: 'Browse the App Hub', href: '/apps' }}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.id}>
              {/* tinted group header */}
              <div className={cn('mb-2 flex items-center gap-2 rounded-md px-3 py-2', TINT_BG[group.tint])}>
                <AppIcon name={group.icon} size={14} className={TINT_FG[group.tint]} />
                <h2 className={cn('text-[12px] font-semibold uppercase tracking-[0.08em]', TINT_FG[group.tint])}>
                  {group.label}
                </h2>
                <span className={cn('text-[12px] font-medium', TINT_FG[group.tint])}>· {group.items.length}</span>
              </div>
              <Card padded={false} className="divide-y divide-border overflow-hidden">
                <motion.div variants={staggerContainer} initial="hidden" animate="show">
                  {group.items.map((b, i) => (
                    <BookmarkRow key={b.id} bookmark={b} index={i} />
                  ))}
                </motion.div>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
