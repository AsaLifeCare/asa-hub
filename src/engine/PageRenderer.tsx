// <PageRenderer> — the schema-driven page engine (page-types.md).
// Receives a PageSchema, resolves `dataSource` through the api facade, switches on `type` and mounts the matching…
import { useCallback, useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { readerSentence } from '@/lib/readerError'
import { invalidate } from '@/lib/apiCache'
import { onSliceChange, readSlice } from '@/lib/snapshotClient'
import { useAuthStore } from '@/auth/useAuthStore'
import { scopedResourceForRole } from '@/lib/seed-onboarding'
import Card from '@/components/shared/Card'
import { PageSkeleton } from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import AppHero from '@/components/shared/AppHero'
import { heroFigures, type HeroRead, type PageHeroSpec } from '@/lib/appHero'
import DashboardTemplate from '@/engine/templates/DashboardTemplate'
import SheetTemplate from '@/engine/templates/SheetTemplate'
import PipelineTemplate from '@/engine/templates/PipelineTemplate'
import DocumentsTemplate from '@/engine/templates/DocumentsTemplate'
import VideosTemplate from '@/engine/templates/VideosTemplate'
import ScheduleTemplate from '@/engine/templates/ScheduleTemplate'
import DetailTemplate from '@/engine/templates/DetailTemplate'
import BoardTemplate from '@/engine/templates/BoardTemplate'
import GalleryTemplate from '@/engine/templates/GalleryTemplate'
import ChecklistTemplate from '@/engine/templates/ChecklistTemplate'
import TimelineTemplate from '@/engine/templates/TimelineTemplate'
import type { PageSchema, PageType } from '@/engine/types'
import type { ComponentType } from 'react'

// What a template is drawing right now: its rows after its own optimistic edits and its focus narrowing, before any…
export type TemplateRows = { rows: Record<string, unknown>[]; scope?: string }

/** Template contract: every page-type template receives config + resolved data + the schema. */
export type TemplateProps = {
  config: Record<string, any>
  data: any[]
  schema: PageSchema
  // Handed only when a header is drawn over the page.
  onRows?: (report: TemplateRows) => void
}

export const TEMPLATES: Record<PageType, ComponentType<TemplateProps>> = {
  dashboard: DashboardTemplate,
  sheet: SheetTemplate,
  pipeline: PipelineTemplate,
  documents: DocumentsTemplate,
  videos: VideosTemplate,
  schedule: ScheduleTemplate,
  detail: DetailTemplate,
  board: BoardTemplate,
  gallery: GalleryTemplate,
  checklist: ChecklistTemplate,
  timeline: TimelineTemplate,
}

export default function PageRenderer({ schema }: { schema: PageSchema }) {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [data, setData] = useState<any[]>([])
  /** a refusal that explains itself (lib/readerError): said in place of "something went wrong" */
  const [why, setWhy] = useState('')
  // role-scoped data sources (onboarding-mode): trainees read the onboarding collections instead of the full…
  const role = useAuthStore((s) => s.user?.role)

  const load = useCallback(async () => {
    setStatus('loading')
    setWhy('')
    try {
      const { resource, params } = schema.dataSource
      const rows = await api.list(scopedResourceForRole(resource, role), params as never)
      setData(rows)
      setStatus('ready')
    } catch (err) {
      setWhy(readerSentence(err))
      setStatus('error')
    }
  }, [schema, role])

  useEffect(() => {
    load()
  }, [load])

  // THE TURNOVER REACHES THE SCREEN — whatever is NEWER goes in front: when a fresher slice lands for this page's…
  useEffect(() => {
    const { resource, params } = schema.dataSource
    if (params && Object.keys(params).length) return
    const scoped = scopedResourceForRole(resource, role)
    return onSliceChange((changed) => {
      if (changed !== scoped) return
      void readSlice<any>(scoped).then((rows) => {
        if (!rows) return
        invalidate(scoped)
        setData(rows)
      })
    })
  }, [schema, role])

  // THE APP'S OPENING SURFACE.
  const heroSpec = schema.config.hero as PageHeroSpec | undefined
  const [shown, setShown] = useState<{ report: TemplateRows; from: unknown[] } | null>(null)
  const onRows = useCallback((report: TemplateRows) => setShown({ report, from: data }), [data])
  const heroRows: Record<string, unknown>[] = shown && shown.from === data ? shown.report.rows : data
  const heroScope = shown && shown.from === data ? shown.report.scope ?? '' : ''
  const heroRead: HeroRead =
    status === 'loading' ? { state: 'loading' } : status === 'error' ? { state: 'failed' } : { state: 'ready' }
  const hero = heroSpec ? (
    <AppHero
      eyebrow={heroScope ? `${heroSpec.eyebrow} · focused on ${heroScope}` : heroSpec.eyebrow}
      label={heroSpec.label}
      read={heroRead}
      figures={heroFigures(heroSpec, heroRows, heroRead)}
      reading={heroSpec.reading}
      failed={heroSpec.failed}
      sentence={status === 'ready' && heroSpec.sentence ? heroSpec.sentence(heroRows) : undefined}
      onRetry={load}
    />
  ) : null

  if (status === 'loading') {
    return (
      <>
        {hero}
        <PageSkeleton type={schema.type} />
      </>
    )
  }

  if (status === 'error') {
    return (
      <>
        {hero}
        <Card className="mx-auto mt-10 max-w-[420px] border-tint-pink text-center">
          <p className="font-display text-[15px] font-semibold text-text-1">
            {why ? `${schema.dataSource.resource} is not shown here` : `Couldn't load ${schema.dataSource.resource}`}
          </p>
          <p className="mt-1 text-[13px] text-text-2">{why || "Something went wrong while fetching this page's data."}</p>
          <button
            onClick={load}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary hover:bg-primary-hover"
          >
            <RotateCcw size={14} /> Retry
          </button>
        </Card>
      </>
    )
  }

  const Template = TEMPLATES[schema.type]
  const emptyAction = schema.config.emptyAction as { label: string; href?: string } | undefined

  // Templates that draw their own toolbar keep control of the empty state.
  const OWNS_EMPTY_STATE: PageType[] = ['dashboard', 'documents', 'videos', 'pipeline', 'board', 'schedule',
                                       'gallery', 'checklist', 'timeline',
                                       // SHEET TOO: the template draws its own toolbar and its own empty state…
                                       'sheet']

  if (data.length === 0 && !OWNS_EMPTY_STATE.includes(schema.type)) {
    // A RESOURCE NAME IS NOT A WORD.
    const entity = (schema.config as { entity?: string | string[] } | undefined)?.entity
    const plural = Array.isArray(entity) ? entity[1] ?? entity[0] : entity
    return (
      <>
        {hero}
        <Card className="mt-6">
          <EmptyState
            title={plural ? `No ${plural} yet` : `${schema.title} is empty`}
            body="When there's data to show, it will appear here."
            action={emptyAction}
          />
        </Card>
      </>
    )
  }

  // The per-page "Demo data — not connected yet" chip was removed: it shouted at people using apps that are simply…
  // and the global banner still covers real live failures).
  return (
    <>
      {hero}
      <Template config={schema.config} data={data} schema={schema} onRows={heroSpec ? onRows : undefined} />
    </>
  )
}
