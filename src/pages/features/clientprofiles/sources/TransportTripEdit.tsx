// Clients › Transportation: a client's trip changed or cancelled in the Transportation app's own panel (TripPanel), and a
// new one asked for through that app's own request (RequestPanel). The board is that app's, asked for this client; each
// save runs through the Apply strip.
import { useCallback, useMemo, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import ApplyStrip, { useApplyFor } from '@/pages/features/locations/ApplyStrip'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { toast } from '@/stores/useToastStore'
import RequestPanel from '@/pages/features/vehiclecalendar/RequestPanel'
import TripPanel from '@/pages/features/vehiclecalendar/TripPanel'
import {
  clientBoardWrote, saveTripAnswer, useClientTripBoard, type TripSavePayload,
} from '@/pages/features/vehiclecalendar/vehicleCalendarLane'
import { writeFrom, type WriteAnswer } from '@/pages/features/vehiclecalendar/vehicleCalendarModel'
import { clientWritten, transportTarget } from '../useClientRead'

export default function TransportTripEdit({ client, tripId, onClose }: { client: string; tripId: string; onClose: () => void }) {
  const read = useClientTripBoard(client)
  const apply = useApplyFor(useMemo(() => transportTarget(client), [client]))
  // a save the strip ran has already read the client again
  const stripped = useRef(false)
  const run = apply.run
  const save = useCallback(async (p: TripSavePayload): Promise<WriteAnswer> => {
    const answer = writeFrom(await run(() => saveTripAnswer(p), []))
    stripped.current = true
    return answer
  }, [run])
  const done = useCallback((a: WriteAnswer) => {
    // this panel's board and the calendar's both take it
    clientBoardWrote(client, a)
    // an answer or a withdraw from the panel's own boxes: the client's sections read again
    if (!stripped.current) clientWritten(client)
    stripped.current = false
  }, [client])
  if (!read.board) return <BoardLine read={read} />
  const trip = read.board.trips.find((t) => t.id === tripId) ?? null
  return (
    <div className="grid min-w-0 gap-4" data-trip-edit={tripId}>
      <TripPanel board={read.board} trip={trip} isMaster={read.board.viewer.is_master} onDone={done} onClose={onClose} save={save} />
      <ApplyStrip state={apply.state} onDone={() => { apply.reset(); onClose() }} onAgain={apply.reset} />
    </div>
  )
}

/** New trip for this client: the Transportation app's own request, the client fixed (`day`: the calendar day pressed);
 * the directors are asked as there, the calendar draws it as awaiting approval, and it opens once it is filed. */
export function TransportTripNew({ client, day, onClose, onFiled }: {
  client: { key: string; name: string }
  day?: string
  onClose: () => void
  onFiled: (tripId: string) => void
}) {
  const read = useClientTripBoard(client.key)
  if (!read.board) return <BoardLine read={read} />
  const filed = (a: WriteAnswer) => {
    // the calendar behind the panel reads it again: the new trip is drawn there at once
    clientBoardWrote(client.key, a)
    clientWritten(client.key)
    toast({ type: 'success', title: a.said || 'Requested.' })
    for (const w of a.warnings ?? []) toast({ type: 'warning', title: 'Note', body: w })
    if (a.trip_id) onFiled(a.trip_id)
    else onClose()
  }
  return <RequestPanel board={read.board} client={client} day={day} onDone={filed} onCancel={onClose} />
}

function BoardLine({ read }: { read: { status: string; error: string; reload: () => void } }) {
  return read.status === 'failed' ? (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-trip-edit-read="failed">
      The vehicle calendar could not be read: {read.error}
      <RetryButton onRetry={read.reload} busy={false} />
    </p>
  ) : (
    <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-trip-edit-read="loading">
      <Loader2 size={13} className="animate-spin" /> Reading the vehicle calendar…
    </p>
  )
}
