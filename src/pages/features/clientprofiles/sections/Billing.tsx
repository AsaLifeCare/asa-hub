// Billing, from the Finances app's books (clientSourceBilling): the PAWS and ISP spans as Authorizations, the MBS…
// A count whose books did not read is drawn with its why, never as 0.
import type { BillingView, RosterRow } from '../clientModel'
import FinanceTab from '../sources/FinanceTab'

export default function BillingSection({ client, view, onView, panel, onPanel }: {
  client: RosterRow
  view: BillingView
  onView: (view: string) => void
  panel: string | null
  onPanel: (panel: string | null) => void
}) {
  return (
    <FinanceTab client={client.client_key} clientName={client.name} section="billing" tab={view} onTab={onView}
      panel={panel} onPanel={onPanel} />
  )
}
