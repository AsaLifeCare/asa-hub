// Invoices registry entry (2026-08-25).
// the old platform Invoice Catalog (`/#/invoice`) re-homed as a hub app: same screen structure — header…
import type { AppManifest } from '@/engine/types'

export const invoicesManifests: AppManifest[] = [
  {
    id: 'invoices',
    name: 'Invoices',
    tagline: 'Every NF, invoice, receipt and PO — catalogued, filtered, one click from the source.',
    icon: 'wallet',
    accent: 'blue',
    category: 'Finance',
    version: '0.1.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'list',
        // bespoke screen — AppRoutePage CUSTOM_PAGES resolves 'invoices/list' to InvoicesPage; the schema stays…
        type: 'dashboard',
        title: 'Invoice Catalog',
        icon: 'wallet',
        dataSource: { resource: 'invoices' },
        config: { widgets: [] },
      },
    ],
  },
]
