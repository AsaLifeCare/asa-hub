// File training document, in the one right panel: the course (the person's courses as Compliance lists them, by the…
// A paper filed earlier and not yet confirmed is continued from, never filed again.
import { useMemo, useRef, useState } from 'react'
import { FileText, Loader2, RotateCw } from 'lucide-react'
import { FileDropZone, SelectedFileCard, fileToBase64, humanSize, inferMime } from '@/features/hiring/shared'
import { usePlatformDoc } from '@/lib/platformDoc'
import { Field, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import {
  complianceOf, courseWords, dateWords, filingCourses, kindWords, paperDay, paperSeen, readRefusal, waitingPapers,
  type DateRole, type FilingCourse, type PaperRow, type RosterRow, type StaffCompliance, type WaitingPaper,
} from './staffModel'
import { fileDocument, readCompliance, readKey, staffWrote, useStaffRead, type ReadState } from './useStaffRead'
import {
  FILED_NO_ID, NEXT_PASS, PAPER_TYPES, openPaper, paperRefusal, paperWarning, useTrainingPaper, type PaperState,
} from './trainingPaper'
import { ReadLine } from './StaffParts'
import { Review } from './StaffForms'

/* ---------- the panel ---------- */

export function TrainingDocForm({ row, course: preset, onDone }: { row: RosterRow; course: string; onDone: () => void }) {
  const compliance = useStaffRead(readKey('staffProfileCompliance', row.key), () => readCompliance(row.key), complianceOf)
  const courses = useMemo(() => filingCourses(compliance.data), [compliance.data])
  const waiting = useMemo(() => waitingPapers(compliance.data?.papers ?? [], courses), [compliance.data, courses])
  const [reqId, setReqId] = useState(preset)
  const [paper, setPaper] = useState<File | null>(null)
  const [refused, setRefused] = useState('')
  const [armed, setArmed] = useState('')
  const [typed, setTyped] = useState<string | null>(null)
  // set from the second press until the filing answers: encoding a large file must not leave the button live
  const [sending, setSending] = useState(false)
  const sendingNow = useRef(false)
  const flow = useTrainingPaper(row)
  const doc = usePlatformDoc(readRefusal)
  const course = courses.find((c) => c.reqId === reqId) ?? null
  const s = flow.state
  const role: DateRole = s.record.dateRole || course?.dateRole || ''
  const date = typed ?? paperDay(s.reading, role)

  const pick = (f: File) => {
    const why = paperRefusal(f)
    setRefused(why)
    setPaper(why ? null : f)
    setArmed('')
  }

  const file = async () => {
    if (!course || !paper || sendingNow.current) return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    sendingNow.current = true
    setSending(true)
    try {
      let base64 = ''
      try {
        base64 = await fileToBase64(paper)
      } catch {
        setRefused('The file could not be read from this device.')
        return
      }
      await flow.file(course.reqId, { filename: paper.name, mime: inferMime(paper), base64 })
    } finally {
      sendingNow.current = false
      setSending(false)
    }
  }

  const resume = (p: PaperRow) => {
    setReqId(p.reqId)
    setTyped(null)
    void flow.resume(p)
  }

  const meta = { title: course?.label || s.filed?.cert || 'Training document', subtitle: `${row.name} · filed document` }
  const open = () => {
    if (s.filed) openPaper(doc, s.filed.id, meta)
  }

  const confirm = async (day: string) => {
    if (!(await flow.confirm(day))) return
    toast({ type: 'success', title: 'Date confirmed', body: `${row.name} · ${course?.label || s.filed?.cert || ''} · ${day}` })
  }

  if (s.phase === 'idle' || s.phase === 'filing') {
    return (
      <PaperChooser name={row.name} compliance={compliance} onRetry={compliance.reload} courses={courses} course={course}
        waiting={waiting} onResume={resume}
        onCourse={(id) => { setReqId(id); setArmed('') }} paper={paper} refused={refused} onPick={pick}
        onClear={() => { setPaper(null); setArmed('') }} armed={armed === 'file'} busy={s.phase === 'filing' || sending}
        error={s.error} onFile={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    )
  }
  return (
    <PaperResult name={row.name} course={course} state={s} role={role} date={date} onDate={setTyped}
      onReadAgain={flow.readAgain} onReadRecord={flow.reloadRecord} onConfirm={(d) => void confirm(d)} onOpen={open}
      opening={!!s.filed && doc.opening === s.filed.id} onDone={onDone} />
  )
}

const SELECT_GROUPS: FilingCourse['group'][] = ['Training', 'Credentials']

export function PaperChooser({
  name, compliance, onRetry, courses, course, waiting = [], onResume, onCourse, paper, refused, onPick, onClear, armed, busy,
  error, onFile, onDisarm, onCancel,
}: {
  name: string
  compliance: ReadState<StaffCompliance>
  onRetry: () => void
  courses: FilingCourse[]
  course: FilingCourse | null
  /** papers filed earlier and not yet confirmed, continued from without filing again */
  waiting?: WaitingPaper[]
  onResume?: (p: PaperRow) => void
  onCourse: (reqId: string) => void
  paper: File | null
  refused: string
  onPick: (f: File) => void
  onClear: () => void
  armed: boolean
  busy: boolean
  error: string
  onFile: () => void
  onDisarm: () => void
  onCancel: () => void
}) {
  const warning = paper ? paperWarning(paper) : ''
  const answered = compliance.data
  return (
    <div className="grid gap-4 pt-1" data-filedoc-form="">
      <p className="text-[13px] leading-[1.55] text-text-2">
        {name}’s certificate — DODD, CPR, Mandt or another course — filed on their record, read for its dates by the
        decoder, then written into the Employee Database when you confirm the date.
      </p>
      <ReadLine state={compliance} what="the courses" onRetry={onRetry} />
      {waiting.length > 0 && onResume && (
        <div className={TILE} data-filedoc-waiting="">
          <p className={TILE_HEAD}>Filed, waiting for a confirmed date</p>
          <ul className="grid gap-2">
            {waiting.map(({ paper: p, course: c }) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2" data-waiting-paper={p.id}>
                <span className="min-w-0 text-[12.5px] leading-5 text-text-1">
                  <span className="font-semibold">{c.label}</span>
                  <span className="break-all text-text-3">{` · ${p.name || 'the document'}${p.at ? ` · filed ${dateWords(p.at)}` : ''}`}</span>
                </span>
                <button type="button" disabled={busy} onClick={() => onResume(p)} className={SMALL_BTN} data-resume-paper={p.id}>
                  Continue
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {answered && courses.length === 0 && (
        <p role="status" className="text-[12.5px] leading-5 text-[var(--warning)]" data-filedoc-none="">
          No course here takes a paper: {answered.why || 'the catalogue names none for this person'}.
          {answered.degraded && (
            <button type="button" onClick={onRetry} className="ml-2 font-semibold text-text-1 underline">Read again</button>
          )}
        </p>
      )}
      <Field label="Course" required>
        <select value={course?.reqId ?? ''} disabled={busy} onChange={(e) => onCourse(e.target.value)} className={inputCls}
          data-filedoc-course="">
          <option value="">Choose a course</option>
          {SELECT_GROUPS.map((g) => {
            const list = courses.filter((c) => c.group === g)
            return list.length ? (
              <optgroup key={g} label={g}>
                {list.map((c) => <option key={c.reqId} value={c.reqId}>{courseWords(c)}</option>)}
              </optgroup>
            ) : null
          })}
        </select>
      </Field>
      {course && (
        <p className="text-[12px] leading-5 text-text-3" data-filedoc-column={course.masterHeader}>
          {course.masterHeader
            ? `Its date lands in the Employee Database column “${course.masterHeader}”, on ${name}’s row — the row carrying the Employee ID on their People record, else the row with their name (its Active one when the name is on more than one row).`
            : 'The catalogue names no Employee Database column for this course.'}
        </p>
      )}
      {course?.confirmWhy && (
        <p className="text-[12px] leading-5 text-[var(--warning)]" data-filedoc-shut="">
          {course.confirmWhy} The document is still filed and read.
        </p>
      )}
      {paper
        ? <SelectedFileCard file={paper} disabled={busy} onRemove={onClear} />
        : <FileDropZone accept="application/pdf,image/*,.pdf,.heic,.heif" disabled={busy} onFile={onPick}
            hint={`${PAPER_TYPES} · up to 15MB`} />}
      {warning && <p className="text-[12px] leading-5 text-[var(--warning)]" data-filedoc-heic="">{warning}</p>}
      {refused && <p role="alert" className="text-[12.5px] text-[var(--danger)]">{refused}</p>}
      {error && <p role="alert" className="text-[12.5px] text-[var(--danger)]" data-filedoc-error="">{error}</p>}
      {armed && course && paper && (
        <Review lines={[['Staff member', name], ['Course', course.label], ['Employee Database column', course.masterHeader],
          ['File', `${paper.name} · ${humanSize(paper.size)}`]]} />
      )}
      {busy && (
        <p role="status" className="flex items-center gap-2 text-[12.5px] text-text-2">
          <Loader2 size={13} className="animate-spin" /> Filing the document…
        </p>
      )}
      <DraftButtons armed={armed} busy={busy} disabled={!course || !paper} label={busy ? 'Filing…' : undefined}
        armedLabel="File and read — press again" onPress={onFile} onDisarm={onDisarm} onCancel={onCancel} />
    </div>
  )
}

const TILE = 'grid gap-1.5 rounded-lg border border-border px-3 py-2.5'
const TILE_HEAD = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3'
const SMALL_BTN = 'inline-flex h-8 w-fit items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-40'

const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s)

export function PaperResult({
  name, course, state, role, date, onDate, onReadAgain, onReadRecord, onConfirm, onOpen, opening, onDone,
}: {
  name: string
  course: FilingCourse | null
  state: PaperState
  role: DateRole
  date: string
  onDate: (d: string) => void
  onReadAgain: () => void
  /** reads the record again after a read that failed — the paper already filed stays the one confirmed */
  onReadRecord: () => void
  onConfirm: (d: string) => void
  onOpen: () => void
  opening: boolean
  onDone: () => void
}) {
  const { filed, reading, record } = state
  const close = (
    <div className="flex justify-end border-t border-border pt-3">
      <button type="button" onClick={onDone} data-filedoc-done=""
        className="inline-flex h-10 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-medium text-text-1 hover:bg-surface-2">
        {state.confirmedOn ? 'Done' : 'Close'}
      </button>
    </div>
  )
  if (!filed) {
    return (
      <div className="grid gap-4 pt-1" data-filedoc-result="">
        <p role="alert" className="text-[12.5px] text-[var(--warning)]">{state.error || FILED_NO_ID}</p>
        {close}
      </div>
    )
  }
  const issued = role === 'issued'
  const seen = paperSeen(reading, role)
  const settled = !!reading && (reading.readState === 'read' || reading.readState === 'unread')
  const column = record.dateSource || course?.masterHeader || ''
  const can = record.status === 'ready' && record.allowed && isDay(date) && !state.confirming
  return (
    <div className="grid gap-3 pt-1" data-filedoc-result={filed.id}>
      <div className={TILE} data-paper-filed="">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-text-1">
          <FileText size={15} className="shrink-0 text-text-2" /> <span className="min-w-0 break-all">{filed.name || 'The document'}</span>
        </p>
        <p className="text-[12px] text-text-3">Filed on {filed.person || name}’s record{filed.cert ? ` · ${filed.cert}` : ''}</p>
        <button type="button" onClick={onOpen} disabled={opening} className={SMALL_BTN} data-open-paper="">
          {opening && <Loader2 size={13} className="animate-spin" />} View document
        </button>
      </div>

      <div className={TILE} data-paper-reading={state.phase === 'reading' ? 'reading' : state.waiting ? 'waiting' : reading?.readState || ''}>
        <p className={TILE_HEAD}>The decoder’s reading</p>
        {state.phase === 'reading' ? (
          <p role="status" className="flex items-center gap-2 text-[12.5px] text-text-2">
            <Loader2 size={13} className="animate-spin" /> Reading the dates… A reading can take a few minutes.
          </p>
        ) : state.waiting ? (
          <>
            <p role="status" className="text-[12.5px] leading-5 text-[var(--warning)]">{state.waiting}</p>
            <p className="text-[12px] leading-5 text-text-3">{NEXT_PASS}</p>
            <button type="button" onClick={onReadAgain} className={SMALL_BTN} data-read-again="">
              <RotateCw size={13} /> Read again
            </button>
          </>
        ) : reading ? (
          <>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
              <dt className="text-text-3">Reads as</dt><dd className="text-text-1" data-paper-kind="">{kindWords(reading) || '—'}</dd>
              <dt className="text-text-3">Issued</dt><dd className="text-text-1" data-paper-issued="">{dateWords(reading.issuedOn) || '—'}</dd>
              <dt className="text-text-3">Expires</dt><dd className="text-text-1" data-paper-expires="">{dateWords(reading.expiresOn) || '—'}</dd>
              <dt className="text-text-3">Confidence</dt>
              <dd className="text-text-1" data-paper-confidence="">{reading.confidence !== null ? `${reading.confidence} of 100` : '—'}</dd>
            </dl>
            {reading.readState === 'read'
              ? <p className="text-[12px] text-[var(--success)]">The decoder settled on these dates.</p>
              : <p className="text-[12px] leading-5 text-[var(--warning)]">{reading.readWhy || 'No date was settled from this file.'}</p>}
          </>
        ) : null}
      </div>

      <div className={TILE} data-paper-record="">
        <p className={TILE_HEAD}>Employee Database{column ? ` · ${column}` : ''}</p>
        <p className="text-[12.5px] font-semibold text-text-1" data-record-value="">
          Holds now: {record.status === 'loading' || record.status === 'idle' ? 'reading…'
            : record.status === 'failed' ? 'could not be read' : dateWords(record.value) || 'nothing on file'}
        </p>
        {record.why && <p className="text-[12px] leading-5 text-[var(--warning)]">{record.why}</p>}
        {record.status === 'failed' && (
          <button type="button" onClick={onReadRecord} className={SMALL_BTN} data-read-record="">
            <RotateCw size={13} /> Read the record again
          </button>
        )}
        {state.moved !== null && (
          <p className="text-[12px] leading-5 text-[var(--danger)]" data-record-moved="">
            The record changed to “{dateWords(state.moved) || 'nothing'}” since it was shown — confirming now writes over that.
          </p>
        )}
        {record.status === 'ready' && record.allowed && (
          <>
            {settled && !paperDay(reading, role) && (
              <p className="text-[12px] text-text-3">No date was settled from this file — type the date shown on the document.</p>
            )}
            {seen && seen !== date && (
              <button type="button" onClick={() => onDate(seen)} className={SMALL_BTN} data-use-seen={seen}>
                Use {dateWords(seen)}, as the decoder saw it
              </button>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-[12px] font-medium text-text-2">
                {issued ? 'Date of the document' : 'Expiry date'}
                <input type="date" value={date} disabled={state.confirming} onChange={(e) => onDate(e.target.value)}
                  className={cn(inputCls, 'w-[170px]')} data-confirm-date="" />
              </label>
              <button type="button" disabled={!can} onClick={() => onConfirm(date)} data-confirm-paper=""
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40">
                {state.confirming && <Loader2 size={14} className="animate-spin" />}
                {state.moved !== null ? `Confirm against “${dateWords(state.moved) || 'nothing'}”` : 'Confirm this date'}
              </button>
            </div>
          </>
        )}
        {state.said && (
          <p role={state.said.tone === 'danger' ? 'alert' : 'status'} data-confirm-said={state.said.tone}
            className={cn('text-[12.5px] leading-5', state.said.tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>
            {state.said.text}
          </p>
        )}
      </div>
      {close}
    </div>
  )
}

/* ---------- a Documents row's paper ---------- */

/** Upload the paper a Documents row names: filed in Drive under the row's title, where the list finds it again. */
export function DocUploadForm({ row, doc, onDone }: { row: RosterRow; doc: string; onDone: () => void }) {
  const [paper, setPaper] = useState<File | null>(null)
  const [refused, setRefused] = useState('')
  const [error, setError] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = (f: File) => {
    const why = paperRefusal(f)
    setRefused(why)
    setPaper(why ? null : f)
    setArmed('')
  }
  const file = async () => {
    if (!paper || busy) return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    setError('')
    try {
      let base64 = ''
      try {
        base64 = await fileToBase64(paper)
      } catch {
        setRefused('The file could not be read from this device.')
        return
      }
      const got = await fileDocument({ person: row.name, cert: doc, filename: paper.name, mime: inferMime(paper), base64 })
      staffWrote(row.key, got)
      toast({ type: 'success', title: 'Document uploaded', body: `${row.name} · ${doc}` })
      onDone()
    } catch (e) {
      setError(readRefusal(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }
  const warning = paper ? paperWarning(paper) : ''
  return (
    <div className="grid gap-4 pt-1" data-docupload-form={doc}>
      {paper
        ? <SelectedFileCard file={paper} disabled={busy} onRemove={() => { setPaper(null); setArmed('') }} />
        : <FileDropZone accept="application/pdf,image/*,.pdf,.heic,.heif" disabled={busy} onFile={pick}
            hint={`${PAPER_TYPES} · up to 15MB`} />}
      {warning && <p className="text-[12px] leading-5 text-[var(--warning)]">{warning}</p>}
      {refused && <p role="alert" className="text-[12.5px] text-[var(--danger)]">{refused}</p>}
      {error && <p role="alert" className="text-[12.5px] text-[var(--danger)]" data-docupload-error="">{error}</p>}
      {armed === 'file' && paper && (
        <Review lines={[['Staff member', row.name], ['Document', doc], ['File', `${paper.name} · ${humanSize(paper.size)}`]]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!paper} label={busy ? 'Uploading…' : undefined}
        armedLabel="Upload — press again" onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}
