// House Calendar: only this house, as Scheduling holds it — Scheduling's own screen locked to the house (its board,
// its grid, a day's panel and every tool it offers there), never a copy read from somewhere else.
import { useSearchParams } from 'react-router'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { SchedulingView } from '@/pages/features/scheduling/SchedulingPage'
import { useSchedulingBoard } from '@/pages/features/scheduling/schedulingLane'

export default function Calendar({ house }: { house: HouseRow }) {
  const [params] = useSearchParams()
  const sessionMaster = useEffectiveIsMaster()
  const read = useSchedulingBoard(params.get('period') ?? '')
  return (
    <div data-house-calendar={house.code}>
      <SchedulingView state={read} sessionMaster={sessionMaster} onReload={read.reload} onAbsorb={read.absorb}
        houseOnly={house.code} />
    </div>
  )
}
