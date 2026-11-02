import { formatDistanceToNow } from 'date-fns'
import { motion } from 'framer-motion'
import { Check, Lock, Play } from 'lucide-react'
import BookmarkButton from '@/components/shared/BookmarkButton'
import DragPerson from '@/components/shared/DragPerson'
import { Badge } from '@/components/shared/Badge'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { TintName, Video } from '@/engine/types'
import { Thumb } from './Thumb'
import { VIS_META, fmt, instructorOf, visOf } from './utils'

/* ---------------- video card ---------------- */

export function VideoCard({
  v,
  tint,
  channelLabel,
  watched,
  index,
  isNew,
  locked,
  onOpen,
}: {
  v: Video
  tint: TintName
  channelLabel?: string
  watched: number
  index: number
  isNew: boolean
  locked: boolean
  onOpen: () => void
}) {
  const instructor = instructorOf(v)
  const done = watched >= 1
  const vis = visOf(v)
  const lockLabel = VIS_META[vis].lock
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT_EXPO, delay: Math.min(index, 8) * 0.03 }}
      whileHover={locked ? undefined : { y: -4 }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={locked ? `${v.title} — ${lockLabel}` : v.title}
      title={locked ? lockLabel : undefined}
      className={cn('group w-[280px] shrink-0 snap-start text-left', locked && 'cursor-not-allowed')}
    >
      <div className="relative overflow-hidden rounded-[16px] shadow-1">
        <Thumb
          src={v.thumb}
          className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {!locked && (
          <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <span className="grid h-10 w-10 scale-75 place-items-center rounded-full bg-black/45 text-white transition-transform duration-150 group-hover:scale-100">
              <Play size={16} className="ml-0.5" />
            </span>
          </div>
        )}
        <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {fmt(v.durationSec)}
        </span>
        {isNew && (
          <span className="absolute bottom-2 left-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-on-primary shadow-1">
            New
          </span>
        )}
        <span className="absolute right-2 top-2 flex items-center gap-1">
          {done && (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-on-primary shadow-1">
              <Check size={13} strokeWidth={3} />
            </span>
          )}
          <BookmarkButton
            size="sm"
            bookmark={{
              type: 'video',
              refId: v.id,
              title: v.title,
              subtitle: channelLabel ? `${channelLabel} · ${fmt(v.durationSec)}` : fmt(v.durationSec),
              avatar: v.thumb,
              tint,
              href: `/app/academy/videos#${v.id}`,
            }}
            className="bg-black/45 text-white hover:bg-black/60 hover:text-white"
          />
        </span>
        {watched > 0 && watched < 1 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/25">
            <div className="h-full bg-primary" style={{ width: `${Math.round(watched * 100)}%` }} />
          </div>
        )}
        {locked && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-surface/60 backdrop-blur-[2px]">
            <span className="flex flex-col items-center gap-1.5 text-text-2">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-surface shadow-1">
                <Lock size={15} />
              </span>
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold shadow-1">{lockLabel}</span>
            </span>
          </div>
        )}
      </div>
      <h3 className="clamp-2 mt-2.5 text-[14px] font-medium leading-5 text-text-1 transition-colors duration-150 group-hover:text-primary">
        {v.title}
      </h3>
      <div className="mt-1 flex items-center gap-2">
        <p className="clamp-1 flex-1 text-[12px] text-text-3">
          <DragPerson
            name={instructor?.name ?? ''}
            id={instructor?.id}
            avatar={instructor?.avatar}
            subtitle={instructor?.role}
          >
            {instructor?.name}
          </DragPerson>{' '}
          · {fmt(v.durationSec)} · {formatDistanceToNow(new Date(v.publishedAt), { addSuffix: true })}
        </p>
        {channelLabel && <Badge label={channelLabel} tint={tint} className="shrink-0 !px-1.5 !text-[10px]" />}
      </div>
    </motion.div>
  )
}
