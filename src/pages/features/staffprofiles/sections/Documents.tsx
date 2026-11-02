// Documents: every paper the platform holds for this person — the Drive folder, the forms and their archive, the…
// One table: View (a row with a file opens centred, large, in the platform's viewer), Doc Name, Status, Upload Date and
// Upload (the row's paper filed under its title).
import { Eye, Loader2, Upload } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { useStaffDocCountsHidden } from '@/lib/stamps'
import { cn } from '@/lib/utils'
import {
  DOC_STATUS_META, dateWords, docKind, docLine, docOpens, documentsOf, mayAsk, type RosterRow, type StaffAsk, type StaffDoc,
  type StaffDocuments,
} from '../staffModel'
import { readDocuments, readKey, useStaffDoc, useStaffRead, type ReadState, type StaffDocOpener } from '../useStaffRead'
import { EmptyNote, Pill, ReadLine, WhyNote } from '../StaffParts'
import { useStaffViewer } from '../staffViewer'

export default function DocumentsSection({ row, onAsk }: { row: RosterRow; onAsk?: (ask: StaffAsk) => void }) {
  const docs = useStaffRead(readKey('staffProfileDocuments', row.key), () => readDocuments(row.key), documentsOf)
  const doc = useStaffDoc(row.key)
  const uploads = mayAsk(useStaffViewer(), 'docupload', row.key)
  return (
    <DocumentsView name={row.name} docs={docs} doc={doc} onRetry={docs.reload}
      onUpload={uploads && onAsk ? (d) => onAsk({ kind: 'docupload', doc: d.title }) : undefined} />
  )
}

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const ICON_BTN = 'grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:cursor-wait'

export function DocumentsView({ name, docs, doc, onRetry, onUpload }: {
  name: string
  docs: ReadState<StaffDocuments>
  doc: StaffDocOpener
  onRetry: () => void
  /** the row's Upload, for a viewer who files this person's papers */
  onUpload?: (d: StaffDoc) => void
}) {
  const d = docs.data
  // the master's own session, or everyone while Settings › My Work shows it
  const countsHidden = useStaffDocCountsHidden()
  const counts = d && !countsHidden ? [
    d.counts.total !== null ? `${d.counts.total} document${d.counts.total === 1 ? '' : 's'}` : '',
    d.counts.with_file !== null ? `${d.counts.with_file} with a file` : '',
    d.counts.missing ? `${d.counts.missing} missing` : '',
  ].filter(Boolean).join(' · ') : ''
  return (
    <SectionCard title="Documents" sub={counts || undefined}>
      <div className="grid gap-3">
        <ReadLine state={docs} what="the documents" onRetry={onRetry} />
        {d && <WhyNote why={d.why} degraded={d.degraded} />}
        {d && d.docs.length === 0 && <EmptyNote>No document is on file for {name} in the places the platform reads.</EmptyNote>}
        {d && d.docs.length > 0 && (
          <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[600px] border-collapse text-[13px]" data-docs="">
              <thead className="bg-surface-2/60">
                <tr>
                  <th className={cn(TH, 'w-14')}>View</th>
                  <th className={TH}>Doc Name</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Upload Date</th>
                  <th className={cn(TH, 'w-16')}>Upload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.docs.map((x) => <DocRow key={x.id} d={x} name={name} doc={doc} onUpload={onUpload} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function DocRow({ d, name, doc, onUpload }: { d: StaffDoc; name: string; doc: StaffDocOpener; onUpload?: (d: StaffDoc) => void }) {
  const opens = docOpens(d)
  const busy = opens && doc.opening === d.fileId
  const kind = docKind(d)
  return (
    <tr data-doc={d.id} data-status={d.status} className="hover:bg-surface-2/60">
      <td className="px-3 py-2.5">
        {opens && (
          <button type="button" onClick={() => doc.open(d.fileId, { title: d.title, subtitle: `${name} · ${docLine(d)}` })}
            disabled={busy} aria-busy={busy || undefined} data-open-doc={d.fileId} aria-label={`View ${d.title}`} className={ICON_BTN}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
          </button>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className="block font-medium text-text-1">{d.title}</span>
        {kind && <span className="mt-0.5 block text-[12px] text-text-3">{kind}</span>}
      </td>
      <td className="px-3 py-2.5"><Pill meta={DOC_STATUS_META[d.status]} /></td>
      <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{dateWords(d.date) || '—'}</td>
      <td className="px-3 py-2.5">
        {onUpload && (
          <button type="button" onClick={() => onUpload(d)} data-upload-doc={d.id} aria-label={`Upload ${d.title}`} className={ICON_BTN}>
            <Upload size={15} />
          </button>
        )}
      </td>
    </tr>
  )
}
