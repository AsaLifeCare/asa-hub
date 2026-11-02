// The record's Finances tab, with Client Finances merged in rather than beside it: the client row's funding facts…
// No figure is drawn twice: the row's two facts are not in the ledger, and the ledger's are not on the row.
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import FinanceAnalytics from '@/pages/features/finance/FinanceAnalytics'
import FinanceLedger, { type Vocab } from '@/pages/features/finance/FinanceLedger'
import { thisMonth } from '@/pages/features/finance/financeMonth'
import type { ClientRow } from '../shared'
import { ReadError, Row, SectionHead } from './parts'
import { financeClientName, financeNameShared, singleClientPick } from './uniqueTabs'
import { useFinClients, type FinRead } from './useFinClients'

/** `finance`: the Client Finances section, or null for a viewer that app does not admit. */
export function FinancesTab({ client, finance }: {
  client: Pick<ClientRow, 'funding_source' | 'dodd_id'>
  finance: ReactNode
}) {
  return (
    <div className="space-y-4">
      <div>
        <SectionHead>Funding</SectionHead>
        <Row label="Funding source" value={client.funding_source} />
        <Row label="DODD #" value={client.dodd_id} />
      </div>
      {finance ? (
        <div>
          <SectionHead>Client Finances</SectionHead>
          {finance}
        </div>
      ) : null}
      <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-5 text-text-3">
        TrueLink consent, payee representative and self-admin assessments are not held by this platform yet —
        the service plans do not carry them. When a source exists, this tab is where they land.
      </p>
    </div>
  )
}

type View = 'ledger' | 'analytics'

const NOTE = 'rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-5 text-text-3'

// What the section draws from the `finClients` read.
export function ClientFinancesView({ client, read, view, onView, month, onMonth }: {
  client: Pick<ClientRow, 'id' | 'name'>
  read: FinRead
  view: View
  onView: (view: View) => void
  month: string
  onMonth: (month: string) => void
}) {
  if (read.error) return <ReadError>Client Finances could not be read — {read.error}</ReadError>
  if (!read.boot) return <p className="text-[13.5px] text-text-3">Reading Client Finances…</p>

  const clients = read.boot.clients ?? []
  const name = financeClientName(client, clients)
  if (!name) {
    return <p className={NOTE}>This record carries no name, and Client Finances keeps its ledger by name — there is nothing to read it by.</p>
  }
  if (financeNameShared(client, name, clients)) {
    return (
      <p className={NOTE}>
        More than one client on file is named “{name}”. Client Finances keeps its ledger by name alone, so it cannot
        tell them apart — no balance, transaction or action is shown here.
      </p>
    )
  }

  const pick = singleClientPick(name, clients.find((c) => c.name === name)?.house || undefined)
  const vocab: Vocab = {
    fundTypes: read.boot.fundTypes ?? [], categories: read.boot.categories ?? [],
    txnTypes: read.boot.txnTypes ?? [], exemptReasons: read.boot.exemptReasons ?? [],
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        {([['ledger', 'Ledger'], ['analytics', 'Analytics']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => onView(id)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
              view === id ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'analytics' && <FinanceAnalytics client={name} lockClient flat />}
      {/* kept mounted behind Analytics, so coming back does not read the month again */}
      <div hidden={view !== 'ledger'}>
        <FinanceLedger client={name} clients={pick.clients} vocab={vocab} month={month} onMonth={onMonth} flat />
      </div>
    </div>
  )
}

/** Client Finances for one client; the page keeps it mounted once opened, so the month and view survive a tab trip. */
export function ClientFinances({ client }: { client: Pick<ClientRow, 'id' | 'name'> }) {
  const read = useFinClients()
  const [view, setView] = useState<View>('ledger')
  const [month, setMonth] = useState(thisMonth)
  return <ClientFinancesView client={client} read={read} view={view} onView={setView} month={month} onMonth={setMonth} />
}
