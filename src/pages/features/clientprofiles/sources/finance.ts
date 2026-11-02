// Client Funds and Billing for the Clients app: the doors (ClientSourceFinance.gs), the answer's shapes, and the…
// Master-only, like the doors.
import { gasAction } from '@/features/hiring/shared'
import { readDocBytesHeld } from '@/lib/appPack'
import { CLIENTS_PACK, clientPackOr } from '../clientReads'
import { unknownActionWords } from '../clientViewer'

/* ---------- the doors ---------- */

/** The relay's pack for the client first (its parts are these doors' own answers), else the doors themselves. */
export const readFunds = (client: string) =>
  clientPackOr(client, 'funds', () => gasAction<unknown>('clientSourceFunds', { client }))
export const readBilling = (client: string) =>
  clientPackOr(client, 'billing', () => gasAction<unknown>('clientSourceBilling', { client }))

export type FinanceFileAnswer = { id: string; name: string; mime: string; size: number; exported: boolean; b64: string }

/** Through the client's own door, held in memory for the tab so opening it again is instant (appPack). */
export const readFinanceFile = (client: string, id: string) =>
  readDocBytesHeld(`${CLIENTS_PACK}|${client}|funds|${id}`,
    () => gasAction<FinanceFileAnswer>('clientSourceFinanceFile', { client, id }))

/** Client Finances' own receipt doors, for a spend with none on file. */
export const EXEMPT_REASONS = ['Lost', 'Not Provided', 'Recurring/Subscription', 'Online Purchase', 'Other'] as const

export const markNoReceipt = (id: string, reason: string, note: string) =>
  gasAction<unknown>('finMarkNoReceipt', { id, reason, note }, { retry: false })

export const attachReceipt = (id: string, file: { name: string; mime: string; b64: string }) =>
  gasAction<{ verdict: string; note: string }>('finAttachReceipt',
    { id, receiptBase64: file.b64, receiptMime: file.mime, receiptFileName: file.name }, { retry: false })

/* ---------- the answer ---------- */

export type Receipt = { status: string; name: string; file_id: string; verdict: string; note: string }

export type TxnRow = {
  id: string; record: string; date: string; details: string; status: string; amount: number; type: string; fund: string
  vendor: string; category: string; description: string; staff: string; source: string; month: string; receipt: Receipt
  card_last4: string
}

export type BalanceRow = {
  id: string; record: string; client: string; fund: string; date: string; details: string; status: string
  personal_balance: number | null; missing_receipts: number | null; recorded_net: number | null; deposits: number | null
  spending: number | null; transactions: number | null; as_of: string; source: string; card_last4: string
}

export type ReceiptRow = {
  id: string; txn_id: string; record: string; date: string; amount: number | null; status: string; file_id: string
  receipt_name: string; verdict: string; note: string; source: string; details: string
}

export type DocRow = { id: string; file_id: string; record: string; date: string; status: string; source: string; details: string }

export type AuthRow = {
  id: string; record: string; date: string; span_start: string; span_end: string; days_left: number | null
  units_used: number | null; units_used_from: string; units_authorized: number | null; amount_authorized: number | null
  units_projected: number | null; amount_projected: number | null; percent: number | null; ssa: string; notes: string
  status: string; kind: string; source: string; match: string; renewal_due: boolean; details: string
}

export type ClaimRow = {
  id: string; record: string; date: string; amount: number | null; units: number | null; unit_rate: number | null
  cycle: string; billing_date: string; service_code: string; errors: { code: string; text: string }[]; status: string
  source: string; details: string
  evv: { units_billed: number | null; evv_units: number | null; additional_needed: number | null; error_code: string } | null
  evv_fix: { billed: number | null; evv: number | null; additional_needed: number | null; notes: string } | null
}

export type SourceNote = { name: string; app: string; readable: boolean; why: string; rows: number | null; as_of: string }

export type TabAnswer<R> = { rows: R[]; kpis: Record<string, number | null>; statuses: string[]; why: string; as_of: string }

export type Analytics = {
  by_category: { category: string; spent: number; count: number }[]
  monthly: { month: string; spent: number; deposits: number }[]
  top_vendors: { vendor: string; spent: number; count: number }[]
  compliance: { spends: number; with_receipt: number; exempt: number; missing: number }
}

export type FundsAnswer = {
  client: { client_key: string; name: string }
  as_of: string
  kpis: {
    personal_balance: number | null; personal_balance_basis: string; personal_balance_as_of: string
    personal_balance_why: string; missing_receipts: number | null; transactions: number | null
  }
  tabs: { balances: TabAnswer<BalanceRow>; transactions: TabAnswer<TxnRow>; receipts: TabAnswer<ReceiptRow> }
  documents: { rows: DocRow[]; why: string }
  analytics: Analytics | null
  sources: SourceNote[]
  degraded: boolean
}

export type BillingAnswer = {
  client: { client_key: string; name: string }
  today: string
  kpis: {
    renewals_due: number | null; renewals_due_why: string; draft_claims: number | null; draft_claims_why: string
    unpaid_claims: number | null; unpaid_claims_why: string; unpaid_claims_basis: string
  }
  tabs: { authorizations: TabAnswer<AuthRow>; claims: TabAnswer<ClaimRow> }
  sources: SourceNote[]
  degraded: boolean
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function tabOf<R>(raw: unknown, row: (r: Obj) => R): TabAnswer<R> {
  const t = obj(raw)
  const kpis: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(obj(t.kpis))) kpis[k] = num(v)
  return {
    rows: list(t.rows).map((r) => row(obj(r))), kpis, statuses: list(t.statuses).map(str),
    why: str(t.why), as_of: str(t.as_of),
  }
}

const sourcesOf = (raw: unknown): SourceNote[] => list(raw).map((s) => {
  const o = obj(s)
  return { name: str(o.name), app: str(o.app), readable: o.readable === true, why: str(o.why), rows: num(o.rows), as_of: str(o.as_of) }
})

const clientOf = (raw: unknown) => {
  const o = obj(raw)
  return { client_key: str(o.client_key), name: str(o.name) }
}

export function txnOf(r: Obj): TxnRow {
  const rc = obj(r.receipt)
  return {
    id: str(r.id), record: str(r.record), date: str(r.date), details: str(r.details), status: str(r.status),
    amount: num(r.amount) ?? 0, type: str(r.type), fund: str(r.fund), vendor: str(r.vendor), category: str(r.category),
    description: str(r.description), staff: str(r.staff), source: str(r.source), month: str(r.month),
    receipt: { status: str(rc.status), name: str(rc.name), file_id: str(rc.file_id), verdict: str(rc.verdict), note: str(rc.note) },
    card_last4: str(r.card_last4).replace(/\D/g, '').slice(-4),
  }
}

/** The funds door's answer, read defensively: a missing field is empty, never invented. */
export function fundsOf(raw: unknown): FundsAnswer {
  const a = obj(raw)
  const k = obj(a.kpis)
  const tabs = obj(a.tabs)
  const docs = obj(a.documents)
  const an = a.analytics ? obj(a.analytics) : null
  return {
    client: clientOf(a.client), as_of: str(a.as_of),
    kpis: {
      personal_balance: num(k.personal_balance), personal_balance_basis: str(k.personal_balance_basis),
      personal_balance_as_of: str(k.personal_balance_as_of), personal_balance_why: str(k.personal_balance_why),
      missing_receipts: num(k.missing_receipts), transactions: num(k.transactions),
    },
    tabs: {
      balances: tabOf(tabs.balances, (r) => ({
        id: str(r.id), record: str(r.record), client: str(r.client), fund: str(r.fund), date: str(r.date), details: str(r.details),
        status: str(r.status), personal_balance: num(r.personal_balance), missing_receipts: num(r.missing_receipts),
        recorded_net: num(r.recorded_net), deposits: num(r.deposits), spending: num(r.spending), transactions: num(r.transactions),
        as_of: str(r.as_of), source: str(r.source), card_last4: str(r.card_last4).replace(/\D/g, '').slice(-4),
      })),
      transactions: tabOf(tabs.transactions, txnOf),
      receipts: tabOf(tabs.receipts, (r) => ({
        id: str(r.id), txn_id: str(r.txn_id), record: str(r.record), date: str(r.date), amount: num(r.amount), status: str(r.status),
        file_id: str(r.file_id), receipt_name: str(r.receipt_name), verdict: str(r.verdict), note: str(r.note), source: str(r.source),
        details: str(r.details),
      })),
    },
    documents: {
      rows: list(docs.rows).map((d) => {
        const o = obj(d)
        return { id: str(o.id), file_id: str(o.file_id), record: str(o.record), date: str(o.date), status: str(o.status),
                 source: str(o.source), details: str(o.details) }
      }),
      why: str(docs.why),
    },
    analytics: an ? {
      by_category: list(an.by_category).map((x) => { const o = obj(x); return { category: str(o.category), spent: num(o.spent) ?? 0, count: num(o.count) ?? 0 } }),
      monthly: list(an.monthly).map((x) => { const o = obj(x); return { month: str(o.month), spent: num(o.spent) ?? 0, deposits: num(o.deposits) ?? 0 } }),
      top_vendors: list(an.top_vendors).map((x) => { const o = obj(x); return { vendor: str(o.vendor), spent: num(o.spent) ?? 0, count: num(o.count) ?? 0 } }),
      compliance: (() => {
        const c = obj(an.compliance)
        return { spends: num(c.spends) ?? 0, with_receipt: num(c.with_receipt) ?? 0, exempt: num(c.exempt) ?? 0, missing: num(c.missing) ?? 0 }
      })(),
    } : null,
    sources: sourcesOf(a.sources),
    degraded: a.degraded === true,
  }
}

/** The billing door's answer, read defensively. */
export function billingOf(raw: unknown): BillingAnswer {
  const a = obj(raw)
  const k = obj(a.kpis)
  const tabs = obj(a.tabs)
  return {
    client: clientOf(a.client), today: str(a.today),
    kpis: {
      renewals_due: num(k.renewals_due), renewals_due_why: str(k.renewals_due_why), draft_claims: num(k.draft_claims),
      draft_claims_why: str(k.draft_claims_why), unpaid_claims: num(k.unpaid_claims), unpaid_claims_why: str(k.unpaid_claims_why),
      unpaid_claims_basis: str(k.unpaid_claims_basis),
    },
    tabs: {
      authorizations: tabOf(tabs.authorizations, (r) => ({
        id: str(r.id), record: str(r.record), date: str(r.date), span_start: str(r.span_start), span_end: str(r.span_end),
        days_left: num(r.days_left), units_used: num(r.units_used), units_used_from: str(r.units_used_from),
        units_authorized: num(r.units_authorized), amount_authorized: num(r.amount_authorized), units_projected: num(r.units_projected),
        amount_projected: num(r.amount_projected), percent: num(r.percent), ssa: str(r.ssa), notes: str(r.notes), status: str(r.status),
        kind: str(r.kind), source: str(r.source), match: str(r.match), renewal_due: r.renewal_due === true, details: str(r.details),
      })),
      claims: tabOf(tabs.claims, (r) => {
        const evv = r.evv ? obj(r.evv) : null
        const fix = r.evv_fix ? obj(r.evv_fix) : null
        return {
          id: str(r.id), record: str(r.record), date: str(r.date), amount: num(r.amount), units: num(r.units), unit_rate: num(r.unit_rate),
          cycle: str(r.cycle), billing_date: str(r.billing_date), service_code: str(r.service_code),
          errors: list(r.errors).map((e) => { const o = obj(e); return { code: str(o.code), text: str(o.text) } }),
          status: str(r.status), source: str(r.source), details: str(r.details),
          evv: evv ? { units_billed: num(evv.units_billed), evv_units: num(evv.evv_units), additional_needed: num(evv.additional_needed),
                       error_code: str(evv.error_code) } : null,
          evv_fix: fix ? { billed: num(fix.billed), evv: num(fix.evv), additional_needed: num(fix.additional_needed), notes: str(fix.notes) } : null,
        }
      }),
    },
    sources: sourcesOf(a.sources),
    degraded: a.degraded === true,
  }
}

/* ---------- the words ---------- */

export type FinanceSection = 'funds' | 'billing'
export type FundsTab = 'balances' | 'transactions' | 'receipts'
export type BillingTab = 'authorizations' | 'claims'
export type FinanceTabId = FundsTab | BillingTab

export const SECTION_TITLE: Record<FinanceSection, string> = { funds: 'Client Funds', billing: 'Billing' }

export const SECTION_TABS: Record<FinanceSection, { id: FinanceTabId; label: string }[]> = {
  funds: [{ id: 'balances', label: 'Balances' }, { id: 'transactions', label: 'Transactions' }, { id: 'receipts', label: 'Receipts' }],
  billing: [{ id: 'authorizations', label: 'Authorizations' }, { id: 'claims', label: 'Claims' }],
}

export function tabFor(section: FinanceSection, tab: string | null | undefined): FinanceTabId {
  const tabs = SECTION_TABS[section]
  return (tabs.find((t) => t.id === tab)?.id ?? tabs[0].id)
}

export const FINANCE_NOT_PUBLISHED =
  'The server did not recognise this read: Client Funds and Billing answer once the platform release that carries them is live.'

/** A refusal as a sentence; "Unknown action." is a door shut to this account, or to the master a deployment without it. */
export function financeRefusal(error: string): string {
  return unknownActionWords(error, FINANCE_NOT_PUBLISHED) ?? (error || 'The read did not answer.')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** YYYY-MM-DD → "Mon D, YYYY"; anything else as written, or "—". */
export function dayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return iso || '—'
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`
}

/** "$1,234.56" and "−$36.20"; "—" for an unknown amount. */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? '−' : ''}$${abs}`
}

const count = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'))

/** "2,081 / 15,192", with "—" for the half nobody holds. */
export function unitsCell(used: number | null, authorized: number | null): string {
  return `${count(used)} / ${count(authorized)}`
}

/** A card only by its last four. */
export function cardMask(last4: string): string {
  const d = String(last4 || '').replace(/\D/g, '').slice(-4)
  return d ? `•••• •••• •••• ${d}` : ''
}

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'slate'

const TONES: Record<string, Tone> = {
  'Receipt On File': 'green', Recorded: 'slate', 'Missing receipt': 'red', 'Needs review': 'amber', 'No receipt expected': 'slate',
  Filed: 'blue', 'On file': 'blue', 'Opening unknown': 'slate', Current: 'green', 'Renewal due': 'amber', Expired: 'red',
  Unknown: 'slate', Rejected: 'red', Denied: 'red', Draft: 'slate', Submitted: 'blue', Paid: 'green',
}

export function statusTone(status: string): Tone {
  if (/^Closed through/.test(status)) return 'green'
  return TONES[status] ?? 'slate'
}

/* ---------- the KPI cards ---------- */

export type Kpi = { id: string; label: string; value: string; sub: string; tone: Tone }

const known = (n: number | null | undefined): n is number => n !== null && n !== undefined

/** A count nobody could take is slate, never the green of a true zero. */
const toneOf = (n: number | null | undefined, when: (n: number) => Tone): Tone => (known(n) ? when(n) : 'slate')

export function fundsKpis(a: FundsAnswer | null): Kpi[] {
  const k = a?.kpis
  const spends = a?.analytics?.compliance.spends ?? null
  const balanceSub = !k ? '' : k.personal_balance_basis === 'on_file'
    ? `On file in Client Finances${k.personal_balance_as_of ? ` · as of ${k.personal_balance_as_of}` : ''}`
    : k.personal_balance_basis === 'closed_months' ? 'From the months closed in Client Finances' : k.personal_balance_why
  return [
    { id: 'personal_balance', label: 'Personal balance', value: money(k?.personal_balance), sub: balanceSub,
      tone: toneOf(k?.personal_balance, (n) => (n < 0 ? 'red' : 'blue')) },
    { id: 'missing_receipts', label: 'Missing receipts', value: count(k?.missing_receipts),
      sub: !known(k?.missing_receipts) ? (a?.tabs.transactions.why ?? '')
        : spends !== null ? `of ${spends.toLocaleString('en-US')} spends` : '',
      tone: toneOf(k?.missing_receipts, (n) => (n > 0 ? 'red' : 'green')) },
    { id: 'transactions', label: 'Transactions', value: count(k?.transactions),
      sub: a?.as_of ? `Ledger through ${dayLabel(a.as_of)}` : (a?.tabs.transactions.why ?? ''), tone: 'slate' },
  ]
}

export function billingKpis(a: BillingAnswer | null): Kpi[] {
  const k = a?.kpis
  return [
    { id: 'renewals_due', label: 'Renewals due', value: count(k?.renewals_due),
      sub: !k || known(k.renewals_due) ? 'PAWS or ISP spans ending within 60 days, or already ended' : k.renewals_due_why,
      tone: toneOf(k?.renewals_due, (n) => (n > 0 ? 'amber' : 'green')) },
    { id: 'draft_claims', label: 'Draft claims', value: count(k?.draft_claims), sub: k?.draft_claims === null ? (k?.draft_claims_why ?? '') : '',
      tone: 'slate' },
    { id: 'unpaid_claims', label: 'Unpaid claims $', value: money(k?.unpaid_claims),
      sub: !k ? '' : known(k.unpaid_claims) || !k.unpaid_claims_why ? k.unpaid_claims_basis : k.unpaid_claims_why,
      tone: toneOf(k?.unpaid_claims, (n) => (n > 0 ? 'red' : 'green')) },
  ]
}

/* ---------- the table ---------- */

export type Column = { key: string; label: string; align?: 'right' }

export const COLUMNS: Record<FinanceTabId, Column[]> = {
  balances: [{ key: 'record', label: 'Client' }, { key: 'balance', label: 'Personal balance', align: 'right' },
             { key: 'missing', label: 'Missing receipts', align: 'right' }, { key: 'action', label: '' }],
  transactions: [{ key: 'record', label: 'Record' }, { key: 'date', label: 'Date' }, { key: 'amount', label: 'Amount', align: 'right' },
                 { key: 'status', label: 'Status' }, { key: 'action', label: 'Action' }],
  receipts: [{ key: 'record', label: 'Transaction' }, { key: 'date', label: 'Date' }, { key: 'amount', label: 'Amount', align: 'right' },
             { key: 'status', label: 'Status' }, { key: 'action', label: '' }],
  authorizations: [{ key: 'record', label: 'Record' }, { key: 'date', label: 'Date' },
                   { key: 'units', label: 'Units used / authorized', align: 'right' }, { key: 'status', label: 'Status' },
                   { key: 'action', label: 'Action' }],
  claims: [{ key: 'record', label: 'Record' }, { key: 'date', label: 'Date' }, { key: 'amount', label: 'Amount', align: 'right' },
           { key: 'status', label: 'Status' }, { key: 'action', label: 'Action' }],
}

export type PanelKind = 'txn' | 'receipt' | 'balance' | 'auth' | 'claim' | 'doc'
export type FinancePanel = { kind: PanelKind; id: string }

/** What a row's action opens: the pencil (its detail), a receipt, or the transactions of a fund. */
export type RowAction = { kind: 'panel'; panel: FinancePanel; label: string } | { kind: 'transactions'; fund: string; label: string }

export type TableRow = {
  id: string; record: string; sub: string; cells: Record<string, string>; status: string; tone: Tone; search: string
  panel: FinancePanel; action: RowAction; fund: string
}

const words = (...parts: string[]) => parts.filter(Boolean).join(' ').toLowerCase()

export function tableRows(tab: FinanceTabId, funds: FundsAnswer | null, billing: BillingAnswer | null): TableRow[] {
  if (tab === 'balances') {
    return (funds?.tabs.balances.rows ?? []).map((r) => ({
      id: r.id, record: r.record, sub: r.details, status: r.status, tone: statusTone(r.status), fund: r.fund,
      cells: { balance: money(r.personal_balance), missing: count(r.missing_receipts) },
      search: words(r.record, r.fund, r.details, r.status), panel: { kind: 'balance', id: r.id },
      action: { kind: 'transactions', fund: r.fund, label: 'View transactions' },
    }))
  }
  if (tab === 'transactions') {
    return (funds?.tabs.transactions.rows ?? []).map((r) => ({
      id: r.id, record: r.record, sub: r.details, status: r.status, tone: statusTone(r.status), fund: r.fund,
      cells: { date: dayLabel(r.date), amount: money(r.amount) },
      search: words(r.record, r.details, r.status, r.date, r.fund, String(r.amount)), panel: { kind: 'txn', id: r.id },
      action: { kind: 'panel', panel: { kind: 'txn', id: r.id }, label: `Open ${r.record}` },
    }))
  }
  if (tab === 'receipts') {
    const byTxn = new Map((funds?.tabs.transactions.rows ?? []).map((t) => [t.id, t]))
    return (funds?.tabs.receipts.rows ?? []).map((r) => ({
      id: r.id, record: r.record, sub: r.details, status: r.status, tone: statusTone(r.status), fund: byTxn.get(r.txn_id)?.fund ?? '',
      cells: { date: dayLabel(r.date), amount: money(r.amount) },
      search: words(r.record, r.details, r.status, r.date), panel: { kind: 'receipt', id: r.id },
      action: { kind: 'panel', panel: { kind: 'receipt', id: r.id }, label: 'Review receipt' },
    }))
  }
  if (tab === 'authorizations') {
    return (billing?.tabs.authorizations.rows ?? []).map((r) => ({
      id: r.id, record: r.record, sub: r.details || r.source, status: r.status, tone: statusTone(r.status), fund: '',
      cells: { date: r.span_start ? `${dayLabel(r.span_start)} – ${dayLabel(r.span_end)}` : '—', units: unitsCell(r.units_used, r.units_authorized) },
      search: words(r.record, r.details, r.status, r.source, r.ssa), panel: { kind: 'auth', id: r.id },
      action: { kind: 'panel', panel: { kind: 'auth', id: r.id }, label: `Open ${r.record}` },
    }))
  }
  return (billing?.tabs.claims.rows ?? []).map((r) => ({
    id: r.id, record: r.record, sub: r.details, status: r.status, tone: statusTone(r.status), fund: '',
    cells: { date: dayLabel(r.date), amount: money(r.amount) },
    search: words(r.record, r.details, r.status, r.date, r.cycle, r.source), panel: { kind: 'claim', id: r.id },
    action: { kind: 'panel', panel: { kind: 'claim', id: r.id }, label: `Open ${r.record}` },
  }))
}

/** The "All statuses" choices: the door's own list first, then any status the rows carry that it does not name. */
export function statusChoices(rows: TableRow[], declared: string[]): string[] {
  const out = [...declared]
  for (const r of rows) if (r.status && !out.includes(r.status)) out.push(r.status)
  return out.filter((s) => rows.some((r) => r.status === s))
}

export function filterRows(rows: TableRow[], query: string, status: string, fund = ''): TableRow[] {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => (!status || r.status === status) && (!fund || r.fund === fund) && (!q || r.search.includes(q)))
}

/** What a tab says above its table: why its source did not answer, or that it truly has nothing. */
export function tabNote(tab: FinanceTabId, funds: FundsAnswer | null, billing: BillingAnswer | null, clientName: string):
  { why: string; empty: string } {
  const t = tab === 'balances' || tab === 'transactions' || tab === 'receipts' ? funds?.tabs[tab] : billing?.tabs[tab]
  if (!t) return { why: '', empty: '' }
  const who = clientName || 'this client'
  const EMPTY: Record<FinanceTabId, string> = {
    balances: `Client Finances holds no balance and no transaction for ${who}.`,
    transactions: `Client Finances has no transaction under ${who}'s name.`,
    receipts: `No spend and no Funds-folder receipt is on file for ${who}.`,
    authorizations: `No PAWS span and no ISP span is on file for ${who}.`,
    claims: `No MBS claim line and no claim names ${who}.`,
  }
  return { why: t.why, empty: t.rows.length || t.why ? '' : EMPTY[tab] }
}

/* ---------- the panel in the URL ---------- */

const KINDS: PanelKind[] = ['txn', 'receipt', 'balance', 'auth', 'claim', 'doc']

export function panelParam(p: FinancePanel | null): string {
  return p ? `${p.kind}:${p.id}` : ''
}

export function panelOf(param: string | null | undefined): FinancePanel | null {
  const m = /^([a-z]+):(.+)$/.exec(String(param ?? ''))
  if (!m || !KINDS.includes(m[1] as PanelKind)) return null
  return { kind: m[1] as PanelKind, id: m[2] }
}

export const PANEL_LABEL: Record<PanelKind, string> = {
  txn: 'Transaction', receipt: 'Receipt', balance: 'Balance', auth: 'Authorization', claim: 'Claim', doc: 'Document',
}

/** The receipt's own file, or why it cannot be shown here. */
export function receiptFile(r: ReceiptRow): { fileId: string; why: string } {
  if (r.file_id) return { fileId: r.file_id, why: '' }
  if (r.status === 'Missing receipt') return { fileId: '', why: 'No receipt is on file for this spend.' }
  if (r.status === 'No receipt expected') return { fileId: '', why: r.note || 'This spend was marked as having no receipt.' }
  if (r.receipt_name) {
    return { fileId: '', why: `The receipt is on file by name only (${r.receipt_name}); the ledger row carries no Drive file, so it cannot be opened here.` }
  }
  return { fileId: '', why: 'No file is on record for this receipt.' }
}
