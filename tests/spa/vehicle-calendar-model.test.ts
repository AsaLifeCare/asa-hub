/**
 * TRANSPORTATION · the model: Eastern wall clocks from the request form's selects, the half-open overlap, whether a
 * vehicle or a driver is free for a time, a vehicle's availability on a day, the history's search and status, the
 * request form's own checks and the Sunday-first month. Every clock is Eastern, whatever the machine's zone.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  availabilityOn, boardFrom, bookingsOn, chipsFor, driverAt, easternWall, historyRows, monthWeeks, overlap, panelOf,
  panelParam, partsOfWall, pendingTrip, requestErrors, statusesIn, tripDays, tripFrom, vehicleAt, vehicleFrom, wallOf, wallToMs,
  weekOf, whenWords, type RequestForm, type Trip,
} from '@/pages/features/vehiclecalendar/vehicleCalendarModel'

const VAN = vehicleFrom({ id: 'VVAN', name: 'Van', description: 'Wheelchair-accessible van', seats: 6, wheelchair_accessible: true, availability: 'available', tint: 'blue', order: 1 })
const MAZDA = vehicleFrom({ id: 'VMAZ', name: 'Mazda', description: 'Mazda CX-5', seats: 5, wheelchair_accessible: false, availability: 'available', tint: 'mint', order: 2 })
const FORD = vehicleFrom({ id: 'VFOR', name: 'Ford', description: 'Ford Escape', seats: 5, wheelchair_accessible: false, availability: 'maintenance', tint: 'peach', order: 3 })

const iso = (wall: string) => new Date(wallToMs(wall)).toISOString()

function trip(id: string, over: Partial<Trip> & { from: string; to: string }): Trip {
  const { from, to, ...rest } = over
  return tripFrom({
    id, state: 'scheduled', word: 'Scheduled', tone: 'blue', vehicle_id: 'VVAN', vehicle_name: 'Van',
    requested_vehicle_id: 'VVAN', requested_vehicle_name: 'Van', start_at: iso(from), end_at: iso(to), day: from.slice(0, 10),
    start_label: from.slice(11), end_label: to.slice(11), purpose: 'Primary care follow-up', trip_type: 'Doctor appointment',
    staff_key: 'taylorbrooks', staff_name: 'Taylor Brooks', driver_key: 'taylorbrooks', driver_name: 'Taylor Brooks',
    client_name: 'Beth Ann Sutter', requested_by: { uid: 'USR_T', name: 'Taylor Brooks' }, ...rest,
  })
}

describe('wall clocks, Eastern', () => {
  it('wallOf turns the selects into a wall clock; 12 AM is midnight and 12 PM is noon', () => {
    assert.equal(wallOf('2026-10-07', '12', '00', 'AM'), '2026-10-07T00:00')
    assert.equal(wallOf('2026-10-07', '12', '30', 'PM'), '2026-10-07T12:30')
    assert.equal(wallOf('2026-10-07', '1', '15', 'PM'), '2026-10-07T13:15')
    assert.equal(wallOf('2026-10-07', '11', '45', 'PM'), '2026-10-07T23:45')
    assert.equal(wallOf('2026-10-07', '9', '00', 'AM'), '2026-10-07T09:00')
    assert.equal(wallOf('2026-10-07', '', '00', 'AM'), '', 'no hour, no wall')
    assert.equal(wallOf('', '9', '00', 'AM'), '')
    assert.equal(wallOf('2026-10-07', '13', '00', 'PM'), '')
    assert.deepEqual(partsOfWall('2026-10-07T00:15'), { date: '2026-10-07', hour: '12', minute: '15', ampm: 'AM' })
    assert.deepEqual(partsOfWall('2026-10-07T12:00'), { date: '2026-10-07', hour: '12', minute: '00', ampm: 'PM' })
  })

  it('wallToMs reads daylight and standard time, the first pass of the repeated hour, and refuses the skipped one', () => {
    assert.equal(new Date(wallToMs('2026-10-07T13:00')).toISOString(), '2026-10-07T17:00:00.000Z')
    assert.equal(new Date(wallToMs('2026-12-07T13:00')).toISOString(), '2026-12-07T18:00:00.000Z')
    assert.equal(new Date(wallToMs('2026-11-01T01:30')).toISOString(), '2026-11-01T05:30:00.000Z', 'EDT reading first')
    assert.ok(Number.isNaN(wallToMs('2027-03-14T02:30')), 'the clocks jump from 2:00 to 3:00')
    assert.equal(easternWall('2026-10-07T17:00:00Z'), '2026-10-07T13:00')
    assert.equal(easternWall('2026-10-08T04:00:00Z'), '2026-10-08T00:00')
  })

  it('whenWords says one day, or both days across midnight', () => {
    assert.equal(whenWords(iso('2026-10-07T13:00'), iso('2026-10-07T15:20')), 'Wed Oct 7, 1:00 PM – 3:20 PM')
    assert.equal(whenWords(iso('2026-10-07T13:00'), iso('2026-10-08T09:00')), 'Oct 7, 1:00 PM – Oct 8, 9:00 AM')
  })
})

describe('overlap and the calendar', () => {
  it('is half-open: back-to-back is free, a minute over is not', () => {
    assert.equal(overlap({ s: 0, e: 10 }, { s: 10, e: 20 }), false)
    assert.equal(overlap({ s: 0, e: 11 }, { s: 10, e: 20 }), true)
    assert.equal(overlap({ s: 12, e: 13 }, { s: 10, e: 20 }), true)
  })

  it('a trip across midnight is drawn on both days; one ending at midnight only on its own', () => {
    const night = trip('VT1', { from: '2026-10-07T22:00', to: '2026-10-08T02:00' })
    assert.deepEqual(tripDays(night), ['2026-10-07', '2026-10-08'])
    assert.deepEqual(tripDays(trip('VT2', { from: '2026-10-07T22:00', to: '2026-10-08T00:00' })), ['2026-10-07'])
    const chips = chipsFor([night], '2026-10-08', [VAN], null)
    assert.equal(chips[0].time, '00:00–02:00')
    assert.equal(chipsFor([night], '2026-10-07', [VAN], null)[0].time, '22:00–24:00')
  })

  it('only scheduled trips are chips; a private one says Booked; the vehicle filter narrows', () => {
    const trips = [
      trip('VT1', { from: '2026-10-07T09:00', to: '2026-10-07T11:30' }),
      trip('VT2', { from: '2026-10-07T12:00', to: '2026-10-07T13:00', state: 'requested', vehicle_id: '' }),
      trip('VT3', { from: '2026-10-07T14:00', to: '2026-10-07T15:00', vehicle_id: 'VMAZ', vehicle_name: 'Mazda', private: true, purpose: '' }),
    ]
    const chips = chipsFor(trips, '2026-10-07', [VAN, MAZDA], null)
    assert.deepEqual(chips.map((c) => [c.vehicle, c.time, c.text]), [['Van', '09:00–11:30', 'Primary care follow-up'], ['Mazda', '14:00–15:00', 'Booked']])
    assert.deepEqual(chipsFor(trips, '2026-10-07', [VAN, MAZDA], new Set(['VMAZ'])).map((c) => c.id), ['VT3'])
  })

  it('a page that asks draws the undecided trips too, as awaiting approval, by the vehicle they asked for', () => {
    const asked = trip('VT2', { from: '2026-10-07T12:00', to: '2026-10-07T13:00', state: 'requested', vehicle_id: '',
      requested_vehicle_id: 'VVAN', purpose: 'Chores' })
    const held = trip('VT1', { from: '2026-10-07T09:00', to: '2026-10-07T11:30' })
    const chips = chipsFor([asked, held], '2026-10-07', [VAN], null, pendingTrip)
    assert.deepEqual(chips.map((c) => [c.id, c.vehicle, c.time, c.text, c.pending]), [
      ['VT1', 'Van', '09:00–11:30', 'Primary care follow-up', false], ['VT2', 'Van', '12:00–13:00', 'Awaiting approval · Chores', true]])
    assert.deepEqual(chipsFor([asked, held], '2026-10-07', [VAN], null).map((c) => c.id), ['VT1'], 'never unless the page asks')
  })

  it('monthWeeks starts on Sunday and pads with blanks; weekOf is the Sunday-first week', () => {
    const w = monthWeeks('2026-09')
    assert.deepEqual(w[0], ['', '', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'])
    assert.equal(w.flat().filter(Boolean).length, 30)
    assert.ok(w.every((row) => row.length === 7))
    assert.deepEqual(weekOf('2026-09-30'), ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])
    assert.deepEqual(weekOf('2026-09-27')[0], '2026-09-27')
  })
})

describe('is it free?', () => {
  const booked = trip('VT1', { from: '2026-10-07T09:00', to: '2026-10-07T11:30' })
  const asked = trip('VT2', { from: '2026-10-07T13:00', to: '2026-10-07T14:00', state: 'requested', vehicle_id: '', requested_vehicle_id: 'VMAZ', requested_vehicle_name: 'Mazda', driver_key: 'ann', staff_key: 'ann' })
  const trips = [booked, asked]
  const at = (from: string, to: string) => [wallToMs(from), wallToMs(to)] as const

  it('vehicleAt: maintenance, booked, waiting, wheelchair and free', () => {
    assert.equal(vehicleAt(FORD, trips, ...at('2026-10-07T09:00', '2026-10-07T10:00')).word, 'Maintenance')
    const b = vehicleAt(VAN, trips, ...at('2026-10-07T10:00', '2026-10-07T12:00'))
    assert.equal(b.word, 'Booked')
    assert.match(b.why, /^The Van is booked Wed Oct 7, 9:00 AM – 11:30 AM\.$/)
    assert.equal(vehicleAt(VAN, trips, ...at('2026-10-07T11:30', '2026-10-07T12:00')).word, 'Available', 'back-to-back')
    assert.equal(vehicleAt(VAN, trips, ...at('2026-10-07T10:00', '2026-10-07T12:00'), { except: 'VT1' }).word, 'Available', 'itself never blocks')
    assert.equal(vehicleAt(MAZDA, trips, ...at('2026-10-07T13:30', '2026-10-07T15:00')).word, 'Requested')
    assert.equal(vehicleAt(MAZDA, trips, ...at('2026-10-07T15:00', '2026-10-07T16:00'), { wheelchair: true }).word, 'Not wheelchair accessible')
    assert.equal(vehicleAt(VAN, trips, ...at('2026-10-07T15:00', '2026-10-07T16:00'), { wheelchair: true }).word, 'Available')
  })

  it('driverAt: a scheduled or waiting trip then, not cleared, or free', () => {
    assert.equal(driverAt('taylorbrooks', trips, ...at('2026-10-07T11:00', '2026-10-07T12:00')).word, 'Has a trip then')
    assert.equal(driverAt('taylorbrooks', trips, ...at('2026-10-07T11:30', '2026-10-07T12:00')).word, 'Available')
    assert.equal(driverAt('ann', trips, ...at('2026-10-07T13:30', '2026-10-07T14:30')).word, 'Has a trip then', 'a waiting request counts')
    assert.equal(driverAt('ann', trips, ...at('2026-10-07T13:30', '2026-10-07T14:30'), { states: ['scheduled'] }).word, 'Available')
    assert.equal(driverAt('bo', trips, ...at('2026-10-07T13:30', '2026-10-07T14:30'), { drivers: { bo: { may_drive: false, word: 'Suspended' } } }).word, 'Not cleared to drive')
    assert.equal(driverAt('', trips, 0, 1).word, 'No driver')
  })

  it('availabilityOn: free, partly booked, booked all day, and the vehicle\'s own availability first', () => {
    assert.equal(availabilityOn(VAN, trips, '2026-10-07'), 'Partly booked')
    assert.equal(availabilityOn(VAN, trips, '2026-10-08'), 'Available')
    assert.equal(availabilityOn(FORD, trips, '2026-10-07'), 'Maintenance')
    const allDay = trip('VT9', { from: '2026-10-09T00:00', to: '2026-10-10T00:00' })
    assert.equal(availabilityOn(VAN, [allDay], '2026-10-09'), 'Booked')
    assert.deepEqual(bookingsOn(VAN, trips, '2026-10-07').map((b) => b.line), ['09:00–11:30 · Primary care follow-up'])
  })
})

describe('history and the request form', () => {
  it('historyRows searches every word and filters by status, newest first', () => {
    const rows = [
      trip('VT1', { from: '2026-10-07T09:00', to: '2026-10-07T10:00' }),
      trip('VT2', { from: '2026-10-09T09:00', to: '2026-10-09T10:00', state: 'declined', word: 'Declined', client_name: 'Lori Schmucker' }),
      trip('VT3', { from: '2026-10-08T09:00', to: '2026-10-08T10:00', word: 'Completed' }),
    ]
    assert.deepEqual(historyRows(rows, '', '').map((t) => t.id), ['VT2', 'VT3', 'VT1'])
    assert.deepEqual(historyRows(rows, 'lori', '').map((t) => t.id), ['VT2'])
    assert.deepEqual(historyRows(rows, 'beth sutter', '').map((t) => t.id), ['VT3', 'VT1'])
    assert.deepEqual(historyRows(rows, '', 'Completed').map((t) => t.id), ['VT3'])
    assert.deepEqual(statusesIn(rows), ['Scheduled', 'Completed', 'Declined'])
  })

  it('requestErrors names each missing or wrong field before anything is sent', () => {
    const empty: RequestForm = { vehicle_id: '', staff_key: '', start: '', end: '', client_key: '', trip_type: '', details: '', wheelchair_required: false }
    assert.deepEqual(Object.keys(requestErrors(empty, [VAN])).sort(), ['end', 'staff_key', 'start', 'trip_type', 'vehicle_id'])
    const ok: RequestForm = { ...empty, vehicle_id: 'VVAN', staff_key: 'taylorbrooks', start: '2026-10-07T09:00', end: '2026-10-07T11:30', trip_type: 'Work' }
    assert.deepEqual(requestErrors(ok, [VAN, MAZDA]), {})
    assert.equal(requestErrors({ ...ok, end: '2026-10-07T09:00' }, [VAN]).end, 'The end must be after the start.')
    assert.equal(requestErrors({ ...ok, end: '2026-10-22T09:00' }, [VAN]).end, 'A reservation can be at most 14 days.')
    assert.equal(requestErrors({ ...ok, vehicle_id: 'VMAZ', wheelchair_required: true }, [VAN, MAZDA]).vehicle_id,
      'The Mazda is not wheelchair accessible — choose the Van.')
    assert.equal(requestErrors({ ...ok, vehicle_id: 'VFOR' }, [VAN, FORD]).vehicle_id, 'The Ford is in maintenance — choose another vehicle.')
    assert.match(requestErrors({ ...ok, start: '2027-03-14T02:30', end: '2027-03-14T04:00' }, [VAN]).start ?? '', /does not exist/)
    assert.ok(requestErrors({ ...ok, details: 'x'.repeat(1001) }, [VAN]).details)
  })
})

describe('the board and the address', () => {
  it('boardFrom reads a sparse answer without a single undefined list, and unknown test mode as on', () => {
    const b = boardFrom({ ok: true })
    assert.deepEqual([b.vehicles, b.trips, b.people, b.clients, b.waiting, b.sources], [[], [], [], [], [], []])
    assert.equal(b.test_mode.on, true)
    assert.equal(b.settings.directors_readable, false)
    assert.match(b.today, /^\d{4}-\d{2}-\d{2}$/)
    const sorted = boardFrom({ vehicles: [{ id: 'B', name: 'Ford', order: 3 }, { id: 'A', name: 'Van', order: 1 }] })
    assert.deepEqual(sorted.vehicles.map((v) => v.id), ['A', 'B'])
  })

  it('the panel round-trips through ?panel=', () => {
    for (const p of [{ kind: 'request' }, { kind: 'trip', id: 'VT0123456789' }, { kind: 'vehicle', id: 'VV01' }, { kind: 'vehicle-new' }, { kind: 'share' }, { kind: 'setup' }] as const) {
      assert.deepEqual(panelOf(panelParam(p)), p)
    }
    assert.equal(panelOf('trip~<script>'), null)
    assert.equal(panelOf(''), null)
  })
})
