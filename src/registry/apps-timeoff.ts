/** Time Off: two bespoke pages behind the resolver's gates; `houses` is a nominal source, never the rows. */
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

const boardPage: PageSchema = {
  id: 'board',
  type: 'sheet',
  title: 'Time Off',
  icon: 'calendar-off',
  dataSource: { resource: 'houses' },
  config: { entity: ['request', 'requests'], customFeature: 'timeoff/TimeOffPage' },
}

const requestsPage: PageSchema = {
  id: 'requests',
  type: 'sheet',
  title: 'Requests',
  icon: 'list-checks',
  dataSource: { resource: 'houses' },
  config: { entity: ['request', 'requests'], customFeature: 'timeoff/TimeOffRequestsPage' },
}

export const timeOffManifests: AppManifest[] = [
  {
    id: 'timeoff', name: 'Time Off', tagline: 'Ask for time off, approve it, and see who is off',
    icon: 'calendar-off', accent: 'lavender', category: 'Operations', version: '1.0.0',
    audience: ['admin', 'manager', 'staff'],
    isNew: true, enabled: true, pages: [boardPage, requestsPage], notifications: ['app'],
  },
]

queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = timeOffManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
