// THE ONE RIGHT PANEL of Staff — a SidePanel whose mode switches: share, assign training, file a training document…
// It is an aside at the standard width (a transcript alone takes the document width), never a dialog.
import { useMemo, useRef } from 'react'
import SidePanel from '@/components/shared/SidePanel'
import RecordEditBody from '@/components/shared/RecordEditBody'
import ApplyStrip, { useApplyFor } from '@/pages/features/locations/ApplyStrip'
import { ShareBody } from '@/pages/features/locations/LocationPanel'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import type { SharePayload } from '@/stores/useShareStore'
import { toast } from '@/stores/useToastStore'
import { editAnswerOf, type EditAnswer, type EditChange } from '@/lib/recordEdit'
import { useShellHides } from '@/lib/myWorkHides'
import { fieldsBare } from '@/pages/features/clientprofiles/clientModel'
import {
  RENAME_FIELDS, editOpenFor, hrOf, overviewOf, panelLabel, panelTitle, staffEditFields, staffEditViewOf, transcriptOf,
  type EditSection, type RosterRow, type StaffAsk,
} from './staffModel'
import CallTranscript from './CallTranscript'
import {
  editDriving, editIst, editMais, editNote, editStaff, forgetStaffReads, liveEditKey, readCompliance, readComplianceLive,
  readEmployment, readEmploymentLive, readHr, readKey, readNotes, readOverview, readOverviewLive, readTranscript, renameStaff,
  staffReread, staffTarget, staffWritten, staffWrote, useStaffRead,
} from './useStaffRead'
import { AssignTrainingForm, DocMarkForm, HrIssueForm, IncidentForm, IstAddForm, NoteForm } from './StaffForms'
import { LoanBody, PaymentBody } from './sections/EmployeePay'
import { useStaffViewer } from './staffViewer'
import { DocUploadForm, TrainingDocForm } from './TrainingDocForm'
import { AccessBody, InviteBody, ResetBody } from './AccountForms'
import { ReadLine } from './StaffParts'

export default function StaffPanel({ ask, row, share, houses, onClose, onRekey, onAsk }: {
  ask: StaffAsk | null
  row: RosterRow
  share: SharePayload
  /** the houses slice when the page holds it, for Assign Training */
  houses?: HouseRow[] | null
  onClose: () => void
  /** a rename landed: the page moves to the new key */
  onRekey?: (key: string) => void
  /** another panel in the same slot (a note's edit from the notes panel) */
  onAsk?: (ask: StaffAsk) => void
}) {
  const accountAsk = ask?.kind === 'access'
  const hr = useStaffRead(accountAsk ? readKey('staffProfileHr', row.key) : null, () => readHr(row.key), hrOf)
  const active = hr.data?.account ? hr.data.account.active : null
  return (
    <SidePanel open={!!ask} onClose={onClose} label={ask ? panelLabel(ask) : 'Staff'} title={ask ? panelTitle(ask, row.name, active) : ''}>
      {ask && (
        <PanelBody key={`${row.key}|${JSON.stringify(ask)}`} ask={ask} row={row} share={share} houses={houses} onClose={onClose}
          onRekey={onRekey} onAsk={onAsk} />
      )}
    </SidePanel>
  )
}

export function PanelBody({ ask, row, share, houses, onClose, onRekey, onAsk }: {
  ask: StaffAsk
  row: RosterRow
  share: SharePayload
  houses?: HouseRow[] | null
  onClose: () => void
  onRekey?: (key: string) => void
  onAsk?: (ask: StaffAsk) => void
}) {
  const viewer = useStaffViewer()
  const ist = viewer.writes || viewer.assign === 'any'
  switch (ask.kind) {
    case 'share': return <ShareBody payload={share} />
    case 'assign': return <AssignTrainingForm row={row} house={ask.house} houses={houses} onDone={onClose} ist={ist} />
    case 'filedoc': return <TrainingDocForm row={row} course={ask.course} onDone={onClose} />
    case 'docupload': return <DocUploadForm row={row} doc={ask.doc} onDone={onClose} />
    case 'incident': return <IncidentForm row={row} onDone={onClose} />
    case 'hrissue': return <HrIssueForm row={row} onDone={onClose} />
    case 'docmark': return <DocMarkForm row={row} date={ask.date} area={ask.area} onDone={onClose} />
    case 'istadd': return <IstAddForm row={row} client={ask.client} onDone={onClose} />
    case 'note': return <NoteForm row={row} onDone={onClose} onAsk={onAsk} />
    case 'loan': return <LoanBody row={row} onDone={onClose} />
    case 'payment': return <PaymentBody row={row} onDone={onClose} />
    case 'transcript': return <TranscriptBody row={row} callId={ask.id} />
    case 'invite': return <InviteBody row={row} onDone={onClose} />
    case 'access': return <AccessBody row={row} onDone={onClose} />
    case 'reset': return <ResetBody row={row} onDone={onClose} />
    case 'edit': return <EditBody row={row} section={ask.section} id={ask.id} onDone={onClose} onRekey={onRekey} />
  }
}

const OVERVIEW_READ = { action: 'staffProfileOverview', load: readOverview }

const EDIT_READS: Record<EditSection, { action: string; load: (staff: string) => Promise<unknown> }> = {
  profile: OVERVIEW_READ,
  employment: { action: 'staffProfileEmployment', load: readEmployment },
  hr: { action: 'staffProfileHr', load: readHr },
  compliance: { action: 'staffProfileCompliance', load: readCompliance },
  driving: OVERVIEW_READ,
  mais: OVERVIEW_READ,
  ist: OVERVIEW_READ,
  note: { action: 'staffProfileNotes', load: readNotes },
}

const MASTER_INTRO = 'Each field is saved where it is kept — the Employee Database Master or the sign-in account. Only the fields you change are sent.'

/** A holder's HR panel opens on what HR Admin shows, which is read from the sheet. */
const HR_HOLDER_INTRO = `${MASTER_INTRO} HR Admin is read from the sheet, so a change shows there once the sheet sync carries it.`

const EDIT_INTRO: Record<EditSection, string> = {
  profile: `${MASTER_INTRO} A new first or last name moves the profile, its notes and visits to the new name.`,
  employment: MASTER_INTRO,
  hr: MASTER_INTRO,
  compliance: `${MASTER_INTRO} A course's paper and its read date are filed with Upload paper on its row.`,
  driving: "Saved on this person's row of the employee driver tab; the standing on Driver Compliance. Only the fields you change are sent.",
  mais: "Saved on the MAIS tab's row for this line; the next registry scrape may write it again. Only the fields you change are sent.",
  ist: 'Saved on the IST record. Only the fields you change are sent.',
  note: "Saved on the note's row; who filed it and when stay as filed. Only the fields you change are sent.",
}

const answerKey = (raw: unknown): string => {
  const k = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).key : undefined
  return typeof k === 'string' ? k : ''
}

// An edition holder's panel reads these sections from their doors (the pack's raw values are the master's alone); HR, its audited read.
const LIVE_READS: Partial<Record<EditSection, (staff: string) => Promise<unknown>>> = {
  profile: readOverviewLive,
  employment: readEmploymentLive,
  compliance: readComplianceLive,
}

/** The sections whose fields each edition opens one by one; a line's panel is its edition's whole. */
const RECORD_SECTIONS: readonly EditSection[] = ['profile', 'employment', 'hr', 'compliance']

/** The second press of an edition's form (Locations' own words). */
const applyChanges = (n: number) => `Apply ${n} change${n === 1 ? '' : 's'}`

/** A section's record as the panel edits it: the raw values and the locks, filed through the Apply strip; the master's rename after it. */
function EditBody({ row, section, id = '', onDone, onRekey }: {
  row: RosterRow
  section: EditSection
  id?: string
  onDone: () => void
  /** the rename landed: the page moves to the new key */
  onRekey?: (key: string) => void
}) {
  const viewer = useStaffViewer()
  const r = EDIT_READS[section]
  const live = viewer.writes ? undefined : LIVE_READS[section]
  const key = live ? liveEditKey(r.action, row.key) : readKey(r.action, row.key)
  const load = live ?? r.load
  const read = useStaffRead(key, () => load(row.key), (raw) => staffEditViewOf(section, raw, id, !viewer.writes))
  const open = useMemo(() => (RECORD_SECTIONS.includes(section) ? editOpenFor(viewer) : null), [viewer, section])
  // the intro and the notes under the fields: the master's while Settings › My Work keeps them
  const bare = useShellHides().staff_edit_notes
  const fields = useMemo(() => {
    const all = read.data ? staffEditFields(section, read.data, open) : []
    return bare ? fieldsBare(all) : all
  }, [read.data, section, open, bare])
  const target = useMemo(() => staffTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const moved = useRef('')
  const done = () => (moved.current && onRekey ? onRekey(moved.current) : onDone())
  const send = (changes: EditChange[], confirmed: string[]) => (section === 'driving' ? editDriving(row.key, changes)
    : section === 'mais' ? editMais(row.key, id, changes)
      : section === 'ist' ? editIst(row.key, id, changes)
        : section === 'note' ? editNote(row.key, id, changes)
          : editStaff(row.key, changes, confirmed.includes('login_email')))
  const file = async (changes: EditChange[], confirmed: string[]): Promise<EditAnswer> => {
    const rereads = [staffReread(key, () => load(row.key))]
    const names = section === 'profile' && viewer.writes ? changes.filter((c) => RENAME_FIELDS.includes(c.field)) : []
    const rest = changes.filter((c) => !names.includes(c))
    const answer: EditAnswer = { written: [], refused: [] }
    const take = (got: unknown) => {
      const a = editAnswerOf(got)
      answer.written.push(...a.written)
      answer.refused.push(...a.refused)
    }
    // the fields through the strip first; the rename last: it changes the key the others file under
    if (rest.length) take(await apply.run(() => send(rest, confirmed), rereads))
    if (!names.length) return answer
    try {
      const raw = await renameStaff(row.key, names)
      take(raw)
      const next = answerKey(raw)
      staffWrote(row.key, null)
      if (next && next !== row.key) {
        forgetStaffReads()
        staffWritten('*')
        moved.current = next
        // with a refusal the panel stays: the move cannot wait for it to close
        if (answer.refused.length) onRekey?.(next)
      }
    } catch (e) {
      // the other fields stand; the name says why it was not renamed
      staffWrote(row.key, null)
      if (!rest.length) throw e
      const why = e instanceof Error ? e.message : String(e)
      answer.refused.push(...names.map((c) => ({ field: c.field, why })))
    }
    // no strip ran (the name alone): the panel closes as a save always did
    if (!rest.length && !answer.refused.length) {
      toast({ type: 'success', title: 'Saved', body: `${answer.written.length} field${answer.written.length === 1 ? '' : 's'} saved.` })
      done()
    }
    return answer
  }
  const intro = bare ? undefined : section === 'profile' && !viewer.writes ? MASTER_INTRO
    : section === 'hr' && !viewer.writes ? HR_HOLDER_INTRO : EDIT_INTRO[section]
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-panel={section}>
      <ReadLine state={read} what="the record" onRetry={read.reload} />
      {read.data && (
        <RecordEditBody fields={fields} onFile={file} onDone={done} intro={intro} stay applyLabel={applyChanges}
          locked={apply.state.phase === 'running'} />
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); done() }} onAgain={apply.reset} />
    </div>
  )
}

/** The hotline screen's own conversation view, over this person's call. */
function TranscriptBody({ row, callId }: { row: RosterRow; callId: string }) {
  const read = useStaffRead(readKey('staffProfileTranscript', row.key, callId), () => readTranscript(row.key, callId), transcriptOf)
  const overview = useStaffRead(readKey('staffProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  const phones = overview.data?.person.phones.map((p) => p.value) ?? []
  const t = read.data
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-transcript-panel={callId}>
      <ReadLine state={read} what="the transcript" onRetry={read.reload} />
      {t && <CallTranscript t={t} name={row.name} source="roster" phones={phones} retry={read.reload} />}
    </div>
  )
}
