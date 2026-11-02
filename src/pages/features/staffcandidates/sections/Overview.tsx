// Overview: the candidate at a glance (position, stage, location, recruiter, source, applied), how to reach them, a…
// A narrowed reader (a client, family, an SSA) gets the basic card alone: name, photo, position and stage.
import type { ReactNode } from 'react'
import { ArrowRight, ListOrdered, Pencil, Plus, Users } from 'lucide-react'
import { Pair, SectionCard } from '@/pages/features/locations/LocationParts'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import {
  ARCHIVED_META, actionsOf, activityMeta, dateWords, docsWords, dueMeta, knownDetails, mailHref, mayEdit, mayNote, mayPress,
  nextStepFrom, openCount, overviewOf, ownerDue, stageMeta, telHref, type CandidateActions, type CandidateAsk,
  type CandidateOverview, type CandidateTab, type Reach, type RosterRow,
} from '../candidateModel'
import { readActions, readKey, readOverview, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EmptyNote, None, Pill, ReadLine, WhyLines, linkCls } from '../CandidateParts'

export default function OverviewSection({ row, onAsk, onTab, canWrite = false, narrow = false, reach }: {
  row: RosterRow
  onAsk: (ask: CandidateAsk) => void
  onTab: (tab: CandidateTab) => void
  canWrite?: boolean
  narrow?: boolean
  /** what this reader may do, editions included */
  reach?: Reach
}) {
  const overview = useCandidateRead(readKey('candidateProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  const actions = useCandidateRead(narrow ? null : readKey('candidateProfileActions', row.key), () => readActions(row.key), actionsOf)
  if (narrow) return <NarrowOverviewView row={row} overview={overview} onRetry={overview.reload} onTab={onTab} />
  return <OverviewView row={row} overview={overview} actions={actions} onRetry={overview.reload} onAsk={onAsk} onTab={onTab}
    canWrite={canWrite} reach={reach} />
}

/** The basic card a narrowed reader is answered: position and stage, and the way to the meetings and the pipeline. */
export function NarrowOverviewView({ row, overview, onRetry, onTab }: {
  row: RosterRow
  overview: ReadState<CandidateOverview>
  onRetry: () => void
  onTab: (tab: CandidateTab) => void
}) {
  const o = overview.data
  const d = knownDetails(row, o)
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]" data-overview="narrow">
      <SectionCard title="At a glance">
        <ReadLine state={overview} what="the candidate" onRetry={onRetry} />
        <dl className="grid gap-x-6 sm:grid-cols-2" data-glance="">
          <Pair label="Position" last>{d.position || <None />}</Pair>
          <Pair label="Stage" last>{d.stage ? <Pill meta={stageMeta(d.stage)} /> : <None />}</Pair>
        </dl>
        {o && <div className="mt-3"><WhyLines why={o.why} degraded={o.degraded} /></div>}
      </SectionCard>
      <SectionCard title="More">
        <div className="grid gap-2">
          <button type="button" onClick={() => onTab('interviews')} className={LINK_BTN} data-view-interviews="">
            Interviews and meet-and-greets <ArrowRight size={13} />
          </button>
          <button type="button" onClick={() => onTab('pipeline')} className={LINK_BTN} data-quick="pipeline">
            View all candidates <ArrowRight size={13} />
          </button>
        </div>
      </SectionCard>
    </div>
  )
}

const LINK_BTN = cn(linkCls, 'inline-flex items-center gap-1 text-[13px] font-semibold')

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface-2/50 px-4 py-3" data-tile={label}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</p>
      <div className="mt-1 text-[15px] font-semibold text-text-1">{value}</div>
      {hint && <p className="mt-0.5 text-[11.5px] text-text-3">{hint}</p>}
    </div>
  )
}

export function OverviewView({ row, overview, actions, onRetry, onAsk, onTab, canWrite = false, reach }: {
  row: RosterRow
  overview: ReadState<CandidateOverview>
  actions: ReadState<CandidateActions>
  onRetry: () => void
  onAsk: (ask: CandidateAsk) => void
  onTab: (tab: CandidateTab) => void
  /** Add note and Update stage are the master's */
  canWrite?: boolean
  /** what this reader may do, editions included; absent, `canWrite` opens both quick actions */
  reach?: Reach
}) {
  const canNote = reach ? mayNote(reach) : canWrite
  const canPress = reach ? mayPress(reach) : canWrite
  const canEdit = !!reach && mayEdit(reach, 'information')
  const o = overview.data
  const d = knownDetails(row, o)
  const open = o?.open_actions ?? openCount(actions.data)
  const attention = o?.attention.length ? o.attention : actions.data?.attention ?? []
  const docs = o ? docsWords(o.docs_on_file, o.docs_total) : ''
  const next = nextStepFrom(row, o, actions.data)
  const due = next ? dueMeta(next.due) : null
  const quick = 'flex w-full items-center gap-2.5 rounded-[12px] border border-border px-3 py-2.5 text-left text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]" data-overview="">
      <div className="grid content-start gap-5">
        <SectionCard title="At a glance">
          <ReadLine state={overview} what="the candidate" onRetry={onRetry} />
          <dl className="grid gap-x-6 sm:grid-cols-2" data-glance="">
            <Pair label="Position">{d.position || <None />}</Pair>
            <Pair label="Stage">
              {d.archived ? <span className="flex flex-wrap items-center gap-2"><Pill meta={ARCHIVED_META} />{d.archived_reason}</span>
                : d.stage ? <Pill meta={stageMeta(d.stage)} /> : <None />}
            </Pair>
            <Pair label="Location">{d.location || <None />}</Pair>
            <Pair label="Recruiter">{d.recruiter || <None />}</Pair>
            <Pair label="Source" last>{d.source || <None />}</Pair>
            <Pair label="Applied" last>{dateWords(d.applied) || <None />}</Pair>
          </dl>
          {o && <div className="mt-3"><WhyLines why={o.why} degraded={o.degraded} /></div>}
        </SectionCard>

        <SectionCard title="Candidate overview">
          <div className="grid gap-4">
            {o?.summary ? <p className="text-[13px] leading-[1.6] text-text-2" data-summary="">{o.summary}</p>
              : o ? <p className="text-[13px] text-text-3">No summary is on the hiring record yet.</p> : null}
            {attention.length > 0 && (
              <ul className="grid gap-1" data-attention="">
                {attention.map((w) => (
                  <li key={w} className="rounded-md bg-tint-amber px-3 py-1.5 text-[12.5px] leading-5 text-tint-fg-amber">{w}</li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Stage" value={d.status_label || stageMeta(d.stage).label} />
              <Tile label="Open actions" value={open ?? '—'} />
              <Tile label="Documents on file" value={docs || '—'} />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Recent activity"
          extra={<button type="button" onClick={() => onTab('activity')} className={LINK_BTN}>View activity log <ArrowRight size={13} /></button>}>
          {!o && overview.status !== 'failed' && <ReadLine state={overview} what="the activity" onRetry={onRetry} />}
          {o && o.recent.length === 0 && <EmptyNote>Nothing is on {row.name}&rsquo;s hiring record yet.</EmptyNote>}
          {o && o.recent.length > 0 && (
            <ul className="divide-y divide-border" data-recent="">
              {o.recent.slice(0, 5).map((x) => (
                <li key={x.id} className="py-2.5">
                  <p className="text-[13px] font-medium text-text-1">{x.title || x.body}</p>
                  {x.title && x.body && <p className="clamp-1 mt-0.5 text-[12.5px] text-text-2">{x.body}</p>}
                  <p className="mt-0.5 text-[11.5px] text-text-3">{activityMeta(x)}</p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid content-start gap-5">
        <SectionCard title="Contact">
          <dl data-contact="">
            <Pair label="Phone">{d.phone ? <a href={telHref(d.phone)} className={linkCls}>{formatPhoneDisplay(d.phone)}</a> : <None />}</Pair>
            <Pair label="E-mail" last>{d.email ? <a href={mailHref(d.email)} className={cn(linkCls, 'break-all')}>{d.email}</a> : <None />}</Pair>
          </dl>
          <button type="button" onClick={() => onTab('information')} className={cn(LINK_BTN, 'mt-3')} data-view-information="">
            View information <ArrowRight size={13} />
          </button>
        </SectionCard>

        <SectionCard title="Next step">
          {!next && (actions.status === 'loading' || overview.status === 'loading')
            ? <ReadLine state={actions} what="the next step" onRetry={onRetry} />
            : !next ? <p className="text-[13px] text-text-3" data-no-next="">Nothing is open for {row.name}.</p> : (
              <div className="grid gap-2" data-next-step={next.item || next.action}>
                {due && <Pill meta={due} className="w-fit" />}
                <p className="text-[14px] font-semibold text-text-1">{next.action}</p>
                {ownerDue(next.owner, next.due) && <p className="text-[12.5px] text-text-3">{ownerDue(next.owner, next.due)}</p>}
              </div>
            )}
          <button type="button" onClick={() => onTab('actions')} className={cn(LINK_BTN, 'mt-3')} data-view-actions="">
            View actions <ArrowRight size={13} />
          </button>
        </SectionCard>

        <SectionCard title="Quick actions">
          <div className="grid gap-2" data-quick-actions="">
            {canNote && (
              <button type="button" onClick={() => onAsk({ kind: 'note', about: '' })} className={quick} data-quick="note">
                <Plus size={15} className="text-text-3" /> Add note
              </button>
            )}
            {canPress && (
              <button type="button" onClick={() => onAsk({ kind: 'stage' })} className={quick} data-quick="stage">
                <ListOrdered size={15} className="text-text-3" /> Update stage
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={() => onAsk({ kind: 'edit', section: 'information' })} data-quick="edit"
                aria-label="Edit information" title="Edit information"
                className="grid h-9 w-9 place-items-center rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1">
                <Pencil size={15} />
              </button>
            )}
            <button type="button" onClick={() => onTab('pipeline')} className={quick} data-quick="pipeline">
              <Users size={15} className="text-text-3" /> View all candidates
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
