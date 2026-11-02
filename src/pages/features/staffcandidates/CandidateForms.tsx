// The right panel's forms: Add note, Update stage, Mark complete, Upload and Add document, and the editions' own panels.
// Each files on the second press; every change but the note is the Hiring door the answer names for it, pressed…
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ArrowRight, Loader2, RotateCcw } from 'lucide-react'
import { Field } from '@/pages/features/clientops/OpsPageShell'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { FileDropZone, MAX_UPLOAD_BYTES, SelectedFileCard, extOf } from '@/features/hiring/shared'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { toast } from '@/stores/useToastStore'
import RecordEditBody from '@/components/shared/RecordEditBody'
import { editAnswerOf, type EditChange } from '@/lib/recordEdit'
import ApplyStrip, { useApplyFor } from '@/pages/features/locations/ApplyStrip'
import {
  DOOR_WORDS, NOTE_MAX, NO_FIELDS, actionsOf, activityOf, candidateEditOf, cjisResultWords, documentsOf, doorReady, doorTitle,
  editIntro, hiringHref, noteBody, paperAccept, paperExtsWords, paperFileRefusal, paperReadingOf, paperVerdictWords, pressHeld,
  readRefusal, readingLines, stageLabel, stampWords, type CandidateEdit, type Door, type DoorFields, type EditSection,
  type PaperReading, type RosterRow,
} from './candidateModel'
import {
  CANDIDATE_REREAD, QUEUED_WORDS, addDocument, addNote, candidateTarget, candidateWritten, candidateWrote, editNote, openDoor,
  pressUnlogged, readActions, readActivity, readDocuments, readEdit, readKey, reviewDoc, saveCandidate, useCandidateRead,
  type Press,
} from './useCandidateRead'
import { EmptyNote, Pill, ReadLine, linkCls } from './CandidateParts'

const INPUT = 'h-10 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const TEXTAREA = 'min-h-[96px] w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const REVIEW = 'rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2'

const errText = (e: unknown): string => readRefusal(e instanceof Error ? e.message : String(e))

type Who = Pick<RosterRow, 'key' | 'name' | 'stage' | 'email'>

/** One write being prepared: the armed press and the filing, with the candidate read again when it lands. */
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
      const unlogged = pressUnlogged(got)
      if (unlogged) toast({ type: 'info', title: said, body: unlogged })
      else toast({ type: 'success', title: queued ? `${said} — accepted` : said, body: queued ? QUEUED_WORDS : row.name })
      onDone()
    } catch (e) {
      const at = (e as { envelope?: { already_at?: unknown } })?.envelope?.already_at
      if (typeof at === 'string' && at) {
        // the board's own answer when the move already landed: the screen was behind, and reads again
        candidateWrote(row.key, null, sentAt)
        toast({ type: 'info', title: `${row.name} is already at ${stageLabel(at)}`, body: 'The screen was behind — it has been read again.' })
        onDone()
      } else {
        toast({ type: 'danger', title: 'Nothing was written', body: errText(e) })
      }
    } finally {
      setBusy(false)
    }
  }
  return { armed: armed === 'file', busy, file, disarm: () => setArmed('') }
}

/* ---------- Add note ---------- */

export const NOTE_PLACEHOLDER = 'Add a note about this candidate…'

/** The note, the step it is about, what will be filed, and the notes on the hiring journey. */
export function NoteForm({ row, about, onDone }: { row: Who; about: string; onDone: () => void }) {
  const actions = useCandidateRead(about ? readKey('candidateProfileActions', row.key) : null, () => readActions(row.key), actionsOf)
  const activity = useCandidateRead(readKey('candidateProfileActivity', row.key), () => readActivity(row.key), activityOf)
  const [text, setText] = useState('')
  const d = useDraft(row)
  const aboutLabel = about ? actions.data?.items.find((x) => x.id === about)?.label || '' : ''
  const body = noteBody(text, aboutLabel)
  const notes = (activity.data?.items ?? []).filter((x) => x.kind === 'note').slice(0, 5)
  return (
    <div className="grid gap-5 pt-1" data-note-panel="">
      {aboutLabel && <p className="text-[12.5px] text-text-2" data-about={about}><span className="text-text-3">About:</span> {aboutLabel}</p>}
      <Field label="Note" required>
        <textarea value={text} disabled={d.busy} maxLength={NOTE_MAX - (aboutLabel ? aboutLabel.length + 2 : 0)} placeholder={NOTE_PLACEHOLDER}
          className={TEXTAREA} onChange={(e) => { setText(e.target.value); d.disarm() }} />
      </Field>
      {d.armed && (
        <div className={REVIEW} data-review="">
          <p className="mb-1 font-semibold text-text-1">This is what will be filed on the hiring journey:</p>
          <p><span className="text-text-3">For:</span> {row.name}</p>
          <p className="whitespace-pre-wrap"><span className="text-text-3">Note:</span> {body}</p>
        </div>
      )}
      <DraftButtons armed={d.armed} busy={d.busy} disabled={!text.trim()} armedLabel="File note — press again"
        onPress={() => void d.file(() => addNote(row.key, body), 'Note filed', () => setText(''))}
        onDisarm={d.disarm} onCancel={onDone} />
      <div className="border-t border-border pt-4">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Notes on the hiring journey</h3>
        <ReadLine state={activity} what="the notes" onRetry={activity.reload} />
        {activity.data && notes.length === 0 && <p className="text-[13px] text-text-3" data-no-notes="">No note on the hiring journey yet.</p>}
        {notes.length > 0 && (
          <ul className="grid gap-2">
            {notes.map((n) => (
              <li key={n.id} data-note={n.id} className="rounded-lg border border-border px-3 py-2.5">
                <p className="whitespace-pre-wrap text-[13px] leading-5 text-text-1">{n.body || n.title}</p>
                <p className="mt-1 text-[11.5px] text-text-3">{[n.by, stampWords(n.at)].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ---------- a Hiring door's own form ---------- */

const UPLOAD_EXTS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png']

function DoorFieldsForm({ door, f, busy, onSet }: {
  door: Door
  f: DoorFields
  busy: boolean
  onSet: (k: keyof DoorFields, v: string | File | null) => void
}) {
  const input = (k: 'location' | 'with_name' | 'interviewer_name', label: string, placeholder: string) => (
    <Field label={label} required>
      <input value={f[k]} disabled={busy} placeholder={placeholder} className={INPUT} onChange={(e) => onSet(k, e.target.value)} />
    </Field>
  )
  const notes = (label: string, required: boolean, placeholder: string) => (
    <Field label={label} required={required}>
      <textarea value={f.notes} disabled={busy} maxLength={4000} placeholder={placeholder} className={TEXTAREA}
        onChange={(e) => onSet('notes', e.target.value)} />
    </Field>
  )
  switch (door.form) {
    case 'notes': return notes('Notes', false, 'What happened, in a sentence')
    case 'note': return notes('Where is the signed packet?', true, 'Say where the signed packet is')
    case 'reason': return notes('Reason', true, 'Why they are leaving the process')
    case 'schedule':
      return (
        <>
          <Field label="Date" required>
            <input type="date" value={f.date} disabled={busy} className={INPUT} onChange={(e) => onSet('date', e.target.value)} />
          </Field>
          <Field label="Time">
            <input type="time" value={f.time} disabled={busy} className={INPUT} onChange={(e) => onSet('time', e.target.value)} />
          </Field>
          {input('location', 'Location', 'Where the interview is held')}
          {input('with_name', 'Interviewer', 'Who holds the interview')}
          {notes('Notes', false, 'Anything the interviewer should know')}
        </>
      )
    case 'scorecard':
      return (
        <>
          {input('interviewer_name', 'Interviewer', 'Who held the interview')}
          <Field label="Score (0–10)" required>
            <select value={f.score} disabled={busy} className={INPUT} onChange={(e) => onSet('score', e.target.value)}>
              <option value="">Choose a score</option>
              {Array.from({ length: 11 }, (_, n) => <option key={n} value={String(n)}>{n}</option>)}
            </select>
          </Field>
          <Field label="Recommendation" required>
            <select value={f.recommendation} disabled={busy} className={INPUT} onChange={(e) => onSet('recommendation', e.target.value)}>
              <option value="">Choose one</option>
              {['Advance', 'Hold', 'Decline'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          {notes('Comments', true, 'What the interview showed — at least a sentence')}
        </>
      )
    case 'upload':
      return f.file ? <SelectedFileCard file={f.file} disabled={busy} onRemove={() => onSet('file', null)} /> : (
        <FileDropZone accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" hint="PDF, DOC, DOCX, JPG or PNG · up to 15MB" disabled={busy}
          onFile={(file) => {
            if (!UPLOAD_EXTS.includes(extOf(file.name))) toast({ type: 'danger', title: 'Not this kind of file', body: 'PDF, DOC, DOCX, JPG or PNG.' })
            else if (file.size > MAX_UPLOAD_BYTES) toast({ type: 'danger', title: 'Too large', body: 'Up to 15MB.' })
            else onSet('file', file)
          }} />
      )
    default: return null
  }
}

/** One Hiring door, with what it does, the fields it asks for, what will be written, and its two presses. */
function DoorBody({ row, door, via, label, pressLabel, onDone, master = true }: {
  row: Who
  door: Door
  /** the step, stage or paper the press is for, by the id its answer gave */
  via: Press
  label: string
  /** the press's own word, when the panel names it rather than the door */
  pressLabel?: string
  onDone: () => void
  /** the master presses every door; a pipeline holder only those that send nothing */
  master?: boolean
}) {
  const [f, setF] = useState<DoorFields>(NO_FIELDS)
  const d = useDraft(row)
  const words = DOOR_WORDS[door.action]
  const onSet = (k: keyof DoorFields, v: string | File | null) => {
    setF((o) => ({ ...o, [k]: v }))
    d.disarm()
  }
  const press = pressLabel ?? words?.press ?? 'Apply'
  // an edition holder presses only the doors that send nothing; the others are the master's, said so
  const held = pressHeld(door, master)
  if (held) return <Elsewhere row={row} label={label} why={held} />
  return (
    <div className="grid gap-5 pt-1" data-door={door.action}>
      <div>
        <p className="text-[13px] font-semibold text-text-1">{label}</p>
        {words && <p className="mt-1 text-[12.5px] leading-5 text-text-2">{words.says}</p>}
      </div>
      <DoorFieldsForm door={door} f={f} busy={d.busy} onSet={onSet} />
      {d.armed && (
        <div className={REVIEW} data-review="">
          <p className="mb-1 font-semibold text-text-1">This is what will be written on the hiring record:</p>
          <p><span className="text-text-3">For:</span> {row.name}</p>
          <p><span className="text-text-3">Step:</span> {label} — {doorTitle(door)}</p>
          {door.form === 'schedule' && <p><span className="text-text-3">When:</span> {[f.date, f.time].filter(Boolean).join(' ')} · {f.location} · {f.with_name}</p>}
          {door.form === 'scorecard' && <p><span className="text-text-3">Scorecard:</span> {f.interviewer_name} · {f.score}/10 · {f.recommendation}</p>}
          {f.file && <p><span className="text-text-3">File:</span> {f.file.name}</p>}
          {f.notes.trim() && <p className="whitespace-pre-wrap"><span className="text-text-3">{door.form === 'reason' ? 'Reason' : 'Notes'}:</span> {f.notes.trim()}</p>}
        </div>
      )}
      <DraftButtons armed={d.armed} busy={d.busy} disabled={!doorReady(door, f)} label={press} armedLabel={`${press} — press again`}
        onPress={() => void d.file(() => openDoor(door, { key: row.key }, via, { ...f, notes: f.notes.trim() }),
          `${label}: ${doorTitle(door)}`, onDone)}
        onDisarm={d.disarm} onCancel={onDone} />
    </div>
  )
}

function Elsewhere({ row, label, why }: { row: Who; label: string; why: string }) {
  return (
    <div className="grid gap-4 pt-1" data-door-why="">
      <p className="text-[13px] font-semibold text-text-1">{label}</p>
      <p className="text-[12.5px] leading-5 text-text-2">{why || 'The Hiring card resolves this one.'}</p>
      <Link to={hiringHref(row.key)} className={`${linkCls} inline-flex items-center gap-1 text-[13px] font-semibold`}>
        Open in Hiring <ArrowRight size={13} />
      </Link>
    </div>
  )
}

/* ---------- Update stage ---------- */

export const STAGE_KEEP_WORDS = 'Existing interview, intake and document records keep their own statuses.'

/** Where the card may go: every stage, and out of the process — each with its Hiring door or why it has none. */
export function StageForm({ row, onDone, master = true }: { row: Who; onDone: () => void; master?: boolean }) {
  const actions = useCandidateRead(readKey('candidateProfileActions', row.key), () => readActions(row.key), actionsOf)
  const moves = actions.data?.stages ?? []
  const [picked, setPicked] = useState('')
  const to = moves.find((m) => m.id === picked) ?? moves.find((m) => m.reachable && m.id !== 'not-hiring') ?? moves.find((m) => m.current) ?? null
  if (!actions.data) return <div className="pt-1"><ReadLine state={actions} what="where the card may go" onRetry={actions.reload} /></div>
  if (!moves.length) return <Elsewhere row={row} label="Update stage" why="The Hiring board did not say where this card may go." />
  const current = moves.find((m) => m.current)
  return (
    <div className="grid gap-5 pt-1" data-stage-panel="">
      <p className="text-[12.5px] text-text-2"><span className="text-text-3">Current stage:</span> {current?.label || stageLabel(row.stage) || 'Not on file'}</p>
      <Field label="Stage" required>
        <select value={to?.id ?? ''} onChange={(e) => setPicked(e.target.value)} className={INPUT} data-stage-select="">
          {moves.map((m) => (
            <option key={m.id} value={m.id}>{m.label}{m.current ? ' (current)' : ''}</option>
          ))}
        </select>
      </Field>
      <p className="rounded-lg bg-surface-2/60 px-3 py-2 text-[12px] leading-5 text-text-2" data-keep="">{STAGE_KEEP_WORDS}</p>
      {to?.current && <p className="text-[12.5px] text-text-3" data-stage-why="">{row.name} is at {to.label}.</p>}
      {to && !to.current && (!to.reachable || !to.door) && <p className="text-[12.5px] leading-5 text-text-3" data-stage-why="">{to.why}</p>}
      {to && !to.current && to.reachable && to.door && (
        <>
          {to.why && <p className="text-[12.5px] leading-5 text-text-3" data-stage-why="">{to.why}</p>}
          <DoorBody key={to.id} row={row} door={to.door} via={{ press: 'stage', item: to.id }}
            label={`${current?.label || stageLabel(row.stage)} → ${to.label}`} pressLabel="Apply" onDone={onDone} master={master} />
        </>
      )}
    </div>
  )
}

/* ---------- Mark complete ---------- */

/** One hiring step, closed through the door the Hiring card closes it with — or why it cannot be here. */
export function CompleteForm({ row, item, onDone, master = true }: { row: Who; item: string; onDone: () => void; master?: boolean }) {
  const actions = useCandidateRead(readKey('candidateProfileActions', row.key), () => readActions(row.key), actionsOf)
  if (!actions.data) return <div className="pt-1"><ReadLine state={actions} what="the actions" onRetry={actions.reload} /></div>
  const hit = actions.data.items.find((x) => x.id === item) ?? null
  if (!hit) return <EmptyNote>This step is not on {row.name}&rsquo;s hiring record.</EmptyNote>
  if (!hit.open) return <EmptyNote>{hit.label} is already complete on the hiring record.</EmptyNote>
  if (!hit.door) return <Elsewhere row={row} label={hit.label} why={hit.why} />
  return <DoorBody row={row} door={hit.door} via={{ press: 'complete', item: hit.id }} label={hit.label} onDone={onDone} master={master} />
}

/* ---------- Upload ---------- */

/** A pending paper, filed through the Hiring card's own Upload. */
export function UploadForm({ row, doc, onDone }: { row: Who; doc: string; onDone: () => void }) {
  const docs = useCandidateRead(readKey('candidateProfileDocuments', row.key), () => readDocuments(row.key), documentsOf)
  if (!docs.data) return <div className="pt-1"><ReadLine state={docs} what="the documents" onRetry={docs.reload} /></div>
  const hit = docs.data.docs.find((x) => x.id === doc) ?? null
  if (!hit) return <EmptyNote>This document is not on {row.name}&rsquo;s hiring record.</EmptyNote>
  if (!hit.upload) return <EmptyNote>{hit.title} is {hit.status === 'on_file' ? 'already on file' : 'not filed from here'}.</EmptyNote>
  return <DoorBody row={row} door={hit.upload} via={{ press: 'upload', item: hit.id }} label={hit.title} onDone={onDone} />
}

/* ---------- Add document ---------- */

/** Add document is the master's in its own session: anyone else is told so, and nothing is read. */
export function DocumentForm({ row, item, onDone }: { row: Who; item: string; onDone: () => void }) {
  const master = useEffectiveIsMaster()
  if (!master) return <EmptyNote>Only the master adds a document here.</EmptyNote>
  return <DocumentBody row={row} item={item} onDone={onDone} />
}

// A step's paper, dropped or picked: the decoder reads it and what it read is held against what the step asks for.
export function DocumentBody({ row, item, onDone }: { row: Who; item: string; onDone: () => void }) {
  const actions = useCandidateRead(readKey('candidateProfileActions', row.key), () => readActions(row.key), actionsOf)
  // which of the new hire's papers are on file already, only when the step offers a choice of them
  const choosing = !!actions.data?.items.find((x) => x.id === item)?.paper?.choices.length
  const docs = useCandidateRead(choosing ? readKey('candidateProfileDocuments', row.key) : null, () => readDocuments(row.key), documentsOf)
  const [doc, setDoc] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [reading, setReading] = useState(false)
  const [got, setGot] = useState<PaperReading | null>(null)
  const [err, setErr] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  // the background result the person files a background check with
  const [result, setResult] = useState('')
  if (!actions.data) return <div className="pt-1"><ReadLine state={actions} what="the actions" onRetry={actions.reload} /></div>
  const hit = actions.data.items.find((x) => x.id === item) ?? null
  if (!hit) return <EmptyNote>This step is not on {row.name}&rsquo;s hiring record.</EmptyNote>
  const paper = hit.paper
  if (!paper) return <EmptyNote>{hit.label} takes no document here.</EmptyNote>
  const choice = paper.choices.find((c) => c.doc_id === doc) ?? null
  const asks = choice ? choice.label : paper.asks
  const expects = choice ? choice.expects : paper.expects
  const needsChoice = paper.choices.length > 0
  const statuses = choice ? [] : paper.statuses
  // the background check's own row in the Documents section is 'cjis'; every other catalog paper's is doc_<id>
  const onFile = (d: string) => docs.data?.docs.some((x) => x.id === (d === 'background_check' ? 'cjis' : `doc_${d}`) && x.status === 'on_file') ?? false

  const read = async (f: File, which: string) => {
    setReading(true); setErr(''); setGot(null); setArmed('')
    try {
      const r = paperReadingOf(await addDocument(row.key, item, f, { doc: which, check: true }))
      setGot(r)
      setResult(r.cjis_status)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setReading(false)
    }
  }
  const pick = (f: File) => {
    const why = paperFileRefusal(f.name, f.size, paper.exts)
    if (why) { toast({ type: 'danger', title: 'Not this file', body: why }); return }
    setFile(f)
    void read(f, doc)
  }
  const reset = () => { setFile(null); setGot(null); setErr(''); setArmed(''); setResult('') }
  const press = async () => {
    if (!file || !got || (statuses.length > 0 && !result)) return
    const step = nextPress(armed, 'file')
    setArmed(step.armed)
    if (!step.act) return
    setBusy(true)
    const sentAt = Date.now()
    try {
      const r = paperReadingOf(await addDocument(row.key, item, file,
        { doc, confirmMismatch: !got.verified, cjisStatus: statuses.length ? result : undefined }))
      if (!r.filed) {
        setGot(r)
        toast({ type: 'danger', title: 'Nothing was written', body: r.why || 'The paper was not filed.' })
        return
      }
      candidateWrote(row.key, null, sentAt)
      const said = [row.name, r.where || paper.where, r.cjis_status ? `Background result: ${r.cjis_status}` : '',
        r.closes === false ? r.closes_why : ''].filter(Boolean).join(' · ')
      toast({ type: r.filing_why ? 'info' : 'success', title: `${asks} filed${r.override ? ' anyway' : ''}`,
        body: r.filing_why ? `${r.filing_why} ${said}` : said })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was written', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  const label = got && !got.verified ? 'File anyway' : 'Confirm'
  const stepWords = !got ? '' : statuses.length ? cjisResultWords(result)
    : got.closes === true ? 'Marked done' : got.closes === false ? got.closes_why || 'Stays open' : ''

  return (
    <div className="grid gap-5 pt-1" data-document-panel={item}>
      <div>
        <p className="text-[13px] font-semibold text-text-1">{hit.label}</p>
        <p className="mt-1 text-[12.5px] leading-5 text-text-2">
          The decoder reads the paper first and checks it is what this step asks for. Filed, it goes through the step&rsquo;s
          own Hiring door, so its status on the Hiring board follows.
        </p>
      </div>
      {needsChoice && (
        <Field label="Which document" required>
          <select value={doc} disabled={reading || busy} className={INPUT} data-paper-select=""
            onChange={(e) => { setDoc(e.target.value); reset() }}>
            <option value="">Choose the document</option>
            {paper.choices.map((c) => (
              <option key={c.doc_id} value={c.doc_id}>{c.label}{onFile(c.doc_id) ? ' (on file — a new one replaces it)' : ''}</option>
            ))}
          </select>
        </Field>
      )}
      <dl className="grid gap-1.5 text-[12.5px]" data-paper-asks="">
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-text-3">Asks for</dt><dd className="text-text-1">{asks || 'Choose the document first'}</dd></div>
        {expects && <div className="flex gap-2"><dt className="w-28 shrink-0 text-text-3">Must read as</dt><dd className="text-text-1">{expects}</dd></div>}
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-text-3">Filed in</dt><dd className="text-text-1">{paper.where}</dd></div>
      </dl>
      {file ? <SelectedFileCard file={file} disabled={reading || busy} onRemove={reset} /> : (
        <FileDropZone accept={paperAccept(paper.exts)} hint={`${paperExtsWords(paper.exts)} · up to 15MB`}
          disabled={needsChoice && !choice} onFile={pick} />
      )}
      {reading && (
        <p className="flex items-center gap-2 text-[12.5px] text-text-2" data-paper-reading="">
          <Loader2 size={13} className="animate-spin" /> Reading the document…
        </p>
      )}
      {err && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-paper-error="">
          The decoder could not read it: {err}
          {file && (
            <button type="button" onClick={() => void read(file, doc)} className={`${linkCls} inline-flex items-center gap-1`}>
              <RotateCcw size={12} /> Read again
            </button>
          )}
        </p>
      )}
      {got && file && (
        <PaperVerdict got={got} asks={asks} name={row.name} onReadAgain={reading || busy ? undefined : () => void read(file, doc)} />
      )}
      {got && file && statuses.length > 0 && (
        <div className="grid gap-1.5">
          <Field label="Background result" required>
            <select value={result} disabled={busy} className={INPUT} data-cjis-result=""
              onChange={(e) => { setResult(e.target.value); setArmed('') }}>
              {!result && <option value="">Choose the result</option>}
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <p className="text-[12px] leading-5 text-text-3" data-cjis-said="">
            {got.cjis_on_file ? `On the Hiring record now: ${got.cjis_on_file}. ` : ''}
            Suggested from the reading: {got.cjis_status || 'Pending'}. The result is a person&rsquo;s call — the reading only
            suggests it.
          </p>
        </div>
      )}
      {got && file && armed === 'file' && (
        <div className={REVIEW} data-review="">
          <p className="mb-1 font-semibold text-text-1">This is what will be written on the hiring record:</p>
          <p><span className="text-text-3">For:</span> {row.name}</p>
          <p><span className="text-text-3">Document:</span> {asks} — {file.name}</p>
          <p><span className="text-text-3">Filed in:</span> {paper.where}</p>
          {statuses.length > 0 && <p data-review-result=""><span className="text-text-3">Background result:</span> {result}</p>}
          {stepWords && <p data-review-step=""><span className="text-text-3">{hit.label}:</span> {stepWords}</p>}
          {!got.verified && <p><span className="text-text-3">Reading:</span> filed over it — {paperVerdictWords(got, asks, row.name).pill.label}</p>}
        </div>
      )}
      {got && file && (
        <DraftButtons armed={armed === 'file'} busy={busy} disabled={reading || (statuses.length > 0 && !result)} label={label}
          armedLabel={`${label} — press again`} onPress={() => void press()} onDisarm={() => setArmed('')} onCancel={onDone} />
      )}
    </div>
  )
}

// What the decoder read against what the step asks, and — when it is not the paper asked — what filing it anyway…
export function PaperVerdict({ got, asks, name, onReadAgain }: {
  got: PaperReading
  asks: string
  name: string
  onReadAgain?: () => void
}) {
  const words = paperVerdictWords(got, asks, name)
  const lines = got.reason === 'unread' ? [] : readingLines(got, name)
  return (
    <div className="grid gap-3" data-paper-verdict={got.verified ? 'match' : 'mismatch'} data-paper-reason={got.reason}>
      <div className={REVIEW}>
        <div className="mb-2 flex items-center gap-2">
          <Pill meta={words.pill} />
          <span className="text-text-3">Asked for {asks}</span>
        </div>
        {lines.length > 0 && (
          <dl className="grid gap-1">
            {lines.map((l) => (
              <div key={l.label} className="flex gap-2"><dt className="w-24 shrink-0 text-text-3">{l.label}</dt><dd className="text-text-1">{l.value}</dd></div>
            ))}
          </dl>
        )}
        {got.why && <p className="mt-2 text-text-2">{got.why}</p>}
        {got.reason === 'unread' && onReadAgain && (
          <button type="button" onClick={onReadAgain} className={`${linkCls} mt-2 inline-flex items-center gap-1`} data-paper-read-again="">
            <RotateCcw size={12} /> Read again
          </button>
        )}
      </div>
      {words.warning && (
        <p className="flex items-start gap-2 rounded-md bg-tint-danger px-3 py-2 text-[12.5px] leading-5 text-tint-fg-danger" data-paper-warning="">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {words.warning}
        </p>
      )}
    </div>
  )
}

/* ---------- the editions' own panels (Python's doors: Information, preferences, a note, a document) ---------- */

/** The second press of an edition's form (Locations' own words). */
const applyChanges = (n: number) => `Apply ${n} change${n === 1 ? '' : 's'}`

/** An edition's panel read, fresh each time the panel opens: what is saved is checked against exactly this. */
function useEditRead(row: Who, section: EditSection | 'document' | 'note', extra: { doc?: string; id?: string } = {}) {
  const [opened] = useState(() => String(Date.now()))
  const key = readKey('candidateProfileEditRead', row.key, section, extra.doc ?? extra.id ?? '', opened)
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

/** Information or the screen's preferences on the shared record panel, applied through the strip. */
export function EditCandidateForm({ row, section, onDone }: { row: Who; section: EditSection; onDone: () => void }) {
  const read = useEditRead(row, section)
  const edit = read.data
  const fields = useMemo(() => edit?.fields ?? [], [edit])
  const target = useMemo(() => candidateTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const rereads = section === 'preferences' ? [CANDIDATE_REREAD.interviews(row.key)] : [CANDIDATE_REREAD.overview(row.key)]
  const file = async (changes: EditChange[]) => {
    try {
      return editAnswerOf(await apply.run(() => saveCandidate(row.key, section, changes), rereads))
    } catch (e) {
      // a stale field: the candidate is read again, so the form shows what the record holds now
      candidateWritten(row.key)
      throw e
    }
  }
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-candidate={section}>
      <ReadLine state={read} what={section === 'preferences' ? 'the preferences' : 'the details'} onRetry={read.reload} />
      {edit && (
        <RecordEditBody fields={fields} onFile={file} onDone={onDone} stay applyLabel={applyChanges}
          locked={apply.state.phase === 'running'} intro={editIntro(section, row.name)} />
      )}
      {edit && <KeptElsewhere edit={edit} />}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}

/** A note on the hiring journey: its text changed, or the note removed on a second press. */
export function NoteEditForm({ row, id, onDone }: { row: Who; id: string; onDone: () => void }) {
  const read = useEditRead(row, 'note', { id })
  const edit = read.data
  const fields = useMemo(() => edit?.fields ?? [], [edit])
  const target = useMemo(() => candidateTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const [armed, setArmed] = useState('')
  const rereads = [CANDIDATE_REREAD.activity(row.key), CANDIDATE_REREAD.overview(row.key)]
  const file = async (changes: EditChange[]) => {
    try {
      return editAnswerOf(await apply.run(() => editNote(row.key, id, changes), rereads))
    } catch (e) {
      candidateWritten(row.key)
      throw e
    }
  }
  const remove = async () => {
    const step = nextPress(armed, 'remove')
    setArmed(step.armed)
    if (!step.act) return
    try {
      await apply.run(() => editNote(row.key, id, [{ field: 'state', value: 'removed', expected: 'open' }]), rereads)
    } catch (e) {
      candidateWritten(row.key)
      toast({ type: 'danger', title: 'Not removed', body: errText(e) })
    }
  }
  const running = apply.state.phase === 'running'
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-note-edit={id}>
      <ReadLine state={read} what="the note" onRetry={read.reload} />
      {edit && (
        <p className="text-[12px] text-text-3" data-note-filed="">{[edit.by, stampWords(edit.at)].filter(Boolean).join(' · ')}</p>
      )}
      {edit && (
        <RecordEditBody fields={fields} onFile={file} onDone={onDone} stay applyLabel={applyChanges} locked={running}
          intro={editIntro('note', row.name)} />
      )}
      {edit && apply.state.phase === 'idle' && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3" data-note-remove="">
          <p className="text-[12px] leading-4 text-text-3">A removed note leaves the Activity Log.</p>
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

/** A filed document reviewed: Verified or Returned, its own days and notes. */
export function DocReviewForm({ row, doc, onDone }: { row: Who; doc: string; onDone: () => void }) {
  const read = useEditRead(row, 'document', { doc })
  const edit = read.data
  const fields = useMemo(() => edit?.fields ?? [], [edit])
  const target = useMemo(() => candidateTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const file = async (changes: EditChange[]) => {
    try {
      return editAnswerOf(await apply.run(() => reviewDoc(row.key, doc, changes), [CANDIDATE_REREAD.documents(row.key)]))
    } catch (e) {
      candidateWritten(row.key)
      throw e
    }
  }
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-doc-review={doc}>
      <ReadLine state={read} what="the document" onRetry={read.reload} />
      {edit && (
        <p className="text-[13px] font-semibold text-text-1" data-doc-label="">
          {edit.label}{edit.file ? <span className="font-normal text-text-3"> · {edit.file}</span> : null}
        </p>
      )}
      {edit && (
        <RecordEditBody fields={fields} onFile={file} onDone={onDone} stay applyLabel={applyChanges}
          locked={apply.state.phase === 'running'} intro={editIntro('document', row.name)} />
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}
