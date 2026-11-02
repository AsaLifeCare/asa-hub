// THE PUNCH PAIRS ON THE BOARD — what server/punch_pairs.py says about each shift's own clock-in and clock-out, and…
// Pure: the chips, the sentences and the card's own state.
import type { TintName } from '@/engine/types'

/** A shift's pair verdict (punch_pairs.VERDICTS). */
export type PairVerdict =
  | 'paired' | 'open' | 'missing' | 'covered_by_another' | 'told_by_a_human' | 'double_booked'
  | 'unreadable'

/** A warning's state (punch_pairs.STATES). */
export type WarningState = 'warned' | 'received' | 'converted' | 'closed' | 'gave_up'

/** One warning as the last post read it (punch_pairs._remember_warnings). */
export type PunchWarning = {
  id: string
  ref: string
  person: string
  house: string
  house_name: string
  shift_code: string
  day: string
  shift_at: string
  state: WarningState | string
  /** how many tellings were said or written */
  tells: number
  /** how many of those really reached a director's phone */
  delivered: number
  why: string
  opened_at: string
  told_at: string
  received_by: string
  call_off_ref: string
  /** why an answered warning is not open yet (the calendar's last refusal), or why it stopped after the answer */
  call_off_why?: string
  /** how often it was said and over what span, from the row's own first and latest telling */
  span?: string
  /** why the latest round reached nobody, in the door's words; '' when it said something */
  unheard?: string
  /** why a telling that was due this beat was not made — the directors list unreadable, a read too old, the quiet window */
  waits?: string
  /** a live warning a RECEIVED cannot open, because its shift shares a calendar cell: why, in words */
  by_hand?: string
}

/** The board's `pairs` card (punch_pairs.board_status), or the lane's refusal. */
export type PairsCard = {
  paired_at?: string
  /** why the pairing may not be acted on now, or '' */
  stale?: string
  counts?: Record<string, number>
  warnings?: PunchWarning[]
  /** when the warnings were last read; '' or absent means never read — not "none" */
  warnings_at?: string
  /** the last read of the warnings failed after one that landed, in words */
  warnings_why?: string
  readable?: boolean
  why?: string
}

type Spec = { label: string; tint: TintName | null; means: string }

/** `tint: null` is UNKNOWN, drawn dashed — never as a finding. */
export const PAIR: Record<PairVerdict, Spec> = {
  paired: { label: 'Pair kept', tint: 'mint',
    means: 'This shift has its own entry, clocked in and clocked out.' },
  open: { label: 'Entry open', tint: 'amber',
    means: 'This shift\'s entry has a clock-in and no clock-out.' },
  missing: { label: 'No entry', tint: 'pink',
    means: 'The time clock holds no entry of this shift\'s own.' },
  covered_by_another: { label: 'One punch, two shifts', tint: 'peach',
    means: 'One entry covers this shift and another — every shift owes a clock-in and a clock-out of its own.' },
  told_by_a_human: { label: 'Accounted for', tint: 'green',
    means: 'A call-off book already accounts for this shift. It never climbs.' },
  double_booked: { label: 'On two grids', tint: null,
    means: 'The roster holds this person on another shift at the same hours — the cell needs fixing, not the person.' },
  unreadable: { label: 'Pair not read', tint: null,
    means: 'The clock or the schedule could not be read for this shift. Unknown — never a fault.' },
}

export const WARNING_STATE: Record<WarningState, Spec> = {
  warned: { label: 'Telling the directors', tint: 'pink',
    means: 'The reminders to the person ran out, and each director is told again and again, with no cap, until one answers RECEIVED, the punches arrive or the shift ends.' },
  received: { label: 'RECEIVED — opening', tint: 'amber',
    means: 'A director answered; the call off is made through the calendar\'s own act on a fresh read of the clock that still shows no punch.' },
  converted: { label: 'Open shift', tint: 'blue',
    means: 'The director\'s RECEIVED turned the shift into a call off in the pool.' },
  closed: { label: 'Closed', tint: 'mint',
    means: 'The warning stopped being true — a punch arrived, or a book accounts for the shift — or the answer was refused.' },
  gave_up: { label: 'Stopped, unanswered', tint: null,
    means: 'The shift ended with no answer, so the answer could open nothing any more. It says how often it was said, and over what span.' },
}

export function pairSpec(v: string | undefined): Spec | null {
  if (!v) return null
  return (PAIR as Record<string, Spec>)[v] ?? { label: v, tint: null, means: '' }
}

export function warningSpec(s: string | undefined): Spec {
  return (WARNING_STATE as Record<string, Spec>)[s ?? ''] ?? { label: s || 'unknown', tint: null, means: '' }
}

// The card's own state: unreadable, stale, or read — in words, never zeros.
export function pairsCardState(card: PairsCard | undefined | null): { kind: 'unread' | 'stale' | 'read'; text: string } {
  if (!card || card.readable === false) {
    return { kind: 'unread',
      text: `The warnings to the directors could not be read${card?.why ? ` (${card.why})` : ''} — nothing here says there are none or that anybody is at fault, and nobody is warned from here.` }
  }
  if (!card.warnings_at) {
    return { kind: 'unread',
      text: `The warnings to the directors could not be read yet${card.stale ? ` (${card.stale})` : ''} — nothing below says there are none.` }
  }
  if (card.stale) {
    return { kind: 'stale',
      text: `${card.stale}: no warning is opened, told or answered until the shifts are paired again from a fresh read.` }
  }
  if (card.warnings_why) {
    return { kind: 'stale',
      text: `${card.warnings_why}: the list below is the last one read, and may be out of date.` }
  }
  return { kind: 'read', text: '' }
}

/** A warning's line under its name: how often it was told, and whether it reached anybody. */
export function warningSentence(w: PunchWarning): string {
  const tells = Number(w.tells) || 0
  const reached = Number(w.delivered) || 0
  const unheard = (w.unheard || '').trim()
  const waits = (w.waits || '').trim()
  const byHand = (w.by_hand || '').trim()
    ? ' This shift shares its calendar cell with another of theirs, so a RECEIVED stops the warning and the shift is opened by hand on the house calendar.'
    : ''
  if (w.state === 'warned') {
    if (!tells) {
      // A due telling that was not made says why — an unreadable directors list is never "not told yet".
      if (waits) return `Not told yet — ${waits}.${unheard ? ` The last try reached nobody (${unheard}).` : ''}${byHand}`
      return (unheard
        ? `Not told yet — the last try reached nobody (${unheard}). It is tried again until a director answers RECEIVED, the punches arrive or the shift ends.`
        : 'Not told yet — it goes at the next beat outside the quiet window, on a fresh read that still shows no punch.') + byHand
    }
    const said = spanSentence(w.span) || `Said ${tells} time(s)`
    const last = unheard ? ` The last try reached nobody (${unheard}).` : ''
    const next = waits ? ` The next telling waits: ${waits}.` : ''
    if (!reached) return `${said}, and none of them reached a director's phone — it cannot be answered until one does.${last}${next}${byHand}`
    return `${said}; ${reached} reached a director. Each director may answer RECEIVED ${w.ref}.${last}${next}${byHand}`
  }
  if (w.state === 'received') {
    // Why it is not open yet — never the reason the warning was opened.
    const notYet = (w.call_off_why || '').trim()
    return `${w.received_by || 'A director'} answered RECEIVED — not open yet: ${notYet
      ? `${notYet.replace(/\.$/, '')}; it is tried again.`
      : 'it opens as a call off on the next read of the time clock that still shows no punch.'}`
  }
  if (w.state === 'converted') return `${w.received_by || 'A director'} answered RECEIVED — now the open shift ${w.call_off_ref}.`
  return w.why || 'It stopped.'
}

/** The relay's span words ("it was said 3 time(s) over 40 minutes, ...") as the start of a sentence. */
function spanSentence(span: string | undefined): string {
  const s = (span || '').trim().replace(/^it was /, '')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

/** Only a live warning that really reached a director may be answered from here. */
export function mayAnswer(w: PunchWarning): boolean {
  return w.state === 'warned' && (Number(w.delivered) || 0) > 0
}

export const RECEIVED_PATH = '/hub-lanes/punch-warnings/received'
