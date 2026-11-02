// The registry's two forms in the right panel: New Family (a family member registered with the clients they are family…
// Each files on the second press, then the family member is read again, so Documents and Activity show the new row.
import { useRef, useState } from 'react'
import { FileText, Link2, Loader2, Search, Upload } from 'lucide-react'
import { MAX_UPLOAD_BYTES, fileToBase64, humanSize, inferMime } from '@/features/hiring/shared'
import { Field, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import {
  EMPTY_FAMILY, NOTE_MAX, PAPER_KINDS, PREFERRED_CONTACTS, RELATIONSHIPS, choicesFor, clientChoicesOf, createdKey, driveFileId,
  newFamilyMissing, readRefusal, type NewFamilyDraft, type PreferredContact, type RosterRow,
} from './familyModel'
import { addFamilyDoc, createFamily, familyWrote, readClientChoices, readKey, useFamilyRead } from './useFamilyRead'
import { ReadLine } from './FamilyParts'

const TEXTAREA = 'min-h-[84px] w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const HINT = 'text-[12px] leading-5 text-text-3'

const errText = (e: unknown): string => readRefusal(e instanceof Error ? e.message : String(e))

/** What cert_papers files: a PDF or a picture, up to 15MB; '' when the file is one. */
export function paperRefusal(file: { name: string; size: number; type: string }): string {
  const mime = inferMime(file as File)
  if (!(mime.startsWith('image/') || mime === 'application/pdf')) return 'Images and PDFs only.'
  if (file.size > MAX_UPLOAD_BYTES) return `${humanSize(file.size)} — up to 15MB.`
  return ''
}

function Review({ lines }: { lines: [string, string][] }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-review="">
      <p className="mb-1 font-semibold text-text-1">This is what will be filed:</p>
      {lines.filter(([, v]) => v).map(([k, v]) => <p key={k} className="whitespace-pre-wrap"><span className="text-text-3">{k}:</span> {v}</p>)}
    </div>
  )
}

/* ---------- New Family ---------- */

// A family member registered in Families' own registry: who they are, how to reach them and the clients they are…
export function NewFamilyForm({ onDone, onCreated }: { onDone: () => void; onCreated: (key: string) => void }) {
  const choices = useFamilyRead(readKey('familyClientChoices', '*'), () => readClientChoices(), clientChoicesOf)
  const [d, setD] = useState<NewFamilyDraft>(EMPTY_FAMILY)
  const [query, setQuery] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof NewFamilyDraft>(k: K, v: NewFamilyDraft[K]) => { setD((x) => ({ ...x, [k]: v })); setArmed('') }
  const missing = newFamilyMissing(d)
  const list = choices.data ?? []
  const picked = d.clients.map((c) => c.client_key)
  const shown = choicesFor(list, query, picked)
  const nameOf = (k: string) => list.find((c) => c.client_key === k)?.name ?? k
  const toggle = (k: string) => set('clients', picked.includes(k) ? d.clients.filter((c) => c.client_key !== k)
    : [...d.clients, { client_key: k, guardian: false }])
  const guardian = (k: string, on: boolean) => set('clients', d.clients.map((c) => (c.client_key === k ? { ...c, guardian: on } : c)))

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    const sentAt = Date.now()
    try {
      const got = await createFamily(d)
      const key = createdKey(got, d.name)
      familyWrote(key, got, sentAt)
      toast({ type: 'success', title: 'Family member registered', body: d.name.trim() })
      onCreated(key)
    } catch (e) {
      toast({ type: 'danger', title: 'Not registered', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const preferred = PREFERRED_CONTACTS.find((p) => p.id === d.preferred_contact)?.label ?? ''
  return (
    <div className="grid gap-4 pt-1" data-new-family="">
      <p className={HINT}>Kept in Families’ own registry. Their documents and every step from now on show on their profile.</p>
      <Field label="Full name" required>
        <input value={d.name} disabled={busy} maxLength={200} onChange={(e) => set('name', e.target.value)} className={inputCls}
          placeholder="First and last name" data-field="name" autoFocus />
      </Field>
      <Field label="Relationship" required>
        <input value={d.relationship} disabled={busy} maxLength={80} list="family-relationships" onChange={(e) => set('relationship', e.target.value)}
          className={inputCls} placeholder="Mother, Brother, Aunt…" data-field="relationship" />
        <datalist id="family-relationships">{RELATIONSHIPS.map((r) => <option key={r} value={r} />)}</datalist>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone">
          <input value={d.phone} disabled={busy} maxLength={40} inputMode="tel" onChange={(e) => set('phone', e.target.value)} className={inputCls}
            placeholder="(555) 555-0100" data-field="phone" />
        </Field>
        <Field label="Email">
          <input value={d.email} disabled={busy} maxLength={200} type="email" onChange={(e) => set('email', e.target.value)} className={inputCls}
            placeholder="name@example.com" data-field="email" />
        </Field>
      </div>
      <Field label="Address">
        <input value={d.address} disabled={busy} maxLength={300} onChange={(e) => set('address', e.target.value)} className={inputCls}
          placeholder="Street, city, state ZIP" data-field="address" />
      </Field>
      <Field label="Preferred contact">
        <select value={d.preferred_contact} disabled={busy} onChange={(e) => set('preferred_contact', e.target.value as PreferredContact)}
          className={inputCls} data-field="preferred_contact">
          {PREFERRED_CONTACTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>

      <Field label="Family of" required>
        <div className="grid gap-2" data-field="clients">
          <ReadLine state={choices} what="the clients" onRetry={choices.reload} />
          {choices.data && (
            <>
              <label className="relative block">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
                <input value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients by name or house"
                  className={cn(inputCls, 'pl-8')} aria-label="Search clients" data-client-search="" />
              </label>
              <ul className="scroll-thin max-h-[220px] divide-y divide-border overflow-y-auto rounded-sm border border-border" data-client-choices="">
                {shown.length === 0 && <li className="px-3 py-2.5 text-[12.5px] text-text-3">No client matches.</li>}
                {shown.map((c) => {
                  const on = picked.includes(c.client_key)
                  const tie = d.clients.find((x) => x.client_key === c.client_key)
                  return (
                    <li key={c.client_key} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2', on && 'bg-primary-soft/50')}
                      data-choice={c.client_key}>
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-[13px] text-text-1">
                        <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(c.client_key)} />
                        <span className="min-w-0 truncate">{c.name}</span>
                        <span className="shrink-0 text-[11.5px] text-text-3">
                          {[c.house, c.status === 'inactive' ? 'inactive' : ''].filter(Boolean).join(' · ')}
                        </span>
                      </label>
                      {on && (
                        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-text-2" data-guardian={c.client_key}>
                          <input type="checkbox" checked={!!tie?.guardian} disabled={busy} onChange={(e) => guardian(c.client_key, e.target.checked)} />
                          Legal guardian
                        </label>
                      )}
                    </li>
                  )
                })}
              </ul>
              {picked.length > 0 && <p className={HINT} data-picked="">{picked.length} picked: {picked.map(nameOf).join(', ')}</p>}
            </>
          )}
        </div>
      </Field>

      <Field label="Notes">
        <textarea value={d.notes} disabled={busy} maxLength={NOTE_MAX} onChange={(e) => set('notes', e.target.value)} className={TEXTAREA}
          placeholder="Anything the team should know about this family member…" data-field="notes" />
      </Field>
      {missing.length > 0 && <p className={HINT}>Still needed: {missing.join(', ')}.</p>}
      {armed === 'file' && (
        <Review lines={[['Name', d.name.trim()], ['Relationship', d.relationship.trim()], ['Phone', d.phone.trim()], ['Email', d.email.trim()],
          ['Address', d.address.trim()], ['Preferred contact', d.preferred_contact ? preferred : ''],
          ['Family of', d.clients.map((c) => nameOf(c.client_key) + (c.guardian ? ' (legal guardian)' : '')).join(', ')],
          ['Notes', d.notes.trim()]]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={missing.length > 0} armedLabel="Register — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- a paper added to Documents ---------- */

type PaperMode = 'upload' | 'drive'

// A paper kept on the family member: a PDF or a picture from this device, filed in Drive as the platform's own account…
export function AddDocumentForm({ row, onDone }: { row: Pick<RosterRow, 'key' | 'name'>; onDone: () => void }) {
  const [mode, setMode] = useState<PaperMode>('upload')
  const [picked, setPicked] = useState<File | null>(null)
  const [link, setLink] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('')
  const [refused, setRefused] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const edit = (fn: () => void) => { fn(); setArmed('') }
  const fileId = driveFileId(link)
  const missing = mode === 'upload' ? (picked ? [] : ['a file']) : fileId ? [] : ['a Drive link or file id']

  const choose = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    const why = paperRefusal(f)
    edit(() => {
      setRefused(why)
      setPicked(why ? null : f)
    })
  }

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    const sentAt = Date.now()
    try {
      const paper = { title: title.trim(), doc_type: kind.trim() }
      const got = mode === 'upload' && picked
        ? await addFamilyDoc(row.key, { ...paper, base64: await fileToBase64(picked), filename: picked.name, mime: inferMime(picked) })
        : await addFamilyDoc(row.key, { ...paper, drive: fileId })
      familyWrote(row.key, got, sentAt)
      toast({ type: 'success', title: 'Document added', body: `${row.name} · ${title.trim() || picked?.name || 'Drive file'}` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const MODE = (m: PaperMode, label: string, Icon: typeof Upload) => (
    <button type="button" onClick={() => edit(() => setMode(m))} disabled={busy} aria-pressed={mode === m} data-mode={m}
      className={cn('inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors',
        mode === m ? 'border-primary bg-primary-soft text-text-1' : 'border-border text-text-2 hover:bg-surface-2')}>
      <Icon size={14} /> {label}
    </button>
  )

  return (
    <div className="grid gap-4 pt-1" data-add-document="">
      <div className="flex gap-2">{MODE('upload', 'Upload a file', Upload)}{MODE('drive', 'From Drive', Link2)}</div>
      {mode === 'upload' ? (
        <div className="grid gap-2" data-upload="">
          <p className={HINT}>A PDF or a photo, up to 15MB — filed in Drive under Families / {row.name}, as the platform’s own account.</p>
          <input ref={input} type="file" accept="application/pdf,image/*" className="hidden" onChange={choose} data-file-input="" />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="inline-flex h-9 items-center justify-center gap-1.5 justify-self-start rounded-full border border-primary px-4 text-[12.5px] font-semibold text-primary hover:bg-primary/5 disabled:opacity-40">
            <FileText size={14} /> {picked ? 'Choose another file' : 'Choose a file'}
          </button>
          {picked && <p className="text-[12.5px] text-text-1" data-picked-file="">{picked.name} · {humanSize(picked.size)}</p>}
          {refused && <p role="alert" className="text-[12.5px] text-[var(--danger)]">{refused}</p>}
        </div>
      ) : (
        <Field label="Drive link" required>
          <input value={link} disabled={busy} onChange={(e) => edit(() => setLink(e.target.value))} className={inputCls}
            placeholder="A Drive link or file id" data-field="drive" />
          <p className={cn(HINT, 'mt-1')}>A file the platform’s account can open; it stays where it is in Drive.</p>
        </Field>
      )}
      <Field label="Title">
        <input value={title} disabled={busy} maxLength={120} onChange={(e) => edit(() => setTitle(e.target.value))} className={inputCls}
          placeholder={picked ? picked.name.replace(/\.[A-Za-z0-9]{2,5}$/, '') : 'The file’s own name when blank'} data-field="title" />
      </Field>
      <Field label="Kind of document">
        <input value={kind} disabled={busy} maxLength={80} list="family-paper-kinds" onChange={(e) => edit(() => setKind(e.target.value))}
          className={inputCls} placeholder="Guardianship papers, ID, Consent…" data-field="doc_type" />
        <datalist id="family-paper-kinds">{PAPER_KINDS.map((k) => <option key={k} value={k} />)}</datalist>
      </Field>
      {armed === 'file' && (
        <Review lines={[['For', row.name], ['File', mode === 'upload' ? (picked ? `${picked.name} · ${humanSize(picked.size)}` : '') : fileId],
          ['Title', title.trim()], ['Kind', kind.trim()]]} />
      )}
      {busy && mode === 'upload' && (
        <p role="status" className="flex items-center gap-1.5 text-[12.5px] text-text-2"><Loader2 size={13} className="animate-spin" /> Filing in Drive…</p>
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={missing.length > 0} armedLabel="Add document — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}
