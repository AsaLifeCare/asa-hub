// Calendar Builder · the master grid — the 28-day staff×day grid, an editor.
// One section per house (the workbook's own order, kept by sheetRow), one row per staff member, OPEN coverage slots…
import { memo, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { ohioToday } from '@/lib/ohio'
import { CELL_LEGEND, cellTint } from '@/pages/features/shifts/shiftUi'
// The Time switch is the reader's, not a screen's: the builder grid carries the same cell texts as the house…
import { cellText } from '@/pages/features/shifts/cellClock'
import type { GridCell, GridCellKind, GridPeriodCol, GridRow } from './useCalendarData'
import { draftKey, type DraftEntry } from './useBuilderLane'

/** A cell's fill and ink: the house grids' own (shiftUi.cellTint), so the two builders read alike. */
function cellClasses(kind: GridCellKind): string {
  return kind === 'empty' ? 'text-text-3' : cellTint(kind)
}

// The lane does not classify draft values — a local guess keeps an edited cell's colors honest until the next…
const TIME_RANGE = /(\d{1,2}(?:\d{2})?)\s*([AP])?-(\d{1,2}(?:\d{2})?)([AP])/i

export function guessKind(text: string): GridCellKind {
  const t = (text || '').trim()
  if (!t) return 'empty'
  if (t.toUpperCase() === 'OFF') return 'off'
  if (/^(R\/?O|C\/?O|RO|NCNS)$/i.test(t)) return 'ro'
  const m = TIME_RANGE.exec(t)
  if (!m) return 'alias'
  const hour = (h: string, ap: string) => (parseInt(h, 10) % 12) + (ap.toUpperCase() === 'P' ? 12 : 0)
  const start = hour(m[1], m[2] || m[4])
  let end = hour(m[3], m[4])
  if (end <= start) end += 24
  if (start >= 19 || end > 24) return 'overnight'
  if (end - start >= 11 && start <= 10) return 'day'
  if (start < 11) return 'morning'
  if (start < 16) return 'afternoon'
  return 'evening'
}

/** What one cell shows: the draft value when staged, the sheet's otherwise. */
function displayOf(row: GridRow, cell: GridCell, draft?: Map<string, DraftEntry>) {
  const staged = draft?.get(draftKey(row.sheetRow, cell.date))
  const text = staged ? staged.value : cell.text
  return {
    text,
    edited: Boolean(staged),
    kind: staged ? guessKind(staged.value) : cell.kind,
  }
}

export type CellEditHook = (row: GridRow, cell: GridCell) => void
export type CellCopyHook = (from: { row: GridRow; cell: GridCell }, to: { row: GridRow; cell: GridCell }) => void

const RosterCell = memo(function RosterCell({
  row,
  cell,
  draft,
  mayEdit,
  clock,
  onEdit,
  onCopy,
}: {
  row: GridRow
  cell: GridCell
  draft?: Map<string, DraftEntry>
  mayEdit: boolean
  // the Time switch — the drawing only; the value, the draft and the drag payload below all stay the CODE, which is…
  clock: boolean
  onEdit?: CellEditHook
  onCopy?: CellCopyHook
}) {
  const shown = displayOf(row, cell, draft)
  const spelled = cellText(shown.text, clock)
  const cls = cn(
    'block h-7 w-full truncate rounded-sm px-1.5 text-left text-[11px] leading-7',
    clock ? 'min-w-[128px]' : 'min-w-[64px]',
    cellClasses(shown.kind),
    shown.edited && 'font-bold ring-2 ring-inset ring-warning',
    mayEdit && 'cursor-pointer transition-colors hover:ring-1 hover:ring-inset hover:ring-primary/60',
  )
  const draggable = mayEdit && Boolean(shown.text)
  return (
    <button
      type="button"
      className={cls}
      // spelled out on screen, the code still named here: the desk edits and publishes the code, so it must never…
      title={shown.edited
        ? `${shown.text} (draft — was ${draft?.get(draftKey(row.sheetRow, cell.date))?.baseValue || 'empty'})`
        : (spelled !== shown.text ? shown.text : shown.text || undefined)}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return
        e.dataTransfer.setData('text/plain', JSON.stringify({ sheetRow: row.sheetRow, date: cell.date, text: shown.text }))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDragOver={(e) => {
        if (mayEdit) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!mayEdit || !onCopy) return
        e.preventDefault()
        try {
          const from = JSON.parse(e.dataTransfer.getData('text/plain'))
          if (from.sheetRow === row.sheetRow && from.date === cell.date) return
          const fromRow = { ...row, sheetRow: Number(from.sheetRow) }
          onCopy(
            { row: fromRow, cell: { ...cell, date: String(from.date), text: String(from.text) } },
            { row, cell },
          )
        } catch { /* a drop that is not ours is not an error */ }
      }}
      onClick={() => mayEdit && onEdit?.(row, cell)}
    >
      {spelled || ''}
    </button>
  )
})

type Section = { house: string; rows: GridRow[] }

// Group the rows by house, keeping the workbook's own order — the grid IS the sheet, and reordering it would be an…
function sectionsOf(rows: GridRow[]): Section[] {
  const out: Section[] = []
  for (const row of rows) {
    const last = out[out.length - 1]
    if (last && last.house === row.house) last.rows.push(row)
    else out.push({ house: row.house, rows: [row] })
  }
  return out
}

const isWeekend = (col: GridPeriodCol) => col.weekday === 'SAT' || col.weekday === 'SUN'

const StaffRow = memo(function StaffRow({
  row,
  cols,
  todayISO,
  draft,
  mayEdit,
  clock,
  onEditCell,
  onCopyCell,
}: {
  row: GridRow
  cols: GridPeriodCol[]
  todayISO: string
  draft?: Map<string, DraftEntry>
  mayEdit: boolean
  clock: boolean
  onEditCell?: CellEditHook
  onCopyCell?: CellCopyHook
}) {
  const open = row.rowType === 'open'
  const workshop = row.rowType === 'workshop'
  return (
    <tr className={cn('border-b border-border', open && 'border-dashed', workshop && 'opacity-60')}>
      <td
        className={cn(
          'sticky left-0 z-10 min-w-[180px] border-r border-border bg-surface px-3 py-1',
          open && 'border-l-2 border-dashed border-l-[#8b0000]/50',
          workshop && 'italic',
        )}
      >
        {open ? (
          <span className="inline-block text-[11px] font-semibold tracking-[0.04em] text-[#8b0000]">
            OPEN
          </span>
        ) : (
          <span className={cn('text-[12px] font-medium', workshop ? 'text-text-3' : 'text-text-1')}>
            {row.employee}
          </span>
        )}
        {row.designation && (
          <span className="ml-1 rounded-sm bg-surface-2 px-1 text-[10px] font-semibold text-text-2">
            {row.designation}
          </span>
        )}
      </td>
      {row.cells.map((cell, ci) => {
        const col = cols[ci]
        const today = cell.date === todayISO
        return (
          <td
            key={cell.date || ci}
            className={cn(
              'p-0.5',
              col && isWeekend(col) && 'bg-surface-2/70',
              today && 'bg-tint-primary/30',
            )}
          >
            <RosterCell
              row={row}
              cell={cell}
              draft={draft}
              mayEdit={mayEdit}
              clock={clock}
              onEdit={onEditCell}
              onCopy={onCopyCell}
            />
          </td>
        )
      })}
    </tr>
  )
})

export default function BuilderGrid({
  cols,
  rows,
  draft,
  mayEdit = false,
  clock = false,
  onEditCell,
  onCopyCell,
}: {
  /** the lane's period columns (iso, label, weekday) */
  cols: GridPeriodCol[]
  rows: GridRow[]
  /** staged edits, keyed `${sheetRow}|${date}` */
  draft?: Map<string, DraftEntry>
  mayEdit?: boolean
  /** the Time switch — the cells drawn as clock times. Display only. */
  clock?: boolean
  onEditCell?: CellEditHook
  onCopyCell?: CellCopyHook
}) {
  const todayISO = ohioToday()
  const sections = useMemo(() => sectionsOf(rows), [rows])

  if (cols.length === 0) {
    return <p className="p-8 text-center text-[13px] text-text-3">The period did not arrive with the grid.</p>
  }

  return (
    <>
      {/* the key, in the house grids' swatches */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border bg-surface px-3 py-2">
        {CELL_LEGEND.map((k) => (
          <span key={k.kind} className="flex items-center gap-1.5 text-[11px] font-medium text-text-2">
            <i aria-hidden className={cn('inline-block h-3 w-[18px] rounded-[4px]', cellTint(k.kind),
              k.kind === 'off' && 'border border-border')} />
            {k.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-text-2">
          <i aria-hidden className="inline-block h-3 w-[18px] rounded-[4px] ring-2 ring-inset ring-warning" />
          Draft
        </span>
        <span className="ml-auto text-[11px] text-text-3">
          {cols.length} days · {rows.length} rows
          {mayEdit && ' · click a cell to edit · drag a shift to copy it'}
        </span>
      </div>

      <div className="max-h-[72vh] overflow-auto rounded-lg border border-border bg-surface shadow-1">
        <table className="border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 top-0 z-30 min-w-[180px] border-r border-border bg-surface px-3 py-2 text-left font-semibold text-text-2">
                Staff
              </th>
              {cols.map((col) => {
                const today = col.iso === todayISO
                return (
                  <th
                    key={col.iso}
                    className={cn(
                      'sticky top-0 z-20 px-2 py-1 text-center font-semibold',
                      // a spelled-out range needs the room a code never did
                      clock ? 'min-w-[132px]' : 'min-w-[68px]',
                      today ? 'bg-tint-primary text-tint-fg-primary' : 'bg-surface text-text-3',
                      !today && isWeekend(col) && 'bg-surface-2 text-text-2',
                    )}
                  >
                    <span className="block text-[10px] uppercase tracking-wide">{col.weekday}</span>
                    <span className="block text-[11px]">{col.label}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <HouseSection
                key={section.house || 'unknown'}
                section={section}
                cols={cols}
                todayISO={todayISO}
                draft={draft}
                mayEdit={mayEdit}
                clock={clock}
                onEditCell={onEditCell}
                onCopyCell={onCopyCell}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function HouseSection({
  section,
  cols,
  todayISO,
  draft,
  mayEdit,
  clock,
  onEditCell,
  onCopyCell,
}: {
  section: Section
  cols: GridPeriodCol[]
  todayISO: string
  draft?: Map<string, DraftEntry>
  mayEdit: boolean
  clock: boolean
  onEditCell?: CellEditHook
  onCopyCell?: CellCopyHook
}) {
  return (
    <>
      <tr className="border-b border-border bg-surface-2/60">
        <td
          colSpan={cols.length + 1}
          className="sticky left-0 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-text-2"
        >
          {section.house || '—'}
        </td>
      </tr>
      {section.rows.map((row) => (
        <StaffRow
          key={row.sheetRow}
          row={row}
          cols={cols}
          todayISO={todayISO}
          draft={draft}
          mayEdit={mayEdit}
          clock={clock}
          onEditCell={onEditCell}
          onCopyCell={onCopyCell}
        />
      ))}
    </>
  )
}
