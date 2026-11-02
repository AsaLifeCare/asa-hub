// The panel's forms: Assign Training (a training request, or an IST at a house), New HR Issue (a row on the HR…
// Each is drawn in the right panel and files on the second press.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Field, TintChip, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import {
  INCIDENT_FIELDS, NOTE_PRIORITIES, incidentPayload, missingFields, priorityLabel, type NotePriority,
} from '@/pages/features/locations/locationModel'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/apiCache'
import { ohioToday } from '@/lib/ohio'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import {
  NOTE_CATEGORIES, assignSplit, assignableHouses, categoryLabel, dateWords, mayEditSection, notesOf, overviewOf, readRefusal,
  stampWords, type NoteCategory, type RosterRow, type StaffAsk,
} from './staffModel'
import {
  QUEUED_WORDS, addHrIssue, addIst, addNote, assignTraining, concludeDoc, readKey, readNotes, readOverview, requestTraining, setNoteState,
  staffWrote, useStaffRead, type AssignAnswer,
} from './useStaffRead'
import { DOC_AREA_WORDS, HR_CATEGORIES, HR_SEVERITIES } from './perfModel'
import { EditPencil, ReadLine } from './StaffParts'
import { useStaffViewer } from './staffViewer'

const TEXTAREA = 'min-h-[96px] w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const errText = (e: unknown): string => readRefusal(e instanceof Error ? e.message : String(e))

function useFilerName(): string {
  return useAuthStore((s) => s.user?.name || s.user?.email || '')
}

export function Review({ lines }: { lines: [string, string][] }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-review="">
      <p className="mb-1 font-semibold text-text-1">This is what will be filed:</p>
      {lines.filter(([, v]) => v).map(([k, v]) => <p key={k}><span className="text-text-3">{k}:</span> {v}</p>)}
    </div>
  )
}

/* ---------- the houses slice, for the house picker ---------- */

type Houses = { rows: HouseRow[] | null; failed: string }

function useHousesSlice(): Houses {
  const [state, setState] = useState<Houses>({ rows: null, failed: '' })
  useEffect(() => {
    let live = true
    api.list<HouseRow>('houses')
      .then((rows) => { if (live) setState(Array.isArray(rows) ? { rows, failed: '' } : { rows: null, failed: 'The houses slice answered no rows.' }) })
      .catch((err: unknown) => { if (live) setState({ rows: null, failed: err instanceof Error ? err.message : 'The houses slice did not answer.' }) })
    return () => {
      live = false
    }
  }, [])
  return state
}

/* ---------- assign training ---------- */

// Assign Training: For, Priority, Training and instructions — a training request on the person's notes.
export function AssignTrainingForm({ row, house: preset, onDone, houses, ist: istAllowed = true }: {
  row: RosterRow
  house: string
  onDone: () => void
  houses?: HouseRow[] | null
  /** the IST at a house is offered (a manager or the master, never the person alone) */
  ist?: boolean
}) {
  const [ist, setIst] = useState(!!preset && istAllowed)
  if (ist) return <IstAssignForm row={row} house={preset} houses={houses} onDone={onDone} />
  return (
    <TrainingRequestForm staffKey={row.key} name={row.name} onDone={onDone}
      extra={istAllowed ? (
        <button type="button" onClick={() => setIst(true)} data-assign-ist=""
          className="justify-self-start text-[12.5px] font-semibold text-primary hover:underline">
          Assign an IST at a house instead
        </button>
      ) : null} />
  )
}

/** For (the person), Priority, Training and instructions; files on the second press of Review draft. */
export function TrainingRequestForm({ staffKey, name, onDone, onFiled, extra, who = 'Staff' }: {
  staffKey: string
  name: string
  onDone: () => void
  onFiled?: () => void
  extra?: ReactNode
  /** the word after the name under the title */
  who?: string
}) {
  const [priority, setPriority] = useState<NotePriority>('normal')
  const [details, setDetails] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const text = details.trim()

  const file = async () => {
    if (!text) return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await requestTraining({ staff: staffKey, priority, details: text })
      const queued = staffWrote(staffKey, got)
      toast({ type: 'success', title: queued ? 'Training accepted' : 'Training assigned',
        body: queued ? QUEUED_WORDS : `${name} · ${priorityLabel(priority)}` })
      onFiled?.()
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not assigned', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-training-request="">
      <p className="text-[13px] text-text-2"><span className="font-semibold text-primary">{name}</span> · {who}</p>
      <Field label="For"><input value={name} readOnly className={cn(inputCls, 'bg-surface-2')} /></Field>
      <Field label="Priority">
        <select value={priority} disabled={busy} onChange={(e) => { setPriority(e.target.value as NotePriority); setArmed('') }}
          className={inputCls} data-training-priority="">
          {NOTE_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
      <Field label="Training and instructions" required>
        <textarea value={details} disabled={busy} placeholder="Describe the request…" className={TEXTAREA} maxLength={4000}
          onChange={(e) => { setDetails(e.target.value); setArmed('') }} data-training-details="" />
      </Field>
      {extra}
      {armed === 'file' && <Review lines={[['For', name], ['Priority', priorityLabel(priority)], ['Training and instructions', text]]} />}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!text} armedLabel="Assign training — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- new HR issue ---------- */

/** Add HR incident: filed on the HR tracker Under review; recording a concern establishes no finding. */
export function HrIssueForm({ row, onDone }: { row: RosterRow; onDone: () => void }) {
  const [date, setDate] = useState(ohioToday())
  const [severity, setSeverity] = useState<string>(HR_SEVERITIES[0])
  const [category, setCategory] = useState<string>(HR_CATEGORIES[HR_CATEGORIES.length - 1])
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const [action, setAction] = useState('')
  const [review, setReview] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = !!date && !!summary.trim() && !!details.trim()
  const edit = (set: (v: string) => void) => (v: string) => { set(v); setArmed('') }

  const file = async () => {
    if (!ready) return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await addHrIssue({
        staff: row.key, date, severity, category, summary: summary.trim(), details: details.trim(),
        ...(action.trim() ? { action: action.trim() } : {}), ...(review ? { next_review: review } : {}),
      })
      const queued = staffWrote(row.key, got)
      toast({ type: 'success', title: queued ? 'HR issue accepted' : 'HR issue added',
        body: queued ? QUEUED_WORDS : `${row.name} · ${category} · Under review` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-hr-issue-form="">
      <p className="text-[13px] text-text-2"><span className="font-semibold text-text-1">{row.name}</span> · restricted HR record</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Incident date" required>
          <input type="date" value={date} max={ohioToday()} disabled={busy} onChange={(e) => edit(setDate)(e.target.value)}
            className={inputCls} data-hr-date="" />
        </Field>
        <Field label="Severity">
          <select value={severity} disabled={busy} onChange={(e) => edit(setSeverity)(e.target.value)} className={inputCls} data-hr-severity="">
            {HR_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Category">
        <select value={category} disabled={busy} onChange={(e) => edit(setCategory)(e.target.value)} className={inputCls} data-hr-category="">
          {HR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Summary" required>
        <input value={summary} disabled={busy} maxLength={200} placeholder="Briefly describe the reported concern"
          onChange={(e) => edit(setSummary)(e.target.value)} className={inputCls} data-hr-summary="" />
      </Field>
      <Field label="Reported details" required>
        <textarea value={details} disabled={busy} maxLength={4000} placeholder="Record what was reported and the context for review"
          onChange={(e) => edit(setDetails)(e.target.value)} className={TEXTAREA} data-hr-details="" />
      </Field>
      <Field label="Immediate action (optional)">
        <textarea value={action} disabled={busy} maxLength={2000} onChange={(e) => edit(setAction)(e.target.value)}
          className={cn(TEXTAREA, 'min-h-[64px]')} data-hr-action="" />
      </Field>
      <Field label="Next review (optional)">
        <input type="date" value={review} disabled={busy} onChange={(e) => edit(setReview)(e.target.value)} className={inputCls}
          data-hr-review="" />
      </Field>
      <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] leading-5 text-text-2">
        New incidents start Under review. Recording a concern does not establish a finding or change the reviewed performance score.
      </p>
      {armed === 'file' && (
        <Review lines={[['Staff member', row.name], ['Incident date', date], ['Severity', severity], ['Category', category],
          ['Summary', summary.trim()], ['Reported details', details.trim()], ['Immediate action', action.trim()],
          ['Next review', review], ['Status', 'Under review']]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!ready} label="Add HR issue" armedLabel="Add HR issue — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/** Mark concluded: a missing daily note or punch in Performance › Documentation, with why; it then counts as complete. */
export function DocMarkForm({ row, date, area, onDone }: { row: RosterRow; date: string; area: string; onDone: () => void }) {
  const [why, setWhy] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const what = DOC_AREA_WORDS[area] ?? area
  const ready = !!why.trim()

  const file = async () => {
    if (!ready) return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await concludeDoc({ staff: row.key, date, area, why: why.trim() })
      const queued = staffWrote(row.key, got)
      toast({ type: 'success', title: queued ? 'Mark accepted' : 'Marked concluded',
        body: queued ? QUEUED_WORDS : `${row.name} · ${what} · ${dateWords(date) || date}` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not marked', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-doc-mark-form="">
      <p className="text-[13px] text-text-2">
        <span className="font-semibold text-text-1">{row.name}</span> · {what} · {dateWords(date) || date}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-2">
        <span>Missing</span><span aria-hidden="true">→</span><TintChip label="Concluded" tint="mint" />
      </div>
      <Field label="Why it is concluded" required>
        <textarea value={why} disabled={busy} maxLength={500} placeholder="e.g. Filed on paper at the house; punch fixed in PSI"
          onChange={(e) => { setWhy(e.target.value); setArmed('') }} className={TEXTAREA} data-doc-mark-why="" />
      </Field>
      <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] leading-5 text-text-2">
        The record then counts as complete in Documentation, and its row says who concluded it, when and why.
      </p>
      {armed === 'file' && (
        <Review lines={[['Staff member', row.name], ['Record', what], ['Day', dateWords(date) || date], ['Becomes', 'Concluded'],
          ['Why', why.trim()]]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!ready} label="Mark concluded"
        armedLabel="Mark concluded — press again" onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/** An IST for a client this person worked with and holds none for (Related Clients): trained on a day, or owed by it. */
export function IstAddForm({ row, client: clientKey, onDone }: { row: RosterRow; client: string; onDone: () => void }) {
  const overview = useStaffRead(readKey('staffProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  const client = overview.data?.clients.find((c) => c.client_key === clientKey) ?? null
  const held = !!overview.data?.ist.some((r) => r.client_key === clientKey)
  const [status, setStatus] = useState<'done' | 'owed'>('done')
  const [day, setDay] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const today = ohioToday()
  const ready = !!client && !held && /^\d{4}-\d{2}-\d{2}$/.test(day) && (status === 'owed' || day <= today)
  const dayLabel = status === 'done' ? 'Trained on' : 'Due by'

  const file = async () => {
    if (!ready || !client) return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await addIst({ key: row.key, client: client.client_key, status, day })
      const queued = staffWrote(row.key, got)
      toast({ type: 'success', title: queued ? 'IST accepted' : 'IST recorded',
        body: queued ? QUEUED_WORDS : `${row.name} · ${client.name} · ${status === 'done' ? 'trained' : 'due'} ${dateWords(day) || day}` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'IST not recorded', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-ist-add-form="">
      <ReadLine state={overview} what="the related clients" onRetry={overview.reload} />
      {overview.data && !client && <p className="text-[13px] text-text-3">This client is not among the clients {row.name} worked with.</p>}
      {client && (
        <p className="text-[13px] text-text-2">
          <span className="font-semibold text-text-1">{row.name}</span> · {client.name}{client.house ? ` · ${client.house}` : ''}
        </p>
      )}
      {held && <p className="text-[13px] text-text-3">An IST record for {client?.name} is already on file — edit it from the IST column.</p>}
      {client && !held && (
        <>
          <Field label="IST" required>
            <select value={status} disabled={busy} onChange={(e) => { setStatus(e.target.value === 'owed' ? 'owed' : 'done'); setArmed('') }}
              className={inputCls} data-ist-add-status="">
              <option value="done">Trained</option>
              <option value="owed">Owed</option>
            </select>
          </Field>
          <Field label={dayLabel} required>
            <input type="date" value={day} max={status === 'done' ? today : undefined} disabled={busy}
              onChange={(e) => { setDay(e.target.value); setArmed('') }} className={inputCls} data-ist-add-day="" />
          </Field>
          <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] leading-5 text-text-2">
            The record pairs {row.name} with {client.name} at the client's house, as Assign Training files one; it then shows on the
            ISTs card and here, and is edited from there.
          </p>
        </>
      )}
      {armed === 'file' && client && (
        <Review lines={[['Staff member', row.name], ['Client', client.name], ['House', client.house || '—'],
          ['IST', status === 'done' ? 'Trained' : 'Owed'], [dayLabel, dateWords(day) || day]]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!ready} label="Record IST"
        armedLabel="Record IST — press again" onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

function IstAssignForm({ row, house: preset, onDone, houses: given }: {
  row: RosterRow
  house: string
  onDone: () => void
  /** the houses slice when the caller holds it; read here otherwise */
  houses?: HouseRow[] | null
}) {
  const slice = useHousesSlice()
  const houses = given !== undefined ? given : slice.rows
  const overview = useStaffRead(readKey('staffProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  const ist = useMemo(() => overview.data?.ist ?? [], [overview.data])
  const options = useMemo(() => (houses ? assignableHouses(houses, ist) : []), [houses, ist])
  const [code, setCode] = useState(preset.toUpperCase())
  const [due, setDue] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<AssignAnswer | null>(null)
  const house = (houses ?? []).find((h) => h.code.toUpperCase() === code) ?? null
  const split = house ? assignSplit(house, ist) : null

  const file = async () => {
    if (!house) return
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await assignTraining({ staff: row.key, house: house.code, ...(due ? { due_date: due } : {}) })
      const queued = staffWrote(row.key, got)
      setAnswer(got)
      const made = got?.created?.length ?? 0
      const had = got?.already?.length ?? 0
      toast({ type: 'success', title: queued ? 'Training accepted' : made ? `Training assigned at ${house.title}` : 'Nothing new to assign',
        body: queued ? QUEUED_WORDS : `${made} IST${made === 1 ? '' : 's'} created${had ? ` · ${had} already on record` : ''}.` })
    } catch (e) {
      toast({ type: 'danger', title: 'Not assigned', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-assign-form="">
      <p className="text-[13px] text-text-2">
        An IST for {row.name} with every client of the house, so they can work there. The staff member is told the training is due.
      </p>
      {slice.failed && given === undefined && <p role="alert" className="text-[12.5px] text-[var(--danger)]">The houses could not be read: {slice.failed}</p>}
      <ReadLine state={overview} what="the ISTs on record" onRetry={overview.reload} />
      <Field label="House" required>
        <select value={code} disabled={busy} onChange={(e) => { setCode(e.target.value); setArmed(''); setAnswer(null) }} className={inputCls}
          data-assign-house="">
          <option value="">Choose a house</option>
          {house && !options.some((h) => h.code === house.code) && <option value={house.code}>{house.title}</option>}
          {options.map((h) => <option key={h.code} value={h.code.toUpperCase()}>{h.title}</option>)}
        </select>
      </Field>
      {house && split && (
        <div className="grid gap-1.5 rounded-lg border border-border px-3 py-2.5 text-[12.5px]" data-assign-clients="">
          <p className="font-semibold text-text-1">Clients the training covers</p>
          {split.toTrain.length === 0 && split.trained.length === 0 && split.owed.length === 0 && (
            <p className="text-text-3">The houses slice lists no client at {house.title}; the server checks the IST settings.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {split.toTrain.map((n) => <TintChip key={n} label={n} tint="blue" />)}
            {split.owed.map((n) => <TintChip key={n} label={`${n} · IST owed`} tint="amber" />)}
            {split.trained.map((n) => <TintChip key={n} label={`${n} · trained`} tint="mint" />)}
          </div>
        </div>
      )}
      <Field label="Due date (optional)">
        <input type="date" value={due} min={ohioToday()} disabled={busy} onChange={(e) => { setDue(e.target.value); setArmed('') }}
          className={inputCls} />
      </Field>
      {armed === 'file' && house && (
        <Review lines={[['Staff member', row.name], ['House', house.title], ['Clients', (split?.toTrain ?? []).join(', ')],
          ['Due', due || 'the IST settings’ default']]} />
      )}
      {answer && (
        <div className="rounded-lg bg-tint-mint px-3 py-2 text-[12.5px] text-tint-fg-mint" data-assign-answer="">
          {(answer.created ?? []).map((c) => <p key={c.id || c.client_name}>Created: {c.client_name}{c.due ? ` · due ${c.due}` : ''}</p>)}
          {(answer.already ?? []).map((c) => <p key={c.client_name}>Already on record: {c.client_name}{c.status ? ` (${c.status})` : ''}</p>)}
          {(answer.unplaced ?? []).length > 0 && (
            <p data-assign-unplaced="">
              Mapped in the IST settings but matching no client record, so not assigned: {(answer.unplaced ?? []).join(', ')}
            </p>
          )}
        </div>
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!house} armedLabel="Assign training — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- new incident ---------- */

type IncidentField = (typeof INCIDENT_FIELDS)[number]

function FormFields({ fields, values, onChange, options, disabled }: {
  fields: IncidentField[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  options?: Record<string, string[]>
  disabled: boolean
}) {
  return (
    <div className="grid gap-3">
      {fields.map((f) => {
        const v = values[f.key] ?? ''
        const id = `staff-${f.key}`
        let control
        if (f.kind === 'textarea') {
          control = <textarea id={id} value={v} disabled={disabled} placeholder={f.placeholder}
            onChange={(e) => onChange(f.key, e.target.value)} className={TEXTAREA} />
        } else if (f.kind === 'select') {
          control = (
            <select id={id} value={v} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value)} className={inputCls}>
              <option value="">Choose {f.label.toLowerCase()}</option>
              {(options?.[f.key] ?? f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )
        } else {
          control = <input id={id} type={f.kind === 'date' || f.kind === 'time' ? f.kind : 'text'} value={v} disabled={disabled}
            placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} className={inputCls} />
        }
        return <Field key={f.key} label={f.label} required={f.required}>{control}</Field>
      })}
    </div>
  )
}

export function IncidentForm({ row, onDone }: { row: RosterRow; onDone: () => void }) {
  const me = useFilerName()
  const overview = useStaffRead(readKey('staffProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  const clientNames = overview.data?.clients.map((c) => c.name) ?? []
  // with no client tied to this person, the client is typed
  const fields = INCIDENT_FIELDS.map((f) => (f.key === 'client_name' && overview.data && !clientNames.length ? { ...f, kind: 'text' as const } : f))
  const [values, setValues] = useState<Record<string, string>>({ incident_date: ohioToday(), employees_involved: row.name })
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const missing = missingFields(fields, values)

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await api.create('uiIncidents', incidentPayload(values, me, new Date().toISOString()))
      invalidate('uiIncidents')
      const queued = staffWrote(row.key, got)
      toast({ type: 'success', title: queued ? 'Incident accepted' : 'Incident filed',
        body: queued ? QUEUED_WORDS : `${values.client_name} · ${values.incident_category}` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not filed', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-incident-form="">
      <p className="text-[13px] text-text-2">
        Filed in the estate's UI Reports sheet, as {me || 'the signed-in account'}, with {row.name} among the employees involved.
      </p>
      <ReadLine state={overview} what="the clients this person works with" onRetry={overview.reload} />
      <FormFields fields={fields} values={values} disabled={busy} options={{ client_name: clientNames }}
        onChange={(k, v) => { setValues((s) => ({ ...s, [k]: v })); setArmed('') }} />
      {missing.length > 0 && <p className="text-[12px] text-text-3">Still needed: {missing.join(', ')}.</p>}
      {armed === 'file' && (
        <Review lines={fields.map((f) => [f.label.split(' — ')[0], values[f.key] ?? ''] as [string, string])} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={missing.length > 0} armedLabel="File incident — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/* ---------- staff notes ---------- */

const PRIORITY_TINT: Record<string, 'slate' | 'warning' | 'danger'> = { normal: 'slate', high: 'warning', urgent: 'danger' }

export function NoteForm({ row, onDone, onAsk }: { row: RosterRow; onDone: () => void; onAsk?: (ask: StaffAsk) => void }) {
  const notes = useStaffRead(readKey('staffProfileNotes', row.key), () => readNotes(row.key), notesOf)
  const edits = mayEditSection(useStaffViewer(), 'note') && !!onAsk
  const [category, setCategory] = useState<NoteCategory>('general')
  const [priority, setPriority] = useState<NotePriority>('normal')
  const [details, setDetails] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const text = details.trim()

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await addNote({ staff: row.key, category, priority, details: text })
      const queued = staffWrote(row.key, got)
      toast({ type: 'success', title: queued ? 'Note accepted' : 'Note filed',
        body: queued ? QUEUED_WORDS : `${row.name} · ${categoryLabel(category)} · ${priorityLabel(priority)}` })
      setDetails('')
      setCategory('general')
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
      if (staffWrote(row.key, await setNoteState(id, state, row.key))) {
        toast({ type: 'success', title: 'Change accepted', body: QUEUED_WORDS })
      }
    } catch (e) {
      toast({ type: 'danger', title: 'Not changed', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const list = notes.data?.notes ?? []
  const earlier = notes.data?.earlier ?? []
  return (
    <div className="grid gap-5 pt-1" data-notes-panel="">
      <div className="grid gap-3">
        <Field label="Category">
          <select value={category} disabled={busy} onChange={(e) => setCategory(e.target.value as NoteCategory)} className={inputCls} data-note-category="">
            {NOTE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} disabled={busy} onChange={(e) => setPriority(e.target.value as NotePriority)} className={inputCls}>
            {NOTE_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Details" required>
          <textarea value={details} disabled={busy} maxLength={4000} placeholder="What should the team know about this person…" className={TEXTAREA}
            onChange={(e) => { setDetails(e.target.value); setArmed('') }} />
        </Field>
      </div>
      {armed === 'file' && (
        <Review lines={[['For', row.name], ['Category', categoryLabel(category)], ['Priority', priorityLabel(priority)], ['Details', text]]} />
      )}
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!text} armedLabel="File note — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />

      <div className="border-t border-border pt-4">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Notes on file</h3>
        <ReadLine state={notes} what="the staff notes" onRetry={notes.reload} />
        {notes.data?.why && <p className="mb-2 text-[12px] text-text-3">{notes.data.why}</p>}
        {notes.data && list.length === 0 && <p className="text-[13px] text-text-3">No staff notes.</p>}
        <ul className="grid gap-2">
          {list.map((n) => {
            const flipTo = n.state === 'open' ? 'resolved' : 'open'
            const armedHere = armed === `${flipTo}:${n.id}`
            return (
              <li key={n.id} data-note={n.id} data-state={n.state}
                className={cn('rounded-lg border border-border px-3 py-2.5', n.state === 'resolved' && 'opacity-70')}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <TintChip label={priorityLabel(n.priority)} tint={PRIORITY_TINT[n.priority] ?? 'slate'} />
                  <span className="text-[12px] font-semibold text-text-2">{categoryLabel(n.category)}</span>
                  {n.state === 'resolved' && <TintChip label="Resolved" tint="mint" />}
                  {edits && onAsk && (
                    <span className="ml-auto"><EditPencil section="note" id={n.id} label={categoryLabel(n.category)} onAsk={onAsk} /></span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-text-1">{n.details}</p>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-text-3">
                  <span>{[n.by, stampWords(n.at)].filter(Boolean).join(' · ')}</span>
                  <button type="button" disabled={busy} onClick={() => void flip(n.id, flipTo)} data-flip={n.id}
                    className={cn('rounded-md px-2 py-1 font-semibold', armedHere ? 'bg-primary text-on-primary' : 'text-primary hover:bg-primary-soft')}>
                    {armedHere ? 'Press again' : flipTo === 'resolved' ? 'Mark resolved' : 'Reopen'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        {earlier.length > 0 && (
          <div className="mt-4" data-earlier-notes="">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Earlier manager notes</h3>
            <ul className="grid gap-2">
              {earlier.map((n, i) => (
                <li key={`${n.at}-${i}`} className="rounded-lg bg-surface-2/60 px-3 py-2 text-[12.5px] leading-5 text-text-2">
                  <p className="whitespace-pre-wrap">{n.details}</p>
                  <p className="mt-1 text-[11.5px] text-text-3">{[n.by, stampWords(n.at)].filter(Boolean).join(' · ')}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
