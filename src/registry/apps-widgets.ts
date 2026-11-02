// WIDGETS — a bank of widgets, to be used inside the platform.
// The rows are indicator SPECS, never data — the number is counted by each reader's own session under their own…
import type { AppManifest, PageSchema } from '@/engine/types'

const bankPage: PageSchema = {
  id: 'bank',
  type: 'sheet',
  title: 'Widgets',
  icon: 'layout-dashboard',
  dataSource: { resource: 'widgets' },
  config: { entity: ['widget', 'widgets'], customFeature: 'widgets/WidgetsPage' },
}

export const widgetsManifests: AppManifest[] = [
  {
    id: 'widgets',
    name: 'Widgets',
    tagline: 'Live numbers for your page — a bank anyone can take from',
    icon: 'layout-dashboard',
    accent: 'peach',
    category: 'Workspace',
    version: '1.0.0',
    audience: ['all', 'admin', 'manager', 'staff'],
    isNew: true,
    enabled: true,
    pages: [bankPage],
  },
]
