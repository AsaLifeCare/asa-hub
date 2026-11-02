// App shell layout (§7): fixed sidebar + topbar, main content scrolls internally (body never scrolls).
// Page-transition wrapper (§9.5): fade+y on route change, 280ms easeOutExpo.
import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Sparkles, X } from 'lucide-react'
import Sidebar from '@/components/shell/Sidebar'
import Topbar from '@/components/shell/Topbar'
import NotificationPanel from '@/components/shell/NotificationPanel'
import CommandPalette from '@/components/shell/CommandPalette'
import DetailPanel from '@/components/shell/DetailPanel'
import Toasts from '@/components/shell/Toasts'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import { PageSkeleton } from '@/components/shared/Skeleton'
import SiteFooter from '@/components/shared/SiteFooter'
import { useTenantStore } from '@/stores/useTenantStore'
import { roleWordCounts } from '@/lib/badgeAccess'
import ShareSheet from '@/components/shared/ShareSheet'
// the roster backs person recognition everywhere (lib/personNames) — warmed once here so the first table already…
import { primeRoster } from '@/lib/personNames'
// fill the cache while nobody is looking, so arriving at a screen renders
import { warmFor } from '@/lib/prefetch'
import { prefetchOwnPacks } from '@/lib/appPack'
import { useRegistryStore } from '@/stores/useRegistryStore'
import FileViewer from '@/components/shared/FileViewer'
import EmailComposeModal from '@/components/shared/EmailComposeModal'
import AssistBar, { NO_ASSIST_BAR } from '@/components/shell/AssistBar'
import DraftPostIt from '@/components/shell/DraftPostIt'
import MustChangePasswordGate from '@/features/auth/MustChangePasswordGate'
import FirstLoginTour from '@/features/auth/FirstLoginTour'
import NotificationAsk from '@/features/auth/NotificationAsk'
import { cn } from '@/lib/utils'
import { useAssistBarStore } from '@/stores/useAssistBarStore'
import { useMembersRoster } from '@/stores/useMembersRoster'
import { useShellStore } from '@/stores/useShellStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMediaQuery } from '@/hooks/use-mobile'
import { EASE_OUT_EXPO } from '@/engine/motion'

const MAIN_SCROLL_ID = 'main-scroll'
const BACK_TO_TOP_THRESHOLD = 600

// Mobile (<lg) off-canvas nav drawer: scrim + slide-over from the left hosting the same sidebar content (expanded).
function MobileDrawer() {
  const drawerOpen = useShellStore((s) => s.drawerOpen)
  const setDrawerOpen = useShellStore((s) => s.setDrawerOpen)

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen, setDrawerOpen])

  return (
    <AnimatePresence>
      {drawerOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          />
          <motion.div
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="fixed inset-y-0 left-0 z-50 w-[280px] shadow-3 lg:hidden"
          >
            <Sidebar mobile />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/** Floating "back to top" — appears after 600px of scroll in #main-scroll. */
function BackToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = document.getElementById(MAIN_SCROLL_ID)
    if (!el) return
    const onScroll = () => setShow(el.scrollTop > BACK_TO_TOP_THRESHOLD)
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.9 }}
          transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          onClick={() =>
            document.getElementById(MAIN_SCROLL_ID)?.scrollTo({ top: 0, behavior: 'smooth' })
          }
          aria-label="Back to top"
          className="fixed bottom-20 right-4 z-40 grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-text-2 shadow-2 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1 sm:bottom-6 sm:right-6"
        >
          <ArrowUp size={16} />
        </motion.button>
      )}
    </AnimatePresence>
  )
}

// Evident caregiver mode (role 'staff'): slim tint banner directly under the Topbar so caregivers always know the…
function CaregiverBanner() {
  const role = useAuthStore((s) => s.user?.role)
  // an SSA or a family member signed in on role staff wears SSA or FAMILY: not a caregiver (badgeAccess.roleWordCounts)
  const family = useAuthStore((s) => !roleWordCounts(s.user))
  const [dismissed, setDismissed] = useState(false)
  const [more, setMore] = useState(false)

  if (role !== 'staff' || family || dismissed) return null

  return (
    <div className="shrink-0 border-b border-border bg-tint-primary">
      <div className="flex items-center gap-2.5 px-4 py-2 sm:px-6 2xl:px-8">
        <Sparkles size={14} className="shrink-0 text-tint-fg-primary" />
        <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-5 text-tint-fg-primary">
          Caregiver workspace — you&apos;re seeing your schedule, your clients and your courses.
        </p>
        <button
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-tint-fg-primary transition-colors hover:bg-primary-soft"
        >
          Learn more
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss caregiver banner"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-tint-fg-primary transition-colors hover:bg-primary-soft"
        >
          <X size={13} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {more && (
          <motion.p
            key="caregiver-more"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
            className="overflow-hidden px-4 text-[12px] leading-5 text-tint-fg-primary sm:px-6 2xl:px-8"
          >
            <span className="block pb-2.5 pl-[26px]">
              This workspace is filtered for caregivers: admin tools like Expenses, Inventory, Task
              Board, Image Bank, Certifications and Hiring stay out of your way, while Overview,
              People, Schedule, Academy, Knowledge and Clients remain one tap away.
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Layout() {
  const assistBarOn = useAssistBarStore((st) => st.enabled)
  const collapsed = useShellStore((s) => s.sidebarCollapsed)
  // TWO COLUMNS NOW, AND THE PAGE IS MEASURED FROM BOTH.
  const railExpanded = useShellStore((s) => s.railExpanded)
  // AND THE RAIL ONLY EXISTS WITH TWO PEOPLE ON THE PLATFORM.
  const memberCount = useMembersRoster((s) => s.rows)?.length ?? 0
  // the same guard the Sidebar takes: a rail that switches on before this account has been asked reserves a column…
  const rosterVersion = useMembersRoster((s) => s.version)
  const railW = rosterVersion > 0 && memberCount >= 2 ? (railExpanded ? 216 : 60) : 0
  const shellW = railW + (collapsed ? 76 : 264)
  const setDrawerOpen = useShellStore((s) => s.setDrawerOpen)
  const fetchAll = useNotificationStore((s) => s.fetchAll)
  const { pathname } = useLocation()
  // …and not on the screens that hide it: the floor it reserves was empty page under a bar nobody draws…
  const assistBarHere = assistBarOn && !NO_ASSIST_BAR.some((r) => pathname.startsWith(r))
  // sidebar offset applies only at lg+; below lg the sidebar is a drawer
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  useEffect(() => {
    fetchAll()
    // person recognition is roster-backed; warm it once so the first table already knows who is a person (never…
    primeRoster()
    // The tenant directory loads at BOOT, not only when Settings opens at all: the traveler's scoping may only act…
    void import('@/lib/bootPull')
      .then(({ bootPull }) => bootPull(useAuthStore.getState().token))
      .then((parts) => {
        if (!parts.tenants) void useTenantStore.getState().loadTenants().catch(() => {})
      })
      .catch(() => { void useTenantStore.getState().loadTenants().catch(() => {}) })
  }, [fetchAll])

  // a client-role session's own views of its apps, asked of the relay's memory once per signed-in identity
  const identity = useAuthStore((s) => `${s.user?.id ?? ''}:${s.token ?? ''}`)
  useEffect(() => {
    prefetchOwnPacks()
  }, [identity])

  // navigating closes the mobile drawer
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname, setDrawerOpen])

  // Warm the screens this person is likely to open next — the rest of the app they are in first, then the apps…
  const apps = useRegistryStore((s) => s.apps)
  useEffect(() => {
    const currentAppId = pathname.split('/')[2]
    const t = setTimeout(() => warmFor(apps, currentAppId), 1200)
    return () => clearTimeout(t)
  }, [apps, pathname])

  return (
    // the strip at the top (shell/HubStrip) pushes the shell down while it is up
    <div className="flex h-[100dvh] overflow-hidden bg-bg" style={{ paddingTop: 'var(--hub-strip-h, 0px)' }}>
      <Sidebar />
      <MobileDrawer />
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col transition-[padding] duration-300"
        style={{ paddingLeft: isDesktop ? shellW : 0 }}
      >
        <Topbar />
        <CaregiverBanner />
        <main id={MAIN_SCROLL_ID} className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
            // the assist bar RESERVES its floor — it used to sit over a table's last rows with no way past it, so…
            className={cn(
              'flex min-h-full flex-col px-4 py-4 sm:px-6 sm:py-6 2xl:px-8 has-[[data-floating-bar]]:pb-24',
              assistBarHere && 'pb-24 sm:pb-24',
            )}
          >
            {/* the screen keeps block flow in its own box; the box grows so
                the footer ends a short page at the bottom and a long one
                after its last row — always above the assist bar's floor */}
            <div className="min-w-0 flex-1">
              {/* keyed on the route: a screen that crashed gets a clean slate
                  as soon as the reader navigates away, instead of staying broken */}
              <ErrorBoundary key={pathname} label="This screen">
                {/* one boundary per route (remounted with the ErrorBoundary's
                    key): a page whose code is still arriving (lib/lazyPage)
                    draws the skeleton here while the shell stays up */}
                <Suspense fallback={<PageSkeleton type="sheet" />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </div>
            {/* h-10 is the height the viewport-fit screens (Chat, Mail, …)
                subtract; on phones the back-to-top button floats just above
                the assist bar, so the line sits clear of it */}
            <SiteFooter className={cn('h-10 pb-0 pt-6', assistBarHere && 'max-sm:mb-8')} />
          </motion.div>
        </main>
      </div>
      <BackToTop />
      <NotificationPanel />
      <DetailPanel />
      <CommandPalette />
      <ShareSheet />
      <FileViewer />
      <EmailComposeModal />
      <AssistBar />
      {/* The unfinished-work sliver: a thin amber tab on the right edge when
          something typed somewhere else was never saved. */}
      <DraftPostIt />
      {/* Over EVERY route, as a page: an account signed in with a temporary
          password opens nothing until it has one of its own. */}
      <MustChangePasswordGate />
      {/* AFTER the password, never beside it: the gate owns the screen until
          it is satisfied, and the tour keys on `mustChangePassword` being
          false so the two can never argue over the same moment. */}
      <FirstLoginTour />
      {/* after the tour: the one-time notifications question */}
      <NotificationAsk />
      <Toasts />
    </div>
  )
}
