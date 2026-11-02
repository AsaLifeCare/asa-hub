// Staff Candidates — one candidate at a time: stage, actions, interviews, documents and every conversation.
// One bespoke page (CUSTOM_PAGES 'staff-candidates/profile'), never a static route, so the resolver's badge check…
import type { AppManifest } from '@/engine/types'

export const STAFF_CANDIDATES_APP_ID = 'staff-candidates'
export const STAFF_CANDIDATES_PAGE_ID = 'profile'

export const staffCandidatesManifests: AppManifest[] = [
  {
    id: STAFF_CANDIDATES_APP_ID,
    name: 'Staff Candidates',
    tagline: 'One candidate at a time — stage, actions, interviews, documents and every conversation',
    icon: 'user-plus',
    accent: 'blue',
    category: 'Manage',
    version: '1.0.0',
    audience: ['admin', 'manager', 'client'],
    focusAudience: [],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: STAFF_CANDIDATES_PAGE_ID,
        type: 'dashboard',
        title: 'Candidate',
        icon: 'user-plus',
        dataSource: { resource: 'houses' },
        config: { widgets: [] },
      },
    ],
  },
]
