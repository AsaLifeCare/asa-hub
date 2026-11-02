// My Work — what is asked of the signed-in person, and what they have asked.
// One bespoke page (CUSTOM_PAGES 'my-work/actions').
import type { AppManifest } from '@/engine/types'

export const MY_WORK_APP_ID = 'my-work'
export const MY_WORK_PAGE_ID = 'actions'

export const myWorkManifests: AppManifest[] = [
  {
    id: MY_WORK_APP_ID,
    name: 'My Work',
    tagline: 'What is asked of you, and what you have asked',
    icon: 'list-checks',
    accent: 'mint',
    category: 'Workspace',
    version: '1.0.0',
    audience: ['admin', 'manager', 'staff', 'client'],
    focusAudience: ['staff'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: MY_WORK_PAGE_ID,
        type: 'dashboard',
        title: 'Actions & Requests',
        icon: 'list-checks',
        dataSource: { resource: 'activity' },
        config: { widgets: [] },
      },
    ],
  },
]
