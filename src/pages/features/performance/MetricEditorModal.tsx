// Metric editor — the whole point of the app being ours.
// Every field here is a decision the old platform made in code: what counts, which direction is good, what the…
import { useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

export type PerfMetric = {
  metric_id: string
  label: string
  category: string
  unit: string
  direction: 'higher' | 'lower'
  target: number
  weight: number
  period: string
  source: string
  notes?: string
}

const PERIODS = ['monthly', 'quarterly', 'weekly'] as const
const UNITS = ['%', 'count', 'score', 'hours', 'days'] as const

const input =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary'

export function MetricEditorModal({
  metric,
  onClose,
  onSaved,
}: {
  metric: PerfMetric | null
  onClose: () => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState(metric?.label ?? '')
  const [category, setCategory] = useState(metric?.category ?? 'General')
  const [unit, setUnit] = useState(metric?.unit ?? '%')
  const [direction, setDirection] = useState<'higher' | 'lower'>(metric?.direction ?? 'higher')
  const [target, setTarget] = useState(String(metric?.target ?? ''))
  const [weight, setWeight] = useState(String(metric?.weight ?? 1))
  const [period, setPeriod] = useState(metric?.period ?? 'monthly')
  const [notes, setNotes] = useState(metric?.notes ?? '')
  const [active, setActive] = useState(true)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!label.trim() || busy) return
    setBusy(true)
    try {
      await gasAction('perfMetricUpsert', {
        metric_id: metric?.metric_id,
        label: label.trim(),
        category: category.trim() || 'General',
        unit,
        direction,
        target: Number(target) || 0,
        weight: Number(weight) || 1,
        period,
        notes: notes.trim(),
        active: active ? 'yes' : 'no',
      })
      toast({ type: 'success', title: metric ? 'Metric updated' : 'Metric created', body: label.trim() })
      onSaved()
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not save the metric',
        body: err instanceof Error ? err.message : 'Try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={metric ? 'Edit metric' : 'New metric'}
        className="scroll-thin max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-xl bg-surface p-5 shadow-3"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[17px] font-bold text-text-1">{metric ? 'Edit metric' : 'New metric'}</h2>
            <p className="mt-0.5 text-[12.5px] text-text-2">
              {metric ? metric.metric_id : 'The id is generated from the name.'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            <X size={15} />
          </button>
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">
          Name <span className="text-danger">*</span>
        </label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus placeholder="e.g. Med pass accuracy" className={cn(input, 'mb-3')} />

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Category</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Reliability, Quality…" className={input} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Unit</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={input}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">Which way is good?</label>
        <div className="mb-3 flex gap-2">
          {(
            [
              { id: 'higher', label: 'Higher is better', hint: 'attendance, documentation' },
              { id: 'lower', label: 'Lower is better', hint: 'call-offs, late reports' },
            ] as const
          ).map((d) => (
            <button
              key={d.id}
              onClick={() => setDirection(d.id)}
              aria-pressed={direction === d.id}
              className={cn(
                'flex-1 rounded-md border px-3 py-2 text-left transition-colors',
                direction === d.id ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-2',
              )}
            >
              <span className="block text-[12.5px] font-semibold text-text-1">{d.label}</span>
              <span className="block text-[11px] text-text-3">{d.hint}</span>
            </button>
          ))}
        </div>

        <div className="mb-3 grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Target</label>
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className={input} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Weight</label>
            <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" className={input} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className={input}>
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">What it means</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="How this is measured, so the number means the same thing to everyone."
          className={cn(input, 'mb-3 h-auto py-2')}
        />

        <label className="mb-4 flex items-center gap-2 text-[12.5px] text-text-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Counts towards the score
        </label>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-9 flex-1 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!label.trim() || busy}
            className="h-9 flex-1 rounded-md bg-primary text-[13px] font-semibold text-on-primary transition-all hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Saving…' : metric ? 'Save metric' : 'Create metric'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
