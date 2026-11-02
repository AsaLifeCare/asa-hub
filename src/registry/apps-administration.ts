// Administration registry entry (2026-08-25).
// The AdministrationWorkspace of the old platform's app src/components/AdministrationWorkspace.tsx) re-homed as a hub…
import type { AppManifest } from '@/engine/types'

export const administrationManifests: AppManifest[] = [
  {
    id: 'administration',
    name: 'Administration',
    tagline: 'The Administration document corpus — Drive folder, library, signatures and the cortex, one desk.',
    icon: 'briefcase',
    accent: 'lavender',
    category: 'Manage',
    version: '0.1.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'workspace',
        // bespoke screen — AppRoutePage CUSTOM_PAGES resolves 'administration/workspace' to AdministrationPage; the…
        type: 'dashboard',
        title: 'Administration Workspace',
        icon: 'briefcase',
        dataSource: { resource: 'documents' },
        config: {
          widgets: [],
          // the signature/ack ledger rides the same first paint
          prefetch: [{ resource: 'policyAcks' }],
        },
      },
    ],
  },
]
