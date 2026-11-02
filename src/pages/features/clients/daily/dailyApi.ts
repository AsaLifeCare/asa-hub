// THE DAILY NOTES DOOR — the relay's read of the Staff Daily Notes book for one client, typed field for field…
// GET /hub-lanes/clients/daily?client=<the name as the clients slice spells it> WHY A DOOR AND NOT A SLICE.
import { useAuthStore } from '@/auth/useAuthStore'

// ------------------------------------------------------------------ the contract…

export type DailyKind = 'daily' | 'not_daily'

export type ClientMatch = 'exact' | 'similar' | 'none'

export type ShiftVia = 'schedule' | 'call_time' | 'none'

export type DailyShift = {
  // schedule: the DSP's shift was found · call_time: placed by the call's own clock · none: nothing places it
  via: ShiftVia
  /** 'Morning' | 'Afternoon' | 'Evening' | 'Overnight' | 'Day', or '' */
  label: string
  /** 'HH:MM' or '' — only the schedule gives a window */
  start: string
  end: string
  /** the house code the DSP worked, or '' */
  house: string
  /** null when the client carries no house to compare with */
  at_client_house: boolean | null
  /** how the DSP's name met the schedule; '' when it did not */
  staff_match: 'exact' | 'similar' | ''
  // 'YYYY-MM-DD' the scheduled shift began — an overnight's is the evening before; '' when the door did not say
  date: string
  /** which copy of the schedule held the shift, as the door names it; '' when not said */
  source: string
  /** whether the shift's hours hold the call's time; null when the door did not say */
  covers_call: boolean | null
}

export type DailyNote = {
  /** 'r<sheetRow>' — moves when a row above it is deleted or the book is sorted */
  id: string
  /** the door's key for the note that does not move with its row, or '' */
  key: string
  call_id: string
  /** 'YYYY-MM-DD' cut in the notes book's own zone, or '' */
  reporting_date: string
  /** ISO UTC, or '' */
  call_at: string
  dsp_name: string
  /** snake, as written */
  category: string
  category_label: string
  kind: DailyKind
  response: string
  /** the matched client's name, or '' */
  client: string
  client_match: ClientMatch
  /** the client's name as the note wrote it */
  written_as: string
  shift: DailyShift
}

export type SourceHealth = { ok: boolean; rows: number | null; error: string }

export type DailySourceKey = 'notes' | 'clients' | 'schedule'

export type ClientDaily = {
  client: string
  built_at: string
  version: string
  /** only the rows matched to this client */
  notes: DailyNote[]
  // rows (and distinct spellings) the relay could not place on any client, across the WHOLE book — not this…
  unmatched: Unmatched
  sources: Partial<Record<DailySourceKey, SourceHealth>>
}

/** One spelling of a client's name that no client on file was matched to. */
export type UnmatchedSpelling = { written_as: string; rows: number }

export type Unmatched = {
  rows: number | null
  names: number | null
  /** the spellings with their rows, when the door lists them; null when it only counts */
  spellings: UnmatchedSpelling[] | null
}

/** Why a door refused, so the section can say the right sentence. */
export type DoorReason = 'session' | 'badge' | 'stale' | 'unreadable' | 'restricted'

/** Data, or the relay's refusal in its own words. `status` 0 is "nothing answered". */
export type DailyAnswer<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; reason: DoorReason | ''; message: string }

// ------------------------------------------------------------------ the read…

const DAILY_PATH = '/hub-lanes/clients/daily'

const REASONS: readonly DoorReason[] = ['session', 'badge', 'stale', 'unreadable', 'restricted']

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

const YMD = /^\d{4}-\d{2}-\d{2}$/

const countOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function door<T>(path: string, signal?: AbortSignal): Promise<DailyAnswer<T>> {
  const token = useAuthStore.getState().token
  let res: Response
  try {
    res = await fetch(path, {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') {
      return { ok: false, status: 0, reason: '', message: 'The read was cancelled.' }
    }
    return {
      ok: false,
      status: 0,
      reason: '',
      message: `The server did not answer (${err instanceof Error ? err.message : String(err)}).`,
    }
  }
  // The relay always answers an envelope; nginx in front of a stopped relay answers an HTML page.
  const env = (await res.json().catch(() => null)) as
    | { status?: unknown; data?: unknown; message?: unknown; reason?: unknown }
    | null
  if (!env || typeof env !== 'object') {
    return {
      ok: false,
      status: res.status === 200 ? 502 : res.status,
      reason: '',
      message: `The server answered ${res.status} without a readable envelope — the daily notes door is not reachable right now (a restart, usually); the next read tries again.`,
    }
  }
  const status = Number(env.status ?? res.status)
  if (status !== 200) {
    const reason = REASONS.find((r) => r === env.reason) ?? ''
    return {
      ok: false,
      status: Number.isFinite(status) ? status : res.status,
      reason,
      message: String(env.message || `The server answered ${res.status}.`),
    }
  }
  return { ok: true, data: env.data as T }
}

function shiftOf(raw: unknown): DailyShift {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const via: ShiftVia = s.via === 'schedule' || s.via === 'call_time' ? s.via : 'none'
  return {
    via,
    label: text(s.label).trim(),
    start: text(s.start).trim(),
    end: text(s.end).trim(),
    house: text(s.house).trim(),
    at_client_house: s.at_client_house === true ? true : s.at_client_house === false ? false : null,
    staff_match: s.staff_match === 'exact' || s.staff_match === 'similar' ? s.staff_match : '',
    date: YMD.exec(text(s.date).trim())?.[0] ?? '',
    source: text(s.source).trim(),
    covers_call: s.covers_call === true ? true : s.covers_call === false ? false : null,
  }
}

// THE UNMATCHED BLOCK, whichever shape the door sends: `names` as a count, or as the list of spellings with their…
function unmatchedOf(raw: unknown): Unmatched {
  const u = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (!Array.isArray(u.names)) {
    return { rows: countOrNull(u.rows), names: countOrNull(u.names), spellings: null }
  }
  const spellings: UnmatchedSpelling[] = []
  for (const e of u.names as unknown[]) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const written = typeof o.written_as === 'string' ? o.written_as.trim() : ''
    const rows = countOrNull(o.rows)
    if (written && rows !== null && rows > 0) spellings.push({ written_as: written, rows: Math.floor(rows) })
  }
  return { rows: countOrNull(u.rows), names: u.names.length, spellings }
}

// One note, rebuilt from the contract's fields and nothing else.
function noteOf(raw: unknown): DailyNote | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const day = YMD.exec(text(r.reporting_date).trim())
  return {
    id: text(r.id),
    key: text(r.key).trim(),
    call_id: text(r.call_id).trim(),
    reporting_date: day ? day[0] : '',
    call_at: text(r.call_at).trim(),
    dsp_name: text(r.dsp_name).trim(),
    category: text(r.category).trim(),
    category_label: text(r.category_label).trim(),
    kind: r.kind === 'daily' ? 'daily' : 'not_daily',
    response: text(r.response).trim(),
    client: text(r.client).trim(),
    client_match: r.client_match === 'exact' || r.client_match === 'similar' ? r.client_match : 'none',
    written_as: text(r.written_as).trim(),
    shift: shiftOf(r.shift),
  }
}

function healthOf(raw: unknown): SourceHealth | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const h = raw as Record<string, unknown>
  return { ok: h.ok === true, rows: countOrNull(h.rows), error: text(h.error) }
}

/** One client's notes. A body that is not the contract's shape is said as such. */
export async function readClientDaily(client: string, signal?: AbortSignal): Promise<DailyAnswer<ClientDaily>> {
  const ans = await door<Record<string, unknown>>(`${DAILY_PATH}?client=${encodeURIComponent(client)}`, signal)
  if (!ans.ok) return ans
  const d = ans.data
  if (!d || typeof d !== 'object' || !Array.isArray(d.notes)) {
    return {
      ok: false,
      status: 502,
      reason: '',
      message: 'The server answered, but not with daily notes this screen knows how to read.',
    }
  }
  const sources = (d.sources && typeof d.sources === 'object' ? d.sources : {}) as Record<string, unknown>
  const health: Partial<Record<DailySourceKey, SourceHealth>> = {}
  for (const k of ['notes', 'clients', 'schedule'] as const) {
    const h = healthOf(sources[k])
    if (h) health[k] = h
  }
  return {
    ok: true,
    data: {
      client: text(d.client) || client,
      built_at: text(d.built_at),
      version: text(d.version),
      notes: (d.notes as unknown[]).map(noteOf).filter((n): n is DailyNote => n !== null),
      unmatched: unmatchedOf(d.unmatched),
      sources: health,
    },
  }
}
