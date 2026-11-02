/**
 * MY CALENDAR · your own time off into Scheduling, behind a switch. While your last route read says Scheduling takes
 * it, a request you add is asked of Scheduling's directors (myCalendarVacationFile); the switch off there files
 * through the Time Off door as always. A transport error is never followed by the other door. A chosen person's
 * calendar and a route never read file through Time Off, exactly as before. What you filed there is listed.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import RequestsCard, { RoutedRequests } from '@/pages/features/mycalendar/RequestsCard'
import { ROUTED_LINE } from '@/pages/features/mycalendar/RequestPanel'
import {
  fileAdd, forgetHeld, heldVacationRoute, isRouted, readVacationRoute, routeFrom, useVacationRoute, type RouteState,
} from '@/pages/features/mycalendar/useMyCalendar'
import type { MyCalendarView } from '@/pages/features/mycalendar/myCalendarModel'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: React.ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}

const ON = { on: true, readable: true, why: '', mine: [
  { flow_id: 'SF00000000A1', from: '2026-10-20', to: '2026-10-22', state: 'waiting', word: 'Waiting on the directors', decided_by: '', decided_at: '', note: '' },
  { flow_id: 'SF00000000A2', from: '2026-11-02', to: '2026-11-02', state: 'approved', word: 'Approved', decided_by: 'Brittany Anderson', decided_at: '2026-10-01T15:00:00Z', note: 'Enjoy' },
] }
const OFF = { on: false, readable: true, why: 'The switch is off.', mine: [] }

type Call = { kind: 'gas' | 'lane'; url: string; action?: string; payload?: unknown; body: string }

describe('my calendar · vacation route — the doors', () => {
  const realFetch = globalThis.fetch
  let calls: Call[] = []
  let gas: (action: string, payload: Record<string, unknown>) => unknown = () => ({ status: 200, data: OFF })
  let laneAnswer: () => unknown = () => ({ status: 200, data: { ref: 'TO00000000D4', asked: { house_manager: [], hm_mode: 'house_manager', directors: ['Ty Bond'] } } })
  before(() => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      if (body.startsWith('body=')) {
        const env = JSON.parse(decodeURIComponent(body.slice(5))) as { action: string; payload: Record<string, unknown> }
        calls.push({ kind: 'gas', url: String(url), action: env.action, payload: env.payload, body })
        const out = gas(env.action, env.payload)
        if (out instanceof Error) throw out
        return new Response(JSON.stringify(out))
      }
      calls.push({ kind: 'lane', url: String(url), body })
      return new Response(JSON.stringify(laneAnswer()))
    }) as typeof fetch
    useAuthStore.setState({ user: { id: 'u-maya', name: 'Maya Chen', role: 'staff', types: [] }, token: 'tok-maya' } as never)
  })
  after(() => {
    globalThis.fetch = realFetch
    useAuthStore.setState({ user: null, token: null } as never)
  })
  afterEach(() => {
    calls = []
    forgetHeld()
    gas = () => ({ status: 200, data: OFF })
  })

  it('a route never read files through the Time Off door, as before — no Apps Script call', async () => {
    assert.equal(heldVacationRoute(), null)
    const got = await fileAdd('2026-12-21', '2026-12-22', '')
    assert.equal(isRouted(got), false)
    assert.deepEqual(calls.map((c) => [c.kind, c.url]), [['lane', '/erp-lanes/time-off/request']])
  })

  it('the route read is myCalendarVacationRoute with nothing in it, held for the session', async () => {
    gas = () => ({ status: 200, data: ON })
    const r = await readVacationRoute()
    assert.equal(r.on, true)
    assert.equal(r.mine.length, 2)
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['myCalendarVacationRoute', {}]])
    assert.equal(heldVacationRoute()?.on, true)
  })

  it('on: your own request goes to myCalendarVacationFile {from, to, reason} and the panel shows what it said', async () => {
    gas = (action) => action === 'myCalendarVacationRoute' ? { status: 200, data: ON }
      : { status: 200, data: { ok: true, routed: true, flow_id: 'SF00000000B7', said: 'Asked. Both directors have it; the first answer decides.' } }
    await readVacationRoute()
    calls = []
    const got = await fileAdd('2026-12-21', '2026-12-22', 'family')
    assert.ok(isRouted(got))
    assert.deepEqual(got, { ref: 'SF00000000B7', routed: true, said: 'Asked. Both directors have it; the first answer decides.' })
    assert.deepEqual(calls[0], { ...calls[0], kind: 'gas', action: 'myCalendarVacationFile', payload: { from: '2026-12-21', to: '2026-12-22', reason: 'family' } })
    assert.ok(!calls.some((c) => c.kind === 'lane'), 'the Time Off door is never asked as well')
  })

  it('the switch off at the server: routed:false files through the Time Off door, unchanged', async () => {
    gas = (action) => action === 'myCalendarVacationRoute' ? { status: 200, data: ON }
      : { status: 200, data: { ok: true, routed: false, why: 'The switch is off.' } }
    await readVacationRoute()
    calls = []
    const got = await fileAdd('2026-12-21', '2026-12-22', '')
    assert.equal(isRouted(got), false)
    assert.deepEqual(calls.map((c) => c.kind === 'gas' ? c.action : c.url), ['myCalendarVacationFile', '/erp-lanes/time-off/request'])
    assert.deepEqual(JSON.parse(calls[1].body), { start: '2026-12-21', end: '2026-12-22', reason: '', houses: [] })
  })

  it('a refusal (7 days\' notice) is thrown as it was said, and the Time Off door is not asked', async () => {
    gas = (action) => action === 'myCalendarVacationRoute' ? { status: 200, data: ON }
      : { status: 409, message: 'Time off needs at least 7 days\' notice.' }
    await readVacationRoute()
    calls = []
    await assert.rejects(fileAdd('2026-10-02', '2026-10-03', ''), /7 days/)
    assert.ok(!calls.some((c) => c.kind === 'lane'))
  })

  it('a transport error is thrown, never followed by the other door', async () => {
    gas = (action) => action === 'myCalendarVacationRoute' ? { status: 200, data: ON } : new TypeError('network down')
    await readVacationRoute()
    calls = []
    await assert.rejects(fileAdd('2026-12-21', '2026-12-22', ''), /Network error/)
    assert.ok(!calls.some((c) => c.kind === 'lane'), 'never filed twice in two truths')
  })

  it('a chosen person\'s calendar files through Time Off even with the route on', async () => {
    gas = () => ({ status: 200, data: ON })
    await readVacationRoute()
    calls = []
    await fileAdd('2026-12-21', '2026-12-22', '', 'Bob Bee')
    assert.deepEqual(calls.map((c) => [c.kind, c.url]), [['lane', '/erp-lanes/time-off/request']])
  })

  it('a backend that does not answer the door yet reads as off, said nowhere; another failure is a quiet line', async () => {
    gas = () => ({ status: 404, message: 'Unknown action.' })
    const h = mountHook(() => useVacationRoute(true), {})
    await h.settle(() => h.current.status !== 'loading' && h.current.status !== 'idle')
    assert.equal(h.current.status, 'ready')
    assert.equal(h.current.route?.on, false)
    assert.equal(draw(<RoutedRequests state={h.current} />), '')
    h.unmount()
    gas = () => ({ status: 500, message: 'Apps Script timed out' })
    const f = mountHook(() => useVacationRoute(true), {})
    await f.settle(() => f.current.status === 'failed')
    assert.equal(f.current.status, 'failed')
    f.unmount()
  })

  it('the hook reads once for your own calendar and nothing when not enabled', async () => {
    gas = () => ({ status: 200, data: ON })
    const off = mountHook(() => useVacationRoute(false), {})
    await off.settle(() => false)
    assert.equal(calls.length, 0)
    off.unmount()
    const h = mountHook(() => useVacationRoute(true), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(h.current.route?.mine.length, 2)
    assert.ok(calls.every((c) => c.action === 'myCalendarVacationRoute'))
    h.unmount()
  })
})

describe('my calendar · vacation route — what is drawn', () => {
  const ready = (raw: unknown): RouteState => ({ status: 'ready', route: routeFrom(raw), error: '' })

  it('lists what you asked of Scheduling, with its word, its days and who decided', () => {
    const html = draw(<RoutedRequests state={ready(ON)} />)
    assert.ok(html.includes('Asked in Scheduling'))
    assert.ok(html.includes('data-routed-request="SF00000000A1"') && html.includes('Waiting on the directors'))
    assert.ok(html.includes('Approved') && html.includes('by Brittany Anderson') && html.includes('Enjoy'))
  })

  it('nothing when nothing was filed there; a quiet line when the read failed', () => {
    assert.equal(draw(<RoutedRequests state={ready(OFF)} />), '')
    assert.ok(draw(<RoutedRequests state={{ status: 'failed', route: null, error: 'x' }} />).includes('could not be read just now'))
  })

  it('a malformed answer is read as off with nothing listed', () => {
    const r = routeFrom({ on: 'yes', mine: [null, { flow_id: '' }, 'x'] })
    assert.equal(r.on, false)
    assert.deepEqual(r.mine, [])
  })

  it('the card draws the list on your own calendar, never on a chosen person\'s', () => {
    const base = cardView()
    const mine = draw(<RequestsCard view={base} acting={false} onOpen={noop} route={ready(ON)} />)
    assert.ok(mine.includes('data-routed-list=""'))
    const chosen = draw(<RequestsCard view={{ ...base, person: { ...base.person, own: false, name: 'Bob Bee' } }} acting={false} onOpen={noop} route={ready(ON)} />)
    assert.ok(!chosen.includes('data-routed-list'))
    assert.match(ROUTED_LINE, /7 days/)
  })
})

/** The smallest view RequestsCard reads (the shape my-calendar.test.tsx draws). */
function cardView(): MyCalendarView {
  return {
    scope: { mode: 'own', why: '', person: '' },
    person: { own: true, name: 'Maya Chen', key_why: '' },
    today: '2026-10-01',
    week: {
      from: '2026-09-28', to: '2026-10-04', this: '2026-09-28', prev: '2026-09-21', next: '2026-10-05',
      head: { state: 'ready', why: '', copied_at: '2026-10-01T13:14:00Z', stale: false, stale_why: '' }, days: [], notes: [],
    },
    requests: { state: 'ready', why: '', rows: [], figure: { year: 2026, approved_days: 0, waiting_days: 0, on_record_days: 0 }, as_of: '' },
    form: { may_file: true, may_file_why: '', reason_max: 500, max_days: 120, earliest: '2026-10-01' },
    test_mode: { on: false, readable: true, why: '' },
    read_at: '2026-10-01T13:20:00Z',
  }
}
