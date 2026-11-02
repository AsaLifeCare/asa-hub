// Extra seed registrar (wave-2 extension seam).
// Each feature branch creates its own dataset file `src/lib/seed-<domain>.ts` exporting typed arrays, then…
import { certMatrix, certifications, clients, staffCerts } from './seed-care' // care-data
import { expenseReports, inventoryItems, tasks } from './seed-ops' // ops-apps
import {
  leads, diseases, incidents, marEntries, shifts, visits, audits, workOrders,
  billingClaims, routes, mealPlans, policyAcks, equipment, onboarding, careDocs,
} from './seed-expansion'                                       // apps-expansion
import { directors } from './seed-directors'                    // context-mode
import { photos } from './seed-photos'                          // people-crud-media
import { projects } from './seed-ops2'                          // ops-flows
import { onboardingDocs, onboardingVideos } from './seed-onboarding' // onboarding-mode
import { houses, shiftCards, shiftMatrix, shiftTimeline } from './seed-shifts2' // shifts-suite
import { mealIdeals, workoutPlans, sleepProfiles, hydrationProfiles } from './seed-wellbeing' // wellbeing-suite
import { medications, medDeliveries } from './seed-meds' // meds-suite
import { questionnaires, questionnaireResponses } from './seed-questionnaire' // questionnaire-suite
import { reminders } from './seed-reminders' // reminders app

export const extraSeeds: Record<string, any[]> = {
  clients, certifications, staffCerts, certMatrix,
  expenseReports, inventoryItems, tasks,
  leads, diseases, incidents, marEntries, shifts, visits, audits, workOrders,
  billingClaims, routes, mealPlans, policyAcks, equipment, onboarding, careDocs,
  directors,
  photos,
  projects,
  onboardingVideos, onboardingDocs,
  houses, shiftCards, shiftMatrix, shiftTimeline,
  mealIdeals, workoutPlans, sleepProfiles, hydrationProfiles,
  medications, medDeliveries,
  questionnaires, questionnaireResponses,
  reminders,
}
