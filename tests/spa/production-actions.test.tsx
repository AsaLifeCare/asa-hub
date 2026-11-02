import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeAllowsApp } from '@/lib/badgeAccess'
import { effectiveUserFrom } from '@/lib/effectiveUser'
import {
  OVERLAY_KEY, PRODUCTION_ACTION_HANDLERS, cardStatus, goLiveBanner, grouped, heroFigures, markAsks, mergeOverlay,
  opensTab, phaseActive, previewFetches, pruneOverlay, rehearsalWords, runAllLabel, runAllList, runLabel, runPayload,
  runSequence, statusOf, undoWords, undoable, withAction, withRun,
  type PAction, type PRun, type RunbookView, type TestSwitch,
} from '@/lib/productionActions'
import { productionActionsManifests } from '@/registry/apps-productionactions'
import ProductionActionsPage, {
  GoLiveStrip, MASTER_ONLY_TITLE, RunbookScreen, runbookGate, useRunbook, type Runbook,
} from '@/pages/features/productionactions/ProductionActionsPage'
import ProductionActionsHero from '@/pages/features/productionactions/ProductionActionsHero'
import { PreviewBody } from '@/pages/features/productionactions/PreviewSheet'
import { HistoryBody } from '@/pages/features/productionactions/HistorySheet'
import { draftFrom, payloadFrom, sortProblems } from '@/pages/features/productionactions/EditActionSheet'
import {
  NOT_ANSWERED, PRODUCTION_ACTIONS_PATH, useProductionActions, type RunbookState,
} from '@/pages/features/productionactions/useProductionActions'
import { mountHook } from './react-host'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const count = (html: string, re: RegExp) => (html.match(new RegExp(re.source, 'g')) ?? []).length

const ON: TestSwitch = { on: true, readable: true, word: 'on', why: '' }
const OFF: TestSwitch = { on: false, readable: true, word: 'off', why: '' }
const UNREAD: TestSwitch = { on: true, readable: false, word: 'unreadable', why: 'the configuration is 40 minutes old' }

function act(id: string, over: Partial<PAction> = {}): PAction {
  return {
    id, createdAt: '', updatedAt: '', updated_by: '', number: '1', phase: 'at', title: `Action ${id}`, system: 'S',
    kind: 'manual', handler: '', params: '', how: 'by hand', link: '', requires: '', effect: 'An effect.',
    enabled: 'yes', params_obj: {}, def_sha: `sha-${id}`, ...over,
  }
}

const banner = (id: string, over: Partial<PAction> = {}) =>
  act(id, { kind: 'automatic', handler: 'banner', params: '{"range":"G1:N1"}', params_obj: { range: 'G1:N1' }, ...over })

let seq = 0
function run(actionId: string, over: Partial<PRun> = {}): PRun {
  seq++
  return {
    id: `PR-${String(seq).padStart(3, '0')}`, createdAt: `2026-09-24T10:${String(seq).padStart(2, '0')}:00Z`,
    action_id: actionId, number: '4', title: 'T', act: 'run', result: 'ok', expect: 'real', test_mode: 'off', dial: 'send',
    by_email: 'boss@example.org', by_name: 'The Boss', client_id: `c-${seq}`, def_sha: `sha-${actionId}`, preview_sha: 'p',
    target: 'Master Messenger › Message Submissions › G1:N1', detail: '', undoes: '', mock_row_id: '', has_undo: true,
    ...over,
  }
}

function view(actions: PAction[], runs: PRun[], sw: TestSwitch | undefined, over: Partial<RunbookView> = {}): RunbookView {
  const fresh = { key: 'actions', label: 'Runbook', book: 'B', tab: 't', rows: actions.length, read_at: '', state: 'fresh' as const, why: '' }
  return { house: { actions: fresh, runs: { ...fresh, key: 'runs' } }, actions, runs, test_mode: sw, as_of: '2026-09-24T12:00:00Z', ...over }
}

function unreadRuns(v: RunbookView): RunbookView {
  const out = { ...v, house: { ...v.house, runs: { ...v.house.runs, state: 'unreadable' as const, why: 'its rows could not be read (OSError)' } } }
  delete out.runs
  return out
}

const master = { id: 'u-boss', name: 'The Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
const admin = { id: 'u-a', name: 'An Admin', email: 'a@example.org', role: 'admin', types: ['ADMIN'], isMaster: false }
const director = { id: 'u-d', name: 'Dora', email: 'd@example.org', role: 'staff', types: ['DIRECTOR'], isMaster: false }

const g = globalThis as unknown as Record<string, unknown>
const hadListeners = typeof g.addEventListener === 'function'
before(() => {
  if (!hadListeners) { g.addEventListener = () => {}; g.removeEventListener = () => {} }
})
after(() => {
  if (!hadListeners) { delete g.addEventListener; delete g.removeEventListener }
})

const nope = () => Promise.reject(new Error('not in this test'))
function screen(state: Partial<RunbookState>, v: RunbookView | null): string {
  const full: RunbookState = { status: 'ready', data: v, error: '', readAt: Date.parse('2026-09-24T12:05:00Z'), refreshing: false, ...state }
  const pa: Runbook = { state: full, view: v, refresh: async () => {}, preview: nope, run: nope, mark: nope, undo: nope, save: nope }
  return flat(renderToString(<MemoryRouter><RunbookScreen pa={pa} /></MemoryRouter>))
}

describe('the master alone', () => {
  const realFetch = globalThis.fetch
  let calls: { url: string; auth: string }[] = []
  let answer: (url: string, init?: RequestInit) => Response = () => new Response('{}')
  before(() => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url: String(url), auth: headers.Authorization ?? '' })
      return answer(String(url), init)
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  afterEach(() => { useAuthStore.setState({ user: null, token: null } as never); calls = [] })

  it('a non-master draws the master\'s-tool page, and the page\'s own gate and read fetch nothing for them', async () => {
    useAuthStore.setState({ user: admin, token: 'tok-admin' } as never)
    const html = renderToString(<MemoryRouter><ProductionActionsPage /></MemoryRouter>)
    assert.match(html, new RegExp(MASTER_ONLY_TITLE.replace(/'/g, '&#x27;')))
    const h = mountHook(() => useRunbook(), {})
    await h.settle(() => false)
    assert.equal(h.current.gate.open, false)
    assert.equal(calls.length, 0)
    h.unmount()
    useAuthStore.setState({ user: master, token: 'tok-boss' } as never)
    answer = () => new Response(JSON.stringify({ status: 200, data: view([act('a')], [], ON) }))
    const m = mountHook(() => useRunbook(), {})
    await m.settle(() => calls.length > 0)
    assert.equal(m.current.gate.open, true)
    assert.equal(calls[0].url, PRODUCTION_ACTIONS_PATH)
    m.unmount()
  })

  it('the page opens for the master alone: not an admin, not a director, not the master visiting or away', () => {
    const as = (u: Record<string, unknown>) => effectiveUserFrom(u as never, null)
    assert.equal(runbookGate(as(master), false).open, true)
    assert.equal(runbookGate(as(admin), false).open, false)
    assert.equal(runbookGate(as(director), false).open, false)
    assert.equal(runbookGate(null, false).open, false)
    const visiting = effectiveUserFrom(master as never, { memberId: 'u-s', name: 'Sam', role: 'staff', types: [] })
    assert.equal(runbookGate(visiting, false).open, false)
    assert.match(runbookGate(as(master), true).why, /headquarters only/)
    assert.equal(runbookGate(as(master), true).open, false)
    assert.doesNotMatch(runbookGate(as(admin), false).why, /door/)
  })

  it('the master\'s page reads its one door with the Bearer token', async () => {
    useAuthStore.setState({ user: master, token: 'tok-boss' } as never)
    answer = () => new Response(JSON.stringify({ status: 200, data: view([act('a')], [], ON) }))
    const h = mountHook(() => useProductionActions(true), {})
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(calls[0].url, '/erp-lanes/production-actions')
    assert.equal(calls[0].auth, 'Bearer tok-boss')
    h.unmount()
  })

  it('a 404 from the relay is the master\'s-tool page, not an empty runbook; a 503 is a failure to retry', async () => {
    useAuthStore.setState({ user: master, token: 'tok-boss' } as never)
    answer = () => new Response(JSON.stringify({ status: 404, reason: 'unknown', message: 'Unknown lane.' }))
    const h = mountHook(() => useProductionActions(true), {})
    await h.settle(() => h.current.state.status === 'refused')
    assert.equal(h.current.view, null)
    h.unmount()
    const refused = screen({ status: 'refused' }, null)
    assert.match(refused, /opens for the master&#x27;s own session only/)
    assert.doesNotMatch(refused, /404|relay/)
    answer = () => new Response(JSON.stringify({ status: 503, reason: 'unavailable',
      message: 'The runbook could not open: the master check could not be made. Try again.' }))
    const u = mountHook(() => useProductionActions(true), {})
    await u.settle(() => u.current.state.status === 'failed')
    assert.match(u.current.state.error, /master check could not be made/)
    u.unmount()
  })

  it('no App Control row: the app is the master\'s alone, whatever badge an admin or a director wears', () => {
    assert.equal(badgeAllowsApp('production-actions', director, { calendarbuilder: ['DIRECTOR'] }), false)
    assert.equal(badgeAllowsApp('production-actions', admin, { crm: ['ADMIN'] }), false)
    assert.equal(badgeAllowsApp('production-actions', master, {}), true)
    const app = productionActionsManifests[0]
    assert.deepEqual(app.audience, ['admin'])
    assert.equal(app.id, 'production-actions')
    assert.equal(app.pages[0].id, 'runbook')
  })
})

describe('the phases', () => {
  const actions = [act('c', { number: '10' }), act('a', { number: '9' }), act('b', { number: '2', phase: 'before' }),
    act('z', { number: '1', phase: 'after' }), act('off', { number: '3', enabled: 'no' }), act('d', { number: '9b' })]
  it('groups by phase and orders by number read naturally; a switched-off row goes to its own list', () => {
    const got = grouped(actions)
    assert.deepEqual(got.phases.map((p) => p.phase.id), ['before', 'at', 'after'])
    assert.deepEqual(got.phases[1].actions.map((a) => a.id), ['a', 'd', 'c'])
    assert.deepEqual(got.off.map((a) => a.id), ['off'])
  })
  it('Before go-live is always active; At and After only with test mode readably OFF', () => {
    for (const sw of [ON, UNREAD, undefined]) {
      assert.equal(phaseActive('before', sw), true)
      assert.equal(phaseActive('at', sw), false)
      assert.equal(phaseActive('after', sw), false)
    }
    assert.equal(phaseActive('at', OFF), true)
    assert.equal(phaseActive('after', OFF), true)
  })
})

describe('the card states', () => {
  const a = banner('mm', { number: '4' })
  const m = act('man', { phase: 'at' })
  const matrix: [string, PAction, () => PRun[], TestSwitch, string][] = [
    ['automatic, nothing done, test mode on', a, () => [], ON, 'waiting'],
    ['rehearsal with the current def_sha, on', a, () => [run('mm', { act: 'rehearse' })], ON, 'rehearsed'],
    ['rehearsal with the current def_sha, unreadable', a, () => [run('mm', { act: 'rehearse' })], UNREAD, 'rehearsed'],
    ['rehearsal with an old def_sha', a, () => [run('mm', { act: 'rehearse', def_sha: 'old' })], ON, 'waiting'],
    ['a failed rehearsal', a, () => [run('mm', { act: 'rehearse', result: 'failed' })], ON, 'waiting'],
    ['automatic, test mode off, phase active', a, () => [], OFF, 'ready'],
    ['run ok', a, () => [run('mm')], OFF, 'done'],
    ['run noop', a, () => [run('mm', { result: 'noop' })], OFF, 'done'],
    ['run ok then its undo', a, () => { const r = run('mm'); return [r, run('mm', { act: 'undo', undoes: r.id })] }, OFF, 'ready'],
    ['run ok then a refused undo', a, () => { const r = run('mm'); return [r, run('mm', { act: 'undo', undoes: r.id, result: 'refused' })] }, OFF, 'done'],
    ['a failed run', a, () => [run('mm', { result: 'failed' })], OFF, 'failed'],
    ['a refused run', a, () => [run('mm', { result: 'refused' })], OFF, 'failed'],
    ['a failed run, then a mark', a, () => [run('mm', { result: 'failed' }), run('mm', { act: 'mark' })], OFF, 'done'],
    ['manual in an active phase', m, () => [], OFF, 'needs'],
    ['manual in an inactive phase', m, () => [], ON, 'waiting'],
    ['mark', m, () => [run('man', { act: 'mark' })], OFF, 'done'],
    ['mark, then unmark', m, () => [run('man', { act: 'mark' }), run('man', { act: 'unmark' })], OFF, 'needs'],
    ['an unknown handler', banner('x', { handler: 'teleport' }), () => [], OFF, 'needs'],
    ['params that do not parse', banner('y', { params_obj: null, params_error: 'The params are not valid JSON.' }), () => [], ON, 'needs'],
  ]
  for (const [name, action, runs, sw, want] of matrix) {
    it(`${name} → ${want}`, () => assert.equal(statusOf(action, runs(), sw), want))
  }
  it('an unread History gives no status at all, never Ready from an empty list', () => {
    const v = unreadRuns(view([a, m], [], OFF))
    assert.equal(cardStatus(a, v), null)
    assert.equal(cardStatus(a, view([a], [run('mm')], OFF)), 'done')
  })
  it('only the newest real run that wrote something, not yet undone, can be undone', () => {
    const r1 = run('mm'), r2 = run('mm')
    assert.equal(undoable('mm', [r1, r2])?.id, r2.id)
    assert.equal(undoable('mm', [r1, r2, run('mm', { act: 'undo', undoes: r2.id })]), null)
    assert.equal(undoable('mm', [run('mm', { has_undo: false })]), null)
    assert.equal(undoable('mm', [run('mm', { act: 'rehearse' })]), null)
  })
})

describe('a rehearsal against a real run', () => {
  const a = banner('mm', { number: '4' })
  const b = banner('cl', { number: '5' })
  const early = banner('early', { number: '1', phase: 'before' })
  const man = act('man')
  const link = act('lnk', { kind: 'automatic', handler: 'link', params_obj: { url: 'https://example.org/' } })
  it('the button reads Rehearse with test mode on or unreadable, and Run now with it off', () => {
    assert.equal(runLabel(ON), 'Rehearse')
    assert.equal(runLabel(UNREAD), 'Rehearse')
    assert.equal(runLabel(undefined), 'Rehearse')
    assert.equal(runLabel(OFF), 'Run now')
    assert.equal(runAllLabel(ON), 'Rehearse all')
    assert.equal(runAllLabel(OFF), 'Run all ready')
  })
  it('a rehearsal says why it rehearses: on, or unreadable and so counted as on', () => {
    assert.match(rehearsalWords(ON), /^Test mode is on: this writes one mock row/)
    assert.match(rehearsalWords(UNREAD), /^Test mode could not be read, so it counts as on: this writes/)
    assert.match(rehearsalWords(undefined, true), /^Test mode could not be read, so it counts as on: each writes/)
  })
  it('the run carries expect and the preview\'s own preview_sha, to match the button', () => {
    assert.deepEqual(runPayload(a, { preview_sha: 'abc123' }, ON, 'c1'),
      { action_id: 'mm', client_id: 'c1', preview_sha: 'abc123', expect: 'rehearse' })
    assert.equal(runPayload(a, { preview_sha: 'abc123' }, UNREAD, 'c1').expect, 'rehearse')
    assert.equal(runPayload(a, { preview_sha: 'abc123' }, OFF, 'c1').expect, 'real')
  })
  it('Run all ready lists only the Ready automatic actions of active phases, and nothing while the History is unread', () => {
    const v = view([early, a, b, man, banner('broken', { handler: 'x' })], [run('cl')], OFF)
    assert.deepEqual(runAllList(v).map((x) => x.id), ['early', 'mm'])
    assert.deepEqual(runAllList(v, 'at').map((x) => x.id), ['mm'])
    assert.deepEqual(runAllList(unreadRuns(v)), [])
  })
  it('Rehearse all lists every automatic action in test mode, in every phase', () => {
    const v = view([early, a, b, man], [], ON)
    assert.deepEqual(runAllList(v).map((x) => x.id), ['early', 'mm', 'cl'])
    assert.deepEqual(runAllList(v, 'at').map((x) => x.id), ['mm', 'cl'])
  })
  it('a real Open-a-link run needs its own tab from the click; a rehearsal and a banner do not', () => {
    assert.equal(opensTab(link, OFF), true)
    assert.equal(opensTab(link, ON), false)
    assert.equal(opensTab(link, UNREAD), false)
    assert.equal(opensTab(a, OFF), false)
  })
  it('a manual Preview asks Apps Script nothing; marking an automatic action done asks first', () => {
    assert.equal(previewFetches(man), false)
    assert.equal(previewFetches(a), true)
    assert.equal(markAsks(a, true), true)
    assert.equal(markAsks(a, false), false)
    assert.equal(markAsks(man, true), false)
  })
  it('the Undo words follow the handler: cells for a banner, the form for form_close', () => {
    assert.match(undoWords('banner', 'MM › Tab › G1:N1'), /^Puts back MM › Tab › G1:N1: the cells as they were/)
    const form = undoWords('form_close', 'Google Form "Time off"')
    assert.match(form, /accepting answers or closed, with its old closed message/)
    assert.doesNotMatch(form, /cells|tab colour/)
  })
  it('the sequence runs one at a time and stops at the first failure', async () => {
    const order: string[] = []
    const got = await runSequence(['a', 'b', 'c'], async (id) => {
      order.push(id)
      return run(id, { result: id === 'b' ? 'refused' : 'ok', detail: id === 'b' ? 'Changed since the preview — preview again.' : '' })
    })
    assert.deepEqual(order, ['a', 'b'])
    assert.equal(got.ran.length, 2)
    assert.equal(got.stopped?.item, 'b')
    assert.match(got.stopped?.error ?? '', /preview again/)
    const thrown = await runSequence(['a', 'b'], async (id) => { if (id === 'a') throw new Error('network'); return run(id) })
    assert.equal(thrown.stopped?.item, 'a')
    assert.equal(thrown.ran.length, 1)
  })
})

describe('the black band and the banners', () => {
  const mm = banner('mm', { number: '4', title: 'Master Messenger: the online line' })
  const man = act('man', { number: '6', phase: 'at' })
  const early = act('pub', { number: '1', phase: 'before' })
  const hero = (v: RunbookView | null, status: 'ready' | 'failed' = 'ready') => flat(renderToString(
    <MemoryRouter>
      <ProductionActionsHero state={{ status, data: v, error: status === 'failed' ? 'the relay answered 503' : '', readAt: Date.parse('2026-09-24T12:05:00Z'), refreshing: false }}
        view={v} figures={heroFigures(v)} now={Date.parse('2026-09-24T12:10:00Z')} onRetry={() => {}} />
    </MemoryRouter>,
  ))
  const firstFigure = (html: string) => /font-stat text-\[34px\][^>]*>([^<]*)</.exec(html)?.[1]

  it('draws the four figures from the fixture', () => {
    const r = run('mm', { act: 'rehearse', number: '4', title: 'Master Messenger: the online line', createdAt: '2026-09-24T11:58:00Z' })
    const v = view([mm, man, early, act('m2', { phase: 'before', number: '2' })], [r, run('m2', { act: 'mark' })], ON)
    const f = heroFigures(v)!
    assert.equal(f.total, 4)
    assert.equal(f.ready, 0)
    assert.equal(f.rehearsed, 1)
    assert.equal(f.done, 1)
    assert.equal(f.waiting, 1)
    const html = hero(v)
    assert.match(html, /Go-live runbook · 4 actions/)
    assert.match(html, /1 rehearsed · 1 done of 4/)
    assert.match(html, />ON</)
    assert.match(html, /Run only rehearses — each run is a row in CommMock/)
    assert.match(html, /0 automatic · 1 manual/)
    assert.match(html, /12m ago/)
    assert.match(html, /#4 Master Messenger: the online line · rehearsed · by The Boss/)
    assert.match(html, /runbook up to date/)
  })

  it('a runbook that was not read is "—" with a short sentence, and the band leaves the reason and Try again to the page', () => {
    const v = view([], [], ON)
    delete v.actions
    v.house.actions = { ...v.house.actions, state: 'unreadable', why: 'Runbook has no tab \'production_actions\'' }
    const html = hero(v, 'failed')
    assert.equal(heroFigures(v), null)
    assert.equal(firstFigure(html), '—')
    assert.match(html, /Go-live runbook · —/)
    assert.doesNotMatch(html, /no tab/)
    assert.doesNotMatch(html, /Try again/)
    assert.doesNotMatch(html, /No figure is shown as 0|tools\/|\.py/)
    const page = screen({ status: 'failed', error: 'the relay answered 503' }, v)
    assert.equal(count(page, /Try again/), 1)
    assert.equal(count(page, /no tab/), 1)
  })

  it('the Test mode figure comes from the relay\'s switch even when the runbook is missing', () => {
    const v = view([], [], OFF)
    delete v.actions
    v.house.actions = { ...v.house.actions, state: 'missing', why: 'its Google Sheet is not set up yet' }
    const html = hero(v)
    assert.match(html, />OFF</)
    assert.match(html, /Go-live: a run touches the real systems/)
    assert.doesNotMatch(html, /Could not be read, so it counts as on/)
    assert.match(hero(view([mm], [], UNREAD)), /Could not be read, so it counts as on/)
  })

  it('an unread History: no status figure is 0, no card is Ready, no banner, and nothing is offered to run', () => {
    const v = unreadRuns(view([mm, man, early], [], OFF))
    assert.equal(heroFigures(v), null)
    assert.equal(goLiveBanner(v), null)
    const html = hero(v)
    assert.equal(firstFigure(html), '—')
    assert.match(html, /Go-live runbook · 3 actions/)
    assert.match(html, /History not read/)
    assert.match(html, /History could not be read: its rows could not be read \(OSError\)/)
    assert.doesNotMatch(html, /0 rehearsed · 0 done/)
    const page = screen({}, v)
    assert.equal(count(page, /data-status="unread"/), 3)
    assert.equal(count(page, /data-status="ready"/), 0)
    assert.match(page, /The History could not be read/)
    assert.doesNotMatch(page, /role="alert"/)
    assert.doesNotMatch(page, /Run all ready/)
    assert.match(page, /—\/1<\/span> done/)
  })

  it('the blood-red banner stands exactly while test mode is off and an At go-live action is open', () => {
    const open = view([mm, man, early], [], OFF)
    assert.deepEqual(goLiveBanner(open), { tone: 'red', count: 2 })
    const red = flat(renderToString(<GoLiveStrip banner={goLiveBanner(open)} busy={false} ready={runAllList(open, 'at').length} onRunAll={() => {}} />))
    assert.match(red, /bg-\[#8b0000\]/)
    assert.match(red, /Test mode is off\. 2 go-live actions are waiting for a click — the\s+old channels stay open until they run\./)
    assert.match(red, /Run all ready \(1\)/)
    const manualOnly = renderToString(<GoLiveStrip banner={{ tone: 'red', count: 1 }} busy={false} ready={0} onRunAll={() => {}} />)
    assert.match(manualOnly, /disabled=""/)
    assert.match(manualOnly, /marked done by hand/)
    assert.equal(goLiveBanner(view([mm, man, early], [run('mm'), run('man', { act: 'mark' })], OFF)), null)
    assert.equal(goLiveBanner(view([mm, man], [], ON)), null)
    assert.equal(goLiveBanner(view([mm, man], [], UNREAD)), null)
  })

  it('the amber line stands while test mode is on and a real run is still live and undoable', () => {
    const r = run('mm')
    const back = view([mm, man], [r], ON)
    assert.deepEqual(goLiveBanner(back), { tone: 'amber', count: 1 })
    const amber = flat(renderToString(<GoLiveStrip banner={goLiveBanner(back)} busy={false} ready={0} onRunAll={() => {}} />))
    assert.match(amber, /Test mode is on again, and 1 go-live change is still live in the\s+outside books\. Undo them if the go-live is rolled back\./)
    assert.equal(goLiveBanner(view([mm, man], [r, run('mm', { act: 'undo', undoes: r.id })], ON)), null)
    assert.equal(goLiveBanner(view([mm, man], [run('man', { act: 'mark' })], ON)), null)
  })
})

describe('the page, drawn whole for the master', () => {
  const mm = banner('mm', { number: '4', title: 'Master Messenger: the online line' })
  const pub = act('pub', { number: '1', phase: 'before' })
  const man = act('man', { number: '6', phase: 'at' })
  const late = act('late', { number: '10', phase: 'after' })
  const stray = act('stray', { number: '11', phase: 'during' })
  const retired = act('old', { number: '12', enabled: 'no' })

  it('three phases, a card per action, the No phase and Switched off sections, and ONE red Run all ready', () => {
    const html = screen({}, view([mm, pub, man, late, stray, retired], [], OFF))
    for (const h of ['Before go-live', 'At go-live', 'After go-live', 'No phase']) assert.match(html, new RegExp(h))
    for (const id of ['mm', 'pub', 'man', 'late', 'stray']) assert.match(html, new RegExp(`data-action="${id}"`))
    assert.doesNotMatch(html, /data-action="old"/)
    assert.match(html, /Switched off \(1\)/)
    assert.equal(count(html, /role="alert"/), 1)
    assert.equal(count(html, /Run all ready \(/), 1)
    assert.match(html, /data-action="mm" data-status="ready"/)
  })

  it('a runbook not set up, or not copied yet, is said in words for a reader, with Try again', () => {
    const missing = view([], [], ON)
    delete missing.actions
    missing.house.actions = { ...missing.house.actions, state: 'missing', why: 'its Google Sheet is not set up yet' }
    const html = screen({}, missing)
    assert.match(html, /The runbook is not set up yet/)
    assert.match(html, /Try again/)
    assert.doesNotMatch(html, /tools\/|\.py|keeper|mint/)
    const pending = { ...missing, house: { ...missing.house, actions: { ...missing.house.actions, state: 'pending' as const } } }
    assert.match(screen({}, pending), /The runbook is not in the platform&#x27;s copy yet/)
  })

  it('a first read that failed says it once, with one Try again', () => {
    const html = screen({ status: 'failed', error: 'the relay answered 503' }, null)
    assert.equal(count(html, /the relay answered 503/), 1)
    assert.equal(count(html, /Try again/), 1)
    assert.equal(count(html, /font-stat text-\[34px\][^>]*>0</), 0)
  })
})

describe('the sheets', () => {
  const man = act('man', { how: 'Open the form. Turn it off; say where to go' })
  it('a manual Preview shows its steps from the row, and says so when none are written', () => {
    const html = flat(renderToString(<MemoryRouter>
      <PreviewBody action={man} item={null} loading={false} error="" sw={OFF} busy={false} onRun={() => {}} />
    </MemoryRouter>))
    assert.equal(count(html, /<li>/), 3)
    assert.doesNotMatch(html, /Reading the target|Test mode/)
    const empty = flat(renderToString(<MemoryRouter>
      <PreviewBody action={{ ...man, how: '' }} item={null} loading={false} error="" sw={OFF} busy={false} onRun={() => {}} />
    </MemoryRouter>))
    assert.match(empty, /No steps are written yet — add them in Edit\./)
    assert.doesNotMatch(empty, /<ol/)
  })
  it('a failed automatic Preview says its error once', () => {
    const html = flat(renderToString(<MemoryRouter>
      <PreviewBody action={banner('mm')} item={null} loading={false} error="Apps Script timed out" sw={ON} busy={false} onRun={() => {}} />
    </MemoryRouter>))
    assert.equal(count(html, /Apps Script timed out/), 1)
    assert.match(html, /disabled=""/)
  })
  it('History offers Undo on the newest undoable real run only', () => {
    const a = banner('mm')
    const r1 = run('mm'), r2 = run('mm')
    const html = flat(renderToString(<HistoryBody action={a} runs={[r1, r2]} now={Date.now()} busy={false} onUndo={() => {}} />))
    assert.equal(count(html, / Undo<\/button>/), 1)
    assert.match(flat(renderToString(<HistoryBody action={a} runs={undefined} now={0} busy={false} onUndo={() => {}} />)),
      /The History could not be read/)
  })
  it('Edit: gid becomes a number, bold a boolean, a stray phase must be chosen, and a cleared tab colour is sent empty', () => {
    const b = banner('b', { params_obj: { book: 'x'.repeat(30), gid: 7, range: 'G1:N1', text: 'Hello there', bold: false } })
    const d = draftFrom(b)
    assert.equal(d['p.bold'], 'no')
    assert.equal(d['p.tab_color'], '#8B0000')
    const p = payloadFrom({ ...d, 'p.gid': '1542343678', 'p.tab_color': '' }) as { params: Record<string, unknown> }
    assert.equal(p.params.gid, 1542343678)
    assert.equal(p.params.bold, false)
    assert.equal(p.params.tab_color, '')
    const s = draftFrom(act('s', { phase: 'during' }))
    assert.equal(s.phase, '')
    assert.equal((payloadFrom(s) as { phase: string }).phase, '')
    assert.equal(draftFrom(null).phase, 'before')
    assert.equal(draftFrom(act('ok', { phase: 'after' })).phase, 'after')
  })
  it('Edit: every problem the server names is shown somewhere — the id and unknown params in the lists', () => {
    const got = sortProblems([{ field: 'id', words: 'The id is bad.' }, { field: 'phase', words: 'Choose a phase.' },
      { field: 'params.url', words: 'The link is https.' }, { field: 'params.gid', words: 'A number.' }], 'banner')
    assert.deepEqual(got.general.map((p) => p.field), ['id'])
    assert.deepEqual(got.params.map((p) => p.field), ['params.url'])
  })
})

describe('a write shows at once', () => {
  const realFetch = globalThis.fetch
  let relayRuns: PRun[] = []
  let relayActions: PAction[] = [banner('mm')]
  let gasAnswer: Record<string, unknown> = {}
  const sent: string[] = []
  before(() => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url) === PRODUCTION_ACTIONS_PATH) {
        return new Response(JSON.stringify({ status: 200, data: view(relayActions, relayRuns, ON) }))
      }
      sent.push(String(JSON.parse(decodeURIComponent(String(init?.body ?? '').replace(/^body=/, ''))).action))
      return new Response(JSON.stringify({ status: 200, data: gasAnswer }))
    }) as typeof fetch
    useAuthStore.setState({ user: master, token: 'tok-boss' } as never)
  })
  after(() => {
    globalThis.fetch = realFetch
    useAuthStore.setState({ user: null, token: null } as never)
    sessionStorage.removeItem(OVERLAY_KEY)
  })

  it('a run answered by Apps Script is on screen before the relay serves it, survives a remount, and goes when served', async () => {
    const fresh = run('mm', { act: 'rehearse', id: 'PR-FRESH', createdAt: '2026-09-24T12:00:00Z' })
    gasAnswer = { run: fresh }
    const h = mountHook(() => useProductionActions(true), {})
    await h.settle(() => h.current.state.status === 'ready')
    await h.current.run({ action_id: 'mm', client_id: 'c-x', preview_sha: 'p', expect: 'rehearse' })
    await h.settle(() => (h.current.view?.runs ?? []).some((r) => r.id === 'PR-FRESH'))
    assert.ok((h.current.view?.runs ?? []).some((r) => r.id === 'PR-FRESH'))
    assert.match(sessionStorage.getItem(OVERLAY_KEY) ?? '', /PR-FRESH/)
    h.unmount()

    const again = mountHook(() => useProductionActions(true), {})
    await again.settle(() => again.current.state.status === 'ready')
    assert.ok((again.current.view?.runs ?? []).some((r) => r.id === 'PR-FRESH'), 'the overlay survives the remount')
    assert.equal(statusOf(banner('mm'), again.current.view?.runs, ON), 'rehearsed')
    relayRuns = [fresh]
    await again.current.refresh()
    await again.settle(() => !(sessionStorage.getItem(OVERLAY_KEY) ?? '').includes('PR-FRESH'))
    assert.doesNotMatch(sessionStorage.getItem(OVERLAY_KEY) ?? '', /PR-FRESH/)
    assert.equal((again.current.view?.runs ?? []).filter((r) => r.id === 'PR-FRESH').length, 1)
    again.unmount()
  })

  it('an edit that changes only the title stays on screen until the relay serves that title', () => {
    const served = banner('mm', { title: 'Old title', updatedAt: '2026-09-24T10:00:00Z' })
    const saved = { ...served, title: 'New title', updatedAt: '2026-09-24T12:00:00Z' }
    const o = withAction({ runs: [], actions: [] }, saved, 1000)
    const before = view([served], [], ON)
    assert.equal(pruneOverlay(o, before, 2000).actions.length, 1)
    assert.equal(mergeOverlay(before, o)?.actions?.[0].title, 'New title')
    assert.equal(pruneOverlay(o, view([{ ...served, title: 'New title' }], [], ON), 2000).actions.length, 0)
    assert.equal(pruneOverlay(o, view([{ ...served, updatedAt: '2026-09-24T13:00:00Z' }], [], ON), 2000).actions.length, 0)
  })

  it('the merge is pure: an overlay run joins once, an overlay older than 30 minutes is dropped', () => {
    const v = view([banner('mm')], [], ON)
    const r = run('mm', { id: 'PR-O' })
    const o = withRun({ runs: [], actions: [] }, r, 1000)
    assert.deepEqual(mergeOverlay(v, o)?.runs?.map((x) => x.id), ['PR-O'])
    assert.equal(pruneOverlay(o, v, 1000 + 31 * 60 * 1000).runs.length, 0)
    assert.equal(pruneOverlay(o, { ...v, runs: [r] }, 2000).runs.length, 0)
    assert.equal(pruneOverlay(o, v, 2000).runs.length, 1)
  })

  it('the page calls only its own five doors, and an answer with no run or no items is said, never swallowed', async () => {
    relayActions = [banner('mm')]
    const h = mountHook(() => useProductionActions(true), {})
    await h.settle(() => h.current.state.status === 'ready')
    sent.length = 0
    gasAnswer = { run: run('mm'), items: { mm: { action_id: 'mm', problems: [] } }, action: banner('mm') }
    await h.current.preview(['mm'])
    await h.current.run({ action_id: 'mm', client_id: 'c', preview_sha: 'p', expect: 'rehearse' })
    await h.current.mark('mm', true)
    await h.current.undo('PR-1')
    await h.current.save({ id: 'mm' })
    assert.deepEqual(sent, ['productionActionPreview', 'productionActionRun', 'productionActionMark',
      'productionActionUndo', 'productionActionSave'])
    gasAnswer = { accepted: true }
    await assert.rejects(h.current.run({ action_id: 'mm', client_id: 'c2', preview_sha: 'p', expect: 'real' }), { message: NOT_ANSWERED })
    await assert.rejects(h.current.preview(['mm']), { message: NOT_ANSWERED })
    h.unmount()
  })
})

describe('one list of handlers', () => {
  it('PRODUCTION_ACTION_HANDLERS is PA_HANDLER_IDS in ProductionActions.gs', () => {
    const gs = read('apps-script/ProductionActions.gs')
    const m = /var PA_HANDLER_IDS = \[([^\]]*)\]/.exec(gs)
    assert.deepEqual([...PRODUCTION_ACTION_HANDLERS], (m?.[1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1)))
  })
  it('the page never calls a browser dialog', () => {
    const src = ['ProductionActionsPage.tsx', 'ActionCard.tsx', 'PreviewSheet.tsx', 'HistorySheet.tsx', 'EditActionSheet.tsx']
      .map((f) => read(`src/pages/features/productionactions/${f}`)).join('\n')
    assert.doesNotMatch(src, /window\.confirm|window\.alert|window\.prompt/)
  })
})
