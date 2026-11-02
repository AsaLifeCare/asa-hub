// Transportation — the team's vehicles: a request goes to the directors, the first answer decides, and an approved…
// Three bespoke pages (CUSTOM_PAGES 'vehicle-calendar/{calendar,history,vehicles}'), one screen reading `pageId`.
import type { AppManifest, PageSchema } from '@/engine/types'

export const VEHICLE_CALENDAR_APP_ID = 'vehicle-calendar'

const PAGE_TITLE = { calendar: 'Calendar', history: 'History', vehicles: 'Vehicles' } as const
const PAGE_ICON = { calendar: 'calendar-days', history: 'history', vehicles: 'car-front' } as const

const page = (id: 'calendar' | 'history' | 'vehicles'): PageSchema => ({
  id,
  type: 'dashboard' as const,
  title: PAGE_TITLE[id],
  icon: PAGE_ICON[id],
  dataSource: { resource: 'houses' },
  config: { widgets: [] },
})

export const vehicleCalendarManifests: AppManifest[] = [
  {
    id: VEHICLE_CALENDAR_APP_ID,
    name: 'Transportation',
    tagline: 'Book the team’s vehicles — requests, approvals and the shared calendar',
    icon: 'car-front',
    accent: 'blue',
    category: 'Operations',
    version: '1.0.0',
    audience: ['admin', 'manager', 'staff'],
    focusAudience: [],
    isNew: true,
    enabled: true,
    pages: [page('calendar'), page('history'), page('vehicles')],
  },
]
