// CLIENTS · APPOINTMENTS — the door (ClientSourceAppointments.gs) and the shapes its answer is drawn from: the Dr…
// The booked visits come from Dr Appt Archive with Future Apts, the doctors from Dr Master.
import { gasAction } from '@/features/hiring/shared'
import { ohioDateTime } from '@/lib/ohio'
import { clientPackOr } from '../clientReads'
import { unknownActionWords } from '../clientViewer'

export const APPOINTMENTS_ACTION = 'clientSourceAppointments'

/** The relay's pack for the client first (its part is this door's own answer), else the door itself. */
export const readAppointments = (client: string) =>
  clientPackOr(client, 'appointments', () => gasAction<unknown>('clientSourceAppointments', { client }))

/* ---------- small readers ---------- */

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (v == null ? '' : String(v).trim())
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const day = (v: unknown): string => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '')

/* ---------- the answer ---------- */

export const APPT_STATUSES = ['Upcoming', 'Past'] as const
export type ApptStatus = (typeof APPT_STATUSES)[number]

export type ApptVisit = {
  id: string
  client: string
  /** yyyy-MM-dd, or '' when the sheet's date could not be read */
  date: string
  dateWritten: string
  time: string
  time24: string
  drName: string
  drAddress: string
  van: boolean
  vanAnswer: string
  status: ApptStatus
  source: string
  alsoIn: string[]
  submitted: string
  editable: boolean
  witness: string
  /** the Dr Master row this visit names, when only one doctor of the client answers to it */
  doctorId: string
}

export type ApptDoctor = {
  id: string
  drName: string
  specialist: string
  status: string
  address: string
  phone: string
  fax: string
  /** the day drawn as NEXT VISIT: the sheet's own cell, else the next visit booked with this doctor */
  nextDate: string
  nextSource: 'sheet' | 'visits' | ''
  nextWritten: string
  nextBooked: { date: string; time: string; id: string } | null
  lastVisit: string
  lastSeen: string
  standardFreq: string
  notes: string
  activeOrDiscontinued: string
}

export type VisitKpis = { total: number; upcoming: number; past: number; upcomingVan: number; nextDate: string; lastDate: string }
export type DoctorKpis = { total: number; active: number; other: number }

export type SourceTab<R, K> = { rows: R[]; kpis: K | null; statuses: string[]; why: string; asOf: string }

export type Appointments = {
  client: { key: string; name: string }
  visits: SourceTab<ApptVisit, VisitKpis>
  doctors: SourceTab<ApptDoctor, DoctorKpis>
}

function visitOf(v: unknown): ApptVisit {
  const o = rec(v)
  return {
    id: str(o.id),
    client: str(o.client_name),
    date: day(o.date),
    dateWritten: str(o.date_written),
    time: str(o.time),
    time24: str(o.time_24),
    drName: str(o.dr_name),
    drAddress: str(o.dr_address),
    van: o.van === true,
    vanAnswer: str(o.van_answer),
    status: str(o.status) === 'Past' ? 'Past' : 'Upcoming',
    source: str(o.source),
    alsoIn: list(o.also_in).map(str).filter(Boolean),
    submitted: str(o.submitted),
    editable: o.editable === true,
    witness: str(o.witness),
    doctorId: str(o.doctor_id),
  }
}

function doctorOf(v: unknown): ApptDoctor {
  const o = rec(v)
  const booked = rec(o.next_booked)
  const src = str(o.next_visit_source)
  return {
    id: str(o.id),
    drName: str(o.dr_name),
    specialist: str(o.specialist),
    status: str(o.status),
    address: str(o.address),
    phone: str(o.phone),
    fax: str(o.fax),
    nextDate: day(o.date),
    nextSource: src === 'sheet' || src === 'visits' ? src : '',
    nextWritten: str(o.next_visit),
    nextBooked: day(booked.date) ? { date: day(booked.date), time: str(booked.time), id: str(booked.id) } : null,
    lastVisit: str(o.last_visit),
    lastSeen: day(o.last_seen),
    standardFreq: str(o.standard_freq),
    notes: str(o.notes),
    activeOrDiscontinued: str(o.active_or_discontinued),
  }
}

function visitKpisOf(v: unknown): VisitKpis | null {
  const o = rec(v)
  const total = count(o.total)
  if (total === null) return null
  return {
    total, upcoming: count(o.upcoming) ?? 0, past: count(o.past) ?? 0, upcomingVan: count(o.upcoming_van) ?? 0,
    nextDate: day(o.next_date), lastDate: day(o.last_date),
  }
}

function doctorKpisOf(v: unknown): DoctorKpis | null {
  const o = rec(v)
  const total = count(o.total)
  if (total === null) return null
  return { total, active: count(o.active) ?? 0, other: count(o.other) ?? 0 }
}

/** clientSourceAppointments' answer: { client, tabs: { visits, doctors } }, each tab { rows, kpis, statuses, why?, as_of }. */
export function appointmentsOf(raw: unknown): Appointments {
  const o = rec(raw)
  const c = rec(o.client)
  const tabs = rec(o.tabs)
  const v = rec(tabs.visits)
  const d = rec(tabs.doctors)
  return {
    client: { key: str(c.client_key), name: str(c.name) },
    visits: {
      rows: list(v.rows).map(visitOf), kpis: visitKpisOf(v.kpis),
      statuses: list(v.statuses).map(str).filter(Boolean), why: str(v.why), asOf: str(v.as_of),
    },
    doctors: {
      rows: list(d.rows).map(doctorOf), kpis: doctorKpisOf(d.kpis),
      statuses: list(d.statuses).map(str).filter(Boolean), why: str(d.why), asOf: str(d.as_of),
    },
  }
}

/* ---------- the table ---------- */

export type StatusFilter = '' | ApptStatus

const fold = (v: string): string => v.toLowerCase().replace(/\s+/g, ' ').trim()

/** Search over every column the table draws; the status select narrows to Upcoming or Past. */
export function filterVisits(rows: ApptVisit[], query: string, status: StatusFilter): ApptVisit[] {
  const q = fold(query)
  return rows.filter((r) => {
    if (status && r.status !== status) return false
    if (!q) return true
    const hay = fold([r.client, visitDay(r), r.date, r.time, r.drName, r.drAddress].join(' '))
    return q.split(' ').every((w) => hay.includes(w))
  })
}

/** The table's order: the newest day on top, upcoming and past alike, the later hour first within a day; a visit
 * whose day the sheet did not write as a date goes last. */
export function newestFirst(rows: ApptVisit[]): ApptVisit[] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return !a.date ? 1 : !b.date ? -1 : b.date.localeCompare(a.date)
    return b.time24.localeCompare(a.time24)
  })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-30" → "Sep 30, 2026", the digits as the sheet wrote them; '' for no day. */
export function dayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : ''
}

/** The DATE cell: the day read from the sheet, else what the sheet wrote. */
export const visitDay = (v: Pick<ApptVisit, 'date' | 'dateWritten'>): string => dayLabel(v.date) || v.dateWritten

/** The form's submission stamp on Ohio's clock, or as written when it is not an instant. */
export function submittedLabel(v: string): string {
  if (!v) return ''
  return /^\d{4}-\d{2}-\d{2}T/.test(v) ? ohioDateTime(v) || v : v
}

/** The card's line under the title: the counts, the next and the last visit. Nothing when the figures are unknown. */
export function visitsLine(kpis: VisitKpis | null): string {
  if (!kpis) return ''
  const parts = [`${kpis.upcoming} upcoming`, `${kpis.past} past`]
  if (kpis.nextDate) parts.push(`next ${dayLabel(kpis.nextDate)}`)
  if (kpis.upcomingVan) parts.push(`${kpis.upcomingVan} upcoming with the wheelchair van`)
  return parts.join(' · ')
}

/* ---------- the doctors ---------- */

/** The client's doctors for a visit's panel: the one this visit names first, then as the door ordered them. */
export function doctorsFor(visit: Pick<ApptVisit, 'doctorId'> | null, doctors: ApptDoctor[]): ApptDoctor[] {
  if (!visit?.doctorId) return doctors
  const mine = doctors.filter((d) => d.id === visit.doctorId)
  return [...mine, ...doctors.filter((d) => d.id !== visit.doctorId)]
}

/** NEXT VISIT: the day, and where it came from when it is not the sheet's own cell. */
export function doctorNext(d: ApptDoctor): { label: string; hint: string } {
  if (d.nextSource === 'visits' && d.nextBooked) {
    return { label: dayLabel(d.nextBooked.date), hint: d.nextBooked.time ? `booked · ${d.nextBooked.time}` : 'booked' }
  }
  if (d.nextDate) return { label: dayLabel(d.nextDate), hint: '' }
  return { label: d.nextWritten, hint: '' }
}

export type Tint = 'blue' | 'slate' | 'mint' | 'amber'

export function statusTint(status: string): Tint {
  if (status === 'Upcoming') return 'blue'
  if (/^active$/i.test(status)) return 'mint'
  if (/discontinued|inactive/i.test(status)) return 'amber'
  return 'slate'
}

/* ---------- the panel ---------- */

/** A visit whole, the pencil's form on it, the doctors alone, or the form that books a visit or adds a doctor. */
export type ApptPanel = { kind: 'visit' | 'edit'; id: string } | { kind: 'doctors' | 'new-visit' | 'new-doctor' }

const SEP = '~'
const WHOLE = ['doctors', 'new-visit', 'new-doctor'] as const

export function apptPanelParam(ask: ApptPanel | null): string {
  if (!ask) return ''
  return 'id' in ask ? [ask.kind, ask.id].join(SEP) : ask.kind
}

export function apptPanelOf(v: string | null | undefined): ApptPanel | null {
  const [kind, ...rest] = str(v).split(SEP)
  const id = rest.join(SEP)
  const whole = WHOLE.find((k) => k === kind)
  if (whole) return { kind: whole }
  if ((kind === 'visit' || kind === 'edit') && id) return { kind, id }
  return null
}

/* ---------- a visit booked, a doctor added ---------- */

/** New Appointment's fields, keyed as clientProfileApptAdd names them. */
export type NewVisit = { date: string; time: string; dr_name: string; dr_address: string; van: 'Yes' | 'No' }

export const NEW_VISIT: NewVisit = { date: '', time: '', dr_name: '', dr_address: '', van: 'No' }

/** What a visit still needs before it is booked: the doctor and the day. */
export function newVisitMissing(v: NewVisit): string[] {
  return [!v.dr_name.trim() && 'Doctor', !day(v.date) && 'Date'].filter((x): x is string => !!x)
}

/** New Doctor's fields, keyed as clientProfileDoctorAdd names them. */
export type NewDoctor = { dr_name: string; specialist: string; phone: string; fax: string; address: string; standard_freq: string; notes: string }

export const NEW_DOCTOR: NewDoctor = { dr_name: '', specialist: '', phone: '', fax: '', address: '', standard_freq: '', notes: '' }

export const NEW_DOCTOR_FIELDS: { key: keyof NewDoctor; label: string; kind?: 'tel' | 'textarea'; hint?: string }[] = [
  { key: 'dr_name', label: 'Dr name' },
  { key: 'specialist', label: 'Specialty', hint: 'Dental, Primary care, Neurology…' },
  { key: 'phone', label: 'Phone', kind: 'tel' },
  { key: 'fax', label: 'Fax', kind: 'tel' },
  { key: 'address', label: 'Address' },
  { key: 'standard_freq', label: 'How often', hint: 'Every 6 months, Yearly…' },
  { key: 'notes', label: 'Notes', kind: 'textarea' },
]

/** The fields a form files: each trimmed, the empty ones left out. */
export function filledFields<T extends Record<string, string>>(v: T): Partial<T> {
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()]).filter(([, x]) => x)) as Partial<T>
}

/* ---------- the pencil ---------- */

/** The appointment pencil's fields, keyed as clientProfileApptSave names them. */
export const APPT_FIELDS: { key: 'date' | 'time' | 'dr_name' | 'dr_address' | 'van'; label: string; kind?: 'date' | 'van' }[] = [
  { key: 'date', label: 'Date', kind: 'date' },
  { key: 'time', label: 'Time' },
  { key: 'dr_name', label: 'Dr name' },
  { key: 'dr_address', label: 'Dr address' },
  { key: 'van', label: 'Wheelchair van required?', kind: 'van' },
]

/** What the pencil writes: only the fields that changed, trimmed. */
export function apptChanges(before: Record<string, string>, after: Record<string, string>): Record<string, string> {
  return Object.fromEntries(APPT_FIELDS.filter((f) => (after[f.key] ?? '').trim() !== (before[f.key] ?? '').trim())
    .map((f) => [f.key, (after[f.key] ?? '').trim()]))
}

/* ---------- a refusal, in words ---------- */

export const NOT_PUBLISHED = 'The server did not recognise this read: Appointments answers once the platform release that carries it is live.'

/** "Unknown action." is a door shut to this account, or to the master a deployment without it. */
export function apptRefusal(error: string): string {
  return unknownActionWords(error, NOT_PUBLISHED) ?? (error || 'The read did not answer.')
}

export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`
