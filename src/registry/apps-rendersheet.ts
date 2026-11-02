// Render Sheet: an app that renders ONLY sheets — the 4-5 broadly-essential HUB_DB tabs, in the exact spreadsheet…
// TWO GATES, deliberately separate.
import type { AppManifest, PageSchema } from '@/engine/types'

const sheetsPage: PageSchema = {
  id: 'sheets',
  type: 'sheet',
  title: 'Sheets',
  icon: 'table',
  // There is NO `renderSheets` resource in the generic resolver, and that is deliberate (the Time Reconciliation…
  dataSource: { resource: 'renderSheets' },
  config: {
    entity: ['sheet', 'sheets'],
    customFeature: 'rendersheet/RenderSheetPage',
  },
}

export const renderSheetManifests: AppManifest[] = [
  {
    id: 'render-sheet',
    name: 'Render Sheet',
    tagline: 'The essential sheets, rendered as the sheets they are',
    icon: 'table',
    accent: 'blue',
    category: 'Manage',
    version: '1.0.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [sheetsPage],
    notifications: ['app'],
  },
]
