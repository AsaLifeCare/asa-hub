// One house's staff×day grid for Scheduling, forked from the house calendars' grid: OPEN rows on top, the people's…
// Every value is the server's; the grid draws and opens the panel, nothing else.
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeftRight, Award, Flag, GraduationCap, House, PhoneOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cellText } from '@/pages/features/shifts/cellClock'
import { schedTint } from './SchedulingParts'
import { OPEN_CLAIMED, OPEN_RED, weekKeyOf } from '@/pages/features/shifts/houseCalTypes'
import { REQUEST_FLAG, TIME_OFF_ASKED, TIME_OFF_HATCH, TRAINING_EDGE, TRAINING_WAITING_EDGE } from './Legend'
import {
  MED_CLASS, badgeList, cellMarks, openLabel, orderRows, pickKey, trainingTitle,
  type BadgeView, type Badges, type Cell, type Drawn, type Grid, type GridRow, type PickMark,
} from './schedulingModel'

export type CellTarget = { rowId: string; iso: string }

/** One cell's part in a drag: its key (pickKey), whether it may be picked up, is the one held, is under the pointer. */
type CellDnd = {
  at: string; canDrag: boolean; held: boolean; over: boolean
  press: (e: ReactPointerEvent) => void
}

export function BadgeIcons({ badges, size = 12 }: { badges: Partial<Badges> | null | undefined; size?: number }) {
  const list = badgeList(badges)
  if (!list.length) return null
  return (
    <span className="inline-flex items-center gap-1" data-badges="">
      {list.map((b) => <BadgeIcon key={b.id === 'med' ? `med-${b.level}` : b.id} badge={b} size={size} />)}
    </span>
  )
}

function BadgeIcon({ badge, size }: { badge: BadgeView; size: number }) {
  if (badge.id === 'hm') {
    return (
      <span role="img" title={badge.label} aria-label={badge.label} data-badge="hm"
        className="inline-grid h-5 w-5 place-items-center rounded-full bg-tint-mint text-tint-fg-mint">
        <House size={size} />
      </span>
    )
  }
  if (badge.id === 'lead') {
    return (
      <span role="img" title={badge.label} aria-label={badge.label} data-badge="lead"
        className="inline-grid h-5 w-5 place-items-center rounded-full bg-tint-lavender text-tint-fg-lavender">
        <Flag size={size} />
      </span>
    )
  }
  return (
    <span role="img" title={badge.label} aria-label={badge.label} data-badge={`med-${badge.level}`} data-tone={badge.tone}
      className={cn('inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10.5px] font-semibold', MED_CLASS[badge.tone])}>
      <Award size={size} />{badge.level}
    </span>
  )
}

function SchedulingGrid({ grid, house, clock, drawn, hours, today, selected, onOpen, pick = null, onPick, phones = {}, drag = null,
  onShift = false }: {
  grid: Grid
  /** each person's phone as read on screen, by key (schedulingModel.phonesOf) */
  phones?: Record<string, string>
  /** the house's short name (a training cell names it) */
  house?: string
  /** the Time switch — the cells spelled as clock times; display only */
  clock: boolean
  drawn: Drawn
  /** the hours column and every figure in hours (schedulingModel.hoursShown) */
  hours: boolean
  today: string
  selected?: CellTarget | null
  onOpen: (target: CellTarget) => void
  /** Swap shifts is picking: each cell's mark (schedulingModel.pickMarks); a press only picks, never opens */
  pick?: Record<string, PickMark> | null
  onPick?: (target: CellTarget) => void
  /** shifts dragged onto another cell: the cells that may be picked up (pickKey), and what a drop opens */
  drag?: { keys: Set<string>; onDrop: (from: CellTarget, to: CellTarget) => void } | null
  /** the ON SHIFT row under the people: the master's alone (the operator, 10-31) */
  onShift?: boolean
}) {
  const rows = useMemo(() => orderRows(grid.rows), [grid.rows])
  // the drag runs on pointer events, never the browser's own drag and drop: that one does not start from a button
  // (the whole cell) in every browser. A press that moves 6px picks the shift up; the release over a cell drops it.
  const [held, setHeld] = useState<{ at: CellTarget; text: string; x: number; y: number } | null>(null)
  const [over, setOver] = useState('')
  const press = useRef<{ at: CellTarget; text: string; x: number; y: number } | null>(null)
  const moved = useRef(false)
  const ghost = useRef<HTMLDivElement>(null)
  const onDrop = useRef(drag?.onDrop)
  onDrop.current = drag?.onDrop
  const dragOn = Boolean(drag) && !pick
  useEffect(() => {
    if (!dragOn) return
    const cellAt = (x: number, y: number): CellTarget | null => {
      const [rowId, iso] = (document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-at]')?.dataset.at ?? '').split('|')
      return rowId && iso ? { rowId, iso } : null
    }
    const reset = () => {
      press.current = null
      setHeld(null)
      setOver('')
      // the click that ends a drag is the drop's, never a press on the cell
      setTimeout(() => { moved.current = false }, 0)
    }
    const move = (e: PointerEvent) => {
      const p = press.current
      if (!p) return
      if (!moved.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return
        moved.current = true
        setHeld({ at: p.at, text: p.text, x: e.clientX, y: e.clientY })
      }
      if (ghost.current) ghost.current.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 10}px)`
      const t = cellAt(e.clientX, e.clientY)
      const key = t ? pickKey(t.rowId, t.iso) : ''
      setOver((o) => (o === key ? o : key))
    }
    const up = (e: PointerEvent) => {
      const p = press.current
      if (!p) return
      if (!moved.current) { press.current = null; return }
      const t = cellAt(e.clientX, e.clientY)
      reset()
      if (t) onDrop.current?.(p.at, t)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && press.current) reset() }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', reset)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', reset)
      document.removeEventListener('keydown', key)
    }
  }, [dragOn])
  const dndOf = (at: CellTarget, text: string): CellDnd | undefined => {
    if (!dragOn || !drag) return undefined
    const key = pickKey(at.rowId, at.iso)
    return {
      at: key, canDrag: drag.keys.has(key), held: held ? pickKey(held.at.rowId, held.at.iso) === key : false,
      over: Boolean(held) && over === key,
      // a mouse or a pen picks a shift up; a finger keeps scrolling the grid
      press: (e) => {
        if (e.button !== 0 || e.pointerType === 'touch' || !drag.keys.has(key)) return
        press.current = { at, text, x: e.clientX, y: e.clientY }
        moved.current = false
      },
    }
  }
  const shown = grid.cols.map((c, i) => ({ c, i })).filter(({ c }) => c.iso >= drawn.from && c.iso <= drawn.to)
  const week = drawn.range === 'week' ? weekKeyOf(drawn.from) : ''
  const hoursOf = (r: GridRow) => (week ? r.hours?.by_week?.[week] : r.hours?.period) ?? 0
  const dayOf = (iso: string) => grid.days.find((d) => d.iso === iso)
  const drawnHours = Math.round(shown.reduce((n, { c }) => n + (dayOf(c.iso)?.hours ?? 0), 0) * 100) / 100

  return (
    <>
    <table className={cn('w-full border-collapse text-[12px]', held && 'cursor-grabbing select-none')} data-sched-grid={grid.code}
      data-dragging={held ? '' : undefined}>
      <thead>
        <tr className="border-b border-border">
          <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-semibold text-text-2 max-sm:w-[120px] max-sm:max-w-[120px] max-sm:px-2">
            Staff
          </th>
          <th className="px-2 py-2 text-left font-semibold text-text-3" title="House manager · Medication Administration 1/2/3 · Team leader">
            <span className="sr-only">Roles</span>
          </th>
          {hours && (
            <th className="whitespace-nowrap px-2 py-2 text-right font-semibold text-text-3" title="Hours at this house over the days drawn">
              {week ? 'Hrs (week)' : 'Hrs (period)'}
            </th>
          )}
          {shown.map(({ c }) => {
            const isToday = c.iso === today
            return (
              <th key={c.iso} data-iso={c.iso}
                className={cn('px-2 py-2 text-left font-semibold',
                  isToday ? 'bg-tint-primary text-text-1' : 'text-text-3',
                  clock ? 'min-w-[152px]' : 'min-w-[92px] max-sm:min-w-[72px]')}
                title={isToday ? 'Today, in Ohio' : undefined}>
                <span className="block text-[10px] uppercase tracking-[0.06em]">{c.weekday}</span>
                {c.short || c.date || c.iso}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const nobody = r.kind !== 'person'
          return (
            <tr key={r.row_id} data-row={r.row_id} data-kind={r.kind}
              className={cn('border-b border-border', (r.kind === 'workshop' || r.kind === 'other') && 'opacity-60')}>
              <td className={cn('sticky left-0 z-10 bg-surface px-3 py-1.5 font-medium text-text-1 max-sm:w-[120px] max-sm:max-w-[120px] max-sm:truncate max-sm:px-2',
                r.kind === 'open' && 'border-l-2 border-dashed border-l-[#8b0000]/50')}>
                {r.kind === 'open' ? (
                  <span className="font-semibold tracking-[0.04em] text-danger" title="A shift nobody holds yet">{openLabel(r.row_id)}</span>
                ) : nobody ? (
                  <span className="text-text-2">{r.name}</span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0">
                      <span className="block truncate">{r.name}</span>
                      {phones[r.key] && (
                        <span className="block truncate text-[10.5px] font-normal leading-[13px] text-text-3 tabular-nums" data-phone={r.key}>
                          {phones[r.key]}
                        </span>
                      )}
                    </span>
                    {r.me && (
                      <span className="shrink-0 rounded-full bg-primary-soft px-1.5 text-[10px] font-semibold text-primary-strong" data-you="">You</span>
                    )}
                  </span>
                )}
              </td>
              <td className="px-1.5 py-1.5">{!nobody && <BadgeIcons badges={r.badges} />}</td>
              {hours && (
                <td className="px-2 py-1.5 text-right tabular-nums text-text-2">{nobody ? '' : hoursOf(r) ? `${hoursOf(r)}` : '—'}</td>
              )}
              {shown.map(({ c, i }) => (
                <GridCell key={c.iso} row={r} cell={r.cells[i] ?? null} iso={c.iso} label={c.short || c.iso} house={house || grid.code}
                  clock={clock} hours={hours} today={c.iso === today}
                  selected={selected?.rowId === r.row_id && selected?.iso === c.iso}
                  picking={Boolean(pick)} mark={pick ? pick[pickKey(r.row_id, c.iso)] ?? null : null}
                  dnd={dndOf({ rowId: r.row_id, iso: c.iso }, r.cells[i]?.text ?? '')}
                  onOpen={() => {
                    if (moved.current) return
                    if (pick) onPick?.({ rowId: r.row_id, iso: c.iso })
                    else onOpen({ rowId: r.row_id, iso: c.iso })
                  }} />
              ))}
            </tr>
          )
        })}
        {onShift && (
          <tr className="border-t-2 border-border" data-on-shift="">
            <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
              On shift
            </td>
            <td />
            {hours && (
              <td className="px-2 py-1.5 text-right tabular-nums text-[11px] font-semibold text-text-2" data-hours-total="">{drawnHours}</td>
            )}
            {shown.map(({ c }) => {
              const day = dayOf(c.iso)
              return (
                <td key={c.iso} className="px-2 py-1.5 text-[11px] tabular-nums text-text-2">
                  {day?.working ? (hours && typeof day.hours === 'number' ? `${day.working} · ${day.hours}h` : `${day.working}`) : '—'}
                </td>
              )
            })}
          </tr>
        )}
      </tbody>
    </table>
    {/* the shift in the air, following the pointer (moved by its style, so the grid is not drawn again per move) */}
    {held && (
      <div ref={ghost} aria-hidden data-drag-ghost="" style={{ transform: `translate(${held.x + 14}px, ${held.y + 10}px)` }}
        className="pointer-events-none fixed left-0 top-0 z-50 rounded-[9px] border border-border bg-surface px-2 py-1 font-mono text-[12px] font-semibold text-text-1 shadow-3">
        {cellText(held.text, clock) || '·'}
      </div>
    )}
    </>
  )
}

/** What a cell says while Swap shifts is picking: why it cannot be picked, or what picking it does. */
function pickWords(mark: PickMark | null): string {
  if (!mark) return 'Not a shift to pick'
  if (mark.state === 'given') return 'The shift you give'
  if (mark.state === 'pick') return 'Pick it to give this shift'
  if (mark.state === 'blocked') return `Not possible: ${mark.why}`
  return mark.training.length ? `Pick it to take this shift — becomes training: ${mark.training.join(' ')}` : 'Pick it to take this shift'
}

function GridCell({ row, cell, iso, label, house, clock, hours, today, selected, picking = false, mark = null, dnd, onOpen }: {
  row: GridRow
  cell: Cell | null
  iso: string
  label: string
  /** the house's short name, as a training cell names it */
  house: string
  clock: boolean
  hours: boolean
  today: boolean
  selected: boolean
  picking?: boolean
  mark?: PickMark | null
  /** drag and drop: a drop opens the workflow's own panel, never a write (schedulingModel.dropPlan) */
  dnd?: CellDnd
  onOpen: () => void
}) {
  const live = !picking || mark?.state === 'pick' || mark?.state === 'valid'
  const marks = cellMarks(row, cell)
  const open = marks.includes('open')
  const taken = marks.includes('taken')
  const co = marks.includes('called-off')
  const trainingWait = marks.includes('training-waiting')
  const training = trainingWait || marks.includes('training')
  const echo = !cell?.text && cell?.echo ? cell.echo : ''
  const text = co ? 'C/O' : cellText(cell?.text ?? '', clock)
  const title = [
    `${row.kind === 'open' ? openLabel(row.row_id) : row.name} · ${label}`,
    co ? 'Called off — the shift is on an OPEN row' : cell?.text || (echo ? `At ${echo} that day` : 'Nothing here'),
    hours && typeof cell?.hours === 'number' && cell.hours > 0 ? `${cell.hours}h` : '',
    training ? trainingTitle(house) : '',
    trainingWait ? 'waiting on the house manager and a director' : '',
    training && cell?.flow?.state === 'approved' ? 'approved' : '',
    marks.includes('request-waiting') ? 'Request off waiting on a director' : '',
    marks.includes('swap-waiting') ? 'Swap waiting' : '',
    marks.includes('time-off-asked') ? 'Time off asked' : '',
    marks.includes('time-off') ? 'Time off' : '',
    picking ? pickWords(mark) : '',
  ].filter(Boolean).join(' · ')
  const pickState = picking ? mark?.state ?? 'off' : undefined
  return (
    <td className={cn('p-0.5', today && 'bg-tint-primary')} data-at={dnd?.at} data-drag={dnd?.canDrag ? '' : undefined}>
      <button type="button" onClick={() => { if (live) onOpen() }} title={title} aria-label={title} data-iso={iso}
        onPointerDown={dnd?.canDrag ? dnd.press : undefined}
        data-marks={marks.join(' ') || undefined} data-pick={pickState} aria-disabled={live ? undefined : true}
        className={cn(
          'relative flex min-h-9 w-full flex-col items-center justify-center overflow-hidden rounded-[9px] px-1.5 py-1 text-center leading-4 transition-[filter,opacity] hover:brightness-95',
          clock ? 'min-w-[148px]' : 'min-w-[88px] font-mono max-sm:min-w-[68px]',
          open ? OPEN_RED : taken ? OPEN_CLAIMED
            : co ? 'font-semibold text-danger ring-1 ring-inset ring-[#8b0000]/50'
            : cell?.text ? schedTint(cell.kind) : 'text-text-3',
          marks.includes('swap-waiting') && 'ring-1 ring-inset ring-info',
          training && (trainingWait ? TRAINING_WAITING_EDGE : TRAINING_EDGE),
          selected && !picking && 'shadow-[0_0_0_2px_var(--primary)]',
          dnd?.canDrag && 'cursor-grab select-none',
          dnd?.held && 'opacity-40',
          dnd?.over && !dnd.held && 'shadow-[0_0_0_2px_var(--primary)] brightness-95',
          pickState === 'off' && 'cursor-default opacity-30 hover:brightness-100',
          pickState === 'blocked' && 'cursor-not-allowed opacity-40 hover:brightness-100',
          pickState === 'pick' && 'ring-2 ring-inset ring-primary/60',
          pickState === 'valid' && 'ring-2 ring-inset ring-success',
          pickState === 'given' && 'cursor-default shadow-[0_0_0_2px_var(--primary)]',
        )}
        style={marks.includes('time-off') ? { backgroundImage: TIME_OFF_HATCH } : undefined}>
        {training && (
          <GraduationCap aria-hidden size={11} data-training={trainingWait ? 'waiting' : 'yes'}
            className={cn('absolute left-1 top-1', trainingWait ? 'text-warning' : 'text-tint-fg-lavender')} />
        )}
        {marks.includes('request-waiting') && <span aria-hidden className={REQUEST_FLAG} />}
        {marks.includes('time-off-asked') && <span aria-hidden className={TIME_OFF_ASKED} />}
        {co && <PhoneOff aria-hidden size={10} className="absolute right-1 top-1" />}
        {marks.includes('swap-waiting') && <ArrowLeftRight aria-hidden size={10} className="absolute bottom-0.5 right-1 text-info" />}
        <span className="max-w-full truncate">
          {echo ? <span className="font-sans text-[11px] italic text-text-3" data-echo="">@{echo}</span> : text || '·'}
        </span>
      </button>
    </td>
  )
}

export default memo(SchedulingGrid)
