// WHO A SITUATION'S `to` AND `cc` CELLS REACH — ASKED OF THE PLATFORM, NOT OF A RULE KEPT ON THIS SCREEN.
// The Desk had its own idea of what an address is: anything with an `@` or a digit in it, and every other word…
import { AlertTriangle, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TINT_BG, TINT_FG } from '@/lib/tints'

// WHAT THE PLATFORM SAYS ONE KEYWORD RESOLVES TO.
export type KeywordAudience = {
  /** Who it resolves to, in words — shown beside the switch. */
  label?: string
  /** How many that is right now. Only a reading, never a guess. */
  count?: number | null
  /** Whether the count above is a reading at all. */
  readable?: boolean
  // THE BACKEND DECLINED TO COUNT THIS ONE, AND SAID SO RATHER THAN ANSWERING ZERO.
  pending?: boolean
  /** The minute the count was taken — it is held for a few minutes upstream. */
  at?: string
  /** Why it is that count, or why there is none. */
  why?: string
  /** What the resolution cannot know — printed, because it decides who is asked. */
  missing?: string
  /** Which lane resolves it, when the backend says so. */
  where?: string
}

// WHAT THIS DESK KNOWS ABOUT THE KEYWORDS, AND HOW FRESH EACH HALF IS.
export type KeywordBook = { keys: string[]; now: Record<string, KeywordAudience> }

/** A cell holding a list: comma, semicolon, pipe or newline — the lane's own split. */
export const cellEntries = (raw?: string): string[] =>
  String(raw ?? '')
    .split(/[,;|\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)

// AN ADDRESS SOMEBODY WROTE OUT — THE DOOR'S OWN QUESTION, CHARACTER FOR CHARACTER (`smartAddressable_`…
export const isWrittenAddress = (entry: string): boolean => {
  const v = String(entry ?? '').trim()
  if (v.indexOf('@') !== -1 && /@[^@\s]+\.[a-z]{2,}$/i.test(v)) return true
  return v.replace(/\D/g, '').length >= 10
}

/** The keyword an entry is, folded exactly as the backend folds it (`smartToKeyword_`). */
export const foldKeyword = (entry: string): string =>
  String(entry ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')

export type CellReading = {
  /** Keywords the platform resolves, folded — in the cell that resolves them. */
  keywords: string[]
  /** Words nothing resolves. */
  strays: string[]
  /** Keywords the platform resolves, in a cell that does not resolve them. */
  misplaced: string[]
  /** Words this desk has not been told about, because the registry was not read. */
  unverified: string[]
  /** Everything in this cell that reaches nobody — strays first, then misplaced. */
  dead: string[]
  // THE DOOR'S OWN QUESTION, WHICH IS ABOUT THE CELL AND NOT ABOUT EACH ENTRY.
  reachesNobody: boolean
}

// READ ONE CELL.
export function readAddressCell(
  raw: string | undefined, book: KeywordBook | null, cell: 'to' | 'cc',
): CellReading {
  const out: CellReading = {
    keywords: [], strays: [], misplaced: [], unverified: [], dead: [], reachesNobody: false,
  }
  const entries = cellEntries(raw)
  let live = 0
  entries.forEach((entry) => {
    if (isWrittenAddress(entry)) { live++; return }
    if (!book) { out.unverified.push(entry); live++; return }
    const key = foldKeyword(entry)
    const known = !!key && book.keys.indexOf(key) !== -1
    if (!known) { out.strays.push(entry); return }
    if (cell === 'to') { out.keywords.push(key); live++ }
    else out.misplaced.push(entry)
  })
  out.dead = out.strays.concat(out.misplaced)
  // A WORD THIS DESK COULD NOT CHECK COUNTS AS LIVE, exactly as it does everywhere else here: unverified is not…
  out.reachesNobody = entries.length > 0 && live === 0
  return out
}

/** Both cells of a row at once — what the card and the save guard both ask. */
export function readRowAddresses(to: string | undefined, cc: string | undefined, book: KeywordBook | null) {
  const t = readAddressCell(to, book, 'to')
  const c = readAddressCell(cc, book, 'cc')
  return {
    to: t,
    cc: c,
    keywords: t.keywords,
    dead: t.dead.concat(c.dead),
    unverified: t.unverified.concat(c.unverified),
    misplaced: t.misplaced.concat(c.misplaced),
    // THE CELLS A SAVE MAY NOT WRITE, named so the refusal can say which one.
    blocked: [t.reachesNobody ? 'Goes to' : '', c.reachesNobody ? 'Also copied' : ''].filter(Boolean),
  }
}

// AND WHETHER THE ROW'S ALERT REACHES THE TEAM WHATEVER THIS CELL SAYS.
export type FloorReach = 'pages' | 'own' | 'unasked'
/** The rows the platform declares reach the alert floor, by id. */
export type FloorBook = { ids: string[] } | null
// Who that floor is today — `smartCommsGet` → `team` (smartTeamRecipients_).
export type TeamFloor = {
  sms?: string[]; emails?: string[]; readable?: boolean
  floor_sms?: string[]; amber_sms?: string[]
} | null

export function readFloor(id: string | undefined, floors: FloorBook): FloorReach {
  if (!floors) return 'unasked'
  return floors.ids.indexOf(String(id ?? '')) !== -1 ? 'pages' : 'own'
}

// Who the alert list is, in words — counted, never named, and an absence never wears a number.
export function floorWho(team: TeamFloor): string {
  if (!team || team.readable === false) return 'the alert recipients in Settings'
  const sms = Array.isArray(team.sms) ? team.sms.length : 0
  const mail = Array.isArray(team.emails) ? team.emails.length : 0
  if (!sms && !mail) return 'the alert recipients in Settings'
  const parts = [sms ? `${sms} number${sms === 1 ? '' : 's'}` : '',
    mail ? `${mail} e-mail${mail === 1 ? '' : 's'}` : ''].filter(Boolean)
  return `the alert recipients in Settings (${parts.join(' and ')})`
}

// AND THE CELL ONLY WIDENS ONE CHANNEL, BECAUSE ONLY ONE IS WIDENED.
export type FloorSeen = 'yes' | 'no' | 'unread'

const seenClause = (seen: FloorSeen): string =>
  seen === 'yes'
    ? 'And this row has been seen to take it: the delivery trail this desk read carries tellings for it.'
    : seen === 'no'
      ? 'THAT IS THE PATH, NOT A RECORD OF THIS ROW TAKING IT: nothing for this row is on the ' +
        'delivery trail this desk read, and a rehearsal never reaches that trail at all — so ' +
        'whether it has ever actually told anybody is not something this screen can say.'
      : 'Whether this row has ever actually taken that path was not read this visit.'

const floorSentence = (team: TeamFloor, seen: FloorSeen = 'unread'): string =>
  `When this row's alert goes out it goes to ${floorWho(team)}, whatever stands in “Goes to”. ` +
  'A phone number written there is ADDED to the text — it never replaces it and never silences it. ' +
  'Nothing else is: this alert carries the cell on as extra NUMBERS only, so an e-mail address ' +
  'here is not copied to anybody, and neither a keyword nor any other word adds a soul. ' +
  'To stop this row reaching anybody, switch it off or leave it without words. ' +
  seenClause(seen)

// THAT SENTENCE, ON THE CARD AND IN THE DRAWER — the two places a decision about this row is made.
export function FloorLine(
  { floor, team, seen = 'unread' }: { floor: FloorReach; team: TeamFloor; seen?: FloorSeen },
) {
  if (floor !== 'pages') return null
  return (
    <p className="mt-2 text-[11.5px] leading-[17px] text-text-3">
      <span className="font-semibold text-text-2">The alert goes to the team either way.</span>{' '}
      {floorSentence(team, seen)}
    </p>
  )
}

export function FloorNote(
  { floor, team, seen = 'unread' }: { floor: FloorReach; team: TeamFloor; seen?: FloorSeen },
) {
  if (floor !== 'pages') return null
  return (
    <div className={cn('mt-1.5 rounded-md border border-border px-3 py-2', TINT_BG.amber)}>
      <p className={cn('text-[11.5px] leading-[17px] font-semibold', TINT_FG.amber)}>
        This cell adds phone numbers — it is not the audience.
      </p>
      <p className="mt-1 text-[11px] leading-4 text-text-2">{floorSentence(team, seen)}</p>
    </div>
  )
}

export type AudienceState =
  /** The door answered and the count is a reading — even when it is zero. */
  | 'counted'
  /** Resolved, deliberately not counted: no saved row names it yet. */
  | 'pending'
  /** The keyword is resolved, the count is not a reading. `why` says which. */
  | 'unread'
  /** Known from this browser's last reading; today's count was not asked for. */
  | 'stale'
  /** No registry at all. */
  | 'unasked'

export type AudienceReading = {
  key: string; state: AudienceState; label: string; count: number
  why: string; missing: string; where: string
  /** When the count was taken, in words — it is held upstream for a few minutes. */
  at: string
}

/** The minute a reading was taken, in the reader's own clock. */
const clock = (iso: string): string => {
  const t = Date.parse(String(iso || ''))
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// WHAT ONE KEYWORD RESOLVES TO, AND WHETHER THAT IS A MEASUREMENT.
export function readAudience(key: string, book: KeywordBook | null): AudienceReading {
  const out: AudienceReading = {
    key, state: 'unasked', label: '', count: 0, why: '', missing: '', where: '', at: '',
  }
  if (!book) return out
  const a = book.now[key]
  if (!a) { out.state = 'stale'; return out }
  out.label = String(a.label ?? '')
  out.why = String(a.why ?? '')
  out.missing = String(a.missing ?? '')
  out.where = String(a.where ?? '')
  out.at = clock(String(a.at ?? ''))
  // NOT COUNTED ON PURPOSE IS NOT A FAILED COUNT.
  if (a.pending === true) { out.state = 'pending'; return out }
  const n = typeof a.count === 'number' && Number.isFinite(a.count) ? a.count : null
  if (a.readable === true && n !== null) { out.state = 'counted'; out.count = n } else out.state = 'unread'
  return out
}

const CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4'
const CHIP_PLAIN = 'inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold leading-4 text-text-3'

/** How many phones, in the words the chip and the drawer both use. */
const phrase = (a: AudienceReading): string => {
  if (a.state === 'counted') return a.count === 1 ? '1 phone' : `${a.count} phones`
  if (a.state === 'stale' || a.state === 'pending') return 'not counted yet'
  return 'no count'
}

// WHY THERE IS NO NUMBER, IN ONE SENTENCE, WHEREVER THE NUMBER WOULD HAVE BEEN.
const absence = (a: AudienceReading): string => {
  if (a.state === 'stale') {
    return 'How many people that is was not read this visit — these rows come from the last reading. ' +
      'Read the situations again to have it counted.'
  }
  if (a.state === 'pending') {
    return (a.why ? a.why + '. ' : '') +
      'It is counted for the rows that already name it, so save this one and the next reading carries the number.'
  }
  return a.why || 'The platform did not hand back a count for it.'
}

// AND WHETHER THE PEOPLE IT NAMES EXIST.
export function AddressChip(
  { to, cc, book, floor = 'unasked', team = null, seen = 'unread' }:
  { to?: string; cc?: string; book: KeywordBook | null
    floor?: FloorReach; team?: TeamFloor; seen?: FloorSeen },
) {
  const r = readRowAddresses(to, cc, book)
  if (r.dead.length) {
    const why = r.misplaced.length
      ? ` ${r.misplaced.map((w) => `“${w}”`).join(', ')} is a keyword this platform resolves, but only in “Goes to”: the copy list is split into e-mails and numbers, so a keyword there reaches nobody.`
      : ''
    // THE SAME DEAD WORD, TWO DIFFERENT FACTS ABOUT THE ROW.
    if (floor === 'pages') {
      return (
        <span
          title={`${r.dead.join(', ')} — nothing this platform resolves, so ${r.dead.length === 1 ? 'it adds' : 'they add'} nobody. ${floorSentence(team, seen)}${why}`}
          className={cn(CHIP, TINT_BG.peach, TINT_FG.peach)}
        >
          <AlertTriangle size={10} className="shrink-0" />
          {r.dead.length === 1 ? `“${r.dead[0]}” adds nobody` : `${r.dead.length} entries add nobody`}
        </span>
      )
    }
    return (
      <span
        title={`${r.dead.join(', ')} — nothing this platform resolves. “Goes to” carries addresses written out — an e-mail with its own domain, or a number with all ten of its digits — or a keyword the platform resolves and can count; a word that is neither reaches nobody at all. This is the same test the save door applies, so what this mark refuses is exactly what the platform refuses. Nothing fills this in on its own, and nothing should: a row whose own lane resolves nobody else stays silent until somebody opens Edit, reads the words it would send, and types the addresses here.${why}`}
        className={cn(CHIP, TINT_BG.peach, TINT_FG.peach)}
      >
        <AlertTriangle size={10} className="shrink-0" />
        {r.dead.length === 1 ? `“${r.dead[0]}” addresses nobody` : `${r.dead.length} entries address nobody`}
      </span>
    )
  }
  // NOT READ IS NOT DEAD.
  if (r.unverified.length) {
    return (
      <span
        title={`${r.unverified.join(', ')} — this desk has not been told which keywords the platform resolves, because the situations read did not come back. The word may well be one of them; the platform refuses a word it cannot resolve when this row is saved.`}
        className={CHIP_PLAIN}
      >
        {r.unverified.length === 1 ? `“${r.unverified[0]}” unchecked` : `${r.unverified.length} entries unchecked`}
      </span>
    )
  }
  return null
}

// AND A KEYWORD IN A FLOOR ROW'S CELL RESOLVES TO NOBODY, WHATEVER IT COUNTS.
const KEYWORD_ON_A_FLOOR_ROW =
  'This row does not resolve keywords: its alert goes out through the team list, which takes ' +
  'this cell as extra NUMBERS only — a keyword is not digits, so it adds nobody here. Who hears ' +
  'this row is the alert list named above.'

// HOW MANY PHONES THIS ROW IS, BESIDE ITS OWN SWITCH.
export function AudienceChip(
  { to, book, floor = 'unasked' }:
  { to?: string; book: KeywordBook | null; floor?: FloorReach },
) {
  const keys = readAddressCell(to, book, 'to').keywords
  if (!keys.length) return null
  return (
    <>
      {keys.map((k) => {
        const a = readAudience(k, book)
        const empty = a.state === 'counted' && a.count === 0
        const adds = floor === 'pages'
        const title = [
          a.label ? `${a.key} — ${a.label}.` : `${a.key} — resolved by this platform.`,
          adds ? KEYWORD_ON_A_FLOOR_ROW : '',
          // THE COUNT CARRIES THE MINUTE IT WAS TAKEN.
          adds ? '' : (a.state === 'counted'
            ? `${a.why ? a.why + ' ' : ''}Counted${a.at ? ` at ${a.at}` : ''} — and resolved again when the message actually goes.`
            : absence(a)),
          adds ? '' : (a.missing ? `What it cannot know: ${a.missing}` : ''),
          adds ? '' : (a.where ? `Resolved by: ${a.where}` : ''),
        ].filter(Boolean).join(' ')
        return (
          <span
            key={k}
            title={title}
            className={empty || adds
              ? cn(CHIP, TINT_BG.peach, TINT_FG.peach)
              : a.state === 'counted' ? cn(CHIP, TINT_BG.amber, TINT_FG.amber) : CHIP_PLAIN}
          >
            <Users size={10} className="shrink-0" />
            {adds ? `${a.key} · adds nobody here`
              : empty ? `${a.key} · nobody right now` : `${a.key} · ${phrase(a)}`}
          </span>
        )
      })}
    </>
  )
}

// AND WHO THEY ARE, IN WORDS, WITHOUT HOVERING.
export function AudienceLine(
  { to, book, floor = 'unasked' }:
  { to?: string; book: KeywordBook | null; floor?: FloorReach },
) {
  const keys = readAddressCell(to, book, 'to').keywords
  if (!keys.length) return null
  return (
    <>
      {keys.map((k) => {
        const a = readAudience(k, book)
        return (
          <p key={k} className="mt-2 text-[11.5px] leading-[17px] text-text-3">
            <span className="font-semibold text-text-2">{a.key}</span>
            {a.label ? ` — ${a.label}` : ' — a keyword this platform resolves'}
            {floor === 'pages'
              ? <>. {KEYWORD_ON_A_FLOOR_ROW}</>
              : a.state === 'counted'
                ? <>: <span className="font-semibold text-text-2">{phrase(a)}</span>{a.at ? ` when it was counted, at ${a.at}` : ''},
                  and resolved again when it sends.</>
                : <>. {absence(a)}</>}
            {a.missing && floor !== 'pages'
              ? <span className="block">What it cannot know: {a.missing}</span> : null}
          </p>
        )
      })}
    </>
  )
}

// THE SAME AUDIENCE, IN THE DRAWER, WHERE THE WORDS ARE WRITTEN.
export function AudienceNote(
  { to, book, floor = 'unasked' }:
  { to?: string; book: KeywordBook | null; floor?: FloorReach },
) {
  const keys = readAddressCell(to, book, 'to').keywords
  if (!keys.length) return null
  const adds = floor === 'pages'
  return (
    <>
      {keys.map((k) => {
        const a = readAudience(k, book)
        return (
          <div key={k} className="mt-1.5 rounded-md border border-border bg-surface-2 px-3 py-2">
            <p className="text-[11.5px] leading-[17px] text-text-2">
              <span className="font-semibold">{a.key}</span> is resolved by this platform
              {a.label ? <> — {a.label}</> : null}
              {!adds && a.state === 'counted'
                ? <>, and it was <span className="font-semibold">{phrase(a)}</span>{a.at ? <> at {a.at}</> : null}.</>
                : '.'}
            </p>
            {adds && (
              <p className={cn('mt-1 text-[11px] leading-4 font-semibold', TINT_FG.peach)}>
                {KEYWORD_ON_A_FLOOR_ROW}
              </p>
            )}
            {!adds && a.state !== 'counted' && (
              <p className={cn('mt-1 text-[11px] leading-4 font-semibold', TINT_FG.peach)}>{absence(a)}</p>
            )}
            {!adds && a.state === 'counted' ? (
              <p className="mt-1 text-[11px] leading-4 text-text-3">
                {a.why ? a.why + ' ' : ''}The list is resolved again at the moment it sends, so this is how
                many it is now and not a number this row carries.
              </p>
            ) : null}
            {!adds && a.missing ? (
              <p className="mt-1 text-[11px] leading-4 text-text-3">
                <span className="font-semibold text-text-2">What it cannot know:</span> {a.missing}
              </p>
            ) : null}
            {!adds && a.where ? (
              <p className="mt-1 text-[11px] leading-4 text-text-3">Resolved by: {a.where}</p>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

// WHAT MAY BE TYPED IN `to`, NAMED FROM THE REGISTRY.
export function KeywordHint({ book }: { book: KeywordBook | null }) {
  if (!book) {
    return (
      <span className="mt-1 block text-[11px] leading-4 text-text-3">
        Addresses written out — a number with all ten digits, or an e-mail with its own domain.
        Which keywords this platform resolves was not read this visit, so this desk cannot check a
        word here; the platform refuses one it cannot resolve when you save.
      </span>
    )
  }
  if (!book.keys.length) {
    return (
      <span className="mt-1 block text-[11px] leading-4 text-text-3">
        Addresses only — this platform resolves no keyword, so a word here reaches nobody.
      </span>
    )
  }
  return (
    <span className="mt-1 block text-[11px] leading-4 text-text-3">
      Addresses written out — a number with all ten digits, or an e-mail with its own domain — or{' '}
      {book.keys.length === 1 ? 'the one word' : 'one of the words'}{' '}
      this platform resolves and counts: {book.keys.map((k) => `“${k}”`).join(', ')}. Any other word reaches nobody.
    </span>
  )
}
