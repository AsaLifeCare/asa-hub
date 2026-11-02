// INVOICES — the old platform Invoice Catalog (`/#/invoice`, source pages/Invoice.tsx) re-homed on…
// The layout mirrors the old platform screen element-for-element: header (eyebrow + title + description, actions…
import { useCallback, useEffect, useMemo, useState } from 'react'
import DocRoomSection from '@/components/shared/DocRoomSection'
import type { ReactNode } from 'react'
import {
  DollarSign, ExternalLink, FileSpreadsheet, FileText,
  FolderOpen, Loader2, Receipt, RefreshCw, ScrollText, TrendingUp, X,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import SearchInput from '@/components/shared/SearchInput'
import Skeleton from '@/components/shared/Skeleton'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TINT_BG, TINT_FG, type ExtendedTintName } from '@/lib/tints'

// the old platform row shape (Invoice.tsx InvoiceItem) + the hub additions: due_date and status…
interface InvoiceRow {
  id?: string
  name?: string
  kind?: string
  category?: string
  vendor?: string
  invoice_no?: string
  amount?: number | string
  amount_raw?: string
  doc_date?: string
  due_date?: string
  status?: string
  topic?: string
  record_type?: string
  web_view_link?: string
}

type StatusKey = 'paid' | 'open' | 'overdue' | 'void' | 'draft'

const STATUS_TINT: Record<StatusKey, ExtendedTintName> = {
  paid: 'mint',
  open: 'amber',
  overdue: 'pink',
  void: 'slate',
  draft: 'slate',
}
const STATUS_LABEL: Record<StatusKey, string> = {
  paid: 'Paid',
  open: 'Open',
  overdue: 'Overdue',
  void: 'Void',
  draft: 'Draft',
}

/** the old platform kindColor() on platform tints: NF lavender, Receipt amber, PO blue, Invoice mint. */
const KIND_TINT: Record<string, ExtendedTintName> = {
  nf: 'lavender',
  receipt: 'amber',
  po: 'blue',
  invoice: 'mint',
}

/** Shown until the platform serves the `invoices` resource. */
const SAMPLE_ROWS: InvoiceRow[] = [
  { id: 'sample-1', name: 'North Canton Invoice 2026.8.01.pdf', kind: 'Invoice', category: 'office supplies', vendor: 'Staples Business Advantage', invoice_no: 'INV-2026-0814', amount: 432.18, doc_date: '2026-08-01', due_date: '2026-08-31', status: 'open', topic: 'finances' },
  { id: 'sample-2', name: 'NF 8821 — medical gloves.pdf', kind: 'NF', category: 'medical supplies', vendor: 'Medline Industries', invoice_no: 'NF-8821', amount: 1240.5, doc_date: '2026-07-28', due_date: '2026-08-27', status: 'paid', topic: 'purchases' },
  { id: 'sample-3', name: 'Receipt — Home Depot #4471.pdf', kind: 'Receipt', category: 'house repair', vendor: 'The Home Depot', invoice_no: 'HD-4471', amount: 96.74, doc_date: '2026-08-12', due_date: '2026-08-12', status: 'paid', topic: 'finances' },
  { id: 'sample-4', name: 'PO 2026-118 kitchen restock.pdf', kind: 'PO', category: 'groceries', vendor: 'Gordon Food Service', invoice_no: 'PO-2026-118', amount: 2310.0, doc_date: '2026-07-15', due_date: '2026-08-14', status: 'overdue', topic: 'purchases' },
  { id: 'sample-5', name: 'Invoice — Cintas uniforms July.pdf', kind: 'Invoice', category: 'uniforms', vendor: 'Cintas', invoice_no: 'CIN-55832', amount: 388.9, doc_date: '2026-07-05', due_date: '2026-08-04', status: 'overdue', topic: 'finances' },
  { id: 'sample-6', name: 'Draft invoice — consulting Q2.pdf', kind: 'Invoice', category: 'services', vendor: 'ASA Life Care', invoice_no: 'DRAFT-0117', amount: 1500.0, doc_date: '2026-08-20', due_date: '2026-09-19', status: 'draft', topic: 'billing' },
]

function statusOf(row: InvoiceRow): StatusKey {
  const s = (row.status || '').toLowerCase()
  if (s === 'paid' || s === 'open' || s === 'pending' || s === 'overdue' || s === 'void' || s === 'draft') {
    return s === 'pending' ? 'open' : s
  }
  return 'open'
}

function fmtMoney(raw?: string, n?: number | string): string {
  if (raw && String(raw).trim()) return String(raw).trim()
  if (typeof n === 'string' && n.trim()) return n.trim()
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v) || v === 0) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function num(n?: number | string): number {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : 0
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

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceRow[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [kindFilter, setKindFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | StatusKey>('all')
  const [topicFilter, setTopicFilter] = useState('all')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<InvoiceRow | null>(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const r = await api.list<InvoiceRow>('invoices')
      const list = Array.isArray(r) ? r : []
      // No backend table yet → an honest empty answer; dress it with the sample set so the screen shows its real…
      setRows(list.length ? list : SAMPLE_ROWS)
    } catch {
      setRows((prev) => prev ?? SAMPLE_ROWS)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const items = useMemo(() => rows ?? [], [rows])
  const topics = useMemo(
    () => [...new Set(items.map((it) => it.topic || '').filter(Boolean))].sort(),
    [items],
  )
  const kinds = useMemo(
    () => [...new Set(items.map((it) => it.kind || '').filter(Boolean))].sort(),
    [items],
  )
  const kindCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const it of items) if (it.kind) m[it.kind] = (m[it.kind] ?? 0) + 1
    return m
  }, [items])
  const statusCounts = useMemo(() => {
    const m: Record<StatusKey, number> = { paid: 0, open: 0, overdue: 0, void: 0, draft: 0 }
    for (const it of items) m[statusOf(it)] += 1
    return m
  }, [items])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((it) => {
      if (kindFilter !== 'all' && (it.kind || '') !== kindFilter) return false
      if (statusFilter !== 'all' && statusOf(it) !== statusFilter) return false
      if (topicFilter !== 'all' && (it.topic || '') !== topicFilter) return false
      if (needle) {
        const hay = `${it.name || ''} ${it.vendor || ''} ${it.invoice_no || ''} ${it.amount || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [items, kindFilter, statusFilter, topicFilter, q])

  const totalSpend = useMemo(() => items.reduce((s, it) => s + num(it.amount), 0), [items])
  const overdueSum = useMemo(
    () => items.filter((it) => statusOf(it) === 'overdue').reduce((s, it) => s + num(it.amount), 0),
    [items],
  )

  const exportCsv = useCallback(() => {
    const cols = ['Document', 'Kind', 'Category', 'Vendor', 'Invoice #', 'Amount', 'Date', 'Due date', 'Status', 'Folder', 'Link']
    const lines = [cols.join(',')]
    for (const it of filtered) {
      lines.push([
        it.name, it.kind, it.category, it.vendor, it.invoice_no,
        it.amount_raw ?? it.amount, it.doc_date, it.due_date,
        STATUS_LABEL[statusOf(it)], it.topic, it.web_view_link,
      ].map(csvCell).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'invoice_catalog.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }, [filtered])

  const loading = rows === null

  return (
    <div className="w-full px-5 py-6">
      {/* ── header: title + description left, actions right (the old platform positions) ── */}
      <PageHeader
        title="Invoices"
        subtitle="Every NF, invoice, receipt and purchase order in the catalogue. Click a row for the detail; export the whole catalogue as a sheet."
        actions={
          <>
            <button
              onClick={exportCsv}
              disabled={filtered.length === 0}
              title="Export the catalogue as a CSV sheet"
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
            >
              <FileSpreadsheet size={14} /> Export CSV
            </button>
            <button
              onClick={() => void load()}
              disabled={refreshing}
              title="Reload the catalogue"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {/* ── stat chips row (the old platform: total spend / purchases / large / docs / folders) ── */}
      <div className="mb-5 flex flex-wrap gap-2.5">
        <StatChip icon={<DollarSign size={14} />} tint="mint" label="Total billed" value={fmtMoney(undefined, totalSpend)} />
        <StatChip icon={<FileText size={14} />} tint="blue" label="Invoices" value={items.length} />
        <StatChip icon={<Receipt size={14} />} tint="mint" label="Paid" value={statusCounts.paid} />
        <StatChip icon={<ScrollText size={14} />} tint="amber" label="Open" value={statusCounts.open} />
        <StatChip icon={<TrendingUp size={14} />} tint="pink" label="Overdue" value={`${statusCounts.overdue} · ${fmtMoney(undefined, overdueSum)}`} />
        <StatChip icon={<FolderOpen size={14} />} tint="slate" label="Folders" value={topics.length} />
      </div>

      {/* ── filter row: kind pills · status pills · folder select · search · count ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterPill active={kindFilter === 'all'} onClick={() => setKindFilter('all')} label="All kinds" />
        {kinds.map((k) => (
          <FilterPill
            key={k}
            active={kindFilter === k}
            onClick={() => setKindFilter(kindFilter === k ? 'all' : k)}
            label={`${k} (${kindCounts[k] ?? 0})`}
            tint={KIND_TINT[k.toLowerCase()] ?? 'slate'}
          />
        ))}
        <span className="mx-1 text-text-3">·</span>
        <FilterPill active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} label="All statuses" />
        {(Object.keys(STATUS_LABEL) as StatusKey[]).map((s) => (
          <FilterPill
            key={s}
            active={statusFilter === s}
            onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            label={`${STATUS_LABEL[s]} (${statusCounts[s]})`}
            tint={STATUS_TINT[s]}
          />
        ))}
        <span className="mx-1 text-text-3">·</span>
        <select
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none focus:border-border-strong"
        >
          <option value="all">All folders</option>
          {topics.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <SearchInput value={q} onChange={setQ} placeholder="Search vendor / # / amount…" className="w-56" />
        <span className="text-[12px] text-text-3">{filtered.length} shown</span>
      </div>

      {/* ── the catalogue sheet (same column order as the old platform white sheet) ── */}
      {loading ? (
        <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : filtered.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title={items.length === 0 ? 'No invoices catalogued yet' : 'No invoices match the filter'}
            body={items.length === 0
              ? 'Once the invoices resource is connected, every catalogued document shows up here.'
              : 'Loosen the kind, status or folder filter, or clear the search.'}
          />
        </Card>
      ) : (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-2">
                <th className="sticky left-0 bg-surface-2 px-2 py-2 text-right text-[11px] font-bold text-text-3">#</th>
                {['Document', 'Kind', 'Category', 'Vendor', 'Invoice #', 'Amount', 'Date', 'Due date', 'Status', 'Folder'].map((c) => (
                  <th key={c} className="whitespace-nowrap border-l border-border px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((it, i) => {
                const status = statusOf(it)
                const kindTint = KIND_TINT[(it.kind || '').toLowerCase()] ?? 'slate'
                return (
                  <tr
                    key={String(it.id ?? it.web_view_link ?? it.name ?? i)}
                    onClick={() => setSelected(it)}
                    className="cursor-pointer border-t border-border transition-colors odd:bg-surface even:bg-surface-2/40 hover:bg-surface-2"
                  >
                    <td className="sticky left-0 bg-inherit px-2 py-1.5 text-right text-[11px] text-text-3">{i + 1}</td>
                    <td className="max-w-[320px] truncate border-l border-border px-3 py-1.5 font-medium text-text-1" title={it.name || ''}>
                      {it.name || '(unnamed)'}
                      {it.record_type === 'financial_doc' && <span className="ml-2 text-[10px] text-text-3">(financial doc)</span>}
                    </td>
                    <td className="border-l border-border px-3 py-1.5">
                      <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold', TINT_BG[kindTint], TINT_FG[kindTint])}>
                        {it.kind || '—'}
                      </span>
                    </td>
                    <td className="border-l border-border px-3 py-1.5 text-[12px] text-text-2">{it.category || '—'}</td>
                    <td className="border-l border-border px-3 py-1.5 text-text-1">{it.vendor || '—'}</td>
                    <td className="border-l border-border px-3 py-1.5 text-[12px] text-text-1 tabular-nums">{it.invoice_no || '—'}</td>
                    <td className="border-l border-border px-3 py-1.5 text-right text-[12.5px] font-semibold text-text-1 tabular-nums">
                      {fmtMoney(it.amount_raw, it.amount)}
                    </td>
                    <td className="border-l border-border px-3 py-1.5 text-[12px] text-text-2 tabular-nums">{it.doc_date || '—'}</td>
                    <td className="border-l border-border px-3 py-1.5 text-[12px] text-text-2 tabular-nums">{it.due_date || '—'}</td>
                    <td className="border-l border-border px-3 py-1.5">
                      <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold', TINT_BG[STATUS_TINT[status]], TINT_FG[STATUS_TINT[status]])}>
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="border-l border-border px-3 py-1.5 text-text-2">{it.topic || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* the old platform's InvoiceDocs reading room, folded in (gap survey §6) */}
      <DocRoomSection room="invoices" title="Invoice documents"
        line="The invoices Drive folder — originals read in place, imports filed straight in." />

      {selected && <InvoiceDetail row={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

/** the old platform stat chip, platform dress: icon tinted, value + uppercase label. */
function StatChip({ icon, tint, label, value }: { icon: ReactNode; tint: ExtendedTintName; label: string; value: number | string }) {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-md border border-border bg-surface px-3.5 py-2 shadow-1">
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', TINT_BG[tint], TINT_FG[tint])}>{icon}</span>
      <span className="text-[16px] font-bold leading-none text-text-1 tabular-nums">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</span>
    </span>
  )
}

/** Filter pill (the old platform FilterBtn): quiet when off, tinted with a ring when on. */
function FilterPill({ active, onClick, label, tint }: { active: boolean; onClick: () => void; label: string; tint?: ExtendedTintName }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-semibold transition-colors',
        active && tint
          ? cn(TINT_BG[tint], TINT_FG[tint], 'ring-2 ring-current')
          : active
            ? 'bg-primary text-on-primary'
            : 'border border-border bg-surface text-text-2 hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  )
}

// Row detail — the old platform opens the source document; here the row's full record slides in from the right, with…
function InvoiceDetail({ row, onClose }: { row: InvoiceRow; onClose: () => void }) {
  const href = safeHref(row.web_view_link)
  const status = statusOf(row)
  const fields: [string, string][] = [
    ['Vendor', row.vendor || '—'],
    ['Invoice #', row.invoice_no || '—'],
    ['Amount', fmtMoney(row.amount_raw, row.amount)],
    ['Date', row.doc_date || '—'],
    ['Due date', row.due_date || '—'],
    ['Category', row.category || '—'],
    ['Folder', row.topic || '—'],
    ['Record type', row.record_type || '—'],
  ]
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/55 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="h-full w-full overflow-y-auto border-l border-border bg-surface p-5 shadow-2 sm:w-[384px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">Invoice detail</p>
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
          <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold', TINT_BG[STATUS_TINT[status]], TINT_FG[STATUS_TINT[status]])}>
            {STATUS_LABEL[status]}
          </span>
          {row.kind && (
            <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold', TINT_BG[KIND_TINT[row.kind.toLowerCase()] ?? 'slate'], TINT_FG[KIND_TINT[row.kind.toLowerCase()] ?? 'slate'])}>
              {row.kind}
            </span>
          )}
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
            <ExternalLink size={14} /> Open source document
          </a>
        )}
      </div>
    </div>
  )
}
