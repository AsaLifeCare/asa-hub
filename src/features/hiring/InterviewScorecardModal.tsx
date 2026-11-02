// In-person interview scorecard — what the INTERVIEWER fills in on the day.
// Opened from the candidate drawer while the candidate sits at the interview stage.
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { CalendarClock, Star } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { gasAction } from '@/features/hiring/shared'
import { ohioWall } from '@/lib/ohio'
import DragPerson from '@/components/shared/DragPerson'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type InterviewState = {
  exists: boolean
  candidate_name?: string
  scheduled_for?: string
  status?: string
  interviewer_name?: string
  score?: string
  comments?: string
  recommendation?: string
  can_record?: boolean
  /** access window (configurable per candidate / workspace — see Interview.gs) */
  window_open?: boolean
  window_from?: string
  window_until?: string
  window_reason?: string
  /** true only for the day-of interviewer account */
  window_applies?: boolean
  /** recruiters may widen the window from here */
  can_extend?: boolean
}

// The access window's edges, as OHIO days.
const day = (iso?: string) => {
  const d = iso ? ohioWall(iso) : null
  return d ? format(d, 'yyyy-MM-dd') : ''
}

// When the interview is booked for, in the reader's language but on the company's clock.
const schedStamp = (v?: string) => {
  const raw = String(v ?? '').trim()
  if (!raw) return ''
  const d = ohioWall(raw)
  return d ? format(d, "MMM d, yyyy 'at' h:mm a") : raw
}

// The relay's "still running" envelope: the scorecard reached the platform and its answer did not come back inside…
const accepted = (d: any) => d && typeof d === 'object' && d.accepted === true

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const RECOMMENDATIONS = [
  { value: 'Advance', label: 'Advance', hint: 'Ready for onboarding' },
  { value: 'Hold', label: 'Hold', hint: 'Undecided — needs a second look' },
  { value: 'Decline', label: 'Decline', hint: 'Not moving forward' },
] as const

export default function InterviewScorecardModal({
  open,
  onOpenChange,
  candidateId,
  candidateName,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidateId: string
  candidateName: string
  // `pending` is set when the platform had not answered yet: nothing is known to be written, so a screen re-reads…
  onSaved?: (res: { declined: boolean; advanced?: boolean; gate_passed: boolean; recommendation: string; pending?: boolean }) => void
}) {
  const me = useAuthStore((s) => s.user)
  const [state, setState] = useState<InterviewState | null>(null)
  const [name, setName] = useState('')
  const [score, setScore] = useState('')
  const [comments, setComments] = useState('')
  const [recommendation, setRecommendation] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [extending, setExtending] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    setState(null)
    gasAction<InterviewState>('interviewGet', { candidate_id: candidateId })
      .then((res) => {
        if (!alive) return
        setState(res)
        setName(res.interviewer_name || me?.name || '')
        setScore(res.score ?? '')
        setComments(res.comments ?? '')
        setRecommendation(res.recommendation ?? '')
      })
      .catch(() => {
        if (alive) setState({ exists: false, can_record: true })
      })
    return () => {
      alive = false
    }
  }, [open, candidateId, me?.name])

  const submit = async () => {
    if (!name.trim()) {
      toast({ type: 'warning', title: 'Your name is required', body: 'The scorecard is signed by whoever ran the interview.' })
      return
    }
    const n = Number(score)
    if (score === '' || Number.isNaN(n) || n < 0 || n > 10) {
      toast({ type: 'warning', title: 'Score 0–10', body: 'Give the interview a score between 0 and 10.' })
      return
    }
    if (comments.trim().length < 10) {
      toast({ type: 'warning', title: 'Add your comments', body: 'Write a few words about how the interview went.' })
      return
    }
    if (!recommendation) {
      toast({ type: 'warning', title: 'Pick a recommendation', body: 'Advance, Hold or Decline.' })
      return
    }
    setSaving(true)
    try {
      const res = await gasAction<{ declined: boolean; advanced?: boolean; gate_passed: boolean }>('interviewSave', {
        candidate_id: candidateId,
        interviewer_name: name.trim(),
        score: n,
        comments: comments.trim(),
        recommendation,
      })
      if (accepted(res)) {
        // STILL RUNNING, NOT SAVED.
        toast({ type: 'info', title: 'Scorecard sent — still being recorded',
                body: `${candidateName}: the platform has not answered yet. The card shows the ${recommendation} ` +
                      'once it lands — if it does not, sign it again.' })
        onSaved?.({ declined: false, advanced: false, gate_passed: false, recommendation, pending: true })
        onOpenChange(false)
        return
      }
      toast(
        res.declined
          ? { type: 'info', title: `${candidateName} declined`, body: 'Moved to Not Hiring — off the board.' }
          : {
              type: 'success',
              title: 'Scorecard recorded',
              body: res.advanced
                ? // a positive ends the stage on its own
                  `${candidateName} moved to Onboarding.`
                : res.gate_passed
                  ? 'Onboarding is unlocked for this candidate.'
                  : `Saved as ${recommendation} — onboarding stays locked.`,
            },
      )
      onSaved?.({ declined: res.declined, advanced: res.advanced, gate_passed: res.gate_passed, recommendation })
      onOpenChange(false)
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save the scorecard', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  const readOnly = state?.can_record === false
  const windowClosed = state?.window_applies === true && state?.window_open === false

  // Move one edge of the window: 'later' pushes the end out, 'earlier' pulls the start back (the interview was…
  const moveWindow = async (edge: 'earlier' | 'later', days: number) => {
    setExtending(true)
    try {
      const res = await gasAction<{ window_open?: boolean; window_from?: string; window_until?: string }>(
        'interviewSetWindow',
        edge === 'later'
          ? { candidate_id: candidateId, extend_days: days }
          : { candidate_id: candidateId, open_earlier_days: days },
      )
      if (accepted(res)) {
        // Accepted-envelope — the change landed but the receipt has no dates; re-read the row instead (reads return…
        toast({
          type: 'success',
          title: edge === 'later' ? `Window extended by ${days}d` : `Window opened ${days}d earlier`,
          body: 'Applied — refreshing interviewer access.',
        })
        void gasAction<InterviewState>('interviewGet', { candidate_id: candidateId })
          .then((fresh) => setState(fresh))
          .catch(() => {})
        return
      }
      setState((s0) =>
        s0
          ? {
              ...s0,
              window_open: res.window_open ?? s0.window_open,
              window_from: res.window_from ?? s0.window_from,
              window_until: res.window_until ?? s0.window_until,
            }
          : s0,
      )
      toast({
        type: 'success',
        title: edge === 'later' ? `Window extended by ${days}d` : `Window opened ${days}d earlier`,
        body: `Interviewer access: ${day(res.window_from)} → ${day(res.window_until)}.`,
      })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not change the window', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setExtending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onOpenChange(false)}>
      <DialogContent className="bg-surface sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">
            In-person interview —{' '}
            <DragPerson name={candidateName} id={candidateId}>
              {candidateName}
            </DragPerson>
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            {state?.scheduled_for
              ? `Scheduled for ${schedStamp(state.scheduled_for)}. `
              : ''}
            Record how it went. Onboarding only unlocks with a scorecard and an Advance.
          </DialogDescription>
        </DialogHeader>

        {state?.scheduled_for && (
          <p className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-[12.5px] font-medium text-text-2">
            <CalendarClock size={14} className="shrink-0 text-text-3" />
            {schedStamp(state.scheduled_for)}
            {state.status ? ` · ${state.status}` : ''}
          </p>
        )}

        {/* Access window — the day-of account records inside it; the
            recruiter widens it right here, per candidate. */}
        {state && (state.window_from || state.window_until) && (
          <div
            className={cn(
              'rounded-md px-3 py-2 text-[12.5px]',
              windowClosed ? 'bg-tint-amber text-tint-fg-amber' : 'bg-surface-2 text-text-2',
            )}
          >
            <p className="font-medium">
              Interviewer access: {day(state.window_from)} → {day(state.window_until)}
              {windowClosed ? ` · ${state.window_reason === 'not open yet' ? 'not open yet' : 'closed'}` : ''}
            </p>
            {state.can_extend && (
              <div className="mt-1.5 grid gap-1.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="w-[86px] shrink-0 text-[11px] opacity-80">Open earlier</span>
                  {[1, 3, 7, 30].map((d) => (
                    <button
                      key={`b${d}`}
                      type="button"
                      disabled={extending}
                      onClick={() => void moveWindow('earlier', d)}
                      className="rounded-sm border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
                    >
                      −{d}d
                    </button>
                  ))}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="w-[86px] shrink-0 text-[11px] opacity-80">Extend later</span>
                  {[1, 3, 7, 30].map((d) => (
                    <button
                      key={`f${d}`}
                      type="button"
                      disabled={extending}
                      onClick={() => void moveWindow('later', d)}
                      className="rounded-sm border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
                    >
                      +{d}d
                    </button>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="scroll-thin grid max-h-[54vh] gap-3 overflow-y-auto pr-1">
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">
              Interviewer <span className="text-danger">*</span>
            </span>
            <input
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className={inputCls}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-2">
              <Star size={12} className="text-text-3" /> Score (0–10) <span className="text-danger">*</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 11 }, (_, i) => String(i)).map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={readOnly}
                  onClick={() => setScore(n)}
                  aria-pressed={score === n}
                  className={cn(
                    'h-8 w-8 rounded-md border text-[12.5px] font-semibold transition-colors',
                    score === n
                      ? 'border-primary bg-primary-soft text-primary-strong'
                      : 'border-border text-text-2 hover:bg-surface-2',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </label>

          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">
              Comments <span className="text-danger">*</span>
            </span>
            <textarea
              value={comments}
              disabled={readOnly}
              onChange={(e) => setComments(e.target.value)}
              rows={5}
              placeholder="How did the interview go? Strengths, concerns, anything the hiring team should know."
              className={cn(inputCls, 'h-auto py-2')}
            />
          </label>

          <div className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">
              Recommendation <span className="text-danger">*</span>
            </span>
            <div className="grid gap-1.5">
              {RECOMMENDATIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  disabled={readOnly}
                  onClick={() => setRecommendation(r.value)}
                  aria-pressed={recommendation === r.value}
                  className={cn(
                    'flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors',
                    recommendation === r.value
                      ? 'border-primary bg-primary-soft'
                      : 'border-border hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cn(
                      'text-[13px] font-semibold',
                      r.value === 'Decline' ? 'text-danger' : 'text-text-1',
                    )}
                  >
                    {r.label}
                  </span>
                  <span className="text-[11px] text-text-3">{r.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Close
          </button>
          {!readOnly && (
            <button
              onClick={() => void submit()}
              disabled={saving}
              className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save scorecard'}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
