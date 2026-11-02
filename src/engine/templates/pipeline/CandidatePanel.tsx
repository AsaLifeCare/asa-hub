/** Pipeline-owned candidate slide-over (moved verbatim from PipelineTemplate.tsx). */
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Clock, FileText, Loader2, Mail, Pencil, Phone, RotateCcw, Upload, X } from 'lucide-react'
import { TableDocUploadModal } from '@/features/hiring/TableActionButtons'
import DetailTemplate from '@/engine/templates/DetailTemplate'
import { TilePicker, parseIconRef, tintForName, type FallbackTint } from '@/components/shared/SafeImg'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { resolve } from '@/engine/templates/detail/utils'
import { isComplete } from './utils'
import { uploadCandidateDoc } from './viewDoc'
import { cn } from '@/lib/utils'
import type { PageSchema } from '@/engine/types'
import { STAGE_FORMS } from './types'
import type { ChecklistItem, Stage } from './types'
import EmbeddedForm, { type FieldBinding } from '@/components/shared/EmbeddedForm'
import { ChecklistSection } from './ChecklistSection'
import { CandidateFormView } from './CandidateFormView'

// Checklist items that must be green before the stage gate opens.
const GATE_NEED: Record<string, string[]> = {
  new: ['resume-decision'],
  'phone-screen': ['screen-details', 'advance-decision'],
  // no scorecard from the interviewer = no onboarding
  interview: ['interview-scorecard', 'interview-recommendation'],
  // Onboarding has NO gate: the packet does not refuse the move — the mapped process changes nothing here.
}

/** The decision checkpoint that a Reject acts on, per stage. */
const REJECT_CHECKPOINT: Record<string, string> = {
  new: 'resume-decision',
  'phone-screen': 'advance-decision',
}

// Pipeline-owned slide-over for records with a checklist: renders the shared DetailTemplate (minus the custom…
export function CandidatePanel({
  rec,
  onClose,
  detailConfig,
  stages,
  stageField,
  schema,
  canEdit,
  onUpload,
  onAvatarChange,
  onDecide,
  deciding,
  onScreen,
  onMove,
  onPull,
  pullingTranscript,
  liveScreen,
  onScorecard,
  canScoreInterview,
  onEditDetails,
  onUseLast,
  usingLast,
  onForceError,
  forcingError,
  onManualScreen,
  onManualOnboarding,
  onExtendOnboarding,
  onAttachPacket,
  onPerson,
  onShareLink,
}: {
  rec: any | null
  onClose: () => void
  detailConfig: any
  stages: Stage[]
  stageField: string
  schema: PageSchema
  canEdit: boolean
  onUpload: (item: ChecklistItem) => void
  /** Persists the user's icon-avatar pick for this record (per-user pref). */
  onAvatarChange?: (pref: { icon: string; tint: FallbackTint }) => void
  // Live decision checkpoints (Advance/Decline) — present only when writable.
  onDecide?: (item: ChecklistItem, value: 'Advance' | 'Decline') => void | Promise<boolean>
  // The value of THIS candidate's decision while its answer is on the way.
  deciding?: 'Advance' | 'Decline'
  /** Opens the phone-screening form — rendered only on the phone-screen stage. */
  onScreen?: () => void
  /** Gated move to the next stage — present only when writable. */
  onMove?: () => void
  /** Pulls the latest call transcript from the Comms sheet (live only). */
  onPull?: (item: ChecklistItem) => void
  pullingTranscript?: boolean
  /** Opens the interviewer's scorecard — rendered on the interview stage. */
  onScorecard?: () => void
  // Drawn disabled rather than hidden when this is true and onScorecard is not given — the step is visible, the…
  canScoreInterview?: boolean
  /** Admin-only door: edit the candidate's contact/intake parameters. */
  onEditDetails?: () => void
  /** Admin-only test loop: reset this screening + attach the latest call. */
  onUseLast?: () => void
  usingLast?: boolean
  onForceError?: () => void
  forcingError?: boolean
  // hiring.dateManual holders only: hand-typed Date accepted rescue.
  onManualScreen?: () => void
  /** hiring.edit: manual onboarding by email — completes the block, moves to Hired. */
  onManualOnboarding?: () => void
  onExtendOnboarding?: () => void
  onAttachPacket?: () => void
  /** Header name/avatar → the full profile page — present only when one exists. */
  onPerson?: () => void
  /** Mints and copies the candidate's shareable form link — writers only. */
  onShareLink?: () => void
  /** Real-time screening watch while the candidate is on the call. */
  liveScreen?:
    | { state: 'waiting' }
    | { state: 'ready'; qualification?: string; score?: string | number; summary?: string; best?: string }
    | null
}) {
  const [rejectOpen, setRejectOpen] = useState(false)
  // THE SECOND VIEW: the same record as a full-width ASA LifeCare form.
  const [formOpen, setFormOpen] = useState(false)
  useEffect(() => setFormOpen(false), [rec?.id])
  useEffect(() => {
    if (!rec) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (formOpen) setFormOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rec, onClose, formOpen])

  const dtConfig = useMemo(() => {
    const dp = detailConfig ?? {}
    const sections = (dp.sections ?? []).filter((s: any) => s.kind !== 'checklist')
    const stageLabel = rec ? stages.find((s) => s.id === rec[stageField])?.label : undefined
    const header = dp.header
      ? {
          ...dp.header,
          statusChip: dp.header.statusChip ? { ...dp.header.statusChip, label: stageLabel } : dp.header.statusChip,
          // hero name/avatar open the full profile (detail Header's optional onTitleClick — absent, the header…
          onTitleClick: onPerson,
        }
      : dp.header
    // THE FACE AT THE TOP OF THE DRAWER IS A HANDLE.
    const focusAction =
      rec && dp.header
        ? {
            type: 'staff' as const,
            id: String(rec.id ?? ''),
            name: String(resolve(rec, dp.header.title) ?? ''),
            avatar: dp.header.avatar === 'initials' ? undefined : (resolve(rec, dp.header.avatar) as string | undefined),
            subtitle: dp.header.subtitle ? String(resolve(rec, dp.header.subtitle) ?? '') : undefined,
          }
        : undefined
    return { ...dp, sections, header, focusAction }
  }, [detailConfig, rec, stages, stageField, onPerson])

  const checklistSection = (detailConfig?.sections ?? []).find((s: any) => s.kind === 'checklist')

  // Icon-avatar restyle: when the record uses an `icon:` avatar, the header strip offers the shared TilePicker…
  const avatarKey = detailConfig?.header?.avatar
  const iconAvatar = rec && typeof avatarKey === 'string' ? parseIconRef(rec[avatarKey]) : null

  // Gate state (client mirror of the GAS gate table — the server re-checks).
  const stageId = rec ? String(rec[stageField]) : ''
  const stageIdx = stages.findIndex((s) => s.id === stageId)
  const nextStage = stageIdx >= 0 ? stages[stageIdx + 1] : undefined
  const items: ChecklistItem[] = rec && Array.isArray(rec.checklist) ? rec.checklist : []
  // THE TWO-PANE DRAWER: the default side is the one carrying what is owed and the ways to settle it; dragging from…
  const [pane, setPane] = useState(0)
  const [pendUpload, setPendUpload] = useState<ChecklistItem | null>(null)
  // the form this stage declares, if any — and whether the panel is showing it instead of the item rows
  const stageForm = STAGE_FORMS[stageId]
  const [asForm, setAsForm] = useState(false)
  /** what a bound field is doing, and what it settled — keyed by field */
  const [actBusy, setActBusy] = useState<Record<string, boolean>>({})
  const [actDone, setActDone] = useState<Record<string, string>>({})
  const owedHere = items.filter(
    (i) => i.stage === stageId && (i.status === 'pending' || i.status === 'missing'),
  )
  const owedDecisions = owedHere.filter((i) => /decision$/.test(i.id))
  const owedUploadsHere = owedHere.filter((i) => !/decision$/.test(i.id))
  const paneScroll = (el: HTMLDivElement | null, to: number) => {
    el?.scrollTo({ left: to * el.clientWidth, behavior: 'smooth' })
  }
  const need = GATE_NEED[stageId] ?? []
  const missing = need.filter((id) => {
    const it = items.find((i) => i.id === id)
    return !it || !isComplete(it)
  })
  const missingLabels = missing
    .map((id) => items.find((i) => i.id === id)?.label ?? id)
    .join(', ')
  const rejectItem = items.find((i) => i.id === REJECT_CHECKPOINT[stageId])
  const moveBlocked = !nextStage || (need.length > 0 && missing.length > 0)

  // THE FORM'S FIELDS ARE THE PANEL'S OWN ACTS: the OUTPUT of "As a form" must equal "As items" — the same sheets…
  const act = async (field: string, done: string, run: () => Promise<void> | void) => {
    if (actBusy[field] || actDone[field]) return
    setActBusy((b) => ({ ...b, [field]: true }))
    try {
      await run()
      setActDone((d) => ({ ...d, [field]: done }))
    } catch {
      /* the door reported it; the field stays open so it can be tried again */
    } finally {
      setActBusy((b) => ({ ...b, [field]: false }))
    }
  }

  const uploadThrough = async (itemId: string, file: File) => {
    const target = items.find((i) => i.id === itemId)
    if (!target) throw new Error('nothing owes this document at this stage')
    await uploadCandidateDoc({ id: String(rec.id), name: rec.name, email: rec.email }, target, file)
  }

  const decisionItem = owedDecisions[0] ?? rejectItem ?? null
  const formBindings: Record<string, FieldBinding> = {
    resume: {
      busy: actBusy.resume, done: actDone.resume,
      onFile: (f) => act('resume', 'Filed on the record', () => uploadThrough('resume', f)),
    },
    cjis_background_result: {
      busy: actBusy.cjis_background_result, done: actDone.cjis_background_result,
      onFile: (f) => act('cjis_background_result', 'Filed on the record',
        () => uploadThrough('cjis', f)),
    },
    resume_decision: {
      busy: actBusy.resume_decision, done: actDone.resume_decision,
      // AWAITED: the field says "Accepted" only once the backend has taken it.
      onChoose: (v) => act('resume_decision', v === 'Accept' ? 'Accepted' : 'Declined', async () => {
        if (!onDecide || !decisionItem) throw new Error('no decision is open here')
        const took = await onDecide(decisionItem, v === 'Accept' ? 'Advance' : 'Decline')
        if (took === false) throw new Error('the decision was refused')
      }),
    },
    result: {
      busy: actBusy.result, done: actDone.result,
      onChoose: (v) => act('result', v === 'Reject' ? 'Rejected' : 'Moved on', () => {
        if (v === 'Reject') { setRejectOpen(true); return }
        if (!onMove) throw new Error('this stage has no move')
        onMove()
      }),
    },
  }

  return (
    <AnimatePresence>
      {rec && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-30 bg-black/25 xl:hidden"
          />
          <motion.aside
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            aria-label="Candidate detail panel"
            className="fixed bottom-0 right-0 top-[calc(68px+var(--hub-strip-h,0px))] z-30 flex w-full flex-col border-l border-border bg-bg shadow-3 sm:w-[384px]"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Candidate</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setFormOpen(true)}
                  title="Form view — the full record as one page"
                  aria-label="Open the candidate form view"
                  className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1"
                >
                  <FileText size={14} />
                </button>
                {onEditDetails && (
                  <button
                    onClick={onEditDetails}
                    title="Edit candidate details (admin)"
                    aria-label="Edit candidate details"
                    className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {iconAvatar && onAvatarChange && (
                  <TilePicker
                    icon={iconAvatar.icon}
                    tint={iconAvatar.tint ?? tintForName(String(rec?.name ?? iconAvatar.icon))}
                    onChange={onAvatarChange}
                    align="end"
                  />
                )}
                <button
                  onClick={onClose}
                  aria-label="Close detail panel"
                  className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="relative flex-1 overflow-hidden">
            <div
              id="cand-panes"
              onScroll={(e) => {
                const el = e.currentTarget
                setPane(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
              }}
              className="flex h-full snap-x snap-mandatory overflow-x-auto"
            >
            <div className="scroll-thin h-full w-full shrink-0 snap-center overflow-y-auto p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13px] font-bold uppercase tracking-wide text-text-2">Pending here</p>
                <div className="flex items-center gap-2">
                  {/*
                    THE SAME PENDING LIST, ASKED AS A FORM — the insertion is
                    done as a test in the form first, and the input and the
                    output get discussed from there.

                    Both readings stay on screen so the choice can be judged
                    rather than argued: the rows that work today, and the
                    stage's declared form drawn by the very mask a stranger
                    sees. Nothing is replaced while the two are still being
                    compared — that conversation is the next one, and it is
                    about what the answers should DO.
                  */}
                  {stageForm && (
                    <button
                      onClick={() => setAsForm((v) => !v)}
                      title={asForm
                        ? 'Back to the item list'
                        : 'Ask the same things as one form — the stage’s declared form, in miniature'}
                      className={cn('h-6 rounded-full px-2 text-[11px] font-semibold transition-colors',
                        asForm
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-2 text-text-2 hover:bg-surface-3')}
                    >
                      {asForm ? 'As items' : 'As a form'}
                    </button>
                  )}
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-text-2">
                    {owedHere.length} open
                  </span>
                </div>
              </div>

              {/* THE CHIP SAYS "As a form" / "As items", so it SWAPS rather
                  than adds. Drawn one above the other they read as a single
                  jumbled column and the comparison the chip exists for gets
                  harder, not easier — both can be seen one over the
                  other. */}
              {asForm && stageForm ? (
                <EmbeddedForm
                  slug={stageForm.slug}
                  token={stageForm.token}
                  showTitle={false}
                  density="compact"
                  showSend={false}
                  bindings={formBindings}
                  onFiled={() => setAsForm(false)}
                />
              ) : owedHere.length === 0 ? (
                <div className="grid place-items-center gap-2 rounded-[14px] border border-border bg-surface py-10 text-center">
                  <CheckCircle2 size={26} className="text-success" />
                  <p className="text-[14px] font-semibold text-text-1">All clear at this stage</p>
                  <p className="text-[12px] text-text-3">Swipe left for the full record.</p>
                </div>
              ) : (
                <div className="grid gap-2">
                  {owedUploadsHere.map((i) => (
                    <div key={i.id} className="flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-[12px] border border-border bg-surface px-3 py-2.5">
                      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full',
                        i.status === 'missing' ? 'bg-tint-pink text-tint-fg-pink' : 'bg-tint-amber text-tint-fg-amber')}>
                        {i.status === 'missing' ? <X size={13} /> : <Clock size={13} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-text-1" title={i.label}>{i.label}</p>
                        <p className="text-[11px] text-text-3">{i.status === 'missing' ? 'Missing' : 'Pending'}</p>
                      </div>
                      {i.id === 'transcript' && onPull ? (
                        <button
                          onClick={() => onPull(i)}
                          disabled={pullingTranscript}
                          className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50"
                        >
                          <RotateCcw size={12} />
                          {pullingTranscript ? 'Pulling…' : 'Pull'}
                        </button>
                      ) : null}
                      {i.id === 'interview-scorecard' || i.id === 'interview-recommendation' ? (
                        // THE SAME MODAL FOR BOTH — these two are the same thing, and either one opens the same…
                        <button
                          onClick={onScorecard}
                          disabled={!onScorecard}
                          title={onScorecard ? 'Interview scorecard' : 'Only the interviewer signs the scorecard.'}
                          className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-on-primary hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ClipboardCheck size={12} />
                          Scorecard
                        </button>
                      ) : (
                      <button
                        onClick={() => setPendUpload(i)}
                        className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-on-primary hover:bg-primary-hover active:scale-[0.98]"
                      >
                        <Upload size={12} />
                        Upload
                      </button>
                      )}
                    </div>
                  ))}
                  {owedDecisions.map((i) => (
                    <div key={i.id} className="w-full min-w-0 rounded-[12px] border border-border bg-surface px-3 py-2.5">
                      <p className="text-[13px] font-semibold text-text-1">{i.label}</p>
                      <p className="mb-2 text-[11px] text-text-3">The call that moves this person on — or off the board.</p>
                      {onDecide ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => onDecide(i, 'Decline')}
                            disabled={!!deciding}
                            className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border bg-surface text-[12px] font-semibold text-danger hover:bg-tint-pink disabled:cursor-wait disabled:opacity-50"
                          >
                            {deciding === 'Decline' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Decline
                          </button>
                          <button
                            onClick={() => onDecide(i, 'Advance')}
                            disabled={!!deciding}
                            className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md bg-primary text-[12px] font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-wait disabled:opacity-50"
                          >
                            {deciding === 'Advance' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Accept
                          </button>
                        </div>
                      ) : (
                        <p className="text-[11.5px] italic text-text-3">Somebody with the pen decides this one.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="scroll-thin h-full w-full shrink-0 snap-center overflow-y-auto p-4">
              {/* Real-time screening watch: the recruiter sees the call being
                  captured and its outcome without leaving the drawer. */}
              {liveScreen && (
                <div
                  className={cn(
                    'mb-3 rounded-lg border px-3 py-2.5',
                    liveScreen.state === 'ready'
                      ? 'border-transparent bg-tint-mint text-tint-fg-mint'
                      : 'border-border bg-surface-2',
                  )}
                >
                  {liveScreen.state === 'waiting' ? (
                    <p className="flex items-center gap-2 text-[12.5px] font-medium text-text-2">
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                      Listening for the screening call — the result lands here automatically.
                    </p>
                  ) : (
                    <>
                      <p className="text-[12.5px] font-bold">
                        Screening captured
                        {liveScreen.qualification ? ` · ${liveScreen.qualification}` : ''}
                        {liveScreen.score !== undefined && liveScreen.score !== '' ? ` · ${liveScreen.score}/10` : ''}
                      </p>
                      {liveScreen.best && (
                        <p className="mt-0.5 text-[12px] font-medium opacity-90">
                          In-person agreed: {liveScreen.best}
                        </p>
                      )}
                      {liveScreen.summary && (
                        <p className="mt-1 text-[12px] leading-[1.45] opacity-90">{liveScreen.summary}</p>
                      )}
                    </>
                  )}
                </div>
              )}
              <DetailTemplate
                config={dtConfig}
                record={rec}
                data={[]}
                schema={{ ...schema, id: 'panel', type: 'detail', title: 'Detail', config: dtConfig }}
              />
              {checklistSection && (
                <>
                {onUseLast && stageId === 'phone-screen' && (
                  <div className="mb-3 flex items-center justify-between rounded-md border border-dashed border-border bg-surface px-3 py-2.5">
                    <div>
                      <p className="text-[13px] font-semibold text-text-1">Use The Last</p>
                      <p className="text-[11.5px] leading-4 text-text-3">
                        Admin test loop — resets this screening; your next call fills it fresh.
                      </p>
                    </div>
                    <button
                      onClick={onUseLast}
                      disabled={usingLast}
                      title="Reset this screening and use your latest call"
                      aria-label="Use the last call"
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary shadow-1 transition-all hover:bg-primary-hover active:scale-95 disabled:opacity-50"
                    >
                      <RotateCcw size={16} className={usingLast ? 'animate-spin' : undefined} />
                    </button>
                  </div>
                )}
                {/* The mock twin: identical design, opposite
                    outcome — fills everything EXCEPT Date accepted and fires the
                    real error lane (2nd reading → SMS + email), then freezes the
                    card for inspection until Use The Last resets it. */}
                {onForceError && stageId === 'phone-screen' && (
                  <div className="mb-3 flex items-center justify-between rounded-md border border-dashed border-border bg-surface px-3 py-2.5">
                    <div>
                      <p className="text-[13px] font-semibold text-text-1">Force Error</p>
                      <p className="text-[11.5px] leading-4 text-text-3">
                        Admin test loop — fills all but Date accepted; the error lane alerts the team.
                      </p>
                    </div>
                    <button
                      onClick={onForceError}
                      disabled={forcingError}
                      title="Populate everything except Date accepted and fire the error lane"
                      aria-label="Force the Date accepted error"
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger text-white shadow-1 transition-all hover:bg-danger/90 active:scale-95 disabled:opacity-50"
                    >
                      <AlertTriangle size={16} className={forcingError ? 'animate-pulse' : undefined} />
                    </button>
                  </div>
                )}
                <ChecklistSection
                  section={checklistSection}
                  stages={stages}
                  rec={rec}
                  canEdit={canEdit}
                  onUpload={onUpload}
                  onDecide={onDecide}
                  deciding={deciding}
                  onAttachPacket={onAttachPacket}
                  onPull={onPull}
                  pulling={pullingTranscript}
                  onManualScreen={onManualScreen}
                  onManualOnboarding={onManualOnboarding}
                  onExtendOnboarding={onExtendOnboarding}
                />
                </>
              )}
            </div>
            </div>
            {/* the two dots — the drawer's own compass */}
            <div className="pointer-events-auto absolute inset-x-0 bottom-1.5 flex justify-center gap-1.5">
              {[0, 1].map((n) => (
                <button
                  key={n}
                  aria-label={n === 0 ? 'Pending items' : 'Full record'}
                  onClick={() => paneScroll(document.getElementById('cand-panes') as HTMLDivElement | null, n)}
                  className={cn('h-1.5 rounded-full transition-all duration-200',
                    pane === n ? 'w-5 bg-primary' : 'w-1.5 bg-border hover:bg-text-3')}
                />
              ))}
            </div>
            </div>

            {/* Real footer: Reject (decision Decline) + gated Move — the GAS
                gate engine is the enforcement; this is the convenience. */}
            {/* The interviewer has neither Reject nor Move — gating the whole
                footer on those hid their only control, the scorecard. */}
            {/* WHILE THE FORM IS OPEN, THE FOOTER IS ASKING TWICE — the last
                two buttons at the end have to go as well.
                The form carries Result — Reject / Move to
                Phone Screen — as a question of its own, so leaving the footer
                up puts the same decision on screen in two places with two
                different shapes, and the one that fires first wins. The
                footer comes back the moment the panel is showing items. */}
            {!(asForm && stageForm) && (onMove || onDecide || onScorecard) && (
              <div className="flex shrink-0 gap-2 border-t border-border p-3">
                {onScreen && onDecide && stageId === 'phone-screen' && (
                  <button
                    onClick={onScreen}
                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
                  >
                    <Phone size={14} />
                    Screen call
                  </button>
                )}
                {/* Manual onboarding fallback door: a reloaded card has no
                    client-grown onboarding group in the checklist, so the
                    header button may not render — this one always does. */}
                {onManualOnboarding && stageId === 'onboarding' && (
                  <button
                    onClick={onManualOnboarding}
                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
                  >
                    <Mail size={14} />
                    Manual onboarding
                  </button>
                )}
                {/* SHOWN TO EVERYONE AT THIS STAGE, PRESSABLE BY THE
                    INTERVIEWER — visible without being pressable, for
                    everyone else.

                    Hiding it was the easy version and the worse one: a
                    recruiter opening the card saw the scorecard listed as the
                    outstanding item and no control anywhere, which reads as a
                    broken screen rather than as somebody else's job. A
                    disabled button with the reason on it says who this is
                    waiting for. */}
                {stageId === 'interview' && (canScoreInterview || onScorecard) && (
                  <button
                    onClick={onScorecard}
                    disabled={!onScorecard}
                    title={onScorecard
                      ? undefined
                      : 'Only the interviewer signs the scorecard. An admin can grant "Record interview scorecard" to a named person in Settings → Access control.'}
                    className={cn(
                      'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold transition-all duration-150',
                      !onScorecard
                        ? 'cursor-not-allowed border border-dashed border-border bg-surface text-text-3'
                        : 'active:scale-[0.98] ' + (
                            // sole control of the interviewer → primary look
                            onMove || onDecide
                              ? 'border border-border bg-surface text-text-1 hover:bg-surface-2'
                              : 'bg-primary text-on-primary hover:bg-primary-hover'),
                    )}
                  >
                    <ClipboardCheck size={14} />
                    Interview scorecard
                  </button>
                )}
                {onDecide && rejectItem && (
                  <button
                    onClick={() => setRejectOpen(true)}
                    disabled={!!deciding}
                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[13px] font-semibold text-danger transition-all duration-150 hover:bg-tint-pink active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
                  >
                    {deciding === 'Decline' && <Loader2 size={14} className="animate-spin" />}
                    Reject
                  </button>
                )}
                {onMove && (
                  <button
                    disabled={moveBlocked}
                    title={
                      !nextStage
                        ? 'Already at the final stage'
                        : missing.length > 0
                          ? `Stage gate — missing: ${missingLabels}`
                          : undefined
                    }
                    onClick={onMove}
                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ArrowRight size={15} />
                    {nextStage ? `Move to ${nextStage.label}` : 'Final stage'}
                  </button>
                )}
              </div>
            )}

            <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Decline {rec?.name ?? 'this candidate'}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The {rejectItem?.label?.toLowerCase() ?? 'decision'} is set to Decline and the
                    candidate moves to Not Hiring, leaving the board.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      setRejectOpen(false)
                      if (rejectItem && onDecide) onDecide(rejectItem, 'Decline')
                    }}
                    className="bg-danger text-white hover:bg-danger/90"
                  >
                    Decline candidate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <TableDocUploadModal
              open={pendUpload != null}
              onOpenChange={(o) => { if (!o) setPendUpload(null) }}
              row={{ id: String(rec?.id ?? ''), name: String(rec?.name ?? ''), email: rec?.email ? String(rec.email) : undefined, stage: stageId }}
              item={pendUpload ? { id: pendUpload.id, label: pendUpload.label, status: pendUpload.status, stage: pendUpload.stage } : null}
              onUploaded={() => setPendUpload(null)}
            />
          </motion.aside>

          {/* View two: the ASA LifeCare form. Same record, same callbacks —
              the confirm dialog and the upload modal above are portals, so
              they serve both views from right here. */}
          {formOpen && (
            <CandidateFormView
              rec={rec}
              detailConfig={detailConfig}
              stages={stages}
              stageId={stageId}
              items={items}
              owedUploads={owedUploadsHere}
              owedDecisions={owedDecisions}
              nextStage={nextStage}
              moveBlocked={moveBlocked}
              missingLabels={missingLabels}
              rejectItem={rejectItem}
              onBack={() => setFormOpen(false)}
              onShareLink={onShareLink}
              onDecide={onDecide}
              deciding={deciding}
              onMove={onMove}
              onReject={() => setRejectOpen(true)}
              onUpload={(i) => setPendUpload(i)}
              onPull={onPull}
              pullingTranscript={pullingTranscript}
              onScreen={onScreen}
              onScorecard={onScorecard}
            />
          )}
        </>
      )}
    </AnimatePresence>
  )
}
