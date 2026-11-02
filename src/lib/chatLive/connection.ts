// LIVE CHAT'S CONNECTION — one per tab, loaded on demand by ./shell for a session App Control gives live chat.
// A ticket from the relay (POST /snapshot/chat-ticket, behind the same gate as every relay door) opens the hub at…
import { useChatPresenceStore } from '@/lib/chatPresence'
import { lookingAtConversation } from '@/lib/routeNow'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { MY_INBOX_APP_ID } from '@/registry/apps-myinbox'
import * as model from './model'
import { HubCallError, HubClient } from './signalr'
import { useChatLiveStore } from './store'

export const HUB_URL = '/chat-hub/live'
export const TICKET_URL = '/snapshot/chat-ticket'
export const RECONNECT_MS = [0, 2_000, 5_000, 10_000, 30_000] as const
export const FOREVER_MS = 60_000
export const READ_AFTER_MS = 1_500
/** how long a call waits for a connection that is coming back before it says so */
const WAIT_LIVE_MS = 10_000
/** past the hub's own send deadline (five minutes): a line nobody answered for says so */
const SEND_UNANSWERED_MS = 6 * 60_000

export function reconnectDelay(attempt: number): number {
  return attempt < RECONNECT_MS.length ? RECONNECT_MS[attempt] : FOREVER_MS
}

// The ticket door's refusals that no retry can change; anything else is tried again.
export function refusalOf(status: number, reason: string): model.Refusal | null {
  if (status === 409) return 'acting'
  if (status === 403) return 'access'
  if (status === 400 && reason === 'member') return 'visit'
  return null
}

/** A call that never reached the hub (no live connection in time): whatever it carried was not sent. */
export class NotSent extends Error {}

// A ticket door that could not answer (a relay restarting: 401, 503, 504 for a few seconds) is asked again this…
export const REAUTH_RETRY_MS = [2_000, 5_000, 10_000, 20_000] as const

export class TicketRefused extends Error {
  readonly status: number
  readonly refusal: model.Refusal | null

  constructor(status: number, refusal: model.Refusal | null, message: string) {
    super(message)
    this.status = status
    this.refusal = refusal
  }
}

export async function fetchTicket(token: string, tenant: string): Promise<string> {
  const res = await fetch(TICKET_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Hub-Tenant': tenant, 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  })
  let body: { reason?: string; message?: string; data?: { ticket?: string } } = {}
  try {
    body = await res.json()
  } catch { /* not the relay's answer: tried again */ }
  const ticket = res.ok ? String(body.data?.ticket ?? '') : ''
  if (ticket) return ticket
  throw new TicketRefused(res.status, refusalOf(res.status, String(body.reason ?? '')),
    String(body.message ?? `the ticket door answered ${res.status}`))
}

export type LiveApi = {
  overview: () => Promise<void>
  open: (withUser: string | null) => void
  refresh: () => Promise<void>
  send: (withUser: string, body: string) => void
  retry: (withUser: string, clientId: string) => void
  react: (withUser: string, messageId: string, emoji: string) => Promise<void>
  markRead: (withUser: string) => void
  stop: () => void
}

type Overview = { me?: string; live_ids?: string[]; threads?: model.LiveThread[]; people?: model.LivePerson[] }
/** One line said as an arrival: the shell's `latest`, and what a notification is made from. */
type Arrival = { id: string; at: string; from_user: string; from_name: string; body: string }
type Messages = { messages?: model.WireMessage[]; reset?: boolean; reactions?: model.Reactions }

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

export function startLive(session: { token: string; account: string; tenant: string }): LiveApi {
  const store = useChatLiveStore
  let stopped = false
  let client: HubClient | null = null
  let wakeUp: (() => void) | null = null
  const readTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let overviewTimer: ReturnType<typeof setTimeout> | undefined
  let latest: Arrival | null = null

  const ticket = () => fetchTicket(session.token, session.tenant)

  /** the shell's badge and My Inbox's `Chat · n` read the chat presence store; this keeps it true */
  const mirror = () => {
    const unread = store.getState().unread
    if (unread <= 0) latest = null
    useChatPresenceStore.getState().setState(unread, latest)
  }
  const unmirror = store.subscribe((s, prev) => { if (s.unread !== prev.unread) mirror() })

  const pause = (ms: number) => new Promise<void>((resolve) => {
    const t = setTimeout(() => { wakeUp = null; resolve() }, ms)
    wakeUp = () => { clearTimeout(t); wakeUp = null; resolve() }
  })

  const refuse = (why: model.Refusal) => {
    store.getState().setRefused(why)
    if (why === 'access') store.setState({ owns: false })   // the server says no: today's chat stands in
  }

  const waitLive = async (): Promise<HubClient> => {
    if (client && client.state === 'connected') return client
    return new Promise<HubClient>((resolve, reject) => {
      const t = setTimeout(() => { off(); reject(new NotSent('Live chat is reconnecting — try again in a moment.')) }, WAIT_LIVE_MS)
      const off = store.subscribe((s) => {
        if (s.connection === 'live' && client && client.state === 'connected') {
          clearTimeout(t)
          off()
          resolve(client)
        } else if (s.connection === 'refused') {
          clearTimeout(t)
          off()
          reject(new NotSent('Live chat is off for this session.'))
        }
      })
    })
  }

  // A new ticket on the same socket, after the relay forgot this session's ref (it restarted).
  let renewing: { c: HubClient; done: Promise<boolean> } | null = null
  let renewTimer: ReturnType<typeof setTimeout> | undefined
  let renewWake: (() => void) | null = null
  const renewPause = (ms: number) => new Promise<void>((resolve) => {
    renewWake = () => { clearTimeout(renewTimer); renewWake = null; resolve() }
    renewTimer = setTimeout(() => { renewWake = null; resolve() }, ms)
  })
  const renew = async (c: HubClient): Promise<boolean> => {
    for (let attempt = 0; ; attempt++) {
      if (stopped || client !== c || c.state !== 'connected') return false
      try {
        await c.invoke('Reauth', await ticket())
        return true
      } catch (e) {
        if (e instanceof TicketRefused && e.refusal) {
          refuse(e.refusal)
          void c.stop()
          return false
        }
        if (attempt >= REAUTH_RETRY_MS.length) return false
        await renewPause(REAUTH_RETRY_MS[attempt])
      }
    }
  }
  const reauth = (): Promise<boolean> => {
    const c = client
    if (!c) return Promise.resolve(false)
    if (renewing?.c === c) return renewing.done
    const mine = { c, done: renew(c) }
    renewing = mine
    void mine.done.finally(() => { if (renewing === mine) renewing = null })
    return mine.done
  }

  const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
    const c = await waitLive()
    try {
      return await c.invoke<T>(method, ...args)
    } catch (e) {
      if (e instanceof HubCallError && e.kind === 'reauth' && (await reauth())) {
        return (client ?? c).invoke<T>(method, ...args)
      }
      throw e
    }
  }

  // One arrival said once, whichever way it came: a hub `message` frame (a sender on live chat) or an Overview that…
  const announced = new Set<string>()
  const announce = (a: Arrival): string | null => {
    latest = { ...a, body: a.body.slice(0, 140) }
    mirror()
    if (lookingAtConversation(a.from_user, useChatPresenceStore.getState().viewing)) return null
    return useNotificationStore.getState().push({
      type: 'mention',
      appId: MY_INBOX_APP_ID,
      title: `${a.from_name || 'Somebody'} sent you a message`,
      body: a.body.slice(0, 140),
      priority: 'high',
      href: `/app/${MY_INBOX_APP_ID}/chat?with=${encodeURIComponent(a.from_user)}`,
    })
  }

  // The rail.
  const overview = async (opts: { catchUp?: boolean } = {}): Promise<boolean> => {
    const data = await call<Overview>('Overview')
    const s = store.getState()
    const before = s.loaded ? s.threads : null
    const seeing = s.open && visible() ? s.open : null
    s.applyOverview(data ?? {}, seeing)
    const unreadOnScreen = Boolean(seeing)
      && (data?.threads ?? []).some((t) => t.with_user === seeing && Number(t.unread) > 0)
    if (seeing && unreadOnScreen && opts.catchUp !== false && !readTimers.has(seeing)) {
      void messages(seeing, true)
        .then(() => { if (store.getState().open === seeing && visible()) readSoon(seeing) })
        .catch(() => { /* the next nudge, frame or connect reads it */ })
    }
    const now = store.getState()
    const rose = model.arrivals(before, now.threads, now.me, Date.now(), seeing)
      .sort((a, b) => (a.last_at < b.last_at ? -1 : a.last_at > b.last_at ? 1 : 0))
    for (const t of rose) {
      const key = model.arrivalKey(t.with_user, t.last_at)
      if (announced.has(key)) continue
      announced.add(key)
      announce({ id: key, at: t.last_at, from_user: t.with_user, from_name: t.with_name, body: t.last })
    }
    mirror()
    return unreadOnScreen
  }

  /** `incremental`: from the thread's read cursor (the last row a read carried), whatever was pushed since */
  const messages = async (withUser: string, incremental: boolean) => {
    const after = incremental ? store.getState().cursors[withUser] ?? '' : ''
    const data = await call<Messages>('Messages', withUser, after || null)
    const got = store.getState().applyMessages(withUser, data ?? {}, Boolean(after))
    // a line the read found delivered is no longer waiting on the hub's answer
    for (const id of got.settled) {
      clearTimeout(sendTimers.get(id))
      sendTimers.delete(id)
    }
    return got
  }

  const markRead = (withUser: string) => {
    const t = readTimers.get(withUser)
    if (t) clearTimeout(t)
    readTimers.delete(withUser)
    store.getState().readHere(withUser)
    mirror()
    void call('MarkRead', withUser).catch(() => { /* the next open marks it again */ })
  }

  const readSoon = (withUser: string) => {
    const t = readTimers.get(withUser)
    if (t) clearTimeout(t)
    readTimers.set(withUser, setTimeout(() => {
      readTimers.delete(withUser)
      if (store.getState().open === withUser && visible()) markRead(withUser)
    }, READ_AFTER_MS))
  }

  const overviewSoon = () => {
    clearTimeout(overviewTimer)
    overviewTimer = setTimeout(() => { void overview().catch(() => { /* the next frame or connect reads it */ }) }, 1_000)
  }

  /** Every connect: the rail, then the open conversation from its read cursor (what the drop lost), then marked. */
  const resync = async () => {
    try {
      await overview({ catchUp: false })
      const open = store.getState().open
      if (open) {
        await call('OpenThread', open).catch(() => {})
        await messages(open, true)
        if (visible()) markRead(open)
      }
    } catch { /* the connection is going again; the next connect reads it all */ }
  }

  /** A sheet row pushed here: a `confirm` nothing here drew on its way, or a `message` from a hub that sends rows. */
  const arrived = (msg: model.LiveMessage) => {
    const s = store.getState()
    if (msg.client_id) {
      clearTimeout(sendTimers.get(msg.client_id))
      sendTimers.delete(msg.client_id)
    }
    const other = model.otherOf(msg)
    const reading = !msg.mine && s.open === other && visible()
    // a line this tab already said (an earlier frame for it, or an Overview whose count rose for it) was counted then
    const key = model.arrivalKey(msg.from_user, msg.created_at)
    const said = !msg.mine && announced.has(key)
    s.incoming(msg, !msg.mine && !reading && !(said && Boolean(msg.created_at)))
    if (msg.mine) return
    // this line is said here (or read here): an Overview that later shows it is not a second arrival
    announced.add(key)
    if (reading) {
      readSoon(other)
      return
    }
    if (!said) announce({ id: msg.id, at: msg.created_at, from_user: msg.from_user, from_name: msg.from_name, body: msg.body })
  }

  // Words from the other end drawn the moment the hub has them, before the sheet does: counted and announced now…
  type OnItsWay = {
    withUser: string
    counted: boolean
    timer: ReturnType<typeof setTimeout>
    /** the line as announced (the shell's `latest` names it by this), what `latest` was before, and its notification */
    line: string
    before: Arrival | null
    note: string | null
  }
  const onTheirWay = new Map<string, OnItsWay>()

  // The sheet never took them: the line goes, its count with it, and so does every trace its arrival left — its…
  const onRetract = (raw: unknown) => {
    const clientId = String(((raw ?? {}) as { client_id?: string }).client_id ?? '')
    if (!clientId) return
    const was = onTheirWay.get(clientId)
    clearTimeout(was?.timer)
    onTheirWay.delete(clientId)
    if (was?.note) useNotificationStore.getState().dismiss([was.note])
    if (was && latest?.id === was.line) latest = was.before
    store.getState().retract(clientId, was?.counted ? was.withUser : null)
    mirror()
    if (was) overviewSoon()
  }

  const sending = (msg: model.LiveMessage) => {
    const s = store.getState()
    const clientId = msg.client_id
    if (!clientId) return
    // another tab of mine sent it: drawn as on its way, counted nowhere; its ending is its `confirm` or `send_failed`
    if (msg.mine) {
      s.incoming(msg, false)
      return
    }
    const other = model.otherOf(msg)
    const known = s.messages[other]
    if (onTheirWay.has(clientId) || (known && model.alreadyDrawn(known, msg))) return
    const counted = !(s.open === other && visible())
    const timer = setTimeout(() => onRetract({ client_id: clientId }), SEND_UNANSWERED_MS)
    const way: OnItsWay = { withUser: other, counted, timer, line: msg.id, before: latest, note: null }
    onTheirWay.set(clientId, way)
    s.incoming(msg, counted)
    announced.add(model.arrivalKey(msg.from_user, msg.created_at))
    if (counted) way.note = announce({ id: msg.id, at: msg.created_at, from_user: msg.from_user, from_name: msg.from_name, body: msg.body })
  }

  const onMessage = (raw: unknown) => {
    const msg = model.fromWire((raw ?? {}) as model.WireMessage, store.getState().me)
    if (msg.status === 'pending') sending(msg)
    else arrived(msg)
  }

  // The sheet has it.
  const onConfirm = (raw: unknown) => {
    const s = store.getState()
    const msg = model.fromWire({ ...((raw ?? {}) as model.WireMessage), state: 'sent' }, s.me)
    const clientId = msg.client_id ?? ''
    const was = onTheirWay.get(clientId)
    if (!was || msg.mine) {
      arrived(msg)
      return
    }
    clearTimeout(was.timer)
    onTheirWay.delete(clientId)
    const other = model.otherOf(msg)
    const reading = s.open === other && visible()
    s.incoming(msg, !reading && !was.counted)
    // its row, as an Overview will show it, is this line: not a second arrival
    announced.add(model.arrivalKey(msg.from_user, msg.created_at))
    if (reading) readSoon(other)
  }

  // A send the relay kept and confirmed at once, that Apps Script then refused or filed under another id: the line…
  const onGone = (raw: unknown) => {
    const f = (raw ?? {}) as { id?: string; client_id?: string; why?: string; moved?: boolean }
    const id = String(f.id ?? '')
    const clientId = String(f.client_id ?? '')
    if (!id && !clientId) return
    const moved = f.moved === true
    if (clientId) {
      clearTimeout(sendTimers.get(clientId))
      sendTimers.delete(clientId)
      const way = onTheirWay.get(clientId)
      clearTimeout(way?.timer)
      onTheirWay.delete(clientId)
    }
    store.getState().gone(id, clientId, moved ? '' : String(f.why || 'The server did not take it.'))
    overviewSoon()
    const open = store.getState().open
    if (moved && open) void messages(open, true).catch(() => { /* the next frame or connect reads it */ })
  }

  const onRead = (raw: unknown) => {
    const f = (raw ?? {}) as { with_user?: string; by?: string; at?: string }
    const s = store.getState()
    if (f.by && s.me.includes(f.by)) {
      if (f.with_user) s.readHere(f.with_user)
      mirror()
    } else if (f.by) {
      s.readThere(f.by, String(f.at ?? ''))
    }
  }

  // Chat written outside the hub (a sender still on today's chat, a queued write delivered): a fact, never the…
  const onNudge = (raw: unknown) => {
    const f = (raw ?? {}) as { thread_key?: string }
    const open = store.getState().open
    const key = String(f.thread_key ?? '')
    if (!open || (key && !key.split('|').includes(open))) {
      overviewSoon()
      return
    }
    void messages(open, true)
      .then((got) => {
        if (got.fresh > 0 && store.getState().open === open && visible()) readSoon(open)
      })
      .catch(() => { /* the Overview below still runs; the next connect reads it all */ })
      .finally(overviewSoon)
  }

  const bind = (c: HubClient) => {
    c.on('message', onMessage)
    c.on('confirm', onConfirm)
    c.on('retract', onRetract)
    c.on('send_failed', (raw) => {
      const f = (raw ?? {}) as { client_id?: string; to_user?: string; why?: string; unconfirmed?: boolean }
      if (!f.client_id || !f.to_user) return
      clearTimeout(sendTimers.get(f.client_id))
      sendTimers.delete(f.client_id)
      store.getState().fail(f.to_user, f.client_id, String(f.why || 'The message was not sent.'), f.unconfirmed === true)
    })
    c.on('read', onRead)
    c.on('gone', onGone)
    c.on('nudge', onNudge)
    c.on('reaction', (raw) => {
      const f = (raw ?? {}) as { message_id?: string; reactions?: Record<string, string[]> | null; by?: string; thread_key?: string }
      const s = store.getState()
      const mineBy = f.by ? s.me.includes(f.by) : false
      const pair = String(f.thread_key ?? '').split('|').filter((id) => id && !s.me.includes(id))
      const other = pair[0] ?? (mineBy ? '' : String(f.by ?? ''))
      if (other && f.message_id) s.setReactions(other, f.message_id, f.reactions ?? null)
    })
    c.on('presence', (raw) => {
      const f = (raw ?? {}) as { user_id?: string; online?: boolean }
      if (f.user_id) store.getState().setPresence(f.user_id, Boolean(f.online))
    })
    c.on('reauth', () => { void reauth().then((ok) => { if (ok) void resync() }) })
    // `revoked`: the hub closes the socket next; the loop asks for a ticket, and the door's refusal ends it
  }

  const run = async () => {
    let attempt = 0
    let everLive = false
    while (!stopped) {
      store.getState().setConnection(everLive ? 'reconnecting' : 'connecting')
      const c = new HubClient({ url: HUB_URL, ticket })
      bind(c)
      const closed = new Promise<void>((resolve) => { c.onclose = () => resolve() })
      try {
        await c.start()
      } catch (e) {
        if (e instanceof TicketRefused && e.refusal) {
          refuse(e.refusal)
          return
        }
        if (stopped) return
        await pause(reconnectDelay(attempt++))
        continue
      }
      if (stopped) {
        void c.stop()
        return
      }
      client = c
      attempt = 0
      everLive = true
      store.getState().setConnection('live')
      void c.invoke('SetVisible', visible()).catch(() => {})
      void resync()
      await closed
      client = null
      if (stopped) return
      store.getState().setConnection('reconnecting')
      await pause(reconnectDelay(attempt++))
    }
  }

  const onVisibility = () => {
    const c = client
    if (!c || c.state !== 'connected') return
    void c.invoke('SetVisible', visible()).catch(() => {})
    const open = store.getState().open
    if (visible() && open) {
      void messages(open, true).then(() => markRead(open)).catch(() => {})
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

  void run()

  // The hub answers a send at once, hands the words to the other end at once, and tells how it ended: `confirm`…
  const send = (withUser: string, body: string, clientId = model.newClientId()) => {
    const s = store.getState()
    const exists = (s.messages[withUser] ?? []).some((m) => m.client_id === clientId)
    if (exists) s.retry(withUser, clientId)
    else {
      s.addPending(withUser, {
        id: `pending-${clientId}`, from_user: s.self, from_name: 'You', to_user: withUser, body,
        created_at: new Date().toISOString(), mine: true, client_id: clientId, status: 'pending',
      })
    }
    const fail = (why: string, unsure: boolean) => {
      clearTimeout(sendTimers.get(clientId))
      sendTimers.delete(clientId)
      store.getState().fail(withUser, clientId, why, unsure)
    }
    clearTimeout(sendTimers.get(clientId))
    sendTimers.set(clientId, setTimeout(() => fail('no answer yet', true), SEND_UNANSWERED_MS))
    // the hub's own refusal, or a call that never left, surely did not send it; a connection lost with the call on…
    void call('Send', withUser, body, clientId)
      .catch((e: unknown) => fail(model.sentenceOf(e), !(e instanceof HubCallError || e instanceof NotSent)))
  }

  return {
    overview: async () => { await overview() },
    open: (withUser) => {
      const s = store.getState()
      const before = s.open
      if (before === withUser) return
      s.setOpen(withUser)
      if (before) void call('CloseThread', before).catch(() => {})
      if (!withUser) return
      void call('OpenThread', withUser).catch(() => {})
      void messages(withUser, false).then(() => { if (visible()) markRead(withUser) }).catch(() => {})
    },
    refresh: async () => {
      const counted = await overview({ catchUp: false })
      const open = store.getState().open
      if (!open) return
      await messages(open, true)
      if (counted && store.getState().open === open && visible()) readSoon(open)
    },
    send: (withUser, body) => send(withUser, body),
    retry: (withUser, clientId) => {
      const m = (store.getState().messages[withUser] ?? []).find((x) => x.client_id === clientId)
      if (m) send(withUser, m.body, clientId)
    },
    react: async (withUser, messageId, emoji) => {
      const before = store.getState().toggleReaction(withUser, messageId, emoji)
      try {
        // the conversation it was made in labels the frame the other tabs file it by
        const got = await call<{ reactions?: Record<string, string[]> | null }>('React', messageId, emoji, model.newClientId(), withUser)
        store.getState().setReactions(withUser, messageId, got?.reactions ?? null)
      } catch (e) {
        store.getState().restoreReactions(withUser, before)
        throw e
      }
    },
    markRead,
    stop: () => {
      stopped = true
      wakeUp?.()
      renewWake?.()
      for (const t of readTimers.values()) clearTimeout(t)
      readTimers.clear()
      for (const t of sendTimers.values()) clearTimeout(t)
      sendTimers.clear()
      for (const w of onTheirWay.values()) clearTimeout(w.timer)
      onTheirWay.clear()
      clearTimeout(overviewTimer)
      unmirror()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      const c = client
      client = null
      void c?.stop()
    },
  }
}
