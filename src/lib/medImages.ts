// Medication photos — the Hub's OWN copies, zero external dependencies.
// the old platform served these from its disk through its own endpoints, and every `med_pictures` URL in the eMAR…
import FILES from './med-images.manifest'

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Relative to the SPA's own base — served from the same deploy dir. */
const path = (file: string): string => `med-images/${file}`

export function medImageFor(name: string): string | null {
  const full = slug(String(name || ''))
  if (!full) return null
  if (FILES[full]) return path(FILES[full])
  // peel trailing words: "metformin-tab-500mg" → "metformin-tab" → "metformin"
  const parts = full.split('-')
  for (let i = parts.length - 1; i >= 1; i--) {
    const key = parts.slice(0, i).join('-')
    if (FILES[key]) return path(FILES[key])
  }
  return null
}
