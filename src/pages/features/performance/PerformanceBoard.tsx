// Staff Performance — the board.
// the old platform's version hardcodes its metrics; ours is an app, so the metrics are rows the company owns…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Pencil, Plus, Settings2, Star } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import { useCan } from '@/auth/permissions'
import { gasAction } from '@/features/hiring/shared'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { MetricEditorModal, type PerfMetric } from './MetricEditorModal'
import { EntryModal } from './EntryModal'

export type PerfCell = {
  metric_id: string
  label: string
  category: string
  unit: string
  target: number
  direction: 'higher' | 'lower'
  weight: number
  value: number | null
  note: string
  attainment: number | null
  status: 'on-target' | 'near' | 'below' | 'missing'
}

export type PerfPerson = {
  person_id: string
  person_name: string
  score: number | null
  coverage: number
  measured: number
  metric_count: number
  cells: PerfCell[]
}

type Board = { period: string; metrics: PerfMetric[]; people: PerfPerson[] }

const CELL_STYLE: Record<PerfCell['status'], string> = {
  'on-target': 'bg-tint-mint text-tint-fg-mint',
  near: 'bg-tint-amber text-tint-fg-amber',
  below: 'bg-tint-pink text-tint-fg-pink',
  missing: 'bg-surface-2 text-text-3',
}

/** Previous / next month keys around a "yyyy-MM" string. */
function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return period
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default function PerformanceBoard() {
  const live = useApiConfigStore((s) => s.driver) === 'apps-script'
  const canEdit = useCan('people.edit') || useCan('hiring.edit')
  const [board, setBoard] = useState<Board | null>(null)
  const [period, setPeriod] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingMetric, setEditingMetric] = useState<PerfMetric | null | 'new'>(null)
  const [entryFor, setEntryFor] = useState<{ person: PerfPerson; cell: PerfCell } | null>(null)
  const [showMetrics, setShowMetrics] = useState(false)

  const load = useCallback(
    async (p?: string) => {
      if (!live) return
      setLoading(true)
      try {
        const res = await gasAction<Board>('perfBoard', p ? { period: p } : {})
        setBoard(res)
        setPeriod(res.period)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load performance data.')
      } finally {
        setLoading(false)
      }
    },
    [live],
  )

  useEffect(() => {
    void load()
  }, [load])

  const metrics = board?.metrics ?? []
  const people = board?.people ?? []
  const average = useMemo(() => {
    const scored = people.filter((p) => p.score !== null)
    if (!scored.length) return null
    return Math.round(scored.reduce((n, p) => n + (p.score ?? 0), 0) / scored.length)
  }, [people])

  if (!live) {
    return (
      <Card>
        <CardHeader title="Staff Performance" sub="Connect the Hub backend to score your team." />
      </Card>
    )
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Staff Performance"
        subtitle={
          board
            ? `${people.length} people · ${metrics.length} metrics · ${period}${average !== null ? ` · team average ${average}` : ''}`
            : 'Loading…'
        }
        actions={
          <>
            <span className="flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => void load(shiftPeriod(period, -1))}
                className="h-9 px-3 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
              >
                ←
              </button>
              <span className="grid h-9 min-w-[92px] place-items-center bg-surface px-2 font-mono text-[13px] text-text-1">
                {period || '—'}
              </span>
              <button
                onClick={() => void load(shiftPeriod(period, 1))}
                className="h-9 px-3 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
              >
                →
              </button>
            </span>
            <button
              onClick={() => setShowMetrics((s) => !s)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <Settings2 size={14} className="text-text-3" /> Metrics
            </button>
            {canEdit && (
              <button
                onClick={() => setEditingMetric('new')}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-all hover:bg-primary-hover active:scale-[0.98]"
              >
                <Plus size={15} /> New metric
              </button>
            )}
          </>
        }
      />

      {error && (
        <p className="mb-3 rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
      )}

      {showMetrics && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          className="mb-4"
        >
          <Card padded={false}>
            <div className="p-4 pb-2">
              <CardHeader
                title="Metric definitions"
                sub="What the team is measured on — yours to change, not the developer's."
              />
            </div>
            <ul className="divide-y divide-border border-t border-border">
              {metrics.map((m) => (
                <li key={m.metric_id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-text-1">{m.label}</span>
                    <span className="block text-[12px] text-text-3">
                      {m.category} · target {m.target}
                      {m.unit} · {m.direction === 'lower' ? 'lower is better' : 'higher is better'} · weight {m.weight} ·{' '}
                      {m.period}
                    </span>
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => setEditingMetric(m)}
                      className="grid h-8 w-8 place-items-center rounded-md border border-border text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </motion.div>
      )}

      {loading && !board ? (
        <Card>
          <span className="flex items-center gap-2 text-[13px] text-text-2">
            <Loader2 size={14} className="animate-spin" /> Loading the board…
          </span>
        </Card>
      ) : people.length === 0 ? (
        <Card>
          <EmptyState
            title="No numbers filed for this period"
            body="Record a metric for someone and their card appears here. Nothing is inferred — an unfiled metric stays unfiled."
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {people.map((p) => (
            <Card key={p.person_id} padded={false}>
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                <span className="min-w-0 flex-1">
                  <DragPerson name={p.person_name} id={p.person_id} className="block">
                    <span className="block text-[14px] font-bold text-text-1">{p.person_name}</span>
                  </DragPerson>
                  <span className="block text-[12px] text-text-3">
                    {p.measured} of {p.metric_count} metrics filed · {p.coverage}% coverage
                  </span>
                </span>
                <span
                  className={cn(
                    'grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-bold',
                    p.score === null
                      ? 'bg-surface-2 text-text-3'
                      : p.score >= 100
                        ? 'bg-tint-mint text-tint-fg-mint'
                        : p.score >= 85
                          ? 'bg-tint-amber text-tint-fg-amber'
                          : 'bg-tint-pink text-tint-fg-pink',
                  )}
                  title="Weighted score across the metrics that have a value"
                >
                  {p.score === null ? '—' : p.score}
                </span>
              </div>
              <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {p.cells.map((c) => (
                  <button
                    key={c.metric_id}
                    onClick={() => canEdit && setEntryFor({ person: p, cell: c })}
                    disabled={!canEdit}
                    className="flex items-center gap-2.5 bg-surface px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:cursor-default"
                  >
                    <span
                      className={cn(
                        'grid h-9 w-11 shrink-0 place-items-center rounded-md text-[12.5px] font-bold',
                        CELL_STYLE[c.status],
                      )}
                    >
                      {c.value === null ? '—' : `${c.value}${c.unit === '%' ? '%' : ''}`}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="clamp-1 block text-[12.5px] font-semibold text-text-1">{c.label}</span>
                      <span className="block text-[11px] text-text-3">
                        {c.attainment === null
                          ? 'not filed'
                          : `${c.attainment}% of target ${c.target}${c.unit === '%' ? '%' : ''}`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editingMetric && (
        <MetricEditorModal
          metric={editingMetric === 'new' ? null : editingMetric}
          onClose={() => setEditingMetric(null)}
          onSaved={() => {
            setEditingMetric(null)
            void load(period)
          }}
        />
      )}

      {entryFor && (
        <EntryModal
          person={entryFor.person}
          cell={entryFor.cell}
          period={period}
          onClose={() => setEntryFor(null)}
          onSaved={() => {
            setEntryFor(null)
            toast({ type: 'success', title: 'Recorded' })
            void load(period)
          }}
        />
      )}
    </div>
  )
}

export { Star }
