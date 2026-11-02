// One shift, opened in the right panel — read only: where, when in Eastern Time, who manages the house, what the…
// A call-off says whether it is covered, never by whom.
import { cn } from '@/lib/utils'
import { useTestWarningsHidden } from '@/lib/myWorkHides'
import {
  addressLine, copiedLine, houseLabel, hoursLine, managerLine, markLines, overnightLine, spanLine,
  type ShiftCard, type WeekHead,
} from './myCalendarModel'

const LINE_TONE: Record<string, string> = {
  called_off: 'border-[#8b0000]/40 bg-[#8b0000]/5',
  off_scheduled: 'border-[#8b0000]/40 bg-[#8b0000]/5',
  off_asked: 'border-dashed border-violet-500 bg-violet-500/5',
  test_mode: 'border-border bg-tint-amber',
}

export function shiftPanelTitle(card: ShiftCard): string {
  return houseLabel(card)
}

export default function ShiftBody({ card, head }: { card: ShiftCard; head: WeekHead | null }) {
  const overnight = overnightLine(card)
  // Settings › My Work hides every test mode warning from anyone but the master: a shift's "Test mode" mark too
  const noTest = useTestWarningsHidden()
  const marks = markLines(card).filter((m) => !(noTest && m.kind === 'test_mode'))
  const copied = head ? copiedLine(head) : ''
  return (
    <div className="grid gap-4 pt-1" data-shift-panel={card.id}>
      <div>
        <p className="text-[13px] leading-5 text-text-2" data-span="">{spanLine(card)}</p>
        {overnight && <p className="mt-2 text-[12.5px] leading-5 text-text-2" data-overnight="">{overnight}</p>}
      </div>

      {marks.length > 0 && (
        <ul className="grid gap-1.5">
          {marks.map((m) => (
            <li key={m.kind} data-mark={m.kind}
              className={cn('rounded-lg border px-3 py-2 text-[12.5px] leading-5 text-text-1', LINE_TONE[m.kind] ?? 'border-border bg-surface-2/60')}>
              <span className="font-semibold">{m.label}</span>{m.words ? ` · ${m.words}` : ''}
            </li>
          ))}
        </ul>
      )}

      <dl className="grid gap-3">
        <Pair label="House" value={`${houseLabel(card)}${card.code ? ` · ${card.code}` : ''}`} />
        <Pair label="Address" value={addressLine(card)} />
        <Pair label="House manager" value={managerLine(card)} />
        <Pair label="As written" value={card.shift_code || '—'} mono />
        <Pair label="Hours" value={hoursLine(card)} />
        {card.also.map((a, i) => (
          <Pair key={`${a.house}|${i}`} label="Also on" value={`${a.house}'s calendar, as ${a.token}`} />
        ))}
      </dl>

      {(copied || head?.stale_why) && (
        <div className="border-t border-border pt-3">
          {copied && <p className="text-[11.5px] text-text-3" data-copied="">{copied}</p>}
          {head?.stale && head.stale_why && <p className="text-[11.5px] text-[var(--warning)]">{head.stale_why}</p>}
        </div>
      )}
    </div>
  )
}

function Pair({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-[13px] leading-5 text-text-1', mono && 'font-mono text-[12.5px]')}>{value}</dd>
    </div>
  )
}
