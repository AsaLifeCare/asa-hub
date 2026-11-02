// The grid on screen is the last file we hold, not the current one — the builder could not be reached this time.
// Said out loud, because a roster that silently shows last period is worse than one that says so.
import { History } from 'lucide-react'

export default function StaleCalendarNote() {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-2">
      <History size={13} className="shrink-0 text-text-3" />
      Serving the last calendar we hold — the calendar service did not answer this time.
    </div>
  )
}
