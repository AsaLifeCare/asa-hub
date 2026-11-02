/** Toast placement: routine in the chosen corner, urgent pinned right on the same edge. */
import type { ToastItem } from '@/stores/useToastStore'
import type { ToastPosition } from '@/stores/useUiPrefsStore'

/** Where the urgent stack pins: always the right, on the person's own edge. */
export function urgentCorner(position: ToastPosition): ToastPosition {
  return position.startsWith('top') ? 'top-right' : 'bottom-right'
}

/** Newest nearest the edge; in a shared column urgent ones nearest of all. */
export function stackOrder(items: ToastItem[], position: ToastPosition): ToastItem[] {
  const urgent = items.filter((t) => t.urgent)
  const routine = items.filter((t) => !t.urgent)
  return position.startsWith('top')
    ? [...[...urgent].reverse(), ...[...routine].reverse()]
    : [...routine, ...urgent]
}
