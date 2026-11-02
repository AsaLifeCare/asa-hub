// Transfers waiting on this reader, above the House Calendars grid (server/shift_handoff.board), in info blue.
// The side comes from the session, never from a name compared here.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/stores/useToastStore'
import { onLiveEvent } from '@/lib/snapshotClient'
import HandoffCard from './HandoffCard'
import { HOUSECAL_LIVE_EVENT } from './houseCalTypes'
import { lane } from './laneFetch'
import { OFFER_PATH, actOnHandoff } from './handoffActions'
import type { HandoffView } from './requestsLogic'

type Board = { waiting_on_me: HandoffView[]; mine: HandoffView[]; open: HandoffView[]; me: string }

export default function HandoffWaiting({ onChanged, onCount }: {
  onChanged?: () => void
  /** how many wait on this reader's answer; null when the board could not be read */
  onCount?: (waiting: number | null) => void
}) {
  const [board, setBoard] = useState<Board | null>(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState('')
  const told = useRef(onCount)
  useEffect(() => { told.current = onCount })

  const load = useCallback(() => {
    lane<Board>(OFFER_PATH)
      .then((d) => { setBoard(d); setFailed(''); told.current?.((d.waiting_on_me ?? []).length) })
      // a failed read is said, never "nothing waiting"
      .catch((err) => {
        setFailed(err instanceof Error ? err.message : 'could not be read')
        told.current?.(null)
      })
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const off = onLiveEvent(HOUSECAL_LIVE_EVENT, load)
    return () => off()
  }, [load])

  const act = useCallback(async (h: HandoffView, what: 'yes' | 'no' | 'withdraw') => {
    setBusy(h.id)
    try {
      await actOnHandoff(h, what)
      load()
      onChanged?.()
    } catch (err) {
      toast({ type: 'warning', title: what === 'withdraw' ? 'Not withdrawn' : 'Not answered',
              body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }, [load, onChanged])

  if (failed) {
    return (
      <p className="mb-3 text-[11.5px] text-text-3">
        The transfers waiting on you could not be read ({failed}) — this is not saying there are none.
      </p>
    )
  }
  const waiting = board?.waiting_on_me ?? []
  const mine = board?.mine ?? []
  if (!waiting.length && !mine.length) return null
  return (
    <section id="transfers-waiting" aria-label="Transfers waiting on you" className="mb-3 grid gap-2">
      {waiting.length > 0 && (
        <p className="text-[13px] font-semibold text-info">
          {waiting.length} {waiting.length === 1 ? 'transfer needs' : 'transfers need'} your answer
        </p>
      )}
      {waiting.map((h) => (
        <HandoffCard key={h.id} h={h} busy={busy === h.id} tone="info"
          onAnswer={(x, word) => void act(x, word)} onWithdraw={(x) => void act(x, 'withdraw')} />
      ))}
      {mine.length > 0 && (
        <p className="text-[12px] font-semibold text-text-2">Your transfers, still waiting</p>
      )}
      {mine.map((h) => (
        <HandoffCard key={h.id} h={h} busy={busy === h.id} tone="info" className="border border-border bg-surface"
          onAnswer={(x, word) => void act(x, word)} onWithdraw={(x) => void act(x, 'withdraw')} />
      ))}
    </section>
  )
}
