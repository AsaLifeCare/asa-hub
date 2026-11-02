/**
 * THE PROFILE APPS' READ CACHE — one shared cache under Clients, Staff, Locations and SSA (lib/readCache.ts), in this
 * tab's memory only: a section read once draws at once when it opens again and is read again behind what is drawn
 * past fresh, never drawn past usable; two readers of one key share one request; past the bound the least recently
 * used key goes; a write forgets its owner's keys and no answer asked for before it is held or drawn after it, and in
 * every app — packs too — what was read before it is read again behind what is drawn; a sign-out, and a visit's start
 * and end, drop everything; nothing read reaches localStorage, sessionStorage or
 * IndexedDB. Under it, the relay's packs: held to a bound, prefetched two at a time at most and from the relay's
 * memory alone. Over it, the switcher's first paint from the slices already in the tab. The fixtures are invented.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import {
  PACK_MAX_HELD, PREFETCH_AT_ONCE, PREFETCH_GAP_MS, WRITE_SETTLE_MS, forgetPack, peekPack, prefetchPack, readPack,
} from '@/lib/appPack'
import {
  READ_FRESH_MS, READ_MAX_KEYS, READ_USABLE_MS, createReadCache, useCachedRead,
} from '@/lib/readCache'
import { forgetSnapshot, heldRows, readSlice } from '@/lib/snapshotClient'
import { rosterOf } from '@/pages/features/clientprofiles/clientModel'
import {
  clientWritten, forgetClientReads, heldRoster, readKey as clientKey, readRoster, useClientRead,
} from '@/pages/features/clientprofiles/useClientRead'
import { forgetStaffReads, readKey as staffKey, staffWrote, useStaffRead } from '@/pages/features/staffprofiles/useStaffRead'
import {
  forgetLocationReads, locationWritten, readKey as locationKey, useLocationRead,
} from '@/pages/features/locations/useLocation'
import { heldHouses } from '@/pages/features/locations/locationReads'
import { forgetSsaReads, heldRoster as heldSsaRoster, readKey as ssaKey, useSsaRead } from '@/pages/features/ssaprofiles/useSsaRead'
import { readRoster as readSsaRoster } from '@/pages/features/ssaprofiles/ssaReads'
import { mountHook } from './react-host'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const same = <T,>(raw: unknown): T => raw as T

/**
 * A clock that moves only when stepped, from the real time: a write is one millisecond a step from its reads, never
 * the same one, and one made a few steps in is never later than the real clock of the case after it.
 */
function steppedClock(): { step: (ms: number) => void; stop: () => void } {
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  return { step: (ms) => { now += ms }, stop: () => { Date.now = realNow } }
}

/* ---------- the fixtures ---------- */

const SECRET_DX = 'invented diagnosis zeta'
const SECRET_SSN = '900114544'
const SOURCE_AT = '2026-09-28T21:51:21Z'
const CLIENT_ROWS = [
  { id: 'CLI_kay_test', client_key: 'kay_test', name: 'Kay Test', house: 'ZZ9999', status: 'active', ssa: 'Sam Aide',
    diagnoses_text: SECRET_DX, ssn: SECRET_SSN },
  { id: 'CLI_lee_other', client_key: 'lee_other', name: 'Lee Other', house: 'ZB4060', status: 'active', ssa: 'Sam Aide' },
]
const HOUSES = [
  { id: 'H1', code: 'ZZ9999', label: 'Cedar', title: 'Cedar', city: 'Testville', active: true, address: '1 Cedar St' },
  { id: 'H2', code: 'ZB4060', label: 'Birch', title: 'Birch', city: 'Testville', active: true, address: '2 Birch St' },
]

type Seen = { kind: 'slice' | 'pack' | 'gas'; name: string; q?: Record<string, string> }

const realFetch = globalThis.fetch
let seen: Seen[] = []
let slices: Record<string, unknown[] | null> = {}
let gates: Promise<unknown>[] = []

before(() => {
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.startsWith('/snapshot/')) {
      const name = url.slice('/snapshot/'.length).replace(/\.json$/, '')
      seen.push({ kind: 'slice', name })
      if (name === 'index') {
        return json({ slices: Object.fromEntries(Object.keys(slices).filter((k) => slices[k]).map((k) => [k, { built_at: SOURCE_AT }])) })
      }
      const rows = slices[name]
      return rows ? json({ resource: name, built_at: SOURCE_AT, source_at: SOURCE_AT, rows }) : new Response('no', { status: 404 })
    }
    if (url.startsWith('/erp-lanes/app-pack/')) {
      const q = Object.fromEntries(new URL(url, 'http://x').searchParams)
      const key = decodeURIComponent(new Headers(init?.headers).get('X-App-Pack-Key') ?? '')
      seen.push({ kind: 'pack', name: key, q })
      const gate = gates.shift()
      if (gate) await gate
      return json({ status: 200, data: { built_at: SOURCE_AT, read_age_s: 1, parts: { overview: { house: key, ssn: SECRET_SSN } },
        part_status: { overview: { status: 200 } } } })
    }
    seen.push({ kind: 'gas', name: url })
    return json({ status: 404, message: 'Unknown action.' })
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })

beforeEach(() => {
  seen = []
  gates = []
  slices = { clients: CLIENT_ROWS, houses: HOUSES }
  forgetSnapshot()
  forgetPack()
  forgetClientReads()
  forgetStaffReads()
  forgetLocationReads()
  forgetSsaReads()
  useMemberStore.setState({ currentMemberId: '' } as never)
})

afterEach(async () => {
  // a prefetch waits for an idle moment and its turn's gap: let both end before the next case counts requests
  await sleep(50)
  forgetPack()
  await sleep(PREFETCH_GAP_MS + 300)
})

/* ---------- stale-while-revalidate ---------- */

describe('a section read once draws at once, and is read again behind what is drawn', () => {
  it('opened again while fresh it draws the held answer and asks nothing', async () => {
    const cache = createReadCache()
    let loads = 0
    const load = async () => ({ n: ++loads })
    const a = mountHook(() => useCachedRead(cache, 'overview|ann', load, same<{ n: number }>), {})
    assert.equal(a.current.status, 'loading')
    await a.settle(() => a.current.status === 'ready')
    a.unmount()
    const b = mountHook(() => useCachedRead(cache, 'overview|ann', load, same<{ n: number }>), {})
    assert.equal(b.current.status, 'ready', 'drawn on the first render')
    assert.deepEqual([b.current.data?.n, b.current.refreshing], [1, false])
    await b.settle(() => false)
    assert.equal(loads, 1, 'fresh: nothing is asked')
    b.unmount()
  })

  it('past fresh it is drawn at once and read again behind it; past usable it is not drawn at all', async () => {
    const cache = createReadCache()
    let loads = 0
    const load = async () => ({ n: ++loads })
    const a = mountHook(() => useCachedRead(cache, 'overview|ann', load, same<{ n: number }>), {})
    await a.settle(() => a.current.status === 'ready')
    a.unmount()
    const realNow = Date.now
    try {
      Date.now = () => realNow() + READ_FRESH_MS + 1_000
      const b = mountHook(() => useCachedRead(cache, 'overview|ann', load, same<{ n: number }>), {})
      assert.deepEqual([b.current.status, b.current.data?.n, b.current.refreshing], ['ready', 1, true], 'the stale answer, at once')
      await b.settle(() => b.current.data?.n === 2)
      assert.deepEqual([b.current.refreshing, loads], [false, 2], 'read again behind it')
      b.unmount()
      Date.now = () => realNow() + READ_FRESH_MS + READ_USABLE_MS + 2_000
      const c = mountHook(() => useCachedRead(cache, 'overview|ann', load, same<{ n: number }>), {})
      assert.deepEqual([c.current.status, c.current.data], ['loading', null], 'past usable nothing held is drawn')
      await c.settle(() => c.current.status === 'ready')
      assert.equal(loads, 3)
      c.unmount()
    } finally {
      Date.now = realNow
    }
    assert.equal(READ_FRESH_MS, 5 * 60_000)
    assert.equal(READ_USABLE_MS, 60 * 60_000)
  })

  it('the switcher away and back, or a tab away and back, draws the first owner at once', async () => {
    const cache = createReadCache()
    const loads: string[] = []
    const load = (key: string) => async () => {
      loads.push(key)
      return { key }
    }
    const h = mountHook((p: { key: string }) => useCachedRead(cache, p.key, load(p.key), same<{ key: string }>), { key: 'overview|ann' })
    await h.settle(() => h.current.status === 'ready')
    h.rerender({ key: 'overview|bob' })
    assert.equal(h.current.status, 'loading')
    await h.settle(() => h.current.data?.key === 'overview|bob')
    h.rerender({ key: 'overview|ann' })
    assert.deepEqual([h.current.status, h.current.data?.key], ['ready', 'overview|ann'], 'back on the first: drawn at once')
    h.rerender({ key: 'notes|ann' })
    await h.settle(() => h.current.data?.key === 'notes|ann')
    h.rerender({ key: 'overview|ann' })
    assert.equal(h.current.data?.key, 'overview|ann')
    await h.settle(() => false)
    assert.deepEqual(loads, ['overview|ann', 'overview|bob', 'notes|ann'], 'each key read once')
    h.unmount()
  })

  it('an owner drawn from what is held takes the section with it: one forgotten while away is never drawn on return', async () => {
    const cache = createReadCache()
    let n = 0
    const load = (key: string) => async () => ({ key, n: ++n })
    await cache.read('overview|bob', load('overview|bob'))
    const h = mountHook((p: { key: string }) => useCachedRead(cache, p.key, load(p.key), same<{ key: string; n: number }>),
      { key: 'overview|ann' })
    await h.settle(() => h.current.status === 'ready')
    h.rerender({ key: 'overview|bob' })
    assert.deepEqual([h.current.data?.key, h.current.refreshing], ['overview|bob', false], 'held fresh: drawn, not read')
    // Ann written while Bob is on screen: her answers are forgotten and nobody reading her is told
    cache.forget('ann')
    h.rerender({ key: 'overview|ann' })
    assert.deepEqual([h.current.status, h.current.data], ['loading', null], 'the answer from before her write is not drawn')
    await h.settle(() => h.current.status === 'ready')
    assert.deepEqual([h.current.data?.key, h.current.data?.n], ['overview|ann', 3])
    h.unmount()
  })
})

/* ---------- one request per key ---------- */

describe('two readers of one key share one request', () => {
  it('a section and its panel asking together make one request and draw one answer', async () => {
    const cache = createReadCache()
    let open!: () => void
    const gate = new Promise<void>((r) => { open = r })
    let loads = 0
    const load = async () => {
      loads++
      await gate
      return { who: 'ann' }
    }
    const section = mountHook(() => useCachedRead(cache, 'overview|ann', load, same<{ who: string }>), {})
    const panel = mountHook(() => useCachedRead(cache, 'overview|ann', load, same<{ who: string }>), {})
    const direct = cache.read('overview|ann', load)
    assert.equal(loads, 1)
    open()
    await section.settle(() => section.current.status === 'ready' && panel.current.status === 'ready')
    assert.deepEqual(await direct, { who: 'ann' })
    assert.equal(loads, 1, 'one request for three askers')
    assert.equal(section.current.data, panel.current.data, 'the same answer')
    section.unmount()
    panel.unmount()
  })
})

/* ---------- the bound ---------- */

describe('past the bound the least recently used key goes', () => {
  it('a key used again stays; the one used longest ago goes', async () => {
    const small = createReadCache({ max: 3 })
    for (const k of ['overview|a', 'overview|b', 'overview|c']) await small.read(k, async () => k)
    assert.ok(small.held('overview|a'), 'used again')
    await small.read('overview|d', async () => 'd')
    assert.equal(small.size(), 3)
    assert.equal(small.held('overview|b'), null, 'the least recently used went')
    assert.ok(small.held('overview|a') && small.held('overview|c') && small.held('overview|d'))
  })

  it(`an app holds ${READ_MAX_KEYS} keys at most`, async () => {
    const cache = createReadCache()
    for (let i = 0; i <= READ_MAX_KEYS; i++) await cache.read(`overview|o${i}`, async () => i)
    assert.equal(cache.size(), READ_MAX_KEYS)
    assert.equal(cache.held('overview|o0'), null)
    assert.equal(cache.held(`overview|o${READ_MAX_KEYS}`)?.raw, READ_MAX_KEYS)
  })
})

/* ---------- this tab's own writes ---------- */

describe('a write forgets its owner, and nothing older than it is drawn', () => {
  it('an answer asked for before the write is never held after it; another owner\'s stands', async () => {
    const cache = createReadCache()
    let open!: (v: unknown) => void
    const early = cache.read('notes|ann', () => new Promise((r) => { open = r }))
    await cache.read('notes|bob', async () => 'bob')
    cache.forget('ann')
    let loads = 0
    const late = cache.read('notes|ann', async () => {
      loads++
      return 'after the write'
    })
    assert.notEqual(late, early, 'a read after the write is its own request')
    assert.equal(await late, 'after the write')
    open('before the write')
    await early
    assert.equal(cache.held('notes|ann')?.raw, 'after the write')
    assert.equal(cache.held('notes|bob')?.raw, 'bob')
    assert.equal(loads, 1)
  })

  it('Staff: a note written while its section was reading draws the read after the write, never the one before', async () => {
    const key = staffKey('staffProfileNotes', 'ann')
    let calls = 0
    let release!: (v: unknown) => void
    const load = () => {
      calls++
      return calls === 1 ? new Promise((r) => { release = r }) : Promise.resolve({ notes: 'after the write' })
    }
    const h = mountHook(() => useStaffRead(key, load, same<{ notes: string }>), {})
    assert.equal(h.current.status, 'loading')
    h.run(() => { staffWrote('ann', { id: 'N1' }) })
    await h.settle(() => h.current.status === 'ready')
    assert.equal(h.current.data?.notes, 'after the write')
    release({ notes: 'before the write' })
    await h.settle(() => false)
    assert.equal(h.current.data?.notes, 'after the write', 'the answer asked before the write is never drawn')
    h.unmount()
    const next = mountHook(() => useStaffRead(key, load, same<{ notes: string }>), {})
    assert.equal(next.current.data?.notes, 'after the write', 'nor held')
    assert.equal(calls, 2)
    next.unmount()
  })

  it('Clients and Locations: a write reads the owner\'s sections again; the Clients roster follows every client\'s write', async () => {
    const reads: string[] = []
    const load = (what: string) => async () => {
      reads.push(what)
      return { what, n: reads.length }
    }
    const details = mountHook(() => useClientRead(clientKey('clientProfileDetails', 'kay_test'), load('details'), same), {})
    const roster = mountHook(() => useClientRead(clientKey('clientProfileRoster', '*', false), load('roster'), same), {})
    const house = mountHook(() => useLocationRead(locationKey('locationNotes', 'ZZ9999'), load('house'), same), {})
    await details.settle(() => [details, roster, house].every((h) => h.current.status === 'ready'))
    reads.length = 0
    details.run(() => clientWritten('kay_test', Date.now()))
    await details.settle(() => reads.length === 2)
    assert.deepEqual([...reads].sort(), ['details', 'roster'], 'the client\'s section and the roster, never the house')
    reads.length = 0
    house.run(() => locationWritten('ZZ9999', Date.now()))
    await house.settle(() => reads.length === 1)
    assert.deepEqual(reads, ['house'])
    for (const h of [details, roster, house]) h.unmount()
  })

  it('a write in one app reads the others again behind what they draw: a house\'s incidents after a client\'s filing', async () => {
    let reads = 0
    const load = async () => ({ n: ++reads })
    const key = locationKey('locationIncidents', 'ZB4060')
    const mount = () => mountHook(() => useLocationRead(key, load, same<{ n: number }>), {})
    const clock = steppedClock()
    try {
      const first = mount()
      await first.settle(() => first.current.status === 'ready')
      first.unmount()
      clock.step(1)
      const warm = mount()
      assert.deepEqual([warm.current.data?.n, warm.current.refreshing], [1, false], 'fresh: drawn, not read')
      warm.unmount()
      clock.step(1)
      // Clients files an incident for Lee, who lives at ZB4060: only Lee's answers are forgotten
      clientWritten('lee_other', Date.now())
      clock.step(1)
      const back = mount()
      assert.deepEqual([back.current.status, back.current.data?.n, back.current.refreshing], ['ready', 1, true],
        'read before the write: drawn at once, and read again behind it')
      await back.settle(() => back.current.data?.n === 2)
      back.unmount()
      clock.step(1_000)
      const since = mount()
      assert.equal(since.current.refreshing, false, 'read after the write: fresh')
      since.unmount()
      clock.step(WRITE_SETTLE_MS)
      const later = mount()
      assert.deepEqual([later.current.data?.n, later.current.refreshing], [2, true],
        'read while the write settled: fresh for a minute, not for five')
      await later.settle(() => later.current.data?.n === 3)
      later.unmount()
      clock.step(1_000)
      const settled = mount()
      assert.equal(settled.current.refreshing, false, 'read once it settled: fresh for five minutes again')
      settled.unmount()
    } finally {
      clock.stop()
    }
    assert.equal(reads, 3)
  })

  it('a write in any app asks the relay again for a pack held from before it; one read while it settles holds a minute', async () => {
    const asks = () => seen.filter((s) => s.kind === 'pack' && s.name === 'ssa_sam').length
    const clock = steppedClock()
    try {
      await readPack('ssa', 'ssa_sam')
      clock.step(1)
      await readPack('ssa', 'ssa_sam')
      assert.equal(asks(), 1, 'fresh: held')
      clock.step(1)
      // a client's SSA changed in Clients: the SSA's pack is not Clients' to forget
      clientWritten('kay_test', Date.now())
      clock.step(1)
      await readPack('ssa', 'ssa_sam')
      assert.equal(asks(), 2, 'held from before the write: asked again')
      clock.step(1_000)
      await readPack('ssa', 'ssa_sam')
      assert.equal(asks(), 2, 'read after it: held')
      clock.step(WRITE_SETTLE_MS)
      await readPack('ssa', 'ssa_sam')
      assert.equal(asks(), 3, 'read while the write settled: held for a minute only')
      clock.step(1_000)
      await readPack('ssa', 'ssa_sam')
      assert.equal(asks(), 3, 'read once it settled: held')
    } finally {
      clock.stop()
    }
  })
})

/* ---------- memory boundaries ---------- */

describe('a sign-out, and a visit\'s start and end, drop everything', () => {
  it('a sign-out draws nothing of the session before, and an answer asked before it is never drawn after it', async () => {
    useAuthStore.setState({ user: { id: 'u-a' }, token: 'tok-a' } as never)
    const key = clientKey('clientProfileDetails', 'kay_test')
    let calls = 0
    let release!: (v: unknown) => void
    const load = () => {
      calls++
      return calls === 1 ? new Promise((r) => { release = r }) : Promise.resolve({ who: `read ${calls}` })
    }
    const h = mountHook(() => useClientRead(key, load, same<{ who: string }>), {})
    h.run(() => useAuthStore.setState({ user: null, token: null } as never))
    assert.deepEqual([h.current.status, h.current.data], ['loading', null])
    release({ who: 'the session before', dx: SECRET_DX })
    await h.settle(() => h.current.status === 'ready')
    await h.settle(() => false)
    assert.equal(h.current.data?.who, 'read 2', 'the answer asked before the sign-out is never drawn')
    h.unmount()
    const held = mountHook(() => useClientRead(key, load, same<{ who: string }>), {})
    assert.equal(held.current.data?.who, 'read 2', 'nor held')
    held.unmount()
    useAuthStore.setState({ user: { id: 'u-b' }, token: 'tok-b' } as never)
    const next = mountHook(() => useClientRead(key, load, same<{ who: string }>), {})
    assert.equal(next.current.status, 'loading', 'another account starts from nothing')
    next.unmount()
    useAuthStore.setState({ user: null, token: null } as never)
  })

  it('every app\'s answers go at a visit\'s start and again at its end', async () => {
    const load = (what: string) => async () => ({ what })
    const readers = () => [
      mountHook(() => useClientRead(clientKey('clientProfileDetails', 'kay_test'), load('client'), same), {}),
      mountHook(() => useStaffRead(staffKey('staffProfileHr', 'ann'), load('staff'), same), {}),
      mountHook(() => useLocationRead(locationKey('locationStaff', 'ZZ9999'), load('house'), same), {}),
      mountHook(() => useSsaRead(ssaKey('ssaProfileOverview', 'ssa_sam'), load('ssa'), same), {}),
    ]
    const first = readers()
    await first[0].settle(() => first.every((h) => h.current.status === 'ready'))
    for (const h of first) h.unmount()
    const warm = readers()
    assert.deepEqual(warm.map((h) => h.current.status), ['ready', 'ready', 'ready', 'ready'], 'held while nothing crossed')
    for (const h of warm) h.unmount()
    const epoch = useMemberStore.getState().memberEpoch
    useMemberStore.setState({ currentMemberId: 'mem-9', memberEpoch: epoch + 1 } as never)
    const inside = readers()
    assert.deepEqual(inside.map((h) => h.current.status), ['loading', 'loading', 'loading', 'loading'], 'a visit starts from nothing')
    await inside[0].settle(() => inside.every((h) => h.current.status === 'ready'))
    for (const h of inside) h.unmount()
    useMemberStore.setState({ currentMemberId: '', memberEpoch: epoch + 2 } as never)
    const out = readers()
    assert.deepEqual(out.map((h) => h.current.status), ['loading', 'loading', 'loading', 'loading'], 'nothing read inside comes out')
    for (const h of out) h.unmount()
  })
})

/* ---------- memory only ---------- */

describe('nothing read reaches any storage', () => {
  it('no answer, pack or slice row is written to localStorage or sessionStorage, and IndexedDB is never opened', async () => {
    const writes: [string, string][] = []
    const stores = [localStorage, sessionStorage] as unknown as { setItem: (k: string, v: string) => void }[]
    const own = stores.map((s) => s.setItem)
    stores.forEach((s, i) => {
      s.setItem = (k: string, v: string) => {
        writes.push([k, String(v)])
        own[i].call(s, k, v)
      }
    })
    let opened = 0
    const g = globalThis as { indexedDB?: unknown }
    const hadIdb = 'indexedDB' in g
    const idb = g.indexedDB
    g.indexedDB = { open: () => { opened++; throw new Error('no') } }
    try {
      useAuthStore.setState({ user: { id: 'u-a' }, token: 'tok-a' } as never)
      const secret = async () => ({ identity: { ssn: SECRET_SSN }, dx: SECRET_DX })
      const hooks = [
        mountHook(() => useClientRead(clientKey('clientProfileRoster', '*', false), () => readRoster(false), rosterOf, heldRoster), {}),
        mountHook(() => useClientRead(clientKey('clientProfileDetails', 'kay_test'), secret, same), {}),
        mountHook(() => useStaffRead(staffKey('staffProfileHr', 'ann'), secret, same), {}),
        mountHook(() => useLocationRead(locationKey('locationOverview', 'ZZ9999'), () => readPack('locations', 'ZZ9999'), same), {}),
        mountHook(() => useSsaRead(ssaKey('ssaProfileOverview', 'ssa_sam'), secret, same), {}),
      ]
      await hooks[0].settle(() => hooks.every((h) => h.current.status === 'ready'))
      prefetchPack('locations', 'ZB4060')
      await sleep(400)
      hooks[0].run(() => {
        clientWritten('kay_test', Date.now())
        staffWrote('ann', {})
      })
      await hooks[0].settle(() => hooks.every((h) => h.current.status === 'ready'))
      hooks[0].run(() => useAuthStore.setState({ user: null, token: null } as never))
      for (const h of hooks) h.unmount()
      assert.ok(seen.some((s) => s.kind === 'pack') && seen.some((s) => s.kind === 'slice'), 'the reads did run')
      const leaked = writes.filter(([k, v]) => [SECRET_SSN, SECRET_DX, 'Kay Test', 'kay_test', 'ZZ9999'].some((w) => `${k} ${v}`.includes(w)))
      assert.deepEqual(leaked, [], 'nothing clinical or personal is written to storage')
      assert.equal(opened, 0, 'IndexedDB is never opened')
    } finally {
      stores.forEach((s, i) => { s.setItem = own[i] })
      if (hadIdb) g.indexedDB = idb
      else delete g.indexedDB
    }
  })

  it('the cache, the packs and the four apps\' readers never touch a storage API', () => {
    const files = [
      'src/lib/readCache.ts', 'src/lib/appPack.ts',
      'src/pages/features/clientprofiles/useClientRead.ts', 'src/pages/features/clientprofiles/clientReads.ts',
      'src/pages/features/staffprofiles/useStaffRead.ts',
      'src/pages/features/locations/useLocation.ts', 'src/pages/features/locations/locationReads.ts',
      'src/pages/features/ssaprofiles/useSsaRead.ts', 'src/pages/features/ssaprofiles/ssaReads.ts',
    ]
    for (const f of files) {
      const src = readFileSync(resolve(ROOT, f), 'utf8')
      assert.doesNotMatch(src, /\b(localStorage|sessionStorage|indexedDB)\s*[.[]/, f)
    }
  })
})

/* ---------- the packs under the cache ---------- */

describe('the relay\'s packs: bounded, and prefetched two at a time from its memory alone', () => {
  it(`prefetches run ${PREFETCH_AT_ONCE} at a time at most, ask with ?peek=1, never wait, never reach Apps Script`, async () => {
    const opens: (() => void)[] = []
    gates = [0, 1, 2].map(() => new Promise<void>((r) => { opens.push(r) }))
    prefetchPack('locations', 'ZA1001')
    prefetchPack('locations', 'ZB1002')
    prefetchPack('locations', 'ZC1003')
    assert.equal(seen.length, 0, 'nothing before the browser is idle')
    await sleep(400)
    const packs = () => seen.filter((s) => s.kind === 'pack')
    assert.deepEqual(packs().map((s) => s.name), ['ZA1001', 'ZB1002'], 'two at once, the third waits its turn')
    for (const o of opens) o()
    await sleep(PREFETCH_GAP_MS + 500)
    assert.deepEqual(packs().map((s) => s.name), ['ZA1001', 'ZB1002', 'ZC1003'])
    assert.ok(packs().every((s) => s.q?.peek === '1' && s.q?.wait === undefined), JSON.stringify(packs()))
    assert.deepEqual(seen.filter((s) => s.kind === 'gas'), [], 'no Apps Script call')
    assert.equal(PREFETCH_AT_ONCE, 2)
  })

  it(`the tab holds ${PACK_MAX_HELD} packs at most; a pack used again stays`, async () => {
    for (let i = 0; i < PACK_MAX_HELD; i++) await readPack('locations', `ZK${1000 + i}`)
    assert.ok(peekPack('locations', 'ZK1000'))
    await readPack('locations', 'ZK1000')
    await readPack('locations', `ZK${1000 + PACK_MAX_HELD}`)
    assert.ok(peekPack('locations', 'ZK1000'), 'used again: it stays')
    assert.equal(peekPack('locations', 'ZK1001'), null, 'the least recently used went')
    assert.equal(seen.filter((s) => s.name === 'ZK1000').length, 1, 'a fresh pack answers without asking')
  })
})

/* ---------- the first paint ---------- */

describe('the switcher\'s first paint comes from the slices already in the tab', () => {
  it('Clients and SSA draw their roster on the first render, then read behind it; Locations its houses', async () => {
    assert.equal(heldRoster(), null, 'nothing held: nothing to draw yet')
    await Promise.all([readSlice('clients'), readSlice('houses')])
    const before = seen.length
    const h = mountHook(() => useClientRead(clientKey('clientProfileRoster', '*', false), () => readRoster(false), rosterOf, heldRoster), {})
    assert.equal(h.current.status, 'ready', 'drawn on the first render')
    assert.equal(h.current.refreshing, true, 'and read behind it')
    assert.deepEqual(h.current.data?.clients.map((c) => c.name), ['Kay Test', 'Lee Other'])
    assert.ok(!JSON.stringify(h.current.data).includes(SECRET_DX), 'the roster is narrowed to identity')
    await h.settle(() => !h.current.refreshing)
    assert.deepEqual(h.current.data?.clients.map((c) => c.name), ['Kay Test', 'Lee Other'])
    h.unmount()
    assert.equal(seen.slice(before).filter((s) => s.kind !== 'slice').length, 0, 'no pack and no action for the roster')
    assert.equal(JSON.stringify(heldSsaRoster()), JSON.stringify(await readSsaRoster(false)))
    assert.deepEqual(heldHouses()?.map((x) => x.code), ['ZZ9999', 'ZB4060'])
  })

  it('inside a visit nothing held at headquarters is drawn first', async () => {
    await readSlice('clients')
    assert.ok(heldRows('clients'))
    useMemberStore.setState({ currentMemberId: 'mem-9', memberEpoch: useMemberStore.getState().memberEpoch + 1 } as never)
    assert.equal(heldRows('clients'), null)
    assert.equal(heldRoster(), null)
    assert.equal(heldHouses(), null)
    useMemberStore.setState({ currentMemberId: '', memberEpoch: useMemberStore.getState().memberEpoch + 1 } as never)
  })
})
