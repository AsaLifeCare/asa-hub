// Clients — one client at a time: profile, care, medication, appointments, transport, incidents, funds, billing and…
// One bespoke page (CUSTOM_PAGES 'client-profiles/profile'), never a static route, so the resolver's badge check…
import type { AppManifest } from '@/engine/types'

export const CLIENT_PROFILES_APP_ID = 'client-profiles'
export const CLIENT_PROFILES_PAGE_ID = 'profile'

export const clientProfilesManifests: AppManifest[] = [
  {
    id: CLIENT_PROFILES_APP_ID,
    name: 'Clients',
    tagline: 'One client at a time — profile, care, medication, appointments, transport, incidents',
    icon: 'user-round',
    accent: 'pink',
    category: 'Care',
    version: '1.0.0',
    audience: ['admin', 'manager', 'client'],
    focusAudience: [],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: CLIENT_PROFILES_PAGE_ID,
        type: 'dashboard',
        title: 'Client Profile',
        icon: 'user-round',
        dataSource: { resource: 'houses' },
        config: { widgets: [] },
      },
    ],
  },
]
