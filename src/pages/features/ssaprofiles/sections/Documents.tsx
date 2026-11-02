// Documents: every paper the platform holds that concerns this SSA — each client's ISP and the plan files the…
// A row with a file opens centred, large, in the platform's viewer; a row with none (a plan the plans folder holds…
import { ArrowRight, FileText, Loader2, Mail } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { PencilButton } from '@/pages/features/clientprofiles/ClientParts'
import { cn } from '@/lib/utils'
import { docLine, docOpens, documentsOf, type RosterRow, type SsaDoc, type SsaDocuments } from '../ssaModel'
import { readDocuments, readKey, useSsaDocs, useSsaRead, type ReadState, type SsaDocOpener } from '../useSsaRead'
import { EmptyNote, ReadLine, WhyLines } from '../SsaParts'

/** `onEdit`: a maker of the Documents edition opens an entry's edit, to change it or take it off the list. */
export default function DocumentsSection({ row, onEdit }: { row: RosterRow; onEdit?: (id: string) => void }) {
  const docs = useSsaRead(readKey('ssaProfileDocuments', row.key), () => readDocuments(row.key), documentsOf)
  const doc = useSsaDocs()
  return <DocumentsView row={row} docs={docs} doc={doc} onRetry={docs.reload} onEdit={onEdit} />
}

export function DocumentsView({ row, docs, doc, onRetry, onEdit }: {
  row: Pick<RosterRow, 'key' | 'name'>
  docs: ReadState<SsaDocuments>
  doc: SsaDocOpener
  onRetry: () => void
  onEdit?: (id: string) => void
}) {
  const d = docs.data
  return (
    <SectionCard title="Documents" sub={d ? `${d.docs.length} document${d.docs.length === 1 ? '' : 's'}` : undefined}>
      <div className="grid gap-3">
        <ReadLine state={docs} what="the documents" onRetry={onRetry} />
        {d && <WhyLines why={d.why} degraded={d.degraded} />}
        {d && d.docs.length === 0 && <EmptyNote>No document concerning {row.name} is in the places the platform reads.</EmptyNote>}
        {d && d.docs.length > 0 && (
          <ul className="divide-y divide-border" data-docs="">
            {d.docs.map((x) => <DocRow key={x.id} d={x} row={row} doc={doc} onEdit={onEdit} />)}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}

function DocRow({ d, row, doc, onEdit }: {
  d: SsaDoc
  row: Pick<RosterRow, 'key' | 'name'>
  doc: SsaDocOpener
  onEdit?: (id: string) => void
}) {
  const opens = docOpens(d)
  const busy = opens && doc.opening === `${row.key}|${d.file_id}`
  const Icon = d.kind === 'mail' ? Mail : FileText
  const body = (
    <>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full',
        opens ? 'bg-tint-lavender text-tint-fg-lavender' : 'bg-surface-2 text-text-3')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-text-1">{d.title}</span>
        <span className="mt-0.5 block text-[12px] text-text-3">{docLine(d)}</span>
      </span>
      {opens && (busy ? <span className="text-[12px] text-text-3">Opening…</span>
        : <ArrowRight size={15} className="shrink-0 text-text-3" data-arrow="" />)}
    </>
  )
  return (
    <li data-doc={d.id} data-kind={d.kind} className="flex items-center gap-2">
      {opens ? (
        <button type="button" onClick={() => doc.open(row.key, d.file_id, d.title, `${row.name} · ${docLine(d)}`)} disabled={busy}
          aria-busy={busy || undefined} data-open-doc={d.file_id}
          className="flex min-w-0 flex-1 items-center gap-3 py-3.5 text-left transition-colors hover:bg-surface-2/60 disabled:cursor-wait">
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-3.5">{body}</div>
      )}
      {onEdit && <div className="shrink-0" data-edit-doc-open={d.id}><PencilButton label="Edit document" onClick={() => onEdit(d.id)} /></div>}
    </li>
  )
}
