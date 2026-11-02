// OnboardingHome — the Overview landing for trainees (role 'onboarding'), mounted by OverviewHomeRoute in App.tsx…
// Header + 6 step circles (any order — tap to jump in) + the selected step's content panel with a full-width "✓…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Building2, Check, ClipboardList, Clock, FileText, GraduationCap, Hash, IdCard, Lock, Mail, Map as MapIcon, MapPin, Phone, Play, ShieldCheck, Upload } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import QuestionnaireRunner from '@/pages/features/questionnaire/QuestionnaireRunner'
import IdentityDocs from '@/features/onboarding/IdentityDocs'
import { useObFlow, type ObFlow, type ObStep } from '@/features/onboarding/useObFlow'
import { openFile } from '@/stores/useFileViewerStore'
import { questionnaires as bundledQuestionnaires } from '@/lib/seed-questionnaire'
import { useLiveQuestionnaires } from '@/pages/features/questionnaire/live'

/** The new-hire questionnaire the six-step flow runs at step 5. */
const ONBOARDING_QUESTIONNAIRE_ID = 'q-caregiving-instincts'

// The new-hire videos live in lib/trainingVideos, read from Drive (the old portal linked a 404 for one of them and…
const TUTORIALS = TRAINING_VIDEOS.filter((v) => v.newHire).map((v) => ({
  id: v.id,
  title: v.title,
  blurb: v.blurb,
  seconds: v.seconds,
  url: drivePreviewUrl(v.driveId),
}))
import { useAuthStore } from '@/auth/useAuthStore'
import {
  ONBOARDING_STEP_IDS,
  useOnboardingStore,
  type OnboardingStepId,
} from '@/stores/useOnboardingStore'
import { releaseSeat } from '@/lib/seat'
import { BACKGROUND_CHECK, TRAINING_LINKS, mapsUrl } from '@/lib/onboardingPlaces'
import { TRAINING_VIDEOS, clock, drivePreviewUrl } from '@/lib/trainingVideos'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

const TOTAL = ONBOARDING_STEP_IDS.length

const STEPS: { id: OnboardingStepId; label: string; icon: typeof FileText }[] = [
  { id: 'packet', label: 'New Hire Packet', icon: FileText },
  { id: 'background-check', label: 'Background Check', icon: ShieldCheck },
  { id: 'upload-documents', label: 'Upload Documents', icon: Upload },
  { id: 'training', label: 'Complete Training', icon: GraduationCap },
  { id: 'questionnaire', label: 'Questionnaire', icon: ClipboardList },
  { id: 'tutorials', label: 'New Hire Tutorials', icon: Play },
]

const STEP_INDEX = new Map(ONBOARDING_STEP_IDS.map((id, i) => [id, i + 1]))

/** Every step the screen can mark, and the flag that proves it in the record. */
const STEP_TO_SERVER: Record<OnboardingStepId, ObStep> = {
  packet: 'packet',
  'background-check': 'background',
  'upload-documents': 'documents',
  training: 'training',
  questionnaire: 'questionnaire',
  tutorials: 'tutorials',
}

// The steps as the RECORD has them.
function serverDoneIds(flow: ObFlow | null): OnboardingStepId[] {
  if (!flow) return []
  const done: Record<OnboardingStepId, boolean> = {
    // THE PACKET STEP COMPLETES ON THE ACKNOWLEDGEMENT, NOT ON THE DOCUMENT — and that is deliberate, so nobody…
    packet: flow.packet_acknowledged,
    'background-check': flow.background_done,
    'upload-documents': flow.documents_done,
    training: flow.training_done,
    questionnaire: flow.questionnaire_done,
    tutorials: flow.tutorials_done,
  }
  return ONBOARDING_STEP_IDS.filter((id) => done[id])
}

// The closed-seat notice: nobody is at the onboarding stage of the pipeline, so there is nobody this visit could…
function ClosedSeatModal({ eject, onOut }: { eject: boolean; onOut: () => void }) {
  const [left, setLeft] = useState(8)
  useEffect(() => {
    if (!eject) return
    const tick = setInterval(() => setLeft((s) => s - 1), 1000)
    return () => clearInterval(tick)
  }, [eject])
  useEffect(() => {
    if (eject && left <= 0) onOut()
  }, [eject, left, onOut])
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-2">
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-tint-amber">
          <Lock size={18} className="text-tint-fg-amber" />
        </span>
        <h2 className="text-[17px] font-bold text-text-1">No candidate is in Onboarding</h2>
        <p className="mt-2 text-[13.5px] leading-6 text-text-2">
          There is no candidate at this phase of the hiring process right now, so this seat is closed. Ask the
          recruiter to advance someone to Onboarding first.
        </p>
        {eject ? (
          <>
            <p className="mt-2 text-[12.5px] text-text-3">You will be signed out in {Math.max(0, left)}s.</p>
            <button
              onClick={onOut}
              className="mt-4 flex h-10 w-full items-center justify-center rounded-md bg-primary text-[13.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
            >
              Sign out now
            </button>
          </>
        ) : (
          <p className="mt-2 text-[12.5px] text-text-3">
            You are seeing this as a preview — the onboarding seat itself is signed out at this point.
          </p>
        )}
      </div>
    </div>
  )
}

/* ---------------- step bodies ---------------- */

// The six panels.
type ReportCounters = {
  questionnaire_answered: number
  questionnaire_total: number
  tutorials_seen: number
  tutorials_total: number
}

type BodyProps = {
  flow: ObFlow | null
  busy: boolean
  setName: (n: string) => Promise<unknown>
  uploadDoc: (id: string, b64: string, name: string, mime: string, expires?: string) => Promise<unknown>
  removeDoc: (id: string) => Promise<unknown>
  /** Hand in the signed New Hire packet from step 1. */
  uploadPacket: (b64: string, name: string, mime: string) => Promise<{ state?: string; released?: boolean; message?: string }>
  // The panel tells the page whether MARK DONE may be pressed, why not, and — when the step has work of its own…
  setGate: (gate: { allowed: boolean; reason?: string; before?: () => Promise<unknown> }) => void
  // What only the browser knows, for the onboarding report Smart Comms sends when the visit finishes: how many…
  noteReport: (patch: Partial<ReportCounters>) => void
}

// HAND IN THE SIGNED PACKET, from here.
function PacketHandIn({
  busy,
  uploadPacket,
}: {
  busy: boolean
  uploadPacket: BodyProps['uploadPacket']
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  const send = async (f: File) => {
    setErr('')
    if (f.size > 15 * 1024 * 1024) {
      setErr('That file is over 15MB — send a smaller scan or a PDF.')
      return
    }
    setSending(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
        fr.onerror = () => reject(new Error('Could not read that file'))
        fr.readAsDataURL(f)
      })
      const res = await uploadPacket(base64, f.name, f.type || 'application/pdf')
      toast({
        type: 'success',
        title: 'Packet received',
        body: res?.message ?? 'Thank you — your signed New Hire packet is on file.',
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send that file. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void send(f)
        }}
      />
      <button
        type="button"
        disabled={sending || busy}
        onClick={() => ref.current?.click()}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        <Upload size={14} />
        {sending ? 'Sending…' : 'Send your signed packet'}
      </button>
      <p className="mt-1.5 text-[11.5px] leading-4 text-text-3">
        A photo or a scan is fine — PDF or image, up to 15MB.
      </p>
      {err && <p className="mt-1.5 text-[12px] font-medium text-tint-fg-pink">{err}</p>}
    </div>
  )
}

function PacketBody({ flow, busy, setName, setGate, uploadPacket }: BodyProps) {
  const [draft, setDraft] = useState('')
  useEffect(() => setDraft(flow?.full_name ?? ''), [flow?.full_name])
  const named = Boolean(flow?.full_name)
  const typed = draft.trim()
  const valid = typed.split(/\s+/).length > 1
  useEffect(() => {
    setGate({
      allowed: named || valid,
      reason: named || valid ? undefined : 'Type your first and last name',
      // the step's button saves the name, which is also what makes step 3 find what this person already sent
      before: named ? undefined : () => setName(typed),
    })
  }, [named, valid, typed, setName, setGate])

  if (named) {
    // A tolerant name match has to be visible.
    const matched = flow?.matched_name
    const differs = Boolean(matched) && matched?.trim().toLowerCase() !== flow?.full_name.trim().toLowerCase()
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[13px] leading-5 text-text-1">
          <Mail size={15} className="mt-0.5 shrink-0 text-text-3" />
          We have emailed you a welcome packet to fill out from Dropbox Sign. Reach out to Arthur if you
          have any questions.
        </p>
        {/**
         * THE PACKET, SAID PLAINLY. Green when it is
         * signed or already on file; red when it is not — and red here is not
         * an accusation of the person, it is the one thing standing between
         * them and being staff, shown while they can still act on it. It never
         * blocks a step: they walk the whole flow either way.
         */}
        {flow?.packet_on_file ? (
          <p className="flex items-start gap-2 rounded-md bg-tint-mint px-3 py-2.5 text-[13px] leading-5 text-tint-fg-mint">
            <Check size={15} className="mt-0.5 shrink-0" strokeWidth={3} />
            <span>
              <span className="font-semibold">Your New Hire packet is on file.</span> Nothing else to do here.
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-md bg-tint-pink px-3 py-2.5 text-[13px] leading-5 text-tint-fg-pink">
            <FileText size={15} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">We do not have your signed New Hire packet yet.</span>{' '}
              {flow?.packet_state === 'unsigned'
                ? 'Your Dropbox Sign email is still waiting for a signature — sign it and this turns green on its own.'
                : 'Sign the Dropbox Sign email we sent you, or send us the signed copy right here.'}{' '}
              Carry on with every step below — this does not stop you. It is only the last thing we need before
              your file is complete.
            </span>
          </p>
        )}
        {!flow?.packet_on_file && <PacketHandIn busy={busy} uploadPacket={uploadPacket} />}
        {flow?.name_ambiguous?.length ? (
          <p className="rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-5 text-tint-fg-amber">
            That name is close to more than one person we have on record (
            {flow.name_ambiguous.join(' and ')}), so we did not guess. Nothing is lost — send your
            documents below and your recruiter will link them up.
          </p>
        ) : differs ? (
          <p className="text-[12px] leading-5 text-text-3">
            You typed <span className="font-semibold text-text-2">{flow?.full_name}</span> and we opened
            the record for <span className="font-semibold text-text-2">{matched}</span>. If that is not
            you, tell your recruiter before sending anything.
          </p>
        ) : (
          <p className="text-[12px] text-text-3">
            Signed in as <span className="font-semibold text-text-2">{flow?.full_name}</span> — we checked
            our records under that name.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-5 text-text-2">
        First, your full name. We use it to look for documents you may already have sent us — so we do
        not ask you for anything twice.
      </p>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="First and last name"
        disabled={busy}
        className="h-10 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary disabled:opacity-60"
      />
    </div>
  )
}

function BackgroundBody({ setGate }: BodyProps) {
  // open either way — the check is run for them; the button is just their acknowledgement that it is under way
  useEffect(() => setGate({ allowed: true }), [setGate])
  const c = BACKGROUND_CHECK
  const rows: { icon: typeof Building2; label: string; value: string; href?: string }[] = [
    { icon: Building2, label: 'Company', value: c.company },
    { icon: MapPin, label: 'Address', value: c.address },
    { icon: Clock, label: 'Hours', value: c.hours },
    { icon: Phone, label: 'Phone', value: formatPhoneDisplay(c.phone), href: `tel:${c.phone.replace(/[^\d+]/g, '')}` },
    ...(c.reasonCode ? [{ icon: Hash, label: 'Reason Code', value: c.reasonCode }] : []),
  ]
  return (
    <div className="space-y-3.5">
      <p className="text-[13px] leading-5 text-text-2">
        Your DODD background check is through <strong className="font-semibold text-text-1">{c.vendor}</strong>.
        This is a <strong className="font-semibold text-text-1">BCI check only</strong> — walk-ins welcome, no
        appointment needed.
      </p>

      <dl className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3 px-4 py-2.5">
            <r.icon size={14} className="mt-0.5 shrink-0 text-text-3" />
            <dt className="w-[92px] shrink-0 text-[12.5px] font-semibold text-text-1">{r.label}</dt>
            <dd className="min-w-0 flex-1 text-[12.5px] leading-5 text-text-2">
              {r.href ? (
                <a href={r.href} className="text-primary hover:underline">
                  {r.value}
                </a>
              ) : (
                r.value
              )}
            </dd>
          </div>
        ))}
      </dl>

      <p className="flex items-start gap-2.5 rounded-md border-l-2 border-primary bg-primary-soft px-4 py-3">
        <IdCard size={15} className="mt-0.5 shrink-0 text-primary-strong" />
        <span className="text-[13px] leading-5 text-text-1">{c.bring}</span>
      </p>

      <a
        href={mapsUrl(c.mapsQuery)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
      >
        <MapIcon size={13} /> Get Directions
      </a>
    </div>
  )
}

function UploadDocumentsBody({ flow, uploadDoc, removeDoc, setGate }: BodyProps) {
  useEffect(() => setGate({ allowed: true }), [setGate])
  if (!flow) return <p className="text-[13px] text-text-3">Loading your documents…</p>
  // no name, no record — an Attach button here would upload into nothing
  if (!flow.found || !flow.full_name) {
    return (
      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
        Put your full name in step 1 first. That is what opens your record — and what finds the
        documents you have already sent us, so we do not ask for them twice.
      </p>
    )
  }
  return <IdentityDocs docs={flow.docs} priorCount={flow.prior_count} onUpload={uploadDoc} onRemove={removeDoc} />
}

function TrainingBody({ setGate }: BodyProps) {
  // Open either way, by rule: the certificates can arrive after the fact, and blocking the step would strand…
  useEffect(() => setGate({ allowed: true }), [setGate])
  const btn =
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors active:scale-[0.98]'
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-surface-2 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-sm bg-tint-lavender text-tint-fg-lavender">
            <GraduationCap size={16} />
          </span>
          <h3 className="mt-2.5 text-[14px] font-bold text-text-1">DODD 8-Hour Training</h3>
          <p className="mt-1 text-[12px] leading-5 text-text-2">
            Required for all direct support professionals. Free, online and self-paced through the DODD
            MyLearning portal.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={TRAINING_LINKS.doddNewEmployee}
              target="_blank"
              rel="noreferrer"
              className={cn(btn, 'bg-primary text-on-primary hover:bg-primary-hover')}
            >
              New Employee
            </a>
            <a
              href={TRAINING_LINKS.doddAnnualRenewal}
              target="_blank"
              rel="noreferrer"
              className={cn(btn, 'border border-border bg-surface text-text-1 hover:bg-surface-3')}
            >
              Annual Renewal
            </a>
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface-2 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-sm bg-tint-pink text-tint-fg-pink">
            <ShieldCheck size={16} />
          </span>
          <h3 className="mt-2.5 text-[14px] font-bold text-text-1">CPR &amp; First Aid</h3>
          <p className="mt-1 text-[12px] leading-5 text-text-2">
            You need <strong className="font-semibold text-text-1">ASHI First Aid</strong> and{' '}
            <strong className="font-semibold text-text-1">ASHI CPR/AED</strong> (Adult, Child &amp; Infant) —
            two separate classes, in person. Seats fill fast.
          </p>
          <div className="mt-3">
            <a
              href={TRAINING_LINKS.cprRegistration}
              target="_blank"
              rel="noreferrer"
              className={cn(btn, 'bg-danger text-danger-foreground hover:opacity-90')}
            >
              Register for Class
            </a>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border p-3.5">
        <p className="mb-2.5 text-[12.5px] leading-5 text-text-2">
          Finished a course? Send the certificate here — that is what counts as done. We check it and
          record when it expires, so you get a reminder before it lapses.
        </p>
        <p className="text-[12.5px] text-text-3">
          Attach them in step 3 — the CPR and DODD rows are there, and whatever you already sent us is
          already ticked.
        </p>
      </div>
    </div>
  )
}

// Step 5 runs the REAL questionnaire, in place.

function QuestionnaireBody({ setGate, noteReport }: BodyProps) {
  const [open, setOpen] = useState(false)
  /** Opened at least ONCE — not "open right now". See the gate below. */
  const [touched, setTouched] = useState(false)
  // PINNED BY ID, AND NEVER SUBSTITUTED.
  const { questionnaires: live, loading, error } = useLiveQuestionnaires()
  const questionnaire = useMemo(() => {
    const from = !loading && !error && live.length ? live : bundledQuestionnaires
    return from.find((q) => q.id === ONBOARDING_QUESTIONNAIRE_ID) ?? null
  }, [live, loading, error])
  // OPENED IS ENOUGH — answering is not compulsory.
  useEffect(() => {
    setGate({
      allowed: touched,
      reason: touched ? undefined : 'Open the questionnaire first',
    })
  }, [touched, setGate])

  if (!questionnaire) return <p className="text-[13px] text-text-2">No questionnaire is configured yet.</p>
  if (open) {
    return (
      <div className="-mx-1">
        <QuestionnaireRunner
          questionnaire={questionnaire}
          onClose={() => setOpen(false)}
          onSubmitted={() => setTouched(true)}
          onProgress={(answered, total) =>
            noteReport({ questionnaire_answered: answered, questionnaire_total: total })
          }
        />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-5 text-text-2">{questionnaire.description}</p>
      <p className="text-[12px] text-text-3">
        About {questionnaire.estimatedMin} minutes · {questionnaire.privacyNote}
      </p>
      <button
        onClick={() => { setOpen(true); setTouched(true) }}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
      >
        <ClipboardList size={14} /> {touched ? 'Open questionnaire again' : 'Open questionnaire'}
      </button>
    </div>
  )
}

function TutorialsBody({ setGate, noteReport }: BodyProps) {
  const [seen, setSeen] = useState<string[]>([])
  const allSeen = TUTORIALS.every((t) => seen.includes(t.id))
  useEffect(() => {
    setGate({
      allowed: allSeen,
      reason: allSeen ? undefined : `Open all ${TUTORIALS.length} videos first (${seen.length} so far)`,
    })
    noteReport({ tutorials_seen: seen.length, tutorials_total: TUTORIALS.length })
  }, [allSeen, seen.length, setGate, noteReport])

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-5 text-text-2">
        Three short videos. Open each one — the button below unlocks when you have.
      </p>
      <ul className="space-y-1.5">
        {TUTORIALS.map((t) => {
          const watched = seen.includes(t.id)
          return (
            <li key={t.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-[9px]',
                  watched ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2 text-text-3',
                )}
              >
                {watched ? <Check size={14} /> : <Play size={14} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="clamp-1 block text-[13px] font-medium text-text-1">{t.title}</span>
                <span className="clamp-1 block text-[11.5px] text-text-3">{t.blurb} · {clock(t.seconds)}</span>
              </span>
              <button
                onClick={() => {
                  setSeen((s) => (s.includes(t.id) ? s : [...s, t.id]))
                  openFile({ title: t.title, subtitle: 'New hire tutorial', url: t.url })
                }}
                className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-3"
              >
                {watched ? 'Watch again' : 'Watch'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const STEP_BODY: Record<OnboardingStepId, { title: string; sub: string; body: ComponentType<BodyProps> }> = {
  packet: {
    title: 'New Hire Packet',
    sub: 'Your name, then the packet we emailed you.',
    body: PacketBody,
  },
  'background-check': {
    title: 'Background Check',
    sub: 'We run this one for you — track its status here.',
    body: BackgroundBody,
  },
  'upload-documents': {
    title: 'Upload Identification Documents',
    sub: 'Five documents — whatever you already sent us is here already.',
    body: UploadDocumentsBody,
  },
  training: {
    title: 'Complete Training',
    sub: 'Two required certifications before your first solo shift.',
    body: TrainingBody,
  },
  questionnaire: {
    title: 'Questionnaire',
    sub: 'Tell us about your experience and availability.',
    body: QuestionnaireBody,
  },
  tutorials: {
    title: 'New Hire Tutorials',
    sub: 'Short videos on timekeeping, documentation and safety.',
    body: TutorialsBody,
  },
}

/* ---------------- page ---------------- */

export default function OnboardingHome() {
  const user = useAuthStore((s) => s.user)
  // the six steps as the SERVER sees them — see features/onboarding/useObFlow
  const { flow, busy, setName, uploadDoc, removeDoc, markStep, uploadPacket } = useObFlow()
  // Closed until the panel says otherwise.
  const [gate, setGate] = useState<{ step: string; allowed: boolean; reason?: string; before?: () => Promise<unknown> }>({
    step: '',
    allowed: false,
  })
  // The setter the panels receive MUST be render-stable.
  const selectedStepRef = useRef('')
  const setGateForSelected = useCallback(
    (g: { allowed: boolean; reason?: string; before?: () => Promise<unknown> }) =>
      setGate({ ...g, step: selectedStepRef.current }),
    [],
  )
  // The report counters, in a REF.
  const reportRef = useRef<ReportCounters>({
    questionnaire_answered: 0, questionnaire_total: 0,
    tutorials_seen: 0, tutorials_total: 0,
  })
  const noteReport = useCallback((patch: Partial<ReportCounters>) => {
    reportRef.current = { ...reportRef.current, ...patch }
  }, [])

  const logout = useAuthStore((s) => s.logout)
  const markDone = useOnboardingStore((s) => s.markDone)
  const unmark = useOnboardingStore((s) => s.unmark)
  const navigate = useNavigate()
  const [handingOver, setHandingOver] = useState(false)

  // Progress is filed per PERSON, not per account.
  const progressKey = user ? (flow?.full_name ? `${user.id}:${flow.full_name.toLowerCase()}` : user.id) : ''
  const localCompleted = useOnboardingStore((s) => s.progress[progressKey]?.completed) ?? []

  // A WAITING SEAT STARTS BLANK.
  const resetSeatProgress = useOnboardingStore((s) => s.resetUser)
  useEffect(() => {
    if (user && flow && !flow.full_name) resetSeatProgress(user.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, flow?.full_name])
  const completed = useMemo(() => {
    // NOTHING IS GREEN UNTIL WE KNOW WHOSE IT IS — this is the flicker the screen used to show: a step that "starts…
    if (!flow) return []
    const shown = new Set<OnboardingStepId>(serverDoneIds(flow))
    if (flow.full_name) localCompleted.forEach((id) => shown.add(id))
    return ONBOARDING_STEP_IDS.filter((id) => shown.has(id))
  }, [flow, localCompleted])

  /** Every step done IN THE RECORD — the only basis for closing the visit. */
  const recordComplete = useMemo(() => {
    const done = serverDoneIds(flow)
    return Boolean(flow?.found) && ONBOARDING_STEP_IDS.every((id) => done.includes(id))
  }, [flow])

  const [picked, setPicked] = useState<OnboardingStepId | null>(null)
  const firstOpen = ONBOARDING_STEP_IDS.find((id) => !completed.includes(id)) ?? ONBOARDING_STEP_IDS[TOTAL - 1]
  const selected = picked ?? firstOpen
  selectedStepRef.current = selected
  const doneCount = completed.length

  // THE FINALE (chapter 24): once everything is finished, a modal congratulates the person with a six-second…
  const [finale, setFinale] = useState(false)
  const [finaleBar, setFinaleBar] = useState(false)
  const finaleFired = useRef(false)
  useEffect(() => {
    if (user?.role !== 'onboarding') return
    if (doneCount !== TOTAL || finaleFired.current) return
    finaleFired.current = true
    setFinale(true)
    // the bar starts on the next frame so the 6s transition actually runs
    const raf = requestAnimationFrame(() => setFinaleBar(true))
    const t = setTimeout(() => {
      logout()
      navigate('/login', { replace: true })
    }, 6000)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [doneCount, user?.role, logout, navigate])
  const selectedDone = completed.includes(selected)

  // NOTHING MOVES BEFORE THE NAME.
  const nameMissing = !flow?.full_name
  const nameLocked = nameMissing && selected !== 'packet'
  /** Only the gate issued for the step on screen counts; anything else is closed. */
  const activeGate = nameLocked
    ? { step: selected, allowed: false, reason: 'Add your full name in step 1 first — that is what opens your record.', before: undefined }
    : gate.step === selected
      ? gate
      : { step: selected, allowed: false, reason: undefined, before: undefined }


  if (!user) return null

  // THE SEAT ONLY OPENS WITH SOMEONE TO ONBOARD — there has to be somebody at the onboarding stage; when there is…
  if (flow && flow.stage_open === false) {
    return (
      <ClosedSeatModal
        eject={user.role === 'onboarding'}
        onOut={() => {
          logout()
          navigate('/login', { replace: true })
        }}
      />
    )
  }

  // The visit is over — give the seat back.
  const endVisit = async (completedFlow: boolean) => {
    const res = await releaseSeat({
      flow: 'onboarding',
      userId: user.id,
      completed: completedFlow,
      // Only a FINISHED visit produces a report, so the counters ride only that call — a handover reports nothing…
      report: completedFlow ? reportRef.current : undefined,
    })
    if (completedFlow) {
      // finishing onboarding IS the hire — the board is moved server-side, and we only claim it here when it…
      const hired = res.followed?.some((f) => f.moved)
      // Held on the packet: they finished, and we say what is still owed rather than "welcome aboard" over an…
      const held = res.followed?.some((f) => f.held)
      toast({
        type: 'success',
        title: held ? 'Onboarding complete — one document to go' : 'Onboarding complete — welcome aboard!',
        body: held
          ? 'Everything you sent is saved. We are still waiting on your signed New Hire packet — sign the Dropbox Sign email and your file completes itself.'
          : hired
            ? 'Everything you sent is saved and your file has moved to Hired. This screen is ready for the next new hire.'
            : 'Everything you sent is saved. This screen is ready for the next new hire.',
      })
    }
    logout()
    navigate('/login', { replace: true })
  }

  const handleMarkDone = async () => {
    // The rule is enforced HERE, not only by the disabled attribute.
    if (!activeGate.allowed) {
      toast({ type: 'warning', title: 'Not yet', body: activeGate.reason ?? 'Finish this step first.' })
      return
    }
    // whatever the panel needs done first (step 1 saves the name) — and if it fails, the step is NOT marked: a…
    if (activeGate.before) {
      try {
        await activeGate.before()
      } catch (err) {
        toast({ type: 'danger', title: 'Could not save that', body: err instanceof Error ? err.message : 'Please try again.' })
        return
      }
    }
    // The record still rules — but the SCREEN no longer waits for it.
    const wouldComplete =
      Boolean(flow?.found) &&
      ONBOARDING_STEP_IDS.every((id) => id === selected || serverDoneIds(flow).includes(id))
    if (wouldComplete) {
      let after: ObFlow
      try {
        after = await markStep(STEP_TO_SERVER[selected])
      } catch (err) {
        toast({ type: 'danger', title: 'Could not record that step', body: err instanceof Error ? err.message : 'Please try again.' })
        return
      }
      markDone(progressKey, selected)
      if (ONBOARDING_STEP_IDS.every((id) => serverDoneIds(after).includes(id))) {
        await endVisit(true)
        return
      }
      setPicked(null)
      return
    }

    const step = selected
    markDone(progressKey, step)
    setPicked(null) // jump to the next open step NOW
    toast({
      type: 'success',
      title: `${STEP_BODY[step].title} — done`,
      body: `${doneCount + 1} of ${TOTAL} steps complete.`,
    })
    markStep(STEP_TO_SERVER[step]).catch((err) => {
      unmark(progressKey, step)
      setPicked(step) // bring them back to the step that did not save
      toast({
        type: 'danger',
        title: `${STEP_BODY[step].title} — NOT saved`,
        body: (err instanceof Error ? err.message : 'The write failed.') + ' The tick was undone — press Mark done again.',
      })
    })
  }

  const stepCfg = STEPS.find((s) => s.id === selected)!
  const Body = STEP_BODY[selected].body
  // No reset here on purpose.

  return (
    <div className="mx-auto max-w-[880px]">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[24px] font-extrabold leading-8 tracking-[-0.015em] text-text-1 sm:text-[28px] sm:leading-9">
            {/* the name THEY typed, not the account's — this screen is shared */}
            Welcome to the team, {(flow?.full_name || user.name).split(' ')[0]}!
          </h1>
          <p className="mt-2 max-w-[560px] text-[13px] leading-5 text-text-2">
            We&apos;re excited to have you join ASA Lifecare. Complete the steps below to get started as
            quickly as possible. You can work through them in any order — just tap a step to jump in.
          </p>

          {/**
            * A shared screen needs a way out that is not "finish someone else's
            * onboarding". Somebody walks off at step 3 and the next person sits
            * down to a stranger's name — without this the only fix is an admin
            * editing a spreadsheet. Nothing is deleted: the record stays, the
            * screen simply stops being theirs.
            */}
          {flow?.full_name && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] leading-5 text-text-3">
              <span>
                This screen is <span className="font-semibold text-text-2">{flow.full_name}</span>&apos;s.
              </span>
              {handingOver ? (
                <>
                  <span className="text-text-2">Hand it to someone else? Nothing you sent is deleted.</span>
                  <button
                    onClick={() => void endVisit(false)}
                    className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                  >
                    Yes, hand it over
                  </button>
                  <button
                    onClick={() => setHandingOver(false)}
                    className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-text-3 transition-colors hover:text-text-1"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setHandingOver(true)}
                  className="font-semibold text-primary transition-colors hover:underline"
                >
                  Not you?
                </button>
              )}
            </div>
          )}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold',
            doneCount === TOTAL ? 'bg-tint-mint text-tint-fg-mint' : 'bg-tint-primary text-tint-fg-primary',
          )}
        >
          {doneCount} of {TOTAL} steps complete
        </span>
      </div>

      {/**
        * The safety net for a visit that finished but was never closed.
        *
        * Marking the sixth step used to be the ONLY way out, which leaves two
        * people stuck forever: whoever finished before the release existed,
        * and whoever's last save landed while the release failed. Both see a
        * screen with every step green and nothing to press, and the seat stays
        * theirs until somebody edits a spreadsheet.
        */}
      {recordComplete && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md bg-tint-mint px-4 py-3">
          <p className="text-[13px] font-semibold leading-5 text-tint-fg-mint">
            All {TOTAL} steps are done. Close your onboarding — everything you sent is kept, and this
            screen goes back to waiting for the next new hire.
          </p>
          <button
            onClick={() => void endVisit(true)}
            disabled={busy}
            className="shrink-0 rounded-full bg-primary px-4 py-2 text-[12.5px] font-bold tracking-[0.04em] text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            FINISH AND CLOSE
          </button>
        </div>
      )}

      {/* step circles */}
      <div className="mt-7 grid grid-cols-3 gap-y-5 sm:grid-cols-6">
        {STEPS.map((step) => {
          const done = completed.includes(step.id)
          const current = step.id === selected
          // still open to READ — someone should be able to look up the background check address before typing…
          const locked = nameMissing && step.id !== 'packet'
          return (
            <button
              key={step.id}
              onClick={() => setPicked(step.id)}
              aria-current={current ? 'step' : undefined}
              className="group flex flex-col items-center gap-2"
            >
              <span
                className={cn(
                  'grid h-12 w-12 place-items-center rounded-full text-[15px] font-bold transition-all duration-150',
                  done
                    ? 'bg-primary text-on-primary'
                    : current
                      ? 'bg-surface text-primary ring-2 ring-primary ring-offset-2 ring-offset-bg'
                      : 'bg-surface-3 text-text-2 group-hover:bg-border',
                )}
              >
                {done ? <Check size={20} strokeWidth={3} /> : locked ? <Lock size={16} /> : STEP_INDEX.get(step.id)}
              </span>
              <span
                className={cn(
                  'max-w-[110px] text-center text-[11px] font-medium leading-4',
                  current ? 'text-primary-strong' : done ? 'text-text-1' : 'text-text-3',
                  locked && !current && 'opacity-60',
                )}
              >
                {step.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* selected step panel */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selected}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
        >
          <Card className="mt-7">
            <CardHeader
              title={`Step ${STEP_INDEX.get(selected)} · ${stepCfg.label}`}
              sub={STEP_BODY[selected].sub}
              extra={
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-tint-primary text-tint-fg-primary">
                  <stepCfg.icon size={18} />
                </span>
              }
            />
            <Body
              flow={flow}
              busy={busy}
              setName={setName}
              uploadDoc={uploadDoc}
              removeDoc={removeDoc}
              uploadPacket={uploadPacket}
              setGate={setGateForSelected}
              noteReport={noteReport}
            />
            {!selectedDone && !activeGate.allowed && activeGate.reason && (
              <p className="mt-4 text-center text-[12px] text-text-3">{activeGate.reason}</p>
            )}
            <button
              onClick={() => void handleMarkDone()}
              disabled={selectedDone || !activeGate.allowed || busy}
              title={activeGate.allowed ? undefined : activeGate.reason}
              className={cn(
                'mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-bold tracking-[0.06em] transition-colors active:scale-[0.99] disabled:active:scale-100',
                selectedDone
                  ? 'cursor-default bg-tint-mint text-tint-fg-mint'
                  : activeGate.allowed
                    ? 'bg-primary text-on-primary hover:bg-primary-hover'
                    : // A locked button MUST look locked. It kept its full
                      // colour and only refused the click, which reads as a broken button, not a rule — and is why…
                      'cursor-not-allowed border border-border bg-surface-2 text-text-3',
              )}
            >
              {selectedDone || activeGate.allowed ? <Check size={16} strokeWidth={3} /> : <Lock size={15} />}
              {selectedDone ? 'DONE' : 'MARK DONE'}
            </button>
          </Card>
        </motion.div>
      </AnimatePresence>

      {/* the finale — congratulations, a 6-second bar, and the sign-out */}
      {finale && (
        <div className="fixed inset-0 z-[300] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[480px] rounded-lg border border-border bg-surface p-8 text-center shadow-3">
            <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-tint-mint text-tint-fg-mint">
              <GraduationCap size={30} />
            </span>
            <p className="font-display text-[26px] font-bold text-text-1">You did it!</p>
            <p className="mt-2 text-[15px] leading-[24px] text-text-2">
              Every step of your onboarding is complete. The team has been told —
              they take it from here. You will be signed out in a few seconds.
            </p>
            <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: finaleBar ? '100%' : '0%',
                  transition: 'width 6s linear',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
