// ONE CLIENT'S DAILY NOTES, ASKED FOR ONLY WHEN SOMEBODY OPENS DAILY.
// Opening a chart spends nothing: the section that calls this mounts when the Daily entry is chosen, and the read…
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { keptGeneration, onForgetAllKept } from '@/lib/kept'
import { readClientDaily, type ClientDaily, type DailyAnswer, type DoorReason } from './dailyApi'

/** The sweep files new notes every ten minutes; half that is fresh enough. */
const FRESH_MS = 5 * 60_000
const MEMORY_MAX = 30

const memory = new Map<string, { at: number; data: ClientDaily }>()

onForgetAllKept(() => memory.clear())

const memoryKey = (client: string) => `${String(useAuthStore.getState().user?.id ?? '')}:${client}`

function remembered(client: string): ClientDaily | null {
  const k = memoryKey(client)
  const hit = memory.get(k)
  if (!hit) return null
  if (Date.now() - hit.at > FRESH_MS) {
    memory.delete(k)
    return null
  }
  return hit.data
}

/** `k` is the key taken when the read started — never the one signed in when it landed. */
function remember(k: string, data: ClientDaily) {
  memory.delete(k)
  memory.set(k, { at: Date.now(), data })
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value
    if (oldest === undefined) break
    memory.delete(oldest)
  }
}

function forget(client: string) {
  memory.delete(memoryKey(client))
}

export type DailyState =
  | { phase: 'off' }
  | { phase: 'loading' }
  | { phase: 'ok'; data: ClientDaily }
  | { phase: 'error'; status: number; reason: DoorReason | ''; message: string }

// @param client the client's name exactly as the clients slice spells it, or '' @param enabled false while Daily is…
export function useClientDaily(client: string, enabled: boolean): { state: DailyState; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [answer, setAnswer] = useState<{ client: string; attempt: number; ans: DailyAnswer<ClientDaily> } | null>(null)

  useEffect(() => {
    if (!client || !enabled || remembered(client)) return
    const ctl = new AbortController()
    const k = memoryKey(client)
    const generation = keptGeneration()
    void readClientDaily(client, ctl.signal).then((ans) => {
      if (ctl.signal.aborted) return
      if (generation === keptGeneration()) {
        if (ans.ok) remember(k, ans.data)
        else if (ans.status === 401 || ans.status === 403) memory.clear()
      }
      setAnswer({ client, attempt, ans })
    })
    return () => ctl.abort()
  }, [client, enabled, attempt])

  const retry = () => {
    forget(client)
    setAttempt((n) => n + 1)
  }

  if (!client || !enabled) return { state: { phase: 'off' }, retry }
  if (answer && answer.client === client && answer.attempt === attempt) {
    const { ans } = answer
    return ans.ok
      ? { state: { phase: 'ok', data: ans.data }, retry }
      : { state: { phase: 'error', status: ans.status, reason: ans.reason, message: ans.message }, retry }
  }
  const known = remembered(client)
  if (known) return { state: { phase: 'ok', data: known }, retry }
  return { state: { phase: 'loading' }, retry }
}
