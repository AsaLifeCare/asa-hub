// ADP · Update Information inside the panel.
// An address is applied by the server on its own and can be undone here; a new e-mail or phone (they open sign-in)…
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PILL, adpLine, type AdpPart } from './supportDeskModel'

const STATE_WORD: Record<AdpPart['state'], { text: string; pill: string }> = {
  applied: { text: 'Applied automatically', pill: PILL.mint },
  ready: { text: 'Ready to approve', pill: PILL.blue },
  refused: { text: 'Not applied', pill: PILL.amber },
  undone: { text: 'Undone', pill: PILL.slate },
  off: { text: 'Automation off', pill: PILL.slate },
}

export default function AdpChange({ adp, canDecide, armed, busy, onPress }: {
  adp: AdpPart
  /** a director: the master and everyone else read it only */
  canDecide: boolean
  /** 'approve' or 'undo' when the first press was made */
  armed: string
  busy: boolean
  onPress: (op: 'approve' | 'undo') => void
}) {
  const look = STATE_WORD[adp.state]
  const op = adp.state === 'ready' ? 'approve' : adp.state === 'applied' ? 'undo' : ''
  return (
    <section className="mt-4 rounded-[12px] border border-border bg-surface-2/50 p-3" data-adp={adp.state} aria-label="ADP information update">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">ADP · Update information</span>
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', look.pill)}>{look.text}</span>
      </div>
      {adp.field && <p className="mt-1.5 text-[12px] text-text-3">Field: <span className="font-semibold text-text-2">{adp.field}</span></p>}
      <p className="mt-1 text-[13px] leading-5 text-text-1" data-adp-line="">{adpLine(adp)}</p>
      {adp.state !== 'refused' && adp.why && <p className="mt-1 text-[12px] leading-5 text-text-3">{adp.why}</p>}
      {op && (
        canDecide ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} data-adp-press={op} data-armed={armed === op ? '' : undefined}
              onClick={() => onPress(op)}
              className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold disabled:opacity-50',
                armed === op ? 'bg-danger text-white' : op === 'approve' ? 'bg-primary text-on-primary' : 'border border-border bg-surface text-text-1 hover:bg-surface-2')}>
              {busy && <Loader2 size={13} className="animate-spin" />}
              {armed === op ? (op === 'approve' ? 'Press again to approve' : 'Press again to undo') : op === 'approve' ? 'Approve' : 'Undo'}
            </button>
            {op === 'approve' && (
              <span className="text-[12px] text-text-3" data-adp-saves-on-profile="">Opens the profile with it filled in — Save there adds it.</span>
            )}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-text-3" data-adp-readonly="">Only the directors approve or undo this change.</p>
        )
      )}
    </section>
  )
}
