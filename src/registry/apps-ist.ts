// IST registry — the training obligation, as one table.
// It is basically a sheet of data with the notices living in Smart Comms: the table shows who owes the training and…
import type { AppManifest } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { istPage } from '@/registry/apps-employeetracker'

// `istPage` MOVED to apps-employeetracker.ts — see the import above and the note there on why the direction is what…
export const istManifests: AppManifest[] = [
  {
    id: 'ist',
    name: 'IST Records',
    tagline: 'Who has been trained on which client, and who still owes it',
    icon: 'graduation-cap',
    accent: 'amber',
    category: 'Care',
    version: '1.0.0',
    // The people who run houses and hiring.
    audience: ['admin', 'manager'],
    isNew: true,
    // PUT AWAY, NOT DELETED: an app that leaves is uninstalled, never destroyed.
    enabled: false,
    pages: [istPage],
    notifications: ['app'],
  },
]

// Deferred: module-level getState() crashes with a TDZ ReferenceError when Rollup orders this module before the…
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = istManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
