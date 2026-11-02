// Client Funds and Billing, one client at a time: three KPI cards, the section's tabs, search and "All statuses"…
// Every row opens in the right SidePanel; a receipt or a funds paper opens in the platform's centred viewer, from…
import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ArrowRight, FileText, Loader2, Paperclip, Pencil, X } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import SearchInput from '@/components/shared/SearchInput'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { usePlatformDoc } from '@/lib/platformDoc'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import { readKey, useLocationRead, type ReadState } from '@/pages/features/locations/useLocation'
import { clientWritten } from '../useClientRead'
import { useClientReader } from '../clientViewer'
import {
  COLUMNS, EXEMPT_REASONS, PANEL_LABEL, SECTION_TABS, SECTION_TITLE, attachReceipt, billingKpis, billingOf, cardMask,
  dayLabel, filterRows, financeRefusal, fundsKpis, fundsOf, markNoReceipt, money, panelOf, panelParam, readBilling,
  readFinanceFile, readFunds, receiptFile, statusChoices, tabFor, tabNote, tableRows, unitsCell,
  type BillingAnswer, type FinancePanel, type FinanceSection, type FinanceTabId, type FundsAnswer, type Kpi, type TableRow,
  type Tone, type TxnRow,
} from './finance'

/** Opens a receipt or a funds paper in the centred viewer; `opening` is the row (or paper) whose file is on its way. */
type DocOpen = { opening: string; open: (key: string, fileId: string, title: string) => void }

function useFinanceDocs(client: string): DocOpen {
  const doc = usePlatformDoc(financeRefusal)
  return {
    opening: doc.opening,
    open: (key, fileId, title) => doc.open(key, () => readFinanceFile(client, fileId), { title, subtitle: 'Clients · Client Funds' }),
  }
}

const TONE_PILL: Record<Tone, string> = {
  green: 'bg-tint-mint text-tint-fg-mint', amber: 'bg-tint-amber text-tint-fg-amber', red: 'bg-tint-pink text-tint-fg-pink',
  blue: 'bg-tint-blue text-tint-fg-blue', slate: 'bg-surface-2 text-text-2',
}
const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const SELECT = 'h-9 rounded-md border border-border bg-surface px-2.5 text-[12.5px] text-text-1 outline-none focus:border-primary'
const GHOST = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2'

export function Pill({ status, tone }: { status: string; tone: Tone }) {
  if (!status) return null
  return (
    <span data-status={status} className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', TONE_PILL[tone])}>
      {status}
    </span>
  )
}

// The section for one client.
export default function FinanceTab({ client, clientName = '', section, tab, onTab, panel, onPanel }: {
  /** the client_key */
  client: string
  clientName?: string
  section: FinanceSection
  tab?: string | null
  onTab?: (tab: FinanceTabId) => void
  /** the panel as its URL param ("txn:<id>"), or null */
  panel?: string | null
  onPanel?: (panel: string | null) => void
}) {
  const funds = useLocationRead(section === 'funds' && client ? readKey('clientSourceFunds', client) : null,
    () => readFunds(client), fundsOf)
  const billing = useLocationRead(section === 'billing' && client ? readKey('clientSourceBilling', client) : null,
    () => readBilling(client), billingOf)
  const [ownTab, setOwnTab] = useState<string | null>(null)
  const [ownPanel, setOwnPanel] = useState<string | null>(null)
  const shownTab = tabFor(section, tab !== undefined ? tab : ownTab)
  const shownPanel = panel !== undefined ? panel : ownPanel
  return (
    <FinanceView client={client} clientName={clientName} section={section}
      funds={section === 'funds' ? funds : null} billing={section === 'billing' ? billing : null}
      tab={shownTab} onTab={(t) => (onTab ? onTab(t) : setOwnTab(t))}
      panel={panelOf(shownPanel)} onPanel={(p) => { const v = panelParam(p) || null; if (onPanel) onPanel(v); else setOwnPanel(v) }}
      onRetry={section === 'funds' ? funds.reload : billing.reload} />
  )
}

export function FinanceView({ client, clientName, section, funds, billing, tab, onTab, panel, onPanel, onRetry }: {
  client: string
  clientName: string
  section: FinanceSection
  funds: ReadState<FundsAnswer> | null
  billing: ReadState<BillingAnswer> | null
  tab: FinanceTabId
  onTab: (tab: FinanceTabId) => void
  panel: FinancePanel | null
  onPanel: (panel: FinancePanel | null) => void
  onRetry: () => void
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [fund, setFund] = useState('')
  const state = (section === 'funds' ? funds : billing) as ReadState<FundsAnswer | BillingAnswer> | null
  const f = section === 'funds' ? funds?.data ?? null : null
  const b = section === 'billing' ? billing?.data ?? null : null
  const name = clientName || f?.client.name || b?.client.name || ''
  const kpis = section === 'funds' ? fundsKpis(f) : billingKpis(b)
  const all = tableRows(tab, f, b)
  const declared = (tab === 'balances' || tab === 'transactions' || tab === 'receipts' ? f?.tabs[tab].statuses : b?.tabs[tab].statuses) ?? []
  const choices = statusChoices(all, declared)
  const fundFilter = tab === 'transactions' || tab === 'receipts' ? fund : ''
  const rows = filterRows(all, query, status, fundFilter)
  const note = tabNote(tab, f, b, name)
  const docs = useFinanceDocs(client)
  const pick = (t: FinanceTabId) => { setStatus(''); onTab(t) }
  const act = (r: TableRow) => {
    if (r.action.kind === 'transactions') {
      setFund(r.action.fund)
      pick('transactions')
      return
    }
    // a receipt with its file on record opens in the viewer; one without says why in the panel
    const receipt = tab === 'receipts' ? f?.tabs.receipts.rows.find((x) => x.id === r.id) : null
    const file = receipt ? receiptFile(receipt) : null
    if (receipt && file?.fileId) docs.open(r.id, file.fileId, receipt.record || 'Receipt')
    else onPanel(r.action.panel)
  }
  return (
    <section data-finance={section} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3" data-kpis="">
        {kpis.map((k) => <KpiCard key={k.id} kpi={k} loading={!state?.data && state?.status !== 'failed'} />)}
      </div>
      <div className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">{SECTION_TITLE[section]}</h2>
          <SegmentedTabs tabs={SECTION_TABS[section]} value={tab} onChange={(t) => pick(t as FinanceTabId)} />
        </div>
        <FinanceReadLine state={state} what={SECTION_TITLE[section]} onRetry={onRetry} />
        {note.why && <p role="alert" data-why={tab} className="mb-3 rounded-md bg-tint-pink px-3 py-2 text-[12.5px] leading-5 text-tint-fg-pink">
          Not everything could be read: {note.why}.</p>}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search records…" className="w-full sm:w-64" />
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT} data-filter="status">
            <option value="">All statuses</option>
            {choices.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {fundFilter && (
            <button type="button" onClick={() => setFund('')} className={GHOST} data-fund={fundFilter}>
              {fundFilter} <X size={12} />
            </button>
          )}
        </div>
        {state?.data && note.empty && <p className="text-[13px] text-text-3" data-empty={tab}>{note.empty}</p>}
        {state?.data && !note.empty && rows.length === 0 && <p className="text-[13px] text-text-3">No record matches these filters.</p>}
        {rows.length > 0 && <FinanceTable tab={tab} rows={rows} onOpen={(r) => onPanel(r.panel)} onAct={act} opening={docs.opening} />}
        {section === 'funds' && tab === 'balances' && f && <FundsExtras funds={f} docs={docs} />}
        {state?.data && <Sources sources={(f ?? b)?.sources ?? []} />}
      </div>
      <FinanceSidePanel client={client} clientName={name} panel={panel} funds={f} billing={b} onPanel={onPanel} docs={docs}
        onTransactions={(fd) => { setFund(fd); onPanel(null); pick('transactions') }} />
    </section>
  )
}

function KpiCard({ kpi, loading }: { kpi: Kpi; loading: boolean }) {
  return (
    <div data-kpi={kpi.id} data-tone={kpi.tone} className="rounded-[16px] border border-border bg-surface p-4 shadow-1">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{kpi.label}</div>
      <div className={cn('mt-1.5 font-stat text-[24px] font-bold leading-8',
        kpi.tone === 'red' ? 'text-[var(--danger)]' : 'text-text-1')}>{loading ? '…' : kpi.value}</div>
      {kpi.sub && <p className="mt-1 text-[11.5px] leading-4 text-text-3">{kpi.sub}</p>}
    </div>
  )
}

function FinanceReadLine({ state, what, onRetry }: { state: ReadState<unknown> | null; what: string; onRetry: () => void }) {
  if (!state || state.status === 'ready') return null
  if (state.status === 'loading' || state.status === 'idle') {
    return <p className="mb-3 flex items-center gap-2 text-[12.5px] text-text-3" data-read="loading"><Loader2 size={13} className="animate-spin" /> Reading {what}…</p>
  }
  return (
    <p role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-read="failed">
      {state.data ? `The last read of ${what} failed: ${financeRefusal(state.error)} What is shown is from the read before.`
        : `${what} could not be read: ${financeRefusal(state.error)}`}
      <button type="button" onClick={onRetry} className={GHOST}>Try again</button>
    </p>
  )
}

function FinanceTable({ tab, rows, onOpen, onAct, opening = '' }: {
  tab: FinanceTabId
  rows: TableRow[]
  onOpen: (r: TableRow) => void
  onAct: (r: TableRow) => void
  /** the receipt file on its way to the viewer */
  opening?: string
}) {
  const cols = COLUMNS[tab]
  return (
    <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-collapse text-[13px]" data-table={tab}>
        <thead className="bg-surface-2/60">
          <tr>{cols.map((c) => <th key={c.key} className={cn(TH, c.align === 'right' && 'text-right')}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} data-row={r.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => onOpen(r)}>
              {cols.map((c) => (
                <td key={c.key} className={cn('px-3 py-3 align-top', c.align === 'right' && 'text-right font-stat')}>
                  {c.key === 'record' && (
                    <div className="min-w-0">
                      <div className="font-medium text-text-1">{r.record || '—'}</div>
                      {r.sub && <div className="clamp-2 mt-0.5 text-[11.5px] leading-4 text-text-3">{r.sub}</div>}
                      {tab === 'balances' && <div className="mt-1"><Pill status={r.status} tone={r.tone} /></div>}
                    </div>
                  )}
                  {c.key === 'status' && <Pill status={r.status} tone={r.tone} />}
                  {c.key === 'action' && <RowButton row={r} tab={tab} onAct={onAct} busy={opening === r.id} />}
                  {c.key !== 'record' && c.key !== 'status' && c.key !== 'action' && (
                    <span className={cn('whitespace-nowrap', r.cells[c.key]?.startsWith('−') ? 'text-[var(--danger)]' : 'text-text-2')}>
                      {r.cells[c.key] ?? '—'}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RowButton({ row, tab, onAct, busy = false }: { row: TableRow; tab: FinanceTabId; onAct: (r: TableRow) => void; busy?: boolean }) {
  const press = (e: MouseEvent) => { e.stopPropagation(); onAct(row) }
  if (row.action.kind === 'transactions' || tab === 'receipts') {
    return (
      <button type="button" onClick={press} disabled={busy} aria-busy={busy || undefined} className={cn(GHOST, 'whitespace-nowrap disabled:opacity-60')}
        data-action={tab === 'receipts' ? 'review' : 'transactions'}>
        {tab === 'receipts' ? <>{busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Review receipt</>
          : <>View transactions <ArrowRight size={13} /></>}
      </button>
    )
  }
  return (
    <button type="button" onClick={press} aria-label={row.action.label} data-action="pencil"
      className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
      <Pencil size={14} />
    </button>
  )
}

function FundsExtras({ funds, docs }: { funds: FundsAnswer; docs: DocOpen }) {
  const an = funds.analytics
  const cats = an ? an.by_category.slice(0, 5) : []
  const top = cats.length ? Math.max(...cats.map((c) => c.spent)) || 1 : 1
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div data-statements="">
        <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Statements on file</h3>
        {funds.documents.why && <p className="text-[12.5px] text-[var(--danger)]">The Funds folder could not be read: {funds.documents.why}.</p>}
        {!funds.documents.why && !funds.documents.rows.length && <p className="text-[12.5px] text-text-3">No bank statement or benefit letter is in the Funds folder.</p>}
        <ul className="grid gap-1.5">
          {funds.documents.rows.slice(0, 8).map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => docs.open(d.id, d.file_id, d.record || 'Document')} data-doc={d.id}
                disabled={!d.file_id || docs.opening === d.id} aria-busy={docs.opening === d.id || undefined}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2 disabled:opacity-60">
                {docs.opening === d.id ? <Loader2 size={13} className="shrink-0 animate-spin text-text-3" />
                  : <FileText size={13} className="shrink-0 text-text-3" />}
                <span className="min-w-0 flex-1 truncate text-text-1">{d.record}</span>
                <span className="shrink-0 text-[11px] text-text-3">{dayLabel(d.date)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {an && (
        <div data-analytics="">
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Spending by category</h3>
          <ul className="grid gap-1.5">
            {cats.map((c) => (
              <li key={c.category} className="text-[12px]">
                <div className="flex justify-between gap-2"><span className="truncate text-text-2">{c.category}</span><span className="font-stat text-text-1">{money(c.spent)}</span></div>
                <div className="mt-0.5 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round((c.spent / top) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-text-3">
            {an.compliance.with_receipt} of {an.compliance.spends} spends have a receipt · {an.compliance.exempt} exempt · {an.compliance.missing} missing
          </p>
        </div>
      )}
    </div>
  )
}

function Sources({ sources }: { sources: { name: string; app: string; readable: boolean; why: string; rows: number | null }[] }) {
  if (!sources.length) return null
  return (
    <details className="mt-4 text-[11.5px] text-text-3" data-sources="">
      <summary className="cursor-pointer select-none">Where this comes from</summary>
      <ul className="mt-2 grid gap-1">
        {sources.map((s) => (
          <li key={s.name} data-source={s.name}>
            <span className="font-semibold text-text-2">{s.name}</span> · {s.app}
            {s.readable ? (s.rows !== null ? ` · ${s.rows} row(s) for this client` : '') : ` · ${s.why}`}
          </li>
        ))}
      </ul>
    </details>
  )
}

/* ---------- the right panel ---------- */

function FinanceSidePanel({ client, clientName, panel, funds, billing, onPanel, onTransactions, docs }: {
  client: string
  clientName: string
  panel: FinancePanel | null
  funds: FundsAnswer | null
  billing: BillingAnswer | null
  onPanel: (p: FinancePanel | null) => void
  onTransactions: (fund: string) => void
  docs: DocOpen
}) {
  const title = panel ? panelTitle(panel, funds, billing) : ''
  return (
    <SidePanel open={!!panel} onClose={() => onPanel(null)} label={panel ? PANEL_LABEL[panel.kind] : 'Finance'} title={title}>
      {panel && !funds && !billing && <p className="pt-2 text-[12.5px] text-text-3" data-read="loading">Reading…</p>}
      {panel && (funds || billing) && <PanelBody key={panelParam(panel)} client={client} clientName={clientName} panel={panel} funds={funds}
        billing={billing} onPanel={onPanel} onTransactions={onTransactions} docs={docs} />}
    </SidePanel>
  )
}

function panelTitle(p: FinancePanel, funds: FundsAnswer | null, billing: BillingAnswer | null): string {
  const t = funds?.tabs
  const hit = p.kind === 'txn' ? t?.transactions.rows.find((r) => r.id === p.id)
    : p.kind === 'receipt' ? t?.receipts.rows.find((r) => r.id === p.id)
    : p.kind === 'balance' ? t?.balances.rows.find((r) => r.id === p.id)
    : p.kind === 'doc' ? funds?.documents.rows.find((r) => r.id === p.id)
    : p.kind === 'auth' ? billing?.tabs.authorizations.rows.find((r) => r.id === p.id)
    : billing?.tabs.claims.rows.find((r) => r.id === p.id)
  return hit?.record || PANEL_LABEL[p.kind]
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
      <dd className="mt-1 break-words text-[13px] leading-5 text-text-1">{children || '—'}</dd>
    </div>
  )
}

function PanelBody({ client, clientName, panel, funds, billing, onPanel, onTransactions, docs }: {
  client: string
  clientName: string
  panel: FinancePanel
  funds: FundsAnswer | null
  billing: BillingAnswer | null
  onPanel: (p: FinancePanel | null) => void
  onTransactions: (fund: string) => void
  docs: DocOpen
}) {
  const gone = <p className="pt-2 text-[12.5px] text-text-3" data-gone="">This record is no longer in the answer.</p>
  if (panel.kind === 'txn') {
    const t = funds?.tabs.transactions.rows.find((r) => r.id === panel.id)
    if (!t) return gone
    const receiptRow = funds?.tabs.receipts.rows.find((r) => r.txn_id === t.id)
    return (
      <div className="grid gap-3 pt-2" data-panel="txn">
        <dl>
          <Row label="Status"><Pill status={t.status} tone={t.status === 'Missing receipt' ? 'red' : t.status === 'Receipt On File' ? 'green' : 'slate'} /></Row>
          <Row label="Date">{dayLabel(t.date)}</Row>
          <Row label="Amount"><span className="font-stat">{money(t.amount)}</span> · {t.type}</Row>
          <Row label="Fund">{t.fund}</Row>
          <Row label="Vendor">{t.vendor}</Row>
          <Row label="Category">{t.category}</Row>
          <Row label="Description">{t.description}</Row>
          <Row label="Entered by">{t.staff}</Row>
          <Row label="Source">{t.source}</Row>
          {t.card_last4 && <Row label="Card">{cardMask(t.card_last4)}</Row>}
          <Row label="Receipt">{[t.receipt.status, t.receipt.name, t.receipt.verdict && t.receipt.verdict !== 'NONE' ? t.receipt.verdict : '', t.receipt.note].filter(Boolean).join(' · ')}</Row>
        </dl>
        {receiptRow && t.receipt.file_id && (
          <button type="button" onClick={() => docs.open(receiptRow.id, t.receipt.file_id, receiptRow.record || t.record || 'Receipt')}
            disabled={docs.opening === receiptRow.id} aria-busy={docs.opening === receiptRow.id || undefined}
            className={cn(GHOST, 'w-fit disabled:opacity-60')} data-open-receipt="">
            {docs.opening === receiptRow.id ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Review receipt
          </button>
        )}
        {t.status === 'Missing receipt' && <ReceiptActions client={client} txn={t} />}
      </div>
    )
  }
  if (panel.kind === 'receipt' || panel.kind === 'doc') {
    const r = panel.kind === 'receipt' ? funds?.tabs.receipts.rows.find((x) => x.id === panel.id) : null
    const d = panel.kind === 'doc' ? funds?.documents.rows.find((x) => x.id === panel.id) : null
    if (!r && !d) return gone
    const file = r ? receiptFile(r) : { fileId: d?.file_id ?? '', why: '' }
    return (
      <div className="grid gap-3 pt-2" data-panel={panel.kind}>
        <p className="text-[12.5px] text-text-3">
          {r ? [dayLabel(r.date), r.amount !== null ? money(r.amount) : '', r.status, r.source].filter(Boolean).join(' · ')
            : [dayLabel(d?.date ?? ''), d?.details].filter(Boolean).join(' · ')}
        </p>
        {file.fileId ? (
          <button type="button" onClick={() => docs.open(panel.id, file.fileId, r?.record ?? d?.record ?? 'Document')}
            disabled={docs.opening === panel.id} aria-busy={docs.opening === panel.id || undefined} data-view-file={panel.id}
            className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
            {docs.opening === panel.id ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            {r ? 'View the receipt' : 'View the document'}
          </button>
        ) : <p className="text-[12.5px] text-text-3" data-no-file="">{file.why}</p>}
        {r?.txn_id && <button type="button" onClick={() => onPanel({ kind: 'txn', id: r.txn_id })} className={cn(GHOST, 'w-fit')}>Open the transaction</button>}
      </div>
    )
  }
  if (panel.kind === 'balance') {
    const b = funds?.tabs.balances.rows.find((r) => r.id === panel.id)
    if (!b) return gone
    return (
      <div className="grid gap-3 pt-2" data-panel="balance">
        <dl>
          <Row label="Client">{b.client || clientName}</Row>
          <Row label="Fund">{b.fund || 'All funds (on file)'}</Row>
          <Row label="Personal balance"><span className="font-stat">{money(b.personal_balance)}</span></Row>
          <Row label="Missing receipts">{b.missing_receipts === null ? '—' : String(b.missing_receipts)}</Row>
          <Row label="Status"><Pill status={b.status} tone={b.personal_balance === null ? 'slate' : 'green'} /></Row>
          <Row label="Details">{b.details}</Row>
          {b.card_last4 && <Row label="Card">{cardMask(b.card_last4)}</Row>}
          <Row label="Source">{b.source}</Row>
        </dl>
        <button type="button" onClick={() => onTransactions(b.fund)} className={cn(GHOST, 'w-fit')}>View transactions <ArrowRight size={13} /></button>
      </div>
    )
  }
  if (panel.kind === 'auth') {
    const a = billing?.tabs.authorizations.rows.find((r) => r.id === panel.id)
    if (!a) return gone
    return (
      <dl className="pt-2" data-panel="auth">
        <Row label="Status"><Pill status={a.status} tone={a.status === 'Current' ? 'green' : a.status === 'Renewal due' ? 'amber' : a.status === 'Expired' ? 'red' : 'slate'} />
          {a.renewal_due && <span className="ml-2 text-[11.5px] text-text-3">counts toward Renewals due</span>}</Row>
        <Row label="Span">{a.span_start ? `${dayLabel(a.span_start)} – ${dayLabel(a.span_end)}` : '—'}{a.days_left !== null ? ` · ${a.days_left < 0 ? `ended ${-a.days_left} days ago` : `${a.days_left} days left`}` : ''}</Row>
        <Row label="Units used / authorized">{unitsCell(a.units_used, a.units_authorized)}{a.units_used_from ? ` · used counted from ${dayLabel(a.units_used_from)}` : ''}</Row>
        <Row label="Authorized $">{money(a.amount_authorized)}</Row>
        {a.units_projected !== null && <Row label="Projected">{`${Math.round(a.units_projected).toLocaleString('en-US')} units · ${money(a.amount_projected)}${a.percent !== null ? ` · ${a.percent}% over` : ''}`}</Row>}
        {a.ssa && <Row label="SSA">{a.ssa}</Row>}
        {a.match === 'near' && <Row label="Joined by">A near spelling of the name — check it is this client.</Row>}
        {a.notes && <Row label="Notes">{a.notes}</Row>}
        <Row label="Source">{a.source}</Row>
      </dl>
    )
  }
  const c = billing?.tabs.claims.rows.find((r) => r.id === panel.id)
  if (!c) return gone
  return (
    <dl className="pt-2" data-panel="claim">
      <Row label="Status"><Pill status={c.status} tone={c.status === 'Paid' ? 'green' : c.status === 'Rejected' || c.status === 'Denied' ? 'red' : 'slate'} /></Row>
      <Row label="Service date">{dayLabel(c.date)}</Row>
      {c.service_code && <Row label="Service code">{c.service_code}</Row>}
      {(c.cycle || c.billing_date) && <Row label="Billing cycle">{[c.cycle, c.billing_date ? `billed ${dayLabel(c.billing_date)}` : ''].filter(Boolean).join(' · ')}</Row>}
      <Row label="Amount">{c.units !== null && c.unit_rate !== null ? `${c.units} units × ${money(c.unit_rate)} = ${money(c.amount)}` : money(c.amount)}</Row>
      {c.errors.length > 0 && <Row label="Why it was rejected">{c.errors.map((e) => `(${e.code}) ${e.text}`).join(' · ')}</Row>}
      {c.evv && <Row label="EVV">{`${c.evv.units_billed ?? '—'} billed · ${c.evv.evv_units ?? '—'} logged · ${c.evv.additional_needed ?? '—'} more needed · error ${c.evv.error_code || '—'}`}</Row>}
      {c.evv_fix && <Row label="EVV Fixes">{[c.evv_fix.notes, c.evv_fix.additional_needed !== null ? `${c.evv_fix.additional_needed} units needed` : ''].filter(Boolean).join(' · ')}</Row>}
      <Row label="Source">{c.source}</Row>
    </dl>
  )
}

// Client Finances' own receipt doors for a spend with none: attach the photo, or record that none is coming.
function ReceiptActions({ client, txn }: { client: string; txn: TxnRow }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const { mayWrite } = useClientReader()
  if (!mayWrite) return null
  if (txn.id.startsWith('tl-')) {
    return <p className="text-[12px] text-text-3">This spend is only in the TrueLink book; it takes a receipt once Client Finances imports it.</p>
  }
  // the client's sections read again, and the relay's pack from before this write was sent is not drawn
  const done = (sent: number) => clientWritten(client, sent)
  const exempt = async () => {
    if (!reason) return
    setBusy('exempt')
    try {
      const sent = Date.now()
      await markNoReceipt(txn.id, reason, note.trim())
      toast({ type: 'success', title: 'Recorded as exempt', body: `${reason} — your name is on it.` })
      done(sent)
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }
  const attach = async (f: File | null) => {
    if (!f) return
    if (f.size > 8 * 1024 * 1024) {
      toast({ type: 'warning', title: 'That file is very large', body: 'Under 8 MB, please.' })
      return
    }
    setBusy('attach')
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => { const v = String(r.result ?? ''); res(v.slice(v.indexOf(',') + 1)) }
        r.onerror = () => rej(new Error('The file could not be read.'))
        r.readAsDataURL(f)
      })
      const sent = Date.now()
      const out = await attachReceipt(txn.id, { name: f.name, mime: f.type || 'image/jpeg', b64 })
      toast({
        type: out.verdict === 'MISMATCH' ? 'danger' : out.verdict === 'MATCH' ? 'success' : 'warning',
        title: out.verdict === 'MATCH' ? 'Receipt matches' : out.verdict === 'MISMATCH' ? 'Receipt does NOT match' : 'Receipt saved, not verified',
        body: out.note,
      })
      done(sent)
    } catch (e) {
      toast({ type: 'danger', title: 'Not attached', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3" data-receipt-actions="">
      <p className="text-[12px] text-text-3">No receipt is on file. Attach it, or record why none is coming.</p>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { void attach(e.target.files?.[0] ?? null); e.target.value = '' }} />
      <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()} className={cn(GHOST, 'w-fit')} data-attach="">
        {busy === 'attach' ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Attach receipt
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Why no receipt" value={reason} onChange={(e) => setReason(e.target.value)} className={SELECT} data-reason="">
          <option value="">Why no receipt…</option>
          {EXEMPT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={cn(SELECT, 'min-w-0 flex-1')} />
        <button type="button" disabled={!reason || !!busy} onClick={() => void exempt()} className={GHOST} data-exempt="">
          {busy === 'exempt' && <Loader2 size={13} className="animate-spin" />} Mark no receipt
        </button>
      </div>
    </div>
  )
}
