// THE SHELL'S EAR FOR THE CHAT.
// When a person sends a message, notifications are what call the recipient's attention — provided both are online…
import { create } from 'zustand'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { invalidate } from '@/lib/apiCache'
import { placeScope } from '@/lib/placeKey'
import { gasAction } from '@/features/hiring/shared'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { onBeatSeq, onHiddenBeat, onNoticeFrame, onSession, onStreamOpened } from '@/lib/notices'
import { onPushSession } from '@/lib/webPush'
import { lookingAtConversation } from '@/lib/routeNow'
import { frameRoute, tellWriteRefused } from '@/lib/streamFrames'
import {
  forgetHubPhase, noteDoorAnswer, noteHubPhase, noteWebPending, relayWait, setBuildLoader, settleWebBuild,
} from '@/lib/hubStatus'
// LIVE CHAT (lib/chatLive): for a session it owns, the hub carries the badge, the toast and presence, so this ear's…
import { liveOwnsChat } from '@/lib/chatLive/store'
import '@/lib/chatLive/shell'
import { streamLineOf } from '@/lib/chatLines'

type Latest = { id: string; at: string; from_user: string; from_name: string; body: string } | null

type ChatPresenceState = {
  unread: number
  latest: Latest
  // Is the platform hearing messages, or asking for them?
  live: boolean
  /** the new identity's name when a second sign-in swapped the session under this tab (SessionGuard) */
  mismatchName: string | null
  /** the chat screen's open conversation (user id), null for none, undefined when unmounted */
  viewing: string | null | undefined
  setState: (unread: number, latest: Latest) => void
  setLive: (live: boolean) => void
  setMismatch: (name: string | null) => void
  setViewing: (viewing: string | null | undefined) => void
}

export const useChatPresenceStore = create<ChatPresenceState>((set) => ({
  unread: 0,
  latest: null,
  live: false,
  mismatchName: null,
  viewing: undefined,
  setState: (unread, latest) => set({ unread, latest }),
  setLive: (live) => set({ live }),
  setMismatch: (mismatchName) => set({ mismatchName }),
  setViewing: (viewing) => set({ viewing }),
}))

/** Asking, because nothing is listening. */
const PING_POLL_MS = 60_000
/** Listening: this is now a presence STAMP, not a question. */
const PING_LIVE_MS = 5 * 60_000

/** Ids already announced — two overlapping reads must not ring twice. */
const announced = new Set<string>()
let timer: ReturnType<typeof setInterval> | undefined
let beat = PING_POLL_MS

// ------------------------------------------------------------------ THE TAB HEALS ITSELF: a rotting tab only…

let lastOkMs = Date.now()
let failStreak = 0
const SELF_HEAL_AFTER_MS = 3 * 60_000
const SELF_HEAL_GAP_MS = 5 * 60_000

/** False when the floor refused it; `before` runs only when it reloads. */
function selfReload(why: string, before?: () => void): boolean {
  try {
    const last = Number(localStorage.getItem('asa:selfheal:last') || '0')
    if (Date.now() - last < SELF_HEAL_GAP_MS) return false
    localStorage.setItem('asa:selfheal:last', String(Date.now()))
  } catch { /* storage refused: reload anyway, the guard is best-effort */ }
  before?.()
  console.warn('[selfheal] reloading tab: ' + why)
  window.location.reload()
  return true
}

function beatFailed(): void {
  failStreak++
  if (failStreak >= 3 && Date.now() - lastOkMs > SELF_HEAL_AFTER_MS) {
    selfReload('the beat could not reach the platform for over three minutes')
  }
}

function beatSucceeded(): void {
  failStreak = 0
  lastOkMs = Date.now()
}

/** The bundle this tab is running, read off its own script tag. */
function runningBundle(): string {
  const el = document.querySelector('script[src*="index-"]') as HTMLScriptElement | null
  const m = /index-[A-Za-z0-9_-]+\.js/.exec(el?.src ?? '')
  return m ? m[0] : ''
}

/** A visible tab is never reloaded: the new bundle is warmed in the background and lands when the tab is hidden. */

let deployPending = false
let announcedFor = ''
let pendingBuild = ''

// ONE RELOAD PER BUILD, EVER — the loop guard.
const RELOAD_TARGET_KEY = 'asa:selfheal:target'

function reloadTried(target: string): boolean {
  try { return sessionStorage.getItem(RELOAD_TARGET_KEY) === target } catch { return false }
}

function markReloadTried(target: string): void {
  try { sessionStorage.setItem(RELOAD_TARGET_KEY, target) } catch { /* the guard is best-effort */ }
}

/** The build this tab gave up on: never announced, offered or tried again. */
let gaveUpFor = ''

function giveUp(target: string): void {
  gaveUpFor = target
  deployPending = false
  settleWebBuild(target)             // the strip stops saying it is on its way
  toast({
    type: 'warning',
    title: 'This tab could not update itself',
    body: 'Reload it by hand (Cmd+Shift+R) — the new version is being served but this tab keeps loading the old one.',
  })
}

// WARM THE NEW BUNDLE BEFORE RELOADING, so coming back is not a download.
let warmedFor = ''
let warming: Promise<void> | null = null

async function warmBundle(target: string): Promise<void> {
  if (warmedFor === target) return
  if (warming) return warming
  warming = (async () => {
    try {
      // Read it to completion — a fetch whose body is never drained can be abandoned before the browser has stored…
      const res = await fetch('/assets/' + target, { cache: 'force-cache' })
      if (res.ok) await res.arrayBuffer()
      warmedFor = target
    } catch { /* the reload still happens; it is just colder */ }
    finally { warming = null }
  })()
  return warming
}

function reloadForBuild(target: string, why: string): void {
  if (reloadTried(target)) {
    giveUp(target)                   // do not try this one again
    return
  }
  // Fetch it first, then go.
  deployPending = false              // the decision is made; stop re-deciding
  void warmBundle(target).then(() => {
    // the floor refused: nothing was tried, the next chance tries again
    if (!selfReload(why, () => markReloadTried(target))) deployPending = true
  })
}

// The pending build lands ONLY on a tab nobody is looking at.
function maybeUpdateNow(): void {
  if (!deployPending || !pendingBuild) return
  if (typeof document === 'undefined') return
  if (document.visibilityState === 'visible') {
    void warmBundle(pendingBuild)   // prepare it; do not apply it
    return
  }
  reloadForBuild(pendingBuild, 'a new build is served — updating while the tab is hidden')
}

/** The bundle the platform serves now — read off the page, or named by a hub frame. */
function servedBundle(served: string): void {
  const mine = runningBundle()
  if (!mine || !served) return
  if (served === mine) {
    deployPending = false
    pendingBuild = ''
    noteWebPending('')
    return
  }
  if (served === gaveUpFor) return
  // the strip at the top says so for a while (lib/hubStatus)
  noteWebPending(served)
  deployPending = true
  pendingBuild = served
  if (announcedFor !== served) {
    announcedFor = served
    toast({
      type: 'info',
      title: 'A new version is ready',
      body: 'It is downloading in the background. Nothing changes while you work — it applies the next time you leave this tab.',
    })
  }
  maybeUpdateNow()
}

async function checkForNewBundle(): Promise<void> {
  if (!runningBundle()) return
  try {
    const res = await fetch('/?ts=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return
    const html = await res.text()
    const m = /index-[A-Za-z0-9_-]+\.js/.exec(html)
    if (m) servedBundle(m[0])
  } catch { /* the next beat checks again */ }
}

// The strip's click (lib/hubStatus): the person asked for it, so no idle rule and no five-minute floor — only the…
setBuildLoader((build) => {
  if (reloadTried(build)) {
    giveUp(build)
    return
  }
  markReloadTried(build)
  deployPending = false
  window.location.reload()
})

/** How widely one new build is spread over the company's visible tabs. */
export const WEB_FRAME_SPREAD_MS = 60_000
let frameLook: ReturnType<typeof setTimeout> | undefined

// A hub frame on the stream: the relay's phase, and the bundle it serves.
export function onHubFrame(msg: { phase?: unknown; web?: unknown }): void {
  noteHubPhase(msg.phase)
  const served = typeof msg.web === 'string' ? msg.web : ''
  if (!served || frameLook || served === pendingBuild || served === gaveUpFor) return
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
  if (served === runningBundle()) return
  frameLook = setTimeout(() => {
    frameLook = undefined
    if (document.visibilityState === 'visible') servedBundle(served)
  }, Math.random() * WEB_FRAME_SPREAD_MS)
}

if (typeof document !== 'undefined') {
  // Going away is still the fastest moment to land it — kept, and now only one of the two ways rather than the only…
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') maybeUpdateNow()
  })
}

/** `notices` is the relay's newest company-notice id (lib/notices). */
type Beat = { ok?: boolean; me?: string; me_name?: string; due?: boolean; live?: boolean; notices?: number | null }

// The relay answers the beat from memory and says whether a real chatPing is still owed.
async function relayBeat(): Promise<Beat | null> {
  const token = useAuthStore.getState().token
  if (!token) return null
  try {
    const res = await fetch('/snapshot/chat-beat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    noteDoorAnswer('/snapshot/chat-beat', res)
    if (!res.ok) return null
    const j = (await res.json()) as Beat
    return j && j.ok ? j : null
  } catch {
    return null
  }
}

// The session-swap curtain, drawn from whatever just answered.
function checkIdentity(me: string | undefined, meName: string | undefined): boolean {
  // the server's identity against the one this tab draws: a mismatch drops the curtain
  const drawn = String(useAuthStore.getState().user?.id ?? '')
  const actual = String(me ?? '')
  if (drawn && actual && drawn !== actual) {
    useChatPresenceStore.getState().setMismatch(String(meName || 'another account'))
    return true
  }
  if (useChatPresenceStore.getState().mismatchName) {
    useChatPresenceStore.getState().setMismatch(null)
  }
  return false
}

async function ping(): Promise<void> {
  if (!useAuthStore.getState().token) return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    // hidden: only the company's notices (lib/notices)
    onHiddenBeat(useChatPresenceStore.getState().live)
    return
  }
  void checkForNewBundle()
  // A build noticed while somebody was typing must not wait for the NEXT deploy to be reconsidered — every beat…
  maybeUpdateNow()

  // THE CHEAP BEAT FIRST.
  const cheap = await relayBeat()
  // notices ride the beat: the bell reads only when the newest id moved
  if (cheap) onBeatSeq(cheap.notices)
  // the live hub carries this session's chat: no chatPing, and no curtain drawn from a chat answer
  if (liveOwnsChat()) {
    if (cheap) {
      beatSucceeded()
      checkIdentity(cheap.me, cheap.me_name)
    }
    return
  }
  if (cheap && !cheap.due) {
    beatSucceeded()
    checkIdentity(cheap.me, cheap.me_name)
    return
  }

  try {
    const r = await gasAction<{ unread: number; latest: Latest; me?: string; me_name?: string }>('chatPing', {})
    beatSucceeded()
    if (checkIdentity(r.me, r.me_name)) return
    const prev = useChatPresenceStore.getState().latest
    useChatPresenceStore.getState().setState(r.unread ?? 0, r.latest ?? null)
    const l = r.latest
    if (!l || !l.id || announced.has(l.id)) return
    announced.add(l.id)
    // The FIRST answer of a session must not ring for OLD unread — signing in with three messages from yesterday is…
    const ageMs = Date.now() - Date.parse(l.at || '')
    const fresh = Number.isFinite(ageMs) && ageMs < 3 * 60_000
    if (prev === null && !announced.has('__primed__')) {
      announced.add('__primed__')
      if (!fresh) return
    }
    // not while that conversation is on screen (chat screen, or lib/routeNow)
    if (lookingAtConversation(l.from_user, useChatPresenceStore.getState().viewing)) return
    useNotificationStore.getState().push({
      type: 'mention',
      appId: 'chat',
      title: `${l.from_name || 'Somebody'} sent you a message`,
      body: l.body,
      priority: 'high',
      href: `/app/chat/messages?with=${encodeURIComponent(l.from_user)}`,
    })
  } catch {
    /* a missed tick is not an event — but a mute STREAK is: heal */
    beatFailed()
  }
}

function armTimer(ms: number): void {
  if (beat === ms && timer) return
  beat = ms
  clearInterval(timer)
  timer = setInterval(() => void ping(), ms)
}

// The stream.
export type ChatEvent = { thread_key: string; from_user: string; at: string; message?: unknown; gone?: string }
const listeners = new Set<(msg: ChatEvent) => void>()

export function onChatEvent(fn: (msg: ChatEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Words a kept send brought, said at once: the badge and the shell's latest line move, and a notification rings…
export function heardLine(raw: unknown): boolean {
  const line = streamLineOf(raw)
  if (!line || line.mine || announced.has(line.id)) return false
  announced.add(line.id)
  const s = useChatPresenceStore.getState()
  s.setState(s.unread + 1, { id: line.id, at: line.created_at, from_user: line.with_user, from_name: line.from_name,
    body: line.body.slice(0, 140) })
  if (lookingAtConversation(line.with_user, s.viewing)) return true
  useNotificationStore.getState().push({
    type: 'mention',
    appId: 'chat',
    title: `${line.from_name || 'Somebody'} sent you a message`,
    body: line.body.slice(0, 140),
    priority: 'high',
    href: `/app/chat/messages?with=${encodeURIComponent(line.with_user)}`,
  })
  return true
}

let streamStop: (() => void) | null = null

function startStream(): void {
  if (streamStop) return
  const ctrl = new AbortController()
  let stopped = false
  let wait = 2000
  /** Has this stream ever been up? Only a RE-connect can have a gap behind it. */
  let opened = false

  const run = async () => {
    while (!stopped) {
      try {
        const token = useAuthStore.getState().token
        if (!token) throw new Error('signed out')
        const res = await fetch('/snapshot/chat-stream', {
          // only tabs that send these headers are sent `notice` / `hub` frames
          headers: { Authorization: `Bearer ${token}`, 'X-Hub-Notices': '1', 'X-Hub-Strip': '1' },
          signal: ctrl.signal,
        })
        noteDoorAnswer('/snapshot/chat-stream', res)
        if (!res.ok || !res.body) throw new Error(String(res.status))
        wait = 2000
        useChatPresenceStore.getState().setLive(true)
        armTimer(PING_LIVE_MS)
        // A stream that just opened may have MISSED something while it was down — the reconnect is exactly when a…
        void ping()
        onStreamOpened()
        // …AND THE BEAT IS NOT THE WHOLE RECONCILIATION.
        if (opened && document.visibilityState === 'visible' && !liveOwnsChat()) {
          for (const fn of listeners) fn({ thread_key: '', from_user: '', at: '' })
        }
        opened = true
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const frames = buf.split('\n\n')
          buf = frames.pop() ?? ''
          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue
              try {
                const msg = JSON.parse(line.slice(5).trim())
                // only chat frames reach the chat listeners (lib/streamFrames)
                const route = frameRoute(msg)
                /** a company notice goes to the bell, never to the chat listeners */
                if (route === 'notice') {
                  onNoticeFrame(msg.notice)
                  continue
                }
                // the relay's phase for the strip at the top — never a message
                if (route === 'hub') {
                  onHubFrame(msg)
                  continue
                }
                // A WRITE THAT WAS REFUSED AFTER THE CLICK.
                if (route === 'refused') {
                  // the screen that drew it hears it too, and names the rows (lib/streamFrames)
                  const told = tellWriteRefused(msg)
                  const what = told.resource
                    || (told.rows.length ? `${told.rows.join(', ')} (${told.action || 'a change'})` : 'that change')
                  toast({
                    type: 'danger',
                    title: 'Not saved',
                    body: `${what} was accepted here and refused by the platform — ` +
                          `${String(msg.why || 'no reason given')}. Nothing was written.`,
                  })
                  // the same key the write used, so the next read is a real one
                  if (msg.resource) invalidate(placeScope(String(msg.resource)))
                  continue
                }
                // A kind this bundle does not know is not a message either.
                if (route !== 'chat') continue
                // the hub already delivered it, with the words, to every tab of this session
                if (liveOwnsChat()) continue
                for (const fn of listeners) fn(msg)
                // a kept send's words: said now, not after the beat's read
                heardLine(msg.message)
                // The shell's own reaction: read what it was, so the notification carries the message rather than…
                const mine = String(useAuthStore.getState().user?.id ?? '')
                if (!mine || msg.from_user !== mine) void ping()
              } catch { /* a frame we cannot read is a frame we ignore */ }
            }
          }
        }
      } catch {
        if (stopped) return
      }
      // The stream is down: back to asking, and back off so a server that is down does not become a reconnect flood.
      useChatPresenceStore.getState().setLive(false)
      armTimer(PING_POLL_MS)
      if (stopped) return
      // a relay coming back up is retried often, so the strip clears soon
      await new Promise((r) => setTimeout(r, relayWait(wait)))
      wait = Math.min(wait * 2, 60_000)
    }
  }
  void run()

  streamStop = () => {
    stopped = true
    ctrl.abort()
    streamStop = null
    useChatPresenceStore.getState().setLive(false)
  }
}

/** The token the ear is armed for; undefined before the first arm. */
let armedToken: string | null | undefined

// ARMED ON A TOKEN CHANGE, NOT ON EVERY WRITE TO THE AUTH STORE.
export function shouldArm(armed: string | null | undefined, next: string | null): boolean {
  return armed === undefined || armed !== next
}

function arm(token: string | null): void {
  armedToken = token
  clearInterval(timer)
  timer = undefined
  streamStop?.()
  // One person's bell never outlives their session on this tab.
  onSession(token)
  // and the push device follows the session (lib/webPush)
  onPushSession(token)
  if (!token) {
    forgetHubPhase()
    announced.clear()
    useChatPresenceStore.getState().setState(0, null)
    return
  }
  void ping()
  armTimer(PING_POLL_MS)
  startStream()
}

if (typeof window !== 'undefined') {
  queueMicrotask(() => {
    const token = useAuthStore.getState().token
    if (shouldArm(armedToken, token)) arm(token)
  })
  useAuthStore.subscribe((s) => {
    if (shouldArm(armedToken, s.token)) arm(s.token)
  })
  // Coming back to the tab is the moment a person is present again: stamp it then rather than waiting out the rest…
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void ping()
  })
}
