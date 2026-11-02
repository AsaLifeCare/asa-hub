// RELEASE USERS — the headline figures of the master's own door.
// Computed here, away from the screen, so a fixture can hold them without drawing anything.
import type { ExtendedTintName } from '@/lib/tints'

/** One account as the directory answers it. */
export type ReleaseDirectoryRow = {
  id: string
  email: string
  display_name: string
  role: string
  active: boolean
  armed?: boolean
  last_login?: string
}

// What the directory read is doing right now.
export type DirectoryRead =
  | { state: 'loading' }
  | { state: 'cached' }
  | { state: 'ready' }
  | { state: 'stale'; why: string }
  | { state: 'failed'; why: string }

// THE PICKER'S READ, IN THE HEADER'S WORDS.
export function directoryReadOf(state: 'reading' | 'ready' | 'failed', count: number, why: string): DirectoryRead {
  if (state === 'ready') return { state: 'ready' }
  const said = String(why || '').trim() || 'the directory gave no answer'
  if (state === 'failed') return count > 0 ? { state: 'stale', why: said } : { state: 'failed', why: said }
  return count > 0 ? { state: 'cached' } : { state: 'loading' }
}

export type ReleaseFigure = { value: number | null; sub: string }

/** One slice of the band — a partition of the directory, one account per slice. */
export type ReleaseBand = { key: 'live' | 'never' | 'unarmed' | 'inactive'; label: string; tint: ExtendedTintName; n: number }

export type ReleaseFigures = {
  directory: ReleaseFigure
  never: ReleaseFigure
  unarmed: ReleaseFigure
  announceable: ReleaseFigure
  band: ReleaseBand[]
  /** the line under the figures — where this directory comes from, and what failed */
  note: string
}

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many)

/** The band is a partition: inactive first, then unarmed, then never signed in, then the rest. */
export function releaseBand(rows: ReleaseDirectoryRow[]): ReleaseBand[] {
  let inactive = 0, unarmed = 0, never = 0, live = 0
  for (const u of rows) {
    if (!u.active) inactive++
    else if (!u.armed) unarmed++
    else if (!String(u.last_login ?? '').trim()) never++
    else live++
  }
  return [
    { key: 'live', label: 'Signed in before', tint: 'mint', n: live },
    { key: 'never', label: 'Never signed in', tint: 'lavender', n: never },
    { key: 'unarmed', label: 'No password yet', tint: 'amber', n: unarmed },
    { key: 'inactive', label: 'Inactive', tint: 'slate', n: inactive },
  ].filter((b) => b.n > 0) as ReleaseBand[]
}

export function releaseFigures(input: {
  users: ReleaseDirectoryRow[]
  read: DirectoryRead
  /** enabled apps on the registry — the announcement's own picker */
  announceable: number
  /** true when the master is standing somewhere other than headquarters */
  awayFromHome: boolean
}): ReleaseFigures {
  const { read, users } = input
  // a roster on screen counts, whether freshly read or as last read
  const have = read.state === 'ready' || read.state === 'cached' || read.state === 'stale'
  const unread = read.state === 'failed'
    ? `The directory could not be read — ${read.why}`
    : 'Reading the directory…'
  // A LAST READ SAYS IT IS ONE.
  const asOf = read.state === 'cached'
    ? ' · as last read — refreshing'
    : read.state === 'stale'
      ? ' · as last read — the refresh failed'
      : ''

  const withMail = users.filter((u) => u.email.includes('@')).length
  const never = users.filter((u) => u.active && u.armed && !String(u.last_login ?? '').trim()).length
  const unarmed = users.filter((u) => u.active && !u.armed).length

  const directory: ReleaseFigure = have
    ? {
      value: users.length,
      sub: (users.length
        ? `${withMail} with a mailbox to write to`
        : 'The directory answered nobody for this place') + asOf,
    }
    : { value: null, sub: unread }

  const neverFigure: ReleaseFigure = have
    ? { value: never, sub: (never ? 'Their next sign-in is still a first one' : 'Everybody armed has signed in at least once') + asOf }
    : { value: null, sub: unread }

  const unarmedFigure: ReleaseFigure = have
    ? {
      value: unarmed,
      sub: (unarmed
        ? `${plural(unarmed, 'account waits', 'accounts wait')} to be armed and invited`
        : 'Every active account is armed') + asOf,
    }
    : { value: null, sub: unread }

  // ENABLED, NOT ANNOUNCEABLE.
  const announceable: ReleaseFigure = {
    value: input.announceable,
    sub: input.announceable
      ? `${plural(input.announceable, 'app')} enabled on this workspace — one with no badges on the access matrix announces nothing`
      : 'No app is enabled on this workspace',
  }

  const note = read.state === 'failed'
    ? 'The directory could not be read, so the figures above are unknown — not zero'
    : read.state === 'stale'
      ? `The directory could not be read again (${read.why}) — the figures above are the last read`
      : input.awayFromHome
        ? 'The directory belongs to the place you are standing in — here it answers only its own people'
        : 'The directory of this place, and the apps enabled on this workspace'

  return {
    directory,
    never: neverFigure,
    unarmed: unarmedFigure,
    announceable,
    band: have ? releaseBand(users) : [],
    note,
  }
}
