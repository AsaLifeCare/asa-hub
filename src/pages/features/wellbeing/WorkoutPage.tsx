// Workout — the cortex picks each client's ideal movement session from their ISP mobility and health profile; an AI…
import { useState } from 'react'
import { Clock } from 'lucide-react'
import Card from '@/components/shared/Card'
import SafeImg, { tintForName } from '@/components/shared/SafeImg'
import { workoutPlans } from '@/lib/seed-wellbeing'
import type { WorkoutPlan } from '@/lib/seed-wellbeing'
import { Chip, ClientNameRow, SearchInput, SkeletonCards, StatusChip, WellbeingHeader, useScopedRows } from './components'
import { useContextStore } from '@/stores/useContextStore'
import { useWellbeingRows } from './useWellbeingRows'
import { useWellbeingGenerate } from './useWellbeingGenerate'
import type { WellbeingImageStatus } from './useWellbeingGenerate'
import { useCloseClientDetailPanel } from './useCloseClientDetailPanel'
import DetailModal from './DetailModal'

export type WorkoutRow = WorkoutPlan & { status: WellbeingImageStatus }

/** `onRecord`: drawn on the client's own record, where a name row would only repeat the page. */
export function WorkoutDetailModal({ plan, onClose, onRecord = false }: { plan: WorkoutRow; onClose: () => void; onRecord?: boolean }) {
  return (
    <DetailModal
      open
      onClose={onClose}
      title={plan.activity}
      ariaLabel={`${plan.activity} workout details`}
      image={plan.image}
      imageIcon="dumbbell"
      imageTint={tintForName(plan.activity)}
      imageAlt={plan.activity}
    >
      {!onRecord && (
        <h2 className="mt-0.5 font-display text-[20px] font-bold leading-6 text-text-1">
          <ClientNameRow name={plan.clientName} id={plan.clientId} />
        </h2>
      )}
      <p className="mt-1.5 text-[13px] leading-5 text-text-2">{plan.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Chip tint="peach">
          <Clock size={11} /> {plan.durationMin} min
        </Chip>
        <Chip tint={plan.intensity === 'gentle' ? 'mint' : 'amber'}>{plan.intensity}</Chip>
        <StatusChip status={plan.status} />
      </div>
    </DetailModal>
  )
}

/** `onRecord`: inside the client record's card — a flat box, no name row, no lift. */
export function WorkoutCard({ plan: w, onOpen, onRecord = false }: { plan: WorkoutRow; onOpen: () => void; onRecord?: boolean }) {
  const body = (
    <>
      <SafeImg
        src={w.image}
        name={w.activity}
        icon="dumbbell"
        shape="square"
        size="aspect-[3/2] w-full rounded-none"
        loading={w.status === 'generating'}
      />
      <div className="p-4">
        <p className="font-mono text-[12px] font-semibold uppercase tracking-wide text-tint-fg-info">
          {w.activity}
        </p>
        {!onRecord && (
          <p className="mt-0.5">
            <ClientNameRow name={w.clientName} id={w.clientId} />
          </p>
        )}
        <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-text-2">{w.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip tint="peach">
            <Clock size={11} /> {w.durationMin} min
          </Chip>
          <Chip tint={w.intensity === 'gentle' ? 'mint' : 'amber'}>{w.intensity}</Chip>
          <span className="ml-auto">
            <StatusChip status={w.status} />
          </span>
        </div>
      </div>
    </>
  )
  return (
    <button type="button" onClick={onOpen} className="text-left">
      {onRecord ? (
        <div className="h-full overflow-hidden rounded-md bg-surface-2 hover:ring-1 hover:ring-border-strong">{body}</div>
      ) : (
        <Card padded={false} hover className="overflow-hidden">{body}</Card>
      )}
    </button>
  )
}

export default function WorkoutPage() {
  useCloseClientDetailPanel()
  const [q, setQ] = useState('')
  const [openPlan, setOpenPlan] = useState<WorkoutRow | null>(null)
  const { isGenerating, applyRows, generateMissing } = useWellbeingGenerate('workoutPlans')

  const { rows: source, loading } = useWellbeingRows('workoutPlans', workoutPlans)
  const rows = applyRows(source)
  const visible = useScopedRows(rows, q, ['clientName', 'activity'])

  const ready = visible.filter((w) => w.status === 'ready').length
  const pending = visible.filter((w) => w.status === 'pending').length

  const focus = useContextStore((s) => s.focus)
  const focusHint =
    focus?.type === 'client' ? `Focus: ${focus.name} — showing their card only (exit via the chip in the sidebar)` : undefined

  return (
    <div>
      <WellbeingHeader
        appName="WORKOUT"
        pageLabel="IDEAL MOVEMENT"
        subcopy="The cortex picks each client's ideal movement session from their mobility profile. GENERATE MISSING renders one activity illustration per click (cached for the day)."
        stats={`${ready} ready / ${pending} pending`}
        focusHint={focusHint}
        actionLabel="GENERATE MISSING"
        onAction={() => void generateMissing(visible)}
        actionDisabled={isGenerating}
      />
      <div className="mb-5 max-w-[380px]">
        <SearchInput value={q} onChange={setQ} placeholder="Search client or activity…" />
      </div>

      {loading ? (
        <SkeletonCards count={8} withImage />
      ) : (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map((w) => (
          <WorkoutCard key={w.id} plan={w} onOpen={() => setOpenPlan(w)} />
        ))}
        {visible.length === 0 && (
          <Card className="col-span-full text-center text-[13px] text-text-2">
            No workout plans match this search or focus.
          </Card>
        )}
      </div>
      )}

      {openPlan && <WorkoutDetailModal plan={openPlan} onClose={() => setOpenPlan(null)} />}
    </div>
  )
}
