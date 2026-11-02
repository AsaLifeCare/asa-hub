/**
 * Scheduling, fast and live: the board drawn at once from the copy kept for the account (after a reload too) and read
 * again quietly behind it; read again on the relay's `scheduling` ring, when the stream comes back and on a return to
 * the tab (at most once in 20 s), never while a write is out; a read that fails keeps the board and says so; a kept
 * copy is never drawn for another account and leaves at the memory boundary. Under it, the server's six-hour cache is
 * only safe because every sheet write in Scheduling moves the board's version — held here as source. The fixtures are
 * invented; the relay's stream and Apps Script are answered at `fetch`.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { useAuthStore } from '@/auth/useAuthStore'
import { keep } from '@/lib/kept'
import { startLiveUpdates } from '@/lib/snapshotClient'
import {
  BOARD_FOCUS_GAP_MS, KEPT_BOARD_PREFIX, KEPT_VIEW_PREFIX, SCHEDULING_LIVE_EVENT, forgetHeldBoards, forgetHeldViews, saveCell,
  useSchedulingBoard, useSchedulingRead,
} from '@/pages/features/scheduling/schedulingLane'
import { mountHook, type Mounted } from './react-host'

const ROOT = process.env.SPA_ROOT ?? process.cwd()

// a window that dispatches: the screen listens for focus on it
const windowEvents = new EventTarget()
for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const) {
  Object.defineProperty(globalThis, name, {
    value: (windowEvents[name] as (...a: unknown[]) => unknown).bind(windowEvents), configurable: true, writable: true,
  })
}

const PERIOD = { id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' }

/** A board whose `now` says which read made it and whose viewer says whose session asked. */
const boardRaw = (n: number, token: string) => ({
  ok: true, now: `read-${n}`, today: '2026-10-03', period: PERIOD, periods: [PERIOD],
  houses: [{ code: 'BM4060', location: 'CAN - BM - BM4060', short: 'BM', staff: 0, managers: [], open: 0 }],
  viewer: { uid: token, name: token, key: '', is_master: false, is_director: false, editor_of: [], can_edit_any: false },
  test_mode: { on: false, readable: true, why: '' }, display: { hidden: { hours: true } },
  settings: { min_days_ahead: 7, outreach_wait_min: 7, cycle_days: 28, roll_lead_days: 7, directors: [], directors_readable: true },
  grids: {}, busy: {}, people: [], mine: [], waiting_on_me: [],
})

let calls: string[] = []
let reads = 0
let failNext = false
let writeGate: Promise<void> | null = null
let push: ((frame: string) => void) | null = null
let closeStream: (() => void) | null = null
let stopLive: (() => void) | null = null

const realFetch = globalThis.fetch
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

before(async () => {
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/events')) {
      const enc = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (frame) => c.enqueue(enc.encode(frame))
          closeStream = () => { try { c.close() } catch { /* already closed */ } }
        },
      })
      return new Response(body, { status: 200 })
    }
    const env = JSON.parse(decodeURIComponent(String(init?.body ?? '').replace(/^body=/, ''))) as { action: string; token?: string }
    calls.push(env.action)
    if (env.action === 'schedulingBoard') {
      reads++
      if (failNext) {
        failNext = false
        return json({ status: 503, message: 'The Scheduling calendar could not be read just now — busy' })
      }
      return json({ status: 200, data: boardRaw(reads, env.token ?? '') })
    }
    if (writeGate) await writeGate
    return json({ status: 200, data: { ok: true, said: 'Saved.', period_id: PERIOD.id, grids: {}, busy: {},
      test_mode: { on: false, readable: true, why: '' } } })
  }) as typeof fetch
  stopLive = startLiveUpdates()
  for (let i = 0; i < 100 && !push; i++) await new Promise((r) => setTimeout(r, 5))
  assert.ok(push, 'the stream opened')
})

after(() => {
  stopLive?.()
  closeStream?.()
  globalThis.fetch = realFetch
})

let n = 0
beforeEach(() => {
  // every case is another account: a memory boundary between each
  n++
  useAuthStore.setState({ user: { id: `u-${n}` }, token: `tok-${n}` } as never)
  calls = []
  failNext = false
  writeGate = null
})

type Hook = ReturnType<typeof useSchedulingBoard>

function mount(): Mounted<{ period: string }, Hook> {
  return mountHook((p: { period: string }) => useSchedulingBoard(p.period), { period: '' })
}

/** Waits on the hook's own work, past the stream's reconnect wait if need be. */
async function until(h: Mounted<{ period: string }, Hook>, cond: () => boolean, ms = 1_500): Promise<void> {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await h.settle(cond)
}

const ring = (name: string) => push?.(`data: ${name}\n\n`)
const keptKeys = () => {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(KEPT_BOARD_PREFIX)) out.push(k)
  }
  return out
}

describe('the board is drawn at once and read again behind it', () => {
  it('after a reload the kept copy paints on the first render, then one quiet read replaces it', async () => {
    const a = mount()
    assert.equal(a.current.status, 'loading', 'nothing kept yet')
    await a.settle(() => a.current.status === 'ready')
    assert.equal(a.current.board?.now, `read-${reads}`)
    const first = reads
    a.unmount()
    assert.deepEqual(keptKeys(), [`${KEPT_BOARD_PREFIX}u-${n}|current`], 'kept for this account, this place, this period')

    forgetHeldBoards()
    const b = mount()
    assert.equal(b.current.status, 'ready', 'drawn on the first render')
    assert.equal(b.current.board?.now, `read-${first}`, 'from the kept copy')
    await until(b, () => b.current.board?.now === `read-${first + 1}`)
    assert.deepEqual([b.current.status, b.current.error, b.current.refreshing, reads], ['ready', '', false, first + 1])
    b.unmount()
  })

  it('a read that fails keeps the board drawn and says so; it never blanks the screen', async () => {
    const h = mount()
    await h.settle(() => h.current.status === 'ready')
    const shown = h.current.board?.now
    failNext = true
    ring(SCHEDULING_LIVE_EVENT)
    await until(h, () => h.current.error !== '')
    assert.equal(h.current.status, 'ready')
    assert.equal(h.current.board?.now, shown, 'the board from before stays')
    assert.match(h.current.error, /could not be read just now/)
    h.unmount()
  })
})

describe('read again on the ring, on the stream\'s return and on a return to the tab — nothing polls', () => {
  it('the relay\'s `scheduling` ring reads the board again; another name does not', async () => {
    assert.equal(SCHEDULING_LIVE_EVENT, 'scheduling')
    const h = mount()
    await h.settle(() => h.current.status === 'ready')
    const before = reads
    ring('housecal')
    await h.settle(() => false)
    assert.equal(reads, before, 'another screen\'s ring is not ours')
    ring(SCHEDULING_LIVE_EVENT)
    await until(h, () => h.current.board?.now === `read-${before + 1}`)
    assert.equal(reads, before + 1)
    await h.settle(() => false)
    assert.equal(reads, before + 1, 'one ring, one read — and no read after it on its own')
    h.unmount()
  })

  it('the stream coming back reads the board again: a ring missed while it was down is caught up', async () => {
    const h = mount()
    await h.settle(() => h.current.status === 'ready')
    const before = reads
    closeStream?.()
    await until(h, () => reads === before + 1, 6_000)
    assert.equal(reads, before + 1)
    h.unmount()
  })

  it('a return to the tab reads again, at most once in 20 s', async () => {
    const h = mount()
    await h.settle(() => h.current.status === 'ready')
    const before = reads
    h.run(() => { globalThis.dispatchEvent(new Event('focus')) })
    await h.settle(() => false)
    assert.equal(reads, before, 'just read: a focus inside the gap reads nothing')
    const realNow = Date.now
    try {
      const later = realNow() + BOARD_FOCUS_GAP_MS + 1_000
      Date.now = () => later
      h.run(() => { globalThis.dispatchEvent(new Event('focus')) })
      await until(h, () => reads === before + 1)
      h.run(() => { globalThis.dispatchEvent(new Event('focus')) })
      await h.settle(() => false)
      assert.equal(reads, before + 1, 'twice in a row is one read')
    } finally {
      Date.now = realNow
    }
    h.unmount()
  })
})

describe('never while a write is out', () => {
  it('a ring during a write waits for it: one read, sent after the write came back', async () => {
    const h = mount()
    await h.settle(() => h.current.status === 'ready')
    const before = reads
    let release = () => {}
    writeGate = new Promise<void>((r) => { release = r })
    const w = saveCell({ house: 'BM4060', row_id: 'P:annroe', date: '2026-10-03', value: '8A-4P', via: 'add' })
    await h.settle(() => calls.includes('schedulingCellSave'))
    ring(SCHEDULING_LIVE_EVENT)
    ring(SCHEDULING_LIVE_EVENT)
    await h.settle(() => false)
    assert.equal(reads, before, 'no read while the write is out')
    let answer: Awaited<typeof w> | null = null
    void w.then((a) => { answer = a })
    release()
    await h.settle(() => answer !== null)
    const landed = answer as Awaited<typeof w> | null
    assert.ok(landed, 'the write came back')
    h.run(() => h.current.absorb(landed))
    await until(h, () => reads === before + 1)
    await h.settle(() => false)
    assert.equal(reads, before + 1, 'the two rings owed one read')
    assert.ok(calls.lastIndexOf('schedulingBoard') > calls.indexOf('schedulingCellSave'), calls.join())
    assert.equal(h.current.board?.now, `read-${before + 1}`)
    h.unmount()
  })
})

describe('a kept copy is the account\'s own', () => {
  it('another account never draws it, a copy filed under its name for somebody else is refused, and a sign-out takes every one', async () => {
    const a = mount()
    await a.settle(() => a.current.status === 'ready')
    const theirs = a.current.board
    a.unmount()
    const owner = `u-${n}`
    assert.deepEqual(keptKeys(), [`${KEPT_BOARD_PREFIX}${owner}|current`])

    n++
    useAuthStore.setState({ user: { id: `u-${n}` }, token: `tok-${n}` } as never)
    assert.deepEqual(keptKeys(), [], 'the boundary took the last account\'s copy')
    keep(`${KEPT_BOARD_PREFIX}u-${n}|current`, { owner, board: theirs })
    const b = mount()
    assert.deepEqual([b.current.status, b.current.board], ['loading', null], 'nothing of the last account is drawn')
    await b.settle(() => b.current.status === 'ready')
    assert.equal(b.current.board?.viewer.uid, `tok-${n}`, 'the board this session read')
    b.unmount()

    useAuthStore.setState({ user: null, token: null } as never)
    assert.deepEqual(keptKeys(), [], 'signed out: no kept board is left')
  })
})

describe('Staff Calendars\' and Time Off Requests\' reads are held and kept the same way', () => {
  it('after a reload the kept view paints on the first render and is read again behind it; within a minute nothing is asked; another account never draws it', async () => {
    let viewReads = 0
    const read = async () => ({ n: ++viewReads })
    const mountView = () => mountHook((p: { k: string }) => useSchedulingRead<{ n: number }>(p.k, read), { k: 'timeoff|now' })
    const viewKeys = () => {
      const out: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(KEPT_VIEW_PREFIX)) out.push(k)
      }
      return out
    }
    const a = mountView()
    assert.equal(a.current.status, 'loading', 'nothing kept yet')
    await a.settle(() => a.current.status === 'ready')
    assert.equal(a.current.data?.n, 1)
    a.unmount()
    assert.deepEqual(viewKeys(), [`${KEPT_VIEW_PREFIX}u-${n}|timeoff|now`], 'kept for this account, this place, this view')

    forgetHeldViews()
    const b = mountView()
    assert.deepEqual([b.current.status, b.current.data?.n], ['ready', 1], 'drawn on the first render, from the kept copy')
    await b.settle(() => b.current.data?.n === 2)
    assert.equal(b.current.data?.n, 2, 'one quiet read replaced it')
    b.unmount()

    const c = mountView()
    await c.settle(() => false)
    assert.deepEqual([c.current.data?.n, viewReads], [2, 2], 'fresh: drawn and not asked again')
    c.unmount()

    n++
    useAuthStore.setState({ user: { id: `u-${n}` }, token: `tok-${n}` } as never)
    assert.deepEqual(viewKeys(), [], 'the boundary took the last account\'s copy')
    const d = mountView()
    assert.deepEqual([d.current.status, d.current.data], ['loading', null], 'nothing of the last account is drawn')
    await d.settle(() => d.current.status === 'ready')
    d.unmount()
  })
})

/* ---------- the server's six hours ---------- */

describe('the server caches the board six hours: every sheet write moves its version', () => {
  const gs = (f: string) => readFileSync(resolve(ROOT, 'apps-script', f), 'utf8')
  const fns = (src: string): Record<string, string> => {
    const out: Record<string, string> = {}
    const at = [...src.matchAll(/^function (\w+)\(/gm)]
    at.forEach((m, i) => { out[m[1]] = src.slice(m.index, i + 1 < at.length ? at[i + 1].index : src.length) })
    return out
  }
  const TOUCH = /\.(setValues?|setFormulas?|setNumberFormats?|appendRow|deleteRows?|insertRows\w*|clear\w*)\(/

  it('only two functions touch a sheet, both bump; the lock settles with a bump after the flush', () => {
    const sched = fns(gs('Scheduling.gs'))
    const flows = fns(gs('SchedulingFlows.gs'))
    const touching = Object.keys(sched).filter((k) => TOUCH.test(sched[k])).sort()
    assert.deepEqual(touching, ['schedPutLines_', 'schedRemove_'])
    assert.deepEqual(Object.keys(flows).filter((k) => TOUCH.test(flows[k])), [], 'the flows write only through the doors')
    const putters = [...Object.keys(sched), ...Object.keys(flows)]
      .filter((k) => k !== 'schedPutLines_' && /schedPutLines_\(/.test(sched[k] ?? flows[k]))
    assert.deepEqual(putters, ['schedWrite_'])
    assert.match(sched.schedWrite_, /schedBump_\(\)/)
    assert.match(sched.schedRemove_, /schedBump_\(\)/)
    assert.match(sched.schedSettle_, /flush\(\)[\s\S]*schedBump_\(\)/)
    assert.match(sched.schedLock_, /schedSettle_\(\)/)
    assert.match(gs('Scheduling.gs'), /^var SCHED_BOARD_TTL = 21600;$/m)
  })

  it('no other Apps Script file names a Scheduling house', () => {
    const tabs = /'sched_(cells|rows|flows|inbox|log|settings)'/
    const others = readdirSync(resolve(ROOT, 'apps-script'))
      .filter((f) => f.endsWith('.gs') && !/^(Scheduling|SchedulingFlows|SelfTestScheduling|SelfTestSchedulingFlows)\.gs$/.test(f))
      .filter((f) => tabs.test(gs(f)))
    assert.deepEqual(others, [])
  })
})
