// Time Reconciliation — the audit queue of punch × schedule × coverage.
// A home-care agency bills hours somebody must be able to defend: the schedule said who should be where, the…
import type { AppManifest, PageSchema } from '@/engine/types'

const reconQueuePage: PageSchema = {
  id: 'queue',
  type: 'sheet',
  title: 'Review queue',
  icon: 'clipboard-check',
  // There is NO `reconErrors` resource in the generic resolver, and that is deliberate: the screen is bespoke and…
  dataSource: { resource: 'reconErrors' },
  config: {
    entity: ['anomaly', 'anomalies'],
    customFeature: 'time-recon/TimeReconPage',
  },
}

export const timeReconManifests: AppManifest[] = [
  {
    id: 'time-recon',
    name: 'Time Reconciliation',
    tagline: 'Punch against schedule against coverage, reviewed by a person',
    icon: 'clipboard-check',
    accent: 'amber',
    category: 'Operations',
    version: '1.0.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [reconQueuePage],
    notifications: ['app'],
  },
]
