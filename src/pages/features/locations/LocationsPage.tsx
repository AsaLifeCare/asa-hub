// LOCATIONS — one house at a time: its overview, staff, calendar, supplies, repairs, incidents and documents.
// The top card — the platform's own surface — holds the house switcher, Share and Actions; the left column holds…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSectionCrumb } from '@/lib/sectionCrumb'
import { useShellHides } from '@/lib/myWorkHides'
import { CalendarDays, Camera, FileText, House, Loader2, Package, Siren, Users, Wrench, type LucideIcon } from 'lucide-react'
import SafeImg from '@/components/shared/SafeImg'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { api } from '@/lib/api'
import { onSliceChange } from '@/lib/snapshotClient'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { cn } from '@/lib/utils'
import { photoThumb, resolveHouse, seesSourceHealth, staleSources, type HouseRow } from '@/pages/features/houses/houseModel'
import {
  defaultHouse, locationQuery, overviewOf, panelOf, scopeHouseRows, sharePayloadFor, tabOf, tabsFor,
  type LocationTab, type PanelAsk,
} from './locationModel'
import {
  LocationViewerContext, readKey, readOverview, useLocationRead, useLocationScope,
  useLocationViewer, viewerCan, type LocationViewer,
} from './useLocation'
import { heldHouses } from './locationReads'
import HouseSwitcher from './HouseSwitcher'
import LocationActions from './LocationActions'
import LocationPanel from './LocationPanel'
import { RetryButton } from './LocationParts'
import Overview from './tabs/Overview'
import Staff from './tabs/Staff'
import Calendar from './tabs/Calendar'
import Supplies from './tabs/Supplies'
import Repairs from './tabs/Repairs'
import Incidents from './tabs/Incidents'
import Documents from './tabs/Documents'

const TAB_ICONS: Record<LocationTab, LucideIcon> = {
  overview: House, staff: Users, calendar: CalendarDays, supplies: Package, repairs: Wrench, incidents: Siren, documents: FileText,
}

type Houses = { rows: HouseRow[] | null; failed: string; loading: boolean; empty?: string }

/** Every house, from the houses slice — read only once the viewer is known to see every house. */
function useHouses(every: boolean): Houses & { reload: () => void } {
  // the houses already in this tab draw the switcher and the header before the list is read behind them
  const [state, setState] = useState<Houses>(() => {
    const held = every ? heldHouses() : null
    return held ? { rows: held, failed: '', loading: false } : { rows: null, failed: '', loading: true }
  })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!every) return
    let live = true
    api.list<HouseRow>('houses')
      .then((rows) => {
        if (!live) return
        setState(Array.isArray(rows) ? { rows, failed: '', loading: false } : { rows: null, failed: 'The houses slice answered no rows.', loading: false })
      })
      .catch((err: unknown) => {
        if (live) setState((s) => ({ ...s, failed: err instanceof Error ? err.message : 'The houses slice did not answer.', loading: false }))
      })
    return () => {
      live = false
    }
  }, [tick, every])
  // a house's name or photo laid on the houses slice by an Apply is read again behind what is drawn
  useEffect(() => (every ? onSliceChange((r) => { if (r === 'houses') setTick((t) => t + 1) }) : undefined), [every])
  return { ...state, reload: () => { setState((s) => ({ ...s, loading: true, failed: '' })); setTick((t) => t + 1) } }
}

/** The houses this viewer may open: every house from the slice, or only the ones its scope names. */
function useViewerHouses(): { houses: Houses & { reload: () => void }; viewer: LocationViewer } {
  const read = useLocationScope()
  const scope = read.scope
  const every = !!scope && scope.houses === null
  const all = useHouses(every)
  const held = useMemo(() => (scope?.houses ? scopeHouseRows(scope.houses) : null), [scope])
  const viewer = useMemo<LocationViewer>(() => ({ writes: !!scope?.writes, cut: !scope || scope.cut,
    editions: scope?.editions ?? [] }), [scope])
  if (every) return { houses: all, viewer }
  if (held) {
    const empty = `No house is open to you${scope?.why ? ` — ${scope.why.replace(/\.$/, '')}` : ''}.`
    return { houses: { rows: held, failed: '', loading: false, empty, reload: read.reload }, viewer }
  }
  return { houses: { rows: null, failed: read.failed, loading: !read.failed, reload: read.reload }, viewer }
}

export default function LocationsPage() {
  const [params, setParams] = useSearchParams()
  const wanted = params.get('house') ?? ''
  const asked = tabOf(params.get('tab'))
  const ask = panelOf(params.get('panel'))
  const { houses, viewer } = useViewerHouses()
  const hides = useShellHides()
  // a section this viewer is not shown opens on the overview
  const tab = tabsFor(viewer.cut, hides.location_supplies).some((t) => t.id === asked) ? asked : 'overview'
  useSectionCrumb(tabsFor(viewer.cut, hides.location_supplies).find((t) => t.id === tab)?.label)
  const house = houses.rows ? (wanted ? resolveHouse(wanted, houses.rows) : defaultHouse(houses.rows)) : null

  const go = useCallback((code: string, next: LocationTab, panel: PanelAsk | null, replace = false) => {
    setParams(new URLSearchParams(locationQuery(code, next, panel).slice(1)), { replace })
  }, [setParams])

  // an address with no house opens on the first active one
  useEffect(() => {
    if (!wanted && house) go(house.code, tab, ask, true)
  }, [wanted, house, tab, ask, go])

  const onAsk = useCallback((next: PanelAsk | null) => {
    if (!house) return
    // the detail panel and this one share the slot on the right
    if (next) useDetailPanelStore.getState().closeDetail()
    go(house.code, tab, next)
  }, [house, tab, go])

  const code = house?.code ?? ''
  const overview = useLocationRead(ask?.kind === 'share' && code ? readKey('locationOverview', code) : null,
    () => readOverview(code), overviewOf)

  return (
    <LocationViewerContext.Provider value={viewer}>
      <LocationsScreen houses={houses} wanted={wanted} house={house} tab={tab}
        onHouse={(c) => go(c, tab, null)} onTab={(t) => go(code, t, null)} onAsk={onAsk} />
      {house && (
        <LocationPanel ask={ask} house={house} houses={houses.rows ?? undefined}
          share={sharePayloadFor(house, tab, overview.data)}
          onAsk={onAsk} onClose={() => onAsk(null)} />
      )}
    </LocationViewerContext.Provider>
  )
}

export function LocationsScreen({ houses, wanted, house, tab, onHouse, onTab, onAsk }: {
  houses: Houses & { reload: () => void }
  wanted: string
  house: HouseRow | null
  tab: LocationTab
  onHouse: (code: string) => void
  onTab: (tab: LocationTab) => void
  onAsk: (ask: PanelAsk) => void
}) {
  const rows = houses.rows ?? []
  const seesSources = seesSourceHealth(useEffectiveUser())
  const stale = house && seesSources ? staleSources(house.sources) : []
  const viewer = useLocationViewer()
  const hides = useShellHides()
  const tabs = tabsFor(viewer.cut, hides.location_supplies)
  // the house edition replaces the photo: a press on it opens the panel
  const replace = viewerCan(viewer, 'locations.house') ? () => onAsk({ kind: 'house-photo' }) : undefined
  return (
    <div className="w-full pb-16" data-locations="">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4"
        data-top-bar="">
        <HouseSwitcher houses={rows} current={house} onPick={onHouse} />
        {house && <LocationActions onAsk={onAsk} />}
      </div>

      {!house && (
        <section className="rounded-[20px] border border-border bg-surface p-6 shadow-1">
          {houses.rows === null && !houses.failed ? (
            <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the houses…</p>
          ) : houses.failed ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--danger)]">
              The houses could not be read: {houses.failed.replace(/\.$/, '')}. <RetryButton onRetry={houses.reload} busy={houses.loading} />
            </p>
          ) : (
            <p className="text-[13px] text-text-2" data-no-house="">
              {wanted && rows.length && houses.empty ? `No house ${wanted} among the houses open to you.`
                : wanted ? `No house ${wanted} in the houses the platform reads.` : houses.empty ?? 'No house is on record.'}
              {rows.length > 0 && (
                <button type="button" onClick={() => onHouse(rows[0].code)} className="ml-2 font-semibold text-primary hover:underline">
                  Open a house
                </button>
              )}
            </p>
          )}
        </section>
      )}

      {house && (
        <>
          {stale.length > 0 && (
            <div className="mb-4 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
              {stale.map((s) => <p key={s.key}><strong>{s.label}</strong> is {s.state}{s.why ? ` — ${s.why}` : ''}.</p>)}
            </div>
          )}
          <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="hidden content-start gap-4 md:grid" data-rail="">
              <div className="grid justify-items-center gap-3 rounded-[20px] border border-border bg-surface p-5 shadow-1">
                <HousePhoto house={house} width={320} size="h-24 w-24" eager onReplace={replace} />
                <p className="text-center font-display text-[15px] font-semibold text-text-1">{house.title}</p>
              </div>
              <nav aria-label="Location sections" className="grid gap-1 rounded-[20px] border border-border bg-surface p-2 shadow-1">
                {tabs.map((t) => {
                  const Icon = TAB_ICONS[t.id]
                  const on = t.id === tab
                  return (
                    <button key={t.id} type="button" onClick={() => onTab(t.id)} aria-current={on ? 'page' : undefined} data-tab={t.id}
                      className={cn('flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[13px] transition-colors',
                        on ? 'bg-primary-soft font-semibold text-text-1' : 'text-text-2 hover:bg-surface-2')}>
                      <Icon size={16} className="shrink-0" /> {t.label}
                    </button>
                  )
                })}
              </nav>
            </aside>

            <div className="grid gap-3 md:hidden">
              <div className="flex items-center gap-3">
                <HousePhoto house={house} width={160} size={48} onReplace={replace} />
                <p className="font-display text-[15px] font-semibold text-text-1">{house.title}</p>
              </div>
              <div className="scroll-thin -mx-1 overflow-x-auto px-1">
                <SegmentedTabs className="w-max" tabs={tabs.map((t) => ({ id: t.id, label: t.label }))} value={tab}
                  onChange={(t) => onTab(tabOf(t))} />
              </div>
            </div>

            <main className="min-w-0" data-section={tab}>
              {tab === 'overview' && <Overview key={house.code} house={house} onAsk={onAsk} />}
              {tab === 'staff' && <Staff key={house.code} house={house} onAsk={onAsk} />}
              {tab === 'calendar' && <Calendar key={house.code} house={house} />}
              {tab === 'supplies' && <Supplies key={house.code} house={house} onAsk={onAsk} />}
              {tab === 'repairs' && <Repairs key={house.code} house={house} onAsk={onAsk} />}
              {tab === 'incidents' && <Incidents key={house.code} house={house} onAsk={onAsk} />}
              {tab === 'documents' && <Documents key={house.code} house={house} onAsk={onAsk} />}
            </main>
          </div>
        </>
      )}
    </div>
  )
}

/** The house's photo; with `onReplace`, a press on it opens the panel that uploads another in its place. */
export function HousePhoto({ house, width, size, eager = false, onReplace }: {
  house: HouseRow
  width: number
  size: number | string
  eager?: boolean
  onReplace?: () => void
}) {
  const img = <SafeImg src={house.photo?.src ? photoThumb(house.photo.src, width) : ''} icon="house" shape="square" size={size}
    alt={house.title} eager={eager} />
  if (!onReplace) return img
  return (
    <button type="button" onClick={onReplace} data-house-photo="" aria-label={`Replace ${house.title}'s photo`}
      title="Replace the photo" className="group relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {img}
      <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100">
        <Camera size={16} />
      </span>
    </button>
  )
}
