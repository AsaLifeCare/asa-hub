// Driving: the Driver card, from the same staffProfileOverview answer the Staff Profile reads.
import { overviewOf, staffCan, type RosterRow, type StaffAsk, type StaffOverview } from '../staffModel'
import { readKey, readOverview, useStaffRead, type ReadState } from '../useStaffRead'
import { ReadLine, WhyNote } from '../StaffParts'
import { useStaffViewer } from '../staffViewer'
import { DriverCard } from './Profile'

export default function DrivingSection({ row, onAsk }: { row: RosterRow; onAsk: (ask: StaffAsk) => void }) {
  const overview = useStaffRead(readKey('staffProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  return <DrivingView overview={overview} onAsk={onAsk} onRetry={overview.reload} />
}

export function DrivingView({ overview, onAsk, onRetry }: {
  overview: ReadState<StaffOverview>
  onAsk: (ask: StaffAsk) => void
  onRetry: () => void
}) {
  const viewer = useStaffViewer()
  const o = overview.data
  return (
    <div className="grid gap-5" data-driving="">
      <ReadLine state={overview} what="the driving record" onRetry={onRetry} />
      {o && <WhyNote why={o.why} degraded={o.degraded} />}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <DriverCard driving={o ? o.driving : undefined} onAsk={staffCan(viewer, 'staff.driving') ? onAsk : undefined} />
      </div>
    </div>
  )
}
