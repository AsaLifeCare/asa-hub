// LIVE CHAT — what the screen holds: threads, the messages of each conversation, reactions, presence, the unread…
// One store per tab; the connection writes it, My Inbox → Chat reads it.
import { create } from 'zustand'
import * as model from './model'

export type LiveChatState = {
  owns: boolean
  connection: model.ConnectionState
  refused: model.Refusal | null
  /** this person's own ids: the account, the hub's person and folds, and the sheet's `me` */
  me: string[]
  /** the id Apps Script writes for this person (chatOverview `me`): what a reaction carries */
  self: string
  threads: model.LiveThread[]
  people: model.LivePerson[]
  loaded: boolean
  messages: Record<string, model.LiveMessage[]>
  /** per conversation, the `after` of its next read: set by read answers alone (model.readCursor) */
  cursors: Record<string, string>
  reactions: Record<string, model.Reactions>
  presence: Record<string, boolean>
  /** the conversation on screen (a person id), null for none */
  open: string | null
  unread: number
}

type Actions = {
  reset: (owns: boolean, account?: string) => void
  setConnection: (c: model.ConnectionState) => void
  setRefused: (r: model.Refusal | null) => void
  setOpen: (withUser: string | null) => void
  addMe: (ids: string[]) => void
  /** `seeing`: the conversation on screen right now — its unread is this tab's to mark, never a count to show */
  applyOverview: (data: { me?: string; live_ids?: string[]; threads?: model.LiveThread[]; people?: model.LivePerson[] },
    seeing?: string | null) => void
  /** `settled`: client ids of waiting lines this read found delivered; `fresh`: lines from the other end it added */
  applyMessages: (withUser: string, data: { messages?: model.WireMessage[]; reset?: boolean; reactions?: model.Reactions },
    incremental: boolean) => { settled: string[]; fresh: number }
  addPending: (withUser: string, msg: model.LiveMessage) => void
  confirm: (withUser: string, clientId: string, got: { id: string; created_at: string }) => void
  /** `unsure`: nobody could say whether it landed — said "not confirmed", never "not sent" */
  fail: (withUser: string, clientId: string, why: string, unsure?: boolean) => void
  retry: (withUser: string, clientId: string) => void
  incoming: (msg: model.LiveMessage, countsUnread: boolean) => void
  /** Words from the other end the sheet never took: their line goes; `uncount`, the thread that counted it */
  retract: (clientId: string, uncount: string | null) => void
  /** A kept send Apps Script refused (`why`) or filed under another id: model.goneLine, in every conversation */
  gone: (id: string, clientId: string, why: string) => void
  readHere: (withUser: string) => void
  readThere: (withUser: string, at: string) => void
  setReactions: (withUser: string, messageId: string, reactions: Record<string, string[]> | null) => void
  toggleReaction: (withUser: string, messageId: string, emoji: string) => model.Reactions
  restoreReactions: (withUser: string, reactions: model.Reactions) => void
  setPresence: (userId: string, online: boolean) => void
}

const EMPTY: LiveChatState = {
  owns: false,
  connection: 'idle',
  refused: null,
  me: [],
  self: '',
  threads: [],
  people: [],
  loaded: false,
  messages: {},
  cursors: {},
  reactions: {},
  presence: {},
  open: null,
  unread: 0,
}

export const useChatLiveStore = create<LiveChatState & Actions>((set, get) => ({
  ...EMPTY,
  reset: (owns, account = '') => set({ ...EMPTY, owns, me: account ? [account] : [], self: account }),
  setConnection: (connection) => set({ connection }),
  setRefused: (refused) => set(refused ? { refused, connection: 'refused' } : { refused: null }),
  setOpen: (open) => set({ open }),
  addMe: (ids) => set((s) => ({ me: [...new Set([...s.me, ...ids.filter(Boolean)])] })),
  applyOverview: (data, seeing = null) => set((s) => {
    const me = [...new Set([...s.me, ...(data.live_ids ?? []), ...(data.me ? [data.me] : [])].filter(Boolean))]
    const counted = (data.threads ?? []).map((t) => ({ ...t, unread: Math.max(0, Number(t.unread) || 0) }))
    const threads = seeing ? model.threadRead(counted, seeing) : counted
    return {
      me, self: data.me || s.self, threads, people: data.people ?? [], loaded: true, unread: model.unreadTotal(threads),
    }
  }),
  applyMessages: (withUser, data, incremental) => {
    const s = get()
    const rows = data.messages ?? []
    const arrived = rows.map((m) => model.fromWire(m, s.me))
    const before = s.messages[withUser] ?? []
    const whole = !incremental || Boolean(data.reset)
    const list = model.mergeServer(before, arrived, whole)
    set({
      messages: { ...s.messages, [withUser]: list },
      cursors: { ...s.cursors, [withUser]: model.readCursor(s.cursors[withUser] ?? '', rows, whole) },
      reactions: { ...s.reactions, [withUser]: data.reactions ?? s.reactions[withUser] ?? {} },
    })
    const had = new Set(before.map((m) => m.id))
    return {
      settled: model.settledClientIds(before, list),
      fresh: list.filter((m) => !m.mine && m.status === 'sent' && !had.has(m.id)).length,
    }
  },
  addPending: (withUser, msg) => set((s) => ({
    messages: { ...s.messages, [withUser]: model.addPending(s.messages[withUser] ?? [], msg) },
    threads: model.threadsAfter(s.threads, msg, false),
  })),
  confirm: (withUser, clientId, got) => set((s) => ({
    messages: { ...s.messages, [withUser]: model.confirmSent(s.messages[withUser] ?? [], clientId, got) },
  })),
  fail: (withUser, clientId, why, unsure = false) => set((s) => ({
    messages: { ...s.messages, [withUser]: model.failSent(s.messages[withUser] ?? [], clientId, why, unsure) },
  })),
  retry: (withUser, clientId) => set((s) => ({
    messages: { ...s.messages, [withUser]: model.retrySent(s.messages[withUser] ?? [], clientId) },
  })),
  incoming: (msg, countsUnread) => set((s) => {
    const other = model.otherOf(msg)
    const known = s.messages[other]
    // the same line pushed again (a Retry handed the receipt back, and the hub told both ends once more)
    if (known && model.alreadyDrawn(known, msg)) return s
    let messages = s.messages
    // words drawn on their way under another id for their sender: the sheet's row names the conversation
    if (msg.status === 'sent' && msg.client_id) {
      for (const [withUser, list] of Object.entries(s.messages)) {
        if (withUser !== other && list.some((m) => m.client_id === msg.client_id && m.status !== 'sent')) {
          messages = { ...messages, [withUser]: list.filter((m) => m.client_id !== msg.client_id) }
        }
      }
    }
    const threads = model.threadsAfter(s.threads, msg, countsUnread)
    return {
      threads,
      unread: model.unreadTotal(threads),
      // a conversation never opened is read whole when it is; only an open one is kept up line by line
      messages: known ? { ...messages, [other]: model.applyIncoming(known, msg) } : messages,
    }
  }),
  retract: (clientId, uncount) => set((s) => {
    let messages = s.messages
    let removed = false
    for (const [withUser, list] of Object.entries(s.messages)) {
      const next = model.retractLine(list, clientId)
      if (next.length !== list.length) {
        messages = { ...messages, [withUser]: next }
        removed = true
      }
    }
    // counted where it was drawn, or in a conversation not drawn here at all
    const threads = uncount && (removed || !s.messages[uncount]) ? model.threadUncount(s.threads, uncount) : s.threads
    return { messages, threads, unread: model.unreadTotal(threads) }
  }),
  gone: (id, clientId, why) => set((s) => {
    let messages = s.messages
    for (const [withUser, list] of Object.entries(s.messages)) {
      const next = model.goneLine(list, id, clientId, why)
      if (next.length !== list.length || next.some((m, i) => m !== list[i])) messages = { ...messages, [withUser]: next }
    }
    return { messages }
  }),
  readHere: (withUser) => set((s) => {
    const threads = model.threadRead(s.threads, withUser)
    return { threads, unread: model.unreadTotal(threads) }
  }),
  readThere: (withUser, at) => set((s) => (s.messages[withUser]
    ? { messages: { ...s.messages, [withUser]: model.receiptRead(s.messages[withUser], at) } }
    : {})),
  setReactions: (withUser, messageId, reactions) => set((s) => ({
    reactions: { ...s.reactions, [withUser]: { ...(s.reactions[withUser] ?? {}), [messageId]: reactions ?? {} } },
  })),
  toggleReaction: (withUser, messageId, emoji) => {
    const before = get().reactions[withUser] ?? {}
    const me = get().self
    set((s) => ({ reactions: { ...s.reactions, [withUser]: model.toggleReaction(before, messageId, emoji, me) } }))
    return before
  },
  restoreReactions: (withUser, reactions) => set((s) => ({ reactions: { ...s.reactions, [withUser]: reactions } })),
  setPresence: (userId, online) => set((s) => ({ presence: { ...s.presence, [userId]: online } })),
}))

/** Read by the shell's beat and stream, outside React. */
export function liveOwnsChat(): boolean {
  return useChatLiveStore.getState().owns
}
