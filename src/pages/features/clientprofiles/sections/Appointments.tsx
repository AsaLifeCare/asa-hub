// Appointments, from the Dr Appointments app's own book (clientSourceAppointments): the client's booked visits with…
// Its panel rides the page's address.
import { Link } from 'react-router'
import { Car, ExternalLink } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { StatusPill } from '@/pages/features/vehiclecalendar/parts'
import { dayLabel } from '@/pages/features/vehiclecalendar/vehicleCalendarModel'
import {
  tripHref, tripTimes, tripWhere, upcomingFirst, useClientTrips, type PersonTrip,
} from '@/pages/features/vehiclecalendar/personTrips'
import { cn } from '@/lib/utils'
import { useShellHides } from '@/lib/myWorkHides'
import type { RosterRow } from '../clientModel'
import { ownRecordOnly, useClientReader, useTransportOffered } from '../clientViewer'
import AppointmentsTab from '../sources/AppointmentsTab'
import { apptPanelOf, apptPanelParam } from '../sources/appointments'

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

export default function AppointmentsSection({ client, panel, onPanel }: {
  client: RosterRow
  panel: string | null
  onPanel: (panel: string | null) => void
}) {
  // the client's Transportation trips are the master's alone while Settings › My Work hides them, and whom App
  // Control's Transportation row names (vehicleCalendarClientTrips asks the same)
  const hides = useShellHides()
  const transport = useTransportOffered(useClientReader())
  return (
    <>
      <AppointmentsTab client={client.client_key} clientName={client.name} panel={apptPanelOf(panel)}
        onPanel={(p) => onPanel(apptPanelParam(p) || null)} />
      {!hides.client_trips && transport && <ClientTrips client={client.client_key} />}
    </>
  )
}

export function ClientTrips({ client }: { client: string }) {
  const read = useClientTrips(client)
  const { viewer } = useClientReader()
  const linked = !ownRecordOnly(viewer)
  const data = read.data
  const rows = data ? upcomingFirst(data.trips, data.today) : []
  const coming = data ? rows.filter((t) => t.day >= data.today).length : 0
  return (
    <SectionCard title="Transportation trips" sub={data && coming ? `${coming} coming up` : undefined}>
      <div data-client-trips="">
        {read.status === 'loading' && !data && <p className="text-[12.5px] text-text-3" data-read="loading">Reading the trips…</p>}
        {read.status === 'failed' && (
          <p role="alert" className="text-[12.5px] leading-5 text-[var(--danger)]" data-read="failed">
            The trips could not be read: {read.error}
          </p>
        )}
        {data && rows.length === 0 && (
          <p className="text-[13px] text-text-3" data-empty="">No Transportation trip is booked for this client.</p>
        )}
        {rows.length > 0 && (
          <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] border-collapse text-[13px]" data-trips="">
              <thead className="bg-surface-2/60">
                <tr>
                  <th className={TH}>Date</th>
                  <th className={TH}>Pickup</th>
                  <th className={TH}>Where</th>
                  <th className={TH}>Vehicle</th>
                  <th className={TH}>Driver</th>
                  <th className={TH}>Status</th>
                  {linked && <th className={cn(TH, 'w-12')}><span className="sr-only">Open in Transportation</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((t) => <TripRow key={t.id} trip={t} past={t.day < (data?.today ?? '')} linked={linked} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function TripRow({ trip: t, past, linked }: { trip: PersonTrip; past: boolean; linked: boolean }) {
  return (
    <tr data-trip={t.id} className={cn('hover:bg-surface-2/60', past && 'text-text-3')}>
      <td className="whitespace-nowrap px-3 py-3 text-text-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-tint-blue px-2 py-0.5 text-[11px] font-semibold text-tint-fg-blue" data-kind="trip">
            <Car size={12} /> Trip
          </span>
          {dayLabel(t.day) || '—'}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-text-2">{tripTimes(t) || '—'}</td>
      <td className="px-3 py-3 font-medium text-text-1">{tripWhere(t) || '—'}</td>
      <td className="px-3 py-3 text-text-2">{t.vehicle_name || 'Not assigned yet'}</td>
      <td className="px-3 py-3 text-text-2">{t.driver_name || '—'}</td>
      <td className="px-3 py-3"><StatusPill word={t.word} tone={t.tone} /></td>
      {linked && (
        <td className="px-3 py-3 text-right">
          <Link to={tripHref(t.id)} aria-label={`Open the trip of ${dayLabel(t.day)} in Transportation`} data-open-trip={t.id}
            className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
            <ExternalLink size={14} />
          </Link>
        </td>
      )}
    </tr>
  )
}
