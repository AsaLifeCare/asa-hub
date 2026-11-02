// CLIENTS › MEDICATION › REFILLS — the pharmacy's prescriptions for this client (House Supplies' reports, banded…
// One table per source: search, All statuses, RECORD | DATE | DETAILS | STATUS | ACTION; every row opens in the…
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Eye, Loader2 } from 'lucide-react'
import SearchInput from '@/components/shared/SearchInput'
import { MedName } from '@/components/shared/MedThumb'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import SidePanel from '@/components/shared/SidePanel'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { LaneError } from '@/pages/features/shifts/laneFetch'
import { cn } from '@/lib/utils'
import { NOT_OPEN } from '../clientViewer'
import {
  companyToday, dayLabel, filterRefillRows, readRxHistory, refillsModel, statusTint, useClientRefills,
  type RefillRow, type RefillView, type RefillViewId, type RefillsModel, type RxHistory, type Tint,
} from './refills'

const PILL: Record<Tint, string> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  amber: 'bg-tint-amber text-tint-fg-amber',
  danger: 'bg-tint-danger text-tint-fg-danger',
  slate: 'bg-tint-slate text-tint-fg-slate',
  blue: 'bg-tint-blue text-tint-fg-blue',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
}

export function RefillPill({ status }: { status: string }) {
  if (!status) return <span className="text-text-3">—</span>
  return (
    <span data-status={status}
      className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', PILL[statusTint(status)])}>
      {status}
    </span>
  )
}

const SELECT = 'h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'
const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const TD = 'px-4 py-3.5 align-middle text-text-2'

function Note({ children, kind }: { children: ReactNode; kind: 'empty' | 'missing' }) {
  return (
    <div data-empty={kind}
      className="rounded-[16px] border border-dashed border-border bg-surface px-5 py-6 text-center text-[13px] leading-5 text-text-3">
      {children}
    </div>
  )
}

/** The table of one source: a search and an "All statuses" select over its rows, then the five columns. */
export function RefillTable({ view, onOpen }: { view: RefillView; onOpen: (row: RefillRow) => void }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const shown = filterRefillRows(view.rows, query, status)
  return (
    <div className="grid gap-3" data-record-table={view.id}>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search this view…" className="h-10 min-w-[200px] flex-1 rounded-[12px]" />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT} data-filter="status">
          <option value="">All statuses</option>
          {view.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {view.rows.length === 0 ? <Note kind="empty">{view.empty}</Note> : shown.length === 0 ? (
        <Note kind="empty">Nothing here matches the search and the status.</Note>
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border bg-surface shadow-1">
          <table className="w-full min-w-[680px] border-collapse text-[13px]">
            <thead className="border-b border-border bg-surface-2/50">
              <tr>
                <th className={TH}>Record</th><th className={TH}>Date</th><th className={TH}>Details</th>
                <th className={TH}>Status</th><th className={cn(TH, 'text-right')}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} data-row={r.id}>
                  <td className={cn(TD, 'font-semibold text-text-1')}><MedName name={r.record} /></td>
                  <td className={cn(TD, 'whitespace-nowrap')}>{dayLabel(r.date) || '—'}</td>
                  <td className={cn(TD, 'max-w-[420px]')}>{r.details || '—'}</td>
                  <td className={TD}><RefillPill status={r.status} /></td>
                  <td className={cn(TD, 'text-right')}>
                    <button type="button" onClick={() => onOpen(r)} aria-label={`Open ${r.record}`} data-open={r.id}
                      className="inline-grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1">
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Kpis({ items }: { items: { label: string; value: string }[] }) {
  if (!items.length) return null
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-kpis="">
      {items.map((k) => (
        <div key={k.label} className="rounded-[16px] border border-border bg-surface px-4 py-4 shadow-1" data-kpi={k.label}>
          <p className="font-display text-[20px] font-semibold leading-7 text-text-1 tabular-nums">{k.value}</p>
          <p className="mt-1.5 text-[12px] text-text-3">{k.label}</p>
        </div>
      ))}
    </div>
  )
}

type HistoryState = { status: 'loading' | 'ready' | 'failed'; data: RxHistory | null; error: string }

/** A prescription's lines across the pharmacy's reports, read when its panel opens (for the client, when named). */
function RxHistoryBlock({ rxRoot, client }: { rxRoot: string; client: string }) {
  const [got, setGot] = useState<{ key: string; state: HistoryState }>({ key: '', state: { status: 'loading', data: null, error: '' } })
  useEffect(() => {
    let live = true
    const key = `${client}|${rxRoot}`
    readRxHistory(rxRoot, client).then((data) => {
      if (live) setGot({ key, state: { status: 'ready', data, error: '' } })
    }).catch((err: unknown) => {
      if (!live) return
      const error = err instanceof LaneError && err.status === 404 ? 'This prescription is not on file for you.'
        : err instanceof Error ? err.message : String(err)
      setGot({ key, state: { status: 'failed', data: null, error } })
    })
    return () => { live = false }
  }, [rxRoot, client])
  const state = got.key === `${client}|${rxRoot}` ? got.state : { status: 'loading' as const, data: null, error: '' }
  if (state.status === 'loading') {
    return <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-history="loading"><Loader2 size={13} className="animate-spin" /> Reading the prescription's reports…</p>
  }
  if (state.status === 'failed' && state.error === NOT_OPEN) {
    return <p className="text-[12.5px] text-text-3" data-history="shut">{NOT_OPEN}</p>
  }
  if (state.status === 'failed' || !state.data) {
    return <p role="alert" className="text-[12.5px] text-[var(--danger)]" data-history="failed">The history could not be read: {state.error}</p>
  }
  const h = state.data
  return (
    <div className="grid gap-2" data-history="ready">
      <div className="scroll-thin overflow-x-auto rounded-[12px] border border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead className="bg-surface-2/50">
            <tr>{['Report', 'Last dispensed', 'Dispensed', 'Left on Rx'].map((c) => <th key={c} className="px-2.5 py-2 text-left font-semibold text-text-3">{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {h.rows.map((r) => (
              <tr key={`${r.report_start}|${r.report_end}|${r.drug}`}>
                <td className="px-2.5 py-1.5 text-text-2">{dayLabel(r.report_end)}</td>
                <td className="px-2.5 py-1.5 text-text-2">{dayLabel(r.last_dispense) || '—'}</td>
                <td className="px-2.5 py-1.5 text-text-2">{r.dispensed_in_period || '—'}</td>
                <td className="px-2.5 py-1.5 text-text-2">{r.qty_remaining || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] leading-5 text-text-3">
        Dispensed in the reports on file: {h.sum_dispensed || '—'} · the pharmacy's own total to date: {h.cumulative || '—'}
        {h.not_in_reports && h.not_in_reports !== '0' ? ` · ${h.not_in_reports} not in the reports on file` : ''}
      </p>
    </div>
  )
}

/** One row as the side panel reads it: every field the source carries, and for a prescription its reports. */
export function RefillDetail({ row, view, client = '' }: { row: RefillRow; view: RefillView; client?: string }) {
  return (
    <div className="mt-3 grid gap-4" data-refill-detail={row.id}>
      <div className="flex flex-wrap items-center gap-2">
        <RefillPill status={row.status} />
        <span className="text-[12px] text-text-3">{view.source}</span>
      </div>
      <dl className="grid gap-3">
        {row.fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{f.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-text-1">{f.value}</dd>
          </div>
        ))}
      </dl>
      {row.rxRoot && (
        <section className="grid gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Across the reports</h3>
          <RxHistoryBlock rxRoot={row.rxRoot} client={client} />
        </section>
      )}
      {view.note && <p className="text-[11.5px] leading-5 text-text-3">{view.note}</p>}
    </div>
  )
}

/** The whole tab from a model: the source switch, then the chosen source's line, figures, table and note. */
export function RefillsView({ model, client = '', onRetry, busy = false, showPast = false, onShowPast, initialView = 'pharmacy', panel, onPanel }: {
  model: RefillsModel
  /** the client drawn; another one lets go of the source chosen, the search and the row open in the panel */
  client?: string
  onRetry: () => void
  busy?: boolean
  showPast?: boolean
  onShowPast?: (on: boolean) => void
  /** the source drawn first */
  initialView?: RefillViewId
  /** the row open in the panel (its id), when the page keeps it in the address; held here otherwise */
  panel?: string | null
  onPanel?: (id: string | null) => void
}) {
  const [which, setWhich] = useState<RefillViewId>(initialView)
  const [ownOpen, setOwnOpen] = useState<string | null>(null)
  const [drawnFor, setDrawnFor] = useState(client)
  if (drawnFor !== client) {
    setDrawnFor(client)
    setWhich(initialView)
    setOwnOpen(null)
  }
  const openId = panel !== undefined ? panel : ownOpen
  const setOpen = (row: RefillRow | null) => (onPanel ?? setOwnOpen)(row ? row.id : null)
  const open = openId ? model.views.flatMap((v) => v.rows).find((r) => r.id === openId) ?? null : null
  const view = model.views.find((v) => v.id === which) ?? model.views[0]
  // one element per name: the panel moves focus to its heading whenever the title changes
  const openName = open?.record ?? ''
  const heading = useMemo(() => <MedName name={openName} size={56} eager />, [openName])
  const tabs = model.views.map((v) => ({ id: v.id, label: v.state === 'ready' ? `${v.label} (${v.rows.length})` : v.label }))
  return (
    <div className="grid gap-4" data-refills="">
      <SegmentedTabs tabs={tabs} value={view.id} onChange={(id) => setWhich(id as RefillViewId)} className="w-fit max-w-full overflow-x-auto" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-text-3">
        <span data-source={view.id}>{view.source}{view.asOf ? ` · ${view.asOf}` : ''}</span>
        {view.id === 'pharmacy' && onShowPast && (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showPast} onChange={(e) => onShowPast(e.target.checked)} />
            Show prescriptions no longer in the reports
          </label>
        )}
      </div>
      {view.state === 'loading' && (
        <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-read="loading">
          <Loader2 size={13} className="animate-spin" /> Reading {view.source}…
        </p>
      )}
      {view.shut && <Note kind="missing">{NOT_OPEN}</Note>}
      {view.why && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-read="why">
          {view.why}
          <RetryButton onRetry={onRetry} busy={busy} />
        </p>
      )}
      {view.state !== 'loading' && !(view.state === 'failed' && !view.rows.length) && (
        <>
          <Kpis items={view.kpis} />
          <RefillTable key={`${client}|${view.id}`} view={view} onOpen={setOpen} />
        </>
      )}
      {view.note && view.state !== 'loading' && <p className="text-[12px] leading-5 text-text-3" data-note={view.id}>{view.note}</p>}
      <SidePanel open={!!openId} onClose={() => setOpen(null)} label="Refill" title={open ? heading : openId ? 'Refill' : ''}>
        {open ? <RefillDetail row={open} client={client} view={model.views.find((v) => v.rows.some((r) => r.id === open.id)) ?? view} />
          : <p className="mt-3 text-[12.5px] text-text-3" data-gone="">
            {model.views.some((v) => v.state === 'loading') ? 'Reading the refills…' : 'This row is not on the latest read.'}
          </p>}
      </SidePanel>
    </div>
  )
}

/** The Refills tab for one client (a client_key), reading both doors. */
export default function RefillsTab({ client, todayIso, initialView, panel, onPanel }: {
  client: string
  todayIso?: string
  initialView?: RefillViewId
  panel?: string | null
  onPanel?: (id: string | null) => void
}) {
  const { forms, pharmacy, reload } = useClientRefills(client)
  const [showPast, setShowPast] = useState(false)
  const today = todayIso || forms.data?.today || companyToday()
  const model = useMemo(() => refillsModel({ client, todayIso: today, showPast, forms, pharmacy }),
    [client, today, showPast, forms, pharmacy])
  return (
    <RefillsView model={model} client={client} onRetry={reload} busy={forms.refreshing || pharmacy.refreshing}
      showPast={showPast} onShowPast={setShowPast} initialView={initialView} panel={panel} onPanel={onPanel} />
  )
}
