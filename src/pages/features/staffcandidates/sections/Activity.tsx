// Activity Log: the record of the candidate's hiring steps, newest first — every step the Hiring app logged (the…
// A step that was tried and did not land says so.
import {
  CalendarCheck, FileText, GitBranch, Mail, MessageSquare, NotebookPen, Pencil, PhoneCall, Signpost, TriangleAlert, type LucideIcon,
} from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { cn } from '@/lib/utils'
import {
  activityMeta, activityOf, mayNoteEdit, type ActivityItem, type ActivityKind, type CandidateActivity, type CandidateAsk, type Reach,
  type RosterRow,
} from '../candidateModel'
import { readActivity, readKey, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EmptyNote, ReadLine, WhyLines } from '../CandidateParts'

export default function ActivitySection({ row, onAsk, reach }: {
  row: RosterRow
  onAsk?: (ask: CandidateAsk) => void
  /** what this reader may do: a note's Edit for whom editionsMine names the notes */
  reach?: Reach
}) {
  const activity = useCandidateRead(readKey('candidateProfileActivity', row.key), () => readActivity(row.key), activityOf)
  const onNote = onAsk && reach && mayNoteEdit(reach) ? (id: string) => onAsk({ kind: 'noteEdit', id }) : undefined
  return <ActivityView row={row} activity={activity} onRetry={activity.reload} onNote={onNote} />
}

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  step: Signpost, stage: GitBranch, note: NotebookPen, sms: MessageSquare, call: PhoneCall, mail: Mail, document: FileText,
  interview: CalendarCheck, record: FileText,
}

const KIND_TINT: Record<ActivityKind, string> = {
  step: 'bg-tint-blue text-tint-fg-blue', stage: 'bg-tint-lavender text-tint-fg-lavender', note: 'bg-tint-lavender text-tint-fg-lavender',
  sms: 'bg-tint-blue text-tint-fg-blue', call: 'bg-tint-mint text-tint-fg-mint', mail: 'bg-tint-amber text-tint-fg-amber',
  document: 'bg-tint-mint text-tint-fg-mint', interview: 'bg-tint-amber text-tint-fg-amber', record: 'bg-surface-2 text-text-2',
}

function ItemRow({ x, onNote }: { x: ActivityItem; onNote?: (id: string) => void }) {
  const Icon = x.ok ? KIND_ICON[x.kind] : TriangleAlert
  return (
    <li className="flex gap-3 py-3" data-item={x.kind} data-ok={x.ok ? undefined : 'false'}>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full',
        x.ok ? KIND_TINT[x.kind] : 'bg-tint-danger text-tint-fg-danger')}><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-text-1">{x.title || x.body}</p>
        {x.title && x.body && <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-5 text-text-2">{x.body}</p>}
        <p className="mt-0.5 text-[11.5px] text-text-3">
          {activityMeta(x)}{x.ok ? '' : ' · did not land'}{x.rehearsal ? ' · rehearsal' : ''}
        </p>
      </div>
      {onNote && x.kind === 'note' && x.id.startsWith('jrn_') && (
        <button type="button" onClick={() => onNote(x.id)} data-note-edit-open={x.id} aria-label="Edit the note" title="Edit the note"
          className="grid h-8 w-8 shrink-0 place-items-center self-start rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1">
          <Pencil size={14} />
        </button>
      )}
    </li>
  )
}

export function ActivityView({ row, activity, onRetry, onNote }: {
  row: Pick<RosterRow, 'name'>
  activity: ReadState<CandidateActivity>
  onRetry: () => void
  /** a note's own panel (its text, or removed), for whom the notes edition opens */
  onNote?: (id: string) => void
}) {
  const a = activity.data
  return (
    <SectionCard title="Activity Log" sub="The hiring steps on the record, newest first.">
      <div className="grid gap-2">
        <ReadLine state={activity} what="the activity" onRetry={onRetry} />
        {a && <WhyLines why={a.why} degraded={a.degraded} />}
        {a && a.items.length === 0 && <EmptyNote>No hiring step is on {row.name}&rsquo;s record yet.</EmptyNote>}
        {a && a.items.length > 0 && (
          <ul className="scroll-thin max-h-[640px] divide-y divide-border overflow-y-auto pr-1" data-timeline="">
            {a.items.map((x) => <ItemRow key={x.id} x={x} onNote={onNote} />)}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}
