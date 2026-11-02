// THE STRIP AT THE TOP — "New version launched, transferring...".
// It is up while a part of the platform is coming up, and only then: - the relay says so: `warming` (it restarted…
import { create } from 'zustand'
import { typedWorkOnScreen } from '@/lib/typedWork'

export const HUB_STRIP_TEXT = 'New version launched, transferring...'
/** How long a reason must hold before the strip is drawn: no flash. */
export const HUB_STRIP_SHOW_AFTER_MS = 5000
/** The strip's own height; the shell is pushed down by exactly this. */
export const HUB_STRIP_HEIGHT_PX = 22
/** While the relay is down, a stream retries at least this often. */
export const RELAY_DOWN_WAIT_CAP_MS = 3000
/** A relay-gone answer counts this long unless another one follows. */
export const RELAY_DOWN_EXPIRES_MS = 20_000
/** A phase read off an answer's header, with no stream frame behind it, counts this long. */
export const HUB_ANSWER_PHASE_FOR_MS = 60_000
/** How long a new SPA build is announced on the strip. */
export const WEB_STRIP_FOR_MS = 2 * 60_000

/** The Be Another band (shell/BeAnotherBar): at the very top, above the strip, while acting. */
export const BE_ANOTHER_BAR_HEIGHT_PX = 30
/** Where the Be Another band ends — the strip stands right under it. */
export const BE_ANOTHER_VAR = '--be-another-h'
/** How far the whole shell moves down: every band at the top, summed. */
export const SHELL_OFFSET_VAR = '--hub-strip-h'

type StyleWriter = { setProperty: (k: string, v: string) => void; removeProperty: (k: string) => unknown }

// THE ONE WRITER OF THE SHELL'S TOP OFFSET.
export function writeShellOffset(style: StyleWriter | null | undefined, strip: boolean, acting: boolean): void {
  if (!style) return
  const inset = 'env(safe-area-inset-top, 0px)'
  if (acting) style.setProperty(BE_ANOTHER_VAR, `calc(${BE_ANOTHER_BAR_HEIGHT_PX}px + ${inset})`)
  else style.removeProperty(BE_ANOTHER_VAR)
  const px = (strip ? HUB_STRIP_HEIGHT_PX : 0) + (acting ? BE_ANOTHER_BAR_HEIGHT_PX : 0)
  if (px) style.setProperty(SHELL_OFFSET_VAR, `calc(${px}px + ${inset})`)
  else style.removeProperty(SHELL_OFFSET_VAR)
}

export type HubPhase = '' | 'warming' | 'engine' | 'ready'
const PHASES: ReadonlySet<string> = new Set(['warming', 'engine', 'ready'])
// nginx for a relay that is not there: its auth subrequest failed (500), the proxy could not connect (502).
const RELAY_GONE: ReadonlySet<number> = new Set([500, 502])

type HubStatusState = {
  /** The relay's own word; '' until it has said one. */
  phase: HubPhase
  /** Our origin answered as if the relay were not there. */
  relayDown: boolean
  /** The served bundle this tab is not running ('' = none, or no longer announced). */
  webPending: string
  offline: boolean
  /** Drawn: a reason has held for HUB_STRIP_SHOW_AFTER_MS. */
  shown: boolean
}

export const useHubStatusStore = create<HubStatusState>(() => ({
  phase: '',
  relayDown: false,
  webPending: '',
  offline: typeof navigator !== 'undefined' && navigator.onLine === false,
  shown: false,
}))

/** Is there a reason for the strip right now (before the five seconds)? */
export function stripWanted(s: HubStatusState = useHubStatusStore.getState()): boolean {
  return !s.offline && (s.relayDown || s.phase === 'warming' || s.phase === 'engine' || s.webPending !== '')
}

let showTimer: ReturnType<typeof setTimeout> | undefined

// One reason taking over from another keeps the strip up: the clock runs from the moment SOME reason began, and…
function reconcile(): void {
  const s = useHubStatusStore.getState()
  if (!stripWanted(s)) {
    if (showTimer) clearTimeout(showTimer)
    showTimer = undefined
    if (s.shown) useHubStatusStore.setState({ shown: false })
    return
  }
  if (s.shown || showTimer) return
  showTimer = setTimeout(() => {
    showTimer = undefined
    if (stripWanted()) useHubStatusStore.setState({ shown: true })
  }, HUB_STRIP_SHOW_AFTER_MS)
}

useHubStatusStore.subscribe(reconcile)

/* ---------- the relay's word, and its absence ----------------------------- */

let relayDownTimer: ReturnType<typeof setTimeout> | undefined
let answerPhaseTimer: ReturnType<typeof setTimeout> | undefined

// The relay itself spoke — a hub frame, or X-Hub-Phase on an answer: it is up.
export function noteHubPhase(phase: unknown, from: 'stream' | 'answer' = 'stream'): void {
  if (relayDownTimer) clearTimeout(relayDownTimer)
  relayDownTimer = undefined
  const p = String(phase ?? '')
  const s = useHubStatusStore.getState()
  const next: Partial<HubStatusState> = {}
  if (s.relayDown) next.relayDown = false
  if (PHASES.has(p)) {
    if (from === 'stream') {
      if (answerPhaseTimer) clearTimeout(answerPhaseTimer)
      answerPhaseTimer = undefined
      if (s.phase !== p) next.phase = p as HubPhase
    } else if (s.phase !== p || answerPhaseTimer) {
      if (answerPhaseTimer) clearTimeout(answerPhaseTimer)
      answerPhaseTimer = setTimeout(() => {
        answerPhaseTimer = undefined
        if (useHubStatusStore.getState().phase !== '') useHubStatusStore.setState({ phase: '' })
      }, HUB_ANSWER_PHASE_FOR_MS)
      if (s.phase !== p) next.phase = p as HubPhase
    }
  }
  if (Object.keys(next).length) useHubStatusStore.setState(next)
}

/** Signed out: the relay's word was about a stream this tab no longer holds. */
export function forgetHubPhase(): void {
  if (answerPhaseTimer) clearTimeout(answerPhaseTimer)
  answerPhaseTimer = undefined
  if (useHubStatusStore.getState().phase !== '') useHubStatusStore.setState({ phase: '' })
}

function relayGone(): void {
  if (relayDownTimer) clearTimeout(relayDownTimer)
  relayDownTimer = setTimeout(() => {
    relayDownTimer = undefined
    if (useHubStatusStore.getState().relayDown) useHubStatusStore.setState({ relayDown: false })
  }, RELAY_DOWN_EXPIRES_MS)
  if (!useHubStatusStore.getState().relayDown) useHubStatusStore.setState({ relayDown: true })
}

function ourOrigin(url: string): boolean {
  if (url.startsWith('/') && !url.startsWith('//')) return true
  try {
    const here = typeof location !== 'undefined' ? location.origin : ''
    return !!here && new URL(url, here).origin === here
  } catch {
    return false
  }
}

type Answer = { status: number; headers?: { get?: (name: string) => string | null } | null }

// An HTTP answer on a relay door.
export function noteDoorAnswer(url: string, res: Answer): void {
  if (!ourOrigin(url)) return
  const get = res.headers?.get
  const said = typeof get === 'function' ? get.call(res.headers, 'X-Hub-Phase') : null
  if (said !== null) noteHubPhase(said, 'answer')
  else if (RELAY_GONE.has(res.status)) relayGone()
}

/** A stream's retry wait: short while the relay is coming back up. */
export function relayWait(wait: number): number {
  return useHubStatusStore.getState().relayDown ? Math.min(wait, RELAY_DOWN_WAIT_CAP_MS) : wait
}

/* ---------- a new SPA build ------------------------------------------------ */

let webTimer: ReturnType<typeof setTimeout> | undefined
/** Builds the strip is done announcing: its two minutes ran, or the tab gave up on it. */
const settledWeb = new Set<string>()

/** The served bundle this tab is not running, or '' when there is none. */
export function noteWebPending(build: string): void {
  const next = build && !settledWeb.has(build) ? build : ''
  if (useHubStatusStore.getState().webPending === next) return
  if (webTimer) clearTimeout(webTimer)
  webTimer = next ? setTimeout(() => settleWebBuild(next), WEB_STRIP_FOR_MS) : undefined
  useHubStatusStore.setState({ webPending: next })
}

/** The strip stops announcing this build, for good; it may still land when the tab is hidden. */
export function settleWebBuild(build: string): void {
  if (!build) return
  settledWeb.add(build)
  if (useHubStatusStore.getState().webPending === build) noteWebPending('')
}

export function noteOnline(online: boolean): void {
  if (useHubStatusStore.getState().offline !== !online) useHubStatusStore.setState({ offline: !online })
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => noteOnline(true))
  window.addEventListener('offline', () => noteOnline(false))
}

/* ---------- loading a new SPA build on a click ---------------------------- */

type BuildLoader = ((build: string) => void) | null
let buildLoader: BuildLoader = null

// The shell's reload for a pending build (lib/chatPresence), registered once; the one it replaces comes back.
export function setBuildLoader(fn: BuildLoader): BuildLoader {
  const before = buildLoader
  buildLoader = fn
  return before
}

export type LoadAnswer = 'loading' | 'draft' | 'none'

// The strip's click.
export function loadNewBuildNow(): LoadAnswer {
  const build = useHubStatusStore.getState().webPending
  if (!build || !buildLoader) return 'none'
  if (typedWorkOnScreen()) return 'draft'
  buildLoader(build)
  return 'loading'
}
