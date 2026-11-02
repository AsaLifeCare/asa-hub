// Staff — one staff member at a time: profile, employment, documents, compliance, HR admin, actions and activity.
// One bespoke page (CUSTOM_PAGES 'staff-profiles/profile'), never a static route, so the resolver's badge check…
import type { AppManifest } from '@/engine/types'

export const STAFF_PROFILES_APP_ID = 'staff-profiles'
export const STAFF_PROFILES_PAGE_ID = 'profile'

export const staffProfilesManifests: AppManifest[] = [
  {
    id: STAFF_PROFILES_APP_ID,
    name: 'Staff',
    tagline: 'One staff member at a time — profile, employment, documents, compliance, HR and activity',
    icon: 'id-card',
    accent: 'blue',
    category: 'People',
    version: '1.0.0',
    audience: ['admin', 'manager', 'client'],
    focusAudience: [],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: STAFF_PROFILES_PAGE_ID,
        type: 'dashboard',
        title: 'Staff Profile',
        icon: 'id-card',
        dataSource: { resource: 'houses' },
        config: { widgets: [] },
      },
    ],
  },
]
