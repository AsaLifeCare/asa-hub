// Vehicles: the shared fleet, each vehicle's details, its availability on the date chosen and what it is booked for…
// Directors open a vehicle in the panel with the pencil to edit it.
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AVAILABILITY_TONE, availabilityOn, bookingsOn, type Panel, type Trip, type Vehicle } from './vehicleCalendarModel'
import { Muted, StatusPill, TintDot } from './parts'

const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const TD = 'px-4 py-3 align-middle text-[13px] text-text-2'
const CONTROL = 'h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'

export const VEHICLES_FOOTNOTE = 'Choose a trip to check availability for its exact time and assign a vehicle and driver.'

export default function VehiclesTable({ vehicles, trips, date, onDate, canEdit, onPanel }: {
  vehicles: Vehicle[]
  trips: Trip[]
  date: string
  onDate: (d: string) => void
  canEdit: boolean
  onPanel: (p: Panel) => void
}) {
  return (
    <section className="overflow-hidden rounded-[16px] border border-border bg-surface shadow-1" data-vehicles="">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-display text-[16px] font-semibold text-text-1">Manage vehicles</h2>
          <p className="text-[12px] text-text-3">Shared fleet across all clients</p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-text-2">
          Availability date
          <input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} className={CONTROL} data-availability="" />
        </label>
      </div>
      {vehicles.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-text-3">No vehicle is on the list yet{canEdit ? ' — add one from Actions.' : '.'}</p>
      ) : (
        <div className="divide-y divide-border md:divide-y-0">
          <table className="hidden w-full border-collapse md:table">
            <thead className="border-b border-border bg-surface-2/50">
              <tr>
                <th className={TH}>Vehicle</th><th className={TH}>Details</th><th className={TH}>Availability</th>
                <th className={TH}>Bookings on selected date</th>{canEdit && <th className={TH}>Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vehicles.map((v) => {
                const a = availabilityOn(v, trips, date)
                const bookings = bookingsOn(v, trips, date)
                return (
                  <tr key={v.id} data-row={v.id}>
                    <td className={cn(TD, 'font-semibold text-text-1')}><span className="flex items-center gap-2"><TintDot tint={v.tint} /> {v.name}</span></td>
                    <td className={TD}>{v.details || v.description}</td>
                    <td className={TD}><StatusPill word={a} tone={AVAILABILITY_TONE[a]} /></td>
                    <td className={TD}>
                      {bookings.length === 0 ? <span className="text-text-3">No bookings</span> : (
                        <span className="grid gap-0.5">
                          {bookings.map((b) => (
                            <button key={b.trip_id} type="button" onClick={() => onPanel({ kind: 'trip', id: b.trip_id })} data-booking={b.trip_id}
                              className="text-left text-text-1 hover:text-primary hover:underline">{b.line}</button>
                          ))}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className={TD}>
                        <button type="button" aria-label={`Edit the ${v.name}`} onClick={() => onPanel({ kind: 'vehicle', id: v.id })} data-pencil={v.id}
                          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1">
                          <Pencil size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {vehicles.map((v) => {
            const a = availabilityOn(v, trips, date)
            const bookings = bookingsOn(v, trips, date)
            return (
              <div key={v.id} className="grid gap-1.5 px-4 py-3 md:hidden">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold text-text-1"><TintDot tint={v.tint} /> {v.name}</span>
                  <span className="flex items-center gap-2">
                    <StatusPill word={a} tone={AVAILABILITY_TONE[a]} />
                    {canEdit && (
                      <button type="button" aria-label={`Edit the ${v.name}`} onClick={() => onPanel({ kind: 'vehicle', id: v.id })}
                        className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2">
                        <Pencil size={14} />
                      </button>
                    )}
                  </span>
                </div>
                <span className="text-[12.5px] text-text-2">{v.details || v.description}</span>
                <span className="text-[12px] text-text-3">{bookings.length ? bookings.map((b) => b.line).join('; ') : 'No bookings'}</span>
              </div>
            )
          })}
        </div>
      )}
      <Muted className="border-t border-border px-4 py-3">{VEHICLES_FOOTNOTE}</Muted>
    </section>
  )
}
