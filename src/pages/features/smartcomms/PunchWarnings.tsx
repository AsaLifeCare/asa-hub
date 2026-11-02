// THE WARNINGS TO THE DIRECTORS — the punch pair's rung two, as the relay's last post read them…
// Every warning is listed, the live ones and the ones that stopped, each with the reason it stopped.
import { useState } from 'react'
import { BellRing, Loader2 } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { Badge } from '@/components/shared/Badge'
import { TINT_FG } from '@/lib/tints'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { post, LaneError } from '@/pages/features/shifts/laneFetch'
import {
  RECEIVED_PATH, mayAnswer, pairsCardState, warningSentence, warningSpec,
  type PairsCard, type PunchWarning,
} from '@/pages/features/smartcomms/punchPairsLogic'

type Answer = { ref: string; state: string; call_off_ref: string; words: string }

function StateChip({ state }: { state: string }) {
  const spec = warningSpec(state)
  if (!spec.tint) {
    return (
      <span title={spec.means}
        className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-semibold text-text-3">
        {spec.label}
      </span>
    )
  }
  return <span title={spec.means}><Badge label={spec.label} tint={spec.tint} /></span>
}

export default function PunchWarnings({ card, onAnswered }: { card: PairsCard | undefined | null;
                                                            onAnswered?: () => void }) {
  const [busy, setBusy] = useState('')
  const state = pairsCardState(card)
  const warnings: PunchWarning[] = card?.warnings ?? []

  const answer = async (w: PunchWarning) => {
    setBusy(w.ref)
    try {
      const got = await post<Answer>(RECEIVED_PATH, { ref: w.ref })
      toast({ type: 'success', title: `RECEIVED ${got.ref}`, body: got.words })
      onAnswered?.()
    } catch (e) {
      const why = e instanceof LaneError || e instanceof Error ? e.message : 'The RECEIVED could not be recorded.'
      toast({ type: 'warning', title: 'Nothing was done', body: why })
    }
    setBusy('')
  }

  return (
    <section aria-label="Warnings to the directors">
    <Card padded={false} className="overflow-hidden">
      <div className="p-5 pb-3">
        <CardHeader
          title={`Warnings to the directors — ${state.kind === 'unread' ? '—' : warnings.length}`}
          sub="A shift with no clock-in and no clock-out, after the reminders that reached the person ran out: each director on the Time Off settings list is told on their own phone every 20 minutes, each time on a fresh read of the clock, until one answers RECEIVED, which opens it as a call off — or, for a shift that shares its calendar cell, stops the warning so it is opened by hand. Held 21:31–07:59 like every other message."
          extra={<BellRing size={16} className={TINT_FG.pink} />}
        />
        {state.text && (
          <p className={cn('mt-2 text-[12px] leading-[1.5]', state.kind === 'unread' ? TINT_FG.pink : TINT_FG.amber)}>
            {state.text}
          </p>
        )}
      </div>
      {state.kind !== 'unread' && (
        !warnings.length ? (
          <p className="border-t border-border px-5 py-4 text-[12.5px] text-text-2">
            No warning in the last two days.
          </p>
        ) : (
          <ul className="border-t border-border">
            {warnings.map((w) => (
              <li key={w.id} className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-text-1">{w.person}</span>
                    <span className="text-[12px] text-text-3">
                      {w.shift_code} · {w.house_name || w.house || '—'} · {w.day}
                    </span>
                    <StateChip state={w.state} />
                    <span className="font-stat text-[11px] text-text-3">{w.ref}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-[1.5] text-text-2">{warningSentence(w)}</p>
                </div>
                {mayAnswer(w) && (
                  <button
                    type="button"
                    onClick={() => void answer(w)}
                    disabled={!!busy}
                    title="Only a director on the Time Off settings list is heard; the shift opens only on a fresh read of the clock that still shows no punch"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
                  >
                    {busy === w.ref ? <Loader2 size={13} className="animate-spin" /> : null}
                    RECEIVED
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </Card>
    </section>
  )
}
