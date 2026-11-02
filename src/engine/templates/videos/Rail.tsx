import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TINT_VAR } from '@/lib/tints'
import type { TintName, Video } from '@/engine/types'
import { VideoCard } from './VideoCard'
import { RAIL_CV_STYLE, ext } from './utils'

/* ---------------- channel rail ---------------- */

export function Rail({
  label,
  tint,
  videos,
  effective,
  newestAt,
  showChannelChip,
  canWatch,
  onOpen,
}: {
  label: string
  tint: TintName
  videos: Video[]
  effective: (v: Video) => number
  newestAt: string
  showChannelChip?: boolean
  canWatch: (v: Video) => boolean
  onOpen: (v: Video) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const by = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 600, behavior: 'smooth' })
  const newest = new Date(newestAt).getTime()
  return (
    <div style={RAIL_CV_STYLE}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TINT_VAR[tint] }} />
        <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">{label}</h2>
        <span className="text-[12px] text-text-3">{videos.length} lessons</span>
        <button
          onClick={() => by(1)}
          className="ml-auto shrink-0 text-[13px] font-medium text-primary transition-colors duration-150 hover:text-primary-hover"
        >
          See all →
        </button>
      </div>
      <div className="group/rail relative">
        <div
          ref={scrollRef}
          className="flex snap-x gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {videos.map((v, i) => (
            <VideoCard
              key={v.id}
              v={v}
              tint={tint}
              channelLabel={showChannelChip ? label : undefined}
              watched={effective(v)}
              index={i}
              isNew={ext(v).isNew ?? newest - new Date(v.publishedAt).getTime() < 14 * 864e5}
              locked={!canWatch(v)}
              onOpen={() => onOpen(v)}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-bg to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg to-transparent" />
        <button
          aria-label={`Scroll ${label} left`}
          onClick={() => by(-1)}
          className="absolute -left-2 top-[32%] z-10 grid h-9 w-9 place-items-center rounded-full bg-surface text-text-2 opacity-0 shadow-2 transition-all duration-150 hover:text-text-1 group-hover/rail:opacity-100"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          aria-label={`Scroll ${label} right`}
          onClick={() => by(1)}
          className="absolute -right-2 top-[32%] z-10 grid h-9 w-9 place-items-center rounded-full bg-surface text-text-2 opacity-0 shadow-2 transition-all duration-150 hover:text-text-1 group-hover/rail:opacity-100"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
