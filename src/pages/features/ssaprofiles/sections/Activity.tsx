// Activity: what passed between the platform and this SSA, newest first — the admin notes, the texts and calls on…
import { Link } from 'react-router'
import { CalendarDays, FileText, Mail, MessageSquare, NotebookPen, PhoneCall, type LucideIcon } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { PencilButton } from '@/pages/features/clientprofiles/ClientParts'
import { cn } from '@/lib/utils'
import { useShellHides } from '@/lib/myWorkHides'
import {
  activityMeta, activityOf, clientHref, followLine, followMeta,
  type RosterRow, type SsaActivity, type SsaActivityItem, type SsaActivityKind,
} from '../ssaModel'
import { readActivity, readKey, useSsaRead, type ReadState } from '../useSsaRead'
import { EmptyNote, Pill, ReadLine, WhyLines, linkCls } from '../SsaParts'

/** `onEdit`: a maker of the Activity edition opens an entry's edit, to change it or take it off the Activity. */
export default function ActivitySection({ row, onEdit }: { row: RosterRow; onEdit?: (id: string) => void }) {
  const activity = useSsaRead(readKey('ssaProfileActivity', row.key), () => readActivity(row.key), activityOf)
  return <ActivityView row={row} activity={activity} onRetry={activity.reload} onEdit={onEdit} />
}

const KIND_ICON: Record<SsaActivityKind, LucideIcon> = {
  note: NotebookPen, sms: MessageSquare, call: PhoneCall, mail: Mail, record: FileText,
}

const KIND_TINT: Record<SsaActivityKind, string> = {
  note: 'bg-tint-lavender text-tint-fg-lavender', sms: 'bg-tint-blue text-tint-fg-blue', call: 'bg-tint-mint text-tint-fg-mint',
  mail: 'bg-tint-amber text-tint-fg-amber', record: 'bg-surface-2 text-text-2',
}

function ItemRow({ x, onEdit }: { x: SsaActivityItem; onEdit?: (id: string) => void }) {
  const Icon = KIND_ICON[x.kind]
  return (
    <li className="flex gap-3 py-3" data-item={x.kind}>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', KIND_TINT[x.kind])}><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-text-1">{x.title || x.body}</p>
        {x.title && x.body && <p className="clamp-1 mt-0.5 text-[12.5px] leading-5 text-text-2">{x.body}</p>}
        <p className="mt-0.5 text-[11.5px] text-text-3">{activityMeta(x)}</p>
      </div>
      {onEdit && <div className="shrink-0" data-edit-activity-open={x.id}><PencilButton label="Edit activity" onClick={() => onEdit(x.id)} /></div>}
    </li>
  )
}

export function ActivityView({ row, activity, onRetry, onEdit }: {
  row: Pick<RosterRow, 'name'>
  activity: ReadState<SsaActivity>
  onRetry: () => void
  onEdit?: (id: string) => void
}) {
  const a = activity.data
  const followupHidden = useShellHides().ssa_coordination
  return (
    <div className="grid gap-5" data-activity="">
      <SectionCard title="Activity">
        <div className="grid gap-2">
          <ReadLine state={activity} what="the activity" onRetry={onRetry} />
          {a && <WhyLines why={a.why} degraded={a.degraded} />}
          {a && a.items.length === 0 && <EmptyNote>Nothing is on record between the platform and {row.name} yet.</EmptyNote>}
          {a && a.items.length > 0 && (
            <ul className="scroll-thin max-h-[560px] divide-y divide-border overflow-y-auto pr-1" data-timeline="">
              {a.items.map((x) => <ItemRow key={x.id} x={x} onEdit={onEdit} />)}
            </ul>
          )}
        </div>
      </SectionCard>

      {/* the master's while Settings › My Work keeps it */}
      {!followupHidden && <SectionCard title="Coordination follow-up"
        extra={<span className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-text-2" aria-hidden><CalendarDays size={15} /></span>}>
        {!a && activity.status !== 'failed' && <ReadLine state={activity} what="the follow-up" onRetry={onRetry} />}
        {a && a.followups.length === 0 && <EmptyNote>No client of {row.name} has a plan date to follow up on.</EmptyNote>}
        {a && a.followups.length > 0 && (
          <ul className="divide-y divide-border" data-followups="">
            {a.followups.map((f) => (
              <li key={f.client_key || f.name} className="flex items-center gap-3 py-3" data-followup={f.client_key} data-status={f.status || 'unknown'}>
                <div className="min-w-0 flex-1">
                  {f.client_key
                    ? <Link to={clientHref(f.client_key)} className={cn(linkCls, 'text-[13.5px] font-semibold')}>{f.name}</Link>
                    : <span className="text-[13.5px] font-semibold text-text-1">{f.name}</span>}
                  <p className="mt-0.5 text-[12px] text-text-3">{followLine(f)}</p>
                </div>
                <Pill meta={followMeta(f.status)} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>}
    </div>
  )
}
