// History: every trip, newest first — the client, what it is for and where, who asked, the reserved time, the…
// "Open" brings the trip into the panel.
import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import SearchInput from '@/components/shared/SearchInput'
import { cn } from '@/lib/utils'
import { dayLabel, easternWall, historyRows, statusesIn, whenWords, type Panel, type Trip } from './vehicleCalendarModel'
import { PersonLine, StatusPill } from './parts'

const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const TD = 'px-4 py-3 align-middle text-[13px] text-text-2'
const SELECT = 'h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'
const OPEN = 'inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2'

export const EMPTY_TITLE = 'No matching records'
export const EMPTY_BODY = 'Try another view, search or client, or add a record here.'

export default function HistoryTable({ trips, onPanel }: { trips: Trip[]; onPanel: (p: Panel) => void }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const rows = historyRows(trips, search, status)
  return (
    <section className="grid gap-3" data-history="">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search client, trip, staff or vehicle…" className="h-10 min-w-[200px] flex-1 rounded-[12px]" />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT} data-filter="status">
          <option value="">All statuses</option>
          {statusesIn(trips).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-[16px] border border-border bg-surface shadow-1" data-empty="">
          <EmptyState title={EMPTY_TITLE} body={EMPTY_BODY} />
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-[16px] border border-border bg-surface shadow-1 md:block">
            <table className="w-full border-collapse">
              <thead className="border-b border-border bg-surface-2/50">
                <tr>
                  <th className={TH}>Client</th><th className={TH}>Trip / Destination</th><th className={TH}>Staff / Request</th>
                  <th className={TH}>Reserved time</th><th className={TH}>Assignment</th><th className={TH}>Status</th><th className={TH}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((t) => (
                  <tr key={t.id} data-row={t.id} className="hover:bg-surface-2/40">
                    <td className={cn(TD, 'font-medium text-text-1')}>{clientCell(t)}</td>
                    <td className={TD}><TripCell t={t} /></td>
                    <td className={TD}><PersonLine name={t.private ? '' : t.staff_name || t.requested_by.name} line={requestLine(t)} /></td>
                    <td className={cn(TD, 'whitespace-nowrap')}>{reserved(t)}</td>
                    <td className={TD}>{assignment(t)}</td>
                    <td className={TD}><StatusPill word={t.word} tone={t.tone} /></td>
                    <td className={TD}>
                      <button type="button" className={OPEN} onClick={() => onPanel({ kind: 'trip', id: t.id })} data-open-trip={t.id}>
                        Open <ArrowRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="grid gap-2 md:hidden" data-history-cards="">
            {rows.map((t) => (
              <li key={t.id} className="rounded-[14px] border border-border bg-surface p-3 shadow-1">
                <button type="button" onClick={() => onPanel({ kind: 'trip', id: t.id })} className="grid w-full gap-1.5 text-left">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-semibold text-text-1">{clientCell(t)}</span>
                    <StatusPill word={t.word} tone={t.tone} />
                  </span>
                  <TripCell t={t} />
                  <span className="text-[12px] text-text-3">{reserved(t)}</span>
                  <span className="text-[12px] text-text-2">{assignment(t)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

const clientCell = (t: Trip): string => (t.private ? 'Private' : t.client_name || 'No client')

function TripCell({ t }: { t: Trip }) {
  if (t.private) return <span className="text-text-3">Booked</span>
  return (
    <span className="grid min-w-0">
      <span className="truncate font-medium text-text-1">{t.purpose || t.trip_type || 'Trip'}</span>
      <span className="truncate text-[12px] text-text-3">{[t.purpose ? t.trip_type : '', t.destination].filter(Boolean).join(' · ') || '—'}</span>
    </span>
  )
}

function requestLine(t: Trip): string {
  if (t.private) return ''
  const day = t.created_at ? dayLabel(easternWall(t.created_at).slice(0, 10)) : ''
  const by = t.requested_by.name && t.requested_by.name !== t.staff_name ? `by ${t.requested_by.name}` : ''
  return [day ? `Requested ${day}` : '', by].filter(Boolean).join(' ')
}

function reserved(t: Trip): string {
  const when = whenWords(t.start_at, t.end_at)
  return t.end_known ? when : `${when} (end not on the Van Calendar)`
}

function assignment(t: Trip): string {
  if (t.state === 'scheduled') return [t.vehicle_name, t.driver_name].filter(Boolean).join(' · ') || '—'
  if (t.state === 'needs_assignment') return t.assign_note || 'No vehicle yet'
  if (t.state === 'requested') return t.requested_vehicle_name ? `Asked for ${t.requested_vehicle_name}` : 'Waiting on the directors'
  return t.requested_vehicle_name || '—'
}
