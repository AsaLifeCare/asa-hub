// Med Delegation — the five-phase renewal, one card per person.
// MedDel.gs has run the engine unattended for months (daily sweep, SMS chase, MAIS scrape) and nobody could see a…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import Avatar from '@/components/shared/Avatar'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { readSlice } from '@/lib/snapshotClient'
import { askPrompt } from '@/stores/useDialogStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type Flow = {
  id: string
  employeeId: string
  employeeName: string
  medLevel: string
  certExpDate: string
  phone: string
  email: string
  phase: string
  overallStatus: string
  newExpDate?: string
  cancelReason?: string
  notes?: string
  phase4ScheduledDate?: string
  skillsDoneDate?: string
  // the GAS answer's shape is { label, when, waiting } — `due` never existed, so the date half had silently never…
  nextStep?: { label?: string; when?: string; waiting?: string; kind?: string } | string
}
// WHERE THE LANE'S SETTINGS CAME FROM ON THIS ANSWER.
type CatalogueState = {
  ok?: boolean
  why?: string
  source?: string
  groups?: { settings?: string; levels?: string; statuses?: string }
  refused?: string[]
  levels?: string[]
}
type Flows = {
  flows: Flow[]
  counts: { active?: number; complete?: number; cancelled?: number; byPhase?: Record<string, number> }
  catalogue?: CatalogueState
}

const STATUS_TINT: Record<string, string> = {
  active: 'bg-tint-blue text-tint-fg-blue',
  complete: 'bg-tint-mint text-tint-fg-mint',
  cancelled: 'bg-surface-2 text-text-3',
}

/** The five phases, in the engine's own order. */
const PHASE_LABEL: Record<string, string> = {
  '1': '1 · Application',
  '2': '2 · Application received',
  '3': '3 · Relias training',
  '4': '4 · Skills day',
  '5': '5 · MAIS check',
}

/** What a person can record at each phase — the engine validates anyway. */
const MILESTONES: { id: string; label: string; phase: string; needsDate?: boolean }[] = [
  { id: 'application_received', label: 'Application received', phase: '2' },
  { id: 'training_complete', label: 'Training complete', phase: '3' },
  { id: 'skills_scheduled', label: 'Skills scheduled', phase: '4', needsDate: true },
  { id: 'skills_done', label: 'Skills done', phase: '4', needsDate: true },
]

function nextStepText(n: Flow['nextStep']): string {
  if (!n) return ''
  if (typeof n === 'string') return n
  return [n.label, n.when].filter(Boolean).join(' · ')
}

/** The slice's raw meddel_flows row — header-keyed, everything text. */
type RawFlow = Record<string, string>

// Fold raw rows into the Flows shape the page draws — the SAME counts and sort the GAS answer computes, minus…
function flowsFromRaw(rows: RawFlow[]): Flows {
  const counts: Flows['counts'] = { active: 0, complete: 0, cancelled: 0, byPhase: {} }
  for (const r of rows) {
    const st = String(r.overallStatus || 'active')
    ;(counts as Record<string, unknown>)[st] = (Number((counts as Record<string, unknown>)[st]) || 0) + 1
    if (st === 'active') {
      const p = String(r.phase || '')
      counts.byPhase![p] = (counts.byPhase![p] ?? 0) + 1
    }
  }
  const flows = rows.map((r) => ({ ...(r as unknown as Flow), nextStep: undefined }))
  // active first, soonest expiration first — certExpDate is yyyy-MM-dd text, so the lexical sort IS the date sort…
  flows.sort((a, b) => {
    if ((a.overallStatus === 'active') !== (b.overallStatus === 'active')) {
      return a.overallStatus === 'active' ? -1 : 1
    }
    return String(a.certExpDate || '').localeCompare(String(b.certExpDate || ''))
  })
  return { flows, counts }
}

export default function MedDelPage() {
  // ONE READ, THEN THE TABS ARE FREE.
  const [data, setData] = useState<Flows | null>(() => {
    try {
      const kept = JSON.parse(localStorage.getItem('asa:meddel:flows') || 'null') as Flows | null
      // THE CATALOGUE NOTICE NEVER COMES OUT OF A KEPT COPY.
      return kept ? { ...kept, catalogue: undefined } : null
    } catch { return null }
  })
  const [status, setStatus] = useState('active')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [acting, setActing] = useState<string | null>(null)

  // Truth order: live answer > slice > kept copy.
  const liveLandedRef = useRef(false)
  const load = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const d = await gasAction<Flows>('medDelFlows', {})
      liveLandedRef.current = true
      setData(d)
      try { localStorage.setItem('asa:meddel:flows', JSON.stringify(d)) } catch { /* quota — the read still painted */ }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the delegation flows.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // SLICE-FIRST PAINT: the raw meddel_flows mirror paints the board in milliseconds; "Next:" stays blank until…
    void readSlice<RawFlow>('medDelFlowsRaw').then((rows) => {
      if (!rows || liveLandedRef.current) return
      setData(flowsFromRaw(rows))
    }).catch(() => { /* the kept copy or the live read stands */ })
  }, [load])

  const shown = useMemo(
    () => (data?.flows ?? []).filter((f) => (f.overallStatus || 'active').toLowerCase() === status),
    [data, status],
  )

  const advance = async (flow: Flow, milestone: { id: string; label: string; needsDate?: boolean }) => {
    let date = ''
    if (milestone.needsDate) {
      // Typed, never derived from a clock: the date being recorded is the one that happened, not the one this…
      const typed = await askPrompt({
        title: `${milestone.label} — ${flow.employeeName}`,
        body: 'The date it happened. The sweep decides what happens next.',
        label: 'Date',
        inputType: 'date',
        required: true,
        confirmLabel: 'Record',
      })
      if (typed === null || !typed.trim()) return
      date = typed
    }
    setActing(flow.id)
    try {
      await gasAction('medDelAdvance', { flowId: flow.id, milestone: milestone.id, date: date.trim() })
      toast({ type: 'success', title: `${flow.employeeName} — ${milestone.label}`, body: 'Recorded. The sweep decides what happens next.' })
      await load()
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setActing(null)
    }
  }

  const cancel = async (flow: Flow) => {
    const reason = await askPrompt({
      title: `Cancel ${flow.employeeName}'s delegation?`,
      body: 'The renewal stops here and the reason is saved with the flow.',
      label: 'Reason',
      placeholder: 'Why this renewal is stopping',
      required: true,
      multiline: true,
      tone: 'danger',
      confirmLabel: 'Cancel the delegation',
      cancelLabel: 'Keep the flow',
    })
    if (reason === null || !reason.trim()) return
    setActing(flow.id)
    try {
      await gasAction('medDelCancel', { flowId: flow.id, reason: reason.trim() })
      toast({ type: 'success', title: 'Cancelled', body: `${flow.employeeName}: ${reason.trim()}` })
      await load()
    } catch (e) {
      toast({ type: 'danger', title: 'Not cancelled', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setActing(null)
    }
  }

  const counts = data?.counts ?? {}
  const catalogue = data?.catalogue

  return (
    <div className="w-full">
      <PageHeader
        title="Med Delegation"
        subtitle="Five phases from application to a renewed certification — the engine chases, a person decides"
        actions={
          <div className="flex items-center gap-2">
            {/* THE QUEUE SEEDS ITSELF FROM THE MASTER: one flow
                per person and level inside the renewal window; the duplicate
                guard makes a re-press fill gaps, never double. */}
            <button
              onClick={async () => {
                try {
                  const d = await gasAction<{ started: number; already_active: number; outside_window: number; no_dates: number }>('medDelSeed', {})
                  toast({ type: 'success', title: `${d.started} flow(s) started`,
                          body: `${d.already_active} already active · ${d.outside_window} outside the window · ${d.no_dates} with no date on the Master.` })
                  void load()
                } catch (e) {
                  toast({ type: 'danger', title: 'The seed refused', body: e instanceof Error ? e.message : 'Try again.' })
                }
              }}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              Seed from the Master
            </button>
            <button
              onClick={() => void load()}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} /> Refresh
            </button>
          </div>
        }
      />

      <div className="mt-4">
        <SegmentedTabs
          tabs={[
            { id: 'active', label: `Active${counts.active != null ? ` · ${counts.active}` : ''}` },
            { id: 'complete', label: `Complete${counts.complete != null ? ` · ${counts.complete}` : ''}` },
            { id: 'cancelled', label: `Cancelled${counts.cancelled != null ? ` · ${counts.cancelled}` : ''}` },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>

      {err && (
        <div className="mt-4 rounded-md border border-tint-pink bg-tint-pink/40 px-3 py-2.5 text-[13px] leading-5 text-tint-fg-pink">{err}</div>
      )}

      {/* Only the LIVE answer carries this; the slice and the kept copy say
          nothing about it, and silence is never read as a failure. */}
      {catalogue && catalogue.ok === false && (
        <div className="mt-4 rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2.5 text-[13px] leading-5 text-tint-fg-amber">
          <span className="font-semibold">The Med Del settings sheet could not be read.</span>{' '}
          The renewals are still running on the levels, statuses and timings the platform shipped
          with — nothing was skipped and no flow was cancelled — but an edit in the sheet will not
          reach them until it can be read again.
          {catalogue.why ? <span className="mt-1 block text-[12px] opacity-80">{catalogue.why}</span> : null}
        </div>
      )}
      {catalogue && catalogue.ok !== false && !!catalogue.refused?.length && (
        <div className="mt-4 rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2.5 text-[13px] leading-5 text-tint-fg-amber">
          <span className="font-semibold">Some rows of the Med Del settings sheet were refused.</span>
          <ul className="mt-1 list-disc pl-5 text-[12px] opacity-90">
            {catalogue.refused.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}

      {status === 'active' && counts.byPhase && Object.keys(counts.byPhase).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(counts.byPhase).map(([p, n]) => (
            <span key={p} className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-2">
              {PHASE_LABEL[p] ?? `Phase ${p}`}: {n}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {!busy && data && !shown.length && (
          <EmptyState title="No flows here" body="Nothing is at this status right now." />
        )}

        {shown.map((f) => (
          <Card key={f.id}>
            <div className="flex flex-wrap items-start gap-3">
              <DragPerson name={f.employeeName} id={f.employeeId} subtitle={f.medLevel || undefined} className="shrink-0">
                <Avatar src="" name={f.employeeName} size="md" />
              </DragPerson>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <DragPerson name={f.employeeName} id={f.employeeId} subtitle={f.medLevel || undefined}>
                    <span className="text-[14px] font-semibold text-text-1">{f.employeeName}</span>
                  </DragPerson>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', STATUS_TINT[f.overallStatus] ?? 'bg-surface-2 text-text-3')}>
                    {f.overallStatus}
                  </span>
                  <span className="rounded-full bg-tint-lavender px-2 py-0.5 text-[10px] font-bold uppercase text-tint-fg-lavender">
                    {PHASE_LABEL[f.phase] ?? `Phase ${f.phase}`}
                  </span>
                  {f.medLevel && <span className="text-[11.5px] text-text-3">{f.medLevel}</span>}
                </span>
                <span className="mt-1 block text-[12px] text-text-3">
                  {/* Straight from the sheet — never re-parsed into a Date. */}
                  {f.certExpDate ? `Expires ${f.certExpDate}` : 'No expiry on file'}
                  {f.newExpDate ? ` · renewed to ${f.newExpDate}` : ''}
                  {f.phase4ScheduledDate ? ` · skills ${f.phase4ScheduledDate}` : ''}
                </span>
                {nextStepText(f.nextStep) && (
                  <span className="mt-1 block text-[12px] font-medium text-primary-strong">
                    Next: {nextStepText(f.nextStep)}
                  </span>
                )}
                {f.cancelReason && <span className="mt-1 block text-[12px] text-text-3">Cancelled: {f.cancelReason}</span>}
              </span>
            </div>

            {f.overallStatus === 'active' && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {MILESTONES.filter((m) => m.phase === String(f.phase)).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => void advance(f, m)}
                    disabled={acting === f.id}
                    className="h-8 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                  >
                    {m.label}
                  </button>
                ))}
                <button
                  onClick={() => void cancel(f)}
                  disabled={acting === f.id}
                  className="h-8 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-danger transition-colors hover:bg-tint-pink disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </Card>
        ))}

        {busy && !data && <p className="text-[13px] text-text-3">Loading…</p>}
      </div>
    </div>
  )
}
