// TODAY'S CHAT — what one read, one answer or one stream line does to the open conversation and the rail.
// Pure.

export type ChatLine = {
  id: string
  from_user: string
  from_name: string
  body: string
  created_at: string
  mine?: boolean
  pending?: boolean
  /** when this tab drew it, for a line no read has carried yet */
  local?: number
  /** the conversation a pending or local line was drawn in */
  with?: string
}

export type RailThread = {
  thread_key: string
  with_user: string
  with_name: string
  last: string
  last_at: string
  last_from?: string
  unread: number
  online?: boolean
}

/** Words the chat stream carries for a send the relay kept first: `with_user` is the conversation, as this tab files it. */
export type StreamLine = {
  id: string
  from_user: string
  from_name: string
  body: string
  created_at: string
  mine: boolean
  with_user: string
}

/** How long a local line outlives reads that do not carry it; past this, the sheet's word stands. */
export const LOCAL_KEEP_MS = 10 * 60_000

const byTime = (a: ChatLine, b: ChatLine) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)

/** Delivered lines in time order, then the sends still waiting for their answer. */
function ordered(lines: ChatLine[]): ChatLine[] {
  return [...lines.filter((m) => !m.pending).sort(byTime), ...lines.filter((m) => m.pending)]
}

// A chatMessages answer for `withUser`, merged by id (`whole`: a first read or a reset, which replaces the rows).
export function mergeRead(prev: ChatLine[], arrived: ChatLine[], whole: boolean, now: number, withUser: string):
  { lines: ChatLine[]; cursor: string } {
  const base = whole ? [] : prev.filter((m) => !m.pending && !m.local)
  const byId = new Map<string, ChatLine>()
  for (const m of [...base, ...arrived]) byId.set(m.id, { ...m, local: undefined, pending: undefined, with: undefined })
  const rows = [...byId.values()].sort(byTime)
  const cursor = rows.length ? rows[rows.length - 1].id : ''
  const here = (m: ChatLine) => !m.with || m.with === withUser
  const local = prev.filter((m) => m.local && !m.pending && here(m) && !byId.has(m.id) && now - m.local < LOCAL_KEEP_MS)
  const had = new Set(prev.map((m) => m.id))
  const owed = new Map<string, number>()
  for (const a of arrived) {
    if (a.mine && !had.has(a.id)) owed.set(a.body, (owed.get(a.body) ?? 0) + 1)
  }
  const waiting = prev.filter((m) => {
    if (!m.pending || !here(m)) return false
    const n = owed.get(m.body) ?? 0
    if (n <= 0) return true
    owed.set(m.body, n - 1)
    return false
  })
  return { lines: ordered([...rows, ...local, ...waiting]), cursor }
}

/** A send answered with its row's id and time: the bubble is that message now (unless a line of it is drawn already). */
export function settleSent(prev: ChatLine[], pendingId: string, got: { id: string; created_at: string }, now: number):
  ChatLine[] {
  if (!got.id) return prev
  if (prev.some((m) => m.id === got.id)) return prev.filter((m) => m.id !== pendingId)
  return ordered(prev.map((m) => (m.id === pendingId
    ? { ...m, id: got.id, created_at: got.created_at || m.created_at, pending: undefined, local: now }
    : m)))
}

/** Words the stream brought for the open conversation: drawn once; one of mine takes the place of its own bubble. */
export function pushedLine(prev: ChatLine[], line: StreamLine, now: number): ChatLine[] {
  if (!line.id || prev.some((m) => m.id === line.id)) return prev
  const drawn: ChatLine = { id: line.id, from_user: line.from_user, from_name: line.from_name, body: line.body,
    created_at: line.created_at, mine: line.mine, local: now, with: line.with_user }
  const twin = line.mine ? prev.find((m) => m.pending && m.body === line.body) : undefined
  return ordered([...prev.filter((m) => m !== twin), drawn])
}

/** A kept send Apps Script refused: its line goes; the line itself is answered, for words of mine to go back in the box. */
export function goneFrom(prev: ChatLine[], id: string): { lines: ChatLine[]; gone: ChatLine | null } {
  const gone = prev.find((m) => m.id === id) ?? null
  return { lines: gone ? prev.filter((m) => m !== gone) : prev, gone }
}

// The rail after one line the stream brought: its conversation to the top with its last line, one more unread for a…
export function railAfterLine(threads: RailThread[], line: StreamLine, thread_key: string, reading: boolean): RailThread[] {
  const found = threads.find((t) => t.with_user === line.with_user)
  const last = line.body.slice(0, 140)
  if (found && found.last_at === line.created_at && found.last === last) return threads
  if (found && found.last_at > line.created_at) {
    const unread = found.unread + (!line.mine && !reading ? 1 : 0)
    return unread === found.unread ? threads : threads.map((t) => (t === found ? { ...t, unread } : t))
  }
  const next: RailThread = {
    ...(found ?? { thread_key, with_user: line.with_user, with_name: line.mine ? '' : line.from_name, unread: 0,
      last: '', last_at: '' }),
    last,
    last_at: line.created_at,
    last_from: line.from_user,
    unread: (found?.unread ?? 0) + (!line.mine && !reading ? 1 : 0),
  }
  return [next, ...threads.filter((t) => t.with_user !== line.with_user)]
}

/** A stream line's words, when it carries them whole; null for a line that is only a fact. */
export function streamLineOf(raw: unknown): StreamLine | null {
  const m = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (!str(m.id) || !str(m.with_user) || typeof m.body !== 'string') return null
  return { id: str(m.id), from_user: str(m.from_user), from_name: str(m.from_name), body: str(m.body),
    created_at: str(m.created_at), mine: m.mine === true, with_user: str(m.with_user) }
}
