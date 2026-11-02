// The Cortex app's conversation room — a redesign of the house, not of the door.
// Same engine the Copilot star opens (CortexChat) — the send path, the session id and the shelf are untouched.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { History, Plus, Search, Sparkles, Trash2, Waypoints } from 'lucide-react'
import CortexChat, { cortexSessionKey, mintCortexSession } from '@/components/shell/CortexChat'
import { useAuthStore } from '@/auth/useAuthStore'
import { useCortexDialogs } from '@/stores/useCortexDialogs'
import { ohioDay, ohioTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'

function stamp(iso: string): string {
  if (!iso) return ''
  const day = ohioDay(iso)
  const time = ohioTime(iso)
  return [day, time].filter(Boolean).join(' · ')
}

export default function CortexChatPage() {
  const user = useAuthStore((s) => s.user)
  const uid = String(user?.id ?? '')
  const isAdmin = Boolean(user?.isMaster || user?.role === 'admin')
  const dialogs = useCortexDialogs((s) => s.dialogs)
  const hydrate = useCortexDialogs((s) => s.hydrate)
  const forget = useCortexDialogs((s) => s.forget)
  const [sessionId, setSessionId] = useState('')
  const [q, setQ] = useState('')
  const [showRail, setShowRail] = useState(false)

  useEffect(() => {
    if (!uid) return
    hydrate(uid)
    try {
      const held = localStorage.getItem(cortexSessionKey(uid))
      if (held) {
        setSessionId(held)
        return
      }
      const fresh = mintCortexSession()
      localStorage.setItem(cortexSessionKey(uid), fresh)
      setSessionId(fresh)
    } catch {
      setSessionId(mintCortexSession())
    }
  }, [uid, hydrate])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return dialogs
    return dialogs.filter((d) => d.title.toLowerCase().includes(needle))
  }, [dialogs, q])

  const openDialog = (id: string) => {
    setSessionId(id)
    try { localStorage.setItem(cortexSessionKey(uid), id) } catch { /* the visit still works */ }
    setShowRail(false)
  }

  const fresh = () => {
    const id = mintCortexSession()
    setSessionId(id)
    try { localStorage.setItem(cortexSessionKey(uid), id) } catch { /* */ }
    setShowRail(false)
  }

  const drop = (id: string) => {
    forget(uid, id)
    if (id === sessionId) fresh()
  }

  // fits the viewport: the chrome, 2.5rem for the shell's copyright line, and the strip at the top while it is up
  return (
    <div className="flex h-[calc(100dvh-140px-2.5rem-var(--hub-strip-h,0px))] min-h-[420px] flex-col">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-[30px] tracking-[-0.015em] text-text-1">
            Cortex
          </h1>
          <p className="mt-1 text-[13px] text-text-2">
            Ask the platform's own intelligence — every conversation stays on this machine, under your account.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              to="/app/cortex/connectome"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
            >
              <Waypoints size={13} /> Connectome
            </Link>
          )}
          <button
            onClick={() => setShowRail((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 md:hidden"
          >
            <History size={13} /> Conversations
          </button>
          <button
            onClick={fresh}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover"
          >
            <Plus size={13} /> New
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <aside
          className={cn(
            'flex w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface',
            showRail ? 'flex' : 'hidden md:flex',
          )}
        >
          <div className="border-b border-border p-2.5">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5">
              <Search size={14} className="shrink-0 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search conversations…"
                className="h-8 w-full bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              />
            </div>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {shown.length === 0 && (
              <div className="px-3 py-8 text-center">
                <Sparkles size={16} className="mx-auto text-tint-fg-lavender" />
                <p className="mt-2 text-[12.5px] text-text-3">
                  {dialogs.length === 0
                    ? 'Nothing yet — the first thing you ask becomes a conversation here.'
                    : 'Nothing matches that.'}
                </p>
              </div>
            )}
            {shown.map((d) => (
              <div
                key={d.id}
                className={cn(
                  'group relative rounded-lg transition-colors',
                  d.id === sessionId ? 'bg-surface-2' : 'hover:bg-surface-2/70',
                )}
              >
                <button
                  onClick={() => openDialog(d.id)}
                  className="flex w-full flex-col items-start gap-0.5 px-2.5 py-2 pr-8 text-left"
                >
                  <span className="clamp-1 w-full text-[13px] font-semibold text-text-1">{d.title}</span>
                  <span className="text-[11px] text-text-3">
                    {d.turns.length} turn{d.turns.length === 1 ? '' : 's'}
                    {d.at ? ` · ${stamp(d.at)}` : ''}
                  </span>
                </button>
                <button
                  onClick={() => drop(d.id)}
                  title="Remove from this machine"
                  className="absolute right-1.5 top-2 grid h-6 w-6 place-items-center rounded-md text-text-3 opacity-100 transition-opacity hover:bg-surface hover:text-text-1 md:opacity-0 md:group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col', showRail && 'hidden md:flex')}>
          {sessionId ? (
            <CortexChat variant="room" sessionId={sessionId} onSessionChange={setSessionId} />
          ) : (
            <div className="grid flex-1 place-items-center rounded-xl border border-border bg-surface">
              <p className="text-[13px] text-text-3">Opening the conversation…</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
