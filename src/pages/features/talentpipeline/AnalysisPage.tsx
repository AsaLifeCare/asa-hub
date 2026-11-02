// TALENT PIPELINE — ANALYSIS: honest statistics over the migrated record, the CANONICAL ranking (computed in GAS by…
// The reply is the decision; the hourly sweep only reads it.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronDown, Clock, Loader2, Mail,
  MessageSquare, Send, ShieldCheck, Trophy, XCircle,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import { ActivityRing, ThemedAreaChart, ThemedDonut } from '@/components/shared/charts'
import { api } from '@/lib/api'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import type { TintName } from '@/engine/types'

type TpRow = {
  candidate_id: string
  name: string
  status: string
  composite_score: string
  skills: string
  certs: string
  experience: string
  job_history: string
  years: string
  avg_tenure: string
  flags: string[]
  decision: string
  cjis: string
  screen_result: string
  screen_qualification: string
  /** canonical rank fields, computed in GAS by the pure formula */
  rank: number | null
  rank_score: number | null
  /** their card is already on the hiring board (TP_WHY_ON_BOARD) */
  on_board?: boolean
  // the LEGACY already walked them through a step — Hired, Ready, Phone Screen… `talentStage_` decides, so the…
  in_process?: boolean
  in_process_stage?: string
  cross_why?: string
}

type Ask = {
  ask_id: string
  candidate_id: string
  candidate_name: string
  rank: string
  nota: string
  requested_at: string
  requested_by: string
  state: string
  reply_from: string
  reply_verdict: string
  reply_analyzed_at: string
  moved_candidate_id: string
  moved_at: string
}

type Payload = { rows: TpRow[]; migrated: boolean; authorizations: Ask[] }

// THE WHOLE REALITY, COMPUTED IN PYTHON (server/hiring_slices.py).
type Analysis = {
  sources: { candidates: string | null; talentPool: string | null; recruitment: string | null }
  process: {
    total: number
    stages: { id: string; label: string; count: number; median_days: number | null
              longest_days: number | null; longest_who: string; no_arrival: number }[]
  }
  conditions: { id: string; label: string; owner: string; stage: string
                done: number; pending: number; missing: number; people: number
                waiting_names: string[] }[]
  parked: { standing: { name: string; days: number | null; notices: number; of: number; last_at: string }[]
            told: number }
  books: {
    process: { count: number }
    store: { count: number; source: string; by_status: { status: string; count: number }[] }
    book: { count: number; signed: number; pending: number; declined: number; other: number
            source: string; signed_on_board: number; signed_in_store: number; signed_strangers: number }
    unfinished: { srid: string; name: string; email: string; phone: string
                  status: string; applied: string; location: string }[]
  }
  notas: { scored: number; unscored: number; average: number | null
           strong: number; middle: number; weak: number }
}

/** Same maths as the canonical tpNota_ in GAS: legacy composite /12 → 0-10. */
function notaOf(composite: string): number | null {
  const n = parseFloat(composite)
  if (Number.isNaN(n)) return null
  return Math.max(0, Math.min(10, Math.round((n / 12) * 100) / 10))
}
const notaChip = (g: number) =>
  g >= 8 ? 'bg-tint-mint text-tint-fg-mint' : g >= 6 ? 'bg-tint-amber text-tint-fg-amber' : 'bg-tint-pink text-tint-fg-pink'

// WHAT A FLAG ACTUALLY MEANS — written once, beside the screen that shows it.
const FLAG_LABEL: Record<string, string> = {
  'short tenure': 'Short tenure',
  'no certs': 'No certifications listed',
  'stale experience': 'Stale experience',
}
const FLAG_MEANS: Record<string, string> = {
  'short tenure': 'their jobs in care have been brief ones, so the record cannot show how they settle',
  'no certs': 'the résumé lists none of the certifications the work asks for — which is a gap to fill, not a refusal',
  'stale experience': 'the caregiving on the résumé is not recent, so the skills are older than the page suggests',
}

const DECISION_CHIP: Record<string, string> = {
  Advance: 'bg-tint-mint text-tint-fg-mint',
  Review: 'bg-tint-amber text-tint-fg-amber',
  Reject: 'bg-tint-pink text-tint-fg-pink',
}

const ASK_STATE: Record<string, { label: string; chip: string }> = {
  requested: { label: 'awaiting reply', chip: 'bg-tint-amber text-tint-fg-amber' },
  approved: { label: 'approved', chip: 'bg-tint-mint text-tint-fg-mint' },
  denied: { label: 'denied', chip: 'bg-tint-pink text-tint-fg-pink' },
  moved: { label: 'moved to hiring', chip: 'bg-tint-blue text-tint-fg-blue' },
}

function when(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function AnalysisPage() {
  const [data, setData] = useState<Payload | null>(() => readKept<Payload>('asa:tp:analysis'))
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  // Which row has its flags open — one at a time, like every other disclosure on this platform.
  const [flagsOpen, setFlagsOpen] = useState('')
  // `null` = still reading, `false` = the file is not there.
  const [reality, setReality] = useState<Analysis | null | false>(
    () => readKept<Analysis>('asa:hiring:analysis') ?? null)

  const load = useCallback(() => {
    // a read still in flight at a sign-out or a crossing keeps nothing (lib/kept)
    const generation = keptGeneration()
    // ONE FILE, ALREADY CROSSED.
    api.list<Analysis>('hiringAnalysis')
      .then((rows) => {
        const first = rows?.[0] ?? null
        setReality(first ?? false)
        if (first) keepIfCurrent('asa:hiring:analysis', first, generation)
      })
      .catch(() => setReality(false))
    // THE SLICE FIRST — the same JSON file the roster reads.
    api.list<TpRow>('talentPool')
      .then((rows) => {
        // The asks are their own small read — the slice carries the people.
        const next: Payload = { rows: rows ?? [], migrated: (rows ?? []).length > 0, authorizations: [] }
        setData(next)
        keepIfCurrent('asa:tp:analysis', next, generation)
        setError(null)
        gasAction<{ authorizations: Ask[] }>('talentPipelineList', {}, { timeoutMs: 120000 })
          .then((d) => {
            const withAsks = { ...next, authorizations: d.authorizations ?? [] }
            setData(withAsks)
            keepIfCurrent('asa:tp:analysis', withAsks, generation)
          })
          .catch(() => { /* the charts stand without the ask panel */ })
      })
      .catch((e) => { if (!data) setError(e instanceof Error ? e.message : 'The pipeline did not answer.') })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kept-copy: paint first, refresh behind
  }, [])
  useEffect(() => { load() }, [load])

  const requestAuth = () => {
    setAsking(true)
    void gasAction<{ asked: number; already_open: number; emails_sent: number; sms_sent: number }>(
      'talentAuthorizationSend', {}, { timeoutMs: 120000 })
      .then((d) => {
        toast({
          type: 'success',
          title: `${d.asked} authorization ask${d.asked === 1 ? '' : 's'} opened`,
          body: `${d.emails_sent} letter(s) and ${d.sms_sent} SMS went to the leaders — the platform now waits for their reply.` +
            (d.already_open ? ` ${d.already_open} of the top 5 already had an open ask.` : ''),
        })
        load()
      })
      .catch((e) => toast({ type: 'danger', title: 'The ask was not sent', body: e instanceof Error ? e.message : 'Try again.' }))
      .finally(() => setAsking(false))
  }

  const rows = useMemo(() => data?.rows ?? [], [data])
  const asks = useMemo(() => data?.authorizations ?? [], [data])

  /* ── the honest statistics, computed from the rows on screen ── */
  const stats = useMemo(() => {
    const analyzed = rows.filter((r) => notaOf(r.composite_score) !== null)
    // THE RANKING IS A LIST OF PEOPLE TO START ON — anybody already at any STEP of the hiring process leaves this…
    const started = (r: TpRow) => !!r.on_board || !!r.in_process
    const inProcess = rows.filter(started).length
    const ranked = rows.filter((r) => r.rank !== null && !started(r))
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    const notas = analyzed.map((r) => notaOf(r.composite_score)!)
    const avgNota = notas.length ? Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10 : null

    const notaBins = Array.from({ length: 10 }, (_, i) => ({
      label: `${9 - i}–${10 - i}`,
      count: notas.filter((n) => (9 - i === 0 ? n >= 0 : n > 9 - i) && n <= 10 - i).length,
    }))

    const decisions = { Advance: 0, Review: 0, Reject: 0, none: 0 }
    rows.forEach((r) => {
      if (r.decision === 'Advance') decisions.Advance++
      else if (r.decision === 'Review') decisions.Review++
      else if (r.decision === 'Reject') decisions.Reject++
      else decisions.none++
    })

    const flagCounts = [
      { label: 'Short tenure', count: rows.filter((r) => r.flags.includes('short tenure')).length },
      { label: 'No certifications', count: rows.filter((r) => r.flags.includes('no certs')).length },
      { label: 'Stale experience', count: rows.filter((r) => r.flags.includes('stale experience')).length },
    ].sort((a, b) => b.count - a.count)

    const screened = rows.filter((r) => r.screen_result)
    const passed = screened.filter((r) => /pass/i.test(r.screen_result) || /pass/i.test(r.screen_qualification))
    const failedOrRejected = screened.filter((r) => /fail|reject/i.test(r.screen_result))

    const subAvg = (pick: (r: TpRow) => string) => {
      const vals = rows.map((r) => parseFloat(pick(r))).filter((n) => !Number.isNaN(n))
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : 0
    }
    const subRatings = [
      { label: 'Skills', avg: subAvg((r) => r.skills) },
      { label: 'Certifications', avg: subAvg((r) => r.certs) },
      { label: 'Experience', avg: subAvg((r) => r.experience) },
      { label: 'Job history', avg: subAvg((r) => r.job_history) },
    ]

    const years = rows.map((r) => parseFloat(r.years)).filter((n) => !Number.isNaN(n)).sort((a, b) => b - a)
    const medianYears = years.length ? years[Math.floor(years.length / 2)] : null
    const tenures = rows.map((r) => parseFloat(r.avg_tenure)).filter((n) => !Number.isNaN(n))
    const avgTenure = tenures.length
      ? Math.round((tenures.reduce((a, b) => a + b, 0) / tenures.length) * 10) / 10 : null

    return { analyzed, ranked, inProcess, avgNota, notaBins, decisions, flagCounts, screened, passed, failedOrRejected, subRatings, years, medianYears, avgTenure }
  }, [rows])

  /** the freshest ask per candidate — the state chip beside the top 5 */
  const askByCandidate = useMemo(() => {
    const map: Record<string, Ask> = {}
    for (const a of asks) {
      const have = map[a.candidate_id]
      if (!have || Date.parse(a.requested_at) > Date.parse(have.requested_at)) map[a.candidate_id] = a
    }
    return map
  }, [asks])

  const top5 = stats.ranked.slice(0, 5)

  if (error) {
    return (
      <div>
        <Header />
        <Card className="mt-5 p-6 text-center text-[13px] text-text-2">{error}</Card>
      </div>
    )
  }
  if (data === null) {
    return (
      <div>
        <Header />
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the pipeline…
        </p>
      </div>
    )
  }
  if (!rows.length) {
    // THE STORE BEING EMPTY IS NOT THE SCREEN BEING EMPTY.
    return (
      <div>
        <Header />
        <RealitySection reality={reality} />
        <div className="mt-6">
          <EmptyState
            title="The legacy store is empty"
            body="No migrated résumé to rank yet. Everything above is the live process and the application book, which do not depend on it."
          />
        </div>
      </div>
    )
  }

  const maxBin = Math.max(...stats.notaBins.map((b) => b.count), 1)
  const maxFlag = Math.max(...stats.flagCounts.map((f) => f.count), 1)
  const passPct = stats.screened.length
    ? Math.round((stats.passed.length / stats.screened.length) * 100) : 0

  return (
    <div>
      <Header />

      <RealitySection reality={reality} />

      {/* ── the store's own record, from here down ── */}
      <div className="mt-6 flex items-baseline gap-2 border-t border-border/60 pt-4">
        <h2 className="text-[13.5px] font-bold text-text-1">The store, analysed</h2>
        <p className="text-[12px] text-text-3">
          The legacy roster's own numbers — every migrated résumé, its rubric and the ranking the
          authorization ask acts on. This half is the Talent Pipeline app, whole.
        </p>
      </div>

      {/* ── headline numbers ── */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Candidates on record" value={String(rows.length)} />
        <StatTile label="With a scored résumé" value={String(stats.analyzed.length)} />
        <StatTile label="Average nota" value={stats.avgNota === null ? '—' : stats.avgNota.toFixed(1)} />
        <StatTile label="Eligible for the ranking" value={String(stats.ranked.length)} />
      </div>

      {/* ── the charts ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="p-4">
          <ChartTitle title="Nota distribution" note={`${stats.analyzed.length} scored résumés, composite ÷ 12 × 10`} />
          <div className="mt-3 space-y-2">
            {stats.notaBins.map((b) => (
              <RankedBar key={b.label} label={b.label} count={b.count} max={maxBin} tint="lavender" />
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <ChartTitle title="Decision mix" note="the legacy analysis's own verdicts" />
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <ThemedDonut
              slices={[
                { label: 'Advance', value: stats.decisions.Advance, tint: 'mint' as const },
                { label: 'Review', value: stats.decisions.Review, tint: 'amber' as const },
                { label: 'Reject', value: stats.decisions.Reject, tint: 'pink' as const },
                { label: 'Not analyzed', value: stats.decisions.none, tint: 'blue' as const },
              ].filter((s) => s.value > 0)}
              centerLabel="candidates"
              size={150}
            />
            <div className="min-w-[140px] flex-1 space-y-1.5">
              <LegendRow tint="mint" label="Advance" value={stats.decisions.Advance} />
              <LegendRow tint="amber" label="Review" value={stats.decisions.Review} />
              <LegendRow tint="pink" label="Reject" value={stats.decisions.Reject} />
              <LegendRow tint="blue" label="Not analyzed" value={stats.decisions.none} />
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <ChartTitle title="Red flags" note="raised by the résumé analysis" />
          <div className="mt-3 space-y-2">
            {stats.flagCounts.map((f) => (
              <RankedBar key={f.label} label={f.label} count={f.count} max={maxFlag} tint="amber" />
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-text-3">
            {rows.filter((r) => r.flags.length === 0).length} candidates carry no flag at all.
          </p>
        </Card>

        <Card className="p-4">
          <ChartTitle title="Phone screens" note={`${stats.screened.length} of ${rows.length} screened`} />
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <ActivityRing percent={passPct} tint="mint" size={110} />
            <div className="min-w-[140px] flex-1 space-y-1.5">
              <LegendRow tint="mint" label="Passed" value={stats.passed.length} />
              <LegendRow tint="pink" label="Failed / rejected" value={stats.failedOrRejected.length} />
              <LegendRow tint="blue" label="Other outcome" value={stats.screened.length - stats.passed.length - stats.failedOrRejected.length} />
              <LegendRow tint="amber" label="Never screened" value={rows.length - stats.screened.length} />
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <ChartTitle title="Sub-rating averages" note="each rated 0–3 by the legacy rubric" />
          <div className="mt-3 space-y-2">
            {stats.subRatings.map((s) => (
              <div key={s.label}>
                <div className="mb-0.5 flex items-baseline justify-between">
                  <span className="text-[12px] font-medium text-text-2">{s.label}</span>
                  <span className="font-stat text-[12px] font-bold tabular-nums text-text-1">{s.avg.toFixed(2)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, (s.avg / 3) * 100)}%`, background: 'var(--tint-blue-fg)' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <ChartTitle title="Years in care, spread" note="every candidate, most experienced first" />
          <div className="mt-2">
            <ThemedAreaChart
              series={[{ name: 'years', points: stats.years, color: 'mint' }]}
              height={130}
            />
          </div>
          <p className="mt-2 text-[11.5px] text-text-3">
            Median {stats.medianYears ?? '—'} years in caregiving
            {stats.avgTenure !== null && <> · average tenure per job {stats.avgTenure} years</>}.
          </p>
        </Card>
      </div>

      {/* ── the ranking table ── */}
      <Card padded={false} className="mt-4 overflow-hidden">
        <div className="border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Trophy size={15} className="text-tint-fg-amber" />
            <h2 className="text-[13.5px] font-bold text-text-1">The ranking — recomputed on every read</h2>
          </div>
          <p className="mt-1.5 max-w-[860px] text-[12px] leading-[1.6] text-text-3">
            How the rank is computed: <span className="text-text-2">score = nota (composite ÷ 12 × 10)
            + 0.5 if the phone-screen qualification passed + 0.25 if all six screen checks
            (DODD, CPR, Med Delegation, licence, vehicle, insurance) are true − 0.75 per red flag</span>.
            Eligible: decision <span className="text-text-2">Advance</span> (or <span className="text-text-2">Review</span> with
            zero red flags), CJIS not failed, screen not rejected. Ties break by years of caregiving.
            {stats.inProcess > 0 && (
              <> <span className="text-text-2">{stats.inProcess} {stats.inProcess === 1 ? 'person is' : 'people are'} left
                out of this list — either their card is already on the hiring board, or the legacy
                record itself says they walked a step of it (Hired, Ready, Phone Screen)</span>. The
                ranking names people to START on; somebody already hired is not a decision to take.</>
            )}
            The same formula, computed server-side, decides the top 5 the authorization ask names —
            every number traces to the migrated record; nothing here is AI-written.
          </p>
        </div>
        {stats.ranked.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] italic text-text-3">
            No candidate clears the eligibility gates yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border/60 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  <th className="px-4 py-2">#</th>
                  <th className="px-2 py-2">Candidate</th>
                  <th className="px-2 py-2">Nota</th>
                  <th className="px-2 py-2">Score</th>
                  <th className="px-2 py-2">Decision</th>
                  <th className="px-2 py-2">CJIS</th>
                  <th className="px-2 py-2">Flags</th>
                  <th className="px-2 py-2">Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {stats.ranked.slice(0, 25).map((r) => {
                  const nota = notaOf(r.composite_score)
                  const top = (r.rank ?? 99) <= 5
                  const openFlags = flagsOpen === r.candidate_id
                  return (
                    <Fragment key={r.candidate_id}>
                    <tr className={cn(top && 'bg-primary-soft')}>
                      <td className="px-4 py-2 font-stat font-bold tabular-nums text-text-1">
                        {r.rank}{top && <Trophy size={11} className="ml-1 inline text-tint-fg-amber" />}
                      </td>
                      <td className="px-2 py-2">
                        <DragPerson name={r.name} id={r.candidate_id} type="staff" subtitle={r.decision || r.status} className="flex items-center gap-2">
                          <Avatar name={r.name} size="xs" />
                          <span className="font-semibold text-text-1">{r.name}</span>
                        </DragPerson>
                      </td>
                      <td className="px-2 py-2">
                        {nota !== null && (
                          <span className={cn('rounded-md px-1.5 py-0.5 text-[12px] font-bold tabular-nums', notaChip(nota))}>
                            {nota.toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 font-stat tabular-nums text-text-1">{r.rank_score?.toFixed(2)}</td>
                      <td className="px-2 py-2">
                        <span className={cn('rounded-full px-1.5 py-px text-[10.5px] font-semibold',
                          DECISION_CHIP[r.decision] ?? 'bg-surface-2 text-text-3')}>
                          {r.decision || '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-text-2">{r.cjis || '—'}</td>
                      {/* THE WARNING OPENS — a row carrying a warning shows
                          it when it is pressed. A count
                          with the words hidden in a tooltip is a number nobody
                          can act on — and on a touch screen a title attribute
                          is not reachable at all. */}
                      <td className="px-2 py-2">
                        {r.flags.length ? (
                          <button
                            onClick={() => setFlagsOpen(openFlags ? '' : r.candidate_id)}
                            title={openFlags ? 'Hide the flags' : 'What the analysis flagged'}
                            className={cn('flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-tint-fg-amber hover:bg-tint-amber',
                              openFlags && 'bg-tint-amber')}
                          >
                            <AlertTriangle size={11} /> {r.flags.length}
                            <ChevronDown size={11} className={cn('transition-transform', openFlags && 'rotate-180')} />
                          </button>
                        ) : <span className="text-text-3">none</span>}
                      </td>
                      <td className="px-2 py-2 text-text-2">{r.status || '—'}</td>
                    </tr>
                    {openFlags && r.flags.length > 0 && (
                      <tr className="bg-surface-2/50">
                        <td colSpan={8} className="px-4 py-2">
                          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-3">
                            What the résumé analysis flagged for {r.name}
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {r.flags.map((f) => (
                              <li key={f} className="flex items-start gap-1.5 text-[12.5px] leading-[1.55] text-text-2">
                                <AlertTriangle size={11} className="mt-[3px] shrink-0 text-tint-fg-amber" />
                                <span>
                                  <span className="font-semibold text-text-1">{FLAG_LABEL[f] ?? f}</span>
                                  {FLAG_MEANS[f] && <> — {FLAG_MEANS[f]}</>}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1.5 text-[11.5px] text-text-3">
                            Each flag costs 0.75 of the score above. They inform; none of them refuses
                            anybody — a flagged person with the decision Advance is still ranked.
                          </p>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {stats.ranked.length > 25 && (
          <p className="border-t border-border/60 px-4 py-2 text-[11.5px] text-text-3">
            …and {stats.ranked.length - 25} more eligible candidates below the cut.
          </p>
        )}
      </Card>

      {/* ── the authorization loop ── */}
      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-tint-fg-mint" />
              <h2 className="text-[13.5px] font-bold text-text-1">Authorization to proceed</h2>
            </div>
            <p className="mt-1 max-w-[640px] text-[12px] leading-[1.6] text-text-3">
              One press sends the current top 5 to the three leaders — a letter with each candidate's
              scores, stage and red flags, plus an SMS pointing at it — and the platform waits for
              their reply. The reply decides: whoever they name moves into the hiring-process entry
              on the next hourly sweep. One open ask per candidate.
            </p>
          </div>
          <button
            onClick={requestAuth}
            disabled={asking || top5.length === 0}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60"
          >
            {asking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {asking ? 'Sending…' : 'Request authorization'}
          </button>
        </div>

        <div className="mt-3 divide-y divide-border/40 rounded-md border border-border/60">
          {top5.length === 0 && (
            <p className="px-3 py-4 text-center text-[12.5px] italic text-text-3">
              No eligible candidate stands yet — the ask needs a ranking first.
            </p>
          )}
          {top5.map((r) => {
            const ask = askByCandidate[r.candidate_id]
            const st = ask ? ASK_STATE[ask.state] : undefined
            const nota = notaOf(r.composite_score)
            return (
              <div key={r.candidate_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-5 font-stat text-[13px] font-bold tabular-nums text-text-1">{r.rank}</span>
                <DragPerson name={r.name} id={r.candidate_id} type="staff" subtitle={`#${r.rank} · ${r.status || 'in the store'}`} className="shrink-0">
                  <Avatar name={r.name} size="xs" />
                </DragPerson>
                <span className="min-w-[140px] text-[12.5px] font-semibold text-text-1">
                  <DragPerson name={r.name} id={r.candidate_id} type="staff" subtitle={`#${r.rank} · ${r.status || 'in the store'}`}>{r.name}</DragPerson>
                </span>
                {nota !== null && (
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums', notaChip(nota))}>
                    {nota.toFixed(1)}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  {ask && ask.state === 'requested' && (
                    <span className="flex items-center gap-1 text-[11px] text-text-3">
                      <Clock size={11} /> asked {when(ask.requested_at)}
                    </span>
                  )}
                  {ask && ask.reply_analyzed_at && (
                    <span className="flex items-center gap-1 text-[11px] text-text-3" title={ask.reply_from}>
                      <Mail size={11} /> replied {when(ask.reply_analyzed_at)}
                    </span>
                  )}
                  <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                    st ? st.chip : 'bg-surface-2 text-text-3')}>
                    {st ? st.label : 'not asked yet'}
                  </span>
                </span>
              </div>
            )
          })}
        </div>

        {asks.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Every ask on the record</h3>
            <div className="divide-y divide-border/40 rounded-md border border-border/60">
              {[...asks]
                .sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at))
                .slice(0, 12)
                .map((a) => {
                  const st = ASK_STATE[a.state]
                  return (
                    <div key={a.ask_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[12px]">
                      {a.state === 'moved' ? <CheckCircle2 size={13} className="shrink-0 text-tint-fg-mint" />
                        : a.state === 'denied' ? <XCircle size={13} className="shrink-0 text-tint-fg-pink" />
                        : <MessageSquare size={13} className="shrink-0 text-text-3" />}
                      <span className="font-semibold text-text-1">
                        #{a.rank}{' '}
                        <DragPerson name={a.candidate_name} id={a.candidate_id} type="staff" subtitle={`#${a.rank} on the ranking`}>{a.candidate_name}</DragPerson>
                      </span>
                      <span className="text-text-3">asked {when(a.requested_at)} by {a.requested_by}</span>
                      {a.reply_verdict && (
                        <span className="text-text-3">· {a.reply_verdict} by {a.reply_from || 'a leader'}</span>
                      )}
                      {a.moved_at && <span className="text-text-3">· moved {when(a.moved_at)}</span>}
                      <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                        st ? st.chip : 'bg-surface-2 text-text-3')}>
                        {st ? st.label : a.state}
                      </span>
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Analysis"
      subtitle="The whole hiring reality — the process, the three books and what each one is waiting on — then the legacy store's own record and the ranking the authorization ask acts on."
    />
  )
}

// ══════════════════════════════════════════════════════════════════════════ THE REALITY — the process, the books…

function RealitySection({ reality }: { reality: Analysis | null | false }) {
  if (reality === null) {
    return (
      <p className="mt-5 flex items-center gap-2 text-[13px] text-text-3">
        <Loader2 size={14} className="animate-spin" /> Crossing the three books…
      </p>
    )
  }
  if (reality === false) {
    // NOT AN EMPTY COMPANY — a file that is not there. Said in those words.
    return (
      <Card className="mt-5 p-4">
        <p className="text-[12.5px] text-warning">
          The crossed analysis has not been built yet. That is the builder, not the company: the
          numbers below still stand on their own, and this section fills itself on the next pass.
        </p>
      </Card>
    )
  }

  const { process, books, conditions, parked, notas } = reality
  const owed = conditions.filter((c) => c.missing + c.pending > 0).slice(0, 8)
  const maxOwed = Math.max(...owed.map((c) => c.missing + c.pending), 1)
  const unfinished = books.unfinished

  return (
    <>
      {/* ── the four books, as one line of counts ── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="In the process, right now" value={String(process.total)} />
        <StatTile label="In the store, deduplicated" value={String(books.store.count)} />
        <StatTile label="Application forms on file" value={String(books.book.count)} />
        <StatTile
          label={books.book.signed_strangers === 1 ? 'Signed, in no other book' : 'Signed, in no other book'}
          value={String(books.book.signed_strangers)}
        />
      </div>

      {/* ── the funnel ── */}
      <Card className="mt-4 p-4">
        <ChartTitle
          title="Where everybody is, and how long they have been there"
          note={`${process.total} card${process.total === 1 ? '' : 's'} on the board`}
        />
        <p className="mt-1 text-[11.5px] leading-[1.55] text-text-3">
          The days come off <span className="text-text-2">log_status_history</span> — the arrival at
          the stage, not the row's last touch. A card whose status somebody typed straight into the
          sheet has no arrival at all, and is counted in the stage without being aged.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {process.stages.map((s) => (
            <div key={s.id} className="rounded-md border border-border/60 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-text-1">{s.label}</span>
                <span className="font-stat text-[16px] font-bold tabular-nums text-text-1">{s.count}</span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-text-3">
                {s.count === 0 ? 'nobody here'
                  : s.median_days === null ? `${s.no_arrival} with no recorded arrival`
                    : <>typically <span className="text-text-2">{s.median_days}d</span> in this stage
                      {s.longest_days !== null && s.longest_who && (
                        <> · longest {s.longest_days}d (
                          <DragPerson name={s.longest_who} type="staff" subtitle={`${s.longest_days}d in ${s.label}`}>{s.longest_who}</DragPerson>
                          )</>
                      )}
                      {s.no_arrival > 0 && <> · {s.no_arrival} unaged</>}
                    </>}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* ── what the process is actually waiting on ── */}
        <Card className="p-4">
          <ChartTitle title="What the process is waiting on" note="every card's checklist, added up" />
          <p className="mt-1 text-[11.5px] text-text-3">
            The card shows one person's squares. Nobody was adding them up — this is the debt of the
            whole board, heaviest first.
          </p>
          <div className="mt-3 space-y-2">
            {owed.length === 0 && (
              <p className="py-3 text-center text-[12.5px] italic text-text-3">
                Nothing is owed anywhere. That is rare enough to be worth checking twice.
              </p>
            )}
            {owed.map((c) => (
              <div key={c.id} title={c.waiting_names.filter(Boolean).join(', ')}>
                <div className="mb-0.5 flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[12px] font-medium text-text-2">
                    {c.label}
                    {c.owner && <span className="ml-1.5 text-[11px] text-text-3">{c.owner}</span>}
                  </span>
                  <span className="font-stat text-[12px] font-bold tabular-nums text-text-1">
                    {c.missing + c.pending}<span className="font-normal text-text-3">/{c.people}</span>
                  </span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full" style={{ width: `${(c.missing / maxOwed) * 100}%`, background: 'var(--tint-pink-fg)' }} />
                  <div className="h-full" style={{ width: `${(c.pending / maxOwed) * 100}%`, background: 'var(--tint-amber-fg)' }} />
                </div>
              </div>
            ))}
          </div>
          {owed.length > 0 && (
            <div className="mt-3 flex gap-4">
              <LegendRow tint="pink" label="missing" value={owed.reduce((a, c) => a + c.missing, 0)} />
              <LegendRow tint="amber" label="pending" value={owed.reduce((a, c) => a + c.pending, 0)} />
            </div>
          )}
        </Card>

        {/* ── the envelope book ── */}
        <Card className="p-4">
          <ChartTitle title="The application book" note="mirrored from Dropbox Sign, hourly" />
          {/* A BOOK THAT COULD NOT BE READ IS NOT AN EMPTY BOOK — the trap this
              whole slice was written to avoid, so it must not be sprung here.
              `sources.recruitment` is null until the builder has written that
              file, and zeros drawn in its place would read as "nobody ever
              applied to work here". */}
          {reality.sources.recruitment === null ? (
            <p className="mt-3 text-[12.5px] leading-[1.6] text-warning">
              The application book has not been sliced yet, so none of it is counted here — that is a
              missing file, not an empty book. It fills on the next build after the engine starts
              serving the envelope list.
            </p>
          ) : (
          <>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <ThemedDonut
              slices={[
                { label: 'Signed', value: books.book.signed, tint: 'mint' as const },
                { label: 'Still out', value: books.book.pending, tint: 'amber' as const },
                { label: 'Declined', value: books.book.declined, tint: 'pink' as const },
              ].filter((s) => s.value > 0)}
              centerLabel="forms"
              size={140}
            />
            <div className="min-w-[150px] flex-1 space-y-1.5">
              <LegendRow tint="mint" label="Signed" value={books.book.signed} />
              <LegendRow tint="amber" label="Still out" value={books.book.pending} />
              <LegendRow tint="pink" label="Declined" value={books.book.declined} />
            </div>
          </div>
          <p className="mt-3 text-[11.5px] leading-[1.55] text-text-3">
            Of the signed forms: <span className="text-text-2">{books.book.signed_on_board}</span> are
            already cards here, <span className="text-text-2">{books.book.signed_in_store}</span> are in
            the store, and <span className="text-text-1 font-semibold">{books.book.signed_strangers}</span> are
            in neither — they applied and became nothing anywhere. They are the ones the crossing queue
            in Actions offers.
          </p>
          </>
          )}
        </Card>
      </div>

      {/* ── the eleven nobody answers ── */}
      {unfinished.length > 0 && (
        <Card padded={false} className="mt-4 overflow-hidden">
          <div className="border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-tint-fg-amber" />
              <h2 className="text-[13.5px] font-bold text-text-1">
                Applications nobody finished — and nobody answers
              </h2>
              <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11.5px] font-bold', TINT_BG.amber, TINT_FG.amber)}>
                {unfinished.length}
              </span>
            </div>
            <p className="mt-1.5 max-w-[860px] text-[12px] leading-[1.6] text-text-3">
              People who began the application form and stopped, or said no. The crossing queue only
              ever offers a SIGNED envelope, so until this list existed they were in no screen at all.
              Nothing here is chased automatically — an unsigned application is a person who has not
              finished applying, and that is a call somebody makes, not a machine.
            </p>
          </div>
          <div className="divide-y divide-border/60">
            {unfinished.map((u) => (
              <div key={u.srid} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                {/* an envelope with no name on it stays exactly as it reads —
                    DragPerson hands the children back untouched */}
                <DragPerson name={u.name || ''} type="staff" subtitle="Application never finished" className="shrink-0">
                  <Avatar name={u.name || '—'} size="xs" />
                </DragPerson>
                <span className="min-w-[150px] text-[12.5px] font-semibold text-text-1">
                  <DragPerson name={u.name || ''} type="staff" subtitle="Application never finished">
                    {u.name || 'No name on the envelope'}
                  </DragPerson>
                </span>
                <span className="text-[12px] text-text-3">{u.email || '—'}</span>
                <span className="text-[12px] tabular-nums text-text-3">{formatPhoneDisplay(u.phone) || '—'}</span>
                {u.location && <span className="text-[12px] text-text-3">{u.location}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-[11px] text-text-3">started {u.applied || '—'}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                    u.status === 'declined' ? cn(TINT_BG.pink, TINT_FG.pink) : cn(TINT_BG.amber, TINT_FG.amber))}>
                    {u.status === 'declined' ? 'declined' : 'never signed'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── parked at Ready ── */}
      {parked.standing.length > 0 && (
        <Card className="mt-4 p-4">
          <ChartTitle
            title="Standing at Ready to start"
            note={parked.told ? `${parked.told} already told the deciders` : 'nobody has been chased yet'}
          />
          <p className="mt-1 text-[11.5px] leading-[1.55] text-text-3">
            The parking clock speaks every seven days and renews itself; it ends on evidence — the card
            leaving Ready — never on a reply. `notices` is the ask book's own count, not a guess.
          </p>
          <div className="mt-3 divide-y divide-border/40 rounded-md border border-border/60">
            {parked.standing.map((p) => (
              <div key={p.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[12px]">
                <ShieldCheck size={12} className="shrink-0 text-text-3" />
                <span className="font-semibold text-text-1">
                  <DragPerson name={p.name} type="staff" subtitle="Standing at Ready to start">{p.name}</DragPerson>
                </span>
                <span className="text-text-3">
                  {p.days === null ? 'no recorded arrival' : `${p.days} day${p.days === 1 ? '' : 's'} here`}
                </span>
                <span className="ml-auto text-[11px] text-text-3">
                  {p.notices ? `${p.notices} of ${p.of} notices · last ${p.last_at || '—'}` : 'not chased'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── the store, in one line, before its own section ── */}
      <p className="mt-4 text-[11.5px] leading-[1.6] text-text-3">
        The store holds <span className="text-text-2">{books.store.count}</span> people —{' '}
        <span className="text-text-2">{notas.scored}</span> with a nota (average{' '}
        <span className="text-text-2">{notas.average ?? '—'}</span>:{' '}
        {notas.strong} strong, {notas.middle} middle, {notas.weak} weak) and{' '}
        <span className="text-text-2">{notas.unscored}</span> with none, because a row typed in by hand
        has no analysis line and therefore cannot be ranked. Its own verdicts:{' '}
        {books.store.by_status.slice(0, 5).map((s, i) => (
          <span key={s.status}>{i ? ' · ' : ''}<span className="text-text-2">{s.count}</span> {s.status}</span>
        ))}.
      </p>
    </>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3.5">
      <p className="font-stat text-[22px] font-bold leading-7 text-text-1">{value}</p>
      <p className="text-[11px] font-medium text-text-3">{label}</p>
    </Card>
  )
}

function ChartTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-text-1">
        <BarChart3 size={13} className="text-text-3" /> {title}
      </h2>
      {note && <span className="text-[11px] text-text-3">{note}</span>}
    </div>
  )
}

/** A ranked bar whose label owns its row — the value sits beside it, the bar under it. */
function RankedBar({ label, count, max, tint }: { label: string; count: number; max: number; tint: TintName }) {
  return (
    <div title={`${label}: ${count}`}>
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-text-2">{label}</span>
        <span className="font-stat text-[12px] font-bold tabular-nums text-text-1">{count}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(count > 0 ? 3 : 0, (count / max) * 100)}%`, background: `var(--tint-${tint === 'green' ? 'mint' : tint}-fg)` }}
        />
      </div>
    </div>
  )
}

function LegendRow({ tint, label, value }: { tint: TintName; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--tint-${tint === 'green' ? 'mint' : tint}-fg)` }} />
      <span className="text-text-2">{label}</span>
      <span className="ml-auto font-stat font-bold tabular-nums text-text-1">{value}</span>
    </div>
  )
}
