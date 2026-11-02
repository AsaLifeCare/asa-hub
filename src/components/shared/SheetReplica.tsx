// THE SPREADSHEET REPLICA — on the intranet a spreadsheet's layout could be replicated exactly in HTML; call this…
// One component, any rows: column letters, row numbers, gridlines, the gray chrome — the exact grammar of a sheet…
import { memo, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

function colLetter(n: number): string {
  let s = ''
  n += 1
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

type Col = { key: string; label: string }

// The grid body, isolated so dragKey/overKey churn cannot repaint ~9k cells.
const SheetBody = memo(function SheetBody({ rows, ordered }: { rows: Record<string, unknown>[]; ordered: Col[] }) {
  return (
    <tbody>
      {rows.map((r, i) => (
        <tr key={i} className="hover:bg-[#f1f3f4] dark:hover:bg-surface-2">
          <td className="sticky left-0 z-[5] h-[24px] border-b border-r border-[#c7cbd1] bg-[#f8f9fa] px-1 text-center text-[10.5px] font-semibold text-[#5f6368] dark:border-border dark:bg-surface-2 dark:text-text-3">
            {i + 2}
          </td>
          {ordered.map((c) => {
            const v = String(r[c.key] ?? '')
            return (
              <td key={c.key} data-col={c.key} title={v}
                className="h-[24px] max-w-[320px] overflow-hidden truncate whitespace-nowrap border-b border-r border-[#e0e2e6] bg-white px-2 text-[#202124] dark:border-border/60 dark:bg-surface dark:text-text-2">
                {v}
              </td>
            )
          })}
        </tr>
      ))}
      {rows.length === 0 && (
        <tr><td className="sticky left-0 border-r border-[#c7cbd1] bg-[#f8f9fa] text-center text-[10.5px] text-[#5f6368]">2</td>
          <td colSpan={ordered.length} className="h-[24px] border-b border-[#e0e2e6] bg-white px-2 italic text-[#9aa0a6]">(empty)</td></tr>
      )}
    </tbody>
  )
})

export default function SheetReplica({
  columns,
  rows,
  title,
}: {
  /** header labels, in order — the sheet's own first row */
  columns: Col[]
  rows: Record<string, unknown>[]
  title?: string
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

  const ordered = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]))
    const out = order.map((k) => byKey.get(k)).filter((c): c is Col => !!c)
    // a key the order state does not know yet (defensive) still renders, last
    columns.forEach((c) => { if (!order.includes(c.key)) out.push(c) })
    return out
  }, [columns, order])

  const letters = useMemo(() => ordered.map((_, i) => colLetter(i)), [ordered])

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

  return (
    <div className="overflow-hidden rounded-md border border-[#c7cbd1] bg-white dark:border-border dark:bg-surface">
      {title && (
        <div className="border-b border-[#c7cbd1] bg-[#f8f9fa] px-3 py-1.5 text-[11.5px] font-semibold text-[#3c4043] dark:border-border dark:bg-surface-2 dark:text-text-2">
          {title}
        </div>
      )}
      <div ref={scrollRef} className="scroll-thin max-h-[70vh] overflow-auto" onDragOver={onBoxDragOver} onDrop={onBoxDrop}>
        <table className="border-collapse font-['Arial',sans-serif] text-[12px] leading-[18px]">
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
                    // setData is MANDATORY: without it Firefox never starts the drag — the exact "it does not work".
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
          <SheetBody rows={rows} ordered={ordered} />
        </table>
      </div>
    </div>
  )
}
