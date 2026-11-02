/** Shared types for the `sheet` template (moved verbatim from SheetTemplate.tsx). */
import type React from 'react'
import type { TintName } from '@/engine/types'

export type Column = {
  key: string
  label: string
  kind: 'text' | 'avatar+text' | 'chip' | 'chips' | 'date' | 'number' | 'progress' | 'image' | 'doc'
  subKey?: string
  width?: number
  sortable?: boolean
  // The column that names the thing (a person, a project, a client).
  primary?: boolean
  /** minimum width in px — the column may grow past it, never below */
  minWidth?: number
  /** long text: wrap to N lines instead of clamping to one (2 is the norm) */
  wrap?: number
  /** hard ceiling in px for wrapped text, so one long cell can't eat the table */
  maxWidth?: number
  tintBy?: Record<string, TintName>
  /** tiny leading icon for text cells (e.g. "map-pin") */
  icon?: string
  /** status chips: leading 6px dot in the tint-foreground color */
  dot?: boolean
  /** chip values rendered as dashed-outline chips (e.g. "missing") */
  dashedBy?: string[]
  /** multi-chip column: max chips before "+N" overflow */
  max?: number
  // multi-chip column: character cap per chip — the full text becomes the tooltip.
  chipMax?: number
  /** tint cycle for 'chips' cells when tintBy has no match */
  tintCycle?: TintName[]
  /** date columns: tint amber when ≤30d out, pink when past */
  expiry?: boolean
  /** date-fns format override (e.g. "MMM yyyy") */
  format?: string
  /** chip display-label overrides (e.g. { escalated: 'MUI' }) — additive (ops-flows) */
  labelBy?: Record<string, string>
  /** chip values rendered as solid tint-foreground pills with white text (e.g. "escalated") — additive (ops-flows) */
  solidBy?: string[]
  // sweep: per-value token styles for chip cells (CSS var refs only, e.g. { borrowed: { bg…
  styleBy?: Record<string, { bg: string; fg: string }>
  /** sweep: tint the entire table cell from the value's styleBy/tintBy color. */
  tintCell?: boolean
  /** doc cells: row field holding a ready file URL (open + copy-link buttons) */
  urlKey?: string
  /** doc cells: row field naming the file in the viewer and the share sheet */
  titleKey?: string
  /** doc cells: row field with the backend id sent to `fetchAction` */
  idKey?: string
  // doc cells: GAS action returning {doc_url} for {signature_request_id: row[idKey]} — fallback when row[urlKey] is…
  fetchAction?: string
  // a column whose CELL is its own door — clicking it dispatches this ops action with the row (RowCells stops the…
  cellAction?: string
}

// Keys that name a human or a record, in the order we trust them.
const NAME_KEYS = [
  'name', 'full_name', 'fullName', 'person', 'person_name', 'candidate', 'candidate_name',
  'employee', 'employee_name', 'staff', 'staff_name', 'client', 'client_name', 'title',
]

// Promote the naming column: mark it `primary` and move it to the front.
export function withPrimaryColumn(columns: Column[]): Column[] {
  if (columns.length === 0 || columns.some((c) => c.primary)) return columns
  const avatarIdx = columns.findIndex((c) => c.kind === 'avatar+text')
  const idx =
    avatarIdx >= 0
      ? avatarIdx
      : columns.findIndex((c) => NAME_KEYS.includes(c.key) && (c.kind === 'text' || c.kind === undefined))
  if (idx < 0) return columns
  const primary = { ...columns[idx], primary: true }
  return [primary, ...columns.slice(0, idx), ...columns.slice(idx + 1)]
}

const PHONE_KEY = /(phone|mobile|fax)(_?number)?$/i

/** A column keyed or iconed as a phone: the table, its export and its share read it formatted. */
export const isPhoneColumn = (c: Pick<Column, 'key' | 'icon'>): boolean => c.icon === 'phone' || PHONE_KEY.test(c.key)

// Column sizing, one rule for every table in the platform.
export function colSizing(c: Column): React.CSSProperties | undefined {
  if (c.primary) return { width: '1%', minWidth: c.minWidth ?? c.width ?? 180, whiteSpace: 'nowrap' }
  // dates are fixed-width by nature — give them the room rather than let the flexible columns take it and wrap the…
  if (c.kind === 'date' && !c.width) return { width: '1%', minWidth: c.minWidth ?? 150, whiteSpace: 'nowrap' }
  const style: React.CSSProperties = {}
  if (c.width) style.width = c.width
  if (c.minWidth) style.minWidth = c.minWidth
  if (c.maxWidth) style.maxWidth = c.maxWidth
  return Object.keys(style).length > 0 ? style : undefined
}

// ---------- universal row ordering (config.ordering: true) ---------- Modes: default (schema/column sort) · az /…
export type OrderingMode = 'default' | 'az' | 'za' | 'random' | 'manual'

/** config.summaryStrip shape — computed stat row under the header (ops-flows, additive). */
export type SummaryStripConfig = {
  title: string
  icon?: string
  tint?: TintName
  items: { label: string; icon: string; tint: TintName; value?: string | number; compute?: (rows: any[]) => string | number }[]
}
