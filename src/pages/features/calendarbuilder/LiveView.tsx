/** Calendar Builder's Live view: the live roster and its operations; it reads the live door, which has no draft layer. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AlertTriangle, Loader2, Pencil, PhoneOff } from 'lucide-react'
import Card from '@/components/shared/Card'
import { useMediaQuery } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import { useUiPrefsStore, type CalendarRange, type CalendarView } from '@/stores/useUiPrefsStore'
import { liveConnected, onLiveEvent } from '@/lib/snapshotClient'
import { ohioTime, ohioToday } from '@/lib/ohio'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { isAllowedWith, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import ShiftCellPanel, { type PanelTarget } from '@/pages/features/shifts/ShiftCellPanel'
import HandoffWaiting from '@/pages/features/shifts/HandoffWaiting'
import { actOnHandoff } from '@/pages/features/shifts/handoffActions'
import ClockTimesToggle from '@/pages/features/shifts/ClockTimesToggle'
import HouseGrid from '@/pages/features/shifts/HouseGrid'
import LastRosterWeek from '@/pages/features/shifts/LastRosterWeek'
import { useClockTimes } from '@/pages/features/shifts/clockPref'
import { useOpenShifts } from '@/pages/features/shifts/useOpenShifts'
import { TEST_MODE_CELL } from '@/pages/features/shifts/publishedMark'
import { AMBER_NOTE, DANGER_NOTE } from '@/pages/features/shifts/shiftUi'
import { timeOffUnreadLine, useTimeOffMarks } from '@/pages/features/shifts/timeOffMarks'
import { ABOVE_ALL, dayLabel, shiftHandle, trainingLine, type HandoffView, type Training } from '@/pages/features/shifts/requestsLogic'
import { LaneError, lane } from '@/pages/features/shifts/laneFetch'
import {
  HOUSECAL_LIVE_EVENT, REQUESTS_PATH, builderClosedLine, cellKey, followTarget, houseShort, managerLine,
  nextWindowClose, openByCell, openShiftByRef, resolveHouse, rowNamed, sameName, sortHouses, weekKeyOf,
  type Computed, type Grid, type House, type OpenShift,
} from '@/pages/features/shifts/houseCalTypes'
import { useBuilderRefresh } from './builderRefresh'
import { houseLane } from './useHouseBuilderLane'
import { callOffReach } from './builderLogic'
import CalendarHero from './CalendarHero'
import DayAgenda from './DayAgenda'
import HouseRail from './HouseRail'
import RangeBar from './RangeBar'
import {
  acrossHouses, agendaDayOf, builderSwitch, callOffsWaiting, clampWeek, conflictCell, decisionsWaiting,
  drawnDays, houseToOpen, isOutage, isRange, linkedDay, liveEditorTiles, liveStaffTiles, openCountByHouse, openNow,
  railSections, readPhoneView, shiftsDrawn, statesPresent, tabWeeks, testModeHolds, thisWeek, weekDays,
  withParams, writePhoneView,
  type CarriedCell, type PhoneView, type TransfersCount, type ViewCarry,
} from './calendarScreen'

type HouseList = {
  houses: House[]
  me?: string
  managers_readable?: boolean
  managers_why?: string
  drafts_readable?: boolean
}

export default function LiveView({ onView }: {
  /** the view switch: the other view's page, carrying the house, range, week and the open cell */
  onView: (view: CalendarView, at: ViewCarry) => void
}) {
  const navigate = useNavigate()
  const [houses, setHouses] = useState<House[] | null>(null)
  const [listInfo, setListInfo] = useState<Omit<HouseList, 'houses'>>({})
  const [failed, setFailed] = useState('')
  /** The list door's own refusal — a client or a guardian — said in its words. */
  const [refused, setRefused] = useState('')
  const [houseFilter, setHouseFilter] = useState('')
  const [current, setCurrent] = useState('')
  const [grid, setGrid] = useState<Grid | null>(null)
  const [gridLoading, setGridLoading] = useState(false)
  /** why the open house could not be read; an outage draws the last roster instead */
  const [gridFailed, setGridFailed] = useState<{ why: string; outage: boolean } | null>(null)
  const [target, setTarget] = useState<PanelTarget | null>(null)
  const [saving, setSaving] = useState(false)
  /** The Time switch — the cells drawn as clock times. Display only. */
  const clock = useClockTimes()
  /** Bumped when an offer is made or answered, so the waiting card re-reads. */
  const [handoffTick, setHandoffTick] = useState(0)
  const [transfers, setTransfers] = useState<TransfersCount>(undefined)
  /** the call-off door's refusal on one cell, said in the panel */
  const [callOffSaid, setCallOffSaid] = useState<{ key: string; code: string; why: string } | null>(null)
  /** which conflict "To look at" opens next */
  const [lookAt, setLookAt] = useState(0)
  /** a day to bring into view (Today, on the whole tab) */
  const [focus, setFocus] = useState<{ iso: string; tick: number } | undefined>(undefined)
  const { shifts: estateOpen, reload: reloadOpen } = useOpenShifts()
  const rangePref = useUiPrefsStore((s) => s.calendarRange?.live ?? 'week')
  const setCalendarRange = useUiPrefsStore((s) => s.setCalendarRange)
  const remembered = useUiPrefsStore((s) => s.calendarHouse ?? '')
  /** a phone opens on one day at a time, or the grid, as this device last chose */
  const phone = useMediaQuery('(max-width: 639px)')
  const [phoneView, setPhoneView] = useState<PhoneView>(() => readPhoneView())
  const [agendaPick, setAgendaPick] = useState('')

  /** the relay's answer for the open house; nothing is offered before a grid says so */
  const mayEdit = Boolean(grid?.access?.edit)
  const timeOff = useTimeOffMarks(grid, mayEdit)
  /** whether App Access opens the Builder to the effective person; if not, said in words */
  const apps = useRegistryStore((s) => s.apps)
  const effRole = useEffectiveRole()
  useBadgeRulesVersion()   // a matrix edit re-decides this without a reload
  // the Builder page has its own gate, so the page is asked
  const builderOpen = useMemo(() => isAllowedWith(apps, effRole, 'calendarbuilder', 'builder'),
    [apps, effRole])
  // THE DEEP LINK.
  const [params, setParams] = useSearchParams()
  const wantHouse = params.get('house') ?? ''
  const wantOpen = params.get('open') ?? ''
  const wantRef = params.get('ref') ?? ''
  /** a notice's (or the Builder's) day: brought into view, and the week to fall back on when its shift is gone */
  const wantDay = params.get('day') ?? ''
  const rangeParam = params.get('range')
  const range: CalendarRange = isRange(rangeParam) ? rangeParam : rangePref
  /** The house a handle-only link (`?ref=SP…`) was found at, once asked. */
  const [refHouse, setRefHouse] = useState('')
  const askedRef = useRef('')
  /** last read time; a failed quiet re-read keeps the grid and says so */
  const [readAt, setReadAt] = useState('')
  const [staleWhy, setStaleWhy] = useState('')
  const savingRef = useRef(false)
  useEffect(() => { savingRef.current = saving }, [saving])

  /** a quiet re-read keeps the rail it has when it fails; the first read says so */
  const loadHouses = useCallback((quiet = false) => {
    if (!quiet) setFailed('')
    lane<HouseList>('/hub-lanes/housecal')
      .then((d) => {
        setFailed('')
        setHouses(sortHouses(d.houses ?? []))
        setListInfo({ me: d.me, managers_readable: d.managers_readable, managers_why: d.managers_why,
                      drafts_readable: d.drafts_readable })
      })
      .catch((err) => {
        if (err instanceof LaneError && err.status === 403) setRefused(err.message)
        else if (!quiet) setFailed(err instanceof Error ? err.message : 'The calendar mirror did not answer.')
      })
  }, [])
  useEffect(() => { loadHouses() }, [loadHouses])

  /** the house asked for last; an answer for another house is never drawn under this one's name */
  const asked = useRef('')
  const openHouse = useCallback((location: string) => {
    asked.current = location
    setCurrent(location)
    setTarget(null)
    // the band, tiles and panel say nothing of this house until its own grid arrives
    setGrid(null)
    setReadAt('')
    setGridLoading(true)
    setGridFailed(null)
    setStaleWhy('')
    useUiPrefsStore.getState().setCalendarHouse?.(location)
    lane<Grid>(`/hub-lanes/housecal/${encodeURIComponent(location)}`)
      .then((g) => {
        if (asked.current !== location) return
        setGrid(g)
        setReadAt(new Date().toISOString())
      })
      .catch((err) => {
        if (asked.current !== location) return
        setGrid(null)
        const why = err instanceof Error ? err.message : 'no answer'
        // a 5xx or no answer draws the last roster; a refusal is said in its own words
        const outage = isOutage(err)
        setGridFailed({ why, outage })
        if (!outage) toast({ type: 'danger', title: 'Calendar unreadable', body: why })
      })
      .finally(() => { if (asked.current === location) setGridLoading(false) })
  }, [])

  /** the quiet re-read: one at a time, never blanks the grid; a ring mid-read reads once more */
  const quiet = useRef({ busy: false, again: false })
  const refresh = useCallback((location: string) => {
    const q = quiet.current
    if (q.busy || savingRef.current) { q.again = true; return }
    q.busy = true
    lane<Grid>(`/hub-lanes/housecal/${encodeURIComponent(location)}`)
      .then((g) => {
        // only the house on screen; a good answer also lifts the last roster an outage drew
        if (asked.current !== location) return
        setGrid(g)
        setGridFailed(null)
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
          window.setTimeout(() => refresh(asked.current || location), 250)
        }
      })
  }, [])

  /** Refresh: the rail, the house (quietly, the panel kept), every open shift and the transfers */
  const reloadAll = useCallback(() => {
    loadHouses()
    reloadOpen()
    setHandoffTick((n) => n + 1)
    if (current) {
      if (grid) refresh(current)
      else openHouse(current)
    }
  }, [loadHouses, reloadOpen, openHouse, refresh, current, grid])
  useBuilderRefresh(reloadAll)

  // a linked house, by name, code or short name; a bare handle asks the relay for its house
  useEffect(() => {
    if (wantHouse) {
      // wait for the rail, unless the rail itself could not be read
      if (houses === null && !failed) return
      const loc = resolveHouse(houses, wantHouse) || (houses === null ? wantHouse : '')
      if (!loc) {
        toast({ type: 'warning', title: 'No calendar for that house',
                body: `${wantHouse} has no house calendar here.` })
        setParams((p) => withParams(p, { house: null, open: null, ref: null, day: null }), { replace: true })
        return
      }
      if (loc !== current) openHouse(loc)
      return
    }
    if (!wantRef || askedRef.current === wantRef) return
    askedRef.current = wantRef
    lane<{ location: string; col_iso: string }>(`/hub-lanes/housecal/ref/${encodeURIComponent(wantRef)}`)
      .then((d) => { setRefHouse(d.location); openHouse(d.location) })
      .catch((err) => {
        toast({ type: 'warning', title: 'That shift is not on the calendars',
                body: err instanceof Error ? err.message : 'It may no longer be open.' })
        // its day named no house, so it is not carried onto whichever house opens next
        setParams((p) => withParams(p, { ref: null, day: null }), { replace: true })
      })
  }, [wantHouse, wantRef, houses, failed, current, openHouse, setParams])

  // no link: the house last opened, else the reader's first, else A–Z (rail down: the last opened); kept in the address
  useEffect(() => {
    if (wantHouse || wantRef || refHouse || current) return
    const loc = houseToOpen(houses, Boolean(failed), remembered)
    if (loc) setParams((p) => withParams(p, { house: loc }), { replace: true })
  }, [wantHouse, wantRef, refHouse, houses, failed, current, remembered, setParams])

  // open the linked shift once its grid arrives, then drop the one-shot parameters so a reload does not reopen it
  useEffect(() => {
    if (!grid || (!wantRef && !wantOpen && !wantDay)) return
    const expected = wantHouse ? (resolveHouse(houses, wantHouse) || wantHouse) : refHouse
    if (!expected || grid.location !== expected) return
    const label = (iso: string) => {
      const c = grid.cols.find((col) => String(col.iso || col.date || '') === iso)
      return c?.short || c?.label || iso
    }
    let next: PanelTarget | null = null
    const byRef = wantRef ? openShiftByRef(grid.computed, wantRef) : undefined
    if (byRef) {
      next = { employee: byRef.open_row, colIso: byRef.col_iso, label: label(byRef.col_iso), ref: byRef.ref }
    } else if (wantOpen) {
      const [who, colIso] = wantOpen.split('|')
      const row = who ? rowNamed(grid.rows, who) : undefined
      if (row && colIso) next = { employee: row.employee, colIso, label: label(colIso) }
    }
    if (next) setTarget(next)
    else if (wantRef || wantOpen) {
      toast({ type: 'warning', title: 'That shift is not open on this calendar now',
              body: 'It may have been given to somebody, or it is no longer drawn here. The house is open below.' })
    }
    const day = linkedDay(next?.colIso ?? '', wantDay, grid.cols.map((c) => String(c.iso || c.date || '')))
    if (day) {
      // the whole tab scrolls to it, and a phone's agenda opens on it
      setAgendaPick(day)
      if (range === 'tab') setFocus({ iso: day, tick: Date.now() })
    }
    setParams((p) => withParams(p, {
      house: grid.location, open: null, ref: null, day: null,
      // the week that holds the linked shift, else the linked day
      ...(day && range === 'week' ? { week: weekKeyOf(day) } : {}),
    }), { replace: true })
  }, [wantOpen, wantRef, wantDay, wantHouse, refHouse, houses, grid, range, setParams])

  // the ring (and a stream reconnect) re-reads the open house
  useEffect(() => {
    if (!current) return
    const ring = () => refresh(current)
    const offRing = onLiveEvent(HOUSECAL_LIVE_EVENT, ring)
    const offOpen = onLiveEvent('open', ring)
    return () => { offRing(); offOpen() }
  }, [current, refresh])
  // a rail that could not be read is read again when the stream comes back
  useEffect(() => {
    if (!failed) return
    return onLiveEvent('open', () => loadHouses(true))
  }, [failed, loadHouses])
  // a co-editor's drafts ring too: a reader who builds re-reads the rail's draft counts, gathered over a few seconds
  const builds = (houses ?? []).some((h) => h.may_edit)
  useEffect(() => {
    if (!builds) return
    let t = 0
    const off = onLiveEvent(HOUSECAL_LIVE_EVENT, () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => loadHouses(true), 3000)
    })
    return () => { off(); window.clearTimeout(t) }
  }, [builds, loadHouses])
  /** "live" is said only while the stream is heard */
  const [heard, setHeard] = useState(() => liveConnected())
  useEffect(() => {
    const offOpen = onLiveEvent('open', () => setHeard(true))
    const offClose = onLiveEvent('close', () => setHeard(false))
    return () => { offOpen(); offClose() }
  }, [])

  const computed = grid?.computed ?? null
  const openCells = useMemo(() => openByCell(computed), [computed])

  /** a door's whole-house answer, painted only for the house on screen */
  const absorb = useCallback((res: { computed?: Computed | null; grid?: Grid | null } | null | undefined) => {
    const whole = res?.grid
    if (whole) {
      if (whole.location !== asked.current) return
      setGrid(whole)
      setReadAt(new Date().toISOString())
      setStaleWhy('')
      return
    }
    const next = res?.computed
    if (next) setGrid((g) => (g ? { ...g, computed: next } : g))
  }, [])

  useEffect(() => {
    if (saving || !current || !quiet.current.again) return
    quiet.current.again = false
    refresh(current)
  }, [saving, current, refresh])

  // re-read when a window closes, so Apply never outlives it
  useEffect(() => {
    if (!current || !computed) return
    const wait = nextWindowClose(computed, Date.now())
    if (wait === null) return
    const t = window.setTimeout(() => refresh(current), Math.min(wait + 1500, 2 ** 31 - 1))
    return () => window.clearTimeout(t)
  }, [current, computed, refresh])

  // the band's countdowns tick in the band alone, so the grid is never redrawn by the clock
  const ticking = (computed?.open_shifts ?? []).some((s) => !s.claimed_by && s.pool_state === 'open'
    && Boolean(s.window?.closes_at))

  // the days drawn, kept the same object while nothing about them changes, so the grid's memo holds
  const win = computed?.window
  const weeks = useMemo(() => tabWeeks(win), [win])
  const nowWeek = thisWeek(win)
  const week = clampWeek(params.get('week') ?? '', weeks, nowWeek)
  const days = useMemo(() => drawnDays(range, week, win), [range, week, win])

  const textAt = useCallback((employee: string, colIso: string): string => {
    const rowIdx = grid?.rows.findIndex((r) => r.employee === employee) ?? -1
    const colIdx = grid?.cols.findIndex((c) => String(c.iso || c.date || '') === colIso) ?? -1
    if (rowIdx < 0 || colIdx < 0) return ''
    return grid?.rows[rowIdx]?.cells[colIdx]?.text ?? ''
  }, [grid])

  const labelOf = useCallback((colIso: string): string => {
    const c = grid?.cols.find((col) => String(col.iso || col.date || '') === colIso)
    return c?.short || c?.label || colIso
  }, [grid])

  /** the house manager's decision, posted by handle; answered with the whole house */
  const claimShift = useCallback(async (shift: OpenShift, forWhom?: string) => {
    if (!grid || saving) return
    setSaving(true)
    try {
      const res = await lane<{ computed?: Computed; grid?: Grid; claimed_by: string; decided?: boolean; how?: string; row_kept?: string
        trainer?: { name?: string } | null; training?: Training | null
        published?: { test_mode?: boolean } }>('/hub-lanes/housecal/claim', {
        method: 'POST',
        body: JSON.stringify({
          ...shiftHandle({ ref: shift.ref, location: grid.location, open_row: shift.open_row, col_iso: shift.col_iso }),
          ...(forWhom ? { claimed_by: forWhom } : {}),
        }),
      })
      absorb(res)
      setTarget(null)
      const trains = res.trainer?.name || res.training?.trains || ''
      // say what the decision did, and that a filled cell of theirs was not overwritten
      toast({ type: 'success', title: res.decided ? 'Shift given' : 'Shift taken',
              body: `${res.claimed_by} is on ${shift.code}${res.how === 'approved' ? ' — their application was approved' : ''}.${res.decided
                ? ' Applications are closed; anybody else who applied is marked not chosen on Requests.' : ''}${res.row_kept
                ? ` Their own cell that day already says ${res.row_kept}, so it was left as it is — change it in Calendar Builder.` : ''}${trains
                ? ` It is their first shift here, so it is a training: ${trains} trains.` : ''}${res.published?.test_mode
                ? ` Test mode is on: the cell is recorded on the platform, ${TEST_MODE_CELL} — it waits in Calendar Builder to be published or discarded.` : ''}` })
    } catch (err) {
      // "somebody took it first" is an answer, not a failure
      const why = err instanceof Error ? err.message : 'Try again.'
      const known = err instanceof LaneError && err.status === 409
      toast({ type: known ? 'warning' : 'danger',
              title: known ? 'Not given' : 'Not taken', body: why })
      refresh(grid.location)
    } finally {
      setSaving(false)
    }
  }, [grid, saving, absorb, refresh])

  /** a member of staff applies by handle; the door checks everything, the roster does not move */
  const applyFor = useCallback(async (shift: OpenShift) => {
    if (!grid || saving) return
    if (!shift.ref) {
      toast({ type: 'warning', title: 'Not open for applications yet',
              body: 'This shift opens for applications within the minute — the calendar shows it when it does.' })
      return
    }
    setSaving(true)
    try {
      const res = await lane<{ applied?: boolean; needs_training_approval?: boolean; training?: Training }>('/hub-lanes/shift-requests/apply', {
        method: 'POST', body: JSON.stringify({ ref: shift.ref }),
      })
      if (res.applied === false) {
        toast({ type: 'info', title: 'Already applied', body: 'Your name was already down for this shift.' })
      } else if (res.needs_training_approval) {
        const who = trainingLine(res.training)
        toast({ type: 'success', title: 'Applied — a training approval first',
                body: `No IST for this house is on record, so the house manager approves the training before your application counts. Your place in line is kept.${who ? ` ${who}` : ''}` })
      } else {
        toast({ type: 'success', title: 'Applied',
                body: 'Your name is down. The shift is not yours yet — the house manager decides when applications close.' })
      }
    } catch (err) {
      toast({ type: 'warning', title: 'Not applied', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setSaving(false)
      refresh(grid.location)
    }
  }, [grid, saving, refresh])

  /** …and takes the application back. The row stays on Requests as history. */
  const withdraw = useCallback(async (requestId: string) => {
    if (!grid || saving || !requestId) return
    setSaving(true)
    try {
      await lane('/hub-lanes/shift-requests/withdraw', {
        method: 'POST', body: JSON.stringify({ request_id: requestId }),
      })
      toast({ type: 'success', title: 'Application withdrawn', body: 'It stays on Requests as history.' })
    } catch (err) {
      toast({ type: 'warning', title: 'Not withdrawn', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setSaving(false)
      refresh(grid.location)
    }
  }, [grid, saving, refresh])

  /** a transfer was offered: say who must agree, and re-read */
  const transferred = useCallback((offer: HandoffView) => {
    toast({ type: 'success', title: 'Transfer offered',
            body: `${offer.to_staff} has to accept, and ${offer.approval?.why || 'the house manager approves'}. Nothing has changed on the calendar yet.` })
    setHandoffTick((n) => n + 1)
    if (grid) refresh(grid.location)
  }, [grid, refresh])

  /** answer or withdraw a transfer; the relay works out the side */
  const handoffAct = useCallback(async (h: HandoffView, act: 'yes' | 'no' | 'withdraw') => {
    if (saving) return
    setSaving(true)
    try {
      await actOnHandoff(h, act)
      setHandoffTick((n) => n + 1)
    } catch (err) {
      toast({ type: 'warning', title: act === 'withdraw' ? 'Not withdrawn' : 'Not answered',
              body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setSaving(false)
      if (grid) refresh(grid.location)
    }
  }, [grid, saving, refresh])

  /** Mark call-off: a live act through the Builder's own door, confirmed first in the panel */
  const markCallOff = useCallback(async (at: PanelTarget, note: string) => {
    if (!grid || saving) return
    const location = grid.location
    setSaving(true)
    setCallOffSaid(null)
    try {
      const r = await houseLane.callOff(location, at.employee, at.colIso, note)
      // its answer carries the Builder's draft picture, which Live never draws: Live re-reads its own door
      setTarget(null)
      toast({ type: 'success', title: 'Called off — the shift is open',
              body: callOffReach(ohioTime(r.window.closes_at), r.road) })
    } catch (err) {
      const code = err instanceof LaneError ? err.reason : ''
      const why = err instanceof Error ? err.message : 'Try again.'
      setCallOffSaid({ key: cellKey(at.employee, at.colIso), code, why })
      toast({ type: err instanceof LaneError && err.status === 409 ? 'warning' : 'danger', title: 'Not called off',
              body: code === 'draft_pending' ? 'This cell has a draft in the Builder: publish or discard it first.' : why })
    } finally {
      setSaving(false)
      refresh(location)
    }
  }, [grid, saving, refresh])

  if (refused) {
    return (
      <Card className="p-6 text-center text-[13px] leading-6 text-text-3">
        {refused}
        <button onClick={() => navigate('/app/calendarbuilder/cards')}
          className="mx-auto mt-2 block font-semibold text-primary hover:underline">
          Open Shift Cards
        </button>
      </Card>
    )
  }

  const panelTarget = followTarget(target, computed)
  const panelText = panelTarget ? textAt(panelTarget.employee, panelTarget.colIso) : ''
  const panelFact = panelTarget && computed ? computed.cells[cellKey(panelTarget.employee, panelTarget.colIso)] : undefined
  const panelRow = panelTarget ? grid?.rows.find((r) => r.employee === panelTarget.employee) : undefined
  const panelCell = panelTarget && panelRow
    ? panelRow.cells[grid?.cols.findIndex((c) => String(c.iso || c.date || '') === panelTarget.colIso) ?? -1]
    : undefined
  const hm = grid?.house_manager
  const me = grid?.access?.me ?? listInfo.me ?? ''
  const today = computed?.window.today || ohioToday()
  const held = testModeHolds(grid)
  const here = (houses ?? []).find((h) => h.location === current)
  const railDown = houses === null && Boolean(failed)
  const sw = builderSwitch({ builderOpen, houses, current, draftsReadable: listInfo.drafts_readable })
  const across = acrossHouses(estateOpen, houses)
  const tilesAt = (nowMs: number) => (mayEdit
    ? liveEditorTiles({ computed, nowMs, transfers, across, dayLabel: (iso) => dayLabel(iso, today) })
    : liveStaffTiles({ computed, me, transfers, dayLabel: (iso) => dayLabel(iso, today) }))
  const shifts = shiftsDrawn(computed, days)
  /** a phone's day agenda: the week in view, and the day picked in it (else today, else its first) */
  const agendaWeek = weekDays(week)
  const agendaDay = agendaDayOf(agendaWeek, agendaPick, today)
  const dayView = phone && phoneView === 'day'
  const pickPhoneView = (v: PhoneView) => { setPhoneView(v); writePhoneView(v) }
  const said = callOffSaid && panelTarget && callOffSaid.key === cellKey(panelTarget.employee, panelTarget.colIso)
    ? callOffSaid : null

  /** open one cell in the panel, bringing its week into view */
  const openCell = (employee: string, colIso: string, ref?: string) => {
    setTarget({ employee, colIso, label: labelOf(colIso), ...(ref ? { ref } : {}) })
    if (range === 'week' && days && (colIso < days.from || colIso > days.to)) {
      setParams((p) => withParams(p, { week: weekKeyOf(colIso) }), { replace: true })
    }
    if (range === 'tab') setFocus({ iso: colIso, tick: Date.now() })
  }
  const openShiftCell = (s: OpenShift | undefined) => { if (s) openCell(s.open_row, s.col_iso, s.ref) }
  /** every tile acts */
  const onTile = (id: string) => {
    const list = computed?.open_shifts
    if (id === 'open') openShiftCell(openNow(list)[0])
    else if (id === 'decisions') openShiftCell(decisionsWaiting(list)[0])
    else if (id === 'calloffs') openShiftCell(callOffsWaiting(list)[0])
    else if (id === 'mine-open') openShiftCell(openNow(list).find((s) => s.mine?.may && s.mine.code !== 'applied'))
    else if (id === 'mine-applied') openShiftCell((list ?? []).find((s) => s.mine?.code === 'applied'))
    else if (id === 'onshift') {
      const f = computed?.running?.map((k) => computed.cells[k]).find(Boolean)
      if (f) openCell(f.employee, f.col_iso)
    } else if (id === 'mine-hours') {
      const f = Object.values(computed?.cells ?? {}).filter((x) => sameName(x.employee, me) && x.state !== 'past'
        && x.hours > 0).sort((a, b) => a.col_iso.localeCompare(b.col_iso))[0]
      if (f) openCell(f.employee, f.col_iso)
    } else if (id === 'transfers') {
      document.getElementById('transfers-waiting')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else if (id === 'look') {
      // every conflict, a week over the line included (it opens that person's first shift of the week)
      const looks = computed?.conflicts ?? []
      if (!looks.length) return
      const at = conflictCell(looks[lookAt % looks.length], computed)
      setLookAt((n) => n + 1)
      openCell(at.employee, at.colIso)
    }
  }
  /** a row of the across-your-houses list: that house and that cell */
  const onAcross = (s: OpenShift) => {
    if (s.location === current) { openShiftCell(s); return }
    setParams((p) => withParams(p, {
      house: s.location, ref: s.ref || null, open: s.ref ? null : `${s.open_row}|${s.col_iso}`,
    }), { replace: true })
  }
  // the view switch, and every "Change in Builder": this house, and the open cell when there is one.
  const toBuilder = (cell?: CarriedCell | null) => onView('build', {
    house: current, range: isRange(rangeParam) ? rangeParam : undefined, week: params.get('week') || undefined,
    cell: cell ?? (panelTarget ? { employee: panelTarget.employee, colIso: panelTarget.colIso } : null),
  })
  /** open this house and day in the Builder */
  const editInBuilder = (at: { day?: string; employee?: string } = {}) => {
    if (!grid) return
    toBuilder(at.employee ? { employee: at.employee, colIso: at.day || today } : { employee: '', colIso: at.day || today })
  }
  /** open the panel on the red cell a handle names */
  const showRef = (ref: string) => {
    const s = openShiftByRef(computed, ref)
    if (s) setTarget({ employee: s.open_row, colIso: s.col_iso, label: labelOf(s.col_iso), ref: s.ref })
  }
  const pickHouse = (location: string) => {
    setParams((p) => withParams(p, { house: location, open: null, ref: null }), { replace: true })
  }
  const setRange = (r: CalendarRange) => {
    setCalendarRange('live', r)
    setParams((p) => withParams(p, { range: r }), { replace: true })
  }
  const setWeek = (w: string, r?: CalendarRange) => {
    if (r) setCalendarRange('live', r)
    setParams((p) => withParams(p, { week: w, ...(r ? { range: r } : {}) }), { replace: true })
  }

  return (
    <div className="w-full">
      <CalendarHero
        view="live"
        house={current}
        managerText={grid ? (managerLine(hm) || 'None named') : ''}
        managerWhy={hm?.why}
        access={grid?.access ? { edit: grid.access.edit, why: grid.access.why } : null}
        switcher={sw}
        onView={(v) => { if (v === 'build') toBuilder() }}
        tiles={tilesAt}
        ticking={ticking}
        onTile={onTile}
        across={across ? { open: across.open, decisions: across.decisions, calloffs: across.calloffs } : undefined}
        onAcross={onAcross}
        today={today}
        strip={{ heard, readAt, testMode: held,
                 draftsHere: mayEdit ? (listInfo.drafts_readable === false ? 'unread' : here?.drafts ?? null) : null }}
      />

      <HandoffWaiting key={handoffTick} onChanged={() => { if (current) refresh(current) }} onCount={setTransfers} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <HouseRail
          sections={railSections(houses, houseFilter)}
          current={current}
          onPick={pickHouse}
          filter={houseFilter}
          onFilter={setHouseFilter}
          loading={houses === null && !failed}
          failed={failed}
          openBy={estateOpen ? openCountByHouse(estateOpen) : null}
          draftsUnread={listInfo.drafts_readable === false}
          note={houses !== null && listInfo.managers_readable === false ? (
            <>Who manages each house could not be read{listInfo.managers_why ? ` (${listInfo.managers_why})` : ''} —
              until it can, only {ABOVE_ALL} edit.</>
          ) : undefined}
        />

        {/* the grid */}
        <Card padded={false} className="min-w-0 flex-1 overflow-hidden">
          {!current && railDown ? (
            // the rail is down too, and no house was opened here before: the slices' own houses
            <LastRosterWeek location="" why={failed} onPick={pickHouse} />
          ) : !current ? (
            <p className="p-8 text-center text-[13px] text-text-3">
              {houses === null && !failed ? 'Opening the houses…' : 'Pick a house to open its grid.'}
            </p>
          ) : gridLoading ? (
            <p className="flex items-center justify-center gap-2 p-8 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Opening {houseShort(current)}…
            </p>
          ) : gridFailed?.outage ? (
            <LastRosterWeek location={current} why={gridFailed.why} seesCallers={Boolean(here?.may_edit)}
              onPick={railDown ? pickHouse : undefined} />
          ) : !grid ? (
            <p className="p-8 text-center text-[13px] text-text-3">
              The grid could not be read{gridFailed ? `: ${gridFailed.why}` : '.'}
            </p>
          ) : (
            <>
              <RangeBar days={days} weeks={weeks} week={week} range={range} thisWeek={nowWeek}
                onWeek={setWeek} onRange={setRange} onToday={() => setFocus({ iso: today, tick: Date.now() })}
                time={<ClockTimesToggle className="h-8 text-[12.5px]" />}
                present={statesPresent(grid, 'live', timeOff, mayEdit)} />
              {/* a phone: the day agenda or the grid, this device's own choice */}
              {phone && (
                <div role="group" aria-label="Phone view" className="mx-3 mt-2 inline-flex overflow-hidden rounded-md border border-border">
                  {(['day', 'grid'] as const).map((v) => (
                    <button key={v} type="button" aria-pressed={phoneView === v} onClick={() => pickPhoneView(v)}
                      className={cn('h-8 px-3 text-[12.5px]',
                        phoneView === v ? 'bg-surface-3 font-semibold text-text-1' : 'bg-surface text-text-2')}>
                      {v === 'day' ? 'Day' : 'Grid'}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <p className="min-w-0 text-[12.5px] text-text-2">
                  Click a cell to open it. Shifts are changed in the Builder.
                </p>
                {mayEdit && builderOpen && (
                  <button onClick={() => editInBuilder()}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                    <Pencil size={13} /> Change in Builder
                  </button>
                )}
                {mayEdit && !builderOpen && (
                  <span className="max-w-[360px] text-[11.5px] leading-4 text-text-2">
                    {builderClosedLine()}
                  </span>
                )}
              </div>
              {/* a tab that is not a roster says so, never reads as a quiet week */}
              {computed && !computed.window.covers_today && computed.window.first && (
                <div className={cn('mx-3 mb-2 flex items-start gap-2 rounded-md px-3 py-2', DANGER_NOTE)}>
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
                  <p className="text-[12px] leading-5 text-danger">
                    This tab does not cover today — it draws {computed.window.days}{' '}
                    {computed.window.days === 1 ? 'day' : 'days'}, {computed.window.first}
                    {computed.window.last !== computed.window.first && ` to ${computed.window.last}`}.
                    The source sheet is what is short; nothing here is hiding it.
                  </p>
                </div>
              )}
              {/* an unread pool is not a covered house */}
              {grid.pool && !grid.pool.readable && (
                <div className={cn('mx-3 mb-2 flex items-start gap-2 rounded-md px-3 py-2', DANGER_NOTE)}>
                  <PhoneOff size={14} className="mt-0.5 shrink-0 text-danger" />
                  <p className="text-[12px] leading-5 text-danger">{grid.pool.why}</p>
                </div>
              )}
              {/* test mode holds a Give and a finished transfer too, said before anything is pressed */}
              {held && (
                <div className={cn('mx-3 mb-2 flex items-start gap-2 rounded-md px-3 py-2', AMBER_NOTE)}>
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                  <p className="text-[12px] leading-5 text-text-1">
                    {held === 'on' ? 'Test mode is on' : 'Test mode could not be read, so it holds'}: a Give or a
                    finished transfer is recorded on the platform, not in the workbook.
                  </p>
                </div>
              )}
              {staleWhy && (
                <p className={cn('mx-3 mb-2 rounded-md px-3 py-2 text-[12px] leading-5 text-danger', DANGER_NOTE)}>
                  The last re-read did not land ({staleWhy}) — this is the grid as read at {ohioTime(readAt)}.
                </p>
              )}
              {dayView ? (
                <DayAgenda grid={grid} week={agendaWeek} day={agendaDay} onDay={setAgendaPick} mayEdit={mayEdit}
                  timeOff={timeOff} saving={saving} onOpen={setTarget}
                  onApply={(shift) => void applyFor(shift)} />
              ) : (
                <div className="overflow-x-auto px-1.5 pb-1.5">
                  <HouseGrid grid={grid} clock={clock} mode="operations" editor={mayEdit}
                    onOpen={setTarget} days={days} me={me} selected={panelTarget} timeOff={timeOff} focus={focus} />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-text-3">
                <span>{saving ? 'Working…' : `Source updated ${grid.updated_at ? grid.updated_at.slice(0, 16).replace('T', ' ') : '—'}`}</span>
                {readAt && (
                  <span>
                    Read {ohioTime(readAt)}
                    {heard ? ' · following changes live' : ' · not hearing live changes right now — Refresh reads again'}
                  </span>
                )}
                {grid.handoffs_why && (
                  <span className="text-danger">{grid.handoffs_why} — this is not saying none are waiting.</span>
                )}
                {timeOffUnreadLine(grid) && <span className="text-danger">{timeOffUnreadLine(grid)}</span>}
                {clock && <span>Times spelled out — the cells still hold their codes</span>}
                {computed && computed.totals.open > 0 && (
                  <span className="flex items-center gap-1 font-semibold text-danger">
                    {computed.totals.open} open {computed.totals.open === 1 ? 'shift' : 'shifts'}
                  </span>
                )}
                {computed && computed.conflicts.length > 0 && (
                  <span className="flex items-center gap-1 text-danger">
                    <AlertTriangle size={11} />
                    {computed.conflicts.length} to look at
                  </span>
                )}
                {shifts !== null && (
                  <span>{shifts} {shifts === 1 ? 'shift' : 'shifts'} {range === 'week' ? 'this week' : 'on this tab'}</span>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <ShiftCellPanel
        target={panelTarget}
        house={grid?.location ?? current}
        text={panelText}
        fact={panelFact}
        computed={computed}
        saving={saving}
        openShift={panelTarget && panelText ? openCells.get(cellKey(panelTarget.employee, panelTarget.colIso)) : undefined}
        staff={grid?.rows.filter((r) => !r.open_row).map((r) => r.employee) ?? []}
        mayEdit={mayEdit}
        openRow={Boolean(panelRow?.open_row)}
        me={me}
        calledOff={panelCell?.called_off}
        callOffLine={Boolean(panelRow?.call_off_row)}
        timeOff={panelCell?.time_off}
        onOpenTimeOff={(ref) => navigate(`/app/timeoff/requests?ref=${encodeURIComponent(ref)}`)}
        onClaim={(shift, forWhom) => void claimShift(shift, forWhom)}
        handoffs={grid?.handoffs}
        onTransferred={transferred}
        onHandoffAct={(h, act) => void handoffAct(h, act)}
        onApplyFor={(shift) => void applyFor(shift)}
        onWithdraw={(requestId) => void withdraw(requestId)}
        onShowRef={showRef}
        onOpenRequests={() => navigate(REQUESTS_PATH)}
        onEditInBuilder={builderOpen
          ? () => { if (panelTarget) editInBuilder({ day: panelTarget.colIso, employee: panelTarget.employee }) }
          : undefined}
        published={panelCell?.published}
        publishedWhy={grid?.published_why}
        onCallOff={mayEdit ? (note) => { if (panelTarget) void markCallOff(panelTarget, note) } : undefined}
        callOffSaid={said}
        testMode={held}
        onClose={() => setTarget(null)}
      />
    </div>
  )
}
