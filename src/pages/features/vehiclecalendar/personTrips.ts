// The trips Transportation holds for one client (Clients › Appointments) or one staff member as driver or companion…
// Read only: drawn at once from what this tab holds, read again behind it, on the `vehicle-calendar` ring and when…
import { useEffect, useRef, useState } from 'react'
import { onMemoryBoundary } from '@/lib/appPack'
import { onLiveEvent } from '@/lib/snapshotClient'
import { VEHICLE_CALENDAR_EVENT, readClientTrips, readStaffTrips, saidOf } from './vehicleCalendarLane'
import { clock12, type Tone } from './vehicleCalendarModel'

export type TripRole = 'driver' | 'companion'
export type PersonTrip = {
  id: string; state: string; word: string; tone: Tone; day: string; start_at: string; end_at: string
  start_label: string; end_label: string; vehicle_name: string; trip_type: string; purpose: string; destination: string
  wheelchair_required: boolean; client_key: string; client_name: string; staff_name: string; driver_name: string
  /** only on a staff member's read */
  role?: TripRole
}
export type PersonTrips = { today: string; trips: PersonTrip[] }

const TONES: readonly Tone[] = ['amber', 'peach', 'blue', 'mint', 'grey', 'rose']
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

function tripOf(v: unknown): PersonTrip {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const tone = str(o.tone) as Tone
  const role = str(o.role)
  return {
    id: str(o.id), state: str(o.state), word: str(o.word), tone: TONES.includes(tone) ? tone : 'grey', day: str(o.day),
    start_at: str(o.start_at), end_at: str(o.end_at), start_label: str(o.start_label), end_label: str(o.end_label),
    vehicle_name: str(o.vehicle_name), trip_type: str(o.trip_type), purpose: str(o.purpose), destination: str(o.destination),
    wheelchair_required: o.wheelchair_required === true, client_key: str(o.client_key), client_name: str(o.client_name),
    staff_name: str(o.staff_name), driver_name: str(o.driver_name),
    ...(role === 'driver' || role === 'companion' ? { role } : {}),
  }
}

export function personTripsOf(raw: unknown): PersonTrips {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const trips = Array.isArray(o.trips) ? o.trips.map(tripOf).filter((t) => t.id) : []
  return { today: str(o.today), trips }
}

/** Upcoming first, soonest first; then the past, latest first. */
export function upcomingFirst(trips: PersonTrip[], today: string): PersonTrip[] {
  const up = trips.filter((t) => t.day >= today).sort((a, b) => a.start_at.localeCompare(b.start_at))
  const past = trips.filter((t) => t.day < today).sort((a, b) => b.start_at.localeCompare(a.start_at))
  return [...up, ...past]
}

/** '9:00 AM – 10:30 AM', or the pickup alone when the end is not known. */
export const tripTimes = (t: PersonTrip): string => {
  const s = clock12(t.start_at)
  const e = t.end_label ? clock12(t.end_at) : ''
  return s && e ? `${s} – ${e}` : s
}

/** Where to and why: 'Dr. Lee checkup · 12 Oak St', the trip type when nothing else is said. */
export const tripWhere = (t: PersonTrip): string =>
  [t.purpose || t.trip_type, t.destination].filter(Boolean).join(' · ')

export const tripHref = (id: string): string => `/app/vehicle-calendar/calendar?trip=${encodeURIComponent(id)}`

export const ROLE_WORD: Record<TripRole, string> = { driver: 'Driver', companion: 'Companion' }

/* ---------- the read ---------- */

const held = new Map<string, PersonTrips>()
let crossings = 0
onMemoryBoundary(() => {
  crossings++
  held.clear()
})

export type TripsRead = { data: PersonTrips | null; status: 'loading' | 'ready' | 'failed'; error: string }

function useTrips(key: string | null, read: () => Promise<unknown>): TripsRead {
  const [again, setAgain] = useState(0)
  const [state, setState] = useState<TripsRead & { key: string | null }>(() => {
    const hit = key ? held.get(key) : undefined
    return { key, data: hit ?? null, status: hit ? 'ready' : 'loading', error: '' }
  })
  const reader = useRef(read)
  reader.current = read

  useEffect(() => {
    const ring = () => setAgain((n) => n + 1)
    const offRing = onLiveEvent(VEHICLE_CALENDAR_EVENT, ring)
    const offOpen = onLiveEvent('open', ring)
    return () => { offRing(); offOpen() }
  }, [])

  useEffect(() => {
    if (!key) return
    let live = true
    const hit = held.get(key)
    setState((s) => (s.key === key ? s : { key, data: hit ?? null, status: hit ? 'ready' : 'loading', error: '' }))
    const asked = crossings
    reader.current()
      .then((raw) => {
        if (asked !== crossings) return
        const data = personTripsOf(raw)
        held.set(key, data)
        if (live) setState({ key, data, status: 'ready', error: '' })
      })
      .catch((err: unknown) => {
        if (!live || asked !== crossings) return
        const error = saidOf(err)
        setState((s) => ({ ...s, key, status: s.key === key && s.data ? 'ready' : 'failed', error }))
      })
    return () => { live = false }
  }, [key, again])

  return state.key === key ? state : { data: null, status: 'loading', error: '' }
}

/** One client's trips, by their client key. */
export const useClientTrips = (client: string): TripsRead =>
  useTrips(client ? `client|${client}` : null, () => readClientTrips(client))

/** One staff member's trips as driver or companion, by their staff key. */
export const useStaffTrips = (person: string): TripsRead =>
  useTrips(person ? `staff|${person}` : null, () => readStaffTrips(person))
