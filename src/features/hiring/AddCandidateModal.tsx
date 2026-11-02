// "Add candidate" — where everything starts on the Hiring Pipeline.
// WHAT IS ACTUALLY REQUIRED: only first name, last name and a phone number are mandatory, and the e-mail is wanted.
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { noteWrite } from '@/lib/snapshotClient'
import { useCan } from '@/auth'
import { useAuthStore } from '@/auth/useAuthStore'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { toast } from '@/stores/useToastStore'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { gasAction, inputCls } from './shared'
import { NewHirePacketField, type PacketAttached } from './NewHirePacketField'
import { PhoneScreenDoneField } from './PhoneScreenDoneField'
import { ReferralFastLane, fastLaneReasons, FAST_LANE_STAGES } from './ReferralFastLane'
import { ResumeAtIntakeField, type IntakeResume } from './ResumeAtIntakeField'
import { ohioToday } from '@/lib/ohio'

const SOURCES = ['Direct', 'SMS', 'Referral', 'Indeed', 'Careers page', 'Job fair']

type FormState = {
  firstName: string
  lastName: string
  phone: string
  email: string
  city: string
  state: string
  zip: string
  source: string
  // Who referred them — ONE answer, whatever asked it.
  referredBy: string
  referralPhone: string
}

const emptyForm = (): FormState => ({
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  city: '',
  state: '',
  zip: '',
  source: 'Direct',
  referredBy: '',
  referralPhone: '',
})

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
      <span className={cn('block', error && '[&_input]:border-danger [&_select]:border-danger')}>{children}</span>
    </label>
  )
}

/** Builds the optimistic board record shaped like the live adapter emits. */
function buildRecord(
  form: FormState,
  candidateId?: string,
  candidateName?: string,
  /** Where the SERVER put the card — never where the form asked it to go. */
  placedAt: string = 'new',
  resumeOnFile = false,
  // Who is signed in.
  addedBy = '',
) {
  const first = form.firstName.trim()
  const last = form.lastName.trim()
  const source = form.referredBy.trim() && /referral/i.test(form.source)
    ? `Referral — ${form.referredBy.trim()}`
    : form.source
  return {
    id: candidateId || `pending-${Date.now()}`,
    name: candidateName || `${first} ${last}`,
    role: 'Direct Support Professional',
    avatar: 'icon:user',
    stage: placedAt,
    source,
    daysInStage: 0,
    score: null,
    appliedAt: new Date().toISOString(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    // The card carries the referrer from the first paint — the sheet answers with the same two values a heartbeat…
    referralName: form.referredBy.trim(),
    referralPhone: form.referralPhone.trim(),
    addedBy: addedBy,
    owner: '',
    ownerAvatar: '',
    resumeLink: '',
    resumeFileLabel: '',
    summary: '',
    summaryTimeline: [
      { time: ohioToday(), text: 'Applied via ' + source, tint: 'blue' },
      ...(placedAt === 'onboarding'
        ? [{ time: ohioToday(), text: 'Started at Onboarding on a referral', tint: 'amber' }]
        : []),
    ],
    checklist: [
      { id: 'resume', label: 'Resume', owner: 'Candidate', stage: 'new', upload: true, status: resumeOnFile ? 'done' : 'missing' },
      { id: 'cjis', label: 'CJIS / Background result', owner: 'HR', stage: 'new', upload: true, status: 'missing' },
      { id: 'resume-decision', label: 'Resume decision', owner: 'Recruiter', stage: 'new', status: 'pending' },
    ],
  }
}

export default function AddCandidateModal({
  open,
  onOpenChange,
  onCreated,
  withPacket,
  stage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Shows the New Hire Packet field.
  withPacket?: boolean
  // The band whose "+" was pressed.
  stage?: string
  onCreated: (rec: any) => void
}) {
  const canEdit = useCan('hiring.edit')
  const isLive = useApiConfigStore((s) => s.driver) === 'apps-script'
  // The stamp the sheet is about to write, written on the optimistic card too so the two agree from the first paint…
  const signedIn = useAuthStore((s) => s.user?.email)
  const addedByStamp = signedIn ? `asa-hub:${signedIn}` : ''

  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [packet, setPacket] = useState<PacketAttached | null>(null)
  const [screenDone, setScreenDone] = useState(false)
  const [screenNote, setScreenNote] = useState('')
  const [resume, setResume] = useState<IntakeResume | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [startAtOnboarding, setStartAtOnboarding] = useState(false)

  const isReferral = /referral/i.test(form.source)
  // Which band the "+" came from, when it is one a candidate can be inserted at.
  const targetStage = stage && stage in FAST_LANE_STAGES ? stage : undefined
  const qualifies = isLive && isReferral && !!targetStage && fastLaneReasons(form).length === 0

  // Pressing "+" on a band is a statement about where this person belongs.
  useEffect(() => {
    if (qualifies) setStartAtOnboarding(true)
  }, [qualifies])
  // A box that stays ticked after its justification disappears is a claim that outlived its evidence.
  useEffect(() => {
    if (!qualifies && startAtOnboarding) setStartAtOnboarding(false)
  }, [qualifies, startAtOnboarding])

  const set = (k: keyof FormState, v: string) => {
    setForm((s) => ({ ...s, [k]: v }))
    setErrors((s) => ({ ...s, [k]: false }))
    setApiError(null)
  }

  const close = (o: boolean) => {
    if (!o) {
      setForm(emptyForm())
      setErrors({})
      setApiError(null)
      // Everything the last intake carried, or the next one inherits a stranger's packet and a stranger's resume.
      setPacket(null)
      setScreenDone(false)
      setScreenNote('')
      setResume(null)
      setResumeText('')
      setStartAtOnboarding(false)
    }
    onOpenChange(o)
  }

  const submit = async () => {
    if (!canEdit) {
      toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin' })
      return
    }
    const missing: Record<string, boolean> = {}
    if (!form.firstName.trim()) missing.firstName = true
    if (!form.lastName.trim()) missing.lastName = true
    if (!form.phone.trim() || form.phone.replace(/\D/g, '').length < 7) missing.phone = true
    // The SHAPE is still checked, the FIELD is no longer demanded: a typo'd address is a candidate we cannot reach…
    const typedEmail = form.email.trim()
    if (typedEmail && !/^\S+@\S+\.\S+$/.test(typedEmail)) missing.email = true
    if (Object.keys(missing).length) {
      setErrors(missing)
      const incomplete = missing.firstName || missing.lastName || missing.phone
      setApiError(
        incomplete && missing.email
          ? 'Fill the required fields — first and last name, and a phone with at least 7 digits. The email typed is not a valid address.'
          : incomplete
            ? 'Fill the required fields — first and last name, and a phone with at least 7 digits.'
            : 'That email is not a valid address — correct it, or leave it empty.',
      )
      return
    }
    setSaving(true)
    setApiError(null)
    try {
      if (isLive) {
        const data = await gasAction<{
          candidate_id: string
          candidate_name: string
          placed_at?: string
          placement_reasons?: string[]
          resume_on_file?: boolean
        }>('hubIntake', {
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          zip: form.zip.trim() || undefined,
          // The dropdown used to reach the optimistic card and never the sheet.
          source: form.source,
          referred_by: isReferral ? form.referredBy.trim() || undefined : undefined,
          // The same person as `referred_by` when the source is Referral, and the whole point of the field when it…
          referral_name: form.referredBy.trim() || undefined,
          referral_phone: form.referralPhone.trim() || undefined,
          // A request, not a decision — the server re-checks and answers with where the card actually landed.
          start_stage: startAtOnboarding && targetStage ? targetStage : undefined,
          resume_link: resume?.resume_link || undefined,
          resume_filename: resume?.filename || undefined,
          resume_text: !resume && resumeText.trim() ? resumeText.trim() : undefined,
          // Carried through so the brand-new card is already settled rather than immediately asking for a document…
          packet_file_id: packet?.file_id || undefined,
          packet_verdict: packet?.verdict || undefined,
          phone_screen_done: screenDone ? 'true' : undefined,
          phone_screen_note: screenDone ? screenNote.trim() || undefined : undefined,
        })
        // The relay's write ledger can answer {accepted: true} instead of the ids — the save IS guaranteed (queued…
        const accepted = (d: any) => d && typeof d === 'object' && d.accepted === true
        if (accepted(data)) {
          toast({
            type: 'success',
            title: 'Candidate accepted',
            body: 'Being added to the Hub sheet — appearing shortly.',
          })
        } else {
          const placedAt = data.placed_at || 'new'
          const rec = buildRecord(form, data.candidate_id, data.candidate_name, placedAt, !!data.resume_on_file, addedByStamp)
          // The toast reports the PLACEMENT THAT HAPPENED.
          const wanted = startAtOnboarding && targetStage ? targetStage : ''
          const refused = !!wanted && placedAt !== wanted
          toast({
            type: refused ? 'warning' : 'success',
            title: refused
              ? `${data.candidate_name} starts at New`
              : placedAt !== 'new'
                ? `${data.candidate_name} starts at ${FAST_LANE_STAGES[placedAt] ?? placedAt}`
                : 'Candidate created',
            body: refused
              ? `Starting at ${FAST_LANE_STAGES[wanted] ?? wanted} needs ${(data.placement_reasons || []).join(', ')}.`
              : placedAt !== 'new'
                ? 'The skipped stages are recorded as skipped by decision, naming you and the referral.'
                : 'Saved to the Hub sheet.',
          })
          onCreated(rec)
        }
        // Tell the builder NOW: a slice built seconds before this create otherwise hides the new card until the…
        noteWrite('candidates')
      } else {
        const row = await api.create('candidates', buildRecord(form))
        toast({ type: 'success', title: 'Candidate created', body: 'Added to the pipeline.' })
        onCreated(row)
      }
      close(false)
    } catch (err) {
      // Inline error with the backend detail — the modal stays open.
      setApiError(err instanceof Error ? err.message : 'Could not create the candidate. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-surface sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-[18px] font-bold text-text-1">Add candidate</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Where everything starts — the candidate lands in New applicants and the talent engine takes it from
            there.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="First name" required error={errors.firstName}>
              <input
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
                placeholder="e.g. Jane"
                className={inputCls}
              />
            </Field>
            <Field label="Last name" required error={errors.lastName}>
              <input
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                placeholder="e.g. Doe"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Phone" required error={errors.phone}>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="(614) 555-0100"
                className={inputCls}
              />
            </Field>
            <Field label="Email" hint="recommended" error={errors.email}>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="name@mail.example"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <Field label="City">
              <input
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="Columbus"
                className={inputCls}
              />
            </Field>
            <Field label="State">
              <input
                value={form.state}
                onChange={(e) => set('state', e.target.value)}
                placeholder="OH"
                className={inputCls}
              />
            </Field>
            <Field label="Zip">
              <input
                value={form.zip}
                onChange={(e) => set('zip', e.target.value)}
                placeholder="43215"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Source">
            <select value={form.source} onChange={(e) => set('source', e.target.value)} className={inputCls}>
              {SOURCES.map((s) => (
                <option key={s} value={s} className="text-text-1">
                  {s}
                </option>
              ))}
            </select>
          </Field>
          {/* Asked on every card. Almost nobody arrives out of nowhere — a
              Direct walk-in was usually sent by somebody, and the name of that
              somebody is what the archive screen and the no-number list have
              been printing as "Referred by" all along. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {isReferral ? (
              // The box below asks for this same person and is the copy that explains what a name there unlocks, so…
              <Field label="Referred by">
                <span className="flex h-9 items-center gap-1.5 rounded-sm border border-dashed border-border px-3 text-[12px] text-text-3">
                  <AppIcon name="corner-right-down" size={12} className="shrink-0" />
                  <span className="min-w-0 truncate">
                    {form.referredBy.trim()
                      ? `${form.referredBy.trim()} — edit it in the Referral box below`
                      : 'Asked in the Referral box below'}
                  </span>
                </span>
              </Field>
            ) : (
              <Field label="Referred by" hint="optional">
                <input
                  value={form.referredBy}
                  onChange={(e) => set('referredBy', e.target.value)}
                  placeholder="Who sent them to us"
                  className={inputCls}
                />
              </Field>
            )}
            <Field label="Referral phone" hint="optional">
              <input
                type="tel"
                value={form.referralPhone}
                onChange={(e) => set('referralPhone', e.target.value)}
                placeholder="(614) 555-0142"
                className={inputCls}
              />
            </Field>
          </div>
        </div>

        {isReferral && (
          <ReferralFastLane
            input={form}
            stage={targetStage}
            onReferredBy={(v) => set('referredBy', v)}
            value={startAtOnboarding}
            onChange={setStartAtOnboarding}
          />
        )}

        {(withPacket || !!targetStage) && (
          <ResumeAtIntakeField
            name={`${form.firstName} ${form.lastName}`.trim()}
            live={isLive}
            file={resume}
            text={resumeText}
            onFile={setResume}
            onText={setResumeText}
          />
        )}

        {withPacket && (
          <PhoneScreenDoneField
            firstName={form.firstName}
            lastName={form.lastName}
            email={form.email}
            phone={form.phone}
            live={isLive}
            value={screenDone}
            note={screenNote}
            onChange={setScreenDone}
            onNote={setScreenNote}
          />
        )}

        {(withPacket || !!targetStage) && (
          <NewHirePacketField
            name={`${form.firstName} ${form.lastName}`.trim()}
            email={form.email}
            phone={form.phone}
            live={isLive}
            attached={packet}
            onAttached={setPacket}
          />
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
            disabled={saving}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !canEdit}
            title={canEdit ? undefined : 'Requires hiring.edit — ask an admin'}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="user-plus" size={15} />
            {saving ? 'Creating…' : 'Add candidate'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
