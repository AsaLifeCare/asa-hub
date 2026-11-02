// The black header over House Repair: what the Repairs sheet says now, each figure a filter on the list below.
// Unread or failed is "—" plus a sentence.
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { heroBand, type ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import {
  houseLabel,
  repairDay,
  sameRepairFilter,
  statusTints,
  type RepairFigures,
  type RepairFilter,
} from '@/lib/houseRepairAnalysis'

export type RepairRead =
  | { state: 'loading' }
  | { state: 'failed'; reason: string }
  | { state: 'ready'; figures: RepairFigures }

const EYEBROW = 'block text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45'

const fmt = (n: number) => n.toLocaleString()
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`

/** A figure that filters the list — or plain text when there is nothing to show. */
function Pick({ hint, active, onClick, className, children }: {
  hint: string
  active: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
}) {
  if (!onClick) return <div className={cn('-m-1.5 min-w-0 p-1.5', className)}>{children}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? 'Show every request again' : hint}
      aria-pressed={active}
      className={cn(
        '-m-1.5 flex w-[calc(100%+0.75rem)] min-w-0 flex-col justify-start rounded-lg p-1.5 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
        active && 'bg-white/[0.09] ring-1 ring-white/25',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Figure({ label, value, sub, tone, text }: {
  label: string
  value: string
  sub: string
  tone?: ExtendedTintName
  /** a name rather than a count */
  text?: boolean
}) {
  // value first, so a label that wraps at phone width never unaligns the row
  return (
    <>
      {text ? (
        <span className="flex h-[34px] min-w-0 items-end">
          <span className="truncate text-[20px] font-medium leading-tight text-white" title={value}>{value}</span>
        </span>
      ) : (
        <span className="block font-stat text-[34px] leading-none text-white" style={tone ? { color: heroBand(tone) } : undefined}>
          {value}
        </span>
      )}
      <span className="mt-1.5 block text-[12px] font-medium text-white/80">{label}</span>
      <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-white/50">{sub}</span>
    </>
  )
}

export default function HouseRepairHero({ read, scope, active, onFilter, onRetry }: {
  read: RepairRead
  /** the focused house the rows are scoped to, if any */
  scope?: string | null
  active: RepairFilter | null
  onFilter: (f: RepairFilter) => void
  onRetry?: () => void
}) {
  const f = read.state === 'ready' ? read.figures : null
  const dash = '—'
  const pending = read.state === 'failed' ? 'unknown — the read failed' : 'not read yet'
  const is = (x: RepairFilter) => sameRepairFilter(active, x)
  const OPEN: RepairFilter = { kind: 'open' }
  const OLDEST: RepairFilter = { kind: 'oldest' }
  const URGENT: RepairFilter = { kind: 'urgent' }
  const onRecord = (n: number) => `${plural(n, 'request')} ${scope ? `at ${scope}` : 'on record'}`

  const openSub = !f
    ? pending
    : f.open.count === 0
      ? f.total ? 'every request is completed or cancelled' : 'no request on file'
      : [
          f.open.new && `${fmt(f.open.new)} new`,
          f.open.inProgress && `${fmt(f.open.inProgress)} in progress`,
          f.open.onHold && `${fmt(f.open.onHold)} on hold`,
          f.open.other && `${fmt(f.open.other)} other status`,
        ].filter(Boolean).join(' · ')

  const urgentSub = !f
    ? pending
    : f.open.count === 0
      ? 'nothing open'
      : [
          `${fmt(f.urgent.urgent)} urgent · ${fmt(f.urgent.high)} high`,
          f.urgent.unreadable ? `${plural(f.urgent.unreadable, 'open request')} with no readable urgency` : '',
        ].filter(Boolean).join(' · ')

  const oldest = f?.oldest ?? null
  const oldestSub = !f
    ? pending
    : oldest
      ? [
          `${houseLabel(oldest.row.house)} · filed ${repairDay(oldest.row.reported)}`,
          f.undatedOpen ? `${fmt(f.undatedOpen)} open undated` : '',
        ].filter(Boolean).join(' · ')
      : f.open.count ? 'no open request carries a readable date' : 'nothing open'

  const month: RepairFilter | null = f ? { kind: 'month-done', month: f.month.key, name: f.month.name } : null
  const monthSub = !f
    ? pending
    : `${f.month.filed ? `of ${plural(f.month.filed, 'request')} filed in ${f.month.name}` : `nothing filed in ${f.month.name} yet`} · the sheet keeps no completion date`

  const top = f?.topHouse ?? null
  const house: RepairFilter | null = top ? { kind: 'house', key: top.key, label: top.label } : null
  const apart = f
    ? [
        f.openWholeEstate ? `${fmt(f.openWholeEstate)} open for all houses` : '',
        f.openNoHouse ? `${fmt(f.openNoHouse)} open with no house named` : '',
      ]
    : []
  const houseSub = !f
    ? pending
    : top
      ? [plural(top.open, 'open request'), top.tiedWith ? `tied with ${plural(top.tiedWith, 'other')}` : '', ...apart]
          .filter(Boolean).join(' · ')
      : f.open.count
        ? ['no open request names a single house or vehicle', ...apart].filter(Boolean).join(' · ')
        : 'nothing open'

  const slices = f?.statuses ?? []
  const tints = statusTints(slices)
  const sliceTotal = slices.reduce((n, s) => n + s.count, 0)
  return (
    <section
      aria-label="House repair — the requests on file"
      aria-busy={read.state === 'loading'}
      className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6"
    >
      <p className={EYEBROW}>Repair requests · {scope || 'every house and vehicle'}</p>

      {/* the kit's four to a row; the address, a name, takes a row of its own */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <Pick hint="Show the open requests" active={is(OPEN)} onClick={f?.open.count ? () => onFilter(OPEN) : undefined}>
          <Figure label="Open requests" value={f ? fmt(f.open.count) : dash} sub={openSub} />
        </Pick>

        <Pick hint="Show the urgent and high open requests" active={is(URGENT)}
          onClick={f?.urgent.count ? () => onFilter(URGENT) : undefined}>
          <Figure label="Urgent / high open" value={f ? fmt(f.urgent.count) : dash} sub={urgentSub}
            tone={f && f.urgent.urgent > 0 ? 'amber' : undefined} />
        </Pick>

        <Pick hint="Show the open requests, oldest first" active={is(OLDEST)}
          onClick={oldest ? () => onFilter(OLDEST) : undefined}>
          <Figure label="Oldest open" value={!f ? dash : oldest ? `${fmt(oldest.ageDays)}d` : f.open.count ? dash : 'None'} sub={oldestSub} />
        </Pick>

        <Pick hint="Show the completed requests filed this month" active={!!month && is(month)}
          onClick={month && f?.month.done ? () => onFilter(month) : undefined}>
          <Figure label="Done · filed this month" value={f ? fmt(f.month.done) : dash} sub={monthSub} />
        </Pick>

        <Pick hint="Show the open requests at this address" active={!!house && is(house)}
          onClick={house ? () => onFilter(house) : undefined}
          className="col-span-2 lg:col-span-4 lg:w-auto lg:max-w-full lg:justify-self-start">
          <Figure label="Most open requests" text value={!f ? dash : top ? houseLabel(top.label) : f.open.count ? dash : 'None'}
            sub={houseSub} />
        </Pick>
      </div>

      <div className="mt-6">
        <p className={EYEBROW}>Status · {f ? (scope ? onRecord(f.total) : `all ${plural(f.total, 'request')} on file`) : pending}</p>
        <div className="mt-2.5 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/10">
          {sliceTotal > 0 && slices.map((s) => (
            <motion.span
              key={s.key}
              title={`${fmt(s.count)} · ${s.label}`}
              initial={{ width: 0 }}
              animate={{ width: `${(s.count / sliceTotal) * 100}%` }}
              transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ background: heroBand(tints.get(s.key) ?? 'slate') }}
            />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {slices.map((s) => {
            const filter: RepairFilter = { kind: 'status', key: s.key, label: s.label }
            const on = is(filter)
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onFilter(filter)}
                aria-pressed={on}
                title={on ? 'Show every request again' : `Show the ${s.label.toLowerCase()} requests`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] text-white/75 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
                  on ? 'bg-white/20 text-white' : 'bg-white/10',
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: heroBand(tints.get(s.key) ?? 'slate') }} />
                {s.label}
                <span className="font-stat text-white/90">{fmt(s.count)}</span>
              </button>
            )
          })}
          {f && slices.length === 0 && <span className="text-[12px] text-white/45">No request on file.</span>}
          {!f && <span className="text-[12px] text-white/45">{read.state === 'failed' ? 'Unknown — the read failed.' : 'Not read yet.'}</span>}
        </div>
      </div>

      <div className="mt-5 border-t border-white/10 pt-3.5 text-[12px] leading-[1.6] text-white/55">
        {read.state === 'loading' && (
          <p className="inline-flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" /> Reading the repair requests…
          </p>
        )}
        {read.state === 'failed' && (
          <p className="flex flex-wrap items-center gap-2" style={{ color: heroBand('amber') }}>
            <AlertTriangle size={13} className="shrink-0" />
            <span>
              The repair requests could not be read, so these figures are unknown — not zero.
              {read.reason ? ` ${read.reason}` : ''}
            </span>
            {onRetry && (
              <button type="button" onClick={onRetry}
                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] text-white/85 hover:bg-white/15">
                <RotateCw size={11} /> Try again
              </button>
            )}
          </p>
        )}
        {f && (
          <p>
            {[
              `${onRecord(f.total)} in House Repair Requests › Repairs`,
              f.undated ? `${fmt(f.undated)} with no readable date` : '',
              f.noUrgency ? `${fmt(f.noUrgency)} with no readable urgency` : '',
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </section>
  )
}
