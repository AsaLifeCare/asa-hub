// Scheduling — one calendar per house that the staff run themselves.
// One bespoke page (CUSTOM_PAGES 'scheduling/calendar').
import type { AppManifest } from '@/engine/types'

export const SCHEDULING_APP_ID = 'scheduling'

export const schedulingManifests: AppManifest[] = [
  {
    id: SCHEDULING_APP_ID,
    name: 'Scheduling',
    tagline: 'Every house’s shifts, run by the people who work them',
    icon: 'calendar-clock',
    accent: 'blue',
    category: 'Operations',
    version: '1.0.0',
    audience: ['admin', 'manager', 'staff'],
    focusAudience: [],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'calendar',
        type: 'dashboard' as const,
        title: 'Scheduling',
        icon: 'calendar-clock',
        dataSource: { resource: 'houses' },
        config: { widgets: [] },
      },
    ],
  },
]
