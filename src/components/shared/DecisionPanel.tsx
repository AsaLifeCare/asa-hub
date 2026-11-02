// A DECISION, in the right panel — what is asked (the title, who it is about, its facts, the steps it has been…
// Approve is one press; Decline arms first and sends on its second press ("Not yet" disarms).
import { useState, type ReactNode } from 'react'
import { AlertTriangle, Check, FlaskConical, Loader2, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { useTestWarningsHidden } from '@/lib/myWorkHides'

export type DecisionWord = 'approve' | 'decline'
export type DecisionFact = { label: string; value: string }

const PRIMARY = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
const OUTLINE = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50'
const ARMED = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-danger px-3 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

/** A press: Approve sends at once; Decline arms on its first press and sends on its second. */
export function decisionPress(armed: boolean, word: DecisionWord): { armed: boolean; send: DecisionWord | null } {
  if (word === 'approve') return { armed: false, send: 'approve' }
  return armed ? { armed: false, send: 'decline' } : { armed: true, send: null }
}

export default function DecisionPanel({
  open, onClose, itemKey, title, label = 'Approval', who, whoLine, facts, body, steps, testMode, extra, busy, refusal, onAnswer,
  approveLabel = 'Approve', declineLabel = 'Decline', initiallyArmed = false,
}: {
  open: boolean
  onClose: () => void
  /** the item shown: another item starts with an empty note and nothing armed */
  itemKey?: string
  title: string
  label?: string
  /** the person the decision is about, drawn with their avatar */
  who?: string
  whoLine?: string
  facts: DecisionFact[]
  body?: string
  /** where it stands: the seats and their answers, when they are known */
  steps?: ReactNode
  /** the test-mode line, when the item was made while texts were held */
  testMode?: string
  /** anything else the panel shows under the facts (a link to the calendar) */
  extra?: ReactNode
  busy: boolean
  /** a refused answer, said in the panel where the press was */
  refusal?: string
  onAnswer: (word: DecisionWord, note: string) => void
  approveLabel?: string
  declineLabel?: string
  /** Decline already pressed once (a first draw) */
  initiallyArmed?: boolean
}) {
  return (
    <SidePanel open={open} onClose={onClose} label={label} title={title}
      footer={<button type="button" onClick={onClose} className={cn(OUTLINE, 'w-full')}>Close</button>}>
      {open && (
        <DecisionBody key={itemKey ?? title} who={who} whoLine={whoLine} facts={facts} body={body} steps={steps} testMode={testMode}
          extra={extra} busy={busy} refusal={refusal} onAnswer={onAnswer} approveLabel={approveLabel} declineLabel={declineLabel}
          initiallyArmed={initiallyArmed} />
      )}
    </SidePanel>
  )
}

function DecisionBody({
  who, whoLine, facts, body, steps, testMode, extra, busy, refusal, onAnswer, approveLabel, declineLabel, initiallyArmed,
}: {
  who?: string
  whoLine?: string
  facts: DecisionFact[]
  body?: string
  steps?: ReactNode
  testMode?: string
  extra?: ReactNode
  busy: boolean
  refusal?: string
  onAnswer: (word: DecisionWord, note: string) => void
  approveLabel: string
  declineLabel: string
  initiallyArmed: boolean
}) {
  const [note, setNote] = useState('')
  const [armed, setArmed] = useState(initiallyArmed)
  // Settings › My Work hides every test mode warning from anyone but the master: the line and the item's fact
  const noTest = useTestWarningsHidden()
  const shown = facts.filter((f) => f.value && !(noTest && /^test mode$/i.test(f.label.trim())))
  const press = (word: DecisionWord) => {
    const p = decisionPress(armed, word)
    setArmed(p.armed)
    if (p.send) onAnswer(p.send, note)
  }
  return (
    <div data-decision-panel="">
      {who && (
        <div className="mt-2 flex items-center gap-2.5" data-decision-who="">
          <Avatar name={who} size="md" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-text-1">{who}</p>
            {whoLine && <p className="truncate text-[12px] text-text-3">{whoLine}</p>}
          </div>
        </div>
      )}
      {!who && whoLine && <p className="mt-1 text-[12px] text-text-3">{whoLine}</p>}

      {shown.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-2 p-3" data-decision-facts="">
          {shown.map((f, i) => (
            <div key={`${f.label}-${i}`} className="min-w-0">
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{f.label}</dt>
              <dd className="break-words text-[12.5px] leading-[1.5] text-text-1">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {body && <p className="mt-3 whitespace-pre-line text-[12.5px] leading-5 text-text-1" data-decision-body="">{body}</p>}
      {steps && <div className="mt-3" data-decision-steps="">{steps}</div>}
      {testMode && !noTest && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-warning px-2 py-1.5 text-[12px] leading-5 text-text-1"
          data-decision-test-mode="">
          <FlaskConical size={13} className="mt-0.5 shrink-0" /> <span>{testMode}</span>
        </p>
      )}
      {extra}

      <div className="mt-4 grid gap-2 rounded-lg border border-border bg-surface p-3" data-decision-answer="">
        <label className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
          Note
          <textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="Optional — the requester reads it" aria-label="Note with the answer"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] font-normal normal-case tracking-normal text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PRIMARY} disabled={busy} data-press="approve" onClick={() => press('approve')}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {approveLabel}
          </button>
          {/* an approval with no Decline (an empty label) offers Approve alone */}
          {declineLabel && (
            <button type="button" className={armed ? ARMED : OUTLINE} disabled={busy} data-press="decline"
              data-armed={armed ? '' : undefined} onClick={() => press('decline')}>
              <X size={13} /> {armed ? `${declineLabel} — press again` : declineLabel}
            </button>
          )}
          {armed && !busy && (
            <button type="button" onClick={() => setArmed(false)} className="text-[12px] text-text-3 hover:text-text-1">Not yet</button>
          )}
        </div>
        {refusal && (
          <p role="alert" className="flex items-start gap-1.5 text-[12px] leading-5 text-danger">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{refusal}</span>
          </p>
        )}
      </div>
    </div>
  )
}
