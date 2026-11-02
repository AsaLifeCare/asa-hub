// Call Offs — call-offs and lateness reports read from the REAL `callOffs` resource via api.list (632 sheet rows…
// Stats strip (today / 7d / 30d / top caller-offer), date-grouped list with today highlighted, ORDERING dropdown…
import { useMemo, useState } from 'react'
import { differenceInCalendarDays, format, isSameDay, subDays } from 'date-fns'
import { motion } from 'framer-motion'
import { AlertTriangle, Pencil, Plus, RotateCw, Shuffle, Trash2 } from 'lucide-react'
import { ohioWall } from '@/lib/ohio'
import { recordMatchesFocus } from '@/lib/focus'
import { useContextStore } from '@/stores/useContextStore'
import { useAuthStore } from '@/auth/useAuthStore'
import Avatar from '@/components/shared/Avatar'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import OpsPageShell, {
  OrderingSelect,
  TintChip,
  outlineBtnCls,
  primaryBtnCls,
} from './OpsPageShell'
import type { ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { writePersonDrag } from '@/lib/focus'
import { useDragFocusEnabled } from '@/lib/dragFocus'
import { useOpsCrud, OPS_ORDER_OPTIONS } from '@/features/ops-flows/useOpsCrud'
import OpsRecordModal, { type OpsField } from '@/features/ops-flows/OpsRecordModal'
import ConfirmDialog from '@/features/ops-flows/ConfirmDialog'
import FocusRelations from '@/features/ops-flows/FocusRelations'
import { cn } from '@/lib/utils'

/* ---------- view model (real sheet columns — all strings, none assumed) ---------- */

type CallOffRow = {
  id: string
  date: string
  employee_name: string
  type: string
  how_late: string
  notes: string
  timestamp: string
  your_name: string
}

const str = (v: unknown) => (v == null ? '' : String(v).trim())

/** Sheet rows arrive as loose objects — coerce every field, assume nothing. */
function normalize(r: unknown, i: number): CallOffRow {
  const o = (r ?? {}) as Record<string, unknown>
  return {
    id: str(o.id) || `co-${i}`,
    date: str(o.date),
    employee_name: str(o.employee_name),
    type: str(o.type),
    how_late: str(o.how_late),
    notes: str(o.notes),
    timestamp: str(o.timestamp),
    your_name: str(o.your_name),
  }
}

/** Tolerant date parse over the sheet's mixed formats (ISO / M/D/YYYY). */
function toDate(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Sortable epoch — unparseable dates sink to the bottom of newest-first. */
const EPOCH_FLOOR = -8.64e15
const time = (v: unknown) => toDate(v)?.getTime() ?? EPOCH_FLOOR

// The same cell on OHIO's clock — the whole platform keeps Ohio's timezone.
const wall = (v: unknown) => ohioWall(str(v))

/** Ohio's today, as the wall-clock Date the day grouping compares against. */
const ohioNow = () => ohioWall(new Date()) as Date
const isOhioToday = (v: unknown) => {
  const d = wall(v)
  return !!d && isSameDay(d, ohioNow())
}

const fmtDay = (v: unknown) => {
  const d = wall(v)
  return d ? format(d, 'MMM d, yyyy') : '—'
}

const fmtStamp = (v: unknown) => {
  const d = wall(v)
  return d ? format(d, 'MMM d, HH:mm') : '—'
}

const dayLabel = (d: Date) => {
  const now = ohioNow()
  if (isSameDay(d, now)) return 'Today'
  if (isSameDay(d, subDays(now, 1))) return 'Yesterday'
  return format(d, 'EEEE, MMM d, yyyy')
}

/** Free-text `type` column ('Call Off', lateness variants…) → chip tint. */
function typeTint(t: string): ExtendedTintName {
  const s = t.toLowerCase()
  if (!s) return 'slate'
  if (s.includes('no call') || s.includes('ncns')) return 'danger'
  if (s.includes('call off') || s.includes('call-off')) return 'pink'
  if (s.includes('late') || s.includes('tardy')) return 'amber'
  if (s.includes('early')) return 'peach'
  return 'slate'
}

// The sheet's OWN columns and its OWN vocabulary.
const CALL_OFF_FIELDS: OpsField[] = [
  { key: 'employee_name', label: 'Employee', required: true, placeholder: 'Who called off' },
  { key: 'date', label: 'Shift date', kind: 'date', required: true },
  {
    key: 'type', label: 'Type', kind: 'chips', required: true,
    options: ['Call Off', 'Late Show', 'No Show No Call', 'Sent Home'] as const,
  },
  {
    key: 'how_late', label: 'How late?', placeholder: 'e.g. 30 mins',
    when: (v) => v.type === 'Late Show',
  },
  { key: 'notes', label: 'Notes — reason and how much advance notice', kind: 'textarea' },
]

/* ---------- page ---------- */

export default function CallOffsPage() {
  const crud = useOpsCrud({
    resource: 'callOffs',
    titleKey: 'employee_name',
    dateKey: 'date',
    witnessKey: 'employee_name',
  })
  const rows = crud.loading ? null : (crud.rows as unknown as CallOffRow[]).map(normalize)
  const error = crud.error
  const order = crud.order
  const setOrder = crud.setOrder
  const load = crud.reload
  const [editing, setEditing] = useState<CallOffRow | null>(null)
  const [reporting, setReporting] = useState(false)
  const [confirming, setConfirming] = useState<CallOffRow | null>(null)
  const me = useAuthStore((s) => s.user)
  const canWrite = me?.role === 'admin' || me?.role === 'manager'
  const dragOn = useDragFocusEnabled('call-offs')
  const focus = useContextStore((s) => s.focus)

  const staffFocus = focus?.type === 'staff' ? focus : null
  const scoped = useMemo(() => {
    const all = rows ?? []
    if (!staffFocus) return all
    const matched = all.filter(
      (r) =>
        recordMatchesFocus(r.employee_name, staffFocus) ||
        (r.your_name !== '' && recordMatchesFocus(r.your_name, staffFocus)),
    )
    return matched.length ? matched : all
  }, [rows, staffFocus])
  const focusFiltered =
    !!staffFocus &&
    scoped.some(
      (r) =>
        recordMatchesFocus(r.employee_name, staffFocus) ||
        (r.your_name !== '' && recordMatchesFocus(r.your_name, staffFocus)),
    )

  const sorted = useMemo(() => {
    const out = [...scoped]
    if (order === 'name') out.sort((a, b) => a.employee_name.localeCompare(b.employee_name) || time(b.date) - time(a.date))
    else if (order === 'oldest') out.sort((a, b) => time(a.date) - time(b.date))
    else if (order === 'random') {
      // one shuffle per press, stable across re-renders
      let s = crud.shuffleSeed || 1
      for (let i = out.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) % 4294967296
        const j = s % (i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
      }
    } else out.sort((a, b) => time(b.date) - time(a.date) || time(b.timestamp) - time(a.timestamp))
    return out
  }, [scoped, order, crud.shuffleSeed])

  const groups = useMemo(() => {
    if (order !== 'newest') return [{ key: 'flat', label: null as string | null, today: false, rows: sorted }]
    const map = new Map<string, { label: string; today: boolean; rows: CallOffRow[] }>()
    for (const r of sorted) {
      const d = wall(r.date)
      const key = d ? format(d, 'yyyy-MM-dd') : 'unknown'
      const g = map.get(key) ?? { label: d ? dayLabel(d) : 'Unknown date', today: isOhioToday(r.date), rows: [] }
      g.rows.push(r)
      map.set(key, g)
    }
    return [...map.entries()].map(([key, g]) => ({ key, ...g }))
  }, [sorted, order])

  const stats = useMemo(() => {
    const all = rows ?? []
    // The window counts Ohio days, so "today" flips when the houses roll over.
    const now = ohioNow()
    const within = (r: CallOffRow, days: number) => {
      const d = wall(r.date)
      if (!d) return false
      const diff = differenceInCalendarDays(now, d)
      return diff >= 0 && diff <= days
    }
    const today = all.filter((r) => isOhioToday(r.date)).length
    const last7 = all.filter((r) => within(r, 7)).length
    const last30 = all.filter((r) => within(r, 30))
    const counts = new Map<string, number>()
    for (const r of last30) {
      if (r.employee_name) counts.set(r.employee_name, (counts.get(r.employee_name) ?? 0) + 1)
    }
    let topName = ''
    let topCount = 0
    for (const [n, c] of counts) {
      if (c > topCount) {
        topName = n
        topCount = c
      }
    }
    return [
      { label: 'Today', value: today, icon: 'phone-off', tint: 'pink' as const },
      { label: 'Last 7 days', value: last7, icon: 'calendar-days', tint: 'amber' as const },
      { label: 'Last 30 days', value: last30.length, icon: 'calendar-range', tint: 'blue' as const },
      {
        label: topCount ? `Top caller-offer · ${topCount}× in 30d` : 'Top caller-offer (30d)',
        // this tile's value is a PERSON, not a count — it drags like every other name
        value: topName ? (
          <DragPerson name={topName} id={topName} type="staff" subtitle={`${topCount} call-offs in 30 days`}>
            {topName}
          </DragPerson>
        ) : (
          '—'
        ),
        icon: 'user-check',
        tint: 'lavender' as const,
      },
    ]
  }, [rows])

  if (rows === null && error) {
    return (
      <div className="w-full">
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-tint-danger">
            <AlertTriangle size={18} className="text-tint-fg-danger" />
          </span>
          <div>
            <div className="font-display text-[15px] font-semibold text-text-1">Couldn't load call-offs</div>
            <p className="mt-1 max-w-[420px] text-[13px] leading-5 text-text-2">{error}</p>
          </div>
          <button onClick={load} className={outlineBtnCls}>
            <RotateCw size={15} /> Retry
          </button>
        </Card>
      </div>
    )
  }

  if (rows === null) {
    return (
      <div className="w-full space-y-2">
        <Skeleton className="h-9 w-64" />
        <Card padded={false} className="p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-14 w-full" />
          ))}
        </Card>
      </div>
    )
  }

  return (
    <OpsPageShell
      title="Call Offs"
      subtitle="Call-offs and lateness reports from the live sheet"
      focusType="staff"
      filtered={focusFiltered}
      stats={stats}
      actions={
        <button
          onClick={() => setReporting(true)}
          disabled={!canWrite}
          title={canWrite ? 'Report a call-off into the sheet' : 'Reporting is for admins and managers'}
          className={primaryBtnCls}
        >
          <Plus size={15} /> Report call-off
        </button>
      }
      toolbar={
        <>
          <OrderingSelect value={order} onChange={(v) => setOrder(v as never)} options={OPS_ORDER_OPTIONS} />
          {order === 'random' && (
            <button onClick={crud.reshuffle} className={outlineBtnCls} title="Shuffle again">
              <Shuffle size={14} /> Shuffle
            </button>
          )}
        </>
      }
    >
      <FocusRelations type="staff" />
      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            title="No call-offs in the sheet"
            body="The live resource answered with zero rows. When the old world's form logs one, it appears here."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key}>
              {g.label && (
                <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  {g.label}
                  {g.today && <TintChip label="Today" tint="primary" />}
                </h2>
              )}
              <Card padded={false} className="overflow-hidden">
                {g.rows.map((r, i) => {
                  const rowToday = isOhioToday(r.date)
                  return (
                    <motion.div
                      key={r.id}
                      initial={i < 10 ? { opacity: 0, y: 8 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 10) * 0.025, duration: 0.2, ease: EASE_OUT_EXPO }}
                      className={cn(
                        'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-surface-2',
                        rowToday && 'bg-tint-primary',
                      )}
                    >
                      <div
                        className={cn('flex min-w-[190px] items-center gap-3', dragOn && 'cursor-grab active:cursor-grabbing')}
                        draggable={dragOn}
                        onDragStart={(e) =>
                          dragOn &&
                          r.employee_name &&
                          writePersonDrag(e.dataTransfer, {
                            type: 'staff',
                            id: r.employee_name,
                            name: r.employee_name,
                            subtitle: 'Direct Support Pro',
                          })
                        }
                        title={dragOn ? 'Drag onto the top-left corner to focus the platform on this person' : undefined}
                      >
                        <Avatar name={r.employee_name || '—'} size="sm" />
                        <div className="min-w-0">
                          <div className="clamp-1 text-[13px] font-medium text-text-1">{r.employee_name || '—'}</div>
                          {r.notes && <div className="clamp-1 text-[11px] text-text-3">{r.notes}</div>}
                        </div>
                      </div>
                      <TintChip label={r.type || '—'} tint={typeTint(r.type)} />
                      {r.how_late && (
                        <span title="How late" className="font-stat text-[12px] text-text-2">
                          {r.how_late}
                        </span>
                      )}
                      {order !== 'newest' && (
                        <span className="font-stat text-[12px] text-text-2">{fmtDay(r.date)}</span>
                      )}
                      <span className="ml-auto font-stat text-[12px] text-text-3">
                        {/* the reporter is a SECOND person on this row — the name had
                            to leave the template string to become draggable */}
                        {r.your_name ? (
                          <>
                            by{' '}
                            <DragPerson name={r.your_name} id={r.your_name} type="staff" subtitle="Filed the call-off">
                              {r.your_name}
                            </DragPerson>
                            {' · '}
                          </>
                        ) : null}
                        {fmtStamp(r.timestamp)}
                      </span>
                      {canWrite && (
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => setEditing(r)}
                            aria-label={`Edit the call-off for ${r.employee_name || 'this person'}`}
                            className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => setConfirming(r)}
                            aria-label={`Remove the call-off for ${r.employee_name || 'this person'}`}
                            className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-tint-danger hover:text-tint-fg-danger"
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      )}
                    </motion.div>
                  )
                })}
              </Card>
            </section>
          ))}
        </div>
      )}

      <OpsRecordModal
        open={reporting || !!editing}
        title={editing ? 'Edit call-off' : 'Report a call-off'}
        fields={CALL_OFF_FIELDS}
        row={editing as never}
        busy={crud.busy}
        onClose={() => {
          setReporting(false)
          setEditing(null)
        }}
        onSubmit={async (v) => {
          const ok = editing
            ? await crud.update(editing as never, v)
            : await crud.create({
                ...v,
                // the sheet's own columns: who logged it, and when
                your_name: me?.name ?? me?.email ?? '',
                timestamp: new Date().toISOString(),
              })
          if (ok) {
            setReporting(false)
            setEditing(null)
          }
        }}
      />

      <ConfirmDialog
        open={!!confirming}
        title="Remove this call-off?"
        body={
          confirming
            ? `${confirming.employee_name || 'This row'} · ${confirming.type || 'Call Off'} · ${fmtDay(confirming.date)}. It is removed from the estate's sheet — the same one the old form writes to.`
            : ''
        }
        confirmLabel="Remove"
        busy={crud.busy}
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming) await crud.remove(confirming as never)
          setConfirming(null)
        }}
      />
    </OpsPageShell>
  )
}
