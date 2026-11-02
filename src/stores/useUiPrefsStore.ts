// Per-person UI preferences — whether a thing comes in from the right side or the left, from the top or the bottom.
// PER PERSON, NEVER GLOBAL — one person's choice must never repaint someone else's screen (standing rule).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ToastPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export const TOAST_POSITIONS: { key: ToastPosition; label: string }[] = [
  { key: 'top-left', label: 'Top left' },
  { key: 'top-right', label: 'Top right' },
  { key: 'bottom-left', label: 'Bottom left' },
  { key: 'bottom-right', label: 'Bottom right' },
]

// Which of System logs' three views opens first.
export type LogsDefaultView = 'normal' | 'table' | 'sheet'

/** How much of a house calendar is drawn: one Saturday-start week, or the whole tab. */
export type CalendarRange = 'week' | 'tab'
/** The one calendar screen's two views: Live (House Calendars) and Builder. */
export type CalendarView = 'live' | 'build'

export type UiPrefsState = {
  /** Which corner toasts pop from. Default: bottom-right (the original). */
  toastPosition: ToastPosition
  setToastPosition: (p: ToastPosition) => void
  /** Which view System logs opens on. The in-page switch still wins for the visit. */
  logsDefaultView: LogsDefaultView
  setLogsDefaultView: (v: LogsDefaultView) => void
  // Live Columbus forecast chip in the Topbar.
  topbarWeather: boolean
  setTopbarWeather: (on: boolean) => void
  // The clock beside it — date and time, the same switch shape.
  topbarClock: boolean
  setTopbarClock: (on: boolean) => void
  // The house calendars' Time switch: every cell that holds a time range drawn as clock times ("9:30 PM – 7:30 AM")…
  calendarClockTimes: boolean
  setCalendarClockTimes: (on: boolean) => void
  /** The range each calendar view opens on: Live a week, the Builder the whole tab, until the person picks. */
  calendarRange: Record<CalendarView, CalendarRange>
  setCalendarRange: (view: CalendarView, range: CalendarRange) => void
  /** The house the person last opened on the calendar screen; a link's house still wins. */
  calendarHouse: string
  setCalendarHouse: (location: string) => void
}

/** Live opens on the week, the Builder on the whole tab. */
export const DEFAULT_CALENDAR_RANGE: Record<CalendarView, CalendarRange> = { live: 'week', build: 'tab' }

/** Durable per-user prefs: sync the bundle to the Hub sheet (debounced). */
function pushSoon(): void {
  void import('@/lib/prefsSync').then((m) => m.schedulePrefsPush())
}

// One-time migrations for stored pref envelopes.
export const UI_PREFS_VERSION = 1

export function migrateUiPrefs(
  state: Partial<UiPrefsState>,
  version: number,
): Partial<UiPrefsState> {
  // v0 → v1: the weather chip's default flipped to ON for the whole platform, not per screen.
  if (version < 1) state.topbarWeather = true
  return state
}

export const useUiPrefsStore = create<UiPrefsState>()(
  persist(
    (set, get) => ({
      toastPosition: 'bottom-right',
      setToastPosition: (toastPosition) => {
        set({ toastPosition })
        pushSoon()
      },
      logsDefaultView: 'normal',
      setLogsDefaultView: (logsDefaultView) => {
        set({ logsDefaultView })
        pushSoon()
      },
      topbarWeather: true,
      setTopbarWeather: (topbarWeather) => {
        set({ topbarWeather })
        pushSoon()
      },
      topbarClock: true,
      setTopbarClock: (topbarClock) => {
        set({ topbarClock })
        pushSoon()
      },
      calendarClockTimes: false,
      setCalendarClockTimes: (calendarClockTimes) => {
        set({ calendarClockTimes })
        pushSoon()
      },
      calendarRange: { ...DEFAULT_CALENDAR_RANGE },
      // each push is an Apps Script execution, so only a change is pushed
      setCalendarRange: (view, range) => {
        if ({ ...DEFAULT_CALENDAR_RANGE, ...get().calendarRange }[view] === range) return
        set((s) => ({ calendarRange: { ...DEFAULT_CALENDAR_RANGE, ...s.calendarRange, [view]: range } }))
        pushSoon()
      },
      calendarHouse: '',
      setCalendarHouse: (calendarHouse) => {
        if (get().calendarHouse === calendarHouse) return
        set({ calendarHouse })
        pushSoon()
      },
    }),
    {
      name: 'asa-ui-prefs',
      version: UI_PREFS_VERSION,
      migrate: (persisted, version) =>
        migrateUiPrefs((persisted ?? {}) as Partial<UiPrefsState>, version) as UiPrefsState,
    },
  ),
)
