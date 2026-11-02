// TintName → Tailwind class / CSS var mappings.
// Token-only: dark mode flips automatically because every value is a design-token var.
import type { TintName } from '@/engine/types'

export type ExtendedTintName = TintName | 'primary' | 'danger' | 'warning' | 'info' | 'violet' | 'slate'

export const TINT_BG: Record<ExtendedTintName, string> = {
  mint: 'bg-tint-mint',
  peach: 'bg-tint-peach',
  lavender: 'bg-tint-lavender',
  pink: 'bg-tint-pink',
  blue: 'bg-tint-blue',
  amber: 'bg-tint-amber',
  green: 'bg-tint-mint',
  primary: 'bg-tint-primary',
  danger: 'bg-tint-danger',
  warning: 'bg-tint-warning',
  info: 'bg-tint-info',
  violet: 'bg-tint-violet',
  slate: 'bg-tint-slate',
}

export const TINT_FG: Record<ExtendedTintName, string> = {
  mint: 'text-tint-fg-mint',
  peach: 'text-tint-fg-peach',
  lavender: 'text-tint-fg-lavender',
  pink: 'text-tint-fg-pink',
  blue: 'text-tint-fg-blue',
  amber: 'text-tint-fg-amber',
  green: 'text-tint-fg-mint',
  primary: 'text-tint-fg-primary',
  danger: 'text-tint-fg-danger',
  warning: 'text-tint-fg-warning',
  info: 'text-tint-fg-info',
  violet: 'text-tint-fg-violet',
  slate: 'text-tint-fg-slate',
}

/** CSS var holding the tint-foreground color (chart strokes, dots, bars) */
export const TINT_VAR: Record<ExtendedTintName, string> = {
  mint: 'var(--tint-mint-fg)',
  peach: 'var(--tint-peach-fg)',
  lavender: 'var(--tint-lavender-fg)',
  pink: 'var(--tint-pink-fg)',
  blue: 'var(--tint-blue-fg)',
  amber: 'var(--tint-amber-fg)',
  green: 'var(--tint-mint-fg)',
  primary: 'var(--tint-primary-fg)',
  danger: 'var(--tint-danger-fg)',
  warning: 'var(--tint-warning-fg)',
  info: 'var(--tint-info-fg)',
  violet: 'var(--tint-violet-fg)',
  slate: 'var(--tint-slate-fg)',
}

/** CSS var holding the tint background color */
export const TINT_BG_VAR: Record<ExtendedTintName, string> = {
  mint: 'var(--tint-mint)',
  peach: 'var(--tint-peach)',
  lavender: 'var(--tint-lavender)',
  pink: 'var(--tint-pink)',
  blue: 'var(--tint-blue)',
  amber: 'var(--tint-amber)',
  green: 'var(--tint-mint)',
  primary: 'var(--tint-primary)',
  danger: 'var(--tint-danger)',
  warning: 'var(--tint-warning)',
  info: 'var(--tint-info)',
  violet: 'var(--tint-violet)',
  slate: 'var(--tint-slate)',
}

export const TINT_PAIR = (t: ExtendedTintName) => `${TINT_BG[t]} ${TINT_FG[t]}`

// BAND COLOURS FOR THE ONE DARK SURFACE THE SYSTEM KEEPS.
const HERO_BAND: Record<ExtendedTintName, string> = {
  mint: '#5fd3e6',      // lagoon cyan — the brand accent, lifted for navy
  peach: '#f9b48a',
  lavender: '#b3a6fb',
  pink: '#f79ac4',
  blue: '#74b0f5',
  amber: '#f2d06b',
  green: '#5fd3e6',     // alias of mint, as in TINT_BG / TINT_FG
  primary: '#8ce3f2',
  danger: '#ff9a94',
  warning: '#ffbf5c',
  info: '#8fd0ff',
  violet: '#d69bf5',
  slate: '#aab6c8',     // the neutral band — light enough to still be a colour
}

// The colour for a band or legend dot drawn on the always-navy hero.
export function heroBand(tint: TintName | ExtendedTintName): string {
  // Callers sometimes hand over a string cast from live data (`s.tint as TintName`); an unknown name gets the…
  return HERO_BAND[tint] ?? HERO_BAND.slate
}
