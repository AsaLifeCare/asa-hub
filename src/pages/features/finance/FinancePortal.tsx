// Client Finances — one screen for the money held on a client's behalf.
// The portal this replaces answered the question in three places: a client list, a transactions page and a balances…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import Skeleton from '@/components/shared/Skeleton'
import { gasAction } from '@/features/hiring/shared'
import { cn } from '@/lib/utils'
import FinanceAnalytics from './FinanceAnalytics'
import FinanceDocs from './FinanceDocs'
import FinanceLedger, { type Vocab } from './FinanceLedger'
import { type FinClient } from './NewTransactionModal'
import { thisMonth } from './financeMonth'

type CountedClient = FinClient & { missingReceipts?: number }

export default function FinancePortal() {
  const [clients, setClients] = useState<CountedClient[] | null>(null)
  const [vocab, setVocab] = useState<Vocab>({ fundTypes: [], categories: [], txnTypes: [], exemptReasons: [] })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [month, setMonth] = useState(thisMonth())
  // ASAINTELLIGENCE'S SOURCES joined later: the ledger stays the default; the Analytics and Documents views read…
  const [view, setView] = useState<'ledger' | 'analytics' | 'docs'>('ledger')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    gasAction<{ clients: FinClient[]; fundTypes: string[]; categories: string[]; txnTypes: string[]; exemptReasons: string[] }>('finClients', {})
      .then((r) => {
        if (!alive) return
        setClients(r.clients)
        setVocab({ fundTypes: r.fundTypes, categories: r.categories, txnTypes: r.txnTypes,
                   exemptReasons: r.exemptReasons ?? [] })
        if (r.clients.length) setSelected((s) => s || r.clients[0].name)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'The client list could not be read.'))
    return () => { alive = false }
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (clients ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || (c.house ?? '').toLowerCase().includes(q))
  }, [clients, query])

  const refreshCounts = useCallback(() => {
    gasAction<{ clients: CountedClient[] }>('finClientCounts', { month })
      .then((r) => setClients((prev) => (prev ?? []).map((c) => {
        const hit = r.clients.find((x) => x.name === c.name)
        return hit ? { ...c, missingReceipts: hit.missingReceipts } : c
      })))
      .catch(() => { /* the badge is a nicety; its absence must not break the screen */ })
  }, [month])

  useEffect(() => { if (clients) refreshCounts() }, [month, refreshCounts]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full px-5 py-6">
      <PageHeader
        title="Client Finances"
        subtitle="Balances, spending and receipts held on a client’s behalf."
      />

      {error && (
        <p className="mb-4 rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
      )}

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── who ───────────────────────────────────────────── */}
        <Card padded={false} className="h-fit overflow-hidden">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients or houses…"
                className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
              />
            </div>
          </div>
          <div className="scroll-thin max-h-[calc(100dvh-280px)] overflow-y-auto p-2">
            {!clients ? (
              <div className="space-y-2 p-1">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : shown.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12.5px] text-text-3">No client matches that.</p>
            ) : shown.map((c) => (
              // type client: these are the people whose money is held, not staff
              <DragPerson
                key={c.name} name={c.name} type="client" subtitle={c.house}
                className="block"
                title={`Open ${c.name}’s money — or drag them to the top-left to focus the workspace on them`}
              >
                <button
                  onClick={() => setSelected(c.name)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    selected === c.name ? 'bg-tint-blue' : 'hover:bg-surface-2',
                  )}
                >
                  <Avatar name={c.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[13px] font-semibold', selected === c.name ? 'text-tint-fg-blue' : 'text-text-1')}>
                      {c.name}
                    </span>
                    {c.house && <span className="block truncate text-[11.5px] text-text-3">{c.house}</span>}
                  </span>
                  {/* The count is why somebody opens this app — it belongs beside
                      the name, not two clicks in. Absent when it is zero. */}
                  {!!c.missingReceipts && (
                    <span className="shrink-0 rounded-full bg-tint-amber px-1.5 py-0.5 text-[10.5px] font-bold text-tint-fg-amber">
                      {c.missingReceipts}
                    </span>
                  )}
                </button>
              </DragPerson>
            ))}
          </div>
        </Card>

        {/* ── their month ───────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center gap-1.5">
            {([['ledger', 'Ledger'], ['analytics', 'Analytics'], ['docs', 'Documents']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
                  view === id ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {view === 'analytics' && <FinanceAnalytics client={selected} />}
          {view === 'docs' && <FinanceDocs />}
          {/* kept mounted behind the other views, so coming back does not read the month again */}
          <div hidden={view !== 'ledger'}>
            <FinanceLedger
              client={selected}
              clients={clients ?? []}
              vocab={vocab}
              month={month}
              onMonth={setMonth}
              onChanged={refreshCounts}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
