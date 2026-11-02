// Interviews: the interview and onboarding plan — the phone screen, the structured interview and the onboarding…
// A narrowed reader gets the interviews and meet-and-greets booked at their house alone.
import { CalendarCheck, ClipboardCheck, PhoneCall, type LucideIcon } from 'lucide-react'
import { Pair, SectionCard } from '@/pages/features/locations/LocationParts'
import { cn } from '@/lib/utils'
import {
  PLAN_META, interviewsOf, mayEdit, ownerDue, stampWords, type CandidateAsk, type CandidateInterviews, type PlanStep, type Reach,
  type RosterRow,
} from '../candidateModel'
import { readInterviews, readKey, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EmptyNote, Pill, ReadLine, WhyLines } from '../CandidateParts'
import { EditButton } from './Information'

export default function InterviewsSection({ row, narrow = false, onAsk, reach }: {
  row: RosterRow
  narrow?: boolean
  onAsk?: (ask: CandidateAsk) => void
  /** what this reader may do: the preferences' pencil for whom editionsMine names Interviews */
  reach?: Reach
}) {
  const interviews = useCandidateRead(readKey('candidateProfileInterviews', row.key), () => readInterviews(row.key), interviewsOf)
  const onEdit = !narrow && onAsk && reach && mayEdit(reach, 'preferences')
    ? () => onAsk({ kind: 'edit', section: 'preferences' }) : undefined
  return <InterviewsView row={row} interviews={interviews} onRetry={interviews.reload} narrow={narrow} onEdit={onEdit} />
}

function iconOf(step: PlanStep): LucideIcon {
  const t = `${step.id} ${step.title}`.toLowerCase()
  if (/phone|screen/.test(t)) return PhoneCall
  if (/onboard|handoff|start/.test(t)) return ClipboardCheck
  return CalendarCheck
}

const TINT: Record<PlanStep['status'], string> = {
  completed: 'bg-tint-mint text-tint-fg-mint', awaiting_confirmation: 'bg-tint-amber text-tint-fg-amber',
  scheduled: 'bg-tint-blue text-tint-fg-blue', pending: 'bg-surface-2 text-text-2',
}

export function InterviewsView({ row, interviews, onRetry, narrow = false, onEdit }: {
  row: Pick<RosterRow, 'name'>
  interviews: ReadState<CandidateInterviews>
  onRetry: () => void
  /** the meetings booked at the reader's house, and nothing of what the candidate prefers */
  narrow?: boolean
  /** the preferences' edition panel, for whom it opens */
  onEdit?: () => void
}) {
  const v = interviews.data
  return (
    <div className="grid gap-5" data-interviews={narrow ? 'narrow' : ''}>
      <SectionCard title={narrow ? 'Interviews & meet-and-greets' : 'Interview & onboarding plan'}>
        <div className="grid gap-2">
          <ReadLine state={interviews} what="the plan" onRetry={onRetry} />
          {v && <WhyLines why={v.why} degraded={v.degraded} />}
          {v && v.plan.length === 0 && (
            <EmptyNote>
              {narrow ? `No interview or meet-and-greet with ${row.name} is booked at your house.`
                : `No interview or onboarding step is planned for ${row.name} yet.`}
            </EmptyNote>
          )}
          {v && v.plan.length > 0 && (
            <ul className="divide-y divide-border" data-plan="">
              {v.plan.map((s) => {
                const Icon = iconOf(s)
                const when = ownerDue(s.owner, '')
                return (
                  <li key={s.id} className="flex gap-3 py-3.5" data-step={s.id} data-status={s.status}>
                    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', TINT[s.status])}><Icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13.5px] font-semibold text-text-1">{s.title}</p>
                        <Pill meta={PLAN_META[s.status]} />
                      </div>
                      <p className="mt-0.5 text-[12px] text-text-3">{[stampWords(s.date) || 'No date yet', when].filter(Boolean).join(' · ')}</p>
                      {s.result && <p className="mt-1 text-[12.5px] font-medium text-text-1" data-result="">{s.result}</p>}
                      {s.detail && <p className="mt-0.5 text-[12px] text-text-3">{s.detail}</p>}
                      {s.comments && (
                        <p className="mt-1.5 border-l-2 border-border pl-3 text-[12.5px] italic leading-5 text-text-2" data-comments="">{s.comments}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </SectionCard>

      {!narrow && (
        <SectionCard title="Candidate preferences"
          extra={onEdit ? <EditButton label="Edit preferences" onClick={onEdit} what="preferences" /> : undefined}>
          {!v && interviews.status !== 'failed' && <ReadLine state={interviews} what="the preferences" onRetry={onRetry} />}
          {v && !v.preferences.some((p) => p.value) && <EmptyNote>{row.name} has stated no preference on the record.</EmptyNote>}
          {v && v.preferences.some((p) => p.value) && (
            <dl className="grid gap-x-8 sm:grid-cols-2" data-preferences="">
              {v.preferences.map((p, i) => (
                <Pair key={p.label} label={p.label} last={i >= v.preferences.length - (v.preferences.length % 2 === 0 ? 2 : 1)}>
                  {p.value || <span className="text-text-3">Not on file</span>}
                  {p.heard && (
                    <span data-from="call" className="ml-1.5 inline-flex whitespace-nowrap rounded-full bg-tint-lavender px-1.5 py-px align-middle text-[10.5px] font-semibold text-tint-fg-lavender">
                      From the call
                    </span>
                  )}
                  {p.onFile && (
                    <span data-from="paper" className="ml-1.5 inline-flex whitespace-nowrap rounded-full bg-tint-mint px-1.5 py-px align-middle text-[10.5px] font-semibold text-tint-fg-mint">
                      Paper on file
                    </span>
                  )}
                </Pair>
              ))}
            </dl>
          )}
        </SectionCard>
      )}
    </div>
  )
}
