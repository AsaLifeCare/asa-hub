// The right panel's forms and the Overview's note composer: an admin note, a call to schedule, a new incident…
// Each files on the second press; a write forgets the family member's answers, so the card, the panel and Activity…
import { useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import RecordEditBody from '@/components/shared/RecordEditBody'
import { editAnswerOf, type EditChange } from '@/lib/recordEdit'
import { Field, inputCls } from '@/pages/features/clientops/OpsPageShell'
import ApplyStrip, { useApplyFor } from '@/pages/features/locations/ApplyStrip'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { NewIncidentForm } from '@/pages/features/clientprofiles/ClientForms'
import { ohioToday } from '@/lib/ohio'
import { useFamilyDetailsHidden } from '@/lib/stamps'
import { useShellHides } from '@/lib/myWorkHides'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import {
  CALL_CANCEL, CALL_PRIORITIES, DETAILS_MAX, NOTE_MAX, NOTE_REMOVE, callEditFields, callMissing, familyAdminEditOf,
  familyEditFields, familyEditOf, incidentClients, noteEditFields, notesOf, overviewOf, priorityLabel, readRefusal, stampWords,
  type CallPriority, type FamilyClient, type FamilyNote, type RosterRow,
} from './familyModel'
import {
  FAMILY_REREAD, QUEUED_WORDS, addNote, editCall, editNote, familyTarget, familyWritten, familyWrote, readAdminEdit, readEdit,
  readKey, readNotes, readOverview, saveFamily, scheduleCall, tieFiled, useFamilyRead, type ReadState,
} from './useFamilyRead'
import { ReadLine, WhyLines } from './FamilyParts'

const TEXTAREA = 'min-h-[96px] w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export const NOTE_PLACEHOLDER = 'Add a note about this family member…'

const errText = (e: unknown): string => readRefusal(e instanceof Error ? e.message : String(e))

function Review({ lines }: { lines: [string, string][] }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-review="">
      <p className="mb-1 font-semibold text-text-1">This is what will be filed:</p>
      {lines.filter(([, v]) => v).map(([k, v]) => <p key={k} className="whitespace-pre-wrap"><span className="text-text-3">{k}:</span> {v}</p>)}
    </div>
  )
}

/* ---------- the admin notes ---------- */

/** One note being written for a family member: the text, the armed press and the filing. */
function useNoteDraft(row: Pick<RosterRow, 'key' | 'name'>) {
  const [body, setBody] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const text = body.trim()
  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    const sentAt = Date.now()
    try {
      const got = await addNote(row.key, text)
      const queued = familyWrote(row.key, got, sentAt)
      toast({ type: 'success', title: queued ? 'Note accepted' : 'Note saved', body: queued ? QUEUED_WORDS : row.name })
      setBody('')
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return {
    body, text, armed: armed === 'file', busy, file,
    edit: (v: string) => { setBody(v); setArmed('') },
    disarm: () => setArmed(''),
  }
}

/** The notes on file, newest first, or the sentence for none; `onEdit` opens one note's panel (the notes edition's). */
export function NotesList({ notes, onRetry, onEdit }: {
  notes: ReadState<{ notes: FamilyNote[] }>
  onRetry: () => void
  onEdit?: (id: string) => void
}) {
  const list = notes.data?.notes ?? []
  return (
    <div className="grid gap-2" data-notes="">
      <ReadLine state={notes} what="the admin notes" onRetry={onRetry} />
      {notes.data && list.length === 0 && <p className="text-[13px] text-text-3" data-no-notes="">No admin notes yet.</p>}
      {list.length > 0 && (
        <ul className="grid gap-2">
          {list.map((n) => (
            <li key={n.id} data-note={n.id} className="rounded-lg border border-border px-3 py-2.5">
              <p className="whitespace-pre-wrap text-[13px] leading-5 text-text-1">{n.body}</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-text-3">
                <span>{[n.by, stampWords(n.at)].filter(Boolean).join(' · ')}</span>
                {onEdit && (
                  <button type="button" onClick={() => onEdit(n.id)} data-edit-note-open={n.id}
                    className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary-soft">
                    Edit
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The Overview card's composer: the text, then "Save note", which files on its second press. */
export function NoteComposer({ row }: { row: Pick<RosterRow, 'key' | 'name'> }) {
  const d = useNoteDraft(row)
  return (
    <div className="grid gap-2" data-note-composer="">
      <textarea value={d.body} disabled={d.busy} maxLength={NOTE_MAX} placeholder={NOTE_PLACEHOLDER} aria-label="Admin note"
        className={TEXTAREA} onChange={(e) => d.edit(e.target.value)} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {d.armed && <button type="button" onClick={d.disarm} className="text-[12.5px] text-text-3 hover:text-text-1">Keep editing</button>}
        <button type="button" onClick={() => void d.file()} disabled={!d.text || d.busy} data-press={d.armed ? 'file' : 'review'}
          className={cn('inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40',
            d.armed ? 'bg-primary hover:bg-primary-hover' : 'bg-[var(--success)] hover:opacity-90')}>
          {d.busy && <Loader2 size={14} className="animate-spin" />}
          {d.armed ? 'Save note — press again' : 'Save note'}
        </button>
      </div>
    </div>
  )
}

/** The right panel's note form: the note, what will be filed, and the notes on file (each one's own panel by `onEdit`). */
export function NoteForm({ row, onDone, onEdit }: {
  row: Pick<RosterRow, 'key' | 'name'>
  onDone: () => void
  onEdit?: (id: string) => void
}) {
  const notes = useFamilyRead(readKey('familyProfileNotes', row.key), () => readNotes(row.key), notesOf)
  const d = useNoteDraft(row)
  return (
    <div className="grid gap-5 pt-1" data-notes-panel="">
      <Field label="Note" required>
        <textarea value={d.body} disabled={d.busy} maxLength={NOTE_MAX} placeholder={NOTE_PLACEHOLDER} className={TEXTAREA}
          onChange={(e) => d.edit(e.target.value)} />
      </Field>
      {d.armed && <Review lines={[['For', row.name], ['Note', d.text]]} />}
      <DraftButtons armed={d.armed} busy={d.busy} disabled={!d.text} armedLabel="Save note — press again"
        onPress={() => void d.file()} onDisarm={d.disarm} onCancel={onDone} />
      <div className="border-t border-border pt-4">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Notes on file</h3>
        <NotesList notes={notes} onRetry={notes.reload} onEdit={onEdit} />
      </div>
    </div>
  )
}

/* ---------- the associated clients, for the call and the incident ---------- */

/** The family member's clients from the overview (held, so drawn at once); null while it is read. */
function useFamilyClients(row: Pick<RosterRow, 'key'>): { read: ReadState<unknown> & { reload: () => void }; clients: FamilyClient[] | null } {
  const read = useFamilyRead(readKey('familyProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  return { read, clients: read.data ? read.data.clients : null }
}

/** The client a form is for: the current ones first, the first of them picked. */
const firstClient = (clients: FamilyClient[]): string => clients[0]?.client_key ?? ''

function ClientSelect({ clients, value, disabled, onChange }: {
  clients: FamilyClient[]
  value: string
  disabled: boolean
  onChange: (key: string) => void
}) {
  return (
    <select value={value} disabled={disabled || clients.length < 2} onChange={(e) => onChange(e.target.value)} className={inputCls}
      data-field="client_key">
      {clients.map((c) => (
        <option key={c.client_key} value={c.client_key}>
          {[c.name, c.relationship].filter(Boolean).join(' · ')}{c.status === 'inactive' ? ' (inactive)' : ''}
        </option>
      ))}
    </select>
  )
}

/* ---------- a call to schedule ---------- */

export function CallForm({ row, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; onDone: () => void }) {
  const { read, clients } = useFamilyClients(row)
  const today = ohioToday()
  const [client, setClient] = useState('')
  const [date, setDate] = useState(today)
  const [priority, setPriority] = useState<CallPriority>('normal')
  const [details, setDetails] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  if (!clients) return <div className="pt-1"><ReadLine state={read} what="the clients" onRetry={read.reload} /></div>
  if (!clients.length) {
    return <p className="pt-1 text-[13px] text-text-3" data-no-clients="">No client is associated with {row.name}, so no call can be tied to one.</p>
  }
  const clientKey = clients.some((c) => c.client_key === client) ? client : firstClient(clients)
  const clientName = clients.find((c) => c.client_key === clientKey)?.name ?? ''
  const missing = callMissing({ client_key: clientKey, date }, today)
  const edit = (fn: () => void) => { fn(); setArmed('') }

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    const sentAt = Date.now()
    try {
      const got = await scheduleCall({ family: row.key, client_key: clientKey, date, priority, details: details.trim() })
      // a call is a card on the Task Board: what the index holds is unchanged
      const queued = familyWrote(row.key, got, sentAt, false)
      toast({ type: 'success', title: queued ? 'Call accepted' : 'Call scheduled', body: queued ? QUEUED_WORDS : `${row.name} · ${clientName}` })
      // the door says where the call is kept
      const said = (got as { notes?: unknown } | null)?.notes
      if (Array.isArray(said) && said.length) toast({ type: 'info', title: 'Where the call is kept', body: said.map(String).join(' ') })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not scheduled', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-call-form="">
      <Field label="For"><input value={row.name} readOnly className={cn(inputCls, 'bg-surface-2')} data-field="family" /></Field>
      <Field label="Associated client" required>
        <ClientSelect clients={clients} value={clientKey} disabled={busy} onChange={(k) => edit(() => setClient(k))} />
      </Field>
      <Field label="Date" required>
        <input type="date" value={date} min={today} disabled={busy} onChange={(e) => edit(() => setDate(e.target.value))} className={inputCls}
          data-field="date" />
      </Field>
      <Field label="Priority">
        <select value={priority} disabled={busy} onChange={(e) => edit(() => setPriority(e.target.value as CallPriority))} className={inputCls}
          data-field="priority">
          {CALL_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
      <Field label="Details">
        <textarea value={details} disabled={busy} maxLength={DETAILS_MAX} placeholder="What the call is about…" className={TEXTAREA}
          onChange={(e) => edit(() => setDetails(e.target.value))} data-field="details" />
      </Field>
      {missing.length > 0 && <p className="text-[12px] text-text-3">Still needed: {missing.join(', ')}.</p>}
      {armed === 'file' && (
        <Review lines={[['For', row.name], ['Associated client', clientName], ['Date', stampWords(date)], ['Priority', priorityLabel(priority)],
          ['Details', details.trim()]]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={missing.length > 0} armedLabel="Schedule call — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- a new incident ---------- */

// Clients' own New incident form and door (the estate's UI Reports), for one of the associated clients — the first…
export function IncidentForm({ row, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; onDone: () => void }) {
  const { read, clients } = useFamilyClients(row)
  const [client, setClient] = useState('')
  const incidentBare = useShellHides().incident_notes
  if (!clients) return <div className="pt-1"><ReadLine state={read} what="the clients" onRetry={read.reload} /></div>
  if (!clients.length) {
    return <p className="pt-1 text-[13px] text-text-3" data-no-clients="">No client is associated with {row.name}, so no incident can be filed from here.</p>
  }
  const clientKey = clients.some((c) => c.client_key === client) ? client : firstClient(clients)
  const target = incidentClients(clients).find((c) => c.client_key === clientKey)
  return (
    <div className="grid gap-4 pt-1" data-family-incident={clientKey}>
      <Field label="Associated client" required>
        <ClientSelect clients={clients} value={clientKey} disabled={false} onChange={setClient} />
      </Field>
      {!incidentBare && <p className="text-[12.5px] text-text-3" data-incident-tie="">Once filed, it shows in {row.name}'s activity.</p>}
      {target && (
        <NewIncidentForm key={target.client_key} client={target}
          onFiled={(sent) => void tieFiled(row, target.client_key, sent.timestamp ?? '')}
          onDone={() => {
            familyWrote(row.key, null, undefined, false)
            onDone()
          }} />
      )}
    </div>
  )
}

/* ---------- the member's details ---------- */

/** The second press of an edition's form (Locations' own words). */
const applyChanges = (n: number) => `Apply ${n} change${n === 1 ? '' : 's'}`

// The member's details on the shared record panel: name, phone, email and address land on every client record that…
export function EditFamilyForm({ row, onDone, onRenamed }: {
  row: Pick<RosterRow, 'key' | 'name'>
  onDone: () => void
  /** a rename answered a new key: the screen moves to it */
  onRenamed: (key: string) => void
}) {
  const [opened] = useState(() => String(Date.now()))
  const read = useFamilyRead(readKey('familyProfileOverview', row.key, 'edit', opened), () => readEdit(row.key), familyEditOf)
  const edit = read.data
  // the notices, the papers and the lock's words: the master's, or everyone's while Settings › My Work shows them
  const bare = useFamilyDetailsHidden()
  const fields = useMemo(() => (edit ? familyEditFields(edit, bare) : []), [edit, bare])
  const target = useMemo(() => familyTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const moved = useRef('')
  const file = async (changes: EditChange[]) => {
    const sentAt = Date.now()
    // a rename re-keys the member: sent on its own path, then the screen follows the new key
    if (!changes.some((c) => c.field === 'name')) {
      return editAnswerOf(await apply.run(() => saveFamily(row.key, changes), [FAMILY_REREAD.overview(row.key)]))
    }
    try {
      const got = await saveFamily(row.key, changes)
      familyWrote(row.key, got, sentAt)
      const answer = editAnswerOf(got)
      const next = got && typeof got === 'object' ? String((got as Record<string, unknown>).family ?? '') : ''
      if (next && next !== row.key) {
        moved.current = next
        familyWritten(next, sentAt)
        if (answer.refused.length) onRenamed(next)
      }
      if (!answer.refused.length) {
        toast({ type: 'success', title: 'Saved', body: `${answer.written.length} field${answer.written.length === 1 ? '' : 's'} saved.` })
        if (moved.current) onRenamed(moved.current)
        else onDone()
      }
      return answer
    } catch (e) {
      // a stale field: the member is read again, so the form shows what the profile holds now
      familyWritten(row.key)
      throw e
    }
  }
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-family="">
      <ReadLine state={read} what="the family member's details" onRetry={read.reload} />
      {read.data === null && read.status === 'ready' && (
        <p className="text-[13px] text-text-3" data-edit-closed="">This server did not answer the details to edit.</p>
      )}
      {edit?.account && !bare && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] leading-5 text-text-2" data-edit-account="">
          A sign-in already uses this email or phone. Saving here changes the records only; the sign-in itself is never
          changed here.
        </p>
      )}
      {edit && (
        <RecordEditBody fields={fields} onFile={file} stay applyLabel={applyChanges} locked={apply.state.phase === 'running'}
          onDone={() => (moved.current ? onRenamed(moved.current) : onDone())}
          intro={bare ? undefined : `${row.name} · Only the fields you change are sent. Name, phone, email and address land on ${
            edit.records.length === 1 ? 'the client record' : `all ${edit.records.length} client records`} that name them.`} />
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}

/* ---------- a note or a call, edited ---------- */

/** The second press of a removal or a cancel (Locations' own word). */
const APPLY = 'Apply'

const NOT_ANSWERED = 'text-[13px] text-text-3'

/** The note and call panels' read: the notes with each part's witnesses, read live when the panel opens. */
function useAdminEdit(row: Pick<RosterRow, 'key'>) {
  const [opened] = useState(() => String(Date.now()))
  return useFamilyRead(readKey('familyProfileNotes', row.key, 'edit', opened), () => readAdminEdit(row.key), familyAdminEditOf)
}

/** A two-press button beside the record panel: a note removed, a call cancelled. */
export function SecondPress({ armed, busy, label, armedLabel, onPress, onDisarm, data }: {
  armed: boolean
  busy: boolean
  label: string
  armedLabel: string
  onPress: () => void
  onDisarm: () => void
  data: string
}) {
  return (
    <button type="button" disabled={busy} onClick={onPress} onBlur={onDisarm} data-second-press={data}
      className={cn('justify-self-start rounded-md px-2 py-1 text-[12.5px] font-semibold',
        armed ? 'bg-danger text-white' : 'text-danger hover:bg-surface-2')}>
      {armed ? armedLabel : label}
    </button>
  )
}

// One admin note: its text on the shared record panel, and Remove on the second press — the notes edition's.
export function NoteEditForm({ row, id, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; id: string; onDone: () => void }) {
  const read = useAdminEdit(row)
  const target = useMemo(() => familyTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const n = read.data?.notes?.find((x) => x.id === id) ?? null
  const fields = useMemo(() => (n ? noteEditFields(n) : []), [n])
  const [armed, setArmed] = useState(false)
  const running = apply.state.phase === 'running'
  const send = (changes: EditChange[]) =>
    apply.run(() => editNote(row.key, id, changes), [FAMILY_REREAD.notes(row.key), FAMILY_REREAD.activity(row.key)])
  const remove = async () => {
    if (!n) return
    if (!armed) { setArmed(true); return }
    setArmed(false)
    try {
      await send([{ field: 'state', value: NOTE_REMOVE, expected: n.raw.state ?? 'open' }])
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: errText(e) })
    }
  }
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-note={id}>
      <ReadLine state={read} what="the admin notes" onRetry={read.reload} />
      {read.status === 'ready' && !read.data?.notes && (
        <p className={NOT_ANSWERED} data-edit-closed="">This server did not answer the note to edit.</p>
      )}
      {read.data?.notes && !n && apply.state.phase === 'idle' && (
        <p className={NOT_ANSWERED} data-edit-gone="">This note is no longer listed for {row.name}.</p>
      )}
      {n && (
        <>
          <RecordEditBody fields={fields} onDone={onDone} stay applyLabel={applyChanges} locked={running}
            onFile={async (changes: EditChange[]) => editAnswerOf(await send(changes))}
            intro={`${[n.by, stampWords(n.at)].filter(Boolean).join(' · ')}. Only the text you change is sent.`} />
          <SecondPress armed={armed} busy={running} label="Remove note" armedLabel={`${APPLY} — remove the note`}
            onPress={() => void remove()} onDisarm={() => setArmed(false)} data={`remove-note:${n.id}`} />
        </>
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}

// One call filed from Families: its day, priority, state and details, and Cancel on the second press — the calls edition's.
export function CallEditForm({ row, id, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; id: string; onDone: () => void }) {
  const read = useAdminEdit(row)
  const target = useMemo(() => familyTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const c = read.data?.calls?.find((x) => x.id === id) ?? null
  const fields = useMemo(() => (c ? callEditFields(c) : []), [c])
  const [armed, setArmed] = useState(false)
  const running = apply.state.phase === 'running'
  const send = (changes: EditChange[]) => apply.run(() => editCall(row.key, id, changes), [FAMILY_REREAD.activity(row.key)])
  const cancel = async () => {
    if (!c) return
    if (!armed) { setArmed(true); return }
    setArmed(false)
    try {
      await send([{ field: 'state', value: CALL_CANCEL, expected: c.raw.state ?? '' }])
    } catch (e) {
      toast({ type: 'danger', title: 'Not cancelled', body: errText(e) })
    }
  }
  const why = read.data?.why ?? []
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-call={id}>
      <ReadLine state={read} what="the scheduled calls" onRetry={read.reload} />
      {why.length > 0 && <WhyLines why={why} degraded />}
      {read.status === 'ready' && !read.data?.calls && (
        <p className={NOT_ANSWERED} data-edit-closed="">This server did not answer the call to edit.</p>
      )}
      {read.data?.calls && !c && !why.length && apply.state.phase === 'idle' && (
        <p className={NOT_ANSWERED} data-edit-gone="">This call is no longer listed for {row.name}.</p>
      )}
      {c && (
        <>
          <RecordEditBody fields={fields} onDone={onDone} stay applyLabel={applyChanges} locked={running}
            onFile={async (changes: EditChange[]) => editAnswerOf(await send(changes))}
            intro={`${[row.name, c.client_name].filter(Boolean).join(' · ')}. Only the fields you change are sent; no message is sent.`} />
          {c.raw.state !== CALL_CANCEL && (
            <SecondPress armed={armed} busy={running} label="Cancel call" armedLabel={`${APPLY} — cancel the call`}
              onPress={() => void cancel()} onDisarm={() => setArmed(false)} data={`cancel-call:${c.id}`} />
          )}
        </>
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}
