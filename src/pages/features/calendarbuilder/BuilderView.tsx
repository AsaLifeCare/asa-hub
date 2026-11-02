/** The Builder view, the only place a calendar is made: every edit a draft, Publish the live act (`house=all`: master). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AlertTriangle, CalendarPlus, CloudUpload, LayoutGrid, Loader2, ShieldAlert, Trash2, Undo2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import ConfirmDialog from '@/features/ops-flows/ConfirmDialog'
import { useMediaQuery } from '@/hooks/use-mobile'
import { toast } from '@/stores/useToastStore'
import { useUiPrefsStore, type CalendarRange, type CalendarView } from '@/stores/useUiPrefsStore'
import { liveConnected, onLiveEvent } from '@/lib/snapshotClient'
import { ohioTime, ohioToday } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import ShiftCellPanel, { type PanelTarget } from '@/pages/features/shifts/ShiftCellPanel'
import ShiftEditor, { type EditorSave } from '@/pages/features/shifts/ShiftEditor'
import HouseGrid, { type DragFrom } from '@/pages/features/shifts/HouseGrid'
import ClockTimesToggle from '@/pages/features/shifts/ClockTimesToggle'
import { useClockTimes } from '@/pages/features/shifts/clockPref'
import { LaneError, lane } from '@/pages/features/shifts/laneFetch'
import { OFFER_PATH } from '@/pages/features/shifts/handoffActions'
import { TEST_MODE_CELL } from '@/pages/features/shifts/publishedMark'
import { AMBER_NOTE, DANGER_NOTE } from '@/pages/features/shifts/shiftUi'
import { timeOffAt, timeOffUnreadLine, useTimeOffMarks } from '@/pages/features/shifts/timeOffMarks'
import { ABOVE_ALL, type HandoffView } from '@/pages/features/shifts/requestsLogic'
import {
  HOUSECAL_LIVE_EVENT, REQUESTS_PATH, cellKey, dropVerdict, handoffAt, houseShort, managerLine, openByCell,
  openShiftByRef, resolveHouse, rowNamed, weekKeyOf,
  type Grid, type HistoryEntry,
} from '@/pages/features/shifts/houseCalTypes'
import { houseLane, type BlockedCell, type BuilderHouse, type BuilderHouses } from './useHouseBuilderLane'
import { useBuilderRefresh } from './builderRefresh'
import {
  callOffReach, heldLine, publishSummary, publishedReach, publishedTitle, saveRequest, staffChoices,
} from './builderLogic'
import CalendarHero from './CalendarHero'
import HouseRail from './HouseRail'
import RangeBar from './RangeBar'
import MasterGrid from './MasterGrid'
import PublishHouseReview from './PublishHouseReview'
import {
  MASTER_HOUSE, builderRailSections, builderTiles, clampWeek, conflictCell, defaultHouse, drawnDays, foldPast,
  isRange, masterTiles, shiftsDrawn, statesPresent, tabWeeks, testModeHolds, thisWeek, withParams,
  type CarriedCell, type MasterSummary, type ViewCarry,
} from './calendarScreen'

/** A drop the desk is being asked about: it would replace what is there. */
type PendingDrop = { from: DragFrom; to: DragFrom; moving: string; displaced: string; label: string }

/** The transfers still waiting, as this reader may see them (GET /shift-handoff). */
type Board = { waiting_on_me?: HandoffView[]; mine?: HandoffView[]; open?: HandoffView[] }

/** A column's short label, e.g. 'Thu 9/24'. */
function colLabel(grid: Grid | null | undefined, iso: string): string {
  const c = grid?.cols.find((col) => String(col.iso || col.date || '') === iso)
  return c?.short || c?.label || iso
}

export default function BuilderView({ onView }: {
  /** the view switch: Live, carrying the house, range, week and the open cell (its ref when it has one) */
  onView: (view: CalendarView, at: ViewCarry) => void
}) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const wantHouse = params.get('house') ?? ''
  const wantDay = params.get('day') ?? ''
  const wantEmployee = params.get('employee') ?? ''
  const rangeParam = params.get('range')
  /** a phone draws one week, and moves go through the editor's fields, never a drag */
  const phone = useMediaQuery('(max-width: 639px)')
  /** the all-houses grid needs the room */
  const wide = useMediaQuery('(min-width: 1024px)')
  const rangePref = useUiPrefsStore((s) => s.calendarRange?.build ?? 'tab')
  const setCalendarRange = useUiPrefsStore((s) => s.setCalendarRange)
  const remembered = useUiPrefsStore((s) => s.calendarHouse ?? '')
  const range: CalendarRange = phone ? 'week' : isRange(rangeParam) ? rangeParam : rangePref

  const [houses, setHouses] = useState<BuilderHouse[] | null>(null)
  const [info, setInfo] = useState<Omit<BuilderHouses, 'houses'> | null>(null)
  const [refused, setRefused] = useState('')
  const [failed, setFailed] = useState('')
  const [filter, setFilter] = useState('')
  const [current, setCurrent] = useState('')
  const [grid, setGrid] = useState<Grid | null>(null)
  const [gridLoading, setGridLoading] = useState(false)
  const [gridFailed, setGridFailed] = useState('')
  const [staleWhy, setStaleWhy] = useState('')
  const [readAt, setReadAt] = useState('')
  const [target, setTarget] = useState<PanelTarget | null>(null)
  const [saving, setSaving] = useState(false)
  const [directory, setDirectory] = useState<string[]>([])
  const [directoryNote, setDirectoryNote] = useState('')
  /** the panel cell's history, shown only for its own cell and read */
  const [hist, setHist] = useState<{ key: string; rows: HistoryEntry[]; failed: string }>(
    { key: '', rows: [], failed: '' })
  const [focus, setFocus] = useState<{ iso: string; tick: number } | undefined>(undefined)
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  /** the question the "Published in test mode" list is asking, if any */
  const [heldAsk, setHeldAsk] = useState<'publish' | 'discard' | null>(null)
  const [blocked, setBlocked] = useState<{ message: string; cells: BlockedCell[] } | null>(null)
  const [adding, setAdding] = useState<{ who: string; day: string } | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  /** the days before today, folded into a stub until asked for */
  const [pastOpen, setPastOpen] = useState(false)
  /** the transfers still waiting (every house this reader may see); null when unread */
  const [board, setBoard] = useState<{ list: HandoffView[]; waiting: number } | null>(null)
  const [boardWhy, setBoardWhy] = useState('')
  /** the call-off door's refusal on one cell, said in the panel */
  const [callOffSaid, setCallOffSaid] = useState<{ key: string; code: string; why: string } | null>(null)
  /** which conflict "To look at" opens next */
  const [lookAt, setLookAt] = useState(0)
  /** what the master grid tells the band; each press of its Draft edits tile asks for its review */
  const [master, setMaster] = useState<MasterSummary | null>(null)
  const [publishAsk, setPublishAsk] = useState(0)
  const clock = useClockTimes()
  const timeOff = useTimeOffMarks(grid, true)
  const savingRef = useRef(false)
  useEffect(() => { savingRef.current = saving }, [saving])
  // a running shift's "so far" is a clock the open panel reads; nothing else redraws with it
  useEffect(() => {
    if (!target) return
    const first = window.setTimeout(() => setNowMs(Date.now()), 0)
    const t = window.setInterval(() => setNowMs(Date.now()), 30000)
    return () => { window.clearTimeout(first); window.clearInterval(t) }
  }, [target])

  /** the house asked for last; a slower answer for another house is dropped */
  const asked = useRef('')
  const openHouse = useCallback((location: string) => {
    asked.current = location
    setCurrent(location)
    setTarget(null)
    setBlocked(null)
    setCallOffSaid(null)
    setPastOpen(false)
    // the band, tiles and switch say nothing of this house until its own grid arrives
    setGrid(null)
    setReadAt('')
    setGridLoading(true)
    setGridFailed('')
    setStaleWhy('')
    useUiPrefsStore.getState().setCalendarHouse?.(location)
    houseLane.grid(location)
      .then((g) => {
        if (asked.current !== location) return
        setGrid(g)
        setReadAt(new Date().toISOString())
        // the view opens on today
        const w = g.computed?.window
        if (w?.covers_today && w.today) setFocus({ iso: w.today, tick: Date.now() })
      })
      .catch((err) => {
        if (asked.current !== location) return
        setGrid(null)
        setGridFailed(err instanceof Error ? err.message : 'no answer')
      })
      .finally(() => { if (asked.current === location) setGridLoading(false) })
  }, [])

  const openMaster = useCallback(() => {
    asked.current = MASTER_HOUSE
    setCurrent(MASTER_HOUSE)
    setTarget(null)
    setGrid(null)
    setGridLoading(false)
  }, [])

  const loadHouses = useCallback(() => {
    houseLane.houses()
      .then((d) => {
        setFailed('')
        setHouses([...d.houses].sort((a, b) => a.location.localeCompare(b.location)))
        setInfo({ me: d.me, edits_every_house: d.edits_every_house,
                  managers_readable: d.managers_readable, managers_why: d.managers_why })
      })
      .catch((err) => {
        if (err instanceof LaneError && err.status === 403) setRefused(err.message)
        else setFailed(err instanceof Error ? err.message : 'The Builder did not answer.')
      })
  }, [])
  useEffect(() => { loadHouses() }, [loadHouses])

  /** the transfers the Builder carries: the panel's guard and the band's "needs your answer" */
  const loadBoard = useCallback(() => {
    lane<Board>(OFFER_PATH)
      .then((d) => {
        setBoard({ list: [...(d.waiting_on_me ?? []), ...(d.mine ?? []), ...(d.open ?? [])],
                   waiting: (d.waiting_on_me ?? []).length })
        setBoardWhy('')
      })
      // a failed read is said, never "none waiting"
      .catch((err) => { setBoard(null); setBoardWhy(err instanceof Error ? err.message : 'no answer') })
  }, [])
  useEffect(() => { loadBoard() }, [loadBoard])
  useEffect(() => {
    const off = onLiveEvent(HOUSECAL_LIVE_EVENT, loadBoard)
    return () => off()
  }, [loadBoard])

  /** A house this reader does not build, or a reader who builds none: that house's roster, on Live. */
  const notYours = useCallback(() => {
    toast({ type: 'info', title: 'Not a house you build: showing its roster' })
    onView('live', { house: wantHouse, cell: wantDay ? { employee: wantEmployee, colIso: wantDay } : null })
  }, [onView, wantHouse, wantDay, wantEmployee])

  // the address names the house, by its name, code or short name; `all` is the master grid
  useEffect(() => {
    if (refused) {
      if (wantHouse && wantHouse !== MASTER_HOUSE) notYours()
      return
    }
    if (houses === null || info === null) return
    if (wantHouse === MASTER_HOUSE) {
      if (info.edits_every_house) {
        if (current !== MASTER_HOUSE) openMaster()
      } else {
        toast({ type: 'warning', title: 'Not a grid you build',
                body: 'The all-houses grid is built by those who edit every house.' })
        setParams((p) => withParams(p, { house: null }), { replace: true })
      }
      return
    }
    if (wantHouse) {
      const loc = resolveHouse(houses, wantHouse)
      if (!loc) { notYours(); return }
      if (loc !== current) openHouse(loc)
      return
    }
    if (current) return
    // no link: the house last opened, if built here, else the first A–Z; kept in the address
    const loc = defaultHouse(houses, remembered)
    if (loc) setParams((p) => withParams(p, { house: loc }), { replace: true })
  }, [refused, houses, info, wantHouse, current, remembered, openHouse, openMaster, notYours, setParams])

  // a link's day and person: the day in view, the cell in the panel; then dropped, so a reload does not reopen it
  useEffect(() => {
    if (!grid || (!wantDay && !wantEmployee)) return
    const expected = resolveHouse(houses, wantHouse) || wantHouse
    if (grid.location !== expected) return
    const iso = wantDay && grid.cols.some((c) => String(c.iso || c.date || '') === wantDay) ? wantDay : ''
    if (wantDay && !iso) {
      toast({ type: 'warning', title: 'That day is not on this calendar',
              body: `${wantDay} is outside the days ${houseShort(grid.location)}'s tab draws. The house is open below.` })
    }
    if (iso) {
      setFocus({ iso, tick: Date.now() })
      const today = grid.computed?.window.today ?? ''
      if (today && iso < today) setPastOpen(true)
      if (wantEmployee) {
        const row = rowNamed(grid.rows, wantEmployee)
        setTarget({ employee: row?.employee ?? wantEmployee, colIso: iso, label: colLabel(grid, iso) })
      }
    }
    setParams((p) => withParams(p, {
      house: grid.location, day: null, employee: null,
      ...(iso && range === 'week' ? { week: weekKeyOf(iso) } : {}),
    }), { replace: true })
  }, [grid, wantDay, wantEmployee, wantHouse, houses, range, setParams])

  useEffect(() => {
    houseLane.staff()
      .then((d) => {
        setDirectory(d.staff.map((s) => s.name))
        setDirectoryNote(d.accounts_readable ? '' : 'Staff accounts could not be read — the list holds the people on the calendars only.')
      })
      .catch((err) => setDirectoryNote(`The staff list could not be read (${err instanceof Error ? err.message : 'no answer'}) — only this house's people can be picked.`))
  }, [])

  /** the quiet re-read, without closing the panel; a ring mid-read reads once more */
  const quiet = useRef({ busy: false, again: false })
  const refresh = useCallback((location: string) => {
    const q = quiet.current
    if (q.busy || savingRef.current) { q.again = true; return }
    q.busy = true
    houseLane.grid(location)
      .then((g) => {
        // only the house on screen; a good answer also lifts a failed open
        if (asked.current !== location) return
        setGrid(g)
        setGridFailed('')
        setReadAt(new Date().toISOString())
        setStaleWhy('')
      })
      .catch((err) => {
        if (asked.current === location) setStaleWhy(err instanceof Error ? err.message : 'the server did not answer')
      })
      .finally(() => {
        q.busy = false
        if (q.again) {
          q.again = false
          window.setTimeout(() => {
            if (asked.current && asked.current !== MASTER_HOUSE) refresh(asked.current)
          }, 250)
        }
      })
  }, [])
  // Calendar Builder's header Refresh, the only one: the rail, the house (quietly, the panel kept), the transfers
  useBuilderRefresh(() => {
    loadHouses()
    loadBoard()
    if (current && current !== MASTER_HOUSE) {
      if (grid) refresh(current)
      else openHouse(current)
    }
  })
  useEffect(() => {
    if (!current || current === MASTER_HOUSE) return
    const ring = () => refresh(current)
    const offRing = onLiveEvent(HOUSECAL_LIVE_EVENT, ring)
    const offOpen = onLiveEvent('open', ring)
    return () => { offRing(); offOpen() }
  }, [current, refresh])
  useEffect(() => {
    if (saving || !current || current === MASTER_HOUSE || !quiet.current.again) return
    quiet.current.again = false
    refresh(current)
  }, [saving, current, refresh])
  /** "live" is said only while the stream is heard */
  const [heard, setHeard] = useState(() => liveConnected())
  useEffect(() => {
    const offOpen = onLiveEvent('open', () => setHeard(true))
    const offClose = onLiveEvent('close', () => setHeard(false))
    return () => { offOpen(); offClose() }
  }, [])

  const computed = grid?.computed ?? null
  const openCells = useMemo(() => openByCell(computed), [computed])
  /** the transfers waiting at this house, as the Builder reads GET /shift-handoff: drawn ⇄, and never dragged */
  const gridLocation = grid?.location ?? ''
  const boardHere = useMemo(() => (board && gridLocation
    ? board.list.filter((h) => h.location === gridLocation) : undefined), [board, gridLocation])
  // the days drawn, kept the same object while nothing about them changes, so the grid's memo holds
  const win = computed?.window
  const today = win?.today || ohioToday()
  const weeks = useMemo(() => tabWeeks(win), [win])
  const nowWeek = thisWeek(win)
  const week = clampWeek(params.get('week') ?? '', weeks, nowWeek)
  const drawn = useMemo(() => drawnDays(range, week, win), [range, week, win])
  // the days before today fold into a stub; opened, they are drawn dimmed
  const coversToday = Boolean(win?.covers_today)
  const fold = useMemo(() => foldPast(drawn, coversToday ? today : '', pastOpen), [drawn, coversToday, today, pastOpen])
  const staff = useMemo(() => staffChoices(grid?.rows ?? [], directory), [grid, directory])
  const tabDays = useMemo(() => (grid?.cols ?? []).map((c) => ({
    iso: String(c.iso || c.date || ''), label: `${c.weekday ?? ''} ${c.short || c.label || c.iso || ''}`.trim(),
  })), [grid])

  const absorb = useCallback((res: { grid?: Grid | null } | null | undefined) => {
    const whole = res?.grid
    if (whole) {
      if (whole.location !== asked.current) return
      setGrid(whole)
      setReadAt(new Date().toISOString())
      setStaleWhy('')
    } else if (current && current !== MASTER_HOUSE) {
      // the act landed but the re-read did not: read again
      refresh(current)
    }
  }, [current, refresh])

  const textAt = useCallback((employee: string, colIso: string): string => {
    const row = grid?.rows.find((r) => r.employee === employee)
    const colIdx = grid?.cols.findIndex((c) => String(c.iso || c.date || '') === colIso) ?? -1
    return row && colIdx >= 0 ? row.cells[colIdx]?.text ?? '' : ''
  }, [grid])
  const labelOf = useCallback((colIso: string): string => colLabel(grid, colIso), [grid])

  /** one act against a door; a refusal is said in its own words */
  const act = useCallback(async <T extends { grid?: Grid | null }>(
    run: () => Promise<T>, done: (res: T) => void, title: string, refusedWith?: (err: LaneError) => void,
  ): Promise<boolean> => {
    if (saving) return false
    setSaving(true)
    try {
      const res = await run()
      absorb(res)
      done(res)
      return true
    } catch (err) {
      if (err instanceof LaneError && Array.isArray(err.data.blocked) && err.data.blocked.length) {
        setBlocked({ message: err.message, cells: err.data.blocked as BlockedCell[] })
      }
      if (err instanceof LaneError) refusedWith?.(err)
      toast({ type: err instanceof LaneError && err.status === 409 ? 'warning' : 'danger',
              title, body: err instanceof Error ? err.message : 'Try again.' })
      if (current && current !== MASTER_HOUSE) refresh(current)
      return false
    } finally {
      setSaving(false)
    }
  }, [saving, absorb, current, refresh])

  const move = useCallback((from: DragFrom, to: DragFrom, swap: boolean, replace = false) => {
    if (!grid) return
    const location = grid.location
    const moving = textAt(from.employee, from.colIso)
    void (async () => {
      if (saving) return
      setSaving(true)
      try {
        const res = await houseLane.move({ location, from: { employee: from.employee, col_iso: from.colIso },
                                           to: { employee: to.employee, col_iso: to.colIso }, swap,
                                           ...(replace ? { replace: true } : {}) })
        absorb(res)
        if (res.warning) toast({ type: 'warning', title: 'Moved — time off was asked', body: res.warning })
        if (res.replaced) {
          toast({ type: 'success', title: 'Drafted — the shift replaced',
                  body: `${to.employee}'s ${res.displaced} on ${labelOf(to.colIso)} gives way to ${moving} in the draft. Nothing reaches the calendar until you publish.` })
        }
      } catch (err) {
        if (err instanceof LaneError && err.reason === 'occupied' && !replace && !swap) {
          setPendingDrop({ from, to, moving, displaced: String(err.data.value ?? ''), label: labelOf(to.colIso) })
        } else {
          toast({ type: 'warning', title: 'Not moved', body: err instanceof Error ? err.message : 'Try again.' })
        }
      } finally {
        setSaving(false)
      }
    })()
  }, [grid, saving, textAt, absorb, labelOf])

  /** A drop, read before anything is sent (houseCalTypes.dropVerdict). */
  const dropOnto = useCallback((from: DragFrom, to: DragFrom, swap: boolean) => {
    if (!grid) return
    const rowOf = (name: string) => grid.rows.find((r) => r.employee === name)
    const moving = textAt(from.employee, from.colIso)
    const verdict = dropVerdict({
      mayEdit: Boolean(grid.access?.edit),
      sameCell: from.employee === to.employee && from.colIso === to.colIso,
      fromOpenRow: Boolean(rowOf(from.employee)?.open_row),
      toOpenRow: Boolean(rowOf(to.employee)?.open_row),
      moving,
      landing: textAt(to.employee, to.colIso),
      swap,
      transferWaiting: Boolean(handoffAt(boardHere, from.employee, from.colIso)
        || handoffAt(boardHere, to.employee, to.colIso)),
    })
    if (verdict.kind === 'refuse') toast({ type: 'warning', title: 'Not moved', body: verdict.why })
    else if (verdict.kind === 'move') move(from, to, false)
    else if (verdict.kind === 'swap') move(from, to, true)
    else if (verdict.kind === 'confirm') {
      setPendingDrop({ from, to, moving, displaced: verdict.displaced, label: labelOf(to.colIso) })
    }
  }, [grid, textAt, move, labelOf, boardHere])

  // history re-read after every read of the house
  const histLoc = grid?.location ?? ''
  const histEmp = target?.employee ?? ''
  const histIso = target?.colIso ?? ''
  const histKey = histLoc && histEmp && histIso ? `${histLoc}|${histEmp}|${histIso}|${readAt}` : ''
  useEffect(() => {
    if (!histKey) return
    let live = true
    houseLane.history(histLoc, histEmp, histIso)
      .then((d) => { if (live) setHist({ key: histKey, rows: d.history, failed: '' }) })
      .catch((err) => {
        if (live) setHist({ key: histKey, rows: [], failed: err instanceof Error ? err.message : 'no answer' })
      })
    return () => { live = false }
  }, [histKey, histLoc, histEmp, histIso])
  const history = hist.key === histKey ? hist.rows : null
  const historyFailed = hist.key === histKey ? hist.failed : ''

  if (refused) {
    return (
      <Card className="p-6 text-center text-[13px] leading-6 text-text-2">
        {refused}
        <button onClick={() => onView('live', {})}
          className="mx-auto mt-2 block font-semibold text-primary hover:underline">
          Open Live
        </button>
      </Card>
    )
  }

  const isMaster = current === MASTER_HOUSE
  const dimBefore = pastOpen && coversToday && drawn && today > drawn.from && today <= drawn.to ? today : ''
  const held = testModeHolds(grid)
  const drafts = grid?.drafts ?? []
  const summary = publishSummary(drafts, grid?.rows ?? [])
  const me = grid?.access?.me ?? info?.me ?? ''
  const hm = grid?.house_manager
  const shifts = shiftsDrawn(computed, fold.days)
  const tiles = isMaster ? masterTiles(master, houses) : builderTiles(grid, fold.days)
  /** only an explicit range travels with the switch; each view otherwise opens on its own */
  const carriedRange = isRange(rangeParam) ? rangeParam : undefined

  const panelTarget = target
  const panelText = panelTarget ? textAt(panelTarget.employee, panelTarget.colIso) : ''
  const panelFact = panelTarget && computed ? computed.cells[cellKey(panelTarget.employee, panelTarget.colIso)] : undefined
  const panelRow = panelTarget ? grid?.rows.find((r) => r.employee === panelTarget.employee) : undefined
  const panelCell = panelTarget && panelRow
    ? panelRow.cells[grid?.cols.findIndex((c) => String(c.iso || c.date || '') === panelTarget.colIso) ?? -1]
    : undefined
  // a drafted open shift is edited like any draft until published
  const panelOpen = panelTarget && panelText && !panelCell?.draft
    ? openCells.get(cellKey(panelTarget.employee, panelTarget.colIso)) : undefined
  const person = panelTarget ? computed?.people.find((p) => p.employee === panelTarget.employee) : undefined
  const panelWeek = panelTarget ? weekKeyOf(panelTarget.colIso) : ''
  const estateWeek = panelTarget && grid?.estate_readable ? grid.estate_weeks?.[panelTarget.employee]?.[panelWeek] : undefined
  /** a transfer waiting on this shift, as the Builder reads GET /shift-handoff */
  const cellTransfer = panelTarget && boardHere
    ? handoffAt(boardHere, panelTarget.employee, panelTarget.colIso)
    : undefined
  // WHAT MAY NOT BE CHANGED HERE, in the words the relay would refuse with.
  const locked = !panelTarget ? ''
    : panelRow?.call_off_row ? 'This is the call-off line Live draws — its shifts are applied for and given there, never edited here.'
    : panelOpen ? 'An open shift the calendar holds is not typed over, cleared or moved — it leaves the calendar only when somebody is given it, in Live.'
    : panelCell?.called_off && !panelCell.called_off.filled_by ? 'This shift was called off — it waits on its red cell in Live, where it is given.'
    : cellTransfer ? 'It is changed here once the transfer is answered or withdrawn in Live.'
    : ''
  const said = callOffSaid && panelTarget && callOffSaid.key === cellKey(panelTarget.employee, panelTarget.colIso)
    ? callOffSaid : null

  /** the view switch to Live: this house, and the open cell (its handle when it is a pooled shift) */
  const toLive = (cell?: CarriedCell | null) => onView('live', {
    house: isMaster ? '' : (grid?.location ?? current), range: carriedRange, week: params.get('week') || undefined,
    cell: cell ?? (panelTarget ? { employee: panelTarget.employee, colIso: panelTarget.colIso } : null),
  })
  const pickHouse = (location: string) => {
    setParams((p) => withParams(p, { house: location, day: null, employee: null }), { replace: true })
  }
  const setRange = (r: CalendarRange) => {
    setCalendarRange('build', r)
    setParams((p) => withParams(p, { range: r }), { replace: true })
  }
  const setWeek = (w: string, r?: CalendarRange) => {
    if (r) setCalendarRange('build', r)
    setParams((p) => withParams(p, { week: w, ...(r ? { range: r } : {}) }), { replace: true })
  }
  /** open one cell in the panel, bringing its week and day into view */
  const openCell = (employee: string, colIso: string) => {
    setTarget({ employee, colIso, label: labelOf(colIso) })
    if (range === 'week' && drawn && (colIso < drawn.from || colIso > drawn.to)) {
      setParams((p) => withParams(p, { week: weekKeyOf(colIso) }), { replace: true })
    }
    if (fold.days && colIso < fold.days.from) setPastOpen(true)
    setFocus({ iso: colIso, tick: Date.now() })
  }
  /** every tile acts */
  const onTile = (id: string) => {
    if (id === 'drafts') {
      if (summary.cells) { setBlocked(null); setPublishOpen(true) }
    } else if (id === 'look') {
      // every conflict, a week over the line included (it opens that person's first shift of the week)
      const looks = computed?.conflicts ?? []
      if (!looks.length) return
      const at = conflictCell(looks[lookAt % looks.length], computed)
      setLookAt((n) => n + 1)
      openCell(at.employee, at.colIso)
    } else if (id === 'trainings') {
      const d = drafts.find((x) => x.ist)
      if (d) openCell(d.employee, d.col_iso)
    } else if (id === 'over40') {
      const line = computed?.weekly_ot_hours ?? 40
      for (const [name, byWeek] of Object.entries(grid?.estate_weeks ?? {})) {
        const over = Object.entries(byWeek ?? {}).find(([, h]) => h > line)
        if (!over) continue
        const first = Object.values(computed?.cells ?? {}).filter((f) => f.employee === name
          && weekKeyOf(f.col_iso) === over[0] && f.hours > 0).sort((a, b) => a.col_iso.localeCompare(b.col_iso))[0]
        openCell(name, first?.col_iso ?? over[0])
        return
      }
    } else if (id === 'held') {
      document.getElementById('held-cells')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (id === 'm-drafts') {
      setPublishAsk((n) => n + 1)
    } else if (id === 'm-conflicts' || id === 'm-test') {
      document.getElementById('master-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else if (id === 'm-houses') {
      const h = (houses ?? []).find((x) => (x.drafts ?? 0) > 0)
      if (h) pickHouse(h.location)
    }
  }

  const onSave = (s: EditorSave) => {
    if (!grid || !panelTarget) return
    const req = saveRequest(grid.location, panelTarget, Boolean(panelText.trim()), s)
    void act<{ grid?: Grid | null; warning?: string }>(
      () => (req.door === 'move' ? houseLane.move(req.body) : houseLane.cell(req.body)),
      (r) => {
        setTarget(null)
        if (r.warning) toast({ type: 'warning', title: 'Drafted — time off was asked', body: r.warning })
      },
      'Not drafted',
    )
  }
  /** Mark Call-Off: a full call-off at once, never a draft; asked in the panel's own box first */
  const markCallOff = (at: PanelTarget, note: string) => {
    if (!grid) return
    setCallOffSaid(null)
    void act(() => houseLane.callOff(grid.location, at.employee, at.colIso, note), (r) => {
      setTarget(null)
      toast({ type: 'success', title: 'Called off — the shift is open',
              body: callOffReach(ohioTime(r.window.closes_at), r.road) })
    }, 'Not called off', (err) => setCallOffSaid({ key: cellKey(at.employee, at.colIso), code: err.reason, why: err.message }))
  }

  const masterEntry = info?.edits_every_house ? (
    <button type="button" onClick={() => pickHouse(MASTER_HOUSE)} aria-current={isMaster ? 'true' : undefined}
      className={cn('mb-1 flex w-full flex-col gap-0.5 rounded-[10px] border border-dashed px-2.5 py-2 text-left transition-colors',
        isMaster ? 'border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-primary-soft' : 'border-border hover:bg-surface-2')}>
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-1">
        <LayoutGrid size={12} className="shrink-0 text-text-3" /> All houses · master grid
      </span>
      <span className="text-[11px] text-text-3">Every house at once, its own draft</span>
    </button>
  ) : null

  const band = (
    <CalendarHero
      view="build"
      house={isMaster ? '' : current}
      eyebrow={isMaster ? 'Master grid: the next period in the Master Calendar Creator, a separate draft from each house\'s draft' : undefined}
      title={isMaster ? 'All houses' : undefined}
      managerText={grid ? (managerLine(hm) || 'None named') : ''}
      managerWhy={hm?.why}
      access={grid?.access ? { edit: grid.access.edit, why: grid.access.why } : null}
      switcher={{ shown: true, enabled: true, why: '',
                  drafts: isMaster ? (master?.drafts ?? null) : grid ? summary.cells : null }}
      onView={(v) => { if (v === 'live') toLive() }}
      tiles={tiles}
      onTile={onTile}
      today={today}
      strip={{ heard, readAt, testMode: isMaster ? (master?.testMode ?? null) : held,
               transfersWaiting: boardWhy ? null : board ? board.waiting : undefined }}
    />
  )

  const houseCard = (
    <Card padded={false} className={cn('min-w-0 flex-1 overflow-hidden max-sm:overflow-visible',
      grid && !gridLoading && 'border-2 border-warning')}>
      {!current ? (
        <p className="p-8 text-center text-[13px] text-text-3">
          {houses === null && !failed ? 'Opening the houses…' : 'Pick a house to build its calendar.'}
        </p>
      ) : gridLoading ? (
        <p className="flex items-center justify-center gap-2 p-8 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Opening {houseShort(current)}…
        </p>
      ) : !grid ? (
        <p className="p-8 text-center text-[13px] text-text-3">
          The house could not be read{gridFailed ? `: ${gridFailed}` : '.'}
        </p>
      ) : (
        <>
          {/* THE DRAFT BAR — on the grid itself, so a screenshot still says draft */}
          <div aria-label="Draft" className="bg-warning px-3 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-surface max-sm:sticky max-sm:top-10 max-sm:z-10">
            Draft · {houseShort(grid.location)} · not live until you publish
          </div>

          {/* the draft's own acts; the pills moved into the band */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => void act(() => houseLane.undo(grid.location),
                (r) => toast({ type: 'success', title: `Undone — ${r.undone} cell${r.undone === 1 ? '' : 's'} back as they were` }), 'Nothing undone')}
                disabled={saving}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
                <Undo2 size={14} /> Undo
              </button>
              <button onClick={() => setAdding({ who: '', day: tabDays.some((d) => d.iso === today) ? today : tabDays[0]?.iso ?? '' })}
                disabled={saving}
                title="Put a shift on somebody who is not yet a row of this house"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
                <CalendarPlus size={14} /> Add somebody
              </button>
              <button onClick={() => setDiscardOpen(true)} disabled={saving || !summary.cells}
                className="flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-50">
                <Trash2 size={14} /> Discard
              </button>
            </div>
            <button onClick={() => { setBlocked(null); setPublishOpen(true) }} disabled={saving || !summary.cells}
              title={summary.cells ? 'Review and publish this house\'s draft to its calendar' : 'Nothing drafted yet'}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50 max-sm:hidden">
              <CloudUpload size={14} /> Publish house…
              <span className="rounded-[6px] bg-white/20 px-1.5 text-[10px] tracking-[0.05em]">LIVE</span>
            </button>
          </div>

          {adding && (
            <div className="flex flex-wrap items-end gap-2 border-b border-border bg-surface-2 px-3 py-2.5">
              <label className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                Who
                <select value={adding.who} onChange={(e) => setAdding({ ...adding, who: e.target.value })}
                  className="mt-1 block h-9 w-[240px] max-w-full rounded-md border border-border bg-surface px-2 text-[12.5px] font-normal normal-case tracking-normal text-text-1">
                  <option value="">Pick a member of staff…</option>
                  {staff.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                Day
                <select value={adding.day} onChange={(e) => setAdding({ ...adding, day: e.target.value })}
                  className="mt-1 block h-9 rounded-md border border-border bg-surface px-2 text-[12.5px] font-normal normal-case tracking-normal text-text-1">
                  {tabDays.map((d) => <option key={d.iso} value={d.iso}>{d.label}</option>)}
                </select>
              </label>
              <button disabled={!adding.who || !adding.day}
                onClick={() => {
                  const row = rowNamed(grid.rows, adding.who)
                  openCell(row?.employee ?? adding.who, adding.day)
                  setAdding(null)
                }}
                className="h-9 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary disabled:opacity-50">
                Open their cell
              </button>
              <button onClick={() => setAdding(null)} className="h-9 rounded-md px-3 text-[13px] font-semibold text-text-2 hover:bg-surface">
                Not now
              </button>
              {directoryNote && <p className="w-full text-[11.5px] text-text-3">{directoryNote}</p>}
            </div>
          )}

          <RangeBar days={drawn} weeks={weeks} week={week} range={range} thisWeek={nowWeek}
            onWeek={setWeek} onRange={setRange} weekOnly={phone}
            onToday={() => setFocus({ iso: today, tick: Date.now() })}
            time={<ClockTimesToggle className="h-8 text-[12.5px]" />}
            present={statesPresent(grid, 'build', timeOff, true, boardHere)} />

          {/* 1 · a refused publish: its cells, and the draft kept */}
          {blocked && (
            <div className={cn('mx-3 mt-2 rounded-md px-3 py-2.5', DANGER_NOTE)}>
              <p className="flex items-center gap-2 text-[13px] font-semibold text-text-1">
                <ShieldAlert size={15} className="text-danger" /> {blocked.message}
              </p>
              <ul className="mt-1.5 grid gap-1 text-[12px] text-text-2">
                {blocked.cells.map((b, i) => (
                  <li key={i} className="rounded-sm bg-surface px-2 py-1">
                    <strong>{b.employee}</strong> · {labelOf(b.col_iso)} — {b.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11.5px] text-text-3">
                Nothing was written. The draft is kept: change or undo those cells, then publish again.
              </p>
            </div>
          )}

          {/* 2 · test mode holds workbook writes; said before anything is pressed */}
          {held && (
            <div className={cn('mx-3 mt-2 flex items-start gap-2 rounded-md px-3 py-2', AMBER_NOTE)}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
              <p className="text-[12px] leading-5 text-text-1">
                {held === 'on' ? 'Test mode is on' : 'Test mode could not be read'}, so it holds: Publish records
                this house's cells on the platform and does not write the workbook. They are shown everywhere
                marked as test mode, and wait below until you publish them for real or discard them.
              </p>
            </div>
          )}

          {/* 3 · WHAT TEST MODE HELD HERE — never replayed on its own */}
          {(grid.held?.length ?? 0) > 0 && (
            <div id="held-cells" className={cn('mx-3 mt-2 rounded-md px-3 py-2.5', AMBER_NOTE)}>
              <p className="text-[13px] font-semibold text-text-1">
                Published in test mode, not in the workbook — {grid.held!.length} cell{grid.held!.length === 1 ? '' : 's'}
              </p>
              <ul className="mt-1.5 grid gap-1 text-[12px] text-text-2">
                {grid.held!.map((h) => (
                  <li key={`${h.employee}|${h.col_iso}`} className="rounded-sm bg-surface px-2 py-1">
                    {heldLine(h, labelOf(h.col_iso))}
                    <span className="text-text-3"> · {h.by}{h.at ? `, ${ohioTime(h.at)}` : ''}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={() => setHeldAsk('publish')} disabled={saving || Boolean(grid.test_mode?.on)}
                  title={grid.test_mode?.on ? 'Test mode is still on — it would only be held again' : 'Write these cells to the workbook now'}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary disabled:opacity-50">
                  <CloudUpload size={13} /> Publish now
                  <span className="rounded-[6px] bg-white/20 px-1.5 text-[10px] tracking-[0.05em]">LIVE</span>
                </button>
                <button onClick={() => setHeldAsk('discard')} disabled={saving}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
                  <Trash2 size={13} /> Discard
                </button>
                {grid.test_mode?.on && (
                  <span className="text-[11.5px] text-text-3">Publish now opens once test mode is off.</span>
                )}
              </div>
            </div>
          )}

          {/* 4 · a held list that could not be read is never "nothing held" */}
          {grid.held_readable === false && (
            <p className={cn('mx-3 mt-2 rounded-md px-3 py-2 text-[12px] text-danger', DANGER_NOTE)}>
              What test mode held at this house could not be read just now — this is not "nothing held".
            </p>
          )}

          {/* 5 · an unread pool, and a tab that does not draw today */}
          {grid.pool && !grid.pool.readable && (
            <div className={cn('mx-3 mt-2 flex items-start gap-2 rounded-md px-3 py-2', DANGER_NOTE)}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[12px] leading-5 text-danger">{grid.pool.why}</p>
            </div>
          )}
          {computed && !computed.window.covers_today && computed.window.first && (
            <div className={cn('mx-3 mt-2 flex items-start gap-2 rounded-md px-3 py-2', DANGER_NOTE)}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[12px] leading-5 text-danger">
                This tab does not cover today — it draws {computed.window.days}{' '}
                {computed.window.days === 1 ? 'day' : 'days'}, {computed.window.first}
                {computed.window.last !== computed.window.first && ` to ${computed.window.last}`}.
              </p>
            </div>
          )}
          {staleWhy && (
            <p className={cn('mx-3 mt-2 rounded-md px-3 py-2 text-[12px] leading-5 text-danger', DANGER_NOTE)}>
              The last re-read did not land ({staleWhy}) — this is the house as read at {ohioTime(readAt)}.
            </p>
          )}

          {/* the days before today, folded into a stub that opens on click */}
          {fold.folded > 0 ? (
            <button type="button" onClick={() => setPastOpen(true)}
              className="mx-3 mt-2 text-[11.5px] font-semibold text-text-3 hover:text-text-1">
              ‹ {fold.folded} earlier {fold.folded === 1 ? 'day' : 'days'}
            </button>
          ) : dimBefore ? (
            <button type="button" onClick={() => setPastOpen(false)}
              className="mx-3 mt-2 text-[11.5px] font-semibold text-text-3 hover:text-text-1">
              Fold the days before today
            </button>
          ) : null}

          <div className="mt-1 overflow-x-auto px-1.5 pb-1.5">
            <HouseGrid grid={grid} clock={clock} mode="builder" editor canDrag={Boolean(grid.access?.edit) && !phone}
              focus={focus} onOpen={setTarget} onDrop={dropOnto} days={fold.days} me={me} timeOff={timeOff}
              selected={panelTarget} dimBefore={dimBefore} handoffs={boardHere} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-text-3">
            <span>
              {saving ? 'Saving…' : readAt ? `Read ${ohioTime(readAt)}` : ''}
              {heard ? ' · following changes live' : ' · not hearing live changes right now — Refresh reads again'}
            </span>
            <span>Drafted cells are ringed amber · the running shift green · dashed = test mode · ⇄ = a transfer waits · click an empty cell to add a shift</span>
            {held && <span>A dashed amber cell was recorded in test mode — {TEST_MODE_CELL}</span>}
            {grid.estate_readable === false && (
              <span className="text-danger">Each person's hours at the other houses could not be totalled just now.</span>
            )}
            {timeOffUnreadLine(grid) && <span className="text-danger">{timeOffUnreadLine(grid)}</span>}
            {clock && <span>Times spelled out — the cells still hold their codes</span>}
            {shifts !== null && (
              <span>{shifts} {shifts === 1 ? 'shift' : 'shifts'} {range === 'week' ? 'this week' : 'on the days drawn'}, the draft on</span>
            )}
          </div>
        </>
      )}
    </Card>
  )

  return (
    <div className="w-full max-sm:pb-20">
      {band}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <HouseRail
          sections={builderRailSections(houses, filter)}
          current={current}
          currentLabel={isMaster ? 'All houses · master grid' : undefined}
          onPick={pickHouse}
          filter={filter}
          onFilter={setFilter}
          loading={houses === null && !failed}
          failed={failed}
          top={masterEntry}
          note={info && !info.managers_readable ? (
            <>Who manages each house could not be read{info.managers_why ? ` (${info.managers_why})` : ''} —
              until it can, only {ABOVE_ALL} build calendars.</>
          ) : undefined}
        />

        {isMaster ? (
          wide ? (
            <div id="master-grid" className="min-w-0 flex-1">
              <MasterGrid onSummary={setMaster} publishAsk={publishAsk} />
            </div>
          ) : (
            <Card className="min-w-0 flex-1 p-6 text-center text-[13px] text-text-3">
              The all-houses grid needs a wider screen.
            </Card>
          )
        ) : houseCard}
      </div>

      {/* a phone: the draft's count and Publish, always in reach */}
      {grid && !isMaster && (
        <div className="fixed bottom-0 z-20 flex items-center justify-between gap-3 border-t-2 border-warning bg-surface px-4 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2.5 shadow-3 max-sm:inset-x-0 sm:hidden">
          <span className="text-[13px] font-semibold text-text-1">
            {summary.cells} draft edit{summary.cells === 1 ? '' : 's'}
          </span>
          <button onClick={() => { setBlocked(null); setPublishOpen(true) }} disabled={saving || !summary.cells}
            className="flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-50">
            <CloudUpload size={14} /> Publish house…
          </button>
        </div>
      )}

      <ShiftCellPanel
        target={isMaster ? null : panelTarget}
        house={grid?.location ?? current}
        text={panelText}
        fact={panelFact}
        computed={computed}
        saving={saving}
        openShift={panelOpen}
        staff={staff}
        mayEdit={Boolean(grid?.access?.edit)}
        openRow={Boolean(panelRow?.open_row)}
        me={me}
        calledOff={panelCell?.called_off}
        callOffLine={Boolean(panelRow?.call_off_row)}
        timeOff={panelCell?.time_off}
        onOpenTimeOff={(ref) => navigate(`/app/timeoff/requests?ref=${encodeURIComponent(ref)}`)}
        mode="builder"
        estateWeek={estateWeek}
        onOpenLive={() => {
          if (!grid || !panelTarget) return
          const s = panelOpen ?? (panelCell?.called_off?.ref ? openShiftByRef(computed, panelCell.called_off.ref) : undefined)
          toLive({ employee: panelTarget.employee, colIso: panelTarget.colIso, ...(s?.ref ? { ref: s.ref } : {}) })
        }}
        onCallOff={(note) => { if (panelTarget) markCallOff(panelTarget, note) }}
        callOffSaid={said}
        testMode={held}
        drafted={Boolean(panelCell?.draft)}
        transferWaiting={cellTransfer}
        transfersWhy={boardWhy}
        editor={panelTarget && grid ? (
          <ShiftEditor
            key={`${panelTarget.employee}|${panelTarget.colIso}|${panelText}|${panelCell?.draft?.note ?? ''}`}
            employee={panelTarget.employee}
            colIso={panelTarget.colIso}
            text={panelText}
            fact={panelFact}
            draft={panelCell?.draft}
            days={tabDays}
            staff={staff}
            openRow={Boolean(panelRow?.open_row)}
            locked={locked}
            saving={saving}
            history={history}
            historyFailed={historyFailed}
            weekHere={person?.by_week?.[panelWeek]}
            weekAll={estateWeek}
            overLine={computed?.weekly_ot_hours ?? 40}
            nowMs={nowMs}
            timeOff={timeOffAt(timeOff, cellKey(panelTarget.employee, panelTarget.colIso), true)}
            onSave={onSave}
            onDelete={(note) => void act(
              () => houseLane.cell({ location: grid.location, employee: panelTarget.employee,
                                     col_iso: panelTarget.colIso, value: '', note, via: 'delete' }),
              () => setTarget(null), 'Not deleted')}
            onRequestOff={(note) => void act(
              () => houseLane.requestOff(grid.location, panelTarget.employee, panelTarget.colIso, note),
              (r) => {
                setTarget(null)
                toast({ type: 'success', title: 'Day off drafted',
                        body: r.moved_to ? `The shift moves to ${r.moved_to} as an open shift when you publish.` : (r.why ?? 'R/O drafted.') })
              }, 'Not requested off')}
            onUndo={() => void act(() => houseLane.undo(grid.location),
              (r) => toast({ type: 'success', title: `Undone — ${r.undone} cell${r.undone === 1 ? '' : 's'} back as they were` }),
              'Nothing undone')}
          />
        ) : null}
        onClaim={() => {}}
        onOpenRequests={() => navigate(REQUESTS_PATH)}
        onClose={() => setTarget(null)}
      />

      {/* a plain drop onto a full cell asks first */}
      <ConfirmDialog
        open={pendingDrop !== null}
        title="Replace this shift?"
        body={pendingDrop
          ? `${pendingDrop.to.employee} already has ${pendingDrop.displaced} on ${pendingDrop.label}. Dropping ${pendingDrop.moving} there removes it from the draft — the cell's history keeps it. To trade the two instead, hold Shift while you drop.`
          : ''}
        confirmLabel="Replace"
        busyLabel="Replacing…"
        busy={saving}
        onCancel={() => setPendingDrop(null)}
        onConfirm={() => {
          const d = pendingDrop
          setPendingDrop(null)
          if (d) move(d.from, d.to, false, true)
        }}
      />

      <ConfirmDialog
        open={discardOpen}
        title="Throw this house's draft away?"
        body={`${summary.cells} drafted cell${summary.cells === 1 ? '' : 's'} go back to what the calendar says. Each one stays in its cell's history as discarded.`}
        confirmLabel="Discard the draft"
        busyLabel="Discarding…"
        busy={saving}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false)
          if (grid) void act(() => houseLane.discard(grid.location),
            (r) => toast({ type: 'success', title: `Draft discarded — ${r.discarded} cell${r.discarded === 1 ? '' : 's'}` }),
            'Not discarded')
        }}
      />

      {publishOpen && grid && (
        <PublishHouseReview
          location={grid.location}
          drafts={drafts}
          summary={summary}
          days={fold.days}
          labelOf={labelOf}
          saving={saving}
          testMode={held}
          onClose={() => setPublishOpen(false)}
          onConfirm={() => void act(() => houseLane.publish(grid.location), (r) => {
            setPublishOpen(false)
            setBlocked(null)
            loadHouses()
            toast({ type: r.test_mode ? 'warning' : 'success', title: publishedTitle(r, grid.location),
                    body: `${r.already ? `${r.already} already said it. ` : ''}${r.rows_added.length ? `New rows: ${r.rows_added.join(', ')}. ` : ''}${r.training.length ? `${r.training.length} training approval${r.training.length === 1 ? '' : 's'} recorded as yours. ` : ''}${publishedReach(r.recorded, r.test_mode)}` })
          }, 'Not published').then((ok) => { if (!ok) setPublishOpen(false) })}
        />
      )}

      <ConfirmDialog
        open={heldAsk !== null}
        title={heldAsk === 'publish' ? 'Publish what test mode held?' : 'Discard what test mode held?'}
        body={heldAsk === 'publish'
          ? `${grid?.held?.length ?? 0} cell${(grid?.held?.length ?? 0) === 1 ? '' : 's'} are written into ${grid?.location ?? 'this house'}'s tab of the workbook now. Every shift is checked again for overlaps and trainings first, and if anybody changed one of these cells in the workbook meanwhile, nothing is written and you are told which.`
          : `${grid?.held?.length ?? 0} cell${(grid?.held?.length ?? 0) === 1 ? '' : 's'} never reach the workbook. Each stays in its cell's history as discarded, and a training their publish took on is withdrawn. A decision or a swap made in test mode stays decided on Requests.`}
        confirmLabel={heldAsk === 'publish' ? 'Publish now' : 'Discard them'}
        busyLabel={heldAsk === 'publish' ? 'Publishing…' : 'Discarding…'}
        busy={saving}
        onCancel={() => setHeldAsk(null)}
        onConfirm={() => {
          const ask = heldAsk
          setHeldAsk(null)
          if (!grid || !ask) return
          if (ask === 'publish') {
            void act(() => houseLane.heldPublish(grid.location), (r) => {
              loadHouses()
              toast({ type: r.test_mode ? 'warning' : 'success', title: publishedTitle(r, grid.location),
                      body: `${r.already ? `${r.already} already said it. ` : ''}${publishedReach(r.recorded, r.test_mode)}` })
            }, 'Not published')
          } else {
            void act(() => houseLane.heldDiscard(grid.location), (r) => {
              toast({ type: 'success', title: `Discarded — ${r.discarded} cell${r.discarded === 1 ? '' : 's'} test mode held`,
                      body: r.trainings_withdrawn ? `${r.trainings_withdrawn} training approval${r.trainings_withdrawn === 1 ? '' : 's'} withdrawn with them.` : 'The workbook never had them.' })
            }, 'Not discarded')
          }
        }}
      />
    </div>
  )
}
