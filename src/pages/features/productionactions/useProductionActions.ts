/** The runbook: one relay read (no timer), the acts through Apps Script, and the overlay that shows a write at once. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lane, LaneError } from '@/pages/features/shifts/laneFetch'
import { gasAction } from '@/features/hiring/shared'
import {
  loadOverlay, mergeOverlay, newClientId, pruneOverlay, saveOverlay, withAction, withRun,
  type Overlay, type PAction, type PreviewAnswer, type PRun, type RunbookView, type RunPayload,
} from '@/lib/productionActions'

export const PRODUCTION_ACTIONS_PATH = '/hub-lanes/production-actions'

export type RunbookState = {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'refused'
  data: RunbookView | null
  error: string
  readAt: number
  refreshing: boolean
}

const IDLE: RunbookState = { status: 'idle', data: null, error: '', readAt: 0, refreshing: false }

export type RunAnswer = { run: PRun; open?: string; repeat?: boolean }
export type SaveAnswer = { run: PRun; action: PAction | null }

export const NOT_ANSWERED = 'The platform took the request but has not answered yet — refresh in a minute to see whether it went through.'

export function useProductionActions(enabled: boolean) {
  const [state, setState] = useState<RunbookState>(IDLE)
  const [overlay, setOverlay] = useState<Overlay>(() => loadOverlay())
  const flight = useRef<Promise<void> | null>(null)

  const keep = useCallback((next: (o: Overlay) => Overlay) => {
    setOverlay((o) => {
      const n = next(o)
      saveOverlay(n)
      return n
    })
  }, [])

  const read = useCallback(async () => {
    if (!enabled) return
    if (flight.current) return flight.current
    setState((s) => ({ ...s, status: s.data ? s.status : 'loading', refreshing: true }))
    const run = (async () => {
      try {
        const got = await lane<RunbookView>(PRODUCTION_ACTIONS_PATH)
        keep((o) => pruneOverlay(o, got, Date.now()))
        setState({ status: 'ready', data: got, error: '', readAt: Date.now(), refreshing: false })
      } catch (err) {
        const refused = err instanceof LaneError && err.status === 404
        const message = err instanceof Error ? err.message : String(err)
        setState((s) => ({ ...s, status: refused ? 'refused' : 'failed', error: message, refreshing: false,
                           data: refused ? null : s.data }))
      } finally {
        flight.current = null
      }
    })()
    flight.current = run
    return run
  }, [enabled, keep])

  useEffect(() => {
    if (!enabled) return
    void read()
    const onFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void read()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [enabled, read])

  const view = useMemo(() => mergeOverlay(state.data, overlay), [state.data, overlay])

  const landed = useCallback((run: PRun | null | undefined, action?: PAction | null | undefined) => {
    const now = Date.now()
    keep((o) => {
      let n = o
      if (run) n = withRun(n, run, now)
      if (action) n = withAction(n, action, now)
      return n
    })
    void read()
  }, [keep, read])

  const preview = useCallback(async (ids: string[]) => {
    const got = await gasAction<PreviewAnswer>('productionActionPreview', { action_ids: ids }, { timeoutMs: 180000 })
    if (!got?.items) throw new Error(NOT_ANSWERED)
    return got
  }, [])

  const answered = useCallback(<T extends { run: PRun }>(got: T | undefined, action?: PAction | null): T => {
    if (!got?.run) throw new Error(NOT_ANSWERED)
    landed(got.run, action)
    return got
  }, [landed])

  const run = useCallback(async (payload: RunPayload) =>
    answered(await gasAction<RunAnswer>('productionActionRun', payload, { timeoutMs: 180000 })), [answered])

  const mark = useCallback(async (actionId: string, done: boolean) =>
    answered(await gasAction<RunAnswer>('productionActionMark',
      { action_id: actionId, client_id: newClientId(), done }, { timeoutMs: 60000 })), [answered])

  const undo = useCallback(async (runId: string) =>
    answered(await gasAction<RunAnswer>('productionActionUndo',
      { run_id: runId, client_id: newClientId() }, { timeoutMs: 180000 })), [answered])

  const save = useCallback(async (action: Record<string, unknown>) => {
    const got = await gasAction<SaveAnswer>('productionActionSave', { client_id: newClientId(), action }, { timeoutMs: 60000 })
    return answered(got, got?.action)
  }, [answered])

  return { state, view, refresh: read, preview, run, mark, undo, save }
}
