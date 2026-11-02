import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ChevronDown, Lock, Upload, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { useAuthStore } from '@/auth/useAuthStore'
import { api } from '@/lib/api'
import { people } from '@/lib/seed'
import { TINT_VAR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { Person, Video } from '@/engine/types'
import type { ChannelCfg, Visibility } from './types'
import { Thumb } from './Thumb'
import { THUMBS, VIS_META, fmt } from './utils'

/* ---------------- upload modal (full metadata) ---------------- */

// Accepts anything that can be copied out of Drive: the /file/d/<id>/view share link, an ?id= URL, or the bare id…
export function driveIdOf(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const byPath = raw.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/)
  if (byPath) return byPath[1]
  const byQuery = raw.match(/[?&]id=([A-Za-z0-9_-]{20,})/)
  if (byQuery) return byQuery[1]
  return /^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : ''
}

export function UploadModal({
  video,
  channels,
  canEdit,
  onClose,
  onCreate,
}: {
  channels: ChannelCfg[]
  canEdit: boolean
  onClose: () => void
  onCreate: (v: Video) => void
  /** Present = editing that video instead of adding a new one. */
  video?: Video | null
}) {
  const user = useAuthStore((s) => s.user)
  const [title, setTitle] = useState(video?.title ?? '')
  const [channel, setChannel] = useState(video?.channel ?? channels[0]?.id ?? '')
  const [description, setDescription] = useState(video?.description ?? '')
  const [visibility, setVisibility] = useState<Visibility>('all')
  const [instructorId, setInstructorId] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [minutes, setMinutes] = useState(video ? String(Math.floor(video.durationSec / 60)) : '10')
  const [seconds, setSeconds] = useState(video ? String(video.durationSec % 60).padStart(2, '0') : '00')
  const [thumb, setThumb] = useState(THUMBS[0])
  const [tags, setTags] = useState('')
  // A Drive link is what makes the entry a real video instead of a card: everything ASA films lives in the Training…
  const [driveLink, setDriveLink] = useState(video?.driveId ?? '')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const [roster, setRoster] = useState<Person[]>(people)

  // person picker options come from the API layer (seed fallback)
  useEffect(() => {
    let live = true
    api
      .list('people')
      .then((rows) => {
        if (live && Array.isArray(rows) && rows.length > 0) setRoster(rows as Person[])
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const instructor = roster.find((p) => p.id === instructorId)
  const pickerList = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    return roster
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
      .slice(0, 8)
  }, [roster, pickerQuery])

  const valid = title.trim().length > 0 && channel.length > 0
  const inputCls =
    'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'

  const submit = async () => {
    setTried(true)
    if (!canEdit) {
      toast({ type: 'warning', title: 'Requires academy.edit — ask an admin' })
      return
    }
    if (!valid || busy) return
    setBusy(true)
    const durationSec = Math.max(1, (parseInt(minutes, 10) || 0) * 60 + (parseInt(seconds, 10) || 0))
    const payload = {
      title: title.trim(),
      channel,
      thumb,
      durationSec,
      views: 0,
      watched: 0,
      publishedAt: new Date().toISOString(),
      description: description.trim() || 'No description provided yet.',
      visibility,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      isNew: true,
      ...(driveIdOf(driveLink) ? { driveId: driveIdOf(driveLink) } : {}),
      ...(instructorId ? { instructorId } : {}),
      ...(user ? { postedById: user.id } : {}),
    }
    let id = video?.id ?? `v-local-${Date.now().toString(36)}`
    try {
      if (video) {
        // Editing keeps the row's identity, its view count and its watch progress — only the fields on this form…
        await api.update('videos', video.id, { ...payload, views: video.views, watched: video.watched })
      } else {
        const row = (await api.create('videos', payload)) as { id?: string }
        if (row?.id) id = row.id
      }
    } catch {
      /* mock driver is reliable; keep local id on failure */
    }
    onCreate({ id, ...payload } as unknown as Video)
    setBusy(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Upload video"
        className="scroll-thin max-h-[86vh] w-full max-w-[560px] overflow-y-auto rounded-xl bg-surface p-6 shadow-3"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-[17px] font-bold text-text-1">{video ? 'Edit video' : 'Upload video'}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
            <X size={16} />
          </button>
        </div>

        {/* title + channel */}
        <label className="mb-1 block text-[12px] font-medium text-text-2">
          Title <span className="text-danger">*</span>
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Safe Patient Transfers: Hands-On Demo"
          autoFocus
          className={cn(inputCls, 'mb-1', tried && !title.trim() && 'border-danger')}
        />
        {tried && !title.trim() && <p className="mb-3 text-[11px] text-danger">A title is required.</p>}
        {! (tried && !title.trim()) && <div className="mb-3" />}

        <label className="mb-1 block text-[12px] font-medium text-text-2">Google Drive link</label>
        <input
          value={driveLink}
          onChange={(e) => setDriveLink(e.target.value)}
          placeholder="https://drive.google.com/file/d/…/view — paste the share link"
          className={cn(inputCls, 'mb-1')}
        />
        <p className="mb-3 text-[11px] leading-4 text-text-3">
          {driveIdOf(driveLink)
            ? `Plays inline · file ${driveIdOf(driveLink)}`
            : 'Optional. With a link the video plays inside the app; without one the entry is just a card.'}
        </p>

        <label className="mb-1 block text-[12px] font-medium text-text-2">
          Channel <span className="text-danger">*</span>
        </label>
        <div className="mb-4 flex flex-wrap gap-2">
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => setChannel(c.id)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors duration-150',
                channel === c.id
                  ? 'border-transparent bg-primary-soft text-primary-strong'
                  : 'border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: TINT_VAR[c.tint] }} />
              {c.label}
            </button>
          ))}
        </div>

        {/* description */}
        <label className="mb-1 block text-[12px] font-medium text-text-2">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What will viewers learn? Shown under the player with a Show more toggle."
          className="scroll-thin mb-4 w-full resize-y rounded-sm border border-border bg-surface p-3 text-[13px] leading-5 text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
        />

        {/* visibility */}
        <label className="mb-1 block text-[12px] font-medium text-text-2">Who can watch</label>
        <div className="mb-1 flex rounded-md border border-border bg-surface-2 p-0.5">
          {(['all', 'managers', 'admins'] as Visibility[]).map((v) => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              aria-pressed={visibility === v}
              className={cn(
                'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-medium transition-all duration-150',
                visibility === v ? 'bg-surface text-text-1 shadow-1' : 'text-text-3 hover:text-text-2',
              )}
            >
              {v !== 'all' && <Lock size={11} />}
              {VIS_META[v].label}
            </button>
          ))}
        </div>
        <p className="mb-4 text-[11px] text-text-3">
          {visibility === 'all'
            ? 'Every teammate can watch this lesson.'
            : `Staff see a locked card — ${VIS_META[visibility].lock.toLowerCase()} can play it.`}
        </p>

        {/* instructor picker */}
        <label className="mb-1 block text-[12px] font-medium text-text-2">Instructor</label>
        <div className="relative mb-4">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex h-10 w-full items-center gap-2.5 rounded-sm border border-border bg-surface px-3 text-left transition-colors duration-150 hover:bg-surface-2"
          >
            {instructor ? (
              <>
                <Avatar src={instructor.avatar} name={instructor.name} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="clamp-1 block text-[13px] font-medium text-text-1">{instructor.name}</span>
                  <span className="clamp-1 block text-[11px] text-text-3">{instructor.role}</span>
                </span>
              </>
            ) : (
              <span className="flex-1 text-[13px] text-text-3">Choose an instructor…</span>
            )}
            <ChevronDown size={14} className="shrink-0 text-text-3" />
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
              <div className="absolute inset-x-0 top-11 z-20 rounded-md border border-border bg-surface p-1.5 shadow-2">
                <input
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search people…"
                  autoFocus
                  className="mb-1 h-8 w-full rounded-sm bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none placeholder:text-text-3"
                />
                <div className="scroll-thin max-h-[210px] overflow-y-auto">
                  {pickerList.length === 0 && <p className="px-2 py-3 text-[12px] text-text-3">No matches.</p>}
                  {pickerList.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setInstructorId(p.id)
                        setPickerOpen(false)
                        setPickerQuery('')
                      }}
                      className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-2"
                    >
                      <Avatar src={p.avatar} name={p.name} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="clamp-1 block text-[13px] font-medium text-text-1">{p.name}</span>
                        <span className="clamp-1 block text-[11px] text-text-3">{p.role}</span>
                      </span>
                      {instructorId === p.id && <Check size={14} className="shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* duration */}
        <label className="mb-1 block text-[12px] font-medium text-text-2">Duration</label>
        <div className="mb-4 flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label="Minutes"
            className={cn(inputCls, 'w-20')}
          />
          <span className="text-[12px] text-text-3">min</span>
          <input
            type="number"
            min={0}
            max={59}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            aria-label="Seconds"
            className={cn(inputCls, 'w-20')}
          />
          <span className="text-[12px] text-text-3">sec</span>
          <span className="ml-auto text-[12px] tabular-nums text-text-3">
            {fmt(Math.max(0, (parseInt(minutes, 10) || 0) * 60 + (parseInt(seconds, 10) || 0)))}
          </span>
        </div>

        {/* thumbnail picker with preview */}
        <label className="mb-1 block text-[12px] font-medium text-text-2">Thumbnail</label>
        <div className="relative mb-2 overflow-hidden rounded-lg">
          <Thumb src={thumb} alt="Selected thumbnail preview" className="aspect-video w-full object-cover" />
          <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {fmt(Math.max(1, (parseInt(minutes, 10) || 0) * 60 + (parseInt(seconds, 10) || 0)))}
          </span>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {THUMBS.map((t) => (
            <button
              key={t}
              onClick={() => setThumb(t)}
              aria-label="Choose thumbnail"
              aria-pressed={thumb === t}
              className={cn(
                'relative overflow-hidden rounded-[8px] ring-2 ring-offset-2 ring-offset-surface transition-all duration-150',
                thumb === t ? 'ring-primary' : 'ring-transparent hover:ring-border-strong',
              )}
            >
              <Thumb src={t} className="aspect-video w-full object-cover" />
              {thumb === t && (
                <span className="absolute inset-0 grid place-items-center bg-black/30">
                  <Check size={13} className="text-white" />
                </span>
              )}
            </button>
          ))}
        </div>

        {/* tags */}
        <label className="mb-1 block text-[12px] font-medium text-text-2">Tags</label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Comma separated — e.g. onboarding, safety, field work"
          className={cn(inputCls, 'mb-4')}
        />

        {/* posted-by (automatic) */}
        <div className="mb-5 flex items-center gap-2.5 rounded-md bg-surface-2 px-3 py-2.5">
          {/* an attribution chip, not a menu trigger — the uploader is a person
              like any other and drags to the focus slot */}
          <DragPerson name={user?.name ?? ''} id={user?.id} avatar={user?.avatar} subtitle={user?.title}>
            <Avatar src={user?.avatar} name={user?.name ?? ''} size="xs" />
          </DragPerson>
          <p className="text-[12px] text-text-2">
            Posting as{' '}
            {user?.name ? (
              <DragPerson
                name={user.name}
                id={user.id}
                avatar={user.avatar}
                subtitle={user.title}
                className="font-semibold text-text-1"
              >
                {user.name}
              </DragPerson>
            ) : (
              <span className="font-semibold text-text-1">you</span>
            )}{' '}
            · right now
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || (tried && !valid)}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
          >
            <Upload size={14} /> {busy ? 'Saving…' : video ? 'Save changes' : 'Publish video'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
