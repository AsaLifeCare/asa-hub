// FINANCES — the old platform Finances doc-hub (`/#/financeiro`, source pages/Financeiro.tsx)…
// The layout mirrors the old platform screen element-for-element: header (eyebrow + title + description, actions…
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Building2, CalendarDays, DollarSign, ExternalLink, FileSpreadsheet,
  FileText, FolderOpen, Landmark, Loader2, Plane, RefreshCw, ScanLine, Table2, X,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TINT_BG, TINT_FG, type ExtendedTintName } from '@/lib/tints'

/* Slice row shape (server/finance_slices.py over asa_finance_doc). */
interface FinanceRow {
  id?: string
  folder?: string
  name?: string
  mime?: string
  size_bytes?: number
  web_view_link?: string
  vendor?: string
  doc_date?: string
  amount?: number | null
  currency?: string
  category?: string
  method?: string
  modified_time?: string
  extracted_at?: string
}

const OVERVIEW = '__overview__'

// Company Finances summary slice row (server/finance_slices.py over asa_finance_summary — the old platform's…
interface SummaryExpense {
  category?: string
  amount?: number
  pct?: number | null
}
interface NetModel {
  kind?: string
  label?: string
  net_income?: number[]
  net_accrued?: number[]
  end_accrued?: number | null
}
interface SummaryKpis {
  expense_total?: number | null
  payroll_total?: number | null
  payroll_pct?: number | null
  ops_net_accrued?: number | null
  ops_monthly_net?: number | null
  investment_net_accrued?: number | null
  owner_comp_current?: number | null
  owner_comp_target?: number | null
}
interface FinanceSummary {
  id?: string
  wages?: number | null
  taxes?: number | null
  total?: number | null
  wage_pct?: number | null
  tax_pct?: number | null
  expenses?: SummaryExpense[]
  expense_total?: number | null
  monthly_staff?: number[]
  net_income?: number[]
  net_accrued?: number[]
  net_models?: NetModel[]
  owner_comp?: { owners?: number; target_total?: number | null; current_total?: number | null } | null
  kpis?: SummaryKpis
  franchises?: { name?: string; revenue?: number[] }[]
  sources?: string[]
  updated_at?: string
  computed_at?: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Travel slice row (resource travelTrips, tab travel_trips).
interface TravelTrip {
  id?: string
  purpose?: string
  reason?: string
  budget?: string
  status?: string
  country?: string
  startDate?: string
  endDate?: string
  traveller?: string
  decidedBy?: string
  decidedAt?: string
  outcome?: string
  createdAt?: string
}

/** "US$ 1,234.50" / "$1,234" / bare number → number; unparseable → null. */
function parseBudget(s?: string): number | null {
  if (!s) return null
  const n = Number(String(s).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** the old platform isPayrollCat(): the payroll rows inside the expense breakdown. */
function isPayrollCat(c?: string): boolean {
  const s = (c || '').toLowerCase()
  return s.includes('payroll') || s.includes('wage') || s.includes('staff') || s.includes('salar')
}

/** the old platform methodBadge() on platform tints: LLM blue, reference amber, sheet/regex slate. */
const METHOD_TINT: Record<string, ExtendedTintName> = {
  llm: 'blue',
  reference: 'amber',
  sheet: 'slate',
  regex: 'slate',
}
const METHOD_LABEL: Record<string, string> = {
  llm: 'LLM',
  reference: 'REF',
  sheet: 'SHEET',
  regex: 'OCR',
}

function fmtMoney(n?: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
}

function num(n?: number | null): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function csvCell(s: unknown): string {
  const v = s == null ? '' : String(s)
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function safeHref(url?: string): string | null {
  const u = (url || '').trim()
  if (!u) return null
  if (/^https?:/i.test(u)) return u
  if (u.startsWith('/')) return u
  return `https://${u}`
}

export default function FinancesPage() {
  const [rows, setRows] = useState<FinanceRow[] | null>(null)
  const [summary, setSummary] = useState<FinanceSummary[] | null>(null)
  const [trips, setTrips] = useState<TravelTrip[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [active, setActive] = useState<string>(OVERVIEW)
  const [selected, setSelected] = useState<FinanceRow | null>(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const r = await api.list<FinanceRow>('finances')
      setRows(Array.isArray(r) ? r : [])
    } catch {
      setRows((prev) => prev ?? [])
    }
    // The Company Finances summary is a separate slice; a failure (or an as-yet-empty the old platform cache) must…
    try {
      const s = await api.list<FinanceSummary>('financeSummary').catch(() => [])
      setSummary(Array.isArray(s) ? s : [])
    } catch {
      setSummary((prev) => prev ?? [])
    }
    // Company travel — informational only (budgets; no actuals exist yet).
    try {
      const t = await api.list<TravelTrip>('travelTrips').catch(() => [])
      setTrips(Array.isArray(t) ? t : [])
    } catch {
      setTrips((prev) => prev ?? [])
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const items = useMemo(() => rows ?? [], [rows])

  // the old platform's overview tabs: one per Finances subfolder, with the cached count + total each.
  const folders = useMemo(() => {
    const m = new Map<string, { name: string; docs: number; priced: number; total: number }>()
    for (const it of items) {
      const name = it.folder || '(no folder)'
      const cur = m.get(name) ?? { name, docs: 0, priced: 0, total: 0 }
      cur.docs += 1
      if (it.amount !== null && it.amount !== undefined) {
        cur.priced += 1
        cur.total += num(it.amount)
      }
      m.set(name, cur)
    }
    return [...m.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  }, [items])

  const grandTotal = useMemo(() => folders.reduce((s, f) => s + f.total, 0), [folders])
  const pricedCount = useMemo(() => items.filter((i) => i.amount !== null && i.amount !== undefined).length, [items])

  const activeFolder = active === OVERVIEW ? null : (folders.find((f) => f.name === active) ?? null)
  const tabItems = useMemo(
    () => (active === OVERVIEW ? [] : items.filter((it) => (it.folder || '(no folder)') === active)),
    [items, active],
  )

  /* the old platform doExport(): dump the current view as a CSV sheet. */
  const exportCsv = useCallback(() => {
    const head = ['Folder', 'File', 'Vendor', 'Date', 'Amount', 'Currency', 'Category', 'Method', 'Drive link']
    const src = active === OVERVIEW ? items : tabItems
    const lines = [head.join(',')]
    for (const f of src) {
      lines.push([
        f.folder, f.name, f.vendor, f.doc_date, f.amount ?? '', f.currency || 'USD',
        f.category, f.method, f.web_view_link,
      ].map(csvCell).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = active === OVERVIEW ? 'company-finances.csv' : `finances-${active}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [active, items, tabItems])

  const loading = rows === null
  const summaryData = summary?.[0] ?? null

  return (
    <div className="w-full px-5 py-6">
      {/* ── header: title + description left, actions + grand total right (the old platform positions) ── */}
      <PageHeader
        title="Finances"
        subtitle="Company finances at a glance — a tab per Finances Drive folder where the cortex OCR-extracts vendor · date · amount. Read-only here; scanning and import stay on the old platform."
        actions={
          <>
            <button
              onClick={exportCsv}
              disabled={items.length === 0}
              title="Export the current view as a CSV sheet"
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
            >
              <FileSpreadsheet size={14} /> Export CSV
            </button>
            <button
              onClick={() => void load()}
              disabled={refreshing}
              title="Reload the finance rows"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <span className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">
              Grand total <span className={cn('text-[13px] font-bold tabular-nums', TINT_FG.mint)}>{fmtMoney(grandTotal)}</span>
            </span>
          </>
        }
      />

      {/* ── tabs row: Overview first, then one tab per subfolder with its total ── */}
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-border">
        <TabButton
          active={active === OVERVIEW}
          onClick={() => setActive(OVERVIEW)}
          icon={<Table2 size={13} />}
          label="Overview"
        />
        {folders.map((f) => (
          <TabButton
            key={f.name}
            active={active === f.name}
            onClick={() => setActive(f.name)}
            icon={<FolderOpen size={13} />}
            label={f.name}
            total={f.total > 0 ? fmtMoney(f.total) : undefined}
            title={`${f.name} — ${f.docs} docs · ${fmtMoney(f.total)}`}
          />
        ))}
      </div>

      {/* ── content ── */}
      {loading ? (
        <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : items.length === 0 && !summaryData ? (
        <Card padded={false}>
          <EmptyState
            title="No finance rows extracted yet"
            body="The finances slice reads the old platform's extraction cache (asa_finance_doc). Once the old platform scans the Finances Drive folder, every document shows up here with its vendor, date and amount."
          />
        </Card>
      ) : active === OVERVIEW ? (
        <OverviewView
          folders={folders}
          grandTotal={grandTotal}
          docCount={items.length}
          pricedCount={pricedCount}
          summary={summaryData}
          trips={trips ?? []}
          onOpenFolder={(name) => setActive(name)}
        />
      ) : (
        <>
          {/* ── folder stat line (the old platform: name · N docs · M with value · total) ── */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-[13px] font-semibold uppercase tracking-[0.1em] text-text-1">{active}</span>
            <span className="text-[12px] text-text-3">
              {tabItems.length} docs · {tabItems.filter((i) => i.amount !== null && i.amount !== undefined).length} with value
            </span>
            <span className={cn('text-[13px] font-semibold tabular-nums', TINT_FG.mint)}>{fmtMoney(activeFolder?.total ?? 0)}</span>
          </div>

          {/* ── the document sheet (same column order as the old platform table) ── */}
          {tabItems.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                title="Nothing in this folder"
                body="This folder has no extracted documents in the cache yet."
              />
            </Card>
          ) : (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-surface-2">
                    {['File', 'Vendor', 'Date', 'Amount', ''].map((c, i) => (
                      <th
                        key={i}
                        className={cn(
                          'whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-text-3',
                          i > 0 && 'border-l border-border',
                          c === 'Amount' ? 'text-right' : 'text-left',
                        )}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabItems.map((f, i) => {
                    const view = safeHref(f.web_view_link)
                    const method = (f.method || 'regex').toLowerCase()
                    const mTint = METHOD_TINT[method] ?? 'slate'
                    return (
                      <tr
                        key={f.id || `${f.name}-${i}`}
                        onClick={() => setSelected(f)}
                        className="cursor-pointer border-t border-border transition-colors odd:bg-surface even:bg-surface-2/40 hover:bg-surface-2"
                      >
                        <td className="max-w-[360px] px-3 py-1.5">
                          <span className="flex min-w-0 items-center gap-2" title={f.name || ''}>
                            <FileText size={13} className="shrink-0 text-text-3" />
                            <span className="truncate font-medium text-text-1">{f.name || `File ${i + 1}`}</span>
                          </span>
                        </td>
                        <td className="border-l border-border px-3 py-1.5">
                          <span className="flex items-center gap-1.5 text-[12px] text-text-2">
                            {f.vendor ? <Building2 size={11} className="shrink-0 text-text-3" /> : null}
                            <span className="max-w-[220px] truncate">{f.vendor || '—'}</span>
                          </span>
                        </td>
                        <td className="border-l border-border px-3 py-1.5">
                          <span className="flex items-center gap-1.5 text-[12px] tabular-nums text-text-2">
                            {f.doc_date ? <CalendarDays size={11} className="shrink-0 text-text-3" /> : null}
                            {fmtDate(f.doc_date)}
                          </span>
                        </td>
                        <td
                          className={cn(
                            'border-l border-border px-3 py-1.5 text-right text-[12.5px] font-semibold tabular-nums',
                            f.amount !== null && f.amount !== undefined ? TINT_FG.mint : 'text-text-3',
                          )}
                        >
                          {fmtMoney(f.amount)}
                        </td>
                        <td className="border-l border-border px-3 py-1.5 text-right whitespace-nowrap">
                          <span className={cn('mr-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold', TINT_BG[mTint], TINT_FG[mTint])}>
                            {METHOD_LABEL[method] ?? 'OCR'}
                          </span>
                          {view && (
                            <a
                              href={view}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center justify-center p-1 text-text-2 transition-colors hover:text-text-1"
                              title="Open in Drive"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {selected && <FinanceDetail row={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ── Overview tab: the old platform's Company Finances panel set (from the financeSummary slice — the…
function OverviewView({
  folders, grandTotal, docCount, pricedCount, summary, trips, onOpenFolder,
}: {
  folders: { name: string; docs: number; priced: number; total: number }[]
  grandTotal: number
  docCount: number
  pricedCount: number
  summary: FinanceSummary | null
  trips: TravelTrip[]
  onOpenFolder: (name: string) => void
}) {
  const largest = folders[0]
  return (
    <div className="flex flex-col gap-5">
      {summary ? (
        <CompanySummary data={summary} />
      ) : (
        <Card padded={false}>
          <EmptyState
            title="Company Finances summary not cached yet"
            body="The KPI, payroll, expense-breakdown, net-income and franchise panels are computed by the old platform from the Finances &quot;General&quot; Google Sheets and cached in Postgres on every read — they will be populated on the old platform's next payroll read. No figures are shown until then."
          />
        </Card>
      )}

      {/* company travel — informational (budgets; no actuals recorded yet) */}
      <TravelPanel trips={trips} />

      {/* document KPI strip (from the extraction cache rows) */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <KpiCard icon={<DollarSign size={14} />} tint="mint" label="Grand total extracted" value={fmtMoney(grandTotal)} />
        <KpiCard icon={<ScanLine size={14} />} tint="blue" label="Documents scanned" value={docCount} />
        <KpiCard icon={<FileText size={14} />} tint="amber" label="With a value" value={`${pricedCount} of ${docCount}`} />
        <KpiCard
          icon={<Landmark size={14} />}
          tint="lavender"
          label="Largest folder"
          value={largest ? fmtMoney(largest.total) : '—'}
          sub={largest?.name}
        />
      </div>

      {/* per-folder totals sheet (the position of the old platform expense breakdown) */}
      <Card padded={false} className="overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <span className="text-[12px] font-semibold tracking-wide text-text-1">Company Finances · Folder totals</span>
          <span className="text-[11px] text-text-3">read-only · source: the old platform's finance extraction cache</span>
        </div>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2">
              <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Folder</th>
              <th className="border-l border-border px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Docs</th>
              <th className="border-l border-border px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">With value</th>
              <th className="border-l border-border px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Total</th>
              <th className="border-l border-border px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">% of total</th>
            </tr>
          </thead>
          <tbody>
            {folders.map((f) => (
              <tr
                key={f.name}
                onClick={() => onOpenFolder(f.name)}
                className="cursor-pointer border-t border-border transition-colors odd:bg-surface even:bg-surface-2/40 hover:bg-surface-2"
                title={`Open the ${f.name} tab`}
              >
                <td className="px-4 py-2 font-medium text-text-1">{f.name}</td>
                <td className="border-l border-border px-4 py-2 text-right text-[12px] tabular-nums text-text-2">{f.docs}</td>
                <td className="border-l border-border px-4 py-2 text-right text-[12px] tabular-nums text-text-2">{f.priced}</td>
                <td className={cn('border-l border-border px-4 py-2 text-right text-[12.5px] font-semibold tabular-nums', f.total > 0 ? TINT_FG.mint : 'text-text-3')}>
                  {fmtMoney(f.total)}
                </td>
                <td className="border-l border-border px-4 py-2 text-right text-[12px] tabular-nums text-text-3">
                  {grandTotal > 0 ? `${((f.total / grandTotal) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-2">
              <td className="border-t-2 border-border px-4 py-2 font-semibold text-text-1">Grand total</td>
              <td className="border-l border-t-2 border-border px-4 py-2 text-right text-[12px] font-semibold tabular-nums text-text-1">{docCount}</td>
              <td className="border-l border-t-2 border-border px-4 py-2 text-right text-[12px] font-semibold tabular-nums text-text-1">{pricedCount}</td>
              <td className={cn('border-l border-t-2 border-border px-4 py-2 text-right text-[12.5px] font-bold tabular-nums', TINT_FG.mint)}>
                {fmtMoney(grandTotal)}
              </td>
              <td className="border-l border-t-2 border-border px-4 py-2 text-right text-[12px] tabular-nums text-text-3">100%</td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <p className="text-[11px] text-text-3">
        The folder totals above come from the old platform's document extraction cache (asa_finance_doc); the Company
        Finances panels come from the old platform's cached payroll summary (asa_finance_summary), refreshed on every
        payroll read on the old platform.
      </p>
    </div>
  )
}

// ── Company travel — informational only.
const TRIP_STATUS_TINT: Record<string, ExtendedTintName> = {
  completed: 'mint',
  approved: 'blue',
  declined: 'slate',
}

function TravelPanel({ trips }: { trips: TravelTrip[] }) {
  const rows = useMemo(
    () => [...trips].sort((a, b) => (b.startDate || b.createdAt || '').localeCompare(a.startDate || a.createdAt || '')),
    [trips],
  )
  const budgetedTotal = useMemo(
    () => rows
      .filter((t) => (t.status || '').toLowerCase() !== 'declined')
      .reduce((s, t) => s + (parseBudget(t.budget) ?? 0), 0),
    [rows],
  )
  if (rows.length === 0) return null
  return (
    <Card padded={false} className="overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
        <span className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-text-1">
          <Plane size={13} className="text-text-3" /> Company travel
        </span>
        <span className="text-[11px] text-text-3">{rows.length} trip{rows.length === 1 ? '' : 's'}</span>
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-surface-2">
            <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Purpose</th>
            <th className="border-l border-border px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Traveller</th>
            <th className="border-l border-border px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Dates</th>
            <th className="border-l border-border px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Status</th>
            <th className="border-l border-border px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Budget</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const status = (t.status || '').toLowerCase()
            const tint = TRIP_STATUS_TINT[status] ?? 'slate'
            const dates = [fmtDate(t.startDate), fmtDate(t.endDate)].filter((d) => d && d !== '—').join(' → ')
            return (
              <tr key={t.id || `${t.purpose}-${i}`} className="border-t border-border odd:bg-surface even:bg-surface-2/40">
                <td className="max-w-[320px] px-4 py-1.5">
                  <span className="block truncate font-medium text-text-1" title={t.purpose || ''}>{t.purpose || t.reason || '—'}</span>
                  {t.country && <span className="block truncate text-[11px] text-text-3">{t.country}</span>}
                </td>
                <td className="border-l border-border px-4 py-1.5 text-[12px] text-text-2">{t.traveller || '—'}</td>
                <td className="border-l border-border px-4 py-1.5 whitespace-nowrap text-[12px] tabular-nums text-text-2">{dates || '—'}</td>
                <td className="border-l border-border px-4 py-1.5">
                  {status ? (
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', TINT_BG[tint], TINT_FG[tint])}>
                      {status}
                    </span>
                  ) : '—'}
                </td>
                <td className="border-l border-border px-4 py-1.5 text-right text-[12.5px] font-semibold tabular-nums text-text-1">
                  {fmtMoney(parseBudget(t.budget))}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-surface-2">
            <td colSpan={4} className="border-t-2 border-border px-4 py-2 font-semibold text-text-1">Total budgeted (non-declined)</td>
            <td className={cn('border-l border-t-2 border-border px-4 py-2 text-right font-bold tabular-nums', TINT_FG.mint)}>
              {fmtMoney(budgetedTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="border-t border-border px-4 py-2 text-[11px] text-text-3">
        Actuals are not recorded anywhere yet — budgets only.
      </p>
    </Card>
  )
}

// ── Company Finances summary panels — the old platform Financeiro.tsx CompanyFinancesView on hub design tokens…
function CompanySummary({ data }: { data: FinanceSummary }) {
  const expenses = (data.expenses || []).filter((e) => e && e.category)
  const monthly = (data.monthly_staff || []).filter((n) => typeof n === 'number')
  const franchises = (data.franchises || []).filter((f) => f && Array.isArray(f.revenue) && f.revenue.length)
  const maxP = franchises.reduce((mx, f) => Math.max(mx, f.revenue?.length || 0), 0)
  const expTotal = data.expense_total ?? (expenses.length ? expenses.reduce((s, e) => s + (e.amount || 0), 0) : null)
  const payrollOnly = expenses.filter((e) => isPayrollCat(e.category))
  const payrollTotal = payrollOnly.reduce((s, e) => s + (e.amount || 0), 0)
  const monthlyTotal = monthly.reduce((s, n) => s + n, 0)
  const kpis = data.kpis || {}
  const owner = data.owner_comp || null
  const netModels: NetModel[] = (data.net_models || []).filter(
    (m) => m && ((m.net_income?.length || 0) + (m.net_accrued?.length || 0) > 0),
  )
  const kPayrollPct = kpis.payroll_pct ?? (payrollTotal && expTotal ? +((payrollTotal / expTotal) * 100).toFixed(1) : null)

  return (
    <>
      {/* KPI strip (the old platform: headline indicators) */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={<DollarSign size={14} />} tint="slate" label="Total expenses" value={fmtMoney(expTotal)} sub="all categories" />
        <KpiCard
          icon={<Landmark size={14} />}
          tint="mint"
          label="Payroll"
          value={fmtMoney(kpis.payroll_total ?? (payrollTotal || null))}
          sub={kPayrollPct != null ? `${kPayrollPct}% of costs` : undefined}
        />
        {kpis.ops_net_accrued != null && (
          <KpiCard
            icon={<Building2 size={14} />}
            tint={kpis.ops_net_accrued >= 0 ? 'mint' : 'danger'}
            label={`Care ops net (${(netModels.find((m) => m.kind === 'operations')?.net_accrued?.length) || 16}mo)`}
            value={fmtMoney(kpis.ops_net_accrued)}
            sub={kpis.ops_monthly_net != null ? `${fmtMoney(kpis.ops_monthly_net)}/mo` : 'operations model'}
          />
        )}
        {kpis.investment_net_accrued != null && (
          <KpiCard
            icon={<Building2 size={14} />}
            tint={kpis.investment_net_accrued >= 0 ? 'mint' : 'danger'}
            label="Property model"
            value={fmtMoney(kpis.investment_net_accrued)}
            sub="real-estate pro-forma"
          />
        )}
        {owner && (owner.current_total != null || owner.target_total != null) && (
          <KpiCard
            icon={<DollarSign size={14} />}
            tint="lavender"
            label="Owner comp"
            value={fmtMoney(owner.current_total)}
            sub={owner.target_total != null ? `target ${fmtMoney(owner.target_total)}` : `${owner.owners || 0} owners`}
          />
        )}
      </div>

      {/* the expense breakdown sheet */}
      {expenses.length > 0 && (
        <Card padded={false} className="overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
            <span className="text-[12px] font-semibold tracking-wide text-text-1">Company Finances · Expense Breakdown</span>
            <span className="text-[11px] text-text-3">read-only · source: General sheets</span>
          </div>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-2">
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Category</th>
                <th className="border-l border-border px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Amount</th>
                <th className="border-l border-border px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">% of total</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e, i) => {
                const pay = isPayrollCat(e.category)
                return (
                  <tr key={`${e.category}-${i}`} className={cn('border-t border-border', pay ? TINT_BG.mint : 'odd:bg-surface even:bg-surface-2/40')}>
                    <td className="px-4 py-1.5 text-text-1">
                      {pay && (
                        <span className={cn('mr-1.5 inline-block rounded-full px-1.5 py-0.5 align-middle text-[10px] font-semibold', TINT_BG.mint, TINT_FG.mint)}>PAY</span>
                      )}
                      {e.category}
                    </td>
                    <td className={cn('border-l border-border px-4 py-1.5 text-right tabular-nums', pay ? cn('font-semibold', TINT_FG.mint) : 'text-text-2')}>
                      {fmtMoney(e.amount)}
                    </td>
                    <td className="border-l border-border px-4 py-1.5 text-right tabular-nums text-text-3">
                      {e.pct != null ? `${e.pct.toFixed(2)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2">
                <td className="border-t-2 border-border px-4 py-2 font-semibold text-text-1">Total expenses</td>
                <td className="border-l border-t-2 border-border px-4 py-2 text-right font-semibold tabular-nums text-text-1">{fmtMoney(expTotal)}</td>
                <td className="border-l border-t-2 border-border px-4 py-2 text-right tabular-nums text-text-3">100%</td>
              </tr>
              {payrollTotal > 0 && (
                <tr className={TINT_BG.mint}>
                  <td className={cn('border-t border-border px-4 py-1.5', TINT_FG.mint)}>↳ Employee payment (payroll rows)</td>
                  <td className={cn('border-l border-t border-border px-4 py-1.5 text-right tabular-nums', TINT_FG.mint)}>{fmtMoney(payrollTotal)}</td>
                  <td className={cn('border-l border-t border-border px-4 py-1.5 text-right tabular-nums', TINT_FG.mint)}>
                    {expTotal ? `${((payrollTotal / expTotal) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </Card>
      )}

      {/* monthly staff cost grid */}
      {monthly.length > 0 && (
        <Card padded={false} className="overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
            <span className="text-[12px] font-semibold tracking-wide text-text-1">Monthly staff cost (employee payment)</span>
            <span className="text-[11px] text-text-3">total {fmtMoney(monthlyTotal)}</span>
          </div>
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead>
              <tr className="bg-surface-2">
                {monthly.map((_, i) => (
                  <th key={i} className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">{MONTHS[i] || `M${i + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {monthly.map((n, i) => (
                  <td key={i} className={cn('border-t border-border px-3 py-1.5 text-right tabular-nums', n > 0 ? TINT_FG.mint : 'text-text-3')}>
                    {n > 0 ? fmtMoney(n) : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      {/* net income — EACH modelled stream, clearly separated (care operations vs
          the property/real-estate pro-forma) so the property loss is never
          mistaken for the company's bottom line */}
      {netModels.map((m, mi) => {
        const inc = (m.net_income || []).filter((n) => typeof n === 'number')
        const acc = (m.net_accrued || []).filter((n) => typeof n === 'number')
        if (!inc.length && !acc.length) return null
        const isOps = (m.kind || '') !== 'investment'
        const endAcc = m.end_accrued ?? (acc.length ? acc[acc.length - 1] : null)
        const be = inc.findIndex((n) => n >= 0)
        const cols = Math.max(inc.length, acc.length)
        return (
          <Card key={mi} padded={false} className="overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
              <span className="text-[12px] font-semibold tracking-wide text-text-1">
                Net income · {m.label || (isOps ? 'Care operations' : 'Property / real-estate')} model
                {!isOps && (
                  <span className={cn('ml-2 inline-block rounded-full px-1.5 py-0.5 align-middle text-[10px] font-semibold', TINT_BG.amber, TINT_FG.amber)}>
                    investment, not company P&amp;L
                  </span>
                )}
              </span>
              <span className={cn('text-[11px] font-semibold tabular-nums', endAcc != null && endAcc >= 0 ? TINT_FG.mint : TINT_FG.danger)}>
                {endAcc != null ? `accrued ${fmtMoney(endAcc)} over ${cols} mo` : ''}{isOps && be >= 0 ? ` · positive from month ${be + 1}` : ''}
              </span>
            </div>
            <table className="w-full min-w-max border-collapse text-[12px]">
              <thead>
                <tr className="bg-surface-2">
                  <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Month</th>
                  {Array.from({ length: cols }).map((_, i) => (
                    <th key={i} className="border-l border-border px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">{MONTHS[i % 12] || `M${i + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border-t border-border px-3 py-1.5 font-semibold whitespace-nowrap text-text-1">Net income</td>
                  {Array.from({ length: cols }).map((_, i) => {
                    const n = inc[i]
                    return (
                      <td
                        key={i}
                        className={cn(
                          'border-l border-t border-border px-3 py-1.5 text-right tabular-nums',
                          n == null ? 'text-text-3' : n >= 0 ? cn(TINT_BG.mint, TINT_FG.mint) : cn(TINT_BG.danger, TINT_FG.danger),
                        )}
                      >
                        {n == null ? '—' : fmtMoney(n)}
                      </td>
                    )
                  })}
                </tr>
                {acc.length > 0 && (
                  <tr>
                    <td className="border-t border-border px-3 py-1.5 font-semibold whitespace-nowrap text-text-3">Accrued</td>
                    {Array.from({ length: cols }).map((_, i) => {
                      const n = acc[i]
                      return (
                        <td
                          key={i}
                          className={cn(
                            'border-l border-t border-border px-3 py-1.5 text-right tabular-nums',
                            n == null ? 'text-text-3' : n >= 0 ? TINT_FG.mint : TINT_FG.danger,
                          )}
                        >
                          {n == null ? '—' : fmtMoney(n)}
                        </td>
                      )
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        )
      })}

      {/* franchise revenue over time */}
      {franchises.length > 0 && (
        <Card padded={false} className="overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
            <span className="text-[12px] font-semibold tracking-wide text-text-1">Franchise gains over time · revenue</span>
            <span className="text-[11px] text-text-3">{franchises.length} franchise{franchises.length === 1 ? '' : 's'}</span>
          </div>
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead>
              <tr className="bg-surface-2">
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Franchise</th>
                {Array.from({ length: maxP }).map((_, i) => (
                  <th key={i} className="border-l border-border px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">{MONTHS[i % 12] || `P${i + 1}`}</th>
                ))}
                <th className="border-l border-border px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {franchises.map((fr, r) => {
                const rev = fr.revenue || []
                const tot = rev.reduce((s, n) => s + (n || 0), 0)
                return (
                  <tr key={r} className="border-t border-border odd:bg-surface even:bg-surface-2/40">
                    <td className="px-3 py-1.5 whitespace-nowrap text-text-1">{fr.name}</td>
                    {Array.from({ length: maxP }).map((_, i) => (
                      <td key={i} className={cn('border-l border-border px-3 py-1.5 text-right tabular-nums', rev[i] != null ? TINT_FG.mint : 'text-text-3')}>
                        {rev[i] != null ? fmtMoney(rev[i]) : '—'}
                      </td>
                    ))}
                    <td className={cn('border-l border-border px-3 py-1.5 text-right font-semibold tabular-nums', TINT_FG.mint)}>{fmtMoney(tot)}</td>
                  </tr>
                )
              })}
              <tr className="bg-surface-2">
                <td className="border-t-2 border-border px-3 py-2 font-semibold text-text-1">Total</td>
                {Array.from({ length: maxP }).map((_, i) => {
                  const colSum = franchises.reduce((s, fr) => s + ((fr.revenue || [])[i] || 0), 0)
                  return (
                    <td key={i} className="border-l border-t-2 border-border px-3 py-2 text-right font-semibold tabular-nums text-text-1">{fmtMoney(colSum)}</td>
                  )
                })}
                <td className="border-l border-t-2 border-border px-3 py-2 text-right font-semibold tabular-nums text-text-1">
                  {fmtMoney(franchises.reduce((s, fr) => s + (fr.revenue || []).reduce((a, n) => a + (n || 0), 0), 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-[11px] text-text-3">
        {data.sources?.length ? `Source: ${data.sources.join(' · ')}` : ''}
        {data.sources?.length && (data.computed_at || data.updated_at) ? ' · ' : ''}
        {data.computed_at || data.updated_at ? `computed ${fmtDate(data.computed_at || data.updated_at)}` : ''}
      </p>
    </>
  )
}

/** the old platform tab button: quiet when off, mint underline + tint when on. */
function TabButton({
  active, onClick, icon, label, total, title,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  total?: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        '-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[12.5px] font-semibold transition-colors',
        active
          ? cn('border-current', TINT_FG.mint, TINT_BG.mint)
          : 'border-transparent text-text-2 hover:bg-surface-2',
      )}
    >
      {icon}
      {label}
      {total && <span className={cn('tabular-nums', TINT_FG.mint)}>{total}</span>}
    </button>
  )
}

/** the old platform KPI card, platform dress: icon tinted, value + uppercase label. */
function KpiCard({ icon, tint, label, value, sub }: {
  icon: ReactNode
  tint: ExtendedTintName
  label: string
  value: number | string
  sub?: string
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-3.5 py-3 shadow-1">
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', TINT_BG[tint], TINT_FG[tint])}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</span>
      </div>
      <div className="mt-1.5 text-[17px] font-bold leading-tight text-text-1 tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-text-3" title={sub}>{sub}</div>}
    </div>
  )
}

// Row detail — the old platform opens a Drive preview modal; here the row's full record slides in from the right…
function FinanceDetail({ row, onClose }: { row: FinanceRow; onClose: () => void }) {
  const href = safeHref(row.web_view_link)
  const method = (row.method || 'regex').toLowerCase()
  const mTint = METHOD_TINT[method] ?? 'slate'
  const fields: [string, string][] = [
    ['Folder', row.folder || '—'],
    ['Vendor', row.vendor || '—'],
    ['Amount', fmtMoney(row.amount)],
    ['Date', fmtDate(row.doc_date)],
    ['Currency', row.currency || 'USD'],
    ['Category', row.category || '—'],
    ['Size', row.size_bytes ? `${(row.size_bytes / 1024).toFixed(0)} KB` : '—'],
    ['Extracted', fmtDate(row.extracted_at)],
  ]
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/55 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="h-full w-full overflow-y-auto border-l border-border bg-surface p-5 shadow-2 sm:w-[384px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">Document detail</p>
            <h2 className="mt-1 font-display text-[17px] font-bold leading-6 text-text-1">{row.name || '(unnamed)'}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2"
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {row.amount !== null && row.amount !== undefined && (
            <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums', TINT_BG.mint, TINT_FG.mint)}>
              {fmtMoney(row.amount)}
            </span>
          )}
          <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold', TINT_BG[mTint], TINT_FG[mTint])}>
            {METHOD_LABEL[method] ?? 'OCR'}
          </span>
        </div>

        <dl className="divide-y divide-border rounded-md border border-border">
          {fields.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-3 py-2">
              <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">{k}</dt>
              <dd className="text-right text-[13px] text-text-1">{v}</dd>
            </div>
          ))}
        </dl>

        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
          >
            <ExternalLink size={14} /> Open in Drive
          </a>
        )}
      </div>
    </div>
  )
}
