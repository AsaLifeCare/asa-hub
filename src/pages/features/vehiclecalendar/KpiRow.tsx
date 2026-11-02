/** The three figures over History and Vehicles: trips waiting on a vehicle, trips scheduled, vehicles in service. */
import { CalendarCheck2, CarFront, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'
import { kpiItems, type Board, type Kpis } from './vehicleCalendarModel'

const LOOK: Record<keyof Kpis, { icon: typeof CarFront; tint: string }> = {
  needs_assignment: { icon: ClipboardList, tint: 'bg-tint-amber text-tint-fg-amber' },
  scheduled: { icon: CalendarCheck2, tint: 'bg-tint-blue text-tint-fg-blue' },
  in_service: { icon: CarFront, tint: 'bg-tint-mint text-tint-fg-mint' },
}

export default function KpiRow({ board, unread }: { board: Board; unread: boolean }) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3" data-kpis="">
      {kpiItems(board).map((k) => {
        const { icon: Icon, tint } = LOOK[k.key]
        return (
          <div key={k.key} className="flex items-center gap-3 rounded-[16px] border border-border bg-surface px-4 py-4 shadow-1" data-kpi={k.label}>
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', tint)}><Icon size={18} /></span>
            <div className="min-w-0">
              <p className="font-display text-[22px] font-semibold leading-7 text-text-1 tabular-nums" title={unread ? 'Not counted: the trips could not be read' : undefined}>
                {unread ? '—' : k.value}
              </p>
              <p className="text-[12px] text-text-3">{k.label}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
