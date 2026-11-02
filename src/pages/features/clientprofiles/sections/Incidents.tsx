// Incidents: the client's UI reports, newest first, with a search, the category checkboxes and the status filter, laid
// out as Locations lays its own: New Incident in the card's header, and a row opens the report. The date expands the
// row in place — the report's other fields, the Status select.
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronDown, Loader2, Plus } from 'lucide-react'
import DragPerson from '@/components/shared/DragPerson'
import SearchInput from '@/components/shared/SearchInput'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import {
  clientHref, clientIncidentsOf, clockLabel, dayLabel, filterRows, houseHref, incidentText,
  type ClientAsk, type IncidentRow, type IncidentsAnswer, type RosterRow,
} from '../clientModel'
import {
  QUEUED_WORDS, clientWrote, readIncidents, readKey, setIncidentStatus, useClientRead, type ReadState,
} from '../useClientRead'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { EmptyNote, ReadLine, StatusPill, linkCls } from '../ClientParts'
import { useClientCan, useClientReader } from '../clientViewer'

export default function IncidentsSection({ client, onAsk }: { client: RosterRow; onAsk: (ask: ClientAsk) => void }) {
  const incidents = useClientRead(readKey('clientProfileIncidents', client.client_key), () => readIncidents(client.client_key), clientIncidentsOf)
  return <IncidentsBody client={client} incidents={incidents} onAsk={onAsk} onRetry={incidents.reload} />
}

const TH = 'whitespace-nowrap px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const SELECT = 'h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'
const COLUMNS = ['Date', 'Time', 'Incident category', 'Incident summary', 'Employees involved']
// a report with no category is filtered under this name
const UNCATEGORIZED = 'No category'
// the categories left unchecked until the reader checks them
const MED_ERROR = /\bmed(?:ication)?s?\b.*\berrors?\b/i

const categoriesOf = (r: IncidentRow) => (r.categories.length ? r.categories : [UNCATEGORIZED])

export function IncidentsBody({ client, incidents, onAsk, onRetry }: {
  client: RosterRow
  incidents: ReadState<IncidentsAnswer>
  onAsk: (ask: ClientAsk) => void
  onRetry: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  // null until the reader touches a box: every category checked except the medication errors
  const [unchecked, setUnchecked] = useState<Set<string> | null>(null)
  // the master, or a holder of the Clients edition that files an incident (Settings › Editions)
  const files = useClientCan('clients.incidents')
  const a = incidents.data
  const categories = useMemo(() => [...new Set((a?.rows ?? []).flatMap(categoriesOf))].sort((x, y) => x.localeCompare(y)), [a])
  const off = unchecked ?? new Set(categories.filter((c) => MED_ERROR.test(c)))
  const rows = a ? filterRows(a.rows, query, status, incidentText).filter((r) => categoriesOf(r).some((c) => !off.has(c))) : []
  const toggle = (c: string) => setUnchecked(() => {
    const next = new Set(off)
    if (next.has(c)) next.delete(c)
    else next.add(c)
    return next
  })
  const shown = categories.filter((c) => !off.has(c)).length
  return (
    <SectionCard title="Incidents" extra={files ? (
      <button type="button" onClick={() => onAsk({ kind: 'new-incident' })} data-new-incident=""
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover">
        <Plus size={14} /> New Incident
      </button>
    ) : undefined}>
      <div className="grid gap-4" data-incidents-section="">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search this view…" className="h-10 min-w-[200px] flex-1 rounded-[12px]" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(SELECT, 'inline-flex items-center gap-1.5')} data-filter="category">
                {shown === categories.length ? 'All categories' : `Categories · ${shown} of ${categories.length}`}
                <ChevronDown size={14} className="text-text-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[360px] min-w-[260px] overflow-y-auto">
              {categories.map((c) => (
                <DropdownMenuCheckboxItem key={c} checked={!off.has(c)} onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggle(c)} data-category={c}>
                  {c}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setUnchecked(new Set()) }}>Check all</DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setUnchecked(null) }}>Back to the default</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT} data-filter="status">
            <option value="">All statuses</option>
            {(a?.statuses ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <ReadLine state={incidents} what="the incidents" onRetry={onRetry} />
        {a && a.rows.length === 0 && <EmptyNote>No incident is on record for this client.</EmptyNote>}
        {a && a.rows.length > 0 && rows.length === 0 && <EmptyNote>Nothing here matches the search, the categories and the status.</EmptyNote>}
        {rows.length > 0 && (
          <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border bg-surface shadow-1">
            <table className="w-full min-w-[860px] border-collapse text-[13px]" data-incidents="">
              <thead className="border-b border-border bg-surface-2/50">
                <tr>{COLUMNS.map((c) => <th key={c} className={TH}>{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const expanded = open === r.id
                  return (
                    <Fragment key={r.id}>
                      <tr data-incident={r.id} className="cursor-pointer hover:bg-surface-2/60"
                        onClick={() => onAsk({ kind: 'incident', id: r.id })}>
                        <td className="whitespace-nowrap px-3 py-3">
                          <button type="button" aria-expanded={expanded} data-expand={r.id}
                            onClick={(e) => { e.stopPropagation(); setOpen(expanded ? null : r.id) }}
                            className="inline-flex items-center gap-1.5 text-left font-medium text-text-1">
                            <ChevronDown size={14} className={cn('shrink-0 text-text-3 transition-transform', expanded && 'rotate-180')} />
                            {dayLabel(r.incident_date) || '—'}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-text-2">{clockLabel(r.incident_time) || '—'}</td>
                        <td className="px-3 py-3 text-text-2">{r.categories.join(' · ') || '—'}</td>
                        <td className="max-w-[340px] px-3 py-3 text-text-2">
                          <span className="line-clamp-2" title={r.summary_of_incident || undefined}>{r.summary_of_incident || '—'}</span>
                        </td>
                        <td className="px-3 py-3">
                          {r.employees_involved.length ? (
                            <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                              {r.employees_involved.map((e) => (
                                <DragPerson key={e} name={e} type="staff" subtitle="Employee involved"><span className="text-primary">{e}</span></DragPerson>
                              ))}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                      {expanded && (
                        <tr data-expanded={r.id} className="bg-surface-2/40">
                          <td colSpan={COLUMNS.length} className="px-4 py-4">
                            <IncidentExpanded client={client} row={r} statuses={a?.statuses ?? []} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

const DT = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const DD = 'mt-1 whitespace-pre-wrap text-[13px] leading-5 text-text-2'

// The report's fields the table leaves out, beside the Status select.
function IncidentExpanded({ client, row, statuses }: { client: RosterRow; row: IncidentRow; statuses: string[] }) {
  const facts: [string, ReactNode][] = [
    ['Your name', row.your_name || '—'],
    ['Client name', <Link to={clientHref(row.client_key || client.client_key)} className={linkCls}>{row.client_name || client.name}</Link>],
    ['Incident location', row.house_code
      ? <Link to={houseHref(row.house_code)} className={linkCls}>{row.incident_location || row.house_code}</Link>
      : row.incident_location || '—'],
    ['Incident reported date', dayLabel(row.incident_reported_date) || '—'],
    ['Incident reported time', clockLabel(row.incident_reported_time) || '—'],
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="grid gap-4">
        <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {facts.map(([label, v]) => (
            <div key={label} className="min-w-0">
              <dt className={DT}>{label}</dt>
              <dd className={DD}>{v}</dd>
            </div>
          ))}
        </dl>
        <dl className="grid gap-3 sm:grid-cols-3">
          {([['Summary of Incident', row.summary_of_incident], ['Immediate Action Taken', row.immediate_action_taken],
            ['Cause and Contributing Factors', row.cause_and_contributing_factors]] as const).map(([label, v]) => (
            <div key={label} className="min-w-0">
              <dt className={DT}>{label}</dt>
              <dd className={DD}>{v || '—'}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="grid content-start gap-2">
        <StatusControl client={client} row={row} statuses={statuses} />
      </div>
    </div>
  )
}

// The Status select: a choice is filed only when Save is pressed, by client and the report's own stamp.
export function StatusControl({ client, row, statuses }: { client: RosterRow; row: IncidentRow; statuses: string[] }) {
  const [value, setValue] = useState(row.status)
  const [busy, setBusy] = useState(false)
  const { mayWrite } = useClientReader()
  const changed = value !== row.status
  if (!mayWrite) {
    return (
      <div className="grid gap-1.5" data-status-read={row.id}>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Status</span>
        <p className="text-[11.5px] text-text-3"><StatusPill status={row.status} />{row.status_at ? ` · ${dayLabel(row.status_at)}` : ''}</p>
      </div>
    )
  }
  const save = async () => {
    setBusy(true)
    try {
      const sent = Date.now()
      const got = await setIncidentStatus({ client: client.client_key, incident_ts: row.incident_ts, client_name: row.client_name || client.name, status: value })
      const queued = clientWrote(client.client_key, got, sent)
      toast({ type: 'success', title: queued ? 'Status accepted' : 'Status saved', body: queued ? QUEUED_WORDS : `${row.client_name || client.name} · ${value}` })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-1.5" data-status-control={row.id}>
      <label className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3" htmlFor={`status-${row.id}`}>Status</label>
      <div className="flex items-center gap-2">
        <select id={`status-${row.id}`} value={value} disabled={busy || !row.incident_ts} onChange={(e) => setValue(e.target.value)} className={cn(SELECT, 'flex-1')}>
          {[...new Set([row.status, ...statuses])].filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {changed && (
          <button type="button" onClick={() => void save()} disabled={busy} data-save-status=""
            className="inline-flex h-10 items-center gap-1.5 rounded-[12px] bg-primary px-3 text-[12.5px] font-semibold text-on-primary disabled:opacity-40">
            {busy && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        )}
      </div>
      {!changed && <p className="text-[11.5px] text-text-3"><StatusPill status={row.status} />{row.status_by ? ` · ${row.status_by}` : ''}{row.status_at ? ` · ${dayLabel(row.status_at)}` : ''}</p>}
      {!row.incident_ts && <p className="text-[11.5px] text-text-3">This report carries no timestamp, so its status cannot be filed.</p>}
    </div>
  )
}
