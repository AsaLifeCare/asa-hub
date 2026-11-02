// My Calendar — the signed-in person's week of shifts and their own time off requests.
// One bespoke page (CUSTOM_PAGES 'my-calendar/week').
import type { AppManifest } from '@/engine/types'

export const MY_CALENDAR_APP_ID = 'my-calendar'
export const MY_CALENDAR_PAGE_ID = 'week'

export const myCalendarManifests: AppManifest[] = [
  {
    id: MY_CALENDAR_APP_ID,
    name: 'My Calendar',
    tagline: 'Your week of shifts and your time off requests',
    icon: 'calendar-check',
    accent: 'peach',
    category: 'Workspace',
    version: '1.0.0',
    audience: ['admin', 'manager', 'staff', 'client'],
    focusAudience: ['staff'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: MY_CALENDAR_PAGE_ID,
        type: 'dashboard',
        title: 'Week',
        icon: 'calendar-check',
        dataSource: { resource: 'activity' },
        config: { widgets: [] },
      },
    ],
  },
]
