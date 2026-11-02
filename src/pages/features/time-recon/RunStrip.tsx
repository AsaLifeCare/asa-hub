// The run strip — the reconciliation runs over the dates on screen, newest first, and the button that runs one.
// A run is ONE PsiAnywhere pay period read from PsiAnywhere's own record (no file goes in any more: the "Cleaned
// Location" workbook was re-keyed every period and stored the same punch up to six times), so the button only offers
// itself when the dates are exactly one period. A newer run of a period supersedes the older one and carries its
// resolutions forward — `carried` says how many. "Close run" flips a run to Reviewed: a person's statement that the
// period's queue was worked, not a server verdict.
import { CheckCircle2, Loader2, Play } from 'lucide-react'
import Card from '@/components/shared/Card'
import { Badge } from '@/components/shared/Badge'
import { cn } from '@/lib/utils'
import {
  dayLabel, RECON_TYPES, runCounts, stampLabel, TYPE_META, type ReconRun,
} from './reconTypes'

const SHOWN = 10

export default function RunStrip({
  runs,
  loading,
  periodLabel,
  canRun,
  running,
  closing,
  lastAuto,
  onRun,
  onCloseRun,
}: {
  runs: ReconRun[]
  loading: boolean
  /** the pay period on screen ('10/25/26 – 11/07/26'), or '' when the dates are not one period */
  periodLabel: string
  canRun: boolean
  running: boolean
  /** the run being closed */
  closing: string
  lastAuto: { ranAt: string; said: string } | null
  onRun: () => void
  onCloseRun: (run: ReconRun) => void
}) {
  const list = runs.slice(0, SHOWN)
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-text-1">Runs</p>
          <p className="text-[12.5px] text-text-3">
            {lastAuto?.ranAt
              ? <>The daily run (this period and the one before) last ran {stampLabel(lastAuto.ranAt)}{lastAuto.said ? ` — ${lastAuto.said}` : ''}.</>
              : 'A run reads one pay period from PsiAnywhere against the house calendars.'}
          </p>
        </div>
        <button
          type="button" onClick={onRun} disabled={!canRun || running}
          title={canRun ? `Run the reconciliation over ${periodLabel}` : 'A run covers one pay period — pick one in the filters'}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Run reconciliation for this period
        </button>
      </div>
      {!canRun && (
        <p className="border-b border-border bg-surface-2/40 px-4 py-2 text-[12.5px] text-text-3">
          These dates are not one pay period, so nothing can be run over them — the queue shows what earlier runs found.
        </p>
      )}
      {loading && list.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-text-3">Reading the runs…</p>
      ) : list.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-text-3">
          No run covers these dates yet{canRun ? ' — run the reconciliation for this period.' : '.'}
        </p>
      ) : (
        <ul>
          {list.map((r, i) => {
            const counts = runCounts(r)
            const total = Number(r.total) || RECON_TYPES.reduce((s, t) => s + counts[t], 0)
            const carried = Number(r.carried) || 0
            // a run from before PsiAnywhere was the worked side says where its punches came from
            const legacy = !!r.source && !/psi/i.test(r.source)
            return (
              <li
                key={r.id}
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 last:border-0',
                  i > 0 && 'opacity-80',
                )}
              >
                <div className="min-w-[170px]">
                  <p className="text-[13.5px] font-semibold text-text-1">
                    {dayLabel(r.dateFrom)} – {dayLabel(r.dateTo)}
                    {i === 0 && <span className="ml-2 text-[11.5px] font-medium text-text-3">newest</span>}
                  </p>
                  <p className="text-[12px] text-text-3">
                    {stampLabel(r.createdAt)}{r.createdBy ? ` · ${r.createdBy}` : ''}
                    {legacy ? ` · ${r.source}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {RECON_TYPES.filter((t) => counts[t] > 0).map((t) => (
                    <Badge key={t} label={`${counts[t]} ${TYPE_META[t].label.toLowerCase()}`} tint={TYPE_META[t].tint} />
                  ))}
                  {total === 0 && <span className="text-[12.5px] font-medium text-tint-fg-mint">clean</span>}
                  {carried > 0 && (
                    <span className="text-[12px] text-text-3" title="Resolutions this run took over from the run it superseded">
                      {carried} carried forward
                    </span>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Badge label={r.status === 'Reviewed' ? 'Reviewed' : 'In review'} tint={r.status === 'Reviewed' ? 'mint' : 'amber'} />
                  {r.status !== 'Reviewed' && (
                    <button
                      type="button" onClick={() => onCloseRun(r)} disabled={!!closing}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
                    >
                      {closing === r.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Close run
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
