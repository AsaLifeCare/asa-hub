// MY INBOX · CHAT, LIVE — the same two panes as the chat (conversations and people on the left, the thread and the…
// Nothing here asks Apps Script on a timer: the hub pushes messages, read marks, reactions and presence, and every…
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { Check, CheckCheck, Loader2, RotateCw, Search, Send, Smile, SmilePlus } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import { useChatPresenceStore } from '@/lib/chatPresence'
import type { LiveMode } from '@/lib/chatLive/access'
import { failedWords } from '@/lib/chatLive/model'
import type { ConnectionState, LiveMessage, Reactions, Refusal } from '@/lib/chatLive/model'
import { liveApi } from '@/lib/chatLive/shell'
import { useChatLiveStore } from '@/lib/chatLive/store'
import { rememberEmoji } from '@/lib/emoji'
import { ohioTime } from '@/lib/ohio'
import { usePageRefresh } from '@/lib/pageRefresh'
import { useDraftGuard } from '@/lib/useDraftGuard'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import EmojiPicker from '../EmojiPicker'

export const LIVE_ACTING_LINE = 'Chat is off while acting as someone else. Press Be Back to chat as yourself.'

/** What the connection is doing, said under the header while it is not simply live. */
export const LIVE_STATE_LINE: Record<ConnectionState, string> = {
  idle: 'Starting live chat…',
  connecting: 'Connecting live chat…',
  live: '',
  reconnecting: 'Reconnecting live chat — messages you send wait for it.',
  refused: '',
}

export const LIVE_REFUSED_LINE: Record<Refusal, string> = {
  session: 'This session could not be confirmed. Sign in again to chat.',
  acting: LIVE_ACTING_LINE,
  access: 'Live chat is not open to this account.',
  visit: "Chat answers the signed-in account only — close the visit to see yours.",
  unavailable: 'Live chat could not load in this tab. Reload it to chat.',
}

const EMPTY_MESSAGES: LiveMessage[] = []
const EMPTY_REACTIONS: Reactions = {}

const at = (iso: string) => (iso ? ohioTime(iso) : '')

export default function ChatLiveView({ mode }: { mode: LiveMode }) {
  if (mode === 'acting') {
    return (
      <div className="w-full pb-16">
        <EmptyState title="Chat" body={LIVE_ACTING_LINE} />
      </div>
    )
  }
  return <LiveChat />
}

function LiveChat() {
  const connection = useChatLiveStore((s) => s.connection)
  const refused = useChatLiveStore((s) => s.refused)
  const threads = useChatLiveStore((s) => s.threads)
  const people = useChatLiveStore((s) => s.people)
  const presence = useChatLiveStore((s) => s.presence)
  const loaded = useChatLiveStore((s) => s.loaded)
  const open = useChatLiveStore((s) => s.open)
  const me = useChatLiveStore((s) => s.me)
  const messages = useChatLiveStore((s) => (s.open ? s.messages[s.open] : undefined)) ?? EMPTY_MESSAGES
  const reactions = useChatLiveStore((s) => (s.open ? s.reactions[s.open] : undefined)) ?? EMPTY_REACTIONS
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [picker, setPicker] = useState<null | { kind: 'composer' } | { kind: 'message'; id: string; mine: boolean; side: 'up' | 'down' }>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useDraftGuard({ id: 'chat-live-message', label: 'An unsent chat message', dirty: draft.trim().length > 0 })

  const openWith = (withUser: string | null) => {
    const api = liveApi()
    if (api) api.open(withUser)
    else useChatLiveStore.getState().setOpen(withUser)
  }

  // `?with=<person>` opens that conversation: the toast's link, and every "Message <person>" button
  const search = useLocation().search
  useEffect(() => {
    const withUser = new URLSearchParams(search).get('with')
    if (withUser) openWith(withUser)
  }, [search])

  // the shell is told which conversation is on screen (no toast for it); leaving closes it
  useEffect(() => {
    useChatPresenceStore.getState().setViewing(open)
  }, [open])
  useEffect(() => () => {
    useChatPresenceStore.getState().setViewing(undefined)
    liveApi()?.open(null)
  }, [])

  // a page mounted on a connection that is already up reads the rail once
  const isLive = connection === 'live'
  useEffect(() => {
    if (isLive) void liveApi()?.overview().catch(() => { /* the next frame or reconnect reads it */ })
  }, [isLive])

  usePageRefresh(() => { void liveApi()?.refresh().catch(() => {}) })

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, open])

  const withPresence = (id: string, sheet?: boolean) => presence[id] ?? Boolean(sheet)

  const activePerson = useMemo(() => {
    if (!open) return null
    const p = people.find((x) => x.user_id === open)
    const t = threads.find((x) => x.with_user === open)
    return { user_id: open, name: p?.name ?? t?.with_name ?? 'Conversation', avatar: p?.avatar,
      online: withPresence(open, p?.online ?? t?.online) }
  }, [open, people, threads, presence])

  const send = () => {
    const body = draft.trim()
    const api = liveApi()
    if (!body || !open || !api) return
    api.send(open, body)
    setDraft('')
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  const react = (messageId: string, emoji: string) => {
    setPicker(null)
    const api = liveApi()
    if (!api || !open) return
    void api.react(open, messageId, emoji).catch((e: unknown) => {
      toast({ type: 'danger', title: 'The reaction did not stick', body: e instanceof Error ? e.message : 'Try again in a moment.' })
    })
  }

  const query = q.trim().toLowerCase()
  const shownThreads = threads.filter((t) => !query || (t.with_name || '').toLowerCase().includes(query))
  const shownPeople = people.filter(
    (p) => (!query || p.name.toLowerCase().includes(query)) && !threads.some((t) => t.with_user === p.user_id),
  )
  const stateLine = refused ? LIVE_REFUSED_LINE[refused] : LIVE_STATE_LINE[connection]
  // while it reconnects a message still goes on screen, and waits for the connection or says it was not sent
  const canSend = !refused && connection !== 'idle'
  const lastSeen = [...messages].reverse().find((m) => m.mine && m.status === 'sent')

  return (
    <div className="flex h-[calc(100dvh-140px-2.5rem-76px-var(--hub-strip-h,0px))] min-h-[420px] flex-col">
      {stateLine && (
        <p data-live-state={refused ?? connection} className="mb-2 shrink-0 text-[12px] text-[var(--warning)]">{stateLine}</p>
      )}
      <div className="flex min-h-0 flex-1 gap-4">
        <aside className={cn('flex w-[280px] shrink-0 flex-col rounded-lg border border-border bg-surface', open && 'hidden md:flex')}>
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
            {!loaded && !refused && (
              <p className="flex items-center gap-2 px-2 py-3 text-[12.5px] text-text-3">
                <Loader2 size={13} className="animate-spin" /> Reading the room…
              </p>
            )}
            {shownThreads.length > 0 && (
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">Conversations</p>
            )}
            {shownThreads.map((t) => (
              <button
                key={t.thread_key || t.with_user}
                onClick={() => openWith(t.with_user)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                  open === t.with_user ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                )}
              >
                <DragPerson name={t.with_name} id={t.with_user} className="shrink-0">
                  <PresenceAvatar name={t.with_name} online={withPresence(t.with_user, t.online)} />
                </DragPerson>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="clamp-1 flex-1 text-[13px] font-semibold text-text-1">{t.with_name || 'Someone'}</span>
                    <span className="shrink-0 text-[10.5px] text-text-3">{at(t.last_at)}</span>
                  </span>
                  <span className="clamp-1 mt-0.5 block text-[11.5px] text-text-3">
                    {t.last_from && me.includes(t.last_from) ? 'You: ' : ''}{t.last}
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
              <p className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">Everybody else</p>
            )}
            {shownPeople.map((p) => (
              <button
                key={p.user_id}
                onClick={() => openWith(p.user_id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2/60"
              >
                <DragPerson name={p.name} id={p.user_id} avatar={p.avatar} subtitle={p.title || undefined}
                  className="flex w-full items-center gap-2.5">
                  <PresenceAvatar name={p.name} src={p.avatar} online={withPresence(p.user_id, p.online)} />
                  <span className="min-w-0 flex-1">
                    <span className="clamp-1 block text-[13px] font-medium text-text-1">{p.name}</span>
                    {p.title && <span className="clamp-1 block text-[11.5px] text-text-3">{p.title}</span>}
                  </span>
                </DragPerson>
              </button>
            ))}
            {loaded && !shownThreads.length && !shownPeople.length && (
              <p className="px-2 py-6 text-center text-[12.5px] text-text-3">Nobody matches that.</p>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface">
          {!open ? (
            <div className="grid flex-1 place-items-center p-6">
              <EmptyState
                title="Pick somebody to write to"
                body="Conversations you already have are at the top of the list; everyone else on the platform is under them."
              />
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
                <button onClick={() => openWith(null)} className="text-[12.5px] font-medium text-text-3 hover:text-text-1 md:hidden">
                  Back
                </button>
                <DragPerson name={activePerson?.name ?? ''} id={activePerson?.user_id} avatar={activePerson?.avatar}
                  className="flex min-w-0 flex-1 items-center gap-2.5">
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
                  <p className="py-10 text-center text-[12.5px] text-text-3">No messages yet. Say something.</p>
                )}
                {messages.map((m) => {
                  const marks = Object.entries(reactions[m.id] ?? {}).filter(([, ids]) => ids.length)
                  const pickerOpen = picker?.kind === 'message' && picker.id === m.id
                  return (
                    <div key={m.client_id ?? m.id} data-status={m.status} className={cn('group/msg flex flex-col', m.mine ? 'items-end' : 'items-start')}>
                      <div className={cn('relative flex max-w-[min(560px,78%)] items-center gap-1', m.mine ? 'flex-row' : 'flex-row-reverse')}>
                        {m.status === 'sent' && (
                          <button
                            onClick={(e) => {
                              if (pickerOpen) { setPicker(null); return }
                              const btn = e.currentTarget.getBoundingClientRect()
                              const box = scrollRef.current?.getBoundingClientRect()
                              const roomAbove = box ? btn.top - box.top : btn.top
                              setPicker({ kind: 'message', id: m.id, mine: m.mine, side: roomAbove > 300 ? 'up' : 'down' })
                            }}
                            aria-label="React to this message"
                            title="React"
                            className={cn(
                              'grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-3 transition-opacity hover:bg-surface-2 hover:text-text-1',
                              pickerOpen ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover/msg:opacity-100',
                            )}
                          >
                            <SmilePlus size={14} />
                          </button>
                        )}
                        <div className={cn(
                          'min-w-0 rounded-lg px-3 py-2 text-[13.5px] leading-5',
                          m.mine ? 'bg-primary text-on-primary' : 'border border-border bg-surface-2 text-text-1',
                          m.status === 'failed' && 'opacity-80 ring-1 ring-[var(--danger)]',
                        )}>
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          <p className={cn('mt-1 flex items-center gap-1 text-[10.5px]',
                            m.mine ? 'justify-end text-on-primary/70' : 'text-text-3')}>
                            {m.status === 'failed' ? failedWords(m).mark : at(m.created_at)}
                            {m.mine && m.status !== 'failed' && <Ticks saved={m.status === 'sent'} />}
                          </p>
                        </div>
                        {pickerOpen && (
                          <EmojiPicker
                            align={m.mine ? 'right' : 'left'}
                            side={picker.side}
                            onPick={(glyph) => { rememberEmoji(glyph); react(m.id, glyph) }}
                            onClose={() => setPicker(null)}
                          />
                        )}
                      </div>
                      {m.status === 'failed' && m.client_id && (
                        <p data-not-sent className="mt-1 flex items-center gap-1.5 text-[11.5px] text-[var(--danger)]">
                          {failedWords(m).line}
                          <button
                            onClick={() => open && liveApi()?.retry(open, m.client_id!)}
                            title={failedWords(m).retryTitle}
                            className="inline-flex items-center gap-1 font-semibold underline"
                          >
                            <RotateCw size={11} /> Retry
                          </button>
                        </p>
                      )}
                      {m === lastSeen && m.read_at && (
                        <p className="mt-0.5 text-[10.5px] text-text-3">Seen {at(m.read_at)}</p>
                      )}
                      {marks.length > 0 && (
                        <div className={cn('mt-1 flex flex-wrap gap-1', m.mine ? 'justify-end' : 'justify-start')}>
                          {marks.map(([glyph, ids]) => {
                            const isMine = ids.some((id) => me.includes(id))
                            return (
                              <button
                                key={glyph}
                                onClick={() => react(m.id, glyph)}
                                title={isMine ? 'Remove your reaction' : 'React with ' + glyph}
                                className={cn(
                                  'flex h-6 items-center gap-1 rounded-full border px-1.5 text-[12px] transition-colors',
                                  isMine ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-surface-2 text-text-2 hover:bg-surface-3',
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

              <div className="border-t border-border p-2.5">
                <div className="relative flex items-end gap-2">
                  {picker?.kind === 'composer' && (
                    <EmojiPicker
                      onPick={(glyph) => {
                        rememberEmoji(glyph)
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
                    disabled={!draft.trim() || !canSend}
                    aria-label="Send"
                    className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-md bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** One tick the moment it is typed (the other end sees it already); two once the sheet has it. */
function Ticks({ saved }: { saved: boolean }) {
  const label = saved ? 'Delivered' : 'On its way'
  return (
    <span role="img" aria-label={label} title={label} data-ticks={saved ? 2 : 1} className="inline-flex shrink-0">
      {saved ? <CheckCheck size={12} aria-hidden /> : <Check size={12} aria-hidden />}
    </span>
  )
}

/** The platform's round person icon with the green dot (a person is never a square). */
function PresenceAvatar({ name, src, online }: { name: string; src?: string; online?: boolean }) {
  return (
    <span className="relative shrink-0">
      <Avatar src={src} name={name || '?'} size="sm" />
      <span
        aria-hidden
        className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface', online ? 'bg-tint-fg-mint' : 'bg-border')}
      />
    </span>
  )
}
