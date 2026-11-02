// APPLY — what an edition's Apply runs, and what the strip under it says while it runs.
// One press sends the edit: the relay's JSON overlay takes it first and queues its sheet, or its door writes the sheet.
import { appRingName } from '@/lib/appPack'
import { onLiveEvent, liveConnected, noteWriteAwaited, refetchSlices } from '@/lib/snapshotClient'
import { QUEUED_WORDS, writeQueued } from '@/lib/readCache'
import { onWriteRefused } from '@/lib/streamFrames'

export type ApplyStepId = 'json' | 'sheet' | 'cache' | 'slices' | 'ring' | 'page'
export type ApplyStepState = 'waiting' | 'running' | 'landed' | 'owed' | 'skipped' | 'failed'
export type ApplyStep = { id: ApplyStepId; label: string; state: ApplyStepState; words: string }
export type ApplyPhase = 'idle' | 'running' | 'done' | 'refused'
export type ApplyState = { phase: ApplyPhase; steps: ApplyStep[]; refusal: string }

export const APPLY_STEPS: readonly { id: ApplyStepId; label: string }[] = [
  { id: 'sheet', label: 'Sheet' },
  { id: 'cache', label: 'Kept caches' },
  { id: 'slices', label: 'Slices' },
  { id: 'ring', label: 'Live ring' },
  { id: 'page', label: 'This page' },
]

/** The order an edit the relay's overlay took lands in: the JSON first, the sheet last. */
export const OVERLAY_STEPS: readonly { id: ApplyStepId; label: string }[] = [
  { id: 'json', label: 'JSON overlay' },
  { id: 'cache', label: 'Kept caches' },
  { id: 'slices', label: 'Slices' },
  { id: 'ring', label: 'Live ring' },
  { id: 'page', label: 'This page' },
  { id: 'sheet', label: 'Sheet' },
]

/** What the relay said of an edit its overlay took (server/edit_overlay.py); null for a door's own answer. */
export type OverlayAnswer = { ids: string[]; ahead: number; slices: string[]; perMin: number | null; at: string }

export function overlayOf(raw: unknown): OverlayAnswer | null {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).overlay : null
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const x = o as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.map((i) => String(i ?? '').trim()).filter(Boolean) : [])
  const ids = list(x.ids)
  if (!ids.length) return null
  const ahead = Number(x.ahead)
  return {
    ids, ahead: Number.isFinite(ahead) && ahead > 0 ? Math.floor(ahead) : 0, slices: list(x.slices),
    perMin: typeof x.per_min === 'number' && Number.isFinite(x.per_min) ? x.per_min : null, at: String(x.at ?? ''),
  }
}

/** The sheet step while the write waits in the relay's queue. */
export function queuedWords(o: OverlayAnswer): string {
  const pace = o.perMin ? ` at the sheets' pace (${Math.round(o.perMin)} writes a minute)` : ''
  return `Queued${o.ahead ? ` (${o.ahead} ahead)` : ''} — the relay writes it to the sheet${pace}.`
}

/** How a queued sheet write ended, as the relay told it. */
export type SheetSettled = { state: 'written' | 'refused'; words: string }

/** How long the strip waits for the relay's ring, and for a slice to be rebuilt, before it says the step is owed. */
export const RING_WAIT_MS = 10_000
export const SLICE_WAIT_MS = 30_000

export const APPLY_IDLE: ApplyState = {
  phase: 'idle', refusal: '',
  steps: APPLY_STEPS.map((s) => ({ ...s, state: 'waiting', words: '' })),
}

/** The mirror-built slices, as the strip names them. */
const MIRROR_WORDS: Record<string, string> = { houses: 'the houses list' }

/** What the door says it did (Locations.gs locationsSteps_); an answer from an older engine says nothing. */
export function serverSteps(raw: unknown): {
  steps: { id: string; label: string; landed: boolean; words: string }[]
  slices: string[]
  mirror: string[]
  app: string
} {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [])
  const steps = (Array.isArray(o.steps) ? o.steps : []).map((s) => {
    const x = s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
    return { id: String(x.id ?? ''), label: String(x.label ?? ''), landed: x.landed === true, words: String(x.words ?? '') }
  }).filter((s) => s.id)
  return { steps, slices: list(o.slices), mirror: list(o.mirror), app: String(o.app ?? '') }
}

/** What the run leans on outside itself; the page hands the real ones (applyDeps), a test its own. */
export type ApplyDeps = {
  /** an SSE frame named `name` heard within `waitMs` of the call; the listener is on from the call itself */
  heard: (name: string, waitMs: number) => Promise<boolean>
  /** the relay's /notify answer: the resources it queued */
  notify: (resources: string[]) => Promise<string[]>
  /** this tab hears the relay's stream right now */
  live: () => boolean
  /** the clock, for the words */
  now: () => number
  /** the slices the relay wrote again, read again by this tab */
  refetch?: (names: string[]) => Promise<void>
  /** hears how each queued sheet write ends; the listener's own stop */
  settled?: (ids: string[], fn: (id: string, s: SheetSettled) => void) => () => void
}

/** The relay's word on queued edits: `edit-written:<id>` and `edit-refused:<id>` frames, and a refusal's words. */
function heardSettled(ids: string[], fn: (id: string, s: SheetSettled) => void): () => void {
  const offs = ids.flatMap((id) => [
    onLiveEvent(`edit-written:${id}`, () => fn(id, { state: 'written', words: '' })),
    onLiveEvent(`edit-refused:${id}`, () => fn(id, { state: 'refused', words: '' })),
  ])
  offs.push(onWriteRefused((msg) => {
    for (const id of msg.edits ?? []) if (ids.includes(id)) fn(id, { state: 'refused', words: msg.why })
  }))
  return () => { for (const off of offs) off() }
}

/** A frame by name, through the tab's one stream (snapshotClient.onLiveEvent). */
function heardLive(name: string, waitMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean) => {
      if (done) return
      done = true
      off()
      clearTimeout(timer)
      resolve(v)
    }
    const off = onLiveEvent(name, () => finish(true))
    const timer = setTimeout(() => finish(false), waitMs) as unknown as ReturnType<typeof setTimeout> & { unref?: () => void }
    timer.unref?.()
  })
}

export const applyDeps: ApplyDeps = {
  heard: heardLive,
  notify: noteWriteAwaited,
  live: liveConnected,
  now: () => Date.now(),
  refetch: refetchSlices,
  settled: heardSettled,
}

/** The app an Apply runs in: whose ring it listens for, and what its page reads again. */
export type ApplyWhere = { app: string; label: string; subject: string }

export const LOCATIONS_WHERE: ApplyWhere = { app: 'locations', label: 'Locations', subject: 'house' }

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })

const errWords = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'The server did not say why.'

// Run one Apply: `send` the edit, then confirm each step as its server answers.
export async function runApply(o: {
  send: () => Promise<unknown>
  reread: (answer: unknown) => Promise<unknown>
  onState: (s: ApplyState) => void
  deps?: ApplyDeps
  /** the stop of the listener that keeps a queued sheet write's step, for the page to end with the strip */
  keep?: (stop: () => void) => void
  /** a queued sheet write ended after the run: written, or refused with the server's words */
  later?: (s: SheetSettled) => void
  /** the app the edit is made in (Locations unless said) */
  where?: ApplyWhere
}): Promise<{ answer: unknown } | { refusal: string }> {
  const deps = o.deps ?? applyDeps
  const where = o.where ?? LOCATIONS_WHERE
  let state: ApplyState = { ...APPLY_IDLE, phase: 'running', steps: APPLY_IDLE.steps.map((s) => ({ ...s })) }
  const set = (id: ApplyStepId, step: Partial<ApplyStep>) => {
    state = { ...state, steps: state.steps.map((s) => (s.id === id ? { ...s, ...step } : s)) }
    o.onState(state)
  }
  set('sheet', { state: 'running', words: 'Sending the edit…' })
  // listening before the write leaves: the relay rings as the answer passes it, which can beat the answer here
  const wasLive = deps.live()
  const ring = deps.heard(appRingName(where.app), RING_WAIT_MS)
  let answer: unknown
  try {
    answer = await o.send()
  } catch (e) {
    const words = errWords(e)
    state = { ...state, phase: 'refused', refusal: words }
    set('sheet', { state: 'failed', words })
    return { refusal: words }
  }
  const overlay = overlayOf(answer)
  if (overlay) {
    // the relay's JSON took it: every read shows it now, and the sheet write waits in its queue
    state = { ...state, steps: OVERLAY_STEPS.map((s) => ({ ...s, state: 'waiting' as ApplyStepState, words: '' })) }
    const said = serverSteps(answer)
    set('json', { state: 'landed', words: said.steps.find((s) => s.id === 'json')?.words || 'Laid on the relay\'s JSON overlay.' })
    set('cache', { state: 'landed', words: said.steps.find((s) => s.id === 'cache')?.words
      || 'The relay lays it over the pack and every kept copy as they are read.' })
    set('sheet', { state: 'owed', words: queuedWords(overlay) })
    const written = new Set<string>()
    const stop = (deps.settled ?? heardSettled)(overlay.ids, (id, s) => {
      if (s.state === 'refused') {
        // the frame and the words travel apart: the server's words, whenever they come, are the ones kept
        const before = state.steps.find((x) => x.id === 'sheet')
        const words = s.words || (before?.state === 'failed' ? before.words : '')
          || `The platform refused it after it was laid; the ${where.subject} is read again as it is.`
        state = { ...state, phase: 'refused', refusal: words }
        set('sheet', { state: 'failed', words })
        o.later?.({ state: 'refused', words: s.words })
        return
      }
      if (state.steps.some((x) => x.id === 'sheet' && x.state === 'failed')) return
      written.add(id)
      if (overlay.ids.every((i) => written.has(i))) {
        const words = `Written to the sheet at ${clock(deps.now())}.`
        set('sheet', { state: 'landed', words })
        o.later?.({ state: 'written', words })
      }
    })
    o.keep?.(stop)
    void (async () => {
      if (!overlay.slices.length) {
        set('slices', { state: 'skipped', words: 'No slice carries this change; the pack and the kept copies show it.' })
        return
      }
      set('slices', { state: 'running', words: `Reading ${overlay.slices.join(', ')} again…` })
      try {
        await (deps.refetch ?? refetchSlices)(overlay.slices)
        set('slices', { state: 'landed', words: `The relay laid it into ${overlay.slices.join(', ')}.` })
      } catch (e) {
        set('slices', { state: 'owed', words: `The relay laid it into ${overlay.slices.join(', ')}; this tab reads them on its next turn (${errWords(e)}).` })
      }
    })().catch(() => {})
  } else if (writeQueued(answer)) {
    set('sheet', { state: 'owed', words: QUEUED_WORDS })
    set('cache', { state: 'owed', words: 'The server retires its kept copies when it writes.' })
    set('slices', { state: 'owed', words: 'The slices follow once the server has written it.' })
  } else {
    const said = serverSteps(answer)
    // a write Python keeps in Postgres names that store in the sheet's place
    const sheet = said.steps.find((s) => s.id === 'sheet') ?? said.steps.find((s) => s.id === 'postgres')
    const cache = said.steps.find((s) => s.id === 'cache')
    set('sheet', { state: 'landed', label: sheet?.label || 'Sheet', words: sheet?.words || 'The door answered: written.' })
    set('cache', cache?.landed
      ? { state: 'landed', words: cache.words || 'The server retired its kept copies.' }
      : { state: 'owed', words: 'The server did not say it retired its kept copies (an engine older than this screen).' })
    const named = said.slices
    const mirror = said.mirror.map((m) => MIRROR_WORDS[m] ?? m)
    const mirrorWords = mirror.length
      ? `${mirror.join(', ')} ${mirror.length === 1 ? 'is' : 'are'} built from the mirror's copy of the sheet and follow${mirror.length === 1 ? 's' : ''} on its next pass, within minutes.`
      : ''
    void (async () => {
      if (!named.length) {
        set('slices', mirror.length ? { state: 'owed', words: mirrorWords }
          : { state: 'skipped', words: 'No slice carries this change; the page reads it from its door.' })
        return
      }
      set('slices', { state: 'running', words: `Asking the relay to rebuild ${named.join(', ')}…` })
      // the frames are listened for before the relay is asked, so a quick rebuild is not missed
      const rebuilt = named.map((n) => deps.heard(n, SLICE_WAIT_MS))
      let queued: string[] = []
      try { queued = await deps.notify(named) } catch { queued = [] }
      const notQueued = named.filter((n) => !queued.includes(n))
      const heard = await Promise.all(rebuilt)
      const done = named.filter((n, i) => queued.includes(n) && heard[i])
      const late = queued.filter((n) => !done.includes(n))
      const parts = [
        done.length ? `Rebuilt: ${done.join(', ')}.` : '',
        late.length ? `Queued, not rebuilt yet: ${late.join(', ')}.` : '',
        notQueued.length ? `The relay did not take: ${notQueued.join(', ')}.` : '',
        mirrorWords,
      ].filter(Boolean)
      set('slices', { state: done.length === named.length && !mirror.length ? 'landed' : 'owed', words: parts.join(' ') })
    })().catch(() => {})
  }
  const ringDone = (async () => {
    set('ring', { state: 'running', words: 'Listening for the relay\'s ring…' })
    const rang = await ring
    if (rang) set('ring', { state: 'landed', words: `The relay rang ${where.label} at ${clock(deps.now())}.` })
    else set('ring', { state: 'owed', words: wasLive || deps.live()
      ? `No ring heard within ${Math.round(RING_WAIT_MS / 1000)} s; the page was read again directly.`
      : 'This tab\'s live line is closed, so no ring can be heard; the page was read again directly.' })
  })()
  const pageDone = (async () => {
    set('page', { state: 'running', words: `Reading the ${where.subject} again…` })
    try {
      await o.reread(answer)
      set('page', { state: 'landed', words: `Read again at ${clock(deps.now())}.` })
    } catch (e) {
      set('page', { state: 'failed', words: `The ${where.subject} could not be read again: ${errWords(e)}` })
    }
  })()
  await Promise.all([ringDone, pageDone])
  // the slices step settles on its own clock; the run waits for it too, so done means every step has its word
  await waitSettled(() => state.steps.find((s) => s.id === 'slices')?.state ?? 'skipped')
  // a queued sheet write the platform already refused keeps its refusal
  if (state.phase !== 'refused') state = { ...state, phase: 'done' }
  o.onState(state)
  return { answer }
}

/** Resolves once the step is past waiting and running. */
async function waitSettled(read: () => ApplyStepState): Promise<void> {
  while (read() === 'waiting' || read() === 'running') await new Promise((r) => setTimeout(r, 50))
}

/** Every step that was asked for landed. */
export const appliedEverywhere = (s: ApplyState): boolean =>
  s.phase === 'done' && s.steps.every((x) => x.state === 'landed' || x.state === 'skipped')

/** The strip's last line. */
export function applySummary(s: ApplyState): string {
  if (s.phase === 'refused') return 'Not applied.'
  if (s.phase !== 'done') return 'Applying…'
  if (appliedEverywhere(s)) return 'Applied everywhere this page reads.'
  const owed = s.steps.filter((x) => x.state === 'owed' || x.state === 'failed').map((x) => x.label.toLowerCase())
  if (s.steps[0].id === 'json' && owed.join() === 'sheet') return 'Applied — every read shows it now; the sheet write is queued.'
  return `Applied — the ${s.steps[0].label.toLowerCase()} holds it; ${owed.join(', ')} ${owed.length === 1 ? 'is' : 'are'} still on the way.`
}
