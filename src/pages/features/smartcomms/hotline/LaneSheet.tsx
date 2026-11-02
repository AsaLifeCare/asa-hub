// A LANE AS A SPREADSHEET — the old desk's grid view, kept.
// The rows are the same rows the list shows, filtered the same way; the grid is for reading a lane whole, the list…
import SheetEditor from '@/components/shared/SheetEditor'
import { TINT_BG_VAR, TINT_VAR, type ExtendedTintName } from '@/lib/tints'
import type { RecordItem } from './items'
import { cell } from './join'
import { MODALITY, callOffTypeTint, queueStatusTint, urgencyTint, type LaneId } from './vocabulary'

function tintFor(lane: LaneId, col: string, value: string): ExtendedTintName | null {
  if (!value) return null
  if (lane === 'queue' && col === 'urgency') return urgencyTint(value)
  if (lane === 'queue' && col === 'status') return queueStatusTint(value)
  if (lane === 'calloffs' && col === 'type') return callOffTypeTint(value)
  return null
}

/** The sheet's own shape: every key the rows carry, in first-seen order. */
function columnsOf(rows: Record<string, unknown>[]): { key: string; label: string }[] {
  const seen: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k)
  return seen.map((k) => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }))
}

export default function LaneSheet({ lane, items }: { lane: LaneId; items: RecordItem[] }) {
  const rows = items.map((i) => i.rec.row)
  const cols = columnsOf(rows)
  // Row 0 of a paint grid is the sheet's header row — SheetEditor reads the grid the way the spreadsheet holds it…
  const paint = (pick: (t: ExtendedTintName) => string) => [
    cols.map(() => ''),
    ...rows.map((r) => cols.map((c) => {
      const t = tintFor(lane, c.key, cell(r, c.key))
      return t && t !== 'slate' ? pick(t) : ''
    })),
  ]
  return (
    <SheetEditor
      toolbar
      title={`${MODALITY[lane].label} — spreadsheet view`}
      columns={cols}
      rows={rows}
      colors={{ back: paint((t) => TINT_BG_VAR[t]), fore: paint((t) => TINT_VAR[t]) }}
    />
  )
}
