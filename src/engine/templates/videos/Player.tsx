import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Lock, Maximize, Minimize, Pause, Pencil, Play, Share2, ThumbsDown, ThumbsUp, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import Avatar from '@/components/shared/Avatar'
import BookmarkButton from '@/components/shared/BookmarkButton'
import DragPerson from '@/components/shared/DragPerson'
import { Badge } from '@/components/shared/Badge'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { Video } from '@/engine/types'
import { asList } from '@/lib/asList'
import type { ChannelCfg, PlayerCfg } from './types'
import { Thumb } from './Thumb'
import { CountdownRing } from './rings'
import { VIS_META, ext, fmt, fmtViews, instructorOf, postedByOf, visOf } from './utils'

/* ---------------- simulated player ---------------- */

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const QUALITIES = ['Auto 1080p', '1080p', '720p', '480p']

export function Player({
  video,
  videos,
  channels,
  playerCfg,
  initialSec,
  autoPlay,
  watchedOf,
  canWatch,
  onProgress,
  onComplete,
  onSelect,
  onClose,
  onEdit,
  onDelete,
}: {
  video: Video
  videos: Video[]
  channels: ChannelCfg[]
  playerCfg: PlayerCfg
  initialSec: number
  autoPlay: boolean
  watchedOf: (v: Video) => number
  canWatch: (v: Video) => boolean
  onProgress: (id: string, sec: number) => void
  onComplete: (v: Video) => void
  onSelect: (v: Video, autoPlay: boolean) => void
  onClose: () => void
  /** Present for academy.edit only. */
  onEdit?: (v: Video) => void
  onDelete?: (v: Video) => void
}) {
  // a lesson the server keeps plays from its own copy; anything else from Drive's preview frame
  const [kept, setKept] = useState<{ id: string; url: string | null; why: string }>({ id: '', url: null, why: '' })
  useEffect(() => {
    if (!video.kept || !video.id) return
    let alive = true
    let made: string | null = null
    setKept({ id: video.id, url: null, why: '' })
    gasAction<{ b64?: string; mime?: string }>('academyVideoFile', { id: video.id }, { timeoutMs: 120000 })
      .then((got) => {
        const raw = atob(got?.b64 || '')
        const bytes = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
        made = URL.createObjectURL(new Blob([bytes], { type: got?.mime || video.keptMime || 'video/mp4' }))
        if (alive) setKept({ id: video.id, url: made, why: '' })
        else URL.revokeObjectURL(made)
      })
      .catch((e) => { if (alive) setKept({ id: video.id, url: null, why: e instanceof Error ? e.message : String(e) }) })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [video.id, video.kept, video.keptMime])
  const [rated, setRated] = useState<'up' | 'down' | null>(null)
  const rate = (value: 'up' | 'down') => {
    setRated(value)
    if (useApiConfigStore.getState().driver !== 'apps-script') return
    void gasAction('docFeedback', {
      kind: 'video',
      doc_id: video.id,
      doc_title: video.title,
      collection: video.channel,
      vote: value,
    }).catch(() => {})
  }

  const duration = video.durationSec
  const channel = channels.find((c) => c.id === video.channel)
  const instructor = instructorOf(video)
  const postedBy = postedByOf(video)
  // the byline person, and the id behind them — postedByOf answers with a name and a face only, so the id comes…
  const byline = postedBy ?? instructor
  const bylineId = postedBy ? ext(video).postedById : instructor?.id
  const vis = visOf(video)
  const playlist = useMemo(() => {
    const same = videos.filter((v) => v.channel === video.channel)
    return same.length > 1 ? same : videos
  }, [videos, video.channel])
  const idx = playlist.findIndex((v) => v.id === video.id)
  const nextVideo = playlist.length > 1 ? playlist[(idx + 1) % playlist.length] : undefined

  const [playing, setPlaying] = useState(autoPlay && initialSec < duration)
  const [t, setT] = useState(initialSec)
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [quality, setQuality] = useState(QUALITIES[0])
  const [expanded, setExpanded] = useState(false)
  const [ended, setEnded] = useState(initialSec >= duration)
  const [showMore, setShowMore] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const completed = watchedOf(video) >= 1
  const buffered = Math.min(duration, t + duration * 0.18)

  // simulated transport
  useEffect(() => {
    if (!playing || ended) return
    const id = setInterval(() => {
      setT((s) => {
        const n = s + 0.25 * speed
        if (n >= duration) {
          setPlaying(false)
          setEnded(true)
          return duration
        }
        return n
      })
    }, 250)
    return () => clearInterval(id)
  }, [playing, ended, speed, duration])

  // report progress (parent stashes it in a ref — no re-render)
  useEffect(() => {
    onProgress(video.id, t)
  }, [t, video.id, onProgress])

  // esc + lock the main scroll region while open
  useEffect(() => {
    const scroller = document.getElementById('main-scroll')
    const prevOverflow = scroller?.style.overflow ?? ''
    if (scroller) scroller.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      if (scroller) scroller.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // autoplay-next countdown (only when enabled in config)
  useEffect(() => {
    if (!ended || !playerCfg.autoplayNext || !nextVideo || !canWatch(nextVideo)) return
    const id = setTimeout(() => onSelect(nextVideo, true), 5000)
    return () => clearTimeout(id)
  }, [ended, playerCfg.autoplayNext, nextVideo, canWatch, onSelect])

  const seekTo = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    setT(ratio * duration)
    if (ended && ratio < 0.999) setEnded(false)
  }
  const togglePlay = () => {
    if (ended) {
      setT(0)
      setEnded(false)
      setPlaying(true)
      return
    }
    setPlaying((p) => !p)
  }
  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/app/academy/videos#${video.id}`)
    } catch {
      /* demo */
    }
    toast({ type: 'success', title: 'Link copied', body: video.title })
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      {/* one-shot Ken-Burns: 8s ease-out, subtle 6% zoom — runs once, never loops */}
      <style>{'@keyframes asa-kb { from { transform: scale(1); } to { transform: scale(1.06); } }'}</style>
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Player: ${video.title}`}
        className={cn(
          'flex max-h-[90vh] w-full overflow-hidden rounded-xl bg-surface shadow-3 transition-[max-width] duration-200',
          expanded ? 'max-w-[96vw]' : 'max-w-[1080px]',
        )}
      >
        {/* stage + details */}
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          {/* A real file (driveId) plays in Drive's own preview frame; the
              simulated stage below is for seed rows that have no source.
              Portrait footage gets a portrait box — phone video letterboxes
              into a stamp inside 16:9. */}
          <div
            className={cn('group/stage relative bg-black', !video.driveId && 'aspect-video')}
            style={video.driveId ? { aspectRatio: String(video.aspect || 16 / 9) } : undefined}
          >
            {video.driveId ? (
              <>
                {video.kept ? (
                  kept.id === video.id && kept.url ? (
                    <video src={kept.url} title={video.title} controls autoPlay={autoPlay} playsInline
                      className="h-full w-full bg-black object-contain" />
                  ) : (
                    <div className="grid h-full w-full place-items-center px-6 text-center text-[12px] text-white/70">
                      {kept.id === video.id && kept.why ? `The video could not be read: ${kept.why}` : 'Loading the video…'}
                    </div>
                  )
                ) : (
                  <iframe
                    src={`https://drive.google.com/file/d/${video.driveId}/preview`}
                    title={video.title}
                    allow="autoplay; fullscreen"
                    allowFullScreen
                    className="h-full w-full border-0"
                  />
                )}
                <button
                  onClick={onClose}
                  aria-label="Close player"
                  className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white/90 transition-colors duration-150 hover:bg-black/60"
                >
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
            <Thumb
              src={video.thumb}
              className="h-full w-full object-cover"
              style={{ animation: 'asa-kb 8s ease-out forwards', animationPlayState: playing && !ended ? 'running' : 'paused' }}
            />
            {/* center play/pause */}
            <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="absolute inset-0 grid place-items-center">
              <span
                className={cn(
                  'grid h-16 w-16 place-items-center rounded-full bg-black/45 text-white transition-all duration-200 hover:bg-primary',
                  playing && !ended ? 'opacity-0 hover:opacity-100' : 'opacity-100',
                )}
              >
                {playing && !ended ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
              </span>
            </button>
            <button
              onClick={onClose}
              aria-label="Close player"
              className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white/90 transition-colors duration-150 hover:bg-black/60"
            >
              <X size={15} />
            </button>

            {/* up-next overlay */}
            <AnimatePresence>
              {ended && nextVideo && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 grid place-items-center bg-black/50"
                >
                  <div className="w-[300px] rounded-lg bg-surface p-5 text-center shadow-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Up next</p>
                    <Thumb src={nextVideo.thumb} className="mt-3 aspect-video w-full rounded-md object-cover" />
                    <p className="clamp-2 mt-2 text-[13px] font-semibold leading-4 text-text-1">{nextVideo.title}</p>
                    <p className="mt-0.5 text-[12px] text-text-3">{fmt(nextVideo.durationSec)}</p>
                    <div className="mt-4 flex items-center justify-center gap-3">
                      {playerCfg.autoplayNext && canWatch(nextVideo) ? <CountdownRing seconds={5} /> : null}
                      {canWatch(nextVideo) ? (
                        <button
                          onClick={() => onSelect(nextVideo, true)}
                          className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
                        >
                          Play now
                        </button>
                      ) : (
                        <span className="flex h-9 items-center gap-1.5 rounded-md bg-surface-2 px-3 text-[12px] font-medium text-text-3">
                          <Lock size={13} /> {VIS_META[visOf(nextVideo)].lock}
                        </span>
                      )}
                      <button
                        onClick={() => setEnded(false)}
                        className="h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors duration-150 hover:bg-surface-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* popover dismiss layer */}
            {(speedOpen || qualityOpen) && (
              <div
                className="absolute inset-0 z-[15]"
                onClick={() => {
                  setSpeedOpen(false)
                  setQualityOpen(false)
                }}
              />
            )}

            {/* transport */}
            <div
              className={cn(
                'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-3 pt-10',
                speedOpen || qualityOpen ? 'z-[16]' : 'z-10',
              )}
            >
              <div
                ref={trackRef}
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={Math.floor(t)}
                tabIndex={0}
                onPointerDown={(e) => {
                  dragging.current = true
                  e.currentTarget.setPointerCapture(e.pointerId)
                  seekTo(e.clientX)
                }}
                onPointerMove={(e) => dragging.current && seekTo(e.clientX)}
                onPointerUp={() => (dragging.current = false)}
                onPointerCancel={() => (dragging.current = false)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') setT((s) => Math.min(duration, s + 5))
                  if (e.key === 'ArrowLeft') setT((s) => Math.max(0, s - 5))
                }}
                className="group/seek relative h-4 cursor-pointer"
              >
                <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-white/25" />
                <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/40" style={{ width: `${(buffered / duration) * 100}%` }} />
                <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary" style={{ width: `${(t / duration) * 100}%` }} />
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity duration-150 group-hover/seek:opacity-100"
                  style={{ left: `${(t / duration) * 100}%` }}
                />
              </div>
              <div className="mt-1 flex items-center gap-2">
                <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="grid h-8 w-8 place-items-center rounded-full text-white transition-colors duration-150 hover:bg-white/10">
                  {playing && !ended ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                </button>
                <span className="text-[12px] tabular-nums text-white/90">
                  {fmt(t)} / {fmt(duration)}
                </span>
                <span className="flex-1" />
                <button
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  className="grid h-8 w-8 place-items-center rounded-full text-white/90 transition-colors duration-150 hover:bg-white/10"
                >
                  {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    setVolume(Number(e.target.value))
                    setMuted(false)
                  }}
                  aria-label="Volume"
                  className="hidden h-1 w-16 accent-primary sm:block"
                />
                {/* speed */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setSpeedOpen((o) => !o)
                      setQualityOpen(false)
                    }}
                    className="rounded-[6px] px-1.5 py-1 text-[12px] font-semibold text-white/90 transition-colors duration-150 hover:bg-white/10"
                  >
                    {speed}×
                  </button>
                  {speedOpen && (
                    <div className="absolute bottom-9 right-0 z-20 w-[110px] rounded-md border border-border bg-surface p-1 shadow-2">
                      {SPEEDS.map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            setSpeed(s)
                            setSpeedOpen(false)
                          }}
                          className={cn(
                            'flex w-full items-center rounded-sm px-2 py-1.5 text-[12px] transition-colors duration-150',
                            speed === s ? 'font-semibold text-text-1' : 'text-text-2 hover:bg-surface-2',
                          )}
                        >
                          <span className="flex-1 text-left">{s}×</span>
                          {speed === s && <Check size={13} className="text-primary" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* quality */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setQualityOpen((o) => !o)
                      setSpeedOpen(false)
                    }}
                    className="rounded-[6px] px-1.5 py-1 text-[12px] font-semibold text-white/90 transition-colors duration-150 hover:bg-white/10"
                  >
                    {quality}
                  </button>
                  {qualityOpen && (
                    <div className="absolute bottom-9 right-0 z-20 w-[130px] rounded-md border border-border bg-surface p-1 shadow-2">
                      {QUALITIES.map((q) => (
                        <button
                          key={q}
                          onClick={() => {
                            setQuality(q)
                            setQualityOpen(false)
                          }}
                          className={cn(
                            'flex w-full items-center rounded-sm px-2 py-1.5 text-[12px] transition-colors duration-150',
                            quality === q ? 'font-semibold text-text-1' : 'text-text-2 hover:bg-surface-2',
                          )}
                        >
                          <span className="flex-1 text-left">{q}</span>
                          {quality === q && <Check size={13} className="text-primary" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setExpanded((e) => !e)}
                  aria-label={expanded ? 'Exit expanded view' : 'Expand'}
                  className="grid h-8 w-8 place-items-center rounded-full text-white/90 transition-colors duration-150 hover:bg-white/10"
                >
                  {expanded ? <Minimize size={15} /> : <Maximize size={15} />}
                </button>
              </div>
            </div>
              </>
            )}
          </div>

          {/* below-stage details */}
          <div className="p-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">{video.title}</h2>
              {channel && <Badge label={channel.label} tint={channel.tint} />}
              {vis !== 'all' && (
                <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-2">
                  <Lock size={11} /> {VIS_META[vis].label}
                </span>
              )}
              {/* the sheet hands tags over as one cell, "a,b,c" — never an array */}
              {asList(ext(video).tags).slice(0, 3).map((tag) => (
                <span key={tag} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-3">
                  #{tag}
                </span>
              ))}
            </div>
            <p className={cn('mt-1.5 text-[13px] leading-5 text-text-2', !showMore && 'clamp-2')}>{video.description}</p>
            <button
              onClick={() => setShowMore((s) => !s)}
              className="mt-0.5 text-[12px] font-medium text-primary transition-colors duration-150 hover:text-primary-hover"
            >
              {showMore ? 'Show less' : 'Show more'}
            </button>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <DragPerson
                name={byline?.name ?? ''}
                id={bylineId}
                avatar={byline?.avatar}
                subtitle={byline?.role}
                className="items-center gap-2"
              >
                <Avatar src={byline?.avatar} name={byline?.name ?? ''} size="xs" />
                <span className="text-[13px] font-medium text-text-1">{byline?.name}</span>
                {byline?.role && <span className="text-[12px] text-text-3">{byline.role}</span>}
              </DragPerson>
              <span className="text-[12px] text-text-3">
                {fmtViews(video.views)} views · Posted {formatDistanceToNow(new Date(ext(video).postedAt ?? video.publishedAt), { addSuffix: true })}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {/* Same thumbs as a document, same table: every piece of
                    content people are told to consume can be rated, and the
                    vote carries who/when/role so a bad video is traceable to
                    the audience that flagged it. */}
                <button
                  aria-label="Helpful"
                  title="Helpful"
                  onClick={() => rate('up')}
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-md border transition-all duration-150',
                    rated === 'up'
                      ? 'border-transparent bg-primary-soft text-primary-strong'
                      : 'border-border text-text-3 hover:bg-surface-2 hover:text-text-1',
                    rated === 'down' && 'opacity-40',
                  )}
                >
                  <ThumbsUp size={14} />
                </button>
                <button
                  aria-label="Not helpful"
                  title="Not helpful"
                  onClick={() => rate('down')}
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-md border transition-all duration-150',
                    rated === 'down'
                      ? 'border-transparent bg-primary-soft text-primary-strong'
                      : 'border-border text-text-3 hover:bg-surface-2 hover:text-text-1',
                    rated === 'up' && 'opacity-40',
                  )}
                >
                  <ThumbsDown size={14} />
                </button>
                {/* Library management lives where the video is: whoever can
                    watch it and spot the typo is one click from fixing it. */}
                {onEdit && (
                  <button
                    onClick={() => onEdit(video)} aria-label="Edit" title="Edit"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => onDelete(video)}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-danger transition-colors hover:bg-surface-2"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                )}
                <BookmarkButton
                  bookmark={{
                    type: 'video',
                    refId: video.id,
                    title: video.title,
                    subtitle: channel ? `${channel.label} · ${fmt(video.durationSec)}` : fmt(video.durationSec),
                    avatar: video.thumb,
                    tint: channel?.tint ?? 'pink',
                    href: `/app/academy/videos#${video.id}`,
                  }}
                />
                {completed ? (
                  <span className="flex h-9 items-center gap-1.5 rounded-md bg-primary-soft px-3 text-[13px] font-semibold text-primary-strong">
                    <Check size={14} /> Completed
                  </span>
                ) : (
                  <button
                    onClick={() => onComplete(video)}
                    className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2"
                  >
                    Mark as complete
                  </button>
                )}
                <button
                  onClick={share}
                  className="flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors duration-150 hover:bg-surface-2"
                >
                  <Share2 size={14} /> Share
                </button>
              </span>
            </div>
          </div>
        </div>

        {/* playlist column */}
        {playerCfg.showPlaylist !== false && (
          <div className="scroll-thin hidden w-[300px] shrink-0 overflow-y-auto border-l border-border p-3 lg:block">
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
              Up next{channel ? ` · ${channel.label}` : ''}
            </p>
            {playlist.map((v, i) => {
              const w = watchedOf(v)
              const active = v.id === video.id
              const lockedItem = !canWatch(v)
              return (
                <motion.button
                  key={v.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT_EXPO, delay: Math.min(i, 8) * 0.025 }}
                  onClick={() => onSelect(v, false)}
                  title={lockedItem ? VIS_META[visOf(v)].lock : undefined}
                  className={cn(
                    'mb-1 flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors duration-150',
                    active ? 'bg-primary-soft' : 'hover:bg-surface-2',
                    lockedItem && 'opacity-60',
                  )}
                >
                  <span className="relative shrink-0">
                    <Thumb src={v.thumb} className="aspect-video w-24 rounded-[10px] object-cover" />
                    {lockedItem && (
                      <span className="absolute inset-0 grid place-items-center rounded-[10px] bg-surface/60">
                        <Lock size={13} className="text-text-2" />
                      </span>
                    )}
                    {w >= 1 && !lockedItem && (
                      <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-on-primary">
                        <Check size={10} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="clamp-2 block text-[12px] font-medium leading-4 text-text-1">{v.title}</span>
                    {active ? (
                      <span className="text-[11px] font-medium text-primary-strong">Now playing</span>
                    ) : (
                      <span className="text-[11px] text-text-3">{fmt(v.durationSec)}</span>
                    )}
                  </span>
                </motion.button>
              )
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
