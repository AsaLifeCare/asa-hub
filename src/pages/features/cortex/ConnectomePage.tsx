// The Connectome — the Neural Cortex's wiring diagram, read-only — what the cortex says about itself: the five…
// The relay answers admins alone, so the page says that plainly instead of spinning forever.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { Activity, Brain, MessagesSquare, Search } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { Badge } from '@/components/shared/Badge'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { TintName } from '@/engine/types'

interface Fiber { id: string; name: string; state: string; desc: string }
interface MeshNode {
  id: string
  label: string
  group: string
  classification: string
  publishes: boolean
  subscribes: boolean
  synapse_wired: boolean
}
interface Graph {
  fibers: Fiber[]
  nodes: MeshNode[]
  edges: { source: string; target: string; kind: string; weight: number }[]
  counts: Record<string, number>
}
interface Live { activity?: { events_per_min?: number }; mesh_brain?: { leader_name?: string } }

const CLASS_META: Record<string, { tint: TintName; label: string; dot: string }> = {
  meshed: { tint: 'mint', label: 'meshed', dot: 'bg-emerald-500' },
  source_only: { tint: 'blue', label: 'source', dot: 'bg-sky-500' },
  sink_only: { tint: 'amber', label: 'sink', dot: 'bg-amber-500' },
  silo: { tint: 'pink', label: 'silo', dot: 'bg-rose-400' },
}
const FIBER_TINT: Record<string, string> = {
  live: 'text-emerald-600 bg-emerald-500/10',
  armed: 'text-amber-600 bg-amber-500/10',
  shadow: 'text-text-3 bg-surface-2',
}
const GROUP_ORDER = ['fabric', 'cortex', 'cognition', 'metacognition']
const GROUP_COPY: Record<string, string> = {
  fabric: 'The wires — transport, presence, the mesh itself',
  cortex: 'The mind — modules that think, remember, decide',
  cognition: 'The work — what gets known, filed, taught',
  metacognition: 'The watch — the mind looking at itself',
}

export default function ConnectomePage() {
  const token = useAuthStore((s) => s.token)
  const [graph, setGraph] = useState<Graph | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [refused, setRefused] = useState<number | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!token) return
    let stop = false
    const load = async () => {
      try {
        const [g, l] = await Promise.all([
          fetch('/cortex/mesh/graph', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/cortex/mesh/live', { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (!g.ok) {
          if (!stop) setRefused(g.status)
          return
        }
        const gj = (await g.json()) as Graph
        const lj = l.ok ? ((await l.json()) as Live) : null
        if (!stop) {
          setGraph(gj)
          setLive(lj)
          setRefused(null)
        }
      } catch { /* a cortex we cannot reach leaves the last good reading up */ }
    }
    void load()
    const t = window.setInterval(load, 30_000)
    return () => {
      stop = true
      window.clearInterval(t)
    }
  }, [token])

  const groups = useMemo(() => {
    if (!graph) return []
    const needle = q.trim().toLowerCase()
    const byGroup = new Map<string, MeshNode[]>()
    for (const n of graph.nodes) {
      if (needle && !`${n.label} ${n.id}`.toLowerCase().includes(needle)) continue
      const list = byGroup.get(n.group) ?? []
      list.push(n)
      byGroup.set(n.group, list)
    }
    return [...byGroup.entries()].sort(
      (a, b) =>
        (GROUP_ORDER.indexOf(a[0]) === -1 ? 99 : GROUP_ORDER.indexOf(a[0])) -
        (GROUP_ORDER.indexOf(b[0]) === -1 ? 99 : GROUP_ORDER.indexOf(b[0])),
    )
  }, [graph, q])

  const backToChat = (
    <Link
      to="/app/cortex/chat"
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
    >
      <MessagesSquare size={13} /> Chat
    </Link>
  )

  if (refused !== null && !graph) {
    return (
      <div>
        <div className="mb-4">{backToChat}</div>
        <EmptyState
          title={refused === 403 ? 'The connectome answers to admins only' : 'The cortex did not answer'}
          body={
            refused === 403
              ? 'This map shows the whole platform’s nervous system, so the door is narrow on purpose.'
              : 'The cortex is unreachable from here right now — the page retries on its own every 30 seconds.'
          }
        />
      </div>
    )
  }
  if (!graph) {
    return (
      <div>
        <div className="mb-4">{backToChat}</div>
        <EmptyState title="Reading the connectome…" body="The cortex is being asked how it is wired." />
      </div>
    )
  }

  const counts = graph.counts ?? {}
  const epm = live?.activity?.events_per_min
  const stats: { label: string; value: string | number; hint: string }[] = [
    { label: 'nodes', value: counts.total ?? graph.nodes.length, hint: 'modules on the mesh' },
    { label: 'meshed', value: counts.meshed ?? '—', hint: 'publish and subscribe' },
    { label: 'source-only', value: counts.source_only ?? '—', hint: 'speak, never hear' },
    { label: 'sink-only', value: counts.sink_only ?? '—', hint: 'hear, never speak' },
    { label: 'silos', value: counts.silo ?? '—', hint: 'wired to nothing' },
    { label: 'events/min', value: epm != null ? Math.round(epm) : '—', hint: 'live pulse' },
  ]

  return (
    <div className="w-full pb-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
        className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-violet-400/15 to-transparent p-7 sm:p-8"
      >
        <span className="absolute -right-6 -top-6 grid h-28 w-28 place-items-center rounded-full bg-tint-lavender">
          <Brain size={40} className="text-tint-fg-lavender opacity-60" />
        </span>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[24px] font-bold leading-7 tracking-[-0.015em] text-text-1">
              Connectome
            </h1>
            <p className="mt-2 max-w-[520px] text-[13.5px] leading-6 text-text-2">
              How the Neural Cortex is wired — five fibers, every module's place, and the pulse right now.
              A grouped reading, not a hairball.
            </p>
            {live?.mesh_brain?.leader_name && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-text-3">
                <Activity size={13} className="text-tint-fg-lavender" />
                leader · {live.mesh_brain.leader_name}
              </p>
            )}
          </div>
          {backToChat}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-surface px-3 py-2.5">
              <p className="font-stat text-[20px] font-bold leading-6 text-text-1">{s.value}</p>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{s.label}</p>
              <p className="mt-0.5 text-[10.5px] text-text-3">{s.hint}</p>
            </div>
          ))}
        </div>
      </motion.div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {graph.fibers.map((f) => (
          <Card key={f.id} padded={false} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13.5px] font-semibold text-text-1">{f.name}</p>
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', FIBER_TINT[f.state] ?? FIBER_TINT.shadow)}>
                {f.state}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] leading-5 text-text-3">{f.desc}</p>
          </Card>
        ))}
      </div>

      <div className="mt-7 mb-3 flex flex-wrap items-center gap-3">
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5">
          <Search size={14} className="shrink-0 text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a module…"
            className="w-full bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(CLASS_META).map(([k, m]) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-text-3">
              <span className={cn('h-2 w-2 rounded-full', m.dot)} /> {m.label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-7">
        {groups.map(([group, nodes]) => (
          <section key={group}>
            <div className="mb-2.5">
              <p className="text-[13px] font-semibold capitalize text-text-1">
                {group} <span className="font-normal text-text-3">· {nodes.length}</span>
              </p>
              {GROUP_COPY[group] && (
                <p className="mt-0.5 text-[12px] text-text-3">{GROUP_COPY[group]}</p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {nodes.map((n) => {
                const meta = CLASS_META[n.classification]
                return (
                  <div
                    key={n.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong"
                    title={`${n.id} — publishes: ${n.publishes ? 'yes' : 'no'}, subscribes: ${n.subscribes ? 'yes' : 'no'}${n.synapse_wired ? ', synapse-wired' : ''}`}
                  >
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', meta?.dot ?? 'bg-surface-2')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-text-1">{n.label}</p>
                      <p className="truncate font-mono text-[10.5px] text-text-3">{n.id}</p>
                    </div>
                    {meta && <Badge label={meta.label} tint={meta.tint} />}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
