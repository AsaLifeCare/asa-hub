/** One transfer and this reader's buttons, all from server/shift_handoff.describe. */
import { ArrowRightLeft, Check, GraduationCap, Loader2, MessageSquare, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import RehearsalMark from './RehearsalMark'
import TrainingNote from './TrainingNote'
import { askLine, waitingLine, type HandoffView, type Training } from './requestsLogic'

/** The card's colours: amber where it always was (Requests), info blue on the calendar screen. */
const TONES = {
  amber: { box: 'border-amber-500 bg-amber-500/[0.05]', head: 'text-amber-700 dark:text-amber-400' },
  info: { box: 'border-info bg-tint-info', head: 'text-info' },
} as const

export default function HandoffCard({ h, busy, onAnswer, onWithdraw, className, tone = 'amber' }: {
  h: HandoffView
  busy: boolean
  onAnswer: (h: HandoffView, word: 'yes' | 'no') => void
  onWithdraw: (h: HandoffView) => void
  className?: string
  tone?: keyof typeof TONES
}) {
  const training = h.first_shift ?? {}
  const trainer = training.trainer as Training | undefined
  const approver = h.approval?.mode === 'above' ? 'The approver' : 'The house manager'
  return (
    <div className={cn('rounded-lg border-2 p-3', TONES[tone].box, className)}
      aria-label="Transfer waiting">
      <p className={cn('flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]', TONES[tone].head)}>
        <ArrowRightLeft size={12} /> Transfer · {h.state === 'pending' ? 'waiting' : h.state}
        <RehearsalMark on={h.rehearsal} className="normal-case tracking-normal" />
      </p>
      {/* THE ASK ITSELF SAYS SO: two consents move a real shift, so the receiver and the
          approver must never read a rehearsed offer as one of theirs to answer. */}
      <RehearsalMark on={h.rehearsal} words className="mt-1" />
      <p className="mt-1 text-[12.5px] leading-5 text-text-1">
        <span className="font-semibold">{h.from_staff}</span> is giving the{' '}
        <span className="font-semibold">{h.value}</span> shift at {h.house} on {h.col_iso} to{' '}
        <span className="font-semibold">{h.to_staff}</span>.
      </p>
      <p className="mt-1 text-[11.5px] leading-4 text-text-2">{waitingLine(h)}</p>
      {h.approval?.why && (
        <p className="mt-0.5 text-[11px] leading-4 text-text-3">
          {h.approval.why.charAt(0).toUpperCase() + h.approval.why.slice(1)}.
        </p>
      )}
      {training.needed && (
        <div className="mt-1">
          <p className="flex items-start gap-1 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
            <GraduationCap size={11} className="mt-0.5 shrink-0" />
            <span>
              {h.to_staff.split(' ')[0]}&apos;s first shift here — the house manager&apos;s training
              {training.request_state === 'approved' ? ', approved.' : '. Approving the transfer takes it on.'}
            </span>
          </p>
          {training.request_state !== 'approved' && <TrainingNote training={trainer} className="mt-0.5" />}
        </div>
      )}
      {/* WHAT BECAME OF THE TEXTS — a row that reached nobody is never called "asked". */}
      {h.state === 'pending' && (
        <ul className="mt-1 grid gap-0.5">
          {[askLine(h.asks?.staff, h.to_staff),
            askLine(h.asks?.manager, h.approval?.mode === 'above' ? 'The directors' : (h.house_manager || approver)),
            askLine(h.asks?.director, h.directors?.length ? h.directors.join(' or ') : 'The director')]
            .filter(Boolean).map((line) => (
              <li key={line} className="flex items-start gap-1 text-[10.5px] leading-[14px] text-text-3">
                <MessageSquare size={10} className="mt-0.5 shrink-0" /> {line}
              </li>
            ))}
        </ul>
      )}
      <p className="mt-1 text-[10.5px] text-text-3">Ref {h.id}</p>

      {/* the director's seat blocks the swap, so the reader who holds it gets its buttons too */}
      {(h.may_accept || h.may_approve || h.may_approve_director || h.may_withdraw) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(h.may_accept || h.may_approve || h.may_approve_director) && (
            <>
              <button disabled={busy} onClick={() => onAnswer(h, 'yes')}
                className="flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {h.may_accept ? 'Accept' : 'Approve'}
              </button>
              <button disabled={busy} onClick={() => onAnswer(h, 'no')}
                className="flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
                <X size={13} /> {h.may_accept ? 'Pass' : 'Not approve'}
              </button>
            </>
          )}
          {h.may_withdraw && (
            <button disabled={busy} onClick={() => onWithdraw(h)}
              className="flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
              <Undo2 size={13} /> Withdraw
            </button>
          )}
        </div>
      )}
    </div>
  )
}
