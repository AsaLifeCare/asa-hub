// THE WORDS AND COLOURS OF THE HOTLINE SCREEN — said once, here, so the list, the panel and the hero can never name…
// COLOUR IS SPENT TWO WAYS AND ONLY TWO.
import type { ExtendedTintName } from '@/lib/tints'
import type {
  DailyNote, HotlineRead, HotlineState, LaneKey, LineKey, NoteKind, NoteShift, NotesSourceKey, SourceKey,
} from './hotlineApi'

export type LaneId = 'calloffs' | 'queue' | 'notes' | 'incidents'
export type Modality = LaneId | 'screening'

export const LANE_IDS: LaneId[] = ['calloffs', 'queue', 'notes', 'incidents']
export const MODALITIES: Modality[] = ['calloffs', 'queue', 'notes', 'incidents', 'screening']

// The three lanes whose books the relay's lanes door reads for this screen.
export type SheetLaneId = Exclude<LaneId, 'notes'>
export const SHEET_LANES: SheetLaneId[] = ['calloffs', 'queue', 'incidents']

/** What the lanes door calls each of those books. */
export const LANE_DOOR_KEY: Record<SheetLaneId, LaneKey> = {
  calloffs: 'callOffs',
  queue: 'supportQueue',
  incidents: 'uiIncidents',
}

export const MODALITY: Record<Modality, { label: string; one: string; tint: ExtendedTintName }> = {
  calloffs: { label: 'Call Offs', one: 'Call Off', tint: 'pink' },
  queue: { label: 'Support Queue', one: 'Support Queue', tint: 'blue' },
  notes: { label: 'Daily Notes', one: 'Daily Note', tint: 'mint' },
  incidents: { label: 'Incidents', one: 'Incident', tint: 'amber' },
  screening: { label: 'Screening', one: 'Screening', tint: 'lavender' },
}

// WHAT EACH MODALITY SETS IN MOTION — static and factual.
export const TRIGGERED: Record<Modality, string> = {
  calloffs: 'Smart Comms situation hotline_call_off tells the team (SMS + email).',
  queue: 'Nothing is sent — the row is the record.',
  notes: 'Nothing is sent — the row is the record.',
  incidents: 'Nothing is sent — the row is the record.',
  screening: 'Once the screen is analysed, the hiring lane emails its report to the hiring team — once per candidate, and only while the candidate is at the phone-screen stage.',
}

// A request the log names whose row this screen has not read: its type is what decides whether the team was paged…
export const TRIGGERED_REQUEST_UNREAD =
  'A request whose type is not on a row this screen read — whether it was a call off, which texts and emails the team, cannot be said here.'

export const LINE: Record<LineKey, { number: string; short: string; label: string; heroTint: ExtendedTintName }> = {
  hotline: { number: '+13309195558', short: '·5558', label: 'Employee Support Hotline', heroTint: 'mint' },
  screening: { number: '+13307544040', short: '·4040', label: 'Phone Screening', heroTint: 'lavender' },
}

/** The hotline read of a call, as a pill and as the sentence the panel says. */
export const STATE: Record<HotlineState, { label: string; tint: ExtendedTintName }> = {
  filed: { label: 'Filed', tint: 'mint' },
  legacy: { label: 'Filed earlier', tint: 'slate' },
  waiting: { label: 'Waiting', tint: 'amber' },
  held: { label: 'Held', tint: 'slate' },
  blocked: { label: 'Blocked', tint: 'danger' },
  no_words: { label: 'No words', tint: 'slate' },
  unlogged: { label: 'Not known', tint: 'slate' },
  filing: { label: 'Filing', tint: 'amber' },
}

// THE PILL FOR ANY STATE THE RELAY SENDS — a state this build does not know yet is printed as the relay named it…
export function stateWords(st: string): { label: string; tint: ExtendedTintName } {
  const known = (STATE as Partial<Record<string, { label: string; tint: ExtendedTintName }>>)[st]
  if (known) return known
  const words = String(st ?? '').replace(/_/g, ' ').trim()
  return { label: words ? words[0].toUpperCase() + words.slice(1) : 'Not known', tint: 'slate' }
}

/** The states the relay's stage may speak over: the books have not ruled yet. */
const STAGE_SPEAKS_OVER = new Set<string>(['waiting', 'unlogged', 'filing'])

// THE STATE A CALL IS SHOWN IN.
export function shownState(hot: Pick<HotlineRead, 'state' | 'stage'> | null | undefined): HotlineState | '' {
  if (!hot) return ''
  return hot.stage && STAGE_SPEAKS_OVER.has(hot.state) ? hot.stage : hot.state
}

/** How the hero names a source that could not be read. */
export const SOURCE_NAME: Record<SourceKey, string> = {
  transcripts: 'the transcript inbox (New Transcripts)',
  calls_house: 'the webhook calls house (ASA Data — Calls)',
  recaps: 'the summaries house (ASA Data — Recaps)',
  hotline_log: 'the hotline processing log',
  roster: 'the roster',
}

/** How the hero names a source behind the Daily Notes door that could not be read. */
export const NOTES_SOURCE_NAME: Record<NotesSourceKey, string> = {
  notes: 'the Staff Daily Notes book',
  clients: 'the clients list',
  schedule: 'the schedule',
}

/** What a kind in the processing log is called on this screen. */
export const KIND_LABEL: Record<string, string> = {
  Request: 'a Support Queue request',
  DailyNote: 'a Daily Note',
  Incident: 'an Incident',
}

// The lane a logged kind lands in — a Request lands in the queue, and in Call Offs as well when its type is a call…
export const KIND_LANES: Record<string, LaneId[]> = {
  Request: ['queue', 'calloffs'],
  DailyNote: ['notes'],
  Incident: ['incidents'],
}

// ------------------------------------------------------------------ Daily Notes…

// A note is a day's care written down, or it is something else a DSP called in — an incident, an admin task — that…
export const NOTE_KIND: Record<NoteKind, string> = {
  daily: 'Daily',
  not_daily: 'Not daily',
}

export const CLIENT_MATCH: Record<'exact' | 'similar' | 'none', string> = {
  exact: 'Matched exactly',
  similar: 'A similar name — the only close match in the clients list',
  none: 'Not in the clients list',
}

// HOW MUCH OF THE SCHEDULE THE NOTES DOOR READ — what "no scheduled shift" may be said on.
export type ScheduleRead = 'read' | 'partial' | 'unread' | 'unknown'

export function scheduleReadOf(h: { ok: boolean; rows: number | null } | null | undefined): ScheduleRead {
  if (!h) return 'unknown'
  if (h.ok) return 'read'
  return typeof h.rows === 'number' ? 'partial' : 'unread'
}

/** Why a note sits on the hour of its call, said by how much of the schedule was read. */
const CALL_TIME_WHY: Record<ScheduleRead, string> = {
  read: 'no scheduled shift was found',
  partial: 'part of the schedule could not be read, so a scheduled shift may be missing',
  unread: 'the schedule could not be read',
  unknown: 'the notes door did not say whether the schedule was read',
}

// The shift as a pill: its label, and how it was placed when that is not "the schedule, at the hour of the call".
export function shiftPill(s: NoteShift): string {
  if (!s.label) return ''
  if (s.via === 'call_time') return `${s.label} · by call time`
  if (s.covers_call === false) return `${s.label} · not at the call time`
  return s.label
}

/** A shift whose end is not after its start ran past midnight. */
const overnight = (s: NoteShift) => !!s.start && !!s.end && s.end <= s.start

// "Morning · 07:00–15:00 · ABD1547 — from the schedule" — or '' when no shift is known.
export function shiftText(n: Pick<DailyNote, 'shift' | 'reporting_date'>, schedule: ScheduleRead): string {
  const s = n.shift
  if (s.via === 'none' || !s.label) return ''
  if (s.via === 'call_time') return `${s.label} — from the hour of the call; ${CALL_TIME_WHY[schedule]}`
  const parts = [s.label]
  if (s.start && s.end) parts.push(`${s.start}–${s.end}`)
  if (s.date && (s.date !== n.reporting_date || overnight(s))) parts.push(`began ${s.date}`)
  if (s.house) parts.push(s.at_client_house === false ? `${s.house}, not the client’s house` : s.house)
  const staff = s.staff_match === 'similar' ? ', the DSP matched to the schedule by a similar name' : ''
  const hour = s.covers_call === false ? '; a shift that day, not at the call time' : ''
  return `${parts.join(' · ')} — from the schedule${staff}${hour}`
}

// ------------------------------------------------------------------ the functional pills…

export function urgencyTint(u: string): ExtendedTintName {
  const v = u.trim().toLowerCase()
  if (v === 'high' || v === 'urgent') return 'danger'
  if (v === 'medium' || v === 'mid') return 'amber'
  return 'slate'
}

export function queueStatusTint(st: string): ExtendedTintName {
  const v = st.trim().toLowerCase()
  if (/resolved|done|closed|complete/.test(v)) return 'mint'
  if (/pending|progress|waiting|hold/.test(v)) return 'amber'
  return 'slate'
}

/** A no-show leaves a house uncovered — the one call-off type that is a state. */
export function callOffTypeTint(t: string): ExtendedTintName {
  return /no\s*show/i.test(t) ? 'danger' : 'slate'
}

export function screenResultTint(r: string): ExtendedTintName {
  const v = r.trim().toLowerCase()
  if (!v) return 'slate'
  if (/advance|pass|qualified|hire/.test(v) && !/not|dis/.test(v)) return 'mint'
  if (/declin|reject|not qualif|disqualif|fail/.test(v)) return 'danger'
  if (/incomplete|no.?show|pending|retry/.test(v)) return 'amber'
  return 'slate'
}

// ------------------------------------------------------------------ the fields of each record, in the order a…

export type FieldSpec = {
  key: string
  label: string
  /** a cell that holds a day or an instant — printed on Ohio's clock */
  date?: boolean
  /** prose — printed as a paragraph across the whole width */
  long?: boolean
  /** a phone number */
  phone?: boolean
  /** a link */
  url?: boolean
}

export const LANE_FIELDS: Record<LaneId | 'screening', FieldSpec[]> = {
  calloffs: [
    { key: 'employee_name', label: 'Employee' },
    { key: 'date', label: 'Shift date', date: true },
    { key: 'type', label: 'Type' },
    { key: 'how_late', label: 'How late' },
    { key: 'your_name', label: 'Filed by' },
    { key: 'timestamp', label: 'Filed at', date: true },
    { key: 'notes', label: 'Notes', long: true },
  ],
  queue: [
    { key: 'requestor', label: 'Requestor' },
    { key: 'requestor_phone', label: 'Requestor phone', phone: true },
    { key: 'date_received', label: 'Date received', date: true },
    { key: 'type_of_request', label: 'Type of request' },
    { key: 'urgency', label: 'Urgency' },
    { key: 'status', label: 'Status' },
    { key: 'processed', label: 'Processed' },
    { key: 'description_of_request', label: 'Description', long: true },
    { key: 'notes', label: 'Notes', long: true },
  ],
  // the flattened note (join.ts noteRow).
  notes: [
    { key: 'dsp_name', label: 'DSP' },
    { key: 'client', label: 'Client' },
    { key: 'client_written', label: 'Client, as written' },
    { key: 'client_match_label', label: 'Client match' },
    { key: 'category_label', label: 'Category' },
    { key: 'kind_label', label: 'Kind' },
    { key: 'reporting_date', label: 'Reporting day' },
    { key: 'call_at', label: 'Called at', date: true },
    { key: 'shift_text', label: 'Shift' },
    { key: 'response', label: 'Note', long: true },
  ],
  incidents: [
    { key: 'your_name', label: 'Reported by' },
    { key: 'client_name', label: 'Client' },
    { key: 'incident_category', label: 'Category' },
    { key: 'incident_location', label: 'Location' },
    { key: 'incident_date', label: 'Incident date', date: true },
    { key: 'incident_time', label: 'Incident time' },
    { key: 'incident_reported_date', label: 'Reported date', date: true },
    { key: 'incident_reported_time', label: 'Reported time' },
    { key: 'employees_involved', label: 'Employees involved' },
    { key: 'timestamp', label: 'Filed at', date: true },
    { key: 'summary_of_incident', label: 'Summary', long: true },
    { key: 'immediate_action_taken', label: 'Immediate action taken', long: true },
    { key: 'cause_and_contributing_factors', label: 'Cause and contributing factors', long: true },
    { key: 'prevention_plan', label: 'Prevention plan', long: true },
  ],
  screening: [
    { key: 'final_result', label: 'Final result' },
    { key: 'screen_status', label: 'Screen status' },
    { key: 'qualification', label: 'Qualification' },
    { key: 'screen_score', label: 'Score' },
    { key: 'screen_date', label: 'Screened', date: true },
    { key: 'screened_by', label: 'Screened by' },
    { key: 'phone_screen_report_url', label: 'Report', url: true },
    { key: 'notes', label: 'Notes', long: true },
  ],
}

// The one field each lane's filter chips are cut from — so a type the model coins tomorrow is a chip tomorrow, with…
export const CHIP_FIELD: Record<LaneId, string> = {
  calloffs: 'type',
  queue: 'type_of_request',
  notes: 'kind_label',
  incidents: 'incident_category',
}
