// Learning — competency tracking for staff.
// The screen is a LADDER, not a score.
import { useCallback, useEffect, useMemo, useState } from 'react'
import DocRoomSection from '@/components/shared/DocRoomSection'
import { Check, ChevronDown, HelpCircle, Loader2, X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Skeleton from '@/components/shared/Skeleton'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
// The platform's own tint maps — writing a second one here is how two palettes drift, and this screen must look…
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

type Skill = {
  id: string; name: string; area: string; description: string
  attempts: number; lastAt: string; stage: string; why: string
  run: number; unassistedRun: number
}
type State = { skills: Skill[]; stages: string[]; rules: Record<string, number> }

/** The ladder, with what each rung MEANS — shown, not left to be guessed. */
const STAGE_META: Record<string, { label: string; tint: TintName; means: string }> = {
  exposed:     { label: 'Not started', tint: 'blue',     means: 'Nobody has put this in front of you yet.' },
  emerging:    { label: 'Emerging',    tint: 'lavender', means: 'Right at least once — not yet repeatable.' },
  practising:  { label: 'Practising',  tint: 'peach',    means: 'A run is forming.' },
  stable:      { label: 'Stable',      tint: 'amber',    means: 'Repeatable, with help available.' },
  mastered:    { label: 'Mastered',    tint: 'mint',     means: 'Repeatable with no help at all.' },
  generalised: { label: 'Generalised', tint: 'mint',     means: 'Held after a gap — learned, not remembered.' },
}

export default function LearningPage() {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setState(await gasAction<State>('learnState', {})) }
    catch (e) { setError(e instanceof Error ? e.message : 'Your record could not be read.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const byArea = useMemo(() => {
    const map = new Map<string, Skill[]>()
    for (const s of state?.skills ?? []) {
      const k = s.area || 'General'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(s)
    }
    return [...map.entries()]
  }, [state])

  const done = useMemo(
    () => (state?.skills ?? []).filter((s) => s.stage === 'mastered' || s.stage === 'generalised').length,
    [state],
  )

  const record = async (s: Skill, correct: boolean, helped: boolean) => {
    setBusy(s.id)
    try {
      setState(await gasAction<State>('learnAttempt', { skillId: s.id, correct, helped }))
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  return (
    <div className="w-full px-5 py-6">
      <PageHeader title="Learning" subtitle="What you can do, and the evidence behind it." />

      {error && <p className="mb-4 rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>}

      {!state ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : state.skills.length === 0 ? (
        <Card><p className="py-10 text-center text-[13px] text-text-3">
          No competencies have been set up yet. An admin adds them in Settings → Learning.
        </p></Card>
      ) : (
        <>
          <Card className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <p className="text-[13px] text-text-2">
              <strong className="font-stat text-[20px] text-text-1">{done}</strong>
              <span className="text-text-3"> of {state.skills.length} mastered</span>
            </p>
            {/* The bar the platform is actually measuring against, said out loud.
                A threshold nobody can see is a threshold people argue with. */}
            <p className="text-[11.5px] leading-4 text-text-3">
              Mastered means <strong className="text-text-2">{state.rules.masteredRun} in a row with no help</strong>;
              generalised means holding it after {state.rules.generalisedGapDays} days away.
            </p>
          </Card>

          <div className="space-y-5">
            {byArea.map(([area, skills]) => (
              <div key={area}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{area}</p>
                <div className="grid items-start gap-2 md:grid-cols-2">
                  {skills.map((s) => {
                    const meta = STAGE_META[s.stage] ?? STAGE_META.exposed
                    const isOpen = open === s.id
                    return (
                      <Card key={s.id} padded={false} className="overflow-hidden">
                        <button onClick={() => setOpen(isOpen ? '' : s.id)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-semibold text-text-1">{s.name}</span>
                            <span className="block truncate text-[11.5px] text-text-3">
                              {s.why}{s.attempts > 0 && ` · ${s.attempts} attempt${s.attempts === 1 ? '' : 's'}`}
                            </span>
                          </span>
                          <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold',
                            TINT_BG[meta.tint], TINT_FG[meta.tint])}>
                            {meta.label}
                          </span>
                          <ChevronDown size={15} className={cn('shrink-0 text-text-3 transition-transform', isOpen && 'rotate-180')} />
                        </button>

                        {isOpen && (
                          <div className="space-y-3 border-t border-border px-4 py-3">
                            {s.description && <p className="text-[12.5px] leading-5 text-text-2">{s.description}</p>}
                            <p className="text-[11.5px] leading-4 text-text-3">{meta.means}</p>
                            <div className="flex flex-wrap gap-2">
                              {/* THREE BUTTONS, NOT TWO. "With help" is a real
                                  outcome and the one that cannot count toward
                                  mastery — hiding it would make people record
                                  an unaided pass they did not have. */}
                              <button onClick={() => void record(s, true, false)} disabled={busy === s.id}
                                className="flex h-8 items-center gap-1.5 rounded-md bg-tint-mint px-3 text-[12.5px] font-semibold text-tint-fg-mint transition-opacity hover:opacity-80 disabled:opacity-40">
                                {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Did it unaided
                              </button>
                              <button onClick={() => void record(s, true, true)} disabled={busy === s.id}
                                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40">
                                <HelpCircle size={12} /> Did it with help
                              </button>
                              <button onClick={() => void record(s, false, false)} disabled={busy === s.id}
                                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-3 transition-colors hover:bg-surface-2 disabled:opacity-40">
                                <X size={12} /> Not yet
                              </button>
                            </div>
                            <p className="text-[11px] leading-4 text-text-3">
                              Every attempt is kept, including the ones that did not go well — a wrong answer you later
                              got right is the evidence that you learned it. Only you can see this record.
                            </p>
                          </div>
                        )}
                      </Card>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* the old platform's TrainingDocs reading room, folded in (gap survey §6) —
          read-only for everyone: the corpus is teaching material */}
      <DocRoomSection room="training" title="Training library"
        line="The training Drive folder — DSP duties, leadership guides, checklists, read in place." />
    </div>
  )
}
