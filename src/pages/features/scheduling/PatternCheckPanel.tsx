// Pattern check: the pattern as it lands on the period — overlaps (here and at other houses), high and low hours…
// Approve unlocks Assign and Balance Shifts; Edit pattern goes back to the pattern.
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { shortDay, type Check } from './builderModel'
import { OUTLINE_BTN, PRIMARY_BTN, Refusal } from './SchedulingParts'

export function CheckCard({ title, count, none, warn = false, children }: {
  title: string
  count: number
  none: string
  warn?: boolean
  children?: ReactNode
}) {
  return (
    <section className="rounded-[14px] border border-border bg-surface p-3 shadow-1" data-check={title}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-text-1">{title}</h3>
        <span className={cn('grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-semibold',
          count ? (warn ? 'bg-tint-amber text-tint-fg-amber' : 'bg-tint-danger text-tint-fg-danger') : 'bg-tint-mint text-tint-fg-mint')}>
          {count}
        </span>
      </header>
      {count === 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-tint-fg-mint"><CheckCircle2 size={13} /> {none}</p>
      ) : <div className="mt-2">{children}</div>}
    </section>
  )
}

export function Lines({ rows }: { rows: [string, string][] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-md border border-border text-[12px]">
      {rows.map(([a, b], i) => (
        <li key={`${a}|${b}|${i}`} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
          <span className="min-w-0 font-medium text-text-1">{a}</span>
          <span className="shrink-0 text-right text-text-2">{b}</span>
        </li>
      ))}
    </ul>
  )
}

export default function PatternCheckPanel({ open, check, approved, busy, refusal, canApprove, onClose, onEdit, onApprove }: {
  open: boolean
  check: Check
  approved: boolean
  busy: boolean
  refusal: string
  canApprove: boolean
  onClose: () => void
  onEdit: () => void
  onApprove: () => void
}) {
  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className={OUTLINE_BTN} onClick={onEdit} data-act="edit-pattern">Edit pattern</button>
      <button type="button" className={PRIMARY_BTN} disabled={busy || !canApprove} onClick={onApprove} data-act="approve-pattern">
        {busy && <Loader2 size={13} className="animate-spin" />} {approved ? 'Approved — continue' : 'Approve'}
      </button>
    </div>
  )
  return (
    <SidePanel open={open} onClose={onClose} label="Pattern check" title="Pattern check" footer={footer}>
      <div className="grid gap-3" data-pattern-check="">
        <CheckCard title="Shift overlaps" count={check.overlaps.length} none="No overlapping shifts.">
          <Lines rows={check.overlaps.map((o) => [o.name, `${shortDay(o.date)} ${o.text} × ${o.with}`])} />
        </CheckCard>
        <CheckCard title="High hours" count={check.high.length} none="No staff above the hours range." warn>
          <Lines rows={check.high.map((h) => [h.name, `${h.avg} h/wk avg · max ${h.max} h`])} />
        </CheckCard>
        <CheckCard title="Low hours" count={check.low.length} none="No staff below 30 hours a week." warn>
          <Lines rows={[['Staff', 'Average weekly hrs'] as [string, string], ...check.low.map((h) => [h.name, `${h.avg.toFixed(1)} hrs`] as [string, string])]} />
        </CheckCard>
        <CheckCard title="Preference conflicts" count={check.prefs.length} none="No preference conflicts." warn>
          <Lines rows={check.prefs.map((p) => [p.name, `${shortDay(p.date)} ${p.text} — ${p.why}`])} />
        </CheckCard>
        <CheckCard title="Consecutive days" count={check.runs.length} none="No runs of 6 or more days." warn>
          <Lines rows={check.runs.map((r) => [r.name, `${r.days} days · ${shortDay(r.from)} – ${shortDay(r.to)}`])} />
        </CheckCard>
        <CheckCard title="Time off in the range" count={check.timeOff.length} none="No approved time off in these weeks." warn>
          <Lines rows={check.timeOff.map((t) => [t.name, `${shortDay(t.from)} – ${shortDay(t.to)}${t.shifts ? ` · ${t.shifts} shift${t.shifts === 1 ? '' : 's'} on it` : ''}`])} />
        </CheckCard>
        {check.overlaps.length > 0 && (
          <p className="flex items-start gap-1.5 text-[12px] text-warning">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> A shift that overlaps another house is left out when the calendar is published.
          </p>
        )}
        <Refusal>{refusal}</Refusal>
      </div>
    </SidePanel>
  )
}
