// Swap shifts, picked on the grid: the right panel the second pick opens.
// What each side gives and takes, the checks both legs passed, who answers in order, an optional note, and the ask…
import { useState } from 'react'
import { ArrowLeftRight, Check, GraduationCap } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import {
  EXCHANGE_CHECKS, exchangePlanSteps, exchangeTraining, shiftLine, type Board, type ShiftRef, type WriteAnswer,
} from './schedulingModel'
import { prefsReasonOf, proposeExchange, proposeSwap, saidOf } from './schedulingLane'
import SwapPanel from './SwapPanel'
import { AREA, LABEL, Muted, OUTLINE_BTN, PrefsOverride, Refusal, StepBar, TwoPress } from './SchedulingParts'

/** The shift a cell's Swap button starts pick mode with, already picked as the one given. */
export type SwapPreset = { house: string; rowId: string; iso: string }

const first = (name: string) => name.split(' ')[0] || name
const idOf = (s: ShiftRef) => `${s.house}|${s.rowId}|${s.iso}`

export default function SwapShiftsPanel({ board, give, take, giveAway, awayTo, onClose, onWrite }: {
  board: Board
  give: ShiftRef | null
  /** the partner's shift the second pick chose; null with `giveAway` asks somebody to take `give` outright */
  take: ShiftRef | null
  giveAway: boolean
  /** a shift dropped on somebody's day: the give-away opens with them picked */
  awayTo?: string
  onClose: () => void
  onWrite: (answer: WriteAnswer, close: boolean) => void
}) {
  const open = Boolean(give && (take || giveAway))
  return (
    <SidePanel open={open} onClose={onClose} label="Swap shifts" title={giveAway && !take ? 'Give a shift away' : 'Swap shifts'}
      footer={<button type="button" onClick={onClose} className={cn(OUTLINE_BTN, 'w-full')}>Back to the calendar</button>}>
      {open && give && (
        <SwapAskBody key={`${idOf(give)}>${take ? idOf(take) : `away|${awayTo ?? ''}`}`} board={board} give={give} take={take}
          startAway={giveAway && !take} awayTo={awayTo} onWrite={onWrite} />
      )}
    </SidePanel>
  )
}

function Side({ word, s, to }: { word: string; s: ShiftRef; to: string }) {
  return (
    <div className="flex items-start gap-2" data-side={word}>
      <Avatar name={s.name} size="xs" />
      <p className="min-w-0 text-[12.5px] leading-5 text-text-1">
        <span className="font-semibold">{word}</span> {shiftLine(s)}
        <span className="block text-[11.5px] text-text-3">{to}</span>
      </p>
    </div>
  )
}

export function SwapAskBody({ board, give, take, startAway = false, awayTo, onWrite }: {
  board: Board
  give: ShiftRef
  take: ShiftRef | null
  startAway?: boolean
  awayTo?: string
  onWrite: (answer: WriteAnswer, close: boolean) => void
}) {
  const [away, setAway] = useState(startAway || !take)
  const [note, setNote] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [prefs, setPrefs] = useState<{ reason: string; again: () => Promise<WriteAnswer> } | null>(null)
  const yours = give.key === board.viewer.key
  const at = (s: ShiftRef) => ({ house: s.house, row_id: s.rowId, date: s.iso })
  /** `again`: the same ask confirmed over the Staff Preferences warning. */
  const run = async (fn: () => Promise<WriteAnswer>, again?: () => Promise<WriteAnswer>) => {
    setBusy(true)
    setRefusal('')
    setPrefs(null)
    try {
      onWrite(await fn(), true)
    } catch (err) {
      const reason = prefsReasonOf(err)
      if (reason && again) setPrefs({ reason, again })
      else setRefusal(saidOf(err))
    } finally {
      setBusy(false)
      setArmed('')
    }
  }
  const prefsNote = prefs && (
    <PrefsOverride reason={prefs.reason} label="Ask anyway" busy={busy}
      onGo={() => void run(prefs.again)} onDrop={() => setPrefs(null)} />
  )

  if (away || !take) {
    return (
      <div data-give-away="">
        <Muted className="mt-1">Nothing comes back: somebody free takes {yours ? 'your' : `${first(give.name)}’s`} shift.</Muted>
        <SwapPanel board={board} house={give.house} date={give.iso} dayLabel={give.day} text={give.text} span={[give.start, give.end]}
          holder={give.key} initialKey={awayTo} busy={busy} refusal={refusal} onCancel={() => { setAway(false); setRefusal(''); setPrefs(null) }}
          onPropose={(p) => void run(() => proposeSwap(at(give), p.key, note), () => proposeSwap(at(give), p.key, note, true))} />
        {prefsNote}
        {take && (
          <button type="button" className="mt-3 text-[12px] font-semibold text-primary hover:underline" onClick={() => setAway(false)}>
            Back to the swap with {take.name}
          </button>
        )}
      </div>
    )
  }

  const training = exchangeTraining(board, give, take)
  return (
    <div data-swap-ask="">
      <div className="mt-2 grid gap-2 rounded-lg border border-border bg-surface p-3" data-exchange-summary="">
        <Side word={yours ? 'You give' : `${give.name} gives`} s={give} to={`to ${take.name}`} />
        <Side word={yours ? 'You take' : `${give.name} takes`} s={take} to={`from ${take.name}`} />
      </div>

      {training.map((line) => (
        <p key={line} className="mt-2 flex items-start gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-warning px-2 py-1.5 text-[12px] leading-5 text-text-1" data-exchange-training="">
          <GraduationCap size={13} className="mt-0.5 shrink-0" /> <span>{line}</span>
        </p>
      ))}

      <section className="mt-3" data-checks="">
        <p className={LABEL}>Checked on both sides</p>
        <ul className="mt-1.5 grid gap-1">
          {EXCHANGE_CHECKS.map((c) => (
            <li key={c} className="flex items-start gap-1.5 text-[12px] leading-5 text-text-2">
              <Check size={13} className="mt-1 shrink-0 text-success" /> <span>{c}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-3" data-seats="">
        <p className={LABEL}>Who answers, in order</p>
        <div className="mt-1.5"><StepBar steps={exchangePlanSteps(give, take)} /></div>
      </section>

      <label className={cn(LABEL, 'mt-3')}>
        Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={AREA}
          placeholder={`For ${first(take.name)} — shown with the request`} />
      </label>

      <div className="mt-3 grid gap-2">
        <TwoPress id="send-swap" armed={armed} busy={busy} icon={<ArrowLeftRight size={13} />}
          label="Send swap request" armedLabel={`Send it to ${first(take.name)}`}
          onArm={(a, act) => {
            setArmed(a)
            if (act) void run(() => proposeExchange(at(give), at(take), note), () => proposeExchange(at(give), at(take), note, true))
          }} />
        <Muted>
          Nothing changes yet: {first(take.name)} accepts first, then the house manager of each house, then a director.
          A no at any step ends it, and {yours ? 'you are' : `${first(give.name)} is`} told. Both shifts are checked again
          before they change hands.
        </Muted>
        <Refusal>{refusal}</Refusal>
        {prefsNote}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <button type="button" className="text-[12px] font-semibold text-text-2 hover:underline" disabled={busy}
          onClick={() => { setAway(true); setArmed(''); setRefusal(''); setPrefs(null) }} data-act="give-away">
          Give it instead — nothing comes back
        </button>
      </div>
    </div>
  )
}
