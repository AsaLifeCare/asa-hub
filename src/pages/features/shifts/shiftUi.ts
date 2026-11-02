// Shift Board — shared kind → token styling (shifts-suite wave).
// Token-only: every class resolves to a design-token var, dark mode flips automatically.
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import type { ExtendedTintName } from '@/lib/tints'
import type { ShiftKind } from '@/lib/seed-shifts2'
import { SHIFT_KIND_LABEL } from '@/lib/seed-shifts2'

export const KIND_TINT: Record<ShiftKind, ExtendedTintName> = {
  day: 'primary',
  afternoon: 'info',
  morning: 'amber',
  evening: 'lavender',
  overnight: 'pink',
  ro: 'danger',
  alias: 'slate',
  off: 'slate', // overridden by kindChipClasses (surface-3, not a tint)
}

/** Chip classes for a shift code pill (cards + calendar cells). */
export function kindChipClasses(kind: ShiftKind): string {
  if (kind === 'off') return 'bg-surface-3 text-text-3'
  return `${TINT_BG[KIND_TINT[kind]]} ${TINT_FG[KIND_TINT[kind]]}`
}

/** Dot color for the legend — inline CSS var so no dynamic Tailwind class. */
export function kindDotStyle(kind: ShiftKind): { backgroundColor: string } {
  return { backgroundColor: kind === 'off' ? 'var(--text-3)' : TINT_VAR[KIND_TINT[kind]] }
}

/** The house grids' own kind tints, beside KIND_TINT (other screens read that one): amber is "not in the workbook", red is "act". */
export const CELL_TINT = {
  day: 'blue',
  morning: 'peach',
  afternoon: 'mint',
  evening: 'lavender',
  overnight: 'pink',
} as const satisfies Partial<Record<ShiftKind, ExtendedTintName>>

/** A house-grid cell's fill and ink, by the relay's kind: OFF has no fill, R/O is grey, another house is outlined. */
export function cellTint(kind: string | null | undefined): string {
  const k = String(kind ?? '')
  if (k in CELL_TINT) return `${TINT_BG[CELL_TINT[k as keyof typeof CELL_TINT]]} text-text-1`
  if (k === 'ro') return 'bg-surface-3 text-text-2'
  if (k === 'alias') return 'bg-surface text-text-2 border border-text-3'
  return 'text-text-3'
}

// an opacity modifier on a CSS-variable colour builds no class, so the soft notes are spelled with tokens The soft…
export const AMBER_NOTE = 'border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-warning'
/** The soft red note: something to look at. */
export const DANGER_NOTE = 'border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-tint-danger'

/** The workbook's own cell colour, kept as a stripe on the cell's left edge; white and transparent are no colour. */
export function workbookStripe(color: string | null | undefined): string | null {
  const c = String(color ?? '').trim().toLowerCase()
  if (!c || ['transparent', 'none', 'white', '#fff', '#ffffff', '#ffffffff'].includes(c)) return null
  return /^#[0-9a-f]{3,8}$/.test(c) || /^rgba?\([\d\s.,%]+\)$/.test(c) ? c : null
}

/** The key under the house grids: the kinds, in the order a day runs. */
export const CELL_LEGEND: { kind: string; label: string }[] = [
  { kind: 'day', label: 'Day' },
  { kind: 'morning', label: 'Morning' },
  { kind: 'afternoon', label: 'Afternoon' },
  { kind: 'evening', label: 'Evening' },
  { kind: 'overnight', label: 'Overnight' },
  { kind: 'ro', label: 'R/O' },
  { kind: 'alias', label: 'Another house' },
  { kind: 'off', label: 'Off' },
]

export const LEGEND_ORDER: ShiftKind[] = [
  'day',
  'afternoon',
  'morning',
  'evening',
  'overnight',
  'ro',
  'alias',
  'off',
]

export { SHIFT_KIND_LABEL }
