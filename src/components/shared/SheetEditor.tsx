// THE SPREADSHEET REPLICA'S EDITABLE SIBLING — Render Sheet with some of a spreadsheet's editing features.
// SheetReplica is contractually a VIEW — nothing there edits anything, and that contract stays.
import { memo, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

function colLetter(n: number): string {
  let s = ''
  n += 1
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

type Col = { key: string; label: string }
export type SheetEdit = { row: number; col: string; value: string; prev: string }
type CellRef = { row: number; col: string } | null

// The grid body — memoized so header drag churn cannot repaint ~9k cells; editing state repaints it, which is the…
const EditorBody = memo(function EditorBody({
  view, wrap, paint, ordered, canEdit, editing, busy, onStart, onCommit, onCancel,
}: {
  // what the toolbar left on screen — each item keeps its SHEET index, so a filtered or sorted view still edits the…
  view: { r: Record<string, unknown>; i: number }[]
  wrap: boolean
  paint: (sheetRow: number, colIdx: number) => React.CSSProperties
  ordered: Col[]
  canEdit: boolean
  editing: CellRef
  busy: CellRef
  onStart: (row: number, col: string) => void
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  return (
    <tbody>
      {view.map(({ r, i }) => (
        <tr key={i} className="hover:bg-[#f1f3f4] dark:hover:bg-surface-2">
          <td className="sticky left-0 z-[5] h-[24px] border-b border-r border-[#c7cbd1] bg-[#f8f9fa] px-1 text-center text-[10.5px] font-semibold text-[#5f6368] dark:border-border dark:bg-surface-2 dark:text-text-3">
            {i + 2}
          </td>
          {ordered.map((c, ci) => {
            const v = String(r[c.key] ?? '')
            const isEditing = editing != null && editing.row === i && editing.col === c.key
            const isBusy = busy != null && busy.row === i && busy.col === c.key
            if (isEditing) {
              return (
                <td key={c.key} data-col={c.key}
                  className="h-[24px] max-w-[320px] border-b border-r border-[#e0e2e6] bg-white p-0 dark:border-border/60 dark:bg-surface">
                  <input
                    autoFocus
                    defaultValue={v}
                    aria-label={`Edit ${c.label}, row ${i + 2}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onCommit((e.target as HTMLInputElement).value)
                      else if (e.key === 'Escape') onCancel()
                    }}
                    onBlur={onCancel}
                    className="h-[24px] w-full min-w-[110px] border-2 border-primary bg-white px-1.5 font-['Arial',sans-serif] text-[12px] text-[#202124] outline-none dark:bg-surface dark:text-text-1"
                  />
                </td>
              )
            }
            return (
              <td key={c.key} data-col={c.key} title={v}
                onDoubleClick={canEdit ? () => onStart(i, c.key) : undefined}
                // the sheet's own paint wins over the replica's theme — a red row means something to whoever…
                style={paint(i, ci)}
                className={cn(
                  'max-w-[320px] border-b border-r border-[#e0e2e6] bg-white px-2 text-[#202124] dark:border-border/60 dark:bg-surface dark:text-text-2',
                  wrap ? 'whitespace-pre-wrap align-top' : 'h-[24px] overflow-hidden truncate whitespace-nowrap',
                  canEdit && 'cursor-cell',
                  isBusy && 'animate-pulse bg-[#e8f0fe] text-[#5f6368] dark:bg-surface-3',
                )}>
                {v}
              </td>
            )
          })}
        </tr>
      ))}
      {view.length === 0 && (
        <tr><td className="sticky left-0 border-r border-[#c7cbd1] bg-[#f8f9fa] text-center text-[10.5px] text-[#5f6368]">2</td>
          <td colSpan={ordered.length} className="h-[24px] border-b border-[#e0e2e6] bg-white px-2 italic text-[#9aa0a6]">(empty)</td></tr>
      )}
    </tbody>
  )
})

export default function SheetEditor({
  columns,
  rows,
  title,
  canEdit = false,
  onCommit,
  colors,
  toolbar = false,
}: {
  /** header labels, in order — the sheet's own first row */
  columns: Col[]
  rows: Record<string, unknown>[]
  title?: string
  /** false = the read-only replica, exactly; the affordances never draw */
  canEdit?: boolean
  /** the write — resolve repaints, reject means the caller toasted + reloads */
  onCommit?: (edit: SheetEdit) => Promise<void>
  // THE SHEET'S OWN PAINT — the sheet's colours come across with it.
  colors?: { back?: string[][]; fore?: string[][]; bold?: string[][] }
  /** the tools above the grid — search, sort, zoom, wrap, CSV */
  toolbar?: boolean
}) {
  // Internal column order — a list of keys.
  const [order, setOrder] = useState<string[]>(() => columns.map((c) => c.key))
  const sigRef = useRef(columns.map((c) => c.key).join('|'))
  const sig = columns.map((c) => c.key).join('|')
  if (sig !== sigRef.current) {
    sigRef.current = sig
    setOrder(columns.map((c) => c.key))
  }
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  // the delegated handlers read the ref — state is for the paint only
  const dragRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  const [editing, setEditing] = useState<CellRef>(null)
  const [busyCell, setBusyCell] = useState<CellRef>(null)

  const ordered = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]))
    const out = order.map((k) => byKey.get(k)).filter((c): c is Col => !!c)
    // a key the order state does not know yet (defensive) still renders, last
    columns.forEach((c) => { if (!order.includes(c.key)) out.push(c) })
    return out
  }, [columns, order])

  const letters = useMemo(() => ordered.map((_, i) => colLetter(i)), [ordered])

  // THE TOOLS — at the top, near the title, a Google-Sheets-style toolbar to use on the sheets.
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null)
  const [wrap, setWrap] = useState(false)
  const [zoom, setZoom] = useState(1)

  // the rows as the grid shows them, each carrying the index it had on the SHEET — the editor writes by that…
  const view = useMemo(() => {
    let out = rows.map((r, i) => ({ r, i }))
    const needle = q.trim().toLowerCase()
    if (needle) {
      out = out.filter(({ r }) =>
        ordered.some((c) => String(r[c.key] ?? '').toLowerCase().includes(needle)))
    }
    if (sort) {
      const { col, dir } = sort
      out = [...out].sort((a, b) => {
        const x = String(a.r[col] ?? ''), y = String(b.r[col] ?? '')
        const nx = Number(x.replace(/[^0-9.-]/g, '')), ny = Number(y.replace(/[^0-9.-]/g, ''))
        const bothNumeric = x !== '' && y !== '' && !Number.isNaN(nx) && !Number.isNaN(ny)
        return (bothNumeric ? nx - ny : x.localeCompare(y)) * dir
      })
    }
    return out
  }, [rows, ordered, q, sort])

  const exportCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const lines = [ordered.map((c) => esc(c.label)).join(',')]
    view.forEach(({ r }) => lines.push(ordered.map((c) => esc(String(r[c.key] ?? ''))).join(',')))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(title || 'sheet').replace(/[^a-z0-9_-]+/gi, '-')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  /** The sheet's own paint for a cell — row 0 is the header on the sheet. */
  const paint = (sheetRow: number, colIdx: number): React.CSSProperties => {
    const back = colors?.back?.[sheetRow + 1]?.[colIdx] || ''
    const fore = colors?.fore?.[sheetRow + 1]?.[colIdx] || ''
    const bold = colors?.bold?.[sheetRow + 1]?.[colIdx] || ''
    const st: React.CSSProperties = {}
    if (back) st.backgroundColor = back
    if (fore) st.color = fore
    if (bold && bold !== 'normal') st.fontWeight = 700
    return st
  }

  const drop = (targetKey: string) => {
    const from = dragRef.current
    if (!from || from === targetKey) return
    setOrder((prev) => {
      const next = prev.filter((k) => k !== from)
      const at = next.indexOf(targetKey)
      if (at === -1) return prev
      next.splice(at, 0, from)
      return next
    })
  }

  const endDrag = () => {
    dragRef.current = null
    setDragKey(null)
    setOverKey(null)
  }

  // Delegated over the whole scroll box: any cell is a valid landing strip for OUR column drag (guarded — a…
  const onBoxDragOver = (e: React.DragEvent) => {
    if (!dragRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const el = (e.target as HTMLElement).closest('[data-col]')
    const k = el ? el.getAttribute('data-col') : null
    if (k !== overKey) setOverKey(k)
    const box = scrollRef.current
    if (box) {
      const r = box.getBoundingClientRect()
      const M = 48, STEP = 26
      if (e.clientX > r.right - M) box.scrollLeft += STEP
      else if (e.clientX < r.left + M + 44) box.scrollLeft -= STEP
      if (e.clientY > r.bottom - M) box.scrollTop += STEP
      else if (e.clientY < r.top + M + 46) box.scrollTop -= STEP
    }
  }
  const onBoxDrop = (e: React.DragEvent) => {
    if (!dragRef.current) return
    e.preventDefault()
    const el = (e.target as HTMLElement).closest('[data-col]')
    const k = el ? el.getAttribute('data-col') : null
    if (k) drop(k)
    endDrag()
  }

  /* The letters row is a drag-PAN handle — grab the sheet itself and pull. */
  const onLettersDown = (e: React.PointerEvent) => {
    const box = scrollRef.current
    if (!box) return
    panRef.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onLettersMove = (e: React.PointerEvent) => {
    const box = scrollRef.current
    const p = panRef.current
    if (!box || !p) return
    box.scrollLeft = p.left - (e.clientX - p.x)
    box.scrollTop = p.top - (e.clientY - p.y)
  }
  const onLettersUp = () => { panRef.current = null }

  const editable = canEdit && !!onCommit

  const startEdit = (row: number, col: string) => {
    if (!editable || busyCell) return
    setEditing({ row, col })
  }
  const cancelEdit = () => setEditing(null)
  const commitEdit = (value: string) => {
    const cell = editing
    if (!cell || !onCommit) return
    const prev = String(rows[cell.row]?.[cell.col] ?? '')
    setEditing(null)
    if (value === prev) return // nothing changed — no write, no busy state
    setBusyCell(cell)
    // success repaints through the caller's rows; a rejection was already toasted (and on 409, reloaded) by the…
    void onCommit({ row: cell.row, col: cell.col, value, prev })
      .catch(() => { /* the caller already toasted — a rejection must not leak */ })
      .finally(() => setBusyCell((b) => (b && b.row === cell.row && b.col === cell.col ? null : b)))
  }

  return (
    <div className="overflow-hidden rounded-md border border-[#c7cbd1] bg-white dark:border-border dark:bg-surface">
      {(title || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#c7cbd1] bg-[#f8f9fa] px-3 py-1.5 dark:border-border dark:bg-surface-2">
          {title && (
            <span className="text-[11.5px] font-semibold text-[#3c4043] dark:text-text-2">{title}</span>
          )}
          {toolbar && (
            <>
              <span className="mx-1 h-4 w-px bg-[#c7cbd1] dark:bg-border" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find in sheet"
                className="h-6 w-[150px] rounded-[6px] border border-[#c7cbd1] bg-white px-2 text-[11.5px] text-[#202124] outline-none focus:border-primary dark:border-border dark:bg-surface dark:text-text-1"
              />
              <select
                value={sort ? `${sort.col}:${sort.dir}` : ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) { setSort(null); return }
                  const [col, dir] = v.split(':')
                  setSort({ col, dir: dir === '-1' ? -1 : 1 })
                }}
                title="Sort the view — the sheet itself is never reordered"
                className="h-6 rounded-[6px] border border-[#c7cbd1] bg-white px-1 text-[11.5px] text-[#202124] dark:border-border dark:bg-surface dark:text-text-1"
              >
                <option value="">Sort…</option>
                {ordered.map((c) => (
                  <optgroup key={c.key} label={c.label}>
                    <option value={`${c.key}:1`}>{c.label} ↑</option>
                    <option value={`${c.key}:-1`}>{c.label} ↓</option>
                  </optgroup>
                ))}
              </select>
              <button
                type="button" onClick={() => setWrap((w) => !w)} aria-pressed={wrap}
                title="Wrap long text"
                className={cn('h-6 rounded-[6px] border px-2 text-[11.5px] font-medium',
                  wrap ? 'border-primary bg-primary-soft text-primary-strong'
                       : 'border-[#c7cbd1] bg-white text-[#3c4043] dark:border-border dark:bg-surface dark:text-text-2')}
              >Wrap</button>
              <span className="flex items-center rounded-[6px] border border-[#c7cbd1] bg-white dark:border-border dark:bg-surface">
                <button type="button" title="Zoom out"
                  onClick={() => setZoom((z) => Math.max(0.7, Math.round((z - 0.1) * 10) / 10))}
                  className="h-6 w-6 text-[13px] text-[#3c4043] dark:text-text-2">−</button>
                <span className="w-9 text-center text-[11px] tabular-nums text-[#5f6368] dark:text-text-3">
                  {Math.round(zoom * 100)}%
                </span>
                <button type="button" title="Zoom in"
                  onClick={() => setZoom((z) => Math.min(1.4, Math.round((z + 0.1) * 10) / 10))}
                  className="h-6 w-6 text-[13px] text-[#3c4043] dark:text-text-2">+</button>
              </span>
              <button
                type="button" onClick={exportCsv} title="Download exactly what is on screen"
                className="h-6 rounded-[6px] border border-[#c7cbd1] bg-white px-2 text-[11.5px] font-medium text-[#3c4043] dark:border-border dark:bg-surface dark:text-text-2"
              >CSV</button>
              <span className="ml-auto text-[11px] text-[#5f6368] dark:text-text-3">
                {view.length}{view.length !== rows.length ? ` of ${rows.length}` : ''} rows
              </span>
            </>
          )}
        </div>
      )}
      <div ref={scrollRef} className="scroll-thin max-h-[70vh] overflow-auto" onDragOver={onBoxDragOver} onDrop={onBoxDrop}>
        <table
          className="border-collapse font-['Arial',sans-serif] text-[12px] leading-[18px]"
          style={zoom === 1 ? undefined : { zoom }}
        >
          <thead className="sticky top-0 z-10">
            <tr
              onPointerDown={onLettersDown}
              onPointerMove={onLettersMove}
              onPointerUp={onLettersUp}
              onPointerCancel={onLettersUp}
              className="cursor-grab touch-none select-none active:cursor-grabbing"
              title="Drag here to pan the sheet"
            >
              <th className="sticky left-0 z-20 h-[22px] w-[44px] border-b border-r border-[#c7cbd1] bg-[#f8f9fa] dark:border-border dark:bg-surface-2" />
              {letters.map((l) => (
                <th key={l} className="h-[22px] min-w-[110px] border-b border-r border-[#c7cbd1] bg-[#f8f9fa] px-2 text-center text-[10.5px] font-semibold text-[#5f6368] dark:border-border dark:bg-surface-2 dark:text-text-3">
                  {l}
                </th>
              ))}
            </tr>
            <tr>
              <td className="sticky left-0 z-20 h-[24px] border-b border-r border-[#c7cbd1] bg-[#f8f9fa] text-center text-[10.5px] font-semibold text-[#5f6368] dark:border-border dark:bg-surface-2 dark:text-text-3">1</td>
              {ordered.map((c) => (
                <td
                  key={c.key}
                  data-col={c.key}
                  draggable
                  onDragStart={(e) => {
                    // setData is MANDATORY: without it Firefox never starts the drag.
                    e.dataTransfer.setData('text/plain', c.label)
                    e.dataTransfer.effectAllowed = 'move'
                    dragRef.current = c.key
                    setDragKey(c.key)
                  }}
                  onDragEnd={endDrag}
                  title="Drag to reorder this column"
                  className={cn(
                    'h-[24px] cursor-grab select-none whitespace-nowrap border-b border-r border-[#e0e2e6] bg-white px-2 font-bold text-[#202124] active:cursor-grabbing dark:border-border/60 dark:bg-surface dark:text-text-1',
                    overKey === c.key && dragKey && dragKey !== c.key && 'border-l-2 border-l-primary',
                    dragKey === c.key && 'opacity-50',
                  )}
                >
                  {c.label}
                </td>
              ))}
            </tr>
          </thead>
          <EditorBody
            view={view}
            wrap={wrap}
            paint={paint}
            ordered={ordered}
            canEdit={editable}
            editing={editing}
            busy={busyCell}
            onStart={startEdit}
            onCommit={commitEdit}
            onCancel={cancelEdit}
          />
        </table>
      </div>
    </div>
  )
}
