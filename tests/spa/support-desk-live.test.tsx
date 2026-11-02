/**
 * Support Requests, fast and live: the list drawn at once from the copy kept for the account (after a reload too) and
 * read again quietly behind it; read again on the relay's `support-desk` and `scheduling` rings, when the stream comes
 * back and on a return to the tab (at most once in 20 s), never while a write is out; a read that fails keeps the list
 * and says so; a kept copy is never drawn for another account and leaves at the memory boundary. Under it, the
 * server's six-hour cache is only safe because every write moves the list's version and what comes from outside the
 * houses is in its key — held here as source. The fixtures are invented; the relay's stream and Apps Script are
 * answered at `fetch`.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useAuthStore } from '@/auth/useAuthStore'
import { keep } from '@/lib/kept'
import { startLiveUpdates } from '@/lib/snapshotClient'
import {
  DESK_FOCUS_GAP_MS, KEPT_DESK_PREFIX, SUPPORT_DESK_LIVE_EVENT, SUPPORT_DESK_SCHED_EVENT, SUPPORT_DESK_VEHICLE_EVENT, decide,
  forgetHeld, useSupportDesk,
} from '@/pages/features/supportdesk/supportDeskLane'
import { mountHook, type Mounted } from './react-host'

const ROOT = process.env.SPA_ROOT ?? process.cwd()

// a window that dispatches: the screen listens for focus on it
const windowEvents = new EventTarget()
for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const) {
  Object.defineProperty(globalThis, name, {
    value: (windowEvents[name] as (...a: unknown[]) => unknown).bind(windowEvents), configurable: true, writable: true,
  })
}

/** A list whose `now` says which read made it and whose viewer says whose session asked. */
const listRaw = (n: number, token: string) => ({
  ok: true, now: `read-${n}`, today: '2026-10-01',
  viewer: { uid: token, name: token, is_master: false, is_director: true, is_lead: false, can_decide: true },
  test_mode: { on: false, readable: true, why: '' }, directors: [], leads: [], directors_readable: true, directors_why: '',
  automations: {}, sources: [], counts: { open: 0, waiting_on_me: 0, warnings: 0, completed: 0 }, note: '', rows: [],
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
    if (env.action === 'supportDeskList') {
      reads++
      if (failNext) {
        failNext = false
        return json({ status: 503, message: 'Support Requests could not be read just now (busy).' })
      }
      return json({ status: 200, data: listRaw(reads, env.token ?? '') })
    }
    if (writeGate) await writeGate
    return json({ status: 200, data: { ok: true, changed: true, said: 'Approved.' } })
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

type Hook = ReturnType<typeof useSupportDesk>

function mount(): Mounted<{ completed: boolean }, Hook> {
  return mountHook((p: { completed: boolean }) => useSupportDesk(p.completed), { completed: false })
}

/** Waits on the hook's own work, past the stream's reconnect wait if need be. */
async function until(h: Mounted<{ completed: boolean }, Hook>, cond: () => boolean, ms = 1_500): Promise<void> {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await h.settle(cond)
}

const ring = (name: string) => push?.(`data: ${name}\n\n`)
const keptKeys = () => {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(KEPT_DESK_PREFIX)) out.push(k)
  }
  return out
}

describe('the list is drawn at once and read again behind it', () => {
  it('after a reload the kept copy paints on the first render, then one quiet read replaces it', async () => {
    const a = mount()
    assert.equal(a.current.status, 'loading', 'nothing kept yet')
    await a.settle(() => a.current.status === 'ready')
    assert.equal(a.current.board?.now, `read-${reads}`)
    const first = reads
    a.unmount()
    assert.deepEqual(keptKeys(), [`${KEPT_DESK_PREFIX}u-${n}|open`], 'kept for this account, this place, this switch')

    forgetHeld()
    const b = mount()
    assert.equal(b.current.status, 'ready', 'drawn on the first render')
    assert.equal(b.current.board?.now, `read-${first}`, 'from the kept copy')
    await until(b, () => b.current.board?.now === `read-${first + 1}`)
    assert.deepEqual([b.current.status, b.current.error, b.current.refreshing, reads], ['ready', '', false, first + 1])
    b.unmount()
  })

  it('a read that fails keeps the list drawn and says so; it never blanks the screen', async () => {
    const h = mount()
    await h.settle(() => h.current.status === 'ready')
    const shown = h.current.board?.now
    failNext = true
    ring(SUPPORT_DESK_LIVE_EVENT)
    await until(h, () => h.current.error !== '')
    assert.equal(h.current.status, 'ready')
    assert.equal(h.current.board?.now, shown, 'the list from before stays')
    assert.match(h.current.error, /could not be read just now/)
    h.unmount()
  })
})

describe('read again on the rings, on the stream\'s return and on a return to the tab — nothing polls', () => {
  it('the relay\'s `support-desk`, `scheduling` and `vehicle-calendar` rings read the list again; another name does not', async () => {
    assert.deepEqual([SUPPORT_DESK_LIVE_EVENT, SUPPORT_DESK_SCHED_EVENT, SUPPORT_DESK_VEHICLE_EVENT],
      ['support-desk', 'scheduling', 'vehicle-calendar'])
    const h = mount()
    await h.settle(() => h.current.status === 'ready')
    const before = reads
    ring('housecal')
    await h.settle(() => false)
    assert.equal(reads, before, 'another screen\'s ring is not ours')
    ring(SUPPORT_DESK_LIVE_EVENT)
    await until(h, () => h.current.board?.now === `read-${before + 1}`)
    ring(SUPPORT_DESK_SCHED_EVENT)
    await until(h, () => h.current.board?.now === `read-${before + 2}`)
    ring(SUPPORT_DESK_VEHICLE_EVENT)
    await until(h, () => h.current.board?.now === `read-${before + 3}`)
    await h.settle(() => false)
    assert.equal(reads, before + 3, 'one ring, one read — and no read after it on its own')
    h.unmount()
  })

  it('the stream coming back reads the list again: a ring missed while it was down is caught up', async () => {
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
      const later = realNow() + DESK_FOCUS_GAP_MS + 1_000
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
  it('a ring during a decision waits for it: one read, sent after the answer came back', async () => {
    const h = mount()
    await h.settle(() => h.current.status === 'ready')
    const before = reads
    let release = () => {}
    writeGate = new Promise<void>((r) => { release = r })
    const w = decide('HQ5EF1CB5F25', 'approve')
    await h.settle(() => calls.includes('supportDeskDecide'))
    ring(SUPPORT_DESK_LIVE_EVENT)
    ring(SUPPORT_DESK_LIVE_EVENT)
    await h.settle(() => false)
    assert.equal(reads, before, 'no read while the write is out')
    let landed = false
    void w.then(() => { landed = true })
    release()
    await h.settle(() => landed)
    await until(h, () => reads === before + 1)
    await h.settle(() => false)
    assert.equal(reads, before + 1, 'the two rings owed one read')
    assert.ok(calls.lastIndexOf('supportDeskList') > calls.indexOf('supportDeskDecide'), calls.join())
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
    assert.deepEqual(keptKeys(), [`${KEPT_DESK_PREFIX}${owner}|open`])

    n++
    useAuthStore.setState({ user: { id: `u-${n}` }, token: `tok-${n}` } as never)
    assert.deepEqual(keptKeys(), [], 'the boundary took the last account\'s copy')
    keep(`${KEPT_DESK_PREFIX}u-${n}|open`, { owner, board: theirs })
    const b = mount()
    assert.deepEqual([b.current.status, b.current.board], ['loading', null], 'nothing of the last account is drawn')
    await b.settle(() => b.current.status === 'ready')
    assert.equal(b.current.board?.viewer.uid, `tok-${n}`, 'the list this session read')
    b.unmount()

    useAuthStore.setState({ user: null, token: null } as never)
    assert.deepEqual(keptKeys(), [], 'signed out: no kept list is left')
  })
})

/* ---------- the server's six hours ---------- */

describe('the server caches the list six hours: every write moves its version, and the outside is in its key', () => {
  const gs = readFileSync(resolve(ROOT, 'apps-script/SupportDesk.gs'), 'utf8')
  const fns: Record<string, string> = {}
  const at = [...gs.matchAll(/^function (\w+)\(/gm)]
  at.forEach((m, i) => { fns[m[1]] = gs.slice(m.index, i + 1 < at.length ? at[i + 1].index : gs.length) })
  const TOUCH = /\.(setValues?|setFormulas?|setNumberFormats?|appendRow|deleteRows?|insertRows\w*|clear\w*)\(/

  it('one function touches a sheet, through the one write door that bumps', () => {
    assert.deepEqual(Object.keys(fns).filter((k) => TOUCH.test(fns[k])), ['sdPutLines_'])
    assert.deepEqual(Object.keys(fns).filter((k) => k !== 'sdPutLines_' && /sdPutLines_\(/.test(fns[k])), ['sdWrite_'])
    assert.match(fns.sdWrite_, /sdBump_\(\)/)
    assert.match(gs, /^var SD_LIST_TTL = 21600;$/m)
    assert.match(fns.sdBase_, /sdOutsideStamp_\(\)/)
    for (const outside of ['hubMyWorkAutoRead_', 'sdDirectors_', 'sdLeads_', 'usersAll_', 'sdDayOfMs_']) {
      assert.match(fns.sdOutsideStamp_, new RegExp(`${outside}\\(`), outside)
    }
  })

  it('the relay rings `support-desk` after every Support Requests write and every Scheduling write it carried', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    assert.equal((relay.match(/_relay_observe_support_desk\(action, (res|again)\.content\)/g) ?? []).length, 4)
    assert.match(relay, /_publish_slice\(SUPPORT_DESK_EVENT\)/)
  })
})
