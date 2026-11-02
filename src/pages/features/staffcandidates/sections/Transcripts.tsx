// Transcripts: the calls between the company and the candidate — the phone screen and every other call on a company…
// Each opens its words in the right panel, the Staff app's transcript view.
import { useState } from 'react'
import { PhoneCall } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { ohioTime } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import { callsByDay, secsWords, spanWords, transcriptsOf, type StaffTranscripts } from '@/pages/features/staffprofiles/staffModel'
import type { CandidateAsk, RosterRow } from '../candidateModel'
import { readKey, readTranscripts, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EmptyNote, ReadLine, WhyLines } from '../CandidateParts'

export default function TranscriptsSection({ row, onAsk }: { row: RosterRow; onAsk: (ask: CandidateAsk) => void }) {
  const transcripts = useCandidateRead(readKey('candidateProfileTranscripts', row.key), () => readTranscripts(row.key), transcriptsOf)
  const [category, setCategory] = useState('')
  return (
    <TranscriptsView name={row.name} transcripts={transcripts} category={category} onCategory={setCategory}
      onOpen={(id) => onAsk({ kind: 'transcript', id })} onRetry={transcripts.reload} />
  )
}

export function TranscriptsView({ name, transcripts, category, onCategory, onOpen, onRetry }: {
  name: string
  transcripts: ReadState<StaffTranscripts>
  category: string
  onCategory: (c: string) => void
  onOpen: (callId: string) => void
  onRetry: () => void
}) {
  const t = transcripts.data
  const groups = t ? callsByDay(t.calls, category) : []
  return (
    <SectionCard title="Transcripts" sub={t ? `${t.calls.length} call${t.calls.length === 1 ? '' : 's'} with ${name}.` : undefined}>
      <div className="grid gap-3">
        <ReadLine state={transcripts} what="the transcripts" onRetry={onRetry} />
        {t && <WhyLines why={t.why ? [t.why] : []} degraded={t.degraded} />}
        {t && t.gaps.length > 0 && (
          <div className="grid gap-1" data-transcript-gaps="">
            {t.gaps.map((g) => (
              <p key={`${g.from}-${g.to}`} className="rounded-md bg-tint-amber px-3 py-1.5 text-[12px] text-tint-fg-amber">
                No transcript is on file from {spanWords(g)} — a gap in the record, not a quiet stretch.
              </p>
            ))}
          </div>
        )}
        {t && t.categories.length > 0 && (
          <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Categories" data-categories="">
            {[{ name: '', count: t.calls.length as number | null }, ...t.categories].map((c) => {
              const on = c.name === category
              return (
                <button key={c.name || 'all'} type="button" role="tab" aria-selected={on} onClick={() => onCategory(c.name)}
                  data-category={c.name || 'all'}
                  className={cn('shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                    on ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2 hover:bg-surface-2')}>
                  {c.name || 'All'}{c.count !== null ? ` · ${c.count}` : ''}
                </button>
              )
            })}
          </div>
        )}
        {t && t.calls.length === 0 && <EmptyNote>No call transcript carries {name}&rsquo;s phone.</EmptyNote>}
        {t && t.calls.length > 0 && groups.length === 0 && <EmptyNote>No call is filed under this category.</EmptyNote>}
        {groups.length > 0 && (
          <div className="scroll-thin max-h-[560px] overflow-y-auto rounded-[16px] border border-border" data-calls="">
            {groups.map((g) => (
              <div key={g.day}>
                <p className="sticky top-0 z-[1] border-b border-border bg-surface-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  {g.day}
                </p>
                <ul className="divide-y divide-border">
                  {g.calls.map((c) => (
                    <li key={c.callId}>
                      <button type="button" onClick={() => onOpen(c.callId)} data-call={c.callId}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/60">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-fg-blue">
                          <PhoneCall size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-text-1">
                            {[ohioTime(c.at), c.direction ? c.direction[0].toUpperCase() + c.direction.slice(1) : '', c.line ? formatPhoneDisplay(c.line) : ''].filter(Boolean).join(' · ')}
                          </span>
                          <span className="block text-[11.5px] text-text-3">
                            {[secsWords(c.secs), c.turns !== null ? `${c.turns} turns` : '', c.kind, ...c.categories].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  )
}
