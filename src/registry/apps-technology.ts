// Technology registry entry.
// The Technology Command Center + Tech Library of the old platform's app (pages/Technology.tsx and…
import type { AppManifest } from '@/engine/types'

export const technologyManifests: AppManifest[] = [
  {
    id: 'technology',
    name: 'Technology',
    tagline: 'The automation-project portfolio, the platform’s engineering state and every source document.',
    icon: 'cpu',
    accent: 'blue',
    category: 'Intelligence',
    version: '0.1.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'center',
        // bespoke screen — AppRoutePage CUSTOM_PAGES resolves 'technology/center' to TechnologyPage; the schema…
        type: 'dashboard',
        title: 'Technology Command Center',
        icon: 'cpu',
        dataSource: { resource: 'techProjects' },
        config: {
          widgets: [],
          // the Engineering State tab and the Drive listing ride the same first paint — prefetch is also what puts…
          prefetch: [{ resource: 'techEngineering' }, { resource: 'techDocs' }],
        },
      },
    ],
  },
]
