/** Generic card-grid view (same data, driven by column kinds) — moved verbatim from SheetTemplate.tsx. */
import { motion } from 'framer-motion'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { Badge } from '@/components/shared/Badge'
import { staggerContainer, staggerItem } from '@/engine/motion'
import type { TintName } from '@/engine/types'
import { focusFromRow, writePersonDrag, type FocusDragConfig } from '@/lib/focus'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { isPhoneColumn, type Column } from './types'
import { ImageCell } from './Cell'

export function CardGrid({
  rows,
  columns,
  onOpen,
  focusDrag,
}: {
  rows: any[]
  columns: Column[]
  onOpen: (row: any) => void
  /** Card view is the same data as the table, so it drags the same way. */
  focusDrag?: FocusDragConfig
}) {
  /** Native drag wiring by ref — framer-motion swallows React's onDragStart. */
  const dragRef = (row: any) => (el: HTMLButtonElement | null) => {
    if (!el || !focusDrag) return
    el.draggable = true
    el.ondragstart = (e) => {
      if (!e.dataTransfer) return
      e.dataTransfer.setData('text/plain', String(row[focusDrag.nameKey] ?? ''))
      writePersonDrag(e.dataTransfer, focusFromRow(row, focusDrag))
    }
  }
  const face = columns.find((c) => c.kind === 'avatar+text')
  const chips = columns.filter((c) => c.kind === 'chip').slice(0, 2)
  const meta = columns.find((c) => c.kind === 'text' && c.key !== face?.key)
  const metaText = (row: any) => (meta && isPhoneColumn(meta) ? formatPhoneDisplay(row[meta.key]) : row[meta?.key ?? ''])
  // image sheets (e.g. Image Bank): cards lead with the photo, not an avatar
  const imageCol = columns.find((c) => c.kind === 'image')
  if (imageCol) {
    const titleCol = columns.find((c) => c.kind === 'text' && c.key !== imageCol.key) ?? meta
    return (
      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => (
          <motion.button
            key={row.id}
            variants={staggerItem}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.15 }}
            onClick={() => onOpen(row)}
            ref={dragRef(row)}
            className="flex flex-col overflow-hidden rounded-md border border-border bg-surface text-left shadow-1 transition-shadow duration-150 hover:shadow-2"
          >
            <ImageCell
              src={row[imageCol.key]}
              alt={String(row.title ?? row.id)}
              tint={((row.tint as TintName) ?? 'blue') as TintName}
              className="aspect-[4/3] h-auto w-full rounded-none border-0"
            />
            <span className="flex w-full flex-col gap-1 p-3">
              <span className="clamp-1 text-[13px] font-semibold text-text-1">{titleCol ? row[titleCol.key] : row.id}</span>
              {meta && meta !== titleCol && <span className="clamp-1 text-[12px] text-text-3">{metaText(row)}</span>}
              {chips.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <Badge key={c.key} label={String(row[c.key] ?? '—')} tint={c.tintBy?.[String(row[c.key])] ?? 'blue'} />
                  ))}
                </span>
              )}
            </span>
          </motion.button>
        ))}
      </motion.div>
    )
  }
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <motion.button
          key={row.id}
          variants={staggerItem}
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
          onClick={() => onOpen(row)}
          ref={dragRef(row)}
          className="flex flex-col items-center rounded-md border border-border bg-surface p-5 text-center shadow-1 transition-shadow duration-150 hover:shadow-2"
        >
          {/* Same law as the table's avatar+text cell: the card carries the
              person itself, so the face and the name still move when the
              button-level wiring is dark (no focusDrag for this resource).
              `face` is the gate — a card with no avatar column is a thing. */}
          <DragPerson
            name={String(face ? (row[face.key] ?? '') : '')}
            // see Cell.tsx: an id only when the row is known to BE the person
            id={focusDrag ? String(row[focusDrag.idKey] ?? row.id ?? '') : undefined}
            type={focusDrag?.type}
            avatar={face ? row.avatar : undefined}
            subtitle={face?.subKey ? String(row[face.subKey] ?? '') : undefined}
            className="flex w-full flex-col items-center"
          >
            <Avatar src={face ? row.avatar : undefined} name={String(face ? row[face.key] : row.id ?? '?')} size="lg" />
            <div className="clamp-1 mt-3 w-full text-[14px] font-semibold text-text-1">{face ? row[face.key] : row.id}</div>
            {face?.subKey && <div className="clamp-1 mt-0.5 w-full text-[12px] text-text-3">{row[face.subKey]}</div>}
          </DragPerson>
          {meta && <div className="clamp-1 mt-1 w-full text-[12px] text-text-2">{metaText(row)}</div>}
          {chips.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {chips.map((c) => (
                <Badge key={c.key} label={String(row[c.key] ?? '—')} tint={c.tintBy?.[String(row[c.key])] ?? 'blue'} />
              ))}
            </div>
          )}
        </motion.button>
      ))}
    </motion.div>
  )
}
