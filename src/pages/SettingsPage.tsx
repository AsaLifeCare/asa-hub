// Settings (route /settings) — settings.md.
// Appearance (4 theme radio cards with live mini-previews wired to useThemeStore), notification preferences…
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Mail,
  ClipboardPaste,
  Search,
  Shield,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import Card, { CardHeader } from '@/components/shared/Card'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import ThemeMiniPreview from '@/components/pages/ThemeMiniPreview'
import AccessControlSection from '@/pages/settings/AccessControlSection'
import AppControlSection from '@/pages/settings/AppControlSection'
import AppControlAccessSection from '@/pages/settings/AppControlAccessSection'
import EditionsSection from '@/pages/settings/EditionsSection'
import BackendsSection from '@/pages/settings/BackendsSection'
import RoutesSection from '@/pages/settings/RoutesSection'
import EventsSection from '@/pages/settings/EventsSection'
import EssentialSheetsSection from '@/pages/settings/EssentialSheetsSection'
import MyWorkDisplaySection from '@/pages/settings/MyWorkDisplaySection'
import AlertReceiveSection, { useAlertReceive } from '@/pages/settings/AlertReceiveSection'
import MembersSection from '@/pages/settings/MembersSection'
import WorldAccessSection from '@/pages/settings/WorldAccessSection'
import PlatformsImOnSection from '@/pages/settings/PlatformsImOnSection'
import YourAppsSection from '@/pages/settings/YourAppsSection'
import HiringRulesSection from '@/pages/settings/HiringRulesSection'
import { FlowAdminCadences } from '@/pages/settings/FlowAdminSection'
import TestModeSection from '@/pages/settings/TestModeSection'
import ClientsMasterSection from '@/pages/settings/ClientsMasterSection'
import HiringMasterSection from '@/pages/settings/HiringMasterSection'
import PotClientsMasterSection from '@/pages/settings/PotClientsMasterSection'
import { useAssistBarStore } from '@/stores/useAssistBarStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { currentPlaceKey } from '@/lib/placeKey'
import SuggestionsSection from '@/pages/settings/SuggestionsSection'
import HotlineSection from '@/pages/settings/HotlineSection'
import LeadScraperSection from '@/pages/settings/LeadScraperSection'
import ContactSyncSection from '@/pages/settings/ContactSyncSection'
import FinanceSection from '@/pages/settings/FinanceSection'
import { ShopperSettingsSection, WellbeingSettingsSection } from '@/pages/settings/PersonalAppsSection'
import LearningSection from '@/pages/settings/LearningSection'
import TravelSection from '@/pages/settings/TravelSection'
import IstSection from '@/pages/settings/IstSection'
import ReconSection from '@/pages/settings/ReconSection'
import TimeOffSection from '@/pages/settings/TimeOffSection'
import DataSection from '@/pages/settings/DataSection'
import DocsLinksSection from '@/pages/settings/DocsLinksSection'
import OrganizationSection from '@/pages/settings/OrganizationSection'
import PlatformHealthSection from '@/pages/settings/PlatformHealthSection'
import HubContainersSection from '@/pages/settings/HubContainersSection'
import UserMenuSection from '@/pages/settings/UserMenuSection'
import BeAnotherControls from '@/pages/settings/BeAnotherControls'
import { DEMO_USERS, useAuthStore } from '@/auth/useAuthStore'
import { roleBadge } from '@/auth/types'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useThemeStore, type ThemeMode } from '@/stores/useThemeStore'
import { TOAST_POSITIONS, useUiPrefsStore } from '@/stores/useUiPrefsStore'
import { DEFAULT_EXEC_URL, MOCK_DRIVER_ALLOWED, useApiConfigStore, type ApiDriver } from '@/stores/useApiConfigStore'
import { useEmailConfigStore } from '@/stores/useEmailConfigStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { loadNotifPrefs, saveNotifPrefs, type NotifPrefs } from '@/lib/notifPrefs'
import {
  answerToast, askOsPermission, osPermission, recordAnswer, showOsNotice, type OsPermission,
} from '@/lib/osNotify'
import { PUSH_WORDS, ensurePush, onPushStatus, pushStatus } from '@/lib/webPush'
import { useProfileSheetStore } from '@/stores/useProfileSheetStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { toast } from '@/stores/useToastStore'
import { ACCENTS, setAccent, storedAccent, type AccentId } from '@/lib/accent'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { invalidate } from '@/lib/apiCache'
import { AppIcon } from '@/lib/icons'
import { EDITION_SECTION_APPS, settingsLead, settingsNavFor } from '@/lib/settingsNav'
import { editionIdsOf } from '@/lib/editions'
import { useEffectiveUser } from '@/lib/effectiveUser'
import BuildVersions from '@/pages/settings/BuildVersions'
import { useWorldOffered } from '@/lib/worldOffered'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { AppNotification } from '@/engine/types'


export default function SettingsPage() {
  const location = useLocation()
  const [active, setActive] = useState('appearance')
  const rootRef = useRef<HTMLDivElement>(null)
  // THE SECTIONS ARE THE EFFECTIVE PERSON'S.
  const user = useEffectiveUser()
  const isAdmin = user?.role === 'admin'
  // USER WORLDS: inside a world only the personal sections render - the nav list (settingsNavFor) narrows itself…
  const inWorld = Boolean(useWorldStore((st) => st.currentWorldId))
  const visitingSettings = Boolean(useMemberStore((st) => st.currentMemberId))
  // AWAY TENANT = FROM SCRATCH, settings included: no apps there yet, so no app settings - and the platform…
  const curTenant = useTenantStore((st) => st.currentTenantId)
  const homeTenant = useTenantStore((st) => st.homeTenantId)
  const tenantsLoadedS = useTenantStore((st) => st.tenantsLoaded)
  const atHome = !inWorld && !(tenantsLoadedS && homeTenant && curTenant && curTenant !== homeTenant)
  // The sections this person has — one list, shared with the ⌘K palette (lib/settingsNav).
  const isMaster = user?.isMaster === true   // false for the whole of a visit
  const apps = useRegistryStore((s) => s.apps)
  const configRules = useBadgeAccessStore((s) => s.configRules)
  // settingsNavFor reads the account's own world answer; a change to it redraws the list
  const worldOn = useWorldOffered()
  // Alerts I receive exists where the server answers it: the directors and the master, at home, never in a visit
  const receive = useAlertReceive(atHome && !visitingSettings, user?.id ?? '')
  const receiveHeld = receive.state.phase === 'ready' || receive.state.phase === 'failed'
  // an admin-only section an edition opens (Docs, Learning, Time Reconciliation) opens to its people too, at home
  const [docsEditions, setDocsEditions] = useState<string[]>([])
  // the master and the Platform Lead: the only ones the platform's own sections show to (settingsNav.LEAD_SECTIONS)
  const lead = settingsLead(user, isMaster)
  useEffect(() => {
    if ((isAdmin && lead) || !atHome || visitingSettings || !user?.id) {
      setDocsEditions([])
      return
    }
    let alive = true
    Promise.all(EDITION_SECTION_APPS.map((app) =>
      gasAction<{ editions?: unknown }>('editionsMine', { app }).then((d) => editionIdsOf(d?.editions), () => [])))
      .then((lists) => alive && setDocsEditions(lists.flat()))
      .catch(() => alive && setDocsEditions([]))
    return () => {
      alive = false
    }
  }, [isAdmin, atHome, visitingSettings, user?.id])
  const nav = useMemo(
    () => settingsNavFor(apps, { isAdmin, isMaster, configRules, user, alertReceive: receiveHeld,
                                 editions: docsEditions }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apps, isAdmin, isMaster, configRules, user, worldOn, receiveHeld, docsEditions],
  )
  // ONE list decides both the nav entry and the section itself.
  const has = (id: string) => nav.some((n) => n.id === id)

  // WHAT EACH SECTION ACTUALLY GOVERNS, in the words somebody would type.
  const FINDS: Record<string, string> = {
    hiringrules: 'pause messages stop emergency test mode redirect testers recipients sms email ' +
                 'timezone opt out words start wrong number guard statuses',
    testmode: 'testers redirect rehearsal sheet sandbox dry run',
    alertreceive: 'alerts receive turn off stop no call no show not punching in incident filed text e-mail inbox',
    api: 'connection backend relay exec url token key',
    email: 'mailbox smtp sender from address platform mail',
    accesscontrol: 'badge roles who may open matrix permission',
    appcontrol: 'install apps enable disable release',
    appcontrolaccess: 'share app control delegate person view change apps list',
    editions: 'edit edition delicate key people allow locations staff incidents documents notes clients',
    backends: 'backend engine apps script python database migrate locations reads',
    routes: 'routes paths endpoints http api lanes relay carrier turn off disable enable switch',
    events: 'events signals wakes rings roster notices relay told retired turn off disable enable switch',
    essentialsheets: 'essential sheets sweep now google forms books daily three times import',
    mywork: 'hide header notes resolved concluded actions requests hours scheduling ' +
            'support automations late show no call punch incident vehicle payroll adp time off',
    contactsync: 'phones numbers roster people merge',
    usermenu: 'links menu shortcuts',
    data: 'books sheets houses backup export',
    hubcontainers: 'docker containers relay chat web server cpu memory uptime health restart images photos pictures folder path',
    hotline: 'calls line transcripts support queue call offs',
    ist: 'training in-service records houses clients',
    recon: 'reconciliation punches hours time clock',
    members: 'people accounts seats invite',
    organization: 'company name branding address',
  }

  const [find, setFind] = useState('')
  const shownNav = useMemo(() => {
    const q = find.trim().toLowerCase()
    if (!q) return nav
    return nav.filter((n) =>
      n.label.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q) ||
      String(FINDS[n.id] || '').includes(q))
    // FINDS is a literal in this component and never changes between renders; it is left out of the deps on purpose…
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, find])

  // ONE MATCH IS AN ANSWER: the screen goes there rather than making somebody click the only chip left.
  useEffect(() => {
    if (!find.trim() || shownNav.length !== 1) return
    const only = shownNav[0].id
    const t = window.setTimeout(() => jump(only), 250)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find, shownNav])

  // THE MARKER USED TO RUN TO THE WRONG PLACE — pressing an icon sent the bar somewhere else, and it took three…
  const travellingRef = useRef<{ id: string; until: number } | null>(null)
  const onScreenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const root = document.getElementById('main-scroll')
    const sections = nav
      .map((n) => document.getElementById(n.id))
      .filter(Boolean) as HTMLElement[]
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) onScreenRef.current.add(e.target.id)
          else onScreenRef.current.delete(e.target.id)
        }
        const trip = travellingRef.current
        if (trip) {
          const arrived = onScreenRef.current.has(trip.id)
          if (!arrived && Date.now() < trip.until) return   // still on the way
          travellingRef.current = null
          // Arrived: the destination is the answer.
          if (arrived) { setActive(trip.id); return }
        }
        const top = sections
          .filter((s) => onScreenRef.current.has(s.id))
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
        if (top) setActive(top.id)
      },
      { root, rootMargin: '-25% 0px -65% 0px' },
    )
    sections.forEach((s) => obs.observe(s))
    return () => obs.disconnect()
  }, [nav])

  // Scroll the SHELL's scroller, by measurement.
  const jump = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    setActive(id)
    travellingRef.current = { id, until: Date.now() + 1500 }
    const root = document.getElementById('main-scroll')
    if (!root) {
      el.scrollIntoView({ behavior: 'smooth' })
      return
    }
    const top = root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - 16
    root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  /* anchor links (#notifications from Notification Center, etc.) */
  useEffect(() => {
    if (!location.hash) return
    // One frame for the sections to exist, then the same measured trip the nav takes — an anchor arriving from…
    const id = location.hash.slice(1)
    const t = window.setTimeout(() => jump(id), 60)
    return () => window.clearTimeout(t)
  }, [location.hash])

  return (
    // SETTINGS GO HORIZONTAL.
    <div ref={rootRef} className="w-full">
      <motion.nav
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
        aria-label="Settings sections"
      >
        <h1 className="mb-3 px-1 font-display text-[22px] font-bold leading-[30px] tracking-[-0.015em] text-text-1">
          Settings
        </h1>
      </motion.nav>

      {/* sections */}
      <div className="min-w-0 w-full max-w-[720px] space-y-6 pb-10">
        {/* FINDING A SETTING WITHOUT KNOWING ITS SECTION — a search field
            over the settings.
            This screen is thirty-odd sections deep, and the thing somebody is
            looking for is almost never called what they would type: the
            emergency stop lives under "Hiring rules", the testers under "Test
            mode". So the search matches the section's NAME and a short list of
            the words that section actually governs, narrows the chips to what
            matched, and jumps when exactly one thing does. */}
        <div className="sticky top-0 z-10 -mx-2 bg-bg/85 px-2 py-2 backdrop-blur">
          <label className="relative mb-1.5 flex items-center">
            <Search size={14} className="absolute left-2.5 shrink-0 text-text-3" />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a setting — pause, testers, badge, timezone…"
              className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-8 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
            />
            {find ? (
              <button type="button" onClick={() => setFind('')} aria-label="Clear the search"
                      className="absolute right-2 text-text-3 hover:text-text-2">
                <X size={14} />
              </button>
            ) : null}
          </label>
          {find.trim() && !shownNav.length ? (
            <p className="px-1 pb-1 text-[11.5px] text-text-3">
              No section of this screen is named or described by that. The sections still below are
              all of them.
            </p>
          ) : null}
          <div className="flex gap-1 overflow-x-auto">
          {shownNav.map((n) => (
            <button
              key={n.id}
              onClick={() => jump(n.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                active === n.id ? 'bg-primary-soft text-primary-strong' : 'bg-surface text-text-2',
              )}
            >
              <AppIcon name={n.icon} size={13} />
              {n.label}
            </button>
          ))}
          </div>
        </div>

        <AppearanceSection />
        <NotificationsSection />
        {has('alertreceive') && (
          <AlertReceiveSection state={receive.state} onState={receive.setState} onRetry={() => void receive.reload()} />
        )}
        {/* MY world, and only mine. Opened inside somebody
            else's world this drew a section headed "My world — your own place
            inside asa., yours alone" with THEIR world's name as
            its title. The card configures a world; a visitor configures
            nothing. */}
        {inWorld && !visitingSettings && <MyWorldSection />}
        {atHome && (<>
        {isAdmin && lead && <ApiSection />}
        {isAdmin && lead && <EmailSection />}
        {isAdmin && lead && <AccessControlSection />}
        {has('appcontrol') && <AppControlSection />}
        {has('appcontrolaccess') && <AppControlAccessSection />}
        {has('editions') && <EditionsSection />}
        {has('backends') && <BackendsSection />}
        {has('routes') && <RoutesSection />}
        {has('events') && <EventsSection />}
        {has('essentialsheets') && <EssentialSheetsSection />}
        {has('mywork') && <MyWorkDisplaySection />}
        {isAdmin && <DragDropSection />}
        {/* only while the Hiring app is installed; admin-only — an admin
            configures, everyone else just uses what was made */}
        {isAdmin && lead && <TestModeSection />}
        {/* installed WITH the app, like every app's config: uninstall Clients
            and its governance leaves Settings with it. Master only — this is
            the word over everybody, not a preference. */}
        {has('clientsmaster') && <ClientsMasterSection />}
        {has('hiringmaster') && <HiringMasterSection />}
        {has('potclientsmaster') && <PotClientsMasterSection />}
        {/* SMART COMMS IS THE NOTIFICATION APP, so everything that messages
            somebody belongs under it. "Hiring messages" used to sit beside it
            as a sibling section, which left two screens both called the
            messages and no answer to which one governs. It is the same block,
            one level down — the anchor still works, the nav entry is gone. */}
        {/* The Hiring messages section is GONE: its
            texts are Smart Comms situation rows now (hiring_* ids), edited
            above like every other message — one protocol, one screen. */}
        {isAdmin && lead && <ContactSyncSection />}
        {/* System users moved into the Users app — one app,
            three sections, Merge included. Nothing renders here. */}
        {isAdmin && lead && <UserMenuSection />}
        {/* BACKEND SYNC LEFT THE MIDDLE OF THE HIRING BLOCK — inside it is
            called Hiring rules, but from outside it is Backend
            Sync. It configures the Apps Script URL that questionnaire
            RESPONSES are pushed to — nothing to do with the hiring-policy card it
            used to sit on top of, and reading the two as one card is exactly
            what happened. It rides with the other sync cards below. */}
        {/* REPLIES & OPT-OUTS MOVED OUT (Smart Comms → Stops). The section
            held two halves: a suppression list the send door really asks, and
            a reader of a message mirror the provider stopped writing to long
            before anybody noticed — which answered "nothing new" where it
            meant "this feed is dead". The list is the platform's brake and it
            now lives beside the messages; the dead reader is not rebuilt.
            What the move costs is written on the registry entry. */}
        {isAdmin && lead && <PlatformHealthSection />}
        {has('hubcontainers') && <HubContainersSection />}
        {isAdmin && lead && <DataSection />}
        {has('members') && <MembersSection />}
        {/* NOT admin-gated, and that is the point: this is the person's own
            answer about their own world. The id is
            `worldaccess` rather than `myworld` because a world already has a
            section of that name — the one you see while standing INSIDE it,
            which describes the workbook. This one describes who may open it. */}
        {has('worldaccess') && (
          <Section id="worldaccess" title="My world" sub="Yours, always — and who else may open it.">
            <WorldAccessSection />
          </Section>
        )}
        {/* BOTH SIDES OF A LINK, ONE SCREEN APART — the connection can be
            ended from either side. Above: who may open
            MY world. Here: whose platform I stand on, and the way off it —
            which existed for the owner alone until today. */}
        {lead && <PlatformsImOnSection />}
        <OrganizationSection />
        </>)}
        {/* THE SECTION FOR EVERYBODY ELSE. It governs
            nothing, so it is not admin-gated — and it is OUTSIDE the home-only
            block because it describes the apps that reach you WHERE YOU ARE
            STANDING, which in a franchise is the franchise's own list. `nav`
            and `jump` are handed down rather than recomputed: one list decides
            what is reachable, and one measured scroll gets there. */}
        {has('yourapps') && <YourAppsSection nav={nav} onJump={jump} />}
        {/* AN APP'S CONFIG TRAVELS WITH THE APP — the setting and the app
            are one package. These sit OUTSIDE the
            home-only block: wherever the app is installed, its own
            settings are reachable — empty in a place that has not
            filled them in, which is a truthful answer, not a missing
            screen. `has()` is settingsNav's verdict for THIS place. */}
        {has('docslinks') && <DocsLinksSection />}
        {isAdmin && has('hiringrules') && <HiringRulesSection />}
        {isAdmin && has('flowadmin') && <FlowAdminCadences />}
        {isAdmin && has('suggestions') && <SuggestionsSection />}
        {isAdmin && has('hotline') && <HotlineSection />}
        {isAdmin && has('leadscraper') && <LeadScraperSection />}
        {isAdmin && has('finance') && <FinanceSection />}
        {isAdmin && has('shopper') && <ShopperSettingsSection />}
        {isAdmin && has('wellbeing') && <WellbeingSettingsSection />}
        {has('learning') && <LearningSection />}
        {isAdmin && has('travel') && <TravelSection />}
        {isAdmin && has('ist') && <IstSection />}
        {has('recon') && <ReconSection />}
        {isAdmin && has('timeoff') && <TimeOffSection />}
        <ProfileSection />
      </div>
    </div>
  )
}

// MY WORLD: the world's own Settings card - what this place IS.
function MyWorldSection() {
  const worldName = useWorldStore((s) => s.worldName)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] || 'My world'
  return (
    <Section id="myworld" title="My world" sub="Your own place inside asa. - yours alone.">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-tint-lavender text-tint-fg-lavender">
          <Sparkles size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-text-1">{worldName || `${firstName}'s world`}</p>
          <p className="text-[12.5px] text-text-3">
            Apps you build in World Studio and everything they hold live in your world's own
            spreadsheet - company data never crosses in, and the company never reads here.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={() => navigate('/app/world-home/home')} className="h-8 rounded-[10px] border border-border bg-surface px-3 text-[12.5px] font-medium text-text-1 transition-colors hover:bg-surface-2">World Home</button>
          <button onClick={() => navigate('/app/playground/studio')} className="h-8 rounded-[10px] border border-border bg-surface px-3 text-[12.5px] font-medium text-text-1 transition-colors hover:bg-surface-2">World Studio</button>
        </div>
      </div>
    </Section>
  )
}

/* ================= shared section shell ================= */

function Section({
  id,
  title,
  sub,
  extra,
  children,
}: {
  id: string
  title: string
  sub?: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader title={title} sub={sub} extra={extra} />
        {children}
      </Card>
    </motion.section>
  )
}

/* ================= 1 · Appearance ================= */

const THEME_CARDS: {
  mode: ThemeMode
  label: string
  sub: string
  icon: string
  variant: 'light' | 'dark' | 'split'
}[] = [
  { mode: 'light', label: 'Light', sub: 'Bright, always', icon: 'sun', variant: 'light' },
  { mode: 'dark', label: 'Dark', sub: 'Dim, always', icon: 'moon', variant: 'dark' },
  { mode: 'system', label: 'System', sub: 'Follows your OS', icon: 'monitor', variant: 'split' },
  { mode: 'auto', label: 'Auto-night', sub: 'Dark 19:00–07:00', icon: 'moon-star', variant: 'split' },
]

function AppearanceSection() {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  const [density, setDensity] = useState(() => localStorage.getItem('asa-density') ?? 'comfortable')
  const assistBar = useAssistBarStore((s) => s.enabled)
  const setAssistBar = useAssistBarStore((s) => s.setEnabled)
  const logsView = useUiPrefsStore((s) => s.logsDefaultView)
  const setLogsView = useUiPrefsStore((s) => s.setLogsDefaultView)
  const topbarWeather = useUiPrefsStore((s) => s.topbarWeather)
  const topbarClock = useUiPrefsStore((s) => s.topbarClock)
  const setTopbarWeather = useUiPrefsStore((s) => s.setTopbarWeather)
  const setTopbarClock = useUiPrefsStore((s) => s.setTopbarClock)
  const [accent, setAccentId] = useState<AccentId>(storedAccent)

  const pickAccent = (id: AccentId) => {
    setAccent(id)
    setAccentId(id)
  }

  return (
    <Section id="appearance" title="Appearance" sub="Choose how asa. looks to you.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {THEME_CARDS.map((t, i) => {
          const selected = mode === t.mode
          return (
            <motion.button
              key={t.mode}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, delay: i * 0.05, ease: EASE_OUT_EXPO }}
              onClick={() => setMode(t.mode)}
              aria-pressed={selected}
              className={cn(
                'relative rounded-lg border-2 p-2 text-left transition-[border-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-2',
                selected ? 'border-primary' : 'border-border hover:border-border-strong',
              )}
            >
              <div className="h-[76px]">
                <ThemeMiniPreview variant={t.variant} />
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <AppIcon name={t.icon} size={13} className={selected ? 'text-primary-strong' : 'text-text-3'} />
                <span className="text-[13px] font-semibold text-text-1">{t.label}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-4 text-text-3">{t.sub}</p>
              {selected && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-on-primary shadow-1"
                >
                  <Check size={11} strokeWidth={3} />
                </motion.span>
              )}
            </motion.button>
          )
        })}
      </div>

      {/* accent color — per-user, localStorage "asa-accent" (src/lib/accent.ts) */}
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-[14px] font-medium text-text-1">Accent color</p>
        <p className="text-[12px] text-text-3">Buttons, links and highlights across the app — yours only, saved on this device.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ACCENTS.map((a) => {
            const selected = accent === a.id
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => pickAccent(a.id)}
                aria-pressed={selected}
                className={cn(
                  'flex items-center gap-2 rounded-full border-2 py-1.5 pl-1.5 pr-3 text-[12px] font-medium transition-[border-color,box-shadow] duration-150 hover:shadow-1',
                  selected ? 'border-primary text-text-1' : 'border-border text-text-2 hover:border-border-strong',
                )}
              >
                <span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: a.primary }}>
                  {selected && <Check size={11} strokeWidth={3} className="text-white" />}
                </span>
                {a.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* the assist bar — per-user, localStorage (useAssistBarStore) */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <div>
          <p className="text-[14px] font-medium text-text-1">Assistant bar</p>
          <p className="text-[12px] text-text-3">The command pill at the bottom of every page — Copilot, search and the App Hub in one reach. Yours only.</p>
        </div>
        <Switch checked={assistBar} onCheckedChange={setAssistBar} />
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <div>
          <p className="text-[14px] font-medium text-text-1">Density</p>
          <p className="text-[12px] text-text-3">Compact tightens table rows. Every table starts here; each one's own toggle still wins for that table.</p>
        </div>
        <SegmentedTabs
          tabs={[
            { id: 'comfortable', label: 'Comfortable' },
            { id: 'compact', label: 'Compact' },
          ]}
          value={density}
          onChange={(id) => {
            setDensity(id)
            localStorage.setItem('asa-density', id)
            toast({ type: 'info', title: 'Density saved', body: 'Applies to data tables like People → Directory.' })
          }}
        />
      </div>

      {/* System Logs default view — per-user, synced (useUiPrefsStore) */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <div>
          <p className="text-[14px] font-medium text-text-1">System logs opens in</p>
          <p className="text-[12px] text-text-3">The view the log starts on. The switch in its header still changes it, for that visit only.</p>
        </div>
        {/* The saved words stayed as they were when Raw table became a view
            — `normal` is still the Activity feed. */}
        <SegmentedTabs
          tabs={[
            { id: 'normal', label: 'Activity' },
            { id: 'table', label: 'Table' },
            { id: 'sheet', label: 'Sheet' },
          ]}
          value={logsView}
          onChange={(id) => setLogsView(id === 'sheet' ? 'sheet' : id === 'table' ? 'table' : 'normal')}
        />
      </div>

      {/* Topbar weather chip — per-user, synced (useUiPrefsStore) */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <div>
          <p className="text-[14px] font-medium text-text-1">Weather in the top bar</p>
          <p className="text-[12px] text-text-3">Columbus, OH — live forecast.</p>
        </div>
        <Switch checked={topbarWeather} onCheckedChange={setTopbarWeather} />
      </div>

      {/* Topbar clock — the same switch shape, and it ships ON: the weather is
          a choice, a clock is the one thing on a topbar nobody has to be
          taught. When the weather is off it moves closer to the search rather
          than standing in white space. */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <div>
          <p className="text-[14px] font-medium text-text-1">Date and time in the top bar</p>
          <p className="text-[12px] text-text-3">
            Ohio time (Eastern), in your locale. Sits beside the weather — and closes
            up on the search when the weather is off.
          </p>
        </div>
        <Switch checked={topbarClock} onCheckedChange={setTopbarClock} />
      </div>
    </Section>
  )
}

/* ================= 2 · Notifications ================= */

// The switches live in lib/notifPrefs, with the ONE reader that obeys them (useNotificationStore.push).
const PREF_ROWS: { key: keyof NotifPrefs; label: string; desc: string }[] = [
  { key: 'toasts', label: 'In-app toasts', desc: 'High-priority arrivals also pop up in the corner. Call-offs and open shifts you can take are pinned on the right until you close them or their window closes (never while test mode is on).' },
  { key: 'mentions', label: 'Mentions', desc: 'When someone @s you in a document.' },
  { key: 'appActivity', label: 'App activity', desc: 'Installs, updates and moves in your apps.' },
  { key: 'reminders', label: 'Reminders', desc: 'Upcoming events and due dates.' },
]

function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotifPrefs>(loadNotifPrefs)
  const push = useNotificationStore((s) => s.push)

  const set = (key: keyof NotifPrefs, v: boolean) => {
    const next = { ...prefs, [key]: v }
    setPrefs(next)
    saveNotifPrefs(next)
  }

  return (
    <Section id="notifications" title="Notifications" sub="What reaches you, and where.">
      <div className="divide-y divide-border">
        {PREF_ROWS.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div>
              <p className="text-[14px] font-medium text-text-1">{r.label}</p>
              <p className="text-[12px] leading-5 text-text-3">{r.desc}</p>
            </div>
            <Switch checked={prefs[r.key]} onCheckedChange={(v) => set(r.key, v)} aria-label={r.label} />
          </div>
        ))}
        <ToastPositionRow />
        <BrowserNotificationsRow />
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <button
          onClick={() =>
            push({
              type: 'system',
              title: 'Test notification',
              body: 'This is how high-priority items reach you — bell wiggle, toast and a row in the Notification Center.',
              href: '/notifications',
              priority: 'high',
            })
          }
          className="h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          Send me a test notification
        </button>
      </div>
    </Section>
  )
}

/* ================= Drag & drop name (shifts wave) ================= */

// Whether the real names on the roster apps are DRAG HANDLES for the sidebar's person-focus slot.
const DRAG_APPS: { id: string; label: string; desc: string }[] = [
  // kept on the shiftboard id so existing settings stay put
  { id: 'shiftboard', label: 'Calendar Builder', desc: 'Shift Cards, the calendar\'s staff rows and timeline names.' },
  { id: 'schedule', label: 'Schedule', desc: 'Teammate columns and the person picker chips.' },
]

function DragDropSection() {
  const apps = useRegistryStore((s) => s.apps)
  const live = useApiConfigStore((s) => s.driver) === 'apps-script'
  const [busy, setBusy] = useState<string | null>(null)

  const isOn = (id: string) => apps.find((a) => a.id === id)?.dragFocus !== false
  const setLocal = (id: string, on: boolean) =>
    useRegistryStore.setState((s) => ({
      apps: s.apps.map((a) => (a.id === id ? { ...a, dragFocus: on } : a)),
    }))

  const toggle = async (id: string, label: string, on: boolean) => {
    setLocal(id, on)
    if (!live) return
    setBusy(id)
    try {
      // appUpsert is the admin-only door and mints the override row when the app has none.
      await gasAction('appUpsert', { id, drag_focus: on })
      await api.update('apps', id, { drag_focus: on ? 'true' : 'false' })
      toast({
        type: 'success',
        title: `Drag & drop ${on ? 'on' : 'off'}`,
        body: `${label}: names ${on ? 'can now be dragged' : 'no longer drag'} onto the focus corner — for everyone.`,
      })
    } catch (e) {
      setLocal(id, !on) // the platform shows what the server holds, not a wish
      toast({
        type: 'danger',
        title: 'Could not save the toggle',
        body: e instanceof Error ? e.message : 'The backend did not answer.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section
      id="dragdrop"
      title="Drag & drop name"
      sub="Dragging a real name onto the top-left corner focuses the whole platform on that person."
    >
      <div className="divide-y divide-border">
        {DRAG_APPS.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div>
              <p className="text-[14px] font-medium text-text-1">{r.label}</p>
              <p className="text-[12px] leading-5 text-text-3">{r.desc}</p>
            </div>
            <Switch
              checked={isOn(r.id)}
              disabled={busy === r.id}
              onCheckedChange={(v) => toggle(r.id, r.label, v)}
              aria-label={`Drag & drop name — ${r.label}`}
            />
          </div>
        ))}
      </div>
    </Section>
  )
}

// Where toasts pop — left or right, top or bottom.
function ToastPositionRow() {
  const position = useUiPrefsStore((s) => s.toastPosition)
  const setPosition = useUiPrefsStore((s) => s.setToastPosition)
  return (
    <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
      <div>
        <p className="text-[14px] font-medium text-text-1">Position</p>
        <p className="text-[12px] leading-5 text-text-3">Which corner of the screen notifications pop from.</p>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-1">
        {TOAST_POSITIONS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              setPosition(p.key)
              toast({ type: 'info', title: `Notifications now pop here`, body: p.label })
            }}
            className={cn(
              'h-8 rounded-md border px-2.5 text-[12px] font-semibold transition-colors',
              position === p.key
                ? 'border-primary bg-primary-soft text-primary-strong'
                : 'border-border bg-surface text-text-2 hover:bg-surface-2',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The browser's notification permission in words, and the ask button for a later change of mind. */
function BrowserNotificationsRow() {
  const uid = useAuthStore((s) => String(s.user?.id ?? ''))
  const [state, setState] = useState<OsPermission>(osPermission)
  const [busy, setBusy] = useState(false)
  const push = useSyncExternalStore(onPushStatus, pushStatus, pushStatus)

  const allow = async () => {
    setBusy(true)
    const got = await askOsPermission()
    // an answer given here is the person's answer too: the card never asks after it
    if (got !== 'unsupported') recordAnswer(uid, got === 'default' ? 'later' : got)
    setState(got)
    setBusy(false)
    toast(answerToast(got))
    if (got === 'granted') void ensurePush({ force: true })
  }
  const pushLine = PUSH_WORDS[push.state]
    ? PUSH_WORDS[push.state] + (push.state === 'failed' && push.why ? ` (${push.why}).` : '')
    : ''

  const said: Record<OsPermission, string> = {
    granted: 'On — call-offs and open shifts reach you even while this tab is in the background.',
    default: 'Off — this browser has not been allowed to show the platform\'s notices yet.',
    denied: 'Blocked in this browser. Allow it from the padlock beside the address, then reload.',
    unsupported: 'This browser does not show notifications from web pages.',
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
      <div>
        <p className="text-[14px] font-medium text-text-1">Browser notifications</p>
        <p className="text-[12px] leading-5 text-text-3">{said[state]}</p>
        {pushLine && <p className="text-[12px] leading-5 text-text-3">{pushLine}</p>}
        {push.state === 'failed' && (
          <button
            type="button"
            onClick={() => void ensurePush({ force: true })}
            className="mt-1 text-[12px] font-semibold text-primary hover:text-primary-hover"
          >
            Try again
          </button>
        )}
      </div>
      {state === 'default' && (
        <button
          type="button"
          onClick={() => void allow()}
          disabled={busy}
          className="h-8 shrink-0 rounded-md border border-primary bg-primary-soft px-3 text-[12px] font-semibold text-primary-strong transition-colors hover:bg-primary hover:text-on-primary disabled:opacity-60"
        >
          Allow
        </button>
      )}
      {state === 'granted' && (
        <button
          type="button"
          onClick={() => {
            const shown = showOsNotice({
              key: 'settings-test', title: 'Test notification',
              body: 'This is how a call-off reaches you while the platform is in the background.',
              href: '/settings', urgent: false,
            }, { force: true })
            if (!shown) toast({ type: 'warning', title: 'Not shown', body: 'This browser refused to show it from the page.' })
          }}
          className="h-8 shrink-0 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
        >
          Show a test
        </button>
      )}
    </div>
  )
}

/* ================= 3 · API connection ================= */

const BACKEND_NOTES = [
  'The Hub is fully self-contained — its data lives in its own database, served by its own backend (asa-hub-app).',
  'Every call (reads included) is a POST with a text/plain body to the Hub\'s endpoint — a CORS simple request, no preflight, no proxy.',
  'Requests carry your Hub session token in the body — sessions come from the Hub\'s own sign-in, with no external accounts involved.',
]

function ApiSection() {
  const { driver, execUrl, demoFallback, setDriver, setExecUrl } = useApiConfigStore()
  const [advanced, setAdvanced] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const connected = driver === 'apps-script' && !demoFallback
  const badgeLabel = connected
    ? 'Connected · asa-hub-app'
    : driver === 'mock'
      ? 'Seeded data · development build'
      : 'Backend unreachable'

  const switchDriver = (id: string) => {
    const next = id as ApiDriver
    setResult(null)
    setDriver(next)
    if (next === 'mock') {
      toast({ type: 'info', title: 'Seeded dataset', body: 'A development convenience — this control does not exist in the deployed platform.' })
    }
  }

  const pasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        setExecUrl(text.trim())
        toast({ type: 'success', title: 'URL pasted' })
      }
    } catch {
      toast({ type: 'warning', title: 'Clipboard unavailable', body: 'Paste the URL manually with Ctrl/Cmd+V.' })
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setResult(null)
    // A diagnostic must MEASURE, not remember: bypass the SWR cache so the verdict comes from a request that…
    invalidate('notifications')
    const t0 = performance.now()
    const rows = await api.list<AppNotification>('notifications')
    const ms = Math.round(performance.now() - t0)
    setTesting(false)
    if (useApiConfigStore.getState().demoFallback) {
      setResult({
        ok: false,
        msg: "Couldn't reach the Hub's backend — that call failed and nothing was served in its place. Check that you are signed in.",
      })
    } else {
      setResult({ ok: true, msg: `Connected — ${rows.length} notifications returned in ${ms} ms.` })
      toast({ type: 'success', title: 'Connection OK', body: `${ms} ms round trip via api.list('notifications').` })
    }
  }

  return (
    <Section
      id="api"
      title="API connection"
      sub="Where your data comes from."
      extra={
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            connected ? 'bg-primary-soft text-primary-strong' : 'bg-tint-amber text-tint-fg-amber',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-warning')} />
          {badgeLabel}
        </span>
      }
    >
      {/* status card — the default: the Hub's own Apps Script backend, zero setup */}
      <div className="rounded-md border border-border bg-surface-2 p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-tint-mint">
            <AppIcon name="plug-zap" size={15} className="text-tint-fg-mint" />
          </span>
          <div>
            <h3 className="text-[13.5px] font-semibold text-text-1">Self-contained — the Hub&apos;s own backend</h3>
            <p className="text-[12px] text-text-3">asa-hub-app and its own database — nothing to paste or configure.</p>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-5 text-text-2">
          asa. talks to <span className="break-all font-mono text-[12px]">{execUrl || DEFAULT_EXEC_URL}</span>,
          authenticated by your Hub sign-in (session token). If a call fails, the screen says so — no seeded
          data is ever shown in its place.
        </p>
        <button
          onClick={testConnection}
          disabled={testing || driver === 'mock'}
          title={driver === 'mock' ? 'Switch back to the live backend first (Advanced below)' : undefined}
          className="mt-3.5 flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
        >
          {testing ? <Loader2 size={13} className="animate-spin" /> : <AppIcon name="plug-zap" size={13} />}
          Test connection
        </button>
        {result && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'mt-3 flex items-start gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium leading-5',
              result.ok ? 'bg-primary-soft text-primary-strong' : 'bg-tint-pink text-tint-fg-pink',
            )}
          >
            {result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
            {result.msg}
          </motion.p>
        )}
      </div>

      {/* how the backend works */}
      <div className="mt-5 rounded-md bg-surface-2 p-4">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-text-2" />
          <h3 className="text-[13px] font-semibold text-text-1">How the backend works</h3>
        </div>
        <ul className="mt-3 space-y-2">
          {BACKEND_NOTES.map((s) => (
            <li key={s} className="flex items-start gap-2 text-[13px] leading-5 text-text-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* Advanced — developer override. THE WHOLE PANEL IS DEV-ONLY:
          its driver switch was the last door into the seeded
          dataset from a signed-in session, and a person who found it saw a
          workspace of invented people wearing the real screens. The store
          refuses `mock` in a production build regardless; not drawing the
          control is the other half of the same rule. */}
      {MOCK_DRIVER_ALLOWED && (<>
      <button
        onClick={() => setAdvanced((v) => !v)}
        aria-expanded={advanced}
        className="mt-5 flex items-center gap-1.5 rounded-md px-1 py-1 text-[12px] font-semibold text-text-2 transition-colors hover:text-text-1"
      >
        <ChevronDown size={14} className={cn('transition-transform duration-200', !advanced && '-rotate-90')} />
        Advanced — developer override
      </button>
      {advanced && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          className="overflow-hidden"
        >
          <div className="mt-2 rounded-md border border-border bg-surface-2 p-4">
            <p className="mb-3 text-[12px] leading-5 text-text-3">
              Development only, and this panel does not exist in the deployed platform. "Seeded data" swaps the
              whole app to the local dataset; a custom
              <span className="font-mono text-[11px]"> /exec</span> URL replaces the Hub's default endpoint. Leave the
              URL empty to use the default.
            </p>
            <SegmentedTabs
              tabs={[
                { id: 'apps-script', label: 'Live backend' },
                { id: 'mock', label: 'Seeded data' },
              ]}
              value={driver}
              onChange={switchDriver}
              className="mb-4"
            />
            <label className="mb-1.5 block text-[12px] font-medium text-text-2">
              Endpoint override (<span className="font-mono">/exec</span> URL — optional)
            </label>
            <div className="flex items-center gap-2">
              <input
                value={execUrl}
                onChange={(e) => {
                  setExecUrl(e.target.value)
                  setResult(null)
                }}
                placeholder="Empty = default Hub /exec endpoint"
                spellCheck={false}
                className="h-9 min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
              />
              <button
                onClick={pasteUrl}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <ClipboardPaste size={13} /> Paste
              </button>
            </div>
          </div>
        </motion.div>
      )}
      </>)}

      <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-5 text-text-3">
        <Shield size={13} className="mt-0.5 shrink-0" />
        Requests use text/plain bodies (the Hub&apos;s own envelope). If a live call fails, the last good
        snapshot answers where there is one and the topbar says so; otherwise the screen shows the error.
      </p>
    </Section>
  )
}

/* ================= 3b · Email (admins only) ================= */

const GMAIL_SCOPES = ['gmail.readonly', 'gmail.send']

function EmailSection() {
  const adminEmail = useEmailConfigStore((s) => s.adminEmail)
  const setAdminEmail = useEmailConfigStore((s) => s.setAdminEmail)
  // the master's card alone; the server refuses the box to anyone the config does not name
  const isMaster = useAuthStore((s) => s.user?.isMaster === true)
  const fallback = DEMO_USERS.find((u) => u.role === 'admin')?.email ?? 'alex@asahub.io'
  const effective = adminEmail || fallback
  const [value, setValue] = useState(effective)
  const dirty = value.trim() !== effective && value.trim().length > 0

  const save = () => {
    setAdminEmail(value.trim())
    toast({ type: 'success', title: 'Platform email saved', body: `Workspace email set to ${value.trim()}.` })
  }

  return (
    <Section id="email" title="Email" sub="The workspace email address and the Gmail integration behind the Mail app.">
      {/* card 1 — platform email */}
      <div className="rounded-md border border-border bg-surface-2 p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-tint-blue">
            <Mail size={15} className="text-tint-fg-blue" />
          </span>
          <div>
            <h3 className="text-[13.5px] font-semibold text-text-1">Platform email</h3>
            <p className="text-[12px] text-text-3">The admin address platform mail routes to — admin-managed for now.</p>
          </div>
        </div>
        <div className="mt-3.5 flex items-center gap-2">
          <input
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="admin@asahub.io"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
          />
          <button
            onClick={save}
            disabled={!dirty}
            className="h-9 shrink-0 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
          >
            Save
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-text-3">
          Prefilled from the admin account ({fallback}). Per-user addresses arrive with the directory sync.
        </p>
      </div>

      {/* card 2 — Gmail integration */}
      <div className="mt-4 rounded-md border border-border bg-surface-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-tint-peach">
              <AppIcon name="plug" size={15} className="text-tint-fg-peach" />
            </span>
            <div>
              <h3 className="text-[13.5px] font-semibold text-text-1">Gmail integration</h3>
              <p className="text-[12px] text-text-3">Google Workspace connection for the Mail app.</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-tint-amber px-2.5 py-1 text-[11px] font-semibold text-tint-fg-amber">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            NOT CONNECTED
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-5 text-text-2">
          Connect Google Workspace so every user sees their own inbox in the Mail app. Each person authorizes their
          own account; asa. never reads mail before that consent.
        </p>
        <div className="mt-3 rounded-md border border-border bg-surface p-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
            OAuth scopes requested
          </p>
          <ul className="mt-1.5 space-y-1">
            {GMAIL_SCOPES.map((s) => (
              <li key={s} className="flex items-center gap-2 font-mono text-[12px] font-medium text-text-1">
                <span className="h-1 w-1 rounded-full bg-primary" />
                {s}
              </li>
            ))}
          </ul>
        </div>
        <button
          disabled
          title="Available when the backend connects"
          className="mt-3.5 flex h-9 cursor-not-allowed items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 opacity-50"
        >
          <AppIcon name="mail" size={15} />
          Connect Google Workspace
        </button>
      </div>

      {/* mailbox readers are set in App access by badge; only the pointer stays, for the master */}
      {isMaster && (
        <p className="mt-4 text-[12px] leading-5 text-text-3">
          Mailbox readers are chosen in{' '}
          <button
            type="button"
            onClick={() => document.getElementById('access')?.scrollIntoView({ behavior: 'smooth' })}
            className="font-semibold text-primary-strong underline-offset-2 hover:underline"
          >
            Access control → Features
          </button>
          .
        </p>
      )}
    </Section>
  )
}

/* ================= 5 · Profile ================= */

// The empty shape, not a person.
const INITIAL_PROFILE = {
  name: '',
  title: '',
  language: 'English',
}

function ProfileSection() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  // the versions box is the master's own session's alone (its lane refuses anyone else as well)
  const isMaster = user?.isMaster === true
  // wearing another account (Be Another): their record is shown, never saved from here
  const actingAs = useAuthStore((s) => {
    const a = s.beAnother?.acting
    return a ? (a.display_name || a.email || 'another account') : ''
  })
  const navigate = useNavigate()
  const initial = {
    ...INITIAL_PROFILE,
    name: user?.name ?? '',
    // `roleBadge`, not ROLE_LABEL: this row is about the person READING it, so the master must read MASTER here…
    title: user ? String(user.title ?? '') : '',
  }
  const [form, setForm] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  // THE PROFILE OF THE PLACE YOU ARE STANDING IN — inside My world the profile being shown was headquarters' own.
  useEffect(() => {
    const place = currentPlaceKey()
    if (!place) return
    let alive = true
    void gasAction<{ profile: { display_name?: string; title?: string } | null }>('placeProfileGet', { place })
      .then((r) => {
        if (!alive || !r?.profile) return
        const here = {
          ...initial,
          name: r.profile.display_name || initial.name,
          title: r.profile.title ?? initial.title,
        }
        setForm(here)
        setSaved(here)
      })
      .catch(() => { /* a backend without the action yet: home shows through */ })
    return () => { alive = false }
    // the place only changes with a reboot, so this runs once per boot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // IT SAVES NOW — the profile edited inside Settings did not update, because nothing was connected.
  const save = async () => {
    setSaving(true)
    try {
      // THE PLACE COMES WITH THE SAVE (found in review): this door and My profile edit the same person, so they…
      const place = currentPlaceKey()
      const r = await gasAction<{ user?: Record<string, unknown> }>('profileUpdate', {
        display_name: form.name.trim(),
        title: form.title.trim(),
        ...(place ? { place } : {}),
      })
      setSaved(form)
      const fresh = r?.user
      // away, the answer is the HOME row — adopting it would repaint the shell with the identity this save did not…
      if (fresh && !place) {
        useAuthStore.setState((st) => ({
          user: st.user ? { ...st.user, name: String(fresh.display_name ?? st.user.name),
                            title: String(fresh.title ?? '') } : st.user,
        }))
      }
      toast({ type: 'success', title: 'Profile saved' })
    } catch (e) {
      toast({
        type: 'danger',
        title: 'Profile not saved',
        body: e instanceof Error ? e.message : 'The backend did not take the change.',
      })
    } finally {
      setSaving(false)
    }
  }

  const field =
    'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong disabled:bg-surface-2 disabled:text-text-3'

  return (
    <Section id="profile" title="Profile" sub="Who you are inside asa.." extra={isMaster ? <BuildVersions /> : undefined}>
      <div className="mb-5 flex items-center gap-4">
        <DragPerson name={user?.name ?? ''} id={user?.id} avatar={user?.avatar || undefined} subtitle={user?.title || undefined} className="shrink-0">
          <Avatar src={user?.avatar ?? '/assets/library/animals/cat.jpg'} name={user?.name ?? 'Alex Morgan'} size="xl" />
        </DragPerson>
        <div>
          <DragPerson name={user?.name ?? ''} id={user?.id} avatar={user?.avatar || undefined} subtitle={user?.title || undefined}>
            <p className="text-[14px] font-semibold text-text-1">{user?.name ?? 'Alex Morgan'}</p>
          </DragPerson>
          <p className="text-[12px] text-text-3">{user?.email ?? 'alex@asahub.io'}</p>
          <button
            onClick={() => useProfileSheetStore.getState().setOpen(true)}
            className="mt-1.5 h-8 rounded-md px-2.5 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            Change photo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-text-2">Full name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-text-2">Email</span>
          <input value={user?.email ?? 'alex@asahub.io'} disabled className={field} />
          <span className="mt-1 block text-[11px] text-text-3">Managed by your admin</span>
        </label>
        <label className="block">
          {/* IT WAS NEVER A ROLE. The field held `badge · title` joined into
              one string, which is why an administrator read "Admin ·
              Administration" — the same word twice, in two vocabularies. The
              TITLE is the part a person may write about themselves; the
              permission role is an admin's decision and is shown, not typed. */}
          <span className="mb-1.5 block text-[12px] font-medium text-text-2">Title</span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="What you do here"
            className={field}
          />
          <span className="mt-1 block text-[11px] text-text-3">
            Access level: {roleBadge(user)} — set by an administrator.
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-text-2">Timezone</span>
          {/* NOT a choice — Ohio's timezone for every user, with no way to
              change it by accident. The old demo picker
              defaulted to Europe/Lisbon and saved nowhere; a control that
              looks changeable teaches people the platform's clock can drift. */}
          <input value="America/New_York — Ohio" disabled className={field} />
          <span className="mt-1 block text-[11px] text-text-3">The platform standard, for everyone — fixed.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-text-2">Language</span>
          <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
            <SelectTrigger className="h-9 rounded-sm border-border bg-surface text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="English">English</SelectItem>
            </SelectContent>
          </Select>
          <span className="mt-1 block text-[11px] text-text-3">More languages soon</span>
        </label>
      </div>

      {/* Be Another? and Be Back — only when the server named the master (BeAnother.gs); nothing otherwise */}
      <BeAnotherControls />

      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <button
          onClick={() => {
            logout()
            navigate('/login', { replace: true })
          }}
          className="h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          Log out
        </button>
        <span className="flex items-center gap-3">
          {actingAs && (
            <span className="text-[11.5px] text-text-3">Read-only while acting as {actingAs}</span>
          )}
          <button
            onClick={() => void save()}
            disabled={!dirty || saving || Boolean(actingAs)}
            className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </span>
      </div>
    </Section>
  )
}
