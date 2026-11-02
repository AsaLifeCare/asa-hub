// WHERE ASA LIFECARE STANDS, AND WHAT TO DO ABOUT IT — analytics over these companies and a marketing strategy…
// TWO RULES DECIDED EVERYTHING ON THIS SCREEN.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, ArrowLeft, Building2, Loader2, MapPin, RefreshCw, Target, Users } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card, { CardHeader } from '@/components/shared/Card'
import { gasAction } from '@/features/hiring/shared'
import { marketingFresh, useMarketingCache } from '@/stores/useMarketingCache'
import { cn } from '@/lib/utils'

type Rival = {
  id: string; name: string; type: string; tier: string; location: string
  founded: string; revenue: string; revenue_num: number | null
  staff: string; staff_num: number | null
  served: string; served_num: number | null
  services: string[]; site: string; note: string
}
type Analytics = {
  self: { name: string; clients: number; staff: number; houses: number
          counties: { county: string; clients: number }[]; source: string }
  rivals: Rival[]
  counted: number
  tiers: Record<string, number>
  services: { service: string; rivals: number }[]
  places: { place: string; rivals: number }[]
  unknown: { revenue: number; staff: number; served: number }
  median: { revenue: number | null; staff: number | null; served: number | null }
  /** when this was worked out, and whether it was reused rather than rebuilt */
  built_at?: string
  reused?: boolean
}

const money = (n: number | null) =>
  n === null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`

const TIER_TINT: Record<string, string> = {
  large: 'bg-tint-pink text-tint-fg-pink',
  mid: 'bg-tint-amber text-tint-fg-amber',
  peer: 'bg-tint-mint text-tint-fg-mint',
  unrecorded: 'bg-surface-2 text-text-3',
}

export default function MarketingAnalyticsPage() {
  const navigate = useNavigate()
  const held = useMarketingCache((s) => s.analytics)
  const put = useMarketingCache((s) => s.put)
  // PAINTED BEFORE ANYTHING IS ASKED.
  const [data, setData] = useState<Analytics | null>((held?.data as Analytics) ?? null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // `refresh` is the button, not the page load.
  const load = (refresh: boolean) => {
    setErr('')
    if (refresh) setBusy(true)
    void gasAction<Analytics>('marketingAnalytics', refresh ? { refresh: true } : {}, { timeoutMs: 120_000 })
      .then((d) => { setData(d); put('analytics', d) })
      // A REFRESH THAT FAILS MUST NOT BLANK WHAT IS ON SCREEN.
      .catch((e) => { if (!data) setErr(e instanceof Error ? e.message : 'The comparison did not load.') })
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    // Held and young: the backend keeps its answer for the same half hour, so asking would spend an execution to be…
    if (marketingFresh(held)) return
    load(false)
  }, [])

  if (err) {
    return (
      <div className="w-full">
        <PageHeader title="Analysis & strategy" subtitle="Against the tracked competitors." />
        <p className="rounded-md border border-tint-amber bg-tint-amber/30 px-3 py-2 text-[13px] text-tint-fg-amber">{err}</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex w-full items-center gap-2 p-6 text-[13px] text-text-3">
        <Loader2 size={15} className="animate-spin" /> Reading the sheet and our own rows…
      </div>
    )
  }

  const { self, rivals, unknown, median } = data
  /** Rivals whose recorded reach we can actually compare against ours. */
  const withServed = rivals.filter((r) => r.served_num !== null)
  const biggerThanUs = withServed.filter((r) => (r.served_num ?? 0) > self.clients)
  /** A service nobody else records is an opening; one everybody records is table stakes. */
  const rare = data.services.filter((s) => s.rivals === 1)
  const universal = data.services.filter((s) => s.rivals >= Math.ceil(data.counted * 0.6))
  const ourTowns = new Set(self.counties.map((c) => c.county.toLowerCase()))
  const contested = data.places.filter((p) => [...ourTowns].some((t) => p.place.toLowerCase().includes(t)))

  return (
    <div className="w-full pb-10">
      <PageHeader
        title="Analysis & strategy"
        subtitle={
          `${data.counted} tracked competitors, measured against what this platform knows about us.` +
          (data.built_at
            ? ` · worked out ${new Date(data.built_at).toLocaleString()}${data.reused ? '' : ' (just now)'}`
            : '')
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => load(true)}
              disabled={busy}
              title="Read the sheet and our own rows again, now"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-60"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} />
              {busy ? 'Reading…' : 'Refresh data'}
            </button>
            <button
              onClick={() => navigate('/app/marketing/competitors')}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2"
            >
              <ArrowLeft size={14} /> Competitors
            </button>
          </div>
        }
      />

      {/* WHERE WE STAND — our side is the platform's own count */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Users, label: 'People we serve', value: self.clients, tint: 'bg-tint-mint text-tint-fg-mint' },
          { icon: Building2, label: 'Houses on record', value: self.houses, tint: 'bg-tint-blue text-tint-fg-blue' },
          { icon: Users, label: 'On the roster', value: self.staff, tint: 'bg-tint-lavender text-tint-fg-lavender' },
          { icon: Target, label: 'Counties served', value: self.counties.length, tint: 'bg-tint-peach text-tint-fg-peach' },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <span className={cn('mb-2 grid h-9 w-9 place-items-center rounded-[10px]', s.tint)}>
              <s.icon size={16} />
            </span>
            <p className="text-[24px] font-bold leading-tight text-text-1">{s.value}</p>
            <p className="text-[12px] text-text-3">{s.label}</p>
          </Card>
        ))}
      </div>
      <p className="mb-6 text-[12px] text-text-3">
        Our four numbers are read from {self.source}. Nothing on this page about ASA LifeCare was typed in by hand.
      </p>

      {/* THE TABLE — and the blanks, said out loud */}
      <Card padded={false} className="mb-6 p-5">
        <CardHeader
          title="The field"
          sub={`Median recorded revenue ${money(median.revenue)} · median people served ${median.served ?? '—'}`}
        />
        {(unknown.revenue > 0 || unknown.served > 0 || unknown.staff > 0) && (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-tint-amber bg-tint-amber/25 px-3 py-2 text-[12.5px] text-tint-fg-amber">
            <AlertTriangle size={15} className="mt-px shrink-0" />
            <span>
              The medians above are taken over the rows that carry a figure, and{' '}
              <strong>{unknown.revenue} of {data.counted}</strong> have no revenue recorded,{' '}
              <strong>{unknown.served}</strong> no people-served and <strong>{unknown.staff}</strong> no staff count.
              An unknown is not a zero — treat these as the shape of the field, not its size.
            </span>
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-3">
                <th className="py-2 pr-3">Company</th><th className="py-2 pr-3">Tier</th>
                <th className="py-2 pr-3">Where</th><th className="py-2 pr-3">Revenue</th>
                <th className="py-2 pr-3">Served</th><th className="py-2">Services recorded</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border bg-primary-soft/20">
                <td className="py-2 pr-3 font-semibold text-text-1">{self.name} <span className="text-[11px] font-normal text-text-3">(us)</span></td>
                <td className="py-2 pr-3">—</td>
                <td className="py-2 pr-3">{self.counties.map((c) => c.county).join(', ') || '—'}</td>
                <td className="py-2 pr-3">—</td>
                <td className="py-2 pr-3 font-semibold">{self.clients}</td>
                <td className="py-2 text-text-3">—</td>
              </tr>
              {rivals.map((r) => (
                <tr key={r.id} className="border-b border-border">
                  <td className="py-2 pr-3 font-medium text-text-1">{r.name}</td>
                  <td className="py-2 pr-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase', TIER_TINT[r.tier] ?? TIER_TINT.unrecorded)}>{r.tier}</span>
                  </td>
                  <td className="py-2 pr-3 text-text-2">{r.location || '—'}</td>
                  <td className="py-2 pr-3 text-text-2">{r.revenue || '—'}</td>
                  <td className="py-2 pr-3 text-text-2">{r.served || '—'}</td>
                  <td className="py-2 text-[12px] text-text-3">{r.services.join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* THE STRATEGY — every line carries the number it came from */}
      <Card className="p-5">
        <CardHeader title="What the numbers argue for" sub="Each line is a finding with its evidence beside it — not advice." />
        <ol className="space-y-3.5">
          {[
            {
              head: contested.length
                ? `Defend where you already are: ${contested.length} of the ${data.counted} sit in a county you serve`
                : 'No tracked competitor is recorded in a county you serve',
              body: contested.length
                ? `${contested.map((c) => c.place).join(', ')} overlap the ${self.counties.length} counties on your client records. Referral sources there already know both names; being the one that answers the phone first is worth more than any campaign.`
                : `Your ${self.counties.length} counties are unrecorded on the sheet for every rival. Either the geography is genuinely open, or the sheet has not been filled in — check before spending on it.`,
            },
            {
              head: biggerThanUs.length
                ? `${biggerThanUs.length} recorded competitor${biggerThanUs.length > 1 ? 's serve' : ' serves'} more people than the ${self.clients} on your books`
                : `Nobody with a recorded figure serves more than your ${self.clients}`,
              body: withServed.length < data.counted
                ? `Only ${withServed.length} of ${data.counted} rows record a people-served figure, so this compares you against ${withServed.length} companies, not the field. Filling that column is the cheapest analysis on this page.`
                : 'Every row carries a figure, so this is the whole tracked field.',
            },
            {
              head: universal.length
                ? `Table stakes: ${universal.map((s) => s.service).join(', ')}`
                : 'No service is recorded by a majority of the field',
              body: universal.length
                ? 'Recorded by most of the field, so naming them in your materials differentiates nothing. Say them once, then spend the words elsewhere.'
                : 'Either the field is genuinely fragmented, or the services column is too thin to read — worth ten minutes on the sheet.',
            },
            {
              head: rare.length
                ? `Only one competitor records: ${rare.slice(0, 6).map((s) => s.service).join(', ')}`
                : 'No service is unique to a single competitor',
              body: 'A line nobody else claims is either an opening or a reason nobody bothers. Both are worth knowing before the next referral conversation — and if you already do one of these, it belongs at the top of your page, not in a list.',
            },
            {
              head: `Your own reach is ${self.clients} people across ${self.houses} houses, held by ${self.staff} on the roster`,
              body: 'These come from the platform, so they are the one part of this comparison that is true today and will still be true when somebody re-opens this page. Anything you publish about scale should be generated from here rather than remembered.',
            },
          ].map((f, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-bold text-text-2">{i + 1}</span>
              <div>
                <p className="text-[14px] font-semibold text-text-1">{f.head}</p>
                <p className="mt-0.5 text-[13px] leading-[21px] text-text-2">{f.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-[12px] leading-[18px] text-text-3">
          <MapPin size={14} className="mt-px shrink-0" />
          <span>
            Every figure about a competitor comes from the <code>marketing_competitors</code> tab, which anybody can
            correct. The moment a blank is filled, this page says something different — that is the point of computing
            it rather than writing it.
          </span>
        </p>
      </Card>
    </div>
  )
}
