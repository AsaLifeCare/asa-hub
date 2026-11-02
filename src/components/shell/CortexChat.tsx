// THE CORTEX CHAT — the Copilot star's own conversation with the platform's Neural Cortex — the chat brought over…
// TWO DOORS, ONE ENGINE.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, RotateCcw, Send, Sparkles, Square, History, Volume2 } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import { useCortexDialogs } from '@/stores/useCortexDialogs'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export interface CortexChatProps {
  /** compact = Copilot sheet; room = the Cortex app's conversation pane. */
  variant?: 'compact' | 'room'
  // Parent-owned dialog (the app's history rail).
  sessionId?: string
  onSessionChange?: (id: string) => void
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
}

const STARTERS = [
  'Who is on shift this week?',
  'Which certifications expire in the next 30 days?',
  'What is open in hiring right now?',
  // the HR dossier's entry point (kill list 6): the scoped ask rides the same /cortex/chat/send door as every other…
  'Summarize the current HR issues — who is flagged most often, and what is still open?',
]

export function mintCortexSession(): string {
  return `DLG-hub-${Math.random().toString(16).slice(2, 14)}`
}

export function cortexSessionKey(uid: string): string {
  return `asa-cortex-session:${uid}`
}

function holdSession(uid: string, id: string) {
  try {
    localStorage.setItem(cortexSessionKey(uid), id)
  } catch { /* a session we cannot store is a session that lasts the visit */ }
}

/** Light markup the model already speaks — bold, code, bullets — no extra library. */
function CortexBody({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const bullet = /^[-*]\s+/.test(line)
        const body = bullet ? line.replace(/^[-*]\s+/, '') : line
        const bits = body.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) => {
          if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
            return <strong key={j} className="font-semibold">{p.slice(2, -2)}</strong>
          }
          if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
            return (
              <code key={j} className="rounded bg-surface-2 px-1 py-px font-mono text-[12px]">
                {p.slice(1, -1)}
              </code>
            )
          }
          return <span key={j}>{p}</span>
        })
        if (!line) return <div key={i} className="h-1.5" />
        return (
          <p key={i} className={cn('whitespace-pre-wrap break-words leading-5', bullet && 'pl-3')}>
            {bullet && <span className="mr-1.5 text-text-3">•</span>}
            {bits}
          </p>
        )
      })}
    </div>
  )
}

export default function CortexChat({
  variant = 'compact',
  sessionId: controlledId,
  onSessionChange,
}: CortexChatProps) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const uid = String(user?.id ?? '')
  const room = variant === 'room'
  const controlled = controlledId !== undefined
  // THE ID IS WRITTEN THE MOMENT IT IS MINTED.
  const [sessionId, setSessionIdInner] = useState(() => {
    if (controlledId) return controlledId
    try {
      const held = localStorage.getItem(cortexSessionKey(uid))
      if (held) return held
      const fresh = mintCortexSession()
      holdSession(uid, fresh)
      return fresh
    } catch {
      return mintCortexSession()
    }
  })
  const dialogs = useCortexDialogs((st) => st.dialogs)
  const hydrate = useCortexDialogs((st) => st.hydrate)
  const remember = useCortexDialogs((st) => st.remember)
  const syncDialogs = useCortexDialogs((st) => st.sync)
  const pullDialog = useCortexDialogs((st) => st.pull)
  const [showHistory, setShowHistory] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  // OPEN A DIALOG.
  const adopt = (id: string, nextTurns?: Turn[]) => {
    setSessionIdInner(id)
    const held = nextTurns ?? useCortexDialogs.getState().turnsOf(id)
    setTurns(held)
    onSessionChange?.(id)
    holdSession(uid, id)
    if (!nextTurns && !held.length && uid && token) {
      void pullDialog(uid, token, id).then((fetched) => {
        // never over a conversation that has started saying something while we were fetching — the setter reads the…
        if (fetched.length) setTurns((cur) => (cur.length ? cur : fetched))
      })
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [turns])

  // The person's own shelf, and the conversation they were in.
  useEffect(() => {
    if (!uid) return
    hydrate(uid)
    const held = useCortexDialogs.getState().turnsOf(sessionId)
    if (held.length) setTurns(held)
    if (!token) return
    void syncDialogs(uid, token).then(() => {
      if (useCortexDialogs.getState().turnsOf(sessionId).length) return
      void pullDialog(uid, token, sessionId).then((fetched) => {
        if (fetched.length) setTurns((cur) => (cur.length ? cur : fetched))
      })
    })
    // sessionId is stable for the life of a dialog; re-running on it would re-seed a conversation mid-flight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, token, hydrate, syncDialogs, pullDialog])

  /** a parent rail opened a different dialog — load it, never mid-flight */
  useEffect(() => {
    if (!controlled || !controlledId) return
    if (controlledId === sessionId) return
    setSessionIdInner(controlledId)
    const held = useCortexDialogs.getState().turnsOf(controlledId)
    setTurns(held)
    setShowHistory(false)
    if (!held.length && uid && token) {
      void pullDialog(uid, token, controlledId).then((fetched) => {
        if (fetched.length) setTurns((cur) => (cur.length ? cur : fetched))
      })
    }
  }, [controlled, controlledId, sessionId, uid, token, pullDialog])

  /** every settled turn goes to the shelf — never a pending one */
  useEffect(() => {
    if (!uid || !turns.length) return
    if (turns.some((t) => t.pending)) return
    remember(uid, sessionId, turns)
  }, [turns, uid, sessionId, remember])

  useEffect(() => {
    if (!room) return
    const el = areaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text, room])

  // Reopen a dialog from the shelf: the id travels so the server keeps answering into the same conversation, not a…
  const openDialog = (id: string) => {
    adopt(id)
    setShowHistory(false)
  }

  const reset = () => {
    adopt(mintCortexSession(), [])
    setText('')
  }

  const send = async (preset?: string) => {
    const message = (preset ?? text).trim()
    if (!message || busy || !token) return
    setText('')
    setBusy(true)
    setTurns((t) => [...t, { role: 'user', text: message }, { role: 'assistant', text: '', pending: true }])
    try {
      const res = await fetch('/cortex/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, session_id: sessionId }),
      })
      if (!res.ok || !res.body) {
        let note = `The cortex did not answer (${res.status}).`
        try {
          const j = await res.json()
          if (j?.message) note = String(j.message)
        } catch { /* the status alone is the answer */ }
        throw new Error(note)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const frame of frames) {
          let event = ''
          let data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          let payload: Record<string, unknown> = {}
          try {
            payload = JSON.parse(data)
          } catch { /* a frame we cannot read is a frame we skip */ }
          if (event === 'token' || event === 'delta') {
            const piece = String(payload.delta ?? payload.text ?? payload.content ?? '')
            if (piece) {
              setTurns((t) => {
                const next = [...t]
                const last = next[next.length - 1]
                if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: last.text + piece }
                return next
              })
            }
          } else if (event === 'complete' || event === 'response') {
            // The non-token lanes answer whole.
            const whole = String(payload.response ?? '')
            if (whole) {
              setTurns((t) => {
                const next = [...t]
                const last = next[next.length - 1]
                if (last?.role === 'assistant' && !last.text) next[next.length - 1] = { ...last, text: whole }
                return next
              })
            }
          } else if (event === 'error') {
            throw new Error(String(payload.message ?? 'The cortex reported an error.'))
          }
        }
      }
      setTurns((t) => {
        const next = [...t]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') {
          next[next.length - 1] = {
            ...last,
            pending: false,
            text: last.text || 'The cortex answered with silence — try rephrasing.',
          }
        }
        return next
      })
    } catch (err) {
      setTurns((t) => {
        const next = [...t]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') {
          next[next.length - 1] = {
            ...last,
            pending: false,
            text: last.text || `Could not reach the cortex: ${err instanceof Error ? err.message : 'unknown error'}`,
          }
        }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  // THE VOICE LANE (kill list, item 2).

  const [recording, setRecording] = useState(false)
  const [speaking, setSpeaking] = useState<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stopRecording = () => {
    recorderRef.current?.stop()
  }

  const startRecording = async () => {
    if (recording || busy) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      toast({ type: 'warning', title: 'No microphone', body: 'The browser refused the mic — check the permission.' })
      return
    }
    try {
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size) void transcribe(blob)
      }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      toast({ type: 'warning', title: 'Could not record', body: 'This browser has no MediaRecorder.' })
    }
  }

  const transcribe = async (blob: Blob) => {
    if (!token) return
    setBusy(true)
    try {
      const form = new FormData()
      form.append('audio', blob, 'clip.webm')
      const res = await fetch('/cortex/chat/voice/transcribe?bias=1', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const env = await res.json().catch(() => ({}))
      const words = String(env.text ?? '').trim()
      if (!res.ok || env.ok === false || !words) {
        throw new Error(String(env.error || env.message || `transcribe failed (${res.status})`))
      }
      setText((cur) => (cur.trim() ? `${cur.trim()} ${words}` : words))
    } catch (err) {
      toast({ type: 'danger', title: 'No transcript', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const speak = async (turnIndex: number, words: string) => {
    if (!token || speaking !== null) return
    setSpeaking(turnIndex)
    try {
      audioRef.current?.pause()
      const res = await fetch('/cortex/chat/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: words, format: 'mp3' }),
      })
      const ctype = res.headers.get('content-type') || ''
      if (!res.ok || !ctype.includes('audio')) {
        const env = await res.json().catch(() => ({}))
        throw new Error(String(env.error || env.message || `speak failed (${res.status})`))
      }
      const url = URL.createObjectURL(await res.blob())
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => { URL.revokeObjectURL(url); setSpeaking(null) }
      audio.onerror = () => { URL.revokeObjectURL(url); setSpeaking(null) }
      await audio.play()
    } catch (err) {
      setSpeaking(null)
      toast({ type: 'danger', title: 'No audio', body: err instanceof Error ? err.message : 'Try again.' })
    }
  }

  const title = dialogs.find((d) => d.id === sessionId)?.title || 'New conversation'

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden border border-border',
        room
          ? 'rounded-xl bg-surface'
          : 'mx-4 mt-4 rounded-lg bg-surface-2',
      )}
    >
      <div className="relative flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-tint-lavender">
            <Sparkles size={13} className="text-tint-fg-lavender" />
          </span>
          <div className="min-w-0">
            <p className={cn('truncate font-semibold text-text-1', room ? 'text-[13.5px]' : 'text-[11px] uppercase tracking-wide text-text-3')}>
              {room ? title : 'Ask the platform'}
            </p>
            {room && (
              <p className="truncate text-[11px] text-text-3">
                {busy ? 'Thinking…' : 'The platform\'s own intelligence'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {/* OLD CONVERSATIONS. The room lists them
              on the page rail; the star still needs this popover. */}
          {!room && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              title={dialogs.length ? `${dialogs.length} earlier conversation(s)` : 'No earlier conversations yet'}
              className={cn(
                'grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-surface hover:text-text-1',
                showHistory ? 'bg-surface text-text-1' : 'text-text-3',
              )}
            >
              <History size={13} />
            </button>
          )}
          <button
            onClick={reset}
            title="New conversation"
            className="grid h-7 w-7 place-items-center rounded-full text-text-3 transition-colors hover:bg-surface hover:text-text-1"
          >
            <RotateCcw size={13} />
          </button>
        </div>
        {showHistory && !room && (
          <div className="absolute right-2 top-10 z-20 max-h-[320px] w-[260px] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
            {dialogs.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-text-3">
                Nothing yet — the conversations you have here will be listed, newest first.
              </p>
            ) : dialogs.map((d) => (
              <button
                key={d.id}
                onClick={() => openDialog(d.id)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                  d.id === sessionId && 'bg-surface-2',
                )}
              >
                <span className="clamp-1 w-full text-[12.5px] font-medium text-text-1">{d.title}</span>
                <span className="text-[11px] text-text-3">
                  {d.turns.length} turn{d.turns.length === 1 ? '' : 's'} · {String(d.at).slice(0, 10)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto', room ? 'px-5 py-5' : 'px-3 py-3')}>
        {turns.length === 0 && (
          <div className={cn('flex h-full flex-col items-center justify-center text-center', room && 'px-4')}>
            <span className={cn('grid place-items-center rounded-full bg-tint-lavender', room ? 'h-14 w-14' : 'h-10 w-10')}>
              <Sparkles size={room ? 22 : 18} className="text-tint-fg-lavender" />
            </span>
            <p className={cn('mt-3 font-semibold text-text-1', room ? 'font-display text-[18px]' : 'text-[13px]')}>
              Ask anything across the platform
            </p>
            <p className={cn('mt-1 leading-5 text-text-3', room ? 'max-w-[340px] text-[13px]' : 'max-w-[260px] text-[12px]')}>
              People, shifts, clients, hiring — the cortex answers from the platform's own records.
            </p>
            {room && (
              <div className="mt-5 flex w-full max-w-[420px] flex-col gap-1.5">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    disabled={busy || !token}
                    className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-[12.5px] text-text-2 transition-colors hover:border-border-strong hover:bg-surface hover:text-text-1 disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <ul className={cn(room ? 'space-y-3' : 'space-y-2.5')}>
          {turns.map((t, i) => (
            <li key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start gap-2'}>
              {t.role === 'assistant' && room && (
                <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-tint-lavender">
                  <Sparkles size={12} className="text-tint-fg-lavender" />
                </span>
              )}
              <div
                className={cn(
                  'text-[13px] leading-5',
                  t.role === 'user'
                    ? cn(
                        'bg-tint-lavender text-tint-fg-lavender',
                        room ? 'max-w-[min(560px,78%)] rounded-2xl rounded-br-md px-4 py-2.5' : 'max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2',
                      )
                    : cn(
                        'border border-border bg-surface text-text-1',
                        room ? 'max-w-[min(640px,88%)] rounded-2xl rounded-bl-md px-4 py-2.5' : 'max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2',
                      ),
                )}
              >
                {t.pending && !t.text ? (
                  <span className="inline-flex items-center gap-1.5 text-text-3">
                    <Loader2 size={13} className="animate-spin" /> Thinking…
                  </span>
                ) : t.role === 'assistant' ? (
                  <span className="block">
                    <CortexBody text={t.text} />
                    {t.text && (
                      <button
                        onClick={() => void speak(i, t.text)}
                        disabled={speaking !== null}
                        title="Hear this reply"
                        className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-40"
                      >
                        {speaking === i
                          ? <Loader2 size={11} className="animate-spin" />
                          : <Volume2 size={11} />}
                        {speaking === i ? 'Speaking…' : 'Listen'}
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{t.text}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div ref={bottomRef} />
      </div>
      <div className={cn('border-t border-border', room ? 'p-3' : 'p-2')}>
        <div className={cn(
          'flex w-full items-end gap-1.5',
          room && 'rounded-xl border border-border bg-surface-2 px-2.5 py-2 focus-within:border-border-strong',
        )}>
          {room ? (
            <textarea
              ref={areaRef}
              value={text}
              rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Ask the cortex…"
              className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1 py-0.5 text-[13px] text-text-1 outline-none placeholder:text-text-3"
            />
          ) : (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Ask the cortex…"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
            />
          )}
          <button
            onClick={recording ? stopRecording : () => void startRecording()}
            disabled={busy && !recording}
            title={recording ? 'Stop and transcribe' : 'Speak instead of typing'}
            className={cn(
              'grid h-8 w-8 shrink-0 place-items-center rounded-md border transition-colors disabled:opacity-40',
              recording
                ? 'animate-pulse border-danger bg-danger/10 text-danger'
                : 'border-border bg-surface text-text-2 hover:bg-surface-2',
            )}
          >
            {recording ? <Square size={13} /> : <Mic size={14} />}
          </button>
          <button
            onClick={() => void send()}
            disabled={busy || !text.trim()}
            title="Send"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>
        {room && (
          <p className="mt-1.5 px-1 text-[10.5px] text-text-3">Enter to send · Shift+Enter for a new line</p>
        )}
      </div>
    </div>
  )
}
