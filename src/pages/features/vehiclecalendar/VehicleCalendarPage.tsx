// TRANSPORTATION — the team's vehicles on one screen of three pages.
// Calendar: each vehicle's status now, then the month or the week of reserved trips.
import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { ohioToday } from '@/lib/ohio'
import { toast } from '@/stores/useToastStore'
import { ShareBody } from '@/pages/features/locations/LocationPanel'
import {
  PAGES, pageHref, pageOf, panelOf, panelParam, sourceLines, transportPowers, whenWords, type Board, type PageId, type Panel,
  type Powers, type WriteAnswer,
} from './vehicleCalendarModel'
import { useTransportEditions, useVehicleBoard, type BoardState } from './vehicleCalendarLane'
import TopBar from './TopBar'
import VehicleStatusCards from './VehicleStatusCards'
import FilterBar, { type CalendarView } from './FilterBar'
import CalendarCard, { FOOTNOTE } from './CalendarCard'
import KpiRow from './KpiRow'
import HistoryTable from './HistoryTable'
import VehiclesTable from './VehiclesTable'
import RequestPanel, { requestClosedWhy } from './RequestPanel'
import TripPanel from './TripPanel'
import VehiclePanel from './VehiclePanel'
import SetupPanel from './SetupPanel'
import { Muted, OUTLINE_BTN } from './parts'
import { useTestWarningsHidden } from '@/lib/myWorkHides'

export const TEST_MODE_WORDS = 'Test mode is on — texts go to the rehearsal sheet and nobody is contacted.'
export const TEST_MODE_UNREAD_WORDS = 'Test mode could not be read, so texts are held as if it were on'
export const NO_VEHICLES_WORDS = 'No vehicles yet: open Actions → Setup → Seed the vehicles.'

/* ---------- per-viewer conveniences: the vehicles shown and Month or Week ---------- */

const PREFS_KEY = 'asa-vehicle-calendar:prefs'
type Prefs = { view: CalendarView; hidden: string[] }

function readPrefs(): Prefs {
  try {
    const o = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { view: o.view === 'week' ? 'week' : 'month', hidden: Array.isArray(o.hidden) ? o.hidden.map(String) : [] }
  } catch {
    return { view: 'month', hidden: [] }
  }
}

function writePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* a convenience only */ }
}

/* ---------- the page ---------- */

export default function VehicleCalendarPage() {
  const { pageId } = useParams()
  const [params, setParams] = useSearchParams()
  const sessionMaster = useEffectiveIsMaster()
  const read = useVehicleBoard()
  const editions = useTransportEditions()
  const trip = params.get('trip') ?? ''
  const panel = panelOf(params.get('panel')) ?? (/^[A-Za-z0-9_-]{1,40}$/.test(trip) ? { kind: 'trip' as const, id: trip } : null)
  const onPanel = useCallback((p: Panel | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('trip')
      const v = panelParam(p)
      if (v) next.set('panel', v)
      else next.delete('panel')
      return next
    }, { replace: true })
  }, [setParams])
  return (
    <VehicleCalendarView state={read} page={pageOf(pageId)} isMaster={sessionMaster} panel={panel} onPanel={onPanel}
      onAbsorb={read.absorb} onReload={read.reload} editions={editions} />
  )
}

export function VehicleCalendarView({ state, page, isMaster: sessionMaster, panel, onPanel, onAbsorb, onReload, editions = [] }: {
  state: BoardState
  page: PageId
  /** the session's own master pass (never lent to a visit) */
  isMaster: boolean
  panel: Panel | null
  onPanel: (p: Panel | null) => void
  onAbsorb: (answer: WriteAnswer) => void
  onReload: () => void
  /** the editions editionsMine names for this viewer here (Settings › Editions) */
  editions?: readonly string[]
}) {
  const board = state.board
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  // Settings › My Work hides every test mode warning from anyone but the master
  const noTest = useTestWarningsHidden()
  const [date, setDate] = useState('')
  const today = board?.today || ohioToday()
  const day = date || today
  const master = sessionMaster && Boolean(board?.viewer.is_master)
  // Setup does not wait for a board; a board that is read must agree
  const canSetup = sessionMaster && (board ? board.viewer.is_master : true)
  const powers = transportPowers(board?.viewer, editions)
  const canEdit = powers.vehicles
  // the trip types alone, for a person transportation.settings lists
  const canTypes = !canSetup && Boolean(board) && powers.types

  useEffect(() => { writePrefs(prefs) }, [prefs])

  const shownIds = board && prefs.hidden.length
    ? new Set(board.vehicles.map((v) => v.id).filter((id) => !prefs.hidden.includes(id))) : null

  const onWrite = (answer: WriteAnswer, next: Panel | null | 'keep') => {
    onAbsorb(answer)
    if (!answer.board) onReload()
    if (answer.changed === false) toast({ type: 'info', title: 'Already answered', body: answer.said || undefined })
    else toast({ type: 'success', title: answer.said || 'Done.' })
    for (const w of answer.warnings ?? []) toast({ type: 'warning', title: 'Note', body: w })
    if (next !== 'keep') onPanel(next)
  }

  const testMode = board ? board.test_mode : null
  const showTest = !noTest && (state.status === 'failed' || (testMode !== null && (testMode.on || !testMode.readable)))
  const tripsUnread = Boolean(board?.sources.some((s) => (s.key === 'trips' || s.key === 'vehicles') && s.state !== 'ready'))
  const seedHint = Boolean(master && board && board.vehicles.length === 0
    && !board.sources.some((s) => s.key === 'vehicles' && s.state !== 'ready'))

  return (
    <div className="w-full pb-16" data-vehicle-calendar={page}>
      <TopBar page={page} stamp={board?.stamp ?? ''} refreshing={state.refreshing}
        powers={board ? { canRequest: !requestClosedWhy(board), requestWhy: requestClosedWhy(board), canEdit } : null}
        canSetup={canSetup || canTypes} onPanel={(p) => onPanel(p)} onReload={onReload} />

      {showTest && (
        <div role="status" data-test-mode=""
          className="mb-4 flex items-start gap-2 rounded-[12px] border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-amber px-3 py-2 text-[12.5px] font-semibold leading-5 text-tint-fg-amber">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            {testMode && !testMode.on && testMode.readable ? '' : TEST_MODE_WORDS}
            {(!testMode || !testMode.readable) && (
              <span className="block font-normal">{TEST_MODE_UNREAD_WORDS}{testMode?.why ? ` (${testMode.why})` : ''}.</span>
            )}
          </span>
        </div>
      )}

      {!board && state.status === 'failed' && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[12px] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-tint-danger px-3 py-2.5 text-[12.5px] text-tint-fg-danger" data-read-failed="">
          <span className="flex-1">The vehicle calendar could not be read — {state.error || 'the server did not answer'}.</span>
          <button type="button" className={OUTLINE_BTN} onClick={onReload}><RefreshCw size={13} /> Try again</button>
        </div>
      )}
      {!board && state.status === 'loading' && <Loading />}
      {board && state.error && (
        <p className="mb-3 text-[12px] text-text-3" data-stale="">Showing the last copy — {state.error.replace(/\.$/, '')}.</p>
      )}
      {board && sourceLines(board).map((line) => (
        <p key={line} className="mb-2 flex items-start gap-1.5 text-[12.5px] leading-5 text-danger" data-source-unread="">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {line}
        </p>
      ))}
      {board?.note && <Muted className="mb-3">{board.note}</Muted>}
      {seedHint && <div data-no-vehicles=""><Muted className="mb-3">{NO_VEHICLES_WORDS}</Muted></div>}

      {board && page === 'calendar' && (
        <>
          <VehicleStatusCards vehicles={board.vehicles} stamp={board.stamp} onPanel={onPanel} empty={seedHint ? '' : undefined} />
          <FilterBar vehicles={board.vehicles} shown={shownIds} view={prefs.view}
            onShown={(next) => setPrefs((p) => ({ ...p, hidden: next ? board.vehicles.map((v) => v.id).filter((id) => !next.has(id)) : [] }))}
            onView={(view) => setPrefs((p) => ({ ...p, view }))} date={day} onDate={setDate} />
          <CalendarCard view={prefs.view} date={day} today={today} trips={board.trips} vehicles={board.vehicles} shown={shownIds}
            onDate={setDate} onPanel={onPanel} />
          <Muted className="mt-3">{FOOTNOTE}</Muted>
        </>
      )}
      {board && page === 'history' && (
        <>
          <KpiRow board={board} unread={tripsUnread} />
          <HistoryTable trips={board.trips} onPanel={onPanel} />
        </>
      )}
      {board && page === 'vehicles' && (
        <>
          <KpiRow board={board} unread={tripsUnread} />
          <VehiclesTable vehicles={board.vehicles} trips={board.trips} date={day} onDate={setDate} canEdit={canEdit} onPanel={onPanel} />
        </>
      )}

      <PanelHost board={board} page={page} panel={panel} master={master} canSetup={canSetup} canTypes={canTypes} powers={powers}
        onPanel={onPanel} onWrite={onWrite} onReload={onReload} />
    </div>
  )
}

function Loading() {
  return (
    <div className="grid gap-3" data-loading="">
      <p className="text-[13px] text-text-3">Reading the vehicle calendar…</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-[112px] animate-pulse rounded-[16px] bg-surface-2" />)}
      </div>
      <div className="h-[320px] animate-pulse rounded-[16px] bg-surface-2" />
    </div>
  )
}

/* ---------- the one right panel ---------- */

function panelHead(p: Panel, board: Board | null, pageLabel: string, powers: Powers, canSetup: boolean): { label: string; title: string; wide: boolean } {
  if (p.kind === 'setup') return { label: 'Setup', title: canSetup ? 'Vehicles, Van Calendar and directors' : 'Trip types', wide: false }
  if (p.kind === 'request') return { label: 'Request', title: 'New request', wide: false }
  if (p.kind === 'trip') return { label: 'Trip', title: 'Trip details & assignment', wide: false }
  if (p.kind === 'vehicle-new') return { label: 'Vehicle', title: 'Add vehicle', wide: false }
  if (p.kind === 'vehicle') {
    const v = board?.vehicles.find((x) => x.id === p.id)
    return { label: 'Vehicle', title: powers.vehicles ? 'Edit vehicle' : v?.name ?? 'Vehicle', wide: false }
  }
  return { label: 'Share', title: `Share Transportation · ${pageLabel}`, wide: false }
}

/** The mode this viewer may open: Setup is the master's with or without a board (the trip types a listed person's, with one). */
function allowedPanel(panel: Panel | null, board: Board | null, canSetup: boolean, canTypes: boolean, powers: Powers): Panel | null {
  if (!panel) return null
  if (panel.kind === 'setup') return canSetup || canTypes ? panel : null
  if (!board) return null
  if (panel.kind === 'vehicle-new' && !powers.vehicles) return null
  return panel
}

function PanelHost({ board, page, panel, master, canSetup, canTypes, powers, onPanel, onWrite, onReload }: {
  board: Board | null
  page: PageId
  panel: Panel | null
  master: boolean
  canSetup: boolean
  canTypes: boolean
  powers: Powers
  onPanel: (p: Panel | null) => void
  onWrite: (answer: WriteAnswer, next: Panel | null | 'keep') => void
  onReload: () => void
}) {
  // a mode this viewer may not open is not drawn at all
  const allowed = allowedPanel(panel, board, canSetup, canTypes, powers)
  const pageLabel = PAGES.find((p) => p.id === page)?.label ?? 'Calendar'
  const head = allowed ? panelHead(allowed, board, pageLabel, powers, canSetup) : { label: 'Panel', title: '', wide: false }
  const close = () => onPanel(null)
  return (
    <SidePanel open={Boolean(allowed)} onClose={close} label={head.label} title={head.title} wide={head.wide}>
      {allowed?.kind === 'setup' && <SetupPanel key="setup" settings={board?.settings ?? null} onChanged={onReload} master={canSetup} />}
      {board && allowed?.kind === 'request' && (
        <RequestPanel key="request" board={board} onCancel={close}
          onDone={(a) => onWrite(a, a.trip_id ? { kind: 'trip', id: a.trip_id } : null)} />
      )}
      {board && allowed?.kind === 'trip' && (
        <TripPanel key={`trip~${allowed.id}`} board={board} trip={board.trips.find((t) => t.id === allowed.id) ?? null} isMaster={master}
          onClose={close} onDone={(a) => onWrite(a, 'keep')} />
      )}
      {board && (allowed?.kind === 'vehicle' || allowed?.kind === 'vehicle-new') && (
        <VehiclePanel key={panelParam(allowed)} board={board} isNew={allowed.kind === 'vehicle-new'} canEdit={powers.vehicles}
          vehicle={allowed.kind === 'vehicle' ? board.vehicles.find((v) => v.id === allowed.id) ?? null : null}
          onCancel={close} onDone={(a) => onWrite(a, null)} />
      )}
      {board && allowed?.kind === 'share' && (
        <ShareBody payload={{
          title: `Transportation · ${pageLabel}`,
          subtitle: 'The team’s vehicles — requests, approvals and the shared calendar. All times Eastern Time.',
          appHref: pageHref(page),
          text: board.vehicles.map((v) => {
            const t = v.active_trip ?? v.next_trip
            return `${v.name} — ${v.status.word || 'Available'}${t ? ` · ${v.active_trip ? 'active trip' : 'next booking'} ${whenWords(t.start_at, t.end_at)}` : ''}`
          }).join('\n'),
        }} />
      )}
    </SidePanel>
  )
}
