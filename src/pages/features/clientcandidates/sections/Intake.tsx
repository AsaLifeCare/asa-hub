// Intake: the intake and service fit — referral review, discovery & assessment, and service fit & placement, each…
import { ClipboardCheck, HeartHandshake, PhoneCall, type LucideIcon } from 'lucide-react'
import { Pair, SectionCard } from '@/pages/features/locations/LocationParts'
import { cn } from '@/lib/utils'
import {
  PLAN_META, intakeOf, mayEdit, reachOf, stampWords, type CandidateAsk, type CandidateEdition, type CandidateIntake,
  type Labelled, type PlanStep, type RosterRow,
} from '../candidateModel'
import { readIntake, readKey, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EditButton, EmptyNote, Pill, ReadLine, WhyLines } from '../CandidateParts'

export default function IntakeSection({ row, onAsk, editions = [] }: {
  row: RosterRow
  onAsk?: (ask: CandidateAsk) => void
  /** the editions this reader makes here: the pencil for whom editionsMine names the intake */
  editions?: readonly CandidateEdition[]
}) {
  const intake = useCandidateRead(readKey('clientCandidateIntake', row.key), () => readIntake(row.key), intakeOf)
  const onEdit = onAsk && mayEdit(reachOf(false, editions), 'intake') ? () => onAsk({ kind: 'edit', section: 'intake' }) : undefined
  return <IntakeView row={row} intake={intake} onRetry={intake.reload} onEdit={onEdit} />
}

function iconOf(step: PlanStep): LucideIcon {
  const t = `${step.id} ${step.title}`.toLowerCase()
  if (/review|referral|call/.test(t)) return PhoneCall
  if (/placement|fit|admission/.test(t)) return HeartHandshake
  return ClipboardCheck
}

const TINT: Record<PlanStep['status'], string> = {
  completed: 'bg-tint-mint text-tint-fg-mint', awaiting_confirmation: 'bg-tint-amber text-tint-fg-amber', pending: 'bg-surface-2 text-text-2',
}

function LabelledList({ title, rows }: { title: string; rows: Labelled[] }) {
  if (!rows.length) return null
  return (
    <div data-labelled={title}>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{title}</h3>
      <dl className="grid gap-x-8 sm:grid-cols-2">
        {rows.map((p, i) => (
          <Pair key={p.label} label={p.label} last={i >= rows.length - (rows.length % 2 === 0 ? 2 : 1)}>
            {p.value ? <span className="whitespace-pre-line">{p.value}</span> : <span className="text-text-3">Not on file</span>}
          </Pair>
        ))}
      </dl>
    </div>
  )
}

export function IntakeView({ row, intake, onRetry, onEdit }: {
  row: Pick<RosterRow, 'name'>
  intake: ReadState<CandidateIntake>
  onRetry: () => void
  /** the edition's panel (the next step and the contact preferences), for whom it opens */
  onEdit?: () => void
}) {
  const v = intake.data
  return (
    <div className="grid gap-5" data-intake="">
      <SectionCard title="Intake & service fit"
        extra={onEdit ? <EditButton label="Edit next step" onClick={onEdit} what="next-step" /> : undefined}>
        <div className="grid gap-2">
          <ReadLine state={intake} what="the intake" onRetry={onRetry} />
          {v && <WhyLines why={v.why} degraded={v.degraded} />}
          {v && v.plan.length === 0 && <EmptyNote>No intake step is planned for {row.name} yet.</EmptyNote>}
          {v && v.plan.length > 0 && (
            <ul className="divide-y divide-border" data-plan="">
              {v.plan.map((s) => {
                const Icon = iconOf(s)
                return (
                  <li key={s.id} className="flex gap-3 py-3.5" data-step={s.id} data-status={s.status}>
                    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', TINT[s.status])}><Icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13.5px] font-semibold text-text-1">{s.title}</p>
                        <Pill meta={PLAN_META[s.status]} />
                      </div>
                      <p className="mt-0.5 text-[12px] text-text-3">{[stampWords(s.date) || 'No date on file', s.owner].filter(Boolean).join(' · ')}</p>
                      {s.detail && <p className="mt-0.5 text-[12px] text-text-2">{s.detail}</p>}
                      {s.result && <p className="mt-1 text-[12.5px] font-medium text-text-1" data-result="">{s.result}</p>}
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

      <SectionCard title="Preferences & support network"
        extra={onEdit ? <EditButton label="Edit" onClick={onEdit} what="intake" /> : undefined}>
        {!v && intake.status !== 'failed' && <ReadLine state={intake} what="the preferences" onRetry={onRetry} />}
        {v && !v.preferences.length && !v.support.length && <EmptyNote>The referral states no preference or support network.</EmptyNote>}
        {v && (v.preferences.length > 0 || v.support.length > 0) && (
          <div className="grid gap-4" data-preferences="">
            <LabelledList title="Preferences" rows={v.preferences} />
            <LabelledList title="Support network" rows={v.support} />
          </div>
        )}
      </SectionCard>
    </div>
  )
}
