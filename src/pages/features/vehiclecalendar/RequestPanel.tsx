// New request — a staff member asks for a vehicle.
// The directors are asked in My Work and by text; the first answer decides, and the requester is told either way.
import { useState } from 'react'
import { Send } from 'lucide-react'
import {
  CLIENT_TRIP_TYPES, MAX_DETAILS, OTHER_TRIP, clientTripType, namesWords, requestErrors, vehicleAt, wallOf, wallToMs, type Board, type RequestForm, type WallParts,
  type WriteAnswer,
} from './vehicleCalendarModel'
import { requestTrip, saidOf } from './vehicleCalendarLane'
import { AREA, CheckLine, FIELD, Field, Muted, PanelActions, Refusal, TwoPress, VerdictLine, WallInput } from './parts'

export const REQUEST_SUBLINE = 'All dates and times are Eastern Time.'

/** Why this viewer cannot ask, or ''. */
export function requestClosedWhy(board: Board): string {
  if (board.viewer.visiting) return 'Request transport from your own account — not while visiting someone else.'
  if (!board.settings.directors_readable) {
    return `Nobody is set to approve vehicle requests${board.settings.directors_why ? `: ${board.settings.directors_why.replace(/\.$/, '')}` : ''}.`
  }
  if (!board.viewer.can_request) return 'Requests are not open to you here.'
  return ''
}

export default function RequestPanel({ board, onDone, onCancel, client, day }: {
  board: Board
  onDone: (answer: WriteAnswer) => void
  onCancel: () => void
  /** the client the trip is for, fixed (a client's own page asks for its trips) */
  client?: { key: string; name: string }
  /** the day the trip starts on, pressed on a calendar */
  day?: string
}) {
  const own = board.people.find((p) => p.uid && p.uid === board.viewer.uid)
  const [vehicleId, setVehicleId] = useState('')
  const [staffKey, setStaffKey] = useState(own?.key ?? '')
  const [start, setStart] = useState<WallParts>({ date: day || board.today, hour: '', minute: '00', ampm: 'AM' })
  const [end, setEnd] = useState<WallParts>({ date: day || board.today, hour: '', minute: '00', ampm: 'AM' })
  const [clientKey, setClientKey] = useState(client?.key ?? '')
  const [tripType, setTripType] = useState('')
  const [otherType, setOtherType] = useState('')
  // a client's own page offers its own trip types, Other filled in
  const types: readonly string[] = client ? [...CLIENT_TRIP_TYPES, OTHER_TRIP] : board.settings.trip_types
  const [details, setDetails] = useState('')
  const [wheelchair, setWheelchair] = useState(false)
  const [tried, setTried] = useState(false)
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')

  const closed = requestClosedWhy(board)
  const form: RequestForm = {
    vehicle_id: vehicleId, staff_key: staffKey, client_key: clientKey,
    trip_type: client ? clientTripType(tripType, otherType) : tripType, details,
    wheelchair_required: wheelchair,
    start: wallOf(start.date, start.hour, start.minute, start.ampm),
    end: wallOf(end.date, end.hour, end.minute, end.ampm),
  }
  const errors = requestErrors(form, board.vehicles)
  const ok = Object.keys(errors).length === 0
  const shown = tried ? errors : {}
  const vehicle = board.vehicles.find((v) => v.id === vehicleId) ?? null
  const s = wallToMs(form.start)
  const e = wallToMs(form.end)
  const verdict = vehicle ? vehicleAt(vehicle, board.trips, s, e, { wheelchair }) : null
  const directors = namesWords(board.settings.directors.filter((d) => d.uid !== board.viewer.uid).map((d) => d.name))
  const clientsUnread = board.sources.find((x) => x.key === 'clients' && x.state !== 'ready')

  const send = async () => {
    setBusy(true)
    setRefusal('')
    try {
      const answer = await requestTrip({
        vehicle_id: form.vehicle_id, staff_key: form.staff_key, start: form.start, end: form.end, trip_type: form.trip_type,
        ...(form.client_key ? { client_key: form.client_key } : {}),
        ...(form.details.trim() ? { details: form.details.trim() } : {}),
        ...(form.wheelchair_required ? { wheelchair_required: true } : {}),
      })
      onDone(answer)
    } catch (err) {
      setRefusal(saidOf(err))
    } finally {
      setBusy(false)
      setArmed('')
    }
  }

  const onArm = (next: string, act: boolean) => {
    setTried(true)
    if (!ok) { setArmed(''); return }
    setArmed(next)
    if (act) void send()
  }

  return (
    <div className="mt-1 grid gap-4" data-request-panel="">
      <Muted>{REQUEST_SUBLINE}</Muted>
      {closed && <Refusal>{closed}</Refusal>}
      <Field label="Vehicle" error={shown.vehicle_id}>
        <select value={vehicleId} onChange={(ev) => { setVehicleId(ev.target.value); setArmed('') }} className={FIELD} data-field="vehicle">
          <option value="">Choose vehicle</option>
          {board.vehicles.map((v) => (
            <option key={v.id} value={v.id} disabled={v.availability !== 'available'}>
              {v.name}{v.details ? ` — ${v.details}` : ''}{v.availability === 'maintenance' ? ' (maintenance)' : v.availability === 'out_of_service' ? ' (out of service)' : ''}
            </option>
          ))}
        </select>
      </Field>
      {verdict && <div className="-mt-3"><VerdictLine verdict={verdict} prefix="For this time:" /></div>}
      <Field label="Staff Name" error={shown.staff_key}>
        <select value={staffKey} onChange={(ev) => { setStaffKey(ev.target.value); setArmed('') }} className={FIELD} data-field="staff">
          <option value="">Choose staff member</option>
          {board.people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
      </Field>
      <WallInput id="start" label="Start date and time" value={start} min={board.today} error={shown.start}
        onChange={(next) => {
          setStart(next)
          if (next.date && (!end.date || end.date < next.date)) setEnd({ ...end, date: next.date })
          setArmed('')
        }} />
      <WallInput id="end" label="End date and time" value={end} min={start.date || board.today} error={shown.end}
        onChange={(next) => { setEnd(next); setArmed('') }} />
      {client ? (
        <Field label="Client">
          <input value={client.name} readOnly className={FIELD} data-field="client" data-client-fixed={client.key} />
        </Field>
      ) : (
        <Field label="Client" hint={clientsUnread ? `The client list could not be read${clientsUnread.why ? ` — ${clientsUnread.why}` : ''}.` : 'Optional.'}>
          <select value={clientKey} onChange={(ev) => setClientKey(ev.target.value)} className={FIELD} data-field="client">
            <option value="">Choose a client</option>
            {board.clients.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Trip type" error={shown.trip_type}>
        <select value={tripType} onChange={(ev) => { setTripType(ev.target.value); setArmed('') }} className={FIELD} data-field="trip-type">
          <option value="">Choose trip type</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      {client && tripType === OTHER_TRIP && (
        <Field label="Other trip type">
          <input value={otherType} maxLength={50} onChange={(ev) => { setOtherType(ev.target.value); setArmed('') }} className={FIELD}
            data-field="trip-type-other" placeholder="What the trip is for" />
        </Field>
      )}
      <CheckLine id="wheelchair" checked={wheelchair} onChange={(v) => { setWheelchair(v); setArmed('') }}>
        Wheelchair-accessible vehicle required
      </CheckLine>
      <Field label="Trip details" error={shown.details} hint={`${details.length} / ${MAX_DETAILS}`}>
        <textarea value={details} onChange={(ev) => setDetails(ev.target.value)} rows={4} className={AREA} data-field="details"
          placeholder="Where to, what for, any support needs" />
      </Field>
      <Muted>
        {directors ? `${directors} ${board.settings.directors.length > 1 ? 'are' : 'is'} asked in My Work and by text; the first answer decides, and you are told either way.` : ''}
      </Muted>
      <Refusal>{refusal}</Refusal>
      <PanelActions onCancel={onCancel}>
        <TwoPress id="submit" armed={armed} busy={busy} disabled={Boolean(closed)} icon={<Send size={14} />}
          label="Submit request" armedLabel={directors ? `Send to ${directors}` : 'Send the request'} onArm={onArm} />
      </PanelActions>
    </div>
  )
}
