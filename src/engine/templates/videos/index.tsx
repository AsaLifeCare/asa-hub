/**
 * `videos` template (page-types.md §5) — media library.
 * Featured hero, "Your learning" progress strip, continue-watching + channel
 * rails (snap-x, arrows, edge fades), watched-progress cards, and a simulated
 * player modal: one-shot Ken-Burns poster motion, seekable transport, speed/
 * quality popovers, volume, expand, playlist column, up-next overlay.
 *
 * Wave-2 (Academy): perf pass (single blur layer, one-shot 8s KB zoom,
 * lazy/async images, content-visibility rails, background animations paused
 * while a modal is open), a real upload flow with full metadata (description,
 * visibility, instructor, duration, thumbnail, tags, auto posted-by),
 * client-side visibility enforcement (locked cards), and global bookmarks.
 */
import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Upload } from 'lucide-react'
import type { TemplateProps } from '@/engine/PageRenderer'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import { useAuthStore } from '@/auth/useAuthStore'
import { Gate, useCan } from '@/auth/permissions'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { api } from '@/lib/api'
import { toast } from '@/stores/useToastStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { cn } from '@/lib/utils'
import type { TintName, Video } from '@/engine/types'
import type { ChannelCfg, PlayerCfg } from './types'
import { VIS_LEVEL, VIS_META, fmt, visOf } from './utils'
import { MiniRing } from './rings'
import { Hero } from './Hero'
import { Rail } from './Rail'
import { Player } from './Player'
import { UploadModal } from './UploadModal'

/* ---------------- template ---------------- */

export default function VideosTemplate({ config, data, schema }: TemplateProps) {
  const baseVideos = data as Video[]
  const channels = useMemo(() => (config.channels ?? []) as ChannelCfg[], [config.channels])
  const playerCfg = (config.player ?? {}) as PlayerCfg
  const [created, setCreated] = useState<Video[]>([])
  const [activeChannel, setActiveChannel] = useState('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [autoPlay, setAutoPlay] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editing, setEditing] = useState<Video | null>(null)
  const [patched, setPatched] = useState<Record<string, Partial<Video>>>({})
  const [removed, setRemoved] = useState<string[]>([])
  const progressRef = useRef<{ id: string; sec: number } | null>(null)
  const pushNotification = useNotificationStore((s) => s.push)
  const user = useAuthStore((s) => s.user)
  const canEdit = useCan('academy.edit')

  // Local edits/removals ride over the fetched rows so the library reacts immediately; the sheet is the source of…
  const videos = useMemo(
    () =>
      [...created, ...baseVideos]
        .filter((v) => !removed.includes(v.id))
        .map((v) => (patched[v.id] ? ({ ...v, ...patched[v.id] } as Video) : v)),
    [created, baseVideos, patched, removed],
  )
  const featured = videos.find((v) => v.id === config.featuredId) ?? videos[0]

  // client-side visibility: academy.edit (or admin) sees everything, managers see ≤ managers, staff sees 'all'
  const userLevel = canEdit || user?.role === 'admin' ? 2 : user?.role === 'manager' ? 1 : 0
  const canWatch = (v: Video) => userLevel >= VIS_LEVEL[visOf(v)]

  const effective = (v: Video) => overrides[v.id] ?? v.watched
  const openVideo = videos.find((v) => v.id === openId)

  const open = (v: Video, play: boolean) => {
    if (!canWatch(v)) {
      toast({ type: 'info', title: VIS_META[visOf(v)].lock, body: v.title })
      return
    }
    progressRef.current = null
    setAutoPlay(play)
    setOpenId(v.id)
  }
  const close = () => {
    const p = progressRef.current
    if (p) {
      const vid = videos.find((v) => v.id === p.id)
      if (vid)
        setOverrides((o) => {
          const next = Math.min(1, p.sec / vid.durationSec)
          // never downgrade (e.g. after "Mark as complete")
          return next > (o[p.id] ?? vid.watched) ? { ...o, [p.id]: next } : o
        })
    }
    progressRef.current = null
    setOpenId(null)
  }
  const complete = (v: Video) => {
    setOverrides((o) => ({ ...o, [v.id]: 1 }))
    toast({ type: 'success', title: 'Marked as complete', body: v.title })
    pushNotification({
      type: 'app',
      title: `You finished “${v.title}”`,
      body: 'Nice work — keep the streak going in Academy.',
      priority: 'normal',
    })
  }
  const onUploaded = (v: Video) => {
    setCreated((prev) => [v, ...prev])
    setUploadOpen(false)
    setActiveChannel('all')
    toast({ type: 'success', title: 'Video published', body: v.title })
    pushNotification({
      type: 'app',
      title: `New lesson: “${v.title}”`,
      body: `Published to ${channels.find((c) => c.id === v.channel)?.label ?? 'Academy'}.`,
      priority: 'normal',
    })
  }

  const rails = useMemo(
    () => channels.map((c) => ({ ...c, videos: videos.filter((v) => v.channel === c.id) })).filter((r) => r.videos.length > 0),
    [channels, videos],
  )
  const continueWatching = videos.filter((v) => canWatch(v) && effective(v) > 0 && effective(v) < 1)
  const newestAt = useMemo(
    () => videos.reduce((max, v) => (new Date(v.publishedAt).getTime() > new Date(max).getTime() ? v.publishedAt : max), videos[0]?.publishedAt ?? ''),
    [videos],
  )
  const completedCount = videos.filter((v) => effective(v) >= 1).length
  const pct = videos.length ? Math.round((completedCount / videos.length) * 100) : 0
  const continueVid =
    videos.find((v) => canWatch(v) && effective(v) > 0 && effective(v) < 1) ??
    videos.find((v) => canWatch(v) && effective(v) === 0 && v.id !== featured?.id) ??
    videos[0]
  const totalSec = videos.reduce((a, v) => a + v.durationSec, 0)
  const totalLabel = `${Math.floor(totalSec / 3600)}h ${Math.round((totalSec % 3600) / 60)}m`
  const modalOpen = Boolean(openVideo) || uploadOpen

  return (
    <div className="w-full">
      {/* background content: animations paused + inert while a modal is open (perf) */}
      <div className={cn(modalOpen && 'pointer-events-none [&_*]:[animation-play-state:paused]')}>
        <PageHeader
          title={schema.title}
          subtitle={`${videos.length} lessons · ${channels.length} channels · ${totalLabel} total`}
          actions={
            <>
              <div className="flex items-center gap-1.5">
                {[{ id: 'all', label: 'All', tint: 'green' as TintName }, ...channels].map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveChannel(c.id)}
                    className={cn(
                      'h-8 rounded-full border px-3 text-[12px] font-medium transition-colors duration-150',
                      activeChannel === c.id
                        ? 'border-transparent bg-primary-soft text-primary-strong'
                        : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <Gate perm="academy.edit">
                <button
                  onClick={() => setUploadOpen(true)}
                  className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
                >
                  <Upload size={14} /> Upload video
                </button>
              </Gate>
            </>
          }
        />

        {/* featured hero */}
        {featured && (
          <Hero video={featured} channel={channels.find((c) => c.id === featured.channel)} newestAt={newestAt} onOpen={() => open(featured, false)} />
        )}

        {/* your learning progress strip */}
        {playerCfg.showProgress !== false && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE_OUT_EXPO, delay: 0.1 }}
          >
            <Card className="mt-5 flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-3">
                <MiniRing percent={pct} />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Your learning</p>
                  <p className="mt-0.5 text-[14px] font-semibold text-text-1">
                    {completedCount} of {videos.length} lessons completed
                  </p>
                </div>
              </div>
              <div className="flex min-w-[180px] flex-1 gap-1">
                {videos.map((v, i) => {
                  const w = effective(v)
                  const state = w >= 1 ? 'done' : w > 0 ? 'current' : 'todo'
                  return (
                    <motion.span
                      key={v.id}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.3, ease: EASE_OUT_EXPO, delay: Math.min(i, 8) * 0.03 }}
                      title={v.title}
                      className={cn(
                        'h-1.5 flex-1 origin-left rounded-full',
                        state === 'done' ? 'bg-primary' : state === 'current' ? 'animate-pulse bg-primary/50' : 'bg-surface-3',
                      )}
                    />
                  )
                })}
              </div>
              {continueVid && (
                <button
                  onClick={() => open(continueVid, true)}
                  className="flex h-9 max-w-[320px] items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2"
                >
                  <span className="clamp-1">
                    Continue: {continueVid.title} {fmt(effective(continueVid) * continueVid.durationSec)} →
                  </span>
                </button>
              )}
            </Card>
          </motion.div>
        )}

        {/* continue watching + channel rails */}
        <div className="mt-8 space-y-8 pb-8">
          <AnimatePresence initial={false}>
            {activeChannel === 'all' && continueWatching.length > 0 && (
              <motion.section
                key="continue"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                className="overflow-hidden"
              >
                <Rail label="Continue watching" tint="green" videos={continueWatching} effective={effective} newestAt={newestAt} canWatch={canWatch} onOpen={(v) => open(v, true)} />
              </motion.section>
            )}
            {rails
              .filter((r) => activeChannel === 'all' || r.id === activeChannel)
              .map((rail, ri) => (
                <motion.section
                  key={rail.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: EASE_OUT_EXPO, delay: activeChannel === 'all' ? Math.min(ri, 4) * 0.1 : 0 }}
                  className="overflow-hidden"
                >
                  <Rail label={rail.label} tint={rail.tint} videos={rail.videos} effective={effective} newestAt={newestAt} canWatch={canWatch} showChannelChip onOpen={(v) => open(v, false)} />
                </motion.section>
              ))}
          </AnimatePresence>
        </div>
      </div>

      {/* player modal */}
      <AnimatePresence>
        {openVideo && (
          <Player
            key={openVideo.id}
            video={openVideo}
            videos={videos}
            channels={channels}
            playerCfg={playerCfg}
            initialSec={effective(openVideo) >= 1 ? 0 : Math.round(effective(openVideo) * openVideo.durationSec)}
            autoPlay={autoPlay}
            watchedOf={effective}
            canWatch={canWatch}
            onProgress={(id, sec) => {
              progressRef.current = { id, sec }
            }}
            onComplete={complete}
            onSelect={(v, play) => open(v, play)}
            onClose={close}
            onEdit={canEdit ? (v) => { close(); setEditing(v) } : undefined}
            onDelete={
              canEdit
                ? (v) => {
                    close()
                    setRemoved((prev) => [...prev, v.id])
                    api.remove('videos', v.id).catch(() => {})
                    toast({ type: 'info', title: 'Video removed', body: v.title })
                  }
                : undefined
            }
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {uploadOpen && <UploadModal channels={channels} canEdit={canEdit} onClose={() => setUploadOpen(false)} onCreate={onUploaded} />}
        {editing && (
          <UploadModal
            video={editing}
            channels={channels}
            canEdit={canEdit}
            onClose={() => setEditing(null)}
            onCreate={(v) => {
              setPatched((prev) => ({ ...prev, [v.id]: v }))
              setEditing(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
