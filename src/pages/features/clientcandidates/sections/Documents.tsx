// Documents: the referral summary, the support assessment, the consent and contact preferences and the plan — each…
// A paper with a file, or one the door renders (the referral summary, the assessment read from the plan), opens…
import { ArrowRight, FileText, Loader2, Pencil, Upload } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { cn } from '@/lib/utils'
import {
  DOC_STATUS_META, docFileAsk, docGroups, docLine, docOpens, docsWords, documentsOf, mayConfirm, mayPaper, paperOf, reachOf,
  type CandidateAsk, type CandidateDoc, type CandidateDocuments, type CandidateEdition, type Reach, type RosterRow,
} from '../candidateModel'
import { readDocuments, readKey, useCandidateDocs, useCandidateRead, type CandidateDocOpener, type ReadState } from '../useCandidateRead'
import { EmptyNote, Pill, ReadLine, WhyLines } from '../CandidateParts'

export default function DocumentsSection({ row, onAsk, canWrite = false, editions = [] }: {
  row: RosterRow
  onAsk: (ask: CandidateAsk) => void
  canWrite?: boolean
  editions?: readonly CandidateEdition[]
}) {
  const docs = useCandidateRead(readKey('clientCandidateDocuments', row.key), () => readDocuments(row.key), documentsOf)
  const doc = useCandidateDocs()
  return <DocumentsView row={row} docs={docs} doc={doc} onAsk={onAsk} onRetry={docs.reload} canWrite={canWrite} editions={editions} />
}

export function DocumentsView({ row, docs, doc, onAsk, onRetry, canWrite = false, editions = [] }: {
  row: Pick<RosterRow, 'key' | 'name'>
  docs: ReadState<CandidateDocuments>
  doc: CandidateDocOpener
  onAsk: (ask: CandidateAsk) => void
  onRetry: () => void
  /** filing a paper is the master's */
  canWrite?: boolean
  /** the editions this reader makes here: the consent's confirmation and a filed paper's record */
  editions?: readonly CandidateEdition[]
}) {
  const reach = reachOf(canWrite, editions)
  const d = docs.data
  const onFile = d ? docsWords(d.on_file, d.total) : ''
  const groups = d ? docGroups(d.docs) : []
  return (
    <SectionCard title="Documents" sub={onFile ? `${onFile} on file` : undefined}>
      <div className="grid gap-4">
        <ReadLine state={docs} what="the documents" onRetry={onRetry} />
        {d && <WhyLines why={d.why} degraded={d.degraded} />}
        {d && d.docs.length === 0 && <EmptyNote>No document is on {row.name}&rsquo;s referral yet.</EmptyNote>}
        {groups.map((g) => (
          <div key={g.group || 'all'} data-doc-group={g.group || 'all'}>
            {(groups.length > 1 || g.label) && (
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{g.label || 'Documents'}</h3>
            )}
            <ul className="divide-y divide-border">
              {g.docs.map((x) => <DocRow key={x.id} d={x} row={row} doc={doc} onAsk={onAsk} reach={reach} />)}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

const FILE_BTN = 'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2'

function DocRow({ d, row, doc, onAsk, reach }: {
  d: CandidateDoc
  row: Pick<RosterRow, 'key' | 'name'>
  doc: CandidateDocOpener
  onAsk: (ask: CandidateAsk) => void
  reach: Reach
}) {
  const opens = docOpens(d)
  const busy = opens && doc.opening === `${row.key}|${d.file_id || d.render}`
  const line = docLine(d)
  // filing is the master's (Drive); a consent In Review is confirmed by the documents edition too
  const ask = reach.write ? docFileAsk(d)
    : mayConfirm(reach) && d.id === 'consent' && d.status === 'in_review' ? docFileAsk(d) : null
  const paper = mayPaper(reach) ? paperOf(d) : null
  const subtitle = [row.name, line].filter(Boolean).join(' · ')
  const open = () => (d.file_id ? doc.open(row.key, d.file_id, d.title, subtitle) : doc.render(row.key, d.render, d.title, subtitle))
  const head = (
    <>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full',
        opens ? 'bg-tint-blue text-tint-fg-blue' : 'bg-surface-2 text-text-3')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-text-1">{d.title}</span>
        {line && <span className="mt-0.5 block text-[12px] leading-5 text-text-3">{line}</span>}
      </span>
      <Pill meta={DOC_STATUS_META[d.status]} />
      {opens && (busy ? <span className="text-[12px] text-text-3">Opening…</span>
        : <ArrowRight size={15} className="shrink-0 text-text-3" data-arrow="" />)}
    </>
  )
  return (
    <li data-doc={d.id} data-status={d.status} className="flex min-w-0 items-center gap-2 py-1">
      {opens ? (
        <button type="button" onClick={open} disabled={busy} aria-busy={busy || undefined}
          data-open-doc={d.file_id || d.render}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left transition-colors hover:bg-surface-2/60 disabled:cursor-wait">
          {head}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5">{head}</div>
      )}
      {ask && (
        <button type="button" onClick={() => onAsk(ask)} data-file-doc={d.id} className={FILE_BTN}>
          <Upload size={13} /> {d.status === 'in_review' ? 'Review…' : 'File…'}
        </button>
      )}
      {paper && (
        <button type="button" onClick={() => onAsk({ kind: 'paper', doc: paper })} data-paper-doc={paper} className={FILE_BTN}>
          <Pencil size={13} /> Record…
        </button>
      )}
    </li>
  )
}
