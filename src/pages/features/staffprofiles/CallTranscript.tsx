// THE CALL TRANSCRIPT PANEL'S BODY — one for Staff and Staff Candidates: the header (which call, when, how long…
import Transcript from '@/pages/features/smartcomms/hotline/Transcript'
import type { WhoSource } from '@/pages/features/smartcomms/hotline/join'
import type { StaffTranscript } from './staffModel'
import { callRowOf, companyLabel, detailOf, transcriptMeta, transcriptTitle } from './transcriptView'

export default function CallTranscript({ t, name, source, phones, retry }: {
  t: StaffTranscript
  /** the person the call was with */
  name: string
  source: WhoSource
  /** the person's own numbers: their turns stand on the right */
  phones: string[]
  retry: () => void
}) {
  return (
    <div className="grid min-w-0 gap-4" data-call-transcript={t.callId}>
      <Transcript call={callRowOf(t)} who={{ name, source }} state={detailOf(t, phones)} retry={retry}
        title={transcriptTitle(t, name)} meta={transcriptMeta(t)} agentLabel={companyLabel(t)} />
      <p className="text-[11px] leading-4 text-text-3">Every read of a call&rsquo;s words is logged with who asked.</p>
    </div>
  )
}
