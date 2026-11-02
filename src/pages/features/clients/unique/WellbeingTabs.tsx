// Sleep, Hydration, Workout and Ideal Meals on one client's record.
// Each tab reads its app's resource through the app's own hook — with NO seed, so a failed read is said and never…
import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Zap } from 'lucide-react'
import type { HydrationProfile, SleepProfile } from '@/lib/seed-wellbeing'
import { cn } from '@/lib/utils'
import { SleepProfileBody } from '@/pages/features/wellbeing/SleepPage'
import { HydrationProfileBody } from '@/pages/features/wellbeing/HydrationPage'
import { WorkoutCard, WorkoutDetailModal, type WorkoutRow } from '@/pages/features/wellbeing/WorkoutPage'
import { MealCard, RecipeModal, type MealRow } from '@/pages/features/wellbeing/MealsPage'
import type { ClientRow } from '../shared'
import { ReadError } from './parts'
import { useClientImages } from './useClientImages'
import { useClientWellbeing, type TabRead } from './useClientWellbeing'
import {
  showsGenerate, sortMeals, wellbeingEmpty, wellbeingError, wellbeingReading, wellbeingSource,
  type WellbeingTabId,
} from './uniqueTabs'

type Who = Pick<ClientRow, 'id' | 'name' | 'client_key'>

const firstName = (name: string) => String(name || '').trim().split(/\s+/)[0] || 'this client'

/** Failure, reading, empty — in that order — and only then the rows, with where they came from. */
function Frame({ tab, client, read, head, generate = false, children }: {
  tab: WellbeingTabId
  client: Who
  read: { loading: boolean; error: string; count: number }
  head?: ReactNode
  /** the Generate missing button is on screen */
  generate?: boolean
  children: ReactNode
}) {
  if (read.error) return <ReadError>{wellbeingError(tab, read.error)}</ReadError>
  if (read.loading) return <p className="text-[13.5px] text-text-3">{wellbeingReading(tab)}</p>
  if (!read.count) return <p className="text-[13.5px] text-text-3">{wellbeingEmpty(tab, client.name)}</p>
  return (
    <div className="space-y-3">
      {head}
      {children}
      <p className="text-[12px] leading-5 text-text-3">{wellbeingSource(tab, firstName(client.name), generate)}</p>
    </div>
  )
}

/** The app's own stats line and its one action, for this client's rows. */
function ImageHead({ rows, show, generating, onGenerate }: {
  rows: { status: string }[]
  show: boolean
  generating: boolean
  onGenerate: () => void
}) {
  const ready = rows.filter((r) => r.status === 'ready').length
  const pending = rows.filter((r) => r.status === 'pending').length
  const rendering = rows.filter((r) => r.status === 'generating').length
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-mono text-[12px] text-text-2">
        {`${ready} ready / ${pending} pending${rendering ? ` / ${rendering} rendering` : ''}`}
      </span>
      {show && (
        <button
          onClick={onGenerate}
          disabled={generating}
          title="Renders one missing illustration per click, kept for the day"
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5',
            'text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2',
            generating && 'cursor-not-allowed opacity-50 hover:bg-surface',
          )}
        >
          <Zap size={14} className="text-tint-fg-warning" />
          Generate missing
        </button>
      )}
    </div>
  )
}

/* ---------------- views: what each tab draws from what it read ---------------- */

export function SleepTabView({ client, read }: { client: Who; read: TabRead<SleepProfile> }) {
  return (
    <Frame tab="sleep" client={client} read={{ ...read, count: read.rows.length }}>
      {read.rows.map((p) => (
        <div key={p.id} className="rounded-md bg-surface-2 px-4 py-3.5">
          <SleepProfileBody profile={p} onRecord />
        </div>
      ))}
    </Frame>
  )
}

export function HydrationTabView({ client, read }: { client: Who; read: TabRead<HydrationProfile> }) {
  return (
    <Frame tab="hydration" client={client} read={{ ...read, count: read.rows.length }}>
      {read.rows.map((p) => (
        <div key={p.id} className="rounded-md bg-surface-2 px-4 py-3.5">
          <HydrationProfileBody profile={p} onRecord />
        </div>
      ))}
    </Frame>
  )
}

type ImageViewProps<T> = {
  client: Who
  read: TabRead<T>
  canGenerate: boolean
  generating: boolean
  onGenerate: () => void
}

export function WorkoutTabView({ client, read, canGenerate, generating, onGenerate }: ImageViewProps<WorkoutRow>) {
  const [openId, setOpenId] = useState('')
  const open = read.rows.find((r) => r.id === openId)
  const show = showsGenerate(read.rows, canGenerate)
  return (
    <Frame
      tab="workout" client={client} read={{ ...read, count: read.rows.length }} generate={show}
      head={<ImageHead rows={read.rows} show={show} generating={generating} onGenerate={onGenerate} />}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
        {read.rows.map((w) => <WorkoutCard key={w.id} plan={w} onOpen={() => setOpenId(w.id)} onRecord />)}
      </div>
      {open && <WorkoutDetailModal plan={open} onClose={() => setOpenId('')} onRecord />}
    </Frame>
  )
}

export function MealsTabView({ client, read, canGenerate, generating, onGenerate }: ImageViewProps<MealRow>) {
  const [openId, setOpenId] = useState('')
  const rows = useMemo(() => sortMeals(read.rows), [read.rows])
  const open = rows.find((r) => r.id === openId)
  const show = showsGenerate(rows, canGenerate)
  return (
    <Frame
      tab="meals" client={client} read={{ ...read, count: rows.length }} generate={show}
      head={<ImageHead rows={rows} show={show} generating={generating} onGenerate={onGenerate} />}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-3">
        {rows.map((m) => <MealCard key={m.id} meal={m} onOpen={() => setOpenId(m.id)} onRecord />)}
      </div>
      <AnimatePresence>
        {open && <RecipeModal meal={open} onClose={() => setOpenId('')} onRecord />}
      </AnimatePresence>
    </Frame>
  )
}

/* ---------------- the tabs: each app's own read, then its view ---------------- */

function SleepTab({ client }: { client: Who }) {
  return <SleepTabView client={client} read={useClientWellbeing<SleepProfile>('sleep', client)} />
}

function HydrationTab({ client }: { client: Who }) {
  return <HydrationTabView client={client} read={useClientWellbeing<HydrationProfile>('hydration', client)} />
}

function WorkoutTab({ client }: { client: Who }) {
  return <WorkoutTabView client={client} {...useClientImages<WorkoutRow>('workout', client)} />
}

function MealsTab({ client }: { client: Who }) {
  return <MealsTabView client={client} {...useClientImages<MealRow>('meals', client)} />
}

export default function ClientWellbeingTab({ tab, client }: { tab: WellbeingTabId; client: Who }) {
  switch (tab) {
    case 'sleep': return <SleepTab client={client} />
    case 'hydration': return <HydrationTab client={client} />
    case 'workout': return <WorkoutTab client={client} />
    case 'meals': return <MealsTab client={client} />
  }
}
