// THE ONE RIGHT PANEL of Locations — a SidePanel whose mode switches: house notes, a new incident, a new house…
// It is an aside, never a dialog.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, Download, FileText, Link2, Loader2, Pencil, Printer, Search, Share2, UserMinus } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import RecordEditBody from '@/components/shared/RecordEditBody'
import SafeImg from '@/components/shared/SafeImg'
import { Checkbox } from '@/components/ui/checkbox'
import { editAnswerOf, type EditChange } from '@/lib/recordEdit'
import type { EditionId } from '@/lib/editions'
import { FileDropZone, SelectedFileCard, fileToBase64 } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { photoThumb, type HouseRow } from '@/pages/features/houses/houseModel'
import { PRIORITY_META, StatusStepper } from '@/pages/features/clientops/HouseRepairPage'
import { TintChip } from '@/pages/features/clientops/OpsPageShell'
import { BUCKET_LABEL, houseLabel, repairDay } from '@/lib/houseRepairAnalysis'
import { copyShare, downloadShare, nativeShareFor, printShare, shareBody, shareLink } from '@/lib/shareTargets'
import type { SharePayload } from '@/stores/useShareStore'
import { cn } from '@/lib/utils'
import {
  ASSET_FIELDS, HOUSE_DOC_ACCEPT, HOUSE_DOC_HINT, HOUSE_PHOTO_ACCEPT, HOUSE_PHOTO_HINT, INCIDENT_DETAIL_FIELDS, IST_NONE,
  NOT_OPEN, SUPPLY_KINDS, SUPPLY_REMOVED, assetDraft, assetEditFields, clientKeyOf, dayWords,
  documentsOf, driveLinkProblem, houseDocProblem, houseDocuments, houseEditFields, houseOwnDoc, housePhotoProblem,
  incidentClock, incidentDay, incidentsOf, istCellFor, nameKey, noteEditFields, notesOf, overviewOf,
  panelLabel, panelTitle, repairEditFields, repairTypes, repairsOf, staffOf, staffRole, suppliesOf, supplyEntryFields,
  supplyEntryOf, type LocationIncident, type PanelAsk,
} from './locationModel'
import {
  REREAD, addAsset, addClients, editAsset, editNote, editRepair, editSupplyEntry, housePhotoUrl,
  keepHousePhoto, linkDoc, readDocuments, readIncidents, readKey, readNotes, readOverview, readRepairs, readStaff,
  readSupplies, removeDoc, removeStaff, saveHouse, uploadDoc, useLocationDoc, useLocationRead, useLocationViewer, viewerCan,
} from './useLocation'
import { readAddableClients } from './locationReads'
import type { ClientIdentity } from './locationLanes'
import { IncidentEditForm, IncidentForm, NotesBody, RepairForm, SupplyForm } from './LocationForms'
import IstTrainForm from './IstTrainForm'
import { DraftButtons, ReadLine, SourceBadge } from './LocationParts'
import ApplyStrip, { useApply, type PanelVia } from './ApplyStrip'
import { CELL_BTN, IstButton, istDocMeta } from './tabs/Staff'

/** The second press of every edition's form. */
export const APPLY_LABEL = 'Apply'
const applyChanges = (n: number) => `Apply ${n} change${n === 1 ? '' : 's'}`
// Edit house alone opens wider than the standard panel, at the operator's word (11-02: "aumente esse único side bar")
const HOUSE_EDIT_WIDTH = 600

export default function LocationPanel({ ask, house, houses, share, onAsk, onClose }: {
  ask: PanelAsk | null
  house: HouseRow
  /** every location, for a form that picks one (New House Repair) */
  houses?: HouseRow[]
  share: SharePayload
  onAsk: (ask: PanelAsk | null) => void
  onClose: () => void
}) {
  return (
    <SidePanel open={!!ask} onClose={onClose} label={ask ? panelLabel(ask) : 'Locations'}
      title={ask ? panelTitle(ask, house) : ''} widthPx={ask?.kind === 'house' ? HOUSE_EDIT_WIDTH : undefined}>
      {ask && <PanelBody key={`${house.code}|${JSON.stringify(ask)}`} ask={ask} house={house} houses={houses}
        share={share} onAsk={onAsk} onClose={onClose} />}
    </SidePanel>
  )
}

export function PanelBody({ ask, house, houses, share, onAsk, onClose }: {
  ask: PanelAsk
  house: HouseRow
  houses?: HouseRow[]
  share: SharePayload
  onAsk: (ask: PanelAsk | null) => void
  onClose: () => void
}) {
  const viewer = useLocationViewer()
  const can = (e: EditionId) => viewerCan(viewer, e)
  // a form is only the viewer's whose edition it is; notes and the calendar are never a client's or a family member's
  const shut = (ask.kind === 'incident' && !can('locations.incidents') && !can('locations.incidentsNew')) ||
    ((ask.kind === 'repair' || ask.kind === 'supply' || ask.kind === 'house' || ask.kind === 'supply-entry' ||
      ask.kind === 'house-photo') && !can('locations.house')) ||
    ((ask.kind === 'asset' || ask.kind === 'asset-add') && !can('locations.assets')) ||
    (ask.kind === 'note' && !can('locations.notesAny') && !can('locations.house')) ||
    (ask.kind === 'staff-back' && !can('locations.staffRemove')) ||
    ((ask.kind === 'doc-link' || ask.kind === 'doc-upload' || ask.kind === 'doc-remove') && !can('locations.documents')) ||
    (ask.kind === 'clients-add' && !can('locations.clientsAdd')) ||
    (viewer.cut && ask.kind === 'notes')
  if (shut) return <p className="pt-1 text-[13px] text-text-3" data-not-open="">{NOT_OPEN}</p>
  switch (ask.kind) {
    case 'notes': return <NotesBody house={house} onDone={onClose} onEdit={(id) => onAsk({ kind: 'note', id })} />
    case 'incident': return <IncidentForm house={house} onDone={onClose} />
    case 'repair': return <RepairForm house={house} houses={houses} onDone={onClose} />
    case 'supply': return (
      <>
        <SupplyForm house={house} entry={ask.entry} item={ask.item} onDone={onClose} />
        {ask.item && <SupplyEntries house={house} item={ask.item} onAsk={onAsk} />}
      </>
    )
    case 'house': return <HouseEdit house={house} onDone={onClose} />
    case 'note': return <NoteEdit house={house} id={ask.id} onDone={() => onAsk({ kind: 'notes' })} />
    case 'supply-entry': return <SupplyEntryEdit house={house} id={ask.id} onDone={onClose} />
    case 'share': return <ShareBody payload={share} />
    case 'staff': return <StaffBody house={house} name={ask.name} onAsk={onAsk} />
    case 'ist': return <IstBody house={house} staff={ask.staff} client={ask.client} onClose={onClose} />
    case 'repair-row': return <RepairDetail house={house} id={ask.id} />
    case 'incident-row': return <IncidentDetail house={house} id={ask.id} />
    case 'staff-back': return <StaffBackBody house={house} name={ask.name} onDone={onClose} />
    case 'doc-link': return <DocLinkBody house={house} onDone={onClose} />
    case 'doc-upload': return <DocUploadBody house={house} onDone={onClose} />
    case 'doc-remove': return <DocRemoveBody house={house} id={ask.id} onDone={onClose} />
    case 'clients-add': return <ClientsAddBody house={house} onDone={onClose} />
    case 'asset': return <AssetEdit house={house} id={ask.id} onDone={onClose} />
    case 'asset-add': return <AssetAdd house={house} onDone={onClose} />
    case 'house-photo': return <HousePhotoBody house={house} onDone={onClose} />
  }
}

/* ---------- read-only bodies ---------- */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-text-1">{children}</dd>
    </div>
  )
}

function StaffBody({ house, name, onAsk }: { house: HouseRow; name: string; onAsk: (ask: PanelAsk | null) => void }) {
  const staff = useLocationRead(readKey('locationStaff', house.code), () => readStaff(house.code), staffOf)
  const doc = useLocationDoc(house.code)
  const remove = viewerCan(useLocationViewer(), 'locations.staffRemove')
  const apply = useApply(house.code)
  const [armed, setArmed] = useState(false)
  const m = staff.data?.rows.find((r) => r.name === name) ?? null
  const clients: { name: string }[] = staff.data?.clients.length ? staff.data.clients : house.clients
  const takeOff = async () => {
    if (!armed) { setArmed(true); return }
    setArmed(false)
    try {
      await apply.run(() => removeStaff(house.code, name), [REREAD.staff(house.code)])
    } catch { /* the strip says why */ }
  }
  if (apply.state.phase !== 'idle') {
    return (
      <div className="grid gap-4 pt-1" data-staff-panel={name}>
        <p className="text-[13px] text-text-2">Taking {name} off {house.title}'s Staff list. Their staff record is not touched.</p>
        <ApplyStrip state={apply.state} onDone={() => onAsk(null)} onAgain={apply.reset} />
      </div>
    )
  }
  return (
    <div className="grid gap-4 pt-1" data-staff-panel={name}>
      <ReadLine state={staff} what="the house's staff" onRetry={staff.reload} />
      {staff.data && !m && <p className="text-[12.5px] text-text-3">{name} is not on record for {house.title}.</p>}
      {m && (
        <>
          {staffRole(m) && <p className="text-[13px] text-text-2">{staffRole(m)}</p>}
          <dl className="grid gap-3">
            <Row label="First shift">
              {dayWords(m.first.day) || '—'} <SourceBadge source={m.first.source} />
            </Row>
            <Row label="Latest shift">
              {dayWords(m.last.day) || '—'} <SourceBadge source={m.last.source} />
            </Row>
            <Row label="Shifts on record">{m.shifts ?? '—'}</Row>
          </dl>
          {clients.length > 0 && (
            <div className="grid gap-2 border-t border-border pt-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">IST</h3>
              {clients.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-text-1">{c.name}</span>
                  <IstButton m={m} client={c.name} onAsk={onAsk} doc={doc} />
                </div>
              ))}
            </div>
          )}
          {remove && (
            <div className="grid gap-2 border-t border-border pt-3" data-staff-remove={name}>
              <p className="text-[12.5px] text-text-3">
                Taking {name} off this house removes them from its Staff list only: their staff record, their shifts
                and the house's history stay exactly as they are, and they can be put back.
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {armed && <button type="button" onClick={() => setArmed(false)} className="text-[12.5px] text-text-3 hover:text-text-1">Keep {name}</button>}
                <button type="button" onClick={() => void takeOff()} data-press={armed ? 'apply' : 'review'}
                  className={cn('inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold',
                    armed ? 'bg-danger text-white' : 'border border-border bg-surface text-danger hover:bg-surface-2')}>
                  <UserMinus size={14} /> {armed ? `${APPLY_LABEL} — take ${name} off` : 'Take off this house'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function IstBody({ house, staff, client, onClose }: { house: HouseRow; staff: string; client: string; onClose: () => void }) {
  const writes = viewerCan(useLocationViewer(), 'locations.house')
  const read = useLocationRead(readKey('locationStaff', house.code), () => readStaff(house.code), staffOf)
  const doc = useLocationDoc(house.code)
  const m = read.data?.rows.find((r) => r.name === staff) ?? null
  const cell = m ? istCellFor(m, client) : null
  const busy = cell?.kind === 'paper' && doc.opening === cell.fileId
  return (
    <div className="grid gap-4 pt-1" data-ist-panel="">
      <ReadLine state={read} what="the house's staff" onRetry={read.reload} />
      {cell?.kind === 'paper' && (
        <>
          <p className="text-[13px] text-text-2">The IST paper on file{cell.at ? `, trained ${dayWords(cell.at)}` : ''}.</p>
          <button type="button" className={cn(CELL_BTN, 'justify-self-start')} data-ist="paper" disabled={busy} aria-busy={busy || undefined}
            onClick={() => doc.open(cell.fileId, istDocMeta(staff, client, cell.at))}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} View the IST paper
          </button>
          {writes && <h3 className="border-t border-border pt-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Update the training</h3>}
        </>
      )}
      {cell?.kind === 'trained' && <p className="text-[13px] text-text-2">Trained{cell.at ? ` ${dayWords(cell.at)}` : ''}.</p>}
      {cell?.kind === 'upload' && <p className="text-[13px] text-text-2">{staff} is not recorded as trained on {client} yet.</p>}
      {cell?.kind === 'none' && <p className="text-[13px] text-text-2" data-ist-none="">{IST_NONE}</p>}
      {writes && read.data && (
        <IstTrainForm house={house} employees={read.data.employees} staff={staff} client={client} onDone={onClose}
          clients={(read.data.clients.length ? read.data.clients : house.clients).map((c) => c.name)} />
      )}
    </div>
  )
}

function RepairDetail({ house, id }: { house: HouseRow; id: string }) {
  // the open list first; the list with the resolved is read only when the row is not open
  const open = useLocationRead(readKey('locationRepairs', house.code, false), () => readRepairs(house.code, false), repairsOf)
  const inOpen = open.data?.find((x) => x.id === id) ?? null
  const all = useLocationRead(open.data && !inOpen ? readKey('locationRepairs', house.code, true) : null,
    () => readRepairs(house.code, true), repairsOf)
  const r = inOpen ?? all.data?.find((x) => x.id === id) ?? null
  const writes = viewerCan(useLocationViewer(), 'locations.house')
  const [editing, setEditing] = useState(false)
  const apply = useApply(house.code)
  const types = useMemo(() => repairTypes([...(open.data ?? []), ...(all.data ?? [])]), [open.data, all.data])
  if (r && editing) {
    return (
      <div className="grid min-w-0 gap-4 pt-1" data-edit-panel="repair">
        <RecordEditBody fields={repairEditFields(r, types)} onDone={() => setEditing(false)} stay applyLabel={applyChanges}
          locked={apply.state.phase === 'running'}
          onFile={async (changes) => editAnswerOf(await apply.run(() => editRepair(house.code, r.id, changes),
            [REREAD.repairs(house.code)]))} />
        <ApplyStrip state={apply.state} onDone={() => { apply.reset(); setEditing(false) }} onAgain={apply.reset} />
      </div>
    )
  }
  if (!r) {
    return (
      <div className="grid gap-3 pt-1">
        {open.data ? <ReadLine state={all} what="the house repairs" onRetry={all.reload} />
          : <ReadLine state={open} what="the house repairs" onRetry={open.reload} />}
        {all.data && <p className="text-[12.5px] text-text-3">This request is no longer listed for {house.title}.</p>}
      </div>
    )
  }
  const prio = r.priority ? PRIORITY_META[r.priority] : null
  const bucket = r.bucket === 'other' ? r.status : BUCKET_LABEL[r.bucket]
  return (
    <div className="grid gap-4 pt-1" data-repair-panel={r.id}>
      <div className="flex flex-wrap items-center gap-2">
        {r.repairType && <TintChip label={r.repairType} tint="blue" />}
        {prio && <TintChip label={prio.label} tint={prio.tint} />}
        {r.wholeEstate && <TintChip label="Whole estate" tint="violet" />}
        {writes && ROW_ID.test(r.id) && <EditButton onClick={() => setEditing(true)} />}
      </div>
      <StatusStepper stage={r.stage} onHold={r.onHold} cancelled={r.cancelled} other={r.bucket === 'other' ? r.status : ''} tint="slate" />
      <dl className="grid gap-3">
        <Row label="House or vehicle">{houseLabel(r.house)}</Row>
        <Row label="Reported">{repairDay(r.reported)}</Row>
        <Row label="Status">{bucket}</Row>
        <Row label="Urgency">{r.urgency !== null ? `${r.urgency} of 5` : r.urgencyRaw || '—'}</Row>
        <Row label="The issue">{r.issue || '—'}</Row>
        {r.resolution && <Row label="Resolution notes">{r.resolution}</Row>}
      </dl>
    </div>
  )
}

/** The house an incident panel needs: its code, its name, and its clients when the list is at hand. */
export type IncidentHouse = Pick<HouseRow, 'code' | 'title'> & Partial<Pick<HouseRow, 'clients'>>

/** One incident's edit, in the New Incident form (LocationForms' IncidentEditForm) — also opened from a client's
 * Incidents (Clients), with the row that read carries (`row`) and `via`: edited for that client, Clients read again. */
export function IncidentEdit({ house, id, onDone, row, via }: {
  house: IncidentHouse; id: string; onDone: () => void; row?: LocationIncident; via?: PanelVia
}) {
  const incidents = useLocationRead(row ? null : readKey('locationIncidents', house.code), () => readIncidents(house.code), incidentsOf)
  const r = row ?? incidents.data?.find((x) => x.id === id) ?? null
  if (!r) {
    return (
      <div className="grid gap-3 pt-1">
        <ReadLine state={incidents} what="the incidents" onRetry={incidents.reload} />
        {incidents.data && <p className="text-[12.5px] text-text-3">This incident is no longer listed for {house.title}.</p>}
      </div>
    )
  }
  return <IncidentEditForm house={house} row={r} client={via ? r.client : undefined} via={via} onDone={onDone} />
}

function IncidentDetail({ house, id }: { house: HouseRow; id: string }) {
  const incidents = useLocationRead(readKey('locationIncidents', house.code), () => readIncidents(house.code), incidentsOf)
  const r = incidents.data?.find((x) => x.id === id) ?? null
  const writes = viewerCan(useLocationViewer(), 'locations.incidents')
  const [editing, setEditing] = useState(false)
  if (r && editing) return <IncidentEdit house={house} id={id} onDone={() => setEditing(false)} />
  if (!r) {
    return (
      <div className="grid gap-3 pt-1">
        <ReadLine state={incidents} what="the incidents" onRetry={incidents.reload} />
        {incidents.data && <p className="text-[12.5px] text-text-3">This incident is no longer listed for {house.title}.</p>}
      </div>
    )
  }
  return (
    <div className="grid gap-4 pt-1" data-incident-panel={r.id}>
      {writes && ROW_ID.test(r.id) && <EditButton onClick={() => setEditing(true)} />}
      <dl className="grid gap-3">
        <Row label="Your name">{r.yourName || '—'}</Row>
        <Row label="Client">{r.client || '—'}</Row>
        <Row label="Category">{r.categories.join(' · ') || '—'}</Row>
        <Row label="Location">{r.location || '—'}</Row>
        <Row label="Date and time">{[incidentDay(r.date), incidentClock(r.time)].filter((x) => x && x !== '—').join(' · ') || '—'}</Row>
        {INCIDENT_DETAIL_FIELDS.filter((f) => r.row[f.key]).map((f) => <Row key={f.key} label={f.label}>{r.row[f.key]}</Row>)}
      </dl>
    </div>
  )
}

/* ---------- the edits: each an edition, in this panel (RecordEditBody), applied through the strip ---------- */

/** An estate row the update door can find: "r42". */
export const ROW_ID = /^r\d+$/

export function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-edit-open="" aria-label="Edit" title="Edit"
      className="ml-auto grid h-8 w-8 place-items-center justify-self-end rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1">
      <Pencil size={14} />
    </button>
  )
}

/** Who files, as the doors name a writer: the signed-in account's own name. */
const useWriterName = (): string => useAuthStore((s) => s.user?.name || s.user?.email || '')

function HouseEdit({ house, onDone }: { house: HouseRow; onDone: () => void }) {
  const overview = useLocationRead(readKey('locationOverview', house.code), () => readOverview(house.code), overviewOf)
  const apply = useApply(house.code)
  const o = overview.data
  const fields = useMemo(() => (o ? houseEditFields(o, house) : []), [o, house])
  const onRegistry = !!o && Object.keys(o.edit).length > 0
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-panel="house">
      <ReadLine state={overview} what="the house details" onRetry={overview.reload} />
      {o && !onRegistry && (
        <p className="text-[12.5px] text-text-3">{o.registryWhy || 'The house registry has no row for this house.'}</p>
      )}
      {o && onRegistry && (
        <RecordEditBody fields={fields} onDone={onDone} stay applyLabel={applyChanges} locked={apply.state.phase === 'running'}
          onFile={async (changes) => editAnswerOf(await apply.run(() => saveHouse(house.code, o.edit.home_name ?? '', changes),
            [REREAD.overview(house.code)]))}
          intro="Saved to the house registry. Only the fields you change are sent." />
      )}
      <ApplyStrip state={apply.state} onDone={onDone} onAgain={apply.reset} />
    </div>
  )
}

function NoteEdit({ house, id, onDone }: { house: HouseRow; id: string; onDone: () => void }) {
  const notes = useLocationRead(readKey('locationNotes', house.code), () => readNotes(house.code), notesOf)
  const overview = useLocationRead(readKey('locationOverview', house.code), () => readOverview(house.code), overviewOf)
  const anyone = viewerCan(useLocationViewer(), 'locations.notesAny')
  const me = useWriterName()
  const apply = useApply(house.code)
  const n = notes.data?.find((x) => x.id === id) ?? null
  const choices = useMemo(() => (overview.data?.clients.length
    ? overview.data.clients.map((c) => ({ key: c.client_key, name: c.name }))
    : house.clients.map((c) => ({ key: clientKeyOf(c), name: c.name }))), [overview.data, house.clients])
  const fields = useMemo(() => (n ? noteEditFields(n, choices) : []), [n, choices])
  const [armed, setArmed] = useState(false)
  const running = apply.state.phase === 'running'
  const remove = async () => {
    if (!n) return
    if (!armed) { setArmed(true); return }
    setArmed(false)
    try {
      await apply.run(() => editNote(house.code, n.id, [{ field: 'state', value: 'removed', expected: n.state }]),
        [REREAD.notes(house.code)])
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: e instanceof Error ? e.message : String(e) })
    }
  }
  // the house edition edits its writer's own note; anyone's is its own edition
  const theirs = !!n && !anyone && n.by !== me
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-panel="note">
      <ReadLine state={notes} what="the house notes" onRetry={notes.reload} />
      {notes.data && !n && apply.state.phase === 'idle' && (
        <p className="text-[12.5px] text-text-3">This note is no longer listed for {house.title}.</p>
      )}
      {theirs && (
        <p className="text-[12.5px] text-text-3" data-note-theirs="">
          {n.by || 'Somebody else'} wrote this note. Editing a note written by anyone is its own edition, and it is not yours.
        </p>
      )}
      {n && !theirs && (
        <>
          <RecordEditBody fields={fields} onDone={onDone} stay applyLabel={applyChanges} locked={running}
            onFile={async (changes: EditChange[]) => editAnswerOf(await apply.run(() => editNote(house.code, n.id, changes),
              [REREAD.notes(house.code)]))} />
          <button type="button" disabled={running} onClick={() => void remove()} onBlur={() => setArmed(false)} data-remove-note={n.id}
            className={cn('justify-self-start rounded-md px-2 py-1 text-[12.5px] font-semibold',
              armed ? 'bg-danger text-white' : 'text-danger hover:bg-surface-2')}>
            {armed ? `${APPLY_LABEL} — remove the note` : 'Remove note'}
          </button>
        </>
      )}
      <ApplyStrip state={apply.state} onDone={onDone} onAgain={apply.reset} />
    </div>
  )
}

function SupplyEntryEdit({ house, id, onDone }: { house: HouseRow; id: string; onDone: () => void }) {
  const supplies = useLocationRead(readKey('locationSupplies', house.code), () => readSupplies(house.code), suppliesOf)
  const apply = useApply(house.code)
  const e = supplyEntryOf(supplies.data, id)
  const open = supplies.data?.entryFields
  const fields = useMemo(() => (e ? supplyEntryFields(e, open) : []), [e, open])
  const [armed, setArmed] = useState(false)
  const running = apply.state.phase === 'running'
  // a mistaken entry leaves the ledger's lists; its row stays on the sheet
  const remove = async () => {
    if (!e) return
    if (!armed) { setArmed(true); return }
    setArmed(false)
    try {
      await apply.run(() => editSupplyEntry(house.code, e.id, [{ field: 'kind', value: SUPPLY_REMOVED, expected: e.kind }]),
        [REREAD.supplies(house.code)])
    } catch { /* the strip says why */ }
  }
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-panel="supply-entry">
      <ReadLine state={supplies} what="the house supplies" onRetry={supplies.reload} />
      {supplies.data && !e && apply.state.phase === 'idle' && (
        <p className="text-[12.5px] text-text-3">This entry is no longer on {house.title}'s ledger.</p>
      )}
      {e && (
        <>
          <RecordEditBody fields={fields} onDone={onDone} stay applyLabel={applyChanges} locked={running}
            onFile={async (changes) => editAnswerOf(await apply.run(() => editSupplyEntry(house.code, e.id, changes),
              [REREAD.supplies(house.code)]))}
            intro={`${dayWords(e.at) || e.at}${e.by ? ` · ${e.by}` : ''}. Only the fields you change are sent.`} />
          {supplies.data?.entryRemove && apply.state.phase === 'idle' && (
            <button type="button" disabled={running} onClick={() => void remove()} onBlur={() => setArmed(false)}
              data-remove-entry={e.id}
              className={cn('justify-self-start rounded-md px-2 py-1 text-[12.5px] font-semibold',
                armed ? 'bg-danger text-white' : 'text-danger hover:bg-surface-2')}>
              {armed ? `${APPLY_LABEL} — remove the entry` : 'Remove entry'}
            </button>
          )}
        </>
      )}
      <ApplyStrip state={apply.state} onDone={onDone} onAgain={apply.reset} />
    </div>
  )
}

/* ---------- the Staff, Documents and Associated clients editions ---------- */

/** An edition's form with nothing to type: what it does, then Apply on the second press, then the strip. */
function ApplyOnly({ apply, intro, armedLabel, disabled = false, onApply, onDone }: {
  apply: ReturnType<typeof useApply>
  intro?: ReactNode
  armedLabel: string
  disabled?: boolean
  onApply: () => Promise<unknown>
  onDone: () => void
}) {
  const [armed, setArmed] = useState(false)
  const press = async () => {
    if (!armed) { setArmed(true); return }
    setArmed(false)
    try { await onApply() } catch { /* the strip says why */ }
  }
  return (
    <>
      {apply.state.phase === 'idle' && (
        <>
          {intro && <div className="text-[13px] leading-5 text-text-2">{intro}</div>}
          <DraftButtons armed={armed} busy={false} disabled={disabled} label="Review" armedLabel={armedLabel}
            onPress={() => void press()} onDisarm={() => setArmed(false)} onCancel={onDone} />
        </>
      )}
      <ApplyStrip state={apply.state} onDone={onDone} onAgain={apply.reset} />
    </>
  )
}

function StaffBackBody({ house, name, onDone }: { house: HouseRow; name: string; onDone: () => void }) {
  const apply = useApply(house.code)
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-staff-back={name}>
      <ApplyOnly apply={apply} onDone={onDone} armedLabel={`${APPLY_LABEL} — put ${name} back`}
        intro={<>Put <strong>{name}</strong> back on {house.title}'s Staff list. Their record was never touched.</>}
        onApply={() => apply.run(() => removeStaff(house.code, name, true), [REREAD.staff(house.code)])} />
    </div>
  )
}

function DocLinkBody({ house, onDone }: { house: HouseRow; onDone: () => void }) {
  const apply = useApply(house.code)
  const [link, setLink] = useState('')
  const problem = driveLinkProblem(link)
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-doc-link="">
      {apply.state.phase === 'idle' && (
        <label className="grid gap-1.5">
          <span className="text-[12px] font-medium text-text-2">Google Drive link</span>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/file/d/…"
            data-doc-link-input="" className="h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary" />
          {link.trim() && problem && <span className="text-[11.5px] text-danger">{problem}</span>}
        </label>
      )}
      <ApplyOnly apply={apply} onDone={onDone} armedLabel={APPLY_LABEL} disabled={!!problem}
        intro={<>A copy is filed in {house.title}'s own folder in the houses room, owned by the platform. The original stays where it is.</>}
        onApply={() => apply.run(() => linkDoc(house.code, link.trim()), [REREAD.documents(house.code)])} />
    </div>
  )
}

function DocUploadBody({ house, onDone }: { house: HouseRow; onDone: () => void }) {
  const apply = useApply(house.code)
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState('')
  const pick = (f: File) => {
    const why = houseDocProblem({ name: f.name, size: f.size })
    setProblem(why)
    setFile(why ? null : f)
  }
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-doc-upload="">
      {apply.state.phase === 'idle' && (file
        ? <SelectedFileCard file={file} onRemove={() => setFile(null)} />
        : <FileDropZone accept={HOUSE_DOC_ACCEPT} hint={HOUSE_DOC_HINT} onFile={pick} />)}
      {problem && apply.state.phase === 'idle' && <p className="text-[12.5px] text-danger">{problem}</p>}
      <ApplyOnly apply={apply} onDone={onDone} armedLabel={APPLY_LABEL} disabled={!file}
        intro={<>The file is filed in {house.title}'s own folder in the houses room, owned by the platform.</>}
        onApply={async () => {
          if (!file) return
          const b64 = await fileToBase64(file)
          return apply.run(() => uploadDoc(house.code, { name: file.name, mime: file.type, b64 }), [REREAD.documents(house.code)])
        }} />
    </div>
  )
}

function DocRemoveBody({ house, id, onDone }: { house: HouseRow; id: string; onDone: () => void }) {
  const docs = useLocationRead(readKey('locationDocuments', house.code), () => readDocuments(house.code), documentsOf)
  const apply = useApply(house.code)
  const d = houseDocuments(house, docs.data).find((x) => x.fileId === id) ?? null
  const own = !!d && houseOwnDoc(d)
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-doc-remove={id}>
      {apply.state.phase === 'idle' && <ReadLine state={docs} what="the house's documents" onRetry={docs.reload} />}
      {docs.data && !d && apply.state.phase === 'idle' && (
        <p className="text-[12.5px] text-text-3">This document is no longer listed for {house.title}.</p>
      )}
      {d && !own && (
        <p className="text-[12.5px] text-text-3">
          {d.type === 'ISP' ? 'An ISP is the client\'s own plan; it changes in Clients, never from a house.'
            : 'A company document applies to every location; it changes in Common Data, never from one house.'}
        </p>
      )}
      {(own || apply.state.phase !== 'idle') && (
        <ApplyOnly apply={apply} onDone={onDone} armedLabel={`${APPLY_LABEL} — remove it`}
          intro={<><strong>{d?.title ?? 'The document'}</strong> moves out of {house.title}'s folder into "Removed from Locations" in the houses room — never to the trash.</>}
          onApply={() => apply.run(() => removeDoc(house.code, id), [REREAD.documents(house.code)])} />
      )}
    </div>
  )
}

function ClientsAddBody({ house, onDone }: { house: HouseRow; onDone: () => void }) {
  const apply = useApply(house.code)
  const [offered, setOffered] = useState<ClientIdentity[] | null>(null)
  const [why, setWhy] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    let live = true
    readAddableClients()
      .then((list) => { if (live) setOffered(list.filter((c) => !house.clients.some((h) => nameKey(h.name) === nameKey(c.name)))) })
      .catch((e: unknown) => { if (live) setWhy(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [house.clients])
  const shown = (offered ?? []).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()))
  const names = (offered ?? []).filter((c) => picked.includes(c.client_key)).map((c) => c.name)
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-clients-add="">
      {apply.state.phase === 'idle' && (
        <>
          <p className="text-[12.5px] text-text-3">
            Current clients placed in no house. {house.title}'s own clients are never taken off, and a client of another
            house is not offered — adding them here would take them off theirs.
          </p>
          {offered === null && !why && <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Reading the clients…</p>}
          {why && <p role="alert" className="text-[12.5px] text-[var(--danger)]">The clients could not be read: {why}</p>}
          {offered && (
            <>
              <label className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-bg px-3 focus-within:border-primary">
                <Search size={14} className="text-text-3" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" aria-label="Search clients"
                  className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3" />
              </label>
              <div className="grid gap-1.5" data-clients-offered={offered.length}>
                {shown.map((c) => (
                  <label key={c.client_key} className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2"
                    data-client-offer={c.client_key}>
                    <Checkbox checked={picked.includes(c.client_key)} aria-label={`Add ${c.name}`}
                      onCheckedChange={(v) => setPicked((p) => (v === true ? [...p.filter((k) => k !== c.client_key), c.client_key]
                        : p.filter((k) => k !== c.client_key)))} />
                    {/* the name over its address, each cut inside the panel: a long address never widens it */}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-text-1">{c.name}</span>
                      {c.home_address && <span className="block truncate text-[12px] text-text-3">{c.home_address}</span>}
                    </span>
                  </label>
                ))}
                {!offered.length && <p className="text-[13px] text-text-3">No current client is placed in no house.</p>}
              </div>
            </>
          )}
        </>
      )}
      <ApplyOnly apply={apply} onDone={onDone} armedLabel={`${APPLY_LABEL} — add ${picked.length}`} disabled={!picked.length}
        intro={names.length ? <>Adding to {house.title}: {names.join(', ')}.</> : <>Choose the clients to add.</>}
        onApply={() => apply.run(() => addClients(house.code, picked), [REREAD.overview(house.code), REREAD.staff(house.code)])} />
    </div>
  )
}

/* ---------- House assets (House Supplies' own inventory) and the house photo ---------- */

function AssetEdit({ house, id, onDone }: { house: HouseRow; id: string; onDone: () => void }) {
  const supplies = useLocationRead(readKey('locationSupplies', house.code), () => readSupplies(house.code), suppliesOf)
  const apply = useApply(house.code)
  const a = supplies.data?.assets.find((x) => x.id === id) ?? null
  const fields = useMemo(() => (a ? assetEditFields(a) : []), [a])
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-panel="asset">
      <ReadLine state={supplies} what="the house assets" onRetry={supplies.reload} />
      {supplies.data && !a && <p className="text-[12.5px] text-text-3">This asset is no longer listed for {house.title}.</p>}
      {a && (
        <RecordEditBody fields={fields} onDone={onDone} stay applyLabel={applyChanges} locked={apply.state.phase === 'running'}
          onFile={async (changes) => editAnswerOf(await apply.run(() => editAsset(house.code, a.id, changes),
            [REREAD.supplies(house.code)]))}
          intro="Saved to the asset's row on the House Supplies inventory. Only the fields you change are sent." />
      )}
      <ApplyStrip state={apply.state} onDone={onDone} onAgain={apply.reset} />
    </div>
  )
}

function AssetAdd({ house, onDone }: { house: HouseRow; onDone: () => void }) {
  const apply = useApply(house.code)
  const [values, setValues] = useState<Record<string, string>>({})
  const draft = assetDraft(values)
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-asset-add="">
      {apply.state.phase === 'idle' && ASSET_FIELDS.map((f) => (
        <label key={f.key} className="grid gap-1.5">
          <span className="text-[12px] font-medium text-text-2">{f.label}{f.key === 'item' ? ' (required)' : ''}</span>
          <input value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            data-asset-field={f.key} className="h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary" />
        </label>
      ))}
      <ApplyOnly apply={apply} onDone={onDone} armedLabel={APPLY_LABEL} disabled={typeof draft === 'string'}
        intro={<>Added to the House Supplies inventory at {house.title}'s own street. An asset is never removed from here.</>}
        onApply={async () => {
          if (typeof draft === 'string') return
          return apply.run(() => addAsset(house.code, draft), [REREAD.supplies(house.code)])
        }} />
    </div>
  )
}

function HousePhotoBody({ house, onDone }: { house: HouseRow; onDone: () => void }) {
  const overview = useLocationRead(readKey('locationOverview', house.code), () => readOverview(house.code), overviewOf)
  const apply = useApply(house.code)
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState('')
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const o = overview.data
  const onRegistry = !!o && Object.keys(o.edit).length > 0
  const pick = (f: File) => {
    const why = housePhotoProblem({ name: f.name, size: f.size, type: f.type })
    setProblem(why)
    setFile(why ? null : f)
  }
  // the picture is kept on the relay first; the registry row then names it, and every reader of the house shows it
  const replace = async () => {
    if (!file || !o) return
    return apply.run(async () => {
      const kept = await keepHousePhoto(house.code, { name: file.name, mime: file.type, b64: await fileToBase64(file) })
      const answer = await saveHouse(house.code, o.edit.home_name ?? '',
        [{ field: 'thumbnail_url', value: housePhotoUrl(kept.path), expected: o.edit.thumbnail_url ?? '' }])
      const said = editAnswerOf(answer)
      if (!said.written.includes('thumbnail_url')) throw new Error(said.refused[0]?.why || 'The house registry did not take the photo.')
      return answer
    }, [REREAD.overview(house.code)])
  }
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-house-photo-panel="">
      <ReadLine state={overview} what="the house details" onRetry={overview.reload} />
      {o && !onRegistry && (
        <p className="text-[12.5px] text-text-3">{o.registryWhy || 'The house registry has no row for this house.'} The photo is named on that row.</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <figure className="grid gap-1.5">
          <SafeImg src={house.photo?.src ? photoThumb(house.photo.src, 640) : ''} icon="house" shape="square" size="h-32 w-full"
            alt={`${house.title} now`} />
          <figcaption className="text-[11.5px] text-text-3">Now</figcaption>
        </figure>
        <figure className="grid gap-1.5">
          {preview
            ? <img src={preview} alt="The new photo" data-photo-preview="" className="h-32 w-full rounded-lg object-cover" />
            : <div className="grid h-32 place-items-center rounded-lg border border-dashed border-border text-[12px] text-text-3">No picture chosen</div>}
          <figcaption className="text-[11.5px] text-text-3">New</figcaption>
        </figure>
      </div>
      {apply.state.phase === 'idle' && (file
        ? <SelectedFileCard file={file} onRemove={() => setFile(null)} />
        : <FileDropZone accept={HOUSE_PHOTO_ACCEPT} hint={HOUSE_PHOTO_HINT} onFile={pick} />)}
      {problem && apply.state.phase === 'idle' && <p className="text-[12.5px] text-danger">{problem}</p>}
      {(onRegistry || apply.state.phase !== 'idle') && (
        <ApplyOnly apply={apply} onDone={onDone} armedLabel={APPLY_LABEL} disabled={!file} onApply={replace} />
      )}
    </div>
  )
}

/** The item's lines on the ledger, each correctable in its own panel. */
function SupplyEntries({ house, item, onAsk }: { house: HouseRow; item: string; onAsk: (ask: PanelAsk) => void }) {
  const supplies = useLocationRead(readKey('locationSupplies', house.code), () => readSupplies(house.code), suppliesOf)
  const entries = supplies.data?.consumables.find((c) => c.item === item)?.entries ?? []
  if (!entries.length) return null
  return (
    <div className="mt-5 grid gap-2 border-t border-border pt-4" data-supply-entries="">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">On the ledger</h3>
      <ul className="grid gap-1.5">
        {entries.map((x) => (
          <li key={x.id} className="flex items-center gap-2 text-[12.5px] text-text-2" data-supply-entry={x.id}>
            <span className="min-w-0 flex-1 truncate">
              {SUPPLY_KINDS.find((k) => k.id === x.kind)?.label ?? x.kind} · {x.qty} · {dayWords(x.at) || '—'}{x.note ? ` · ${x.note}` : ''}
            </span>
            <button type="button" onClick={() => onAsk({ kind: 'supply-entry', id: x.id })}
              className="shrink-0 rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary-soft">Correct</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- share ---------- */

const TILE = 'flex flex-col items-center gap-2 rounded-md px-2 py-3 text-center transition-colors hover:bg-surface-2'

export function ShareBody({ payload }: { payload: SharePayload }) {
  const [copied, setCopied] = useState<'link' | 'text' | null>(null)
  const link = shareLink(payload)
  const body = shareBody(payload, link)
  const native = nativeShareFor(payload, link)
  const copy = async (what: 'link' | 'text', value: string) => {
    if (!(await copyShare(value))) return
    setCopied(what)
    setTimeout(() => setCopied(null), 1800)
  }
  return (
    // one column no wider than the panel: a long link must never widen the grid past the panel's edge
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 pt-1" data-share-panel="">
      <p className="text-[12.5px] text-text-3">{payload.subtitle}</p>
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
        <Link2 size={14} className="shrink-0 text-text-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2" title={link} data-share-link="">{link}</span>
        <button type="button" onClick={() => void copy('link', link)}
          className={cn('flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-[11px] font-semibold',
            copied === 'link' ? 'text-tint-fg-mint' : 'text-primary hover:bg-surface-3')}>
          {copied === 'link' ? <Check size={12} /> : <Copy size={12} />} {copied === 'link' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <button type="button" className={TILE} onClick={() => void copy('text', body)}>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-tint-lavender text-tint-fg-lavender">
            {copied === 'text' ? <Check size={18} /> : <Copy size={18} />}
          </span>
          <span className="text-[12px] font-semibold text-text-1">{copied === 'text' ? 'Copied' : 'Copy text'}</span>
        </button>
        <button type="button" className={TILE} onClick={() => downloadShare(payload, body, 'txt')}>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-tint-mint text-tint-fg-mint"><Download size={18} /></span>
          <span className="text-[12px] font-semibold text-text-1">Download</span>
        </button>
        <button type="button" className={TILE} onClick={() => printShare(payload, link)}>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-tint-peach text-tint-fg-peach"><Printer size={18} /></span>
          <span className="text-[12px] font-semibold text-text-1">Print</span>
        </button>
      </div>
      {native && (
        <button type="button" onClick={native}
          className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[12px] font-semibold text-text-1 hover:bg-surface-2">
          <Share2 size={14} /> More…
        </button>
      )}
    </div>
  )
}
