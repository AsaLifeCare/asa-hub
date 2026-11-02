// BOOKS — a small library, in Wellbeing.
// Free-source books mined from the internet, laid out and uploaded to the platform and into a books folder as a…
import type { AppManifest, PageSchema } from '@/engine/types'

const libraryPage: PageSchema = {
  id: 'library',
  type: 'sheet',
  title: 'Books',
  icon: 'book-open',
  dataSource: { resource: 'books' },
  config: { entity: ['book', 'books'], customFeature: 'books/BooksPage' },
}

export const booksManifests: AppManifest[] = [
  {
    id: 'books',
    name: 'Books',
    tagline: 'Free, properly licensed reading for the work we actually do',
    icon: 'book-open',
    accent: 'peach',
    category: 'Wellbeing',
    version: '1.0.0',
    audience: ['all'],
    isNew: true,
    enabled: true,
    pages: [libraryPage],
    notifications: ['app'],
  },
]
