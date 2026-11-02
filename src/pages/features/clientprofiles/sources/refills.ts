// CLIENTS › MEDICATION › REFILLS — two doors, one model.
// pharmacy the relay's House Supplies door narrowed to the client (`/hub-lanes/house-supplies/meds?client=`…
import { useCallback, useEffect, useRef, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'
import { LaneError, lane } from '@/pages/features/shifts/laneFetch'
import { HOUSE_MEDS_PATH } from '@/pages/features/housesupplies/useHouseMeds'
import { bandOf, cutoffWords, dayMs, qty, span, type MedsRx, type MedsView } from '@/lib/houseMedsAnalysis'
import { onMemoryBoundary } from '@/lib/appPack'
import { clientPackOr } from '../clientReads'
import { NOT_OPEN, unknownActionWords } from '../clientViewer'

export const REFILLS_ACTION = 'clientSourceRefills'

export type FormTabId = 'reports' | 'low_refills' | 'control'
export type RefillViewId = 'pharmacy' | FormTabId

export type FormRow = {
  id: string; record: string; date: string; details: string; status: string; source: string
  [field: string]: unknown
}
export type FormTab = { rows: FormRow[]; kpis: Record<string, number | string>; why: string; as_of: string; note: string }
export type RefillsAnswer = {
  client: string; name: string; today: string; degraded: boolean
  tabs: Partial<Record<FormTabId, FormTab>>
}

export type RxHistory = {
  rx_root: string
  patient: string
  rows: { report_start: string; report_end: string; drug: string; physician: string; last_dispense: string;
          dispensed_in_period: string; qty_remaining: string; qty_dispensed_to_date: string; cutoff: string }[]
  sum_dispensed: string
  cumulative: string
  not_in_reports: string
}

/* ---------- the readers ---------- */

/** The relay's pack for the client first (its part is this door's own answer), else the door itself. */
export const readRefillForms = (client: string) =>
  clientPackOr(client, 'refills', () => gasAction<RefillsAnswer>('clientSourceRefills', { client })) as Promise<RefillsAnswer>
/** The relay's badge refusal (the Clients app not released to this session) as the page's plain words. */
const shutAsNotOpen = <T>(read: Promise<T>): Promise<T> => read.catch((err: unknown) => {
  throw err instanceof LaneError && err.status === 403 && err.reason === 'badge' ? new Error(NOT_OPEN) : err
})
export const pharmacyPath = (client: string) => `${HOUSE_MEDS_PATH}?client=${encodeURIComponent(client)}`
export const readPharmacy = (client: string) => shutAsNotOpen(lane<MedsView>(pharmacyPath(client)))
/** One prescription's history; with the client, behind the Clients app's gate and only that client's. */
export const readRxHistory = (rxRoot: string, client = '') => shutAsNotOpen(lane<RxHistory>(
  `${HOUSE_MEDS_PATH}/rx?key=${encodeURIComponent(rxRoot)}${client ? `&client=${encodeURIComponent(client)}` : ''}`))

/* ---------- words ---------- */

export const NO_DAYS_SUPPLY = "The pharmacy's report carries no days' supply, so no next refill date is computed: the " +
  "date ahead is the prescription's own refill cutoff. Left on Rx is what the prescription still authorizes, not the " +
  'stock at the house.'
export const REFILLS_NOT_PUBLISHED = 'The server did not recognise this read: the Refills door answers once the ' +
  'platform release that carries it is live.'

/** A refusal as a sentence; "Unknown action." is a door shut to this account, or to the master a deployment without it. */
export function refusalWords(error: string): string {
  return unknownActionWords(error, REFILLS_NOT_PUBLISHED) ?? (error || 'The read did not answer.')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 22, 2026"; '' for anything that is not a day. */
export function dayLabel(iso: string): string {
  const ms = dayMs(iso)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** "Sep 22, 2026, 13:01" for a form's wall-clock timestamp. */
export function momentLabel(at: string): string {
  const day = dayLabel(at)
  const m = /T(\d{2}:\d{2})/.exec(String(at || ''))
  return day && m ? `${day}, ${m[1]}` : day
}

/** Whole days from one ISO day to another; null when either is not a day. */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = dayMs(fromIso), b = dayMs(toIso)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null
}

/** Today on the company's clock (America/New_York), as YYYY-MM-DD. */
export function companyToday(now: Date = new Date()): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...o }).format(now)
  return `${part({ year: 'numeric' })}-${part({ month: '2-digit' })}-${part({ day: '2-digit' })}`
}

/* ---------- the model ---------- */

export type Kpi = { label: string; value: string }
export type Field = { label: string; value: string }
export type RefillRow = {
  id: string; record: string; date: string; details: string; status: string; source: string
  fields: Field[]
  /** the pharmacy's prescription family, whose history the panel reads; '' for a form row */
  rxRoot: string
}
export type RefillView = {
  id: RefillViewId
  label: string
  source: string
  /** failed: nothing of this source could be drawn; ready with a `why`: drawn from the last good read or a copy */
  state: 'loading' | 'ready' | 'failed'
  rows: RefillRow[]
  statuses: string[]
  kpis: Kpi[]
  /** why the source could not be read (rows, when any, are the last good read or a copy) */
  why: string
  /** a caveat about what the source does not carry */
  note: string
  /** the source's own freshness line */
  asOf: string
  /** what an empty table means for this source */
  empty: string
  /** the source is not open to this session: said plainly, with no alert and no retry */
  shut?: boolean
}

export type SourceState<T> = { status: 'idle' | 'loading' | 'ready' | 'failed'; data: T | null; error: string; refreshing: boolean }

const STATUS_ORDER = ['Ending', 'None left', 'Low', 'Not stated', 'OK', 'Not current',
  'Outstanding', 'In Process', 'Reported', 'Completed', 'Resolved', 'No status', 'Due', 'Scheduled', 'No due date']

export function statusesOf(rows: { status: string }[]): string[] {
  const seen = [...new Set(rows.map((r) => r.status).filter(Boolean))]
  const rank = (s: string) => {
    const i = STATUS_ORDER.indexOf(s)
    return i === -1 ? STATUS_ORDER.length : i
  }
  return seen.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export type Tint = 'mint' | 'amber' | 'danger' | 'slate' | 'blue' | 'lavender'

export function statusTint(status: string): Tint {
  const s = status.trim().toLowerCase()
  if (s === 'ending') return 'lavender'
  if (s === 'none left' || s === 'due') return 'danger'
  if (s === 'low' || s === 'outstanding') return 'amber'
  if (s === 'ok' || /^(completed|resolved|received|closed|done)/.test(s)) return 'mint'
  if (s === 'in process' || s === 'reported' || s === 'scheduled') return 'blue'
  return 'slate'
}

/** The pharmacy's band as a status word: House Supplies' own bands, and "Not current" for a past family. */
export function rxStatus(rx: MedsRx, view: Pick<MedsView, 'latest' | 'low_left'>): string {
  if (!rx.current) return 'Not current'
  const band = bandOf(rx, view.latest, view.low_left || 7)
  if (band === 'ending') return 'Ending'
  if (band === 'none') return 'None left'
  if (band === 'low') return 'Low'
  if (band === 'plenty') return 'OK'
  return 'Not stated'
}

function leftOnRx(rx: MedsRx): string {
  const left = qty(rx.qty_remaining)
  if (left === null) return 'Left on Rx not stated'
  return left <= 0 ? 'None left on Rx' : `${left} left on Rx`
}

const kept = (fields: [string, unknown][]): Field[] =>
  fields.map(([label, v]) => ({ label, value: String(v ?? '').trim() })).filter((f) => f.value !== '')

// This client's prescriptions from the relay's answer, narrowed here too when the relay did not narrow them.
export function clientRx(view: MedsView, client: string): MedsRx[] {
  const patids = new Set(view.patients
    .filter((p) => p.client_key && p.client_key === client && p.group !== 'unmatched').map((p) => p.patid))
  return view.rx.filter((r) => patids.has(r.patid))
}

const RX_ORDER = ['Ending', 'None left', 'Low', 'Not stated', 'OK', 'Not current']

export function pharmacyRows(view: MedsView, client: string, todayIso: string, showPast: boolean): RefillRow[] {
  const rows = clientRx(view, client).filter((r) => showPast || r.current).map((r) => {
    const status = rxStatus(r, view)
    const since = daysBetween(r.last_dispense, todayIso)
    const sinceWords = since === null ? '' : `${since} day${since === 1 ? '' : 's'} since dispensed`
    return {
      id: `rx-${r.rx_root}`, record: r.drug, date: r.last_dispense, status, source: 'Pharmacy reports', rxRoot: r.rx_root,
      details: [leftOnRx(r), sinceWords, r.cutoff ? cutoffWords(r.cutoff, todayIso) : '', r.physician]
        .filter(Boolean).join(' · '),
      fields: kept([
        ['Drug', r.drug], ['Directions', r.sig], ['Prescriber', r.physician], ['Written', dayLabel(r.date_written)],
        ['Last dispensed', dayLabel(r.last_dispense)], ['Days since dispensed', since === null ? '' : String(since)],
        ['Left on Rx', qty(r.qty_remaining) === null ? '—' : r.qty_remaining], ['Quantity written', r.qty_written],
        ['Dispensed to date', r.qty_dispensed_to_date], ['Refill cutoff', r.cutoff ? dayLabel(r.cutoff) : 'None written'],
        ['Reports seen', r.reports_seen], ['Other labels', r.labels.filter((l) => l !== r.drug).join(', ')],
        ['Pharmacy', view.pharmacy],
      ]),
    }
  })
  return rows.sort((a, b) => RX_ORDER.indexOf(a.status) - RX_ORDER.indexOf(b.status) || a.record.localeCompare(b.record))
}

export function pharmacyView(state: SourceState<MedsView>, client: string, todayIso: string, showPast: boolean): RefillView {
  const base: RefillView = {
    id: 'pharmacy', label: 'Pharmacy', source: 'Pharmacy reports (House Supplies)', state: 'loading', rows: [], statuses: [],
    kpis: [], why: '', note: NO_DAYS_SUPPLY, asOf: '',
    empty: 'No prescription in the pharmacy\'s reports is matched to this client. House Supplies › Medications is ' +
      'where a PatID is matched to a client.',
  }
  const view = state.data
  if (!view) {
    if (state.status !== 'failed') return base
    return state.error === NOT_OPEN ? { ...base, state: 'failed', shut: true, note: '' }
      : { ...base, state: 'failed', why: refusalWords(state.error) }
  }
  const rows = pharmacyRows(view, client, todayIso, showPast)
  const current = clientRx(view, client).filter((r) => r.current)
  const count = (words: string[]) => current.filter((r) => words.includes(rxStatus(r, view))).length
  const ahead = current.map((r) => r.cutoff).filter((c) => c && c >= todayIso).sort()
  return {
    ...base,
    state: 'ready',
    why: state.status === 'failed'
      ? `The last read failed: ${refusalWords(state.error)} What is shown is from the read before.` : '',
    rows, statuses: statusesOf(rows),
    kpis: [
      { label: 'Current prescriptions', value: String(current.length) },
      { label: 'Low or none left', value: String(count(['Low', 'None left'])) },
      { label: 'Ending this report', value: String(count(['Ending'])) },
      { label: 'Next refill cutoff', value: ahead[0] ? dayLabel(ahead[0]) : '—' },
    ],
    asOf: view.latest ? `Latest pharmacy report: ${span(view.latest.start, view.latest.end)}` : 'No pharmacy report is on file.',
  }
}

const FORM_LABELS: Record<FormTabId, { label: string; source: string; empty: string }> = {
  reports: { label: 'Missing reports', source: 'Missing Medications form',
             empty: 'No Missing Medications report names this client.' },
  low_refills: { label: 'Low refills', source: 'Low Refills worklist',
                 empty: 'The Low Refills worklist has no row for this client.' },
  control: { label: 'Medication control', source: 'Medication Control',
             empty: 'Medication Control lists no medication for this client.' },
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const figure = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v))

function formFields(tab: FormTabId, r: FormRow): Field[] {
  if (tab === 'reports') {
    return kept([
      ['Reported', momentLabel(text(r.reported_at))], ['Reported by', r.reporter], ['Medication', r.medications],
      ['Issue', r.issue], ['Expected to run out', r.runs_out ? dayLabel(text(r.runs_out)) : r.runs_out_text],
      ['Note', r.note], ['Office note', r.office_note], ['House', r.house], ['Doctor', r.dr],
      ['Over the counter', r.otc], ['Notes', r.notes], ['Status', r.status], ['Form', r.source],
    ])
  }
  if (tab === 'low_refills') {
    return kept([
      ['Medication', r.record], ['Refills', r.refills], ['OTC', r.otc], ['Doctor', r.dr], ['Doctor phone', r.dr_phone],
      ['House', r.house], ['Manager', r.manager], ['Doctor contacted', r.contact_dr],
      ['Pharmacy received', r.pharmacy_received], ['Important medication', r.important === true ? 'Yes' : ''],
      ['Notes', r.notes], ['Status', r.status],
    ])
  }
  return kept([
    ['Medication', r.record], ['Physician', r.physician], ['Physician no.', r.physician_no],
    ['Quantity written', r.qty_written], ['Quantity dispensed', r.qty_dispensed], ['Quantity remaining', r.qty_remaining],
    ['Days supply', r.days_supply], ['Buffer days', r.buffer_days], ['Refill status', r.refill_status],
    ['Next refill due', r.next_refill_due ? dayLabel(text(r.next_refill_due)) : ''], ['Notes / action needed', r.notes],
  ])
}

function formKpis(tab: FormTabId, k: Record<string, number | string>): Kpi[] {
  if (tab === 'reports') {
    return [
      { label: 'Reports', value: figure(k.reports) }, { label: 'Open', value: figure(k.open) },
      { label: 'Next expected run-out', value: k.next_run_out ? dayLabel(text(k.next_run_out)) : '—' },
      { label: 'Last report', value: k.last_reported ? dayLabel(text(k.last_reported)) : '—' },
    ]
  }
  if (tab === 'low_refills') return [{ label: 'Rows', value: figure(k.rows) }, { label: 'Outstanding', value: figure(k.outstanding) }]
  return [
    { label: 'Medications listed', value: figure(k.rows) }, { label: 'With a due date', value: figure(k.with_due_date) },
    { label: 'Due now', value: figure(k.due) },
  ]
}

export function formView(state: SourceState<RefillsAnswer>, tab: FormTabId): RefillView {
  const words = FORM_LABELS[tab]
  const base: RefillView = {
    id: tab, label: words.label, source: words.source, state: 'loading', rows: [], statuses: [], kpis: [], why: '',
    note: '', asOf: '', empty: words.empty,
  }
  const answer = state.data
  const got = answer?.tabs?.[tab]
  if (!answer) return state.status === 'failed' ? { ...base, state: 'failed', why: refusalWords(state.error) } : base
  if (!got) return { ...base, state: 'failed', why: `The answer carried no ${words.label.toLowerCase()} tab.` }
  const rows: RefillRow[] = (got.rows ?? []).map((r) => ({
    id: String(r.id), record: text(r.record), date: text(r.date), details: text(r.details), status: text(r.status),
    source: text(r.source), fields: formFields(tab, r), rxRoot: '',
  }))
  const refreshFailed = state.status === 'failed' ? `The last read failed: ${refusalWords(state.error)} What is shown is from the read before.` : ''
  const why = [got.why ? `${got.why[0].toUpperCase()}${got.why.slice(1)}` : '', refreshFailed].filter(Boolean).join(' ')
  const asOf = got.as_of ? (tab === 'reports' ? `Newest report on the form: ${dayLabel(got.as_of)}` : `As of ${dayLabel(got.as_of)}`) : ''
  return {
    ...base, state: got.why && !rows.length ? 'failed' : 'ready', rows, statuses: statusesOf(rows),
    kpis: got.why && !rows.length ? [] : formKpis(tab, got.kpis ?? {}), why, note: got.note ?? '', asOf,
  }
}

export type RefillsModel = { views: RefillView[] }

export function refillsModel(input: {
  client: string; todayIso: string; showPast: boolean
  forms: SourceState<RefillsAnswer>; pharmacy: SourceState<MedsView>
}): RefillsModel {
  return {
    views: [
      pharmacyView(input.pharmacy, input.client, input.todayIso, input.showPast),
      formView(input.forms, 'reports'),
      formView(input.forms, 'low_refills'),
      formView(input.forms, 'control'),
    ],
  }
}

/** The rows a search and a status keep: the search reads every drawn word and every panel field. */
export function filterRefillRows(rows: RefillRow[], query: string, status: string): RefillRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((r) => {
    if (status && r.status !== status) return false
    if (!needle) return true
    const hay = [r.record, r.details, r.status, r.source, dayLabel(r.date), ...r.fields.map((f) => f.value)].join(' ').toLowerCase()
    return hay.includes(needle)
  })
}

/* ---------- the reads, held per client ---------- */

/** An answer this old is read again when the tab opens; a younger one is drawn as it is. */
const FRESH_MS = 60_000
const held = new Map<string, { at: number; data: unknown }>()
const inflight = new Map<string, Promise<unknown>>()
// bumped at a memory boundary (another account, a visit, a tenant or a world): nothing asked before it is held after it
let heldEpoch = 0

onMemoryBoundary(() => {
  heldEpoch++
  held.clear()
  inflight.clear()
})

/** Forget the answers held for a client, or every answer. */
export function forgetRefillReads(client?: string): void {
  if (!client) { held.clear(); return }
  for (const k of [...held.keys()]) if (k.split('|')[1] === client) held.delete(k)
}

function readOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const asked = heldEpoch
  const p: Promise<T> = load().then((data) => {
    if (asked === heldEpoch) held.set(key, { at: Date.now(), data })
    return data
  }).finally(() => {
    if (inflight.get(key) === p) inflight.delete(key)
  })
  inflight.set(key, p)
  return p
}

const IDLE: SourceState<never> = { status: 'idle', data: null, error: '', refreshing: false }

/** One source for one client: the held answer drawn at once, read again after a minute, the last good kept on a failure. */
export function useRefillSource<T>(key: string | null, load: () => Promise<T>): SourceState<T> & { reload: () => void } {
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load })
  const [tick, setTick] = useState(0)
  const handled = useRef(0)
  const [slot, setSlot] = useState<{ key: string | null; state: SourceState<T> }>({ key: null, state: IDLE })
  const reload = useCallback(() => {
    setSlot((s) => (s.key === key ? { key, state: { ...s.state, refreshing: true } } : s))
    setTick((t) => t + 1)
  }, [key])

  // another account, a visit, a tenant or a world: nothing drawn for the one before, and read again
  useEffect(() => onMemoryBoundary(() => {
    setSlot({ key: null, state: IDLE })
    setTick((t) => t + 1)
  }), [])

  useEffect(() => {
    if (!key) return
    const forced = tick !== handled.current
    handled.current = tick
    const hit = held.get(key)
    if (hit && !forced && Date.now() - hit.at < FRESH_MS) return
    let live = true
    const epoch = heldEpoch
    readOnce(key, () => loadRef.current()).then((data) => {
      if (live && epoch === heldEpoch) setSlot({ key, state: { status: 'ready', data: data as T, error: '', refreshing: false } })
    }).catch((err: unknown) => {
      if (!live || epoch !== heldEpoch) return
      const error = err instanceof Error ? err.message : String(err)
      setSlot((s) => ({ key, state: {
        status: 'failed', error, refreshing: false,
        data: s.key === key ? s.state.data : hit ? (hit.data as T) : null,
      } }))
    })
    return () => { live = false }
  }, [key, tick])

  let state: SourceState<T> = IDLE
  if (key && slot.key === key) state = slot.state
  else if (key) {
    const hit = held.get(key)
    state = hit ? { status: 'ready', data: hit.data as T, error: '', refreshing: false } : { ...IDLE, status: 'loading' }
  }
  return { ...state, reload }
}

/** Both doors for one client, read side by side: one failing never blanks the other. */
export function useClientRefills(client: string) {
  const key = client.trim()
  const forms = useRefillSource<RefillsAnswer>(key ? `forms|${key}` : null, () => readRefillForms(key))
  const pharmacy = useRefillSource<MedsView>(key ? `pharmacy|${key}` : null, () => readPharmacy(key))
  const reloadForms = forms.reload, reloadPharmacy = pharmacy.reload
  const reload = useCallback(() => { reloadForms(); reloadPharmacy() }, [reloadForms, reloadPharmacy])
  return { forms, pharmacy, reload }
}
