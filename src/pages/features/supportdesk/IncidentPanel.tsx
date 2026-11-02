// One incident report in Support Requests' own right side panel (RequestPanel's pattern): the standard SidePanel
// header, the status and category chips, who filed it and when, the summary, and the report's facts in the grey grid —
// the Incident Log's fields (its registered detailPanel's Report and What happened), never a dark header or tiles.
// Support Requests › Incidents opens it, and so does the Incident Log (its detailPanel's ownPanel 'incident', drawn by
// the shell's DetailPanel). A page that hands it `via` (Support Requests › Incidents, for whom App Control's
// support-desk.incidentsEdit opens it) offers the pencil: the report's fields in Locations' own edit form, in this panel,
// the client fixed (a report changes client in Locations or the client's Incidents).
import { useEffect, useState } from 'react'
import Avatar from '@/components/shared/Avatar'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { IncidentEditForm } from '@/pages/features/locations/LocationForms'
import { EditButton, ROW_ID } from '@/pages/features/locations/LocationPanel'
import type { PanelVia } from '@/pages/features/locations/ApplyStrip'
import { PILL, dateWords, type Tint } from './supportDeskModel'

type Incident = Record<string, unknown>

const HEAD = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const CHIP = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold'
// a fact this long reads better across both columns (RequestPanel's)
const WIDE_FACT = 44
/** The Incident Log's MUI Watch matcher. */
export const MUI_RE = /mui|major unusual/i

const val = (r: Incident, k: string): string => String(r[k] ?? '').trim()

/** A category's pill, by the words the paper form uses. */
export function categoryTint(category: string): Tint {
  const c = category.toLowerCase()
  if (MUI_RE.test(c)) return 'blue'
  if (/medication|hospital|restraint|ran away|missing/.test(c)) return 'danger'
  if (/behavior/.test(c)) return 'lavender'
  if (/injury|illness|fall/.test(c)) return 'peach'
  if (/funds/.test(c)) return 'amber'
  return 'slate'
}

/** The report's facts, in the Incident Log's order, then what was found and planned; an empty one says so. */
export function incidentFacts(r: Incident): { label: string; value: string }[] {
  const day = (k: string) => (val(r, k) ? dateWords(val(r, k)) : '')
  const reported = [day('incident_reported_date'), val(r, 'incident_reported_time')].filter(Boolean).join(' ')
  return [
    { label: 'Client', value: val(r, 'client_name') },
    { label: 'Location', value: val(r, 'incident_location') },
    { label: 'Incident date', value: day('incident_date') },
    { label: 'Incident time', value: val(r, 'incident_time') },
    { label: 'Reported on', value: reported },
    { label: 'Employees involved', value: val(r, 'employees_involved') },
    { label: 'Immediate action', value: val(r, 'immediate_action_taken') },
    { label: 'Cause and contributing factors', value: val(r, 'cause_and_contributing_factors') },
    { label: 'Prevention plan', value: val(r, 'prevention_plan') },
  ]
}

/** A report the edit door can find and witness: its row id ("r42"), its filing instant and its client. */
export const editableIncident = (r: Incident): boolean =>
  ROW_ID.test(val(r, 'id')) && !!val(r, 'timestamp') && !!val(r, 'client_name')

/** The report itself: its row number, filing instant and client (what the door witnesses). */
export const reportIdent = (r: Incident): string => [val(r, 'id'), val(r, 'timestamp'), val(r, 'client_name')].join('|')

// the edit form's house: a report opened here names none (the door files it at its client's house)
const NO_HOUSE = { code: '', title: '' }

export default function IncidentPanel({ row, onClose, via }: {
  row: Incident | null
  onClose: () => void
  /** the edit's door and reads, handed only where the edit is open to this person */
  via?: PanelVia
}) {
  const category = row ? val(row, 'incident_category') || 'Incident' : ''
  // the report itself, not its row number: a read that puts another report under the same number is another report
  const ident = row ? reportIdent(row) : ''
  const [editing, setEditing] = useState(false)
  // another report opened, the report moved, or the panel closed: the edit and its draft go
  useEffect(() => { setEditing(false) }, [ident])
  const door = via && row && editableIncident(row) ? via : undefined
  return (
    <SidePanel open={Boolean(row)} onClose={onClose} label={editing && door ? 'Edit incident report' : 'Incident report'}
      title={category}>
      {row && <IncidentPanelContent row={row} category={category} via={door} editing={editing}
        onEdit={() => setEditing(true)} onDone={() => setEditing(false)} />}
    </SidePanel>
  )
}

/** The panel's content: the report with its pencil where the edit's door is handed, or the edit form once pressed. */
export function IncidentPanelContent({ row, category, via, editing, onEdit, onDone }: {
  row: Incident
  category: string
  via?: PanelVia
  editing: boolean
  onEdit: () => void
  onDone: () => void
}) {
  if (editing && via) {
    // keyed by the report, so a draft never carries over to another report under the same row number
    return (
      <IncidentEditForm key={reportIdent(row)} house={NO_HOUSE} row={{ id: val(row, 'id'), row: cellsOf(row) }}
        client={val(row, 'client_name')} via={via} onDone={onDone} />
    )
  }
  return (
    <>
      {via && <div className="flex justify-end pt-1"><EditButton onClick={onEdit} /></div>}
      <IncidentBody row={row} category={category} />
    </>
  )
}

/** The report's cells as the edit form witnesses them, each a string. */
const cellsOf = (r: Incident): Record<string, string> =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')]))

export function IncidentBody({ row, category, tint = categoryTint(category) }: {
  row: Incident
  category: string
  /** the category's pill, as the tables paint it */
  tint?: Tint
}) {
  const mui = MUI_RE.test(category)
  const filer = val(row, 'your_name')
  const filed = val(row, 'timestamp')
  return (
    <div className="mt-2 grid gap-3.5" data-incident-panel={val(row, 'id')}>
      <div className="flex flex-wrap items-center gap-1.5" data-chips="">
        <span className={cn(CHIP, mui ? PILL.danger : PILL.amber)} data-status-word="">{mui ? 'MUI filed' : 'Incident filed'}</span>
        <span className={cn(CHIP, PILL[tint])} data-category-pill={tint}>{category}</span>
      </div>

      <div className="flex items-center gap-2.5" data-filer="">
        <Avatar name={filer || '—'} size="sm" />
        <div className="min-w-0 leading-5">
          <p className={cn('truncate text-[13.5px] font-semibold', filer ? 'text-text-1' : 'text-text-3')}>
            {filer || 'Reporter not named'}
          </p>
          <p className="text-[12px] text-text-3">{filed ? `Filed ${dateWords(filed)}` : 'Filing time not recorded'}</p>
        </div>
      </div>

      <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-text-1" data-full-summary="">
        {val(row, 'summary_of_incident') || 'No summary was filed.'}
      </p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-surface-2 px-3 py-2.5" data-details="">
        {incidentFacts(row).map((d) => (
          <div key={d.label} className={cn('min-w-0', d.value.length > WIDE_FACT && 'col-span-2')}>
            <dt className={HEAD}>{d.label}</dt>
            <dd className="whitespace-pre-wrap break-words text-[12.5px] leading-5 text-text-1">{d.value || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
