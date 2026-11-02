// UI Reports — Unusual Incidents, wired to the REAL `uiIncidents` sheet resource (631 rows, raw string cells).
// The list is newest-first by incident_date, category chips split the comma-separated incident_category, and an…
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { AlertTriangle, ChevronDown, Pencil, Plus, RefreshCw, RotateCw, Shuffle, Table2, Trash2 } from 'lucide-react'
import { asList } from '@/lib/asList'
import { splitCategories } from '@/lib/incidentCategories'
import { ohioWall } from '@/lib/ohio'
import { recordMatchesFocus, writePersonDrag } from '@/lib/focus'
import { useDragFocusEnabled } from '@/lib/dragFocus'
import { useContextStore } from '@/stores/useContextStore'
import { useAuthStore } from '@/auth/useAuthStore'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import SheetEditor from '@/components/shared/SheetEditor'
import Skeleton from '@/components/shared/Skeleton'
import OpsPageShell, {
  OrderingSelect,
  TintChip,
  outlineBtnCls,
  primaryBtnCls,
} from './OpsPageShell'
import UiReportsHero, { type UiReportFigures } from './UiReportsHero'
import { useOpsCrud, OPS_ORDER_OPTIONS, type OpsOrder } from '@/features/ops-flows/useOpsCrud'
import OpsRecordModal, { type OpsField } from '@/features/ops-flows/OpsRecordModal'
import ConfirmDialog from '@/features/ops-flows/ConfirmDialog'
import FocusRelations from '@/features/ops-flows/FocusRelations'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { mayEditEstate, mayFile } from '@/lib/estateFiling'
import { cn } from '@/lib/utils'

// One sheet row.
type UiIncidentRow = {
  id: string
  timestamp: string
  your_name: string
  client_name: string
  incident_category: string
  incident_location: string
  incident_date: string
  incident_time: string
  incident_reported_date: string
  incident_reported_time: string
  employees_involved: string
  summary_of_incident: string
  immediate_action_taken: string
  cause_and_contributing_factors: string
  prevention_plan: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

function normalize(r: unknown, i: number): UiIncidentRow {
  const o = (r ?? {}) as Record<string, unknown>
  return {
    id: str(o.id) || `ui-${i}`,
    timestamp: str(o.timestamp),
    your_name: str(o.your_name),
    client_name: str(o.client_name),
    incident_category: str(o.incident_category),
    incident_location: str(o.incident_location),
    incident_date: str(o.incident_date),
    incident_time: str(o.incident_time),
    incident_reported_date: str(o.incident_reported_date),
    incident_reported_time: str(o.incident_reported_time),
    employees_involved: str(o.employees_involved),
    summary_of_incident: str(o.summary_of_incident),
    immediate_action_taken: str(o.immediate_action_taken),
    cause_and_contributing_factors: str(o.cause_and_contributing_factors),
    prevention_plan: str(o.prevention_plan),
  }
}

// Tolerant sheet-date parser: ISO strings and M/D/YYYY (2/4-digit year, optional time).
function toDate(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i)
  if (m) {
    let year = Number(m[3])
    if (year < 100) year += 2000
    let hours = m[4] ? Number(m[4]) : 0
    const ampm = m[7]?.toUpperCase()
    if (ampm === 'PM' && hours < 12) hours += 12
    if (ampm === 'AM' && hours === 12) hours = 0
    const d = new Date(year, Number(m[1]) - 1, Number(m[2]), hours, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return ohioWall(s)
}

/** Render a sheet date cell — '—' when missing/unparseable. */
const fmtDate = (v: unknown): string => {
  const d = toDate(v)
  return d ? format(d, 'MMM d, yyyy') : '—'
}

// A time-only cell, once the backend has formatted it.
const fmtSheetTime = (v: unknown): string => {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (/^\d{1,2}:\d{2}/.test(s)) return s
  if (s.startsWith('1899-')) return ''
  const d = toDate(s)
  return d ? format(d, 'HH:mm') : s
}

/** `<input type="date">` speaks yyyy-MM-dd; the sheet answers with ISO stamps. */
const dateInput = (v: string): string => {
  const d = toDate(v)
  return d ? format(d, 'yyyy-MM-dd') : v
}

const MIN_TIME = -8640000000000000
const incidentTime = (r: UiIncidentRow) => toDate(r.incident_date)?.getTime() ?? MIN_TIME
const submittedTime = (r: UiIncidentRow) => toDate(r.timestamp)?.getTime() ?? MIN_TIME
/** Newest-first by incident_date; the form timestamp breaks same-day ties. */
const byNewest = (a: UiIncidentRow, b: UiIncidentRow) =>
  incidentTime(b) - incidentTime(a) || submittedTime(b) - submittedTime(a)

/** The shared four, plus the category ordering this screen has always had. */
const UI_ORDER_OPTIONS = [...OPS_ORDER_OPTIONS, { id: 'category', label: 'Category' }]

// Every raw column of the UIs and MUIs tab, in sheet order, for the spreadsheet view.
const SHEET_COLUMNS = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'your_name', label: 'Your Name' },
  { key: 'client_name', label: 'Client Name' },
  { key: 'incident_category', label: 'Incident Category' },
  { key: 'incident_location', label: 'Incident Location' },
  { key: 'incident_date', label: 'Incident Date' },
  { key: 'incident_time', label: 'Incident Time' },
  { key: 'incident_reported_date', label: 'Incident Reported Date' },
  { key: 'incident_reported_time', label: 'Incident Reported Time' },
  { key: 'employees_involved', label: 'Employees Involved' },
  { key: 'summary_of_incident', label: 'Summary of Incident' },
  { key: 'immediate_action_taken', label: 'Immediate Action Taken' },
  { key: 'cause_and_contributing_factors', label: 'Cause and Contributing Factors' },
  { key: 'prevention_plan', label: 'Prevention Plan' },
]

/* ---------- detail section ---------- */

// `value` takes nodes: "Employees involved" is a list of PEOPLE, and each name in it has to arrive already wrapped…
function DetailSection({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</div>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-text-2">{value || '—'}</p>
    </div>
  )
}

/* ---------- page ---------- */

export default function UiIncidentsPage() {
  const crud = useOpsCrud({
    resource: 'uiIncidents',
    titleKey: 'client_name',
    dateKey: 'incident_date',
    witnessKey: 'client_name',
  })
  const rows = useMemo(() => crud.rows.map(normalize), [crud.rows])
  const error = crud.error
  const order = crud.order as OpsOrder | 'category'
  const [reporting, setReporting] = useState(false)
  const [editing, setEditing] = useState<UiIncidentRow | null>(null)
  const [confirming, setConfirming] = useState<UiIncidentRow | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // The spreadsheet view — the same rows drawn in the sheet's own grammar.
  const [asSheet, setAsSheet] = useState(false)
  const me = useAuthStore((s) => s.user)
  const canWrite = mayEditEstate(me?.role)
  const canFile = mayFile(me?.role)
  const dragOn = useDragFocusEnabled('ui-incidents')
  const focus = useContextStore((s) => s.focus)

  const clientFocus = focus?.type === 'client' ? focus : null
  const scoped = useMemo(() => {
    if (!clientFocus) return rows
    const matched = rows.filter((r) => recordMatchesFocus(r.client_name, clientFocus))
    return matched.length ? matched : rows
  }, [rows, clientFocus])
  const focusFiltered = !!clientFocus && rows.some((r) => recordMatchesFocus(r.client_name, clientFocus))

  const sorted = useMemo(() => {
    const out = [...scoped]
    if (order === 'name') out.sort((a, b) => a.client_name.localeCompare(b.client_name) || byNewest(a, b))
    else if (order === 'category')
      out.sort(
        (a, b) =>
          (splitCategories(a.incident_category)[0] ?? '').localeCompare(splitCategories(b.incident_category)[0] ?? '') ||
          byNewest(a, b),
      )
    else if (order === 'oldest') out.sort((a, b) => byNewest(b, a))
    else if (order === 'random') {
      // one shuffle per press, stable across re-renders
      let s = crud.shuffleSeed || 1
      for (let i = out.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) % 4294967296
        const j = s % (i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
      }
    } else out.sort(byNewest)
    return out
  }, [scoped, order, crud.shuffleSeed])

  // The picker carries the FORM's own vocabulary, counted off the rows on screen and most-used first.
  const categoryVocabulary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) for (const c of splitCategories(r.incident_category)) counts.set(c, (counts.get(c) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).join('\n')
  }, [rows])
  // Through a signature, not the array: an optimistic write re-derives the vocabulary, and a fresh array on every…
  const categoryOptions = useMemo(() => (categoryVocabulary ? categoryVocabulary.split('\n') : []), [categoryVocabulary])

  /** Stable identity: the modal re-seeds its values whenever these change. */
  const fields = useMemo<OpsField[]>(
    () => [
      { key: 'client_name', label: 'Client', required: true, placeholder: 'Who the incident is about' },
      // a dropdown, not chips: the form's real vocabulary runs to 76 characters ("Minor injury or illness (rash…
      { key: 'incident_category', label: 'Category — the form’s own list', kind: 'select', options: categoryOptions, required: true },
      { key: 'incident_location', label: 'Location', placeholder: 'Client Home, Community, Day program…' },
      { key: 'incident_date', label: 'Date of incident', kind: 'date', required: true },
      { key: 'incident_time', label: 'Time of incident', kind: 'time' },
      { key: 'incident_reported_date', label: 'Reported on', kind: 'date' },
      { key: 'incident_reported_time', label: 'Reported at', kind: 'time' },
      { key: 'employees_involved', label: 'Employees involved', placeholder: 'Names, comma-separated' },
      {
        key: 'summary_of_incident', kind: 'textarea', required: true,
        label: 'Summary — facts only: who, what, when, where',
        placeholder: 'State facts only, without speculation or blame…',
      },
      { key: 'immediate_action_taken', label: 'Immediate action taken', kind: 'textarea' },
      { key: 'cause_and_contributing_factors', label: 'Cause & contributing factors', kind: 'textarea' },
      { key: 'prevention_plan', label: 'Prevention plan', kind: 'textarea' },
    ],
    [categoryOptions],
  )

  // The date pickers only accept their own format, so an untranslated row would open the editor with empty dates…
  const editorRow = useMemo(
    () =>
      editing
        ? {
            ...editing,
            incident_date: dateInput(editing.incident_date),
            incident_time: fmtSheetTime(editing.incident_time),
            incident_reported_time: fmtSheetTime(editing.incident_reported_time),
            incident_reported_date: dateInput(editing.incident_reported_date),
          }
        : null,
    [editing],
  )

  // THE HEADER'S FIGURES, off the same rows the list below draws.
  const heroFigures = useMemo<UiReportFigures | null>(() => {
    if (crud.loading || error) return null
    const now = (ohioWall(new Date()) as Date).getTime()
    const dated = scoped.filter((r) => toDate(r.incident_date) !== null)
    const last30 = dated.filter((r) => {
      const t = (toDate(r.incident_date) as Date).getTime()
      return now - t <= 30 * 86400000 && t <= now + 86400000
    }).length
    const counts = new Map<string, number>()
    for (const r of scoped) for (const c of splitCategories(r.incident_category)) counts.set(c, (counts.get(c) ?? 0) + 1)
    let topCategory = ''
    let topCategoryRows = 0
    for (const [c, k] of counts) if (k > topCategoryRows) { topCategory = c; topCategoryRows = k }
    return {
      total: scoped.length,
      dated: dated.length,
      last30,
      clients: new Set(scoped.map((r) => r.client_name.toLowerCase()).filter(Boolean)).size,
      topCategory: topCategory.length > 26 ? `${topCategory.slice(0, 25)}…` : topCategory,
      topCategoryRows,
      uncategorised: scoped.filter((r) => splitCategories(r.incident_category).length === 0).length,
      medication: scoped.filter((r) => r.incident_category.toLowerCase().includes('medication')).length,
    }
  }, [scoped, crud.loading, error])

  const hero = (
    <UiReportsHero
      read={error ? { state: 'failed' } : crud.loading ? { state: 'loading' } : { state: 'ready' }}
      figures={heroFigures}
      scope={focusFiltered && clientFocus ? clientFocus.name : ''}
      onRetry={crud.reload}
    />
  )

  if (crud.loading) {
    return (
      <div className="w-full space-y-2">
        {hero}
        <Skeleton className="h-9 w-64" />
        <Card padded={false} className="p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-12 w-full" />
          ))}
        </Card>
      </div>
    )
  }

  return (
    <OpsPageShell
      title="UI Reports"
      subtitle="Unusual incidents — lower-severity events tracked for review (not MUIs)"
      hero={hero}
      focusType="client"
      filtered={focusFiltered}
      actions={
        <button
          onClick={() => setReporting(true)}
          disabled={!canFile}
          title={canFile ? "File a UI report into the estate's sheet" : 'Filing is for clients, staff, managers and admins'}
          className={primaryBtnCls}
        >
          <Plus size={15} /> New UI report
        </button>
      }
      toolbar={
        <>
          {/* The view toggle sits IMMEDIATELY beside Refresh, ahead of the
              ordering — the house pattern from the system-logs screen. The
              ordering select stays visible in BOTH views: `sorted` feeds the
              replica too, so the select keeps meaning what it says. */}
          <button
            onClick={() => setAsSheet((v) => !v)}
            className={outlineBtnCls}
            title="The exact spreadsheet layout, as the intranet drew it"
          >
            <Table2 size={14} /> {asSheet ? 'Normal view' : 'Sheet view'}
          </button>
          {/* reload() nulls the rows first so the skeleton takes over —
              accepted: a refresh that looks like a fresh load IS one */}
          <button onClick={() => crud.reload()} className={outlineBtnCls} title="Reload from the estate's sheet">
            <RefreshCw size={14} className={crud.loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <OrderingSelect value={order} onChange={(v) => crud.setOrder(v as OpsOrder)} options={UI_ORDER_OPTIONS} />
          {order === 'random' && (
            <button onClick={crud.reshuffle} className={outlineBtnCls} title="Shuffle again">
              <Shuffle size={14} /> Shuffle
            </button>
          )}
        </>
      }
    >
      <FocusRelations type="client" />
      {/* THE SPREADSHEET VIEW — fed the same `sorted` rows the table reads,
          so ordering and a client focus hold in either view; the replica
          shows the tab's raw cells exactly as the sheet holds them. */}
      {asSheet && <SheetEditor toolbar title="UIs and MUIs — spreadsheet view" columns={SHEET_COLUMNS} rows={sorted} />}
      {!asSheet && (
        <Card padded={false} className="overflow-hidden">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-tint-danger">
                <AlertTriangle size={18} className="text-tint-fg-danger" />
              </span>
              <div>
                <h3 className="font-display text-[15px] font-semibold text-text-1">Couldn&rsquo;t load UI reports</h3>
                <p className="mt-1 max-w-[360px] text-[13px] leading-5 text-text-2">{error}</p>
              </div>
              <button onClick={crud.reload} className={outlineBtnCls}>
                <RotateCw size={14} /> Retry
              </button>
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState
              title="No UI reports in the sheet"
              body="The incidents spreadsheet returned no rows. A report filed here — or through the old world's form — lands in the same tab."
            />
          ) : (
            // Both axes scroll INSIDE the card, on SheetEditor's own numbers: 631 rows once made the PAGE the…
            <div className="scroll-thin max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  {/* sticky rides each th, not the row: a pinned cell needs its
                      own opaque background anyway, and per-cell sticky is what
                      lets the Actions corner pin on BOTH axes at once */}
                  <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                    <th className="sticky top-0 z-20 bg-surface px-4 py-3">Date</th>
                    <th className="sticky top-0 z-20 bg-surface px-4 py-3">Category</th>
                    <th className="sticky top-0 z-20 bg-surface px-4 py-3">Client</th>
                    <th className="sticky top-0 z-20 bg-surface px-4 py-3">Location</th>
                    <th className="sticky top-0 z-20 bg-surface px-4 py-3">Reported by</th>
                    {/* pinned: on a narrow window this column is the first to scroll
                        out of sight, and it is the one carrying edit and remove.
                        z-30 keeps the top-right corner above the sticky header
                        row AND the pinned body cells below it */}
                    <th className="sticky right-0 top-0 z-30 bg-surface px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <motion.tbody initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                  {sorted.map((r, i) => {
                    const key = r.id
                    const cats = splitCategories(r.incident_category)
                    const open = expandedKey === key
                    // the form's own time cell, shown verbatim: the sheet serializes a time-only cell against its…
                    const time = fmtSheetTime(r.incident_time)
                    const canDrag = dragOn && !!r.client_name
                    return (
                      <Fragment key={key}>
                        <motion.tr
                          initial={i < 12 ? { opacity: 0, y: 8 } : false}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.2, ease: EASE_OUT_EXPO }}
                          onClick={() => setExpandedKey(open ? null : key)}
                          className={cn(
                            // `group`: the pinned Actions cell carries an opaque bg-surface (the row's hover tint…
                            'group cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-2',
                            open && 'bg-surface-2',
                          )}
                          style={{ height: 52 }}
                        >
                          <td className="whitespace-nowrap px-4 text-[13px] text-text-2">
                            {fmtDate(r.incident_date)}
                            {time && <span className="block text-[11px] text-text-3">{time}</span>}
                          </td>
                          <td className="max-w-[260px] px-4">
                            {cats.length === 0 ? (
                              <span className="text-[13px] text-text-3">—</span>
                            ) : (
                              <span className="flex items-center gap-1.5">
                                <TintChip label={cats[0]} tint="warning" className="max-w-[190px] truncate" />
                                {cats.length > 1 && <TintChip label={`+${cats.length - 1}`} tint="slate" />}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 text-[13px] font-medium text-text-1">
                            <span
                              draggable={canDrag}
                              onDragStart={(e) =>
                                canDrag &&
                                writePersonDrag(e.dataTransfer, {
                                  type: 'client',
                                  id: r.client_name,
                                  name: r.client_name,
                                  subtitle: 'Client',
                                })
                              }
                              title={canDrag ? 'Drag onto the top-left corner to focus the platform on this client' : undefined}
                              className={cn('inline-block', canDrag && 'cursor-grab active:cursor-grabbing')}
                            >
                              {r.client_name || '—'}
                            </span>
                          </td>
                          <td className="max-w-[200px] px-4">
                            <span className="clamp-1 block text-[13px] text-text-2">{r.incident_location || '—'}</span>
                          </td>
                          <td className="whitespace-nowrap px-4 text-[13px] text-text-2">
                            <DragPerson name={r.your_name} id={r.your_name} type="staff" subtitle="Reported the incident">
                              {r.your_name || '—'}
                            </DragPerson>
                          </td>
                          <td className="sticky right-0 z-10 bg-surface px-4 group-hover:bg-surface-2">
                            <span className="flex items-center justify-end gap-1">
                              {canWrite && (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setEditing(r)
                                    }}
                                    aria-label={`Edit the UI report for ${r.client_name || 'this client'}`}
                                    className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setConfirming(r)
                                    }}
                                    aria-label={`Remove the UI report for ${r.client_name || 'this client'}`}
                                    className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-tint-danger hover:text-tint-fg-danger"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                              <ChevronDown
                                size={16}
                                className={cn('text-text-3 transition-transform duration-200', open && 'rotate-180')}
                              />
                            </span>
                          </td>
                        </motion.tr>
                        {open && (
                          <tr className="border-b border-border last:border-0">
                            <td colSpan={6} className="bg-surface-2/50 p-0">
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
                                className="grid gap-4 px-5 py-4"
                              >
                                {cats.length > 1 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {cats.map((c) => (
                                      <TintChip key={c} label={c} tint="warning" />
                                    ))}
                                  </div>
                                )}
                                <div className="grid gap-x-8 gap-y-1 text-[12px] text-text-3 sm:grid-cols-2">
                                  <span>
                                    Occurred:{' '}
                                    <span className="text-text-2">
                                      {fmtDate(r.incident_date)}
                                      {time && ` · ${time}`}
                                    </span>
                                  </span>
                                  <span>
                                    Reported:{' '}
                                    <span className="text-text-2">
                                      {fmtDate(r.incident_reported_date)}
                                      {fmtSheetTime(r.incident_reported_time) && ` · ${fmtSheetTime(r.incident_reported_time)}`}
                                    </span>
                                  </span>
                                </div>
                                <DetailSection label="Summary of incident" value={r.summary_of_incident} />
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <DetailSection label="Immediate action taken" value={r.immediate_action_taken} />
                                  <DetailSection label="Cause & contributing factors" value={r.cause_and_contributing_factors} />
                                  <DetailSection label="Prevention plan" value={r.prevention_plan} />
                                  {/* ONE wrap per employee: the cell is a
                                      comma-separated list, and wrapping it whole
                                      would push "A, B, C" onto the tracker as a
                                      single person who does not exist */}
                                  <DetailSection
                                    label="Employees involved"
                                    value={
                                      asList(r.employees_involved).length
                                        ? asList(r.employees_involved).map((n, i) => (
                                            <Fragment key={`${n}-${i}`}>
                                              {i > 0 && ', '}
                                              <DragPerson name={n} id={n} type="staff" subtitle="Involved in the incident">
                                                {n}
                                              </DragPerson>
                                            </Fragment>
                                          ))
                                        : r.employees_involved
                                    }
                                  />
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </motion.tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <OpsRecordModal
        open={reporting || !!editing}
        title={editing ? 'Edit UI report' : 'New UI report'}
        fields={fields}
        row={editorRow as never}
        busy={crud.busy}
        onClose={() => {
          setReporting(false)
          setEditing(null)
        }}
        onSubmit={async (v) => {
          const ok = editing
            ? await crud.update(editing as never, v)
            : await crud.create({
                ...v,
                // the sheet's own columns: who filed it, and when
                your_name: me?.name ?? me?.email ?? '',
                timestamp: new Date().toISOString(),
              })
          if (ok) {
            setReporting(false)
            setEditing(null)
          }
        }}
      />

      <ConfirmDialog
        open={!!confirming}
        title="Remove this UI report?"
        body={
          confirming
            ? `${confirming.client_name || 'This row'} · ${splitCategories(confirming.incident_category)[0] || 'Unusual incident'} · ${fmtDate(confirming.incident_date)}. The UIs and MUIs tab has nowhere to mark a row cancelled, so it leaves the estate's sheet for good.`
            : ''
        }
        confirmLabel="Remove"
        busy={crud.busy}
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming) await crud.remove(confirming as never)
          setConfirming(null)
        }}
      />
    </OpsPageShell>
  )
}
