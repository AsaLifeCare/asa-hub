// Client Candidates — one referral at a time: the intake with the family, documents and every conversation.
// One bespoke page (CUSTOM_PAGES 'client-candidates/profile'), never a static route, so the resolver's badge check…
import type { AppManifest } from '@/engine/types'

export const CLIENT_CANDIDATES_APP_ID = 'client-candidates'
export const CLIENT_CANDIDATES_PAGE_ID = 'profile'

export const clientCandidatesManifests: AppManifest[] = [
  {
    id: CLIENT_CANDIDATES_APP_ID,
    name: 'Client Candidates',
    tagline: 'One referral at a time — intake with the family, documents and every conversation',
    icon: 'user-round-plus',
    accent: 'peach',
    category: 'Care',
    version: '1.0.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: CLIENT_CANDIDATES_PAGE_ID,
        type: 'dashboard',
        title: 'Candidate',
        icon: 'user-round-plus',
        dataSource: { resource: 'houses' },
        config: { widgets: [] },
      },
    ],
  },
]
