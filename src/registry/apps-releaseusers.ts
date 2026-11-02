// Release Users registry entry.
// A master-only door: pick a person, see their situation in the sheet, rearm their account for the FULL first-login…
import type { AppManifest } from '@/engine/types'

export const releaseUsersManifests: AppManifest[] = [
  {
    id: 'release-users',
    name: 'Release Users',
    tagline: 'Pick a person, rearm their first login, send the invite.',
    icon: 'user-plus',
    accent: 'mint',
    category: 'Manage',
    version: '0.1.0',
    audience: ['admin'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'release',
        // bespoke screen — AppRoutePage CUSTOM_PAGES resolves 'release-users/release' to ReleaseUsersPage; the…
        type: 'dashboard',
        title: 'Release',
        icon: 'user-plus',
        dataSource: { resource: 'activity' },
        config: { widgets: [] },
      },
    ],
  },
]
