/**
 * TRANSPORTATION · the contract between the screen and its doors (an integration verdict: it reads Apps Script's
 * own VehicleCalendar*.gs). Every action the lane calls is declared in HUB_POLICY as a pure literal, every key a
 * write sends is one of that action's declared params, and every field the screen reads off the board is a field
 * the board's builder names. A name that one side renames breaks here, not on the screen.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import {
  VEHICLE_CALENDAR_ACTIONS, answerTrip, importVanCalendar, readBoard, readClientTrips, readStaffTrips, requestTrip, saveTrip,
  saveVehicle, seedVehicles, setSettings, withdrawTrip, forgetBoards,
} from '@/pages/features/vehiclecalendar/vehicleCalendarLane'
import { boardFrom, tripFrom, vehicleFrom } from '@/pages/features/vehiclecalendar/vehicleCalendarModel'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const GS_DIR = resolve(ROOT, 'apps-script')
const gsFiles = existsSync(GS_DIR) ? readdirSync(GS_DIR).filter((f) => /^VehicleCalendar.*\.gs$/.test(f)) : []
const gs = gsFiles.map((f) => readFileSync(resolve(GS_DIR, f), 'utf8')).join('\n')

type Policy = { file?: string; lane?: string; idempotent?: boolean; emits?: string[]; params?: Record<string, unknown> }

/** Every `HUB_POLICY.vehicleCalendar… = { … }`, each read as the literal it must be (a name in it would throw). */
function policies(): Record<string, Policy> {
  const out: Record<string, Policy> = {}
  for (const m of gs.matchAll(/^HUB_POLICY\.(vehicleCalendar\w+)\s*=\s*\{/gm)) {
    const open = (m.index ?? 0) + m[0].length - 1
    let depth = 0
    let end = open
    for (let i = open; i < gs.length; i++) {
      if (gs[i] === '{') depth++
      else if (gs[i] === '}' && --depth === 0) { end = i; break }
    }
    // read in a context of its own, then brought into this realm so its arrays compare as arrays
    out[m[1]] = JSON.parse(JSON.stringify(vm.runInNewContext(`(${gs.slice(open, end + 1)})`, Object.create(null)))) as Policy
  }
  return out
}

describe('transportation — the screen and Apps Script agree', () => {
  it('Apps Script carries the Transportation files', () => {
    assert.ok(gsFiles.length > 0, 'apps-script/VehicleCalendar*.gs is not in this tree — this verdict runs once TR-GS has landed')
  })

  it('every action the lane calls is declared, and nothing declared is left uncalled', () => {
    const declared = Object.keys(policies()).sort()
    assert.deepEqual(declared, [...VEHICLE_CALENDAR_ACTIONS].sort())
    for (const a of VEHICLE_CALENDAR_ACTIONS) assert.match(gs, new RegExp(`HUB_ACTIONS\\.${a}\\s*=\\s*function`), `${a} has a handler`)
  })

  it('the board is a read; every other door is a tool, and a texting door says it texts', () => {
    const p = policies()
    const reads = ['vehicleCalendarBoard', 'vehicleCalendarClientTrips', 'vehicleCalendarStaffTrips']
    for (const a of reads) assert.equal(p[a]?.lane, 'read', a)
    for (const a of VEHICLE_CALENDAR_ACTIONS.filter((x) => !reads.includes(x))) assert.equal(p[a]?.lane, 'tool', a)
    for (const a of ['vehicleCalendarRequest', 'vehicleCalendarAnswer', 'vehicleCalendarTripSave']) assert.deepEqual(p[a]?.emits, ['smsSend'], a)
  })

  describe('what the lane sends', () => {
    const realFetch = globalThis.fetch
    const sent: { action: string; payload: Record<string, unknown> }[] = []
    before(() => {
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(decodeURIComponent(String(init?.body ?? '').replace(/^body=/, '')))
        sent.push({ action: String(body.action), payload: body.payload ?? {} })
        return new Response(JSON.stringify({ status: 200, data: { ok: true, said: 'Done.', dry_run: true, report: {} } }))
      }) as typeof fetch
    })
    after(() => {
      globalThis.fetch = realFetch
      forgetBoards()
    })

    it('every key a write sends is one of its declared params', async () => {
      await readBoard()
      await requestTrip({ vehicle_id: 'VV1', staff_key: 'ann', start: '2026-10-07T09:00', end: '2026-10-07T10:00', client_key: 'beth',
        trip_type: 'Work', details: 'x', wheelchair_required: true })
      await answerTrip('VI0123456789', 'decline', 'busy')
      await withdrawTrip('VT0123456789')
      await saveTrip({ trip_id: 'VT0123456789', status: 'scheduled', vehicle_id: 'VV1', staff_key: 'ann', driver_key: 'ann',
        start: '2026-10-07T09:00', end: '2026-10-07T10:00', wheelchair_required: false, trip_type: 'Work', purpose: 'p',
        destination: 'd', details: 'x', client_key: 'beth', note: 'n' })
      await saveVehicle({ vehicle_id: 'VV1', name: 'Van', description: 'd', seats: 6, wheelchair_accessible: true, availability: 'available', note: 'n' })
      await setSettings({ directors: 'a@b.c', trip_types: ['Work'], import_minutes: 120 })
      await seedVehicles(true)
      await importVanCalendar(true)
      await readClientTrips('beth')
      await readStaffTrips('ann')
      const p = policies()
      assert.deepEqual([...new Set(sent.map((s) => s.action))].sort(), [...VEHICLE_CALENDAR_ACTIONS].sort())
      for (const s of sent) {
        const params = p[s.action]?.params
        if (!params) continue
        for (const key of Object.keys(s.payload)) assert.ok(key in params, `${s.action} sends ${key}, which it does not declare`)
      }
    })
  })

  it('every field the screen reads off the board is one the builder names', () => {
    const b = boardFrom({})
    // the board's own shape is built as object literals (`key:`), the editors-only parts as assignments (`out.key =`)
    const built = new Set([...Object.keys(b), 'drivers', ...Object.keys(b.viewer), ...Object.keys(b.settings), ...Object.keys(b.kpis),
      'item_id', 'trip_id', 'may_drive'])
    const unbuilt = [...built].filter((f) =>
      !new RegExp(`[{,\\s'"]${f}['"]?\\s*:`).test(gs) && !new RegExp(`\\bout\\.${f}\\s*=[^=]`).test(gs))
    assert.deepEqual(unbuilt, [], `the board builder never writes: ${unbuilt.join(', ')}`)
    // a trip's and a vehicle's fields may come straight off the house's headers: each is named somewhere
    const named = new Set([...Object.keys(tripFrom({})), ...Object.keys(vehicleFrom({}))])
    const unnamed = [...named].filter((f) => !new RegExp(`\\b${f}\\b`).test(gs))
    assert.deepEqual(unnamed, [], `Apps Script never names: ${unnamed.join(', ')}`)
  })
})
