// ADD SOMEBODY TO THE TALENT PIPELINE — the entry door, moved houses.
// The entry that used to live in another app happens in this one now, and lands in the Talent Pipeline of this…
import { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { invalidate } from '@/lib/apiCache'
import { toast } from '@/stores/useToastStore'
import { inputCls, btnCls } from './flow/shared'

export default function AddToPipelineModal({ onClose, onAdded }: {
  onClose: () => void
  onAdded: () => void
}) {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [resume, setResume] = useState('')
  const [busy, setBusy] = useState(false)

  // The same three the server demands — asked here only so the button can be honest about being unpressable, never…
  const ready = !!first.trim() && !!last.trim() && phone.replace(/\D/g, '').length >= 7

  const save = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const d = await gasAction<{ name: string }>('talentPipelineAdd', {
        first_name: first.trim(), last_name: last.trim(), phone: phone.trim(),
        email: email.trim(), city: city.trim(), state: state.trim(),
        resume_link: resume.trim(),
      })
      toast({
        type: 'success',
        title: `${d.name} is in the Talent Pipeline`,
        body: 'They are in the store, not in the process — they come in from Actions when their record earns it.',
      })
      // the roster's own read is cached like every other list
      invalidate('candidates')
      onAdded()
      onClose()
    } catch (e) {
      // A 409 here is the duplicate door answering, and its sentence names the person it found — worth showing…
      toast({ type: 'danger', title: 'Not added', body: e instanceof Error ? e.message : 'Try again.' })
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-2" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-text-1">Add to the Talent Pipeline</h2>
          <button onClick={onClose} className="text-text-3 hover:text-text-1"><X size={16} /></button>
        </div>
        <p className="mb-3 text-[12px] leading-[1.55] text-text-3">
          This puts somebody in the pipeline — the store we keep people in. It does not start a
          hiring process: that happens from Actions, when the record carries what it needs.
        </p>
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name *" className={inputCls} autoFocus />
            <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name *" className={inputCls} />
          </div>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone *" className={inputCls} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail — wanted, not required" className={inputCls} />
          <div className="grid grid-cols-2 gap-2.5">
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className={inputCls} />
            <input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" className={inputCls} />
          </div>
          <input value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Resume link (optional)" className={inputCls} />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className={btnCls}>Cancel</button>
          <button
            onClick={() => void save()}
            disabled={!ready || busy}
            title={ready ? undefined : 'A first name, a last name and a phone of at least seven digits'}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-[13px] font-semibold text-on-primary disabled:opacity-40"
          >
            <UserPlus size={14} /> {busy ? 'Adding…' : 'Add to pipeline'}
          </button>
        </div>
      </div>
    </div>
  )
}
