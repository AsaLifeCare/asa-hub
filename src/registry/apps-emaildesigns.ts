// EMAIL DESIGNS — the platform's letters, on a screen.
// An app that shows the available email layouts on screen, RENDERED — after an invite arrived as bare text and…
import type { AppManifest, PageSchema } from '@/engine/types'

const galleryPage: PageSchema = {
  id: 'gallery',
  type: 'sheet',
  title: 'Email Designs',
  icon: 'mail-open',
  dataSource: { resource: 'activity' }, // nominal — the page reads mailPreview
  config: { entity: ['design', 'designs'], customFeature: 'email-designs/EmailDesignsPage' },
}

export const emailDesignsManifests: AppManifest[] = [
  {
    id: 'email-designs',
    name: 'Email Designs',
    tagline: 'Every letter the platform sends, rendered — and testable in your own inbox',
    icon: 'mail-open',
    accent: 'lavender',
    category: 'Manage',
    version: '1.0.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [galleryPage],
  },
]
