// The Recruiting page's view of `recruitBook` (server/recruit_book.py, CommRecruit.gs decide).
// Never "told" for a held text; an unreadable source is said, never an empty list.
import type { ExportColumn } from '@/lib/exportTable'
import type { ExtendedTintName } from '@/lib/tints'
import { formatPhoneDisplay } from '@/lib/phoneFormat'

export const RESOURCE = 'recruitBook'

export type RecruitHouse = { tab: string; title: string; state: string; rows: number; proved_at: string; why: string }

/** The lane's own state — always the first row of the file. */
export type RecruitStatus = {
  row_kind: 'status'
  id: string
  source_state: string
  source_why: string
  source_at: string
  source_modified_at: string
  keeper_at: string
  copy_at: string
  copy_counts: Record<string, number>
  houses: RecruitHouse[]
  birth_at: string
  baseline: number
  cards_state: string
  cards_why: string
  cards_at: string
  last_pass_at: string
  last_post_at: string
  last_post_why: string
  counts: Record<string, Record<string, number>>
  planned_at: string
  held_why: string
}

/** A screen on today's or tomorrow's list. */
export type RecruitScreen = {
  row_kind: 'screen'
  id: string
  day: string
  first_name: string
  name: string
  last4: string
  screener: string
  time: string
  location: string
  status: string
  verdict: string
  why: string
  state: string
  source: string
}

/** One text the lane owed somebody, with the copy the door wrote for it. */
export type RecruitMessage = {
  row_kind: 'message'
  id: string
  situation: string
  first_name: string
  name: string
  last4: string
  state: string
  why: string
  first_seen: string
  said_at: string
  count: number
  detail: string
  source: string
  /** The words the mock outbox holds; empty when the answer came before they were composed. */
  words?: string
  /** The whole length of the words; more than `words` holds when the copy was cut. */
  words_chars?: number
  to_masked?: string
  line?: string
  /** Set by the door only once the words exist: the marker that a copy was composed. */
  channel?: string
}

export type RecruitRow = RecruitStatus | RecruitScreen | RecruitMessage

/** The three rows on the Desk, in the words a recruiter uses. */
export const SITUATION_LABEL: Record<string, string> = {
  hiring_screen_day_reminder: 'Screen reminder',
  hiring_onboarding_start: 'Onboarding start',
  hiring_bci_howto: 'True Hire how-to',
}

/** Split the file by kind; `status` null means the lane cannot be seen. */
export function splitRows(rows: RecruitRow[] | null | undefined): {
  status: RecruitStatus | null
  screens: RecruitScreen[]
  messages: RecruitMessage[]
} {
  const list = rows ?? []
  return {
    status: (list.find((r) => r.row_kind === 'status') as RecruitStatus | undefined) ?? null,
    screens: list.filter((r): r is RecruitScreen => r.row_kind === 'screen'),
    messages: list.filter((r): r is RecruitMessage => r.row_kind === 'message'),
  }
}

/** The chip a screen's verdict wears. */
export function screenChip(verdict: string): { label: string; tint: ExtendedTintName } {
  switch (verdict) {
    case 'owed': return { label: 'Due now', tint: 'info' }
    case 'waiting': return { label: 'Waiting for its hour', tint: 'info' }
    case 'told': return { label: 'Reminded', tint: 'mint' }
    case 'redirected': return { label: 'Sent to the testers', tint: 'lavender' }
    case 'recorded':
    case 'rehearsed': return { label: 'Recorded — not sent', tint: 'lavender' }
    case 'duplicate': return { label: 'Already sent', tint: 'mint' }
    case 'passed': return { label: 'Screen started', tint: 'slate' }
    case 'skipped': return { label: 'Not reminded', tint: 'slate' }
    case 'hub_card': return { label: 'On the hiring board', tint: 'slate' }
    case 'held': return { label: 'Held', tint: 'amber' }
    default: return { label: verdict || 'Unknown', tint: 'slate' }
  }
}

/** The chip a text's answer wears. */
export function messageChip(state: string): { label: string; tint: ExtendedTintName } {
  switch (state) {
    case 'told': return { label: 'Told', tint: 'mint' }
    case 'redirected': return { label: 'Sent to the testers', tint: 'lavender' }
    case 'recorded':
    case 'rehearsed': return { label: 'Recorded — not sent', tint: 'lavender' }
    case 'duplicate': return { label: 'Already sent', tint: 'mint' }
    case 'owed':
    case 'offered': return { label: 'Waiting for the door', tint: 'info' }
    case 'refused_quiet': return { label: 'Waiting for 08:00', tint: 'info' }
    case 'dial_unknown': return { label: 'Dial unreadable', tint: 'amber' }
    case 'held': return { label: 'Held', tint: 'amber' }
    case 'failed': return { label: 'Failed — asked again', tint: 'amber' }
    case 'gave_up': return { label: 'Gave up', tint: 'pink' }
    case 'opted_out': return { label: 'Asked us to stop', tint: 'slate' }
    case 'shared_line': return { label: 'Shared line', tint: 'slate' }
    case 'our_line': return { label: 'One of our lines', tint: 'slate' }
    case 'no_number': return { label: 'No number', tint: 'slate' }
    case 'hub_card': return { label: 'On the hiring board', tint: 'slate' }
    case 'stale': return { label: 'Too late', tint: 'slate' }
    case 'dial_off': return { label: 'Dial off', tint: 'slate' }
    case 'refused': return { label: 'Refused', tint: 'slate' }
    case 'baseline': return { label: 'Passed before the lane began', tint: 'slate' }
    default: return { label: state || 'Unknown', tint: 'slate' }
  }
}

/** The sentence under one text; never "told" for a held copy. */
export function messageSentence(m: Pick<RecruitMessage, 'state' | 'count' | 'situation'>
  & Partial<Pick<RecruitMessage, 'channel'>>): {
  tone: ExtendedTintName
  text: string
} {
  const what = (SITUATION_LABEL[m.situation] ?? 'The text').toLowerCase()
  switch (m.state) {
    case 'told':
      return { tone: 'mint', text: `The ${what} was sent${m.count > 1 ? ` (telling ${m.count})` : ''} — nobody needs to text it by hand.` }
    case 'duplicate':
      return { tone: 'mint', text: `The ${what} had already gone under this occasion — it was not sent twice.` }
    case 'redirected':
      return { tone: 'lavender', text: `Test mode sent the ${what} to the testers — the candidate was NOT contacted.` }
    case 'recorded':
    case 'rehearsed':
      return { tone: 'lavender', text: `The ${what} became a row in the mock outbox (ASA Data — CommMock) and the rehearsal book — NOBODY WAS CONTACTED. It is not sent later.` }
    case 'owed':
    case 'offered':
    case 'refused_quiet':
    case 'dial_unknown':
    case 'failed':
      return { tone: 'info', text: `The ${what} is still owed — NOBODY WAS CONTACTED yet; the relay offers it again.` }
    case 'held':
      // a composed copy means the row was on and the send door held it
      return String(m.channel || '').trim()
        ? { tone: 'amber', text: `The send door held the ${what} — NOBODY WAS CONTACTED. It is asked again while it can still be said.` }
        : { tone: 'amber', text: `The row is off on the Desk — NOBODY WAS CONTACTED. It is asked again while it can still be said.` }
    case 'gave_up':
      return { tone: 'pink', text: `The send door kept failing — NOBODY WAS CONTACTED, and the relay stopped asking. Text it by hand if it still matters.` }
    default:
      return { tone: 'slate', text: `The ${what} was not sent — NOBODY WAS CONTACTED.` }
  }
}

// THE COPY OF ONE TEXT — what it said, to whom, from which line.

export type MessageCopy =
  | { kind: 'words'; heading: string; words: string; where: string; went: boolean; cut: string }
  | { kind: 'missing'; text: string }
  | { kind: 'none' }

function copyHeading(state: string): { heading: string; went: boolean } {
  switch (state) {
    case 'told': return { heading: 'What was sent', went: true }
    case 'redirected': return { heading: 'What went to the testers', went: true }
    case 'duplicate': return { heading: 'What had already gone', went: true }
    default: return { heading: 'What would have gone', went: false }
  }
}

export function messageCopy(m: Pick<RecruitMessage,
  'state' | 'words' | 'words_chars' | 'to_masked' | 'line' | 'channel' | 'last4'>): MessageCopy {
  const raw = String(m.words || '')
  const words = raw.trim()
  const whole = Number(m.words_chars) || 0
  const channel = String(m.channel || '').trim()
  if (words) {
    const to = String(m.to_masked || '').trim() || (m.last4 ? `•••${m.last4}` : 'the number on the book')
    const line = formatPhoneDisplay(m.line) || 'the Automations line'
    const { heading, went } = copyHeading(m.state)
    return {
      kind: 'words',
      heading,
      words,
      where: `${channel || 'sms'} · to ${to} · from ${line}`,
      went,
      cut: whole > raw.length
        ? `Only the first ${raw.length.toLocaleString('en-US')} of its ${whole.toLocaleString('en-US')} characters `
          + 'were kept — the rest is not shown here.'
        : '',
    }
  }
  if (channel || whole > 0) {
    return {
      kind: 'missing',
      text: 'The door composed this text, but its words did not come back with the answer, so none are shown — '
        + 'this is a copy that could not be read, not a text that said nothing.',
    }
  }
  return { kind: 'none' }
}

/** The copy as one cell of Share/Export/Print. */
export function copyCell(m: RecruitMessage): string {
  const copy = messageCopy(m)
  if (copy.kind === 'words') return copy.cut ? `${copy.words} … (${copy.cut})` : copy.words
  return copy.kind === 'missing' ? copy.text : ''
}

/** The lane's state as sentences, each naming what could not be seen. */
export function statusSentences(s: RecruitStatus | null): { tone: ExtendedTintName; text: string }[] {
  if (!s) return [{ tone: 'amber', text: 'The lane has not written its state yet — this page cannot say what it would send.' }]
  const out: { tone: ExtendedTintName; text: string }[] = []
  if (s.source_state === 'read') {
    out.push({ tone: 'mint', text: `The recruiters' book was read from the platform's own copy (as the keeper last saw it${s.source_at ? `, ${s.source_at.slice(0, 16).replace('T', ' ')} UTC` : ''}).` })
  } else if (s.source_state === 'unread') {
    out.push({ tone: 'amber', text: `The recruiters' book could not be read — ${s.source_why || 'no reason was given'}. The copy that stands is shown and nothing is emptied, but NOTHING is texted from it until the book can be read again.` })
  } else {
    out.push({ tone: 'amber', text: 'The recruiters\' book has not been read yet — nothing is owed until it is.' })
  }
  const pipeline = s.copy_counts?.recruit_pipeline ?? 0
  const onboarding = s.copy_counts?.recruit_onboarding ?? 0
  if (s.copy_at) out.push({ tone: 'slate', text: `Our copy holds ${pipeline} Talent Pipeline and ${onboarding} Onboarding Checklist rows.` })
  for (const h of s.houses ?? []) {
    if (h.state === 'written') out.push({ tone: 'slate', text: `${h.title}: ${h.rows} rows written.` })
    else if (h.state === 'no_house') out.push({ tone: 'amber', text: `${h.title} is not minted yet — the copy waits on this disk (${h.why}).` })
    else if (h.state === 'never') out.push({ tone: 'slate', text: `${h.title}: not written yet.` })
    else out.push({ tone: 'amber', text: `${h.title}: ${h.state} — ${h.why || 'no reason given'}.` })
  }
  if (s.cards_state !== 'read') {
    out.push({ tone: 'amber', text: `The hiring board could not be read (${s.cards_why || 'no reason given'}) — NOTHING is offered until it can, because a person on the board is never texted from the book.` })
  }
  if (s.birth_at) out.push({ tone: 'slate', text: `${s.baseline} candidates had already passed when this lane began; none of them is sent the onboarding start.` })
  if (s.held_why) out.push({ tone: 'info', text: `Right now: ${s.held_why}.` })
  if (s.last_post_why) out.push({ tone: 'amber', text: `The last hand-over to the send door failed: ${s.last_post_why}.` })
  return out
}

/** Counts per text, in words: "3 told, 2 recorded". */
export function countWords(counts: Record<string, number> | undefined): string {
  const parts = Object.entries(counts ?? {})
    .filter(([k]) => k !== 'baseline')
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${messageChip(k).label.toLowerCase()}`)
  return parts.join(', ') || 'nothing yet'
}

/** The screens, as Share/Export/Print carry them. */
export const SCREEN_COLUMNS: ExportColumn[] = [
  { key: 'day', label: 'Day' },
  { key: 'time', label: 'Time' },
  { key: 'name', label: 'Candidate' },
  { key: 'last4', label: 'Phone (last 4)' },
  { key: 'screener', label: 'House manager' },
  { key: 'location', label: 'Place' },
  { key: 'status', label: 'Status on the book' },
  { key: 'verdict', label: 'Reminder', accessor: (r: RecruitScreen) => screenChip(r.verdict).label },
  { key: 'why', label: 'Why' },
]

/** The texts, as Share/Export/Print carry them. */
export const MESSAGE_COLUMNS: ExportColumn[] = [
  { key: 'said_at', label: 'When' },
  { key: 'situation', label: 'Text', accessor: (r: RecruitMessage) => SITUATION_LABEL[r.situation] ?? r.situation },
  { key: 'name', label: 'Candidate' },
  { key: 'last4', label: 'Phone (last 4)' },
  { key: 'state', label: 'State', accessor: (r: RecruitMessage) => messageChip(r.state).label },
  { key: 'sentence', label: 'What happened', accessor: (r: RecruitMessage) => messageSentence(r).text },
  { key: 'words', label: 'Words', accessor: copyCell },
  { key: 'to_masked', label: 'To (masked)' },
  { key: 'line', label: 'Line', accessor: (r: RecruitMessage) => formatPhoneDisplay(r.line) },
  { key: 'why', label: 'Detail' },
  { key: 'source', label: 'Row on the book' },
]
