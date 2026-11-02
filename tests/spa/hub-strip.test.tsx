/**
 * "NEW VERSION LAUNCHED, TRANSFERRING..." — the strip at the top
 * (lib/hubStatus decides, components/shell/HubStrip draws, lib/chatPresence
 * feeds it the stream's hub frames and loads a new build on the click).
 *
 * The relay's half — the phases, the frames, the header on every answer,
 * /health — is held by tools/test-hub-strip.py. What is the browser's, run for
 * real here:
 *   · our own origin answering 500/502 WITHOUT the relay's X-Hub-Phase raises
 *     it after five seconds; only the relay's word (the header, a hub frame)
 *     or twenty seconds with no further such answer takes it down — and from
 *     "gone" to "warming" it never drops in between;
 *   · one stray 5xx the next stream attempt answers is never drawn;
 *   · never: the relay's own 500 (it carries the header), nginx's 503, a fetch
 *     that threw, a 401/403/404/429/504, another origin — offline hides it;
 *   · the relay's word raises it for `warming` and `engine`; the stream's word
 *     stands, a word read off an answer alone lapses after a minute;
 *   · a new SPA build raises it for two minutes, once per build; the click
 *     loads it — refused while typed work is on screen, offered again after;
 *   · the strip moves the shell before paint and keeps its live region mounted;
 *   · the shell's own loader: another tab's reload says nothing about this
 *     one, a tab that came back still old gives up ONCE and is never offered
 *     that build again, a frame reaches a visible tab spread over a minute and
 *     never makes a hidden tab reload.
 */
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import {
  HUB_ANSWER_PHASE_FOR_MS, HUB_STRIP_HEIGHT_PX, HUB_STRIP_SHOW_AFTER_MS, HUB_STRIP_TEXT, RELAY_DOWN_EXPIRES_MS,
  RELAY_DOWN_WAIT_CAP_MS,
  WEB_STRIP_FOR_MS, forgetHubPhase, loadNewBuildNow, noteDoorAnswer, noteHubPhase, noteOnline, noteWebPending,
  relayWait, setBuildLoader, stripWanted, useHubStatusStore,
} from '@/lib/hubStatus'
import { markLiveDraft, noteTyping, typedWorkOnScreen } from '@/lib/typedWork'
import { frameRoute } from '@/lib/streamFrames'
import { gasAction } from '@/features/hiring/shared'
import { useDraftStore } from '@/stores/useDraftStore'
import { useToastStore } from '@/stores/useToastStore'
import { HUB_STRIP_REFUSAL_MS, HUB_STRIP_VAR, HubStripBar, useHubStrip } from '@/components/shell/HubStrip'
// the shell's own module, loaded as it ships: it registers the strip's loader
import { WEB_FRAME_SPREAD_MS, onHubFrame } from '@/lib/chatPresence'
import { mountHook } from './react-host'

const ROOT = process.env.SPA_ROOT || process.cwd()
const source = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')
const state = () => useHubStatusStore.getState()
const shown = () => state().shown
const answer = (status: number, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers) })
const relay = (status: number, phase = 'ready') => answer(status, { 'X-Hub-Phase': phase })

/**
 * A CLOCK OF OUR OWN for setTimeout/clearTimeout. Node 18's mock timers clear
 * the wrong timer when the one asked for is not first in their queue, and the
 * modules here clear timers as a matter of course.
 */
type Pending = { at: number; id: number; fn: () => void }
const pending = new Map<number, Pending>()
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
let now = 0
let nextId = 0
function fakeClock(): void {
  now = 0
  pending.clear()
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    const id = ++nextId
    pending.set(id, { at: now + Math.max(0, Number(ms) || 0), id, fn })
    return id
  }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((id?: unknown) => { pending.delete(Number(id)) }) as typeof clearTimeout
}
function realClock(): void {
  pending.clear()
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
}
/** Run every timer due within `ms`, in order, each at its own moment. */
function tick(ms: number): void {
  const until = now + ms
  for (;;) {
    let due: Pending | undefined
    for (const t of pending.values()) {
      if (t.at <= until && (!due || t.at < due.at || (t.at === due.at && t.id < due.id))) due = t
    }
    if (!due) break
    pending.delete(due.id)
    now = due.at
    due.fn()
  }
  now = until
}

function clean(): void {
  // the relay's word ends a pending relay-gone expiry, signing out a phase
  // read off an answer; the rest is state
  noteHubPhase('')
  forgetHubPhase()
  noteWebPending('')
  useHubStatusStore.setState({ phase: '', relayDown: false, webPending: '', offline: false, shown: false })
  useDraftStore.setState({ drafts: {} })
}

beforeEach(() => {
  fakeClock()
  clean()
})
afterEach(() => {
  clean()                 // clears the pending timers while the clock is still ours
  realClock()
})

describe('our own origin answering for a relay that is not there', () => {
  for (const status of [500, 502]) {
    it(`a ${status} without the relay's word shows it after five seconds; the relay's next answer hides it at once`, () => {
      noteDoorAnswer('/gas', answer(status))
      assert.equal(state().relayDown, true)
      tick(HUB_STRIP_SHOW_AFTER_MS - 1)
      assert.equal(shown(), false, 'not before five seconds')
      tick(1)
      assert.equal(shown(), true)
      noteDoorAnswer('/gas', relay(200, 'ready'))
      assert.equal(shown(), false, 'hidden the moment the relay answers')
      assert.equal(state().relayDown, false)
    })
  }
  it('one stray 5xx that the next stream attempt answers is never drawn', () => {
    assert.ok(RELAY_DOWN_WAIT_CAP_MS < HUB_STRIP_SHOW_AFTER_MS, 'the retry lands before the strip would')
    noteDoorAnswer('/snapshot/chat-stream', answer(500))
    // the stream's loop has already doubled its wait: the cap is what it sleeps
    assert.equal(relayWait(4000), RELAY_DOWN_WAIT_CAP_MS)
    tick(RELAY_DOWN_WAIT_CAP_MS)
    noteDoorAnswer('/snapshot/chat-stream', relay(200, 'ready'))
    tick(30_000)
    assert.equal(shown(), false)
  })
  it('a restart: from "gone" to the relay\'s first answer saying `warming` the strip never drops', () => {
    const seen: boolean[] = []
    const stop = useHubStatusStore.subscribe((s) => { seen.push(s.shown) })
    try {
      noteDoorAnswer('/snapshot/chat-stream', answer(500))
      tick(HUB_STRIP_SHOW_AFTER_MS)
      assert.equal(shown(), true)
      // the new relay's stream opens: its head says `warming` in the same answer
      noteDoorAnswer('/snapshot/chat-stream', relay(200, 'warming'))
      noteHubPhase('warming')                     // …and the frame after `: open`
      tick(HUB_ANSWER_PHASE_FOR_MS * 3)           // the first full pass takes minutes
      assert.equal(shown(), true)
      assert.deepEqual([state().relayDown, state().phase], [false, 'warming'])
      noteHubPhase('ready')                       // the first full pass ended
      assert.equal(shown(), false)
      assert.deepEqual(seen.filter((v, i) => i === 0 || v !== seen[i - 1]), [false, true, false],
        'up once, down once — no blink in between')
    } finally {
      stop()
    }
  })
  it('an answer without the relay\'s word (a slice file nginx served) does not take it down; twenty seconds do', () => {
    noteDoorAnswer('/snapshot/index.json', answer(500))
    tick(HUB_STRIP_SHOW_AFTER_MS)
    noteDoorAnswer('/snapshot/index.json', answer(200))
    noteDoorAnswer('/snapshot/events', answer(401))
    assert.equal(shown(), true, 'nginx served a file: the phase is still unknown')
    tick(RELAY_DOWN_EXPIRES_MS - HUB_STRIP_SHOW_AFTER_MS - 1)
    assert.equal(shown(), true)
    tick(1)
    assert.equal(shown(), false, 'nothing confirmed it for twenty seconds')
  })
  it('a public page: one /gas 502, retried at Google — the strip clears by itself', () => {
    noteDoorAnswer('/gas', answer(502))
    noteDoorAnswer('https://script.google.com/macros/s/x/exec', answer(200))
    tick(HUB_STRIP_SHOW_AFTER_MS)
    assert.equal(shown(), true)
    tick(RELAY_DOWN_EXPIRES_MS)
    assert.equal(shown(), false, 'never stuck on a page that asks our origin nothing more')
  })
  it('a relay still down keeps it up: every further relay-gone answer restarts the twenty seconds', () => {
    noteDoorAnswer('/snapshot/chat-stream', answer(502))
    tick(15_000)
    noteDoorAnswer('/snapshot/chat-stream', answer(502))
    tick(15_000)
    assert.equal(shown(), true)
    tick(5_000)
    assert.equal(shown(), false)
  })
})

describe('never a new version: the relay\'s own errors, the limiter, a person\'s own network', () => {
  it('a 500 the relay raised carries its word: never the strip', () => {
    noteDoorAnswer('/snapshot/place', relay(500, 'ready'))
    tick(60_000)
    assert.equal(state().relayDown, false)
    assert.equal(shown(), false)
  })
  for (const status of [401, 403, 404, 429, 503, 504]) {
    it(`a ${status} never raises it${status === 503 ? ' (nginx\'s rate limiter on /gas answers 503)' : ''}`, () => {
      noteDoorAnswer('/gas', answer(status))
      tick(60_000)
      assert.equal(state().relayDown, false)
      assert.equal(shown(), false)
    })
  }
  it('another origin\'s 5xx (Google\'s /exec, the last rung) never raises it', () => {
    noteDoorAnswer('https://script.google.com/macros/s/x/exec', answer(502))
    tick(60_000)
    assert.equal(shown(), false)
  })
  it('the /gas door: an nginx 502 raises it; a fetch that THREW does not; the relay\'s envelope clears it', async () => {
    const g = globalThis as { fetch: unknown }
    const held = g.fetch
    try {
      g.fetch = async () => { throw new TypeError('Failed to fetch') }
      await assert.rejects(gasAction('stamp', {}, { retry: false }))
      assert.equal(state().relayDown, false, 'no answer is not the relay')
      g.fetch = async () => ({
        ok: false, status: 502, headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => { throw new SyntaxError('Unexpected token <') },
      })
      await assert.rejects(gasAction('stamp', {}, { retry: false }))
      assert.equal(state().relayDown, true)
      g.fetch = async () => ({
        ok: true, status: 200, headers: new Headers({ 'X-Hub-Phase': 'ready' }),
        json: async () => ({ status: 200, data: {} }),
      })
      await gasAction('stamp', {})
      assert.equal(state().relayDown, false, 'the relay answered')
    } finally {
      g.fetch = held
    }
  })
  it('offline hides it at once and entirely; online again, it waits its five seconds', () => {
    noteHubPhase('warming')
    tick(HUB_STRIP_SHOW_AFTER_MS)
    assert.equal(shown(), true)
    noteOnline(false)
    assert.equal(shown(), false)
    assert.equal(stripWanted(), false)
    tick(10_000)
    assert.equal(shown(), false)
    noteOnline(true)
    assert.equal(shown(), false)
    tick(HUB_STRIP_SHOW_AFTER_MS)
    assert.equal(shown(), true)
  })
  it('while the relay is down a stream retries within the cap; otherwise its own backoff stands', () => {
    assert.equal(relayWait(32_000), 32_000)
    noteDoorAnswer('/snapshot/chat-stream', answer(502))
    assert.equal(relayWait(32_000), RELAY_DOWN_WAIT_CAP_MS)
    assert.equal(relayWait(2_000), 2_000)
  })
})

describe('the relay\'s own word', () => {
  it('a hub frame is routed as such — never to the chat listeners', () => {
    assert.equal(frameRoute({ kind: 'hub', phase: 'warming' }), 'hub')
    assert.equal(frameRoute({ kind: 'hub', phase: 'ready', web: 'index-A.js' }), 'hub')
  })
  it('`warming` and `engine` raise it after five seconds; `ready` takes it down; a word it does not know is ignored', () => {
    for (const phase of ['warming', 'engine']) {
      noteHubPhase(phase)
      tick(HUB_STRIP_SHOW_AFTER_MS)
      assert.equal(shown(), true, phase)
      noteHubPhase('ready')
      assert.equal(shown(), false)
    }
    noteHubPhase('rebooting')
    noteHubPhase(undefined)
    assert.equal(state().phase, 'ready')
  })
  it('a hub frame is the relay speaking: it ends "gone" too', () => {
    noteDoorAnswer('/gas', answer(502))
    noteHubPhase('ready')
    assert.equal(state().relayDown, false)
    tick(60_000)
    assert.equal(shown(), false)
  })
  it('a page with no stream: a phase read off one answer lapses after a minute — never stuck on a candidate\'s page', () => {
    noteDoorAnswer('/gas', relay(200, 'engine'))
    tick(HUB_STRIP_SHOW_AFTER_MS)
    assert.equal(shown(), true)
    tick(HUB_ANSWER_PHASE_FOR_MS - HUB_STRIP_SHOW_AFTER_MS - 1)
    assert.equal(shown(), true)
    tick(1)
    assert.equal(shown(), false, 'nothing said it again: the page is not told "transferring" forever')
    assert.equal(state().phase, '')
    noteDoorAnswer('/gas', relay(200, 'engine'))  // the next answer says it again
    noteDoorAnswer('/gas', relay(200, 'engine'))
    tick(HUB_STRIP_SHOW_AFTER_MS)
    assert.equal(shown(), true)
  })
  it('the stream\'s word stands: an answer saying the same never makes it lapse, and the stream takes over an answer\'s', () => {
    noteHubPhase('warming')                        // the stream
    noteDoorAnswer('/gas', relay(200, 'warming'))  // a /gas answer during the same pass
    tick(HUB_ANSWER_PHASE_FOR_MS * 5)
    assert.equal(shown(), true)
    assert.equal(state().phase, 'warming')
    noteDoorAnswer('/gas', relay(200, 'engine'))   // a change the stream has not said yet
    noteHubPhase('engine')                         // …now it has
    tick(HUB_ANSWER_PHASE_FOR_MS * 5)
    assert.equal(state().phase, 'engine')
    assert.equal(shown(), true)
  })
  it('signing out forgets the phase — it was about a stream this tab no longer holds', () => {
    noteHubPhase('engine')
    tick(HUB_STRIP_SHOW_AFTER_MS)
    forgetHubPhase()
    assert.equal(shown(), false)
    assert.equal(state().phase, '')
  })
})

describe('a new SPA build served', () => {
  it('raises it for two minutes, then never again for that build — a newer build raises it anew', () => {
    noteWebPending('index-W1.js')
    tick(HUB_STRIP_SHOW_AFTER_MS)
    assert.equal(shown(), true)
    tick(WEB_STRIP_FOR_MS - HUB_STRIP_SHOW_AFTER_MS)
    assert.equal(shown(), false, 'a visible tab is not told "transferring" for days')
    noteWebPending('index-W1.js')               // the next beat sees it again
    assert.equal(state().webPending, '')
    noteWebPending('index-W2.js')
    assert.equal(state().webPending, 'index-W2.js')
  })
  it('the click loads it; refused while a registered surface on screen is dirty — never for a post-it left behind', () => {
    const loaded: string[] = []
    const surface = {}
    const shells = setBuildLoader((build) => loaded.push(build))
    try {
      assert.equal(loadNewBuildNow(), 'none', 'nothing pending, nothing to load')
      noteWebPending('index-W3.js')
      // a reminder for a screen left days ago: its text was never kept
      useDraftStore.setState({ drafts: { k: { id: 'k', label: 'An unsent Kanban card', href: '/app/x', at: 1 } } })
      markLiveDraft(surface, true)
      assert.equal(loadNewBuildNow(), 'draft')
      assert.deepEqual(loaded, [])
      markLiveDraft(surface, false)               // saved (or the screen closed)
      assert.equal(loadNewBuildNow(), 'loading', 'the old post-it does not block it')
      assert.deepEqual(loaded, ['index-W3.js'])
    } finally {
      setBuildLoader(shells)
      markLiveDraft(surface, false)
    }
  })
  it('refused while ANY field typed into is still on screen with text — registered or not', () => {
    const compose = { tagName: 'TEXTAREA', value: 'Dear Ann, about Friday', isConnected: true }
    const search = { tagName: 'INPUT', type: 'search', value: 'ann', isConnected: true }
    const note = { tagName: 'DIV', isContentEditable: true, textContent: 'half a note', isConnected: true }
    noteTyping(search)
    assert.equal(typedWorkOnScreen(), false, 'a search box is nobody\'s work')
    noteTyping(compose)
    assert.equal(typedWorkOnScreen(), true)
    compose.value = ''                             // sent
    assert.equal(typedWorkOnScreen(), false)
    noteTyping(note)
    assert.equal(typedWorkOnScreen(), true)
    note.isConnected = false                       // closed
    assert.equal(typedWorkOnScreen(), false)
  })
})

describe('the strip on the page', () => {
  const props: Record<string, string> = {}
  const doc = document as unknown as { documentElement?: unknown }
  beforeEach(() => {
    for (const k of Object.keys(props)) delete props[k]
    doc.documentElement = {
      style: {
        setProperty: (k: string, v: string) => { props[k] = v },
        removeProperty: (k: string) => { delete props[k] },
      },
    }
  })
  afterEach(() => { delete doc.documentElement })

  it('moves the shell while it is up (before paint), and gives the room back when it goes', () => {
    const m = mountHook(() => useHubStrip(), {})
    try {
      assert.equal(props[HUB_STRIP_VAR], undefined)
      m.run(() => {
        noteHubPhase('warming')
        tick(HUB_STRIP_SHOW_AFTER_MS)
      })
      assert.equal(m.current.shown, true)
      assert.equal(props[HUB_STRIP_VAR], `calc(${HUB_STRIP_HEIGHT_PX}px + env(safe-area-inset-top, 0px))`)
      m.run(() => noteHubPhase('ready'))
      assert.equal(props[HUB_STRIP_VAR], undefined)
    } finally {
      m.unmount()
    }
  })
  it('a refused click says so, then offers the load again; saved, the click loads', () => {
    const loaded: string[] = []
    const surface = {}
    const shells = setBuildLoader((build) => loaded.push(build))
    const m = mountHook(() => useHubStrip(), {})
    try {
      m.run(() => {
        noteWebPending('index-W4.js')
        tick(HUB_STRIP_SHOW_AFTER_MS)
      })
      markLiveDraft(surface, true)
      m.run(() => m.current.onLoad())
      assert.equal(m.current.refused, true)
      assert.deepEqual(loaded, [])
      markLiveDraft(surface, false)
      m.run(() => tick(HUB_STRIP_REFUSAL_MS))
      assert.equal(m.current.refused, false, 'the note is not stuck on this build')
      m.run(() => m.current.onLoad())
      assert.deepEqual(loaded, ['index-W4.js'])
    } finally {
      m.unmount()
      setBuildLoader(shells)
      markLiveDraft(surface, false)
    }
  })
  it('reads exactly as asked; the live region is mounted before it speaks; the words never give way', () => {
    assert.equal(HUB_STRIP_TEXT, 'New version launched, transferring...')
    const noop = () => {}
    assert.equal(renderToString(<HubStripBar shown={false} web="" refused={false} onLoad={noop} />),
      '<div role="status" aria-live="polite" class="sr-only"></div>')
    const warming = renderToString(<HubStripBar shown web="" refused={false} onLoad={noop} />)
    assert.match(warming, /^<div role="status" aria-live="polite" class="fixed inset-x-0 top-0 z-\[35\]/)
    assert.match(warming, /<span class="shrink-0 whitespace-nowrap">New version launched, transferring\.\.\.<\/span>/)
    assert.doesNotMatch(warming, /Load it now|<button/)
    assert.match(renderToString(<HubStripBar shown web="index-NEW.js" refused={false} onLoad={noop} />),
      /<button type="button" class="min-w-0 truncate[^"]*">Load it now<\/button>/)
    const refused = renderToString(<HubStripBar shown web="index-NEW.js" refused onLoad={noop} />)
    assert.match(refused, /<span class="min-w-0 truncate[^"]*">Save your work first\.<\/span>/)
    assert.doesNotMatch(refused, /<button/)
  })
})

describe('the shell\'s loader and the stream\'s hub frames (lib/chatPresence)', () => {
  const g = globalThis as unknown as { location?: unknown; fetch: unknown }
  const d = document as unknown as { querySelector?: unknown; visibilityState: string }
  let reloads = 0
  const heldFetch = g.fetch
  const toasts = (title: string) => useToastStore.getState().toasts.filter((t) => t.title === title).length

  beforeEach(() => {
    reloads = 0
    g.location = { origin: 'https://hub.test', reload: () => { reloads += 1 } }
    d.querySelector = () => ({ src: 'https://hub.test/assets/index-OLD.js' })
    d.visibilityState = 'visible'
    g.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) })
    useToastStore.setState({ toasts: [] })
    sessionStorage.clear()
    localStorage.clear()
  })
  afterEach(() => {
    delete g.location
    delete d.querySelector
    d.visibilityState = 'visible'
    g.fetch = heldFetch
  })

  it('another tab\'s reload to the same build says nothing about this one: the click reloads', () => {
    localStorage.setItem('asa:selfheal:target', 'index-C1.js')   // where the guard used to live, shared
    noteWebPending('index-C1.js')
    assert.equal(loadNewBuildNow(), 'loading')
    assert.equal(reloads, 1)
    assert.equal(sessionStorage.getItem('asa:selfheal:target'), 'index-C1.js', 'written in this tab\'s own storage')
  })
  it('a tab that came back still old gives up ONCE — and is never offered that build again', () => {
    sessionStorage.setItem('asa:selfheal:target', 'index-C2.js')  // this tab already reloaded to it
    noteWebPending('index-C2.js')
    assert.equal(loadNewBuildNow(), 'loading')
    assert.equal(reloads, 0, 'the same reload would be the same failure')
    assert.equal(toasts('This tab could not update itself'), 1)
    assert.equal(state().webPending, '')
    // the next beat and every frame name it again: nothing comes back
    noteWebPending('index-C2.js')
    onHubFrame({ phase: 'ready', web: 'index-C2.js' })
    tick(WEB_FRAME_SPREAD_MS)
    tick(HUB_STRIP_SHOW_AFTER_MS)
    assert.equal(state().webPending, '')
    assert.equal(shown(), false)
    assert.equal(toasts('This tab could not update itself'), 1)
  })
  it('a visible tab takes a new build from a frame at a random moment within the minute, once', () => {
    onHubFrame({ phase: 'ready', web: 'index-C3.js' })
    assert.equal(state().webPending, '', 'not in the same second as every other tab')
    tick(WEB_FRAME_SPREAD_MS)
    assert.equal(state().webPending, 'index-C3.js')
    assert.equal(toasts('A new version is ready'), 1)
    onHubFrame({ phase: 'ready', web: 'index-C3.js' })   // the keepalive names it again
    tick(WEB_FRAME_SPREAD_MS)
    assert.equal(toasts('A new version is ready'), 1)
    assert.equal(reloads, 0, 'a visible tab is never reloaded')
  })
  it('a hidden tab does nothing on a frame — one deploy never reboots every hidden tab at once', () => {
    d.visibilityState = 'hidden'
    onHubFrame({ phase: 'ready', web: 'index-C4.js' })
    tick(WEB_FRAME_SPREAD_MS)
    assert.equal(reloads, 0)
    assert.equal(state().webPending, '')
  })
  it('a frame naming the bundle this tab runs is nothing; the phase on it lands in the store', () => {
    onHubFrame({ phase: 'warming', web: 'index-OLD.js' })
    tick(WEB_FRAME_SPREAD_MS)
    assert.equal(state().webPending, '')
    assert.equal(state().phase, 'warming')
  })
})

describe('the wiring', () => {
  it('the chat stream asks for hub frames, reports its answer and takes a hub frame before any chat listener', () => {
    const chat = source('src/lib/chatPresence.ts')
    const fan = chat.indexOf('for (const fn of listeners) fn(msg)')
    assert.ok(chat.includes("'X-Hub-Strip': '1'"))
    assert.ok(chat.indexOf("route === 'hub'") > 0 && chat.indexOf("route === 'hub'") < fan)
    assert.match(chat, /noteDoorAnswer\('\/snapshot\/chat-stream', res\)\n\s+if \(!res\.ok/)
    assert.match(chat, /setTimeout\(r, relayWait\(wait\)\)/)
  })
  it('every relay door reports its answer: the slices, the events stream and both /gas doors', () => {
    const snap = source('src/lib/snapshotClient.ts')
    for (const door of ['/index.json', '/${resource}.json', '/place', '/all.json', '/events']) {
      assert.ok(snap.includes('noteDoorAnswer(`${BASE}' + door + '`, res)'), door)
    }
    assert.match(snap, /setTimeout\(r, relayWait\(wait\)\)/)
    assert.match(source('src/lib/api.ts'), /noteDoorAnswer\(target, res\)/)
    assert.match(source('src/features/hiring/shared.tsx'), /noteDoorAnswer\(url, res\)/)
  })
  it('the strip is mounted over every route, and the shell and its panels make room for it', () => {
    const app = source('src/App.tsx')
    assert.ok(app.indexOf('<HubStrip />') > app.indexOf('<SessionGuard />') && app.indexOf('<HubStrip />') < app.indexOf('<Routes>'))
    assert.match(source('src/components/Layout.tsx'), /paddingTop: 'var\(--hub-strip-h, 0px\)'/)
    assert.match(source('src/components/shell/Sidebar.tsx'), /top: 'var\(--hub-strip-h, 0px\)'/)
    for (const panel of ['src/components/shell/DetailPanel.tsx', 'src/components/shell/NotificationPanel.tsx',
      'src/engine/templates/pipeline/CandidatePanel.tsx', 'src/pages/features/shifts/ShiftCellPanel.tsx',
      'src/engine/templates/pipeline/CandidateFormView.tsx', 'src/pages/features/playground/PlaygroundManual.tsx',
      'src/engine/templates/documents/Reader.tsx']) {
      const src = source(panel)
      assert.ok(src.includes('top-[calc(68px+var(--hub-strip-h,0px))]') && !src.includes('top-[68px]'), panel)
    }
    for (const screen of ['src/pages/features/chat/ChatPage.tsx', 'src/pages/features/mail/MailPage.tsx',
      'src/pages/features/cortex/CortexChatPage.tsx', 'src/pages/features/teamboard/TeamBoardPage.tsx',
      'src/pages/features/taskboardsheet/TaskBoardSheetPage.tsx', 'src/pages/features/calendar/CompanyCalendarPage.tsx',
      'src/components/shared/DriveReadingRoom.tsx']) {
      // the screen's own height, not a dialog's max-h
      const heights = [...source(screen).matchAll(/(?<![\w-])h-\[calc\(100dvh-[^\]]*\)\]/g)].map((x) => x[0])
      assert.ok(heights.length > 0 && heights.every((h) => h.includes('-var(--hub-strip-h,0px))]')), screen)
    }
  })
})
