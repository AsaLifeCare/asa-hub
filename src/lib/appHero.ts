// THE ONE DECISION EVERY BLACK HEADER SHARES: what a figure says when it was not read.
// The kit keeps a single dark surface (`bg-detail-hero`) and the screens that stand on it all answer the same…
import type { ExtendedTintName } from '@/lib/tints'

/** The state of the app's OWN read — never a global one. */
export type HeroRead =
  | { state: 'loading' }
  | { state: 'failed'; reason?: string }
  | { state: 'ready' }

/** One headline figure, as the app measured it. `null` is "not measured". */
export type HeroFigure = {
  label: string
  value: number | string | null
  /** the line under the figure; replaced by the pending sentence when unread */
  note: string
  tint?: ExtendedTintName
  /** a name rather than a count — drawn smaller, truncated, never in stat type */
  text?: boolean
  // The figure's OWN read, when it comes from a different door than the header's.
  read?: HeroRead
}

export const HERO_DASH = '—'

/** The sentence that replaces a note when the figure was not measured. */
export function heroPending(read: HeroRead): string {
  return read.state === 'failed' ? 'unknown — the read failed' : 'not read yet'
}

/** Numbers read the way the rest of the platform prints them. */
export const heroNumber = (n: number): string => n.toLocaleString()

/** The read a figure answers to: its own when it carries one, else the header's. */
export function heroFigureRead(read: HeroRead, f: HeroFigure): HeroRead {
  return f.read ?? read
}

/** What the figure shows: its own value, or the dash. */
export function heroValue(read: HeroRead, value: HeroFigure['value']): string {
  if (read.state !== 'ready' || value === null) return HERO_DASH
  return typeof value === 'number' ? heroNumber(value) : value || HERO_DASH
}

/** What the line under the figure says. `read` is the header's. */
export function heroNote(read: HeroRead, f: HeroFigure): string {
  const own = heroFigureRead(read, f)
  // an unlanded read says so, whatever the app wrote for the measured case
  if (own.state !== 'ready') {
    return f.read && own.state === 'failed' && own.reason ? `unknown — ${own.reason}` : heroPending(own)
  }
  // a read that landed with nothing readable keeps the app's own sentence
  if (f.value === null) return f.note || heroPending(own)
  return f.note
}

/** Whether anything on the header failed: its own read, or one figure's. */
export function heroAnyFailed(read: HeroRead, figures: HeroFigure[]): boolean {
  return read.state === 'failed' || figures.some((f) => f.read?.state === 'failed')
}

/* ---------- the schema-driven half ---------- */

// A figure a PAGE declares instead of a component: the same shape, computed from the rows that page's own…
export type PageHeroFigure = {
  label: string
  compute: (rows: Record<string, unknown>[]) => number | string | null
  note: (rows: Record<string, unknown>[]) => string
  tint?: ExtendedTintName
  text?: boolean
}

/** `config.hero` on a PageSchema: the black header over a schema-driven page. */
export type PageHeroSpec = {
  /** the small capitals line — the app's name and what the figures cover */
  eyebrow: string
  /** the section's accessible name */
  label: string
  /** while the read is in flight */
  reading: string
  /** when it failed — says the figures are unknown, not zero */
  failed: string
  figures: PageHeroFigure[]
  /** the closing line, drawn only once the rows are in hand */
  sentence?: (rows: Record<string, unknown>[]) => string
}

// The spec's figures against the rows.
export function heroFigures(
  spec: PageHeroSpec,
  rows: Record<string, unknown>[],
  read: HeroRead,
): HeroFigure[] {
  const ready = read.state === 'ready'
  return spec.figures.map((f) => ({
    label: f.label,
    tint: f.tint,
    text: f.text,
    value: ready ? f.compute(rows) : null,
    note: ready ? f.note(rows) : heroPending(read),
  }))
}
