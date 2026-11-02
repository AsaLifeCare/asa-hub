// THE REQUESTS SCREEN'S OWN ARITHMETIC — and only the part that is the screen's to do.
// NOTHING HERE DECIDES ANYTHING.
import { ohioDateTime, ohioTime } from '@/lib/ohio'
import {
  STATUS_LABEL as TIME_OFF_STATUS_LABEL, STATUS_TINT as TIME_OFF_STATUS_TINT, legLine as timeOffLegLine,
} from '@/pages/features/timeoff/timeOffModel'

/** shift_requests.deciders_one() / deciders_all(): who decides for every house, in words — the badges that decide
 *  every house and the ones that follow one. A team lead decides as a house manager, never as a director. */
export const ABOVE_ONE = 'a director, supervisor or administrator'
export const ABOVE_ALL = 'directors, supervisors and administrators'

// One row of the cumulative list — every request the platform made or received, of any kind, from any house.
export type RequestRow = {
  id: string
  /** open_shift · call_off · swap · ist_approval */
  kind: string
  at: string
  house: string
  location: string
  col_iso: string
  open_row?: string
  // The shift's opaque handle.
  ref?: string
  shift: string
  person: string
  state: string
  why: string
  via: string
  decided_by: string
  decided_at: string
  week_hours?: number
  called_off_by?: string
  reason?: string
  shift_state?: string
  window?: ShiftWindow
  from_staff?: string
  to_staff?: string
  house_manager?: string
  staff_state?: string
  manager_state?: string
  director_state?: string
  staff_via?: string
  manager_via?: string
  director_via?: string
  staff_at?: string
  manager_at?: string
  director_at?: string
  director_by?: string
  directors?: string[]
  may_approve_director?: boolean
  for_kind?: string
  /** Who would train a first shift there and whether they are free, per the relay. */
  training?: Training
  /** The relay's answer: this reader may approve this row now. */
  may_approve?: boolean
  /** On an approved training: who the approval named to train. */
  trainer?: string
  /* kind 'swap': described per reader by server/shift_handoff.describe */
  approval?: HandoffView['approval']
  asks?: HandoffView['asks']
  first_shift?: HandoffView['first_shift']
  may_accept?: boolean
  may_withdraw?: boolean
  offered_by?: string
  staff_by?: string
  manager_by?: string
  closed_by?: string
  shift_start?: string
  /** A swap's or training's own shift facts; pooled shifts use `Feed.shifts[ref]`. */
  essentials?: Essentials
  // THE MARK.
  rehearsal?: boolean
  mine: boolean
  visible: boolean
}

/** A shift row's lead facts, none private (server/shift_requests.essentials). */
export type Essentials = {
  house: string
  house_name: string
  code: string
  address: string
  col_iso: string
  shift_code: string
  shift_start: string
  shift_end: string
  hours: number | null
  manager: string
  managers: string[]
  managers_readable: boolean
  /** Who decides with no house manager on file, in the relay's words (generated from the badges). */
  deciders?: string
}

/** A call-off's URGENT OPEN SHIFT outcome; known only for Builder call-offs. */
export type UrgentState = {
  known: boolean
  /** sent · held (test mode or dial) · deferred (quiet hours) · not_sent · owed · gave_up */
  state?: string
  at?: string
  sent?: number
  held?: number
  why: string
}

/** How a call-off arrived; sent only to readers of every row of that house. */
export type CalledOff = {
  by: string
  at: string
  /** builder · form · tracker · hotline, or the book's own word */
  road: string
  road_words: string
  filed_by: string
  reason: string
  reason_why: string
  readable: boolean
  why: string
}

/** One pooled shift's card, cut per reader (server/shift_requests.shift_card). */
export type ShiftCard = Essentials & {
  ref: string
  location: string
  kind: string
  state: string
  window: ShiftWindow
  /** the platform path to its blood-red square in House Calendars */
  link: string
  applicant_count: number
  filled: boolean
  urgent?: UrgentState
  called_off?: CalledOff
  decision?: { person: string; how: string; by: string; at: string }
}

/** One application as the panel weighs it for the house's own managers. */
export type WeighedApplicant = Applicant & {
  live: boolean
  ist: { ok: boolean; state: string; why: string }
  regular: boolean
  /** '' when the shift crosses nothing else they hold now */
  overlap: string
}

/** Read when a row is opened (server/shift_requests.shift_detail). */
export type ShiftDetail = ShiftCard & {
  eligible: { may_apply_now: number; free: number; of: number; why: string; names?: string[] }
  applicants: WeighedApplicant[]
  manager_availability?: { name: string; free: boolean; why: string }[]
  mine: { may: boolean; code: string; why: string } | null
  at: string
}

/** A shift a stretch of time off touches (server/shift_requests.displaced_by). */
export type Displaced = {
  house: string
  location: string
  col_iso: string
  value: string
  /** still on the calendar under their name — the time off has not reached it */
  working: boolean
  /** true every open shift that day was given · false some still open · null none put up */
  covered: boolean | null
  why: string
  open_shifts?: { ref: string; value: string; state: string; filled_by: string }[]
}

/** One half of a time-off request's approval, as the Time Off house holds it. */
export type TimeOffLeg = { state: string; by: string; via: string; at: string }

/** One time-off request from the Time Off house, cut per reader (server/shift_requests.time_off). */
export type TimeOffRow = {
  id: string
  kind: 'time_off'
  person: string
  start: string
  end: string
  days: number
  calendar_name: string
  /** when it was asked */
  asked: string
  /** upcoming · past — the dates, for the cuts */
  state: string
  decided_by: string
  decided_why: string
  /** the codes of the request's houses */
  houses: string[]
  displaced: Displaced[]
  mine: boolean
  visible: boolean
  /** the request itself (the Time Off app): pending · scheduled · denied · … */
  ref?: string
  status?: string
  hm?: TimeOffLeg
  dir?: TimeOffLeg
  link?: string
  filed_via?: string
  test_mode?: boolean
  house_labels?: string[]
}

export { TIME_OFF_STATUS_LABEL, TIME_OFF_STATUS_TINT, timeOffLegLine }

/** One transfer text's outcome; a rehearsal row reached nobody. */
export type AskState = { state: string; why: string; at: string; reached: boolean }

/** One transfer as server/shift_handoff.describe gives it; the screen decides nothing. */
export type HandoffView = {
  id: string
  location: string
  house: string
  col_iso: string
  value: string
  from_staff: string
  to_staff: string
  house_manager: string
  /** pending · done · dead */
  state: string
  why: string
  staff_state: string
  staff_via: string
  staff_at: string
  staff_by: string
  manager_state: string
  manager_via: string
  manager_at: string
  manager_by: string
  /** The third consent, its own field: the director blocks until it is 'approved'. */
  director_state?: string
  director_via?: string
  director_at?: string
  director_by?: string
  /** The directors this swap was asked of, from the Time Off house's settings. */
  directors?: string[]
  director?: string
  created_at: string
  closed_at: string
  offered_by: string
  closed_by: string
  shift_start: string
  /** house_manager · above (ABOVE_ONE) */
  approval: { mode: string; names: string[]; why: string }
  /** A first shift there: the house manager's training, which Approve takes on. */
  first_shift: {
    needed?: boolean; state?: string; why?: string
    trainer?: { state?: string; may_approve?: boolean; trains?: string; why?: string }
    request?: string; request_state?: string
  }
  asks: { staff: AskState; manager: AskState; director?: AskState }
  may_accept: boolean
  may_approve: boolean
  /** The relay's answer: this reader gives the DIRECTOR's approval on this swap now. */
  may_approve_director?: boolean
  may_withdraw: boolean
  // THE MARK, from server/shift_handoff.describe: this transfer was played by the staff-answers rehearsal.
  rehearsal?: boolean
  mine: boolean
  /** The answer door's own word: false when that consent was already somebody else's. */
  changed?: boolean
}

/** One Transfer candidate (server/shift_handoff.candidates). */
export type TransferCandidate = {
  name: string
  /** drawn on this house's calendar */
  here: boolean
  houses: string[]
  /** worked this house in the regulars' window */
  regular: boolean
  /** a phone on the staff roster — null when the roster could not be read */
  reachable: boolean | null
  ok: boolean
  /** ok · overlap · cell_taken · no_contact */
  code: string
  why: string
  ist: string
  /** no current IST there: a first shift, the house manager's training */
  needs_training: boolean
  training?: Training
}

export type TransferList = {
  location: string
  house: string
  col_iso: string
  value: string
  giver: string
  shift_start: string
  approval: { readable: boolean; mode: string; names: string[]; why: string }
  /** The directors list the swap will be asked of (the Time Off house's settings). */
  directors?: { readable: boolean; names: string[]; why: string }
  candidates: TransferCandidate[]
  reachable_known: boolean
  reachable_why: string
  ist: { readable: boolean; why: string }
}

/** One of the reader's own upcoming shifts, and whether it may be transferred. */
export type MyShift = {
  location: string
  house: string
  employee: string
  col_iso: string
  value: string
  start: string
  end: string
  may_transfer: boolean
  why: string
  offer: HandoffView | null
}

/** Candidates split into eligible and not, in the relay's order. */
export function splitCandidates(list: TransferCandidate[], q = ''): {
  free: TransferCandidate[]; blocked: TransferCandidate[]
} {
  const want = q.trim().toLowerCase()
  const hit = (c: TransferCandidate) => !want || c.name.toLowerCase().includes(want)
  return {
    free: list.filter((c) => c.ok && hit(c)),
    blocked: list.filter((c) => !c.ok && hit(c)),
  }
}

/** The small words under a face: where they work, and a first shift there. */
export function candidateTags(c: TransferCandidate, house: string): string[] {
  const tags: string[] = []
  if (c.regular) tags.push(`works ${house}`)
  else if (!c.here && c.houses.length) tags.push(`from ${c.houses.join(', ')}`)
  if (c.needs_training) tags.push('first shift here — needs training approval')
  return tags
}

/** A transfer text's outcome in words; '' before the door saw it. */
export function askLine(ask: AskState | undefined, who: string): string {
  if (!ask || !ask.state) return ''
  const whose = who.endsWith('s') ? `${who}'` : `${who}'s`
  if (ask.reached) return `${who} ${who.endsWith('s') && who.startsWith('The ') ? 'were' : 'was'} asked by text`
  if (ask.state === 'opted_out') return `${who} opted out of texts — they answer on the Hub`
  if (ask.state === 'recorded' || ask.state === 'rehearsed' || ask.state === 'redirected') {
    return `${whose} text went only into the rehearsal book (test mode) — it goes when sending is on`
  }
  if (ask.state === 'dial_off') return `sending is off — ${whose} text goes when it is on`
  return `${who} could not be texted yet${ask.why ? ` (${ask.why})` : ''} — it is tried again`
}

/** Who a transfer is still waiting on — each of the three read from its own field. */
export function waitingOn(h: Pick<HandoffView, 'staff_state' | 'manager_state' | 'to_staff'
  | 'approval' | 'house_manager'> & Pick<Partial<HandoffView>, 'director_state' | 'directors'>): string[] {
  const approver = h.approval?.mode === 'above'
    ? ABOVE_ONE
    : (h.approval?.names?.length ? h.approval.names.join(' or ') : h.house_manager || 'the house manager')
  const director = h.directors?.length ? h.directors.join(' or ') : 'the director'
  const out: string[] = []
  if (h.staff_state === 'pending') out.push(`${h.to_staff} to accept`)
  if (h.manager_state === 'pending') out.push(`${approver} to approve`)
  if ((h.director_state ?? 'pending') === 'pending') out.push(`${director} to approve`)
  return out
}

/** Who a transfer is waiting on, said once — the answer the row owes. */
export function waitingLine(h: Pick<HandoffView, 'state' | 'staff_state' | 'manager_state'
  | 'to_staff' | 'approval' | 'house_manager' | 'why'>
  & Pick<Partial<HandoffView>, 'director_state' | 'directors'>): string {
  if (h.state === 'done') return `Done — ${h.to_staff} has the shift`
  if (h.state === 'dead') return `Ended${h.why ? ` — ${h.why}` : ''}`
  const want = waitingOn(h)
  if (!want.length) return `All three agreed — ${h.why || 'it goes through within the minute'}`
  // the row's own sentence, such as a director's approval waiting for a name on the list
  return `Waiting on ${want.join(' and ')}${h.why ? ` — ${h.why}` : ''}`
}

/** Who trains a first shift, and whether they are free (server/shift_requests.training_verdict). */
export type Training = {
  state: string
  may_approve: boolean
  code: string
  trains: string
  managers: string[]
  busy: { name: string; house: string; col_iso: string; value: string; source: string; line: string }[]
  why: string
  unseen?: string[]
}

/** The relay's sentence, capitalised and stopped; `lead` goes in front of it. */
export function trainingLine(t: Training | null | undefined, lead = ''): string {
  const why = String(t?.why ?? '').trim()
  if (!why) return ''
  const s = lead ? `${lead.trim()} ${why}` : why.charAt(0).toUpperCase() + why.slice(1)
  return /[.!?)]$/.test(s) ? s : `${s}.`
}

/** ok · blocked (Approve would be refused) · open (nobody named) · '' (no training) */
export function trainingTone(t: Training | null | undefined): '' | 'ok' | 'blocked' | 'open' {
  if (!t) return ''
  if (t.state === 'not_a_shift') return ''
  if (t.may_approve) return 'ok'
  return t.state === 'above' ? 'open' : 'blocked'
}

/** Why Approve would be refused for the trainer, or ''. */
export function approveBlockedBy(r: { training?: Training | null }): string {
  return trainingTone(r.training) === 'blocked' ? trainingLine(r.training) : ''
}

export type ShiftWindow = {
  kind: string
  opens_at: string
  closes_at: string
  /** open · closed · manager_only */
  state: string
  seconds_left: number
  reserved: boolean
  why: string
}

export type Applicant = {
  id: string
  person: string
  state: string
  why: string
  via: string
  at: string
  week_hours: number
  decided_by: string
  decided_at: string
  /** For the decider: false when the applicant has no IST there. */
  ist_ok?: boolean
  training?: Training
  /** THE MARK, from the relay: this application was played by the staff-answers rehearsal. */
  rehearsal?: boolean
}

export type PoolShift = {
  key: string
  ref: string
  location: string
  house: string
  /** 'ABD1711' — the key the hotline calendar's ** row is filed by. */
  code?: string
  // Whose decision this shift is: the house's ** row, by name.
  manager?: string
  open_row: string
  col_iso: string
  value: string
  kind: string
  window: ShiftWindow
  /** open · closed · manager_only · filled */
  state: string
  shift_start: string
  shift_end: string
  called_off_by: string
  reason: string
  filled_by: string
  filled_how: string
  decided_by: string
  closed_at: string
  /** who is still in the running */
  applicants: Applicant[]
  // AND EVERYBODY WHO EVER WAS — applied, withdrew, was approved, was passed over, and when.
  history?: Applicant[]
  /** How many applied; the names are for the house's managers only. */
  applicant_count?: number
  mine?: boolean
}

export type Offer = {
  key: string
  ref: string
  location: string
  house: string
  open_row: string
  col_iso: string
  shift: string
  kind: string
  window: ShiftWindow
  applicants: number
  ist: { ok: boolean; state: string; why: string }
  needs_training_approval: boolean
  /** A first shift there: whether the trainer is free (informational). */
  training?: Training
}

export type Feed = {
  me: string
  badges: string[]
  whole_company: boolean
  sees_reasons: boolean
  manages: string[]
  rows: RequestRow[]
  total: number
  available: Offer[]
  /** the check of what this reader may take could not run; never drawn as "nothing open" */
  available_why?: string
  call_offs: PoolShift[]
  open_shifts: PoolShift[]
  ist: { readable: boolean; why: string }
  windows: {
    open_shift_minutes: number
    regular_days: number
    call_off_hours: number
    call_off_before_start_minutes: number
    call_off_floor_minutes: number
  }
  panels?: Panels
  /** The reader's upcoming shifts; `my_shifts_why` when unreadable. */
  my_shifts?: MyShift[]
  my_shifts_why?: string
  /** ref → that pooled shift's card */
  shifts?: Record<string, ShiftCard>
  // Time-off requests; `readable: false` with the reason when unreadable.
  time_off?: { readable: boolean; why: string; rows: TimeOffRow[]; directors_readable?: boolean; directors_why?: string }
  /** The rehearsal doors open to this session: the master's own, never while acting as another. */
  rehearsal?: boolean
  at: string
}

export type Panels = {
  readable: boolean
  why: string
  late_calls: { person: string; house: string; day: string; shift: string; shift_at: string; told_at: string; source: string }[]
  no_show_no_call: { person: string; house: string; day: string; shift: string; shift_at: string; minutes: number | null; checked_at: string }[]
  took_open: Taken[]
  took_call_off: Taken[]
  /** Texts the reply ear heard (server/sms_ears.py), cut to this reader's houses. */
  replies?: TextReply[]
  replies_readable?: boolean
  replies_why?: string
}

/** One text the reply ear heard and what it came to (server/sms_ears.py). */
export type TextReply = {
  id: string
  /** when the text was SENT (Quo's createdAt) */
  at: string
  heard_at: string
  /** the company line it reached, its last four digits: '5558' · '4040' */
  line: string
  person: string
  /** named · shared · unknown · unread */
  sender: string
  phone_tail: string
  /** yes · no · late · other */
  word: string
  /** the words, kept only for a text read as a reply */
  words: string
  // applied · already · answered · ambiguous · refused · unclear · declined · shift_ask · unmatched · not_a_reply ·…
  outcome: string
  /** call_off · open_shift · handoff · shift_ask · '' */
  road: string
  code: string
  why: string
  location: string
  house: string
  col_iso: string
  value: string
  ref: string
  request_id: string
  handoff_id: string
  /** what an ambiguous text could have meant — never a call-off's roster row */
  candidates: {
    road: string; ref?: string; handoff_id?: string; location?: string; house?: string
    col_iso?: string; value?: string
  }[]
  /** THE MARK, from server/sms_ears.replies: a line the staff-answers rehearsal wrote, never the person's own */
  rehearsal?: boolean
  /** the acknowledgement it owes the sender ('' for none) */
  ack: string
  /** said · waiting · expired · '' */
  ack_state: string
  ack_note: string
}

/** What a text came to, in the words a house manager reads. */
export const REPLY_LABEL: Record<string, string> = {
  applied: 'Applied by text',
  already: 'Already on file',
  answered: 'Swap answered',
  ambiguous: 'Ambiguous — nothing done',
  refused: 'Refused',
  unclear: 'Named a shift, said no yes',
  declined: 'Said no',
  shift_ask: 'Answer to the shift ask',
  unmatched: 'Nothing was waiting',
  not_a_reply: 'Not a reply',
  unknown_sender: 'Nobody can be named',
  unheard: 'Could not be heard',
}

export const REPLY_TINT: Record<string, string> = {
  applied: 'mint',
  answered: 'mint',
  already: 'slate',
  ambiguous: 'amber',
  refused: 'pink',
  unclear: 'amber',
  declined: 'slate',
  shift_ask: 'blue',
  unmatched: 'slate',
  not_a_reply: 'slate',
  unknown_sender: 'peach',
  unheard: 'pink',
}

/** A name only when exactly one person holds the number. */
export function senderLabel(r: Pick<TextReply, 'sender' | 'person' | 'phone_tail'>): string {
  const tail = r.phone_tail ? ` …${r.phone_tail}` : ''
  if (r.sender === 'named' && r.person) return r.person
  if (r.sender === 'shared') return `A shared number${tail} — never named`
  if (r.sender === 'unread') return `Number${tail} — who holds it could not be read`
  return `Unknown number${tail}`
}

/** Texts read as replies, and the rest (opened on demand). */
export function splitReplies(rows: TextReply[]): { acted: TextReply[]; notReplies: TextReply[] } {
  const acted: TextReply[] = []
  const notReplies: TextReply[] = []
  for (const r of rows) (r.outcome === 'not_a_reply' ? notReplies : acted).push(r)
  return { acted, notReplies }
}

/** Where the acknowledgement stands, in words — '' when the text owes none. */
export function ackLabel(r: Pick<TextReply, 'ack' | 'ack_state' | 'ack_note'>): string {
  if (!r.ack) return ''
  /* only a text the door says it sent reads as answered */
  if (r.ack_state === 'said') return 'Acknowledged by text'
  if (r.ack_state === 'opted_out') return 'Not texted — they asked not to be texted'
  if (r.ack_state === 'rehearsal') {
    return `Acknowledgement recorded only, not sent${r.ack_note ? ` (${r.ack_note})` : ''} — it goes when sending is on`
  }
  if (r.ack_state === 'not_sent') {
    return `Acknowledgement could not be texted${r.ack_note ? ` — ${r.ack_note}` : ''}; it is tried again`
  }
  if (r.ack_state === 'expired') {
    return `Acknowledgement dropped${r.ack_note ? ` — ${r.ack_note}` : ' — no longer true when it could go'}`
  }
  return 'Acknowledgement not sent yet — it goes on the next beat, or at 08:00 if the quiet window holds it'
}

export type Taken = {
  person: string
  house: string
  location: string
  col_iso: string
  shift: string
  at: string
  how: string
  decided_by: string
}

/** The `?ref=` a notice opened: ringed, or said ended unless the reader applied for it. */
export function refNoLongerOpen(feed: Pick<Feed, 'available'> & Partial<Pick<Feed, 'rows'>> | null,
                                tab: string, ref: string): boolean {
  return Boolean(feed && ref && tab === 'me' && !feed.available.some((o) => o.ref === ref)
    && !appliedFor(feed, ref))
}

/** Does this reader hold a live application for the pooled shift `ref`? */
export function appliedFor(feed: Partial<Pick<Feed, 'rows'>> | null, ref: string): boolean {
  return Boolean(feed && ref && (feed.rows ?? []).some((r) => r.mine && r.ref === ref
    && r.kind !== 'swap' && (r.state === 'applied' || r.state === 'needs_training_approval')))
}

/** A ref as it may appear in a selector — the relay's refs are letters and digits. */
export function safeRef(raw: string | null | undefined): string {
  const ref = String(raw ?? '').trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(ref) ? ref : ''
}

// The four words this company uses about a shift, and the ONE place they are spelled.
export function shiftStateLabel(state: string, w?: ShiftWindow): string {
  if (state === 'filled') return 'Filled'
  if (state === 'manager_only') return 'The house manager assigns it'
  if (state === 'closed') return 'Closed — awaiting the house manager'
  if (w?.reserved) return `Reserved for this house's staff until ${clockOf(w.closes_at)}`
  return 'Open to applications'
}

// 'Open' / 'Reserved' / 'Closed' / 'Filled' — the same four states as one word, for a chip that has no room for a…
export function shiftStateWord(state: string, w?: ShiftWindow): string {
  if (state === 'filled') return 'Filled'
  if (state === 'manager_only') return 'Assign'
  if (state === 'closed') return 'Closed'
  return w?.reserved ? 'Reserved' : 'Open'
}

/** An ISO instant on Ohio's clock ('5:10 AM'), whatever the phone's zone, or ''. */
export function clockOf(iso: string): string {
  return ohioTime(iso)
}

/** 'YYYY-MM-DD' → 'Ddd Mon D', and 'Today' when it is. */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today'
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

// HOW LONG IS LEFT, as a person reads it.
export function countdown(closesAt: string, nowMs: number): { label: string; seconds: number; urgent: boolean } {
  const end = new Date(closesAt).getTime()
  if (!Number.isFinite(end)) return { label: '', seconds: 0, urgent: false }
  const seconds = Math.max(0, Math.floor((end - nowMs) / 1000))
  if (seconds <= 0) return { label: 'closed', seconds: 0, urgent: false }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const label = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
  return { label, seconds, urgent: seconds <= 120 }
}

// The list a reader may see.
export function visibleRows(rows: RequestRow[]): RequestRow[] {
  return rows.filter((r) => r.visible)
}

export type Cuts = { q?: string; house?: string; person?: string; kind?: string; state?: string; day?: string }

/** Search plus house, person, kind, state and date cuts; narrowing only. */
export function filterRows(rows: RequestRow[], cuts: Cuts): RequestRow[] {
  const q = (cuts.q ?? '').trim().toLowerCase()
  return rows.filter((r) => {
    if (cuts.house && cuts.house !== 'all' && r.house !== cuts.house) return false
    if (cuts.person && cuts.person !== 'all'
        && ![r.person, r.from_staff, r.to_staff].includes(cuts.person)) return false
    if (cuts.kind && cuts.kind !== 'all' && r.kind !== cuts.kind) return false
    if (cuts.state && cuts.state !== 'all' && stateGroup(r.state) !== cuts.state) return false
    if (cuts.day && cuts.day !== 'all' && r.col_iso !== cuts.day) return false
    if (!q) return true
    return [r.person, r.house, r.shift, r.state, r.why, r.from_staff, r.to_staff,
            r.decided_by, r.col_iso]
      .some((v) => String(v ?? '').toLowerCase().includes(q))
  })
}

// Live or settled — the one cut that matters when the list is long, and the reason a settled row can stay on it for…
export function stateGroup(state: string): 'waiting' | 'settled' {
  return state === 'applied' || state === 'needs_training_approval' || state === 'pending'
    ? 'waiting'
    : 'settled'
}

// The houses, kinds and days actually present — read off the rows, never a list somebody maintains: a house that…
export function cutsFrom(rows: RequestRow[]): { houses: string[]; people: string[]; kinds: string[]; days: string[] } {
  const houses = new Set<string>()
  const people = new Set<string>()
  const kinds = new Set<string>()
  const days = new Set<string>()
  for (const r of rows) {
    if (r.house) houses.add(r.house)
    for (const p of [r.person, r.from_staff, r.to_staff]) if (p) people.add(p)
    if (r.kind) kinds.add(r.kind)
    if (r.col_iso) days.add(r.col_iso)
  }
  return {
    houses: [...houses].sort(),
    people: [...people].sort((a, b) => a.localeCompare(b)),
    kinds: [...kinds].sort(),
    days: [...days].sort().reverse(),
  }
}

export const KIND_LABEL: Record<string, string> = {
  open_shift: 'Open shift',
  call_off: 'Call-off shift',
  swap: 'Swap',
  ist_approval: 'Training approval',
  time_off: 'Time off',
}

export const STATE_LABEL: Record<string, string> = {
  applied: 'Applied',
  needs_training_approval: 'Needs training approval',
  approved: 'Approved',
  not_chosen: 'Not chosen',
  withdrawn: 'Withdrawn',
  refused: 'Refused',
  pending: 'Waiting',
  done: 'Done',
  dead: 'Ended',
  // time off, by its dates; the request's own status is TIME_OFF_STATUS_LABEL
  upcoming: 'Upcoming',
  past: 'Past',
}

export const STATE_TINT: Record<string, string> = {
  upcoming: 'amber',
  past: 'slate',
  applied: 'amber',
  needs_training_approval: 'peach',
  approved: 'mint',
  not_chosen: 'slate',
  withdrawn: 'slate',
  refused: 'pink',
  pending: 'amber',
  done: 'mint',
  dead: 'pink',
}

// WHAT THIS READER MAY DO ON THIS ROW — for drawing buttons only.
export function drawsHouses(feed: Pick<Feed, 'whole_company' | 'manages'> | null | undefined): boolean {
  return Boolean(feed?.whole_company || feed?.manages?.length)
}

/** The Rehearsal tab: only on the relay's own master yes, never inferred from badges. */
export function drawsRehearsal(feed: Pick<Feed, 'rehearsal'> | null | undefined): boolean {
  return feed?.rehearsal === true
}

// DOES THIS READER DECIDE IN THIS HOUSE?
export function decidesHere(feed: Pick<Feed, 'manages' | 'badges'>, location: string,
                            codeOfFn: (loc: string) => string = codeOf): boolean {
  const everywhere = (feed.badges ?? []).some((b) => ADMIN_WORDS.has(b))
  return everywhere || (feed.manages ?? []).includes(codeOfFn(location))
}

export function actionsFor(row: RequestRow, feed: Pick<Feed, 'me' | 'manages' | 'badges'>,
                           codeOfFn: (loc: string) => string = codeOf): {
  withdraw: boolean; decide: boolean; training: boolean
  answerSwap: '' | 'staff' | 'manager' | 'director'
  withdrawSwap: boolean
} {
  const me = (feed.me ?? '').trim().toLowerCase()
  const here = decidesHere(feed, row.location, codeOfFn)
  const withdraw = Boolean(me) && row.person?.toLowerCase() === me
    && (row.state === 'applied' || row.state === 'needs_training_approval')
    && row.kind !== 'swap'
  const decide = here && row.kind !== 'swap' && row.kind !== 'ist_approval'
    && row.state === 'applied'
  const training = here && row.kind === 'ist_approval' && row.state === 'needs_training_approval'
  // a transfer's buttons are the relay's answer, never a name compared here
  let answerSwap: '' | 'staff' | 'manager' | 'director' = ''
  let withdrawSwap = false
  if (row.kind === 'swap' && row.state === 'pending') {
    if (row.may_accept) answerSwap = 'staff'
    else if (row.may_approve) answerSwap = 'manager'
    else if (row.may_approve_director) answerSwap = 'director'
    withdrawSwap = Boolean(row.may_withdraw)
  }
  return { withdraw, decide, training, answerSwap, withdrawSwap }
}

// The badge words that decide everywhere.
const ADMIN_WORDS = new Set(['MASTER', 'DIRECTOR', 'ADMINISTRATOR', 'ADMIN'])

/** How an action names a shift: the ref when there is one (a call-off's open_row is private). */
export function shiftHandle(r: { ref?: string; location: string; open_row?: string; col_iso: string }):
  { ref: string } | { location: string; open_row?: string; col_iso: string } {
  return r.ref
    ? { ref: r.ref }
    : { location: r.location, open_row: r.open_row, col_iso: r.col_iso }
}

/** 'CAN - 48TH (B) - ABD1711' → 'ABD1711' — the key the ** row is filed by. */
export function codeOf(location: string): string {
  const parts = String(location ?? '').split(' - ')
  return (parts[parts.length - 1] ?? '').trim().toUpperCase()
}

// The cumulative list by day, newest day first — a list this long is unreadable as one column, and the day is what…
export function groupByDay(rows: RequestRow[]): { day: string; rows: RequestRow[] }[] {
  const by = new Map<string, RequestRow[]>()
  for (const r of rows) {
    const day = (r.at || '').slice(0, 10) || r.col_iso || ''
    const got = by.get(day)
    if (got) got.push(r)
    else by.set(day, [r])
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, list]) => ({ day, rows: list }))
}

/* ── what a row leads with, in words ──────────────────────────────────────── */

/** '7:00 AM – 3:00 PM' on Ohio's clock, or '' when the hours are not known. */
export function clockSpan(start: string, end: string): string {
  const a = clockOf(start)
  const b = clockOf(end)
  return a && b ? `${a} – ${b}` : ''
}

/** 'JH home · ABD2704 · 2704 Abbot Dr' — the house by name, code and street. */
export function placeLine(e: Pick<Essentials, 'house' | 'house_name' | 'code' | 'address'> | null | undefined): string {
  if (!e) return ''
  return [e.house_name || e.house, e.code, e.address].filter(Boolean).join(' · ')
}

/** '<day> · 7:00 AM – 3:00 PM (7A-3P) · 8h' */
export function shiftLine(e: Pick<Essentials, 'col_iso' | 'shift_code' | 'shift_start' | 'shift_end' | 'hours'> | null | undefined,
                          today: string): string {
  if (!e) return ''
  const clock = clockSpan(e.shift_start, e.shift_end)
  const what = clock ? `${clock}${e.shift_code ? ` (${e.shift_code})` : ''}` : e.shift_code
  const hours = typeof e.hours === 'number' ? `${Math.round(e.hours * 100) / 100}h` : ''
  return [dayLabel(e.col_iso, today), what, hours].filter(Boolean).join(' · ')
}

/** The application window in words. */
export function windowLine(state: string, w: ShiftWindow | undefined, nowMs: number): string {
  if (state === 'filled') return 'Given'
  if (state === 'manager_only') return 'No window — the house manager assigns it'
  if (state === 'closed') return `Applications closed${w?.closes_at ? ` at ${clockOf(w.closes_at)}` : ''} — the house manager decides`
  if (!w) return ''
  const left = countdown(w.closes_at, nowMs).label
  const whose = w.reserved ? 'for this house\'s staff' : 'to everyone'
  return `Applications open ${whose} — close ${clockOf(w.closes_at)}${left && left !== 'closed' ? ` · ${left} left` : ''}`
}

/** The URGENT OPEN SHIFT outcome; never "not sent" for a record the relay lacks. */
export function urgentLine(u: UrgentState | undefined): string {
  if (!u) return ''
  if (!u.known) return 'URGENT OPEN SHIFT — its record is on Smart Comms → Activity'
  const at = u.at ? ` at ${clockOf(u.at)}` : ''
  if (u.state === 'sent') {
    const n = u.sent ?? 0
    return `URGENT OPEN SHIFT sent to ${n} ${n === 1 ? 'person' : 'people'}${at}`
  }
  const why = u.why ? ` — ${u.why}` : ''
  if (u.state === 'held') return `URGENT OPEN SHIFT held, not sent to staff (test mode or the sending dial)${at}`
  if (u.state === 'deferred') return `URGENT OPEN SHIFT deferred by the quiet hours — it goes in the morning if the shift has not ended${at}`
  if (u.state === 'not_sent') return `URGENT OPEN SHIFT not sent${why}`
  if (u.state === 'gave_up') return `URGENT OPEN SHIFT never went${why}`
  return `URGENT OPEN SHIFT not sent yet${why}`
}

/** 'Called off by <name> · <when> · <road> (filed by <name>)'. */
export function calledOffLine(c: CalledOff | undefined): string {
  if (!c) return ''
  if (!c.readable && !c.road) return `How this call-off was filed could not be read (${c.why})`
  const who = c.by ? `Called off by ${c.by}` : 'Called off'
  const when = c.at ? ohioDateTime(c.at) || c.at : ''
  const road = c.road_words ? `${c.road_words}${c.filed_by ? ` (filed by ${c.filed_by})` : ''}` : ''
  return [who, when, road].filter(Boolean).join(' · ')
}

/** The reason as given, quoted — or why there is none to quote. */
export function reasonLine(c: CalledOff | undefined): string {
  if (!c) return ''
  return c.reason ? `“${c.reason}”` : c.reason_why
}

/** '<name> has it — <how> · decided by <name> · <when>'. */
export function decisionLine(d: ShiftCard['decision'] | undefined): string {
  if (!d?.person) return ''
  return `${d.person} has it — ${d.how}${d.by ? ` · decided by ${d.by}` : ''}${d.at ? ` · ${ohioDateTime(d.at)}` : ''}`
}

// What the directors list says beside the time-off rows: '' while it names somebody (or the relay did not say); a…
export function timeOffDirectorsNote(t: Pick<NonNullable<Feed['time_off']>, 'directors_readable' | 'directors_why'> | undefined): string {
  if (!t || t.directors_readable === undefined) return ''
  if (t.directors_readable === false) {
    return `The directors list could not be read — ${t.directors_why || 'no reason was given'}. ` +
      'No time off request is filed or decided until it can be.'
  }
  const why = String(t.directors_why ?? '').trim()
  return why ? `${why.charAt(0).toUpperCase()}${why.slice(1)}.` : ''
}

/** A stretch of time off's shifts in one line. */
export function displacedLine(t: Pick<TimeOffRow, 'displaced'>): string {
  const working = t.displaced.filter((d) => d.working).length
  const off = t.displaced.filter((d) => !d.working)
  const covered = off.filter((d) => d.covered === true).length
  const open = off.filter((d) => d.covered === false).length
  const none = off.filter((d) => d.covered === null).length
  const parts: string[] = []
  if (working) parts.push(`${working} shift${working === 1 ? '' : 's'} still on the calendar under their name`)
  if (covered) parts.push(`${covered} day${covered === 1 ? '' : 's'} off with every open shift given`)
  if (open) parts.push(`${open} day${open === 1 ? '' : 's'} off with an open shift still to give`)
  if (none) parts.push(`${none} day${none === 1 ? '' : 's'} off with no open shift put up`)
  return parts.length ? parts.join(' · ') : 'Touches no shift on a drawn calendar'
}

export type TimeOffCuts = { q?: string; house?: string; person?: string; state?: string; day?: string }

/** The time-off tab's cuts; narrowing only. */
export function filterTimeOff(rows: TimeOffRow[], cuts: TimeOffCuts): TimeOffRow[] {
  const q = (cuts.q ?? '').trim().toLowerCase()
  return rows.filter((t) => {
    if (cuts.house && cuts.house !== 'all' && !t.houses.includes(cuts.house)) return false
    if (cuts.person && cuts.person !== 'all' && t.person !== cuts.person) return false
    if (cuts.state && cuts.state !== 'all' && t.state !== cuts.state) return false
    if (cuts.day && cuts.day !== 'all' && !(t.start <= cuts.day && cuts.day <= t.end)) return false
    if (!q) return true
    return [t.person, t.calendar_name, t.start, t.end, ...t.houses]
      .some((v) => String(v ?? '').toLowerCase().includes(q))
  })
}

/** The houses, people and states actually present on the time-off list. */
export function timeOffCutsFrom(rows: TimeOffRow[]): { houses: string[]; people: string[]; states: string[] } {
  const houses = new Set<string>()
  const people = new Set<string>()
  const states = new Set<string>()
  for (const t of rows) {
    t.houses.forEach((h) => houses.add(h))
    if (t.person) people.add(t.person)
    if (t.state) states.add(t.state)
  }
  return { houses: [...houses].sort(), people: [...people].sort((a, b) => a.localeCompare(b)), states: [...states].sort() }
}

/* ── export, share, print ─────────────────────────────────────────────────── */

/** Columns shared by export, share and print; rows are the on-screen, relay-cut rows. */
export const EXPORT_COLUMNS = [
  { key: 'at', label: 'When' },
  { key: 'kind', label: 'Kind' },
  { key: 'house', label: 'House' },
  { key: 'code', label: 'Code' },
  { key: 'address', label: 'Street' },
  { key: 'col_iso', label: 'Shift day' },
  { key: 'shift', label: 'Shift' },
  { key: 'clock', label: 'Shift hours' },
  { key: 'hours', label: 'Hours' },
  { key: 'person', label: 'Person' },
  { key: 'state', label: 'State' },
  { key: 'window', label: 'Applications' },
  { key: 'called_off', label: 'Called off' },
  { key: 'reason', label: 'Reason' },
  { key: 'decided_by', label: 'Decided by' },
  { key: 'decided_at', label: 'Decided' },
  { key: 'via', label: 'Road' },
  { key: 'why', label: 'Note' },
]

/** The on-screen rows with their shift facts laid in. */
export function exportRows(rows: RequestRow[], shifts: Record<string, ShiftCard> | undefined,
                           nowMs: number): Record<string, unknown>[] {
  return rows.map((r) => {
    const card = r.ref ? shifts?.[r.ref] : undefined
    const e: Partial<Essentials> = card ?? r.essentials ?? {}
    return {
      ...r,
      code: e.code ?? '',
      address: e.address ?? '',
      clock: clockSpan(e.shift_start ?? '', e.shift_end ?? ''),
      hours: typeof e.hours === 'number' ? e.hours : '',
      window: card ? windowLine(card.state, card.window, nowMs) : '',
      called_off: calledOffLine(card?.called_off),
      reason: card?.called_off ? (card.called_off.reason || '') : (r.reason || ''),
    }
  })
}

/** The time-off tab's export. */
export const TIME_OFF_EXPORT_COLUMNS = [
  { key: 'person', label: 'Person' },
  { key: 'start', label: 'From' },
  { key: 'end', label: 'To' },
  { key: 'days', label: 'Days' },
  { key: 'calendar_name', label: 'Calendar' },
  { key: 'houses', label: 'Houses' },
  { key: 'asked', label: 'Asked' },
  { key: 'state', label: 'State' },
  { key: 'status', label: 'Status' },
  { key: 'house_manager', label: 'House manager' },
  { key: 'director', label: 'Director' },
  { key: 'ref', label: 'Ref' },
  { key: 'shifts', label: 'Shifts it touches' },
  { key: 'decided_why', label: 'Decided' },
]

export function timeOffExportRows(rows: TimeOffRow[]): Record<string, unknown>[] {
  return rows.map((t) => ({ ...t, houses: (t.house_labels ?? t.houses).join(', '), shifts: displacedLine(t),
                            status: TIME_OFF_STATUS_LABEL[t.status ?? ''] ?? t.status ?? '',
                            house_manager: timeOffLegLine('', t.hm).replace(/^: /, ''),
                            director: timeOffLegLine('', t.dir).replace(/^: /, ''), ref: t.ref ?? t.id }))
}

/** The call-offs tab's export. */
export const CALL_OFF_EXPORT_COLUMNS = [
  { key: 'house', label: 'House' },
  { key: 'code', label: 'Code' },
  { key: 'address', label: 'Street' },
  { key: 'col_iso', label: 'Shift day' },
  { key: 'value', label: 'Shift' },
  { key: 'clock', label: 'Shift hours' },
  { key: 'hours', label: 'Hours' },
  { key: 'called_off', label: 'Called off' },
  { key: 'reason', label: 'Reason' },
  { key: 'window', label: 'Applications' },
  { key: 'urgent', label: 'URGENT OPEN SHIFT' },
  { key: 'applicant_count', label: 'Applied' },
  { key: 'decision', label: 'Decision' },
]

export function callOffExportRows(list: PoolShift[], shifts: Record<string, ShiftCard> | undefined,
                                  nowMs: number): Record<string, unknown>[] {
  return list.map((s) => {
    const card = shifts?.[s.ref]
    return {
      house: s.house, code: card?.code ?? '', address: card?.address ?? '', col_iso: s.col_iso,
      value: s.value, clock: clockSpan(s.shift_start, s.shift_end),
      hours: typeof card?.hours === 'number' ? card.hours : '',
      called_off: calledOffLine(card?.called_off), reason: card?.called_off?.reason ?? '',
      window: windowLine(s.state, s.window, nowMs), urgent: urgentLine(card?.urgent),
      applicant_count: s.applicant_count ?? s.applicants.length,
      decision: decisionLine(card?.decision),
    }
  })
}
