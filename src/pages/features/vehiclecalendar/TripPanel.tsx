// Trip details & assignment.
// What a viewer sees of one trip, and what they may do with it, all inside the panel: a director holding the…
import { useState } from 'react'
import { Link } from 'react-router'
import { Check, ExternalLink, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TRANSPORT_EDITIONS, clientHref, driverAt, easternWall, momentWords, namesWords, partsOfWall, spanOf, stepsOf, vehicleAt,
  waitingOn, wallOf, wallToMs, whenWords, type Board, type Trip, type TripState, type WallParts, type WriteAnswer,
} from './vehicleCalendarModel'
import { answerTrip, saidOf, saveTrip, useTransportEditions, withdrawTrip, type TripSavePayload } from './vehicleCalendarLane'
import { useTestWarningsHidden } from '@/lib/myWorkHides'
import {
  AREA, CheckLine, FIELD, Fact, Field, Muted, PanelActions, PersonLine, Refusal, StatusPill, StepBar, TwoPress, WallInput,
} from './parts'

export const TRIP_SUBLINE = 'All dates and times are Eastern Time. A request reserves a vehicle once a director approves it.'
export const PRIVATE_LINE = 'Private trip details appear in the client workspace or manager views.'
const ASSIGN_NOTE = 'The full reservation includes waiting and return travel. Choose Scheduled to reserve these resources.'

/** A write landed: its answer, whose board replaces the held one; the panel stays on the trip. */
type Done = (answer: WriteAnswer) => void

export default function TripPanel({ board, trip, isMaster, onDone, onClose, save }: {
  board: Board
  trip: Trip | null
  isMaster: boolean
  onDone: Done
  onClose: () => void
  /** a host's own Apply (Clients' strip): it sends the save and speaks for its refusals */
  save?: (p: TripSavePayload) => Promise<WriteAnswer>
}) {
  const editions = useTransportEditions()
  const noTest = useTestWarningsHidden()
  if (!trip) {
    return <Muted className="mt-2">This trip is not on the latest read — it may have been withdrawn, or it is not open to you.</Muted>
  }
  const item = board.waiting.find((w) => w.trip_id === trip.id) ?? null
  const final = trip.state === 'declined' || trip.state === 'cancelled'
  // the directors, or a Clients holder of clients.transportation for the client this board was asked for
  const wide = board.viewer.can_edit || (!!board.viewer.client && trip.client_key === board.viewer.client)
  // a person transportation.trips lists: any trip but a request still waiting on the directors
  const listed = !wide && !board.viewer.visiting && editions.includes(TRANSPORT_EDITIONS.trips) && trip.state !== 'requested'
  const editor = (wide || listed) && !trip.private
  return (
    <div className="mt-1 grid gap-4" data-trip-panel={trip.id}>
      <Muted>{TRIP_SUBLINE}</Muted>
      <div className="grid gap-2 rounded-[14px] border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill word={trip.word} tone={trip.tone} />
          {trip.test_mode && !noTest && <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold text-tint-fg-amber">Test mode</span>}
        </div>
        <p className="text-[14px] font-semibold text-text-1" data-trip-when="">
          {trip.vehicle_name || trip.requested_vehicle_name || 'Vehicle'} · {whenWords(trip.start_at, trip.end_at)}
        </p>
        {!trip.private && <StepBar steps={stepsOf(trip, board.settings)} />}
      </div>

      {trip.private ? (
        <div className="grid gap-2">
          <dl>
            <Fact label="Vehicle">{trip.vehicle_name}</Fact>
            <Fact label="Reserved">{whenWords(trip.start_at, trip.end_at)}</Fact>
            <Fact label="Trip">Booked</Fact>
          </dl>
          <Muted>{PRIVATE_LINE}</Muted>
        </div>
      ) : (
        <>
          {item && <DecideBox board={board} trip={trip} itemId={item.item_id} onDone={onDone} />}
          {!item && trip.state === 'requested' && (isMaster || board.viewer.can_edit) && (
            <p className="rounded-[12px] bg-tint-amber px-3 py-2.5 text-[12.5px] leading-5 text-tint-fg-amber" data-waiting-on="">
              Waiting on {namesWords(waitingOn(trip, board.settings)) || 'the directors'} — the first answer decides.
            </p>
          )}
          {trip.state === 'requested' && trip.requested_by.uid === board.viewer.uid && !board.viewer.visiting && (
            <WithdrawBox trip={trip} onDone={onDone} />
          )}
          <People trip={trip} />
          {editor && !final
            // a trip changed on the board (answered, saved elsewhere) starts a fresh draft
            ? <AssignForm key={`${trip.id}|${trip.state}|${trip.updated_at}`} board={board} trip={trip} listed={listed} onDone={onDone} onCancel={onClose} save={save} />
            : <ReadOnly trip={trip} linkClient={board.viewer.can_edit} />}
        </>
      )}
    </div>
  )
}

function People({ trip }: { trip: Trip }) {
  const decidedWord = trip.state === 'declined' ? 'Declined' : 'Approved'
  return (
    <div className="grid gap-2.5 rounded-[14px] border border-border bg-surface p-3" data-people="">
      <PersonLine name={trip.requested_by.name} size="sm"
        line={['Requested', momentWords(trip.created_at), trip.source.startsWith('import') ? '· imported from the Van Calendar' : ''].filter(Boolean).join(' ')} />
      {trip.decided_by && <PersonLine name={trip.decided_by} size="sm" line={`${decidedWord}${trip.decided_at ? ` ${momentWords(trip.decided_at)}` : ''}`} />}
      {trip.staff_name && trip.staff_name !== trip.requested_by.name && <PersonLine name={trip.staff_name} size="sm" line="Staff member" />}
      {trip.driver_name && trip.driver_name !== trip.staff_name && <PersonLine name={trip.driver_name} size="sm" line="Driver" />}
    </div>
  )
}

function ReadOnly({ trip, linkClient }: { trip: Trip; linkClient: boolean }) {
  return (
    <dl data-trip-facts="">
      <Fact label="Reserved">{`${whenWords(trip.start_at, trip.end_at)}${trip.end_known ? '' : ' (the end is not on the Van Calendar)'}`}</Fact>
      <Fact label="Vehicle">{trip.vehicle_name}</Fact>
      <Fact label="Requested vehicle">{trip.requested_vehicle_name !== trip.vehicle_name ? trip.requested_vehicle_name : ''}</Fact>
      <Fact label="Client">
        {trip.client_name && linkClient && trip.client_key
          ? <Link to={clientHref(trip.client_key)} className="inline-flex items-center gap-1 text-primary hover:underline">{trip.client_name} <ExternalLink size={12} /></Link>
          : trip.client_name}
      </Fact>
      <Fact label="Trip type">{trip.trip_type}</Fact>
      <Fact label="Purpose">{trip.purpose}</Fact>
      <Fact label="Destination">{trip.destination}</Fact>
      <Fact label="Wheelchair-accessible vehicle">{trip.wheelchair_required ? 'Required' : ''}</Fact>
      <Fact label="Trip details / support needs">{trip.details}</Fact>
      <Fact label="Decision note">{trip.decision_note}</Fact>
      <Fact label="Assignment note">{trip.assign_note}</Fact>
    </dl>
  )
}

/* ---------- the seat's answer ---------- */

function DecideBox({ board, trip, itemId, onDone }: { board: Board; trip: Trip; itemId: string; onDone: Done }) {
  const [note, setNote] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState('')
  const [refusal, setRefusal] = useState('')
  const others = namesWords(waitingOn(trip, board.settings).filter((n) => n !== board.viewer.name))
  const vehicle = board.vehicles.find((v) => v.id === (trip.requested_vehicle_id || trip.vehicle_id)) ?? null
  const span = spanOf(trip)
  const verdict = vehicle ? vehicleAt(vehicle, board.trips, span.s, span.e, { wheelchair: trip.wheelchair_required, except: trip.id }) : null

  const answer = async (word: 'approve' | 'decline') => {
    setBusy(word)
    setRefusal('')
    try {
      const got = await answerTrip(itemId, word, note)
      onDone(got)
    } catch (err) {
      setRefusal(saidOf(err))
    } finally {
      setBusy('')
      setArmed('')
    }
  }

  return (
    <section className="grid gap-2.5 rounded-[14px] border border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-primary-soft/40 p-3" data-decide={itemId}>
      <p className="text-[13px] font-semibold text-text-1">This request waits on your answer</p>
      <Muted>{others ? `${others} ${others.includes(' and ') ? 'were' : 'was'} asked too — ` : ''}the first answer decides, and the requester is told either way.</Muted>
      {verdict && verdict.word !== 'Available' && verdict.word !== 'Requested' && (
        <p className="rounded-[10px] bg-tint-amber px-2.5 py-2 text-[12px] leading-5 text-tint-fg-amber" data-approve-warning="">
          {verdict.why} Approved now, the trip goes to Needs assignment for a vehicle to be chosen.
        </p>
      )}
      <Field label="Note (optional)">
        <textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={2} className={AREA}
          placeholder="Said to the requester with the answer" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <TwoPress id="approve" armed={armed} busy={busy === 'approve'} disabled={Boolean(busy)} icon={<Check size={14} />}
          label="Approve" armedLabel="Approve"
          onArm={(a, act) => { setArmed(a); if (act) void answer('approve') }} />
        <TwoPress id="decline" armed={armed} busy={busy === 'decline'} disabled={Boolean(busy)} icon={<X size={14} />} tone="outline"
          label="Decline" armedLabel="Decline"
          onArm={(a, act) => { setArmed(a); if (act) void answer('decline') }} />
      </div>
      <Refusal>{refusal}</Refusal>
    </section>
  )
}

function WithdrawBox({ trip, onDone }: { trip: Trip; onDone: Done }) {
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const go = async () => {
    setBusy(true)
    setRefusal('')
    try {
      onDone(await withdrawTrip(trip.id))
    } catch (err) {
      setRefusal(saidOf(err))
    } finally {
      setBusy(false)
      setArmed('')
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-border bg-surface p-3" data-withdraw="">
      <Muted>Changed your mind? Withdraw it while it waits; nobody is texted.</Muted>
      <TwoPress id="withdraw" armed={armed} busy={busy} icon={<Undo2 size={14} />} tone="outline" label="Withdraw" armedLabel="Withdraw the request"
        onArm={(a, act) => { setArmed(a); if (act) void go() }} />
      <Refusal>{refusal}</Refusal>
    </div>
  )
}

/* ---------- the directors' assignment ---------- */

type Status = Exclude<TripState, 'requested' | 'declined'>
const STATUS_WORDS: { id: Status; label: string }[] = [
  { id: 'needs_assignment', label: 'Needs assignment' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'cancelled', label: 'Cancelled' },
]

type Draft = {
  status: TripState
  vehicle_id: string
  staff_key: string
  driver_key: string
  client_key: string
  trip_type: string
  purpose: string
  destination: string
  details: string
  wheelchair: boolean
  start: WallParts
  end: WallParts
  note: string
}

export function draftOf(trip: Trip): Draft {
  return {
    status: trip.state,
    vehicle_id: trip.vehicle_id || trip.requested_vehicle_id,
    staff_key: trip.staff_key,
    driver_key: trip.driver_key || trip.staff_key,
    client_key: trip.client_key,
    trip_type: trip.trip_type,
    purpose: trip.purpose,
    destination: trip.destination,
    details: trip.details,
    wheelchair: trip.wheelchair_required,
    start: partsOfWall(easternWall(trip.start_at)),
    end: partsOfWall(easternWall(trip.end_at)),
    note: '',
  }
}

/** Only what changed, so a save never rewrites a field nobody touched. */
export function tripChanges(trip: Trip, d: Draft): TripSavePayload | null {
  const p: TripSavePayload = { trip_id: trip.id }
  const statusChanged = trip.state !== 'requested' && d.status !== trip.state && STATUS_WORDS.some((w) => w.id === d.status)
  if (statusChanged) p.status = d.status as Status
  const reserving = (statusChanged ? d.status : trip.state) === 'scheduled'
  if (trip.state !== 'requested' && d.vehicle_id && (d.vehicle_id !== trip.vehicle_id || (reserving && statusChanged))) p.vehicle_id = d.vehicle_id
  if (d.staff_key !== trip.staff_key && d.staff_key) p.staff_key = d.staff_key
  if (d.driver_key !== (trip.driver_key || trip.staff_key) && d.driver_key) p.driver_key = d.driver_key
  if (d.client_key !== trip.client_key) p.client_key = d.client_key
  if (d.trip_type !== trip.trip_type && d.trip_type) p.trip_type = d.trip_type
  if (d.purpose !== trip.purpose) p.purpose = d.purpose
  if (d.destination !== trip.destination) p.destination = d.destination
  if (d.details !== trip.details) p.details = d.details
  if (d.wheelchair !== trip.wheelchair_required) p.wheelchair_required = d.wheelchair
  const start = wallOf(d.start.date, d.start.hour, d.start.minute, d.start.ampm)
  const end = wallOf(d.end.date, d.end.hour, d.end.minute, d.end.ampm)
  if (start && start !== easternWall(trip.start_at)) p.start = start
  if (end && end !== easternWall(trip.end_at)) p.end = end
  if (d.note.trim()) p.note = d.note.trim()
  return Object.keys(p).length > 1 ? p : null
}

function AssignForm({ board, trip, listed = false, onDone, onCancel, save }: {
  board: Board
  trip: Trip
  /** offered by transportation.trips alone: a cancel the requester is texted about stays the directors' */
  listed?: boolean
  onDone: Done
  onCancel: () => void
  save?: (p: TripSavePayload) => Promise<WriteAnswer>
}) {
  const [d, setD] = useState<Draft>(() => draftOf(trip))
  // a holder's trip stays with its client
  const clientFixed = !board.viewer.can_edit && !listed && !!board.viewer.client
  const told = Boolean(trip.requested_by.uid)
  const statuses = STATUS_WORDS.filter((w) => w.id !== 'cancelled' || !listed || !told)
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const set = (patch: Partial<Draft>) => { setD((x) => ({ ...x, ...patch })); setArmed('') }
  const waiting = trip.state === 'requested'
  const s = wallToMs(wallOf(d.start.date, d.start.hour, d.start.minute, d.start.ampm))
  const e = wallToMs(wallOf(d.end.date, d.end.hour, d.end.minute, d.end.ampm))
  const timeWrong = !Number.isFinite(s) || !Number.isFinite(e) ? 'Choose a start and an end that exist in Eastern Time.' : e <= s ? 'The end must be after the start.' : ''
  const opts = { wheelchair: d.wheelchair, except: trip.id }
  const chosen = board.vehicles.find((v) => v.id === d.vehicle_id) ?? null
  const vehicleVerdict = chosen ? vehicleAt(chosen, board.trips, s, e, opts) : null
  const driverVerdict = driverAt(d.driver_key, board.trips, s, e, { except: trip.id, drivers: board.drivers })
  // scheduling is held back only by what the server refuses: a booked vehicle or driver, or a driver not cleared
  const driverHeld = driverAt(d.driver_key, board.trips, s, e, { except: trip.id, drivers: board.drivers, states: ['scheduled'] })
  const changes = tripChanges(trip, d)
  const scheduleBlocked = d.status === 'scheduled' && !waiting ? (!chosen ? 'Choose a vehicle to schedule the trip.'
    : vehicleVerdict && !['Available', 'Requested'].includes(vehicleVerdict.word) ? vehicleVerdict.why
      : ['Not cleared to drive', 'Has a trip then'].includes(driverHeld.word) ? `${nameOfKey(board, d.driver_key)}: ${driverHeld.why}` : '') : ''

  const apply = async () => {
    if (!changes) return
    setBusy(true)
    setRefusal('')
    try {
      // a board asked for a client names it, so the door changes only that client's trip
      const p = board.viewer.client ? { ...changes, client: board.viewer.client } : changes
      onDone(await (save ?? saveTrip)(p))
    } catch (err) {
      if (!save) setRefusal(saidOf(err))
    } finally {
      setBusy(false)
      setArmed('')
    }
  }

  return (
    <div className="grid gap-4" data-assign-form="">
      <dl><Fact label="Requested vehicle">{trip.requested_vehicle_name || '—'}</Fact></dl>
      <Field label="Staff member">
        <select value={d.staff_key} onChange={(ev) => set({ staff_key: ev.target.value })} className={FIELD} data-field="staff">
          {!board.people.some((p) => p.key === d.staff_key) && <option value={d.staff_key}>{trip.staff_name || 'Choose staff member'}</option>}
          {board.people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Client" hint={d.client_key ? (
        <Link to={clientHref(d.client_key)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline" data-client-link="">
          {board.clients.find((c) => c.key === d.client_key)?.name ?? trip.client_name} <ExternalLink size={11} />
        </Link>
      ) : trip.client_name ? `${trip.client_name} (not on the client list)` : undefined}>
        <select value={d.client_key} disabled={clientFixed} onChange={(ev) => set({ client_key: ev.target.value })} className={FIELD} data-field="client">
          <option value="">No client</option>
          {d.client_key && !board.clients.some((c) => c.key === d.client_key) && <option value={d.client_key}>{trip.client_name || d.client_key}</option>}
          {board.clients.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Trip type">
        <select value={d.trip_type} onChange={(ev) => set({ trip_type: ev.target.value })} className={FIELD} data-field="trip-type">
          {!board.settings.trip_types.includes(d.trip_type) && <option value={d.trip_type}>{d.trip_type || 'Choose trip type'}</option>}
          {board.settings.trip_types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Purpose"><input value={d.purpose} onChange={(ev) => set({ purpose: ev.target.value })} className={FIELD} data-field="purpose" /></Field>
        <Field label="Destination"><input value={d.destination} onChange={(ev) => set({ destination: ev.target.value })} className={FIELD} data-field="destination" /></Field>
      </div>
      <WallInput id="pickup" label="Pickup / reservation start" value={d.start}
        onChange={(next) => set({ start: next, ...(next.date && d.end.date < next.date ? { end: { ...d.end, date: next.date } } : {}) })} />
      <WallInput id="return" label="Return / reservation end" value={d.end} min={d.start.date} error={timeWrong || undefined}
        onChange={(next) => set({ end: next })} />
      {!trip.end_known && <Muted className="-mt-2">The Van Calendar carried no end for this trip; the end shown is assumed.</Muted>}
      <CheckLine id="wheelchair" checked={d.wheelchair} onChange={(v) => set({ wheelchair: v })}>Wheelchair-accessible vehicle required</CheckLine>
      <Field label="Trip status" hint={waiting ? 'A waiting request is approved or declined by the directors — not set here.' : undefined}>
        <select value={waiting ? 'requested' : d.status} disabled={waiting} onChange={(ev) => set({ status: ev.target.value as TripState })} className={FIELD} data-field="status">
          {waiting && <option value="requested">Requested</option>}
          {statuses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </Field>

      <section className="grid gap-3 rounded-[14px] border border-border bg-surface-2/50 p-3" data-availability-box="">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Availability for this time</p>
        <Field label="Vehicle">
          <select value={d.vehicle_id} disabled={waiting} onChange={(ev) => set({ vehicle_id: ev.target.value })} className={FIELD} data-field="vehicle">
            <option value="">No vehicle</option>
            {board.vehicles.map((v) => {
              const at = vehicleAt(v, board.trips, s, e, opts)
              return <option key={v.id} value={v.id}>{v.name} · {at.word}</option>
            })}
          </select>
        </Field>
        {vehicleVerdict?.why && <p className="-mt-2 text-[12px] leading-4 text-text-2">{vehicleVerdict.why}</p>}
        <Field label="Driver">
          <select value={d.driver_key} onChange={(ev) => set({ driver_key: ev.target.value })} className={FIELD} data-field="driver">
            {!board.people.some((p) => p.key === d.driver_key) && <option value={d.driver_key}>{trip.driver_name || 'Choose a driver'}</option>}
            {board.people.map((p) => {
              const at = driverAt(p.key, board.trips, s, e, { except: trip.id, drivers: board.drivers })
              return <option key={p.key} value={p.key}>{p.name} · {at.word}</option>
            })}
          </select>
        </Field>
        {driverVerdict.why && <p className="-mt-2 text-[12px] leading-4 text-text-2">{driverVerdict.why}</p>}
        <Muted>{ASSIGN_NOTE}</Muted>
      </section>

      <Field label="Note (optional)" hint="Kept with the change in the trip's log.">
        <input value={d.note} onChange={(ev) => set({ note: ev.target.value })} className={FIELD} data-field="note" />
      </Field>
      <Field label="Trip details / support needs">
        <textarea value={d.details} onChange={(ev) => set({ details: ev.target.value })} rows={3} className={AREA} data-field="details" />
      </Field>
      {d.status === 'cancelled' && trip.state !== 'cancelled' && (
        <p className={cn('rounded-[10px] bg-tint-danger px-3 py-2 text-[12px] leading-5 text-tint-fg-danger')}>
          {told ? `Cancelling frees the vehicle and tells ${trip.requested_by.name || 'the requester'} by text and in My Inbox.`
            : 'Cancelling frees the vehicle; nobody asked for this trip, so nobody is texted.'}
        </p>
      )}
      {scheduleBlocked && <Refusal>{scheduleBlocked}</Refusal>}
      <Refusal>{refusal}</Refusal>
      <PanelActions onCancel={onCancel}>
        <TwoPress id="apply" armed={armed} busy={busy} disabled={!changes || Boolean(timeWrong) || Boolean(scheduleBlocked)} tone="primary"
          label={changes ? 'Apply' : 'Nothing to apply'} armedLabel="Apply the changes"
          onArm={(a, act) => { setArmed(a); if (act) void apply() }} />
      </PanelActions>
    </div>
  )
}

const nameOfKey = (board: Board, key: string): string => board.people.find((p) => p.key === key)?.name ?? 'The driver'
