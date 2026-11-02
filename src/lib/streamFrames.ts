/** Routes a chat-stream frame; only chat arrivals reach the chat listeners, unknown kinds are ignored. */
export type FrameRoute = 'notice' | 'refused' | 'hub' | 'chat' | 'ignore'

/** The frames that ARE chat. Anything else is not a message. */
export const CHAT_FRAME_KINDS: ReadonlySet<string> = new Set(['chatSend', 'chatReact'])

export function frameRoute(msg: unknown): FrameRoute {
  if (!msg || typeof msg !== 'object') return 'ignore'
  const kind = String((msg as { kind?: unknown }).kind ?? '')
  if (kind === 'notice') return 'notice'
  if (kind === 'write_refused') return 'refused'
  if (kind === 'hub') return 'hub'
  return CHAT_FRAME_KINDS.has(kind) ? 'chat' : 'ignore'
}

// A WRITE REFUSED AFTER IT WAS ACCEPTED, as the relay tells it (`write_refused`): the action, the rows it wrote by…
export type WriteRefused = { action: string; resource: string; rows: string[]; why: string; edits?: string[] }
const refusedListeners = new Set<(msg: WriteRefused) => void>()

export function onWriteRefused(fn: (msg: WriteRefused) => void): () => void {
  refusedListeners.add(fn)
  return () => { refusedListeners.delete(fn) }
}

/** Hands a refusal frame to every listener; a listener that throws never stops the next. */
export function tellWriteRefused(msg: unknown): WriteRefused {
  const m = (msg && typeof msg === 'object' ? msg : {}) as Record<string, unknown>
  const told: WriteRefused = {
    action: String(m.action ?? ''),
    resource: String(m.resource ?? ''),
    rows: Array.isArray(m.rows) ? m.rows.map((r) => String(r)).filter(Boolean) : [],
    why: String(m.why ?? ''),
  }
  // the relay's overlay entries the refusal rolled back (server/edit_overlay.py)
  const edits = Array.isArray(m.edits) ? m.edits.map((r) => String(r)).filter(Boolean) : []
  if (edits.length) told.edits = edits
  for (const fn of [...refusedListeners]) {
    try { fn(told) } catch { /* one screen's trouble is not the stream's */ }
  }
  return told
}
