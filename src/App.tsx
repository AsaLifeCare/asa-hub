// clientops-suite: imported FIRST so seed-ops3 self-registers its resources into extraSeeds before anything…
// NOTE: the registry modules pull useRegistryStore → useNotificationStore → @/lib/api, so ALL self-registering seed…
import '@/lib/prefsSync'
// the shell's ear for the chat — presence + the arrival notification
import '@/lib/chatPresence'
import '@/lib/seed-ops3'
// v7 opsdash wave: seed-fleet self-registers fleet resources into extraSeeds (same pattern as seed-ops3 — must stay…
import '@/lib/seed-fleet'
// v9 apiconn wave: seed-potclients self-registers `potentialClients` into extraSeeds (same pattern as…
import '@/lib/seed-potclients'
import '@/registry/apps-ops3'
// apps-opsdash registers the Dashboard manifest (Fleet & Mileage retired — Transportation shows it all).
import '@/registry/apps-opsdash'
// apps-potclients registers the Potential Clients manifest (same guard).
import '@/registry/apps-potclients'
// Guardian — the platform's health screen (same guard).
import '@/registry/apps-guardian'
import '@/registry/apps-forms'
// Compliance Engine — the catalog, the matrix, the trail (same guard).
import '@/registry/apps-engine'
// Client Finances — the money held on a client's behalf (same guard).
import '@/registry/apps-finance'
// Smart Shopper + Meal Tracker — personal apps, migrated.
import '@/registry/apps-personal'
// Leadership Dashboard — the week across the company (same guard).
import '@/registry/apps-leadership'
// IST Records — the training obligation per employee × client (same guard).
import '@/registry/apps-ist'
// App Control — every app, its category and audience (same guard).
import '@/registry/apps-appcontrol'
// Houses — the residential-house dossier (same guard).
import '@/registry/apps-houses'
import '@/registry/apps-timeoff'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { rememberReturn } from '@/lib/returnTo'
import { Suspense, useEffect, type ReactNode } from 'react'
import { loadSheetApps } from '@/lib/sheetApps'
import { bangLoad, placeLoad, startLiveUpdates } from '@/lib/snapshotClient'
import { useWorldStore } from '@/stores/useWorldStore'
import { useWorldOffered } from '@/lib/worldOffered'
import { isAwayTenant, useTenantStore } from '@/stores/useTenantStore'
import { useMemberStore } from '@/stores/useMemberStore'
import WorldHomePage, { WorldSwitchOverlay } from '@/pages/worlds/WorldHomePage'
import { Loader2 } from 'lucide-react'
import DialogHost from '@/components/shell/DialogHost'
import Layout from '@/components/Layout'
import AppRoutePage, { NotOfferedRedirect } from '@/pages/AppRoutePage'
import { useMyAsaOffered } from '@/lib/myAsaOffered'
import { lazyPage } from '@/lib/lazyPage'
import { useAuthStore } from '@/auth/useAuthStore'
import { useCan } from '@/auth/permissions'
import { homeRouteFor } from '@/lib/homeRoute'
import { useMatrixLanded } from '@/lib/matrixLanded'
import SessionGuard from '@/components/shared/SessionGuard'
import HubStrip from '@/components/shell/HubStrip'
import BeAnotherBar from '@/components/shell/BeAnotherBar'
import SiteFooter from '@/components/shared/SiteFooter'

// The pages below are their own chunks (lib/lazyPage): the shell above boots without them, and each arrives the…
const AppsPage = lazyPage(() => import('@/pages/AppsPage'))
const CallOffsPage = lazyPage(() => import('@/pages/features/clientops/CallOffsPage'))
const DrAppointmentsPage = lazyPage(() => import('@/pages/features/clientops/DrAppointmentsPage'))
const UiIncidentsPage = lazyPage(() => import('@/pages/features/clientops/UiIncidentsPage'))
const HouseRepairPage = lazyPage(() => import('@/pages/features/clientops/HouseRepairPage'))
const HousesPage = lazyPage(() => import('@/pages/features/houses/HousesPage'))
const ExpensesOverviewPage = lazyPage(() => import('@/features/ops/expenses/ExpensesOverviewPage'))
const ExpenseReportsPage = lazyPage(() => import('@/features/ops/expenses/ExpenseReportsPage'))
const InventorySuppliesPage = lazyPage(() => import('@/features/ops/inventory/InventorySuppliesPage'))
const InventoryMedicationsPage = lazyPage(() => import('@/features/ops/inventory/InventoryMedicationsPage'))
const OnboardingHome = lazyPage(() => import('@/pages/features/onboarding/OnboardingHome'))
const OpsDashPage = lazyPage(() => import('@/pages/features/opsdash/OpsDashPage'))
const GuardianPage = lazyPage(() => import('@/pages/features/guardian/GuardianPage'))
const FormsPage = lazyPage(() => import('@/pages/features/forms/FormsPage'))
const FormResponsesPage = lazyPage(() => import('@/pages/features/forms/FormResponsesPage'))
const LeadershipPage = lazyPage(() => import('@/pages/features/leadership/LeadershipPage'))
const FinancePortal = lazyPage(() => import('@/pages/features/finance/FinancePortal'))
const ShopperPage = lazyPage(() => import('@/pages/features/personal/ShopperPage'))
const MealsPage = lazyPage(() => import('@/pages/features/personal/MealsPage'))
const LearningPage = lazyPage(() => import('@/pages/features/learning/LearningPage'))
const TravelPage = lazyPage(() => import('@/pages/features/travel/TravelPage'))
const UsersPage = lazyPage(() => import('@/pages/features/users/UsersPage'))
const QuestionnairesPage = lazyPage(() => import('@/pages/features/questionnaire/QuestionnairesPage'))
const QuestionnaireResponsesPage = lazyPage(() => import('@/pages/features/questionnaire/ResponsesPage'))
const PotentialClientsPage = lazyPage(() => import('@/pages/features/potclients/PotentialClientsPage'))
const ClientsPage = lazyPage(() => import('@/pages/features/clients/ClientsPage'))
const StaffProfilePage = lazyPage(() => import('@/pages/features/users/ProfilePage'))
const LoginPage = lazyPage(() => import('@/pages/LoginPage'))
const InterviewSchedulerPage = lazyPage(() => import('@/pages/InterviewSchedulerPage'))
const RegisterPage = lazyPage(() => import('@/pages/RegisterPage'))
const ResetPage = lazyPage(() => import('@/pages/ResetPage'))
const WelcomePage = lazyPage(() => import('@/pages/WelcomePage'))
const NotificationsPage = lazyPage(() => import('@/pages/NotificationsPage'))
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage'))
const BookmarksPage = lazyPage(() => import('@/pages/BookmarksPage'))

/** Minimal boot spinner shown while the stored session is being revalidated. */
function BootScreen() {
  return (
    <div className="flex h-dvh flex-col items-center bg-bg">
      <Loader2 size={22} className="my-auto animate-spin text-primary" />
      <SiteFooter />
    </div>
  )
}

// Route guard: everything except /login requires a signed-in user.
function RequireAuth() {
  const user = useAuthStore((s) => s.user)
  const hydrated = useAuthStore((s) => s.hydrated)
  const location = useLocation()
  if (!user) {
    if (!hydrated) return <BootScreen />
    // a signed-out link's in-app target survives the sign-in (lib/returnTo)
    const from = location.pathname + location.search
    rememberReturn(from)
    return <Navigate to="/login" replace state={{ from }} />
  }
  return <Layout />
}

// Overview home switch: onboarding trainees get the dedicated 6-step OnboardingHome instead of the generic…
function OverviewHomeRoute() {
  const role = useAuthStore((s) => s.user?.role)
  // chapter 21: the six steps are the Onboarding APP now — a trainee landing on the old address is walked to the…
  return role === 'onboarding' ? <Navigate to="/app/onboarding/steps" replace /> : <AppRoutePage />
}

// THE ONBOARDING PORTAL, VISITABLE — the same access the onboarding@ account has, without logging out.
function OnboardingPortalRoute() {
  const role = useAuthStore((s) => s.user?.role)
  const mayVisit = useCan('hiring.onboardingPortal')
  if (role === 'onboarding') return <Navigate to="/app/onboarding/steps" replace />
  if (!mayVisit) return <Navigate to="/app/overview/home" replace />
  return <OnboardingHome />
}

/** Static custom screens sit outside the generic resolver — bounce trainees. */
function NotForOnboarding({ children }: { children: ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (role === 'onboarding') return <Navigate to="/app/onboarding/steps" replace />
  return <>{children}</>
}

// THE WORLD GUARD (USER WORLDS).
function CompanyOnly() {
  const worldId = useWorldStore((s) => s.currentWorldId)
  if (worldId) return <Navigate to="/apps" replace />
  return <Outlet />
}

/** The world's front door — only meaningful inside a world. */
function WorldHomeRoute() {
  const worldId = useWorldStore((s) => s.currentWorldId)
  const offered = useWorldOffered()
  if (!worldId || !offered) return <Navigate to="/apps" replace />
  return <WorldHomePage />
}

/** Bookmarks ride the session's own my_asa: a session it is not offered to leaves as if the page never existed. */
function BookmarksRoute() {
  const offered = useMyAsaOffered()
  return offered ? <BookmarksPage /> : <NotOfferedRedirect />
}

// People → Users → General, search preserved (?record= keeps opening the same person's panel inside the absorbed…
function PeopleRedirect() {
  const qs = window.location.hash.split('?')[1]
  return <Navigate to={`/app/users/accounts?${qs ? qs + '&' : ''}sec=general`} replace />
}

// The PerformanceRedirect that lived here was REVERTED: the Staff Performance app came back, and an app whose own…

/** Catch-all: home depends on the role (restricted roles have their own), chosen once the session's matrix landed. */
function HomeRedirect() {
  const signedIn = useAuthStore((s) => Boolean(s.user))
  const role = useAuthStore((s) => s.user?.role)
  const landed = useMatrixLanded()
  if (signedIn && !landed) return <BootScreen />
  return <Navigate to={homeRouteFor(role)} replace />
}

export default function App() {
  // one revalidation per app load — the stored token decides the real session
  const bootstrap = useAuthStore((s) => s.bootstrap)
  const token = useAuthStore((s) => s.token)
  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // Apps defined in the `app_builder` sheet, merged into the registry once a session exists (reading them needs…
  const worldId = useWorldStore((s) => s.currentWorldId)
  // AND NOT IN A FRANCHISE EITHER: the questionnaire app inside a franchise came up carrying six of the…
  const awayTenant = useTenantStore(isAwayTenant)
  const tenantHere = useTenantStore((st) => st.currentTenantId)
  // AND THE PERSON YOU ARE STANDING IN (last of the three axes).
  const visitingId = useMemberStore((st) => st.currentMemberId)
  useEffect(() => {
    // IN A WORLD neither lane applies: app_builder rows are company apps (the registry's world filter would strip…
    if (token && visitingId) {
      // one fetch for the person whose workspace this is; the guard in lib/snapshotClient only lets a slice answer…
      void placeLoad({ member: visitingId })
    } else if (token && !worldId && !awayTenant) {
      void loadSheetApps()
      // THE JSON LANE RUNS AT HOME TOO — the JSON runs ALL THE TIME, and it has to run for EVERYBODY, all the time.
      void placeLoad({})
      // THE BANG: one fetch of /snapshot/all.json seeds every slice this role may read — the whole site's data is…
      void bangLoad()
    } else if (token) {
      // AND THE SAME FOR A WORLD OR A FRANCHISE.
      void placeLoad({ world: worldId || undefined, tenant: awayTenant ? tenantHere : undefined })
    }
  }, [token, worldId, awayTenant, visitingId])

  // LIVE UPDATES, for as long as somebody is signed in.
  useEffect(() => {
    // the stream announces COMPANY snapshot turnover — noise inside a world, and in a franchise it is worse than…
    if (!token || worldId || awayTenant) return
    return startLiveUpdates()
  }, [token, worldId, awayTenant])

  return (
    <>
    {/* the curtain for a session swapped under this tab */}
    <SessionGuard />
    {/* "New version launched, transferring..." while a part is coming up */}
    <HubStrip />
    {/* "Acting as <name> — Be Back" on every screen while the master wears another account */}
    <BeAnotherBar />
    {/* a public page's code arriving draws the boot spinner; the signed-in
        routes have their own boundary per route inside Layout */}
    <Suspense fallback={<BootScreen />}>
    <Routes>
      {/* public entry pages (standalone, no app shell) */}
      <Route path="/" element={<WelcomePage />} />
      <Route path="/login" element={<LoginPage />} />
      {/* the candidate's interview calendar — PUBLIC by design:
          it authenticates by the single-event token in its URL,
          never by a session. Declared before RequireAuth so the generic
          /app/:appId/:pageId resolver can never swallow it into a login. */}
      <Route path="/app/calendario/interview" element={<InterviewSchedulerPage />} />
      {/* REGISTRATION — public by design (Invites.gs): it
          authenticates by the single-use token in its own URL, because the
          account does not exist until this screen is answered. Declared
          before RequireAuth so no guard can turn it into a login. */}
      <Route path="/register" element={<RegisterPage />} />
      {/* the forgot-password link opens here — public, single-use token */}
      <Route path="/reset" element={<ResetPage />} />
      <Route element={<RequireAuth />}>
        {/* USER WORLDS: the world's front door — a static route INSIDE the
            world exemption (declared before the CompanyOnly group, rendered
            only while a world is active). */}
        <Route path="/app/world-home/home" element={<WorldHomeRoute />} />
        <Route element={<CompanyOnly />}>
        {/* ops-apps: expenses & inventory pages are custom feature screens
            (gated mutations, working modals) — static routes win over the
            generic /app/:appId/:pageId resolver below. */}
        <Route path="/app/expenses/overview" element={<NotForOnboarding><ExpensesOverviewPage /></NotForOnboarding>} />
        <Route path="/app/expenses/reports" element={<NotForOnboarding><ExpenseReportsPage /></NotForOnboarding>} />
        <Route path="/app/inventory/supplies" element={<NotForOnboarding><InventorySuppliesPage /></NotForOnboarding>} />
        <Route path="/app/inventory/medications" element={<NotForOnboarding><InventoryMedicationsPage /></NotForOnboarding>} />
        {/* clientops-suite: the ORIGINAL rich screens
            are back — renovated to read the real estate mirrors (no seed, no
            fallback), read-only until the cutover. Back to the earlier
            layouts — the app look, on the real rows. */}
        <Route path="/app/call-offs/log" element={<NotForOnboarding><CallOffsPage /></NotForOnboarding>} />
        <Route path="/app/dr-appointments/upcoming" element={<NotForOnboarding><DrAppointmentsPage /></NotForOnboarding>} />
        <Route path="/app/ui-incidents/log" element={<NotForOnboarding><UiIncidentsPage /></NotForOnboarding>} />
        <Route path="/app/house-repair/orders" element={<NotForOnboarding><HouseRepairPage /></NotForOnboarding>} />
        {/* Houses: the residential-house dossier — bespoke screen, static
            route wins over the generic resolver. */}
        <Route path="/app/houses/dossier" element={<NotForOnboarding><HousesPage /></NotForOnboarding>} />
        {/* v7 opsdash: bespoke "today at a glance" dashboard — static route
            wins over the generic resolver (fleet rides the sheet template). */}
        <Route path="/app/opsdash/today" element={<NotForOnboarding><OpsDashPage /></NotForOnboarding>} />
        {/* Guardian: the platform's health — bespoke screen, static route
            wins over the generic resolver. */}
        <Route path="/app/guardian/health" element={<NotForOnboarding><GuardianPage /></NotForOnboarding>} />
        <Route path="/app/forms/links" element={<NotForOnboarding><FormsPage /></NotForOnboarding>} />
        <Route path="/app/forms/answers" element={<NotForOnboarding><FormResponsesPage /></NotForOnboarding>} />
        {/* Leadership: the week across the company — static route, same
            pattern; the manifest's sheet schema is only the graceful fallback.
            The path is /overview because a local playground draft already
            taught at least one browser that link — the static route wins over
            ANY manifest, so the link people have renders the real screen. */}
        <Route path="/app/leadership/overview" element={<NotForOnboarding><LeadershipPage /></NotForOnboarding>} />
        <Route path="/app/leadership/board" element={<Navigate to="/app/leadership/overview" replace />} />
        {/* /app/performance/board has NO static route, on
            purpose. It goes through the generic resolver, where the answer is
            STATE-AWARE: with the app put away, the ABSORBED_BY_TRACKER alias
            redirects to /app/employee-tracker/board (query carried); the day
            somebody reinstalls it from /apps, the app answers at its own
            address again via CUSTOM_PAGES. A static route cannot make that
            distinction — it was exactly how the reinstall switch became a
            switch that did nothing. */}
        <Route path="/app/users/accounts" element={<NotForOnboarding><UsersPage /></NotForOnboarding>} />
        {/* The questionnaire suite shipped with its screens written but its
            routes never wired, so the app rendered as a plain table of
            questionnaires — you could see that one existed and never open or
            edit it. The runner (and its admin edit mode) lives here. */}
        <Route path="/app/questionnaires/take" element={<NotForOnboarding><QuestionnairesPage /></NotForOnboarding>} />
        <Route path="/app/onboarding/portal" element={<OnboardingPortalRoute />} />
        <Route path="/app/questionnaires/responses" element={<NotForOnboarding><QuestionnaireResponsesPage /></NotForOnboarding>} />
        {/* v9 apiconn: Potential Clients — bespoke screen pairing the API
            connection card with the engine sheet (static route wins over the
            generic resolver; the manifest route stays as graceful fallback). */}
        {/* Client Finances — bespoke screen. This route is the ONLY way in:
            there is no `financeClients` resource, so removing it does not fall
            back to a generic table, it fails. See registry/apps-finance.ts. */}
        {/* Personal apps: per-person data, no role gate — the server's
            `ownedBy` is the boundary, not the route. */}
        <Route path="/app/shopper/list" element={<NotForOnboarding><ShopperPage /></NotForOnboarding>} />
        <Route path="/app/learning/skills" element={<NotForOnboarding><LearningPage /></NotForOnboarding>} />
        <Route path="/app/travel/trips" element={<NotForOnboarding><TravelPage /></NotForOnboarding>} />
        <Route path="/app/meals/day" element={<NotForOnboarding><MealsPage /></NotForOnboarding>} />
        <Route path="/app/finance/portal" element={<NotForOnboarding><FinancePortal /></NotForOnboarding>} />
        <Route path="/app/potential-clients/pipeline" element={<NotForOnboarding><PotentialClientsPage /></NotForOnboarding>} />
        {/* Clients is ONE page now: the old record/unique routes
            render the unified page with the matching view preselected, so
            every bookmark and row action lands exactly where it always did */}
        <Route path="/app/clients/record" element={<NotForOnboarding><ClientsPage initialView="record" /></NotForOnboarding>} />
        <Route path="/app/clients/unique" element={<NotForOnboarding><ClientsPage initialView="unique" /></NotForOnboarding>} />
        {/* the Hiring Flow view mounts via CUSTOM_PAGES in AppRoutePage —
            through the audience + access-matrix guards, not a bare route */}
        {/* the staff profile — one user, opened from the Users table; the
            page guards itself (admin only), like the Users app's audience */}
        <Route path="/app/users/profile" element={<NotForOnboarding><StaffProfilePage /></NotForOnboarding>} />
        {/* People was ABSORBED into Users → General — every old
            link, bookmark and ?record= deep link lands on the same directory
            inside Users, search string intact */}
        <Route path="/app/people/directory" element={<PeopleRedirect />} />
        {/* The scraper's control surface was REMOVED from the routes
            together with the sub-menu it belonged to. Leaving the route
            behind would keep a bookmark opening a screen that duplicates
            Settings → Lead Scraper — the same four buttons in a second place,
            which is exactly how two truths start. The component stays on disk,
            unrouted. This URL now falls to /app/:appId/:pageId, which finds no
            such page in the manifest and says so. */}
        {/* onboarding trainees land on the 6-step OnboardingHome */}
        <Route path="/app/overview/home" element={<OverviewHomeRoute />} />
        </Route>
        {/* the generic resolver stays OUTSIDE the world guard: it reads the
            registry, and in a world the registry serves only world apps */}
        <Route path="/app/:appId/:pageId" element={<AppRoutePage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/bookmarks" element={<BookmarksRoute />} />
        <Route path="*" element={<HomeRedirect />} />
      </Route>
    </Routes>
    </Suspense>
    {/* Outside the router and outside RequireAuth: the login and onboarding
        screens ask questions too, and this platform does not use the
        browser's dialogs anywhere. */}
    <DialogHost />
    {/* The world traveler's big loading — covers a switch started from the
        sidebar tiles or the avatar menu until the SPA reboots. */}
    <WorldSwitchOverlay />
    </>
  )
}
