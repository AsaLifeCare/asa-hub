// Resolve with a note — the durable record behind every status change, in the right panel.
// Excused and Covered cannot be saved empty: a year from now the note is the only evidence of WHY a missing punch…
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/shared/Badge'
import SidePanel from '@/components/shared/SidePanel'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import {
  ACTION_LABEL, dayLabel, NOTE_REQUIRED, TYPE_META,
  type ReconError, type ReconStatus,
} from './reconTypes'

export default function ResolveNotePanel({
  error,
  status,
  onClose,
  onResolved,
  onBusy,
}: {
  error: ReconError
  status: ReconStatus
  onClose: () => void
  onResolved: () => void
  /** told when a write starts and ends, so the page keeps this panel in place meanwhile */
  onBusy?: (busy: boolean) => void
}) {
  const required = NOTE_REQUIRED.has(status)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const field = useRef<HTMLTextAreaElement | null>(null)
  // a panel already gone when its answer lands (the page was left) closes nothing
  const alive = useRef(true)
  // the panel puts focus on its title when it opens; the note takes it right after, so typing starts at once
  useEffect(() => {
    alive.current = true
    const id = requestAnimationFrame(() => field.current?.focus())
    return () => { alive.current = false; cancelAnimationFrame(id) }
  }, [])
  // a write in flight keeps the panel open, so its answer is never lost
  const close = () => { if (!saving) onClose() }

  const submit = async () => {
    if (saving || (required && !note.trim())) return
    setSaving(true)
    onBusy?.(true)
    try {
      await gasAction('reconErrorResolve', { errorId: error.id, status, note: note.trim() })
      toast({
        type: 'success',
        // a resolved card's only action puts it back in the queue
        title: status === 'Open' ? 'Reopened' : `${ACTION_LABEL[status]} recorded`,
        body: note.trim() ? 'Saved with your note — your name is on it.' : 'Saved.',
      })
      onResolved()
      if (alive.current) onClose()
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : 'Nothing was written — try again.' })
    } finally {
      setSaving(false)
      onBusy?.(false)
    }
  }

  return (
    <SidePanel
      open
      onClose={close}
      label="Review"
      title={ACTION_LABEL[status]}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={close} disabled={saving}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving || (required && !note.trim())}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {status === 'Open' ? 'Reopen' : `Save ${ACTION_LABEL[status].toLowerCase()}`}
          </button>
        </div>
      }
    >
      <p className="mt-0.5 text-[12px] text-text-3">
        {error.employeeName || 'Unknown employee'} · {dayLabel(error.date)} · {error.location || 'unknown location'}
      </p>

      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={TYPE_META[error.type]?.label ?? error.type} tint={TYPE_META[error.type]?.tint ?? 'amber'} />
          {error.detail && <span className="text-[12px] text-text-3">{error.detail}</span>}
        </div>

        <div>
          <label htmlFor="recon-note" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3">
            Note {required ? '— required, it is the evidence' : '— optional'}
          </label>
          <textarea
            id="recon-note"
            ref={field}
            rows={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              status === 'Excused' ? 'Why is this absence excused? (who approved it, when)'
                : status === 'Covered' ? 'Who covered the shift, and how was it confirmed?'
                : 'Anything the next reviewer should know…'
            }
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13.5px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
          />
        </div>
      </div>
    </SidePanel>
  )
}
