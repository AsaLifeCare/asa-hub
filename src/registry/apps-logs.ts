// "System logs" — the real one, replacing the Studio-imported grid.
// The screen it supersedes was a sheet import: ten raw columns of the `system_logs` tab, shown the way a…
import type { AppManifest } from '@/engine/types'

export const logsManifests: AppManifest[] = [
  {
    id: 'logs',
    name: 'System logs',
    tagline: 'Every action on the platform, as it happened',
    icon: 'scroll-text',
    accent: 'lavender',
    category: 'Workspace',
    version: '1.0.0',
    enabled: true,
    audience: ['admin'],
    pages: [
      {
        // ONE page, and that is the whole app now.
        id: 'feed',
        // Generic type as the fallback shell — CUSTOM_PAGES mounts SystemLogsPage, which reads `logsList` rather…
        type: 'sheet',
        title: 'Activity',
        icon: 'scroll-text',
        dataSource: { resource: 'activity' },
        config: {},
      },
    ],
    notifications: [],
  },
]
