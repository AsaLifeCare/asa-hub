/**
 * Topbar (§7.2): breadcrumb, global search trigger, Copilot pill (side sheet),
 * theme toggle (sun/moon morph, cycles light→dark→system→auto), bell + unread
 * badge + wiggle, avatar menu. Gains blur + hairline after 8px scroll.
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, Building2, Check, CheckCheck, ExternalLink, House, LogOut, Menu, Monitor, Moon, Search, Settings as Gear, Sparkles, Sun, SunMoon, UserRound } from 'lucide-react'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { visibleNotifications } from '@/lib/notificationVisibility'
import { useShellStore } from '@/stores/useShellStore'
import { useThemeStore, type ThemeMode } from '@/stores/useThemeStore'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { useTenantStore, tenantShortName } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { firstNameOf } from '@/lib/standing'
import { crossHome, crossToMyWorld, crossToTenant, leaveVisit } from '@/lib/crossPlace'
import { worldOfferedTo } from '@/lib/worldOffered'
import { myAsaOfferedTo } from '@/lib/myAsaOffered'
import { homeRouteFor } from '@/lib/homeRoute'
import { toast } from '@/stores/useToastStore'
import { useUserMenuItems, type UserMenuItem } from '@/stores/useUserMenuStore'
import { tenantById } from '@/lib/tenancy'
import { useAuthStore } from '@/auth/useAuthStore'
import { clearSearches, listSearches } from '@/lib/searchHistory'
import { ohioDateTime } from '@/lib/ohio'
import { HighestBadge } from '@/components/shared/RoleBadge'
import { useProfileSheetStore } from '@/stores/useProfileSheetStore'
import { isRestrictedRole } from '@/lib/roleAccess'
import { badgeLinkAllows } from '@/lib/badgeAccess'
import { masterOnlyRefused } from '@/lib/appAccess'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import ProfileSheet from '@/features/profile/ProfileSheet'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import WeatherChip from '@/components/shell/WeatherChip'
import VersionChip from '@/components/shell/VersionChip'
import ClockChip from '@/components/shell/ClockChip'
import CortexChat from '@/components/shell/CortexChat'
import ConnectomePulse from '@/components/shell/ConnectomePulse'
import { revalidateLive } from '@/lib/api'
import { AppIcon } from '@/lib/icons'
import { useSectionCrumbFor } from '@/lib/sectionCrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const MODE_ICON: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor, auto: SunMoon }
const MODE_LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System', auto: 'Auto (night)' }

export function Breadcrumb() {
  const { pathname } = useLocation()
  const apps = useRegistryStore((s) => s.apps)
  // subscribed so the verdict below re-runs on a sign-in, a visit or a world crossing
  useEffectiveIsMaster()
  useWorldStore((s) => s.currentWorldId)
  // the section the page itself names (its open tab), over the route's own page title
  const section = useSectionCrumbFor(pathname)
  const parts = pathname.split('/').filter(Boolean)
  let appName = 'asa.'
  let pageTitle = ''
  if (parts[0] === 'app') {
    // drawn from the URL before the route guard answers: a refused master-only app is not named for that frame
    const app = masterOnlyRefused(parts[1] ?? '') ? undefined : apps.find((a) => a.id === parts[1])
    const page = app?.pages.find((p) => p.id === parts[2])
    appName = app?.name ?? 'App'
    pageTitle = (app && section) || page?.title || ''
  } else {
    pageTitle = { apps: 'App Hub', notifications: 'Notifications', settings: 'Settings' }[parts[0] ?? ''] ?? ''
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {/* root crumb hidden on phones — breadcrumb truncates to the current page */}
      <span className={cn('shrink-0 text-text-3', pageTitle && 'hidden sm:inline')}>{appName}</span>
      {pageTitle && (
        <>
          <span className="hidden text-text-3 sm:inline">›</span>
          <span className="clamp-1 text-[15px] font-semibold text-text-1">{pageTitle}</span>
        </>
      )}
    </div>
  )
}

export default function Topbar() {
  const [scrolled, setScrolled] = useState(false)
  // the unlink asks twice, and forgets the first press when the menu closes
  const [unlinkArmed, setUnlinkArmed] = useState(false)
  const { mode, cycle } = useThemeStore()
  // Counted over the SAME set the panel shows.
  const allNotifs = useNotificationStore((s) => s.items)
  const notifApps = useRegistryStore((s) => s.apps)
  const unread = useMemo(
    () => visibleNotifications(allNotifs, notifApps).filter((n) => !n.read).length,
    [allNotifs, notifApps],
  )
  const arrivalTick = useNotificationStore((s) => s.arrivalTick)
  const { setPaletteOpen, notifPanelOpen, setNotifPanelOpen, setDrawerOpen } = useShellStore()
  const demoFallback = useApiConfigStore((s) => s.demoFallback)

  // The chip heals itself: while it is on, re-check every 30s.
  useEffect(() => {
    if (!demoFallback) return
    const beat = () => { void revalidateLive() }
    beat()
    const t = setInterval(beat, 30_000)
    return () => clearInterval(t)
  }, [demoFallback])
  const driver = useApiConfigStore((s) => s.driver)
  const tenantId = useTenantStore((s) => s.currentTenantId)
  // "Away from home" compares against the ADOPTED home row, not the constant — the account's own HQ row is home…
  const homeTenantId = useTenantStore((s) => s.homeTenantId)
  const activeTenant = tenantId !== homeTenantId ? tenantById(tenantId) : undefined
  // shared with the assist bar (useShellStore) — one Copilot, two doors
  const copilotOpen = useShellStore((st) => st.copilotOpen)
  const setCopilotOpen = useShellStore((st) => st.setCopilotOpen)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const openProfile = useProfileSheetStore((s) => s.setOpen)
  // Restricted roles (interview day, portals): their app + search + their own profile.
  const restricted = isRestrictedRole(user?.role)
  const navigate = useNavigate()
  // USER WORLDS — from a profile one navigates between the three: the company, the Franchise Akron tenant, and…
  const worldId = useWorldStore((s) => s.currentWorldId)
  const memberName = useMemberStore((s) => s.memberName)
  // the same grants as the sidebar stack: master always; My world by the session's own answer, the franchise by…
  const canWorld = worldOfferedTo(user)
  const canMyAsa = myAsaOfferedTo(user)
  const canFranchise = Boolean(user?.isMaster || user?.franchiseView)
  const tenants = useTenantStore((s) => s.tenants)
  // franchises are admin-only travel; managers reach branches (visibleTenants' law)
  const travelTenant = canFranchise
    ? tenants.find((t) => t.id !== homeTenantId) ?? null
    : null
  // master-managed links (Settings → User menu links, server-held) — one list for the whole platform, filtered per…
  const goHome = () =>
    crossHome(`Coming home to ${tenantById(homeTenantId)?.name ?? 'ASA LifeCare'}`)

  // HOME — one press back to the home PAGE and APP, fixed for 100% of accounts and never a preference.
  const goHomePage = () => {
    if (worldId || memberName || (homeTenantId && tenantId !== homeTenantId)) {
      goHome()
      return
    }
    navigate(homeRouteFor(user?.role))
  }

  const userMenuItems = useUserMenuItems(tenantId)
  // THE LINKS, FILTERED BY THE ONE CHECKER — and by exactly the rule they have always been filtered by.
  const visibleMenuItems = userMenuItems.filter((it) => badgeLinkAllows(it.badges, user))

  const openUserMenuItem = (it: UserMenuItem) => {
    if (it.external) window.open(it.href, '_blank', 'noopener,noreferrer')
    else navigate(it.href)
  }

  const signOut = () => {
    logout()
    navigate('/', { replace: true })
  }

  // The link goes, and then the visit cannot keep standing: crossHome leaves all three axes at once…
  const unlinkMember = async () => {
    const id = useMemberStore.getState().currentMemberId
    const who = useMemberStore.getState().memberName || 'They'
    if (!id) return
    try {
      const { gasAction } = await import('@/features/hiring/shared')
      await gasAction('platformMemberRemove', { member_id: id })
      toast({ type: 'info', title: 'Removed from your platform',
              body: `${who} keeps their account, ${canWorld ? 'world and ' : ''}apps.` })
      crossHome()
    } catch (e) {
      setUnlinkArmed(false)
      toast({ type: 'danger', title: 'Could not remove them',
              body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  useEffect(() => {
    const scroller = document.getElementById('main-scroll')
    if (!scroller) return
    const onScroll = () => setScrolled(scroller.scrollTop > 8)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  const ModeIcon = MODE_ICON[mode]

  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-[68px] shrink-0 items-center gap-2 border-b px-3 transition-colors duration-200 sm:px-5',
        scrolled ? 'border-border bg-bg/80 backdrop-blur-md' : 'border-transparent bg-bg',
      )}
    >
      {/* mobile nav drawer trigger (off-canvas sidebar below lg) */}
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label="Open navigation menu"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-text-2 transition-colors duration-150 hover:bg-surface-2 lg:hidden"
      >
        <Menu size={19} />
      </button>
      <Breadcrumb />

      <div className="ml-auto flex items-center gap-1.5">
        {/* the software version, before the sky — the master's alone */}
        <VersionChip />
        {/* live Columbus sky — renders nothing unless the person turned it on
            in Settings → Appearance AND a real forecast exists */}
        <WeatherChip />
        {/* the clock rides beside the sky, and closes up on the search when
            the sky is off */}
        <ClockChip />
        {/* THE PLACE CHIP SITS BEFORE THE SEARCH — My world moves in front,
            because otherwise two stars sit together while serving different
            purposes: it used to land next to the Copilot
            star, two lavender circles side by side saying different things.
            A WORLD outranks a tenant — it should read "My world" in the
            lavender description — so inside a world
            the chip is the world's, lavender, and opens World Home; on
            company ground the away-tenant chip stands as before. */}
        {/* THE PERSON YOU ARE VISITING outranks both, at the top right as
            well — their name is the plainest answer
            to "whose screen am I looking at". */}
        {/* WHOSE WORLD, NOT JUST WHOSE WORK — "Their world" used to show the
            signed-in world instead. Every world is seeded with the
            same twelve personal apps, so two worlds look alike by
            construction and the ONLY thing that can tell them apart is a
            label. This chip said the visited person's name for their work and
            "My world" for every world — including theirs. Now the two states
            a visit can be in are named apart, and the world state never
            claims to be mine when it is not. */}
        {memberName && worldId ? (
          <button
            onClick={() => leaveVisit()}
            title={`You are in ${memberName}'s world — leave`}
            className="hidden h-9 items-center gap-1.5 rounded-full bg-tint-lavender px-3 text-[13px] font-semibold text-tint-fg-lavender transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98] sm:flex"
          >
            {/* THE VISITED PERSON IS A HANDLE: only the
                name drags — the possessive stays outside it so the chip still
                reads as a sentence, and it shares the flex item so the button's
                gap cannot open between "Ana" and "'s world". A dragstart on the
                span fires before the click, so leaving the visit still works. */}
            <Sparkles size={14} />{' '}
            <span>
              <DragPerson name={memberName} className="inline align-baseline" title={`You are in ${memberName}'s world — leave`}>{firstNameOf(memberName)}</DragPerson>'s world
            </span>
          </button>
        ) : memberName ? (
          <button
            onClick={() => leaveVisit()}
            title={`You are in ${memberName}'s work — leave`}
            className="hidden h-9 items-center gap-1.5 rounded-full bg-tint-mint px-3 text-[13px] font-semibold text-tint-fg-mint transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98] sm:flex"
          >
            <UserRound size={14} />{' '}
            <span>
              <DragPerson name={memberName} className="inline align-baseline" title={`You are in ${memberName}'s work — leave`}>{firstNameOf(memberName)}</DragPerson>'s work
            </span>
          </button>
        ) : worldId ? (
          <button
            onClick={() => navigate('/app/world-home/home')}
            title="You are in your world — open World Home"
            className="hidden h-9 items-center gap-1.5 rounded-full bg-tint-lavender px-3 text-[13px] font-semibold text-tint-fg-lavender transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98] sm:flex"
          >
            <Sparkles size={14} /> My world
          </button>
        ) : activeTenant && (
          // A LABEL, NOT A DOOR — clicking "Asa Lifecare Franchise Akron" used to redirect to the headquarters.
          <span
            title={`You are in ${activeTenant.name}`}
            className="hidden h-9 items-center gap-1.5 rounded-full bg-tint-blue px-3 text-[13px] font-semibold text-tint-fg-blue sm:flex"
          >
            <Building2 size={14} /> {tenantShortName(activeTenant)}
          </span>
        )}

        {/* search */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="hidden h-9 min-w-[240px] items-center gap-2 rounded-sm border border-border bg-surface px-3 text-[13px] text-text-3 transition-colors hover:border-border-strong xl:flex"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search apps, pages, actions…</span>
          <kbd className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3">⌘K</kbd>
        </button>
        <button
          onClick={() => setPaletteOpen(true)}
          aria-label="Search"
          className="grid h-10 w-10 place-items-center rounded-[10px] text-text-2 transition-colors duration-150 hover:bg-surface-2 sm:h-9 sm:w-9 xl:hidden"
        >
          <Search size={17} />
        </button>

        {/* copilot pill — the star alone, with the word "Copilot" removed
            from the face; it survives as the accessible name */}
        {!restricted && (user?.isMaster || user?.copilotStar !== false) && <button
          onClick={() => setCopilotOpen(true)}
          title="Copilot"
          aria-label="Copilot"
          className="hidden h-9 w-9 items-center justify-center rounded-full bg-tint-lavender text-tint-fg-lavender transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98] sm:flex"
        >
          <Sparkles size={15} />
        </button>}

        {/* Global badges: "Seeded data (dev)" = the mock driver is selected,
            which `npm run build` makes impossible (MOCK_DRIVER_ALLOWED) — so
            this badge cannot appear on the platform, only on a developer's
            machine, and it is worded to leave no doubt which one you are on;
            "Live API issue" = a connected resource failed with NO floor.
            An app whose table does not exist yet simply reads empty. */}
        {driver === 'mock' && (
          <span className="hidden rounded-full bg-tint-amber px-2.5 py-1 text-[11px] font-semibold text-tint-fg-amber md:inline">
            Seeded data (dev)
          </span>
        )}
        {driver === 'apps-script' && demoFallback && (
          <span className="hidden rounded-full bg-tint-pink px-2.5 py-1 text-[11px] font-semibold text-tint-fg-pink md:inline">
            Live API issue
          </span>
        )}


        {/* theme toggle */}
        <motion.button
          onClick={cycle}
          aria-label={`Theme: ${MODE_LABEL[mode]}. Click to switch.`}
          title={`Theme: ${MODE_LABEL[mode]}`}
          className="grid h-10 w-10 place-items-center rounded-[10px] text-text-2 transition-colors duration-150 hover:bg-surface-2 sm:h-9 sm:w-9"
          whileTap={{ scale: 0.9 }}
        >
          <motion.span
            key={mode}
            initial={{ rotate: -90, scale: 0.6, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="grid place-items-center"
          >
            <ModeIcon size={17} />
          </motion.span>
        </motion.button>

        {/* bell */}
        <motion.button
          key={arrivalTick}
          onClick={() => setNotifPanelOpen(!notifPanelOpen)}
          aria-label={`Notifications, ${unread} unread`}
          className="relative grid h-10 w-10 place-items-center rounded-[10px] text-text-2 transition-colors duration-150 hover:bg-surface-2 sm:h-9 sm:w-9"
          animate={arrivalTick > 0 && !notifPanelOpen ? { rotate: [0, -8, 8, -6, 6, 0] } : undefined}
          transition={{ duration: 0.4 }}
        >
          <Bell size={17} />
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                aria-live="polite"
                className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-white ring-2 ring-bg"
              >
                {unread > 9 ? '9+' : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        {/* avatar */}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Account menu" className="ml-1 grid h-10 w-10 place-items-center rounded-full transition-transform duration-150 hover:scale-105 sm:block sm:h-auto sm:w-auto">
                <Avatar src={user.avatar} name={user.name} size="sm" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[13px] font-semibold text-text-1">{user.name}</p>
                  {/* the highest badge alone — it
                      falls back to the role chip when no type is set */}
                  <HighestBadge user={user} size="xs" />
                </div>
                <p className="text-[12px] text-text-3">{user.email}</p>
              </div>
              <DropdownMenuSeparator />
              {/* HOME sits above the places, for 100% of users — the one
                  press that returns page and app */}
              <DropdownMenuItem onClick={goHomePage}>
                <House size={14} /> Home
              </DropdownMenuItem>
              {restricted && <DropdownMenuSeparator />}
              {/* the three places one account can stand: company · my world ·
                  the other tenant (the traveler lives in Settings → Organization) */}
              {!restricted && (
                <>
                  {/* the ONE door home (the sidebar stack carries no asa.
                      card): leaves a world AND lands
                      at headquarters. Entering a world never touched the
                      tenant, so a world opened from Akron used to wake back
                      in Akron under a button that said Headquarters (found
                      in review) - both coordinates heal here. */}
                  <DropdownMenuItem onClick={goHome}>
                    <Building2 size={14} /> ASA LifeCare
                    {!worldId && !memberName && tenantId === homeTenantId && <Check size={12} className="ml-auto text-text-3" />}
                  </DropdownMenuItem>
                  {/* THE PLACE YOU ARE ACTUALLY IN GETS THE TICK.
                      A visit stands somewhere this menu had no
                      row for, so the tick fell on "My world" while the open
                      world belonged to somebody else — the menu agreeing,
                      in writing, with the wrong reading of the screen. The
                      visited place is its own row now, and it is also the
                      door out, which is the one thing a visit always needs. */}
                  {memberName && (
                    <DropdownMenuItem onClick={() => leaveVisit()}>
                      <Avatar src={undefined} name={memberName} size="xs" />
                      {firstNameOf(memberName)}'s {worldId ? 'world' : 'work'}
                      <Check size={12} className="ml-auto text-text-3" />
                    </DropdownMenuItem>
                  )}
                  {canWorld && (
                    <DropdownMenuItem onClick={() => {
                      if (worldId && !memberName) { navigate('/app/world-home/home'); return }
                      crossToMyWorld()
                    }}>
                      {/* the same mark the sidebar card wears: the person's
                          own avatar, so changing the photo changes both */}
                      <Avatar src={user.avatar} name={user.name} size="xs" />
                      My world
                      {worldId && !memberName && <Check size={12} className="ml-auto text-text-3" />}
                    </DropdownMenuItem>
                  )}
                  {travelTenant && (
                    <DropdownMenuItem onClick={() =>
                      crossToTenant(travelTenant.id, `Loading ${travelTenant.name} from scratch`)
                    }>
                      <Building2 size={14} /> {travelTenant.name}
                      {/* the tick reads all three: visiting somebody while the
                          tenant sat on the franchise ticked this row AND the
                          visit's row at once */}
                      {!worldId && !memberName && tenantId === travelTenant.id && <Check size={12} className="ml-auto text-text-3" />}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              {!restricted && visibleMenuItems.map((it) => (
                <DropdownMenuItem key={it.id} onClick={() => openUserMenuItem(it)}>
                  <AppIcon name={it.icon} size={14} /> {it.label}
                  {it.external && <ExternalLink size={11} className="ml-auto text-text-3" />}
                </DropdownMenuItem>
              ))}
              {!restricted && visibleMenuItems.length > 0 && <DropdownMenuSeparator />}
              {/* THE TRAINEE'S MENU IS THREE LINES (chapter 24): the
                  right-hand dropdown carries only Home, My asa. and Log out
                  — Home above, My asa. here, Log out below; no
                  profile, no Settings, no notification centre. Interview-day
                  logins stay bare. */}
              {!restricted && (
                <DropdownMenuItem onClick={() => openProfile(true)}>
                  <UserRound size={14} /> My profile
                </DropdownMenuItem>
              )}
              {restricted && user.role === 'onboarding' && !worldId && canMyAsa && (
                <DropdownMenuItem onClick={() => navigate('/app/myasa/home')}>
                  <Sparkles size={14} /> My asa.
                </DropdownMenuItem>
              )}
              {!restricted && (
                <>
                  {/* My asa. is a company app — inside a world the registry
                      does not serve it, so the door hides with the world */}
                  {!worldId && canMyAsa && (
                    <DropdownMenuItem onClick={() => navigate('/app/myasa/home')}>
                      <Sparkles size={14} /> My asa.
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => navigate('/settings')}>
                    <Gear size={14} /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/notifications')}>
                    <CheckCheck size={14} /> Notification center
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              {/**
                * LOG THEM OUT OF THIS PLATFORM: logging the other user out
                * from here removes the link and takes them off the account.
                *
                * The instinct is right — the decision is made while you are
                * looking at the person, not in a settings list — and the door
                * for it only existed in Settings → Platform users. What it
                * cannot be is the plain "Log out" below: inside a visit there
                * are THREE intentions (leave the visit, unlink them, end this
                * session) and two of them would have shared a word. So it
                * keeps that same vocabulary and names the person and the
                * target, which is what makes it unmistakable.
                *
                * TWO PRESSES, NO DIALOG. Undoing this is not symmetric: coming
                * back needs a new invitation AND their own yes again
                * (platformMemberAsk → pending → their reply), so a misfire
                * costs the other person's time, not a click. The second press
                * says exactly that.
                */}
              {memberName && (
                <>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={(e) => {
                      e.preventDefault()
                      if (!unlinkArmed) { setUnlinkArmed(true); return }
                      void unlinkMember()
                    }}
                  >
                    <LogOut size={14} />
                    {unlinkArmed
                      ? `Press again — ${firstNameOf(memberName)} will have to accept a new invitation`
                      : `Log ${memberName} out of my platform`}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={signOut}>
                <LogOut size={14} /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* My profile side sheet (avatar menu + My asa. card) */}
      <ProfileSheet />

      {/* Copilot side sheet — the cortex chat lives here */}
      <Sheet open={copilotOpen} onOpenChange={setCopilotOpen}>
        <SheetContent className="flex w-[380px] max-w-[100vw] flex-col bg-surface">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 font-display">
              <Sparkles size={17} className="text-tint-fg-lavender" /> Copilot
            </SheetTitle>
          </SheetHeader>
          {/* THE SEARCH TRAIL: every pick made through
              the search terminal, as balloons on a dotted line with its hour —
              the hiring-dossier grammar — each one a door straight back. */}
          <SearchTrail onGo={(href) => { setCopilotOpen(false); navigate(href) }} />
          {/* THE CORTEX DOOR — the chat was brought over from there to
              here: the platform's own Neural Cortex, asked from here. */}
          <CortexChat />
          <ConnectomePulse />
        </SheetContent>
      </Sheet>
    </header>
  )
}


/** The Copilot panel's trail of searches — balloons on a dotted timeline. */
function SearchTrail({ onGo }: { onGo: (href: string) => void }) {
  const me = useAuthStore((s) => s.user)
  const [hits, setHits] = useState(() => listSearches(String(me?.id ?? '')))
  useEffect(() => { setHits(listSearches(String(me?.id ?? ''))) }, [me?.id])
  if (hits.length === 0) {
    return (
      <p className="mx-4 mt-3 text-[12px] leading-5 text-text-3">
        Your searches will gather here — everything you open through the search
        terminal, one press away from opening again.
      </p>
    )
  }
  return (
    <div className="mx-4 mt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Your searches</p>
        <button
          onClick={() => { clearSearches(String(me?.id ?? '')); setHits([]) }}
          className="text-[11px] font-medium text-text-3 transition-colors hover:text-text-1"
        >
          Clear
        </button>
      </div>
      <div className="scroll-thin max-h-[46vh] overflow-y-auto pr-1">
        <ul className="relative ml-2 space-y-2.5 border-l border-dashed border-border-strong pl-4">
          {hits.map((h, i) => (
            <li key={`${h.href}-${h.at}-${i}`} className="relative">
              <span className="absolute -left-[21.5px] top-2 h-2.5 w-2.5 rounded-full border-2 border-surface bg-tint-fg-lavender" />
              <button
                onClick={() => onGo(h.href)}
                className="w-full rounded-2xl border border-border bg-surface-2 px-3.5 py-2 text-left transition-all hover:border-border-strong hover:bg-surface"
                title={h.href}
              >
                <span className="block truncate text-[13px] font-semibold text-text-1">{h.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-text-3">
                  {h.q ? `“${h.q}” · ` : ''}{ohioDateTime(new Date(h.at))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
