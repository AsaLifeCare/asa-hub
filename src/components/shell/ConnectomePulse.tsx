// THE CONNECTOME PULSE — the Neural Cortex's live heartbeat, read-only, inside the Copilot sheet.
// Admins only: the connectome is a map of the whole platform's nervous system, so the relay itself refuses anyone…
import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'

interface MeshLive {
  mesh_brain?: {
    leader_name?: string
    fibers_live?: number
    fibers_total?: number
    audit_flags_24h?: number
  }
  synapses?: { candidates?: number; confirmed?: number }
  activity?: { events_per_min?: number }
}

const POLL_MS = 30_000

export default function ConnectomePulse() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const isAdmin = Boolean(user?.isMaster || user?.role === 'admin')
  const [live, setLive] = useState<MeshLive | null>(null)

  useEffect(() => {
    if (!isAdmin || !token) return
    let stop = false
    const load = async () => {
      try {
        const res = await fetch('/cortex/mesh/live', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = (await res.json()) as MeshLive
        if (!stop) setLive(data)
      } catch { /* a cortex we cannot reach is a card we do not draw */ }
    }
    void load()
    const t = window.setInterval(load, POLL_MS)
    return () => {
      stop = true
      window.clearInterval(t)
    }
  }, [isAdmin, token])

  if (!isAdmin || !live) return null
  const brain = live.mesh_brain ?? {}
  const syn = live.synapses ?? {}
  const epm = live.activity?.events_per_min

  const stat = (label: string, value: string | number | undefined) => (
    <div className="flex flex-col items-center rounded-md bg-surface px-2 py-1.5">
      <span className="text-[13px] font-semibold text-text-1">{value ?? '—'}</span>
      <span className="text-[10px] uppercase tracking-wide text-text-3">{label}</span>
    </div>
  )

  return (
    <div className="mx-4 mb-4 mt-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
          <Activity size={12} className="text-tint-fg-lavender" /> Connectome
        </p>
        {brain.leader_name && (
          <span className="text-[11px] text-text-3" title="The mesh brain's elected leader">
            brain: {brain.leader_name}
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {stat('fibers', brain.fibers_live != null && brain.fibers_total != null
          ? `${brain.fibers_live}/${brain.fibers_total}` : undefined)}
        {stat('synapses', syn.confirmed)}
        {stat('events/min', epm != null ? Math.round(epm) : undefined)}
        {stat('flags 24h', brain.audit_flags_24h)}
      </div>
    </div>
  )
}
