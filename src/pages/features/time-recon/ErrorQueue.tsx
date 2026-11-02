// The review queue — anomalies grouped house → employee, GROUPED FIRST AND PAGED AFTER.
// Grouping follows the question a reviewer actually asks: "what happened at this house, with this person?" The old
// queue paged the whole list twenty at a time before grouping, and the server's order is type first and then the
// calendar labels', so the first pages held one house only ("why only 2005?") and every resolve put the pager back on
// page 1. Now every house is a section from the start (in the lane's byHouse order, most anomalies first), folded when
// more than three are drawn, and only an employee's own cards are paged: ten, then "Show N more". The fold and the
// paging are kept per filter set (reconState.useQueueFolds), so the quiet refetch after a resolve keeps both, and the
// scroll with them — even when it empties a house or brings a new one.
import { useMemo, useState } from 'react'
import { CalendarDays, ChevronRight, Loader2, MessageSquare, Sparkles, Users } from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import DragPerson from '@/components/shared/DragPerson'
import { Badge } from '@/components/shared/Badge'
import { gasAction } from '@/features/hiring/shared'
import { askConfirm } from '@/stores/useDialogStore'
import { toast } from '@/stores/useToastStore'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import {
  ACTION_LABEL, consumerList, dayLabel, hoursLabel, RECON_TYPES, STATUS_TINT, stampLabel, timeLabel, TYPE_ACTIONS,
  TYPE_META, type ReconError, type ReconStatus, type TypeCounts,
} from './reconTypes'
import { PER_EMPLOYEE, useQueueFolds } from './reconState'

function ErrorCard({
  error,
  onAction,
  onViewShifts,
}: {
  error: ReconError
  onAction: (error: ReconError, status: ReconStatus) => void
  onViewShifts: (error: ReconError) => void
}) {
  const meta = TYPE_META[error.type] ?? TYPE_META.missing
  const [ai, setAi] = useState<{ loading: boolean; text: string }>({ loading: false, text: '' })
  const [reminding, setReminding] = useState(false)
  const isOpen = error.status === 'Open'

  const askAi = async () => {
    if (ai.loading) return
    setAi({ loading: true, text: '' })
    try {
      const out = await gasAction<{ suggestion: string }>('reconAiSuggest', { errorId: error.id })
      setAi({ loading: false, text: out.suggestion })
    } catch (e) {
      setAi({ loading: false, text: '' })
      toast({ type: 'danger', title: 'No suggestion', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  // Text the person about a punch only they can fix.
  const remind = async () => {
    if (reminding) return
    const what = error.type === 'noEnd' ? 'open punch' : 'missing punch'
    const ok = await askConfirm({
      title: `Text ${error.employeeName || 'this person'} about this ${what}?`,
      body: 'This sends an SMS to their phone.',
      confirmLabel: 'Send the text',
      tone: 'danger',
    })
    if (!ok) return
    setReminding(true)
    try {
      const out = await gasAction<{ reminded: boolean; to: string; reason?: string }>('reconErrorRemind', { errorId: error.id })
      if (out.reminded) {
        toast({ type: 'success', title: `Text queued for ${formatPhoneDisplay(out.to) || 'their phone'}` })
      } else {
        toast({
          type: 'warning',
          title: 'Reminder not sent',
          body: out.reason === 'situation disabled'
            ? 'The reminder situation is disabled in Smart Comms — enable it to send.'
            : out.reason || 'Nothing was sent.',
        })
      }
    } catch (e) {
      toast({ type: 'danger', title: 'Reminder not sent', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setReminding(false)
    }
  }

  const consumers = consumerList(error.consumers)
  // a resolved card offers only its way back; an open one its type's resolutions and "Mark reviewed"
  const actions: ReconStatus[] = isOpen ? [...(TYPE_ACTIONS[error.type] ?? []), 'Reviewed'] : ['Open']
  // only the person can fix a punch they never made or never closed — and only while it is still open
  const remindable = isOpen && (error.type === 'missing' || error.type === 'noEnd')

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge label={meta.label} tint={meta.tint} />
        {!isOpen && <Badge label={error.status} tint={STATUS_TINT[error.status] ?? 'mint'} />}
        <span className="flex items-center gap-1 text-[13.5px] font-medium text-text-2">
          <CalendarDays size={13} className="text-text-3" />
          {dayLabel(error.date)}
          {(error.startTime || error.endTime) && (
            <span className="tabular-nums text-text-3">
              · {timeLabel(error.startTime) || '?'}
              {error.endTime ? ` – ${timeLabel(error.endTime)}` : ' – open'}
            </span>
          )}
        </span>
        {!!Number(error.hours) && (
          <span className="text-[13px] tabular-nums text-text-3">{hoursLabel(error.hours)}</span>
        )}
        {consumers.length > 0 && (
          <span className="flex min-w-0 items-center gap-1 text-[13px] text-text-3" title={consumers.join(', ')}>
            <Users size={13} className="shrink-0" />
            <span className="truncate">{consumers.join(', ')}</span>
          </span>
        )}
      </div>

      {error.detail && <p className="mt-2 text-[14px] leading-5 text-text-2">{error.detail}</p>}

      {/* the resolution is the audit record: who, when, and the note that is its evidence */}
      {!isOpen && (
        <div className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-[13px] leading-5">
          <p className="text-text-3">
            {error.status} · {error.resolvedBy || '—'} · {stampLabel(error.resolvedAt)}
          </p>
          {error.note && <p className="mt-0.5 text-text-1">{error.note}</p>}
        </div>
      )}

      {/* The reminder trail, only when the server has stamped one — a queued
          text is part of the audit record, not a hidden side effect. */}
      {error.reminderQueuedAt && (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-text-3">
          <MessageSquare size={12} />
          reminder queued {stampLabel(error.reminderQueuedAt)}
          {error.remindedBy ? ` · ${error.remindedBy}` : ''}
        </p>
      )}

      {ai.text && (
        <div className={cn('mt-3 rounded-md px-3 py-2 text-[13.5px] leading-5', TINT_BG.lavender, TINT_FG.lavender)}>
          <p className="flex items-center gap-1.5 font-semibold">
            <Sparkles size={13} /> AI suggestion — context, not a decision
          </p>
          <p className="mt-1 font-normal">{ai.text}</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {actions.map((s) => (
          <button
            key={s} type="button" onClick={() => onAction(error, s)}
            className={cn(
              'inline-flex h-8 items-center rounded-md border px-2.5 text-[13px] font-semibold transition-colors',
              s === 'Reviewed' || s === 'Open'
                ? 'border-border bg-surface text-text-2 hover:bg-surface-2'
                : 'border-primary/30 bg-tint-blue text-tint-fg-blue hover:bg-tint-blue/70',
            )}
          >
            {ACTION_LABEL[s]}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
        {remindable && (
          <button
            type="button" onClick={() => void remind()} disabled={reminding}
            title="Text the person about this punch — they are the one who can fix it"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            {reminding ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />} Remind
          </button>
        )}
        {isOpen && (
          <button
            type="button" onClick={() => void askAi()} disabled={ai.loading}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            {ai.loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI
          </button>
        )}
        <button
          type="button" onClick={() => onViewShifts(error)}
          className="inline-flex h-8 items-center rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
        >
          View shifts
        </button>
      </div>
    </div>
  )
}

type EmpGroup = { key: string; id: string; name: string; list: ReconError[] }
type HouseGroup = { house: string; total: number; byType: TypeCounts | null; employees: EmpGroup[]; shown: number }

const UNKNOWN_HOUSE = 'Unknown location'

/** The section a location is drawn in. The lane counts a blank location under house '' in byHouse; the queue draws it
 *  as UNKNOWN_HOUSE — both sides go through here, so that section keeps the lane's order, total and type chips. */
const sectionOf = (loc: unknown): string => String(loc ?? '').trim() || UNKNOWN_HOUSE

/** The person an error is about, as the queue groups it: the people id, else the name. */
function empKey(e: ReconError): string {
  return e.employeeId || `name:${(e.employeeName || '').trim().toLowerCase()}`
}

export default function ErrorQueue({
  errors,
  byHouse,
  houseFiltered,
  typeFilter,
  resetKey,
  empty,
  onAction,
  onViewShifts,
}: {
  errors: ReconError[]
  /** the lane's counts per house — the sections' order and their full totals (every type) */
  byHouse: { house: string; total: number; byType: TypeCounts }[]
  /** a house filter is set: its section opens whatever the count */
  houseFiltered: boolean
  typeFilter: string
  /** the filters the answer on screen was read for, as one string: a new filter set folds and pages afresh on its
   *  first answer; a resolve's quiet refetch (the same filters) never does */
  resetKey: string
  empty: { title: string; body: string }
  onAction: (error: ReconError, status: ReconStatus) => void
  onViewShifts: (error: ReconError) => void
}) {
  // location → employee → cards; ALL of them, before anything is cut
  const groups = useMemo<HouseGroup[]>(() => {
    const byLoc = new Map<string, Map<string, EmpGroup>>()
    for (const e of errors) {
      const loc = sectionOf(e.location)
      const k = empKey(e)
      if (!byLoc.has(loc)) byLoc.set(loc, new Map())
      const byEmp = byLoc.get(loc)!
      if (!byEmp.has(k)) byEmp.set(k, { key: k, id: e.employeeId, name: e.employeeName || 'Unknown employee', list: [] })
      byEmp.get(k)!.list.push(e)
    }
    const order = new Map(byHouse.map((h, i) => [sectionOf(h.house), i]))
    const counts = new Map(byHouse.map((h) => [sectionOf(h.house), h]))
    return [...byLoc.entries()]
      .sort((a, b) => (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity) || a[0].localeCompare(b[0]))
      .map(([house, byEmp]) => {
        const employees = [...byEmp.values()]
          .sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name))
        const shown = employees.reduce((s, x) => s + x.list.length, 0)
        const c = counts.get(house)
        return { house, total: c?.total ?? shown, byType: c?.byType ?? null, employees, shown }
      })
  }, [errors, byHouse])

  // the sections' default is decided on this filter set's first answer and kept through its refetches
  const fold = useQueueFolds(resetKey, groups.length, houseFiltered)

  if (errors.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState title={empty.title} body={empty.body} />
      </Card>
    )
  }

  const allOpen = groups.every((g) => fold.isOpen(g.house))

  return (
    <div className="space-y-2.5">
      {groups.length > 1 && (
        <div className="flex justify-end px-1">
          <button
            type="button"
            onClick={() => fold.setAll(groups.map((g) => g.house), !allOpen)}
            className="text-[12.5px] font-semibold text-primary"
          >
            {allOpen ? 'Fold every house' : 'Open every house'}
          </button>
        </div>
      )}
      {groups.map((g) => {
        const open = fold.isOpen(g.house)
        return (
          <Card key={g.house} padded={false} className="overflow-hidden">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => fold.setOpen(g.house, !open)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <ChevronRight size={16} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-90')} />
              <span className="text-[14px] font-bold text-text-1">{g.house}</span>
              <span className="text-[13px] text-text-3">
                {g.employees.length} {g.employees.length === 1 ? 'person' : 'people'}
              </span>
              {g.byType && (
                <span className="flex flex-wrap items-center gap-1">
                  {RECON_TYPES.filter((t) => (g.byType?.[t] ?? 0) > 0).map((t) => (
                    <span
                      key={t}
                      title={TYPE_META[t].label}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
                        TINT_BG[TYPE_META[t].tint], TINT_FG[TYPE_META[t].tint],
                        typeFilter && typeFilter !== t && 'opacity-40',
                      )}
                    >
                      <span className="tabular-nums">{g.byType?.[t]}</span>
                      {TYPE_META[t].label.toLowerCase()}
                    </span>
                  ))}
                </span>
              )}
              <span className="ml-auto text-[13px] font-semibold tabular-nums text-text-1">
                {typeFilter && g.shown !== g.total ? `${g.shown} of ${g.total}` : g.total}
              </span>
            </button>

            {open && (
              <div className="space-y-4 border-t border-border bg-surface-2/40 px-3 py-3 sm:px-4">
                {g.employees.map((e) => {
                  const lk = `${g.house}|${e.key}`
                  const limit = fold.limitOf(lk)
                  const rest = e.list.length - limit
                  return (
                    <div key={e.key}>
                      <div className="mb-1.5 flex items-center gap-2 px-1">
                        <DragPerson name={e.name === 'Unknown employee' ? '' : e.name} id={e.id || undefined} subtitle={g.house}>
                          <span className="text-[14px] font-semibold text-text-1">{e.name}</span>
                        </DragPerson>
                        <span className="text-[12.5px] tabular-nums text-text-3">{e.list.length}</span>
                      </div>
                      <div className="space-y-2">
                        {e.list.slice(0, limit).map((err) => (
                          <ErrorCard key={err.id} error={err} onAction={onAction} onViewShifts={onViewShifts} />
                        ))}
                      </div>
                      {rest > 0 && (
                        <button
                          type="button"
                          onClick={() => fold.showMore(lk)}
                          className="mt-2 h-8 w-full rounded-md border border-dashed border-border text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
                        >
                          Show {Math.min(rest, PER_EMPLOYEE)} more{rest > PER_EMPLOYEE ? ` of ${rest}` : ''}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
