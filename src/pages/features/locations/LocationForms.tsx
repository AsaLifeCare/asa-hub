// The panel's forms: House Notes (the list and a new note), New Incident, New House Repair, a supply count or…
// Each is drawn in the right panel for a viewer who makes its edition (Settings → Editions), files on the second…
import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { OpsField } from '@/features/ops-flows/OpsRecordModal'
import { ChipPicker, Field, TintChip, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { FILING_FORMS } from '@/pages/features/houses/HouseFilingModal'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { FileDropZone, SelectedFileCard, fileToBase64 } from '@/features/hiring/shared'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { ohioDayYear, ohioToday } from '@/lib/ohio'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { useShellHides } from '@/lib/myWorkHides'
import { editAnswerOf } from '@/lib/recordEdit'
import {
  INCIDENT_FIELDS, INCIDENT_PLACE_OTHER, IST_ACCEPT, NOTE_PRIORITIES, SUPPLY_KINDS, SUPPLY_QTY_LABEL, clientKeyOf,
  incidentEditChanges, incidentFormValues, incidentNames, incidentPayload, istPaperProblem, istPaperType, missingFields, noteClient, notesOf, overviewOf, priorityLabel,
  repairPayload, repairStreet, repairsOf, suppliesOf, supplyDraft,
  type NotePriority, type SupplyKind, type SupplyValues,
} from './locationModel'
import {
  REREAD, addNote, addSupplyEntry, editIncident, fileIncident, fileIstPaper, fileRepair, readKey, readNotes,
  readOverview, readRepairs, readSupplies, setNoteState, useCan, useIncidentStaff, useLocationRead,
} from './useLocation'
import { DraftButtons, ReadLine } from './LocationParts'
import ApplyStrip, { locationTarget, useApply, useApplyFor, type PanelVia } from './ApplyStrip'
import { IST_PAPER_HINT } from './tabs/Staff'

// The second press of every edition's form (LocationPanel's APPLY_LABEL, kept here so the forms need not import the…
const APPLY = 'Apply'

const TEXTAREA = 'min-h-[96px] w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Who files: the signed-in account's own name. */
function useFilerName(): string {
  return useAuthStore((s) => s.user?.name || s.user?.email || '')
}

/* ---------- the fields ---------- */

/** An incident's fields: Employees involved ticked from `employees` once they are read, the notes under the fields
 * dropped when `bare`. */
export function incidentFields(fields: OpsField[], employees: string[], bare: boolean): OpsField[] {
  return fields.map((f): OpsField => {
    const g = bare ? { ...f, hint: undefined } : f
    return g.key === 'employees_involved' && employees.length ? { ...g, kind: 'checks', placeholder: undefined } : g
  })
}

export function FormFields({ fields, values, onChange, options, suggest, disabled }: {
  fields: OpsField[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** a select's choices, by field */
  options?: Record<string, string[]>
  /** a text field's suggestions, by field (anything may still be typed) */
  suggest?: Record<string, string[]>
  disabled: boolean
}) {
  return (
    <div className="grid gap-3">
      {fields.map((f) => {
        const v = values[f.key] ?? ''
        const id = `loc-${f.key}`
        let control
        if (f.kind === 'textarea') {
          control = <textarea id={id} value={v} disabled={disabled} placeholder={f.placeholder}
            onChange={(e) => onChange(f.key, e.target.value)} className={TEXTAREA} />
        } else if (f.kind === 'chips') {
          control = <ChipPicker options={f.options ?? []} value={v} onChange={(x) => onChange(f.key, x)} />
        } else if (f.kind === 'select') {
          control = (
            <select id={id} value={v} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value)} className={inputCls}>
              <option value="">Choose {f.label.toLowerCase()}</option>
              {(options?.[f.key] ?? f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )
        } else if (f.kind === 'checks') {
          // several picked from a list, kept as one comma-separated cell
          const picked = new Set(v.split(',').map((x) => x.trim()).filter(Boolean))
          const toggle = (o: string) => {
            const next = new Set(picked)
            if (next.has(o)) next.delete(o)
            else next.add(o)
            onChange(f.key, (options?.[f.key] ?? f.options ?? []).filter((x) => next.has(x)).join(', '))
          }
          control = (
            <div id={id} role="group" aria-label={f.label} data-checks={f.key}
              className="scroll-thin max-h-48 overflow-y-auto rounded-sm border border-border bg-surface px-2 py-1.5">
              {(options?.[f.key] ?? f.options ?? []).map((o) => (
                <label key={o} className="flex items-center gap-2 py-1 text-[13px] text-text-1">
                  <input type="checkbox" checked={picked.has(o)} disabled={disabled} onChange={() => toggle(o)}
                    className="h-4 w-4 accent-[var(--primary)]" />
                  {o}
                </label>
              ))}
            </div>
          )
        } else {
          const list = suggest?.[f.key] ?? []
          control = (
            <>
              <input id={id} type={f.kind === 'date' || f.kind === 'time' ? f.kind : 'text'} value={v} disabled={disabled}
                placeholder={f.placeholder} list={list.length ? `${id}-list` : undefined}
                onChange={(e) => onChange(f.key, e.target.value)} className={inputCls} />
              {list.length > 0 && <datalist id={`${id}-list`}>{list.map((o) => <option key={o} value={o} />)}</datalist>}
            </>
          )
        }
        return (
          <Field key={f.key} label={f.label} required={f.required}>
            {f.hint && <span className="-mt-1 text-[12px] leading-[1.45] text-text-3" data-hint={f.key}>{f.hint}</span>}
            {control}
          </Field>
        )
      })}
    </div>
  )
}

function Review({ lines, title = 'This is what will be filed:' }: { lines: [string, string][]; title?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-review="">
      <p className="mb-1 font-semibold text-text-1">{title}</p>
      {lines.filter(([, v]) => v).map(([k, v]) => <p key={k}><span className="text-text-3">{k}:</span> {v}</p>)}
    </div>
  )
}

/* ---------- house notes ---------- */

// The notes on file, and — for a viewer who makes the house's edition — a new note and Mark resolved / Reopen; Edit…
export function NotesBody({ house, onDone, onEdit }: { house: HouseRow; onDone: () => void; onEdit?: (id: string) => void }) {
  const writes = useCan('locations.house')
  const anyone = useCan('locations.notesAny')
  const me = useFilerName()
  const apply = useApply(house.code)
  const notes = useLocationRead(readKey('locationNotes', house.code), () => readNotes(house.code), notesOf)
  const overview = useLocationRead(readKey('locationOverview', house.code), () => readOverview(house.code), overviewOf)
  // a note names a client by the key Apps Script checks it against; the houses slice's until that list answers
  const choices = overview.data?.clients.length
    ? overview.data.clients.map((c) => ({ key: c.client_key, name: c.name }))
    : house.clients.map((c) => ({ key: clientKeyOf(c), name: c.name }))
  const [client, setClient] = useState('')
  const [priority, setPriority] = useState<NotePriority>('normal')
  const [details, setDetails] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const clientName = choices.find((c) => c.key === client)?.name ?? ''

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      await apply.run(() => addNote({ house: house.code, ...(client ? { client_key: client } : {}), priority,
        details: details.trim() }), [REREAD.notes(house.code), REREAD.overview(house.code)])
      setDetails('')
      setClient('')
      setPriority('normal')
    } catch (e) {
      toast({ type: 'danger', title: 'Not filed', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const flip = async (id: string, state: 'open' | 'resolved') => {
    const press = nextPress(armed, `${state}:${id}`)
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      await apply.run(() => setNoteState(id, state, house.code), [REREAD.notes(house.code)])
    } catch (e) {
      toast({ type: 'danger', title: 'Not changed', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const list = notes.data ?? []
  return (
    <div className="grid gap-5 pt-1" data-notes-panel="">
      <p className="text-[13px] text-text-2"><span className="font-semibold text-primary">{house.title}</span> · Location</p>
      <ApplyStrip state={apply.state} onDone={apply.reset} onAgain={apply.reset} />
      {writes && <><div className="grid gap-3">
        <Field label="For"><input value={house.title} readOnly className={cn(inputCls, 'bg-surface-2')} /></Field>
        <Field label="Associated client">
          <select value={client} disabled={busy} onChange={(e) => setClient(e.target.value)} className={inputCls} data-note-client="">
            <option value="">Choose client</option>
            {choices.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} disabled={busy} onChange={(e) => setPriority(e.target.value as NotePriority)} className={inputCls}>
            {NOTE_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Details" required>
          <textarea value={details} disabled={busy} placeholder="Describe the request…" className={TEXTAREA}
            onChange={(e) => { setDetails(e.target.value); setArmed('') }} />
        </Field>
      </div>
      {armed === 'file' && (
        <Review lines={[['For', house.title], ['Client', clientName], ['Priority', priorityLabel(priority)], ['Details', details.trim()]]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!details.trim()} armedLabel={APPLY}
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} /></>}

      <div className={cn(writes && 'border-t border-border pt-4')}>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Notes on file</h3>
        <ReadLine state={notes} what="the house notes" onRetry={notes.reload} />
        {notes.data && list.length === 0 && <p className="text-[13px] text-text-3">No house notes.</p>}
        <ul className="grid gap-2">
          {list.map((n) => {
            const flipTo = n.state === 'open' ? 'resolved' : 'open'
            const armedHere = armed === `${flipTo}:${n.id}`
            return (
              <li key={n.id} data-note={n.id} data-state={n.state}
                className={cn('rounded-lg border border-border px-3 py-2.5', n.state === 'resolved' && 'opacity-70')}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <TintChip label={priorityLabel(n.priority)} tint={n.priority === 'urgent' ? 'danger' : n.priority === 'high' ? 'warning' : 'slate'} />
                  {n.state === 'resolved' && <TintChip label="Resolved" tint="mint" />}
                  {noteClient(n, house.clients) && <span className="text-[12px] font-semibold text-text-2">{noteClient(n, house.clients)}</span>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-text-1">{n.details}</p>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-text-3">
                  <span>{[n.by, ohioDayYear(n.at)].filter(Boolean).join(' · ')}</span>
                  {onEdit && (anyone || (writes && n.by === me)) && <button type="button" disabled={busy} onClick={() => onEdit(n.id)}
                    data-edit-note={n.id} className="ml-auto rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary-soft">Edit</button>}
                  {writes && <button type="button" disabled={busy} onClick={() => void flip(n.id, flipTo)} data-flip={n.id}
                    className={cn('rounded-md px-2 py-1 font-semibold', armedHere ? 'bg-primary text-on-primary' : 'text-primary hover:bg-primary-soft')}>
                    {armedHere ? APPLY : flipTo === 'resolved' ? 'Mark resolved' : 'Reopen'}
                  </button>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/* ---------- new incident ---------- */

/** A new incident, as Locations files it — also opened from a client's Incidents (Clients), where `client` fixes the
 * client and `via` files it for that client and reads Clients again. */
export function IncidentForm({ house, onDone, client, via }: {
  house: Pick<HouseRow, 'code' | 'title'> & Partial<Pick<HouseRow, 'clients'>>
  onDone: () => void
  client?: string
  via?: PanelVia
}) {
  const me = useFilerName()
  const overview = useLocationRead(readKey('locationOverview', house.code), () => readOverview(house.code), overviewOf)
  // every active employee, ticked; a viewer the door is not open to types the names
  const employees = useIncidentStaff()
  // the title, the notes under the fields and the Still needed line: the master's while Settings › My Work keeps them
  const bare = useShellHides().incident_notes
  // the clients locationIncidents joins a filing against; the houses slice's until that list answers; one fixed client
  const clientNames = client ? [client]
    : overview.data?.clients.length ? overview.data.clients.map((c) => c.name) : (house.clients ?? []).map((c) => c.name)
  const [values, setValues] = useState<Record<string, string>>({ incident_date: ohioToday(), ...(client ? { client_name: client } : {}) })
  const fields = useMemo(() => incidentFields(INCIDENT_FIELDS, employees, bare).flatMap((f): OpsField[] => {
    if (f.key === 'incident_location' && values.incident_location === INCIDENT_PLACE_OTHER) {
      return [f, { key: 'incident_location_other', label: 'Other location', required: true, placeholder: 'Fill in where' }]
    }
    return [f]
  }), [employees, bare, values.incident_location])
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const apply = useApplyFor(useMemo(() => via?.target ?? locationTarget(house.code), [via, house.code]))
  const missing = missingFields(fields, values)
  const draft = incidentPayload(values, me, '')

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      await apply.run(() => fileIncident(house.code, incidentPayload(values, me, new Date().toISOString()), via?.client),
        via?.rereads ?? [REREAD.incidents(house.code)])
    } catch (e) {
      toast({ type: 'danger', title: 'Not filed', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (apply.state.phase === 'done') return <div className="grid gap-4 pt-1" data-incident-form=""><ApplyStrip state={apply.state} onDone={onDone} /></div>
  return (
    <div className="grid gap-4 pt-1" data-incident-form="">
      <FormFields fields={fields} values={values} disabled={busy}
        options={{ client_name: clientNames, employees_involved: employees }}
        onChange={(k, v) => { setValues((s) => ({ ...s, [k]: v })); setArmed('') }} />
      {!bare && missing.length > 0 && <p className="text-[12px] text-text-3" data-still-needed="">Still needed: {missing.join(', ')}.</p>}
      {armed === 'file' && (
        <Review lines={INCIDENT_FIELDS.map((f) => [f.label.split(' — ')[0], draft[f.key] ?? ''] as [string, string])} />
      )}
      <ApplyStrip state={apply.state} onAgain={apply.reset} />
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={missing.length > 0} armedLabel={APPLY}
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- an incident edited ---------- */

/** One incident edited in the New Incident form itself: the same fields, opened with the report's values; only the
 * columns moved are sent, each with the cell it witnesses. Also opened from a client's Incidents (Clients), where
 * `client` fixes the client and `via` decides the write for that client and reads Clients again. */
export function IncidentEditForm({ house, row, onDone, client, via }: {
  house: Pick<HouseRow, 'code' | 'title'> & Partial<Pick<HouseRow, 'clients'>>
  /** the report's id ("r42") and its cells as read */
  row: { id: string; row: Record<string, string> }
  onDone: () => void
  client?: string
  via?: PanelVia
}) {
  const overview = useLocationRead(client ? null : readKey('locationOverview', house.code), () => readOverview(house.code), overviewOf)
  const read = useIncidentStaff()
  const bare = useShellHides().incident_notes
  const cells = row.row
  // a name the report already carries stays tickable, whoever the staff list names now
  const employees = useMemo(() => {
    if (!read.length) return read
    const named = incidentNames(cells.employees_involved ?? '').filter((n) => !read.includes(n))
    return [...read, ...named]
  }, [read, cells.employees_involved])
  const opened = useMemo(() => incidentFormValues(cells, employees), [cells, employees])
  const [typed, setTyped] = useState<Record<string, string>>({})
  const values = useMemo(() => ({ ...opened, ...typed }), [opened, typed])
  const filed = (cells.client_name ?? '').trim()
  const clientNames = useMemo(() => {
    const listed = client ? [client] : overview.data?.clients.length ? overview.data.clients.map((c) => c.name)
      : (house.clients ?? []).map((c) => c.name)
    return filed && !listed.includes(filed) ? [filed, ...listed] : listed
  }, [client, overview.data, house.clients, filed])
  // a category or place the paper form no longer lists stays the report's own choice
  const fields = useMemo(() => incidentFields(INCIDENT_FIELDS, employees, bare).flatMap((f): OpsField[] => {
    const had = (cells[f.key] ?? '').trim()
    const g = f.key === 'incident_category' && had && !(f.options ?? []).includes(had) ? { ...f, options: [had, ...(f.options ?? [])] } : f
    if (g.key === 'incident_location' && values.incident_location === INCIDENT_PLACE_OTHER) {
      return [g, { key: 'incident_location_other', label: 'Other location', placeholder: 'Fill in where' }]
    }
    return [g]
  }), [employees, bare, values.incident_location, cells])
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const apply = useApplyFor(useMemo(() => via?.target ?? locationTarget(house.code), [via, house.code]))
  const changes = incidentEditChanges(cells, opened, values)
  const filer = [cells.your_name, cells.timestamp && ohioDayYear(cells.timestamp)].filter(Boolean).join(' · ')

  const save = async () => {
    const press = nextPress(armed, 'save')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const own = via?.edit
      const send = own ? () => own(row.id, changes, cells) : () => editIncident(house.code, row.id, changes, via?.client)
      const a = editAnswerOf(await apply.run(send, via?.rereads ?? [REREAD.incidents(house.code)]))
      if (a.refused.length) {
        toast({ type: 'warning', title: 'Some changes were not saved', body: a.refused.map((r) => `${r.field}: ${r.why}`).join(' ') })
      }
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (apply.state.phase === 'done') return <div className="grid gap-4 pt-1" data-edit-panel="incident"><ApplyStrip state={apply.state} onDone={onDone} /></div>
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-edit-panel="incident" data-incident-form="edit">
      {filer && <p className="text-[12px] text-text-3" data-filed-by="">Filed by {filer}</p>}
      <FormFields fields={fields} values={values} disabled={busy}
        options={{ client_name: clientNames, employees_involved: employees }}
        onChange={(k, v) => { setTyped((s) => ({ ...s, [k]: v })); setArmed('') }} />
      {armed === 'save' && (
        <Review title="This is what will be saved:"
          lines={changes.map((c) => [INCIDENT_FIELDS.find((f) => f.key === c.field)?.label.split(' — ')[0] ?? c.field, c.value || '(cleared)'] as [string, string])} />
      )}
      <ApplyStrip state={apply.state} onAgain={apply.reset} />
      <DraftButtons armed={armed === 'save'} busy={busy} disabled={changes.length === 0} armedLabel={APPLY}
        label={changes.length ? `Review ${changes.length} change${changes.length === 1 ? '' : 's'}` : 'Review changes'}
        onPress={() => void save()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- new house repair ---------- */

// the house picked from the locations (this one first, as its Repairs sheet already spells it), the urgency and the
// issue; the repair type is not asked
const REPAIR_FIELDS: OpsField[] = FILING_FORMS.workOrders.fields
  .filter((f) => f.key !== 'repair_type')
  .map((f) => (f.key === 'select_address_vehicle' ? { ...f, kind: 'select' } : f))

export function RepairForm({ house, houses, onDone }: { house: HouseRow; houses?: HouseRow[]; onDone: () => void }) {
  const repairs = useLocationRead(readKey('locationRepairs', house.code, false), () => readRepairs(house.code, false), (raw) => ({
    raw, rows: repairsOf(raw),
  }))
  const street = repairs.data ? repairStreet(repairs.data.raw, repairs.data.rows, house.address) : house.address
  // every active location by its street, this house's own spelling first; a pick files under that house's code
  const places = useMemo(() => {
    const out = new Map<string, string>([[street, house.code]])
    for (const h of houses ?? []) {
      if (h.code !== house.code && h.active && h.address && !out.has(h.address)) out.set(h.address, h.code)
    }
    return out
  }, [houses, house.code, street])
  const [typed, setTyped] = useState<Record<string, string>>({})
  const values: Record<string, string> = { select_address_vehicle: street, ...typed }
  const code = places.get(values.select_address_vehicle) ?? house.code
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const apply = useApply(code)
  const missing = missingFields(REPAIR_FIELDS, values)

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      await apply.run(() => fileRepair(code, repairPayload(REPAIR_FIELDS, values, new Date().toISOString())),
        [REREAD.repairs(code)])
    } catch (e) {
      toast({ type: 'danger', title: 'Not filed', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (apply.state.phase === 'done') return <div className="grid gap-4 pt-1" data-repair-form=""><ApplyStrip state={apply.state} onDone={onDone} /></div>
  return (
    <div className="grid gap-4 pt-1" data-repair-form="">
      <FormFields fields={REPAIR_FIELDS} values={values} disabled={busy}
        options={{ select_address_vehicle: [...places.keys()] }}
        onChange={(k, v) => { setTyped((s) => ({ ...s, [k]: v })); setArmed('') }} />
      {armed === 'file' && (
        <Review lines={REPAIR_FIELDS.map((f) => [f.label.split(' — ')[0], values[f.key] ?? ''] as [string, string])} />
      )}
      <ApplyStrip state={apply.state} onAgain={apply.reset} />
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={missing.length > 0} armedLabel={APPLY}
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- a supply count, delivery or par level ---------- */

export function SupplyForm({ house, entry, item, onDone }: { house: HouseRow; entry: SupplyKind; item: string; onDone: () => void }) {
  const supplies = useLocationRead(readKey('locationSupplies', house.code), () => readSupplies(house.code), suppliesOf)
  const known = supplies.data?.consumables ?? []
  const [v, setV] = useState<SupplyValues>(() => ({ kind: entry, item, category: '', qty: '', onHandAfter: '', note: '' }))
  const category = v.category || known.find((c) => c.item.toLowerCase() === v.item.trim().toLowerCase())?.category || ''
  const draft = supplyDraft(house.code, { ...v, category })
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const apply = useApply(house.code)
  const set = (patch: Partial<SupplyValues>) => { setV((s) => ({ ...s, ...patch })); setArmed('') }

  const file = async () => {
    if (typeof draft === 'string') return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      await apply.run(() => addSupplyEntry(draft), [REREAD.supplies(house.code)])
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (apply.state.phase === 'done') return <div className="grid gap-4 pt-1" data-supply-form={v.kind}><ApplyStrip state={apply.state} onDone={onDone} /></div>
  return (
    <div className="grid gap-4 pt-1" data-supply-form={v.kind}>
      <Field label="What is recorded">
        <ChipPicker options={SUPPLY_KINDS.map((k) => k.label)} value={SUPPLY_KINDS.find((k) => k.id === v.kind)?.label ?? ''}
          onChange={(label) => set({ kind: SUPPLY_KINDS.find((k) => k.label === label)?.id ?? 'count' })} />
      </Field>
      <Field label="Item" required>
        <input value={v.item} disabled={busy} list="loc-supply-items" onChange={(e) => set({ item: e.target.value })}
          placeholder="e.g. Nitrile gloves (M)" className={inputCls} />
        <datalist id="loc-supply-items">{known.map((c) => <option key={c.item} value={c.item} />)}</datalist>
      </Field>
      <Field label="Category">
        <input value={v.category || category} disabled={busy} list="loc-supply-cats" onChange={(e) => set({ category: e.target.value })}
          placeholder="e.g. Care supplies, Household" className={inputCls} />
        <datalist id="loc-supply-cats">{[...new Set(known.map((c) => c.category).filter(Boolean))].map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label={SUPPLY_QTY_LABEL[v.kind]} required>
        <input value={v.qty} disabled={busy} inputMode="decimal" onChange={(e) => set({ qty: e.target.value })} className={inputCls} />
      </Field>
      {v.kind === 'delivery' && (
        <Field label="On hand after the delivery (optional)">
          <input value={v.onHandAfter} disabled={busy} inputMode="decimal" onChange={(e) => set({ onHandAfter: e.target.value })}
            className={inputCls} />
        </Field>
      )}
      <Field label="Note">
        <input value={v.note} disabled={busy} onChange={(e) => set({ note: e.target.value })} className={inputCls} />
      </Field>
      {typeof draft === 'string' && (v.item || v.qty) && <p className="text-[12px] text-text-3">{draft}</p>}
      {armed === 'file' && typeof draft !== 'string' && (
        <Review lines={[['Item', draft.item], ['Category', draft.category], [SUPPLY_QTY_LABEL[draft.kind], String(draft.qty)],
          ['On hand after', draft.on_hand_after === undefined ? '' : String(draft.on_hand_after)], ['Note', draft.note ?? '']]} />
      )}
      <ApplyStrip state={apply.state} onAgain={apply.reset} />
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={typeof draft === 'string'} armedLabel={APPLY}
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- an IST paper ---------- */

export function IstUpload({ house, staff, client, onDone }: { house: HouseRow; staff: string; client: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const apply = useApply(house.code)

  const pick = (f: File) => {
    setArmed('')
    const why = istPaperProblem({ name: f.name, size: f.size, type: f.type })
    setProblem(why)
    setFile(why ? null : f)
  }

  const send = async () => {
    if (!file) return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const b64 = await fileToBase64(file)
      await apply.run(() => fileIstPaper({ house: house.code, staff, client, file: { name: file.name, mime: istPaperType(file), b64 } }),
        [REREAD.staff(house.code), REREAD.documents(house.code)])
    } catch (e) {
      toast({ type: 'danger', title: 'Not filed', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (apply.state.phase === 'done') return <div className="grid gap-3" data-ist-upload=""><ApplyStrip state={apply.state} onDone={onDone} /></div>
  return (
    <div className="grid gap-3" data-ist-upload="">
      {file ? <SelectedFileCard file={file} disabled={busy} onRemove={() => { setFile(null); setArmed('') }} />
        : <FileDropZone accept={IST_ACCEPT} hint={IST_PAPER_HINT} disabled={busy} onFile={pick} />}
      {problem && <p className="text-[12.5px] text-danger">{problem}</p>}
      {busy && apply.state.phase === 'idle' && <p className="flex items-center gap-2 text-[12px] text-text-3"><Loader2 size={13} className="animate-spin" /> Reading the paper…</p>}
      <ApplyStrip state={apply.state} onAgain={apply.reset} />
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!file} label="File paper" armedLabel={APPLY}
        onPress={() => void send()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}
