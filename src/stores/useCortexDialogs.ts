// EVERY CONVERSATION THE CORTEX HAS HAD WITH A PERSON, kept per person and per dialog: 100% of the messages are…
// What was there before: a session id minted on mount and written to storage only by the Reset button, and the…
import { create } from 'zustand'

export type CortexTurn = { role: 'user' | 'assistant'; text: string; pending?: boolean }

/** What the relay answers with — its own shape, never assumed to be ours. */
type ServerDialog = { id: string; title?: string; turns?: number; at?: string; started_at?: string }
type ServerTurn = { role?: string; text?: string; at?: string }

export type CortexDialog = {
  id: string
  /** the first thing the person said — what a list needs to be readable */
  title: string
  turns: CortexTurn[]
  /** ISO, stamped on every write; the list is newest first */
  at: string
}

// How many dialogs a person keeps.
const KEEP = 40

const shelfKey = (uid: string) => `asa-cortex-dialogs:${uid}`

function read(uid: string): CortexDialog[] {
  if (!uid) return []
  try {
    const raw = localStorage.getItem(shelfKey(uid))
    const list = raw ? (JSON.parse(raw) as CortexDialog[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(uid: string, list: CortexDialog[]): void {
  if (!uid) return
  try {
    localStorage.setItem(shelfKey(uid), JSON.stringify(list.slice(0, KEEP)))
  } catch {
    /* a history we cannot store is a history that lasts the visit — never an error */
  }
}

type State = {
  uid: string
  dialogs: CortexDialog[]
  /** Load this person's shelf. Cheap, and idempotent per uid. */
  hydrate: (uid: string) => void
  /** Save (or update) one dialog. Called after every completed turn. */
  remember: (uid: string, id: string, turns: CortexTurn[]) => void
  /** The turns of one dialog, for reopening it. */
  turnsOf: (id: string) => CortexTurn[]
  /** Drop one dialog from the shelf. */
  forget: (uid: string, id: string) => void
  // The person's dialogs FROM THE SERVER, merged over the local shelf.
  sync: (uid: string, token: string) => Promise<void>
  /** The turns of one dialog from the server, written into the shelf. */
  pull: (uid: string, token: string, id: string) => Promise<CortexTurn[]>
}

export const useCortexDialogs = create<State>((set, get) => ({
  uid: '',
  dialogs: [],
  hydrate: (uid) => {
    if (!uid || get().uid === uid) return
    set({ uid, dialogs: read(uid) })
  },
  remember: (uid, id, turns) => {
    if (!uid || !id) return
    // a dialog with nothing said in it is not a dialog
    const said = turns.filter((t) => t.text.trim() && !t.pending)
    if (!said.length) return
    const title = (said.find((t) => t.role === 'user')?.text ?? said[0].text).slice(0, 80)
    const at = new Date().toISOString()
    const rest = get().dialogs.filter((d) => d.id !== id)
    const next = [{ id, title, turns: said, at }, ...rest].slice(0, KEEP)
    set({ uid, dialogs: next })
    write(uid, next)
  },
  turnsOf: (id) => get().dialogs.find((d) => d.id === id)?.turns ?? [],
  sync: async (uid, token) => {
    if (!uid || !token) return
    try {
      const res = await fetch('/cortex/chat/dialogs', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) return
      const body = (await res.json()) as { data?: { dialogs?: ServerDialog[] } }
      const remote = body?.data?.dialogs ?? []
      if (!Array.isArray(remote)) return
      const local = get().dialogs
      const held = new Map(local.map((d) => [d.id, d]))
      const merged: CortexDialog[] = remote.map((r) => ({
        id: String(r.id),
        title: String(r.title || held.get(String(r.id))?.title || 'Conversation'),
        turns: held.get(String(r.id))?.turns ?? [],
        at: String(r.at || held.get(String(r.id))?.at || new Date().toISOString()),
      }))
      // A dialog the browser holds and the server has not seen yet — the turn in flight right now — must not vanish…
      const seen = new Set(merged.map((d) => d.id))
      for (const d of local) if (!seen.has(d.id)) merged.push(d)
      merged.sort((a, b) => (a.at < b.at ? 1 : -1))
      set({ uid, dialogs: merged })
      write(uid, merged)
    } catch {
      /* the shelf is what it was — a history we cannot reach is not an error */
    }
  },
  pull: async (uid, token, id) => {
    if (!uid || !token || !id) return get().turnsOf(id)
    try {
      const res = await fetch(`/cortex/chat/dialogs/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) return get().turnsOf(id)
      const body = (await res.json()) as { data?: { turns?: ServerTurn[] } }
      const turns: CortexTurn[] = (body?.data?.turns ?? [])
        .filter((t) => String(t?.text ?? '').trim())
        .map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', text: String(t.text) }))
      if (!turns.length) return get().turnsOf(id)
      const rest = get().dialogs.filter((d) => d.id !== id)
      const had = get().dialogs.find((d) => d.id === id)
      const next = [{
        id,
        title: had?.title ?? turns.find((t) => t.role === 'user')?.text.slice(0, 80) ?? 'Conversation',
        turns,
        at: had?.at ?? new Date().toISOString(),
      }, ...rest].sort((a, b) => (a.at < b.at ? 1 : -1))
      set({ dialogs: next })
      write(uid, next)
      return turns
    } catch {
      return get().turnsOf(id)
    }
  },
  forget: (uid, id) => {
    const next = get().dialogs.filter((d) => d.id !== id)
    set({ dialogs: next })
    write(uid, next)
  },
}))
