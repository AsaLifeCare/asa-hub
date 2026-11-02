// The right panel's forms: Add note, Update stage, Mark complete / Reopen, the two papers filed here, and the…
// Each files on the second press, through ClientCandidates.gs on the Potential Clients row itself, so a change here…
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Loader2, Pencil } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import RecordEditBody from '@/components/shared/RecordEditBody'
import { FileDropZone, SelectedFileCard, fileToBase64 } from '@/features/hiring/shared'
import { editAnswerOf, type EditChange } from '@/lib/recordEdit'
import { Field } from '@/pages/features/clientops/OpsPageShell'
import ApplyStrip, { useApplyFor } from '@/pages/features/locations/ApplyStrip'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import type { Reread } from '@/pages/features/locations/useLocation'
import { IST_ACCEPT, istPaperProblem, istPaperType } from '@/pages/features/locations/locationModel'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { toast } from '@/stores/useToastStore'
import {
  CONTACT_METHODS, DOC_STATUS_META, NOTE_MAX, STAGES, actionsOf, candidateEditOf, dateWords, documentsOf, doorWords,
  editIntro, intakeId, latestNoteLines, nextStageOf, notePreview, overviewOf, potentialClientHref, preferencesWords, readRefusal,
  stageLabel, stageMeta, stampWords, type ActionItem, type CandidateAsk, type CandidateEdit, type CandidateWrite, type EditSection,
  type PaperDoc, type RosterRow,
} from './candidateModel'
import {
  CANDIDATE_REREAD, QUEUED_WORDS, candidateTarget, candidateWritten, candidateWrote, editNote, editPaper, fileCandidateDoc,
  readActions, readDocuments, readEdit, readKey, readOverview, saveCandidate, useCandidateRead, writeCandidate,
} from './useCandidateRead'
import { EmptyNote, Pill, ReadLine, linkCls } from './CandidateParts'

const INPUT = 'h-10 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const TEXTAREA = 'min-h-[96px] w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const REVIEW = 'rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2'

const errText = (e: unknown): string => readRefusal(e instanceof Error ? e.message : String(e))

type Who = Pick<RosterRow, 'key' | 'name' | 'stage' | 'notes'>

/** One press being prepared: armed on the first, filed on the second, the referral read again when it lands. */
function useDraft(row: Who) {
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const file = async (send: () => Promise<unknown>, said: string, onDone: () => void) => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    const sentAt = Date.now()
    try {
      const got = await send()
      const queued = candidateWrote(row.key, got, sentAt)
      toast({ type: 'success', title: queued ? `${said} — accepted` : said, body: queued ? QUEUED_WORDS : row.name })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was written', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return { armed: armed === 'file', busy, file, disarm: () => setArmed('') }
}

/** Who is signed in: the log's and the note's author. */
const useAuthor = (): string => useAuthStore((s) => s.user?.name ?? '')

function Logged({ text }: { text: string }) {
  const by = useAuthor()
  return <p><span className="text-text-3">Activity Log:</span> {text}{by ? ` — ${by}, with the time` : ''}</p>
}

/* ---------- Add note ---------- */

export const NOTE_PLACEHOLDER = 'Add a note about this referral…'

/** The note, the step it is about, what will be filed, and the referral's latest notes (each editable by its edition). */
export function NoteForm({ row, about, onDone, onEdit }: {
  row: Who
  about: string
  onDone: () => void
  /** a note's own panel, for whom the notes edition opens it */
  onEdit?: (ask: CandidateAsk) => void
}) {
  const actions = useCandidateRead(about ? readKey('clientCandidateActions', row.key) : null, () => readActions(row.key), actionsOf)
  const overview = useCandidateRead(readKey('clientCandidateOverview', row.key), () => readOverview(row.key), overviewOf)
  const [text, setText] = useState('')
  const d = useDraft(row)
  const aboutLabel = about ? actions.data?.items.find((x) => x.id === about)?.label || '' : ''
  const notes = latestNoteLines(overview.data?.candidate.notes || row.notes)
  const press: CandidateWrite = { kind: 'note', note: text, ...(about && aboutLabel ? { item: about } : {}) }
  return (
    <div className="grid gap-5 pt-1" data-note-panel="">
      {aboutLabel && <p className="text-[12.5px] text-text-2" data-about={about}><span className="text-text-3">About:</span> {aboutLabel}</p>}
      <Field label="Note" required>
        <textarea value={text} disabled={d.busy} maxLength={NOTE_MAX} placeholder={NOTE_PLACEHOLDER}
          className={TEXTAREA} onChange={(e) => { setText(e.target.value); d.disarm() }} />
      </Field>
      {d.armed && (
        <div className={REVIEW} data-review="">
          <p className="mb-1 font-semibold text-text-1">This line is added to the referral&rsquo;s notes in Potential Clients:</p>
          <p><span className="text-text-3">For:</span> {row.name}</p>
          <p className="whitespace-pre-wrap"><span className="text-text-3">Note:</span> {notePreview(text, aboutLabel)}</p>
          <Logged text="Note added" />
        </div>
      )}
      <DraftButtons armed={d.armed} busy={d.busy} disabled={!text.trim()} label="Apply note" armedLabel="Apply note — press again"
        onPress={() => void d.file(() => writeCandidate(row.key, press), 'Note filed', () => setText(''))}
        onDisarm={d.disarm} onCancel={onDone} />
      <div className="border-t border-border pt-4">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Notes on the referral</h3>
        {!overview.data && notes.length === 0 && <ReadLine state={overview} what="the notes" onRetry={overview.reload} />}
        {overview.data && notes.length === 0 && <p className="text-[13px] text-text-3" data-no-notes="">No note on the referral yet.</p>}
        {notes.length > 0 && (
          <ul className="grid gap-2" data-notes="">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2.5 text-[13px] leading-5 text-text-1"
                data-note-line={n.id}>
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{n.text}</span>
                {onEdit && (
                  <button type="button" onClick={() => onEdit({ kind: 'noteEdit', id: n.id })} aria-label="Edit this note"
                    data-edit-note={n.id} className="shrink-0 rounded-full p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1">
                    <Pencil size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ---------- Update stage ---------- */

export const STAGE_KEEP_WORDS = 'Existing intake and document records keep their own statuses.'

/** Where the referral may go: the intake's six stages, written on its row's own stage. */
export function StageForm({ row, onDone }: { row: Who; onDone: () => void }) {
  const current = intakeId(row.stage)
  const [picked, setPicked] = useState('')
  const d = useDraft(row)
  // the intake's next stage by default; a closed referral opens on its own
  const to = picked || nextStageOf(row.stage)?.id || current || STAGES[0].id
  const same = to === current
  const target = STAGES.find((s) => s.id === to)
  return (
    <div className="grid gap-5 pt-1" data-stage-panel="">
      <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-2">
        <span className="text-text-3">Current stage:</span> <Pill meta={stageMeta(row.stage)} />
      </p>
      <Field label="Stage" required>
        <select value={to} onChange={(e) => { setPicked(e.target.value); d.disarm() }} className={INPUT} data-stage-select="">
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}{s.id === current ? ' (current)' : ''}</option>
          ))}
        </select>
      </Field>
      {target?.description && !same && <p className="text-[12.5px] leading-5 text-text-3" data-stage-why="">{target.description}</p>}
      <p className="rounded-lg bg-surface-2/60 px-3 py-2 text-[12px] leading-5 text-text-2" data-keep="">{STAGE_KEEP_WORDS}</p>
      {same && <p className="text-[12.5px] text-text-3" data-stage-same="">{row.name} is at {stageLabel(to)}.</p>}
      {d.armed && !same && (
        <div className={REVIEW} data-review="">
          <p className="mb-1 font-semibold text-text-1">This is what will be written on the referral in Potential Clients:</p>
          <p><span className="text-text-3">For:</span> {row.name}</p>
          <p><span className="text-text-3">Stage:</span> {stageLabel(row.stage) || 'None'} → {stageLabel(to)}</p>
          <Logged text={`Stage: ${stageLabel(row.stage) || 'No stage'} → ${stageLabel(to)}`} />
        </div>
      )}
      <DraftButtons armed={d.armed} busy={d.busy} disabled={same || !to} label="Apply" armedLabel="Apply — press again"
        onPress={() => void d.file(() => writeCandidate(row.key, { kind: 'stage', stage: to }), `${row.name} moved to ${stageLabel(to)}`, onDone)}
        onDisarm={d.disarm} onCancel={onDone} />
    </div>
  )
}

/* ---------- Mark complete / Reopen ---------- */

function Elsewhere({ row, label, why }: { row: Who; label: string; why: string }) {
  return (
    <div className="grid gap-4 pt-1" data-door-why="">
      <p className="text-[13px] font-semibold text-text-1">{label}</p>
      <p className="text-[12.5px] leading-5 text-text-2">{why || 'No press here moves this step; Update stage moves the referral first.'}</p>
      <Link to={potentialClientHref(row.key)} className={`${linkCls} inline-flex items-center gap-1 text-[13px] font-semibold`}>
        Open in Potential Clients <ArrowRight size={13} />
      </Link>
    </div>
  )
}

/** One step, completed or reopened with the move the answer names for it, and an optional note on the referral's notes. */
function StepBody({ row, item, kind, onDone }: { row: Who; item: ActionItem; kind: 'complete' | 'reopen'; onDone: () => void }) {
  const [text, setText] = useState('')
  const d = useDraft(row)
  const door = kind === 'complete' ? item.door : item.reopen
  const verb = kind === 'complete' ? 'Mark complete' : 'Reopen'
  const logged = `${kind === 'complete' ? 'Completed' : 'Reopened'} action: ${item.label}`
  return (
    <div className="grid gap-5 pt-1" data-door={kind}>
      <div>
        <p className="text-[13px] font-semibold text-text-1">{item.label}</p>
        <p className="mt-1 text-[12.5px] leading-5 text-text-2">
          {kind === 'complete' ? 'Closing it' : 'Reopening it'} writes on the referral in Potential Clients: {doorWords(door)}.
        </p>
      </div>
      <Field label="Notes">
        <textarea value={text} disabled={d.busy} maxLength={NOTE_MAX} placeholder="What happened, in a sentence"
          className={TEXTAREA} onChange={(e) => { setText(e.target.value); d.disarm() }} />
      </Field>
      {d.armed && (
        <div className={REVIEW} data-review="">
          <p className="mb-1 font-semibold text-text-1">This is what will be written on the referral in Potential Clients:</p>
          <p><span className="text-text-3">For:</span> {row.name}</p>
          <p><span className="text-text-3">Step:</span> {item.label} — {doorWords(door)}</p>
          {text.trim() && <p className="whitespace-pre-wrap"><span className="text-text-3">Note:</span> {notePreview(text, item.label)}</p>}
          <Logged text={logged} />
        </div>
      )}
      <DraftButtons armed={d.armed} busy={d.busy} disabled={false} label={verb} armedLabel={`${verb} — press again`}
        onPress={() => void d.file(() => writeCandidate(row.key, { kind, item: item.id, note: text }),
          `${item.label}: ${kind === 'complete' ? 'complete' : 'reopened'}`, onDone)}
        onDisarm={d.disarm} onCancel={onDone} />
    </div>
  )
}

/** One intake step, completed — or, once complete, reopened — through the move the answer names, or why not here. */
export function CompleteForm({ row, item, onDone, reopen = false }: { row: Who; item: string; onDone: () => void; reopen?: boolean }) {
  const actions = useCandidateRead(readKey('clientCandidateActions', row.key), () => readActions(row.key), actionsOf)
  if (!actions.data) return <div className="pt-1"><ReadLine state={actions} what="the actions" onRetry={actions.reload} /></div>
  const hit = actions.data.items.find((x) => x.id === item) ?? null
  if (!hit) return <EmptyNote>This step is not on {row.name}&rsquo;s intake.</EmptyNote>
  if (!hit.open) {
    return hit.reopen ? <StepBody row={row} item={hit} kind="reopen" onDone={onDone} />
      : <Elsewhere row={row} label={hit.label} why={`${hit.label} is complete; Update stage moves the referral back into the intake first.`} />
  }
  if (reopen) return <EmptyNote>{hit.label} is still open — there is nothing to reopen.</EmptyNote>
  if (!hit.door) return <Elsewhere row={row} label={hit.label} why={hit.why} />
  return <StepBody row={row} item={hit} kind="complete" onDone={onDone} />
}

/* ---------- the papers filed here ---------- */

const PAPER_HINT = 'A PDF or a picture (PNG, JPG, GIF, WebP or HEIC) · up to 15 MB'

/** A PDF or a picture, picked and checked; the second press files it. */
function usePaper() {
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState('')
  const pick = (f: File) => {
    const why = istPaperProblem({ name: f.name, size: f.size, type: f.type })
    setProblem(why)
    setFile(why ? null : f)
  }
  const read = async () => (file ? { name: file.name, mime: istPaperType(file), b64: await fileToBase64(file) } : null)
  return { file, problem, pick, clear: () => setFile(null), read }
}

function PaperPicker({ paper, busy, onChange }: { paper: ReturnType<typeof usePaper>; busy: boolean; onChange: () => void }) {
  return (
    <div className="grid gap-2" data-paper="">
      {paper.file ? <SelectedFileCard file={paper.file} disabled={busy} onRemove={() => { paper.clear(); onChange() }} />
        : <FileDropZone accept={IST_ACCEPT} hint={PAPER_HINT} disabled={busy} onFile={(f) => { paper.pick(f); onChange() }} />}
      {paper.problem && <p className="text-[12.5px] text-danger">{paper.problem}</p>}
      {busy && <p className="flex items-center gap-2 text-[12px] text-text-3"><Loader2 size={13} className="animate-spin" /> Filing the paper…</p>}
    </div>
  )
}

/** The support assessment, filed at the Assessment stage when no plan on file carries it. */
export function AssessmentForm({ row, onDone }: { row: Who; onDone: () => void }) {
  const docs = useCandidateRead(readKey('clientCandidateDocuments', row.key), () => readDocuments(row.key), documentsOf)
  const paper = usePaper()
  const d = useDraft(row)
  if (!docs.data) return <div className="pt-1"><ReadLine state={docs} what="the documents" onRetry={docs.reload} /></div>
  const doc = docs.data.docs.find((x) => x.id === 'assessment')
  if (!doc) return <EmptyNote>No support assessment is on {row.name}&rsquo;s documents.</EmptyNote>
  if (doc.status !== 'pending' || !doc.can_file) {
    return (
      <div className="grid gap-3 pt-1" data-assessment-state={doc.status}>
        <p className="flex items-center gap-2 text-[13px] text-text-1">Support assessment <Pill meta={DOC_STATUS_META[doc.status]} /></p>
        <p className="text-[12.5px] leading-5 text-text-2">{doc.detail || 'Nothing to file here now.'}</p>
      </div>
    )
  }
  return (
    <div className="grid gap-5 pt-1" data-assessment-panel="">
      <p className="text-[12.5px] leading-5 text-text-2">{doc.detail}</p>
      <PaperPicker paper={paper} busy={d.busy} onChange={d.disarm} />
      {d.armed && paper.file && (
        <div className={REVIEW} data-review="">
          <p className="mb-1 font-semibold text-text-1">This paper is filed in {row.name}&rsquo;s folder and recorded on the referral:</p>
          <p><span className="text-text-3">File:</span> {paper.file.name}</p>
          <Logged text="Support assessment filed" />
        </div>
      )}
      <DraftButtons armed={d.armed} busy={d.busy} disabled={!paper.file} label="Apply" armedLabel="File the assessment — press again"
        onPress={() => void d.file(async () => {
          const file = await paper.read()
          if (!file) throw new Error('Pick the paper first.')
          return fileCandidateDoc(row.key, { doc: 'assessment', file })
        }, 'Support assessment filed', onDone)}
        onDisarm={d.disarm} onCancel={onDone} />
    </div>
  )
}

/** The signed consent and how the family wants to be reached; once filed, its confirmation (the documents edition's too). */
export function ConsentForm({ row, onDone }: { row: Who; onDone: () => void }) {
  const docs = useCandidateRead(readKey('clientCandidateDocuments', row.key), () => readDocuments(row.key), documentsOf)
  const paper = usePaper()
  const d = useDraft(row)
  const [method, setMethod] = useState('')
  const [best, setBest] = useState('')
  const [who, setWho] = useState('')
  if (!docs.data) return <div className="pt-1"><ReadLine state={docs} what="the documents" onRetry={docs.reload} /></div>
  const doc = docs.data.docs.find((x) => x.id === 'consent')
  if (!doc) return <EmptyNote>No consent is on {row.name}&rsquo;s documents.</EmptyNote>
  const prefs = preferencesWords(doc.preferences)
  if (doc.status !== 'pending') {
    return (
      <div className="grid gap-5 pt-1" data-consent-state={doc.status}>
        <div className="grid gap-1.5">
          <p className="flex items-center gap-2 text-[13px] text-text-1">Signed consent <Pill meta={DOC_STATUS_META[doc.status]} /></p>
          <p className="text-[12.5px] leading-5 text-text-2">{[doc.source, dateWords(doc.date)].filter(Boolean).join(' · ')}</p>
          <p className="text-[12.5px] leading-5 text-text-2" data-preferences="">{prefs ? `Contact: ${prefs}` : 'No contact preference was recorded.'}</p>
        </div>
        {doc.status === 'in_review' && (
          <>
            {d.armed && (
              <div className={REVIEW} data-review="">
                <p className="mb-1 font-semibold text-text-1">The consent is marked confirmed on the referral:</p>
                <Logged text="Consent & contact preferences confirmed" />
              </div>
            )}
            <DraftButtons armed={d.armed} busy={d.busy} disabled={false} label="Confirm consent" armedLabel="Confirm — press again"
              onPress={() => void d.file(() => fileCandidateDoc(row.key, { doc: 'consent', confirm: true }), 'Consent confirmed', onDone)}
              onDisarm={d.disarm} onCancel={onDone} />
          </>
        )}
      </div>
    )
  }
  const edit =(set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); d.disarm() }
  return (
    <div className="grid gap-5 pt-1" data-consent-panel="">
      <div className="grid gap-1.5">
        <span className="text-[12px] font-medium text-text-2">Signed consent<span className="text-danger"> *</span></span>
        <PaperPicker paper={paper} busy={d.busy} onChange={d.disarm} />
      </div>
      <Field label="Contact method">
        <select value={method} onChange={edit(setMethod)} className={INPUT} data-consent-method="">
          <option value="">Not said</option>
          {CONTACT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="Best time">
        <input value={best} onChange={edit(setBest)} maxLength={120} placeholder="Weekday mornings" className={INPUT} data-consent-time="" />
      </Field>
      <Field label="Who to contact">
        <input value={who} onChange={edit(setWho)} maxLength={200} placeholder="Name, relationship and phone" className={INPUT} data-consent-who="" />
      </Field>
      {d.armed && paper.file && (
        <div className={REVIEW} data-review="">
          <p className="mb-1 font-semibold text-text-1">This is filed in {row.name}&rsquo;s folder and recorded on the referral, In Review until confirmed:</p>
          <p><span className="text-text-3">File:</span> {paper.file.name}</p>
          <p><span className="text-text-3">Contact:</span> {preferencesWords({ method, best_time: best, who }) || 'Not said'}</p>
          <Logged text="Consent & contact preferences filed" />
        </div>
      )}
      <DraftButtons armed={d.armed} busy={d.busy} disabled={!paper.file} label="Apply" armedLabel="File the consent — press again"
        onPress={() => void d.file(async () => {
          const file = await paper.read()
          if (!file) throw new Error('Pick the signed consent first.')
          return fileCandidateDoc(row.key, { doc: 'consent', file, method, best_time: best.trim(), contact_who: who.trim() })
        }, 'Consent filed', onDone)}
        onDisarm={d.disarm} onCancel={onDone} />
    </div>
  )
}

/* ---------- the editions' own panels (Python's doors: Information, the intake, a note, a paper's record) ---------- */

/** The second press of an edition's form (Locations' own words). */
const applyChanges = (n: number) => `Apply ${n} change${n === 1 ? '' : 's'}`

/** An edition's panel read, fresh each time the panel opens: what is saved is checked against exactly this. */
function useEditRead(row: Who, section: EditSection | 'note' | 'document', extra: { doc?: string; id?: string } = {}) {
  const [opened] = useState(() => String(Date.now()))
  const key = readKey('clientCandidateEditRead', row.key, section, extra.doc ?? extra.id ?? '', opened)
  return useCandidateRead(key, () => readEdit(row.key, section, extra), candidateEditOf)
}

/** What this panel does not change, and where each line is changed instead. */
function KeptElsewhere({ edit }: { edit: CandidateEdit }) {
  if (!edit.elsewhere.length) return null
  return (
    <div className="grid gap-1 text-[12px] leading-4 text-text-3" data-edit-elsewhere="">
      <p className="font-semibold text-text-2">Not changed here</p>
      {edit.elsewhere.map((e) => <p key={e.field}>{e.label}: {e.why}</p>)}
    </div>
  )
}

/** One Apply through the strip; a refusal reads the referral again, so a stale field shows what the row holds now. */
function useEditApply(row: Who) {
  const target = useMemo(() => candidateTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const file = async (send: () => Promise<unknown>, rereads: Reread[]) => {
    try {
      return editAnswerOf(await apply.run(send, rereads))
    } catch (e) {
      candidateWritten(row.key)
      throw e
    }
  }
  return { apply, file }
}

/** Information or the intake's answers on the shared record panel, applied through the strip. */
export function EditCandidateForm({ row, section, onDone }: { row: Who; section: EditSection; onDone: () => void }) {
  const read = useEditRead(row, section)
  const edit = read.data
  const fields = useMemo(() => edit?.fields ?? [], [edit])
  const { apply, file } = useEditApply(row)
  const rereads = section === 'intake'
    ? [CANDIDATE_REREAD.intake(row.key), CANDIDATE_REREAD.actions(row.key), CANDIDATE_REREAD.overview(row.key)]
    : [CANDIDATE_REREAD.overview(row.key), CANDIDATE_REREAD.intake(row.key)]
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-candidate={section}>
      <ReadLine state={read} what={section === 'intake' ? 'the intake' : 'the details'} onRetry={read.reload} />
      {edit && (
        <RecordEditBody fields={fields} onFile={(changes: EditChange[]) => file(() => saveCandidate(row.key, section, changes), rereads)}
          onDone={onDone} stay applyLabel={applyChanges} locked={apply.state.phase === 'running'} intro={editIntro(section, row.name)} />
      )}
      {edit && <KeptElsewhere edit={edit} />}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}

/** A line of the referral's notes: its words changed, or the line removed on a second press. */
export function NoteEditForm({ row, id, onDone }: { row: Who; id: string; onDone: () => void }) {
  const read = useEditRead(row, 'note', { id })
  const edit = read.data
  const fields = useMemo(() => edit?.fields ?? [], [edit])
  const { apply, file } = useEditApply(row)
  const [armed, setArmed] = useState('')
  const rereads = [CANDIDATE_REREAD.overview(row.key)]
  const words = edit?.fields.find((f) => f.key === 'body')?.raw ?? ''
  const remove = async () => {
    const step = nextPress(armed, 'remove')
    setArmed(step.armed)
    if (!step.act) return
    try {
      await file(() => editNote(row.key, id, [{ field: 'state', value: 'removed', expected: words }]), rereads)
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: errText(e) })
    }
  }
  const running = apply.state.phase === 'running'
  const locked = !!edit?.fields.find((f) => f.key === 'body')?.lockedBy
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-note-edit={id}>
      <ReadLine state={read} what="the note" onRetry={read.reload} />
      {edit && (
        <p className="text-[12px] text-text-3" data-note-filed="">{[edit.by, stampWords(edit.at)].filter(Boolean).join(' · ')}</p>
      )}
      {edit && (
        <RecordEditBody fields={fields} onFile={(changes: EditChange[]) => file(() => editNote(row.key, id, changes), rereads)}
          onDone={onDone} stay applyLabel={applyChanges} locked={running} intro={editIntro('note', row.name)} />
      )}
      {edit && !locked && apply.state.phase === 'idle' && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3" data-note-remove="">
          <p className="text-[12px] leading-4 text-text-3">A removed note leaves the referral&rsquo;s notes in Potential Clients too.</p>
          <div className="flex items-center gap-2">
            {armed && <button type="button" onClick={() => setArmed('')} className="text-[12.5px] text-text-3 hover:text-text-1">Keep it</button>}
            <button type="button" onClick={() => void remove()} disabled={running} data-press={armed ? 'remove' : 'review'}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--danger)] px-4 text-[13px] font-semibold text-[var(--danger)] transition-colors hover:bg-tint-danger disabled:opacity-40">
              {armed ? 'Remove the note — press again' : 'Remove the note'}
            </button>
          </div>
        </div>
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}

/** A filed paper's record on the referral: the consent's confirmation, or the record taken off (the file stays). */
export function PaperForm({ row, doc, onDone }: { row: Who; doc: PaperDoc; onDone: () => void }) {
  const read = useEditRead(row, 'document', { doc })
  const edit = read.data
  const fields = useMemo(() => edit?.fields ?? [], [edit])
  const { apply, file } = useEditApply(row)
  const rereads = [CANDIDATE_REREAD.documents(row.key), CANDIDATE_REREAD.overview(row.key)]
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-paper-edit={doc}>
      <ReadLine state={read} what="the paper" onRetry={read.reload} />
      {edit && (
        <p className="text-[13px] font-semibold text-text-1" data-paper-label="">
          {edit.label}{edit.file ? <span className="font-normal text-text-3"> · {edit.file}</span> : null}
        </p>
      )}
      {edit && (
        <RecordEditBody fields={fields} onFile={(changes: EditChange[]) => file(() => editPaper(row.key, doc, changes), rereads)}
          onDone={onDone} stay applyLabel={applyChanges} locked={apply.state.phase === 'running'} intro={editIntro('paper', row.name)} />
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}
