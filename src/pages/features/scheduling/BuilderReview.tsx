// Final Review: the period as it will be published — the four counts, the staff checks, every person's workload…
// Weekly totals run Monday to Sunday, weekends are Saturday and Sunday, a night starts at 8 PM or crosses midnight.
import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { addDays } from './schedulingModel'
import { rangeWords, shortDay, weeksOf, type Review, type Workload } from './builderModel'
import { CheckCard, Lines } from './PatternCheckPanel'
import { OUTLINE_BTN } from './SchedulingParts'

function Kpi({ label, value, warn }: { label: string; value: number; warn: boolean }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-3 shadow-1" data-kpi={label}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{label}</p>
      <p className={cn('mt-1 text-[22px] font-semibold leading-7', value && warn ? 'text-warning' : 'text-text-1')}>{value}</p>
    </div>
  )
}

function StaffCheck({ title, list, render }: { title: string; list: Workload[]; render: (w: Workload) => string }) {
  return (
    <CheckCard title={title} count={list.length} none="None." warn>
      <Lines rows={list.map((w) => [w.name, render(w)])} />
    </CheckCard>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4">
      <h3 className="mb-2 text-[13px] font-semibold text-text-1">{title}</h3>
      {children}
    </section>
  )
}

const TH = 'whitespace-nowrap border-b border-border px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-3'
const TD = 'whitespace-nowrap border-b border-border px-2 py-1.5 text-[12px] text-text-1'

export default function BuilderReview({ review, houseLabel, first, last, onRefresh, refreshing, publish }: {
  review: Review
  houseLabel: string
  first: string
  last: string
  onRefresh: () => void
  refreshing: boolean
  publish: ReactNode
}) {
  const weeks = weeksOf(first, last)
  const c = review.check
  return (
    <div className="grid gap-4" data-final-review="">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4">
        <h2 className="text-[15px] font-semibold text-text-1">
          Final Review · {houseLabel} · {rangeWords(first, last)} · {weeks.length} week{weeks.length === 1 ? '' : 's'}
        </h2>
        <button type="button" className={OUTLINE_BTN} onClick={onRefresh} disabled={refreshing} data-act="refresh-review">
          <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} /> Refresh Final Review
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Shift overlaps" value={c.overlaps.length} warn />
        <Kpi label="OPEN shifts" value={review.open.length} warn />
        <Kpi label="Days with >4 OPEN" value={review.busyDays.length} warn />
        <Kpi label="Preference reviews" value={c.prefs.length} warn />
      </div>

      <Section title="Staff checks">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StaffCheck title="High Hrs" list={review.high} render={(w) => `${w.avg} h/wk`} />
          <StaffCheck title="Low Hrs" list={review.low} render={(w) => `${w.avg} h/wk`} />
          <StaffCheck title=">50% Wknds" list={review.halfWeekends} render={(w) => `${w.weekends} of ${weeks.length}`} />
          <StaffCheck title="6+ Consec." list={review.streaks} render={(w) => `${w.streak} days`} />
          <StaffCheck title="B2B Wknds" list={review.b2b} render={(w) => w.pattern} />
        </div>
      </Section>

      <Section title="Staff workload">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse" data-workload="">
            <thead>
              <tr>
                {['Staff name', 'Locations', '# Loc.', 'Shifts', 'Total hrs', 'Avg/wk'].map((h) => <th key={h} className={TH}>{h}</th>)}
                {weeks.map((mon, i) => (
                  <th key={mon} className={TH}>Wk{i + 1}<span className="block font-normal normal-case tracking-normal">{shortDay(mon)} – {shortDay(addDays(mon, 6))}</span></th>
                ))}
                {['R/O', 'OFF', 'Day', 'Night', 'Max streak', 'Wknds', 'Weekend pattern', 'Every other?', 'Flags'].map((h) => <th key={h} className={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {review.rows.map((w) => (
                <tr key={w.key}>
                  <td className={cn(TD, 'font-semibold')}>{w.name}</td>
                  <td className={TD}>{w.locations.join(', ')}</td>
                  <td className={TD}>{w.locations.length}</td>
                  <td className={TD}>{w.shifts}</td>
                  <td className={TD}>{w.total}</td>
                  <td className={TD}>{w.avg}</td>
                  {w.weeks.map((h, i) => <td key={i} className={cn(TD, h > 48 && 'text-danger', h > 40 && h <= 48 && 'text-warning')}>{h}</td>)}
                  <td className={TD}>{w.ro}</td>
                  <td className={TD}>{w.off}</td>
                  <td className={TD}>{w.day}</td>
                  <td className={TD}>{w.night}</td>
                  <td className={TD}>{w.streak}</td>
                  <td className={TD}>{w.weekends}</td>
                  <td className={cn(TD, 'font-mono')}>{w.pattern}</td>
                  <td className={TD}>{w.everyOther ? 'Yes' : 'No'}</td>
                  <td className={TD}>{w.flags.length ? w.flags.join(' · ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11.5px] text-text-3">
          Weekly totals run Monday to Sunday; weekends are Saturday and Sunday; a night starts at 8 PM or crosses midnight.
        </p>
      </Section>

      <Section title="Exceptions and decisions">
        <div className="grid gap-3 lg:grid-cols-2">
          <CheckCard title="OPEN coverage" count={review.open.length} none="Every shift has somebody." warn>
            <Lines rows={review.open.map((o) => [`${shortDay(o.date)} · ${houseLabel}`, o.text])} />
          </CheckCard>
          <CheckCard title="Days with >4 OPEN" count={review.busyDays.length} none="No day has more than 4 OPEN shifts." warn>
            <Lines rows={review.busyDays.map((d) => [`${shortDay(d.date)} · ${d.n} OPEN`, d.list.join(', ')])} />
          </CheckCard>
          <CheckCard title="Shift overlaps" count={c.overlaps.length} none="No overlapping shifts.">
            <Lines rows={c.overlaps.map((o) => [o.name, `${shortDay(o.date)} ${o.text} × ${o.with}`])} />
          </CheckCard>
          <CheckCard title="Preference reviews" count={c.prefs.length} none="No preference conflicts." warn>
            <Lines rows={c.prefs.map((p) => [p.name, `${shortDay(p.date)} ${p.text} — ${p.why}`])} />
          </CheckCard>
        </div>
      </Section>

      <div className="flex justify-end">{publish}</div>
    </div>
  )
}
