/** Live on a phone, one day at a time: the open shifts first, who works, who is off; every row opens the panel. */
import { ChevronDown } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { ROSTER_DAYS } from '@/lib/seed-shifts2'
import { ohioTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import type { PanelTarget } from '@/pages/features/shifts/ShiftCellPanel'
import { countdown, shiftStateLabel } from '@/pages/features/shifts/requestsLogic'
import { hhmm, openAction, type Grid, type OpenShift } from '@/pages/features/shifts/houseCalTypes'
import { TEST_MODE_CELL } from '@/pages/features/shifts/publishedMark'
import { TIME_OFF_LOOK, type TimeOffMarks } from '@/pages/features/shifts/timeOffMarks'
import { agendaOf, openDays } from './calendarScreen'
import { useNowTick } from './useNowTick'

export default function DayAgenda({
  grid, week, day, onDay, mayEdit, nowMs, timeOff, saving, onOpen, onApply,
}: {
  grid: Grid
  /** the seven days of the week drawn */
  week: string[]
  /** the day shown */
  day: string
  onDay: (iso: string) => void
  /** the relay's answer: this reader edits this house */
  mayEdit: boolean
  /** a fixed clock (tests); otherwise the agenda keeps its own while a window counts down */
  nowMs?: number
  timeOff?: TimeOffMarks
  saving: boolean
  onOpen: (target: PanelTarget) => void
  /** a member of staff applies straight from the card (the door checks everything) */
  onApply: (shift: OpenShift) => void
}) {
  const dots = openDays(grid)
  const { open, working, off } = agendaOf(grid, day, timeOff)
  const ticked = useNowTick(open.some((s) => s.pool_state === 'open' && Boolean(s.window?.closes_at)))
  const now = nowMs ?? ticked
  const labelOf = (iso: string) => {
    const c = grid.cols.find((col) => String(col.iso || col.date || '') === iso)
    return c?.short || c?.label || iso
  }
  const today = grid.computed?.window.today ?? ''
  const openShift = (s: OpenShift) => onOpen({ employee: s.open_row, colIso: s.col_iso, label: labelOf(s.col_iso), ...(s.ref ? { ref: s.ref } : {}) })
  return (
    <div className="px-3 pb-3">
      {/* the week's days; a red dot where a shift is open */}
      <div role="tablist" aria-label="Day" className="grid grid-cols-7 gap-1 py-2">
        {week.map((iso, i) => (
          <button key={iso} type="button" role="tab" aria-selected={iso === day} onClick={() => onDay(iso)}
            className={cn('relative flex flex-col items-center rounded-md py-1.5 text-[11px] font-semibold',
              iso === day ? 'bg-primary text-on-primary' : iso === today ? 'bg-tint-primary text-text-1' : 'bg-surface-2 text-text-2')}>
            <span>{ROSTER_DAYS[i] ?? ''}</span>
            <span className="text-[12.5px]">{iso.slice(8)}</span>
            {dots.has(iso) && <span aria-label="an open shift" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#8b0000]" />}
          </button>
        ))}
      </div>

      {open.map((s) => {
        const act = openAction(s, mayEdit)
        const closes = s.window?.closes_at ?? ''
        const windowOpen = s.pool_state === 'open' && !s.claimed_by && !s.started && Boolean(closes)
        const left = windowOpen ? countdown(closes, now) : null
        return (
          <div key={s.ref || s.key} className="mb-2 rounded-lg bg-[#8b0000] p-3 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-white/80">
              {s.kind_of_open === 'call_off' ? 'Call-off · ' : ''}{s.pool_state ? shiftStateLabel(s.pool_state, s.window) : 'Open shift'}
            </p>
            <p className="mt-0.5 text-[15px] font-semibold">
              {s.start != null && s.end != null ? `${hhmm(s.start)} – ${hhmm(s.end)}` : s.code || s.raw}
              <span className="font-normal text-white/75"> · {s.hours}h</span>
            </p>
            {windowOpen && (
              <p className="text-[12px] text-white/85">
                Applications close at {ohioTime(closes)}{left && left.seconds > 0 ? ` · ${left.label} left` : ''}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              {act.kind === 'apply' ? (
                <button type="button" disabled={saving} onClick={() => onApply(s)}
                  className="h-9 flex-1 rounded-md bg-white text-[13px] font-semibold text-[#8b0000] disabled:opacity-50">
                  Apply
                </button>
              ) : null}
              <button type="button" onClick={() => openShift(s)}
                className="h-9 flex-1 rounded-md border border-white/50 text-[13px] font-semibold text-white">
                {act.kind === 'assign' ? 'Give' : act.kind === 'apply' ? 'Details' : 'Open'}
              </button>
            </div>
          </div>
        )
      })}

      <p className="mb-1 mt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
        Working · {working.length}
      </p>
      {working.length === 0 ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-[12.5px] text-text-3">Nobody is rostered to work this day.</p>
      ) : (
        <ul className="grid gap-1">
          {working.map((w) => (
            <li key={w.key}>
              <button type="button" onClick={() => onOpen({ employee: w.employee, colIso: day, label: labelOf(day) })}
                className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-left">
                <Avatar name={w.employee} size="xs" className="h-6 w-6 shrink-0 text-[9px]" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">{w.employee}</span>
                {/* the grid's dashed amber: on the platform, not in the workbook */}
                {w.mark === 'test-mode' && (
                  <span title={`Recorded while test mode was on — ${TEST_MODE_CELL}`}
                    className="shrink-0 rounded-full border border-dashed border-warning px-1.5 text-[10.5px] font-medium italic text-tint-fg-warning">
                    test mode
                  </span>
                )}
                {w.mark === 'pending' && (
                  <span aria-label="just published" title="Just published — the copy of the workbook catches up within half an hour"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                )}
                <span className={cn('shrink-0 text-[12px] tabular-nums text-text-2', w.mark === 'test-mode' && 'italic')}>
                  {w.fact?.start != null && w.fact.end != null ? `${hhmm(w.fact.start)} – ${hhmm(w.fact.end)}` : w.fact?.code}
                </span>
                {w.fact?.state === 'in_progress' && (
                  <span aria-label="running now" className="h-2 w-2 shrink-0 rounded-full bg-success" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {off.length > 0 && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
            <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
            Off · R/O · Time off · {off.length}
          </summary>
          <ul className="mt-1 grid gap-1">
            {off.map((o) => (
              <li key={o.key} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-[12.5px] text-text-2">
                <span className="min-w-0 flex-1 truncate">{o.employee}</span>
                <span className="shrink-0 text-text-3">{o.timeOff ? TIME_OFF_LOOK.scheduled.key : o.fact?.kind === 'ro' ? 'R/O' : 'Off'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
