// WORKFORCE ANALYTICS — the old platform's Future Analysis + Future Insights pages, re-homed as the Leadership app's…
// Every section renders one piece of the two JSONB payloads the derived `workforceForecast` slice already ships…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Loader2, RefreshCw, TrendingDown, Users } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card, { CardHeader } from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import DragPerson from '@/components/shared/DragPerson'
import { api } from '@/lib/api'
import { asList } from '@/lib/asList'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { ohioDateTime } from '@/lib/ohio'
import { TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'

type Row = Record<string, any>

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const days = (v: unknown): string => {
  const n = num(v)
  return n === null ? '—' : `${Math.round(n)}d`
}
const pct = (v: unknown): string => {
  const n = num(v)
  return n === null ? '—' : `${Math.round(n)}%`
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card className="p-4">
      <span className={cn('block font-display text-[20px] font-bold leading-6', warn ? 'text-tint-fg-danger' : 'text-text-1')}>
        {value}
      </span>
      <span className="block text-[12px] text-text-3">{label}</span>
      {sub && <span className="mt-0.5 block truncate font-stat text-[11px] text-text-3">{sub}</span>}
    </Card>
  )
}

/** A payload section that is absent SAYS so — never a quiet blank card. */
function Section({ title, sub, present, empty, children }: {
  title: string
  sub?: string
  present: boolean
  empty: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader title={title} sub={sub} />
      {present ? children : <p className="text-[13px] text-text-3">{empty}</p>}
    </Card>
  )
}

function BarRow({ label, value, max, right, tint }: {
  label: string; value: number; max: number; right?: string; tint?: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[12.5px] text-text-2" title={label}>{label}</span>
        <span className="shrink-0 font-stat text-[12.5px] font-semibold text-text-1">{right ?? value}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{
          width: `${Math.max(3, Math.round((value / Math.max(1, max)) * 100))}%`,
          backgroundColor: tint ?? TINT_VAR.blue,
        }} />
      </div>
    </div>
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

export default function WorkforcePage() {
  const [rows, setRows] = useState<Row[] | null>(() => readKept<Row[]>('asa:workforce:forecast'))
  const [failed, setFailed] = useState('')

  const load = useCallback(() => {
    setFailed('')
    // a read still in flight at a sign-out or a crossing keeps nothing (lib/kept)
    const generation = keptGeneration()
    api.list<Row>('workforceForecast' as never)
      .then((r) => {
        const list = Array.isArray(r) ? r : []
        setRows(list)
        keepIfCurrent('asa:workforce:forecast', list, generation)
      })
      .catch((err) => setFailed(err instanceof Error ? err.message : 'The workforce forecast slice did not answer.'))
  }, [])
  useEffect(() => { load() }, [load])

  const a = useMemo(() => (rows ?? []).find((r) => r.id === 'analysis'), [rows])
  const i = useMemo(() => (rows ?? []).find((r) => r.id === 'insights'), [rows])

  const h = a?.headline
  const t = a?.tenure
  const li = a?.leading_indicators
  const km = useMemo(
    () => (Array.isArray(t?.km) ? t.km : []).map((p: Row) => ({ day: num(p.day) ?? 0, survival: Math.round((num(p.survival) ?? 0) * 100) })),
    [t],
  )
  const zones = useMemo(
    () => (Array.isArray(a?.city_zones?.zones) ? a.city_zones.zones : []).filter((z: Row) => z.city !== 'Unknown').slice(0, 8),
    [a],
  )
  const funnelEntries = useMemo(
    () => Object.entries(a?.funnel?.status_breakdown ?? {}) as [string, number][],
    [a],
  )
  const risk = useMemo(() => (Array.isArray(i?.flight_risk) ? i.flight_risk : []), [i])
  const fit = useMemo(() => (Array.isArray(i?.candidate_fit) ? i.candidate_fit : []), [i])
  const executive = useMemo(() => (Array.isArray(i?.executive_conclusions) ? i.executive_conclusions : []), [i])
  const conclusions = useMemo(() => (Array.isArray(i?.conclusions) ? i.conclusions : []), [i])
  const exitBuckets = useMemo(() => Object.entries(i?.exit_timing?.buckets ?? {}) as [string, number][], [i])
  const newHireMembers = useMemo(() => (Array.isArray(i?.new_hires?.members) ? i.new_hires.members : []), [i])

  const loading = rows === null && !failed
  const empty = rows !== null && rows.length === 0 && !failed

  return (
    <div className="w-full px-5 py-6">
      <PageHeader
        title="Workforce analytics"
        subtitle="Trends and the narrative forecast — the old platform's Future Analysis and Future Insights, on the same cached run the Leadership tile reads."
        actions={
          <button onClick={load}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      {(a?.computed_at || i?.computed_at) && (
        <p className="mb-4 font-mono text-[12px] tracking-[0.02em] text-text-2">
          {a?.computed_at ? `analysis computed ${ohioDateTime(a.computed_at)}` : ''}
          {a?.computed_at && i?.computed_at ? ' · ' : ''}
          {i?.computed_at ? `insights computed ${ohioDateTime(i.computed_at)}` : ''}
          {a?.sources ? ` · ${a.sources.tenure_records_used ?? '—'} tenure records · ${a.sources.resume_analyses ?? '—'} resume analyses` : ''}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 py-8 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the cached workforce run…
        </p>
      )}
      {failed && <p className="py-8 text-[13px] text-text-3">{failed}</p>}
      {empty && (
        <Card>
          <EmptyState
            title="No workforce run cached yet"
            body="the old platform's recompute lane writes the analysis and insights payloads on its own schedule — nothing is cached yet, and inventing the numbers is the one thing this screen will not do. This fills on the lane's next pass."
          />
        </Card>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="grid gap-4">
          {/* ── headline KPIs ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Active staff" value={h?.active_staff != null ? String(h.active_staff) : '—'}
              sub={`${h?.inactive_staff ?? '—'} inactive · n=${h?.sample_n ?? '—'}`} />
            <Kpi label="Turnover (point-in-time)" value={pct(h?.turnover_proxy_pct)}
              sub={`benchmarks: home care ${h?.benchmark_home_care_pct ?? '—'}% · DSP ${Array.isArray(h?.benchmark_dsp_pct) ? h.benchmark_dsp_pct.join('–') : '—'}%`}
              warn={(num(h?.turnover_proxy_pct) ?? 0) > (num(h?.benchmark_home_care_pct) ?? 100)} />
            <Kpi label="Median tenure" value={days(t?.median_tenure_days)}
              sub={`${t?.events ?? 0} departures · ${t?.censored_active ?? 0} active`} />
            <Kpi label="Referral median tenure" value={days(a?.referral?.referral_median_days)}
              sub={`vs ${days(a?.referral?.non_referral_median_days)} non-referral`} />
          </div>

          {/* ── tenure: Kaplan-Meier + the histogram ──────────────────── */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Retention curve (Kaplan-Meier)" sub="share of staff still here, by days since hire"
              present={km.length > 1} empty={t?.note || 'Not enough dated tenure records yet — the run says so itself.'}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={km} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false}
                      tickFormatter={(d) => `${d}d`} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false}
                      tickFormatter={(v) => `${v}%`} width={40} />
                    <Tooltip formatter={(v: any) => [`${v}%`, 'still here']}
                      labelFormatter={(d) => `day ${d}`} />
                    <Line type="stepAfter" dataKey="survival" stroke={TINT_VAR.blue} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title="Tenure mix" sub="everyone with a dated record, bucketed"
              present={!!t?.histogram && Object.keys(t.histogram).length > 0} empty="No tenure histogram in the payload.">
              <div className="grid gap-2.5">
                {Object.entries(t?.histogram ?? {}).map(([k, v]) => (
                  <BarRow key={k} label={k} value={Number(v) || 0}
                    max={Math.max(1, ...Object.values(t?.histogram ?? {}).map(Number))} />
                ))}
                {t?.milestones && (
                  <p className="mt-1 text-[12px] leading-5 text-text-3">
                    {Object.entries(t.milestones).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${pct(v)}`).join(' · ')}
                  </p>
                )}
              </div>
            </Section>
          </div>

          {/* ── referral split + city zones ───────────────────────────── */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Referral split" sub="median tenure, referred vs not"
              present={!!a?.referral} empty="No referral comparison in the payload.">
              <div className="grid gap-2 text-[13px] text-text-2">
                <p>Referred ({a?.referral?.referral_n ?? 0}): <b className="text-text-1">{days(a?.referral?.referral_median_days)}</b>
                  {' · '}not referred ({a?.referral?.non_referral_n ?? 0}): <b className="text-text-1">{days(a?.referral?.non_referral_median_days)}</b></p>
                {a?.referral?.p_value != null && <p className="font-stat text-[12px] text-text-3">p = {a.referral.p_value}</p>}
                {a?.referral?.cite && <p className="text-[12px] leading-5 text-text-3">{a.referral.cite}</p>}
                {a?.referral?.note && <p className="text-[12px] leading-5 text-text-3">{a.referral.note}</p>}
              </div>
            </Section>

            <Section title="City zones" sub="retention by city — descriptive only"
              present={zones.length > 0} empty="No city zones in the payload.">
              <div className="grid gap-2.5">
                {zones.map((z: Row) => (
                  <BarRow key={z.city} label={z.city} value={num(z.retention_pct) ?? 0} max={100}
                    right={`${pct(z.retention_pct)} · ${z.active ?? 0}/${z.total ?? 0}`} tint={TINT_VAR.mint} />
                ))}
                {a?.city_zones?.note && <p className="text-[12px] leading-5 text-text-3">{a.city_zones.note}</p>}
              </div>
            </Section>
          </div>

          {/* ── leading indicators + funnel ───────────────────────────── */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Leading indicators" sub="post-hire early-warning counts"
              present={!!li} empty="No leading indicators in the payload.">
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Kpi label="Call-off events" value={String(li?.call_off_events ?? '—')} sub={`${li?.staff_with_call_offs ?? '—'} staff`} />
                <Kpi label="MARS errors" value={String(li?.mars_errors ?? '—')} sub="med-admin errors logged"
                  warn={(num(li?.mars_errors) ?? 0) > 0} />
                <Kpi label="HR events" value={String(li?.hr_events ?? '—')} />
                <Kpi label="Incidents" value={String(li?.incidents ?? '—')} />
              </div>
              {asList(li?.top_call_off_staff).length > 0 && (
                <div className="mb-2 grid gap-1.5">
                  {(Array.isArray(li?.top_call_off_staff) ? li.top_call_off_staff : []).slice(0, 6).map((s: Row) => (
                    <p key={s.name} className="flex items-baseline justify-between gap-3 text-[13px] text-text-2">
                      <DragPerson name={String(s.name ?? '')}>{s.name}</DragPerson>
                      <span className="font-stat font-semibold text-text-1">{s.events} call-offs</span>
                    </p>
                  ))}
                </div>
              )}
              {li?.disciplinary_breakdown && Object.keys(li.disciplinary_breakdown).length > 0 && (
                <div className="grid gap-2 border-t border-border pt-2.5">
                  {Object.entries(li.disciplinary_breakdown).map(([k, v]) => (
                    <BarRow key={k} label={k} value={Number(v) || 0}
                      max={Math.max(1, ...Object.values(li.disciplinary_breakdown).map(Number))} tint={TINT_VAR.amber} />
                  ))}
                </div>
              )}
              {li?.note && <p className="mt-2 text-[12px] leading-5 text-text-3">{li.note}</p>}
            </Section>

            <Section title="Candidate funnel" sub={`${a?.funnel?.candidate_total ?? 0} candidates tracked`}
              present={funnelEntries.length > 0} empty="No funnel in the payload.">
              <div className="grid gap-2.5">
                {funnelEntries.map(([st, n]) => (
                  <BarRow key={st} label={st} value={Number(n) || 0}
                    max={Math.max(1, ...funnelEntries.map(([, v]) => Number(v) || 0))} tint={TINT_VAR.lavender} />
                ))}
              </div>
            </Section>
          </div>

          {/* ── the ideal-hire scorecard ──────────────────────────────── */}
          <Section title="Ideal-hire scorecard" sub="evidence-weighted from published studies — see the disclaimer"
            present={Array.isArray(a?.scorecard?.dimensions) && a.scorecard.dimensions.length > 0}
            empty="No scorecard in the payload.">
            <div className="grid gap-2">
              {(a?.scorecard?.dimensions ?? []).map((d: Row) => (
                <div key={d.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border pb-2 text-[13px] last:border-0">
                  <span className="min-w-0 flex-1 font-medium text-text-1">{d.label}</span>
                  <span className="font-stat text-[12px] text-text-3">weight {d.weight ?? '—'}</span>
                  <span className="text-[12px] text-text-3">{d.direction === 'up' ? '↑ helps' : d.direction === 'down' ? '↓ hurts' : ''}</span>
                  <span className="text-[12px] text-text-3">{d.coverage ?? 'no coverage'}</span>
                </div>
              ))}
              {asList(a?.scorecard?.excluded_inputs).length > 0 && (
                <p className="text-[12px] leading-5 text-text-3">
                  Never inputs (protected / rigor): {asList(a?.scorecard?.excluded_inputs).join(' · ')}
                </p>
              )}
              {a?.scorecard?.disclaimer && (
                <p className="text-[12px] leading-5 text-text-3">{a.scorecard.disclaimer}</p>
              )}
            </div>
          </Section>

          {/* ── INSIGHTS: the narrative ───────────────────────────────── */}
          <h2 className="mt-4 font-display text-[17px] font-bold text-text-1">The narrative — insights</h2>

          <Section title="Executive conclusions" sub="ranked by how much you can lean on them — the run is honest about small samples"
            present={executive.length > 0} empty="No executive conclusions in the payload.">
            <div className="grid gap-3">
              {executive.map((c: Row) => (
                <div key={c.rank} className="rounded-md border border-border p-3">
                  <p className="flex items-baseline gap-2 text-[13.5px] font-semibold text-text-1">
                    <span className="font-stat text-text-3">#{c.rank}</span> {c.claim}
                    <span className={cn('ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide',
                      c.confidence === 'high' ? 'bg-tint-mint text-tint-fg-mint'
                        : c.confidence === 'medium' ? 'bg-tint-amber text-tint-fg-amber' : 'bg-surface-2 text-text-3')}>
                      {c.confidence}
                    </span>
                  </p>
                  {c.detail && <p className="mt-1 text-[12.5px] leading-5 text-text-2">{c.detail}</p>}
                  {c.action && <p className="mt-1 text-[12.5px] leading-5 text-text-3"><b className="text-text-2">Do:</b> {c.action}</p>}
                </div>
              ))}
            </div>
          </Section>

          <div className="grid gap-4 xl:grid-cols-2">
            <TableShell title="Flight risk — current active staff"
              caption="rate-based (exposure-fair); coach + medication-quality review"
              head={['Name', 'Risk', 'Drivers', 'Tenure']}>
              {risk.length === 0 ? (
                <tr><td className="px-4 py-3 text-[13px] text-text-3" colSpan={4}>No flight-risk list in the payload.</td></tr>
              ) : risk.map((r: Row) => (
                <tr key={r.name}>
                  <td className="px-4 py-2.5 text-[13px] text-text-1">
                    <DragPerson name={String(r.name ?? '')}>{r.name}</DragPerson>
                  </td>
                  <td className="px-4 py-2.5 text-right font-stat text-[13px] font-bold">
                    <span className={cn((num(r.risk) ?? 0) >= 50 ? 'text-tint-fg-danger' : 'text-text-1')}>{r.risk ?? '—'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-[12px] text-text-3">{asList(r.factors).join(' · ')}</td>
                  <td className="px-4 py-2.5 text-right text-[12px] text-text-3">{days(r.tenure_days)}</td>
                </tr>
              ))}
            </TableShell>

            <TableShell title="Candidate fit — incoming"
              caption="retention-weighted (composite ≠ tenure) · Ret = loyalty, Skill = screen"
              head={['Name', 'Fit', 'Ret · Skill', 'Decision']}>
              {fit.length === 0 ? (
                <tr><td className="px-4 py-3 text-[13px] text-text-3" colSpan={4}>No candidate-fit list in the payload.</td></tr>
              ) : fit.map((c: Row) => (
                <tr key={c.name}>
                  <td className="px-4 py-2.5 text-[13px] text-text-1">{c.name}</td>
                  <td className="px-4 py-2.5 text-right font-stat text-[13px] font-bold text-text-1">{c.fit ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-[12px] text-text-3">R {c.retention ?? '—'} · S {c.skill ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-[12px] text-text-3">{c.decision ?? '—'}</td>
                </tr>
              ))}
            </TableShell>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Exit timing" sub={i?.exit_timing ? `n=${i.exit_timing.n ?? '—'} dated departures · median ${days(i.exit_timing.median_days)}` : undefined}
              present={exitBuckets.length > 0} empty="No exit-timing breakdown in the payload.">
              <div className="grid gap-2.5">
                {exitBuckets.map(([k, v]) => (
                  <BarRow key={k} label={k} value={Number(v) || 0}
                    max={Math.max(1, ...exitBuckets.map(([, n]) => Number(n) || 0))} tint={TINT_VAR.pink} />
                ))}
                <p className="mt-1 text-[12px] leading-5 text-text-3">
                  within 30d: {pct(i?.exit_timing?.within_30d_pct)} · within 90d: {pct(i?.exit_timing?.within_90d_pct)}
                </p>
              </div>
            </Section>

            <Section title="Conclusions — attributes + concentration"
              sub="exposure-independent, within-cohort — the run's own method"
              present={conclusions.length > 0} empty="No attribute conclusions in the payload.">
              <div className="grid gap-2.5">
                {conclusions.map((c: Row, idx: number) => (
                  <div key={idx} className="text-[13px] leading-5">
                    <p className="font-medium text-text-1">{c.dimension}
                      <span className="ml-2 font-stat text-[12px] font-normal text-text-3">
                        {c.active != null ? `active ${c.active}${c.higher_is_risk ? '' : ''}` : ''}{c.departed != null ? ` · departed ${c.departed}` : ''}{c.delta != null ? ` · Δ ${c.delta}` : ''}
                      </span>
                    </p>
                    {c.action && <p className="text-[12.5px] text-text-2">{c.action}</p>}
                    {c.note && <p className="text-[11.5px] text-text-3">{c.note}</p>}
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <Section title="New hires" sub={i?.new_hires ? `${i.new_hires.cohort_size ?? 0} recent · ${pct(i.new_hires.referral_share)} referred · ${pct(i.new_hires.driver_share)} drive` : undefined}
            present={newHireMembers.length > 0} empty="No new-hire cohort in the payload.">
            <div className="grid gap-1.5">
              {newHireMembers.slice(0, 10).map((m: Row) => (
                <p key={m.name} className="flex flex-wrap items-baseline gap-x-3 text-[13px] text-text-2">
                  <DragPerson name={String(m.name ?? '')}>{m.name}</DragPerson>
                  <span className="font-stat text-[12px] text-text-3">{days(m.days)}</span>
                  {m.in_90d && <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[10.5px] font-bold text-tint-fg-amber">first 90 days</span>}
                  <span className="ml-auto font-stat text-[12px] text-text-3">risk {m.risk ?? '—'}</span>
                </p>
              ))}
            </div>
          </Section>

          {i?.board_narrative && (
            <Card>
              <details>
                <summary className="cursor-pointer text-[14px] font-semibold text-text-1">
                  Director-level workforce diagnostic <span className="ml-1 text-[12px] font-normal text-text-3">(the analyst agents' full narrative)</span>
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-6 text-text-2">{String(i.board_narrative)}</p>
              </details>
            </Card>
          )}

          {i?.method_note && (
            <p className="flex items-start gap-2 text-[12px] leading-5 text-text-3">
              <TrendingDown size={13} className="mt-0.5 shrink-0" />
              {i.method_note}
              {i.coverage && (
                <span className="ml-1 inline-flex items-center gap-1">
                  <Users size={12} /> {i.coverage.employees_scored ?? '—'} staff scored · {i.coverage.candidates_scored ?? '—'} candidates
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
