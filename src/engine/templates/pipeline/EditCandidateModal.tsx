// Edit candidate details — ADMIN ONLY, by rule: an admin has to be able to edit these parameters on the hiring…
// Edits the drawer's DETAILS block: name, email, phone, source, applied date, city/state.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { ohioWall } from '@/lib/ohio'

const INPUT =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-text-2">{label}</span>
      {children}
    </label>
  )
}

export function EditCandidateModal({
  open,
  onOpenChange,
  rec,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rec: any
  onSaved: (patch: Record<string, any>) => void
}) {
  const fullName = String(rec?.name ?? '')
  const firstSpace = fullName.indexOf(' ')
  const [first, setFirst] = useState(firstSpace > 0 ? fullName.slice(0, firstSpace) : fullName)
  const [last, setLast] = useState(firstSpace > 0 ? fullName.slice(firstSpace + 1) : '')
  const [email, setEmail] = useState(String(rec?.email ?? ''))
  const [phone, setPhone] = useState(String(rec?.phone ?? ''))
  const [source, setSource] = useState(String(rec?.source ?? ''))
  const [applied, setApplied] = useState(() => {
    // The stored instant on OHIO's calendar — toISOString() is the UTC day, which turns an evening application into…
    const w = ohioWall(String(rec?.appliedAt ?? ''))
    if (!w) return ''
    return `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!first.trim()) return setError('First name cannot be empty.')
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError('That email does not look valid.')
    setError('')
    setBusy(true)
    try {
      await gasAction('candidateEdit', {
        candidate_id: String(rec.id),
        first_name: first.trim(),
        last_name: last.trim(),
        email: email.trim(),
        phone: phone.trim(),
        source: source.trim(),
        ...(applied ? { applied_at: new Date(`${applied}T12:00:00Z`).toISOString() } : {}),
      })
      const name = `${first.trim()} ${last.trim()}`.trim()
      onSaved({
        name,
        email: email.trim(),
        phone: phone.trim(),
        ...(source.trim() ? { source: source.trim() } : {}),
        ...(applied ? { appliedAt: new Date(`${applied}T12:00:00Z`).toISOString() } : {}),
      })
      toast({ type: 'success', title: 'Candidate updated' })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the changes.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="bg-surface sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">Edit candidate</DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5 text-text-3">
            Admin door for testing — contact and intake parameters only; the stage still moves
            through the gates.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <input className={INPUT} value={first} onChange={(e) => setFirst(e.target.value)} />
            </Field>
            <Field label="Last name">
              <input className={INPUT} value={last} onChange={(e) => setLast(e.target.value)} />
            </Field>
          </div>
          <Field label="Email">
            <input className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 330 …" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <input className={INPUT} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Direct / SMS / Indeed…" />
            </Field>
            <Field label="Applied">
              <input type="date" className={INPUT} value={applied} onChange={(e) => setApplied(e.target.value)} />
            </Field>
          </div>
          {error && (
            <p className="rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{error}</p>
          )}
        </div>
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
            onClick={() => void save()}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {busy && <Loader2 size={13} className="animate-spin" />} Save changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
