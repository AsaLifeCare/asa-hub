// DOC ROOMS — the old platform's Drive reading rooms come inside (gap survey §6).
// One app here (the Audit Library — the case-folder cabinet the survey ranked as an ABSENT with a name since 25/08…
import type { AppManifest, PageSchema } from '@/engine/types'

const libraryPage: PageSchema = {
  id: 'library',
  type: 'sheet',
  title: 'Audit Library',
  icon: 'folder-open',
  dataSource: { resource: 'activity' }, // nominal — the page reads docRoomList
  config: { entity: ['case file', 'case files'], customFeature: 'docrooms/AuditLibraryPage' },
}

export const docRoomsManifests: AppManifest[] = [
  {
    id: 'audit-library',
    name: 'Audit Library',
    tagline: 'Audits, internal investigations and lawsuits — the case folders, read in place',
    icon: 'folder-open',
    accent: 'amber',
    category: 'Manage',
    version: '1.0.0',
    // The folder holds legal cases about named people.
    audience: ['admin'],
    isNew: true,
    enabled: true,
    pages: [libraryPage],
  },
]
