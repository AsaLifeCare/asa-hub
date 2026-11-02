// The panel's forms: the client details pencil, Add client, Create user (client or guardian), the four Client…
// Each is drawn in the right panel and files on the second press.
import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Loader2 } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SearchInput from '@/components/shared/SearchInput'
import { Field, inputCls } from '@/pages/features/clientops/OpsPageShell'
import ApplyStrip, { useApplyFor } from '@/pages/features/locations/ApplyStrip'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import { INCIDENT_FIELDS, incidentPayload, missingFields } from '@/pages/features/locations/locationModel'
import { FormFields, incidentFields } from '@/pages/features/locations/LocationForms'
import { useIncidentStaff } from '@/pages/features/locations/useLocation'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'
import { ohioToday } from '@/lib/ohio'
import { useShellHides } from '@/lib/myWorkHides'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import RecordEditBody from '@/components/shared/RecordEditBody'
import { editAnswerOf, type EditAnswer, type EditChange } from '@/lib/recordEdit'
import {
  SECRET_FIELDS, TOOL_LABEL, clientEditFields, fieldsBare, profileOf, savesSecrets, switcherClients,
  type RosterRow, type ToolId,
} from './clientModel'
import {
  CLIENT_REREAD, QUEUED_WORDS, addMedication, clientTarget, clientWritten, clientWrote, createClient, createClientUser, editProfile,
  forgetClientReads, guardiansToRoster, readDetails, readKey, readThePlans, renameClient, saveAppointment, setClientStatus,
  useClientRead, usersFromClients, usersFromGuardians, addAppointment, addDoctor, saveSecret,
} from './useClientRead'
import { useClientReader } from './clientViewer'
import { ReadLine } from './ClientParts'
import {
  APPT_FIELDS, NEW_DOCTOR, NEW_DOCTOR_FIELDS, NEW_VISIT, apptChanges, dayLabel, filledFields, newVisitMissing,
  type ApptDoctor, type ApptVisit, type NewDoctor, type NewVisit,
} from './sources/appointments'

const TEXTAREA = 'min-h-[96px] w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The second press of an edition's form (Locations' own words). */
const applyChanges = (n: number) => `Apply ${n} change${n === 1 ? '' : 's'}`

/** A date field holding a value the date picker cannot show (a typed 3/4/1980) stays a text field, so nothing looks blank. */
const inputType = (kind: string | undefined, value: string): string =>
  kind === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value) ? 'text' : kind ?? 'text'

function Review({ lines }: { lines: [string, string][] }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-review="">
      <p className="mb-1 font-semibold text-text-1">This is what will be filed:</p>
      {lines.filter(([, v]) => v).map(([k, v]) => <p key={k}><span className="text-text-3">{k}:</span> {v}</p>)}
    </div>
  )
}

/* ---------- the client details pencil ---------- */

export function EditProfileForm({ client, onDone }: { client: RosterRow; onDone: () => void }) {
  const profile = useClientRead(readKey('clientProfileDetails', client.client_key), () => readDetails(client.client_key), profileOf)
  // the name and the status file through the master's own doors; a holder of the edition edits the rest
  const { mayWrite } = useClientReader()
  // the Updated line, the intro and the words under the fields: the master's while Settings › My Work keeps them
  const bare = useShellHides().client_edit_notes
  // the SSN, the card and its expiry: typed whole by the master, a Platform Lead or a Director, never shown again
  const secrets = savesSecrets(useEffectiveUser())
  const fields = useMemo(() => {
    const all = profile.data ? clientEditFields(profile.data, mayWrite, secrets) : []
    return bare ? fieldsBare(all) : all
  }, [profile.data, mayWrite, secrets, bare])
  const target = useMemo(() => clientTarget(client.client_key), [client.client_key])
  const apply = useApplyFor(target)
  const [params, setParams] = useSearchParams()
  // the key a rename answered: the screen follows it instead of closing back onto the old one
  const movedTo = useRef('')
  const follow = (key: string) => {
    const next = new URLSearchParams(params)
    next.set('client', key)
    next.delete('panel')
    setParams(next)
  }
  const file = async (changes: EditChange[]) => {
    const key = client.client_key
    const own = (field: string) => changes.filter((c) => c.field === field)
    const secret = (c: EditChange) => (SECRET_FIELDS as readonly string[]).includes(c.field)
    const rest = changes.filter((c) => c.field !== 'name' && c.field !== 'status' && !secret(c))
    const answer: EditAnswer = { written: [], refused: [] }
    const take = (got: unknown) => {
      const a = editAnswerOf(got)
      answer.written.push(...a.written)
      answer.refused.push(...a.refused)
    }
    const sent = Date.now()
    try {
      // each secret alone through its own door; its answer names the last four, never the value
      for (const c of changes.filter(secret)) {
        const got = await saveSecret(key, c.field, c.value)
        answer.written.push(c.field)
        if (got?.sheet === 'not_written') {
          toast({ type: 'warning', title: 'Saved in the Hub only', body: got.why || 'The Asa Client Database was not written.' })
        }
      }
      if (changes.some(secret)) clientWrote(key, null, sent)
      // the fields first (through the Apply strip), then the status, the rename last: it changes the key the others file under
      if (rest.length) take(await apply.run(() => editProfile(key, rest), [CLIENT_REREAD.details(key)]))
      if (own('status').length) {
        const got = await setClientStatus(key, own('status'))
        take(got)
        clientWrote(key, got, sent)
        clientWritten('*')
      }
      if (own('name').length) {
        const got = await renameClient(key, own('name'))
        take(got)
        const moved = String(got?.client_key ?? '')
        const notes = Array.isArray(got?.notes) ? got.notes : []
        if (notes.length) toast({ type: 'info', title: 'Renamed', body: notes.join(' ') })
        if (moved && moved !== key) {
          movedTo.current = moved
          forgetClientReads(key)
          clientWritten('*')
          follow(moved)
          return answer
        }
        clientWrote(key, got, sent)
      }
      // no strip ran (the status alone): the panel closes as a save always did
      if (!rest.length && !answer.refused.length) {
        toast({ type: 'success', title: 'Saved', body: `${answer.written.length} field${answer.written.length === 1 ? '' : 's'} saved.` })
        onDone()
      }
      return answer
    } catch (e) {
      // a stale field: the record is read again, so the form shows what it holds now
      clientWritten(key)
      if (answer.written.length) toast({ type: 'warning', title: 'Partly saved', body: `${answer.written.join(', ')} saved before the refusal.` })
      throw e
    }
  }
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-profile="">
      {!(bare && profile.status === 'ready') && <ReadLine state={profile} what="the client details" onRetry={profile.reload} />}
      {profile.data && (
        <RecordEditBody fields={fields} onFile={file} onDone={() => { if (!movedTo.current) onDone() }} stay
          applyLabel={applyChanges} locked={apply.state.phase === 'running'}
          intro={bare ? undefined : `${client.name} · Only the fields you change are sent. A field you clear stays blank; the SSN, the card and its codes are never edited here.`} />
      )}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); if (!movedTo.current) onDone() }} onAgain={apply.reset} />
    </div>
  )
}

/* ---------- client management ---------- */

export function AddClientForm({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState({ name: '', clientNumber: '', houseName: '', guardianName: '' })
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof v, x: string) => { setV((s) => ({ ...s, [k]: x })); setArmed('') }
  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await createClient({ name: v.name.trim(), clientNumber: v.clientNumber.trim(), houseName: v.houseName.trim(), guardianName: v.guardianName.trim() })
      invalidate('clients')
      noteWrite('clients')
      clientWrote('*', got)
      toast({ type: 'success', title: 'Client created', body: `${v.name.trim()} is on the directory.` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not created', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4 pt-1" data-add-client="">
      <p className="text-[13px] text-text-2">Create a client record. Chart details fill in after intake.</p>
      <Field label="Full name" required><input value={v.name} disabled={busy} onChange={(e) => set('name', e.target.value)} className={inputCls} data-field="name" /></Field>
      <Field label="Client #"><input value={v.clientNumber} disabled={busy} placeholder="e.g. CL-1200" onChange={(e) => set('clientNumber', e.target.value)} className={inputCls} /></Field>
      <Field label="House"><input value={v.houseName} disabled={busy} onChange={(e) => set('houseName', e.target.value)} className={inputCls} /></Field>
      <Field label="Guardian"><input value={v.guardianName} disabled={busy} placeholder="Name (relationship)" onChange={(e) => set('guardianName', e.target.value)} className={inputCls} /></Field>
      {armed === 'file' && <Review lines={[['Name', v.name.trim()], ['Client #', v.clientNumber.trim()], ['House', v.houseName.trim()], ['Guardian', v.guardianName.trim()]]} />}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={v.name.trim().split(/\s+/).length < 2} armedLabel="Create client — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/** A login for a client or their guardian: the e-mail on the record, else the phone's pure digits — the server's rule. */
export function CreateUserForm({ who, current, clients, onDone }: {
  who: 'client' | 'guardian'
  current: RosterRow
  clients: RosterRow[]
  onDone: () => void
}) {
  const [picked, setPicked] = useState(current.client_key)
  const [query, setQuery] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const target = clients.find((c) => c.client_key === picked) ?? current
  const list = switcherClients(clients, query, true)
  const file = async () => {
    if (!target.client_id) return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const d = await createClientUser(target.client_id, who)
      toast(d.already
        ? { type: 'info', title: 'Already a user', body: `${who === 'guardian' ? `The guardian of ${target.name}` : target.name} signs in as ${d.login}.` }
        : { type: 'success', title: who === 'guardian' ? 'Guardian account created' : 'Client account created', body: `Signs in as ${d.login} with the system default password.` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not created', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4 pt-1" data-create-user={who}>
      <p className="text-[12.5px] leading-5 text-text-3">
        {who === 'guardian'
          ? 'The guardian signs in with their e-mail — or their phone’s pure digits when the plan holds none.'
          : 'The client signs in with their e-mail — or their phone’s pure digits when the record holds no e-mail.'}
      </p>
      <SearchInput value={query} onChange={setQuery} placeholder="Search client profiles…" />
      <ul role="listbox" aria-label="Clients" className="scroll-thin grid max-h-[280px] gap-1 overflow-y-auto">
        {list.map((c) => (
          <li key={c.client_key} role="option" aria-selected={c.client_key === target.client_key}>
            <button type="button" disabled={busy} onClick={() => { setPicked(c.client_key); setArmed('') }}
              className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                c.client_key === target.client_key ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
              <Avatar src={c.avatar} name={c.name} size="xs" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">{who === 'guardian' ? `Guardian of ${c.name}` : c.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {!target.client_id && <p className="text-[12.5px] text-[var(--danger)]" data-no-id="">The roster did not carry {target.name}'s record id, so no account can be asked for.</p>}
      {armed === 'file' && <Review lines={[[who === 'guardian' ? 'Guardian of' : 'Client', target.name]]} />}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!target.client_id} label={who === 'guardian' ? 'Create user guardian' : 'Create user'}
        armedLabel="Create — press again" onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

const TOOL_WORDS: Record<ToolId, string> = {
  'users-clients': 'Create a user account for every client that lacks one. No e-mail is sent; a client already a user is left as is, and every skip is named.',
  'users-guardians': 'Create a user account for every Active guardian the plans name. No e-mail is sent; every skip is named.',
  'guardians-roster': "Add every plan's guardian to the General roster. It never overwrites a typed cell, and pressing it twice changes nothing.",
  'read-plans': "Read every plan for the guardian's name, e-mail and phone. Nothing is stored that is not written in the plan.",
}

/** One of the four passes: what it does, then Run on the second press, and the answer said in the panel. */
export function ToolRun({ tool, onDone }: { tool: ToolId; onDone: () => void }) {
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const run = async () => {
    const press = nextPress(armed, 'run')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      let line = ''
      if (tool === 'users-clients' || tool === 'users-guardians') {
        const d = tool === 'users-clients' ? await usersFromClients() : await usersFromGuardians()
        const names = (d.skipped_named ?? []).slice(0, 5).join(' · ')
        line = `${d.created} ${tool === 'users-clients' ? 'client' : 'guardian'} account${d.created === 1 ? '' : 's'} created · ${d.already} already had one · ` +
          `${d.skipped} skipped${names ? ` — ${names}${(d.skipped_named?.length ?? 0) > 5 ? '…' : ''}` : ''}. No e-mail was sent to anyone.`
        invalidate('users')
      } else if (tool === 'guardians-roster') {
        const d = await guardiansToRoster()
        line = (d.created ?? 0) || (d.filled ?? 0) ? `${d.created ?? 0} added · ${d.filled ?? 0} completed — they are in Users → General now.`
          : 'Every named guardian is already on the roster.'
      } else {
        const d = await readThePlans()
        line = d.wrote ? `${d.wrote} plan(s) read · ${d.refused ?? 0} could not be read. Run Guardians to roster to carry the contacts across.`
          : 'No plan answered — check that an AI key is set on the project.'
      }
      setSaid(line)
      toast({ type: 'success', title: TOOL_LABEL[tool], body: line })
    } catch (e) {
      toast({ type: 'danger', title: `${TOOL_LABEL[tool]} did not run`, body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4 pt-1" data-tool={tool}>
      <p className="text-[13px] leading-5 text-text-2">{TOOL_WORDS[tool]}</p>
      {busy && <p className="flex items-center gap-2 text-[12px] text-text-3"><Loader2 size={13} className="animate-spin" /> Running…</p>}
      {said && <p className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-5 text-text-1" data-said="">{said}</p>}
      <DraftButtons armed={armed === 'run'} busy={busy} disabled={false} label="Run" armedLabel="Run — press again"
        onPress={() => void run()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- medication ---------- */

const ROUTES = ['Tablet', 'Capsule', 'Liquid', 'Topical', 'Inhaler', 'Injection', 'Drops', 'Patch']

/** A medicine added to the eMAR chart through the Apply strip (emarMedAdd); the door mints its id, so it skips the overlay. */
export function AddMedicationForm({ client, onDone }: { client: RosterRow; onDone: () => void }) {
  const [v, setV] = useState({ name: '', dose: '', times: '', route: 'Tablet', prn: false })
  const [armed, setArmed] = useState('')
  const target = useMemo(() => clientTarget(client.client_key), [client.client_key])
  const apply = useApplyFor(target)
  const busy = apply.state.phase !== 'idle'
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => { setV((s) => ({ ...s, [k]: x })); setArmed('') }
  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    const draft = { client: client.name, client_key: client.client_key, name: v.name.trim(), dose: v.dose.trim(), times: v.times,
      route: v.route, prn: String(v.prn) }
    // a refusal is the strip's own words
    await apply.run(() => addMedication(draft), [CLIENT_REREAD.meds(client.client_key)]).catch(() => {})
  }
  return (
    <div className="grid gap-4 pt-1" data-add-medication="">
      <p className="text-[13px] text-text-2">Added to the eMAR chart itself for <span className="font-semibold text-primary">{client.name}</span>.</p>
      <Field label="Medication" required><input value={v.name} disabled={busy} placeholder="e.g. Gabapentin" onChange={(e) => set('name', e.target.value)} className={inputCls} data-field="name" /></Field>
      <Field label="Dose"><input value={v.dose} disabled={busy} placeholder="e.g. 300mg" onChange={(e) => set('dose', e.target.value)} className={inputCls} /></Field>
      <Field label="Times"><input value={v.times} disabled={busy} placeholder="e.g. 0800 2000" onChange={(e) => set('times', e.target.value)} className={inputCls} /></Field>
      <Field label="Type">
        <select value={v.route} disabled={busy} onChange={(e) => set('route', e.target.value)} className={inputCls}>
          {ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-[13px] text-text-2">
        <input type="checkbox" checked={v.prn} disabled={busy} onChange={(e) => set('prn', e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" /> As needed (PRN)
      </label>
      {(armed === 'file' || busy) && <Review lines={[['Client', client.name], ['Medication', v.name.trim()], ['Dose', v.dose.trim()], ['Times', v.times.trim()], ['Type', v.route], ['PRN', v.prn ? 'Yes' : '']]} />}
      {!busy && <DraftButtons armed={armed === 'file'} busy={false} disabled={!v.name.trim()} armedLabel="Add medication — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />}
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onDone() }} onAgain={() => { apply.reset(); setArmed('') }} />
    </div>
  )
}

/* ---------- a new incident ---------- */

/** `onFiled`: the report as it was sent, once the door took it (Families ties it to a family member by its timestamp). */
export function NewIncidentForm({ client, onDone, onFiled }: {
  client: RosterRow
  onDone: () => void
  onFiled?: (sent: Record<string, string>) => void
}) {
  const me = useAuthStore((s) => s.user?.name || s.user?.email || '')
  // every active employee, ticked; the intro, the notes under the fields and the Still needed line are the master's
  // while Settings › My Work keeps them
  const employees = useIncidentStaff()
  const bare = useShellHides().incident_notes
  const fields = useMemo(() => incidentFields(INCIDENT_FIELDS.filter((f) => f.key !== 'client_name'), employees, bare),
    [employees, bare])
  const [values, setValues] = useState<Record<string, string>>({ incident_date: ohioToday() })
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const all: Record<string, string> = { ...values, client_name: client.name }
  const missing = missingFields(INCIDENT_FIELDS, all)
  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const sent = Date.now()
      const report = incidentPayload(all, me, new Date().toISOString())
      const got = await api.create('uiIncidents', report)
      invalidate('uiIncidents')
      const queued = clientWrote(client.client_key, got, sent)
      toast({ type: 'success', title: queued ? 'Incident accepted' : 'Incident filed', body: queued ? QUEUED_WORDS : `${client.name} · ${values.incident_category}` })
      onFiled?.(report)
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not filed', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4 pt-1" data-incident-form="">
      {!bare && <p className="text-[13px] text-text-2" data-incident-intro="">Filed in the estate's UI Reports sheet, as {me || 'the signed-in account'}.</p>}
      <Field label="Client"><input value={client.name} readOnly className={cn(inputCls, 'bg-surface-2')} data-field="client_name" /></Field>
      <FormFields fields={fields} values={values} disabled={busy} options={{ employees_involved: employees }}
        onChange={(k, v) => { setValues((s) => ({ ...s, [k]: v })); setArmed('') }} />
      {!bare && missing.length > 0 && <p className="text-[12px] text-text-3" data-still-needed="">Still needed: {missing.join(', ')}.</p>}
      {armed === 'file' && <Review lines={INCIDENT_FIELDS.map((f) => [f.label.split(' — ')[0], all[f.key] ?? ''] as [string, string])} />}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={missing.length > 0} armedLabel="File incident — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- the appointment pencil ---------- */

// The pencil on a booked visit: the Dr Appt Archive row is edited through the estate's header-bound update, the…
export function AppointmentForm({ client, clientName, visit, onDone }: {
  client: string
  clientName: string
  visit: ApptVisit
  onDone: () => void
}) {
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  if (!visit.editable) {
    return (
      <p className="pt-1 text-[12.5px] leading-5 text-text-3" data-appointment-form="read-only">
        This visit is only on Future Apts, a view of the booked rows; it is edited on Dr Appt Archive.
      </p>
    )
  }
  const before: Record<string, string> = {
    date: visit.date, time: visit.time, dr_name: visit.drName, dr_address: visit.drAddress, van: visit.vanAnswer,
  }
  const values = { ...before, ...typed }
  const changed = apptChanges(before, values)
  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const sent = Date.now()
      const got = await saveAppointment({ client, id: visit.id, witness: visit.witness || visit.client, fields: changed })
      const queued = clientWrote(client, got, sent)
      toast({ type: 'success', title: queued ? 'Change accepted' : 'Appointment saved', body: queued ? QUEUED_WORDS : `${clientName} · ${visit.drName}` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  const set = (key: string, v: string) => { setTyped((s) => ({ ...s, [key]: v })); setArmed('') }
  return (
    <div className="grid gap-4 pt-1" data-appointment-form={visit.id}>
      {APPT_FIELDS.map((f) => (
        <Field key={f.key} label={f.label}>
          {f.kind === 'van' ? (
            <select value={values.van ?? ''} disabled={busy} data-edit={f.key} onChange={(e) => set(f.key, e.target.value)} className={inputCls}>
              {!before.van && <option value="">Not answered</option>}
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          ) : (
            <input type={inputType(f.kind, values[f.key] ?? '')} value={values[f.key] ?? ''} disabled={busy} data-edit={f.key}
              onChange={(e) => set(f.key, e.target.value)} className={inputCls} />
          )}
        </Field>
      ))}
      {armed === 'file' && <Review lines={Object.entries(changed).map(([k, v]) => [APPT_FIELDS.find((f) => f.key === k)?.label ?? k, v || '(cleared)'] as [string, string])} />}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={Object.keys(changed).length === 0} armedLabel="Save — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- Appointments: New Appointment and New Doctor ---------- */

const ANOTHER_DOCTOR = '~another'

/** Book a visit: one of the client's doctors on file (their address filled in), or another doctor typed. */
export function NewAppointmentForm({ client, clientName, doctors, onDone }: {
  client: string
  clientName: string
  doctors: ApptDoctor[]
  onDone: () => void
}) {
  const named = doctors.filter((d) => d.drName)
  const [pick, setPick] = useState(named.length ? '' : ANOTHER_DOCTOR)
  const [visit, setVisit] = useState<NewVisit>(NEW_VISIT)
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<NewVisit>) => { setVisit((s) => ({ ...s, ...patch })); setArmed('') }
  const choose = (id: string) => {
    setPick(id)
    const d = named.find((x) => x.id === id)
    set({ dr_name: d?.drName ?? '', dr_address: d?.address ?? '' })
  }
  const missing = newVisitMissing(visit)
  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const sent = Date.now()
      const got = await addAppointment(client, filledFields(visit))
      clientWrote(client, got, sent)
      toast({ type: 'success', title: 'Appointment booked', body: `${clientName} · ${visit.dr_name.trim()} · ${dayLabel(visit.date)}` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not booked', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4 pt-1" data-new-visit="">
      <Field label="Doctor" required>
        <select value={pick} disabled={busy} onChange={(e) => choose(e.target.value)} className={inputCls} data-new="doctor">
          {named.length > 0 && <option value="">Choose a doctor on file</option>}
          {named.map((d) => <option key={d.id} value={d.id}>{d.drName}{d.specialist ? ` · ${d.specialist}` : ''}</option>)}
          <option value={ANOTHER_DOCTOR}>Another doctor…</option>
        </select>
      </Field>
      {pick === ANOTHER_DOCTOR && (
        <Field label="Dr name" required>
          <input value={visit.dr_name} disabled={busy} data-new="dr_name" onChange={(e) => set({ dr_name: e.target.value })} className={inputCls} />
        </Field>
      )}
      <Field label="Date" required>
        <input type="date" value={visit.date} disabled={busy} data-new="date" onChange={(e) => set({ date: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Time">
        <input type="time" value={visit.time} disabled={busy} data-new="time" onChange={(e) => set({ time: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Dr address">
        <input value={visit.dr_address} disabled={busy} data-new="dr_address" onChange={(e) => set({ dr_address: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Wheelchair van required?">
        <select value={visit.van} disabled={busy} data-new="van" onChange={(e) => set({ van: e.target.value === 'Yes' ? 'Yes' : 'No' })} className={inputCls}>
          <option value="No">No</option>
          <option value="Yes">Yes</option>
        </select>
      </Field>
      {armed === 'file' && (
        <Review lines={[['Client', clientName], ['Doctor', visit.dr_name.trim()], ['Date', dayLabel(visit.date)], ['Time', visit.time],
          ['Dr address', visit.dr_address.trim()], ['Wheelchair van', visit.van]]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={missing.length > 0} armedLabel="Book — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/** Add a doctor to the client's doctors on file, filed Active. */
export function NewDoctorForm({ client, clientName, onDone }: { client: string; clientName: string; onDone: () => void }) {
  const [doctor, setDoctor] = useState<NewDoctor>(NEW_DOCTOR)
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key: keyof NewDoctor, v: string) => { setDoctor((s) => ({ ...s, [key]: v })); setArmed('') }
  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const sent = Date.now()
      const got = await addDoctor(client, filledFields(doctor))
      clientWrote(client, got, sent)
      toast({ type: 'success', title: 'Doctor added', body: `${clientName} · ${doctor.dr_name.trim()}` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4 pt-1" data-new-doctor="">
      {NEW_DOCTOR_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} required={f.key === 'dr_name'}>
          {f.kind === 'textarea' ? (
            <textarea value={doctor[f.key]} disabled={busy} data-new={f.key} onChange={(e) => set(f.key, e.target.value)} className={TEXTAREA} />
          ) : (
            <input type={f.kind ?? 'text'} value={doctor[f.key]} disabled={busy} data-new={f.key} placeholder={f.hint}
              onChange={(e) => set(f.key, e.target.value)} className={inputCls} />
          )}
        </Field>
      ))}
      {armed === 'file' && (
        <Review lines={[['Client', clientName], ...NEW_DOCTOR_FIELDS.map((f) => [f.label, doctor[f.key].trim()] as [string, string])]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!doctor.dr_name.trim()} armedLabel="Add — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}
