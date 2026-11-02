// House Repairs: the house's requests in a table laid out as Incidents lays its own — the open ones newest first, then
// the Completed and Cancelled ones beneath them once "Show resolved" is on (it opens off). Requests filed for the whole
// estate (ALL) appear at every house. The arrow expands the row in place; a row opens in the panel.
import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { PRIORITY_META, StatusStepper } from '@/pages/features/clientops/HouseRepairPage'
import { TintChip } from '@/pages/features/clientops/OpsPageShell'
import { BUCKET_LABEL, analyseRepairs, repairDay, statusKey, statusTints } from '@/lib/houseRepairAnalysis'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { repairsOf, shownRepairs, type LocationRepair, type PanelAsk } from '../locationModel'
import { readKey, readRepairs, useCan, useLocationRead, type ReadState } from '../useLocation'
import { ReadLine, SectionCard } from '../LocationParts'

export default function Repairs({ house, onAsk }: { house: HouseRow; onAsk: (ask: PanelAsk) => void }) {
  const [showResolved, setShowResolved] = useState(false)
  const repairs = useLocationRead(readKey('locationRepairs', house.code, showResolved),
    () => readRepairs(house.code, showResolved), repairsOf)
  return <RepairsView repairs={repairs} showResolved={showResolved} onShowResolved={setShowResolved} onAsk={onAsk}
    onRetry={repairs.reload} />
}

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const COLUMNS = 4

const statusLabel = (r: LocationRepair) => (r.bucket === 'other' ? r.status || 'Other' : BUCKET_LABEL[r.bucket])

export function RepairsView({ repairs, showResolved, onShowResolved, onAsk, onRetry }: {
  repairs: ReadState<LocationRepair[]>
  showResolved: boolean
  onShowResolved: (on: boolean) => void
  onAsk: (ask: PanelAsk) => void
  onRetry: () => void
}) {
  // a new request and its edits are the house's edition
  const writes = useCan('locations.house')
  const [now] = useState(() => Date.now())
  const [expanded, setExpanded] = useState<string | null>(null)
  const all = useMemo(() => repairs.data ?? [], [repairs.data])
  const open = shownRepairs(all, false)
  const done = showResolved ? shownRepairs(all, true).filter((r) => !open.includes(r)) : []
  const tints = useMemo(() => statusTints(analyseRepairs(all, now).statuses), [all, now])
  const row = (r: LocationRepair) => {
    const prio = r.priority ? PRIORITY_META[r.priority] : null
    const isOpen = expanded === r.id
    return (
      <Fragment key={r.id}>
        <tr data-repair={r.id} data-bucket={r.bucket} onClick={() => onAsk({ kind: 'repair-row', id: r.id })}
          className={cn('cursor-pointer hover:bg-surface-2/60', r.cancelled && 'opacity-70')}>
          <td className="whitespace-nowrap px-3 py-3">
            <span className="inline-flex items-center gap-1.5">
              <button type="button" aria-expanded={isOpen} data-expand={r.id} aria-label="Show the request"
                onClick={(e) => { e.stopPropagation(); setExpanded(isOpen ? null : r.id) }}
                className="inline-flex items-center text-text-3">
                <ChevronDown size={14} className={cn('shrink-0 transition-transform', isOpen && 'rotate-180')} />
              </button>
              <span className="font-medium text-text-1">{repairDay(r.reported) || '—'}</span>
            </span>
          </td>
          <td className="px-3 py-3">
            <span className="clamp-2 text-text-1">{r.issue || '—'}</span>
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-text-2">
            {prio ? <TintChip label={prio.label} tint={prio.tint} /> : r.urgencyRaw || '—'}
          </td>
          <td className="whitespace-nowrap px-3 py-3">
            <TintChip label={statusLabel(r)} tint={tints.get(statusKey(r)) ?? 'slate'} />
          </td>
        </tr>
        {isOpen && (
          <tr data-expanded={r.id} className="bg-surface-2/40">
            <td colSpan={COLUMNS} className="px-4 py-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Progress</dt>
                  <dd className="mt-1.5">
                    <StatusStepper stage={r.stage} onHold={r.onHold} cancelled={r.cancelled}
                      other={r.bucket === 'other' ? r.status : ''} tint={tints.get(statusKey(r)) ?? 'slate'} />
                  </dd>
                </div>
                {r.issue && (
                  <div className="min-w-0">
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Issue</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-text-2">{r.issue}</dd>
                  </div>
                )}
                {r.resolution && (
                  <div className="min-w-0">
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Resolution</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-text-2">{r.resolution}</dd>
                  </div>
                )}
              </dl>
            </td>
          </tr>
        )}
      </Fragment>
    )
  }
  return (
    <SectionCard title="House Repairs"
      extra={writes ? (
        <button type="button" onClick={() => onAsk({ kind: 'repair' })}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover">
          <Plus size={14} /> New House Repair
        </button>
      ) : undefined}>
      <div className="mb-4 flex flex-wrap gap-2">
        <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[12.5px] text-text-1"
          data-show-resolved="" title="Completed and Cancelled requests">
          <Switch checked={showResolved} onCheckedChange={onShowResolved} aria-label="Show resolved" />
          Show resolved
        </label>
      </div>
      <ReadLine state={repairs} what="the house repairs" onRetry={onRetry} />
      {repairs.data && open.length === 0 && done.length === 0 && (
        <p className="text-[13px] text-text-3">
          {showResolved ? 'No repair request on record for this house.' : 'No open repair request for this house.'}
        </p>
      )}
      {open.length + done.length > 0 && (
        <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] border-collapse text-[13px]" data-repairs="">
            <thead className="bg-surface-2/60">
              <tr>
                <th className={TH}>Reported</th>
                <th className={TH}>Issue</th>
                <th className={TH}>Urgency</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {open.map(row)}
              {done.map(row)}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
