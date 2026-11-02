// The pieces every Clients section draws the same way: a read's line, the status pill, the section's own tabs, the…
import { useState, type ReactNode } from 'react'
import { FileText, Loader2, Pencil } from 'lucide-react'
import SearchInput from '@/components/shared/SearchInput'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { UpdatedStamp } from '@/components/FreshnessStamp'
import { cn } from '@/lib/utils'
import { filterRows, readRefusal, statusTint, type PillTint } from './clientModel'
import { NOT_OPEN } from './clientViewer'
import type { ReadState } from './useClientRead'

export const linkCls = 'text-primary hover:underline'

const PILL: Record<PillTint, string> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  amber: 'bg-tint-amber text-tint-fg-amber',
  danger: 'bg-tint-danger text-tint-fg-danger',
  slate: 'bg-tint-slate text-tint-fg-slate',
  blue: 'bg-tint-blue text-tint-fg-blue',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
}

export function StatusPill({ status }: { status: string }) {
  if (!status) return <span className="text-text-3">—</span>
  return (
    <span data-status={status}
      className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', PILL[statusTint(status)])}>
      {status}
    </span>
  )
}

// What a read has to say before its rows: reading, or why it did not answer.
export function ReadLine({ state, what, onRetry }: { state: ReadState<unknown>; what: string; onRetry: () => void }) {
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-read="loading">
        <Loader2 size={13} className="animate-spin" /> Reading {what}…
      </p>
    )
  }
  if (state.status === 'ready') {
    return <UpdatedStamp at={state.updatedAt} refreshing={state.refreshing} />
  }
  if (state.status !== 'failed') return null
  if (!state.data && readRefusal(state.error) === NOT_OPEN) return <NotOpenNote />
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-read="failed">
      {state.data ? `The last read of ${what} failed: ${readRefusal(state.error)} What is shown is from the read before.`
        : `${what[0].toUpperCase()}${what.slice(1)} could not be read: ${readRefusal(state.error)}`}
      <RetryButton onRetry={onRetry} busy={state.refreshing} />
    </p>
  )
}

// A plain sentence in the table's place: an empty list, or what the platform does not hold yet.
export function NotOpenNote() {
  return (
    <div data-not-open=""
      className="rounded-[16px] border border-dashed border-border bg-surface px-5 py-6 text-center text-[13px] leading-5 text-text-3">
      {NOT_OPEN}
    </div>
  )
}

export function EmptyNote({ children, kind = 'empty' }: { children: ReactNode; kind?: 'empty' | 'missing' }) {
  return (
    <div data-empty={kind}
      className="rounded-[16px] border border-dashed border-border bg-surface px-5 py-6 text-center text-[13px] leading-5 text-text-3">
      {children}
    </div>
  )
}

/** The section's own tabs: the mockup's soft pill on the current one, a rule under the row. */
export function SubTabs({ tabs, value, onChange, label }: {
  tabs: readonly { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="scroll-thin flex gap-1 overflow-x-auto border-b border-border pb-3" data-subtabs="">
      {tabs.map((t) => {
        const on = t.id === value
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)} data-view={t.id}
            className={cn('shrink-0 whitespace-nowrap rounded-[12px] px-3.5 py-2 text-[13px] transition-colors',
              on ? 'bg-primary-soft font-semibold text-primary' : 'text-text-2 hover:bg-surface-2')}>
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export type Kpi = { label: string; value: string }

export function KpiCards({ items }: { items: Kpi[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-kpis="">
      {items.map((k) => (
        <div key={k.label} className="rounded-[16px] border border-border bg-surface px-4 py-4 shadow-1" data-kpi={k.label}>
          <p className="font-display text-[20px] font-semibold leading-7 text-text-1 tabular-nums">{k.value}</p>
          <p className="mt-1.5 text-[12px] text-text-3">{k.label}</p>
        </div>
      ))}
    </div>
  )
}

export function PencilButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-pencil=""
      className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1">
      <Pencil size={14} />
    </button>
  )
}

const SELECT = 'h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'
const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

export type TableColumn<T> = { label: string; cell: (row: T) => ReactNode; className?: string }

// THE ONE TABLE — Care & Support, Medication › Medications and Activity draw it: a search and an "All statuses"…
export function RecordTable<T extends { id: string; status: string }>({ rows, statuses, columns, text, empty, filterLabel = 'All statuses', minWidth = 640,
  statusFilter = true }: {
  rows: T[]
  statuses: string[]
  columns: TableColumn<T>[]
  text: (row: T) => string
  empty: ReactNode
  filterLabel?: string
  minWidth?: number
  /** false for a table that draws no status: the search stays, the status filter goes */
  statusFilter?: boolean
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const shown = filterRows(rows, query, statusFilter ? status : '', text)
  return (
    <div className="grid gap-3" data-record-table="">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search this view…" className="h-10 min-w-[200px] flex-1 rounded-[12px]" />
        {statusFilter && (
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT} data-filter="status">
            <option value="">{filterLabel}</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      {rows.length === 0 ? <EmptyNote>{empty}</EmptyNote> : shown.length === 0 ? (
        <EmptyNote>{statusFilter ? 'Nothing here matches the search and the status.' : 'Nothing here matches the search.'}</EmptyNote>
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border bg-surface shadow-1">
          <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
            <thead className="border-b border-border bg-surface-2/50">
              <tr>{columns.map((c) => <th key={c.label} className={cn(TH, c.className)}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} data-row={r.id}>
                  {columns.map((c) => <td key={c.label} className={cn('px-4 py-3.5 align-middle text-text-2', c.className)}>{c.cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** The button that opens a document in the viewer, busy while its bytes are on their way. */
export function DocButton({ busy, onOpen, children }: { busy: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onOpen} disabled={busy} aria-busy={busy || undefined} data-open-doc=""
      className={`${linkCls} inline-flex items-center gap-1.5 text-[13px] font-semibold disabled:opacity-60`}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {children}
    </button>
  )
}

/** A label over its value, for a panel's read-only record. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-text-1">{children}</dd>
    </div>
  )
}
