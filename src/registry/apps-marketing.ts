// MARKETING — competitive intelligence on the tracked rivals.
// Source of truth is the Hub spreadsheet `ASA Hub — Marketing` in the platform folder.
import type { AppManifest, PageSchema } from '@/engine/types'

const competitorsPage: PageSchema = {
  id: 'competitors',
  type: 'sheet',
  title: 'Competitors',
  icon: 'megaphone',
  // No marketingIntel resource in the resolver: the screen calls marketingCompetitors and paints curated facts.
  dataSource: { resource: 'marketingIntel' },
  config: { entity: ['competitor', 'competitors'], customFeature: 'marketing/MarketingPage' },
}

// THE SECOND PAGE — the field measured against us, and what the numbers argue for.
const analyticsPage: PageSchema = {
  id: 'analytics',
  type: 'sheet',
  title: 'Analysis & strategy',
  icon: 'bar-chart-3',
  dataSource: { resource: 'marketingIntel' },
  config: { customFeature: 'marketing/MarketingAnalyticsPage' },
}

export const marketingManifests: AppManifest[] = [
  {
    id: 'marketing',
    name: 'Marketing',
    tagline: 'Tracked competitors — Hub copy of the sheet, treated on our tab',
    icon: 'megaphone',
    accent: 'peach',
    category: 'Intelligence',
    version: '1.0.0',
    audience: ['all', 'admin', 'manager', 'staff'],
    isNew: true,
    enabled: true,
    pages: [competitorsPage, analyticsPage],
    notifications: ['app'],
  },
]
