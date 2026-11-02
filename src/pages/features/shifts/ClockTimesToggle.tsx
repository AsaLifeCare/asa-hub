// THE TIME SWITCH — one button, and it belongs to the person who pressed it.
// It stands beside Refresh on House Calendars: pressed, the grids stop saying `930P-730A` and start saying `9:30 PM…
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiPrefsStore } from '@/stores/useUiPrefsStore'

export default function ClockTimesToggle({ className }: { className?: string }) {
  const on = useUiPrefsStore((s) => s.calendarClockTimes)
  const setOn = useUiPrefsStore((s) => s.setCalendarClockTimes)
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      aria-pressed={on}
      title={on
        ? 'Showing clock times — press for the codes the sheet holds'
        : 'Show the times in full — 930P-730A becomes 9:30 PM – 7:30 AM'}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] font-semibold transition-colors',
        on
          ? 'border-primary bg-primary-soft text-primary-strong'
          : 'border-border bg-surface text-text-1 hover:bg-surface-2',
        className,
      )}
    >
      <Clock size={14} /> Time
    </button>
  )
}
