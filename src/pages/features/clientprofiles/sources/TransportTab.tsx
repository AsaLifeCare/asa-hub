// Clients › Transportation, from the apps that hold it: the Transportation app's own calendar for this client, then
// History and Vehicles from the Van Calendar's requests and conflicts and the Hub's trips; every detail, a new trip and
// a trip's change open in the right panel.
import { useState, type ReactNode } from 'react'
import { Loader2, Pencil, Plus } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import SearchInput from '@/components/shared/SearchInput'
import { RetryButton, SectionCard } from '@/pages/features/locations/LocationParts'
import { useShellHides } from '@/lib/myWorkHides'
import { cn } from '@/lib/utils'
import { NotOpenNote } from '../ClientParts'
import { clientCan, shownViews, useClientReader } from '../clientViewer'
import TransportCalendar from './TransportCalendar'
import TransportTripEdit, { TransportTripNew } from './TransportTripEdit'
import {
  AVAILABILITY, TRANSPORT_VIEWS, TRIP_STATUSES, bookingLine, dayLabel, filterRows, mileageLine, sourceLine, statusTint,
  statusesIn, transportKpis, transportPanelOf, transportPanelParam, tripById, tripText, tripTypeOf, useTransportRead,
  vehicleText, type Kpi, type Tint, type TransportAnswer, type TransportPanel as TransportAsk, type TransportRead,
  type TransportView, type Trip, type Vehicle,
} from './transport'

export type { TransportAsk }

const SELECT = 'h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'
const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const TD = 'px-4 py-3.5 align-middle text-text-2'
const PILL: Record<Tint, string> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  amber: 'bg-tint-amber text-tint-fg-amber',
  danger: 'bg-tint-danger text-tint-fg-danger',
  slate: 'bg-tint-slate text-tint-fg-slate',
  blue: 'bg-tint-blue text-tint-fg-blue',
}

// The section, reading its own door.
export default function TransportTab({ client, view: driven, onView, panel, onPanel }: {
  client: string
  view?: TransportView
  onView?: (view: TransportView) => void
  /** the panel as the address carries it ('trip~<id>', 'vehicle~<id>', 'sources'), or null */
  panel?: string | null
  onPanel?: (panel: string | null) => void
}) {
  const [own, setOwn] = useState<TransportView>('calendar')
  const view = driven ?? own
  const [date, setDate] = useState('')
  const [ownAsk, setOwnAsk] = useState<TransportAsk | null>(null)
  const ask = panel !== undefined ? transportPanelOf(panel) : ownAsk
  const setAsk = (next: TransportAsk | null) => (onPanel ? onPanel(transportPanelParam(next) || null) : setOwnAsk(next))
  const read = useTransportRead(client, date)
  const today = read.data?.today ?? ''
  return (
    <>
      <TransportBody read={read} view={view} onView={(v) => { setOwn(v); onView?.(v) }}
        date={date || read.data?.date || ''} onDate={(d) => setDate(d === today ? '' : d)} onAsk={setAsk} />
      <TransportPanel ask={ask} answer={read.data} onAsk={setAsk} onClose={() => setAsk(null)} />
    </>
  )
}

export function TransportBody({ read, view, onView, date, onDate, onAsk }: {
  read: TransportRead
  view: TransportView
  onView: (view: TransportView) => void
  date: string
  onDate: (date: string) => void
  onAsk: (ask: TransportAsk) => void
}) {
  const a = read.data
  const reader = useClientReader()
  const { viewer } = reader
  // New trip: the master's, or a holder's of the transportation edition (Settings › Editions)
  const adds = clientCan(reader, 'clients.transportation')
  // Vehicles, the counts and the lines under them: the master's while Settings › My Work keeps them
  const bare = useShellHides().client_transport_notes
  const views = shownViews('transportation', TRANSPORT_VIEWS, viewer).filter((t) => !(bare && t.id === 'vehicles'))
  if (!views.some((t) => t.id === view)) return <NotOpenNote />
  return (
    <div className="grid gap-4" data-transport={view}>
      <div role="tablist" aria-label="Transportation" className="scroll-thin flex gap-1 overflow-x-auto border-b border-border pb-3">
        {views.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === view} onClick={() => onView(t.id)} data-view={t.id}
            className={cn('shrink-0 whitespace-nowrap rounded-[12px] px-3.5 py-2 text-[13px] transition-colors',
              t.id === view ? 'bg-primary-soft font-semibold text-primary' : 'text-text-2 hover:bg-surface-2')}>
            {t.label}
          </button>
        ))}
      </div>
      <ReadLine read={read} />
      {a && view === 'calendar' && (
        <TransportCalendar client={a.client.client_key} name={a.client.name} adds={adds} onAsk={onAsk} />
      )}
      {a && view === 'history' && (
        <>
          {adds && (
            <button type="button" onClick={() => onAsk({ kind: 'trip-new' })} data-trip-new=""
              className="inline-flex h-10 items-center gap-1.5 justify-self-end rounded-[12px] bg-primary px-3.5 text-[13px] font-semibold text-white hover:bg-primary-hover">
              <Plus size={15} /> New trip
            </button>
          )}
          {!bare && <KpiCards items={transportKpis(a, 'history')} />}
          <TabLines why={a.history.why} note={bare ? '' : a.history.note || a.history.rule} asOf={bare ? '' : a.history.as_of} />
          <TripTable trips={a.history.rows} why={a.history.why} onAsk={onAsk} />
          {mileageLine(a) && <p className="text-[12.5px] leading-5 text-text-3" data-mileage="">{mileageLine(a)}</p>}
          {a.history.conflicts.length > 0 && (
            <p className="text-[12.5px] leading-5 text-text-3" data-conflicts={a.history.conflicts.length}>
              Van Calendar conflicts naming this client: {a.history.conflicts.map((c) => `${dayLabel(c.date)} ${c.time} (${c.status})`).join('; ')}.
            </p>
          )}
        </>
      )}
      {a && view === 'vehicles' && (
        <>
          <KpiCards items={transportKpis(a, 'vehicles')} />
          <SectionCard title="Manage vehicles" sub="Shared fleet across all clients" extra={
            <label className="flex items-center gap-2 text-[12.5px] text-text-2">
              Availability
              <input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} className={SELECT} data-availability="" />
            </label>
          }>
            <TabLines why={a.vehicles.why} note={a.vehicles.rule} asOf="" />
            <VehicleTable vehicles={a.vehicles.rows} why={a.vehicles.why} onAsk={onAsk} />
          </SectionCard>
        </>
      )}
      {a && (
        <button type="button" onClick={() => onAsk({ kind: 'sources' })} data-sources=""
          className="justify-self-start text-left text-[11.5px] leading-5 text-text-3 hover:text-text-1 hover:underline">
          Read from {a.sources.filter((s) => s.rows !== null).length} of {a.sources.length} sources — see which
        </button>
      )}
    </div>
  )
}

function ReadLine({ read }: { read: TransportRead }) {
  if (read.status === 'loading' || read.status === 'idle') {
    return <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-read="loading"><Loader2 size={13} className="animate-spin" /> Reading the trips…</p>
  }
  if (read.status !== 'failed') return null
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-read="failed">
      {read.data ? `The last read of the trips failed: ${read.error} What is shown is from the read before.`
        : `The trips could not be read: ${read.error}`}
      <RetryButton onRetry={read.reload} busy={read.refreshing} />
    </p>
  )
}

/** Why a source did not read, what was left out, and how fresh the book is. */
function TabLines({ why, note, asOf }: { why: string; note: string; asOf: string }) {
  if (!why && !note && !asOf) return null
  return (
    <div className="grid gap-1 text-[12px] leading-5">
      {why && <p className="text-[var(--danger)]" data-why="">{why}.</p>}
      {note && <p className="text-text-3" data-note="">{note}</p>}
      {asOf && <p className="text-text-3" data-as-of={asOf}>Newest entry {dayLabel(asOf)}.</p>}
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  if (!status) return <span className="text-text-3">—</span>
  return (
    <span data-status={status} className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', PILL[statusTint(status)])}>
      {status}
    </span>
  )
}

function KpiCards({ items }: { items: Kpi[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-kpis="">
      {items.map((k) => (
        <div key={k.label} className="rounded-[16px] border border-border bg-surface px-4 py-4 shadow-1" data-kpi={k.label}>
          <p className="font-display text-[20px] font-semibold leading-7 text-text-1 tabular-nums">{k.value}</p>
          <p className="mt-1.5 text-[12px] text-text-3">{k.label}</p>
        </div>
      ))}
    </div>
  )
}

function PencilButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-pencil=""
      className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1">
      <Pencil size={14} />
    </button>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div data-empty="" className="rounded-[16px] border border-dashed border-border bg-surface px-5 py-6 text-center text-[13px] leading-5 text-text-3">{children}</div>
}

/** Search, "All statuses", then the columns given. */
function Table<T extends { id: string; status: string }>({ rows, order, columns, text, empty, minWidth }: {
  rows: T[]
  order: readonly string[]
  columns: { label: string; cell: (row: T) => ReactNode }[]
  text: (row: T) => string
  empty: string
  minWidth: number
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const shown = filterRows(rows, query, status, text)
  return (
    <div className="grid gap-3" data-record-table="">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search this view…" className="h-10 min-w-[200px] flex-1 rounded-[12px]" />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT} data-filter="status">
          <option value="">All statuses</option>
          {statusesIn(rows, order).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {rows.length === 0 ? <Empty>{empty}</Empty> : shown.length === 0 ? <Empty>Nothing here matches the search and the status.</Empty> : (
        <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border bg-surface shadow-1">
          <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
            <thead className="border-b border-border bg-surface-2/50">
              <tr>{columns.map((c) => <th key={c.label} className={TH}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} data-row={r.id}>{columns.map((c) => <td key={c.label} className={TD}>{c.cell(r)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TripTable({ trips, why, onAsk }: { trips: Trip[]; why: string; onAsk: (ask: TransportAsk) => void }) {
  return (
    <Table rows={trips} order={TRIP_STATUSES} text={tripText} minWidth={860}
      empty={why ? 'No trip could be listed while that source is unread.' : 'No van trip or van-required visit is on record for this client.'}
      columns={[
        { label: 'Date', cell: (t) => <span className="whitespace-nowrap tabular-nums">{dayLabel(t.date) || '—'}</span> },
        { label: 'Time', cell: (t) => <span className="whitespace-nowrap tabular-nums">{t.reserved_time || t.time || '—'}</span> },
        { label: 'Trip Type', cell: (t) => tripTypeOf(t) || '—' },
        { label: 'Trip Details', cell: (t) => (
          <span className="grid">
            <span className="font-semibold text-text-1">{t.record}</span>
            {(t.destination || t.dr_address) && <span className="text-[12px] text-text-3">{t.destination || t.dr_address}</span>}
          </span>
        ) },
        { label: 'Vehicle', cell: (t) => t.vehicle || t.assignment || '—' },
        { label: 'Edit', cell: (t) => <PencilButton label="Open the trip" onClick={() => onAsk({ kind: 'trip', id: t.id })} /> },
      ]} />
  )
}

function VehicleTable({ vehicles, why, onAsk }: { vehicles: Vehicle[]; why: string; onAsk: (ask: TransportAsk) => void }) {
  return (
    <Table rows={vehicles} order={AVAILABILITY} text={vehicleText} minWidth={760}
      empty={why ? 'The fleet could not be listed while the Van Calendar is unread.' : 'No request names a vehicle and the fleet list is empty.'}
      columns={[
        { label: 'Vehicle', cell: (v) => <span className="font-semibold text-text-1">{v.vehicle}</span> },
        { label: 'Details', cell: (v) => v.details || '—' },
        { label: 'Availability', cell: (v) => <StatusPill status={v.status} /> },
        { label: 'Bookings on selected date', cell: (v) => (v.bookings.length ? v.bookings.map(bookingLine).join('; ') : 'None') },
        { label: 'Action', cell: (v) => <PencilButton label="Open the vehicle" onClick={() => onAsk({ kind: 'vehicle', id: v.id })} /> },
      ]} />
  )
}

/* ---------- the right panel ---------- */

function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === '' || children === null || children === undefined) return null
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-text-1">{children}</dd>
    </div>
  )
}

// a trip of the Transportation app's own (vc_trips)
const VC_TRIP = /^VT[0-9A-F]{10}$/

const SOURCE_LABEL: Record<string, string> = {
  van_calendar: 'Van Calendar › Requests', hub_form: 'Hub form › Van Calendar', dr_visits: 'Dr Appt Archive (van required)',
}

export function TransportPanel({ ask, answer, onAsk, onClose }: {
  ask: TransportAsk | null
  answer: TransportAnswer | null
  onAsk: (ask: TransportAsk) => void
  onClose: () => void
}) {
  if (!ask || !answer) return <SidePanel open={false} onClose={onClose} label="Trip" title=""><span /></SidePanel>
  if (ask.kind === 'sources') {
    return (
      <SidePanel open onClose={onClose} label="Sources" title="Where these trips come from">
        <ul className="grid gap-2 text-[13px] leading-5 text-text-2" data-source-list="">
          {answer.sources.map((s) => <li key={s.id} data-source={s.id} className={s.rows === null ? 'text-[var(--danger)]' : ''}>{sourceLine(s)}</li>)}
        </ul>
        <p className="mt-4 text-[12px] leading-5 text-text-3">{answer.rule}</p>
      </SidePanel>
    )
  }
  if (ask.kind === 'trip-new') {
    return (
      <SidePanel open onClose={onClose} label="Trip" title="New trip">
        <TransportTripNew client={{ key: answer.client.client_key, name: answer.client.name }} day={ask.day} onClose={onClose}
          onFiled={(id) => onAsk({ kind: 'trip', id })} />
      </SidePanel>
    )
  }
  if (ask.kind === 'trip') return <TripSide key={ask.id} id={ask.id} trip={tripById(answer, ask.id)} answer={answer} onClose={onClose} />
  const v = answer.vehicles.rows.find((x) => x.id === ask.id) ?? null
  return (
    <SidePanel open onClose={onClose} label="Vehicle" title={v ? v.vehicle : 'Vehicle'}>
      {!v ? <p className="text-[12.5px] text-text-3">This vehicle is no longer on the latest read.</p> : (
        <div className="grid gap-4" data-vehicle-panel={v.id}>
          <dl>
            <Field label={`Availability on ${dayLabel(v.date)}`}><StatusPill status={v.status} /></Field>
            <Field label="Details">{v.details}</Field>
            <Field label="Fleet list">{v.fleet ? [v.fleet.unit, v.fleet.vehicle, v.fleet.year, v.fleet.plate, v.fleet.status].filter(Boolean).join(' · ') : 'Not on the fleet list'}</Field>
          </dl>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Bookings on {dayLabel(v.date)}</p>
            {v.bookings.length === 0 ? <p className="mt-1 text-[13px] text-text-3">None.</p> : (
              <ul className="mt-1 grid gap-1 text-[13px] text-text-1">
                {v.bookings.map((b, i) => (
                  <li key={`${b.time}-${i}`}>
                    {b.mine && b.trip_id ? (
                      <button type="button" className="text-left text-primary hover:underline" onClick={() => onAsk({ kind: 'trip', id: b.trip_id })}>{bookingLine(b)}</button>
                    ) : bookingLine(b)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Repairs naming it</p>
            {v.repairs.length === 0 ? <p className="mt-1 text-[13px] text-text-3">None on the Repairs tab.</p> : (
              <ul className="mt-1 grid gap-2 text-[13px] leading-5 text-text-1">
                {v.repairs.map((r) => (
                  <li key={r.id} data-repair={r.id}>
                    <span className="font-semibold">{dayLabel(r.date) || 'Undated'}</span> · {r.issue || r.repair_type || 'Repair'} · <StatusPill status={r.status} />
                    {r.resolution && <span className="block text-[12px] text-text-3">{r.resolution}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </SidePanel>
  )
}

/** A trip in the right panel: one the Transportation app holds opens straight in that app's own panel to change it, for
 * whoever changes trips; any other trip (or any trip, for anyone else) shows its facts. */
function TripSide({ id, trip: t, answer, onClose }: { id: string; trip: Trip | null; answer: TransportAnswer; onClose: () => void }) {
  const reader = useClientReader()
  // the master's, or a holder's of the transportation edition (Settings › Editions); a trip just asked for is the
  // Transportation app's before this read carries it
  const edits = (t ? t.source === 'vehicle_calendar' : VC_TRIP.test(id)) && clientCan(reader, 'clients.transportation')
  if (edits) {
    return (
      <SidePanel open onClose={onClose} label="Trip" title="Trip details & assignment">
        <TransportTripEdit client={answer.client.client_key} tripId={id} onClose={onClose} />
      </SidePanel>
    )
  }
  return (
    <SidePanel open onClose={onClose} label="Trip" title={t ? t.record : 'Trip'}>
      {!t ? <p className="text-[12.5px] text-text-3">This trip is no longer on the latest read.</p> : (
        <dl data-trip-panel={t.id}>
          <Field label="Status"><StatusPill status={t.status} /></Field>
          <Field label="Date">{dayLabel(t.date)}</Field>
          <Field label="Reserved time">{t.reserved_time ? `${t.reserved_time} Eastern Time` : ''}</Field>
          <Field label="Vehicle">{t.vehicle || 'No vehicle booked'}</Field>
          <Field label="Why">{t.reason}</Field>
          <Field label="Destination">{t.destination}</Field>
          <Field label="Doctor">{t.dr_name}</Field>
          <Field label="Visit address">{t.dr_address !== t.destination ? t.dr_address : ''}</Field>
          <Field label="Requested by">{t.staff}</Field>
          <Field label="Requested">{t.requested_at ? `${t.requested_at}${t.requests > 1 ? ` · filed ${t.requests} times` : ''}` : ''}</Field>
          <Field label="Conflict">{t.conflict ? `${t.conflict}${t.conflict_time ? ` · ${t.conflict_time}` : ''}` : ''}</Field>
          <Field label="Book status">{t.book_status}</Field>
          <Field label="Source">{`${SOURCE_LABEL[t.source] ?? t.source}${t.sheet_row ? ` · row ${t.sheet_row}` : ''}${t.realigned ? ' · read one column over' : ''}`}</Field>
        </dl>
      )}
      <p className="mt-4 text-[12px] leading-5 text-text-3">{answer.rule}</p>
    </SidePanel>
  )
}
