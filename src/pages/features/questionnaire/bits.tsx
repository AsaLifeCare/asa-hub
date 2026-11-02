// Questionnaires feature — shared bits: audience meta, the 5 header-layout definitions (with wireframe thumbnails…
import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Clock, Lock } from 'lucide-react'
import {
  questionnaires as seededQuestionnaires,
  type HeaderLayout,
  type Questionnaire,
  type QuestionnaireAudience,
  type QuestionnaireQuestion,
} from '@/lib/seed-questionnaire'
import { useQuestionnaireStore } from '@/stores/useQuestionnaireStore'
import { useLiveQuestionnaires } from '@/pages/features/questionnaire/live'
import { useCan } from '@/auth/permissions'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import type { TintName } from '@/engine/types'
import { cn } from '@/lib/utils'

/* ---------------- permission ---------------- */

// Questionnaire-admin capability.
export const QUESTIONNAIRE_PERM = 'hiring.edit' as const

/* ---------------- page switcher (Questionnaires | Responses) ---------------- */

// Pill-tab switcher rendered at the top of both questionnaire pages so the Responses table is discoverable from the…
export function QuestionnaireTabs({ active }: { active: 'take' | 'responses' }) {
  const canManage = useCan(QUESTIONNAIRE_PERM)
  const navigate = useNavigate()
  const tabs = [{ id: 'take', label: 'Questionnaires' }]
  if (canManage) tabs.push({ id: 'responses', label: 'Responses' })
  return (
    <SegmentedTabs
      className="mb-4 w-fit"
      tabs={tabs}
      value={active}
      onChange={(id) =>
        navigate(id === 'responses' ? '/app/questionnaires/responses' : '/app/questionnaires/take')
      }
    />
  )
}

/* ---------------- audience meta ---------------- */

export const AUDIENCE_META: Record<QuestionnaireAudience, { label: string; tint: TintName }> = {
  'new-hire': { label: 'New hire', tint: 'mint' },
  'all-staff': { label: 'All staff', tint: 'blue' },
  manager: { label: 'Managers', tint: 'lavender' },
}

/* ---------------- header layouts ---------------- */

export const HEADER_LAYOUTS: { id: HeaderLayout; label: string; description: string }[] = [
  { id: 'hero', label: 'Hero', description: 'Centered big title, subcopy and info chips' },
  { id: 'split', label: 'Split', description: 'Title left, meta card with progress right' },
  { id: 'banner', label: 'Banner', description: 'Full-width tinted band, icon and title inline' },
  { id: 'minimal', label: 'Minimal', description: 'Small mono overline and title only' },
  { id: 'cards', label: 'Cards', description: 'Title plus three stat cards (questions / time / privacy)' },
]

/** Tiny wireframe preview of a header layout (radio-list thumbnails). */
export function LayoutThumb({ layout, active }: { layout: HeaderLayout; active?: boolean }) {
  const bar = 'rounded-[2px] bg-text-3/50'
  const tintBar = 'rounded-[2px] bg-primary/50'
  const chip = 'h-[5px] w-[14px] rounded-full bg-surface-3'
  const frame = cn(
    'grid h-[44px] w-[72px] shrink-0 place-items-stretch overflow-hidden rounded-[6px] border p-1 transition-colors',
    active ? 'border-primary bg-tint-primary' : 'border-border bg-surface-2',
  )
  switch (layout) {
    case 'hero':
      return (
        <div className={frame}>
          <div className="flex flex-col items-center justify-center gap-[3px]">
            <div className={cn(bar, 'h-[5px] w-[34px]')} />
            <div className={cn(bar, 'h-[3px] w-[48px] opacity-60')} />
            <div className="flex gap-1">
              <div className={chip} />
              <div className={chip} />
            </div>
          </div>
        </div>
      )
    case 'split':
      return (
        <div className={frame}>
          <div className="grid grid-cols-[1fr_24px] items-center gap-1.5">
            <div className="flex flex-col gap-[3px]">
              <div className={cn(bar, 'h-[5px] w-[30px]')} />
              <div className={cn(bar, 'h-[3px] w-full opacity-60')} />
              <div className={cn(bar, 'h-[3px] w-[80%] opacity-60')} />
            </div>
            <div className="flex h-full flex-col gap-[3px] rounded-[4px] border border-border bg-surface p-[3px]">
              <div className={cn(tintBar, 'h-[3px] w-full')} />
              <div className={cn(bar, 'h-[3px] w-full opacity-60')} />
              <div className={cn(bar, 'h-[3px] w-[70%] opacity-60')} />
            </div>
          </div>
        </div>
      )
    case 'banner':
      return (
        <div className={frame}>
          <div className="flex items-center gap-1.5 rounded-[4px] bg-tint-primary px-1.5">
            <div className="h-[12px] w-[12px] rounded-[3px] bg-primary/60" />
            <div className="flex flex-col gap-[2px]">
              <div className={cn(bar, 'h-[4px] w-[32px]')} />
              <div className={cn(bar, 'h-[3px] w-[44px] opacity-60')} />
            </div>
          </div>
        </div>
      )
    case 'minimal':
      return (
        <div className={frame}>
          <div className="flex flex-col justify-center gap-[3px]">
            <div className={cn(tintBar, 'h-[3px] w-[22px]')} />
            <div className={cn(bar, 'h-[5px] w-[44px]')} />
          </div>
        </div>
      )
    case 'cards':
      return (
        <div className={frame}>
          <div className="flex flex-col justify-center gap-1">
            <div className={cn(bar, 'h-[4px] w-[36px]')} />
            <div className="grid grid-cols-3 gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-[14px] flex-col justify-center gap-[2px] rounded-[3px] border border-border bg-surface p-[3px]">
                  <div className={cn(tintBar, 'h-[3px] w-[60%]')} />
                  <div className={cn(bar, 'h-[2px] w-full opacity-60')} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )
  }
}

/* ---------------- info chips (Time / Privacy — reference style) ---------------- */

export function InfoChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text-2">
      <span className="text-text-3">{icon}</span>
      {children}
    </span>
  )
}

export function InfoChips({ q, className }: { q: Questionnaire; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <InfoChip icon={<Clock size={13} />}>
        Time: About {q.estimatedMin} minutes
      </InfoChip>
      <InfoChip icon={<Lock size={13} />}>
        Privacy: {q.privacyNote}
      </InfoChip>
    </div>
  )
}

/* ---------------- resolvers (seed + local layer) ---------------- */

// All questionnaires: the SHEET, through the resolver, plus anything built locally in the builder modal.
export function useAllQuestionnaires(): Questionnaire[] {
  const created = useQuestionnaireStore((s) => s.created)
  const { questionnaires: live, loading } = useLiveQuestionnaires()
  // THE SEED IS NOT A FALLBACK.
  return [...(loading ? seededQuestionnaires : live), ...created]
}

/** Effective question list: admin-edited set wins over the seeded one. */
export function useResolvedQuestions(q: Questionnaire): QuestionnaireQuestion[] {
  const override = useQuestionnaireStore((s) => s.questionSets[q.id])
  return override ?? q.questions
}

/** Effective header layout: admin override wins over the seeded default. */
export function useResolvedLayout(q: Questionnaire): HeaderLayout {
  const override = useQuestionnaireStore((s) => s.layouts[q.id])
  return override ?? q.headerLayout
}

/** True when the admin-edited question list in the store differs from the seed. */
export function useQuestionnaireEdited(q: Questionnaire): boolean {
  const override = useQuestionnaireStore((s) => s.questionSets[q.id])
  return useMemo(
    () => !!override && JSON.stringify(override) !== JSON.stringify(q.questions),
    [override, q.questions],
  )
}

/* ---------------- shared button styles ---------------- */

export const BTN_PRIMARY =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

export const BTN_GHOST =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-2 transition-colors hover:border-primary/50 hover:text-text-1 active:scale-[0.98]'

export const INPUT_CLS =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export const TEXTAREA_CLS =
  'w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] leading-5 text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
