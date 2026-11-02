// Documents: the onboarding documents, the application and resume, the interview notes, the background check and…
// A paper with a file opens centred, large, in the platform's viewer; a pending one the Hiring card uploads offers…
import { ArrowRight, Check, ClipboardCheck, FileText, Loader2, Upload } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { cn } from '@/lib/utils'
import {
  DOC_STATUS_META, docGroups, docLine, docOpens, docsWords, documentsOf, mayReview, reviewable,
  type CandidateAsk, type CandidateDoc, type CandidateDocuments, type Reach, type RosterRow,
} from '../candidateModel'
import { readDocuments, readKey, useCandidateDocs, useCandidateRead, type CandidateDocOpener, type ReadState } from '../useCandidateRead'
import { EmptyNote, Pill, ReadLine, WhyLines } from '../CandidateParts'

export default function DocumentsSection({ row, onAsk, canWrite = false, reach }: {
  row: RosterRow
  onAsk: (ask: CandidateAsk) => void
  canWrite?: boolean
  /** what this reader may do: Review for whom editionsMine names the documents */
  reach?: Reach
}) {
  const docs = useCandidateRead(readKey('candidateProfileDocuments', row.key), () => readDocuments(row.key), documentsOf)
  const doc = useCandidateDocs()
  return <DocumentsView row={row} docs={docs} doc={doc} onAsk={onAsk} onRetry={docs.reload} canWrite={canWrite}
    canReview={!!reach && mayReview(reach)} />
}

export function DocumentsView({ row, docs, doc, onAsk, onRetry, canWrite = false, canReview = false }: {
  row: Pick<RosterRow, 'key' | 'name'>
  docs: ReadState<CandidateDocuments>
  doc: CandidateDocOpener
  onAsk: (ask: CandidateAsk) => void
  onRetry: () => void
  canWrite?: boolean
  /** a filed onboarding paper's Review (the documents edition) */
  canReview?: boolean
}) {
  const d = docs.data
  const onFile = d ? docsWords(d.on_file, d.total) : ''
  return (
    <SectionCard title="Documents" sub={onFile ? `${onFile} on file` : undefined}>
      <div className="grid gap-4">
        <ReadLine state={docs} what="the documents" onRetry={onRetry} />
        {d && <WhyLines why={d.why} degraded={d.degraded} />}
        {d && d.docs.length === 0 && <EmptyNote>No document is on {row.name}&rsquo;s hiring record yet.</EmptyNote>}
        {d && docGroups(d.docs).map((g) => (
          <div key={g.group} data-doc-group={g.group}>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{g.label}</h3>
            <ul className="divide-y divide-border">
              {g.docs.map((x) => <DocRow key={x.id} d={x} row={row} doc={doc} onAsk={onAsk} canWrite={canWrite}
                canReview={canReview} />)}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

function DocRow({ d, row, doc, onAsk, canWrite, canReview }: {
  d: CandidateDoc
  row: Pick<RosterRow, 'key' | 'name'>
  doc: CandidateDocOpener
  onAsk: (ask: CandidateAsk) => void
  canWrite: boolean
  canReview: boolean
}) {
  const opens = docOpens(d)
  const busy = opens && doc.opening === `${row.key}|${d.file_id}`
  const line = docLine(d)
  const head = (
    <>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full',
        opens ? 'bg-tint-blue text-tint-fg-blue' : 'bg-surface-2 text-text-3')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-text-1">{d.title}</span>
        {line && <span className="mt-0.5 block text-[12px] text-text-3">{line}</span>}
      </span>
      <Pill meta={DOC_STATUS_META[d.status]} />
      {opens && (busy ? <span className="text-[12px] text-text-3">Opening…</span>
        : <ArrowRight size={15} className="shrink-0 text-text-3" data-arrow="" />)}
    </>
  )
  return (
    <li data-doc={d.id} data-status={d.status} className="py-1">
      <div className="flex items-center gap-2">
        {opens ? (
          <button type="button" onClick={() => doc.open(row.key, d.file_id, d.title, [row.name, line].filter(Boolean).join(' · '))}
            disabled={busy} aria-busy={busy || undefined} data-open-doc={d.file_id}
            className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left transition-colors hover:bg-surface-2/60 disabled:cursor-wait">
            {head}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5">{head}</div>
        )}
        {canWrite && d.upload && d.status === 'pending' && (
          <button type="button" onClick={() => onAsk({ kind: 'upload', doc: d.id })} data-upload={d.id}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
            <Upload size={13} /> Upload
          </button>
        )}
        {canReview && reviewable(d) && (
          <button type="button" onClick={() => onAsk({ kind: 'review', doc: d.doc_id ?? '' })} data-review={d.doc_id}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
            <ClipboardCheck size={13} /> Review
          </button>
        )}
      </div>
      {d.record && (
        <div className="mb-2 ml-12 grid gap-1 text-[12.5px] text-text-2" data-record="">
          <p>{[d.record.interviewer, d.record.score ? `${d.record.score}/10` : '', d.record.recommendation].filter(Boolean).join(' · ')}</p>
          {d.record.comments && <p className="border-l-2 border-border pl-3 italic leading-5">{d.record.comments}</p>}
        </div>
      )}
      {d.items.length > 0 && (
        <ul className="mb-2 ml-12 grid gap-1" data-checklist="">
          {d.items.map((it) => (
            <li key={it.id || it.label} className="flex items-center gap-2 text-[12.5px]">
              <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full',
                it.done ? 'bg-tint-mint text-tint-fg-mint' : 'border border-dashed border-border-strong')}>
                {it.done && <Check size={10} />}
              </span>
              <span className={it.done ? 'text-text-1' : 'text-text-3'}>{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
