// NEW ENTITIES — releasing people into the process, several at a time.
// The New Entities button releases a chosen few people into the process: either picked one by one, or simply the…
import { useMemo, useState } from 'react'
import { Loader2, UserPlus, X } from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { gasAction } from '@/features/hiring/shared'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'
import { toast } from '@/stores/useToastStore'
import type { CrossingPerson, CrossingQueue } from './flow/shared'

// The shortcut: the five most recent.
const RECENT = 5

const keyOf = (p: CrossingPerson) => p.tp_candidate_id || p.srid || p.name

export default function NewEntitiesModal({ crossing, onClose, onCrossed }: {
  crossing: CrossingQueue | null | false
  onClose: () => void
  /** Told after ANY release lands, so the board behind re-reads. */
  onCrossed: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState(0)
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')

  // Belt as well as braces: the page normalises the read, and this refuses to trust it anyway.
  const ready = useMemo(
    () => (crossing && Array.isArray(crossing.ready) ? crossing.ready : []),
    [crossing])
  const needle = q.trim().toLowerCase()
  const shown = useMemo(
    () => (needle ? ready.filter((p) => p.name.toLowerCase().includes(needle)) : ready),
    [ready, needle])

  // The five newest signatures.
  const recentFive = useMemo(() => {
    const withDay = ready.filter((p) => p.signed_at)
    const sorted = [...withDay].sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))
    return sorted.slice(0, RECENT).map(keyOf)
  }, [ready])

  const toggle = (k: string) => {
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k); else n.add(k)
      return n
    })
  }

  const release = async () => {
    if (busy || picked.size === 0) return
    setBusy(true); setAt(0); setFailed({})
    const list = ready.filter((p) => picked.has(keyOf(p)))
    let moved = 0, matched = 0
    const refusals: Record<string, string> = {}
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      setAt(i + 1)
      try {
        const d = await gasAction<{ moved?: boolean; matched_existing?: boolean }>(
          'talentCrossIn',
          p.tp_candidate_id ? { tp_candidate_id: p.tp_candidate_id } : { srid: p.srid },
          { timeoutMs: 120000 })
        if (d.matched_existing) matched++
        else if (d.moved) moved++
        // A RECEIPT IS NOT A RESULT: anything that is neither is a refusal, and it stays on the person's own row…
        else refusals[keyOf(p)] = 'The server did not confirm it. Nothing was written for them.'
      } catch (e) {
        refusals[keyOf(p)] = e instanceof Error ? e.message : 'The release failed for them.'
      }
    }
    setFailed(refusals)
    // Everybody who landed leaves this list, so the picks that succeeded are dropped and the ones that did not stay…
    setPicked(new Set(Object.keys(refusals)))
    setBusy(false); setAt(0)
    invalidate('candidates'); invalidate('talentPool')
    noteWrite('candidates'); noteWrite('talentPool')
    onCrossed()
    const failedCount = Object.keys(refusals).length
    toast({
      type: failedCount && !moved && !matched ? 'danger' : 'success',
      title: moved || matched
        ? `${moved + matched} released into the process`
        : 'Nobody was released',
      body: [
        moved ? `${moved} new card${moved === 1 ? '' : 's'}` : '',
        matched ? `${matched} already had one — their notas crossed onto it` : '',
        failedCount ? `${failedCount} refused, named on their own rows` : '',
      ].filter(Boolean).join(' · '),
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className="flex h-[min(88vh,900px)] w-full max-w-6xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2">
          <h2 className="text-[14px] font-bold text-text-1">New entities</h2>
          <p className="min-w-0 flex-1 truncate text-[12px] text-text-3">
            The people waiting at the door — the legacy store and the signed applications nobody
            picked up. Tick who goes in; one press releases them all.
          </p>
          <button onClick={onClose} className="text-text-3 hover:text-text-1"><X size={16} /></button>
        </div>

        <Card className="flex min-h-0 flex-1 flex-col p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold', TINT_BG.mint, TINT_FG.mint)}>
              {ready.length} waiting
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a name…"
              className="w-44 rounded-md border border-border bg-surface px-2 py-1 text-[12.5px] text-text-1 outline-none focus:border-primary"
            />
            <button
              onClick={() => setPicked(new Set(recentFive))}
              disabled={busy || recentFive.length === 0}
              title="The five newest signed applications"
              className="rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
            >
              The last {RECENT}
            </button>
            <button
              onClick={() => setPicked(new Set(shown.map(keyOf)))}
              disabled={busy || shown.length === 0}
              className="rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
            >
              Select all{needle ? ' shown' : ''}
            </button>
            <button
              onClick={() => setPicked(new Set())}
              disabled={busy || picked.size === 0}
              className="rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
            >
              Clear
            </button>
            <button
              onClick={() => void release()}
              disabled={busy || picked.size === 0}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-on-primary disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              {busy ? `Releasing ${at} of ${picked.size}…` : `Release ${picked.size || ''} into the process`}
            </button>
          </div>

          {crossing === null && (
            <p className="px-3 py-8 text-center text-[12.5px] italic text-text-3">Reading the line at the door…</p>
          )}
          {crossing === false && (
            <p className="px-3 py-8 text-center text-[12.5px] text-warning">
              The Talent Pipeline could not be read. That is not an empty queue — it is a read that
              failed, and the difference matters.
            </p>
          )}

          {crossing && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 hidden grid-cols-[28px_minmax(0,1.3fr)_minmax(0,0.9fr)_115px_minmax(0,1.1fr)_120px] items-center gap-3 border-b border-border/60 bg-surface px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3 sm:grid">
                <span />
                <span>Candidate</span>
                <span>Where they come from</span>
                <span>Phone</span>
                <span>Background check</span>
                <span>Goes to</span>
              </div>
              {shown.length === 0 && (
                <p className="px-3 py-8 text-center text-[12.5px] italic text-text-3">
                  {ready.length === 0
                    ? 'Nobody is waiting at the door right now.'
                    : 'Nothing matches that search.'}
                </p>
              )}
              <div className="divide-y divide-border/60">
                {shown.map((p) => {
                  const k = keyOf(p)
                  const on = picked.has(k)
                  return (
                    <label
                      key={k}
                      className={cn(
                        'grid cursor-pointer grid-cols-1 items-center gap-x-3 gap-y-0.5 px-3 py-2 hover:bg-surface-2/50',
                        'sm:grid-cols-[28px_minmax(0,1.3fr)_minmax(0,0.9fr)_115px_minmax(0,1.1fr)_120px]',
                        on && 'bg-surface-2/60',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={busy}
                        onChange={() => toggle(k)}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={p.name} size="xs" />
                        <span className="truncate text-[12.5px] font-semibold text-text-1" title={p.name}>
                          {p.name}
                          {p.nota && <span className="ml-1.5 font-normal text-text-3">nota {p.nota}</span>}
                        </span>
                      </span>
                      <span className="truncate text-[12px] text-text-2"
                            title={p.source === 'application' ? p.landing_why : p.legacy_status}>
                        {p.source === 'application'
                          ? `applied · signed ${p.signed_at || '—'}`
                          : (p.legacy_status || 'the legacy store')}
                      </span>
                      <span className="truncate text-[12px] tabular-nums text-text-3">{formatPhoneDisplay(p.phone) || '—'}</span>
                      <span className="truncate text-[12px] text-text-3" title={p.cjis}>{p.cjis || '—'}</span>
                      <span
                        className={cn('truncate rounded-full px-2 py-0.5 text-center text-[11px] font-bold',
                          p.landing === 'ready' ? cn(TINT_BG.mint, TINT_FG.mint) : cn(TINT_BG.blue, TINT_FG.blue))}
                        title={p.landing_why}
                      >
                        {p.landing === 'ready' ? 'Ready to start' : 'New'}
                      </span>
                      {failed[k] && (
                        <span className="col-span-full text-[11.5px] text-danger">{failed[k]}</span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
