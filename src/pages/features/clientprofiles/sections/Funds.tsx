// Client Funds, from the apps that hold the money (clientSourceFunds): the Client Finances ledger with TrueLink…
// A receipt or a statement opens in the platform's centred viewer.
import type { FundsView, RosterRow } from '../clientModel'
import FinanceTab from '../sources/FinanceTab'

export default function FundsSection({ client, view, onView, panel, onPanel }: {
  client: RosterRow
  view: FundsView
  onView: (view: string) => void
  panel: string | null
  onPanel: (panel: string | null) => void
}) {
  return (
    <FinanceTab client={client.client_key} clientName={client.name} section="funds" tab={view} onTab={onView}
      panel={panel} onPanel={onPanel} />
  )
}
