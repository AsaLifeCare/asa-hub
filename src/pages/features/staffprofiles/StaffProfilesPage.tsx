// STAFF — one staff member at a time: profile, calendar, preferences, employment, documents, compliance…
// The calendar is Scheduling's own read of the person's shifts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSectionCrumb } from '@/lib/sectionCrumb'
import {
  Activity, Banknote, CalendarDays, Car, ClipboardList, FolderOpen, House, LayoutGrid, Loader2, Lock, ShieldCheck, SlidersHorizontal,
  Users,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SafeImg from '@/components/shared/SafeImg'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { PhotoReplacePanel, ReplaceablePhoto, useFreshPhotos } from '@/components/shared/PhotoReplace'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { useBookmarksStore } from '@/stores/useBookmarksStore'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { useFeatureAllowed } from '@/lib/featureAccess'
import { cn } from '@/lib/utils'
import {
  NOT_PUBLISHED, STAFF_TABS, STAFF_TAB_FEATURES, actionCount, actionsOf, askFor, defaultStaff, favoriteFor, isRefusal, panelOf, readRefusal,
  resolveStaff, rosterOf, sharePayloadFor, shutTabsOf, staffCan, staffQuery, tabOf, tabShown, tabsFor, viewOf, viewerOf, type ActivityView,
  type RosterRow, type SplitTab, type StaffAsk, type StaffTab,
} from './staffModel'
import {
  readActions, readKey, readRoster, recordVisit, useCertReview, useStaffEditions, useStaffRead, type ReadState,
} from './useStaffRead'
import { StaffViewerContext, useStaffViewer } from './staffViewer'
import StaffSwitcher, { AMBIGUOUS_WORDS, type InactiveState } from './StaffSwitcher'
import StaffActions from './StaffActions'
import StaffPanel from './StaffPanel'
import { StatusPill } from './StaffParts'
import ProfileSection from './sections/Profile'
import CalendarSection from './sections/Calendar'
import PreferencesSection from './sections/Preferences'
import DrivingSection from './sections/Driving'
import RelatedClientsSection from './sections/RelatedClients'
import RelatedLocationsSection from './sections/RelatedLocations'
import DocumentsSection from './sections/Documents'
import ComplianceSection from './sections/Compliance'
import HrAdminSection from './sections/HrAdmin'
import EmployeePaySection from './sections/EmployeePay'
import ActionsSection from './sections/Actions'
import ActivitySection from './sections/Activity'
import PerformanceSection from './sections/Performance'
import { perfViewOf } from './perfModel'

const TAB_ICONS: Record<StaffTab, LucideIcon> = {
  profile: LayoutGrid, clients: Users, locations: House, actions: ClipboardList, calendar: CalendarDays,
  preferences: SlidersHorizontal, driving: Car,
  compliance: ShieldCheck, documents: FolderOpen, performance: TrendingUp, hr: Lock, pay: Banknote, activity: Activity,
}

/** The split tabs App Control's own rows keep from this session (the master is never narrowed). */
export function useShutTabs(): SplitTab[] {
  const performance = useFeatureAllowed(STAFF_TAB_FEATURES.performance)
  const hr = useFeatureAllowed(STAFF_TAB_FEATURES.hr)
  const pay = useFeatureAllowed(STAFF_TAB_FEATURES.pay)
  const activity = useFeatureAllowed(STAFF_TAB_FEATURES.activity)
  return useMemo(() => shutTabsOf({ performance, hr, pay, activity }), [performance, hr, pay, activity])
}

export default function StaffProfilesPage() {
  const [params, setParams] = useSearchParams()
  const wanted = params.get('staff') ?? ''
  const isMaster = useEffectiveIsMaster()
  const [showInactive, setShowInactive] = useState(false)

  const active = useStaffRead(readKey('staffProfileRoster', '*', false), () => readRoster(false), rosterOf)
  // a viewer whose badges open their own profile alone is never shown, nor looked for, anyone else
  const ownOnly = active.data?.may.ownOnly === true
  // an address naming someone the active roster does not carry asks for the inactive ones too
  const missing = !ownOnly && !!wanted && !!active.data && !resolveStaff(wanted, active.data.staff)
  const wantInactive = showInactive || missing
  const inactiveRead = useStaffRead(wantInactive ? readKey('staffProfileRoster', '*', true) : null, () => readRoster(true), rosterOf)
  const roster = (wantInactive && inactiveRead.data) || active.data
  const staff = roster?.staff ?? []
  const row = roster ? (wanted && !ownOnly ? resolveStaff(wanted, staff) : defaultStaff(staff)) : null
  const key = row && !row.ambiguous ? row.key : ''

  // the cut the server answered: a basic viewer has the profile alone; the master writes, a holder its editions
  const rosterView = roster?.view
  const rosterMay = roster?.may
  const editions = useStaffEditions()
  const review = useCertReview()
  const shut = useShutTabs()
  const viewer = useMemo(() => viewerOf(isMaster, rosterView, rosterMay, editions, review, shut),
    [isMaster, rosterView, rosterMay, editions, review, shut])
  // a tab App Control keeps from this viewer is never drawn: its address opens Staff Profile
  const tab: StaffTab = tabShown(viewer, tabOf(params.get('tab')))
  useSectionCrumb(STAFF_TABS.find((t) => t.id === tab)?.label)
  const view = viewOf(tab, params.get('view'))
  const ask = askFor(panelOf(params.get('panel')), viewer, key)
  // the whole record's own reads wait for the roster to say which cut this is
  const whole = !!roster && !viewer.basic
  // the photo: the master, or a holder of the profile edition, replaces it from the page
  const mayPhoto = !viewer.basic && (viewer.writes || staffCan(viewer, 'staff.profile'))
  const [photoOpen, setPhotoOpen] = useState(false)
  const [fresh, keepFresh] = useFreshPhotos()

  const go = useCallback((k: string, next: StaffTab, nextView: string, panel: StaffAsk | null, replace = false) => {
    setParams(new URLSearchParams(staffQuery(k, next, nextView, panel).slice(1)), { replace })
  }, [setParams])

  // an address with no person opens on the first active one; for an own-only viewer, any address on their own. It keeps
  // the tab and panel it named: only the drawing falls back, so a link read before App Control's rows still opens
  useEffect(() => {
    if (!row || (wanted && !(ownOnly && wanted !== row.key))) return
    const named = tabOf(params.get('tab'))
    go(row.key, named, viewOf(named, params.get('view')), panelOf(params.get('panel')), true)
  }, [wanted, row, ownOnly, params, go])

  // who opened which section — once per person and section, never waited on
  useEffect(() => {
    if (key && whole) recordVisit(key, tab)
  }, [key, tab, whole])

  const onAsk = useCallback((next: StaffAsk | null) => {
    if (!row) return
    // the detail panel and this one share the slot on the right
    if (next) useDetailPanelStore.getState().closeDetail()
    go(row.key, tab, view, next)
  }, [row, tab, view, go])

  const actions = useStaffRead(key && whole ? readKey('staffProfileActions', key) : null, () => readActions(key), actionsOf)
  const favorite = useBookmarksStore((s) => (row ? s.bookmarks.some((b) => b.id === `person:staff:${row.key}`) : false))
  const toggleFavorite = () => {
    if (row) useBookmarksStore.getState().toggle(favoriteFor(row))
  }

  const inactive: InactiveState = {
    on: showInactive,
    reading: wantInactive && inactiveRead.status === 'loading',
    why: inactiveRead.data?.why || (inactiveRead.status === 'failed' ? readRefusal(inactiveRead.error) : ''),
  }
  const looking = missing && !inactiveRead.data
  const rosterRead: ReadState<unknown> = looking ? (inactiveRead.status === 'failed' ? inactiveRead : { ...inactiveRead, status: 'loading' }) : active

  return (
    <StaffViewerContext.Provider value={viewer}>
      <StaffScreen roster={rosterRead} onRetry={looking ? inactiveRead.reload : active.reload} staff={staff} wanted={wanted} row={row}
        tab={tab} view={view} inactive={inactive} onInactive={setShowInactive} actionsCount={actionCount(actions.data)}
        favorite={favorite} onFavorite={toggleFavorite}
        onStaff={(k) => go(k, tab, view, null)} onTab={(t) => go(row?.key ?? '', t, '', null)}
        onView={(v) => go(row?.key ?? '', tab, v, null)} onAsk={onAsk}
        onPhoto={mayPhoto ? () => setPhotoOpen(true) : undefined} photoOf={(r) => fresh[r.key] || r.avatar} />
      {row && !row.ambiguous && mayPhoto && (
        <PhotoReplacePanel open={photoOpen} onClose={() => setPhotoOpen(false)} folder="staff" recordKey={row.key} name={row.name}
          current={fresh[row.key] || row.avatar} onDone={(photo) => { keepFresh(row.key, photo); active.reload() }} />
      )}
      {row && !row.ambiguous && (
        <StaffPanel ask={ask} row={row} share={sharePayloadFor(row, tab)} onClose={() => onAsk(null)}
          onRekey={(k) => go(k, tab, view, null)} onAsk={onAsk} />
      )}
    </StaffViewerContext.Provider>
  )
}

export function StaffScreen({
  roster, onRetry, staff, wanted, row, tab, view, inactive, onInactive, actionsCount, favorite, onFavorite, onStaff, onTab, onView, onAsk,
  onPhoto, photoOf = (r) => r.avatar,
}: {
  roster: ReadState<unknown>
  onRetry: () => void
  staff: RosterRow[]
  wanted: string
  row: RosterRow | null
  tab: StaffTab
  /** Activity's or Performance's view; '' for the first */
  view: string
  inactive: InactiveState
  onInactive: (on: boolean) => void
  actionsCount: number | null
  favorite: boolean
  onFavorite: () => void
  onStaff: (key: string) => void
  onTab: (tab: StaffTab) => void
  onView: (view: string) => void
  onAsk: (ask: StaffAsk) => void
  /** a press on the photo opens the panel that replaces it (the master, a holder of the profile edition) */
  onPhoto?: () => void
  /** the person's photo, a replaced one drawn at once */
  photoOf?: (row: RosterRow) => string
}) {
  const viewer = useStaffViewer()
  const tabs = tabsFor(viewer)
  const shown: StaffTab = tabShown(viewer, tab)
  const open = row && !row.ambiguous ? row : null
  const label = (id: StaffTab, text: string) => (id === 'actions' && actionsCount ? `${text} (${actionsCount})` : text)
  return (
    <div className="w-full pb-16" data-staff-profiles="">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4"
        data-top-bar="">
        <StaffSwitcher staff={staff} current={row} inactive={inactive} onInactive={onInactive} onPick={onStaff} />
        {open && <StaffActions staffKey={open.key} favorite={favorite} onAsk={onAsk} onFavorite={onFavorite} />}
      </div>

      {!row && (
        <section className="rounded-[20px] border border-border bg-surface p-6 shadow-1">
          {roster.status === 'loading' || roster.status === 'idle' ? (
            <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the staff…</p>
          ) : roster.status === 'failed' && !roster.data && isRefusal(roster.error) ? (
            <p className="text-[13px] text-text-2" data-read="refused">{NOT_PUBLISHED}</p>
          ) : roster.status === 'failed' && !roster.data ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--danger)]">
              The staff could not be read: {readRefusal(roster.error)} <RetryButton onRetry={onRetry} busy={roster.refreshing} />
            </p>
          ) : (
            <p className="text-[13px] text-text-2">
              {wanted ? `No staff member ${wanted} in the staff the platform reads.`
                : viewer.basic ? 'No staff member is on record for your house.' : 'No staff member is on record.'}
              {staff.length > 0 && (
                <button type="button" onClick={() => onStaff(staff[0].key)} className="ml-2 font-semibold text-primary hover:underline">
                  Open a staff member
                </button>
              )}
            </p>
          )}
        </section>
      )}

      {row?.ambiguous && (
        <section className="rounded-[20px] border border-border bg-surface p-6 shadow-1" data-ambiguous-row="">
          <p className="text-[13px] text-text-2"><span className="font-semibold text-text-1">{row.name}</span> — {AMBIGUOUS_WORDS}</p>
        </section>
      )}

      {open && (
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden content-start gap-4 md:grid" data-rail="">
            <div className="grid justify-items-center gap-2.5 rounded-[20px] border border-border bg-surface p-5 shadow-1" data-photo-card="">
              <ReplaceablePhoto name={open.name} onReplace={onPhoto}>
                <SafeImg src={photoOf(open)} name={open.name} shape="round" size="h-24 w-24 text-[26px]" eager alt={open.name} />
              </ReplaceablePhoto>
              <p className="text-center font-display text-[15px] font-semibold text-text-1">{open.name}</p>
              {open.role && <p className="-mt-1.5 text-center text-[12px] text-text-3">{open.role}</p>}
              <StatusPill status={open.status} />
            </div>
            {tabs.length > 1 && <nav aria-label="Staff sections" className="grid gap-1 rounded-[20px] border border-border bg-surface p-2 shadow-1">
              {tabs.map((t) => {
                const Icon = TAB_ICONS[t.id]
                const on = t.id === shown
                return (
                  <button key={t.id} type="button" onClick={() => onTab(t.id)} aria-current={on ? 'page' : undefined} data-tab={t.id}
                    className={cn('flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[13px] transition-colors',
                      on ? 'bg-primary-soft font-semibold text-text-1' : 'text-text-2 hover:bg-surface-2')}>
                    <Icon size={16} className="shrink-0" /> <span className="flex-1">{t.label}</span>
                    {t.id === 'actions' && actionsCount !== null && actionsCount > 0 && (
                      <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold tabular-nums text-text-2" data-actions-count="">
                        {actionsCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>}
          </aside>

          <div className="grid gap-3 md:hidden">
            <div className="flex items-center gap-3">
              <ReplaceablePhoto name={open.name} onReplace={onPhoto}>
                <Avatar src={photoOf(open)} name={open.name} size="lg" />
              </ReplaceablePhoto>
              <div className="min-w-0">
                <p className="font-display text-[15px] font-semibold text-text-1">{open.name}</p>
                {open.role && <p className="text-[12px] text-text-3">{open.role}</p>}
              </div>
            </div>
            {tabs.length > 1 && (
              <div className="scroll-thin -mx-1 overflow-x-auto px-1">
                <SegmentedTabs className="w-max" tabs={tabs.map((t) => ({ id: t.id, label: label(t.id, t.label) }))} value={shown}
                  onChange={(t) => onTab(tabOf(t))} />
              </div>
            )}
          </div>

          <main className="min-w-0" data-section={shown}>
            {shown === 'profile' && <ProfileSection key={open.key} row={open} onAsk={onAsk} />}
            {shown === 'clients' && <RelatedClientsSection key={open.key} row={open} onAsk={onAsk} />}
            {shown === 'locations' && <RelatedLocationsSection key={open.key} row={open} />}
            {shown === 'actions' && <ActionsSection key={open.key} row={open} onAsk={onAsk} />}
            {shown === 'calendar' && <CalendarSection key={open.key} row={open} />}
            {shown === 'preferences' && <PreferencesSection key={open.key} row={open} />}
            {shown === 'driving' && <DrivingSection key={open.key} row={open} onAsk={onAsk} />}
            {shown === 'compliance' && <ComplianceSection key={open.key} row={open} onAsk={onAsk} />}
            {shown === 'documents' && <DocumentsSection key={open.key} row={open} onAsk={onAsk} />}
            {shown === 'performance' && (
              <PerformanceSection key={open.key} row={open} view={perfViewOf(view)} onView={onView} onAsk={onAsk} />
            )}
            {shown === 'hr' && <HrAdminSection key={open.key} row={open} onAsk={onAsk} />}
            {shown === 'pay' && <EmployeePaySection key={open.key} row={open} onAsk={onAsk} />}
            {shown === 'activity' && (
              <ActivitySection key={open.key} row={open} view={(view || 'timeline') as ActivityView} onView={onView} onAsk={onAsk} />
            )}
          </main>
        </div>
      )}
    </div>
  )
}
