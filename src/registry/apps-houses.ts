// HOUSES — the active houses, and each house's page.
// One bespoke page (src/pages/features/houses/HousesPage.tsx) on a static route in App.tsx.
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

const dossierPage: PageSchema = {
  id: 'dossier',
  type: 'sheet',
  title: 'Houses',
  icon: 'house',
  dataSource: { resource: 'houses' },
  config: {
    entity: 'houses',
    columns: [
      { key: 'title', label: 'House' },
      { key: 'address', label: 'Address' },
      { key: 'client_count', label: 'Clients' },
    ],
  },
}

export const housesManifests: AppManifest[] = [
  {
    id: 'houses', name: 'Houses', tagline: 'Every active house — its clients, its house manager, its staff and its tools',
    icon: 'house', accent: 'green', category: 'Operations', version: '2.0.0',
    audience: ['admin', 'manager', 'staff', 'client'],
    // 'client' above opens the door to the portal role; a client focus must not show the tile
    focusAudience: ['house'],
    isNew: true, enabled: true, pages: [dossierPage], notifications: ['app'],
  },
]

// Self-registration: importing this module appends the manifest to the live registry store (idempotent).
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = housesManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
