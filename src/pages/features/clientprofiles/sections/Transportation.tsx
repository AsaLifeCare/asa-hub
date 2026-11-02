// Transportation, from the apps that hold it (clientSourceTransport): the Van Calendar's requests and conflicts…
// The tab and the panel ride the page's address.
import type { RosterRow, TransportView } from '../clientModel'
import TransportTab from '../sources/TransportTab'

export default function TransportationSection({ client, view, onView, panel, onPanel }: {
  client: RosterRow
  view: TransportView
  onView: (view: string) => void
  panel: string | null
  onPanel: (panel: string | null) => void
}) {
  return <TransportTab client={client.client_key} view={view} onView={onView} panel={panel} onPanel={onPanel} />
}
