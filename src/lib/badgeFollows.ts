// ONE BADGE STANDING IN FOR ANOTHER — the whole of "currently equivalent to the director", written down once.
// TEAM LEAD is NOT in it (the operator's rule, 2026-10-29): a badge of its own, matched only by the rows that name it.

/** badge worn → the badge it is currently answered as, too. */
export const BADGE_FOLLOWS: Readonly<Record<string, string>> = Object.freeze({
  SUPERVISOR: 'DIRECTOR',
  // ranks under the master and over the director; its own grants are rows that name it
  PLATFORMLEAD: 'DIRECTOR',
})

// What this person is MATCHED as: everything they wear, plus whatever each of those words currently stands in for.
export function withFollowedBadges(worn: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (word: string) => {
    const w = String(word ?? '').trim().toUpperCase()
    if (!w || seen.has(w)) return
    seen.add(w)
    out.push(w)
  }
  for (const word of worn) add(word)
  // a second pass, so a followed badge is added after everything genuinely worn — the display order of `types` is…
  for (const word of worn) {
    const stands = BADGE_FOLLOWS[String(word ?? '').trim().toUpperCase()]
    if (stands) add(stands)
  }
  return out
}
