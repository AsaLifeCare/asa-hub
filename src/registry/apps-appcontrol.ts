// App Control registry entry (v10 appcontrol wave): the dedicated full screen where the master places every app…
// The master's alone: MASTER_ONLY_APPS (lib/badgeAccess) outranks any rule row.
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

/* ---------- App Control ---------- */

const appControlPage: PageSchema = {
  id: 'board',
  type: 'board',
  title: 'App Control',
  icon: 'sliders-horizontal',
  dataSource: { resource: 'activity' },
  config: {
    entity: 'apps',
  },
}

/* ---------- manifest ---------- */

export const appControlManifest: AppManifest = {
  id: 'app-control',
  name: 'App Control',
  tagline: 'Every app, its category and audience — with smart suggestions',
  icon: 'sliders-horizontal',
  accent: 'blue',
  category: 'Manage',
  version: '1.0.0',
  audience: ['admin'],
  isNew: true,
  enabled: true,
  pages: [appControlPage],
}

// Self-registration: registry/apps.ts is off-limits this wave, so importing this module appends the manifest to the…
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  if (!registered.some((a) => a.id === appControlManifest.id)) {
    useRegistryStore.setState({ apps: [...registered, appControlManifest] })
  }
})
