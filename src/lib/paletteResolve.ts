// WHEN THE LITERAL SEARCH FINDS NOTHING — the palette asks.
// The rule is to use the AI IF NECESSARY.
import { gasAction } from '@/features/hiring/shared'

export type ResolveChoice = { id: string; label: string; note?: string }

const KEY = 'asa-palette-ai-v1'
/** Phrases already asked about in this tab → the ids that came back. */
type Memo = Record<string, string[]>

function memo(): Memo {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Memo
  } catch {
    return {}
  }
}

function remember(phrase: string, ids: string[]): void {
  try {
    const all = memo()
    all[phrase] = ids
    sessionStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* a full or blocked sessionStorage costs one extra execution, nothing more */
  }
}

// Ids from `choices` that answer `phrase`, or an empty list.
export async function resolveByMeaning(phrase: string, choices: ResolveChoice[]): Promise<string[]> {
  const q = phrase.trim().toLowerCase()
  if (q.length < 3 || !choices.length) return []
  const seen = memo()
  if (seen[q]) return seen[q]
  try {
    const r = await gasAction<{ matches?: string[] }>('paletteResolve', {
      q: phrase.trim(),
      choices: choices.slice(0, 60),
    })
    const offered = new Set(choices.map((c) => c.id))
    const ids = (r.matches ?? []).filter((id) => offered.has(id))
    remember(q, ids)
    return ids
  } catch {
    // Not remembered: a failed call is not an answer, and the next attempt should be allowed to succeed.
    return []
  }
}
