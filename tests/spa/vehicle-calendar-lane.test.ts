/**
 * TRANSPORTATION · the lane: the board is kept per account and place (memory, and this owner's own kept copy), drawn
 * at once on the next visit and read again quietly behind it; the app's live event and the stream's 'open' read it
 * again; a read that fails keeps the board drawn; a write's board replaces the held one, and a read that left before
 * the write never lays its board over it; and every other account's copy is gone at a memory boundary. The door is
 * answered at `fetch` with its own envelope.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useAuthStore } from '@/auth/useAuthStore'
import { keep } from '@/lib/kept'
import { useMemberStore } from '@/stores/useMemberStore'
import {
  KEPT_MS, KEPT_VEHICLE_PREFIX, VEHICLE_CALENDAR_EVENT, absorbWrite, forgetBoards, heldBoard, holdBoard, keptBoard,
  ownerKey, readBoard, requestTrip, useVehicleBoard,
} from '@/pages/features/vehiclecalendar/vehicleCalendarLane'
import { boardFrom } from '@/pages/features/vehiclecalendar/vehicleCalendarModel'
import { mountHook } from './react-host'

const STORE_PREFIX = KEPT_VEHICLE_PREFIX
const realFetch = globalThis.fetch
let sent: { action: string; payload: unknown }[] = []
let answer: () => Response = () => new Response(JSON.stringify({ status: 200, data: { ok: true } }))
/** While set, a board read waits on it with the answer it was given when it left. */
let hold: Promise<void> | null = null

const board = (stamp: string, over: Record<string, unknown> = {}) => boardFrom({
  ok: true, today: '2026-09-30', stamp, viewer: { uid: 'u', name: 'U' }, vehicles: [{ id: 'VV1', name: 'Van', order: 1 }], ...over,
})
const signIn = (id: string) => useAuthStore.setState({ user: { id, name: id, role: 'staff', types: [], isMaster: false }, token: `tok-${id}` } as never)
const shelf = () => {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(STORE_PREFIX)) out.push(k)
  }
  return out.sort()
}

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(decodeURIComponent(String(init?.body ?? '').replace(/^body=/, '')))
    sent.push({ action: String(body.action), payload: body.payload })
    const res = answer()
    if (hold && body.action === 'vehicleCalendarBoard') await hold
    return res
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => { signIn('u-ann') })
afterEach(() => {
  sent = []
  hold = null
  forgetBoards()
  useAuthStore.setState({ user: null, token: null } as never)
})

describe('the board, kept per account', () => {
  it('a read is kept under this account\'s own key, and another account never paints it', async () => {
    answer = () => new Response(JSON.stringify({ status: 200, data: board('A') }))
    await readBoard()
    assert.deepEqual(sent.map((s) => s.action), ['vehicleCalendarBoard'])
    assert.equal(ownerKey(), 'u-ann')
    assert.deepEqual(shelf(), [`${STORE_PREFIX}u-ann`])
    assert.equal(heldBoard('u-ann')?.board.stamp, 'A')
    assert.equal(keptBoard('u-ann')?.board.stamp, 'A')
    assert.equal(heldBoard('u-bob'), null, 'another account has nothing to paint')
    assert.equal(keptBoard('u-bob'), null)
  })

  it('a copy older than six hours, or written for another owner, is not painted', () => {
    const at = Date.now() - KEPT_MS - 1000
    keep(`${STORE_PREFIX}u-ann`, { at, owner: 'u-ann', board: board('old') })
    assert.equal(keptBoard('u-ann'), null)
    keep(`${STORE_PREFIX}u-ann`, { at: Date.now(), owner: 'u-bob', board: board('theirs') })
    assert.equal(keptBoard('u-ann'), null)
    localStorage.setItem(`${STORE_PREFIX}u-ann`, '{not json')
    assert.equal(keptBoard('u-ann'), null)
  })

  it('the copy is kept per place: a visit is its own owner, and never draws the home board', () => {
    holdBoard(board('home'))
    assert.equal(ownerKey(), 'u-ann')
    useMemberStore.setState({ currentMemberId: 'mem_1' } as never)
    try {
      assert.equal(ownerKey(), 'm:mem_1:u-ann')
      assert.equal(heldBoard(), null, 'nothing of home is drawn inside the visit')
    } finally {
      useMemberStore.setState({ currentMemberId: '' } as never)
    }
  })

  it('a memory boundary drops memory and every other account\'s copy', () => {
    holdBoard(board('A'), 'u-ann')
    holdBoard(board('B'), 'u-bob')
    assert.equal(shelf().length, 2)
    signIn('u-cy')
    assert.deepEqual(shelf(), [], 'the sign-in of another account is a boundary')
    assert.equal(heldBoard('u-ann'), null)
    assert.equal(heldBoard('u-bob'), null)
  })

  it('a write\'s board replaces the held one; a write without one leaves it', () => {
    holdBoard(board('A'), 'u-ann')
    absorbWrite({ ok: true, said: 'Saved.', board: board('after') })
    assert.equal(heldBoard('u-ann')?.board.stamp, 'after')
    absorbWrite({ ok: true, said: 'Already answered.' })
    assert.equal(heldBoard('u-ann')?.board.stamp, 'after')
  })

  it('a write goes out once, never retried, and its board comes back read', async () => {
    answer = () => new Response(JSON.stringify({ status: 200, data: { ok: true, said: 'Requested.', trip_id: 'VT0000000001', board: board('fresh') } }))
    const got = await requestTrip({ vehicle_id: 'VV1', staff_key: 'ann', start: '2026-10-07T09:00', end: '2026-10-07T10:00', trip_type: 'Work' })
    assert.equal(got.said, 'Requested.')
    assert.equal(got.trip_id, 'VT0000000001')
    assert.equal(got.board?.stamp, 'fresh')
    assert.deepEqual(sent, [{ action: 'vehicleCalendarRequest', payload: { vehicle_id: 'VV1', staff_key: 'ann', start: '2026-10-07T09:00', end: '2026-10-07T10:00', trip_type: 'Work' } }])
    answer = () => new Response(JSON.stringify({ status: 409, message: 'The Van is booked Wed Oct 7, 9:00 AM – 11:30 AM — choose another vehicle or time.' }))
    await assert.rejects(requestTrip({ vehicle_id: 'VV1', staff_key: 'ann', start: '2026-10-07T09:00', end: '2026-10-07T10:00', trip_type: 'Work' }),
      /The Van is booked/)
    assert.equal(sent.length, 2, 'a refused write is not sent again')
  })
})

describe('useVehicleBoard', () => {
  it('paints the kept copy at once, reads again behind it, and keeps it drawn when that read fails', async () => {
    holdBoard(board('kept'), 'u-ann')
    answer = () => new Response(JSON.stringify({ status: 503, message: 'The trips house is not set up yet.' }))
    const h = mountHook(() => useVehicleBoard(), {})
    assert.equal(h.current.board?.stamp, 'kept', 'drawn before any answer')
    assert.equal(h.current.status, 'ready')
    await h.settle(() => Boolean(h.current.error))
    assert.equal(h.current.board?.stamp, 'kept', 'never blanked')
    assert.equal(h.current.error, 'The trips house is not set up yet.')
    assert.ok(sent.some((s) => s.action === 'vehicleCalendarBoard'))
    h.unmount()
  })

  it('with nothing held, a failed read says why and draws no board', async () => {
    answer = () => new Response(JSON.stringify({ status: 503, message: 'Nobody is set to approve vehicle requests.' }))
    const h = mountHook(() => useVehicleBoard(), {})
    assert.equal(h.current.status, 'loading')
    await h.settle(() => h.current.status === 'failed')
    assert.equal(h.current.board, null)
    assert.equal(h.current.error, 'Nobody is set to approve vehicle requests.')
    h.unmount()
  })

  it('another account signing in drops the drawn board at once, and its own read follows', async () => {
    holdBoard(board('ann'), 'u-ann')
    answer = () => new Response(JSON.stringify({ status: 200, data: board('ann-fresh') }))
    const h = mountHook(() => useVehicleBoard(), {})
    assert.equal(h.current.board?.stamp, 'ann')
    await h.settle(() => h.current.board?.stamp === 'ann-fresh')
    answer = () => new Response(JSON.stringify({ status: 200, data: board('bob') }))
    h.run(() => signIn('u-bob'))
    assert.notEqual(h.current.board?.stamp, 'ann-fresh', 'never the last account\'s board')
    await h.settle(() => h.current.board?.stamp === 'bob')
    assert.equal(h.current.board?.stamp, 'bob')
    assert.deepEqual(shelf(), [`${STORE_PREFIX}u-bob`])
    h.unmount()
  })

  it('a write\'s board is absorbed with no read of its own', async () => {
    answer = () => new Response(JSON.stringify({ status: 200, data: board('first') }))
    const h = mountHook(() => useVehicleBoard(), {})
    await h.settle(() => h.current.board?.stamp === 'first')
    const reads = sent.length
    h.run(() => h.current.absorb({ ok: true, said: 'Approved.', board: board('second') }))
    assert.equal(h.current.board?.stamp, 'second')
    assert.equal(sent.length, reads, 'no extra read')
    assert.equal(heldBoard('u-ann')?.board.stamp, 'second')
    h.unmount()
  })

  it('a read that left before a write never lays its board over the write\'s: a fresh read is owed instead', async () => {
    answer = () => new Response(JSON.stringify({ status: 200, data: board('first') }))
    const h = mountHook(() => useVehicleBoard(), {})
    await h.settle(() => h.current.board?.stamp === 'first')
    let open: () => void = () => {}
    hold = new Promise<void>((r) => { open = r })
    answer = () => new Response(JSON.stringify({ status: 200, data: board('before') }))
    h.run(() => h.current.reload())
    await new Promise((r) => setTimeout(r, 0))
    hold = null
    answer = () => new Response(JSON.stringify({ status: 200, data: { ok: true, said: 'Requested.', board: board('after') } }))
    const got = await requestTrip({ vehicle_id: 'VV1', staff_key: 'ann', start: '2026-10-07T09:00', end: '2026-10-07T10:00', trip_type: 'Work' })
    h.run(() => h.current.absorb(got))
    assert.equal(h.current.board?.stamp, 'after')
    answer = () => new Response(JSON.stringify({ status: 200, data: board('fresh') }))
    const drawn: string[] = []
    open()
    await h.settle(() => {
      drawn.push(String(h.current.board?.stamp))
      return h.current.board?.stamp === 'fresh'
    })
    assert.ok(!drawn.includes('before'), drawn.join())
    assert.equal(heldBoard('u-ann')?.board.stamp, 'fresh')
    assert.equal(keptBoard('u-ann')?.board.stamp, 'fresh')
    assert.deepEqual(sent.map((s) => s.action),
      ['vehicleCalendarBoard', 'vehicleCalendarBoard', 'vehicleCalendarRequest', 'vehicleCalendarBoard'])
    h.unmount()
  })

  it('the page never polls: it reads again on the app\'s ring, the stream\'s open and the tab coming back', () => {
    assert.ok(!/setInterval|setTimeout/.test(String(useVehicleBoard)))
    assert.equal(VEHICLE_CALENDAR_EVENT, 'vehicle-calendar')
    const src = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'src/pages/features/vehiclecalendar/vehicleCalendarLane.ts'), 'utf8')
    assert.match(src, /onLiveEvent\(VEHICLE_CALENDAR_EVENT, /)
    assert.match(src, /onLiveEvent\('open', /)
    assert.match(src, /addEventListener\?\.\('focus', onSeen\)/)
    assert.match(src, /addEventListener\?\.\('visibilitychange', onSeen\)/)
    assert.ok(!/setInterval|setTimeout/.test(src))
  })
})
