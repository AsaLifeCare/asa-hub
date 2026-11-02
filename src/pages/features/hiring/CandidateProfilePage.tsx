// CANDIDATE — the MEGA profile behind every hiring surface.
// It starts from the graded Talent Pipeline profile and adds documents, history & evidence and candidate details…
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  AlertTriangle, Archive, ArrowLeft, ArrowUpRight, CalendarDays, ClipboardCheck, Clock3,
  FileText, GraduationCap, Home, Mail, MapPin, Phone, ShieldCheck, Signpost,
  Sparkles, UserRound,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import { gasAction } from '@/features/hiring/shared'
import { openFile } from '@/stores/useFileViewerStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { isAllowedWith, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import { CANDIDATES_APP_ID, candidateHref } from '@/pages/features/staffcandidates/candidateModel'

type ChecklistItem = { id: string; label: string; status: 'done' | 'pending' | 'missing' | 'auto' }
type TimelineItem = { time: string; text: string; tint?: string }

/** The live candidates-slice row, as candidateProfileGet returns it. */
type CandidateRow = {
  id?: string
  candidateId?: string
  name?: string
  role?: string
  avatar?: string
  stage?: string
  score?: number
  email?: string
  phone?: string
  city?: string
  state?: string
  source?: string
  appliedAt?: string
  daysInStage?: number
  resumeLink?: string
  resumeFileLabel?: string
  checklist?: ChecklistItem[]
  summaryTimeline?: TimelineItem[]
  packet?: { state?: string; label?: string }
  /** The archive lane's stamps — a discarded person still opens as a profile. */
  archived?: boolean
  archived_at?: string
  archived_reason?: string
}

/** The interview scorecard joined server-side — null when never scheduled. */
type InterviewInfo = {
  interviewer_name?: string
  score?: string
  comments?: string
  recommendation?: string
  scheduled_for?: string
  interviewed_at?: string
}

// The onboarding record + the portal's two flags + the Ready-to-Start approval stamps — null when nothing exists at…
type OnboardingInfo = {
  starting_status?: string
  earliest_start_date?: string
  start_date?: string
  house?: string
  notes?: string
  date_moved?: string
  questionnaire_done?: boolean
  tutorials_done?: boolean
  approved_ready_at?: string
  approved_ready_by?: string
}

/** The Talent Pipeline's scored record — the tp_* join, TalentPipelinePage's shape. */
type TpRow = {
  candidate_id: string
  name: string
  phone: string
  email: string
  city: string
  status: string
  resume_link: string
  composite_score: string
  skills: string
  certs: string
  experience: string
  job_history: string
  years: string
  flags: string[]
  decision: string
  summary: string
  cjis: string
  cjis_report: string
  certifications: string
  screen_result: string
  screen_qualification: string
  screen_date: string
  screened_by: string
  rank?: number | null
}

const DECISION_CHIP: Record<string, string> = {
  Advance: 'bg-tint-mint text-tint-fg-mint',
  Review: 'bg-tint-amber text-tint-fg-amber',
  Reject: 'bg-tint-pink text-tint-fg-pink',
}

/** The interviewer's recommendation tints the score chip — same trio of tints. */
const RECO_CHIP: Record<string, string> = {
  Advance: 'bg-tint-mint text-tint-fg-mint',
  Hold: 'bg-tint-amber text-tint-fg-amber',
  Decline: 'bg-tint-pink text-tint-fg-pink',
}

/** A NOTA — the legacy composite (max 12) on the 0-10 scale everyone reads. */
function notaOf(composite: string): number | null {
  const n = parseFloat(composite)
  if (Number.isNaN(n)) return null
  return Math.max(0, Math.min(10, Math.round((n / 12) * 100) / 10))
}
const notaChip = (g: number) =>
  g >= 8 ? 'bg-tint-mint text-tint-fg-mint' : g >= 6 ? 'bg-tint-amber text-tint-fg-amber' : 'bg-tint-pink text-tint-fg-pink'

function ScoreBox({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={cn('rounded-md border border-border bg-surface-2 py-2 text-center', big && 'bg-primary-soft')}>
      <p className={cn('font-bold tabular-nums text-text-1', big ? 'text-[18px]' : 'text-[15px]')}>{value || '—'}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3">{label}</p>
    </div>
  )
}

/** done/auto wear mint, pending amber, missing an empty dashed ring. */
function StatusDot({ status }: { status: ChecklistItem['status'] }) {
  if (status === 'missing') {
    return <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-border-strong" />
  }
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full bg-current',
        status === 'pending' ? 'text-tint-fg-amber' : 'text-tint-fg-mint',
      )}
    />
  )
}

function FactRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px]">
      <span className="mt-0.5 shrink-0 text-text-3">{icon}</span>
      <span className="w-[92px] shrink-0 text-text-3">{label}</span>
      <span className="min-w-0 flex-1 break-words text-text-1">{value}</span>
    </div>
  )
}

/** ISO → "Aug 25, 2026"; anything unparseable shows as it came. */
function fmtDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CandidateProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const id = params.get('id') ?? ''

  const [row, setRow] = useState<CandidateRow | null>(null)
  const [tp, setTp] = useState<TpRow | null>(null)
  const [interview, setInterview] = useState<InterviewInfo | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [refused, setRefused] = useState('')

  // the same candidate in Staff Candidates, for whoever that app is open to (its master until it is released)
  const apps = useRegistryStore((s) => s.apps)
  const effRole = useEffectiveRole()
  useBadgeRulesVersion()   // a rule edit re-decides it without a reload
  const staffCandidates = isAllowedWith(apps, effRole, CANDIDATES_APP_ID)

  useEffect(() => {
    if (!id) { setLoading(false); setRefused('No candidate id in the link.'); return }
    setLoading(true)
    setRefused('')
    gasAction<{
      row: CandidateRow | null
      tp?: TpRow | null
      interview?: InterviewInfo | null
      onboarding?: OnboardingInfo | null
    }>('candidateProfileGet', { candidate_id: id })
      .then((d) => {
        setRow(d.row ?? null)
        setTp(d.tp ?? null)
        setInterview(d.interview ?? null)
        setOnboarding(d.onboarding ?? null)
      })
      .catch((e) => setRefused(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [id])

  // Real history steps back; a cold deep link falls back to the door the route belongs to (this page mounts under…
  const goBack = () => {
    const st = window.history.state as { idx?: number } | null
    if (st && typeof st.idx === 'number' && st.idx > 0) { navigate(-1); return }
    navigate(location.pathname.startsWith('/app/interviews') ? '/app/interviews/board' : '/app/hiring/pipeline', { replace: true })
  }

  // THE PAGE STARTS AT THE TOP — the Profile view comes up a little.
  const back = (
    <div className="flex">
      <button onClick={goBack} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold leading-[18px] text-text-3 hover:text-text-1">
        <ArrowLeft size={13} /> Back
      </button>
    </div>
  )

  if (loading) {
    return (
      <div>
        {back}
        <p className="mt-6 text-[13px] text-text-3">Loading the candidate…</p>
      </div>
    )
  }

  if (refused || !row) {
    return (
      <div>
        {back}
        <Card className="mx-auto mt-8 max-w-[560px]">
          <EmptyState
            title="This profile did not open"
            body={refused || 'No candidate answers to that id.'}
          />
        </Card>
      </div>
    )
  }

  const cid = String(row.candidateId ?? row.id ?? id)
  const name = row.name ?? tp?.name ?? cid
  const score = Number(row.score ?? 0)
  const cityState = [row.city || tp?.city, row.state].filter(Boolean).join(', ')
  const email = row.email || tp?.email || ''
  const phone = row.phone || tp?.phone || ''
  const nota = tp ? notaOf(tp.composite_score) : null
  // The hiring board's file wins; the legacy pipeline's résumé backs it up.
  const resumeUrl = row.resumeLink || tp?.resume_link || ''
  // served order, same as the board's detail panel — .time is a display label, not a sortable stamp, so no…
  const timeline = row.summaryTimeline ?? []

  const viewResume = () => {
    if (!resumeUrl) return
    // INSIDE the platform — the résumé is always shown here, never handed away; the file viewer frames Drive links…
    openFile({ title: `${name} — résumé`, subtitle: cid, url: resumeUrl, icon: 'file-text' })
  }

  return (
    <div>
      {back}

      {/* ── header — the Users profile's shape, the nota up front ── */}
      <Card className="mb-4 mt-1.5 flex flex-wrap items-center gap-4 p-4">
        {nota !== null && (
          <span className={cn('grid h-[64px] w-[64px] shrink-0 place-items-center rounded-xl text-[22px] font-bold tabular-nums', notaChip(nota))}>
            {nota.toFixed(1)}
          </span>
        )}
        <DragPerson name={name} id={cid} avatar={row.avatar} subtitle={row.stage} className="shrink-0">
          <Avatar src={row.avatar} name={name} size="xl" eager />
        </DragPerson>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DragPerson name={name} id={cid}>
              <h1 className="text-[18px] font-bold text-text-1">{name}</h1>
            </DragPerson>
            {tp?.decision && (
              <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                DECISION_CHIP[tp.decision] ?? 'bg-surface-2 text-text-3')}>
                {tp.decision}
              </span>
            )}
            {row.stage && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-bold capitalize text-text-3">
                {row.stage.replace(/-/g, ' ')}
              </span>
            )}
            {row.archived && (
              <span className="rounded-full bg-tint-pink px-2 py-0.5 text-[10.5px] font-bold text-tint-fg-pink">
                Archived
              </span>
            )}
            {score > 0 && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-bold tabular-nums text-text-2">
                ★ {score}/5
              </span>
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-text-3">
            <span>{cid}</span>
            {row.role && <span>{row.role}</span>}
            {cityState && <span className="flex items-center gap-1"><MapPin size={11} /> {cityState}</span>}
            {phone && <span className="flex items-center gap-1"><Phone size={11} /> {formatPhoneDisplay(phone)}</span>}
            {email && <span className="flex items-center gap-1"><Mail size={11} /> {email}</span>}
          </p>
        </div>
        {staffCandidates && (
          <Link to={candidateHref(cid)} data-open-staff-candidates=""
            className="flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
            Open in Staff Candidates <ArrowUpRight size={13} />
          </Link>
        )}
        {resumeUrl && (
          <button
            onClick={viewResume}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover"
          >
            <FileText size={14} /> View résumé
          </button>
        )}
      </Card>

      {/* ── the scores — the Talent Pipeline's five boxes ── */}
      {tp && (
        <Card className="mb-4 p-4">
          <div className="grid grid-cols-5 gap-2">
            <ScoreBox label="Composite" value={tp.composite_score} big />
            <ScoreBox label="Skills" value={tp.skills} />
            <ScoreBox label="Certs" value={tp.certs} />
            <ScoreBox label="Experience" value={tp.experience} />
            <ScoreBox label="History" value={tp.job_history} />
          </div>
          {nota !== null && (
            <p className="mt-2 text-[11px] text-text-3">
              Nota {nota.toFixed(1)}/10 = composite {tp.composite_score} over the rubric's 12.
              {tp.rank ? ` Ranked #${tp.rank} on the scoreboard.` : ''}
            </p>
          )}
          {tp.flags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tp.flags.map((f) => (
                <span key={f} className="flex items-center gap-1 rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold text-tint-fg-amber">
                  <AlertTriangle size={10} /> {f}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ── facts rail ── */}
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Candidate details</h3>
            <dl className="space-y-2">
              <FactRow
                icon={<Mail size={12} />}
                label="E-mail"
                value={email ? <a href={`mailto:${email}`} className="text-primary hover:underline">{email}</a> : 'Not on file'}
              />
              <FactRow
                icon={<Phone size={12} />}
                label="Phone"
                value={phone ? <a href={`tel:${phone}`} className="text-primary hover:underline">{formatPhoneDisplay(phone)}</a> : 'Not on file'}
              />
              <FactRow icon={<MapPin size={12} />} label="City / state" value={cityState || 'Not on file'} />
              <FactRow icon={<Signpost size={12} />} label="Source" value={row.source || 'Not on file'} />
              <FactRow icon={<CalendarDays size={12} />} label="Applied" value={fmtDate(row.appliedAt) || 'Not on file'} />
              <FactRow
                icon={<Clock3 size={12} />}
                label="In stage"
                value={row.daysInStage != null ? `${row.daysInStage} day${row.daysInStage === 1 ? '' : 's'}` : 'Not on file'}
              />
              {tp?.years && <FactRow icon={<GraduationCap size={12} />} label="Years in care" value={tp.years} />}
              {tp && <FactRow icon={<ShieldCheck size={12} />} label="CJIS" value={tp.cjis || 'Not run'} />}
              {row.archived_reason && (
                <FactRow
                  icon={<Archive size={12} />}
                  label="Archived"
                  value={row.archived_reason + (row.archived_at ? ` — ${fmtDate(row.archived_at)}` : '')}
                />
              )}
            </dl>
            {tp?.cjis_report && (
              <button
                onClick={() => openFile({ title: `${name} — CJIS report`, url: tp.cjis_report, icon: 'shield' })}
                className="mt-3 text-[12.5px] font-semibold text-primary hover:underline"
              >
                Open the CJIS report
              </button>
            )}
            {resumeUrl && (
              <button
                onClick={viewResume}
                className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <FileText size={14} /> {row.resumeFileLabel || 'View résumé'}
              </button>
            )}
          </Card>
          {tp?.certifications && (
            <Card className="p-4">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Listed certifications</h3>
              <div className="flex flex-wrap gap-1.5">
                {tp.certifications.split(',').map((c) => c.trim()).filter(Boolean).map((c) => (
                  <span key={c} className="rounded-full bg-tint-blue px-2 py-0.5 text-[11px] font-semibold text-tint-fg-blue">{c}</span>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ── the record ── */}
        <div className="space-y-4">
          {/* THE ABSENCE IS WRITTEN — it has to be said on the profile: no
              Talent Pipeline record = say so, where
              the scores would have stood. */}
          {!tp && (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles size={14} className="text-text-3" />
                <h2 className="text-[13.5px] font-bold text-text-1">No Talent Pipeline score</h2>
              </div>
              <p className="text-[13px] leading-[1.6] text-text-2">
                {String(row.source || '').toLowerCase().includes('referral')
                  ? 'This person arrived by referral and was never on the Analysis board — there is no Talent Pipeline nota to show. Their record grows here instead: the résumé scorecard, the interview, the onboarding.'
                  : 'This person was never on the Talent Pipeline’s Analysis board — there is no nota to show. Their record grows here instead: the résumé scorecard, the interview, the onboarding.'}
              </p>
            </Card>
          )}
          {tp && (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles size={14} className="text-tint-fg-lavender" />
                <h2 className="text-[13.5px] font-bold text-text-1">The analysis wrote</h2>
              </div>
              {tp.summary ? (
                <p className="text-[13px] leading-[1.6] text-text-2">{tp.summary}</p>
              ) : (
                <p className="text-[13px] italic text-text-3">No résumé analysis on the migrated record for this person.</p>
              )}
            </Card>
          )}

          {tp && (tp.screen_result || tp.screen_date) && (
            <Card className="p-4">
              <h2 className="mb-2 text-[13.5px] font-bold text-text-1">Phone screen</h2>
              <dl className="space-y-1.5">
                <FactRow icon={<Phone size={12} />} label="Result" value={tp.screen_result || '—'} />
                {tp.screen_qualification && <FactRow icon={<ShieldCheck size={12} />} label="Qualification" value={tp.screen_qualification} />}
                {tp.screen_date && <FactRow icon={<CalendarDays size={12} />} label="Date" value={tp.screen_date} />}
                {/* the screener is a member of staff, not a field: their name
                    goes to the tracker like anybody else's */}
                {tp.screened_by && (
                  <FactRow
                    icon={<Mail size={12} />}
                    label="Screened by"
                    value={<DragPerson name={tp.screened_by} type="staff" subtitle="Ran the phone screen">{tp.screened_by}</DragPerson>}
                  />
                )}
              </dl>
            </Card>
          )}

          {/* The interview scorecard — the interviewer's pen, read-only here. A
              scheduled-but-unscored interview says so instead of hiding: an
              open scorecard is a fact of the record too. */}
          {interview && (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[13.5px] font-bold text-text-1">Interview</h2>
                {interview.score && (
                  <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold tabular-nums',
                    RECO_CHIP[interview.recommendation ?? ''] ?? 'bg-surface-2 text-text-3')}>
                    {interview.score}/10
                  </span>
                )}
              </div>
              {interview.score || interview.interviewer_name ? (
                <>
                  <dl className="space-y-1.5">
                    {interview.interviewer_name && (
                      <FactRow
                        icon={<UserRound size={12} />}
                        label="Interviewer"
                        value={<DragPerson name={interview.interviewer_name} type="staff" subtitle="Interviewed them">{interview.interviewer_name}</DragPerson>}
                      />
                    )}
                    {interview.recommendation && <FactRow icon={<ClipboardCheck size={12} />} label="Recommendation" value={interview.recommendation} />}
                    {interview.scheduled_for && <FactRow icon={<CalendarDays size={12} />} label="Scheduled for" value={fmtDate(interview.scheduled_for)} />}
                    {interview.interviewed_at && <FactRow icon={<Clock3 size={12} />} label="Interviewed at" value={fmtDate(interview.interviewed_at)} />}
                  </dl>
                  {interview.comments && (
                    <p className="mt-2.5 border-l-2 border-border pl-3 text-[12.5px] italic leading-[1.6] text-text-2">
                      “{interview.comments}”
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[12.5px] italic text-text-3">Scheduled — the scorecard is still open.</p>
              )}
            </Card>
          )}

          {/* The onboarding record — dates and house from the sheet, the two
              portal flags as the same dots the Documents list wears, and the
              Ready-to-Start approval stamp when a decider has signed it. */}
          {onboarding && (
            <Card className="p-4">
              <h2 className="mb-2 text-[13.5px] font-bold text-text-1">Onboarding</h2>
              <dl className="space-y-1.5">
                {onboarding.start_date && <FactRow icon={<CalendarDays size={12} />} label="Start date" value={fmtDate(onboarding.start_date)} />}
                {onboarding.earliest_start_date && <FactRow icon={<CalendarDays size={12} />} label="Earliest start" value={fmtDate(onboarding.earliest_start_date)} />}
                {onboarding.house && <FactRow icon={<Home size={12} />} label="House" value={onboarding.house} />}
                {onboarding.starting_status && <FactRow icon={<Signpost size={12} />} label="Status" value={onboarding.starting_status} />}
              </dl>
              <ul className="mt-2.5 space-y-2">
                <li className="flex items-center gap-2.5 text-[12.5px]">
                  <StatusDot status={onboarding.questionnaire_done ? 'done' : 'pending'} />
                  <span className="text-text-1">New Hire Questionnaire</span>
                </li>
                <li className="flex items-center gap-2.5 text-[12.5px]">
                  <StatusDot status={onboarding.tutorials_done ? 'done' : 'pending'} />
                  <span className="text-text-1">Tutorials</span>
                </li>
              </ul>
              {onboarding.notes && (
                <p className="mt-2.5 text-[12.5px] leading-[1.6] text-text-2">{onboarding.notes}</p>
              )}
              {onboarding.approved_ready_at && (
                <p className="mt-2.5 text-[12.5px] font-semibold text-tint-fg-mint">
                  Approved for Ready to Start — {fmtDate(onboarding.approved_ready_at)}
                  {/* the decider signed this — a template string cannot be
                      picked up, so the name is an element of its own */}
                  {onboarding.approved_ready_by ? (
                    <>
                      {' · by '}
                      <DragPerson name={onboarding.approved_ready_by} type="staff" subtitle="Approved Ready to Start">
                        {onboarding.approved_ready_by}
                      </DragPerson>
                    </>
                  ) : ''}
                </p>
              )}
            </Card>
          )}

          <Card className="p-4">
            <h2 className="mb-2 text-[13.5px] font-bold text-text-1">Documents</h2>
            {(row.checklist ?? []).length || row.packet?.label ? (
              <ul className="space-y-2">
                {(row.checklist ?? []).map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <StatusDot status={c.status} />
                    <span className={cn(c.status === 'missing' ? 'text-text-3' : 'text-text-1')}>{c.label}</span>
                  </li>
                ))}
                {row.packet?.label && (
                  <li className="flex items-center gap-2.5 text-[12.5px]">
                    <StatusDot status={row.packet.state === 'signed' || row.packet.state === 'waived' ? 'done' : 'pending'} />
                    <span className="text-text-1">{row.packet.label}</span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-[12.5px] italic text-text-3">No document checklist on this record yet.</p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-[13.5px] font-bold text-text-1">History &amp; evidence</h2>
            {timeline.length ? (
              <ul className="space-y-2">
                {timeline.map((t, i) => (
                  <li key={i} className="flex items-start gap-3 text-[12.5px]">
                    <span className="w-[84px] shrink-0 text-text-3">{t.time}</span>
                    <span className="min-w-0 flex-1 break-words text-text-1">{t.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] italic text-text-3">Nothing on the timeline yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
