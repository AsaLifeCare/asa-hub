// Guardian: the platform's health, one screen — GAS selftest, snapshot freshness, write-ledger, relay reachability…
// A bespoke screen; the manifest below exists so the app appears in the sidebar / App Hub / badge matrix like every…
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

/* ---------- Health (bespoke screen — static route in App.tsx) ---------- */

const guardianPage: PageSchema = {
  id: 'health',
  type: 'sheet',
  title: 'Platform Health',
  icon: 'shield-check',
  // No `guardianHealth` resource exists in the resolver, deliberately: the screen calls guardianStatus /…
  dataSource: { resource: 'guardianHealth' },
  config: {
    entity: ['check', 'checks'],
    customFeature: 'guardian/GuardianPage',
  },
}

/* ---------- manifests ---------- */

export const guardianManifests: AppManifest[] = [
  {
    id: 'guardian',
    name: 'Guardian',
    tagline: "The platform's health, watched — breakages before users see them",
    icon: 'shield-check',
    accent: 'blue',
    category: 'Manage',
    version: '1.0.0',
    audience: ['admin'],
    isNew: true,
    enabled: true,
    pages: [guardianPage],
    notifications: ['app'],
  },
]

// Self-registration: registry/apps.ts is off-limits this wave, so importing this module appends the manifests to…
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = guardianManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
