/** RECORD | DATE | DETAILS | STATUS | ACTION — the columns Care & Support and Medication draw the one table with;
 * Daily care, Health & behavior and Personal goals draw SUBJECT | ACTION, the pencil opening the rest. */
import type { ReactNode } from 'react'
import AddressMapLink from '@/components/shared/AddressMap'
import { MedName } from '@/components/shared/MedThumb'
import { dayLabel, shownValue, type ClientAsk, type RecordRow } from '../clientModel'
import { PencilButton, StatusPill, type TableColumn } from '../ClientParts'

/** A row's details; the address it names (the Home row) is a map link. */
export function recordDetails(r: RecordRow): ReactNode {
  const address = r.address ?? ''
  if (address && r.details.endsWith(address)) {
    return <>{r.details.slice(0, r.details.length - address.length)}<AddressMapLink address={address} title={r.record || 'Address'} /></>
  }
  return r.details ? shownValue(r.details) : '—'
}

/** The Care & Support tabs whose table lists each record's subject alone. */
export const SUBJECT_ONLY_VIEWS: readonly string[] = ['daily', 'health', 'goals']

export const subjectOnly = (section: 'care' | 'medication', view: string): boolean =>
  section === 'care' && SUBJECT_ONLY_VIEWS.includes(view)

export function recordColumns(section: 'care' | 'medication', view: string, onAsk: (ask: ClientAsk) => void): TableColumn<RecordRow>[] {
  const name = (r: RecordRow) => <span className="font-semibold text-text-1">{r.record || '—'}</span>
  const action: TableColumn<RecordRow> = {
    label: 'Action',
    cell: (r) => <PencilButton label={`Open ${r.record || 'the record'}`} onClick={() => onAsk({ kind: 'record', section, view, id: r.id })} />,
  }
  if (subjectOnly(section, view)) return [{ label: 'Subject', cell: name }, action]
  return [
    { label: 'Record', cell: (r) => (section === 'medication' ? <MedName name={r.record}>{name(r)}</MedName> : name(r)) },
    { label: 'Date', cell: (r) => <span className="whitespace-nowrap">{dayLabel(r.date) || r.date || '—'}</span> },
    { label: 'Details', cell: (r) => <span className="clamp-2 max-w-[420px]">{recordDetails(r)}</span> },
    { label: 'Status', cell: (r) => <StatusPill status={r.status} /> },
    action,
  ]
}
