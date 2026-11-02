// THE ONE RIGHT PANEL of Client Candidates — a SidePanel whose mode switches: share, add a note, update the stage…
// It is an aside, never a dialog.
import SidePanel from '@/components/shared/SidePanel'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { ShareBody } from '@/pages/features/locations/LocationPanel'
import Transcript from '@/pages/features/smartcomms/hotline/Transcript'
import { callRowOf, detailOf } from '@/pages/features/staffprofiles/transcriptView'
import { secsWords, transcriptOf } from '@/pages/features/staffprofiles/staffModel'
import type { SharePayload } from '@/stores/useShareStore'
import {
  formOpen, isWriteAsk, mayNoteEdit, panelLabel, panelTitle, reachOf, stampWords, type CandidateAsk, type CandidateEdition,
  type RosterRow,
} from './candidateModel'
import { readKey, readTranscript, useCandidateRead } from './useCandidateRead'
import {
  AssessmentForm, CompleteForm, ConsentForm, EditCandidateForm, NoteEditForm, NoteForm, PaperForm, StageForm,
} from './CandidateForms'
import { NotOpen, ReadLine } from './CandidateParts'

export default function CandidatePanel({ ask, row, share, onClose, canWrite = false, editions, onAsk }: {
  ask: CandidateAsk | null
  row: RosterRow
  share: SharePayload
  onClose: () => void
  /** the master's forms; anyone else is told the part is not open to them unless an edition opens it */
  canWrite?: boolean
  /** the editions this reader makes here (editionsMine) */
  editions?: readonly CandidateEdition[]
  /** another mode of the panel (a note's own edit, from the notes) */
  onAsk?: (ask: CandidateAsk) => void
}) {
  return (
    <SidePanel open={!!ask} onClose={onClose} label={ask ? panelLabel(ask) : 'Candidate'} title={ask ? panelTitle(ask, row.name) : ''}>
      {ask && <PanelBody key={`${row.key}|${JSON.stringify(ask)}`} ask={ask} row={row} share={share} onClose={onClose} canWrite={canWrite}
        editions={editions} onAsk={onAsk} />}
    </SidePanel>
  )
}

export function PanelBody({ ask, row, share, onClose, canWrite = false, editions, onAsk }: {
  ask: CandidateAsk
  row: RosterRow
  share: SharePayload
  onClose: () => void
  canWrite?: boolean
  editions?: readonly CandidateEdition[]
  onAsk?: (ask: CandidateAsk) => void
}) {
  const reach = reachOf(canWrite, editions)
  if (isWriteAsk(ask) && !formOpen(ask, reach)) return <NotOpen />
  switch (ask.kind) {
    case 'share': return <ShareBody payload={share} />
    case 'note': return <NoteForm row={row} about={ask.about} onDone={onClose} onEdit={onAsk && mayNoteEdit(reach) ? onAsk : undefined} />
    case 'stage': return <StageForm row={row} onDone={onClose} />
    case 'complete': return <CompleteForm row={row} item={ask.item} onDone={onClose} />
    case 'reopen': return <CompleteForm row={row} item={ask.item} onDone={onClose} reopen />
    case 'file-assessment': return <AssessmentForm row={row} onDone={onClose} />
    case 'consent': return <ConsentForm row={row} onDone={onClose} />
    case 'transcript': return <TranscriptBody row={row} callId={ask.id} />
    case 'edit': return <EditCandidateForm row={row} section={ask.section} onDone={onClose} />
    case 'noteEdit': return <NoteEditForm row={row} id={ask.id} onDone={onClose} />
    case 'paper': return <PaperForm row={row} doc={ask.doc} onDone={onClose} />
  }
}

/** The hotline screen's own conversation view — Staff's transcript view — over this referral's call. */
function TranscriptBody({ row, callId }: { row: RosterRow; callId: string }) {
  const read = useCandidateRead(readKey('clientCandidateTranscript', row.key, callId), () => readTranscript(row.key, callId), transcriptOf)
  const t = read.data
  return (
    <div className="grid gap-4 pt-1" data-transcript-panel={callId}>
      <ReadLine state={read} what="the transcript" onRetry={read.reload} />
      {t && (
        <>
          <p className="text-[12.5px] text-text-3">
            {[stampWords(t.at), t.direction, t.line ? formatPhoneDisplay(t.line) : '', secsWords(t.durationSec)].filter(Boolean).join(' · ')}
          </p>
          {/* the referral's phone may be the family's: the voice on it is "Caller", never assumed to be the person */}
          <Transcript call={callRowOf(t)} who={{ name: row.name, source: 'shared' }} state={detailOf(t, row.phone ? [row.phone] : [])}
            retry={read.reload} />
          <p className="text-[11.5px] text-text-3">Every read of a call&rsquo;s words is logged with who asked.</p>
        </>
      )}
    </div>
  )
}
