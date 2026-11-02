// Overview: the referral at a glance (service requested, stage, location, intake coordinator, source, referred)…
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ListOrdered, Pencil, Plus, Users } from 'lucide-react'
import { Pair, SectionCard } from '@/pages/features/locations/LocationParts'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { RANK_MAX } from '@/lib/referralAnalysis'
import { cn } from '@/lib/utils'
import { useReferralAnalysis } from '@/pages/features/potclients/useReferralAnalysis'
import {
  actionsOf, activityMeta, convertedHref, dateWords, docsWords, dueMeta, knownDetails, mailHref, mayEdit, mayNote, mayPress,
  openCount, overviewOf, ownerDue, ratingMeta, reachOf, stageMeta, standingRead, telHref, windowMeta, type ActionItem,
  type CandidateActions, type CandidateAsk, type CandidateEdition, type CandidateOverview, type CandidateTab, type NextStep,
  type RosterRow, type StandingRead,
} from '../candidateModel'
import { readActions, readKey, readOverview, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EmptyNote, None, Pill, ReadLine, WhyLines, linkCls } from '../CandidateParts'

export default function OverviewSection({ row, onAsk, onTab, canWrite = false, editions = [] }: {
  row: RosterRow
  onAsk: (ask: CandidateAsk) => void
  onTab: (tab: CandidateTab) => void
  canWrite?: boolean
  editions?: readonly CandidateEdition[]
}) {
  const overview = useCandidateRead(readKey('clientCandidateOverview', row.key), () => readOverview(row.key), overviewOf)
  const actions = useCandidateRead(readKey('clientCandidateActions', row.key), () => readActions(row.key), actionsOf)
  const referrals = useReferralAnalysis()
  return <OverviewView row={row} overview={overview} actions={actions} standing={standingRead(referrals.read, row.key)}
    onRetry={overview.reload} onAsk={onAsk} onTab={onTab} canWrite={canWrite} editions={editions} />
}

/** The next step: the overview's own, else the actions' next, else the one written on the referral. */
export function nextStepFrom(row: RosterRow, o: CandidateOverview | null, a: CandidateActions | null): NextStep | null {
  if (o?.next_step) return o.next_step
  const next: ActionItem | null = a?.next ?? null
  if (next) return { item: next.id, action: next.label, owner: next.owner, due: next.due, status: next.status, next_step: next.next_step }
  return row.next_step ? { item: '', action: row.next_step, owner: row.owner, due: '', status: '', next_step: '' } : null
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

export function OverviewView({ row, overview, actions, standing = { state: 'loading', standing: null }, onRetry, onAsk, onTab,
  canWrite = false, editions = [] }: {
  row: RosterRow
  overview: ReadState<CandidateOverview>
  actions: ReadState<CandidateActions>
  standing?: StandingRead
  onRetry: () => void
  onAsk: (ask: CandidateAsk) => void
  onTab: (tab: CandidateTab) => void
  /** Add note and Update stage are the master's */
  canWrite?: boolean
  /** and whom the editions name; Edit information is Python's own door */
  editions?: readonly CandidateEdition[]
}) {
  const reach = reachOf(canWrite, editions)
  const o = overview.data
  const d = knownDetails(row, o)
  const rating = ratingMeta(o?.rating || d.rating)
  const s = standing.standing
  const unranked = standing.state === 'loading' ? 'Reading…' : standing.state === 'failed' ? 'Unknown' : 'Not ranked'
  const open = o?.open_actions ?? openCount(actions.data)
  const attention = o?.attention.length ? o.attention : actions.data?.attention ?? []
  const docs = o ? docsWords(o.docs_on_file, o.docs_total) : ''
  const next = nextStepFrom(row, o, actions.data)
  const due = next ? dueMeta(next.due) : null
  const closes = windowMeta(d.expires)
  const quick = 'flex w-full items-center gap-2.5 rounded-[12px] border border-border px-3 py-2.5 text-left text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]" data-overview="">
      <div className="grid content-start gap-5">
        <SectionCard title="At a glance">
          <ReadLine state={overview} what="the referral" onRetry={onRetry} />
          <dl className="grid gap-x-6 sm:grid-cols-2" data-glance="">
            <Pair label="Service requested"><span className="clamp-3 block">{d.service || <None />}</span></Pair>
            <Pair label="Stage">{d.stage ? <Pill meta={stageMeta(d.stage)} /> : <None />}</Pair>
            <Pair label="Location / county">{d.location || <None />}</Pair>
            <Pair label="Intake coordinator">{d.owner || <None />}</Pair>
            <Pair label="Source" last>{d.source || <None />}</Pair>
            <Pair label="Referred" last>{dateWords(d.referred) || <None />}</Pair>
          </dl>
          {o && <div className="mt-3"><WhyLines why={o.why} degraded={o.degraded} /></div>}
        </SectionCard>

        <SectionCard title="Referral overview"
          extra={closes ? <Pill meta={closes} /> : undefined}>
          <div className="grid gap-4">
            {rating && <Pill meta={rating} className="w-fit" />}
            {o?.summary ? <p className="whitespace-pre-line text-[13px] leading-[1.6] text-text-2" data-summary="">{o.summary}</p>
              : o ? <p className="text-[13px] text-text-3">No summary is on the referral yet.</p> : null}
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
            <div className="grid gap-3 sm:grid-cols-2" data-standing={standing.state}>
              <Tile label="Rank in the file" value={s ? `#${s.place.toLocaleString()} of ${s.of.toLocaleString()}` : unranked}
                hint={s ? s.why.slice(0, -1).join(' · ') : undefined} />
              <Tile label="Standing" value={s ? `${s.rank}/${RANK_MAX}` : unranked}
                hint={s ? (s.onBoard ? 'On the Funnel board' : 'Not on the Funnel board yet') : undefined} />
            </div>
            {d.client_key && (
              <Link to={convertedHref(d.client_key)} className={LINK_BTN} data-converted={d.client_key}>
                Open {d.client_name || 'the client'} in Clients <ArrowRight size={13} />
              </Link>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Recent activity"
          extra={<button type="button" onClick={() => onTab('activity')} className={LINK_BTN}>View activity log <ArrowRight size={13} /></button>}>
          {!o && overview.status !== 'failed' && <ReadLine state={overview} what="the activity" onRetry={onRetry} />}
          {o && o.recent.length === 0 && <EmptyNote>Nothing is on {row.name}&rsquo;s referral record yet.</EmptyNote>}
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
                {next.next_step && <p className="text-[12.5px] leading-5 text-text-2" data-next-written="">{next.next_step}</p>}
                {ownerDue(next.owner, next.due) && <p className="text-[12.5px] text-text-3">{ownerDue(next.owner, next.due)}</p>}
              </div>
            )}
          <button type="button" onClick={() => onTab('actions')} className={cn(LINK_BTN, 'mt-3')} data-view-actions="">
            View actions <ArrowRight size={13} />
          </button>
        </SectionCard>

        <SectionCard title="Quick actions">
          <div className="grid gap-2" data-quick-actions="">
            {mayNote(reach) && (
              <button type="button" onClick={() => onAsk({ kind: 'note', about: '' })} className={quick} data-quick="note">
                <Plus size={15} className="text-text-3" /> Add note
              </button>
            )}
            {mayPress(reach) && (
              <button type="button" onClick={() => onAsk({ kind: 'stage' })} className={quick} data-quick="stage">
                <ListOrdered size={15} className="text-text-3" /> Update stage
              </button>
            )}
            {mayEdit(reach, 'information') && (
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
