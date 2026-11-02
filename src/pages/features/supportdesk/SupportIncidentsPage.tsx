// SUPPORT REQUESTS › INCIDENTS — the Incident Log's reports (uiIncidents, the UIs and MUIs book) in Support Requests'
// own table: the same toolbar, columns and rows. A row opens Support Requests' own side panel (IncidentPanel: the
// Incident Log's fields in RequestPanel's pattern, no dark header). App Control's support-desk.incidents control opens
// the page and support-desk.incidentsEdit the pencil in its panel (both the master's until released).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SearchInput from '@/components/shared/SearchInput'
import Avatar from '@/components/shared/Avatar'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/apiCache'
import { useFeatureAllowed } from '@/lib/featureAccess'
import { placeScope } from '@/lib/placeKey'
import { noteWrite } from '@/lib/snapshotClient'
import { editAnswerOf, type EditChange } from '@/lib/recordEdit'
import { cn } from '@/lib/utils'
import { LOCATIONS_WHERE } from '@/pages/features/locations/locationApply'
import type { ApplyTarget, PanelVia } from '@/pages/features/locations/ApplyStrip'
import { editSupportIncident } from '@/pages/features/locations/useLocation'
import IncidentPanel, { MUI_RE, categoryTint, reportIdent } from './IncidentPanel'
import { StatusIcon, TableSkeleton } from './RequestTable'
import SupportPageSwitch from './SupportPageSwitch'
import { PILL, dateWords, sortKey, statusLook, type SortDir } from './supportDeskModel'

type Incident = Record<string, string>

export const INCIDENTS_SUB = 'Every incident report from the Incident Log, in one place.'
const SEARCH = 'Search client, reporter, category, location or summary'
const RESOURCE = 'uiIncidents'
/** App Control's own row for the pencil in a report's panel (app/writes.py SUPPORT_INCIDENTS_EDIT). */
export const INCIDENT_EDIT_FEATURE = 'support-desk.incidentsEdit'

// the column template is a whole literal so the stylesheet keeps it (Support Requests' own)
const COLS = 'md:grid-cols-[44px_168px_minmax(150px,1fr)_minmax(150px,0.9fr)_minmax(0,1.6fr)_20px]'
const HEAD = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

const val = (r: Incident, k: string): string => String(r[k] ?? '').trim()

export { categoryTint }

/** Case-insensitive over the client, the reporter, the category, the location, the summary and who was involved. */
export function incidentMatches(r: Incident, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return ['client_name', 'your_name', 'incident_category', 'incident_location', 'summary_of_incident', 'employees_involved']
    .some((k) => val(r, k).toLowerCase().includes(q))
}

/** The search, then the incident's day (its filing instant breaking a tie), newest first by default. */
export function visibleIncidents(rows: Incident[], query: string, dir: SortDir): Incident[] {
  const sign = dir === 'asc' ? 1 : -1
  return rows.filter((r) => incidentMatches(r, query)).sort((a, b) => sign * (
    sortKey(val(a, 'incident_date')).localeCompare(sortKey(val(b, 'incident_date')))
    || sortKey(val(a, 'timestamp')).localeCompare(sortKey(val(b, 'timestamp')))
    || val(a, 'id').localeCompare(val(b, 'id'))))
}

/** A saved field: the value sent, and the cell it replaced (its witness). */
export type Saved = { value: string; was: string }
/** The fields each saved edit wrote, by the report itself (reportIdent), laid over the list until a read moves past
 * them; a report that moved under another number is another key, so no report ever shows another's fields. */
export type Patches = Record<string, Record<string, Saved>>

/** The saved fields of one edit: those the door says it wrote, at the values sent, each with the cell it replaced. */
export function savedFields(changes: EditChange[], answer: unknown): Record<string, Saved> {
  const { written } = editAnswerOf(answer)
  return Object.fromEntries(changes.filter((c) => written.includes(c.field))
    .map((c) => [c.field, { value: c.value, was: c.expected }]))
}

/** One edit's saved fields added to the patches: a field saved twice keeps the cell it replaced the first time, so a
 * read still on that cell keeps it shown. */
export function withSaved(patches: Patches, key: string, saved: Record<string, Saved>): Patches {
  const had = patches[key] ?? {}
  return { ...patches, [key]: { ...had, ...Object.fromEntries(Object.entries(saved)
    .map(([k, s]) => [k, { value: s.value, was: had[k]?.was ?? s.was }])) } }
}

/** The rows with the saved fields laid over them. */
export function patchedRows(rows: Incident[], patches: Patches): Incident[] {
  return rows.map((r) => {
    const p = patches[reportIdent(r)]
    return p ? { ...r, ...Object.fromEntries(Object.entries(p).map(([k, s]) => [k, s.value])) } : r
  })
}

/** A fresh read drops each saved field it no longer shows as it was before the edit — ours read back, or a newer
 * one someone else wrote — every report left with none, and every report the read no longer holds as itself. */
export function settledPatches(rows: Incident[], patches: Patches): Patches {
  const byKey = new Map(rows.map((r) => [reportIdent(r), r]))
  const out: Patches = {}
  for (const [key, fields] of Object.entries(patches)) {
    const fresh = byKey.get(key)
    if (!fresh) continue
    const left = Object.fromEntries(Object.entries(fields).filter(([k, s]) => val(fresh, k) === s.was.trim()))
    if (Object.keys(left).length) out[key] = left
  }
  return out
}

/** The Incident Log's MUI Watch, as Support Requests' count chips. */
export function incidentCounts(rows: Incident[], now = new Date()): { key: string; label: string; n: number }[] {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return [
    { key: 'reports', label: 'Reports', n: rows.length },
    { key: 'muis', label: 'MUIs', n: rows.filter((r) => MUI_RE.test(val(r, 'incident_category'))).length },
    { key: 'month', label: 'This month', n: rows.filter((r) => sortKey(val(r, 'incident_date')).startsWith(month)).length },
  ]
}

export default function SupportIncidentsPage() {
  const [rows, setRows] = useState<Incident[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [dir, setDir] = useState<SortDir>('desc')
  // the open report, by the report itself (reportIdent), never its row number alone: drawn in Support Requests' own
  // side panel, and closed if a read moves another report under its number
  const [openKey, setOpenKey] = useState('')
  // the fields saved from the panel, shown until the incidents slice reads them back
  const [patches, setPatches] = useState<Patches>({})
  const mayEdit = useFeatureAllowed(INCIDENT_EDIT_FEATURE)

  // the list read; '' when it was read, else the words of why not (a refresh keeps the last answer on screen)
  const load = useCallback(async (): Promise<string> => {
    setBusy(true)
    setError('')
    try {
      const fresh = ((await api.list<Incident>(RESOURCE)) ?? []) as Incident[]
      setRows(fresh)
      setPatches((p) => settledPatches(fresh, p))
      return ''
    } catch (e) {
      const why = e instanceof Error ? e.message : 'The incidents could not be read.'
      setError(why)
      return why
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // the edit goes through Locations' own door, the report found by its id and witnessed by its filing instant and
  // client; the list is read again after it past every held copy, so a refusal shows what the book holds now
  const via = useMemo<PanelVia>(() => {
    const fresh = async () => {
      // the held slice and the cached list are older than this write: the next read goes live
      noteWrite(RESOURCE)
      invalidate(placeScope(RESOURCE))
      const why = await load()
      if (why) throw new Error(why)
    }
    const target: ApplyTarget = {
      where: { ...LOCATIONS_WHERE, label: 'Support Requests', subject: 'report' },
      overlaid: () => {}, wrote: () => {}, written: () => { void fresh().catch(() => {}) },
      reread: fresh,
    }
    const keep = (key: string, saved: Record<string, Saved>) => {
      if (Object.keys(saved).length) setPatches((p) => withSaved(p, key, saved))
    }
    return {
      client: '', target, rereads: [],
      edit: async (id, changes, cells) => {
        // the report the panel opened (its cells are that report's): the patches' key
        const key = reportIdent(cells)
        try {
          const answer = await editSupportIncident(id, changes, cells.timestamp ?? '', cells.client_name ?? '')
          keep(key, savedFields(changes, answer))
          return answer
        } catch (e) {
          // a partial refusal (409) still wrote some fields: they show, and the refusal's words go on
          keep(key, savedFields(changes, (e as { envelope?: { data?: unknown } }).envelope?.data))
          throw e
        }
      },
    }
  }, [load])

  const listed = useMemo(() => (rows ? patchedRows(rows, patches) : null), [rows, patches])
  const shown = useMemo(() => (listed ? visibleIncidents(listed, query, dir) : []), [listed, query, dir])
  const counts = useMemo(() => (listed ? incidentCounts(listed) : []), [listed])
  const opened = (openKey && listed?.find((r) => reportIdent(r) === openKey)) || null
  const selected = opened ? openKey : ''

  const open = (r: Incident) => setOpenKey(reportIdent(r))

  return (
    <div className="w-full pb-16" data-support-incidents="">
      <PageHeader title="Incidents" subtitle={INCIDENTS_SUB}
        actions={(
          <>
            <SupportPageSwitch current="incidents" />
            <button type="button" onClick={() => void load()} disabled={busy} data-act="refresh"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
            </button>
          </>
        )} />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1" data-toolbar="">
        <SearchInput value={query} onChange={setQuery} placeholder={SEARCH} className="min-w-[220px] flex-1 sm:max-w-[420px]" />
        <button type="button" data-act="clear" onClick={() => setQuery('')} disabled={!query}
          className="h-9 rounded-md px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          Clear
        </button>
        {rows && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5" data-counts="">
            {counts.map((c) => (
              <span key={c.key} data-count={c.key}
                className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
                  c.key === 'muis' && c.n > 0 ? 'bg-tint-pink text-danger' : 'bg-surface-2 text-text-2')}>
                {c.label} <span className="tabular-nums">{c.n}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {rows && error && (
        <p role="alert" className="mb-3 text-[12.5px] text-[var(--warning)]" data-stale="">
          Could not refresh — showing the last answer: {error}
        </p>
      )}
      {!rows && error && (
        <div role="alert" className="rounded-[16px] border border-border bg-surface p-5 text-[12.5px] text-danger shadow-1" data-failed="">
          The incidents could not be read: {error} Nothing is listed rather than an empty list.
          <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Try again</button>
        </div>
      )}
      {!rows && !error && <TableSkeleton />}
      {rows && (shown.length === 0 ? (
        <div className="rounded-[16px] border border-border bg-surface px-6 py-10 text-center text-[13px] text-text-2 shadow-1" data-empty="">
          {query.trim() ? 'No incident matches this search.' : 'No incident is on file.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-border bg-surface shadow-1" data-incident-table="">
          <div className={cn('hidden items-center gap-3 border-b border-border bg-surface-2/50 px-4 py-2.5 md:grid', COLS)} role="presentation">
            <span className={HEAD}>Status</span>
            <button type="button" onClick={() => setDir(dir === 'desc' ? 'asc' : 'desc')} data-sort={dir}
              aria-label={dir === 'desc' ? 'Date, newest first — press for oldest first' : 'Date, oldest first — press for newest first'}
              className={cn(HEAD, 'inline-flex items-center gap-1 text-left hover:text-text-1')}>
              Date {dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
            </button>
            <span className={HEAD}>Client</span>
            <span className={HEAD}>Category</span>
            <span className={HEAD}>Summary</span>
            <span />
          </div>
          <ul className="divide-y divide-border">
            {shown.map((r, i) => (
              <IncidentLine key={val(r, 'id') || i} row={r} open={!!selected && reportIdent(r) === selected} onOpen={open} />
            ))}
          </ul>
        </div>
      ))}
      <IncidentPanel row={opened} onClose={() => setOpenKey('')} via={mayEdit ? via : undefined} />
    </div>
  )
}

function IncidentLine({ row, open, onOpen }: { row: Incident; open: boolean; onOpen: (r: Incident) => void }) {
  const client = val(row, 'client_name')
  const category = val(row, 'incident_category') || 'Incident'
  const mui = MUI_RE.test(category)
  const word = mui ? 'MUI filed' : 'Incident filed'
  const look = statusLook(mui ? 'warning' : 'important')
  const when = dateWords(val(row, 'incident_date'))
  const summary = val(row, 'summary_of_incident')
  const place = [val(row, 'incident_location'), val(row, 'your_name') && `by ${val(row, 'your_name')}`].filter(Boolean).join(' · ')
  const who = cn('truncate text-[13px] font-semibold', client ? 'text-text-1' : 'text-text-3')
  const tint = categoryTint(category)
  const pill = (
    <span data-category-pill={tint} title={category}
      className={cn('inline-flex max-w-full items-center truncate whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', PILL[tint])}>
      {category}
    </span>
  )
  return (
    <li>
      <button type="button" onClick={() => onOpen(row)} data-row={val(row, 'id')}
        aria-label={`${category} for ${client || 'an unnamed client'} — open`}
        className={cn('block w-full px-4 py-3 text-left transition-colors hover:bg-surface-2/70', open && 'bg-primary-soft')}>
        <span className={cn('hidden items-center gap-3 md:grid', COLS)}>
          <StatusIcon look={look} word={word} />
          <span className="text-[12.5px] tabular-nums text-text-2" data-date="">{when}</span>
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={client || '—'} size="xs" />
            <span className={who}>{client || '(no client)'}</span>
          </span>
          <span className="min-w-0">{pill}</span>
          <span className="truncate text-[12.5px] text-text-2" data-description="">{summary || place || '—'}</span>
          <ChevronRight size={16} className="text-text-3" aria-hidden />
        </span>
        <span className="flex items-start gap-3 md:hidden">
          <StatusIcon look={look} word={word} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={client || '—'} size="xs" />
              <span className={who}>{client || '(no client)'}</span>
            </span>
            {(summary || place) && <span className="mt-0.5 block truncate text-[12px] text-text-3">{summary || place}</span>}
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[12px] tabular-nums text-text-2">{when}</span>
              {pill}
            </span>
          </span>
          <ChevronRight size={16} className="mt-1.5 shrink-0 text-text-3" aria-hidden />
        </span>
      </button>
    </li>
  )
}
