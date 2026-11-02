// Actions: the intake with the family — referral review, discovery & assessment, service fit & placement — each…
// STATUS | ACTION | OWNER | DUE | NEXT STEP, and on each row Mark complete (Reopen once complete) and Add note, all…
import { useState } from 'react'
import { AlertTriangle, Check, Plus, RotateCcw } from 'lucide-react'
import SearchInput from '@/components/shared/SearchInput'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { cn } from '@/lib/utils'
import {
  actionStatusMeta, actionsOf, dateWords, doorWords, dueMeta, mayNote, mayPress, nextStepWords, reachOf, stageLabel,
  type ActionItem, type CandidateActions, type CandidateAsk, type CandidateEdition, type RosterRow,
} from '../candidateModel'
import { readActions, readKey, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EmptyNote, Pill, ReadLine, TH, WhyLines } from '../CandidateParts'

export default function ActionsSection({ row, onAsk, canWrite = false, editions = [] }: {
  row: RosterRow
  onAsk: (ask: CandidateAsk) => void
  canWrite?: boolean
  editions?: readonly CandidateEdition[]
}) {
  const actions = useCandidateRead(readKey('clientCandidateActions', row.key), () => readActions(row.key), actionsOf)
  const [query, setQuery] = useState('')
  return <ActionsView name={row.name} actions={actions} query={query} onQuery={setQuery} onAsk={onAsk} onRetry={actions.reload}
    canWrite={canWrite} editions={editions} />
}

export function filterActions(items: ActionItem[], query: string): ActionItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((x) => [x.label, x.title, x.owner, nextStepWords(x), x.status.replace(/_/g, ' '), stageLabel(x.stage)]
    .some((v) => v.toLowerCase().includes(q)))
}

const BTN = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

export function ActionsView({ name, actions, query, onQuery, onAsk, onRetry, canWrite = false, editions = [] }: {
  name: string
  actions: ReadState<CandidateActions>
  query: string
  onQuery: (q: string) => void
  onAsk: (ask: CandidateAsk) => void
  onRetry: () => void
  /** Mark complete, Reopen and Add note are the master's */
  canWrite?: boolean
  /** and whom the pipeline and notes editions name */
  editions?: readonly CandidateEdition[]
}) {
  const a = actions.data
  const shown = a ? filterActions(a.items, query) : []
  const reach = reachOf(canWrite, editions)
  const press = { step: mayPress(reach), note: mayNote(reach) }
  const buttons = press.step || press.note
  return (
    <SectionCard title="Actions" sub="The intake with the family, as the referral's stage in Potential Clients holds it. A change here is a change there.">
      <div className="grid gap-3">
        <ReadLine state={actions} what="the actions" onRetry={onRetry} />
        {a && <WhyLines why={a.why} degraded={a.degraded} />}
        {a && a.attention.length > 0 && (
          <ul className="grid gap-1" data-attention="">
            {a.attention.map((w) => (
              <li key={w} className="flex items-start gap-2 rounded-md bg-tint-amber px-3 py-2 text-[12.5px] leading-5 text-tint-fg-amber">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
        {a && a.items.length === 0 && <EmptyNote>No intake step is on {name}&rsquo;s referral.</EmptyNote>}
        {a && a.items.length > 0 && (
          <>
            <SearchInput value={query} onChange={onQuery} placeholder="Search actions…" className="h-10 rounded-[12px]" />
            {shown.length === 0 ? <EmptyNote>Nothing here matches the search.</EmptyNote> : (
              <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border">
                <table className="w-full min-w-[860px] border-collapse text-[13px]" data-actions-table="">
                  <thead className="border-b border-border bg-surface-2/50">
                    <tr>
                      <th className={TH}>Status</th>
                      <th className={TH}>Action</th>
                      <th className={TH}>Owner</th>
                      <th className={TH}>Due</th>
                      <th className={TH}>Next step</th>
                      {buttons && <th className={TH}><span className="sr-only">Buttons</span></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {shown.map((x) => <ActionRow key={x.id} x={x} onAsk={onAsk} press={press} />)}
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

function ActionRow({ x, onAsk, press }: { x: ActionItem; onAsk: (ask: CandidateAsk) => void; press: { step: boolean; note: boolean } }) {
  const due = x.open && x.due ? dueMeta(x.due) : null
  const next = nextStepWords(x)
  const moves = x.open && x.next_step && x.door ? doorWords(x.door) : ''
  return (
    <tr data-action-row={x.id} data-status={x.status || 'unknown'} className={cn(x.is_next && 'bg-primary-soft/30')}>
      <td className="px-4 py-3.5 align-middle"><Pill meta={actionStatusMeta(x.status)} /></td>
      <td className="px-4 py-3.5 align-middle">
        <p className="font-medium text-text-1">{x.label}</p>
        <p className="text-[12px] text-text-3">{[x.title, stageLabel(x.stage), x.is_next ? 'Next step' : ''].filter(Boolean).join(' · ')}</p>
      </td>
      <td className="px-4 py-3.5 align-middle text-text-2">{x.owner || '—'}</td>
      <td className="px-4 py-3.5 align-middle">
        {x.due ? (
          <span className="grid gap-1">
            <span className="text-text-2">{dateWords(x.due)}</span>
            {due && due.tint !== 'blue' && <Pill meta={due} className="w-fit" />}
          </span>
        ) : <span className="text-text-3">—</span>}
      </td>
      <td className={cn('px-4 py-3.5 align-middle', x.door || x.next_step ? 'text-text-1' : 'text-text-3')} data-next={x.door ? 'write' : ''}>
        {next || '—'}
        {moves && <span className="mt-0.5 block text-[12px] text-text-3">{moves}</span>}
      </td>
      {(press.step || press.note) && <td className="px-4 py-3.5 align-middle">
        <span className="flex justify-end gap-2">
          {press.step && (!x.open && x.reopen ? (
            <button type="button" onClick={() => onAsk({ kind: 'reopen', item: x.id })} data-row-action="reopen" className={BTN}>
              <RotateCcw size={13} /> Reopen
            </button>
          ) : (
            <button type="button" disabled={!x.open} title={x.open ? undefined : x.why || 'Update stage moves the referral first'}
              onClick={() => onAsk({ kind: 'complete', item: x.id })} data-row-action="complete" className={BTN}>
              <Check size={13} /> Mark complete
            </button>
          ))}
          {press.note && (
            <button type="button" onClick={() => onAsk({ kind: 'note', about: x.id })} data-row-action="note" className={BTN}>
              <Plus size={13} /> Add note
            </button>
          )}
        </span>
      </td>}
    </tr>
  )
}
