// ASAINTELLIGENCE'S ANALYTICS, ON THE HUB — the sources of Client Finances, as the old platform already holds them.
// Everything here is the relay's /finance/analytics answer — the old platform's own deterministic rollups over the…
import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Pane from './Pane'
import { gasAction } from '@/features/hiring/shared'
import { cn } from '@/lib/utils'

type Analytics = {
  kpis: { txns: number; clients: number; spent: number; deposits: number; net: number; avgTxn: number }
  byFund: { fund: string; count: number; spent: number; deposits: number }[]
  byCategory: { category: string; count: number; spent: number }[]
  monthly: { month: string; count: number; spent: number; deposits: number }[]
  byClient: { client: string; count: number; spent: number; deposits: number; net: number }[]
  topVendors: { vendor: string; count: number; spent: number }[]
  compliance: { total: number; withReceipt: number; exempt: number; missing: number }
  flags: { label: string; detail: string }[]
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const BAR_TINTS = ['bg-tint-fg-blue', 'bg-tint-fg-mint', 'bg-tint-fg-amber', 'bg-tint-fg-pink', 'bg-tint-fg-lavender', 'bg-tint-fg-peach']

// `lockClient` is the client record: the scope is that client alone, with no "Every client" toggle and no by-client…
export default function FinanceAnalytics({ client, lockClient = false, flat = false }: {
  client: string
  lockClient?: boolean
  flat?: boolean
}) {
  const track = flat ? 'bg-surface-3' : 'bg-surface-2'
  const [picked, setScope] = useState<'all' | 'client'>('all')
  const scope = lockClient ? 'client' : picked
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    if (lockClient && !client) {
      setError('No client is named, so no analytics were read.')
      return
    }
    gasAction<Analytics>('finAnalytics', scope === 'client' && client ? { client } : {})
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'The analytics could not be read.') })
    return () => { alive = false }
  }, [scope, client, lockClient])

  if (error) {
    return <Pane flat={flat}><p className="py-6 text-center text-[13px] text-text-2">{error}</p></Pane>
  }
  if (!data) {
    return (
      <Pane flat={flat}>
        <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the transaction book itself…
        </p>
      </Pane>
    )
  }

  const maxMonthly = Math.max(...data.monthly.map((m) => Math.max(m.spent, m.deposits)), 1)
  const maxCat = Math.max(...data.byCategory.map((c) => c.spent), 1)
  const compliancePct = data.compliance.total > 0
    ? Math.round(((data.compliance.withReceipt + data.compliance.exempt) / data.compliance.total) * 100)
    : null

  return (
    <div className="space-y-4">
      {!lockClient && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setScope('all')}
            className={cn('rounded-full border px-3 py-1 text-[12px] font-semibold',
              scope === 'all' ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border text-text-2 hover:bg-surface-2')}
          >
            Every client
          </button>
          <button
            onClick={() => setScope('client')}
            disabled={!client}
            className={cn('rounded-full border px-3 py-1 text-[12px] font-semibold disabled:opacity-40',
              scope === 'client' ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border text-text-2 hover:bg-surface-2')}
          >
            {client || 'Selected client'}
          </button>
        </div>
      )}

      {/* KPIs — the record's column is narrower than the viewport says, so it keeps two across */}
      <div className={cn('grid grid-cols-2 gap-3', !lockClient && 'lg:grid-cols-4')}>
        {[
          { label: 'Transactions on record', v: data.kpis.txns.toLocaleString() },
          { label: 'Spent (all time)', v: usd(data.kpis.spent) },
          { label: 'Deposited', v: usd(data.kpis.deposits) },
          { label: 'Average spend', v: usd(data.kpis.avgTxn) },
        ].map((k) => (
          <Pane flat={flat} key={k.label} className="!p-3.5">
            <p className="font-stat text-[19px] font-bold leading-6 text-text-1">{k.v}</p>
            <p className="clamp-1 text-[11px] text-text-3">{k.label}</p>
          </Pane>
        ))}
      </div>

      {/* flags — the old platform's own warnings, word for word */}
      {data.flags.length > 0 && (
        <div className="space-y-2">
          {data.flags.map((f) => (
            <div key={f.label} className="flex items-start gap-2.5 rounded-lg border border-tint-amber bg-tint-amber px-4 py-2.5 text-tint-fg-amber">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <p className="text-[12.5px] leading-5"><strong>{f.label}</strong> — {f.detail}</p>
            </div>
          ))}
        </div>
      )}

      <div className={cn('grid grid-cols-1 gap-4', !lockClient && 'lg:grid-cols-2')}>
        {/* monthly series */}
        <Pane flat={flat}>
          <h3 className="mb-2 text-[13px] font-bold text-text-1">The last twelve months</h3>
          {data.monthly.length === 0 ? (
            <p className="py-4 text-[12px] italic text-text-3">No dated transactions yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.monthly.map((m) => (
                <div key={m.month} className="flex items-center gap-2 text-[11px] leading-4">
                  <span className="w-14 shrink-0 font-semibold text-text-2">{m.month}</span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className={cn('h-2.5 overflow-hidden rounded-full', track)}>
                      <div className="h-full rounded-full bg-tint-fg-pink" style={{ width: `${(m.spent / maxMonthly) * 100}%` }} title={`spent ${usd(m.spent)}`} />
                    </div>
                    <div className={cn('h-2.5 overflow-hidden rounded-full', track)}>
                      <div className="h-full rounded-full bg-tint-fg-mint" style={{ width: `${(m.deposits / maxMonthly) * 100}%` }} title={`deposited ${usd(m.deposits)}`} />
                    </div>
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums text-text-3">{usd(m.spent)}</span>
                </div>
              ))}
              <p className="pt-1 text-[10.5px] text-text-3">
                <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-tint-fg-pink" />spent</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-tint-fg-mint" />deposited</span>
              </p>
            </div>
          )}
        </Pane>

        {/* categories */}
        <Pane flat={flat}>
          <h3 className="mb-2 text-[13px] font-bold text-text-1">Spend by category</h3>
          {data.byCategory.length === 0 ? (
            <p className="py-4 text-[12px] italic text-text-3">Nothing categorized yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.byCategory.slice(0, 10).map((c, i) => (
                <div key={c.category} className="flex items-center gap-2 text-[11px] leading-4">
                  <span className="clamp-1 w-[110px] shrink-0 text-text-2" title={c.category}>{c.category}</span>
                  <div className={cn('h-3 min-w-0 flex-1 overflow-hidden rounded-full', track)}>
                    <div className={cn('h-full rounded-full', BAR_TINTS[i % BAR_TINTS.length])} style={{ width: `${(c.spent / maxCat) * 100}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums text-text-3">{usd(c.spent)}</span>
                </div>
              ))}
            </div>
          )}
        </Pane>

        {/* funds */}
        <Pane flat={flat}>
          <h3 className="mb-2 text-[13px] font-bold text-text-1">By fund</h3>
          <div className="space-y-1">
            {data.byFund.map((f) => (
              <div key={f.fund} className="flex items-center gap-2 text-[12px] leading-5">
                <span className="min-w-0 flex-1 text-text-2">{f.fund}</span>
                <span className="shrink-0 tabular-nums text-text-3">{f.count}</span>
                <span className="w-20 shrink-0 text-right tabular-nums font-semibold text-text-1">{usd(f.spent)}</span>
              </div>
            ))}
          </div>
        </Pane>

        {/* vendors */}
        <Pane flat={flat}>
          <h3 className="mb-2 text-[13px] font-bold text-text-1">Top vendors <span className="font-normal text-text-3">(spelling variants merged)</span></h3>
          <div className="space-y-1">
            {data.topVendors.map((v) => (
              <div key={v.vendor} className="flex items-center gap-2 text-[12px] leading-5">
                <span className="clamp-1 min-w-0 flex-1 text-text-2" title={v.vendor}>{v.vendor}</span>
                <span className="shrink-0 tabular-nums text-text-3">{v.count}</span>
                <span className="w-20 shrink-0 text-right tabular-nums font-semibold text-text-1">{usd(v.spent)}</span>
              </div>
            ))}
          </div>
        </Pane>
      </div>

      {/* compliance + per-client */}
      <div className={cn('grid grid-cols-1 gap-4', !lockClient && 'lg:grid-cols-2')}>
        <Pane flat={flat}>
          <h3 className="mb-2 text-[13px] font-bold text-text-1">Receipt compliance <span className="font-normal text-text-3">(TrueLink spends)</span></h3>
          {compliancePct === null ? (
            <p className="py-3 text-[12px] italic text-text-3">No TrueLink spends on record.</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-stat text-[26px] font-bold leading-none text-text-1">{compliancePct}%</span>
                <span className="text-[12px] text-text-3">covered ({data.compliance.withReceipt} receipts + {data.compliance.exempt} exempt of {data.compliance.total})</span>
              </div>
              <div className={cn('mt-2 h-2.5 overflow-hidden rounded-full', track)}>
                <div className="h-full rounded-full bg-tint-fg-mint" style={{ width: `${compliancePct}%` }} />
              </div>
              {data.compliance.missing > 0 && (
                <p className="mt-2 text-[12px] font-semibold text-tint-fg-amber">{data.compliance.missing} still missing a receipt.</p>
              )}
            </>
          )}
        </Pane>

        {!lockClient && <Pane flat={flat}>
          <h3 className="mb-2 text-[13px] font-bold text-text-1">By client</h3>
          <div className="scroll-thin max-h-[240px] space-y-1 overflow-y-auto pr-1">
            {data.byClient.map((c) => (
              <div key={c.client} className="flex items-center gap-2 text-[12px] leading-5">
                <span className="clamp-1 min-w-0 flex-1 text-text-2" title={c.client}>{c.client}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-text-3">{usd(c.spent)}</span>
                <span className={cn('w-20 shrink-0 text-right tabular-nums font-semibold', c.net < 0 ? 'text-tint-fg-pink' : 'text-text-1')}>{usd(c.net)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 border-t border-border pt-1.5 text-[10.5px] text-text-3">spent · net (deposits − spend), the old platform's own arithmetic</p>
        </Pane>}
      </div>

      <p className="px-1 text-[11.5px] text-text-3">
        Computed live from the TrueLink transaction book itself plus the hub's own entries — the same sources everyone drinks from, nobody's copy.
      </p>
    </div>
  )
}
