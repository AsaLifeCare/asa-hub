// PHONE SCREENING form — filled LIVE by the recruiter while on the call.
// On open it loads the candidate's existing screening row via gasAction('screenGet', …) and prefills; [Save]…
import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import SafeImg from '@/components/shared/SafeImg'
import DragPerson from '@/components/shared/DragPerson'
import { toast } from '@/stores/useToastStore'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { noteWrite, readSlice } from '@/lib/snapshotClient'
import { gasAction, inputCls } from './shared'
import { ohioToday } from '@/lib/ohio'

/** Work-engine vocabulary — exact values, never relabeled. */
const SCREEN_STATUSES = ['Completed', 'No Answer', 'Voicemail', 'Declined'] as const

type FormState = {
  screen_date: string
  screen_status: string
  notes: string
  shift_day: string
  shift_afternoon: string
  shift_night: string
  hours_prn: string
  hours_pt: string
  hours_ft: string
  current_rate: string
  cert_dodd: string
  cert_cpr_first_aid: string
  cert_med_del: string
  has_dl: string
  has_vehicle: string
  has_insurance: string
  behavioral_care: string
  every_other_weekend: string
  male_care: string
  background_disclosure: string
  best_in_person_day_time: string
}

type Analysis = {
  score?: number
  qualification?: string
  summary?: string
  concerns?: string[]
  report_url?: string
}

const today = () => ohioToday()

// Write-ledger envelope from the /gas relay — the write IS saved (queued or executed with the receipt lost), but…
const accepted = (d: any) => d && typeof d === 'object' && d.accepted === true

const emptyForm = (): FormState => ({
  screen_date: today(),
  screen_status: 'Completed',
  notes: '',
  shift_day: '',
  shift_afternoon: '',
  shift_night: '',
  hours_prn: '',
  hours_pt: '',
  hours_ft: '',
  current_rate: '',
  cert_dodd: '',
  cert_cpr_first_aid: '',
  cert_med_del: '',
  has_dl: '',
  has_vehicle: '',
  has_insurance: '',
  behavioral_care: '',
  every_other_weekend: '',
  male_care: '',
  background_disclosure: '',
  best_in_person_day_time: '',
})

const QUAL_CLS: Record<string, string> = {
  Qualified: 'bg-tint-mint text-tint-fg-mint',
  Borderline: 'bg-tint-amber text-tint-fg-amber',
  'Not Qualified': 'bg-tint-pink text-tint-fg-pink',
}

/** Compact three-state segmented control: — / Yes / No ('' | 'Y' | 'N'). */
const YN_OPTS = [
  ['', '—'],
  ['Y', 'Yes'],
  ['N', 'No'],
] as const

function YNField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-surface-2/40 p-2">
      <span className="clamp-1 text-[11px] font-medium text-text-2">{label}</span>
      <div className="flex overflow-hidden rounded-sm border border-border">
        {YN_OPTS.map(([v, lab]) => (
          <button
            key={lab}
            type="button"
            disabled={disabled}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'h-6 flex-1 text-[11px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
              value === v
                ? v === 'Y'
                  ? 'bg-tint-mint text-tint-fg-mint'
                  : v === 'N'
                    ? 'bg-tint-pink text-tint-fg-pink'
                    : 'bg-surface-2 text-text-1'
                : 'bg-surface text-text-3 hover:bg-surface-2',
            )}
          >
            {lab}
          </button>
        ))}
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, caption, children }: { label: string; caption?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12px] font-medium text-text-2">{label}</span>
      {children}
      {caption && <span className="text-[11px] leading-4 text-text-3">{caption}</span>}
    </label>
  )
}

export default function ScreenFormModal({
  open,
  onOpenChange,
  candidate,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidate: any | null
  onSaved: (patch: {
    screenStatus: string
    bestDay: string
    hasReport: boolean
    qualification?: string
    score?: number
  }) => void
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [hasReport, setHasReport] = useState(false)
  // Whether the person typed since the modal opened — the line between a prefill the live answer may overwrite and…
  const editedRef = useRef(false)

  const busy = loading || saving || analyzing
  const set = (k: keyof FormState, v: string) => {
    editedRef.current = true
    setForm((s) => ({ ...s, [k]: v }))
    setApiError(null)
  }

  // ON OPEN: prefill INSTANTLY from the phoneScreens slice (the same row the builder mirrors), then let the live…
  useEffect(() => {
    if (!open || !candidate) return
    let alive = true
    editedRef.current = false
    setLoading(true)
    setApiError(null)
    setAnalysis(null)
    setHasReport(false)
    setForm(emptyForm())

    const hydrate = (s: Record<string, string>, overwrite: boolean) => {
      setForm((base) => {
        const next = { ...base }
        ;(Object.keys(base) as (keyof FormState)[]).forEach((k) => {
          if (s[k] != null && String(s[k]) !== '' && (overwrite || next[k] === '' ||
              (k === 'screen_date' && next[k] === today()) ||
              (k === 'screen_status' && next[k] === 'Completed'))) {
            next[k] = String(s[k])
          }
        })
        return next
      })
      const url = s.phone_screen_report_url || ''
      if (url) setHasReport(true)
      // Last saved analysis (screenGet has no summary/concerns — chips only).
      const score = Number(s.screen_score)
      if (s.qualification || url || s.screen_score) {
        setAnalysis({
          score: Number.isFinite(score) && s.screen_score !== '' ? score : undefined,
          qualification: s.qualification || undefined,
          report_url: url || undefined,
        })
      }
    }

    void readSlice<Record<string, string>>('phoneScreens')
      .then((rows) => {
        if (!alive || !rows) return
        const mine = rows.filter((r) => String(r.candidate_id ?? '') === String(candidate.id))
        const last = mine[mine.length - 1]
        if (!last || editedRef.current) return
        hydrate(last, false)   // fill blanks: never beat the live answer to a fight
        setLoading(false)      // the form is usable NOW
      })
      .catch(() => { /* no slice → the live read below carries the open alone */ })

    gasAction<{ exists: boolean; screen?: Record<string, string> }>('screenGet', { candidate_id: candidate.id })
      .then((res) => {
        if (!alive || !res.exists || !res.screen) return
        hydrate(res.screen, !editedRef.current)
      })
      .catch((err) => {
        if (alive) setApiError(err instanceof Error ? err.message : 'Could not load the screening.')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidate?.id])

  const close = (o: boolean) => {
    if (!o) {
      setForm(emptyForm())
      setApiError(null)
      setAnalysis(null)
    }
    onOpenChange(o)
  }

  /** screenSave with all fields → gate-progress toast + onSaved. Returns success. */
  const doSave = async (): Promise<boolean> => {
    if (!candidate) return false
    setSaving(true)
    setApiError(null)
    try {
      const fields: Record<string, string> = {}
      ;(Object.keys(form) as (keyof FormState)[]).forEach((k) => {
        fields[k] = form[k].trim()
      })
      const res = await gasAction<{ saved: boolean; gate_passed: boolean; missing: string[] }>('screenSave', {
        candidate_id: candidate.id,
        ...fields,
      })
      toast({
        type: 'success',
        title: 'Screening saved',
        // Accepted-envelope carries no gate receipt — reopening shows the truth.
        body: accepted(res)
          ? undefined
          : res.gate_passed
            ? 'Stage gate passed — move unlocked.'
            : res.missing?.length
              ? `Gate progress — still missing: ${res.missing.join(', ')}`
              : undefined,
      })
      onSaved({ screenStatus: form.screen_status, bestDay: form.best_in_person_day_time.trim(), hasReport })
      noteWrite('phoneScreens')   // the prefill slice follows the save
      return true
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Could not save the screening. Please try again.')
      return false
    } finally {
      setSaving(false)
    }
  }

  /** Save, then run the AI analysis and render the result panel. */
  const saveAndAnalyze = async () => {
    if (!candidate || !(await doSave())) return
    setAnalyzing(true)
    setApiError(null)
    try {
      const res = await gasAction<{
        score: number
        qualification: string
        summary: string
        concerns: string[]
        report_url: string
      }>('screenAnalyze', { candidate_id: candidate.id })
      if (accepted(res)) {
        // Accepted-envelope — the analysis is queued; reopen later for the result.
        toast({ type: 'info', title: 'Analysis queued', body: 'Processing — reopen the screening shortly for the result.' })
        onSaved({ screenStatus: form.screen_status, bestDay: form.best_in_person_day_time.trim(), hasReport })
        return
      }
      setAnalysis(res)
      const rep = Boolean(res.report_url) || hasReport
      setHasReport(rep)
      toast({ type: 'success', title: 'AI analysis complete', body: `${res.qualification} · ${res.score}/10` })
      onSaved({
        screenStatus: form.screen_status,
        bestDay: form.best_in_person_day_time.trim(),
        hasReport: rep,
        qualification: res.qualification,
        score: res.score,
      })
      noteWrite('phoneScreens')   // score/report columns changed under the slice
    } catch (err) {
      // Inline — the OPENAI_API_KEY / "no screening saved" messages must be readable.
      setApiError(err instanceof Error ? err.message : 'Analysis failed. Please try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-surface sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DragPerson
              name={candidate?.name ?? ''}
              id={candidate?.id}
              avatar={candidate?.avatar}
              subtitle={candidate?.role}
              className="shrink-0"
            >
              <SafeImg src={candidate?.avatar} name={candidate?.name} size={40} shape="round" />
            </DragPerson>
            <div className="min-w-0 text-left">
              <DialogTitle className="font-display text-[18px] font-bold text-text-1">Phone screening</DialogTitle>
              <DragPerson
                name={candidate?.name ?? ''}
                id={candidate?.id}
                avatar={candidate?.avatar}
                subtitle={candidate?.role}
                className="block"
              >
                <p className="clamp-1 text-[12px] font-medium text-text-3">
                  {candidate?.name ?? 'Candidate'}
                  {candidate?.role ? ` · ${candidate.role}` : ''}
                </p>
              </DragPerson>
            </div>
          </div>
          <DialogDescription className="text-[13px] text-text-2">
            Fill it live during the call — answers land in the Hub sheet. The AI only runs the analysis afterwards.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center justify-center gap-2 py-10 text-[13px] font-medium text-text-3">
            <AppIcon name="loader-circle" size={16} className="animate-spin" />
            Loading screening…
          </p>
        ) : (
          <div className="grid gap-4">
            <Group title="Call">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Screen date">
                  <input
                    type="date"
                    value={form.screen_date}
                    onChange={(e) => set('screen_date', e.target.value)}
                    disabled={busy}
                    className={cn(inputCls, 'disabled:opacity-50')}
                  />
                </Field>
                <Field label="Call status" caption="Completed unlocks the stage gate.">
                  <select
                    value={form.screen_status}
                    onChange={(e) => set('screen_status', e.target.value)}
                    disabled={busy}
                    className={cn(inputCls, 'disabled:opacity-50')}
                  >
                    {SCREEN_STATUSES.map((s) => (
                      <option key={s} value={s} className="text-text-1">
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  disabled={busy}
                  placeholder="What the candidate said, in their words…"
                  className={cn(inputCls, 'h-auto min-h-[72px] py-2 disabled:opacity-50')}
                />
              </Field>
            </Group>

            <Group title="Availability">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <YNField label="Day shift" value={form.shift_day} onChange={(v) => set('shift_day', v)} disabled={busy} />
                <YNField label="Afternoon shift" value={form.shift_afternoon} onChange={(v) => set('shift_afternoon', v)} disabled={busy} />
                <YNField label="Night shift" value={form.shift_night} onChange={(v) => set('shift_night', v)} disabled={busy} />
                <YNField label="PRN" value={form.hours_prn} onChange={(v) => set('hours_prn', v)} disabled={busy} />
                <YNField label="Part-time" value={form.hours_pt} onChange={(v) => set('hours_pt', v)} disabled={busy} />
                <YNField label="Full-time" value={form.hours_ft} onChange={(v) => set('hours_ft', v)} disabled={busy} />
              </div>
              <Field label="Current rate">
                <input
                  value={form.current_rate}
                  onChange={(e) => set('current_rate', e.target.value)}
                  disabled={busy}
                  placeholder="$16/h"
                  className={cn(inputCls, 'disabled:opacity-50')}
                />
              </Field>
            </Group>

            <Group title="Certifications">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <YNField label="DODD" value={form.cert_dodd} onChange={(v) => set('cert_dodd', v)} disabled={busy} />
                <YNField label="CPR / First Aid" value={form.cert_cpr_first_aid} onChange={(v) => set('cert_cpr_first_aid', v)} disabled={busy} />
                <YNField label="Med delegation" value={form.cert_med_del} onChange={(v) => set('cert_med_del', v)} disabled={busy} />
              </div>
            </Group>

            <Group title="Logistics">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <YNField label="Driver's license" value={form.has_dl} onChange={(v) => set('has_dl', v)} disabled={busy} />
                <YNField label="Vehicle" value={form.has_vehicle} onChange={(v) => set('has_vehicle', v)} disabled={busy} />
                <YNField label="Insurance" value={form.has_insurance} onChange={(v) => set('has_insurance', v)} disabled={busy} />
              </div>
            </Group>

            <Group title="Care preferences">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <YNField label="Behavioral care" value={form.behavioral_care} onChange={(v) => set('behavioral_care', v)} disabled={busy} />
                <YNField label="Every other weekend" value={form.every_other_weekend} onChange={(v) => set('every_other_weekend', v)} disabled={busy} />
                <YNField label="Male care" value={form.male_care} onChange={(v) => set('male_care', v)} disabled={busy} />
              </div>
            </Group>

            <Group title="Wrap-up">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Background disclosure">
                  <input
                    value={form.background_disclosure}
                    onChange={(e) => set('background_disclosure', e.target.value)}
                    disabled={busy}
                    placeholder="Anything disclosed on the call"
                    className={cn(inputCls, 'disabled:opacity-50')}
                  />
                </Field>
                <Field
                  label="Best in-person day/time"
                  caption="The checklist's Date accepted goes green when set."
                >
                  <input
                    value={form.best_in_person_day_time}
                    onChange={(e) => set('best_in_person_day_time', e.target.value)}
                    disabled={busy}
                    placeholder="2026-08-04 14:00"
                    className={cn(inputCls, 'disabled:opacity-50')}
                  />
                </Field>
              </div>
            </Group>

            {analysis && (
              <div className="grid gap-2 rounded-lg border border-border bg-surface-2/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                    AI analysis
                  </span>
                  {typeof analysis.score === 'number' && (
                    <span className="rounded-sm border border-border bg-surface px-2 py-0.5 text-[12px] font-bold tabular-nums text-text-1">
                      {analysis.score}/10
                    </span>
                  )}
                  {analysis.qualification && (
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                        QUAL_CLS[analysis.qualification] ?? 'bg-surface-2 text-text-2',
                      )}
                    >
                      {analysis.qualification}
                    </span>
                  )}
                  {analysis.report_url && (
                    <a
                      href={analysis.report_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                    >
                      <AppIcon name="external-link" size={13} />
                      Open report
                    </a>
                  )}
                </div>
                {analysis.summary && <p className="text-[13px] leading-5 text-text-1">{analysis.summary}</p>}
                {analysis.concerns && analysis.concerns.length > 0 && (
                  <ul className="grid gap-1">
                    {analysis.concerns.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12px] text-text-2">
                        <AppIcon name="circle-alert" size={13} className="mt-[2px] shrink-0 text-tint-fg-amber" />
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {apiError && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-md bg-tint-pink px-3 py-2 text-[12px] font-medium text-tint-fg-pink"
          >
            <AppIcon name="circle-alert" size={14} className="mt-[1px] shrink-0" />
            {apiError}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => close(false)}
            disabled={saving || analyzing}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={doSave}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="save" size={15} />
            {saving && !analyzing ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={saveAndAnalyze}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparkles" size={15} />
            {analyzing ? 'Analyzing…' : 'Save & run AI analysis'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
