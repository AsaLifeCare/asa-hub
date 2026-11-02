// The events trail.
// The platform's immutable record — every action hubSysLog_ logs lands here too, and every requirement state change.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'

type Ev = {
  event_id: string
  type: string
  actor: string
  subject_type: string
  subject_key: string
  subject_name: string
  payload: Record<string, unknown>
  source: string
  at: string
  tenant: string
}

const TYPE_TINT: Record<string, string> = {
  requirement_state_changed: 'text-emerald-600 bg-emerald-500/10',
}

function ago(iso: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`
  return `${(ms / 86_400_000).toFixed(1)}d ago`
}

function EventRow({ ev }: { ev: Ev }) {
  const [open, setOpen] = useState(false)
  const payloadText = useMemo(() => JSON.stringify(ev.payload, null, 2), [ev.payload])
  const hasPayload = payloadText !== '{}'
  return (
    <li className="border-b border-border/50 last:border-0">
      <button
        onClick={() => hasPayload && setOpen((o) => !o)}
        className={cn('flex w-full items-start gap-2.5 px-3 py-2.5 text-left', hasPayload ? 'hover:bg-surface-2/50' : 'cursor-default')}
      >
        <span className="mt-0.5 shrink-0 text-text-3">
          {hasPayload ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="inline-block w-[13px]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', TYPE_TINT[ev.type] ?? 'bg-surface-2 text-text-2')}>
              {ev.type}
            </span>
            <span className="text-[12.5px] font-medium text-text-1">{ev.subject_name || ev.subject_key || '—'}</span>
            <span className="text-[11px] text-text-3">{ago(ev.at)}</span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-text-3">
            {ev.actor || 'system'}{ev.source ? ` · via ${ev.source}` : ''}{ev.tenant ? ` · ${ev.tenant}` : ''}
          </p>
        </div>
      </button>
      {open && hasPayload && (
        <pre className="mx-3 mb-2.5 max-h-40 overflow-auto rounded-md bg-surface-2 p-2.5 text-[11px] leading-4 text-text-2">
          {payloadText}
        </pre>
      )}
    </li>
  )
}

export default function EngineEventsPage() {
  const [events, setEvents] = useState<Ev[]>([])
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [moreLoading, setMoreLoading] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')

  const load = useCallback(async (after?: string) => {
    if (after) setMoreLoading(true)
    else setLoading(true)
    try {
      const res = await gasAction<{ events?: Ev[]; next_cursor?: string }>('eventsList', {
        limit: 50,
        cursor: after || undefined,
        type: typeFilter || undefined,
        subject_key: subjectFilter || undefined,
      })
      const fresh = res.events ?? []
      setEvents((prev) => after ? [...prev, ...fresh] : fresh)
      setCursor(res.next_cursor ?? '')
    } catch (err) {
      toast({ type: 'danger', title: 'Could not load events', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
      setMoreLoading(false)
    }
  }, [typeFilter, subjectFilter])

  useEffect(() => { void load() }, [load])

  return (
    <div className="w-full pb-10">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
        className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-bold text-text-1">Events trail</h1>
          <p className="text-[12px] text-text-3">
            {events.length ? `${events.length} events loaded — append-only, what you see is what the auditor sees.` : 'The platform’s immutable record.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Reload
          </button>
        </div>
      </motion.div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3">
          <Search size={13} className="text-text-3" />
          <input value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            placeholder="Type (e.g. requirement_state_changed)"
            className="w-56 bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3" />
        </span>
        <span className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3">
          <Search size={13} className="text-text-3" />
          <input value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}
            placeholder="Subject key (a person, an id…)"
            className="w-52 bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3" />
        </span>
      </div>

      <Card padded={false}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12px] text-text-3">
            <RefreshCw size={13} className="animate-spin" /> Reading the trail…
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            title="No events yet"
            body="The trail starts writing the moment the platform logs an action — every write, every state change."
          />
        ) : (
          <>
            <ul>{events.map((ev) => <EventRow key={ev.event_id} ev={ev} />)}</ul>
            {cursor && (
              <div className="border-t border-border p-3 text-center">
                <button onClick={() => void load(cursor)} disabled={moreLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
                  {moreLoading ? <RefreshCw size={12} className="animate-spin" /> : null} Load older events
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
