// Vehicle Status: one card per vehicle, in its own colour — what it is, whether it is free right now, its active…
import { Accessibility, ArrowRight, Users } from 'lucide-react'
import { TINT_VAR } from '@/lib/tints'
import { TINT, whenWords, type Panel, type Vehicle } from './vehicleCalendarModel'
import { Muted, StatusPill } from './parts'

export default function VehicleStatusCards({ vehicles, stamp, onPanel, empty = 'No vehicle is on the list yet.' }: {
  vehicles: Vehicle[]
  stamp: string
  onPanel: (p: Panel) => void
  /** what an empty fleet says here; '' when the page already says it */
  empty?: string
}) {
  return (
    <section className="mb-4" data-status-cards="">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold text-text-1">Vehicle Status</h2>
        {stamp && <span className="text-[12px] text-text-3">{stamp}</span>}
      </div>
      {vehicles.length === 0 ? (
        <Muted>{empty}</Muted>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((v) => <StatusCard key={v.id} v={v} onPanel={onPanel} />)}
        </div>
      )}
    </section>
  )
}

function StatusCard({ v, onPanel }: { v: Vehicle; onPanel: (p: Panel) => void }) {
  const trip = v.active_trip ?? v.next_trip
  const active = Boolean(v.active_trip)
  return (
    <article className="relative overflow-hidden rounded-[16px] border border-border bg-surface p-4 pl-5 shadow-1" data-vehicle-card={v.id}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: TINT_VAR[TINT[v.tint]] }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[16px] font-semibold leading-6 text-text-1">{v.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-3">
            <span className="truncate">{v.description}</span>
            {v.seats > 0 && <span className="inline-flex items-center gap-1"><Users size={11} /> {v.seats} seats</span>}
            {v.wheelchair_accessible && <span className="inline-flex items-center gap-1" title="Wheelchair accessible"><Accessibility size={11} /> Accessible</span>}
          </p>
        </div>
        <StatusPill word={v.status.word || 'Available'} tone={v.status.word ? v.status.tone : 'mint'} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="min-w-0 text-[12.5px] text-text-2">
          {trip ? (
            <>
              <span className="font-semibold text-text-1">{active ? 'Active trip' : 'Next booking'}</span>{' '}
              <span data-trip-when="">{whenWords(trip.start_at, trip.end_at)}</span>
            </>
          ) : 'No upcoming booking'}
        </p>
        {trip && (
          <button type="button" onClick={() => onPanel({ kind: 'trip', id: trip.id })} data-open-trip={trip.id}
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
            {active ? 'View active trip' : 'View next booking'} <ArrowRight size={13} />
          </button>
        )}
      </div>
    </article>
  )
}
