// WHAT REACHES YOU — the four switches in Settings → Notifications, and the one place that reads them.
// They were a panel that recorded a preference nothing consulted: four switches, saved to localStorage, obeyed by…
import type { NotificationType } from '@/engine/types'

export type NotifPrefs = {
  toasts: boolean
  mentions: boolean
  appActivity: boolean
  reminders: boolean
}

export const NOTIF_PREFS_KEY = 'asa-notif-prefs'

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  toasts: true,
  mentions: true,
  appActivity: true,
  reminders: true,
}

export function loadNotifPrefs(): NotifPrefs {
  try {
    return { ...DEFAULT_NOTIF_PREFS, ...(JSON.parse(localStorage.getItem(NOTIF_PREFS_KEY) ?? '{}') as Partial<NotifPrefs>) }
  } catch {
    return DEFAULT_NOTIF_PREFS
  }
}

export function saveNotifPrefs(p: NotifPrefs): void {
  localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(p))
}

/** Does this kind of notification arrive at all? */
export function notifWanted(type: NotificationType, prefs = loadNotifPrefs()): boolean {
  if (type === 'mention') return prefs.mentions
  if (type === 'app') return prefs.appActivity
  if (type === 'reminder') return prefs.reminders
  return true // 'system' — never silenced
}

/** May an arrival interrupt the screen with a toast? */
export function notifToastWanted(prefs = loadNotifPrefs()): boolean {
  return prefs.toasts
}
