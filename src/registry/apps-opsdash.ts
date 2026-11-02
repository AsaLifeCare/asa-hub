// Ops Dashboard registry (v7 wave): a mini "today at a glance" dashboard for admins/managers.
// (Fleet & Mileage lived here until it was retired: the Transportation app shows all of it already.
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

/* ---------- Dashboard (bespoke screen — static route in App.tsx) ---------- */

const opsDashPage: PageSchema = {
  id: 'today',
  type: 'sheet',
  title: "Today's Operation",
  icon: 'gauge',
  dataSource: { resource: 'shiftCards' },
  config: {
    entity: 'shift cards',
    columns: [
      { key: 'personName', label: 'Staff' },
      { key: 'totalShifts', label: 'Shifts' },
      { key: 'houseCount', label: 'Houses' },
    ],
  },
}

/* ---------- manifests ---------- */

export const opsDashManifests: AppManifest[] = [
  {
    id: 'opsdash', name: 'Dashboard', tagline: "Today's operation at a glance",
    icon: 'gauge', accent: 'blue', category: 'Operations', version: '1.0.0',
    // CLIENT IS IN THE AUDIENCE — without the role named here, Dashboard does not appear for a client at all.
    audience: ['admin', 'manager', 'client'],
    isNew: true, enabled: true, pages: [opsDashPage], notifications: ['app'],
  },
]

// Self-registration: registry/apps.ts is off-limits this wave, so importing this module appends the manifests to…
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = opsDashManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
