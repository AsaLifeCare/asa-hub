// Swap a shift: pick who takes it from the people free for it (no overlap at any house, not off that day); those…
// Nothing changes on the calendar until the replacement, the house manager and a director have each said yes, in…
import { useState } from 'react'
import { ArrowLeftRight, GraduationCap, Search, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { cn } from '@/lib/utils'
import { freePeople, houseLabel, istMissingAt, swapSteps, type Board, type Person } from './schedulingModel'
import { Muted, Refusal, StepBar, TrainingPickNote, TwoPress } from './SchedulingParts'

export function FreePicker({ board, date, span, except, house, needsAccount, picked, onPick, label }: {
  board: Board
  date: string
  span: [number, number] | null
  /** the shift's own holder, in neither list */
  except?: string
  /** the shift's house: somebody already working there that day cannot be given a second shift there */
  house?: string
  /** a swap: only somebody with an account can answer in My Work */
  needsAccount?: boolean
  picked: Person | null
  onPick: (p: Person | null) => void
  label: string
}) {
  const [q, setQ] = useState('')
  const [showBlocked, setShowBlocked] = useState(false)
  const all = freePeople(board, date, span, { except, house, needsAccount })
  const { free, blocked } = freePeople(board, date, span, { except, house, needsAccount, query: q })
  return (
    <div data-free-picker="">
      {all.free.length + all.blocked.length > 8 && (
        <div className="relative mt-2">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a name…" aria-label="Find a name"
            className="h-8 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
        </div>
      )}
      {free.length === 0 ? (
        <p className="mt-2 text-[12px] leading-5 text-text-2">{q ? 'Nobody by that name is free for it.' : 'Nobody is free for this shift right now.'}</p>
      ) : (
        <ul className="scroll-thin mt-2 grid max-h-[260px] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5" role="listbox" aria-label={label}>
          {free.map((p) => {
            const on = picked?.key === p.key
            return (
              <li key={p.key}>
                <button type="button" role="option" aria-selected={on} onClick={() => onPick(on ? null : p)}
                  className={cn('flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                    on ? 'border-primary bg-tint-primary' : 'border-border bg-surface hover:bg-surface-2')}>
                  <Avatar name={p.name} size="xs" />
                  <span className="min-w-0">
                    <span className="clamp-1 block text-[12px] font-medium text-text-1">{p.name}</span>
                    {!p.has_account && <span className="clamp-1 block text-[10.5px] leading-[14px] text-text-3">no account yet</span>}
                    {house && istMissingAt(board, house, p.key) && (
                      <span className="flex items-center gap-1 text-[10.5px] leading-[14px] text-warning" data-no-ist={p.key}>
                        <GraduationCap size={10} /> training — no IST here
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {picked && house && istMissingAt(board, house, picked.key) && <TrainingPickNote />}
      {blocked.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <button type="button" onClick={() => setShowBlocked((v) => !v)} className="text-[11.5px] font-semibold text-text-2 hover:underline">
            {showBlocked ? 'Hide' : 'Show'} the {blocked.length} who cannot take it
          </button>
          {showBlocked && (
            <ul className="mt-1.5 grid gap-1">
              {blocked.map(({ person, why }) => (
                <li key={person.key} className="flex items-start gap-2 text-[11px] leading-4 text-text-3">
                  <Avatar name={person.name} size="xs" />
                  <span><span className="font-medium text-text-2">{person.name}</span> — {why}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function SwapPanel({ board, house, date, dayLabel, text, span, onPropose, onCancel, busy, refusal, holder, initialKey }: {
  board: Board
  /** the person on the shift when an editor asks on their behalf (default: the viewer) */
  holder?: string
  /** somebody already picked (the shift was dropped on their day) */
  initialKey?: string
  /** the shift's house code */
  house: string
  date: string
  dayLabel: string
  text: string
  span: [number, number] | null
  onPropose: (replacement: Person) => void
  onCancel: () => void
  busy: boolean
  refusal: string
}) {
  const [picked, setPicked] = useState<Person | null>(() => board.people.find((p) => p.key === initialKey) ?? null)
  const [armed, setArmed] = useState('')
  const first = (n: string) => n.split(' ')[0] || n
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface p-3" aria-label="Swap this shift" data-swap="">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Swap with</p>
          <p className="text-[12.5px] text-text-1"><span className="font-semibold">{text}</span> · {houseLabel(board, house)} · {dayLabel}</p>
        </div>
        <button type="button" onClick={onCancel} aria-label="Cancel the swap"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
          <X size={14} />
        </button>
      </div>
      <div className="mt-2"><StepBar steps={swapSteps({ state: '', seats: [] }).map((s) => ({ ...s, state: 'na' as const }))} /></div>
      <FreePicker board={board} date={date} span={span} except={holder ?? board.viewer.key} house={house} needsAccount picked={picked}
        onPick={(p) => { setPicked(p); setArmed('') }} label="People free for it" />
      {picked && (
        <div className="mt-2 border-t border-border pt-2">
          <TwoPress id="swap" armed={armed} busy={busy} icon={<ArrowLeftRight size={13} />}
            label={`Ask ${picked.name}`} armedLabel={`Ask ${first(picked.name)}`}
            onArm={(a, act) => { setArmed(a); if (act) onPropose(picked) }} />
          <Muted className="mt-1.5">
            Nothing changes on the calendar yet: {first(picked.name)} accepts first, then the house manager, then a
            director. A no at any step ends it, and you are told.
          </Muted>
        </div>
      )}
      <Refusal>{refusal}</Refusal>
    </div>
  )
}
