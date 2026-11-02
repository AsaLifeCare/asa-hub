// House Repair — work-order tracker wired to the REAL `workOrders` resource (the estate sheet), read through…
// The stepper is New → In Progress → Completed, with On hold (or any word outside the lifecycle) as a badge in the…
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Ban, Check, Filter, Pencil, Plus, Shuffle, TriangleAlert, X } from 'lucide-react'
import { writePersonDrag } from '@/lib/focus'
import { useAuthStore } from '@/auth/useAuthStore'
import { useDragFocusEnabled } from '@/lib/dragFocus'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import OpsPageShell, {
  OrderingSelect,
  TintChip,
  outlineBtnCls,
  primaryBtnCls,
} from './OpsPageShell'
import HouseRepairHero from './HouseRepairHero'
import { useHouseRepairBoard, type HouseRepairBoard, type RepairOrder } from './useHouseRepairBoard'
import type { ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { OPS_ORDER_OPTIONS, type OpsRow } from '@/features/ops-flows/useOpsCrud'
import OpsRecordModal, { type OpsField } from '@/features/ops-flows/OpsRecordModal'
import ConfirmDialog from '@/features/ops-flows/ConfirmDialog'
import FocusRelations from '@/features/ops-flows/FocusRelations'
import { COORDINATOR_ONLY, URGENCY_OPTIONS, mayEditEstate, mayFile } from '@/lib/estateFiling'
import { cn } from '@/lib/utils'
import {
  BUCKET_LABEL,
  houseLabel,
  isWholeEstate,
  repairDay as fmtDate,
  repairFilterLabel,
  statusKey,
  type Priority,
  type RepairRow,
  type Stage,
} from '@/lib/houseRepairAnalysis'

const str = (v: unknown): string => (v == null ? '' : String(v).trim())

/* ---------- chips, steps, tints ---------- */

export const PRIORITY_META: Record<Priority, { tint: ExtendedTintName; label: string }> = {
  urgent: { tint: 'danger', label: 'Urgent' },
  high: { tint: 'warning', label: 'High' },
  medium: { tint: 'info', label: 'Medium' },
  low: { tint: 'slate', label: 'Low' },
}

const STEPS: { id: Stage; label: string }[] = [
  { id: 'New', label: 'New' },
  { id: 'In Progress', label: 'In progress' },
  { id: 'Completed', label: 'Completed' },
]

/** Deterministic tint for the free-text repair_type chip. */
const TYPE_TINTS: ExtendedTintName[] = ['peach', 'blue', 'lavender', 'mint', 'amber', 'info', 'pink', 'violet']
function typeTint(t: string): ExtendedTintName {
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0
  return TYPE_TINTS[h % TYPE_TINTS.length]
}

/* ---------- ordering ---------- */

// The shared four, plus the urgency ordering this screen already had — a maintenance coordinator reaches for "what…
const ORDER_OPTIONS: { id: RepairOrder; label: string }[] = [
  ...OPS_ORDER_OPTIONS.map((o) => (o.id === 'name' ? { ...o, label: 'House A→Z' } : o)),
  { id: 'priority', label: 'Priority' },
]

/* ---------- the sheet's own vocabulary ---------- */

// Pickers carry the values THESE rows hold, most used first — the estate's form has its own spelling ('Plumbling…
function presentValues(rows: OpsRow[], key: string): string[] {
  const seen = new Map<string, { label: string; n: number }>()
  for (const r of rows) {
    const v = str(r[key])
    if (!v) continue
    const k = v.toLowerCase()
    const hit = seen.get(k)
    if (hit) hit.n++
    else seen.set(k, { label: v, n: 1 })
  }
  return [...seen.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((v) => v.label)
}

/** Lifecycle order for the status picker; anything unrecognised sorts last. */
const STATUS_ORDER = ['In Progress', 'On-Hold', 'Completed', 'Cancelled']

/* ---------- status stepper ---------- */

export function StatusStepper({ stage, onHold, cancelled, other, tint }: {
  stage: Stage
  onHold: boolean
  cancelled: boolean
  /** a status word outside the lifecycle, shown as typed */
  other: string
  /** the header's colour for this status */
  tint: ExtendedTintName
}) {
  const current = Math.max(0, STEPS.findIndex((s) => s.id === stage))
  const badge = cancelled ? BUCKET_LABEL.cancelled : onHold ? BUCKET_LABEL['on-hold'] : other
  return (
    <div className="flex items-center gap-1" aria-label={`Status: ${badge || STEPS[current].label}`}>
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1">
          <span
            title={s.label}
            className={cn(
              'grid h-4 w-4 place-items-center rounded-full border text-[9px]',
              i < current && 'border-transparent bg-primary text-on-primary',
              i === current && (stage === 'Completed' ? 'border-transparent bg-primary text-on-primary' : 'border-primary bg-primary-soft'),
              i > current && 'border-border bg-surface-3',
            )}
          >
            {(i < current || stage === 'Completed') && <Check size={10} strokeWidth={3} />}
          </span>
          {i < STEPS.length - 1 && <span className={cn('h-px w-4', i < current ? 'bg-primary' : 'bg-border')} />}
        </div>
      ))}
      {badge ? (
        <TintChip label={badge} tint={tint} className="ml-1.5" />
      ) : (
        <span className="ml-1.5 whitespace-nowrap text-[11px] font-medium text-text-3">{STEPS[current].label}</span>
      )}
    </div>
  )
}

/* ---------- page ---------- */

export default function HouseRepairPage() {
  return <HouseRepairScreen board={useHouseRepairBoard()} />
}

/** The screen over a board — drawn whole by the tests with the board they clicked. */
export function HouseRepairScreen({ board }: { board: HouseRepairBoard }) {
  const { crud, rows, order, chooseOrder, clientFocus, focusFiltered, sorted, visible, tints, read, filter, pick, clearFilter } = board
  const raw = crud.rows
  const loadError = crud.error
  const [reporting, setReporting] = useState(false)
  const [editing, setEditing] = useState<RepairRow | null>(null)
  const [confirming, setConfirming] = useState<RepairRow | null>(null)
  const me = useAuthStore((s) => s.user)
  const canWrite = mayEditEstate(me?.role)
  const canFile = mayFile(me?.role)
  const dragOn = useDragFocusEnabled('house-repair')

  // The two vocabularies, compared BY VALUE — an optimistic write replaces the row array, and if that handed the…
  const vocab = useMemo(
    () => JSON.stringify({ status: presentValues(raw, 'status'), type: presentValues(raw, 'repair_type') }),
    [raw],
  )
  const { statusOptions, typeOptions } = useMemo(() => {
    const words = JSON.parse(vocab) as { status: string[]; type: string[] }
    // the Hub itself stamps 'Cancelled', so it belongs in the picker even before the first cancellation reaches the…
    const all = words.status.some((s) => s.toLowerCase() === 'cancelled')
      ? words.status
      : [...words.status, 'Cancelled']
    const rank = (s: string) => {
      const i = STATUS_ORDER.findIndex((x) => x.toLowerCase() === s.toLowerCase())
      return i < 0 ? STATUS_ORDER.length : i
    }
    return { statusOptions: [...all].sort((a, b) => rank(a) - rank(b)), typeOptions: words.type }
  }, [vocab])

  /** Memoised on the vocabularies, for the same reason they are value-compared. */
  const fields = useMemo<OpsField[]>(
    () => [
      {
        key: 'select_address_vehicle', label: 'House or vehicle', required: true,
        placeholder: 'e.g. 1711 48th St NW — or ALL for the whole estate',
      },
      typeOptions.length
        ? { key: 'repair_type', label: 'Repair type', kind: 'select', options: typeOptions, required: true }
        : { key: 'repair_type', label: 'Repair type', required: true, placeholder: 'e.g. Plumbing' },
      {
        key: 'urgency_level', label: 'Urgency — 1 low … 5 high', kind: 'chips',
        options: URGENCY_OPTIONS, required: true,
      },
      {
        key: 'please_describe_the_issue', label: 'Describe the issue', kind: 'textarea', required: true,
        placeholder: 'e.g. Kitchen faucet leaking at the base — bucket placed underneath',
      },
      // left blank a request reads as New, which is how the estate's own form files one; the picker is here for the…
      { key: 'status', label: 'Status', kind: 'select', options: statusOptions },
      {
        key: 'resolution_notes', label: 'Resolution notes', kind: 'textarea',
        placeholder: 'What was done, by whom, and when',
      },
    ],
    [typeOptions, statusOptions],
  )
  /** A filer's form: the coordinator moves a request along, the filer only files it. */
  const formFields = useMemo(
    () => (canWrite ? fields : fields.filter((f) => !(COORDINATOR_ONLY as readonly string[]).includes(f.key))),
    [fields, canWrite],
  )

  return (
    <OpsPageShell
      title="House Repair"
      subtitle="Maintenance work orders across the group homes"
      focusType="client"
      filtered={focusFiltered}
      hero={
        <HouseRepairHero
          read={read}
          scope={focusFiltered ? clientFocus?.name : null}
          active={filter}
          onFilter={pick}
          onRetry={crud.reload}
        />
      }
      actions={
        <button
          onClick={() => setReporting(true)}
          disabled={!canFile}
          title={canFile ? 'File a repair request into the estate sheet' : 'Filing is for clients, staff, managers and admins'}
          className={primaryBtnCls}
        >
          <Plus size={15} /> New repair request
        </button>
      }
      toolbar={
        <>
          <OrderingSelect value={order} onChange={(v) => chooseOrder(v as RepairOrder)} options={ORDER_OPTIONS} />
          {order === 'random' && (
            <button onClick={crud.reshuffle} className={outlineBtnCls} title="Shuffle again">
              <Shuffle size={14} /> Shuffle
            </button>
          )}
        </>
      }
    >
      <FocusRelations type="client" />
      {filter && rows !== null && !loadError && (
        <div role="group" aria-label="The list’s filter" className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-text-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 font-medium text-text-1">
            <Filter size={12} /> {repairFilterLabel(filter)}
          </span>
          <span className="font-stat">
            {visible.length.toLocaleString()} of {sorted.length.toLocaleString()}
          </span>
          <button
            onClick={clearFilter}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-primary transition-colors hover:bg-primary-soft"
          >
            <X size={12} /> Clear
          </button>
        </div>
      )}
      {rows === null && !loadError ? (
        <Card padded={false} className="p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-14 w-full" />
          ))}
        </Card>
      ) : loadError ? (
        <Card>
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-tint-danger">
              <TriangleAlert size={18} className="text-tint-fg-danger" />
            </span>
            <div>
              <h3 className="font-display text-[15px] font-semibold text-text-1">Could not load work orders</h3>
              <p className="mt-1 max-w-[440px] text-[13px] leading-5 text-text-2">
                The work-order sheet did not answer. Nothing is shown rather than stale or seeded data —
                the header above says why and can try again.
              </p>
            </div>
          </div>
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState title="No repair requests" body="The work-order sheet returned no rows." />
        </Card>
      ) : visible.length === 0 && filter ? (
        <Card>
          <EmptyState title="Nothing matches" body={`No request matches “${repairFilterLabel(filter)}”.`} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visible.map((r, i) => {
            const prio = r.priority ? PRIORITY_META[r.priority] : null
            const canDrag = dragOn && !!r.house && !isWholeEstate(r.house)
            return (
              <motion.div
                key={r.id}
                initial={i < 8 ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.22, ease: EASE_OUT_EXPO }}
              >
                <Card className={cn('h-full !p-4', r.cancelled && 'opacity-70')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn('text-[12px] font-semibold text-text-3', canDrag && 'cursor-grab active:cursor-grabbing')}
                          draggable={canDrag}
                          onDragStart={(e) =>
                            canDrag &&
                            writePersonDrag(e.dataTransfer, {
                              type: 'client',
                              id: r.house,
                              name: r.house,
                              subtitle: 'House',
                            })
                          }
                          title={canDrag ? 'Drag onto the top-left corner to focus the platform on this house' : undefined}
                        >
                          {houseLabel(r.house)}
                        </span>
                        {r.repairType && <TintChip label={r.repairType} tint={typeTint(r.repairType)} />}
                        {prio && <TintChip label={prio.label} tint={prio.tint} />}
                      </div>
                      <h3 className="clamp-2 mt-1.5 text-[14px] font-semibold leading-5 text-text-1">{r.issue || '—'}</h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="font-stat text-[12px] font-semibold text-text-3">{fmtDate(r.reported)}</span>
                      {canWrite && (
                        <span className="flex items-center gap-1">
                          <button
                            onClick={() => setEditing(r)}
                            aria-label={`Edit the repair request for ${houseLabel(r.house)}`}
                            className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
                          >
                            <Pencil size={13} />
                          </button>
                          {!r.cancelled && (
                            <button
                              onClick={() => setConfirming(r)}
                              aria-label={`Cancel the repair request for ${houseLabel(r.house)}`}
                              className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-tint-danger hover:text-tint-fg-danger"
                            >
                              <Ban size={13} />
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  {r.resolution && (
                    <p className="clamp-2 mt-2 text-[12px] leading-5 text-text-2" title={r.resolution}>
                      {r.resolution}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <StatusStepper
                      stage={r.stage}
                      onHold={r.onHold}
                      cancelled={r.cancelled}
                      other={r.bucket === 'other' ? r.status : ''}
                      tint={tints.get(statusKey(r)) ?? 'slate'}
                    />
                    <span className="text-[11px] text-text-3">
                      {r.urgency !== null ? `Urgency ${r.urgency}/5` : r.urgencyRaw ? `Urgency: ${r.urgencyRaw}` : 'Urgency —'}
                    </span>
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      <OpsRecordModal
        open={reporting || !!editing}
        title={editing ? 'Edit repair request' : 'New repair request'}
        fields={formFields}
        row={editing?.raw ?? null}
        busy={crud.busy}
        onClose={() => {
          setReporting(false)
          setEditing(null)
        }}
        onSubmit={async (v) => {
          const ok = editing
            ? await crud.update(editing.raw, v)
            : // the sheet's own clock column, in the ISO the Repairs tab holds
              await crud.create({ ...v, timestamp: new Date().toISOString() })
          if (ok) {
            setReporting(false)
            setEditing(null)
          }
        }}
      />

      <ConfirmDialog
        open={!!confirming}
        title="Cancel this repair request?"
        body={
          confirming
            ? `${houseLabel(confirming.house)} · ${confirming.repairType || 'Repair'} · ${fmtDate(confirming.reported)}. ` +
              'The request stays in the estate’s Repairs sheet with its status set to Cancelled, so the maintenance history keeps it.'
            : ''
        }
        confirmLabel="Cancel request"
        busy={crud.busy}
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          // the soft delete answers `cancelled`, and the shared toast says so
          if (confirming) await crud.remove(confirming.raw)
          setConfirming(null)
        }}
      />
    </OpsPageShell>
  )
}
