// "Docs" — operational playbooks & guides library.
// Custom page: mounted via CUSTOM_PAGES in src/pages/AppRoutePage.tsx ('docs/library'), so the page schema here is…
import type { AppManifest } from '@/engine/types'

export const docsReaderManifests: AppManifest[] = [
  {
    id: 'docs',
    name: 'Docs',
    tagline: 'Operational playbooks & guides',
    icon: 'book-open',
    accent: 'peach',
    category: 'Library',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    audience: ['all', 'staff'],
    pages: [
      {
        id: 'library',
        type: 'documents',
        title: 'Library',
        icon: 'book-open',
        dataSource: { resource: 'documents' },
        config: {},
      },
    ],
    notifications: ['app'],
  },
]
