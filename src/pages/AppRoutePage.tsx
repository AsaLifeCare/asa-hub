// Route resolver for /app/:appId/:pageId (§4): reads the registry.
// Unknown app → redirect to App Hub; unknown page → NotFound state.
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import type { AppManifest, PageSchema } from '@/engine/types'
import type { Role } from '@/auth/types'
import { Navigate, useLocation, useParams } from 'react-router'
import SheetModePage, { SHEET_MODE } from '@/pages/SheetModePage'
import { SHIFT_BOARD_MOVED_TO } from '@/registry/apps-shifts'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { allowedPages, isManifestVisible, visibleManifests } from '@/lib/audience'
import { isAllowedWith, masterOnlyRefused, selectAccessChecker, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import { homeRouteFor } from '@/lib/homeRoute'
import { chatAppFallback, inboxChatFallback, useLiveMode } from '@/lib/chatLive/access'
import { fetchIstConfig, certMatrixConfig, IST_CONFIG_FALLBACK, type IstConfig } from '@/lib/istConfig'
import { toast } from '@/stores/useToastStore'
import EmptyState from '@/components/shared/EmptyState'
import { liveForBuilderLink } from '@/pages/features/calendarbuilder/calendarScreen'
import type { TintName } from '@/engine/types'
import type { ClientViewId } from '@/stores/useClientViewsStore'
import type { HiringViewId } from '@/stores/useHiringViewsStore'
import { useHiringPolicyStore } from '@/stores/useHiringPolicyStore'
import { activeWorldId } from '@/stores/useWorldStore'
import { MYASA_APP_ID, MYASA_ELSEWHERE, useMyAsaOffered } from '@/lib/myAsaOffered'
import { lazyPage, type LazyPage } from '@/lib/lazyPage'

// Every screen this resolver mounts is its own chunk (lib/lazyPage), the generic renderer and its templates…
const PageRenderer = lazyPage(() => import('@/engine/PageRenderer'))
const MedicationsPage = lazyPage(() => import('@/pages/features/meds/MedicationsPage'))
const MedDeliveriesPage = lazyPage(() => import('@/pages/features/meds/MedDeliveriesPage'))
const MedCorrelationPage = lazyPage(() => import('@/pages/features/meds/MedCorrelationPage'))
const WorkforcePage = lazyPage(() => import('@/pages/features/leadership/WorkforcePage'))
const PoliciesPage = lazyPage(() => import('@/pages/features/policies/PoliciesPage'))
const MealsPage = lazyPage(() => import('@/pages/features/wellbeing').then((m) => ({ default: m.MealsPage })))
const WorkoutPage = lazyPage(() => import('@/pages/features/wellbeing').then((m) => ({ default: m.WorkoutPage })))
const SleepPage = lazyPage(() => import('@/pages/features/wellbeing').then((m) => ({ default: m.SleepPage })))
const HydrationPage = lazyPage(() => import('@/pages/features/wellbeing').then((m) => ({ default: m.HydrationPage })))
const QuestionnairesPage = lazyPage(() => import('@/pages/features/questionnaire/QuestionnairesPage'))
const ResponsesPage = lazyPage(() => import('@/pages/features/questionnaire/ResponsesPage'))
const MyAsaPage = lazyPage(() => import('@/pages/features/myasa/MyAsaPage'))
const TeamBoardPage = lazyPage(() => import('@/pages/features/teamboard/TeamBoardPage'))
const HotlinePage = lazyPage(() => import('@/pages/features/hotline/HotlinePage'))
const StaffIssuesPage = lazyPage(() => import('@/pages/features/staffissues/StaffIssuesPage'))
const TalentPipelinePage = lazyPage(() => import('@/pages/features/talentpipeline/TalentPipelinePage'))
const TalentAnalysisPage = lazyPage(() => import('@/pages/features/talentpipeline/AnalysisPage'))
const TransportationPage = lazyPage(() => import('@/pages/features/transportation/TransportationPage'))
const BooksPage = lazyPage(() => import('@/pages/features/books/BooksPage'))
const EmailDesignsPage = lazyPage(() => import('@/pages/features/emaildesigns/EmailDesignsPage'))
const AuditLibraryPage = lazyPage(() => import('@/pages/features/docrooms/AuditLibraryPage'))
const WidgetsPage = lazyPage(() => import('@/pages/features/widgets/WidgetsPage'))
const CompliancePage = lazyPage(() => import('@/pages/features/compliance/CompliancePage'))
const CertificationsDashboard = lazyPage(() => import('@/pages/features/compliance/CertificationsDashboard'))
const EmployeeTrackerPage = lazyPage(() => import('@/pages/features/employeetracker/EmployeeTrackerPage'))
const StaffPerformancePage = lazyPage(() => import('@/pages/features/performance/StaffPerformancePage'))
const MedDelPage = lazyPage(() => import('@/pages/features/meddel/MedDelPage'))
const RequestsPage = lazyPage(() => import('@/pages/features/requests/RequestsPage'))
const PlaygroundPage = lazyPage(() => import('@/pages/features/playground/PlaygroundPage'))
const ReleaseUsersPage = lazyPage(() => import('@/pages/features/releaseusers/ReleaseUsersPage'))
const PasswordResetsPage = lazyPage(() => import('@/pages/features/credentials/PasswordResetsPage'))
const PsiLogPage = lazyPage(() => import('@/pages/features/psi/PsiLogPage'))
const PsiDataPage = lazyPage(() => import('@/pages/features/psi/PsiDataPage'))
const PsiEntriesPage = lazyPage(() => import('@/pages/features/psi/PsiEntriesPage'))
const PsiCollectPage = lazyPage(() => import('@/pages/features/psi/PsiCollectPage'))
const PsiResetPage = lazyPage(() => import('@/pages/features/psi/PsiResetPage'))
const PsiNewClientPage = lazyPage(() => import('@/pages/features/psi/PsiNewClientPage'))
const AppControlPage = lazyPage(() => import('@/pages/features/appcontrol/AppControlPage'))
const ProductionActionsPage = lazyPage(() => import('@/pages/features/productionactions/ProductionActionsPage'))
const MyWorkPage = lazyPage(() => import('@/pages/features/mywork/MyWorkPage'))
const MyProfilePage = lazyPage(() => import('@/pages/features/myprofile/MyProfilePage'))
const MyCalendarPage = lazyPage(() => import('@/pages/features/mycalendar/MyCalendarPage'))
const StaffProfilesPage = lazyPage(() => import('@/pages/features/staffprofiles/StaffProfilesPage'))
const MyInboxPage = lazyPage(() => import('@/pages/features/myinbox/MyInboxPage'))
const LocationsPage = lazyPage(() => import('@/pages/features/locations/LocationsPage'))
const ClientCandidatesPage = lazyPage(() => import('@/pages/features/clientcandidates/ClientCandidatesPage'))
const ClientProfilesPage = lazyPage(() => import('@/pages/features/clientprofiles/ClientProfilesPage'))
const SsaProfilesPage = lazyPage(() => import('@/pages/features/ssaprofiles/SsaProfilesPage'))
const FamilyProfilesPage = lazyPage(() => import('@/pages/features/familyprofiles/FamilyProfilesPage'))
const StaffCandidatesPage = lazyPage(() => import('@/pages/features/staffcandidates/StaffCandidatesPage'))
const InterviewsPage = lazyPage(() => import('@/pages/features/interviews/InterviewsPage'))
const EmergencyContactsPage = lazyPage(() => import('@/pages/features/emergencycontacts/EmergencyContactsPage'))
const SchedulingPage = lazyPage(() => import('@/pages/features/scheduling/SchedulingPage'))
const SupportDeskPage = lazyPage(() => import('@/pages/features/supportdesk/SupportDeskPage'))
const SupportIncidentsPage = lazyPage(() => import('@/pages/features/supportdesk/SupportIncidentsPage'))
const VehicleCalendarPage = lazyPage(() => import('@/pages/features/vehiclecalendar/VehicleCalendarPage'))
const OnboardingHome = lazyPage(() => import('@/pages/features/onboarding/OnboardingHome'))
const FamilyHomePage = lazyPage(() => import('@/pages/features/family/FamilyHomePage'))
const InvoicesPage = lazyPage(() => import('@/pages/features/invoices/InvoicesPage'))
const FinancesPage = lazyPage(() => import('@/pages/features/finances/FinancesPage'))
const AdministrationPage = lazyPage(() => import('@/pages/features/administration/AdministrationPage'))
const TechnologyPage = lazyPage(() => import('@/pages/features/technology/TechnologyPage'))
const IstRecordsPage = lazyPage(() => import('@/pages/features/ist/IstRecordsPage'))
const PlaygroundAppPage = lazyPage(() => import('@/pages/features/playground/PlaygroundAppPage'))
const MailPage = lazyPage(() => import('@/pages/features/mail/MailPage'))
const SystemLogsPage = lazyPage(() => import('@/pages/features/logs/SystemLogsPage'))
const DocsReaderPage = lazyPage(() => import('@/pages/features/docsreader/DocsReaderPage'))
const TimeReconPage = lazyPage(() => import('@/pages/features/time-recon/TimeReconPage'))
const RenderSheetPage = lazyPage(() => import('@/pages/features/rendersheet/RenderSheetPage'))
const TaskBoardSheetPage = lazyPage(() => import('@/pages/features/taskboardsheet/TaskBoardSheetPage'))
const CortexChatPage = lazyPage(() => import('@/pages/features/cortex/CortexChatPage'))
const CalendarBuilderPage = lazyPage(() => import('@/pages/features/calendarbuilder/CalendarBuilderPage'))
const ConnectomePage = lazyPage(() => import('@/pages/features/cortex/ConnectomePage'))
const GuardianPage = lazyPage(() => import('@/pages/features/guardian/GuardianPage'))
const BehaviorSupportPage = lazyPage(() => import('@/pages/features/behavior/BehaviorSupportPage'))
const UserSupportPage = lazyPage(() => import('@/pages/features/usersupport/UserSupportPage'))
const EngineRequirementsPage = lazyPage(() => import('@/pages/features/engine/EngineRequirementsPage'))
const EngineStatesPage = lazyPage(() => import('@/pages/features/engine/EngineStatesPage'))
const EngineEventsPage = lazyPage(() => import('@/pages/features/engine/EngineEventsPage'))
const SmartCommsPage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsPage'))
const SmartCommsCataloguePage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsCataloguePage'))
const SmartCommsWordsPage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsWordsPage'))
const SmartCommsActivityPage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsActivityPage'))
const CommsBoardPage = lazyPage(() => import('@/pages/features/comms/CommsBoardPage'))
const SmartCommsWhenPage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsWhenPage'))
const SmartCommsGuidePage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsGuidePage'))
const SmartCommsRepliesPage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsRepliesPage'))
const SmartCommsStopsPage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsStopsPage'))
const CommProposalsPage = lazyPage(() => import('@/pages/features/smartcomms/CommProposals'))
const PsiPunchesPage = lazyPage(() => import('@/pages/features/psipunches/PsiPunchesPage'))
const HouseSuppliesPage = lazyPage(() => import('@/pages/features/housesupplies/HouseSuppliesPage'))
const TimeOffPage = lazyPage(() => import('@/pages/features/timeoff/TimeOffPage'))
const TimeOffRequestsPage = lazyPage(() => import('@/pages/features/timeoff/TimeOffRequestsPage'))
const SmartCommsAttendancePage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsAttendancePage'))
const SmartCommsPunchBoardPage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsPunchBoardPage'))
const SmartCommsHotlinePage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsHotlinePage'))
const SmartCommsBroadcastPage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsBroadcastPage'))
const SmartCommsRecruitingPage = lazyPage(() => import('@/pages/features/smartcomms/SmartCommsRecruitingPage'))
const RemindersPage = lazyPage(() => import('@/pages/features/reminders/RemindersPage'))
const MarketingPage = lazyPage(() => import('@/pages/features/marketing/MarketingPage'))
const MarketingAnalyticsPage = lazyPage(() => import('@/pages/features/marketing/MarketingAnalyticsPage'))
const PotentialClientsComparePage = lazyPage(() => import('@/pages/features/potclients/PotentialClientsComparePage'))
const PotentialClientsFunnelPage = lazyPage(() => import('@/pages/features/potclients/PotentialClientsFunnelPage'))
const HiringArchivePage = lazyPage(() => import('@/pages/features/hiring/ArchivePage'))
const HiringPage = lazyPage(() => import('@/pages/features/hiring/HiringPage'))
const HiringSimulatorPage = lazyPage(() => import('@/pages/features/hiring/SimulatorPage'))
const FlowControlPage = lazyPage(() => import('@/pages/features/hiring/FlowControlPage'))
const CandidateProfilePage = lazyPage(() => import('@/pages/features/hiring/CandidateProfilePage'))
const IncidentsPage = lazyPage(() => import('@/pages/features/incidents/IncidentsPage'))
const ChatAppPage = lazyPage(() => import('@/pages/features/chat/ChatAppPage'))
const SuggestionsPage = lazyPage(() => import('@/pages/features/suggestions/SuggestionsPage'))
const DigestLabPage = lazyPage(() => import('@/pages/features/digestlab/DigestLabPage'))
const PotentialClientUniquePage = lazyPage(() => import('@/pages/features/potclients/PotentialClientUniquePage'))
const CompanyCalendarPage = lazyPage(() => import('@/pages/features/calendar/CompanyCalendarPage'))
const ClientsPage = lazyPage(() => import('@/pages/features/clients/ClientsPage'))

// THE PERSONAL SUITE'S PRODUCT DOORS.
const PERSONAL_WIRE: Record<string, { icon: string; accent: TintName }> = {
  move: { icon: 'dumbbell', accent: 'green' },
  weight: { icon: 'scale', accent: 'mint' },
  plate: { icon: 'utensils', accent: 'peach' },
  meds: { icon: 'pill', accent: 'blue' },
  doctors: { icon: 'stethoscope', accent: 'pink' },
  vitals: { icon: 'heart-pulse', accent: 'lavender' },
  prices: { icon: 'tag', accent: 'amber' },
  money: { icon: 'wallet', accent: 'green' },
  habits: { icon: 'repeat', accent: 'lavender' },
  home: { icon: 'home', accent: 'blue' },
  pets: { icon: 'paw-print', accent: 'peach' },
  vault: { icon: 'folder-lock', accent: 'amber' },
}
const PERSONAL_PAGES: Record<string, LazyPage<ComponentType>> = Object.fromEntries(
  Object.entries(PERSONAL_WIRE).map(([id, wire]) => [
    `${id}/main`,
    lazyPage(() => Promise.all([
      import('@/pages/features/personal/PersonalProductPage'),
      import('@/pages/features/personal/products'),
    ]).then(([{ default: PersonalProductPage }, { PERSONAL_PRODUCTS }]) => ({
      default: function PersonalMain() {
        return <PersonalProductPage spec={PERSONAL_PRODUCTS[id]} icon={wire.icon} accent={wire.accent} />
      },
    }))),
  ]),
)

// THE NINE ADDRESSES WORKFORCE COMPLIANCE TOOK OVER.
const ABSORBED_BY_TRACKER: Record<string, string> = {
  'compliance/certifications': 'certifications',
  'compliance-engine/requirements': 'requirements',
  'performance/board': 'board',
  // THE RUNGS THAT WENT AWAY still have to land somewhere real.
  'compliance/matrix': 'roster',
  'ist/records': 'roster',
  'compliance-engine/states': 'roster',
  // …and the same four addresses INSIDE the tracker, which existed for a day and are in at least one person's…
  'employee-tracker/matrix': 'roster',
  'employee-tracker/records': 'roster',
  'employee-tracker/states': 'roster',
  'employee-tracker/documents': 'roster',
  // The Compliance scorecard left with its app.
  'compliance/overview': 'certifications',
  'employee-tracker/overview': 'certifications',
  // Policies was NOT put away — it is open to everyone and stays its own app, so /app/policy-acks/documents keeps…
}


// THE COMPLIANCE MATRIX, WITH ITS COURSES READ FROM THE `ist_config` TAB.
function CertMatrixRoutePage({ page }: { page: PageSchema }) {
  const [cfg, setCfg] = useState<IstConfig | null>(null)
  useEffect(() => {
    void fetchIstConfig().then(setCfg).catch(() => setCfg(IST_CONFIG_FALLBACK))
  }, [])
  const schema = useMemo(
    () => (cfg ? { ...page, config: certMatrixConfig(page.config, cfg) } : page),
    [page, cfg],
  )
  return (
    <div className="w-full">
      {cfg?.blind && (
        <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2.5 text-[12px] leading-5 text-tint-fg-amber">
          <p className="font-semibold">Showing the certification columns this screen ships with</p>
          <p className="mt-0.5">
            {cfg.reason || `The ${cfg.tab} tab could not be read, so the course list on this screen is the shipped one.`}
            {' '}The rows are the real ones: nobody's compliance changed.
          </p>
        </div>
      )}
      <PageRenderer schema={schema} />
    </div>
  )
}

// Custom feature pages keyed by `appId/pageId` — mounted instead of the schema-driven PageRenderer when a registry…
export const CUSTOM_PAGES: Record<string, LazyPage<ComponentType>> = {
  'hiring/archive': HiringArchivePage,
  // (The Flow view left this map: `pipeline` and `flow` are both answered by the unified page in the resolver's own…
  'simulator/simulator': HiringSimulatorPage,
  'simulator/flow-control': FlowControlPage,
  // the candidate FULL profile — one page behind two doors (hiring surfaces and the interviewer's desk); both…
  'hiring/candidate': CandidateProfilePage,
  'interviews/candidate': CandidateProfilePage,
  // one page, four views (Log · Board · Trail · Sheet) — the Sheet view took over the old SHEET_MODE button's duty
  'incidents/log': IncidentsPage,
  'suggestions/box': SuggestionsPage,
  // the decoder's bench: the paper on one side, both readings on the other
  'digestlab/bench': DigestLabPage,
  // the platform's own person-to-person chat
  'chat/messages': ChatAppPage,
  // (the separate incidents/sheet and mar/sheet pages are gone — sheet mode is a BUTTON on the main page now, see…
  'calendar/month': CompanyCalendarPage,
  // the referral read like a client's Unique profile
  'potential-clients/unique': PotentialClientUniquePage,
  // where somebody decides which referral to take, and sends the winners onto the funnel
  'potential-clients/compare': PotentialClientsComparePage,
  // the generic board, with the app's black header over it
  'potential-clients/funnel': PotentialClientsFunnelPage,
  'compliance/overview': CompliancePage,
  // the employee-docs tracker as ONE app — a read-time union over the compliance data…
  'employee-tracker/roster': EmployeeTrackerPage,
  // …AND THE NINE IT ABSORBED.
  'employee-tracker/certifications': CertificationsDashboard,
  'compliance/certifications': CertificationsDashboard,
  // The board at its OWN app's address.
  'performance/board': StaffPerformancePage,
  'employee-tracker/requirements': EngineRequirementsPage,
  'employee-tracker/board': StaffPerformancePage,
  // `records`, `documents` and `events` left this app — IST and the documents matrix are columns of the tracker's…
  'teamboard/board': TeamBoardPage,
  // the 5558 line's desk
  'hotline/desk': HotlinePage,
  'staffissues/tracker': StaffIssuesPage,
  // the legacy recruiting engine's record, untangled
  'talent-pipeline/scores': TalentPipelinePage,
  // the statistics + ranking + leaders' authorization loop
  'talent-pipeline/analysis': TalentAnalysisPage,
  // the wheels merged: runs + fleet + mileage + routes
  'transportation/routes': TransportationPage,
  // the shelf — free, licensed reading in Wellbeing
  'books/library': BooksPage,
  // the letters, rendered
  'email-designs/gallery': EmailDesignsPage,
  // the old platform's case-folder cabinet (gap survey §1) — a doc room
  'audit-library/library': AuditLibraryPage,
  // the widget bank
  'widgets/bank': WidgetsPage,
  'med-delegation/flows': MedDelPage,
  'support-requests/queue': RequestsPage,
  'medications/meds': MedicationsPage,
  // House Supplies under one black header: the registry's own list page as the Inventory tab, and the pharmacy's…
  'house-supplies/list': HouseSuppliesPage,
  // time off: the band and the request form, then every request with both approvals
  'timeoff/board': TimeOffPage,
  'timeoff/requests': TimeOffRequestsPage,
  'med-deliveries/deliveries': MedDeliveriesPage,
  // the correlation study, inside the Meds desk (kill list 7)
  'medications/correlation': MedCorrelationPage,
  // the workforce analytics deep view, inside Leadership (kill list 8)
  'leadership/workforce': WorkforcePage,
  // both read the same folded-from-rows shape (PoliciesPage picks by pageId)
  'policy-acks/documents': PoliciesPage,
  'policy-acks/contacts': PoliciesPage,
  // every Calendar Builder address is one page with one header over the named screen
  'calendarbuilder/smartcomms': CalendarBuilderPage,
  'calendarbuilder/builder': CalendarBuilderPage,
  'calendarbuilder/conflicts': CalendarBuilderPage,
  'calendarbuilder/requests': CalendarBuilderPage,
  'calendarbuilder/hours': CalendarBuilderPage,
  'calendarbuilder/staff': CalendarBuilderPage,
  'calendarbuilder/houses': CalendarBuilderPage,
  'calendarbuilder/house-cal': CalendarBuilderPage,
  'calendarbuilder/calendar': CalendarBuilderPage,
  'calendarbuilder/cards': CalendarBuilderPage,
  'calendarbuilder/timeline': CalendarBuilderPage,
  'calendarbuilder/coverage': CalendarBuilderPage,
  'calendarbuilder/week': CalendarBuilderPage,
  'ideal-meals/plates': MealsPage,
  'workout/movement': WorkoutPage,
  'sleep/rest': SleepPage,
  'hydration/intake': HydrationPage,
  'questionnaires/take': QuestionnairesPage,
  'questionnaires/responses': ResponsesPage,
  // personal space — resolves once the 'myasa' manifest (src/registry/apps-myasa.ts) is wired into…
  'myasa/home': MyAsaPage,
  // playground — EDIT IN PLAYGROUND studio (src/pages/features/playground)
  'playground/studio': PlaygroundPage,
  // release users — the admin-only door (src/pages/features/releaseusers)
  'release-users/release': ReleaseUsersPage,
  // the master's Credentials app, its second tab: any account's password reset, chosen anew at the next sign-in
  'credentials/resets': PasswordResetsPage,
  // a person's own PsiAnywhere sign-in and time clock (app/psi_log.py)
  'psi-log/clock': PsiLogPage,
  // …and what the collection keeps from PsiAnywhere, the master's alone (app/psi_harvest.py)
  'psi-log/staff': PsiDataPage,
  'psi-log/clients': PsiDataPage,
  'psi-log/other': PsiDataPage,
  'psi-log/entries': PsiEntriesPage,
  'psi-log/collect': PsiCollectPage,
  'psi-log/reset': PsiResetPage,
  'psi-log/new-client': PsiNewClientPage,
  // behind the resolver's guards, not a bare route: the access checker refuses anybody but the master (MASTER_ONLY_APPS)
  'app-control/board': AppControlPage,
  'production-actions/runbook': ProductionActionsPage,
  // the relay decides whose rows (/hub-lanes/my-work); no App Control row ships, so the master's until released
  'my-work/actions': MyWorkPage,
  // one screen with a left rail over three pages; the relay decides whose (/hub-lanes/my-profile), master's until released
  'my-profile/details': MyProfilePage,
  'my-profile/requirements': MyProfilePage,
  'my-profile/docs': MyProfilePage,
  // one person's week and own time off; the relay decides whose (/hub-lanes/my-calendar), master's until released
  'my-calendar/week': MyCalendarPage,
  // one screen, two views under one header; the relay decides whose alerts (/hub-lanes/my-inbox), master's until released
  'my-inbox/alerts': MyInboxPage,
  'my-inbox/chat': MyInboxPage,
  // one staff member at a time; behind the badge check here, never a static route, and the master's until released
  'staff-profiles/profile': StaffProfilesPage,
  // one house at a time; behind the badge check here, never a static route, and the master's until released
  'locations/overview': LocationsPage,
  // one referral at a time; behind the badge check here, never a static route, and the master's until released
  'client-candidates/profile': ClientCandidatesPage,
  // one client at a time; behind the badge check here, never a static route, and the master's until released
  'client-profiles/profile': ClientProfilesPage,
  // one SSA at a time; behind the badge check here, never a static route, and the master's until released
  'ssa-profiles/profile': SsaProfilesPage,
  // one family member at a time; behind the badge check here, never a static route, and the master's until released
  'family-profiles/profile': FamilyProfilesPage,
  // one candidate at a time; behind the badge check here, never a static route, and the master's until released
  'staff-candidates/profile': StaffCandidatesPage,
  // the interviewer's own desk — the narrow list + the one scorecard modal
  'interviews/board': InterviewsPage,
  // the compiled-in directory, reads nothing; no App Control row ships, so the master's until released
  'emergency-contacts/directory': EmergencyContactsPage,
  // each house's shifts, edited in place; no App Control row ships, so the master's until released
  'scheduling/calendar': SchedulingPage,
  // every hotline and scheduling request, decided in a side panel; no App Control row ships, so the master's until released
  'support-desk/requests': SupportDeskPage,
  // the Incident Log's reports in Support Requests' table; App Control's support-desk.incidents, the master's until released
  'support-desk/incidents': SupportIncidentsPage,
  // the team's vehicles: one screen, three pages; no App Control row ships, so the master's until released
  'vehicle-calendar/calendar': VehicleCalendarPage,
  'vehicle-calendar/history': VehicleCalendarPage,
  'vehicle-calendar/vehicles': VehicleCalendarPage,
  // the new hire's six steps, an APP now (chapter 21) — the same view the role lands on, reachable as a tile by…
  'onboarding/steps': OnboardingHome,
  // the family portal's home — their family member's care, in plain language (kill list 9; the scoping is the…
  'family/home': FamilyHomePage,
  // invoices — the old platform invoice catalog on Hub chrome (src/pages/features/invoices)
  'invoices/list': InvoicesPage,
  // finances — the old platform finance doc-hub on Hub chrome (src/pages/features/finances)
  'finances/overview': FinancesPage,
  // administration — the old platform workspace + the hub's document apps, one desk…
  'administration/workspace': AdministrationPage,
  // technology — the old platform Command Center + Tech Library on Hub chrome (src/pages/features/technology)
  'technology/center': TechnologyPage,
  // IST records — app view / raw sheet toggle on one page
  'ist/records': IstRecordsPage,
  // mail + docs reader
  'mail/inbox': MailPage,
  'docs/library': DocsReaderPage,
  // The real system log — reads `logsList` (sentences, people, areas) rather than the raw tab the Studio import…
  'logs/feed': SystemLogsPage,
  // Time Reconciliation — the punch × schedule × coverage audit queue (src/registry/apps-timerecon.ts).
  'time-recon/queue': TimeReconPage,
  // The essential HUB_DB tabs as spreadsheets — editing is badge-gated server-side (render_sheet_edit_badges).
  'render-sheet/sheets': RenderSheetPage,
  // the card's own spreadsheet, opened in the platform rather than in Drive
  'taskboard-sheet/sheet': TaskBoardSheetPage,
  // the Neural Cortex's own house — full-screen chat and the connectome; both talk to the relay's /cortex/* routes…
  'cortex/chat': CortexChatPage,
  'cortex/connectome': ConnectomePage,
  // the platform's health, watched
  'guardian/health': GuardianPage,
  // the PEOPLE's health, read the same way: which apps somebody actually uses, when their hours fall, whether their…
  'behavior/reading': BehaviorSupportPage,
  // the same reading with the HR record merged onto every person's card, as its own app.
  'user-support/people': UserSupportPage,
  // the compliance engine's face — the catalog, the matrix, the trail; all three talk to the GAS actions, never to…
  'compliance-engine/requirements': EngineRequirementsPage,
  'compliance-engine/states': EngineStatesPage,
  'compliance-engine/events': EngineEventsPage,
  // the Smart Comms desk + trail — the app got its face; it edits the SAME tab the Settings section edits
  'smartcomms/overview': SmartCommsPage,
  // the catalogue: everything the platform is able to say, grouped by species, with the three steps — switch one…
  'smartcomms/catalogue': SmartCommsCataloguePage,
  // what the platform WOULD say, in the words it would say it: the message sheet rendered person by person, one…
  'smartcomms/words': SmartCommsWordsPage,
  'smartcomms/activity': SmartCommsActivityPage,
  // the rehearsal: who the obligations lane WOULD contact, about what, and every reason it reached — read out of…
  'smartcomms/rehearsal': CommsBoardPage,
  // when each person can be told something without being disturbed, and the shift that proves it — the narrow…
  'smartcomms/when': SmartCommsWhenPage,
  // how the three fit together — the door, the words, the lane, the records
  'smartcomms/guide': SmartCommsGuidePage,
  // the demand owner's desk — what a reply proposed, and the owner's word
  'smartcomms/replies': SmartCommsRepliesPage,
  // the brake: who the send door refuses, and the words that put them there
  'smartcomms/stops': SmartCommsStopsPage,
  // THE WORDS WAITING FOR A PERSON — duplicated, never shared.
  'smartcomms/proposals': CommProposalsPage,
  // WHO CLOCKED IN AND WHO DID NOT.
  'smartcomms/punchboard': SmartCommsPunchBoardPage,
  // THE PUNCH RECORD — PsiAnywhere gets a screen of its own.
  'smartcomms/punches': PsiPunchesPage,
  // THE TWO BOOKS SIDE BY SIDE — PsiAnywhere combined with the call-off book on one page, which nothing else…
  'smartcomms/attendance': SmartCommsAttendancePage,
  // THE TWO AI-ANSWERED PHONE LINES, ONE INBOX — Call Offs, the Support Queue, Daily Notes and Incidents from the…
  'smartcomms/hotline': SmartCommsHotlinePage,
  'smartcomms/broadcast': SmartCommsBroadcastPage,
  'smartcomms/recruiting': SmartCommsRecruitingPage,
  // the old platform Reminders desk, on Hub rows
  'reminders/inbox': RemindersPage,
  'marketing/competitors': MarketingPage,
  // the field measured against us, and what the numbers argue for
  'marketing/analytics': MarketingAnalyticsPage,
  // the personal suite's product faces (worlds) — the data pages stay sheets
  ...PERSONAL_PAGES,
}

// The app id inside an `/app/:appId/:pageId` route; null for anything else (`/apps`, an empty registry fallback, a…
function routeAppId(route: string): string | null {
  const m = /^\/app\/([^/?#]+)/.exec(route)
  return m ? m[1] : null
}

// Would the guards below actually let this role THROUGH that route?
function canOpenRoute(
  route: string,
  apps: AppManifest[],
  role: Role | null | undefined,
): boolean {
  const m = /^\/app\/([^/?#]+)\/([^/?#]+)/.exec(route)
  if (!m) return false
  const [, id] = m
  const app = apps.find((a) => a.id === id)
  if (!app || !app.enabled) return false
  if (masterOnlyRefused(id)) return false
  if (!isManifestVisible(app, { role })) return false
  if (role === 'onboarding') return true   // rule 1 owns trainees; no rule narrows them
  return isAllowedWith(apps, role, id)
}

/** The Builder page for a reader it does not open to: the same house on House Calendars' Live view, said. */
function NotABuilder({ to }: { to: string }) {
  useEffect(() => {
    toast({ type: 'info', title: 'Not a house you build: showing its roster' })
  }, [])
  return <Navigate to={to} replace />
}

// Access-guard bounce: fires the denial toast once, then leaves for a door that is actually open.
function DeniedRedirect({ appId }: { appId: string }) {
  const role = useEffectiveRole()
  const apps = useRegistryStore((s) => s.apps)
  useBadgeRulesVersion()   // a matrix edit re-decides where this bounce lands
  useEffect(() => {
    toast({ type: 'danger', title: "You don't have access to that module." })
  }, [])

  // never bounce into a page this role also cannot see (that loop is what made a restricted account sit on a…
  const home = homeRouteFor(role)
  if (routeAppId(home) !== appId && canOpenRoute(home, apps, role)) {
    return <Navigate to={home} replace />
  }

  // /apps is the last lawful stop — unless it would be empty too, in which case parking them on a blank hub says…
  const reachable = visibleManifests(apps, { role }, selectAccessChecker(apps, role))
  if (reachable.length === 0) {
    return (
      <div className="mx-auto max-w-[480px] pt-16">
        <EmptyState
          title="No app is available to you"
          body="Your account doesn't have access to any module yet. Ask an administrator to grant you one."
        />
      </div>
    )
  }
  return <Navigate to="/apps" replace />
}

/** An address not offered to this session (My asa., Bookmarks) leaves quietly: My Work, else home, else the App Hub. */
export function NotOfferedRedirect() {
  const role = useEffectiveRole()
  const apps = useRegistryStore((s) => s.apps)
  useBadgeRulesVersion()
  const to = [MYASA_ELSEWHERE, homeRouteFor(role)]
    .find((r) => routeAppId(r) !== MYASA_APP_ID && canOpenRoute(r, apps, role)) ?? '/apps'
  return <Navigate to={to} replace />
}

export default function AppRoutePage() {
  const { appId, pageId } = useParams()
  const { search } = useLocation()
  const apps = useRegistryStore((s) => s.apps)
  // THE GUARD JUDGES THE EFFECTIVE PERSON: a deep link opened inside a member visit must be refused exactly as…
  const role = useEffectiveRole()
  useBadgeRulesVersion()   // re-render the guard when the badge matrix changes
  const liveMode = useLiveMode()
  const myAsa = useMyAsaOffered()
  const app = apps.find((a) => a.id === appId)
  if (appId === MYASA_APP_ID && !myAsa && !activeWorldId()) return <NotOfferedRedirect />

  // a chat push links My Inbox's chat; a session My Inbox does not open to reads that conversation on Chat
  const chatElsewhere = appId === 'my-inbox' && pageId === 'chat'
    ? inboxChatFallback(liveMode, (route) => canOpenRoute(route, apps, role), search) : null
  if (chatElsewhere) return <Navigate to={chatElsewhere} replace />
  // …and a link to Chat's conversation, for a session only My Inbox's chat opens to (a client's), reads it there
  const chatInInbox = appId === 'chat' && pageId === 'messages'
    ? chatAppFallback((route) => canOpenRoute(route, apps, role), search) : null
  if (chatInInbox) return <Navigate to={chatInInbox} replace />

  // The Simulator left the hiring app for its own tile — the old address keeps working.
  if (appId === 'hiring' && pageId === 'simulator') return <Navigate to="/app/simulator/simulator" replace />

  // System logs' Raw table became a VIEW of the one page — the bookmark keeps working AND still opens the table it…
  if (appId === 'logs' && pageId === 'raw') return <Navigate to="/app/logs/feed?view=table" replace />

  // Smart Comms' Call Offs page became a tab of the Hotline screen — a pin or a bookmark to the old page opens that…
  if (appId === 'smartcomms' && pageId === 'calloffs') return <Navigate to="/app/smartcomms/hotline?tab=calloffs" replace />

  // The engine's Events trail became a SOURCE of the system log.
  if (pageId === 'events' && (appId === 'compliance-engine' || appId === 'employee-tracker')
      && !(app?.enabled && app.pages.some((p) => p.id === 'events'))) {
    return <Navigate to="/app/logs/feed" replace />
  }

  // FOUR APPS BECAME RUNGS OF WORKFORCE COMPLIANCE and were put away.
  const moved = ABSORBED_BY_TRACKER[`${appId}/${pageId}`]
  if (moved && !(app?.enabled && app.pages.some((p) => p.id === pageId))) {
    const qs = window.location.hash.split('?')[1]
    return <Navigate to={`/app/employee-tracker/${moved}${qs ? `?${qs}` : ''}`} replace />
  }

  // old Shift Board addresses land on Calendar Builder, query and all, installed or not
  const movedTo = appId === 'shiftboard' && pageId && Object.hasOwn(SHIFT_BOARD_MOVED_TO, pageId)
    ? SHIFT_BOARD_MOVED_TO[pageId] : undefined
  if (movedTo) return <Navigate to={`/app/calendarbuilder/${movedTo}${search}`} replace />

  if (!app || !app.enabled) return <Navigate to="/apps" replace />
  // before the onboarding pass below, which skips the access checker
  if (masterOnlyRefused(app.id)) return <DeniedRedirect appId={app.id} />
  // audience guard (onboarding hard allow-list, staff tightening, …)
  if (!isManifestVisible(app, { role })) return <DeniedRedirect appId={app.id} />
  // badge + personal-denial guard: a deep link is refused the same way the sidebar refuses the tile — onboarding…
  if (role !== 'onboarding' && !isAllowedWith(apps, role, app.id)) return <DeniedRedirect appId={app.id} />

  const page = app.pages.find((p) => p.id === pageId)
  /** the page's own gate, after the app's: land on the first allowed page instead of a refusal */
  if ((page?.gate || page?.feature) && role !== 'onboarding' && !isAllowedWith(apps, role, app.id, page.id)) {
    // a Builder link for a reader who builds no house: that house's roster, on Live
    if (app.id === 'calendarbuilder' && page.id === 'builder' && isAllowedWith(apps, role, app.id, 'house-cal')) {
      return <NotABuilder to={liveForBuilderLink(search)} />
    }
    const open = allowedPages(app, role, selectAccessChecker(apps, role))[0]
    if (open) return <Navigate to={`/app/${app.id}/${open.id}`} replace />
    return <DeniedRedirect appId={app.id} />
  }
  if (!page) {
    return (
      <div className="mx-auto max-w-[480px] pt-16">
        <EmptyState
          title={`Page not found in ${app.name}`}
          body="This app doesn't register a page with that id. Pick one of its pages from the sidebar."
          action={app.pages[0] ? { label: `Open ${app.pages[0].title}`, href: `/app/${app.id}/${app.pages[0].id}` } : undefined}
        />
      </div>
    )
  }

  const Custom = CUSTOM_PAGES[`${app.id}/${page.id}`]
  if (Custom) return <Custom key={`${app.id}/${page.id}`} />

  // sheet mode as a button — one page, two dresses
  const sheet = SHEET_MODE[`${app.id}/${page.id}`]
  if (sheet) {
    return <SheetModePage key={`${app.id}/${page.id}`} page={page} pin={sheet.pin} pinTitle={sheet.pinTitle} />
  }

  // Clients is ONE page: whichever of the three page ids the URL names, the unified page answers with that view…
  if (app.id === 'clients') {
    return <ClientsPage key={`${app.id}/${page.id}`} initialView={page.id as ClientViewId} />
  }

  // HIRING IS ONE PAGE: whichever of the two governed page ids the URL names, the unified page answers with that…
  if (app.id === 'hiring' && (page.id === 'pipeline' || page.id === 'flow')) {
    return <HiringRoutePage key={`${app.id}/${page.id}`} pageId={page.id} />
  }

  // playground-published apps (custom-*): render the template with the sample rows persisted in the playground…
  if (app.id.startsWith('custom-')) return <PlaygroundAppPage key={`${app.id}/${page.id}`} />

  // THE COMPLIANCE MATRIX'S COURSES COME FROM THE `ist_config` TAB.
  if (page.id === 'matrix' && page.dataSource?.resource === 'certMatrix') {
    return <CertMatrixRoutePage key={`${app.id}/${page.id}`} page={page} />
  }

  return <PageRenderer key={`${app.id}/${page.id}`} schema={page} />
}


// The unified Hiring page under the MASTER's policy: same shape as the Clients policy gate, its own stores — each…
function HiringRoutePage({ pageId }: { pageId: string }) {
  const views = useHiringPolicyStore((s) => s.views)
  const fetched = useHiringPolicyStore((s) => s.fetched)
  const ensure = useHiringPolicyStore((s) => s.ensure)
  useEffect(() => { ensure() }, [ensure])
  if (fetched && (views as string[]).length === 0) return <DeniedRedirect appId="hiring" />
  // `flow` is not a view any more — it is the word for the ones that used to live behind its rail; a deep link to…
  const initial: HiringViewId = pageId === 'flow' ? 'table' : 'pipeline'
  return <HiringPage initialView={initial} />
}