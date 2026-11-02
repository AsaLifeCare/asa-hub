// No App Control row, so the master's alone.
import type { AppManifest } from '@/engine/types'

export const productionActionsManifests: AppManifest[] = [
  {
    id: 'production-actions',
    name: 'Production Actions',
    tagline: 'The go-live runbook: rehearsed first, run on a click.',
    icon: 'rocket',
    accent: 'peach',
    category: 'Manage',
    version: '0.1.0',
    audience: ['admin'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'runbook',
        type: 'dashboard',
        title: 'Runbook',
        icon: 'rocket',
        dataSource: { resource: 'activity' },
        config: { widgets: [] },
      },
    ],
  },
]
