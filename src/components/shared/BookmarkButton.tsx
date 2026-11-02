// Star toggle for the bookmarks system.
// Drop into detail panels, sheet rows, doc/video cards — anywhere a record can be pinned: <BookmarkButton…
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { bookmarkId, useBookmarksStore, type BookmarkInput } from '@/stores/useBookmarksStore'
import { cn } from '@/lib/utils'
import { useMyAsaOffered } from '@/lib/myAsaOffered'

const SIZES = {
  sm: { box: 'h-7 w-7', icon: 14 },
  md: { box: 'h-8 w-8', icon: 16 },
  lg: { box: 'h-9 w-9', icon: 18 },
} as const

export default function BookmarkButton({
  bookmark,
  size = 'md',
  className,
}: {
  bookmark: BookmarkInput
  size?: keyof typeof SIZES
  className?: string
}) {
  const active = useBookmarksStore((s) => s.bookmarks.some((b) => b.id === bookmarkId(bookmark.type, bookmark.refId)))
  const toggle = useBookmarksStore((s) => s.toggle)
  const offered = useMyAsaOffered()
  const s = SIZES[size]
  if (!offered) return null

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        toggle(bookmark)
      }}
      aria-pressed={active}
      aria-label={active ? `Remove bookmark: ${bookmark.title}` : `Bookmark: ${bookmark.title}`}
      title={active ? 'Remove bookmark' : 'Bookmark'}
      className={cn(
        'grid shrink-0 place-items-center rounded-md transition-colors duration-150',
        active ? 'text-warning hover:bg-tint-amber' : 'text-text-3 hover:bg-surface-2 hover:text-text-2',
        s.box,
        className,
      )}
    >
      <motion.span
        key={String(active)}
        initial={{ scale: active ? 0.4 : 1 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18 }}
        className="grid place-items-center"
      >
        <Star size={s.icon} fill={active ? 'currentColor' : 'none'} strokeWidth={active ? 1.5 : 2} />
      </motion.span>
    </button>
  )
}
