// GALLERY — a page type for collections whose content IS the picture.
// The Image Bank was rendering 73 photos as a spreadsheet: a 110px thumbnail in the first column of a table sorted…
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, CheckSquare, Download, ExternalLink, ImageOff, ImagePlus, Search, Share2, Trash2, X } from 'lucide-react'
import type { TemplateProps } from '@/engine/PageRenderer'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import Card from '@/components/shared/Card'
import SafeImg from '@/components/shared/SafeImg'
import UploadImageModal from '@/components/shared/UploadImageModal'
import { api } from '@/lib/api'
import { useCan } from '@/auth/permissions'
import { useAuthStore } from '@/auth/useAuthStore'
import type { Permission } from '@/auth/types'
import { share } from '@/stores/useShareStore'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { thumbFor } from '@/lib/thumbs'

const ASPECT: Record<string, string> = {
  square: 'aspect-square',
  photo: 'aspect-[4/3]',
  portrait: 'aspect-[3/4]',
}

/** The same shapes as numbers — the uploader crops to exactly this. */
const ASPECT_RATIO: Record<string, number> = { square: 1, photo: 4 / 3, portrait: 3 / 4 }

export default function GalleryTemplate({ config, data, schema }: TemplateProps) {
  const srcKey = (config.srcKey as string) ?? 'src'
  const titleKey = (config.titleKey as string) ?? 'title'
  const subtitleKey = config.subtitleKey as string | undefined
  const groupBy = config.groupBy as string | undefined
  const groupLabels = (config.groupLabels ?? {}) as Record<string, string>
  const aspect = ASPECT[(config.aspect as string) ?? 'photo'] ?? ASPECT.photo

  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string>('all')
  const [open, setOpen] = useState<Record<string, any> | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  // uploads and deletions ride over the fetched rows so the gallery reacts immediately — a bank you just added to…
  const [added, setAdded] = useState<Record<string, any>[]>([])
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  // multi-select, by rule: every user can select many photos to SHARE; the admin additionally gets Delete — which…
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const isAdmin = useAuthStore((st) => st.user?.role === 'admin')
  const canManage = useCan((config.managePerm as Permission) ?? ('people.edit' as Permission))
  const resource = (schema.dataSource?.resource as string) ?? schema.id
  const ratio = ASPECT_RATIO[(config.aspect as string) ?? 'photo'] ?? ASPECT_RATIO.photo

  const truthy = (v: unknown) => ['true', 'yes', 'y', '1', 'sim'].includes(String(v ?? '').trim().toLowerCase())
  const rows = useMemo(
    () => [...added, ...data].filter((r) => r && !removedIds.has(String(r.id)) && !truthy(r.hidden)),
    [data, added, removedIds],
  )

  // Delete = HIDE (standing rule): the photo leaves everyone's screen but the row and the file stay in the system…
  const hideImages = async (targets: Record<string, any>[]) => {
    setDeleting(true)
    const results = await Promise.allSettled(
      targets.map((row) => api.update(resource, String(row.id), { hidden: 'true' })),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.length - ok
    if (ok) {
      setRemovedIds((prev) => {
        const next = new Set(prev)
        targets.forEach((row, i) => { if (results[i].status === 'fulfilled') next.add(String(row.id)) })
        return next
      })
    }
    setOpen(null)
    setSelected(new Set())
    setSelectMode(false)
    if (failed) toast({ type: 'danger', title: `${failed} of ${results.length} could not be hidden`, body: 'Try those again.' })
    else toast({ type: 'success', title: ok === 1 ? 'Image hidden' : `${ok} images hidden`, body: 'Gone from every screen — the files stay in the system.' })
    setDeleting(false)
  }

  const shareSelected = (targets: Record<string, any>[]) => {
    share({
      title: targets.length === 1 ? String(targets[0][titleKey] ?? 'Image') : `${targets.length} images`,
      subtitle: schema.title,
      icon: 'image',
      text: targets.map((r) => `${String(r[titleKey] ?? 'Untitled')} — ${String(r[srcKey] ?? '')}`).join('\n'),
      rows: targets.map((r) => ({ title: String(r[titleKey] ?? 'Untitled'), url: String(r[srcKey] ?? '') })),
      columns: [
        { key: 'title', label: 'Image' },
        { key: 'url', label: 'Link' },
      ],
      filename: 'images',
    })
  }

  const groups = useMemo(() => {
    if (!groupBy) return []
    const counts = new Map<string, number>()
    rows.forEach((r) => {
      const v = String(r[groupBy] ?? '').trim() || 'other'
      counts.set(v, (counts.get(v) ?? 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [rows, groupBy])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (group !== 'all' && groupBy && String(r[groupBy] ?? '').trim() !== group) return false
      if (!needle) return true
      return JSON.stringify(r).toLowerCase().includes(needle)
    })
  }, [rows, q, group, groupBy])

  return (
    <div className="w-full">
      <PageHeader
        title={schema.title}
        subtitle={`${shown.length} of ${rows.length} images`}
        actions={
          <>
            <span className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={(config.searchPlaceholder as string) ?? 'Search images…'}
                className="h-9 w-[240px] rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
              />
            </span>
            {rows.length > 0 && (
              <button
                onClick={() => {
                  setSelectMode((m) => !m)
                  setSelected(new Set())
                }}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-[13px] font-semibold transition-colors',
                  selectMode
                    ? 'border-primary bg-primary-soft text-primary-strong'
                    : 'border-border bg-surface text-text-1 hover:bg-surface-2',
                )}
              >
                <CheckSquare size={14} /> {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}
            {canManage && (
              <button
                onClick={() => setUploadOpen(true)}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
              >
                <ImagePlus size={15} /> Upload
              </button>
            )}
          </>
        }
      />

      {groups.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {[['all', rows.length] as [string, number], ...groups].map(([value, count]) => (
            <button
              key={value}
              onClick={() => setGroup(value)}
              className={cn(
                'h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-colors',
                group === value
                  ? 'border-primary bg-primary-soft text-primary-strong'
                  : 'border-border text-text-2 hover:bg-surface-2',
              )}
            >
              {value === 'all' ? 'All' : (groupLabels[value] ?? value)}{' '}
              <span className="font-mono text-[11px] opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to show"
            body={(config.emptyText as string) ?? 'No image matches this filter.'}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((r, i) => (
            <motion.button
              key={String(r.id ?? i)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: EASE_OUT_EXPO, delay: Math.min(i, 12) * 0.015 }}
              onClick={() => {
                if (!selectMode) return setOpen(r)
                setSelected((prev) => {
                  const next = new Set(prev)
                  const id = String(r.id)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }}
              className={cn(
                'group relative overflow-hidden rounded-lg border bg-surface text-left transition-all duration-150 hover:shadow-2',
                selectMode && selected.has(String(r.id))
                  ? 'border-primary ring-2 ring-primary/40'
                  : 'border-border hover:border-primary/40',
              )}
            >
              {selectMode && (
                <span
                  className={cn(
                    'absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-full border transition-colors',
                    selected.has(String(r.id))
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-white/70 bg-black/30 text-transparent',
                  )}
                >
                  <Check size={13} />
                </span>
              )}
              {/* SafeImg, not <img>: a removed or broken picture leaves a
                  coloured tile with its own initials, never a hole. */}
              <span className={cn('block w-full overflow-hidden bg-surface-2', aspect)}>
                <SafeImg
                  // the grid gets the small copy; opening one still loads the original — see lib/thumbs
                  src={thumbFor(String(r[srcKey] ?? ''))}
                  name={String(r[titleKey] ?? '')}
                  icon="image"
                  shape="square"
                  size="h-full w-full"
                  className="rounded-none [&>img]:h-full [&>img]:w-full [&>img]:object-cover [&>img]:transition-transform [&>img]:duration-300 group-hover:[&>img]:scale-[1.03]"
                  alt={String(r[titleKey] ?? '')}
                />
              </span>
              <span className="block px-3 py-2">
                <span className="clamp-1 block text-[12.5px] font-semibold text-text-1">
                  {String(r[titleKey] ?? 'Untitled')}
                </span>
                {subtitleKey && (
                  <span className="clamp-1 block text-[11.5px] text-text-3">{String(r[subtitleKey] ?? '')}</span>
                )}
              </span>
            </motion.button>
          ))}
        </div>
      )}

      {/* floating bar: everyone shares; only the admin sees Delete (=hide). */}
      <AnimatePresence>
        {selectMode && selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
            // the shell reserves a floor under the page while this is up
            data-floating-bar=""
            className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 shadow-3"
          >
            <span className="text-[13px] font-semibold text-text-1">
              {selected.size} selected
            </span>
            <button
              onClick={() => shareSelected(rows.filter((r) => selected.has(String(r.id))))}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <Share2 size={13} /> Share
            </button>
            {isAdmin && (
              <button
                disabled={deleting}
                onClick={() => void hideImages(rows.filter((r) => selected.has(String(r.id))))}
                className="flex h-8 items-center gap-1.5 rounded-full bg-danger px-3 text-[12.5px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
              >
                <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            <button
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="grid h-8 w-8 place-items-center rounded-full text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-[2px]"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[90vh] w-full max-w-[900px] flex-col overflow-hidden rounded-xl bg-surface shadow-3"
            >
              <div className="relative bg-black">
                <img
                  src={String(open[srcKey])}
                  alt={String(open[titleKey] ?? '')}
                  className="max-h-[60vh] w-full object-contain"
                />
                <button
                  onClick={() => setOpen(null)}
                  aria-label="Close"
                  className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white/90 transition-colors hover:bg-black/60"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="scroll-thin max-h-[30vh] overflow-y-auto p-4">
                <p className="font-display text-[16px] font-bold text-text-1">
                  {String(open[titleKey] ?? 'Untitled')}
                </p>
                <dl className="mt-2 grid gap-1 text-[12.5px] sm:grid-cols-[130px_1fr]">
                  {Object.entries(open)
                    .filter(([k, v]) => k !== srcKey && k !== titleKey && v !== '' && v != null)
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="font-semibold text-text-2">{k}</dt>
                        <dd className="break-words text-text-3">{String(v)}</dd>
                      </div>
                    ))}
                </dl>
                <div className="mt-3 flex gap-2">
                  <a
                    href={String(open[srcKey])}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                  >
                    <ExternalLink size={13} /> Open full size
                  </a>
                  <a
                    href={String(open[srcKey])}
                    download
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                  >
                    <Download size={13} /> Download
                  </a>
                  <button
                    onClick={() =>
                      share({
                        title: String(open[titleKey] ?? 'Image'),
                        subtitle: schema.title,
                        url: String(open[srcKey]),
                        icon: 'image',
                      })
                    }
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                  >
                    <Share2 size={13} /> Share
                  </button>
                  {isAdmin && (
                    <button
                      disabled={deleting}
                      onClick={() => void hideImages([open])}
                      title="Hides it from every screen — the image stays in the system."
                      className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-danger transition-colors hover:bg-tint-pink disabled:opacity-50"
                    >
                      <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <UploadImageModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        ratio={ratio}
        slotLabel={group !== 'all' ? (groupLabels[group] ?? group) : schema.title}
        kinds={
          groupBy
            ? groups.map(([value]) => ({ value, label: groupLabels[value] ?? value }))
            : undefined
        }
        defaultKind={group !== 'all' ? group : undefined}
        onUploaded={async (img) => {
          const row: Record<string, any> = {
            id: `img-${Date.now().toString(36)}`,
            [srcKey]: img.src,
            [titleKey]: img.title,
            ...(groupBy ? { [groupBy]: img.kind } : {}),
          }
          const saved = await api.create(resource, row).catch(() => row)
          setAdded((a) => [saved ?? row, ...a])
          toast({ type: 'success', title: 'Image added', body: `${img.title} · filed as ${img.fileName}` })
        }}
      />

      {rows.length === 0 && data.length > 0 && (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-text-3">
          <ImageOff size={14} /> {data.length} records, none with an image in “{srcKey}”.
        </p>
      )}
    </div>
  )
}
