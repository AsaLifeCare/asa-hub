// Activity: what passed between the platform and this family member, newest first — the admin notes, the texts and…
// Each line links the family member and the client it concerns.
import { Link } from 'react-router'
import {
  CalendarClock, CalendarDays, FilePlus2, FileText, Link2, MessageSquare, NotebookPen, PhoneCall, ScrollText, TriangleAlert, UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { PencilButton } from '@/pages/features/clientprofiles/ClientParts'
import { cn } from '@/lib/utils'
import {
  activityMeta, activityOf, bodyParts, callIdOf, clientHref, familyHref, isRegistryStep, overviewOf, registryProgress, sinceWords,
  stampWords, type FamilyActivity, type FamilyActivityItem, type FamilyActivityKind, type FamilyClient, type RegistryProgress,
  type RosterRow,
} from '../familyModel'
import { readActivity, readKey, readOverview, useFamilyRead, type ReadState } from '../useFamilyRead'
import { EmptyNote, ReadLine, WhyLines, linkCls } from '../FamilyParts'

export default function ActivitySection({ row, onEditCall }: { row: RosterRow; onEditCall?: (id: string) => void }) {
  const activity = useFamilyRead(readKey('familyProfileActivity', row.key), () => readActivity(row.key), activityOf)
  // the clients' names for the links, from the overview the page already holds
  const overview = useFamilyRead(readKey('familyProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  return <ActivityView row={row} activity={activity} clients={overview.data?.clients ?? []} onRetry={activity.reload}
    onEditCall={onEditCall} />
}

const KIND_ICON: Record<FamilyActivityKind, LucideIcon> = {
  note: NotebookPen, sms: MessageSquare, call: PhoneCall, isp: ScrollText, calendar: CalendarDays, scheduled_call: CalendarClock,
  incident: TriangleAlert, registered: UserPlus, client_tied: Link2, document_added: FilePlus2, other: FileText,
}

const KIND_TINT: Record<FamilyActivityKind, string> = {
  note: 'bg-tint-lavender text-tint-fg-lavender', sms: 'bg-tint-blue text-tint-fg-blue', call: 'bg-tint-mint text-tint-fg-mint',
  isp: 'bg-tint-peach text-tint-fg-peach', calendar: 'bg-tint-amber text-tint-fg-amber', scheduled_call: 'bg-tint-blue text-tint-fg-blue',
  incident: 'bg-tint-danger text-tint-fg-danger', registered: 'bg-tint-mint text-tint-fg-mint', client_tied: 'bg-tint-blue text-tint-fg-blue',
  document_added: 'bg-tint-peach text-tint-fg-peach', other: 'bg-surface-2 text-text-2',
}

/** The progress since the family member was registered: each registry step oldest first, then what followed. */
function ProgressList({ p }: { p: RegistryProgress }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface-2/40 px-4 py-3" data-progress="">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Progress since registration</p>
      <ol className="grid">
        {p.steps.map((x, i) => {
          const Icon = KIND_ICON[x.kind]
          const last = i === p.steps.length - 1
          return (
            <li key={x.id} className="relative flex gap-3 pb-3 last:pb-0" data-step={x.kind}>
              {!last && <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-22px)] w-px bg-border" />}
              <span className={cn('relative grid h-7 w-7 shrink-0 place-items-center rounded-full', KIND_TINT[x.kind])}><Icon size={13} /></span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[13px] font-medium text-text-1">{x.title}</p>
                <p className="text-[11.5px] text-text-3">{[x.body, x.by, stampWords(x.at)].filter(Boolean).join(' · ')}</p>
              </div>
            </li>
          )
        })}
      </ol>
      {p.since.length > 0 && <p className="mt-2 border-t border-border pt-2 text-[12px] text-text-2" data-since="">Since then: {sinceWords(p.since)}</p>}
    </div>
  )
}

function ItemRow({ x, row, clients, onEditCall }: {
  x: FamilyActivityItem
  row: Pick<RosterRow, 'key' | 'name'>
  clients: FamilyClient[]
  onEditCall?: (id: string) => void
}) {
  const Icon = KIND_ICON[x.kind]
  const call = onEditCall ? callIdOf(x) : ''
  const client = x.client_key ? clients.find((c) => c.client_key === x.client_key) : undefined
  const parts = bodyParts(x.title ? x.body : '', [
    { name: row.name, href: familyHref(row.key) },
    ...(client ? [{ name: client.name, href: clientHref(client.client_key) }] : []),
  ])
  return (
    <li className="flex gap-3 py-3" data-item={x.kind}>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', KIND_TINT[x.kind])}><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-text-1">{x.title || x.body}</p>
        {parts.length > 0 && (
          <p className="clamp-1 mt-0.5 text-[12.5px] leading-5 text-text-2" data-body="">
            {parts.map((p, i) => (p.href
              ? <Link key={i} to={p.href} className={linkCls}>{p.text}</Link>
              : <span key={i}>{p.text}</span>))}
          </p>
        )}
        <p className="mt-0.5 text-[11.5px] text-text-3">{activityMeta(x)}</p>
      </div>
      {call && onEditCall && <div className="shrink-0" data-edit-call-open={call}><PencilButton label="Edit call" onClick={() => onEditCall(call)} /></div>}
    </li>
  )
}

export function ActivityView({ row, activity, clients, onRetry, onEditCall }: {
  row: Pick<RosterRow, 'key' | 'name'>
  activity: ReadState<FamilyActivity>
  clients: FamilyClient[]
  onRetry: () => void
  /** a scheduled call's own panel: the master's, or a holder's of the calls edition */
  onEditCall?: (id: string) => void
}) {
  const a = activity.data
  const progress = a ? registryProgress(a.items) : null
  // the registry's steps stand in the progress list; the timeline holds everything else
  const lines = a ? (progress ? a.items.filter((x) => !isRegistryStep(x.kind)) : a.items) : []
  return (
    <SectionCard title="Activity">
      <div className="grid gap-2">
        <ReadLine state={activity} what="the activity" onRetry={onRetry} />
        {a && <WhyLines why={a.why} degraded={a.degraded} />}
        {progress && <ProgressList p={progress} />}
        {a && a.items.length === 0 && <EmptyNote>Nothing is on record between the platform and {row.name} yet.</EmptyNote>}
        {lines.length > 0 && (
          <ul className="scroll-thin max-h-[640px] divide-y divide-border overflow-y-auto pr-1" data-timeline="">
            {lines.map((x) => <ItemRow key={x.id} x={x} row={row} clients={clients} onEditCall={onEditCall} />)}
          </ul>
        )}
        {a && a.total !== null && a.total > a.items.length && (
          <p className="text-[12px] text-text-3" data-capped="">The newest {a.items.length} of {a.total} are shown.</p>
        )}
      </div>
    </SectionCard>
  )
}
