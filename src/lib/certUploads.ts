// Certificate submissions as certUploadsList (ComplianceDocs.gs) answers them, and the certification tracker as…
// So an 'own' answer says nothing about anybody else — a count of another person's records from it is a figure that…
export type UploadRow = { id: string; person: string; cert: string; name: string; url: string; by: string; at: string }
export type UploadsAnswer = { uploads?: UploadRow[]; scope?: string; self?: string }
export type TrackerAnswer = { rows?: Record<string, unknown>[]; scope?: string; self?: string }
export type UploadsView =
  | { state: 'loading' }
  // unread or refused — a caller the ledger cannot name (a shared name, no roster row) is refused, never answered…
  | { state: 'unreadable'; why: string; scope?: 'all' | 'own'; self?: string }
  | { state: 'ready'; scope: 'all' | 'own'; self: string }

/** Who is looking: the name the session shows, and whether their role files documents for other people. */
export type Viewer = { name: string; filesForOthers: boolean }

/** Letters and digits only — the fold ComplianceDocs.gs matches a person by. */
export const nameFold = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** An answer from before the scope existed carried the whole ledger. */
export function uploadsViewOf(answer: UploadsAnswer | TrackerAnswer): UploadsView {
  return { state: 'ready', scope: answer.scope === 'own' ? 'own' : 'all', self: String(answer.self ?? '') }
}

/** A failed read, with the refusal's sentence, scope and own name when the server sent them (gasAction keeps the envelope). */
export function uploadsRefusalOf(reason: unknown): UploadsView {
  const why = reason instanceof Error ? reason.message : ''
  const env = (reason as { envelope?: { scope?: unknown; self?: unknown } } | null)?.envelope
  const scope = env?.scope
  if (scope !== 'own' && scope !== 'all') return { state: 'unreadable', why }
  const self = typeof env?.self === 'string' ? env.self.trim() : ''
  return self ? { state: 'unreadable', why, scope, self } : { state: 'unreadable', why, scope }
}

/** Whether two spellings are one person — by the server's fold, or by plain spelling for a name it cannot fold. */
function samePerson(a: string, b: string): boolean {
  const key = nameFold(b)
  if (key) return key === nameFold(a)
  const plain = (s: string) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return !!plain(b) && plain(b) === plain(a)
}

/** The drawer's person is the viewer when it is the viewer's shown name or the roster name the server keyed them by. */
function isViewer(person: string, viewer: Viewer, self: string): boolean {
  return samePerson(person, viewer.name) || (!!self && samePerson(person, self))
}

type Countable = { countable: boolean; note: string; key: string }

// Whether one person's records can be counted from what was answered, the sentence when not, and the key the rows…
function countable(view: UploadsView, person: string, viewer: Viewer, what: 'documents' | 'certifications'): Countable {
  const key = nameFold(person)
  const noun = what === 'documents' ? 'submitted documents' : 'certifications'
  // only a role that files for others can file here; everyone else is told only that the records are private
  const filing = what === 'documents' ? ' — only a document filed here now is shown.'
    : ' — the rows below still take a document filed for them.'
  const privateNote = `Another person's ${noun} are private to them` + (viewer.filesForOthers ? filing : '.')
  if (view.state === 'loading') return { countable: false, note: '', key }
  if (view.state === 'unreadable') {
    const own = isViewer(person, viewer, view.self ?? '')
    // another person's records are private to a caller who is not the master, whatever failed
    if (view.scope === 'own' && !own) return { countable: false, note: privateNote, key }
    if (!view.why) return { countable: false, note: `The ${noun} could not be read — try again in a minute.`, key }
    const whose = view.scope === 'own' ? `Your ${noun}` : `The ${noun}`
    return { countable: false, note: `${whose} are not shown — ${view.why}`, key }
  }
  if (view.scope === 'all') return { countable: true, note: '', key }
  if (view.self && isViewer(person, viewer, view.self)) return { countable: true, note: '', key: nameFold(view.self) }
  return { countable: false, note: privateNote, key }
}

/** The submissions ledger, for one person's drawer. */
export function uploadsCountable(view: UploadsView, person: string, viewer: Viewer = { name: '', filesForOthers: false }): Countable {
  return countable(view, person, viewer, 'documents')
}

/** The certification tracker, for one person's drawer. */
export function trackerCountable(view: UploadsView, person: string, viewer: Viewer = { name: '', filesForOthers: false }): Countable {
  return countable(view, person, viewer, 'certifications')
}

// The generic resources the tracker used to be read through, and the view certTrackerList answers for each.
export const TRACKER_VIEWS: Readonly<Record<string, 'matrix' | 'certs'>> = { certMatrix: 'matrix', staffCerts: 'certs' }

/** The rows of a tracker answer — anything else is not a tracker answer, and is said rather than read as empty. */
export function trackerRowsOf(answer: unknown): Record<string, unknown>[] {
  const rows = (answer as TrackerAnswer | null)?.rows
  if (!Array.isArray(rows)) throw new Error('The certification tracker answered without its rows — nothing is listed rather than an empty tracker.')
  return rows
}

/** Said wherever a screen counts or lists every person's certifications and the tracker answered only the caller's own. */
export const TRACKER_OWN_ONLY =
  'Every person’s certifications are the master’s alone to see — this counts everyone, so it shows no figure. ' +
  'Your own are on My asa.'

/** An own tracker answer refused by a screen that counts everyone: a sentence for the reader, never a transport failure. */
export class TrackerOwnOnly extends Error {
  readonly forReader = true as const
  readonly ownOnly = true as const
  /** a refusal, not a sick platform: lib/api raises no badge for it */
  readonly envelopeStatus = 403
  /** the roster name the own answer was keyed by */
  readonly self: string
  constructor(self: string) {
    super(TRACKER_OWN_ONLY)
    this.name = 'TrackerOwnOnly'
    this.self = self
  }
}

export const isTrackerOwnOnly = (err: unknown): err is TrackerOwnOnly =>
  err instanceof Error && (err as { ownOnly?: unknown }).ownOnly === true

// The rows of a tracker answer for a screen that counts or lists every person (api.list of certMatrix and…
export function trackerRowsOfAll(answer: unknown): Record<string, unknown>[] {
  const rows = trackerRowsOf(answer)
  const a = answer as TrackerAnswer
  if (a.scope === 'own') throw new TrackerOwnOnly(String(a.self ?? ''))
  return rows
}
