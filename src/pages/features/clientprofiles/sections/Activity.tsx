// Activity: one timeline of what the platform holds about the client — daily notes, client and house notes…
import {
  activityKindLabel, activityOf, activityText, countLabel, dayLabel, ohioClockOf,
  type ActivityAnswer, type ActivityRow, type ClientAsk, type RosterRow,
} from '../clientModel'
import { readActivity, readKey, useClientRead, type ReadState } from '../useClientRead'
import { KpiCards, PencilButton, ReadLine, RecordTable, StatusPill } from '../ClientParts'
import { useClientActivityHidden } from '@/lib/stamps'

export default function ActivitySection({ client, onAsk }: { client: RosterRow; onAsk: (ask: ClientAsk) => void }) {
  const activity = useClientRead(readKey('clientProfileActivity', client.client_key), () => readActivity(client.client_key), activityOf)
  return <ActivityBody activity={activity} onAsk={onAsk} onRetry={activity.reload} />
}

type Shown = ActivityRow & { status: string }

export function ActivityBody({ activity, onAsk, onRetry }: {
  activity: ReadState<ActivityAnswer>
  onAsk: (ask: ClientAsk) => void
  onRetry: () => void
}) {
  const a = activity.data
  const rows: Shown[] = (a?.rows ?? []).map((r) => ({ ...r, status: activityKindLabel(r.kind) }))
  const kinds = a ? [...new Set([...a.kinds.map(activityKindLabel), ...rows.map((r) => r.status)])] : []
  // Settings › My Work's Clients switch: the three figures and the Action column are the master's unless released
  const lean = useClientActivityHidden()
  return (
    <div className="grid gap-4" data-activity="">
      <ReadLine state={activity} what="the activity" onRetry={onRetry} />
      {a && !lean && (
        <KpiCards items={[
          { label: 'Records', value: countLabel(a.total ?? rows.length) },
          { label: 'Kinds of record', value: countLabel(kinds.length) },
          { label: 'Last activity', value: dayLabel(a.lastDate || rows[0]?.at || '') || '—' },
        ]} />
      )}
      {a && (
        <RecordTable rows={rows} statuses={kinds} filterLabel="All types" text={activityText}
          empty={a.why || 'Nothing is on record for this client yet.'}
          columns={[
            { label: 'Date', cell: (r: Shown) => <span className="whitespace-nowrap">{[dayLabel(r.at), ohioClockOf(r.at)].filter(Boolean).join(' · ') || '—'}</span> },
            { label: 'Type', cell: (r: Shown) => <StatusPill status={r.status} /> },
            { label: 'Record', cell: (r: Shown) => <span className="grid"><span className="font-semibold text-text-1">{r.record || '—'}</span>{r.by && <span className="text-[12px] text-text-3">{r.by}</span>}</span> },
            { label: 'Details', cell: (r: Shown) => <span className="clamp-2 max-w-[420px]">{r.details || '—'}</span> },
            ...(lean ? [] : [
              { label: 'Action', cell: (r: Shown) => <PencilButton label="Open the record" onClick={() => onAsk({ kind: 'activity', id: r.id })} /> },
            ]),
          ]} />
      )}
      {a?.why && rows.length > 0 && <p className="text-[12px] text-text-3" data-why="">{a.why}</p>}
    </div>
  )
}
