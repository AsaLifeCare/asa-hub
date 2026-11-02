// Manual phone screen — the SECOND way through the process: someone struggled with the automated line, a person…
// The confirm spells out the care that is owed here: whatever the automated attendant already captured (a half…
import { useState } from 'react'
import { Loader2, PhoneCall } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'

export function ManualScreenModal({
  open,
  onOpenChange,
  candidateId,
  candidateName,
  onCompleted,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  candidateId: string
  candidateName: string
  onCompleted: () => void
}) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await gasAction('screenManualComplete', { candidate_id: candidateId, notes: notes.trim() })
      toast({
        type: 'success',
        title: 'Manual phone screen recorded',
        body: `${candidateName} — the screen is complete. Advance or decline to move them on.`,
      })
      onCompleted()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the manual screen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manual phone screen</DialogTitle>
          <DialogDescription>
            You (or a colleague) called {candidateName} and screened them by voice — the human call IS the phone
            screen. Anything the automated line already captured stays on file as evidence, and every Phone
            Screen checkpoint becomes OK. This records the call, not the verdict — they stay here until you
            advance or decline them.
          </DialogDescription>
        </DialogHeader>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-2">Notes from the call (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="How it went, what was agreed…"
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
          />
        </label>
        {error && (
          <p className="rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{error}</p>
        )}
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <PhoneCall size={13} />} Record the screen
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
