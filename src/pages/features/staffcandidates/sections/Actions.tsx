// Actions: the candidate's real hiring steps — the Hiring board's own checklist, from the application to the…
// STATUS | ACTION | OWNER | DUE | NEXT STEP, and on each row Mark complete and Add note (the master's and the editions'), then — on a…
import { useState } from 'react'
import { AlertTriangle, Check, Plus } from 'lucide-react'
import SearchInput from '@/components/shared/SearchInput'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { cn } from '@/lib/utils'
import {
  actionStatusMeta, actionsOf, dateWords, dueMeta, filterActions, mayNote, mayPress, nextStepWords, stageLabel,
  type ActionItem, type CandidateActions, type CandidateAsk, type Reach, type RosterRow,
} from '../candidateModel'
import { readActions, readKey, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EmptyNote, Pill, ReadLine, TH, WhyLines } from '../CandidateParts'

export default function ActionsSection({ row, onAsk, canWrite = false, reach }: {
  row: RosterRow
  onAsk: (ask: CandidateAsk) => void
  canWrite?: boolean
  reach?: Reach
}) {
  const actions = useCandidateRead(readKey('candidateProfileActions', row.key), () => readActions(row.key), actionsOf)
  const [query, setQuery] = useState('')
  return <ActionsView name={row.name} actions={actions} query={query} onQuery={setQuery} onAsk={onAsk} onRetry={actions.reload}
    canWrite={canWrite} reach={reach} />
}

const BTN = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

/** The row buttons this reader is offered: Mark complete and Add note by edition, Add document the master's. */
type RowReach = { press: boolean; note: boolean; paper: boolean }

export function ActionsView({ name, actions, query, onQuery, onAsk, onRetry, canWrite = false, reach }: {
  name: string
  actions: ReadState<CandidateActions>
  query: string
  onQuery: (q: string) => void
  onAsk: (ask: CandidateAsk) => void
  onRetry: () => void
  /** Mark complete and Add note are the master's */
  canWrite?: boolean
  /** what this reader may do, editions included; absent, `canWrite` opens every row button */
  reach?: Reach
}) {
  const can: RowReach = reach
    ? { press: mayPress(reach), note: mayNote(reach), paper: reach.write && !reach.narrow }
    : { press: canWrite, note: canWrite, paper: canWrite }
  const buttons = can.press || can.note || can.paper
  const a = actions.data
  const shown = a ? filterActions(a.items, query) : []
  return (
    <SectionCard title="Actions" sub="The hiring steps, as the Hiring board holds them. A change here is a change there.">
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
        {a && a.items.length === 0 && <EmptyNote>No hiring step is on {name}&rsquo;s record.</EmptyNote>}
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
                    {shown.map((x) => <ActionRow key={x.id} x={x} onAsk={onAsk} can={can} />)}
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

function ActionRow({ x, onAsk, can }: { x: ActionItem; onAsk: (ask: CandidateAsk) => void; can: RowReach }) {
  const due = x.open && x.due ? dueMeta(x.due) : null
  const next = nextStepWords(x)
  return (
    <tr data-action-row={x.id} data-status={x.status || 'unknown'} className={cn(x.is_next && 'bg-primary-soft/30')}>
      <td className="px-4 py-3.5 align-middle"><Pill meta={actionStatusMeta(x.status)} /></td>
      <td className="px-4 py-3.5 align-middle">
        <p className="font-medium text-text-1">{x.label}</p>
        <p className="text-[12px] text-text-3">{[stageLabel(x.stage), x.is_next ? 'Next step' : ''].filter(Boolean).join(' · ')}</p>
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
      <td className={cn('px-4 py-3.5 align-middle', x.door ? 'text-text-1' : 'text-text-3')} data-next={x.door ? x.door.action : ''}>
        {next || '—'}
      </td>
      {(can.press || can.note || can.paper) && (
        <td className="px-4 py-3.5 align-middle">
          <span className="flex justify-end gap-2">
            {can.press && (
              <button type="button" disabled={!x.open} title={x.open ? undefined : 'Already complete'}
                onClick={() => onAsk({ kind: 'complete', item: x.id })} data-row-action="complete" className={BTN}>
                <Check size={13} /> Mark complete
              </button>
            )}
            {can.note && (
              <button type="button" onClick={() => onAsk({ kind: 'note', about: x.id })} data-row-action="note" className={BTN}>
                <Plus size={13} /> Add note
              </button>
            )}
            {can.paper && x.paper && (
              <button type="button" onClick={() => onAsk({ kind: 'document', item: x.id })} data-row-action="document"
                title={x.paper.choices.length ? 'The New Hire packet is signed: the new hire\'s documents go into Onboarding Documents'
                  : `Read by the decoder, then filed in ${x.paper.where}`} className={BTN}>
                <Plus size={13} /> Add document
              </button>
            )}
          </span>
        </td>
      )}
    </tr>
  )
}
