// MED CORRELATION — Med Errors (MARS) × Missing Meds (kill list 7 of the coverage ledger).
// the old platform's "Med Correlation" screen, re-homed as a tab of the Medications desk.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Loader2, Pill, RefreshCw, ShieldAlert, TriangleAlert, Truck, Users } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type CorrSummary = {
  id: 'summary'
  kind: 'summary'
  window: string
  window_start: string
  window_end: string
  // built_at of each input slice, null when the file was not there — a missing book is said, never read as an empty…
  slice_sources: { marErrors: string | null; missingMedications: string | null }
  totals: {
    med_errors: number
    mar_audit_rows: number
    meds_dispensed: number
    delivery_batches: number
    med_error_rate_pct: number
    missing_meds: number
    error_clients: number
    missing_clients: number
    error_meds: number
    missing_meds_distinct: number
    overlap_clients: number
    overlap_meds: number
    overlap_controlled: number
  }
  error_flags: { missed: number; no_staff: number; unavailable: number; controlled: number; unavailable_pct: number }
  causes: { availability: number; human: number; other: number; availability_pct: number; human_pct: number }
  controlled_overlap: { med: string; errors: number; missing: number }[]
  missing_issues: { issue: string; count: number }[]
  missing_status: { status: string; count: number }[]
  missing_houses: { house: string; count: number }[]
  top_error_clients: { client: string; count: number }[]
  top_error_meds: { med: string; count: number }[]
  top_missing_meds: { med: string; count: number }[]
  trend: { month: string; errors: number; missing: number }[]
  insights: string[]
  sources: { med_errors: string; missing_meds: string }
}

type CorrClient = { id: string; kind: 'client'; initials: string; errors: number; missing: number }
type CorrMed = { id: string; kind: 'medication'; med: string; med_key: string; errors: number; missing: number; controlled: boolean }
type CorrRow = CorrSummary | CorrClient | CorrMed

function Kpi({ label, value, sub, icon: Icon, warn }: {
  label: string
  value: string
  sub?: string
  icon: typeof Pill
  warn?: boolean
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg',
        warn ? 'bg-tint-warning text-tint-fg-warning' : 'bg-tint-primary text-primary')}>
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-[20px] font-bold leading-6 text-text-1">{value}</span>
        <span className="block truncate text-[12px] text-text-3">{label}</span>
        {sub && <span className="block truncate font-stat text-[11px] text-text-3">{sub}</span>}
      </span>
    </Card>
  )
}

function TableShell({ title, caption, head, children }: {
  title: string
  caption?: string
  head: string[]
  children: React.ReactNode
}) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-[14px] font-semibold text-text-1">{title}</p>
        {caption && <p className="mt-0.5 text-[12px] text-text-3">{caption}</p>}
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
            {head.map((h, i) => (
              <th key={h} className={cn('px-4 py-2', i > 0 && 'text-right')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </Card>
  )
}

export default function MedCorrelationPage() {
  const [rows, setRows] = useState<CorrRow[] | null>(null)
  const [failed, setFailed] = useState('')

  const load = useCallback(() => {
    setFailed('')
    api.list<CorrRow>('medCorrelation')
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((err) => setFailed(err instanceof Error ? err.message : 'The correlation slice did not answer.'))
  }, [])
  useEffect(() => { load() }, [load])

  const summary = useMemo(() => (rows ?? []).find((r): r is CorrSummary => r.kind === 'summary'), [rows])
  const clients = useMemo(() => (rows ?? []).filter((r): r is CorrClient => r.kind === 'client'), [rows])
  const meds = useMemo(() => (rows ?? []).filter((r): r is CorrMed => r.kind === 'medication'), [rows])

  // The honest empty state: the whole study is scoped to the KDP delivery batches' window, and with no batches on…
  const noWindow = summary !== undefined && (!summary.window || summary.totals.meds_dispensed === 0)

  return (
    <div className="w-full px-5 py-6">
      <PageHeader
        title="Med Correlation"
        subtitle="Med Errors (MARS) × Missing Meds — the overlap by client and medication, scoped to the delivery batches."
        actions={
          <button onClick={load}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      {summary?.window && (
        <p className="mb-4 flex items-center gap-1.5 font-mono text-[12px] tracking-[0.02em] text-text-2">
          <CalendarRange size={13} className="shrink-0 text-text-3" />
          {summary.window} · {summary.totals.meds_dispensed.toLocaleString()} meds delivered · every rate below is over meds delivered
        </p>
      )}

      {rows === null && !failed && (
        <p className="flex items-center gap-2 py-8 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the correlation study…
        </p>
      )}
      {failed && <p className="py-8 text-[13px] text-text-3">{failed}</p>}

      {rows !== null && !failed && (summary === undefined || noWindow) && (
        <Card>
          <EmptyState
            title="No delivery window on file yet"
            body="This study is scoped to the KDP delivery batches — their date span is the window and their med count is every rate's base. No batches are on file, so there is no honest window to correlate over yet."
          />
        </Card>
      )}

      {summary && !noWindow && (
        <>
          {/* a book that has not been built yet is said, never read as empty */}
          {(!summary.slice_sources?.marErrors || !summary.slice_sources?.missingMedications) && (
            <Card className="mb-4 p-4 text-[13px] text-text-2">
              {!summary.slice_sources?.marErrors && <p>The Med Errors rows have not been read yet — the error side of this study is reading nothing.</p>}
              {!summary.slice_sources?.missingMedications && <p>The Missing Meds rows have not been read yet — the missing side of this study is reading nothing.</p>}
            </Card>
          )}
          {/* the headline numbers */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Med-error rate" value={`${summary.totals.med_error_rate_pct}%`}
              sub={`${summary.totals.med_errors} actionable ÷ ${summary.totals.meds_dispensed.toLocaleString()} delivered`}
              icon={TriangleAlert} warn={summary.totals.med_error_rate_pct > 0} />
            <Kpi label="Actionable med errors" value={String(summary.totals.med_errors)}
              sub={`of ${summary.totals.mar_audit_rows} MAR rows reviewed`}
              icon={Pill} />
            <Kpi label="Missing-med reports" value={String(summary.totals.missing_meds)}
              sub="form responses inside the window"
              icon={Truck} />
            <Kpi label="In both lists" value={`${summary.totals.overlap_clients} clients · ${summary.totals.overlap_meds} meds`}
              sub={`${summary.totals.overlap_controlled} controlled in the overlap`}
              icon={Users} />
          </div>

          {/* caused by an unavailable med */}
          <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-text-1">
              <ShieldAlert size={15} className="text-tint-fg-warning" />
              {summary.error_flags.unavailable} med errors ({summary.error_flags.unavailable_pct}% of delivered meds)
              flagged 'Unavailable' — caused directly by a missing/undelivered med.
            </span>
            <span className="font-stat text-[12px] text-text-3">
              cause by problem text: availability {summary.causes.availability} ({summary.causes.availability_pct}%)
              · human/staff {summary.causes.human} ({summary.causes.human_pct}%)
              · other {summary.causes.other}
            </span>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* per-client overlap — initials only, never a name */}
            <TableShell
              title="Clients in both lists"
              caption={`${summary.totals.error_clients} clients with errors ∩ ${summary.totals.missing_clients} with missing reports — initials only`}
              head={['Client', 'Errors', 'Missing', 'Overlap']}
            >
              {clients.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-[12px] text-text-3">
                  No client appears in both lists inside this window.
                </td></tr>
              ) : clients.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-tint-lavender text-[10px] font-semibold text-tint-fg-lavender">
                      {c.initials}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-stat text-[12px] text-text-1">{c.errors}</td>
                  <td className="px-4 py-2.5 text-right font-stat text-[12px] text-text-1">{c.missing}</td>
                  <td className="px-4 py-2.5 text-right font-stat text-[12px] font-semibold text-text-1">{c.errors + c.missing}</td>
                </tr>
              ))}
            </TableShell>

            {/* per-medication overlap */}
            <TableShell
              title="Medications in both lists"
              caption={`${summary.totals.error_meds} error meds ∩ ${summary.totals.missing_meds_distinct} missing meds — dosage and form words normalized away`}
              head={['Medication', 'Errors', 'Missing', 'Controlled']}
            >
              {meds.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-[12px] text-text-3">
                  No medication appears in both lists inside this window.
                </td></tr>
              ) : meds.map((m) => (
                <tr key={m.id}>
                  <td className="max-w-0 truncate px-4 py-2.5 font-mono text-[12px] font-medium text-text-1" title={m.med_key}>
                    {m.med}
                  </td>
                  <td className="px-4 py-2.5 text-right font-stat text-[12px] text-text-1">{m.errors}</td>
                  <td className="px-4 py-2.5 text-right font-stat text-[12px] text-text-1">{m.missing}</td>
                  <td className="px-4 py-2.5 text-right">
                    {m.controlled && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-tint-pink px-2 py-0.5 text-[11px] font-semibold text-tint-fg-pink">
                        <ShieldAlert size={11} /> controlled
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </TableShell>
          </div>

          {/* the study's own reading */}
          {summary.insights.length > 0 && (
            <Card className="mt-4 p-4">
              <p className="mb-2 text-[13px] font-semibold text-text-1">What the numbers say</p>
              <ul className="list-disc space-y-1 pl-5 text-[12px] leading-5 text-text-2">
                {summary.insights.map((s) => <li key={s}>{s}</li>)}
              </ul>
              <p className="mt-3 text-[11px] text-text-3">
                Sources: {summary.sources.med_errors} · {summary.sources.missing_meds}
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
