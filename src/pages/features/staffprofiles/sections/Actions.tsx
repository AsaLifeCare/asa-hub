// Actions: what this person still owes the team — expired, expiring and missing courses and papers, a running Med…
// STATUS | ITEM | FLOW | PHASE and the row's button: a document or a certificate opens centred in the platform's…
import { useState } from 'react'
import { ArrowRight, Loader2, Upload } from 'lucide-react'
import SearchInput from '@/components/shared/SearchInput'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import {
  ACTION_STATUS_META, actionButton, actionsOf, dateWords, filterActions, mayAsk, type RosterRow, type StaffActionItem,
  type StaffActions, type StaffAsk,
} from '../staffModel'
import { readActions, readKey, useStaffDoc, useStaffRead, type ReadState, type StaffDocOpener } from '../useStaffRead'
import { EmptyNote, Pill, ReadLine, WhyNote } from '../StaffParts'
import { useStaffViewer } from '../staffViewer'

export default function ActionsSection({ row, onAsk }: { row: RosterRow; onAsk: (ask: StaffAsk) => void }) {
  const actions = useStaffRead(readKey('staffProfileActions', row.key), () => readActions(row.key), actionsOf)
  const doc = useStaffDoc(row.key)
  const [query, setQuery] = useState('')
  return <ActionsView name={row.name} actions={actions} doc={doc} query={query} onQuery={setQuery} onAsk={onAsk} onRetry={actions.reload} />
}

const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

export function ActionsView({ name, actions, doc, query, onQuery, onAsk, onRetry }: {
  name: string
  actions: ReadState<StaffActions>
  doc: StaffDocOpener
  query: string
  onQuery: (q: string) => void
  onAsk: (ask: StaffAsk) => void
  onRetry: () => void
}) {
  const a = actions.data
  const shown = a ? filterActions(a.items, query) : []
  return (
    <SectionCard title="Actions" sub="What this person still owes the team.">
      <div className="grid gap-3">
        <ReadLine state={actions} what="the pendencies" onRetry={onRetry} />
        {a && <WhyNote why={a.why} degraded={a.degraded} />}
        {a && a.items.length === 0 && <EmptyNote>Nothing is pending for {name}.</EmptyNote>}
        {a && a.items.length > 0 && (
          <>
            <SearchInput value={query} onChange={onQuery} placeholder="Search pendencies…" className="h-10 rounded-[12px]" />
            {shown.length === 0 ? <EmptyNote>Nothing here matches the search.</EmptyNote> : (
              <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border">
                <table className="w-full min-w-[720px] border-collapse text-[13px]" data-actions-table="">
                  <thead className="border-b border-border bg-surface-2/50">
                    <tr>
                      <th className={TH}>Status</th>
                      <th className={TH}>Item</th>
                      <th className={TH}>Flow</th>
                      <th className={TH}>Phase</th>
                      <th className={TH}><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {shown.map((i) => <ActionRow key={i.id} item={i} name={name} doc={doc} onAsk={onAsk} />)}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </SectionCard>
  )
}

const ROW_BTN = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-wait'

function ActionRow({ item, name, doc, onAsk }: { item: StaffActionItem; name: string; doc: StaffDocOpener; onAsk: (ask: StaffAsk) => void }) {
  const viewer = useStaffViewer()
  const { writes } = viewer
  const label = item.action.kind === 'assign_training' && !writes ? '' : actionButton(item)
  // a pendency a certificate answers: the paper is filed here, read for its date, and the pendency clears once confirmed
  const files = !!item.reqId && item.status !== 'in_review' && mayAsk(viewer, 'filedoc', '')
  const busy = item.action.kind === 'doc' && doc.opening === item.action.docId
  const press = () => {
    if (item.action.kind === 'doc') doc.open(item.action.docId, { title: item.item, subtitle: `${name} · ${item.flow}` })
    else if (item.action.kind === 'assign_training') onAsk({ kind: 'assign', house: item.action.house })
  }
  return (
    <tr data-action-row={item.id} data-status={item.status}>
      <td className="px-4 py-3.5 align-middle"><Pill meta={ACTION_STATUS_META[item.status]} /></td>
      <td className="px-4 py-3.5 align-middle">
        <p className="font-medium text-text-1">{item.item}</p>
        {item.date && <p className="text-[12px] text-text-3">{dateWords(item.date) || item.date}</p>}
      </td>
      <td className="px-4 py-3.5 align-middle text-text-2">{item.flow || '—'}</td>
      <td className="px-4 py-3.5 align-middle text-text-2">{item.phase || '—'}</td>
      <td className="px-4 py-3.5 text-right align-middle">
        {label || files ? (
          <span className="inline-flex flex-wrap justify-end gap-1.5">
            {files && (
              <button type="button" onClick={() => onAsk({ kind: 'filedoc', course: item.reqId })} data-row-action="certificate"
                className={ROW_BTN}>
                <Upload size={13} /> Add certificate
              </button>
            )}
            {label && (
              <button type="button" onClick={press} disabled={busy} data-row-action={item.action.kind} className={ROW_BTN}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                {label} <ArrowRight size={13} />
              </button>
            )}
          </span>
        ) : <span className="text-text-3">—</span>}
      </td>
    </tr>
  )
}
