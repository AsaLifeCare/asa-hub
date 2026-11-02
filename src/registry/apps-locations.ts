// Locations — one house at a time: its overview, staff, calendar, supplies, repairs, incidents and documents.
// One bespoke page (CUSTOM_PAGES 'locations/overview'), never a static route, so the resolver's badge check stands…
import type { AppManifest } from '@/engine/types'

export const LOCATIONS_APP_ID = 'locations'
export const LOCATIONS_PAGE_ID = 'overview'

export const locationsManifests: AppManifest[] = [
  {
    id: LOCATIONS_APP_ID,
    name: 'Locations',
    tagline: 'One house at a time — its staff, calendar, supplies, repairs, incidents and documents',
    icon: 'map-pin',
    accent: 'green',
    category: 'Operations',
    version: '1.0.0',
    audience: ['admin', 'manager', 'client'],
    focusAudience: [],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: LOCATIONS_PAGE_ID,
        type: 'dashboard',
        title: 'Overview',
        icon: 'map-pin',
        dataSource: { resource: 'houses' },
        config: { widgets: [] },
      },
    ],
  },
]
