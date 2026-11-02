// BUILDER UTILITIES — the non-component half of the visual builders: the studio's input class constants and the…
// Kept component-free so HMR fast refresh stays valid on the component modules.

export const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
export const textareaCls =
  'w-full resize-y rounded-sm border bg-surface px-3 py-2 font-mono text-[12px] leading-5 text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

/* ---------------- typed reads over the loose config object ---------------- */

export const asObj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
export const asArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
export const asStr = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
export const asNum = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && isFinite(v) ? v : fallback
export const asBool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback)

/** Every builder receives the parsed config and hands back the next object. */
export type BuilderProps = {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

/** Which half of an editor is showing: the visual builder or raw JSON. */
export type EditorMode = 'visual' | 'json'

/** Move helper shared by every reorderable list editor. */
export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[index], next[j]] = [next[j], next[index]]
  return next
}
