// The Broadcast page's screen logic; who may send and who hears is CommBroadcast.gs's alone.
// Never says "sent" for a held copy, and says NOBODY WAS CONTACTED whenever nothing left.
import type { ExportColumn } from '@/lib/exportTable'
import type { ExtendedTintName } from '@/lib/tints'

/** Same as CommBroadcast.gs COMM_BROADCAST_TEXT_* (held equal by a test). */
export const TEXT_MIN = 2
export const TEXT_MAX = 1400
export const SIGNATURE_MAX = 160

export type AudienceId = 'allstaff' | 'meddel' | 'house' | 'leadership' | 'prn'

export type Outcome = 'pending' | 'sent' | 'recorded' | 'held' | 'refused' | 'failed' | 'withdrawn'

export type Tally = Record<Outcome, number>

export type BroadcastRecipient = {
  name: string
  to: string
  from: string
  outcome: string
  why: string
}

export type BroadcastRow = {
  id: string
  at: string
  updated_at: string
  by_name: string
  mine: boolean
  audience: string
  audience_label: string
  house: string
  meddel: boolean
  message: string
  signature: string
  body_sample: string
  state: string
  count: number
  tally: Tally
  test_mode: string
  dial: string
  why: string
  warnings: string
  dropped: { reason: string; label: string; count: number }[]
  withdrawn_by: string
  withdrawn_at: string
  /** why the rest will not go from this row, or '' */
  hold_why?: string
  can_continue: boolean
  can_withdraw: boolean
  /** Ended with nobody asked: its own words may be written again. */
  can_resend?: boolean
  recipients: BroadcastRecipient[]
}

export type BroadcastMode = {
  test_mode: string
  dial: string
  dial_readable: boolean
  quiet_now: boolean
  quiet_words: string
  quiet_until: string
  send_switch: string
}

export type BroadcastSituation = {
  id: string
  on: boolean
  found: boolean
  sms_text: string
  /** How many entries the Desk's Cc cell holds — never the entries themselves. */
  cc_count: number
  why: string
}

export type BoardAudience = { id: AudienceId; label: string; allowed: boolean; why: string }

export type BoardHouse = { location: string; label: string; people: number; meddel: number }

export type BroadcastBoard = {
  can_send: boolean
  above: boolean
  hm: boolean
  master: boolean
  why: string
  name: string
  audiences: BoardAudience[]
  houses: BoardHouse[]
  own_houses_via: string
  /** Null for a session that may not send: the row's words and the brakes are the senders' business. */
  situation: BroadcastSituation | null
  mode: BroadcastMode | null
  house_ready: boolean
  calendar: { readable: boolean; why: string; from: string }
  limits: { text_min: number; text_max: number; signature_max: number; cap: number }
  history: BroadcastRow[]
  history_error: string
}

export type PreviewDrop = { reason: string; label: string; count: number; names: string[] }

export type BroadcastPreview = {
  audience: string
  audience_label: string
  house: string
  house_label: string
  meddel: boolean
  readable: boolean
  refused: string
  why: string[]
  notes: string[]
  count: number
  cap: number
  over_cap: boolean
  recipients: { name: string; to: string; from: string }[]
  dropped: PreviewDrop[]
  audience_sha: string
  sample: string
  chars: number
  too_long: boolean
  reason_words: string[]
  situation: BroadcastSituation
  mode: BroadcastMode
}

export type Composer = {
  audience: AudienceId | ''
  house: string
  meddel: boolean
  message: string
  signature: string
}

/** Mirrors CommBroadcast.gs commBroadcastTextProblem_; '' when reviewable. */
export function textProblem(message: string, signature: string): string {
  const m = String(message ?? '').trim()
  const s = String(signature ?? '').trim()
  if (m.replace(/\s+/g, '').length < TEXT_MIN) {
    return 'Write the message first — an empty or one-character text is never sent to a group.'
  }
  if (m.length > TEXT_MAX) {
    return `The message is ${m.length} characters; a broadcast carries at most ${TEXT_MAX} so it arrives as one text.`
  }
  if (s.length > SIGNATURE_MAX) return `The signature is ${s.length} characters; it may be at most ${SIGNATURE_MAX}.`
  return ''
}

/** The door's payload; house and Med Del ride only with the one-house audience. */
export function composerPayload(c: Composer): Record<string, unknown> {
  const isHouse = c.audience === 'house'
  return {
    audience: c.audience,
    house: isHouse ? c.house : '',
    meddel: isHouse ? c.meddel : false,
    message: c.message.trim(),
    signature: c.signature.trim(),
  }
}

/** What a preview is of; a different key needs a new review. */
export function composerKey(c: Composer): string {
  return JSON.stringify(composerPayload(c))
}

/** Is the preview on screen still the preview of what is being written? */
export function previewMatches(c: Composer, previewedKey: string): boolean {
  return !!previewedKey && composerKey(c) === previewedKey
}

/** May Review be pressed? The door decides everything else. */
export function reviewBlock(c: Composer, board: BroadcastBoard | null): string {
  if (!board) return 'The page has not loaded yet.'
  if (!board.can_send) return board.why || 'Broadcasting is not open to this account.'
  if (!c.audience) return 'Choose who the broadcast goes to.'
  const aud = board.audiences.find((a) => a.id === c.audience)
  if (!aud || !aud.allowed) return aud?.why || 'That audience is not open to this account.'
  if (c.audience === 'house' && !c.house) return 'Choose the house.'
  return textProblem(c.message, c.signature)
}

/** '' when Send may be pressed, else why not. */
export function sendBlock(p: BroadcastPreview | null, board: BroadcastBoard | null): string {
  if (!p) return 'Review the recipients first.'
  if (p.refused) return p.refused
  if (!p.readable) return (p.why || []).join(' · ') || 'The audience could not be read — nothing is sent to a guess.'
  if (!p.situation?.on) return p.situation?.why || 'The broadcast row is switched off on the Desk.'
  if (board && !board.house_ready) {
    return 'The broadcast house is not minted yet, and a broadcast is never sent without its row.'
  }
  if (p.mode && p.mode.dial_readable === false) {
    return 'The test-mode switch could not be read — a broadcast does not go out on a guess.'
  }
  if (p.count === 0) return 'This audience resolves to nobody this platform may text.'
  if (p.over_cap) return `${p.count} recipients is over the ${p.cap} this lane allows.`
  if (p.too_long) return `With the words around it the text is ${p.chars} characters, over the provider's 1,600.`
  return ''
}

const EMPTY_TALLY: Tally = { pending: 0, sent: 0, recorded: 0, held: 0, refused: 0, failed: 0, withdrawn: 0 }

export function tallyOf(t: Partial<Tally> | null | undefined): Tally {
  return { ...EMPTY_TALLY, ...(t ?? {}) }
}

/** "3 sent · 2 held by a brake" — only what happened, in the door's words. */
export function tallyWords(t: Partial<Tally>): string {
  const x = tallyOf(t)
  const parts: string[] = []
  if (x.sent) parts.push(`${x.sent} sent`)
  if (x.recorded) parts.push(`${x.recorded} recorded in the mock outbox`)
  if (x.held) parts.push(`${x.held} held by a brake`)
  if (x.refused) parts.push(`${x.refused} refused (asked us to stop)`)
  if (x.failed) parts.push(`${x.failed} failed`)
  if (x.withdrawn) parts.push(`${x.withdrawn} withdrawn`)
  if (x.pending) parts.push(`${x.pending} not asked yet`)
  return parts.join(' · ') || 'nothing yet'
}

export type Headline = { tone: ExtendedTintName; text: string }

/** The sentence under a broadcast; "sent" is only the provider's own yes. */
export function headline(row: Pick<BroadcastRow, 'state' | 'tally' | 'count' | 'test_mode' | 'withdrawn_by' | 'why' | 'hold_why'>): Headline {
  const t = tallyOf(row.tally)
  const n = row.count || 0
  const state = String(row.state || '')
  /* the door's reason replaces "Continue sends them", which would be false */
  if (row.hold_why && ['held_quiet', 'carrying', 'partial', 'interrupted'].includes(state) && t.pending > 0) {
    return { tone: 'amber', text: row.hold_why }
  }
  if (state === 'withdrawn') {
    const before = t.sent ? ` Before that, ${t.sent} were sent.` : ' Nobody was contacted.'
    return { tone: 'slate', text: `Withdrawn${row.withdrawn_by ? ` by ${row.withdrawn_by}` : ''} — ${t.withdrawn} never asked.${before}` }
  }
  if (state === 'held_quiet') {
    return { tone: 'amber', text: 'Held by the quiet window — it goes at 08:00 unless it is withdrawn first. Nobody has been contacted yet.' }
  }
  if (state === 'carrying') {
    return { tone: 'amber', text: `Being sent this morning — ${t.pending} still to go; the next ten-minute pass continues it.` }
  }
  if (state === 'sending') return { tone: 'info', text: `Sending — ${t.pending} of ${n} still to go.` }
  if (state === 'partial' || state === 'interrupted') {
    return { tone: 'amber', text: `${t.pending} not asked yet — Continue sends them, and nobody is ever texted twice.` }
  }
  if (state === 'stopped') {
    return { tone: 'slate', text: `${row.why || 'Stopped'} — nobody was contacted.` }
  }
  if (t.sent === 0 && t.pending === 0) {
    const parts: string[] = []
    if (t.recorded) {
      parts.push(`this broadcast became ${t.recorded} row${t.recorded === 1 ? '' : 's'} in the mock outbox (ASA Data — CommMock) and the rehearsal book`)
    }
    if (t.held) parts.push(`${t.held} held by a brake`)
    if (t.refused) parts.push(`${t.refused} refused (asked us to stop)`)
    if (t.failed) parts.push(`${t.failed} failed`)
    const lead = row.test_mode === 'on' ? 'Test mode is on: ' : ''
    const body = parts.join(' · ') || 'nothing went out'
    return { tone: t.failed && !t.recorded ? 'danger' : 'amber', text: `${lead}${body} — NOBODY WAS CONTACTED.` }
  }
  const rest: string[] = []
  if (t.recorded) rest.push(`${t.recorded} recorded in the mock outbox`)
  if (t.held) rest.push(`${t.held} held by a brake`)
  if (t.refused) rest.push(`${t.refused} refused`)
  if (t.failed) rest.push(`${t.failed} failed`)
  return { tone: t.failed ? 'amber' : 'mint', text: `${t.sent} of ${n} sent${rest.length ? ` · ${rest.join(' · ')}` : ''}.` }
}

/** The chip a state wears. */
export function stateChip(state: string): { label: string; tint: ExtendedTintName } {
  switch (state) {
    case 'done': return { label: 'Done', tint: 'mint' }
    case 'sending': return { label: 'Sending', tint: 'info' }
    case 'held_quiet': return { label: 'Held for 08:00', tint: 'amber' }
    case 'carrying': return { label: 'Sending this morning', tint: 'amber' }
    case 'partial': return { label: 'Stopped part way', tint: 'amber' }
    case 'interrupted': return { label: 'Interrupted', tint: 'amber' }
    case 'withdrawn': return { label: 'Withdrawn', tint: 'slate' }
    case 'stopped': return { label: 'Stopped', tint: 'slate' }
    default: return { label: state || 'Unknown', tint: 'slate' }
  }
}

/** The chip one recipient's outcome wears. */
export function outcomeChip(o: string): { label: string; tint: ExtendedTintName } {
  switch (o) {
    case 'sent': return { label: 'Sent', tint: 'mint' }
    case 'recorded': return { label: 'Recorded — not sent', tint: 'lavender' }
    case 'held': return { label: 'Held', tint: 'amber' }
    case 'refused': return { label: 'Refused', tint: 'pink' }
    case 'failed': return { label: 'Failed', tint: 'danger' }
    case 'withdrawn': return { label: 'Withdrawn', tint: 'slate' }
    case 'pending': return { label: 'Not asked yet', tint: 'slate' }
    default: return { label: o || 'Unknown', tint: 'slate' }
  }
}

/** Where a recipient came from, in words. */
export function sourceWord(from: string): string {
  if (from === 'people') return 'People'
  if (from === 'calendar') return 'the calendar row'
  if (from.startsWith('keyword:')) return from.slice(8)
  if (from.startsWith('cc')) return 'the Cc cell'
  return from || ''
}

/** The brakes in front of the sender, in words. */
export function modeSentences(mode: BroadcastMode | null | undefined, situation: BroadcastSituation | null | undefined): string[] {
  const out: string[] = []
  if (situation && !situation.on) out.push(situation.why || 'The broadcast row is switched off on the Desk.')
  if (!mode) return out
  if (mode.dial_readable === false) {
    out.push('The test-mode switch could not be read, so nothing is sent until it can be.')
  } else if (mode.test_mode === 'on') {
    out.push('Test mode is on: a broadcast becomes rows in the mock outbox (ASA Data — CommMock) and the ' +
             'rehearsal book, and nobody is contacted.')
  } else if (mode.send_switch !== 'on') {
    out.push('The sending switch is off: every copy is held at the send door with its words, and nobody is contacted.')
  }
  if (mode.quiet_now) {
    out.push(`Inside the quiet window (${mode.quiet_words}): a broadcast sent now is held and goes at ` +
             `${mode.quiet_until} unless it is withdrawn first.`)
  }
  return out
}

/** The row's buttons, as the door said on the row. */
export function rowActions(row: Pick<BroadcastRow, 'can_continue' | 'can_withdraw' | 'can_resend' | 'tally'>): {
  cont: boolean
  withdraw: boolean
  resend: boolean
} {
  const pending = tallyOf(row.tally).pending
  return { cont: !!row.can_continue && pending > 0, withdraw: !!row.can_withdraw && pending > 0, resend: !!row.can_resend }
}

/** "Write it again": the row's audience and words, reviewed again like any new broadcast. */
export function composerFromRow(row: Pick<BroadcastRow, 'audience' | 'house' | 'meddel' | 'message' | 'signature'>): Composer {
  const audience = (['allstaff', 'meddel', 'house', 'leadership', 'prn'] as const)
    .find((a) => a === row.audience) ?? ''
  return {
    audience,
    house: audience === 'house' ? String(row.house || '') : '',
    meddel: audience === 'house' ? !!row.meddel : false,
    message: String(row.message || ''),
    signature: String(row.signature || ''),
  }
}

/** What Share, Export and Print carry: the broadcasts as shown. */
export const HISTORY_COLUMNS: ExportColumn[] = [
  { key: 'at', label: 'When' },
  { key: 'by_name', label: 'Written by' },
  { key: 'audience_label', label: 'Audience' },
  { key: 'count', label: 'Recipients' },
  { key: 'state', label: 'State', accessor: (r: BroadcastRow) => stateChip(r.state).label },
  { key: 'tally', label: 'Outcome', accessor: (r: BroadcastRow) => tallyWords(r.tally) },
  { key: 'message', label: 'Message' },
  { key: 'signature', label: 'Signature' },
  { key: 'headline', label: 'What happened', accessor: (r: BroadcastRow) => headline(r).text },
]

/** One composition's key; the door sends a repeated key once. */
export function newClientId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `bc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
