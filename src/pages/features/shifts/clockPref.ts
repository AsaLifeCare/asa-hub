// WHO IS READING THE CALENDARS IN CLOCK TIMES — one question, one answer, and every calendar asks it.
// The choice belongs to the person (useUiPrefsStore, carried across their devices by lib/prefsSync), never to the…
import { useUiPrefsStore } from '@/stores/useUiPrefsStore'

export function useClockTimes(): boolean {
  return useUiPrefsStore((s) => s.calendarClockTimes)
}
