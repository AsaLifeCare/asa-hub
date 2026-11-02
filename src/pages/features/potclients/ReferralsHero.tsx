// The black header over Pipeline, Compare, the Funnel and the Unique screen: Compare's headline figures…
// Unread or failed is "—" plus a sentence, never a 0.
import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ArrowRight, Loader2, RotateCw } from 'lucide-react'
import { heroBand, type ExtendedTintName } from '@/lib/tints'
import { cn } from '@/lib/utils'
import {
  EXPIRING_DAYS, RANK_MAX, WORTH_CALL_ABOVE, standingOf,
  type Lead, type ReferralGap,
} from '@/lib/referralAnalysis'
import { usePotClientsPolicyStore } from '@/stores/usePotClientsViewsStore'
import type { ReferralRead } from './useReferralAnalysis'

/** The sections of Compare a figure can open on (Compare scrolls to `?focus=`). */
export type CompareFocus = 'distribution' | 'zip' | 'funding' | 'top'
const COMPARE_PATH = '/app/potential-clients/compare'
const compareHref = (focus?: CompareFocus | null): string => (focus ? `${COMPARE_PATH}?focus=${focus}` : COMPARE_PATH)
const profileHref = (id: string): string => `/app/potential-clients/unique?record=${encodeURIComponent(id)}`

type Target = { to: string; hint: string } | null

const GAP_FOCUS: Record<ReferralGap['key'], { focus: CompareFocus; hint: string } | null> = {
  unscored: { focus: 'distribution', hint: 'The score distribution, on Compare' },
  unfunded: { focus: 'funding', hint: 'Who pays, on Compare' },
  unreachable: null,
  expired: null,
}

const EYEBROW = 'text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45'

export default function ReferralsHero({
  read,
  on,
  record,
  onRetry,
}: {
  read: ReferralRead
  /** the screen it sits on — Compare links to its own sections, not to itself */
  on: 'pipeline' | 'compare' | 'funnel' | 'unique'
  /** the one referral being read, when a screen is reading one */
  record?: Lead | null
  onRetry?: () => void
}) {
  const views = usePotClientsPolicyStore((s) => s.views)
  const ensure = usePotClientsPolicyStore((s) => s.ensure)
  useEffect(() => { ensure() }, [ensure])
  const compareOpen = views.includes('compare')
  const uniqueOpen = views.includes('unique')

  const a = read.state === 'ready' ? read.analysis : null
  const dash = '—'
  const pending = read.state === 'failed' ? 'unknown — the read failed' : 'not read yet'
  const fmt = (n: number) => n.toLocaleString()

  /** The section of Compare that explains a figure; with none, the figure stays plain text. */
  const toCompare = (focus: CompareFocus, hint: string): Target =>
    compareOpen ? { to: compareHref(focus), hint } : null

  const leader = a?.leader ?? null
  const leaderTarget: Target = leader && uniqueOpen && String(leader.row.id ?? '')
    ? { to: profileHref(String(leader.row.id)), hint: `Open ${String(leader.row.client_name ?? 'this referral')}’s profile` }
    : toCompare('top', 'The top twelve, compared')

  // The open referral's place in the SAME ranking — null while the read has not answered, and null too when the…
  const standing = standingOf(a, String(record?.id ?? ''))

  const gap = a?.gap ?? null
  const gapFocus = gap ? GAP_FOCUS[gap.key] : null
  const small: { label: string; tint: ExtendedTintName; value: number | null; target: Target }[] = [
    { label: `Worth the call (>${WORTH_CALL_ABOVE})`, tint: 'mint', value: a?.worthCall ?? null, target: toCompare('distribution', 'The score distribution, on Compare') },
    { label: `Expiring ≤${EXPIRING_DAYS}d`, tint: 'amber', value: a?.expiring ?? null, target: null },
    { label: 'Already expired', tint: 'pink', value: a?.expired ?? null, target: null },
    { label: 'Reachable', tint: 'blue', value: a?.reachable ?? null, target: null },
    { label: 'Funding named', tint: 'peach', value: a?.funded ?? null, target: toCompare('funding', 'Who pays, on Compare') },
  ]

  const replace = on === 'compare'
  const topZip = a?.byZip[0] ?? null

  return (
    <section
      aria-label="Potential clients — the numbers that decide"
      aria-busy={read.state === 'loading'}
      className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className={EYEBROW}>Referrals · the numbers that decide</p>
        {on !== 'compare' && compareOpen && (
          <Link
            to={COMPARE_PATH}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            Compare <ArrowRight size={13} />
          </Link>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:gap-0">
        <div className="min-w-0 xl:pr-6">
          <Go target={toCompare('distribution', 'The score distribution, on Compare')} replace={replace}>
            <p className={EYEBROW}>On file</p>
            <p className="mt-2 font-stat text-[44px] leading-none text-white">{a ? fmt(a.total) : dash}</p>
            <p className="mt-1.5 text-[12px] leading-[18px] text-white/60">
              {a ? `${fmt(a.scored)} scored · ${fmt(a.unscored)} not yet scored` : pending}
            </p>
          </Go>
        </div>

        <div className="min-w-0 xl:border-l xl:border-white/10 xl:px-6">
          {record ? (
            // A screen reading ONE referral answers the question it is on: where does this one sit among the others…
            <Go target={toCompare('top', 'The top twelve, compared')} replace={replace}>
              <p className={EYEBROW}>This referral</p>
              <div className="mt-2 flex h-[44px] min-w-0 items-end gap-2">
                <span className="font-stat text-[44px] leading-none text-white">{standing ? `#${fmt(standing.place)}` : dash}</span>
                {standing && (
                  <span className="mb-[3px] shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 font-stat text-[12px] text-white/90">
                    {standing.rank}/{RANK_MAX}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[12px] leading-[18px] text-white/60">
                {standing
                  ? `of ${fmt(standing.of)} ranked · ${standing.why.join(' · ')}`
                  : a
                    ? 'this referral is not in the read'
                    : pending}
              </p>
            </Go>
          ) : (
            <Go target={leaderTarget} replace={replace}>
              <p className={EYEBROW}>First in the ranking</p>
              <div className="mt-2 flex h-[44px] min-w-0 items-end gap-2">
                <span className="truncate text-[20px] font-semibold leading-tight text-white">
                  {leader ? String(leader.row.client_name ?? '').trim() || 'Unnamed referral' : a ? 'No referral on file' : dash}
                </span>
                {leader && (
                  <span className="mb-[3px] shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 font-stat text-[12px] text-white/90">
                    {leader.rank}/{RANK_MAX}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[12px] leading-[18px] text-white/60">
                {leader ? leader.why.join(' · ') : a ? 'nothing to rank' : pending}
              </p>
            </Go>
          )}
        </div>

        <div className="min-w-0 xl:border-l xl:border-white/10 xl:px-6">
          <Go target={toCompare('top', 'The top twelve, compared — send them to the funnel')} replace={replace}>
            <p className={EYEBROW}>Waiting on a decision</p>
            <p className="mt-2 font-stat text-[44px] leading-none text-white">{a ? fmt(a.waiting) : dash}</p>
            <p className="mt-1.5 text-[12px] leading-[18px] text-white/60">
              {!a
                ? pending
                : a.top.length === 0
                  ? 'nothing ranked yet'
                  : a.waiting
                    ? `of the top ${a.top.length} not on the board yet`
                    : `the top ${a.top.length} are all on the board`}
            </p>
          </Go>
        </div>

        <div className="min-w-0 xl:border-l xl:border-white/10 xl:pl-6">
          <Go target={gapFocus ? toCompare(gapFocus.focus, gapFocus.hint) : null} replace={replace}>
            <p className={EYEBROW}>Biggest gap</p>
            <p className="mt-2 font-stat text-[44px] leading-none text-white">
              {!a ? dash : gap ? fmt(gap.n) : 'None'}
            </p>
            <p className="mt-1.5 text-[12px] leading-[18px] text-white/60">
              {!a ? pending : gap ? `${gap.label} · of ${fmt(a.total)}` : 'every referral scored, reachable, funded and open'}
            </p>
          </Go>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2.5 border-t border-white/10 pt-4">
        {small.map((s) => (
          <Go key={s.label} target={s.target} replace={replace} inline>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: heroBand(s.tint) }} />
            <span className="font-stat text-[16px] leading-none text-white">{s.value === null ? dash : fmt(s.value)}</span>
            <span className="text-[12px] text-white/55">{s.label}</span>
          </Go>
        ))}
      </div>

      <div className="mt-4 text-[12px] leading-[1.6] text-white/55">
        {read.state === 'loading' && (
          <p className="inline-flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" /> Reading the referrals…
          </p>
        )}
        {read.state === 'failed' && (
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2" style={{ color: heroBand('amber') }}>
            <p className="flex min-w-0 flex-1 items-start gap-2">
              <AlertTriangle size={13} className="mt-[3px] shrink-0" />
              <span>
                The referrals could not be read, so these figures are unknown — not zero.
                {read.reason ? ` ${read.reason}` : ''}
              </span>
            </p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-white/15"
              >
                <RotateCw size={12} /> Try again
              </button>
            )}
          </div>
        )}
        {a && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Ranked out of {RANK_MAX} on score, reachability, funding, hours and time left</span>
            {topZip && (
              <>
                <span aria-hidden="true">·</span>
                <Go target={toCompare('zip', 'Where they are, on Compare')} replace={replace} inline>
                  most referrals in ZIP {topZip[0]} ({fmt(topZip[1])})
                </Go>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** A figure that opens where it is explained — or stays plain text when nothing does. */
function Go({ target, replace, inline = false, children }: { target: Target; replace: boolean; inline?: boolean; children: ReactNode }) {
  const shape = inline ? 'inline-flex items-center gap-2' : 'block'
  if (!target) return <div className={shape}>{children}</div>
  return (
    <Link
      to={target.to}
      replace={replace && target.to.startsWith(COMPARE_PATH)}
      title={target.hint}
      className={cn(
        shape,
        '-m-1.5 rounded-lg p-1.5 transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
      )}
    >
      {children}
    </Link>
  )
}
