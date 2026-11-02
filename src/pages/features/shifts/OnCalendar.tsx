import { useNavigate } from 'react-router'
import { CalendarDays } from 'lucide-react'
import { houseCalLink } from './houseCalTypes'

/** Opens a pooled shift on Calendar Builder → Live by its handle. */
export default function OnCalendar({ location, shiftRef }: { location: string; shiftRef: string }) {
  const navigate = useNavigate()
  if (!shiftRef) return null
  return (
    <button type="button" onClick={() => navigate(houseCalLink(location, { ref: shiftRef }))}
      title="Open this shift on Calendar Builder → Live"
      className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1">
      <CalendarDays size={12} /> On the calendar
    </button>
  )
}
