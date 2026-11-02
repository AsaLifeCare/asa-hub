// My Profile — the answer of /hub-lanes/my-profile, the certificate ledger's rows, and the pure decisions the…
// The relay decides whose profile this is (the signed-in account's own, or the roster row or client the master's…
import { DUE_TONE_CLASS, dayWords, type DueTone } from '@/pages/features/mywork/myWorkModel'
import { nameFold, type UploadRow } from '@/lib/certUploads'
import { formatPhoneDisplay } from '@/lib/phoneFormat'

export { DUE_TONE_CLASS, dayWords }
export type { DueTone }

export const MY_PROFILE_PATH = '/hub-lanes/my-profile'

/** A client chosen by the master rides the address as `client:<client key>`; a roster id rides bare. */
export const CLIENT_CHOICE = 'client:'

/** `not_applicable`: a part that belongs to staff, on a client's profile — its sentence says so. */
export type SourceState = 'ready' | 'unreadable' | 'not_attributable' | 'not_applicable'
export type Detail = { label: string; value: string }

export type Field = { key: string; label: string; value: string; why: string; note: string }

export type StatusClass = 'current' | 'soon' | 'attention' | 'unknown'

export type RequirementRow = {
  id: string
  req_id: string
  requirement: string
  /** the certification an upload is filed under and the ledger is matched by */
  cert: string
  category: string
  category_why: string
  status: { class: StatusClass; word: string }
  state: string
  due: string
  due_tone: DueTone
  due_why: string
  /** by_label: filed under the requirement's label, never its id (an onboarding form the person holds) */
  upload: { allowed: boolean; why: string; by_label?: boolean }
  /** the roster spelling the master's session files a version under (its chosen person, or its own); '' files as the session */
  file_as?: string
  /** the record keeps an expiry for it, so a date read off the paper can stand in for the due date */
  dated?: boolean
  /** what the record's date is: an expiry, the document's own date (never a due date), or none */
  date_role?: 'expires' | 'issued' | ''
  /** whether the master may confirm a read date into the record, and why not */
  confirm?: { allowed: boolean; why: string }
  details: Detail[]
}

export type PersonKind = 'staff' | 'client'

export type PersonEntry = { key: string; name: string; status: string; kind?: PersonKind }

/** A guardian's own account: its name, the sign-in it uses, its phone, and the client it is guardian of. */
export type GuardianAccount = { name: string; email: string; phone: string; guardian_of: string }

/** Whether the profile is a guardian's own: the card is then the client's, labelled as theirs. */
export function isGuardianView(view: Pick<MyProfileView, 'person'>): boolean {
  return view.person.own && view.person.viewer === 'guardian'
}

/** "Jane’s info" for a guardian, or "Your family member’s info" when no record gave a name. */
export function guardianTitle(view: Pick<MyProfileView, 'person'>): string {
  const first = String(view.person.name ?? '').trim().split(/\s+/)[0] ?? ''
  return first ? `${first}’s info` : 'Your family member’s info'
}

export type MyProfileView = {
  scope: {
    mode: 'own' | 'mass'
    why: string
    person: string
    client?: string
    people?: PersonEntry[]
    /** why no staff member can be chosen */
    people_why?: string
    /** why no client can be chosen */
    clients_why?: string
    /** client records left out of the chooser, and why */
    clients_note?: string
  }
  person: {
    name: string; key: string; key_why: string; roster_id: string; own: boolean; kind?: PersonKind; notes?: string[]
    /** an own client-role profile: who reads it; a guardian's `name` is the client's, or '' when no record was read */
    viewer?: 'client' | 'guardian'
    /** a guardian's own account, from its own accounts row */
    account?: GuardianAccount
  }
  details: { state: SourceState; why: string; fields: Field[]; notes: string[]; as_of: string }
  requirements: {
    state: SourceState
    why: string
    rows: RequirementRow[]
    note: string
    as_of: string
    copy_why: string
    gap: string
    totals: Record<StatusClass, number>
    /** the Ohio day and the due-soon window (days) the statuses were classed by */
    on?: string
    window?: number
  }
  /** carried by a client's profile only: submitted documents are staff things */
  documents?: { state: SourceState; why: string }
  read_at: string
}

export const isClientView = (v: MyProfileView | null): boolean => v?.person.kind === 'client'

/** The chooser's value for an entry: a client's key marked as a client's, a roster id bare. */
export function choiceOf(p: PersonEntry): string {
  return p.kind === 'client' ? `${CLIENT_CHOICE}${p.key}` : p.key
}

/** A chooser line: a client is marked as one in its own words, so the closed select still says so. */
export function choiceLabel(p: PersonEntry): string {
  return `${p.name}${p.kind === 'client' ? ' · Client' : ''}${p.status ? ` · ${p.status}` : ''}`
}

/** The door's address; the person or client is the relay's to honour or refuse. */
export function myProfilePath(person?: string): string {
  const p = String(person ?? '').trim()
  if (p.startsWith(CLIENT_CHOICE)) {
    const c = p.slice(CLIENT_CHOICE.length).trim()
    return c ? `${MY_PROFILE_PATH}?client=${encodeURIComponent(c)}` : MY_PROFILE_PATH
  }
  return p ? `${MY_PROFILE_PATH}?person=${encodeURIComponent(p)}` : MY_PROFILE_PATH
}

// The chosen person kept in the address, after a read: dropped when the door refused it as out of scope or as no…
export function choiceAfter(state: { status: string; reason: string }, chosen: string): string {
  return chosen && state.status === 'refused' && (state.reason === 'scope' || state.reason === 'person') ? '' : chosen
}

/* ---------- colour ---------- */

/** Due soon is amber, Current green, Needs attention red; a word the engine never taught is neutral. */
export const STATUS_PILL: Record<StatusClass, string> = {
  soon: 'bg-tint-amber text-tint-fg-amber',
  current: 'bg-[var(--status-green-soft)] text-[var(--status-green)]',
  attention: 'bg-tint-danger text-tint-fg-danger',
  unknown: 'bg-surface-2 text-text-2',
}

/* ---------- words ---------- */

/** A field's value as it is shown: dates in words, a US phone in its usual shape. */
export function fieldText(f: Field): string {
  if (!f.value) return ''
  if (f.key === 'start_date') return dayWords(f.value) || f.value
  if (isPhoneField(f.key)) return formatPhoneDisplay(f.value)
  return f.value
}

export const isPhoneField = (key: string): boolean => key === 'phone' || key === 'guardian_phone' || key === 'account_phone'

export function phoneHref(raw: string): string {
  const d = String(raw ?? '').replace(/\D+/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return ten.length === 10 ? `tel:+1${ten}` : ''
}

export type SourceLine = { key: string; tone: 'danger' | 'warning' | 'muted'; text: string }

/** What a part could not settle, in words: an unreadable part in danger, an untied or partial one in warning. */
export function partLines(label: string, part: { state: SourceState; why: string; note?: string; copy_why?: string; gap?: string }): SourceLine[] {
  const out: SourceLine[] = []
  if (part.state === 'unreadable') out.push({ key: 'unread', tone: 'danger', text: `${label} could not be read: ${part.why}` })
  else if (part.state === 'not_attributable') out.push({ key: 'untied', tone: 'warning', text: `${label}: ${part.why}` })
  else if (part.state === 'not_applicable') return out
  else {
    if (part.gap) out.push({ key: 'gap', tone: 'warning', text: `${label}: ${part.gap}` })
    if (part.copy_why) out.push({ key: 'copy', tone: 'warning', text: `${label}: ${part.copy_why}` })
    if (part.note) out.push({ key: 'note', tone: 'muted', text: `${label}: ${part.note}` })
  }
  return out
}

/** The empty sentence is earned only by a part that answered whole. */
export function requirementsEmpty(v: MyProfileView): string {
  const r = v.requirements
  // a client's profile: the part is a staff thing, and says so in the relay's words
  if (r.state === 'not_applicable') return sentence(r.why) || REQS_NOT_CLIENT
  if (r.state !== 'ready' || r.gap || r.rows.length) return ''
  return v.person.own ? 'No requirement is on record for you.' : 'No requirement is on record for this person.'
}

/* ---------- the documents ---------- */

// A ledger row as certUploadsList answers it: the filing, then the decoder's reading of the paper and the master's…
export type VersionRow = UploadRow & {
  /** the roster row it was filed for; '' on a row filed before rows carried one */
  roster_id?: string
  file_id?: string
  req_id?: string
  read_state?: string
  read_kind?: string
  issued_on?: string
  expires_on?: string
  read_how?: string
  read_confidence?: number | null
  read_why?: string
  read_at?: string
  read_v?: string
  confirmed_on?: string
  confirmed_by?: string
  confirmed_at?: string
}

export type UploadsState = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  rows: VersionRow[]
  scope: 'all' | 'own' | ''
  /** the roster name the ledger's door settled an own answer by (certUploadsList `self`) */
  self: string
  error: string
  /** the door answered that it cannot settle the caller's own record (an own-scope refusal), rather than failing */
  refused: boolean
}

export const UPLOADS_IDLE: UploadsState = { status: 'idle', rows: [], scope: '', self: '', error: '', refused: false }

// `uploadWhy`: why a new version is not offered on this profile, from the ledger door's own answer ('' = the relay…
export type Docs = { rows: VersionRow[]; landed: boolean; note: string; tone: 'danger' | 'warning' | 'muted' | ''; uploadWhy: string; na?: string }

/** The relay's own sentences for a client's profile, held here only for an answer that carried none. */
export const REQS_NOT_CLIENT = 'Requirements apply to staff, not to clients.'
export const DOCS_NOT_CLIENT = 'Submitted documents apply to staff, not to clients.'

export const OTHERS_PRIVATE = 'Another person’s submitted documents are private to them — this answer carried only your own.'
export const LEDGER_OTHER_ROW = 'The certificate ledger knows this account by another staff roster row than the one settled ' +
  'as yours, so none of its documents are shown as yours — HR can settle which record is yours.'
export const DOCS_READING = 'Whose record a new version is filed under is still being read.'

/** A roster id compared bare, however it is spelled (ComplianceDocs.gs complianceDocsRosterId_). */
const bareRosterId = (v: unknown) => String(v ?? '').trim().replace(/^people:/, '').trim()

// The profile's documents.
export function docsFor(view: MyProfileView | null, up: UploadsState): Docs {
  const none = (tone: Docs['tone'], note: string, uploadWhy = note): Docs => ({ rows: [], landed: false, tone, note, uploadWhy })
  // a client's profile draws no ledger row at all, whatever the ledger answered
  if (view && isClientView(view)) {
    const na = sentence(view.documents?.why) || DOCS_NOT_CLIENT
    return { rows: [], landed: false, tone: '', note: na, uploadWhy: na, na }
  }
  if (!view || up.status === 'idle' || up.status === 'loading') return none('', '', DOCS_READING)
  if (up.status === 'failed') {
    if (up.refused) {
      if (!view.person.own) return none('warning', OTHERS_PRIVATE, '')
      return none('warning', `Your submitted documents are not shown — ${sentence(up.error || 'the certificate door refused')}`,
        sentence(up.error || 'the certificate door refused'))
    }
    return none('danger', `The submitted documents could not be read: ${up.error || 'no answer'}`,
      `Whose record a new version is filed under could not be read: ${up.error || 'no answer'} — try again in a minute.`)
  }
  const newest = (rows: VersionRow[]) => [...rows].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const key = view.person.key
  if (up.scope === 'own') {
    if (!view.person.own) return none('warning', OTHERS_PRIVATE, '')
    if (!key) return none('warning', sentence(view.person.key_why || 'no staff roster row is settled as yours'))
    // FAIL-CLOSED: rows the door settled under another roster row than the relay's are nobody's here
    if (nameFold(up.self) !== key) return none('warning', LEDGER_OTHER_ROW)
    return { rows: newest(up.rows), landed: true, note: '', tone: '', uploadWhy: '' }
  }
  if (!key) return none('warning', sentence(view.person.key_why || 'no roster name is tied to this profile'), '')
  const rosterId = bareRosterId(view.person.roster_id)
  const ours = (u: VersionRow) => {
    const stamped = bareRosterId(u.roster_id)
    return nameFold(u.person) === key && (!stamped || stamped === rosterId)
  }
  return { rows: newest(up.rows.filter(ours)), landed: true, note: '', tone: '', uploadWhy: '' }
}

/** A row's upload: the relay's verdict, shut where the ledger door's own answer refuses the caller or never came. */
export function uploadFor(row: Pick<RequirementRow, 'upload'>, docs: Docs): { allowed: boolean; why: string } {
  if (!row.upload.allowed || !docs.uploadWhy) return row.upload
  return { allowed: false, why: docs.uploadWhy }
}

const norm = (s: string) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Whether a document was filed for a requirement: by the requirement id it carries, else (an older row) by its label. */
function filedFor(row: Pick<RequirementRow, 'cert' | 'req_id'>, doc: VersionRow): boolean {
  const id = String(doc.req_id ?? '').trim()
  if (id) return !!row.req_id && id === row.req_id
  const names = new Set([norm(row.cert), norm(row.req_id)].filter(Boolean))
  return names.has(norm(doc.cert))
}

/** The current version of a requirement: the newest filed under its id, else the newest filed under its label. */
export function versionFor(row: Pick<RequirementRow, 'cert' | 'req_id'>, docs: VersionRow[]): VersionRow | null {
  const byId = row.req_id ? docs.find((d) => String(d.req_id ?? '').trim() === row.req_id) : undefined
  return byId ?? docs.find((d) => !String(d.req_id ?? '').trim() && filedFor(row, d)) ?? null
}

/** The requirement a document was filed for, if the profile lists it. */
export function rowFor(doc: VersionRow, rows: RequirementRow[]): RequirementRow | null {
  return rows.find((r) => filedFor(r, doc)) ?? null
}

/** A document's type: the category of the requirement it was filed for, else what the ledger is. */
export function docType(doc: VersionRow, rows: RequirementRow[]): string {
  return rowFor(doc, rows)?.category || 'Certificate'
}

/* ---------- a filed version beside the record (D1) ---------- */

const CLASS_WORD: Record<Exclude<StatusClass, 'unknown'>, string> = {
  current: 'Current', soon: 'Due soon', attention: 'Needs attention',
}

const isDay = (s: unknown): s is string => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))

function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// A day's status and tone by the relay's own rule (my_profile.py status_of, my_work.py tone_of): past needs…
export function dayClass(day: string, on: string | undefined, window: number | undefined):
  { cls: Exclude<StatusClass, 'unknown'>; tone: Exclude<DueTone, ''> } | null {
  if (!isDay(day) || !isDay(on) || typeof window !== 'number' || !Number.isFinite(window)) return null
  if (day < on) return { cls: 'attention', tone: 'overdue' }
  if (day <= plusDays(on, Math.max(0, Math.trunc(window)))) return { cls: 'soon', tone: 'soon' }
  return { cls: 'current', tone: 'later' }
}

/** A row as it is drawn: the engine's status and due date, or the filed version's where D1 lets it stand. */
export type Filed = {
  status: { class: StatusClass; word: string }
  due: string
  due_tone: DueTone
  /** the line under the requirement: where the status came from */
  sub: string
  /** what the version's reading says, for the card */
  reads: string
  tone: 'success' | 'warning' | 'muted'
  /** the status and the due date are the document's, not the record's */
  fromDoc: boolean
}

export const READING_DATES = 'Reading the dates on your document…'
export const CONFIRMED_SUB = 'Confirmed · the record updates at the next check'

/** An unread reading in words: the decoder's why, and that the status stays. */
export function unreadWords(why: string | undefined, own = true): string {
  const w = String(why ?? '').trim().replace(/[.\s]+$/, '')
  const lead = /^[A-Z][a-z]/.test(w) ? w[0].toLowerCase() + w.slice(1) : w || 'the reading did not stand'
  const stays = own ? 'Your status stays as it was' : 'The status stays as it was'
  return `We could not read a date from this file: ${lead}. ` +
    (/HR confirms the date/i.test(w) ? `${stays}.` : `${stays}; HR confirms the date from the document.`)
}

// D1 — the row's status and due date beside its newest filed version.
export function filedStatus(row: RequirementRow, version: VersionRow | null, on?: string, window?: number, own = true): Filed {
  const engine: Filed = { status: row.status, due: row.due, due_tone: row.due_tone, sub: '', reads: '', tone: 'muted', fromDoc: false }
  if (!version) return engine
  const whose = own ? 'your' : 'the'
  const filedLine = `A version was filed ${dayWords(version.at) || 'on a day not recorded'} · not yet confirmed`
  const later = (day: string) => !!row.dated && (!isDay(row.due) || day > row.due)
  const confirmed = isDay(version.confirmed_on) ? version.confirmed_on : ''
  if (confirmed) {
    const reads = `Confirmed ${dayWords(confirmed)} into the record.`
    if (!later(confirmed)) return { ...engine, reads }
    const c = dayClass(confirmed, on, window)
    if (!c) return { ...engine, sub: CONFIRMED_SUB, reads }
    return { status: { class: c.cls, word: CLASS_WORD[c.cls] }, due: confirmed, due_tone: c.tone, sub: CONFIRMED_SUB,
      reads, tone: 'success', fromDoc: true }
  }
  const state = String(version.read_state ?? '')
  if (state === 'pending') {
    const reading = own ? READING_DATES : 'Reading the dates on the document…'
    return { ...engine, sub: reading, reads: sentence(version.read_why) || reading }
  }
  if (row.date_role === 'issued') {
    if (state === 'unread') {
      return { ...engine, sub: `A version was filed ${dayWords(version.at) || 'on a day not recorded'} · no date could be read from it`,
        reads: unreadWords(version.read_why, own), tone: 'warning' }
    }
    // a version filed before papers were read
    if (state !== 'read') return engine
    const iss = isDay(version.issued_on) ? version.issued_on : ''
    return { ...engine, sub: filedLine, tone: iss ? 'muted' : 'warning',
      reads: iss ? `Reads: dated ${dayWords(iss)} (read from ${whose} document).` : 'No date of issue was read from this file.' }
  }
  if (!row.dated) {
    const reads = state === 'unread' ? unreadWords(version.read_why, own)
      : state === 'read' ? 'This requirement keeps no date in the record, so no date is taken from the paper.' : ''
    return { ...engine, sub: filedLine, reads, tone: state === 'unread' ? 'warning' : 'muted' }
  }
  if (state === 'unread') {
    return { ...engine, sub: `A version was filed ${dayWords(version.at) || 'on a day not recorded'} · no date could be read from it`,
      reads: unreadWords(version.read_why, own), tone: 'warning' }
  }
  // a version filed before papers were read
  if (state !== 'read') return engine
  const exp = isDay(version.expires_on) ? version.expires_on : ''
  if (!exp) return { ...engine, sub: filedLine, reads: 'No expiry date was read from this file.', tone: 'warning' }
  const reads = `Reads: expires ${dayWords(exp)} (read from ${whose} document).`
  if (!later(exp)) {
    const upload = own ? 'Your upload' : 'The upload'
    return { ...engine, reads: exp === row.due
      ? `${upload} reads ${dayWords(exp)}, the day the record already holds.`
      : `${upload} reads ${dayWords(exp)}, older than the record’s ${dayWords(row.due)}.` }
  }
  const c = dayClass(exp, on, window)
  // FAIL-CLOSED: without the day the part was classed on, the read date is not classed at all
  if (!c) return { ...engine, sub: filedLine, reads }
  return { status: { class: c.cls, word: CLASS_WORD[c.cls] }, due: exp, due_tone: c.tone,
    sub: `From ${whose} document · not yet confirmed`, reads, tone: 'success', fromDoc: true }
}

/** What the upload sheet says once the paper's reading is back. */
export function readResult(row: RequirementRow, got: VersionRow, on?: string, window?: number, own = true): string {
  const f = filedStatus(row, got, on, window, own)
  if (f.fromDoc) {
    return `${f.reads} ${own ? 'Your' : 'The'} status now reads ${f.status.word}, due ${dayWords(f.due)} — not yet confirmed.`
  }
  return f.reads || (own ? 'The document is filed; your status stays as it was.' : 'The document is filed; the status stays as it was.')
}

export function docsEmpty(view: MyProfileView, docs: Docs): string {
  if (docs.na) return docs.na
  if (!docs.landed || docs.rows.length) return ''
  return view.person.own ? 'You have not submitted any documents yet.' : 'This person has not submitted any documents.'
}

export function sentence(text: string | undefined): string {
  const t = String(text ?? '').trim()
  if (!t) return ''
  const s = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(s) ? s : `${s}.`
}
