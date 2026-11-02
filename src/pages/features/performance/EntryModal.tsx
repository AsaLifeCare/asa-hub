// File one number for one person, in one period.
// The note field is not decoration: a metric that moved for a reason ("covered two houses after a resignation") is…
import { useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { PerfCell, PerfPerson } from './PerformanceBoard'

const input =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary'

export function EntryModal({
  person,
  cell,
  period,
  onClose,
  onSaved,
}: {
  person: PerfPerson
  cell: PerfCell
  period: string
  onClose: () => void
  onSaved: () => void
}) {
  const [value, setValue] = useState(cell.value === null ? '' : String(cell.value))
  const [note, setNote] = useState(cell.note ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (value.trim() === '' || busy) return
    setBusy(true)
    try {
      await gasAction('perfEntrySave', {
        person_id: person.person_id,
        person_name: person.person_name,
        metric_id: cell.metric_id,
        period,
        value: Number(value),
        note: note.trim(),
      })
      onSaved()
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not record it',
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
        aria-label="Record a metric"
        className="w-full max-w-[420px] rounded-xl bg-surface p-5 shadow-3"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[16px] font-bold text-text-1">{cell.label}</h2>
            <p className="mt-0.5 text-[12.5px] text-text-2">
              <DragPerson name={person.person_name} id={person.person_id}>
                {person.person_name}
              </DragPerson>{' '}
              · {period} · target {cell.target}
              {cell.unit === '%' ? '%' : ` ${cell.unit}`} ({cell.direction === 'lower' ? 'lower is better' : 'higher is better'})
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
          Value <span className="text-danger">*</span>
        </label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          inputMode="decimal"
          autoFocus
          placeholder={cell.unit === '%' ? '0–100' : 'a number'}
          className={cn(input, 'mb-3')}
        />

        <label className="mb-1 block text-[12px] font-medium text-text-2">Note</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Anything that explains the number — covering another house, out sick, first month."
          className={cn(input, 'mb-4 h-auto py-2')}
        />

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-9 flex-1 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={value.trim() === '' || busy}
            className="h-9 flex-1 rounded-md bg-primary text-[13px] font-semibold text-on-primary transition-all hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Record'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
