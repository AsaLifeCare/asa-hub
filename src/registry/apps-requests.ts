// Support Requests Queue — the 23-type queue Requests.gs answers.
// The id, route and App Control rows are unchanged; only the name is new.
import type { AppManifest, PageSchema } from '@/engine/types'

const queuePage: PageSchema = {
  id: 'queue',
  type: 'sheet',
  title: 'Request queue',
  icon: 'life-buoy',
  // No generic resource: the screen calls the declared actions directly.
  dataSource: { resource: 'staffRequests' },
  config: {
    entity: ['request', 'requests'],
    customFeature: 'requests/RequestsPage',
  },
}

export const requestsManifests: AppManifest[] = [
  {
    id: 'support-requests',
    name: 'Support Requests Queue',
    tagline: 'Payroll, schedule, supplies and safety — asked and answered',
    icon: 'life-buoy',
    accent: 'peach',
    category: 'Manage',
    version: '1.0.0',
    // A menu, never a lock: Requests.gs refuses by role before the handler.
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [queuePage],
  },
]
