/**
 * MY INBOX · "I'm aware". A warning addressed to the person is red (the pink tile, the triangle, the danger bar),
 * opens its own side panel, and is answered there — pressed twice — through its source's door: Support Requests'
 * supportInboxAnswer ('aware') or Scheduling's schedulingAnswer ('seen'). The answer is held here until the mirror
 * shows it, Clear is not offered on a warning nobody has answered, and the master looking at somebody gets no act.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { AlertRow } from '@/components/shared/AlertRow'
import * as model from '@/pages/features/myinbox/myInboxModel'
import type { AlertAct, AlertItem, MyInboxView } from '@/pages/features/myinbox/myInboxModel'
import { ACTING_LINE, AlertPanelBody, answerAct } from '@/pages/features/myinbox/AlertPanel'
import { AlertsScreen } from '@/pages/features/myinbox/AlertsView'
import { MY_INBOX_IDLE, forgetHeld, useMyInbox, type MyInboxState } from '@/pages/features/myinbox/useMyInbox'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const draw = (node: React.ReactNode) => flat(renderToString(<MemoryRouter initialEntries={['/app/my-inbox/alerts']}>{node}</MemoryRouter>))
const noop = () => {}

const act = (over: Partial<AlertAct> = {}): AlertAct => ({
  kind: 'aware', action: 'supportInboxAnswer', item_id: 'SN0123456789', label: 'I’m aware', done: false, by: '', at: '', ...over,
})

function item(id: string, over: Partial<AlertItem> = {}): AlertItem {
  return { id, type: 'support', title: `Alert ${id}`, body: `About ${id}`, at: '2026-09-30T14:00:00Z', flag: true, link: null, read: false, ...over }
}

const WARN = item('sreq:SN0123456789', {
  title: 'Late Show — Maria Lopez', body: 'BM4060 · 8A-4P · Wednesday. Directors, are you aware?', level: 'warning', act: act(),
  link: { href: '/app/support-desk/requests?ref=SE00AA11BB22', label: 'Open in Support Requests' },
})
const SCHED = item('sched:SI0000000009', { type: 'scheduling', title: 'Call-off — Ann Roe', level: 'warning',
  act: act({ action: 'schedulingAnswer', item_id: 'SI0000000009' }) })
const INCIDENT = item('sreq:SN00000000AA', { title: 'Incident filed — Minor injury', level: 'important',
  act: act({ item_id: 'SN00000000AA' }) })
const INFO = item('sreq:SN00000000BB', { title: 'Payroll from Angel Fiber', level: 'info', flag: false,
  act: act({ kind: 'seen', item_id: 'SN00000000BB', label: 'Seen' }) })

function view(items: AlertItem[], over: Partial<MyInboxView> = {}): MyInboxView {
  return {
    scope: { mode: 'own', why: '', person: '', readonly: false },
    subject: { name: 'Ty Bond', key_why: '' },
    heads: [], items, unread: items.filter((i) => !i.read).length, capped: '',
    marks: { readable: true, why: '', kept: true, kept_why: '' }, read_at: '',
    ...over,
  }
}

describe('my inbox aware — the model', () => {
  it('Support Requests is a type of its own, with its chip and its look', () => {
    assert.equal(model.typeOfChip('Support Requests'), 'support')
    assert.deepEqual(model.lookOf('support'), { icon: 'life-buoy', tint: 'blue', label: 'Support Requests' })
  })

  it('a warning is the pink tile with the triangle; an important one amber with the flag; others their type\'s', () => {
    assert.deepEqual(model.lookFor(WARN), { icon: 'triangle-alert', tint: 'pink' })
    assert.deepEqual(model.lookFor(INCIDENT), { icon: 'flag', tint: 'amber' })
    assert.deepEqual(model.lookFor(INFO), { icon: 'life-buoy', tint: 'blue' })
    assert.deepEqual(model.lookFor({ type: 'scheduling' }), { icon: 'calendar-clock', tint: 'blue' })
  })

  it('the pill asks until answered', () => {
    assert.deepEqual(model.levelPill(WARN), { text: 'Directors, are you aware?', tone: 'danger' })
    assert.deepEqual(model.levelPill({ ...WARN, act: act({ done: true }) }), { text: 'Aware', tone: 'good' })
    assert.deepEqual(model.levelPill(INCIDENT), { text: 'Important', tone: 'warning' })
    assert.equal(model.levelPill(INFO), null)
  })

  it('each door is handed its own word', () => {
    assert.deepEqual(model.actPayload(WARN.act!), { item_id: 'SN0123456789', word: 'aware' })
    assert.deepEqual(model.actPayload(SCHED.act!), { item_id: 'SI0000000009', word: 'seen' })
    assert.deepEqual(model.actPayload(INFO.act!), { item_id: 'SN00000000BB', word: 'seen' })
  })

  it('Clear is not offered on a warning nobody answered — one at a time or all read at once', () => {
    assert.equal(model.clearable(WARN), false)
    assert.equal(model.clearable({ ...WARN, act: act({ done: true }) }), true)
    assert.equal(model.clearable(INCIDENT), true)
    assert.equal(model.clearable(item('punch:x')), true)
    const read = [{ ...WARN, read: true }, { ...INFO, read: true }]
    assert.deepEqual(model.readKeys(read), ['sreq:SN00000000BB'])
  })

  it('an answer held here draws the alert read and answered, until the mirror says so', () => {
    const v = view([WARN, INFO])
    const marked = model.applyMarks(v, new Map([[WARN.id, 'aware']] as const))
    assert.equal(marked.items[0].read, true)
    assert.equal(marked.items[0].act?.done, true)
    assert.equal(marked.unread, 1)
    assert.equal(model.opensPanel(WARN), true)
    assert.equal(model.opensPanel(item('punch:x')), false)
  })

  it('an alert without level or act is drawn exactly as before', () => {
    const plain = item('punch:s1', { type: 'punch' })
    assert.equal(model.applyMarks(view([plain]), new Map([[plain.id, 'read']] as const)).items[0].act, undefined)
    assert.equal(model.levelPill(plain), null)
  })
})

describe('my inbox aware — the row and the panel', () => {
  it('a warning row is red: the danger bar and wash, the pill, no Clear while unanswered', () => {
    const state: MyInboxState = { ...MY_INBOX_IDLE, status: 'ready', data: view([WARN, INFO]), readAt: 1 }
    const html = draw(<AlertsScreen state={state} view={view([WARN, INFO])} chat={null} chooser={null} person="" acting={false}
      onPerson={noop} onOpen={noop} onMarkRead={noop} onClear={noop} onRetry={noop} />)
    assert.match(html, /data-level="warning"[^>]*class="[^"]*color-mix\(in_srgb,var\(--danger\)/)
    assert.ok(html.includes('bg-danger'), 'the danger bar')
    assert.ok(html.includes('lucide-triangle-alert') || html.includes('triangle-alert'), 'the triangle')
    assert.ok(html.includes('data-row-pill="danger"') && html.includes('Directors, are you aware?'))
    const warnRow = html.slice(html.indexOf(`data-alert="${WARN.id}"`), html.indexOf(`data-alert="${INFO.id}"`))
    assert.ok(!warnRow.includes('aria-label="Clear"'), 'no Clear on the unanswered warning')
    const infoRow = html.slice(html.indexOf(`data-alert="${INFO.id}"`))
    assert.ok(infoRow.includes('aria-label="Clear"'))
    assert.ok(!/<button[^>]*data-act-press/.test(html), 'the answer lives in the panel, never in the row')
  })

  it('a row with no level is painted as before', () => {
    const html = draw(<AlertRow icon="clock" tint="amber" title="No punch" body="" when="Sep 26" read={false} flag={false}
      canOpen={false} selectMode={false} selected={false} onSelect={noop} onOpen={noop} />)
    assert.ok(html.includes('bg-primary-soft') && !html.includes('data-level') && !html.includes('data-row-pill'))
  })

  it('the panel: the pill, the body, the way to its app and the act, pressed twice', () => {
    const html = draw(<AlertPanelBody item={WARN} acting={false} onAnswered={noop} />)
    assert.ok(html.includes('data-level-pill="warning"') && html.includes('Directors, are you aware?'))
    assert.ok(html.includes('BM4060 · 8A-4P'))
    assert.ok(html.includes('data-open-link=""') && html.includes('Open in Support Requests'))
    assert.ok(html.includes('data-act-press="aware"') && html.includes('I’m aware'))
    assert.ok(read('src/pages/features/myinbox/AlertPanel.tsx').includes('export const ARM_MS = 4000'))
  })

  it('answered: the panel says when; a switched session answers nothing; the master looking at somebody gets no act', () => {
    const done = draw(<AlertPanelBody item={{ ...WARN, act: act({ done: true, at: '2026-09-30T14:42:00Z', by: 'Ty Bond' }) }} acting={false} onAnswered={noop} />)
    assert.ok(done.includes('You marked this at Sep 30, 2026, 10:42 AM (Ty Bond).') && !done.includes('data-act-press'))
    const acting = draw(<AlertPanelBody item={WARN} acting onAnswered={noop} />)
    assert.ok(acting.includes(ACTING_LINE) && !acting.includes('data-act-press'))
    const looking = draw(<AlertPanelBody item={{ ...WARN, act: undefined }} acting={false} onAnswered={noop} />)
    assert.ok(!looking.includes('data-act-press') && looking.includes('answered by the person it is addressed to'))
  })

  it('a click on an alert with an act opens the panel, not its link', () => {
    const src = read('src/pages/features/myinbox/AlertsView.tsx')
    assert.ok(src.includes('if (opensPanel(item)) { setPanelId(item.id); return }'))
    assert.ok(src.includes('<AlertPanel item={panelItem}'))
  })
})


describe('my inbox aware — the doors', () => {
  const realFetch = globalThis.fetch
  let calls: { url: string; action?: string; payload?: unknown; body: string }[] = []
  let gasAnswer: () => unknown = () => ({ status: 200, data: { ok: true, changed: true, said: 'Marked.' } })
  // the shell's ears wake on every sign-in here; they are answered as a relay that has nothing for them
  const d = document as unknown as { querySelector?: unknown }
  before(() => {
    d.querySelector = () => null
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      if (body.startsWith('body=')) {
        const env = JSON.parse(decodeURIComponent(body.slice(5))) as { action: string; payload: unknown }
        calls.push({ url: String(url), action: env.action, payload: env.payload, body })
        return new Response(JSON.stringify(gasAnswer()))
      }
      const path = String(url)
      calls.push({ url: path, body })
      if (path.startsWith('/erp-lanes/my-inbox/read')) return new Response(JSON.stringify({ status: 200, data: { ok: true } }))
      if (path.startsWith('/erp-lanes/my-inbox')) return new Response(JSON.stringify({ status: 200, data: view([WARN, INFO]) }))
      if (path.startsWith('/erp-lanes/notices')) return new Response(JSON.stringify({ status: 200, data: { notices: [], seq: 0, unread: 0 } }))
      return new Response(JSON.stringify({ status: 404, message: 'not here' }), { status: 404 })
    }) as typeof fetch
  })
  after(() => {
    globalThis.fetch = realFetch
    delete d.querySelector
  })
  afterEach(() => {
    calls = []
    forgetHeld()
    gasAnswer = () => ({ status: 200, data: { ok: true, changed: true, said: 'Marked.' } })
    useAuthStore.setState({ user: null, token: null, beAnother: null } as never)
  })

  it('Support Requests\' warning goes to supportInboxAnswer with aware; Scheduling\'s to schedulingAnswer with seen', async () => {
    await answerAct(WARN.act!)
    await answerAct(SCHED.act!)
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['supportInboxAnswer', { item_id: 'SN0123456789', word: 'aware' }],
      ['schedulingAnswer', { item_id: 'SI0000000009', word: 'seen' }],
    ])
    const src = read('src/pages/features/myinbox/AlertPanel.tsx')
    assert.ok(src.includes("gasAction<ActAnswer>('schedulingAnswer', payload") && src.includes("gasAction<ActAnswer>('supportInboxAnswer', payload"))
  })

  it('a refusal is thrown with its sentence', async () => {
    gasAnswer = () => ({ status: 403, message: 'This item is waiting on someone else.' })
    await assert.rejects(answerAct(WARN.act!), /waiting on someone else/)
  })

  it('answered: held as answered and marked read at the read door; the warning keeps its answer', async () => {
    useAuthStore.setState({ user: { id: 'u-ty', name: 'Ty Bond', role: 'admin', types: [] }, token: 'tok-ty' } as never)
    const h = mountHook(() => useMyInbox(true, ''), {})
    await h.settle(() => h.current.state.status === 'ready')
    h.run(() => { void h.current.answered(WARN.id) })
    await h.settle(() => h.current.view?.items[0].act?.done === true && calls.some((c) => c.url.startsWith('/erp-lanes/my-inbox/read')))
    const it0 = h.current.view!.items[0]
    assert.equal(it0.read, true)
    assert.equal(it0.act?.done, true)
    const reads = calls.filter((c) => c.url.startsWith('/erp-lanes/my-inbox/read'))
    assert.equal(reads.length, 1)
    assert.deepEqual(JSON.parse(reads[0].body), { keys: [WARN.id] })
    h.unmount()
  })
})
