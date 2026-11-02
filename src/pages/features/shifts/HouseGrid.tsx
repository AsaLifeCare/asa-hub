// One house's staff×day grid, shared by Live and the Builder; every mark is the relay's…
// Only the Builder drags, and never from or onto an OPEN or call-off line.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, FlaskConical, Pencil, PhoneOff, Sparkles } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { useDragFocusEnabled } from '@/lib/dragFocus'
import { cn } from '@/lib/utils'
import { cellText } from './cellClock'
import { cellTint, workbookStripe } from './shiftUi'
import { TIME_OFF_FLAG, TIME_OFF_LOOK, isAway, timeOffAt, timeOffFill, type TimeOffMarks } from './timeOffMarks'
import {
  OPEN_CLAIMED, OPEN_RED, cellKey, cellTitle, handoffAt, openByCell, ringedCells, sameName, timeOffTitle, weekKeyOf,
  type Cell, type Grid, type OpenShift, type Row,
} from './houseCalTypes'
import type { HandoffView } from './requestsLogic'
import type { PanelTarget } from './ShiftCellPanel'

/** A drag carries a cell's address, never its text, so a stale drag cannot write. */
export type DragFrom = { employee: string; colIso: string }

export type GridMode = 'operations' | 'builder'

/** The days drawn: one Saturday-start week, or the whole tab. */
export type DrawnDays = { from: string; to: string; range: 'week' | 'tab' }

/** 'OPEN 2' → 'OPEN' on Live, 'OPEN · row 2' in the Builder; any other open row keeps its name. */
function openRowLabel(name: string, mode: GridMode): string {
  const m = /^OPEN(?:\s+(\d+))?$/i.exec(name.trim())
  if (!m) return name
  return mode === 'builder' ? `OPEN · row ${m[1] ?? '1'}` : 'OPEN'
}

/** Live never draws a draft: a drafted cell that reached it reads as its base, the value the house was told. */
function liveCell(c: Cell, mode: GridMode): Cell {
  return mode === 'builder' || !c.draft ? c : { ...c, text: c.draft.base, draft: undefined }
}

function HouseGrid({
  grid, clock, mode, editor, canDrag = false, focus, onOpen, onDrop, days, me = '', timeOff, selected, dimBefore = '',
  handoffs,
}: {
  grid: Grid
  /** the Time switch — the cells spelled as clock times; display only */
  clock: boolean
  mode: GridMode
  /** the relay's answer: this reader edits this house (titles only here) */
  editor: boolean
  /** the Builder's editor may drag; House Calendars never does */
  canDrag?: boolean
  /** a day to bring into view; `tick` makes a repeat ask scroll again */
  focus?: { iso: string; tick: number }
  onOpen: (target: PanelTarget) => void
  onDrop?: (from: DragFrom, to: DragFrom, swap: boolean) => void
  /** the days to draw; every column when absent */
  days?: DrawnDays
  /** the reader's roster name, for the "You" pill */
  me?: string
  /** time off laid on the cells (timeOffMarks) */
  timeOff?: TimeOffMarks
  /** the cell the panel is open on */
  selected?: { employee: string; colIso: string } | null
  /** the Builder's unfolded past: the days before this one are drawn dimmed */
  dimBefore?: string
  /** the transfers waiting here, when the view reads them itself (the Builder); else the grid's own */
  handoffs?: HandoffView[]
}) {
  /** the names are handles for the tracker unless Calendar Builder's choice turned them off */
  const dragNames = useDragFocusEnabled('calendarbuilder')
  const [dragFrom, setDragFrom] = useState<DragFrom | null>(null)
  const [dragOver, setDragOver] = useState('')
  /** swallows the click the browser fires after a drop */
  const suppressClick = useRef(false)
  const head = useRef<HTMLTableRowElement | null>(null)

  const computed = grid.computed ?? null
  const waiting = handoffs ?? grid.handoffs
  const ringed = useMemo(() => ringedCells(computed), [computed])
  const openCells = useMemo(() => openByCell(computed), [computed])
  const isoOf = (i: number) => String(grid.cols[i]?.iso || grid.cols[i]?.date || i)
  // the drawn columns, by index into the tab
  const shownCols = grid.cols.map((_, i) => i)
    .filter((i) => !days || (isoOf(i) >= days.from && isoOf(i) <= days.to))
  const week = days?.range === 'week' ? weekKeyOf(days.from) : ''
  const hoursByPerson = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of computed?.people ?? []) m.set(p.employee, week ? (p.by_week?.[week] ?? 0) : p.hours)
    return m
  }, [computed, week])
  const todayIso = computed?.window.today ?? ''

  const focusIso = focus?.iso ?? ''
  const focusTick = focus?.tick ?? 0
  useEffect(() => {
    if (!focusTick || !focusIso) return
    const th = head.current?.querySelector(`[data-iso="${focusIso}"]`)
    if (th && 'scrollIntoView' in th) {
      (th as HTMLElement).scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    }
  }, [focusTick, focusIso])

  const drawnHours = shownCols.reduce((n, ci) => n + (computed?.days.find((d) => d.col_iso === isoOf(ci))?.hours ?? 0), 0)
  const workedDays = (r: Row) => shownCols.filter((ci) => (computed?.cells[cellKey(r.employee, isoOf(ci))]?.hours ?? 0) > 0).length

  return (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr ref={head} className="border-b border-border">
          <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-semibold text-text-2 max-sm:w-[112px] max-sm:max-w-[112px] max-sm:px-2">
            Staff
            {/* the header row says it too, so a screenshot of any part of the grid still says draft */}
            {mode === 'builder' && (
              <span className="ml-1.5 rounded-[5px] bg-warning px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em] text-surface">
                Draft
              </span>
            )}
          </th>
          <th className="whitespace-nowrap px-2 py-2 text-right font-semibold text-text-3"
            title={mode === 'builder'
              ? 'Hours at this house over the drawn days, with the draft on'
              : 'Hours rostered at this house over the drawn days'}>
            {week ? 'Hrs (week)' : 'Hrs (tab)'}
          </th>
          {shownCols.map((i) => {
            const c = grid.cols[i]
            // today is Ohio's, per the relay
            const iso = isoOf(i)
            const isToday = Boolean(todayIso) && iso === todayIso
            return (
              <th key={i} data-iso={iso}
                className={cn('px-2 py-2 text-left font-semibold',
                  isToday ? 'bg-tint-primary text-text-1' : 'text-text-3',
                  // a spelled-out range needs the room a code never did
                  clock ? 'min-w-[152px]' : 'min-w-[92px] max-sm:min-w-[72px]',
                  dimBefore && iso < dimBefore && 'opacity-50')}
                title={isToday ? 'Today, in Ohio' : undefined}>
                {c.label || c.short || c.iso || c.date || ''}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {grid.rows.map((r, ri) => {
          const mine = !r.open_row && !r.call_off_row && sameName(r.employee, me)
          const workshop = !r.open_row && /workshop/i.test(r.employee)
          const worked = r.open_row || r.call_off_row ? 0 : workedDays(r)
          return (
          <tr key={r.employee + ri} className={cn('border-b border-border', workshop && 'opacity-60')}>
            {/* inside the td, so the sticky first column keeps its box */}
            <td className={cn('sticky left-0 z-10 bg-surface px-3 py-1.5 font-medium text-text-1 max-sm:w-[112px] max-sm:max-w-[112px] max-sm:truncate max-sm:px-2',
              r.open_row && 'border-l-2 border-dashed border-l-[#8b0000]/50')}>
              {/* the call-off line is nobody */}
              {r.call_off_row ? (
                <span className="flex items-center gap-1.5 text-danger"
                  title="Shifts somebody called off — applied for and given from their red cells in Live">
                  <PhoneOff size={12} /> {r.employee}
                </span>
              ) : r.open_row ? (
                <span className="font-semibold tracking-[0.04em] text-danger" title={r.employee}>
                  {openRowLabel(r.employee, mode)}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Avatar name={r.employee} size="xs" className="h-5 w-5 shrink-0 text-[9px]" />
                  {dragNames ? (
                    <DragPerson name={r.employee} subtitle={grid.location}>
                      {r.employee}
                    </DragPerson>
                  ) : <span className="min-w-0 truncate">{r.employee}</span>}
                  {mine && (
                    <span className="rounded-full bg-primary-soft px-1.5 text-[10px] font-semibold text-primary-strong">You</span>
                  )}
                  {r.draft_row && (
                    <span className="flex items-center gap-0.5 rounded-full bg-tint-warning px-1.5 text-[10px] font-semibold text-tint-fg-warning"
                      title="Not yet a row of this house's tab — publishing gives them one">
                      <Sparkles size={9} /> new here
                    </span>
                  )}
                  {worked > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-surface-2 px-1.5 font-mono text-[10px] font-semibold text-text-2"
                      title={`${worked} ${worked === 1 ? 'day' : 'days'} with a shift in the days drawn`}>
                      {worked}
                    </span>
                  )}
                </span>
              )}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums text-text-2">
              {hoursByPerson.get(r.employee) ? `${hoursByPerson.get(r.employee)}` : '—'}
            </td>
            {shownCols.map((ci) => {
              const c = liveCell(r.cells[ci] ?? { text: '' }, mode)
              const iso = isoOf(ci)
              const key = cellKey(r.employee, iso)
              const fact = computed?.cells[key]
              const isOver = dragOver === key
              const isSource = dragFrom?.employee === r.employee && dragFrom?.colIso === iso
              // only a cell with a shift in it is an open shift
              const open: OpenShift | undefined = c.text ? openCells.get(key) : undefined
              const nobody = Boolean(r.open_row) || Boolean(r.call_off_row)
              const running = fact?.state === 'in_progress'
              // the Time switch changes the spelling, never the code behind it
              const shown = cellText(c.text, clock)
              const spelled = shown !== (c.text ?? '')
              const co = c.called_off
              const fed = c.time_off
              // an empty call-off line day opens nothing
              const blankLine = Boolean(r.call_off_row) && !c.text
              const draggable = canDrag && Boolean(c.text) && !nobody
              const off = nobody ? null : timeOffAt(timeOff, key, editor)
              const offLook = off ? TIME_OFF_LOOK[off] : null
              // a shift still on a day of scheduled time off is a conflict too
              const conflicted = ringed.has(key) || (isAway(off) && fact?.start != null)
              const handoff = !nobody && c.text ? handoffAt(waiting, r.employee, iso) : undefined
              const stripe = open || co ? null : workbookStripe(c.color)
              const isSelected = selected?.employee === r.employee && selected?.colIso === iso
              // held and old-override edges sit inside the cell, so a conflict's outline never hides them
              const held = Boolean(c.test_mode) && !c.draft && !open && !co
              const override = !held && Boolean(c.edited) && !open && !co && !c.draft
              const marks = [
                open && (open.claimed_by ? 'open-taken' : 'open'), c.draft && 'draft', running && 'running',
                co && 'called-off', c.test_mode && 'test-mode', c.rehearsal && 'rehearsal',
                c.pending && 'pending', conflicted && 'conflict',
                off && `time-off-${off}`, handoff && 'transfer', c.edited && 'override', stripe && 'workbook-colour',
              ].filter(Boolean).join(' ')
              return (
                <td key={ci} className={cn('p-0.5', dimBefore && iso < dimBefore && 'opacity-50')}>
                  <button
                    disabled={blankLine}
                    draggable={draggable}
                    data-marks={marks || undefined}
                    onDragStart={(e) => {
                      if (!draggable) return
                      setDragFrom({ employee: r.employee, colIso: iso })
                      e.dataTransfer.effectAllowed = 'move'
                      // Some browsers refuse a drag with no payload.
                      e.dataTransfer.setData('text/plain', key)
                    }}
                    onDragEnd={() => { setDragFrom(null); setDragOver('') }}
                    onDragOver={(e) => {
                      // an OPEN row is never a drop target
                      if (!dragFrom || !canDrag || nobody) return
                      e.preventDefault()
                      // a modifier swaps the two cells
                      e.dataTransfer.dropEffect = e.shiftKey || e.altKey ? 'copy' : 'move'
                      setDragOver(key)
                    }}
                    onDragLeave={() => setDragOver((k) => (k === key ? '' : k))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOver('')
                      const from = dragFrom
                      setDragFrom(null)
                      if (!from || !onDrop) return
                      suppressClick.current = true
                      onDrop(from, { employee: r.employee, colIso: iso }, e.shiftKey || e.altKey)
                    }}
                    onClick={() => {
                      if (suppressClick.current) { suppressClick.current = false; return }
                      onOpen({
                        employee: r.employee,
                        colIso: iso,
                        label: grid.cols[ci]?.short || grid.cols[ci]?.label || iso,
                        ...(open?.ref ? { ref: open.ref } : {}),
                      })
                    }}
                    title={cellTitle({
                      cell: c, spelled, open, running, mode, editor, canDrag,
                      // the request's own words (ref, until) when the relay laid its ref, else the mark's
                      timeOff: offLook ? (fed?.ref ? timeOffTitle(fed) : offLook.words) : '', transfer: Boolean(handoff),
                    })}
                    className={cn(
                      'relative flex min-h-9 w-full flex-col items-center justify-center overflow-hidden rounded-[9px] px-1.5 py-1 text-center leading-4 transition-[filter] hover:brightness-95',
                      clock ? 'min-w-[148px]' : 'min-w-[88px] font-mono max-sm:min-w-[68px]',
                      // fill: an open shift, then the kind; a caller's own cell has none
                      open ? (open.claimed_by ? OPEN_CLAIMED : OPEN_RED)
                        : co ? 'font-semibold text-danger'
                        : c.text ? cellTint(fact?.kind) : 'text-text-3',
                      // rings: a draft, else running, else the caller's own cell
                      c.draft ? 'font-semibold ring-2 ring-inset ring-warning'
                        : running && !open ? 'ring-2 ring-inset ring-success'
                        : co ? 'ring-1 ring-inset ring-[#8b0000]/50' : '',
                      held && 'italic',
                      // the outer edge is a conflict's alone
                      conflicted && 'outline outline-1 -outline-offset-1 outline-danger',
                      isOver && 'outline outline-2 outline-primary',
                      // the open cell: a halo outside it, which composes with every ring and edge
                      isSelected && 'shadow-[0_0_0_2px_var(--primary)]',
                      isSource && 'opacity-40',
                      blankLine && 'cursor-default hover:brightness-100',
                    )}
                    style={timeOffFill(off, Boolean(open))}
                  >
                    {stripe && (
                      <span aria-hidden title="Workbook colour" className="absolute inset-y-0 left-0 w-[3px]"
                        style={{ backgroundColor: stripe }} />
                    )}
                    {/* dashed: test mode held it, the workbook does not have it; dotted: an old override */}
                    {held && (
                      <span aria-hidden className="pointer-events-none absolute inset-[3px] rounded-[7px] border border-dashed border-warning" />
                    )}
                    {override && (
                      <span aria-hidden className="pointer-events-none absolute inset-[3px] rounded-[7px] border border-dotted border-text-3" />
                    )}
                    {offLook?.flag && <span aria-hidden className={TIME_OFF_FLAG} />}
                    {c.draft && <Pencil aria-hidden size={9} className="absolute right-1 top-1 text-warning" />}
                    {co && !c.draft && <PhoneOff aria-hidden size={10} className="absolute right-1 top-1" />}
                    {c.pending && !c.test_mode && !c.draft && !co && (
                      <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-success" />
                    )}
                    {conflicted && mode === 'builder' && (
                      <AlertTriangle aria-hidden size={12} className="absolute bottom-0.5 left-1 text-danger" />
                    )}
                    {handoff && <ArrowRightLeft aria-hidden size={10} className="absolute bottom-0.5 right-1 text-info" />}
                    {/* THE MARK: a square the shift rehearsal played is never read as a real assignment */}
                    {c.rehearsal && (
                      <FlaskConical aria-label="Played by the shift rehearsal" size={10}
                        className="absolute right-4 top-1 text-violet-700 dark:text-violet-300" />
                    )}
                    <span className="max-w-full truncate">
                      {shown || '·'}
                      {offLook?.tag && (
                        <span className="ml-1 rounded-sm bg-surface-3 px-0.5 align-middle font-sans text-[9px] font-semibold not-italic text-text-2">{offLook.tag}</span>
                      )}
                    </span>
                    {/* every draft shows its base, struck (and says it in the title too) */}
                    {c.draft && (
                      <span className="max-w-full truncate font-sans text-[10px] font-normal text-text-3 line-through">
                        was {c.draft.base || '·'}
                      </span>
                    )}
                  </button>
                </td>
              )
            })}
          </tr>
          )
        })}
        {computed && (
          <tr className="border-t-2 border-border">
            <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
              On shift
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums text-[11px] font-semibold text-text-2">
              {days ? Math.round(drawnHours * 100) / 100 : computed.totals.hours}
            </td>
            {shownCols.map((ci) => {
              const day = computed.days.find((d) => d.col_iso === isoOf(ci))
              return (
                <td key={ci} className={cn('px-2 py-1.5 text-[11px] tabular-nums text-text-2',
                  dimBefore && isoOf(ci) < dimBefore && 'opacity-50')}
                  title={day?.names.join(', ') || 'Nobody rostered'}>
                  {day?.working ? `${day.working} · ${day.hours}h` : '—'}
                </td>
              )
            })}
          </tr>
        )}
      </tbody>
    </table>
  )
}

export default memo(HouseGrid)
