// The automatic "covered" follow-up (CommOpenShiftCovered.gs), shown on the Broadcast page so it is not typed twice.
// Only chips and sentences here; never "told" for a held copy.
import type { ExportColumn } from '@/lib/exportTable'
import type { ExtendedTintName } from '@/lib/tints'

/** One follow-up (`openShiftCoveredBoard`); never the reason or who called off. */
export type CoveredItem = {
  id: string
  day: string
  house: string
  state: string
  rehearsal: boolean
  why: string
  at: string
  filled_at: string
  count: string
  audience: number | null
  ask: string
}

export type CoveredBoard = {
  can_see: boolean
  why: string
  situation: { id: string; on: boolean; found: boolean; sms_text: string }
  items: CoveredItem[]
  error: string
}

/** "3/3" → { sent: 3, of: 3 }; anything else → nulls. */
export function countOf(count: string): { sent: number | null; of: number | null } {
  const m = /^(\d+)\/(\d+)$/.exec(String(count || '').trim())
  return m ? { sent: Number(m[1]), of: Number(m[2]) } : { sent: null, of: null }
}

/** The chip one follow-up's ending wears. */
export function coveredChip(state: string): { label: string; tint: ExtendedTintName } {
  switch (state) {
    case 'told': return { label: 'Told', tint: 'mint' }
    case 'recorded': return { label: 'Recorded — not sent', tint: 'lavender' }
    case 'rehearsed': return { label: 'Rehearsed', tint: 'lavender' }
    case 'partial': return { label: 'Stopped part way', tint: 'amber' }
    case 'held': return { label: 'Held', tint: 'amber' }
    case 'claimed':
    case 'sending': return { label: 'Sending', tint: 'info' }
    case 'waiting': return { label: 'Waiting for 08:00', tint: 'info' }
    case 'planned': return { label: 'Owed — asked again', tint: 'info' }
    case 'ask_dropped': return { label: 'Ask dropped', tint: 'slate' }
    case 'nobody_heard': return { label: 'Nobody was asked', tint: 'slate' }
    case 'unknown_audience': return { label: 'Audience not kept', tint: 'slate' }
    case 'stale': return { label: 'Shift over', tint: 'slate' }
    default: return { label: state || 'Unknown', tint: 'slate' }
  }
}

/** The sentence under one follow-up; the door's `why` is shown beside it. */
export function coveredSentence(item: Pick<CoveredItem, 'state' | 'count' | 'audience' | 'rehearsal'>): {
  tone: ExtendedTintName
  text: string
} {
  const c = countOf(item.count)
  const n = c.of ?? item.audience ?? 0
  const people = `${n} ${n === 1 ? 'person' : 'people'}`
  switch (item.state) {
    case 'told':
      return { tone: 'mint', text: `${c.sent ?? n} of ${people} the URGENT OPEN SHIFT reached were told the shift is covered — nobody needs to text them again.` }
    case 'recorded':
      return { tone: 'amber', text: `The dial held it: written as one row in the mock outbox (ASA Data — CommMock) and the rehearsal book for the ${people} the ask reached — NOBODY WAS CONTACTED.` }
    case 'rehearsed':
      return { tone: 'amber', text: `Rehearsed at the testers in test mode — the ${people} themselves have not been told.` }
    case 'partial':
      return { tone: 'amber', text: `Stopped part way: ${c.sent ?? 0} of ${people} were told. It is never sent twice, so the rest are not told by the platform.` }
    case 'held':
      return { tone: 'amber', text: 'Held — nothing was sent (the row is off on the Desk, or the send door held every copy). NOBODY WAS CONTACTED.' }
    case 'claimed':
    case 'sending':
      return { tone: 'info', text: `Being sent to ${people}.` }
    case 'waiting':
      return { tone: 'info', text: 'The shift was covered in the quiet window; the follow-up goes after 08:00 if the shift has not ended.' }
    case 'planned':
      return { tone: 'info', text: 'A pass stopped before its first copy — nothing was said yet. The follow-up is offered again while the shift has not ended. NOBODY WAS CONTACTED.' }
    case 'ask_dropped':
      return { tone: 'slate', text: 'The URGENT OPEN SHIFT was still waiting for 08:00 and was dropped — the shift was covered first. Nobody was asked, and nobody needed telling.' }
    case 'nobody_heard':
      return { tone: 'slate', text: 'Not sent: that call-off\'s URGENT OPEN SHIFT reached nobody, so there was nobody to tell. NOBODY WAS CONTACTED.' }
    case 'unknown_audience':
      return { tone: 'slate', text: 'Not sent: that URGENT OPEN SHIFT went out before the platform kept who it reached, and nobody new is ever texted. NOBODY WAS CONTACTED.' }
    case 'stale':
      return { tone: 'slate', text: 'Not sent: the shift was already over. NOBODY WAS CONTACTED.' }
    default:
      return { tone: 'slate', text: item.state ? `Ended "${item.state}".` : 'No answer yet.' }
  }
}

/** Whether a draft looks like a "covered" notice (warned, never blocked). */
export function looksLikeCovered(message: string): boolean {
  const t = String(message || '').toLowerCase()
  return /\b(covered|has been filled|been filled|shift filled|is filled|filled with|was filled)\b/.test(t)
}

/** What Share, Export and Print carry: the follow-ups as shown. */
export const COVERED_COLUMNS: ExportColumn[] = [
  { key: 'at', label: 'When' },
  { key: 'day', label: 'Shift day' },
  { key: 'house', label: 'House' },
  { key: 'state', label: 'State', accessor: (r: CoveredItem) => coveredChip(r.state).label },
  { key: 'count', label: 'Told' },
  { key: 'audience', label: 'The ask reached' },
  { key: 'sentence', label: 'What happened', accessor: (r: CoveredItem) => coveredSentence(r).text },
]
