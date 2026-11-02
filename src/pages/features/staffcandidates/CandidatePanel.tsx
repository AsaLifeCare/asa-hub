// THE ONE RIGHT PANEL of Staff Candidates — a SidePanel whose mode switches: share, add a note, update the stage…
// It is an aside, never a dialog.
import { FileCheck2, Loader2, PhoneCall } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { Pair } from '@/pages/features/locations/LocationParts'
import { ShareBody } from '@/pages/features/locations/LocationPanel'
import CallTranscript from '@/pages/features/staffprofiles/CallTranscript'
import { secsWords, transcriptOf, transcriptsOf, type CallMeta } from '@/pages/features/staffprofiles/staffModel'
import type { SharePayload } from '@/stores/useShareStore'
import {
  PLAN_META, docLine, documentsOf, formOpen, interviewLines, interviewsOf, packetDocOf, panelLabel, panelTitle, stampWords,
  type CandidateAsk, type Reach, type RosterRow,
} from './candidateModel'
import {
  readDocuments, readInterviews, readKey, readTranscript, readTranscripts, useCandidateDocs, useCandidateRead,
} from './useCandidateRead'
import {
  CompleteForm, DocReviewForm, DocumentForm, EditCandidateForm, NoteEditForm, NoteForm, StageForm, UploadForm,
} from './CandidateForms'
import { EmptyNote, None, NotOpen, Pill, ReadLine, WhyLines } from './CandidateParts'

export default function CandidatePanel({ ask, row, share, onClose, onAsk, canWrite = false, reach }: {
  ask: CandidateAsk | null
  row: RosterRow
  share: SharePayload
  onClose: () => void
  /** another mode of the same panel — a call the phone screen's panel lists */
  onAsk?: (ask: CandidateAsk) => void
  /** the forms are the master's; anyone else is told the part is not open to them */
  canWrite?: boolean
  /** what this reader may do, editions included; absent, the master's forms follow `canWrite` */
  reach?: Reach
}) {
  return (
    <SidePanel open={!!ask} onClose={onClose} label={ask ? panelLabel(ask) : 'Candidate'} title={ask ? panelTitle(ask, row.name) : ''}>
      {ask && <PanelBody key={`${row.key}|${JSON.stringify(ask)}`} ask={ask} row={row} share={share} onClose={onClose} onAsk={onAsk}
        canWrite={canWrite} reach={reach} />}
    </SidePanel>
  )
}

export function PanelBody({ ask, row, share, onClose, onAsk, canWrite = false, reach }: {
  ask: CandidateAsk
  row: RosterRow
  share: SharePayload
  onClose: () => void
  onAsk?: (ask: CandidateAsk) => void
  canWrite?: boolean
  reach?: Reach
}) {
  const r = reach ?? { write: canWrite, narrow: false }
  if (!formOpen(ask, r)) return <NotOpen />
  switch (ask.kind) {
    case 'share': return <ShareBody payload={share} />
    case 'note': return <NoteForm row={row} about={ask.about} onDone={onClose} />
    case 'stage': return <StageForm row={row} onDone={onClose} master={r.write} />
    case 'complete': return <CompleteForm row={row} item={ask.item} onDone={onClose} master={r.write} />
    case 'upload': return <UploadForm row={row} doc={ask.doc} onDone={onClose} />
    case 'document': return <DocumentForm row={row} item={ask.item} onDone={onClose} />
    case 'transcript': return <TranscriptBody row={row} callId={ask.id} />
    case 'screen': return <ScreenBody row={row} onAsk={onAsk} />
    case 'interview': return <InterviewBody row={row} />
    case 'packet': return <PacketBody row={row} />
    case 'edit': return <EditCandidateForm row={row} section={ask.section} onDone={onClose} />
    case 'noteEdit': return <NoteEditForm row={row} id={ask.id} onDone={onClose} />
    case 'review': return <DocReviewForm row={row} doc={ask.doc} onDone={onClose} />
  }
}

/** The call's words in the Staff transcript view — the header, the chat bubbles, the logged-read note. */
function TranscriptBody({ row, callId, screen = false }: { row: RosterRow; callId: string; screen?: boolean }) {
  const read = useCandidateRead(readKey('candidateProfileTranscript', row.key, callId), () => readTranscript(row.key, callId), transcriptOf)
  const t = read.data && (screen || callId === 'screen') && !read.data.kind ? { ...read.data, kind: 'Phone screen' } : read.data
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-transcript-panel={callId}>
      <ReadLine state={read} what="the transcript" onRetry={read.reload} />
      {t && <CallTranscript t={t} name={row.name} source="candidate" phones={row.phone ? [row.phone] : []} retry={read.reload} />}
    </div>
  )
}

/** The phone screen among the candidate's calls: the one the Hiring record keeps, else the call it names. */
function screenCall(calls: CallMeta[]): CallMeta | null {
  return calls.find((c) => c.callId === 'screen')
    ?? calls.find((c) => /phone screen/i.test(c.kind) || c.categories.some((x) => /phone screen/i.test(x)))
    ?? null
}

// The phone screen's whole conversation, found on the candidate's calls; when the record holds none yet, that is…
function ScreenBody({ row, onAsk }: { row: RosterRow; onAsk?: (ask: CandidateAsk) => void }) {
  const list = useCandidateRead(readKey('candidateProfileTranscripts', row.key), () => readTranscripts(row.key), transcriptsOf)
  const calls = list.data?.calls ?? []
  const screen = screenCall(calls)
  if (screen) return <TranscriptBody row={row} callId={screen.callId} screen />
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-screen-panel="">
      <ReadLine state={list} what="the calls" onRetry={list.reload} />
      {list.data && <WhyLines why={list.data.why ? [list.data.why] : []} degraded={list.data.degraded} />}
      {list.data && (
        <EmptyNote>
          No phone-screen transcript is on {row.name}&rsquo;s hiring record yet — the evaluation line has not filed a
          screening call from their phone.
        </EmptyNote>
      )}
      {calls.length > 0 && (
        <div className="grid gap-1.5" data-other-calls="">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Other calls with {row.name}</h3>
          <ul className="divide-y divide-border rounded-[14px] border border-border">
            {calls.map((c) => (
              <li key={c.callId}>
                <button type="button" disabled={!onAsk} onClick={() => onAsk?.({ kind: 'transcript', id: c.callId })} data-call={c.callId}
                  className="flex w-full min-w-0 items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2/60 disabled:cursor-default">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-fg-blue"><PhoneCall size={14} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-text-1">{stampWords(c.at) || 'Undated'}</span>
                    <span className="block truncate text-[11.5px] text-text-3">
                      {[c.direction ? c.direction[0].toUpperCase() + c.direction.slice(1) : '', secsWords(c.secs), c.kind, ...c.categories]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Who held the interview and what the scorecard holds — each line the record lacks said as not on file. */
function InterviewBody({ row }: { row: RosterRow }) {
  const read = useCandidateRead(readKey('candidateProfileInterviews', row.key), () => readInterviews(row.key), interviewsOf)
  const v = read.data
  const step = v?.plan.find((p) => p.id === 'interview') ?? null
  const lines = step ? interviewLines(step) : []
  const signed = step?.status === 'completed'
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-interview-panel="">
      <ReadLine state={read} what="the interview" onRetry={read.reload} />
      {v && <WhyLines why={v.why} degraded={v.degraded} />}
      {v && !step && <EmptyNote>No interview is on {row.name}&rsquo;s hiring record.</EmptyNote>}
      {step && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-[15px] font-semibold text-text-1">{step.title}</p>
            <Pill meta={PLAN_META[step.status]} />
          </div>
          {!signed && (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-[12.5px] leading-5 text-text-2" data-interview-open="">
              {step.status === 'pending'
                ? `No interview is booked for ${row.name} yet, and no scorecard is signed.`
                : `${step.detail || 'The interview is booked.'} No scorecard is signed yet.`}
            </p>
          )}
          <dl className="grid" data-interview-lines="">
            {lines.map((l, i) => (
              <Pair key={l.label} label={l.label} last={i === lines.length - 1}>
                {l.value || <None />}
              </Pair>
            ))}
          </dl>
          <div className="grid gap-1.5" data-interview-comments="">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Scorecard comments</h3>
            {step.comments
              ? <p className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-[13px] italic leading-5 text-text-2">{step.comments}</p>
              : <p className="text-[12.5px] text-text-3">{signed ? 'The scorecard was signed with no comments.' : 'Not on file — the scorecard is not signed.'}</p>}
          </div>
        </>
      )}
    </div>
  )
}

// The New Hire packet: the signed file opens centred in the platform's viewer when the candidate's own document…
function PacketBody({ row }: { row: RosterRow }) {
  const read = useCandidateRead(readKey('candidateProfileDocuments', row.key), () => readDocuments(row.key), documentsOf)
  const doc = useCandidateDocs()
  const p = read.data ? packetDocOf(read.data.docs) : null
  const opening = !!p && doc.opening === `${row.key}|${p.file_id}`
  const line = p ? docLine(p) : ''
  return (
    <div className="grid min-w-0 gap-4 pt-1" data-packet-panel="">
      <ReadLine state={read} what="the documents" onRetry={read.reload} />
      {read.data && <WhyLines why={read.data.why} degraded={read.data.degraded} />}
      {read.data && !p && <EmptyNote>No New Hire packet is on {row.name}&rsquo;s document list.</EmptyNote>}
      {p && (
        <div className="grid gap-3 rounded-[14px] border border-border p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-tint-mint text-tint-fg-mint"><FileCheck2 size={16} /></span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-text-1">{p.title}</p>
              {line && <p className="mt-0.5 text-[12px] text-text-3">{line}</p>}
            </div>
          </div>
          {p.file_id ? (
            <button type="button" onClick={() => doc.open(row.key, p.file_id, p.title, row.name)} aria-busy={opening || undefined}
              data-open-packet={p.file_id}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary hover:bg-primary-hover">
              {opening ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />} Open the signed packet
            </button>
          ) : (
            <p className="text-[12.5px] leading-5 text-text-2" data-packet-no-file="">
              {p.status === 'on_file'
                ? `The New Hire packet is ${p.source === 'Dropbox Sign' ? 'signed in Dropbox Sign' : 'on file'}, but no copy of the signed file is on ${row.name}’s document list — there is nothing to open inside the platform.`
                : `The New Hire packet is not signed yet, so there is no signed file to open.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
