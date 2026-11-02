// THE HOTLINE DOOR — the relay's reads behind the Hotline screen, typed field for field against the contract both…
// GET /hub-lanes/hotline/calls every call of both lines, newest first GET /hub-lanes/hotline/call/{id} one call's…
import { useAuthStore } from '@/auth/useAuthStore'

// ------------------------------------------------------------------ the contract…

export type LineKey = 'hotline' | 'screening'

export type LineSpec = { line: string; key: LineKey; label: string }

export type SourceHealth = { ok: boolean; rows: number | null; error: string }

export type SourceKey = 'transcripts' | 'calls_house' | 'recaps' | 'hotline_log' | 'roster'

export type CallerKind = 'outside' | 'company_line' | 'unknown'
export type CallerWho = 'sole' | 'shared' | 'unknown'

export type Caller = {
  /** E.164 or '' */
  phone: string
  kind: CallerKind
  /** OpenPhone's name for the line when `kind` is company_line, else '' */
  line_name: string
  who: CallerWho
  /** ONLY when who === 'sole' — from the roster, by the last ten digits */
  name: string
}

export type CallSummary = { text: string; next_steps: string[] }

// `unlogged`: the processing log could not be read on this build and the call is young enough that the sweep may…
export type HotlineState = 'filed' | 'blocked' | 'waiting' | 'held' | 'legacy' | 'no_words' | 'unlogged' | 'filing'

// WHERE THE RELAY'S LIVE COPY IS WITH A CALL THE BOOKS STILL SHOW WAITING: `filing` while the hotline read files…
export type HotlineStage = 'filing' | 'filed'

export type HotlineRead = {
  state: HotlineState
  /** absent when the relay is not filing the call right now */
  stage?: HotlineStage
  at: string
  /** 'Request' | 'DailyNote' | 'Incident', with '!failed' when the row did not land */
  kinds: string[]
  /** null when not known — for a filing, what it filed has not been read yet */
  items: number | null
  via: string
  why: string
}

export type CallRow = {
  call_id: string
  /** ISO UTC, or '' when the inbox held no readable event time */
  at: string
  line: string
  line_key: LineKey
  direction: 'incoming' | 'outgoing' | ''
  duration_sec: number | null
  turns: number | null
  caller: Caller
  summary: CallSummary | null
  /** null for screening calls — the hiring lane reads those */
  hotline: HotlineRead | null
  has_transcript: boolean
}

// THE SWEEP'S OWN CLOCK — its last pass, whatever that pass found.
export type HotlineSweep = {
  /** ISO UTC, or '' when no pass is on record */
  at: string
  status: string
  reason: string
  message: string
  refused_in_a_row: number | null
  from: 'relay' | 'cadence' | ''
}

export type CallsIndex = {
  built_at: string
  // a hash of the calls, each source's health and the newest log row — never of built_at, so unchanged data answers…
  version: string
  lines: LineSpec[]
  sources: Partial<Record<SourceKey, SourceHealth>>
  /** newest hotline_log `at` — the last call filed or refused — or '' */
  hotline_last_logged_at: string
  /** null when the relay sent no pass clock (an older relay, or a kept copy) */
  hotline_sweep: HotlineSweep | null
  // The relay's own word on the 4040 for THIS session: true when it took the screening calls out of the answer…
  screening_withheld: boolean | null
  // The relay's word on its fast path: true while it rings the hotline read for each 5558 call as the call ends.
  fast_path_armed?: boolean
  calls: CallRow[]
}

export type TurnRole = 'agent' | 'caller' | 'other'

export type TranscriptTurn = { at: string; speaker: string; role: TurnRole; text: string }

// `webhook`: the words OpenPhone sent the relay as the call ended, held in the relay's memory until the transcript…
export type CallTranscript = { source: 'transcripts' | 'calls_house' | 'webhook'; turns: TranscriptTurn[]; plain: string }

export type CallDetail = {
  call_id: string
  transcript: CallTranscript | null
  summary: { text: string; next_steps: string[]; source: 'recaps' } | null
}

/* ── Staff Daily Notes ─────────────────────────────────────────────── */

export type NoteKind = 'daily' | 'not_daily'

export type NoteShift = {
  /** where the shift came from: the schedule, the hour of the call, or nothing */
  via: 'schedule' | 'call_time' | 'none'
  label: string
  /** 'HH:MM' or '' */
  start: string
  end: string
  house: string
  /** null when no scheduled shift was found to be at or away from the client's house */
  at_client_house: boolean | null
  staff_match: 'exact' | 'similar' | ''
  // the day the scheduled shift began, 'YYYY-MM-DD' — an overnight's is the evening before the morning call; ''…
  date: string
  /** which copy of the schedule held the shift, as the relay names it; '' when not said */
  source: string
  // whether the shift's hours hold the call's time — false is a shift that day at another hour; null when the relay…
  covers_call: boolean | null
}

export type DailyNote = {
  /** 'r<sheetRow>' — the row as the book stands now; it moves when rows above it do */
  id: string
  /** the relay's key for the note that does not move with the row, or '' */
  key: string
  call_id: string
  /** 'YYYY-MM-DD' in the notes book's own day, never shifted — or '' */
  reporting_date: string
  /** ISO UTC, or '' */
  call_at: string
  dsp_name: string
  /** snake_case, as the book wrote it */
  category: string
  category_label: string
  kind: NoteKind
  response: string
  /** the client the note was matched to, or '' */
  client: string
  client_match: 'exact' | 'similar' | 'none'
  /** the client's name as the note wrote it */
  written_as: string
  shift: NoteShift
}

export type NotesSourceKey = 'notes' | 'clients' | 'schedule'

export type DailyNotesBook = {
  built_at: string
  /** the moment the notes are the book as of — a copy's is older than built_at; '' unknown */
  source_at: string
  version: string
  /** the whole book, newest first */
  notes: DailyNote[]
  /** notes naming a client the clients list does not hold — null when not said */
  unmatched: UnmatchedNotes
  sources: Partial<Record<NotesSourceKey, SourceHealth>>
}

/** One spelling no client on file was matched to, and how many notes use it. */
export type UnmatchedSpelling = { written_as: string; rows: number }

export type UnmatchedNotes = {
  rows: number | null
  /** distinct spellings — null when not said */
  names: number | null
  /** the spellings themselves, when the relay lists them; null when it only counts */
  spellings: UnmatchedSpelling[] | null
}

// THE UNMATCHED BLOCK, whichever shape the relay sends: `names` as a count, or as the list of spellings with their…
export function readUnmatched(v: unknown): UnmatchedNotes {
  const um = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const rows = typeof um.rows === 'number' && Number.isFinite(um.rows) ? um.rows : null
  if (!Array.isArray(um.names)) {
    return { rows, names: typeof um.names === 'number' && Number.isFinite(um.names) ? um.names : null, spellings: null }
  }
  const spellings: UnmatchedSpelling[] = []
  for (const e of um.names as unknown[]) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const written = typeof o.written_as === 'string' ? o.written_as.trim() : ''
    const n = typeof o.rows === 'number' && Number.isFinite(o.rows) && o.rows > 0 ? Math.floor(o.rows) : 0
    if (written && n) spellings.push({ written_as: written, rows: n })
  }
  return { rows, names: um.names.length, spellings }
}

/* ── the three sheet lanes ─────────────────────────────────────────── */

// One row of a lane's book, keyed as its header is — the same cells the rows carried when they came off a slice…
export type LaneRow = Record<string, unknown>

// THE DOOR'S NAME FOR EACH BOOK — the one vocabulary, spelled the same on both sides of the read: the relay keys…
export type LaneKey = 'callOffs' | 'supportQueue' | 'uiIncidents'

export const LANE_KEYS: LaneKey[] = ['callOffs', 'supportQueue', 'uiIncidents']

// WHAT THE DOOR SAID ABOUT A BOOK ON THIS ANSWER: ok it read the book just now.
export type LaneHealth = { state: 'ok' | 'stale' | 'unreadable'; why: string }

export type LaneBook = {
  // the whole book, in the order the sheet holds it — null when this answer carried no rows for it: never read, or…
  rows: LaneRow[] | null
  health: LaneHealth
  /** ISO UTC of the read the rows came from, or '' */
  at: string
}

export type HotlineLanes = {
  // a hash of the three books and their health — the same version is the same books, said the same way
  version: string
  // the door answered the version this screen already holds, so it left the rows out: what is on screen is current
  unchanged: boolean
  lanes: Record<LaneKey, LaneBook>
}

/** Why a door said no — the sentence a screen prints is chosen by this. */
export type AccessReason = 'session' | 'badge' | 'stale' | 'unreadable' | 'restricted'

const ACCESS_REASONS: AccessReason[] = ['session', 'badge', 'stale', 'unreadable', 'restricted']

/** Data, or the relay's refusal in its own words. `status` 0 is "nothing answered". */
export type DoorAnswer<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; reason: AccessReason | '' }

// A refusal about WHO is asking — as opposed to a door that could not answer.
export function isAccessRefusal(a: { status: number } | null | undefined): boolean {
  if (!a) return false
  return a.status === 401 || a.status === 403
}

// ------------------------------------------------------------------ the reads…

const CALLS_PATH = '/hub-lanes/hotline/calls'
const CALL_PATH = '/hub-lanes/hotline/call/'
const NOTES_PATH = '/hub-lanes/hotline/daily-notes'
const LANES_PATH = '/hub-lanes/hotline/lanes'

const str = (v: unknown) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v))
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

async function door<T>(path: string, signal?: AbortSignal): Promise<DoorAnswer<T>> {
  const token = useAuthStore.getState().token
  let res: Response
  try {
    res = await fetch(path, {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') {
      return { ok: false, status: 0, message: 'The read was cancelled.', reason: '' }
    }
    return {
      ok: false,
      status: 0,
      message: `The server did not answer (${err instanceof Error ? err.message : String(err)}).`,
      reason: '',
    }
  }
  // The relay always answers an envelope.
  const env = (await res.json().catch(() => null)) as
    { status?: unknown; data?: unknown; message?: unknown; reason?: unknown; detail?: unknown } | null
  if (!env || typeof env !== 'object') {
    if (res.status === 503) {
      return {
        ok: false,
        status: 503,
        message: 'Too many reads at once — pause a moment, then try again.',
        reason: '',
      }
    }
    return {
      ok: false,
      status: res.status === 200 ? 502 : res.status,
      message: `The server answered ${res.status} without a readable envelope — the hotline door is not reachable right now (a restart, usually); the next read tries again.`,
      reason: '',
    }
  }
  // A 404 with no envelope is the web framework, not the door: the relay running here predates this route.
  if (env.status === undefined && res.status === 404) {
    return {
      ok: false,
      status: 404,
      message: 'The server does not know this door yet — it has not been restarted with the hotline doors.',
      reason: '',
    }
  }
  const status = Number(env.status ?? res.status)
  if (status !== 200) {
    const reason = ACCESS_REASONS.find((r) => r === env.reason) ?? ''
    return {
      ok: false,
      status: Number.isFinite(status) ? status : res.status,
      message: String(env.message || `The server answered ${res.status}.`),
      reason,
    }
  }
  return { ok: true, data: env.data as T }
}

function readSweep(v: unknown): HotlineSweep | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  const from = s.from === 'relay' || s.from === 'cadence' ? s.from : ''
  return {
    at: str(s.at),
    status: str(s.status),
    reason: str(s.reason),
    message: str(s.message),
    refused_in_a_row: numOrNull(s.refused_in_a_row),
    from,
  }
}

// A call row as sent, except in its hotline read: `kinds` not a list what the call filed has not been read yet.
function readCall(c: CallRow): CallRow {
  const h = c && typeof c === 'object' ? c.hotline : null
  if (!h || typeof h !== 'object') return c
  const kindsRead = Array.isArray(h.kinds)
  const items = kindsRead ? numOrNull(h.items) : null
  const sent = (h as { stage?: unknown }).stage
  const stage = sent === 'filing' || sent === 'filed' ? sent : undefined
  if (kindsRead && items === h.items && stage === sent) return c
  const read: HotlineRead = { ...h, kinds: kindsRead ? h.kinds : [], items }
  if (stage) read.stage = stage
  else delete read.stage
  return { ...c, hotline: read }
}

/** The whole index. A body that is not the contract's shape is said as such. */
export async function readCallsIndex(signal?: AbortSignal): Promise<DoorAnswer<CallsIndex>> {
  const ans = await door<CallsIndex>(CALLS_PATH, signal)
  if (!ans.ok) return ans
  const d = ans.data as unknown as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || !Array.isArray(d.calls)) {
    return {
      ok: false,
      status: 502,
      message: 'The server answered, but not with a calls index this screen knows how to read.',
      reason: '',
    }
  }
  return {
    ok: true,
    data: {
      built_at: str(d.built_at),
      version: str(d.version),
      lines: Array.isArray(d.lines) ? (d.lines as LineSpec[]) : [],
      sources: d.sources && typeof d.sources === 'object' ? (d.sources as CallsIndex['sources']) : {},
      hotline_last_logged_at: str(d.hotline_last_logged_at),
      hotline_sweep: readSweep(d.hotline_sweep),
      screening_withheld: typeof d.screening_withheld === 'boolean' ? d.screening_withheld : null,
      ...(typeof d.fast_path_armed === 'boolean' ? { fast_path_armed: d.fast_path_armed } : {}),
      calls: (d.calls as CallRow[]).map(readCall),
    },
  }
}

/** One call's words and summary — asked only when somebody opens the call. */
export async function readCallDetail(callId: string, signal?: AbortSignal): Promise<DoorAnswer<CallDetail>> {
  const ans = await door<CallDetail>(CALL_PATH + encodeURIComponent(callId), signal)
  if (!ans.ok) return ans
  const d = ans.data
  if (!d || typeof d !== 'object') {
    return { ok: false, status: 502, message: 'The server answered, but not with a call this screen knows how to read.', reason: '' }
  }
  const t = d.transcript
  const s = d.summary
  return {
    ok: true,
    data: {
      call_id: String(d.call_id ?? callId),
      transcript: t && typeof t === 'object'
        ? {
            source: t.source === 'calls_house' || t.source === 'webhook' ? t.source : 'transcripts',
            turns: Array.isArray(t.turns) ? t.turns : [],
            plain: String(t.plain ?? ''),
          }
        : null,
      summary: s && typeof s === 'object'
        ? {
            text: String(s.text ?? ''),
            next_steps: Array.isArray(s.next_steps) ? s.next_steps.map(String) : [],
            source: 'recaps',
          }
        : null,
    },
  }
}

const HHMM = /^\d{2}:\d{2}$/
const YMD = /^\d{4}-\d{2}-\d{2}$/

function readShift(v: unknown): NoteShift {
  const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const via = s.via === 'schedule' || s.via === 'call_time' ? s.via : 'none'
  return {
    via,
    label: str(s.label),
    start: HHMM.test(str(s.start)) ? str(s.start) : '',
    end: HHMM.test(str(s.end)) ? str(s.end) : '',
    house: str(s.house),
    at_client_house: typeof s.at_client_house === 'boolean' ? s.at_client_house : null,
    staff_match: s.staff_match === 'exact' || s.staff_match === 'similar' ? s.staff_match : '',
    date: YMD.test(str(s.date)) ? str(s.date) : '',
    source: str(s.source).trim(),
    covers_call: typeof s.covers_call === 'boolean' ? s.covers_call : null,
  }
}

function readNote(v: unknown): DailyNote | null {
  if (!v || typeof v !== 'object') return null
  const n = v as Record<string, unknown>
  const id = str(n.id)
  if (!id) return null
  const day = str(n.reporting_date)
  return {
    id,
    key: str(n.key).trim(),
    call_id: str(n.call_id),
    reporting_date: YMD.test(day) ? day : '',
    call_at: str(n.call_at),
    dsp_name: str(n.dsp_name),
    category: str(n.category),
    category_label: str(n.category_label),
    kind: n.kind === 'not_daily' ? 'not_daily' : 'daily',
    response: str(n.response),
    client: str(n.client),
    client_match: n.client_match === 'exact' || n.client_match === 'similar' ? n.client_match : 'none',
    written_as: str(n.written_as),
    shift: readShift(n.shift),
  }
}

// ONE LANE AS SENT, IN THE DOOR'S OWN WORDS.
function readLane(v: unknown, unchanged: boolean): LaneBook {
  const l = (v && typeof v === 'object' && !Array.isArray(v) ? v : null) as Record<string, unknown> | null
  if (!l) {
    return { rows: null, health: { state: 'unreadable', why: 'The lanes door did not answer for this lane.' }, at: '' }
  }
  const sent = l.rows
  const rows = Array.isArray(sent)
    ? (sent as unknown[]).filter((r): r is LaneRow => !!r && typeof r === 'object' && !Array.isArray(r))
    : null
  // read what the door says, in the words the door says it — `at` and `read_at` are one moment written twice, so…
  const failed = l.ok === false || l.stale === true
  const why = str(l.error)
  const at = str(l.at) || str(l.read_at)
  const held = unchanged && !('rows' in l) && numOrNull(l.count) !== null
  if (!rows && !held) {
    return {
      rows: null,
      health: {
        state: 'unreadable',
        why: why || 'The lanes door answered without the rows for this lane.',
      },
      at,
    }
  }
  // ROWS WITH A FAILED READ BEHIND THEM ARE STALE, never healthy: the door could not read the book this time and…
  if (failed) {
    return {
      rows,
      health: { state: 'stale', why: why || 'The lanes door could not read this book again, so these rows are the copy it holds.' },
      at,
    }
  }
  return { rows, health: { state: 'ok', why }, at }
}

// The three sheet lanes, from their own books.
export async function readHotlineLanes(since = '', signal?: AbortSignal): Promise<DoorAnswer<HotlineLanes>> {
  const path = since ? `${LANES_PATH}?since=${encodeURIComponent(since)}` : LANES_PATH
  const ans = await door<HotlineLanes>(path, signal)
  if (!ans.ok) return ans
  const d = ans.data as unknown as Record<string, unknown> | null
  const sent = d && typeof d === 'object' ? d.lanes : null
  if (!sent || typeof sent !== 'object') {
    return {
      ok: false,
      status: 502,
      message: 'The server answered, but not with lanes this screen knows how to read.',
      reason: '',
    }
  }
  const lanes = sent as Record<string, unknown>
  const unchanged = d?.unchanged === true
  return {
    ok: true,
    data: {
      version: str(d?.version),
      unchanged,
      lanes: Object.fromEntries(LANE_KEYS.map((k) => [k, readLane(lanes[k], unchanged)])) as Record<LaneKey, LaneBook>,
    },
  }
}

/** The Staff Daily Notes book, matched. Same gate as the calls index. */
export async function readDailyNotes(signal?: AbortSignal): Promise<DoorAnswer<DailyNotesBook>> {
  const ans = await door<DailyNotesBook>(NOTES_PATH, signal)
  if (!ans.ok) return ans
  const d = ans.data as unknown as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || !Array.isArray(d.notes)) {
    return {
      ok: false,
      status: 502,
      message: 'The server answered, but not with a Daily Notes book this screen knows how to read.',
      reason: '',
    }
  }
  return {
    ok: true,
    data: {
      built_at: str(d.built_at),
      source_at: str(d.source_at),
      version: str(d.version),
      notes: (d.notes as unknown[]).map(readNote).filter((n): n is DailyNote => n !== null),
      unmatched: readUnmatched(d.unmatched),
      sources: d.sources && typeof d.sources === 'object' ? (d.sources as DailyNotesBook['sources']) : {},
    },
  }
}
