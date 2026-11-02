// Page through a long list, 20 at a time.
// The queues that need this are the ones that grew past what a person can work in a sitting — 237 open anomalies…
import { useCallback, useMemo, useReducer, useState, type Dispatch, type SetStateAction } from 'react'
import { onForgetAllKept } from './kept'

export const PAGE_SIZE = 20

/** How many pages `total` rows fill — never fewer than one, so an empty list is page 1 of 1. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size))
}

// ------------------------------------------------------------------ the kept page…

// A PAGE THAT OUTLIVES ITS SECTION, for a list drawn inside something that unmounts it while the reader looks…
export type PagerKeep<T> = {
  key: string
  idOf?: (item: T) => string
}

export type KeptPage = {
  /** the page last chosen, 0-based — what a list without ids resumes on */
  page: number
  /** the id of the first item on that page; '' on page 0, which follows the head */
  anchor: string
  /** the resetKey the page was chosen under — any other one starts at 0 */
  seen: unknown
}

export const MAX_KEPT_PAGES = 100

const keptPages = new Map<string, KeptPage>()

export function readKeptPage(key: string): KeptPage | undefined {
  return keptPages.get(key)
}

/** Keep `kept` under `key`, as the most recently used; the oldest go past the limit. */
export function keepPage(key: string, kept: KeptPage): void {
  keptPages.delete(key)
  keptPages.set(key, kept)
  while (keptPages.size > MAX_KEPT_PAGES) {
    const oldest = keptPages.keys().next().value
    if (oldest === undefined) break
    keptPages.delete(oldest)
  }
}

export function forgetKeptPage(key: string): void {
  keptPages.delete(key)
}

export function forgetKeptPages(): void {
  keptPages.clear()
}

onForgetAllKept(forgetKeptPages)

/** The id a page is kept by: its first item's, and none for page 0 (the head). */
export function anchorOf<T>(items: readonly T[], page: number, size: number, idOf?: (item: T) => string): string {
  if (!idOf || page <= 0) return ''
  const first = items[page * size]
  return first === undefined ? '' : idOf(first)
}

// THE PAGE A KEPT LIST RESUMES ON, before clamping to the pages it has now.
export function resumePage<T>(
  kept: KeptPage | undefined,
  resetKey: unknown,
  items: readonly T[],
  size: number,
  idOf?: (item: T) => string,
): number {
  if (!kept || kept.seen !== resetKey) return 0
  if (kept.anchor && idOf) {
    const at = items.findIndex((it) => idOf(it) === kept.anchor)
    if (at >= 0) return Math.floor(at / size)
  }
  return kept.page
}

// ------------------------------------------------------------------ the hook…

export function usePager<T>(items: T[], size: number = PAGE_SIZE, resetKey?: unknown, keep?: PagerKeep<T>) {
  const [page, setPage] = useState(0)
  const [seen, setSeen] = useState<unknown>(resetKey)
  const keepKey = keep?.key ?? ''
  const idOf = keep?.idOf
  const [seenKeep, setSeenKeep] = useState(keepKey)
  const [, redraw] = useReducer((n: number) => n + 1, 0)

  const pages = pageCount(items.length, size)

  // Adjusting state DURING render, which is React's own answer to "derive from props": staying on page 6 of a list…
  if (resetKey !== seen) {
    setSeen(resetKey)
    if (page !== 0) setPage(0)
    // A kept page goes the same way — unless the key moved with it: that is another record's list, and the page…
    if (keepKey && keepKey === seenKeep) forgetKeptPage(keepKey)
  }
  if (keepKey !== seenKeep) setSeenKeep(keepKey)

  const wanted = keepKey ? resumePage(readKeptPage(keepKey), resetKey, items, size, idOf) : page
  const safe = Math.min(wanted, pages - 1)
  const slice = useMemo(() => items.slice(safe * size, safe * size + size), [items, safe, size])

  // A functional update counts from the page the STORE holds now, not from the page this render drew: two `p => p +…
  const setKept = useCallback<Dispatch<SetStateAction<number>>>((next) => {
    if (!keepKey) return
    const now = Math.min(resumePage(readKeptPage(keepKey), resetKey, items, size, idOf), pageCount(items.length, size) - 1)
    const p = typeof next === 'function' ? next(now) : next
    keepPage(keepKey, { page: p, anchor: anchorOf(items, p, size, idOf), seen: resetKey })
    redraw()
  }, [keepKey, items, size, idOf, resetKey, redraw])

  return {
    slice,
    page: safe,
    pages,
    // an unkept pager hands out React's own setter, exactly as it always has
    setPage: keepKey ? setKept : setPage,
    from: items.length ? safe * size + 1 : 0,
    to: Math.min((safe + 1) * size, items.length),
    total: items.length,
  }
}
