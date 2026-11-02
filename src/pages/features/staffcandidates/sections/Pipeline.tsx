// Pipeline: everyone in the hiring process, from the Hiring board's own rows — a search, a stage filter with each…
// A name switches the screen to that candidate.
import { useState } from 'react'
import { ArrowRight, CalendarCheck, FileCheck2, Loader2, PhoneCall, type LucideIcon } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SearchInput from '@/components/shared/SearchInput'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { cn } from '@/lib/utils'
import {
  pipelineOpen, pipelineRows, stageCounts, stageMeta, type CandidateAsk, type PipelineOpen, type RosterRow,
} from '../candidateModel'
import { prefetchCandidate } from '../candidateReads'
import { openSignedPacket, useCandidateDocs } from '../useCandidateRead'
import { EmptyNote, Pill, TH } from '../CandidateParts'

export default function PipelineSection({ candidates, current, onCandidate, onOpen, narrow = false }: {
  candidates: RosterRow[]
  current: string
  onCandidate: (key: string) => void
  /** that candidate, on this section, with the right panel open; without it no NEXT STEP opens anything */
  onOpen?: (key: string, ask: CandidateAsk) => void
  narrow?: boolean
}) {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('')
  const [opening, setOpening] = useState('')
  const doc = useCandidateDocs()
  // the signed packet opens centred when the candidate's own list names its file; else the panel says why not
  const openPacket = (r: RosterRow, open: (key: string, ask: CandidateAsk) => void) => {
    setOpening(r.key)
    openSignedPacket(r.key, r.name, doc)
      .then((got) => { if (got === 'missing') open(r.key, { kind: 'packet' }) })
      .catch(() => open(r.key, { kind: 'packet' }))
      .finally(() => setOpening((o) => (o === r.key ? '' : o)))
  }
  // a narrowed reader has no next step to open
  const onNext = onOpen && !narrow ? (r: RosterRow, o: PipelineOpen) => {
    if (o.kind === 'packet') openPacket(r, onOpen)
    else onOpen(r.key, { kind: o.kind })
  } : undefined
  const busy = opening || (doc.opening ? doc.opening.split('|')[0] : '')
  return <PipelineView candidates={candidates} current={current} query={query} onQuery={setQuery} stage={stage} onStage={setStage}
    onCandidate={onCandidate} onNext={onNext} opening={busy} narrow={narrow} />
}

const NEXT_ICON: Record<PipelineOpen['kind'], LucideIcon> = { screen: PhoneCall, interview: CalendarCheck, packet: FileCheck2 }

/** The NEXT STEP cell: a button when the step has something to open, its words when it has not. */
export function NextStepCell({ row, onNext, opening }: {
  row: RosterRow
  onNext?: (row: RosterRow, open: PipelineOpen) => void
  opening?: boolean
}) {
  const o = onNext ? pipelineOpen(row) : null
  if (!o || !onNext) return <span data-next-step="">{row.next_step || 'Nothing open'}</span>
  const Icon = opening ? Loader2 : NEXT_ICON[o.kind]
  return (
    <span className="grid justify-items-start gap-1">
      {o.kind === 'packet' && row.next_step && <span className="text-text-2" data-next-step="">{row.next_step}</span>}
      <button type="button" onClick={() => onNext(row, o)} data-next-open={o.kind} aria-label={o.hint} title={o.hint}
        aria-busy={opening || undefined}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md text-left font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <Icon size={13} className={cn('shrink-0', opening && 'animate-spin')} />
        <span className="min-w-0 break-words">{o.label}</span>
      </button>
    </span>
  )
}

export function PipelineView({
  candidates, current, query, onQuery, stage, onStage, onCandidate, onNext, opening = '', narrow = false,
}: {
  candidates: RosterRow[]
  current: string
  query: string
  onQuery: (q: string) => void
  stage: string
  onStage: (s: string) => void
  onCandidate: (key: string) => void
  onNext?: (row: RosterRow, open: PipelineOpen) => void
  /** the candidate whose packet is on its way; '' when none */
  opening?: string
  /** the candidates tied to the reader's houses: no location, no next step */
  narrow?: boolean
}) {
  const inProcess = candidates.filter((c) => !c.archived)
  const rows = pipelineRows(candidates, query, stage)
  const chips = [{ id: '', label: 'All', count: inProcess.length }, ...stageCounts(candidates)]
  const count = `${inProcess.length} candidate${inProcess.length === 1 ? '' : 's'}`
  return (
    <SectionCard title="Pipeline" sub={narrow ? `${count} tied to your house.` : `${count} in the hiring process.`}>
      <div className="grid gap-3">
        <SearchInput value={query} onChange={onQuery} placeholder="Search candidates…" className="h-10 rounded-[12px]" />
        <div role="tablist" aria-label="Stages" className="scroll-thin flex gap-1.5 overflow-x-auto pb-1" data-stages="">
          {chips.map((c) => {
            const on = c.id === stage
            return (
              <button key={c.id || 'all'} type="button" role="tab" aria-selected={on} onClick={() => onStage(c.id)} data-stage={c.id || 'all'}
                className={cn('shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                  on ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2 hover:bg-surface-2')}>
                {c.label} · {c.count}
              </button>
            )
          })}
        </div>
        {inProcess.length === 0 ? <EmptyNote>{narrow ? 'No candidate is tied to your house.' : 'No candidate is in the hiring process.'}</EmptyNote>
          : rows.length === 0 ? <EmptyNote>No candidate matches the search and the stage.</EmptyNote> : (
            <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border">
              <table className={cn('w-full border-collapse text-[13px]', narrow ? 'min-w-[480px]' : 'min-w-[760px]')} data-pipeline-table="">
                <thead className="border-b border-border bg-surface-2/50">
                  <tr>
                    <th className={TH}>Candidate</th>
                    <th className={TH}>Position</th>
                    <th className={TH}>Stage</th>
                    {!narrow && <th className={TH}>Location</th>}
                    {!narrow && <th className={TH}>Next step</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const on = r.key === current
                    return (
                      <tr key={r.key} data-pipeline-row={r.key} aria-current={on ? 'true' : undefined} className={cn(on && 'bg-primary-soft/40')}>
                        <td className="px-4 py-3 align-middle">
                          <button type="button" onClick={() => onCandidate(r.key)} data-open-candidate={r.key}
                            onPointerEnter={() => prefetchCandidate(r.key)} onFocus={() => prefetchCandidate(r.key)}
                            className="flex items-center gap-2.5 text-left">
                            <Avatar src={r.avatar} name={r.name} size="sm" />
                            <span className="font-semibold text-primary hover:underline">{r.name}</span>
                            {!on && <ArrowRight size={13} className="text-text-3" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 align-middle text-text-2">{r.position || '—'}</td>
                        <td className="px-4 py-3 align-middle"><Pill meta={stageMeta(r.stage)} /></td>
                        {!narrow && <td className="px-4 py-3 align-middle text-text-2">{r.location || '—'}</td>}
                        {!narrow && (
                          <td className="max-w-[260px] px-4 py-3 align-middle text-text-2" data-next-cell={r.key}>
                            <NextStepCell row={r} onNext={onNext} opening={opening === r.key} />
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </SectionCard>
  )
}
