// Medication: Medications (the eMAR chart's rows for the client, Active or Discontinued), Administration (the MARS…
// The tab and the panel ride the page's address.
import {
  SECTION_VIEWS, medsOf, recordText, type ClientAsk, type MedView, type MedsAnswer, type RosterRow,
} from '../clientModel'
import { readKey, readMeds, useClientRead, type ReadState } from '../useClientRead'
import { NotOpenNote, PencilButton, ReadLine, RecordTable, SubTabs } from '../ClientParts'
import { clientCan, shownViews, useClientReader } from '../clientViewer'
import MarTab from '../sources/MarTab'
import RefillsTab from '../sources/RefillsTab'
import { recordColumns } from './recordColumns'

export default function MedicationSection({ client, view, today, onView, onAsk, panel, onPanel }: {
  client: RosterRow
  view: MedView
  today: string
  onView: (view: string) => void
  onAsk: (ask: ClientAsk) => void
  panel: string | null
  onPanel: (panel: string | null) => void
}) {
  const reader = useClientReader()
  const views = shownViews('medication', SECTION_VIEWS.medication, reader.viewer)
  const open = views.some((v) => v.id === view)
  // the master's, or a holder's of the medication edition (Settings › Editions)
  const adds = view === 'meds' && clientCan(reader, 'clients.medication')
  return (
    <div className="grid gap-4" data-medication={view}>
      <div className="flex items-center justify-between gap-3">
        <SubTabs tabs={views} value={view} onChange={onView} label="Medication" />
        {adds && <PencilButton label="Add medication" onClick={() => onAsk({ kind: 'add-medication' })} />}
      </div>
      {view === 'meds' && <MedicationsList client={client} onAsk={onAsk} />}
      {view === 'admin' && <MarTab client={client.client_key} panel={panel} onPanel={onPanel} />}
      {view === 'refills' && open && <RefillsTab client={client.client_key} todayIso={today} panel={panel} onPanel={onPanel} />}
      {!open && <NotOpenNote />}
    </div>
  )
}

function MedicationsList({ client, onAsk }: { client: RosterRow; onAsk: (ask: ClientAsk) => void }) {
  const meds = useClientRead(readKey('clientProfileMeds', client.client_key, 'meds'), () => readMeds(client.client_key), medsOf)
  return <MedicationsBody meds={meds} onAsk={onAsk} onRetry={meds.reload} />
}

export function MedicationsBody({ meds, onAsk, onRetry }: {
  meds: ReadState<MedsAnswer>
  onAsk: (ask: ClientAsk) => void
  onRetry: () => void
}) {
  const a = meds.data
  return (
    <>
      <ReadLine state={meds} what="the medication record" onRetry={onRetry} />
      {a && (
        <RecordTable rows={a.rows} statuses={a.statuses} columns={recordColumns('medication', 'meds', onAsk)} text={recordText}
          empty={a.why || 'No medication is on the chart for this client.'} />
      )}
    </>
  )
}
