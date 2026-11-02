// TEST THE AI LANE — the button and its answer, in one place.
// WHY SHARED, when this codebase deliberately duplicates chrome: three surfaces ask the SAME question of the SAME…
import { useCallback, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { cn } from '@/lib/utils'

type Row = Record<string, unknown>

const VERDICT_CLASS: Record<string, string> = {
  ok: 'bg-tint-mint text-tint-fg-mint',
  throttled: 'bg-tint-amber text-tint-fg-amber',
  wrong_model: 'bg-tint-lavender text-tint-fg-lavender',
  sick: 'bg-tint-peach text-tint-fg-peach',
  dead: 'bg-tint-danger text-tint-fg-danger',
}

export default function AiLaneTest({ className, compact }: { className?: string; compact?: boolean }) {
  const [res, setRes] = useState<Row | null>(null)
  const [running, setRunning] = useState(false)

  const run = useCallback(async () => {
    setRunning(true)
    try {
      setRes(await gasAction<Row>('aiKeyStress', { rounds: 2 }, { timeoutMs: 180_000 }))
    } catch (e) {
      setRes({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(false)
    }
  }, [])

  const rows = (res?.rows as Row[] | undefined) ?? []
  const skipped = (res?.skipped as Row[] | undefined) ?? []
  const offered = (res?.models_offered as Record<string, string[]> | undefined) ?? {}
  const throttled = Number((res?.totals as Row | undefined)?.throttled ?? 0)

  return (
    <div className={className}>
      <button
        onClick={() => void run()}
        disabled={running}
        title="Fires real completions at every AI key the platform uses"
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3',
          'text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40',
        )}
      >
        <BrainCircuit size={13} className={running ? 'animate-pulse' : ''} />
        {running ? 'Testing the keys…' : 'Test the AI lane'}
      </button>

      {res && (
        <div className="mt-3">
          {res.error ? (
            <p className="text-[12.5px] text-rose-500">Could not run — {String(res.error)}</p>
          ) : (
            <>
              <p className="text-[13px] leading-5 text-text-1">{String(res.verdict_line ?? '')}</p>

              {/* The names to paste. This is the whole point of a run when a
                  model has been retired: an answer you can act on, not a
                  diagnosis you have to research. */}
              {Object.keys(offered).length > 0 && (
                <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                    The provider currently serves
                  </p>
                  {Object.entries(offered).map(([host, names]) => (
                    <p key={host} className="mt-1 break-words font-mono text-[11.5px] leading-5 text-text-2">
                      {(names ?? []).join('  ·  ') || '—'}
                    </p>
                  ))}
                </div>
              )}

              {rows.length > 0 && (
                <div className={cn('scroll-thin mt-3 overflow-y-auto', compact ? 'max-h-56' : 'max-h-72')}>
                  <table className="w-full border-collapse text-[11.5px]">
                    <thead>
                      <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                        <th className="px-2 py-1.5">Key</th>
                        <th className="px-2 py-1.5">Model sent</th>
                        <th className="px-2 py-1.5">Verdict</th>
                        <th className="px-2 py-1.5">What it said</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-b border-border/60 align-top last:border-0">
                          <td className="whitespace-nowrap px-2 py-1.5 text-text-1">
                            {String(r.provider ?? '')}
                            <span className="ml-1.5 font-mono text-[10.5px] text-text-3">
                              {String(r.key_masked ?? '')}
                            </span>
                            {r.retired ? (
                              <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[10px] text-text-3">retired</span>
                            ) : null}
                          </td>
                          <td className="max-w-[190px] break-words px-2 py-1.5 font-mono text-[10.5px] text-text-3">
                            {String(r.model ?? '')}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={cn(
                              'rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                              VERDICT_CLASS[String(r.verdict ?? '')] ?? 'bg-surface-2 text-text-2',
                            )}>
                              {String(r.verdict ?? '')}
                            </span>
                          </td>
                          <td className="max-w-[320px] break-words px-2 py-1.5 text-text-2">
                            {String(r.sample ?? '') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {skipped.length > 0 && (
                <p className="mt-2 text-[11.5px] text-text-3">
                  Not tested: {skipped.map((k) => `${String(k.provider)} (${String(k.why)})`).join(' · ')}
                </p>
              )}

              {/* A capped key is VALID. The screen says so, because the whole
                  reason the taxonomy exists is that somebody once binned one. */}
              {throttled > 0 && (
                <p className="mt-2 text-[11.5px] text-text-3">
                  A throttled key is valid and merely capped — it is never removed.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
