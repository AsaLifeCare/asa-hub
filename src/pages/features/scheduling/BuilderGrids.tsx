// The Builder's two grids.
// SET A/B PATTERN: Week A and Week B side by side, Monday to Sunday, OPEN on top with a "+" per day, a person per…
import { useState } from 'react'
import { History, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CELL_LEGEND } from '@/pages/features/shifts/shiftUi'
import { TIME_OFF_HATCH } from './Legend'
import {
  OPEN_KEY, WEEKDAYS, daysOf, shiftInfo, shortDay, weekLetter, weekdayOf, type BuilderRow, type BuilderStaff, type Draft,
} from './builderModel'
import { FIELD, schedTint } from './SchedulingParts'

export type CellPress =
  | { row: string; week: 'a' | 'b'; dow: number; index?: number }
  | { row: string; iso: string; index?: number }

const CELL = 'relative h-8 w-full min-w-[64px] rounded-[8px] px-1 text-[11.5px] font-semibold transition-shadow hover:ring-1 hover:ring-primary'
const HEAD = 'px-1 py-1.5 text-center text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-3'

function ShiftCell({ text, selected, hatch, onPress }: { text: string; selected: boolean; hatch?: boolean; onPress: () => void }) {
  const kind = shiftInfo(text).kind
  return (
    <button type="button" onClick={onPress} aria-pressed={selected}
      className={cn(CELL, text ? schedTint(kind) : 'bg-surface-2 text-text-3', kind === 'off' && 'border border-border bg-surface',
        selected && 'ring-2 ring-primary')}>
      {hatch && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[8px]" style={{ backgroundImage: TIME_OFF_HATCH }} />}
      <span className="relative">{text || '—'}</span>
    </button>
  )
}

function OpenDay({ list, selected, onPress, onAdd }: {
  list: string[]
  selected: number | null
  onPress: (i: number) => void
  onAdd: () => void
}) {
  return (
    <div className="flex min-w-[64px] flex-col items-stretch gap-1">
      {list.map((t, i) => (
        <button key={`${t}|${i}`} type="button" onClick={() => onPress(i)}
          className={cn('h-7 rounded-[8px] px-1 text-[11px] font-semibold', schedTint(shiftInfo(t).kind), selected === i && 'ring-2 ring-primary')}>
          {t}
        </button>
      ))}
      <button type="button" onClick={onAdd} aria-label="Add an OPEN shift"
        className="grid h-7 place-items-center rounded-[8px] text-primary hover:bg-tint-primary"><Plus size={14} /></button>
    </div>
  )
}

/** The row's person: a picker of that person and every active staff member not on the rows yet. */
function RowName({ row, choices, onPick, onDrop, warn }: {
  row: BuilderRow
  choices: BuilderStaff[]
  onPick: (s: BuilderStaff) => void
  onDrop: () => void
  warn: string
}) {
  return (
    <div className="flex items-center gap-1">
      <select value={row.key} aria-label={`Row of ${row.name}`} title={warn || row.name}
        onChange={(e) => { const s = choices.find((c) => c.key === e.target.value); if (s) onPick(s) }}
        className={cn(FIELD, 'mt-0 h-8 min-w-0 flex-1 text-[12px]', warn && 'border-warning')}>
        <option value={row.key}>{row.name}</option>
        {choices.map((s) => <option key={s.key} value={s.key}>{s.name}{s.ist === true ? '' : ' (no IST here)'}</option>)}
      </select>
      <button type="button" onClick={onDrop} aria-label={`Remove ${row.name}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-danger"><X size={13} /></button>
    </div>
  )
}

export function AddStaff({ choices, onAdd, why }: { choices: BuilderStaff[]; onAdd: (s: BuilderStaff) => void; why: string }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Add staff"
        className="grid h-6 w-6 place-items-center rounded-md text-primary hover:bg-tint-primary"><Plus size={14} /></button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <select autoFocus defaultValue="" aria-label="Add staff" className={cn(FIELD, 'mt-0 h-8 w-[170px] text-[12px]')}
        onChange={(e) => { const s = choices.find((c) => c.key === e.target.value); if (s) { onAdd(s); setOpen(false) } }}>
        <option value="">{choices.length ? 'Pick active staff…' : why || 'Nobody else is active'}</option>
        {choices.map((s) => <option key={s.key} value={s.key}>{s.name}{s.ist === true ? '' : ' (no IST here)'}</option>)}
      </select>
      <button type="button" onClick={() => setOpen(false)} aria-label="Not now"
        className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2"><X size={13} /></button>
    </span>
  )
}

export function PatternGrid({ draft, staff, staffWhy, selected, warnOf, onPress, onAddRow, onSwapRow, onDropRow, onCopy, canCopy }: {
  draft: Draft
  staff: BuilderStaff[]
  staffWhy: string
  selected: CellPress | null
  warnOf: (key: string) => string
  onPress: (p: CellPress) => void
  onAddRow: (s: BuilderStaff) => void
  onSwapRow: (from: string, s: BuilderStaff) => void
  onDropRow: (key: string) => void
  onCopy: (week: 'a' | 'b') => void
  canCopy: boolean
}) {
  const onRows = new Set(draft.rows.map((r) => r.key))
  const choices = staff.filter((s) => !onRows.has(s.key))
  const isSel = (row: string, week: 'a' | 'b', dow: number) =>
    Boolean(selected && 'week' in selected && selected.row === row && selected.week === week && selected.dow === dow)
  const weeks: ('a' | 'b')[] = ['a', 'b']
  return (
    <div className="scroll-thin overflow-x-auto" data-pattern-grid="">
      <table className="w-full min-w-[1080px] border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="w-[190px]" />
            {weeks.map((w) => (
              <th key={w} colSpan={7} className={cn('rounded-[10px] bg-surface-2 py-1.5', w === 'b' && 'border-l-2 border-border')}>
                <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-text-1">
                  Week {w.toUpperCase()}
                  <button type="button" disabled={!canCopy} onClick={() => onCopy(w)} data-act={`copy-${w}`}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-text-3 hover:text-primary disabled:opacity-40">
                    <History size={12} /> Copy previous
                  </button>
                </span>
              </th>
            ))}
          </tr>
          <tr>
            <th className="text-left">
              <span className="inline-flex items-center gap-1.5 pl-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
                Staff <AddStaff choices={choices} onAdd={onAddRow} why={staffWhy} />
              </span>
            </th>
            {weeks.map((w) => WEEKDAYS.map((d) => <th key={`${w}${d}`} className={HEAD}>{d}</th>))}
          </tr>
        </thead>
        <tbody>
          <tr className="align-top">
            <td className="pl-1 pt-1 text-[12px] font-semibold text-text-1">OPEN</td>
            {weeks.map((w) => (w === 'a' ? draft.open_a : draft.open_b).map((list, dow) => (
              <td key={`${w}${dow}`}>
                <OpenDay list={list}
                  selected={selected && 'week' in selected && selected.row === OPEN_KEY && selected.week === w && selected.dow === dow ? selected.index ?? null : null}
                  onPress={(i) => onPress({ row: OPEN_KEY, week: w, dow, index: i })}
                  onAdd={() => onPress({ row: OPEN_KEY, week: w, dow })} />
              </td>
            )))}
          </tr>
          {draft.rows.map((r) => (
            <tr key={r.key}>
              <td>
                <RowName row={r} choices={choices} warn={warnOf(r.key)} onPick={(s) => onSwapRow(r.key, s)} onDrop={() => onDropRow(r.key)} />
              </td>
              {weeks.map((w) => (w === 'a' ? draft.a : draft.b)[r.key].map((text, dow) => (
                <td key={`${w}${dow}`}>
                  <ShiftCell text={text} selected={isSel(r.key, w, dow)} onPress={() => onPress({ row: r.key, week: w, dow })} />
                </td>
              )))}
            </tr>
          ))}
        </tbody>
      </table>
      {draft.rows.length === 0 && <p className="px-2 py-4 text-[12.5px] text-text-3">No staff yet — add them with the + beside Staff.</p>}
    </div>
  )
}

export function BuilderLegend() {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 px-3 py-2 text-[11.5px] text-text-2" data-legend="">
      {CELL_LEGEND.filter((k) => k.kind !== 'alias').map((k) => (
        <span key={k.kind} className="inline-flex items-center gap-1.5">
          <i aria-hidden className={cn('inline-block h-3 w-[18px] rounded-[4px]', schedTint(k.kind), k.kind === 'off' && 'border border-border')} />
          {k.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden className="relative inline-block h-3 w-[18px] overflow-hidden rounded-[4px] border border-border bg-surface" style={{ backgroundImage: TIME_OFF_HATCH }} />
        Time off
      </span>
    </div>
  )
}

export function AssignGrid({ draft, first, last, timeOff, selected, onPress, today }: {
  draft: Draft
  first: string
  last: string
  timeOff: Set<string>
  selected: CellPress | null
  onPress: (p: CellPress) => void
  today: string
}) {
  const days = daysOf(first, last)
  const isSel = (row: string, iso: string) => Boolean(selected && 'iso' in selected && selected.row === row && selected.iso === iso)
  return (
    <div className="scroll-thin overflow-x-auto" data-assign-grid="">
      <table className="border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-[170px] bg-surface" />
            {days.map((iso, i) => {
              const dow = weekdayOf(iso)
              return (
                <th key={iso} className={cn(HEAD, (dow === 5 || dow === 6) && 'rounded-md bg-surface-2', dow === 0 && i > 0 && 'border-l-2 border-border')}>
                  {dow === 0 && <span className="block text-[9.5px] text-primary">Week {Math.floor(i / 7) + 1} · {weekLetter(first, iso).toUpperCase()}</span>}
                  <span className="block">{WEEKDAYS[dow]}</span>
                  <span className={cn('block normal-case tracking-normal', iso === today ? 'text-primary' : 'text-text-2')}>{shortDay(iso)}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          <tr className="align-top">
            <td className="sticky left-0 z-10 bg-surface pl-1 pt-1 text-[12px] font-semibold text-text-1">OPEN</td>
            {days.map((iso) => (
              <td key={iso}>
                <OpenDay list={draft.open[iso] ?? []}
                  selected={selected && 'iso' in selected && selected.row === OPEN_KEY && selected.iso === iso ? selected.index ?? null : null}
                  onPress={(i) => onPress({ row: OPEN_KEY, iso, index: i })} onAdd={() => onPress({ row: OPEN_KEY, iso })} />
              </td>
            ))}
          </tr>
          {draft.rows.map((r) => (
            <tr key={r.key}>
              <td className="sticky left-0 z-10 max-w-[170px] truncate bg-surface pl-1 text-[12px] font-medium text-text-1" title={r.name}>{r.name}</td>
              {days.map((iso) => (
                <td key={iso}>
                  <ShiftCell text={draft.cells[r.key]?.[iso] ?? ''} selected={isSel(r.key, iso)} hatch={timeOff.has(`${r.key}|${iso}`)}
                    onPress={() => onPress({ row: r.key, iso })} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
