/**
 * AN OWN ANSWER IS NEVER THE COMPANY'S. certTrackerList answers every person's
 * certifications to the master alone and anyone else only their own (Certs.gs),
 * and requirementStatesList does the same for the engine's states
 * (RequirementStates.gs). A screen that counts everyone must not draw one
 * person's rows as the estate: a plain list refuses an own answer with a
 * sentence written for the reader, and every screen that counts says it — an
 * em dash and why, never "0 of 1 people" and never "nothing expires".
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { api } from '@/lib/api'
import { invalidateAll } from '@/lib/apiCache'
import { TRACKER_OWN_ONLY, TrackerOwnOnly, isTrackerOwnOnly, trackerRowsOfAll } from '@/lib/certUploads'
import { isReaderError, readerSentence } from '@/lib/readerError'
import { useToastStore } from '@/stores/useToastStore'
import { CertificationsScreen, useCertificationReads } from '@/pages/features/compliance/CertificationsDashboard'
import { mountHook } from './react-host'

const root = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

/* ---------- drawing ------------------------------------------------------- */

function draw(node: ReactNode): string {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    return renderToString(createElement(MemoryRouter, null, node)).replace(/<!-- -->/g, '')
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}

/* ---------- the doors, answered at fetch ---------------------------------- */

type Sent = { resource?: string; action?: string; payload?: Record<string, unknown> }
type Answer = (sent: Sent) => unknown | Promise<unknown>
let answer: Answer = () => ({ status: 404, message: 'nothing here' })
let asked: Sent[] = []
const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    // the snapshot index is not there: every read goes to the live door
    if (init?.method !== 'POST') return new Response('', { status: 404 })
    const sent = JSON.parse(decodeURIComponent(String(init.body).slice('body='.length))) as Sent
    asked.push(sent)
    const envelope = await answer(sent)
    return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = realFetch
})
beforeEach(() => { invalidateAll(); asked = [] })
afterEach(() => {
  answer = () => ({ status: 404, message: 'nothing here' })
  invalidateAll()
})

const ok = (data: unknown) => ({ status: 200, data })
const down = (message: string) => ({ status: 500, message })
const tracker = (sent: Sent) => sent.action === 'certTrackerList'

const MIA_CERTS = [{ id: 'm1', personName: 'Mia Manager', certName: 'CPR', status: 'expired', expiresAt: '2024-01-01' }]
const MIA_MATRIX = [{ name: 'Mia Manager', role: 'Manager', dodd: 'valid', cpr: 'expired' }]

/* ---------- the plain list ----------------------------------------------- */

describe('a plain list of the tracker', () => {
  it('refuses an own answer with a sentence for the reader, and raises no toast or badge', async () => {
    answer = (sent) => (tracker(sent) ? ok({ rows: MIA_CERTS, scope: 'own', self: 'Mia Manager' }) : down('?'))
    const toasts = useToastStore.getState().toasts.length
    await assert.rejects(api.list('staffCerts' as never), (e: unknown) => {
      assert.ok(isTrackerOwnOnly(e) && isReaderError(e))
      assert.equal((e as TrackerOwnOnly).message, TRACKER_OWN_ONLY)
      assert.equal((e as TrackerOwnOnly).self, 'Mia Manager')
      return true
    })
    assert.equal(useToastStore.getState().toasts.length, toasts)
    // asked through the tracker's own door, for the view the resource names
    assert.deepEqual(asked.map((s) => [s.action, s.payload?.view]), [['certTrackerList', 'certs']])
  })

  it("hands the master's whole answer back as its rows", async () => {
    answer = (sent) => (tracker(sent)
      ? ok({ rows: [...MIA_MATRIX, { name: 'Ben Baker', dodd: 'missing' }], scope: 'all', self: '' })
      : down('?'))
    const rows = await api.list<{ name: string }>('certMatrix' as never)
    assert.deepEqual(rows.map((r) => r.name), ['Mia Manager', 'Ben Baker'])
    assert.equal(asked[0]?.payload?.view, 'matrix')
  })

  it('reads the scope, not the rows: an own answer is refused whatever it holds, an older answer is whole', () => {
    assert.throws(() => trackerRowsOfAll({ rows: [], scope: 'own', self: 'Mia Manager' }), (e: unknown) => isTrackerOwnOnly(e))
    assert.deepEqual(trackerRowsOfAll({ rows: [{ id: 'x' }], scope: 'all', self: '' }), [{ id: 'x' }])
    assert.deepEqual(trackerRowsOfAll({ rows: [{ id: 'x' }] }), [{ id: 'x' }])
    assert.throws(() => trackerRowsOfAll({ scope: 'all' }), /answered without its rows/)
  })

  it('only a refusal written for the reader carries a sentence; any other failure keeps the screen\'s own words', () => {
    assert.equal(readerSentence(new TrackerOwnOnly('Mia Manager')), TRACKER_OWN_ONLY)
    assert.equal(readerSentence(new Error('timeout')), '')
    assert.equal(readerSentence('down'), '')
  })
})

/* ---------- the Certifications dashboard ---------------------------------- */

describe('the Certifications dashboard counts the estate, so an own answer draws no census', () => {
  it('an own answer is an em dash and the sentence — never "of 1 people on the active roster"', async () => {
    answer = (sent) => (tracker(sent)
      ? ok({ rows: sent.payload?.view === 'matrix' ? MIA_MATRIX : MIA_CERTS, scope: 'own', self: 'Mia Manager' })
      : down('?'))
    const h = mountHook(() => useCertificationReads(), {})
    await h.settle(() => !h.current.loading)
    const reads = h.current
    h.unmount()
    assert.equal(reads.ownOnly, true)
    assert.deepEqual(reads.failed, [])
    assert.deepEqual([reads.matrix.length, reads.certs.length], [0, 0])
    const html = draw(<CertificationsScreen reads={reads} />)
    assert.ok(html.includes(TRACKER_OWN_ONLY.replace(/’/g, '&#x27;')) || html.includes(TRACKER_OWN_ONLY), html)
    assert.match(html, /— people on the active roster · — certification records/)
    assert.match(html, /Cannot be cleared for a shift<\/p><p[^>]*>—<\/p>/)
    assert.doesNotMatch(html, /of \d+ people on the active roster/)
    assert.doesNotMatch(html, /\d+ people on the active roster/)
    assert.doesNotMatch(html, /Neither source answered/)
  })

  it("the master's answer draws the census over the estate", async () => {
    answer = (sent) => (tracker(sent)
      ? ok({ rows: sent.payload?.view === 'matrix' ? MIA_MATRIX : MIA_CERTS, scope: 'all', self: '' })
      : down('?'))
    const h = mountHook(() => useCertificationReads(), {})
    await h.settle(() => !h.current.loading)
    const reads = h.current
    h.unmount()
    assert.equal(reads.ownOnly, false)
    const html = draw(<CertificationsScreen reads={reads} />)
    assert.match(html, /of 1 people on the active roster/)
    assert.doesNotMatch(html, /master’s alone to see|master&#x27;s alone to see/)
  })

  it('a read that failed is not an own answer: it is said as unread', async () => {
    answer = () => down('The estate did not answer')
    const h = mountHook(() => useCertificationReads(), {})
    await h.settle(() => !h.current.loading)
    const reads = h.current
    h.unmount()
    assert.equal(reads.ownOnly, false)
    assert.deepEqual([...reads.failed].sort(), ['certMatrix', 'staffCerts'])
    assert.match(draw(<CertificationsScreen reads={reads} />), /Neither source answered/)
  })
})

/* ---------- every other screen that counts everyone ----------------------- */

describe('the screens that count every person say an own answer, never count it', () => {
  it('Leadership: the donut and the expiring list carry the sentence, never zeros or "nothing expires"', () => {
    const src = read('src/pages/features/leadership/LeadershipPage.tsx')
    assert.match(src, /if \(isTrackerOwnOnly\(e\)\) setCertsOwnOnly\(true\)/)
    assert.match(src, /const certsWhy = certsOwnOnly \? TRACKER_OWN_ONLY :/)
    assert.match(src, /unavailable: broken\('staffCerts'\) \? certsWhy : undefined/)
    assert.match(src, /empty: broken\('staffCerts'\) \? certsWhy/)
    assert.match(src, /analysis, matrix, triage, forecast, certsOwnOnly\]\)/)
  })

  it('the dashboard donut draws an em dash and the sentence when its slices never landed', () => {
    const src = read('src/engine/templates/dashboard/index.tsx')
    const at = src.indexOf("case 'donut': {")
    const donut = src.slice(at, at + 700)
    assert.match(donut, /if \(w\.unavailable\) \{/)
    assert.match(donut, />—<\/p>/)
    assert.match(donut, /\{String\(w\.unavailable\)\}/)
  })

  it('OpsDash: one line says the certifications are private — no three counts of the caller', () => {
    const src = read('src/pages/features/opsdash/OpsDashPage.tsx')
    assert.match(src, /if \(isTrackerOwnOnly\(e\)\) setCertsOwnOnly\(true\)/)
    assert.match(src, /\.\.\.\(certsOwnOnly\n\s+\? \[\{ title: 'certifications', meta: `— \$\{TRACKER_OWN_ONLY\}`/)
    assert.match(src, /\[feeds, failed, matrix, certsOwnOnly\]/)
  })

  it('the company calendar draws no expiries from an own answer, says why, and never paints a copy from before', () => {
    const src = read('src/pages/features/calendar/CompanyCalendarPage.tsx')
    assert.match(src, /if \(!isTrackerOwnOnly\(e\)\) return\n\s+setCerts\(\[\]\)\n\s+setCertsWhy\(TRACKER_OWN_ONLY\)\n\s+keep\(CERTS_KEPT, null\)/)
    assert.match(src, /Certification expiries: — \{certsWhy\}/)
    assert.match(src, /const CERTS_KEPT = 'asa:cal:certs-all'/)
    assert.match(src, /localStorage\.removeItem\(CERTS_KEPT_BEFORE\)/)
    assert.doesNotMatch(src, /readKept<CertRow\[\]>\('asa:cal:certs'\)/)
  })

  it('the focus panel shows an em-dash chip and the sentence, never a missing chip', () => {
    const src = read('src/features/ops-flows/FocusRelations.tsx')
    assert.match(src, /const why = readerSentence\(e\)/)
    assert.match(src, /if \(refused\.staffCerts\) \{\n\s+facts\.push\(\{ label: 'Certifications', value: '—', tint: 'slate', why: refused\.staffCerts \}\)/)
    assert.match(src, /\{x\.label\}: — \{x\.why\}/)
  })

  it('a widget and a generic page say the refusal\'s sentence under their dash', () => {
    const card = read('src/pages/features/myasa/IndicatorCard.tsx')
    assert.match(card, /setWhy\(readerSentence\(e\)\); setFailed\(true\)/)
    assert.match(card, /\? why \|\| 'Could not read this right now'/)
    const page = read('src/engine/PageRenderer.tsx')
    assert.match(page, /setWhy\(readerSentence\(err\)\)/)
    assert.match(page, /\{why \|\| "Something went wrong while fetching this page's data\."\}/)
  })

  it('lib/api passes a reader\'s refusal straight to the screen — no floor, no toast, no badge', () => {
    const src = read('src/lib/api.ts')
    const at = src.indexOf('} catch (err) {', src.indexOf('async function runUncached'))
    assert.ok(at !== -1)
    assert.match(src.slice(at, at + 200), /if \(isReaderError\(err\)\) throw err/)
    assert.match(src, /trackerRowsOfAll\(await gas\.call<unknown>\(resource, 'certTrackerList', \{ view \}\)\)/)
  })

  it('no slice ever answers for the tracker, whichever door reads it — an older index can still list the file', () => {
    const src = read('src/lib/snapshotClient.ts')
    for (const fn of ['export async function readSlice<T>', 'export async function readSliceFloor<T>']) {
      const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 1600)
      const guard = body.indexOf('if (TRACKER_VIEWS[resource]) return null')
      assert.ok(guard !== -1, fn)
      assert.ok(guard < body.indexOf('slices.get(resource)') || body.indexOf('slices.get(resource)') === -1, fn)
    }
  })
})

/* ---------- the engine's states ------------------------------------------- */

describe("the compliance engine's states are the certificate tracker's by another name", () => {
  it('requirementStatesList settles whose rows before the tab is read, and says which it answered', () => {
    const gs = read('apps-script/RequirementStates.gs')
    const body = gs.slice(gs.indexOf('HUB_ACTIONS.requirementStatesList = function'))
    const whose = body.indexOf('complianceWhose_(user)')
    assert.ok(whose !== -1 && whose < body.indexOf('reqStatesListValues_('))
    assert.match(body, /if \(whose\.refusal\) return whose\.refusal/)
    assert.match(body, /key: whose\.all \? '' : whose\.self\.key/)
    assert.match(body, /scope: whose\.scope,\n\s+self: whose\.all \? '' : whose\.self\.name/)
  })

  it('the employee tracker draws another person\'s engine states and overall as private, and counts nobody over own answers', () => {
    const src = read('src/pages/features/employeetracker/EmployeeTrackerPage.tsx')
    assert.match(src, /gasAction<EngineAnswer>\('requirementStatesList', \{ limit: 2000 \}\)/)
    assert.match(src, /if \(d\?\.scope === 'own'\) statesSelf = String\(d\.self \?\? ''\)/)
    assert.match(src, /enginePrivate=\{isPrivateTo\(engineSelf, p\.name\)\}/)
    assert.match(src, /overallPrivate=\{overallHidden\(p\)\}/)
    assert.match(src, /label="Clear" value=\{ownScope \? '—' : counts\.clear\}/)
    assert.match(src, /label="Action needed" value=\{ownScope \? '—' : counts\.action\}/)
    assert.match(src, /engine\.length === 0 \|\| engineSelf !== null\n\s+\? '—'/)
    assert.match(src, /filter\(\(p\) => p\.overall === filter && !overallHidden\(p\)\)/)
    assert.match(src, /\{enginePrivate \? `\$\{ENGINE_PRIVATE\}\.` : 'The engine has materialized no state for this person\.'\}/)
  })

  it('the States screen titles an own answer as the caller\'s and never draws an unread matrix as empty', () => {
    const src = read('src/pages/features/engine/EngineStatesPage.tsx')
    assert.match(src, /setSelf\(res\?\.scope === 'own' \? String\(res\.self \?\? ''\) : null\)/)
    assert.match(src, /These are your own states/)
    assert.match(src, /\) : failure \? \(\n\s+<EmptyState\n\s+title="The states are not shown"/)
    assert.doesNotMatch(src, /title: 'Could not load the matrix'/)
  })
})
