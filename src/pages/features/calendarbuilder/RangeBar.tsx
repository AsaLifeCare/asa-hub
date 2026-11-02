/** The range bar: a week inside the tab or the whole tab, the Key, and the Time switch; display only. */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarRange } from '@/stores/useUiPrefsStore'
import type { DrawnDays } from '@/pages/features/shifts/HouseGrid'
import { CELL_LEGEND, cellTint } from '@/pages/features/shifts/shiftUi'
import { OPEN_CLAIMED, OPEN_RED } from '@/pages/features/shifts/houseCalTypes'
import { TIME_OFF_FLAG, TIME_OFF_KEY } from '@/pages/features/shifts/timeOffMarks'
import { rangeLabel } from './calendarScreen'

/** A mark drawn inside the swatch, as the cell draws it. */
type Inner = 'flag' | 'dot' | 'stripe' | 'dashed' | 'dotted'

/** Every state a cell can show, with its swatch; the Key lists those present in the view. */
const KEY_STATES: { id: string; label: string; swatch: string; style?: CSSProperties; inner?: Inner }[] = [
  { id: 'open', label: 'Open shift', swatch: OPEN_RED },
  { id: 'taken', label: 'Taken', swatch: OPEN_CLAIMED },
  { id: 'called-off', label: 'Called off', swatch: 'ring-1 ring-inset ring-[#8b0000]/50' },
  { id: 'running', label: 'Running now', swatch: 'ring-2 ring-inset ring-success' },
  { id: 'conflict', label: 'To look at', swatch: 'outline outline-1 -outline-offset-1 outline-danger' },
  { id: 'draft', label: 'Draft, not live until published', swatch: 'ring-2 ring-inset ring-warning' },
  { id: 'test-mode', label: 'Test mode, not in the workbook', swatch: 'bg-surface', inner: 'dashed' },
  // time off is drawn as timeOffMarks says: the hatch, and the corner flag
  ...TIME_OFF_KEY.map((k) => ({ id: k.id, label: k.label, swatch: 'bg-surface', style: k.style,
                                inner: k.flag ? ('flag' as const) : undefined })),
  { id: 'transfer', label: 'Transfer waiting (⇄)', swatch: 'ring-1 ring-inset ring-info' },
  { id: 'pending', label: 'Just published (dot)', swatch: 'bg-surface border border-border', inner: 'dot' },
  { id: 'override', label: 'Old override', swatch: 'bg-surface', inner: 'dotted' },
  { id: 'workbook-colour', label: 'Workbook colour: the stripe keeps the cell\'s colour in the workbook', swatch: 'bg-surface border border-border', inner: 'stripe' },
]

/** The mark inside a swatch, in the same classes the grid draws it with. */
function SwatchMark({ inner }: { inner?: Inner }) {
  if (inner === 'flag') return <span className={TIME_OFF_FLAG} />
  if (inner === 'dot') return <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-success" />
  if (inner === 'stripe') return <span className="absolute inset-y-0 left-0 w-[3px] bg-text-3" />
  if (inner === 'dashed') return <span className="absolute inset-[1px] rounded-[3px] border border-dashed border-warning" />
  if (inner === 'dotted') return <span className="absolute inset-[1px] rounded-[3px] border border-dotted border-text-3" />
  return null
}

export default function RangeBar({
  days, weeks, week, range, thisWeek, onWeek, onRange, time, present, weekOnly = false, onToday,
}: {
  days: DrawnDays | undefined
  /** the Saturdays the tab spans */
  weeks: string[]
  week: string
  range: CalendarRange
  /** Ohio's week, or null when the tab does not draw today */
  thisWeek: string | null
  /** a week to draw; `range` when the press also asks for the week range (This week) */
  onWeek: (week: string, range?: CalendarRange) => void
  onRange: (range: CalendarRange) => void
  /** the Time switch, handed in by the view */
  time: ReactNode
  /** the state ids present in this view (calendarScreen.statesPresent) */
  present: string[]
  /** a phone's Builder draws one week only, so the pair is not offered */
  weekOnly?: boolean
  /** the whole tab: "Today" brings today into view and keeps the range */
  onToday?: () => void
}) {
  const [keyOpen, setKeyOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const at = weeks.indexOf(week)
  const byWeek = range === 'week'
  const prev = byWeek && at > 0 ? weeks[at - 1] : ''
  const next = byWeek && at >= 0 && at < weeks.length - 1 ? weeks[at + 1] : ''
  const states = KEY_STATES.filter((s) => present.includes(s.id))
  const btn = 'flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="border-b border-border">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button type="button" className={cn(btn, 'w-8 justify-center px-0')} aria-label="Previous week"
          disabled={!prev} onClick={() => prev && onWeek(prev)}>
          <ChevronLeft size={15} />
        </button>
        <span className="min-w-[120px] text-center text-[13px] font-semibold text-text-1">{rangeLabel(days)}</span>
        <button type="button" className={cn(btn, 'w-8 justify-center px-0')} aria-label="Next week"
          disabled={!next} onClick={() => next && onWeek(next)}>
          <ChevronRight size={15} />
        </button>
        {!byWeek && onToday ? (
          <button type="button" className={btn} disabled={!thisWeek}
            title={thisWeek ? 'Bring today into view, in Ohio' : 'This tab does not draw today'}
            onClick={() => { if (thisWeek) onToday() }}>
            Today
          </button>
        ) : (
          <button type="button" className={btn} disabled={!thisWeek}
            title={thisWeek ? 'The week that holds today, in Ohio' : 'This tab does not draw today'}
            onClick={() => { if (thisWeek) onWeek(thisWeek, 'week') }}>
            This week
          </button>
        )}
        {!weekOnly && (
          <span role="group" aria-label="Range" className="inline-flex overflow-hidden rounded-md border border-border">
            {(['week', 'tab'] as const).map((r) => (
              <button key={r} type="button" aria-pressed={range === r} onClick={() => onRange(r)}
                className={cn('h-8 px-3 text-[12.5px]',
                  range === r ? 'bg-surface-3 font-semibold text-text-1' : 'bg-surface text-text-2 hover:bg-surface-2')}>
                {r === 'week' ? 'Week' : 'Whole tab'}
              </button>
            ))}
          </span>
        )}
        <button type="button" className={btn} aria-expanded={keyOpen} onClick={() => setKeyOpen((o) => !o)}>
          Key <ChevronDown size={13} className={cn('transition-transform', keyOpen && 'rotate-180')} />
        </button>
        <span className="hidden sm:contents">{time}</span>
        <span className="relative sm:hidden">
          <button type="button" className={cn(btn, 'w-8 justify-center px-0')} aria-label="More" aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}>
            <MoreHorizontal size={15} />
          </button>
          {moreOpen && (
            <span className="absolute right-0 top-full z-20 mt-1 flex rounded-md border border-border bg-surface p-1.5 shadow-3">
              {time}
            </span>
          )}
        </span>
      </div>
      {keyOpen && (
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 px-3 pb-2.5 text-[11.5px] text-text-2">
          {CELL_LEGEND.map((k) => (
            <span key={k.kind} className="inline-flex items-center gap-1.5">
              <i aria-hidden className={cn('inline-block h-3 w-[18px] rounded-[4px]', cellTint(k.kind),
                k.kind === 'off' && 'border border-border')} />
              {k.label}
            </span>
          ))}
          {states.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <i aria-hidden className={cn('relative inline-block h-3 w-[18px] overflow-hidden rounded-[4px]', s.swatch)} style={s.style}>
                <SwatchMark inner={s.inner} />
              </i>
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
