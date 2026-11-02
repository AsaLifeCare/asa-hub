// LIVE CHAT — the pure half: what one frame or one answer does to what the screen holds.
// No network, no timers; the store (./store) applies these, the connection (./connection) feeds them.

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'refused'
/** Why live chat is not running for this session: the ticket door's answer, or the page that could not load. */
export type Refusal = 'session' | 'acting' | 'access' | 'visit' | 'unavailable'

export type LiveMessage = {
  id: string
  from_user: string
  from_name: string
  to_user?: string
  body: string
  created_at: string
  read_at?: string
  mine: boolean
  client_id?: string
  status: 'sent' | 'pending' | 'failed'
  why?: string
  /** failed without knowing whether the row landed: said "not confirmed", and its Retry (same client id) checks */
  unsure?: boolean
}

export type LiveThread = {
  thread_key: string
  with_user: string
  with_name: string
  last: string
  last_at: string
  last_from?: string
  unread: number
  online?: boolean
}

export type LivePerson = { user_id: string; name: string; title?: string; avatar?: string; online?: boolean }
export type Reactions = Record<string, Record<string, string[]>>

// A message as Apps Script lists it (chatMessages: from_user, to_user, created_at) or the hub pushes it (`message`…
export type WireMessage = {
  id?: unknown
  thread_key?: unknown
  from_user?: unknown
  from?: unknown
  from_name?: unknown
  to_user?: unknown
  to?: unknown
  body?: unknown
  created_at?: unknown
  at?: unknown
  read_at?: unknown
  mine?: unknown
  client_id?: unknown
  state?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function newClientId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

// A wire message, judged mine by the caller's own ids (person, folded accounts, the sheet's `me`).
export function fromWire(raw: WireMessage, myIds: readonly string[]): LiveMessage {
  const from = str(raw.from_user) || str(raw.from)
  const clientId = str(raw.client_id)
  const sending = raw.state === 'sending'
  return {
    id: str(raw.id) || (sending && clientId ? `pending-${clientId}` : ''),
    from_user: from,
    from_name: str(raw.from_name),
    to_user: str(raw.to_user) || str(raw.to) || undefined,
    body: str(raw.body),
    created_at: str(raw.created_at) || str(raw.at),
    read_at: str(raw.read_at) || undefined,
    mine: typeof raw.mine === 'boolean' ? raw.mine : myIds.includes(from),
    client_id: clientId || undefined,
    status: sending ? 'pending' : 'sent',
  }
}

const byTime = (a: LiveMessage, b: LiveMessage) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)

/** Whoever is not me in a message: the conversation it belongs to. */
export function otherOf(msg: Pick<LiveMessage, 'from_user' | 'to_user' | 'mine'>): string {
  return msg.mine ? str(msg.to_user) : msg.from_user
}

export function addPending(list: LiveMessage[], msg: LiveMessage): LiveMessage[] {
  return [...list, { ...msg, status: 'pending', why: undefined }]
}

/** The hub confirmed a send: the pending line takes the sheet's id and time — unless that copy already arrived. */
export function confirmSent(list: LiveMessage[], clientId: string, got: { id: string; created_at: string }): LiveMessage[] {
  if (got.id && list.some((m) => m.id === got.id && m.client_id !== clientId)) {
    return list.filter((m) => m.client_id !== clientId || m.id === got.id)
  }
  return list
    .map((m) => (m.client_id === clientId
      ? { ...m, id: got.id || m.id, created_at: got.created_at || m.created_at, status: 'sent' as const, why: undefined, unsure: undefined }
      : m))
    .sort(byTime)
}

/** `unsure`: nobody could say whether the row landed (the hub's `unconfirmed`, or no answer at all). */
export function failSent(list: LiveMessage[], clientId: string, why: string, unsure = false): LiveMessage[] {
  return list.map((m) => (m.client_id === clientId && m.status !== 'sent'
    ? { ...m, status: 'failed' as const, why, unsure: unsure || undefined }
    : m))
}

// What a failed line says: "not sent" only when it surely was not (refused, or never left); otherwise "not…
export function failedWords(m: Pick<LiveMessage, 'unsure' | 'why'>): { mark: string; line: string; retryTitle: string } {
  const head = m.unsure ? 'Not confirmed' : 'Not sent'
  return {
    mark: head.toLowerCase(),
    line: m.why ? `${head} — ${m.why}` : head,
    retryTitle: m.unsure ? 'Sends it again under the same id: if it already landed, it is not sent twice' : 'Send it again',
  }
}

export function retrySent(list: LiveMessage[], clientId: string): LiveMessage[] {
  return list.map((m) => (m.client_id === clientId && m.status === 'failed'
    ? { ...m, status: 'pending' as const, why: undefined, unsure: undefined }
    : m))
}

// A pushed message: a sheet row replaces its own pending line, is drawn once, and lands in time order.
export function applyIncoming(list: LiveMessage[], msg: LiveMessage): LiveMessage[] {
  const twin = msg.client_id ? list.find((m) => m.client_id === msg.client_id) : undefined
  if (twin) {
    if (msg.status !== 'sent') {
      return twin.status === 'failed'
        ? list.map((m) => (m === twin ? { ...m, status: 'pending' as const, why: undefined, unsure: undefined } : m))
        : list
    }
    const kept = list.filter((m) => m.client_id !== msg.client_id && m.id !== msg.id)
    return [...kept, { ...msg, status: 'sent' as const }].sort(byTime)
  }
  if (msg.id && list.some((m) => m.id === msg.id)) return list
  return [...list, msg].sort(byTime)
}

/** Words from the other end the sheet never took: their line goes. A line already delivered stays. */
export function retractLine(list: LiveMessage[], clientId: string): LiveMessage[] {
  return list.filter((m) => !(m.client_id === clientId && !m.mine && m.status === 'pending'))
}

// A send the relay kept and answered, that Apps Script then refused (`why`) or filed under another id (no `why`…
export function goneLine(list: LiveMessage[], id: string, clientId: string, why: string): LiveMessage[] {
  const hit = (m: LiveMessage) => (Boolean(id) && m.id === id) || (Boolean(clientId) && m.client_id === clientId)
  return list.flatMap((m) => {
    if (!hit(m)) return [m]
    if (why && m.mine) return [{ ...m, status: 'failed' as const, why, unsure: undefined }]
    return []
  })
}

/** A pushed line this conversation already shows as delivered, by its id or its client id: it moves nothing again. */
export function alreadyDrawn(list: readonly LiveMessage[], msg: Pick<LiveMessage, 'id' | 'client_id'>): boolean {
  return list.some((m) => m.status === 'sent'
    && ((Boolean(msg.id) && m.id === msg.id) || (Boolean(msg.client_id) && m.client_id === msg.client_id)))
}

/** How far the sheet's clock may sit behind the tab's when a line typed here is matched to the sheet's copy. */
export const PENDING_SKEW_MS = 15 * 60_000
// The same for words from the other end drawn on their way: stamped by the hub's clock as they arrived, and…
export const ON_ITS_WAY_SKEW_MS = 60_000

// A chatMessages answer: merged by id (a reset replaces the thread); pending and failed lines survive unless the…
export function mergeServer(list: LiveMessage[], arrived: LiveMessage[], reset: boolean): LiveMessage[] {
  const known = new Set(list.filter((m) => m.status === 'sent').map((m) => m.id))
  let waiting = list.filter((m) => m.status !== 'sent')
  const claimed = arrived.map((m) => {
    if (known.has(m.id) || waiting.length === 0) return m
    const landed = Date.parse(m.created_at)
    const twin = waiting.find((w) => w.mine === m.mine && w.body === m.body && (m.mine || w.from_user === m.from_user)
      && (!Number.isFinite(landed) || Date.parse(w.created_at) - (m.mine ? PENDING_SKEW_MS : ON_ITS_WAY_SKEW_MS) <= landed))
    if (!twin) return m
    waiting = waiting.filter((w) => w !== twin)
    return { ...m, client_id: twin.client_id }
  })
  const base = reset ? [] : list.filter((m) => m.status === 'sent')
  const byId = new Map<string, LiveMessage>()
  for (const m of [...base, ...claimed]) byId.set(m.id, { ...(byId.get(m.id) ?? {}), ...m, status: 'sent', why: undefined })
  const merged = [...byId.values()].sort(byTime)
  const ids = new Set(merged.map((m) => m.id))
  return [...merged, ...waiting.filter((m) => !ids.has(m.id))]
}

/** The client ids of waiting lines a merge settled: their timers stop. */
export function settledClientIds(before: LiveMessage[], after: LiveMessage[]): string[] {
  const now = new Map(after.filter((m) => m.client_id).map((m) => [m.client_id!, m.status]))
  return before
    .filter((m) => m.status !== 'sent' && m.client_id && now.get(m.client_id) === 'sent')
    .map((m) => m.client_id!)
}

// The `after` of a thread's next read: the last row a chatMessages answer carried (Chat.gs lists rows in sheet…
export function readCursor(before: string, arrived: readonly WireMessage[], whole: boolean): string {
  for (let i = arrived.length - 1; i >= 0; i--) {
    const id = str(arrived[i]?.id)
    if (id) return id
  }
  return whole ? '' : before
}

// The rail after one message: the thread moves to the top with its last line, and counts one more unread only for a…
export function threadsAfter(threads: LiveThread[], msg: LiveMessage, countsUnread: boolean): LiveThread[] {
  const other = otherOf(msg)
  if (!other) return threads
  const found = threads.find((t) => t.with_user === other)
  const next: LiveThread = {
    ...(found ?? { thread_key: '', with_user: other, with_name: msg.mine ? '' : msg.from_name, unread: 0, last: '', last_at: '' }),
    last: msg.body.slice(0, 140),
    last_at: msg.created_at || found?.last_at || '',
    last_from: msg.from_user,
    unread: (found?.unread ?? 0) + (countsUnread ? 1 : 0),
  }
  if (!next.with_name && !msg.mine) next.with_name = msg.from_name
  return [next, ...threads.filter((t) => t.with_user !== other)]
}

/** A thread's last line as a notification's key: one line is announced once, however it arrived. */
export function arrivalKey(withUser: string, at: string): string {
  return `${withUser}\n${at}`
}

/** A line that landed this long ago still rings on a tab's first read; an older one is primed silently. */
export const FRESH_MS = 3 * 60_000

// The threads an Overview shows a new line in from somebody else: its unread count rose over what this tab held, or…
export function arrivals(before: LiveThread[] | null, after: LiveThread[], myIds: readonly string[], now: number,
  seeing: string | null): LiveThread[] {
  const had = new Map((before ?? []).map((t) => [t.with_user, Math.max(0, Number(t.unread) || 0)]))
  return after.filter((t) => {
    const unread = Math.max(0, Number(t.unread) || 0)
    if (!t.with_user || t.with_user === seeing || unread === 0) return false
    if (t.last_from && myIds.includes(t.last_from)) return false
    if (before === null) {
      const age = now - Date.parse(t.last_at || '')
      return Number.isFinite(age) && age < FRESH_MS
    }
    return unread > (had.get(t.with_user) ?? 0)
  })
}

export function unreadTotal(threads: LiveThread[]): number {
  return threads.reduce((n, t) => n + Math.max(0, Number(t.unread) || 0), 0)
}

/** A line counted as unread that never became a row (retracted): the thread counts one less. */
export function threadUncount(threads: LiveThread[], withUser: string): LiveThread[] {
  return threads.map((t) => (t.with_user === withUser && t.unread > 0 ? { ...t, unread: t.unread - 1 } : t))
}

/** Read on this side (this tab or another of mine): the thread's count goes to nothing. */
export function threadRead(threads: LiveThread[], withUser: string): LiveThread[] {
  return threads.map((t) => (t.with_user === withUser && t.unread ? { ...t, unread: 0 } : t))
}

/** Read on the other side: my lines to them carry the time they read them. */
export function receiptRead(list: LiveMessage[], at: string): LiveMessage[] {
  return list.map((m) => (m.mine && m.status === 'sent' && !m.read_at ? { ...m, read_at: at || new Date().toISOString() } : m))
}

/** The optimistic flip the server will make: my id under this emoji, or taken away. */
export function toggleReaction(reactions: Reactions, messageId: string, emoji: string, me: string): Reactions {
  const forMsg = { ...(reactions[messageId] ?? {}) }
  const ids = forMsg[emoji] ? [...forMsg[emoji]] : []
  const at = ids.indexOf(me)
  if (at === -1) ids.push(me)
  else ids.splice(at, 1)
  if (ids.length) forMsg[emoji] = ids
  else delete forMsg[emoji]
  return { ...reactions, [messageId]: forMsg }
}

/** Presence from the hub, over what the sheet said: a person with a live tab is online. */
export function withPresence<T extends { online?: boolean }>(rows: T[], idOf: (row: T) => string,
  presence: Record<string, boolean>): T[] {
  return rows.map((r) => {
    const live = presence[idOf(r)]
    return live === undefined ? r : { ...r, online: live }
  })
}

/** A HubException's kind and sentence, for the line under a failed bubble. */
export function sentenceOf(error: unknown): string {
  const text = error instanceof Error ? error.message : str(error)
  return text || 'The message was not sent.'
}
