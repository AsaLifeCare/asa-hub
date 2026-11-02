// MY WEEK — Monday to Sunday from the live house calendars, one column a day, an overnight on the day it starts.
// "No shifts" is drawn only where the relay says a calendar shows the day empty; a day no calendar shows, or a read…
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import ClockTimesToggle from '@/pages/features/shifts/ClockTimesToggle'
import { cellText } from '@/pages/features/shifts/cellClock'
import { useClockTimes } from '@/pages/features/shifts/clockPref'
import {
  MARK_CHIP, MARK_TONE, copiedLine, dayHead, dayLine, dayShift, houseLabel, mondayOf, mutedCard, offBand, rangeWords, weekdayOf,
  type Day, type PanelAsk, type ShiftCard, type Week,
} from './myCalendarModel'

const NAV_BUTTON = 'inline-flex h-9 items-center justify-center rounded-full border border-border bg-surface text-text-1 transition-colors ' +
  'hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40'

export default function WeekCard({ week, title, asked, today, reading, failed, refs, onWeek, onOpen, onRetry, extra }: {
  /** the week read for the address, or null while it is read or when its read failed */
  week: Week | null
  title: string
  /** the week the address asks for ('' is this week) */
  asked: string
  today: string
  reading: boolean
  failed: string
  /** the requests listed below, so a day's time-off band can open its own */
  refs: Set<string>
  onWeek: (week: string) => void
  onOpen: (ask: PanelAsk) => void
  onRetry: () => void
  /** cards of another kind drawn at the top of a day */
  extra?: (day: Day, clock: boolean) => ReactNode
}) {
  const clock = useClockTimes()
  // while a week is read, its range is the address's own day, snapped to its Monday
  const from = week?.from ?? (mondayOf(asked) || mondayOf(today))
  const to = week?.to ?? (from ? dayShift(from, 6) : '')
  const toWeek = (w: string) => onWeek(week && w === week.this ? '' : w)
  const head = week?.head
  const copied = head ? copiedLine(head) : ''
  return (
    <section aria-label={title} className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">{title}</h2>
      <div className="mb-4 mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] font-medium text-text-1" data-week-range="">{from ? rangeWords(from, to) : 'This week'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <ClockTimesToggle />
          <button type="button" className={cn(NAV_BUTTON, 'w-9')} aria-label="Previous week" data-nav="prev"
            disabled={!week?.prev} onClick={() => week?.prev && toWeek(week.prev)}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className={cn(NAV_BUTTON, 'px-4 text-[13px] font-medium')} data-nav="today"
            disabled={!week || week.from === week.this} onClick={() => onWeek('')}>
            Today
          </button>
          <button type="button" className={cn(NAV_BUTTON, 'w-9')} aria-label="Next week" data-nav="next"
            disabled={!week?.next} onClick={() => week?.next && toWeek(week.next)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {!week && (
        <div className="rounded-[14px] border border-border px-4 py-10 text-center">
          {failed ? (
            <p role="alert" className="flex flex-wrap items-center justify-center gap-2 text-[12.5px] text-[var(--danger)]">
              This week could not be read: {failed}. No day is shown rather than an empty week.
              <button type="button" onClick={onRetry} disabled={reading}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
                <RefreshCw size={13} className={reading ? 'animate-spin' : ''} /> Try again
              </button>
            </p>
          ) : (
            <p className="text-[12.5px] text-text-3">Reading the week…</p>
          )}
        </div>
      )}

      {week && (
        <>
          <WeekLines week={week} />
          <div className="scroll-thin overflow-x-auto rounded-[14px] border border-border">
            <div className="grid min-w-[896px] grid-cols-7">
              {week.days.map((d, i) => (
                <DayColumn key={d.iso} day={d} last={i === week.days.length - 1} today={d.iso === today} clock={clock}
                  refs={refs} onOpen={onOpen} extra={extra} />
              ))}
            </div>
          </div>
          {copied && <p className="mt-3 text-[11.5px] text-text-3" data-copied="">{copied}</p>}
        </>
      )}
    </section>
  )
}

/** The head's own sentences: a calendar that could not be read, a stale copy, a mark that could not be read. */
export function WeekLines({ week }: { week: Week }) {
  const head = week.head
  const lines: { key: string; tone: string; text: string }[] = [
    ...(head.state !== 'ready' && head.why ? [{ key: 'head', tone: 'text-[var(--danger)]', text: head.why }] : []),
    ...(head.stale && head.stale_why ? [{ key: 'stale', tone: 'text-[var(--warning)]', text: head.stale_why }] : []),
    ...week.notes.map((n, i) => ({ key: `n${i}`, tone: 'text-text-3', text: n })),
  ]
  if (!lines.length) return null
  return (
    <ul className="mb-3 space-y-1" data-week-lines="">
      {lines.map((l) => <li key={l.key} className={cn('text-[12px] leading-[1.5]', l.tone)}>{l.text}</li>)}
    </ul>
  )
}

export function DayColumn({ day, last, today, clock, refs, onOpen, extra }: {
  day: Day
  last: boolean
  today: boolean
  clock: boolean
  refs: Set<string>
  onOpen: (ask: PanelAsk) => void
  extra?: (day: Day, clock: boolean) => ReactNode
}) {
  const line = dayLine(day)
  const quiet = day.state === 'none' || day.state === 'off'
  const off = day.off
  return (
    <div className={cn('flex min-h-[320px] min-w-0 flex-col', !last && 'border-r border-border')} data-day={day.iso} data-state={day.state}>
      <div title={weekdayOf(day.iso)} aria-current={today ? 'date' : undefined}
        className={cn('border-b border-border px-2 py-3 text-center text-[13px]',
          today ? 'bg-primary/10 font-medium text-primary' : 'bg-surface-2/60 text-text-2')}>
        {dayHead(day.iso)}
      </div>
      <div className={cn('flex flex-1 flex-col gap-2 p-2', today && 'bg-primary/[0.03]')}>
        {off && (refs.has(off.ref) ? (
          <button type="button" onClick={() => onOpen({ kind: 'request', mode: 'detail', ref: off.ref })} data-off={off.state}
            className={cn('rounded-md px-2 py-1 text-left text-[11.5px] font-semibold', OFF_TONE[off.state])}>
            {offBand(off)}
          </button>
        ) : (
          <p data-off={off.state} className={cn('rounded-md px-2 py-1 text-[11.5px] font-semibold', OFF_TONE[off.state])}>{offBand(off)}</p>
        ))}
        {extra?.(day, clock)}
        {day.cards.map((c) => <ShiftChip key={c.id} card={c} clock={clock} onOpen={onOpen} />)}
        {line && (
          <p data-day-line="" className={cn('px-1 text-center', quiet ? 'pt-6 text-[13px] text-text-3'
            : 'pt-4 text-[11.5px] leading-[1.45] text-[var(--warning)]')}>
            {line}
          </p>
        )}
        {day.state !== 'unreadable' && day.notes.map((n, i) => (
          <p key={i} className="px-1 text-[11px] leading-[1.4] text-[var(--warning)]" data-day-note="">{n}</p>
        ))}
      </div>
    </div>
  )
}

const OFF_TONE: Record<string, string> = {
  scheduled: 'border border-[#8b0000]/40 bg-[#8b0000]/5 text-[#8b0000]',
  asked: 'border border-dashed border-violet-500 bg-violet-500/5 text-text-2',
}

export function ShiftChip({ card, clock, onOpen }: { card: ShiftCard; clock: boolean; onOpen: (ask: PanelAsk) => void }) {
  const muted = mutedCard(card)
  return (
    <button type="button" onClick={() => onOpen({ kind: 'shift', card })} data-card={card.id} data-muted={muted ? 'yes' : 'no'}
      className={cn('w-full rounded-[10px] border-l-[3px] px-3 py-2 text-left transition-colors',
        muted ? 'border-border bg-surface-2' : 'border-tint-fg-blue bg-tint-blue hover:brightness-[0.97]')}>
      <span className={cn('block break-words text-[11.5px] font-medium', muted ? 'text-text-3' : 'text-tint-fg-blue')}>
        {cellText(card.shift_code, clock)}
      </span>
      <span className={cn('block break-words text-[13px] font-medium', muted ? 'text-text-3' : 'text-text-1')}>{houseLabel(card)}</span>
      {card.marks.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-1">
          {card.marks.map((m) => (
            <span key={m.kind} data-chip={m.kind}
              className={cn('rounded-full px-1.5 py-px text-[10px] font-semibold', MARK_TONE[m.kind] ?? 'bg-surface-2 text-text-2')}>
              {MARK_CHIP[m.kind] ?? m.kind}
            </span>
          ))}
        </span>
      )}
    </button>
  )
}
