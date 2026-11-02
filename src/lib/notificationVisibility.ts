// Notifications from apps this person has put away do not arrive.
// Uninstalling is theoretical — the app waits in the App Hub and its data is untouched — but it has to actually…
import type { AppManifest, AppNotification } from '@/engine/types'

export function visibleNotifications(
  items: AppNotification[],
  apps: AppManifest[],
): AppNotification[] {
  const off = new Set(apps.filter((a) => !a.enabled).map((a) => a.id))
  if (!off.size) return items
  return items.filter((n) => !n.appId || !off.has(n.appId))
}
