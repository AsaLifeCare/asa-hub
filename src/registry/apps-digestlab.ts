// "Decoder lab" — the room where a document is put in front of the decoder and argued with.
// Custom page: mounted via CUSTOM_PAGES in src/pages/AppRoutePage.tsx ('digestlab/bench'), so the page schema here…
import type { AppManifest } from '@/engine/types'

export const digestLabManifests: AppManifest[] = [
  {
    id: 'digestlab',
    name: 'Decoder lab',
    tagline: 'Any document, both readings, side by side',
    icon: 'scan-text',
    accent: 'lavender',
    category: 'Technology',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    audience: ['admin', 'manager'],
    pages: [
      {
        id: 'bench',
        type: 'documents',
        title: 'Bench',
        icon: 'scan-text',
        dataSource: { resource: 'formFiles' },
        config: {},
      },
    ],
    notifications: ['app'],
  },
]
