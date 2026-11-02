// SCHEDULING — every house's shifts on one screen, edited in place: no drafts, no publish.
// The house is picked at the top left; editors add people and shifts at the right; staff open their own shift for…
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AlertTriangle, ArrowLeftRight, CalendarPlus, CalendarX2, ChevronDown, RefreshCw, Settings2, UserPlus, X } from 'lucide-react'
import { useMediaQuery } from '@/hooks/use-mobile'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import ClockTimesToggle from '@/pages/features/shifts/ClockTimesToggle'
import { useClockTimes } from '@/pages/features/shifts/clockPref'
import { DANGER_NOTE } from '@/pages/features/shifts/shiftUi'
import { withParams } from '@/pages/features/calendarbuilder/calendarScreen'
import { weekKeyOf } from '@/pages/features/shifts/houseCalTypes'
import TimeReconPage from '@/pages/features/time-recon/TimeReconPage'
import {
  TEST_MODE_UNREAD_WORDS, TEST_MODE_WORDS, boardNowMs, dragKeys, drawnDays, dropPlan, editsHouse, editsSettings,
  hoursHiddenLine, hoursShown, marksPresent, movesHouse, openCount, otherPeriodOf, periodWeeks, phonesOf, pickKey, pickMarks,
  shiftAt, testModeBanner, thisWeekOf, writeToast,
  type Board, type BoardHouse, type SchedRange, type ShiftRef, type WriteAnswer,
} from './schedulingModel'
import { saidOf, timeOff, useSchedulingBoard, type BoardState, type MoveAt, type StaffShift } from './schedulingLane'
import DragMovePanel from './DragMovePanel'
import ScreenSwitch, { screenOf, useScreens } from './ScreenSwitch'
import StaffCalendars, { OPEN_WHO, shiftKey } from './StaffCalendars'
import TimeOffRequests from './TimeOffRequests'
import OvertimeScreen from './OvertimeScreen'
import { psiAnchorDay, screenParams } from './overtimeModel'
import Builder from './Builder'
import HouseDropdown from './HouseDropdown'
import RangeBar from './RangeBar'
import Legend from './Legend'
import SheetReloadButton from './SheetReload'
import SchedulingGrid, { type CellTarget } from './SchedulingGrid'
import ShiftPanel from './ShiftPanel'
import { useTestWarningsHidden } from '@/lib/myWorkHides'
import AddShiftPanel from './AddShiftPanel'
import AddSomebody from './AddSomebody'
import TimeOffPanel from './TimeOffPanel'
import SwapShiftsPanel, { type SwapPreset } from './SwapShiftsPanel'
import SetupPanel from './SetupPanel'
import { FlowPanel, ItemPanel, MineCard, WaitingCard, useItemAnswers } from './FlowCards'
import { BAR_BTN, OUTLINE_BTN } from './SchedulingParts'

type Panel =
  /** `house`: a shift opened from Staff Calendars, at any house */
  | { kind: 'cell'; target: CellTarget; house?: string; assign?: string }
  | { kind: 'swap'; take: ShiftRef | null; away: boolean; to?: string }
  | { kind: 'add' }
  | { kind: 'timeoff'; from: string }
  | { kind: 'setup' }
  | { kind: 'item'; id: string }
  | { kind: 'flow'; id: string }
  /** a shift dropped where the viewer moves shifts at once (movesHouse): what it does, then Confirm */
  | { kind: 'move'; at: MoveAt }
  | null

// Who sees Swap shifts: the master, and every account with a row on some house — whatever its badges (a house…
export function swapsShifts(board: Board | null): boolean {
  if (!board) return false
  if (board.viewer.is_master || board.viewer.is_director) return true
  return Boolean(board.viewer.key) && Object.values(board.grids).some((g) => g.rows.some((r) => r.kind === 'person' && r.me))
}

/** Swap shifts picking on the grid: the shift given (null until the first pick), the period it was picked in, a notice. */
export type Pick = { give: ShiftRef | null; period: string; notice: string }

export const PICK_PERIOD_NOTICE =
  'The period changed, so the first pick was cancelled — both shifts must be in the period on screen.'

/** The bar pick mode shows under the top bar (a bottom sheet on a phone): what to pick now, and the ways out. */
export function PickBar({ pick, board, phone, onCancel, onChange, onGiveAway }: {
  pick: Pick
  board: Board
  phone: boolean
  onCancel: () => void
  onChange: () => void
  onGiveAway: () => void
}) {
  const give = pick.give
  const who = give && give.key !== board.viewer.key ? `${give.name} gives` : 'You give'
  return (
    <div role="status" data-pick-bar={give ? 'take' : 'give'}
      className={cn('flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-text-1',
        phone ? 'fixed inset-x-0 bottom-0 z-30 rounded-t-[16px] border-t border-border bg-surface px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-3'
          : 'rounded-[12px] border border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-tint-primary px-3 py-2')}>
      <ArrowLeftRight size={15} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        {give ? (
          <><span className="font-semibold">{who}:</span> {give.short} {give.day} {give.text} — now pick their shift (any house)</>
        ) : (
          <span className="font-semibold">{board.viewer.is_master || board.viewer.is_director ? 'Swap — pick the first shift (anybody’s)' : 'Swap — pick your shift'}</span>
        )}
        {pick.notice && <span className="block text-[12px] text-warning" data-pick-notice="">{pick.notice}</span>}
      </span>
      {give && (
        <button type="button" onClick={onChange} className="text-[12px] font-semibold text-primary hover:underline" data-act="pick-change">
          Change
        </button>
      )}
      {give && (
        <button type="button" onClick={onGiveAway} className="text-[12px] font-semibold text-text-2 hover:underline" data-act="pick-give-away">
          Give it away instead
        </button>
      )}
      <button type="button" onClick={onCancel} className={OUTLINE_BTN} data-act="pick-cancel">
        <X size={13} /> Cancel
      </button>
    </div>
  )
}

/** The house first drawn: the one asked for, else one the viewer edits, else one they work at, else the first. */
export function defaultHouse(board: Board | null, want: string): BoardHouse | null {
  if (!board?.houses.length) return null
  const by = (code: string) => board.houses.find((h) => h.code === code) ?? null
  return by(want)
    ?? board.houses.find((h) => board.viewer.editor_of.includes(h.code))
    ?? board.houses.find((h) => board.grids[h.code]?.rows.some((r) => r.me))
    ?? board.houses[0]
}

export default function SchedulingPage() {
  const sessionMaster = useEffectiveIsMaster()
  const [params] = useSearchParams()
  const read = useSchedulingBoard(params.get('period') ?? '')
  return <SchedulingView state={read} sessionMaster={sessionMaster} onReload={read.reload} onAbsorb={read.absorb} />
}

export function SchedulingView({ state, sessionMaster, onReload, onAbsorb, initialPick = null, houseOnly = '' }: {
  state: BoardState
  sessionMaster: boolean
  onReload: () => void
  onAbsorb: (answer: WriteAnswer) => void
  /** a screen drawn already picking (the tests draw pick mode with it) */
  initialPick?: Pick | null
  /** one house's calendar alone (Locations › House Calendar): its grid, its panels and its tools, no other house or
   * screen and none of the viewer's own cards */
  houseOnly?: string
}) {
  const [params, setParams] = useSearchParams()
  const phone = useMediaQuery('(max-width: 639px)')
  const clock = useClockTimes()
  const [panel, setPanel] = useState<Panel>(null)
  const [pick, setPick] = useState<Pick | null>(initialPick)
  const [adding, setAdding] = useState(false)
  const [menu, setMenu] = useState(false)
  const [toBusy, setToBusy] = useState(false)
  const [toRefusal, setToRefusal] = useState('')
  const [viewTick, setViewTick] = useState(0)
  const menuBox = useRef<HTMLDivElement | null>(null)
  const screens = useScreens()
  const screen = houseOnly ? 'house' : screenOf(params.get('view'), screens)

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => { if (menuBox.current && !menuBox.current.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const board = state.board
  const current = houseOnly ? board?.houses.find((h) => h.code === houseOnly) ?? null
    : defaultHouse(board, params.get('house') ?? '')
  const code = current?.code ?? ''
  const grid = board && code ? board.grids[code] ?? null : null
  const master = sessionMaster && Boolean(board?.viewer.is_master)
  // the settings edition opens the waits and the cycle; the rest of the setup stays the master's
  const settingsEditor = editsSettings(board, sessionMaster)
  const editor = editsHouse(board, code)
  const hours = hoursShown(board, sessionMaster)
  const hiddenLine = hoursHiddenLine(board, sessionMaster)
  // Settings › My Work hides every test mode warning from anyone but the master
  const noTest = useTestWarningsHidden()
  const testBanner = testModeBanner(board, state.status === 'failed')
  const banner = noTest ? { ...testBanner, show: false } : testBanner

  const period = board?.period ?? { id: '', first: '', last: '', state: '' }
  const weeks = periodWeeks(period)
  // the periods either side of this one, for the range bar's arrows
  const periods = [...(board?.periods ?? [])].sort((a, b) => a.first.localeCompare(b.first))
  const periodAt = periods.findIndex((p) => p.id === period.id)
  const periodBefore = periodAt > 0 ? periods[periodAt - 1] : null
  const periodAfter = periodAt >= 0 && periodAt < periods.length - 1 ? periods[periodAt + 1] : null
  const thisWeek = board ? thisWeekOf(board.today, period) : null
  const asked = params.get('week') ?? ''
  const day = params.get('day') ?? ''
  const week = weeks.includes(asked) ? asked
    : day && weeks.includes(weekKeyOf(day)) ? weekKeyOf(day)
    : thisWeek ?? weeks[0] ?? ''
  const range: SchedRange = phone ? 'week' : params.get('range') === 'period' ? 'period' : 'week'
  const drawn = drawnDays(range, week, period)
  // the day the calendars stand on, for the screens counted in PsiAnywhere's pay periods (Time Reconciliation,
  // Overtime): each opens on the pay period holding it, never on Scheduling's own Saturday weeks
  const anchor = board ? psiAnchorDay(drawn, board.today, day) : ''
  const set = (s: Record<string, string | null>) => setParams(withParams(params, s), { replace: true })
  // the dropdown's "N open" counted from the grids as they stand, so a write's answer moves it at once
  const houses = (board?.houses ?? []).map((h) => (board?.grids[h.code] ? { ...h, open: openCount(board.grids[h.code], board.today) } : h))
  const shownHouse = current ? houses.find((h) => h.code === current.code) ?? current : null

  // a link to a day of another period (My Work, My Inbox) opens that period
  const linkedPeriod = params.get('period') ? '' : otherPeriodOf(board, day)
  useEffect(() => {
    if (linkedPeriod) setParams(withParams(params, { period: linkedPeriod }), { replace: true })
  }, [linkedPeriod]) // eslint-disable-line react-hooks/exhaustive-deps

  const onWrite = (answer: WriteAnswer, close: boolean) => {
    onAbsorb(answer)
    toast(writeToast(answer))
    if (close) setPanel(null)
    setAdding(false)
    setViewTick((t) => t + 1)
  }

  // ---- the other screens: a shift of Staff Calendars opens the grid's own panel, in its period ----
  // leaving Overtime drops its dates, so it opens on the pay period of the calendars' day when it is opened again
  const toScreen = (s: string) => {
    set(screenParams(s))
    setPanel(null)
    setAdding(false)
    setPick(null)
  }
  const openStaffShift = (s: StaffShift) => {
    if (board && s.period_id && s.period_id !== board.period.id) set({ period: s.period_id, week: null })
    setPanel({ kind: 'cell', target: { rowId: s.row_id, iso: s.date }, house: s.house_code })
  }
  const staffOpenKey = panel?.kind === 'cell' && panel.house
    ? shiftKey({ house_code: panel.house, row_id: panel.target.rowId, date: panel.target.iso }) : ''

  // ---- Swap shifts: picked on the grid ----
  const periodId = board?.period.id ?? ''
  const startPick = (give: ShiftRef | null) => {
    setPick({ give, period: periodId, notice: '' })
    setPanel(null)
    setAdding(false)
  }
  const fromPreset = (p: SwapPreset) => (board ? shiftAt(board, p.house, p.rowId, p.iso, boardNowMs(board)) : null)
  // both shifts are in the period on screen: another period drops the first pick and says why
  useEffect(() => {
    if (!pick || !periodId || pick.period === periodId) return
    setPick({ give: null, period: periodId, notice: pick.give ? PICK_PERIOD_NOTICE : '' })
    setPanel((p) => (p?.kind === 'swap' ? null : p))
  }, [periodId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Escape leaves pick mode; with the ask panel open, Escape closes the panel first
  useEffect(() => {
    if (!pick || panel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPick(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pick, panel])
  const marks = useMemo(() => (pick && board && code ? pickMarks(board, code, pick.give, boardNowMs(board)) : null),
    [pick, board, code])
  const phones = useMemo(() => phonesOf(board?.people ?? []), [board?.people])
  const onPick = (target: CellTarget) => {
    if (!board || !pick || !marks) return
    const mark = marks[pickKey(target.rowId, target.iso)]
    const shift = shiftAt(board, code, target.rowId, target.iso, boardNowMs(board))
    if (!mark || !shift) return
    if (mark.state === 'pick') setPick({ ...pick, give: shift, notice: '' })
    else if (mark.state === 'valid') setPanel({ kind: 'swap', take: shift, away: false })
  }
  const swapPanel = panel?.kind === 'swap' ? panel : null

  // ---- drag and drop: a shift dropped on another cell opens its workflow with the pair picked; nothing is written ----
  // where the viewer moves shifts (a house manager and up), the drop opens what it does and Confirm writes it at once
  const draggable = useMemo(() => (board && code && !pick ? dragKeys(board, code, boardNowMs(board)) : null), [board, code, pick])
  const onDrop = (from: CellTarget, to: CellTarget) => {
    if (!board || !code) return
    if (movesHouse(board, code)) {
      if (from.rowId === to.rowId && from.iso === to.iso) return
      setAdding(false)
      setPanel({ kind: 'move', at: { house: code, from_row_id: from.rowId, from_date: from.iso, to_row_id: to.rowId, to_date: to.iso } })
      return
    }
    const plan = dropPlan(board, code, from, to, boardNowMs(board))
    if (!plan) return
    setAdding(false)
    if (plan.kind === 'refused') toast({ type: 'warning', title: plan.why })
    else if (plan.kind === 'assign') setPanel({ kind: 'cell', target: plan.open, assign: plan.key })
    else if (plan.kind === 'take') setPanel({ kind: 'cell', target: plan.open })
    else if (plan.kind === 'release') setPanel({ kind: 'cell', target: plan.from })
    else {
      // Swap shifts' own pick mode, the dragged shift as the one given
      setPick({ give: plan.give, period: periodId, notice: '' })
      setPanel(plan.kind === 'exchange' ? { kind: 'swap', take: plan.take, away: false } : { kind: 'swap', take: null, away: true, to: plan.key })
    }
  }

  // an item waiting on the viewer, and one of their own requests, open in the right panel; never answered in the card
  const answers = useItemAnswers(onReload)
  const openItem = panel?.kind === 'item' ? board?.waiting_on_me.find((i) => i.id === panel.id) ?? null : null
  const openFlow = panel?.kind === 'flow' ? board?.mine.find((f) => f.id === panel.id) ?? null : null

  const askTimeOff = async (from: string, to: string, reason: string) => {
    setToBusy(true)
    setToRefusal('')
    try {
      onWrite(await timeOff(from, to, reason), true)
    } catch (err) {
      setToRefusal(saidOf(err))
    } finally {
      setToBusy(false)
    }
  }

  return (
    <div className={cn('sched-strong w-full', phone && pick && 'pb-28')}>
      {!houseOnly && <ScreenSwitch screens={screens} value={screen} onChange={toScreen} />}
      {screen === 'house' && (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4" data-top-bar="">
        {houseOnly ? <span className="text-[14px] font-semibold text-text-1" data-house-only={houseOnly}>House calendar</span> : (
          <HouseDropdown houses={houses} current={shownHouse}
            onPick={(c) => { set({ house: c }); setPanel(null); setAdding(false) }} />
        )}
        {board && (
          <div className="flex flex-wrap items-center gap-2" data-top-actions="">
            {swapsShifts(board) && (
              <button type="button" className={cn(BAR_BTN, pick && 'border-primary bg-tint-primary')} aria-pressed={Boolean(pick)}
                onClick={() => startPick(null)} data-act="swap-shifts">
                <ArrowLeftRight size={15} /> Swap shifts
              </button>
            )}
            {board.viewer.key && (
              <button type="button" className={BAR_BTN} onClick={() => { setToRefusal(''); setPanel({ kind: 'timeoff', from: '' }) }} data-act="time-off">
                <CalendarX2 size={15} /> Time off
              </button>
            )}
            {master && (
              <div ref={menuBox} className="relative">
                <button type="button" className={BAR_BTN} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} data-act="actions">
                  Actions <ChevronDown size={14} className={cn('transition-transform', menu && 'rotate-180')} />
                </button>
                {menu && (
                  <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-[240px] rounded-[14px] border border-border bg-surface p-1.5 shadow-3">
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); setPanel({ kind: 'setup' }) }}
                      className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-text-1 hover:bg-surface-2">
                      <Settings2 size={14} /> Setup, seed and copy forward
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); onReload() }}
                      className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-text-1 hover:bg-surface-2">
                      <RefreshCw size={14} /> Read again
                    </button>
                  </div>
                )}
              </div>
            )}
            {!master && settingsEditor && (
              <button type="button" className={BAR_BTN} onClick={() => setPanel({ kind: 'setup' })} data-act="settings">
                <Settings2 size={15} /> Settings
              </button>
            )}
            {editor && grid && (
              <button type="button" className={BAR_BTN} onClick={() => setAdding(true)} data-act="add-somebody">
                <UserPlus size={15} /> Add Somebody
              </button>
            )}
            {editor && grid && (
              <button type="button" className={BAR_BTN} onClick={() => setPanel({ kind: 'add' })} data-act="add-shift">
                <CalendarPlus size={15} /> Add Shift
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {(banner.show || (pick && board && !phone)) && (
        <div className="sticky top-0 z-20 mb-4 grid gap-2" data-sticky-bars="">
          {banner.show && (
            <div role="status" data-test-mode=""
              className="flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-amber px-3 py-2 text-[12.5px] font-semibold leading-5 text-tint-fg-amber">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                {TEST_MODE_WORDS}
                {banner.unread && (
                  <span className="block font-normal">{TEST_MODE_UNREAD_WORDS}{board?.test_mode.why ? ` (${board.test_mode.why})` : ''}.</span>
                )}
              </span>
            </div>
          )}
          {pick && board && !phone && (
            <PickBar pick={pick} board={board} phone={false} onCancel={() => { setPick(null); setPanel(null) }}
              onChange={() => { setPick({ ...pick, give: null, notice: '' }); setPanel(null) }}
              onGiveAway={() => setPanel({ kind: 'swap', take: null, away: true })} />
          )}
        </div>
      )}
      {pick && board && phone && (
        <PickBar pick={pick} board={board} phone onCancel={() => { setPick(null); setPanel(null) }}
          onChange={() => { setPick({ ...pick, give: null, notice: '' }); setPanel(null) }}
          onGiveAway={() => setPanel({ kind: 'swap', take: null, away: true })} />
      )}

      {screen === 'house' && hiddenLine && <p className="mb-3 text-[12px] text-text-3" data-hours-line="">{hiddenLine}</p>}

      {!board && state.status === 'failed' && (
        <div className={cn('mb-4 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 text-[12.5px] text-danger', DANGER_NOTE)} data-read-failed="">
          <span className="flex-1">The calendar could not be read — {state.error || 'the server did not answer'}.</span>
          <button type="button" className={OUTLINE_BTN} onClick={onReload}><RefreshCw size={13} /> Try again</button>
        </div>
      )}
      {!board && state.status === 'loading' && <p className="text-[13px] text-text-3">Reading the houses…</p>}
      {board && state.error && (
        <p className="mb-3 text-[12px] text-warning">It could not be read again just now — {state.error}. What is drawn is from before.</p>
      )}

      {screen === 'staff' && board && (
        <StaffCalendars board={board} who={params.get('who') ?? OPEN_WHO} onWho={(w) => set({ who: w === OPEN_WHO ? null : w })}
          tick={viewTick} openKey={staffOpenKey} onOpen={openStaffShift} />
      )}
      {screen === 'timeoff' && board && (
        <TimeOffRequests board={board} tick={viewTick} onBoardReload={onReload} onOpenOwn={(id) => setPanel({ kind: 'flow', id })} />
      )}
      {screen === 'builder' && (
        <Builder initialHouse={params.get('house') ?? ''} tick={viewTick}
          onPublished={(answer, house) => {
            onAbsorb(answer)
            setViewTick((t) => t + 1)
            setPanel(null)
            set({ view: null, house, period: answer.period_id || null, week: null, day: null })
          }} />
      )}
      {/* the house the calendars have selected (its code, as the recon lanes filter by) and their day; drawn once the
          board says them, so the recon screen starts from the calendars' own house and period, never from blanks. Both
          read their props once, at mount: a link to a day of another period waits for that period's board (linkedPeriod)
          instead of drawing on this one and drawing again. Neither needs the board itself, so a board that could not be
          read draws them on their own defaults. */}
      {screen === 'recon' && (board || state.status === 'failed') && !linkedPeriod && (
        <TimeReconPage embedded initialHouse={code || undefined} initialDate={anchor || undefined} />
      )}
      {screen === 'overtime' && (board || state.status === 'failed') && !linkedPeriod && (
        <OvertimeScreen anchor={anchor} tick={viewTick} />
      )}

      {screen === 'house' && !houseOnly && board && (board.waiting_on_me.length > 0 || board.mine.length > 0) && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <WaitingCard board={board} gone={answers.gone} openId={panel?.kind === 'item' ? panel.id : ''}
            onOpen={(i) => setPanel({ kind: 'item', id: i.id })} />
          <MineCard board={board} openId={panel?.kind === 'flow' ? panel.id : ''}
            onOpen={(f) => setPanel({ kind: 'flow', id: f.id })} />
        </div>
      )}

      {screen === 'house' && board && adding && editor && code && (
        <AddSomebody board={board} house={code} onWrite={onWrite} onClose={() => setAdding(false)} />
      )}

      {screen === 'house' && board && (
        <div className="overflow-hidden rounded-[16px] border border-border bg-surface shadow-1" data-grid-card="">
          {/* past the period's first or last week the arrows open the period either side */}
          <RangeBar days={drawn} weeks={weeks} week={week} range={range} thisWeek={thisWeek} weekOnly={phone}
            onWeek={(w, r) => set({ week: w, day: null, ...(r ? { range: r } : {}) })}
            onRange={(r) => set({ range: r })} time={<ClockTimesToggle />}
            onPrevPeriod={periodBefore ? () => set({ period: periodBefore.id, week: periodWeeks(periodBefore).at(-1) ?? null, day: null }) : undefined}
            onNextPeriod={periodAfter ? () => set({ period: periodAfter.id, week: null, day: null }) : undefined}
            // the master's reload: the house calendars read from the sheet now, when the sheet is the newer
            end={master ? <SheetReloadButton onDone={onReload} /> : undefined} />
          {grid ? (
            <div className="scroll-thin overflow-x-auto" data-grid-scroll="">
              <SchedulingGrid grid={grid} house={current?.short || code} clock={clock} drawn={drawn} hours={hours} today={board.today}
                phones={phones}
                selected={panel?.kind === 'cell' ? panel.target : null}
                onOpen={(target) => setPanel({ kind: 'cell', target })} pick={marks} onPick={onPick}
                drag={draggable ? { keys: draggable, onDrop } : null} onShift={master} />
            </div>
          ) : (
            <p className="px-3 py-6 text-[13px] text-text-3" data-no-calendar="">
              {current ? 'This house has no calendar in this period yet.'
                : houseOnly ? 'Scheduling shows you no calendar for this house.'
                : board.viewer.is_master
                  ? 'No calendar yet: the house books have not been copied in. Open Actions → Setup → "Seed from the house books", press Dry run, read the report, then Seed now.'
                  : 'No calendar yet: it appears once the house books are copied in.'}
            </p>
          )}
          {/* the colour key, under the grid's last row */}
          <Legend present={marksPresent(grid, drawn)} />
        </div>
      )}

      {board && (
        <>
          <ShiftPanel board={board} house={panel?.kind === 'cell' && panel.house ? panel.house : code}
            target={panel?.kind === 'cell' ? panel.target : null} assignKey={panel?.kind === 'cell' ? panel.assign : undefined}
            hours={hours} clock={clock}
            onClose={() => setPanel(null)} onWrite={onWrite}
            onTimeOff={(from) => { setToRefusal(''); setPanel({ kind: 'timeoff', from }) }}
            onSwap={(preset) => {
              // a swap is picked on the grid: from another screen it opens the shift's house first
              if (screen !== 'house') set({ view: null, house: preset.house })
              startPick(fromPreset(preset))
            }} />
          {editor && (
            <AddShiftPanel open={panel?.kind === 'add'} onClose={() => setPanel(null)} board={board} house={code}
              day={drawn.from > board.today ? drawn.from : board.today} hours={hours} onWrite={onWrite} />
          )}
          <SwapShiftsPanel board={board} give={pick?.give ?? null} take={swapPanel?.take ?? null} giveAway={Boolean(swapPanel?.away)}
            awayTo={swapPanel?.to}
            onClose={() => setPanel(null)} onWrite={(answer, close) => { onWrite(answer, close); setPick(null) }} />
          <TimeOffPanel open={panel?.kind === 'timeoff'} onClose={() => setPanel(null)} board={board}
            key={panel?.kind === 'timeoff' ? `to|${panel.from}` : 'to'}
            initialFrom={panel?.kind === 'timeoff' ? panel.from : ''} busy={toBusy} refusal={toRefusal}
            onAsk={(f, t, r) => void askTimeOff(f, t, r)} />
          {settingsEditor && (
            <SetupPanel open={panel?.kind === 'setup'} onClose={() => setPanel(null)} board={board} full={master} onChanged={onReload} />
          )}
          <ItemPanel board={board} item={openItem} onClose={() => setPanel(null)} busy={Boolean(openItem && answers.busy === openItem.id)}
            refusal={openItem ? answers.refused[openItem.id] ?? '' : ''}
            onAnswer={(item, word, note) => { void answers.answer(item, word, note).then((ok) => { if (ok) setPanel(null) }) }} />
          <FlowPanel board={board} flow={openFlow} onClose={() => setPanel(null)} onWrite={onWrite} />
          <DragMovePanel at={panel?.kind === 'move' ? panel.at : null} onClose={() => setPanel(null)} onWrite={onWrite} />
        </>
      )}
    </div>
  )
}
