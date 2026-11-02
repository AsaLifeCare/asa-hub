// Support Requests — every Employee Support Hotline request and every Scheduling request, in one list the directors…
// Two bespoke pages (CUSTOM_PAGES 'support-desk/requests' and 'support-desk/incidents'); Incidents is the master's
// until App Control's support-desk.incidents control names badges.
import type { AppManifest } from '@/engine/types'

export const SUPPORT_DESK_APP_ID = 'support-desk'

export const supportDeskManifests: AppManifest[] = [
  {
    id: SUPPORT_DESK_APP_ID,
    name: 'Support Requests',
    tagline: 'Every hotline and scheduling request, answered in one place',
    icon: 'life-buoy',
    accent: 'blue',
    category: 'Operations',
    version: '1.0.0',
    audience: ['admin', 'manager', 'staff'],
    focusAudience: [],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'requests',
        type: 'dashboard' as const,
        title: 'Support Requests',
        icon: 'life-buoy',
        dataSource: { resource: 'houses' },
        config: { widgets: [] },
      },
      {
        // the Incident Log's reports in Support Requests' table, opened in the Incident Log's own side panel
        id: 'incidents',
        type: 'dashboard' as const,
        title: 'Incidents',
        icon: 'siren',
        feature: 'support-desk.incidents',
        dataSource: { resource: 'uiIncidents' },
        config: { widgets: [] },
      },
    ],
  },
]
