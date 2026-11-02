// The strip an edition's Apply runs in the right panel: a bar that moves while the write lands, one line per place…
// A refusal is the strip's own words; nothing is claimed for a step nobody confirmed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Circle, Clock, Loader2, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useShellHides } from '@/lib/myWorkHides'
import type { EditChange } from '@/lib/recordEdit'
import {
  APPLY_IDLE, LOCATIONS_WHERE, applySummary, appliedEverywhere, overlayOf, runApply, type ApplyDeps, type ApplyState,
  type ApplyStepState, type ApplyWhere,
} from './locationApply'
import { locationOverlaid, locationWritten, locationWrote, rereadLocation, type Reread } from './useLocation'

const ICON: Record<ApplyStepState, typeof Check> = {
  waiting: Circle, running: Loader2, landed: Check, owed: Clock, skipped: Minus, failed: X,
}
const TINT: Record<ApplyStepState, string> = {
  waiting: 'text-text-3', running: 'text-primary', landed: 'text-[var(--success)]', owed: 'text-[var(--warning)]',
  skipped: 'text-text-3', failed: 'text-[var(--danger)]',
}
const WORD: Record<ApplyStepState, string> = {
  waiting: 'Waiting', running: 'Working', landed: 'Landed', owed: 'On the way', skipped: 'Not needed', failed: 'Not landed',
}

export type ApplyRun = {
  state: ApplyState
  /** send the edit through the strip: the door's answer, or a throw with the refusal's words */
  run: (send: () => Promise<unknown>, rereads: Reread[]) => Promise<unknown>
  reset: () => void
}

/** What an Apply's page does around the write: the app, and how its record is forgotten and read again. */
export type ApplyTarget = {
  where: ApplyWhere
  /** the relay's overlay took it: the answers held here go, the relay's copies already show it */
  overlaid: () => void
  /** the door answered: the record is read again now, and again once a queued write had time */
  wrote: (answer: unknown, sentAt: number) => void
  /** refused: the record read again, so a stale field shows what it holds now */
  written: (sentAt: number) => void
  reread: (list: Reread[]) => Promise<unknown>
}

/** A house of Locations as an Apply's target. */
export const locationTarget = (house: string): ApplyTarget => ({
  where: LOCATIONS_WHERE,
  overlaid: () => locationOverlaid(house),
  wrote: (answer, sentAt) => { locationWrote(house, answer, sentAt) },
  written: (sentAt) => locationWritten(house, sentAt),
  reread: rereadLocation,
})

/** A Locations panel opened from a client's record (Clients): the client's key the door decides by, and Clients' own
 * Apply target and reads again in place of the house's. `edit`: a page that opens a report with no house (Support
 * Requests › Incidents) sends its edit through its own call of the same door, witnessed by the row's cells as opened. */
export type PanelVia = {
  client: string
  target: ApplyTarget
  rereads: Reread[]
  edit?: (id: string, changes: EditChange[], cells: Record<string, string>) => Promise<unknown>
}

/** One Apply at a time for a house: the write, the steps, and the house's sections read again after it. */
export function useApply(house: string, deps?: ApplyDeps): ApplyRun {
  const target = useMemo(() => locationTarget(house), [house])
  return useApplyFor(target, deps)
}

/** One Apply at a time for any app's record (ApplyTarget); `target` is kept stable by its caller. */
export function useApplyFor(target: ApplyTarget, deps?: ApplyDeps): ApplyRun {
  const [state, setState] = useState<ApplyState>(APPLY_IDLE)
  const running = useRef(false)
  // the listener a queued sheet write keeps until it ends, or until the strip goes
  const listening = useRef<(() => void) | null>(null)
  const unlisten = useCallback(() => {
    listening.current?.()
    listening.current = null
  }, [])
  useEffect(() => unlisten, [unlisten])
  const run = useCallback(async (send: () => Promise<unknown>, rereads: Reread[]) => {
    if (running.current) throw new Error('An edit is still being applied.')
    running.current = true
    unlisten()
    const sent = Date.now()
    let rolledBack = false
    try {
      const got = await runApply({
        send,
        where: target.where,
        reread: async (answer) => {
          if (overlayOf(answer)) target.overlaid()
          else target.wrote(answer, sent)
          await target.reread(rereads)
        },
        onState: setState,
        deps,
        keep: (stop) => { listening.current = stop },
        later: (s) => {
          if (s.state === 'written') {
            unlisten()
            return
          }
          if (rolledBack) return
          rolledBack = true
          // refused after it was laid: the record read again as the relay holds it now, the words still heard a while
          target.overlaid()
          void target.reread(rereads).catch(() => {})
          const stop = listening.current
          const t = setTimeout(() => { if (listening.current === stop) unlisten() }, 15_000) as unknown as { unref?: () => void }
          t.unref?.()
        },
      })
      if ('refusal' in got) {
        // whatever the door refused, the record is read again so a stale field shows what it holds now
        target.written(sent)
        throw new Error(got.refusal)
      }
      return got.answer
    } finally {
      running.current = false
    }
  }, [target, deps, unlisten])
  const reset = useCallback(() => {
    unlisten()
    setState(APPLY_IDLE)
  }, [unlisten])
  return { state, run, reset }
}

export default function ApplyStrip({ state, onDone, onAgain }: {
  state: ApplyState
  /** the run is over: the panel closes */
  onDone?: () => void
  /** after a refusal: back to the form */
  onAgain?: () => void
}) {
  // the progress panel is the master's alone while Settings › My Work hides it: Apply does the edit and the panel
  // closes by itself; a refusal is still said
  const quiet = useShellHides().apply_progress
  const closed = useRef(false)
  useEffect(() => {
    if (state.phase !== 'done') {
      closed.current = false
      return
    }
    if (quiet && onDone && !closed.current) {
      closed.current = true
      onDone()
    }
  }, [quiet, state.phase, onDone])
  if (state.phase === 'idle') return null
  if (quiet) {
    if (state.phase === 'refused') {
      return (
        <div className="grid gap-2" data-apply-strip="refused" data-apply-quiet="">
          <p role="alert" className="text-[12.5px] font-semibold text-[var(--danger)]" data-apply-refusal="">{state.refusal}</p>
          {onAgain && (
            <button type="button" onClick={onAgain} data-apply-again=""
              className="inline-flex h-8 w-fit items-center rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2">
              Keep editing
            </button>
          )}
        </div>
      )
    }
    return (
      <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-[12.5px] text-text-2"
        data-apply-strip={state.phase} data-apply-quiet="">
        {state.phase === 'running' ? <><Loader2 size={13} className="animate-spin" /> Applying…</> : <><Check size={13} /> Applied.</>}
      </p>
    )
  }
  const settled = state.steps.filter((s) => s.state !== 'waiting' && s.state !== 'running').length
  const pct = state.phase === 'done' ? 100 : Math.max(8, Math.round((settled / state.steps.length) * 100))
  return (
    <div className="grid gap-3 rounded-md border border-border bg-surface-2/60 p-3" data-apply-strip={state.phase}
      role="status" aria-live="polite">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" data-apply-bar={pct}>
        <div className={cn('h-full rounded-full transition-[width] duration-500',
          state.phase === 'refused' ? 'bg-[var(--danger)]' : appliedEverywhere(state) ? 'bg-[var(--success)]' : 'bg-primary',
          state.phase === 'running' && 'animate-pulse')}
          style={{ width: `${pct}%` }} />
      </div>
      <ul className="grid gap-1.5">
        {state.steps.map((s) => {
          const Icon = ICON[s.state]
          return (
            <li key={s.id} className="flex items-start gap-2 text-[12.5px] leading-[18px]" data-apply-step={s.id} data-state={s.state}>
              <Icon size={14} className={cn('mt-0.5 shrink-0', TINT[s.state], s.state === 'running' && 'animate-spin')} />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-text-1">{s.label}</span>
                <span className={cn('ml-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]', TINT[s.state])}>{WORD[s.state]}</span>
                {s.words && <span className="mt-0.5 block break-words text-text-3">{s.words}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {state.phase === 'refused' && (
        <p role="alert" className="text-[12.5px] font-semibold text-[var(--danger)]" data-apply-refusal="">{state.refusal}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <span className="text-[12px] text-text-2" data-apply-summary="">{applySummary(state)}</span>
        {state.phase === 'done' && onDone && (
          <button type="button" onClick={onDone} data-apply-done=""
            className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover">
            Done
          </button>
        )}
        {state.phase === 'refused' && onAgain && (
          <button type="button" onClick={onAgain} data-apply-again=""
            className="inline-flex h-8 items-center rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2">
            Keep editing
          </button>
        )}
      </div>
    </div>
  )
}
