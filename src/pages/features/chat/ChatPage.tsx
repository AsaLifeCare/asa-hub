// CHAT — the platform's own person-to-person messaging.
// A chat inside the platform so people can talk to each other, laid out after the old platform's own, over the users who are…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { chatKindOf, useLiveMode } from '@/lib/chatLive/access'
import { useChatLiveStore } from '@/lib/chatLive/store'
import { MY_INBOX_APP_ID } from '@/registry/apps-myinbox'
import { Loader2, MessageSquare, Search, Send, Smile, SmilePlus } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { usePageRefresh } from '@/lib/pageRefresh'
import { useFloorTick } from './floorTick'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import { gasAction } from '@/features/hiring/shared'
import { isActing, useAuthStore } from '@/auth/useAuthStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { onChatEvent, useChatPresenceStore } from '@/lib/chatPresence'
import { rememberEmoji } from '@/lib/emoji'
import EmojiPicker from './EmojiPicker'
import { toast } from '@/stores/useToastStore'
import { ohioTime } from '@/lib/ohio'
import { useDraftGuard } from '@/lib/useDraftGuard'
import { cn } from '@/lib/utils'
import { type ChatLine, goneFrom, mergeRead, pushedLine, railAfterLine, settleSent, streamLineOf } from '@/lib/chatLines'

type Person = { user_id: string; name: string; title?: string; avatar?: string; online?: boolean }
type Thread = {
  thread_key: string
  with_user: string
  with_name: string
  last: string
  last_at: string
  last_from?: string
  unread: number
  online?: boolean
}
type Reactions = Record<string, Record<string, string[]>>
type Message = ChatLine

/** Asking, because nothing is listening — the shape that shipped first. */
const THREADS_MS = 20_000
const MESSAGES_MS = 8_000
// Listening: the stream wakes this screen, so these are only the sweep that catches whatever a dropped connection…
const THREADS_IDLE_MS = 5 * 60_000
const MESSAGES_IDLE_MS = 2 * 60_000
/** Past the relay's own nudges for a send it could not confirm (35 s and 150 s): a bubble no read found goes. */
const UNCONFIRMED_KEEP_MS = 3 * 60_000

// THE SAFETY NET IS A DEADLINE, NOT AN INTERVAL — and that is the whole difference between a net and no net at all.
const TICK_MS = 2_000

// "14:32" in the company's own timezone — a chat is read at a glance, and a message stamped in the reader's zone…
const at = (iso: string) => (iso ? ohioTime(iso) : '')

export const LIVE_OFF_LINE = 'Live updates are off — use Refresh.'
export const ACTING_COMPOSER_LINE = 'Messages are not sent in a switched session. Press Be Back to write as yourself.'
export const ACTING_PICK_TITLE = 'Pick a conversation to read'

// A switched session reads the person's conversations and writes nothing in them: no line, no reaction, no read…
export async function sendChatLine(to: string, body: string) {
  if (isActing()) throw new Error(ACTING_COMPOSER_LINE)
  return gasAction<{ id?: string; created_at?: string; thread_key?: string }>('chatSend', { to_user: to, body })
}

export async function reactToLine(messageId: string, emoji: string) {
  if (isActing()) throw new Error(ACTING_COMPOSER_LINE)
  return gasAction<{ message_id: string; reactions: Record<string, string[]> }>(
    'chatReact', { message_id: messageId, emoji },
  )
}

// A session with live chat has its chat in My Inbox (lib/chatLive): the standalone page and the old toasts' links…
export default function ChatPage({ embedded = false }: { embedded?: boolean } = {}) {
  const mode = useLiveMode()
  const refused = useChatLiveStore((s) => s.refused)
  const search = useLocation().search
  if (!embedded && mode === 'on' && chatKindOf(mode, refused) === 'live') {
    return <Navigate to={`/app/${MY_INBOX_APP_ID}/chat${search}`} replace />
  }
  return <ChatScreen embedded={embedded} />
}

function ChatScreen({ embedded }: { embedded: boolean }) {
  const me = useAuthStore((s) => s.user)
  const acting = useAuthStore((s) => Boolean(s.beAnother?.acting))
  const myId = String(me?.id ?? '')
  const search = useLocation().search
  const [threads, setThreads] = useState<Thread[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [active, setActive] = useState<string | null>(() => new URLSearchParams(search).get('with'))
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const cursorRef = useRef<string>('')
  // Message ids already announced, so the same arrival is not raised twice by two polls that overlapped.
  const announcedRef = useRef<Set<string>>(new Set())
  // {message_id: {emoji: [user_id…]}} for the open conversation.
  const [reactions, setReactions] = useState<Reactions>({})
  const [picker, setPicker] = useState<null | { kind: 'composer' } | { kind: 'message'; id: string; mine: boolean; side: 'up' | 'down' }>(null)

  // Unsaved-work reminder: a typed-but-unsent line survives leaving the app as a post-it sliver pointing back here.
  useDraftGuard({ id: 'chat-message', label: 'An unsent chat message', dirty: draft.trim().length > 0 })

  const activePerson = useMemo(
    () => people.find((p) => p.user_id === active) ??
      (active ? { user_id: active, name: threads.find((t) => t.with_user === active)?.with_name ?? 'Conversation' } : null),
    [people, threads, active],
  )

  // Is the platform HEARING messages (the shell's stream is open) or asking for them?
  const live = useChatPresenceStore((s) => s.live)
  /** …read from inside a tick that must not be rebuilt when it changes. */
  const liveRef = useRef(live)
  liveRef.current = live
  // When each sweep last actually read.
  const threadsAtRef = useRef(0)
  const messagesAtRef = useRef(0)

  /* ---------------- the left rail ---------------- */

  const loadOverview = useCallback(async (announce: boolean) => {
    // Claimed now so two ticks cannot both fire while one read is in flight, and GIVEN BACK in the catch — see…
    const claimed = threadsAtRef.current
    threadsAtRef.current = Date.now()
    try {
      const r = await gasAction<{ threads: Thread[]; people: Person[]; unread: number }>('chatOverview', {})
      if (embedded) {
        // the page's own count (Chat · n, the inbox's chat alert) follows what was just read
        const n = Math.max(0, Number(r.unread) || 0)
        useChatPresenceStore.setState(n > 0 ? { unread: n } : { unread: 0, latest: null })
      }
      setPeople(r.people ?? [])
      setThreads((prev) => {
        const next = r.threads ?? []
        // A MESSAGE THAT ARRIVES WHILE YOU ARE LOOKING SOMEWHERE ELSE STILL REACHES YOU — the chat is tied to the…
        if (announce) {
          for (const t of next) {
            if (!t.unread || t.with_user === active) continue
            const seen = prev.find((p) => p.thread_key === t.thread_key)
            const isNew = !seen || t.last_at > seen.last_at
            if (!isNew || announcedRef.current.has(t.thread_key + t.last_at)) continue
            announcedRef.current.add(t.thread_key + t.last_at)
            useNotificationStore.getState().push({
              type: 'mention',
              appId: 'chat',
              title: `${t.with_name || 'Somebody'} sent you a message`,
              body: t.last,
              // HIGH on purpose: the store raises a toast for high, which is what catching the reader's attention…
              priority: 'high',
              href: `/app/chat/messages?with=${encodeURIComponent(t.with_user)}`,
            })
          }
        }
        return next
      })
    } catch {
      // a missed poll is not an error worth a toast — but it IS a poll that did not happen, so the deadline goes…
      threadsAtRef.current = claimed
    } finally {
      setLoading(false)
    }
  }, [active, embedded])

  // `?with=<user id>` OPENS THAT CONVERSATION.
  useEffect(() => {
    const withUser = new URLSearchParams(search).get('with')
    if (withUser) setActive(withUser)
  }, [search])

  // tell the shell which conversation is open; a click never reaches the address
  useEffect(() => {
    useChatPresenceStore.getState().setViewing(active)
    return () => useChatPresenceStore.getState().setViewing(undefined)
  }, [active])

  useEffect(() => {
    void loadOverview(false)
    const wake = () => { if (document.visibilityState === 'visible') void loadOverview(true) }
    document.addEventListener('visibilitychange', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
    }
  }, [loadOverview])
  // Listening: one slow sweep to catch anything a dropped stream missed.
  useFloorTick(!embedded, () => {
    if (document.visibilityState !== 'visible') return
    const due = liveRef.current ? THREADS_IDLE_MS : THREADS_MS
    if (Date.now() - threadsAtRef.current < due) return
    void loadOverview(true)
  }, TICK_MS)

  /* ---------------- the open conversation ---------------- */

  // Read the conversation.
  const reqRef = useRef(0)
  const loadMessages = useCallback(async (withUser: string, incremental: boolean) => {
    const seq = ++reqRef.current
    // A READ THAT FAILED MUST NOT BUY THE SILENCE OF A READ THAT WORKED.
    const claimed = messagesAtRef.current
    messagesAtRef.current = Date.now()
    try {
      const r = await gasAction<{ messages: Message[]; reset?: boolean; reactions?: Reactions }>('chatMessages', {
        with_user: withUser,
        after: incremental ? cursorRef.current : '',
      })
      if (seq !== reqRef.current) return          // a newer read already answered
      // Whole every time, so a thumbs-up on yesterday's line is not invisible until somebody reloads.
      setReactions(r.reactions ?? {})
      const arrived = r.messages ?? []
      if (!arrived.length && incremental && !r.reset) return
      setMessages((prev) => {
        // An IN-FLIGHT bubble survives every read (a poll can land mid-send — stripping it is the message…
        const got = mergeRead(prev, arrived, !incremental || Boolean(r.reset), Date.now(), withUser)
        cursorRef.current = got.cursor
        return got.lines
      })
    } catch {
      // the next tick tries again — and it may try AT ONCE, because this read did not happen and must not count as…
      messagesAtRef.current = claimed
    }
  }, [])

  // The open conversation, readable from inside the stream's callback without making that subscription depend on it…
  const activeRef = useRef<string | null>(null)
  activeRef.current = active
  /** The lines on screen, for the stream's callback (a refused send of mine goes back in the box). */
  const messagesRef = useRef<Message[]>(messages)
  messagesRef.current = messages

  // IT LISTENS.
  useEffect(() => {
    return onChatEvent((msg) => {
      if (msg.gone) {
        const goneId = msg.gone
        const { gone } = goneFrom(messagesRef.current, goneId)
        setMessages((m) => goneFrom(m, goneId).lines)
        if (gone?.mine) setDraft((d) => (d ? `${d}\n${gone.body}` : gone.body))
        void loadOverview(false)
        return
      }
      const line = streamLineOf(msg.message)
      if (line) {
        const reading = activeRef.current === line.with_user && document.visibilityState === 'visible'
        setThreads((t) => railAfterLine(t, line, msg.thread_key, reading))
        if (activeRef.current === line.with_user) setMessages((m) => pushedLine(m, line, Date.now()))
        return
      }
      void loadOverview(true)
      // THE OPEN CONVERSATION IS RE-READ ON ANY EVENT, and no longer only when the line names the person on screen.
      if (activeRef.current) void loadMessages(activeRef.current, true)
    })
  }, [loadOverview, loadMessages])


  useEffect(() => {
    if (!active) { setMessages([]); setReactions({}); cursorRef.current = ''; return }
    cursorRef.current = ''
    void loadMessages(active, false)
    // wearing another account (Be Another): opening their thread never marks it read for them
    if (!isActing()) {
      void gasAction('chatMarkRead', { with_user: active }).then(() => void loadOverview(false)).catch(() => {})
    }
    // COMING BACK TO THE TAB READS THE CONVERSATION, not just the left rail.
    const wake = () => { if (document.visibilityState === 'visible') void loadMessages(active, true) }
    document.addEventListener('visibilitychange', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
    }
  }, [active, loadMessages, loadOverview])
  // the open conversation's sweep, on the same floor as the rail's
  useFloorTick(!embedded, () => {
    const open = activeRef.current
    if (!open || document.visibilityState !== 'visible') return
    const due = liveRef.current ? MESSAGES_IDLE_MS : MESSAGES_MS
    if (Date.now() - messagesAtRef.current < due) return
    void loadMessages(open, true)
  }, TICK_MS)

  // the page's Refresh (My Inbox's header) reads the rail and the open conversation
  usePageRefresh(() => {
    void loadOverview(false)
    if (activeRef.current) void loadMessages(activeRef.current, true)
  })

  // Keep the thread pinned to the newest line.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, active])

  /** A send answered "taken, not yet confirmed" keeps its bubble until its copy arrives, or this long. */
  const unconfirmedTimers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = unconfirmedTimers.current
    return () => {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    }
  }, [])

  // SENDING NEVER WAITS — a chat message does not need to be "resolved", only sent.
  const send = () => {
    const body = draft.trim()
    if (!body || !active || acting) return
    const to = active
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setMessages((m) => [...m, {
      id: pendingId, from_user: myId, from_name: me?.name ?? 'You',
      body, created_at: new Date().toISOString(), mine: true, pending: true, with: to,
    }])
    setDraft('')
    requestAnimationFrame(() => composerRef.current?.focus())
    void (async () => {
      try {
        const r = await sendChatLine(to, body)
        if (r && r.id) {
          const at = String(r.created_at ?? '')
          setMessages((m) => settleSent(m, pendingId, { id: String(r.id), created_at: at }, Date.now()))
          setThreads((t) => railAfterLine(t, { id: String(r.id), from_user: myId, from_name: me?.name ?? '', body,
            created_at: at || new Date().toISOString(), mine: true, with_user: to }, String(r.thread_key ?? ''), true))
          return
        }
        const timer = setTimeout(() => {
          unconfirmedTimers.current.delete(timer)
          setMessages((m) => m.filter((x) => x.id !== pendingId))
          if (activeRef.current === to) void loadMessages(to, true)
        }, UNCONFIRMED_KEEP_MS)
        unconfirmedTimers.current.add(timer)
        void loadMessages(to, true)
        void loadOverview(false)
      } catch (e) {
        // The line goes back in the box rather than disappearing with the failure — a message you typed and cannot…
        setMessages((m) => m.filter((x) => x.id !== pendingId))
        setDraft((d) => (d ? `${d}\n${body}` : body))
        toast({
          type: 'danger',
          title: 'Not sent',
          body: e instanceof Error ? e.message : 'The message went back into the box — try again.',
        })
      }
    })()
  }

  // REACT — and the screen answers before the server does.
  const react = async (messageId: string, emoji: string) => {
    if (acting) return
    const before = reactions
    setReactions((prev) => {
      const forMsg = { ...(prev[messageId] ?? {}) }
      const ids = forMsg[emoji] ? [...forMsg[emoji]] : []
      const at = ids.indexOf(myId)
      if (at === -1) ids.push(myId)
      else ids.splice(at, 1)
      if (ids.length) forMsg[emoji] = ids
      else delete forMsg[emoji]
      return { ...prev, [messageId]: forMsg }
    })
    setPicker(null)
    try {
      const r = await reactToLine(messageId, emoji)
      setReactions((prev) => ({ ...prev, [messageId]: r.reactions ?? {} }))
    } catch (e) {
      setReactions(before)
      toast({
        type: 'danger',
        title: 'The reaction did not stick',
        body: e instanceof Error ? e.message : 'Try again in a moment.',
      })
    }
  }

  const query = q.trim().toLowerCase()
  const shownThreads = threads.filter((t) => !query || (t.with_name || '').toLowerCase().includes(query))
  const shownPeople = people.filter(
    (p) => (!query || p.name.toLowerCase().includes(query)) && !threads.some((t) => t.with_user === p.user_id),
  )

  // fits the viewport: the chrome, 2.5rem for the shell's copyright line, and the strip at the top while it is up…
  return (
    <div className={cn(
      'flex min-h-[420px] flex-col',
      embedded
        ? 'h-[calc(100dvh-140px-2.5rem-76px-var(--hub-strip-h,0px))]'
        : 'h-[calc(100dvh-140px-2.5rem-var(--hub-strip-h,0px))]',
    )}>
      {!embedded && (
        <PageHeader
          title="Chat"
          subtitle="The people on the platform, and what they said."
        />
      )}
      {embedded && !live && (
        <p data-live-off className="mb-2 shrink-0 text-[12px] text-[var(--warning)]">{LIVE_OFF_LINE}</p>
      )}
      <div className={cn('flex min-h-0 flex-1 gap-4', !embedded && 'mt-4')}>
        {/* ---- the rail: conversations, then everybody else ---- */}
        <aside
          className={cn(
            'flex w-[280px] shrink-0 flex-col rounded-lg border border-border bg-surface',
            active && 'hidden md:flex',
          )}
        >
          <div className="border-b border-border p-2.5">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5">
              <Search size={14} className="shrink-0 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people…"
                className="h-8 w-full bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              />
            </div>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {loading && (
              <p className="flex items-center gap-2 px-2 py-3 text-[12.5px] text-text-3">
                <Loader2 size={13} className="animate-spin" /> Reading the room…
              </p>
            )}
            {shownThreads.length > 0 && (
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                Conversations
              </p>
            )}
            {shownThreads.map((t) => (
              <button
                key={t.thread_key}
                onClick={() => setActive(t.with_user)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                  active === t.with_user ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                )}
              >
                <DragPerson name={t.with_name} id={t.with_user} className="shrink-0">
                  <PresenceAvatar name={t.with_name} online={t.online} />
                </DragPerson>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <DragPerson name={t.with_name} id={t.with_user} className="min-w-0 flex-1">
                      <span className="clamp-1 flex-1 text-[13px] font-semibold text-text-1">{t.with_name || 'Someone'}</span>
                    </DragPerson>
                    <span className="shrink-0 text-[10.5px] text-text-3">{at(t.last_at)}</span>
                  </span>
                  <span className="clamp-1 mt-0.5 block text-[11.5px] text-text-3">
                    {t.last_from === myId ? 'You: ' : ''}{t.last}
                  </span>
                </span>
                {t.unread > 0 && (
                  <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1 text-[10.5px] font-bold text-on-primary">
                    {t.unread}
                  </span>
                )}
              </button>
            ))}
            {shownPeople.length > 0 && (
              <p className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                Everybody else
              </p>
            )}
            {shownPeople.map((p) => (
              <button
                key={p.user_id}
                onClick={() => setActive(p.user_id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2/60"
              >
                {/* face and name travel together — the wrapper reproduces the
                    button's own flex row so the layout is untouched. */}
                <DragPerson
                  name={p.name}
                  id={p.user_id}
                  avatar={p.avatar}
                  subtitle={p.title || undefined}
                  className="flex w-full items-center gap-2.5"
                >
                  <PresenceAvatar name={p.name} src={p.avatar} online={p.online} />
                  <span className="min-w-0 flex-1">
                    <span className="clamp-1 block text-[13px] font-medium text-text-1">{p.name}</span>
                    {p.title && <span className="clamp-1 block text-[11.5px] text-text-3">{p.title}</span>}
                  </span>
                </DragPerson>
              </button>
            ))}
            {!loading && !shownThreads.length && !shownPeople.length && (
              <p className="px-2 py-6 text-center text-[12.5px] text-text-3">Nobody matches that.</p>
            )}
          </div>
        </aside>

        {/* ---- the thread ---- */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface">
          {!active ? (
            <div className="grid flex-1 place-items-center p-6">
              <EmptyState
                title={acting ? ACTING_PICK_TITLE : 'Pick somebody to write to'}
                body="Conversations you already have are at the top of the list; everyone else on the platform is under them."
              />
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
                <button
                  onClick={() => setActive(null)}
                  className="text-[12.5px] font-medium text-text-3 hover:text-text-1 md:hidden"
                >
                  Back
                </button>
                <DragPerson
                  name={activePerson?.name ?? ''}
                  id={activePerson?.user_id}
                  avatar={activePerson?.avatar}
                  className="flex min-w-0 flex-1 items-center gap-2.5"
                >
                  <PresenceAvatar name={activePerson?.name ?? ''} src={activePerson?.avatar} online={activePerson?.online} />
                  <span className="min-w-0 flex-1">
                    <span className="clamp-1 block text-[13.5px] font-semibold text-text-1">{activePerson?.name}</span>
                    <span className="block text-[11.5px] text-text-3">
                      {activePerson?.online ? 'On the platform now' : 'Away — a message will reach them by e-mail'}
                    </span>
                  </span>
                </DragPerson>
              </header>

              <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
                {messages.length === 0 && (
                  <p className="py-10 text-center text-[12.5px] text-text-3">
                    {acting ? 'No messages in this conversation yet.' : 'No messages yet. Say something.'}
                  </p>
                )}
                {messages.map((m) => {
                  const marks = Object.entries(reactions[m.id] ?? {}).filter(([, ids]) => ids.length)
                  const open = picker?.kind === 'message' && picker.id === m.id
                  return (
                  <div key={m.id} className={cn('group/msg flex flex-col', m.mine ? 'items-end' : 'items-start')}>
                    <div className={cn('relative flex max-w-[min(560px,78%)] items-center gap-1', m.mine ? 'flex-row' : 'flex-row-reverse')}>
                      {/* The opener sits OUTSIDE the bubble and appears on
                          hover — inside, it would push the text around, and
                          always visible it would put a control on every line
                          of a conversation. Touch has no hover, so it is also
                          shown while its own picker is open. */}
                      {!m.pending && !acting && (
                        <button
                          onClick={(e) => {
                            if (open) { setPicker(null); return }
                            // Room above, or not: measured against the thread's own scroller, because that box is…
                            const btn = e.currentTarget.getBoundingClientRect()
                            const box = scrollRef.current?.getBoundingClientRect()
                            const roomAbove = box ? btn.top - box.top : btn.top
                            setPicker({ kind: 'message', id: m.id, mine: !!m.mine, side: roomAbove > 300 ? 'up' : 'down' })
                          }}
                          aria-label="React to this message"
                          title="React"
                          className={cn(
                            'grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-3 transition-opacity hover:bg-surface-2 hover:text-text-1',
                            open ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover/msg:opacity-100',
                          )}
                        >
                          <SmilePlus size={14} />
                        </button>
                      )}
                      <div
                        className={cn(
                          'min-w-0 rounded-lg px-3 py-2 text-[13.5px] leading-5',
                          m.mine
                            ? 'bg-primary text-on-primary'
                            : 'border border-border bg-surface-2 text-text-1',
                          m.pending && 'opacity-60',
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={cn('mt-1 text-[10.5px]', m.mine ? 'text-on-primary/70' : 'text-text-3')}>
                          {m.pending ? 'sending…' : at(m.created_at)}
                        </p>
                      </div>
                      {open && (
                        <EmojiPicker
                          align={m.mine ? 'right' : 'left'}
                          side={picker.side}
                          onPick={(glyph) => { rememberEmoji(glyph); void react(m.id, glyph) }}
                          onClose={() => setPicker(null)}
                        />
                      )}
                    </div>
                    {marks.length > 0 && (
                      <div className={cn('mt-1 flex flex-wrap gap-1', m.mine ? 'justify-end' : 'justify-start')}>
                        {marks.map(([glyph, ids]) => {
                          const isMine = ids.includes(myId)
                          return (
                            <button
                              key={glyph}
                              onClick={() => void react(m.id, glyph)}
                              disabled={acting}
                              title={isMine ? 'Remove your reaction' : 'React with ' + glyph}
                              className={cn(
                                'flex h-6 items-center gap-1 rounded-full border px-1.5 text-[12px] transition-colors',
                                isMine
                                  ? 'border-primary bg-primary-soft text-primary-strong'
                                  : 'border-border bg-surface-2 text-text-2 hover:bg-surface-3',
                              )}
                            >
                              <span className="leading-none">{glyph}</span>
                              {ids.length > 1 && <span className="font-semibold tabular-nums">{ids.length}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>

              {acting ? (
                <p data-composer-off className="border-t border-border px-4 py-3 text-[12.5px] text-text-3">
                  {ACTING_COMPOSER_LINE}
                </p>
              ) : (
              <div className="border-t border-border p-2.5">
                <div className="relative flex items-end gap-2">
                  {picker?.kind === 'composer' && (
                    <EmojiPicker
                      onPick={(glyph) => {
                        rememberEmoji(glyph)
                        // Into the box, not straight out: an emoji is part of a sentence as often as it is the…
                        setDraft((d) => d + glyph)
                        requestAnimationFrame(() => composerRef.current?.focus())
                      }}
                      onClose={() => setPicker(null)}
                    />
                  )}
                  <button
                    onClick={() => setPicker(picker?.kind === 'composer' ? null : { kind: 'composer' })}
                    aria-label="Emoji"
                    title="Emoji"
                    className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1"
                  >
                    <Smile size={16} />
                  </button>
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends, shift+Enter breaks the line — the gesture every chat has taught everybody.
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        send()
                      }
                    }}
                    rows={1}
                    placeholder={`Message ${activePerson?.name ?? ''}…`}
                    className="scroll-thin max-h-[120px] min-h-[38px] w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
                  />
                  <button
                    onClick={send}
                    disabled={!draft.trim()}
                    aria-label="Send"
                    className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-md bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

// An avatar with the green dot — the platform's round person icon, never a square (the house law for anything that…
function PresenceAvatar({ name, src, online }: { name: string; src?: string; online?: boolean }) {
  return (
    <span className="relative shrink-0">
      <Avatar src={src} name={name || '?'} size="sm" />
      <span
        aria-hidden
        className={cn(
          'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface',
          online ? 'bg-tint-fg-mint' : 'bg-border',
        )}
      />
    </span>
  )
}

/** The icon the sidebar draws for this app. */
export const CHAT_ICON = MessageSquare
