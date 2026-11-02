/** The `published` mark the relay lays on a published cell (server/effective_roster.py), said in words. */
import { ohioDateTime, ohioSameDay, ohioTime } from '@/lib/ohio'

export type PublishedMark = {
  /** the instant the cell was published (UTC ISO) */
  at: string
  /** who published it */
  by: string
  /** the road: publish · decision:<how> · claim:<via> · handoff · master_push */
  via: string
  /** pending · confirmed · undrawn · changed · test_mode */
  state: string
  location?: string
}

/** The road a published cell came by, in the board's words. */
export function publishedRoad(via: string): string {
  const v = String(via || '')
  if (v === 'publish') return 'published on Calendar Builder'
  if (v.startsWith('decision:')) return "given by the house manager's decision"
  if (v.startsWith('claim:')) return 'taken from an open shift'
  if (v === 'handoff') return 'swapped, with both people agreeing'
  if (v === 'master_push') return 'pushed from the master grid'
  if (v === 'test_mode_publish') return 'published now from what test mode held'
  return 'published by the platform'
}

/** The words every screen uses for a test-mode cell. */
export const TEST_MODE_CELL = 'test mode — not written to the workbook'

/** One sentence for a marked cell (Ohio time), or null. */
export function publishedLine(mark?: PublishedMark | null, now: Date = new Date()): string | null {
  if (!mark || !mark.at) return null
  const when = ohioSameDay(mark.at, now) ? ohioTime(mark.at) : ohioDateTime(mark.at)
  if (!when) return null
  const by = mark.by ? ` by ${mark.by}` : ''
  const road = publishedRoad(mark.via)
  if (mark.state === 'changed') {
    return `Changed in the house calendars workbook after it was ${road} at ${when}${by}.`
  }
  if (mark.state === 'test_mode') {
    return `Test mode — not written to the workbook: ${road} at ${when}${by}; shown on the platform only while test mode is on.`
  }
  const said = `${road.charAt(0).toUpperCase()}${road.slice(1)} at ${when}${by}.`
  return mark.state === 'pending'
    ? `${said} Shown everywhere now, before the calendar copy has caught up.`
    : said
}

/** The ring a marked cell wears on the board — the same one everywhere. */
export const PUBLISHED_RING = 'ring-1 ring-inset ring-primary'
