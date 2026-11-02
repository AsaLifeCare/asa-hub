// Documents: the guardianship papers of this family member's clients and their plans — the ISP and the plan files…
// A row with a file opens centred, large, in the platform's viewer; a row with none has no arrow.
import { ArrowRight, FileText, Loader2, Plus } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { PencilButton } from '@/pages/features/clientprofiles/ClientParts'
import { useFamilyDetailsHidden } from '@/lib/stamps'
import { cn } from '@/lib/utils'
import { docLine, docOpens, documentsOf, type FamilyDoc, type FamilyDocuments, type RosterRow } from '../familyModel'
import { readDocuments, readKey, useFamilyDocs, useFamilyRead, type FamilyDocOpener, type ReadState } from '../useFamilyRead'
import { EmptyNote, ReadLine, WhyLines } from '../FamilyParts'

export default function DocumentsSection({ row, onEdit, onAdd }: { row: RosterRow; onEdit?: () => void; onAdd?: () => void }) {
  const docs = useFamilyRead(readKey('familyProfileDocuments', row.key), () => readDocuments(row.key), documentsOf)
  const doc = useFamilyDocs()
  return <DocumentsView row={row} docs={docs} doc={doc} onRetry={docs.reload} onEdit={onEdit} onAdd={onAdd} />
}

/** The section's "+": a paper added in the right panel (an upload filed in Drive, or a Drive link). */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} data-add-doc=""
      className="grid h-8 w-8 place-items-center rounded-full border border-primary bg-surface text-primary transition-colors hover:bg-primary-soft">
      <Plus size={15} />
    </button>
  )
}

export function DocumentsView({ row, docs, doc, onRetry, onEdit, onAdd }: {
  row: Pick<RosterRow, 'key' | 'name'>
  docs: ReadState<FamilyDocuments>
  doc: FamilyDocOpener
  onRetry: () => void
  /** the guardianship papers' links, in the details panel: the master's, or a holder's of the profile edition */
  onEdit?: () => void
  /** a paper added: the master's, a director's or a badge above, or a holder's of the documents edition */
  onAdd?: () => void
}) {
  const d = docs.data
  // the count and the papers' pencil: the master's, or everyone's while Settings › My Work shows them
  const bare = useFamilyDetailsHidden()
  const edits = !!d && !!onEdit && !bare
  const extra = (onAdd || edits) ? (
    <div className="flex items-center gap-2">
      {onAdd && <AddButton label="Add document" onClick={onAdd} />}
      {edits && <PencilButton label="Edit guardianship papers" onClick={onEdit} />}
    </div>
  ) : null
  return (
    <SectionCard title="Documents" sub={d && !bare ? `${d.docs.length} document${d.docs.length === 1 ? '' : 's'}` : undefined}
      extra={extra}>
      <div className="grid gap-3">
        <ReadLine state={docs} what="the documents" onRetry={onRetry} />
        {d && <WhyLines why={d.why} degraded={d.degraded} />}
        {d && d.docs.length === 0 && <EmptyNote>No document concerning {row.name} is in the places the platform reads.</EmptyNote>}
        {d && d.docs.length > 0 && (
          <ul className="divide-y divide-border" data-docs="">
            {d.docs.map((x) => <DocRow key={x.id} d={x} row={row} doc={doc} />)}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}

function DocRow({ d, row, doc }: { d: FamilyDoc; row: Pick<RosterRow, 'key' | 'name'>; doc: FamilyDocOpener }) {
  const opens = docOpens(d)
  const busy = opens && doc.opening === `${row.key}|${d.file_id}`
  const body = (
    <>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full',
        opens ? 'bg-tint-peach text-tint-fg-peach' : 'bg-surface-2 text-text-3')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
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
    <li data-doc={d.id} data-kind={d.kind}>
      {opens ? (
        <button type="button" onClick={() => doc.open(row.key, d.file_id, d.title, `${row.name} · ${docLine(d)}`)} disabled={busy}
          aria-busy={busy || undefined} data-open-doc={d.file_id}
          className="flex w-full items-center gap-3 py-3.5 text-left transition-colors hover:bg-surface-2/60 disabled:cursor-wait">
          {body}
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 py-3.5">{body}</div>
      )}
    </li>
  )
}
