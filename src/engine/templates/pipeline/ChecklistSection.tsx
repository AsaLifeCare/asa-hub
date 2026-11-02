/** Interactive detail-panel document checklist (moved verbatim from PipelineTemplate.tsx). */
import { Fragment, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/shared/Badge'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import type { TintName } from '@/engine/types'
import type { ChecklistItem, ChecklistStatus, Stage } from './types'
import { MISSING_STYLE, OWNER_TINT, STATUS_META, isComplete } from './utils'

// Blue at 7 and above, red below.
const SCORECARD_PASS = 7

// THE SCORECARD LINE: under the Resume row, only when a resume is on file.
function ScorecardRow({ rec, canEdit, onScored }: { rec: { id: string; resumeScorecard?: number | null }; canEdit: boolean; onScored?: () => void }) {
  const [scoring, setScoring] = useState(false)
  const score: number | null = rec?.resumeScorecard ?? null
  const scoreNow = async () => {
    setScoring(true)
    try {
      const d = await gasAction<{ scored: boolean; reason: string; composite?: number | null }>(
        'resumeScorecardRun', { candidate_id: rec.id })
      if (d.scored) {
        toast({ type: 'success', title: `Scorecard: ${d.composite ?? '—'}`, body: 'The nota is on the card.' })
        onScored?.()
      } else {
        toast({ type: 'info', title: 'Not scored', body: d.reason })
      }
    } catch (e) {
      toast({ type: 'danger', title: 'Not scored', body: e instanceof Error ? e.message : 'Try again.' })
    }
    setScoring(false)
  }
  return (
    <div className="flex items-center gap-2 rounded-sm px-1 py-1 pl-8">
      <span className="clamp-1 flex-1 text-[12.5px] font-medium text-text-2">Scorecard</span>
      {score != null ? (
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
            score >= SCORECARD_PASS ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger',
          )}
          title={`Resume scorecard — the rubric's composite. ${score >= SCORECARD_PASS ? 'At or above' : 'Below'} ${SCORECARD_PASS}. Never blocks the process.`}
        >
          {score}
        </span>
      ) : canEdit ? (
        <button
          onClick={() => void scoreNow()}
          disabled={scoring}
          title="Read the resume through the rubric and put the nota on the card"
          className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft disabled:opacity-50"
        >
          {scoring ? 'Scoring…' : 'Score'}
        </button>
      ) : (
        <span className="shrink-0 text-[11px] text-text-3">pending</span>
      )}
    </div>
  )
}

/** Larger status icon for detail-panel rows. */
function StatusIcon({ status }: { status: ChecklistStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.pending
  const Icon = m.icon
  return (
    <span
      className={cn('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full', m.bg, m.fg)}
      style={status === 'missing' ? MISSING_STYLE : undefined}
    >
      <Icon size={12} strokeWidth={2.4} />
    </span>
  )
}

// Interactive document checklist for the detail panel — grouped by pipeline stage with status icons, owner chips…
const DECISION_IDS = new Set(['resume-decision', 'advance-decision'])

export function ChecklistSection({
  section,
  stages,
  rec,
  canEdit,
  onUpload,
  onDecide,
  deciding,
  onAttachPacket,
  onPull,
  pulling,
  onManualScreen,
  onManualOnboarding,
  onExtendOnboarding,
}: {
  section: any
  stages: Stage[]
  rec: any
  canEdit: boolean
  onUpload: (item: ChecklistItem) => void
  /** Present only when the live decision lane is writable. */
  onDecide?: (item: ChecklistItem, value: 'Advance' | 'Decline') => void
  /** The candidate's decision while its answer is on the way (CandidatePanel). */
  deciding?: 'Advance' | 'Decline'
  /** Opens the manual New Hire packet dialog (Packet.gs / packetWaive). */
  onAttachPacket?: () => void
  // Gives back an onboarding window that closed (Onboarding.gs / onboardingExtend).
  onExtendOnboarding?: () => void
  /** Pulls the real call transcript from the Comms sheet (live only). */
  onPull?: (item: ChecklistItem) => void
  pulling?: boolean
  // Present only for people with hiring.dateManual (configurable in Settings → Access control): type the accepted…
  onManualScreen?: () => void
  // Manual onboarding by email — the same door for the next stage: completes the whole Onboarding block, moves to…
  onManualOnboarding?: () => void
}) {
  const items: ChecklistItem[] = Array.isArray(rec[section.key ?? 'checklist']) ? rec[section.key ?? 'checklist'] : []
  if (items.length === 0) return null
  const total = items.length
  const done = items.filter(isComplete).length
  const pct = total ? Math.round((done / total) * 100) : 0
  const known = new Set(stages.map((s) => s.id))
  const groups: { id: string; label: string; tint: TintName; items: ChecklistItem[] }[] = stages
    .map((s) => ({ id: s.id, label: s.label, tint: s.tint, items: items.filter((i) => i.stage === s.id) }))
    .filter((g) => g.items.length > 0)
  const extra = items.filter((i) => !known.has(i.stage))
  if (extra.length > 0) groups.push({ id: '__other', label: 'Other', tint: 'blue', items: extra })

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: 0.08, ease: EASE_OUT_EXPO }}
      className="mt-4"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
          {section.title ?? 'Document checklist'}
        </h3>
        <span className="text-[11px] font-semibold tabular-nums text-text-3">
          {done}/{total} complete
        </span>
      </div>
      <div className="mb-3 h-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: TINT_VAR.mint }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
        />
      </div>
      <div className="space-y-3">
        {groups.map((g) => {
          const gDone = g.items.filter(isComplete).length
          const noun = g.items.every((i) => i.owner === 'Candidate') ? 'uploaded' : 'done'
          return (
            <div key={g.id} className="rounded-lg border border-border bg-surface p-2.5">
              <div className="mb-1 flex items-center gap-1.5 px-1 pt-0.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TINT_VAR[g.tint] }} />
                <span className="text-[12px] font-bold text-text-1">{g.label}</span>
                {/* The SECOND way through the process:
                    someone struggled with the automated line, a person called
                    them instead — and that call IS the phone screen. One press
                    completes the whole block and moves them to Interview. */}
                {onManualScreen && g.id === 'phone-screen' && gDone < g.items.length && (
                  <button
                    title="A person called and screened them by hand — completes this whole block and moves them to Interview"
                    onClick={onManualScreen}
                    className="ml-1 shrink-0 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft"
                  >
                    Manual
                  </button>
                )}
                {/* NO `gDone < g.items.length` ON THESE TWO, and that is the
                    point: the Manual onboarding button unfortunately has to
                    exist, so it goes back.

                    The phone-screen Manual above completes an unfinished block,
                    so hiding it once the block is done is right. These do not:
                    since the drag from Onboarding to Hired was closed, Manual
                    onboarding is the ONLY way forward — so the moment somebody
                    finished every step in the portal, the checklist went 6-of-6,
                    the button vanished, and the person was stuck with no door at
                    all. A button that disappears exactly when it becomes the
                    only option is worse than no button. */}
                {onExtendOnboarding && g.id === 'onboarding' && (
                  <button
                    title="They missed their onboarding window — give them more days so the portal lets them back in"
                    onClick={onExtendOnboarding}
                    className="ml-1 shrink-0 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
                  >
                    Extend
                  </button>
                )}
                {onManualOnboarding && g.id === 'onboarding' && (
                  <button
                    title="Records that the onboarding is done and moves them on — the only way out of this column, whether they finished in the portal or were walked through by e-mail"
                    onClick={onManualOnboarding}
                    className="ml-1 shrink-0 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft"
                  >
                    Manual
                  </button>
                )}
                <span className="ml-auto text-[11px] tabular-nums text-text-3">
                  {gDone} of {g.items.length} {noun}
                </span>
              </div>
              <div>
                {g.items.map((it) => (
                  <Fragment key={it.id}>
                  <div className="flex items-center gap-2 rounded-sm px-1 py-1.5">
                    <StatusIcon status={it.status} />
                    <span
                      className={cn(
                        'clamp-1 flex-1 text-[13px]',
                        isComplete(it) ? 'text-text-2' : 'font-medium text-text-1',
                      )}
                      title={`${it.label} · ${STATUS_META[it.status]?.tooltip ?? it.status}`}
                    >
                      {it.label}
                    </span>
                    {it.owner && (
                      <Badge label={it.owner} tint={OWNER_TINT[it.owner] ?? 'blue'} className="shrink-0 text-[9px]" />
                    )}
                    {/* The New Hire Packet waits for an insertion rather than a
                        decision, so its control is "Attach" — and it sits on
                        the row itself, where the thing that is missing is
                        named. Offered whenever the packet is not settled,
                        including "not found": that is the case where a human
                        holding the signed copy is the only way through. */}
                    {onAttachPacket && it.id === 'new-hire-packet' && !isComplete(it) && (
                      <button
                        disabled={!canEdit}
                        title={canEdit ? 'Record the signed New Hire packet' : 'Requires hiring.edit — ask an admin'}
                        onClick={() => onAttachPacket()}
                        className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Attach
                      </button>
                    )}
                    {/* Decision checkpoints: Advance / Decline (live only). */}
                    {onDecide && DECISION_IDS.has(it.id) && it.status === 'pending' && (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          disabled={!canEdit || !!deciding}
                          title={canEdit ? `${it.label}: Advance` : 'Requires hiring.edit — ask an admin'}
                          onClick={() => onDecide(it, 'Advance')}
                          className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {deciding === 'Advance' && <Loader2 size={10} className="animate-spin" />}
                          Advance
                        </button>
                        <button
                          disabled={!canEdit || !!deciding}
                          title={canEdit ? `${it.label}: Decline` : 'Requires hiring.edit — ask an admin'}
                          onClick={() => onDecide(it, 'Decline')}
                          className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-danger transition-colors hover:bg-tint-pink disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {deciding === 'Decline' && <Loader2 size={10} className="animate-spin" />}
                          Decline
                        </button>
                      </span>
                    )}
                    {/* Transcript checkpoint: pull the real call from the
                        Comms sheet (7-day phone-system window). */}
                    {onPull && it.id === 'transcript' && it.status === 'pending' && (
                      <button
                        disabled={!canEdit || pulling}
                        title={canEdit ? 'Pull the latest call transcript from the phone system' : 'Requires hiring.edit — ask an admin'}
                        onClick={() => onPull(it)}
                        className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {pulling ? 'Pulling…' : 'Pull call'}
                      </button>
                    )}
                    {/* Upload only for real documents — analysis checkpoints
                        (transcript, decisions…) stay status-dot only. */}
                    {it.upload === true && (it.status === 'pending' || it.status === 'missing') && (
                      <button
                        disabled={!canEdit}
                        title={canEdit ? `Upload “${it.label}”` : 'Requires hiring.edit — ask an admin'}
                        onClick={() => onUpload(it)}
                        className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                      >
                        Upload
                      </button>
                    )}
                  </div>
                  {/* No resume, no scorecard; a resume, a scorecard. */}
                  {it.id === 'resume' && g.id === 'new' && isComplete(it) && rec?.resumeScorecard !== undefined && (
                    <ScorecardRow rec={rec} canEdit={canEdit} />
                  )}
                  </Fragment>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </motion.section>
  )
}
