// "New from resume" — resume-FIRST intake: drop the file, the candidate opens itself in New.
// Flow (live driver only — the header button is hidden on mock): 1.
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCan } from '@/auth'
import DragPerson from '@/components/shared/DragPerson'
import { toast } from '@/stores/useToastStore'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { noteWrite } from '@/lib/snapshotClient'
import {
  FileDropZone,
  SelectedFileCard,
  MAX_UPLOAD_BYTES,
  extOf,
  fileToBase64,
  gasAction,
  humanSize,
  inferMime,
  inputCls,
} from './shared'
import { ohioToday } from '@/lib/ohio'

const ACCEPT_EXT = new Set(['pdf', 'doc', 'docx'])

type Parsed = {
  first_name: string
  last_name: string
  phone: string
  email: string
  city: string
  state: string
}

type ParseResult = {
  resume_link: string
  filename: string
  extracted: boolean
  complete: boolean
  parsed: Parsed
}

type Phase = 'pick' | 'parsing' | 'confirm' | 'committing'

/** Optimistic board record — resume already on file. */
function buildRecord(fields: Parsed, resumeLink: string, candidateId: string, candidateName: string) {
  return {
    id: candidateId,
    name: candidateName,
    role: 'Direct Support Professional',
    avatar: 'icon:user',
    stage: 'new',
    source: 'Direct',
    daysInStage: 0,
    score: null,
    appliedAt: new Date().toISOString(),
    email: fields.email,
    phone: fields.phone,
    city: fields.city,
    state: fields.state,
    owner: '',
    ownerAvatar: '',
    resumeLink,
    resumeFileLabel: 'Open resume',
    summary: '',
    summaryTimeline: [
      { time: ohioToday(), text: 'Applied via resume upload', tint: 'blue' },
    ],
    checklist: [
      { id: 'resume', label: 'Resume', owner: 'Candidate', stage: 'new', upload: true, status: 'done' },
      { id: 'cjis', label: 'CJIS / Background result', owner: 'HR', stage: 'new', upload: true, status: 'missing' },
      { id: 'resume-decision', label: 'Resume decision', owner: 'Recruiter', stage: 'new', status: 'pending' },
    ],
  }
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string
  required?: boolean
  // A word in the pill the resume field already uses ('optional') — for the fields we want but will not demand, so…
  hint?: string
  error?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12px] font-medium text-text-2">
        {label}
        {required && <span className="text-danger"> *</span>}
        {hint && (
          <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-text-3">
            {hint}
          </span>
        )}
      </span>
      <span className={cn('block', error && '[&_input]:border-danger')}>{children}</span>
    </label>
  )
}

export default function ResumeIntakeModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (rec: any) => void
}) {
  const canEdit = useCan('hiring.edit')

  const [phase, setPhase] = useState<Phase>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [parse, setParse] = useState<ParseResult | null>(null)
  const [fields, setFields] = useState<Parsed>({ first_name: '', last_name: '', phone: '', email: '', city: '', state: '' })
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [apiError, setApiError] = useState<string | null>(null)
  // Duplicate match — the recruiter chooses: attach to them, or edit + create.
  const [match, setMatch] = useState<{ candidate_id: string; candidate_name: string } | null>(null)

  const reset = () => {
    setPhase('pick')
    setFile(null)
    setParse(null)
    setFields({ first_name: '', last_name: '', phone: '', email: '', city: '', state: '' })
    setErrors({})
    setApiError(null)
    setMatch(null)
  }

  const close = (o: boolean) => {
    if (!o) reset()
    onOpenChange(o)
  }

  const commit = async (result: ParseResult, f: Parsed) => {
    setPhase('committing')
    setApiError(null)
    setMatch(null)
    try {
      const data = await gasAction<{ candidate_id: string; candidate_name: string; matched_existing: boolean }>(
        'resumeIntakeCommit',
        { ...f, resume_link: result.resume_link, filename: result.filename },
      )
      if (data.matched_existing) {
        // Never absorb silently — surface the match, the recruiter chooses.
        setMatch(data)
        setPhase('confirm')
        return
      }
      toast({
        type: 'success',
        title: `${data.candidate_name} added to New`,
        body: 'Resume on file — CJIS and the decision are next.',
      })
      onCreated(buildRecord(f, result.resume_link, data.candidate_id, data.candidate_name))
      // Tell the builder NOW — a slice built seconds earlier otherwise hides the new card on the next refresh until…
      noteWrite('candidates')
      close(false)
    } catch (err) {
      // Fall back to the editable confirm so nothing typed/parsed is lost.
      setPhase('confirm')
      setApiError(err instanceof Error ? err.message : 'Could not create the candidate. Please try again.')
    }
  }

  const attachToMatch = async () => {
    if (!match || !parse) return
    setPhase('committing')
    try {
      await gasAction('resumeAttach', { candidate_id: match.candidate_id, resume_link: parse.resume_link })
      toast({
        type: 'info',
        title: 'Resume attached',
        body: `Filed on ${match.candidate_name} — no duplicate card created.`,
      })
      close(false)
    } catch (err) {
      setPhase('confirm')
      setApiError(err instanceof Error ? err.message : 'Could not attach the resume. Please try again.')
    }
  }

  const onFile = async (f: File) => {
    if (!canEdit) {
      toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin' })
      return
    }
    if (!ACCEPT_EXT.has(extOf(f.name))) {
      setApiError('PDF, DOC or DOCX only.')
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setApiError(`File is ${humanSize(f.size)} — the limit is 15MB.`)
      return
    }
    setFile(f)
    setApiError(null)
    setPhase('parsing')
    try {
      // 1. Fast store — seconds, safe from Google's long-POST connection drops.
      const base64 = await fileToBase64(f)
      const stored = await gasAction<{ file_id: string; resume_link: string; filename: string }>('resumeStore', {
        filename: f.name,
        mime_type: inferMime(f),
        base64,
      })
      // 2.
      type ExtractResult = { working?: boolean; extracted: boolean; complete: boolean; parsed: Parsed }
      const deadline = Date.now() + 3 * 60_000
      let extract: ExtractResult | null = null
      while (Date.now() < deadline) {
        try {
          const r = await gasAction<ExtractResult>('resumeExtract', { file_id: stored.file_id }, { timeoutMs: 25_000 })
          if (r && !r.working) {
            extract = r
            break
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : ''
          if (msg !== 'timeout' && !msg.startsWith('Network error')) throw err
          // transport hiccup while the server keeps working — just poll again
        }
        await new Promise((r) => setTimeout(r, 5000))
      }
      if (!extract) throw new Error('Reading took too long — the file is stored; try again in a minute.')
      const result: ParseResult = {
        resume_link: stored.resume_link,
        filename: stored.filename,
        extracted: extract.extracted,
        complete: extract.complete,
        parsed: extract.parsed,
      }
      setParse(result)
      setFields(result.parsed)
      if (result.complete) {
        await commit(result, result.parsed)
      } else {
        setPhase('confirm')
      }
    } catch (err) {
      setPhase('pick')
      setFile(null)
      setApiError(err instanceof Error ? err.message : 'Could not read the resume. Please try again.')
    }
  }

  const submitConfirm = async () => {
    if (!parse) return
    const missing: Record<string, boolean> = {}
    if (!fields.first_name.trim()) missing.first_name = true
    if (!fields.last_name.trim()) missing.last_name = true
    if (!fields.phone.trim() || fields.phone.replace(/\D/g, '').length < 7) missing.phone = true
    // The SHAPE is still checked, the FIELD is no longer demanded — and here the value on screen is often a…
    const typedEmail = fields.email.trim()
    if (typedEmail && !/^\S+@\S+\.\S+$/.test(typedEmail)) missing.email = true
    if (Object.keys(missing).length) {
      setErrors(missing)
      const incomplete = missing.first_name || missing.last_name || missing.phone
      setApiError(
        incomplete && missing.email
          ? 'Fill the required fields — first and last name, and a phone with at least 7 digits. The email read from the resume is not a valid address.'
          : incomplete
            ? 'Fill the required fields — first and last name, and a phone with at least 7 digits.'
            : 'That email is not a valid address — correct it, or leave it empty.',
      )
      return
    }
    await commit(parse, {
      first_name: fields.first_name.trim(),
      last_name: fields.last_name.trim(),
      phone: fields.phone.trim(),
      email: fields.email.trim().toLowerCase(),
      city: fields.city.trim(),
      state: fields.state.trim(),
    })
  }

  const set = (k: keyof Parsed, v: string) => {
    setFields((s) => ({ ...s, [k]: v }))
    setErrors((s) => ({ ...s, [k]: false }))
    setApiError(null)
  }

  const busy = phase === 'parsing' || phase === 'committing'

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-surface sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-[18px] font-bold text-text-1">New from resume</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Drop a resume — it files into the talent drive, the identity is read from the document, and the
            candidate lands in New by itself.
          </DialogDescription>
        </DialogHeader>

        {phase === 'pick' && (
          <FileDropZone accept=".pdf,.doc,.docx" hint="PDF, DOC or DOCX · up to 15MB" onFile={onFile} />
        )}

        {file && phase !== 'pick' && (
          <SelectedFileCard file={file} disabled={busy} onRemove={reset} />
        )}

        {busy && (
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2/60 px-3 py-3 text-[13px] text-text-2">
            <AppIcon name="loader-circle" size={16} className="animate-spin text-primary" />
            {phase === 'parsing'
              ? 'Reading the resume… scanned PDFs can take up to a minute.'
              : 'Creating the candidate…'}
          </div>
        )}

        {phase === 'confirm' && (
          <>
            {match ? (
              <p className="rounded-md bg-tint-blue px-3 py-2 text-[12px] font-medium text-tint-fg-blue">
                This matches{' '}
                <DragPerson name={match.candidate_name} id={match.candidate_id}>
                  <b>{match.candidate_name}</b>
                </DragPerson>{' '}
                (same phone or email). Attach the resume to them — or edit the identity below and create a new
                candidate.
              </p>
            ) : (
              <p className="rounded-md bg-tint-amber px-3 py-2 text-[12px] font-medium text-tint-fg-amber">
                {parse?.extracted
                  ? 'We read what we could — confirm the missing fields before the candidate enters New.'
                  : 'The text could not be extracted from this file — fill the identity to continue.'}
              </p>
            )}
            <div className="grid gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name" required error={errors.first_name}>
                  <input value={fields.first_name} onChange={(e) => set('first_name', e.target.value)} className={inputCls} />
                </Field>
                <Field label="Last name" required error={errors.last_name}>
                  <input value={fields.last_name} onChange={(e) => set('last_name', e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Phone" required error={errors.phone}>
                  <input type="tel" value={fields.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} />
                </Field>
                <Field label="Email" hint="recommended" error={errors.email}>
                  <input type="email" value={fields.email} onChange={(e) => set('email', e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                <Field label="City">
                  <input value={fields.city} onChange={(e) => set('city', e.target.value)} className={inputCls} />
                </Field>
                <Field label="State">
                  <input value={fields.state} onChange={(e) => set('state', e.target.value)} className={inputCls} />
                </Field>
              </div>
            </div>
          </>
        )}

        {apiError && (
          <p role="alert" className="flex items-start gap-1.5 rounded-md bg-tint-pink px-3 py-2 text-[12px] font-medium text-tint-fg-pink">
            <AppIcon name="circle-alert" size={14} className="mt-[1px] shrink-0" />
            {apiError}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => close(false)}
            disabled={busy}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          {phase === 'confirm' && match && (
            <button
              type="button"
              onClick={attachToMatch}
              disabled={busy || !canEdit}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50"
            >
              <AppIcon name="paperclip" size={14} />
              Attach to {match.candidate_name.split(' ')[0]}
            </button>
          )}
          {phase === 'confirm' && (
            <button
              type="button"
              onClick={submitConfirm}
              disabled={busy || !canEdit}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="user-plus" size={15} />
              Create candidate
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
