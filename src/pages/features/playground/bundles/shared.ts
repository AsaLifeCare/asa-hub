// CURATED BUNDLES — shared bits for the gallery's ready-made apps.
// Every curated bundle is a typed `PlaygroundBundle` (validation.ts), the same shape an exported `asa-app-*.json`…
import { addDays, format } from 'date-fns'
import type { PlaygroundBundle } from '../validation'

/** One gallery entry: a bundle plus the little extra the card shows. */
export type CuratedBundle = {
  /** Gallery id — never the app id; publish mints a `custom-<slug>` of its own. */
  id: string
  /** One extra sentence for the gallery card, under the tagline. */
  blurb: string
  bundle: PlaygroundBundle
}

/** yyyy-MM-dd, offset days from today — sample dates stay fresh (starters.ts pattern). */
export const isoDay = (offset: number) => format(addDays(new Date(), offset), 'yyyy-MM-dd')
/** Full ISO timestamp, offset days from today — documents/videos publish stamps. */
export const isoNow = (offset: number) => addDays(new Date(), offset).toISOString()
