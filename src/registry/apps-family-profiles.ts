// Families & Guardians — one family member at a time: relationship, clients, documents and activity.
// One bespoke page (CUSTOM_PAGES 'family-profiles/profile'), never a static route, so the resolver's badge check…
import type { AppManifest } from '@/engine/types'

export const FAMILY_PROFILES_APP_ID = 'family-profiles'
export const FAMILY_PROFILES_PAGE_ID = 'profile'

export const familyProfilesManifests: AppManifest[] = [
  {
    id: FAMILY_PROFILES_APP_ID,
    name: 'Families & Guardians',
    tagline: 'One family member at a time — relationship, clients, documents and activity',
    icon: 'users-round',
    accent: 'peach',
    category: 'Care',
    version: '1.0.0',
    audience: ['admin', 'manager', 'client'],
    focusAudience: [],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: FAMILY_PROFILES_PAGE_ID,
        type: 'dashboard',
        title: 'Family Profile',
        icon: 'users-round',
        dataSource: { resource: 'houses' },
        config: { widgets: [] },
      },
    ],
  },
]
