// Clients · Appointments: the client's booked visits as the mockup draws them — CLIENT | DATE | TIME | DR NAME | DR…
// A row opens the visit whole in the right panel, with the client's doctors from Dr Master beside it; the pencil…
import { useState } from 'react'
import { Loader2, Pencil, Plus, Stethoscope } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import SearchInput from '@/components/shared/SearchInput'
import { TintChip } from '@/pages/features/clientops/OpsPageShell'
import { Pair, RetryButton, SectionCard, linkCls } from '@/pages/features/locations/LocationParts'
import { readKey, useLocationRead, type ReadState } from '@/pages/features/locations/useLocation'
import { openAddressInPlatform } from '@/lib/maps'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import { AppointmentForm, NewAppointmentForm, NewDoctorForm } from '../ClientForms'
import { clientCan, useClientReader } from '../clientViewer'
import {
  APPOINTMENTS_ACTION, APPT_STATUSES, appointmentsOf, apptRefusal, dayLabel, doctorNext, doctorsFor, filterVisits,
  newestFirst, readAppointments, statusTint, submittedLabel, telHref, visitDay, visitsLine,
  type ApptDoctor, type ApptPanel, type ApptVisit, type Appointments, type StatusFilter,
} from './appointments'

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const SELECT = 'h-9 rounded-md border border-border bg-surface px-2.5 text-[12.5px] text-text-1 outline-none focus:border-primary'
const OUTLINE = 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2'

/** The section for one client: the read, the search, the status and the panel it opens. */
export default function AppointmentsTab({ client, clientName = '', panel, onPanel }: {
  client: string
  clientName?: string
  /** the panel, when the page keeps it in the address; held here otherwise */
  panel?: ApptPanel | null
  onPanel?: (ask: ApptPanel | null) => void
}) {
  const read = useLocationRead(client ? readKey(APPOINTMENTS_ACTION, client) : null, () => readAppointments(client),
    appointmentsOf)
  const [query, setQuery] = useState('')
  // the visits still ahead first; All statuses and Past stay one pick away
  const [status, setStatus] = useState<StatusFilter>('Upcoming')
  const [own, setOwn] = useState<ApptPanel | null>(null)
  const ask = panel !== undefined ? panel : own
  const setAsk = onPanel ?? setOwn
  return (
    <>
      <AppointmentsView state={read} query={query} status={status} onQuery={setQuery} onStatus={setStatus}
        onOpen={setAsk} onRetry={read.reload} />
      <AppointmentsPanel ask={ask} state={read} client={client} clientName={clientName || read.data?.client.name || ''}
        onOpen={setAsk} onClose={() => setAsk(null)} />
    </>
  )
}

/** Reading, or why the read did not answer; above rows held from before, a failed refresh says so. */
function ReadLine({ state, onRetry }: { state: ReadState<unknown>; onRetry: () => void }) {
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-read="loading">
        <Loader2 size={13} className="animate-spin" /> Reading the appointments…
      </p>
    )
  }
  if (state.status !== 'failed') return null
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-read="failed">
      {state.data ? `The last read of the appointments failed: ${apptRefusal(state.error)} What is shown is from the read before.`
        : `The appointments could not be read: ${apptRefusal(state.error)}`}
      <RetryButton onRetry={onRetry} busy={state.refreshing} />
    </p>
  )
}

/** A source the door could not read, said in its own words above what it could. */
function WhyLine({ why, what }: { why: string; what: string }) {
  if (!why) return null
  return (
    <p role="status" data-why={what} className="mb-3 text-[12.5px] leading-5 text-[var(--warning)]">
      Not everything could be read: {why}
    </p>
  )
}

export function AppointmentsView({ state, query, status, onQuery, onStatus, onOpen, onRetry }: {
  state: ReadState<Appointments>
  query: string
  status: StatusFilter
  onQuery: (v: string) => void
  onStatus: (v: StatusFilter) => void
  onOpen: (ask: ApptPanel) => void
  onRetry: () => void
}) {
  const data = state.data
  const all = data?.visits.rows ?? []
  const rows = newestFirst(filterVisits(all, query, status))
  const doctorCount = data ? (data.doctors.kpis ? data.doctors.kpis.total : null) : null
  // the master's own session, or a holder of the edition (Settings › Editions): New Appointment and the pencil, New Doctor
  const reader = useClientReader()
  const books = clientCan(reader, 'clients.appointments')
  const adds = clientCan(reader, 'clients.doctors')
  return (
    <SectionCard title="Appointments" sub={data ? visitsLine(data.visits.kpis) || undefined : undefined}
      extra={data ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onOpen({ kind: 'doctors' })} data-open="doctors" className={OUTLINE}>
            <Stethoscope size={14} /> Doctors on file{doctorCount !== null ? ` · ${doctorCount}` : ''}
          </button>
          {adds && (
            <button type="button" onClick={() => onOpen({ kind: 'new-doctor' })} data-open="new-doctor" className={OUTLINE}>
              <Plus size={14} /> New Doctor
            </button>
          )}
          {books && (
            <button type="button" onClick={() => onOpen({ kind: 'new-visit' })} data-open="new-visit"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover">
              <Plus size={14} /> New Appointment
            </button>
          )}
        </div>
      ) : undefined}>
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={query} onChange={onQuery} placeholder="Search appointments…" className="min-w-0 flex-1 sm:max-w-[320px]" />
        <select aria-label="Status" value={status} onChange={(e) => onStatus(e.target.value as StatusFilter)}
          className={SELECT} data-filter="status">
          <option value="">All statuses</option>
          {APPT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <ReadLine state={state} onRetry={onRetry} />
      {data && <WhyLine why={data.visits.why} what="visits" />}
      {data && rows.length === 0 && (all.length > 0 || data.visits.kpis) && (
        <p className="text-[13px] text-text-3" data-empty="">
          {all.length ? 'No appointment matches this search.' : 'No appointment on record for this client.'}
        </p>
      )}
      {rows.length > 0 && (
        <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] border-collapse text-[13px]" data-appointments="">
            <thead className="bg-surface-2/60">
              <tr>
                <th className={TH}>Client</th>
                <th className={TH}>Date</th>
                <th className={TH}>Time</th>
                <th className={TH}>Dr name</th>
                <th className={TH}>Dr address</th>
                <th className={cn(TH, 'w-12')}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} data-visit={r.id} data-status={r.status} className="cursor-pointer hover:bg-surface-2/60"
                  onClick={() => onOpen({ kind: 'visit', id: r.id })}>
                  <td className="px-3 py-3 font-medium text-text-1">{r.client || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-text-2">{visitDay(r) || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-text-2">{r.time || '—'}</td>
                  <td className="px-3 py-3 text-text-1">{r.drName || '—'}</td>
                  <td className="px-3 py-3 text-text-2">{r.drAddress || '—'}</td>
                  <td className="px-3 py-3 text-right">
                    <button type="button" data-pencil={r.id}
                      aria-label={`${r.editable && books ? 'Edit' : 'Open'} the appointment of ${visitDay(r) || 'this visit'}`}
                      onClick={(e) => { e.stopPropagation(); onOpen({ kind: r.editable && books ? 'edit' : 'visit', id: r.id }) }}
                      className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

/** The one right panel: a visit with the client's doctors, the pencil's form, the doctors alone, or a new visit's or
 * doctor's form. */
export function AppointmentsPanel({ ask, state, client = '', clientName = '', onOpen, onClose }: {
  ask: ApptPanel | null
  state: ReadState<Appointments>
  client?: string
  clientName?: string
  onOpen?: (ask: ApptPanel) => void
  onClose: () => void
}) {
  const data = state.data
  const reader = useClientReader()
  const mayWrite = clientCan(reader, 'clients.appointments')
  const visit = ask && 'id' in ask ? data?.visits.rows.find((v) => v.id === ask.id) ?? null : null
  const editing = ask?.kind === 'edit' && !!visit && mayWrite
  const booking = ask?.kind === 'new-visit' && mayWrite
  const adding = ask?.kind === 'new-doctor' && clientCan(reader, 'clients.doctors')
  const doctors = data ? doctorsFor(visit, data.doctors.rows) : []
  const title = ask?.kind === 'doctors' ? 'Doctors on file' : booking ? 'New Appointment' : adding ? 'New Doctor'
    : visit ? visit.drName || 'Doctor visit' : 'Appointment'
  const label = ask?.kind === 'doctors' ? 'Doctors' : editing ? 'Edit appointment' : booking ? clientName || 'Appointment'
    : adding ? clientName || 'Doctors' : 'Appointment'
  return (
    <SidePanel open={!!ask} onClose={onClose} label={label} title={title}>
      {!data && <p className="mt-3 text-[12.5px] text-text-3" data-read="loading">Reading the appointments…</p>}
      {data && booking && (
        <NewAppointmentForm client={client} clientName={clientName} doctors={data.doctors.rows} onDone={onClose} />
      )}
      {data && adding && (
        <NewDoctorForm client={client} clientName={clientName}
          onDone={() => (onOpen ? onOpen({ kind: 'doctors' }) : onClose())} />
      )}
      {data && ask && 'id' in ask && !visit && (
        <p className="mt-3 text-[13px] text-text-3" data-gone="">This appointment is not on the client's list any more.</p>
      )}
      {editing && visit && (
        <AppointmentForm key={visit.id} client={client} clientName={clientName} visit={visit}
          onDone={() => (onOpen ? onOpen({ kind: 'visit', id: visit.id }) : onClose())} />
      )}
      {!editing && visit && <VisitDetails visit={visit} />}
      {!editing && visit?.editable && mayWrite && onOpen && (
        <button type="button" onClick={() => onOpen({ kind: 'edit', id: visit.id })} data-edit-visit={visit.id}
          aria-label="Edit the appointment" title="Edit the appointment"
          className="mt-3 grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1">
          <Pencil size={14} />
        </button>
      )}
      {data && !editing && (ask?.kind === 'doctors' || visit) && (
        <DoctorsList doctors={doctors} mark={visit?.doctorId ?? ''} why={data.doctors.why} known={!!data.doctors.kpis} />
      )}
    </SidePanel>
  )
}

/** An address opens in the platform's centred viewer, on the map. */
function AddressButton({ address, className }: { address: string; className?: string }) {
  return (
    <button type="button" onClick={() => openAddressInPlatform(address)} data-address="" className={cn(linkCls, 'text-left', className)}>
      {address}
    </button>
  )
}

function VisitDetails({ visit }: { visit: ApptVisit }) {
  return (
    <dl className="mt-2" data-visit-detail={visit.id}>
      <Pair label="Client">{visit.client || '—'}</Pair>
      <Pair label="Date">{visitDay(visit) || '—'}</Pair>
      <Pair label="Time">{visit.time || '—'}</Pair>
      <Pair label="Dr name">{visit.drName || '—'}</Pair>
      <Pair label="Dr address">
        {visit.drAddress ? <AddressButton address={visit.drAddress} /> : '—'}
      </Pair>
      <Pair label="Wheelchair van">{visit.vanAnswer || 'Not answered'}</Pair>
      <Pair label="Status"><TintChip label={visit.status} tint={statusTint(visit.status)} /></Pair>
      <Pair label="Source">
        {visit.source || '—'}
        {visit.alsoIn.length > 0 && <span className="block text-[12px] text-text-3">Also on {visit.alsoIn.join(', ')}</span>}
      </Pair>
      <Pair label="Submitted" last>{submittedLabel(visit.submitted) || '—'}</Pair>
    </dl>
  )
}

function DoctorsList({ doctors, mark, why, known }: { doctors: ApptDoctor[]; mark: string; why: string; known: boolean }) {
  return (
    <section className="mt-5" data-doctors="">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">The client's doctors · Dr Master</h3>
      {why && <p role="status" className="mt-2 text-[12.5px] leading-5 text-[var(--warning)]" data-why="doctors">{why}</p>}
      {known && doctors.length === 0 && <p className="mt-2 text-[13px] text-text-3">No doctor is on Dr Master for this client.</p>}
      <ul className="mt-2 grid gap-2">
        {doctors.map((d) => {
          const next = doctorNext(d)
          return (
            <li key={d.id} data-doctor={d.id} data-this-visit={d.id === mark ? '' : undefined}
              className={cn('rounded-lg border border-border p-3', d.id === mark && 'border-primary')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{d.specialist || 'Specialist not on file'}</span>
                {d.status && <TintChip label={d.status} tint={statusTint(d.status)} />}
                {d.id === mark && (
                  <span className="inline-flex whitespace-nowrap rounded-full bg-tint-violet px-2 py-0.5 text-[11px] font-semibold leading-4 text-tint-fg-violet">
                    This visit's doctor
                  </span>
                )}
              </div>
              <p className="mt-1 text-[14px] font-semibold text-text-1">{d.drName || '—'}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                <div>
                  <dt className="text-text-3">Next visit</dt>
                  <dd className="text-text-1" data-next={d.nextSource}>
                    {next.label || '—'}{next.hint && <span className="block text-[11.5px] text-text-3">{next.hint}</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-3">Last seen</dt>
                  <dd className="text-text-1">{dayLabel(d.lastSeen) || d.lastVisit || '—'}</dd>
                </div>
                {d.phone && (
                  <div>
                    <dt className="text-text-3">Phone</dt>
                    <dd><a href={telHref(d.phone)} className={linkCls}>{formatPhoneDisplay(d.phone)}</a></dd>
                  </div>
                )}
                {d.fax && (
                  <div>
                    <dt className="text-text-3">Fax</dt>
                    <dd className="text-text-1">{formatPhoneDisplay(d.fax)}</dd>
                  </div>
                )}
              </dl>
              {d.address && (
                <AddressButton address={d.address} className="mt-2 block text-[12.5px]" />
              )}
              {(d.standardFreq || d.notes) && (
                <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-text-2">{[d.standardFreq, d.notes].filter(Boolean).join(' · ')}</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
