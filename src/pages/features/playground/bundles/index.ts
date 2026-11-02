// CURATED BUNDLES — the gallery registry.
// Ready-made apps for a residential-care operation, installable in one click.
import type { CuratedBundle } from './shared'
import { houseSupplies } from './house-supplies'
import { maintenanceLog } from './maintenance-log'
import { shiftSwaps } from './shift-swaps'
import { policyLibrary } from './policy-library'
import { staffTraining } from './staff-training'
import { meetingNotes } from './meeting-notes'
import { clientOutings } from './client-outings'
import { incidentLog } from './incident-log'
import { purchaseRequests } from './purchase-requests'
import { visitorLog } from './visitor-log'
// the expansion — five more of the care operation's daily papers
import { vehicleChecks } from './vehicle-checks'
import { keyRegister } from './key-register'
import { groceryRuns } from './grocery-runs'
import { fridgeTemps } from './fridge-temps'
import { cleaningRota } from './cleaning-rota'

export type { CuratedBundle } from './shared'

export const CURATED_BUNDLES: CuratedBundle[] = [
  houseSupplies,
  maintenanceLog,
  shiftSwaps,
  policyLibrary,
  staffTraining,
  meetingNotes,
  clientOutings,
  incidentLog,
  purchaseRequests,
  visitorLog,
  vehicleChecks,
  keyRegister,
  groceryRuns,
  fridgeTemps,
  cleaningRota,
]
