// Shift Board: its screens live in Calendar Builder.
// The manifest stays (uninstalled by hand, never in code) so every /app/shiftboard/<page> redirects there and its…
import type { AppManifest } from '@/engine/types'
import { SHIFT_BOARD_PAGES } from '@/registry/apps-calendarbuilder'

/** Shift Board page id → Calendar Builder page id (the old board is Live now); read above the `enabled` guard. */
export const SHIFT_BOARD_MOVED_TO: Readonly<Record<string, string>> = Object.freeze({
  cards: 'cards',
  calendar: 'house-cal',
  timeline: 'timeline',
  coverage: 'coverage',
  week: 'week',
  'house-cal': 'house-cal',
  requests: 'requests',
})

export const shiftsSuiteManifests: AppManifest[] = [
  {
    id: 'shiftboard',
    name: 'Shift Board',
    tagline: 'Moved into Calendar Builder',
    icon: 'calendar-range',
    accent: 'blue',
    category: 'Operations',
    version: '1.1.0',
    enabled: true,
    /** clients are narrowed to their own house by the backend (clientByHouse) */
    audience: ['staff', 'client'],
    pages: SHIFT_BOARD_PAGES,
    notifications: ['reminder'],
  },
]
