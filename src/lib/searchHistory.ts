// THE SEARCH TRAIL — every search made through the little search terminal, each with the link to go straight back…
// Every pick made through the command palette is remembered — what was typed, where it led, when — per person, on…

export type SearchHit = { q: string; title: string; href: string; at: number }

const CAP = 50
const key = (userId: string) => `asa-search-history:${userId || 'anon'}`

export function recordSearch(userId: string, hit: Omit<SearchHit, 'at'>): void {
  if (!hit.href || !hit.title) return
  try {
    const list = listSearches(userId).filter((h) => h.href !== hit.href || h.q !== hit.q)
    list.unshift({ ...hit, at: Date.now() })
    localStorage.setItem(key(userId), JSON.stringify(list.slice(0, CAP)))
  } catch {
    /* storage blocked — the trail just doesn't grow */
  }
}

export function listSearches(userId: string): SearchHit[] {
  try {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((h) => h && typeof h.href === 'string' && typeof h.title === 'string')
      : []
  } catch {
    return []
  }
}

export function clearSearches(userId: string): void {
  try {
    localStorage.removeItem(key(userId))
  } catch {
    /* nothing to clear */
  }
}
