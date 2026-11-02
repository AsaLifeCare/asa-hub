// Settings → Events (the master only — MASTER_ONLY_SECTIONS, anchor #events): every signal a write or a clock raises
// beside its answer, what it does, who answers it, on or off. The relay is told none of them; the ones only it heard
// are listed as retired with it.
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Archive, Loader2 } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { Switch } from '@/components/ui/switch'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { keepLane, keptLane, laneGeneration, onLaneRing } from '@/lib/laneKeep'
import { relayLane } from '@/lib/noticesApi'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export const EVENTS_PATH = '/hub-lanes/event-switches'
export const EVENTS_RING = 'event-switches'

export type EventRow = {
  key: string
  kind: string
  what: string
  here: string
  retired: boolean
  was: string
  enabled: boolean
  setBy: string
  setAt: string
}

export type EventsView = { events: EventRow[]; storeWhy: string; readAt: string }

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The lane's answer as this screen draws it; null when it is not the list. */
export function eventsViewFrom(raw: unknown): EventsView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (!Array.isArray(d.events)) return null
  const events: EventRow[] = []
  for (const x of d.events) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const key = text(r.key)
    if (!key) continue
    events.push({
      key,
      kind: text(r.kind),
      what: text(r.what),
      here: text(r.here),
      retired: r.retired === true,
      was: text(r.was),
      enabled: r.retired === true ? false : r.enabled !== false,
      setBy: text(r.set_by),
      setAt: text(r.set_at),
    })
  }
  return { events, storeWhy: text(d.store_why), readAt: text(d.read_at) }
}

/** What a row says about its state beyond the switch. */
export function eventStateWords(r: EventRow): string {
  if (r.retired) return `Retired with the relay: its only listener was ${r.was}.`
  if (!r.setAt || r.setBy === 'default') return ''
  const at = new Date(r.setAt)
  const when = Number.isNaN(at.getTime()) ? r.setAt : at.toLocaleString()
  return `Turned ${r.enabled ? 'on' : 'off'} ${when}${r.setBy ? ` by ${r.setBy}` : ''}.`
}

export default function EventsSection() {
  const [view, setView] = useState<EventsView | null>(() => eventsViewFrom(keptLane<unknown>(EVENTS_PATH)))
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    const generation = laneGeneration()
    try {
      const raw = await relayLane<unknown>(EVENTS_PATH)
      const got = eventsViewFrom(raw)
      if (!got) {
        setFailed('the read came back without the list')
        return
      }
      keepLane(EVENTS_PATH, raw, generation)
      setFailed('')
      setView(got)
    } catch (e) {
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => {
    void load()
    return onLaneRing(EVENTS_RING, () => void load())
  }, [load])

  /** One signal on or off; only what the lane answered is adopted. */
  const flip = async (r: EventRow, enabled: boolean) => {
    setBusy(r.key)
    const generation = laneGeneration()
    try {
      const raw = await relayLane<unknown>(EVENTS_PATH, {
        method: 'POST', body: JSON.stringify({ key: r.key, enabled }),
      })
      const got = eventsViewFrom(raw)
      if (got) {
        keepLane(EVENTS_PATH, raw, generation)
        setView(got)
      }
      toast({
        type: 'success',
        title: `${r.key}: ${enabled ? 'on' : 'off'}`,
        body: enabled ? 'It is answered again the next time it is raised.'
          : 'From the next time it is raised it is dropped there. Nothing was deleted.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Not switched', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  const live = view?.events.filter((r) => !r.retired) ?? []
  const retired = view?.events.filter((r) => r.retired) ?? []
  return (
    <motion.section
      id="events"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
      <Card>
        <CardHeader
          title="Events — every signal a write raises, on or off"
          sub="What each write or clock raises beside its answer, and who answers it. The relay is told none of them. One turned off is dropped where it is raised; none is ever deleted."
        />
        {view === null ? (
          failed ? (
            <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 text-[13px] leading-[20px] text-text-1"
              data-events-failed>
              <p>The events could not be read — {failed}. Nothing is shown, so nothing is switched blind.</p>
              <button type="button" onClick={() => { setFailed(''); void load() }}
                className="mt-2 inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                Try again
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the events…
            </p>
          )
        ) : (
          <div className="space-y-3" data-events>
            {failed && (
              <p className="rounded-md border border-border bg-tint-amber px-3 py-2 text-[12.5px] text-text-2" data-events-stale>
                The last read did not come back ({failed}); this is the list as it was last read.
              </p>
            )}
            {view.storeWhy && (
              <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-text-1" data-events-store>
                The switches could not be read just now ({view.storeWhy}).
              </p>
            )}
            <p className="text-[12px] text-text-3" data-events-count>
              {live.length} signal{live.length === 1 ? '' : 's'} answered here, {live.filter((r) => !r.enabled).length} off
              · {retired.length} retired with the relay
            </p>
            <div className="divide-y divide-border rounded-md border border-border">
              {live.map((r) => <EventLine key={r.key} r={r} busy={busy === r.key} onFlip={(e, on) => void flip(e, on)} />)}
            </div>
            {retired.length > 0 && (
              <div className="divide-y divide-border rounded-md border border-border" data-events-retired>
                {retired.map((r) => <EventLine key={r.key} r={r} busy={false} onFlip={() => {}} />)}
              </div>
            )}
          </div>
        )}
      </Card>
    </motion.section>
  )
}

function EventLine({ r, busy, onFlip }: { r: EventRow; busy: boolean; onFlip: (r: EventRow, enabled: boolean) => void }) {
  const said = eventStateWords(r)
  return (
    <div className="flex items-start gap-3 px-3 py-2" data-event={r.key} data-event-on={r.enabled ? '1' : '0'}>
      <span className={cn('mt-0.5 w-14 shrink-0 font-mono text-[11px] font-semibold',
        r.enabled ? 'text-primary' : 'text-text-3')}>{r.kind}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('break-all font-mono text-[12.5px]', r.enabled ? 'text-text-1' : 'text-text-3',
          r.retired ? '' : !r.enabled && 'line-through')}>
          {r.key}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-[16px] text-text-2">{r.what}</p>
        {r.here && <p className="mt-0.5 text-[11.5px] leading-[16px] text-text-3">Answered by {r.here}</p>}
        {said && <p className="mt-0.5 text-[11.5px] leading-[16px] text-text-3">{said}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        {busy && <Loader2 size={13} className="animate-spin text-text-3" />}
        {r.retired ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-text-3" data-event-retired={r.key}>
            <Archive size={13} /> Retired
          </span>
        ) : (
          <Switch checked={r.enabled} disabled={busy} onCheckedChange={(on) => onFlip(r, on)}
            aria-label={`${r.key}: ${r.enabled ? 'on' : 'off'}`} data-event-switch={r.key} />
        )}
      </div>
    </div>
  )
}
