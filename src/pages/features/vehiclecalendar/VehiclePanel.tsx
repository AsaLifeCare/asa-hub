// Add vehicle / Edit vehicle, for the directors (and transportation.vehicles): its name, what it is, its seats, its…
// Before the press, the panel says which scheduled trips go back to Needs assignment.
import { useState } from 'react'
import { Save } from 'lucide-react'
import { spanOf, whenWords, type Availability, type Board, type Trip, type Vehicle, type WriteAnswer } from './vehicleCalendarModel'
import { saidOf, saveVehicle, type VehicleSavePayload } from './vehicleCalendarLane'
import { CheckLine, FIELD, Fact, Field, Muted, PanelActions, Refusal, StatusPill, TwoPress } from './parts'

export const OUT_OF_SERVICE_NOTE = 'Taking this resource out of service returns its scheduled trips to Needs assignment for review.'

const AVAILABILITY: { id: Availability; label: string }[] = [
  { id: 'available', label: 'Available' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'out_of_service', label: 'Out of service' },
]

type Draft = { name: string; description: string; seats: string; wheelchair: boolean; availability: Availability; note: string }

const draftOf = (v: Vehicle | null): Draft => ({
  name: v?.name ?? '',
  description: v?.description ?? '',
  seats: v ? String(v.seats || '') : '5',
  wheelchair: v?.wheelchair_accessible ?? false,
  availability: v?.availability ?? 'available',
  note: '',
})

/** The scheduled trips still ahead that a change would hand back to Needs assignment. */
export function tripsReturned(vehicle: Vehicle | null, trips: Trip[], next: { availability: Availability; wheelchair: boolean }, nowMs: number): Trip[] {
  if (!vehicle) return []
  const ahead = trips.filter((t) => t.state === 'scheduled' && t.vehicle_id === vehicle.id && spanOf(t).e > nowMs)
  if (next.availability !== 'available' && vehicle.availability === 'available') return ahead
  if (vehicle.wheelchair_accessible && !next.wheelchair) return ahead.filter((t) => t.wheelchair_required)
  return []
}

export function vehicleChanges(v: Vehicle | null, d: Draft): VehicleSavePayload | null {
  const seats = Number(d.seats)
  const p: VehicleSavePayload = {
    ...(v ? { vehicle_id: v.id } : {}),
    name: d.name.trim(), description: d.description.trim(), seats,
    wheelchair_accessible: d.wheelchair, availability: d.availability,
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
  }
  if (!v) return p
  const same = p.name === v.name && p.description === v.description && seats === v.seats
    && d.wheelchair === v.wheelchair_accessible && d.availability === v.availability
  // a note alone is a change too: it is kept on the vehicle and in its log
  return same && !p.note ? null : p
}

export default function VehiclePanel({ board, vehicle, isNew, canEdit, onDone, onCancel }: {
  board: Board
  vehicle: Vehicle | null
  isNew: boolean
  /** the directors, or a person transportation.vehicles lists; the board's own word when not said */
  canEdit?: boolean
  onDone: (answer: WriteAnswer) => void
  onCancel: () => void
}) {
  const [d, setD] = useState<Draft>(() => draftOf(isNew ? null : vehicle))
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const set = (patch: Partial<Draft>) => { setD((x) => ({ ...x, ...patch })); setArmed('') }

  if (!isNew && !vehicle) return <Muted className="mt-2">This vehicle is not on the latest read.</Muted>
  if (!(canEdit ?? board.viewer.can_edit) && vehicle) return <VehicleFacts board={board} vehicle={vehicle} />

  const seats = Number(d.seats)
  const nameTaken = board.vehicles.some((x) => x.id !== vehicle?.id && x.name.trim().toLowerCase() === d.name.trim().toLowerCase())
  const wrong = !d.name.trim() ? 'Name the vehicle.'
    : nameTaken ? `Another vehicle is already named ${d.name.trim()}.`
      : !Number.isInteger(seats) || seats < 1 || seats > 60 ? 'Seats must be a whole number from 1 to 60.' : ''
  const changes = vehicleChanges(isNew ? null : vehicle, d)
  const nowMs = Number.isFinite(Date.parse(board.now)) ? Date.parse(board.now) : Date.now()
  const returned = tripsReturned(isNew ? null : vehicle, board.trips, { availability: d.availability, wheelchair: d.wheelchair }, nowMs)

  const apply = async () => {
    if (!changes || wrong) return
    setBusy(true)
    setRefusal('')
    try {
      onDone(await saveVehicle(changes))
    } catch (err) {
      setRefusal(saidOf(err))
    } finally {
      setBusy(false)
      setArmed('')
    }
  }

  return (
    <div className="mt-1 grid gap-4" data-vehicle-panel={vehicle?.id ?? 'new'}>
      <Field label="Name">
        <input value={d.name} onChange={(e) => set({ name: e.target.value })} className={FIELD} placeholder="Van" data-field="name" />
      </Field>
      <Field label="Description / capacity">
        <input value={d.description} onChange={(e) => set({ description: e.target.value })} className={FIELD} placeholder="Wheelchair-accessible van" data-field="description" />
      </Field>
      <Field label="Seats">
        <input inputMode="numeric" value={d.seats} onChange={(e) => set({ seats: e.target.value.replace(/[^\d]/g, '') })} className={FIELD} data-field="seats" />
      </Field>
      <CheckLine id="accessible" checked={d.wheelchair} onChange={(v) => set({ wheelchair: v })}>Wheelchair accessible</CheckLine>
      <Field label="Availability">
        <select value={d.availability} onChange={(e) => set({ availability: e.target.value as Availability })} className={FIELD} data-field="availability">
          {AVAILABILITY.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </Field>
      <Muted>{OUT_OF_SERVICE_NOTE}</Muted>
      {returned.length > 0 && (
        <div className="rounded-[12px] bg-tint-amber px-3 py-2.5 text-[12.5px] leading-5 text-tint-fg-amber" data-returned={returned.length}>
          <p className="font-semibold">{returned.length} scheduled trip{returned.length === 1 ? '' : 's'} will go back to Needs assignment:</p>
          <ul className="mt-1 grid gap-0.5">
            {returned.slice(0, 6).map((t) => <li key={t.id}>{whenWords(t.start_at, t.end_at)}{t.purpose ? ` · ${t.purpose}` : ''}</li>)}
            {returned.length > 6 && <li>and {returned.length - 6} more</li>}
          </ul>
        </div>
      )}
      {!isNew && (
        <Field label="Note (optional)" hint="Kept in the vehicle's log, e.g. why it went to maintenance.">
          <input value={d.note} onChange={(e) => set({ note: e.target.value })} className={FIELD} data-field="note" />
        </Field>
      )}
      {d.name.trim() && wrong && <Refusal>{wrong}</Refusal>}
      <Refusal>{refusal}</Refusal>
      <PanelActions onCancel={onCancel}>
        <TwoPress id="apply" armed={armed} busy={busy} disabled={!changes || Boolean(wrong)} tone="primary" icon={<Save size={14} />}
          label={isNew ? 'Add vehicle' : changes ? 'Apply' : 'Nothing to apply'} armedLabel={isNew ? 'Add it' : 'Apply the changes'}
          onArm={(a, act) => { setArmed(a); if (act) void apply() }} />
      </PanelActions>
    </div>
  )
}

function VehicleFacts({ board, vehicle }: { board: Board; vehicle: Vehicle }) {
  const next = vehicle.active_trip ?? vehicle.next_trip
  return (
    <dl className="mt-1" data-vehicle-facts={vehicle.id}>
      <Fact label="Status"><StatusPill word={vehicle.status.word || 'Available'} tone={vehicle.status.word ? vehicle.status.tone : 'mint'} /></Fact>
      <Fact label="Details">{vehicle.details || vehicle.description}</Fact>
      <Fact label={vehicle.active_trip ? 'Active trip' : 'Next booking'}>{next ? whenWords(next.start_at, next.end_at) : 'None ahead'}</Fact>
      <Fact label="Seats">{vehicle.seats ? String(vehicle.seats) : ''}</Fact>
      <Fact label="Requests approved by">{board.settings.directors.map((x) => x.name).join(', ')}</Fact>
    </dl>
  )
}
