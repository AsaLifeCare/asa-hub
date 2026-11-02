// Manual onboarding — the second phase of the SECOND way through the process: someone struggled with the portal, a…
// Same care as the manual phone screen: whatever the portal already captured (a half-finished visit, documents on…
import { useState } from 'react'
import { Loader2, Mail } from 'lucide-react'
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

export function ManualOnboardingModal({
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
  // Carries what the SERVER did — `held` means the card stayed at Onboarding waiting on the signed packet, so the…
  onCompleted: (res?: { held?: boolean; stage?: string }) => void
}) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await gasAction<{ held?: boolean; stage?: string }>('onboardingManualComplete', {
        candidate_id: candidateId,
        notes: notes.trim(),
      })
      // An {accepted:true} ledger envelope carries no verdict.
      const accepted = (d: any) => d && typeof d === 'object' && d.accepted === true
      const held = accepted(res) ? true : res?.held === true
      toast({
        type: held ? 'warning' : 'success',
        title: 'Manual onboarding recorded',
        body: held
          ? `${candidateName} — every Onboarding step is OK, but the signed New Hire packet is not on file. The card waits here until it arrives.`
          : `${candidateName} — every Onboarding step is OK; moved to Hired.`,
      })
      onCompleted({ held, stage: res?.stage })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the manual onboarding.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manual onboarding — by email</DialogTitle>
          <DialogDescription>
            For when you or a colleague walked this new hire through the packet by email — that IS the
            onboarding. Anything the portal already captured stays on file as evidence, and every Onboarding
            step becomes OK. With the signed New Hire packet on file they move to Hired, the team is alerted,
            and after one day they become staff in Users. Without it the card waits here until the packet
            arrives — signed in Dropbox Sign, or attached by hand.
          </DialogDescription>
        </DialogHeader>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-2">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Where the paperwork lives, anything agreed…"
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
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Onboarding done — move to Hired
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
