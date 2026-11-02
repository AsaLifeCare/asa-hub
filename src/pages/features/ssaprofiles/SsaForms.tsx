// The admin notes: the list, the composer on the Overview card and the right panel's form; and the SSA's details edited.
// A note files on the second press; the write forgets the SSA's answers, so the card, the panel and Activity read…
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Loader2 } from 'lucide-react'
import RecordEditBody from '@/components/shared/RecordEditBody'
import { editAnswerOf, type EditChange } from '@/lib/recordEdit'
import { Field } from '@/pages/features/clientops/OpsPageShell'
import ApplyStrip, { useApplyFor } from '@/pages/features/locations/ApplyStrip'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import { SecondPress } from '@/pages/features/familyprofiles/FamilyForms'
import { fieldsBare } from '@/pages/features/clientprofiles/clientModel'
import { useShellHides } from '@/lib/myWorkHides'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import {
  LIST_REMOVE, LIST_SHOWN, NOTE_MAX, activityEditFields, activityMeta, activityOf, docEditFields, docLine, documentsOf,
  noteIdOf, notesOf, readRefusal, ssaEditFields, ssaEditIntro, ssaEditOf, stampWords, type RosterRow, type SsaNotes,
  clientsChange, type SsaEditClient,
} from './ssaModel'
import {
  QUEUED_WORDS, SSA_REREAD, addNote, editActivity, editDoc, readActivity, readDocuments, readEdit, readKey, readNotes,
  saveSsa, saveSsaClients, ssaTarget, ssaWritten, ssaWrote, useSsaRead, type ReadState,
} from './useSsaRead'
import { ReadLine } from './SsaParts'

const TEXTAREA = 'min-h-[96px] w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export const NOTE_PLACEHOLDER = 'Add a note about this SSA…'

const errText = (e: unknown): string => readRefusal(e instanceof Error ? e.message : String(e))

/** One note being written for an SSA: the text, the armed press and the filing. */
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
      const queued = ssaWrote(row.key, got, sentAt)
      toast({ type: 'success', title: queued ? 'Note accepted' : 'Note filed', body: queued ? QUEUED_WORDS : row.name })
      setBody('')
    } catch (e) {
      toast({ type: 'danger', title: 'Not filed', body: errText(e) })
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

/** The notes on file, newest first, or the sentence for none; `stamp` off leaves out the "Updated … ago" line. */
export function NotesList({ notes, onRetry, stamp = true }: {
  notes: ReadState<SsaNotes>
  onRetry: () => void
  stamp?: boolean
}) {
  const list = notes.data?.notes ?? []
  return (
    <div className="grid gap-2" data-notes="">
      <ReadLine state={notes} what="the admin notes" onRetry={onRetry} stamp={stamp} />
      {notes.data && list.length === 0 && <p className="text-[13px] text-text-3" data-no-notes="">No admin notes yet.</p>}
      {list.length > 0 && (
        <ul className="grid gap-2">
          {list.map((n) => (
            <li key={n.id} data-note={n.id} className="rounded-lg border border-border px-3 py-2.5">
              <p className="whitespace-pre-wrap text-[13px] leading-5 text-text-1">{n.body}</p>
              <p className="mt-1 text-[11.5px] text-text-3">{[n.by, stampWords(n.at)].filter(Boolean).join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The Overview card's composer: the text, then "Add note", which files on its second press. */
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
          {d.armed ? 'Add note — press again' : 'Add note'}
        </button>
      </div>
    </div>
  )
}

/** The right panel's form: the note, what will be filed, and the notes on file. */
export function NoteForm({ row, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; onDone: () => void }) {
  const notes = useSsaRead(readKey('ssaProfileNotes', row.key), () => readNotes(row.key), notesOf)
  const d = useNoteDraft(row)
  return (
    <div className="grid gap-5 pt-1" data-notes-panel="">
      <Field label="Note" required>
        <textarea value={d.body} disabled={d.busy} maxLength={NOTE_MAX} placeholder={NOTE_PLACEHOLDER} className={TEXTAREA}
          onChange={(e) => d.edit(e.target.value)} />
      </Field>
      {d.armed && (
        <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-review="">
          <p className="mb-1 font-semibold text-text-1">This is what will be filed:</p>
          <p><span className="text-text-3">For:</span> {row.name}</p>
          <p className="whitespace-pre-wrap"><span className="text-text-3">Note:</span> {d.text}</p>
        </div>
      )}
      <DraftButtons armed={d.armed} busy={d.busy} disabled={!d.text} armedLabel="File note — press again"
        onPress={() => void d.file()} onDisarm={d.disarm} onCancel={onDone} />
      <div className="border-t border-border pt-4">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Notes on file</h3>
        <NotesList notes={notes} onRetry={notes.reload} />
      </div>
    </div>
  )
}

/* ---------- the SSA's details ---------- */

/** The second press of an edition's form (Locations' own words). */
const applyChanges = (n: number) => `Apply ${n} change${n === 1 ? '' : 's'}`

// The SSA's details on the shared record panel: phone and e-mail on the client records, agency and office on its own row.
export function EditSsaForm({ row, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; onDone: () => void }) {
  const [opened] = useState(() => String(Date.now()))
  const read = useSsaRead(readKey('ssaProfileOverview', row.key, 'edit', opened), () => readEdit(row.key), ssaEditOf)
  const edit = read.data
  // the intro and the words under the fields: the master's while Settings › My Work keeps them
  const bare = useShellHides().ssa_edit_notes
  const fields = useMemo(() => (edit ? (bare ? fieldsBare(ssaEditFields(edit)) : ssaEditFields(edit)) : []), [edit, bare])
  const target = useMemo(() => ssaTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const [params, setParams] = useSearchParams()
  const file = async (changes: EditChange[]) => {
    try {
      const got = await apply.run(() => saveSsa(row.key, changes), [SSA_REREAD.overview(row.key)])
      // a new name is a new key: the screen follows it, the panel closed
      const moved = String((got as { ssa?: unknown } | null)?.ssa ?? '')
      if (moved && moved !== row.key) {
        ssaWritten(row.key)
        ssaWritten(moved)
        const next = new URLSearchParams(params)
        next.set('ssa', moved)
        next.delete('panel')
        setParams(next)
      }
      return editAnswerOf(got)
    } catch (e) {
      // a stale field: the SSA is read again, so the form shows what the records hold now
      ssaWritten(row.key)
      throw e
    }
  }
  const readonly = edit?.ties.filter((t) => t.why) ?? []
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-ssa="">
      <ReadLine state={read} what="the SSA's details" onRetry={read.reload} />
      {read.data === null && read.status === 'ready' && (
        <p className="text-[13px] text-text-3" data-edit-closed="">This server did not answer the details to edit.</p>
      )}
      {edit && (
        <RecordEditBody fields={fields} onFile={file} onDone={onDone} stay applyLabel={applyChanges}
          locked={apply.state.phase === 'running'} intro={bare ? undefined : ssaEditIntro(row.name, edit)} />
      )}
      {readonly.length > 0 && (
        <div className="grid gap-1 text-[12px] leading-4 text-text-3" data-edit-readonly="">
          <p className="font-semibold text-text-2">Not changed here</p>
          {readonly.map((t) => <p key={t.client_key}>{t.name}: {t.why}</p>)}
        </div>
      )}
      {edit && edit.clients.length > 0 && <SsaClientsForm row={row} clients={edit.clients} onDone={onDone} />}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}

// The active clients the SSA is named on, ticked on or off: the SSA's name, phone and e-mail go on each client's record
// ticked, and come off each one unticked; a tie only the Master holds stays ticked.
function SsaClientsForm({ row, clients, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; clients: SsaEditClient[]; onDone: () => void }) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const change = clientsChange(clients, ticked)
  const name = (k: string) => clients.find((c) => c.client_key === k)?.name ?? k
  const save = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await saveSsaClients(row.key, change.add, change.remove)
      ssaWrote(row.key, got)
      const refused = got?.refused ?? []
      toast(refused.length
        ? { type: 'warning', title: 'Partly saved', body: refused.map((r) => `${name(r.client)}: ${r.why}`).join(' ') }
        : { type: 'success', title: 'Clients saved', body: `${row.name} · ${(got?.added ?? []).length} ticked, ${(got?.removed ?? []).length} unticked` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-2 border-t border-border pt-4" data-ssa-clients="">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Clients</p>
      <ul className="scroll-thin grid max-h-[280px] gap-1 overflow-y-auto pr-1">
        {clients.map((c) => {
          const on = ticked[c.client_key] ?? c.on
          return (
            <li key={c.client_key}>
              <label className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text-1 hover:bg-surface-2',
                (busy || !!c.why) && 'cursor-not-allowed opacity-70')} title={c.why || undefined}>
                <input type="checkbox" checked={on} disabled={busy || !!c.why} data-ssa-client={c.client_key}
                  onChange={(e) => { setTicked((t) => ({ ...t, [c.client_key]: e.target.checked })); setArmed('') }}
                  className="h-4 w-4 accent-[var(--primary)]" />
                {c.name}
              </label>
            </li>
          )
        })}
      </ul>
      {armed === 'file' && (
        <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-review="">
          <p className="mb-1 font-semibold text-text-1">This is what will be saved:</p>
          {change.add.length > 0 && <p><span className="text-text-3">Ticked:</span> {change.add.map(name).join(', ')}</p>}
          {change.remove.length > 0 && <p><span className="text-text-3">Unticked:</span> {change.remove.map(name).join(', ')}</p>}
        </div>
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!change.add.length && !change.remove.length}
        label="Review clients" armedLabel="Save clients — press again" onPress={() => void save()} onDisarm={() => setArmed('')}
        onCancel={() => { setTicked({}); setArmed('') }} />
    </section>
  )
}

/* ---------- a Documents or Activity entry, edited or removed ---------- */

/** The second press of a removal (Locations' own word). */
const APPLY = 'Apply'

const NOT_ANSWERED = 'text-[13px] text-text-3'

// One Documents entry: its title and day on the shared record panel, and taken off the list on the second press.
export function DocEditForm({ row, id, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; id: string; onDone: () => void }) {
  const read = useSsaRead(readKey('ssaProfileDocuments', row.key), () => readDocuments(row.key), documentsOf)
  const target = useMemo(() => ssaTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const d = read.data?.docs.find((x) => x.id === id) ?? null
  const fields = useMemo(() => (d ? docEditFields(d) : []), [d])
  const [armed, setArmed] = useState(false)
  const running = apply.state.phase === 'running'
  const send = (changes: EditChange[]) => apply.run(() => editDoc(row.key, id, changes), [SSA_REREAD.documents(row.key)])
  const remove = async () => {
    if (!d) return
    if (!armed) { setArmed(true); return }
    setArmed(false)
    try {
      await send([{ field: 'state', value: LIST_REMOVE, expected: LIST_SHOWN }])
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: errText(e) })
    }
  }
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-doc={id}>
      <ReadLine state={read} what="the documents" onRetry={read.reload} />
      {read.data && !d && apply.state.phase === 'idle' && (
        <p className={NOT_ANSWERED} data-edit-gone="">This document is no longer listed for {row.name}.</p>
      )}
      {d && (
        <>
          <RecordEditBody fields={fields} onDone={onDone} stay applyLabel={applyChanges} locked={running}
            onFile={async (changes: EditChange[]) => editAnswerOf(await send(changes))}
            intro={`${docLine(d)}. Only the fields you change are sent; the file itself stays as it is.`} />
          <SecondPress armed={armed} busy={running} label="Remove from Documents" armedLabel={`${APPLY} — remove it from Documents`}
            onPress={() => void remove()} onDisarm={() => setArmed(false)} data={`remove-doc:${d.id}`} />
        </>
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}

// One Activity entry: its title and text on the shared record panel — an admin note's whole text, read from the
// notes — and taken off the Activity on the second press (an admin note leaves the notes too).
export function ActivityEditForm({ row, id, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; id: string; onDone: () => void }) {
  const read = useSsaRead(readKey('ssaProfileActivity', row.key), () => readActivity(row.key), activityOf)
  const x = read.data?.items.find((i) => i.id === id) ?? null
  const noteId = x ? noteIdOf(x) : ''
  const notes = useSsaRead(noteId ? readKey('ssaProfileNotes', row.key) : null, () => readNotes(row.key), notesOf)
  const note = noteId ? notes.data?.notes.find((n) => n.id === noteId) ?? null : null
  const ready = !!x && (!noteId || !!note)
  const fields = useMemo(() => (x && ready ? activityEditFields(x, note?.body) : []), [x, ready, note])
  const target = useMemo(() => ssaTarget(row.key), [row.key])
  const apply = useApplyFor(target)
  const [armed, setArmed] = useState(false)
  const running = apply.state.phase === 'running'
  const send = (changes: EditChange[]) => apply.run(() => editActivity(row.key, id, changes),
    [SSA_REREAD.activity(row.key), ...(noteId ? [SSA_REREAD.notes(row.key)] : [])])
  const remove = async () => {
    if (!ready) return
    if (!armed) { setArmed(true); return }
    setArmed(false)
    try {
      await send([{ field: 'state', value: LIST_REMOVE, expected: LIST_SHOWN }])
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: errText(e) })
    }
  }
  const idle = apply.state.phase === 'idle'
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-activity={id}>
      <ReadLine state={read} what="the activity" onRetry={read.reload} />
      {noteId && <ReadLine state={notes} what="the admin notes" onRetry={notes.reload} stamp={false} />}
      {read.data && !x && idle && (
        <p className={NOT_ANSWERED} data-edit-gone="">This entry is no longer in {row.name}'s Activity.</p>
      )}
      {x && noteId && notes.data && !note && idle && (
        <p className={NOT_ANSWERED} data-edit-gone="">This note is no longer listed for {row.name}.</p>
      )}
      {x && ready && (
        <>
          <RecordEditBody fields={fields} onDone={onDone} stay applyLabel={applyChanges} locked={running}
            onFile={async (changes: EditChange[]) => editAnswerOf(await send(changes))}
            intro={`${activityMeta(x)}. Only the fields you change are sent; when it happened stays as recorded.`} />
          <SecondPress armed={armed} busy={running} label={noteId ? 'Remove note' : 'Remove from Activity'}
            armedLabel={`${APPLY} — ${noteId ? 'remove the note' : 'remove it from Activity'}`}
            onPress={() => void remove()} onDisarm={() => setArmed(false)} data={`remove-activity:${x.id}`} />
        </>
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={apply.reset} />
    </div>
  )
}
