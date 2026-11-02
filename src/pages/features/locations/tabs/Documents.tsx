// Documents: DOCUMENT | TYPE | APPLIES TO.
// The company documents apply to all locations (from the houses slice), each current client's ISP applies to that…
import { Link } from 'react-router'
import { FileText, Link2, Loader2, Trash2, Upload } from 'lucide-react'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { cn } from '@/lib/utils'
import { documentsOf, houseDocuments, houseOwnDoc, type LocationDoc, type LocationDocuments, type PanelAsk } from '../locationModel'
import { readDocuments, readKey, useCan, useLocationDoc, useLocationRead, type LocationDocOpener, type ReadState } from '../useLocation'
import { ReadLine, SectionCard, linkCls } from '../LocationParts'

export default function Documents({ house, onAsk }: { house: HouseRow; onAsk?: (ask: PanelAsk) => void }) {
  const docs = useLocationRead(readKey('locationDocuments', house.code), () => readDocuments(house.code), documentsOf)
  const doc = useLocationDoc(house.code)
  const edits = useCan('locations.documents')
  return <DocumentsView house={house} docs={docs} doc={doc} onRetry={docs.reload} onAsk={edits ? onAsk : undefined} />
}

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const ACTION = 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2'

const openDoc = (doc: LocationDocOpener, d: LocationDoc) =>
  doc.open(d.fileId, { title: d.title, subtitle: `${d.type} · ${d.applies}`, icon: d.type === 'ISP' ? 'clipboard-list' : 'file-text' })

export function DocumentsView({ house, docs, doc, onRetry, onAsk }: {
  house: HouseRow
  docs: ReadState<LocationDocuments>
  doc: LocationDocOpener
  onRetry: () => void
  /** handed only to a viewer who makes the Documents edition: its buttons and removes open the panel */
  onAsk?: (ask: PanelAsk) => void
}) {
  const edits = !!onAsk
  const rows = houseDocuments(house, docs.data)
  return (
    <SectionCard title="Documents" extra={edits ? (
      <>
        <button type="button" className={ACTION} onClick={() => onAsk?.({ kind: 'doc-link' })} data-doc-link-open="">
          <Link2 size={14} /> Add from Drive link
        </button>
        <button type="button" className={ACTION} onClick={() => onAsk?.({ kind: 'doc-upload' })} data-doc-upload-open="">
          <Upload size={14} /> Upload a file
        </button>
      </>
    ) : undefined}>
      <ReadLine state={docs} what="the client ISPs and the house guidebook" onRetry={onRetry} />
      {docs.data?.why && <p className="mb-3 text-[12.5px] text-[var(--warning)]">{docs.data.why}</p>}
      <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[560px] border-collapse text-[13px]" data-documents="">
          <thead className="bg-surface-2/60">
            <tr>
              <th className={TH}>Document</th>
              <th className={TH}>Type</th>
              <th className={TH}>Applies to</th>
              {edits && <th className={TH}><span className="sr-only">Remove</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((d) => <DocRow key={d.key} d={d} doc={doc} onRemove={edits && houseOwnDoc(d) ? () => onAsk?.({ kind: 'doc-remove', id: d.fileId }) : undefined}
              removable={edits} />)}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

function DocRow({ d, doc, onRemove, removable }: { d: LocationDoc; doc: LocationDocOpener; onRemove?: () => void; removable: boolean }) {
  const busy = !!d.fileId && doc.opening === d.fileId
  return (
    <tr data-doc={d.key} aria-busy={busy || undefined}>
      <td className="px-3 py-3">
        {d.fileId ? (
          <button type="button" onClick={() => openDoc(doc, d)} disabled={busy} data-open-doc={d.fileId}
            className="inline-flex items-start gap-2 text-left font-medium text-primary hover:underline disabled:cursor-wait disabled:opacity-70">
            {busy ? <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin" /> : <FileText size={15} className="mt-0.5 shrink-0" />}
            {d.title}
            {busy && <span className="font-normal text-text-3">Opening…</span>}
          </button>
        ) : (
          <span className="inline-flex items-start gap-2 text-text-3">
            <FileText size={15} className="mt-0.5 shrink-0" /> {d.title}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-text-2">{d.type}</td>
      <td className={cn('px-3 py-3', d.appliesTo === 'none' ? 'text-text-3' : 'text-text-2')} data-applies={d.appliesTo}>
        {d.appliesTo === 'client' && d.clientId && d.clientHref ? (
          <Link to={d.clientHref} className={linkCls}>{d.applies}</Link>
        ) : d.applies}
      </td>
      {removable && (
        <td className="w-10 px-2 py-3 text-right">
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label={`Remove ${d.title}`} data-doc-remove-open={d.fileId}
              className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-danger">
              <Trash2 size={14} />
            </button>
          )}
        </td>
      )}
    </tr>
  )
}
