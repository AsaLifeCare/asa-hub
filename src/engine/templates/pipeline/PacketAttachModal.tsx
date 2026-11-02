// Attach the signed New Hire packet by hand — in the same balloon, the new hire packet attached and entered…
// This is the lane that makes the whole feature safe rather than cruel.
import { useState } from 'react'
import { FileCheck2, Loader2 } from 'lucide-react'
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

export function PacketAttachModal({
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
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await gasAction<{ released?: boolean }>('packetWaive', {
        candidate_id: candidateId,
        note: note.trim(),
      })
      toast({
        type: 'success',
        title: 'New Hire packet recorded',
        body: res?.released
          ? `${candidateName} was waiting on this — the packet is on file and they have moved to Hired.`
          : `${candidateName} — the packet is on file.`,
      })
      onCompleted()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the packet.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Hire packet on file</DialogTitle>
          <DialogDescription>
            For when the signed packet is in your hands but no Dropbox Sign envelope was found — normal for
            anyone hired before it was in use, or whose envelope was renamed. Say where the signed copy is;
            your name and the date are recorded with it. If this person finished onboarding and is waiting on
            this document, recording it here releases them to Hired straight away.
          </DialogDescription>
        </DialogHeader>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-2">Where is the signed packet?</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Signed on paper, filed in the office cabinet — or a link to the document…"
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
          />
        </label>
        {error && (
          <p className="rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">
            {error}
          </p>
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
            disabled={busy || note.trim().length < 3}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-fg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <FileCheck2 size={13} />} Record the packet
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
