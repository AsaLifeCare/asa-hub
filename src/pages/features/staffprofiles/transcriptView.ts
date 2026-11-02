// A person's call, in the shapes the hotline screen's own conversation view reads: our line on the left, the…
// Staff and Staff Candidates draw their transcript panel from here (CallTranscript).
import { dayWords } from '@/pages/features/locations/locationModel'
import { ohioTime } from '@/lib/ohio'
import type { CallRow } from '@/pages/features/smartcomms/hotline/hotlineApi'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import type { DetailState } from '@/pages/features/smartcomms/hotline/useCallDetail'
import { parseSpeakerTranscript, secsWords, type StaffTranscript, type TranscriptTurn } from './staffModel'

export function callRowOf(t: StaffTranscript): CallRow {
  const direction = t.direction.toLowerCase()
  return {
    call_id: t.callId, at: t.at, line: t.line, line_key: 'hotline',
    direction: direction === 'incoming' || direction === 'outgoing' ? direction : '',
    duration_sec: t.durationSec, turns: null,
    caller: { phone: '', kind: 'unknown', line_name: '', who: 'unknown', name: '' },
    summary: null, hotline: null, has_transcript: t.hasWords,
  }
}

// The turns with their sides.
export function sidedTurns(turns: TranscriptTurn[]): TranscriptTurn[] {
  const agent = turns.some((t) => t.role === 'agent')
  const caller = turns.some((t) => t.role === 'caller')
  if (agent === caller) return turns
  const others = new Set(turns.filter((t) => t.role === 'other').map((t) => t.speaker))
  if (others.size !== 1) return turns
  const side = agent ? 'caller' : 'agent'
  return turns.map((t) => (t.role === 'other' ? { ...t, role: side } : t))
}

export function detailOf(t: StaffTranscript, phones: string[]): DetailState {
  if (!t.hasWords) return { phase: 'ok', detail: { call_id: t.callId, transcript: null, summary: null } }
  return {
    phase: 'ok',
    detail: {
      call_id: t.callId,
      transcript: { source: 'transcripts', turns: sidedTurns(parseSpeakerTranscript(t.speaker, t.line, phones)), plain: t.full || t.speaker },
      summary: null,
    },
  }
}

/** Our side of the call: the line's name when the line book names it, else "ASA · <number>". */
export function companyLabel(t: Pick<StaffTranscript, 'line' | 'lineName'>): string {
  if (t.lineName) return t.lineName
  const n = formatPhoneDisplay(t.line)
  return n ? `ASA · ${n}` : 'ASA'
}

/** The header's title: the phone screen, or a call, with the person. */
export function transcriptTitle(t: Pick<StaffTranscript, 'kind'>, name: string): string {
  const who = name ? ` with ${name}` : ''
  return /phone screen/i.test(t.kind) ? `Phone screen${who}` : `Call${who}`
}

/** The header's facts, each once: the day, the clock, the length, the direction and the company line. */
export function transcriptMeta(t: Pick<StaffTranscript, 'at' | 'durationSec' | 'direction' | 'line' | 'lineName'>): string[] {
  const direction = t.direction.toLowerCase()
  const way = direction === 'incoming' ? 'Incoming' : direction === 'outgoing' ? 'Outgoing' : ''
  const line = formatPhoneDisplay(t.line)
  return [
    t.at ? dayWords(t.at) || '' : '',
    t.at && !/^\d{4}-\d{2}-\d{2}$/.test(t.at) ? ohioTime(t.at) : '',
    secsWords(t.durationSec),
    way,
    line ? `${t.lineName || 'ASA line'} ${line}` : '',
  ].filter(Boolean)
}
