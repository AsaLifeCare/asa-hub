// Incidents: the incidents of the house's current clients, newest first, filtered by client and by category (the…
// Date, client, category and summary; the arrow expands the row on the rest of the report, a row opens read-only in the panel.
import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown, Plus } from 'lucide-react'
import { clientProfileHref, type HouseClient, type HouseRow } from '@/pages/features/houses/houseModel'
import { cn } from '@/lib/utils'
import { staffHref } from '@/pages/features/staffprofiles/staffModel'
import { Switch } from '@/components/ui/switch'
import {
  INCIDENT_DETAIL_FIELDS, filterIncidents, incidentChoices, incidentClock, incidentDay, incidentsOf, medErrorOnly, nameKey,
  type LocationIncident, type PanelAsk,
} from '../locationModel'
import { readIncidents, readKey, useCan, useLocationRead, type ReadState } from '../useLocation'
import { ReadLine, SectionCard, linkCls } from '../LocationParts'

export default function Incidents({ house, onAsk }: { house: HouseRow; onAsk: (ask: PanelAsk) => void }) {
  const incidents = useLocationRead(readKey('locationIncidents', house.code), () => readIncidents(house.code), incidentsOf)
  const [client, setClient] = useState('')
  const [category, setCategory] = useState('')
  // med errors are many: hidden until asked for
  const [showMed, setShowMed] = useState(false)
  return <IncidentsView clients={house.clients} incidents={incidents} client={client} category={category}
    onClient={setClient} onCategory={setCategory} onAsk={onAsk} onRetry={incidents.reload} showMed={showMed} onShowMed={setShowMed} />
}

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const SELECT = 'h-9 rounded-md border border-border bg-surface px-2.5 text-[12.5px] text-text-1 outline-none focus:border-primary'

export function IncidentsView({ clients, incidents, client, category, onClient, onCategory, onAsk, onRetry, showMed = true,
  onShowMed }: {
  clients: HouseClient[]
  incidents: ReadState<LocationIncident[]>
  client: string
  category: string
  onClient: (v: string) => void
  onCategory: (v: string) => void
  onAsk: (ask: PanelAsk) => void
  onRetry: () => void
  /** whether the incidents that are med errors alone are listed; the switch is drawn only with onShowMed */
  showMed?: boolean
  onShowMed?: (on: boolean) => void
}) {
  // a new incident: the open-and-edit edition, or the New Incident one alone
  const opens = useCan('locations.incidents')
  const files = useCan('locations.incidentsNew')
  const writes = opens || files
  const [open, setOpen] = useState<string | null>(null)
  const all = incidents.data ?? []
  const choices = incidentChoices(all)
  const rows = filterIncidents(all, client, category, showMed)
  const medCount = all.filter((r) => (!client || nameKey(r.client) === nameKey(client)) && medErrorOnly(r)).length
  const clientRecord = (name: string) => clients.find((c) => nameKey(c.name) === nameKey(name))
  return (
    <SectionCard title="Incidents" extra={writes ? (
      <button type="button" onClick={() => onAsk({ kind: 'incident' })}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover">
        <Plus size={14} /> New Incident
      </button>
    ) : undefined}>
      <div className="mb-4 flex flex-wrap gap-2">
        <select aria-label="Client" value={client} onChange={(e) => onClient(e.target.value)} className={SELECT} data-filter="client">
          <option value="">All clients</option>
          {choices.clients.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Category" value={category} onChange={(e) => onCategory(e.target.value)} className={cn(SELECT, 'max-w-full sm:max-w-[360px]')}
          data-filter="category">
          <option value="">All categories</option>
          {choices.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {onShowMed && (
          <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[12.5px] text-text-1"
            data-filter="med-errors" title="Incidents whose every category is a medication error">
            <Switch checked={showMed} onCheckedChange={onShowMed} aria-label="Show med errors"
              className="data-[state=unchecked]:bg-text-3 dark:data-[state=unchecked]:bg-text-3" />
            Show med errors{medCount ? <span className="font-semibold text-text-1">({medCount})</span> : null}
          </label>
        )}
      </div>
      <ReadLine state={incidents} what="the incidents" onRetry={onRetry} />
      {incidents.data && rows.length === 0 && (
        <p className="text-[13px] text-text-3">{all.length ? 'No incident matches these filters.' : "No incident on record for this house's clients."}</p>
      )}
      {rows.length > 0 && (
        <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] border-collapse text-[13px]" data-incidents="">
            <thead className="bg-surface-2/60">
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Client</th>
                <th className={TH}>Incident category</th>
                <th className={TH}>Incident summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const expanded = open === r.id
                const record = clientRecord(r.client)
                return (
                  <Fragment key={r.id}>
                    <tr data-incident={r.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => onAsk({ kind: 'incident-row', id: r.id })}>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <button type="button" aria-expanded={expanded} data-expand={r.id} aria-label="Show the incident"
                            onClick={(e) => { e.stopPropagation(); setOpen(expanded ? null : r.id) }}
                            className="inline-flex items-center text-text-3">
                            <ChevronDown size={14} className={cn('shrink-0 transition-transform', expanded && 'rotate-180')} />
                          </button>
                          <span className="font-medium text-text-1">{incidentDay(r.date)}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {r.client ? (
                          <Link to={clientProfileHref({ name: r.client, client_key: r.clientKey || record?.client_key })}
                            className={linkCls} onClick={(e) => e.stopPropagation()}>{r.client}</Link>
                        ) : <span className="text-text-1">—</span>}
                      </td>
                      <td className="px-3 py-3 text-text-2">{r.categories.join(' · ') || '—'}</td>
                      <td className="max-w-[380px] px-3 py-3 text-text-2">
                        <span className="line-clamp-2" title={r.row.summary_of_incident || undefined}>{r.row.summary_of_incident || '—'}</span>
                      </td>
                    </tr>
                    {expanded && (
                      <tr data-expanded={r.id} className="bg-surface-2/40">
                        <td colSpan={4} className="px-4 py-4">
                          <dl className="grid gap-3 sm:grid-cols-2">
                            <div className="min-w-0">
                              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Your name</dt>
                              <dd className="mt-1 text-[13px] leading-5 text-text-2">
                                {r.yourName ? <Link to={staffHref(r.yourName)} className={linkCls}>{r.yourName}</Link> : '—'}
                              </dd>
                            </div>
                            {([['Incident location', r.location], ['Incident time', incidentClock(r.time)]] as const).map(([label, v]) => (
                              <div key={label} className="min-w-0">
                                <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
                                <dd className="mt-1 text-[13px] leading-5 text-text-2">{v || '—'}</dd>
                              </div>
                            ))}
                            {INCIDENT_DETAIL_FIELDS.filter((f) => r.row[f.key]).map((f) => (
                              <div key={f.key} className="min-w-0">
                                <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{f.label}</dt>
                                <dd className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-text-2">{r.row[f.key]}</dd>
                              </div>
                            ))}
                          </dl>
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
    </SectionCard>
  )
}
