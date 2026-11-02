/** The pieces both Time Off screens draw: the status pill, the four-step bar and one request's card. */
import { Check, Clock, Minus, PanelRightOpen, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { cn } from '@/lib/utils'
import {
  STATUS_LABEL, STATUS_TINT, VIA_LABEL, daysWords, legLine, spanWords, statusOf, stepsOf,
  type StepState, type TimeOffRowView,
} from './timeOffModel'

export { legLine }

export function StatusPill({ status }: { status: string }) {
  const tint = STATUS_TINT[status] ?? 'slate'
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', `bg-tint-${tint} text-tint-fg-${tint}`)}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

const STEP_TONE: Record<StepState, string> = {
  done: 'bg-tint-mint text-tint-fg-mint',
  waiting: 'bg-tint-amber text-tint-fg-amber',
  refused: 'bg-tint-danger text-tint-fg-danger',
  na: 'bg-tint-slate text-tint-fg-slate',
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check size={11} />
  if (state === 'waiting') return <Clock size={11} />
  if (state === 'refused') return <X size={11} />
  return <Minus size={11} />
}

/** Asked → House manager → Director → Scheduled; the two middle steps are independent. */
export function StepBar({ row }: { row: Pick<TimeOffRowView, 'status' | 'hm' | 'dir' | 'created_at' | 'filed_via'> }) {
  const steps = stepsOf(row)
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1" title={s.note}>
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', STEP_TONE[s.state])}>
            <StepIcon state={s.state} /> {s.label}
          </span>
          {i < steps.length - 1 && <span className="h-px w-2 bg-border" />}
        </li>
      ))}
    </ol>
  )
}

/** One request as a card: who, when, where, both halves, the step bar. */
export function RequestCard({ row, onOpen, focused }: { row: TimeOffRowView; onOpen: (ref: string) => void; focused?: boolean }) {
  return (
    <li className={cn('grid gap-2 rounded-lg border border-border bg-surface px-4 py-3',
      focused && 'ring-2 ring-[#8b0000] ring-offset-1 ring-offset-surface')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Avatar name={row.person} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-text-1">{row.person}</p>
          <p className="text-[12px] text-text-2">{spanWords(row.start, row.end)} · {daysWords(row.days)}</p>
        </div>
        {row.houses.map((h) => (
          <span key={h.code} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-2">{h.label}</span>
        ))}
        {row.test_mode && (
          <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold text-tint-fg-amber">Filed in test mode</span>
        )}
        {row.waiting_on_me && (
          <span className="rounded-full bg-tint-danger px-2 py-0.5 text-[11px] font-semibold text-tint-fg-danger">Waiting on you</span>
        )}
        <StatusPill status={statusOf(row)} />
        <button type="button" onClick={() => onOpen(row.ref)} title="Everything about this request"
          className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1">
          <PanelRightOpen size={13} /> Details
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-text-3">
        <span>{legLine('House manager', row.hm)}</span>
        <span>{legLine('Director', row.dir)}</span>
        <span>Asked via {VIA_LABEL[row.filed_via] ?? (row.filed_via || 'Platform')}{row.filed_by && row.filed_by !== row.person ? ` by ${row.filed_by}` : ''}</span>
        <span className="font-mono text-[10.5px]">{row.ref}</span>
      </div>
      <StepBar row={row} />
    </li>
  )
}
