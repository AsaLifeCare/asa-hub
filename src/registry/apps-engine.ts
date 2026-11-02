// Compliance Engine: the face of the compliance engine — the requirements catalog, the materialized states matrix…
// Three bespoke screens over the actions the backend already answers (requirementsList/Upsert/Delete…
import type { AppManifest } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { requirementsPage, statesPage, eventsPage } from '@/registry/apps-employeetracker'

// `requirementsPage` / `statesPage` / `eventsPage` MOVED to apps-employeetracker.ts — see the note there.
export const engineManifests: AppManifest[] = [
  {
    id: 'compliance-engine',
    name: 'Compliance Engine',
    tagline: 'Every obligation as data — the catalog, the matrix, and the trail',
    icon: 'shield-check',
    accent: 'green',
    category: 'Manage',
    version: '1.0.0',
    audience: ['admin', 'manager'],
    isNew: true,
    // PUT AWAY, NOT DELETED: an app that leaves is uninstalled, never destroyed.
    enabled: false,
    pages: [requirementsPage, statesPage, eventsPage],
    notifications: ['app'],
  },
]

// Deferred: module-level getState() crashes with a TDZ ReferenceError when Rollup orders this module before the…
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = engineManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
