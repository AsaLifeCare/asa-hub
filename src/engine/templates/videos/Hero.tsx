import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { Video } from '@/engine/types'
import type { ChannelCfg } from './types'
import { Thumb } from './Thumb'
import { ext, fmt, fmtViews, instructorOf } from './utils'

/* ---------------- featured hero ---------------- */

export function Hero({ video, channel, newestAt, onOpen }: { video: Video; channel?: ChannelCfg; newestAt: string; onOpen: () => void }) {
  const instructor = instructorOf(video)
  // "New": explicit record flag, or within 14 days of the freshest lesson (data-derived, pure)
  const isNew = ext(video).isNew ?? new Date(newestAt).getTime() - new Date(video.publishedAt).getTime() < 14 * 864e5
  const fade = (delay: number) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.24, ease: EASE_OUT_EXPO, delay },
  })
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
      onClick={onOpen}
      className="group relative block w-full overflow-hidden rounded-xl text-left shadow-1"
    >
      <div className="relative aspect-[21/9] min-h-[320px] w-full">
        <Thumb src={video.thumb} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-transparent" />
        <div className="absolute right-4 top-4 flex items-center gap-2">
          {isNew && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-on-primary">New</span>}
          <span className="rounded-[6px] bg-black/50 px-1.5 py-0.5 text-[12px] font-semibold text-white">
            {fmt(video.durationSec)}
          </span>
        </div>
        <div className="absolute bottom-0 left-0 max-w-[640px] p-6">
          <motion.p {...fade(0.1)} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/80">
            Featured{channel ? ` · ${channel.label}` : ''}
          </motion.p>
          <motion.h2 {...fade(0.14)} className="mt-1.5 font-display text-[24px] font-extrabold leading-8 text-white md:text-[28px] md:leading-9">
            {video.title}
          </motion.h2>
          <motion.p {...fade(0.18)} className="clamp-2 mt-1 text-[13px] leading-5 text-white/70">
            {video.description}
          </motion.p>
          <motion.div {...fade(0.22)} className="mt-3 flex items-center gap-3 text-[13px] text-white/80">
            <DragPerson
              name={instructor?.name ?? ''}
              id={instructor?.id}
              avatar={instructor?.avatar}
              subtitle={instructor?.role}
              className="items-center gap-3"
            >
              <Avatar src={instructor?.avatar} name={instructor?.name ?? ''} size="xs" ring className="h-7 w-7" />
              <span className="font-medium text-white">{instructor?.name}</span>
            </DragPerson>
            <span>{fmt(video.durationSec)}</span>
            <span>{fmtViews(video.views)} views</span>
          </motion.div>
        </div>
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22, delay: 0.2 }}
          className="absolute bottom-6 right-6 grid h-16 w-16 place-items-center rounded-full bg-white/15 text-white transition-colors duration-200 group-hover:bg-primary"
        >
          <Play size={24} className="ml-1 transition-transform duration-200 group-hover:scale-110" />
        </motion.span>
      </div>
    </motion.button>
  )
}
