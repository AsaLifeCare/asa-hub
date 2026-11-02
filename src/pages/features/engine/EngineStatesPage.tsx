// The materialized matrix.
// One row per person × requirement, written only when something changed — this screen reads…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { HeartPulse, RefreshCw, Search } from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { Badge } from '@/components/shared/Badge'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'

type StateRow = {
  person_key: string
  person_name: string
  req_id: string
  state: string
  expires: string
  days_left: string
  prev_state: string
  since: string
  computed_at: string
}

const STATE_TINT: Record<string, string> = {
  ok: 'mint', expiring: 'amber', expired: 'pink', missing: 'blue', na: 'lavender',
}
const STATE_ORDER = ['expired', 'expiring', 'missing', 'ok', 'na']

function ago(iso: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`
  return `${(ms / 86_400_000).toFixed(1)}d ago`
}

/** What requirementStatesList answered: 'own' = only the caller's rows, keyed by the roster name in `self`. */
type StatesAnswer = { rows?: StateRow[]; scope?: string; self?: string }

export default function EngineStatesPage() {
  const [rows, setRows] = useState<StateRow[]>([])
  const [loading, setLoading] = useState(true)
  /** null = every person's rows answered; a name = only that person's did */
  const [self, setSelf] = useState<string | null>(null)
  /** why the read did not land — the refusal's own sentence; '' when it did */
  const [failure, setFailure] = useState('')
  const [rebuilding, setRebuilding] = useState(false)
  const [stateFilter, setStateFilter] = useState('')
  const [personFilter, setPersonFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await gasAction<StatesAnswer>('requirementStatesList', { limit: 2000 })
      setRows(Array.isArray(res?.rows) ? res.rows : [])
      setSelf(res?.scope === 'own' ? String(res.self ?? '') : null)
      setFailure('')
    } catch (err) {
      // an unread or refused matrix is never drawn as an empty one
      setRows([])
      setSelf(null)
      setFailure((err instanceof Error && err.message) || 'The states could not be read — try again in a minute.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const rebuild = useCallback(async () => {
    setRebuilding(true)
    try {
      const res = await gasAction<{ computed?: number; updated?: number; inserted?: number; changes?: number }>(
        'requirementStatesRun', {}, { timeoutMs: 300_000 })
      toast({
        type: 'success',
        title: 'Rebuild complete',
        body: `${res.computed ?? 0} computed · ${res.updated ?? 0} updated · ${res.inserted ?? 0} inserted · ${res.changes ?? 0} changes`,
      })
      void load()
    } catch (err) {
      toast({ type: 'danger', title: 'Rebuild failed', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setRebuilding(false)
    }
  }, [load])

  const filtered = useMemo(() => {
    let out = rows
    if (stateFilter) out = out.filter((r) => r.state === stateFilter)
    const q = personFilter.trim().toLowerCase()
    if (q) out = out.filter((r) => `${r.person_name} ${r.req_id}`.toLowerCase().includes(q))
    return out
  }, [rows, stateFilter, personFilter])

  const counts = useMemo(() => {
    const by: Record<string, number> = {}
    for (const r of filtered) by[r.state] = (by[r.state] ?? 0) + 1
    return by
  }, [filtered])

  const lastComputed = useMemo(() => {
    let newest = ''
    for (const r of rows) if (r.computed_at > newest) newest = r.computed_at
    return newest
  }, [rows])

  return (
    <div className="w-full pb-10">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
        className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-bold text-text-1">States matrix</h1>
          <p className="text-[12px] text-text-3">
            {rows.length ? `${rows.length} rows on screen · last computed ${ago(lastComputed)}` : 'The matrix, materialized — written only when something changes.'}
          </p>
          {self !== null && (
            <p className="mt-1 text-[12px] text-text-2">
              These are your own states{self ? ` (${self})` : ''} — every other person&apos;s are the master&apos;s
              alone to see, so the counts below are yours, not the company&apos;s.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Reload
          </button>
          <button onClick={() => void rebuild()} disabled={rebuilding}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
            <HeartPulse size={13} className={rebuilding ? 'animate-pulse' : ''} />
            {rebuilding ? 'Rebuilding…' : 'Run rebuild'}
          </button>
        </div>
      </motion.div>

      {/* the state chips are the summary — computed from the rows on screen */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setStateFilter('')}
          className={cn('rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
            !stateFilter ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-text-3 hover:text-text-1')}>
          All ({filtered.length})
        </button>
        {STATE_ORDER.map((s) => (
          <button key={s} onClick={() => setStateFilter(stateFilter === s ? '' : s)}
            className={cn('rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
              stateFilter === s ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-text-3 hover:text-text-1')}>
            {s} ({counts[s] ?? 0})
          </button>
        ))}
        <span className="ml-auto flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3">
          <Search size={13} className="text-text-3" />
          <input value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}
            placeholder="Person or requirement…"
            className="w-44 bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3" />
        </span>
      </div>

      <Card padded={false}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12px] text-text-3">
            <RefreshCw size={13} className="animate-spin" /> Loading the matrix…
          </div>
        ) : failure ? (
          <EmptyState
            title="The states are not shown"
            body={`— ${failure}`}
            action={{ label: 'Try again', onClick: () => void load() }}
          />
        ) : filtered.length === 0 && self !== null && !rows.length ? (
          <EmptyState
            title="No state of yours is materialized yet"
            body="The engine has written no requirement state under your roster name. Every other person's states are the master's alone to see."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing materialized yet"
            body="Run the first rebuild — the matrix fills with one row per person × requirement."
            action={{ label: 'Run rebuild', onClick: () => void rebuild() }}
          />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <th className="px-3 py-2.5">Person</th>
                  <th className="px-3 py-2.5">Requirement</th>
                  <th className="px-3 py-2.5">State</th>
                  <th className="px-3 py-2.5">Expires</th>
                  <th className="px-3 py-2.5">Days left</th>
                  <th className="px-3 py-2.5">Since</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((r) => (
                  <tr key={`${r.person_key}|${r.req_id}`} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                    <td className="px-3 py-2 text-[13px] font-medium text-text-1">{r.person_name || r.person_key}</td>
                    <td className="px-3 py-2 text-[12.5px] text-text-2">{r.req_id}</td>
                    <td className="px-3 py-2"><Badge label={r.state} tint={(STATE_TINT[r.state] ?? 'blue') as never} /></td>
                    <td className="px-3 py-2 text-[12.5px] text-text-2">{r.expires || '—'}</td>
                    <td className="px-3 py-2 text-[12.5px] text-text-2">{r.days_left !== '' ? r.days_left : '—'}</td>
                    <td className="px-3 py-2 text-[11.5px] text-text-3">{ago(r.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <p className="border-t border-border px-3 py-2 text-[11px] text-text-3">
                Showing the first 500 of {filtered.length} — narrow with the filters.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
