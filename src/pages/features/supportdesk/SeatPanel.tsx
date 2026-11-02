// A request redirected to this account, opened from My Work in the same right panel Support Requests draws: read…
// Never a dialog.
import { useCallback, useEffect, useState } from 'react'
import SidePanel from '@/components/shared/SidePanel'
import { toast } from '@/stores/useToastStore'
import { DecisionBlock, PanelBody, decisionKey } from './RequestPanel'
import { decide, readSeat } from './supportDeskLane'
import { decideToast, isConflict, saidOf, sentence, type Row, type Seat, type Verdict } from './supportDeskModel'

export type SeatState = { status: 'idle' | 'loading' | 'ready' | 'failed'; seat: Seat | null; error: string }

const IDLE: SeatState = { status: 'idle', seat: null, error: '' }
const noop = () => {}

/** The seat of one request while its panel is open: read on opening, read again after a refusal. */
export function useSeat(requestRef: string, open: boolean): SeatState & { reload: () => void } {
  const [state, setState] = useState<SeatState>(IDLE)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!open || !requestRef) { setState(IDLE); return }
    let live = true
    setState((s) => ({ status: 'loading', seat: s.seat?.row?.ref === requestRef ? s.seat : null, error: '' }))
    readSeat(requestRef)
      .then((seat) => { if (live) setState({ status: 'ready', seat, error: '' }) })
      .catch((err: unknown) => { if (live) setState({ status: 'failed', seat: null, error: saidOf(err) }) })
    return () => { live = false }
  }, [requestRef, open, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

export function SeatView({ open, requestRef, title, state, busy, onClose, onDecide, onReload }: {
  open: boolean
  requestRef: string
  /** what the panel says while the request is read: the My Work row's own words */
  title: string
  state: SeatState
  busy: string
  onClose: () => void
  onDecide: (row: Row, verdict: Verdict, note: string, to?: string) => void
  onReload: () => void
}) {
  const row = state.seat?.row ?? null
  return (
    <SidePanel open={open} onClose={onClose} label={requestRef || 'Request'} title={row?.type.display || title}>
      {!row && state.status === 'loading' && <p className="mt-2 text-[12.5px] text-text-3" data-seat-loading="">Reading the request…</p>}
      {!row && state.status === 'failed' && (
        <p role="alert" className="mt-2 text-[12.5px] leading-5 text-danger" data-seat-failed="">
          The request could not be read: {sentence(state.error)}
          <button type="button" onClick={onReload} className="ml-1.5 font-semibold underline">Try again</button>
        </p>
      )}
      {row && state.seat && (
        <>
          <PanelBody row={row} viewer={state.seat.viewer} busy={busy} onAdp={noop} />
          <DecisionBlock key={decisionKey(row)} row={row} people={state.seat.people} peopleWhy={state.seat.people_why} busy={busy}
            onDecide={onDecide} />
        </>
      )}
    </SidePanel>
  )
}

/** My Work's panel for a redirected request; `onAnswered` takes the row off My Work once the server recorded it. */
export default function SeatPanel({ open, requestRef, title, onClose, onAnswered }: {
  open: boolean
  requestRef: string
  title: string
  onClose: () => void
  onAnswered: () => void
}) {
  const state = useSeat(requestRef, open)
  const [busy, setBusy] = useState('')
  const onDecide = async (row: Row, verdict: Verdict, note: string, to?: string) => {
    setBusy(`decide:${row.ref}`)
    try {
      const a = await decide(row.ref, verdict, note, to)
      toast(decideToast(verdict, a))
      onAnswered()
    } catch (err) {
      const conflict = isConflict(err)
      toast({ type: conflict ? 'warning' : 'danger', title: conflict ? 'Somebody answered first' : 'Not recorded', body: saidOf(err) })
      if (conflict) state.reload()
    } finally {
      setBusy('')
    }
  }
  return (
    <SeatView open={open} requestRef={requestRef} title={title} state={state} busy={busy} onClose={onClose}
      onDecide={(row, v, note, to) => void onDecide(row, v, note, to)} onReload={state.reload} />
  )
}
