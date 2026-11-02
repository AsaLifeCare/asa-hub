// "Drag & drop name" feature gate (shifts wave) — whether the real names an app shows are drag handles for the…
// Default ON: the whole point of showing real names is being able to hand one to the platform.
import { useRegistryStore } from '@/stores/useRegistryStore'

/** An app whose screens moved from another carries that app's choice until it has its own (calendars from the Shift Board). */
export const DRAG_FOCUS_CARRIED_FROM: Readonly<Record<string, string>> = Object.freeze({
  calendarbuilder: 'shiftboard',
})

/** The app's own choice once made, else the choice it carries, else on. */
export function dragFocusOf(apps: readonly { id: string; dragFocus?: boolean }[], appId: string): boolean {
  const own = apps.find((a) => a.id === appId)?.dragFocus
  if (typeof own === 'boolean') return own
  const from = DRAG_FOCUS_CARRIED_FROM[appId]
  return !from || apps.find((a) => a.id === from)?.dragFocus !== false
}

export function useDragFocusEnabled(appId: string): boolean {
  return useRegistryStore((s) => dragFocusOf(s.apps, appId))
}
