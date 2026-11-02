// ONE CALL'S WORDS, ASKED FOR ONLY WHEN SOMEBODY OPENS THE CALL.
// The ask waits a breath (400 ms) after the selection settles, so running the arrow keys down a list does not fire…
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { keptGeneration, onForgetAllKept } from '@/lib/kept'
import { readCallDetail, type CallDetail, type DoorAnswer } from './hotlineApi'

const SETTLE_MS = 400
const MEMORY_MAX = 40

/** person:call → the answer, and the call as it stood when it was read */
const memory = new Map<string, { at: string; detail: CallDetail }>()

onForgetAllKept(() => memory.clear())

const memoryKey = (callId: string) => `${String(useAuthStore.getState().user?.id ?? '')}:${callId}`

/** What the answer was read for: the call, whether it had words, and its state. */
const standingOf = (callId: string, enabled: boolean, callState: string) =>
  `${callId}|${enabled ? 1 : 0}|${callState}`

/** The answer read for the call as it stands now, or null. */
function remembered(callId: string, standing: string): CallDetail | null {
  const got = memory.get(memoryKey(callId))
  return got && got.at === standing ? got.detail : null
}

/** The newest answer for the call, whatever it stood at — shown while it is read again. */
function lastKnown(callId: string): CallDetail | null {
  return memory.get(memoryKey(callId))?.detail ?? null
}

/** `k` is the key taken when the read started — never the one signed in when it landed. */
function remember(k: string, standing: string, detail: CallDetail) {
  memory.delete(k)
  memory.set(k, { at: standing, detail })
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value
    if (oldest === undefined) break
    memory.delete(oldest)
  }
}

export type DetailState =
  | { phase: 'off' }
  | { phase: 'loading' }
  | { phase: 'ok'; detail: CallDetail }
  | { phase: 'error'; status: number; message: string }

// @param callId the call to read, or '' for none @param enabled false when there is nothing to ask for (a call with…
export function useCallDetail(
  callId: string,
  enabled: boolean,
  callState = '',
): { state: DetailState; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [answer, setAnswer] = useState<{ standing: string; attempt: number; ans: DoorAnswer<CallDetail> } | null>(null)
  const standing = standingOf(callId, enabled, callState)

  useEffect(() => {
    if (!callId || !enabled || remembered(callId, standing)) return
    const ctl = new AbortController()
    const timer = window.setTimeout(() => {
      const k = memoryKey(callId)
      const generation = keptGeneration()
      void readCallDetail(callId, ctl.signal).then((ans) => {
        if (ctl.signal.aborted) return
        if (generation === keptGeneration()) {
          if (ans.ok) remember(k, standing, ans.data)
          else if (ans.status === 401 || ans.status === 403) memory.clear()
        }
        setAnswer({ standing, attempt, ans })
      })
    }, SETTLE_MS)
    return () => {
      window.clearTimeout(timer)
      ctl.abort()
    }
  }, [callId, enabled, standing, attempt])

  const retry = () => setAttempt((n) => n + 1)

  if (!callId || !enabled) return { state: { phase: 'off' }, retry }
  const known = remembered(callId, standing)
  if (known) return { state: { phase: 'ok', detail: known }, retry }
  // READ AGAIN, NOT GONE: the words this call already showed stay while the newer read runs, and stay when it fails…
  const previous = lastKnown(callId)
  if (answer && answer.standing === standing && answer.attempt === attempt) {
    if (answer.ans.ok) return { state: { phase: 'ok', detail: answer.ans.data }, retry }
    if (previous) return { state: { phase: 'ok', detail: previous }, retry }
    return { state: { phase: 'error', status: answer.ans.status, message: answer.ans.message }, retry }
  }
  if (previous) return { state: { phase: 'ok', detail: previous }, retry }
  return { state: { phase: 'loading' }, retry }
}
