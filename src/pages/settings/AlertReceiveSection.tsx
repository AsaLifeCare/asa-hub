// Settings → Alerts I receive: three switches, one per alert, each the reader's own.
// The page asks the server first (useAlertReceive); the section and its nav entry exist only when the server…
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import ConfigReadFailed from './ConfigReadFailed'
import {
  RECEIVE_ALERTS, RECEIVE_KEEPS, RECEIVE_LANDS, RECEIVE_SUB, receiveFrom, type ReceivePart, type ReceiveRead,
} from './alertReceive'

export type ReceiveState =
  | { phase: 'asking' }
  | { phase: 'absent' }
  | { phase: 'ready'; read: ReceiveRead }
  | { phase: 'failed'; why: string }

// Whether the section exists for this person, and its values.
export function useAlertReceive(enabled: boolean, who: string) {
  const [state, setState] = useState<ReceiveState>({ phase: enabled ? 'asking' : 'absent' })
  const load = useCallback(async () => {
    if (!enabled || !who) { setState({ phase: 'absent' }); return }
    setState((s) => (s.phase === 'ready' ? s : { phase: 'asking' }))
    try {
      const read = receiveFrom(await gasAction<unknown>('alertReceiveGet', {}))
      setState(read ? { phase: 'ready', read } : { phase: 'failed', why: 'the answer carried no choices' })
    } catch (e) {
      const status = (e as { status?: number }).status
      setState(status === 503
        ? { phase: 'failed', why: (e instanceof Error && e.message) || `Error ${status}` }
        : { phase: 'absent' })
    }
  }, [enabled, who])
  useEffect(() => { void load() }, [load])
  return { state, setState, reload: load }
}

export default function AlertReceiveSection({ state, onState, onRetry }: {
  state: ReceiveState
  onState: (s: ReceiveState) => void
  onRetry: () => void
}) {
  const [busy, setBusy] = useState(false)

  const flip = async (part: ReceivePart, on: boolean) => {
    if (state.phase !== 'ready') return
    const before = state.read
    onState({ phase: 'ready', read: { ...before, receive: { ...before.receive, [part]: on } } })
    setBusy(true)
    try {
      const got = receiveFrom(await gasAction<unknown>('alertReceiveSet', { part, receive: on }))
      if (got) onState({ phase: 'ready', read: got })
      toast({ type: 'success', title: 'Saved', body: RECEIVE_LANDS })
    } catch (e) {
      onState({ phase: 'ready', read: before })
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.section id="alertreceive" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]">
      <Card padded={false} className="p-6">
        <CardHeader title="Alerts I receive" sub={RECEIVE_SUB} />
        {state.phase === 'ready' ? (
          <AlertReceiveView read={state.read} busy={busy} onFlip={(p, on) => void flip(p, on)} />
        ) : state.phase === 'failed' ? (
          <ConfigReadFailed why={state.why} onRetry={onRetry} />
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Reading your alerts…
          </p>
        )}
      </Card>
    </motion.section>
  )
}

/** The switches once the choices were read. */
export function AlertReceiveView({ read, busy, onFlip }: {
  read: ReceiveRead
  busy: boolean
  onFlip: (part: ReceivePart, on: boolean) => void
}) {
  return (
    <div className="space-y-3" data-receive-as={read.as}>
      {RECEIVE_ALERTS.map((a) => (
        <div key={a.part} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
          data-receive={a.part}>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-text-1">{a.label}</p>
            <p className="text-[12px] text-text-3">{a.desc}</p>
            <p className="text-[12px] font-medium text-text-2" data-receive-word={a.part}>
              {read.receive[a.part] ? 'On — it reaches you' : 'Off — it is not sent to you'}
            </p>
          </div>
          <Switch checked={read.receive[a.part]} onCheckedChange={(on) => onFlip(a.part, on)}
            disabled={busy || !read.saveable} aria-label={`Receive ${a.label}`} />
        </div>
      ))}
      {read.why ? <p className="text-[12px] font-medium text-text-2" data-receive-why="">{read.why}</p> : null}
      <p className="text-[12px] leading-4 text-text-3" data-receive-footnote="">{RECEIVE_KEEPS} {RECEIVE_LANDS}</p>
    </div>
  )
}
