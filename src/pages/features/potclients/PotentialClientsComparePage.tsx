// REFERRALS, SIDE BY SIDE — the page where somebody decides.
// Deciding needs far richer analytics than a list: a comparison page, and then the winners are pushed into the CRM.
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, CheckCircle2, Loader2, MapPin, Moon } from 'lucide-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import Card, { CardHeader } from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import PageHeader from '@/components/shared/PageHeader'
import { api } from '@/lib/api'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import {
  EXPIRING_DAYS, RANK_MAX, SIGNALS, TOP_N, WORTH_CALL_ABOVE, isOnBoard, leadDaysLeft, leadRating, rankOf, type Lead,
} from '@/lib/referralAnalysis'
import { candidateHref } from '@/pages/features/clientcandidates/candidateModel'
import { OPEN_IN_CANDIDATES, useCandidatesOpen } from '@/pages/features/clientcandidates/candidateLink'
import ReferralsHero from './ReferralsHero'
import { useReferralAnalysis } from './useReferralAnalysis'

export default function PotentialClientsComparePage() {
  const nav = useNavigate()
  const { read, patch, retry } = useReferralAnalysis()
  // each entry opens in Client Candidates for whoever may open it (its master until it is released)
  const candidatesOpen = useCandidatesOpen()
  const [busy, setBusy] = useState<string | null>(null)
  const [params] = useSearchParams()
  const { key: visit } = useLocation()
  const focus = params.get('focus')
  const a = read.state === 'ready' ? read.analysis : null
  const ready = a !== null

  // a figure in the header lands on the section that explains it
  useEffect(() => {
    if (!ready || !focus) return
    document.getElementById(`compare-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [ready, focus, visit])

  /** Send one referral to the board. The write is what the funnel reads. */
  const send = async (r: Lead) => {
    const id = String(r.id ?? '')
    if (!id) return
    setBusy(id)
    try {
      // `in_funnel` is the human decision, kept apart from `stage` because the scraper writes `stage: 'new'` on…
      const fields = { in_funnel: 'yes', stage: 'new' }
      await api.update('potentialClients', id, fields)
      patch(id, fields)
      toast({ type: 'success', title: 'On the board', body: `${r.client_name ?? 'The referral'} is in New.` })
    } catch (err) {
      toast({ type: 'danger', title: 'It did not land', body: String((err as Error)?.message ?? err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5 pb-10">
      <ReferralsHero read={read} on="compare" onRetry={retry} />

      <PageHeader
        title="Compare referrals"
        subtitle="Rank the referrals against each other, read the top of the ranking side by side, and send the ones you pick to the funnel."
        actions={
          <button
            onClick={() => nav(-1)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-text-2 hover:bg-surface-2"
          >
            <ArrowLeft size={14} /> Back
          </button>
        }
      />

      {a && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {/* ---------- score distribution ---------- */}
            <div id="compare-distribution" className="scroll-mt-4">
              <Card className="h-full">
                <CardHeader title="Score distribution" sub={`${a.scored} scored · ${a.unscored} unscored`} />
                <div className="space-y-1.5 px-4 pb-4">
                  {a.histogram.map((h) => (
                    <div key={h.n} className="flex items-center gap-2">
                      <span className={cn('w-5 text-right text-[11px] tabular-nums', h.n > WORTH_CALL_ABOVE ? 'font-semibold text-text-1' : 'text-text-3')}>{h.n}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div className={cn('h-full rounded-full', h.n > WORTH_CALL_ABOVE ? 'bg-tint-mint' : 'bg-tint-blue')} style={{ width: `${h.pct}%` }} />
                      </div>
                      <span className="w-8 text-right text-[11px] tabular-nums text-text-3">{h.c}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* ---------- where they are ---------- */}
            <div id="compare-zip" className="scroll-mt-4">
              <Card className="h-full">
                <CardHeader title="Where they are" sub="ZIP, most referrals first" />
                <div className="space-y-2 px-4 pb-4">
                  {a.byZip.length === 0 && <p className="text-[13px] text-text-3">No ZIP on any row.</p>}
                  {a.byZip.map(([zip, n]) => (
                    <div key={zip} className="flex items-center justify-between text-[13px]">
                      <span className="inline-flex items-center gap-1.5 text-text-2"><MapPin size={13} className="text-text-3" />{zip}</span>
                      <span className="tabular-nums text-text-1">{n}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* ---------- who pays ---------- */}
            <div id="compare-funding" className="scroll-mt-4">
              <Card className="h-full">
                <CardHeader title="Who pays" sub="funding source as written" />
                <div className="space-y-2 px-4 pb-4">
                  {a.byFunding.map(([f, n]) => (
                    <div key={f} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className={cn('truncate', f.startsWith('—') ? 'text-text-3 italic' : 'text-text-2')}>{f}</span>
                      <span className="tabular-nums text-text-1">{n}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {/* ---------- the comparison itself ---------- */}
          <div id="compare-top" className="scroll-mt-4">
            <Card>
              <CardHeader
                title={`The top ${TOP_N}, compared`}
                sub={`ranked out of ${RANK_MAX} — score, reachability, funding, hours and time left`}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-[13px]">
                  <thead>
                    <tr className="border-y border-line bg-surface-2/60 text-left text-[11px] uppercase tracking-wide text-text-3">
                      <th className="px-4 py-2 font-medium">Referral</th>
                      <th className="px-3 py-2 font-medium">Rank</th>
                      {SIGNALS.map((s) => <th key={s.key} className="px-3 py-2 font-medium">{s.label}</th>)}
                      <th className="px-3 py-2 font-medium">Expires</th>
                      <th className="px-4 py-2 text-right font-medium">Funnel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.top.map((r) => {
                      const id = String(r.id ?? '')
                      const rank = rankOf(r, a.now)
                      const d = leadDaysLeft(r, a.now)
                      const already = isOnBoard(r)
                      return (
                        <tr key={id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/40">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-text-1">
                              <DragPerson
                                name={String(r.client_name ?? '')}
                                id={id}
                                type="client"
                                subtitle={r.postal_code ? `ZIP ${r.postal_code}` : String(r.diagnosis ?? '').split('\n')[0]}
                              >
                                {String(r.client_name ?? '—')}
                              </DragPerson>
                            </div>
                            <div className="truncate text-[11px] text-text-3" style={{ maxWidth: 260 }}>
                              {String(r.diagnosis ?? '').split('\n')[0] || 'No diagnosis on file'}
                            </div>
                            {candidatesOpen && id && (
                              <Link to={candidateHref(id)} data-open-client-candidates={id}
                                className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                                {OPEN_IN_CANDIDATES} <ArrowUpRight size={11} />
                              </Link>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center rounded-md bg-tint-lavender px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-tint-fg-lavender">
                              {rank}/{RANK_MAX}
                            </span>
                          </td>
                          {SIGNALS.map((s) => {
                            const v = s.of(r, a.now)
                            const blank = s.key === 'score' && leadRating(r) === null
                            return (
                              <td key={s.key} className="px-3 py-2.5 tabular-nums">
                                {blank
                                  ? <span className="text-[11px] italic text-text-3">unscored</span>
                                  : <span className={cn(v === 0 ? 'text-text-3' : 'text-text-1')}>{v}</span>}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2.5">
                            {d === null
                              ? <span className="text-[11px] italic text-text-3">no date</span>
                              : <span className={cn('tabular-nums', d < 0 ? 'text-tint-fg-pink' : d <= EXPIRING_DAYS ? 'text-tint-fg-amber' : 'text-text-2')}>
                                  {d < 0 ? `${-d}d ago` : `${d}d`}
                                </span>}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {already ? (
                              <span className="inline-flex items-center gap-1 text-[12px] text-tint-fg-mint">
                                <CheckCircle2 size={13} /> on the board
                              </span>
                            ) : (
                              <button
                                onClick={() => void send(r)}
                                disabled={busy === id}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-2 disabled:opacity-50"
                              >
                                {busy === id ? <Loader2 size={12} className="animate-spin" /> : <Moon size={12} className="opacity-0" />}
                                Send to funnel
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="px-4 pb-4 pt-3 text-[11px] text-text-3">
                A referral scored above {WORTH_CALL_ABOVE} is already on the board. Sending one from here is for the
                ones the score missed — it writes the decision, it does not change the score.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
