// SSA — one Service and Support Administrator at a time: details, clients, documents and activity.
// One bespoke page (CUSTOM_PAGES 'ssa-profiles/profile'), never a static route, so the resolver's badge check…
import type { AppManifest } from '@/engine/types'

export const SSA_PROFILES_APP_ID = 'ssa-profiles'
export const SSA_PROFILES_PAGE_ID = 'profile'

export const ssaProfilesManifests: AppManifest[] = [
  {
    id: SSA_PROFILES_APP_ID,
    name: 'SSA',
    tagline: 'One SSA at a time — details, clients, documents and activity',
    icon: 'briefcase',
    accent: 'lavender',
    category: 'Care',
    version: '1.0.0',
    audience: ['admin', 'manager', 'client'],
    focusAudience: [],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: SSA_PROFILES_PAGE_ID,
        type: 'dashboard',
        title: 'SSA Profile',
        icon: 'briefcase',
        dataSource: { resource: 'houses' },
        config: { widgets: [] },
      },
    ],
  },
]
