// Calendar Builder: one header (Refresh, then one page switcher) over every screen of the app.
// The switcher offers what the checker allows, the calendar screen once for both its views; estate-wide screens…
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { Loader2, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import PageSwitchMenu, { type SwitchItem } from '@/components/shared/PageSwitchMenu'
import Card from '@/components/shared/Card'
import PageRenderer from '@/engine/PageRenderer'
import type { AppManifest, PageSchema } from '@/engine/types'
import SheetModePage, { SHEET_MODE } from '@/pages/SheetModePage'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { allowedPages, menuPageId } from '@/lib/audience'
import { isAllowedWith, selectAccessChecker, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole, useEffectiveUser } from '@/lib/effectiveUser'
import ShiftRequestsPage from '@/pages/features/shifts/ShiftRequestsPage'
import ShiftSwapsPage from '@/pages/features/shifts/ShiftSwapsPage'
import ShiftCardsPage from '@/pages/features/shifts/ShiftCardsPage'
import ShiftTimelinePage from '@/pages/features/shifts/ShiftTimelinePage'
import HouseCalendarsScreen from './HouseCalendarsScreen'
import { movedAddress } from './calendarScreen'
import CoverageTab from './CoverageTab'
import { ConflictsTab, HoursTab, HousesTab, StaffTab } from './CalendarTables'
import StaleCalendarNote from './StaleCalendarNote'
import { useCalendarData } from './useCalendarData'
import { houseLane } from './useHouseBuilderLane'
import { BuilderRefreshTick, useBuilderRefresh } from './builderRefresh'

export const APP_ID = 'calendarbuilder'

/** What the header says under the title, per screen. */
const SUBTITLE: Record<string, string> = {
  smartcomms: 'Who could cover each shift that needs somebody — and the call-offs that opened them',
  builder: 'Where the calendars are made: every edit a draft you publish to that house',
  conflicts: 'Double-bookings across the houses, and shifts over approved time off, in the 28-day period',
  hours: 'Hours per person across the 28-day period',
  staff: 'What each person asked for — shifts, pick-ups, weekends, allergies',
  houses: 'Every house, its live grid and its workbook',
  requests: 'Open shifts, call-offs, swaps, trainings and time off — as they are asked and as they are answered',
  swaps: 'Hand a shift to somebody else: the one taking it, the house manager and the director each say yes',
  'house-cal': 'The live roster of every house: open shifts, call-offs and transfers',
  cards: 'Everybody on the roster, one card each',
  timeline: 'The day, shift by shift',
  coverage: 'Every shift on the roster, and the houses they cover',
  week: 'The staff schedule by day, week and month',
}

/** The switcher's items: the checker-cut pages under their headings. */
export function switchItems(pages: PageSchema[]): SwitchItem[] {
  return pages.map((p) => ({
    id: p.id, title: p.title,
    group: String((p.config as { menuGroup?: string } | undefined)?.menuGroup ?? ''),
  }))
}

export default function CalendarBuilderPage() {
  const { pageId = '' } = useParams()
  const navigate = useNavigate()
  const apps = useRegistryStore((s) => s.apps)
  const role = useEffectiveRole()
  useEffectiveUser()          // a badge worn by code arriving re-decides the menu
  const version = useBadgeRulesVersion()
  const app = apps.find((a) => a.id === APP_ID)
  const pages = useMemo(
    () => (app ? allowedPages(app, role, selectAccessChecker(apps, role)) : []),
    // `version` moves when the matrix or the person does
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, apps, role, version],
  )
  const page = app?.pages.find((p) => p.id === pageId)
  /** the switcher's entry for this address: both views of the calendar screen are its one entry */
  const entry = menuPageId(app, pageId)
  const [tick, setTick] = useState(0)
  const { search } = useLocation()

  // an old address lands where its screen lives now, the query kept (a client or guardian: Shift Cards)
  const moved = movedAddress(pageId, search, isAllowedWith(apps, role, APP_ID, 'house-cal'))
  if (moved) return <Navigate to={moved} replace />

  return (
    <div>
      <PageHeader
        title="Calendar Builder"
        subtitle={SUBTITLE[pageId] ?? page?.title ?? ''}
        actions={
          <>
            <button
              onClick={() => setTick((t) => t + 1)}
              aria-label="Refresh"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <RefreshCw size={14} /> <span className="max-sm:hidden">Refresh</span>
            </button>
            <PageSwitchMenu
              items={switchItems(pages)}
              current={entry}
              // the entry already open keeps its view, house and cell
              onPick={(id) => { if (id !== entry) navigate(`/app/${APP_ID}/${id}`) }}
              label="Go to another screen of Calendar Builder"
            />
          </>
        }
      />
      <BuilderRefreshTick.Provider value={tick}>
        {page ? <Screen app={app} page={page} tick={tick} /> : null}
      </BuilderRefreshTick.Provider>
    </div>
  )
}

/** The screen an address names, under the app's one header. */
function Screen({ app, page, tick }: { app: AppManifest | undefined; page: PageSchema; tick: number }) {
  switch (page.id) {
    // one screen, two views: the page id is the view
    case 'builder':
      return <HouseCalendarsScreen view="build" />
    case 'requests':
      return <ShiftRequestsPage embedded />
    case 'swaps':
      return <ShiftSwapsPage embedded />
    case 'house-cal':
      return <HouseCalendarsScreen view="live" />
    case 'cards':
      return <ShiftCardsPage embedded />
    case 'timeline':
      return <ShiftTimelinePage embedded />
    case 'coverage': {
      const sheet = SHEET_MODE[`${APP_ID}/coverage`]
      return <SheetModePage key={tick} page={page} pin={sheet.pin} pinTitle={sheet.pinTitle} />
    }
    case 'week':
      return <PageRenderer key={tick} schema={page} />
    case 'smartcomms':
    case 'conflicts':
    case 'hours':
    case 'staff':
    case 'houses':
      return <EveryHouseScreen pageId={page.id} tick={tick} />
    default:
      // an unknown page falls back to the engine, never a blank
      return app ? <PageRenderer key={tick} schema={page} /> : null
  }
}

/** The relay's `edits_every_house`: null until answered; a failed read is its own state, never a no. */
type EveryHouseAnswer ={ every: boolean } | { error: string } | null

function useEditsEveryHouse(tick: number): EveryHouseAnswer {
  // an answer from an earlier Refresh reads as not yet answered
  const [got, setGot] = useState<{ tick: number; answer: EveryHouseAnswer }>({ tick: -1, answer: null })
  useEffect(() => {
    let live = true
    houseLane.houses()
      .then((d) => { if (live) setGot({ tick, answer: { every: Boolean(d.edits_every_house) } }) })
      .catch((e: unknown) => {
        if (live) setGot({ tick, answer: { error: e instanceof Error ? e.message : String(e) } })
      })
    return () => { live = false }
  }, [tick])
  return got.tick === tick ? got.answer : null
}

/** The screens that read every house — drawn once the relay says so. */
function EveryHouseScreen({ pageId, tick }: { pageId: string; tick: number }) {
  const answer = useEditsEveryHouse(tick)
  if (answer === null) {
    return (
      <p className="flex items-center justify-center gap-2 p-8 text-[13px] text-text-3">
        <Loader2 size={14} className="animate-spin" /> Opening the houses…
      </p>
    )
  }
  if ('error' in answer) {
    return (
      <Card className="p-6 text-center text-[13px] text-text-3">
        Could not ask the relay whether this account edits every house ({answer.error}) — Refresh to try again.
      </Card>
    )
  }
  if (!answer.every) {
    return (
      <Card className="p-6 text-center text-[13px] text-text-3">
        This screen reads every house's calendar, and the relay says this account builds the houses it
        manages, one by one, in the Builder.
      </Card>
    )
  }
  // Smart Comms has its own outage states, so it skips the calendar's loading gate
  if (pageId === 'smartcomms') return <CoverageTab key={tick} />
  return <EstateTables pageId={pageId} />
}

/** An ISO day as 'Mon D, YYYY' — local-noon parse, never `new Date(iso)`. */
function fmtPeriodDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return String(iso ?? '')
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Conflicts, Hours, Staff Preferences and Houses — the estate's slices. */
function EstateTables({ pageId }: { pageId: string }) {
  const { period, conflicts, hours, staff, houses, loading, stale, error, reload } = useCalendarData()
  useBuilderRefresh(reload)
  let body: ReactNode = null
  if (pageId === 'conflicts') body = <ConflictsTab conflicts={conflicts} />
  if (pageId === 'hours') body = <HoursTab hours={hours} />
  if (pageId === 'staff') body = <StaffTab staff={staff} />
  if (pageId === 'houses') body = <HousesTab houses={houses} />
  return (
    <>
      {period && (
        <p className="mb-3 text-[12.5px] text-text-2">
          {fmtPeriodDay(period.start)} → {fmtPeriodDay(period.end)} · {period.days} days
        </p>
      )}
      {stale && <StaleCalendarNote />}
      {error ? (
        <Card className="p-6 text-center text-[13px] text-text-3">{error}</Card>
      ) : loading ? (
        <p className="flex items-center justify-center gap-2 p-8 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Loading the calendar…
        </p>
      ) : body}
    </>
  )
}
