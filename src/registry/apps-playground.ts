// Playground registry entry (playground wave).
// The "Playground" app — the admin's JSON app studio (EDIT IN PLAYGROUND).
import type { AppManifest } from '@/engine/types'

export const playgroundManifests: AppManifest[] = [
  {
    id: 'playground',
    name: 'Playground',
    tagline: 'Design an app, feed it sample JSON, publish it to the hub.',
    icon: 'flask-conical',
    accent: 'lavender',
    category: 'Intelligence',
    version: '0.1.0',
    audience: ['all', 'admin'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'studio',
        // bespoke screen — AppRoutePage CUSTOM_PAGES resolves 'playground/studio' to PlaygroundPage; this schema…
        type: 'dashboard',
        title: 'Studio',
        icon: 'flask-conical',
        dataSource: { resource: 'activity' },
        config: { widgets: [] },
      },
    ],
  },
]
