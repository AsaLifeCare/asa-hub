// "Build an app" — 3-step App Builder modal (apps.md §4).
// ① Basics (name / icon / accent with live TintTile preview) ② Pages (rows: page-type select + title) ③ Review…
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Plus, Search, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import TintTile from '@/components/shared/TintTile'
import SchemaPreview from '@/components/shared/SchemaPreview'
import { AppIcon, ICON_GROUPS } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { TINT_BG, type ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { AppManifest, PageType, ResourceName, TintName } from '@/engine/types'

// 12 accent tints — the 6 pastel house tints + 6 token-derived extended tints (theme.css…
const ACCENTS: { name: ExtendedTintName; label: string }[] = [
  { name: 'mint', label: 'Mint' },
  { name: 'peach', label: 'Peach' },
  { name: 'lavender', label: 'Lavender' },
  { name: 'pink', label: 'Pink' },
  { name: 'blue', label: 'Blue' },
  { name: 'amber', label: 'Amber' },
  { name: 'primary', label: 'Primary' },
  { name: 'danger', label: 'Danger' },
  { name: 'warning', label: 'Warning' },
  { name: 'info', label: 'Info' },
  { name: 'violet', label: 'Violet' },
  { name: 'slate', label: 'Slate' },
]

const PAGE_TYPES: { type: PageType; label: string; blurb: string }[] = [
  { type: 'dashboard', label: 'Dashboard', blurb: 'KPIs, charts and feeds' },
  { type: 'sheet', label: 'Sheet', blurb: 'Filterable data table' },
  { type: 'pipeline', label: 'Pipeline', blurb: 'Staged kanban flow' },
  { type: 'documents', label: 'Documents', blurb: 'Collections + reader' },
  { type: 'videos', label: 'Videos', blurb: 'Course library + player' },
  { type: 'schedule', label: 'Schedule', blurb: 'Week grid calendar' },
  { type: 'detail', label: 'Detail', blurb: 'Record profile panel' },
  { type: 'board', label: 'Board', blurb: 'Horizontal kanban columns' },
  { type: 'gallery', label: 'Gallery', blurb: 'Photo grid + lightbox' },
  { type: 'checklist', label: 'Checklist', blurb: 'Tick-off run with issues' },
  { type: 'timeline', label: 'Timeline', blurb: 'Events in time order' },
]

const RESOURCE_FOR: Record<PageType, ResourceName> = {
  dashboard: 'activity',
  sheet: 'people',
  pipeline: 'candidates',
  documents: 'documents',
  videos: 'videos',
  gallery: 'photos',
  checklist: 'activity',
  timeline: 'activity',
  schedule: 'events',
  detail: 'people',
  board: 'tasks',
}

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

type PageDraft = { type: PageType; title: string }

const STEPS = ['Basics', 'Pages', 'Review']

export default function AppBuilderModal({
  open,
  onOpenChange,
  onFinish,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onFinish: (manifest: AppManifest) => void
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('Field Ops')
  const [tagline, setTagline] = useState('Track field work as it happens.')
  const [icon, setIcon] = useState('rocket')
  const [iconQuery, setIconQuery] = useState('')
  const [accent, setAccent] = useState<ExtendedTintName>('mint')
  const [pages, setPages] = useState<PageDraft[]>([{ type: 'dashboard', title: 'Overview' }])

  const iconGroups = useMemo(() => {
    const needle = iconQuery.trim().toLowerCase()
    if (!needle) return ICON_GROUPS
    return ICON_GROUPS.map((g) => ({ ...g, icons: g.icons.filter((ic) => ic.includes(needle)) })).filter(
      (g) => g.icons.length > 0,
    )
  }, [iconQuery])

  const manifest: AppManifest = useMemo(
    () => ({
      id: slug(name) || 'custom-app',
      name: name.trim() || 'Untitled app',
      tagline: tagline.trim() || 'A custom app built from a schema.',
      icon,
      accent: accent as TintName,
      category: 'Workspace',
      version: '0.1.0',
      isNew: true,
      enabled: true,
      notifications: ['system'],
      pages: pages.map((p, i) => ({
        id: slug(p.title) || `${p.type}-${i + 1}`,
        type: p.type,
        title: p.title.trim() || PAGE_TYPES.find((t) => t.type === p.type)?.label || 'Page',
        dataSource: { resource: RESOURCE_FOR[p.type] },
        config: {},
      })),
    }),
    [name, tagline, icon, accent, pages],
  )

  const canNext =
    step === 0 ? name.trim().length > 0 : step === 1 ? pages.length > 0 && pages.every((p) => p.title.trim()) : true

  const reset = () => {
    setStep(0)
    setName('Field Ops')
    setTagline('Track field work as it happens.')
    setIcon('rocket')
    setIconQuery('')
    setAccent('mint')
    setPages([{ type: 'dashboard', title: 'Overview' }])
  }

  const finish = () => {
    onFinish(manifest)
    onOpenChange(false)
    reset()
  }

  const updatePage = (i: number, patch: Partial<PageDraft>) =>
    setPages((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden bg-surface p-0 sm:max-w-[640px]">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">
            Build an app from a schema
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            One JSON manifest. Pick your page types. Ship it.
          </DialogDescription>
        </DialogHeader>

        {/* stepper */}
        <div className="flex shrink-0 items-center gap-2 px-6 pt-5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <div className="flex items-center gap-2">
                <motion.span
                  animate={{ scale: i === step ? 1.1 : 1 }}
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold transition-colors duration-200',
                    i < step
                      ? 'bg-primary text-on-primary'
                      : i === step
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-3 text-text-3',
                  )}
                >
                  {i + 1}
                </motion.span>
                <span
                  className={cn(
                    'text-[12px] font-medium',
                    i === step ? 'text-text-1' : 'text-text-3',
                    // phones: only the active step's label is shown
                    i !== step && 'max-sm:hidden',
                  )}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="relative mx-1 h-px flex-1 bg-border">
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-primary"
                    animate={{ width: i < step ? '100%' : '0%' }}
                    transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* step body — internal scroll region, footer stays pinned */}
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
              className="min-h-[320px]"
            >
              {step === 0 && (
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div>
                      <span className="mb-1.5 block text-[12px] font-medium text-text-2">Preview</span>
                      <TintTile icon={icon} tint={accent as TintName} size="xl" />
                      <div className="mt-1.5 text-center text-[11px] font-medium capitalize text-text-3">
                        {ACCENTS.find((a) => a.name === accent)?.label}
                      </div>
                    </div>
                    <div className="flex-1 space-y-3">
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-text-2">App name</span>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Field Ops"
                          className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-text-2">Tagline</span>
                        <input
                          value={tagline}
                          onChange={(e) => setTagline(e.target.value)}
                          placeholder="One line for the App Hub card"
                          className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
                        />
                      </label>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="text-[12px] font-medium text-text-2">Icon</span>
                      <div className="relative w-[140px] sm:w-[200px]">
                        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
                        <input
                          value={iconQuery}
                          onChange={(e) => setIconQuery(e.target.value)}
                          placeholder="Search icons…"
                          aria-label="Search icons"
                          className="h-8 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
                        />
                      </div>
                    </div>
                    <div className="scroll-thin max-h-[220px] space-y-3 overflow-y-auto pr-1">
                      {iconGroups.length === 0 && (
                        <p className="py-6 text-center text-[12px] text-text-3">No icons match “{iconQuery}”.</p>
                      )}
                      {iconGroups.map((g) => (
                        <div key={g.id}>
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                            {g.label}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {g.icons.map((ic) => (
                              <button
                                key={ic}
                                onClick={() => setIcon(ic)}
                                aria-label={ic}
                                title={ic}
                                className={cn(
                                  'grid h-9 w-9 place-items-center rounded-sm border text-text-2 transition-colors duration-150',
                                  icon === ic
                                    ? 'border-primary bg-primary-soft text-primary-strong'
                                    : 'border-border bg-surface hover:bg-surface-2',
                                )}
                              >
                                <AppIcon name={ic} size={16} />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[12px] font-medium text-text-2">Accent tint</span>
                    <div className="flex flex-wrap gap-2">
                      {ACCENTS.map((t) => (
                        <motion.button
                          key={t.name}
                          onClick={() => setAccent(t.name)}
                          aria-label={t.label}
                          title={t.label}
                          animate={{ scale: accent === t.name ? 1 : 0.9 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                          className={cn(
                            'h-8 w-8 rounded-full border-2',
                            TINT_BG[t.name],
                            accent === t.name ? 'border-primary ring-2 ring-primary/30' : 'border-transparent',
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-3">
                  <p className="text-[12px] text-text-3">
                    Every screen is an instance of a reusable page template — pick a type and give it a title.
                  </p>
                  {pages.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select value={p.type} onValueChange={(v) => updatePage(i, { type: v as PageType })}>
                        <SelectTrigger className="h-9 w-[160px] rounded-sm border-border bg-surface text-[13px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAGE_TYPES.map((t) => (
                            <SelectItem key={t.type} value={t.type}>
                              <span className="flex items-center gap-2">
                                <AppIcon name={typeIcon(t.type)} size={13} className="text-text-3" />
                                {t.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <input
                        value={p.title}
                        onChange={(e) => updatePage(i, { title: e.target.value })}
                        placeholder="Page title"
                        className="h-9 min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
                      />
                      <button
                        onClick={() => setPages((ps) => ps.filter((_, j) => j !== i))}
                        disabled={pages.length === 1}
                        aria-label="Remove page"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-border text-text-3 transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setPages((ps) => [...ps, { type: 'sheet', title: '' }])}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-border-strong text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2"
                  >
                    <Plus size={14} /> Add page
                  </button>
                  <div className="grid grid-cols-2 gap-1.5 pt-1 sm:grid-cols-3">
                    {PAGE_TYPES.map((t) => (
                      <div key={t.type} className="rounded-sm bg-surface-2 px-2.5 py-2">
                        <div className="flex items-center gap-1.5 text-[12px] font-medium text-text-1">
                          <AppIcon name={typeIcon(t.type)} size={12} className="text-text-3" />
                          {t.label}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-4 text-text-3">{t.blurb}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <p className="mb-3 text-[12px] text-text-3">
                    This is the whole app — one <span className="font-mono text-[11px]">AppManifest</span>. It updates
                    live as you edit.
                  </p>
                  <SchemaPreview schema={manifest} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* footer — fixed, never scrolls away */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-4">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            <ArrowLeft size={14} /> Back
          </button>
          {step < 2 ? (
            <button
              onClick={() => canNext && setStep((s) => s + 1)}
              disabled={!canNext}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
            >
              Next <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={finish}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
            >
              <Plus size={14} /> Add to registry
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function typeIcon(type: PageType): string {
  switch (type) {
    case 'dashboard': return 'layout-grid'
    case 'sheet': return 'table'
    case 'pipeline': return 'git-branch'
    case 'documents': return 'book-open'
    case 'videos': return 'play-circle'
    case 'schedule': return 'calendar-days'
    case 'detail': return 'panel-right'
    case 'gallery': return 'images'
    case 'checklist': return 'list-checks'
    case 'timeline': return 'history'
    case 'board': return 'square-kanban'
  }
}
