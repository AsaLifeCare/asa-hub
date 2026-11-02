// Emergency Contacts — the numbers a bad day dials, one tap away.
// One bespoke page (CUSTOM_PAGES 'emergency-contacts/directory').
import type { AppManifest } from '@/engine/types'

export const EMERGENCY_CONTACTS_APP_ID = 'emergency-contacts'

export const emergencyContactsManifests: AppManifest[] = [
  {
    id: EMERGENCY_CONTACTS_APP_ID,
    name: 'Emergency Contacts',
    tagline: 'The numbers a bad day dials, one tap away',
    icon: 'siren',
    accent: 'pink',
    category: 'Operations',
    version: '1.0.0',
    audience: ['all', 'admin', 'manager', 'staff', 'client'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'directory',
        type: 'dashboard' as const,
        title: 'Directory',
        icon: 'siren',
        dataSource: { resource: 'activity' },
        config: { widgets: [] },
      },
    ],
  },
]
