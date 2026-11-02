// THE ONE RIGHT PANEL of Clients — a SidePanel whose mode switches: share, the details pencil, Client management…
// It is an aside, never a dialog.
import { useMemo, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { AddressMapFrame } from '@/components/shared/AddressMap'
import { MedName } from '@/components/shared/MedThumb'
import RecordEditBody from '@/components/shared/RecordEditBody'
import { editAnswerOf, type EditChange } from '@/lib/recordEdit'
import { useShellHides } from '@/lib/myWorkHides'
import ApplyStrip, { useApplyFor, type PanelVia } from '@/pages/features/locations/ApplyStrip'
import { EditButton, IncidentEdit, ROW_ID, ShareBody, type IncidentHouse } from '@/pages/features/locations/LocationPanel'
import { IncidentForm } from '@/pages/features/locations/LocationForms'
import { readKey as sourceKey, useLocationRead } from '@/pages/features/locations/useLocation'
import type { LocationIncident } from '@/pages/features/locations/locationModel'
import { codeIn } from '@/pages/features/houses/houseModel'
import type { SharePayload } from '@/stores/useShareStore'
import {
  NEW_MEMBER, activityKindLabel, activityOf, careEditFields, careOf, clientIncidentsOf, clockLabel, dayLabel, familyEditFields,
  medEditFields, medsOf, ohioClockOf, panelLabel, panelTitle, profileOf, shownValue, type CareView, type ClientAsk, type IncidentRow,
  type RecordRow, type RosterRow,
} from './clientModel'
import {
  CLIENT_REREAD, clientTarget, editMedication, editOverride, readActivity, readCare, readDetails,
  readIncidents, readKey, readMeds, removeMedication, useClientDocs, useClientRead,
} from './useClientRead'
import { clientCan, useClientCan, useClientReader } from './clientViewer'
import { AddClientForm, AddMedicationForm, CreateUserForm, EditProfileForm, NewIncidentForm, ToolRun } from './ClientForms'
import { DocButton, ReadLine, Row, StatusPill } from './ClientParts'
import { StatusControl } from './sections/Incidents'
import { ProfileAddressBody } from './sections/Profile'
import { billingOf, financeRefusal, readBilling } from './sources/finance'

export default function ClientPanel({ ask, client, clients, share, onAsk, onClose }: {
  ask: ClientAsk | null
  client: RosterRow
  /** the roster, for Create user's list */
  clients: RosterRow[]
  share: SharePayload
  onAsk: (ask: ClientAsk | null) => void
  onClose: () => void
}) {
  // the Client details and New incident panels' titles are the master's while Settings › My Work keeps their notes
  const hides = useShellHides()
  const bare = (ask?.kind === 'edit-profile' && hides.client_edit_notes) || (ask?.kind === 'new-incident' && hides.incident_notes)
  const title = !ask || bare ? '' : panelTitle(ask, client.name)
  return (
    <SidePanel open={!!ask} onClose={onClose} label={ask ? panelLabel(ask) : 'Clients'} title={title}>
      {ask && <PanelBody key={`${client.client_key}|${JSON.stringify(ask)}`} ask={ask} client={client} clients={clients} share={share}
        onAsk={onAsk} onClose={onClose} />}
    </SidePanel>
  )
}

export function PanelBody({ ask, client, clients, share, onClose }: {
  ask: ClientAsk
  client: RosterRow
  clients: RosterRow[]
  share: SharePayload
  onAsk: (ask: ClientAsk | null) => void
  onClose: () => void
}) {
  switch (ask.kind) {
    case 'share': return <ShareBody payload={share} />
    case 'edit-profile': return <EditProfileForm client={client} onDone={onClose} />
    case 'add-client': return <AddClientForm onDone={onClose} />
    case 'create-user': return <CreateUserForm who={ask.who} current={client} clients={clients.length ? clients : [client]} onDone={onClose} />
    case 'tool': return <ToolRun tool={ask.tool} onDone={onClose} />
    case 'add-medication': return <AddMedicationForm client={client} onDone={onClose} />
    case 'add-authorization': return <AddAuthorization client={client} />
    case 'new-incident': return <ClientIncidentNew client={client} onDone={onClose} />
    case 'record': return <RecordDetail client={client} section={ask.section} view={ask.view} id={ask.id} edit={ask.edit} onClose={onClose} />
    case 'family-edit': return <FamilyEditBody client={client} id={ask.id} onDone={onClose} />
    case 'care-add': return <CareEditBody client={client} view={ask.view} row={null} onDone={onClose} />
    case 'activity': return <ActivityDetail client={client} id={ask.id} />
    case 'incident': return <IncidentDetail client={client} id={ask.id} />
    case 'address': return <ProfileAddressBody client={client} group={ask.group} />
    case 'source': return null
  }
}

function Gone({ what, name }: { what: string; name: string }) {
  return <p className="text-[12.5px] text-text-3">This {what} is no longer listed for {name}.</p>
}

/* ---------- records ---------- */

function RecordDetail({ client, section, view, id, edit, onClose }: {
  client: RosterRow
  section: 'care' | 'medication'
  view: string
  id: string
  /** opened on the edit form alone (a chapter read in the page): saving or leaving it closes the panel */
  edit?: boolean
  onClose: () => void
}) {
  const key = client.client_key
  const read = useClientRead<{ rows: RecordRow[] }>(
    section === 'care' ? readKey('clientProfileCare', key, view) : readKey('clientProfileMeds', key, 'meds'),
    () => (section === 'care' ? readCare(key, view as CareView) : readMeds(key)),
    section === 'care' ? careOf : medsOf)
  const docs = useClientDocs()
  const reader = useClientReader()
  const [editing, setEditing] = useState(!!edit)
  // a chart row's removal runs its Apply strip here, which outlives the row it took off
  const removal = useApplyFor(useMemo(() => clientTarget(key), [key]))
  const [removing, setRemoving] = useState<RecordRow | null>(null)
  const r = read.data?.rows.find((x) => x.id === id) ?? null
  if (removing && removal.state.phase !== 'idle') {
    return (
      <div className="grid min-w-0 gap-4 pt-1" data-med-removal={removing.id}>
        <p className="text-[13px] text-text-2">
          {removing.record} · {removal.state.phase === 'refused' ? 'Still on' : removal.state.phase === 'done' ? 'Taken off' : 'Taking it off'} the
          eMAR list for {client.name}.
        </p>
        <ApplyStrip state={removal.state} onDone={() => { removal.reset(); setRemoving(null); onClose() }}
          onAgain={() => { removal.reset(); setRemoving(null) }} />
      </div>
    )
  }
  if (!r) {
    return <div className="grid gap-3 pt-1"><ReadLine state={read} what="the record" onRetry={read.reload} />{read.data && <Gone what="record" name={client.name} />}</div>
  }
  const remove = (row: RecordRow) => {
    setRemoving(row)
    // a refusal is the strip's own words
    void removal.run(() => removeMedication(key, row.id), [CLIENT_REREAD.meds(key)]).catch(() => {})
  }
  // the master's, or a holder's of the medication edition (Settings › Editions)
  const medEdit = section === 'medication' && clientCan(reader, 'clients.medication') && r.edit ? r.edit : null
  const careEdit = section === 'care' && clientCan(reader, 'clients.care') && !!r.edit
  if (medEdit && editing) return <MedEditBody client={client} row={r} edit={medEdit} onDone={() => setEditing(false)} />
  if (careEdit && editing) return <CareEditBody client={client} view={view} row={r} onDone={() => (edit ? onClose() : setEditing(false))} />
  return (
    <div className="grid gap-4 pt-1" data-record-panel={r.id}>
      {section === 'medication' ? (
        <MedName name={r.record} size={56} eager>
          <span className="grid justify-items-start gap-1.5">
            <span className="text-[14px] font-semibold text-text-1">{r.record || '—'}</span>
            <StatusPill status={r.status} />
          </span>
        </MedName>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-text-1">{r.record || '—'}</span>
          <StatusPill status={r.status} />
          {careEdit && (
            <button type="button" onClick={() => setEditing(true)} data-care-edit="" aria-label="Edit record"
              title="Edit record"
              className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-white hover:bg-primary-hover">
              <Pencil size={15} />
            </button>
          )}
        </div>
      )}
      <dl className="grid gap-3">
        <Row label="Date">{dayLabel(r.date) || r.date || '—'}</Row>
        {r.details && <Row label="Details">{shownValue(r.details)}</Row>}
        {r.text && <Row label="As the plan writes it">{shownValue(r.text)}</Row>}
        {r.source && <Row label="Source">{r.source}</Row>}
      </dl>
      {r.address && <span data-record-map=""><AddressMapFrame address={r.address} height={240} /></span>}
      {r.file_id && (
        <span data-view-isp="">
          <DocButton busy={docs.opening === `${key}|${r.file_id}`} onOpen={() => docs.open(key, r.file_id, r.source || r.record || 'ISP')}>
            View ISP
          </DocButton>
        </span>
      )}
      {medEdit && <MedActions row={r} onEdit={() => setEditing(true)} onRemove={() => remove(r)} />}
    </div>
  )
}

/** The second press of an edition's form (Locations' own words). */
const applyChanges = (n: number) => `Apply ${n} change${n === 1 ? '' : 's'}`

/** A care row corrected or hidden over the plan, or (row null) a new one on this tab, through the Apply strip. */
export function CareEditBody({ client, view, row, onDone }: { client: RosterRow; view: string; row: RecordRow | null; onDone: () => void }) {
  const fields = useMemo(() => careEditFields(row), [row])
  const target = useMemo(() => clientTarget(client.client_key), [client.client_key])
  const apply = useApplyFor(target)
  const file = async (changes: EditChange[]) => editAnswerOf(await apply.run(
    () => editOverride({ client: client.client_key, kind: 'care', tab: view, target: row?.id ?? '', changes }),
    [CLIENT_REREAD.care(client.client_key, view)]))
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-care-edit-panel={row?.id ?? 'new'}>
      <RecordEditBody fields={fields} onDone={onDone} onFile={file} stay applyLabel={applyChanges}
        locked={apply.state.phase === 'running'}
        intro={`${client.name} · Kept in the Hub over the plan: reading the plan again never overwrites it.`} />
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}

/** A family member corrected or hidden over the plan's list, or (id 'new') a new one, through the Apply strip. */
function FamilyEditBody({ client, id, onDone }: { client: RosterRow; id: string; onDone: () => void }) {
  const profile = useClientRead(readKey('clientProfileDetails', client.client_key), () => readDetails(client.client_key), profileOf)
  const isNew = id === NEW_MEMBER
  const member = isNew ? null : profile.data?.family.find((f) => f.key === id) ?? null
  const fields = useMemo(() => familyEditFields(member?.edit ?? null), [member])
  const target = useMemo(() => clientTarget(client.client_key), [client.client_key])
  const apply = useApplyFor(target)
  const strip = <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
  if (!isNew && !member) {
    // a member hidden by this Apply leaves the list it was read from; its strip stays to the end
    if (apply.state.phase !== 'idle') return <div className="grid min-w-0 gap-4 pt-1" data-family-edit-panel={id}>{strip}</div>
    return <div className="grid gap-3 pt-1"><ReadLine state={profile} what="the family members" onRetry={profile.reload} />{profile.data && <Gone what="family member" name={client.name} />}</div>
  }
  const file = async (changes: EditChange[]) => editAnswerOf(await apply.run(
    () => editOverride({ client: client.client_key, kind: 'family', target: isNew ? '' : id, changes }),
    [CLIENT_REREAD.details(client.client_key)]))
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-family-edit-panel={id}>
      <RecordEditBody fields={fields} onDone={onDone} onFile={file} stay applyLabel={applyChanges}
        locked={apply.state.phase === 'running'}
        intro={`${client.name} · Kept in the Hub over the plan's important people: reading the plan again never overwrites it.`} />
      {strip}
    </div>
  )
}

/** A chart row's pencil and its removal from the eMAR list, the removal on the second press (its strip is the panel's). */
function MedActions({ row, onEdit, onRemove }: { row: RecordRow; onEdit: () => void; onRemove: () => void }) {
  const [armed, setArmed] = useState(false)
  const remove = () => {
    if (!armed) { setArmed(true); return }
    setArmed(false)
    onRemove()
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3" data-med-actions={row.id}>
      {armed && <button type="button" onClick={() => setArmed(false)} className="text-[12.5px] text-text-3 hover:text-text-1">Keep it</button>}
      <button type="button" onClick={remove} data-med-remove={armed ? 'armed' : ''}
        className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border px-3 text-[13px] text-[var(--danger)] hover:bg-surface-2">
        <Trash2 size={14} />
        {armed ? 'Remove — press again' : 'Remove from the chart'}
      </button>
      <button type="button" onClick={onEdit} data-med-edit="" aria-label="Edit medicine" title="Edit medicine"
        className="grid h-9 w-9 place-items-center rounded-full bg-primary text-white hover:bg-primary-hover">
        <Pencil size={15} />
      </button>
    </div>
  )
}

/** The chart row as the edit panel corrects it: only the changed cells, each witnessed (emarMedUpdate), through the Apply strip. */
export function MedEditBody({ client, row, edit, onDone }: { client: RosterRow; row: RecordRow; edit: Record<string, string>; onDone: () => void }) {
  const fields = useMemo(() => medEditFields(edit), [edit])
  const target = useMemo(() => clientTarget(client.client_key), [client.client_key])
  const apply = useApplyFor(target)
  const file = async (changes: EditChange[]) => editAnswerOf(await apply.run(
    () => editMedication(client.client_key, row.id, changes), [CLIENT_REREAD.meds(client.client_key)]))
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-med-edit-panel={row.id}>
      <RecordEditBody fields={fields} onFile={file} onDone={onDone} stay applyLabel={applyChanges}
        locked={apply.state.phase === 'running'}
        intro={`${row.record} · Written to the eMAR list. Only the fields you change are sent.`} />
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}

function ActivityDetail({ client, id }: { client: RosterRow; id: string }) {
  const read = useClientRead(readKey('clientProfileActivity', client.client_key), () => readActivity(client.client_key), activityOf)
  const r = read.data?.rows.find((x) => x.id === id) ?? null
  if (!r) return <div className="grid gap-3 pt-1"><ReadLine state={read} what="the activity" onRetry={read.reload} />{read.data && <Gone what="record" name={client.name} />}</div>
  return (
    <div className="grid gap-4 pt-1" data-activity-panel={r.id}>
      <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold text-text-1">{r.record || '—'}</span><StatusPill status={activityKindLabel(r.kind)} /></div>
      <dl className="grid gap-3">
        <Row label="When">{[dayLabel(r.at), ohioClockOf(r.at)].filter(Boolean).join(' · ') || '—'}</Row>
        {r.by && <Row label="By">{r.by}</Row>}
        {r.text ? <Row label="As written">{r.text}</Row> : r.details && <Row label="Details">{r.details}</Row>}
        {r.source && <Row label="Source">{r.source}</Row>}
      </dl>
    </div>
  )
}

/* ---------- incidents: the new and edit panels are Locations' own, at the client's house ---------- */

/** The house an incident panel files at: the incident's own house, else the code in the client's house name. */
function incidentHouse(client: RosterRow, code?: string): IncidentHouse | null {
  const c = String(code || codeIn(client.house) || '').trim().toUpperCase()
  return c ? { code: c, title: client.house || c } : null
}

/** The panels' writes for this client: decided by the Clients editions, Clients' Incidents read again. */
function useIncidentVia(client: string): PanelVia {
  return useMemo(() => ({ client, target: clientTarget(client), rereads: [CLIENT_REREAD.incidents(client)] }), [client])
}

/** A client's incident as Locations' edit panel takes it, from the row the client's read carries. */
const asLocationIncident = (r: IncidentRow, client: RosterRow): LocationIncident => ({
  id: r.id, yourName: r.your_name, client: r.client_name || client.name, clientKey: client.client_key,
  category: r.incident_category, categories: r.categories, location: r.incident_location, date: r.incident_date,
  time: r.incident_time, row: r.row,
})

function ClientIncidentNew({ client, onDone }: { client: RosterRow; onDone: () => void }) {
  const via = useIncidentVia(client.client_key)
  const house = incidentHouse(client)
  // a client whose house names no code files through the client's own form
  if (!house) return <NewIncidentForm client={client} onDone={onDone} />
  return <IncidentForm house={house} client={client.name} onDone={onDone} via={via} />
}

function IncidentDetail({ client, id }: { client: RosterRow; id: string }) {
  const read = useClientRead(readKey('clientProfileIncidents', client.client_key), () => readIncidents(client.client_key), clientIncidentsOf)
  // the master, or a holder of the Clients edition that edits a report (Settings › Editions)
  const edits = useClientCan('clients.incidentsEdit')
  const via = useIncidentVia(client.client_key)
  const [editing, setEditing] = useState(false)
  const r = read.data?.rows.find((x) => x.id === id) ?? null
  if (!r) return <div className="grid gap-3 pt-1"><ReadLine state={read} what="the incidents" onRetry={read.reload} />{read.data && <Gone what="incident" name={client.name} />}</div>
  const house = incidentHouse(client, r.house_code)
  // the row the edit door finds ("r42"), with the cells it witnesses
  const editable = edits && !!house && ROW_ID.test(r.id) && !!r.row.timestamp
  if (editing && editable && house) {
    return <IncidentEdit house={house} id={r.id} row={asLocationIncident(r, client)} via={via} onDone={() => setEditing(false)} />
  }
  const rows: [string, string][] = [
    ['Your name', r.your_name], ['Client', r.client_name || client.name], ['Category', r.categories.join(' · ')],
    ['Location', r.incident_location], ['Date and time', [dayLabel(r.incident_date), clockLabel(r.incident_time)].filter(Boolean).join(' · ')],
    ['Reported', [dayLabel(r.incident_reported_date), clockLabel(r.incident_reported_time)].filter(Boolean).join(' · ')],
    ['Employees involved', r.employees_involved.join(', ')], ['Summary of incident', r.summary_of_incident],
    ['Immediate action taken', r.immediate_action_taken], ['Cause and contributing factors', r.cause_and_contributing_factors],
    ['Prevention plan', r.prevention_plan],
  ]
  return (
    <div className="grid gap-4 pt-1" data-incident-panel={r.id}>
      {editable && <EditButton onClick={() => setEditing(true)} />}
      <StatusControl client={client} row={r} statuses={read.data?.statuses ?? []} />
      <dl className="grid gap-3 border-t border-border pt-3">{rows.filter(([, v]) => v).map(([k, v]) => <Row key={k} label={k}>{v}</Row>)}</dl>
    </div>
  )
}

/* ---------- billing ---------- */

// Add authorization: the spans Billing reads live in the Finances app's PAWS Adjustments book and the Client…
function AddAuthorization({ client }: { client: RosterRow }) {
  const read = useLocationRead(sourceKey('clientSourceBilling', client.client_key), () => readBilling(client.client_key), billingOf)
  const a = read.data
  const spans = a?.tabs.authorizations
  const books = (a?.sources ?? []).filter((s) => /PAWS|Sheet6|ISP span/i.test(s.name))
  return (
    <div className="grid gap-3 pt-1" data-add-authorization="">
      <p className="text-[13px] leading-5 text-text-2">
        An authorization for {client.name} is filed in the Finances app's PAWS Adjustments book (Internal Analysis) or the
        Client Database's Sheet6; the platform has no door that files one yet. Once it is there, it shows under Billing ›
        Authorizations on the next read.
      </p>
      {read.status === 'loading' && <p className="text-[12.5px] text-text-3" data-read="loading">Reading the authorizations…</p>}
      {read.status === 'failed' && !a && (
        <p role="alert" className="text-[12.5px] text-[var(--danger)]" data-read="failed">The authorizations could not be read: {financeRefusal(read.error)}</p>
      )}
      {spans && (
        <p className="text-[12.5px] text-text-3" data-spans={spans.rows.length}>
          {spans.why ? `Not everything could be read: ${spans.why}.` : `${spans.rows.length} span${spans.rows.length === 1 ? '' : 's'} on file now.`}
        </p>
      )}
      {books.length > 0 && (
        <ul className="grid gap-1 text-[12px] text-text-3" data-books="">
          {books.map((s) => <li key={s.name}>{s.name} · {s.app}{s.readable ? '' : ` · ${s.why}`}</li>)}
        </ul>
      )}
    </div>
  )
}
