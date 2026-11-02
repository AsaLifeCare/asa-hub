// Pipeline: every referral on the Potential Clients file, from its own rows — a search, a stage dropdown (All and…
// A name switches the screen to that referral.
import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SearchInput from '@/components/shared/SearchInput'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { cn } from '@/lib/utils'
import { pipelineNext, pipelineRows, stageCounts, stageMeta, type RosterRow } from '../candidateModel'
import { prefetchCandidate } from '../candidateReads'
import { EmptyNote, Pill, TH } from '../CandidateParts'

/** How many rows the table draws before "Show more". */
export const PIPELINE_PAGE = 50

export default function PipelineSection({ candidates, current, onCandidate }: {
  candidates: RosterRow[]
  current: string
  onCandidate: (key: string) => void
}) {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('')
  const [shown, setShown] = useState(PIPELINE_PAGE)
  return <PipelineView candidates={candidates} current={current} query={query} stage={stage} shown={shown}
    onQuery={(q) => { setQuery(q); setShown(PIPELINE_PAGE) }} onStage={(s) => { setStage(s); setShown(PIPELINE_PAGE) }}
    onMore={() => setShown((n) => n + PIPELINE_PAGE)} onCandidate={onCandidate} />
}

export function PipelineView({ candidates, current, query, onQuery, stage, onStage, shown, onMore, onCandidate }: {
  candidates: RosterRow[]
  current: string
  query: string
  onQuery: (q: string) => void
  stage: string
  onStage: (s: string) => void
  shown: number
  onMore: () => void
  onCandidate: (key: string) => void
}) {
  const rows = pipelineRows(candidates, query, stage)
  const page = rows.slice(0, shown)
  const choices = stageCounts(candidates)
  return (
    <SectionCard title="Pipeline" sub={`${candidates.length} referral${candidates.length === 1 ? '' : 's'} on the Potential Clients file.`}>
      <div className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchInput value={query} onChange={onQuery} placeholder="Search candidates…" className="h-10 flex-1 rounded-[12px]" />
          <select value={stage} onChange={(e) => onStage(e.target.value)} aria-label="Stage" data-stages=""
            className="h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary sm:w-[220px]">
            {choices.map((c) => (
              <option key={c.id || 'all'} value={c.id} data-stage={c.id || 'all'}>{c.label} · {c.count}</option>
            ))}
          </select>
        </div>
        {candidates.length === 0 ? <EmptyNote>No referral is on the Potential Clients file.</EmptyNote>
          : rows.length === 0 ? <EmptyNote>No referral matches the search and the stage.</EmptyNote> : (
            <>
              <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border">
                <table className="w-full min-w-[860px] border-collapse text-[13px]" data-pipeline-table="">
                  <thead className="border-b border-border bg-surface-2/50">
                    <tr>
                      <th className={TH}>Candidate</th>
                      <th className={TH}>Service requested</th>
                      <th className={TH}>Stage</th>
                      <th className={TH}>Location</th>
                      <th className={TH}>Next step</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {page.map((r) => {
                      const on = r.key === current
                      const next = pipelineNext(r)
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
                          <td className="max-w-[320px] px-4 py-3 align-middle text-text-2"><span className="clamp-2">{r.service || '—'}</span></td>
                          <td className="px-4 py-3 align-middle"><Pill meta={stageMeta(r.stage)} /></td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle text-text-2">{r.location || '—'}</td>
                          <td className={cn('px-4 py-3 align-middle', next.recorded ? 'text-text-2' : 'text-text-3')} data-next-recorded={next.recorded ? 'true' : 'false'}>
                            {next.text || 'Nothing open'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {rows.length > page.length && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-3" data-pipeline-more="">
                  <span>Showing {page.length} of {rows.length}</span>
                  <button type="button" onClick={onMore}
                    className="rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-text-1 hover:bg-surface-2">
                    Show more
                  </button>
                </div>
              )}
            </>
          )}
      </div>
    </SectionCard>
  )
}
