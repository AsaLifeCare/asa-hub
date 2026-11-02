// Client Finances — the money the agency holds on each client's behalf.
// Replaces the standalone Apps Script portal (see apps-script/Finance.gs for why).
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

const financePortalPage: PageSchema = {
  id: 'portal',
  type: 'sheet',
  title: 'Client Finances',
  icon: 'wallet',
  // There is NO `financeClients` resource, and that is deliberate: the screen is bespoke and calls the declared…
  dataSource: { resource: 'financeClients' },
  config: {
    entity: ['client', 'clients'],
    customFeature: 'finance/FinancePortal',
  },
}

export const financeManifests: AppManifest[] = [
  {
    id: 'finance',
    name: 'Client Finances',
    tagline: 'Balances, spending and receipts held on a client’s behalf',
    icon: 'wallet',
    accent: 'mint',
    category: 'Operations',
    version: '1.0.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [financePortalPage],
    notifications: ['app'],
  },
]

/** Self-registration, same guard as the other satellite manifests. */
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = financeManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
