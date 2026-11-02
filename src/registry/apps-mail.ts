// "Mail" — the Gmail-ready inbox app.
// Custom page: mounted via CUSTOM_PAGES in src/pages/AppRoutePage.tsx ('mail/inbox'), so the page schema here is a…
import type { AppManifest } from '@/engine/types'

export const mailManifests: AppManifest[] = [
  {
    id: 'mail',
    name: 'Mail',
    tagline: 'Your inbox, integrated',
    icon: 'mail',
    accent: 'blue',
    // Wellbeing is where this belongs by default.
    category: 'Wellbeing',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    audience: ['all', 'staff'],
    pages: [
      {
        id: 'inbox',
        type: 'dashboard',
        title: 'Inbox',
        icon: 'mail',
        dataSource: { resource: 'activity' },
        config: {},
      },
    ],
    notifications: ['app', 'reminder'],
  },
]
