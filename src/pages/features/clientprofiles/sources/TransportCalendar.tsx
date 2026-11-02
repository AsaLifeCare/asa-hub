// Clients › Transportation › Calendar: the Transportation app's own calendar — each vehicle's status now, then the month
// or the week of reserved trips, this client's still awaiting approval among them — read for this client. The filter
// shows this client's trips or every client's (another client's drawn as Booked); a trip of this client's, New trip and a
// day pressed (a new trip on that day) open in the right panel.
import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { ohioToday } from '@/lib/ohio'
import VehicleStatusCards from '@/pages/features/vehiclecalendar/VehicleStatusCards'
import FilterBar, { type CalendarView } from '@/pages/features/vehiclecalendar/FilterBar'
import CalendarCard, { FOOTNOTE } from '@/pages/features/vehiclecalendar/CalendarCard'
import { useClientTripBoard } from '@/pages/features/vehiclecalendar/vehicleCalendarLane'
import { pendingTrip, type Panel } from '@/pages/features/vehiclecalendar/vehicleCalendarModel'
import type { TransportPanel as TransportAsk } from './transport'

const SELECT = 'h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'

export type TripsShown = 'client' | 'all'

export default function TransportCalendar({ client, name, adds, onAsk }: {
  client: string
  name: string
  /** New trip is offered */
  adds: boolean
  onAsk: (ask: TransportAsk) => void
}) {
  const read = useClientTripBoard(client)
  const [view, setView] = useState<CalendarView>('month')
  const [date, setDate] = useState('')
  const [hidden, setHidden] = useState<string[]>([])
  const [whose, setWhose] = useState<TripsShown>('client')
  const board = read.board
  if (!board) {
    return read.status === 'failed' ? (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-trip-calendar-read="failed">
        The vehicle calendar could not be read: {read.error}
        <RetryButton onRetry={read.reload} busy={false} />
      </p>
    ) : (
      <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-trip-calendar-read="loading">
        <Loader2 size={13} className="animate-spin" /> Reading the vehicle calendar…
      </p>
    )
  }
  const today = board.today || ohioToday()
  const day = date || today
  const shown = hidden.length ? new Set(board.vehicles.map((v) => v.id).filter((id) => !hidden.includes(id))) : null
  const trips = whose === 'client' ? board.trips.filter((t) => t.client_key === client) : board.trips
  // only this client's trips open; another's is a booking, never a panel
  const onPanel = (p: Panel) => {
    if (p.kind !== 'trip') return
    if (board.trips.some((t) => t.id === p.id && t.client_key === client)) onAsk({ kind: 'trip', id: p.id })
  }
  return (
    <div className="grid gap-3" data-trip-calendar={whose}>
      <VehicleStatusCards vehicles={board.vehicles} stamp={board.stamp} onPanel={onPanel} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12.5px] text-text-2">
          Client
          <select value={whose} onChange={(e) => setWhose(e.target.value === 'all' ? 'all' : 'client')} className={SELECT}
            data-filter="client">
            <option value="client">{name || 'This client'}</option>
            <option value="all">Every client</option>
          </select>
        </label>
        {adds && (
          <button type="button" onClick={() => onAsk({ kind: 'trip-new' })} data-trip-new=""
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-[12px] bg-primary px-3.5 text-[13px] font-semibold text-white hover:bg-primary-hover">
            <Plus size={15} /> New trip
          </button>
        )}
      </div>
      <FilterBar vehicles={board.vehicles} shown={shown} view={view}
        onShown={(next) => setHidden(next ? board.vehicles.map((v) => v.id).filter((id) => !next.has(id)) : [])}
        onView={setView} date={day} onDate={setDate} />
      <CalendarCard view={view} date={day} today={today} trips={trips} vehicles={board.vehicles} shown={shown}
        onDate={setDate} onPanel={onPanel} pending={(t) => pendingTrip(t) && t.client_key === client}
        onDay={adds ? (d) => onAsk({ kind: 'trip-new', day: d }) : undefined} />
      <p className="text-[12px] leading-5 text-text-3">{FOOTNOTE}</p>
    </div>
  )
}
